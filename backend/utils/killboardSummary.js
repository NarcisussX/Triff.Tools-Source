/*
 * Backend utility module for killboard Summary.
 * Provides reusable helper functions for routes, workers, or startup tasks.
 */

const axios = require("axios");
const dayjs = require("dayjs");
const fetchESI = require("./esiRequest");

const ESI_BASE = "https://esi.evetech.net/latest";
const ZKILLBOARD_BASE = "https://zkillboard.com/api";
const MAX_AGE_DAYS = 60;
const BATCH_SIZE = 20;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getCorpName(id, cache) {
  if (cache[id]) return cache[id];
  try {
    const data = await fetchESI(`${ESI_BASE}/corporations/${id}/`);
    cache[id] = data.name;
    return data.name;
  } catch {
    cache[id] = "Unknown Corp";
    return "Unknown Corp";
  }
}

async function getAllianceName(id, cache) {
  if (cache[id]) return cache[id];
  try {
    const data = await fetchESI(`${ESI_BASE}/alliances/${id}/`);
    cache[id] = data.name;
    return data.name;
  } catch {
    cache[id] = "Unknown Alliance";
    return "Unknown Alliance";
  }
}

module.exports = async function summarizeKillboard(solarSystemID) {
  const killmails = await axios.get(`${ZKILLBOARD_BASE}/solarSystemID/${solarSystemID}/`);

  const corpCache = {};
  const allianceCache = {};
  const corpActivity = {};
  const allianceActivity = {};

  let totalKills = 0;
  let mostRecentKill = null;
  let oldestValidKill = null;
  const now = dayjs();

  for (let i = 0; i < killmails.data.length; i += BATCH_SIZE) {
    const batch = killmails.data.slice(i, i + BATCH_SIZE);
    const detailedResults = await Promise.allSettled(
      batch.map((k) => fetchESI(`${ESI_BASE}/killmails/${k.killmail_id}/${k.zkb.hash}/`))
    );

    for (const result of detailedResults) {
      if (result.status !== "fulfilled") continue;
      const kill = result.value;
      if (!kill || !kill.killmail_time) continue;
      const killDate = dayjs(kill.killmail_time);

      if (!mostRecentKill || killDate.isAfter(mostRecentKill)) mostRecentKill = killDate;
      if (!oldestValidKill || killDate.isBefore(oldestValidKill)) oldestValidKill = killDate;

      const age = now.diff(killDate, "day");
      if (age > MAX_AGE_DAYS) return summarize();

      totalKills++;

      const involved = [kill.victim, ...(kill.attackers || [])];
      for (const entity of involved) {
        if (entity.corporation_id) {
          const id = entity.corporation_id.toString();
          const lastSeen = Math.min(corpActivity[id]?.lastSeen ?? Infinity, age);
          const activeDays = new Set(corpActivity[id]?.days ?? []);
          activeDays.add(killDate.format("YYYY-MM-DD"));
          corpActivity[id] = { lastSeen, days: activeDays };
        }
        if (entity.alliance_id) {
          const id = entity.alliance_id.toString();
          const lastSeen = Math.min(allianceActivity[id]?.lastSeen ?? Infinity, age);
          const activeDays = new Set(allianceActivity[id]?.days ?? []);
          activeDays.add(killDate.format("YYYY-MM-DD"));
          allianceActivity[id] = { lastSeen, days: activeDays };
        }
      }
    }
  }

  function summarize() {
    return Promise.all([
      Promise.all(
        Object.entries(corpActivity).map(async ([id, { lastSeen, days }]) => ({
          id,
          name: await getCorpName(id, corpCache),
          lastSeenDaysAgo: lastSeen,
          activeDays: days.size,
        }))
      ),
      Promise.all(
        Object.entries(allianceActivity).map(async ([id, { lastSeen, days }]) => ({
          id,
          name: await getAllianceName(id, allianceCache),
          lastSeenDaysAgo: lastSeen,
          activeDays: days.size,
        }))
      ),
    ]).then(([corpList, allianceList]) => ({
      totalKills,
      daysCovered: now.diff(oldestValidKill, "day"),
      mostRecentKillDaysAgo: now.diff(mostRecentKill, "day"),
      activeCorporations: corpList.sort((a, b) => a.lastSeenDaysAgo - b.lastSeenDaysAgo),
      activeAlliances: allianceList.sort((a, b) => a.lastSeenDaysAgo - b.lastSeenDaysAgo),
    }));
  }

  return summarize();
};
