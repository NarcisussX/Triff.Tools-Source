"use strict";

class UnknownSkillError extends Error {
  constructor(skill, context = "plan") {
    super(`Unknown skill ${skill} in ${context}`);
    this.name = "UnknownSkillError";
    this.code = "UNKNOWN_SKILL";
    this.skill = skill;
    this.context = context;
  }
}

class PlanCycleError extends Error {
  constructor(cycle) {
    super(`Skill prerequisite cycle detected: ${cycle.join(" -> ")}`);
    this.name = "PlanCycleError";
    this.code = "PREREQUISITE_CYCLE";
    this.cycle = cycle;
  }
}

function firstDefined(object, keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object[key] !== null && object[key] !== "") {
      return object[key];
    }
  }
  return undefined;
}

function normalizeSkillTypeId(value, label = "skill type ID") {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return number;
}

function normalizeTargetLevel(value, label = "target level") {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) {
    throw new RangeError(`${label} must be an integer from 1 to 5`);
  }
  return number;
}

function readSkillTypeId(value, fallback) {
  const raw = firstDefined(value, [
    "skillTypeId",
    "skill_type_id",
    "skillId",
    "skill_id",
    "typeId",
    "type_id",
    "id",
  ]) ?? fallback;
  return raw === undefined ? undefined : normalizeSkillTypeId(raw);
}

function readTargetLevel(value) {
  const raw = firstDefined(value, [
    "targetLevel",
    "target_level",
    "finishedLevel",
    "finished_level",
    "trainedSkillLevel",
    "trained_skill_level",
    "requiredLevel",
    "required_level",
    "level",
  ]);
  return raw === undefined ? undefined : normalizeTargetLevel(raw);
}

function normalizePrerequisite(prerequisite) {
  return {
    skillTypeId: readSkillTypeId(prerequisite),
    level: readTargetLevel(prerequisite),
  };
}

function normalizeSkillDefinition(raw, fallbackId) {
  if (!raw || typeof raw !== "object") {
    throw new TypeError("skill definitions must be objects");
  }
  const skillTypeId = readSkillTypeId(raw, fallbackId);
  const prerequisitesRaw = firstDefined(raw, ["prerequisites", "requiredSkills", "required_skills"]) ?? [];
  const prerequisites = Array.from(prerequisitesRaw, normalizePrerequisite);
  return Object.freeze({
    ...raw,
    skillTypeId,
    name: String(firstDefined(raw, ["name", "skillName", "skill_name", "typeName", "type_name"]) ?? skillTypeId),
    rank: Number(firstDefined(raw, ["rank", "trainingMultiplier", "training_multiplier"]) ?? 1),
    primaryAttribute: firstDefined(raw, ["primaryAttribute", "primary_attribute", "primary"]),
    secondaryAttribute: firstDefined(raw, ["secondaryAttribute", "secondary_attribute", "secondary"]),
    prerequisites: Object.freeze(prerequisites),
  });
}

function createSkillCatalog(skills) {
  if (skills?.byId instanceof Map && skills?.byName instanceof Map) return skills;

  const byId = new Map();
  const byName = new Map();
  let entries;
  if (skills instanceof Map) {
    entries = skills.entries();
  } else if (Array.isArray(skills)) {
    entries = skills.map((skill) => [undefined, skill]);
  } else if (skills && typeof skills === "object") {
    entries = Object.entries(skills);
  } else {
    throw new TypeError("skills must be an array, object, Map, or skill catalog");
  }

  for (const [fallbackId, raw] of entries) {
    const skill = normalizeSkillDefinition(raw, fallbackId);
    if (byId.has(skill.skillTypeId)) {
      throw new RangeError(`Duplicate skill type ID ${skill.skillTypeId}`);
    }
    byId.set(skill.skillTypeId, skill);
    byName.set(skill.name.trim().toLocaleLowerCase("en-US"), skill);
  }

  return Object.freeze({
    byId,
    byName,
    get(skillTypeId) {
      return byId.get(Number(skillTypeId));
    },
    getByName(name) {
      return byName.get(String(name ?? "").trim().toLocaleLowerCase("en-US"));
    },
  });
}

