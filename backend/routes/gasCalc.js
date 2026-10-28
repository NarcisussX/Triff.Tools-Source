/*
 * Express router for gas Calc API endpoints.
 * Reads request params, query strings, or bodies and returns JSON or HTTP responses via local services.
 */

const express = require("express");
const db = require("../db");
const router = express.Router();

const modules = {

  "Gas Cloud Scoop I": { type: "Scoop", baseAmount: 10, cycle: 30, residueChance: 0, residueMultiplier: 0 },
  "Crop' Gas Cloud Scoop": { type: "Scoop", baseAmount: 20, cycle: 40, residueChance: 1.0, residueMultiplier: 2 },
  "Plow' Gas Cloud Scoop": { type: "Scoop", baseAmount: 20, cycle: 40, residueChance: 1.0, residueMultiplier: 4 },
  "Gas Cloud Scoop II": { type: "Scoop", baseAmount: 20, cycle: 40, residueChance: 0.34, residueMultiplier: 1 },
  "Syndicate Gas Cloud Scoop": { type: "Scoop", baseAmount: 20, cycle: 30, residueChance: 0, residueMultiplier: 0 },

  "Gas Cloud Harvester I": { type: "Harvester", baseAmount: 100, cycle: 200, residueChance: 0, residueMultiplier: 0 },
  "Gas Cloud Harvester II": { type: "Harvester", baseAmount: 200, cycle: 160, residueChance: 0.34, residueMultiplier: 1 },
  "ORE Gas Cloud Harvester": { type: "Harvester", baseAmount: 200, cycle: 160, residueChance: 0, residueMultiplier: 0 }
};

const shipProfiles = {
  "Unbonused Ship": {
    yieldBonus: 1.0,
    durationBonus: 1.0,
    skillBonuses: {
      Frigate: 0,
      Barge: 0,
      Exhumer: 0,
      Expedition: 0,
      MiningDestroyer: 0,
      CommandDestroyer: 0,
    },
  },
  Venture: {
    yieldBonus: 2.0,
    durationBonus: 1.0,
    skillBonuses: {
      Frigate: -0.05,
      Barge: 0,
      Exhumer: 0,
      Expedition: 0,
      MiningDestroyer: 0,
      CommandDestroyer: 0,
    },
  },
  Prospect: {
    yieldBonus: 2.0,
    durationBonus: 1.0,
    skillBonuses: {
      Frigate: -0.05,
      Barge: 0,
      Exhumer: 0,
      Expedition: 0,
      MiningDestroyer: 0,
      CommandDestroyer: 0,
    },
  },
  "Venture Consortium Issue": {
    yieldBonus: 2.0,
    durationBonus: 1.0,
    skillBonuses: {
      Frigate: -0.05,
      Barge: 0,
      Exhumer: 0,
      Expedition: 0,
      MiningDestroyer: 0,
      CommandDestroyer: 0,
    },
  },
  "Pioneer Consortium Issue": {
    yieldBonus: 1.0,
    durationBonus: 0.75,
    skillBonuses: {
      Frigate: 0,
      Barge: 0,
      Exhumer: 0,
      Expedition: 0,
      MiningDestroyer: -0.05,
      CommandDestroyer: 0,
    },
  },
  Odysseus: {
    yieldBonus: 1.0,
    durationBonus: 1.0,
    skillBonuses: {
      Frigate: 0,
      Barge: 0,
      Exhumer: 0,
      Expedition: -0.05,
      MiningDestroyer: 0,
      CommandDestroyer: 0,
    },
  },
  Covetor: {
    yieldBonus: 1.0,
    durationBonus: 0.7,
    skillBonuses: {
      Frigate: 0,
      Barge: -0.03,
      Exhumer: 0,
      Expedition: 0,
      MiningDestroyer: 0,
      CommandDestroyer: 0,
    },
  },
  Retriever: {
    yieldBonus: 1.0,
    durationBonus: 0.875,
    skillBonuses: {
      Frigate: 0,
      Barge: -0.02,
      Exhumer: 0,
      Expedition: 0,
      MiningDestroyer: 0,
      CommandDestroyer: 0,
    },
  },
  Procurer: {
    yieldBonus: 1.0,
    durationBonus: 1.0,
    skillBonuses: {
      Frigate: 0,
      Barge: -0.02,
      Exhumer: 0,
      Expedition: 0,
      MiningDestroyer: 0,
      CommandDestroyer: 0,
    },
  },
  Hulk: {
    yieldBonus: 1.0,
    durationBonus: 0.7,
    skillBonuses: {
      Frigate: 0,
      Barge: -0.03,
      Exhumer: -0.03,
      Expedition: 0,
      MiningDestroyer: 0,
      CommandDestroyer: 0,
    },
  },
  Skiff: {
    yieldBonus: 1.0,
    durationBonus: 1.0,
    skillBonuses: {
      Frigate: 0,
      Barge: 0,
      Exhumer: -0.03,
      Expedition: 0,
      MiningDestroyer: 0,
      CommandDestroyer: 0,
    },
  },
  Mackinaw: {
    yieldBonus: 1.0,
    durationBonus: 0.875,
    skillBonuses: {
      Frigate: 0,
      Barge: -0.03,
      Exhumer: -0.03,
      Expedition: 0,
      MiningDestroyer: 0,
      CommandDestroyer: 0,
    },
  },
};

