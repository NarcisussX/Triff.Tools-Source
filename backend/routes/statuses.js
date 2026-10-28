/*
 * Express router for statuses API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const router = require("express").Router();
const db = require("../db");

const fetchFn =
  typeof fetch !== "undefined"
    ? fetch
    : (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const START_TIME = Date.now();

const CADENCE_MIN = Number(process.env.MARKET_CADENCE_MIN || 30);
const OK_WINDOW_MIN = Number(process.env.STATUS_OK_WINDOW_MIN || 45);
const WARN_WINDOW_MIN = Number(process.env.STATUS_WARN_WINDOW_MIN || 90);
const READY_FAIL_ON_DEGRADED = /^(1|true|yes|on)$/i.test(process.env.STATUS_READY_FAIL_ON_DEGRADED || "");

const WORKER_EXPECTED_INTERVAL_MIN = {
  "market-worker": CADENCE_MIN,
  "market-orders-worker": Number(process.env.MARKET_ORDERS_WORKER_INTERVAL_MIN || 5),
  "market-history-worker": Number(process.env.MARKET_HISTORY_WORKER_INTERVAL_MIN || 360),
};

const STATUS_RANK = {
  OK: 0,
  DEGRADED: 1,
  UNKNOWN: 2,
  STALE: 3,
  FAILED: 4,
};

async function tryDb() {
  const t0 = Date.now();
  try {
    await db.query("SELECT 1");
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e.message };
  }
}

async function priceFreshness() {
  const { rows } = await db.query(`
    SELECT station_id,
           MAX(last_updated) AS last_updated,
           EXTRACT(EPOCH FROM (now() - MAX(last_updated)))::int AS age_seconds
    FROM market_station_aggregates
    GROUP BY station_id
    ORDER BY station_id
  `);
  return rows;
}

function ageSeconds(value, nowMs = Date.now()) {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 1000));
}

function classifyPipeline(maxAgeSeconds) {
  if (maxAgeSeconds == null) {
    return { status: "UNKNOWN", detail: "No aggregates yet" };
  }
  const ageMinutes = maxAgeSeconds / 60;
  if (ageMinutes <= OK_WINDOW_MIN) {
    return { status: "OK", detail: `max ${Math.round(ageMinutes)}m` };
  }
  if (ageMinutes <= WARN_WINDOW_MIN) {
    return { status: "DEGRADED", detail: `max ${Math.round(ageMinutes)}m` };
  }
  return { status: "STALE", detail: `max ${Math.round(ageMinutes)}m` };
}

function workerExpectedMinutes(workerName) {
  return WORKER_EXPECTED_INTERVAL_MIN[workerName] || Number(process.env.WORKER_DEFAULT_INTERVAL_MIN || 30);
}

function classifyWorker(row, nowMs = Date.now()) {
  const expectedMin = workerExpectedMinutes(row.worker_name);
  const successAgeSeconds = ageSeconds(row.last_success_at, nowMs);
  const failureAgeSeconds = ageSeconds(row.last_failure_at, nowMs);
  const successAt = row.last_success_at ? new Date(row.last_success_at).getTime() : null;
  const failureAt = row.last_failure_at ? new Date(row.last_failure_at).getTime() : null;
  const failureIsLatest = failureAt && (!successAt || failureAt > successAt);

  if (successAgeSeconds == null) {
    return {
      status: failureIsLatest ? "FAILED" : "UNKNOWN",
      expected_interval_minutes: expectedMin,
      last_success_age_seconds: null,
      last_failure_age_seconds: failureAgeSeconds,
    };
  }

  const okSeconds = Math.max((expectedMin * 2 + 5) * 60, (expectedMin + 15) * 60);
  const warnSeconds = Math.max((expectedMin * 4 + 15) * 60, (expectedMin + 60) * 60);
  let status = "OK";
  if (successAgeSeconds > warnSeconds) status = "STALE";
  else if (successAgeSeconds > okSeconds) status = "DEGRADED";
  if (failureIsLatest && status === "OK") status = "DEGRADED";
  if (failureIsLatest && status === "DEGRADED" && successAgeSeconds > okSeconds) status = "FAILED";

  return {
    status,
    expected_interval_minutes: expectedMin,
    last_success_age_seconds: successAgeSeconds,
    last_failure_age_seconds: failureAgeSeconds,
  };
}

function worstStatus(statuses) {
  return statuses.reduce((worst, status) => (
    (STATUS_RANK[status] ?? STATUS_RANK.UNKNOWN) > (STATUS_RANK[worst] ?? STATUS_RANK.UNKNOWN)
      ? status
      : worst
  ), "OK");
}

async function workerFreshness() {
  const tableCheck = await db.query(`SELECT to_regclass('public.worker_heartbeats') AS table_name`);
  if (!tableCheck.rows[0]?.table_name) {
    return { available: false, status: "UNKNOWN", workers: [] };
  }

  const { rows } = await db.query(`
    SELECT worker_name,
           last_started_at,
           last_success_at,
           last_failure_at,
           last_error,
           last_duration_ms,
           last_rows,
           updated_at
    FROM worker_heartbeats
    ORDER BY worker_name
  `);

  const workers = rows.map((row) => {
    const classified = classifyWorker(row);
    return {
      worker_name: row.worker_name,
      status: classified.status,
      expected_interval_minutes: classified.expected_interval_minutes,
      last_started_at: row.last_started_at,
      last_success_at: row.last_success_at,
      last_failure_at: row.last_failure_at,
      last_success_age_seconds: classified.last_success_age_seconds,
      last_failure_age_seconds: classified.last_failure_age_seconds,
      last_duration_ms: row.last_duration_ms == null ? null : Number(row.last_duration_ms),
      last_rows: row.last_rows == null ? null : Number(row.last_rows),
      last_error: row.last_error || null,
    };
  });

  return {
    available: true,
    status: workers.length ? worstStatus(workers.map((worker) => worker.status)) : "UNKNOWN",
    workers,
  };
}

async function sdeStatus() {
  const tableCheck = await db.query(
    `SELECT to_regclass('evesde._meta') AS table_name`
  );

  if (!tableCheck.rows[0]?.table_name) {
    return {
      available: false,
      build: null,
      version: null,
      updated_at: null,
    };
  }

  const { rows } = await db.query(
    `SELECT value FROM evesde._meta WHERE key = 'sde_build' LIMIT 1`
  );
  const value = rows[0]?.value || null;
  const numericBuild = value && /^\d+$/.test(value) ? Number(value) : null;

  return {
    available: Boolean(value),
    build: numericBuild,
    version: value,
    updated_at: null,
  };
}

async function ping(url, timeoutMs = 2500) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetchFn(url, { method: "HEAD", signal: ctrl.signal });
    clearTimeout(tid);
    return { url, ok: r.ok, ms: Date.now() - t0, status: r.status };
  } catch (e) {
    clearTimeout(tid);
    return { url, ok: false, ms: Date.now() - t0, error: e.message };
  }
}

router.get("/sde", async (_req, res) => {
  try {
    res.json({
      ok: true,
      sde: await sdeStatus(),
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message,
      sde: {
        available: false,
        build: null,
        version: null,
        updated_at: null,
      },
    });
  }
});

router.get("/", async (_req, res) => {
  try {
    const [dbStatus, prices, workers, esi, zkill] = await Promise.all([
      tryDb(),
      priceFreshness(),
      workerFreshness(),
      ping("https://esi.evetech.net/"),
      ping("https://zkillboard.com/api/kills/solarSystemID/31001403/year/2025/month/7/"),
    ]);

    const ages = Array.isArray(prices) ? prices.map((p) => Number(p.age_seconds) || 0) : [];
    const maxAge = ages.length ? Math.max(...ages) : null;
    const pipeline = classifyPipeline(maxAge);
    const overallStatus = worstStatus([
      dbStatus.ok ? "OK" : "FAILED",
      pipeline.status,
      workers.status,
    ]);

    let nextExpected = null;
    if (Array.isArray(prices) && prices.length) {
      const newest = prices.reduce((a, b) =>
        new Date(a.last_updated) > new Date(b.last_updated) ? a : b
      );
      const next = new Date(new Date(newest.last_updated).getTime() + CADENCE_MIN * 60 * 1000);
      nextExpected = next.toISOString();
    }

    res.json({
      ok: overallStatus === "OK" || overallStatus === "DEGRADED",
      now: new Date().toISOString(),
      uptime_seconds: Math.floor((Date.now() - START_TIME) / 1000),
      build: {
        commit: process.env.BUILD_COMMIT || null,
        env: process.env.NODE_ENV || "Production",
      },
      overall_status: overallStatus,
      db: dbStatus,
      prices: prices.map(({ station_id, age_seconds }) => ({ station_id, age_seconds })),
      pipeline,
      workers,
      cadence_minutes: CADENCE_MIN,
      next_expected_update: nextExpected,
      deps: { esi, zkill },
    });
  } catch (e) {
    res.status(500).json({ now: new Date().toISOString(), error: e.message });
  }
});

router.get("/ready", async (_req, res) => {
  try {
    const [dbStatus, prices, workers] = await Promise.all([
      tryDb(),
      priceFreshness(),
      workerFreshness(),
    ]);
    const ages = Array.isArray(prices) ? prices.map((p) => Number(p.age_seconds) || 0) : [];
    const pipeline = classifyPipeline(ages.length ? Math.max(...ages) : null);
    const overallStatus = worstStatus([
      dbStatus.ok ? "OK" : "FAILED",
      pipeline.status,
      workers.status,
    ]);
    const ready = READY_FAIL_ON_DEGRADED
      ? overallStatus === "OK"
      : !["FAILED", "STALE"].includes(overallStatus);

    res.status(ready ? 200 : 503).json({
      ok: ready,
      overall_status: overallStatus,
      db: dbStatus,
      pipeline,
      workers,
      now: new Date().toISOString(),
    });
  } catch (e) {
    res.status(503).json({ ok: false, overall_status: "FAILED", error: e.message, now: new Date().toISOString() });
  }
});

module.exports = router;
module.exports._private = {
  ageSeconds,
  classifyPipeline,
  classifyWorker,
  workerExpectedMinutes,
  worstStatus,
};
