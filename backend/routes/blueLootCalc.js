/*
 * Express router for blue Loot Calc API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require("express");
const router = express.Router();

const siteValues = {

  "Core Garrison": { base: 353_400_000, dreadBonus: 350_000_000 },
  "Core Stronghold": { base: 334_900_000, dreadBonus: 350_000_000 },
  "Oruze Osobnyk": { base: 264_700_000, dreadBonus: 350_000_000 },
  "Quarantine Area": { base: 246_900_000, dreadBonus: 350_000_000 },
  "Unsecured Frontier Enclave Relay": { base: 344_900_000, dreadBonus: 150_000_000 },
  "Unsecured Frontier Server Bank": { base: 272_100_000, dreadBonus: 150_000_000 },
  "Forgotten Core Data Field": { base: 279_000_000, dreadBonus: 150_000_000 },
  "Forgotten Core Information Pen": { base: 332_900_000, dreadBonus: 150_000_000 },

  "Core Bastion": { base: 545_600_000, dreadBonus: 400_000_000 },
  "Core Citadel": { base: 410_100_000, dreadBonus: 400_000_000 },
  "Strange Energy Readings": { base: 391_800_000, dreadBonus: 400_000_000 },
  "The Mirror": { base: 463_200_000, dreadBonus: 400_000_000 },
  "Unsecured Core Backup Array": { base: 688_300_000, dreadBonus: 200_000_000 },
  "Unsecured Core Emergence": { base: 627_100_000, dreadBonus: 200_000_000 },
  "Forgotten Core Assembly Hall": { base: 642_500_000, dreadBonus: 200_000_000 },
  "Forgotten Core Circuitry Disassembler": { base: 657_600_000, dreadBonus: 200_000_000 }
};

function calculateSiteISK(siteName, count, usedDread, drifterRan) {
  const site = siteValues[siteName];
  if (!site) return 0;

  let base = site.base + (usedDread ? site.dreadBonus : 0);

  const subtractSites = [
    "Core Garrison", "Core Stronghold", "Oruze Osobnyk", "Quarantine Area",
    "Core Bastion", "Core Citadel", "Strange Energy Readings", "The Mirror"
  ];

  if (!drifterRan && subtractSites.includes(siteName)) {
    base -= usedDread ? 300_000_000 : 100_000_000;
  }

  return count * base;
}

function calculatePlayerShares(players, useDpsLogiMode) {
  const shares = [];

  for (const player of players) {
    let playerShares = 0;

    if (useDpsLogiMode) {

      for (let i = 0; i < (player.dps || 0); i++) {
        if (i < 2) playerShares += 1.0;
        else if (i < 5) playerShares += 0.5;
        else playerShares += 0.25;
      }

      for (let i = 0; i < (player.logi || 0); i++) {
        if (i === 0) playerShares += 1.5;
        else if (i === 1) playerShares += 0.75;
        else playerShares += 0.25;
      }

    } else {

      for (let i = 0; i < (player.dread || 0); i++) {
        if (i === 0) playerShares += 2.5;
        else playerShares += 1.5;
      }

      for (let i = 0; i < (player.marauders || 0); i++) {
        if (i === 0) playerShares += 1.5;
        else if (i === 1) playerShares += 1.0;
        else playerShares += 0.5;
      }
    }

    if (player.bubbler) playerShares += 0.5;
    if (player.extraShares) playerShares += parseFloat(player.extraShares);

    shares.push({
      name: player.name,
      shares: playerShares,
    });
  }

  return shares;
}

router.post("/api/blue-loot-calc", (req, res) => {
  const {
    siteRuns,
    players,
    accounting = 5,
    drifterRan = true,
    noTaxes = false,
    corpTax = 0,
    allianceTax = 0,
  } = req.body;

  if (!Array.isArray(siteRuns) || !Array.isArray(players)) {
    return res.status(400).json({ error: "Missing or invalid siteRuns or players array." });
  }

  let totalISK = 0;
  for (const { siteName, count, usedDread } of siteRuns) {
    totalISK += calculateSiteISK(siteName, count, usedDread, drifterRan);
  }

  const useDpsLogiMode = siteRuns[0]?.useDpsLogiMode === true;
  const playerShares = calculatePlayerShares(players, useDpsLogiMode);
  const totalShares = playerShares.reduce((sum, p) => sum + p.shares, 0);
  const payoutPerShare = totalShares > 0 ? totalISK / totalShares : 0;

  const taxRate = noTaxes ? 0 : (7.5 - (0.462 * accounting));
  const brokerMult = 1 - (taxRate / 100);

  const corpMult = 1 - (Number(corpTax) || 0) / 100;
  const allianceMult = 1 - (Number(allianceTax) || 0) / 100;

  const finalMult = brokerMult * corpMult * allianceMult;

  const brokerTaxAmount = Math.round(totalISK * (1 - brokerMult));
  const corpTaxBase = Math.round(totalISK * brokerMult);
  const corpTaxAmount = Math.round(corpTaxBase * (1 - corpMult));
  const allianceTaxBase = Math.round(corpTaxBase * corpMult);
  const allianceTaxAmount = Math.round(allianceTaxBase * (1 - allianceMult));

  const payouts = playerShares.map((p) => ({
    name: p.name,
    shares: p.shares,
    payout: Math.round(p.shares * payoutPerShare * finalMult),
  }));

  return res.json({
    totalISK,
    totalShares,
    payoutPerShare: Math.round(payoutPerShare),
    taxRate,
    brokerTaxAmount,
    corpTaxAmount,
    allianceTaxAmount,
    payouts,
  });
});

module.exports = router;
