/*
 * Express router for triff API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require('express');
const router = express.Router();

const CHAR_IDS = [2122253581, 2122255044, 2122618927, 1080567367, 2117469055, 2123365554, 2122255125];
const PAST_SECONDS = 7 * 24 * 60 * 60;
const UA = 'Triff.Tools Triff Tracker (+https://triff.tools)';

let DATA_CACHE = { ts: 0, data: null };
const DATA_TTL_MS = 5 * 60 * 1000;
const NAME_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TYPE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const KM_TTL_MS   = 30 * 24 * 60 * 60 * 1000;

const NAME_FALLBACKS = new Map([
  [2122253581, 'triffnixx'],
  [2122255044, 'triffnixxxx'],
  [2122618927, 'triffnixxxxx'],
  [1080567367, 'ShadowKnight2'],
  [2117469055, 'Triffnixxx'],
  [2123365554, 'bait not tackle'],
  [2122255125, 'triffnixxxxxx'],
]);

const NAME_CACHE = new Map();
const TYPE_CACHE = new Map();
const KM_CACHE   = new Map();

async function zget(path) {
  const url = `https://zkillboard.com/api/${path}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`zKill ${res.status} for ${path}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function esiGet(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`ESI ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function getCharacterName(id) {

  const c = NAME_CACHE.get(id);
  if (c && Date.now() - c.ts < NAME_TTL_MS) return c.name;

  if (NAME_FALLBACKS.has(id)) {
    const name = NAME_FALLBACKS.get(id);
    NAME_CACHE.set(id, { name, ts: Date.now() });
    return name;
  }

  try {
    const j = await esiGet(`https://esi.evetech.net/latest/characters/${id}/`);
    const name = j?.name || String(id);
    NAME_CACHE.set(id, { name, ts: Date.now() });
    return name;
  } catch {
    const fallback = String(id);
    NAME_CACHE.set(id, { name: fallback, ts: Date.now() });
    return fallback;
  }
}

async function getTypeName(typeId) {
  if (typeId == null) return null;
  const c = TYPE_CACHE.get(typeId);
  if (c && Date.now() - c.ts < TYPE_TTL_MS) return c.name;
  try {
    const j = await esiGet(`https://esi.evetech.net/latest/universe/types/${typeId}/`);
    const name = j?.name || `Type ${typeId}`;
    TYPE_CACHE.set(typeId, { name, ts: Date.now() });
    return name;
  } catch {
    const fallback = `Type ${typeId}`;
    TYPE_CACHE.set(typeId, { name: fallback, ts: Date.now() });
    return fallback;
  }
}

async function getKillmailDetails(id, hash) {
  const key = `${id}:${hash}`;
  const c = KM_CACHE.get(key);
  if (c && Date.now() - c.ts < KM_TTL_MS) return c.data;

  try {
    const j = await esiGet(`https://esi.evetech.net/latest/killmails/${id}/${hash}/`);
    const timeMs = Number.isFinite(Date.parse(j?.killmail_time)) ? Date.parse(j.killmail_time) : null;
    const shipTypeId = j?.victim?.ship_type_id ?? null;
    const data = { timeMs, shipTypeId };
    KM_CACHE.set(key, { data, ts: Date.now() });
    return data;
  } catch {
    const data = { timeMs: null, shipTypeId: null };
    KM_CACHE.set(key, { data, ts: Date.now() });
    return data;
  }
}

const iskValue = (k) => k?.zkb?.totalValue || 0;

function dedupeByKillmailId(arr) {
  const m = new Map();
  for (const k of arr || []) {
    const id = k?.killmail_id;
    if (id != null && !m.has(id)) m.set(id, k);
  }
  return [...m.values()];
}

async function runBatched(fns, limit = 6) {
  const results = Array(fns.length);
  let i = 0;
  const workers = Array(Math.min(limit, fns.length)).fill(0).map(async () => {
    while (i < fns.length) {
      const idx = i++;
      results[idx] = await fns[idx]();
    }
  });
  await Promise.all(workers);
  return results;
}

async function buildSnapshot() {
  const perChar = await Promise.all(
    CHAR_IDS.map(async (id) => {
      const [kills7d, losses7d, newestLossArr] = await Promise.all([
        zget(`kills/characterID/${id}/pastSeconds/${PAST_SECONDS}/`),
        zget(`losses/characterID/${id}/pastSeconds/${PAST_SECONDS}/`),
        zget(`losses/characterID/${id}/page/1/`),
      ]);
      const newestLoss = Array.isArray(newestLossArr) && newestLossArr.length ? newestLossArr[0] : null;
      return { id, kills7d, losses7d, newestLossRow: newestLoss };
    })
  );

  const killsZ  = dedupeByKillmailId(perChar.flatMap(c => c.kills7d  || []));
  const lossesZ = dedupeByKillmailId(perChar.flatMap(c => c.losses7d || []));

  const enrich = (r) => async () => {
    const det = await getKillmailDetails(r.killmail_id, r?.zkb?.hash);
    return { id: r.killmail_id, hash: r?.zkb?.hash, value: iskValue(r), timeMs: det.timeMs, shipTypeId: det.shipTypeId };
  };

  const [killsE, lossesE] = await Promise.all([
    runBatched(killsZ.map(enrich), 6),
    runBatched(lossesZ.map(enrich), 6),
  ]);

  const destroyedISK = killsZ .reduce((s, r) => s + iskValue(r), 0);
  const lostISK      = lossesZ.reduce((s, r) => s + iskValue(r), 0);
  const killsCount   = killsE.length;
  const lossesCount  = lossesE.length;
  const netISK       = destroyedISK - lostISK;
  const kd           = lossesCount === 0 ? (killsCount === 0 ? 0 : Infinity) : (killsCount / lossesCount);
  const status       = netISK >= 0 ? 'POSITIVE' : 'NEGATIVE';

  let lastDeathMs = Math.max(...lossesE.map(x => x.timeMs ?? -Infinity));
  if (!Number.isFinite(lastDeathMs) || lastDeathMs < 0) {
    const fallbackRows = perChar.map(c => c.newestLossRow).filter(Boolean);
    if (fallbackRows.length) {
      const times = await runBatched(
        fallbackRows.map(r => async () => (await getKillmailDetails(r.killmail_id, r?.zkb?.hash)).timeMs ?? -Infinity),
        4
      );
      lastDeathMs = Math.max(...times);
      if (!Number.isFinite(lastDeathMs) || lastDeathMs < 0) lastDeathMs = null;
    } else {
      lastDeathMs = null;
    }
  }

  const lastDeath = (lastDeathMs != null)
    ? { iso: new Date(lastDeathMs).toISOString(), daysSince: Math.floor((Date.now() - lastDeathMs) / (24*60*60*1000)) }
    : { iso: null, daysSince: null };

  const typeIds = new Set([
    ...killsE.map(x => x.shipTypeId).filter(v => v != null),
    ...lossesE.map(x => x.shipTypeId).filter(v => v != null),
  ]);
  const namePairs = await Promise.all([...typeIds].map(async id => [id, await getTypeName(id)]));
  const typeNameMap = new Map(namePairs);

  const toSlim = (x) => ({
    id: x.id,
    value: x.value,
    ship: x.shipTypeId != null ? { id: x.shipTypeId, name: typeNameMap.get(x.shipTypeId) || `Type ${x.shipTypeId}` } : null,
    url: `https://zkillboard.com/kill/${x.id}/`,
  });

  const byTimeDesc = (a, b) => (b.timeMs ?? 0) - (a.timeMs ?? 0);
  const killsList  = killsE .slice().sort(byTimeDesc).map(toSlim).slice(0, 50);
  const lossesList = lossesE.slice().sort(byTimeDesc).map(toSlim).slice(0, 50);

  const charactersDetailed = await Promise.all(
    CHAR_IDS.map(async (id) => ({ id, name: await getCharacterName(id), url: `https://zkillboard.com/character/${id}/` }))
  );

  return {
    characters: CHAR_IDS,
    charactersDetailed,
    lastDeath,
    last7d: { kills: killsCount, losses: lossesCount, destroyedISK, lostISK, netISK, kd, status },
    lists: { kills: killsList, losses: lossesList },
    meta: { fetchedAt: new Date().toISOString() },
  };
}

router.get('/', async (_req, res) => {
  try {
    const now = Date.now();
    if (DATA_CACHE.data && now - DATA_CACHE.ts < DATA_TTL_MS) {
      return res.json({ cached: true, ...DATA_CACHE.data });
    }
    const data = await buildSnapshot();
    DATA_CACHE = { ts: now, data };
    res.json({ cached: false, ...data });
  } catch (e) {
    console.error('[hokkar] error', e?.stack || e);
    res.status(502).json({ error: 'Failed to fetch Hokkar data.' });
  }
});

module.exports = router;