function levelLookup(input = {}) {
  const result = new Map();
  if (input instanceof Map) {
    for (const [id, level] of input) result.set(normalizeSkillTypeId(id), Number(level) || 0);
    return result;
  }
  if (Array.isArray(input)) {
    for (const row of input) {
      const id = readSkillTypeId(row);
      const rawLevel = firstDefined(row, [
        "trainedLevel",
        "trained_level",
        "trainedSkillLevel",
        "trained_skill_level",
        "level",
      ]) ?? 0;
      result.set(id, Math.max(0, Math.min(5, Number(rawLevel) || 0)));
    }
    return result;
  }
  for (const [id, level] of Object.entries(input ?? {})) {
    result.set(normalizeSkillTypeId(id), Math.max(0, Math.min(5, Number(level) || 0)));
  }
  return result;
}

function rowSkillName(row) {
  return firstDefined(row, ["skillName", "skill_name", "name", "typeName", "type_name"]);
}

function resolveDesiredRow(row, index, catalog) {
  if (!row || typeof row !== "object") throw new TypeError(`desired row ${index} must be an object`);
  let skillTypeId;
  try {
    skillTypeId = readSkillTypeId(row);
  } catch (error) {
    if (!rowSkillName(row)) throw error;
  }

  let skill = skillTypeId === undefined ? undefined : catalog.get(skillTypeId);
  if (!skill && rowSkillName(row)) skill = catalog.getByName(rowSkillName(row));
  if (!skill) throw new UnknownSkillError(skillTypeId ?? rowSkillName(row), `desired row ${index}`);

  const targetLevel = readTargetLevel(row);
  if (targetLevel === undefined) throw new RangeError(`desired row ${index} is missing a target level`);
  return {
    ...row,
    skillTypeId: skill.skillTypeId,
    skillName: skill.name,
    targetLevel,
    explicit: row.explicit !== false && row.autoAdded !== true && row.isExplicit !== false,
    sourceIndex: index,
  };
}

/**
 * Normalize user-visible desired targets while retaining the original row
 * sequence as an atomic milestone trace. This means an imported sequence such
 * as A I, B I, A II still calculates in that order even though the normalized
 * desired target list contains only A II and B I.
 */
