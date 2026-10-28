"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const eveSkills = require("../domain/eveSkills");

// Named fixture skills use current EVE type IDs. Their small prerequisite graph
// is intentionally local so domain edge cases remain stable across SDE updates.
const SKILLS = [
  {
    skillTypeId: 3327,
    name: "Spaceship Command",
    rank: 1,
    primaryAttribute: "perception",
    secondaryAttribute: "willpower",
    prerequisites: [],
  },
  {
    skillTypeId: 3330,
    name: "Caldari Frigate",
    rank: 2,
    primaryAttribute: "perception",
    secondaryAttribute: "willpower",
    prerequisites: [{ skillTypeId: 3327, requiredLevel: 3 }],
  },
  {
    skillTypeId: 3334,
    name: "Caldari Cruiser",
    rank: 5,
    primaryAttribute: "perception",
    secondaryAttribute: "willpower",
    prerequisites: [{ skillTypeId: 3330, requiredLevel: 3 }],
  },
  {
    skillTypeId: 3426,
    name: "CPU Management",
    rank: 1,
    primaryAttribute: "intelligence",
    secondaryAttribute: "memory",
    prerequisites: [],
  },
  {
    skillTypeId: 3413,
    name: "Power Grid Management",
    rank: 1,
    primaryAttribute: "intelligence",
    secondaryAttribute: "memory",
    prerequisites: [{ skillTypeId: 3426, requiredLevel: 2 }],
  },
  {
    skillTypeId: 3319,
    name: "Weapon Upgrades",
    rank: 2,
    primaryAttribute: "perception",
    secondaryAttribute: "memory",
    prerequisites: [{ skillTypeId: 3426, requiredLevel: 1 }],
  },
  {
    skillTypeId: 11207,
    name: "Advanced Weapon Upgrades",
    rank: 6,
    primaryAttribute: "intelligence",
    secondaryAttribute: "memory",
    prerequisites: [
      { skillTypeId: 3413, requiredLevel: 4 },
      { skillTypeId: 3319, requiredLevel: 5 },
    ],
  },
];

test("skill SP thresholds retain exact Float32 EVEMon parity at level II", () => {
  const expected = new Map([
    [1, [0, 250, 1_415, 8_000, 45_255, 256_000]],
    [2, [0, 500, 2_829, 16_000, 90_510, 512_000]],
    [3, [0, 750, 4_243, 24_000, 135_765, 768_000]],
    [5, [0, 1_250, 7_072, 40_000, 226_275, 1_280_000]],
    [8, [0, 2_000, 11_314, 64_000, 362_039, 2_048_000]],
    [16, [0, 4_000, 22_629, 128_000, 724_078, 4_096_000]],
  ]);
  for (const [rank, thresholds] of expected) {
    assert.deepEqual(
      thresholds.map((_, level) => eveSkills.skillPointsForLevel(rank, level)),
      thresholds,
    );
  }
  assert.notEqual(eveSkills.skillPointsForLevel(8, 2), 1_415 * 8);
});

test("training rates and partial-SP duration are exact", () => {
  assert.equal(eveSkills.skillPointsPerHour(27, 21, "omega"), 2_250);
  assert.equal(eveSkills.skillPointsPerHour(27, 21, "alpha"), 1_125);
  assert.equal(eveSkills.skillPointsPerHour(32, 26, 1), 2_700);
  assert.equal(eveSkills.remainingSkillPoints(1, 4, 20_000), 25_255);
  assert.equal(eveSkills.trainingTimeSeconds({
    rank: 1,
    targetLevel: 4,
    currentSp: 20_000,
    primary: 27,
    secondary: 21,
    cloneMultiplier: 1,
  }), 40_408);
});

test("desired targets dedupe to the highest level while atomic milestones preserve interleaving", () => {
  const result = eveSkills.normalizeSkillPlan({
    desiredTargets: [
      { skillTypeId: 3327, targetLevel: 1 },
      { skillTypeId: 3426, targetLevel: 1 },
      { skillTypeId: 3327, targetLevel: 3 },
    ],
    skills: SKILLS,
  });
  assert.deepEqual(
    result.desiredTargets.map(({ skillTypeId, targetLevel }) => ({ skillTypeId, targetLevel })),
    [
      { skillTypeId: 3327, targetLevel: 3 },
      { skillTypeId: 3426, targetLevel: 1 },
    ],
  );
  assert.deepEqual(
    result.atomicMilestones.map(({ skillTypeId, level }) => `${skillTypeId}:${level}`),
    ["3327:1", "3426:1", "3327:2", "3327:3"],
  );
});

