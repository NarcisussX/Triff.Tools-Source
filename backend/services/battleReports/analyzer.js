/*
 * Backend service module for analyzer.
 * Coordinates database records, external EVE data, or derived results for route handlers.
 */

const axios = require("axios");
const crypto = require("crypto");
const { pool } = require("../../db");
const {
  upsertKillmailCache,
  getCachedKillmail,
  getCachedBySystemWindow,
  readZkbTotal,
} = require("./db");

const UA = process.env.BR_USER_AGENT || "Triff.Tools Battle Reports (+https://triff.tools)";
const ESI = "https://esi.evetech.net/latest";
const ZKILL = "https://zkillboard.com";
const EVEKILL = process.env.BR_EVEKILL_API || "https://api.eve-kill.com";
const R2Z2_HISTORY = "https://r2z2.zkillboard.com/history";
const EVEKILL_WEB = process.env.BR_EVEKILL_WEB || "https://eve-kill.com";
const EXCLUDED_SIDE_ID = "side_excluded";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const MIN_PLAUSIBLE_KILLMAIL_ID = Number(process.env.BR_MIN_KILLMAIL_ID || 1000000);
const HASH_RE = /^[a-f0-9]{20,}$/i;

function isPlausibleKillmailId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= MIN_PLAUSIBLE_KILLMAIL_ID;
}

function looksLikeHash(value) {
  return typeof value === "string" && HASH_RE.test(value.trim());
}

function isExcludedSideValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === EXCLUDED_SIDE_ID || normalized === "excluded" || normalized === "__excluded";
}

function isAssignableSideOverride(value) {
  const normalized = String(value || "");
  return normalized.startsWith("side_") && !isExcludedSideValue(normalized);
}

function randomId() {
  return crypto.randomBytes(7).toString("base64url");
}

function isoDateOnly(d) {
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}

