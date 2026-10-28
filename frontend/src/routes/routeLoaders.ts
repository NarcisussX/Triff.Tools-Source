/*
 * Central route chunk loaders. These functions are shared by React.lazy and
 * the preload manager, so preloading downloads code without mounting a tool.
 */

export const routeLoaders = {
  hullActivity: () => import("../pages/HullActivity"),
  desktop: () => import("../pages/Desktop"),
  gasCalc: () => import("../mobile/routing/GasRoute"),
  blootCalc: () => import("../pages/blootCalc"),
  piCalc: () => import("../pages/piCalc"),
  rollingMass: () => import("../pages/RollingMass"),
  wormholeSites: () => import("../pages/WormholeSites"),
  changelog: () => import("../pages/changelog"),
  oreCalculator: () => import("../mobile/routing/OreRoute"),
  timestampTool: () => import("../pages/Timestamp"),
  wormholeDatabase: () => import("../pages/WormholeDatabase"),
  wormholeStructureStats: () => import("../pages/WormholeStructureStats"),
  reactionCalc: () => import("../pages/ReactionCalc"),
  participationCalc: () => import("../pages/ParticipationCalc"),
  appraisals: () => import("../pages/Appraisals"),
  appraisalView: () => import("../pages/AppraisalView"),
  account: () => import("../pages/Account"),
  statuses: () => import("../pages/Statuses"),
  industry: () => import("../mobile/routing/IndustryRoute"),
  contact: () => import("../pages/Contact"),
  privacy: () => import("../pages/Privacy"),
  terms: () => import("../pages/Terms"),
  endOfLife: () => import("../pages/EndOfLife"),
  compressedOrePlanner: () => import("../pages/CompressedOrePlanner"),
  michael: () => import("../pages/Michael"),
  hokkar: () => import("../pages/Hokkar"),
  busa: () => import("../pages/Busa"),
  triff: () => import("../pages/Triff"),
  marketBrowser: () => import("../mobile/routing/MarketRoute"),
  itemBrowser: () => import("../pages/ItemBrowser"),
  itemDetail: () => import("../pages/ItemDetail"),
  fitting: () => import("../pages/Fitting"),
  manufacturingPlanner: () => import("../pages/ManufacturingPlanner"),
  structureAge: () => import("../pages/StructureAge"),
  secret: () => import("../pages/Secret"),
  loki: () => import("../pages/Loki"),
  posPlanner: () => import("../pages/POSPlanner"),
  roachFits: () => import("../pages/RoachFits"),
  battleReports: () => import("../pages/BattleReports"),
  combatLogs: () => import("../pages/CombatLogs"),
  dScan: () => import("../pages/DScan"),
  triffLocalReport: () => import("../pages/TriffLocalReport"),
  skillnix: () => import("../pages/TriffMon"),
} as const;

type RouteLoader = () => Promise<unknown>;

const loadersByPath: Readonly<Record<string, RouteLoader>> = {
  "/hulls": routeLoaders.hullActivity,
  "/desktop": routeLoaders.desktop,
  "/gas-calc": routeLoaders.gasCalc,
  "/bloot": routeLoaders.blootCalc,
  "/pi-calc": routeLoaders.piCalc,
  "/rolling-mass": routeLoaders.rollingMass,
  "/wormhole-sites": routeLoaders.wormholeSites,
  "/changelog": routeLoaders.changelog,
  "/ore": routeLoaders.oreCalculator,
  "/timestamp": routeLoaders.timestampTool,
  "/wormholes": routeLoaders.wormholeDatabase,
  "/evictions": routeLoaders.wormholeStructureStats,
  "/reaction-calc": routeLoaders.reactionCalc,
  "/participation": routeLoaders.participationCalc,
  "/appraisals": routeLoaders.appraisals,
  "/account": routeLoaders.account,
  "/statuses": routeLoaders.statuses,
  "/industry": routeLoaders.industry,
  "/contact": routeLoaders.contact,
  "/privacy": routeLoaders.privacy,
  "/terms": routeLoaders.terms,
  "/eol": routeLoaders.endOfLife,
  "/compressed": routeLoaders.compressedOrePlanner,
  "/michael": routeLoaders.michael,
  "/hokkar": routeLoaders.hokkar,
  "/busa": routeLoaders.busa,
  "/triff": routeLoaders.triff,
  "/market": routeLoaders.marketBrowser,
  "/dscan": routeLoaders.dScan,
  "/items": routeLoaders.itemBrowser,
  "/fitting": routeLoaders.fitting,
  "/schedule": routeLoaders.manufacturingPlanner,
  "/holeintel": routeLoaders.structureAge,
  "/secret": routeLoaders.secret,
  "/loki": routeLoaders.loki,
  "/posplanner": routeLoaders.posPlanner,
  "/roachfits": routeLoaders.roachFits,
  "/br": routeLoaders.battleReports,
  "/combat-logs": routeLoaders.combatLogs,
  "/triff-local": routeLoaders.triffLocalReport,
  "/skillnix": routeLoaders.skillnix,
};

export const PRIMARY_PRELOAD_PATHS = [
  "/gas-calc",
  "/ore",
  "/compressed",
  "/appraisals",
  "/industry",
  "/reaction-calc",
  "/wormhole-sites",
  "/rolling-mass",
  "/wormholes",
  "/market",
  "/fitting",
] as const;

export const SECONDARY_PRELOAD_PATHS = [
  "/pi-calc",
  "/bloot",
  "/participation",
  "/schedule",
  "/timestamp",
  "/items",
  "/account",
  "/statuses",
] as const;

const preloadPromises = new Map<RouteLoader, Promise<void>>();

function normalizePath(pathname: string): string {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (normalized || "/").toLowerCase();
}

export function routeLoaderForPath(pathname: string): RouteLoader | undefined {
  const path = normalizePath(pathname);

  if (/^\/appraisals\/[^/]+$/.test(path)) return routeLoaders.appraisalView;
  if (/^\/items\/[^/]+$/.test(path)) return routeLoaders.itemDetail;
  if (/^\/fitting\/fit\/[^/]+$/.test(path)) return routeLoaders.fitting;
  if (/^\/dscan\/[^/]+$/.test(path)) return routeLoaders.dScan;
  if (/^\/br\/[^/]+$/.test(path)) return routeLoaders.battleReports;
  if (/^\/combat-logs\/[^/]+$/.test(path)) return routeLoaders.combatLogs;
  if (/^\/triff-local\/[^/]+$/.test(path)) return routeLoaders.triffLocalReport;
  if (path === "/skillnix" || path.startsWith("/skillnix/")) return routeLoaders.skillnix;

  return loadersByPath[path];
}

export function preloadRoute(pathname: string): void {
  const loader = routeLoaderForPath(pathname);
  if (!loader || preloadPromises.has(loader)) return;

  const promise = loader()
    .then(() => undefined)
    .catch((error: unknown) => {
      preloadPromises.delete(loader);
      console.error(`[route-preload] Failed to preload ${pathname}`, error);
    });

  preloadPromises.set(loader, promise);
}
