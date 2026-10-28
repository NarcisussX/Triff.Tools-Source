/*
 * Prometheus metrics for backend HTTP traffic, frontend error forwarding,
 * worker freshness, and market pipeline freshness.
 */

const client = require("prom-client");

const register = new client.Registry();
register.setDefaultLabels({
  app: "trifftools",
  service: process.env.SERVICE_NAME || "backend",
});

client.collectDefaultMetrics({
  register,
  prefix: "trifftools_",
});

const httpRequests = new client.Counter({
  name: "trifftools_http_requests_total",
  help: "Total HTTP requests handled by the backend.",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

const httpDuration = new client.Histogram({
  name: "trifftools_http_request_duration_seconds",
  help: "Backend HTTP request duration in seconds.",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const frontendErrors = new client.Counter({
  name: "trifftools_frontend_errors_total",
  help: "Client-side errors forwarded by frontend runtimes.",
  labelNames: ["source"],
  registers: [register],
});

const workerLastSuccessAge = new client.Gauge({
  name: "trifftools_worker_last_success_age_seconds",
  help: "Seconds since a worker last completed successfully.",
  labelNames: ["worker"],
  registers: [register],
});

const workerLastFailureAge = new client.Gauge({
  name: "trifftools_worker_last_failure_age_seconds",
  help: "Seconds since a worker last failed.",
  labelNames: ["worker"],
  registers: [register],
});

const workerLastDuration = new client.Gauge({
  name: "trifftools_worker_last_duration_ms",
  help: "Last recorded worker run duration in milliseconds.",
  labelNames: ["worker"],
  registers: [register],
});

const workerLastRows = new client.Gauge({
  name: "trifftools_worker_last_rows",
  help: "Last recorded worker row or unit count.",
  labelNames: ["worker"],
  registers: [register],
});

const marketAggregateAge = new client.Gauge({
  name: "trifftools_market_aggregate_max_age_seconds",
  help: "Maximum age in seconds for station market aggregate data.",
  registers: [register],
});

const battleReportsActive = new client.Gauge({
  name: "trifftools_battle_reports_live_active",
  help: "Number of scheduled or live battle reports.",
  registers: [register],
});

const battleReportSseClients = new client.Gauge({
  name: "trifftools_battle_report_sse_clients",
  help: "Number of currently connected battle report SSE clients.",
  registers: [register],
});

const battleReportIngestLag = new client.Gauge({
  name: "trifftools_battle_report_r2z2_ingest_lag_seconds",
  help: "Age of the most recently processed R2Z2 killmail.",
  registers: [register],
});

const battleReportRebuilds = new client.Counter({
  name: "trifftools_battle_report_rebuilds_total",
  help: "Battle report live rebuild attempts.",
  labelNames: ["status"],
  registers: [register],
});

const battleReportRebuildDuration = new client.Histogram({
  name: "trifftools_battle_report_rebuild_duration_seconds",
  help: "Duration of live battle report rebuilds.",
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register],
});

const battleReportReconciliationFailures = new client.Counter({
  name: "trifftools_battle_report_reconciliation_failures_total",
  help: "Failed eve-kill battle report reconciliation attempts.",
  registers: [register],
});

const battleReportCachePruned = new client.Counter({
  name: "trifftools_battle_report_cache_rows_pruned_total",
  help: "R2Z2 cache rows removed by retention maintenance.",
  registers: [register],
});

function normalizeMetricRoute(path) {
  const clean = String(path || "/").split("?")[0] || "/";
  return clean
    .replace(/\/+/g, "/")
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (/^\d+$/.test(segment)) return ":id";
      if (/^[0-9a-f]{24,64}$/i.test(segment)) return ":id";
      if (/^[a-z0-9_-]{24,160}$/i.test(segment) && /[a-z0-9]/i.test(segment)) return ":id";
      if (/^[a-z0-9]{6,16}$/i.test(segment) && /\d/.test(segment) && /[a-z]/i.test(segment)) return ":id";
      return segment;
    })
    .join("/")
    .slice(0, 160);
}

function shouldRecordHttpMetric(path) {
  const clean = String(path || "/").split("?")[0] || "/";
  return !/^\/api\/secret(?:\/|$)/i.test(clean);
}

function httpMetricsMiddleware(req, res, next) {
  if (!shouldRecordHttpMetric(req.originalUrl || req.url)) {
    next();
    return;
  }
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = {
      method: req.method,
      route: normalizeMetricRoute(req.originalUrl || req.url),
      status_code: String(res.statusCode),
    };
    httpRequests.inc(labels);
    httpDuration.observe(labels, seconds);
  });
  next();
}

