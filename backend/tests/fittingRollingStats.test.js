const test = require("node:test");
const assert = require("node:assert/strict");
const { installExternalModuleFallbacks } = require("./helpers/moduleStubs");

installExternalModuleFallbacks();

const fittingRoute = require("../routes/fitting")._test;

test("fitting rolling stats accepts eft body aliases", () => {
  assert.equal(fittingRoute.readRollingStatsEft({ eft: "eft text" }), "eft text");
  assert.equal(fittingRoute.readRollingStatsEft({ eftText: "eftText text" }), "eftText text");
  assert.equal(fittingRoute.readRollingStatsEft({ text: "plain text" }), "plain text");
  assert.equal(fittingRoute.readRollingStatsEft({ eft: 123, text: "fallback text" }), "fallback text");
  assert.equal(fittingRoute.readRollingStatsEft({}), "");
});

test("fitting rolling stats rate limit uses burst and refills over time", () => {
  const now = Date.UTC(2026, 5, 20, 12, 0, 0);
  const principal = `test:rolling:${now}`;

  for (let i = 0; i < 40; i += 1) {
    assert.equal(fittingRoute.checkRollingStatsRateLimit(principal, now).ok, true);
  }

  assert.deepEqual(fittingRoute.checkRollingStatsRateLimit(principal, now), {
    ok: false,
    error: "rate_limited",
  });
  assert.equal(fittingRoute.checkRollingStatsRateLimit(principal, now + 60 * 1000).ok, true);
});
