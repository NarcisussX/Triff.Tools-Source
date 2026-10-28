"use strict";

const {
  milestonePairs,
  readSkillTypeId,
  readTargetLevel,
} = require("./plan");

function queueValue(entry, ...keys) {
  for (const key of keys) {
    if (entry?.[key] !== undefined && entry[key] !== null) return entry[key];
  }
  return undefined;
}

function timestampMillis(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof Date) {
    const millis = value.getTime();
    if (!Number.isFinite(millis)) throw new RangeError(`${label} is invalid`);
    return millis;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError(`${label} is invalid`);
    return value;
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new RangeError(`${label} is invalid`);
  return millis;
}

function nowMillis(now = Date.now()) {
  return timestampMillis(now, "now");
}

function queueSkillTypeId(entry) {
  return readSkillTypeId({
    skillTypeId: queueValue(entry, "skillTypeId", "skill_id", "skillId", "typeId"),
  });
}

function queueFinishedLevel(entry) {
  return readTargetLevel({
    level: queueValue(entry, "finishedLevel", "finished_level", "targetLevel", "level"),
  });
}

function interpolateQueueSkillPoints(entry, now = Date.now()) {
  const skillTypeId = queueSkillTypeId(entry);
  const finishedLevel = queueFinishedLevel(entry);
  const startSkillPoints = Number(queueValue(
    entry,
    "trainingStartSp",
    "training_start_sp",
    "startSP",
    "startSp",
    "levelStartSp",
    "level_start_sp",
  ) ?? 0);
  const endSkillPoints = Number(queueValue(
    entry,
    "levelEndSp",
    "level_end_sp",
    "endSP",
    "endSp",
  ) ?? startSkillPoints);
  if (!Number.isFinite(startSkillPoints) || !Number.isFinite(endSkillPoints)) {
    throw new TypeError("queue skill point fields must be finite numbers");
  }

  const startTime = timestampMillis(
    queueValue(entry, "startDate", "start_date", "startTime", "start_time", "startAt"),
    "queue start date",
  );
  const finishTime = timestampMillis(
    queueValue(entry, "finishDate", "finish_date", "endTime", "end_time", "endAt", "finishAt"),
    "queue finish date",
  );
  const currentTime = nowMillis(now);
  const minimum = Math.min(startSkillPoints, endSkillPoints);
  const maximum = Math.max(startSkillPoints, endSkillPoints);

  if (startTime === null || finishTime === null) {
    return {
      skillTypeId,
      finishedLevel,
      skillPoints: Math.max(minimum, Math.min(maximum, startSkillPoints)),
      fractionCompleted: null,
      status: "paused",
      startTime,
      finishTime,
      startSkillPoints,
      endSkillPoints,
    };
  }

  let fractionCompleted;
  let status;
  if (finishTime <= startTime) {
    fractionCompleted = currentTime >= finishTime ? 1 : 0;
    status = fractionCompleted === 1 ? "completed" : "scheduled";
  } else if (currentTime < startTime) {
    fractionCompleted = 0;
    status = "scheduled";
  } else if (currentTime >= finishTime) {
    fractionCompleted = 1;
    status = "completed";
  } else {
    fractionCompleted = (currentTime - startTime) / (finishTime - startTime);
    status = "active";
  }

  const interpolated = startSkillPoints
    + ((endSkillPoints - startSkillPoints) * fractionCompleted);
  return {
    skillTypeId,
    finishedLevel,
    skillPoints: Math.max(minimum, Math.min(maximum, Math.floor(interpolated))),
    fractionCompleted,
    status,
    startTime,
    finishTime,
    startSkillPoints,
    endSkillPoints,
  };
}

function normalizedSnapshotRows(snapshot) {
  if (Array.isArray(snapshot)) return snapshot;
  if (Array.isArray(snapshot?.skills)) return snapshot.skills;
  if (snapshot && typeof snapshot === "object") {
    return Object.entries(snapshot).map(([skillTypeId, value]) => (
      typeof value === "object"
        ? { skillTypeId, ...value }
        : { skillTypeId, trainedLevel: value }
    ));
  }
  return [];
}

