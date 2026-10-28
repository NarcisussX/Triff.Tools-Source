const crypto = require("crypto");
const pool = require("../db/pool");

const ESI_BASE = process.env.ESI_BASE_URL || "https://esi.evetech.net/latest";
const ZKILL_BASE = process.env.ZKILL_BASE_URL || "https://zkillboard.com/api";
const USER_AGENT = process.env.TRIFF_LOCAL_USER_AGENT || "Triff.Tools/2.1.0 (contact: cooperbroderick25@gmail.com)";
const ONE_MIB = 1024 * 1024;
const HARD_MAX_INPUT_LENGTH = 2 * ONE_MIB;
const HARD_MAX_NAMES = 750;
const MAX_INPUT_LENGTH = clampInt(process.env.TRIFF_LOCAL_MAX_INPUT_LENGTH, ONE_MIB, 1, HARD_MAX_INPUT_LENGTH);
const MAX_NAMES = clampInt(process.env.TRIFF_LOCAL_MAX_NAMES, 500, 1, HARD_MAX_NAMES);
const ZKILL_CONCURRENCY = clampInt(process.env.TRIFF_LOCAL_ZKILL_CONCURRENCY, 3, 1, 3);
const ZKILL_GLOBAL_RPS = clampInt(process.env.TRIFF_LOCAL_ZKILL_GLOBAL_RPS, 8, 1, 10);
const ZKILL_GLOBAL_BURST = clampInt(process.env.TRIFF_LOCAL_ZKILL_GLOBAL_BURST, 10, 1, 20);
const FETCH_TIMEOUT_MS = Number(process.env.TRIFF_LOCAL_FETCH_TIMEOUT_MS || 12_000);
const TTL_ESI_IDS_MS = 7 * 24 * 60 * 60 * 1000;
const TTL_ESI_NAMES_MS = 7 * 24 * 60 * 60 * 1000;
const TTL_ESI_AFFILIATION_MS = 60 * 60 * 1000;
const TTL_ESI_NEGATIVE_NAME_MS = 60 * 60 * 1000;
const TTL_ZKILL_STATS_MS = 6 * 60 * 60 * 1000;
const TTL_ZKILL_FAILURE_MS = 15 * 60 * 1000;

let schemaReady = false;
let schemaPromise = null;
const zkillQueue = {
  tokens: ZKILL_GLOBAL_BURST,
  lastRefillAt: Date.now(),
  items: [],
  timer: null,
};

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.floor(number), max));
}

function reportId() {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = crypto.randomBytes(12);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

async function ensureTriffLocalSchema() {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = pool
      .query(`
        CREATE TABLE IF NOT EXISTS triff_local_reports (
          id text PRIMARY KEY,
          title text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          input_raw text NOT NULL,
          parsed_names jsonb NOT NULL,
          summary jsonb NOT NULL DEFAULT '{}'::jsonb,
          report jsonb NOT NULL,
          version integer NOT NULL DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS triff_local_reports_created_idx
          ON triff_local_reports(created_at DESC);

        CREATE TABLE IF NOT EXISTS triff_local_cache (
          cache_key text PRIMARY KEY,
          kind text NOT NULL,
          payload jsonb NOT NULL,
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS triff_local_cache_expires_idx
          ON triff_local_cache(expires_at);
      `)
      .then(() => {
        schemaReady = true;
      })
      .catch((err) => {
        schemaPromise = null;
        throw err;
      });
  }
  await schemaPromise;
}

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanCharacterName(value) {
  const name = collapseWhitespace(
    String(value || "")
      .replace(/<[^>]*>/g, "")
      .replace(/[>\u0000-\u001f\u007f]/g, " ")
  );
  if (name.length < 3 || name.length > 37) return null;
  if (/^(channel changed|motd|system|corp|alliance|fleet)$/i.test(name)) return null;
  return name;
}

