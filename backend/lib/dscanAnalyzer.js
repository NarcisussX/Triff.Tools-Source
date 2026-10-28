/*
 * D-scan parser and report analyzer.
 * Resolves scan rows against SDE data and computes wormhole transit-mass summaries.
 */

const SDE_NON_DISPLAY_MASS_SENTINEL = 1e30;

const DEFAULT_COMPARISONS = [
  { key: "BAND_XL", label: "3,300,000 (XL) Mass Holes", note: "ex: H296", codes: ["H296"], massKg: 3_300_000_000 },
  { key: "BAND_3M", label: "3,000,000 Mass holes", note: "ex: H900 / N770 / N072", codes: ["H900", "N770", "N072"], massKg: 3_000_000_000 },
  { key: "BAND_2M", label: "2,000,000 Mass holes", note: "ex: E175", codes: ["E175"], massKg: 2_000_000_000 },
  { key: "BAND_1M", label: "1,000,000 Mass holes", note: "ex: D364", codes: ["D364"], massKg: 1_000_000_000 },
];

const WORMHOLE_BANDS = [
  {
    label: "1000Gg",
    totalMassKg: 1_000_000_000,
    codes: ["D364", "O128", "M267", "X702"],
  },
  {
    label: "2000Gg",
    totalMassKg: 2_000_000_000,
    codes: [
      "A239",
      "B449",
      "E175",
      "I182",
      "N968",
      "X877",
      "A641",
      "C247",
      "E545",
      "L477",
      "O477",
      "Q877",
      "Y683",
      "B274",
      "D382",
      "N766",
      "T405",
      "Z457",
    ],
  },
  {
    label: "3000Gg",
    totalMassKg: 3_000_000_000,
    codes: [
      "A982",
      "M555",
      "N770",
      "R474",
      "U319",
      "A641",
      "H900",
      "N062",
      "N944",
      "S199",
      "U574",
      "B274",
      "K346",
      "N432",
      "R051",
      "U210",
      "V283",
      "S047",
      "N290",
      "K329",
      "N072",
    ],
  },
  {
    label: "3300Gg",
    totalMassKg: 3_300_000_000,
    codes: ["B520", "C248", "D792", "W237", "C140", "C391", "H296", "Z142", "V911"],
  },
];

const WORMHOLE_TYPES = WORMHOLE_BANDS.flatMap((band) =>
  band.codes.map((code) => ({
    code,
    label: `${code} (${band.label})`,
    totalMassKg: band.totalMassKg,
    minimumMassKg: Math.round(band.totalMassKg * 0.9),
    criticalMassKg: Math.round(band.totalMassKg * 0.1),
    band: band.label,
  }))
);