function utcDayList(start, end) {
  const days = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= last) {
    days.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function monthList(start, end) {
  const months = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    months.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

async function getJson(url, opts = {}) {
  const res = await axios.get(url, {
    timeout: opts.timeout || 30000,
    validateStatus: () => true,
    headers: {
      "User-Agent": UA,
      "Accept-Encoding": "gzip",
      Accept: "application/json",
      ...(opts.headers || {}),
    },
  });

  if (res.status === 404) return null;
  if (res.status === 429) {
    const attempt = Number(opts.attempt || 0);
    if (attempt >= Number(process.env.BR_UPSTREAM_MAX_RETRIES || 6)) {
      throw new Error(`GET ${url} failed: HTTP 429 after ${attempt} retries`);
    }
    await sleep(opts.retryDelay || 1500);
    return getJson(url, {
      ...opts,
      attempt: attempt + 1,
      retryDelay: Math.min((opts.retryDelay || 1500) * 2, 10000),
    });
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  }
  if (typeof res.data === "string" && res.data.trim().startsWith("<")) {
    throw new Error(`GET ${url} returned HTML instead of JSON. This is usually a proxy, Cloudflare, or upstream timeout response.`);
  }
  return res.data;
}

async function postJson(url, body, opts = {}) {
  const res = await axios.post(url, body, {
    timeout: opts.timeout || 30000,
    validateStatus: () => true,
    headers: {
      "User-Agent": UA,
      "Accept-Encoding": "gzip",
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });

  if (res.status === 404) return null;
  if (res.status === 429) {
    const attempt = Number(opts.attempt || 0);
    if (attempt >= Number(process.env.BR_UPSTREAM_MAX_RETRIES || 6)) {
      throw new Error(`POST ${url} failed: HTTP 429 after ${attempt} retries`);
    }
    await sleep(opts.retryDelay || 1500);
    return postJson(url, body, {
      ...opts,
      attempt: attempt + 1,
      retryDelay: Math.min((opts.retryDelay || 1500) * 2, 10000),
    });
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`POST ${url} failed: HTTP ${res.status}`);
  }
  if (typeof res.data === "string" && res.data.trim().startsWith("<")) {
    throw new Error(`POST ${url} returned HTML instead of JSON. This is usually a proxy, Cloudflare, or upstream timeout response.`);
  }
  return res.data;
}

function extractKillIdsFromText(text = "") {
  const ids = new Set();
  const source = String(text || "");
  for (const match of source.matchAll(/zkillboard\.com\/kill\/(\d+)/gi)) ids.add(Number(match[1]));
  for (const match of source.matchAll(/(?:^|\s)(\d{6,})(?:\s|$)/g)) ids.add(Number(match[1]));
  return [...ids].filter(isPlausibleKillmailId);
}

function normalizeKillRef(ref) {
  if (!ref) return null;

  if (Array.isArray(ref) && ref.length >= 2) {
    const id = safeNumber(ref[0], NaN);
    const hash = String(ref[1] || "").trim();
    return isPlausibleKillmailId(id) && looksLikeHash(hash)
      ? { killmail_id: id, hash, zkb: { hash } }
      : null;
  }

  const killmailId = safeNumber(ref.killmail_id ?? ref.killID ?? ref.kill_id ?? ref.id, NaN);
  if (!isPlausibleKillmailId(killmailId)) return null;

  const rawHash = ref.hash ?? ref.killmail_hash ?? ref.killmailHash ?? ref.zkb?.hash ?? null;
  const hash = rawHash ? String(rawHash).trim() : null;
  const killmailTime = ref.killmail_time ?? ref.killmailTime ?? ref.kill_time ?? ref.time ?? ref.date ?? null;

  return {
    killmail_id: killmailId,
    hash: looksLikeHash(hash) ? hash : null,
    killmail_time: killmailTime,
    zkb: ref.zkb ? ref.zkb : ref,
  };
}

function refInWindow(ref, start, end) {
  const t = ref?.killmail_time ? new Date(ref.killmail_time) : null;
  if (!t || Number.isNaN(t.getTime())) return true;
  if (start && t < start) return false;
  if (end && t > end) return false;
  return true;
}

function pageSignature(items) {
  return (items || [])
    .map((item) => normalizeKillRef(item))
    .filter(Boolean)
    .map((ref) => String(ref.killmail_id))
    .join(",");
}

function normalizeHistoryPayload(data) {
  const refs = [];
  if (!data) return refs;

  const add = (item) => {
    const ref = normalizeKillRef(item);
    if (ref) refs.push(ref);
  };

  if (Array.isArray(data)) {
    for (const item of data) add(item);
    return refs;
  }

  if (Array.isArray(data.killmails)) {
    for (const item of data.killmails) add(item);
    return refs;
  }

  if (Array.isArray(data.kills)) {
    for (const item of data.kills) add(item);
    return refs;
  }

  for (const [key, value] of Object.entries(data)) {
    if (/^\d+$/.test(key) && typeof value === "string" && isPlausibleKillmailId(key) && looksLikeHash(value)) {
      refs.push({ killmail_id: Number(key), hash: value.trim(), zkb: { hash: value.trim() } });
    } else if (/^\d+$/.test(key) && isPlausibleKillmailId(key) && value && typeof value === "object") {
      add({ id: Number(key), ...value });
    }
  }

  return refs;
}

async function fetchZkillKillRef(killmailId) {
  if (!isPlausibleKillmailId(killmailId)) {
    throw new Error(`Ignoring implausible killmail id ${killmailId}`);
  }
  const data = await getJson(`${ZKILL}/api/killID/${killmailId}/`, { timeout: 20000 });
  const row = Array.isArray(data) ? data[0] : data;
  const normalized = normalizeKillRef(row);
  if (!normalized) throw new Error(`zKill did not return a hash for kill ${killmailId}`);
  return normalized;
}

async function fetchEsiKillmail(killmailId, hash) {
  if (!hash) throw new Error(`Missing killmail hash for ${killmailId}`);
  return getJson(`${ESI}/killmails/${killmailId}/${hash}/?datasource=tranquility`, { timeout: 30000 });
}

async function hydrateKillRef(ref) {
  const normalized = normalizeKillRef(ref);
  if (!normalized) return null;

  const cached = await getCachedKillmail(normalized.killmail_id);
  if (cached?.raw_esi) {
    const zkb = cached.raw_zkb && Object.keys(cached.raw_zkb).length ? cached.raw_zkb : normalized.zkb || {};
    return {
      esi: cached.raw_esi,
      zkb,
      hash: cached.killmail_hash || normalized.hash,
      totalValue: safeNumber(cached.total_value, readZkbTotal(zkb)),
    };
  }

  let withHash = normalized.hash ? normalized : await fetchZkillKillRef(normalized.killmail_id);
  let esi = null;

  try {
    esi = await fetchEsiKillmail(withHash.killmail_id, withHash.hash);
  } catch (err) {

    if (normalized.hash) {
      const refreshed = await fetchZkillKillRef(normalized.killmail_id);
      withHash = refreshed.hash ? refreshed : withHash;
      esi = await fetchEsiKillmail(withHash.killmail_id, withHash.hash);
    } else {
      throw err;
    }
  }

  if (!esi && normalized.hash) {
    const refreshed = await fetchZkillKillRef(normalized.killmail_id);
    withHash = refreshed.hash ? refreshed : withHash;
    esi = await fetchEsiKillmail(withHash.killmail_id, withHash.hash);
  }
  if (!esi) return null;

  const zkb = withHash.zkb || {};
  await upsertKillmailCache({ esi, zkb, hash: withHash.hash, sequenceId: withHash.sequence_id || null });

  return {
    esi,
    zkb,
    hash: withHash.hash,
    totalValue: readZkbTotal(zkb),
  };
}

async function discoverByManualUrls(zkillUrls) {
  const text = Array.isArray(zkillUrls) ? zkillUrls.join("\n") : String(zkillUrls || "");
  const ids = extractKillIdsFromText(text);
  const refs = [];
  for (const id of ids) {
    try {
      refs.push(await fetchZkillKillRef(id));
      await sleep(150);
    } catch (err) {
      console.warn(`[br] failed to resolve manual kill ${id}:`, err.message);
    }
  }
  return refs;
}

function readEveKillTotal(raw = {}) {
  const candidates = [
    raw?.totalValue,
    raw?.total_value,
    raw?.value,
    raw?.isk,
    raw?.zkb?.totalValue,
    raw?.zkb?.total_value,
    raw?.prices?.total,
    raw?.prices?.totalValue,
    raw?.killmail?.totalValue,
    raw?.killmail?.total_value,
    raw?.data?.totalValue,
    raw?.data?.total_value,
  ];
  for (const val of candidates) {
    const n = Number(val);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

function normalizeEveKillSearchKill(row) {
  if (!row || typeof row !== "object") return null;
  const esi = row.raw_esi || row.esi || row.killmail || row;
  if (!esi?.killmail_id || !esi?.killmail_time || !esi?.solar_system_id) return null;
  if (!esi.victim || !Array.isArray(esi.attackers)) return null;

  const zkb = row.raw_zkb || row.zkb || {};
  const totalValue = readEveKillTotal(row) || readEveKillTotal(zkb);
  if (totalValue > 0 && zkb && typeof zkb === "object") {
    if (zkb.totalValue == null) zkb.totalValue = totalValue;
    if (zkb.total_value == null) zkb.total_value = totalValue;
    zkb._triff_value_source = "eve-kill";
  }

  return {
    esi,
    zkb,
    hash: row.hash || row.killmail_hash || row.killmailHash || zkb.hash || null,
    totalValue,
    source: "eve-kill",
  };
}

function splitWindowByDays(start, end, maxDays = 7) {
  const chunks = [];
  const maxMs = Math.max(1, Number(maxDays || 7)) * 24 * 60 * 60 * 1000;
  let cursor = new Date(start);
  while (cursor < end) {
    const next = new Date(Math.min(cursor.getTime() + maxMs, end.getTime()));
    chunks.push({ start: new Date(cursor), end: next });
    cursor = next;
  }
  return chunks;
}

function killInScope(esi, scope) {
  if (!esi || !scope) return false;
  const kmSystemId = Number(esi.solar_system_id);
  const kmTime = new Date(esi.killmail_time);
  if (!Number.isFinite(kmSystemId) || Number.isNaN(kmTime.getTime())) return false;
  return kmSystemId === Number(scope.id) && kmTime >= scope.start && kmTime <= scope.end;
}

async function fetchEveKillDetail(killmailId) {
  if (!isPlausibleKillmailId(killmailId)) return null;
  return getJson(`${EVEKILL}/killmails/${killmailId}`, { timeout: Number(process.env.BR_EVEKILL_DETAIL_TIMEOUT_MS || 20000) });
}

async function enrichEveKillValues(kills, opts = {}) {
  const progress = opts.onProgress || (() => {});

  if (process.env.BR_DISABLE_EVEKILL_VALUE_ENRICH === "true") return kills;
  if (process.env.BR_EVEKILL_SKIP_VALUE_ENRICH === "true") return kills;

  const mode = String(process.env.BR_EVEKILL_VALUE_MODE || "missing").toLowerCase();
  if (mode === "off" || mode === "disabled" || mode === "false") return kills;

  for (const kill of kills || []) {
    const value = safeNumber(kill.totalValue, readZkbTotal(kill.zkb || {}));
    if (value > 0) {
      kill.totalValue = value;
      kill.zkb = kill.zkb && typeof kill.zkb === "object" ? kill.zkb : {};
      if (kill.zkb.totalValue == null) kill.zkb.totalValue = value;
      if (kill.zkb.total_value == null) kill.zkb.total_value = value;
      if (!kill.zkb._triff_value_source) kill.zkb._triff_value_source = "eve-kill";
    }
  }

  const targets = (kills || []).filter((kill) => {
    if (!kill?.esi?.killmail_id) return false;
    if (mode === "all") return true;
    return safeNumber(kill.totalValue, readZkbTotal(kill.zkb || {})) <= 0;
  });
  if (!targets.length) return kills;

  const maxDetails = Math.max(0, Number(process.env.BR_EVEKILL_VALUE_MAX_DETAILS || 20000));
  const selected = maxDetails ? targets.slice(0, maxDetails) : targets;
  const concurrency = Math.max(1, Math.min(Number(process.env.BR_EVEKILL_VALUE_CONCURRENCY || 8), 24));
  const progressEvery = Math.max(25, Number(process.env.BR_PROGRESS_EVERY || 100));
  const delayMs = Math.max(0, Number(process.env.BR_EVEKILL_VALUE_DELAY_MS || 0));

  let cursor = 0;
  let processed = 0;
  let enriched = 0;
  let failed = 0;

  progress(`eve-kill value enrichment: checking ${selected.length.toLocaleString()} killmail values${selected.length < targets.length ? ` (capped from ${targets.length.toLocaleString()})` : ""}...`);

  async function worker() {
    while (cursor < selected.length) {
      const kill = selected[cursor++];
      const killmailId = kill?.esi?.killmail_id;
      try {
        const detail = await fetchEveKillDetail(killmailId);
        const totalValue = readEveKillTotal(detail);
        if (totalValue > 0) {
          kill.totalValue = totalValue;
          kill.zkb = kill.zkb && typeof kill.zkb === "object" ? kill.zkb : {};
          kill.zkb.totalValue = totalValue;
          kill.zkb.total_value = totalValue;
          kill.zkb._triff_value_source = "eve-kill";
          kill.zkb._triff_value_fetched_at = new Date().toISOString();
          enriched += 1;

          await upsertKillmailCache({
            esi: kill.esi,
            zkb: kill.zkb || {},
            hash: kill.hash || kill.zkb?.hash || null,
            sequenceId: null,
          });
        }
      } catch (err) {
        failed += 1;
        console.warn(`[br] eve-kill value lookup failed for ${killmailId}:`, err.message);
      } finally {
        processed += 1;
        if (processed === selected.length || processed % progressEvery === 0) {
          progress(`eve-kill value enrichment: ${processed.toLocaleString()} / ${selected.length.toLocaleString()} checked, ${enriched.toLocaleString()} enriched${failed ? `, ${failed.toLocaleString()} failed` : ""}...`);
        }
        if (delayMs > 0) await sleep(delayMs);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker));
  return kills;
}

function readZkillTotalPayload(raw = {}) {
  const candidates = [
    readZkbTotal(raw),
    readZkbTotal(raw?.zkb || {}),
    raw?.zkb?.totalValue,
    raw?.zkb?.total_value,
    raw?.totalValue,
    raw?.total_value,
    raw?.zkb_total_value,
    raw?.value,
    raw?.totalValueDestroyed,
  ];

  for (const val of candidates) {
    const n = Number(val);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

async function fetchZkillValuePayload(killmailId) {
  if (!isPlausibleKillmailId(killmailId)) return null;
  const data = await getJson(`${ZKILL}/api/killID/${killmailId}/`, {
    timeout: Number(process.env.BR_ZKILL_VALUE_TIMEOUT_MS || 20000),
  });
  return Array.isArray(data) ? data[0] : data;
}

function mergeZkillValueIntoKill(kill, payload) {
  if (!kill?.esi || !payload || typeof payload !== "object") return false;

  const normalized = normalizeKillRef(payload);
  const zkbPayload = payload.zkb && typeof payload.zkb === "object" ? payload.zkb : {};
  const totalValue = readZkillTotalPayload(payload);
  const mergedZkb = {
    ...(kill.zkb && typeof kill.zkb === "object" ? kill.zkb : {}),
    ...zkbPayload,
  };

  if (normalized?.hash) {
    kill.hash = normalized.hash;
    mergedZkb.hash = normalized.hash;
  }

  if (totalValue > 0) {

    kill.totalValue = totalValue;
    mergedZkb.totalValue = totalValue;
    mergedZkb.total_value = totalValue;
  }

  mergedZkb._triff_value_source = "zkill";
  mergedZkb._triff_value_fetched_at = new Date().toISOString();
  kill.zkb = mergedZkb;

  return totalValue > 0;
}

async function enrichKillsWithZkillValues(kills, opts = {}) {
  const progress = opts.onProgress || (() => {});
  if (process.env.BR_DISABLE_ZKILL_VALUE_ENRICH === "true") return kills;

  const mode = String(process.env.BR_ZKILL_VALUE_MODE || "all").toLowerCase();
  if (mode === "off" || mode === "disabled" || mode === "false") return kills;

  const refreshCached = process.env.BR_ZKILL_VALUE_REFRESH_CACHED === "true";
  const targets = (kills || []).filter((kill) => {
    if (!kill?.esi?.killmail_id) return false;
    if (!refreshCached && kill?.zkb?._triff_value_source === "zkill") return false;
    if (mode === "missing") return safeNumber(kill.totalValue, readZkbTotal(kill.zkb || {})) <= 0;
    return true;
  });

  if (!targets.length) return kills;

  const maxLookups = Math.max(0, Number(process.env.BR_ZKILL_VALUE_MAX_LOOKUPS || 10000));
  const selected = maxLookups ? targets.slice(0, maxLookups) : targets;
  const concurrency = Math.max(1, Math.min(Number(process.env.BR_ZKILL_VALUE_CONCURRENCY || 8), 24));
  const progressEvery = Math.max(25, Number(process.env.BR_PROGRESS_EVERY || 100));
  const delayMs = Math.max(0, Number(process.env.BR_ZKILL_VALUE_DELAY_MS || 0));

  let cursor = 0;
  let processed = 0;
  let enriched = 0;
  let failed = 0;

  progress(`zKill value enrichment: checking ${selected.length.toLocaleString()} killmail values${selected.length < targets.length ? ` (capped from ${targets.length.toLocaleString()}; raise BR_ZKILL_VALUE_MAX_LOOKUPS if needed)` : ""}...`);

  async function worker() {
    while (cursor < selected.length) {
      const kill = selected[cursor++];
      const killmailId = Number(kill?.esi?.killmail_id);
      try {
        const payload = await fetchZkillValuePayload(killmailId);
        if (mergeZkillValueIntoKill(kill, payload)) enriched += 1;

        await upsertKillmailCache({
          esi: kill.esi,
          zkb: kill.zkb || {},
          hash: kill.hash || kill.zkb?.hash || null,
          sequenceId: null,
        });
      } catch (err) {
        failed += 1;
        console.warn(`[br] zKill value lookup failed for ${killmailId}:`, err.message);
      } finally {
        processed += 1;
        if (processed === selected.length || processed % progressEvery === 0) {
          progress(`zKill value enrichment: ${processed.toLocaleString()} / ${selected.length.toLocaleString()} checked, ${enriched.toLocaleString()} valued${failed ? `, ${failed.toLocaleString()} failed` : ""}...`);
        }
        if (delayMs) await sleep(delayMs);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return kills;
}

async function discoverByEveKillSearch(scopes, opts = {}) {
  const progress = opts.onProgress || (() => {});
  const kills = [];
  const seen = new Set();
  if (!Array.isArray(scopes) || !scopes.length) return kills;

  const maxDays = Math.max(1, Math.min(Number(process.env.BR_EVEKILL_MAX_DAYS_PER_QUERY || 7), 7));
  const limit = Math.max(1, Math.min(Number(process.env.BR_EVEKILL_SEARCH_LIMIT || 100), 100));
  const maxPages = Math.max(1, Number(process.env.BR_EVEKILL_SEARCH_MAX_PAGES || 500));

  for (const scope of scopes) {
    const scopedName = scope.name || scope.query || scope.id;
    const chunks = splitWindowByDays(scope.start, scope.end, maxDays);

    for (const chunk of chunks) {
      let after = null;
      let page = 0;
      let chunkCount = 0;

      while (page < maxPages) {
        page += 1;
        const body = {
          from: chunk.start.toISOString(),
          to: chunk.end.toISOString(),
          system_ids: [Number(scope.id)],
          limit,
        };
        if (after) body.after = after;

        const data = await postJson(`${EVEKILL}/killmails/search`, body, {
          timeout: Number(process.env.BR_EVEKILL_SEARCH_TIMEOUT_MS || 45000),
        });
        const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.killmails) ? data.killmails : []);
        if (!arr.length) break;

        let added = 0;
        for (const item of arr) {
          const kill = normalizeEveKillSearchKill(item);
          if (!kill?.esi || !killInScope(kill.esi, scope)) continue;
          const id = Number(kill.esi.killmail_id);
          if (!isPlausibleKillmailId(id) || seen.has(id)) continue;
          seen.add(id);
          kills.push(kill);
          added += 1;
          chunkCount += 1;
        }

        progress(`eve-kill search: ${kills.length.toLocaleString()} matching killmails found for ${scopedName} (${chunk.start.toISOString().slice(0, 16)}–${chunk.end.toISOString().slice(0, 16)}, page ${page}${added ? `, +${added.toLocaleString()}` : ""})...`);

        const cursor = data?.pagination?.cursor;
        const hasMore = Boolean(data?.pagination?.hasMore);
        if (!hasMore || !cursor || cursor === after) break;
        after = cursor;
        await sleep(Number(process.env.BR_EVEKILL_SEARCH_PAGE_DELAY_MS || 100));
      }

      if (page >= maxPages) {
        progress(`eve-kill search: stopped at BR_EVEKILL_SEARCH_MAX_PAGES=${maxPages} for ${scopedName}; raise it if this window still undercounts.`);
      }
      if (!chunkCount) {
        progress(`eve-kill search: no killmails found for ${scopedName} in ${chunk.start.toISOString().slice(0, 16)}–${chunk.end.toISOString().slice(0, 16)}.`);
      }
    }
  }

  await enrichEveKillValues(kills, { onProgress: progress });

  for (const kill of kills) {

    try {
      await upsertKillmailCache({ esi: kill.esi, zkb: kill.zkb || {}, hash: kill.hash || null, sequenceId: null });
    } catch (err) {
      console.warn(`[br] failed to cache eve-kill result ${kill?.esi?.killmail_id}:`, err.message);
    }
  }

  return kills;
}

async function discoverBySystemZkillApi(systemId, start, end, opts = {}) {
  const progress = opts.onProgress || (() => {});
  const refs = [];
  const seen = new Set();
  const months = monthList(start, end);
  const maxPages = Number(process.env.BR_ZKILL_MAX_PAGES_PER_MONTH || 80);
  const earlyStop = process.env.BR_ZKILL_EARLY_TIME_STOP === "true";

  for (const { year, month } of months) {
    const pageSignatures = new Set();
    for (let page = 1; page <= maxPages; page++) {
      const url = `${ZKILL}/api/systemID/${systemId}/year/${year}/month/${String(month).padStart(2, "0")}/page/${page}/`;
      const data = await getJson(url, { timeout: 30000 });
      const arr = Array.isArray(data) ? data : [];
      if (!arr.length) break;

      const sig = pageSignature(arr);
      if (!sig || pageSignatures.has(sig)) break;
      pageSignatures.add(sig);

      const pageRefs = arr.map(normalizeKillRef).filter(Boolean);
      const pageTimes = pageRefs
        .map((ref) => ref.killmail_time ? new Date(ref.killmail_time).getTime() : NaN)
        .filter(Number.isFinite);

      for (const ref of pageRefs) {
        if (!refInWindow(ref, start, end) || seen.has(ref.killmail_id)) continue;
        seen.add(ref.killmail_id);
        refs.push(ref);
      }

      progress(`zKill month discovery: ${refs.length.toLocaleString()} matching refs found (${year}-${String(month).padStart(2, "0")}, page ${page})...`);

      if (earlyStop && pageTimes.length && Math.max(...pageTimes) < start.getTime()) break;

      await sleep(250);

    }
  }

  return refs;
}

function collectCharacterIdsFromKills(kills) {
  const ids = new Set();
  for (const kill of kills || []) {
    const esi = kill?.esi || {};
    if (esi.victim?.character_id) ids.add(Number(esi.victim.character_id));
    for (const attacker of esi.attackers || []) {
      if (attacker?.character_id) ids.add(Number(attacker.character_id));
    }
  }
  return [...ids].filter((id) => Number.isSafeInteger(id) && id > 0);
}

async function getZkillArrayWithFallback(urls, opts = {}) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const data = await getJson(url, opts);
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.killmails)) return data.killmails;
      if (data && Array.isArray(data.kills)) return data.kills;
      return [];
    } catch (err) {
      lastErr = err;

      if (!/HTTP 404/.test(String(err?.message || ""))) {
        throw err;
      }
    }
  }
  if (lastErr && /HTTP 404/.test(String(lastErr.message || ""))) return [];
  throw lastErr || new Error("No zKill URL candidates were available.");
}

async function discoverCharacterMonthLossRefs(scopes, kills, opts = {}) {
  const progress = opts.onProgress || (() => {});
  const refs = [];
  const seen = new Set();

  if (!Array.isArray(scopes) || !scopes.length || !Array.isArray(kills) || !kills.length) return refs;

  const charIds = collectCharacterIdsFromKills(kills);
  const maxCharacters = Math.max(1, Number(process.env.BR_ZKILL_CHARACTER_LOSS_MAX_CHARACTERS || 900));
  const maxPages = Math.max(1, Number(process.env.BR_ZKILL_CHARACTER_LOSS_MAX_PAGES || 3));
  const delayMs = Math.max(0, Number(process.env.BR_ZKILL_CHARACTER_LOSS_DELAY_MS || 80));
  const selected = charIds.slice(0, maxCharacters);

  if (!selected.length) return refs;

  progress(`Supplementing old BR discovery with character monthly losses (${selected.length.toLocaleString()} characters)...`);

  for (let idx = 0; idx < selected.length; idx++) {
    const characterId = selected[idx];

    for (const scope of scopes) {
      for (const { year, month } of monthList(scope.start, scope.end)) {
        const mm = String(month).padStart(2, "0");
        const pageSignatures = new Set();

        for (let page = 1; page <= maxPages; page++) {

          const urls = [
            `${ZKILL}/api/characterID/${characterId}/losses/year/${year}/month/${mm}/page/${page}/`,
            `${ZKILL}/api/losses/characterID/${characterId}/year/${year}/month/${mm}/page/${page}/`,
          ];

          const arr = await getZkillArrayWithFallback(urls, { timeout: 30000 });
          if (!arr.length) break;

          const sig = pageSignature(arr);
          if (!sig || pageSignatures.has(sig)) break;
          pageSignatures.add(sig);

          for (const item of arr) {
            const ref = normalizeKillRef(item);

            if (!ref || seen.has(ref.killmail_id)) continue;
            seen.add(ref.killmail_id);
            refs.push(ref);
          }

          await sleep(delayMs);
        }
      }
    }

    if ((idx + 1) % 25 === 0 || idx + 1 === selected.length) {
      progress(`Character monthly loss supplement: ${refs.length.toLocaleString()} refs found after ${idx + 1}/${selected.length} characters...`);
    }
  }

  return refs;
}

async function discoverBySystemPastSeconds(systemId, start, end, opts = {}) {
  const progress = opts.onProgress || (() => {});
  const refs = [];
  const seen = new Set();
  const now = new Date();
  const ageSeconds = Math.ceil(Math.max(1, now.getTime() - start.getTime()) / 1000);
  const roundedHours = Math.ceil(ageSeconds / 3600);

  if (roundedHours < 1 || roundedHours > 168) return refs;

  const pastSeconds = roundedHours * 3600;
  const maxPages = Number(process.env.BR_ZKILL_PASTSECONDS_MAX_PAGES || 80);
  const earlyStop = process.env.BR_ZKILL_EARLY_TIME_STOP === "true";

  const pageSignatures = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const url = `${ZKILL}/api/systemID/${systemId}/pastSeconds/${pastSeconds}/page/${page}/`;
    const data = await getJson(url, { timeout: 30000 });
    const arr = Array.isArray(data) ? data : [];
    if (!arr.length) break;

    const sig = pageSignature(arr);
    if (!sig || pageSignatures.has(sig)) break;
    pageSignatures.add(sig);

    const pageRefs = arr.map(normalizeKillRef).filter(Boolean);
    const pageTimes = pageRefs
      .map((ref) => ref.killmail_time ? new Date(ref.killmail_time).getTime() : NaN)
      .filter(Number.isFinite);

    for (const ref of pageRefs) {
      if (!refInWindow(ref, start, end) || seen.has(ref.killmail_id)) continue;
      seen.add(ref.killmail_id);
      refs.push(ref);
    }

    progress(`zKill recent discovery: ${refs.length.toLocaleString()} matching refs found (page ${page})...`);

    if (earlyStop && pageTimes.length && Math.max(...pageTimes) < start.getTime()) break;

    await sleep(300);

  }

  return refs;
}

function formatZkillApiTime(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

async function discoverBySystemStartEnd(systemId, start, end, opts = {}) {
  const progress = opts.onProgress || (() => {});
  const refs = [];
  const seen = new Set();
  const maxPages = Number(process.env.BR_ZKILL_STARTEND_MAX_PAGES || 120);
  const startYmdHi = formatZkillApiTime(start);
  const endYmdHi = formatZkillApiTime(end);

  const pageSignatures = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const url = `${ZKILL}/api/systemID/${systemId}/startTime/${startYmdHi}/endTime/${endYmdHi}/page/${page}/`;
    const data = await getJson(url, { timeout: 45000 });
    const arr = Array.isArray(data) ? data : [];
    if (!arr.length) break;

    const sig = pageSignature(arr);
    if (!sig || pageSignatures.has(sig)) break;
    pageSignatures.add(sig);

    let added = 0;
    for (const item of arr) {
      const ref = normalizeKillRef(item);
      if (!ref || seen.has(ref.killmail_id)) continue;
      seen.add(ref.killmail_id);
      refs.push(ref);
      added += 1;
    }

    progress(`zKill start/end discovery: ${refs.length.toLocaleString()} refs found (page ${page}${added ? `, +${added.toLocaleString()}` : ""})...`);
    await sleep(Number(process.env.BR_ZKILL_STARTEND_PAGE_DELAY_MS || 250));
  }

  return refs;
}

function formatZkillRelatedTime(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

function relatedAnchorTimes(start, end) {
  const anchors = new Map();
  const add = (d) => {
    if (!d || Number.isNaN(d.getTime())) return;
    anchors.set(formatZkillRelatedTime(d), new Date(d));
  };

  add(start);
  add(end);
  add(new Date((start.getTime() + end.getTime()) / 2));

  const probeHours = Math.max(0, Number(process.env.BR_ZKILL_RELATED_PROBE_HOURS || 6));
  for (let h = 1; h <= probeHours; h++) {
    add(new Date(start.getTime() - h * 3600000));
    add(new Date(end.getTime() + h * 3600000));
  }

  const stepHours = Math.max(1, Number(process.env.BR_ZKILL_RELATED_STEP_HOURS || 2));
  const stepMs = stepHours * 60 * 60 * 1000;
  const first = new Date(start);
  first.setUTCMinutes(0, 0, 0);
  for (let t = first.getTime(); t <= end.getTime(); t += stepMs) add(new Date(t));

  return [...anchors.keys()].sort();
}

function looksLikeKillmailObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const hasId = obj.killmail_id || obj.killID || obj.kill_id || obj.killmailID;
  if (!hasId) return false;
  if (obj.hash || obj.killmail_hash || obj.killmailHash || obj.zkb?.hash) return true;
  if (obj.killmail_time || obj.killTime || obj.killmailTime || obj.kill_time) return true;
  if (obj.victim || obj.attackers || obj.zkb || obj.totalValue || obj.total_value) return true;
  return false;
}

function normalizeRelatedRef(obj) {
  if (!obj || typeof obj !== "object") return null;
  const killmailId = safeNumber(obj.killmail_id ?? obj.killID ?? obj.kill_id ?? obj.killmailID ?? obj.id, NaN);
  if (!isPlausibleKillmailId(killmailId)) return null;

  const rawHash = obj.hash ?? obj.killmail_hash ?? obj.killmailHash ?? obj.zkb?.hash ?? obj.zkb?.killmailHash ?? null;
  const hash = rawHash ? String(rawHash).trim() : null;
  const killmailTime = obj.killmail_time ?? obj.killmailTime ?? obj.kill_time ?? obj.killTime ?? obj.time ?? obj.date ?? null;
  const zkb = obj.zkb && typeof obj.zkb === "object" ? { ...obj.zkb } : {};

  if (looksLikeHash(hash) && !zkb.hash) zkb.hash = hash;
  if (obj.totalValue != null && zkb.totalValue == null) zkb.totalValue = obj.totalValue;
  if (obj.total_value != null && zkb.totalValue == null) zkb.totalValue = obj.total_value;

  return { killmail_id: killmailId, hash: looksLikeHash(hash) ? hash : null, killmail_time: killmailTime, zkb };
}

function extractRefsFromRelatedPayload(data) {
  const refs = [];
  const seen = new Set();
  const visit = (node) => {
    if (!node) return;

    if (Array.isArray(node)) {
      const ref = normalizeKillRef(node);
      if (ref && !seen.has(ref.killmail_id)) {
        seen.add(ref.killmail_id);
        refs.push(ref);
        return;
      }
      for (const item of node) visit(item);
      return;
    }

    if (typeof node !== "object") return;

    const direct = looksLikeKillmailObject(node) ? normalizeRelatedRef(node) : null;
    if (direct && !seen.has(direct.killmail_id)) {
      seen.add(direct.killmail_id);
      refs.push(direct);
    }

    for (const [key, value] of Object.entries(node)) {

      if (/^\d+$/.test(key) && typeof value === "string") {
        const id = Number(key);
        if (isPlausibleKillmailId(id) && looksLikeHash(value) && !seen.has(id)) {
          seen.add(id);
          refs.push({ killmail_id: id, hash: value.trim(), zkb: { hash: value.trim() } });
        }
        continue;
      }
      if (/^\d+$/.test(key) && isPlausibleKillmailId(key) && value && typeof value === "object") {
        const candidate = normalizeRelatedRef({ killmail_id: Number(key), ...value });
        if (candidate && !seen.has(candidate.killmail_id)) {
          seen.add(candidate.killmail_id);
          refs.push(candidate);
        }
      }
      visit(value);
    }
  };

  visit(data);
  return refs;
}

async function discoverByZkillRelated(systemId, start, end, opts = {}) {
  const progress = opts.onProgress || (() => {});
  const refs = [];
  const seen = new Set();
  const anchors = relatedAnchorTimes(start, end);

  for (const anchor of anchors) {
    const url = `${ZKILL}/api/related/${systemId}/${anchor}/`;
    try {
      const data = await getJson(url, { timeout: Number(process.env.BR_ZKILL_RELATED_TIMEOUT_MS || 120000) });
      const pageRefs = extractRefsFromRelatedPayload(data);
      let added = 0;
      for (const ref of pageRefs) {
        if (!ref || seen.has(ref.killmail_id)) continue;
        seen.add(ref.killmail_id);
        refs.push(ref);
        added += 1;
      }
      progress(`zKill related discovery: ${refs.length.toLocaleString()} refs found after anchor ${anchor}${added ? ` (+${added.toLocaleString()})` : ""}...`);
    } catch (err) {
      console.warn(`[br] zKill related discovery failed for ${url}:`, err.message);
      progress(`zKill related discovery: anchor ${anchor} failed (${err.message}); falling back to paged search...`);
    }
    await sleep(750);
  }

  return refs;
}

async function discoverByR2Z2History(start, end, opts = {}) {
  const progress = opts.onProgress || (() => {});
  const refs = [];
  const seen = new Set();
  const maxRefs = Number(process.env.BR_R2Z2_HISTORY_MAX_REFS || 300000);

  for (const day of utcDayList(start, end)) {
    const url = `${R2Z2_HISTORY}/${isoDateOnly(day)}.json`;
    const data = await getJson(url, { timeout: 90000 });
    const arr = normalizeHistoryPayload(data);

    for (const item of arr) {
      const ref = normalizeKillRef(item);
      if (!ref || seen.has(ref.killmail_id)) continue;
      seen.add(ref.killmail_id);
      refs.push(ref);
      if (refs.length >= maxRefs) return refs;
    }

    progress(`R2Z2 history discovery: ${refs.length.toLocaleString()} global refs loaded through ${isoDateOnly(day)}...`);
    await sleep(500);
  }

  return refs;
}

async function resolveSystem(queryOrId) {
  const raw = String(queryOrId || "").trim();
  if (!raw) return { id: null, name: null };
  if (/^\d+$/.test(raw)) return { id: Number(raw), name: null };

  try {
    const { rows } = await pool.query(
      `
      SELECT "solarSystemID" AS id, "solarSystemName" AS name
      FROM evesde."mapSolarSystems"
      WHERE lower("solarSystemName") = lower($1)
      LIMIT 1
      `,
      [raw]
    );
    if (rows[0]) return { id: Number(rows[0].id), name: rows[0].name };
  } catch (_err) {

  }

  try {
    const data = await postJson(`${ESI}/universe/ids/?datasource=tranquility&language=en`, [raw], { timeout: 30000 });
    const row = data?.systems?.find((s) => String(s.name).toLowerCase() === raw.toLowerCase()) || data?.systems?.[0];
    if (row) return { id: Number(row.id), name: row.name };
  } catch (err) {
    console.warn(`[br] ESI system resolve failed for ${raw}:`, err.message);
  }

  return { id: null, name: raw };
}

function parseSystemQueries(input) {
  const values = [];
  const add = (value) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) add(item);
      return;
    }
    const raw = String(value).trim();
    if (!raw) return;
    for (const part of raw.split(/[\n,;]+/)) {
      const cleaned = part.trim();
      if (cleaned) values.push(cleaned);
    }
  };

  add(input.systemQueries);
  add(input.systems);
  add(input.systemIds);
  add(input.systemQuery || input.systemName || input.systemId);

  return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))];
}

