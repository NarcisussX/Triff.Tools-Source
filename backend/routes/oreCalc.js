/*
 * Express router for ore Calc API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require("express");
const router = express.Router();
const oreData = require("./data/ore_data.json");
const moonOreData = require("./data/moon_ore_data.json");
const modules = require("./data/mining_modules.json");
const crystals = require("./data/mining_crystals.json");
const ships = require("./data/mining_ship_bonuses.json");
const pool = require("../db/pool");

const LOW_SLOT_UPGRADES = {
  "Mining Laser Upgrade II": 0.09,
  "Elara Restrained Mining Laser Upgrade": 0.08,
  "'Aoede' Mining Laser Upgrade": 0.10,
  "'Carpo' Mining Laser Upgrade": 0.09,
  "Mining Laser Upgrade I": 0.05
};

const IMPLANT_BONUSES = {
  None: 0,
  "Inherent Implants 'Highwall' Mining MX-1001": 0.01,
  "Inherent Implants 'Highwall' Mining MX-1003": 0.03,
  "Inherent Implants 'Highwall' Mining MX-1005": 0.05
};

const SURVEY_CHIPSET_BONUSES = {
  None: { chanceMult: 1.0, bonusMult: 1.0 },
  T1: { chanceMult: 1.12, bonusMult: 1.12 },
  T2: { chanceMult: 1.2, bonusMult: 1.2 }
};

const FAST_CYCLE_FACTOR = 4;
const JITA_4_4_STATION_ID = 60003760;

const BASE_CRIT_CHANCE = 0.01;
const BASE_CRIT_BONUS = 2.0;

const industrialCoreBonuses = {
  Porpoise: { T1: 0.05, T2: 0.075 },
  Orca: { T1: 0.10, T2: 0.15 },
  Rorqual: { T1: 0.30, T2: 0.40 },
};

function normalizeIndustrialCoreTier(value) {
  if (value === "T1" || value === "T2") return value;
  if (value === "Yes") return "T2";
  return "No";
}

function getIndustrialCoreBonus(boostShip, industrialCore) {
  const tier = normalizeIndustrialCoreTier(industrialCore);
  return industrialCoreBonuses[boostShip]?.[tier] || 0;
}

function normalizeOreData(rawOreData) {
  if (Array.isArray(rawOreData)) return rawOreData;
  return Object.entries(rawOreData || {}).map(([name, info]) => ({
    name,
    baseName: name,
    grade: "I",
    yieldBonus: 0,
    m3: Number(info?.m3) || 0,
    marketTypeId: Number(info?.marketTypeId ?? info?.id) || null,
    legacyName: name,
  }));
}

const oreRows = normalizeOreData(oreData);
const moonOreRows = normalizeOreData(moonOreData);
const allOreRows = [...oreRows, ...moonOreRows];

function compatibleResourceTypesForCrystal(crystalName) {
  const crystal = crystals[crystalName];
  if (!crystalName || !crystal) return ["ore", "moonOre"];
  return [crystal.resourceType === "moonOre" ? "moonOre" : "ore"];
}

function calculateResourceRows(rows, priceByTypeId, m3PerHour) {
  return rows.map((oreInfo) => {
    const marketTypeId = Number(oreInfo.marketTypeId);
    const price = priceByTypeId.get(marketTypeId) || 0;
    const unitsPerHour = oreInfo.m3 > 0 ? m3PerHour / oreInfo.m3 : 0;

    return {
      name: oreInfo.name,
      baseName: oreInfo.baseName || oreInfo.name,
      grade: oreInfo.grade || "I",
      yieldBonus: Number(oreInfo.yieldBonus) || 0,
      marketTypeId,
      legacyName: oreInfo.legacyName || oreInfo.name,
      rarity: oreInfo.rarity || null,
      family: oreInfo.family || null,
      m3: Number(oreInfo.m3) || 0,
      iskPerUnit: price,
      unitsPerHour: Math.round(unitsPerHour),
      iskPerHour: Math.round(price * unitsPerHour)
    };
  });
}

async function fetchOrePriceByTypeId(typeIds) {
  const ids = Array.from(new Set(typeIds.map(Number).filter(Number.isFinite)));
  if (!ids.length) return new Map();

  const { rows } = await pool.query(
    `
    SELECT type_id, buy_max
    FROM market_station_aggregates
    WHERE station_id = $1 AND type_id = ANY($2::int[])
    `,
    [JITA_4_4_STATION_ID, ids]
  );

  return new Map(
    rows.map((row) => [Number(row.type_id), Number(row.buy_max) || 0])
  );
}

function getBurstStrength(
  boostShip,
  miningDirector,
  industrialCommand,
  capitalIndustrial,
  miningDestroyer,
  boostImplant,
  boostModule,
  bastion
) {
  if (boostShip === "None") return 0;

  let shipBonus = 0;

  if (boostShip === "Orca") {
    shipBonus = 0.03 * industrialCommand;
  } else if (boostShip === "Porpoise") {
    shipBonus = 0.02 * industrialCommand;
  } else if (boostShip === "Rorqual") {

    shipBonus = 0.05 * capitalIndustrial;
  } else if (boostShip === "Outrider") {

    shipBonus = 0.02 * miningDestroyer;
  }

  const skillBonus = 0.1 * miningDirector;

  const implantBonus =
    boostImplant === "mindlink" || boostImplant === "ore" ? 0.25 : 0;

  const moduleBonus = boostModule === "T2" ? 0.25 : 0;
  const industrialCoreBonus = getIndustrialCoreBonus(boostShip, bastion);

  return (
    (1 + shipBonus) *
    (1 + skillBonus) *
    (1 + implantBonus) *
    (1 + moduleBonus) *
    (1 + industrialCoreBonus)
  );
}

function miningDurationMultiplier(
  baseMult,
  boostShip,
  miningDirector,
  industrialCommand,
  capitalIndustrial,
  miningDestroyer,
  boostImplant,
  boostModule,
  bastion
) {
  if (boostShip === "None") return baseMult;

  const baseBoost = 0.15;
  const burstStrength = getBurstStrength(
    boostShip,
    miningDirector,
    industrialCommand,
    capitalIndustrial,
    miningDestroyer,
    boostImplant,
    boostModule,
    bastion
  );

  const boostReduction = baseBoost * burstStrength;
  const multiplier = 1 - boostReduction;

  return baseMult * multiplier;
}

function critChanceMultiplierFromBoost(
  boostShip,
  miningDirector,
  industrialCommand,
  capitalIndustrial,
  miningDestroyer,
  boostImplant,
  boostModule,
  bastion,
  efficiencyChargeActive
) {

  if (boostShip === "None" || !efficiencyChargeActive) return 1;

  const baseCritBoost = 0.5;
  const burstStrength = getBurstStrength(
    boostShip,
    miningDirector,
    industrialCommand,
    capitalIndustrial,
    miningDestroyer,
    boostImplant,
    boostModule,
    bastion
  );

  return 1 + baseCritBoost * burstStrength;
}

function getShipBonuses(ship, shipSkills) {
  const data = ships[ship];
  if (!data) {
    return { cycleMult: 1, yieldMult: 1, critChanceBonus: 0 };
  }

  const type = data.type;
  let cycleMult = 1;
  let yieldMult = 1;
  const critChanceBonus = parseFloat(data.critChanceBonus || 0);

  const miningSkill = shipSkills.mining || 0;
  const astroSkill = shipSkills.astrogeology || 0;
  const bargeSkill = shipSkills.barge || 0;
  const exhumerSkill = shipSkills.exhumer || 0;
  const frigateSkill = shipSkills.frigate || 0;
  const expeditionSkill = shipSkills.expedition || 0;
  const destroyerSkill = shipSkills.destroyer || 0;

  if (type === "barge") {
    cycleMult =
      (1 - parseFloat(data.shipBonusCycleTime)) *
      (1 - parseFloat(data.skillBargeCycleTime) * bargeSkill);

    yieldMult =
      (1 + parseFloat(data.shipBonusYield)) *
      (1 + parseFloat(data.skillBargeYield) * bargeSkill) *
      (1 + 0.05 * miningSkill) *
      (1 + 0.05 * astroSkill);
  } else if (type === "exhumer") {
    cycleMult =
      (1 - parseFloat(data.shipBonusCycleTime)) *
      (1 - parseFloat(data.skillExhumerCycleTime) * exhumerSkill) *
      (1 - parseFloat(data.skillBargeCycleTime) * bargeSkill);

    yieldMult =
      (1 + parseFloat(data.shipBonusYield)) *
      (1 + parseFloat(data.skillExhumerYield) * exhumerSkill) *
      (1 + parseFloat(data.skillBargeYield) * bargeSkill) *
      (1 + 0.05 * miningSkill) *
      (1 + 0.05 * astroSkill);
  } else if (type === "frigate") {
    cycleMult =
      1 - parseFloat(data.skillFrigateCycleTime || 0) * frigateSkill;

    yieldMult =
      (1 + parseFloat(data.shipBonusYield || 0)) *
      (1 + parseFloat(data.skillFrigateYield || 0) * frigateSkill) *
      (1 +
        parseFloat(data.skillExpeditionYield || 0) * expeditionSkill) *
      (1 + 0.05 * miningSkill) *
      (1 + 0.05 * astroSkill);
  } else if (type === "destroyer") {
    cycleMult =
      (1 - parseFloat(data.shipBonusCycleTime || 0)) *
      (1 + parseFloat(data.skillDestroyerCycleTime || 0) * destroyerSkill);

    yieldMult =
      (1 + parseFloat(data.shipBonusYield || 0)) *
      (1 + parseFloat(data.skillDestroyerYield || 0) * destroyerSkill) *
      (1 + 0.05 * miningSkill) *
      (1 + 0.05 * astroSkill);
  }

  return { cycleMult, yieldMult, critChanceBonus };
}

router.post("/ore-calc", async (req, res) => {
  try {
    const { config, boost, implantName = "None", michiImplant = false } = req.body;

    const priceByTypeId = await fetchOrePriceByTypeId(
      allOreRows.map((ore) => ore.marketTypeId)
    );

    const implantMult =
      (1 + (IMPLANT_BONUSES[implantName] || 0)) *
      (michiImplant === true ? 1.05 : 1);

    const {
      ship,
      module,
      numModules,
      crystal,
      numShips,
      lowSlotName,
      lowSlotCount,
      surveyChipset = "None",
      skills = {}
    } = config;

    const mod = modules[module];
    if (!mod) {
      return res.json({ error: "No module selected" });
    }

    const rawCycle = Number(mod.cycle) || 1;
    const rawBaseYield = Number(mod.baseYield) || 0;

    const adjustedCycle = rawCycle / FAST_CYCLE_FACTOR;
    const adjustedBaseYield = rawBaseYield / FAST_CYCLE_FACTOR;

    const crystalBonus = crystals[crystal] || {
      durationMult: 1,
      yieldMult: 1
    };

    const bonuses = getShipBonuses(ship, skills);

    let cycleTime =
      adjustedCycle *
      (crystalBonus.durationMult || 1) *
      bonuses.cycleMult;

    cycleTime = miningDurationMultiplier(
      cycleTime,
      boost?.ship || "None",
      boost?.director || 0,
      boost?.industrial || 0,
      boost?.capitalIndustrial || 0,
      boost?.miningDestroyer || 0,
      boost?.implant || "None",
      boost?.module || "T1",
      boost?.bastion || "No"
    );

    if (cycleTime > 1000) {
      cycleTime = cycleTime / 1000;
    }

    let lowSlotMult = 1;
    if (lowSlotName && lowSlotCount) {
      const bonus = LOW_SLOT_UPGRADES[lowSlotName] || 0;
      lowSlotMult = Math.pow(1 + bonus, lowSlotCount);
    }

    const baseYieldPerCycle =
      adjustedBaseYield *
      (crystalBonus.yieldMult || 1) *
      bonuses.yieldMult *
      lowSlotMult *
      implantMult;

    const precisionLevel = skills.precision || 0;
    const exploitationLevel = skills.exploitation || 0;

    let critChance = BASE_CRIT_CHANCE;
    let critBonus = BASE_CRIT_BONUS;

    let critChanceMult = 1 + 0.1 * precisionLevel;

    let critBonusMult = 1 + 0.05 * exploitationLevel;

    const shipCritBonus = bonuses.critChanceBonus || 0;
    critChanceMult *= 1 + shipCritBonus;

    const efficiencyChargeActive = boost?.efficiencyCharge === "Yes";
    const burstCritMult = critChanceMultiplierFromBoost(
      boost?.ship || "None",
      boost?.director || 0,
      boost?.industrial || 0,
      boost?.capitalIndustrial || 0,
      boost?.miningDestroyer || 0,
      boost?.implant || "None",
      boost?.module || "T1",
      boost?.bastion || "No",
      efficiencyChargeActive
    );
    critChanceMult *= burstCritMult;

    const chipsetKey =
      typeof surveyChipset === "string" ? surveyChipset : "None";
    const chipset =
      SURVEY_CHIPSET_BONUSES[chipsetKey] || SURVEY_CHIPSET_BONUSES.None;
    critChanceMult *= chipset.chanceMult;
    critBonusMult *= chipset.bonusMult;

    critChance = Math.min(critChance * critChanceMult, 1);
    critBonus = critBonus * critBonusMult;

    const critYieldMultiplier = 1 + critChance * critBonus;

    const yieldPerCycle = baseYieldPerCycle * critYieldMultiplier;

    const m3PerSecondPerModule = yieldPerCycle / cycleTime;
    const m3PerSecond = m3PerSecondPerModule * numModules * numShips;
    const m3PerHour = m3PerSecond * 3600;
    const compatibleResourceTypes = compatibleResourceTypesForCrystal(crystal);
    const result = compatibleResourceTypes.includes("ore")
      ? calculateResourceRows(oreRows, priceByTypeId, m3PerHour)
      : [];
    const moonResult = compatibleResourceTypes.includes("moonOre")
      ? calculateResourceRows(moonOreRows, priceByTypeId, m3PerHour)
      : [];

    res.json({
      result,
      moonResult,
      compatibleResourceTypes,
      cycleTime,
      yieldPerCycle,
      cycleTimeReduction: cycleTime * 100,
      critChance,
      critBonus,
      critYieldMultiplier
    });
  } catch (err) {
    console.error("[ORE_CALC]: Ore calc error:", err);
    res.status(500).json({ error: "Calculation failed" });
  }
});

let orePriceCache = null;
let orePriceCacheTimestamp = 0;

async function fetchOrePrices() {
  const priceByTypeId = await fetchOrePriceByTypeId(
    allOreRows.map((ore) => ore.marketTypeId)
  );
  const prices = {};
  for (const ore of allOreRows) {
    const price = priceByTypeId.get(Number(ore.marketTypeId)) ?? null;
    prices[ore.name] = price;
    if (ore.legacyName && ore.legacyName !== ore.name) {
      prices[ore.legacyName] = price;
    }
  }
  return prices;
}

router.get("/ore-prices", async (req, res) => {
  try {
    res.setHeader("Deprecation", "true");
    res.setHeader("Link", '</api/prices/station>; rel="successor-version"');
    const now = Date.now();
    if (!orePriceCache || now - orePriceCacheTimestamp > 3600000) {
      orePriceCache = await fetchOrePrices();
      orePriceCacheTimestamp = now;
      console.log("[ORE_CALC]: Ore prices cache updated");
    }
    res.json(orePriceCache);
  } catch (err) {
    console.error("[ORE_CALC]: Error fetching ore prices:", err.message);
    res.status(500).json({ error: "Failed to fetch ore prices" });
  }
});

module.exports = router;
module.exports._test = {
  allOreRows,
  calculateResourceRows,
  compatibleResourceTypesForCrystal,
  moonOreRows,
  oreRows,
};
