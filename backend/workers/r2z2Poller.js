/*
 * Background worker for r2z2Poller.
 * Runs polling or import loops using external EVE data sources and Postgres side effects.
 */

const axios = require("axios");
const {
  ensureBattleReportSchema,
  upsertKillmailCache,
  attachKillmailToLiveReports,
  getR2Z2Cursor,
  setR2Z2Cursor,
} = require("../services/battleReports/db");
const { setBattleReportIngestLag } = require("../lib/metrics");

const UA = process.env.BR_USER_AGENT || "Triff.Tools Battle Reports (+https://triff.tools)";
const BASE = "https://r2z2.zkillboard.com/ephemeral";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let running = false;
let stopped = false;

async function getJson(url, opts = {}) {
  const res = await axios.get(url, {
    timeout: opts.timeout || 30000,
    validateStatus: () => true,
    headers: {
      "User-Agent": UA,
      "Accept-Encoding": "gzip",
      Accept: "application/json",
    },
  });

  if (res.status === 404) return null;
  if (res.status === 429 || res.status === 420 || res.status === 502 || res.status === 503 || res.status === 504) {
    const attempt = Number(opts.attempt || 0);
    if (attempt >= Number(process.env.R2Z2_MAX_RETRIES || 8)) {
      throw new Error(`GET ${url} failed: HTTP ${res.status} after ${attempt} retries`);
    }
    const delay = Math.min(Number(opts.retryDelay || 2000) * 1.7, 30000);
    await sleep(delay);
    return getJson(url, { ...opts, attempt: attempt + 1, retryDelay: delay });
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`GET ${url} failed: HTTP ${res.status}`);
  }
  return res.data;
}

function parseSequencePayload(payload) {
  if (!payload) return null;
  const esi = payload.esi || payload.killmail || payload.raw_esi;
  if (!esi?.killmail_id) return null;
  return {
    esi,
    zkb: payload.zkb || payload.raw_zkb || {},
    hash: payload.hash || payload.killmail_hash || payload.zkb?.hash || null,
    sequenceId: payload.sequence_id || payload.sequence || null,
  };
}

async function getCurrentSequence() {
  const current = await getJson(`${BASE}/sequence.json`);
  const currentSeq = Number(current?.sequence);
  if (!Number.isSafeInteger(currentSeq) || currentSeq <= 0) {
    throw new Error("R2Z2 sequence.json did not contain a valid sequence number");
  }
  return currentSeq;
}

async function getStartingSequence() {
  const configured = Number(process.env.R2Z2_START_SEQUENCE || 0);
  if (Number.isSafeInteger(configured) && configured > 0) return configured;

  const saved = await getR2Z2Cursor("default");
  if (Number.isSafeInteger(saved) && saved > 0) return saved;

  const currentSeq = await getCurrentSequence();
  const backfill = Math.max(0, Number(process.env.R2Z2_START_BACKFILL || 20000));
  return Math.max(1, currentSeq - backfill);
}

async function startR2Z2Poller() {

  if (process.env.R2Z2_POLLER_ENABLED === "false") {
    console.log("[r2z2] disabled by R2Z2_POLLER_ENABLED=false");
    return;
  }
  if (running) return;
  running = true;
  stopped = false;

  await ensureBattleReportSchema();
  let sequence = await getStartingSequence();
  console.log(`[r2z2] starting at sequence ${sequence}`);

  let processedSincePersist = 0;
  while (!stopped) {
    try {
      const payload = await getJson(`${BASE}/${sequence}.json`);
      if (!payload) {
        await setR2Z2Cursor("default", sequence);

        await sleep(Number(process.env.R2Z2_EMPTY_SLEEP_MS || 6000));
        continue;
      }

      const parsed = parseSequencePayload(payload);
      if (parsed) {
        parsed.sequenceId = Number(parsed.sequenceId || sequence);
        parsed.zkb = {
          ...(parsed.zkb || {}),
          _triff_ingest_source: "zkill-r2z2",
          ...(Number(parsed.zkb?.totalValue ?? parsed.zkb?.total_value ?? 0) > 0
            ? { _triff_value_source: "zkill" }
            : {}),
        };
        const cached = await upsertKillmailCache(parsed);
        await attachKillmailToLiveReports({
          esi: parsed.esi,
          zkb: parsed.zkb,
          totalValue: cached?.total_value,
          sequenceId: parsed.sequenceId,
        });
        setBattleReportIngestLag(parsed.esi.killmail_time);
      }

      sequence += 1;
      processedSincePersist += 1;
      if (processedSincePersist >= Number(process.env.R2Z2_PERSIST_EVERY || 25)) {
        await setR2Z2Cursor("default", sequence);
        processedSincePersist = 0;
      }

      await sleep(Number(process.env.R2Z2_POLL_DELAY_MS || 100));
    } catch (err) {
      console.warn("[r2z2] poll error:", err.message);
      try {
        await setR2Z2Cursor("default", sequence);
      } catch (stateErr) {
        console.warn("[r2z2] failed to persist cursor:", stateErr.message);
      }
      await sleep(Number(process.env.R2Z2_ERROR_SLEEP_MS || 6000));
    }
  }
}

function stopR2Z2Poller() {
  stopped = true;
}

module.exports = { startR2Z2Poller, stopR2Z2Poller };
