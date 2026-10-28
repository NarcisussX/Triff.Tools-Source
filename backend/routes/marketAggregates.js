/*
 * Express router for market Aggregates API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require("express");
const router = express.Router();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

router.get("/prices/region", async (req, res) => {
  const region_id = parseInt(req.query.region_id || "10000002", 10);
  const type_ids = (req.query.type_ids || "")
    .split(",")
    .map(s => parseInt(s,10))
    .filter(Boolean);

  if (!type_ids.length) return res.status(400).json({ error: "type_ids required" });

  const { rows } = await pool.query(
    `select type_id, sell_min, buy_max, sell_5pct, buy_5pct, last_updated
     from market_region_aggregates
     where region_id=$1 and type_id = any($2)`,
    [region_id, type_ids]
  );
  res.json({ region_id, rows });
});

module.exports = router;
