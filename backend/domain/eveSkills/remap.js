"use strict";

const { analyzePlanDurations, planMilestones } = require("./duration");
const { createSkillCatalog } = require("./plan");
const { DEFAULT_BASE_ATTRIBUTES } = require("./skillMath");

const BASE_ATTRIBUTE_POINTS = 17;
const REMAPPABLE_POINTS = 14;
const MAX_REMAPPABLE_PER_ATTRIBUTE = 10;
const MAX_BASE_ATTRIBUTE = BASE_ATTRIBUTE_POINTS + MAX_REMAPPABLE_PER_ATTRIBUTE;

let allocationCache;

/**
 * Enumerate legal neural remaps in the historical EVEMon order. Keeping this
 * order stable also makes exact-duration ties deterministic.
 */
function enumerateRemapAllocations() {
  if (allocationCache) return allocationCache;
  const allocations = [];
  for (let perception = 0; perception <= MAX_REMAPPABLE_PER_ATTRIBUTE; perception += 1) {
    const maxWillpower = REMAPPABLE_POINTS - perception;
    for (
      let willpower = 0;
      willpower <= maxWillpower && willpower <= MAX_REMAPPABLE_PER_ATTRIBUTE;
      willpower += 1
    ) {
      const maxIntelligence = maxWillpower - willpower;
      for (
        let intelligence = 0;
        intelligence <= maxIntelligence && intelligence <= MAX_REMAPPABLE_PER_ATTRIBUTE;
        intelligence += 1
      ) {
        const maxMemory = maxIntelligence - intelligence;
        for (
          let memory = 0;
          memory <= maxMemory && memory <= MAX_REMAPPABLE_PER_ATTRIBUTE;
          memory += 1
        ) {
          const charisma = maxMemory - memory;
          if (charisma > MAX_REMAPPABLE_PER_ATTRIBUTE) continue;
          allocations.push(Object.freeze({
            intelligence: BASE_ATTRIBUTE_POINTS + intelligence,
            memory: BASE_ATTRIBUTE_POINTS + memory,
            perception: BASE_ATTRIBUTE_POINTS + perception,
            willpower: BASE_ATTRIBUTE_POINTS + willpower,
            charisma: BASE_ATTRIBUTE_POINTS + charisma,
          }));
        }
      }
    }
  }
  allocationCache = Object.freeze(allocations);
  return allocationCache;
}

function isLegalRemap(attributes) {
  const values = [
    attributes?.intelligence,
    attributes?.memory,
    attributes?.perception,
    attributes?.willpower,
    attributes?.charisma,
  ].map(Number);
  return values.every((value) => (
    Number.isInteger(value)
    && value >= BASE_ATTRIBUTE_POINTS
    && value <= MAX_BASE_ATTRIBUTE
  )) && values.reduce((sum, value) => sum + value, 0) === 99;
}

function scoreAnalysis(analysis, maxDurationSeconds) {
  if (!Number.isFinite(maxDurationSeconds)) {
    return {
      completedMilestones: analysis.steps.length,
      scoredDurationSeconds: analysis.totalDurationSeconds,
    };
  }
  let completedMilestones = 0;
  let scoredDurationSeconds = 0;
  for (const step of analysis.steps) {
    if (step.endsAtSeconds > maxDurationSeconds) break;
    completedMilestones += 1;
    scoredDurationSeconds = step.endsAtSeconds;
  }
  return { completedMilestones, scoredDurationSeconds };
}

