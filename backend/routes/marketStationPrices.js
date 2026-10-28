/*
 * Express router for market Station Prices API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require("express");
const router = express.Router();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

router.get("/prices/station", async (req, res) => {
  const stationIds = (req.query.station_id || "").split(",").map(s=>parseInt(s,10)).filter(Boolean);
  const typeIds = (req.query.type_ids || "").split(",").map(s=>parseInt(s,10)).filter(Boolean);

  if (!stationIds.length) return res.status(400).json({ error: "station_id required" });
  if (!typeIds.length) return res.status(400).json({ error: "type_ids required" });

  const { rows } = await pool.query(
    `select station_id, type_id, sell_min, buy_max, sell_5pct, buy_5pct, last_updated
     from market_station_aggregates
     where station_id = any($1) and type_id = any($2)`,
    [stationIds, typeIds]
  );
  res.json({ rows });
});

module.exports = router;
