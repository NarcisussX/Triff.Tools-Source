/*
 * Backend library module for everef Data.
 * Provides shared data loading, pricing, or planning helpers used by API routes and jobs.
 */

const fs = require('fs');
const path = require('path');
const priceCache = require('./priceCache');

const BASE_DATA_DIR = path.join(__dirname, '..', 'routes', 'data');
const EVEREF_DIR = path.join(BASE_DATA_DIR, 'everef');

let typesById = new Map();
let adjustedPriceByTypeId = new Map();
let productToBlueprints = new Map();
let materialToBlueprints = new Map();
let lastLoadMtime = 0;
let loggedMissingOnce = false;

function loadJson(p) {
    try {
        if (!fs.existsSync(p)) return null;
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        console.error('[everefData] load error', p, e.message);
        return null;
    }
}

function getLatestMtime(files) {
    let latest = 0;
    for (const f of files) {
        try {
            if (!fs.existsSync(f)) continue;
            const st = fs.statSync(f);
            const m = st.mtimeMs || st.mtime.getTime();
            if (m > latest) latest = m;
        } catch {

        }
    }
    return latest;
}

function firstNumber(...values) {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return null;
}

function normalizeTypeRecord(id, raw) {
    const name =
        (raw.name && (raw.name.en || raw.name['en-us'])) ||
        raw.name ||
        raw.typeName ||
        String(id);
    const volume = firstNumber(raw.volume, raw.packaged_volume, raw.packagedVolume) || 0;

    return {
        type_id: id,
        name,
        volume,
        packagedVolume: firstNumber(raw.packaged_volume, raw.packagedVolume),
        mass: firstNumber(raw.mass),
        capacity: firstNumber(raw.capacity),
        radius: firstNumber(raw.radius),
    };
}

