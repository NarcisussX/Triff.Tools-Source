/*
 * Backend library module for price Cache.
 * Provides shared data loading, pricing, or planning helpers used by API routes and jobs.
 */

const db = require('../db');

const STATION = process.env.MARKET_STATION || 'Jita';
const REFRESH_MS = Number(process.env.PRICECACHE_REFRESH_MS || 5 * 60 * 1000);

let prices = new Map();
let lastAt = 0;
let loggedInitialLoad = false;
let lastRefreshFailed = false;

async function refresh() {
    try {
        const next = new Map();
        const stationId = Number(process.env.MARKET_STATION_ID || 60003760);
        let usedAggregates = false;
        try {
            const { rows } = await db.query(
                'SELECT type_id, sell_min, buy_max, sell_5pct, buy_5pct FROM market_station_aggregates WHERE station_id = $1',
                [stationId]
            );
            if (rows && rows.length) {
                usedAggregates = true;
                for (const r of rows) {
                    const id = Number(r.type_id);
                    if (!id) continue;

                    const sell_min = Number(r.sell_min) || 0;
                    const buy_max = Number(r.buy_max) || 0;
                    const sell_5pct = Number(r.sell_5pct) || 0;
                    const buy_5pct = Number(r.buy_5pct) || 0;

                    next.set(id, {
                        sell_min,
                        buy_max,
                        sell_5pct,
                        buy_5pct,
                    });
                }
            }

        } catch {
            usedAggregates = false;
        }
        if (!usedAggregates) {
            const { rows } = await db.query(
                'SELECT type_id, avg_price, sell_price, buy_price FROM market_prices WHERE station = $1',
                [STATION]
            );
            for (const r of rows) {
                const id = Number(r.type_id);
                if (!id) continue;
                next.set(id, {
                    sell: Number(r.sell_price) || 0,
                    buy: Number(r.buy_price) || 0,
                    avg: Number(r.avg_price) || 0,
                });
            }
        }

        prices = next;
        lastAt = Date.now();
        if (!loggedInitialLoad || lastRefreshFailed) {
            console.log(
                `[priceCache] Loaded ${prices.size} prices (${usedAggregates ? '5% agg' : 'legacy'})`
            );
            loggedInitialLoad = true;
        }
        lastRefreshFailed = false;
    } catch (err) {
        lastRefreshFailed = true;
        console.error('[priceCache] refresh failed:', err.message);
    }
}

function start() {
    refresh();
    setInterval(refresh, REFRESH_MS);
}

function getPrice(typeId, mode = 'sell') {
  const p = prices.get(Number(typeId));
  if (!p) return 0;

  if (
    'sell_min' in p ||
    'buy_max' in p ||
    'sell_5pct' in p ||
    'buy_5pct' in p
  ) {
    const sell_min = p.sell_min || 0;
    const buy_max = p.buy_max || 0;
    const sell_5pct = p.sell_5pct || 0;
    const buy_5pct = p.buy_5pct || 0;

    switch (mode) {
      case 'sell_min':
      case 'sell':
        return sell_min || sell_5pct || buy_max || buy_5pct || 0;

      case 'buy_max':
      case 'buy':
        return buy_max || buy_5pct || sell_min || sell_5pct || 0;

      case 'sell_5pct':
        return sell_5pct || sell_min || buy_max || buy_5pct || 0;

      case 'buy_5pct':
        return buy_5pct || buy_max || sell_min || sell_5pct || 0;

      default:

        return sell_min || sell_5pct || buy_max || buy_5pct || 0;
    }
  }

  const sell = p.sell || 0;
  const buy = p.buy || 0;
  const avg = p.avg || 0;

  switch (mode) {
    case 'buy':
    case 'buy_max':
    case 'buy_5pct':
      return buy || sell || avg || 0;
    case 'sell':
    case 'sell_min':
    case 'sell_5pct':
    default:
      return sell || buy || avg || 0;
  }
}
function getStats() {
  return {
    size: prices.size,
    lastAt,
  };
}

module.exports = { start, getPrice, getStats };
