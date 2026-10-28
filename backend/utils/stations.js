/*
 * Backend utility module for stations.
 * Provides reusable helper functions for routes, workers, or startup tasks.
 */

const STATION_IDS = {

  'Jita 4-4': 60003760,
  'Amarr VIII': 60008494,
  'Dodixie': 60011866,
  'Rens': 60004588,
  'Hek': 60005686,
};

function resolveStationId(input) {
  if (input == null) return undefined;

  const n = Number(input);
  if (Number.isFinite(n)) return n;

  if (STATION_IDS[input]) return STATION_IDS[input];

  const key = String(input).trim().toLowerCase();
  const hit = Object.entries(STATION_IDS).find(([k]) => k.toLowerCase() === key);
  return hit ? hit[1] : undefined;
}

module.exports = { STATION_IDS, resolveStationId };
