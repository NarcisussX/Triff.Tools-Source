const test = require("node:test");
const assert = require("node:assert/strict");
const { installExternalModuleFallbacks } = require("./helpers/moduleStubs");

installExternalModuleFallbacks();
const monitor = require("../services/characterMonitor");
const monitorRouter = require("../routes/characterMonitor");
const fittingEsi = require("../services/fittingEsi");
const pool = require("../db/pool");
const planFormats = require("../domain/eveSkills/planFormats");
const migration = require("../db/migrations/2026080701_triffmon");

test("TriffMon validates public identifiers before storage access", () => {
  const helpers = monitor._test;
  assert.equal(helpers.characterId("90000001"), 90000001);
  assert.equal(helpers.characterId("1 OR 1=1"), null);
  assert.equal(helpers.typeId(34), 34);
  assert.equal(helpers.typeId(-1), null);
  assert.equal(helpers.uuid("7998ce44-44d7-4b07-b8ab-f0f7abef9f01"), "7998ce44-44d7-4b07-b8ab-f0f7abef9f01");
  assert.equal(helpers.uuid("not-a-plan"), null);
});

test("optimizer requests are bounded by supported remap and milestone limits", () => {
  assert.deepEqual(monitor._test.optimizerRequestLimits({ maxRemaps: 2 }), {
    maxRemaps: 2,
    maxSections: 3,
  });
  assert.equal(monitor._test.assertOptimizerMilestoneLimit(300), 300);
  assert.throws(
    () => monitor._test.optimizerRequestLimits({ maxRemaps: 3 }),
    (error) => error.code === "optimizer_section_limit"
      && error.status === 422
      && error.details.maximumSections === 3,
  );
  assert.throws(
    () => monitor._test.assertOptimizerMilestoneLimit(301),
    (error) => error.code === "optimizer_plan_too_large"
      && error.status === 413
      && error.details.maximumMilestones === 300,
  );
});

test("optimizer route cooldown is per user, reports retry time, and bounds its key cache", () => {
  const { consumeRateWindow, OPTIMIZER_WINDOW_MS } = monitorRouter._test;
  const requests = new Map();
  assert.equal(consumeRateWindow(requests, "user-1", OPTIMIZER_WINDOW_MS, 1_000, 2), 0);
  assert.equal(consumeRateWindow(requests, "user-1", OPTIMIZER_WINDOW_MS, 2_000, 2), 9_000);
  assert.equal(consumeRateWindow(requests, "user-2", OPTIMIZER_WINDOW_MS, 2_000, 2), 0);
  assert.equal(consumeRateWindow(requests, "user-3", OPTIMIZER_WINDOW_MS, 2_000, 2), 0);
  assert.equal(requests.size, 2);
  assert.equal(consumeRateWindow(requests, "user-1", OPTIMIZER_WINDOW_MS, 12_000, 2), 0);
});

test("TriffMon plan rows keep one highest desired target per skill", () => {
  const rows = monitor._test.normalizePlanEntries([
    { skillTypeId: 3413, targetLevel: 3, position: 0, notes: "first" },
    { skillTypeId: 3436, targetLevel: 5, position: 1 },
    { skillTypeId: 3413, targetLevel: 5, position: 2, autoAdded: true },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.skillTypeId, row.targetLevel]), [[3413, 5], [3436, 5]]);
  assert.equal(rows[0].explicit, true, "an explicit request wins over a duplicate prerequisite row");
  assert.equal(rows[0].position, 0);
});

test("unassigned plans use a legal balanced attribute map at the conservative rate", async () => {
  const context = await monitor._test.trainingContext("user-17", null);
  assert.deepEqual(context.attributes, {
    intelligence: 20,
    memory: 20,
    perception: 20,
    willpower: 20,
    charisma: 19,
  });
  assert.deepEqual(context.baseAttributes, context.attributes);
  assert.equal(Object.values(context.attributes).reduce((sum, value) => sum + value, 0), 99);
  assert.equal(context.cloneMultiplier, 0.5);
});

test("training attributes separate active implant bonuses while preserving ESI effective values", () => {
  const base = { charisma: 19, intelligence: 20, memory: 20, perception: 20, willpower: 20 };
  const implants = [{ bonuses: { intelligence: 4, memory: 3 } }];
  const effective = { ...base, intelligence: 24, memory: 23 };
  const context = monitor._test.trainingAttributeContext({ attributes: { attributes: effective } }, implants);
  assert.deepEqual(context.baseAttributes, base);
  assert.deepEqual(context.implantBonuses, {
    charisma: 0,
    intelligence: 4,
    memory: 3,
    perception: 0,
    willpower: 0,
  });
  assert.deepEqual(context.effectiveAttributes, effective);
  assert.deepEqual(context.trainingAttributes, effective);
  assert.equal(context.esiIncludedImplants, true);
  assert.equal(context.temporaryBonus, 0);
});