function extractShowInfoNames(source) {
  const names = [];
  const expr = /<url=showinfo:13\d{2}\/\/[^>]+>([^<]+)<\/url>/gi;
  for (const match of source.matchAll(expr)) {
    const name = cleanCharacterName(match[1]);
    if (name) names.push(name);
  }
  return names;
}

function extractTranscriptName(line) {
  const timestamped = line.match(/^\s*\[\s*\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}\s*\]\s*(.+?)\s*>/);
  if (timestamped) return timestamped[1];

  const plain = line.match(/^\s*([^>]{3,60}?)\s*>/);
  if (plain) return plain[1];

  return line;
}

function parseTriffLocalInput(source) {
  const raw = String(source || "");
  const linkedNames = extractShowInfoNames(raw);
  const candidates = linkedNames.length
    ? linkedNames
    : raw
        .split(/[\r\n]+/)
        .map((line) => extractTranscriptName(line))
        .map(cleanCharacterName)
        .filter(Boolean);

  return Array.from(new Set(candidates)).slice(0, MAX_NAMES);
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function cacheNameKey(value) {
  return collapseWhitespace(value).toLowerCase();
}

function cacheExpiresAt(ms) {
  return new Date(Date.now() + ms);
}

function cacheExpiresFromHeaders(headers, fallbackMs) {
  const raw = headers?.get?.("expires");
  const timestamp = raw ? Date.parse(raw) : NaN;
  if (Number.isFinite(timestamp) && timestamp > Date.now()) return new Date(timestamp);
  return cacheExpiresAt(fallbackMs);
}

function cacheEntry(cacheKey, kind, payload, expiresAt) {
  return {
    cache_key: cacheKey,
    kind,
    payload,
    expires_at: expiresAt.toISOString(),
  };
}

async function readCacheMany(cacheKeys) {
  const keys = Array.from(new Set(cacheKeys.filter(Boolean)));
  if (!keys.length) return new Map();
  await ensureTriffLocalSchema();
  const { rows } = await pool.query(
    `
    SELECT cache_key, payload
    FROM triff_local_cache
    WHERE cache_key = ANY($1::text[])
      AND expires_at > now()
    `,
    [keys]
  );
  return new Map(rows.map((row) => [row.cache_key, row.payload]));
}

async function writeCacheEntries(entries) {
  const rows = entries.filter((entry) => entry?.cache_key && entry?.expires_at);
  if (!rows.length) return;
  await ensureTriffLocalSchema();
  await pool.query(
    `
    INSERT INTO triff_local_cache (cache_key, kind, payload, expires_at)
    SELECT cache_key, kind, payload, expires_at
    FROM jsonb_to_recordset($1::jsonb)
      AS x(cache_key text, kind text, payload jsonb, expires_at timestamptz)
    ON CONFLICT (cache_key) DO UPDATE
      SET kind = EXCLUDED.kind,
          payload = EXCLUDED.payload,
          expires_at = EXCLUDED.expires_at,
          updated_at = now()
    `,
    [JSON.stringify(rows)]
  );
}

async function readCache(cacheKey) {
  return (await readCacheMany([cacheKey])).get(cacheKey) || null;
}

function refillZkillTokens() {
  const now = Date.now();
  const elapsedSeconds = Math.max(0, (now - zkillQueue.lastRefillAt) / 1000);
  zkillQueue.tokens = Math.min(ZKILL_GLOBAL_BURST, zkillQueue.tokens + elapsedSeconds * ZKILL_GLOBAL_RPS);
  zkillQueue.lastRefillAt = now;
}

function drainZkillQueue() {
  refillZkillTokens();
  while (zkillQueue.items.length && zkillQueue.tokens >= 1) {
    zkillQueue.tokens -= 1;
    const item = zkillQueue.items.shift();
    Promise.resolve()
      .then(item.worker)
      .then(item.resolve, item.reject)
      .finally(() => drainZkillQueue());
  }

  if (zkillQueue.items.length && !zkillQueue.timer) {
    const needed = Math.max(0, 1 - zkillQueue.tokens);
    const delay = Math.max(1, Math.ceil((needed / ZKILL_GLOBAL_RPS) * 1000));
    zkillQueue.timer = setTimeout(() => {
      zkillQueue.timer = null;
      drainZkillQueue();
    }, delay);
  }
}

function enqueueZkillRequest(worker) {
  return new Promise((resolve, reject) => {
    zkillQueue.items.push({ worker, resolve, reject });
    drainZkillQueue();
  });
}

async function fetchJsonResponse(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      const err = new Error(`request_failed_${response.status}`);
      err.status = response.status;
      err.url = url;
      throw err;
    }
    return { data: await response.json(), headers: response.headers };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  return (await fetchJsonResponse(url, options)).data;
}

