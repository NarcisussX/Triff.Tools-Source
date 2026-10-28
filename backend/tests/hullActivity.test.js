const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createHullTestDb } = require('./support/hullActivityDb');
const hullActivity = require('../services/hullActivity');
const { createHullRouter } = require('../routes/hulls');
const botEmbeds = require('../server/botEmbeds');

let database, service, server, base;
let queryCount = 0;
const originalActivity = hullActivity.getActivity;
test.before(async () => {
  database = await createHullTestDb();
  service = hullActivity.createHullActivityService({ query: (...args) => { queryCount++; return database.query(...args); } }, () => new Date('2026-09-16T01:00:00Z'));
  hullActivity.getActivity = service.getActivity;
  const app = express();
  app.use(botEmbeds);
  app.use('/api/hulls', createHullRouter(service));
  app.get('*', (_req, res) => res.send('React SPA'));
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  hullActivity.getActivity = originalActivity;
  if (server) await new Promise((resolve) => server.close(resolve));
  if (database) await database.close();
});

test('includes exactly published Ship types, with missing selected-day and never-traded hulls', async () => {
  const data = await service.getActivity();
  assert.deepEqual(data.hulls.map((h) => h.type_id).sort(), [1, 2, 3, 7]);
  assert.equal(data.hulls.find((h) => h.type_id === 2).volume, 0);
  assert.equal(data.hulls.find((h) => h.type_id === 3).volume, 0);
});

test('market classification is optional and does not drop hulls lacking a market listing', async () => {
  await database.exec(`INSERT INTO evesde."invMarketGroups" VALUES (42, 'ORE'); UPDATE evesde."invTypes" SET "marketGroupID" = 42 WHERE "typeID" = 1`);
  const data = await service.getActivity();
  assert.equal(data.hulls.find((h) => h.type_id === 1).market_group_name, 'ORE');
  assert.equal(data.hulls.find((h) => h.type_id === 3).market_group_name, null);
});

test('exact 7/30/365 boundaries, selected-day exclusion, and zero-volume missing calendar days', async () => {
  const hull = (await service.getActivity()).hulls.find((h) => h.type_id === 1);
  assert.equal(hull.volume, 7000);
  assert.equal(hull.avg_7d, 21 / 7);
  assert.equal(hull.avg_30d, 111 / 30);
  assert.equal(hull.avg_365d, 1206 / 365);
  for (const days of [7, 30, 365]) {
    assert.equal(hull[`delta_${days}d`], hull.volume - hull[`avg_${days}d`]);
    assert.equal(hull[`vs_${days}d_pct`], (hull.volume - hull[`avg_${days}d`]) / hull[`avg_${days}d`] * 100);
  }
});

test('all zero baselines yield null percentages for zero and positive daily volume', async () => {
  const data = await service.getActivity();
  for (const id of [3, 7]) for (const days of [7, 30, 365]) {
    const row = data.hulls.find((h) => h.type_id === id);
    assert.equal(row[`avg_${days}d`], 0);
    assert.equal(row[`vs_${days}d_pct`], null);
  }
  assert.equal(data.hulls.find((h) => h.type_id === 2).vs_7d_pct, -100);
  for (const id of [2, 3, 7]) {
    const row = data.hulls.find((h) => h.type_id === id);
    assert.equal(row.avg_prev_30d, 0);
    assert.equal(row.vs_prev_30d_pct, null);
  }
  assert.equal(data.hulls.find((h) => h.type_id === 7).avg_last_7d, 20 / 7);
});

