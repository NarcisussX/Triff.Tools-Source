/*
 * WH Structure Stats API: discovers wormhole Upwell losses via zKill, hydrates
 * candidates from ESI, caches killmails, and aggregates attacker entities.
 */

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const { pool } = require("../db");

const ZKILL_BASE = "https://zkillboard.com/api";
const ESI_BASE = "https://esi.evetech.net/latest";
const UA =
  process.env.WH_STRUCTURE_STATS_UA ||
  "triff.tools WH Structure Stats - contact via triff.tools";

const ZKILL_DELAY_MS = Math.max(
  250,
  Number(process.env.WH_STRUCTURE_ZKILL_DELAY_MS || 1100)
);
const ESI_DELAY_MS = Math.max(0, Number(process.env.WH_STRUCTURE_ESI_DELAY_MS || 120));
const ATTACKER_INSERT_CHUNK_SIZE = Math.max(
  50,
  Number(process.env.WH_STRUCTURE_ATTACKER_INSERT_CHUNK_SIZE || 500)
);
const UPSERT_STATEMENT_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.WH_STRUCTURE_UPSERT_STATEMENT_TIMEOUT_MS || 120000)
);
const MAX_ZKILL_PAGES = Math.max(
  1,
  Number(process.env.WH_STRUCTURE_ZKILL_MAX_PAGES_PER_MONTH_TYPE || 100)
);
const MAX_HTTP_RETRIES = Math.max(0, Number(process.env.WH_STRUCTURE_HTTP_RETRIES || 5));
const ROLLING_WINDOW_DAYS = Math.max(
  30,
  Number(process.env.WH_STRUCTURE_ROLLING_WINDOW_DAYS || 1095)
);
const DAILY_REFRESH_DAYS = Math.max(
  1,
  Number(process.env.WH_STRUCTURE_DAILY_REFRESH_DAYS || 45)
);
const DAILY_REFRESH_UTC_HOUR = Math.min(
  23,
  Math.max(0, Number(process.env.WH_STRUCTURE_DAILY_REFRESH_UTC_HOUR || 11))
);

const NORMAL_STRUCTURE_NAMES = [
  "Astrahus",
  "Fortizar",
  "Keepstar",
  "Raitaru",
  "Azbel",
  "Sotiyo",
  "Athanor",
  "Tatara",
];

const SDE_ONLY_STRUCTURE_NAMES = [
  "Upwell Palatine Keepstar",
  "'Moreau' Fortizar",
  "'Draccous' Fortizar",
  "'Horizon' Fortizar",
  "'Marginis' Fortizar",
  "'Prometheus' Fortizar",
];

const ALLOWED_STRUCTURE_NAMES = [
  ...NORMAL_STRUCTURE_NAMES,
  ...SDE_ONLY_STRUCTURE_NAMES,
];

const FALLBACK_NORMAL_TYPES = new Map([
  ["astrahus", { type_id: 35832, name: "Astrahus" }],
  ["fortizar", { type_id: 35833, name: "Fortizar" }],
  ["keepstar", { type_id: 35834, name: "Keepstar" }],
  ["raitaru", { type_id: 35825, name: "Raitaru" }],
  ["azbel", { type_id: 35826, name: "Azbel" }],
  ["sotiyo", { type_id: 35827, name: "Sotiyo" }],
  ["athanor", { type_id: 35835, name: "Athanor" }],
  ["tatara", { type_id: 35836, name: "Tatara" }],
]);

let schemaPromise = null;
let schemaReady = false;
let allowedCache = null;
let allowedCacheAt = 0;
let rollingMaintenanceStarted = false;
let rollingMaintenanceTimer = null;
let rollingMaintenanceInterval = null;
const processStartedAt = new Date();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonb(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function numericOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bool(value) {
  return value === true || value === "true";
}

function requireAdmin(req, res) {
  const token = String(process.env.WH_STRUCTURE_ADMIN_TOKEN || "").trim();
  const provided = String(
    req.get("x-wh-structure-admin-token") ||
      req.get("x-admin-token") ||
      String(req.get("authorization") || "").replace(/^Bearer\s+/i, "")
  ).trim();
  const providedBuffer = Buffer.from(provided);
  const tokenBuffer = Buffer.from(token);
  if (
    token &&
    provided &&
    providedBuffer.length === tokenBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, tokenBuffer)
  ) {
    return true;
  }
  res.status(403).json({ error: "Admin access required" });
  return false;
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function zkillMonthValue(month) {
  return String(Number(month));
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function utcToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function rollingWindow() {
  const end = utcToday();
  const start = addUtcDays(end, -(ROLLING_WINDOW_DAYS - 1));
  return {
    start,
    end,
    startDate: dateOnly(start),
    endDate: dateOnly(end),
    days: ROLLING_WINDOW_DAYS,
  };
}

function dailyRefreshWindow() {
  const rolling = rollingWindow();
  const refreshStart = addUtcDays(rolling.end, -(DAILY_REFRESH_DAYS - 1));
  const start = refreshStart < rolling.start ? rolling.start : refreshStart;
  return {
    start,
    end: rolling.end,
    startDate: dateOnly(start),
    endDate: rolling.endDate,
    days: Math.floor((rolling.end.getTime() - start.getTime()) / 86400000) + 1,
  };
}

function parseDateOnly(value, fieldName) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const err = new Error(`${fieldName} must be YYYY-MM-DD`);
    err.statusCode = 400;
    throw err;
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || dateOnly(parsed) !== raw) {
    const err = new Error(`${fieldName} is not a valid date`);
    err.statusCode = 400;
    throw err;
  }
  return { raw, date: parsed };
}

function parseDateRange(input, opts = {}) {
  const start = parseDateOnly(input.startDate, "startDate");
  const end = parseDateOnly(input.endDate, "endDate");
  if (end.date < start.date) {
    const err = new Error("endDate must be on or after startDate");
    err.statusCode = 400;
    throw err;
  }
  if (opts.enforceRollingWindow !== false) {
    const window = rollingWindow();
    if (start.date < window.start || end.date > window.end) {
      const err = new Error(
        `Date range must stay inside the rolling ${Math.round(ROLLING_WINDOW_DAYS / 365)} year cache window (${window.startDate} to ${window.endDate})`
      );
      err.statusCode = 400;
      throw err;
    }
  }
  const endExclusive = new Date(end.date);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const days = Math.floor((end.date.getTime() - start.date.getTime()) / 86400000) + 1;
  return {
    startDate: start.raw,
    endDate: end.raw,
    start: start.date,
    end: end.date,
    endExclusive,
    days,
  };
}

