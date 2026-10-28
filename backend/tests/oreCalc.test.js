const test = require("node:test");
const assert = require("node:assert/strict");
const { installExternalModuleFallbacks } = require("./helpers/moduleStubs");

installExternalModuleFallbacks();

const crystals = require("../routes/data/mining_crystals.json");
const oreCalc = require("../routes/oreCalc")._test;

test("moon ore data covers every grade and rarity family", () => {
  assert.equal(oreCalc.moonOreRows.length, 60);

  const expectedRarities = ["R4", "R8", "R16", "R32", "R64"];
  for (const rarity of expectedRarities) {
    assert.equal(
      oreCalc.moonOreRows.filter((row) => row.rarity === rarity).length,
      12,
      `${rarity} should contain four ores with three grades each`
    );
  }

  const typeIds = new Set();
  for (const row of oreCalc.moonOreRows) {
    assert.ok(Number.isInteger(row.marketTypeId) && row.marketTypeId > 0);
    assert.ok(Number(row.m3) > 0);
    assert.ok(["I", "II", "III"].includes(row.grade));
    assert.ok(expectedRarities.includes(row.rarity));
    assert.equal(typeIds.has(row.marketTypeId), false, `duplicate type ID ${row.marketTypeId}`);
    typeIds.add(row.marketTypeId);
  }
});

test("crystal resource types preserve legacy asteroid values and identify moon crystals", () => {
  assert.deepEqual(oreCalc.compatibleResourceTypesForCrystal(""), ["ore", "moonOre"]);
  assert.deepEqual(
    oreCalc.compatibleResourceTypesForCrystal("Mining Crystal Type B II"),
    ["ore"]
  );
  assert.deepEqual(
    oreCalc.compatibleResourceTypesForCrystal("Moon Mining Crystal Type B II"),
    ["moonOre"]
  );
  assert.deepEqual(
    oreCalc.compatibleResourceTypesForCrystal("Unknown Saved Crystal"),
    ["ore", "moonOre"]
  );
});

test("asteroid and moon crystal profiles use the same throughput modifiers", () => {
  for (const grade of ["A I", "A II", "B I", "B II", "C I", "C II"]) {
    const asteroid = crystals[`Mining Crystal Type ${grade}`];
    const moon = crystals[`Moon Mining Crystal Type ${grade}`];
    assert.ok(asteroid);
    assert.ok(moon);
    assert.equal(asteroid.resourceType, "ore");
    assert.equal(moon.resourceType, "moonOre");
    assert.equal(moon.durationMult, asteroid.durationMult);
    assert.equal(moon.yieldMult, asteroid.yieldMult);
  }
});

test("resource rows retain missing prices as zero without dropping ores", () => {
  const rows = oreCalc.calculateResourceRows(
    oreCalc.moonOreRows.slice(0, 2),
    new Map([[62454, 123.45]]),
    3600
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].unitsPerHour, 360);
  assert.equal(rows[0].iskPerUnit, 123.45);
  assert.equal(rows[0].iskPerHour, 44442);
  assert.equal(rows[1].iskPerUnit, 0);
  assert.equal(rows[1].iskPerHour, 0);
  assert.equal(rows[1].rarity, "R4");
});
