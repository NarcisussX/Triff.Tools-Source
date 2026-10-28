const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("yaml");

const specPath = path.join(__dirname, "..", "docs", "TriffTools-OpenAPI.yaml");

function readSpec() {
  return yaml.parse(fs.readFileSync(specPath, "utf8"));
}

const EXPECTED_PUBLIC_PATHS = [
  "/hulls/activity",
  "/hulls/regions",
  "/industry/plan",
  "/gas-calc",
  "/ore-calc",
  "/ore-prices",
  "/ore-planner/ores",
  "/ore-planner/plan",
  "/prices/station",
  "/market/quote",
  "/market/history/batch",
  "/fitting/shared-fits",
  "/fitting/rolling-stats",
  "/fitting/combat-profile",
  "/types/resolve",
];

test("OpenAPI keeps the intentional public API surface explicit", () => {
  const spec = readSpec();
  assert.deepEqual(Object.keys(spec.paths).sort(), [...EXPECTED_PUBLIC_PATHS].sort());
});

test("every documented operation has basics needed by third-party users", () => {
  const spec = readSpec();
  for (const [apiPath, operations] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      assert.ok(operation.summary, `${method.toUpperCase()} ${apiPath} needs a summary`);
      assert.ok(operation.tags?.length, `${method.toUpperCase()} ${apiPath} needs tags`);
      assert.ok(operation.responses?.["200"] || operation.responses?.["201"], `${method.toUpperCase()} ${apiPath} needs a success response`);
    }
  }
});

test("industry plan API documents the live items/options payload shape", () => {
  const spec = readSpec();
  const operation = spec.paths["/industry/plan"].post;
  const requestSchema =
    operation.requestBody.content["application/json"].schema;
  const request = spec.components.schemas.IndustryPlanRequest;
  const response = spec.components.schemas.IndustryPlanResponse;

  assert.deepEqual(requestSchema, { $ref: "#/components/schemas/IndustryPlanRequest" });
  assert.deepEqual(request.required, ["items"]);
  assert.equal(request.properties.items.items.$ref, "#/components/schemas/IndustryPlanItem");
  assert.equal(request.properties.options.$ref, "#/components/schemas/IndustryPlanOptions");
  assert.equal(spec.components.schemas.IndustryPlanOptions.properties.stock.type, "object");
  assert.equal(request.properties.goals, undefined);
  assert.equal(request.properties.settings, undefined);
  assert.equal(response.properties.bom.items.$ref, "#/components/schemas/IndustryBomItem");
  assert.equal(response.properties.jobs.items.$ref, "#/components/schemas/IndustryJob");
  assert.equal(response.properties.tree.items.$ref, "#/components/schemas/IndustryTreeNode");
  assert.equal(response.properties.stockUsage.items.$ref, "#/components/schemas/IndustryStockUsage");
});

test("fitting share-link API documents the pyfa/eos boundary and raw EFT input", () => {
  const spec = readSpec();
  const createShare = spec.paths["/fitting/shared-fits"].post;
  const requestContent = createShare.requestBody.content;

  assert.match(createShare.description, /pyfa\/eos/i);
  assert.match(createShare.description, /Authentication is not required/i);
  assert.ok(requestContent["application/json"], "JSON EFT payload should be documented");
  assert.ok(requestContent["text/plain"], "Raw EFT text/plain payload should be documented");
  assert.equal(createShare.responses["201"].description, "Share link created");
  assert.equal(createShare.responses["200"].description, "Existing share link returned for duplicate EFT text");
});

test("fitting rolling-stats API documents pyfa/eos scenarios and rate limit", () => {
  const spec = readSpec();
  const operation = spec.paths["/fitting/rolling-stats"].post;
  const requestSchema = operation.requestBody.content["application/json"].schema;
  const responseSchema = operation.responses["200"].content["application/json"].schema;
  const request = spec.components.schemas.FittingRollingStatsRequest;
  const response = spec.components.schemas.FittingRollingStatsResponse;

  assert.deepEqual(requestSchema, { $ref: "#/components/schemas/FittingRollingStatsRequest" });
  assert.deepEqual(responseSchema, { $ref: "#/components/schemas/FittingRollingStatsResponse" });
  assert.match(operation.description, /pyfa\/eos/i);
  assert.match(operation.description, /All V skills/i);
  assert.match(operation.description, /Rate limit defaults to 20 requests\/minute/i);
  assert.ok(request.properties.eft);
  assert.ok(request.properties.eftText);
  assert.ok(request.properties.text);
  assert.ok(response.properties.summary.oneOf);
  assert.ok(spec.components.schemas.FittingRollingStatsScenario.properties.alignTimeSeconds);
  assert.ok(spec.components.schemas.FittingRollingStatsScenario.properties.agility);
});

