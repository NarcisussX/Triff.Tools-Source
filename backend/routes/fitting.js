/*
 * Express routes for the web-native EVE fitting tool.
 * Search/type metadata uses local SDE when possible; Pyfa/eos calculation
 * requests are proxied to fitting-service.
 */

const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const pool = require("../db/pool");
const fittingClient = require("../services/fittingClient");
const combatProfileApi = require("../services/combatProfileApi");
const fittingEsi = require("../services/fittingEsi");
const siteAuth = require("../services/siteAuth");

const router = express.Router();
router.use(cookieParser());

const DEFAULT_PRICE_STATION_ID = Number(process.env.FITTING_PRICE_STATION_ID || process.env.MARKET_STATION_ID || 60003760);
const DEFAULT_PRICE_MODE = process.env.FITTING_PRICE_MODE || "sell_min";
function positiveEnvNumber(name, fallback, minimum = 1) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

const ROLLING_STATS_RATE_WINDOW_MS = positiveEnvNumber("FITTING_ROLLING_STATS_RATE_WINDOW_MS", 60_000, 1000);
const ROLLING_STATS_RATE_TOKENS_PER_WINDOW = positiveEnvNumber("FITTING_ROLLING_STATS_RATE_TOKENS_PER_WINDOW", 20);
const ROLLING_STATS_RATE_BURST_TOKENS = positiveEnvNumber("FITTING_ROLLING_STATS_RATE_BURST_TOKENS", 40);
const rollingStatsRateBuckets = new Map();
const PRICE_MODE_LABELS = {
  sell_min: "sell_min",
  sell: "sell_min",
  sell_5pct: "sell_5pct",
  buy_max: "buy_max",
  buy: "buy_max",
  buy_5pct: "buy_5pct",
};

function cleanQuery(value) {
  return String(value || "").trim();
}

