/* Private structure-observation dashboard API. */

const express = require("express");
const cookieParser = require("cookie-parser");
const pool = require("../db/pool");
const secretAuth = require("../services/secretAdminAuth");
const {
  startObservationAgeRefresh,
} = require("../services/structureAgeMaintenance");
const {
  ensureStructureObservationSchema,
  createReplayToken,
  consumeReplayToken,
} = require("../services/structureObservations");

const router = express.Router();
router.use(cookieParser());
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (!secretAuth.isSameOriginRequest(req)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  return next();
});

const SORT_COLUMNS = Object.freeze({
  jcode: "observation.jcode",
  wormholeClass: "observation.wormhole_class",
  class: "observation.wormhole_class",
  typeName: "lower(observation.type_name)",
  type: "lower(observation.type_name)",
  ageMid: "observation.age_mid",
  estimatedAge: "observation.age_mid",
  daysWide: "observation.age_window_days",
  windowWidth: "observation.age_window_days",
  corpName: "lower(observation.corporation_name)",
  corporation: "lower(observation.corporation_name)",
  defenderTimezone: "observation.defender_timezone",
  structureId: "observation.structure_id",
  observationCount: "observation.observation_count",
  firstObservedAt: "observation.first_observed_at",
  lastSeen: "observation.last_observed_at",
  lastSeenAt: "observation.last_observed_at",
  lastObservedAt: "observation.last_observed_at",
});

function listOptions(query = {}) {
  const requestedSort = String(query.sort ?? query.sortBy ?? "jcode");
  const sort = Object.prototype.hasOwnProperty.call(SORT_COLUMNS, requestedSort)
    ? requestedSort
    : "jcode";
  const requestedDirection = String(query.direction ?? query.order ?? "asc").toLowerCase();
  const direction = requestedDirection === "desc" ? "desc" : "asc";
  const requestedLimit = Number.parseInt(query.limit, 10);
  const requestedOffset = Number.parseInt(query.offset, 10);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50000, requestedLimit)) : 50000;
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.min(10000000, requestedOffset)) : 0;
  const excludeUnknownRaw = String(query.excludeUnknownJcode ?? "").trim().toLowerCase();
  const excludeUnknownJcode = excludeUnknownRaw === "1" || excludeUnknownRaw === "true";
  return { sort, direction, limit, offset, excludeUnknownJcode };
}

function observationListQuery(options) {
  const orderExpression = SORT_COLUMNS[options.sort] || SORT_COLUMNS.jcode;
  const direction = options.direction === "desc" ? "DESC" : "ASC";
  const whereClause = options.excludeUnknownJcode
    ? "WHERE observation.jcode IS NOT NULL"
    : "";
  return {
    text: `SELECT observation.*, COUNT(*) OVER() AS total_count
       FROM structure_observations observation
       ${whereClause}
       ORDER BY ${orderExpression} ${direction} NULLS LAST,
                observation.structure_id ASC
       LIMIT $1 OFFSET $2`,
    values: [options.limit, options.offset],
  };
}

function observationRecord(row) {
  return {
    structureId: String(row.structure_id),
    jcode: row.jcode,
    wormholeClass: row.wormhole_class,
    typeId: row.type_id == null ? null : Number(row.type_id),
    typeName: row.type_name,
    method: row.age_method,
    midISO: row.age_mid,
    lowISO: row.age_low,
    highISO: row.age_high,
    daysWide: row.age_window_days == null ? null : Number(row.age_window_days),
    corpName: row.corporation_name,
    defenderTimezone: row.defender_timezone,
    defenderPeakHour: row.defender_peak_hour == null ? null : Number(row.defender_peak_hour),
    defenderConfidence: row.defender_confidence == null ? null : Number(row.defender_confidence),
    firstObservedAt: row.first_observed_at,
    // This is the newest successful structure-age check. Listing or refreshing
    // the admin page never writes to this field.
    lastSeen: row.last_observed_at,
    lastObservedAt: row.last_observed_at,
    observationCount: Number(row.observation_count) || 0,
  };
}

