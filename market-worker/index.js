/*
 * Runs the market worker that fetches ESI regional orders and aggregates hub prices.
 * Uses Postgres state tables, ETags, and scheduled polling to update station market data.
 */

import fetch from "node-fetch";
import { Pool } from "pg";

const REGIONS = [10000002, 10000043, 10000032, 10000042, 10000030];

const HUB_STATIONS = {
  60003760: 10000002,
  60008494: 10000043,
  60011866: 10000032,
  60005686: 10000042,
  60004588: 10000030,
};

const STATION_SYSTEM = {
  60003760: 30000142,
  60008494: 30002187,
  60011866: 30002659,
  60005686: 30002053,
  60004588: 30002510,
};

const HUB_SET = new Set(Object.keys(HUB_STATIONS).map(Number));

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "10", 10);
const RUN_EVERY_MS = parseInt(process.env.WORKER_INTERVAL_MS || `${30 * 60 * 1000}`, 10);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const WORKER_NAME = "market-worker";

function truncate(value, max = 2000) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...[truncated]` : text;
}

async function ensureHeartbeatTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS worker_heartbeats (
      worker_name text PRIMARY KEY,
      last_started_at timestamptz,
      last_success_at timestamptz,
      last_failure_at timestamptz,
      last_error text,
      last_duration_ms integer,
      last_rows bigint,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function writeHeartbeat(fields) {
  try {
    await ensureHeartbeatTable();
    await pool.query(
      `
        INSERT INTO worker_heartbeats (
          worker_name,
          last_started_at,
          last_success_at,
          last_failure_at,
          last_error,
          last_duration_ms,
          last_rows,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (worker_name) DO UPDATE SET
          last_started_at = COALESCE(EXCLUDED.last_started_at, worker_heartbeats.last_started_at),
          last_success_at = COALESCE(EXCLUDED.last_success_at, worker_heartbeats.last_success_at),
          last_failure_at = COALESCE(EXCLUDED.last_failure_at, worker_heartbeats.last_failure_at),
          last_error = COALESCE(EXCLUDED.last_error, worker_heartbeats.last_error),
          last_duration_ms = COALESCE(EXCLUDED.last_duration_ms, worker_heartbeats.last_duration_ms),
          last_rows = COALESCE(EXCLUDED.last_rows, worker_heartbeats.last_rows),
          updated_at = now()
      `,
      [
        WORKER_NAME,
        fields.last_started_at || null,
        fields.last_success_at || null,
        fields.last_failure_at || null,
        fields.last_error ?? null,
        Number.isFinite(fields.last_duration_ms) ? Math.round(fields.last_duration_ms) : null,
        Number.isFinite(fields.last_rows) ? Math.round(fields.last_rows) : null,
      ]
    );
  } catch (err) {
    console.warn(`[MARKET_WORKER]: heartbeat skipped: ${err.message}`);
  }
}

function markStarted() {
  return writeHeartbeat({ last_started_at: new Date() });
}

function markSuccess(details = {}) {
  return writeHeartbeat({
    last_success_at: new Date(),
    last_duration_ms: Number(details.durationMs),
    last_rows: Number(details.rows),
    last_error: "",
  });
}

function markFailure(error, details = {}) {
  return writeHeartbeat({
    last_failure_at: new Date(),
    last_duration_ms: Number(details.durationMs),
    last_error: truncate(error?.stack || error?.message || error || "Unknown market worker failure"),
  });
}

async function getPageState(region_id, page) {
  const { rows } = await pool.query(
    "select etag, last_modified, x_pages from esi_page_state where region_id=$1 and page=$2",
    [region_id, page]
  );
  return rows[0] || {};
}

async function savePageState(region_id, page, etag, last_modified, x_pages) {
  await pool.query(
    `insert into esi_page_state(region_id, page, etag, last_modified, x_pages, last_checked)
     values($1,$2,$3,$4,$5, now())
     on conflict (region_id, page)
     do update set etag=$3, last_modified=$4, x_pages=$5, last_checked=now()`,
    [region_id, page, etag || null, last_modified || null, x_pages || null]
  );
}

function blankEntry() {
  return { sell: [], buy: [], sellMin: Infinity, buyMax: 0 };
}

function buyOrderCoversStation(o, station_id) {
  if (!o.is_buy_order) return false;

  const stSys = STATION_SYSTEM[station_id];
  if (!stSys) return false;

  const range = String(o.range).toLowerCase();
  if (range === 'station') {
    return o.location_id === station_id;
  }
  if (range === 'solarsystem') {
    return o.system_id === stSys;
  }
  if (range === 'region') {
    return true;
  }

  const jumps = parseInt(range, 10);
  if (!Number.isNaN(jumps)) {

    return false;
  }
  return false;
}

function addOrder(stationAggs, o) {
  const sid = o.location_id;
  if (!HUB_SET.has(sid)) return;

  if (o.is_buy_order) {

    if (!buyOrderCoversStation(o, sid)) return;

    stationAggs[sid] ??= {};
    stationAggs[sid][o.type_id] ??= blankEntry();
    const e = stationAggs[sid][o.type_id];

    if (o.price > e.buyMax) e.buyMax = o.price;
    e.buy.push({ p: o.price, v: o.volume_remain });
  } else {

    stationAggs[sid] ??= {};
    stationAggs[sid][o.type_id] ??= blankEntry();
    const e = stationAggs[sid][o.type_id];

    if (o.price < e.sellMin) e.sellMin = o.price;
    e.sell.push({ p: o.price, v: o.volume_remain });
  }
}
function weighted5pct(sideArr, pickCheapest = true) {
  if (!sideArr.length) return null;
  sideArr.sort((a,b)=> pickCheapest ? a.p-b.p : b.p-a.p);
  const totalV = sideArr.reduce((s,x)=> s+x.v, 0);
  if (totalV === 0) return null;
  let want = Math.max(1, Math.floor(totalV * 0.05));
  let accV = 0, accPV = 0;
  for (const {p,v} of sideArr) {
    const take = Math.min(v, want - accV);
    accPV += p * take;
    accV += take;
    if (accV >= want) break;
  }
  return accV ? accPV / accV : null;
}

async function fetchRegion(region_id) {
  const first = await fetchPage(region_id, 1);
  const totalPages = first.xPages || 1;
  const stationAggs = {};
  if (first.orders) for (const o of first.orders) addOrder(stationAggs, o);

  const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
  let i = 0, active = 0;
  const runPool = () => new Promise((resolve)=>{
    const tick = async () => {
      if (i >= pages.length) return resolve();
      const page = pages[i++]; active++;
      try {
        const res = await fetchPage(region_id, page);
        if (res.orders) for (const o of res.orders) addOrder(stationAggs, o);
      } finally {
        active--;
        if (i < pages.length) tick(); else if (active === 0) resolve();
      }
    };
    for (let k=0;k<Math.min(CONCURRENCY, pages.length);k++) tick();
  });
  await runPool();

  const now = new Date().toISOString();
  const upserts = [];
  for (const [station_id, byType] of Object.entries(stationAggs)) {
    for (const [type_id, e] of Object.entries(byType)) {
      const sell5 = weighted5pct(e.sell, true);
      const buy5  = weighted5pct(e.buy, false);
      const sellMin = isFinite(e.sellMin) ? e.sellMin : null;
      const buyMax  = e.buyMax || null;
      upserts.push(pool.query(
        `insert into market_station_aggregates(station_id, type_id, sell_min, buy_max, sell_5pct, buy_5pct, last_updated)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (station_id, type_id)
         do update set sell_min=excluded.sell_min,
                       buy_max=excluded.buy_max,
                       sell_5pct=excluded.sell_5pct,
                       buy_5pct=excluded.buy_5pct,
                       last_updated=excluded.last_updated`,
        [parseInt(station_id,10), parseInt(type_id,10), sellMin, buyMax, sell5, buy5, now]
      ));
    }
  }
  await Promise.all(upserts);
}

async function fetchPage(region_id, page, attempt = 1) {
  const state = await getPageState(region_id, page);
  const url = `https://esi.evetech.net/latest/markets/${region_id}/orders/?order_type=all&page=${page}`;
  const headers = {
    "Accept": "application/json",
    "User-Agent": "TriffnixMarketWorker/1.0 (contact: cooperbroderick25@gmail.com)"
  };
  if (state.etag) headers["If-None-Match"] = state.etag;

  const r = await fetch(url, { headers });

  if (r.status === 304) {
    await savePageState(region_id, page, state.etag, state.last_modified || null, state.x_pages || null);
    return { orders: null, xPages: page === 1 ? (state.x_pages || 1) : undefined };
  }

  if (r.status === 420 || r.status === 429 || r.status >= 500) {
    if (attempt <= 5) {
      const backoff = 250 * attempt;
      await new Promise(res => setTimeout(res, backoff));
      return fetchPage(region_id, page, attempt + 1);
    }
    throw new Error(`${region_id} p${page} HTTP ${r.status} after retries`);
  }

  if (r.status === 404) {
    const newMax = page - 1;
    const prevMax = state.x_pages || newMax;
    await savePageState(region_id, page, state.etag || null, state.last_modified || null, Math.min(prevMax, newMax));
    return { orders: null, xPages: page === 1 ? Math.min(prevMax, newMax) || 1 : undefined };
  }

  if (!r.ok) {

    throw new Error(`${region_id} p${page} HTTP ${r.status}`);
  }

  const etag = r.headers.get("etag");
  const lastMod = r.headers.get("last-modified");
  const xPagesHeader = r.headers.get("x-pages");
  const xPages = xPagesHeader ? parseInt(xPagesHeader, 10) : (state.x_pages || 1);

  const orders = await r.json();
  await savePageState(region_id, page, etag, lastMod, xPages);
  return { orders, xPages };
}

async function runOnce() {
  const start = Date.now();
  await markStarted();
  console.log(`[MARKET_WORKER]: station-only scrape ${new Date().toISOString()}`);
  let failedRegions = 0;
  for (const rid of REGIONS) {
    try {
      await fetchRegion(rid);
      console.log(`[MARKET_WORKER]: region ${rid} done`);
    } catch (e) {
      failedRegions += 1;
      console.error(`[MARKET_WORKER]: region ${rid} failed`, e);
      await markFailure(e, { durationMs: Date.now() - start });
    }
  }
  if (failedRegions > 0) {
    await markFailure(`${failedRegions}/${REGIONS.length} hub regions failed`, {
      durationMs: Date.now() - start,
    });
  } else {
    await markSuccess({
      durationMs: Date.now() - start,
      rows: REGIONS.length,
    });
  }
}

(async function main(){
  await runOnce();
  setInterval(runOnce, RUN_EVERY_MS);
})();
