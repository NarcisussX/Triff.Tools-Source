const test = require("node:test");
const assert = require("node:assert/strict");
const { installExternalModuleFallbacks } = require("./helpers/moduleStubs");

installExternalModuleFallbacks();

const sentry = require("../lib/sentry");
const metrics = require("../lib/metrics");
const workerHeartbeat = require("../lib/workerHeartbeat");
const statusPrivate = require("../routes/statuses")._private;

test("Sentry scrubber filters sensitive request and context fields", () => {
  const event = sentry.scrubEvent({
    request: {
      headers: {
        authorization: "Bearer secret",
        cookie: "session=secret",
        "user-agent": "test",
      },
      query_string: "code=secret",
      data: { password: "secret", nested: { token: "secret" } },
    },
    extra: {
      refresh_token: "secret",
      safe: "visible",
    },
  });

  assert.equal(event.request.headers.authorization, "[Filtered]");
  assert.equal(event.request.headers.cookie, "[Filtered]");
  assert.equal(event.request.headers["user-agent"], "test");
  assert.equal(event.request.query_string, "[Filtered]");
  assert.equal(event.request.data, "[Filtered]");
  assert.equal(event.extra.refresh_token, "[Filtered]");
  assert.equal(event.extra.safe, "visible");
});

test("metrics route labels collapse ids and share tokens", () => {
  assert.equal(metrics.normalizeMetricRoute("/api/items/34?x=1"), "/api/items/:id");
  assert.equal(metrics.normalizeMetricRoute("/api/fitting/shared-fits/894FNF7L8G/import"), "/api/fitting/shared-fits/:id/import");
  assert.equal(metrics.normalizeMetricRoute("/api/account/links/fitting-saved-fit/0123456789abcdef0123456789abcdef"), "/api/account/links/fitting-saved-fit/:id");
  assert.equal(metrics.normalizeMetricRoute("/api/secret/replay/yN9m_4Qf-6eP2xR8uA7cV3bK1dH5sT0wZqL2jFg"), "/api/secret/replay/:id");
  assert.equal(metrics.shouldRecordHttpMetric("/api/secret/login"), false);
  assert.equal(metrics.shouldRecordHttpMetric("/api/secret/observations?sort=jcode"), false);
  assert.equal(metrics.shouldRecordHttpMetric("/api/structure-intel/check"), true);
});

test("worker heartbeat writes are best-effort and include failure details", async () => {
  const calls = [];
  const fakePool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };

  assert.equal(await workerHeartbeat.markWorkerStarted(fakePool, "market-worker"), true);
  assert.equal(await workerHeartbeat.markWorkerSuccess(fakePool, "market-worker", { durationMs: 123.4, rows: 5 }), true);
  assert.equal(await workerHeartbeat.markWorkerFailure(fakePool, "market-worker", new Error("boom"), { durationMs: 44 }), true);

  const lastCall = calls[calls.length - 1];
  assert.equal(lastCall.params[0], "market-worker");
  assert.match(lastCall.params[4], /boom/);
  assert.equal(lastCall.params[5], 44);
});

test("status helpers classify stale workers without affecting route behavior", () => {
  const now = Date.parse("2026-05-25T00:00:00.000Z");
  const fresh = statusPrivate.classifyWorker({
    worker_name: "market-worker",
    last_success_at: new Date(now - 10 * 60 * 1000),
    last_failure_at: null,
  }, now);
  const stale = statusPrivate.classifyWorker({
    worker_name: "market-orders-worker",
    last_success_at: new Date(now - 3 * 60 * 60 * 1000),
    last_failure_at: null,
  }, now);
  const failed = statusPrivate.classifyWorker({
    worker_name: "market-history-worker",
    last_success_at: null,
    last_failure_at: new Date(now - 60 * 1000),
  }, now);

  assert.equal(fresh.status, "OK");
  assert.equal(stale.status, "STALE");
  assert.equal(failed.status, "FAILED");
  assert.equal(statusPrivate.worstStatus(["OK", "DEGRADED", "FAILED"]), "FAILED");
});
