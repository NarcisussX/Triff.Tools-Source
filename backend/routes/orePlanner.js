/*
 * Express router for ore Planner API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require("express");
const solver = require("javascript-lp-solver");
const { MINERALS, ORE_DATA } = require("../data/oreData");

const router = express.Router();

const API_BASE = process.env.INTERNAL_API_BASE_URL || "http://localhost:3000";
const MARKET_STATION_URL = `${API_BASE}/api/prices/station`;

const LP_SOFT_TARGET_TOTAL = 5_000_000_000;
const HARD_TOTAL_CAP        = 15_000_000_000;
const TIME_BUDGET_MS        = 20000;

const getVol = (o) => (o.volumeCompressedM3 ?? o.compressedM3 ?? null);
const getTypeId = (o) => (o.typeIdCompressed ?? o.compressedTypeId ?? null);

function parseRefineRate(input) {
  if (input == null) return 0;
  const s = String(input).trim().replace(/\s+/g, "");
  let v = parseFloat(s.replace("%", ""));
  if (Number.isNaN(v)) return 0;
  if (v > 1) v = v / 100;
  return Math.min(Math.max(v, 0), 1);
}
function zeroVec() { const v = {}; for (const m of MINERALS) v[m] = 0; return v; }
function applyProduction(rows) { const p = zeroVec(); for (const r of rows) for (const m of MINERALS) p[m] += r.yields[m]; return p; }
function totalsFrom(targets, produced) {
  const totals = {};
  for (const m of MINERALS) {
    const t = targets[m] || 0, p = produced[m] || 0;
    totals[m] = { target: t, produced: p, surplus: Math.max(0, p - t), shortfall: Math.max(0, t - p) };
  }
  return totals;
}

function chooseBestCandidate({ candidates, main, refineRate, objective }) {

  let best = null;
  let bestScore = Infinity;

  for (const o of candidates) {
    const perMain = (o.perBatch[main] || 0) * refineRate;
    if (perMain <= 0) continue;

    let score;
    if (objective.mode === "cost" && objective.costPerBatch) {
      const cost = objective.costPerBatch[o.name];
      score = (cost == null) ? Number.POSITIVE_INFINITY : cost / perMain;
    } else if (objective.mode === "m3") {
      const vol = getVol(o);
      score = (vol == null) ? Number.POSITIVE_INFINITY : (100 * vol) / perMain;
    } else if (objective.mode === "blend" && objective.blendCost) {
      const bc = objective.blendCost[o.name];
      score = (bc == null) ? Number.POSITIVE_INFINITY : bc / perMain;
    } else {

      score = 1 / perMain;
    }

    if (score < bestScore) { bestScore = score; best = o; }
  }
  return best || candidates[0];
}

function greedyRepair(targets, refineRate, allowedList, seedRows = [], objective, startedAt, timeBudgetMs) {
  const warnings = [];
  const remaining = { ...zeroVec(), ...targets };
  const seedProduced = applyProduction(seedRows);
  for (const m of MINERALS) remaining[m] = Math.max(0, remaining[m] - (seedProduced[m] || 0));

  const purchase = new Map(seedRows.map(r => [r.name, r.batches]));
  const totalRemaining = () => MINERALS.reduce((s, m) => s + (remaining[m] || 0), 0);

  let guard = 0;
  while (totalRemaining() > 0) {
    guard++;
    if (guard > 10_000) { warnings.push("Stopped after 10k greedy iterations."); break; }
    if (Date.now() - startedAt > timeBudgetMs) { warnings.push(`Stopped early due to time budget (~${timeBudgetMs}ms). Results are approximate.`); break; }

    let main = null, max = 0;
    for (const m of MINERALS) { const r = remaining[m] || 0; if (r > max) { max = r; main = m; } }
    if (!main || max <= 0) break;

    const cands = allowedList.filter(o => (o.perBatch[main] || 0) > 0);
    if (!cands.length) break;

    const best = chooseBestCandidate({ candidates: cands, main, refineRate, objective });
    const perMain = (best.perBatch[main] || 0) * refineRate;
    if (perMain <= 0) break;

    const batches = Math.max(1, Math.ceil((remaining[main] || 0) / perMain));
    purchase.set(best.name, (purchase.get(best.name) || 0) + batches);

    for (const m of MINERALS) {
      const produced = Math.floor(batches * (best.perBatch[m] || 0) * refineRate);
      remaining[m] = Math.max(0, (remaining[m] || 0) - produced);
    }
  }

  const rows = Array.from(purchase.entries()).map(([name, batches]) => {
    const ore = allowedList.find(o => o.name === name);
    const yields = zeroVec();
    for (const m of MINERALS) yields[m] = Math.floor(batches * (ore.perBatch[m] || 0) * refineRate);
    return { name, batches, yields };
  }).sort((a, b) => b.batches - a.batches);

  return { rows, warnings };
}

function solveLPThenRepair({ targets, refineRate, allowedList, objective, startedAt, timeBudgetMs }) {
  const variables = {}; const constraints = {};
  for (const m of MINERALS) constraints[m] = { min: targets[m] || 0 };

  function coeffFor(ore) {
    if (objective.mode === "batches") return 1;
    if (objective.mode === "m3") {
      const vol = getVol(ore);
      if (vol == null) return null;
      return 100 * vol;
    }
    if (objective.mode === "cost") return objective.costPerBatch[ore.name] ?? null;
    if (objective.mode === "blend") return objective.blendCost[ore.name] ?? null;
    return 1;
  }

  const missingM3 = []; const missingCost = [];

  allowedList.forEach((ore, idx) => {
    const varName = `x_${idx}`;
    const v = {};
    for (const m of MINERALS) v[m] = (ore.perBatch[m] || 0) * refineRate;
    const c = coeffFor(ore);
    if (objective.mode === "m3" && getVol(ore) == null) missingM3.push(ore.name);
    if ((objective.mode === "cost" || objective.mode === "blend") && c == null) missingCost.push(ore.name);
    v.obj = (c == null) ? 1e12 : c;
    variables[varName] = v; ore.__varName = varName;
  });

  const model = { optimize: "obj", opType: "min", constraints, variables   };

  let seedRows = [];
  try {
    const solution = solver.Solve(model);
    if (solution && solution.feasible !== false) {
      seedRows = allowedList.map((ore) => {
        const b = Math.max(0, Math.round(solution[ore.__varName] || 0));
        if (!b) return null;
        const yields = zeroVec();
        for (const m of MINERALS) yields[m] = Math.floor(b * (ore.perBatch[m] || 0) * refineRate);
        return { name: ore.name, batches: b, yields };
      }).filter(Boolean);
    }
  } catch {

  }

  const repaired = greedyRepair(targets, refineRate, allowedList, seedRows, objective, startedAt, timeBudgetMs);
  const produced = applyProduction(repaired.rows);

  const warnings = [...repaired.warnings];
  if (objective.mode === "m3" && missingM3.length) warnings.push(`Haul m³ missing volumes for: ${missingM3.join(", ")}`);
  if ((objective.mode === "cost" || objective.mode === "blend") && missingCost.length) warnings.push(`Price missing for: ${missingCost.join(", ")}`);

  return { rows: repaired.rows, produced, warnings };
}

function buildBlendObjective(allowedList, costPerBatch, alpha) {
  const m3PerBatch = {};
  for (const o of allowedList) {
    const vol = getVol(o);
    m3PerBatch[o.name] = (vol == null ? null : 100 * vol);
  }

  function normalize(map) {
    const vals = Object.values(map).filter(v => v != null);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = (max - min) || 1; const out = {};
    for (const k of Object.keys(map)) out[k] = map[k] == null ? null : (map[k] - min) / span;
    return out;
  }

  const Cn = normalize(costPerBatch);
  const Mn = normalize(m3PerBatch);

  const blendCost = {};
  for (const o of allowedList) {
    const c = Cn[o.name]; const m = Mn[o.name];
    blendCost[o.name] = (c == null || m == null) ? null : (alpha * c + (1 - alpha) * m);
  }
  return { blendCost };
}

async function fetchPricesFromMarketApi(stationId, typeIDs, priceField) {
  const qs = new URLSearchParams({
    station_id: String(stationId),
    type_ids: typeIDs.join(","),
  });
  const url = `${MARKET_STATION_URL}?${qs.toString()}`;
  const r = await fetch(url, { method: "GET", headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error(`Market API ${r.status}`);
  const data = await r.json();
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const byId = {};
  for (const row of rows) {
    const id = Number(row.type_id);
    const raw = row?.[priceField] ?? row?.sell_5pct ?? row?.sell_min ?? null;
    const price = raw == null ? null : Number(raw);
    byId[id] = Number.isFinite(price) ? price : null;
  }
  return byId;
}

router.get("/ores", (_req, res) => {
  res.json({
    minerals: MINERALS,
    ores: ORE_DATA.map(o => ({
      name: o.name,
      typeIdCompressed: getTypeId(o),
      volumeCompressedM3: getVol(o),
    }))
  });
});

router.post("/plan", async (req, res) => {
  try {
    const {
      targets = {},
      refineRate: rateIn,
      allowedOres,
      strategy = "min_haul",
      haul_mode = "m3",
      station_id = 60003760,
      price_field = "sell_5pct",
      blend_weight = 0.5,
    } = req.body || {};

    const totalRequested = MINERALS.reduce((s, m) => s + (targets[m] || 0), 0);
    if (totalRequested > HARD_TOTAL_CAP) {
      return res.status(422).json({
        error: `Request too large. Total minerals requested = ${totalRequested.toLocaleString()} > ${HARD_TOTAL_CAP.toLocaleString()}. Try splitting into smaller runs.`,
        max_total: HARD_TOTAL_CAP
      });
    }

    const refineRate = parseRefineRate(rateIn);
    const allowedSet = new Set(Array.isArray(allowedOres) && allowedOres.length ? allowedOres : ORE_DATA.map(o => o.name));
    const allowedList = ORE_DATA.filter(o => allowedSet.has(o.name));

    let objective = { mode: "batches" };
    const warnings = [];
    let costPerBatch = {};

    if (strategy === "min_haul") {
      objective = { mode: haul_mode === "m3" ? "m3" : "batches" };
    } else if (strategy === "min_cost" || strategy === "blend") {
      const typeIDs = allowedList.map(getTypeId).filter((id) => Number.isInteger(id));
      const byId = typeIDs.length ? await fetchPricesFromMarketApi(station_id, typeIDs, price_field) : {};
      costPerBatch = {};
      for (const ore of allowedList) {
        const id = getTypeId(ore);
        const unit = Number.isInteger(id) ? byId[id] ?? null : null;
        costPerBatch[ore.name] = unit == null ? null : 100 * unit;
      }

      if (strategy === "min_cost") {
        objective = { mode: "cost", costPerBatch };
      } else {
        const hasAnyPrice = Object.values(costPerBatch).some(v => v != null);
        const hasAnyM3 = allowedList.some(o => getVol(o) != null);
        if (hasAnyPrice && hasAnyM3) {
          const { blendCost } = buildBlendObjective(allowedList, costPerBatch, Math.min(Math.max(blend_weight, 0), 1));
          const allNull = Object.values(blendCost).every(v => v == null);
          if (allNull) {
            warnings.push("Blend not viable (missing data). Falling back to 'min_cost'.");
            objective = { mode: "cost", costPerBatch };
          } else {
            objective = { mode: "blend", blendCost };
          }
        } else if (hasAnyPrice) {
          warnings.push("Blend missing m³ data; using 'min_cost' instead.");
          objective = { mode: "cost", costPerBatch };
        } else {
          warnings.push("Blend missing price data; using 'min_haul' (m³) instead.");
          objective = { mode: "m3" };
        }
      }
    } else {
      return res.status(400).json({ error: "Unknown strategy. Use 'min_haul', 'min_cost', or 'blend'." });
    }

    const startedAt = Date.now();

    const useLP = totalRequested <= LP_SOFT_TARGET_TOTAL;

    const result = useLP
      ? solveLPThenRepair({ targets, refineRate, allowedList, objective, startedAt, timeBudgetMs: TIME_BUDGET_MS })
      : (() => {
          const g = greedyRepair(targets, refineRate, allowedList, [], objective, startedAt, TIME_BUDGET_MS);
          return { rows: g.rows, produced: applyProduction(g.rows), warnings: g.warnings };
        })();

    const totals = totalsFrom(targets, result.produced);
    const unmet = MINERALS.filter(m => totals[m].shortfall > 0);

    res.json({
      rows: result.rows,
      totals,
      unmet,
      summary: {
        refineRate,
        strategy,
        haul_mode: strategy === "min_haul" ? objective.mode : undefined,
        station_id: (strategy === "min_cost" || strategy === "blend") ? station_id : undefined,
        price_field: (strategy === "min_cost" || strategy === "blend") ? price_field : undefined,
        blend_weight: strategy === "blend" ? Math.min(Math.max(blend_weight, 0), 1) : undefined,
        batchesTotal: result.rows.reduce((s, r) => s + r.batches, 0),
        oreTypesUsed: result.rows.length,
        time_ms: Date.now() - startedAt,
        used_lp: useLP
      },
      warnings: [...(result.warnings || []), ...warnings]
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Internal error" });
  }
});

module.exports = router;
