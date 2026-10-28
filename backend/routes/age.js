const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  recordObservation,
  enrichDefenderForObservation,
} = require('../services/structureObservations');
const {
  withStructureAgeCheck,
  reloadStructureAgeIndexExclusive,
} = require('../services/structureAgeGate');

let AGE_IDS = [];
let AGE_EPOCHS = [];
let LOADED = false;
const checkWindows = new Map();

const CHECK_RATE_WINDOW_MS = Math.max(
  60_000,
  Number(process.env.STRUCTURE_CHECK_RATE_WINDOW_MS) || 10 * 60 * 1000
);
const CHECK_RATE_MAX = Math.max(10, Number(process.env.STRUCTURE_CHECK_RATE_MAX) || 120);

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function privateProxyAddress(value) {
  const address = String(value || '').replace(/^::ffff:/, '').toLowerCase();
  if (address === '127.0.0.1' || address === '::1') return true;
  if (address.startsWith('10.') || address.startsWith('192.168.')) return true;
  const match = address.match(/^172\.(\d{1,3})\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return address.startsWith('fc') || address.startsWith('fd');
}

function checkClientKey(req) {
  const remote = String(req.socket?.remoteAddress || req.ip || '').slice(0, 128);
  if (!privateProxyAddress(remote)) return remote || 'unknown';
  const forwardedChain = String(req.get?.('x-forwarded-for') || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const forwarded = [...forwardedChain].reverse().find(value => !privateProxyAddress(value))
    || forwardedChain[forwardedChain.length - 1]
    || '';
  const real = String(req.get?.('x-real-ip') || '').trim();
  return (forwarded || real || remote || 'unknown').slice(0, 128);
}

function consumeCheckRate(req, now = Date.now()) {
  const key = checkClientKey(req);
  const current = checkWindows.get(key);
  if (!current || now - current.startedAt >= CHECK_RATE_WINDOW_MS) {
    checkWindows.set(key, { startedAt: now, count: 1 });
  } else if (current.count >= CHECK_RATE_MAX) {
    return false;
  } else {
    current.count += 1;
  }

  if (checkWindows.size > 5_000) {
    for (const [entryKey, window] of checkWindows) {
      if (now - window.startedAt >= CHECK_RATE_WINDOW_MS) checkWindows.delete(entryKey);
    }
  }
  return true;
}

function isTrustedCheckRequest(req) {
  const fetchSite = String(req.get?.('sec-fetch-site') || '').trim().toLowerCase();
  if (fetchSite === 'cross-site') return false;

  const origin = String(req.get?.('origin') || '').trim();
  if (!origin) return true;
  try {
    const host = String(req.get?.('host') || '').trim().toLowerCase();
    return Boolean(host) && new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function loadAgeCSV(p) {
  const text = fs.readFileSync(p, 'utf8').trim();
  const lines = text.split(/\r?\n/);
  const start = /^\d+$/.test(lines[0]?.split(',')[0]) ? 0 : 1;

  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const [idStr, iso] = lines[i].split(',');
    if (!idStr || !iso) continue;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    rows.push({ id: BigInt(idStr.trim()), ts: Math.floor(t / 1000) });
  }

  rows.sort((a, b) => (a.id < b.id ? -1 : 1));
  if (rows.length < 2) {
    throw new Error('Age index must contain at least two valid reference rows');
  }
  AGE_IDS = rows.map(r => r.id);
  AGE_EPOCHS = rows.map(r => r.ts);

  console.log(`[structure-intel/age] Loaded ${rows.length} rows from ${p}`);
}

function bsearchBigInt(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function estimateAgeRange(structIdBigInt) {
  if (!AGE_IDS.length) return null;
  const i = bsearchBigInt(AGE_IDS, structIdBigInt);

  if (i < AGE_IDS.length && AGE_IDS[i] === structIdBigInt) {
    const ts = AGE_EPOCHS[i];
    const padDays = 3;
    const low = ts - padDays * 86400;
    const high = ts + padDays * 86400;
    return { method: 'exact', ts, low, high };
  }

  const hasLo = i > 0;
  const hasHi = i < AGE_IDS.length;
  if (!hasLo && !hasHi) return null;

  if (!hasLo || !hasHi) {
    const aIdx = hasLo ? AGE_IDS.length - 2 : 0;
    const bIdx = hasLo ? AGE_IDS.length - 1 : 1;
    const did = Number(AGE_IDS[bIdx] - AGE_IDS[aIdx]);
    const dts = AGE_EPOCHS[bIdx] - AGE_EPOCHS[aIdx];
    const slope = did ? (dts / did) : 0;
    const base = hasLo ? AGE_EPOCHS[bIdx] : AGE_EPOCHS[aIdx];
    const off = Number(structIdBigInt - (hasLo ? AGE_IDS[bIdx] : AGE_IDS[aIdx]));
    const ts = Math.round(base + slope * off);
    const pad = 7 * 86400;
    return { method: hasLo ? 'extrapolate-tail' : 'extrapolate-head', ts, low: ts - pad, high: ts + pad };
  }

  const loId = AGE_IDS[i - 1], hiId = AGE_IDS[i];
  const loTs = AGE_EPOCHS[i - 1], hiTs = AGE_EPOCHS[i];

  const did = Number(hiId - loId);
  const alpha = did ? Number(structIdBigInt - loId) / did : 0.5;
  const ts = Math.round(loTs + alpha * (hiTs - loTs));

  const gap = Math.abs(hiTs - loTs);
  const half = Math.round(gap * 0.25);
  const pad = clamp(half, 2 * 86400, 7 * 86400);

  return { method: 'interpolate', ts, low: ts - pad, high: ts + pad };
}

function resolveDefaultCsvPath() {
  return (
    process.env.A4E_AGE_CSV ||
    path.join(__dirname, '..', 'data', 'a4e_first_seen_monotone.csv')
  );
}

function ensureLoaded(csvPath) {
  if (LOADED) return;

  const p = csvPath || resolveDefaultCsvPath();
  try {
    loadAgeCSV(p);
  } catch (e) {
    console.warn(`[structure-intel/age] Failed to load ${p}: ${e.message}`);
  }

  LOADED = true;
}

function ageResponse(structureId, range) {
  const toISO = value => new Date(value * 1000).toISOString();
  return {
    id: structureId,
    method: range.method,
    midISO: toISO(range.ts),
    lowISO: toISO(range.low),
    highISO: toISO(range.high),
    daysWide: ((range.high - range.low) / 86400).toFixed(1),
  };
}

function estimateResponse(rawId) {
  const raw = String(rawId || '').trim();
  if (!/^\d{10,19}$/.test(raw)) return { status: 400, error: 'Invalid structure ID' };
  const structureId = BigInt(raw);
  if (structureId <= 0n || structureId > 9223372036854775807n) {
    return { status: 400, error: 'Invalid structure ID' };
  }
  if (!AGE_IDS.length) return { status: 503, error: 'Age index not loaded' };

  const range = estimateAgeRange(structureId);
  if (!range) return { status: 404, error: 'Not estimable' };
  return { status: 200, data: ageResponse(raw, range) };
}

function createAgeRouter(opts = {}) {
  ensureLoaded(opts.csvPath);
  const r = express.Router();

  // Keep the legacy endpoint compatible, but still count it as a successful
  // observation. Older clients do not supply J-code/type/corporation metadata.
  r.get('/age/:id', async (req, res) => {
    if (!isTrustedCheckRequest(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!consumeCheckRate(req)) {
      res.set('Retry-After', String(Math.ceil(CHECK_RATE_WINDOW_MS / 1000)));
      return res.status(429).json({ error: 'Too many structure checks. Try again shortly.' });
    }
    return withStructureAgeCheck(async () => {
      const result = estimateResponse(req.params.id);
      if (!result.data) return res.status(result.status).json({ error: result.error });
      try {
        await recordObservation({
          structureId: result.data.id,
          method: result.data.method,
          midISO: result.data.midISO,
          lowISO: result.data.lowISO,
          highISO: result.data.highISO,
          daysWide: result.data.daysWide,
        });
        res.set('Cache-Control', 'no-store');
        return res.json(result.data);
      } catch (error) {
        console.error('[structure-intel/age] observation persistence failed:', error);
        return res.status(503).json({ error: 'Structure check temporarily unavailable' });
      }
    });
  });

  // The page uses this unified endpoint so every successful public or signed-in
  // check is persisted before its age result is returned. The observation store
  // receives normalized fields only; it never receives the original pasted text.
  r.post('/check', async (req, res) => {
    if (!isTrustedCheckRequest(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!consumeCheckRate(req)) {
      res.set('Retry-After', String(Math.ceil(CHECK_RATE_WINDOW_MS / 1000)));
      return res.status(429).json({ error: 'Too many structure checks. Try again shortly.' });
    }
    const typeId = req.body?.typeId == null || req.body.typeId === ''
      ? null
      : Number(req.body.typeId);
    if (typeId !== null && (!Number.isInteger(typeId) || typeId < 1 || typeId > 2147483647)) {
      return res.status(400).json({ error: 'Invalid structure type ID' });
    }

    const rawJcode = typeof req.body?.jcode === 'string' ? req.body.jcode.trim().toUpperCase() : '';
    if (rawJcode && !/^J\d{6}$/.test(rawJcode)) {
      return res.status(400).json({ error: 'Invalid wormhole system' });
    }

    const corpName = typeof req.body?.corpName === 'string'
      ? req.body.corpName.trim().slice(0, 255)
      : null;

    return withStructureAgeCheck(async () => {
      const result = estimateResponse(req.body?.structureId);
      if (!result.data) return res.status(result.status).json({ error: result.error });
      try {
        const observation = await recordObservation({
          structureId: result.data.id,
          typeId,
          jcode: rawJcode || null,
          corpName: corpName || null,
          method: result.data.method,
          midISO: result.data.midISO,
          lowISO: result.data.lowISO,
          highISO: result.data.highISO,
          daysWide: result.data.daysWide,
        });
        if (corpName) {
          void enrichDefenderForObservation(observation.observationId, corpName).catch((error) => {
            console.warn('[structure-intel/check] defender enrichment failed:', error?.message || error);
          });
        }
        res.set('Cache-Control', 'no-store');
        return res.json(result.data);
      } catch (error) {
        console.error('[structure-intel/check] observation persistence failed:', error);
        return res.status(503).json({ error: 'Structure check temporarily unavailable' });
      }
    });
  });

  return r;
}

function reloadAgeIndex(csvPath) {
  loadAgeCSV(csvPath || resolveDefaultCsvPath());
  LOADED = true;
}

function reloadAgeIndexExclusive(csvPath) {
  return reloadStructureAgeIndexExclusive(() => reloadAgeIndex(csvPath));
}

createAgeRouter.reloadAgeIndex = reloadAgeIndex;
createAgeRouter.reloadAgeIndexExclusive = reloadAgeIndexExclusive;
// Production callers (notably the private maintenance job) use the same
// estimator as public structure checks after explicitly reloading the index.
createAgeRouter.estimateStructureAge = estimateResponse;
createAgeRouter._test = {
  ageResponse,
  estimateResponse,
  privateProxyAddress,
  checkClientKey,
  consumeCheckRate,
  isTrustedCheckRequest,
};
module.exports = createAgeRouter;
