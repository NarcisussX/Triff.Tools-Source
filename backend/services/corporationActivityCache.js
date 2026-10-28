/*
 * Shared, persistent cache for structure-intel corporation resolution and
 * zKill activity. This prevents the public intel UI and the private
 * observation enricher from making duplicate upstream requests.
 */

const pool = require("../db/pool");

const DEFAULT_ACTIVITY_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_ZKILL_INTERVAL_MS = 1100;
const MAX_PENDING_ZKILL_REQUESTS = 500;

let schemaPromise = null;
let zkillTail = Promise.resolve();
let lastZkillRequestAt = 0;
let pendingZkillRequests = 0;

const corporationResolveInflight = new Map();
const corporationActivityInflight = new Map();

function cleanCorporationName(value) {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return name ? name.slice(0, 255) : null;
}

function normalizeCorporationId(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,19}$/.test(raw)) return null;
  try {
    const id = BigInt(raw);
    return id > 0n && id <= 9223372036854775807n ? id.toString() : null;
  } catch {
    return null;
  }
}

function activityTtlMs() {
  const configured = Number(process.env.STRUCTURE_CORP_ACTIVITY_CACHE_MS);
  return Number.isFinite(configured)
    ? Math.max(60_000, Math.min(7 * 24 * 60 * 60 * 1000, configured))
    : DEFAULT_ACTIVITY_TTL_MS;
}

function zkillIntervalMs() {
  const configured = Number(process.env.STRUCTURE_ZKILL_MIN_INTERVAL_MS);
  return Number.isFinite(configured)
    ? Math.max(250, Math.min(10_000, configured))
    : DEFAULT_ZKILL_INTERVAL_MS;
}

