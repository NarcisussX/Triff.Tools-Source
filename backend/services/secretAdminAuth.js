const crypto = require("crypto");

const COOKIE_NAME = "triff_secret_admin";
const DEFAULT_SESSION_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 30 * 60 * 1000;
const loginFailures = new Map();

function sessionDurationMs() {
  const requestedHours = Number(process.env.SECRET_ADMIN_SESSION_HOURS);
  const hours = Number.isFinite(requestedHours)
    ? Math.max(1, Math.min(24, requestedHours))
    : DEFAULT_SESSION_MS / 3600000;
  return Math.round(hours * 3600000);
}

function getSecretConfig() {
  const password = String(process.env.SECRET_ADMIN_PASSWORD || "");
  const sessionSecret = String(process.env.SECRET_ADMIN_SESSION_SECRET || "");
  return {
    password,
    sessionSecret,
    enabled: password.length >= 12 && sessionSecret.length >= 32,
    sessionMs: sessionDurationMs(),
  };
}

function constantTimePasswordMatches(provided, expected) {
  const supplied = typeof provided === "string" ? provided : "";
  const configured = typeof expected === "string" ? expected : "";
  const actualDigest = crypto.createHash("sha256").update(supplied, "utf8").digest();
  const expectedDigest = crypto.createHash("sha256").update(configured, "utf8").digest();
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

function signPayload(encodedPayload, sessionSecret) {
  return crypto.createHmac("sha256", sessionSecret).update(encodedPayload).digest("base64url");
}

function createSessionToken(config = getSecretConfig(), now = Date.now()) {
  if (!config.enabled) throw new Error("secret_admin_not_configured");
  const payload = {
    v: 1,
    iat: now,
    exp: now + config.sessionMs,
    nonce: crypto.randomBytes(16).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signPayload(encodedPayload, config.sessionSecret)}`;
}

function verifySessionToken(token, config = getSecretConfig(), now = Date.now()) {
  if (!config.enabled || typeof token !== "string" || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expectedSignature = Buffer.from(signPayload(parts[0], config.sessionSecret), "utf8");
  const actualSignature = Buffer.from(parts[1], "utf8");
  if (
    actualSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(actualSignature, expectedSignature)
  ) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (payload?.v !== 1) return null;
    if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return null;
    if (payload.iat > now + 60000 || payload.exp <= now) return null;
    if (payload.exp - payload.iat <= 0 || payload.exp - payload.iat > config.sessionMs) return null;
    if (typeof payload.nonce !== "string" || payload.nonce.length < 16) return null;
    return payload;
  } catch {
    return null;
  }
}

function shouldUseSecureCookie(req) {
  return (
    process.env.NODE_ENV === "production" ||
    Boolean(req.secure) ||
    String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim() === "https"
  );
}

function sessionCookieOptions(req, maxAge = getSecretConfig().sessionMs) {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: shouldUseSecureCookie(req),
    path: "/api/secret",
    maxAge,
  };
}

function clearSessionCookie(res, req) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "strict",
    secure: shouldUseSecureCookie(req),
    path: "/api/secret",
  });
}

function privateProxyAddress(value) {
  const address = String(value || "").replace(/^::ffff:/, "").toLowerCase();
  if (address === "127.0.0.1" || address === "::1") return true;
  if (address.startsWith("10.") || address.startsWith("192.168.")) return true;
  const match = address.match(/^172\.(\d{1,3})\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return address.startsWith("fc") || address.startsWith("fd");
}

function requestAddress(req) {
  const remote = String(req.socket?.remoteAddress || req.ip || "").slice(0, 128);
  if (!privateProxyAddress(remote)) return remote || "unknown";
  const forwardedChain = String(req.get?.("x-forwarded-for") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const forwarded = [...forwardedChain].reverse().find((value) => !privateProxyAddress(value))
    || forwardedChain[forwardedChain.length - 1]
    || "";
  const real = String(req.get?.("x-real-ip") || "").trim();
  return (forwarded || real || remote || "unknown").slice(0, 128);
}

function pruneLoginFailures(key, now = Date.now()) {
  const current = loginFailures.get(key);
  if (!current) return { attempts: [], blockedUntil: 0 };
  const attempts = current.attempts.filter((time) => now - time < LOGIN_WINDOW_MS);
  const blockedUntil = current.blockedUntil > now ? current.blockedUntil : 0;
  const next = { attempts, blockedUntil };
  if (!attempts.length && !blockedUntil) loginFailures.delete(key);
  else loginFailures.set(key, next);
  return next;
}

function loginRateStatus(req, now = Date.now()) {
  const state = pruneLoginFailures(requestAddress(req), now);
  return {
    allowed: state.blockedUntil <= now,
    retryAfterSeconds: state.blockedUntil > now
      ? Math.max(1, Math.ceil((state.blockedUntil - now) / 1000))
      : 0,
  };
}

function noteLoginFailure(req, now = Date.now()) {
  const key = requestAddress(req);
  const state = pruneLoginFailures(key, now);
  state.attempts.push(now);
  if (state.attempts.length >= LOGIN_MAX_FAILURES) state.blockedUntil = now + LOGIN_LOCK_MS;
  loginFailures.set(key, state);
  if (loginFailures.size > 5_000) {
    for (const entryKey of loginFailures.keys()) pruneLoginFailures(entryKey, now);
  }
  return loginRateStatus(req, now);
}

function clearLoginFailures(req) {
  loginFailures.delete(requestAddress(req));
}

function isSameOriginRequest(req) {
  const origin = String(req.get?.("origin") || req.headers?.origin || "").trim();
  if (!origin) return true;
  if (origin === "null") return false;
  try {
    const originUrl = new URL(origin);
    const configuredOrigin = String(process.env.SECRET_ADMIN_ALLOWED_ORIGIN || "").trim();
    if (configuredOrigin) return originUrl.origin === new URL(configuredOrigin).origin;
    const host = String(req.get?.("host") || req.headers?.host || "").trim().toLowerCase();
    return Boolean(host) && originUrl.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function sessionFromRequest(req) {
  const config = getSecretConfig();
  const token = req.cookies?.[COOKIE_NAME];
  return verifySessionToken(token, config);
}

function requireSecretAdmin(req, res, next) {
  const session = sessionFromRequest(req);
  if (!session) return res.status(401).json({ ok: false, error: "unauthorized" });
  req.secretAdminSession = session;
  return next();
}

module.exports = {
  COOKIE_NAME,
  getSecretConfig,
  constantTimePasswordMatches,
  createSessionToken,
  verifySessionToken,
  shouldUseSecureCookie,
  sessionCookieOptions,
  clearSessionCookie,
  loginRateStatus,
  noteLoginFailure,
  clearLoginFailures,
  isSameOriginRequest,
  sessionFromRequest,
  requireSecretAdmin,
  _test: {
    signPayload,
    privateProxyAddress,
    requestAddress,
    pruneLoginFailures,
  },
};