function parseTypeId(value) {
  const id = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function serviceError(res, err) {
  console.error("[fitting] fitting-service error", err?.body || err?.message || err);
  const status = err?.status && err.status >= 400 ? 502 : 500;
  return res.status(status).json({
    ok: false,
    error: "fitting_service_error",
    details: err?.body || { message: err?.message || "fitting-service request failed" },
  });
}

function finiteOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function priceFromRow(row, mode = DEFAULT_PRICE_MODE) {
  const sellMin = finiteOrNull(row?.sell_min);
  const sell5 = finiteOrNull(row?.sell_5pct);
  const buyMax = finiteOrNull(row?.buy_max);
  const buy5 = finiteOrNull(row?.buy_5pct);
  switch (mode) {
    case "buy":
    case "buy_max":
      return buyMax ?? buy5 ?? sellMin ?? sell5 ?? 0;
    case "buy_5pct":
      return buy5 ?? buyMax ?? sellMin ?? sell5 ?? 0;
    case "sell_5pct":
      return sell5 ?? sellMin ?? buyMax ?? buy5 ?? 0;
    case "sell":
    case "sell_min":
    default:
      return sellMin ?? sell5 ?? buyMax ?? buy5 ?? 0;
  }
}

function priceModeLabel(mode = DEFAULT_PRICE_MODE) {
  const station = DEFAULT_PRICE_STATION_ID === 60003760 ? "Jita 4-4" : `Station ${DEFAULT_PRICE_STATION_ID}`;
  return `${station} ${PRICE_MODE_LABELS[mode] || mode}`;
}

function addPriceLine(lines, category, typeId, quantity = 1) {
  const id = parseTypeId(typeId);
  const qty = Math.max(0, Number(quantity) || 0);
  if (!id || qty <= 0) return;
  lines.push({ category, typeId: id, quantity: qty });
}

function priceLinesFromPayload(payload = {}) {
  const lines = [];
  addPriceLine(lines, "ship", payload.shipTypeId, 1);

  for (const modules of Object.values(payload.modules || {})) {
    for (const module of modules || []) {
      addPriceLine(lines, "fittings", module?.typeId, 1);
      addPriceLine(lines, "fittings", module?.chargeTypeId, 1);
    }
  }

  for (const drone of payload.drones || []) {
    addPriceLine(lines, "drones", drone?.typeId, drone?.quantity || 1);
  }
  for (const fighter of payload.fighters || []) {
    addPriceLine(lines, "drones", fighter?.typeId, fighter?.quantity || 1);
  }
  for (const item of payload.cargo || []) {
    addPriceLine(lines, "cargo", item?.typeId, item?.quantity || 1);
  }
  for (const implant of payload.implants || []) {
    if (implant?.enabled === false) continue;
    addPriceLine(lines, "character", implant?.typeId, implant?.quantity || 1);
  }
  for (const booster of payload.boosters || []) {
    if (booster?.enabled === false) continue;
    addPriceLine(lines, "character", booster?.typeId, booster?.quantity || 1);
  }

  return lines;
}

async function estimateFitPrice(payload) {
  const lines = priceLinesFromPayload(payload);
  const categories = { ship: 0, fittings: 0, drones: 0, cargo: 0, character: 0 };
  const typeIds = Array.from(new Set(lines.map((line) => line.typeId)));
  const priceByType = new Map();

  if (typeIds.length) {
    const { rows } = await pool.query(
      `
      SELECT type_id, sell_min, buy_max, sell_5pct, buy_5pct
      FROM market_station_aggregates
      WHERE station_id = $1 AND type_id = ANY($2::int[])
      `,
      [DEFAULT_PRICE_STATION_ID, typeIds]
    );
    for (const row of rows) {
      priceByType.set(Number(row.type_id), priceFromRow(row));
    }
  }

  const missingTypeIds = [];
  for (const line of lines) {
    const unit = priceByType.get(line.typeId);
    if (unit == null) {
      missingTypeIds.push(line.typeId);
      continue;
    }
    categories[line.category] += unit * line.quantity;
  }

  const total = Object.values(categories).reduce((sum, value) => sum + value, 0);
  return {
    ...categories,
    total,
    mode: priceModeLabel(),
    stationId: DEFAULT_PRICE_STATION_ID,
    priceField: DEFAULT_PRICE_MODE,
    itemPrices: Object.fromEntries(Array.from(priceByType.entries()).map(([typeId, price]) => [String(typeId), price])),
    missingTypeIds: Array.from(new Set(missingTypeIds)),
  };
}

const DOGMA = {
  powergrid: 30,
  cpu: 50,
  capacitorNeed: 6,
  duration: 73,
  optimalRange: 54,
  falloff: 158,
  trackingSpeed: 160,
  chargeSize: 128,
  capacity: 38,
  implantness: 331,
  boosterness: 1087,
  fitsToShipType: 1380,
};

const dogmaSelect = `
  da.cpu AS "cpu",
  da.powergrid AS "powergrid",
  da."capacitorNeed" AS "capacitorNeed",
  da.duration AS "duration",
  da."optimalRange" AS "optimalRange",
  da.falloff AS "falloff",
  da."trackingSpeed" AS "trackingSpeed",
  da."chargeSize" AS "chargeSize",
  da.capacity AS "capacity",
  da.implantness AS "implantSlot",
  da.boosterness AS "boosterSlot",
  da."fitsToShipType" AS "fitsToShipTypeId"
`;

const dogmaJoin = `
  LEFT JOIN (
    SELECT
      "typeID",
      MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.cpu}) AS cpu,
      MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.powergrid}) AS powergrid,
      MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.capacitorNeed}) AS "capacitorNeed",
      MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.duration}) AS duration,
      MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.optimalRange}) AS "optimalRange",
      MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.falloff}) AS falloff,
      MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.trackingSpeed}) AS "trackingSpeed",
      MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.chargeSize}) AS "chargeSize",
      MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.capacity}) AS capacity,
      MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.implantness}) AS implantness,
      MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.boosterness}) AS boosterness,
      MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.fitsToShipType}) AS "fitsToShipType"
    FROM evesde."typeDogmaAttributes"
    WHERE "attributeID" IN (${Object.values(DOGMA).join(",")})
    GROUP BY "typeID"
  ) da ON da."typeID" = t."typeID"
`;

function rowWithFitting(row) {
  if (!row) return row;
  return {
    ...row,
    fitting: {
      cpu: row.cpu == null ? null : Number(row.cpu),
      powergrid: row.powergrid == null ? null : Number(row.powergrid),
      capacitorNeed: row.capacitorNeed == null ? null : Number(row.capacitorNeed),
      duration: row.duration == null ? null : Number(row.duration),
      optimalRange: row.optimalRange == null ? null : Number(row.optimalRange),
      falloff: row.falloff == null ? null : Number(row.falloff),
      trackingSpeed: row.trackingSpeed == null ? null : Number(row.trackingSpeed),
      chargeSize: row.chargeSize == null ? null : Number(row.chargeSize),
      capacity: row.capacity == null ? null : Number(row.capacity),
    },
    implantSlot: row.implantSlot == null ? null : Number(row.implantSlot),
    boosterSlot: row.boosterSlot == null ? null : Number(row.boosterSlot),
    fitsToShipTypeId: row.fitsToShipTypeId == null ? null : Number(row.fitsToShipTypeId),
  };
}

const MARKET_CATEGORIES = [
  { key: "ammo", label: "Ammunition & Charges", marketGroupId: 11 },
  { key: "deployables", label: "Deployable Structures", marketGroupId: 404 },
  { key: "drones", label: "Drones", marketGroupId: 157 },
  { key: "filaments", label: "Filaments", marketGroupId: 2456 },
  { key: "implants", label: "Implants & Boosters", marketGroupId: 24 },
  { key: "rigs", label: "Rigs", marketGroupId: 1111 },
  { key: "ship-equipment", label: "Ship Equipment", marketGroupId: 9 },
  { key: "structure-equipment", label: "Structure Equipment", marketGroupId: 2202 },
  { key: "structure-modifications", label: "Structure Modifications", marketGroupId: 2203 },
  { key: "subsystems", label: "Subsystems", marketGroupId: 1112 },
];

const SHIP_GROUP_ORDER = [
  "Assault Frigate",
  "Attack Battlecruiser",
  "Battleship",
  "Black Ops",
  "Blockade Runner",
  "Capital Industrial Ship",
  "Carrier",
  "Citadel",
  "Combat Battlecruiser",
  "Combat Recon Ship",
  "Command Destroyer",
  "Command Ship",
  "Corvette",
  "Covert Ops",
  "Cruiser",
  "Deep Space Transport",
  "Destroyer",
  "Dreadnought",
  "Electronic Attack Ship",
  "Engineering Complex",
  "Exhumer",
  "Expedition Frigate",
  "Flag Cruiser",
  "Force Auxiliary",
  "Force Recon Ship",
  "Freighter",
  "Frigate",
  "Hauler",
  "Heavy Assault Cruiser",
  "Heavy Interdiction Cruiser",
  "Industrial Command Ship",
  "Interceptor",
  "Interdictor",
  "Jump Freighter",
  "Lancer Dreadnought",
  "Limited Issue Ships",
  "Logistics",
  "Logistics Frigate",
  "Marauder",
  "Mining Barge",
  "Prototype Exploration Ship",
  "Refinery",
  "Shuttle",
  "Special Edition Yachts",
  "Stealth Bomber",
  "Strategic Cruiser",
  "Supercarrier",
  "Tactical Destroyer",
  "Titan",
  "Upwell Cyno Beacon",
  "Upwell Cyno Jammer",
  "Upwell Jump Gate",
];
const SHIP_GROUP_ORDER_INDEX = new Map(SHIP_GROUP_ORDER.map((name, index) => [name.toLowerCase(), index]));
const FALLBACK_SHIP_GROUPS = SHIP_GROUP_ORDER.map((name) => shipGroupCategory(name));
const FITTING_GUI_ICON_NAMES = new Set([
  "overheat",
  "firepower",
  "mining",
  "defense",
  "resources",
  "ship",
  "em",
  "thermal",
  "kinetic",
  "explosive",
]);

let savedFitsSchemaReady = false;
let savedFitsSchemaPromise = null;
let sharedFitsSchemaReady = false;
let sharedFitsSchemaPromise = null;

const SHARED_FIT_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SHARED_FIT_ID_LENGTH = 10;
const MAX_SHARED_EFT_BYTES = 1_000_000;

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function shipGroupCategory(groupName, groupId = null) {
  const label = String(groupName || "").trim();
  return {
    key: `ship-${slug(label) || "other"}`,
    label: label || "Other Ships",
    id: groupId == null ? null : Number(groupId),
    groupNames: label ? [label] : [],
    iconName: "ship",
  };
}

function compareShipCategories(a, b) {
  const aOrder = SHIP_GROUP_ORDER_INDEX.get(String(a.label || "").toLowerCase());
  const bOrder = SHIP_GROUP_ORDER_INDEX.get(String(b.label || "").toLowerCase());
  const aRank = aOrder == null ? 1000 : aOrder;
  const bRank = bOrder == null ? 1000 : bOrder;
  return aRank - bRank || String(a.label || "").localeCompare(String(b.label || ""));
}

async function shipBrowserCategories() {
  const { rows } = await pool.query(`
    SELECT
      MIN(g."groupID") AS "groupId",
      g."groupName" AS "groupName"
    FROM evesde."invTypes" t
    JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
    JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
    WHERE COALESCE(t."published", true) = true
      AND c."categoryName" = 'Ship'
    GROUP BY g."groupName"
  `);
  return rows
    .map((row) => shipGroupCategory(row.groupName, row.groupId))
    .sort(compareShipCategories);
}

async function ensureSavedFitsSchema() {
  if (savedFitsSchemaReady) return;
  if (!savedFitsSchemaPromise) {
    savedFitsSchemaPromise = (async () => {
      await siteAuth.ensureAuthSchema();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS fitting_saved_fits (
          id UUID PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES anoikis_command_users(id) ON DELETE CASCADE,
          fit_name TEXT NOT NULL,
          ship_type_id INTEGER NOT NULL,
          ship_name TEXT NOT NULL,
          fit_json JSONB NOT NULL,
          eft_text TEXT,
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_opened_at TIMESTAMPTZ
        );

        CREATE INDEX IF NOT EXISTS fitting_saved_fits_user_idx
          ON fitting_saved_fits(user_id);

        CREATE INDEX IF NOT EXISTS fitting_saved_fits_user_ship_idx
          ON fitting_saved_fits(user_id, ship_type_id);

        CREATE INDEX IF NOT EXISTS fitting_saved_fits_user_updated_idx
          ON fitting_saved_fits(user_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS fitting_saved_fit_groups (
          id UUID PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES anoikis_command_users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS fitting_saved_fit_groups_user_name_idx
          ON fitting_saved_fit_groups(user_id, lower(name));

        CREATE TABLE IF NOT EXISTS fitting_saved_fit_group_memberships (
          group_id UUID NOT NULL REFERENCES fitting_saved_fit_groups(id) ON DELETE CASCADE,
          fit_id UUID NOT NULL REFERENCES fitting_saved_fits(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (group_id, fit_id)
        );

        CREATE INDEX IF NOT EXISTS fitting_saved_fit_group_memberships_fit_idx
          ON fitting_saved_fit_group_memberships(fit_id);
      `);
      savedFitsSchemaReady = true;
    })().catch((err) => {
      savedFitsSchemaPromise = null;
      throw err;
    });
  }
  await savedFitsSchemaPromise;
}

function shipClassForGroupName(groupName) {
  return groupName || "Other Ships";
}

function savedFitRecord(row, includeFitJson = true) {
  const record = {
    id: String(row.id),
    fitName: row.fit_name,
    shipTypeId: Number(row.ship_type_id),
    shipName: row.ship_name,
    shipClass: shipClassForGroupName(row.group_name),
    groupName: row.group_name || null,
    eftText: row.eft_text || "",
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
  };
  if (includeFitJson) record.fitJson = row.fit_json;
  return record;
}

function validateSavedFitBody(body = {}) {
  const fitName = String(body.fitName || "").trim().slice(0, 160);
  const shipTypeId = parseTypeId(body.shipTypeId);
  const shipName = String(body.shipName || "").trim().slice(0, 160);
  const fitJson = body.fitJson && typeof body.fitJson === "object" ? body.fitJson : null;
  const eftText = typeof body.eftText === "string" ? body.eftText.slice(0, 1000000) : null;
  const notes = typeof body.notes === "string" ? body.notes.slice(0, 20000) : null;

  if (!fitName) return { error: "fit_name_required" };
  if (!shipTypeId) return { error: "ship_required" };
  if (!shipName) return { error: "ship_name_required" };
  if (!fitJson) return { error: "fit_json_required" };

  return { fitName, shipTypeId, shipName, fitJson, eftText, notes };
}

function validateSavedFitGroupBody(body = {}) {
  const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!name) return { error: "group_name_required" };
  return { name };
}

function requestIp(req) {
  const forwarded = String(req.get?.("x-forwarded-for") || "").split(",")[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || "unknown";
}

function readRollingStatsEft(body = {}) {
  return typeof body.eft === "string"
    ? body.eft
    : typeof body.eftText === "string"
      ? body.eftText
      : typeof body.text === "string"
        ? body.text
        : "";
}

function cleanupRollingStatsRateBuckets(now) {
  if (rollingStatsRateBuckets.size < 5000) return;
  for (const [key, bucket] of rollingStatsRateBuckets) {
    if (bucket.tokens >= ROLLING_STATS_RATE_BURST_TOKENS && now - bucket.updatedAt > 10 * ROLLING_STATS_RATE_WINDOW_MS) {
      rollingStatsRateBuckets.delete(key);
    }
  }
}

function checkRollingStatsRateLimit(principal, now = Date.now()) {
  const key = String(principal || "ip:unknown");
  const bucket = rollingStatsRateBuckets.get(key) || { tokens: ROLLING_STATS_RATE_BURST_TOKENS, updatedAt: now };
  const elapsedWindows = Math.max(0, (now - bucket.updatedAt) / ROLLING_STATS_RATE_WINDOW_MS);
  bucket.tokens = Math.min(
    ROLLING_STATS_RATE_BURST_TOKENS,
    bucket.tokens + elapsedWindows * ROLLING_STATS_RATE_TOKENS_PER_WINDOW
  );
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    rollingStatsRateBuckets.set(key, bucket);
    cleanupRollingStatsRateBuckets(now);
    return { ok: false, error: "rate_limited" };
  }

  bucket.tokens -= 1;
  rollingStatsRateBuckets.set(key, bucket);
  cleanupRollingStatsRateBuckets(now);
  return { ok: true };
}

async function savedFitGroupName(shipTypeId) {
  const { rows } = await pool.query(
    `SELECT g."groupName" AS group_name
     FROM evesde."invTypes" t
     LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
     WHERE t."typeID" = $1
     LIMIT 1`,
    [shipTypeId]
  );
  return rows[0]?.group_name || null;
}

async function attachSavedFitGroup(row) {
  if (!row) return null;
  return { ...row, group_name: await savedFitGroupName(Number(row.ship_type_id)) };
}

async function findSavedFitRowById(userId, id) {
  const { rows } = await pool.query(
    `SELECT *
     FROM fitting_saved_fits
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [id, userId]
  );
  return rows[0] || null;
}

async function findSavedFitRowByName(userId, shipTypeId, fitName) {
  const { rows } = await pool.query(
    `SELECT *
     FROM fitting_saved_fits
     WHERE user_id = $1
       AND ship_type_id = $2
       AND lower(fit_name) = lower($3)
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId, shipTypeId, fitName]
  );
  return rows[0] || null;
}

async function createSavedFitRow(userId, validation) {
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `
    INSERT INTO fitting_saved_fits (
      id, user_id, fit_name, ship_type_id, ship_name, fit_json, eft_text, notes
    )
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
    RETURNING *
    `,
    [
      id,
      userId,
      validation.fitName,
      validation.shipTypeId,
      validation.shipName,
      JSON.stringify(validation.fitJson),
      validation.eftText,
      validation.notes,
    ]
  );
  return attachSavedFitGroup(rows[0]);
}

async function updateSavedFitRow(id, userId, validation) {
  const { rows } = await pool.query(
    `
    UPDATE fitting_saved_fits
    SET
      fit_name = $3,
      ship_type_id = $4,
      ship_name = $5,
      fit_json = $6::jsonb,
      eft_text = $7,
      notes = $8,
      updated_at = now()
    WHERE id = $1 AND user_id = $2
    RETURNING *
    `,
    [
      id,
      userId,
      validation.fitName,
      validation.shipTypeId,
      validation.shipName,
      JSON.stringify(validation.fitJson),
      validation.eftText,
      validation.notes,
    ]
  );
  return attachSavedFitGroup(rows[0]);
}

async function ensureSharedFitsSchema() {
  if (sharedFitsSchemaReady) return;
  if (!sharedFitsSchemaPromise) {
    sharedFitsSchemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS fitting_shared_fits (
          id text PRIMARY KEY,
          content_hash text NOT NULL,
          eft_text text NOT NULL,
          fit_name text NOT NULL,
          ship_type_id integer NOT NULL,
          ship_name text NOT NULL,
          source text,
          source_url text,
          created_at timestamptz NOT NULL DEFAULT now(),
          last_opened_at timestamptz,
          access_count integer NOT NULL DEFAULT 0,
          version integer NOT NULL DEFAULT 1
        );

        ALTER TABLE fitting_shared_fits
          ADD COLUMN IF NOT EXISTS content_hash text,
          ADD COLUMN IF NOT EXISTS eft_text text,
          ADD COLUMN IF NOT EXISTS fit_name text,
          ADD COLUMN IF NOT EXISTS ship_type_id integer,
          ADD COLUMN IF NOT EXISTS ship_name text,
          ADD COLUMN IF NOT EXISTS source text,
          ADD COLUMN IF NOT EXISTS source_url text,
          ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
          ADD COLUMN IF NOT EXISTS last_opened_at timestamptz,
          ADD COLUMN IF NOT EXISTS access_count integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

        CREATE UNIQUE INDEX IF NOT EXISTS fitting_shared_fits_content_hash_idx
          ON fitting_shared_fits(content_hash);

        CREATE INDEX IF NOT EXISTS fitting_shared_fits_created_idx
          ON fitting_shared_fits(created_at DESC);
      `);
      sharedFitsSchemaReady = true;
    })().catch((err) => {
      sharedFitsSchemaPromise = null;
      throw err;
    });
  }
  await sharedFitsSchemaPromise;
}

function sharedFitIdFromValue(value) {
  const id = String(value || "").trim().toUpperCase();
  return /^[A-HJ-NP-Z2-9]{6,24}$/.test(id) ? id : null;
}

function generateSharedFitId() {
  const bytes = crypto.randomBytes(SHARED_FIT_ID_LENGTH);
  let id = "";
  for (const byte of bytes) {
    id += SHARED_FIT_ID_ALPHABET[byte % SHARED_FIT_ID_ALPHABET.length];
  }
  return id;
}

function sharedEftCandidate(value) {
  if (value && typeof value === "object" && typeof value.value === "string") return value.value;
  return value;
}

function normalizeSharedEftText(value) {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return { error: "eft_text_required", message: "Provide EFT text in eftText, text, or eft." };
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_SHARED_EFT_BYTES) {
    return {
      error: "eft_text_too_large",
      message: `EFT text must be ${MAX_SHARED_EFT_BYTES.toLocaleString()} bytes or smaller.`,
    };
  }
  return { text };
}

function sharedEftTextFromBody(body = {}) {
  if (typeof body === "string") return normalizeSharedEftText(body);
  return normalizeSharedEftText(sharedEftCandidate(body.eftText ?? body.text ?? body.eft));
}

function optionalText(value, maxLength) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function sharedFitContentHash(eftText) {
  return crypto.createHash("sha256").update(eftText, "utf8").digest("hex");
}

function requestBaseUrl(req) {
  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host");
  return host ? `${proto}://${host}` : null;
}

function publicBaseUrl(req) {
  return String(process.env.TRIFFFITS_PUBLIC_BASE_URL || requestBaseUrl(req) || process.env.PUBLIC_BASE_URL || "https://triff.tools")
    .replace(/\/+$/, "");
}

function sharedFitResponse(row, req, extra = {}) {
  const id = String(row.id);
  const path = `/fitting/fit/${id}`;
  return {
    ok: true,
    id,
    path,
    url: `${publicBaseUrl(req)}${path}`,
    fitName: row.fit_name,
    shipTypeId: Number(row.ship_type_id),
    shipName: row.ship_name,
    source: row.source || null,
    sourceUrl: row.source_url || null,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at || null,
    accessCount: Number(row.access_count || 0),
    version: Number(row.version || 1),
    ...extra,
  };
}

function sharedFitMetadataResponse(row, req, extra = {}) {
  return sharedFitResponse(row, req, extra);
}

async function savedFitRowsForUser(userId, includeFitJson = false) {
  const { rows } = await pool.query(
    `
    SELECT
      f.*,
      g."groupName" AS group_name
    FROM fitting_saved_fits f
    LEFT JOIN evesde."invTypes" t ON t."typeID" = f.ship_type_id
    LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
    WHERE f.user_id = $1
    ORDER BY g."groupName" NULLS LAST, f.ship_name ASC, lower(f.fit_name) ASC
    `,
    [userId]
  );
  return rows.map((row) => savedFitRecord(row, includeFitJson));
}

async function customSavedFitGroupsForUser(userId) {
  const [{ rows: groupRows }, { rows: membershipRows }] = await Promise.all([
    pool.query(
      `SELECT id, name, created_at, updated_at
       FROM fitting_saved_fit_groups
       WHERE user_id = $1
       ORDER BY lower(name), created_at`,
      [userId]
    ),
    pool.query(
      `SELECT
         m.group_id,
         f.*,
         g."groupName" AS group_name
       FROM fitting_saved_fit_group_memberships m
       JOIN fitting_saved_fit_groups custom_group ON custom_group.id = m.group_id
       JOIN fitting_saved_fits f ON f.id = m.fit_id
       LEFT JOIN evesde."invTypes" t ON t."typeID" = f.ship_type_id
       LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
       WHERE custom_group.user_id = $1
         AND f.user_id = $1
       ORDER BY lower(f.fit_name), f.ship_name`,
      [userId]
    ),
  ]);
  const fitsByGroup = new Map();
  for (const row of membershipRows) {
    const key = String(row.group_id);
    const fits = fitsByGroup.get(key) || [];
    fits.push(savedFitRecord(row, false));
    fitsByGroup.set(key, fits);
  }
  return groupRows.map((row) => ({
    id: String(row.id),
    key: `custom-${row.id}`,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fits: fitsByGroup.get(String(row.id)) || [],
  }));
}

async function optionalSiteUser(req) {
  try {
    const session = await siteAuth.getSessionUser(req);
    return session?.user || null;
  } catch {
    return null;
  }
}

async function attachSkillProfile(fitPayload, user, warnings) {
  if (!fitPayload || typeof fitPayload !== "object") return fitPayload;
  const resolved = await fittingEsi.skillProfileForUser(user?.id || null, fitPayload.skillProfile || { mode: "all_v" });
  const { warning, ...skillProfile } = resolved;
  if (warning) warnings.push({ code: "skill_profile_fallback", message: warning });
  return {
    ...fitPayload,
    skillProfile,
  };
}

async function calculationPayloadWithSkills(req, bodyOverride) {
  const user = await optionalSiteUser(req);
  const warnings = [];
  const body = bodyOverride || req.body || {};

  if (body.targetFit && typeof body.targetFit === "object") {
    const sourceFits = [];
    for (const source of body.sourceFits || []) {
      sourceFits.push({
        ...source,
        fitState: await attachSkillProfile(source.fitState || {}, user, warnings),
      });
    }
    const graphTargets = [];
    for (const target of body.graphTargets || []) {
      if (target?.kind === "open_fit" && target.fitState && typeof target.fitState === "object") {
        graphTargets.push({
          ...target,
          fitState: await attachSkillProfile(target.fitState || {}, user, warnings),
        });
      } else {
        graphTargets.push(target);
      }
    }
    return {
      payload: {
        ...body,
        targetFit: await attachSkillProfile(body.targetFit, user, warnings),
        sourceFits,
        graphTargets,
      },
      warnings,
    };
  }

  return {
    payload: await attachSkillProfile(body, user, warnings),
    warnings,
  };
}

function savedFitTree(records) {
  const groups = new Map();
  for (const fit of records) {
    const classLabel = fit.shipClass || "Other Ships";
    const classKey = slug(classLabel) || "other";
    if (!groups.has(classKey)) {
      groups.set(classKey, { key: classKey, shipClass: classLabel, children: [] });
    }
    const group = groups.get(classKey);
    let ship = group.children.find((entry) => entry.shipTypeId === fit.shipTypeId);
    if (!ship) {
      ship = {
        key: `ship-${fit.shipTypeId}`,
        shipTypeId: fit.shipTypeId,
        shipName: fit.shipName,
        groupName: fit.groupName,
        fits: [],
      };
      group.children.push(ship);
    }
    ship.fits.push({
      id: fit.id,
      fitName: fit.fitName,
      updatedAt: fit.updatedAt,
      lastOpenedAt: fit.lastOpenedAt,
    });
  }
  for (const group of groups.values()) {
    group.children.sort((a, b) => a.shipName.localeCompare(b.shipName));
    for (const ship of group.children) {
      ship.fits.sort((a, b) => a.fitName.localeCompare(b.fitName));
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.shipClass.localeCompare(b.shipClass));
}

function typeColumns() {
  return `
    t."typeID" AS "typeId",
    t."typeName" AS "typeName",
    t."groupID" AS "groupId",
    g."groupName" AS "groupName",
    g."categoryID" AS "categoryId",
    c."categoryName" AS "categoryName",
    t."marketGroupID" AS "marketGroupId",
    mkt."marketGroupName" AS "marketGroupName",
    t."published" AS "published",
    mt."parentTypeID" AS "parentTypeId",
    mt."metaGroupID" AS "metaGroupId",
    mg."metaGroupName" AS "metaGroupName",
    ${dogmaSelect}
  `;
}

function categoryFor(list, key) {
  return list.find((item) => item.key === key) || null;
}

function directMarketGroupId(req) {
  return parseTypeId(req.query.marketGroupId || req.query.groupId || req.query.market_group_id);
}

function marketNode(row) {
  return {
    id: Number(row.marketGroupID),
    key: `market:${row.marketGroupID}`,
    label: row.marketGroupName,
    parentId: row.parentGroupID == null ? null : Number(row.parentGroupID),
    marketGroupId: Number(row.marketGroupID),
    iconId: row.iconID == null ? null : Number(row.iconID),
    hasChildren: false,
    hasItems: Boolean(row.hasDirectItems),
    children: [],
  };
}

async function marketCategoriesWithTree() {
  const rootIds = MARKET_CATEGORIES.map((category) => category.marketGroupId).filter(Boolean);
  if (!rootIds.length) return MARKET_CATEGORIES;

  const { rows } = await pool.query(
    `
    WITH RECURSIVE market_tree AS (
      SELECT
        mg."marketGroupID",
        mg."parentGroupID",
        mg."marketGroupName",
        mg."hasTypes",
        mg."iconID"
      FROM evesde."invMarketGroups" mg
      WHERE mg."marketGroupID" = ANY($1::int[])
      UNION ALL
      SELECT
        child."marketGroupID",
        child."parentGroupID",
        child."marketGroupName",
        child."hasTypes",
        child."iconID"
      FROM evesde."invMarketGroups" child
      JOIN market_tree parent ON child."parentGroupID" = parent."marketGroupID"
    ),
    direct_items AS (
      SELECT DISTINCT t."marketGroupID"
      FROM evesde."invTypes" t
      WHERE COALESCE(t."published", true) = true
        AND t."marketGroupID" IS NOT NULL
    )
    SELECT
      mt."marketGroupID" AS "marketGroupID",
      mt."parentGroupID" AS "parentGroupID",
      mt."marketGroupName" AS "marketGroupName",
      mt."hasTypes" AS "hasTypes",
      mt."iconID" AS "iconID",
      (di."marketGroupID" IS NOT NULL) AS "hasDirectItems"
    FROM market_tree mt
    LEFT JOIN direct_items di ON di."marketGroupID" = mt."marketGroupID"
    ORDER BY mt."parentGroupID" NULLS FIRST, mt."marketGroupName" ASC
    `,
    [rootIds]
  );

  const byId = new Map(rows.map((row) => [Number(row.marketGroupID), marketNode(row)]));
  for (const node of byId.values()) {
    if (node.parentId != null && byId.has(node.parentId)) {
      byId.get(node.parentId).children.push(node);
    }
  }

  for (const node of byId.values()) {
    node.children.sort((a, b) => a.label.localeCompare(b.label));
    node.hasChildren = node.children.length > 0;
  }

  return MARKET_CATEGORIES.map((category) => {
    if (!category.marketGroupId) {
      return {
        ...category,
        hasChildren: false,
        hasItems: false,
        children: [],
      };
    }
    const root = byId.get(Number(category.marketGroupId));
    return {
      ...category,
      id: category.marketGroupId,
      key: category.key,
      parentId: null,
      iconId: root?.iconId ?? null,
      hasChildren: Boolean(root?.children?.length),
      hasItems: Boolean(root?.hasItems),
      children: root?.children || [],
    };
  });
}

router.post("/shared-fits", async (req, res) => {
  try {
    await ensureSharedFitsSchema();

    const input = sharedEftTextFromBody(req.body || {});
    if (input.error) {
      return res.status(input.error === "eft_text_too_large" ? 413 : 400).json({
        ok: false,
        error: input.error,
        message: input.message,
      });
    }

    const eftText = input.text;
    const imported = await fittingClient.importEft(eftText);
    if (!imported?.ok || !imported.payload?.shipTypeId) {
      return res.status(400).json({
        ok: false,
        error: "invalid_eft",
        message: "The EFT fit could not be imported by TriffFits.",
        warnings: imported?.warnings || [],
        errors: imported?.errors || [{ code: "import_failed", message: "The fitting engine could not import this EFT text." }],
      });
    }

    const contentHash = sharedFitContentHash(eftText);
    const source = optionalText(req.body?.source, 80);
    const sourceUrl = optionalText(req.body?.sourceUrl || req.body?.source_url, 500);
    const payload = imported.payload;
    const fitName = optionalText(payload.fitName, 160) || "Imported Fit";
    const shipName = optionalText(payload.shipTypeName, 160) || `Type ${payload.shipTypeId}`;

    const existing = await pool.query(
      `
      SELECT *
      FROM fitting_shared_fits
      WHERE content_hash = $1
      LIMIT 1
      `,
      [contentHash]
    );
    if (existing.rows[0]) {
      return res.json(sharedFitResponse(existing.rows[0], req, {
        duplicate: true,
        warnings: imported.warnings || [],
        errors: imported.errors || [],
      }));
    }

    let inserted = null;
    for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
      const id = generateSharedFitId();
      try {
        const { rows } = await pool.query(
          `
          INSERT INTO fitting_shared_fits (
            id, content_hash, eft_text, fit_name, ship_type_id, ship_name, source, source_url
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          RETURNING *
          `,
          [id, contentHash, eftText, fitName, payload.shipTypeId, shipName, source, sourceUrl]
        );
        inserted = rows[0];
      } catch (err) {
        if (err?.code === "23505") {
          const { rows } = await pool.query(
            `
            SELECT *
            FROM fitting_shared_fits
            WHERE content_hash = $1
            LIMIT 1
            `,
            [contentHash]
          );
          if (rows[0]) {
            inserted = rows[0];
            break;
          }
          continue;
        }
        throw err;
      }
    }

    if (!inserted) {
      return res.status(500).json({
        ok: false,
        error: "share_id_generation_failed",
        message: "Could not create a unique share link. Please try again.",
      });
    }

    return res.status(201).json(sharedFitResponse(inserted, req, {
      duplicate: false,
      warnings: imported.warnings || [],
      errors: imported.errors || [],
    }));
  } catch (err) {
    return serviceError(res, err);
  }
});

router.get("/shared-fits/:id", async (req, res) => {
  const id = sharedFitIdFromValue(req.params.id);
  if (!id) {
    return res.status(400).json({ ok: false, error: "invalid_share_id", message: "Invalid shared fit id." });
  }

  try {
    await ensureSharedFitsSchema();
    const { rows } = await pool.query(
      `
      SELECT *
      FROM fitting_shared_fits
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );
    if (!rows[0]) {
      return res.status(404).json({ ok: false, error: "shared_fit_not_found", message: "Shared fit not found." });
    }
    return res.json(sharedFitMetadataResponse(rows[0], req));
  } catch (err) {
    return serviceError(res, err);
  }
});

router.get("/shared-fits/:id/import", async (req, res) => {
  const id = sharedFitIdFromValue(req.params.id);
  if (!id) {
    return res.status(400).json({ ok: false, error: "invalid_share_id", message: "Invalid shared fit id." });
  }

  try {
    await ensureSharedFitsSchema();
    const { rows } = await pool.query(
      `
      UPDATE fitting_shared_fits
      SET access_count = access_count + 1,
          last_opened_at = now()
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ ok: false, error: "shared_fit_not_found", message: "Shared fit not found." });
    }

    const imported = await fittingClient.importEft(row.eft_text);
    const status = imported?.ok ? 200 : 422;
    return res.status(status).json({
      ...(imported || { ok: false, error: "import_failed" }),
      sharedFit: sharedFitMetadataResponse(row, req),
    });
  } catch (err) {
    return serviceError(res, err);
  }
});