function normalizeName(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLine(value) {
  return String(value || "").replace(/\u00a0/g, " ").trim();
}

function cleanInt(value) {
  const n = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function isLikelyDistance(value) {
  const text = String(value || "").trim();
  return (
    text === "-" ||
    /^-?\d[\d,. ]*\s*(m|km|au)$/i.test(text) ||
    /^-?\d[\d,. ]*$/i.test(text)
  );
}

function isHeaderLine(line) {
  const normalized = line.toLowerCase();
  return (
    normalized === "name\ttype\tdistance" ||
    normalized.includes("past dscan into") ||
    normalized.includes("individual mass") ||
    /^name\s+type\s+distance$/i.test(normalized)
  );
}

function splitColumns(line) {
  const tabbed = line.split(/\t+/).map((part) => part.trim()).filter(Boolean);
  if (tabbed.length > 1) return tabbed;
  return line.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
}

function parseDscanLine(line, lineNumber) {
  const raw = cleanLine(line);
  if (!raw || isHeaderLine(raw)) return null;

  const cols = splitColumns(raw);
  if (cols.length >= 3) {
    const maybeTypeId = cleanInt(cols[0]);
    if (maybeTypeId && /^\d+$/.test(cols[0].replace(/[,\s]/g, ""))) {
      return {
        kind: "dscan",
        lineNumber,
        raw,
        typeId: maybeTypeId,
        name: normalizeName(cols[1]),
        typeName: normalizeName(cols[2]),
        distance: normalizeName(cols.slice(3).join(" ")) || null,
      };
    }

    if (isLikelyDistance(cols[cols.length - 1])) {
      return {
        kind: "dscan",
        lineNumber,
        raw,
        typeId: null,
        name: normalizeName(cols[0]),
        typeName: normalizeName(cols.slice(1, -1).join(" ")),
        distance: normalizeName(cols[cols.length - 1]),
      };
    }

    return null;
  }

  if (cols.length === 2) {
    const maybeTypeId = cleanInt(cols[0]);
    if (maybeTypeId && /^\d+$/.test(cols[0].replace(/[,\s]/g, ""))) {
      return {
        kind: "dscan",
        lineNumber,
        raw,
        typeId: maybeTypeId,
        name: normalizeName(cols[1]),
        typeName: normalizeName(cols[1]),
        distance: null,
      };
    }

    return {
      kind: "dscan",
      lineNumber,
      raw,
      typeId: null,
      name: normalizeName(cols[0]),
      typeName: normalizeName(cols[1]),
      distance: null,
    };
  }

  return null;
}

function parsePaste(input) {
  const lines = String(input || "").split(/\r?\n/);
  const parsed = lines
    .map((line, index) => parseDscanLine(line, index + 1))
    .filter((row) => row && (row.typeName || row.name));
  const dscanRows = parsed.filter((row) => row.kind === "dscan" && row.typeName);

  return {
    rows: parsed,
    dscanRows,
  };
}

function compactMass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n >= SDE_NON_DISPLAY_MASS_SENTINEL) return null;
  return n;
}

async function optionalRows(pool, label, sql, params) {
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } catch (err) {
    if (["42P01", "42703"].includes(err.code)) {
      console.warn(`[dscan] optional ${label} unavailable: ${err.message}`);
      return [];
    }
    throw err;
  }
}

async function resolveTypes(pool, dscanRows) {
  const typeIds = Array.from(
    new Set(dscanRows.map((row) => Number(row.typeId)).filter((typeId) => Number.isInteger(typeId) && typeId > 0))
  );
  const namesLower = Array.from(new Set(dscanRows.map((row) => normalizeName(row.typeName).toLowerCase()).filter(Boolean)));

  if (!typeIds.length && !namesLower.length) return new Map();

  const rows = await optionalRows(
    pool,
    "type resolve",
    `
    SELECT
      t."typeID" AS type_id,
      t."typeName" AS type_name,
      t."mass" AS mass,
      t."volume" AS volume,
      t."published" AS published,
      g."groupID" AS group_id,
      g."groupName" AS group_name,
      c."categoryID" AS category_id,
      c."categoryName" AS category_name,
      mg."marketGroupID" AS market_group_id,
      mg."marketGroupName" AS market_group_name
    FROM evesde."invTypes" t
    LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
    LEFT JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
    LEFT JOIN evesde."invMarketGroups" mg ON mg."marketGroupID" = t."marketGroupID"
    WHERE ($1::integer[] IS NOT NULL AND t."typeID" = ANY($1::integer[]))
       OR ($2::text[] IS NOT NULL AND lower(t."typeName") = ANY($2::text[]))
    `,
    [typeIds, namesLower]
  );

  const byTypeId = new Map();
  const byName = new Map();
  for (const row of rows) {
    const meta = {
      type_id: Number(row.type_id),
      type_name: row.type_name,
      mass: compactMass(row.mass),
      volume: row.volume == null ? null : Number(row.volume),
      published: row.published !== false,
      group_id: row.group_id == null ? null : Number(row.group_id),
      group_name: row.group_name || null,
      category_id: row.category_id == null ? null : Number(row.category_id),
      category_name: row.category_name || null,
      market_group_id: row.market_group_id == null ? null : Number(row.market_group_id),
      market_group_name: row.market_group_name || null,
    };
    byTypeId.set(meta.type_id, meta);
    byName.set(String(meta.type_name || "").toLowerCase(), meta);
  }

  const out = new Map();
  for (const row of dscanRows) {
    const byId = row.typeId ? byTypeId.get(Number(row.typeId)) : null;
    const byExactName = byName.get(normalizeName(row.typeName).toLowerCase());
    out.set(row.lineNumber, byId || byExactName || null);
  }
  return out;
}

