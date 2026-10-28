/*
 * Express router for market Quote API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/marketDb');

const MAX_TYPE_IDS = 500;
const DEFAULT_ORDERS_LIMIT = 25;
const MAX_ORDERS_LIMIT = 100;

function parseTypeIds(req) {
  const single = String(req.query.type_id || '').trim();
  const list = String(req.query.type_ids || '').trim();

  let ids = [];
  if (single) ids = [parseInt(single, 10)];
  else if (list) {
    ids = list
      .split(',')
      .map((v) => parseInt(v.trim(), 10))
      .filter(Boolean);
  }

  ids = [...new Set(ids)].filter((n) => Number.isFinite(n) && n > 0);

  if (!ids.length) return { error: 'type_id or type_ids required' };
  if (ids.length > MAX_TYPE_IDS) return { error: `too_many_type_ids (max ${MAX_TYPE_IDS})` };

  return { ids };
}

function parseScope(req) {
  const stationId = req.query.station_id ? Number(req.query.station_id) : null;
  const regionId = req.query.region_id ? Number(req.query.region_id) : null;

  if (stationId && Number.isFinite(stationId) && stationId > 0) {
    return { scope: { station_id: stationId }, clause: 'AND mo.location_id = $2', params: [stationId] };
  }
  if (regionId && Number.isFinite(regionId) && regionId > 0) {
    return { scope: { region_id: regionId }, clause: 'AND mo.region_id = $2', params: [regionId] };
  }
  return { error: 'station_id or region_id required' };
}

router.get('/quote', async (req, res) => {
  try {
    const { ids, error: typeErr } = parseTypeIds(req);
    if (typeErr) return res.status(400).json({ error: typeErr });

    const includeAggregates = req.query.include_aggregates === 'true';
    const includeOrders = req.query.include_orders === 'true';

    const { scope, clause, params: scopeParams, error: scopeErr } = parseScope(req);
    if (scopeErr) return res.status(400).json({ error: scopeErr });

    const bestSql = `
      WITH scoped AS (
        SELECT
          mo.type_id,
          mo.is_buy_order,
          mo.price,
          mo.volume_remain
        FROM market_orders_current mo
        WHERE mo.type_id = ANY($1)
        ${clause}
      )
      SELECT
        type_id,
        MIN(price) FILTER (WHERE NOT is_buy_order) AS sell_best,
        MAX(price) FILTER (WHERE is_buy_order)     AS buy_best,
        COUNT(*)   FILTER (WHERE NOT is_buy_order) AS sell_order_count,
        COUNT(*)   FILTER (WHERE is_buy_order)     AS buy_order_count,
        SUM(volume_remain) FILTER (WHERE NOT is_buy_order) AS sell_volume_remain,
        SUM(volume_remain) FILTER (WHERE is_buy_order)     AS buy_volume_remain
      FROM scoped
      GROUP BY type_id
      ORDER BY type_id;
    `;

    const bestParams = [ids, ...scopeParams];
    const { rows: bestRows } = await db.query(bestSql, bestParams);

    const byType = new Map();
    for (const r of bestRows) {
      byType.set(Number(r.type_id), {
        type_id: Number(r.type_id),
        buy: {
          best: r.buy_best != null ? Number(r.buy_best) : null,
          p05: null,
          order_count: Number(r.buy_order_count || 0),
          volume_remain: Number(r.buy_volume_remain || 0),
        },
        sell: {
          best: r.sell_best != null ? Number(r.sell_best) : null,
          p05: null,
          order_count: Number(r.sell_order_count || 0),
          volume_remain: Number(r.sell_volume_remain || 0),
        },
      });
    }

    if (includeAggregates) {
      const aggSql = `
        WITH scoped AS (
          SELECT
            mo.type_id,
            mo.is_buy_order,
            mo.price,
            mo.volume_remain,
            mo.order_id
          FROM market_orders_current mo
          WHERE mo.type_id = ANY($1)
          ${clause}
        ),
        totals AS (
          SELECT
            type_id,
            is_buy_order,
            SUM(volume_remain)::numeric AS total_vol
          FROM scoped
          GROUP BY 1,2
        ),
        ranked AS (
          SELECT
            s.*,
            t.total_vol,
            SUM(s.volume_remain::numeric) OVER (
              PARTITION BY s.type_id, s.is_buy_order
              ORDER BY
                (CASE WHEN s.is_buy_order THEN -s.price ELSE s.price END) ASC,
                s.order_id ASC
            ) AS cum_vol
          FROM scoped s
          JOIN totals t USING (type_id, is_buy_order)
          WHERE t.total_vol > 0
        ),
        cut AS (
          SELECT
            type_id,
            is_buy_order,
            price,
            GREATEST(
              0::numeric,
              LEAST(
                volume_remain::numeric,
                (0.05 * total_vol) - (cum_vol - volume_remain::numeric)
              )
            ) AS take_vol
          FROM ranked
          WHERE (cum_vol - volume_remain::numeric) < (0.05 * total_vol)
        )
        SELECT
          type_id,
          SUM(price * take_vol) FILTER (WHERE NOT is_buy_order)
            / NULLIF(SUM(take_vol) FILTER (WHERE NOT is_buy_order), 0) AS sell_p05,
          SUM(price * take_vol) FILTER (WHERE is_buy_order)
            / NULLIF(SUM(take_vol) FILTER (WHERE is_buy_order), 0)     AS buy_p05
        FROM cut
        GROUP BY type_id
        ORDER BY type_id;
      `;

      const { rows: aggRows } = await db.query(aggSql, bestParams);
      for (const r of aggRows) {
        const t = byType.get(Number(r.type_id));
        if (!t) continue;
        t.sell.p05 = r.sell_p05 != null ? Number(r.sell_p05) : null;
        t.buy.p05 = r.buy_p05 != null ? Number(r.buy_p05) : null;
      }
    }

    let orders = null;
    if (includeOrders) {
      if (ids.length !== 1) {
        return res.status(400).json({ error: 'include_orders only supported with single type_id for now' });
      }

      const limit = Math.min(
        Math.max(parseInt(String(req.query.orders_limit || DEFAULT_ORDERS_LIMIT), 10) || DEFAULT_ORDERS_LIMIT, 1),
        MAX_ORDERS_LIMIT
      );

      const typeId = ids[0];

      const ordersSql = `
        SELECT
          mo.order_id,
          mo.type_id,
          mo.region_id,
          mo.system_id,
          mo.location_id,
          mo.is_buy_order,
          mo.price,
          mo.volume_remain,
          mo.issued,
          mo.duration
        FROM market_orders_current mo
        WHERE mo.type_id = $1
        ${clause.replace('$2', '$2')}
      `;

      const { rows } = await db.query(ordersSql, [typeId, ...scopeParams]);

      const now = Date.now();
      const mapOrder = (row) => {
        const issued = new Date(row.issued);
        const expiry = new Date(issued.getTime() + Number(row.duration) * 24 * 60 * 60 * 1000);
        const hoursLeft = (expiry.getTime() - now) / 3600000;

        return {
          order_id: row.order_id,
          price: Number(row.price),
          volume_remain: Number(row.volume_remain),
          region_id: Number(row.region_id),
          system_id: Number(row.system_id),
          location_id: Number(row.location_id),
          expires_in: hoursLeft,
          last_updated: row.issued,
        };
      };

      const sellers = rows
        .filter((r) => !r.is_buy_order)
        .map(mapOrder)
        .sort((a, b) => a.price - b.price)
        .slice(0, limit);

      const buyers = rows
        .filter((r) => r.is_buy_order)
        .map(mapOrder)
        .sort((a, b) => b.price - a.price)
        .slice(0, limit);

      orders = { type_id: typeId, sellers, buyers };
    }

    return res.json({
      scope,
      aggregate_pct: includeAggregates ? 0.05 : null,
      types: ids.map((id) => byType.get(id) || {
        type_id: id,
        buy: { best: null, p05: null, order_count: 0, volume_remain: 0 },
        sell:{ best: null, p05: null, order_count: 0, volume_remain: 0 },
      }),
      orders,
    });
  } catch (err) {
    console.error('[market/quote] error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
