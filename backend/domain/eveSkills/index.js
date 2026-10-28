"use strict";

const skillMath = require("./skillMath");
const planDomain = require("./plan");
const durationDomain = require("./duration");
const queueDomain = require("./queue");
const remapDomain = require("./remap");
const planFormats = require("./formats");

function normalizePlanTargets(targets = []) {
  const retained = new Map();
  targets.forEach((raw, index) => {
    const skillTypeId = planDomain.readSkillTypeId(raw);
    const targetLevel = planDomain.readTargetLevel(raw);
    const position = Number.isInteger(Number(raw.position)) ? Number(raw.position) : index;
    const explicit = raw.explicit !== false && raw.autoAdded !== true && raw.isExplicit !== false;
    const existing = retained.get(skillTypeId);
    if (!existing) {
      retained.set(skillTypeId, {
        ...raw,
        skillTypeId,
        targetLevel,
        position,
        explicit,
        sourceIndices: [index],
      });
      return;
    }

    existing.sourceIndices.push(index);
    const earliestPosition = Math.min(existing.position, position);
    const explicitlyRequested = existing.explicit || explicit;
    if (targetLevel > existing.targetLevel) {
      Object.assign(existing, raw, { skillTypeId, targetLevel });
    }
    existing.position = earliestPosition;
    existing.explicit = explicitlyRequested;
  });
  return [...retained.values()]
    .sort((left, right) => left.position - right.position)
    .map((target, position) => ({ ...target, position }));
}

function trainedLevelObject(characterSkills = {}) {
  const levels = {};
  for (const [skillTypeId, state] of Object.entries(characterSkills ?? {})) {
    levels[skillTypeId] = Number(
      typeof state === "object"
        ? state.level ?? state.trainedLevel ?? state.trained_skill_level ?? 0
        : state,
    ) || 0;
  }
  return levels;
}

function currentSkillPointObject(characterSkills = {}) {
  const points = {};
  for (const [skillTypeId, state] of Object.entries(characterSkills ?? {})) {
    if (!state || typeof state !== "object") continue;
    points[skillTypeId] = Number(
      state.skillpoints ?? state.skillPoints ?? state.skill_points ?? state.currentSp ?? 0,
    ) || 0;
  }
  return points;
}

function resolvePrerequisites(targets, catalog, trainedLevels = {}) {
  const normalizedTargets = normalizePlanTargets(targets);
  const normalized = planDomain.normalizeSkillPlan({
    desiredTargets: normalizedTargets,
    skills: catalog,
    trainedLevels,
  });
  const resolvedById = new Map(normalized.resolvedTargets.map((target) => [target.skillTypeId, target]));
  const desiredById = new Map(normalized.desiredTargets.map((target) => [target.skillTypeId, target]));
  const orderedIds = [];
  const seen = new Set();
  for (const milestone of normalized.atomicMilestones) {
    if (!seen.has(milestone.skillTypeId)) {
      seen.add(milestone.skillTypeId);
      orderedIds.push(milestone.skillTypeId);
    }
  }

  const resolved = orderedIds.map((skillTypeId, position) => {
    const target = resolvedById.get(skillTypeId);
    const desired = desiredById.get(skillTypeId);
    return {
      ...(desired ?? {}),
      skillTypeId,
      skillName: target.skillName,
      targetLevel: target.targetLevel,
      position,
      explicit: target.explicit,
      autoAdded: !target.explicit,
      requiredBy: target.requiredBy,
    };
  });

  return {
    ...normalized,
    targets: resolved,
  };
}

