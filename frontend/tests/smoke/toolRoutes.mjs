export const SPA_TOOL_ROUTES = [
  { path: "/", label: "Home" },
  { path: "/desktop", label: "Desktop" },
  { path: "/gas-calc", label: "Gas Huffing ISK/h" },
  { path: "/ore", label: "Ore Mining ISK/h" },
  { path: "/compressed", label: "Ore Reprocessing Calculator" },
  { path: "/appraisals", label: "ISKtimate" },
  { path: "/industry", label: "Industry Cost Calculator" },
  { path: "/schedule", label: "BPC Copy Planner" },
  { path: "/reaction-calc", label: "Reactions Calculator" },
  { path: "/pi-calc", label: "PI Profitability Calculator" },
  { path: "/bloot", label: "Ratting Split Calculator" },
  { path: "/participation", label: "Participation Calculator" },
  { path: "/POSPlanner", label: "POS Planner" },
  { path: "/fitting", label: "Fitting Tool" },
  { path: "/fitting/fit/SMOKEONLY", label: "Shared Fitting Tool Route" },
  { path: "/roachfits", label: "C5 Ratting Fits" },
  { path: "/market", label: "Market Browser" },
  { path: "/hulls", label: "Hull Activity" },
  { path: "/dscan", label: "D-Scan Intel" },
  { path: "/wormhole-sites", label: "Wormhole PvE Sites" },
  { path: "/rolling-mass", label: "Rolling Mass" },
  { path: "/wormholes", label: "Wormhole Database" },
  { path: "/timestamp", label: "Time Converter" },
  { path: "/evictions", label: "Eviction Stats" },
  { path: "/holeintel", label: "Structure Age Calculator" },
  { path: "/br", label: "BattleReport Generator" },
  { path: "/combat-logs", label: "Combat Log Parser" },
  { path: "/account", label: "Account Workspace" },
  { path: "/skillnix", label: "Skillnix Character Monitor" },
  { path: "/triff-local", label: "TriffLocal Intel" },
  { path: "/contact", label: "Contact Me" },
  { path: "/privacy", label: "Privacy Policy" },
  { path: "/terms", label: "Terms of Use" },
  { path: "/changelog", label: "Changelog" },
  { path: "/statuses", label: "Status" },
  { path: "/items", label: "Item Browser" },
  { path: "/items/34", label: "Item Detail Route" },
];

export const DOCUMENT_ROUTES = [
];

export function normalizePath(path) {
  if (!path || path === "/") return "/";
  return path.replace(/\/+$/, "").toLowerCase();
}

export function routeLabels(routes) {
  return routes.map((route) => `${route.label} (${route.path})`);
}
