/*
 * Backend library module for industry Graph.
 * Provides shared data loading, pricing, or planning helpers used by API routes and jobs.
 */

const {
    getType,
    getBlueprintsForProduct,
    getAdjustedPrice,
    getPrice,
} = require('./everefData');

const SCC_SURCHARGE_DEFAULT = 0.04;

function _requiredAggregated(runs, baseQty, materialModifier) {
    if (runs <= 0 || baseQty <= 0) return 0;
    if (baseQty === 1) return runs;
    const scaled = runs * baseQty * materialModifier;
    const rounded = Math.round(scaled * 100) / 100;
    let required = Math.ceil(rounded);
    if (baseQty < 1 && required < runs) required = runs;
    return required;
}

function computeRequiredQuantity(runs, baseQty, materialModifier, batchSize = Infinity) {
    if (!isFinite(batchSize) || batchSize <= 0 || batchSize >= runs) {
        return _requiredAggregated(runs, baseQty, materialModifier);
    }
    const full = Math.floor(runs / batchSize);
    const rem = runs % batchSize;
    let total = full * _requiredAggregated(batchSize, baseQty, materialModifier);
    if (rem > 0) total += _requiredAggregated(rem, baseQty, materialModifier);
    return total;
}

function normalizeStock(stockInput) {
    const stock = new Map();
    const entries = stockInput instanceof Map
        ? stockInput.entries()
        : Object.entries(stockInput && typeof stockInput === 'object' ? stockInput : {});

    for (const [typeIdRaw, quantityRaw] of entries) {
        const typeId = Number(typeIdRaw);
        const quantity = Math.floor(Number(quantityRaw));
        if (!Number.isInteger(typeId) || typeId <= 0) continue;
        if (!Number.isFinite(quantity) || quantity <= 0) continue;
        stock.set(typeId, (stock.get(typeId) || 0) + quantity);
    }

    return stock;
}

function expandIndustryDemand(goals, ctx, stockInput, adapters = {}) {
    const typeNameFor = adapters.typeNameFor || ((typeId) => getType(typeId).name);
    const inputUnitPriceFor = adapters.inputUnitPriceFor || ((typeId, entry) =>
        (entry && entry.route && entry.route.unitPrice) ||
        getPrice(typeId, ctx.settings.inputPriceMode) ||
        getAdjustedPrice(typeId) ||
        0);
    const availableStock = normalizeStock(stockInput);
    const remainingStock = new Map(availableStock);
    const appliedStock = new Map();
    const bomMap = new Map();
    const jobsMap = new Map();

    function consumeStock(typeId, qtyNeeded) {
        const available = remainingStock.get(typeId) || 0;
        if (available <= 0 || qtyNeeded <= 0) return 0;
        const applied = Math.min(available, qtyNeeded);
        remainingStock.set(typeId, available - applied);
        appliedStock.set(typeId, (appliedStock.get(typeId) || 0) + applied);
        return applied;
    }

    function addBom(typeId, qty) {
        if (qty <= 0) return;
        bomMap.set(typeId, (bomMap.get(typeId) || 0) + qty);
    }

    function addJobRun(acc) {
        const key = `${acc.activity}:${acc.blueprintId}:${acc.outputTypeId}`;
        const existing = jobsMap.get(key);
        if (!existing) {
            jobsMap.set(key, {
                ...acc,
                runs: acc.runs,
                materials: new Map(acc.materials),
            });
            return;
        }

        existing.runs += acc.runs;
        for (const [typeId, quantity] of acc.materials.entries()) {
            existing.materials.set(
                typeId,
                (existing.materials.get(typeId) || 0) + quantity
            );
        }
    }

    function walk(typeId, qtyNeeded) {
        const stockApplied = consumeStock(typeId, qtyNeeded);
        const remainingQty = Math.max(0, qtyNeeded - stockApplied);
        const typeName = typeNameFor(typeId);

        if (remainingQty <= 0) {
            return {
                id: `stock:${typeId}:${stockApplied}`,
                label: `Use ${stockApplied} x ${typeName} from stock`,
                children: [],
            };
        }

        const entry = ctx.memo.get(typeId);
        const stockSuffix = stockApplied > 0
            ? ` (${stockApplied} from stock)`
            : '';
        if (!entry || entry.route.kind === 'buy') {
            addBom(typeId, remainingQty);
            const unitPrice = inputUnitPriceFor(typeId, entry);
            return {
                id: `buy:${typeId}:${remainingQty}`,
                label: `Buy ${remainingQty} x ${typeName} @ ${formatIsk(unitPrice)}${stockSuffix}`,
                children: [],
            };
        }

        const route = entry.route;
        const runs = Math.ceil(remainingQty / route.productQtyPerRun);
        const jobAcc = {
            activity: route.activity,
            blueprintId: route.blueprintId,
            outputTypeId: route.productTypeId,
            outputTypeName: typeNameFor(route.productTypeId),
            productPerRun: route.productQtyPerRun,
            runs,
            materials: new Map(),
        };
        const node = {
            id: `job:${route.activity}:${route.blueprintId}:${typeId}:${runs}`,
            label: `${route.activity === 'manufacturing' ? 'Build' : 'React'} ${remainingQty} x ${typeName} via BP ${route.blueprintId} (${runs} runs)${stockSuffix}`,
            children: [],
        };
        const localBatch = ctx.batchByType.get(typeId) ?? Infinity;

        for (const material of route.materials) {
            const totalMaterialQty = computeRequiredQuantity(
                runs,
                material.baseQty,
                material.materialModifier,
                localBatch
            );
            jobAcc.materials.set(
                material.typeId,
                (jobAcc.materials.get(material.typeId) || 0) + totalMaterialQty
            );
            node.children.push(walk(material.typeId, totalMaterialQty));
        }

        addJobRun(jobAcc);
        return node;
    }

    const tree = goals.map((goal) => walk(goal.typeId, goal.quantity));
    const stockUsage = Array.from(availableStock.entries()).map(([typeId, available]) => {
        const applied = appliedStock.get(typeId) || 0;
        return {
            typeId,
            typeName: typeNameFor(typeId),
            available,
            applied,
            unused: Math.max(0, available - applied),
        };
    });

    return { bomMap, jobsMap, tree, stockUsage };
}

