const crypto = require("crypto");
const pool = require("../db/pool");
const { runMigrations } = require("../db/migrations");
const fittingEsi = require("./fittingEsi");
const eveSkills = require("../domain/eveSkills");
const planFormats = require("../domain/eveSkills/planFormats");

const DOGMA = Object.freeze({
  primaryAttribute: 180,
  secondaryAttribute: 181,
  requiredSkill1: 182,
  requiredSkill2: 183,
  requiredSkill3: 184,
  rank: 275,
  requiredSkill1Level: 277,
  requiredSkill2Level: 278,
  requiredSkill3Level: 279,
  requiredSkill4: 1285,
  requiredSkill4Level: 1286,
  requiredSkill5Level: 1287,
  requiredSkill6Level: 1288,
  requiredSkill5: 1289,
  requiredSkill6: 1290,
});

const IMPLANT_DOGMA = Object.freeze({
  charisma: 175,
  intelligence: 176,
  memory: 177,
  perception: 178,
  willpower: 179,
  slot: 331,
});

const ATTRIBUTE_BY_ID = Object.freeze({
  164: "charisma",
  165: "intelligence",
  166: "memory",
  167: "perception",
  168: "willpower",
});

const ATTRIBUTE_KEYS = Object.freeze(["charisma", "intelligence", "memory", "perception", "willpower"]);
const IMPLANT_SCOPE = "esi-clones.read_implants.v1";
const CLONE_SCOPE = "esi-clones.read_clones.v1";
const MAX_PLANS_PER_USER = 100;
const MAX_PLAN_ENTRIES = 1000;
const MAX_PLAN_NAME = 160;
const MAX_PLAN_NOTES = 10_000;
const CATALOG_TTL_MS = 30 * 60 * 1000;
const SNAPSHOT_STALE_MS = 6 * 60 * 60 * 1000;
const BACKGROUND_REFRESH_THROTTLE_MS = 60 * 1000;
const MAX_BACKGROUND_REFRESH_CHARACTERS = 8;
const BACKGROUND_REFRESH_CONCURRENCY = 2;
const MAX_OPTIMIZER_MILESTONES = 300;
const MAX_OPTIMIZER_REMAPS = 2;

let catalogCache = { fetchedAt: 0, value: null };
const backgroundRefreshAt = new Map();

function serviceError(code, status = 400, message = code, details = undefined) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function integer(value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function optimizerRequestLimits(input = {}) {
  const maxRemaps = input.maxRemaps == null
    ? 0
    : integer(input.maxRemaps, { min: 0, max: MAX_OPTIMIZER_REMAPS });
  if (maxRemaps == null) {
    throw serviceError(
      "optimizer_section_limit",
      422,
      `maxRemaps must be an integer from 0 to ${MAX_OPTIMIZER_REMAPS}.`,
      {
        maximumRemaps: MAX_OPTIMIZER_REMAPS,
        maximumSections: MAX_OPTIMIZER_REMAPS + 1,
      },
    );
  }
  return { maxRemaps, maxSections: maxRemaps + 1 };
}

function assertOptimizerMilestoneLimit(milestoneCount) {
  if (!Number.isSafeInteger(milestoneCount) || milestoneCount < 0) {
    throw serviceError("optimizer_invalid_workload", 500, "The optimizer received an invalid workload.");
  }
  if (milestoneCount > MAX_OPTIMIZER_MILESTONES) {
    throw serviceError(
      "optimizer_plan_too_large",
      413,
      `Plans with more than ${MAX_OPTIMIZER_MILESTONES} atomic milestones cannot be optimized in one request.`,
      {
        milestoneCount,
        maximumMilestones: MAX_OPTIMIZER_MILESTONES,
      },
    );
  }
  return milestoneCount;
}

function characterId(value) {
  return integer(value, { min: 1 });
}

function typeId(value) {
  return integer(value, { min: 1, max: 2_147_483_647 });
}

function uuid(value) {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function boundedText(value, limit, fallback = "") {
  const text = String(value ?? "").trim();
  return (text || fallback).slice(0, limit);
}

function numeric(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function asObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return [];
}

function hasOwnAny(value, keys) {
  return Boolean(value && typeof value === "object" && keys.some((key) => Object.prototype.hasOwnProperty.call(value, key)));
}

function attributeName(value) {
  return ATTRIBUTE_BY_ID[Number(value)] || null;
}

function prerequisiteRows(row) {
  const result = [];
  for (let index = 1; index <= 6; index += 1) {
    const requiredId = typeId(row[`req${index}`]);
    if (!requiredId) continue;
    result.push({
      skillTypeId: requiredId,
      requiredLevel: integer(row[`req${index}_level`], { min: 1, max: 5 }) || 1,
    });
  }
  return result;
}

async function ensureReady() {
  await runMigrations();
}

async function loadSkillCatalog({ force = false } = {}) {
  if (!force && catalogCache.value && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS) {
    return catalogCache.value;
  }

  const dogmaIds = Object.values(DOGMA);
  let rows;
  try {
    ({ rows } = await pool.query(
      `WITH attrs AS (
         SELECT
           "typeID",
           MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.primaryAttribute}) AS primary_attribute_id,
           MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.secondaryAttribute}) AS secondary_attribute_id,
           MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.rank}) AS rank,
           MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.requiredSkill1}) AS req1,
           MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.requiredSkill1Level}) AS req1_level,
           MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.requiredSkill2}) AS req2,
           MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.requiredSkill2Level}) AS req2_level,
           MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.requiredSkill3}) AS req3,
           MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.requiredSkill3Level}) AS req3_level,
           MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.requiredSkill4}) AS req4,
           MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.requiredSkill4Level}) AS req4_level,
           MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.requiredSkill5}) AS req5,
           MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.requiredSkill5Level}) AS req5_level,
           MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.requiredSkill6}) AS req6,
           MAX(value) FILTER (WHERE "attributeID" = ${DOGMA.requiredSkill6Level}) AS req6_level
         FROM evesde."typeDogmaAttributes"
         WHERE "attributeID" = ANY($1::integer[])
         GROUP BY "typeID"
       )
       SELECT
         t."typeID" AS skill_type_id,
         t."typeName" AS skill_name,
         t."description" AS description,
         g."groupID" AS group_id,
         g."groupName" AS group_name,
         attrs.*
       FROM evesde."invTypes" t
       JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
       JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
       LEFT JOIN attrs ON attrs."typeID" = t."typeID"
       WHERE c."categoryID" = 16
         AND COALESCE(t."published", true) = true
       ORDER BY g."groupName" ASC NULLS LAST, t."typeName" ASC`,
      [dogmaIds]
    ));
  } catch (err) {
    if (["42P01", "42703", "3F000"].includes(err.code)) rows = [];
    else throw err;
  }

  const skills = rows.map((row) => ({
    skillTypeId: Number(row.skill_type_id),
    typeId: Number(row.skill_type_id),
    skillName: row.skill_name || `Skill ${row.skill_type_id}`,
    typeName: row.skill_name || `Skill ${row.skill_type_id}`,
    description: row.description || "",
    groupId: row.group_id == null ? null : Number(row.group_id),
    groupName: row.group_name || "Other Skills",
    rank: Math.max(1, numeric(row.rank, 1)),
    primaryAttribute: attributeName(row.primary_attribute_id),
    secondaryAttribute: attributeName(row.secondary_attribute_id),
    prerequisites: prerequisiteRows(row),
  }));
  const byId = new Map(skills.map((skill) => [skill.skillTypeId, skill]));
  for (const skill of skills) {
    skill.prerequisites = skill.prerequisites.map((item) => ({
      ...item,
      level: item.requiredLevel,
      skillName: byId.get(item.skillTypeId)?.skillName || `Skill ${item.skillTypeId}`,
    }));
  }

  const value = { skills, byId };
  catalogCache = { fetchedAt: Date.now(), value };
  return value;
}

async function loadRequirementTargets() {
  try {
    const { rows } = await pool.query(
      `SELECT
         t."typeID" AS type_id,
         t."typeName" AS type_name,
         g."groupName" AS group_name,
         c."categoryName" AS category_name
       FROM evesde."invTypes" t
       JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
       JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
       WHERE c."categoryID" = 6
         AND COALESCE(t."published", true) = true
       ORDER BY g."groupName", t."typeName"`
    );
    return rows.map((row) => ({
      typeId: Number(row.type_id),
      name: row.type_name || `Type ${row.type_id}`,
      groupName: row.group_name || null,
      categoryName: row.category_name || null,
      iconUrl: `https://images.evetech.net/types/${Number(row.type_id)}/icon?size=64`,
    }));
  } catch (err) {
    if (["42P01", "42703", "3F000"].includes(err.code)) return [];
    throw err;
  }
}

async function catalog() {
  const [{ skills }, requirementTargets] = await Promise.all([loadSkillCatalog(), loadRequirementTargets()]);
  const groups = new Map();
  for (const skill of skills) groups.set(String(skill.groupId ?? skill.groupName), { id: skill.groupId, name: skill.groupName });
  return {
    skills,
    skillGroups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)),
    requirementTargets,
  };
}

