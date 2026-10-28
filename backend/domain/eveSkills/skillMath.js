"use strict";

// Clean-room implementation from public EVE mechanics, with behavioral parity
// fixtures recorded against EVEMon commit 32c11fec. No EVEMon source is copied.

const ATTRIBUTE_NAMES = Object.freeze([
  "intelligence",
  "memory",
  "perception",
  "willpower",
  "charisma",
]);

const ATTRIBUTE_ALIASES = Object.freeze({
  int: "intelligence",
  intelligence: "intelligence",
  mem: "memory",
  memory: "memory",
  per: "perception",
  perception: "perception",
  wil: "willpower",
  will: "willpower",
  willpower: "willpower",
  cha: "charisma",
  charisma: "charisma",
});

const DEFAULT_BASE_ATTRIBUTES = Object.freeze({
  intelligence: 20,
  memory: 20,
  perception: 20,
  willpower: 20,
  charisma: 19,
});

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return number;
}

function integerInRange(value, label, minimum, maximum) {
  const number = finiteNumber(value, label);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function normalizeAttributeName(value) {
  const key = String(value ?? "").trim().toLowerCase();
  const normalized = ATTRIBUTE_ALIASES[key];
  if (!normalized) {
    throw new RangeError(`Unknown EVE attribute: ${value}`);
  }
  return normalized;
}

function normalizeAttributeSet(input = {}, fallback = 0) {
  const normalized = {};
  for (const attribute of ATTRIBUTE_NAMES) {
    normalized[attribute] = finiteNumber(fallback, "attribute fallback");
  }

  if (typeof input === "number") {
    for (const attribute of ATTRIBUTE_NAMES) normalized[attribute] = input;
    return normalized;
  }

  if (!input || typeof input !== "object") return normalized;
  for (const [key, rawValue] of Object.entries(input)) {
    const alias = ATTRIBUTE_ALIASES[String(key).toLowerCase()];
    if (alias) normalized[alias] = finiteNumber(rawValue, alias);
  }
  return normalized;
}

function combineAttributes(base = DEFAULT_BASE_ATTRIBUTES, implants = {}, booster = {}) {
  const normalizedBase = normalizeAttributeSet(base, 0);
  const normalizedImplants = normalizeAttributeSet(implants, 0);
  const normalizedBooster = normalizeAttributeSet(booster, 0);
  const result = {};
  for (const attribute of ATTRIBUTE_NAMES) {
    result[attribute] = normalizedBase[attribute]
      + normalizedImplants[attribute]
      + normalizedBooster[attribute];
  }
  return result;
}

/**
 * Return the cumulative SP threshold for an EVE skill level.
 *
 * Level II deliberately performs each operation at Float32 precision. That
 * matches the historical client behavior without simplifying it to the
 * incorrect `1415 * rank` approximation.
 */
function skillPointsForLevel(rank, level) {
  const normalizedRank = integerInRange(rank, "rank", 1, Number.MAX_SAFE_INTEGER);
  const normalizedLevel = integerInRange(level, "level", 0, 5);

  switch (normalizedLevel) {
    case 0:
      return 0;
    case 1:
      return 250 * normalizedRank;
    case 2: {
      if (normalizedRank === 1) return 1_415;
      const rankAsFloat = Math.fround(normalizedRank);
      const product = Math.fround(rankAsFloat * Math.fround(1_414.3));
      return Math.trunc(Math.fround(product + Math.fround(0.5)));
    }
    case 3:
      return 8_000 * normalizedRank;
    case 4:
      return Math.ceil((2 ** 7.5) * 250 * normalizedRank);
    case 5:
      return 256_000 * normalizedRank;
    default:
      throw new RangeError("Unreachable skill level");
  }
}

function skillPointsForLevelOnly(rank, level) {
  const normalizedLevel = integerInRange(level, "level", 0, 5);
  if (normalizedLevel === 0) return 0;
  return skillPointsForLevel(rank, normalizedLevel)
    - skillPointsForLevel(rank, normalizedLevel - 1);
}

function resolveCloneMultiplier(value = 1) {
  if (typeof value === "string") {
    switch (value.trim().toLowerCase()) {
      case "omega":
        return 1;
      case "alpha":
      case "unknown":
        return 0.5;
      default:
        throw new RangeError(`Unknown clone status: ${value}`);
    }
  }

  const multiplier = finiteNumber(value, "clone multiplier");
  if (multiplier <= 0) throw new RangeError("clone multiplier must be greater than zero");
  return multiplier;
}

function skillPointsPerHour(primaryAttribute, secondaryAttribute, cloneMultiplier = 1) {
  const primary = finiteNumber(primaryAttribute, "primary attribute");
  const secondary = finiteNumber(secondaryAttribute, "secondary attribute");
  if (primary < 0 || secondary < 0) {
    throw new RangeError("attributes cannot be negative");
  }
  return ((primary * 60) + (secondary * 30)) * resolveCloneMultiplier(cloneMultiplier);
}

function skillRateForDefinition(skill, effectiveAttributes, cloneMultiplier = 1) {
  if (!skill || typeof skill !== "object") throw new TypeError("skill definition is required");
  const primaryName = normalizeAttributeName(
    skill.primaryAttribute ?? skill.primary_attribute ?? skill.primary,
  );
  const secondaryName = normalizeAttributeName(
    skill.secondaryAttribute ?? skill.secondary_attribute ?? skill.secondary,
  );
  const attributes = normalizeAttributeSet(effectiveAttributes, 0);
  return skillPointsPerHour(
    attributes[primaryName],
    attributes[secondaryName],
    cloneMultiplier,
  );
}

function remainingSkillPoints(rank, targetLevel, currentSkillPoints = 0) {
  const current = finiteNumber(currentSkillPoints, "current skill points");
  return Math.max(0, skillPointsForLevel(rank, targetLevel) - current);
}

function trainingTimeSecondsForPoints(skillPoints, spPerHour) {
  const points = finiteNumber(skillPoints, "skill points");
  const rate = finiteNumber(spPerHour, "SP per hour");
  if (points <= 0) return 0;
  if (rate <= 0) return Number.POSITIVE_INFINITY;
  return (points / rate) * 3_600;
}

function trainingTimeSeconds({
  rank,
  targetLevel,
  currentSkillPoints = 0,
  currentSp,
  primaryAttribute,
  primary,
  secondaryAttribute,
  secondary,
  cloneMultiplier = 1,
}) {
  const points = remainingSkillPoints(rank, targetLevel, currentSp ?? currentSkillPoints);
  const rate = skillPointsPerHour(
    primary ?? primaryAttribute,
    secondary ?? secondaryAttribute,
    cloneMultiplier,
  );
  return trainingTimeSecondsForPoints(points, rate);
}

module.exports = {
  ATTRIBUTE_NAMES,
  DEFAULT_BASE_ATTRIBUTES,
  combineAttributes,
  normalizeAttributeName,
  normalizeAttributeSet,
  remainingSkillPoints,
  resolveCloneMultiplier,
  skillPointsForLevel,
  skillPointsForLevelOnly,
  skillPointsPerHour,
  skillRateForDefinition,
  trainingTimeSeconds,
  trainingTimeSecondsForPoints,
};
