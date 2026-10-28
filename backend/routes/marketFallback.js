/*
 * Express router for market Fallback API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require("express");
const router = express.Router();

async function getFetch() {
  if (typeof global.fetch === "function") return global.fetch;
  try {
    const m = await import("node-fetch");
    return m.default || m;
  } catch {

    const m2 = require("node-fetch");
    return m2.default || m2;
  }
}

router.get("/prices/fallback", async (req, res) => {
  try {
    const { region_id, type_ids } = req.query || {};
    const rid = Number(region_id);
    if (!rid || !type_ids) return res.status(400).json({ error: "region_id and type_ids required" });

    const ids = String(type_ids).split(",").map(s => Number(s.trim())).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: "type_ids required" });

    const fetch = await getFetch();

    const url = `https://market.fuzzwork.co.uk/aggregates/?region=${rid}&types=${ids.join(",")}`;
    const r = await fetch(url, { headers: { "User-Agent": "Triffnix/Fallback" } });
    if (!r.ok) return res.status(502).json({ error: "fuzzworks_bad_gateway" });
    const j = await r.json();

    const rows = ids.map(id => {
      const o = j[String(id)] || {};
      const sell = o.sell || {};
      const buy  = o.buy  || {};
      return {
        type_id: id,
        sell_median: typeof sell.median === "number" ? sell.median : null,
        buy_median:  typeof buy.median  === "number" ? buy.median  : null,
        sell_min:    typeof sell.min    === "number" ? sell.min    : null,
        buy_max:     typeof buy.max     === "number" ? buy.max     : null,
      };
    });

    res.json({ rows });
  } catch (e) {
    console.error("[PRICES_FALLBACK]: GET /prices/fallback failed", e);
    res.status(500).json({ error: "server_error" });
  }
});

module.exports = router;
