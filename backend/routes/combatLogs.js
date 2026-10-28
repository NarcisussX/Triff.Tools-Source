const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const siteAuth = require("../services/siteAuth");
const { recordAccountGeneratedLink } = require("../services/accountLinks");
const {
  ensureCombatLogReportSchema,
  saveCombatLogReport,
  getCombatLogReport,
} = require("../services/combatLogReports/db");

const router = express.Router();

router.use(cookieParser());

const MAX_ARRAY_ROWS = 12000;
const MAX_EVENT_ROWS = 100000;
const MAX_TITLE_LENGTH = 180;
const MAX_FILENAME_LENGTH = 240;
const MAX_LISTENER_LENGTH = 120;

function newReportId() {
  return crypto.randomBytes(8).toString("base64url");
}

function cleanText(value, max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanIso(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanJson(value, fallback) {
  if (value == null || typeof value !== "object") return fallback;
  return value;
}

function limitArray(value, limit = MAX_ARRAY_ROWS) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function normalizeSummary(input) {
  const source = cleanJson(input, {});
  return {
    totalLines: cleanNumber(source.totalLines),
    parsedLines: cleanNumber(source.parsedLines),
    combatEvents: cleanNumber(source.combatEvents),
    damageOut: cleanNumber(source.damageOut),
    damageIn: cleanNumber(source.damageIn),
    repairsOut: cleanNumber(source.repairsOut),
    repairsIn: cleanNumber(source.repairsIn),
    capacitorOut: cleanNumber(source.capacitorOut),
    capacitorIn: cleanNumber(source.capacitorIn),
    ewarEvents: cleanNumber(source.ewarEvents),
    missedShots: cleanNumber(source.missedShots),
    targets: cleanNumber(source.targets),
    attackers: cleanNumber(source.attackers),
    weapons: cleanNumber(source.weapons),
    durationSeconds: cleanNumber(source.durationSeconds),
    activeDamageOutSeconds: cleanNumber(source.activeDamageOutSeconds),
    activeDamageInSeconds: cleanNumber(source.activeDamageInSeconds),
    activeDpsOut: cleanNumber(source.activeDpsOut ?? source.dpsOut),
    activeDpsIn: cleanNumber(source.activeDpsIn ?? source.dpsIn),
    windowDpsOut: cleanNumber(source.windowDpsOut ?? source.dpsOut),
    windowDpsIn: cleanNumber(source.windowDpsIn ?? source.dpsIn),
    dpsOut: cleanNumber(source.dpsOut ?? source.activeDpsOut),
    dpsIn: cleanNumber(source.dpsIn ?? source.activeDpsIn),
    parseRatio: cleanNumber(source.parseRatio),
  };
}

function normalizeData(input) {
  const source = cleanJson(input, {});
  return {
    version: cleanNumber(source.version, 1),
    generatedAt: cleanIso(source.generatedAt) || new Date().toISOString(),
    topDamageOutTargets: limitArray(source.topDamageOutTargets),
    topDamageInSources: limitArray(source.topDamageInSources),
    outgoingWeapons: limitArray(source.outgoingWeapons),
    incomingWeapons: limitArray(source.incomingWeapons),
    capacitorTargets: limitArray(source.capacitorTargets),
    capacitorSources: limitArray(source.capacitorSources),
    repairTargets: limitArray(source.repairTargets),
    repairSources: limitArray(source.repairSources),
    ewar: limitArray(source.ewar),
    ewarTargets: limitArray(source.ewarTargets),
    ewarSources: limitArray(source.ewarSources),
    ewarModules: limitArray(source.ewarModules),
    hitQuality: limitArray(source.hitQuality),
    timeline: limitArray(source.timeline),
    engagements: limitArray(source.engagements),
    events: limitArray(source.events, MAX_EVENT_ROWS),
    diagnostics: cleanJson(source.diagnostics, {}),
  };
}

function normalizeReportBody(body) {
  const report = cleanJson(body?.report || body, {});
  const summary = normalizeSummary(report.summary);
  const data = normalizeData(report.data);

  if (!summary.combatEvents && !summary.parsedLines) {
    const err = new Error("combat_log_report_empty");
    err.status = 400;
    err.message = "Report has no parsed combat events.";
    throw err;
  }

  return {
    id: newReportId(),
    title: cleanText(report.title, MAX_TITLE_LENGTH) || "Combat Log Report",
    fileName: cleanText(report.fileName, MAX_FILENAME_LENGTH) || null,
    listener: cleanText(report.listener, MAX_LISTENER_LENGTH) || null,
    sessionStartedAt: cleanIso(report.sessionStartedAt),
    startTime: cleanIso(report.startTime),
    endTime: cleanIso(report.endTime),
    summary,
    data,
  };
}

router.post("/reports", async (req, res) => {
  try {
    const report = normalizeReportBody(req.body);
    await ensureCombatLogReportSchema();
    const saved = await saveCombatLogReport(report);

    try {
      const session = await siteAuth.getSessionUser(req);
      await recordAccountGeneratedLink(session?.user?.id, "combat_log_report", saved.id);
    } catch (linkErr) {
      console.warn("[COMBAT_LOGS]: saved report but failed to link account", linkErr.message);
    }

    res.json({ ok: true, id: saved.id, url: `/combat-logs/${saved.id}`, report: saved });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("[COMBAT_LOGS]: POST /reports failed", err);
    res.status(status).json({
      ok: false,
      error: err.error || err.message || "server_error",
      message: status >= 500 ? "Failed to save combat log report." : err.message,
    });
  }
});

router.get("/reports/:id", async (req, res) => {
  try {
    const id = cleanText(req.params.id, 80);
    const report = await getCombatLogReport(id);
    if (!report) return res.status(404).json({ ok: false, error: "not_found" });
    res.set("Cache-Control", "public, max-age=60");
    res.json({ ok: true, report });
  } catch (err) {
    console.error("[COMBAT_LOGS]: GET /reports/:id failed", err);
    res.status(500).json({ ok: false, error: "server_error", message: "Failed to load combat log report." });
  }
});

module.exports = router;
module.exports._test = {
  normalizeReportBody,
  normalizeSummary,
  normalizeData,
};
