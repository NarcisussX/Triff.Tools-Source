/*
 * Rebuilds live reports in short batches, reconciles their scopes, and applies
 * retention to the global R2Z2 cache. Database tokens make restarts lossless.
 */

const {
  activateScheduledReports,
  addKillsToReport,
  commitLiveReportRebuild,
  countActiveLiveReports,
  finalizeReadyReports,
  finishScopeReconcile,
  getBattleReportKillmails,
  listDueReconciliationScopes,
  listPendingLiveReports,
  markScopeReconcileAttempt,
  pruneKillmailCache,
} = require("../services/battleReports/db");
const { discoverByEveKillSearch, rebuildExistingReport } = require("../services/battleReports/analyzer");
const { publish } = require("../services/battleReports/liveEvents");
const {
  recordBattleReportCachePruned,
  recordBattleReportRebuild,
  recordBattleReportReconciliationFailure,
  setBattleReportsActive,
} = require("../lib/metrics");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let running = false;
let stopped = false;
let lastReconciliationScan = 0;
let lastRetentionRun = 0;
let lastActiveGauge = 0;

async function rebuildPendingReports() {
  const pending = await listPendingLiveReports({
    debounceMs: Number(process.env.BR_LIVE_DEBOUNCE_MS || 3000),
    maxBatchMs: Number(process.env.BR_LIVE_MAX_BATCH_MS || 5000),
    limit: Number(process.env.BR_LIVE_REBUILD_BATCH || 4),
  });

  for (const report of pending) {
    const started = Date.now();
    try {
      const killRows = await getBattleReportKillmails(report.id);
      const priorKillCount = Number(report.summary?.totalKills ?? report.summary?.shipsLost ?? 0);
      const rebuilt = await rebuildExistingReport(
        report,
        killRows,
        report.side_overrides || {},
        report.side_names || {}
      );
      const updated = await commitLiveReportRebuild(
        report.id,
        report.revision,
        report.live_change_token,
        report.live_latest_sequence,
        rebuilt
      );

      const duration = (Date.now() - started) / 1000;
      if (!updated) {
        recordBattleReportRebuild("revision_conflict", duration);
        continue;
      }
      const nextKillCount = Number(updated.summary?.totalKills ?? updated.summary?.shipsLost ?? 0);
      const newKillCount = Math.max(0, nextKillCount - priorKillCount);
      recordBattleReportRebuild("success", duration);
      publish(report.id, "report-updated", updated, { newKillCount });
      console.log(`[br/live] rebuilt ${report.id} at revision ${updated.revision} (${newKillCount} new killmails, ${Math.round(duration * 1000)}ms)`);
    } catch (err) {
      recordBattleReportRebuild("failure", (Date.now() - started) / 1000);
      console.warn(`[br/live] rebuild failed for ${report.id}:`, err.message);
    }
  }
}

async function reconcileDueScopes() {
  const due = await listDueReconciliationScopes({
    intervalMinutes: Number(process.env.BR_RECONCILE_INTERVAL_MINUTES || 5),
    limit: Number(process.env.BR_RECONCILE_BATCH || 2),
  });

  for (const row of due) {
    await markScopeReconcileAttempt(row.battle_report_id, row.scope_index);
    try {
      const start = new Date(row.start_time);
      const configuredEnd = new Date(row.end_time);
      const end = new Date(Math.min(Date.now(), configuredEnd.getTime()));
      const kills = end > start
        ? await discoverByEveKillSearch([{
          id: Number(row.system_id),
          name: row.system_name || String(row.system_id),
          start,
          end,
        }])
        : [];
      const result = await addKillsToReport(row.battle_report_id, kills);
      await finishScopeReconcile(row.battle_report_id, row.scope_index);
      console.log(`[br/live] reconciled ${row.battle_report_id} scope ${row.scope_index}: ${kills.length} seen, ${result.added} added, ${result.changed} changed`);
    } catch (err) {
      recordBattleReportReconciliationFailure();
      await finishScopeReconcile(row.battle_report_id, row.scope_index, { error: err.message });
      console.warn(`[br/live] reconciliation failed for ${row.battle_report_id} scope ${row.scope_index}:`, err.message);
    }
  }
}

async function runRetention() {
  const retentionDays = Number(process.env.BR_R2Z2_CACHE_RETENTION_DAYS || 7);
  const batchSize = Number(process.env.BR_R2Z2_PRUNE_BATCH || 25000);
  let total = 0;
  while (!stopped) {
    const pruned = await pruneKillmailCache({ retentionDays, limit: batchSize });
    total += pruned;
    recordBattleReportCachePruned(pruned);
    if (pruned < batchSize) break;
    await sleep(100);
  }
  if (total) console.log(`[br/live] pruned ${total.toLocaleString()} R2Z2 cache rows older than ${retentionDays} days`);
}

async function liveWorkerLoop() {
  const tickMs = Math.max(250, Number(process.env.BR_LIVE_WORKER_TICK_MS || 1000));
  const reconciliationScanMs = Math.max(10000, Number(process.env.BR_RECONCILE_SCAN_MS || 30000));
  const retentionMs = Math.max(60000, Number(process.env.BR_R2Z2_PRUNE_INTERVAL_MS || 24 * 60 * 60 * 1000));
  const retentionInitialDelayMs = Math.max(0, Number(process.env.BR_R2Z2_PRUNE_INITIAL_DELAY_MS || 60000));

  while (!stopped) {
    try {
      const activated = await activateScheduledReports();
      for (const report of activated) publish(report.id, "report-updated", report);

      await rebuildPendingReports();

      if (Date.now() - lastReconciliationScan >= reconciliationScanMs) {
        lastReconciliationScan = Date.now();
        await reconcileDueScopes();
      }

      const finalized = await finalizeReadyReports();
      for (const report of finalized) publish(report.id, "finalized", report);

      if (Date.now() - lastActiveGauge >= 10000) {
        lastActiveGauge = Date.now();
        setBattleReportsActive(await countActiveLiveReports());
      }

      const sinceStart = Date.now() - lastRetentionRun;
      if ((!lastRetentionRun && sinceStart >= retentionInitialDelayMs) || (lastRetentionRun && sinceStart >= retentionMs)) {
        lastRetentionRun = Date.now();
        await runRetention();
      }
    } catch (err) {
      console.warn("[br/live] worker tick failed:", err.message);
    }
    await sleep(tickMs);
  }
  running = false;
}

function startLiveBattleReportWorker() {
  if (process.env.BR_LIVE_WORKER_ENABLED === "false" || running) return;
  running = true;
  stopped = false;
  lastRetentionRun = Date.now() - Math.max(0, Number(process.env.BR_R2Z2_PRUNE_INTERVAL_MS || 24 * 60 * 60 * 1000))
    + Math.max(0, Number(process.env.BR_R2Z2_PRUNE_INITIAL_DELAY_MS || 60000));
  void liveWorkerLoop();
  console.log("[br/live] worker started");
}

function stopLiveBattleReportWorker() {
  stopped = true;
}

module.exports = {
  startLiveBattleReportWorker,
  stopLiveBattleReportWorker,
  rebuildPendingReports,
  reconcileDueScopes,
  runRetention,
};