test("prerequisites are recursive, prerequisite-first, convergent, marked, and trained-aware", () => {
  const result = eveSkills.normalizeSkillPlan({
    desiredTargets: [{ skillTypeId: 11207, targetLevel: 1 }],
    skills: SKILLS,
    trainedLevels: { 3426: 1 },
  });
  const milestones = result.atomicMilestones.map(({ skillTypeId, level }) => `${skillTypeId}:${level}`);
  assert.equal(milestones.filter((value) => value === "3426:2").length, 1);
  assert.ok(milestones.indexOf("3426:2") < milestones.indexOf("3413:1"));
  assert.ok(milestones.indexOf("3413:4") < milestones.indexOf("11207:1"));
  assert.ok(milestones.indexOf("3319:5") < milestones.indexOf("11207:1"));
  assert.equal(result.atomicMilestones.find((item) => item.skillTypeId === 3426).autoAdded, true);
  assert.equal(result.atomicMilestones.at(-1).explicit, true);
  assert.ok(!milestones.includes("3426:1"));
});

test("prerequisite cycles are rejected with an inspectable cycle", () => {
  const cyclic = [
    { ...SKILLS[0], prerequisites: [{ skillTypeId: 3330, requiredLevel: 1 }] },
    { ...SKILLS[1], prerequisites: [{ skillTypeId: 3327, requiredLevel: 1 }] },
  ];
  assert.throws(
    () => eveSkills.normalizeSkillPlan({
      desiredTargets: [{ skillTypeId: 3327, targetLevel: 1 }],
      skills: cyclic,
    }),
    (error) => error.code === "PREREQUISITE_CYCLE"
      && assert.deepEqual(error.cycle, [3327, 3330, 3327]) === undefined,
  );
});

test("plan duration analysis starts from partial SP and reports each atomic step", () => {
  const normalized = eveSkills.normalizeSkillPlan({
    desiredTargets: [{ skillTypeId: 3426, targetLevel: 4 }],
    skills: SKILLS,
    trainedLevels: { 3426: 3 },
  });
  const result = eveSkills.analyzePlanDurations({
    plan: normalized,
    skills: SKILLS,
    trainedLevels: { 3426: 3 },
    currentSkillPoints: { 3426: 20_000 },
    attributes: { intelligence: 27, memory: 21, perception: 17, willpower: 17, charisma: 17 },
  });
  assert.equal(result.steps.length, 1);
  assert.equal(result.totalSkillPoints, 25_255);
  assert.equal(result.totalDurationSeconds, 40_408);
  assert.equal(result.steps[0].spPerHour, 2_250);
});

test("queue interpolation and reconciliation overlay stale ESI skills", () => {
  const halfway = eveSkills.interpolateQueueSkillPoints({
    skillTypeId: 3426,
    targetLevel: 4,
    startAt: "2026-01-01T01:00:00Z",
    endAt: "2026-01-01T02:00:00Z",
    startSp: 8_000,
    endSp: 45_255,
  }, "2026-01-01T01:30:00Z");
  assert.equal(halfway.status, "active");
  assert.equal(halfway.skillPoints, 26_627);
  assert.equal(halfway.fractionCompleted, 0.5);

  const reconciled = eveSkills.reconcileSkillsWithQueue({
    skills: [{ skill_id: 3426, trained_skill_level: 2, skillpoints_in_skill: 1_415 }],
    queue: [
      {
        skill_id: 3426,
        finished_level: 3,
        queue_position: 0,
        start_date: "2026-01-01T00:00:00Z",
        finish_date: "2026-01-01T01:00:00Z",
        training_start_sp: 1_415,
        level_end_sp: 8_000,
      },
      {
        skill_id: 3426,
        finished_level: 4,
        queue_position: 1,
        start_date: "2026-01-01T01:00:00Z",
        finish_date: "2026-01-01T02:00:00Z",
        training_start_sp: 8_000,
        level_end_sp: 45_255,
      },
    ],
    now: "2026-01-01T01:30:00Z",
  });
  assert.equal(reconciled.bySkillTypeId[3426].trainedLevel, 3);
  assert.equal(reconciled.bySkillTypeId[3426].skillPoints, 26_627);
  assert.equal(reconciled.bySkillTypeId[3426].trainingToLevel, 4);
});

test("queue comparison keys milestones by type ID and finished level", () => {
  const plan = { atomicMilestones: [
    { skillTypeId: 3327, level: 1 },
    { skillTypeId: 3426, level: 1 },
  ] };
  const queue = [
    { skillTypeId: 3327, targetLevel: 1, queuePosition: 0 },
    { skillTypeId: 3330, targetLevel: 1, queuePosition: 1 },
  ];
  const comparison = eveSkills.compareQueueToPlan(queue, plan);
  assert.equal(comparison.matched.length, 1);
  assert.deepEqual(comparison.queuedNotPlanned.map((item) => `${item.skillTypeId}:${item.level}`), ["3330:1"]);
  assert.deepEqual(comparison.plannedNotQueued.map((item) => `${item.skillTypeId}:${item.level}`), ["3426:1"]);
});

