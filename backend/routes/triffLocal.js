const express = require("express");
const cookieParser = require("cookie-parser");
const siteAuth = require("../services/siteAuth");
const { recordAccountGeneratedLink } = require("../services/accountLinks");
const {
  createTriffLocalReport,
  getTriffLocalReport,
  parseTriffLocalInput,
} = require("../services/triffLocal");

const router = express.Router();
const CREATE_RATE_WINDOW_MS = 60 * 1000;
const CREATE_RATE_TOKENS_PER_WINDOW = 10;
const CREATE_RATE_BURST_TOKENS = 20;
const CREATE_RATE_LARGE_REPORT_COST = 2.5;
const CREATE_RATE_FUTURE_ASYNC_COST = 10;
const createRateBuckets = new Map();

router.use(cookieParser());

function readInput(req) {
  if (typeof req.body === "string") return req.body;
  return String(req.body?.input || req.body?.paste || req.body?.source || "");
}

function requestIp(req) {
  const forwarded = String(req.get?.("x-forwarded-for") || "").split(",")[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || "unknown";
}

function createRateCost(parsedCount) {
  if (parsedCount > 500) return CREATE_RATE_FUTURE_ASYNC_COST;
  if (parsedCount > 100) return CREATE_RATE_LARGE_REPORT_COST;
  return 1;
}

function cleanupCreateRateBuckets(now) {
  if (createRateBuckets.size < 5000) return;
  for (const [key, bucket] of createRateBuckets) {
    if (bucket.tokens >= CREATE_RATE_BURST_TOKENS && now - bucket.updatedAt > 10 * CREATE_RATE_WINDOW_MS) {
      createRateBuckets.delete(key);
    }
  }
}

function checkCreateRateLimit(principal, parsedCount, now = Date.now()) {
  const key = String(principal || "ip:unknown");
  const cost = createRateCost(parsedCount);
  const bucket = createRateBuckets.get(key) || { tokens: CREATE_RATE_BURST_TOKENS, updatedAt: now };
  const elapsedWindows = Math.max(0, (now - bucket.updatedAt) / CREATE_RATE_WINDOW_MS);
  bucket.tokens = Math.min(
    CREATE_RATE_BURST_TOKENS,
    bucket.tokens + elapsedWindows * CREATE_RATE_TOKENS_PER_WINDOW
  );
  bucket.updatedAt = now;

  if (bucket.tokens < cost) {
    createRateBuckets.set(key, bucket);
    cleanupCreateRateBuckets(now);
    return { ok: false, error: "rate_limited" };
  }

  bucket.tokens -= cost;
  createRateBuckets.set(key, bucket);
  cleanupCreateRateBuckets(now);
  return { ok: true };
}

async function optionalSession(req) {
  try {
    return await siteAuth.getSessionUser(req);
  } catch (err) {
    console.warn("[TRIFF_LOCAL]: session lookup failed for rate limit", err.message);
    return null;
  }
}

router.post("/reports", async (req, res) => {
  try {
    const input = readInput(req);
    const session = await optionalSession(req);
    const parsedCount = parseTriffLocalInput(input).length;
    const principal = session?.user?.id ? `user:${session.user.id}` : `ip:${requestIp(req)}`;
    const rate = checkCreateRateLimit(principal, parsedCount);
    if (!rate.ok) return res.status(429).json({ ok: false, error: rate.error });

    const saved = await createTriffLocalReport(input);

    try {
      await recordAccountGeneratedLink(session?.user?.id, "triff_local_report", saved.id);
    } catch (linkErr) {
      console.warn("[TRIFF_LOCAL]: saved report but failed to link account", linkErr.message);
    }

    return res.status(201).json({
      ok: true,
      id: saved.id,
      url: `/triff-local/${saved.id}`,
      report: saved.report,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("[TRIFF_LOCAL]: create failed", err);
    return res.status(status).json({
      ok: false,
      error: err.message || "triff_local_report_failed",
    });
  }
});

router.get("/reports/:id", async (req, res) => {
  try {
    const report = await getTriffLocalReport(req.params.id);
    if (!report) return res.status(404).json({ ok: false, error: "not_found" });
    res.set("Cache-Control", "public, max-age=60");
    return res.json({ ok: true, report });
  } catch (err) {
    console.error("[TRIFF_LOCAL]: read failed", err);
    return res.status(500).json({ ok: false, error: "triff_local_report_read_failed" });
  }
});

module.exports = router;
module.exports._test = {
  checkCreateRateLimit,
  createRateCost,
  readInput,
};