async function computeIndustryPlan(goalsInput, options = {}) {
    const safeGoals = (goalsInput || [])
        .filter((g) => g && g.typeId && g.quantity > 0)
        .map((g) => ({
            typeId: Number(g.typeId),
            quantity: Number(g.quantity),
            runsPerBpc: isFinite(Number(g.runsPerBpc)) && Number(g.runsPerBpc) > 0
                ? Number(g.runsPerBpc)
                : Infinity,
        }));

    const settings = normalizeSettings(options);

    if (!safeGoals.length) {
        return {
            goals: [],
            settings,
            summary: {
                totalMaterialCost: 0,
                totalJobCost: 0,
                additionalCost: settings.additionalCost,
                grandTotal: settings.additionalCost,
            },
            bom: [],
            jobs: [],
            tree: [],
            stockUsage: [],
        };
    }
    const ctx = {
        settings,
        memo: new Map(),
        visiting: new Set(),
        batchByType: new Map(safeGoals.map(g => [g.typeId, g.runsPerBpc])),
    };

    for (const g of safeGoals) {
        await resolveTypeCost(g.typeId, ctx, true);
    }

    const {
        bomMap,
        jobsMap,
        tree,
        stockUsage,
    } = expandIndustryDemand(safeGoals, ctx, options.stock);

    let totalJobCost = 0;
    const jobs = [];

    for (const job of jobsMap.values()) {
        if (!settings.includeReactions && job.activity === 'reaction') {
            continue;
        }

        const mats = [];
        let eiv = 0;

        for (const [typeId, qty] of job.materials.entries()) {
            const t = getType(typeId);
            const adj = getAdjustedPrice(typeId) || 0;
            const matEiv = adj * qty;
            eiv += matEiv;
            mats.push({
                typeId,
                typeName: t.name,
                quantity: qty,
            });
        }

        const sci =
            job.activity === 'reaction'
                ? settings.systemCostIndexReactions
                : settings.systemCostIndexManufacturing;

        const jobCost =
            eiv *
            (sci +
                settings.facilityTax +
                settings.sccSurcharge);

        totalJobCost += jobCost;

        const outputQty = job.productPerRun * job.runs;
        const jobCostPerUnit =
            outputQty > 0 ? jobCost / outputQty : 0;

        jobs.push({
            id: `${job.activity}:${job.blueprintId}:${job.outputTypeId}`,
            activity: job.activity,
            blueprintId: job.blueprintId,
            outputTypeId: job.outputTypeId,
            outputTypeName: job.outputTypeName,
            runs: job.runs,
            productPerRun: job.productPerRun,
            outputQuantity: outputQty,
            materials: mats,
            eiv,
            jobCost,
            jobCostPerUnit,
        });
    }

    const overrides = settings.overrideRoutes || {};

    for (const [typeIdStr, mode] of Object.entries(overrides)) {
        if (mode !== 'buy') continue;

        const typeId = Number(typeIdStr);
        if (!typeId) continue;

        if (jobs.some((j) => j.outputTypeId === typeId)) continue;

        const qty = bomMap.get(typeId) || 0;
        if (qty <= 0) continue;

        const entry = ctx.memo.get(typeId);
        const unitPrice =
            (entry &&
                entry.route &&
                entry.route.unitPrice) ||
            getPrice(typeId, settings.inputPriceMode) ||
            getAdjustedPrice(typeId) ||
            0;

        if (unitPrice <= 0) continue;

        const t = getType(typeId);

        jobs.push({
            id: `buy:${typeId}`,
            activity: 'buy',
            blueprintId: null,
            outputTypeId: typeId,
            outputTypeName: t.name,
            runs: 0,
            productPerRun: 0,
            outputQuantity: qty,
            materials: [],
            eiv: 0,
            jobCost: unitPrice * qty,
            jobCostPerUnit: unitPrice,
        });
    }

    const bom = [];
    let totalMaterialCost = 0;
    let totalVolume = 0;

    for (const [typeId, qty] of bomMap.entries()) {
        const t = getType(typeId);
        const unitPrice =
            getPrice(typeId, settings.inputPriceMode) ||
            getAdjustedPrice(typeId) ||
            0;
        const totalPrice = unitPrice * qty;

        const volume = t.volume || 0;
        const lineVolume = volume * qty;

        totalMaterialCost += totalPrice;
        totalVolume += lineVolume;

        bom.push({
            typeId,
            typeName: t.name,
            quantity: qty,
            unitPrice,
            totalPrice,
            volume,
            lineVolume,
        });
    }

    const goals = safeGoals.map((g) => {
        const t = getType(g.typeId);
        const entry = ctx.memo.get(g.typeId);
        const cpu = entry ? entry.costPerUnit : 0;
        return {
            typeId: g.typeId,
            typeName: t.name,
            quantity: g.quantity,
            costPerUnit: cpu,
            totalCost: cpu * g.quantity,
        };
    });
    const additionalCost = settings.additionalCost;
    const totalCost =
        totalMaterialCost + totalJobCost + additionalCost;

    let totalOutputValue = 0;
    for (const g of safeGoals) {
        const unitOutPrice =
            getPrice(g.typeId, settings.outputPriceMode) ||
            getAdjustedPrice(g.typeId) ||
            0;
        totalOutputValue += unitOutPrice * g.quantity;
    }

    const profit = totalOutputValue - totalCost;
    const totalGoalQuantity = safeGoals.reduce(
        (sum, g) => sum + g.quantity,
        0
    );
    const profitPerUnit =
        totalGoalQuantity > 0
            ? profit / totalGoalQuantity
            : 0;
    const profitMargin =
        totalOutputValue > 0 ? profit / totalOutputValue : 0;

    return {
        goals,
        settings,
        summary: {
            totalMaterialCost,
            totalJobCost,
            additionalCost,
            grandTotal: totalCost,
            totalOutputValue,
            profit,
            profitPerUnit,
            profitMargin,
            totalVolume,
        },
        bom: bom.sort((a, b) => b.totalPrice - a.totalPrice),
        jobs: jobs.sort((a, b) => b.jobCost - a.jobCost),
        tree,
        stockUsage,
    };
}

