/*
 * Express router for reaction Calc API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const db = require("../db");
const { resolveStationId } = require('../utils/stations');

const blueprintData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "/data/blueprints.json"), "utf8")
);

const reactionBlueprintFamilies = {
  Hybrid: [46157, 46158, 46159, 46160, 46161, 46162, 46163, 46164, 46165],
  Composite: [
    46166, 46167, 46168, 46169, 46170, 46171, 46172, 46173, 46174, 46175, 46176,
    46177, 46178, 46179, 46180, 46181, 46182, 46183, 46184, 46185, 46186, 46187,
    46188, 46189, 46190, 46191, 46192, 46193, 46194, 46195, 46196, 46197, 46198,
    46199, 46200, 46201, 46202, 46203, 46204, 46205, 46206, 46207, 46208, 46209,
    46210, 46211, 46212, 46213, 46214, 46215, 46216, 46217, 46218, 57490, 57491,
    57492, 57493, 57494,
  ],
  Biochemical: [
    46219, 46220, 46221, 46222, 46223, 46224, 46225, 46226, 46227, 46228, 46229,
    46230, 46231, 46232, 46233, 46234, 46235, 46236, 46237, 46238, 46240, 46241,
    46242, 46243, 46244, 46245, 46246, 46247, 46248, 46249, 46250, 46251,
    57495, 57496, 57497, 57498, 57499, 57500, 57501, 57502, 57503, 57504, 57505,
    57506,
  ],
};

const reactionBlueprintFamilyById = Object.entries(reactionBlueprintFamilies).reduce(
  (acc, [family, ids]) => {
    for (const id of ids) acc[id] = family;
    return acc;
  },
  {}
);

const supportedReactionBlueprintIDs = new Set(
  Object.values(reactionBlueprintFamilies).flat()
);

const reactionBlueprintByProductTypeID = {};
for (const blueprintID of supportedReactionBlueprintIDs) {
  const product = blueprintData[blueprintID]?.products?.["11"]?.[0];
  if (product) reactionBlueprintByProductTypeID[product.typeID] = Number(blueprintID);
}

const VALID_STATIONS = ["Jita 4-4", "Amarr VIII", "Dodixie", "Rens"];

function addInput(target, input, quantity) {
  const key = String(input.typeID);
  if (!target[key]) {
    target[key] = {
      typeID: input.typeID,
      name: input.name,
      quantity: 0,
    };
  }
  target[key].quantity += quantity;
}

function addOutput(target, product, produced, consumed) {
  const key = String(product.typeID);
  if (!target[key]) {
    target[key] = {
      typeID: product.typeID,
      name: product.name,
      produced: 0,
      consumed: 0,
      quantity: 0,
    };
  }
  target[key].produced += produced;
  target[key].consumed += consumed;
  target[key].quantity += produced - consumed;
}

function mergeInputs(target, source) {
  for (const input of Object.values(source)) {
    addInput(target, input, input.quantity);
  }
}

function mergeOutputs(target, source) {
  for (const output of Object.values(source)) {
    addOutput(target, output, output.produced, output.consumed);
  }
}

function materialQuantity(baseQuantity, runCount, materialMult) {
  return Math.ceil(baseQuantity * runCount * materialMult);
}

function buildReactionPlan(blueprintID, { chain, materialMult, runCount = 1, depth = 0, seen = new Set() }) {
  const blueprint = blueprintData[blueprintID];
  const inputs = blueprint?.materials?.["11"] || [];
  const product = blueprint?.products?.["11"]?.[0];

  const directInputs = inputs.map((input) => ({
    ...input,
    baseQuantity: input.quantity * runCount,
    quantity: materialQuantity(input.quantity, runCount, materialMult),
  }));

  const job = {
    blueprintID: Number(blueprintID),
    blueprintName: blueprint?.blueprintName,
    depth,
    runCount,
    product,
    inputs: directInputs,
  };

  const jobs = [job];
  const leafInputs = {};
  const extraOutputs = {};
  const nextSeen = new Set(seen);
  nextSeen.add(Number(blueprintID));

  for (const input of directInputs) {
    const requiredQuantity = input.quantity;
    const childBlueprintID = chain ? reactionBlueprintByProductTypeID[input.typeID] : undefined;
    const childProduct = childBlueprintID
      ? blueprintData[childBlueprintID]?.products?.["11"]?.[0]
      : undefined;

    if (childBlueprintID && childProduct && !nextSeen.has(childBlueprintID)) {
      const childRunCount = Math.ceil(requiredQuantity / childProduct.quantity);
      const childPlan = buildReactionPlan(childBlueprintID, {
        chain,
        materialMult,
        runCount: childRunCount,
        depth: depth + 1,
        seen: nextSeen,
      });

      jobs.push(...childPlan.jobs);
      mergeInputs(leafInputs, childPlan.leafInputs);
      mergeOutputs(extraOutputs, childPlan.extraOutputs);
      addOutput(extraOutputs, childProduct, childProduct.quantity * childRunCount, requiredQuantity);
    } else {
      addInput(leafInputs, input, requiredQuantity);
    }
  }

  return { jobs, leafInputs, extraOutputs };
}

router.post("/reaction-calc", async (req, res) => {
  const {
    blueprintID,

    station = 'Jita 4-4',
    inputPricingMode = "buy",
    outputPricingMode = "sell",
    reactionSkill = 0,
    taxRatePercent = 0,
    structureType = "Station",
    meRig = "None",
    teRig = "None",
    systemCostIndex = 0,
    facilityTaxPercent = 0,
    securityStatus = "low",
    chain = false
  } = req.body;

  const stationId = resolveStationId(station);
  if (!Number.isFinite(stationId)) {
    return res.status(400).json({ error: "Unsupported station. Use 'Jita 4-4', 'Amarr VIII', 'Dodixie', or 'Rens' (or a numeric station_id)." });
  }

  const blueprint = blueprintData[blueprintID];
  const blueprintFamily = reactionBlueprintFamilyById[Number(blueprintID)] || "Reaction";
  const inputs = blueprint?.materials?.["11"] || [];
  const outputs = blueprint?.products?.["11"] || [];

  if (!inputs.length || !outputs.length) {
    return res.status(500).json({ error: "Blueprint is missing input or output data." });
  }

  try {
    let materialMult = 1;
    let timeMult = 1;

    if (structureType !== "Station") {
      if (meRig === "T1") materialMult *= 0.98;
      else if (meRig === "T2") materialMult *= 0.976;

      if (teRig === "T1") timeMult *= 0.80;
      else if (teRig === "T2") timeMult *= 0.76;
    }

    if (structureType === "Tatara") {
      timeMult *= 0.75;
    }

    if (["null", "wh"].includes(securityStatus)) {
      const rigBonus = 1.1;

      if (materialMult < 1) {
        const baseReduction = 1 - materialMult;
        materialMult = 1 - baseReduction * rigBonus;
      }

      if (timeMult < 1) {
        const baseReduction = 1 - timeMult;
        timeMult = 1 - baseReduction * rigBonus;
      }
    }

    const calculationMode = chain ? "chain" : "simple";
    const rowKey = `${blueprintID}:${calculationMode}`;
    const plan = buildReactionPlan(Number(blueprintID), {
      chain: Boolean(chain),
      materialMult,
    });
    const leafInputs = Object.values(plan.leafInputs);
    const typeIDs = [...leafInputs, ...outputs].map((item) => item.typeID);

    const { rows: priceRows } = await db.query(
      `SELECT
         type_id,
         sell_min  AS sell_price,
         buy_max   AS buy_price,
         COALESCE((sell_min + buy_max) / 2, sell_min, buy_max)::numeric AS avg_price,
         sell_5pct,
         buy_5pct,
         last_updated
       FROM market_station_aggregates
       WHERE type_id = ANY($1) AND station_id = $2`,
      [typeIDs, stationId]
    );

    const prices = {};
    for (const row of priceRows) {
      prices[row.type_id] = {
        sell: Number(row.sell_price),
        buy: Number(row.buy_price),
        avg: Number(row.avg_price)
      };
    }

    const baseSecondsPerRun = 3 * 60 * 60;

    const skillReductionMult = 1 - (reactionSkill * 0.04);

    const secondsPerRun = baseSecondsPerRun * timeMult * skillReductionMult;

    let inputCost = 0;
    let eiv = 0;
    const adjustedPrices = JSON.parse(fs.readFileSync(path.join(__dirname, "../cache/adjusted_prices.json"), "utf8"));

    for (const input of leafInputs) {
      const marketPrice = prices[input.typeID]?.[inputPricingMode] ?? 0;
      inputCost += marketPrice * input.quantity;
    }

    for (const job of plan.jobs) {
      for (const input of job.inputs) {
        const adjusted = adjustedPrices?.prices?.[String(input.typeID)]?.adjusted ?? 0;
        eiv += adjusted * input.baseQuantity;
      }
    }

    let outputValue = 0;
    for (const output of outputs) {
      const unitPrice = prices[output.typeID]?.[outputPricingMode] ?? 0;
      outputValue += unitPrice * output.quantity;
    }
    const marketTax = outputValue * (taxRatePercent / 100);
    const installCost = eiv * (systemCostIndex / 100);
    const facilityTax = eiv * (facilityTaxPercent / 100);
    const sccTax = eiv * 0.04;
    const totalTaxes = installCost + facilityTax + sccTax;
    const totalTaxesWithMarket = totalTaxes + marketTax;
    const profit = outputValue - inputCost - totalTaxesWithMarket;
    const iskPerHour = profit / timeMult;

    const profitLessTaxes = outputValue - inputCost - marketTax;
    const responseInputs = chain
      ? leafInputs
      : inputs.map((input) => ({
          ...input,
          effectiveQuantity: materialQuantity(input.quantity, 1, materialMult),
        }));
    const finalStep = chain
      ? {
          product: plan.jobs[0]?.product,
          inputs: plan.jobs[0]?.inputs.map((input) => ({
            typeID: input.typeID,
            name: input.name,
            quantity: input.quantity,
          })) || [],
        }
      : null;
    const extraOutputs = Object.values(plan.extraOutputs)
      .filter((output) => output.quantity > 0)
      .map((output) => ({
        typeID: output.typeID,
        name: output.name,
        quantity: output.quantity,
        produced: output.produced,
        consumed: output.consumed,
      }));
    const intermediateGroups = [];

    if (chain) {
      const groups = new Map();
      for (const job of plan.jobs.filter((item) => item.depth > 0)) {
        if (!groups.has(job.depth)) groups.set(job.depth, []);
        groups.get(job.depth).push({
          blueprintID: job.blueprintID,
          blueprintName: job.blueprintName,
          runCount: job.runCount,
          product: job.product,
          inputs: job.inputs.map((input) => ({
            typeID: input.typeID,
            name: input.name,
            quantity: input.quantity,
          })),
        });
      }

      for (const [depth, jobs] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
        intermediateGroups.push({
          depth,
          title: `Intermediate Step ${depth}`,
          jobs,
        });
      }
    }

    res.json({
      blueprintID,
      rowKey,
      calculationMode,
      blueprintName: blueprint.blueprintName,
      blueprintFamily,
      station,
      inputPricingMode,
      outputPricingMode,
      reactionSkill,
      structureType,
      meRig,
      teRig,
      systemCostIndex,
      facilityTaxPercent,
      securityStatus,
      materialMult,
      timePerRun: (1 * timeMult).toFixed(2),
      inputCost: Math.round(inputCost),
      outputValue: Math.round(outputValue),
      profit: Math.round(profit),
      profitLessTaxes: Math.round(profitLessTaxes),
      iskPerHour: Math.round(iskPerHour),
      totalTaxes: Math.round(totalTaxesWithMarket),
      marketTax: Math.round(marketTax),
      taxRatePercent,
      estimatedItemValue: Math.round(eiv),
      jobInstallCost: Math.round(installCost),
      facilityTax: Math.round(facilityTax),
      sccTax: Math.round(sccTax),
      inputs: responseInputs,
      inputsAreEffective: Boolean(chain),
      outputs,
      extraOutputs,
      prices,
      finalStep,
      intermediateGroups,
      secondsPerRun: Math.round(secondsPerRun),
      formattedDuration: new Date(secondsPerRun * 1000).toISOString().substr(11, 8)
    });

  } catch (err) {
    console.error("[REACTION_CALC]: ReactionCalc error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
