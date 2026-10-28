const test = require("node:test");
const assert = require("node:assert/strict");
const { installExternalModuleFallbacks } = require("./helpers/moduleStubs");

installExternalModuleFallbacks();

const { P0_PLANET_AVAILABILITY } = require("../routes/piCalc")._test;

const EXPECTED_P0_PLANET_AVAILABILITY = {
  "Aqueous Liquids": ["Barren", "Gas", "Ice", "Oceanic", "Storm", "Temperate"],
  Autotrophs: ["Temperate"],
  "Base Metals": ["Barren", "Gas", "Lava", "Plasma", "Storm"],
  "Carbon Compounds": ["Barren", "Oceanic", "Temperate"],
  "Complex Organisms": ["Oceanic", "Temperate"],
  "Felsic Magma": ["Lava"],
  "Heavy Metals": ["Ice", "Lava", "Plasma"],
  "Ionic Solutions": ["Gas", "Storm"],
  "Micro Organisms": ["Barren", "Ice", "Oceanic", "Temperate"],
  "Noble Gas": ["Gas", "Ice", "Storm"],
  "Noble Metals": ["Barren", "Plasma"],
  "Non-CS Crystals": ["Lava", "Plasma"],
  "Planktic Colonies": ["Ice", "Oceanic"],
  "Reactive Gas": ["Gas"],
  "Suspended Plasma": ["Lava", "Plasma", "Storm"],
};

test("PI raw resource planet availability includes the corrected memberships", () => {
  assert.equal(P0_PLANET_AVAILABILITY.Autotrophs.includes("Barren"), false);
  assert.equal(P0_PLANET_AVAILABILITY.Autotrophs.includes("Temperate"), true);
  assert.equal(P0_PLANET_AVAILABILITY["Base Metals"].includes("Ice"), false);
  assert.equal(P0_PLANET_AVAILABILITY["Noble Gas"].includes("Ice"), true);
});

test("PI raw resource planet availability matches the complete intended matrix", () => {
  assert.deepEqual(P0_PLANET_AVAILABILITY, EXPECTED_P0_PLANET_AVAILABILITY);
});