function analyzePlan({
  targets = [],
  catalog = [],
  characterSkills = {},
  attributes = skillMath.DEFAULT_BASE_ATTRIBUTES,
  cloneMultiplier = 1,
  queue = [],
} = {}) {
  const structure = resolvePrerequisites(targets, catalog, {});
  const trainedLevels = trainedLevelObject(characterSkills);
  const currentSkillPoints = currentSkillPointObject(characterSkills);
  const normalized = planDomain.normalizeSkillPlan({
    desiredTargets: structure.targets,
    skills: catalog,
    trainedLevels,
  });
  const duration = durationDomain.analyzePlanDurations({
    plan: normalized,
    skills: catalog,
    trainedLevels,
    currentSkillPoints,
    attributes,
    cloneMultiplier,
  });
  const skillCatalog = planDomain.createSkillCatalog(catalog);
  const analyzedTargets = structure.targets.map((target) => {
    const skill = skillCatalog.get(target.skillTypeId);
    const state = characterSkills[target.skillTypeId] ?? characterSkills[String(target.skillTypeId)] ?? {};
    const currentLevel = Number(state.level ?? state.trainedLevel ?? 0) || 0;
    const levelFloor = skillMath.skillPointsForLevel(skill.rank, Math.max(0, Math.min(5, currentLevel)));
    const currentSp = Math.max(
      levelFloor,
      Number(state.skillpoints ?? state.skillPoints ?? state.skill_points ?? 0) || 0,
    );
    const targetSp = skillMath.skillPointsForLevel(skill.rank, target.targetLevel);
    const remainingSp = skillMath.remainingSkillPoints(skill.rank, target.targetLevel, currentSp);
    const alreadyTrained = currentSp >= targetSp;
    const partiallyTrained = !alreadyTrained && currentSp > levelFloor;
    const spPerHour = skillMath.skillRateForDefinition(skill, attributes, cloneMultiplier);
    return {
      ...target,
      currentLevel,
      currentSp,
      targetSp,
      remainingSp,
      alreadyTrained,
      partiallyTrained,
      spPerHour,
      trainingSeconds: skillMath.trainingTimeSecondsForPoints(remainingSp, spPerHour),
    };
  });
  const warningMessages = [
    ...structure.warnings,
    ...normalized.warnings,
  ].map((warning) => (
    typeof warning === "string" ? warning : `${warning.code}: skill ${warning.skillTypeId ?? "unknown"}`
  ));

  return {
    targets: analyzedTargets,
    remainingSp: duration.totalSkillPoints,
    trainingSeconds: duration.totalDurationSeconds,
    warnings: [...new Set(warningMessages)],
    atomicMilestones: normalized.atomicMilestones,
    duration,
    queueComparison: queue.length
      ? queueDomain.compareQueueToPlan(queue, normalized, { includeCompleted: false })
      : null,
  };
}

function splitMilestones(milestones, requestedSegments) {
  if (!milestones.length) return [[]];
  const count = Math.max(1, Math.min(Number(requestedSegments) || 1, milestones.length));
  const sections = [];
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor((index * milestones.length) / count);
    const end = Math.floor(((index + 1) * milestones.length) / count);
    sections.push(milestones.slice(start, end));
  }
  return sections;
}

function optimizePlanAttributes({
  targets = [],
  catalog = [],
  characterSkills = {},
  currentAttributes = skillMath.DEFAULT_BASE_ATTRIBUTES,
  cloneMultiplier = 1,
  segments = 1,
  implants = {},
  booster = {},
} = {}) {
  const structure = resolvePrerequisites(targets, catalog, {});
  const trainedLevels = trainedLevelObject(characterSkills);
  const currentSkillPoints = currentSkillPointObject(characterSkills);
  const normalized = planDomain.normalizeSkillPlan({
    desiredTargets: structure.targets,
    skills: catalog,
    trainedLevels,
  });
  const current = durationDomain.analyzePlanDurations({
    plan: normalized,
    skills: catalog,
    trainedLevels,
    currentSkillPoints,
    attributes: currentAttributes,
    cloneMultiplier,
  });
  if (!normalized.atomicMilestones.length) {
    return {
      currentSeconds: 0,
      optimizedSeconds: 0,
      attributes: currentAttributes,
      segments: [],
      warnings: [],
    };
  }

  const sections = splitMilestones(normalized.atomicMilestones, segments);
  if (sections.length === 1) {
    const optimized = remapDomain.optimizeRemap({
      milestones: sections[0],
      skills: catalog,
      trainedLevels,
      currentSkillPoints,
      cloneMultiplier,
      implants,
      booster,
    });
    return {
      currentSeconds: current.totalDurationSeconds,
      optimizedSeconds: optimized.totalDurationSeconds,
      attributes: optimized.baseAttributes,
      segments: [{
        index: 0,
        attributes: optimized.baseAttributes,
        trainingSeconds: optimized.totalDurationSeconds,
        milestoneCount: sections[0].length,
      }],
      warnings: [],
      optimizer: optimized,
    };
  }

  const optimized = remapDomain.optimizeRemapSections({
    sections: sections.map((milestones, index) => ({ id: index, milestones })),
    skills: catalog,
    trainedLevels,
    currentSkillPoints,
    cloneMultiplier,
    implants,
    booster,
  });
  return {
    currentSeconds: current.totalDurationSeconds,
    optimizedSeconds: optimized.totalDurationSeconds,
    attributes: optimized.sections[0]?.baseAttributes ?? currentAttributes,
    segments: optimized.sections.map((section, index) => ({
      index,
      attributes: section.baseAttributes,
      trainingSeconds: section.totalDurationSeconds,
      milestoneCount: sections[index].length,
    })),
    warnings: ["Remap sections are advisory contiguous partitions; in-game remap cooldowns are not modeled."],
    optimizer: optimized,
  };
}

module.exports = {
  ...skillMath,
  ...planDomain,
  ...durationDomain,
  ...queueDomain,
  ...remapDomain,
  ...planFormats,
  analyzePlan,
  normalizePlanTargets,
  optimizePlanAttributes,
  resolvePrerequisites,
};
