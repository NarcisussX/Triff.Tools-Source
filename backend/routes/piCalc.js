/*
 * Express router for the wormhole-focused PI profitability browser.
 * Evaluates PI chains against selected planet types and local market prices.
 * Missing raw inputs are modeled as imported P1 commodities instead of hauled P0.
 */

const express = require("express");
const axios = require("axios");
const PI_ITEMS = require("./data/pi_items");

const router = express.Router();

const JITA_44_STATION_ID = 60003760;
const JITA_44_STATION_NAME = "Jita 4-4";
const API_BASE = process.env.INTERNAL_API_BASE_URL || "http://localhost:3000";
const PRICE_CACHE_TTL_MS =
  Number(process.env.PI_CALC_PRICE_CACHE_TTL_MS) || 5 * 60 * 1000;

const TIERS = ["P1", "P2", "P3", "P4"];
const PLANET_TYPES = [
  "Barren",
  "Gas",
  "Ice",
  "Lava",
  "Oceanic",
  "Plasma",
  "Storm",
  "Temperate",
];
const MARKET_MODES = new Set(["sell", "buy", "impatient", "patient"]);

const P0_PLANET_AVAILABILITY = {
  "Aqueous Liquids": ["Barren", "Gas", "Ice", "Oceanic", "Storm", "Temperate"],
  Autotrophs: ["Temperate"],
  "Base Metals": ["Barren", "Gas", "Lava", "Plasma", "Storm"],
  "Carbon Compounds": ["Barren", "Oceanic", "Temperate"],
  "Complex Organisms": ["Oceanic", "Temperate"],
  "Felsic Magma": ["Lava"],
  "Heavy Metals": ["Ice", "Lava", "Plasma"],
  "Ionic Solutions": ["Gas", "Storm"],
  "Micro Organisms": ["Barren", "Ice", "Oceanic", "Temperate"],
  "Noble Gas": ["Gas", "Ice", "Storm"],
  "Noble Metals": ["Barren", "Plasma"],
  "Non-CS Crystals": ["Lava", "Plasma"],
  "Planktic Colonies": ["Ice", "Oceanic"],
  "Reactive Gas": ["Gas"],
  "Suspended Plasma": ["Lava", "Plasma", "Storm"],
};

const PI_MAP = new Map(PI_ITEMS.map((item) => [item.id, item]));
const P0_PLANETS_BY_ID = buildP0PlanetMap();

let PRICES = {};
let PRICE_FETCHED_AT = 0;
let PRICE_META = {
  updated_at: null,
  price_age_seconds: null,
  row_count: 0,
};

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildP0PlanetMap() {
  const p0ByName = new Map(
    PI_ITEMS.filter((item) => item.tier === "P0").map((item) => [
      normalizeName(item.name),
      item,
    ])
  );
  const mapped = {};

  for (const [name, planets] of Object.entries(P0_PLANET_AVAILABILITY)) {
    const item = p0ByName.get(normalizeName(name));
    if (!item) {
      console.warn(`[piCalc] P0 planet mapping did not match PI item: ${name}`);
      continue;
    }
    mapped[item.id] = planets;
  }

  for (const item of PI_ITEMS.filter((entry) => entry.tier === "P0")) {
    if (!mapped[item.id]) {
      console.warn(`[piCalc] P0 item has no planet mapping: ${item.name}`);
      mapped[item.id] = [];
    }
  }

  return mapped;
}

function iconUrl(typeID, size = 32) {
  return `https://images.evetech.net/types/${typeID}/icon?size=${size}`;
}

function numericPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function getPrice(typeID, mode) {
  const price = PRICES[typeID]?.[mode];
  return Number.isFinite(price) && price > 0 ? price : null;
}

function addToAggregate(target, typeID, qty) {
  target[typeID] = (target[typeID] || 0) + qty;
}

function expandP0Inputs(item, qtyNeeded, aggregate = {}, seen = new Set()) {
  if (!item) return aggregate;
  if (item.tier === "P0") {
    addToAggregate(aggregate, item.id, qtyNeeded);
    return aggregate;
  }

  const visitKey = `${item.id}:${qtyNeeded}`;
  if (seen.has(visitKey)) return aggregate;
  const nextSeen = new Set(seen);
  nextSeen.add(visitKey);

  const outputQty = item.quantity || 1;
  const batchesNeeded = qtyNeeded / outputQty;

  for (const ingredient of item.recipe || []) {
    const ingredientItem = PI_MAP.get(ingredient.id);
    if (!ingredientItem) continue;
    expandP0Inputs(
      ingredientItem,
      ingredient.amt * batchesNeeded,
      aggregate,
      nextSeen
    );
  }

  return aggregate;
}

