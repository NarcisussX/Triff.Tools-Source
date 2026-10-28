/*
 * Read-only API endpoints for the upgraded Triff.Tools market browser.
 * These routes intentionally use local market/SDE tables only.
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/marketDb');

const TOP_REGION_IDS = [10000002, 10000043, 10000042, 10000032, 10000030];
const NPC_STATION_ID_MAX = 70000000;
const PLEX_TYPE_ID = 44992;

const SORTS = {
  item: 'type_name',
  volume_m3: 'volume_m3',
  best_sell: 'best_sell',
  best_buy: 'best_buy',
  spread: 'spread',
  spread_pct: 'spread_pct',
  avg_price: 'avg_price',
  delta_price: 'delta_price',
  isk_day: 'isk_day',
  vol_day: 'vol_day',
  sell_volume: 'sell_volume',
  buy_volume: 'buy_volume',
  sell_orders: 'sell_orders',
  buy_orders: 'buy_orders',
};

const ORDER_SORTS = {
  price: 'c.price',
  volume: 'c.volume_remain',
  region: 'region_name',
  location: 'location_name',
  issued: 'c.issued',
  expires: 'expires_at',
  min: 'c.min_volume',
  range: 'c.range',
};

function parseIdList(raw, max = 100) {
  const values = Array.isArray(raw) ? raw.join(',') : String(raw || '');
  const out = values
    .split(',')
    .map((v) => parseInt(v.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return Array.from(new Set(out)).slice(0, max);
}

function parseBool(value) {
  return value === true || value === 'true' || value === '1' || value === 'yes';
}

function clampInt(value, fallback, min, max) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function addParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function directionOf(value) {
  return String(value || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
}

function regionClause(alias, params, regions) {
  if (!regions.length) return '';
  const p = addParam(params, regions);
  return `AND ${alias}.region_id = ANY(${p}::int[])`;
}

function orderRegionScope(params, regions) {
  return regionClause('mo', params, regions);
}

function historyRegionScope(params, regions, alias = 'h') {
  return regionClause(alias, params, regions);
}

function noScamWhere(noScam) {
  if (!noScam) return 'TRUE';
  return `
    (
      (NOT so.is_buy_order AND (
        med.sell_count < 5
        OR med.sell_median IS NULL
        OR med.sell_median <= 0
        OR so.price <= med.sell_median * 10
      ))
      OR
      (so.is_buy_order AND (
        med.buy_count < 5
        OR med.buy_median IS NULL
        OR med.buy_median <= 0
        OR so.price >= med.buy_median * 0.1
      ))
    )
  `;
}

function normalizeDbNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanRowNumbers(row) {
  const out = { ...row };
  for (const key of Object.keys(out)) {
    if (
      key.endsWith('_price') ||
      key.endsWith('_volume') ||
      key.endsWith('_orders') ||
      key.endsWith('_count') ||
      key.endsWith('_day') ||
      key.endsWith('_pct') ||
      key === 'price' ||
      key === 'volume_remain' ||
      key === 'volume_m3' ||
      key === 'best_sell' ||
      key === 'best_buy' ||
      key === 'spread' ||
      key === 'avg_price' ||
      key === 'delta_price' ||
      key === 'sell_median' ||
      key === 'buy_median' ||
      key === 'min_volume' ||
      key === 'range'
    ) {
      out[key] = normalizeDbNumber(out[key]);
    }
  }
  return out;
}

function extractQuickbarCandidates(text, names = []) {
  const raw = [
    ...names.map((n) => String(n || '')),
    String(text || ''),
  ].join('\n');

  const skip = new Set([
    'high power',
    'medium power',
    'low power',
    'rig slot',
    'subsystem',
    'cargo',
    'drone bay',
    'charges',
    'drones',
    'items',
    'quantity',
    'price',
    'volume',
  ]);

  const candidates = [];
  const seen = new Set();
  const push = (value) => {
    let s = String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/^[\s*>\-+]+/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!s) return;
    const fitHeader = s.match(/^\[\s*([^,\]]+)(?:,.*?)?\]\s*$/);
    if (fitHeader) s = fitHeader[1].trim();

    s = s
      .replace(/^(?:x\s*)?\d[\d,._]*\s*[xX]?\s+/, '')
      .replace(/\s+[xX]?\s*\d[\d,._]*$/, '')
      .replace(/\s+\d[\d,._]*\s*(?:isk|m3|m\^3)$/i, '')
      .replace(/^\d+\s*[xX]\s*/, '')
      .replace(/\s*\(.*?\)\s*$/, '')
      .trim();

    if (!s || s.length < 2) return;
    if (/^\d+$/.test(s)) return;
    if (skip.has(s.toLowerCase())) return;
    if (/[{}<>]/.test(s)) return;
    if (s.length > 120) return;

    const key = s.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(s);
    }
  };

  raw
    .split(/\r?\n|,|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      if (/\t/.test(line) || / {2,}/.test(line)) {
        const cols = line.split(/\t+| {2,}/).map((c) => c.trim()).filter(Boolean);
        const firstName = cols.find((c) => c && !/^\d[\d,._]*$/.test(c) && !/\bISK\b/i.test(c));
        push(firstName || line);
      } else {
        push(line);
      }
    });

  return candidates.slice(0, 250);
}