function typeKind(meta) {
  const category = String(meta?.category_name || "").toLowerCase();
  const group = String(meta?.group_name || "").toLowerCase();
  if (category === "ship") return "ship";
  if (category === "structure" || group.includes("structure")) return "structure";
  if (group.includes("scanner probe") || group.includes("probe")) return "probe";
  if (category === "celestial" || group.includes("sun") || group.includes("planet") || group.includes("moon")) return "celestial";
  if (!meta) return "unresolved";
  return "object";
}

function addGroup(map, key, payload, massKg = 0) {
  const existing = map.get(key) || {
    key,
    type_id: payload.type_id ?? null,
    type_name: payload.type_name,
    group_name: payload.group_name ?? null,
    category_name: payload.category_name ?? null,
    kind: payload.kind,
    quantity: 0,
    mass_kg: payload.mass_kg ?? null,
    total_mass_kg: 0,
    sample_names: [],
  };
  existing.quantity += 1;
  existing.total_mass_kg += massKg || 0;
  if (payload.sample_name && existing.sample_names.length < 5 && !existing.sample_names.includes(payload.sample_name)) {
    existing.sample_names.push(payload.sample_name);
  }
  map.set(key, existing);
}

function sortedGroups(map) {
  return Array.from(map.values()).sort((a, b) => {
    if ((b.quantity || 0) !== (a.quantity || 0)) return (b.quantity || 0) - (a.quantity || 0);
    if ((b.total_mass_kg || 0) !== (a.total_mass_kg || 0)) return (b.total_mass_kg || 0) - (a.total_mass_kg || 0);
    return String(a.type_name || "").localeCompare(String(b.type_name || ""));
  });
}

function buildMassComparison(row, totalMassKg, largestShipMassKg) {
  const capacityKg = Number(row.massKg);
  const usedPct = capacityKg > 0 ? (totalMassKg / capacityKg) * 100 : null;
  const remainingKg = capacityKg - totalMassKg;
  let status = "ok";
  if (remainingKg < 0) status = "over";
  else if (usedPct != null && usedPct >= 90) status = "critical";
  else if (usedPct != null && usedPct >= 50) status = "reduced";

  return {
    ...row,
    capacityKg,
    totalMassKg,
    largestShipMassKg,
    usedPct,
    remainingKg,
    status,
    closesHole: remainingKg < 0,
  };
}

function buildWormholeAnalysis(totalMassKg, largestShipMassKg, selectedCodes = []) {
  const selected = Array.from(
    new Set(
      (Array.isArray(selectedCodes) ? selectedCodes : [])
        .map((code) => String(code || "").trim().toUpperCase())
        .filter((code) => /^[A-Z]\d{3}$/.test(code))
    )
  );
  return {
    totalMassKg,
    totalMassKt: totalMassKg / 1000,
    largestShipMassKg,
    comparisons: DEFAULT_COMPARISONS.map((row) => buildMassComparison(row, totalMassKg, largestShipMassKg)),
    selectedCodes: selected,
    bands: WORMHOLE_BANDS,
    types: WORMHOLE_TYPES,
  };
}