const gasTypeIDs = {
  "Amber Cytoserocin": "25268",
  "Golden Cytoserocin": "25273",
  "Viridian Cytoserocin": "25274",
  "Celadon Cytoserocin": "25275",
  "Malachite Cytoserocin": "25276",
  "Lime Cytoserocin": "25277",
  "Vermillion Cytoserocin": "25278",
  "Azure Cytoserocin": "25279",
  "Amber Mykoserocin": "28694",
  "Azure Mykoserocin": "28695",
  "Celadon Mykoserocin": "28696",
  "Golden Mykoserocin": "28697",
  "Lime Mykoserocin": "28698",
  "Malachite Mykoserocin": "28699",
  "Vermillion Mykoserocin": "28700",
  "Viridian Mykoserocin": "28701",
  "Fullerite-C28": "30375",
  "Fullerite-C32": "30376",
  "Fullerite-C50": "30370",
  "Fullerite-C60": "30371",
  "Fullerite-C70": "30372",
  "Fullerite-C72": "30373",
  "Fullerite-C84": "30374",
  "Fullerite-C320": "30377",
  "Fullerite-C540": "30378"
};

const K_SPACE_GAS_M3_PER_UNIT = 10;

function mergeClouds(name, units, m3PerUnit = K_SPACE_GAS_M3_PER_UNIT) {
  const counts = new Map();
  for (const unitCount of units) {
    counts.set(unitCount, (counts.get(unitCount) || 0) + 1);
  }

  return Array.from(counts.entries()).map(([unitsPerCloud, cloudCount]) => ({
    name,
    units_per_cloud: unitsPerCloud,
    m3_per_unit: m3PerUnit,
    cloud_count: cloudCount,
  }));
}

function kSpaceSite(family, site, gasName, units, meta = {}) {
  return {
    family,
    site,
    siteName: site,
    location: meta.location || "",
    security: meta.security || "",
    cloudDamage: meta.cloudDamage || "None",
    hasNpcs: Boolean(meta.hasNpcs),
    deadspace: Boolean(meta.deadspace),
    gases: mergeClouds(gasName, units),
  };
}

