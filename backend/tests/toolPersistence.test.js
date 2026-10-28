const test = require("node:test");
const assert = require("node:assert/strict");
const { installExternalModuleFallbacks } = require("./helpers/moduleStubs");

installExternalModuleFallbacks();
const toolSetups = require("../routes/toolSetups")._test;
const toolState = require("../routes/toolState")._test;

test("tool setup keys and ids are normalized before route handlers touch storage", () => {
  assert.equal(toolSetups.cleanToolKey("  Gas-Calc  "), "gas-calc");
  assert.equal(toolSetups.cleanToolKey("a1"), "a1");
  assert.equal(toolSetups.cleanToolKey("a"), null);
  assert.equal(toolSetups.cleanToolKey("bad_key"), null);
  assert.equal(toolSetups.cleanToolKey(`a${"b".repeat(63)}`), `a${"b".repeat(63)}`);
  assert.equal(toolSetups.cleanToolKey(`a${"b".repeat(64)}`), null);

  assert.equal(
    toolSetups.cleanUuid("123e4567-e89b-42d3-a456-426614174000"),
    "123e4567-e89b-42d3-a456-426614174000"
  );
  assert.equal(toolSetups.cleanUuid("not-a-uuid"), null);
});

test("saved setup body validation keeps only object payloads", () => {
  const valid = toolSetups.validateSetupBody({
    setupName: `  ${"Saved Chain ".repeat(20)}  `,
    setupJson: { version: 1, value: true },
    summaryJson: ["not", "an", "object"],
  });

  assert.equal(valid.setupName.length, 160);
  assert.deepEqual(valid.setupJson, { version: 1, value: true });
  assert.deepEqual(valid.summaryJson, {});

  assert.equal(toolSetups.validateSetupBody({ setupJson: { ok: true } }).error, "setup_name_required");
  assert.equal(toolSetups.validateSetupBody({ setupName: "No Payload" }).error, "setup_json_required");
  assert.equal(toolSetups.validateSetupBody({ setupName: "Array", setupJson: [] }).error, "setup_json_required");
});

test("setup records omit large JSON unless explicitly requested", () => {
  const row = {
    id: "123e4567-e89b-42d3-a456-426614174000",
    tool_key: "industry-cost",
    setup_name: "Paladin Chain",
    setup_json: { expensive: true },
    summary_json: null,
    created_at: "2026-05-21T00:00:00.000Z",
    updated_at: "2026-05-21T00:01:00.000Z",
    last_opened_at: null,
  };

  assert.equal("setupJson" in toolSetups.setupRecord(row), false);
  assert.deepEqual(toolSetups.setupRecord(row, true), {
    id: row.id,
    toolKey: "industry-cost",
    setupName: "Paladin Chain",
    summaryJson: {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: null,
    setupJson: { expensive: true },
  });
});

test("remembered tool state uses the same key and object constraints", () => {
  assert.equal(toolState.cleanToolKey(" Market-Browser-Quickbar "), "market-browser-quickbar");
  assert.equal(toolState.cleanToolKey("bad key"), null);
  assert.deepEqual(toolState.objectOrNull({ quickbar: [] }), { quickbar: [] });
  assert.equal(toolState.objectOrNull([]), null);
  assert.equal(toolState.objectOrNull(null), null);

  assert.deepEqual(toolState.stateRecord({
    tool_key: "market-browser-quickbar",
    state_json: null,
    created_at: "2026-05-21T00:00:00.000Z",
    updated_at: "2026-05-21T00:01:00.000Z",
  }), {
    toolKey: "market-browser-quickbar",
    stateJson: {},
    createdAt: "2026-05-21T00:00:00.000Z",
    updatedAt: "2026-05-21T00:01:00.000Z",
  });
});