router.get("/health", async (_req, res) => {
  try {
    const service = await fittingClient.getHealth();
    return res.json({ ok: true, backend: "healthy", service });
  } catch (err) {
    return serviceError(res, err);
  }
});

router.get("/search", async (req, res) => {
  const query = cleanQuery(req.query.query || req.query.q);
  if (query.length < 2) {
    return res.json({ ok: true, results: [] });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        t."typeID" AS "typeId",
        t."typeName" AS "typeName",
        t."groupID" AS "groupId",
        g."groupName" AS "groupName",
        g."categoryID" AS "categoryId",
        c."categoryName" AS "categoryName",
        t."marketGroupID" AS "marketGroupId",
        mkt."marketGroupName" AS "marketGroupName",
        t."published" AS "published"
      FROM evesde."invTypes" t
      LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
      LEFT JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
      LEFT JOIN evesde."invMarketGroups" mkt ON mkt."marketGroupID" = t."marketGroupID"
      WHERE COALESCE(t."published", true) = true
        AND t."typeName" ILIKE $1
        AND (
          c."categoryName" IN ('Ship', 'Module', 'Subsystem', 'Charge', 'Drone', 'Fighter', 'Implant')
          OR g."groupName" ILIKE '%Booster%'
        )
      ORDER BY
        CASE WHEN lower(t."typeName") = lower($2) THEN 0 ELSE 1 END,
        CASE c."categoryName"
          WHEN 'Ship' THEN 0
          WHEN 'Module' THEN 1
          WHEN 'Subsystem' THEN 2
          WHEN 'Drone' THEN 3
          WHEN 'Charge' THEN 4
          ELSE 5
        END,
        t."typeName" ASC
      LIMIT 80
      `,
      [`%${query}%`, query]
    );

    return res.json({ ok: true, results: rows });
  } catch (err) {
    console.error("[fitting/search] error", err);
    return res.status(500).json({ ok: false, error: "search_failed" });
  }
});

router.get("/browser/market", async (req, res) => {
  const query = cleanQuery(req.query.query || req.query.q);
  const category = categoryFor(MARKET_CATEGORIES, cleanQuery(req.query.category));
  const selectedMarketGroupId = directMarketGroupId(req) || category?.marketGroupId || null;

  const params = [];
  const filters = ['COALESCE(t."published", true) = true'];
  let marketScopeCte = "";

  try {
    const categories = await marketCategoriesWithTree();

    if (!category && !query && !selectedMarketGroupId) {
      return res.json({ ok: true, categories, results: [] });
    }
    if (category?.placeholder && !query) {
      return res.json({ ok: true, categories, results: [] });
    }

    if (selectedMarketGroupId) {
      params.push(selectedMarketGroupId);
      const scopeParam = params.length;
      marketScopeCte = `
        WITH RECURSIVE market_scope AS (
          SELECT mg."marketGroupID"
          FROM evesde."invMarketGroups" mg
          WHERE mg."marketGroupID" = $${scopeParam}
          UNION ALL
          SELECT child."marketGroupID"
          FROM evesde."invMarketGroups" child
          JOIN market_scope parent ON child."parentGroupID" = parent."marketGroupID"
        )
      `;
      filters.push(`t."marketGroupID" IN (SELECT "marketGroupID" FROM market_scope)`);
    }

    if (query || (!selectedMarketGroupId && !category)) {
      filters.push(`(
        c."categoryName" IN ('Module', 'Subsystem', 'Charge', 'Drone', 'Fighter', 'Implant')
        OR g."groupName" ILIKE '%Booster%'
      )`);
    }

    if (query) {
      params.push(`%${query}%`);
      filters.push(`t."typeName" ILIKE $${params.length}`);
    }

    const sql = `
      ${marketScopeCte}
      SELECT ${typeColumns()}
      FROM evesde."invTypes" t
      LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
      LEFT JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
      LEFT JOIN evesde."invMetaTypes" mt ON mt."typeID" = t."typeID"
      LEFT JOIN evesde."invMetaGroups" mg ON mg."metaGroupID" = mt."metaGroupID"
      LEFT JOIN evesde."invMarketGroups" mkt ON mkt."marketGroupID" = t."marketGroupID"
      ${dogmaJoin}
      WHERE ${filters.map((filter) => `(${filter})`).join(" AND ")}
      ORDER BY
        CASE WHEN lower(t."typeName") = lower($${params.length + 1}) THEN 0 ELSE 1 END,
        c."categoryName" ASC,
        g."groupName" ASC,
        t."typeName" ASC
      LIMIT 160
    `;
    params.push(query);
    const { rows } = await pool.query(sql, params);
    return res.json({ ok: true, categories, results: rows.map(rowWithFitting) });
  } catch (err) {
    console.error("[fitting/browser/market] error", err);
    return res.status(500).json({ ok: false, error: "market_browser_failed", categories: MARKET_CATEGORIES, results: [] });
  }
});

router.get("/browser/market/tree", async (_req, res) => {
  try {
    return res.json({ ok: true, categories: await marketCategoriesWithTree() });
  } catch (err) {
    console.error("[fitting/browser/market/tree] error", err);
    return res.status(500).json({ ok: false, error: "market_tree_failed", categories: MARKET_CATEGORIES });
  }
});

router.get("/browser/market/icon/:iconId", async (req, res) => {
  const iconId = parseTypeId(req.params.iconId);
  if (!iconId) {
    return res.status(404).json({ ok: false, error: "icon_not_found" });
  }
  try {
    const icon = await fittingClient.getIcon(iconId);
    res.setHeader("Content-Type", icon.contentType || "image/png");
    res.setHeader("Cache-Control", icon.cacheControl || "public, max-age=604800, immutable");
    return res.send(icon.buffer);
  } catch (err) {
    if (err?.status === 404) {
      return res.status(404).json({ ok: false, error: "icon_not_found" });
    }
    return serviceError(res, err);
  }
});

router.get("/browser/gui-icon/:iconName", async (req, res) => {
  const iconName = String(req.params.iconName || "").trim();
  if (!FITTING_GUI_ICON_NAMES.has(iconName)) {
    return res.status(404).json({ ok: false, error: "icon_not_found" });
  }
  try {
    const icon = await fittingClient.getGuiIcon(iconName);
    res.setHeader("Content-Type", icon.contentType || "image/png");
    res.setHeader("Cache-Control", icon.cacheControl || "public, max-age=604800, immutable");
    return res.send(icon.buffer);
  } catch (err) {
    if (err?.status === 404) {
      return res.status(404).json({ ok: false, error: "icon_not_found" });
    }
    return serviceError(res, err);
  }
});

router.get("/browser/ships", async (req, res) => {
  const query = cleanQuery(req.query.query || req.query.q);
  let categories = FALLBACK_SHIP_GROUPS;
  try {
    categories = await shipBrowserCategories();
  } catch (err) {
    console.error("[fitting/browser/ships/categories] error", err);
  }
  const group = categoryFor(categories, cleanQuery(req.query.group));
  if (!group && !query) {
    return res.json({ ok: true, categories, results: [] });
  }

  const params = [];
  const filters = ['COALESCE(t."published", true) = true', `c."categoryName" = 'Ship'`];
  if (group?.groupNames?.length) {
    params.push(group.groupNames);
    filters.push(`g."groupName" = ANY($${params.length}::text[])`);
  }
  if (query) {
    params.push(`%${query}%`);
    filters.push(`t."typeName" ILIKE $${params.length}`);
  }

  try {
    const sql = `
      SELECT ${typeColumns()}
      FROM evesde."invTypes" t
      LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
      LEFT JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
      LEFT JOIN evesde."invMetaTypes" mt ON mt."typeID" = t."typeID"
      LEFT JOIN evesde."invMetaGroups" mg ON mg."metaGroupID" = mt."metaGroupID"
      LEFT JOIN evesde."invMarketGroups" mkt ON mkt."marketGroupID" = t."marketGroupID"
      ${dogmaJoin}
      WHERE ${filters.map((filter) => `(${filter})`).join(" AND ")}
      ORDER BY
        CASE WHEN lower(t."typeName") = lower($${params.length + 1}) THEN 0 ELSE 1 END,
        g."groupName" ASC,
        t."typeName" ASC
      LIMIT 180
    `;
    params.push(query);
    const { rows } = await pool.query(sql, params);
    return res.json({ ok: true, categories, results: rows.map(rowWithFitting) });
  } catch (err) {
    console.error("[fitting/browser/ships] error", err);
    return res.status(500).json({ ok: false, error: "ship_browser_failed", categories, results: [] });
  }
});

router.get("/type/:typeId", async (req, res) => {
  const typeId = parseTypeId(req.params.typeId);
  if (!typeId) {
    return res.status(400).json({ ok: false, error: "invalid_type_id" });
  }

  try {
    const [dbResult, serviceResult] = await Promise.all([
      pool.query(
        `
        SELECT
          ${typeColumns()},
          t."volume" AS "volume"
        FROM evesde."invTypes" t
        LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
        LEFT JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
        LEFT JOIN evesde."invMetaTypes" mt ON mt."typeID" = t."typeID"
        LEFT JOIN evesde."invMetaGroups" mg ON mg."metaGroupID" = mt."metaGroupID"
        LEFT JOIN evesde."invMarketGroups" mkt ON mkt."marketGroupID" = t."marketGroupID"
        ${dogmaJoin}
        WHERE t."typeID" = $1
        LIMIT 1
        `,
        [typeId]
      ),
      fittingClient.getType(typeId),
    ]);

    const dbType = dbResult.rows[0] || null;
    const pyfaType = serviceResult?.type || null;
    if (!dbType && !pyfaType) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    return res.json({
      ok: true,
      type: {
        ...(dbType ? rowWithFitting(dbType) : {}),
        ...(pyfaType || {}),
      },
      source: {
        db: !!dbType,
        pyfa: !!pyfaType,
      },
      errors: serviceResult?.errors || [],
    });
  } catch (err) {
    return serviceError(res, err);
  }
});

router.get("/variants/:typeId", async (req, res) => {
  const typeId = parseTypeId(req.params.typeId);
  if (!typeId) {
    return res.status(400).json({ ok: false, error: "invalid_type_id", variants: [] });
  }

  try {
    const serviceVariants = await fittingClient.getVariants(typeId).catch(() => null);
    if (serviceVariants?.variants?.length) {
      return res.json(serviceVariants);
    }

    const { rows } = await pool.query(
      `
      WITH target AS (
        SELECT
          t."typeID",
          t."groupID",
          COALESCE(mt."parentTypeID", t."typeID") AS "familyTypeID"
        FROM evesde."invTypes" t
        LEFT JOIN evesde."invMetaTypes" mt ON mt."typeID" = t."typeID"
        WHERE t."typeID" = $1
        LIMIT 1
      ),
      candidate_ids AS (
        SELECT "familyTypeID" AS "typeID" FROM target
        UNION
        SELECT mt."typeID"
        FROM evesde."invMetaTypes" mt
        JOIN target ON mt."parentTypeID" = target."familyTypeID"
      )
      SELECT ${typeColumns()}
      FROM candidate_ids ci
      JOIN evesde."invTypes" t ON t."typeID" = ci."typeID"
      LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
      LEFT JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
      LEFT JOIN evesde."invMetaTypes" mt ON mt."typeID" = t."typeID"
      LEFT JOIN evesde."invMetaGroups" mg ON mg."metaGroupID" = mt."metaGroupID"
      LEFT JOIN evesde."invMarketGroups" mkt ON mkt."marketGroupID" = t."marketGroupID"
      ${dogmaJoin}
      WHERE COALESCE(t."published", true) = true
      ORDER BY
        CASE
          WHEN mg."metaGroupName" IS NULL THEN 0
          WHEN mg."metaGroupName" = 'Tech I' AND mt."parentTypeID" IS NULL THEN 0
          WHEN mg."metaGroupName" = 'Tech I' THEN 1
          WHEN mg."metaGroupName" = 'Tech II' THEN 2
          WHEN mg."metaGroupName" = 'Storyline' THEN 3
          WHEN mg."metaGroupName" = 'Faction' THEN 4
          WHEN mg."metaGroupName" = 'Deadspace' THEN 5
          WHEN mg."metaGroupName" = 'Officer' THEN 6
          ELSE 7
        END,
        t."typeName" ASC
      LIMIT 120
      `,
      [typeId]
    );
    return res.json({ ok: true, variants: rows.map(rowWithFitting) });
  } catch (err) {
    console.error("[fitting/variants] error", err);
    return res.status(500).json({ ok: false, error: "variants_failed", variants: [] });
  }
});

router.get("/implant-sets", async (_req, res) => {
  try {
    const result = await fittingClient.getImplantSets();
    return res.json(result);
  } catch (err) {
    return serviceError(res, err);
  }
});

router.get("/charges/:typeId", async (req, res) => {
  const typeId = parseTypeId(req.params.typeId);
  if (!typeId) {
    return res.status(400).json({ ok: false, error: "invalid_type_id", charges: [] });
  }

  try {
    const result = await fittingClient.getCharges(typeId);
    return res.json(result);
  } catch (err) {
    return serviceError(res, err);
  }
});

router.get("/mutaplasmids/:typeId", async (req, res) => {
  const typeId = parseTypeId(req.params.typeId);
  if (!typeId) {
    return res.status(400).json({ ok: false, error: "invalid_type_id", mutaplasmids: [] });
  }

  try {
    const result = await fittingClient.getMutaplasmids(typeId);
    return res.json(result);
  } catch (err) {
    return serviceError(res, err);
  }
});

router.get("/environment-effects", async (_req, res) => {
  try {
    const result = await fittingClient.getEnvironmentEffects();
    return res.json(result);
  } catch (err) {
    return serviceError(res, err);
  }
});

router.get("/damage-profiles", async (_req, res) => {
  try {
    const result = await fittingClient.getDamageProfiles();
    return res.json(result);
  } catch (err) {
    return serviceError(res, err);
  }
});

router.get("/graphs", async (_req, res) => {
  try {
    const result = await fittingClient.getGraphs();
    return res.json(result);
  } catch (err) {
    return serviceError(res, err);
  }
});

router.post("/graphs/calculate", async (req, res) => {
  try {
    const prepared = await calculationPayloadWithSkills(req);
    const result = await fittingClient.calculateGraph(prepared.payload || {});
    if (prepared.warnings.length) {
      result.warnings = [...prepared.warnings, ...(result.warnings || [])];
    }
    return res.json(result);
  } catch (err) {
    return serviceError(res, err);
  }
});

router.get("/esi/login", siteAuth.requireAuth, async (req, res) => {
  try {
    const url = await fittingEsi.createLoginUrl(req.siteUser.id);
    return res.redirect(url);
  } catch (err) {
    console.error("[fitting/esi/login] error", err.message);
    return res.status(503).send(fittingEsi.callbackHtml({
      ok: false,
      message: "EVE SSO is not configured for this triff.tools instance.",
    }));
  }
});

router.get("/esi/login-url", siteAuth.requireAuth, async (req, res) => {
  try {
    const url = await fittingEsi.createLoginUrl(req.siteUser.id);
    return res.json({ ok: true, url });
  } catch (err) {
    console.error("[fitting/esi/login-url] error", err.message);
    return res.status(503).json({
      ok: false,
      error: "esi_not_configured",
      message: "EVE SSO is not configured for this triff.tools instance.",
    });
  }
});

router.get("/esi/callback", async (req, res) => {
  try {
    if (req.query.error) {
      const stateRecord = req.query.state
        ? await fittingEsi.consumeOAuthState(String(req.query.state)).catch(() => null)
        : null;
      return res.status(400).send(fittingEsi.callbackHtml({
        ok: false,
        message: req.query.error_description || req.query.error || "EVE SSO authorization was cancelled.",
        returnTo: stateRecord?.returnTo,
      }));
    }
    const linked = await fittingEsi.linkCharacterFromCode(String(req.query.state || ""), String(req.query.code || ""));
    return res.send(fittingEsi.callbackHtml({
      ok: true,
      message: `Linked EVE character ${linked.characterName}. You can close this tab.`,
      characterId: linked.characterId,
      characterName: linked.characterName,
      returnTo: linked.returnTo,
    }));
  } catch (err) {
    console.error("[fitting/esi/callback] error", err.message);
    return res.status(400).send(fittingEsi.callbackHtml({
      ok: false,
      message: "Could not link this EVE character. Return to /fitting and try again.",
      returnTo: err?.returnTo,
    }));
  }
});

router.get("/esi/characters", siteAuth.requireAuth, async (req, res) => {
  try {
    const characters = await fittingEsi.listCharacters(req.siteUser.id);
    return res.json({
      ok: true,
      configured: fittingEsi.configStatus().ok,
      configMissing: fittingEsi.configStatus().missing,
      scope: fittingEsi.REQUIRED_SCOPE,
      characters,
    });
  } catch (err) {
    console.error("[fitting/esi/characters] error", err);
    return res.status(500).json({ ok: false, error: "esi_characters_failed", characters: [] });
  }
});

router.post("/esi/characters/:characterId/refresh-skills", siteAuth.requireAuth, async (req, res) => {
  const characterId = Number(req.params.characterId);
  if (!Number.isFinite(characterId) || characterId <= 0) {
    return res.status(400).json({ ok: false, error: "invalid_character_id" });
  }
  try {
    const character = await fittingEsi.refreshCharacterSkills(req.siteUser.id, characterId, { force: true });
    return res.json({ ok: true, character });
  } catch (err) {
    console.error("[fitting/esi/refresh] error", err.message);
    const status = err.status === 404 ? 404 : 503;
    return res.status(status).json({ ok: false, error: err.message || "esi_refresh_failed" });
  }
});

router.delete("/esi/characters/:characterId", siteAuth.requireAuth, async (req, res) => {
  const characterId = Number(req.params.characterId);
  if (!Number.isFinite(characterId) || characterId <= 0) {
    return res.status(400).json({ ok: false, error: "invalid_character_id" });
  }
  try {
    const removed = await fittingEsi.unlinkCharacter(req.siteUser.id, characterId);
    if (!removed) return res.status(404).json({ ok: false, error: "character_not_found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[fitting/esi/unlink] error", err);
    return res.status(500).json({ ok: false, error: "esi_unlink_failed" });
  }
});

router.get("/saved-fits", siteAuth.requireAuth, async (req, res) => {
  try {
    await ensureSavedFitsSchema();
    const fits = await savedFitRowsForUser(req.siteUser.id, false);
    return res.json({ ok: true, fits });
  } catch (err) {
    console.error("[fitting/saved-fits] list error", err);
    return res.status(500).json({ ok: false, error: "saved_fits_failed", fits: [] });
  }
});

router.get("/saved-fits/tree", siteAuth.requireAuth, async (req, res) => {
  try {
    await ensureSavedFitsSchema();
    const [fits, customGroups] = await Promise.all([
      savedFitRowsForUser(req.siteUser.id, false),
      customSavedFitGroupsForUser(req.siteUser.id),
    ]);
    return res.json({ ok: true, groups: savedFitTree(fits), customGroups });
  } catch (err) {
    console.error("[fitting/saved-fits/tree] error", err);
    return res.status(500).json({ ok: false, error: "saved_fit_tree_failed", groups: [], customGroups: [] });
  }
});

router.get("/saved-fit-groups", siteAuth.requireAuth, async (req, res) => {
  try {
    await ensureSavedFitsSchema();
    const groups = await customSavedFitGroupsForUser(req.siteUser.id);
    return res.json({ ok: true, groups });
  } catch (err) {
    console.error("[fitting/saved-fit-groups] list error", err);
    return res.status(500).json({ ok: false, error: "saved_fit_groups_failed", groups: [] });
  }
});

router.post("/saved-fit-groups", siteAuth.requireAuth, async (req, res) => {
  try {
    await ensureSavedFitsSchema();
    const validation = validateSavedFitGroupBody(req.body || {});
    if (validation.error) return res.status(400).json({ ok: false, error: validation.error });
    const id = crypto.randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO fitting_saved_fit_groups (id, user_id, name)
       VALUES ($1, $2, $3)
       RETURNING id, name, created_at, updated_at`,
      [id, req.siteUser.id, validation.name]
    );
    return res.status(201).json({
      ok: true,
      group: {
        id: String(rows[0].id),
        key: `custom-${rows[0].id}`,
        name: rows[0].name,
        fits: [],
        createdAt: rows[0].created_at,
        updatedAt: rows[0].updated_at,
      },
    });
  } catch (err) {
    if (err?.code === "23505") return res.status(409).json({ ok: false, error: "saved_fit_group_name_exists" });
    console.error("[fitting/saved-fit-groups] create error", err);
    return res.status(500).json({ ok: false, error: "saved_fit_group_create_failed" });
  }
});