async function resolveCharacterIds(names) {
  const resolved = new Map();
  const unresolved = new Set(names);
  const pending = [];
  const cacheKeys = names.map((name) => `esi:ids:character:${cacheNameKey(name)}`);
  const cached = await readCacheMany(cacheKeys);

  for (const name of names) {
    const payload = cached.get(`esi:ids:character:${cacheNameKey(name)}`);
    if (!payload) {
      pending.push(name);
      continue;
    }
    if (payload.id) {
      resolved.set(name, Number(payload.id));
      unresolved.delete(name);
    }
  }

  for (const batch of chunk(pending, 500)) {
    const { data, headers } = await fetchJsonResponse(`${ESI_BASE}/universe/ids/?datasource=tranquility&language=en`, {
      method: "POST",
      body: JSON.stringify(batch),
    });
    const byLower = new Map(batch.map((name) => [cacheNameKey(name), name]));
    const seen = new Set();
    const expiresAt = cacheExpiresFromHeaders(headers, TTL_ESI_IDS_MS);
    const entries = [];

    for (const row of data?.characters || []) {
      if (!row?.name || !row?.id) continue;
      const originalName = byLower.get(cacheNameKey(row.name)) || row.name;
      seen.add(cacheNameKey(originalName));
      resolved.set(originalName, Number(row.id));
      unresolved.delete(originalName);
      entries.push(
        cacheEntry(
          `esi:ids:character:${cacheNameKey(originalName)}`,
          "esi_ids_character",
          { id: Number(row.id), name: row.name },
          expiresAt
        )
      );
    }

    const negativeExpiresAt = cacheExpiresAt(TTL_ESI_NEGATIVE_NAME_MS);
    for (const name of batch) {
      if (seen.has(cacheNameKey(name))) continue;
      entries.push(
        cacheEntry(
          `esi:ids:character:${cacheNameKey(name)}`,
          "esi_ids_character_miss",
          { missing: true, name },
          negativeExpiresAt
        )
      );
    }
    await writeCacheEntries(entries);
  }

  return { resolved, unresolved };
}

async function fetchAffiliations(characterIds) {
  const byCharacter = new Map();
  const uniqueIds = Array.from(new Set(characterIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)));
  const cached = await readCacheMany(uniqueIds.map((id) => `esi:affiliation:${id}`));
  const pending = [];

  for (const id of uniqueIds) {
    const payload = cached.get(`esi:affiliation:${id}`);
    if (payload) {
      byCharacter.set(id, {
        corporationId: payload.corporationId ? Number(payload.corporationId) : null,
        allianceId: payload.allianceId ? Number(payload.allianceId) : null,
        factionId: payload.factionId ? Number(payload.factionId) : null,
      });
    } else {
      pending.push(id);
    }
  }

  for (const batch of chunk(pending, 1000)) {
    const data = await fetchJson(`${ESI_BASE}/characters/affiliation/?datasource=tranquility`, {
      method: "POST",
      body: JSON.stringify(batch),
    });
    const entries = [];
    const expiresAt = cacheExpiresAt(TTL_ESI_AFFILIATION_MS);
    for (const row of data || []) {
      const characterId = Number(row.character_id);
      const affiliation = {
        corporationId: row.corporation_id ? Number(row.corporation_id) : null,
        allianceId: row.alliance_id ? Number(row.alliance_id) : null,
        factionId: row.faction_id ? Number(row.faction_id) : null,
      };
      byCharacter.set(characterId, affiliation);
      entries.push(cacheEntry(`esi:affiliation:${characterId}`, "esi_affiliation", affiliation, expiresAt));
    }
    await writeCacheEntries(entries);
  }
  return byCharacter;
}