function normalizeSettings(opts = {}) {
    const num = (v) => (isFinite(Number(v)) ? Number(v) : 0);
    const clamp = (v, min, max) =>
        v < min ? min : v > max ? max : v;

    const base = {
        systemCostIndexManufacturing: num(opts.systemCostIndexManufacturing),
        systemCostIndexReactions: num(opts.systemCostIndexReactions),
        facilityTax: num(opts.facilityTax),
        sccSurcharge:
            typeof opts.sccSurcharge === 'number'
                ? opts.sccSurcharge
                : SCC_SURCHARGE_DEFAULT,
        includeReactions:
            typeof opts.includeReactions === 'boolean'
                ? opts.includeReactions
                : true,
        additionalCost: num(opts.additionalCost),
    };

    base.productMe = clamp(num(opts.productMe), 0, 10);
    base.componentMe = clamp(num(opts.componentMe), 0, 10);
    base.inputPriceMode =
        opts.inputPriceMode === 'buy' ? 'buy' : 'sell';
    base.outputPriceMode =
        opts.outputPriceMode === 'buy' ? 'buy' : 'sell';

    base.overrideRoutes = opts.overrideRoutes || {};

    base.productFacility = normalizeFacility(opts.productFacility);
    base.componentFacility = normalizeFacility(opts.componentFacility);
    base.reactionMe = clamp(num(opts.reactionMe), 0, 10);
    base.reactionFacility = normalizeFacility(opts.reactionFacility);
    return base;
}

