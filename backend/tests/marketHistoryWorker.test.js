const test = require("node:test");
const assert = require("node:assert/strict");
const { installExternalModuleFallbacks } = require("./helpers/moduleStubs");

installExternalModuleFallbacks();
const historyWorker = require("../workers/marketHistoryWorker");

test("market history date and URL helpers stay UTC and Everef-shaped", () => {
  assert.equal(historyWorker.fmtDate(new Date("2026-05-21T23:59:59.000Z")), "2026-05-21");
  assert.equal(
    historyWorker.historyUrlForDate("2026-05-20"),
    "https://data.everef.net/market-history/2026/market-history-2026-05-20.csv.bz2"
  );
});

test("market history CSV rows map to database row order", () => {
  const row = historyWorker.parseHistoryCsvLine(
    "123.45,2026-05-20,140.00,100.00,42,987654,Wed 20 May 2026 00:00:00 GMT,10000002,34"
  );

  assert.deepEqual(row, [
    "2026-05-20",
    10000002,
    34,
    "100.00",
    "140.00",
    "123.45",
    "987654",
    "42",
  ]);

  assert.equal(historyWorker.parseHistoryCsvLine("average,date,highest,lowest,order_count,volume,http_last_modified,region_id,type_id"), null);
  assert.equal(historyWorker.parseHistoryCsvLine(""), null);
  assert.equal(historyWorker.parseHistoryCsvLine("1,2026-05-20,2"), null);
});

test("totals entries include exactly the 420 complete UTC day retention window", () => {
  assert.equal(historyWorker.DAYS_BACK, 420);
  const entries = historyWorker.relevantTotalsEntries({
    "2025-03-26": 10,
    "2025-03-27": "20",
    "2026-05-20": 30,
    "2026-05-21": 40,
    "bad-date": 50,
  }, new Date("2026-05-21T12:00:00.000Z"));

  assert.deepEqual(entries.map((entry) => [entry.dateStr, entry.total]), [
    ["2025-03-27", 20],
    ["2026-05-20", 30],
  ]);
});

function completeCounts(days = 365) {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date('2026-09-16T00:00:00Z');
    date.setUTCDate(date.getUTCDate() - i - 1);
    return { date: historyWorker.fmtDate(date), count: 10 };
  });
}

test('initial backfill plans all 420 completed days and never imports today', () => {
  const plan = historyWorker.planHistoryImports([], {}, '2026-09-16T23:59:00Z');
  assert.equal(plan.length, 420);
  assert.equal(plan[0].date, historyWorker.historyWindow('2026-09-16').oldest);
  assert.equal(plan.at(-1).date, '2026-09-15');
});

test('deployment on a 365-day installation discovers all 55 older days even without totals', () => {
  const counts = completeCounts();
  const plan = historyWorker.planHistoryImports(counts, {}, '2026-09-16');
  assert.equal(plan.length, 55);
  assert.equal(plan.at(-1).date, '2025-09-15');
  assert.ok(plan.every((entry) => !entry.force && entry.expectedRows === null));
});

test('totals repair partial days, skip complete/known-empty days, and include extended history', () => {
  const counts = completeCounts(420);
  const totals = Object.fromEntries(counts.map((r) => [r.date, 10]));
  totals[counts[0].date] = 12;
  counts.pop();
  const plan = historyWorker.planHistoryImports(counts, totals, '2026-09-16');
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.at(-1), { date: '2026-09-15', force: true, expectedRows: 12 });
  assert.equal(plan[0].expectedRows, 10);
  totals[plan[0].date] = 0;
  assert.equal(historyWorker.planHistoryImports(counts, totals, '2026-09-16').length, 1);
});

test('actual sync imports extended dates with totals unavailable and deletes only beyond the 420-day boundary', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const database = new PGlite();
  try {
    await historyWorker.ensureHistoryTable(database);
    const boundary = historyWorker.historyWindow('2026-09-16').oldest;
    await database.query(`INSERT INTO market_history_daily (date,region_id,type_id,volume)
      SELECT '2026-09-16'::date - n, 10000002, 1, 10 FROM generate_series(1,365) n`);
    await database.query(`INSERT INTO market_history_daily (date,region_id,type_id,volume) VALUES ($1::date - 1,10000002,1,10)`, [boundary]);
    const imported = [];
    await historyWorker.syncHistoryOnce({
      database, now: new Date('2026-09-16T01:00:00Z'),
      fetchTotals: async () => ({ ok: false, status: 503 }),
      importDate: async (date) => {
        imported.push(date);
        await database.query('INSERT INTO market_history_daily (date,region_id,type_id,volume) VALUES ($1,10000002,1,10)', [date]);
        return true;
      },
    });
    assert.equal(imported.length, 55);
    const result = (await database.query(`SELECT count(*)::int AS count, to_char(min(date),'YYYY-MM-DD') AS oldest, to_char(max(date),'YYYY-MM-DD') AS newest FROM market_history_daily`)).rows[0];
    assert.deepEqual(result, { count: 420, oldest: boundary, newest: '2026-09-15' });
  } finally { await database.close(); }
});

test('reimport commits only complete downloads and rolls back truncated/decompression failures', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const { EventEmitter } = require('node:events');
  const { Readable, PassThrough, Writable } = require('node:stream');
  const pg = new PGlite();
  const database = {
    query: (...args) => pg.query(...args),
    connect: async () => ({ query: (...args) => pg.query(...args), release() {} }),
  };
  const csv = 'average,date,highest,lowest,order_count,volume,http_last_modified,region_id,type_id\n1,2026-09-15,1,1,1,99,x,10000002,1\n';
  const fetchHistory = async () => ({ ok: true, status: 200, body: Readable.toWeb(Readable.from(['test compressed stream'])) });
  function decompressor(exitCode) {
    return () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({
        write(_chunk, _encoding, callback) { callback(); },
        final(callback) {
          child.stdout.end(csv);
          callback();
          setImmediate(() => child.emit('close', exitCode));
        },
      });
      child.kill = () => { child.stdout.end(); child.emit('close', 1); };
      return child;
    };
  }
  try {
    await historyWorker.ensureHistoryTable(database);
    await database.query(`INSERT INTO market_history_daily (date,region_id,type_id,volume) VALUES ('2026-09-15',10000002,1,42)`);
    for (const [expectedRows, exitCode] of [[2, 0], [1, 1]]) {
      assert.equal(await historyWorker.importDay('2026-09-15', true, expectedRows, { database, fetchHistory, spawnDecompressor: decompressor(exitCode) }), false);
      assert.equal(Number((await database.query('SELECT volume FROM market_history_daily')).rows[0].volume), 42);
    }
    assert.equal(await historyWorker.importDay('2026-09-15', true, 1, { database, fetchHistory, spawnDecompressor: decompressor(0) }), true);
    assert.equal(Number((await database.query('SELECT volume FROM market_history_daily')).rows[0].volume), 99);
    assert.equal(await historyWorker.importDay('2026-09-15', true, 0, { database, fetchHistory: () => { throw new Error('Must not fetch a known empty day'); } }), true);
    assert.equal((await database.query('SELECT * FROM market_history_daily')).rows.length, 0);
  } finally { await pg.close(); }
});