router.put("/saved-fit-groups/:id", siteAuth.requireAuth, async (req, res) => {
  try {
    await ensureSavedFitsSchema();
    const validation = validateSavedFitGroupBody(req.body || {});
    if (validation.error) return res.status(400).json({ ok: false, error: validation.error });
    const { rows } = await pool.query(
      `UPDATE fitting_saved_fit_groups
       SET name = $3, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, name, created_at, updated_at`,
      [req.params.id, req.siteUser.id, validation.name]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "saved_fit_group_not_found" });
    return res.json({
      ok: true,
      group: {
        id: String(rows[0].id),
        key: `custom-${rows[0].id}`,
        name: rows[0].name,
        createdAt: rows[0].created_at,
        updatedAt: rows[0].updated_at,
      },
    });
  } catch (err) {
    if (err?.code === "23505") return res.status(409).json({ ok: false, error: "saved_fit_group_name_exists" });
    console.error("[fitting/saved-fit-groups] update error", err);
    return res.status(500).json({ ok: false, error: "saved_fit_group_update_failed" });
  }
});

router.delete("/saved-fit-groups/:id", siteAuth.requireAuth, async (req, res) => {
  try {
    await ensureSavedFitsSchema();
    const result = await pool.query(
      "DELETE FROM fitting_saved_fit_groups WHERE id = $1 AND user_id = $2",
      [req.params.id, req.siteUser.id]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: "saved_fit_group_not_found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[fitting/saved-fit-groups] delete error", err);
    return res.status(500).json({ ok: false, error: "saved_fit_group_delete_failed" });
  }
});

