/*
 * Express router for battle Reports API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const cookieParser = require("cookie-parser");
const siteAuth = require("../services/siteAuth");
const { recordAccountGeneratedLink } = require("../services/accountLinks");

const {
  ensureBattleReportSchema,
  saveBattleReport,
  getBattleReport,
  getBattleReportKillmails,
  getLiveReportStatus,
  listRecentBattleReports,
  patchBattleReportSides,
} = require("../services/battleReports/db");
const {
  analyzeBattleReport,
  rebuildExistingReport,
} = require("../services/battleReports/analyzer");
const { eventPayload, publish, subscribe } = require("../services/battleReports/liveEvents");

const analyzeJobs = new Map();
const MAX_ANALYZE_JOBS = Number(process.env.BR_MAX_ANALYZE_JOBS || 100);
const ANALYZE_JOB_TTL_MS = Number(process.env.BR_ANALYZE_JOB_TTL_MS || 6 * 60 * 60 * 1000);

router.use(cookieParser());

function reportPayload(report) {
  return {
    id: report.id,
    title: report.title,
    created_at: report.created_at,
    updated_at: report.updated_at,
    system_id: report.system_id,
    system_name: report.system_name,
    start_time: report.start_time,
    end_time: report.end_time,
    value_mode: report.value_mode,
    source_mode: report.source_mode,
    summary: report.summary || {},
    sides: report.sides || [],
    entities: report.entities || [],
    side_overrides: report.side_overrides || {},
    side_names: report.side_names || {},
    data: report.data || {},
    revision: Number(report.revision || 1),
    live: {
      status: report.live_status || "final",
      source: "zkill-r2z2",
      acceptsUntil: report.live_until || null,
      lastUpdateAt: report.live_last_update_at || report.updated_at || null,
    },
  };
}

function compactJob(job) {
  return {
    job_id: job.id,
    status: job.status,
    message: job.message,
    report_id: job.report_id || null,
    error: job.error || null,
    created_at: job.created_at,
    updated_at: job.updated_at,
    progress_seq: job.progress_seq || 0,
    started_at: job.started_at || null,
  };
}

function noStore(res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("Surrogate-Control", "no-store");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtIskShort(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(n >= 10_000_000_000_000 ? 1 : 2)}T`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 1 : 2)}b`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function fmtDurationShort(minutes) {
  const n = Math.max(0, Number(minutes || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function fmtEveRange(start, end) {
  if (!start && !end) return "EVE time unavailable";
  const s = start ? new Date(start).toISOString().replace("T", " ").slice(0, 16) : "?";
  const e = end ? new Date(end).toISOString().replace("T", " ").slice(0, 16) : "?";
  const sameDate = s.slice(0, 10) === e.slice(0, 10);
  if (sameDate) return `${s.slice(0, 10)} ${s.slice(11)}–${e.slice(11)} ET`;
  return `${s}–${e} ET`;
}

function publicBaseUrl(req) {
  const configured = process.env.PUBLIC_BASE_URL || process.env.SITE_URL || process.env.TRIFTOOLS_PUBLIC_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host") || "www.triff.tools";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function topGroupNames(side, limit = 2) {
  return [...(side?.entities || [])]
    .filter((e) => e.kind === "alliance" || e.kind === "corporation")
    .sort((a, b) => {
      const bp = Number(b.pilot_count || 0);
      const ap = Number(a.pilot_count || 0);
      if (bp !== ap) return bp - ap;
      return Number(b.isk_lost || 0) - Number(a.isk_lost || 0);
    })
    .slice(0, limit)
    .map((e) => e.name)
    .filter(Boolean);
}

function describeTopGroups(report) {
  const sides = [...(report.sides || [])]
    .filter((s) => Number(s.pilotCount || 0) > 0 || Number(s.shipsLost || 0) > 0)
    .slice(0, 2);

  const parts = sides.map((side) => {
    const names = topGroupNames(side, 2);
    if (!names.length) return null;
    return `${side.name || "Team"}: ${names.join(", ")}`;
  }).filter(Boolean);

  return parts.length ? parts.join(" • ") : "Battle report generated by Triff.Tools.";
}

function shouldRenderEmbedHtml(req) {
  const base = String(req.baseUrl || "").replace(/\/+$/, "");
  if (base === "/br") return true;
  return String(req.originalUrl || "").startsWith("/br/");
}

function renderBattleReportEmbedHtml(req, report) {
  const baseUrl = publicBaseUrl(req);
  const reportUrl = `${baseUrl}/br/${encodeURIComponent(report.id)}`;
  const system = report.system_name || report.system_id || "Battle Report";
  const title = `${system} Battle Report`;
  const summary = report.summary || {};
  const killCount = Number(summary.shipsLost || summary.totalKills || 0);
  const pilots = Number(summary.totalParticipants || summary.totalPilots || 0);
  const iskLost = fmtIskShort(summary.totalIskDestroyed || 0);
  const duration = fmtDurationShort(summary.durationMinutes || 0);
  const eveRange = fmtEveRange(report.start_time, report.end_time);
  const groups = describeTopGroups(report);
  const description = `${eveRange} • ${duration} • ${pilots.toLocaleString()} pilots • ${killCount.toLocaleString()} killmails • ${iskLost} ISK lost. ${groups}`;
  const configuredImage = process.env.BR_EMBED_IMAGE_URL || process.env.OG_IMAGE_URL || "";
  const imageMeta = configuredImage ? `\n    <meta property="og:image" content="${escapeHtml(configuredImage)}" />\n    <meta name="twitter:image" content="${escapeHtml(configuredImage)}" />` : "";
  const spaPath = `/br/${encodeURIComponent(report.id)}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} | Triff.Tools</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="theme-color" content="#2d8cff" />
    <meta property="og:site_name" content="Triff.Tools" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(reportUrl)}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />${imageMeta}
  </head>
  <body style="margin:0;background:#02050a;color:#dcecff;font-family:system-ui,Segoe UI,sans-serif;">
    <div style="max-width:720px;margin:48px auto;padding:18px;border:1px solid #1b3047;background:#060a11;">
      <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#8fb7dd;">Triff.Tools Battle Report</div>
      <h1 style="margin:10px 0 8px;font-size:24px;color:#70b7ff;">${escapeHtml(title)}</h1>
      <p style="margin:0 0 12px;color:#dcecff;line-height:1.45;">${escapeHtml(description)}</p>
      <a href="${escapeHtml(spaPath)}" style="color:#9fc8ff;">Open battle report</a>
    </div>
    <script>
      (function () {
        var ua = navigator.userAgent || "";
        var isBot = /Discordbot|Twitterbot|Slackbot|facebookexternalhit|LinkedInBot|TelegramBot|WhatsApp|redditbot|Applebot|Googlebot|bingbot/i.test(ua);
        if (isBot) return;
        fetch("/", { cache: "no-store" })
          .then(function (r) { return r.text(); })
          .then(function (html) {
            history.replaceState(null, "", ${JSON.stringify(spaPath)});
            document.open();
            document.write(html);
            document.close();
          })
          .catch(function () {
            window.location.href = "/";
          });
      })();
    </script>
  </body>
</html>`;
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function cleanupAnalyzeJobs() {
  const now = Date.now();
  for (const [id, job] of analyzeJobs.entries()) {
    if (now - job.updated_ms > ANALYZE_JOB_TTL_MS) analyzeJobs.delete(id);
  }

  if (analyzeJobs.size <= MAX_ANALYZE_JOBS) return;
  const removable = [...analyzeJobs.values()]
    .filter((job) => job.status === "complete" || job.status === "error")
    .sort((a, b) => a.updated_ms - b.updated_ms);
  for (const job of removable) {
    if (analyzeJobs.size <= MAX_ANALYZE_JOBS) break;
    analyzeJobs.delete(job.id);
  }
}

async function linkBattleReportToAccount(userId, reportId) {
  try {
    await recordAccountGeneratedLink(userId, "battle_report", reportId);
  } catch (err) {
    console.warn("[br/account-link]", err.message);
  }
}

function startAnalyzeJob(body, userId = null) {
  cleanupAnalyzeJobs();

  const id = `brjob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const job = {
    id,
    status: "queued",
    message: "Queued battle report analysis...",
    report_id: null,
    error: null,
    created_at: now,
    updated_at: now,
    updated_ms: Date.now(),
    started_at: null,
    progress_seq: 0,
  };
  analyzeJobs.set(id, job);

  const touch = (status, message) => {
    job.status = status;
    job.message = message;
    job.updated_at = new Date().toISOString();
    job.updated_ms = Date.now();
    job.progress_seq = (job.progress_seq || 0) + 1;
    if (!job.started_at && status === "running") job.started_at = job.updated_at;
    console.log(`[br/analyze-job ${id}] ${status}: ${message}`);
  };

  setImmediate(async () => {
    try {
      touch("running", "Starting battle report analysis...");
      await yieldToEventLoop();
      touch("running", "Resolving system and validating EVE-time window...");
      await yieldToEventLoop();
      const report = await analyzeBattleReport(body, {
        onProgress: (message) => touch("running", message),
      });
      touch("running", "Saving battle report to Postgres...");
      await saveBattleReport(report);
      await linkBattleReportToAccount(userId, report.id);
      job.report_id = report.id;
      touch("complete", "Battle report ready.");
    } catch (err) {
      console.error(`[br/analyze-job ${id}]`, err);
      job.error = err.message || "Failed to analyze battle report";
      touch("error", "Battle report analysis failed.");
    }
  });

  return job;
}

router.use(async (_req, _res, next) => {
  try {
    await ensureBattleReportSchema();
    next();
  } catch (err) {
    next(err);
  }
});

router.get("/ingest/status", async (_req, res) => {
  noStore(res);
  try {
    const { rows } = await pool.query(
      `
      SELECT source, cursor_value, updated_at
      FROM br_ingest_state
      ORDER BY source
      `
    );
    res.json({ states: rows, r2z2: rows.find((row) => row.source === "default" || row.source === "r2z2") || null });
  } catch (err) {
    console.error("[br/ingest-status]", err);
    res.status(500).json({ error: err.message || "Failed to load BR ingest status" });
  }
});

router.get("/systems/search", async (req, res) => {
  noStore(res);
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json([]);

    const like = `%${q}%`;
    const prefix = `${q}%`;
    const { rows } = await pool.query(
      `
      SELECT
        "solarSystemID" AS id,
        "solarSystemName" AS name
      FROM evesde."mapSolarSystems"
      WHERE
        lower("solarSystemName") LIKE lower($1)
        OR CAST("solarSystemID" AS TEXT) LIKE $1
      ORDER BY
        CASE
          WHEN lower("solarSystemName") = lower($2) THEN 0
          WHEN lower("solarSystemName") LIKE lower($3) THEN 1
          ELSE 2
        END,
        "solarSystemName" ASC
      LIMIT 12
      `,
      [like, q, prefix]
    );

    res.json(rows.map((row) => ({ id: Number(row.id), name: row.name })));
  } catch (err) {
    console.error("[br/systems-search]", err);
    res.status(500).json({ error: err.message || "Failed to search systems" });
  }
});

router.get("/recent", async (req, res) => {
  noStore(res);
  try {
    const rows = await listRecentBattleReports(req.query.limit || 25);
    res.json(rows.map((row) => ({
      id: row.id,
      title: row.title,
      created_at: row.created_at,
      updated_at: row.updated_at,
      system_id: row.system_id,
      system_name: row.system_name,
      start_time: row.start_time,
      end_time: row.end_time,
      summary: row.summary || {},
    })));
  } catch (err) {
    console.error("[br/recent]", err);
    res.status(500).json({ error: err.message || "Failed to load recent battle reports" });
  }
});

router.get("/jobs/:jobId", async (req, res) => {
  noStore(res);
  try {
    cleanupAnalyzeJobs();
    const job = analyzeJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Battle report analysis job not found. It may have expired or the backend restarted." });
    res.json(compactJob(job));
  } catch (err) {
    console.error("[br/job-get]", err);
    res.status(500).json({ error: err.message || "Failed to load battle report job" });
  }
});

router.get("/:id/live", async (req, res) => {
  noStore(res);
  try {
    const report = await getLiveReportStatus(req.params.id);
    if (!report) return res.status(404).json({ error: "Battle report not found" });
    res.json(eventPayload(report));
  } catch (err) {
    console.error("[br/live-status]", err);
    res.status(500).json({ error: err.message || "Failed to load battle report live status" });
  }
});

router.get("/:id/events", async (req, res) => {
  try {
    const report = await getLiveReportStatus(req.params.id);
    if (!report) return res.status(404).json({ error: "Battle report not found" });

    res.status(200);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    res.write("retry: 5000\n\n");

    const send = ({ type, data }) => {
      if (res.writableEnded) return;
      if (data.revision) res.write(`id: ${data.revision}\n`);
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    send({ type: "ready", data: eventPayload(report) });

    const unsubscribe = subscribe(req.params.id, send);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(`: heartbeat ${Date.now()}\n\n`);
    }, Math.max(10, Number(process.env.BR_SSE_HEARTBEAT_MS || 20000)));
    heartbeat.unref?.();

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on("close", cleanup);
    res.on("close", cleanup);
  } catch (err) {
    console.error("[br/events]", err);
    if (!res.headersSent) res.status(500).json({ error: err.message || "Failed to open battle report event stream" });
    else res.end();
  }
});

router.get("/:id", async (req, res) => {
  noStore(res);
  try {
    const report = await getBattleReport(req.params.id);
    if (!report) {
      if (shouldRenderEmbedHtml(req)) return res.status(404).type("html").send("<!doctype html><title>Battle report not found</title><body>Battle report not found.</body>");
      return res.status(404).json({ error: "Battle report not found" });
    }

    if (shouldRenderEmbedHtml(req)) {
      return res.type("html").send(renderBattleReportEmbedHtml(req, report));
    }

    res.json(reportPayload(report));
  } catch (err) {
    console.error("[br/get]", err);
    if (shouldRenderEmbedHtml(req)) return res.status(500).type("html").send("<!doctype html><title>Battle report error</title><body>Failed to load battle report.</body>");
    res.status(500).json({ error: err.message || "Failed to load battle report" });
  }
});

router.post("/analyze", async (req, res) => {
  noStore(res);
  try {
    const body = req.body || {};
    let userId = null;
    try {
      const session = await siteAuth.getSessionUser(req);
      userId = session?.user?.id || null;
    } catch (authErr) {
      console.warn("[br/analyze] optional account lookup failed", authErr.message);
    }
    const scopedRows = Array.isArray(body.scopes)
      ? body.scopes
      : Array.isArray(body.windows)
        ? body.windows
        : Array.isArray(body.systemWindows)
          ? body.systemWindows
          : [];
    const hasScopedSystem = scopedRows.some((row) => row?.systemQuery || row?.system || row?.systemName || row?.systemId);
    const hasSystem = body.systemId || body.systemName || body.systemQuery;

    if (!body.zkillUrls && !body.zkillText && !hasSystem && !hasScopedSystem) {
      return res.status(400).json({ error: "Provide at least one system + time window, or one or more zKill URLs." });
    }

    if (hasSystem && (!body.startTime || !body.endTime)) {
      return res.status(400).json({ error: "System reports require startTime and endTime in UTC/EVE time." });
    }

    if (scopedRows.length) {
      const badScope = scopedRows.find((row) => {
        const rowSystem = row?.systemQuery || row?.system || row?.systemName || row?.systemId;
        const rowStart = row?.startTime || row?.start || row?.start_time;
        const rowEnd = row?.endTime || row?.end || row?.end_time;
        return !rowSystem || !rowStart || !rowEnd;
      });
      if (badScope) {
        return res.status(400).json({ error: "Each system row requires a system, start time, and end time." });
      }
    }

    if (body.async === true || body.background === true) {
      const job = startAnalyzeJob(body, userId);
      return res.status(202).json(compactJob(job));
    }

    const report = await analyzeBattleReport(body);
    const saved = await saveBattleReport(report);
    await linkBattleReportToAccount(userId, report.id);
    res.json(reportPayload(saved || report));
  } catch (err) {
    console.error("[br/analyze]", err);
    res.status(err.statusCode || 500).json({ error: err.message || "Failed to analyze battle report" });
  }
});

router.patch("/:id/sides", async (req, res) => {
  try {
    let updated = null;
    for (let attempt = 0; attempt < 3 && !updated; attempt += 1) {
      const report = await getBattleReport(req.params.id);
      if (!report) return res.status(404).json({ error: "Battle report not found" });

      const killRows = await getBattleReportKillmails(req.params.id);
      const sideOverrides = req.body?.side_overrides || req.body?.overrides || report.side_overrides || {};
      const sideNames = req.body?.side_names || report.side_names || {};
      const rebuilt = await rebuildExistingReport(report, killRows, sideOverrides, sideNames);
      updated = await patchBattleReportSides(req.params.id, {
        side_overrides: rebuilt.side_overrides,
        side_names: rebuilt.side_names,
        summary: rebuilt.summary,
        sides: rebuilt.sides,
        entities: rebuilt.entities,
        data: rebuilt.data,
        expected_revision: report.revision,
      });
    }

    if (!updated) return res.status(409).json({ error: "The report changed while saving. Please save once more." });
    publish(req.params.id, "report-updated", updated);
    res.json(reportPayload(updated));
  } catch (err) {
    console.error("[br/patch-sides]", err);
    res.status(500).json({ error: err.message || "Failed to update sides" });
  }
});

module.exports = router;
