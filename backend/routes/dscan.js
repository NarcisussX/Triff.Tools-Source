/*
 * Shareable D-scan reports.
 * Provides dscan.info-style paste reports plus Triff.Tools wormhole mass analysis.
 */

const crypto = require("crypto");
const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const {
  analyzePaste,
  WORMHOLE_BANDS,
  WORMHOLE_TYPES,
  DEFAULT_COMPARISONS,
} = require("../lib/dscanAnalyzer");

let schemaReady = false;
let schemaPromise = null;

function reportId() {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = crypto.randomBytes(9);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

async function ensureSchema() {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS dscan_reports (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now(),
        scan_type text NOT NULL,
        input_raw text NOT NULL,
        report jsonb NOT NULL,
        version integer NOT NULL DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS dscan_reports_created_idx
        ON dscan_reports(created_at DESC);
    `).then(() => {
      schemaReady = true;
    }).catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

function cleanCodes(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  return Array.from(
    new Set(
      raw
        .map((code) => String(code || "").trim().toUpperCase())
        .filter((code) => /^[A-Z]\d{3}$/.test(code))
    )
  ).slice(0, 20);
}

function publicReport(row) {
  const report = row.report || {};
  return {
    ok: true,
    id: row.id,
    createdAt: row.created_at,
    scanType: row.scan_type,
    report: {
      ...report,
      id: row.id,
      createdAt: report.createdAt || row.created_at,
    },
  };
}

router.get("/wormholes", (_req, res) => {
  res.json({
    ok: true,
    bands: WORMHOLE_BANDS,
    types: WORMHOLE_TYPES,
    defaultComparisons: DEFAULT_COMPARISONS,
  });
});

router.post("/reports", async (req, res) => {
  try {
    const paste = String(req.body?.paste || req.body?.input || "");
    if (!paste.trim()) {
      return res.status(400).json({ ok: false, error: "paste_required" });
    }
    if (paste.length > 2_000_000) {
      return res.status(413).json({ ok: false, error: "paste_too_large" });
    }

    await ensureSchema();

    const wormholeCodes = cleanCodes(req.body?.wormholeCodes);
    const analyzed = await analyzePaste(pool, paste, {
      wormholeCodes,
    });
    const id = reportId();

    await pool.query(
      `
      INSERT INTO dscan_reports (id, scan_type, input_raw, report)
      VALUES ($1, $2, $3, $4::jsonb)
      `,
      [id, "dscan", paste, JSON.stringify(analyzed)]
    );

    return res.json({
      ok: true,
      id,
      path: `/dscan/${id}`,
      report: {
        ...analyzed,
        id,
      },
    });
  } catch (err) {
    if (err?.code === "DSCAN_REQUIRED" || err?.message === "dscan_required") {
      return res.status(400).json({ ok: false, error: "dscan_required" });
    }
    console.error("[dscan/reports] create error", err);
    return res.status(500).json({ ok: false, error: "dscan_report_failed" });
  }
});

router.get("/reports/:id", async (req, res) => {
  try {
    await ensureSchema();
    const id = String(req.params.id || "").trim();
    if (!/^[0-9A-Za-z]{6,24}$/.test(id)) {
      return res.status(400).json({ ok: false, error: "invalid_report_id" });
    }

    const { rows } = await pool.query(
      `
      SELECT id, created_at, scan_type, report
      FROM dscan_reports
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (!rows.length) return res.status(404).json({ ok: false, error: "not_found" });
    if (rows[0].scan_type !== "dscan" && rows[0].report?.scanType !== "dscan") {
      return res.status(410).json({ ok: false, error: "dscan_only" });
    }
    return res.json(publicReport(rows[0]));
  } catch (err) {
    console.error("[dscan/reports] read error", err);
    return res.status(500).json({ ok: false, error: "dscan_report_read_failed" });
  }
});

module.exports = router;
