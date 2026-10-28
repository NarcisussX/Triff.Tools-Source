/*
 * Background worker for market History Worker.
 * Runs polling or import loops using external EVE data sources and Postgres side effects.
 */

const { Pool } = require('pg');
const { spawn } = require('child_process');
const readline = require('readline');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { captureException, initSentry } = require('../lib/sentry');
const { markWorkerFailure, markWorkerStarted, markWorkerSuccess } = require('../lib/workerHeartbeat');

initSentry({ serviceName: "market-history-worker" });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.PGSSL === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
});

const WORKER_NAME = "market-history-worker";
// Raw storage includes room for historical selections plus a 365-day baseline.
const DAYS_BACK = 420;

const BATCH_SIZE = 1000;

function fmtDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function historyUrlForDate(dateStr) {
  const year = String(dateStr).slice(0, 4);
  return `https://data.everef.net/market-history/${year}/market-history-${dateStr}.csv.bz2`;
}

function parseHistoryCsvLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;

  const parts = trimmed.split(',');
  if (parts.length < 9) return null;

  const [
    average,
    d,
    highest,
    lowest,
    order_count,
    volume,
    _http_last_modified,
    region_id,
    type_id,
  ] = parts;

  const regionId = parseInt(region_id, 10);
  const typeId = parseInt(type_id, 10);
  if (!d || !Number.isFinite(regionId) || !Number.isFinite(typeId)) return null;

  return [
    d,
    regionId,
    typeId,
    lowest,
    highest,
    average,
    volume,
    order_count,
  ];
}

function relevantTotalsEntries(totals, todayInput = new Date()) {
  const today = new Date(todayInput);
  today.setUTCHours(0, 0, 0, 0);

  const oldestKept = new Date(today);
  oldestKept.setUTCDate(oldestKept.getUTCDate() - DAYS_BACK);

  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  return Object.entries(totals || {})
    .map(([dateStr, total]) => {
      const d = new Date(dateStr + 'T00:00:00Z');
      if (Number.isNaN(d.getTime()) || fmtDate(d) !== dateStr || !Number.isSafeInteger(Number(total)) || Number(total) < 0) return null;
      return { dateStr, date: d, total: Number(total) };
    })
    .filter(
      (e) =>
        e &&
        e.date >= oldestKept &&
        e.date <= yesterday
    )
    .sort((a, b) => a.date - b.date);
}

async function ensureHistoryTable(database = pool) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS market_history_daily (
      date        date          NOT NULL,
      region_id   integer       NOT NULL,
      type_id     integer       NOT NULL,
      low_price   numeric(18,2),
      high_price  numeric(18,2),
      avg_price   numeric(18,2),
      volume      bigint,
      orders      integer,
      PRIMARY KEY (date, region_id, type_id)
    );
  `);
}

async function bulkInsert(client, rows) {
  if (!rows.length) return;

  const values = [];
  const placeholders = [];

  rows.forEach((row, i) => {
    const offset = i * 8;
    placeholders.push(
      `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8})`
    );
    values.push(...row);
  });

  const sql = `
    INSERT INTO market_history_daily (
      date, region_id, type_id,
      low_price, high_price, avg_price,
      volume, orders
    )
    VALUES ${placeholders.join(',')}
    ON CONFLICT (date, region_id, type_id) DO UPDATE SET
      low_price  = EXCLUDED.low_price,
      high_price = EXCLUDED.high_price,
      avg_price  = EXCLUDED.avg_price,
      volume     = EXCLUDED.volume,
      orders     = EXCLUDED.orders
  `;

  await client.query(sql, values);
}

async function importDay(dateStr, force = false, expectedRows = null, {
  database = pool, fetchHistory = fetch, spawnDecompressor = spawn,
} = {}) {
  if (expectedRows === 0) {
    await database.query('DELETE FROM market_history_daily WHERE date = $1', [dateStr]);
    return true;
  }
  if (!force) {
    const existing = await database.query(
      'SELECT 1 FROM market_history_daily WHERE date = $1 LIMIT 1',
      [dateStr]
    );
    if (existing.rowCount > 0) {
      console.log(`[history] ${dateStr} already present, skipping`);
      return true;
    }
  }

  const url = historyUrlForDate(dateStr);

  console.log(`[history] fetching ${url}`);

  const res = await fetchHistory(url);

  if (res.status === 404) {
    console.log(`[history] no data for ${dateStr} (404)`);
    return expectedRows === null || expectedRows === 0;
  }

  if (!res.ok) {
    console.error(`[history] HTTP ${res.status} for ${url}`);
    return false;
  }

  if (!res.body) {
    console.error('[history] missing body for', url);
    return false;
  }

  const bunzip = spawnDecompressor('bunzip2', ['-c']);
  const nodeStream = Readable.fromWeb(res.body);

  let bunzipErrored = false;
  bunzip.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) {
      console.error('[history] bunzip2:', msg);
      bunzipErrored = true;
    }
  });
  bunzip.on('error', (err) => {
    console.error('[history] bunzip2 error', err);
    bunzipErrored = true;
  });
  const decompressed = new Promise((resolve) => {
    bunzip.on('close', (code) => resolve(code === 0 && !bunzipErrored));
    bunzip.on('error', () => resolve(false));
  });
  const inputFinished = pipeline(nodeStream, bunzip.stdin).then(() => true, (error) => {
    console.error('[history] download/decompression stream:', error.message);
    bunzipErrored = true;
    bunzip.kill();
    return false;
  });

  const rl = readline.createInterface({ input: bunzip.stdout });
  // Attach the iterator before awaiting a connection, so fast streams cannot
  // lose lines while BEGIN or pool acquisition is pending.
  const lines = rl[Symbol.asyncIterator]();

  const client = await database.connect();
  let buffer = [];
  let inserted = 0;
  let isHeader = true;

  try {
    await client.query('BEGIN');
    if (force) await client.query('DELETE FROM market_history_daily WHERE date = $1', [dateStr]);

    const flush = async () => {
      if (!buffer.length) return;
      await bulkInsert(client, buffer);
      inserted += buffer.length;
      buffer = [];
    };

    const insertRow = async (row) => {
      buffer.push(row);
      if (buffer.length >= BATCH_SIZE) {
        await flush();
      }
    };

    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (isHeader) {
        isHeader = false;
        continue;
      }

      const row = parseHistoryCsvLine(trimmed);
      if (!row) continue;
      await insertRow(row);
    }

    await flush();
    if (!(await decompressed) || !(await inputFinished)) throw new Error(`Decompression failed for ${dateStr}`);
    if (expectedRows !== null && inserted !== expectedRows) {
      throw new Error(`Incomplete history for ${dateStr}: expected ${expectedRows} rows, received ${inserted}`);
    }
    await client.query('COMMIT');

    console.log(`[history] imported ${dateStr} (${inserted} rows)`);
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[history] import failed for ${dateStr}`, err);
    captureException(err, { tags: { worker: WORKER_NAME, date: dateStr, phase: "import" } });
    await markWorkerFailure(database, WORKER_NAME, err);
    return false;
  } finally {
    client.release();
  }
}