async function resolveNames(ids) {
  const names = new Map();
  const unique = Array.from(new Set(ids.filter((id) => Number.isInteger(Number(id)) && Number(id) > 0).map(Number)));
  const cached = await readCacheMany(unique.map((id) => `esi:names:${id}`));
  const pending = [];

  for (const id of unique) {
    const payload = cached.get(`esi:names:${id}`);
    if (payload?.id && payload?.name) {
      names.set(Number(id), {
        id: Number(payload.id),
        name: payload.name,
        category: payload.category || null,
      });
    } else {
      pending.push(id);
    }
  }

  for (const batch of chunk(pending, 1000)) {
    const { data, headers } = await fetchJsonResponse(`${ESI_BASE}/universe/names/?datasource=tranquility`, {
      method: "POST",
      body: JSON.stringify(batch),
    });
    const expiresAt = cacheExpiresFromHeaders(headers, TTL_ESI_NAMES_MS);
    const entries = [];
    for (const row of data || []) {
      if (!row?.id || !row?.name) continue;
      const resolved = {
        id: Number(row.id),
        name: row.name,
        category: row.category || null,
      };
      names.set(Number(row.id), resolved);
      entries.push(cacheEntry(`esi:names:${Number(row.id)}`, "esi_names", resolved, expiresAt));
    }
    await writeCacheEntries(entries);
  }

  return names;
}

function normalizeZkillStats(data) {
  const topShips =
    data?.topLists
      ?.find((list) => list?.type === "shipType")
      ?.values?.map((row) => ({
        typeId: Number(row.id),
        name: String(row.name || "").trim(),
        zkillUrl: `https://zkillboard.com/ship/${Number(row.id)}/`,
        imageUrl: `https://images.evetech.net/types/${Number(row.id)}/render?size=64`,
      }))
      .filter((row) => Number.isInteger(row.typeId) && row.name)
      .slice(0, 10) || [];

  const dangerPercent = Number.isFinite(Number(data?.dangerRatio)) ? Number(data.dangerRatio) : null;
  const gangPercent = Number.isFinite(Number(data?.gangRatio)) ? Number(data.gangRatio) : null;

  return {
    shipsDestroyed: Number.isFinite(Number(data?.shipsDestroyed)) ? Number(data.shipsDestroyed) : null,
    shipsLost: Number.isFinite(Number(data?.shipsLost)) ? Number(data.shipsLost) : null,
    dangerRatio: dangerPercent == null ? null : dangerPercent / 100,
    dangerPercent,
    gangRatio: gangPercent == null ? null : gangPercent / 100,
    gangPercent,
    topShips,
  };
}

