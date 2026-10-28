/*
 * Creates the Express server, mounts API routers, and starts scheduled backend jobs.
 * Reads environment configuration, initializes schemas, and listens on the configured port.
 */

require("dotenv").config();
const express = require("express");
const fs = require("fs");
const cors = require("cors");
const path = require("path");
const db = require('./db');
const { ensureSchemaWithRetry } = db;
const { fetchAdjustedPrices } = require("./utils/fetchAdjustedPrices");
const yaml = require("yaml");
const swaggerUi = require("swagger-ui-express");
const redoc = require("redoc-express");
const cookieParser = require("cookie-parser");
const createAgeRouter = require('./routes/age');
const createIntelRouter = require('./routes/intel');
const createWhStructureStatsRouter = require("./routes/whStructureStats");
const { captureException, initSentry } = require("./lib/sentry");
const { httpMetricsMiddleware, metricsRoute } = require("./lib/metrics");

initSentry({ serviceName: "backend" });

const botEmbeds = require("./server/botEmbeds");
const app = express();
const port = 3000;
const AUTHENTICATED_SAVE_JSON_LIMIT = process.env.AUTHENTICATED_SAVE_JSON_LIMIT || "5mb";
const DEFAULT_JSON_LIMIT = process.env.DEFAULT_JSON_LIMIT || "100kb";

app.use(httpMetricsMiddleware);
app.use(cors());
app.get(["/metrics", "/api/metrics"], metricsRoute(db));
app.use("/api/fitting/shared-fits", express.text({ type: "text/plain", limit: AUTHENTICATED_SAVE_JSON_LIMIT }));
app.use("/api/triff-local/reports", express.text({ type: "text/plain", limit: process.env.TRIFF_LOCAL_TEXT_LIMIT || "2mb" }));
app.use(
  [
    "/api/tool-setups",
    "/api/tool-state",
    "/api/fitting/saved-fits",
    "/api/fitting/shared-fits",
    "/api/wormhole-bookmarks",
    "/api/items/bookmarks",
    "/api/triff-local",
    "/api/character-monitor",
  ],
  express.json({ limit: AUTHENTICATED_SAVE_JSON_LIMIT })
);
app.use("/api/appraisals", express.json({ limit: "2mb" }));
app.use("/api/combat-logs", express.json({ limit: process.env.COMBAT_LOG_REPORT_JSON_LIMIT || "24mb" }));
app.use("/api/dscan", express.json({ limit: process.env.DSCAN_REPORT_JSON_LIMIT || "5mb" }));
app.use("/api/fitting/combat-profile", express.json({ limit: "256kb" }));
app.use(express.json({ limit: DEFAULT_JSON_LIMIT }));
app.use("/api/client-errors", require("./routes/clientErrors"));

const battleReportRoutes = require("./routes/battleReports");
app.use("/api/br", battleReportRoutes);
app.use("/br", battleReportRoutes);

app.use((req, res, next) => {
  if (req.path === "/br" || req.path.startsWith("/br/") || req.path.startsWith("/api/br")) {
    return next();
  }
  return botEmbeds(req, res, next);
});
app.use('/api/structure-intel', createAgeRouter());
app.use('/api/structure-intel', createIntelRouter());
app.use("/api/wh-structure-stats", createWhStructureStatsRouter());
const marketQuote = require('./routes/marketQuote');
app.use("/api/market", marketQuote)
const gasCalcRoute = require("./routes/gasCalc");
app.use(gasCalcRoute);
const piCalcRoute = require("./routes/piCalc");
app.use(piCalcRoute);
const blueLootCalc = require("./routes/blueLootCalc");
app.use(blueLootCalc);
const posPlanner = require("./routes/posPlanner");
app.use("/api/pos", posPlanner);
app.use("/api/data", express.static(path.join(__dirname, "routes", "data")));
const oreCalcRoute = require('./routes/oreCalc');
app.use('/api', oreCalcRoute);
const wormholesRoute = require('./routes/wormholes');
app.use('/api/wormholes', wormholesRoute);
app.use("/api/wormhole-bookmarks", require("./routes/wormholeBookmarks"));
const killboardRoutes = require("./routes/killboard");
app.use("/api", killboardRoutes);
const reactionCalc = require("./routes/reactionCalc");
app.use("/api", reactionCalc);
const participationCalc = require("./routes/participationCalc");
app.use("/api", participationCalc);
const marketStationPrices = require("./routes/marketStationPrices");
app.use("/api", marketStationPrices)
const appraisals = require("./routes/appraisals");
app.use("/api", appraisals);
app.use("/api/combat-logs", require("./routes/combatLogs"));
app.use("/api/dscan", require("./routes/dscan"));
const typeLookup = require("./routes/typeLookup");
app.use("/api", typeLookup);
app.use("/api", require("./routes/items"));
const marketFallback = require("./routes/marketFallback");
app.use("/api", marketFallback);
app.use("/api/statuses", require("./routes/statuses"));
app.use("/api/contact", require("./routes/contact"));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/account", require("./routes/account"));
app.use("/api/secret", require("./routes/secret"));
app.use("/api/tool-setups", require("./routes/toolSetups"));
app.use("/api/tool-state", require("./routes/toolState"));
app.use("/api/fitting", require("./routes/fitting"));
app.use("/api/in-game-fitting", require("./routes/inGameFitting"));
app.use("/api/character-monitor", require("./routes/characterMonitor"));
app.use("/api/triff-local", require("./routes/triffLocal"));
app.use(cookieParser());