async function buildAllItemsPayload(req, forcedGroupId = null) {
  const params = [];
  const regions = parseIdList(req.query.regions, 80);
  const search = String(req.query.search || '').trim();
  const groupId =
    forcedGroupId != null
      ? forcedGroupId
      : parseInt(String(req.query.group_id || ''), 10) || null;
  const noScam = parseBool(req.query.no_scam);
  const limit = clampInt(req.query.limit, 100, 1, 250);
  const offset = clampInt(req.query.offset, 0, 0, 1000000);
  const sortKey = SORTS[String(req.query.sort || 'item')] ? String(req.query.sort || 'item') : 'item';
  const dir = directionOf(req.query.direction);

  const orderRegion = orderRegionScope(params, regions);
  const histRecentRegion = historyRegionScope(params, regions, 'h');
  const histPrevRegion = historyRegionScope(params, regions, 'h');
  const sparkRegion = historyRegionScope(params, regions, 'h');

  let groupCte = '';
  let groupJoin = '';
  if (groupId) {
    const gp = addParam(params, groupId);
    groupCte = `
      group_desc AS (
        SELECT ${gp}::int AS market_group_id
        UNION ALL
        SELECT g."marketGroupID"
        FROM evesde."invMarketGroups" g
        JOIN group_desc gd ON g."parentGroupID" = gd.market_group_id
      ),
    `;
    groupJoin = 'JOIN group_desc gd ON gd.market_group_id = t."marketGroupID"';
  }

  const searchClause = search
    ? `AND LOWER(t."typeName") LIKE LOWER(${addParam(params, `%${search}%`)})`
    : '';
  const limitParam = addParam(params, limit);
  const offsetParam = addParam(params, offset);
  const sortExpr = SORTS[sortKey];

  const sql = `
    WITH RECURSIVE
    ${groupCte}
    scoped_orders AS (
      SELECT
        mo.type_id,
        mo.is_buy_order,
        mo.price::numeric AS price,
        mo.volume_remain::numeric AS volume_remain
      FROM public.market_orders_current mo
      WHERE 1=1
      ${orderRegion}
    ),
    med AS (
      SELECT
        type_id,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY price)
          FILTER (WHERE NOT is_buy_order) AS sell_median,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY price)
          FILTER (WHERE is_buy_order) AS buy_median,
        COUNT(*) FILTER (WHERE NOT is_buy_order) AS sell_count,
        COUNT(*) FILTER (WHERE is_buy_order) AS buy_count
      FROM scoped_orders
      GROUP BY type_id
    ),
    clipped_orders AS (
      SELECT so.*
      FROM scoped_orders so
      LEFT JOIN med ON med.type_id = so.type_id
      WHERE ${noScamWhere(noScam)}
    ),
    order_stats AS (
      SELECT
        type_id,
        MIN(price) FILTER (WHERE NOT is_buy_order) AS best_sell,
        MAX(price) FILTER (WHERE is_buy_order) AS best_buy,
        COUNT(*) FILTER (WHERE NOT is_buy_order) AS sell_orders,
        COUNT(*) FILTER (WHERE is_buy_order) AS buy_orders,
        COALESCE(SUM(volume_remain) FILTER (WHERE NOT is_buy_order), 0) AS sell_volume,
        COALESCE(SUM(volume_remain) FILTER (WHERE is_buy_order), 0) AS buy_volume
      FROM clipped_orders
      GROUP BY type_id
    ),
    hist_recent AS (
      SELECT
        h.type_id,
        (SUM(h.avg_price * h.volume)::numeric / NULLIF(SUM(h.volume), 0)) AS avg_price,
        (SUM(h.volume)::numeric / NULLIF(COUNT(DISTINCT h.date), 0)) AS vol_day,
        (SUM(h.avg_price * h.volume)::numeric / 30.0) AS isk_day
      FROM public.market_history_daily h
      WHERE h.date >= current_date - INTERVAL '30 days'
      ${histRecentRegion}
      GROUP BY h.type_id
    ),
    hist_prev AS (
      SELECT
        h.type_id,
        (SUM(h.avg_price * h.volume)::numeric / NULLIF(SUM(h.volume), 0)) AS prev_avg_price
      FROM public.market_history_daily h
      WHERE h.date >= current_date - INTERVAL '60 days'
        AND h.date < current_date - INTERVAL '30 days'
      ${histPrevRegion}
      GROUP BY h.type_id
    ),
    base AS (
      SELECT
        t."typeID" AS type_id,
        t."typeName" AS type_name,
        t."marketGroupID" AS market_group_id,
        mg."marketGroupName" AS market_group_name,
        COALESCE(t."volume", 0)::numeric AS volume_m3,
        o.best_sell,
        o.best_buy,
        (o.best_buy - o.best_sell) AS spread,
        CASE WHEN o.best_sell > 0 THEN ((o.best_buy - o.best_sell) / o.best_sell) * 100 END AS spread_pct,
        hr.avg_price,
        CASE
          WHEN hp.prev_avg_price > 0 AND hr.avg_price IS NOT NULL
          THEN ((hr.avg_price - hp.prev_avg_price) / hp.prev_avg_price) * 100
        END AS delta_price,
        hr.isk_day,
        hr.vol_day,
        o.sell_volume,
        o.buy_volume,
        o.sell_orders,
        o.buy_orders
      FROM evesde."invTypes" t
      JOIN order_stats o ON o.type_id = t."typeID"
      LEFT JOIN evesde."invMarketGroups" mg ON mg."marketGroupID" = t."marketGroupID"
      LEFT JOIN hist_recent hr ON hr.type_id = t."typeID"
      LEFT JOIN hist_prev hp ON hp.type_id = t."typeID"
      ${groupJoin}
      WHERE COALESCE(t."published", TRUE) = TRUE
        AND t."marketGroupID" IS NOT NULL
        ${searchClause}
    ),
    counted AS (
      SELECT *, COUNT(*) OVER()::int AS total_count
      FROM base
    ),
    page AS (
      SELECT *
      FROM counted
      ORDER BY ${sortExpr} ${dir} NULLS LAST, type_name ASC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    ),
    spark AS (
      SELECT
        x.type_id,
        json_agg(
          json_build_object('date', x.date, 'avg_price', x.avg_price)
          ORDER BY x.date
        ) AS sparkline
      FROM (
        SELECT
          h.type_id,
          h.date,
          (SUM(h.avg_price * h.volume)::numeric / NULLIF(SUM(h.volume), 0)) AS avg_price
        FROM public.market_history_daily h
        JOIN page p ON p.type_id = h.type_id
        WHERE h.date >= current_date - INTERVAL '30 days'
        ${sparkRegion}
        GROUP BY h.type_id, h.date
      ) x
      GROUP BY x.type_id
    ),
    out AS (
      SELECT p.*, COALESCE(s.sparkline, '[]'::json) AS sparkline
      FROM page p
      LEFT JOIN spark s ON s.type_id = p.type_id
      ORDER BY ${sortExpr} ${dir} NULLS LAST, type_name ASC
    )
    SELECT
      COALESCE(json_agg(row_to_json(out)), '[]'::json) AS rows,
      COALESCE(MAX(out.total_count), 0)::int AS total
    FROM out;
  `;

  const { rows } = await db.query(sql, params);
  const payload = rows[0] || { rows: [], total: 0 };
  const items = (payload.rows || []).map(cleanRowNumbers);
  return {
    rows: items,
    total: Number(payload.total || 0),
    limit,
    offset,
    scope: { regions },
  };
}

