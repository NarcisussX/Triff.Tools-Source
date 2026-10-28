/*
 * Express router for participation Calc API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const router = express.Router();

function calculateSiteISK(siteName, baseISK, usedDread, drifterRan) {
  if (!["Core Garrison", "Core Stronghold", "Oruze Osobnyk", "Quarantine Area",
    "Core Bastion", "Core Citadel", "Strange Energy Readings", "The Mirror"].includes(siteName)) {
    return baseISK;
  }

  if (!drifterRan) {
    baseISK -= usedDread ? 300_000_000 : 100_000_000;
  }

  return baseISK;
}

const drifterCombatSites = [
  "Core Garrison", "Core Stronghold", "Oruze Osobnyk", "Quarantine Area",
  "Core Bastion", "Core Citadel", "Strange Energy Readings", "The Mirror",
];

function adjustedSiteISK(siteTier, siteName, baseISK, usedDread, drifterRan) {

  if (siteTier !== "C5" && siteTier !== "C6") return baseISK;

  let out = baseISK;

  if (usedDread) {
    out += siteTier === "C5" ? 150_000_000 : 200_000_000;
  }

  if (drifterRan && drifterCombatSites.includes(siteName)) {

    out += usedDread ? 300_000_000 : 100_000_000;
  }

  return out;
}

router.post("/participation-calc", async (req, res) => {
  const {
    siteTier,
    players,
    siteTotals = {},
    usedDread = false,
    drifterRan = true,
    accounting = 5,
    noTaxes = false,
    corpTax = 0,
    allianceTax = 0
  } = req.body;

  try {
    const tiers = ["combat", "datarelic"];
    let allSites = [];

    for (let tier of tiers) {
      const filePath = path.join(
        __dirname,
        "data",
        `${siteTier.toLowerCase()}_${tier}_sites_clean.json`
      );
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const data = JSON.parse(content);
        allSites = [...allSites, ...data];
      } catch (err) {
        console.error("[PARTICIPATION_CALC]: Failed reading:", filePath, err);
        throw err;
      }
    }

    const siteMap = {};
    for (let site of allSites) {
      siteMap[site.site] = site.blue_loot_isk;
    }

    const playerTotals = {};
    let totalISK = 0;

    for (let [siteName, isk] of Object.entries(siteMap)) {

      const perPlayerRuns = {};
      let participantCountsTotal = 0;
      for (const player of players) {
        const runs = Number(player?.participation?.[siteName] || 0);
        if (runs > 0) {
          perPlayerRuns[player.name] = runs;
          participantCountsTotal += runs;
        }
      }

      const runsForSite = Number(siteTotals?.[siteName] || 0);

      if (runsForSite <= 0 || participantCountsTotal <= 0) continue;

      const siteISKPerInstance = adjustedSiteISK(siteTier, siteName, isk, usedDread, drifterRan);

      const totalSiteISK = siteISKPerInstance * runsForSite;

      for (const [name, runs] of Object.entries(perPlayerRuns)) {
        const ratio = (Number(runs) || 0) / participantCountsTotal;
        const add = totalSiteISK * ratio;
        playerTotals[name] = (playerTotals[name] || 0) + add;
        totalISK += add;
      }
    }

    const taxRate = noTaxes ? 0 : (7.5 - 0.462 * accounting);
    const brokerMult = 1 - taxRate / 100;

    const corpMult = 1 - (Number(corpTax) || 0) / 100;
    const allianceMult = 1 - (Number(allianceTax) || 0) / 100;
    const finalMult = brokerMult * corpMult * allianceMult;

    const brokerTaxAmount = Math.round(totalISK * (1 - brokerMult));
    const corpTaxBase = Math.round(totalISK * brokerMult);
    const corpTaxAmount = Math.round(corpTaxBase * (1 - corpMult));
    const allianceTaxBase = Math.round(corpTaxBase * corpMult);
    const allianceTaxAmount = Math.round(allianceTaxBase * (1 - allianceMult));

    const payouts = Object.entries(playerTotals).map(([name, value]) => ({
      name,
      payout: Math.round(value * finalMult),
    }));

    res.json({
      totalISK: Math.round(totalISK),
      taxRate,
      brokerTaxAmount,
      corpTaxAmount,
      allianceTaxAmount,
      payouts
    });
  } catch (e) {
    console.error("[PARTICIPATION_CALC]: Error calculating participation payout:", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
