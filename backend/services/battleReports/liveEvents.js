/*
 * In-process invalidation broadcaster for live battle report viewers.
 * Persisted revisions remain authoritative; this only wakes connected clients.
 */

const { setBattleReportSseClients } = require("../../lib/metrics");

const listeners = new Map();
let listenerCount = 0;

function subscribe(reportId, listener) {
  const key = String(reportId);
  const reportListeners = listeners.get(key) || new Set();
  reportListeners.add(listener);
  listeners.set(key, reportListeners);
  listenerCount += 1;
  setBattleReportSseClients(listenerCount);

  return () => {
    const current = listeners.get(key);
    if (!current || !current.delete(listener)) return;
    listenerCount = Math.max(0, listenerCount - 1);
    if (!current.size) listeners.delete(key);
    setBattleReportSseClients(listenerCount);
  };
}

function eventPayload(report, extra = {}) {
  const summary = report?.summary || {};
  return {
    revision: Number(report?.revision || 0),
    status: report?.live_status || "final",
    updatedAt: report?.live_last_update_at || report?.updated_at || new Date().toISOString(),
    totalKills: Number(summary.totalKills ?? summary.shipsLost ?? 0),
    newKillCount: Math.max(0, Number(extra.newKillCount || 0)),
  };
}

function publish(reportId, type, report, extra = {}) {
  const event = { type, data: eventPayload(report, extra) };
  for (const listener of listeners.get(String(reportId)) || []) {
    try {
      listener(event);
    } catch (err) {
      console.warn("[br/live-events] listener failed:", err.message);
    }
  }
  return event;
}

function connectedClients() {
  return listenerCount;
}

module.exports = { subscribe, publish, eventPayload, connectedClients };