router.get('/browser/bootstrap', async (_req, res) => {
  try {
    const [regionsResult, statusResult] = await Promise.all([
      db.query(
        `
        WITH order_counts AS (
          SELECT region_id, COUNT(*)::bigint AS order_count, COUNT(DISTINCT type_id)::bigint AS item_count
          FROM public.market_orders_current
          GROUP BY region_id
        )
        SELECT
          r."regionID" AS region_id,
          COALESCE(r."regionName", 'Region ' || r."regionID"::text) AS region_name,
          COALESCE(oc.order_count, 0)::bigint AS order_count,
          COALESCE(oc.item_count, 0)::bigint AS item_count
        FROM evesde."mapRegions" r
        LEFT JOIN order_counts oc ON oc.region_id = r."regionID"
        ORDER BY
          CASE WHEN r."regionID" = ANY($1::int[]) THEN 0 ELSE 1 END,
          COALESCE(oc.order_count, 0) DESC,
          region_name
        `,
        [TOP_REGION_IDS]
      ),
      db.query(
        `
        SELECT
          (SELECT MAX(last_seen) FROM public.market_orders_current) AS orders_last_seen,
          (SELECT MAX(reported_at) FROM public.market_orders_current) AS orders_reported_at,
          (SELECT COUNT(*)::bigint FROM public.market_orders_current) AS order_count,
          (SELECT COUNT(DISTINCT type_id)::bigint FROM public.market_orders_current) AS live_item_count,
          (SELECT COUNT(*)::bigint FROM public.market_orders_current WHERE location_id >= $1) AS player_structure_order_count,
          (SELECT MAX(date) FROM public.market_history_daily) AS history_last_date,
          (SELECT COUNT(*)::bigint FROM public.market_history_daily) AS history_row_count
        `,
        [NPC_STATION_ID_MAX]
      ),
    ]);

    return res.json({
      regions: regionsResult.rows.map(cleanRowNumbers),
      top_region_ids: TOP_REGION_IDS,
      plex_type_id: PLEX_TYPE_ID,
      capabilities: {
        security_filters: false,
        station_type_filters: true,
        player_structure_locations:
          Number(statusResult.rows[0]?.player_structure_order_count || 0) > 0,
        order_source_filters: false,
      },
      status: cleanRowNumbers(statusResult.rows[0] || {}),
    });
  } catch (err) {
    console.error('[market/browser/bootstrap] error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/browser/all-items', async (req, res) => {
  try {
    const payload = await buildAllItemsPayload(req);
    return res.json(payload);
  } catch (err) {
    console.error('[market/browser/all-items] error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/browser/category', async (req, res) => {
  try {
    const groupId = parseInt(String(req.query.group_id || ''), 10);
    if (!groupId) return res.status(400).json({ error: 'group_id required' });

    const regions = parseIdList(req.query.regions, 80);
    const params = [groupId];
    const orderRegion = orderRegionScope(params, regions);

    const { rows: childGroups } = await db.query(
      `
      WITH RECURSIVE
      children AS (
        SELECT g."marketGroupID" AS group_id, g."marketGroupName" AS group_name
        FROM evesde."invMarketGroups" g
        WHERE g."parentGroupID" = $1
      ),
      child_desc AS (
        SELECT c.group_id AS child_group_id, c.group_name, c.group_id AS market_group_id
        FROM children c
        UNION ALL
        SELECT cd.child_group_id, cd.group_name, g."marketGroupID"
        FROM child_desc cd
        JOIN evesde."invMarketGroups" g ON g."parentGroupID" = cd.market_group_id
      ),
      live_types AS (
        SELECT DISTINCT mo.type_id
        FROM public.market_orders_current mo
        WHERE 1=1
        ${orderRegion}
      )
      SELECT
        cd.child_group_id AS group_id,
        cd.group_name,
        COUNT(DISTINCT t."typeID") FILTER (WHERE lt.type_id IS NOT NULL)::int AS live_item_count
      FROM child_desc cd
      JOIN evesde."invTypes" t ON t."marketGroupID" = cd.market_group_id
      LEFT JOIN live_types lt ON lt.type_id = t."typeID"
      GROUP BY cd.child_group_id, cd.group_name
      ORDER BY cd.group_name
      `,
      params
    );

    const payload = await buildAllItemsPayload(req, groupId);
    return res.json({
      ...payload,
      group_id: groupId,
      child_groups: childGroups.map(cleanRowNumbers),
    });
  } catch (err) {
    console.error('[market/browser/category] error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/browser/item/:typeId', async (req, res) => {
  try {
    const typeId = parseInt(String(req.params.typeId || ''), 10);
    if (!typeId) return res.status(400).json({ error: 'type_id required' });

    const regions = parseIdList(req.query.regions, 80);
    const noScam = parseBool(req.query.no_scam);
    const params = [typeId];
    const orderRegion = orderRegionScope(params, regions);
    const histRegion = historyRegionScope(params, regions, 'h');
    const histPrevRegion = historyRegionScope(params, regions, 'h');

    const { rows } = await db.query(
      `
      WITH RECURSIVE
      item AS (
        SELECT
          t."typeID" AS type_id,
          t."typeName" AS type_name,
          COALESCE(t."volume", 0)::numeric AS volume_m3,
          t."marketGroupID" AS market_group_id
        FROM evesde."invTypes" t
        WHERE t."typeID" = $1
      ),
      crumb AS (
        SELECT
          mg."marketGroupID" AS id,
          mg."parentGroupID" AS parent_id,
          mg."marketGroupName" AS name,
          0 AS depth
        FROM item i
        JOIN evesde."invMarketGroups" mg ON mg."marketGroupID" = i.market_group_id
        UNION ALL
        SELECT
          p."marketGroupID",
          p."parentGroupID",
          p."marketGroupName",
          c.depth + 1
        FROM crumb c
        JOIN evesde."invMarketGroups" p ON p."marketGroupID" = c.parent_id
      ),
      scoped_orders AS (
        SELECT mo.*
        FROM public.market_orders_current mo
        WHERE mo.type_id = $1
        ${orderRegion}
      ),
      med AS (
        SELECT
          percentile_cont(0.5) WITHIN GROUP (ORDER BY price)
            FILTER (WHERE NOT is_buy_order) AS sell_median,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY price)
            FILTER (WHERE is_buy_order) AS buy_median,
          COUNT(*) FILTER (WHERE NOT is_buy_order) AS sell_count,
          COUNT(*) FILTER (WHERE is_buy_order) AS buy_count
        FROM scoped_orders
      ),
      clipped_orders AS (
        SELECT so.*
        FROM scoped_orders so
        CROSS JOIN med
        WHERE ${noScamWhere(noScam)}
      ),
      order_stats AS (
        SELECT
          MIN(price) FILTER (WHERE NOT is_buy_order) AS best_sell,
          MAX(price) FILTER (WHERE is_buy_order) AS best_buy,
          COUNT(*) FILTER (WHERE NOT is_buy_order) AS sell_orders,
          COUNT(*) FILTER (WHERE is_buy_order) AS buy_orders,
          COALESCE(SUM(volume_remain) FILTER (WHERE NOT is_buy_order), 0) AS sell_volume,
          COALESCE(SUM(volume_remain) FILTER (WHERE is_buy_order), 0) AS buy_volume
        FROM clipped_orders
      ),
      hist_recent AS (
        SELECT
          (SUM(h.avg_price * h.volume)::numeric / NULLIF(SUM(h.volume), 0)) AS avg_price,
          (SUM(h.volume)::numeric / NULLIF(COUNT(DISTINCT h.date), 0)) AS vol_day,
          (SUM(h.avg_price * h.volume)::numeric / NULLIF(COUNT(DISTINCT h.date), 0)) AS isk_day
        FROM public.market_history_daily h
        WHERE h.type_id = $1
          AND h.date >= current_date - INTERVAL '30 days'
          ${histRegion}
      ),
      hist_prev AS (
        SELECT
          (SUM(h.avg_price * h.volume)::numeric / NULLIF(SUM(h.volume), 0)) AS prev_avg_price
        FROM public.market_history_daily h
        WHERE h.type_id = $1
          AND h.date >= current_date - INTERVAL '60 days'
          AND h.date < current_date - INTERVAL '30 days'
          ${histPrevRegion}
      )
      SELECT
        i.*,
        COALESCE(
          (SELECT json_agg(json_build_object('id', id, 'name', name) ORDER BY depth DESC) FROM crumb),
          '[]'::json
        ) AS breadcrumb,
        os.best_sell,
        os.best_buy,
        (os.best_buy - os.best_sell) AS spread,
        CASE WHEN os.best_sell > 0 THEN ((os.best_buy - os.best_sell) / os.best_sell) * 100 END AS spread_pct,
        os.sell_orders,
        os.buy_orders,
        os.sell_volume,
        os.buy_volume,
        hr.avg_price,
        CASE
          WHEN hp.prev_avg_price > 0 AND hr.avg_price IS NOT NULL
          THEN ((hr.avg_price - hp.prev_avg_price) / hp.prev_avg_price) * 100
        END AS delta_price,
        hr.isk_day,
        hr.vol_day,
        med.sell_median,
        med.buy_median
      FROM item i
      CROSS JOIN order_stats os
      CROSS JOIN hist_recent hr
      CROSS JOIN hist_prev hp
      CROSS JOIN med
      `,
      params
    );

    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    return res.json(cleanRowNumbers(rows[0]));
  } catch (err) {
    console.error('[market/browser/item] error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/browser/item/:typeId/orders', async (req, res) => {
  try {
    const typeId = parseInt(String(req.params.typeId || ''), 10);
    if (!typeId) return res.status(400).json({ error: 'type_id required' });

    const params = [typeId];
    const regions = parseIdList(req.query.regions, 80);
    const locations = parseIdList(req.query.locations || req.query.location_id, 100);
    const side = ['sell', 'buy', 'both'].includes(String(req.query.side)) ? String(req.query.side) : 'both';
    const stationTypes = String(req.query.station_type || 'all')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const noScam = parseBool(req.query.no_scam);
    const limit = clampInt(req.query.limit, 500, 1, 2000);
    const offset = clampInt(req.query.offset, 0, 0, 1000000);
    const priceMin = parseNumber(req.query.price_min);
    const priceMax = parseNumber(req.query.price_max);
    const minQty = parseNumber(req.query.min_qty);
    const sort = ORDER_SORTS[String(req.query.sort || '')] || null;
    const dir = directionOf(req.query.direction);

    let filters = '';
    filters += orderRegionScope(params, regions);
    if (locations.length) {
      filters += ` AND mo.location_id = ANY(${addParam(params, locations)}::bigint[])`;
    }
    if (priceMin != null) filters += ` AND mo.price >= ${addParam(params, priceMin)}::numeric`;
    if (priceMax != null) filters += ` AND mo.price <= ${addParam(params, priceMax)}::numeric`;
    if (minQty != null) filters += ` AND mo.volume_remain >= ${addParam(params, minQty)}::numeric`;

    const wantsNpc = stationTypes.includes('npc');
    const wantsPlayer = stationTypes.includes('player');
    if (wantsNpc && !wantsPlayer) filters += ` AND mo.location_id < ${NPC_STATION_ID_MAX}`;
    if (wantsPlayer && !wantsNpc) filters += ` AND mo.location_id >= ${NPC_STATION_ID_MAX}`;
    if (side === 'sell') filters += ' AND mo.is_buy_order = FALSE';
    if (side === 'buy') filters += ' AND mo.is_buy_order = TRUE';

    const orderBy = sort
      ? `${sort} ${dir} NULLS LAST, c.order_id ASC`
      : `
        CASE WHEN c.is_buy_order THEN c.price END DESC NULLS LAST,
        CASE WHEN NOT c.is_buy_order THEN c.price END ASC NULLS LAST,
        c.order_id ASC
      `;
    const limitParam = addParam(params, limit);
    const offsetParam = addParam(params, offset);

    const sql = `
      WITH filtered AS (
        SELECT
          mo.order_id,
          mo.type_id,
          mo.region_id,
          mo.system_id,
          mo.location_id,
          mo.is_buy_order,
          mo.price::numeric AS price,
          mo.volume_total,
          mo.volume_remain::numeric AS volume_remain,
          mo.min_volume,
          mo.issued,
          mo.duration,
          mo.range,
          mo.reported_at,
          mo.last_seen,
          COALESCE(r."regionName", 'Region ' || mo.region_id::text) AS region_name,
          COALESCE(ss."solarSystemName", '') AS system_name,
          COALESCE(
            NULLIF(st."stationName", ''),
            NULLIF(sn."itemName", ''),
            NULLIF(sun."itemName", ''),
            NULLIF(md."itemName", '')
          ) AS station_name,
          COALESCE(
            NULLIF(st."stationName", ''),
            NULLIF(sn."itemName", ''),
            NULLIF(sun."itemName", ''),
            NULLIF(md."itemName", ''),
            CASE
              WHEN mo.location_id < ${NPC_STATION_ID_MAX} THEN 'Station ' || mo.location_id::text
              ELSE 'Structure ' || mo.location_id::text
            END
          ) AS location_name,
          CASE WHEN mo.location_id < ${NPC_STATION_ID_MAX} THEN 'npc' ELSE 'player' END AS station_type,
          COALESCE(t."volume", 0)::numeric AS unit_volume_m3,
          (mo.issued + (mo.duration::text || ' days')::interval) AS expires_at
        FROM public.market_orders_current mo
        LEFT JOIN evesde."mapRegions" r ON r."regionID" = mo.region_id
        LEFT JOIN evesde."mapSolarSystems" ss ON ss."solarSystemID" = mo.system_id
        LEFT JOIN evesde."staStations" st ON st."stationID" = mo.location_id
        LEFT JOIN evesde."invNames" sn ON sn."itemID" = mo.location_id
        LEFT JOIN evesde."invUniqueNames" sun ON sun."itemID" = mo.location_id
        LEFT JOIN evesde."mapDenormalize" md ON md."itemID" = mo.location_id
        LEFT JOIN evesde."invTypes" t ON t."typeID" = mo.type_id
        WHERE mo.type_id = $1
        ${filters}
      ),
      med AS (
        SELECT
          percentile_cont(0.5) WITHIN GROUP (ORDER BY price)
            FILTER (WHERE NOT is_buy_order) AS sell_median,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY price)
            FILTER (WHERE is_buy_order) AS buy_median,
          COUNT(*) FILTER (WHERE NOT is_buy_order) AS sell_count,
          COUNT(*) FILTER (WHERE is_buy_order) AS buy_count
        FROM filtered
      ),
      clipped AS (
        SELECT f.*
        FROM filtered f
        CROSS JOIN med
        WHERE ${noScamWhere(noScam).replaceAll('so.', 'f.')}
      ),
      c AS (
        SELECT
          clipped.*,
          (clipped.volume_remain * clipped.unit_volume_m3) AS volume_m3
        FROM clipped
      ),
      numbered AS (
        SELECT
          c.*,
          ROW_NUMBER() OVER (PARTITION BY c.is_buy_order ORDER BY ${orderBy}) AS rn,
          COUNT(*) OVER (PARTITION BY c.is_buy_order) AS side_count
        FROM c
      ),
      page_rows AS (
        SELECT *
        FROM numbered
        WHERE rn > ${offsetParam} AND rn <= (${offsetParam} + ${limitParam})
      ),
      counts AS (
        SELECT
          COUNT(*) FILTER (WHERE NOT is_buy_order)::int AS sell_count,
          COUNT(*) FILTER (WHERE is_buy_order)::int AS buy_count,
          COALESCE(SUM(volume_remain) FILTER (WHERE NOT is_buy_order), 0) AS sell_volume,
          COALESCE(SUM(volume_remain) FILTER (WHERE is_buy_order), 0) AS buy_volume,
          MIN(price) FILTER (WHERE NOT is_buy_order) AS best_sell,
          MAX(price) FILTER (WHERE is_buy_order) AS best_buy
        FROM c
      ),
      depth_price AS (
        SELECT is_buy_order, price, SUM(volume_remain)::numeric AS volume
        FROM c
        GROUP BY is_buy_order, price
      ),
      depth_json AS (
        SELECT
          COALESCE(
            json_agg(
              json_build_object('side', CASE WHEN is_buy_order THEN 'buy' ELSE 'sell' END, 'price', price, 'volume', volume)
              ORDER BY is_buy_order ASC, price ASC
            ),
            '[]'::json
          ) AS levels
        FROM depth_price
      ),
      rows_json AS (
        SELECT
          COALESCE(
            json_agg(row_to_json(page_rows) ORDER BY is_buy_order ASC, rn ASC),
            '[]'::json
          ) AS rows
        FROM page_rows
      )
      SELECT rows_json.rows, counts.*, med.*, depth_json.levels AS depth
      FROM rows_json
      CROSS JOIN counts
      CROSS JOIN med
      CROSS JOIN depth_json;
    `;

    const { rows } = await db.query(sql, params);
    const payload = rows[0] || { rows: [], depth: [] };
    const orderRows = (payload.rows || []).map(cleanRowNumbers);
    const sellers = orderRows.filter((r) => !r.is_buy_order);
    const buyers = orderRows.filter((r) => r.is_buy_order);
    const depth = (payload.depth || []).map(cleanRowNumbers);

    return res.json({
      type_id: typeId,
      sellers,
      buyers,
      counts: cleanRowNumbers({
        sell_count: payload.sell_count,
        buy_count: payload.buy_count,
        sell_volume: payload.sell_volume,
        buy_volume: payload.buy_volume,
        best_sell: payload.best_sell,
        best_buy: payload.best_buy,
        sell_median: payload.sell_median,
        buy_median: payload.buy_median,
      }),
      depth,
      limit,
      offset,
      scope: { regions, locations, side },
    });
  } catch (err) {
    console.error('[market/browser/orders] error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/browser/item/:typeId/history', async (req, res) => {
  try {
    const typeId = parseInt(String(req.params.typeId || ''), 10);
    if (!typeId) return res.status(400).json({ error: 'type_id required' });

    const days = [7, 14, 21, 30, 90, 180, 365].includes(parseInt(String(req.query.days || ''), 10))
      ? parseInt(String(req.query.days), 10)
      : 365;
    const regions = parseIdList(req.query.regions, 80);
    const params = [typeId, days];
    const histRegion = historyRegionScope(params, regions, 'h');

    const { rows } = await db.query(
      `
      WITH raw AS (
        SELECT
          h.date,
          h.region_id,
          COALESCE(r."regionName", 'Region ' || h.region_id::text) AS region_name,
          h.type_id,
          h.low_price::numeric,
          h.high_price::numeric,
          h.avg_price::numeric,
          h.volume::numeric,
          h.orders
        FROM public.market_history_daily h
        LEFT JOIN evesde."mapRegions" r ON r."regionID" = h.region_id
        WHERE h.type_id = $1
          AND h.date >= current_date - (($2::int + 28) * INTERVAL '1 day')
          ${histRegion}
      ),
      calc AS (
        SELECT
          raw.*,
          AVG(avg_price) OVER (
            PARTITION BY region_id
            ORDER BY date
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
          ) AS ma7,
          AVG(avg_price) OVER (
            PARTITION BY region_id
            ORDER BY date
            ROWS BETWEEN 27 PRECEDING AND CURRENT ROW
          ) AS ma28
        FROM raw
      ),
      visible AS (
        SELECT *
        FROM calc
        WHERE date >= current_date - ($2::int * INTERVAL '1 day')
      ),
      stats AS (
        SELECT
          (SUM(avg_price * volume)::numeric / NULLIF(SUM(volume), 0)) AS avg_price,
          (SUM(volume)::numeric / NULLIF(COUNT(DISTINCT date), 0)) AS vol_day,
          (SUM(avg_price * volume)::numeric / NULLIF(COUNT(DISTINCT date), 0)) AS isk_day,
          MIN(date) AS first_date,
          MAX(date) AS last_date
        FROM visible
      ),
      rows_json AS (
        SELECT
          COALESCE(
            json_agg(row_to_json(visible) ORDER BY date ASC, region_name ASC),
            '[]'::json
          ) AS rows
        FROM visible
      )
      SELECT rows_json.rows, row_to_json(stats) AS stats
      FROM rows_json
      CROSS JOIN stats;
      `,
      params
    );

    const payload = rows[0] || { rows: [], stats: {} };
    return res.json({
      type_id: typeId,
      days,
      regions,
      rows: (payload.rows || []).map(cleanRowNumbers),
      stats: cleanRowNumbers(payload.stats || {}),
    });
  } catch (err) {
    console.error('[market/browser/history] error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/browser/quickbar/resolve', async (req, res) => {
  try {
    const candidates = extractQuickbarCandidates(req.body?.text, req.body?.names || []);
    if (!candidates.length) {
      return res.json({ candidates: [], resolved: [], not_found: [] });
    }

    const keys = candidates.map((c) => c.toLowerCase());
    const { rows } = await db.query(
      `
      SELECT "typeID" AS type_id, "typeName" AS type_name
      FROM evesde."invTypes"
      WHERE COALESCE("published", TRUE) = TRUE
        AND LOWER("typeName") = ANY($1::text[])
      `,
      [keys]
    );

    const byName = new Map(rows.map((r) => [String(r.type_name).toLowerCase(), r]));
    const resolved = [];
    const notFound = [];
    for (const candidate of candidates) {
      const hit = byName.get(candidate.toLowerCase());
      if (hit) {
        resolved.push({
          input: candidate,
          type_id: Number(hit.type_id),
          type_name: hit.type_name,
        });
      } else {
        notFound.push(candidate);
      }
    }

    return res.json({ candidates, resolved, not_found: notFound });
  } catch (err) {
    console.error('[market/browser/quickbar/resolve] error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/browser/ticker', async (req, res) => {
  try {
    const typeIds = parseIdList(req.query.type_ids, 150);
    if (!typeIds.length) return res.status(400).json({ error: 'type_ids required' });

    const params = [typeIds];
    const regions = parseIdList(req.query.regions, 80);
    const orderRegion = orderRegionScope(params, regions);
    const histRegion = historyRegionScope(params, regions, 'h');

    const { rows } = await db.query(
      `
      WITH ids AS (
        SELECT unnest($1::int[]) AS type_id
      ),
      order_stats AS (
        SELECT
          mo.type_id,
          MIN(mo.price) FILTER (WHERE NOT mo.is_buy_order) AS lowest_sell,
          MAX(mo.price) FILTER (WHERE mo.is_buy_order) AS highest_buy
        FROM public.market_orders_current mo
        JOIN ids ON ids.type_id = mo.type_id
        WHERE 1=1
        ${orderRegion}
        GROUP BY mo.type_id
      ),
      latest_date AS (
        SELECT h.type_id, MAX(h.date) AS date
        FROM public.market_history_daily h
        JOIN ids ON ids.type_id = h.type_id
        WHERE 1=1
        ${histRegion}
        GROUP BY h.type_id
      ),
      latest_history AS (
        SELECT
          h.type_id,
          (SUM(h.avg_price * h.volume)::numeric / NULLIF(SUM(h.volume), 0)) AS latest_avg_price
        FROM public.market_history_daily h
        JOIN latest_date ld ON ld.type_id = h.type_id AND ld.date = h.date
        GROUP BY h.type_id
      )
      SELECT
        ids.type_id,
        COALESCE(t."typeName", 'Type ' || ids.type_id::text) AS type_name,
        os.lowest_sell,
        os.highest_buy,
        lh.latest_avg_price,
        CASE
          WHEN lh.latest_avg_price > 0 AND os.lowest_sell IS NOT NULL
          THEN ((os.lowest_sell - lh.latest_avg_price) / lh.latest_avg_price) * 100
        END AS sell_vs_avg_pct
      FROM ids
      LEFT JOIN evesde."invTypes" t ON t."typeID" = ids.type_id
      LEFT JOIN order_stats os ON os.type_id = ids.type_id
      LEFT JOIN latest_history lh ON lh.type_id = ids.type_id
      ORDER BY array_position($1::int[], ids.type_id)
      `,
      params
    );

    return res.json({
      scope: { regions },
      rows: rows.map(cleanRowNumbers),
    });
  } catch (err) {
    console.error('[market/browser/ticker] error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