router.post("/saved-fit-groups/:id/fits/:fitId", siteAuth.requireAuth, async (req, res) => {
  try {
    await ensureSavedFitsSchema();
    const { rows } = await pool.query(
      `SELECT
         EXISTS(SELECT 1 FROM fitting_saved_fit_groups WHERE id = $1 AND user_id = $3) AS group_exists,
         EXISTS(SELECT 1 FROM fitting_saved_fits WHERE id = $2 AND user_id = $3) AS fit_exists`,
      [req.params.id, req.params.fitId, req.siteUser.id]
    );
    if (!rows[0]?.group_exists) return res.status(404).json({ ok: false, error: "saved_fit_group_not_found" });
    if (!rows[0]?.fit_exists) return res.status(404).json({ ok: false, error: "saved_fit_not_found" });
    await pool.query(
      `INSERT INTO fitting_saved_fit_group_memberships (group_id, fit_id)
       VALUES ($1, $2)
       ON CONFLICT (group_id, fit_id) DO NOTHING`,
      [req.params.id, req.params.fitId]
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error("[fitting/saved-fit-groups] add fit error", err);
    return res.status(500).json({ ok: false, error: "saved_fit_group_add_failed" });
  }
});

router.delete("/saved-fit-groups/:id/fits/:fitId", siteAuth.requireAuth, async (req, res) => {
  try {
    await ensureSavedFitsSchema();
    const result = await pool.query(
      `DELETE FROM fitting_saved_fit_group_memberships membership
       USING fitting_saved_fit_groups custom_group
       WHERE membership.group_id = custom_group.id
         AND membership.group_id = $1
         AND membership.fit_id = $2
         AND custom_group.user_id = $3`,
      [req.params.id, req.params.fitId, req.siteUser.id]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: "saved_fit_group_membership_not_found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[fitting/saved-fit-groups] remove fit error", err);
    return res.status(500).json({ ok: false, error: "saved_fit_group_remove_failed" });
  }
});

router.get("/saved-fits/:id", siteAuth.requireAuth, async (req, res) => {
  try {
    await ensureSavedFitsSchema();
    const { rows } = await pool.query(
      `
      UPDATE fitting_saved_fits f
      SET last_opened_at = now()
      FROM evesde."invTypes" t
      LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
      WHERE f.id = $1
        AND f.user_id = $2
        AND t."typeID" = f.ship_type_id
      RETURNING f.*, g."groupName" AS group_name
      `,
      [req.params.id, req.siteUser.id]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "saved_fit_not_found" });
    return res.json({ ok: true, fit: savedFitRecord(rows[0], true) });
  } catch (err) {
    console.error("[fitting/saved-fits] read error", err);
    return res.status(500).json({ ok: false, error: "saved_fit_read_failed" });
  }
});