test('weekly trend uses adjacent non-overlapping calendar windows, including selected day and exact boundaries', async () => {
  await database.exec('BEGIN');
  try {
    await database.exec(`
      INSERT INTO evesde."invTypes" VALUES (50, 'Weekly boundary hull', 1, true);
      INSERT INTO market_history_daily
        SELECT '2026-09-15'::date - age, 10000002, 50, volume
        FROM (VALUES (-1, 999999), (0, 14), (6, 28), (7, 30), (36, 60), (37, 999999)) sample(age, volume);
      INSERT INTO market_history_daily VALUES ('2026-09-15', 10000043, 50, 999999);
    `);
    const row = (await service.getActivity()).hulls.find((h) => h.type_id === 50);
    assert.equal(row.avg_last_7d, 42 / 7);
    assert.equal(row.avg_prev_30d, 90 / 30);
    assert.equal(row.delta_prev_30d, 3);
    assert.equal(row.vs_prev_30d_pct, 100);
    const historical = (await service.getActivity({ date: '2026-09-14' })).hulls.find((h) => h.type_id === 50);
    assert.equal(historical.avg_last_7d, 58 / 7);
    assert.equal(historical.avg_prev_30d, (60 + 999999) / 30);
    assert.equal(historical.vs_prev_30d_pct, (historical.avg_last_7d - historical.avg_prev_30d) / historical.avg_prev_30d * 100);
    const inactive = (await service.getActivity({ date: '2026-09-07' })).hulls.find((h) => h.type_id === 50);
    assert.equal(inactive.avg_last_7d, 0);
    assert.ok(inactive.avg_prev_30d > 0);
    assert.equal(inactive.vs_prev_30d_pct, -100);
  } finally {
    await database.exec('ROLLBACK');
  }
});

test('historical selection reconstructs windows and keeps regions isolated', async () => {
  const data = await service.getActivity({ date: '2026-09-08' });
  const row = data.hulls.find((h) => h.type_id === 1);
  assert.equal(row.volume, 14);
  assert.equal(row.avg_7d, 30 / 7);
  assert.equal(row.avg_30d, 455 / 30);
  assert.equal(row.avg_365d, (455 + 730 + 999999) / 365);
  const domain = await service.getActivity({ region_id: '10000043' });
  assert.equal(domain.region_name, 'Domain');
  assert.equal(domain.date, '2026-09-14');
  assert.equal(domain.hulls.find((h) => h.type_id === 1).volume, 10);
});

test('latest date excludes current UTC day; available_dates is the last 30 available complete dates', async () => {
  const data = await service.getActivity();
  assert.equal(data.date, '2026-09-15');
  assert.equal(data.available_dates.length, 30);
  assert.equal(data.available_dates[0], '2026-09-15');
  assert.equal(data.available_dates[29], '2026-08-17');
  const gap = await service.getActivity({ region_id: 10000043 });
  assert.deepEqual(gap.available_dates, ['2026-09-14', '2026-09-13']);
});

test('invalid region/date, future/current dates, unavailable dates, and empty region', async () => {
  for (const region_id of ['abc', '10000002junk', -1, 999, ['10000002'], '99999999999999']) {
    await assert.rejects(service.getActivity({ region_id }), { status: 400 });
  }
  for (const date of ['bad', '2026-02-30', '2026-9-1', '2026-09-16', '2027-01-01', ['2026-09-15']]) {
    await assert.rejects(service.getActivity({ date }), { status: 400 });
  }
  await assert.rejects(service.getActivity({ date: '2026-08-16' }), { status: 404 });
  assert.deepEqual(await service.getActivity({ region_id: 10000030 }), { region_id: 10000030, region_name: 'Heimatar', date: null, available_dates: [], hulls: [] });
});

test('one aggregate and constant query count regardless of hull count; default sort is descending with nulls last', async () => {
  await database.exec(`INSERT INTO evesde."invTypes" SELECT n, 'Extra hull ' || n, 1, true FROM generate_series(100, 600) n`);
  queryCount = 0;
  const data = await service.getActivity();
  assert.equal(queryCount, 3);
  assert.equal(data.hulls.length, 505);
  assert.equal(data.hulls[0].type_id, 1);
  assert.equal(data.hulls[1].type_id, 2);
  assert.ok(data.hulls.slice(2).every((h) => h.vs_30d_pct === null));
});

test('HTTP API success and validation use the common service', async () => {
  const response = await fetch(`${base}/api/hulls/activity?region_id=10000043&date=2026-09-13`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), await service.getActivity({ region_id: 10000043, date: '2026-09-13' }));
  assert.equal((await fetch(`${base}/api/hulls/activity?region_id=no`)).status, 400);
  assert.equal((await fetch(`${base}/api/hulls/activity?date=2020-01-01`)).status, 404);
  assert.equal((await (await fetch(`${base}/api/hulls/regions`)).json()).regions.length, 3);
});