async function directRequirementsForType(rawTypeId) {
  const id = typeId(rawTypeId);
  if (!id) throw serviceError("invalid_type_id", 400, "A valid EVE type ID is required.");
  const attributeIds = [
    DOGMA.requiredSkill1, DOGMA.requiredSkill1Level,
    DOGMA.requiredSkill2, DOGMA.requiredSkill2Level,
    DOGMA.requiredSkill3, DOGMA.requiredSkill3Level,
    DOGMA.requiredSkill4, DOGMA.requiredSkill4Level,
    DOGMA.requiredSkill5, DOGMA.requiredSkill5Level,
    DOGMA.requiredSkill6, DOGMA.requiredSkill6Level,
  ];
  const { rows: typeRows } = await pool.query(
    `SELECT
       t."typeID" AS type_id,
       t."typeName" AS type_name,
       g."groupName" AS group_name,
       c."categoryName" AS category_name
     FROM evesde."invTypes" t
     LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
     LEFT JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
     WHERE t."typeID" = $1
     LIMIT 1`,
    [id]
  );
  if (!typeRows[0]) throw serviceError("type_not_found", 404, "That EVE type was not found in the current SDE.");
  const { rows } = await pool.query(
    `SELECT "attributeID" AS attribute_id, value
     FROM evesde."typeDogmaAttributes"
     WHERE "typeID" = $1 AND "attributeID" = ANY($2::integer[])`,
    [id, attributeIds]
  );
  const values = new Map(rows.map((row) => [Number(row.attribute_id), Number(row.value)]));
  const direct = [];
  for (let index = 1; index <= 6; index += 1) {
    const skillId = typeId(values.get(DOGMA[`requiredSkill${index}`]));
    if (!skillId) continue;
    direct.push({
      skillTypeId: skillId,
      targetLevel: integer(values.get(DOGMA[`requiredSkill${index}Level`]), { min: 1, max: 5 }) || 1,
      explicit: true,
    });
  }
  return {
    type: {
      typeId: id,
      typeName: typeRows[0].type_name || `Type ${id}`,
      groupName: typeRows[0].group_name || null,
      categoryName: typeRows[0].category_name || null,
      iconUrl: `https://images.evetech.net/types/${id}/icon?size=64`,
    },
    direct,
  };
}

function preferenceFromRow(row) {
  return {
    pinned: row?.is_favorite === true,
    hidden: row?.is_hidden === true,
    group: row?.group_name || null,
  };
}

function snapshotSyncTime(snapshot) {
  const candidates = [
    snapshot?.fetchedAt,
    snapshot?.syncedAt,
    snapshot?.character?.monitorSyncedAt,
    snapshot?.character?.skillnixSyncedAt,
    snapshot?.character?.skillsSyncedAt,
    snapshot?.skills?.synced_at,
    snapshot?.skillQueue?.synced_at,
    snapshot?.queue?.synced_at,
  ].map((value) => (value ? new Date(value).getTime() : Number.NaN)).filter(Number.isFinite);
  return candidates.length ? new Date(Math.max(...candidates)).toISOString() : null;
}

function queueRows(snapshot) {
  const source = snapshot?.skillQueue?.queue ?? snapshot?.queue?.queue ?? snapshot?.queue ?? [];
  return asArray(source).slice().sort((a, b) => Number(a.queue_position ?? a.queuePosition ?? 0) - Number(b.queue_position ?? b.queuePosition ?? 0));
}

function skillDetails(snapshot) {
  const skills = snapshot?.skills || {};
  const levels = asObject(skills.skills || skills.levels);
  const details = asObject(skills.skill_details || skills.skillDetails);
  return { levels, details };
}

function publicQueue(queue, byId) {
  return queue.map((row, index) => {
    const skillTypeId = typeId(row.skill_id ?? row.skillTypeId ?? row.type_id);
    const position = integer(row.queue_position ?? row.queuePosition ?? index, { min: 0 }) ?? index;
    return {
      id: `queue-${position}-${skillTypeId || "unknown"}`,
      skillTypeId,
      skillName: byId.get(skillTypeId)?.skillName || row.skillName || `Skill ${skillTypeId || "unknown"}`,
      targetLevel: integer(row.finished_level ?? row.targetLevel, { min: 0, max: 5 }),
      startAt: iso(row.start_date ?? row.startAt),
      endAt: iso(row.finish_date ?? row.endAt),
      startSp: numeric(row.training_start_sp ?? row.level_start_sp ?? row.startSp),
      endSp: numeric(row.level_end_sp ?? row.endSp),
      completedSp: numeric(row.completed_sp ?? row.current_sp),
      queuePosition: position,
      planState: row.planState || null,
    };
  });
}

function implantTypeIds(source) {
  const result = [];
  const seen = new Set();
  for (const raw of asArray(source)) {
    const id = typeId(raw?.typeId ?? raw?.type_id ?? raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function activeImplantTypeIds(snapshot) {
  return implantTypeIds(snapshot?.implants?.implants ?? snapshot?.implants ?? []);
}

function normalizedJumpClones(snapshot) {
  const source = snapshot?.clones?.jumpClones
    ?? snapshot?.clones?.jump_clones
    ?? snapshot?.jumpClones
    ?? [];
  const seen = new Set();
  const result = [];
  for (const row of asArray(source)) {
    const jumpCloneId = integer(row?.jumpCloneId ?? row?.jump_clone_id, { min: 1 });
    const locationId = integer(row?.locationId ?? row?.location_id, { min: 1 });
    const locationType = ["station", "structure"].includes(String(row?.locationType ?? row?.location_type))
      ? String(row.locationType ?? row.location_type)
      : null;
    if (!jumpCloneId || !locationId || !locationType || seen.has(jumpCloneId)) continue;
    seen.add(jumpCloneId);
    const name = String(row?.name || "").trim().slice(0, 255) || null;
    result.push({
      jumpCloneId,
      name,
      locationId,
      locationType,
      implantTypeIds: implantTypeIds(row?.implants),
    });
  }
  return result;
}

async function implantDetailsForIds(rawIds) {
  const ids = implantTypeIds(rawIds);
  if (!ids.length) return [];
  const dogmaIds = Object.values(IMPLANT_DOGMA);
  const { rows } = await pool.query(
    `SELECT
       t."typeID" AS type_id,
       t."typeName" AS type_name,
       d."attributeID" AS attribute_id,
       d.value
     FROM evesde."invTypes" t
     LEFT JOIN evesde."typeDogmaAttributes" d
       ON d."typeID" = t."typeID" AND d."attributeID" = ANY($2::integer[])
     WHERE t."typeID" = ANY($1::integer[])
     ORDER BY t."typeName"`,
    [ids, dogmaIds]
  );
  const records = new Map(ids.map((id) => [id, { typeId: id, name: `Type ${id}`, slot: null, bonuses: {} }]));
  for (const row of rows) {
    const id = Number(row.type_id);
    const record = records.get(id) || { typeId: id, name: row.type_name || `Type ${id}`, slot: null, bonuses: {} };
    record.name = row.type_name || record.name;
    const dogmaId = Number(row.attribute_id);
    if (dogmaId === IMPLANT_DOGMA.slot) record.slot = numeric(row.value);
    for (const key of ATTRIBUTE_KEYS) {
      if (dogmaId === IMPLANT_DOGMA[key] && Number(row.value) !== 0) record.bonuses[key] = Number(row.value);
    }
    records.set(id, record);
  }
  return [...records.values()].map((record) => ({
    typeId: record.typeId,
    name: record.name,
    slot: record.slot,
    bonus: Object.entries(record.bonuses).map(([key, amount]) => `${key} +${amount}`).join(", ") || null,
    bonuses: record.bonuses,
  }));
}

function normalizedCloneHomeLocation(snapshot) {
  const source = snapshot?.clones?.homeLocation ?? snapshot?.clones?.home_location;
  const locationId = integer(source?.locationId ?? source?.location_id, { min: 1 });
  const locationType = ["station", "structure"].includes(String(source?.locationType ?? source?.location_type))
    ? String(source.locationType ?? source.location_type)
    : null;
  return locationId && locationType ? { locationId, locationType } : null;
}

async function cloneImplantDetails(snapshot) {
  const activeIds = activeImplantTypeIds(snapshot);
  const jumpClones = normalizedJumpClones(snapshot);
  const allIds = implantTypeIds([
    ...activeIds,
    ...jumpClones.flatMap((clone) => clone.implantTypeIds),
  ]);
  const implantDetails = await implantDetailsForIds(allIds);
  const byTypeId = new Map(implantDetails.map((implant) => [implant.typeId, implant]));
  const detailsFor = (ids) => ids.map((id) => byTypeId.get(id) || {
    typeId: id,
    name: `Type ${id}`,
    slot: null,
    bonus: null,
    bonuses: {},
  });
  const activeImplants = detailsFor(activeIds);
  const cloneSource = snapshot?.clones || {};
  return {
    activeClone: {
      implants: activeImplants,
      implantCount: activeImplants.length,
    },
    jumpClones: jumpClones.map(({ implantTypeIds: ids, ...clone }) => {
      const implants = detailsFor(ids);
      return { ...clone, implants, implantCount: implants.length };
    }),
    homeLocation: normalizedCloneHomeLocation(snapshot),
    lastCloneJumpDate: iso(cloneSource.lastCloneJumpDate ?? cloneSource.last_clone_jump_date),
    lastStationChangeDate: iso(cloneSource.lastStationChangeDate ?? cloneSource.last_station_change_date),
  };
}

function rawAttributes(snapshot) {
  return asObject(snapshot?.attributes?.attributes || snapshot?.attributes);
}

function esiAttributeMap(snapshot) {
  const source = rawAttributes(snapshot);
  return Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, numeric(source[key], 17)]));
}

function summedImplantBonuses(implants = []) {
  const bonuses = Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, 0]));
  for (const implant of implants) {
    for (const key of ATTRIBUTE_KEYS) bonuses[key] += numeric(implant?.bonuses?.[key], 0);
  }
  return bonuses;
}

function implantDataStatus(snapshot, missingScopes = []) {
  const freshness = snapshot?.freshness?.implants || {};
  return {
    available: freshness.available === true || snapshot?.implants != null,
    missingScope: asArray(missingScopes).map(String).includes(IMPLANT_SCOPE),
    fetchedAt: freshness.fetchedAt || null,
    stale: freshness.isStale === true,
    error: freshness.lastError || null,
  };
}

function cloneDataStatus(snapshot, missingScopes = []) {
  const freshness = snapshot?.freshness?.clones || {};
  return {
    available: freshness.available === true || snapshot?.clones != null,
    missingScope: asArray(missingScopes).map(String).includes(CLONE_SCOPE),
    fetchedAt: freshness.fetchedAt || null,
    stale: freshness.isStale === true,
    error: freshness.lastError || null,
  };
}

function legalBaseAttributes(attributes) {
  return ATTRIBUTE_KEYS.every((key) => Number.isInteger(attributes[key]) && attributes[key] >= 17 && attributes[key] <= 27)
    && ATTRIBUTE_KEYS.reduce((sum, key) => sum + attributes[key], 0) === 99;
}