function normalizeSkillPlan({ desiredTargets = [], skills, trainedLevels = {} } = {}) {
  const catalog = createSkillCatalog(skills);
  const trained = levelLookup(trainedLevels);
  const warnings = [];
  const occurrences = desiredTargets.map((row, index) => resolveDesiredRow(row, index, catalog));

  const explicitById = new Map();
  const explicitLevelById = new Map();
  for (const occurrence of occurrences) {
    if (occurrence.explicit) {
      explicitLevelById.set(
        occurrence.skillTypeId,
        Math.max(explicitLevelById.get(occurrence.skillTypeId) ?? 0, occurrence.targetLevel),
      );
    }
    const existing = explicitById.get(occurrence.skillTypeId);
    if (!existing) {
      explicitById.set(occurrence.skillTypeId, {
        ...occurrence,
        sourceIndices: [occurrence.sourceIndex],
      });
      continue;
    }
    existing.sourceIndices.push(occurrence.sourceIndex);
    if (occurrence.targetLevel > existing.targetLevel) {
      const sourceIndices = existing.sourceIndices;
      Object.assign(existing, occurrence, { sourceIndices });
    }
    existing.explicit = (explicitLevelById.get(occurrence.skillTypeId) ?? 0) >= existing.targetLevel;
    warnings.push({
      code: "DUPLICATE_DESIRED_SKILL",
      skillTypeId: occurrence.skillTypeId,
      retainedTargetLevel: Math.max(existing.targetLevel, occurrence.targetLevel),
      sourceIndex: occurrence.sourceIndex,
    });
  }

  const desired = [...explicitById.values()]
    .sort((left, right) => Math.min(...left.sourceIndices) - Math.min(...right.sourceIndices))
    .map((row) => ({
      ...row,
      explicit: (explicitLevelById.get(row.skillTypeId) ?? 0) >= row.targetLevel,
      autoAdded: (explicitLevelById.get(row.skillTypeId) ?? 0) < row.targetLevel,
      alreadyTrained: (trained.get(row.skillTypeId) ?? 0) >= row.targetLevel,
    }));

  const explicitTargetLevel = explicitLevelById;
  const neededTargets = new Map();
  const neededOrder = [];
  const requiredBy = new Map();
  const traversedTarget = new Map();
  const emittedLevel = new Map(trained);
  const visiting = [];
  const visitingSet = new Set();
  const atomic = [];

  function recordNeeded(skillTypeId, level) {
    if (!neededTargets.has(skillTypeId)) neededOrder.push(skillTypeId);
    neededTargets.set(skillTypeId, Math.max(neededTargets.get(skillTypeId) ?? 0, level));
  }

  function addRequiredBy(prerequisiteId, dependentId) {
    if (!requiredBy.has(prerequisiteId)) requiredBy.set(prerequisiteId, new Set());
    requiredBy.get(prerequisiteId).add(dependentId);
  }

  function ensureSkill(skillTypeId, targetLevel, rootSkillTypeId, sourceIndex) {
    const skill = catalog.get(skillTypeId);
    if (!skill) throw new UnknownSkillError(skillTypeId, `prerequisite of ${rootSkillTypeId}`);
    recordNeeded(skillTypeId, targetLevel);

    if (targetLevel <= (trained.get(skillTypeId) ?? 0)) return;
    if (visitingSet.has(skillTypeId)) {
      const start = visiting.indexOf(skillTypeId);
      throw new PlanCycleError([...visiting.slice(start), skillTypeId]);
    }

    if ((traversedTarget.get(skillTypeId) ?? 0) < targetLevel) {
      visiting.push(skillTypeId);
      visitingSet.add(skillTypeId);
      for (const prerequisite of skill.prerequisites) {
        addRequiredBy(prerequisite.skillTypeId, skillTypeId);
        ensureSkill(prerequisite.skillTypeId, prerequisite.level, rootSkillTypeId, sourceIndex);
      }
      visiting.pop();
      visitingSet.delete(skillTypeId);
      traversedTarget.set(skillTypeId, targetLevel);
    }

    const firstLevel = Math.max(
      trained.get(skillTypeId) ?? 0,
      emittedLevel.get(skillTypeId) ?? 0,
    ) + 1;
    for (let level = firstLevel; level <= targetLevel; level += 1) {
      atomic.push({
        skillTypeId,
        skillName: skill.name,
        level,
        targetLevel: level,
        rootSkillTypeId,
        sourceIndex,
      });
      emittedLevel.set(skillTypeId, level);
    }
  }

  for (const occurrence of occurrences) {
    ensureSkill(
      occurrence.skillTypeId,
      occurrence.targetLevel,
      occurrence.skillTypeId,
      occurrence.sourceIndex,
    );
  }

  const atomicMilestones = atomic.map((milestone, order) => {
    const explicit = (explicitTargetLevel.get(milestone.skillTypeId) ?? 0) >= milestone.level;
    return {
      ...milestone,
      order,
      explicit,
      autoAdded: !explicit,
      requiredBy: [...(requiredBy.get(milestone.skillTypeId) ?? [])],
    };
  });

  const resolvedTargets = neededOrder.map((skillTypeId) => {
    const skill = catalog.get(skillTypeId);
    const explicit = (explicitTargetLevel.get(skillTypeId) ?? 0) >= neededTargets.get(skillTypeId);
    return {
      skillTypeId,
      skillName: skill.name,
      targetLevel: neededTargets.get(skillTypeId),
      trainedLevel: trained.get(skillTypeId) ?? 0,
      explicit,
      autoAdded: !explicit,
      requiredBy: [...(requiredBy.get(skillTypeId) ?? [])],
    };
  });

  return {
    desiredTargets: desired,
    targets: desired,
    resolvedTargets,
    inputMilestones: occurrences,
    atomicMilestones,
    warnings,
  };
}

function milestonePairs(planOrMilestones) {
  const milestones = Array.isArray(planOrMilestones)
    ? planOrMilestones
    : planOrMilestones?.atomicMilestones ?? [];
  return milestones.map((milestone, order) => ({
    skillTypeId: readSkillTypeId(milestone),
    level: readTargetLevel(milestone),
    order,
  }));
}

module.exports = {
  PlanCycleError,
  UnknownSkillError,
  createSkillCatalog,
  levelLookup,
  milestonePairs,
  normalizeSkillPlan,
  normalizeSkillTypeId,
  normalizeTargetLevel,
  readSkillTypeId,
  readTargetLevel,
};
