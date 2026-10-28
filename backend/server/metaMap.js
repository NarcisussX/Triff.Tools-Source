/*
 * Server helper for meta Map.
 * Supports Express middleware, metadata, or bot-facing responses without defining frontend routes.
 */

exports.metaByPath = {
  "/hulls": {
    title: "Hull Activity – Triff.Tools",
    desc: "Daily regional ship-market volume against 7, 30, and 365-day historical averages.",
  },
  "/": {
    title: "Triff.Tools – Wormhole Utility suite",
    desc: "Gas, Ore, Blue Loot, Reactions, Wormhole DB, Industry Calculators and Market Tools.",
    image: "https://www.triff.tools/static/og/home-1200x630v7.jpg",
  },
  "/desktop": {
    title: "Desktop Workspace - Triff.Tools",
    desc: "Open multiple Triff.Tools pages in a draggable browser desktop workspace.",
    image: "https://www.triff.tools/static/og/home-1200x630v7.jpg",
  },
  "/gas": {
    title: "Gas Calculator – Triff.Tools",
    desc: "Cycle times, boosts, implants, and ISK/hr for all fullerites. Wormhole-ready.",
    image: "https://www.triff.tools/static/og/gas-1200x630v3.jpg",
  },
  "/ore": {
    title: "Ore Mining Calculator – Triff.Tools",
    desc: "Compute m³/hr, ISK/hr, residue, skills, boosts, and crystals across all ores.",
    image: "https://www.triff.tools/static/og/ore-1200x630v2.png",
  },
  "/wormholes": {
    title: "Wormhole Database – Triff.Tools",
    desc: "Filter 2,603 systems by class, statics, planets, effects, and A0 stars.",
    image: "https://www.triff.tools/static/og/wormholes-1200x630v3.jpg",
  },
  "/bloot": {
    title: "Blue Loot Payout Calculator – Triff.Tools",
    desc: "Share systems (dreads/marauders or DPS/Logi), broker tax, and per-pilot payouts.",
    image: "https://www.triff.tools/static/og/blue-loot-1200x630v2.png",
  },
  "/reaction-calc": {
    title: "Reaction Profit Calculator – Triff.Tools",
    desc: "Hybrid reactions with live prices, rig bonuses, job costs, and taxes.",
    image: "https://www.triff.tools/static/og/reactions-1200x630v3.jpg",
  },
  "/participation": {
    title: "Equal per-participant split per site – Triff.Tools",
    desc: "Lightweight wormhole ratting isk split by heartbeats.",
    image: "https://www.triff.tools/static/og/participation-1200x630v2.png",
  },
  "/pi-calc": {
    title: "Clear outputs for planning and routing PI chains – Triff.Tools",
    desc: "Builds P1→P4 profitability using hub prices from my Market DB.",
    image: "https://www.triff.tools/static/og/pi-calc-1200x630v3.jpg",
  },
  "/rolling-mass": {
    title: "Hole Rolling Guide – Triff.Tools",
    desc: "Exactly what FCs need: excact values, fast.",
    image: "https://www.triff.tools/static/og/rolling-mass-1200x630v2.png",
  },
  "/wormhole-sites": {
    title: "Database of all PvE WH sites – Triff.Tools",
    desc: "Not just a site list: it’s standardized, computed wave math you can trust mid-op.",
    image: "https://www.triff.tools/static/og/wormhole-sites-1200x630v2.png",
  },
  "/timestamp": {
    title: "Eve time-conversion and discord timestamps – Triff.Tools",
    desc: "Generates `<t:UNIX:…>` codes with previews.",
    image: "https://www.triff.tools/static/og/timestamp-1200x630v2.png",
  },
  "/pyfa": {
    title: "Runs a Pyfa instance you can reach via web – Triff.Tools",
    desc: "Perfect for ‘now’ moments without installs.",
    image: "https://www.triff.tools/static/og/pyfa-1200x630.png",
  },
  "/appraisals": {
    title: "Eve appraisal and market price tool – Triff.Tools",
    desc: "No third-party market APIs.",
    image: "https://www.triff.tools/static/og/appraisals-1200x630v2.png",
  },
  "/about": {
    title: "Learn more about the site – Triff.Tools",
    desc: "More info than you've ever wanted.",
    image: "https://www.triff.tools/static/og/about-1200x630.png",
  },
  "/acknowledgements": {
    title: "The people who made it possible – Triff.Tools",
    desc: "My own little place to say thanks.",
    image: "https://www.triff.tools/static/og/acknowledgements-1200x630.png",
  },
  "/statuses": {
    title: "Server Status – Triff.Tools",
    desc: "Market freshness and API uptime",
    image: "https://www.triff.tools/static/og/statuses-1200x630v2.png",
  },
  "/compressed": {
    title: "Compressed Ore Reprocessing Calculator – Triff.Tools",
    desc: "Compute what compressed ores you should buy to reprocess for X minerals",
    image: "https://www.triff.tools/static/og/compressed-1200x630v2.png",
  },
  "/michael": {
    title: "Michael Marsh Tracker – Triff.Tools",
    desc: "Hows Michael doing this week?",
    image: "https://www.triff.tools/static/og/michael-1200x630.png",
  },
  "/hokkar": {
    title: "Hokkar Vokan Tracker – Triff.Tools",
    desc: "Hows Hokkar doing this week?",
    image: "https://www.triff.tools/static/og/hokkar-1200x630.png",
  },
  "/industry": {
    title: "Manufacturing Calculator – Triff.Tools",
    desc: "The best manufacturing BP cost calculator you've ever seen!",
    image: "https://www.triff.tools/static/og/industry-1200x630v2.png",
  },
  "/market": {
    title: "Market Browser – Triff.Tools",
    desc: "Market orders with daily volume and pricing history!",
    image: "https://www.triff.tools/static/og/market-1200x630v3.png",
  },
  "/schedule": {
    title: "BPC Copy Planner – Triff.Tools",
    desc: "Calculate how many BPC's and runs / BPC to produce things efficiently!",
    image: "https://www.triff.tools/static/og/schedule-1200x630v3.png",
  },
  "/holeintel": {
    title: "Plan an eviction! – Triff.Tools",
    desc: "Check activity, structure age and more with this tool.",
    image: "https://www.triff.tools/static/og/holeintel-1200x630.png",
  },
  "/posplanner": {
    title: "POS Planner – Triff.Tools",
    desc: "Calculate how much ISK/CPU/PG/EHP your dream POS requires.",
    image: "https://www.triff.tools/static/og/posplanner-1200x630.png",
  },
  "/roachfits": {
    title: "C5 Roaching Fits – Triff.Tools",
    desc: "Fits for every marauder to C5 rat with or without a dread",
    image: "https://www.triff.tools/static/og/roachfits-1200x630.png",
  },
  "/evictions": {
    title: "J-Space Eviction Stats",
    desc: "Structure kill count by corp/alliance up to 3 years ago.",
    image: "https://www.triff.tools/static/og/evictions-1200x630v2.jpg",
  },
  "/fitting": {
    title: "PYFA Wrapper in your browser",
    desc: "PYFA at work, for the PYFA warriors.",
    image: "https://www.triff.tools/static/og/fitting-1200x630v3.jpg",
  },
  "/items": {
    title: "Item DB",
    desc: "A fully searchable database of every item in EVE, with quick actions.",
    image: "https://www.triff.tools/static/og/items-1200x630v1.jpg",
  },
  "/combat-logs": {
    title: "Combat Log Parser",
    desc: "Parse EVE gamelogs into shareable damage, capacitor, repair, and timeline reports.",
    image: "https://www.triff.tools/static/og/logs-1200x630.jpg",
  },
  "/dscan": {
    title: "D-Scan analyzer and WH mass calculator",
    desc: "Paste D-scan for shareable fleet comp breakdowns and to see how much mass your fleet eats.",
    image: "https://www.triff.tools/static/og/dscan-1200x630.jpg",
  },
  "/triff-local": {
    title: "TriffLocal Intel Report",
    desc: "Shared EVE local intel with hydrated pilot, corporation, alliance, and zKill threat snapshots.",
    image: "https://www.triff.tools/static/og/localintel-1200x630.jpg",
  },
};
