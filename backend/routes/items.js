/*
 * Express routes for the public Item Browser.
 * Optional market, dogma, and industry sections degrade gracefully when local data has not been imported yet.
 */

const express = require("express");
const cookieParser = require("cookie-parser");
const router = express.Router();
const pool = require("../db/pool");
const siteAuth = require("../services/siteAuth");
const {
  getBlueprintsForProduct,
  getBlueprintsUsingMaterial,
  getType,
} = require("../lib/everefData");

router.use(cookieParser());

const JITA_4_4_STATION_ID = 60003760;
const JITA_4_4_NAME = "Jita 4-4";
const SDE_NON_DISPLAY_MASS_SENTINEL = 1e30;

function clampInt(value, fallback, min, max) {
  const n = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseBool(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "published"].includes(String(value).toLowerCase());
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function localizedText(value) {
  if (value == null) return null;
  if (typeof value === "object") {
    return value.en || value["en-us"] || value.en_US || Object.values(value).find((entry) => typeof entry === "string") || null;
  }
  if (typeof value !== "string") return String(value);

  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return value;

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return value;
    return (
      parsed.en ||
      parsed["en-us"] ||
      parsed.en_US ||
      Object.values(parsed).find((entry) => typeof entry === "string") ||
      value
    );
  } catch {
    return value;
  }
}

function firstNumber(...values) {
  for (const value of values) {
    const n = toNumber(value);
    if (n != null) return n;
  }
  return null;
}

function displayMassFromSources(row, typeMeta) {
  const mass = firstNumber(row.mass, typeMeta?.mass);
  if (mass == null) return null;

  // The SDE uses 1e35 as a non-physical sentinel for asteroid/celestial resource rows.
  // Showing that as kilograms makes Basic Info look broken, so treat only that sentinel range as missing display data.
  if (mass >= SDE_NON_DISPLAY_MASS_SENTINEL) return null;
  return mass;
}