async function resolveTypeInfo(typeIds) {
  const out = new Map();
  const ids = [...new Set(typeIds.filter(Boolean).map(Number))];
  if (!ids.length) return out;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        t."typeID" AS id,
        t."typeName" AS name,
        t."groupID" AS group_id,
        g."groupName" AS group_name,
        g."categoryID" AS category_id
      FROM evesde."invTypes" t
      LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
      WHERE t."typeID" = ANY($1::int[])
      `,
      [ids]
    );
    for (const row of rows) {
      out.set(Number(row.id), {
        id: Number(row.id),
        name: row.name,
        group_id: row.group_id ? Number(row.group_id) : null,
        group_name: row.group_name || null,
        category_id: row.category_id ? Number(row.category_id) : null,
      });
    }
  } catch (err) {
    console.warn("[br] local type info lookup failed:", err.message);

    try {
      const { rows } = await pool.query(
        `SELECT "typeID" AS id, "typeName" AS name FROM evesde."invTypes" WHERE "typeID" = ANY($1::int[])`,
        [ids]
      );
      for (const row of rows) out.set(Number(row.id), { id: Number(row.id), name: row.name, group_id: null, group_name: null, category_id: null });
    } catch (fallbackErr) {
      console.warn("[br] local type name fallback lookup failed:", fallbackErr.message);
    }
  }

  return out;
}

async function resolveTypeNames(typeIds) {
  const info = await resolveTypeInfo(typeIds);
  return new Map([...info.entries()].map(([id, row]) => [id, row.name]));
}

async function resolveEsiNames(ids, seedNames = null) {
  const unique = [...new Set(ids.filter(Boolean).map(Number))].filter(Number.isFinite);
  const out = seedNames instanceof Map ? new Map(seedNames) : new Map();
  const unresolved = unique.filter((id) => !out.has(id));
  for (let i = 0; i < unresolved.length; i += 900) {
    const chunk = unresolved.slice(i, i + 900);
    if (!chunk.length) continue;
    try {
      const rows = await postJson(`${ESI}/universe/names/?datasource=tranquility`, chunk, { timeout: 30000 });
      for (const row of rows || []) out.set(Number(row.id), row.name);
    } catch (err) {
      console.warn("[br] ESI names lookup failed:", err.message);
    }
    await sleep(150);
  }
  return out;
}

function shipClassFromGroup(groupName, typeName = "") {
  const group = String(groupName || "").toLowerCase();
  const name = String(typeName || "").toLowerCase();
  const haystack = `${group} ${name}`;

  if (/(citadel|engineering complex|refinery|upwell|structure|starbase|control tower|customs office|infrastructure hub|territorial claim unit|cynosural jammer|cynosural beacon|pharolux|ansiblex|tenebrex|keepstar|fortizar|azbel|sotiyo|astrahus|raitaru|athanor|tatara)/.test(haystack)) return { name: "Structure", rank: 0 };
  if (/shuttle/.test(haystack)) return { name: "Shuttle", rank: 70 };
  if (/(titan|dreadnought|supercarrier|carrier|force auxiliary|capital industrial ship)/.test(haystack)) return { name: "Capital", rank: 10 };
  if (/(marauder|black ops|battleship)/.test(haystack)) return { name: "Battleship", rank: 20 };
  if (/(command ship|battlecruiser)/.test(haystack)) return { name: "Battlecruiser", rank: 30 };
  if (/(strategic cruiser|heavy assault cruiser|heavy interdiction cruiser|combat recon ship|force recon ship|logistics cruiser|recon ship|cruiser)/.test(haystack)) return { name: "Cruiser", rank: 40 };
  if (/(command destroyer|tactical destroyer|interdictor|destroyer)/.test(haystack)) return { name: "Destroyer", rank: 50 };
  if (/(assault frigate|covert ops|electronic attack ship|expedition frigate|interceptor|logistics frigate|stealth bomber|frigate)/.test(haystack)) return { name: "Frigate", rank: 60 };
  if (/(industrial|transport ship|blockade runner|deep space transport|mining barge|exhumer|freighter|jump freighter|ore industrial)/.test(haystack)) return { name: "Industrial", rank: 80 };
  return { name: groupName || "Other", rank: 90 };
}

function structureOwnerKey(actor = {}) {
  return actor.structure_id || actor.corporation_id || actor.alliance_id || actor.faction_id || "none";
}

function isStructureHullType(groupName, typeName = "") {
  const group = String(groupName || "").toLowerCase();
  const name = String(typeName || "").toLowerCase();
  const haystack = `${group} ${name}`;

  if (/(standup|energy neutralizer|target painter|stasis webifier|warp disruptor|sensor dampener|ecm|guided bomb|bomb launcher|missile launcher|point defense|doomsday|weapon|service module|structure module)/.test(haystack)) {
    return false;
  }

  return /(citadel|engineering complex|refinery|starbase|control tower|customs office|infrastructure hub|territorial claim unit|cynosural jammer|cynosural beacon|pharolux|ansiblex|tenebrex|keepstar|fortizar|azbel|sotiyo|astrahus|raitaru|athanor|tatara|metenox|skyhook)/.test(haystack);
}

function isStructurePartType(groupName, typeName = "") {
  const haystack = `${String(groupName || "").toLowerCase()} ${String(typeName || "").toLowerCase()}`;
  return /(standup|energy neutralizer|target painter|stasis webifier|warp disruptor|sensor dampener|ecm|guided bomb|bomb launcher|missile launcher|point defense|doomsday|weapon|service module|structure module)/.test(haystack);
}

function sortParticipantShips(ships) {
  return [...(ships || [])].sort((a, b) =>
    (a.ship_class_rank || 90) - (b.ship_class_rank || 90) ||
    Number((b.loss_count || 0) > 0) - Number((a.loss_count || 0) > 0) ||
    safeNumber(b.isk_lost, 0) - safeNumber(a.isk_lost, 0) ||
    safeNumber(b.damage_done, 0) - safeNumber(a.damage_done, 0) ||
    safeNumber(b.kills_on, 0) - safeNumber(a.kills_on, 0) ||
    String(a.ship_name || "").localeCompare(String(b.ship_name || ""))
  );
}

function pickPrimaryParticipantShip(ships) {

  const sorted = sortParticipantShips(ships);
  return sorted[0] || null;
}

function entityFromActor(actor) {
  if (!actor) return null;
  if (actor.alliance_id) return { key: `alliance:${actor.alliance_id}`, kind: "alliance", id: actor.alliance_id };
  if (actor.corporation_id) return { key: `corporation:${actor.corporation_id}`, kind: "corporation", id: actor.corporation_id };
  if (actor.character_id) return { key: `character:${actor.character_id}`, kind: "character", id: actor.character_id };
  if (actor.faction_id) return { key: `faction:${actor.faction_id}`, kind: "faction", id: actor.faction_id };
  return null;
}

function actorName(actor, names) {
  if (!actor) return "Unknown";
  if (actor.character_id && names.get(Number(actor.character_id))) return names.get(Number(actor.character_id));
  if (actor.corporation_id && names.get(Number(actor.corporation_id))) return names.get(Number(actor.corporation_id));
  if (actor.alliance_id && names.get(Number(actor.alliance_id))) return names.get(Number(actor.alliance_id));
  if (actor.faction_id && names.get(Number(actor.faction_id))) return names.get(Number(actor.faction_id));
  return "Unknown";
}

function entityName(entity, names) {
  if (!entity) return "Unknown";
  return names.get(Number(entity.id)) || `${entity.kind}:${entity.id}`;
}

function createKillContext(kill, names, typeNames) {
  const esi = kill.esi;
  const victim = esi.victim || {};
  const attackers = Array.isArray(esi.attackers) ? esi.attackers : [];
  const finalBlow = attackers.find((a) => a.final_blow) || null;
  const totalValue = safeNumber(kill.totalValue, readZkbTotal(kill.zkb));
  const damageTaken = Math.max(
    0,
    safeNumber(victim.damage_taken, 0) || attackers.reduce((sum, a) => sum + safeNumber(a.damage_done, 0), 0)
  );

  return {
    killmail_id: esi.killmail_id,
    killmail_time: esi.killmail_time,
    solar_system_id: esi.solar_system_id,
    system_name: names.get(Number(esi.solar_system_id)) || String(esi.solar_system_id),
    total_value: totalValue,
    damage_taken: damageTaken,
    victim,
    attackers,
    victim_entity: entityFromActor(victim),
    victim_name: actorName(victim, names),
    victim_corporation_id: victim.corporation_id || null,
    victim_corporation_name: victim.corporation_id ? names.get(Number(victim.corporation_id)) || null : null,
    victim_alliance_id: victim.alliance_id || null,
    victim_alliance_name: victim.alliance_id ? names.get(Number(victim.alliance_id)) || null : null,
    victim_ship_type_id: victim.ship_type_id || null,
    victim_ship_name: typeNames.get(Number(victim.ship_type_id)) || (victim.ship_type_id ? `Type ${victim.ship_type_id}` : "Unknown Ship"),
    final_blow: finalBlow,
    final_blow_name: finalBlow ? actorName(finalBlow, names) : "Unknown",
    final_blow_corporation_id: finalBlow?.corporation_id || null,
    final_blow_alliance_id: finalBlow?.alliance_id || null,
    zkill_url: `${EVEKILL_WEB}/kill/${esi.killmail_id}`,
  };
}

function buildEntityInventory(contexts, names) {
  const entities = new Map();
  const touch = (entity, actor) => {
    if (!entity) return;
    const existing = entities.get(entity.key) || {
      key: entity.key,
      kind: entity.kind,
      id: entity.id,
      name: entityName(entity, names),
      side_id: null,
      ships_lost: 0,
      isk_lost: 0,
      damage_done: 0,
      final_blows: 0,
      pilots: new Set(),
      corporations: new Set(),
      alliances: new Set(),
    };
    if (actor?.character_id) existing.pilots.add(Number(actor.character_id));
    if (actor?.corporation_id) existing.corporations.add(Number(actor.corporation_id));
    if (actor?.alliance_id) existing.alliances.add(Number(actor.alliance_id));
    entities.set(entity.key, existing);
  };

  for (const ctx of contexts) {
    touch(ctx.victim_entity, ctx.victim);
    const v = entities.get(ctx.victim_entity?.key);
    if (v) {
      v.ships_lost += 1;
      v.isk_lost += ctx.total_value;
    }
    for (const a of ctx.attackers) {
      const e = entityFromActor(a);
      touch(e, a);
      const row = entities.get(e?.key);
      if (row) {
        row.damage_done += safeNumber(a.damage_done, 0);
        if (a.final_blow) row.final_blows += 1;
      }
    }
  }

  return entities;
}

function actorEntityKeys(actor = {}) {
  const keys = [];
  if (actor.alliance_id) keys.push(`alliance:${Number(actor.alliance_id)}`);
  if (actor.corporation_id) keys.push(`corporation:${Number(actor.corporation_id)}`);
  if (actor.character_id) keys.push(`character:${Number(actor.character_id)}`);
  if (actor.faction_id) keys.push(`faction:${Number(actor.faction_id)}`);
  return keys;
}

function excludedEntityKeys(sideOverrides = {}) {
  return new Set(
    Object.entries(sideOverrides || {})
      .filter(([, value]) => isExcludedSideValue(value))
      .map(([key]) => key)
  );
}

function contextHasExcludedEntity(ctx, excludedKeys) {
  if (!excludedKeys?.size) return false;
  if (actorEntityKeys(ctx.victim).some((key) => excludedKeys.has(key))) return true;
  return (ctx.attackers || []).some((actor) => actorEntityKeys(actor).some((key) => excludedKeys.has(key)));
}

function serializeEntitiesForEditor(entityInventory, sideByEntity, sideOverrides = {}) {
  return [...entityInventory.values()].map((e) => ({
    key: e.key,
    kind: e.kind,
    id: e.id,
    name: e.name,
    side_id: isExcludedSideValue(sideOverrides[e.key]) ? EXCLUDED_SIDE_ID : (sideByEntity.get(e.key) || "side_unknown"),
    ships_lost: e.ships_lost,
    isk_lost: Math.round(e.isk_lost),
    damage_done: Math.round(e.damage_done),
    final_blows: e.final_blows,
    pilot_count: e.pilots.size,
    corporation_count: e.corporations.size,
    alliance_count: e.alliances.size,
  })).sort((a, b) => {
    const ax = a.side_id === EXCLUDED_SIDE_ID ? 1 : 0;
    const bx = b.side_id === EXCLUDED_SIDE_ID ? 1 : 0;
    return ax - bx || b.isk_lost - a.isk_lost || b.damage_done - a.damage_done;
  });
}

class UnionFind {
  constructor() { this.parent = new Map(); }
  add(x) { if (x && !this.parent.has(x)) this.parent.set(x, x); }
  find(x) {
    if (!x) return null;
    this.add(x);
    const p = this.parent.get(x);
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a, b) {
    if (!a || !b) return;
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra && rb && ra !== rb) this.parent.set(rb, ra);
  }
}

function inferBattleSides(contexts, entityInventory, sideOverrides = {}) {
  const keys = [...entityInventory.keys()];
  const sideByEntity = new Map();
  if (!keys.length) return sideByEntity;

  const hostile = new Map();
  const friendly = new Map();

  const addEdge = (map, a, b, weight) => {
    if (!a || !b || a === b) return;
    const w = Math.max(0, safeNumber(weight, 0));
    if (!w) return;
    if (!map.has(a)) map.set(a, new Map());
    if (!map.has(b)) map.set(b, new Map());
    map.get(a).set(b, (map.get(a).get(b) || 0) + w);
    map.get(b).set(a, (map.get(b).get(a) || 0) + w);
  };

  const edgeSumToSide = (map, key, labels, side) => {
    let total = 0;
    for (const [other, weight] of map.get(key) || []) {
      if (labels.get(other) === side) total += weight;
    }
    return total;
  };

  const entityStrength = (key) => {
    const e = entityInventory.get(key) || {};
    return (
      Math.log10(safeNumber(e.isk_lost, 0) + 10) * 4 +
      Math.log10(safeNumber(e.damage_done, 0) + 10) * 2 +
      safeNumber(e.final_blows, 0) * 0.35 +
      safeNumber(e.ships_lost, 0) * 0.08
    );
  };

  for (const ctx of contexts) {
    const victimKey = ctx.victim_entity?.key;
    if (!victimKey) continue;

    const totalDamage = Math.max(
      1,
      ctx.attackers.reduce((sum, a) => sum + safeNumber(a.damage_done, 0), 0)
    );

    const attackers = [];
    for (const a of ctx.attackers || []) {
      const ent = entityFromActor(a);
      if (!ent?.key || ent.key === victimKey) continue;

      const damage = safeNumber(a.damage_done, 0);
      const damageShare = damage / totalDamage;
      const valueWeight = Math.log10(safeNumber(ctx.total_value, 0) + 10);
      const damageWeight = Math.log10(damage + 10);

      const hostileWeight =
        1 +
        valueWeight * 2.5 +
        damageWeight * 0.9 +
        (a.final_blow ? 6 : 0) +
        Math.min(8, damageShare * 16);

      addEdge(hostile, victimKey, ent.key, hostileWeight);

      attackers.push({
        key: ent.key,
        damage,
        damageShare,
        finalBlow: Boolean(a.final_blow),
        weight: hostileWeight,
      });
    }

    const meaningful = attackers
      .sort((a, b) => b.damage - a.damage || Number(b.finalBlow) - Number(a.finalBlow))
      .filter((a, idx) => a.finalBlow || idx < 10 || a.damageShare >= 0.015);

    for (let i = 0; i < meaningful.length; i++) {
      for (let j = i + 1; j < meaningful.length; j++) {
        const a = meaningful[i];
        const b = meaningful[j];
        const weight = Math.min(3, Math.min(a.weight, b.weight) * 0.12);
        addEdge(friendly, a.key, b.key, weight);
      }
    }
  }

  let seedA = null;
  let seedB = null;
  let bestSeedScore = -Infinity;

  for (const [a, neighbors] of hostile.entries()) {
    for (const [b, hostileWeight] of neighbors.entries()) {
      if (String(a) >= String(b)) continue;
      const score = hostileWeight + entityStrength(a) + entityStrength(b);
      if (score > bestSeedScore) {
        bestSeedScore = score;
        seedA = a;
        seedB = b;
      }
    }
  }

  if (!seedA || !seedB) {
    keys
      .sort((a, b) => entityStrength(b) - entityStrength(a))
      .forEach((key, idx) => sideByEntity.set(key, `side_${idx + 1}`));

    for (const [key, value] of Object.entries(sideOverrides || {})) {
      if (isAssignableSideOverride(value)) sideByEntity.set(key, value);
    }
    return sideByEntity;
  }

  const labels = new Map();
  labels.set(seedA, 1);
  labels.set(seedB, 2);

  for (const key of keys) {
    if (labels.has(key)) continue;
    const hToA = hostile.get(key)?.get(seedA) || 0;
    const hToB = hostile.get(key)?.get(seedB) || 0;
    const fToA = friendly.get(key)?.get(seedA) || 0;
    const fToB = friendly.get(key)?.get(seedB) || 0;

    const score1 = hToB - hToA + (fToA - fToB) * 0.35;
    const score2 = hToA - hToB + (fToB - fToA) * 0.35;

    if (Math.max(score1, score2) > 0.001) labels.set(key, score1 >= score2 ? 1 : 2);
  }

  for (let iter = 0; iter < 12; iter++) {
    let changed = false;

    for (const key of keys) {
      const h1 = edgeSumToSide(hostile, key, labels, 1);
      const h2 = edgeSumToSide(hostile, key, labels, 2);
      const f1 = edgeSumToSide(friendly, key, labels, 1);
      const f2 = edgeSumToSide(friendly, key, labels, 2);

      const score1 = h2 - h1 + (f1 - f2) * 0.35;
      const score2 = h1 - h2 + (f2 - f1) * 0.35;

      let next = labels.get(key) || null;
      if (Math.max(score1, score2) > 0.001) next = score1 >= score2 ? 1 : 2;

      if (next && labels.get(key) !== next) {
        labels.set(key, next);
        changed = true;
      }
    }

    if (!changed) break;
  }

  for (const key of keys) {
    if (labels.has(key)) continue;
    const h1 = edgeSumToSide(hostile, key, labels, 1);
    const h2 = edgeSumToSide(hostile, key, labels, 2);
    const f1 = edgeSumToSide(friendly, key, labels, 1);
    const f2 = edgeSumToSide(friendly, key, labels, 2);

    if (Math.max(h1, h2, f1, f2) <= 0) {
      labels.set(key, 0);
    } else {
      const score1 = h2 - h1 + (f1 - f2) * 0.35;
      const score2 = h1 - h2 + (f2 - f1) * 0.35;
      labels.set(key, score1 >= score2 ? 1 : 2);
    }
  }

  const lostByLabel = new Map([[1, 0], [2, 0], [0, 0]]);
  for (const key of keys) {
    const label = labels.get(key) || 0;
    const e = entityInventory.get(key) || {};
    lostByLabel.set(label, (lostByLabel.get(label) || 0) + safeNumber(e.isk_lost, 0));
  }

  const labelToSide = new Map();
  if ((lostByLabel.get(2) || 0) > (lostByLabel.get(1) || 0)) {
    labelToSide.set(2, "side_1");
    labelToSide.set(1, "side_2");
  } else {
    labelToSide.set(1, "side_1");
    labelToSide.set(2, "side_2");
  }
  labelToSide.set(0, "side_unknown");

  for (const key of keys) {
    sideByEntity.set(key, labelToSide.get(labels.get(key) || 0) || "side_unknown");
  }

  for (const [key, value] of Object.entries(sideOverrides || {})) {
    if (isAssignableSideOverride(value)) sideByEntity.set(key, value);
  }

  return sideByEntity;
}

function stabilizeSideIdentity(sideByEntity, previousEntities = [], sideOverrides = {}) {
  if (!Array.isArray(previousEntities) || !previousEntities.length) return sideByEntity;
  const prior = new Map(previousEntities.map((entity) => [entity.key, entity]));
  let direct = 0;
  let swapped = 0;

  for (const [key, candidateSide] of sideByEntity.entries()) {
    if (isAssignableSideOverride(sideOverrides[key])) continue;
    if (candidateSide !== "side_1" && candidateSide !== "side_2") continue;
    const previous = prior.get(key);
    if (!previous || (previous.side_id !== "side_1" && previous.side_id !== "side_2")) continue;
    const weight = 1 + Math.max(0, safeNumber(previous.pilot_count, 0));
    if (candidateSide === previous.side_id) direct += weight;
    else swapped += weight;
  }

  if (swapped <= direct) return sideByEntity;
  const stabilized = new Map(sideByEntity);
  for (const [key, candidateSide] of stabilized.entries()) {
    if (isAssignableSideOverride(sideOverrides[key])) continue;
    if (candidateSide === "side_1") stabilized.set(key, "side_2");
    else if (candidateSide === "side_2") stabilized.set(key, "side_1");
  }
  for (const [key, value] of Object.entries(sideOverrides || {})) {
    if (isAssignableSideOverride(value)) stabilized.set(key, value);
  }
  return stabilized;
}
function summarize(contexts, sideByEntity, entityInventory, sideNames = {}, names = new Map(), typeNames = new Map(), typeInfo = new Map()) {
  const baseSide = (id) => ({
    id,
    name: sideNames[id] || (id.startsWith("side_") ? `Team ${String(id).split("_")[1]}` : id.replace("_", " ")),
    iskLost: 0,
    iskKilled: 0,
    efficiency: 0,
    shipsLost: 0,
    damageDone: 0,
    finalBlows: 0,
    pilots: new Set(),
    corporations: new Set(),
    alliances: new Set(),
    shipLosses: new Map(),
    participants: new Map(),
    entities: [],
  });

  const sides = new Map();
  const getSide = (id) => {
    const sid = id || "side_unknown";
    if (!sides.has(sid)) sides.set(sid, baseSide(sid));
    return sides.get(sid);
  };

  const allPilots = new Set();
  const allCorps = new Set();
  const allAlliances = new Set();
  const killRows = [];

  const sideFromActorAffiliation = (actor = {}) => {
    if (!actor) return null;

    const keys = [];
    if (actor.alliance_id) keys.push(`alliance:${actor.alliance_id}`);
    if (actor.corporation_id) keys.push(`corporation:${actor.corporation_id}`);
    if (actor.character_id) keys.push(`character:${actor.character_id}`);
    if (actor.faction_id) keys.push(`faction:${actor.faction_id}`);
    for (const key of keys) {
      const sideId = sideByEntity.get(key);
      if (sideId) return sideId;
    }
    return null;
  };

  const characterSideVotes = new Map();
  const addCharacterSideVote = (actor, sideId, weight = 1) => {
    if (!actor?.character_id || !sideId || sideId === "side_unknown") return;
    const charId = Number(actor.character_id);
    if (!Number.isFinite(charId)) return;
    const votes = characterSideVotes.get(charId) || new Map();
    votes.set(sideId, (votes.get(sideId) || 0) + Math.max(1, safeNumber(weight, 1)));
    characterSideVotes.set(charId, votes);
  };

  for (const ctx of contexts) {
    const victimAffiliationSide = sideFromActorAffiliation(ctx.victim) || "side_unknown";
    addCharacterSideVote(ctx.victim, victimAffiliationSide, Math.max(1, safeNumber(ctx.total_value, 0) / 100000000));

    for (const a of ctx.attackers || []) {
      const attackerSide = sideFromActorAffiliation(a) || "side_unknown";
      addCharacterSideVote(a, attackerSide, Math.max(1, safeNumber(a.damage_done, 0) / 100000));
    }
  }

  const characterSideHints = new Map();
  for (const [charId, votes] of characterSideVotes.entries()) {
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best?.[0]) characterSideHints.set(charId, best[0]);
  }

  const sideForActor = (actor = {}) => {
    if (actor?.character_id) {
      const hint = characterSideHints.get(Number(actor.character_id));
      if (hint) return hint;
    }
    return sideFromActorAffiliation(actor) || "side_unknown";
  };

  const destroyedStructuresByOwner = new Map();
  for (const ctx of contexts) {
    const actor = ctx.victim || {};
    const shipTypeId = actor.ship_type_id ? Number(actor.ship_type_id) : null;
    if (!shipTypeId || actor.character_id) continue;
    const shipInfo = typeInfo.get(shipTypeId) || {};
    const shipName = shipInfo.name || typeNames.get(shipTypeId) || `Type ${shipTypeId}`;
    if (!isStructureHullType(shipInfo.group_name, shipName)) continue;
    const ownerKey = structureOwnerKey(actor);
    const current = destroyedStructuresByOwner.get(ownerKey);
    const value = safeNumber(ctx.total_value, 0);
    if (!current || value > current.value) {
      destroyedStructuresByOwner.set(ownerKey, {
        key: `structure:victim:${shipTypeId}:${ownerKey}`,
        ownerKey,
        shipTypeId,
        shipName,
        shipInfo,
        shipClass: shipClassFromGroup(shipInfo.group_name, shipName),
        value,
      });
    }
  }

  const addParticipant = (sideId, actor, opts = {}) => {
    if (!actor) return;
    const shipTypeId = actor.ship_type_id ? Number(actor.ship_type_id) : null;
    const side = getSide(sideId);
    const charId = actor.character_id ? Number(actor.character_id) : null;
    let shipInfo = shipTypeId ? (typeInfo.get(shipTypeId) || {}) : {};
    let shipName = shipTypeId ? (shipInfo.name || typeNames.get(shipTypeId) || `Type ${shipTypeId}`) : "Unknown Ship";
    let shipClass = shipClassFromGroup(shipInfo.group_name, shipName);

    const ownerKey = structureOwnerKey(actor);
    const destroyedParent = !charId && !opts.asVictim ? destroyedStructuresByOwner.get(ownerKey) : null;
    const structureHull = !charId && shipTypeId && isStructureHullType(shipInfo.group_name, shipName);
    const structurePart = !charId && shipTypeId && isStructurePartType(shipInfo.group_name, shipName);

    let key;
    let displayAsStructure = false;

    if (!charId) {
      if (opts.asVictim) {
        if (!structureHull) return;
        key = `structure:victim:${shipTypeId}:${ownerKey}`;
        displayAsStructure = true;
      } else if (destroyedParent) {

        key = destroyedParent.key;
        shipInfo = destroyedParent.shipInfo || shipInfo;
        shipName = destroyedParent.shipName || shipName;
        shipClass = destroyedParent.shipClass || shipClassFromGroup(shipInfo.group_name, shipName);
        displayAsStructure = true;
      } else if (structureHull && !structurePart) {
        key = `structure:attacker:${shipTypeId}:${ownerKey}`;
        displayAsStructure = true;
      } else {
        return;
      }
    } else {
      key = `${charId}`;
    }

    const existing = side.participants.get(key) || {
      key,
      character_id: charId,
      character_name: displayAsStructure ? shipName : actorName(actor, names),
      ship_type_id: displayAsStructure ? (shipInfo.id || shipTypeId) : shipTypeId,
      ship_name: shipName,
      ship_group_name: shipInfo.group_name || null,
      ship_class: shipClass.name,
      ship_class_rank: shipClass.rank,
      corporation_id: actor.corporation_id || null,
      corporation_name: actor.corporation_id ? (names.get(Number(actor.corporation_id)) || null) : null,
      alliance_id: actor.alliance_id || null,
      alliance_name: actor.alliance_id ? (names.get(Number(actor.alliance_id)) || null) : null,
      loss_count: 0,
      isk_lost: 0,
      kills_on: 0,
      damage_done: 0,
      amount_tanked: 0,
      final_blows: 0,
      loss_killmail_id: null,
      zkill_url: null,
      first_seen: opts.killmail_time || null,
      last_seen: opts.killmail_time || null,
      ships: new Map(),
    };

    if (!existing.corporation_id && actor.corporation_id) {
      existing.corporation_id = actor.corporation_id;
      existing.corporation_name = names.get(Number(actor.corporation_id)) || null;
    }
    if (!existing.alliance_id && actor.alliance_id) {
      existing.alliance_id = actor.alliance_id;
      existing.alliance_name = names.get(Number(actor.alliance_id)) || null;
    }

    if (opts.killmail_time) {
      if (!existing.first_seen || new Date(opts.killmail_time) < new Date(existing.first_seen)) existing.first_seen = opts.killmail_time;
      if (!existing.last_seen || new Date(opts.killmail_time) > new Date(existing.last_seen)) existing.last_seen = opts.killmail_time;
    }

    const rowShipTypeId = displayAsStructure ? (shipInfo.id || shipTypeId) : shipTypeId;
    const shipKey = `${rowShipTypeId || "unknown"}`;
    const shipRow = existing.ships.get(shipKey) || {
      key: shipKey,
      ship_type_id: rowShipTypeId,
      ship_name: shipName,
      ship_group_name: shipInfo.group_name || null,
      ship_class: shipClass.name,
      ship_class_rank: shipClass.rank,
      loss_count: 0,
      isk_lost: 0,
      kills_on: 0,
      damage_done: 0,
      amount_tanked: 0,
      final_blows: 0,
      loss_killmail_ids: [],
      zkill_url: null,
      first_seen: opts.killmail_time || null,
      last_seen: opts.killmail_time || null,
    };

    if (opts.killmail_time) {
      if (!shipRow.first_seen || new Date(opts.killmail_time) < new Date(shipRow.first_seen)) shipRow.first_seen = opts.killmail_time;
      if (!shipRow.last_seen || new Date(opts.killmail_time) > new Date(shipRow.last_seen)) shipRow.last_seen = opts.killmail_time;
    }

    if (opts.asVictim) {
      const value = safeNumber(opts.total_value, 0);
      const tanked = Math.max(0, safeNumber(opts.damage_taken, 0));
      existing.loss_count += 1;
      existing.isk_lost += value;
      existing.amount_tanked += tanked;
      shipRow.loss_count += 1;
      shipRow.isk_lost += value;
      shipRow.amount_tanked += tanked;
      if (opts.killmail_id) shipRow.loss_killmail_ids.push(opts.killmail_id);
      if (!existing.loss_killmail_id) existing.loss_killmail_id = opts.killmail_id || null;
      if (!existing.zkill_url) existing.zkill_url = opts.zkill_url || null;
      if (!shipRow.zkill_url) shipRow.zkill_url = opts.zkill_url || null;
    } else {
      const dmg = Math.max(0, safeNumber(opts.damage_done, 0));
      existing.kills_on += 1;
      existing.damage_done += dmg;
      shipRow.kills_on += 1;
      shipRow.damage_done += dmg;
      if (opts.final_blow) {
        existing.final_blows += 1;
        shipRow.final_blows += 1;
      }
    }

    existing.ships.set(shipKey, shipRow);
    side.participants.set(key, existing);
  };

  for (const [key, e] of entityInventory.entries()) {
    const sideId = sideByEntity.get(key) || "side_unknown";
    getSide(sideId).entities.push({
      key,
      kind: e.kind,
      id: e.id,
      name: e.name,
      ships_lost: e.ships_lost,
      isk_lost: Math.round(e.isk_lost),
      damage_done: Math.round(e.damage_done),
      final_blows: e.final_blows,
      pilot_count: e.pilots.size,
      corporation_count: e.corporations.size,
      alliance_count: e.alliances.size,
    });
  }

  for (const ctx of contexts) {
    const victimSideId = sideForActor(ctx.victim);
    const victimSide = getSide(victimSideId);
    victimSide.iskLost += ctx.total_value;
    victimSide.shipsLost += 1;

    if (ctx.victim.character_id) { victimSide.pilots.add(Number(ctx.victim.character_id)); allPilots.add(Number(ctx.victim.character_id)); }
    if (ctx.victim.corporation_id) { victimSide.corporations.add(Number(ctx.victim.corporation_id)); allCorps.add(Number(ctx.victim.corporation_id)); }
    if (ctx.victim.alliance_id) { victimSide.alliances.add(Number(ctx.victim.alliance_id)); allAlliances.add(Number(ctx.victim.alliance_id)); }

    addParticipant(victimSideId, ctx.victim, {
      asVictim: true,
      total_value: ctx.total_value,
      damage_taken: ctx.damage_taken,
      killmail_id: ctx.killmail_id,
      killmail_time: ctx.killmail_time,
      zkill_url: ctx.zkill_url,
    });

    const shipKey = String(ctx.victim_ship_type_id || "unknown");
    const shipRow = victimSide.shipLosses.get(shipKey) || {
      type_id: ctx.victim_ship_type_id,
      name: ctx.victim_ship_name,
      count: 0,
      value: 0,
    };
    shipRow.count += 1;
    shipRow.value += ctx.total_value;
    victimSide.shipLosses.set(shipKey, shipRow);

    const dmgBySide = new Map();
    let totalDamage = 0;
    for (const a of ctx.attackers) {
      const e = entityFromActor(a);
      const sideId = sideForActor(a);
      const dmg = Math.max(0, safeNumber(a.damage_done, 0));
      totalDamage += dmg;
      dmgBySide.set(sideId, (dmgBySide.get(sideId) || 0) + dmg);
      const side = getSide(sideId);
      side.damageDone += dmg;
      if (a.final_blow) side.finalBlows += 1;
      if (a.character_id) { side.pilots.add(Number(a.character_id)); allPilots.add(Number(a.character_id)); }
      if (a.corporation_id) { side.corporations.add(Number(a.corporation_id)); allCorps.add(Number(a.corporation_id)); }
      if (a.alliance_id) { side.alliances.add(Number(a.alliance_id)); allAlliances.add(Number(a.alliance_id)); }

      addParticipant(sideId, a, {
        asVictim: false,
        damage_done: dmg,
        final_blow: Boolean(a.final_blow),
        killmail_time: ctx.killmail_time,
      });
    }

    for (const [sideId, dmg] of dmgBySide.entries()) {
      const share = totalDamage > 0 ? dmg / totalDamage : 1 / Math.max(dmgBySide.size, 1);
      getSide(sideId).iskKilled += ctx.total_value * share;
    }

    killRows.push({
      killmail_id: ctx.killmail_id,
      killmail_time: ctx.killmail_time,
      solar_system_id: ctx.solar_system_id,
      system_name: ctx.system_name,
      total_value: ctx.total_value,
      damage_taken: ctx.damage_taken,
      victim_name: ctx.victim_name,
      victim_character_id: ctx.victim.character_id || null,
      victim_corporation_id: ctx.victim_corporation_id,
      victim_corporation_name: ctx.victim_corporation_name,
      victim_alliance_id: ctx.victim_alliance_id,
      victim_alliance_name: ctx.victim_alliance_name,
      victim_ship_type_id: ctx.victim_ship_type_id,
      victim_ship_name: ctx.victim_ship_name,
      victim_side_id: victimSideId,
      final_blow_name: ctx.final_blow_name,
      final_blow_character_id: ctx.final_blow?.character_id || null,
      final_blow_corporation_id: ctx.final_blow_corporation_id,
      final_blow_alliance_id: ctx.final_blow_alliance_id,
      zkill_url: ctx.zkill_url,
    });
  }

  const sideList = [...sides.values()].map((side) => {
    const denom = side.iskKilled + side.iskLost;
    const participants = [...side.participants.values()]
      .map((p) => {
        const ships = sortParticipantShips([...(p.ships?.values?.() || [])]).map((ship) => ({
          ...ship,
          isk_lost: Math.round(ship.isk_lost),
          damage_done: Math.round(ship.damage_done),
          amount_tanked: Math.round(ship.amount_tanked || 0),
        }));
        const primary = pickPrimaryParticipantShip(ships);
        return {
          ...p,
          ship_type_id: primary?.ship_type_id || p.ship_type_id || null,
          ship_name: primary?.ship_name || p.ship_name || "Unknown Ship",
          ship_group_name: primary?.ship_group_name || p.ship_group_name || null,
          ship_class: primary?.ship_class || p.ship_class || "Other",
          ship_class_rank: primary?.ship_class_rank || p.ship_class_rank || 90,
          isk_lost: Math.round(p.isk_lost),
          damage_done: Math.round(p.damage_done),
          amount_tanked: Math.round(p.amount_tanked || 0),
          ship_count: ships.length,
          ships,
        };
      })
      .sort((a, b) =>
        (a.ship_class_rank || 90) - (b.ship_class_rank || 90) ||
        String(a.ship_name || "").localeCompare(String(b.ship_name || "")) ||
        b.isk_lost - a.isk_lost ||
        b.damage_done - a.damage_done ||
        b.kills_on - a.kills_on ||
        a.character_name.localeCompare(b.character_name)
      );

    return {
      id: side.id,
      name: side.name,
      iskLost: Math.round(side.iskLost),
      iskKilled: Math.round(side.iskKilled),
      efficiency: denom > 0 ? Number(((side.iskKilled / denom) * 100).toFixed(1)) : 0,
      shipsLost: side.shipsLost,
      damageDone: Math.round(side.damageDone),
      finalBlows: side.finalBlows,
      pilotCount: side.pilots.size,
      corporationCount: side.corporations.size,
      allianceCount: side.alliances.size,
      shipLosses: [...side.shipLosses.values()].sort((a, b) => b.value - a.value || b.count - a.count),
      participants,
      entities: side.entities.sort((a, b) => b.isk_lost - a.isk_lost || b.damage_done - a.damage_done || b.final_blows - a.final_blows),
    };
  }).sort((a, b) => (a.id === "side_unknown" ? 1 : 0) - (b.id === "side_unknown" ? 1 : 0) || b.iskLost - a.iskLost || b.damageDone - a.damageDone);

  const entities = [...entityInventory.values()].map((e) => ({
    key: e.key,
    kind: e.kind,
    id: e.id,
    name: e.name,
    side_id: sideByEntity.get(e.key) || "side_unknown",
    ships_lost: e.ships_lost,
    isk_lost: Math.round(e.isk_lost),
    damage_done: Math.round(e.damage_done),
    final_blows: e.final_blows,
    pilot_count: e.pilots.size,
    corporation_count: e.corporations.size,
    alliance_count: e.alliances.size,
  })).sort((a, b) => b.isk_lost - a.isk_lost || b.damage_done - a.damage_done);

  const totalIskDestroyed = killRows.reduce((sum, k) => sum + safeNumber(k.total_value, 0), 0);
  const startMs = contexts.length ? new Date(contexts[0].killmail_time).getTime() : 0;
  const endMs = contexts.length ? new Date(contexts[contexts.length - 1].killmail_time).getTime() : 0;
  const summary = {
    totalIskDestroyed: Math.round(totalIskDestroyed),
    totalKills: killRows.length,
    shipsLost: killRows.length,
    totalPilots: allPilots.size,
    totalCorporations: allCorps.size,
    totalAlliances: allAlliances.size,
    totalParticipants: allPilots.size,
    durationMinutes: startMs && endMs ? Math.max(0, Math.round((endMs - startMs) / 60000)) : 0,
    sideCount: sideList.filter((s) => s.pilotCount > 0 || s.shipsLost > 0 || s.participants?.length > 0).length,
    valueMode: "zkill",
  };

  return { summary, sides: sideList, entities, killRows };
}

function seedNamesFromReport(report = {}) {
  const out = new Map();
  const add = (id, name) => {
    const numericId = Number(id);
    if (Number.isFinite(numericId) && name) out.set(numericId, name);
  };

  add(report.system_id, report.system_name);
  for (const entity of report.entities || []) add(entity.id, entity.name);
  for (const side of report.sides || []) {
    for (const participant of side.participants || []) {
      add(participant.character_id, participant.character_name);
      add(participant.corporation_id, participant.corporation_name);
      add(participant.alliance_id, participant.alliance_name);
    }
  }
  for (const kill of report?.data?.killmails || []) {
    add(kill.solar_system_id, kill.system_name);
    add(kill.victim_character_id, kill.victim_name);
    add(kill.victim_corporation_id, kill.victim_corporation_name);
    add(kill.victim_alliance_id, kill.victim_alliance_name);
    add(kill.final_blow_character_id, kill.final_blow_name);
  }
  return out;
}

async function resolveNamesForKills(kills, seedNames = null) {
  const ids = [];
  const typeIds = [];

  for (const kill of kills) {
    const esi = kill.esi;
    ids.push(esi.solar_system_id);
    const victim = esi.victim || {};
    ids.push(victim.character_id, victim.corporation_id, victim.alliance_id, victim.faction_id);
    typeIds.push(victim.ship_type_id);
    for (const a of esi.attackers || []) {
      ids.push(a.character_id, a.corporation_id, a.alliance_id, a.faction_id);
      typeIds.push(a.ship_type_id, a.weapon_type_id);
    }
  }

  const [names, typeInfo] = await Promise.all([resolveEsiNames(ids, seedNames), resolveTypeInfo(typeIds)]);
  const typeNames = new Map([...typeInfo.entries()].map(([id, row]) => [id, row.name]));
  return { names, typeNames, typeInfo };
}

async function buildReportFromKills({ id = randomId(), kills, systemId, systemName, startTime, endTime, title, sideOverrides = {}, sideNames = {}, discovery = {}, previousReport = null, onProgress = null }) {
  const progress = onProgress || (() => {});
  const sortedKills = kills
    .filter((k) => k?.esi?.killmail_id)
    .sort((a, b) => new Date(a.esi.killmail_time) - new Date(b.esi.killmail_time));

  progress(`Resolving names and ship types for ${sortedKills.length.toLocaleString()} killmails...`);
  const { names, typeNames, typeInfo } = await resolveNamesForKills(sortedKills, seedNamesFromReport(previousReport || {}));
  progress("Building kill contexts...");
  const allContexts = sortedKills.map((kill) => createKillContext(kill, names, typeNames));
  const allEntityInventory = buildEntityInventory(allContexts, names);
  const excludedKeys = excludedEntityKeys(sideOverrides);
  const excludedKillmailIds = [];
  const contexts = excludedKeys.size
    ? allContexts.filter((ctx) => {
        const excluded = contextHasExcludedEntity(ctx, excludedKeys);
        if (excluded) excludedKillmailIds.push(ctx.killmail_id);
        return !excluded;
      })
    : allContexts;
  if (excludedKillmailIds.length) {
    progress(`Excluded ${excludedKillmailIds.length.toLocaleString()} killmails from the report using ${excludedKeys.size.toLocaleString()} excluded entities.`);
  }
  progress("Inferring teams from attacker/victim relationships...");
  const entityInventory = excludedKillmailIds.length ? buildEntityInventory(contexts, names) : allEntityInventory;
  const inferredSideByEntity = inferBattleSides(contexts, entityInventory, sideOverrides);
  const sideByEntity = stabilizeSideIdentity(inferredSideByEntity, previousReport?.entities || [], sideOverrides);
  progress("Building summary, participants, composition, and kill table...");
  const { summary, sides, killRows } = summarize(contexts, sideByEntity, entityInventory, sideNames, names, typeNames, typeInfo);
  const entities = serializeEntitiesForEditor(allEntityInventory, sideByEntity, sideOverrides);
  summary.excludedKills = excludedKillmailIds.length;
  if (startTime && endTime) {
    const selectedDuration = Math.max(0, Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000));
    if (Number.isFinite(selectedDuration)) summary.durationMinutes = selectedDuration;
  }

  const inferredSystemName = systemName || (systemId ? names.get(Number(systemId)) : contexts[0]?.system_name) || "Unknown System";
  const reportTitle = title || `${inferredSystemName} Battle Report`;

  return {
    id,
    title: reportTitle,
    system_id: systemId || ((discovery?.systemIds || []).length > 1 ? null : contexts[0]?.solar_system_id || null),
    system_name: inferredSystemName,
    start_time: startTime || contexts[0]?.killmail_time || null,
    end_time: endTime || contexts[contexts.length - 1]?.killmail_time || null,
    value_mode: "zkill",
    source_mode: discovery?.eveKillSearchKills ? "zkill_r2z2_evekill_reconciled" : "zkill_r2z2",
    summary,
    sides,
    entities,
    side_overrides: sideOverrides || {},
    side_names: sideNames || {},
    killmails: sortedKills,
    data: {
      killmails: killRows,
      generated_at: new Date().toISOString(),
      discovery,
      exclusions: {
        entity_keys: [...excludedKeys],
        killmail_count: excludedKillmailIds.length,
        killmail_ids: excludedKillmailIds,
      },
      eve_kill_note: "zKill R2Z2 is the primary live source. eve-kill POST /killmails/search is used for scoped reconciliation and historical completeness.",
    },
  };
}

async function hydrateRefsForWindow(refs, { systemId, systemIds, start, end, windows = null, onProgress }) {
  const progress = onProgress || (() => {});
  const kills = [];
  const concurrency = Math.max(1, Math.min(Number(process.env.BR_ESI_HYDRATE_CONCURRENCY || 24), 64));
  let cursor = 0;
  let processed = 0;
  let matched = 0;
  let failed = 0;
  let skippedInvalid = 0;
  const progressEvery = Math.max(10, Number(process.env.BR_PROGRESS_EVERY || 50));
  const systemSet = Array.isArray(systemIds) && systemIds.length
    ? new Set(systemIds.map(Number))
    : (systemId ? new Set([Number(systemId)]) : null);
  const scopedWindows = Array.isArray(windows) && windows.length
    ? windows
        .map((w) => ({
          systemId: Number(w.systemId || w.id),
          start: w.start instanceof Date ? w.start : new Date(w.start || w.startTime),
          end: w.end instanceof Date ? w.end : new Date(w.end || w.endTime),
        }))
        .filter((w) => Number.isFinite(w.systemId) && !Number.isNaN(w.start.getTime()) && !Number.isNaN(w.end.getTime()))
    : null;

  function matchesScope(esi) {
    const kmTime = new Date(esi.killmail_time);
    const kmSystemId = Number(esi.solar_system_id);

    if (scopedWindows?.length) {
      return scopedWindows.some((w) => kmSystemId === Number(w.systemId) && kmTime >= w.start && kmTime <= w.end);
    }

    const inSystem = !systemSet || systemSet.has(kmSystemId);
    const inStart = !start || kmTime >= start;
    const inEnd = !end || kmTime <= end;
    return inSystem && inStart && inEnd;
  }

  async function worker() {
    while (cursor < refs.length) {
      const ref = refs[cursor++];
      try {
        if (!isPlausibleKillmailId(ref?.killmail_id)) {
          skippedInvalid += 1;
          continue;
        }
        const kill = await hydrateKillRef(ref);
        if (kill?.esi && matchesScope(kill.esi)) {
          kills.push(kill);
          matched += 1;
        }
      } catch (err) {
        failed += 1;
        console.warn(`[br] failed to hydrate ${ref.killmail_id}:`, err.message);
      } finally {
        processed += 1;
        if (processed === refs.length || processed % progressEvery === 0) {
          progress(`Hydrating from ESI: ${processed.toLocaleString()} / ${refs.length.toLocaleString()} refs processed, ${matched.toLocaleString()} matched${failed ? `, ${failed.toLocaleString()} failed` : ""}${skippedInvalid ? `, ${skippedInvalid.toLocaleString()} invalid refs skipped` : ""}...`);
        }
      }
    }
  }

  progress(`Hydrating from ESI: 0 / ${refs.length.toLocaleString()} refs processed...`);
  await Promise.all(Array.from({ length: concurrency }, worker));
  return kills;
}

function parseBattleScopes(input) {
  const rows = Array.isArray(input.scopes)
    ? input.scopes
    : Array.isArray(input.windows)
      ? input.windows
      : Array.isArray(input.systemWindows)
        ? input.systemWindows
        : null;

  if (rows?.length) {
    return rows
      .map((row) => ({
        systemQuery: String(row.systemQuery || row.system || row.systemName || row.systemId || "").trim(),
        startTime: row.startTime || row.start || row.start_time,
        endTime: row.endTime || row.end || row.end_time,
      }))
      .filter((row) => row.systemQuery || row.startTime || row.endTime);
  }

  return parseSystemQueries(input).map((systemQuery) => ({
    systemQuery,
    startTime: input.startTime,
    endTime: input.endTime,
  }));
}

async function analyzeBattleReport(input, opts = {}) {
  const progress = opts.onProgress || (() => {});
  const requestedScopes = parseBattleScopes(input);

  progress("Resolving system scope(s) and validating EVE-time windows...");
  const scopes = [];
  for (const row of requestedScopes) {
    const resolved = await resolveSystem(row.systemQuery);
    if (!resolved.id) continue;

    const start = row.startTime ? new Date(row.startTime) : null;
    const end = row.endTime ? new Date(row.endTime) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      const err = new Error(`System ${row.systemQuery || resolved.name} requires valid startTime and endTime in UTC/EVE time.`);
      err.statusCode = 400;
      throw err;
    }
    if (end <= start) {
      const err = new Error(`End time must be after start time for ${row.systemQuery || resolved.name}.`);
      err.statusCode = 400;
      throw err;
    }

    scopes.push({
      query: row.systemQuery,
      id: Number(resolved.id),
      name: resolved.name || row.systemQuery,
      start,
      end,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    });
  }

  const systemIds = [...new Set(scopes.map((s) => Number(s.id)).filter(Boolean))];
  const systemId = systemIds.length === 1 ? systemIds[0] : null;
  const systemName = input.systemName || (
    scopes.length
      ? [...new Map(scopes.map((s) => [Number(s.id), s.name || s.query || String(s.id)])).values()].join(", ")
      : null
  );
  const globalStart = scopes.length ? new Date(Math.min(...scopes.map((s) => s.start.getTime()))) : (input.startTime ? new Date(input.startTime) : null);
  const globalEnd = scopes.length ? new Date(Math.max(...scopes.map((s) => s.end.getTime()))) : (input.endTime ? new Date(input.endTime) : null);
  const refs = [];
  const seen = new Set();
  const discovery = {
    cachedRefs: 0,
    eveKillSearchKills: 0,
    zkillRelatedRefs: 0,
    zkillStartEndRefs: 0,
    zkillRecentRefs: 0,
    zkillRefs: 0,
    r2z2HistoryRefs: 0,
    manualRefs: 0,
    totalRefs: 0,
    hydratedKills: 0,
    systemId,
    systemIds,
    systemNames: [...new Map(scopes.map((s) => [Number(s.id), s.name || s.query || String(s.id)])).values()],
    scopes: scopes.map((s) => ({ systemId: s.id, systemName: s.name, startTime: s.startTime, endTime: s.endTime })),
  };

  if (!scopes.length && !input.zkillUrls && !input.zkillText) {
    const err = new Error("Could not resolve any system scope. Add at least one system row with a system name/ID and EVE-time window.");
    err.statusCode = 400;
    throw err;
  }

  const addRefs = (items, bucket) => {
    let added = 0;
    for (const item of items || []) {
      const ref = normalizeKillRef(item);
      if (!ref || seen.has(ref.killmail_id)) continue;
      seen.add(ref.killmail_id);
      refs.push(ref);
      added += 1;
    }
    discovery[bucket] = (discovery[bucket] || 0) + added;
    return added;
  };

  const directKills = [];
  const directSeen = new Set();
  const addDirectKills = (items, bucket) => {
    let added = 0;
    for (const kill of items || []) {
      const id = Number(kill?.esi?.killmail_id);
      if (!isPlausibleKillmailId(id) || directSeen.has(id)) continue;
      directSeen.add(id);
      directKills.push(kill);
      added += 1;
    }
    discovery[bucket] = (discovery[bucket] || 0) + added;
    return added;
  };

  const scopeSummary = scopes.length
    ? scopes.map((s) => `${s.name || s.query} (${s.id}) ${s.start.toISOString().slice(0,16).replace("T", " ")}–${s.end.toISOString().slice(0,16).replace("T", " ")}`).join("; ")
    : "manual refs only";
  progress(`Scope resolved as ${scopeSummary}. Checking manual refs and local cache...`);

  const manual = await discoverByManualUrls(input.zkillUrls || input.zkillText || "");
  addRefs(manual, "manualRefs");
  if (manual.length) progress(`Manual refs: ${manual.length.toLocaleString()} found.`);

  if (scopes.length) {
    let cachedCount = 0;
    for (const scope of scopes) {
      const cachedRows = await getCachedBySystemWindow(scope.id, scope.start.toISOString(), scope.end.toISOString());
      cachedCount += cachedRows.length;
      addRefs(cachedRows.map((row) => ({
        killmail_id: row.killmail_id,
        hash: row.killmail_hash,
        zkb: row.raw_zkb,
      })), "cachedRefs");
    }
    if (cachedCount) progress(`Local cache: ${cachedCount.toLocaleString()} cached killmails already in the selected scope(s).`);
  }

  const shouldUseZkillDiscovery = true;

  if (scopes.length && shouldUseZkillDiscovery) {
    for (const scope of scopes) {
      const selectedWindowHours = (scope.end.getTime() - scope.start.getTime()) / 3600000;
      const scopedName = scope.name || scope.query || scope.id;

      if (process.env.BR_ENABLE_ZKILL_RELATED === "true") {
        progress(`Discovering related battle refs for ${scopedName} from zKill related endpoint...`);
        addRefs(await discoverByZkillRelated(scope.id, scope.start, scope.end, { onProgress: progress }), "zkillRelatedRefs");
      }

      if (process.env.BR_DISABLE_ZKILL_STARTEND !== "true") {
        progress(`Discovering precise zKill system start/end refs for ${scopedName}...`);
        addRefs(await discoverBySystemStartEnd(scope.id, scope.start, scope.end, { onProgress: progress }), "zkillStartEndRefs");
      }

      progress(`Discovering recent zKill refs for ${scopedName}...`);
      const recentRefs = await discoverBySystemPastSeconds(scope.id, scope.start, scope.end, { onProgress: progress });
      addRefs(recentRefs, "zkillRecentRefs");

      const monthSupplementMinRefs = Number(process.env.BR_ZKILL_MONTH_SUPPLEMENT_MIN_REFS || 1000);
      const monthSupplementMinHours = Number(process.env.BR_ZKILL_MONTH_SUPPLEMENT_MIN_HOURS || 6);
      const historicalAfterDays = Number(process.env.BR_ZKILL_HISTORICAL_AFTER_DAYS || 7);
      const isHistoricalWindow = (Date.now() - scope.end.getTime()) >= historicalAfterDays * 24 * 60 * 60 * 1000;

      const deepSearchRequested = input.useR2Z2History === true;
      const monthSupplementEnabled = process.env.BR_ENABLE_ZKILL_MONTH_SUPPLEMENT === "true";
      const autoHistoricalMonth = process.env.BR_AUTO_ZKILL_MONTH_FOR_OLD !== "false" && isHistoricalWindow;

      const shouldSupplementMonth =
        deepSearchRequested ||
        monthSupplementEnabled ||
        autoHistoricalMonth ||
        (process.env.BR_ENABLE_ZKILL_MONTH_SUPPLEMENT === "true" &&
          (refs.length === 0 || refs.length >= monthSupplementMinRefs || selectedWindowHours >= monthSupplementMinHours));

      if (shouldSupplementMonth) {
        const reason = deepSearchRequested
          ? "deep search requested"
          : monthSupplementEnabled
            ? "BR_ENABLE_ZKILL_MONTH_SUPPLEMENT=true"
            : autoHistoricalMonth
              ? `historical window older than ${historicalAfterDays} days`
              : "threshold met";
        progress(`Supplementing ${scopedName} discovery with zKill month pages (${reason}; ${refs.length.toLocaleString()} refs found so far)...`);
        addRefs(await discoverBySystemZkillApi(scope.id, scope.start, scope.end, { onProgress: progress }), "zkillRefs");
      } else if (isHistoricalWindow) {
        progress(`Historical zKill month supplement skipped for ${scopedName}. Enable the deep search checkbox or set BR_ENABLE_ZKILL_MONTH_SUPPLEMENT=true if this old BR is missing kills.`);
      }
    }
  }

  if (scopes.length && process.env.BR_DISABLE_EVEKILL_SEARCH !== "true") {
    progress("Reconciling zKill discovery against eve-kill system/time search...");
    try {
      const eveKillKills = await discoverByEveKillSearch(scopes, { onProgress: progress });
      const added = addDirectKills(eveKillKills, "eveKillSearchKills");
      progress(`eve-kill reconciliation returned ${eveKillKills.length.toLocaleString()} matching killmails (${added.toLocaleString()} direct results).`);
    } catch (err) {
      discovery.eveKillSearchError = err.message || String(err);
      console.warn("[br] eve-kill reconciliation failed:", err.message);
      progress(`eve-kill reconciliation failed (${err.message}); continuing with zKill/ESI results.`);
    }
  } else if (process.env.BR_DISABLE_EVEKILL_SEARCH === "true") {
    discovery.eveKillSearchSkipped = "BR_DISABLE_EVEKILL_SEARCH=true";
  }

  const inlineR2Z2Allowed = process.env.BR_ALLOW_INLINE_R2Z2_HISTORY === "true";
  const inlineR2Z2Requested = input.useR2Z2History === true;
  if (inlineR2Z2Allowed && inlineR2Z2Requested && scopes.length) {
    for (const scope of scopes) {
      const windowHours = (scope.end.getTime() - scope.start.getTime()) / 3600000;
      if (windowHours <= Number(process.env.BR_R2Z2_AUTO_MAX_HOURS || 12)) {
        progress(`Deep R2Z2 history search enabled for ${scope.name || scope.query}. Loading global daily history refs...`);
        addRefs(await discoverByR2Z2History(scope.start, scope.end, { onProgress: progress }), "r2z2HistoryRefs");
      }
    }
  } else if (inlineR2Z2Requested && !inlineR2Z2Allowed) {
    discovery.r2z2HistorySkipped = "Inline R2Z2 history is disabled. It is a global daily dump and can exceed proxy/request timeouts. Set BR_ALLOW_INLINE_R2Z2_HISTORY=true only if you really want request-time global day hydration.";
  }

  discovery.totalRefs = refs.length;
  progress(`Discovered ${refs.length.toLocaleString()} unique zKill killmail refs and ${directKills.length.toLocaleString()} eve-kill reconciliation results.`);
  let kills = [];
  if (refs.length) {
    progress(`Hydrating ${refs.length.toLocaleString()} legacy refs from ESI/cache...`);
    kills = await hydrateRefsForWindow(refs, {
      systemId,
      systemIds,
      start: globalStart,
      end: globalEnd,
      windows: scopes.map((s) => ({ systemId: s.id, start: s.start, end: s.end })),
      onProgress: progress,
    });
  }

  let deduped = [...new Map(directKills.concat(kills).map((k) => [k.esi.killmail_id, k])).values()];

  const historicalAfterDaysForCharLoss = Number(process.env.BR_ZKILL_HISTORICAL_AFTER_DAYS || 7);
  const hasHistoricalScopeForCharLoss = scopes.some((s) => (Date.now() - s.end.getTime()) >= historicalAfterDaysForCharLoss * 24 * 60 * 60 * 1000);
  const charLossSupplementEnabled =
    process.env.BR_ENABLE_ZKILL_CHARACTER_LOSS_SUPPLEMENT === "true" &&
    process.env.BR_DISABLE_ZKILL_CHARACTER_LOSS_SUPPLEMENT !== "true" &&
    scopes.length &&
    deduped.length;

  if (charLossSupplementEnabled) {
    const beforeSupplementRefCount = refs.length;
    const charLossRefs = await discoverCharacterMonthLossRefs(scopes, deduped, { onProgress: progress });
    const addedCharLossRefs = addRefs(charLossRefs, "zkillCharacterLossRefs");

    if (addedCharLossRefs > 0) {
      const supplementalRefs = refs.slice(beforeSupplementRefCount);
      progress(`Character monthly loss supplement added ${addedCharLossRefs.toLocaleString()} new refs. Hydrating supplemental losses...`);
      const supplementalKills = await hydrateRefsForWindow(supplementalRefs, {
        systemId,
        systemIds,
        start: globalStart,
        end: globalEnd,
        windows: scopes.map((s) => ({ systemId: s.id, start: s.start, end: s.end })),
        onProgress: progress,
      });
      kills = deduped.concat(supplementalKills);
      deduped = [...new Map(kills.map((k) => [k.esi.killmail_id, k])).values()];
      discovery.totalRefs = refs.length;
      progress(`After character monthly loss supplement: ${deduped.length.toLocaleString()} matching killmails from ${refs.length.toLocaleString()} refs.`);
    } else {
      progress("Character monthly loss supplement found no additional refs.");
    }
  }

  discovery.hydratedKills = deduped.length;
  progress(`Hydrated ${deduped.length.toLocaleString()} matching killmails.`);

  if (!deduped.length) {
    const err = new Error("No matching killmails were found after zKill discovery and eve-kill reconciliation. Check the system names/IDs and EVE-time windows.");
    err.statusCode = 404;
    throw err;
  }

  if (process.env.BR_DISABLE_EVEKILL_VALUE_ENRICH !== "true" && process.env.BR_EVEKILL_SKIP_VALUE_ENRICH !== "true") {
    deduped = await enrichEveKillValues(deduped, { onProgress: progress });
    discovery.valueSource = "zkill-with-eve-kill-missing-value-fallback";
  } else {
    discovery.valueSource = "existing_values_only";
  }

  progress("Building report...");

  return buildReportFromKills({
    kills: deduped,
    systemId,
    systemName,
    startTime: globalStart ? globalStart.toISOString() : input.startTime,
    endTime: globalEnd ? globalEnd.toISOString() : input.endTime,
    title: input.title,
    sideOverrides: input.sideOverrides || {},
    sideNames: input.sideNames || {},
    discovery,
    onProgress: progress,
  });
}

async function rebuildExistingReport(reportRow, killRows, sideOverrides, sideNames) {
  const kills = killRows.map((row) => ({
    esi: row.raw_esi,
    zkb: row.raw_zkb || {},
    totalValue: safeNumber(row.total_value, readZkbTotal(row.raw_zkb || {})),
  }));
  return buildReportFromKills({
    id: reportRow.id,
    kills,
    systemId: reportRow.system_id,
    systemName: reportRow.system_name,
    startTime: reportRow.start_time,
    endTime: reportRow.end_time,
    title: reportRow.title,
    sideOverrides,
    sideNames,
    discovery: reportRow?.data?.discovery || {},
    previousReport: reportRow,
  });
}

module.exports = {
  analyzeBattleReport,
  rebuildExistingReport,
  buildReportFromKills,
  stabilizeSideIdentity,
  seedNamesFromReport,
  normalizeKillRef,
  hydrateKillRef,
  discoverByR2Z2History,
  discoverByEveKillSearch,
  enrichKillsWithZkillValues,
  discoverBySystemPastSeconds,
  discoverBySystemStartEnd,
  discoverCharacterMonthLossRefs,
  discoverByZkillRelated,
  resolveSystem,
};