const fulleriteSites = [
  {
    family: "fullerite",
    site: "Barren",
    siteName: "Barren Perimeter Reservoir",
    location: "Wormhole space",
    security: "WH",
    gases: [{ name: "Fullerite-C50", units_per_cloud: 12000, m3_per_unit: 1 }, { name: "Fullerite-C60", units_per_cloud: 6000, m3_per_unit: 1 }],
  },
  {
    family: "fullerite",
    site: "Token",
    siteName: "Token Perimeter Reservoir",
    location: "Wormhole space",
    security: "WH",
    gases: [{ name: "Fullerite-C60", units_per_cloud: 12000, m3_per_unit: 1 }, { name: "Fullerite-C70", units_per_cloud: 6000, m3_per_unit: 1 }],
  },
  {
    family: "fullerite",
    site: "Minor",
    siteName: "Minor Perimeter Reservoir",
    location: "Wormhole space",
    security: "WH",
    gases: [{ name: "Fullerite-C70", units_per_cloud: 12000, m3_per_unit: 1 }, { name: "Fullerite-C72", units_per_cloud: 6000, m3_per_unit: 2 }],
  },
  {
    family: "fullerite",
    site: "Ordinary",
    siteName: "Ordinary Perimeter Reservoir",
    location: "Wormhole space",
    security: "WH",
    gases: [{ name: "Fullerite-C72", units_per_cloud: 12000, m3_per_unit: 2 }, { name: "Fullerite-C84", units_per_cloud: 6000, m3_per_unit: 2 }],
  },
  {
    family: "fullerite",
    site: "Sizeable",
    siteName: "Sizeable Perimeter Reservoir",
    location: "Wormhole space",
    security: "WH",
    gases: [{ name: "Fullerite-C84", units_per_cloud: 12000, m3_per_unit: 2 }, { name: "Fullerite-C50", units_per_cloud: 6000, m3_per_unit: 1 }],
  },
  {
    family: "fullerite",
    site: "Bountiful",
    siteName: "Bountiful Frontier Reservoir",
    location: "Wormhole space",
    security: "WH",
    gases: [{ name: "Fullerite-C28", units_per_cloud: 20000, m3_per_unit: 2 }, { name: "Fullerite-C32", units_per_cloud: 4000, m3_per_unit: 5 }],
  },
  {
    family: "fullerite",
    site: "Vast",
    siteName: "Vast Frontier Reservoir",
    location: "Wormhole space",
    security: "WH",
    gases: [{ name: "Fullerite-C32", units_per_cloud: 20000, m3_per_unit: 5 }, { name: "Fullerite-C28", units_per_cloud: 4000, m3_per_unit: 2 }],
  },
  {
    family: "fullerite",
    site: "Vital",
    siteName: "Vital Core Reservoir",
    location: "Wormhole space",
    security: "WH",
    gases: [{ name: "Fullerite-C540", units_per_cloud: 24000, m3_per_unit: 10 }, { name: "Fullerite-C320", units_per_cloud: 2000, m3_per_unit: 5 }],
  },
  {
    family: "fullerite",
    site: "Instrumental",
    siteName: "Instrumental Core Reservoir",
    location: "Wormhole space",
    security: "WH",
    gases: [{ name: "Fullerite-C320", units_per_cloud: 24000, m3_per_unit: 5 }, { name: "Fullerite-C540", units_per_cloud: 2000, m3_per_unit: 10 }],
  },
];