function historyWindow(todayInput = new Date()) {
  const today = new Date(todayInput);
  today.setUTCHours(0, 0, 0, 0);
  const oldest = new Date(today);
  oldest.setUTCDate(oldest.getUTCDate() - DAYS_BACK);
  return { today: fmtDate(today), oldest: fmtDate(oldest) };
}

function planHistoryImports(counts, totals, todayInput = new Date()) {
  const { today, oldest } = historyWindow(todayInput);
  const existing = new Map(counts.map((r) => [r.date, Number(r.count)]));
  const expected = new Map(relevantTotalsEntries(totals, todayInput).map((r) => [r.dateStr, r.total]));
  const plan = [];
  for (let day = new Date(`${oldest}T00:00:00Z`); fmtDate(day) < today; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = fmtDate(day);
    const count = existing.get(date) || 0;
    const total = expected.get(date);
    if (total === undefined ? count === 0 : count !== total) {
      plan.push({ date, force: count > 0, expectedRows: total ?? null });
    }
  }
  return plan;
}

async function syncHistoryOnce({ database = pool, importDate = importDay, fetchTotals = fetch, now = new Date() } = {}) {
  console.log('[history] sync start');
  await ensureHistoryTable(database);
  let failedImports = 0;

  const today = new Date(now);
  let totals = {};

  try {
    const totalsRes = await fetchTotals(
      'https://data.everef.net/market-history/totals.json'
    );

    if (!totalsRes.ok) {
      console.warn(
        `[history] totals.json fetch failed with ${totalsRes.status}, skipping totals check`
      );
    } else {
      totals = await totalsRes.json();
    }
  } catch (err) {
    console.warn('[history] totals.json check failed, skipping', err);
  }

  const window = historyWindow(today);
  const { rows } = await database.query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, COUNT(*)::bigint AS count
     FROM market_history_daily WHERE date >= $1::date AND date < $2::date GROUP BY date`,
    [window.oldest, window.today]
  );
  // Scan the entire retention window, even if totals.json is unavailable. MAX(date)
  // alone would never discover the extra 55 days on an existing installation.
  for (const entry of planHistoryImports(rows, totals, today)) {
    const imported = await importDate(entry.date, entry.force, entry.expectedRows);
    if (!imported) failedImports += 1;
  }

  await database.query(
    `DELETE FROM market_history_daily
     WHERE date < $1::date`, [window.oldest]
  );

  console.log('[history] sync complete');
  if (failedImports > 0) {
    throw new Error(`${failedImports} market history day imports failed`);
  }
}

async function runOnce() {
  const start = Date.now();
  await markWorkerStarted(pool, WORKER_NAME);
  try {
    await syncHistoryOnce();
    await markWorkerSuccess(pool, WORKER_NAME, {
      durationMs: Date.now() - start,
    });
  } catch (err) {
    console.error('[history] sync error', err);
    captureException(err, { tags: { worker: WORKER_NAME, phase: "sync" } });
    await markWorkerFailure(pool, WORKER_NAME, err, { durationMs: Date.now() - start });
  }
}

const SIX_HOURS = 6 * 60 * 60 * 1000;

function startScheduledWorker() {
  runOnce().catch((err) => {
    console.error('[history] fatal during initial run', err);
    captureException(err, { tags: { worker: WORKER_NAME, phase: "fatal" } });
    process.exit(1);
  });

  return setInterval(() => {
    runOnce().catch((err) => {
      console.error('[history] sync error in scheduled run', err);
      captureException(err, { tags: { worker: WORKER_NAME, phase: "scheduled" } });
    });
  }, SIX_HOURS);
}

if (require.main === module) {
  startScheduledWorker();
}

module.exports = {
  DAYS_BACK,
  fmtDate,
  historyUrlForDate,
  parseHistoryCsvLine,
  relevantTotalsEntries,
  historyWindow,
  planHistoryImports,
  ensureHistoryTable,
  importDay,
  syncHistoryOnce,
  runOnce,
  startScheduledWorker,
};
