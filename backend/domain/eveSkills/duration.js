"use strict";

const {
  DEFAULT_BASE_ATTRIBUTES,
  combineAttributes,
  normalizeAttributeSet,
  skillPointsForLevel,
  skillRateForDefinition,
  trainingTimeSecondsForPoints,
} = require("./skillMath");
const {
  createSkillCatalog,
  levelLookup,
  readSkillTypeId,
  readTargetLevel,
} = require("./plan");

function skillPointLookup(input = {}) {
  const result = new Map();
  if (input instanceof Map) {
    for (const [id, points] of input) result.set(Number(id), Number(points) || 0);
    return result;
  }
  if (Array.isArray(input)) {
    for (const row of input) {
      const id = readSkillTypeId(row);
      const points = row.skillPoints ?? row.skillpoints ?? row.skill_points ?? row.trainedSkillPoints ?? 0;
      result.set(id, Number(points) || 0);
    }
    return result;
  }
  for (const [id, points] of Object.entries(input ?? {})) {
    result.set(Number(id), Number(points) || 0);
  }
  return result;
}

function mapToObject(map) {
  return Object.fromEntries([...map.entries()].map(([key, value]) => [String(key), value]));
}

function planMilestones(planOrMilestones) {
  if (Array.isArray(planOrMilestones)) return planOrMilestones;
  if (Array.isArray(planOrMilestones?.atomicMilestones)) return planOrMilestones.atomicMilestones;
  throw new TypeError("plan must be an atomic milestone array or normalized plan");
}

function analyzePlanDurations({
  plan,
  milestones,
  skills,
  trainedLevels = {},
  currentSkillPoints = {},
  attributes,
  baseAttributes = DEFAULT_BASE_ATTRIBUTES,
  implants = {},
  booster = {},
  cloneMultiplier = 1,
} = {}) {
  const catalog = createSkillCatalog(skills);
  const ordered = planMilestones(milestones ?? plan);
  const levels = levelLookup(trainedLevels);
  const points = skillPointLookup(currentSkillPoints);
  const effectiveAttributes = attributes
    ? normalizeAttributeSet(attributes, 0)
    : combineAttributes(baseAttributes, implants, booster);

  for (const [skillTypeId, level] of levels) {
    const skill = catalog.get(skillTypeId);
    if (!skill) continue;
    const floor = skillPointsForLevel(skill.rank, level);
    points.set(skillTypeId, Math.max(points.get(skillTypeId) ?? 0, floor));
  }

  let elapsedSeconds = 0;
  let totalSkillPoints = 0;
  const steps = [];
  for (let order = 0; order < ordered.length; order += 1) {
    const milestone = ordered[order];
    const skillTypeId = readSkillTypeId(milestone);
    const level = readTargetLevel(milestone);
    const skill = catalog.get(skillTypeId);
    if (!skill) throw new RangeError(`Missing skill definition ${skillTypeId}`);

    const levelFloor = skillPointsForLevel(skill.rank, levels.get(skillTypeId) ?? 0);
    const startSkillPoints = Math.max(points.get(skillTypeId) ?? 0, levelFloor);
    const targetSkillPoints = skillPointsForLevel(skill.rank, level);
    const skillPoints = Math.max(0, targetSkillPoints - startSkillPoints);
    const spPerHour = skillRateForDefinition(skill, effectiveAttributes, cloneMultiplier);
    const durationSeconds = trainingTimeSecondsForPoints(skillPoints, spPerHour);
    const startsAtSeconds = elapsedSeconds;
    elapsedSeconds += durationSeconds;
    totalSkillPoints += skillPoints;

    points.set(skillTypeId, Math.max(startSkillPoints, targetSkillPoints));
    levels.set(skillTypeId, Math.max(levels.get(skillTypeId) ?? 0, level));
    steps.push({
      ...milestone,
      order,
      skillTypeId,
      skillName: skill.name,
      level,
      rank: skill.rank,
      startSkillPoints,
      targetSkillPoints,
      skillPoints,
      spPerHour,
      durationSeconds,
      startsAtSeconds,
      endsAtSeconds: elapsedSeconds,
    });
  }

  return {
    totalDurationSeconds: elapsedSeconds,
    totalSkillPoints,
    effectiveAttributes,
    cloneMultiplier,
    steps,
    finalSkillPoints: mapToObject(points),
    finalTrainedLevels: mapToObject(levels),
  };
}

module.exports = {
  analyzePlanDurations,
  planMilestones,
  skillPointLookup,
};
