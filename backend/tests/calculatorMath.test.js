const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateSiteISK,
  calculatePlayerShares,
  calculateBlueLootSplit,
} = require("./support/calculators/blueLootMath");
const {
  adjustedSiteISK,
  calculateParticipationPayout,
} = require("./support/calculators/participationMath");

test("blue loot site values handle dread bonus and missing drifter subtraction", () => {
  assert.equal(calculateSiteISK("Core Garrison", 2, true, true), 1_406_800_000);
  assert.equal(calculateSiteISK("Core Garrison", 2, true, false), 806_800_000);
  assert.equal(calculateSiteISK("Unsecured Frontier Server Bank", 1, false, false), 272_100_000);
  assert.equal(calculateSiteISK("Unknown Site", 99, true, true), 0);
});

test("blue loot player shares match both payout modes", () => {
  assert.deepEqual(calculatePlayerShares([
    { name: "A", dread: 2, marauders: 3, bubbler: true, extraShares: "0.25" },
    { name: "B", dread: 0, marauders: 1 },
  ], false), [
    { name: "A", shares: 7.75 },
    { name: "B", shares: 1.5 },
  ]);

  assert.deepEqual(calculatePlayerShares([
    { name: "Logi", dps: 0, logi: 3 },
    { name: "DPS", dps: 6, logi: 0 },
  ], true), [
    { name: "Logi", shares: 2.5 },
    { name: "DPS", shares: 3.75 },
  ]);
});

test("blue loot split applies broker, corp, and alliance taxes", () => {
  const result = calculateBlueLootSplit({
    siteRuns: [{ siteName: "Core Stronghold", count: 1, usedDread: true }],
    players: [
      { name: "Dread", dread: 1 },
      { name: "Marauder", marauders: 1 },
    ],
    accounting: 5,
    corpTax: 10,
    allianceTax: 5,
  });

  assert.equal(result.totalISK, 684_900_000);
  assert.equal(result.totalShares, 4);
  assert.equal(result.payoutPerShare, 171_225_000);
  assert.equal(result.taxRate, 5.1899999999999995);
  assert.deepEqual(result.payouts, [
    { name: "Dread", shares: 2.5, payout: 346_998_378 },
    { name: "Marauder", shares: 1.5, payout: 208_199_027 },
  ]);
});

test("participation site adjustment adds C5/C6 capital and drifter value", () => {
  assert.equal(adjustedSiteISK("C4", "Core Garrison", 100_000_000, true, true), 100_000_000);
  assert.equal(adjustedSiteISK("C5", "Core Garrison", 100_000_000, true, true), 550_000_000);
  assert.equal(adjustedSiteISK("C6", "Core Garrison", 100_000_000, true, true), 600_000_000);
  assert.equal(adjustedSiteISK("C6", "Core Garrison", 100_000_000, false, true), 200_000_000);
  assert.equal(adjustedSiteISK("C6", "Forgotten Core Assembly Hall", 100_000_000, true, true), 300_000_000);
});

test("participation payout splits each site by attendance before taxes", () => {
  const result = calculateParticipationPayout({
    siteTier: "C5",
    siteRows: [
      { site: "Core Garrison", blue_loot_isk: 353_400_000 },
      { site: "Forgotten Core Data Field", blue_loot_isk: 279_000_000 },
    ],
    siteTotals: {
      "Core Garrison": 2,
      "Forgotten Core Data Field": 1,
    },
    players: [
      { name: "A", participation: { "Core Garrison": 2, "Forgotten Core Data Field": 0 } },
      { name: "B", participation: { "Core Garrison": 1, "Forgotten Core Data Field": 1 } },
    ],
    usedDread: true,
    drifterRan: true,
    accounting: 5,
    corpTax: 0,
    allianceTax: 0,
  });

  assert.equal(result.totalISK, 2_035_800_000);
  assert.equal(result.brokerTaxAmount, 105_658_020);
  assert.deepEqual(result.payouts, [
    { name: "A", payout: 1_015_604_720 },
    { name: "B", payout: 914_537_260 },
  ]);
});