router.post("/login", async (req, res) => {
  const config = secretAuth.getSecretConfig();
  if (!config.enabled) {
    return res.status(503).json({ ok: false, error: "secret_admin_unavailable" });
  }

  const rate = secretAuth.loginRateStatus(req);
  if (!rate.allowed) {
    res.set("Retry-After", String(rate.retryAfterSeconds));
    return res.status(429).json({ ok: false, error: "too_many_attempts" });
  }

  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const passwordValid = password.length <= 1024 &&
    secretAuth.constantTimePasswordMatches(password, config.password);
  if (!passwordValid) {
    const failure = secretAuth.noteLoginFailure(req);
    if (!failure.allowed) res.set("Retry-After", String(failure.retryAfterSeconds));
    return res.status(401).json({ ok: false, error: "invalid_credentials" });
  }

  secretAuth.clearLoginFailures(req);
  const token = secretAuth.createSessionToken(config);
  res.cookie(secretAuth.COOKIE_NAME, token, secretAuth.sessionCookieOptions(req, config.sessionMs));
  return res.json({ ok: true, authenticated: true });
});

router.get("/status", (req, res) => {
  const authenticated = Boolean(secretAuth.sessionFromRequest(req));
  return res.json({ ok: true, authenticated });
});

router.post("/logout", (req, res) => {
  secretAuth.clearSessionCookie(res, req);
  return res.json({ ok: true, authenticated: false });
});

router.get("/observations", secretAuth.requireSecretAdmin, async (req, res) => {
  try {
    await ensureStructureObservationSchema();
    const options = listOptions(req.query);
    const query = observationListQuery(options);
    const { rows } = await pool.query(query.text, query.values);
    return res.json({
      ok: true,
      observations: rows.map(observationRecord),
      total: rows[0] ? Number(rows[0].total_count) : 0,
      limit: options.limit,
      offset: options.offset,
      sort: options.sort,
      direction: options.direction,
      excludeUnknownJcode: options.excludeUnknownJcode,
    });
  } catch (err) {
    console.error("[secret] observation list failed", err);
    return res.status(500).json({ ok: false, error: "secret_data_unavailable" });
  }
});

router.post("/force-age-check", secretAuth.requireSecretAdmin, async (req, res) => {
  const refresh = startObservationAgeRefresh();
  if (!refresh) {
    return res.status(409).json({ ok: false, error: "age_refresh_in_progress" });
  }

  try {
    const result = await refresh;
    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err?.code === "age_refresh_in_progress") {
      return res.status(409).json({ ok: false, error: "age_refresh_in_progress" });
    }
    console.error("[secret] force age check failed", err);
    return res.status(500).json({ ok: false, error: "age_refresh_failed" });
  }
});

router.post("/replay", secretAuth.requireSecretAdmin, async (req, res) => {
  try {
    const replay = await createReplayToken(req.body?.structureId);
    if (!replay) return res.status(404).json({ ok: false, error: "structure_not_found" });
    return res.status(201).json({
      ok: true,
      token: replay.token,
      expiresAt: replay.expiresAt,
    });
  } catch (err) {
    console.error("[secret] replay token creation failed", err);
    return res.status(500).json({ ok: false, error: "replay_unavailable" });
  }
});

router.post("/replay/consume", secretAuth.requireSecretAdmin, async (req, res) => {
  try {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const replayInput = await consumeReplayToken(token);
    if (!replayInput) return res.status(404).json({ ok: false, error: "replay_not_found" });
    return res.json({ ok: true, replayInput });
  } catch (err) {
    console.error("[secret] replay token consumption failed", err);
    return res.status(500).json({ ok: false, error: "replay_unavailable" });
  }
});

module.exports = router;
module.exports._test = {
  SORT_COLUMNS,
  listOptions,
  observationListQuery,
  observationRecord,
};
