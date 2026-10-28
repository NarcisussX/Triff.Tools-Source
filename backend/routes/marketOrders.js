/*
 * Express router for market Orders API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/marketDb');

const DEFAULT_HUBS = [
  60003760,
  60008494,
  60011866,
  60004588,
  60005686
];

const NPC_STATION_ID_MAX = 70000000;

const MAX_ESI_LOOKUPS_PER_REQUEST = 50;

const ESI_CONCURRENCY = 8;

async function getFetch() {
  if (typeof global.fetch === 'function') {
    return global.fetch;
  }
  const mod = await import('node-fetch');
  return mod.default;
}

async function enrichStationNames(rows) {

  const npcIds = [
    ...new Set(
      rows
        .filter((r) => {
          const loc = Number(r.location_id);
          return (
            !r.station_name &&
            Number.isFinite(loc) &&
            loc > 0 &&
            loc < NPC_STATION_ID_MAX
          );
        })
        .map((r) => Number(r.location_id))
    ),
  ];

  if (!npcIds.length) {
    return rows;
  }

  const { rows: cached } = await db.query(
    `
      SELECT "stationID", "stationName"
      FROM evesde."staStations"
      WHERE "stationID" = ANY($1)
    `,
    [npcIds]
  );

  const nameById = new Map(
    cached
      .filter((r) => r.stationName && r.stationName.trim() !== '')
      .map((r) => [Number(r.stationID), r.stationName])
  );

  const missingIds = npcIds.filter((id) => !nameById.has(id));
  if (!missingIds.length) {
    return rows.map((r) => {
      if (r.station_name) return r;
      const loc = Number(r.location_id);
      if (!Number.isFinite(loc)) return r;
      const name = nameById.get(loc);
      return name ? { ...r, station_name: name } : r;
    });
  }

  const toLookup = missingIds.slice(0, MAX_ESI_LOOKUPS_PER_REQUEST);
  if (missingIds.length > MAX_ESI_LOOKUPS_PER_REQUEST) {
    console.warn(
      `[market/orders] ${missingIds.length} station IDs missing; resolving only first ${MAX_ESI_LOOKUPS_PER_REQUEST} this request`
    );
  }

  const fetch = await getFetch();

  let idx = 0;
  async function worker() {
    while (idx < toLookup.length) {
      const myIndex = idx++;
      const id = toLookup[myIndex];

      try {
        const res = await fetch(
          `https://esi.evetech.net/latest/universe/stations/${id}/?datasource=tranquility`
        );
        if (!res.ok) {
          console.warn(
            '[market/orders] ESI station lookup failed',
            id,
            res.status
          );
          continue;
        }

        const data = await res.json();
        const name = data.name || null;
        const systemId = data.system_id || null;

        await db.query(
          `
            INSERT INTO evesde."staStations"
              ("stationID","stationName","solarSystemID","regionID")
            VALUES ($1,$2,$3,NULL)
            ON CONFLICT ("stationID") DO UPDATE SET
              "stationName"   = EXCLUDED."stationName",
              "solarSystemID" = EXCLUDED."solarSystemID"
          `,
          [id, name, systemId]
        );

        if (name) {
          nameById.set(id, name);
        }
      } catch (err) {
        console.error('[market/orders] ESI station lookup error', id, err);
      }
    }
  }

  const workerCount = Math.min(ESI_CONCURRENCY, toLookup.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return rows.map((r) => {
    if (r.station_name) return r;
    const loc = Number(r.location_id);
    if (!Number.isFinite(loc)) return r;
    const name = nameById.get(loc);
    return name ? { ...r, station_name: name } : r;
  });
}

router.get('/orders', async (req, res) => {
  try {
    const typeId = parseInt(String(req.query.type_id || ''), 10);
    if (!typeId) {
      return res.status(400).json({ error: 'type_id required' });
    }

    const tradeHubsOnly = req.query.tradeHubsOnly === 'true';
    const hubsParam = String(req.query.hubs || '')
      .split(',')
      .map((v) => parseInt(v, 10))
      .filter(Boolean);

    let locationClause = '';
    const params = [typeId];

    if (tradeHubsOnly) {
      params.push(DEFAULT_HUBS);
      locationClause = `AND mo.location_id = ANY($${params.length})`;
    } else if (hubsParam.length) {
      params.push(hubsParam);
      locationClause = `AND mo.location_id = ANY($${params.length})`;
    }

    const sql = `
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
        mo.duration,
        mo.last_seen,
        r."regionName"       AS region_name,
        ss."solarSystemName" AS system_name,
        st."stationName"     AS station_name
      FROM market_orders_current mo
      LEFT JOIN evesde."mapRegions"      r  ON r."regionID"       = mo.region_id
      LEFT JOIN evesde."mapSolarSystems" ss ON ss."solarSystemID" = mo.system_id
      LEFT JOIN evesde."staStations"     st ON st."stationID"     = mo.location_id
      WHERE mo.type_id = $1
      ${locationClause}
    `;

    const { rows: rawRows } = await db.query(sql, params);

    const rows = await enrichStationNames(rawRows);

    const now = Date.now();

    const mapOrder = (row) => {
      const issued = new Date(row.issued);
      const expiry = new Date(
        issued.getTime() + Number(row.duration) * 24 * 60 * 60 * 1000
      );
      const hoursLeft = (expiry.getTime() - now) / 3600000;

      return {
        order_id: row.order_id,
        price: Number(row.price),
        volume_remain: Number(row.volume_remain),
        region_name: row.region_name || '',
        system_name: row.system_name || '',
        station_name: row.station_name || null,
        location_id: row.location_id,
        expires_in: hoursLeft,
        last_updated: row.issued,
      };
    };

    const sellers = rows
      .filter((r) => !r.is_buy_order)
      .map(mapOrder)
      .sort((a, b) => a.price - b.price);

    const buyers = rows
      .filter((r) => r.is_buy_order)
      .map(mapOrder)
      .sort((a, b) => b.price - a.price);

    return res.json({ type_id: typeId, sellers, buyers });
  } catch (err) {
    console.error('[market/orders] error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
