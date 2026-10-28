/*
 * Background worker for market Orders Worker.
 * Runs polling or import loops using external EVE data sources and Postgres side effects.
 */

const { Pool } = require('pg');
const { captureException, initSentry } = require('../lib/sentry');
const { markWorkerFailure, markWorkerStarted, markWorkerSuccess } = require('../lib/workerHeartbeat');

initSentry({ serviceName: "market-orders-worker" });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const WORKER_NAME = "market-orders-worker";
const ESI = 'https://esi.evetech.net/latest';
const DATASOURCE = 'tranquility';

async function ensureEtagTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS esi_etags (
      endpoint      text PRIMARY KEY,
      etag          text,
      last_modified timestamptz
    );
  `);
}

async function getEtag(endpoint) {
  const { rows } = await pool.query(
    'SELECT etag FROM esi_etags WHERE endpoint = $1',
    [endpoint]
  );
  return rows[0]?.etag || null;
}

async function setEtag(endpoint, etag) {
  if (!etag) return;
  await pool.query(
    `
    INSERT INTO esi_etags (endpoint, etag, last_modified)
    VALUES ($1, $2, now())
    ON CONFLICT (endpoint) DO UPDATE SET
      etag = EXCLUDED.etag,
      last_modified = EXCLUDED.last_modified
    `,
    [endpoint, etag]
  );
}

async function getRegionIds() {
  const { rows } = await pool.query(
    'SELECT "regionID" AS id FROM evesde."mapRegions"'
  );
  return rows.map((r) => r.id);
}

async function fetchRegionOrders(regionId, endpointKey) {
  const headers = {};
  const previousEtag = await getEtag(endpointKey);
  if (previousEtag) {
    headers['If-None-Match'] = previousEtag;
  }

  const baseUrl = `${ESI}/markets/${regionId}/orders/?order_type=all&datasource=${DATASOURCE}`;

  const firstRes = await fetch(`${baseUrl}&page=1`, { headers });

  if (firstRes.status === 304) {
    console.log(`[orders] region ${regionId}: not modified (ETag 304)`);
    return { unchanged: true, orders: [] };
  }

  if (!firstRes.ok) {
    throw new Error(
      `region ${regionId} page 1 error: ${firstRes.status} ${await firstRes.text()}`
    );
  }

  const newEtag = firstRes.headers.get('etag');
  const xPages = parseInt(firstRes.headers.get('x-pages') || '1', 10);

  const all = await firstRes.json();

  for (let page = 2; page <= xPages; page++) {
    const res = await fetch(`${baseUrl}&page=${page}`);
    if (!res.ok) {
      console.error(
        `[orders] region ${regionId} page ${page} error: ${res.status} ${await res.text()}`
      );
      break;
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
  }

  return { unchanged: false, etag: newEtag, orders: all };
}

async function syncRegion(regionId) {
  const endpointKey = `markets_${regionId}_orders_all`;

  let result;
  try {
    result = await fetchRegionOrders(regionId, endpointKey);
  } catch (err) {
    console.error('[orders] fetch error for region', regionId, err.message || err);
    captureException(err, { tags: { worker: WORKER_NAME, region_id: regionId, phase: "fetch" } });
    await markWorkerFailure(pool, WORKER_NAME, err);
    return false;
  }

  if (result.unchanged) {
    return true;
  }

  const { orders, etag } = result;
  const now = new Date();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertSql = `
      INSERT INTO market_orders_current (
        order_id, type_id, region_id, system_id, location_id,
        is_buy_order, price, volume_total, volume_remain,
        min_volume, issued, duration, range,
        reported_at, last_seen
      )
      VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,
        $10,$11,$12,$13,
        $14,$15
      )
      ON CONFLICT (order_id) DO UPDATE SET
        type_id       = EXCLUDED.type_id,
        region_id     = EXCLUDED.region_id,
        system_id     = EXCLUDED.system_id,
        location_id   = EXCLUDED.location_id,
        is_buy_order  = EXCLUDED.is_buy_order,
        price         = EXCLUDED.price,
        volume_total  = EXCLUDED.volume_total,
        volume_remain = EXCLUDED.volume_remain,
        min_volume    = EXCLUDED.min_volume,
        issued        = EXCLUDED.issued,
        duration      = EXCLUDED.duration,
        range         = EXCLUDED.range,
        reported_at   = EXCLUDED.reported_at,
        last_seen     = EXCLUDED.last_seen
    `;

    for (const o of orders) {
      await client.query(insertSql, [
        o.order_id,
        o.type_id,
        regionId,
        o.system_id,
        o.location_id,
        o.is_buy_order,
        o.price,
        o.volume_total,
        o.volume_remain,
        o.min_volume,
        o.issued,
        o.duration,
        typeof o.range === 'string' ? -1 : o.range,
        now,
        now,
      ]);
    }

    await client.query(
      `
      DELETE FROM market_orders_current
      WHERE region_id = $1
        AND last_seen < $2
      `,
      [regionId, now]
    );

    await client.query('COMMIT');

    if (etag) {
      await setEtag(endpointKey, etag);
    }

    console.log(
      `[orders] region ${regionId}: ${orders.length} orders synced`
    );
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[orders] region sync error', regionId, err.message || err);
    captureException(err, { tags: { worker: WORKER_NAME, region_id: regionId, phase: "sync" } });
    await markWorkerFailure(pool, WORKER_NAME, err);
    return false;
  } finally {
    client.release();
  }
}

async function loop() {
  await ensureEtagTable();

  while (true) {
    const start = Date.now();
    await markWorkerStarted(pool, WORKER_NAME);
    try {
      const regions = await getRegionIds();
      let failedRegions = 0;

      for (const regionId of regions) {
        const ok = await syncRegion(regionId);
        if (!ok) failedRegions += 1;
      }
      if (failedRegions > 0) {
        throw new Error(`${failedRegions}/${regions.length} market order regions failed`);
      }
      await markWorkerSuccess(pool, WORKER_NAME, {
        durationMs: Date.now() - start,
        rows: regions.length,
      });
    } catch (err) {
      console.error('[orders] loop error', err.message || err);
      captureException(err, { tags: { worker: WORKER_NAME, phase: "loop" } });
      await markWorkerFailure(pool, WORKER_NAME, err, { durationMs: Date.now() - start });
    }

    const elapsed = Date.now() - start;
    const sleepMs = Math.max(0, 5 * 60 * 1000 - elapsed);
    if (sleepMs > 0) {
      await new Promise((r) => setTimeout(r, sleepMs));
    }
  }
}

loop().catch((err) => {
  console.error('[orders] fatal', err);
  captureException(err, { tags: { worker: WORKER_NAME, phase: "fatal" } });
  process.exit(1);
});