function buildChainNode(item, qtyNeeded, selectedPlanets, seen = new Set()) {
  if (!item) return null;

  const planetTypes = P0_PLANETS_BY_ID[item.id] || [];
  const local =
    item.tier === "P0" &&
    planetTypes.some((planet) => selectedPlanets.has(planet));

  const node = {
    typeID: item.id,
    typeId: item.id,
    name: item.name,
    tier: item.tier,
    qty: qtyNeeded,
    batchQty: item.quantity || 1,
    icon_url: iconUrl(item.id),
    planetTypes,
    local,
    imported: false,
    notProduced: item.tier === "P0" && !local,
    ingredients: [],
  };

  if (!item.recipe?.length) return node;

  const visitKey = `${item.id}:${qtyNeeded}`;
  if (seen.has(visitKey)) return node;
  seen.add(visitKey);

  const batchesNeeded = qtyNeeded / (item.quantity || 1);
  node.ingredients = item.recipe
    .map((ingredient) => {
      const ingredientItem = PI_MAP.get(ingredient.id);
      if (!ingredientItem) return null;
      return buildChainNode(
        ingredientItem,
        ingredient.amt * batchesNeeded,
        selectedPlanets,
        new Set(seen)
      );
    })
    .filter(Boolean);

  if (item.tier === "P1") {
    node.local = node.ingredients.length > 0 && node.ingredients.every((child) => child.local);
    node.imported = !node.local;
  }

  return node;
}

function marketPriceModes(marketMode) {
  if (marketMode === "impatient") {
    return { outputPriceMode: "buy", inputPriceMode: "sell" };
  }
  if (marketMode === "patient") {
    return { outputPriceMode: "sell", inputPriceMode: "buy" };
  }
  return { outputPriceMode: marketMode, inputPriceMode: marketMode };
}

function safeSum(values) {
  let total = 0;
  for (const value of values) {
    if (value == null) return null;
    total += value;
  }
  return total;
}

function profit(outputValue, inputCost) {
  if (outputValue == null || inputCost == null) return null;
  return outputValue - inputCost;
}

function margin(profitValue, outputValue) {
  if (profitValue == null || outputValue == null || outputValue <= 0) return null;
  return profitValue / outputValue;
}

function viabilityForProduct({
  selectedPlanets,
  localP0Count,
  totalP0Count,
  localPlanetInputCost,
  outputValue,
}) {
  if (outputValue == null || localPlanetInputCost == null) {
    return { viability: "not_priced", viabilityLabel: "Not Priced" };
  }
  if (!selectedPlanets.length || localP0Count === 0) {
    return { viability: "import_required", viabilityLabel: "Import Required" };
  }
  if (localP0Count === totalP0Count) {
    return { viability: "fully_local", viabilityLabel: "Fully Self-Supplied" };
  }
  return { viability: "partial", viabilityLabel: "Partially Self-Supplied" };
}

function buildDirectIngredients(item, inputPriceMode) {
  return (item.recipe || []).map((ingredient) => {
    const ingredientItem = PI_MAP.get(ingredient.id);
    const unitPrice = getPrice(ingredient.id, inputPriceMode);
    return {
      typeID: ingredient.id,
      typeId: ingredient.id,
      name: ingredientItem?.name || "Unknown",
      tier: ingredientItem?.tier || "?",
      qty: ingredient.amt,
      unitPrice,
      totalCost: unitPrice == null ? null : unitPrice * ingredient.amt,
      icon_url: iconUrl(ingredient.id),
      priceMissing: unitPrice == null,
    };
  });
}

