const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LIVE_GRACE_MINUTES,
  liveStateForScopes,
  reportScopes,
} = require("../services/battleReports/db");
const { stabilizeSideIdentity } = require("../services/battleReports/analyzer");
const { connectedClients, eventPayload, publish, subscribe } = require("../services/battleReports/liveEvents");

test("battle report scopes prefer discovery rows and keep manual-only reports final", () => {
  const scoped = reportScopes({
    system_id: 30000142,
    start_time: "2026-09-04T20:00:00Z",
    end_time: "2026-09-04T21:00:00Z",
    data: {
      discovery: {
        scopes: [{ systemId: 31000005, systemName: "J100001", startTime: "2026-09-04T20:15:00Z", endTime: "2026-09-04T20:45:00Z" }],
      },
    },
  });
  assert.deepEqual(scoped, [{
    scope_index: 0,
    system_id: 31000005,
    system_name: "J100001",
    start_time: "2026-09-04T20:15:00Z",
    end_time: "2026-09-04T20:45:00Z",
  }]);

  assert.deepEqual(reportScopes({
    system_id: 30000142,
    start_time: "2026-09-04T20:00:00Z",
    end_time: "2026-09-04T21:00:00Z",
    data: { discovery: { scopes: [], manualRefs: 2 } },
  }), []);
});

test("live state observes scheduled, active, and 30-minute grace boundaries", () => {
  assert.equal(LIVE_GRACE_MINUTES, 30);
  const scopes = [{ start_time: "2026-09-04T20:00:00Z", end_time: "2026-09-04T21:00:00Z" }];
  assert.equal(liveStateForScopes(scopes, new Date("2026-09-04T19:59:59Z")).status, "scheduled");
  assert.equal(liveStateForScopes(scopes, new Date("2026-09-04T21:29:59Z")).status, "live");
  assert.equal(liveStateForScopes(scopes, new Date("2026-09-04T21:30:01Z")).status, "final");
});

test("side stabilization prevents inferred columns from swapping while retaining manual assignments", () => {
  const inferred = new Map([
    ["alliance:1", "side_2"],
    ["alliance:2", "side_1"],
    ["corporation:3", "side_1"],
  ]);
  const previous = [
    { key: "alliance:1", side_id: "side_1", pilot_count: 50 },
    { key: "alliance:2", side_id: "side_2", pilot_count: 30 },
    { key: "corporation:3", side_id: "side_2", pilot_count: 5 },
  ];
  const stabilized = stabilizeSideIdentity(inferred, previous, { "corporation:3": "side_3" });
  assert.equal(stabilized.get("alliance:1"), "side_1");
  assert.equal(stabilized.get("alliance:2"), "side_2");
  assert.equal(stabilized.get("corporation:3"), "side_3");
});

test("side stabilization permits a real entity move without swapping team identities", () => {
  const inferred = new Map([
    ["alliance:1", "side_1"],
    ["alliance:2", "side_2"],
    ["corporation:moved", "side_2"],
  ]);
  const previous = [
    { key: "alliance:1", side_id: "side_1", pilot_count: 50 },
    { key: "alliance:2", side_id: "side_2", pilot_count: 40 },
    { key: "corporation:moved", side_id: "side_1", pilot_count: 2 },
  ];
  const stabilized = stabilizeSideIdentity(inferred, previous, {});
  assert.equal(stabilized.get("alliance:1"), "side_1");
  assert.equal(stabilized.get("alliance:2"), "side_2");
  assert.equal(stabilized.get("corporation:moved"), "side_2");
});

test("live event broadcaster sends revision invalidations and releases clients", () => {
  const before = connectedClients();
  const received = [];
  const unsubscribe = subscribe("report-1", (event) => received.push(event));
  const report = {
    revision: 7,
    live_status: "live",
    live_last_update_at: "2026-09-04T21:00:00Z",
    summary: { totalKills: 12 },
  };
  publish("report-1", "report-updated", report, { newKillCount: 2 });
  assert.equal(connectedClients(), before + 1);
  assert.deepEqual(received, [{ type: "report-updated", data: eventPayload(report, { newKillCount: 2 }) }]);
  unsubscribe();
  assert.equal(connectedClients(), before);
});