router.post("/saved-fits", siteAuth.requireAuth, async (req, res) => {
  try {
    await ensureSavedFitsSchema();
    const validation = validateSavedFitBody(req.body || {});
    if (validation.error) return res.status(400).json({ ok: false, error: validation.error });
    const existing = await findSavedFitRowByName(req.siteUser.id, validation.shipTypeId, validation.fitName);
    const row = existing
      ? await updateSavedFitRow(existing.id, req.siteUser.id, validation)
      : await createSavedFitRow(req.siteUser.id, validation);
    return res.status(existing ? 200 : 201).json({
      ok: true,
      saveMode: existing ? "updated_existing_name" : "created",
      fit: savedFitRecord(row, true),
    });
  } catch (err) {
    console.error("[fitting/saved-fits] create error", err);
    return res.status(500).json({ ok: false, error: "saved_fit_create_failed" });
  }
});

router.put("/saved-fits/:id", siteAuth.requireAuth, async (req, res) => {
  try {
    await ensureSavedFitsSchema();
    const validation = validateSavedFitBody(req.body || {});
    if (validation.error) return res.status(400).json({ ok: false, error: validation.error });
    const current = await findSavedFitRowById(req.siteUser.id, req.params.id);
    if (!current) return res.status(404).json({ ok: false, error: "saved_fit_not_found" });

    const sameSavedName =
      Number(current.ship_type_id) === Number(validation.shipTypeId) &&
      String(current.fit_name || "").toLowerCase() === String(validation.fitName || "").toLowerCase();
    let saveMode = "updated";
    let row = null;

    if (sameSavedName) {
      row = await updateSavedFitRow(current.id, req.siteUser.id, validation);
    } else {
      const existingByName = await findSavedFitRowByName(req.siteUser.id, validation.shipTypeId, validation.fitName);
      if (existingByName) {
        row = await updateSavedFitRow(existingByName.id, req.siteUser.id, validation);
        saveMode = "updated_existing_name";
      } else {
        row = await createSavedFitRow(req.siteUser.id, validation);
        saveMode = "created_from_rename";
      }
    }

    return res.json({
      ok: true,
      saveMode,
      fit: savedFitRecord(row, true),
    });
  } catch (err) {
    console.error("[fitting/saved-fits] update error", err);
    return res.status(500).json({ ok: false, error: "saved_fit_update_failed" });
  }
});