async function fetchZkillStats(characterId) {
  const cacheKey = `zkill:stats:character:${Number(characterId)}`;
  const cached = await readCache(cacheKey);
  if (cached) return cached;

  try {
    const data = await enqueueZkillRequest(() =>
      fetchJson(`${ZKILL_BASE}/stats/characterID/${encodeURIComponent(characterId)}/`)
    );
    const result = { ok: true, stats: normalizeZkillStats(data), error: null };
    await writeCacheEntries([cacheEntry(cacheKey, "zkill_character_stats", result, cacheExpiresAt(TTL_ZKILL_STATS_MS))]);
    return result;
  } catch (err) {
    const result = {
      ok: false,
      stats: normalizeZkillStats(null),
      error: err.status ? `zkill_${err.status}` : "zkill_unavailable",
    };
    await writeCacheEntries([cacheEntry(cacheKey, "zkill_character_stats_failure", result, cacheExpiresAt(TTL_ZKILL_FAILURE_MS))]);
    return result;
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function entity(id, names, type) {
  if (!id) return null;
  const resolved = names.get(Number(id));
  return {
    id: Number(id),
    name: resolved?.name || null,
    zkillUrl: `https://zkillboard.com/${type}/${Number(id)}/`,
    imageUrl:
      type === "alliance"
        ? `https://images.evetech.net/alliances/${Number(id)}/logo?size=64`
        : `https://images.evetech.net/corporations/${Number(id)}/logo?size=64`,
  };
}

function uniqueEntities(rows, key) {
  const seen = new Map();
  for (const row of rows) {
    const item = row[key];
    if (!item?.id) continue;
    const current = seen.get(item.id) || { ...item, pilotCount: 0 };
    current.pilotCount += 1;
    if (!current.name && item.name) current.name = item.name;
    seen.set(item.id, current);
  }
  return Array.from(seen.values()).sort(
    (a, b) => b.pilotCount - a.pilotCount || String(a.name || "").localeCompare(String(b.name || ""))
  );
}

function summarizeReport(characters, parsedCount) {
  const resolved = characters.filter((row) => row.status === "ok" || row.status === "partial").length;
  const unresolved = characters.filter((row) => row.status === "unresolved").length;
  const partial = characters.filter((row) => row.status === "partial").length;
  const kills = characters.reduce((sum, row) => sum + Number(row.zkill?.shipsDestroyed || 0), 0);
  const losses = characters.reduce((sum, row) => sum + Number(row.zkill?.shipsLost || 0), 0);
  const dangerous = characters.filter((row) => Number(row.zkill?.dangerPercent || 0) >= 75).length;

  return {
    parsedCount,
    characterCount: characters.length,
    resolvedCount: resolved,
    unresolvedCount: unresolved,
    partialCount: partial,
    totalShipsDestroyed: kills,
    totalShipsLost: losses,
    highDangerCount: dangerous,
  };
}

function makeTitle(characters) {
  const names = characters
    .filter((row) => row.character?.name)
    .slice(0, 2)
    .map((row) => row.character.name);
  if (!names.length) return "TriffLocal Report";
  const extra = characters.length - names.length;
  return extra > 0 ? `${names.join(", ")} + ${extra} more` : names.join(", ");
}

function publicReport(row) {
  const report = row.report || {};
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    ...report,
    id: row.id,
    title: report.title || row.title,
    createdAt: report.createdAt || row.created_at,
  };
}

async function hydrateTriffLocalReport(source) {
  const inputRaw = String(source || "");
  if (!inputRaw.trim()) {
    const err = new Error("input_required");
    err.status = 400;
    throw err;
  }
  if (inputRaw.length > MAX_INPUT_LENGTH) {
    const err = new Error("input_too_large");
    err.status = 413;
    throw err;
  }

  const parsedNames = parseTriffLocalInput(inputRaw);
  if (!parsedNames.length) {
    const err = new Error("no_character_names");
    err.status = 400;
    throw err;
  }

  const diagnostics = [];
  const { resolved, unresolved } = await resolveCharacterIds(parsedNames);
  const characterIds = Array.from(resolved.values());
  const affiliations = characterIds.length ? await fetchAffiliations(characterIds) : new Map();

  const idsToName = [];
  for (const affiliation of affiliations.values()) {
    if (affiliation.corporationId) idsToName.push(affiliation.corporationId);
    if (affiliation.allianceId) idsToName.push(affiliation.allianceId);
    if (affiliation.factionId) idsToName.push(affiliation.factionId);
  }
  const names = idsToName.length ? await resolveNames(idsToName) : new Map();

  const zkillByCharacter = new Map();
  await mapLimit(characterIds, ZKILL_CONCURRENCY, async (characterId) => {
    const result = await fetchZkillStats(characterId);
    zkillByCharacter.set(characterId, result);
  });

  const characters = parsedNames.map((name) => {
    const characterId = resolved.get(name);
    if (!characterId || unresolved.has(name)) {
      return {
        inputName: name,
        status: "unresolved",
        errors: ["character_not_found"],
        character: { id: null, name },
        corporation: null,
        alliance: null,
        faction: null,
        zkill: normalizeZkillStats(null),
      };
    }

    const affiliation = affiliations.get(characterId) || {};
    const zkill = zkillByCharacter.get(characterId) || {
      ok: false,
      stats: normalizeZkillStats(null),
      error: "zkill_not_loaded",
    };
    const errors = [];
    if (!affiliations.has(characterId)) errors.push("affiliation_not_found");
    if (!zkill.ok && zkill.error) errors.push(zkill.error);

    return {
      inputName: name,
      status: errors.length ? "partial" : "ok",
      errors,
      character: {
        id: characterId,
        name,
        zkillUrl: `https://zkillboard.com/character/${characterId}/`,
        imageUrl: `https://images.evetech.net/characters/${characterId}/portrait?size=64`,
      },
      corporation: entity(affiliation.corporationId, names, "corporation"),
      alliance: entity(affiliation.allianceId, names, "alliance"),
      faction: entity(affiliation.factionId, names, "faction"),
      zkill: zkill.stats,
    };
  });

  for (const name of unresolved) diagnostics.push({ level: "warning", code: "character_not_found", name });
  const summary = summarizeReport(characters, parsedNames.length);
  const groups = {
    corporations: uniqueEntities(characters, "corporation"),
    alliances: uniqueEntities(characters, "alliance"),
    factions: uniqueEntities(characters, "faction"),
  };
  const now = new Date().toISOString();
  const title = makeTitle(characters);

  return {
    title,
    inputRaw,
    parsedNames,
    summary,
    report: {
      version: 1,
      title,
      createdAt: now,
      source: {
        parsedNames,
        truncated: parsedNames.length >= MAX_NAMES,
      },
      summary,
      groups,
      characters,
      diagnostics,
    },
  };
}

async function createTriffLocalReport(source) {
  await ensureTriffLocalSchema();
  const hydrated = await hydrateTriffLocalReport(source);
  const id = reportId();
  const report = { ...hydrated.report, id };

  await pool.query(
    `
    INSERT INTO triff_local_reports (id, title, input_raw, parsed_names, summary, report)
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
    `,
    [
      id,
      hydrated.title,
      "",
      JSON.stringify(hydrated.parsedNames),
      JSON.stringify(hydrated.summary),
      JSON.stringify(report),
    ]
  );

  return {
    id,
    title: hydrated.title,
    report,
  };
}

function cleanReportId(value) {
  const id = String(value || "").trim();
  return /^[0-9A-Za-z_-]{8,32}$/.test(id) ? id : null;
}

async function getTriffLocalReport(id) {
  const cleanId = cleanReportId(id);
  if (!cleanId) return null;
  await ensureTriffLocalSchema();
  const { rows } = await pool.query(
    `
    SELECT id, title, created_at, report
    FROM triff_local_reports
    WHERE id = $1
    LIMIT 1
    `,
    [cleanId]
  );
  return rows[0] ? publicReport(rows[0]) : null;
}

module.exports = {
  ensureTriffLocalSchema,
  createTriffLocalReport,
  getTriffLocalReport,
  hydrateTriffLocalReport,
  parseTriffLocalInput,
  cleanReportId,
  _test: {
    cleanCharacterName,
    extractShowInfoNames,
    extractTranscriptName,
    normalizeZkillStats,
    summarizeReport,
    makeTitle,
  },
};
