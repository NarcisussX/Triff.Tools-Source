/*
 * Express router for market History API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/marketDb');

router.get('/history', async (req, res) => {
  try {
    const typeId = parseInt(String(req.query.type_id || ''), 10);
    if (!typeId) {
      return res.status(400).json({ error: 'type_id required' });
    }

    const regionId = req.query.region_id
      ? parseInt(String(req.query.region_id), 10)
      : null;

    const existsResult = await db.query(
      `SELECT to_regclass('market_history_daily') AS tbl`
    );
    if (!existsResult.rows[0].tbl) {
      return res.json([]);
    }

    const params = [typeId];
    let regionClause = '';

    if (regionId) {
      params.push(regionId);
      regionClause = 'AND region_id = $2';
    }

    const query = `
      SELECT
        date,
        low_price,
        high_price,
        avg_price,
        volume,
        orders,
        region_id,
        type_id
      FROM market_history_daily
      WHERE type_id = $1
        ${regionClause}
        AND date >= current_date - INTERVAL '365 days'
      ORDER BY date
    `;

    const { rows } = await db.query(query, params);

    return res.json(rows);
  } catch (err) {
    console.error('[market/history] error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});
const TRADE_HUB_REGION_IDS = [
  10000002,
  10000043,
  10000032,
  10000030,
  10000042,
];
router.get('/history/regions', async (req, res) => {
  try {
    const typeId = parseInt(String(req.query.type_id || ''), 10);
    if (!typeId) {
      return res.status(400).json({ error: 'type_id required' });
    }

    const existsResult = await db.query(
      `SELECT to_regclass('market_history_daily') AS tbl`
    );
    if (!existsResult.rows[0].tbl) {
      return res.json([]);
    }

    const { rows } = await db.query(
      `
      SELECT
        m.region_id,
        COALESCE(r."regionName", 'Region ' || m.region_id::text) AS region_name
      FROM market_history_daily m
      LEFT JOIN evesde."mapRegions" r ON r."regionID" = m.region_id
      WHERE m.type_id = $1
      GROUP BY m.region_id, r."regionName"
      ORDER BY
        CASE WHEN m.region_id = ANY($2) THEN 0 ELSE 1 END,
        region_name
      `,
      [typeId, TRADE_HUB_REGION_IDS]
    );

    return res.json(rows);
  } catch (err) {
    console.error('[market/history/regions] error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/history/batch', async (req, res) => {
  try {
    const raw = req.query.type_ids;
    let typeIds = [];

    if (Array.isArray(raw)) {
      typeIds = raw;
    } else if (typeof raw === 'string') {
      typeIds = raw.split(',');
    }

    typeIds = typeIds
      .map((v) => parseInt(String(v).trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (!typeIds.length) {
      return res.status(400).json({ error: 'type_ids required' });
    }

    typeIds = Array.from(new Set(typeIds));

    const MAX_TYPE_IDS = 50;
    if (typeIds.length > MAX_TYPE_IDS) {
      return res.status(400).json({
        error: 'too_many_type_ids',
        max: MAX_TYPE_IDS,
        provided: typeIds.length,
      });
    }

    const regionId = req.query.region_id
      ? parseInt(String(req.query.region_id), 10)
      : null;

    const existsResult = await db.query(
      `SELECT to_regclass('market_history_daily') AS tbl`
    );
    if (!existsResult.rows[0].tbl) {
      return res.json({
        region_id: regionId,
        days: 365,
        data: {},
      });
    }

    const params = [typeIds];
    let regionClause = '';

    if (regionId) {
      params.push(regionId);
      regionClause = 'AND region_id = $2';
    }

    const query = `
      SELECT
        date,
        low_price,
        high_price,
        avg_price,
        volume,
        orders,
        region_id,
        type_id
      FROM market_history_daily
      WHERE type_id = ANY($1::int[])
        ${regionClause}
        AND date >= current_date - INTERVAL '365 days'
      ORDER BY type_id, date
    `;

    const { rows } = await db.query(query, params);

    const grouped = {};
    for (const r of rows) {
      const key = String(r.type_id);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(r);
    }

    return res.json({
      region_id: regionId,
      days: 365,
      data: grouped,
    });
  } catch (err) {
    console.error('[market/history/batch] error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