function baseAttributesForOptimizer(effective, implantBonuses) {
  const withoutImplants = Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, effective[key] - implantBonuses[key]]));
  const excess = ATTRIBUTE_KEYS.reduce((sum, key) => sum + withoutImplants[key], 0) - 99;
  const temporaryBonus = excess >= 0 && Number.isInteger(excess / ATTRIBUTE_KEYS.length)
    ? excess / ATTRIBUTE_KEYS.length
    : null;
  const inferredBase = temporaryBonus == null
    ? null
    : Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, withoutImplants[key] - temporaryBonus]));
  if (inferredBase && legalBaseAttributes(inferredBase)) {
    return {
      attributes: inferredBase,
      inferred: Object.values(implantBonuses).some((value) => value !== 0),
      temporaryBonus,
      warning: temporaryBonus > 0
        ? `Current ESI attributes include an inferred +${temporaryBonus} temporary accelerator. Training estimates exclude it and use the character's persistent remap and active implants.`
        : null,
    };
  }
  return {
    attributes: { charisma: 19, intelligence: 20, memory: 20, perception: 20, willpower: 20 },
    inferred: false,
    temporaryBonus: null,
    warning: "Current base attributes could not be separated from active implants or temporary bonuses; estimates use ESI's available attributes, while the optimizer baseline uses a balanced legal remap.",
  };
}

function trainingAttributeContext(snapshot, implants = []) {
  // ESI attributes are effective values: remap + active implants + any cerebral
  // accelerator. Preserve them for display, then remove the inferred uniform
  // temporary bonus from training estimates. Active implant dogma bonuses are
  // removed separately only to recover the legal 99-point optimizer base map.
  const esiAttributes = esiAttributeMap(snapshot);
  const implantBonuses = summedImplantBonuses(implants);
  const optimizerBase = baseAttributesForOptimizer(esiAttributes, implantBonuses);
  const esiIncludedImplants = optimizerBase.inferred === true;
  const trainingAttributes = optimizerBase.temporaryBonus == null
    ? esiAttributes
    : Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, esiAttributes[key] - optimizerBase.temporaryBonus]));
  return {
    baseAttributes: optimizerBase.attributes,
    effectiveAttributes: esiAttributes,
    trainingAttributes,
    implantBonuses,
    esiAttributes,
    esiIncludedImplants,
    temporaryBonus: optimizerBase.temporaryBonus,
    optimizerWarning: optimizerBase.warning,
  };
}

function currentSkillState(snapshot) {
  const { levels, details } = skillDetails(snapshot);
  const state = {};
  for (const [key, value] of Object.entries(levels)) {
    const id = typeId(key);
    if (!id) continue;
    const detail = asObject(details[key]);
    state[id] = {
      level: integer(detail.trained_skill_level ?? value, { min: 0, max: 5 }) || 0,
      activeLevel: integer(detail.active_skill_level ?? value, { min: 0, max: 5 }) || 0,
      skillpoints: Math.max(0, numeric(detail.skillpoints_in_skill, 0)),
    };
  }
  for (const [key, value] of Object.entries(details)) {
    const id = typeId(key);
    if (!id || state[id]) continue;
    const detail = asObject(value);
    state[id] = {
      level: integer(detail.trained_skill_level, { min: 0, max: 5 }) || 0,
      activeLevel: integer(detail.active_skill_level, { min: 0, max: 5 }) || 0,
      skillpoints: Math.max(0, numeric(detail.skillpoints_in_skill, 0)),
    };
  }
  return state;
}

function trainedSkillLevel(state) {
  return integer(state?.level ?? state?.trainedLevel ?? state?.trained_skill_level, { min: 0, max: 5 }) ?? 0;
}

function activeSkillLevel(state) {
  return integer(
    state?.activeLevel ?? state?.active_skill_level ?? state?.level ?? state?.trainedLevel ?? state?.trained_skill_level,
    { min: 0, max: 5 }
  ) ?? 0;
}

function requirementIsMissing(state, targetLevel, remainingSp = 0) {
  return activeSkillLevel(state) < targetLevel || numeric(remainingSp, 0) > 0;
}

function reconcileSkillContext(state, queue, now = Date.now()) {
  const sourceRows = Object.entries(state || {}).map(([skillTypeId, row]) => ({
    skillTypeId: Number(skillTypeId),
    trainedLevel: trainedSkillLevel(row),
    activeLevel: activeSkillLevel(row),
    skillPoints: Math.max(0, numeric(row?.skillpoints ?? row?.skillPoints, 0)),
  }));
  const validQueue = asArray(queue).filter((row) => (
    typeId(row?.skillTypeId ?? row?.skill_id)
    && integer(row?.targetLevel ?? row?.finished_level, { min: 1, max: 5 })
  ));
  const reconciled = eveSkills.reconcileSkillsWithQueue({ skills: sourceRows, queue: validQueue, now });
  const nextState = {};
  for (const row of reconciled.skills) {
    const prior = state?.[row.skillTypeId] ?? state?.[String(row.skillTypeId)] ?? null;
    const priorTrained = trainedSkillLevel(prior);
    const priorActive = activeSkillLevel(prior);
    // A lower ESI active level is the authoritative Alpha restriction. Queue
    // reconciliation may advance trained level/SP, but must not erase that cap.
    const activeLevel = prior && priorActive < priorTrained
      ? priorActive
      : integer(row.activeLevel, { min: 0, max: 5 }) ?? priorActive;
    nextState[row.skillTypeId] = {
      level: integer(row.trainedLevel, { min: 0, max: 5 }) ?? priorTrained,
      activeLevel,
      skillpoints: Math.max(0, numeric(row.skillPoints, 0)),
      ...(row.trainingToLevel ? { trainingToLevel: row.trainingToLevel } : {}),
    };
  }
  return { state: nextState, queue: reconciled.queue };
}

function enrichCurrentTraining(value, byId) {
  if (!value) return null;
  const normalized = publicQueue([value], byId)[0];
  return normalized || null;
}

function scheduleStaleCharacterRefresh(userId, characters) {
  const refresh = fittingEsi.refreshCharacterMonitor || fittingEsi.refreshCharacterSkillnix;
  if (typeof refresh !== "function") return;
  const now = Date.now();
  if (backgroundRefreshAt.size > 1000) {
    for (const [key, refreshedAt] of backgroundRefreshAt) {
      if (now - refreshedAt >= BACKGROUND_REFRESH_THROTTLE_MS) backgroundRefreshAt.delete(key);
    }
  }
  const candidates = [];
  for (const character of characters) {
    if (!character?.stale || character.missingScopes?.length) continue;
    if (["reauth_required", "missing_scopes"].includes(character.tokenStatus)) continue;
    const id = characterId(character.characterId);
    if (!id) continue;
    const key = `${String(userId)}:${id}`;
    if (now - (backgroundRefreshAt.get(key) || 0) < BACKGROUND_REFRESH_THROTTLE_MS) continue;
    backgroundRefreshAt.set(key, now);
    candidates.push(id);
    if (candidates.length >= MAX_BACKGROUND_REFRESH_CHARACTERS) break;
  }
  if (!candidates.length) return;

  setImmediate(() => {
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(BACKGROUND_REFRESH_CONCURRENCY, candidates.length) },
      async () => {
        while (cursor < candidates.length) {
          const id = candidates[cursor];
          cursor += 1;
          try {
            await refresh(userId, id, { force: false });
          } catch {
            // Cached data remains the last-known-good response. A later list
            // request may retry after the local throttle window.
          }
        }
      }
    );
    void Promise.all(workers);
  });
}

function conservativeCloneMultiplier(snapshot) {
  const explicit = numeric(snapshot?.cloneMultiplier ?? snapshot?.character?.cloneMultiplier);
  if (explicit === 0.5 || explicit === 1) return explicit;
  const state = String(snapshot?.cloneState ?? snapshot?.character?.cloneState ?? "").toLowerCase();
  if (state === "omega") return 1;
  if (state === "alpha") return 0.5;
  return 0.5;
}

function cloneStateContext({ snapshot = {}, rawCharacter = {}, state = {}, activeTraining = null, totalSp = null } = {}) {
  const declared = [snapshot?.cloneState, rawCharacter?.cloneState]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .find((value) => value === "alpha" || value === "omega") || null;
  if (declared) {
    return { cloneState: declared, inferred: rawCharacter?.cloneStateInferred === true };
  }

  const alphaRestricted = Object.values(state).some((skill) => activeSkillLevel(skill) < trainedSkillLevel(skill));
  if (alphaRestricted) return { cloneState: "alpha", inferred: true };

  // Alpha characters stop training above the 5M-SP training ceiling. An
  // actively training character above it is therefore safe to identify as
  // Omega, matching EVEMon's account-status inference.
  if (activeTraining && numeric(totalSp, 0) > 5_000_000) {
    return { cloneState: "omega", inferred: true };
  }
  return { cloneState: "unknown", inferred: false };
}

function trainingSeconds(skill, currentSp, targetLevel, attributes, cloneMultiplier) {
  if (!skill.primaryAttribute || !skill.secondaryAttribute) return null;
  return eveSkills.trainingTimeSeconds({
    rank: skill.rank,
    targetLevel,
    currentSkillPoints: currentSp,
    primaryAttribute: numeric(attributes[skill.primaryAttribute], 17),
    secondaryAttribute: numeric(attributes[skill.secondaryAttribute], 17),
    cloneMultiplier,
  });
}

