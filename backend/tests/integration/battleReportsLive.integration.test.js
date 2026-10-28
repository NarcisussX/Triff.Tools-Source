const test = require("node:test");
const assert = require("node:assert/strict");
const { startDisposablePostgres } = require("./disposablePostgres");

async function maybeStartPostgres(t) {
  try {
    return await startDisposablePostgres();
  } catch (err) {
    t.skip(err.message);
    return null;
  }
}

function kill(id, time, value = 100, extraZkb = {}) {
  return {
    esi: {
      killmail_id: id,
      killmail_time: time,
      solar_system_id: 31000005,
      victim: { character_id: 90000001, corporation_id: 98000001, ship_type_id: 587 },
      attackers: [],
    },
    zkb: {
      totalValue: value,
      _triff_ingest_source: "zkill-r2z2",
      _triff_value_source: "zkill",
      ...extraZkb,
    },
    totalValue: value,
  };
}

test("live BR persistence deduplicates, queues concurrent events, streams, and prunes by fetched_at", async (t) => {
  const pg = await maybeStartPostgres(t);
  if (!pg) return;
  process.env.DATABASE_URL = pg.databaseUrl;
  process.env.PGSSL = "false";

  const db = require("../../services/battleReports/db");
  const { connectedClients } = require("../../services/battleReports/liveEvents");
  const { pool } = require("../../db");
  let server = null;
  t.after(async () => {
    delete process.env.BR_SSE_HEARTBEAT_MS;
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end().catch(() => {});
    pg.stop();
  });
  await db.ensureBattleReportSchema();

  const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const firstKill = kill(100000001, new Date(Date.now() - 30 * 60 * 1000).toISOString());
  const report = {
    id: "live-test-report",
    title: "Live Test",
    system_id: 31000005,
    system_name: "J100001",
    start_time: start,
    end_time: end,
    value_mode: "zkill",
    source_mode: "zkill_r2z2",
    summary: { totalKills: 1, shipsLost: 1 },
    sides: [],
    entities: [],
    side_overrides: {},
    side_names: {},
    data: { discovery: { scopes: [{ systemId: 31000005, systemName: "J100001", startTime: start, endTime: end }] }, killmails: [] },
    killmails: [firstKill],
  };
  const saved = await db.saveBattleReport(report);
  assert.equal(saved.live_status, "live");
  assert.equal(Number(saved.revision), 1);
  assert.equal((await db.getBattleReportScopes(report.id)).length, 1);

  const duplicate = await db.attachKillmailToLiveReports({ ...firstKill, sequenceId: 10 });
  assert.equal(duplicate.length, 0);

  const secondKill = kill(100000002, new Date(Date.now() - 20 * 60 * 1000).toISOString(), 200);
  const firstChange = await db.attachKillmailToLiveReports({ ...secondKill, sequenceId: 11 });
  assert.equal(firstChange[0].added, 1);
  const pending = (await db.listPendingLiveReports({ debounceMs: 0, maxBatchMs: 0 }))[0];
  assert.equal(Number(pending.live_change_token), 1);

  const thirdKill = kill(100000003, new Date(Date.now() - 10 * 60 * 1000).toISOString(), 300);
  await db.attachKillmailToLiveReports({ ...thirdKill, sequenceId: 12 });
  const rebuilt = {
    ...report,
    summary: { totalKills: 2, shipsLost: 2 },
    data: { ...report.data, marker: "first-batch" },
  };
  const committed = await db.commitLiveReportRebuild(
    report.id,
    pending.revision,
    pending.live_change_token,
    pending.live_latest_sequence,
    rebuilt
  );
  assert.equal(Number(committed.live_processed_token), 1);
  assert.equal(Number(committed.live_change_token), 2);
  assert.ok(committed.live_dirty_since);

  const conflict = await db.patchBattleReportSides(report.id, {
    side_overrides: {}, side_names: {}, summary: {}, sides: [], entities: [], data: {}, expected_revision: 1,
  });
  assert.equal(conflict, null);

  const staleKill = kill(100000099, "2030-01-01T00:00:00Z", 50);
  await db.upsertKillmailCache({ ...staleKill, sequenceId: 99 });
  await pool.query("UPDATE br_killmail_cache SET fetched_at = now() - interval '8 days' WHERE killmail_id = $1", [staleKill.esi.killmail_id]);
  assert.equal(await db.pruneKillmailCache({ retentionDays: 7, limit: 100 }), 1);
  assert.equal(await db.getCachedKillmail(staleKill.esi.killmail_id), null);

  const express = require("express");
  process.env.BR_SSE_HEARTBEAT_MS = "25";
  const app = express();
  app.use(express.json());
  app.use("/api/br", require("../../routes/battleReports"));
  server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/br/${report.id}/events`, { signal: controller.signal });
  assert.match(response.headers.get("content-type") || "", /^text\/event-stream(?:;|$)/);
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  const reader = response.body.getReader();
  let opening = "";
  while (!opening.includes("event: ready")) {
    const chunk = await reader.read();
    if (chunk.done) break;
    opening += new TextDecoder().decode(chunk.value);
  }
  assert.match(opening, /event: ready/);
  assert.match(opening, /"revision":2/);
  let heartbeatText = opening;
  while (!heartbeatText.includes(": heartbeat")) {
    const chunk = await reader.read();
    if (chunk.done) break;
    heartbeatText += new TextDecoder().decode(chunk.value);
  }
  assert.match(heartbeatText, /: heartbeat/);
  assert.equal(connectedClients(), 1);
  controller.abort();
  await reader.cancel().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(connectedClients(), 0);

  await new Promise((resolve) => server.close(resolve));
  server = null;
  delete process.env.BR_SSE_HEARTBEAT_MS;
});