test("Genius accelerator is inferred without discarding boosted training attributes", () => {
  const boosted = { charisma: 29, intelligence: 36, memory: 36, perception: 29, willpower: 29 };
  const context = monitor._test.trainingAttributeContext({ attributes: { attributes: boosted } }, []);
  assert.deepEqual(context.baseAttributes, {
    charisma: 17,
    intelligence: 24,
    memory: 24,
    perception: 17,
    willpower: 17,
  });
  assert.deepEqual(context.effectiveAttributes, boosted);
  assert.deepEqual(context.trainingAttributes, {
    charisma: 17,
    intelligence: 24,
    memory: 24,
    perception: 17,
    willpower: 17,
  });
  assert.equal(context.temporaryBonus, 12);
  assert.match(context.optimizerWarning, /\+12 temporary accelerator/);
  assert.match(context.optimizerWarning, /estimates exclude it/);
});

test("clone state inference identifies active training above the Alpha SP ceiling as Omega", () => {
  assert.deepEqual(monitor._test.cloneStateContext({
    snapshot: { cloneState: "unknown" },
    state: { 3413: { level: 5, activeLevel: 5 } },
    activeTraining: { skillTypeId: 3413 },
    totalSp: 5_000_001,
  }), { cloneState: "omega", inferred: true });

  assert.deepEqual(monitor._test.cloneStateContext({
    state: { 3413: { level: 5, activeLevel: 4 } },
    activeTraining: { skillTypeId: 3413 },
    totalSp: 100_000_000,
  }), { cloneState: "alpha", inferred: true });

  assert.deepEqual(monitor._test.cloneStateContext({
    state: { 3413: { level: 5, activeLevel: 5 } },
    activeTraining: null,
    totalSp: 100_000_000,
  }), { cloneState: "unknown", inferred: false });
});

test("implant status distinguishes an empty active clone from missing authorization", () => {
  const successfulEmpty = monitor._test.implantDataStatus({
    implants: { implants: [], items: [] },
    freshness: {
      implants: {
        available: true,
        fetchedAt: "2026-08-07T22:45:57.000Z",
        isStale: false,
        lastError: null,
      },
    },
  }, []);
  assert.deepEqual(successfulEmpty, {
    available: true,
    missingScope: false,
    fetchedAt: "2026-08-07T22:45:57.000Z",
    stale: false,
    error: null,
  });

  const missingScope = monitor._test.implantDataStatus({}, ["esi-clones.read_implants.v1"]);
  assert.equal(missingScope.available, false);
  assert.equal(missingScope.missingScope, true);
});

test("clone status independently reports jump-clone authorization and freshness", () => {
  const available = monitor._test.cloneDataStatus({
    clones: { jumpClones: [] },
    freshness: {
      clones: {
        available: true,
        fetchedAt: "2026-08-07T22:45:57.000Z",
        isStale: false,
        lastError: null,
      },
    },
  }, []);
  assert.deepEqual(available, {
    available: true,
    missingScope: false,
    fetchedAt: "2026-08-07T22:45:57.000Z",
    stale: false,
    error: null,
  });

  const missing = monitor._test.cloneDataStatus({}, ["esi-clones.read_clones.v1"]);
  assert.equal(missing.available, false);
  assert.equal(missing.missingScope, true);
});

test("active and jump-clone implants are enriched separately from the SDE", async (t) => {
  const originalQuery = pool.query;
  pool.query = async (_sql, params) => {
    assert.deepEqual(params[0], [10208, 10209, 10210]);
    return {
      rows: [
        { type_id: 10208, type_name: "Active Intelligence Implant", attribute_id: 176, value: 4 },
        { type_id: 10208, type_name: "Active Intelligence Implant", attribute_id: 331, value: 1 },
        { type_id: 10209, type_name: "Stored Memory Implant", attribute_id: 177, value: 3 },
        { type_id: 10209, type_name: "Stored Memory Implant", attribute_id: 331, value: 2 },
        { type_id: 10210, type_name: "Stored Utility Implant", attribute_id: null, value: null },
      ],
    };
  };
  t.after(() => { pool.query = originalQuery; });

  const clones = await monitor._test.cloneImplantDetails({
    implants: { implants: [10208] },
    clones: {
      homeLocation: { locationId: 60003760, locationType: "station" },
      jumpClones: [{
        jumpCloneId: 77,
        name: "Learning clone",
        locationId: 60008494,
        locationType: "station",
        implants: [10209, 10210],
      }],
      lastCloneJumpDate: "2026-08-07T20:00:00Z",
    },
  });

  assert.equal(clones.activeClone.implantCount, 1);
  assert.equal(clones.activeClone.implants[0].name, "Active Intelligence Implant");
  assert.deepEqual(clones.activeClone.implants[0].bonuses, { intelligence: 4 });
  assert.equal(clones.jumpClones[0].jumpCloneId, 77);
  assert.equal(clones.jumpClones[0].implantCount, 2);
  assert.equal(clones.jumpClones[0].implants[0].name, "Stored Memory Implant");
  assert.deepEqual(clones.jumpClones[0].implants[0].bonuses, { memory: 3 });
  assert.equal(clones.jumpClones[0].implants[1].name, "Stored Utility Implant");
  assert.deepEqual(clones.homeLocation, { locationId: 60003760, locationType: "station" });
  assert.equal(clones.lastCloneJumpDate, "2026-08-07T20:00:00.000Z");
});