router.delete("/saved-fits/:id", siteAuth.requireAuth, async (req, res) => {
  try {
    await ensureSavedFitsSchema();
    const result = await pool.query(
      "DELETE FROM fitting_saved_fits WHERE id = $1 AND user_id = $2",
      [req.params.id, req.siteUser.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "saved_fit_not_found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[fitting/saved-fits] delete error", err);
    return res.status(500).json({ ok: false, error: "saved_fit_delete_failed" });
  }
});

router.post("/calculate", async (req, res) => {
  try {
    const prepared = await calculationPayloadWithSkills(req);
    const result = await fittingClient.calculate(prepared.payload || {});
    if (prepared.warnings.length) {
      result.warnings = [...prepared.warnings, ...(result.warnings || [])];
    }
    if (result?.stats) {
      try {
        result.stats.price = await estimateFitPrice(result.payload || prepared.payload || {});
      } catch (priceErr) {
        console.error("[fitting/price] error", priceErr);
        result.stats.price = {
          ship: 0,
          fittings: 0,
          drones: 0,
          cargo: 0,
          character: 0,
          total: 0,
          mode: priceModeLabel(),
          stationId: DEFAULT_PRICE_STATION_ID,
          priceField: DEFAULT_PRICE_MODE,
          itemPrices: {},
          missingTypeIds: [],
          error: "price_lookup_failed",
        };
      }
    }
    return res.json(result);
  } catch (err) {
    return serviceError(res, err);
  }
});

router.post("/affected-skills", async (req, res) => {
  try {
    const user = await optionalSiteUser(req);
    const warnings = [];
    const payload = await attachSkillProfile(req.body?.payload || {}, user, warnings);
    const result = await fittingClient.getAffectedSkills(payload, req.body?.context || {});
    if (warnings.length) {
      result.warnings = [...warnings, ...(result.warnings || [])];
    }
    return res.json(result);
  } catch (err) {
    return serviceError(res, err);
  }
});

router.post("/combat-profile", combatProfileApi.createHandler({
  client: fittingClient.getCombatProfile,
  prepareSkills: calculationPayloadWithSkills,
  requestIp,
}));

router.post("/rolling-stats", async (req, res) => {
  try {
    const user = await optionalSiteUser(req);
    const principal = user?.id ? `user:${user.id}` : `ip:${requestIp(req)}`;
    const rate = checkRollingStatsRateLimit(principal);
    if (!rate.ok) return res.status(429).json({ ok: false, error: rate.error });

    const eft = readRollingStatsEft(req.body || {});
    if (!eft.trim()) {
      return res.status(400).json({
        ok: false,
        ship: null,
        assumptions: { skills: "all_v" },
        summary: null,
        scenarios: [],
        warnings: [],
        errors: [{ code: "empty_eft", message: "Paste an EFT/Pyfa fit to calculate rolling stats." }],
      });
    }

    const result = await fittingClient.getRollingStats(eft);
    return res.status(result?.ok === false ? 422 : 200).json(result);
  } catch (err) {
    return serviceError(res, err);
  }
});

router.post("/import/eft", async (req, res) => {
  try {
    const result = await fittingClient.importEft(req.body?.text || "");
    return res.json(result);
  } catch (err) {
    return serviceError(res, err);
  }
});

router.post("/export/eft", async (req, res) => {
  try {
    const result = await fittingClient.exportEft(req.body?.payload || req.body || {});
    return res.json(result);
  } catch (err) {
    return serviceError(res, err);
  }
});

module.exports = router;
module.exports._test = {
  calculationPayloadWithSkills,
  checkRollingStatsRateLimit,
  readRollingStatsEft,
  savedFitTree,
  validateSavedFitGroupBody,
};
