/*
 * Express router for industry Schedule API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const axios = require('axios');

const INTERNAL_BASE_URL = process.env.INTERNAL_BASE_URL || 'http://localhost:3000';

function getStructureTimeMultiplier(structure) {
  switch ((structure || '').toUpperCase()) {
    case 'RAITARU':
      return 0.85;
    case 'AZBEL':
      return 0.8;
    case 'SOTIYO':
      return 0.7;
    default:
      return 1.0;
  }
}

function filterBuildTree(nodes) {
  if (!Array.isArray(nodes)) return [];
  const result = [];
  for (const node of nodes) {
    if (!node) continue;
    const children = filterBuildTree(node.children || []);
    const label = typeof node.label === 'string' ? node.label.trim() : '';
    const isBuy = label.startsWith('Buy ');
    if (isBuy) {
      continue;
    }
    result.push({
      ...node,
      children
    });
  }
  return result;
}

router.post('/industry/schedule', async (req, res, next) => {
  try {
    const { items, slotConfig, bpoInventory, settings } = req.body || {};

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Provide at least one product in items[]' });
    }

    const resolvedSlotConfig = {
      manufacturingSlots:
        Number(slotConfig?.manufacturingSlots) > 0
          ? Number(slotConfig.manufacturingSlots)
          : 1,
      copySlots:
        Number(slotConfig?.copySlots) > 0
          ? Number(slotConfig.copySlots)
          : 1
    };

    const assumeTe20 = !!settings?.assumeTe20;

    const defaultFacility = {
      structure: 'RAITARU',
      rig: 'T2',
      security: 'NULL_WH'
    };

    const productFacility = settings?.productFacility || defaultFacility;
    const componentFacility =
      settings?.componentFacility || settings?.productFacility || defaultFacility;

    const componentStructure = componentFacility.structure || 'RAITARU';
    const productStructure = productFacility.structure || componentStructure;

    const planItems = items.map((it) => ({
      typeId: Number(it.typeId),
      quantity: Number(it.quantity) || 0,
      typeName: it.typeName,
      runsPerBpc: it.runsPerBpc,
    }));

    const goalTypeIdSet = new Set(planItems.map((it) => Number(it.typeId)));

    const planPayload = {
      items: planItems,
      options: {
        productMe:
          typeof settings?.productMe === 'number' ? settings.productMe : 10,
        componentMe:
          typeof settings?.componentMe === 'number'
            ? settings.componentMe
            : (typeof settings?.productMe === 'number' ? settings.productMe : 10),

        productFacility,
        componentFacility,

        includeReactions: false,

        systemCostIndexManufacturing: settings?.systemCostIndexManufacturing,
        systemCostIndexReactions: settings?.systemCostIndexReactions,
        facilityTax: settings?.facilityTax,
        sccSurcharge: settings?.sccSurcharge,
        additionalCost: settings?.additionalCost,
        reactionMe: settings?.reactionMe,
        reactionFacility: settings?.reactionFacility,
        inputPriceMode: settings?.inputPriceMode || 'buy',
        outputPriceMode: settings?.outputPriceMode || 'sell',
        overrideRoutes: settings?.overrideRoutes || {}
      }
    };

    const planResp = await axios.post(
      `${INTERNAL_BASE_URL}/api/industry/plan`,
      planPayload
    );
    const plan = planResp.data || {};
    const jobs = Array.isArray(plan.jobs) ? plan.jobs : [];
    const rawTree = Array.isArray(plan.tree) ? plan.tree : [];

    const tree = filterBuildTree(rawTree);

    if (!jobs.length) {
      return res.status(200).json({
        slotConfig: resolvedSlotConfig,
        assumeTe20,
        totals: {
          totalRuns: 0,
          totalCopyWorkSeconds: 0,
          totalMfgWorkSeconds: 0,
          estimatedCopySpanSeconds: 0,
          estimatedMfgSpanSeconds: 0
        },
        blueprints: [],
        tree
      });
    }

    const runsByBlueprint = new Map();
    const productNamesByBlueprint = new Map();
    const productTypesByBlueprint = new Map();

    for (const job of jobs) {
      if (!job || job.activity !== 'manufacturing') continue;
      const blueprintId = Number(job.blueprintId);
      const runs = Number(job.runs) || 0;
      if (!blueprintId || runs <= 0) continue;

      runsByBlueprint.set(
        blueprintId,
        (runsByBlueprint.get(blueprintId) || 0) + runs
      );

      if (job.outputTypeName) {
        const set = productNamesByBlueprint.get(blueprintId) || new Set();
        set.add(job.outputTypeName);
        productNamesByBlueprint.set(blueprintId, set);
      }
      if (job.outputTypeId) {
        const setIds = productTypesByBlueprint.get(blueprintId) || new Set();
        setIds.add(job.outputTypeId);
        productTypesByBlueprint.set(blueprintId, setIds);
      }
    }

    const blueprintIds = Array.from(runsByBlueprint.keys());
    if (!blueprintIds.length) {
      return res.status(200).json({
        slotConfig: resolvedSlotConfig,
        assumeTe20,
        totals: {
          totalRuns: 0,
          totalCopyWorkSeconds: 0,
          totalMfgWorkSeconds: 0,
          estimatedCopySpanSeconds: 0,
          estimatedMfgSpanSeconds: 0
        },
        blueprints: [],
        tree
      });
    }

    const bpoMap = new Map();
    if (Array.isArray(bpoInventory)) {
      for (const row of bpoInventory) {
        const bpId = Number(row.blueprintId || row.blueprintTypeId || row.typeId);
        const count = Number(row.count) || 0;
        if (!bpId || count < 0) continue;
        bpoMap.set(bpId, count);
      }
    }

    const { rows: sdeRows } = await db.query(
      `
      SELECT
        b."typeID" AS "blueprintTypeId",
        b."maxProductionLimit" AS "maxRunsPerBpc",
        m."time" AS "manufacturingTime",
        c."time" AS "copyTime"
      FROM evesde."industryBlueprints" b
      LEFT JOIN evesde."industryActivity" m
        ON m."typeID" = b."typeID" AND m."activityID" = 1
      LEFT JOIN evesde."industryActivity" c
        ON c."typeID" = b."typeID" AND c."activityID" = 5
      WHERE b."typeID" = ANY($1::int[])
      `,
      [blueprintIds]
    );

    const sdeByBlueprint = new Map();
    for (const row of sdeRows) {
      sdeByBlueprint.set(Number(row.blueprintTypeId), {
        blueprintTypeId: Number(row.blueprintTypeId),
        maxRunsPerBpc: Number(row.maxRunsPerBpc) || 1,
        manufacturingTime:
          row.manufacturingTime != null ? Number(row.manufacturingTime) : null,
        copyTime: row.copyTime != null ? Number(row.copyTime) : null
      });
    }

    const blueprints = [];
    let totalRuns = 0;
    let totalCopyWorkSeconds = 0;
    let totalMfgWorkSeconds = 0;

    for (const blueprintId of blueprintIds) {
      const runsNeeded = runsByBlueprint.get(blueprintId) || 0;
      totalRuns += runsNeeded;

      const sde = sdeByBlueprint.get(blueprintId);
      if (!sde) continue;

      const nameSet = productNamesByBlueprint.get(blueprintId);
      const idSet = productTypesByBlueprint.get(blueprintId);
      const products = [];
      const productTypeIds = [];

      if (nameSet && idSet && nameSet.size === idSet.size) {
        const names = Array.from(nameSet);
        const ids = Array.from(idSet);
        for (let i = 0; i < names.length; i++) {
          products.push({ typeId: ids[i], typeName: names[i] });
          productTypeIds.push(ids[i]);
        }
      } else if (nameSet) {
        for (const n of nameSet) {
          products.push({ typeId: null, typeName: n });
        }
      }

      const isFinalProductBlueprint = productTypeIds.some((tid) =>
        goalTypeIdSet.has(Number(tid))
      );

      const rawBpoCount = bpoMap.has(blueprintId) ? bpoMap.get(blueprintId) : 1;
      const bpoCount = rawBpoCount > 0 ? rawBpoCount : 0;

      const maxRunsPerBpc = sde.maxRunsPerBpc || 1;

      const structureForThis = isFinalProductBlueprint
        ? productStructure
        : componentStructure;
      const structureMult = getStructureTimeMultiplier(structureForThis);

      const copyTimePerRunBase = sde.copyTime || 0;
      const mfgTimePerRunBase = sde.manufacturingTime || 0;

      let copyTimePerRun = copyTimePerRunBase * structureMult;
      let mfgTimePerRun = mfgTimePerRunBase * structureMult;

      if (assumeTe20 && !isFinalProductBlueprint) {
        mfgTimePerRun *= 0.8;
      }

      const rawCopiesNeeded =
        runsNeeded > 0 ? Math.ceil(runsNeeded / maxRunsPerBpc) : 0;

      let copyPlanned = !!copyTimePerRun && runsNeeded > 0;
      let copyDisabledReason = null;

      if (isFinalProductBlueprint) {
        copyPlanned = false;
        copyDisabledReason = 'finalProductBpcAssumed';
      } else if (copyPlanned && bpoCount >= rawCopiesNeeded && bpoCount > 0) {
        copyPlanned = false;
        copyDisabledReason = 'bpoEnoughForDirectRuns';
      }

      const copiesNeeded = rawCopiesNeeded;
      let runsPerCopyUnified = null;
      let runsPerCopy = [];

      if (copyPlanned && copiesNeeded > 0 && runsNeeded > 0) {

        runsPerCopyUnified = Math.ceil(runsNeeded / copiesNeeded);
        runsPerCopy = Array.from({ length: copiesNeeded }, () => runsPerCopyUnified);
      }
      let directRunsPerBpo = null;
      if (!copyPlanned && copyDisabledReason === 'bpoEnoughForDirectRuns') {
        const denom = bpoCount > 0 ? bpoCount : 1;
        directRunsPerBpo = Math.ceil(runsNeeded / denom);
      }

      let copyWork = 0;
      let effectiveCopyParallelism = 0;
      let copySpanSeconds = 0;
      if (copyPlanned && copyTimePerRun > 0 && runsNeeded > 0) {
        copyWork = copyTimePerRun * runsNeeded;
        effectiveCopyParallelism = Math.max(
          1,
          Math.min(resolvedSlotConfig.copySlots, bpoCount || 1)
        );
        copySpanSeconds =
          effectiveCopyParallelism > 0
            ? copyWork / effectiveCopyParallelism
            : 0;
        totalCopyWorkSeconds += copyWork;
      }

      const mfgWork = mfgTimePerRun * runsNeeded;
      totalMfgWorkSeconds += mfgWork;

      let mfgParallelCapacity = 0;

      if (copyPlanned && copiesNeeded > 0) {
        mfgParallelCapacity = copiesNeeded;
      } else if (!copyPlanned && bpoCount > 0) {

        mfgParallelCapacity = bpoCount;
      }

      const effectiveMfgParallelism = Math.max(
        1,
        Math.min(
          resolvedSlotConfig.manufacturingSlots,
          mfgParallelCapacity || 1
        )
      );

      const mfgSpanSeconds =
        effectiveMfgParallelism > 0 ? mfgWork / effectiveMfgParallelism : 0;

      const blueprintLabel =
        products.length === 1
          ? `${products[0].typeName} Blueprint`
          : `Blueprint #${blueprintId}`;

      blueprints.push({
        blueprintId,
        blueprintLabel,
        products,
        runsNeeded,
        bpoCount,
        maxRunsPerBpc,
        copiesNeeded,
        runsPerCopy,
        runsPerCopyUnified,
        directRunsPerBpo,
        copyTimePerRunSeconds: copyTimePerRun,
        mfgTimePerRunSeconds: mfgTimePerRun,
        totalCopyWorkSeconds: copyWork,
        totalMfgWorkSeconds: mfgWork,
        effectiveCopyParallelism,
        effectiveMfgParallelism,
        copySpanSeconds,
        mfgSpanSeconds,
        copyPlanned,
        copyDisabledReason,
        isFinalProductBlueprint
      });
    }

    const copySpans = blueprints
      .filter((b) => b.copyPlanned && b.copySpanSeconds > 0)
      .map((b) => b.copySpanSeconds);
    const medianCopySpanSeconds = copySpans.length
      ? copySpans
          .slice()
          .sort((a, b) => a - b)[Math.floor(copySpans.length / 2)]
      : 0;

    for (const bp of blueprints) {
      const isCopyBottleneck =
        bp.copyPlanned &&
        medianCopySpanSeconds > 0 &&
        bp.copySpanSeconds > medianCopySpanSeconds * 1.5;

      let recommendedBpoCountForMedian = bp.bpoCount;
      if (
        isCopyBottleneck &&
        bp.totalCopyWorkSeconds > 0 &&
        medianCopySpanSeconds > 0
      ) {
        const idealParallelism =
          bp.totalCopyWorkSeconds / medianCopySpanSeconds;
        const targetParallelism = Math.min(
          resolvedSlotConfig.copySlots,
          Math.ceil(idealParallelism)
        );
        recommendedBpoCountForMedian = Math.max(
          bp.bpoCount || 0,
          targetParallelism
        );
      }

      bp.isCopyBottleneck = isCopyBottleneck;
      bp.medianCopySpanSeconds = medianCopySpanSeconds;
      bp.recommendedBpoCountForMedian = recommendedBpoCountForMedian;
    }

    const estimatedCopySpanSeconds = blueprints.reduce(
      (max, bp) => Math.max(max, bp.copySpanSeconds || 0),
      0
    );
    const estimatedMfgSpanSeconds = blueprints.reduce(
      (max, bp) => Math.max(max, bp.mfgSpanSeconds || 0),
      0
    );

    blueprints.sort((a, b) => (b.copySpanSeconds || 0) - (a.copySpanSeconds || 0));

    return res.json({
      slotConfig: resolvedSlotConfig,
      assumeTe20,
      totals: {
        totalRuns,
        totalCopyWorkSeconds,
        totalMfgWorkSeconds,
        estimatedCopySpanSeconds,
        estimatedMfgSpanSeconds
      },
      blueprints,
      tree
    });
  } catch (err) {
    console.error('[industry/schedule] error', err?.stack || err);
    next(err);
  }
});

module.exports = router;