function dscanReport(parsed, typeMap, options = {}) {
  const shipGroups = new Map();
  const typeGroups = new Map();
  const classGroups = new Map();
  const entries = [];
  const unresolved = [];
  let shipCount = 0;
  let totalMassKg = 0;
  let largestShipMassKg = 0;
  let massKnownCount = 0;

  for (const row of parsed.dscanRows) {
    const meta = typeMap.get(row.lineNumber) || null;
    const kind = typeKind(meta);
    const isShip = kind === "ship";
    const massKg = isShip ? compactMass(meta?.mass) || 0 : 0;
    const entry = {
      line: row.lineNumber,
      name: row.name || null,
      type_id: meta?.type_id || row.typeId || null,
      type_name: meta?.type_name || row.typeName || null,
      input_type_name: row.typeName || null,
      distance: row.distance || null,
      group_name: meta?.group_name || null,
      category_name: meta?.category_name || null,
      kind,
      mass_kg: isShip && massKg ? massKg : null,
      raw: row.raw,
      resolved: !!meta,
    };
    entries.push(entry);

    const typeKey = entry.type_id ? `id:${entry.type_id}` : `name:${String(entry.type_name || entry.input_type_name || "").toLowerCase()}`;
    addGroup(typeGroups, `${kind}:${typeKey}`, {
      type_id: entry.type_id,
      type_name: entry.type_name || entry.input_type_name || "Unknown",
      group_name: entry.group_name,
      category_name: entry.category_name,
      kind,
      mass_kg: entry.mass_kg,
      sample_name: entry.name,
    }, massKg);

    if (isShip) {
      shipCount += 1;
      totalMassKg += massKg;
      largestShipMassKg = Math.max(largestShipMassKg, massKg);
      if (massKg > 0) massKnownCount += 1;

      addGroup(shipGroups, typeKey, {
        type_id: entry.type_id,
        type_name: entry.type_name || entry.input_type_name || "Unknown Ship",
        group_name: entry.group_name,
        category_name: entry.category_name,
        kind,
        mass_kg: massKg || null,
        sample_name: entry.name,
      }, massKg);
      addGroup(classGroups, entry.group_name || "Unknown Class", {
        type_id: null,
        type_name: entry.group_name || "Unknown Class",
        group_name: entry.group_name || "Unknown Class",
        category_name: entry.category_name,
        kind: "ship_class",
        mass_kg: null,
        sample_name: entry.type_name || entry.input_type_name,
      }, massKg);
    }

    if (!meta || (isShip && !massKg)) {
      unresolved.push({
        line: row.lineNumber,
        name: row.name || null,
        type_id: row.typeId || null,
        type_name: row.typeName || null,
        reason: !meta ? "type_not_found" : "mass_missing",
        raw: row.raw,
      });
    }
  }

  const shipRows = sortedGroups(shipGroups);
  const classRows = sortedGroups(classGroups);
  const allTypeRows = sortedGroups(typeGroups);
  const ignoredCount = entries.filter((entry) => entry.kind !== "ship").length;

  return {
    ok: true,
    version: 1,
    scanType: "dscan",
    createdAt: new Date().toISOString(),
    inputLineCount: parsed.rows.length,
    summary: {
      itemCount: entries.length,
      shipCount,
      totalMassKg,
      totalMassKt: totalMassKg / 1000,
      largestShipMassKg,
      massKnownCount,
      ignoredCount,
      unresolvedCount: unresolved.length,
      uniqueShipTypes: shipRows.length,
      uniqueClasses: classRows.length,
    },
    wormhole: buildWormholeAnalysis(totalMassKg, largestShipMassKg, options.wormholeCodes),
    ships: shipRows,
    shipClasses: classRows,
    objects: allTypeRows,
    entries,
    unresolved,
  };
}

async function analyzePaste(pool, input, options = {}) {
  const parsed = parsePaste(input);
  if (!parsed.dscanRows.length) {
    const err = new Error("dscan_required");
    err.code = "DSCAN_REQUIRED";
    throw err;
  }

  const typeMap = await resolveTypes(pool, parsed.dscanRows);
  return dscanReport(parsed, typeMap, options);
}

module.exports = {
  analyzePaste,
  parsePaste,
  WORMHOLE_BANDS,
  WORMHOLE_TYPES,
  DEFAULT_COMPARISONS,
};