test("queue reconciliation interpolates active SP and advances just-completed skills", () => {
  const now = Date.parse("2026-08-07T12:00:00.000Z");
  const result = monitor._test.reconcileSkillContext({
    1001: { level: 2, activeLevel: 2, skillpoints: 100 },
    1002: { level: 5, activeLevel: 4, skillpoints: 256000 },
  }, [
    {
      skillTypeId: 1001,
      targetLevel: 3,
      startSp: 100,
      endSp: 300,
      startAt: "2026-08-07T11:59:00.000Z",
      endAt: "2026-08-07T12:01:00.000Z",
      queuePosition: 0,
    },
    {
      skillTypeId: 1003,
      targetLevel: 1,
      startSp: 0,
      endSp: 250,
      startAt: "2026-08-07T11:57:00.000Z",
      endAt: "2026-08-07T11:59:00.000Z",
      queuePosition: 1,
    },
    {
      skillTypeId: 1002,
      targetLevel: 5,
      startSp: 200000,
      endSp: 256000,
      startAt: "2026-08-07T11:55:00.000Z",
      endAt: "2026-08-07T11:58:00.000Z",
      queuePosition: 2,
    },
  ], now);

  assert.equal(result.state[1001].skillpoints, 200);
  assert.equal(result.state[1001].trainingToLevel, 3);
  assert.equal(result.state[1003].level, 1);
  assert.equal(result.state[1003].activeLevel, 1);
  assert.equal(result.state[1003].skillpoints, 250);
  assert.equal(result.state[1002].activeLevel, 4, "queue data must not erase an explicit Alpha active-level cap");
});

test("readiness uses active level while retaining trained level", () => {
  const alphaRestricted = { level: 5, activeLevel: 4, skillpoints: 256000 };
  assert.equal(monitor._test.trainedSkillLevel(alphaRestricted), 5);
  assert.equal(monitor._test.activeSkillLevel(alphaRestricted), 4);
  assert.equal(monitor._test.requirementIsMissing(alphaRestricted, 5, 0), true);
  assert.equal(monitor._test.requirementIsMissing({ level: 5, activeLevel: 5 }, 5, 0), false);
});

test("current-training summaries are enriched with the SDE skill name", () => {
  const byId = new Map([[3413, { skillName: "Power Grid Management" }]]);
  const training = monitor._test.enrichCurrentTraining({
    skill_id: 3413,
    finished_level: 5,
    queue_position: 0,
    start_date: "2026-08-07T11:00:00.000Z",
    finish_date: "2026-08-07T13:00:00.000Z",
  }, byId);
  assert.equal(training.skillTypeId, 3413);
  assert.equal(training.skillName, "Power Grid Management");
  assert.equal(training.targetLevel, 5);
});

test("stale character list refreshes are deferred, cache-respecting, and throttled", async () => {
  const original = fittingEsi.refreshCharacterMonitor;
  const calls = [];
  fittingEsi.refreshCharacterMonitor = async (...args) => { calls.push(args); };
  try {
    const characters = [
      { characterId: 91000001, stale: true, missingScopes: [], tokenStatus: "ok" },
      { characterId: 91000002, stale: true, missingScopes: ["esi-skills.read_skills.v1"], tokenStatus: "missing_scopes" },
      { characterId: 91000003, stale: false, missingScopes: [], tokenStatus: "ok" },
    ];
    monitor._test.scheduleStaleCharacterRefresh("background-user", characters);
    assert.equal(calls.length, 0, "list rendering must not block on ESI refresh");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, [["background-user", 91000001, { force: false }]]);

    monitor._test.scheduleStaleCharacterRefresh("background-user", characters);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1, "the local throttle suppresses repeated dashboard refreshes");
  } finally {
    fittingEsi.refreshCharacterMonitor = original;
  }
});

