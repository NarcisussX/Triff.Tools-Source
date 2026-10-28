/*
 * Optional Sentry wiring for backend services and workers.
 * Keeps observability best-effort and strips sensitive auth/token data.
 */

const SENSITIVE_KEY_RE = /(authorization|cookie|password|passwd|secret|token|refresh|access|session|jwt|code|esi|key)/i;
const MAX_STRING_LENGTH = 2000;
const MAX_DEPTH = 5;

let Sentry = null;
let initialized = false;
let activeServiceName = "backend";

function shouldScrubKey(key) {
  return SENSITIVE_KEY_RE.test(String(key || ""));
}

function truncateString(value) {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`;
}

function scrubValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") return truncateString(value);
  if (typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => scrubValue(entry, depth + 1));
  }

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = shouldScrubKey(key) ? "[Filtered]" : scrubValue(entry, depth + 1);
  }
  return out;
}

function scrubRequest(request) {
  if (!request || typeof request !== "object") return request;
  const scrubbed = scrubValue(request);
  if (scrubbed.headers) {
    for (const key of Object.keys(scrubbed.headers)) {
      if (shouldScrubKey(key)) scrubbed.headers[key] = "[Filtered]";
    }
  }
  if (scrubbed.cookies) scrubbed.cookies = "[Filtered]";
  if (scrubbed.data) scrubbed.data = "[Filtered]";
  if (scrubbed.query_string) scrubbed.query_string = "[Filtered]";
  return scrubbed;
}

function scrubEvent(event) {
  const next = { ...event };
  if (next.request) next.request = scrubRequest(next.request);
  if (next.extra) next.extra = scrubValue(next.extra);
  if (next.contexts) next.contexts = scrubValue(next.contexts);
  if (Array.isArray(next.breadcrumbs)) {
    next.breadcrumbs = next.breadcrumbs.map((breadcrumb) => scrubValue(breadcrumb));
  }
  return next;
}

function numericEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function initSentry(options = {}) {
  if (initialized) return true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;

  activeServiceName = options.serviceName || process.env.SERVICE_NAME || activeServiceName;

  try {
    Sentry = require("@sentry/node");
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
      release: process.env.SENTRY_RELEASE || process.env.BUILD_COMMIT || undefined,
      serverName: process.env.HOSTNAME || undefined,
      sendDefaultPii: false,
      tracesSampleRate: numericEnv("SENTRY_TRACES_SAMPLE_RATE", 0),
      profilesSampleRate: numericEnv("SENTRY_PROFILES_SAMPLE_RATE", 0),
      beforeSend: scrubEvent,
      initialScope: {
        tags: {
          app: "trifftools",
          service: activeServiceName,
        },
      },
    });
    initialized = true;
    return true;
  } catch (err) {
    console.warn("[observability] Sentry init skipped:", err.message);
    return false;
  }
}

function applyContext(scope, context = {}) {
  const tags = { service: activeServiceName, ...(context.tags || {}) };
  for (const [key, value] of Object.entries(tags)) {
    if (value != null) scope.setTag(key, String(value));
  }
  if (context.extra) scope.setContext("extra", scrubValue(context.extra));
  if (context.user) scope.setUser(scrubValue(context.user));
  if (context.level) scope.setLevel(context.level);
}

function captureException(error, context = {}) {
  if (!initialized || !Sentry) return;
  try {
    if (typeof Sentry.withScope === "function") {
      Sentry.withScope((scope) => {
        applyContext(scope, context);
        Sentry.captureException(error);
      });
    } else {
      Sentry.captureException(error);
    }
  } catch (captureErr) {
    console.warn("[observability] Sentry capture failed:", captureErr.message);
  }
}

function captureMessage(message, context = {}) {
  if (!initialized || !Sentry) return;
  try {
    if (typeof Sentry.withScope === "function") {
      Sentry.withScope((scope) => {
        applyContext(scope, context);
        Sentry.captureMessage(message, context.level || "error");
      });
    } else {
      Sentry.captureMessage(message);
    }
  } catch (captureErr) {
    console.warn("[observability] Sentry message capture failed:", captureErr.message);
  }
}

function isSentryEnabled() {
  return initialized;
}

module.exports = {
  captureException,
  captureMessage,
  initSentry,
  isSentryEnabled,
  scrubEvent,
  scrubRequest,
  scrubValue,
};