function buildP0Breakdown(p0Aggregate, selectedPlanets, inputPriceMode) {
  const p0Inputs = Object.entries(p0Aggregate)
    .map(([typeIDString, qty]) => {
      const typeID = Number(typeIDString);
      const item = PI_MAP.get(typeID);
      const planetTypes = P0_PLANETS_BY_ID[typeID] || [];
      const local = planetTypes.some((planet) => selectedPlanets.has(planet));
      const unitPrice = getPrice(typeID, inputPriceMode);
      const marketCost = unitPrice == null ? null : unitPrice * qty;
      const appliedCost = local ? 0 : marketCost;

      return {
        typeID,
        typeId: typeID,
        name: item?.name || `Type ${typeID}`,
        tier: "P0",
        qty,
        planetTypes,
        local,
        unitPrice,
        marketCost,
        appliedCost,
        icon_url: iconUrl(typeID),
        priceMissing: unitPrice == null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    p0Inputs,
    localP0: p0Inputs.filter((row) => row.local),
    importedP0: p0Inputs.filter((row) => !row.local),
  };
}

function expandP1Inputs(item, qtyNeeded, aggregate = {}, seen = new Set()) {
  if (!item) return aggregate;
  if (item.tier === "P1") {
    addToAggregate(aggregate, item.id, qtyNeeded);
    return aggregate;
  }

  const visitKey = `${item.id}:${qtyNeeded}`;
  if (seen.has(visitKey)) return aggregate;
  const nextSeen = new Set(seen);
  nextSeen.add(visitKey);

  const outputQty = item.quantity || 1;
  const batchesNeeded = qtyNeeded / outputQty;

  for (const ingredient of item.recipe || []) {
    const ingredientItem = PI_MAP.get(ingredient.id);
    if (!ingredientItem) continue;
    expandP1Inputs(
      ingredientItem,
      ingredient.amt * batchesNeeded,
      aggregate,
      nextSeen
    );
  }

  return aggregate;
}

function canProduceP1Locally(item, selectedPlanets) {
  if (!item || item.tier !== "P1" || !item.recipe?.length) return false;
  return item.recipe.every((ingredient) => {
    const planetTypes = P0_PLANETS_BY_ID[ingredient.id] || [];
    return planetTypes.some((planet) => selectedPlanets.has(planet));
  });
}

function buildP1Breakdown(p1Aggregate, selectedPlanets, inputPriceMode) {
  const p1Inputs = Object.entries(p1Aggregate)
    .map(([typeIDString, qty]) => {
      const typeID = Number(typeIDString);
      const item = PI_MAP.get(typeID);
      const local = canProduceP1Locally(item, selectedPlanets);
      const unitPrice = getPrice(typeID, inputPriceMode);
      const marketCost = unitPrice == null ? null : unitPrice * qty;
      const appliedCost = local ? 0 : marketCost;

      return {
        typeID,
        typeId: typeID,
        name: item?.name || `Type ${typeID}`,
        tier: "P1",
        qty,
        unitPrice,
        marketCost,
        appliedCost,
        local,
        imported: !local,
        icon_url: iconUrl(typeID),
        priceMissing: unitPrice == null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    p1Inputs,
    localP1: p1Inputs.filter((row) => row.local),
    importedP1: p1Inputs.filter((row) => !row.local),
  };
}

function aggregateP0ForP1Rows(p1Rows, onlyLocal, selectedPlanets, inputPriceMode) {
  const aggregate = {};
  for (const row of p1Rows) {
    if (onlyLocal && !row.local) continue;
    const item = PI_MAP.get(row.typeID);
    if (!item) continue;
    expandP0Inputs(item, row.qty, aggregate);
  }
  return buildP0Breakdown(aggregate, selectedPlanets, inputPriceMode).p0Inputs;
}

function buildProduct(item, settings, priceModes) {
  const batchQty = item.quantity || 1;
  const selectedPlanetSet = new Set(settings.selectedPlanets);
  const outputUnitPrice = getPrice(item.id, priceModes.outputPriceMode);
  const outputValue =
    outputUnitPrice == null ? null : outputUnitPrice * batchQty;
  const taxCost = 0;

  const directIngredients = buildDirectIngredients(
    item,
    priceModes.inputPriceMode
  );
  const directInputCost = safeSum(
    directIngredients.map((ingredient) => ingredient.totalCost)
  );

  const p0Aggregate = expandP0Inputs(item, batchQty);
  const { p0Inputs } = buildP0Breakdown(
    p0Aggregate,
    selectedPlanetSet,
    priceModes.inputPriceMode
  );
  const p1Aggregate = expandP1Inputs(item, batchQty);
  const { p1Inputs, localP1, importedP1 } = buildP1Breakdown(
    p1Aggregate,
    selectedPlanetSet,
    priceModes.inputPriceMode
  );
  const localP0 = aggregateP0ForP1Rows(
    localP1,
    true,
    selectedPlanetSet,
    priceModes.inputPriceMode
  );
  const importedP0 = p0Inputs.filter((input) => !input.local);

  const p1MarketInputCost = safeSum(
    p1Inputs.map((input) => input.marketCost)
  );
  const localPlanetInputCost = safeSum(
    p1Inputs.map((input) => input.appliedCost)
  );
  const importedP1Cost = safeSum(
    importedP1.map((input) => input.marketCost)
  );

  const profitFullMarketChain = profit(
    outputValue,
    p1MarketInputCost
  );
  const profitLocalPlanetChain = profit(
    outputValue,
    localPlanetInputCost
  );
  const profitFinalStep = profit(outputValue, directInputCost);
  const missingP0Names = importedP0.map((input) => input.name);
  const notProducedCommodityNames = importedP1.map((input) => input.name);
  const missingPriceNames = [
    outputUnitPrice == null ? item.name : null,
    ...directIngredients
      .filter((ingredient) => ingredient.priceMissing)
      .map((ingredient) => ingredient.name),
    ...p1Inputs
      .filter((input) => input.priceMissing)
      .map((input) => input.name),
  ].filter(Boolean);

  const viability = viabilityForProduct({
    selectedPlanets: settings.selectedPlanets,
    localP0Count: localP0.length,
    totalP0Count: p0Inputs.length,
    localPlanetInputCost,
    outputValue,
  });

  return {
    typeID: item.id,
    typeId: item.id,
    name: item.name,
    tier: item.tier,
    batchQty,
    quantity: batchQty,
    icon_url: iconUrl(item.id),
    lowestSeller: getPrice(item.id, "sell"),
    highestBuyer: getPrice(item.id, "buy"),
    outputUnitPrice,
    outputValue,
    valueBatch: outputValue,
    taxCost,
    directIngredients,
    ingredients: directIngredients,
    p0Inputs,
    p1Inputs,
    localP0,
    localP1,
    importedP0,
    importedP1,
    missingP0Names,
    missingP0Count: missingP0Names.length,
    notProducedP0: importedP0,
    notProducedCommodityNames,
    notProducedCommodityCount: notProducedCommodityNames.length,
    missingPriceNames: Array.from(new Set(missingPriceNames)),
    localP0Count: localP0.length,
    totalP0Count: p0Inputs.length,
    importedP0Cost: importedP1Cost,
    importedP1Cost,
    p0MarketInputCost: p1MarketInputCost,
    p1MarketInputCost,
    localPlanetInputCost,
    directInputCost,
    profitFullMarketChain,
    profitLocalPlanetChain,
    profitFinalStep,
    profitP0This: profitFullMarketChain,
    profitPrevThis: profitFinalStep,
    marginLocalPlanetChain: margin(profitLocalPlanetChain, outputValue),
    marginFullMarketChain: margin(profitFullMarketChain, outputValue),
    marginFinalStep: margin(profitFinalStep, outputValue),
    chain: buildChainNode(item, batchQty, selectedPlanetSet),
    ...viability,
  };
}

function parseUpdatedAt(rows) {
  const timestamps = rows
    .map((row) => row.last_updated)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  if (!timestamps.length) {
    return { updated_at: null, price_age_seconds: null };
  }

  const oldest = Math.min(...timestamps);
  return {
    updated_at: new Date(oldest).toISOString(),
    price_age_seconds: Math.max(0, Math.floor((Date.now() - oldest) / 1000)),
  };
}

function currentPriceMeta() {
  if (!PRICE_META.updated_at) return PRICE_META;
  const updatedTime = new Date(PRICE_META.updated_at).getTime();
  if (!Number.isFinite(updatedTime)) return PRICE_META;
  return {
    ...PRICE_META,
    price_age_seconds: Math.max(0, Math.floor((Date.now() - updatedTime) / 1000)),
  };
}

async function fetchPrices() {
  const ids = PI_ITEMS.map((item) => item.id);
  const url = `${API_BASE}/api/prices/station?station_id=${JITA_44_STATION_ID}&type_ids=${ids.join(
    ","
  )}`;

  const { data } = await axios.get(url, { timeout: 15000 });
  const rows = Array.isArray(data?.rows) ? data.rows : null;
  if (!rows) {
    throw new Error("Market price response was not valid JSON.");
  }

  const nextPrices = {};
  for (const row of rows) {
    nextPrices[row.type_id] = {
      buy: numericPrice(row.buy_max),
      sell: numericPrice(row.sell_min),
      updated_at: row.last_updated || null,
    };
  }

  PRICES = nextPrices;
  PRICE_FETCHED_AT = Date.now();
  PRICE_META = {
    ...parseUpdatedAt(rows),
    row_count: rows.length,
  };
}

async function ensureFreshPrices() {
  const stale = Date.now() - PRICE_FETCHED_AT > PRICE_CACHE_TTL_MS;
  if (!PRICE_FETCHED_AT || stale) {
    await fetchPrices();
  }
}

function normalizePlanet(value) {
  const normalized = normalizeName(value);
  return PLANET_TYPES.find((planet) => normalizeName(planet) === normalized);
}

function validateRequest(body = {}) {
  const selectedPlanetsRaw =
    body.selectedPlanets == null ? [] : body.selectedPlanets;
  if (!Array.isArray(selectedPlanetsRaw)) {
    return { error: "selectedPlanets must be an array of planet type strings." };
  }

  const selectedPlanets = [];
  const invalidPlanets = [];
  for (const value of selectedPlanetsRaw) {
    const planet = typeof value === "string" ? normalizePlanet(value) : null;
    if (!planet) {
      invalidPlanets.push(String(value));
      continue;
    }
    if (!selectedPlanets.includes(planet)) selectedPlanets.push(planet);
  }

  if (invalidPlanets.length) {
    return {
      error: `Unknown planet type: ${invalidPlanets.join(", ")}.`,
    };
  }

  const marketMode = body.marketMode == null ? "sell" : String(body.marketMode);
  if (!MARKET_MODES.has(marketMode)) {
    return {
      error: "marketMode must be one of sell, buy, impatient, or patient.",
    };
  }

  return {
    settings: {
      taxRate: 0,
      taxModel: "not_applied",
      selectedPlanets,
      marketMode,
    },
  };
}

function summarizeProduct(product) {
  if (!product) return null;
  return {
    typeID: product.typeID,
    name: product.name,
    tier: product.tier,
    icon_url: product.icon_url,
    viability: product.viability,
    viabilityLabel: product.viabilityLabel,
    profitLocalPlanetChain: product.profitLocalPlanetChain,
    profitFullMarketChain: product.profitFullMarketChain,
    profitFinalStep: product.profitFinalStep,
  };
}

function buildSummary(products) {
  const counts = products.reduce(
    (acc, product) => {
      acc.totalProducts += 1;
      if (product.viability === "fully_local") acc.fullyLocal += 1;
      if (product.viability === "partial") acc.partiallyLocal += 1;
      if (product.viability === "import_required") acc.importRequired += 1;
      if (product.viability === "not_priced") acc.notPriced += 1;
      return acc;
    },
    {
      totalProducts: 0,
      fullyLocal: 0,
      partiallyLocal: 0,
      importRequired: 0,
      notPriced: 0,
    }
  );

  const pricedLocal = products.filter((product) =>
    Number.isFinite(product.profitLocalPlanetChain)
  );
  const pricedFinal = products.filter((product) =>
    Number.isFinite(product.profitFinalStep)
  );

  const bestLocalChain = pricedLocal.sort(
    (a, b) => b.profitLocalPlanetChain - a.profitLocalPlanetChain
  )[0];
  const bestFinalStep = pricedFinal.sort(
    (a, b) => b.profitFinalStep - a.profitFinalStep
  )[0];

  return {
    ...counts,
    bestLocalChain: summarizeProduct(bestLocalChain),
    bestFinalStep: summarizeProduct(bestFinalStep),
  };
}

async function piCalcApi(req, res) {
  try {
    const validated = validateRequest(req.body || {});
    if (validated.error) {
      return res.status(400).json({ ok: false, error: validated.error });
    }

    await ensureFreshPrices();

    const settings = validated.settings;
    const priceModes = marketPriceModes(settings.marketMode);
    const products = PI_ITEMS.filter((item) => TIERS.includes(item.tier))
      .map((item) => buildProduct(item, settings, priceModes))
      .sort((a, b) => {
        const tierDiff = TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier);
        return tierDiff || a.name.localeCompare(b.name);
      });

    return res.json({
      ok: true,
      market: {
        station: JITA_44_STATION_NAME,
        station_id: JITA_44_STATION_ID,
        mode: settings.marketMode,
        input_price_mode: priceModes.inputPriceMode,
        output_price_mode: priceModes.outputPriceMode,
        updated_at: currentPriceMeta().updated_at,
        price_age_seconds: currentPriceMeta().price_age_seconds,
        row_count: currentPriceMeta().row_count,
        cache_ttl_seconds: Math.floor(PRICE_CACHE_TTL_MS / 1000),
      },
      settings,
      summary: buildSummary(products),
      planetTypes: PLANET_TYPES,
      products,
    });
  } catch (error) {
    console.error("[piCalc] failed:", error);
    return res.status(502).json({
      ok: false,
      error:
        "Could not load local Jita PI prices. Please try again after the market cache refreshes.",
    });
  }
}

router.post("/api/pi/calc", piCalcApi);

module.exports = router;
module.exports._test = {
  P0_PLANET_AVAILABILITY,
};