test("plan lookup is always scoped by the authenticated site user", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  await monitor._test.planRows("user-17", "7998ce44-44d7-4b07-b8ab-f0f7abef9f01", client);
  assert.match(calls[0].sql, /WHERE p\.user_id = \$1\s+AND p\.id = \$2/);
  assert.deepEqual(calls[0].params, ["user-17", "7998ce44-44d7-4b07-b8ab-f0f7abef9f01"]);
});

test("character assignment rejects a character not owned by the site user", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 0, rows: [] };
    },
  };
  await assert.rejects(
    monitor._test.assertOwnedCharacter(client, "user-17", 90000001),
    (error) => error.code === "character_not_found" && error.status === 404,
  );
  assert.match(calls[0].sql, /user_id = \$1 AND character_id = \$2/);
  assert.deepEqual(calls[0].params, ["user-17", 90000001]);
});

test("legacy migration input clamps levels and rejects malformed IDs", () => {
  assert.equal(migration._test.cleanSkillId("3413"), 3413);
  assert.equal(migration._test.cleanSkillId("drop table"), null);
  assert.equal(migration._test.cleanLevel(99), 5);
  assert.equal(migration._test.cleanLevel(0), 1);
});

test("plan section reconciliation retains stable IDs and rich metadata", () => {
  const helpers = monitor._test;
  const sectionId = "8cc58582-ff9d-4b12-986f-56adbed20bf0";
  const entries = helpers.normalizePlanEntries([{
    skillTypeId: 3413,
    targetLevel: 4,
    sectionId,
    section: "Intelligence remap",
    sourceType: "legacy_explicit",
    sourceMetadata: { originalIndex: 7 },
    notes: "keep entry metadata",
  }]);
  const sections = [{
    id: sectionId,
    title: "Intelligence remap",
    position: 0,
    notes: "remap after Cybernetics",
    remap_attributes: { intelligence: 27, memory: 21 },
    settings: { implantSetId: "legacy-set" },
  }];
  const reconciled = helpers.reconcilePlanSections(entries, undefined, sections, () => {
    throw new Error("a stable section should not need a new ID");
  });

  assert.equal(reconciled.entries[0].sectionId, sectionId);
  assert.deepEqual(reconciled.sections[0], {
    id: sectionId,
    title: "Intelligence remap",
    position: 0,
    notes: "remap after Cybernetics",
    remapAttributes: { intelligence: 27, memory: 21 },
    settings: { implantSetId: "legacy-set" },
  });
  assert.equal(entries[0].sourceType, "legacy_explicit");
  assert.deepEqual(entries[0].sourceMetadata, { originalIndex: 7 });
});

test("entry replacement preserves stored provenance when an older client omits it", () => {
  const entry = monitor._test.normalizePlanEntries([{ skillTypeId: 3413, targetLevel: 5, section: "Core" }])[0];
  const retained = monitor._test.retainedPlanEntryValues(entry, {
    is_explicit: false,
    source_type: "legacy_prerequisite",
    source_metadata: { originalIndex: 3, chainId: "abc" },
    notes: "legacy note",
  });
  assert.deepEqual(retained, {
    explicit: false,
    sourceType: "legacy_prerequisite",
    sourceMetadata: { originalIndex: 3, chainId: "abc" },
    notes: "legacy note",
  });
});

test("plan format failures become explicit client-facing service statuses", () => {
  const invalid = monitor._test.planFormatServiceError(
    new planFormats.PlanFormatError("Invalid plan JSON", "INVALID_JSON"),
    "import",
  );
  assert.equal(invalid.status, 422);
  assert.equal(invalid.code, "plan_import_invalid");
  assert.deepEqual(invalid.details, { formatCode: "INVALID_JSON" });

  const unsupported = monitor._test.planFormatServiceError(
    new planFormats.PlanFormatError("Unsupported export format yaml", "UNSUPPORTED_EXPORT_FORMAT"),
    "export",
  );
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.code, "plan_export_unsupported_format");
});

test("requirement coverage separates clone-limited skills from trainable time buckets", () => {
  const summary = monitor._test.summarizeRequirementCoverage([
    { canUse: true, inactiveDueToCloneState: false, trainingSeconds: 0 },
    { canUse: false, inactiveDueToCloneState: false, trainingSeconds: 3_600 },
    { canUse: false, inactiveDueToCloneState: false, trainingSeconds: 8 * 86_400 },
    { canUse: false, inactiveDueToCloneState: true, trainingSeconds: 0 },
    { canUse: false, inactiveDueToCloneState: false, trainingSeconds: null },
  ]);
  assert.deepEqual(summary, {
    selectedCount: 5,
    readyCount: 1,
    underOneDayCount: 1,
    overSevenDaysCount: 1,
    inactiveCloneCount: 1,
  });
});