async function snapshotForUser(userId, rawCharacterId, { refresh = false, force = false } = {}) {
  const id = characterId(rawCharacterId);
  if (!id) throw serviceError("invalid_character_id", 400, "A valid character ID is required.");
  const readSnapshot = fittingEsi.characterMonitorSnapshotForUser || fittingEsi.skillnixSnapshotForUser;
  const refreshSnapshot = fittingEsi.refreshCharacterMonitor || fittingEsi.refreshCharacterSkillnix;
  let snapshot = null;
  if (refresh) {
    if (typeof refreshSnapshot !== "function") throw serviceError("monitor_sync_unavailable", 503, "Character synchronization is unavailable.");
    try {
      snapshot = await refreshSnapshot(userId, id, { force });
    } catch (err) {
      if (typeof readSnapshot === "function") snapshot = await readSnapshot(userId, id);
      if (!snapshot) throw err;
      snapshot = {
        ...snapshot,
        stale: true,
        error: snapshot.error || err?.code || "monitor_refresh_failed",
      };
    }
  } else if (typeof readSnapshot === "function") {
    snapshot = await readSnapshot(userId, id);
  }
  if (!snapshot) throw serviceError("character_not_found", 404, "That character is not linked to this account.");

  const [{ skills, byId }, preferencesResult, cloneImplants] = await Promise.all([
    loadSkillCatalog(),
    pool.query(
      `SELECT * FROM triffmon_character_preferences WHERE user_id = $1 AND character_id = $2 LIMIT 1`,
      [userId, id]
    ),
    cloneImplantDetails(snapshot),
  ]);
  const implants = cloneImplants.activeClone.implants;
  const preference = preferenceFromRow(preferencesResult.rows[0]);
  const cachedState = currentSkillState(snapshot);
  const cachedQueue = publicQueue(queueRows(snapshot), byId);
  const now = Date.now();
  const reconciled = reconcileSkillContext(cachedState, cachedQueue, now);
  const state = reconciled.state;
  const queue = reconciled.queue;
  const attributeContext = trainingAttributeContext(snapshot, implants);
  const attributes = attributeContext.trainingAttributes;
  const rawCharacter = snapshot.character || {};
  const active = queue.find((item) => {
    const start = item.startAt ? new Date(item.startAt).getTime() : Number.NaN;
    const end = item.endAt ? new Date(item.endAt).getTime() : Number.NaN;
    return Number.isFinite(start) && start <= now && Number.isFinite(end) && end > now;
  }) || null;
  const totalSp = numeric(snapshot.skills?.total_sp ?? rawCharacter.totalSp);
  const cloneContext = cloneStateContext({ snapshot, rawCharacter, state, activeTraining: active, totalSp });
  const cloneState = cloneContext.cloneState;
  const multiplier = conservativeCloneMultiplier({ ...snapshot, cloneState, character: { ...rawCharacter, cloneState } });
  const nextTraining = queue.find((item) => {
    const start = item.startAt ? new Date(item.startAt).getTime() : Number.NaN;
    const end = item.endAt ? new Date(item.endAt).getTime() : Number.NaN;
    return Number.isFinite(start) && start > now && Number.isFinite(end) && end > now;
  }) || null;
  const unfinishedQueue = queue.some((item) => !item.endAt || new Date(item.endAt).getTime() > now);
  const queueState = active ? "active" : nextTraining ? "gap" : unfinishedQueue ? "paused" : "empty";
  const queueEndAt = queue.map((item) => item.endAt).filter(Boolean).sort().at(-1) || null;
  const fetchedAt = snapshotSyncTime(snapshot);
  const fetchedMs = fetchedAt ? new Date(fetchedAt).getTime() : 0;
  const stale = snapshot.stale === true || !fetchedMs || now - fetchedMs > SNAPSHOT_STALE_MS;
  const unallocatedSp = numeric(snapshot.skills?.unallocated_sp ?? rawCharacter.unallocatedSp);
  const missingScopes = rawCharacter.missingMonitorScopes || rawCharacter.missingScopes || [];
  const character = {
    id: String(rawCharacter.id || id),
    characterId: id,
    name: rawCharacter.characterName || rawCharacter.name || `Character ${id}`,
    portraitUrl: `https://images.evetech.net/characters/${id}/portrait?size=128`,
    corporationName: rawCharacter.corporationName || snapshot.publicProfile?.corporationName || null,
    allianceName: rawCharacter.allianceName || snapshot.publicProfile?.allianceName || null,
    totalSp,
    unallocatedSp,
    walletBalance: numeric(snapshot.wallet?.balance ?? snapshot.walletBalance ?? rawCharacter.walletBalance),
    cloneState,
    cloneStateInferred: cloneContext.inferred,
    currentTraining: active,
    nextTraining,
    queueState,
    queueEndAt,
    queueDurationSeconds: queueEndAt ? Math.max(0, Math.ceil((new Date(queueEndAt).getTime() - now) / 1000)) : 0,
    queueLength: queue.length,
    tokenStatus: rawCharacter.tokenStatus || "unknown",
    missingScopes,
    lastUpdatedAt: fetchedAt,
    stale,
    error: snapshot.error || rawCharacter.monitorLastError || rawCharacter.skillnixLastError || rawCharacter.lastError || null,
    ...preference,
  };

  const normalizedSkills = skills.map((skill) => {
    const current = state[skill.skillTypeId] || { level: 0, activeLevel: 0, skillpoints: 0 };
    const nextLevel = Math.min(5, current.level + 1);
    const prerequisiteView = skill.prerequisites.map((prerequisite) => {
      const currentLevel = activeSkillLevel(state[prerequisite.skillTypeId]);
      return { ...prerequisite, currentLevel, missing: currentLevel < prerequisite.requiredLevel };
    });
    return {
      ...skill,
      level: current.level,
      activeLevel: current.activeLevel,
      skillpoints: current.skillpoints,
      prerequisites: prerequisiteView,
      missingPrerequisites: prerequisiteView.filter((item) => item.missing),
      spToNextLevel: current.level >= 5 ? 0 : Math.max(0, eveSkills.skillPointsForLevel(skill.rank, nextLevel) - current.skillpoints),
      spToLevelFive: Math.max(0, eveSkills.skillPointsForLevel(skill.rank, 5) - current.skillpoints),
      secondsToNextLevel: current.level >= 5 ? 0 : trainingSeconds(skill, current.skillpoints, nextLevel, attributes, multiplier),
      secondsToLevelFive: trainingSeconds(skill, current.skillpoints, 5, attributes, multiplier),
      partiallyTrained: current.level < 5 && current.skillpoints > eveSkills.skillPointsForLevel(skill.rank, current.level),
      currentlyTraining: active?.skillTypeId === skill.skillTypeId,
      queued: queue.some((item) => item.skillTypeId === skill.skillTypeId),
    };
  });

  return {
    characterId: String(id),
    character,
    skills: normalizedSkills,
    queue,
    attributes: ATTRIBUTE_KEYS.map((name) => ({ name, value: attributeContext.effectiveAttributes[name] })),
    implants,
    implantStatus: implantDataStatus(snapshot, missingScopes),
    clones: cloneImplants,
    cloneStatus: cloneDataStatus(snapshot, missingScopes),
    temporaryAttributeBonus: attributeContext.temporaryBonus,
    attributeEstimateWarning: attributeContext.optimizerWarning,
    cloneMultiplier: multiplier,
    fetchedAt,
    stale,
    error: character.error,
    _context: {
      state,
      attributes,
      effectiveAttributes: attributeContext.effectiveAttributes,
      trainingAttributes: attributes,
      baseAttributes: attributeContext.baseAttributes,
      implantBonuses: attributeContext.implantBonuses,
      esiAttributes: attributeContext.esiAttributes,
      esiIncludedImplants: attributeContext.esiIncludedImplants,
      temporaryBonus: attributeContext.temporaryBonus,
      optimizerWarning: attributeContext.optimizerWarning,
      cloneMultiplier: multiplier,
      raw: snapshot,
    },
  };
}