const orePlannerRouter = require("./routes/orePlanner");
app.use("/api/ore-planner", orePlannerRouter);
app.use('/api/michael', require('./routes/michael'));
app.use('/api/hokkar', require('./routes/hokkar'));
app.use('/api/busa', require('./routes/busa'));
app.use('/api/triff', require('./routes/triff'));
const industryPlannerRoutes = require('./routes/industryPlanner');
app.use('/api', industryPlannerRoutes);
const marketItems   = require('./routes/marketItems');
const marketOrders  = require('./routes/marketOrders');
const marketHistory = require('./routes/marketHistory');
const marketBrowser = require('./routes/marketBrowser');
app.use('/api/hulls', require('./routes/hulls'));

app.use('/api/market', marketItems);
app.use('/api/market', marketOrders);
app.use('/api/market', marketHistory);
app.use('/api/market', marketBrowser);
app.use('/api/market', require('./routes/marketTree'));

const industryScheduleRouter = require('./routes/industrySchedule');
app.use('/api', industryScheduleRouter);

const { initSchema } = require("./db/initSchema");
const { runMigrations } = require("./db/migrations");
const { scheduleEverefRefresh } = require('./lib/everefRefresh');
const { ensureBattleReportSchema } = require("./services/battleReports/db");
const { startR2Z2Poller } = require("./workers/r2z2Poller");
const { startLiveBattleReportWorker } = require("./workers/liveBattleReports");

scheduleEverefRefresh();
const OPENAPI_PATH =
  process.env.OPENAPI_PATH ||
  path.join(__dirname, "docs", "TriffTools-OpenAPI.yaml");

const spec = yaml.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));

app.get("/api/openapi.yaml", (req, res) => {
  res.sendFile(OPENAPI_PATH);
});

const priceCache = require('./lib/priceCache');
priceCache.start();

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(spec));

app.get("/api/redoc", redoc({
  title: "Triff.Tools API",
  specUrl: "/api/openapi.yaml",
}));

app.use((err, req, res, next) => {
  captureException(err, {
    tags: {
      method: req.method,
      path: req.path,
      status: err.status || err.statusCode || 500,
    },
    extra: {
      originalUrl: req.originalUrl,
      route: req.route?.path || null,
    },
  });
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    ok: false,
    error: status >= 500 ? "internal_error" : err.message,
  });
});

(async () => {
  try {
    await ensureSchemaWithRetry();
    await initSchema();
    await runMigrations();
    await ensureBattleReportSchema();
    startLiveBattleReportWorker();
    void startR2Z2Poller().catch((err) => {
      console.error("[r2z2] poller stopped unexpectedly:", err);
      captureException(err, { tags: { worker: "r2z2" } });
    });
    const structureObservations = require("./services/structureObservations");
    await structureObservations.ensureStructureObservationSchema();
    const observationBackfill = await structureObservations.backfillSavedStructureChecks();
    if (observationBackfill.ran) {
      console.log(
        `[structure-observations] One-time backfill scanned ${observationBackfill.scanned}, ` +
        `recorded ${observationBackfill.recorded}, skipped ${observationBackfill.skipped}, ` +
        `failed ${observationBackfill.failed}`
      );
    } else {
      console.log("[structure-observations] One-time saved-history backfill already complete");
    }
    createWhStructureStatsRouter.startRollingCacheMaintenance?.();
    const listenPort = process.env.PORT || port;
    app.listen(listenPort, () => {
      console.log(`[BACKEND_INDEX]: Server running at http://localhost:${listenPort}`);
      const configuredDefenderLimit = Number(process.env.STRUCTURE_DEFENDER_BACKFILL_LIMIT);
      const defenderLimit = Number.isFinite(configuredDefenderLimit)
        ? Math.max(0, Math.min(1000, Math.floor(configuredDefenderLimit)))
        : 250;
      if (observationBackfill.ran && observationBackfill.completed && defenderLimit > 0) {
        void structureObservations.enrichMissingDefenderTimezones({ limit: defenderLimit })
          .then((result) => {
            console.log(
              `[structure-observations] One-time defender enrichment scanned ${result.scanned}, ` +
              `updated ${result.updated}, failed ${result.failed}`
            );
          })
          .catch((err) => {
            console.warn("[structure-observations] One-time defender enrichment failed:", err.message);
          });
      }
    });
  } catch (e) {
    console.error("[BACKEND_INDEX]: Failed to init schema:", e);
    captureException(e, { tags: { phase: "startup" } });
    process.exit(1);
  }
})();

const CACHE_PATH = path.join(__dirname, "cache", "adjusted_prices.json");

const shouldUpdateAdjustedPrices = () => {
  if (!fs.existsSync(CACHE_PATH)) return true;
  const stats = fs.statSync(CACHE_PATH);
  const ageMs = Date.now() - stats.mtimeMs;
  return ageMs > 24 * 60 * 60 * 1000;
};

(async () => {
  if (shouldUpdateAdjustedPrices()) {
    console.log("[ADJUSTED_PRICES]: Updating cache...");
    try {
      await fetchAdjustedPrices();
      console.log("[ADJUSTED_PRICES]: Cache updated.");
    } catch (err) {
      console.error("[ADJUSTED_PRICES]: Failed to update:", err);
      captureException(err, { tags: { worker: "adjusted-prices" } });
    }
  } else {
    console.log("[ADJUSTED_PRICES]: Cache is fresh.");
  }
})();