async function ensureCorporationActivityCacheSchema() {
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS structure_corporation_activity_cache (
        corporation_id BIGINT PRIMARY KEY,
        corporation_name TEXT,
        activity JSONB,
        activity_fetched_at TIMESTAMPTZ,
        activity_error_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      ALTER TABLE structure_corporation_activity_cache
        ADD COLUMN IF NOT EXISTS activity_error_at TIMESTAMPTZ;

      CREATE INDEX IF NOT EXISTS structure_corporation_activity_name_idx
        ON structure_corporation_activity_cache(lower(corporation_name));
    `).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  await schemaPromise;
}

async function fetchJsonWithTimeout(url, init = {}, timeoutMs = 15_000) {
  if (typeof global.fetch !== "function") throw new Error("fetch_unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await global.fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "TriffTools/structure-intel (+triff.tools)",
        ...(init.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`upstream_${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function rememberCorporation(corporationId, corporationName) {
  const id = normalizeCorporationId(corporationId);
  const name = cleanCorporationName(corporationName);
  if (!id) return;
  await ensureCorporationActivityCacheSchema();
  await pool.query(
    `INSERT INTO structure_corporation_activity_cache
       (corporation_id, corporation_name)
     VALUES ($1::bigint, $2)
     ON CONFLICT (corporation_id) DO UPDATE SET
       corporation_name = COALESCE(EXCLUDED.corporation_name, structure_corporation_activity_cache.corporation_name),
       updated_at = now()`,
    [id, name]
  );
}

async function resolveCorporationId(corporationName) {
  const name = cleanCorporationName(corporationName);
  if (!name) return null;
  await ensureCorporationActivityCacheSchema();

  const cached = await pool.query(
    `SELECT corporation_id, corporation_name
     FROM structure_corporation_activity_cache
     WHERE lower(corporation_name) = lower($1)
     LIMIT 1`,
    [name]
  );
  if (cached.rows[0]) {
    return {
      id: String(cached.rows[0].corporation_id),
      name: cached.rows[0].corporation_name || name,
      cached: true,
    };
  }

  const key = name.toLowerCase();
  if (corporationResolveInflight.has(key)) return corporationResolveInflight.get(key);

  const request = (async () => {
    const resolved = await fetchJsonWithTimeout(
      "https://esi.evetech.net/latest/universe/ids/?datasource=tranquility",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([name]),
      }
    );
    const corporations = Array.isArray(resolved?.corporations) ? resolved.corporations : [];
    let corporation = corporations.find(
      (candidate) => String(candidate?.name || "").trim().toLowerCase() === key
    );
    if (!corporation) {
      const query = new URLSearchParams({
        categories: "corporation",
        datasource: "tranquility",
        search: name,
        strict: "true",
      });
      const strict = await fetchJsonWithTimeout(
        `https://esi.evetech.net/latest/search/?${query.toString()}`
      );
      const strictId = normalizeCorporationId(strict?.corporation?.[0]);
      if (strictId) {
        const details = await fetchJsonWithTimeout(
          `https://esi.evetech.net/latest/corporations/${strictId}/?datasource=tranquility`
        );
        if (String(details?.name || "").trim().toLowerCase() === key) {
          corporation = { id: strictId, name: details.name };
        }
      }
    }
    const id = normalizeCorporationId(corporation?.id);
    if (!id) return null;
    const canonicalName = cleanCorporationName(corporation?.name) || name;
    await rememberCorporation(id, canonicalName);
    return { id, name: canonicalName, cached: false };
  })().finally(() => {
    corporationResolveInflight.delete(key);
  });

  corporationResolveInflight.set(key, request);
  return request;
}

function queuedZkillActivityFetch(corporationId) {
  if (pendingZkillRequests >= MAX_PENDING_ZKILL_REQUESTS) {
    return Promise.reject(new Error("zkill_queue_full"));
  }
  pendingZkillRequests += 1;

  const request = zkillTail
    .catch(() => undefined)
    .then(async () => {
      const delay = Math.max(0, lastZkillRequestAt + zkillIntervalMs() - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      lastZkillRequestAt = Date.now();
      const stats = await fetchJsonWithTimeout(
        `https://zkillboard.com/api/stats/corporationID/${corporationId}/`
      );
      return stats?.activity ?? null;
    })
    .finally(() => {
      pendingZkillRequests -= 1;
    });

  zkillTail = request.then(() => undefined, () => undefined);
  return request;
}

async function getCorporationActivity(corporationId) {
  const id = normalizeCorporationId(corporationId);
  if (!id) throw new Error("invalid_corporation_id");
  await ensureCorporationActivityCacheSchema();

  const successCutoff = new Date(Date.now() - activityTtlMs());
  const failureCutoff = new Date(Date.now() - 15 * 60 * 1000);
  const cached = await pool.query(
    `SELECT activity, activity_fetched_at, activity_error_at
     FROM structure_corporation_activity_cache
     WHERE corporation_id = $1::bigint
     LIMIT 1`,
    [id]
  );
  const cachedRow = cached.rows[0];
  const fetchedAt = cachedRow?.activity_fetched_at
    ? new Date(cachedRow.activity_fetched_at)
    : null;
  const errorAt = cachedRow?.activity_error_at
    ? new Date(cachedRow.activity_error_at)
    : null;
  if (fetchedAt && fetchedAt >= successCutoff) {
    return {
      activity: cachedRow.activity ?? null,
      fetchedAt,
      cached: true,
    };
  }
  if (errorAt && errorAt >= failureCutoff) {
    if (fetchedAt) {
      return {
        activity: cachedRow.activity ?? null,
        fetchedAt,
        cached: true,
        stale: true,
      };
    }
    throw new Error("zkill_recent_failure");
  }

  if (corporationActivityInflight.has(id)) return corporationActivityInflight.get(id);

  const request = (async () => {
    try {
      const activity = await queuedZkillActivityFetch(id);
      const { rows } = await pool.query(
        `INSERT INTO structure_corporation_activity_cache
           (corporation_id, activity, activity_fetched_at, activity_error_at)
         VALUES ($1::bigint, $2::jsonb, now(), NULL)
         ON CONFLICT (corporation_id) DO UPDATE SET
           activity = EXCLUDED.activity,
           activity_fetched_at = EXCLUDED.activity_fetched_at,
           activity_error_at = NULL,
           updated_at = now()
         RETURNING activity_fetched_at`,
        [id, activity == null ? null : JSON.stringify(activity)]
      );
      return {
        activity,
        fetchedAt: rows[0]?.activity_fetched_at || new Date(),
        cached: false,
      };
    } catch (error) {
      await pool.query(
        `INSERT INTO structure_corporation_activity_cache
           (corporation_id, activity_error_at)
         VALUES ($1::bigint, now())
         ON CONFLICT (corporation_id) DO UPDATE SET
           activity_error_at = EXCLUDED.activity_error_at,
           updated_at = now()`,
        [id]
      ).catch(() => undefined);
      if (fetchedAt) {
        return {
          activity: cachedRow.activity ?? null,
          fetchedAt,
          cached: true,
          stale: true,
        };
      }
      throw error;
    }
  })().finally(() => {
    corporationActivityInflight.delete(id);
  });

  corporationActivityInflight.set(id, request);
  return request;
}

module.exports = {
  ensureCorporationActivityCacheSchema,
  resolveCorporationId,
  getCorporationActivity,
  _test: {
    cleanCorporationName,
    normalizeCorporationId,
    activityTtlMs,
    zkillIntervalMs,
  },
};