const mykoserocinSites = [
  kSpaceSite("mykoserocin", "Sister Nebula", "Lime Mykoserocin", [1000, 1000], { security: "HS/LS/NS", location: "Aridia, Curse, Derelik, Kador, Khanid, Kor-Azor, Omist, Solitude, Wicked Creek" }),
  kSpaceSite("mykoserocin", "Helix Nebula", "Lime Mykoserocin", [2000, 2000, 2000], { security: "HS/LS/NS", location: "Aridia, Curse, Derelik, Khanid, Kor-Azor, Solitude" }),
  kSpaceSite("mykoserocin", "Wild Nebula", "Malachite Mykoserocin", [1000, 1000], { security: "HS/LS/NS", location: "Aridia, Insmother, Kor-Azor, Curse, Omist, Solitude, Tash-Murkon" }),
  kSpaceSite("mykoserocin", "Blackeye Nebula", "Malachite Mykoserocin", [2000, 2000, 2000], { security: "HS/LS/NS", location: "Aridia, Curse, Khanid, Kor-Azor, Omist, Solitude" }),
  kSpaceSite("mykoserocin", "Sunspark Nebula", "Amber Mykoserocin", [1000, 1000], { security: "HS/LS/NS", location: "Black Rise, Lonetrek, Outer Passage, Sinq Laison, The Citadel, The Forge, The Spire" }),
  kSpaceSite("mykoserocin", "Diablo Nebula", "Amber Mykoserocin", [2000, 2000, 2000], { security: "HS/LS/NS", location: "Black Rise, Everyshore, Lonetrek, Outer Passage, Sinq Laison, The Citadel, The Forge, Vale of the Silent" }),
  kSpaceSite("mykoserocin", "Smoking Nebula", "Golden Mykoserocin", [1000, 1000], { security: "HS/LS/NS", location: "Black Rise, Etherium Reach, Everyshore, Lonetrek, Outer Passage, Perrigen Falls, Sinq Laison, The Citadel, The Spire" }),
  kSpaceSite("mykoserocin", "Ring Nebula", "Golden Mykoserocin", [2000, 2000, 2000], { security: "HS/LS/NS", location: "Black Rise, Etherium Reach, Everyshore, Lonetrek, Malpais, Outer Passage, Perrigen Falls, Sinq Laison, The Citadel" }),
  kSpaceSite("mykoserocin", "Calabash Nebula", "Celadon Mykoserocin", [1000, 1000], { security: "HS/LS/NS", location: "Domain, Genesis, Placid, Solitude, Fountain (Pegasus constellation)" }),
  kSpaceSite("mykoserocin", "Glass Nebula", "Celadon Mykoserocin", [2000, 2000, 2000], { security: "HS/LS/NS", location: "Domain, Solitude, Pure Blind, Placid, Genesis" }),
  kSpaceSite("mykoserocin", "Bright Nebula", "Viridian Mykoserocin", [1000, 1000], { security: "HS/LS/NS", location: "Essence, Fountain, Placid, Tenal, Venal" }),
  kSpaceSite("mykoserocin", "Sparking Nebula", "Viridian Mykoserocin", [2000, 2000, 2000], { security: "HS/LS/NS", location: "Domain, Essence, Fountain, Genesis, Placid, Pure Blind, Tenal" }),
  kSpaceSite("mykoserocin", "Ghost Nebula", "Azure Mykoserocin", [1000, 1000], { security: "HS/LS/NS", location: "Curse, Derelik, Devoid, The Bleak Lands, Heimatar, Molden Heath" }),
  kSpaceSite("mykoserocin", "Eagle Nebula", "Azure Mykoserocin", [2000, 2000, 2000], { security: "HS/LS/NS", location: "Curse, Derelik, The Bleak Lands, Devoid, Heimatar, Insmother, Metropolis, Molden Heath, Tenerifis" }),
  kSpaceSite("mykoserocin", "Flame Nebula", "Vermillion Mykoserocin", [1000, 1000], { security: "HS/LS/NS", location: "Curse, Derelik, Devoid, The Bleak Lands, Great Wildlands, Detorid, Heimatar, Insmother, Metropolis, Omist, Tenerifis" }),
  kSpaceSite("mykoserocin", "Pipe Nebula", "Vermillion Mykoserocin", [2000, 2000, 2000], { security: "HS/LS/NS", location: "Curse, Derelik, Devoid, The Bleak Lands, Heimatar, Immensea, Metropolis, Tenerifis" }),
];