function normalizeFacility(raw) {
    const def = {
        structure: 'NPC_STATION',
        rig: 'NONE',
        security: 'HIGH',
    };
    if (!raw || typeof raw !== 'object') return def;

    const structureAllowed = [
        'NPC_STATION',
        'RAITARU',
        'AZBEL',
        'SOTIYO',
        'ATHANOR',
        'TATARA',
    ];
    const rigAllowed = ['NONE', 'T1', 'T2'];
    const secAllowed = ['HIGH', 'LOW', 'NULL_WH'];

    return {
        structure: structureAllowed.includes(raw.structure)
            ? raw.structure
            : def.structure,
        rig: rigAllowed.includes(raw.rig) ? raw.rig : def.rig,
        security: secAllowed.includes(raw.security)
            ? raw.security
            : def.security,
    };
}

function getManufacturingFacilityMultiplier(facility) {
    if (!facility) return 1;

    let structureBonus = 0;
    if (
        facility.structure === 'RAITARU' ||
        facility.structure === 'AZBEL' ||
        facility.structure === 'SOTIYO'
    ) {
        structureBonus = 0.01;
    }

    let rigBonus = 0;
    if (facility.rig === 'T1') {
        if (facility.security === 'HIGH') rigBonus = 0.02;
        else if (facility.security === 'LOW') rigBonus = 0.038;
        else rigBonus = 0.042;
    } else if (facility.rig === 'T2') {
        if (facility.security === 'HIGH') rigBonus = 0.024;
        else if (facility.security === 'LOW') rigBonus = 0.0456;
        else rigBonus = 0.0504;
    }

    const multStructure = 1 - structureBonus;
    const multRig = 1 - rigBonus;

    return multStructure * multRig;
}

function getReactionFacilityMultiplier(facility) {
    if (!facility) return 1;

    const struct = facility.structure;
    const rig = facility.rig;
    const sec = facility.security;

    if (struct !== 'ATHANOR' && struct !== 'TATARA') {
        return 1;
    }

    if (rig !== 'T1' && rig !== 'T2') {
        return 1;
    }

    let base = rig === 'T1' ? 0.02 : 0.024;

    if (sec === 'NULL_WH') {
        base *= 1.1;
    } else if (sec === 'LOW') {
        base *= 1.0;
    } else {
        return 1;
    }

    const mult = 1 - base;
    return mult < 0 ? 0 : mult;
}