async function embed(url) {
  const response = await fetch(`${base}${url}`, { headers: { 'user-agent': 'Discordbot/2.0' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  return response.text();
}

test('Discordbot receives dynamic OG data, summary card, and no nonfinite values', async () => {
  const html = await embed('/hulls');
  assert.match(html, /Hull Activity — The Forge — Sep 15, 2026/);
  assert.match(html, /Boundary hull — 7,000 vs 3.7\/day \(\+189089%\)/);
  assert.match(html, /Top 30d activity/);
  assert.match(html, /name="twitter:card" content="summary"/);
  assert.doesNotMatch(html, /NaN|Infinity|New hull —|Never traded —/);
});

test('historical Discord URL respects region and date and preserves all query parameters', async () => {
  const html = await embed('/hulls?region_id=10000043&date=2026-09-14&sort=volume&dir=asc&min_365d=0');
  assert.match(html, /Hull Activity — Domain — Sep 14, 2026/);
  assert.match(html, /Boundary hull — 10 vs 1.0\/day \(\+900%\)/);
  assert.match(html, /og:url" content="https:\/\/127.0.0.1:\d+\/hulls\?region_id=10000043&amp;date=2026-09-14&amp;sort=volume&amp;dir=asc/);
});

test('weekly Discord links use the shared weekly comparison and preserve the selected view/date', async () => {
  const html = await embed('/hulls?view=weekly&date=2026-09-08&min_365d=0');
  assert.match(html, /Hull Activity — The Forge — Sep 8, 2026/);
  assert.match(html, /7-day average \(ending on selected date\) vs the preceding 30-day average; no overlap/);
  assert.match(html, /Top 7-day trends/);
  assert.match(html, /Boundary hull — 6.3 vs 14.2\/day \(-56%\)/);
  assert.match(html, /view=weekly&amp;date=2026-09-08/);
  assert.doesNotMatch(html, /Top 30d activity|NaN|Infinity|New hull —|Never traded —/);
});

test('Discord highlights exclude rare purchases by default and respect the annual volume threshold', async () => {
  assert.doesNotMatch(await embed('/hulls?region_id=10000043'), /Boundary hull —/);
  assert.match(await embed('/hulls?region_id=10000043&min_365d=0'), /Boundary hull —/);
  assert.match(await embed('/hulls?region_id=10000043&min_365d=traded'), /Boundary hull —/);
  assert.doesNotMatch(await embed('/hulls?min_365d=25'), /Boundary hull —/);
  assert.match(await embed('/hulls?min_365d=bad'), /1y avg: ≥ 1\/day/);
});

test('normal browsers pass to SPA; bot API and static requests are unaffected', async () => {
  assert.equal(await (await fetch(`${base}/hulls`, { headers: { 'user-agent': 'Mozilla/5.0' } })).text(), 'React SPA');
  const api = await fetch(`${base}/api/hulls/activity`, { headers: { 'user-agent': 'Discordbot' } });
  assert.match(api.headers.get('content-type'), /application\/json/);
  assert.equal(await (await fetch(`${base}/assets/app.js`, { headers: { 'user-agent': 'Discordbot' } })).text(), 'React SPA');
});

test('bad, unavailable and empty states gracefully use static fallback, including service failures', async () => {
  for (const path of ['/hulls?region_id=bad', '/hulls?date=2020-01-01', '/hulls?date=2027-01-01', '/hulls?region_id=10000030']) {
    const html = await embed(path);
    assert.match(html, /Hull Activity – Triff.Tools/);
    assert.doesNotMatch(html, /NaN|Infinity|Top 30d activity/);
  }
  const original = hullActivity.getActivity;
  hullActivity.getActivity = async () => { throw new hullActivity.HullActivityError('Unavailable', 503); };
  try { assert.match(await embed('/hulls'), /Hull Activity – Triff.Tools/); }
  finally { hullActivity.getActivity = original; }
});