const cytoserocinSites = [
  kSpaceSite("cytoserocin", "Emerald Nebula", "Lime Cytoserocin", [200, 300], { security: "LS", location: "Derelik low-security systems" }),
  kSpaceSite("cytoserocin", "Cheetah Nebula", "Lime Cytoserocin", [1000], { security: "NS", location: "Catch", cloudDamage: "1000 thermal" }),
  kSpaceSite("cytoserocin", "Duo Nebula", "Lime Cytoserocin", [2500, 500], { security: "NS", location: "Catch (9HXQ-G constellation)", cloudDamage: "1000 EM + 1000 thermal" }),
  kSpaceSite("cytoserocin", "Leopard Nebula", "Lime Cytoserocin", [18000], { security: "NS", location: "Catch (9HXQ-G constellation)", cloudDamage: "1400 explosive", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Rimy Nebula", "Lime Cytoserocin", [1000, 2000], { security: "NS", location: "Catch (9HXQ-G constellation)", cloudDamage: "1000 EM + 1000 thermal", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Crimson Nebula", "Malachite Cytoserocin", [500, 500], { security: "LS", location: "Aridia low-security systems" }),
  kSpaceSite("cytoserocin", "Cobra Nebula", "Malachite Cytoserocin", [100, 100, 100, 100, 100], { security: "NS", location: "Delve", cloudDamage: "800 EM + 800 thermal" }),
  kSpaceSite("cytoserocin", "Crab Spider Nebula", "Malachite Cytoserocin", [400, 400, 400, 400, 400], { security: "NS", location: "Delve", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Hazy Nebula", "Malachite Cytoserocin", [18000], { security: "NS", location: "Delve (OK-FEM constellation)", cloudDamage: "1000 EM + 800 thermal", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Hidden Nebula", "Malachite Cytoserocin", [3000, 3000], { security: "NS", location: "Delve (OK-FEM constellation)", cloudDamage: "1000 EM + 1000 thermal" }),
  kSpaceSite("cytoserocin", "Whirling Nebula", "Malachite Cytoserocin", [3000, 3000], { security: "NS", location: "Delve (OK-FEM constellation)", cloudDamage: "1000 EM + 1000 thermal", hasNpcs: true, deadspace: true }),
  kSpaceSite("cytoserocin", "Bandit Nebula", "Amber Cytoserocin", [500, 500], { security: "LS", location: "The Forge low-security systems" }),
  kSpaceSite("cytoserocin", "Fluttering Nebula", "Amber Cytoserocin", [100, 100, 100, 100, 100], { security: "NS", location: "Vale of the Silent", cloudDamage: "1000 thermal" }),
  kSpaceSite("cytoserocin", "Rocky Nebula", "Amber Cytoserocin", [400, 400, 400, 300, 300, 300], { security: "NS", location: "Vale of the Silent", cloudDamage: "2500 thermal" }),
  kSpaceSite("cytoserocin", "Dewy Nebula", "Amber Cytoserocin", [3000, 3000], { security: "NS", location: "Vale of the Silent (E-8CSQ constellation)", cloudDamage: "1000 EM + 1000 thermal", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Foggy Nebula", "Amber Cytoserocin", [3000, 3000], { security: "NS", location: "Vale of the Silent (E-8CSQ constellation)", cloudDamage: "1000 EM + 1000 thermal", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Shimmering Nebula", "Amber Cytoserocin", [18000], { security: "NS", location: "Vale of the Silent (E-8CSQ constellation)", cloudDamage: "1400 thermal", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Spacious Nebula", "Amber Cytoserocin", [1000, 1000, 2000, 2000], { security: "NS", location: "Vale of the Silent", cloudDamage: "Varies by cloud" }),
  kSpaceSite("cytoserocin", "Profiteer Nebula", "Golden Cytoserocin", [500, 500], { security: "LS", location: "Lonetrek low-security systems" }),
  kSpaceSite("cytoserocin", "Moth Nebula", "Golden Cytoserocin", [1000, 1000], { security: "NS", location: "Tenal", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Swarm Nebula", "Golden Cytoserocin", [400, 400, 400, 400, 400], { security: "NS", location: "Tenal", cloudDamage: "1000 thermal", deadspace: true }),
  kSpaceSite("cytoserocin", "Lion Nebula", "Golden Cytoserocin", [6000], { security: "NS", location: "Tenal (09-4XW constellation)", cloudDamage: "1000 EM + 1000 thermal" }),
  kSpaceSite("cytoserocin", "Shiny Nebula", "Golden Cytoserocin", [3000, 3000], { security: "NS", location: "Tenal (09-4XW constellation)", cloudDamage: "1000 EM + 1000 thermal", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Gaseous Nebula", "Golden Cytoserocin", [18000], { security: "NS", location: "Tenal (09-4XW constellation)", cloudDamage: "700 EM + 700 thermal", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Phoenix Nebula", "Celadon Cytoserocin", [500, 500], { security: "LS", location: "Solitude low-security systems" }),
  kSpaceSite("cytoserocin", "Flowing Nebula", "Celadon Cytoserocin", [2000], { security: "NS", location: "Fountain", cloudDamage: "1000 thermal" }),
  kSpaceSite("cytoserocin", "Thick Nebula", "Celadon Cytoserocin", [1000], { security: "NS", location: "Fountain (Pegasus constellation)", cloudDamage: "Unknown", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Diamond Nebula", "Celadon Cytoserocin", [3000, 3000], { security: "NS", location: "Fountain (Pegasus constellation)", cloudDamage: "1000 EM + 1000 thermal", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Massive Nebula", "Celadon Cytoserocin", [14224], { security: "NS", location: "Fountain (Pegasus constellation)", cloudDamage: "800 thermal", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Peacock Nebula", "Celadon Cytoserocin", [3000, 3000], { security: "NS", location: "Fountain (Pegasus constellation)", cloudDamage: "1000 EM + 1000 thermal" }),
  kSpaceSite("cytoserocin", "Forgotten Nebula", "Viridian Cytoserocin", [500, 500], { security: "LS", location: "Placid low-security systems" }),
  kSpaceSite("cytoserocin", "Frosty Nebula", "Viridian Cytoserocin", [1000, 1000], { security: "NS", location: "Cloud Ring", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Goose Nebula", "Viridian Cytoserocin", [400, 400, 400, 400, 400], { security: "NS", location: "Cloud Ring", cloudDamage: "1000 thermal" }),
  kSpaceSite("cytoserocin", "Icy Nebula", "Viridian Cytoserocin", [3000, 3000], { security: "NS", location: "Cloud Ring (Assilot constellation)", cloudDamage: "1000 EM + 1000 thermal", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Pale Nebula", "Viridian Cytoserocin", [500, 2500], { security: "NS", location: "Cloud Ring (Assilot constellation)", cloudDamage: "1000 thermal" }),
  kSpaceSite("cytoserocin", "Polar Bear Nebula", "Viridian Cytoserocin", [18000], { security: "NS", location: "Cloud Ring", cloudDamage: "800 thermal", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Rapture Nebula", "Azure Cytoserocin", [700, 700], { security: "LS", location: "Molden Heath low-security systems" }),
  kSpaceSite("cytoserocin", "Crystal Nebula", "Azure Cytoserocin", [400, 400, 400, 400, 400], { security: "NS", location: "Wicked Creek", cloudDamage: "400 thermal" }),
  kSpaceSite("cytoserocin", "Snowy Owl Nebula", "Azure Cytoserocin", [2000], { security: "NS", location: "Wicked Creek", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Arctic Fox Nebula", "Azure Cytoserocin", [9000], { security: "NS", location: "Wicked Creek (760-9C constellation)", cloudDamage: "700 EM + 700 thermal", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Glistening Nebula", "Azure Cytoserocin", [3000, 3000], { security: "NS", location: "Wicked Creek (760-9C constellation)", cloudDamage: "6000 EM + 1000 thermal", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Murky Nebula", "Azure Cytoserocin", [1500, 1500], { security: "NS", location: "Wicked Creek (760-9C constellation)", cloudDamage: "1000 EM + 1000 thermal" }),
  kSpaceSite("cytoserocin", "Saintly Nebula", "Vermillion Cytoserocin", [200, 300], { security: "LS", location: "Heimatar low-security systems", cloudDamage: "Unknown" }),
  kSpaceSite("cytoserocin", "Boisterous Nebula", "Vermillion Cytoserocin", [2000], { security: "NS", location: "Feythabolis", cloudDamage: "1000 thermal" }),
  kSpaceSite("cytoserocin", "Cardinal Nebula", "Vermillion Cytoserocin", [3000, 3000], { security: "NS", location: "Feythabolis (I-3ODK constellation)", cloudDamage: "1000 EM + 1000 thermal", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Red Dragonfly Nebula", "Vermillion Cytoserocin", [18000], { security: "NS", location: "Feythabolis (I-3ODK constellation)", cloudDamage: "700 EM + 700 thermal", hasNpcs: true }),
  kSpaceSite("cytoserocin", "Wispy Nebula", "Vermillion Cytoserocin", [3000, 3000], { security: "NS", location: "Feythabolis (I-3ODK constellation)", cloudDamage: "1000 EM + 1000 thermal", deadspace: true }),
];

const gasSitesByFamily = {
  fullerite: fulleriteSites,
  mykoserocin: mykoserocinSites,
  cytoserocin: cytoserocinSites,
};

const industrialCoreBonuses = {
  Porpoise: { T1: 0.05, T2: 0.075 },
  Orca: { T1: 0.10, T2: 0.15 },
};

function normalizeIndustrialCoreTier(value) {
  if (value === "T1" || value === "T2") return value;
  if (value === "Yes") return "T2";
  return "No";
}

function getIndustrialCoreBonus(boostShip, industrialCore) {
  const tier = normalizeIndustrialCoreTier(industrialCore);
  return industrialCoreBonuses[boostShip]?.[tier] || 0;
}

function durationMultiplier(
  ship,
  skills,
  implant,
  boostShip,
  miningDirector,
  industrialCommand,
  boostImplant,
  boostModule,
  bastion
) {
  const profile = shipProfiles[ship];
  if (!profile) return 1;

  const bonuses = profile.skillBonuses || {};

  const hullMult = profile.durationBonus ?? 1;

  const frigMult = 1 + (skills.Frigate || 0) * (bonuses.Frigate || 0);
  const bargeMult = 1 + (skills.Barge || 0) * (bonuses.Barge || 0);
  const exhumerMult = 1 + (skills.Exhumer || 0) * (bonuses.Exhumer || 0);
  const expeditionMult = 1 + (skills.Expedition || 0) * (bonuses.Expedition || 0);
  const miningDestroyerMult =
    1 + (skills.MiningDestroyer || 0) * (bonuses.MiningDestroyer || 0);
  const commandDestroyerHullMult =
    1 + (skills.CommandDestroyer || 0) * (bonuses.CommandDestroyer || 0);

  const implantMult = 1 - (implant || 0);

  let baseReduction =
    hullMult *
    frigMult *
    bargeMult *
    exhumerMult *
    expeditionMult *
    miningDestroyerMult *
    commandDestroyerHullMult *
    implantMult;

  if (boostShip === "None") return baseReduction;

  const baseBoost = 0.15;

  const shipBonus =
    boostShip === "Orca"
      ? 0.03 * industrialCommand
      : boostShip === "Porpoise"
        ? 0.02 * industrialCommand
        : boostShip === "Outrider"
          ? 0.02 * (skills.CommandDestroyer || 0)
          : 0;

  const skillBonus = 0.10 * miningDirector;
  const implantBonus =
    boostImplant === "mindlink" || boostImplant === "ore" ? 0.25 : 0;
  const moduleBonus = boostModule === "T2" ? 0.25 : 0;
  const industrialCoreBonus = getIndustrialCoreBonus(boostShip, bastion);

  const totalBoostMultiplier =
    (1 + shipBonus) *
    (1 + skillBonus) *
    (1 + implantBonus) *
    (1 + moduleBonus) *
    (1 + industrialCoreBonus);

  const boostReduction = baseBoost * totalBoostMultiplier;

  return baseReduction * (1 - boostReduction);
}

const JITA_4_4_STATION_ID = 60003760;
const GAS_PRICE_FIELDS = new Set(["buy_5pct", "buy_max", "sell_5pct", "sell_min"]);
const DEFAULT_GAS_PRICE_FIELD = "buy_5pct";

function normalizeGasPriceField(value) {
  const field = String(value || DEFAULT_GAS_PRICE_FIELD);
  return GAS_PRICE_FIELDS.has(field) ? field : DEFAULT_GAS_PRICE_FIELD;
}

async function loadGasPrices(priceField) {
  const field = normalizeGasPriceField(priceField);
  const typeIds = Object.values(gasTypeIDs).map((id) => Number(id)).filter(Boolean);
  const { rows } = await db.query(
    `
    SELECT type_id, ${field} AS price
    FROM market_station_aggregates
    WHERE station_id = $1
      AND type_id = ANY($2::int[])
    `,
    [JITA_4_4_STATION_ID, typeIds]
  );

  const prices = new Map();
  for (const row of rows) {
    const typeId = Number(row.type_id);
    const price = Number(row.price);
    if (Number.isFinite(typeId) && Number.isFinite(price) && price > 0) {
      prices.set(typeId, price);
    }
  }
  return prices;
}

function getISKPerUnit(gasName, prices) {
  const typeID = Number(gasTypeIDs[gasName]);
  if (!typeID) return 0;
  return prices.get(typeID) || 0;
}

router.post("/api/gas-calc", async (req, res) => {
  try {
    const {
      ship, moduleType, moduleCount, skills, shipCount, implant,
      boostShip, miningDirector, industrialCommand,
      boostImplant, boostModule, bastion
    } = req.body;
    const gasFamily = String(req.body.gasFamily || "fullerite").toLowerCase();
    const priceField = normalizeGasPriceField(req.body.priceField);
    const selectedSites = gasSitesByFamily[gasFamily];

    const mod = modules[moduleType];
    const profile = shipProfiles[ship];
    if (!mod || !profile) {
      return res.status(400).json({ error: "Invalid ship or module type" });
    }
    if (!selectedSites) {
      return res.status(400).json({ error: "Invalid gas family" });
    }

    const durMult = durationMultiplier(
      ship,
      skills || {},
      implant,
      boostShip,
      miningDirector,
      industrialCommand,
      boostImplant,
      boostModule,
      bastion
    );

    const adjustedCycleTime = mod.cycle * durMult;
    const adjustedYield = mod.baseAmount * profile.yieldBonus;

    const m3PerSecondPerModule = adjustedYield / adjustedCycleTime;
    const m3PerSecondPerShip = m3PerSecondPerModule * moduleCount;
    const totalM3PerHour = m3PerSecondPerShip * 3600 * shipCount;

    const results = [];
    const gasPrices = await loadGasPrices(priceField);

    const { residueChance = 0, residueMultiplier = 0 } = mod;
    const wasteFactor = residueChance * residueMultiplier;
    const depletionFactor = 1 + wasteFactor;
    const recoverFrac = 1 / depletionFactor;
    const wasteFrac = 1 - recoverFrac;

    for (const site of selectedSites) {
      const siteName = site.site;

      for (const gas of site.gases) {
        const gasName = gas.name;
        const m3PerUnit = gas.m3_per_unit;
        const unitsPerCloud = gas.units_per_cloud;
        const cloudCount = gas.cloud_count || 1;

        const unitsPerHour = totalM3PerHour / m3PerUnit;
        const price = getISKPerUnit(gasName, gasPrices);
        const iskPerHour = unitsPerHour * price;

        const m3PerCloud = unitsPerCloud * m3PerUnit;
        const totalUnits = unitsPerCloud;

        const gatheredUnits = totalUnits * recoverFrac;
        const wastedUnits = totalUnits * wasteFrac;
        const gatheredM3 = m3PerCloud * recoverFrac;
        const wastedM3 = m3PerCloud * wasteFrac;
        const iskPerCloud = gatheredUnits * price;
        const iskLostResidue = wastedUnits * price;

        const adjustedUnitsPerModule = adjustedYield / m3PerUnit;
        const baseUnitsPerCycle = moduleCount * shipCount * adjustedUnitsPerModule;
        const effectiveUnitsPerCycle = baseUnitsPerCycle * depletionFactor;
        const cyclesNeeded = totalUnits / effectiveUnitsPerCycle;
        const totalSeconds = cyclesNeeded * adjustedCycleTime;
        const totalMinutes = Math.ceil(totalSeconds / 60);

        let ttkFormatted;
        if (totalMinutes >= 60) {
          const hours = Math.floor(totalMinutes / 60);
          const minutes = totalMinutes % 60;
          ttkFormatted = `${hours}h ${minutes}m`;
        } else {
          ttkFormatted = `${totalMinutes}m`;
        }

        results.push({
          family: gasFamily,
          site: siteName,
          siteName: site.siteName || siteName,
          location: site.location || "",
          security: site.security || "",
          cloudDamage: site.cloudDamage || "None",
          hasNpcs: Boolean(site.hasNpcs),
          deadspace: Boolean(site.deadspace),
          gas: gasName,
          gasTypeId: Number(gasTypeIDs[gasName]) || null,
          cloudCount,
          m3_per_unit: m3PerUnit,
          units_per_cloud: unitsPerCloud,
          m3_per_cloud: m3PerCloud,
          price,
          unitsPerHour,
          iskPerHour,
          minutesToHuff: ttkFormatted,
          totalSeconds,
          totalMinutes,
          totalIskPerCloud: unitsPerCloud * price,
          m3PerCloud: gatheredM3,
          m3LostResidue: wastedM3,
          iskPerCloud,
          iskLostResidue,
          ttk: ttkFormatted,
        });
      }
    }

    const siteOrder = [
      "Barren",
      "Token",
      "Minor",
      "Ordinary",
      "Sizeable",
      "Bountiful",
      "Vast",
      "Vital",
      "Instrumental",
    ];
    const selectedSiteOrder =
      gasFamily === "fullerite" ? siteOrder : selectedSites.map((site) => site.site);

    results.sort((a, b) => {
      const aSiteIndex = selectedSiteOrder.indexOf(a.site);
      const bSiteIndex = selectedSiteOrder.indexOf(b.site);
      const siteComparison =
        (aSiteIndex === -1 ? Number.MAX_SAFE_INTEGER : aSiteIndex) -
        (bSiteIndex === -1 ? Number.MAX_SAFE_INTEGER : bSiteIndex);
      if (siteComparison !== 0) return siteComparison;
      return b.units_per_cloud - a.units_per_cloud;
    });

    results.forEach((r, i) => (r._rowIndex = i));
    res.json(results);
  } catch (err) {
    console.error("[GAS_CALC]: Uncaught server error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

module.exports = router;
