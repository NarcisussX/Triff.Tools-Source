const test = require("node:test");
const assert = require("node:assert/strict");

const { expandIndustryDemand, normalizeStock } = require("../lib/industryGraph");

const NAMES = {
  100: "Final Hull",
  101: "Second Hull",
  200: "Component Hull",
  300: "Raw Material",
};

function buildRoute(outputTypeId, productQtyPerRun, materials) {
  return {
    route: {
      kind: "build",
      activity: "manufacturing",
      blueprintId: outputTypeId + 10_000,
      productTypeId: outputTypeId,
      productQtyPerRun,
      materials: materials.map(([typeId, baseQty]) => ({
        typeId,
        baseQty,
        materialModifier: 1,
      })),
    },
  };
}

function makeContext(entries) {
  return {
    settings: { inputPriceMode: "sell" },
    memo: new Map(Object.entries(entries).map(([typeId, entry]) => [Number(typeId), entry])),
    batchByType: new Map(),
  };
}

function plan(goals, entries, stock = {}) {
  return expandIndustryDemand(goals, makeContext(entries), stock, {
    typeNameFor: (typeId) => NAMES[typeId] || `Type ${typeId}`,
    inputUnitPriceFor: () => 0,
  });
}

function jobFor(result, outputTypeId) {
  return Array.from(result.jobsMap.values()).find((job) => job.outputTypeId === outputTypeId);
}

test("industry inventory normalizes positive whole quantities", () => {
  assert.deepEqual(
    Array.from(normalizeStock({ 200: "10.9", 300: -2, nope: 5, 400: 0 }).entries()),
    [[200, 10]],
  );
});

test("16 required hulls with 10 owned components leave 6 component runs", () => {
  const result = plan(
    [{ typeId: 100, quantity: 16 }],
    {
      100: buildRoute(100, 1, [[200, 1]]),
      200: buildRoute(200, 1, [[300, 5]]),
    },
    { 200: 10 },
  );

  assert.equal(jobFor(result, 100).runs, 16);
  assert.equal(jobFor(result, 100).materials.get(200), 16);
  assert.equal(jobFor(result, 200).runs, 6);
  assert.equal(jobFor(result, 200).materials.get(300), 30);
  assert.equal(result.bomMap.get(300), 30);
  assert.deepEqual(result.stockUsage, [{
    typeId: 200,
    typeName: "Component Hull",
    available: 10,
    applied: 10,
    unused: 0,
  }]);
});

test("plans without stock retain the original run expansion and tree labels", () => {
  const result = plan(
    [{ typeId: 100, quantity: 16 }],
    {
      100: buildRoute(100, 1, [[200, 1]]),
      200: buildRoute(200, 1, [[300, 5]]),
    },
  );

  assert.equal(jobFor(result, 200).runs, 16);
  assert.equal(result.bomMap.get(300), 80);
  assert.equal(result.tree[0].label, "Build 16 x Final Hull via BP 10100 (16 runs)");
  assert.deepEqual(result.stockUsage, []);
});

test("fully stocked jobs disappear from required work while unused inventory is reported", () => {
  const result = plan(
    [{ typeId: 100, quantity: 16 }],
    {
      100: buildRoute(100, 1, [[200, 1]]),
      200: buildRoute(200, 1, [[300, 5]]),
    },
    { 200: 20 },
  );

  assert.equal(jobFor(result, 200), undefined);
  assert.equal(result.bomMap.size, 0);
  assert.match(result.tree[0].children[0].label, /Use 16 x Component Hull from stock/);
  assert.equal(result.stockUsage[0].unused, 4);
});

test("remaining demand is rounded by output per run after stock is consumed", () => {
  const result = plan(
    [{ typeId: 200, quantity: 11 }],
    { 200: buildRoute(200, 5, [[300, 2]]) },
    { 200: 7 },
  );

  assert.equal(jobFor(result, 200).runs, 1);
  assert.equal(jobFor(result, 200).materials.get(300), 2);
  assert.equal(result.bomMap.get(300), 2);
});

test("stock at multiple levels is consumed once without double-deducting", () => {
  const result = plan(
    [{ typeId: 100, quantity: 16 }],
    {
      100: buildRoute(100, 1, [[200, 1]]),
      200: buildRoute(200, 1, [[300, 5]]),
    },
    { 100: 4, 200: 10, 300: 7 },
  );

  assert.equal(jobFor(result, 100).runs, 12);
  assert.equal(jobFor(result, 200).runs, 2);
  assert.equal(result.bomMap.get(300), 3);
  assert.deepEqual(result.stockUsage.map(({ typeId, applied, unused }) => ({ typeId, applied, unused })), [
    { typeId: 100, applied: 4, unused: 0 },
    { typeId: 200, applied: 10, unused: 0 },
    { typeId: 300, applied: 7, unused: 0 },
  ]);
});

test("shared component stock is allocated globally across multiple goals", () => {
  const result = plan(
    [
      { typeId: 100, quantity: 8 },
      { typeId: 101, quantity: 8 },
    ],
    {
      100: buildRoute(100, 1, [[200, 1]]),
      101: buildRoute(101, 1, [[200, 1]]),
      200: buildRoute(200, 1, [[300, 5]]),
    },
    { 200: 10 },
  );

  assert.equal(jobFor(result, 200).runs, 6);
  assert.equal(result.bomMap.get(300), 30);
  assert.equal(result.stockUsage[0].applied, 10);
});
