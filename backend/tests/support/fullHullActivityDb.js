const fs = require('node:fs/promises');
const path = require('node:path');
const { createHullTestDb } = require('./hullActivityDb');
const { createHullActivityService } = require('../../services/hullActivity');

async function createFullHullActivityDb() {
  const cache = path.resolve(__dirname, '../../data/cache/hull-activity');
  const catalogue = JSON.parse(await fs.readFile(path.join(cache, 'catalogue.json'), 'utf8'));
  const history = JSON.parse(await fs.readFile(path.join(cache, 'history.json'), 'utf8'));
  const database = await createHullTestDb();
  await database.exec('TRUNCATE evesde."invTypes", evesde."invGroups", evesde."invCategories", evesde."mapRegions", market_history_daily');
  for (const [table, rows, fields] of [
    ['invCategories', catalogue.categories, `(r->>'id')::int, r->>'name'`],
    ['invGroups', catalogue.groups, `(r->>'id')::int, r->>'name', (r->>'category_id')::int`],
    ['invTypes', catalogue.types, `(r->>'id')::int, r->>'name', (r->>'group_id')::int, (r->>'published')::boolean, (r->>'market_group_id')::int`],
    ['invMarketGroups', catalogue.marketGroups, `(r->>'id')::int, r->>'name'`],
    ['mapRegions', catalogue.regions, `(r->>'id')::int, r->>'name'`],
  ]) {
    await database.query(`INSERT INTO evesde."${table}" SELECT ${fields} FROM jsonb_array_elements($1::jsonb) r`, [JSON.stringify(rows)]);
  }
  for (let offset = 0; offset < history.length; offset += 5000) {
    await database.query(`INSERT INTO market_history_daily
      SELECT (r->>'date')::date, (r->>'region_id')::int, (r->>'type_id')::int, (r->>'volume')::bigint
      FROM jsonb_array_elements($1::jsonb) r`, [JSON.stringify(history.slice(offset, offset + 5000))]);
  }
  await database.exec('ANALYZE');
  return { database, catalogue, history };
}

async function auditFullHullCoverage(database, catalogue, history) {
  const categories = new Set(catalogue.categories.filter((c) => c.name === 'Ship').map((c) => c.id));
  const groups = new Set(catalogue.groups.filter((g) => categories.has(g.category_id)).map((g) => g.id));
  const expected = catalogue.types.filter((t) => t.published && groups.has(t.group_id));
  let queries = 0;
  const service = createHullActivityService({ query: (...args) => { queries++; return database.query(...args); } });
  const activity = await service.getActivity();
  const returned = new Set(activity.hulls.map((h) => h.type_id));
  const expectedIds = new Set(expected.map((h) => h.id));
  const missing = expected.filter((h) => !returned.has(h.id));
  const unexpected = activity.hulls.filter((h) => !expectedIds.has(h.type_id));
  if (missing.length || unexpected.length || returned.size !== activity.hulls.length) throw new Error('Full SDE hull coverage mismatch');
  const dates = [...new Set(history.map((h) => h.date))].sort();
  const mathChecks = [];
  for (const date of [...new Set([activity.date, activity.available_dates[4] || activity.date])]) {
    const results = date === activity.date ? activity : await service.getActivity({ date });
    const selected = Date.parse(`${date}T00:00:00Z`);
    const totals = new Map(expected.map((h) => [h.id, { volume: 0, 7: 0, 30: 0, 365: 0, lastWeek: 0, previousMonth: 0 }]));
    for (const row of history) {
      if (row.region_id !== results.region_id) continue;
      const age = (selected - Date.parse(`${row.date}T00:00:00Z`)) / 86400000;
      const sums = totals.get(row.type_id);
      if (!sums) continue;
      if (age === 0) sums.volume += row.volume;
      for (const days of [7, 30, 365]) if (age >= 1 && age <= days) sums[days] += row.volume;
      if (age >= 0 && age < 7) sums.lastWeek += row.volume;
      if (age >= 7 && age < 37) sums.previousMonth += row.volume;
    }
    for (const hull of results.hulls) {
      const sums = totals.get(hull.type_id);
      if (hull.volume !== sums.volume) throw new Error(`Daily volume mismatch: ${hull.type_id}`);
      for (const days of [7, 30, 365]) {
        const average = sums[days] / days;
        const pct = average ? (sums.volume - average) / average * 100 : null;
        if (Math.abs(average - hull[`avg_${days}d`]) > 1e-9 || (pct === null ? hull[`vs_${days}d_pct`] !== null : Math.abs(pct - hull[`vs_${days}d_pct`]) > 1e-7)) {
          throw new Error(`Baseline mismatch: ${hull.type_id}, ${date}, ${days}`);
        }
      }
      const week = sums.lastWeek / 7;
      const month = sums.previousMonth / 30;
      const percent = month ? (week - month) / month * 100 : null;
      if (Math.abs(week - hull.avg_last_7d) > 1e-9 || Math.abs(month - hull.avg_prev_30d) > 1e-9
          || Math.abs(week - month - hull.delta_prev_30d) > 1e-9
          || (percent === null ? hull.vs_prev_30d_pct !== null : Math.abs(percent - hull.vs_prev_30d_pct) > 1e-7)) {
        throw new Error(`Weekly trend mismatch: ${hull.type_id}, ${date}`);
      }
    }
    mathChecks.push({ date, hullsChecked: results.hulls.length, dailyAndAllBaselinesMatch: true, weeklyTrendMatches: true });
  }
  const traded = new Set(history.map((h) => h.type_id));
  return {
    sdeSource: catalogue.source, sdeBuild: catalogue.build, sdeReleaseDate: catalogue.release_date,
    allSdeTypesLoaded: catalogue.types.length,
    expectedPublishedShipTypes: expected.length, returnedHullRows: activity.hulls.length,
    missing, unexpected, duplicateCount: activity.hulls.length - returned.size,
    queriesPerResult: queries / mathChecks.length,
    region: activity.region_name, selectedDate: activity.date,
    zeroVolumeOnSelectedDate: activity.hulls.filter((h) => h.volume === 0).length,
    hullsWithNoHistory: activity.hulls.filter((h) => !traded.has(h.type_id)).length,
    historyRows: history.length, historyDates: dates.length, oldestHistory: dates[0], newestHistory: dates.at(-1),
    availableDates: activity.available_dates, mathChecks,
    hulls: activity.hulls.map((h) => ({ type_id: h.type_id, type_name: h.type_name, group_name: h.group_name, volume: h.volume })),
  };
}

module.exports = { createFullHullActivityDb, auditFullHullCoverage };