function optimizeRemap({
  plan,
  milestones,
  skills,
  trainedLevels = {},
  currentSkillPoints = {},
  cloneMultiplier = 1,
  implants = {},
  booster = {},
  currentBaseAttributes,
  maxDurationSeconds = Number.POSITIVE_INFINITY,
} = {}) {
  const ordered = planMilestones(milestones ?? plan);
  const skillCatalog = createSkillCatalog(skills);
  const durationLimit = Number(maxDurationSeconds);
  if (Number.isNaN(durationLimit) || durationLimit < 0) {
    throw new RangeError("maxDurationSeconds must be non-negative");
  }

  let best;
  const allocations = enumerateRemapAllocations();
  for (let allocationIndex = 0; allocationIndex < allocations.length; allocationIndex += 1) {
    const baseAttributes = allocations[allocationIndex];
    const analysis = analyzePlanDurations({
      milestones: ordered,
      skills: skillCatalog,
      trainedLevels,
      currentSkillPoints,
      baseAttributes,
      implants,
      booster,
      cloneMultiplier,
    });
    const score = scoreAnalysis(analysis, durationLimit);
    if (
      best
      && score.completedMilestones <= best.completedMilestones
      && (
        score.completedMilestones < best.completedMilestones
        || score.scoredDurationSeconds >= best.scoredDurationSeconds
      )
    ) {
      continue;
    }
    best = {
      allocationIndex,
      baseAttributes,
      effectiveAttributes: analysis.effectiveAttributes,
      completedMilestones: score.completedMilestones,
      scoredDurationSeconds: score.scoredDurationSeconds,
      totalDurationSeconds: analysis.totalDurationSeconds,
      analysis,
    };
  }

  let baseline;
  if (currentBaseAttributes) {
    const analysis = analyzePlanDurations({
      milestones: ordered,
      skills: skillCatalog,
      trainedLevels,
      currentSkillPoints,
      baseAttributes: currentBaseAttributes,
      implants,
      booster,
      cloneMultiplier,
    });
    baseline = {
      baseAttributes: currentBaseAttributes,
      totalDurationSeconds: analysis.totalDurationSeconds,
      analysis,
    };
  }

  return {
    ...best,
    evaluatedAllocations: allocations.length,
    legalAllocationCount: allocations.length,
    tiePolicy: "first allocation in perception/willpower/intelligence/memory ascending order",
    maxDurationSeconds: durationLimit,
    baseline,
    savedSeconds: baseline ? baseline.totalDurationSeconds - best.totalDurationSeconds : null,
  };
}

function optimizeRemapSections({
  sections = [],
  skills,
  trainedLevels = {},
  currentSkillPoints = {},
  cloneMultiplier = 1,
  implants = {},
  booster = {},
  currentBaseAttributes = DEFAULT_BASE_ATTRIBUTES,
} = {}) {
  const skillCatalog = createSkillCatalog(skills);
  let nextLevels = trainedLevels;
  let nextSkillPoints = currentSkillPoints;
  let totalDurationSeconds = 0;
  const results = [];

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const result = optimizeRemap({
      milestones: section.milestones ?? section.plan ?? section.atomicMilestones ?? section,
      skills: skillCatalog,
      trainedLevels: nextLevels,
      currentSkillPoints: nextSkillPoints,
      cloneMultiplier: section.cloneMultiplier ?? cloneMultiplier,
      implants: section.implants ?? implants,
      booster: section.booster ?? booster,
      currentBaseAttributes: section.currentBaseAttributes ?? currentBaseAttributes,
      maxDurationSeconds: section.maxDurationSeconds ?? Number.POSITIVE_INFINITY,
    });
    results.push({
      sectionIndex: index,
      sectionId: section.id ?? section.name ?? index,
      ...result,
    });
    totalDurationSeconds += result.totalDurationSeconds;
    nextLevels = result.analysis.finalTrainedLevels;
    nextSkillPoints = result.analysis.finalSkillPoints;
  }

  return {
    sections: results,
    totalDurationSeconds,
    finalTrainedLevels: nextLevels,
    finalSkillPoints: nextSkillPoints,
  };
}

module.exports = {
  BASE_ATTRIBUTE_POINTS,
  MAX_BASE_ATTRIBUTE,
  MAX_REMAPPABLE_PER_ATTRIBUTE,
  REMAPPABLE_POINTS,
  enumerateRemapAllocations,
  isLegalRemap,
  optimizeRemap,
  optimizeRemapSections,
};
