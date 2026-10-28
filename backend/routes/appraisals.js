/*
 * Express router for appraisals API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { customAlphabet } = require("nanoid");
const cookieParser = require("cookie-parser");
const siteAuth = require("../services/siteAuth");
const { recordAccountGeneratedLink } = require("../services/accountLinks");

const nanoid = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  6
);

router.use(cookieParser());

function parseJSONIfString(x) {
  let v = x;
  for (let i = 0; i < 3; i++) {
    if (typeof v === "string") {
      try { v = JSON.parse(v); continue; } catch {   }
    }
    break;
  }
  return v;
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeRows(rowsIn) {
  let arr = parseJSONIfString(rowsIn);
  if (!Array.isArray(arr)) arr = [];

  arr = arr.map((row) => parseJSONIfString(row));

  return arr.map((o) => {
    o = o && typeof o === "object" ? o : {};
    return {
      type_id: o.type_id != null ? numOrNull(o.type_id) : null,
      name: o.name != null ? String(o.name) : "",
      qty: numOrNull(o.qty) ?? 0,
      m3: o.m3 != null ? numOrNull(o.m3) : null,
      price: o.price != null ? numOrNull(o.price) : null,
      lineISK: o.lineISK != null ? numOrNull(o.lineISK) : null,
      source: o.source != null ? String(o.source) : "n/a",
      status: o.status != null ? String(o.status) : undefined,
    };
  });
}

function normalizeTotals(totalsIn) {
  const t = parseJSONIfString(totalsIn) || {};
  const n = (v) =>
    v == null || v === "" ? null : (Number(v) === Number(v) ? Number(v) : null);

  const clampPct = (p) => {
    if (p == null) return null;
    const x = Number(p);
    if (!Number.isFinite(x)) return null;
    return Math.max(0, Math.min(200, x));
  };

  return {
    volume: n(t.volume) ?? 0,
    sell: n(t.sell) ?? 0,
    buy: n(t.buy) ?? 0,
    split: n(t.split) ?? 0,
    itemCount: n(t.itemCount) ?? 0,
    adjusted: n(t.adjusted),
    adjustmentPct: clampPct(t.adjustmentPct),
  };
}
function normalizeRows(rowsIn) {
  let r = parseJSONIfString(rowsIn);
  if (!Array.isArray(r)) r = [];

  r = r.map((row) => parseJSONIfString(row));

  return r.map((o) => {
    o = o && typeof o === "object" ? o : {};
    return {
      type_id: o.type_id != null ? numOrNull(o.type_id) : null,
      name: o.name != null ? String(o.name) : "",
      qty: numOrNull(o.qty) ?? 0,
      m3: o.m3 != null ? numOrNull(o.m3) : null,
      price: o.price != null ? numOrNull(o.price) : null,
      lineISK: o.lineISK != null ? numOrNull(o.lineISK) : null,
      source: o.source != null ? String(o.source) : "n/a",
      status: o.status != null ? String(o.status) : undefined,
    };
  });
}

router.post("/appraisals", async (req, res) => {
  try {
    const { station_id, mode, input_raw } = req.body || {};
    let { totals, rows } = req.body || {};

    if (!station_id || !mode || !input_raw) {
      return res
        .status(400)
        .json({ error: "station_id, mode, input_raw required" });
    }
    const sid = Number(station_id);
    if (!sid) return res.status(400).json({ error: "invalid station_id" });
    if (!["buy", "sell", "split", "buy5", "sell5"].includes(mode)) {
      return res.status(400).json({ error: "invalid mode" });
    }

    const totalsNorm = normalizeTotals(totals);
    const rowsNorm = normalizeRows(rows);
    if (!rowsNorm.length)
      return res.status(400).json({ error: "rows required (non-empty)" });

    if (!totalsNorm.itemCount) totalsNorm.itemCount = rowsNorm.length;

    if (
      totalsNorm.adjusted == null &&
      totalsNorm.adjustmentPct != null
    ) {
      const pct = totalsNorm.adjustmentPct / 100;
      const base =
        mode === "split"
          ? totalsNorm.split
          : mode.startsWith("sell")
            ? totalsNorm.sell
            : totalsNorm.buy;
      totalsNorm.adjusted = Math.round((base || 0) * pct * 100) / 100;
    }

    const id = nanoid();

    const totalsJSON = JSON.stringify(totalsNorm);
    const rowsJSON = JSON.stringify(rowsNorm);

    await pool.query(
      `INSERT INTO appraisals (id, station_id, mode, input_raw, totals, rows)
   VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [id, sid, mode, String(input_raw), totalsJSON, rowsJSON]
    );

    try {
      const session = await siteAuth.getSessionUser(req);
      await recordAccountGeneratedLink(session?.user?.id, "appraisal", id);
    } catch (linkErr) {
      console.warn("[ISKTIMATE]: saved appraisal but failed to link account", linkErr.message);
    }

    return res.json({ id, url: `/appraisals/${id}` });

  } catch (e) {
    console.error("[ISKTIMATE]: POST /appraisals failed", e);
    return res.status(500).json({ error: "server_error" });
  }
});

router.get("/appraisals/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT * FROM appraisals WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "not_found" });

    res.set("Cache-Control", "private, max-age=0, no-cache");
    return res.json(rows[0]);
  } catch (e) {
    console.error("[ISKTIMATE]: GET /appraisals/:id failed", e);
    return res.status(500).json({ error: "server_error" });
  }
});

module.exports = router;
module.exports._test = {
  parseJSONIfString,
  numOrNull,
  normalizeRows,
  normalizeTotals,
};