test("combat-profile documents a separate versioned raw-data contract", () => {
  const spec = readSpec();
  const operation = spec.paths["/fitting/combat-profile"].post;
  assert.match(operation.description, /pyfa\/eos/i);
  assert.match(operation.description, /Authentication is not required/i);
  assert.match(operation.description, /20 requests\/minute/i);
  assert.equal(operation.requestBody.content["application/json"].schema.$ref, "#/components/schemas/FittingCombatProfileRequest");
  for (const status of [200, 400, 422, 429, 502]) assert.ok(operation.responses[String(status)]);
  const response = spec.components.schemas.FittingCombatProfileResponse;
  assert.equal(response.properties.combatProfileSchemaVersion.const, "1.1.0");
  const module = spec.components.schemas.FittingCombatModule;
  for (const field of ["cycleTimeMs", "reloadTimeMs", "capacitorCostGj", "remoteRepairEvents", "damage", "application", "commandBurst", "spool", "heat"]) assert.ok(module.properties[field]);
  const movement = spec.components.schemas.FittingCombatProfile.properties.movement;
  const missile = module.properties.application.properties.missile;
  const drone = spec.components.schemas.FittingCombatDrone;
  const booster = spec.components.schemas.FittingCombatCapacitorBooster;
  assert.equal(module.properties.capacitorBooster.$ref, "#/components/schemas/FittingCombatCapacitorBooster");
  assert.equal(module.required.includes("capacitorBooster"), false, "The additive mechanic must remain optional");
  assert.deepEqual(booster.type, ["object", "null"]);
  assert.deepEqual(booster.required, ["capacitorGainGj", "chargeTypeId", "chargeName", "cycleTimeMs", "reloadTimeMs", "magazineCapacity", "chargeConsumptionPerActivation", "loadedCharges", "spareCharges"]);
  assert.ok(movement.required.includes("maxVelocityMps"));
  for (const field of ["maxVelocityMps", "explosionVelocityMps", "flightTimeMs"]) assert.ok(missile.required.includes(field));
  for (const field of ["maxVelocityMps", "orbitVelocityMps"]) assert.ok(drone.required.includes(field));
  const combatSchemas = Object.fromEntries(Object.entries(spec.components.schemas).filter(([name]) => name.startsWith("FittingCombat")));
  assert.doesNotMatch(JSON.stringify(combatSchemas), /[Vv]elocityMs/);
  const fixtureDir = path.join(__dirname, "..", "..", "fitting-service", "tests", "fixtures", "combat_profiles");
  for (const filename of fs.readdirSync(fixtureDir).filter((name) => name.endsWith(".json"))) {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, filename), "utf8"));
    assert.equal(fixture.combatProfileSchemaVersion, "1.1.0");
    assert.equal(fixture.profile.combatProfileSchemaVersion, "1.1.0");
    for (const field of response.required) assert.ok(Object.hasOwn(fixture, field), `${filename} envelope missing ${field}`);
    for (const field of spec.components.schemas.FittingCombatProfile.required) assert.ok(Object.hasOwn(fixture.profile, field), `${filename} profile missing ${field}`);
    assert.doesNotMatch(JSON.stringify(fixture), /"[^"]*[Vv]elocityMs"/);
    for (const field of movement.required) assert.ok(Object.hasOwn(fixture.profile.movement, field), `${filename} movement missing ${field}`);
    for (const row of fixture.profile.modules) {
      for (const field of module.required) assert.ok(Object.hasOwn(row, field), `${filename} module missing ${field}`);
      if (row.capacitorBooster) {
        assert.equal(row.groupId, 76);
        for (const field of booster.required) assert.ok(Object.hasOwn(row.capacitorBooster, field), `${filename} capacitor booster missing ${field}`);
      } else {
        assert.notEqual(row.groupId, 76, `${filename} capacitor booster missing mechanic`);
      }
      if (row.application?.missile) {
        for (const field of missile.required) assert.ok(Object.hasOwn(row.application.missile, field), `${filename} missile missing ${field}`);
      }
    }
    for (const row of fixture.profile.drones) {
      for (const field of drone.required) assert.ok(Object.hasOwn(row, field), `${filename} drone missing ${field}`);
    }
  }
});