function recordFrontendError(source) {
  frontendErrors.inc({ source: source || "browser" });
}

function setBattleReportsActive(count) {
  battleReportsActive.set(Math.max(0, Number(count) || 0));
}

function setBattleReportSseClients(count) {
  battleReportSseClients.set(Math.max(0, Number(count) || 0));
}

function setBattleReportIngestLag(killmailTime) {
  const timestamp = new Date(killmailTime).getTime();
  if (Number.isFinite(timestamp)) battleReportIngestLag.set(Math.max(0, (Date.now() - timestamp) / 1000));
}

function recordBattleReportRebuild(status, durationSeconds) {
  battleReportRebuilds.inc({ status: status || "unknown" });
  if (Number.isFinite(Number(durationSeconds))) battleReportRebuildDuration.observe(Number(durationSeconds));
}

function recordBattleReportReconciliationFailure() {
  battleReportReconciliationFailures.inc();
}

function recordBattleReportCachePruned(count) {
  if (Number(count) > 0) battleReportCachePruned.inc(Number(count));
}

function ageSeconds(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

async function refreshOperationalGauges(db) {
  try {
    const { rows } = await db.query(`
      SELECT EXTRACT(EPOCH FROM (now() - MAX(last_updated)))::int AS age_seconds
      FROM market_station_aggregates
    `);
    const age = Number(rows[0]?.age_seconds);
    if (Number.isFinite(age)) marketAggregateAge.set(age);
  } catch {
    // Metrics must remain best-effort.
  }

  try {
    const tableCheck = await db.query(`SELECT to_regclass('public.worker_heartbeats') AS table_name`);
    if (!tableCheck.rows[0]?.table_name) return;
    const { rows } = await db.query(`
      SELECT worker_name, last_success_at, last_failure_at, last_duration_ms, last_rows
      FROM worker_heartbeats
    `);
    for (const row of rows) {
      const worker = row.worker_name;
      const successAge = ageSeconds(row.last_success_at);
      const failureAge = ageSeconds(row.last_failure_at);
      if (successAge != null) workerLastSuccessAge.set({ worker }, successAge);
      if (failureAge != null) workerLastFailureAge.set({ worker }, failureAge);
      const duration = Number(row.last_duration_ms);
      if (Number.isFinite(duration)) workerLastDuration.set({ worker }, duration);
      const rowsValue = Number(row.last_rows);
      if (Number.isFinite(rowsValue)) workerLastRows.set({ worker }, rowsValue);
    }
  } catch {
    // Metrics must remain best-effort.
  }
}

function authorizeMetricsRequest(req) {
  const token = process.env.METRICS_BEARER_TOKEN;
  if (!token) return true;
  const auth = String(req.headers.authorization || "");
  if (auth === `Bearer ${token}`) return true;
  return String(req.headers["x-metrics-token"] || "") === token;
}

function metricsRoute(db) {
  return async (req, res, next) => {
    try {
      if (!authorizeMetricsRequest(req)) {
        res.status(403).type("text/plain").send("forbidden\n");
        return;
      }
      await refreshOperationalGauges(db);
      res.set("Content-Type", register.contentType);
      res.end(await register.metrics());
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  httpMetricsMiddleware,
  metricsRoute,
  normalizeMetricRoute,
  shouldRecordHttpMetric,
  recordFrontendError,
  setBattleReportsActive,
  setBattleReportSseClients,
  setBattleReportIngestLag,
  recordBattleReportRebuild,
  recordBattleReportReconciliationFailure,
  recordBattleReportCachePruned,
  refreshOperationalGauges,
  register,
};