async function listCharacters(userId) {
  await ensureReady();
  const list = fittingEsi.listMonitorCharacters || fittingEsi.listCharacters;
  const [characters, preferencesResult, skillCatalog] = await Promise.all([
    typeof list === "function" ? list(userId) : [],
    pool.query(
      `SELECT * FROM triffmon_character_preferences WHERE user_id = $1`,
      [userId]
    ),
    loadSkillCatalog(),
  ]);
  const preferences = preferencesResult.rows;
  const preferenceById = new Map(preferences.map((row) => [Number(row.character_id), preferenceFromRow(row)]));
  const result = characters.map((raw) => {
    const id = Number(raw.characterId ?? raw.character_id);
    const queueEndAt = iso(raw.queueEndAt ?? raw.queue_end_at);
    return {
      id: String(raw.id || id),
      characterId: id,
      name: raw.characterName || raw.name || `Character ${id}`,
      portraitUrl: `https://images.evetech.net/characters/${id}/portrait?size=128`,
      corporationName: raw.corporationName || null,
      allianceName: raw.allianceName || null,
      totalSp: numeric(raw.totalSp),
      unallocatedSp: numeric(raw.unallocatedSp),
      walletBalance: numeric(raw.walletBalance),
      cloneState: raw.cloneState || "unknown",
      currentTraining: enrichCurrentTraining(raw.currentTraining, skillCatalog.byId),
      nextTraining: enrichCurrentTraining(raw.nextTraining, skillCatalog.byId),
      queueState: raw.queueState || (raw.currentTraining ? "active" : raw.queueLength ? "paused" : "empty"),
      queueEndAt,
      queueDurationSeconds: queueEndAt ? Math.max(0, Math.ceil((new Date(queueEndAt).getTime() - Date.now()) / 1000)) : null,
      queueLength: integer(raw.queueLength, { min: 0 }) || 0,
      tokenStatus: raw.tokenStatus || "unknown",
      missingScopes: raw.missingMonitorScopes || raw.missingScopes || [],
      lastUpdatedAt: iso(raw.monitorSyncedAt ?? raw.skillnixSyncedAt ?? raw.skillsSyncedAt ?? raw.updatedAt),
      stale: raw.stale === true,
      error: raw.monitorLastError || raw.skillnixLastError || raw.lastError || null,
      ...(preferenceById.get(id) || { pinned: false, hidden: false, group: null }),
    };
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
  scheduleStaleCharacterRefresh(userId, result);
  return result;
}

async function updatePreferences(userId, rawCharacterId, patch = {}) {
  await ensureReady();
  const id = characterId(rawCharacterId);
  if (!id) throw serviceError("invalid_character_id", 400, "A valid character ID is required.");
  const owned = await pool.query(
    `SELECT 1 FROM fitting_esi_characters
     WHERE user_id = $1 AND character_id = $2 AND sso_app = 'skillnix' AND revoked_at IS NULL`,
    [userId, id]
  );
  if (!owned.rowCount) throw serviceError("character_not_found", 404, "That character is not linked to this account.");
  const current = await pool.query(
    `SELECT * FROM triffmon_character_preferences WHERE user_id = $1 AND character_id = $2`,
    [userId, id]
  );
  const before = current.rows[0] || {};
  const pinned = typeof patch.pinned === "boolean" ? patch.pinned : before.is_favorite === true;
  const hidden = typeof patch.hidden === "boolean" ? patch.hidden : before.is_hidden === true;
  const group = Object.prototype.hasOwnProperty.call(patch, "group")
    ? boundedText(patch.group, 80)
    : boundedText(before.group_name, 80);
  await pool.query(
    `INSERT INTO triffmon_character_preferences (user_id, character_id, is_favorite, is_hidden, group_name, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id, character_id) DO UPDATE SET
       is_favorite = EXCLUDED.is_favorite,
       is_hidden = EXCLUDED.is_hidden,
       group_name = EXCLUDED.group_name,
       updated_at = now()`,
    [userId, id, pinned, hidden, group]
  );
  return (await listCharacters(userId)).find((item) => item.characterId === id) || null;
}

function normalizePlanEntries(entries) {
  const source = asArray(entries);
  if (source.length > MAX_PLAN_ENTRIES) throw serviceError("plan_too_large", 413, `Plans may contain at most ${MAX_PLAN_ENTRIES} skills.`);
  const normalized = eveSkills.normalizePlanTargets(source.map((entry, index) => ({
    id: uuid(entry.id ?? entry.entryId ?? entry.entry_id),
    skillTypeId: typeId(entry.skillTypeId ?? entry.skill_type_id ?? entry.typeId),
    targetLevel: integer(entry.targetLevel ?? entry.target_level ?? entry.level, { min: 1, max: 5 }),
    position: integer(entry.position, { min: 0 }) ?? index,
    section: boundedText(entry.section ?? entry.group, 120) || null,
    sectionId: uuid(entry.sectionId ?? entry.section_id),
    notes: boundedText(entry.notes, 2000) || null,
    explicit: entry.explicit !== false && entry.autoAdded !== true && entry.isExplicit !== false && entry.is_explicit !== false,
    sourceType: boundedText(
      entry.sourceType ?? entry.source_type,
      40,
      entry.autoAdded === true || entry.explicit === false || entry.isExplicit === false || entry.is_explicit === false
        ? "prerequisite"
        : "explicit"
    ),
    sourceMetadata: asObject(entry.sourceMetadata ?? entry.source_metadata),
    _sectionProvided: hasOwnAny(entry, ["section", "group"]),
    _notesProvided: hasOwnAny(entry, ["notes"]),
    _explicitProvided: hasOwnAny(entry, ["explicit", "autoAdded", "isExplicit", "is_explicit"]),
    _sourceTypeProvided: hasOwnAny(entry, ["sourceType", "source_type"]),
    _sourceMetadataProvided: hasOwnAny(entry, ["sourceMetadata", "source_metadata"]),
  })).filter((entry) => entry.skillTypeId && entry.targetLevel));
  return normalized.map((entry, index) => ({ ...entry, position: index }));
}

function storedSection(row) {
  return {
    id: uuid(row.id),
    title: boundedText(row.title ?? row.name ?? row.section, 120, "Training plan"),
    position: integer(row.position, { min: 0 }) ?? 0,
    notes: boundedText(row.notes, 2000) || null,
    remapAttributes: row.remap_attributes == null && row.remapAttributes == null
      ? null
      : asObject(row.remap_attributes ?? row.remapAttributes),
    settings: asObject(row.settings),
  };
}

function normalizePlanSections(sections) {
  return asArray(sections).map((raw, index) => {
    const section = raw && typeof raw === "object" ? raw : {};
    return {
      id: uuid(section.id ?? section.sectionId ?? section.section_id),
      title: boundedText(section.title ?? section.name ?? section.section, 120, "Training plan"),
      position: integer(section.position, { min: 0 }) ?? index,
      notes: boundedText(section.notes, 2000) || null,
      remapAttributes: section.remapAttributes == null && section.remap_attributes == null
        ? null
        : asObject(section.remapAttributes ?? section.remap_attributes),
      settings: asObject(section.settings),
      _notesProvided: hasOwnAny(section, ["notes"]),
      _remapProvided: hasOwnAny(section, ["remapAttributes", "remap_attributes"]),
      _settingsProvided: hasOwnAny(section, ["settings"]),
    };
  });
}

function reconcilePlanSections(entries, suppliedSections, storedSections = [], idFactory = crypto.randomUUID) {
  const existing = storedSections.map(storedSection).filter((section) => section.id);
  const existingById = new Map(existing.map((section) => [section.id, section]));
  const existingByTitle = new Map();
  for (const section of existing) if (!existingByTitle.has(section.title)) existingByTitle.set(section.title, section);

  const sections = [];
  const byId = new Map();
  const byTitle = new Map();
  const addSection = (raw) => {
    const matched = (raw.id && existingById.get(raw.id)) || existingByTitle.get(raw.title) || null;
    const section = {
      id: matched?.id || idFactory(),
      title: raw.title,
      position: sections.length,
      notes: raw._notesProvided ? raw.notes : matched?.notes || null,
      remapAttributes: raw._remapProvided ? raw.remapAttributes : matched?.remapAttributes || null,
      settings: raw._settingsProvided ? raw.settings : matched?.settings || {},
    };
    if (byId.has(section.id)) return byId.get(section.id);
    sections.push(section);
    byId.set(section.id, section);
    if (!byTitle.has(section.title)) byTitle.set(section.title, section);
    return section;
  };

  if (Array.isArray(suppliedSections)) {
    for (const section of normalizePlanSections(suppliedSections).sort((a, b) => a.position - b.position)) addSection(section);
  } else {
    for (const section of existing.sort((a, b) => a.position - b.position)) {
      addSection({
        ...section,
        _notesProvided: true,
        _remapProvided: true,
        _settingsProvided: true,
      });
    }
  }

  const reconciledEntries = entries.map((entry) => {
    const referenced = entry.sectionId ? byId.get(entry.sectionId) || existingById.get(entry.sectionId) : null;
    const title = entry._sectionProvided
      ? entry.section || "Training plan"
      : referenced?.title || entry.section || "Training plan";
    let section = referenced?.title === title ? byId.get(referenced.id) : null;
    if (!section) section = byTitle.get(title);
    if (!section) {
      const matchingExisting = existingByTitle.get(title);
      section = addSection({
        ...(matchingExisting || {}),
        title,
        _notesProvided: Boolean(matchingExisting),
        _remapProvided: Boolean(matchingExisting),
        _settingsProvided: Boolean(matchingExisting),
      });
    }
    return { ...entry, section: title, sectionId: section.id };
  });

  return {
    entries: reconciledEntries,
    sections: sections.map((section, position) => ({ ...section, position })),
  };
}

function retainedPlanEntryValues(entry, before = null) {
  const explicit = entry._explicitProvided ? entry.explicit !== false : before?.is_explicit !== false;
  return {
    explicit,
    sourceType: entry._sourceTypeProvided
      ? entry.sourceType || (explicit ? "explicit" : "prerequisite")
      : before?.source_type || entry.sourceType || (explicit ? "explicit" : "prerequisite"),
    sourceMetadata: entry._sourceMetadataProvided
      ? entry.sourceMetadata || {}
      : before?.source_metadata || entry.sourceMetadata || {},
    notes: entry._notesProvided ? entry.notes || "" : before?.notes || entry.notes || "",
  };
}

async function assertOwnedCharacter(client, userId, rawCharacterId) {
  if (rawCharacterId == null || rawCharacterId === "") return null;
  const id = characterId(rawCharacterId);
  if (!id) throw serviceError("invalid_character_id", 400, "A valid character ID is required.");
  const result = await client.query(
    `SELECT character_id FROM fitting_esi_characters
     WHERE user_id = $1 AND character_id = $2 AND sso_app = 'skillnix' AND revoked_at IS NULL`,
    [userId, id]
  );
  if (!result.rowCount) throw serviceError("character_not_found", 404, "That character is not linked to this account.");
  return id;
}

async function replacePlanEntries(client, planId, entries, suppliedSections) {
  const normalized = normalizePlanEntries(entries);
  const [{ rows: existingSections }, { rows: existingEntries }] = await Promise.all([
    client.query(
      `SELECT id, title, position, notes, remap_attributes, settings
       FROM triffmon_skill_plan_sections
       WHERE plan_id = $1
       ORDER BY position, id`,
      [planId]
    ),
    client.query(
      `SELECT id, skill_type_id, is_explicit, source_type, source_metadata, notes
       FROM triffmon_skill_plan_entries
       WHERE plan_id = $1`,
      [planId]
    ),
  ]);
  const reconciled = reconcilePlanSections(normalized, suppliedSections, existingSections);
  const existingEntryBySkill = new Map(existingEntries.map((entry) => [Number(entry.skill_type_id), entry]));

  for (const section of reconciled.sections) {
    if (existingSections.some((candidate) => String(candidate.id) === section.id)) {
      await client.query(
        `UPDATE triffmon_skill_plan_sections
         SET title = $3, position = $4, notes = $5, remap_attributes = $6::jsonb,
             settings = $7::jsonb, updated_at = now()
         WHERE id = $1 AND plan_id = $2`,
        [section.id, planId, section.title, section.position, section.notes || "", JSON.stringify(section.remapAttributes), JSON.stringify(section.settings)]
      );
    } else {
      await client.query(
        `INSERT INTO triffmon_skill_plan_sections (
           id, plan_id, title, position, notes, remap_attributes, settings
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [section.id, planId, section.title, section.position, section.notes || "", JSON.stringify(section.remapAttributes), JSON.stringify(section.settings)]
      );
    }
  }

  await client.query(`DELETE FROM triffmon_skill_plan_entries WHERE plan_id = $1`, [planId]);
  for (let index = 0; index < reconciled.entries.length; index += 1) {
    const entry = reconciled.entries[index];
    const before = existingEntryBySkill.get(entry.skillTypeId);
    const { explicit, sourceType, sourceMetadata, notes } = retainedPlanEntryValues(entry, before);
    await client.query(
      `INSERT INTO triffmon_skill_plan_entries (
         id, plan_id, section_id, skill_type_id, target_level, position,
         is_explicit, source_type, source_metadata, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
      [
        before?.id || crypto.randomUUID(), planId, entry.sectionId, entry.skillTypeId,
        entry.targetLevel, index, explicit, sourceType,
        JSON.stringify(sourceMetadata), notes,
      ]
    );
  }
  const retainedSectionIds = reconciled.sections.map((section) => section.id);
  await client.query(
    `DELETE FROM triffmon_skill_plan_sections
     WHERE plan_id = $1 AND NOT (id = ANY($2::uuid[]))`,
    [planId, retainedSectionIds]
  );
  return reconciled;
}

async function planRows(userId, planId = null, client = pool) {
  const params = [userId];
  let filter = "";
  if (planId) {
    params.push(planId);
    filter = "AND p.id = $2";
  }
  const { rows } = await client.query(
    `SELECT p.*, c.character_name
     FROM triffmon_skill_plans p
     LEFT JOIN fitting_esi_characters c
       ON c.user_id = p.user_id AND c.character_id = p.character_id
      AND c.sso_app = 'skillnix' AND c.revoked_at IS NULL
     WHERE p.user_id = $1 ${filter}
     ORDER BY p.updated_at DESC, p.id`,
    params
  );
  return rows;
}

async function publicPlan(row, client = pool) {
  const [{ rows: entries }, { rows: sections }, { byId }] = await Promise.all([
    client.query(
      `SELECT e.*, s.title AS section_title
       FROM triffmon_skill_plan_entries e
       LEFT JOIN triffmon_skill_plan_sections s ON s.id = e.section_id
       WHERE e.plan_id = $1
       ORDER BY e.position, e.id`,
      [row.id]
    ),
    client.query(
      `SELECT id, title, position, notes, remap_attributes, settings
       FROM triffmon_skill_plan_sections
       WHERE plan_id = $1
       ORDER BY position, id`,
      [row.id]
    ),
    loadSkillCatalog(),
  ]);
  return {
    id: String(row.id),
    name: row.name,
    characterId: row.character_id == null ? null : String(row.character_id),
    characterName: row.character_name || null,
    notes: row.notes || null,
    sections: sections.map((section, index) => ({
      id: String(section.id),
      title: section.title || "Training plan",
      position: Number(section.position ?? index),
      notes: section.notes || null,
      remapAttributes: section.remap_attributes || null,
      settings: section.settings || {},
    })),
    entries: entries.map((entry, index) => ({
      id: String(entry.id),
      skillTypeId: Number(entry.skill_type_id),
      skillName: byId.get(Number(entry.skill_type_id))?.skillName || `Skill ${entry.skill_type_id}`,
      targetLevel: Number(entry.target_level),
      position: Number(entry.position ?? index),
      sectionId: entry.section_id == null ? null : String(entry.section_id),
      section: entry.section_title || null,
      notes: entry.notes || null,
      autoAdded: entry.is_explicit !== true,
      sourceType: entry.source_type,
      sourceMetadata: entry.source_metadata || {},
      currentLevel: null,
      currentSp: null,
      remainingSp: null,
      trainingSeconds: null,
    })),
    totalSp: null,
    remainingSp: null,
    trainingSeconds: null,
    completionAt: null,
    settings: row.settings || {},
    sourceType: row.source_type,
    sourceMetadata: row.source_metadata || {},
    lockVersion: Number(row.lock_version || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listPlans(userId) {
  await ensureReady();
  const rows = await planRows(userId);
  return Promise.all(rows.map((row) => publicPlan(row)));
}

async function getPlan(userId, rawPlanId, client = pool) {
  await ensureReady();
  const id = uuid(rawPlanId);
  if (!id) throw serviceError("invalid_plan_id", 400, "A valid plan ID is required.");
  const rows = await planRows(userId, id, client);
  if (!rows[0]) throw serviceError("plan_not_found", 404, "That skill plan was not found.");
  return publicPlan(rows[0], client);
}

async function createPlan(userId, input = {}) {
  await ensureReady();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const count = await client.query(`SELECT COUNT(*)::integer AS count FROM triffmon_skill_plans WHERE user_id = $1`, [userId]);
    if (Number(count.rows[0]?.count || 0) >= MAX_PLANS_PER_USER) {
      throw serviceError("plan_limit_reached", 409, `Each account may store up to ${MAX_PLANS_PER_USER} skill plans.`);
    }
    const linkedCharacterId = await assertOwnedCharacter(client, userId, input.characterId);
    const id = crypto.randomUUID();
    const name = boundedText(input.name, MAX_PLAN_NAME, "Untitled plan");
    const notes = boundedText(input.notes, MAX_PLAN_NOTES);
    await client.query(
      `INSERT INTO triffmon_skill_plans (
         id, user_id, character_id, name, notes, settings, source_type, source_metadata
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb)`,
      [
        id, userId, linkedCharacterId, name, notes, JSON.stringify(asObject(input.settings)),
        boundedText(input.sourceType, 40, "native"), JSON.stringify(asObject(input.sourceMetadata)),
      ]
    );
    await replacePlanEntries(client, id, input.entries || [], input.sections);
    await client.query("COMMIT");
    return getPlan(userId, id);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function updatePlan(userId, rawPlanId, patch = {}) {
  await ensureReady();
  const id = uuid(rawPlanId);
  if (!id) throw serviceError("invalid_plan_id", 400, "A valid plan ID is required.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT * FROM triffmon_skill_plans WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id, userId]
    );
    if (!current.rows[0]) throw serviceError("plan_not_found", 404, "That skill plan was not found.");
    if (patch.lockVersion != null && Number(patch.lockVersion) !== Number(current.rows[0].lock_version)) {
      throw serviceError("plan_conflict", 409, "This plan changed in another tab. Reload it before saving again.");
    }
    const linkedCharacterId = Object.prototype.hasOwnProperty.call(patch, "characterId")
      ? await assertOwnedCharacter(client, userId, patch.characterId)
      : current.rows[0].character_id;
    const name = Object.prototype.hasOwnProperty.call(patch, "name")
      ? boundedText(patch.name, MAX_PLAN_NAME, "Untitled plan")
      : current.rows[0].name;
    const notes = Object.prototype.hasOwnProperty.call(patch, "notes")
      ? boundedText(patch.notes, MAX_PLAN_NOTES)
      : current.rows[0].notes;
    await client.query(
      `UPDATE triffmon_skill_plans
       SET character_id = $3, name = $4, notes = $5,
           settings = $6::jsonb, lock_version = lock_version + 1,
           updated_at = now(), last_opened_at = now()
       WHERE id = $1 AND user_id = $2`,
      [
        id, userId, linkedCharacterId, name, notes,
        JSON.stringify(Object.prototype.hasOwnProperty.call(patch, "settings") ? asObject(patch.settings) : current.rows[0].settings || {}),
      ]
    );
    if (Array.isArray(patch.entries)) await replacePlanEntries(client, id, patch.entries, patch.sections);
    await client.query("COMMIT");
    return getPlan(userId, id);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function deletePlan(userId, rawPlanId) {
  await ensureReady();
  const id = uuid(rawPlanId);
  if (!id) throw serviceError("invalid_plan_id", 400, "A valid plan ID is required.");
  const result = await pool.query(`DELETE FROM triffmon_skill_plans WHERE id = $1 AND user_id = $2`, [id, userId]);
  if (!result.rowCount) throw serviceError("plan_not_found", 404, "That skill plan was not found.");
}

function catalogDomainSkills(skills) {
  return skills.map((skill) => ({
    skillTypeId: skill.skillTypeId,
    name: skill.skillName,
    rank: skill.rank,
    primaryAttribute: skill.primaryAttribute,
    secondaryAttribute: skill.secondaryAttribute,
    prerequisites: skill.prerequisites.map((item) => ({
      skillTypeId: item.skillTypeId,
      requiredLevel: item.requiredLevel,
    })),
  }));
}

async function addPlanEntry(userId, rawPlanId, input = {}) {
  const plan = await getPlan(userId, rawPlanId);
  const skillId = typeId(input.skillTypeId);
  const targetLevel = integer(input.targetLevel, { min: 1, max: 5 });
  if (!skillId || !targetLevel) throw serviceError("invalid_plan_entry", 400, "A skill type ID and target level from I to V are required.");
  const { skills, byId } = await loadSkillCatalog();
  if (!byId.has(skillId)) throw serviceError("skill_not_found", 404, "That skill was not found in the current SDE.");
  let additions = [{ skillTypeId: skillId, targetLevel, explicit: true, section: boundedText(input.section, 120) || null }];
  if (input.addPrerequisites !== false) {
    additions = eveSkills.resolvePrerequisites(additions, catalogDomainSkills(skills), {}).targets;
  }
  const existing = plan.entries.map((entry) => ({ ...entry, explicit: !entry.autoAdded }));
  const combined = normalizePlanEntries([...existing, ...additions.map((entry) => ({
    ...entry,
    autoAdded: entry.explicit === false,
    section: boundedText(input.section, 120) || null,
  }))]);
  return updatePlan(userId, plan.id, { entries: combined, lockVersion: plan.lockVersion });
}

async function trainingContext(userId, rawCharacterId) {
  if (rawCharacterId == null || rawCharacterId === "") {
    const baseAttributes = { ...eveSkills.DEFAULT_BASE_ATTRIBUTES };
    return {
      state: {},
      attributes: baseAttributes,
      effectiveAttributes: baseAttributes,
      cloneMultiplier: 0.5,
      baseAttributes,
      implantBonuses: { charisma: 0, intelligence: 0, memory: 0, perception: 0, willpower: 0 },
      optimizerWarning: null,
      character: null,
      queue: [],
      warnings: ["No character is assigned; times use base attributes and the conservative Alpha/unknown training rate."],
    };
  }
  const snapshot = await snapshotForUser(userId, rawCharacterId);
  return {
    ...snapshot._context,
    attributes: snapshot._context.trainingAttributes,
    character: snapshot.character,
    queue: snapshot.queue,
    warnings: [
      ...(snapshot.character.cloneState === "unknown"
        ? ["Clone state is not available from ESI; estimates use the conservative Alpha/unknown training rate."]
        : []),
      ...(snapshot._context.optimizerWarning ? [snapshot._context.optimizerWarning] : []),
    ],
  };
}

async function analyzePlan(userId, input = {}) {
  const plan = await getPlan(userId, input.planId);
  const selectedCharacterId = input.characterId ?? plan.characterId;
  const [{ skills, byId }, context] = await Promise.all([loadSkillCatalog(), trainingContext(userId, selectedCharacterId)]);
  const analysis = eveSkills.analyzePlan({
    targets: plan.entries.map((entry) => ({
      skillTypeId: entry.skillTypeId,
      targetLevel: entry.targetLevel,
      position: entry.position,
      explicit: !entry.autoAdded,
      section: entry.section,
      notes: entry.notes,
    })),
    catalog: catalogDomainSkills(skills),
    characterSkills: context.state,
    attributes: context.attributes,
    cloneMultiplier: context.cloneMultiplier,
    queue: context.queue,
  });
  const entries = analysis.targets.map((entry, index) => {
    const saved = plan.entries.find((item) => item.skillTypeId === entry.skillTypeId);
    return ({
    ...(saved || {}),
    id: saved?.id || `analysis-${entry.skillTypeId}`,
    skillTypeId: entry.skillTypeId,
    skillName: byId.get(entry.skillTypeId)?.skillName || `Skill ${entry.skillTypeId}`,
    targetLevel: entry.targetLevel,
    position: index,
    section: entry.section || null,
    notes: entry.notes || null,
    autoAdded: entry.explicit === false,
    currentLevel: entry.currentLevel,
    currentSp: entry.currentSp,
    targetSp: entry.targetSp,
    activeLevel: activeSkillLevel(context.state[entry.skillTypeId]),
    remainingSp: entry.remainingSp,
    trainingSeconds: entry.trainingSeconds,
    alreadyTrained: entry.alreadyTrained === true,
    partiallyTrained: entry.partiallyTrained === true,
  });
  });
  return {
    remainingSp: analysis.remainingSp,
    trainingSeconds: analysis.trainingSeconds,
    completionAt: new Date(Date.now() + analysis.trainingSeconds * 1000).toISOString(),
    trainedCount: entries.filter((entry) => entry.alreadyTrained).length,
    partialCount: entries.filter((entry) => entry.partiallyTrained).length,
    missingCount: entries.filter((entry) => !entry.alreadyTrained).length,
    warnings: [...context.warnings, ...(analysis.warnings || [])],
    entries,
    queueComparison: analysis.queueComparison || null,
  };
}

async function optimizePlan(userId, input = {}) {
  const { maxSections } = optimizerRequestLimits(input);
  const plan = await getPlan(userId, input.planId);
  const selectedCharacterId = input.characterId ?? plan.characterId;
  const [{ skills }, context] = await Promise.all([loadSkillCatalog(), trainingContext(userId, selectedCharacterId)]);
  const domainSkills = catalogDomainSkills(skills);
  const current = eveSkills.analyzePlan({
    targets: plan.entries,
    catalog: domainSkills,
    characterSkills: context.state,
    attributes: context.attributes,
    cloneMultiplier: context.cloneMultiplier,
  });
  const trainedLevels = Object.fromEntries(Object.entries(context.state).map(([id, state]) => [id, state.level || 0]));
  const currentSkillPoints = Object.fromEntries(Object.entries(context.state).map(([id, state]) => [id, state.skillpoints || 0]));
  const structure = eveSkills.resolvePrerequisites(plan.entries, domainSkills, trainedLevels);
  assertOptimizerMilestoneLimit(structure.atomicMilestones.length);
  const sectionByRoot = new Map(plan.entries.map((entry) => [entry.skillTypeId, entry.section || "Training plan"]));
  const rawSections = [];
  for (let index = 0; index < structure.atomicMilestones.length; index += 1) {
    const milestone = structure.atomicMilestones[index];
    const label = sectionByRoot.get(milestone.rootSkillTypeId) || sectionByRoot.get(milestone.skillTypeId) || "Training plan";
    let section = rawSections.at(-1);
    if (!section || section.label !== label) {
      section = { id: `${rawSections.length}:${label}`, label, startsAtEntry: index, milestones: [] };
      rawSections.push(section);
    }
    section.milestones.push(milestone);
  }
  const sections = rawSections.slice(0, maxSections);
  if (rawSections.length > maxSections) {
    for (const overflow of rawSections.slice(maxSections)) sections[maxSections - 1].milestones.push(...overflow.milestones);
  }
  let optimizedSeconds = 0;
  let attributes = context.baseAttributes;
  let segments = [];
  if (sections.length <= 1) {
    const optimized = eveSkills.optimizeRemap({
      milestones: sections[0]?.milestones || [],
      skills: domainSkills,
      trainedLevels,
      currentSkillPoints,
      cloneMultiplier: context.cloneMultiplier,
      implants: context.implantBonuses,
      currentBaseAttributes: context.baseAttributes,
    });
    optimizedSeconds = optimized.totalDurationSeconds;
    attributes = optimized.baseAttributes;
    segments = sections.length ? [{
      label: sections[0].label,
      attributes: optimized.baseAttributes,
      trainingSeconds: optimized.totalDurationSeconds,
      startsAtEntry: sections[0].startsAtEntry,
    }] : [];
  } else {
    const optimized = eveSkills.optimizeRemapSections({
      sections,
      skills: domainSkills,
      trainedLevels,
      currentSkillPoints,
      cloneMultiplier: context.cloneMultiplier,
      implants: context.implantBonuses,
      currentBaseAttributes: context.baseAttributes,
    });
    optimizedSeconds = optimized.totalDurationSeconds;
    attributes = optimized.sections[0]?.baseAttributes || context.baseAttributes;
    segments = optimized.sections.map((section, index) => ({
      label: sections[index].label,
      attributes: section.baseAttributes,
      trainingSeconds: section.totalDurationSeconds,
      startsAtEntry: sections[index].startsAtEntry,
    }));
  }
  return {
    currentSeconds: current.trainingSeconds,
    optimizedSeconds,
    secondsSaved: Math.max(0, current.trainingSeconds - optimizedSeconds),
    attributes,
    segments,
    warnings: [
      ...context.warnings,
      ...(rawSections.length > maxSections ? [`Only ${maxSections} contiguous plan sections were optimized because the request allows ${maxSections - 1} remaps.`] : []),
      ...(segments.length > 1 ? ["Each contiguous named plan section is treated as a manual remap segment."] : []),
      "Attribute remaps are advisory; ESI cannot perform a remap or validate your in-game cooldown.",
    ],
  };
}

function importedWarningText(warning) {
  if (typeof warning === "string") return warning;
  const value = asObject(warning);
  if (value.message) return boundedText(value.message, 500);
  const location = value.line ? ` on line ${value.line}` : value.row ? ` on row ${value.row}` : "";
  switch (value.code) {
    case "SKILL_ID_NAME_MISMATCH":
      return `Skill ID ${value.skillTypeId} is now named "${value.canonicalName}"; the type ID was used.`;
    case "UNKNOWN_ID_NAME_FALLBACK":
      return `Unknown skill ID ${value.importedSkillTypeId} was resolved by name to type ${value.resolvedSkillTypeId}.`;
    case "UNRESOLVED_SKILL":
      return `Skipped missing or unpublished skill ${value.skillName || value.skillTypeId || "(unknown)"}.`;
    case "INVALID_LEVEL":
      return `Skipped an entry with invalid target level${location}.`;
    case "MISSING_SKILL":
      return `Skipped an entry without a skill identifier${location}.`;
    case "UNPARSED_TEXT_LINE":
      return `Skipped an unrecognized plan line${location}.`;
    default:
      return `${String(value.code || "IMPORT_WARNING").replace(/_/g, " ").toLowerCase()}${location}.`;
  }
}

function normalizeImportedRows(parsed, catalogData) {
  const byName = new Map();
  for (const skill of catalogData.skills) {
    const key = skill.skillName.trim().toLocaleLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(skill);
  }
  const warnings = (parsed.warnings || []).map(importedWarningText);
  const entries = [];
  const sectionsByTitle = new Map();
  for (const row of parsed.entries || []) {
    let skill = row.skillTypeId ? catalogData.byId.get(Number(row.skillTypeId)) : null;
    if (skill && row.skillName && skill.skillName.toLocaleLowerCase() !== String(row.skillName).trim().toLocaleLowerCase()) {
      warnings.push(`Skill ID ${row.skillTypeId} is now named "${skill.skillName}"; the type ID was used.`);
    }
    if (!skill && row.skillName) {
      const matches = byName.get(String(row.skillName).trim().toLocaleLowerCase()) || [];
      if (matches.length === 1) {
        skill = matches[0];
        warnings.push(`Resolved "${row.skillName}" by name to type ${skill.skillTypeId}.`);
      } else if (matches.length > 1) {
        warnings.push(`Skipped ambiguous skill name "${row.skillName}".`);
      }
    }
    if (!skill) {
      warnings.push(`Skipped missing or unpublished skill ${row.skillName || row.skillTypeId || "(unknown)"}.`);
      continue;
    }
    const level = integer(row.targetLevel ?? row.level, { min: 1, max: 5 });
    if (!level) {
      warnings.push(`Skipped ${skill.skillName} with invalid target level.`);
      continue;
    }
    const sectionTitle = boundedText(row.group ?? row.section, 120) || "Training plan";
    const remap = row.remap == null ? null : asObject(row.remap);
    if (!sectionsByTitle.has(sectionTitle)) {
      sectionsByTitle.set(sectionTitle, {
        title: sectionTitle,
        position: sectionsByTitle.size,
        notes: boundedText(remap?.description, 2000) || null,
        remapAttributes: remap,
        settings: {
          importedGroups: asArray(row.groups).map((group) => boundedText(group, 120)).filter(Boolean),
          importedRemapStatus: boundedText(remap?.status, 80) || null,
        },
      });
    } else if (remap && !sectionsByTitle.get(sectionTitle).remapAttributes) {
      const section = sectionsByTitle.get(sectionTitle);
      section.remapAttributes = remap;
      section.notes = section.notes || boundedText(remap.description, 2000) || null;
      section.settings.importedRemapStatus = boundedText(remap.status, 80) || null;
    }
    entries.push({
      skillTypeId: skill.skillTypeId,
      targetLevel: level,
      position: entries.length,
      section: sectionTitle,
      notes: boundedText(row.notes, 2000) || null,
      autoAdded: false,
      sourceType: "imported",
      sourceMetadata: {
        importedType: row.type || null,
        priority: row.priority ?? null,
        groups: asArray(row.groups),
        remap,
        source: asObject(row.source),
      },
    });
  }
  return { entries: normalizePlanEntries(entries), sections: [...sectionsByTitle.values()], warnings };
}

function planFormatServiceError(error, action) {
  if (!(error instanceof planFormats.PlanFormatError)) return error;
  const code = String(error.code || "INVALID_PLAN_FORMAT");
  const unsupported = code.startsWith("UNSUPPORTED_");
  return serviceError(
    unsupported ? `plan_${action}_unsupported_format` : `plan_${action}_invalid`,
    unsupported ? 400 : 422,
    error.message || `The plan could not be ${action === "import" ? "imported" : "exported"}.`,
    { formatCode: code, ...(error.details === undefined ? {} : { formatDetails: error.details }) }
  );
}

async function importPlan(userId, input = {}) {
  const content = String(input.content || "");
  let parsed;
  try {
    parsed = planFormats.parsePlan(content, {
      filename: boundedText(input.filename, 260),
      format: boundedText(input.format, 30, "auto"),
    });
  } catch (error) {
    throw planFormatServiceError(error, "import");
  }
  const catalogData = await loadSkillCatalog();
  const normalized = normalizeImportedRows(parsed, catalogData);
  if (!normalized.entries.length) throw serviceError("plan_import_empty", 422, "No current EVE skills could be imported.", normalized.warnings);
  const plan = await createPlan(userId, {
    name: boundedText(parsed.name, MAX_PLAN_NAME, boundedText(input.filename, MAX_PLAN_NAME, "Imported plan")),
    characterId: input.characterId,
    notes: boundedText(parsed.description, MAX_PLAN_NOTES),
    entries: normalized.entries,
    sections: normalized.sections,
    sourceType: "evemon_import",
    sourceMetadata: {
      format: parsed.format,
      filename: boundedText(input.filename, 260),
      warnings: normalized.warnings,
      importedAt: new Date().toISOString(),
    },
  });
  return { ...plan, importWarnings: normalized.warnings };
}

async function exportPlan(userId, input = {}) {
  const plan = await getPlan(userId, input.planId);
  const format = boundedText(input.format, 20, "json").toLowerCase();
  const domainFormat = format === "evemon" ? "xml" : format;
  const payload = {
    name: plan.name,
    description: plan.notes || "",
    entries: plan.entries.map((entry) => ({
      skillTypeId: entry.skillTypeId,
      skillName: entry.skillName,
      targetLevel: entry.targetLevel,
      notes: entry.notes,
      group: entry.section,
      type: entry.autoAdded ? "Prerequisite" : "Planned",
    })),
  };
  let exported;
  try {
    exported = planFormats.exportPlan(payload, domainFormat);
  } catch (error) {
    throw planFormatServiceError(error, "export");
  }
  return {
    content: exported.content,
    encoding: exported.encoding || "utf8",
    filename: exported.filename || `${plan.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "triffmon-plan"}.${exported.extension || "json"}`,
    mimeType: exported.mimeType || "application/octet-stream",
  };
}

function summarizeRequirementCoverage(characters) {
  const oneDay = 24 * 60 * 60;
  const sevenDays = 7 * oneDay;
  return {
    selectedCount: characters.length,
    readyCount: characters.filter((item) => item.canUse).length,
    underOneDayCount: characters.filter((item) => !item.canUse && !item.inactiveDueToCloneState && Number.isFinite(item.trainingSeconds) && item.trainingSeconds < oneDay).length,
    overSevenDaysCount: characters.filter((item) => !item.canUse && !item.inactiveDueToCloneState && Number.isFinite(item.trainingSeconds) && item.trainingSeconds > sevenDays).length,
    inactiveCloneCount: characters.filter((item) => item.inactiveDueToCloneState).length,
  };
}

async function analyzeRequirements(userId, input = {}) {
  const selectedIds = [...new Set(asArray(input.characterIds).map(characterId).filter(Boolean))].slice(0, 100);
  if (!selectedIds.length) throw serviceError("characters_required", 400, "Select at least one linked character.");
  const suppliedRequirements = asArray(input.requiredSkills).slice(0, 250).map((row) => ({
    skillTypeId: typeId(row.skillTypeId ?? row.skill_type_id ?? row.typeId),
    targetLevel: integer(row.targetLevel ?? row.requiredLevel ?? row.level, { min: 1, max: 5 }),
    explicit: true,
  })).filter((row) => row.skillTypeId && row.targetLevel);
  const typeRequirements = suppliedRequirements.length
    ? {
        type: {
          typeId: 0,
          typeName: boundedText(input.label, 160, "Fit requirements"),
          groupName: "Fit",
          categoryName: "Fitting",
          iconUrl: null,
        },
        direct: suppliedRequirements,
      }
    : await directRequirementsForType(input.typeId);
  const { type, direct } = typeRequirements;
  const { skills, byId } = await loadSkillCatalog();
  const validDirect = direct.filter((row) => byId.has(row.skillTypeId));
  const ignoredRequirements = direct.length - validDirect.length;
  if (suppliedRequirements.length && !validDirect.length) {
    throw serviceError("requirements_not_found", 422, "None of the supplied fit skills exist in the current SDE.");
  }
  const resolved = eveSkills.resolvePrerequisites(validDirect, catalogDomainSkills(skills), {});
  const characters = await Promise.all(selectedIds.map(async (id) => {
    const context = await trainingContext(userId, id);
    const analysis = eveSkills.analyzePlan({
      targets: resolved.targets,
      catalog: catalogDomainSkills(skills),
      characterSkills: context.state,
      attributes: context.attributes,
      cloneMultiplier: context.cloneMultiplier,
    });
    const missingSkills = analysis.targets.filter((entry) => (
      requirementIsMissing(context.state[entry.skillTypeId], entry.targetLevel, entry.remainingSp)
    )).map((entry) => {
      const skill = byId.get(entry.skillTypeId);
      const trainedLevel = trainedSkillLevel(context.state[entry.skillTypeId]);
      const activeLevel = activeSkillLevel(context.state[entry.skillTypeId]);
      return {
        skillTypeId: entry.skillTypeId,
        skillName: skill?.skillName || `Skill ${entry.skillTypeId}`,
        requiredLevel: entry.targetLevel,
        currentLevel: activeLevel,
        trainedLevel,
        activeLevel,
        inactiveDueToCloneState: trainedLevel >= entry.targetLevel && activeLevel < entry.targetLevel,
        missingLevels: Math.max(0, entry.targetLevel - activeLevel),
        missingSp: entry.remainingSp,
        trainingSeconds: entry.trainingSeconds,
        prerequisites: (skill?.prerequisites || []).map((item) => ({
          ...item,
          currentLevel: activeSkillLevel(context.state[item.skillTypeId]),
          activeLevel: activeSkillLevel(context.state[item.skillTypeId]),
          trainedLevel: trainedSkillLevel(context.state[item.skillTypeId]),
          missing: activeSkillLevel(context.state[item.skillTypeId]) < item.requiredLevel,
        })),
      };
    });
    const inactiveDueToCloneState = missingSkills.some((entry) => entry.inactiveDueToCloneState);
    return {
      characterId: String(id),
      characterName: context.character?.name || `Character ${id}`,
      portraitUrl: context.character?.portraitUrl || `https://images.evetech.net/characters/${id}/portrait?size=128`,
      canUse: missingSkills.length === 0,
      inactiveDueToCloneState,
      missingSp: analysis.remainingSp,
      trainingSeconds: analysis.trainingSeconds,
      missingSkills,
    };
  }));
  return {
    typeId: type.typeId,
    typeName: type.typeName,
    iconUrl: type.iconUrl,
    ...summarizeRequirementCoverage(characters),
    characters,
    warnings: [
      ...(direct.length ? [] : ["This type has no hard required-skill dogma entries in the current SDE."]),
      ...(ignoredRequirements ? [`Ignored ${ignoredRequirements} unknown skill requirement${ignoredRequirements === 1 ? "" : "s"}.`] : []),
    ],
  };
}

module.exports = {
  DOGMA,
  analyzePlan,
  analyzeRequirements,
  catalog,
  createPlan,
  deletePlan,
  directRequirementsForType,
  exportPlan,
  getPlan,
  importPlan,
  listCharacters,
  listPlans,
  loadSkillCatalog,
  optimizePlan,
  snapshotForUser,
  updatePlan,
  updatePreferences,
  addPlanEntry,
  _test: {
    activeSkillLevel,
    assertOptimizerMilestoneLimit,
    assertOwnedCharacter,
    characterId,
    cloneStateContext,
    cloneDataStatus,
    cloneImplantDetails,
    enrichCurrentTraining,
    normalizeImportedRows,
    normalizePlanEntries,
    normalizePlanSections,
    optimizerRequestLimits,
    planFormatServiceError,
    planRows,
    prerequisiteRows,
    publicQueue,
    reconcileSkillContext,
    reconcilePlanSections,
    retainedPlanEntryValues,
    requirementIsMissing,
    scheduleStaleCharacterRefresh,
    serviceError,
    summarizeRequirementCoverage,
    trainedSkillLevel,
    trainingAttributeContext,
    implantDataStatus,
    normalizedJumpClones,
    trainingContext,
    typeId,
    uuid,
  },
};
