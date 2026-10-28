/*
 * Express router for wormholes API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const pool = require("../db");

const ENRICHED_SYSTEMS_PATH = path.join(__dirname, "..", "data", "enriched_systems.json");
const TRUE_A0_STAR_TYPE_ID = 3801;

let enrichedSystemsCache = null;

function getEnrichedSystems() {
  if (enrichedSystemsCache) return enrichedSystemsCache;

  try {
    enrichedSystemsCache = JSON.parse(fs.readFileSync(ENRICHED_SYSTEMS_PATH, "utf8"));
  } catch (err) {
    console.warn("[WORMHOLE_DATABASE]: Could not load enriched_systems.json:", err.message);
    enrichedSystemsCache = {};
  }

  return enrichedSystemsCache;
}

function normalizeJcode(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase();
  const standard = raw.match(/J\d{6}/);
  if (standard) return standard[0];
  const nonStandard = raw.match(/^J[0-9-]+$/);
  return nonStandard ? nonStandard[0] : null;
}

function normalizeStatics(statics) {
  if (!Array.isArray(statics)) return [];

  return Array.from(
    new Set(
      statics
        .map((code) => String(code || "").trim().toUpperCase())
        .filter((code) => /^[A-Z]\d{3}$/.test(code))
    )
  );
}

function planetTypeLabel(typeName) {
  return String(typeName || "")
    .replace(/^Planet\s*\(/i, "")
    .replace(/^Planet\s+/i, "")
    .replace(/\)$/g, "")
    .trim();
}

function summarizePlanets(planets) {
  const counts = new Map();

  for (const planet of planets) {
    const label = planetTypeLabel(planet.type_name);
    if (!label) continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => ({ type, count }));
}

function moonCount(planets) {
  return planets.reduce((total, planet) => total + (Number(planet.moon_count) || 0), 0);
}

function isShatteredSystem(system, planets) {
  const starName = String(system.star_name || "").toLowerCase();
  return (
    starName.includes("a0iv") ||
    planets.some((planet) => String(planet.type_name || "").toLowerCase().includes("shattered"))
  );
}

function isA0Star(system) {
  const starTypeId = Number(system.star_type_id);
  if (Number.isFinite(starTypeId)) return starTypeId === TRUE_A0_STAR_TYPE_ID;
  return /^Sun A0\b(?!IV)/i.test(String(system.star_name || ""));
}

function normalizePlanet(row) {
  return {
    ...row,
    planet_id: row.planet_id != null ? String(row.planet_id) : row.planet_id,
    id: row.planet_id != null ? String(row.planet_id) : row.id,
    esi_name: row.name,
    moon_count: Number(row.moon_count) || 0,
    moons: Number(row.moon_count) || 0,
  };
}

function normalizeSystem(row, planetsByJcode) {
  const jcode = normalizeJcode(row.jcode) || row.jcode;
  const enriched = getEnrichedSystems()[jcode] || {};
  const enrichedStar = enriched.celestials?.star || {};
  const planets = (planetsByJcode.get(jcode) || []).map(normalizePlanet);

  const starId = row.star_id ?? enrichedStar.id ?? null;
  const starTypeId = row.star_type_id ?? enrichedStar.type_id ?? null;
  const starName = row.star_name ?? enrichedStar.name ?? null;
  const statics = normalizeStatics(enriched.statics || row.statics);

  const system = {
    ...row,
    jcode,
    solarsystemid: row.solarsystemid != null ? String(row.solarsystemid) : row.solarsystemid,
    solarSystemID: row.solarsystemid != null ? Number(row.solarsystemid) : null,
    solar_system_id: row.solarsystemid != null ? Number(row.solarsystemid) : null,
    statics,
    star_id: starId != null ? String(starId) : null,
    star_type_id: starTypeId != null ? Number(starTypeId) : null,
    star_name: starName,
    star: {
      id: starId != null ? String(starId) : null,
      type_id: starTypeId != null ? Number(starTypeId) : null,
      name: starName,
    },
    planets,
  };

  return {
    ...system,
    planetCount: planets.length,
    moonCount: moonCount(planets),
    planetSummary: summarizePlanets(planets),
    shattered: isShatteredSystem(system, planets),
    isShattered: isShatteredSystem(system, planets),
    isA0: isA0Star(system),
    isA0Star: isA0Star(system),
  };
}

async function fetchSystemsWithPlanets(whereClause = "", params = []) {
  const systemsRes = await pool.query(
    `SELECT * FROM wormhole_systems ${whereClause} ORDER BY jcode`,
    params
  );

  if (!systemsRes.rows.length) return [];

  const jcodes = systemsRes.rows.map((system) => system.jcode);
  const planetsRes = await pool.query(
    "SELECT * FROM planets WHERE jcode = ANY($1::text[]) ORDER BY jcode, name",
    [jcodes]
  );

  const planetsByJcode = new Map();
  for (const planet of planetsRes.rows) {
    const list = planetsByJcode.get(planet.jcode) || [];
    list.push(planet);
    planetsByJcode.set(planet.jcode, list);
  }

  return systemsRes.rows.map((system) => normalizeSystem(system, planetsByJcode));
}

router.get("/", async (req, res) => {
  try {
    const systems = await fetchSystemsWithPlanets();
    res.json(systems);
  } catch (err) {
    console.error("[WORMHOLE_DATABASE]: Error fetching wormholes:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/summary", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT jcode, class, effect, statics
      FROM wormhole_systems
      ORDER BY jcode
    `);

    const enrichedSystems = getEnrichedSystems();
    res.json(
      result.rows.map((row) => ({
        ...row,
        statics: normalizeStatics(enrichedSystems[row.jcode]?.statics || row.statics),
      }))
    );
  } catch (err) {
    console.error("[WORMHOLE_DATABASE]: Error fetching wormhole summaries:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:jcode", async (req, res) => {
  const jcode = normalizeJcode(req.params.jcode);
  if (!jcode) return res.status(400).json({ error: "Invalid wormhole J-code" });

  try {
    const systems = await fetchSystemsWithPlanets("WHERE jcode = $1", [jcode]);
    if (!systems.length) return res.status(404).json({ error: "Wormhole system not found" });
    return res.json(systems[0]);
  } catch (err) {
    console.error("[WORMHOLE_DATABASE]: Error fetching wormhole:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