function reconcileSkillsWithQueue({ skills = [], queue = [], now = Date.now() } = {}) {
  const byId = new Map();
  for (const row of normalizedSnapshotRows(skills)) {
    const skillTypeId = readSkillTypeId(row);
    const trainedLevel = Number(queueValue(
      row,
      "trainedLevel",
      "trained_level",
      "trainedSkillLevel",
      "trained_skill_level",
      "level",
    ) ?? 0);
    const activeLevel = Number(queueValue(row, "activeLevel", "active_skill_level") ?? trainedLevel);
    const skillPoints = Number(queueValue(
      row,
      "skillPoints",
      "skillpoints",
      "skill_points",
      "skillpoints_in_skill",
    ) ?? 0);
    byId.set(skillTypeId, {
      ...row,
      skillTypeId,
      trainedLevel: Math.max(0, Math.min(5, trainedLevel)),
      activeLevel: Math.max(0, Math.min(5, activeLevel)),
      skillPoints: Math.max(0, skillPoints),
      sources: ["skills"],
    });
  }

  const orderedQueue = [...queue].sort((left, right) => (
    Number(queueValue(left, "queuePosition", "queue_position") ?? 0)
    - Number(queueValue(right, "queuePosition", "queue_position") ?? 0)
  ));
  const reconciledQueue = [];
  for (const entry of orderedQueue) {
    const progress = interpolateQueueSkillPoints(entry, now);
    reconciledQueue.push({ ...entry, ...progress });
    let skill = byId.get(progress.skillTypeId);
    if (!skill) {
      skill = {
        skillTypeId: progress.skillTypeId,
        trainedLevel: 0,
        activeLevel: 0,
        skillPoints: 0,
        sources: [],
      };
      byId.set(progress.skillTypeId, skill);
    }

    if (!skill.sources.includes("skillqueue")) skill.sources.push("skillqueue");
    if (progress.status === "completed") {
      skill.trainedLevel = Math.max(skill.trainedLevel, progress.finishedLevel);
      skill.activeLevel = Math.max(skill.activeLevel, progress.finishedLevel);
      skill.skillPoints = Math.max(skill.skillPoints, progress.endSkillPoints);
    } else if (progress.status === "active") {
      skill.skillPoints = Math.max(skill.skillPoints, progress.skillPoints);
      skill.trainingToLevel = Math.max(skill.trainingToLevel ?? 0, progress.finishedLevel);
    }
  }

  const normalizedSkills = [...byId.values()].sort((left, right) => left.skillTypeId - right.skillTypeId);
  return {
    skills: normalizedSkills,
    bySkillTypeId: Object.fromEntries(normalizedSkills.map((skill) => [String(skill.skillTypeId), skill])),
    queue: reconciledQueue,
    totalSp: skills?.total_sp ?? skills?.totalSp,
    unallocatedSp: skills?.unallocated_sp ?? skills?.unallocatedSp,
  };
}

function queueMilestonePairs(queue, { now = Date.now(), includeCompleted = true } = {}) {
  return [...queue]
    .sort((left, right) => (
      Number(queueValue(left, "queuePosition", "queue_position") ?? 0)
      - Number(queueValue(right, "queuePosition", "queue_position") ?? 0)
    ))
    .map((entry) => ({ entry, progress: interpolateQueueSkillPoints(entry, now) }))
    .filter(({ progress }) => includeCompleted || progress.status !== "completed")
    .map(({ entry, progress }, order) => ({
      skillTypeId: progress.skillTypeId,
      level: progress.finishedLevel,
      order,
      queuePosition: Number(queueValue(entry, "queuePosition", "queue_position") ?? order),
      status: progress.status,
    }));
}

function pairKey(pair) {
  return `${pair.skillTypeId}:${pair.level}`;
}

function compareQueueToPlan(queue, planOrMilestones, options = {}) {
  const queued = queueMilestonePairs(queue, options);
  const planned = milestonePairs(planOrMilestones);
  const queuedKeys = new Set(queued.map(pairKey));
  const plannedKeys = new Set(planned.map(pairKey));
  const matched = planned.filter((pair) => queuedKeys.has(pairKey(pair)));
  const queuedNotPlanned = queued.filter((pair) => !plannedKeys.has(pairKey(pair)));
  const plannedNotQueued = planned.filter((pair) => !queuedKeys.has(pairKey(pair)));

  let inOrderPrefixLength = 0;
  while (
    inOrderPrefixLength < queued.length
    && inOrderPrefixLength < planned.length
    && pairKey(queued[inOrderPrefixLength]) === pairKey(planned[inOrderPrefixLength])
  ) {
    inOrderPrefixLength += 1;
  }

  const orderMismatches = [];
  const sharedLength = Math.min(queued.length, planned.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (pairKey(queued[index]) !== pairKey(planned[index])) {
      orderMismatches.push({ index, queued: queued[index], planned: planned[index] });
    }
  }

  return {
    queued,
    planned,
    matched,
    queuedNotPlanned,
    plannedNotQueued,
    inOrderPrefixLength,
    orderMismatches,
    exactMatch: queued.length === planned.length && inOrderPrefixLength === planned.length,
  };
}

module.exports = {
  compareQueueToPlan,
  interpolateQueueSkillPoints,
  queueMilestonePairs,
  reconcileSkillsWithQueue,
};