function ensureLoaded() {
    const typesPath = path.join(EVEREF_DIR, 'types.json');
    const bpPath = path.join(EVEREF_DIR, 'blueprints.json');
    const adjPath = path.join(EVEREF_DIR, 'adjusted_prices.json');

    const latest = getLatestMtime([typesPath, bpPath, adjPath]);
    if (!latest) {
        if (!loggedMissingOnce) {
            console.warn(
                '[everefData] Everef data not present yet (types/blueprints/adjusted); will retry on next call.'
            );
            loggedMissingOnce = true;
        }
        return;
    }

    if (
        latest <= lastLoadMtime &&
        typesById.size > 0 &&
        productToBlueprints.size > 0
    ) {
        return;
    }

    const typesJson = loadJson(typesPath);
    const bpJson = loadJson(bpPath);
    const adjustedJson = loadJson(adjPath);

    if (!typesJson || !bpJson) {
        if (!loggedMissingOnce) {
            console.warn(
                '[everefData] Missing types.json or blueprints.json; will retry later.'
            );
            loggedMissingOnce = true;
        }
        return;
    }

    loggedMissingOnce = true;
    lastLoadMtime = latest;

    const tMap = new Map();

    if (Array.isArray(typesJson)) {
        for (const t of typesJson) {
            if (!t) continue;
            const id =
                typeof t.type_id === 'number'
                    ? t.type_id
                    : typeof t.typeID === 'number'
                        ? t.typeID
                        : null;
            if (!id) continue;
            tMap.set(id, normalizeTypeRecord(id, t));
        }
    } else {
        for (const [k, v] of Object.entries(typesJson)) {
            if (!v) continue;
            const id =
                typeof v.type_id === 'number'
                    ? v.type_id
                    : typeof v.typeID === 'number'
                        ? v.typeID
                        : Number(k);
            if (!id) continue;
            tMap.set(id, normalizeTypeRecord(id, v));
        }
    }

    const aMap = new Map();
    if (adjustedJson) {
        if (Array.isArray(adjustedJson)) {
            for (const r of adjustedJson) {
                if (!r) continue;
                const id =
                    typeof r.type_id === 'number'
                        ? r.type_id
                        : typeof r.typeID === 'number'
                            ? r.typeID
                            : null;
                if (!id || typeof r.adjusted_price !== 'number') continue;
                aMap.set(id, r.adjusted_price);
            }
        } else {
            for (const [k, v] of Object.entries(adjustedJson)) {
                if (!v) continue;
                const id =
                    typeof v.type_id === 'number'
                        ? v.type_id
                        : typeof v.typeID === 'number'
                            ? v.typeID
                            : Number(k);
                if (!id) continue;
                const ap =
                    typeof v.adjusted_price === 'number'
                        ? v.adjusted_price
                        : typeof v === 'number'
                            ? v
                            : null;
                if (ap) aMap.set(id, ap);
            }
        }
    }

    const ptb = new Map();
    const mtb = new Map();

    const src = bpJson.blueprints || bpJson;
    const arr = Array.isArray(src)
        ? src
        : Object.entries(src).map(([k, v]) => ({
            _keyId: Number(k),
            ...v,
        }));

    const getTypeId = (obj) =>
        Number(
            obj.type_id ??
            obj.typeID ??
            obj.productTypeID ??
            obj.typeId ??
            0
        );

    for (const bp of arr) {
        if (!bp || !bp.activities) continue;

        const blueprintId = Number(
            bp.blueprint_type_id ??
            bp.blueprintTypeID ??
            bp._keyId ??
            0
        );
        if (!blueprintId) continue;

        const addActivity = (activityKey, label) => {
            const act = bp.activities[activityKey];
            if (!act) return;

            let matsSrc = act.materials || [];
            if (!Array.isArray(matsSrc) && typeof matsSrc === 'object') {
                matsSrc = Object.values(matsSrc).flat();
            }
            const materials = [];
            for (const m of matsSrc) {
                if (!m) continue;
                const mid = getTypeId(m);
                const qty = Number(m.quantity || m.amount || 0);
                if (mid && qty > 0) {
                    materials.push({ typeId: mid, quantity: qty });
                }
            }

            let prodsSrc = act.products || [];
            if (!Array.isArray(prodsSrc) && typeof prodsSrc === 'object') {
                prodsSrc = Object.values(prodsSrc).flat();
            }
            for (const p of prodsSrc) {
                if (!p) continue;
                const pid = getTypeId(p);
                const pqty = Number(p.quantity || p.amount || 0);
                if (!pid || pqty <= 0) continue;

                const entry = {
                    blueprintId,
                    activity: label,
                    productTypeId: pid,
                    productQtyPerRun: pqty,
                    time: Number(act.time || 0),
                    materials,
                };

                if (!ptb.has(pid)) ptb.set(pid, []);
                ptb.get(pid).push(entry);

                for (const material of materials) {
                    if (!mtb.has(material.typeId)) mtb.set(material.typeId, []);
                    mtb.get(material.typeId).push(entry);
                }
            }
        };

        addActivity('manufacturing', 'manufacturing');
        addActivity('reaction', 'reaction');
    }

    typesById = tMap;
    adjustedPriceByTypeId = aMap;
    productToBlueprints = ptb;
    materialToBlueprints = mtb;

    console.log(
        `[everefData] Loaded ${typesById.size} types, ${productToBlueprints.size} product blueprints`
    );

    if (productToBlueprints.size === 0) {
        console.warn(
            '[everefData] WARNING: No product blueprints indexed. Check blueprints.json schema.'
        );
    }
}

function getPrice(typeId, mode = 'sell_min') {
    return priceCache.getPrice(typeId, mode) || 0;
}

function getType(typeId) {
    ensureLoaded();
    return typesById.get(typeId) || { type_id: typeId, name: String(typeId) };
}

function searchTypesByName(query, limit = 20) {
  ensureLoaded();
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];

  const results = [];

  for (const t of typesById.values()) {
    const name = t?.name;
    if (!name) continue;

    const lower = name.toLowerCase();
    const pos = lower.indexOf(q);
    if (pos === -1) continue;

    let rank = 2;
    if (lower === q) rank = 0;
    else if (pos === 0) rank = 1;

    results.push({
      type_id: t.type_id,
      name,
      rank,
      pos,
    });
  }

  results.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.pos !== b.pos) return a.pos - b.pos;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return results.slice(0, limit);
}

function getBlueprintsForProduct(productTypeId) {
    ensureLoaded();
    return productToBlueprints.get(productTypeId) || [];
}

function getBlueprintsUsingMaterial(materialTypeId) {
    ensureLoaded();
    return materialToBlueprints.get(materialTypeId) || [];
}

function getMarketPrice(typeId) {
    return getPrice(typeId, 'sell_min');
}

function getAdjustedPrice(typeId) {
    ensureLoaded();
    return adjustedPriceByTypeId.get(typeId) || 0;
}

module.exports = {
    getType,
    searchTypesByName,
    getBlueprintsForProduct,
    getBlueprintsUsingMaterial,
    getMarketPrice,
    getAdjustedPrice,
    getPrice,
};
