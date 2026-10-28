const express = require("express");
const cookieParser = require("cookie-parser");
const siteAuth = require("../services/siteAuth");
const fittingEsi = require("../services/fittingEsi");
const monitor = require("../services/characterMonitor");

const router = express.Router();
router.use(cookieParser());
const manualSyncs = new Map();
const optimizerRequests = new Map();
const MANUAL_SYNC_WINDOW_MS = 30_000;
const OPTIMIZER_WINDOW_MS = 10_000;
const MAX_RATE_LIMIT_KEYS = 2_000;

function noStore(_req, res, next) {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.vary("Cookie");
  res.vary("Authorization");
  res.vary("Origin");
  res.set("X-Content-Type-Options", "nosniff");
  next();
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function userId(req) {
  return req.siteUser?.id;
}

function consumeRateWindow(bucket, key, windowMs, now = Date.now(), maxKeys = MAX_RATE_LIMIT_KEYS) {
  const previous = bucket.get(key);
  if (previous !== undefined) {
    const retryAfterMs = windowMs - (now - previous);
    if (retryAfterMs > 0) return retryAfterMs;
    bucket.delete(key);
  }

  bucket.set(key, now);
  if (bucket.size > maxKeys) {
    for (const [candidate, timestamp] of bucket) {
      if (candidate !== key && now - timestamp >= windowMs) bucket.delete(candidate);
    }
    while (bucket.size > maxKeys) {
      const oldestKey = bucket.keys().next().value;
      if (oldestKey === undefined) break;
      bucket.delete(oldestKey);
    }
  }
  return 0;
}

function optimizerRetryAfter(req) {
  return consumeRateWindow(
    optimizerRequests,
    String(userId(req)),
    OPTIMIZER_WINDOW_MS,
  );
}

function syncAllowed(req, characterId) {
  const key = `${userId(req)}:${characterId}`;
  const now = Date.now();
  const last = manualSyncs.get(key) || 0;
  if (now - last < MANUAL_SYNC_WINDOW_MS) return false;
  manualSyncs.set(key, now);
  if (manualSyncs.size > 2000) {
    for (const [candidate, timestamp] of manualSyncs) {
      if (now - timestamp > MANUAL_SYNC_WINDOW_MS) manualSyncs.delete(candidate);
    }
  }
  return true;
}

router.use(noStore);

router.get("/esi/login", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  const createLoginUrl = fittingEsi.createMonitorLoginUrl || fittingEsi.createLoginUrl;
  if (typeof createLoginUrl !== "function") {
    return res.status(503).send(fittingEsi.callbackHtml({
      ok: false,
      message: "EVE SSO is not configured for this Triff.Tools instance.",
      returnTo: req.query.returnTo || "/skillnix",
    }));
  }
  try {
    const url = await createLoginUrl(userId(req), { returnTo: req.query.returnTo });
    return res.redirect(302, url);
  } catch (err) {
    return res.status(Number(err?.status) || 503).send(fittingEsi.callbackHtml({
      ok: false,
      message: "EVE SSO is not configured or temporarily unavailable.",
      returnTo: req.query.returnTo || "/skillnix",
    }));
  }
}));

router.get("/esi/callback", async (req, res) => {
  try {
    if (req.query.error) {
      const stateRecord = req.query.state
        ? await fittingEsi.consumeSkillnixOAuthState(String(req.query.state)).catch(() => null)
        : null;
      return res.status(400).send(fittingEsi.callbackHtml({
        ok: false,
        message: req.query.error_description || req.query.error || "EVE SSO authorization was cancelled.",
        returnTo: stateRecord?.returnTo || "/skillnix",
      }));
    }
    const linked = await fittingEsi.linkSkillnixCharacterFromCode(
      String(req.query.state || ""),
      String(req.query.code || ""),
    );
    return res.send(fittingEsi.callbackHtml({
      ok: true,
      message: `Linked EVE character ${linked.characterName}. You can close this tab.`,
      characterId: linked.characterId,
      characterName: linked.characterName,
      returnTo: linked.returnTo,
    }));
  } catch (err) {
    console.error("[skillnix/esi/callback] error", err.message);
    return res.status(400).send(fittingEsi.callbackHtml({
      ok: false,
      message: "Could not link this EVE character. Return to Skillnix and try again.",
      returnTo: err?.returnTo || "/skillnix",
    }));
  }
});

router.get("/characters", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  res.json({ ok: true, characters: await monitor.listCharacters(userId(req)) });
}));

router.delete("/characters/:characterId", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  const removed = await fittingEsi.unlinkMonitorCharacter(userId(req), req.params.characterId);
  if (!removed) return res.status(404).json({ ok: false, error: "character_not_found" });
  return res.status(204).end();
}));

router.get("/catalog", siteAuth.requireAuth, asyncRoute(async (_req, res) => {
  res.json({ ok: true, catalog: await monitor.catalog() });
}));

