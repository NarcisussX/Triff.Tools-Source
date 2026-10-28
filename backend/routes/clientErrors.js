/*
 * Receives sanitized frontend runtime errors and forwards them to backend observability.
 */

const router = require("express").Router();
const { captureMessage, scrubValue } = require("../lib/sentry");
const { recordFrontendError } = require("../lib/metrics");

const ALLOWED_SOURCES = new Set(["browser"]);

function safeString(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.slice(0, 2000);
}

function normalizePayload(body) {
  const payload = body && typeof body === "object" ? body : {};
  const source = ALLOWED_SOURCES.has(payload.source) ? payload.source : "browser";
  return {
    source,
    kind: safeString(payload.kind, "error").slice(0, 80),
    message: safeString(payload.message, "Frontend error"),
    stack: safeString(payload.stack),
    url: safeString(payload.url).slice(0, 500),
    userAgent: safeString(payload.userAgent).slice(0, 300),
    line: Number.isFinite(Number(payload.line)) ? Number(payload.line) : null,
    column: Number.isFinite(Number(payload.column)) ? Number(payload.column) : null,
    release: safeString(payload.release).slice(0, 120),
    native: Boolean(payload.native),
  };
}

router.post("/", (req, res) => {
  const payload = normalizePayload(req.body);
  recordFrontendError(payload.source);
  captureMessage(`Frontend ${payload.kind}: ${payload.message}`, {
    level: "error",
    tags: {
      source: payload.source,
      runtime: payload.native ? "native" : "web",
    },
    extra: scrubValue(payload),
  });
  res.status(202).json({ ok: true });
});

module.exports = router;
