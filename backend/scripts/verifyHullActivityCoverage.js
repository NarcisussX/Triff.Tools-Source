/* Read-only source audit. Downloads the official SDE into an ignored local cache.
 * Does not connect to or modify the deployment database.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const unzipper = require('unzipper');

const cache = path.resolve(__dirname, '../data/cache/hull-activity');
const source = 'https://developers.eveonline.com/static-data/';

async function main() {
  await fsp.mkdir(cache, { recursive: true });
  const metaResponse = await fetch(`${source}tranquility/latest.jsonl`);
  if (!metaResponse.ok) throw new Error(`SDE metadata HTTP ${metaResponse.status}`);
  const meta = JSON.parse((await metaResponse.text()).trim());
  const url = `${source}eve-online-static-data-latest-jsonl.zip`;
  const archive = path.join(cache, `sde-${meta.buildNumber}.zip`);
  if (!fs.existsSync(archive)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`SDE archive HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(`${archive}.part`));
    await fsp.rename(`${archive}.part`, archive);
  }
  const zip = await unzipper.Open.file(archive);
  const tables = {};
  for (const name of ['categories', 'groups', 'types', 'mapRegions', 'marketGroups']) {
    const file = zip.files.find((entry) => entry.path === `${name}.jsonl`);
    if (!file) throw new Error(`SDE missing ${name}.jsonl`);
    tables[name] = (await file.buffer()).toString('utf8').trim().split('\n').map((line) => JSON.parse(line));
    console.log(name, tables[name].length, JSON.stringify(tables[name][0]).slice(0, 200));
  }
  const catalogue = {
    source: url, build: meta.buildNumber, release_date: meta.releaseDate,
    categories: tables.categories.map((r) => ({ id: r._key, name: r.name.en })),
    groups: tables.groups.map((r) => ({ id: r._key, name: r.name.en, category_id: r.categoryID })),
    types: tables.types.map((r) => ({ id: r._key, name: r.name.en, group_id: r.groupID, published: r.published === true, market_group_id: r.marketGroupID ?? null })),
    marketGroups: tables.marketGroups.map((r) => ({ id: r._key, name: r.name.en })),
    regions: tables.mapRegions.map((r) => ({ id: r._key, name: r.name.en })),
  };
  const shipCategories = new Set(catalogue.categories.filter((r) => r.name === 'Ship').map((r) => r.id));
  const shipGroups = new Set(catalogue.groups.filter((r) => shipCategories.has(r.category_id)).map((r) => r.id));
  const hulls = catalogue.types.filter((r) => r.published && shipGroups.has(r.group_id));
  await fsp.writeFile(path.join(cache, 'catalogue.json'), JSON.stringify(catalogue));
  await fsp.writeFile(path.join(cache, 'hulls.json'), JSON.stringify(hulls));
  console.log(JSON.stringify({ build: catalogue.build, totalTypes: catalogue.types.length, publishedShipHulls: hulls.length, groups: shipGroups.size }));
  if (process.argv.includes('--history')) {
    const history = [];
    for (let offset = 0; offset < hulls.length; offset += 50) {
      const ids = hulls.slice(offset, offset + 50).map((h) => h.id).join(',');
      const response = await fetch(`https://www.triff.tools/api/market/history/batch?region_id=10000002&type_ids=${ids}`, {
        headers: { 'user-agent': 'TriffTools-HullActivity-QA/1.0 (+https://www.triff.tools)' },
      });
      if (!response.ok) throw new Error(`Public market history HTTP ${response.status}`);
      const payload = await response.json();
      for (const rows of Object.values(payload.data)) for (const row of rows) {
        history.push({ date: row.date.slice(0, 10), region_id: Number(row.region_id), type_id: Number(row.type_id), volume: Number(row.volume) });
      }
      console.log(`Real history fetched for ${Math.min(offset + 50, hulls.length)}/${hulls.length} hull IDs`);
    }
    await fsp.writeFile(path.join(cache, 'history.json'), JSON.stringify(history));
    console.log(`Saved ${history.length} real regional history rows`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