test("remap enumeration has 2,885 legal allocations and deterministic ties", () => {
  const allocations = eveSkills.enumerateRemapAllocations();
  assert.equal(allocations.length, 2_885);
  assert.ok(allocations.every(eveSkills.isLegalRemap));

  const empty = eveSkills.optimizeRemap({ milestones: [], skills: SKILLS });
  assert.deepEqual(empty.baseAttributes, {
    intelligence: 17,
    memory: 21,
    perception: 17,
    willpower: 17,
    charisma: 27,
  });
});

test("remap optimizer chooses 27 primary and 21 secondary for one attribute pair", () => {
  const intelligencePlan = eveSkills.normalizeSkillPlan({
    desiredTargets: [{ skillTypeId: 3426, targetLevel: 5 }],
    skills: SKILLS,
  });
  const result = eveSkills.optimizeRemap({ plan: intelligencePlan, skills: SKILLS });
  assert.equal(result.evaluatedAllocations, 2_885);
  assert.deepEqual(result.baseAttributes, {
    intelligence: 27,
    memory: 21,
    perception: 17,
    willpower: 17,
    charisma: 17,
  });
});

test("segmented optimizer carries trained state between independent sections", () => {
  let catalogBuilds = 0;
  const observedSkills = new Proxy(SKILLS, {
    get(target, property, receiver) {
      if (property !== "map") return Reflect.get(target, property, receiver);
      return (...args) => {
        catalogBuilds += 1;
        return target.map(...args);
      };
    },
  });
  const result = eveSkills.optimizeRemapSections({
    sections: [
      { id: "engineering", milestones: [{ skillTypeId: 3426, level: 3 }] },
      { id: "ships", milestones: [{ skillTypeId: 3327, level: 3 }] },
    ],
    skills: observedSkills,
  });
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[0].baseAttributes.intelligence, 27);
  assert.equal(result.sections[0].baseAttributes.memory, 21);
  assert.equal(result.sections[1].baseAttributes.perception, 27);
  assert.equal(result.sections[1].baseAttributes.willpower, 21);
  assert.equal(result.finalTrainedLevels[3426], 3);
  assert.equal(result.finalTrainedLevels[3327], 3);
  assert.equal(
    catalogBuilds,
    1,
    "the catalog should be normalized once, not once per allocation or section",
  );
});

test("service composition API reports normalized targets, totals, and queue comparison", () => {
  const result = eveSkills.analyzePlan({
    targets: [{ skillTypeId: 3330, targetLevel: 2 }],
    catalog: SKILLS,
    characterSkills: { 3327: { level: 3, skillpoints: 8_000 } },
    attributes: { intelligence: 17, memory: 17, perception: 27, willpower: 21, charisma: 17 },
    cloneMultiplier: 1,
    queue: [{ skillTypeId: 3330, targetLevel: 1, queuePosition: 0 }],
  });
  assert.deepEqual(result.targets.map((target) => target.skillTypeId), [3327, 3330]);
  assert.equal(result.targets[0].remainingSp, 0);
  assert.ok(result.targets[1].remainingSp > 0);
  assert.ok(result.trainingSeconds > 0);
  assert.equal(result.queueComparison.matched.length, 1);
});

test("plan analysis distinguishes level progress from partial target training", () => {
  const partial = eveSkills.analyzePlan({
    targets: [{ skillTypeId: 3426, targetLevel: 4 }],
    catalog: SKILLS,
    characterSkills: { 3426: { level: 3, skillpoints: 20_000 } },
  }).targets[0];
  assert.equal(partial.targetSp, 45_255);
  assert.equal(partial.remainingSp, 25_255);
  assert.equal(partial.partiallyTrained, true);
  assert.equal(partial.alreadyTrained, false);

  const onlyPriorLevels = eveSkills.analyzePlan({
    targets: [{ skillTypeId: 3426, targetLevel: 4 }],
    catalog: SKILLS,
    characterSkills: { 3426: { level: 3, skillpoints: 8_000 } },
  }).targets[0];
  assert.equal(onlyPriorLevels.partiallyTrained, false);
  assert.equal(onlyPriorLevels.alreadyTrained, false);

  const trained = eveSkills.analyzePlan({
    targets: [{ skillTypeId: 3426, targetLevel: 4 }],
    catalog: SKILLS,
    characterSkills: { 3426: { level: 4, skillpoints: 45_255 } },
  }).targets[0];
  assert.equal(trained.partiallyTrained, false);
  assert.equal(trained.alreadyTrained, true);
});