async function resolveTypeCost(typeId, ctx, isGoal = false) {
    if (ctx.memo.has(typeId)) return ctx.memo.get(typeId);

    if (ctx.visiting.has(typeId)) {
        const buyCpu =
            getPrice(typeId, ctx.settings.inputPriceMode) ||
            getAdjustedPrice(typeId) ||
            0;
        const forced = {
            costPerUnit: buyCpu,
            route: { kind: 'buy', unitPrice: buyCpu },
        };
        ctx.memo.set(typeId, forced);
        return forced;
    }

    const overrides = ctx.settings.overrideRoutes || {};
    const override = overrides[typeId];

    if (override === 'buy') {
        const unit =
            getPrice(typeId, ctx.settings.inputPriceMode) ||
            getAdjustedPrice(typeId) ||
            0;
        const res = {
            costPerUnit: unit,
            route: { kind: 'buy', unitPrice: unit },
        };
        ctx.memo.set(typeId, res);
        ctx.visiting.delete(typeId);
        return res;
    }

    ctx.visiting.add(typeId);

    const market =
        getPrice(typeId, ctx.settings.inputPriceMode) || 0;

    const allBlueprints = getBlueprintsForProduct(typeId) || [];

    const blueprints = allBlueprints.filter((bp) => {
        if (bp.activity === 'reaction' && !ctx.settings.includeReactions) {
            return false;
        }
        return true;
    });

    const hasBlueprint = blueprints.length > 0;

    let best = null;

    if (market > 0 && !hasBlueprint && override !== 'build') {
        best = {
            costPerUnit: market,
            route: { kind: 'buy', unitPrice: market },
        };
    }

    for (const bp of blueprints) {

        const productQtyPerRun = bp.productQtyPerRun || 1;
        if (productQtyPerRun <= 0) continue;

        let bpMe;
        let facility;

        if (bp.activity === 'reaction') {
            bpMe = 0;
            facility = ctx.settings.reactionFacility;
        } else if (isGoal) {
            bpMe = ctx.settings.productMe;
            facility = ctx.settings.productFacility;
        } else {
            bpMe = ctx.settings.componentMe;
            facility = ctx.settings.componentFacility;
        }

        const meModifier = 1 - bpMe / 100;

        const facilityModifier =
            bp.activity === 'reaction'
                ? getReactionFacilityMultiplier(facility)
                : getManufacturingFacilityMultiplier(facility);

        let materialModifier = meModifier * facilityModifier;
        if (materialModifier < 0) materialModifier = 0;

        let materialsCostPerRun = 0;
        let eivPerRun = 0;
        const matDefs = [];

        for (const mat of bp.materials) {
            const baseQty = mat.quantity;

            const effQtyForRun = computeRequiredQuantity(
                1,
                baseQty,
                materialModifier
            );

            const matRes = await resolveTypeCost(mat.typeId, ctx, false);
            const matCpu = matRes.costPerUnit || 0;

            materialsCostPerRun += matCpu * effQtyForRun;

            const adj = getAdjustedPrice(mat.typeId) || 0;
            eivPerRun += adj * effQtyForRun;

            matDefs.push({
                typeId: mat.typeId,
                baseQty,
                materialModifier,
            });

        }

        const sci =
            bp.activity === 'reaction'
                ? ctx.settings.systemCostIndexReactions
                : ctx.settings.systemCostIndexManufacturing;

        const jobCostPerRun =
            eivPerRun *
            (sci +
                ctx.settings.facilityTax +
                ctx.settings.sccSurcharge);

        const runCost = materialsCostPerRun + jobCostPerRun;
        const buildCpu = runCost / productQtyPerRun;

        if (!best || (buildCpu > 0 && buildCpu < best.costPerUnit)) {
            best = {
                costPerUnit: buildCpu,
                route: {
                    kind: 'build',
                    blueprintId: bp.blueprintId,
                    activity: bp.activity,
                    productTypeId: bp.productTypeId,
                    productQtyPerRun,
                    materials: matDefs,
                    jobCostPerRun,
                    meLevel: bpMe,
                    facility,
                },
            };
        }
    }

    if (!best) {
        const unit =
            getPrice(typeId, ctx.settings.inputPriceMode) ||
            getAdjustedPrice(typeId) ||
            0;
        best = {
            costPerUnit: unit,
            route: { kind: 'buy', unitPrice: unit },
        };
    }

    ctx.memo.set(typeId, best);
    ctx.visiting.delete(typeId);
    return best;
}

function formatIsk(v) {
    if (!v || !isFinite(v)) return '0 ISK';
    if (v >= 1e12) return (v / 1e12).toFixed(3) + 'T ISK';
    if (v >= 1e9) return (v / 1e9).toFixed(3) + 'B ISK';
    if (v >= 1e6) return (v / 1e6).toFixed(3) + 'M ISK';
    if (v >= 1e3) return (v / 1e3).toFixed(3) + 'k ISK';
    return v.toFixed(2) + ' ISK';
}

module.exports = {
    computeIndustryPlan,
    computeRequiredQuantity,
    expandIndustryDemand,
    normalizeStock,
};
