/*
 * Express router for pos Planner API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require("express");
const db = require("../db");

const router = express.Router();

const DOGMA = {

    POWERGRID_OUTPUT: 11,
    CPU_OUTPUT: 48,
    POWER_LOAD: 15,
    CPU_LOAD: 49,
    MODULE_POWER_LOAD: 30,
    MODULE_CPU_LOAD: 50,

    SHIELD_HP: 263,
    ARMOR_HP: 265,
    HULL_HP: 9,

    SHIELD_EM_RESO: 271,
    SHIELD_EXP_RESO: 272,
    SHIELD_KIN_RESO: 273,
    SHIELD_TH_RESO: 274,

    SHIELD_EM_BONUS: 1489,
    SHIELD_EXP_BONUS: 1490,
    SHIELD_KIN_BONUS: 1491,
    SHIELD_TH_BONUS: 1492,
};

const STACK = [
  1,
  0.86911998,
  0.57058314,
  0.28295515,
  0.10599265,
  0.02999400,
  0.00640300,
  0.00100000,
];

function stackingPenalty(i) {
  return STACK[i] ?? 0;
}

function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}

async function fetchDogmaMap(typeIDs, attributeIDs) {
    if (!typeIDs?.length || !attributeIDs?.length) return new Map();

    const { rows } = await db.query(
        `
    SELECT
      "typeID"   AS type_id,
      "attributeID" AS attribute_id,
      "value"    AS value
    FROM evesde."typeDogmaAttributes"
    WHERE "typeID" = ANY($1)
      AND "attributeID" = ANY($2)
    `,
        [typeIDs, attributeIDs]
    );

    const outer = new Map();
    for (const r of rows) {
        if (!outer.has(r.type_id)) outer.set(r.type_id, new Map());
        outer.get(r.type_id).set(r.attribute_id, Number(r.value));
    }
    return outer;
}

function getDogma(dogmaMap, typeID, attrID, fallback = 0) {
    const m = dogmaMap.get(typeID);
    if (!m) return fallback;
    const v = m.get(attrID);
    return v == null ? fallback : Number(v);
}

async function getMarketGroupIdByNameChildOf(name, parentName) {
    const { rows } = await db.query(
        `
    SELECT child."marketGroupID" AS id
    FROM evesde."invMarketGroups" child
    JOIN evesde."invMarketGroups" parent
      ON child."parentGroupID" = parent."marketGroupID"
    WHERE child."marketGroupName" = $1
      AND parent."marketGroupName" = $2
    LIMIT 1
    `,
        [name, parentName]
    );
    return rows?.[0]?.id ?? null;
}

async function getMarketGroupIdByName(name) {
    const { rows } = await db.query(
        `SELECT "marketGroupID" AS id FROM evesde."invMarketGroups" WHERE "marketGroupName" = $1 LIMIT 1`,
        [name]
    );
    return rows?.[0]?.id ?? null;
}

async function getMarketGroupDescendants(rootId) {
    const { rows } = await db.query(
        `
    WITH RECURSIVE mg AS (
      SELECT "marketGroupID" AS id
      FROM evesde."invMarketGroups"
      WHERE "marketGroupID" = $1
      UNION ALL
      SELECT c."marketGroupID" AS id
      FROM evesde."invMarketGroups" c
      JOIN mg ON c."parentGroupID" = mg.id
    )
    SELECT id FROM mg
    `,
        [rootId]
    );
    return rows.map(r => r.id);
}

router.get("/towers", async (req, res) => {
    try {
        const starbaseId = await getMarketGroupIdByNameChildOf("Starbase Structures", "Structures");
        if (!starbaseId) return res.json({ towers: [] });

        const controlTowersId = await getMarketGroupIdByNameChildOf("Control Towers", "Starbase Structures");
        if (!controlTowersId) return res.json({ towers: [] });

        const towerGroupIds = await getMarketGroupDescendants(controlTowersId);

        const { rows } = await db.query(
            `
  SELECT
    t."typeID" AS type_id,
    t."typeName" AS type_name
  FROM evesde."invTypes" t
  JOIN evesde."invGroups" g
    ON g."groupID" = t."groupID"
  JOIN evesde."invCategories" c
    ON c."categoryID" = g."categoryID"
  WHERE t."published" = true
    AND c."categoryName" <> 'Blueprint'
    AND t."marketGroupID" = ANY($1)
  ORDER BY t."typeName" ASC
  `,
            [towerGroupIds]
        );

        res.json({ towers: rows });
    } catch (e) {
        console.error("[pos/towers] error", e);
        res.status(500).json({ error: "pos/towers failed" });
    }
});

router.get("/module-groups", async (req, res) => {
    try {
        const starbaseId = await getMarketGroupIdByNameChildOf("Starbase Structures", "Structures");
        if (!starbaseId) return res.json({ groups: [] });

        const controlTowersId = await getMarketGroupIdByNameChildOf("Control Towers", "Starbase Structures");
        const starbaseDesc = await getMarketGroupDescendants(starbaseId);
        const towersDesc = controlTowersId ? await getMarketGroupDescendants(controlTowersId) : [];
        const moduleGroupIds = starbaseDesc.filter(id => !towersDesc.includes(id));

        const { rows } = await db.query(
            `
      SELECT DISTINCT
        mg."marketGroupID" AS marketgroup_id,
        mg."marketGroupName" AS marketgroup_name
      FROM evesde."invMarketGroups" mg
      WHERE mg."marketGroupID" = ANY($1)
      ORDER BY mg."marketGroupName" ASC
      `,
            [moduleGroupIds]
        );

        res.json({ groups: rows });
    } catch (e) {
        console.error("[pos/module-groups] error", e);
        res.status(500).json({ error: "pos/module-groups failed" });
    }
});

router.get("/modules", async (req, res) => {
    try {
        const marketgroupId = Number(req.query.marketgroup_id);
        if (!marketgroupId) return res.json({ modules: [] });

        const { rows } = await db.query(
            `
  SELECT
    t."typeID" AS type_id,
    t."typeName" AS type_name
  FROM evesde."invTypes" t
  JOIN evesde."invGroups" g
    ON g."groupID" = t."groupID"
  JOIN evesde."invCategories" c
    ON c."categoryID" = g."categoryID"
  WHERE t."published" = true
    AND c."categoryName" <> 'Blueprint'
    AND t."marketGroupID" = $1
  ORDER BY t."typeName" ASC
  `,
            [marketgroupId]
        );

        const typeIDs = rows.map(r => r.type_id);
        const dogmaMap = await fetchDogmaMap(typeIDs, [
            DOGMA.POWER_LOAD,
            DOGMA.CPU_LOAD,

            DOGMA.SHIELD_EM_BONUS,
            DOGMA.SHIELD_EXP_BONUS,
            DOGMA.SHIELD_KIN_BONUS,
            DOGMA.SHIELD_TH_BONUS,
        ]);

        const modules = rows.map(r => ({
            ...r,
            pg_mw: round2(getDogma(dogmaMap, r.type_id, DOGMA.POWER_LOAD, 0)),
            cpu_tf: round2(getDogma(dogmaMap, r.type_id, DOGMA.CPU_LOAD, 0)),
            shield_bonus: {
                em: getDogma(dogmaMap, r.type_id, DOGMA.SHIELD_EM_BONUS, 0),
                exp: getDogma(dogmaMap, r.type_id, DOGMA.SHIELD_EXP_BONUS, 0),
                kin: getDogma(dogmaMap, r.type_id, DOGMA.SHIELD_KIN_BONUS, 0),
                therm: getDogma(dogmaMap, r.type_id, DOGMA.SHIELD_TH_BONUS, 0),
            }
        }));

        res.json({ modules });
    } catch (e) {
        console.error("[pos/modules] error", e);
        res.status(500).json({ error: "pos/modules failed" });
    }
});

router.post("/plan", async (req, res) => {
  try {
    const stationID = 60003760;

    const hours = Math.max(1, Math.min(24 * 365, Number(req.body?.hours ?? 24)));
    const towerTypeId = Number(req.body?.tower_type_id);
    const modules = Array.isArray(req.body?.modules) ? req.body.modules : [];

    if (!towerTypeId) return res.status(400).json({ error: "tower_type_id required" });

    const { rows: towerRows } = await db.query(
      `SELECT type_id, name, volume_m3, capacity_m3 FROM public.pos_towers WHERE type_id = $1 LIMIT 1`,
      [towerTypeId]
    );
    const tower = towerRows[0];
    if (!tower) return res.status(404).json({ error: "Tower not found" });

    const FUEL_BY_FACTION = {
      "Dark Blood": "Helium Fuel Block",
      "Dread Guristas": "Nitrogen Fuel Block",
      "True Sansha": "Helium Fuel Block",
      "Domination": "Hydrogen Fuel Block",
      "Guristas": "Nitrogen Fuel Block",
      "Sansha": "Helium Fuel Block",
      "Serpentis": "Oxygen Fuel Block",
      "Shadow": "Oxygen Fuel Block",
      "Blood": "Helium Fuel Block",
      "Angel": "Hydrogen Fuel Block",
      "Amarr": "Helium Fuel Block",
      "Caldari": "Nitrogen Fuel Block",
      "Gallente": "Oxygen Fuel Block",
      "Minmatar": "Hydrogen Fuel Block",
    };

    const towerName = String(tower.name || "");
    const towerLower = towerName.toLowerCase();
    const factionKeys = Object.keys(FUEL_BY_FACTION).sort((a, b) => b.length - a.length);

    let fuelTypeName = null;
    for (const k of factionKeys) {
      if (towerLower.startsWith(k.toLowerCase())) {
        fuelTypeName = FUEL_BY_FACTION[k];
        break;
      }
    }

    let fuelTypeId = null;
    if (fuelTypeName) {
      const { rows: fuelRows } = await db.query(
        `SELECT "typeID" AS type_id, "typeName" AS name FROM evesde."invTypes" WHERE "typeName" = $1 LIMIT 1`,
        [fuelTypeName]
      );
      if (fuelRows?.[0]?.type_id) fuelTypeId = Number(fuelRows[0].type_id);
    }

    const moduleTypeIds = modules.map(m => Number(m.type_id)).filter(Boolean);
    const uniqModuleTypeIds = [...new Set(moduleTypeIds)];
    const priceTypeIds = [towerTypeId, ...uniqModuleTypeIds, ...(fuelTypeId ? [fuelTypeId] : [])];

    const { rows: aggRows } = await db.query(
      `
      SELECT type_id, sell_min, buy_max, sell_5pct, buy_5pct
      FROM market_station_aggregates
      WHERE station_id = $1 AND type_id = ANY($2)
      `,
      [stationID, priceTypeIds]
    );

    const aggs = {};
    for (const r of aggRows) aggs[r.type_id] = r;

    const pickPrice = (agg) => {
      if (!agg) return null;

      return agg.sell_min ?? null;
    };

    const towerUnit = pickPrice(aggs[towerTypeId]);
    const towerCost = (towerUnit ?? 0);

    const { rows: moduleRows } = uniqModuleTypeIds.length
      ? await db.query(
          `
          SELECT type_id, name, group_name, volume_m3
          FROM public.pos_modules
          WHERE type_id = ANY($1)
          `,
          [uniqModuleTypeIds]
        )
      : { rows: [] };

    const moduleById = {};
    for (const r of moduleRows) moduleById[r.type_id] = r;

    const moduleDogma = uniqModuleTypeIds.length
      ? await fetchDogmaMap(uniqModuleTypeIds, [DOGMA.POWER_LOAD, DOGMA.CPU_LOAD, DOGMA.MODULE_POWER_LOAD, DOGMA.MODULE_CPU_LOAD])
      : new Map();

    let modulesCost = 0;
    let deployM3 = Number(tower.volume_m3 ?? 0);

    const lines = [];
    for (const m of modules) {
      const typeID = Number(m.type_id);
      const qty = Math.max(0, Math.min(100000, Number(m.qty || 0)));
      if (!typeID || !qty) continue;

      const meta = moduleById[typeID];
      if (!meta) continue;

      const unit = pickPrice(aggs[typeID]);
      const lineISK = (unit ?? 0) * qty;

      modulesCost += lineISK;
      deployM3 += Number(meta.volume_m3 ?? 0) * qty;

      lines.push({
        type_id: typeID,
        name: meta.name,
        group_name: meta.group_name,
        qty,
        powergrid_mw: Math.max(getDogma(moduleDogma, typeID, DOGMA.POWER_LOAD, 0), getDogma(moduleDogma, typeID, DOGMA.MODULE_POWER_LOAD, 0)),
        cpu_tf: Math.max(getDogma(moduleDogma, typeID, DOGMA.CPU_LOAD, 0), getDogma(moduleDogma, typeID, DOGMA.MODULE_CPU_LOAD, 0)),
        unit_price: unit,
        line_isk: lineISK,
        volume_m3: Number(meta.volume_m3 ?? 0),
      });
    }

    const nameLower = String(tower.name || "").toLowerCase();
    const blocksPerHour = nameLower.includes("small")
      ? 10
      : nameLower.includes("medium")
        ? 20
        : 40;

    const fuelBlocks = blocksPerHour * hours;

    const fuelUnit = fuelTypeId ? pickPrice(aggs[fuelTypeId]) : null;
    const fuelCost = fuelUnit === null ? null : (fuelUnit ?? 0) * fuelBlocks;

    res.json({
      tower: {
        type_id: towerTypeId,
        name: tower.name,
        unit_price: towerUnit,
        cost_isk: towerCost,
        fuel_blocks_per_hour: blocksPerHour,
        fuel_blocks: fuelBlocks,
      },
      fuel: fuelTypeId ? {
        type_id: fuelTypeId,
        name: fuelTypeName,
        unit_price: fuelUnit,
        cost_isk: fuelCost,
      } : {
        type_id: null,
        name: fuelTypeName,
        unit_price: fuelUnit,
        cost_isk: fuelCost,
      },
      totals: {
        tower_cost_isk: towerCost,
        modules_cost_isk: modulesCost,
        fuel_cost_isk: fuelCost,
        total_cost_isk: towerCost + modulesCost + (fuelCost ?? 0),
        deployment_m3: deployM3,
      },
      lines: lines.sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (e) {
    console.error("[pos/plan] error", e);
    res.status(500).json({ error: "pos/plan failed" });
  }
});
router.post("/calc", async (req, res) => {
    try {
        const towerTypeId = Number(req.body?.tower_type_id);
        const modules = Array.isArray(req.body?.modules) ? req.body.modules : [];

        if (!towerTypeId) {
            return res.status(400).json({ error: "tower_type_id required" });
        }

        const moduleTypeIds = modules.map(m => Number(m.type_id)).filter(Boolean);
        const allTypeIds = [towerTypeId, ...moduleTypeIds];

        const dogmaAttrsNeeded = [

            DOGMA.POWERGRID_OUTPUT,
            DOGMA.CPU_OUTPUT,

            DOGMA.SHIELD_HP,
            DOGMA.ARMOR_HP,
            DOGMA.HULL_HP,

            DOGMA.SHIELD_EM_RESO,
            DOGMA.SHIELD_EXP_RESO,
            DOGMA.SHIELD_KIN_RESO,
            DOGMA.SHIELD_TH_RESO,

            DOGMA.POWER_LOAD,
            DOGMA.CPU_LOAD,
            DOGMA.MODULE_POWER_LOAD,
            DOGMA.MODULE_CPU_LOAD,

            DOGMA.SHIELD_EM_BONUS,
            DOGMA.SHIELD_EXP_BONUS,
            DOGMA.SHIELD_KIN_BONUS,
            DOGMA.SHIELD_TH_BONUS,
        ];

        const dogmaMap = await fetchDogmaMap(allTypeIds, dogmaAttrsNeeded);

        let moduleNameById = {};
        if (moduleTypeIds.length) {
            try {
                const { rows: nameRows } = await db.query(
                    `SELECT type_id, name FROM public.pos_modules WHERE type_id = ANY($1)`,
                    [moduleTypeIds]
                );
                for (const r of nameRows) moduleNameById[r.type_id] = r.name;
            } catch (e) {

            }
        }

        const hardenerFallbackFromName = (typeId) => {
            const n = String(moduleNameById[typeId] || "").toLowerCase();

            if (!n) return null;
            if (n.includes("heat dissipation")) return { therm: 25 };
            if (n.includes("photon scattering")) return { em: 25 };
            if (n.includes("explosion dampening")) return { exp: 25 };
            if (n.includes("ballistic deflection")) return { kin: 25 };
            return null;
        };

        const towerPgOut = getDogma(dogmaMap, towerTypeId, DOGMA.POWERGRID_OUTPUT, 0);
        const towerCpuOut = getDogma(dogmaMap, towerTypeId, DOGMA.CPU_OUTPUT, 0);

        const shieldHP = getDogma(dogmaMap, towerTypeId, DOGMA.SHIELD_HP, 0);
        const armorHP = getDogma(dogmaMap, towerTypeId, DOGMA.ARMOR_HP, 0);
        const hullHP = getDogma(dogmaMap, towerTypeId, DOGMA.HULL_HP, 0);

        const baseReso = {
            em: clamp01(getDogma(dogmaMap, towerTypeId, DOGMA.SHIELD_EM_RESO, 1)),
            exp: clamp01(getDogma(dogmaMap, towerTypeId, DOGMA.SHIELD_EXP_RESO, 1)),
            kin: clamp01(getDogma(dogmaMap, towerTypeId, DOGMA.SHIELD_KIN_RESO, 1)),
            therm: clamp01(getDogma(dogmaMap, towerTypeId, DOGMA.SHIELD_TH_RESO, 1)),
        };

        let totalPgUsed = 0;
        let totalCpuUsed = 0;

        const hardenerBonuses = {
            em: [],
            exp: [],
            kin: [],
            therm: [],
        };

        for (const m of modules) {
            const typeId = Number(m.type_id);
            const qty = Math.max(1, Number(m.qty || 1));

            const pgEach = Math.max(
                getDogma(dogmaMap, typeId, DOGMA.POWER_LOAD, 0),
                getDogma(dogmaMap, typeId, DOGMA.MODULE_POWER_LOAD, 0),

                getDogma(dogmaMap, typeId, DOGMA.POWERGRID_OUTPUT, 0)
            );
            const cpuEach = Math.max(
                getDogma(dogmaMap, typeId, DOGMA.CPU_LOAD, 0),
                getDogma(dogmaMap, typeId, DOGMA.MODULE_CPU_LOAD, 0),

                getDogma(dogmaMap, typeId, DOGMA.CPU_OUTPUT, 0)
            );

            totalPgUsed += pgEach * qty;
            totalCpuUsed += cpuEach * qty;

let emB = getDogma(dogmaMap, typeId, DOGMA.SHIELD_EM_BONUS, 0);
let expB = getDogma(dogmaMap, typeId, DOGMA.SHIELD_EXP_BONUS, 0);
let kinB = getDogma(dogmaMap, typeId, DOGMA.SHIELD_KIN_BONUS, 0);
let thB = getDogma(dogmaMap, typeId, DOGMA.SHIELD_TH_BONUS, 0);

if (!emB) {
    const r = getDogma(dogmaMap, typeId, DOGMA.SHIELD_EM_RESO, 1);
    if (r > 0 && r < 1) emB = (1 - r) * 100;
}
if (!expB) {
    const r = getDogma(dogmaMap, typeId, DOGMA.SHIELD_EXP_RESO, 1);
    if (r > 0 && r < 1) expB = (1 - r) * 100;
}
if (!kinB) {
    const r = getDogma(dogmaMap, typeId, DOGMA.SHIELD_KIN_RESO, 1);
    if (r > 0 && r < 1) kinB = (1 - r) * 100;
}
if (!thB) {
    const r = getDogma(dogmaMap, typeId, DOGMA.SHIELD_TH_RESO, 1);
    if (r > 0 && r < 1) thB = (1 - r) * 100;
}

{
    const fb = hardenerFallbackFromName(typeId);
    if (fb?.em) emB = fb.em;
    if (fb?.exp) expB = fb.exp;
    if (fb?.kin) kinB = fb.kin;
    if (fb?.therm) thB = fb.therm;
}

            for (let i = 0; i < qty; i++) {
                if (emB) hardenerBonuses.em.push(emB);
                if (expB) hardenerBonuses.exp.push(expB);
                if (kinB) hardenerBonuses.kin.push(kinB);
                if (thB) hardenerBonuses.therm.push(thB);
            }
        }

        function applyBonusesToResonance(base, bonuses) {
            if (!bonuses?.length) return base;
            const sorted = [...bonuses].sort((a, b) => b - a);

            let reso = base;
            sorted.forEach((bonusPct, idx) => {
                const eff = (bonusPct / 100) * stackingPenalty(idx);
                reso = reso * (1 - eff);
            });
            return clamp01(reso);
        }

        const finalReso = {
            em: applyBonusesToResonance(baseReso.em, hardenerBonuses.em),
            exp: applyBonusesToResonance(baseReso.exp, hardenerBonuses.exp),
            kin: applyBonusesToResonance(baseReso.kin, hardenerBonuses.kin),
            therm: applyBonusesToResonance(baseReso.therm, hardenerBonuses.therm),
        };

        const baseResists = {
            em: (1 - baseReso.em) * 100,
            exp: (1 - baseReso.exp) * 100,
            kin: (1 - baseReso.kin) * 100,
            therm: (1 - baseReso.therm) * 100,
        };

        const finalResists = {
            em: (1 - finalReso.em) * 100,
            exp: (1 - finalReso.exp) * 100,
            kin: (1 - finalReso.kin) * 100,
            therm: (1 - finalReso.therm) * 100,
        };

        const avgShieldResist = (finalResists.em + finalResists.exp + finalResists.kin + finalResists.therm) / 4 / 100;
        const shieldEHP = shieldHP > 0 ? shieldHP / Math.max(1e-6, (1 - avgShieldResist)) : 0;

        const armorEHP = armorHP > 0 ? armorHP : 0;
        const hullEHP = hullHP > 0 ? hullHP : 0;

        const totalEHP = shieldEHP + armorEHP + hullEHP;

        res.json({
            tower: {
                type_id: towerTypeId,
                pg_out_mw: round2(towerPgOut),
                cpu_out_tf: round2(towerCpuOut),
                hp: {
                    shield: round2(shieldHP),
                    armor: round2(armorHP),
                    hull: round2(hullHP),
                },
                shield_resists: {
                    base: {
                        em: round2(baseResists.em),
                        exp: round2(baseResists.exp),
                        kin: round2(baseResists.kin),
                        therm: round2(baseResists.therm),
                    },
                    final: {
                        em: round2(finalResists.em),
                        exp: round2(finalResists.exp),
                        kin: round2(finalResists.kin),
                        therm: round2(finalResists.therm),
                    },
                },
                ehp: {
                    shield: round2(shieldEHP),
                    total: round2(totalEHP),
                },
            },
            fitting: {
                pg_used_mw: round2(totalPgUsed),
                cpu_used_tf: round2(totalCpuUsed),
                pg_pct: towerPgOut > 0 ? round2((totalPgUsed / towerPgOut) * 100) : 0,
                cpu_pct: towerCpuOut > 0 ? round2((totalCpuUsed / towerCpuOut) * 100) : 0,
            },
        });
    } catch (e) {
        console.error("[pos/calc] error", e);
        res.status(500).json({ error: "pos/calc failed" });
    }
});

module.exports = router;