function monthList(start, end) {
  const months = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    months.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function createJobId() {
  return `whs_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

function createAllianceGroupId(name) {
  const slug = String(name || "group")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "group";
  return `grp_${slug}_${crypto.randomBytes(4).toString("hex")}`;
}

async function ensureSchema() {
  if (schemaReady) return;
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wh_structure_stat_jobs (
        id text PRIMARY KEY,
        status text NOT NULL,
        started_at timestamptz,
        finished_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        start_date date NOT NULL,
        end_date date NOT NULL,
        selected_type_ids int[] NOT NULL,
        progress jsonb NOT NULL DEFAULT '{}'::jsonb,
        error text
      );
    `);

    await pool.query(`
      ALTER TABLE wh_structure_stat_jobs
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS wh_structure_kill_candidates (
        killmail_id bigint PRIMARY KEY,
        hash text NOT NULL,
        source text NOT NULL DEFAULT 'zkill',
        zkb_total_value numeric,
        zkb_destroyed_value numeric,
        zkb_dropped_value numeric,
        zkb_json jsonb,
        discovered_at timestamptz NOT NULL DEFAULT now(),
        candidate_type_id int,
        candidate_month text
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS wh_structure_kills (
        killmail_id bigint PRIMARY KEY,
        killmail_time timestamptz NOT NULL,
        solar_system_id int NOT NULL,
        jcode text,
        wormhole_class text,
        victim_corporation_id bigint,
        victim_alliance_id bigint,
        victim_character_id bigint,
        structure_type_id int NOT NULL,
        structure_type_name text NOT NULL,
        zkb_total_value numeric,
        raw jsonb NOT NULL,
        hydrated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS wh_structure_kill_attackers (
        id bigserial PRIMARY KEY,
        killmail_id bigint NOT NULL REFERENCES wh_structure_kills(killmail_id) ON DELETE CASCADE,
        attacker_index int NOT NULL DEFAULT 0,
        character_id bigint,
        corporation_id bigint,
        alliance_id bigint,
        ship_type_id int,
        weapon_type_id int,
        damage_done bigint NOT NULL DEFAULT 0,
        final_blow boolean NOT NULL DEFAULT false
      );
    `);

    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS wh_structure_kill_attackers_dedupe_idx
        ON wh_structure_kill_attackers (
          killmail_id,
          attacker_index,
          COALESCE(character_id, 0),
          COALESCE(corporation_id, 0),
          COALESCE(alliance_id, 0),
          COALESCE(ship_type_id, 0),
          COALESCE(weapon_type_id, 0)
        );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS wh_structure_entity_names (
        entity_id bigint PRIMARY KEY,
        category text,
        name text,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS wh_structure_type_cache (
        type_id int PRIMARY KEY,
        type_name text,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS wh_structure_cache_state (
        key text PRIMARY KEY,
        value jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS wh_structure_alliance_groups (
        id text PRIMARY KEY,
        name text NOT NULL,
        description text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS wh_structure_alliance_group_members (
        group_id text NOT NULL REFERENCES wh_structure_alliance_groups(id) ON DELETE CASCADE,
        alliance_id bigint NOT NULL,
        alliance_name text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (group_id, alliance_id)
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS wh_structure_kills_time_idx
        ON wh_structure_kills(killmail_time);
      CREATE INDEX IF NOT EXISTS wh_structure_kills_system_idx
        ON wh_structure_kills(solar_system_id);
      CREATE INDEX IF NOT EXISTS wh_structure_kills_type_idx
        ON wh_structure_kills(structure_type_id);
      CREATE INDEX IF NOT EXISTS wh_structure_attackers_corp_idx
        ON wh_structure_kill_attackers(corporation_id);
      CREATE INDEX IF NOT EXISTS wh_structure_attackers_alliance_idx
        ON wh_structure_kill_attackers(alliance_id);
      CREATE INDEX IF NOT EXISTS wh_structure_attackers_killmail_idx
        ON wh_structure_kill_attackers(killmail_id);
      CREATE INDEX IF NOT EXISTS wh_structure_candidates_month_type_idx
        ON wh_structure_kill_candidates(candidate_month, candidate_type_id);
      CREATE UNIQUE INDEX IF NOT EXISTS wh_structure_alliance_groups_name_idx
        ON wh_structure_alliance_groups (lower(name));
      CREATE INDEX IF NOT EXISTS wh_structure_group_members_alliance_idx
        ON wh_structure_alliance_group_members(alliance_id);
    `);

    schemaReady = true;
  })();

  try {
    await schemaPromise;
  } catch (err) {
    schemaPromise = null;
    throw err;
  }
}

async function lookupTypesFromPublic(namesLower) {
  try {
    const { rows } = await pool.query(
      `
      SELECT type_id, type_name AS name
      FROM inv_types
      WHERE lower(type_name) = ANY($1)
      `,
      [namesLower]
    );
    return rows;
  } catch (err) {
    console.warn("[WH_STRUCTURE_STATS]: public inv_types lookup skipped:", err.message);
    return [];
  }
}

async function lookupTypesFromEvesde(namesLower) {
  try {
    const { rows } = await pool.query(
      `
      SELECT "typeID" AS type_id, "typeName" AS name
      FROM evesde."invTypes"
      WHERE lower("typeName") = ANY($1)
      `,
      [namesLower]
    );
    return rows;
  } catch (err) {
    console.warn("[WH_STRUCTURE_STATS]: evesde invTypes lookup skipped:", err.message);
    return [];
  }
}

async function upsertTypeCache(types) {
  if (!types.length) return;
  const values = [];
  const params = [];
  let i = 1;
  for (const type of types) {
    values.push(`($${i++}, $${i++}, now())`);
    params.push(type.type_id, type.name);
  }
  await pool.query(
    `
    INSERT INTO wh_structure_type_cache (type_id, type_name, updated_at)
    VALUES ${values.join(",")}
    ON CONFLICT (type_id) DO UPDATE SET
      type_name = EXCLUDED.type_name,
      updated_at = now()
    `,
    params
  );
}

async function getAllowedStructureTypes(opts = {}) {
  const now = Date.now();
  if (!opts.force && allowedCache && now - allowedCacheAt < 5 * 60 * 1000) {
    return allowedCache;
  }

  const namesLower = ALLOWED_STRUCTURE_NAMES.map((name) => name.toLowerCase());
  const publicRows = await lookupTypesFromPublic(namesLower);
  const evesdeRows = await lookupTypesFromEvesde(namesLower);
  const byName = new Map();
  for (const row of [...evesdeRows, ...publicRows]) {
    if (!row?.name || !row?.type_id) continue;
    byName.set(String(row.name).toLowerCase(), {
      type_id: Number(row.type_id),
      name: row.name,
    });
  }

  const sdeResolvedAny = byName.size > 0;
  const out = [];
  const seenTypeIds = new Set();
  for (const name of ALLOWED_STRUCTURE_NAMES) {
    const lower = name.toLowerCase();
    const resolved = byName.get(lower);
    const fallback = !sdeResolvedAny ? FALLBACK_NORMAL_TYPES.get(lower) : null;
    const row = resolved || fallback;
    if (!row || seenTypeIds.has(Number(row.type_id))) continue;
    seenTypeIds.add(Number(row.type_id));
    out.push({
      type_id: Number(row.type_id),
      name: row.name || name,
      enabled_default: true,
    });
  }

  out.sort((a, b) => {
    const ai = ALLOWED_STRUCTURE_NAMES.findIndex((name) => name.toLowerCase() === a.name.toLowerCase());
    const bi = ALLOWED_STRUCTURE_NAMES.findIndex((name) => name.toLowerCase() === b.name.toLowerCase());
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.name.localeCompare(b.name);
  });

  await upsertTypeCache(out);
  allowedCache = out;
  allowedCacheAt = now;
  return out;
}

function selectedTypeIdsFromInput(input, allowedTypes) {
  const allowedIds = new Set(allowedTypes.map((type) => Number(type.type_id)));
  const raw = Array.isArray(input)
    ? input
    : String(input || "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

  const ids = raw.length
    ? [...new Set(raw.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
    : allowedTypes.filter((type) => type.enabled_default).map((type) => Number(type.type_id));

  const invalid = ids.filter((id) => !allowedIds.has(id));
  if (invalid.length) {
    const err = new Error(`Unsupported structure type id(s): ${invalid.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }
  if (!ids.length) {
    const err = new Error("Select at least one structure type");
    err.statusCode = 400;
    throw err;
  }
  return ids;
}

function readZkbNumber(payload, keys) {
  for (const key of keys) {
    const val = key.split(".").reduce((obj, part) => (obj ? obj[part] : undefined), payload);
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeZkillCandidate(row, typeId, candidateMonth) {
  if (!row || typeof row !== "object") return null;
  const killmailId = Number(row.killmail_id || row.killID || row.kill_id || row.id);
  const hash = String(row.zkb?.hash || row.hash || row.killmail_hash || "").trim();
  if (!Number.isSafeInteger(killmailId) || killmailId <= 0 || !hash) return null;
  return {
    killmail_id: killmailId,
    hash,
    zkb_total_value: readZkbNumber(row, [
      "zkb.totalValue",
      "zkb.total_value",
      "zkb.value",
      "totalValue",
      "value",
    ]),
    zkb_destroyed_value: readZkbNumber(row, ["zkb.destroyedValue", "zkb.destroyed_value"]),
    zkb_dropped_value: readZkbNumber(row, ["zkb.droppedValue", "zkb.dropped_value"]),
    zkb_json: row,
    candidate_type_id: Number(typeId),
    candidate_month: candidateMonth,
  };
}

async function upsertCandidates(candidates) {
  if (!candidates.length) return;
  const values = [];
  const params = [];
  let i = 1;
  for (const c of candidates) {
    values.push(
      `($${i++},$${i++},'zkill',$${i++},$${i++},$${i++},$${i++}::jsonb,now(),$${i++},$${i++})`
    );
    params.push(
      c.killmail_id,
      c.hash,
      c.zkb_total_value,
      c.zkb_destroyed_value,
      c.zkb_dropped_value,
      jsonb(c.zkb_json, {}),
      c.candidate_type_id,
      c.candidate_month
    );
  }

  await pool.query(
    `
    INSERT INTO wh_structure_kill_candidates (
      killmail_id,
      hash,
      source,
      zkb_total_value,
      zkb_destroyed_value,
      zkb_dropped_value,
      zkb_json,
      discovered_at,
      candidate_type_id,
      candidate_month
    )
    VALUES ${values.join(",")}
    ON CONFLICT (killmail_id) DO UPDATE SET
      hash = EXCLUDED.hash,
      source = EXCLUDED.source,
      zkb_total_value = COALESCE(EXCLUDED.zkb_total_value, wh_structure_kill_candidates.zkb_total_value),
      zkb_destroyed_value = COALESCE(EXCLUDED.zkb_destroyed_value, wh_structure_kill_candidates.zkb_destroyed_value),
      zkb_dropped_value = COALESCE(EXCLUDED.zkb_dropped_value, wh_structure_kill_candidates.zkb_dropped_value),
      zkb_json = COALESCE(EXCLUDED.zkb_json, wh_structure_kill_candidates.zkb_json),
      candidate_type_id = COALESCE(EXCLUDED.candidate_type_id, wh_structure_kill_candidates.candidate_type_id),
      candidate_month = COALESCE(EXCLUDED.candidate_month, wh_structure_kill_candidates.candidate_month),
      discovered_at = now()
    `,
    params
  );
}

async function requestJson(method, url, opts = {}) {
  const retryStatuses = new Set([420, 429, 500, 502, 503, 504]);
  let attempt = 0;
  let delay = opts.initialDelayMs || 1200;

  while (true) {
    try {
      const headers = {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "User-Agent": UA,
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(opts.headers || {}),
      };

      let status;
      let retryAfter = null;
      let data;

      if (typeof global.fetch === "function") {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), opts.timeout || 30000);
        try {
          const res = await global.fetch(url, {
            method: method.toUpperCase(),
            headers,
            body: opts.body ? JSON.stringify(opts.body) : undefined,
            signal: controller.signal,
          });
          status = res.status;
          retryAfter = Number(res.headers.get("retry-after"));
          const text = await res.text();
          if (text.trim().startsWith("<")) {
            throw new Error(`${method.toUpperCase()} ${url} returned HTML instead of JSON`);
          }
          data = text ? JSON.parse(text) : null;
        } finally {
          clearTimeout(timeout);
        }
      } else {
        const res = await axios({
          method,
          url,
          data: opts.body,
          timeout: opts.timeout || 30000,
          validateStatus: () => true,
          headers,
        });
        status = res.status;
        retryAfter = Number(res.headers?.["retry-after"]);
        data = res.data;
        if (typeof data === "string" && data.trim().startsWith("<")) {
          throw new Error(`${method.toUpperCase()} ${url} returned HTML instead of JSON`);
        }
      }

      if (status === 404 && opts.emptyOn404) return null;
      if (retryStatuses.has(status) && attempt < MAX_HTTP_RETRIES) {
        await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : delay);
        attempt += 1;
        delay = Math.min(delay * 2, 20000);
        continue;
      }
      if (status < 200 || status >= 300) {
        throw new Error(`${method.toUpperCase()} ${url} failed: HTTP ${status}`);
      }
      if (data && typeof data === "object" && !Array.isArray(data) && data.error) {
        const err = new Error(`${method.toUpperCase()} ${url} failed: ${data.error}`);
        err.noRetry = true;
        throw err;
      }
      return data;
    } catch (err) {
      if (err?.noRetry) throw err;
      if (attempt >= MAX_HTTP_RETRIES) throw err;
      await sleep(delay);
      attempt += 1;
      delay = Math.min(delay * 2, 20000);
    }
  }
}

function pageSignature(rows) {
  return rows
    .map((row) => Number(row?.killmail_id || row?.killID || row?.id))
    .filter(Number.isFinite)
    .join(",");
}

async function fetchZkillCandidatesForMonthType({ typeId, year, month, onPage }) {
  const candidateMonth = monthKey(year, month);
  const seenPageSignatures = new Set();
  let requests = 0;
  let found = 0;

  for (let page = 1; page <= MAX_ZKILL_PAGES; page++) {
    const url = `${ZKILL_BASE}/losses/w-space/shipTypeID/${typeId}/year/${year}/month/${zkillMonthValue(month)}/page/${page}/`;
    const data = await requestJson("get", url, { timeout: 45000, emptyOn404: true });
    requests += 1;
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) {
      if (onPage) await onPage({ page, rows: 0, candidates: 0, requests: 1 });
      break;
    }

    const sig = pageSignature(rows);
    if (!sig || seenPageSignatures.has(sig)) break;
    seenPageSignatures.add(sig);

    const candidates = rows
      .map((row) => normalizeZkillCandidate(row, typeId, candidateMonth))
      .filter(Boolean);
    await upsertCandidates(candidates);
    found += candidates.length;

    if (onPage) {
      await onPage({ page, rows: rows.length, candidates: candidates.length, requests: 1 });
    }

    if (rows.length < 1000) break;
    await sleep(ZKILL_DELAY_MS);
  }

  return { requests, found };
}

async function selectCandidatesForHydration({ months, typeIds, forceRefresh }) {
  const { rows } = await pool.query(
    `
    SELECT c.*
    FROM wh_structure_kill_candidates c
    LEFT JOIN wh_structure_kills k ON k.killmail_id = c.killmail_id
    WHERE c.candidate_month = ANY($1::text[])
      AND c.candidate_type_id = ANY($2::int[])
      AND ($3::boolean OR k.killmail_id IS NULL)
    ORDER BY c.killmail_id ASC
    `,
    [months, typeIds, forceRefresh]
  );
  return rows;
}

async function hydrateKillmail(candidate) {
  const killmailId = Number(candidate.killmail_id);
  const hash = String(candidate.hash || "").trim();
  if (!Number.isSafeInteger(killmailId) || !hash) {
    throw new Error(`Candidate ${candidate.killmail_id || "unknown"} is missing killmail id/hash`);
  }
  const url = `${ESI_BASE}/killmails/${killmailId}/${encodeURIComponent(hash)}/?datasource=tranquility`;
  return requestJson("get", url, { timeout: 30000, emptyOn404: true });
}

async function wormholeMappingAvailable() {
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM wormhole_systems`);
    return Number(rows[0]?.count || 0) > 0;
  } catch {
    return false;
  }
}

async function getWormholeInfo(solarSystemId) {
  try {
    const { rows } = await pool.query(
      `
      SELECT jcode, class
      FROM wormhole_systems
      WHERE solarsystemid = $1
      LIMIT 1
      `,
      [String(solarSystemId)]
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

function valueFromCandidate(candidate) {
  const raw = candidate?.zkb_json || {};
  return (
    numericOrNull(candidate?.zkb_total_value) ??
    readZkbNumber(raw, ["zkb.totalValue", "zkb.total_value", "totalValue", "value"]) ??
    0
  );
}

async function normalizeKillmail({
  esi,
  candidate,
  selectedTypes,
  range,
  requireKnownWormhole,
}) {
  if (!esi || typeof esi !== "object") return { skip: "empty_esi" };
  const victim = esi.victim || {};
  const typeId = Number(victim.ship_type_id);
  if (!selectedTypes.has(typeId)) return { skip: "type_outside_selection" };

  const killTime = new Date(esi.killmail_time);
  if (Number.isNaN(killTime.getTime())) return { skip: "missing_killmail_time" };
  if (killTime < range.start || killTime >= range.endExclusive) return { skip: "outside_date_range" };

  const solarSystemId = Number(esi.solar_system_id);
  if (!Number.isInteger(solarSystemId)) return { skip: "missing_solar_system" };
  const wh = await getWormholeInfo(solarSystemId);
  if (requireKnownWormhole && !wh) return { skip: "not_known_wormhole_system" };

  const attackers = Array.isArray(esi.attackers) ? esi.attackers : [];
  const typeMeta = selectedTypes.get(typeId);

  return {
    killmail_id: Number(esi.killmail_id),
    killmail_time: esi.killmail_time,
    solar_system_id: solarSystemId,
    jcode: wh?.jcode || null,
    wormhole_class: wh?.class || null,
    victim_corporation_id: victim.corporation_id || null,
    victim_alliance_id: victim.alliance_id || null,
    victim_character_id: victim.character_id || null,
    structure_type_id: typeId,
    structure_type_name: typeMeta?.name || `Type ${typeId}`,
    zkb_total_value: valueFromCandidate(candidate),
    raw: esi,
    attackers: attackers.map((attacker, index) => ({
      attacker_index: index,
      character_id: attacker.character_id || null,
      corporation_id: attacker.corporation_id || null,
      alliance_id: attacker.alliance_id || null,
      ship_type_id: attacker.ship_type_id || null,
      weapon_type_id: attacker.weapon_type_id || null,
      damage_done: Math.max(0, Math.floor(toNumber(attacker.damage_done, 0))),
      final_blow: attacker.final_blow === true,
    })),
  };
}

async function upsertKill(normalized) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      `${UPSERT_STATEMENT_TIMEOUT_MS}ms`,
    ]);
    await client.query(
      `
      INSERT INTO wh_structure_kills (
        killmail_id,
        killmail_time,
        solar_system_id,
        jcode,
        wormhole_class,
        victim_corporation_id,
        victim_alliance_id,
        victim_character_id,
        structure_type_id,
        structure_type_name,
        zkb_total_value,
        raw,
        hydrated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,now())
      ON CONFLICT (killmail_id) DO UPDATE SET
        killmail_time = EXCLUDED.killmail_time,
        solar_system_id = EXCLUDED.solar_system_id,
        jcode = EXCLUDED.jcode,
        wormhole_class = EXCLUDED.wormhole_class,
        victim_corporation_id = EXCLUDED.victim_corporation_id,
        victim_alliance_id = EXCLUDED.victim_alliance_id,
        victim_character_id = EXCLUDED.victim_character_id,
        structure_type_id = EXCLUDED.structure_type_id,
        structure_type_name = EXCLUDED.structure_type_name,
        zkb_total_value = EXCLUDED.zkb_total_value,
        raw = EXCLUDED.raw,
        hydrated_at = now()
      `,
      [
        normalized.killmail_id,
        normalized.killmail_time,
        normalized.solar_system_id,
        normalized.jcode,
        normalized.wormhole_class,
        normalized.victim_corporation_id,
        normalized.victim_alliance_id,
        normalized.victim_character_id,
        normalized.structure_type_id,
        normalized.structure_type_name,
        normalized.zkb_total_value,
        jsonb(normalized.raw, {}),
      ]
    );

    await client.query(`DELETE FROM wh_structure_kill_attackers WHERE killmail_id = $1`, [
      normalized.killmail_id,
    ]);

    for (let start = 0; start < normalized.attackers.length; start += ATTACKER_INSERT_CHUNK_SIZE) {
      const chunk = normalized.attackers.slice(start, start + ATTACKER_INSERT_CHUNK_SIZE);
      const values = [];
      const params = [];
      let i = 1;
      for (const attacker of chunk) {
        values.push(`($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`);
        params.push(
          normalized.killmail_id,
          attacker.attacker_index,
          attacker.character_id,
          attacker.corporation_id,
          attacker.alliance_id,
          attacker.ship_type_id,
          attacker.weapon_type_id,
          attacker.damage_done,
          attacker.final_blow
        );
      }
      await client.query(
        `
        INSERT INTO wh_structure_kill_attackers (
          killmail_id,
          attacker_index,
          character_id,
          corporation_id,
          alliance_id,
          ship_type_id,
          weapon_type_id,
          damage_done,
          final_blow
        ) VALUES ${values.join(",")}
        ON CONFLICT DO NOTHING
        `,
        params
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function updateJob(jobId, patch) {
  const fields = [];
  const params = [jobId];
  let i = 2;
  for (const [key, value] of Object.entries(patch)) {
    if (key === "progress") {
      fields.push(`progress = $${i++}::jsonb`);
      params.push(jsonb(value, {}));
    } else {
      fields.push(`${key} = $${i++}`);
      params.push(value);
    }
  }
  if (!fields.length) return;
  await pool.query(
    `UPDATE wh_structure_stat_jobs SET ${fields.join(", ")}, updated_at = now() WHERE id = $1`,
    params
  );
}

async function getJob(jobId) {
  const { rows } = await pool.query(
    `
    SELECT id, status, started_at, finished_at, created_at, updated_at, start_date, end_date,
           selected_type_ids, progress, error
    FROM wh_structure_stat_jobs
    WHERE id = $1
    `,
    [jobId]
  );
  return rows[0] || null;
}

async function getActiveJob() {
  const { rows } = await pool.query(
    `
    SELECT id, status, started_at, finished_at, created_at, updated_at, start_date, end_date,
           selected_type_ids, progress, error
    FROM wh_structure_stat_jobs
    WHERE status IN ('queued','running')
    ORDER BY created_at DESC
    LIMIT 1
    `
  );
  return rows[0] || null;
}

function compactJob(row) {
  if (!row) return null;
  return {
    jobId: row.id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startDate: dateOnly(new Date(row.start_date)),
    endDate: dateOnly(new Date(row.end_date)),
    selectedTypeIds: row.selected_type_ids || [],
    progress: row.progress || {},
    error: row.error || null,
  };
}

async function getCacheState(key) {
  const { rows } = await pool.query(
    `SELECT value, updated_at FROM wh_structure_cache_state WHERE key = $1`,
    [key]
  );
  return rows[0] || null;
}

async function markPreviousProcessJobsStale() {
  const { rows } = await pool.query(
    `
    UPDATE wh_structure_stat_jobs
    SET
      status = 'error',
      finished_at = COALESCE(finished_at, now()),
      updated_at = now(),
      error = COALESCE(error, 'Backend restarted before this in-process job completed; a new cache job can resume from stored rows.'),
      progress = progress
        || jsonb_build_object(
          'status', 'error',
          'phase', 'error',
          'stale', true,
          'staleReason', 'backend_restart',
          'staleMarkedAt', now()
        )
    WHERE status IN ('queued','running')
      AND created_at < $1
    RETURNING id
    `,
    [processStartedAt]
  );
  if (rows.length) {
    console.warn(
      `[WH_STRUCTURE_STATS]: marked ${rows.length} stale in-process job(s) from a previous backend process: ${rows
        .map((row) => row.id)
        .join(", ")}`
    );
  }
}

async function setCacheState(key, value) {
  await pool.query(
    `
    INSERT INTO wh_structure_cache_state (key, value, updated_at)
    VALUES ($1, $2::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = now()
    `,
    [key, jsonb(value, {})]
  );
}

async function countRollingWindowKills() {
  const window = rollingWindow();
  const { rows } = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM wh_structure_kills
    WHERE killmail_time >= $1::date
      AND killmail_time < ($2::date + interval '1 day')
    `,
    [window.startDate, window.endDate]
  );
  return Number(rows[0]?.count || 0);
}

async function hasRollingBackfillCache() {
  const state = await getCacheState("rolling_backfill");
  if (state?.value?.completedAt) return true;

  const { rows } = await pool.query(
    `
    SELECT id
    FROM wh_structure_stat_jobs
    WHERE status = 'done'
      AND progress->>'jobKind' = 'rolling_backfill'
    ORDER BY finished_at DESC NULLS LAST, created_at DESC
    LIMIT 1
    `
  );
  if (rows[0]?.id) return true;

  return false;
}

function initialJobProgress({ jobKind, warning = null }) {
  return {
    status: "queued",
    phase: "queued",
    jobKind,
    percent: 0,
    warning,
  };
}

function jobWarning(jobKind, range) {
  if (jobKind === "rolling_backfill") {
    return "Backfilling the rolling 3-year cache. This is intentionally paced to be polite to zKill.";
  }
  if (jobKind === "rolling_daily_refresh") {
    return "Daily rolling cache refresh is filling recent structure kills and pruning older rows.";
  }
  return range.days > 366
    ? "Large range selected; this can take a while, but zKill candidates and hydrated killmails are cached."
    : null;
}

async function createScanJob({ range, typeIds, forceRefresh = false, jobKind = "manual_scan" }) {
  const active = await getActiveJob();
  if (active) {
    const err = new Error(`Another WH Structure Stats job is already ${active.status}`);
    err.statusCode = 409;
    err.activeJobId = active.id;
    throw err;
  }

  const jobId = createJobId();
  const initialProgress = initialJobProgress({
    jobKind,
    warning: jobWarning(jobKind, range),
  });

  await pool.query(
    `
    INSERT INTO wh_structure_stat_jobs (
      id,
      status,
      start_date,
      end_date,
      selected_type_ids,
      progress
    ) VALUES ($1,'queued',$2,$3,$4,$5::jsonb)
    `,
    [jobId, range.startDate, range.endDate, typeIds, jsonb(initialProgress, {})]
  );

  setImmediate(() => {
    runJob(jobId, { range, typeIds, forceRefresh, jobKind }).catch((err) => {
      console.error(`[WH_STRUCTURE_STATS]: job ${jobId} failed`, err);
    });
  });

  return { jobId, status: "queued" };
}

function appendProgressError(progress, err) {
  const errors = Array.isArray(progress.errors) ? progress.errors.slice(-19) : [];
  errors.push(String(err?.message || err).slice(0, 500));
  progress.errors = errors;
}

function addSkip(progress, reason) {
  const key = String(reason || "unknown");
  progress.skipped += 1;
  progress.skipReasons = {
    ...(progress.skipReasons || {}),
    [key]: Number(progress.skipReasons?.[key] || 0) + 1,
  };
}

async function runJob(jobId, options) {
  const allowedTypes = await getAllowedStructureTypes();
  const selectedTypeMap = new Map(
    allowedTypes
      .filter((type) => options.typeIds.includes(Number(type.type_id)))
      .map((type) => [Number(type.type_id), type])
  );
  const months = monthList(options.range.start, options.range.end);
  const monthKeys = months.map(({ year, month }) => monthKey(year, month));
  const totalDiscoverySteps = Math.max(1, months.length * selectedTypeMap.size);
  const requireKnownWormhole = await wormholeMappingAvailable();

  const progress = {
    phase: "discovering",
    status: "running",
    jobKind: options.jobKind || "manual_scan",
    currentMonth: null,
    currentType: null,
    currentPage: null,
    currentKillmailId: null,
    hydrationIndex: 0,
    lastHydratedKillmailId: null,
    zkillRequests: 0,
    candidatesFound: 0,
    candidatesToHydrate: 0,
    hydrated: 0,
    skipped: 0,
    skipReasons: {},
    errors: [],
    percent: 0,
    totalDiscoverySteps,
    completedDiscoverySteps: 0,
    warning: jobWarning(options.jobKind || "manual_scan", options.range),
  };

  await updateJob(jobId, {
    status: "running",
    started_at: new Date(),
    progress,
    error: null,
  });

  console.log(
    `[WH_STRUCTURE_STATS]: job ${jobId} started (${progress.jobKind}) for ${options.range.startDate} to ${options.range.endDate}; ${selectedTypeMap.size} structure types`
  );

  try {
    for (const { year, month } of months) {
      for (const type of selectedTypeMap.values()) {
        progress.phase = "discovering";
        progress.currentMonth = monthKey(year, month);
        progress.currentType = { type_id: type.type_id, name: type.name };
        progress.currentPage = 1;
        await updateJob(jobId, { progress });

        try {
          await fetchZkillCandidatesForMonthType({
            typeId: type.type_id,
            year,
            month,
            onPage: async ({ page, candidates, requests }) => {
              progress.currentPage = page;
              progress.zkillRequests += requests;
              progress.candidatesFound += candidates;
              progress.percent = Math.min(
                45,
                Math.round((progress.completedDiscoverySteps / totalDiscoverySteps) * 45)
              );
              await updateJob(jobId, { progress });
            },
          });
        } catch (err) {
          appendProgressError(progress, err);
        }

        progress.completedDiscoverySteps += 1;
        progress.percent = Math.min(
          45,
          Math.round((progress.completedDiscoverySteps / totalDiscoverySteps) * 45)
        );
        await updateJob(jobId, { progress });
        await sleep(ZKILL_DELAY_MS);
      }
    }

    const candidates = await selectCandidatesForHydration({
      months: monthKeys,
      typeIds: options.typeIds,
      forceRefresh: options.forceRefresh,
    });
    progress.phase = "hydrating";
    progress.currentPage = null;
    progress.candidatesToHydrate = candidates.length;
    progress.percent = candidates.length ? 45 : 100;
    await updateJob(jobId, { progress });

    for (let idx = 0; idx < candidates.length; idx++) {
      const candidate = candidates[idx];
      progress.hydrationIndex = idx + 1;
      progress.currentKillmailId = Number(candidate.killmail_id);
      progress.currentKillmailStartedAt = new Date().toISOString();
      await updateJob(jobId, { progress });
      try {
        const esi = await hydrateKillmail(candidate);
        if (!esi) {
          addSkip(progress, "esi_not_found");
        } else {
          const normalized = await normalizeKillmail({
            esi,
            candidate,
            selectedTypes: selectedTypeMap,
            range: options.range,
            requireKnownWormhole,
          });

          if (normalized.skip) {
            addSkip(progress, normalized.skip);
          } else {
            await upsertKill(normalized);
            progress.hydrated += 1;
            progress.lastHydratedKillmailId = normalized.killmail_id;
          }
        }
      } catch (err) {
        addSkip(progress, "hydrate_error");
        appendProgressError(progress, err);
      }

      if (ESI_DELAY_MS) await sleep(ESI_DELAY_MS);
      if ((idx + 1) % 5 === 0 || idx + 1 === candidates.length) {
        progress.percent = candidates.length
          ? Math.min(99, 45 + Math.round(((idx + 1) / candidates.length) * 54))
          : 100;
        await updateJob(jobId, { progress });
      }
    }

    progress.phase = "done";
    progress.status = "done";
    progress.currentMonth = null;
    progress.currentType = null;
    progress.currentKillmailId = null;
    progress.percent = 100;
    await updateJob(jobId, {
      status: "done",
      finished_at: new Date(),
      progress,
      error: null,
    });
    if (options.jobKind === "rolling_backfill") {
      await setCacheState("rolling_backfill", {
        completedAt: new Date().toISOString(),
        startDate: options.range.startDate,
        endDate: options.range.endDate,
        selectedTypeIds: options.typeIds,
        hydrated: progress.hydrated,
        skipped: progress.skipped,
        candidatesFound: progress.candidatesFound,
      });
    } else if (options.jobKind === "rolling_daily_refresh") {
      await setCacheState("rolling_daily_refresh", {
        completedAt: new Date().toISOString(),
        startDate: options.range.startDate,
        endDate: options.range.endDate,
        selectedTypeIds: options.typeIds,
        hydrated: progress.hydrated,
        skipped: progress.skipped,
        candidatesFound: progress.candidatesFound,
      });
    }
    console.log(
      `[WH_STRUCTURE_STATS]: job ${jobId} done (${progress.jobKind}); candidates=${progress.candidatesFound}, hydrated=${progress.hydrated}, skipped=${progress.skipped}`
    );
  } catch (err) {
    appendProgressError(progress, err);
    progress.phase = "error";
    progress.status = "error";
    await updateJob(jobId, {
      status: "error",
      finished_at: new Date(),
      progress,
      error: err.message || String(err),
    });
    console.error(
      `[WH_STRUCTURE_STATS]: job ${jobId} errored (${progress.jobKind}): ${err.message || err}`
    );
  }
}

async function resolveEntityNames(ids) {
  const unique = [...new Set(ids.map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  const out = new Map();
  if (!unique.length) return out;

  const { rows } = await pool.query(
    `
    SELECT entity_id, category, name
    FROM wh_structure_entity_names
    WHERE entity_id = ANY($1::bigint[])
    `,
    [unique]
  );
  for (const row of rows) {
    if (row.name) out.set(Number(row.entity_id), { name: row.name, category: row.category });
  }

  const missing = unique.filter((id) => !out.has(id));
  for (let i = 0; i < missing.length; i += 900) {
    const chunk = missing.slice(i, i + 900);
    try {
      const data = await requestJson("post", `${ESI_BASE}/universe/names/?datasource=tranquility`, {
        body: chunk,
        timeout: 30000,
      });
      const values = [];
      const params = [];
      let p = 1;
      for (const row of data || []) {
        if (!row?.id || !row?.name) continue;
        out.set(Number(row.id), { name: row.name, category: row.category || null });
        values.push(`($${p++},$${p++},$${p++},now())`);
        params.push(Number(row.id), row.category || null, row.name);
      }
      if (values.length) {
        await pool.query(
          `
          INSERT INTO wh_structure_entity_names (entity_id, category, name, updated_at)
          VALUES ${values.join(",")}
          ON CONFLICT (entity_id) DO UPDATE SET
            category = EXCLUDED.category,
            name = EXCLUDED.name,
            updated_at = now()
          `,
          params
        );
      }
    } catch (err) {
      console.warn("[WH_STRUCTURE_STATS]: ESI name lookup skipped:", err.message);
    }
    await sleep(150);
  }

  return out;
}

function fallbackEntityName(groupBy, id) {
  return `${groupBy === "alliance" ? "Alliance" : "Corporation"} ${id}`;
}

function normalizeGroupName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 120) {
    const err = new Error("Group name must be 1-120 characters");
    err.statusCode = 400;
    throw err;
  }
  return name;
}

function normalizeGroupDescription(value) {
  const description = String(value || "").trim();
  return description ? description.slice(0, 500) : null;
}

function allianceIdsFromInput(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || "")
        .split(/[\s,]+/)
        .map((part) => part.trim())
        .filter(Boolean);

  const ids = [];
  for (const item of raw) {
    const value = typeof item === "object" && item !== null
      ? item.allianceId ?? item.alliance_id ?? item.id
      : item;
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
      const err = new Error(`Invalid alliance id: ${value}`);
      err.statusCode = 400;
      throw err;
    }
    ids.push(id);
  }
  return [...new Set(ids)];
}

async function resolveAllianceMembers(allianceIds) {
  const ids = [...new Set(allianceIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return [];
  const names = await resolveEntityNames(ids);
  const invalid = ids.filter((id) => {
    const category = names.get(id)?.category;
    return category && String(category).toLowerCase() !== "alliance";
  });
  if (invalid.length) {
    const err = new Error(`Only alliance IDs can be added to alliance groups: ${invalid.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }
  return ids.map((id) => ({
    allianceId: id,
    allianceName: names.get(id)?.name || `Alliance ${id}`,
  }));
}

function compactAllianceGroup(group, members) {
  return {
    id: group.id,
    name: group.name,
    description: group.description || "",
    members: members.map((member) => ({
      allianceId: Number(member.alliance_id ?? member.allianceId),
      allianceName: member.alliance_name ?? member.allianceName ?? `Alliance ${member.alliance_id ?? member.allianceId}`,
    })),
    memberCount: members.length,
    createdAt: group.created_at,
    updatedAt: group.updated_at,
  };
}

async function listAllianceGroups() {
  const { rows: groups } = await pool.query(`
    SELECT id, name, description, created_at, updated_at
    FROM wh_structure_alliance_groups
    ORDER BY lower(name)
  `);
  if (!groups.length) return [];

  const { rows: members } = await pool.query(
    `
    SELECT group_id, alliance_id, alliance_name
    FROM wh_structure_alliance_group_members
    WHERE group_id = ANY($1::text[])
    ORDER BY alliance_name NULLS LAST, alliance_id
    `,
    [groups.map((group) => group.id)]
  );
  const byGroup = new Map(groups.map((group) => [group.id, []]));
  for (const member of members) {
    byGroup.get(member.group_id)?.push(member);
  }
  return groups.map((group) => compactAllianceGroup(group, byGroup.get(group.id) || []));
}

async function getAllianceGroup(groupId) {
  const { rows } = await pool.query(
    `
    SELECT id, name, description, created_at, updated_at
    FROM wh_structure_alliance_groups
    WHERE id = $1
    `,
    [groupId]
  );
  if (!rows[0]) return null;
  const { rows: members } = await pool.query(
    `
    SELECT group_id, alliance_id, alliance_name
    FROM wh_structure_alliance_group_members
    WHERE group_id = $1
    ORDER BY alliance_name NULLS LAST, alliance_id
    `,
    [groupId]
  );
  return compactAllianceGroup(rows[0], members);
}

async function writeAllianceGroup({ groupId, name, description, allianceIds }) {
  const resolvedName = normalizeGroupName(name);
  const resolvedDescription = normalizeGroupDescription(description);
  const members = await resolveAllianceMembers(allianceIdsFromInput(allianceIds));
  const id = groupId || createAllianceGroupId(resolvedName);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (groupId) {
      const updated = await client.query(
        `
        UPDATE wh_structure_alliance_groups
        SET name = $2, description = $3, updated_at = now()
        WHERE id = $1
        RETURNING id
        `,
        [id, resolvedName, resolvedDescription]
      );
      if (!updated.rowCount) {
        const err = new Error("Alliance group not found");
        err.statusCode = 404;
        throw err;
      }
    } else {
      await client.query(
        `
        INSERT INTO wh_structure_alliance_groups (id, name, description, created_at, updated_at)
        VALUES ($1, $2, $3, now(), now())
        `,
        [id, resolvedName, resolvedDescription]
      );
    }

    await client.query(`DELETE FROM wh_structure_alliance_group_members WHERE group_id = $1`, [id]);
    for (const member of members) {
      await client.query(
        `
        INSERT INTO wh_structure_alliance_group_members (
          group_id,
          alliance_id,
          alliance_name,
          created_at,
          updated_at
        ) VALUES ($1,$2,$3,now(),now())
        ON CONFLICT (group_id, alliance_id) DO UPDATE SET
          alliance_name = EXCLUDED.alliance_name,
          updated_at = now()
        `,
        [id, member.allianceId, member.allianceName]
      );
    }

    await client.query("COMMIT");
    return getAllianceGroup(id);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      const conflict = new Error("An alliance group with that name already exists");
      conflict.statusCode = 400;
      throw conflict;
    }
    throw err;
  } finally {
    client.release();
  }
}

function wormholeClassNumber(value) {
  const match = String(value || "").trim().toUpperCase().match(/^C?([1-6])$/);
  return match ? Number(match[1]) : null;
}

function wormholeClassLabel(value) {
  const classNumber = wormholeClassNumber(value);
  if (classNumber) return `C${classNumber}`;
  const raw = String(value || "").trim();
  return raw || null;
}

function isLowClassWormhole(value) {
  const classNumber = wormholeClassNumber(value);
  return classNumber !== null && classNumber >= 1 && classNumber <= 4;
}

function lowClassSql(column) {
  return `regexp_replace(upper(COALESCE(${column}, '')), '^C', '') IN ('1','2','3','4')`;
}

function lowClassUniqueJcodesSql(jcodeColumn, classColumn) {
  return `COUNT(DISTINCT ${jcodeColumn}) FILTER (WHERE ${jcodeColumn} IS NOT NULL AND ${lowClassSql(classColumn)})::int`;
}

async function refreshMissingWormholeInfo() {
  try {
    await pool.query(`
      UPDATE wh_structure_kills k
      SET
        jcode = COALESCE(k.jcode, w.jcode),
        wormhole_class = COALESCE(k.wormhole_class, w.class)
      FROM wormhole_systems w
      WHERE k.solar_system_id::text = w.solarsystemid
        AND (k.jcode IS NULL OR k.wormhole_class IS NULL)
    `);
  } catch (err) {
    console.warn("[WH_STRUCTURE_STATS]: wormhole metadata refresh skipped:", err.message);
  }
}

async function aggregateSummary({ range, typeIds, groupBy }) {
  await refreshMissingWormholeInfo();
  const entityColumn = groupBy === "alliance" ? "a.alliance_id" : "a.corporation_id";
  const { rows: totalRows } = await pool.query(
    `
    SELECT
      COUNT(*)::int AS structure_kills,
      COUNT(DISTINCT jcode) FILTER (WHERE jcode IS NOT NULL)::int AS unique_jcodes,
      ${lowClassUniqueJcodesSql("jcode", "wormhole_class")} AS low_class_evictions,
      COUNT(DISTINCT victim_corporation_id) FILTER (WHERE victim_corporation_id IS NOT NULL)::int AS unique_victim_corps,
      COALESCE(SUM(zkb_total_value), 0)::numeric AS total_value
    FROM wh_structure_kills
    WHERE killmail_time >= $1::date
      AND killmail_time < ($2::date + interval '1 day')
      AND structure_type_id = ANY($3::int[])
    `,
    [range.startDate, range.endDate, typeIds]
  );

  const { rows } = await pool.query(
    `
    WITH scoped_kills AS (
      SELECT *
      FROM wh_structure_kills
      WHERE killmail_time >= $1::date
        AND killmail_time < ($2::date + interval '1 day')
        AND structure_type_id = ANY($3::int[])
    ),
    per_kill_entity AS (
      SELECT
        k.killmail_id,
        k.killmail_time,
        k.jcode,
        k.wormhole_class,
        k.victim_corporation_id,
        k.structure_type_name,
        k.zkb_total_value,
        ${entityColumn} AS entity_id
      FROM scoped_kills k
      JOIN wh_structure_kill_attackers a ON a.killmail_id = k.killmail_id
      WHERE ${entityColumn} IS NOT NULL
      GROUP BY
        k.killmail_id,
        k.killmail_time,
        k.jcode,
        k.wormhole_class,
        k.victim_corporation_id,
        k.structure_type_name,
        k.zkb_total_value,
        ${entityColumn}
    ),
    type_counts AS (
      SELECT
        entity_id,
        jsonb_object_agg(structure_type_name, kill_count ORDER BY structure_type_name) AS structure_types
      FROM (
        SELECT entity_id, structure_type_name, COUNT(*)::int AS kill_count
        FROM per_kill_entity
        GROUP BY entity_id, structure_type_name
      ) t
      GROUP BY entity_id
    )
    SELECT
      p.entity_id,
      COUNT(*)::int AS structure_kills_on,
      COUNT(DISTINCT p.jcode) FILTER (WHERE p.jcode IS NOT NULL)::int AS unique_jcodes,
      ${lowClassUniqueJcodesSql("p.jcode", "p.wormhole_class")} AS low_class_evictions,
      COUNT(DISTINCT p.victim_corporation_id) FILTER (WHERE p.victim_corporation_id IS NOT NULL)::int AS unique_victim_corps,
      COALESCE(SUM(p.zkb_total_value), 0)::numeric AS total_value,
      MAX(p.killmail_time) AS last_seen,
      COALESCE(t.structure_types, '{}'::jsonb) AS structure_types
    FROM per_kill_entity p
    LEFT JOIN type_counts t ON t.entity_id = p.entity_id
    GROUP BY p.entity_id, t.structure_types
    ORDER BY structure_kills_on DESC, total_value DESC, last_seen DESC
    LIMIT 500
    `,
    [range.startDate, range.endDate, typeIds]
  );

  const names = await resolveEntityNames(rows.map((row) => row.entity_id));
  const totals = totalRows[0] || {};

  return {
    range: {
      startDate: range.startDate,
      endDate: range.endDate,
      typeIds,
    },
    groupBy,
    totals: {
      structureKills: Number(totals.structure_kills || 0),
      uniqueJcodes: Number(totals.unique_jcodes || 0),
      lowClassEvictions: Number(totals.low_class_evictions || 0),
      uniqueVictimCorps: Number(totals.unique_victim_corps || 0),
      totalValue: Number(totals.total_value || 0),
    },
    rows: rows.map((row) => {
      const id = Number(row.entity_id);
      return {
        entityId: id,
        entityName: names.get(id)?.name || fallbackEntityName(groupBy, id),
        structureKillsOn: Number(row.structure_kills_on || 0),
        uniqueJcodes: Number(row.unique_jcodes || 0),
        lowClassEvictions: Number(row.low_class_evictions || 0),
        uniqueVictimCorps: Number(row.unique_victim_corps || 0),
        totalValue: Number(row.total_value || 0),
        structureTypes: row.structure_types || {},
        lastSeen: row.last_seen,
      };
    }),
  };
}

async function aggregateAllianceGroupSummary({ range, typeIds }) {
  await refreshMissingWormholeInfo();
  const { rows: totalRows } = await pool.query(
    `
    WITH scoped_kills AS (
      SELECT *
      FROM wh_structure_kills
      WHERE killmail_time >= $1::date
        AND killmail_time < ($2::date + interval '1 day')
        AND structure_type_id = ANY($3::int[])
    ),
    per_kill_group AS (
      SELECT DISTINCT
        gm.group_id,
        k.killmail_id,
        k.jcode,
        k.wormhole_class,
        k.victim_corporation_id,
        k.zkb_total_value
      FROM scoped_kills k
      JOIN wh_structure_kill_attackers a ON a.killmail_id = k.killmail_id
      JOIN wh_structure_alliance_group_members gm ON gm.alliance_id = a.alliance_id
    ),
    matched_kills AS (
      SELECT DISTINCT
        killmail_id,
        jcode,
        wormhole_class,
        victim_corporation_id,
        zkb_total_value
      FROM per_kill_group
    )
    SELECT
      COUNT(*)::int AS structure_kills,
      COUNT(DISTINCT jcode) FILTER (WHERE jcode IS NOT NULL)::int AS unique_jcodes,
      ${lowClassUniqueJcodesSql("jcode", "wormhole_class")} AS low_class_evictions,
      COUNT(DISTINCT victim_corporation_id) FILTER (WHERE victim_corporation_id IS NOT NULL)::int AS unique_victim_corps,
      COALESCE(SUM(zkb_total_value), 0)::numeric AS total_value
    FROM matched_kills
    `,
    [range.startDate, range.endDate, typeIds]
  );

  const { rows } = await pool.query(
    `
    WITH scoped_kills AS (
      SELECT *
      FROM wh_structure_kills
      WHERE killmail_time >= $1::date
        AND killmail_time < ($2::date + interval '1 day')
        AND structure_type_id = ANY($3::int[])
    ),
    per_kill_group AS (
      SELECT DISTINCT
        gm.group_id,
        k.killmail_id,
        k.killmail_time,
        k.jcode,
        k.wormhole_class,
        k.victim_corporation_id,
        k.structure_type_name,
        k.zkb_total_value
      FROM scoped_kills k
      JOIN wh_structure_kill_attackers a ON a.killmail_id = k.killmail_id
      JOIN wh_structure_alliance_group_members gm ON gm.alliance_id = a.alliance_id
    ),
    type_counts AS (
      SELECT
        group_id,
        jsonb_object_agg(structure_type_name, kill_count ORDER BY structure_type_name) AS structure_types
      FROM (
        SELECT group_id, structure_type_name, COUNT(*)::int AS kill_count
        FROM per_kill_group
        GROUP BY group_id, structure_type_name
      ) t
      GROUP BY group_id
    ),
    group_totals AS (
      SELECT
        group_id,
        COUNT(*)::int AS structure_kills_on,
        COUNT(DISTINCT jcode) FILTER (WHERE jcode IS NOT NULL)::int AS unique_jcodes,
        ${lowClassUniqueJcodesSql("jcode", "wormhole_class")} AS low_class_evictions,
        COUNT(DISTINCT victim_corporation_id) FILTER (WHERE victim_corporation_id IS NOT NULL)::int AS unique_victim_corps,
        COALESCE(SUM(zkb_total_value), 0)::numeric AS total_value,
        MAX(killmail_time) AS last_seen
      FROM per_kill_group
      GROUP BY group_id
    ),
    member_counts AS (
      SELECT
        group_id,
        COUNT(*)::int AS member_count,
        ARRAY_AGG(COALESCE(alliance_name, 'Alliance ' || alliance_id::text) ORDER BY COALESCE(alliance_name, 'Alliance ' || alliance_id::text)) AS member_names
      FROM wh_structure_alliance_group_members
      GROUP BY group_id
    )
    SELECT
      g.id AS group_id,
      g.name AS group_name,
      COALESCE(gt.structure_kills_on, 0)::int AS structure_kills_on,
      COALESCE(gt.unique_jcodes, 0)::int AS unique_jcodes,
      COALESCE(gt.low_class_evictions, 0)::int AS low_class_evictions,
      COALESCE(gt.unique_victim_corps, 0)::int AS unique_victim_corps,
      COALESCE(gt.total_value, 0)::numeric AS total_value,
      gt.last_seen,
      COALESCE(t.structure_types, '{}'::jsonb) AS structure_types,
      COALESCE(mc.member_count, 0)::int AS member_count,
      COALESCE(mc.member_names, ARRAY[]::text[]) AS member_names
    FROM wh_structure_alliance_groups g
    LEFT JOIN group_totals gt ON gt.group_id = g.id
    LEFT JOIN type_counts t ON t.group_id = g.id
    LEFT JOIN member_counts mc ON mc.group_id = g.id
    ORDER BY structure_kills_on DESC, total_value DESC, group_name ASC
    LIMIT 500
    `,
    [range.startDate, range.endDate, typeIds]
  );

  const totals = totalRows[0] || {};
  return {
    range: {
      startDate: range.startDate,
      endDate: range.endDate,
      typeIds,
    },
    groupBy: "allianceGroup",
    totals: {
      structureKills: Number(totals.structure_kills || 0),
      uniqueJcodes: Number(totals.unique_jcodes || 0),
      lowClassEvictions: Number(totals.low_class_evictions || 0),
      uniqueVictimCorps: Number(totals.unique_victim_corps || 0),
      totalValue: Number(totals.total_value || 0),
    },
    rows: rows.map((row) => ({
      entityId: row.group_id,
      entityName: row.group_name,
      structureKillsOn: Number(row.structure_kills_on || 0),
      uniqueJcodes: Number(row.unique_jcodes || 0),
      lowClassEvictions: Number(row.low_class_evictions || 0),
      uniqueVictimCorps: Number(row.unique_victim_corps || 0),
      totalValue: Number(row.total_value || 0),
      structureTypes: row.structure_types || {},
      lastSeen: row.last_seen,
      memberCount: Number(row.member_count || 0),
      memberNames: row.member_names || [],
    })),
  };
}

async function getEntityKills({ range, typeIds, entityType, entityId, limit }) {
  await refreshMissingWormholeInfo();
  const entityColumn = entityType === "alliance" ? "a.alliance_id" : "a.corporation_id";
  const { rows } = await pool.query(
    `
    SELECT
      k.killmail_id,
      k.killmail_time,
      k.jcode,
      k.wormhole_class,
      k.solar_system_id,
      k.structure_type_name,
      k.victim_corporation_id,
      k.victim_alliance_id,
      k.zkb_total_value,
      COUNT(a.id)::int AS attackers_count_for_entity,
      COALESCE(SUM(a.damage_done), 0)::numeric AS damage_done_for_entity,
      BOOL_OR(a.final_blow)::boolean AS final_blow_for_entity
    FROM wh_structure_kills k
    JOIN wh_structure_kill_attackers a ON a.killmail_id = k.killmail_id
    WHERE k.killmail_time >= $1::date
      AND k.killmail_time < ($2::date + interval '1 day')
      AND k.structure_type_id = ANY($3::int[])
      AND ${entityColumn} = $4::bigint
    GROUP BY
      k.killmail_id,
      k.killmail_time,
      k.jcode,
      k.wormhole_class,
      k.solar_system_id,
      k.structure_type_name,
      k.victim_corporation_id,
      k.victim_alliance_id,
      k.zkb_total_value
    ORDER BY k.killmail_time DESC, k.killmail_id DESC
    LIMIT $5
    `,
    [range.startDate, range.endDate, typeIds, entityId, limit]
  );

  const victimIds = rows.flatMap((row) => [
    row.victim_corporation_id,
    row.victim_alliance_id,
  ]);
  const names = await resolveEntityNames(victimIds);

  return rows.map((row) => {
    const victimCorpId = row.victim_corporation_id ? Number(row.victim_corporation_id) : null;
    const victimAllianceId = row.victim_alliance_id ? Number(row.victim_alliance_id) : null;
    return {
      killmail_id: Number(row.killmail_id),
      killmail_time: row.killmail_time,
      jcode: row.jcode,
      wormhole_class: wormholeClassLabel(row.wormhole_class),
      is_low_class: isLowClassWormhole(row.wormhole_class),
      solar_system_id: Number(row.solar_system_id),
      structure_type_name: row.structure_type_name,
      victim_corporation_id: victimCorpId,
      victim_corporation_name: victimCorpId
        ? names.get(victimCorpId)?.name || `Corporation ${victimCorpId}`
        : null,
      victim_alliance_id: victimAllianceId,
      victim_alliance_name: victimAllianceId
        ? names.get(victimAllianceId)?.name || `Alliance ${victimAllianceId}`
        : null,
      zkb_total_value: Number(row.zkb_total_value || 0),
      attackers_count_for_entity: Number(row.attackers_count_for_entity || 0),
      damage_done_for_entity: Number(row.damage_done_for_entity || 0),
      final_blow_for_entity: row.final_blow_for_entity === true,
      zkillUrl: `https://zkillboard.com/kill/${row.killmail_id}/`,
    };
  });
}

async function getAllianceGroupKills({ range, typeIds, groupId, limit }) {
  await refreshMissingWormholeInfo();
  const { rows } = await pool.query(
    `
    SELECT
      k.killmail_id,
      k.killmail_time,
      k.jcode,
      k.wormhole_class,
      k.solar_system_id,
      k.structure_type_name,
      k.victim_corporation_id,
      k.victim_alliance_id,
      k.zkb_total_value,
      COUNT(a.id)::int AS attackers_count_for_entity,
      COALESCE(SUM(a.damage_done), 0)::numeric AS damage_done_for_entity,
      BOOL_OR(a.final_blow)::boolean AS final_blow_for_entity,
      ARRAY_AGG(DISTINCT gm.alliance_id) AS group_alliance_ids,
      ARRAY_AGG(DISTINCT COALESCE(gm.alliance_name, 'Alliance ' || gm.alliance_id::text)) AS group_alliance_names
    FROM wh_structure_kills k
    JOIN wh_structure_kill_attackers a ON a.killmail_id = k.killmail_id
    JOIN wh_structure_alliance_group_members gm
      ON gm.group_id = $4
     AND gm.alliance_id = a.alliance_id
    WHERE k.killmail_time >= $1::date
      AND k.killmail_time < ($2::date + interval '1 day')
      AND k.structure_type_id = ANY($3::int[])
    GROUP BY
      k.killmail_id,
      k.killmail_time,
      k.jcode,
      k.wormhole_class,
      k.solar_system_id,
      k.structure_type_name,
      k.victim_corporation_id,
      k.victim_alliance_id,
      k.zkb_total_value
    ORDER BY k.killmail_time DESC, k.killmail_id DESC
    LIMIT $5
    `,
    [range.startDate, range.endDate, typeIds, groupId, limit]
  );

  const victimIds = rows.flatMap((row) => [
    row.victim_corporation_id,
    row.victim_alliance_id,
  ]);
  const names = await resolveEntityNames(victimIds);

  return rows.map((row) => {
    const victimCorpId = row.victim_corporation_id ? Number(row.victim_corporation_id) : null;
    const victimAllianceId = row.victim_alliance_id ? Number(row.victim_alliance_id) : null;
    return {
      killmail_id: Number(row.killmail_id),
      killmail_time: row.killmail_time,
      jcode: row.jcode,
      wormhole_class: wormholeClassLabel(row.wormhole_class),
      is_low_class: isLowClassWormhole(row.wormhole_class),
      solar_system_id: Number(row.solar_system_id),
      structure_type_name: row.structure_type_name,
      victim_corporation_id: victimCorpId,
      victim_corporation_name: victimCorpId
        ? names.get(victimCorpId)?.name || `Corporation ${victimCorpId}`
        : null,
      victim_alliance_id: victimAllianceId,
      victim_alliance_name: victimAllianceId
        ? names.get(victimAllianceId)?.name || `Alliance ${victimAllianceId}`
        : null,
      zkb_total_value: Number(row.zkb_total_value || 0),
      attackers_count_for_entity: Number(row.attackers_count_for_entity || 0),
      damage_done_for_entity: Number(row.damage_done_for_entity || 0),
      final_blow_for_entity: row.final_blow_for_entity === true,
      group_alliance_ids: (row.group_alliance_ids || []).map(Number),
      group_alliance_names: row.group_alliance_names || [],
      zkillUrl: `https://zkillboard.com/kill/${row.killmail_id}/`,
    };
  });
}

async function pruneRollingWindowData() {
  const window = rollingWindow();
  const cutoffMonth = monthKey(window.start.getUTCFullYear(), window.start.getUTCMonth() + 1);
  const kills = await pool.query(
    `DELETE FROM wh_structure_kills WHERE killmail_time < $1::date`,
    [window.startDate]
  );
  const candidates = await pool.query(
    `DELETE FROM wh_structure_kill_candidates WHERE candidate_month < $1`,
    [cutoffMonth]
  );
  return {
    window,
    killsDeleted: kills.rowCount || 0,
    candidatesDeleted: candidates.rowCount || 0,
  };
}

function msUntilNextDailyMaintenance() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(DAILY_REFRESH_UTC_HOUR, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

async function runRollingMaintenance(reason = "scheduled") {
  await ensureSchema();
  const pruned = await pruneRollingWindowData();
  console.log(
    `[WH_STRUCTURE_STATS]: rolling maintenance (${reason}) pruned ${pruned.killsDeleted} kills and ${pruned.candidatesDeleted} candidates`
  );

  if (process.env.WH_STRUCTURE_DISABLE_DAILY_REFRESH === "true") return null;
  const active = await getActiveJob();
  if (active) {
    console.log(`[WH_STRUCTURE_STATS]: rolling maintenance skipped refresh; active job ${active.id}`);
    return null;
  }

  const allowedTypes = await getAllowedStructureTypes();
  const typeIds = allowedTypes
    .filter((type) => type.enabled_default)
    .map((type) => Number(type.type_id));
  if (!typeIds.length) return null;

  const refresh = dailyRefreshWindow();
  const range = parseDateRange(refresh);
  const job = await createScanJob({
    range,
    typeIds,
    forceRefresh: false,
    jobKind: "rolling_daily_refresh",
  });
  console.log(
    `[WH_STRUCTURE_STATS]: rolling maintenance queued ${job.jobId} for ${range.startDate} to ${range.endDate}`
  );
  return job;
}

async function queueInitialRollingBackfillIfMissing() {
  await ensureSchema();
  console.log("[WH_STRUCTURE_STATS]: startup rolling backfill check running");
  await markPreviousProcessJobsStale();
  if (process.env.WH_STRUCTURE_DISABLE_AUTO_BACKFILL === "true") {
    console.log("[WH_STRUCTURE_STATS]: startup rolling backfill disabled by env");
    return null;
  }

  const active = await getActiveJob();
  if (active) {
    console.log(`[WH_STRUCTURE_STATS]: startup rolling backfill skipped; active job ${active.id}`);
    return null;
  }

  if (await hasRollingBackfillCache()) {
    console.log("[WH_STRUCTURE_STATS]: startup rolling backfill skipped; cache already present");
    return null;
  }

  const allowedTypes = await getAllowedStructureTypes();
  const typeIds = allowedTypes
    .filter((type) => type.enabled_default)
    .map((type) => Number(type.type_id));
  if (!typeIds.length) {
    console.log("[WH_STRUCTURE_STATS]: startup rolling backfill skipped; no structure types resolved");
    return null;
  }

  const window = rollingWindow();
  const range = parseDateRange({ startDate: window.startDate, endDate: window.endDate });
  const job = await createScanJob({
    range,
    typeIds,
    forceRefresh: false,
    jobKind: "rolling_backfill",
  });
  console.log(
    `[WH_STRUCTURE_STATS]: startup queued initial rolling backfill ${job.jobId} for ${range.startDate} to ${range.endDate}`
  );
  return job;
}

function startRollingCacheMaintenance() {
  if (rollingMaintenanceStarted) return;
  rollingMaintenanceStarted = true;
  console.log(
    `[WH_STRUCTURE_STATS]: rolling cache maintenance scheduled; startup prune in 2m, backfill check in 4m, daily refresh around ${String(DAILY_REFRESH_UTC_HOUR).padStart(2, "0")}:00 UTC`
  );

  const startDailyLoop = () => {
    runRollingMaintenance("scheduled").catch((err) => {
      console.warn("[WH_STRUCTURE_STATS]: rolling maintenance failed:", err.message);
    });
    rollingMaintenanceInterval = setInterval(() => {
      runRollingMaintenance("scheduled").catch((err) => {
        console.warn("[WH_STRUCTURE_STATS]: rolling maintenance failed:", err.message);
      });
    }, 24 * 60 * 60 * 1000);
  };

  rollingMaintenanceTimer = setTimeout(startDailyLoop, msUntilNextDailyMaintenance());
  setTimeout(() => {
    ensureSchema()
      .then(pruneRollingWindowData)
      .then((result) => {
        console.log(
          `[WH_STRUCTURE_STATS]: startup prune removed ${result.killsDeleted} kills and ${result.candidatesDeleted} candidates`
        );
      })
      .catch((err) => {
        console.warn("[WH_STRUCTURE_STATS]: startup prune failed:", err.message);
      });
  }, 2 * 60 * 1000);

  setTimeout(() => {
    queueInitialRollingBackfillIfMissing().catch((err) => {
      console.warn("[WH_STRUCTURE_STATS]: startup rolling backfill check failed:", err.message);
    });
  }, 4 * 60 * 1000);
}

function createWhStructureStatsRouter() {
  const router = express.Router();

  router.use(async (_req, _res, next) => {
    try {
      await ensureSchema();
      next();
    } catch (err) {
      next(err);
    }
  });

  router.get("/types", async (_req, res) => {
    try {
      const types = await getAllowedStructureTypes({ force: true });
      res.json({ types });
    } catch (err) {
      console.error("[WH_STRUCTURE_STATS]: /types failed", err);
      res.status(500).json({ error: err.message || "Failed to load structure types" });
    }
  });

  router.get("/window", async (_req, res) => {
    try {
      const window = rollingWindow();
      const active = await getActiveJob();
      res.json({
        window: {
          startDate: window.startDate,
          endDate: window.endDate,
          days: window.days,
        },
        dailyRefresh: {
          days: DAILY_REFRESH_DAYS,
          utcHour: DAILY_REFRESH_UTC_HOUR,
          disabled: process.env.WH_STRUCTURE_DISABLE_DAILY_REFRESH === "true",
        },
        activeJob: active ? compactJob(active) : null,
      });
    } catch (err) {
      console.error("[WH_STRUCTURE_STATS]: /window failed", err);
      res.status(500).json({ error: err.message || "Failed to load rolling window" });
    }
  });

  router.get("/alliance-groups", async (_req, res) => {
    try {
      res.json({ groups: await listAllianceGroups() });
    } catch (err) {
      console.error("[WH_STRUCTURE_STATS]: GET /alliance-groups failed", err);
      res.status(500).json({ error: err.message || "Failed to load alliance groups" });
    }
  });

  router.post("/alliance-groups", async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const group = await writeAllianceGroup({
        name: req.body?.name,
        description: req.body?.description,
        allianceIds: req.body?.allianceIds ?? req.body?.members,
      });
      res.status(201).json({ group });
    } catch (err) {
      console.error("[WH_STRUCTURE_STATS]: POST /alliance-groups failed", err);
      res.status(err.statusCode || 500).json({ error: err.message || "Failed to save alliance group" });
    }
  });

  router.put("/alliance-groups/:groupId", async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const group = await writeAllianceGroup({
        groupId: req.params.groupId,
        name: req.body?.name,
        description: req.body?.description,
        allianceIds: req.body?.allianceIds ?? req.body?.members,
      });
      res.json({ group });
    } catch (err) {
      console.error("[WH_STRUCTURE_STATS]: PUT /alliance-groups/:groupId failed", err);
      res.status(err.statusCode || 500).json({ error: err.message || "Failed to save alliance group" });
    }
  });

  router.delete("/alliance-groups/:groupId", async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const deleted = await pool.query(
        `DELETE FROM wh_structure_alliance_groups WHERE id = $1`,
        [req.params.groupId]
      );
      if (!deleted.rowCount) return res.status(404).json({ error: "Alliance group not found" });
      res.json({ ok: true });
    } catch (err) {
      console.error("[WH_STRUCTURE_STATS]: DELETE /alliance-groups/:groupId failed", err);
      res.status(500).json({ error: err.message || "Failed to delete alliance group" });
    }
  });

  router.post("/jobs", async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const allowedTypes = await getAllowedStructureTypes();
      const range = parseDateRange(req.body || {});
      const typeIds = selectedTypeIdsFromInput(req.body?.typeIds, allowedTypes);
      const forceRefresh = bool(req.body?.forceRefresh);
      const job = await createScanJob({ range, typeIds, forceRefresh, jobKind: "manual_scan" });
      res.status(202).json(job);
    } catch (err) {
      console.error("[WH_STRUCTURE_STATS]: POST /jobs failed", err);
      res.status(err.statusCode || 500).json({
        error: err.message || "Failed to create job",
        activeJobId: err.activeJobId || null,
      });
    }
  });

  router.post("/jobs/rolling-backfill", async (req, res) => {
    try {
      if (!requireAdmin(req, res)) return;
      const allowedTypes = await getAllowedStructureTypes();
      const window = rollingWindow();
      const range = parseDateRange({ startDate: window.startDate, endDate: window.endDate });
      const typeIds = selectedTypeIdsFromInput(req.body?.typeIds, allowedTypes);
      const forceRefresh = bool(req.body?.forceRefresh);
      const job = await createScanJob({
        range,
        typeIds,
        forceRefresh,
        jobKind: "rolling_backfill",
      });
      res.status(202).json(job);
    } catch (err) {
      console.error("[WH_STRUCTURE_STATS]: POST /jobs/rolling-backfill failed", err);
      res.status(err.statusCode || 500).json({
        error: err.message || "Failed to create rolling backfill job",
        activeJobId: err.activeJobId || null,
      });
    }
  });

  router.get("/jobs/:jobId", async (req, res) => {
    try {
      const job = await getJob(req.params.jobId);
      if (!job) return res.status(404).json({ error: "Job not found" });
      res.json(compactJob(job));
    } catch (err) {
      console.error("[WH_STRUCTURE_STATS]: GET /jobs/:jobId failed", err);
      res.status(500).json({ error: err.message || "Failed to load job" });
    }
  });

  router.get("/summary", async (req, res) => {
    try {
      const allowedTypes = await getAllowedStructureTypes();
      const range = parseDateRange(req.query || {});
      const typeIds = selectedTypeIdsFromInput(req.query.typeIds, allowedTypes);
      const groupBy = String(req.query.groupBy || "corporation").toLowerCase();
      if (!["corporation", "alliance"].includes(groupBy)) {
        return res.status(400).json({ error: "groupBy must be corporation or alliance" });
      }
      res.json(await aggregateSummary({ range, typeIds, groupBy }));
    } catch (err) {
      console.error("[WH_STRUCTURE_STATS]: GET /summary failed", err);
      res.status(err.statusCode || 500).json({ error: err.message || "Failed to load summary" });
    }
  });

  router.get("/group-summary", async (req, res) => {
    try {
      const allowedTypes = await getAllowedStructureTypes();
      const range = parseDateRange(req.query || {});
      const typeIds = selectedTypeIdsFromInput(req.query.typeIds, allowedTypes);
      res.json(await aggregateAllianceGroupSummary({ range, typeIds }));
    } catch (err) {
      console.error("[WH_STRUCTURE_STATS]: GET /group-summary failed", err);
      res.status(err.statusCode || 500).json({ error: err.message || "Failed to load group summary" });
    }
  });

  router.get("/entity/:entityType/:entityId/kills", async (req, res) => {
    try {
      const allowedTypes = await getAllowedStructureTypes();
      const entityType = String(req.params.entityType || "").toLowerCase();
      if (!["corporation", "alliance"].includes(entityType)) {
        return res.status(400).json({ error: "entityType must be corporation or alliance" });
      }
      const entityId = Number(req.params.entityId);
      if (!Number.isSafeInteger(entityId) || entityId <= 0) {
        return res.status(400).json({ error: "entityId must be a positive integer" });
      }
      const range = parseDateRange(req.query || {});
      const typeIds = selectedTypeIdsFromInput(req.query.typeIds, allowedTypes);
      const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);
      const kills = await getEntityKills({ range, typeIds, entityType, entityId, limit });
      res.json({ entityType, entityId, range: { ...range, start: undefined, end: undefined, endExclusive: undefined }, kills });
    } catch (err) {
      console.error("[WH_STRUCTURE_STATS]: GET entity kills failed", err);
      res.status(err.statusCode || 500).json({ error: err.message || "Failed to load entity kills" });
    }
  });

  router.get("/alliance-groups/:groupId/kills", async (req, res) => {
    try {
      const allowedTypes = await getAllowedStructureTypes();
      const group = await getAllianceGroup(req.params.groupId);
      if (!group) return res.status(404).json({ error: "Alliance group not found" });
      const range = parseDateRange(req.query || {});
      const typeIds = selectedTypeIdsFromInput(req.query.typeIds, allowedTypes);
      const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);
      const kills = await getAllianceGroupKills({
        range,
        typeIds,
        groupId: req.params.groupId,
        limit,
      });
      res.json({
        group,
        range: { ...range, start: undefined, end: undefined, endExclusive: undefined },
        kills,
      });
    } catch (err) {
      console.error("[WH_STRUCTURE_STATS]: GET alliance group kills failed", err);
      res.status(err.statusCode || 500).json({ error: err.message || "Failed to load alliance group kills" });
    }
  });

  return router;
}

createWhStructureStatsRouter.startRollingCacheMaintenance = startRollingCacheMaintenance;

module.exports = createWhStructureStatsRouter;