router.get("/characters/:characterId/snapshot", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  const snapshot = await monitor.snapshotForUser(userId(req), req.params.characterId, { refresh: true, force: false });
  delete snapshot._context;
  res.json({ ok: true, snapshot });
}));

router.get("/characters/:characterId/skills", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  const snapshot = await monitor.snapshotForUser(userId(req), req.params.characterId, { refresh: true, force: false });
  res.json({ ok: true, character: snapshot.character, skills: snapshot.skills, fetchedAt: snapshot.fetchedAt, stale: snapshot.stale });
}));

router.get("/characters/:characterId/queue", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  const snapshot = await monitor.snapshotForUser(userId(req), req.params.characterId, { refresh: true, force: false });
  res.json({ ok: true, character: snapshot.character, queue: snapshot.queue, fetchedAt: snapshot.fetchedAt, stale: snapshot.stale });
}));

router.get("/characters/:characterId/attributes", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  const snapshot = await monitor.snapshotForUser(userId(req), req.params.characterId, { refresh: true, force: false });
  res.json({ ok: true, character: snapshot.character, attributes: snapshot.attributes, implants: snapshot.implants, fetchedAt: snapshot.fetchedAt, stale: snapshot.stale });
}));

router.get("/characters/:characterId/clones", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  const snapshot = await monitor.snapshotForUser(userId(req), req.params.characterId, { refresh: true, force: false });
  res.json({
    ok: true,
    character: snapshot.character,
    clones: snapshot.clones,
    implantStatus: snapshot.implantStatus,
    cloneStatus: snapshot.cloneStatus,
    fetchedAt: snapshot.fetchedAt,
    stale: snapshot.stale,
  });
}));

router.post("/characters/:characterId/sync", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  if (!syncAllowed(req, req.params.characterId)) {
    return res.status(429).json({ ok: false, error: "sync_rate_limited", message: "Wait a few seconds before requesting another manual sync." });
  }
  const snapshot = await monitor.snapshotForUser(userId(req), req.params.characterId, { refresh: true, force: false });
  delete snapshot._context;
  return res.json({ ok: true, snapshot });
}));

router.patch("/characters/:characterId/preferences", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  const character = await monitor.updatePreferences(userId(req), req.params.characterId, req.body || {});
  res.json({ ok: true, character });
}));

router.get("/plans", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  res.json({ ok: true, plans: await monitor.listPlans(userId(req)) });
}));

router.post("/plans", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  const plan = await monitor.createPlan(userId(req), req.body || {});
  res.status(201).json({ ok: true, plan });
}));

router.post("/plans/import", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  const plan = await monitor.importPlan(userId(req), req.body || {});
  res.status(201).json({ ok: true, plan });
}));

router.post("/plans/export", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  res.json({ ok: true, export: await monitor.exportPlan(userId(req), req.body || {}) });
}));

router.get("/plans/:planId", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  res.json({ ok: true, plan: await monitor.getPlan(userId(req), req.params.planId) });
}));

router.patch("/plans/:planId", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  const plan = await monitor.updatePlan(userId(req), req.params.planId, req.body || {});
  res.json({ ok: true, plan });
}));

router.delete("/plans/:planId", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  await monitor.deletePlan(userId(req), req.params.planId);
  res.status(204).end();
}));

router.post("/plans/:planId/entries", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  const plan = await monitor.addPlanEntry(userId(req), req.params.planId, req.body || {});
  res.status(201).json({ ok: true, plan });
}));

router.post("/analyze", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  res.json({ ok: true, analysis: await monitor.analyzePlan(userId(req), req.body || {}) });
}));

router.post("/optimize", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  const retryAfterMs = optimizerRetryAfter(req);
  if (retryAfterMs > 0) {
    res.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
    return res.status(429).json({
      ok: false,
      error: "optimizer_rate_limited",
      message: "Wait a few seconds before requesting another plan optimization.",
    });
  }
  res.json({ ok: true, optimization: await monitor.optimizePlan(userId(req), req.body || {}) });
}));

router.post("/requirements", siteAuth.requireAuth, asyncRoute(async (req, res) => {
  res.json({ ok: true, result: await monitor.analyzeRequirements(userId(req), req.body || {}) });
}));

router.use((err, _req, res, _next) => {
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error("[character-monitor]", err?.message || err);
  res.status(status).json({
    ok: false,
    error: err?.code || err?.message || "character_monitor_error",
    message: status >= 500 && !err?.status ? "The character monitor request failed." : err?.message || "Request failed.",
    ...(err?.details !== undefined ? { details: err.details } : {}),
    ...(Array.isArray(err?.missing) ? { missing: err.missing } : {}),
    ...(Array.isArray(err?.missingScopes) ? { missingScopes: err.missingScopes } : {}),
  });
});

router._test = {
  consumeRateWindow,
  OPTIMIZER_WINDOW_MS,
};

module.exports = router;