function stripDescription(value, maxLength = 220) {
  const text = String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
  if (text.length <= maxLength) return text || null;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function isBlueprintType(row) {
  const category = String(row?.category_name || "").toLowerCase();
  const group = String(row?.group_name || "").toLowerCase();
  const name = String(row?.name || row?.typeName || "").toLowerCase();
  return category === "blueprint" || group.includes("blueprint") || /\bblueprint\b/.test(name);
}

function isSkinLicenseType(row) {
  return Number(row?.category_id) === 91 || String(row?.category_name || "").toLowerCase() === "skins";
}

function iconUrl(typeId, size = 64, variation = "icon") {
  return `https://images.evetech.net/types/${typeId}/${variation}?size=${size}`;
}

function itemIconUrl(typeId, row, size = 64) {
  // Category 91 SKIN licenses currently have no usable EVE Image Server type variation.
  if (isSkinLicenseType(row)) return null;
  // EVE Image Server exposes blueprint originals with the type "bp" variation.
  return iconUrl(typeId, size, isBlueprintType(row) ? "bp" : "icon");
}

function renderUrl(typeId, size = 512) {
  return `https://images.evetech.net/types/${typeId}/render?size=${size}`;
}

function groupPayload(row) {
  return row.group_id
    ? { group_id: Number(row.group_id), name: row.group_name || null }
    : null;
}

function categoryPayload(row) {
  return row.category_id
    ? { category_id: Number(row.category_id), name: row.category_name || null }
    : null;
}

function marketGroupPayload(row) {
  return row.market_group_id
    ? { market_group_id: Number(row.market_group_id), name: row.market_group_name || null }
    : null;
}

function marketGroupPathPayload(rows, fallback) {
  if (Array.isArray(rows) && rows.length) {
    return rows.map((row) => ({
      market_group_id: Number(row.market_group_id),
      name: row.name || null,
    }));
  }
  return fallback ? [fallback] : [];
}

function compactItem(row) {
  const typeId = Number(row.type_id);
  return {
    type_id: typeId,
    name: row.name,
    description: stripDescription(row.description),
    published: !!row.published,
    group: groupPayload(row),
    category: categoryPayload(row),
    market_group: marketGroupPayload(row),
    icon_url: itemIconUrl(typeId, row, 64),
  };
}

function itemBookmarkRecord(row) {
  return {
    ...compactItem(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function detailItem(row, typeMeta = null, marketGroupPathRows = []) {
  const typeId = Number(row.type_id);
  const marketGroup = marketGroupPayload(row);
  return {
    type_id: typeId,
    name: row.name,
    description: stripDescription(row.description, 5000),
    published: !!row.published,
    group: groupPayload(row),
    category: categoryPayload(row),
    market_group: marketGroup,
    market_group_path: marketGroupPathPayload(marketGroupPathRows, marketGroup),
    volume: firstNumber(row.volume, typeMeta?.volume), // evesde."invTypes"."volume", Everef fallback
    packaged_volume: firstNumber(
      typeMeta?.packagedVolume,
      row.packaged_volume,
      row.legacy_packaged_volume
    ), // Everef/types.yaml packagedVolume first, with legacy invVolumes as last resort
    mass: displayMassFromSources(row, typeMeta), // evesde."invTypes"."mass", with SDE sentinel suppression
    capacity: firstNumber(row.capacity, typeMeta?.capacity), // evesde."invTypes"."capacity", Everef fallback
    portion_size: row.portion_size == null ? null : Number(row.portion_size),
    radius: firstNumber(row.radius, typeMeta?.radius), // types.yaml/Everef radius when present
    icon_url: itemIconUrl(typeId, row, 64),
    render_url: renderUrl(typeId, 512),
  };
}

function marketPayload(row) {
  if (!row) {
    return {
      available: false,
      station: JITA_4_4_NAME,
      station_id: JITA_4_4_STATION_ID,
      sell_min: null,
      buy_max: null,
      sell_5pct: null,
      buy_5pct: null,
      updated_at: null,
    };
  }

  return {
    available:
      row.sell_min != null ||
      row.buy_max != null ||
      row.sell_5pct != null ||
      row.buy_5pct != null,
    station: JITA_4_4_NAME,
    station_id: JITA_4_4_STATION_ID,
    sell_min: row.sell_min,
    buy_max: row.buy_max,
    sell_5pct: row.sell_5pct,
    buy_5pct: row.buy_5pct,
    updated_at: row.last_updated,
  };
}

function industryFromEveref(typeId) {
  const producedBy = getBlueprintsForProduct(typeId)
    .slice(0, 50)
    .map((bp) => ({
      blueprint_type_id: Number(bp.blueprintId),
      blueprint_name: getType(Number(bp.blueprintId))?.name || null,
      activity_id: bp.activity === "reaction" ? 11 : 1,
      activity: bp.activity,
      quantity: Number(bp.productQtyPerRun || 0) || null,
    }));

  const usedIn = getBlueprintsUsingMaterial(typeId)
    .slice(0, 80)
    .map((bp) => {
      const material = (bp.materials || []).find((entry) => Number(entry.typeId) === typeId);
      return {
        blueprint_type_id: Number(bp.blueprintId),
        blueprint_name: getType(Number(bp.blueprintId))?.name || null,
        product_type_id: Number(bp.productTypeId),
        product_name: getType(Number(bp.productTypeId))?.name || null,
        activity_id: bp.activity === "reaction" ? 11 : 1,
        activity: bp.activity,
        quantity: material?.quantity == null ? null : Number(material.quantity),
        product_quantity: Number(bp.productQtyPerRun || 0) || null,
      };
    });

  return { produced_by: producedBy, used_in: usedIn };
}

async function optionalRows(label, sql, params) {
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } catch (err) {
    if (["42P01", "42703"].includes(err.code)) {
      console.warn(`[items] optional ${label} unavailable: ${err.message}`);
      return [];
    }
    throw err;
  }
}

async function getDogmaRows(typeId) {
  const dgmRows = await optionalRows(
    "dogma dgm",
    `
    SELECT
      dta."attributeID" AS attribute_id,
      dat."attributeName" AS name,
      dat."displayName" AS display_name,
      dat."unitID" AS unit_id,
      dat."categoryID" AS category_id,
      COALESCE(dta."valueFloat", dta."valueInt"::double precision) AS value
    FROM evesde."dgmTypeAttributes" dta
    LEFT JOIN evesde."dgmAttributeTypes" dat ON dat."attributeID" = dta."attributeID"
    WHERE dta."typeID" = $1
      AND COALESCE(dta."valueFloat", dta."valueInt"::double precision) IS NOT NULL
    ORDER BY COALESCE(NULLIF(dat."displayName", ''), dat."attributeName", dta."attributeID"::text)
    LIMIT 160
    `,
    [typeId]
  );
  if (dgmRows.length) return dgmRows;

  const yamlRows = await optionalRows(
    "dogma yaml",
    `
    SELECT
      tda."attributeID" AS attribute_id,
      da."attributeName" AS name,
      da."displayName" AS display_name,
      da."unitID" AS unit_id,
      da."categoryID" AS category_id,
      tda."value" AS value
    FROM evesde."typeDogmaAttributes" tda
    LEFT JOIN evesde."dogmaAttributes" da ON da."attributeID" = tda."attributeID"
    WHERE tda."typeID" = $1
      AND tda."value" IS NOT NULL
    ORDER BY COALESCE(NULLIF(da."displayName", ''), da."attributeName", tda."attributeID"::text)
    LIMIT 160
    `,
    [typeId]
  );
  if (yamlRows.length) return yamlRows;

  return optionalRows(
    "dogma values",
    `
    SELECT
      tda."attributeID" AS attribute_id,
      NULL::text AS name,
      ('Attribute ' || tda."attributeID"::text) AS display_name,
      NULL::integer AS unit_id,
      NULL::integer AS category_id,
      tda."value" AS value
    FROM evesde."typeDogmaAttributes" tda
    WHERE tda."typeID" = $1
      AND tda."value" IS NOT NULL
    ORDER BY tda."attributeID"
    LIMIT 160
    `,
    [typeId]
  );
}

const DOGMA_TYPE_REFERENCE_NAMES = [
  "primary skill required",
  "secondary skill required",
  "tertiary skill required",
  "reprocessing skill",
];

const DOGMA_GROUP_REFERENCE_NAMES = [
  "can be fitted to",
  "used with (charge group)",
  "used with charge group",
];

function dogmaReferenceKind(row) {
  const text = `${row.display_name || ""} ${row.name || ""}`.toLowerCase();
  if (DOGMA_TYPE_REFERENCE_NAMES.some((name) => text.includes(name))) return "type";
  if (DOGMA_GROUP_REFERENCE_NAMES.some((name) => text.includes(name))) return "group";
  return null;
}

async function resolveDogmaReferences(rows) {
  const typeIds = new Set();
  const groupIds = new Set();

  for (const row of rows) {
    const kind = dogmaReferenceKind(row);
    const id = toNumber(row.value);
    if (!kind || id == null || !Number.isInteger(id)) continue;
    if (kind === "type") typeIds.add(id);
    if (kind === "group") groupIds.add(id);
  }

  const [typeRows, groupRows] = await Promise.all([
    typeIds.size
      ? optionalRows(
          "dogma type references",
          `
          SELECT "typeID" AS id, "typeName" AS name
          FROM evesde."invTypes"
          WHERE "typeID" = ANY($1::integer[])
          `,
          [[...typeIds]]
        )
      : [],
    groupIds.size
      ? optionalRows(
          "dogma group references",
          `
          SELECT "groupID" AS id, "groupName" AS name
          FROM evesde."invGroups"
          WHERE "groupID" = ANY($1::integer[])
          `,
          [[...groupIds]]
        )
      : [],
  ]);

  const types = new Map(typeRows.map((row) => [Number(row.id), row.name || null]));
  const groups = new Map(groupRows.map((row) => [Number(row.id), row.name || null]));

  return rows.map((row) => {
    const kind = dogmaReferenceKind(row);
    const id = toNumber(row.value);
    if (!kind || id == null || !Number.isInteger(id)) return row;

    const name = kind === "type" ? types.get(id) : groups.get(id);
    if (!name) return row;

    return {
      ...row,
      display_value: name,
      reference: {
        kind,
        id,
        name,
        path: kind === "type" ? `/items/${id}` : null,
      },
    };
  });
}

async function getTypeTraits(typeId) {
  const rows = await optionalRows(
    "type traits",
    `
    SELECT "traits"
    FROM evesde."invTypes"
    WHERE "typeID" = $1 AND "traits" IS NOT NULL
    LIMIT 1
    `,
    [typeId]
  );
  return rows[0]?.traits || null;
}

function localized(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") return value.en || value["en-us"] || Object.values(value)[0] || null;
  return String(value);
}

function traitUnit(unitId) {
  if (unitId === 105) return "%";
  if (unitId === 101) return "ms";
  return null;
}

function normalizeTraitBonus(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = stripDescription(localized(raw.bonusText || raw.text || raw.description), 1000);
  if (!text) return null;
  const unitId = raw.unitID ?? raw.unitId ?? raw.unit_id ?? null;
  const bonus = toNumber(raw.bonus);
  return {
    bonus,
    unit_id: unitId == null ? null : Number(unitId),
    unit: traitUnit(Number(unitId)),
    text,
  };
}

function normalizeTraitBonusList(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeTraitBonus)
    .filter(Boolean);
}

async function normalizeTraits(rawTraits) {
  if (!rawTraits || typeof rawTraits !== "object") return null;

  const rawTypes = rawTraits.types && typeof rawTraits.types === "object" ? rawTraits.types : {};
  const skillIds = Object.keys(rawTypes)
    .map((key) => Number(key))
    .filter((id) => Number.isFinite(id));

  const skillRows = skillIds.length
    ? await optionalRows(
        "trait skill names",
        `
        SELECT "typeID" AS id, "typeName" AS name
        FROM evesde."invTypes"
        WHERE "typeID" = ANY($1::integer[])
        `,
        [skillIds]
      )
    : [];
  const skillNames = new Map(skillRows.map((row) => [Number(row.id), row.name || null]));

  const traits = {
    miscBonuses: normalizeTraitBonusList(rawTraits.miscBonuses),
    roleBonuses: normalizeTraitBonusList(rawTraits.roleBonuses),
    types: skillIds
      .map((skillTypeId) => ({
        skill_type_id: skillTypeId,
        skill_name: skillNames.get(skillTypeId) || null,
        bonuses: normalizeTraitBonusList(rawTypes[String(skillTypeId)]),
      }))
      .filter((entry) => entry.bonuses.length > 0),
  };

  if (!traits.miscBonuses.length && !traits.roleBonuses.length && !traits.types.length) return null;
  return traits;
}

async function getMarketGroupPath(marketGroupId) {
  const id = toNumber(marketGroupId);
  if (id == null) return [];

  return optionalRows(
    "market group path",
    `
    WITH RECURSIVE crumb AS (
      SELECT
        mg."marketGroupID" AS market_group_id,
        mg."parentGroupID" AS parent_id,
        mg."marketGroupName" AS name,
        0 AS depth
      FROM evesde."invMarketGroups" mg
      WHERE mg."marketGroupID" = $1

      UNION ALL

      SELECT
        p."marketGroupID" AS market_group_id,
        p."parentGroupID" AS parent_id,
        p."marketGroupName" AS name,
        crumb.depth + 1 AS depth
      FROM crumb
      JOIN evesde."invMarketGroups" p ON p."marketGroupID" = crumb.parent_id
      WHERE crumb.depth < 12
    )
    SELECT market_group_id, name
    FROM crumb
    ORDER BY depth DESC
    `,
    [id]
  );
}

function baseItemSql({ useInvVolumes, useTypeExtras }) {
  const packagedExpr = useTypeExtras ? `t."packagedVolume"` : `NULL::double precision`;
  const legacyPackagedExpr = useInvVolumes ? `iv."volume"::double precision` : `NULL::double precision`;
  const radiusExpr = useTypeExtras ? `t."radius"` : `NULL::double precision`;
  const invVolumesJoin = useInvVolumes
    ? `LEFT JOIN evesde."invVolumes" iv ON iv."typeID" = t."typeID"`
    : "";

  return `
    SELECT
      t."typeID" AS type_id,
      t."typeName" AS name,
      t."description" AS description,
      COALESCE(t."published", true) AS published,
      t."volume" AS volume,
      ${packagedExpr} AS packaged_volume,
      ${legacyPackagedExpr} AS legacy_packaged_volume,
      t."mass" AS mass,
      t."capacity" AS capacity,
      t."portionSize" AS portion_size,
      ${radiusExpr} AS radius,
      g."groupID" AS group_id,
      g."groupName" AS group_name,
      c."categoryID" AS category_id,
      c."categoryName" AS category_name,
      mg."marketGroupID" AS market_group_id,
      mg."marketGroupName" AS market_group_name
    FROM evesde."invTypes" t
    ${invVolumesJoin}
    LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
    LEFT JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
    LEFT JOIN evesde."invMarketGroups" mg ON mg."marketGroupID" = t."marketGroupID"
    WHERE t."typeID" = $1
    LIMIT 1
    `;
}

async function getBaseItem(typeId) {
  const attempts = [
    { useInvVolumes: true, useTypeExtras: true },
    { useInvVolumes: true, useTypeExtras: false },
    { useInvVolumes: false, useTypeExtras: true },
    { useInvVolumes: false, useTypeExtras: false },
  ];

  for (const options of attempts) {
    try {
      const { rows } = await pool.query(baseItemSql(options), [typeId]);
      return rows[0] || null;
    } catch (err) {
      if (["42P01", "42703"].includes(err.code)) continue;
      throw err;
    }
  }

  const { rows } = await pool.query(
    `
    SELECT
      t."typeID" AS type_id,
      t."typeName" AS name,
      t."description" AS description,
      COALESCE(t."published", true) AS published,
      t."volume" AS volume,
      NULL::double precision AS packaged_volume,
      NULL::double precision AS legacy_packaged_volume,
      t."mass" AS mass,
      t."capacity" AS capacity,
      t."portionSize" AS portion_size,
      NULL::double precision AS radius,
      g."groupID" AS group_id,
      g."groupName" AS group_name,
      c."categoryID" AS category_id,
      c."categoryName" AS category_name,
      mg."marketGroupID" AS market_group_id,
      mg."marketGroupName" AS market_group_name
    FROM evesde."invTypes" t
    LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
    LEFT JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
    LEFT JOIN evesde."invMarketGroups" mg ON mg."marketGroupID" = t."marketGroupID"
    WHERE t."typeID" = $1
    LIMIT 1
    `,
    [typeId]
  );
  return rows[0] || null;
}

let bookmarkSchemaReady = false;
let bookmarkSchemaPromise = null;

async function ensureItemBookmarkSchema() {
  if (bookmarkSchemaReady) return;
  if (!bookmarkSchemaPromise) {
    bookmarkSchemaPromise = (async () => {
      await siteAuth.ensureAuthSchema();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS item_bookmarks (
          user_id BIGINT NOT NULL REFERENCES anoikis_command_users(id) ON DELETE CASCADE,
          type_id INTEGER NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, type_id)
        );

        CREATE INDEX IF NOT EXISTS item_bookmarks_user_updated_idx
          ON item_bookmarks(user_id, updated_at DESC);
      `);
      bookmarkSchemaReady = true;
    })().catch((err) => {
      bookmarkSchemaPromise = null;
      throw err;
    });
  }
  await bookmarkSchemaPromise;
}

function cleanTypeId(value) {
  const typeId = parseInt(String(value || ""), 10);
  return Number.isFinite(typeId) && typeId > 0 ? typeId : null;
}

router.get("/items/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = clampInt(req.query.limit, 25, 1, 100);
    const publishedOnly = parseBool(req.query.published, true);

    if (!q) return res.json({ ok: true, results: [] });

    const params = [];
    const filters = [];
    if (publishedOnly) filters.push(`COALESCE(t."published", true) = true`);

    const numericQ = /^\d+$/.test(q) ? Number(q) : null;
    if (numericQ) {
      params.push(numericQ, `%${q.toLowerCase()}%`, q.toLowerCase());
      filters.push(`(t."typeID" = $1 OR lower(t."typeName") LIKE $2)`);
    } else {
      params.push(`%${q.toLowerCase()}%`, q.toLowerCase());
      filters.push(`lower(t."typeName") LIKE $1`);
    }
    params.push(limit);

    const { rows } = await pool.query(
      `
      SELECT
        t."typeID" AS type_id,
        t."typeName" AS name,
        t."description" AS description,
        COALESCE(t."published", true) AS published,
        g."groupID" AS group_id,
        g."groupName" AS group_name,
        c."categoryID" AS category_id,
        c."categoryName" AS category_name,
        mg."marketGroupID" AS market_group_id,
        mg."marketGroupName" AS market_group_name
      FROM evesde."invTypes" t
      LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
      LEFT JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
      LEFT JOIN evesde."invMarketGroups" mg ON mg."marketGroupID" = t."marketGroupID"
      WHERE ${filters.join(" AND ")}
      ORDER BY
        ${numericQ ? `CASE WHEN t."typeID" = $1 THEN 0 ELSE 1 END,` : ""}
        CASE WHEN lower(t."typeName") = $${numericQ ? 3 : 2} THEN 0 ELSE 1 END,
        CASE WHEN lower(t."typeName") LIKE $${numericQ ? 2 : 1} THEN 0 ELSE 1 END,
        t."typeName" ASC
      LIMIT $${params.length}
      `,
      params
    );

    return res.json({ ok: true, results: rows.map(compactItem) });
  } catch (err) {
    console.error("[items/search] error", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.get("/items/bookmarks", siteAuth.requireAuth, async (req, res) => {
  try {
    await ensureItemBookmarkSchema();
    const { rows } = await pool.query(
      `
      SELECT
        b.created_at,
        b.updated_at,
        t."typeID" AS type_id,
        t."typeName" AS name,
        t."description" AS description,
        COALESCE(t."published", true) AS published,
        g."groupID" AS group_id,
        g."groupName" AS group_name,
        c."categoryID" AS category_id,
        c."categoryName" AS category_name,
        mg."marketGroupID" AS market_group_id,
        mg."marketGroupName" AS market_group_name
      FROM item_bookmarks b
      JOIN evesde."invTypes" t ON t."typeID" = b.type_id
      LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
      LEFT JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
      LEFT JOIN evesde."invMarketGroups" mg ON mg."marketGroupID" = t."marketGroupID"
      WHERE b.user_id = $1
      ORDER BY b.updated_at DESC, t."typeName" ASC
      LIMIT 200
      `,
      [req.siteUser.id]
    );
    return res.json({ ok: true, bookmarks: rows.map(itemBookmarkRecord) });
  } catch (err) {
    console.error("[items/bookmarks] list error", err);
    return res.status(500).json({ ok: false, error: "item_bookmarks_failed", bookmarks: [] });
  }
});

router.put("/items/bookmarks/:typeID", siteAuth.requireAuth, async (req, res) => {
  try {
    const typeId = cleanTypeId(req.params.typeID);
    if (!typeId) return res.status(400).json({ ok: false, error: "invalid_type_id" });

    const base = await getBaseItem(typeId);
    if (!base) return res.status(404).json({ ok: false, error: "not_found" });

    await ensureItemBookmarkSchema();
    const { rows } = await pool.query(
      `
      INSERT INTO item_bookmarks (user_id, type_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, type_id)
      DO UPDATE SET updated_at = now()
      RETURNING created_at, updated_at
      `,
      [req.siteUser.id, typeId]
    );
    return res.json({ ok: true, bookmark: itemBookmarkRecord({ ...base, ...rows[0] }) });
  } catch (err) {
    console.error("[items/bookmarks] upsert error", err);
    return res.status(500).json({ ok: false, error: "item_bookmark_update_failed" });
  }
});

router.delete("/items/bookmarks/:typeID", siteAuth.requireAuth, async (req, res) => {
  try {
    const typeId = cleanTypeId(req.params.typeID);
    if (!typeId) return res.status(400).json({ ok: false, error: "invalid_type_id" });

    await ensureItemBookmarkSchema();
    await pool.query(
      "DELETE FROM item_bookmarks WHERE user_id = $1 AND type_id = $2",
      [req.siteUser.id, typeId]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("[items/bookmarks] delete error", err);
    return res.status(500).json({ ok: false, error: "item_bookmark_delete_failed" });
  }
});

router.get("/items/:typeID", async (req, res) => {
  try {
    const typeId = parseInt(String(req.params.typeID || ""), 10);
    if (!Number.isFinite(typeId) || typeId <= 0) {
      return res.status(400).json({ ok: false, error: "invalid_type_id" });
    }

    const base = await getBaseItem(typeId);
    if (!base) return res.status(404).json({ ok: false, error: "not_found" });

    const [marketRows, dogmaRows, producedByRows, usedInRows, blueprintProductRows, marketGroupPathRows, rawTraits] = await Promise.all([
      optionalRows(
        "market",
        `
        SELECT sell_min, buy_max, sell_5pct, buy_5pct, last_updated
        FROM public.market_station_aggregates
        WHERE station_id = $1 AND type_id = $2
        LIMIT 1
        `,
        [JITA_4_4_STATION_ID, typeId]
      ),
      getDogmaRows(typeId),
      optionalRows(
        "industry produced_by",
        `
        SELECT
          p."typeID" AS blueprint_type_id,
          bt."typeName" AS blueprint_name,
          p."activityID" AS activity_id,
          p."quantity" AS quantity
        FROM evesde."industryActivityProducts" p
        LEFT JOIN evesde."invTypes" bt ON bt."typeID" = p."typeID"
        WHERE p."productTypeID" = $1
        ORDER BY bt."typeName" ASC NULLS LAST
        LIMIT 50
        `,
        [typeId]
      ),
      optionalRows(
        "industry used_in",
        `
        SELECT
          m."typeID" AS blueprint_type_id,
          bt."typeName" AS blueprint_name,
          p."productTypeID" AS product_type_id,
          pt."typeName" AS product_name,
          m."activityID" AS activity_id,
          m."quantity" AS quantity,
          p."quantity" AS product_quantity
        FROM evesde."industryActivityMaterials" m
        LEFT JOIN evesde."industryActivityProducts" p
          ON p."typeID" = m."typeID" AND p."activityID" = m."activityID"
        LEFT JOIN evesde."invTypes" bt ON bt."typeID" = m."typeID"
        LEFT JOIN evesde."invTypes" pt ON pt."typeID" = p."productTypeID"
        WHERE m."materialTypeID" = $1
        ORDER BY pt."typeName" ASC NULLS LAST, bt."typeName" ASC NULLS LAST
        LIMIT 80
        `,
        [typeId]
      ),
      optionalRows(
        "industry blueprint products",
        `
        SELECT
          p."typeID" AS blueprint_type_id,
          bt."typeName" AS blueprint_name,
          p."productTypeID" AS product_type_id,
          pt."typeName" AS product_name,
          p."activityID" AS activity_id,
          p."quantity" AS product_quantity
        FROM evesde."industryActivityProducts" p
        LEFT JOIN evesde."invTypes" bt ON bt."typeID" = p."typeID"
        LEFT JOIN evesde."invTypes" pt ON pt."typeID" = p."productTypeID"
        WHERE p."typeID" = $1
          AND p."activityID" IN (1, 11)
        ORDER BY p."activityID" ASC, pt."typeName" ASC NULLS LAST
        LIMIT 10
        `,
        [typeId]
      ),
      getMarketGroupPath(base.market_group_id),
      getTypeTraits(typeId),
    ]);

    const dogma = await resolveDogmaReferences(dogmaRows
      .filter((row) => row.name || row.display_name)
      .map((row) => ({
        attribute_id: Number(row.attribute_id),
        name: localizedText(row.name),
        display_name: localizedText(row.display_name) || localizedText(row.name) || `Attribute ${row.attribute_id}`,
        unit: row.unit_id == null ? null : Number(row.unit_id),
        category_id: row.category_id == null ? null : Number(row.category_id),
        value: row.value,
      })));

    const typeMeta = getType(typeId);
    const everefIndustry = industryFromEveref(typeId);
    const industry = {
      blueprint_products: blueprintProductRows.map((row) => ({
        blueprint_type_id: row.blueprint_type_id == null ? null : Number(row.blueprint_type_id),
        blueprint_name: row.blueprint_name || null,
        product_type_id: row.product_type_id == null ? null : Number(row.product_type_id),
        product_name: row.product_name || null,
        activity_id: row.activity_id == null ? null : Number(row.activity_id),
        activity: Number(row.activity_id) === 11 ? "reaction" : "manufacturing",
        quantity: row.product_quantity == null ? null : Number(row.product_quantity),
        product_quantity: row.product_quantity == null ? null : Number(row.product_quantity),
      })),
      produced_by: everefIndustry.produced_by.length
        ? everefIndustry.produced_by
        : producedByRows.map((row) => ({
            blueprint_type_id: row.blueprint_type_id == null ? null : Number(row.blueprint_type_id),
            blueprint_name: row.blueprint_name || null,
            activity_id: row.activity_id == null ? null : Number(row.activity_id),
            activity: Number(row.activity_id) === 11 ? "reaction" : "manufacturing",
            quantity: row.quantity == null ? null : Number(row.quantity),
          })),
      used_in: everefIndustry.used_in.length
        ? everefIndustry.used_in
        : usedInRows.map((row) => ({
            blueprint_type_id: row.blueprint_type_id == null ? null : Number(row.blueprint_type_id),
            blueprint_name: row.blueprint_name || null,
            product_type_id: row.product_type_id == null ? null : Number(row.product_type_id),
            product_name: row.product_name || null,
            activity_id: row.activity_id == null ? null : Number(row.activity_id),
            activity: Number(row.activity_id) === 11 ? "reaction" : "manufacturing",
            quantity: row.quantity == null ? null : Number(row.quantity),
            product_quantity: row.product_quantity == null ? null : Number(row.product_quantity),
          })),
    };

    const tools = [{ label: "Open Market Browser", path: `/market?type_id=${typeId}` }];
    if (String(base.category_name || "").toLowerCase() === "ship") {
      tools.push({ label: "Open Fitting Tool", path: `/fitting?type_id=${typeId}` });
    }

    return res.json({
      ok: true,
      item: detailItem(base, typeMeta, marketGroupPathRows),
      market: marketPayload(marketRows[0]),
      dogma,
      traits: await normalizeTraits(rawTraits),
      industry,
      tools,
    });
  } catch (err) {
    console.error("[items/detail] error", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

module.exports = router;
