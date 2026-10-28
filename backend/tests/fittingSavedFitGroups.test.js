const test = require("node:test");
const assert = require("node:assert/strict");
const { installExternalModuleFallbacks } = require("./helpers/moduleStubs");

installExternalModuleFallbacks();

const fittingRoute = require("../routes/fitting")._test;

test("saved fit group names are normalized and bounded", () => {
  assert.deepEqual(fittingRoute.validateSavedFitGroupBody({ name: "  Shield   Doctrine  " }), {
    name: "Shield Doctrine",
  });
  assert.deepEqual(fittingRoute.validateSavedFitGroupBody({ name: "   " }), {
    error: "group_name_required",
  });
  assert.equal(fittingRoute.validateSavedFitGroupBody({ name: "x".repeat(100) }).name.length, 80);
});

test("saved fit class tree remains grouped by ship and class", () => {
  const tree = fittingRoute.savedFitTree([
    { id: "fit-2", fitName: "Beta", shipTypeId: 2, shipName: "Raven", shipClass: "Battleship", groupName: "Battleship" },
    { id: "fit-1", fitName: "Alpha", shipTypeId: 2, shipName: "Raven", shipClass: "Battleship", groupName: "Battleship" },
    { id: "fit-3", fitName: "Links", shipTypeId: 3, shipName: "Claymore", shipClass: "Command Ship", groupName: "Command Ship" },
  ]);

  assert.deepEqual(tree.map((group) => group.shipClass), ["Battleship", "Command Ship"]);
  assert.deepEqual(tree[0].children[0].fits.map((fit) => fit.fitName), ["Alpha", "Beta"]);
});
