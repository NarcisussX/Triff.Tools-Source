const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const siteAuth = require("./siteAuth");

const REQUIRED_SCOPES = [
  "publicData",
  "esi-skills.read_skills.v1",
];
const REQUIRED_DATA_SCOPES = REQUIRED_SCOPES.filter((scope) => scope !== "publicData");
const REQUIRED_SCOPE = REQUIRED_SCOPES.join(" ");
const MONITOR_REQUIRED_SCOPES = Object.freeze([
  "publicData",
  "esi-skills.read_skills.v1",
  "esi-skills.read_skillqueue.v1",
  "esi-clones.read_implants.v1",
  "esi-clones.read_clones.v1",
  "esi-wallet.read_character_wallet.v1",
]);
const MONITOR_DATA_SCOPES = Object.freeze(MONITOR_REQUIRED_SCOPES.filter((scope) => scope !== "publicData"));
const MONITOR_REQUIRED_SCOPE = MONITOR_REQUIRED_SCOPES.join(" ");
const SUPPORTED_SCOPES = new Set([...REQUIRED_SCOPES, ...MONITOR_REQUIRED_SCOPES]);
const SSO_APP_FITTING = "fitting";
const SSO_APP_SKILLNIX = "skillnix";
const AUTHORIZE_URL = "https://login.eveonline.com/v2/oauth/authorize";
const TOKEN_URL = "https://login.eveonline.com/v2/oauth/token";
const JWKS_URL = "https://login.eveonline.com/oauth/jwks";
const STATE_TTL_MS = 10 * 60 * 1000;
const JWKS_TTL_MS = 60 * 60 * 1000;
const ACCESS_TOKEN_SKEW_MS = 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15 * 1000;
const CACHE_TTL_MS = Object.freeze({
  public_profile: 60 * 60 * 1000,
  skills: 5 * 60 * 1000,
  attributes: 5 * 60 * 1000,
  skill_queue: 2 * 60 * 1000,
  implants: 5 * 60 * 1000,
  clones: 2 * 60 * 1000,
  wallet: 5 * 60 * 1000,
});
const MONITOR_KINDS = Object.freeze([
  "public_profile",
  "skills",
  "attributes",
  "skill_queue",
  "implants",
  "clones",
  "wallet",
]);
const KIND_SCOPE = Object.freeze({
  public_profile: null,
  skills: "esi-skills.read_skills.v1",
  attributes: "esi-skills.read_skills.v1",
  skill_queue: "esi-skills.read_skillqueue.v1",
  implants: "esi-clones.read_implants.v1",
  clones: "esi-clones.read_clones.v1",
  wallet: "esi-wallet.read_character_wallet.v1",
});

let schemaReady = false;
let schemaPromise = null;
let jwksCache = { fetchedAt: 0, keys: [] };
let esiErrorBudget = { remaining: null, resetAt: 0 };
const tokenRefreshFlights = new Map();
const monitorRefreshFlights = new Map();

const defaultDependencies = Object.freeze({
  pool,
  fetch: null,
  now: () => Date.now(),
  tokenRequest: null,
  validateAccessToken: null,
  ensureAuthSchema: siteAuth.ensureAuthSchema,
});
let dependencies = { ...defaultDependencies };

function db() {
  return dependencies.pool;
}

function nowMs() {
  return Number(dependencies.now());
}

function nowDate() {
  return new Date(nowMs());
}

async function getFetch() {
  if (typeof dependencies.fetch === "function") return dependencies.fetch;
  if (typeof global.fetch === "function") return global.fetch;
  const mod = await import("node-fetch");
  return mod.default || mod;
}

function requestTimeoutMs() {
  const configured = Number(process.env.ESI_REQUEST_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1000
    ? Math.min(configured, 60 * 1000)
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

function esiBaseUrl() {
  return (process.env.ESI_BASE_URL || "https://esi.evetech.net/latest").replace(/\/+$/, "");
}

function userAgent() {
  return process.env.ESI_USER_AGENT || "triff.tools/character-monitor (+https://triff.tools)";
}

function makeError(code, status = 500, extras = {}) {
  const err = new Error(code);
  err.code = code;
  err.status = status;
  Object.assign(err, extras);
  return err;
}

function safeErrorCode(err) {
  const explicit = String(err?.code || err?.message || "").trim();
  if (/^[a-z][a-z0-9_]{0,79}$/i.test(explicit)) return explicit.toLowerCase();
  const status = Number(err?.status);
  if (status === 401) return "esi_unauthorized";
  if (status === 403) return "esi_forbidden";
  if (status === 404) return "esi_not_found";
  if (status === 420 || status === 429) return "esi_rate_limited";
  if (status >= 500) return "esi_unavailable";
  return "esi_request_failed";
}

function validCharacterId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function validFinite(value, { integer = false, min = null, max = null } = {}) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = integer ? Math.trunc(parsed) : parsed;
  if (min != null && normalized < min) return null;
  if (max != null && normalized > max) return null;
  return normalized;
}

function validDateString(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function ssoConfig(ssoApp = SSO_APP_FITTING) {
  if (ssoApp === SSO_APP_SKILLNIX) {
    return {
      clientId: process.env.SKILLNIX_EVE_SSO_CLIENT_ID || "",
      clientSecret: process.env.SKILLNIX_EVE_SSO_CLIENT_SECRET || "",
      callbackUrl: process.env.SKILLNIX_EVE_SSO_CALLBACK_URL || "",
      clientIdKey: "SKILLNIX_EVE_SSO_CLIENT_ID",
      clientSecretKey: "SKILLNIX_EVE_SSO_CLIENT_SECRET",
      callbackUrlKey: "SKILLNIX_EVE_SSO_CALLBACK_URL",
      encryptionKey: process.env.ESI_TOKEN_ENCRYPTION_KEY || "",
      scopes: MONITOR_REQUIRED_SCOPE,
      ssoApp,
    };
  }
  return {
    clientId: process.env.EVE_SSO_CLIENT_ID || "",
    clientSecret: process.env.EVE_SSO_CLIENT_SECRET || "",
    callbackUrl: process.env.EVE_SSO_CALLBACK_URL || "",
    clientIdKey: "EVE_SSO_CLIENT_ID",
    clientSecretKey: "EVE_SSO_CLIENT_SECRET",
    callbackUrlKey: "EVE_SSO_CALLBACK_URL",
    encryptionKey: process.env.ESI_TOKEN_ENCRYPTION_KEY || "",
    scopes: REQUIRED_SCOPE,
    ssoApp: SSO_APP_FITTING,
  };
}

function configStatusFor(ssoApp = SSO_APP_FITTING) {
  const cfg = ssoConfig(ssoApp);
  const missing = [];
  if (!cfg.clientId) missing.push(cfg.clientIdKey);
  if (!cfg.clientSecret) missing.push(cfg.clientSecretKey);
  if (!cfg.callbackUrl) missing.push(cfg.callbackUrlKey);
  if (!cfg.encryptionKey) missing.push("ESI_TOKEN_ENCRYPTION_KEY");
  return {
    ok: missing.length === 0,
    missing,
    scopes: cfg.scopes,
    monitorScopes: MONITOR_REQUIRED_SCOPE,
    ssoApp: cfg.ssoApp,
  };
}

function configStatus() {
  return configStatusFor(SSO_APP_FITTING);
}

function skillnixConfigStatus() {
  return configStatusFor(SSO_APP_SKILLNIX);
}

function encryptionKey() {
  const key = process.env.ESI_TOKEN_ENCRYPTION_KEY || "";
  if (!key) throw new Error("esi_token_encryption_not_configured");
  if (/^[A-Za-z0-9+/=_-]{43,88}$/.test(key)) {
    try {
      const normalized = key.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = Buffer.from(normalized, "base64");
      if (decoded.length === 32) return decoded;
    } catch {
      // Fall through to SHA-256 derivation.
    }
  }
  return crypto.createHash("sha256").update(key).digest();
}

function encryptToken(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

function decryptToken(value) {
  if (!value) return null;
  const [version, rawIv, rawTag, rawCiphertext] = String(value).split(":");
  if (version !== "v1" || !rawIv || !rawTag || !rawCiphertext) throw new Error("bad_encrypted_token");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(rawIv, "base64url"));
  decipher.setAuthTag(Buffer.from(rawTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(rawCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function hashState(state) {
  return crypto.createHash("sha256").update(String(state)).digest("hex");
}

async function ensureEsiSchema() {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await dependencies.ensureAuthSchema();
      await db().query(`
        CREATE TABLE IF NOT EXISTS fitting_esi_oauth_states (
          id UUID PRIMARY KEY,
          state_hash TEXT UNIQUE NOT NULL,
          user_id BIGINT NOT NULL REFERENCES anoikis_command_users(id) ON DELETE CASCADE,
          sso_app TEXT NOT NULL DEFAULT 'fitting',
          requested_scopes JSONB NOT NULL DEFAULT '["publicData", "esi-skills.read_skills.v1"]'::jsonb,
          return_to TEXT NOT NULL DEFAULT '/fitting',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL
        );

        CREATE INDEX IF NOT EXISTS fitting_esi_oauth_states_expires_idx
          ON fitting_esi_oauth_states(expires_at);

        CREATE TABLE IF NOT EXISTS fitting_esi_characters (
          id UUID PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES anoikis_command_users(id) ON DELETE CASCADE,
          character_id BIGINT NOT NULL,
          sso_app TEXT NOT NULL DEFAULT 'fitting',
          character_name TEXT NOT NULL,
          owner_hash TEXT,
          scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
          access_token_encrypted TEXT,
          refresh_token_encrypted TEXT NOT NULL,
          access_token_expires_at TIMESTAMPTZ,
          skills_json JSONB,
          skills_synced_at TIMESTAMPTZ,
          attributes_json JSONB,
          skill_queue_json JSONB,
          implants_json JSONB,
          clones_json JSONB,
          skillnix_synced_at TIMESTAMPTZ,
          skillnix_last_error TEXT,
          token_status TEXT NOT NULL DEFAULT 'ok',
          last_error TEXT,
          revoked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS fitting_esi_characters_user_idx
          ON fitting_esi_characters(user_id);
      `);
      await db().query(`
        ALTER TABLE fitting_esi_oauth_states
          ADD COLUMN IF NOT EXISTS requested_scopes JSONB
          NOT NULL DEFAULT '["publicData", "esi-skills.read_skills.v1"]'::jsonb;

        ALTER TABLE fitting_esi_oauth_states
          ADD COLUMN IF NOT EXISTS return_to TEXT NOT NULL DEFAULT '/fitting';

        ALTER TABLE fitting_esi_oauth_states
          ADD COLUMN IF NOT EXISTS sso_app TEXT NOT NULL DEFAULT 'fitting';

        ALTER TABLE fitting_esi_characters
          ADD COLUMN IF NOT EXISTS sso_app TEXT NOT NULL DEFAULT 'fitting',
          ADD COLUMN IF NOT EXISTS attributes_json JSONB,
          ADD COLUMN IF NOT EXISTS skill_queue_json JSONB,
          ADD COLUMN IF NOT EXISTS implants_json JSONB,
          ADD COLUMN IF NOT EXISTS clones_json JSONB,
          ADD COLUMN IF NOT EXISTS skillnix_synced_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS skillnix_last_error TEXT;

        ALTER TABLE IF EXISTS triffmon_character_preferences
          ADD COLUMN IF NOT EXISTS sso_app TEXT NOT NULL DEFAULT 'skillnix';

        ALTER TABLE IF EXISTS triffmon_character_preferences
          DROP CONSTRAINT IF EXISTS triffmon_character_preferences_user_id_character_id_fkey;

        ALTER TABLE fitting_esi_characters
          DROP CONSTRAINT IF EXISTS fitting_esi_characters_user_id_character_id_key;

        CREATE UNIQUE INDEX IF NOT EXISTS fitting_esi_characters_user_character_sso_app_key
          ON fitting_esi_characters(user_id, character_id, sso_app);

        DO $$
        BEGIN
          IF to_regclass('public.triffmon_character_preferences') IS NOT NULL THEN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'triffmon_preferences_user_fkey'
                AND conrelid = 'public.triffmon_character_preferences'::regclass
            ) THEN
              ALTER TABLE triffmon_character_preferences
                ADD CONSTRAINT triffmon_preferences_user_fkey
                FOREIGN KEY (user_id) REFERENCES anoikis_command_users(id)
                ON DELETE CASCADE NOT VALID;
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'triffmon_preferences_skillnix_character_fkey'
                AND conrelid = 'public.triffmon_character_preferences'::regclass
            ) THEN
              ALTER TABLE triffmon_character_preferences
                ADD CONSTRAINT triffmon_preferences_skillnix_character_fkey
                FOREIGN KEY (user_id, character_id, sso_app)
                REFERENCES fitting_esi_characters(user_id, character_id, sso_app)
                ON DELETE CASCADE NOT VALID;
            END IF;
          END IF;
        END $$;

        CREATE TABLE IF NOT EXISTS fitting_esi_character_cache (
          character_link_id UUID NOT NULL
            REFERENCES fitting_esi_characters(id) ON DELETE CASCADE,
          data_kind TEXT NOT NULL,
          payload JSONB,
          etag TEXT,
          expires_at TIMESTAMPTZ,
          fetched_at TIMESTAMPTZ,
          last_attempt_at TIMESTAMPTZ,
          last_error_code TEXT,
          last_error_at TIMESTAMPTZ,
          failure_count INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (character_link_id, data_kind)
        );

        CREATE INDEX IF NOT EXISTS fitting_esi_character_cache_freshness_idx
          ON fitting_esi_character_cache(data_kind, expires_at);
      `);
      await db().query(`
        INSERT INTO fitting_esi_character_cache (
          character_link_id, data_kind, payload, expires_at, fetched_at,
          last_attempt_at, updated_at
        )
        SELECT id, 'skills', skills_json,
               skills_synced_at + interval '5 minutes', skills_synced_at,
               skills_synced_at, COALESCE(skills_synced_at, updated_at)
        FROM fitting_esi_characters
        WHERE skills_json IS NOT NULL
        ON CONFLICT (character_link_id, data_kind) DO NOTHING;

        INSERT INTO fitting_esi_character_cache (
          character_link_id, data_kind, payload, expires_at, fetched_at,
          last_attempt_at, updated_at
        )
        SELECT id, 'attributes', attributes_json,
               skillnix_synced_at + interval '5 minutes', skillnix_synced_at,
               skillnix_synced_at, COALESCE(skillnix_synced_at, updated_at)
        FROM fitting_esi_characters
        WHERE attributes_json IS NOT NULL
        ON CONFLICT (character_link_id, data_kind) DO NOTHING;

        INSERT INTO fitting_esi_character_cache (
          character_link_id, data_kind, payload, expires_at, fetched_at,
          last_attempt_at, updated_at
        )
        SELECT id, 'skill_queue', skill_queue_json,
               skillnix_synced_at + interval '2 minutes', skillnix_synced_at,
               skillnix_synced_at, COALESCE(skillnix_synced_at, updated_at)
        FROM fitting_esi_characters
        WHERE skill_queue_json IS NOT NULL
        ON CONFLICT (character_link_id, data_kind) DO NOTHING;

        INSERT INTO fitting_esi_character_cache (
          character_link_id, data_kind, payload, expires_at, fetched_at,
          last_attempt_at, updated_at
        )
        SELECT id, 'implants', implants_json,
               skillnix_synced_at + interval '5 minutes', skillnix_synced_at,
               skillnix_synced_at, COALESCE(skillnix_synced_at, updated_at)
        FROM fitting_esi_characters
        WHERE implants_json IS NOT NULL
        ON CONFLICT (character_link_id, data_kind) DO NOTHING;

        INSERT INTO fitting_esi_character_cache (
          character_link_id, data_kind, payload, expires_at, fetched_at,
          last_attempt_at, updated_at
        )
        SELECT id, 'clones', clones_json,
               skillnix_synced_at + interval '2 minutes', skillnix_synced_at,
               skillnix_synced_at, COALESCE(skillnix_synced_at, updated_at)
        FROM fitting_esi_characters
        WHERE clones_json IS NOT NULL
        ON CONFLICT (character_link_id, data_kind) DO NOTHING;
      `);
      schemaReady = true;
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

function normalizeReturnTo(value, fallback = "/fitting") {
  const text = String(value || "").trim();
  if (!text || text.length > 2048 || /[\u0000-\u001f\\]/.test(text)) return fallback;
  const allowed = ["/fitting", "/skillnix", "/triffmon"].some((prefix) => (
    text === prefix
    || text.startsWith(`${prefix}/`)
    || text.startsWith(`${prefix}?`)
    || text.startsWith(`${prefix}#`)
  ));
  return allowed ? text : fallback;
}

function callbackHtml({ ok, message, characterId = null, characterName = null, returnTo = "/fitting" }) {
  const safe = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const payload = JSON.stringify({
    type: "TRIFF_EVE_SSO_COMPLETE",
    ok: Boolean(ok),
    characterId,
    characterName,
    message,
    returnTo: normalizeReturnTo(returnTo),
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>triff.tools EVE SSO</title>
  <style>
    body { margin: 0; background: #05070b; color: #d6e2f1; font: 13px system-ui, sans-serif; display: grid; min-height: 100vh; place-items: center; }
    main { border: 1px solid #2c2f36; background: #070910; padding: 18px; width: min(440px, calc(100vw - 32px)); }
    h1 { margin: 0 0 8px; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: ${ok ? "#9dffbd" : "#ffaaaa"}; }
    p { margin: 0; color: #94a3b8; line-height: 1.45; }
  </style>
</head>
<body>
  <main>
    <h1>${ok ? "Character linked" : "EVE SSO failed"}</h1>
    <p>${safe(message || (ok ? "You can close this tab." : "Return to Triff.Tools and try again."))}</p>
    <p style="margin-top:12px"><a style="color:#8bd3ff" href="${safe(normalizeReturnTo(returnTo))}">Return to Triff.Tools</a></p>
  </main>
  <script>
    (function () {
      var message = ${payload};
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(message, window.location.origin);
        if (message.ok) window.setTimeout(function () { window.close(); }, 1400);
      } else if (message.ok && message.returnTo) {
        window.setTimeout(function () { window.location.replace(message.returnTo); }, 900);
      }
    }());
  </script>
</body>
</html>`;
}

function normalizeRequestedScopes(value = REQUIRED_SCOPES) {
  const input = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\s+/)
      : REQUIRED_SCOPES;
  const scopes = [];
  for (const rawScope of input) {
    const scope = String(rawScope || "").trim();
    if (!scope || scopes.includes(scope)) continue;
    if (!SUPPORTED_SCOPES.has(scope)) {
      throw makeError("unsupported_esi_scope", 400, { scope });
    }
    scopes.push(scope);
  }
  if (!scopes.includes("publicData")) scopes.unshift("publicData");
  return scopes;
}

async function createLoginUrlForApp(userId, options = {}, ssoApp = SSO_APP_FITTING) {
  await ensureEsiSchema();
  const status = configStatusFor(ssoApp);
  if (!status.ok) {
    throw makeError("esi_not_configured", 503, { missing: status.missing });
  }
  const requestedScopes = normalizeRequestedScopes(
    Array.isArray(options) || typeof options === "string"
      ? options
      : options?.scopes || REQUIRED_SCOPES
  );
  const returnTo = normalizeReturnTo(
    !Array.isArray(options) && typeof options === "object" ? options?.returnTo : null,
    ssoApp === SSO_APP_SKILLNIX ? "/skillnix" : "/fitting",
  );

  await db().query("DELETE FROM fitting_esi_oauth_states WHERE expires_at < now()");
  const state = crypto.randomBytes(32).toString("base64url");
  await db().query(
    `INSERT INTO fitting_esi_oauth_states (
       id, state_hash, user_id, sso_app, requested_scopes, return_to, expires_at
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [
      crypto.randomUUID(),
      hashState(state),
      userId,
      ssoApp,
      JSON.stringify(requestedScopes),
      returnTo,
      new Date(nowMs() + STATE_TTL_MS),
    ]
  );

  const url = new URL(AUTHORIZE_URL);
  const cfg = ssoConfig(ssoApp);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", cfg.callbackUrl);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("scope", requestedScopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

async function createLoginUrl(userId, options = {}) {
  return createLoginUrlForApp(userId, options, SSO_APP_FITTING);
}

async function createMonitorLoginUrl(userId, options = {}) {
  return createLoginUrlForApp(
    userId,
    { ...options, scopes: MONITOR_REQUIRED_SCOPES },
    SSO_APP_SKILLNIX,
  );
}

async function consumeState(state, ssoApp = SSO_APP_FITTING) {
  await ensureEsiSchema();
  const { rows } = await db().query(
    `DELETE FROM fitting_esi_oauth_states
     WHERE state_hash = $1 AND sso_app = $2 AND expires_at > now()
     RETURNING user_id, sso_app, requested_scopes, return_to`,
    [hashState(state), ssoApp]
  );
  if (!rows[0]) return null;
  return {
    userId: rows[0].user_id,
    ssoApp: rows[0].sso_app,
    requestedScopes: normalizeRequestedScopes(rows[0].requested_scopes || REQUIRED_SCOPES),
    returnTo: normalizeReturnTo(
      rows[0].return_to,
      ssoApp === SSO_APP_SKILLNIX ? "/skillnix" : "/fitting",
    ),
  };
}

async function consumeOAuthState(state) {
  return consumeState(state, SSO_APP_FITTING);
}

async function consumeSkillnixOAuthState(state) {
  return consumeState(state, SSO_APP_SKILLNIX);
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const wanted = String(name).toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === wanted);
  return entry ? String(entry[1]) : null;
}

function retryAfterMs(headers) {
  const raw = headerValue(headers, "retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.trunc(seconds * 1000);
  const date = new Date(raw).getTime();
  return Number.isFinite(date) ? Math.max(0, date - nowMs()) : null;
}

function responseExpiry(headers) {
  const cacheControl = headerValue(headers, "cache-control");
  if (cacheControl) {
    const directives = String(cacheControl).split(",").map((value) => value.trim());
    for (const directiveName of ["s-maxage", "max-age"]) {
      const directive = directives.find((value) => new RegExp(`^${directiveName}\\s*=`, "i").test(value));
      if (!directive) continue;
      const rawSeconds = directive.slice(directive.indexOf("=") + 1).trim().replace(/^"|"$/g, "");
      if (!/^\d+$/.test(rawSeconds)) continue;
      const seconds = Number(rawSeconds);
      if (Number.isSafeInteger(seconds) && seconds >= 0) {
        return new Date(nowMs() + seconds * 1000);
      }
    }
  }
  const raw = headerValue(headers, "expires");
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function updateEsiErrorBudget(headers) {
  const rawRemaining = headerValue(headers, "x-esi-error-limit-remain");
  const rawReset = headerValue(headers, "x-esi-error-limit-reset");
  const remaining = rawRemaining == null ? null : Number(rawRemaining);
  const resetSeconds = rawReset == null ? null : Number(rawReset);
  if (remaining != null && Number.isFinite(remaining)) esiErrorBudget.remaining = remaining;
  if (resetSeconds != null && Number.isFinite(resetSeconds) && resetSeconds >= 0) {
    esiErrorBudget.resetAt = nowMs() + resetSeconds * 1000;
  }
}

function enforceEsiErrorBudget() {
  if (
    Number.isFinite(esiErrorBudget.remaining)
    && esiErrorBudget.remaining <= 2
    && esiErrorBudget.resetAt > nowMs()
  ) {
    throw makeError("esi_error_budget_limited", 503, {
      retryAfterMs: esiErrorBudget.resetAt - nowMs(),
    });
  }
}

async function responseBody(response) {
  let text = "";
  if (typeof response.text === "function") text = await response.text();
  else if (typeof response.json === "function") return response.json();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw makeError("remote_response_bad_json", 502);
  }
}

function remoteErrorCode(body, fallback) {
  const raw = String(body?.error || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  return raw && raw.length <= 80 ? raw : fallback;
}

async function fetchWithTimeout(url, options = {}) {
  const fetch = await getFetch();
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = setTimeout(() => controller?.abort(), requestTimeoutMs());
  try {
    return await fetch(url, {
      ...options,
      signal: controller?.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError" || controller?.signal?.aborted) {
      throw makeError("esi_request_timeout", 504);
    }
    throw makeError("esi_network_error", 503);
  } finally {
    clearTimeout(timeout);
  }
}

async function tokenRequest(params, ssoApp = SSO_APP_FITTING) {
  const cfg = ssoConfig(ssoApp);
  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "User-Agent": userAgent(),
    },
    body: new URLSearchParams(params),
  });
  let body = null;
  try {
    body = await responseBody(response);
  } catch (err) {
    if (response.ok) throw err;
  }
  if (!response.ok) {
    throw makeError(
      remoteErrorCode(body, `eve_sso_token_${response.status}`),
      response.status,
      { retryAfterMs: retryAfterMs(response.headers) }
    );
  }
  if (!body || typeof body !== "object") throw makeError("eve_sso_token_bad_response", 502);
  return body;
}

async function fetchJwks({ force = false } = {}) {
  if (!force && nowMs() - jwksCache.fetchedAt < JWKS_TTL_MS && jwksCache.keys.length) return jwksCache.keys;
  const response = await fetchWithTimeout(JWKS_URL, {
    headers: { Accept: "application/json", "User-Agent": userAgent() },
  });
  if (!response.ok) throw makeError(`jwks_${response.status}`, 502);
  const body = await responseBody(response);
  jwksCache = { fetchedAt: nowMs(), keys: Array.isArray(body?.keys) ? body.keys : [] };
  return jwksCache.keys;
}

function scopesFromClaims(claims) {
  const raw = claims.scp ?? claims.scope ?? [];
  if (Array.isArray(raw)) return raw.map(String);
  return String(raw || "").split(/\s+/).filter(Boolean);
}

function missingRequiredScopes(scopes = []) {
  return missingScopesFor(scopes, REQUIRED_DATA_SCOPES);
}

function missingMonitorScopes(scopes = []) {
  return missingScopesFor(scopes, MONITOR_DATA_SCOPES);
}

function missingScopesFor(scopes = [], requiredScopes = []) {
  const granted = new Set((Array.isArray(scopes) ? scopes : []).map(String));
  return requiredScopes.filter((scope) => scope !== "publicData" && !granted.has(scope));
}

async function validateAccessToken(
  accessToken,
  requiredScopes = REQUIRED_DATA_SCOPES,
  ssoApp = SSO_APP_FITTING,
) {
  const decoded = jwt.decode(accessToken, { complete: true });
  const kid = decoded?.header?.kid;
  let keys = await fetchJwks();
  let jwk = kid ? keys.find((key) => key.kid === kid) : null;
  if (kid && !jwk) {
    keys = await fetchJwks({ force: true });
    jwk = keys.find((key) => key.kid === kid);
  }
  if (!jwk && !kid) jwk = keys.find((key) => key.alg === "RS256");
  if (!jwk) throw makeError("jwks_key_not_found", 401);
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const claims = jwt.verify(accessToken, publicKey, {
    algorithms: ["RS256"],
    issuer: ["login.eveonline.com", "https://login.eveonline.com"],
  });

  const cfg = ssoConfig(ssoApp);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud].filter(Boolean);
  if (!aud.includes("EVE Online") || !aud.includes(cfg.clientId)) throw makeError("bad_token_audience", 401);
  if (claims.azp && claims.azp !== cfg.clientId) throw makeError("bad_token_client", 401);

  const scopes = scopesFromClaims(claims);
  const missingScopes = missingScopesFor(scopes, requiredScopes);
  if (missingScopes.length) {
    throw makeError("missing_required_scope", 409, {
      missingScopes,
      reauthRequired: true,
    });
  }

  const sub = String(claims.sub || "");
  const match = sub.match(/^CHARACTER:EVE:(\d+)$/);
  if (!match || !validCharacterId(match[1])) throw makeError("bad_character_subject", 401);
  const expiresAtMs = Number(claims.exp) * 1000;

  return {
    characterId: Number(match[1]),
    characterName: String(claims.name || `Character ${match[1]}`).slice(0, 255),
    ownerHash: claims.owner ? String(claims.owner).slice(0, 255) : null,
    scopes: [...new Set(scopes)],
    expiresAt: Number.isFinite(expiresAtMs) && expiresAtMs > 0 ? new Date(expiresAtMs) : null,
  };
}

function normalizeSkillsResponse(body = {}) {
  const skills = {};
  const skill_details = {};
  const items = [];
  for (const row of Array.isArray(body.skills) ? body.skills : []) {
    const typeId = validCharacterId(row?.skill_id ?? row?.typeID ?? row?.typeId);
    const level = validFinite(row?.trained_skill_level ?? row?.level, { integer: true });
    if (typeId && level != null) {
      const trainedLevel = Math.max(0, Math.min(5, Math.trunc(level)));
      const activeLevel = validFinite(row.active_skill_level, { integer: true, min: 0 });
      const skillpoints = validFinite(row.skillpoints_in_skill, { integer: true, min: 0 });
      const detail = {
        trained_skill_level: trainedLevel,
        active_skill_level: activeLevel == null ? trainedLevel : Math.min(5, activeLevel),
        skillpoints_in_skill: skillpoints,
      };
      skills[String(typeId)] = trainedLevel;
      skill_details[String(typeId)] = detail;
      items.push({
        skillTypeId: typeId,
        skill_id: typeId,
        level: trainedLevel,
        ...detail,
      });
    }
  }
  items.sort((a, b) => a.skillTypeId - b.skillTypeId);
  return {
    skills,
    skill_details,
    items,
    total_sp: validFinite(body.total_sp, { integer: true, min: 0 }),
    unallocated_sp: validFinite(body.unallocated_sp, { integer: true, min: 0 }),
    synced_at: nowDate().toISOString(),
  };
}

function normalizeAttributesResponse(body = {}) {
  const names = ["charisma", "intelligence", "memory", "perception", "willpower"];
  const attributes = {};
  const items = [];
  for (const name of names) {
    const value = validFinite(body?.[name], { integer: true, min: 0, max: 100 });
    attributes[name] = value;
    if (value != null) items.push({ name, value });
  }
  return {
    ...attributes,
    attributes,
    items,
    bonus_remaps: validFinite(body?.bonus_remaps, { integer: true, min: 0 }),
    accrued_remap_cooldown_date: validDateString(body?.accrued_remap_cooldown_date),
    last_remap_date: validDateString(body?.last_remap_date),
    synced_at: nowDate().toISOString(),
  };
}

function normalizeSkillQueueResponse(body = []) {
  const queue = [];
  for (const row of Array.isArray(body) ? body : []) {
    const skillId = validCharacterId(row?.skill_id ?? row?.skillTypeId);
    if (!skillId) continue;
    const queuePosition = validFinite(row.queue_position, { integer: true, min: 0 });
    const finishedLevel = validFinite(row.finished_level, { integer: true, min: 0, max: 5 });
    const normalized = {
      id: `${skillId}-${queuePosition ?? queue.length}`,
      skillTypeId: skillId,
      skill_id: skillId,
      queuePosition,
      queue_position: queuePosition,
      targetLevel: finishedLevel,
      finished_level: finishedLevel,
      training_start_sp: validFinite(row.training_start_sp, { integer: true, min: 0 }),
      level_start_sp: validFinite(row.level_start_sp, { integer: true, min: 0 }),
      level_end_sp: validFinite(row.level_end_sp, { integer: true, min: 0 }),
      start_date: validDateString(row.start_date),
      finish_date: validDateString(row.finish_date),
      pause_date: validDateString(row.pause_date),
    };
    normalized.startAt = normalized.start_date;
    normalized.endAt = normalized.finish_date;
    normalized.startSp = normalized.level_start_sp;
    normalized.endSp = normalized.level_end_sp;
    normalized.completedSp = normalized.training_start_sp;
    queue.push(normalized);
  }
  queue.sort((a, b) => (a.queue_position ?? Number.MAX_SAFE_INTEGER) - (b.queue_position ?? Number.MAX_SAFE_INTEGER));
  return { queue, items: queue, synced_at: nowDate().toISOString() };
}

function normalizeImplantsResponse(body = []) {
  const implants = [];
  const seen = new Set();
  for (const raw of Array.isArray(body) ? body : []) {
    const typeId = validCharacterId(raw);
    if (!typeId || seen.has(typeId)) continue;
    seen.add(typeId);
    implants.push(typeId);
  }
  return {
    implants,
    items: implants.map((typeId) => ({ typeId, type_id: typeId })),
    synced_at: nowDate().toISOString(),
  };
}

function normalizeClonesResponse(body = {}) {
  const source = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const jumpClones = [];
  const seenCloneIds = new Set();
  for (const row of Array.isArray(source.jump_clones) ? source.jump_clones : []) {
    const jumpCloneId = validCharacterId(row?.jump_clone_id ?? row?.jumpCloneId);
    const locationId = validCharacterId(row?.location_id ?? row?.locationId);
    const locationType = ["station", "structure"].includes(String(row?.location_type ?? row?.locationType))
      ? String(row.location_type ?? row.locationType)
      : null;
    if (!jumpCloneId || !locationId || !locationType || seenCloneIds.has(jumpCloneId)) continue;
    seenCloneIds.add(jumpCloneId);
    const normalizedImplants = normalizeImplantsResponse(row.implants).implants;
    jumpClones.push({
      jumpCloneId,
      jump_clone_id: jumpCloneId,
      name: safeText(row.name, 255),
      locationId,
      location_id: locationId,
      locationType,
      location_type: locationType,
      implants: normalizedImplants,
      implantItems: normalizedImplants.map((typeId) => ({ typeId, type_id: typeId })),
    });
  }

  const rawHome = source.home_location ?? source.homeLocation;
  const homeLocationId = validCharacterId(rawHome?.location_id ?? rawHome?.locationId);
  const homeLocationType = ["station", "structure"].includes(String(rawHome?.location_type ?? rawHome?.locationType))
    ? String(rawHome.location_type ?? rawHome.locationType)
    : null;
  const homeLocation = homeLocationId && homeLocationType
    ? {
        locationId: homeLocationId,
        location_id: homeLocationId,
        locationType: homeLocationType,
        location_type: homeLocationType,
      }
    : null;
  const lastCloneJumpDate = validDateString(source.last_clone_jump_date ?? source.lastCloneJumpDate);
  const lastStationChangeDate = validDateString(source.last_station_change_date ?? source.lastStationChangeDate);

  return {
    homeLocation,
    home_location: homeLocation,
    jumpClones,
    jump_clones: jumpClones,
    items: jumpClones,
    lastCloneJumpDate,
    last_clone_jump_date: lastCloneJumpDate,
    lastStationChangeDate,
    last_station_change_date: lastStationChangeDate,
    synced_at: nowDate().toISOString(),
  };
}

function normalizeWalletResponse(body) {
  return {
    balance: validFinite(body),
    synced_at: nowDate().toISOString(),
  };
}

function safeText(value, maxLength = 1000) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizePublicProfileResponse(body = {}, context = {}) {
  const characterId = validCharacterId(context.characterId);
  const corporationId = validCharacterId(body.corporation_id);
  const allianceId = validCharacterId(body.alliance_id);
  const corporationName = safeText(context.corporation?.name, 255);
  const allianceName = safeText(context.alliance?.name, 255);
  const portraitUrl = characterId
    ? `https://images.evetech.net/characters/${characterId}/portrait?size=256`
    : null;
  return {
    character_id: characterId,
    name: safeText(body.name, 255),
    description: safeText(body.description, 4000),
    gender: safeText(body.gender, 32),
    birthday: validDateString(body.birthday),
    security_status: validFinite(body.security_status, { min: -10, max: 10 }),
    race_id: validCharacterId(body.race_id),
    bloodline_id: validCharacterId(body.bloodline_id),
    ancestry_id: validCharacterId(body.ancestry_id),
    corporation_id: corporationId,
    corporation_name: corporationName,
    corporationName,
    alliance_id: allianceId,
    alliance_name: allianceName,
    allianceName,
    portrait_url: portraitUrl,
    portraitUrl,
    synced_at: nowDate().toISOString(),
  };
}

function esiStatusError(status, headers) {
  let code = `esi_http_${status}`;
  if (status === 401) code = "esi_unauthorized";
  else if (status === 403) code = "esi_forbidden";
  else if (status === 404) code = "esi_not_found";
  else if (status === 420 || status === 429) code = "esi_rate_limited";
  else if (status >= 500) code = "esi_unavailable";
  return makeError(code, status, { retryAfterMs: retryAfterMs(headers) });
}

async function requestEsiResource(path, { accessToken = null, etag = null } = {}) {
  enforceEsiErrorBudget();
  const separator = path.includes("?") ? "&" : "?";
  const url = `${esiBaseUrl()}${path}${separator}datasource=tranquility`;
  const headers = {
    Accept: "application/json",
    "User-Agent": userAgent(),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (etag) headers["If-None-Match"] = etag;
  const response = await fetchWithTimeout(url, { headers });
  updateEsiErrorBudget(response.headers);
  const metadata = {
    etag: headerValue(response.headers, "etag") || etag || null,
    expiresAt: responseExpiry(response.headers),
  };
  if (response.status === 304) return { ...metadata, notModified: true, body: null };
  if (!response.ok) throw esiStatusError(response.status, response.headers);
  const body = await responseBody(response);
  return { ...metadata, notModified: false, body };
}

async function fetchSkills(characterId, accessToken, options = {}) {
  const response = await requestEsiResource(
    `/characters/${encodeURIComponent(characterId)}/skills/`,
    { accessToken, etag: options.etag || null }
  );
  return response.notModified
    ? response
    : { ...response, body: normalizeSkillsResponse(response.body || {}) };
}

function scopesArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return value.split(/\s+/).filter(Boolean);
    }
  }
  return [];
}

function oneFlight(map, key, task) {
  const active = map.get(key);
  if (active) return active;
  const promise = Promise.resolve().then(task);
  map.set(key, promise);
  promise.finally(() => {
    if (map.get(key) === promise) map.delete(key);
  }).catch(() => {});
  return promise;
}

function accessTokenReusable(character, requiredScopes = []) {
  if (!character?.access_token_encrypted || !character?.access_token_expires_at) return false;
  if (missingScopesFor(scopesArray(character.scopes), requiredScopes).length) return false;
  const expiresAt = new Date(character.access_token_expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt - ACCESS_TOKEN_SKEW_MS > nowMs();
}

function assertTokenIdentity(character, claims) {
  if (Number(claims.characterId) !== Number(character.character_id)) {
    throw makeError("character_token_mismatch", 401, { reauthRequired: true });
  }
  if (
    character.owner_hash
    && !claims.ownerHash
  ) {
    throw makeError("character_owner_unverifiable", 401, { reauthRequired: true });
  }
  if (
    character.owner_hash
    && String(character.owner_hash) !== String(claims.ownerHash)
  ) {
    throw makeError("character_owner_changed", 401, { reauthRequired: true });
  }
}

function ssoAppForCharacter(character) {
  return character?.sso_app === SSO_APP_SKILLNIX ? SSO_APP_SKILLNIX : SSO_APP_FITTING;
}

async function markTokenFailure(userId, characterId, err, ssoApp = SSO_APP_FITTING) {
  const code = safeErrorCode(err);
  const identityFailure = [
    "character_owner_changed",
    "character_owner_unverifiable",
    "character_token_mismatch",
  ].includes(code);
  const reauthFailure = identityFailure
    || [
      "invalid_grant",
      "invalid_token",
      "esi_unauthorized",
      "esi_forbidden",
      "bad_token_audience",
      "bad_token_client",
    ].includes(code);
  const missingScope = code === "missing_required_scope" || code === "missing_monitor_scopes";
  const tokenStatus = missingScope ? "missing_scopes" : reauthFailure ? "reauth_required" : "error";
  await db().query(
    `UPDATE fitting_esi_characters
     SET token_status = $3,
         last_error = $4,
         revoked_at = CASE WHEN $5::boolean THEN now() ELSE revoked_at END,
         updated_at = now()
     WHERE user_id = $1 AND character_id = $2 AND sso_app = $6`,
    [userId, characterId, tokenStatus, code, identityFailure, ssoApp]
  );
}

async function refreshAccessTokenLocked(userId, characterId, requiredScopes, ssoApp = SSO_APP_FITTING) {
  const client = await db().connect();
  let failure = null;
  let result = null;
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT * FROM fitting_esi_characters
       WHERE user_id = $1 AND character_id = $2 AND sso_app = $3 AND revoked_at IS NULL
       LIMIT 1
       FOR UPDATE`,
      [userId, characterId, ssoApp]
    );
    const character = locked.rows[0];
    if (!character) throw makeError("character_not_found", 404);
    const missingScopes = missingScopesFor(scopesArray(character.scopes), requiredScopes);
    if (missingScopes.length) {
      throw makeError("missing_required_scope", 409, {
        missingScopes,
        reauthRequired: true,
      });
    }

    if (accessTokenReusable(character, requiredScopes)) {
      result = { accessToken: decryptToken(character.access_token_encrypted), character };
      await client.query("COMMIT");
      return result;
    }

    const refreshToken = decryptToken(character.refresh_token_encrypted);
    if (!refreshToken) throw makeError("missing_refresh_token", 401, { reauthRequired: true });
    const requestToken = dependencies.tokenRequest || tokenRequest;
    const token = await requestToken({ grant_type: "refresh_token", refresh_token: refreshToken }, ssoApp);
    if (!token?.access_token) throw makeError("eve_sso_token_bad_response", 502);
    const validateToken = dependencies.validateAccessToken || validateAccessToken;
    const claims = await validateToken(token.access_token, requiredScopes, ssoApp);
    assertTokenIdentity(character, claims);
    const nextRefreshToken = token.refresh_token || refreshToken;
    const expiresAt = claims.expiresAt
      || new Date(nowMs() + Math.max(60, Number(token.expires_in) || 1200) * 1000);
    const updated = await client.query(
      `UPDATE fitting_esi_characters
       SET character_name = $3,
           owner_hash = COALESCE(owner_hash, $4),
           scopes = $5::jsonb,
           access_token_encrypted = $6,
           refresh_token_encrypted = $7,
           access_token_expires_at = $8,
           token_status = 'ok',
           last_error = NULL,
           updated_at = now()
       WHERE user_id = $1 AND character_id = $2 AND sso_app = $9 AND revoked_at IS NULL
       RETURNING *`,
      [
        userId,
        characterId,
        claims.characterName,
        claims.ownerHash,
        JSON.stringify(claims.scopes),
        encryptToken(token.access_token),
        encryptToken(nextRefreshToken),
        expiresAt,
        ssoApp,
      ]
    );
    result = { accessToken: token.access_token, character: updated.rows[0] || character };
    await client.query("COMMIT");
    return result;
  } catch (err) {
    failure = err;
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original token error.
    }
  } finally {
    client.release();
  }
  if (failure?.code !== "character_not_found") {
    await markTokenFailure(userId, characterId, failure, ssoApp);
  }
  throw failure;
}

async function accessTokenForCharacter(character, requiredScopes = []) {
  const missingScopes = missingScopesFor(scopesArray(character.scopes), requiredScopes);
  if (missingScopes.length) {
    throw makeError("missing_required_scope", 409, {
      missingScopes,
      reauthRequired: true,
    });
  }
  if (accessTokenReusable(character, requiredScopes)) {
    try {
      return { accessToken: decryptToken(character.access_token_encrypted), character };
    } catch {
      // A corrupt/rotated access-token ciphertext can still recover through the refresh token.
    }
  }
  const key = String(character.id || `${character.user_id}:${character.character_id}`);
  const ssoApp = ssoAppForCharacter(character);
  return oneFlight(tokenRefreshFlights, key, () => refreshAccessTokenLocked(
    character.user_id,
    character.character_id,
    requiredScopes,
    ssoApp,
  ));
}

function cacheRowsToMap(rows = []) {
  const out = {};
  for (const row of rows) {
    if (!MONITOR_KINDS.includes(row.data_kind)) continue;
    out[row.data_kind] = row;
  }
  return out;
}

async function cacheForCharacterLink(characterLinkId) {
  const { rows } = await db().query(
    `SELECT character_link_id, data_kind, payload, etag, expires_at, fetched_at,
            last_attempt_at, last_error_code, last_error_at, failure_count, updated_at
     FROM fitting_esi_character_cache
     WHERE character_link_id = $1`,
    [characterLinkId]
  );
  return cacheRowsToMap(rows);
}

function cacheIsFresh(entry) {
  if (!entry?.payload || !entry?.expires_at) return false;
  const expiresAt = new Date(entry.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt > nowMs();
}

function fallbackExpiry(kind) {
  return new Date(nowMs() + (CACHE_TTL_MS[kind] || 2 * 60 * 1000));
}

async function writeCacheSuccess(characterLinkId, kind, payload, metadata = {}) {
  let expiresAt = metadata.expiresAt instanceof Date ? metadata.expiresAt : new Date(metadata.expiresAt || 0);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= nowMs()) expiresAt = fallbackExpiry(kind);
  await db().query(
    `INSERT INTO fitting_esi_character_cache (
       character_link_id, data_kind, payload, etag, expires_at, fetched_at,
       last_attempt_at, last_error_code, last_error_at, failure_count, updated_at
     )
     VALUES ($1, $2, $3::jsonb, $4, $5, now(), now(), NULL, NULL, 0, now())
     ON CONFLICT (character_link_id, data_kind)
     DO UPDATE SET payload = EXCLUDED.payload,
                   etag = EXCLUDED.etag,
                   expires_at = EXCLUDED.expires_at,
                   fetched_at = now(),
                   last_attempt_at = now(),
                   last_error_code = NULL,
                   last_error_at = NULL,
                   failure_count = 0,
                   updated_at = now()`,
    [characterLinkId, kind, JSON.stringify(payload), metadata.etag || null, expiresAt]
  );
}

async function writeCacheNotModified(characterLinkId, kind, metadata = {}) {
  let expiresAt = metadata.expiresAt instanceof Date ? metadata.expiresAt : new Date(metadata.expiresAt || 0);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= nowMs()) expiresAt = fallbackExpiry(kind);
  await db().query(
    `UPDATE fitting_esi_character_cache
     SET etag = COALESCE($3, etag),
         expires_at = $4,
         fetched_at = now(),
         last_attempt_at = now(),
         last_error_code = NULL,
         last_error_at = NULL,
         failure_count = 0,
         updated_at = now()
     WHERE character_link_id = $1 AND data_kind = $2`,
    [characterLinkId, kind, metadata.etag || null, expiresAt]
  );
}

async function writeCacheFailure(characterLinkId, kind, err) {
  const code = safeErrorCode(err);
  await db().query(
    `INSERT INTO fitting_esi_character_cache (
       character_link_id, data_kind, last_attempt_at, last_error_code,
       last_error_at, failure_count, updated_at
     )
     VALUES ($1, $2, now(), $3, now(), 1, now())
     ON CONFLICT (character_link_id, data_kind)
     DO UPDATE SET last_attempt_at = now(),
                   last_error_code = EXCLUDED.last_error_code,
                   last_error_at = now(),
                   failure_count = fitting_esi_character_cache.failure_count + 1,
                   updated_at = now()`,
    [characterLinkId, kind, code]
  );
}

async function mirrorLegacyCache(userId, characterId, kind, payload, ssoApp = SSO_APP_FITTING) {
  if (kind === "skills") {
    await db().query(
      `UPDATE fitting_esi_characters
       SET skills_json = $3::jsonb, skills_synced_at = now(), updated_at = now()
       WHERE user_id = $1 AND character_id = $2 AND sso_app = $4`,
      [userId, characterId, JSON.stringify(payload), ssoApp]
    );
  } else if (kind === "attributes") {
    await db().query(
      `UPDATE fitting_esi_characters
       SET attributes_json = $3::jsonb, skillnix_synced_at = now(),
           skillnix_last_error = NULL, updated_at = now()
       WHERE user_id = $1 AND character_id = $2 AND sso_app = $4`,
      [userId, characterId, JSON.stringify(payload), ssoApp]
    );
  } else if (kind === "skill_queue") {
    await db().query(
      `UPDATE fitting_esi_characters
       SET skill_queue_json = $3::jsonb, skillnix_synced_at = now(),
           skillnix_last_error = NULL, updated_at = now()
       WHERE user_id = $1 AND character_id = $2 AND sso_app = $4`,
      [userId, characterId, JSON.stringify(payload), ssoApp]
    );
  } else if (kind === "implants") {
    await db().query(
      `UPDATE fitting_esi_characters
       SET implants_json = $3::jsonb, skillnix_synced_at = now(),
           skillnix_last_error = NULL, updated_at = now()
       WHERE user_id = $1 AND character_id = $2 AND sso_app = $4`,
      [userId, characterId, JSON.stringify(payload), ssoApp]
    );
  } else if (kind === "clones") {
    await db().query(
      `UPDATE fitting_esi_characters
       SET clones_json = $3::jsonb, skillnix_synced_at = now(),
           skillnix_last_error = NULL, updated_at = now()
       WHERE user_id = $1 AND character_id = $2 AND sso_app = $4`,
      [userId, characterId, JSON.stringify(payload), ssoApp]
    );
  }
}

async function fetchPublicProfile(characterId, options = {}) {
  const character = await requestEsiResource(
    `/characters/${encodeURIComponent(characterId)}/`,
    { etag: options.etag || null }
  );
  if (character.notModified) return character;
  const body = character.body && typeof character.body === "object" ? character.body : {};
  const corporationId = validCharacterId(body.corporation_id);
  const allianceId = validCharacterId(body.alliance_id);
  const [corporation, alliance] = await Promise.all([
    corporationId
      ? requestEsiResource(`/corporations/${corporationId}/`).then((value) => value.body).catch(() => null)
      : null,
    allianceId
      ? requestEsiResource(`/alliances/${allianceId}/`).then((value) => value.body).catch(() => null)
      : null,
  ]);
  const cached = options.cachedPayload && typeof options.cachedPayload === "object"
    ? options.cachedPayload
    : {};
  const corporationIdentity = corporation || (
    Number(cached.corporation_id) === corporationId
      ? { name: cached.corporation_name || cached.corporationName }
      : null
  );
  const allianceIdentity = alliance || (
    Number(cached.alliance_id) === allianceId
      ? { name: cached.alliance_name || cached.allianceName }
      : null
  );
  return {
    ...character,
    body: normalizePublicProfileResponse(body, {
      characterId,
      corporation: corporationIdentity,
      alliance: allianceIdentity,
    }),
  };
}

async function fetchMonitorKind(kind, characterId, accessToken, cacheEntry = null) {
  const options = { accessToken, etag: cacheEntry?.etag || null };
  if (kind === "public_profile") {
    return fetchPublicProfile(characterId, { ...options, cachedPayload: cacheEntry?.payload || null });
  }
  if (kind === "skills") return fetchSkills(characterId, accessToken, options);
  let path;
  let normalize;
  if (kind === "attributes") {
    path = `/characters/${encodeURIComponent(characterId)}/attributes/`;
    normalize = normalizeAttributesResponse;
  } else if (kind === "skill_queue") {
    path = `/characters/${encodeURIComponent(characterId)}/skillqueue/`;
    normalize = normalizeSkillQueueResponse;
  } else if (kind === "implants") {
    path = `/characters/${encodeURIComponent(characterId)}/implants/`;
    normalize = normalizeImplantsResponse;
  } else if (kind === "clones") {
    path = `/characters/${encodeURIComponent(characterId)}/clones/`;
    normalize = normalizeClonesResponse;
  } else if (kind === "wallet") {
    path = `/characters/${encodeURIComponent(characterId)}/wallet/`;
    normalize = normalizeWalletResponse;
  } else {
    throw makeError("unsupported_monitor_data_kind", 400);
  }
  const response = await requestEsiResource(path, options);
  return response.notModified ? response : { ...response, body: normalize(response.body) };
}

async function refreshCharacterSkills(userId, characterId, { force = false } = {}) {
  await ensureEsiSchema();
  const status = configStatus();
  if (!status.ok) {
    throw makeError("esi_not_configured", 503, { missing: status.missing });
  }
  const normalizedCharacterId = validCharacterId(characterId);
  if (!normalizedCharacterId) throw makeError("invalid_character_id", 400);
  const { rows } = await db().query(
    `SELECT * FROM fitting_esi_characters
     WHERE user_id = $1 AND character_id = $2 AND sso_app = 'fitting' AND revoked_at IS NULL
     LIMIT 1`,
    [userId, normalizedCharacterId]
  );
  const character = rows[0];
  if (!character) throw makeError("character_not_found", 404);

  if (
    !force
    && character.skills_synced_at
    && nowMs() - new Date(character.skills_synced_at).getTime() < CACHE_TTL_MS.skills
  ) {
    return safeCharacter(character);
  }

  const cache = await cacheForCharacterLink(character.id);
  try {
    const auth = await accessTokenForCharacter(character, REQUIRED_DATA_SCOPES);
    const response = await fetchSkills(character.character_id, auth.accessToken, {
      etag: cache.skills?.etag || null,
    });
    if (response.notModified) {
      await writeCacheNotModified(character.id, "skills", response);
      await db().query(
        `UPDATE fitting_esi_characters
         SET skills_synced_at = now(), token_status = 'ok', last_error = NULL, updated_at = now()
         WHERE user_id = $1 AND character_id = $2 AND sso_app = 'fitting'`,
        [userId, character.character_id]
      );
    } else {
      await writeCacheSuccess(character.id, "skills", response.body, response);
      await mirrorLegacyCache(userId, character.character_id, "skills", response.body, SSO_APP_FITTING);
      await db().query(
        `UPDATE fitting_esi_characters
         SET token_status = 'ok', last_error = NULL, updated_at = now()
         WHERE user_id = $1 AND character_id = $2 AND sso_app = 'fitting'`,
        [userId, character.character_id]
      );
    }
    const updated = await db().query(
      `SELECT * FROM fitting_esi_characters
       WHERE user_id = $1 AND character_id = $2 AND sso_app = 'fitting' AND revoked_at IS NULL
       LIMIT 1`,
      [userId, character.character_id]
    );
    return safeCharacter(updated.rows[0]);
  } catch (err) {
    await writeCacheFailure(character.id, "skills", err);
    if ([401, 403].includes(Number(err?.status)) || err?.code === "missing_required_scope") {
      await markTokenFailure(userId, character.character_id, err, SSO_APP_FITTING);
    } else {
      await db().query(
        `UPDATE fitting_esi_characters
         SET token_status = 'error', last_error = $3, updated_at = now()
         WHERE user_id = $1 AND character_id = $2 AND sso_app = 'fitting'`,
        [userId, character.character_id, safeErrorCode(err)]
      );
    }
    throw err;
  }
}

async function linkCharacterFromCodeForApp(state, code, ssoApp = SSO_APP_FITTING) {
  if (!state || !code) throw makeError("missing_oauth_state_or_code", 400);
  const stateRecord = await consumeState(state, ssoApp);
  if (!stateRecord) throw makeError("invalid_or_expired_oauth_state", 400);
  const { userId, requestedScopes, returnTo } = stateRecord;
  try {
    const cfg = ssoConfig(ssoApp);
    const requestToken = dependencies.tokenRequest || tokenRequest;
    const token = await requestToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.callbackUrl,
    }, ssoApp);
    if (!token?.access_token || !token?.refresh_token) {
      throw makeError("eve_sso_token_bad_response", 502);
    }
    const validateToken = dependencies.validateAccessToken || validateAccessToken;
    const requiredDataScopes = requestedScopes.filter((scope) => scope !== "publicData");
    const claims = await validateToken(token.access_token, requiredDataScopes, ssoApp);
    const expiresAt = claims.expiresAt
      || new Date(nowMs() + Math.max(60, Number(token.expires_in) || 1200) * 1000);
    const stored = await db().query(
      `INSERT INTO fitting_esi_characters (
         id, user_id, character_id, sso_app, character_name, owner_hash, scopes,
         access_token_encrypted, refresh_token_encrypted, access_token_expires_at,
         token_status, last_error
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, 'ok', NULL)
       ON CONFLICT (user_id, character_id, sso_app)
       DO UPDATE SET
         character_name = EXCLUDED.character_name,
         owner_hash = EXCLUDED.owner_hash,
         scopes = EXCLUDED.scopes,
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
         access_token_expires_at = EXCLUDED.access_token_expires_at,
         token_status = 'ok',
         last_error = NULL,
         revoked_at = NULL,
         updated_at = now()
       RETURNING *`,
      [
        crypto.randomUUID(),
        userId,
        claims.characterId,
        ssoApp,
        claims.characterName,
        claims.ownerHash,
        JSON.stringify(claims.scopes),
        encryptToken(token.access_token),
        encryptToken(token.refresh_token),
        expiresAt,
      ]
    );
    let syncError = null;
    try {
      if (ssoApp === SSO_APP_SKILLNIX) {
        await refreshCharacterMonitor(userId, claims.characterId, { force: true });
      } else {
        await refreshCharacterSkills(userId, claims.characterId, { force: true });
      }
    } catch (err) {
      syncError = safeErrorCode(err);
    }
    return {
      userId,
      characterId: claims.characterId,
      characterName: claims.characterName,
      requestedScopes,
      returnTo,
      monitorMissingScopes: missingMonitorScopes(claims.scopes),
      syncError,
      linkedAt: stored.rows[0]?.updated_at || nowDate().toISOString(),
    };
  } catch (err) {
    err.returnTo = returnTo;
    throw err;
  }
}

async function linkCharacterFromCode(state, code) {
  return linkCharacterFromCodeForApp(state, code, SSO_APP_FITTING);
}

async function linkSkillnixCharacterFromCode(state, code) {
  return linkCharacterFromCodeForApp(state, code, SSO_APP_SKILLNIX);
}

function safeCharacter(row) {
  if (!row) return null;
  const skills = row.skills_json || {};
  const scopes = scopesArray(row.scopes);
  const missingScopes = missingRequiredScopes(scopes);
  const storedStatus = String(row.token_status || "ok");
  return {
    id: String(row.id),
    characterId: Number(row.character_id),
    characterName: row.character_name,
    scopes,
    requiredScopes: [...REQUIRED_SCOPES],
    missingScopes,
    skillsSyncedAt: row.skills_synced_at || null,
    tokenStatus: missingScopes.length ? "missing_scopes" : storedStatus,
    reauthRequired: missingScopes.length > 0 || storedStatus === "reauth_required",
    lastError: row.last_error ? safeErrorCode({ message: row.last_error }) : null,
    totalSp: skills.total_sp ?? null,
    unallocatedSp: skills.unallocated_sp ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listCharacters(userId) {
  await ensureEsiSchema();
  const { rows } = await db().query(
    `SELECT * FROM fitting_esi_characters
     WHERE user_id = $1 AND sso_app = 'fitting' AND revoked_at IS NULL
     ORDER BY lower(character_name) ASC`,
    [userId]
  );
  return rows.map(safeCharacter);
}

function isoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function cacheFreshness(cache = {}) {
  const result = {};
  for (const kind of MONITOR_KINDS) {
    const entry = cache[kind] || null;
    result[kind] = {
      available: Boolean(entry?.payload),
      fetchedAt: isoDate(entry?.fetched_at),
      expiresAt: isoDate(entry?.expires_at),
      lastAttemptAt: isoDate(entry?.last_attempt_at),
      isStale: !cacheIsFresh(entry) || Boolean(entry?.last_error_code),
      lastError: entry?.last_error_code ? safeErrorCode({ message: entry.last_error_code }) : null,
      lastErrorAt: isoDate(entry?.last_error_at),
      failureCount: Math.max(0, Number(entry?.failure_count) || 0),
    };
  }
  return result;
}

function latestDate(values) {
  const times = values
    .filter((value) => value != null && value !== "")
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function queueRows(cache = {}) {
  const payload = cache.skill_queue?.payload;
  if (Array.isArray(payload)) return normalizeSkillQueueResponse(payload).queue;
  if (Array.isArray(payload?.queue)) return payload.queue;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function skillPayload(row, cache = {}) {
  return cache.skills?.payload || row.skills_json || null;
}

function inferredCloneStateFromSkills(skills = {}) {
  const details = skills.skill_details && typeof skills.skill_details === "object"
    ? Object.values(skills.skill_details)
    : Array.isArray(skills.items) ? skills.items : [];
  return details.some((skill) => {
    const trained = Number(skill?.trained_skill_level ?? skill?.trainedLevel ?? skill?.level);
    const active = Number(skill?.active_skill_level ?? skill?.activeLevel ?? trained);
    return Number.isFinite(trained) && Number.isFinite(active) && active < trained;
  }) ? "alpha" : null;
}

function monitorCharacter(row, cache = {}) {
  if (!row) return null;
  const publicProfile = cache.public_profile?.payload || {};
  const skills = skillPayload(row, cache) || {};
  const queue = queueRows(cache);
  const wallet = cache.wallet?.payload || {};
  const scopes = scopesArray(row.scopes);
  const monitorMissingScopes = missingMonitorScopes(scopes);
  const freshness = cacheFreshness(cache);
  const errors = Object.values(freshness).map((item) => item.lastError).filter(Boolean);
  const queueEndAt = latestDate(queue.map((item) => item.finish_date || item.endAt));
  const currentTime = nowMs();
  const currentTraining = queue.find((item) => {
    const start = new Date(item.start_date || item.startAt || 0).getTime();
    const finish = new Date(item.finish_date || item.endAt || 0).getTime();
    return Number.isFinite(start) && start <= currentTime && Number.isFinite(finish) && finish > currentTime;
  }) || null;
  const nextTraining = queue.find((item) => {
    const start = new Date(item.start_date || item.startAt || 0).getTime();
    const finish = new Date(item.finish_date || item.endAt || 0).getTime();
    return Number.isFinite(start) && start > currentTime && Number.isFinite(finish) && finish > currentTime;
  }) || null;
  const unfinishedQueue = queue.some((item) => {
    const finish = new Date(item.finish_date || item.endAt || 0).getTime();
    return !Number.isFinite(finish) || finish > currentTime;
  });
  const queueState = currentTraining ? "active" : nextTraining ? "gap" : unfinishedQueue ? "paused" : "empty";
  const cloneState = inferredCloneStateFromSkills(skills);
  const lastUpdatedAt = latestDate([
    row.skills_synced_at,
    ...Object.values(cache).map((entry) => entry?.fetched_at),
  ]);
  const preferences = row.monitor_preferences && typeof row.monitor_preferences === "object"
    ? row.monitor_preferences
    : {};
  const storedStatus = String(row.token_status || "ok");
  const reauthRequired = monitorMissingScopes.length > 0 || storedStatus === "reauth_required";
  return {
    id: String(row.id),
    characterId: Number(row.character_id),
    characterName: publicProfile.name || row.character_name,
    name: publicProfile.name || row.character_name,
    portraitUrl: publicProfile.portrait_url || null,
    corporationId: publicProfile.corporation_id || null,
    corporationName: publicProfile.corporation_name || null,
    allianceId: publicProfile.alliance_id || null,
    allianceName: publicProfile.alliance_name || null,
    totalSp: skills.total_sp ?? null,
    unallocatedSp: skills.unallocated_sp ?? null,
    walletBalance: wallet.balance ?? null,
    cloneState,
    cloneStateInferred: cloneState !== null,
    currentTraining,
    nextTraining,
    queueState,
    queueEndAt,
    queueDurationSeconds: queueEndAt
      ? Math.max(0, Math.trunc((new Date(queueEndAt).getTime() - nowMs()) / 1000))
      : null,
    queueLength: queue.length,
    tokenStatus: storedStatus === "reauth_required"
      ? "reauth_required"
      : monitorMissingScopes.length
        ? "missing_scopes"
        : storedStatus,
    scopes,
    monitorRequiredScopes: [...MONITOR_REQUIRED_SCOPES],
    monitorMissingScopes,
    missingScopes: monitorMissingScopes,
    reauthRequired,
    skillsSyncedAt: row.skills_synced_at || null,
    lastUpdatedAt,
    monitorSyncedAt: lastUpdatedAt,
    stale: reauthRequired || Object.values(freshness).some((item) => item.isStale),
    error: errors[0] || (row.last_error ? safeErrorCode({ message: row.last_error }) : null),
    monitorLastError: errors[0] || (row.last_error ? safeErrorCode({ message: row.last_error }) : null),
    pinned: Boolean(preferences.pinned),
    hidden: Boolean(preferences.hidden),
    group: safeText(preferences.group, 120),
    preferences: {
      pinned: Boolean(preferences.pinned),
      hidden: Boolean(preferences.hidden),
      group: safeText(preferences.group, 120),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function monitorSnapshot(row, cache = {}) {
  if (!row) return null;
  const character = monitorCharacter(row, cache);
  const skills = skillPayload(row, cache);
  const attributes = cache.attributes?.payload || null;
  const skillQueue = cache.skill_queue?.payload || null;
  const implants = cache.implants?.payload || null;
  const clones = cache.clones?.payload || null;
  const wallet = cache.wallet?.payload || null;
  const publicProfile = cache.public_profile?.payload || null;
  const freshness = cacheFreshness(cache);
  const errors = Object.values(freshness).map((item) => item.lastError).filter(Boolean);
  return {
    character,
    skills,
    skillItems: Array.isArray(skills?.items) ? skills.items : [],
    queue: skillQueue,
    queueItems: queueRows(cache),
    skillQueue,
    attributes,
    attributeItems: Array.isArray(attributes?.items) ? attributes.items : [],
    implants,
    implantItems: Array.isArray(implants?.items) ? implants.items : [],
    clones,
    jumpClones: Array.isArray(clones?.jumpClones)
      ? clones.jumpClones
      : Array.isArray(clones?.jump_clones) ? clones.jump_clones : [],
    wallet,
    publicProfile,
    fetchedAt: latestDate(Object.values(cache).map((entry) => entry?.fetched_at)),
    stale: character.stale,
    error: errors[0] || character.error,
    data: {
      publicProfile,
      skills,
      attributes,
      skillQueue,
      implants,
      clones,
      wallet,
    },
    freshness,
    requiredScopes: [...MONITOR_REQUIRED_SCOPES],
    missingScopes: character.monitorMissingScopes,
    reauthRequired: character.reauthRequired,
  };
}

async function listMonitorCharacters(userId) {
  await ensureEsiSchema();
  const characters = await db().query(
    `SELECT * FROM fitting_esi_characters
     WHERE user_id = $1 AND sso_app = 'skillnix' AND revoked_at IS NULL
     ORDER BY lower(character_name) ASC`,
    [userId]
  );
  if (!characters.rows.length) return [];
  const ids = characters.rows.map((row) => row.id);
  const cached = await db().query(
    `SELECT character_link_id, data_kind, payload, etag, expires_at, fetched_at,
            last_attempt_at, last_error_code, last_error_at, failure_count, updated_at
     FROM fitting_esi_character_cache
     WHERE character_link_id = ANY($1::uuid[])`,
    [ids]
  );
  const byCharacter = new Map();
  for (const row of cached.rows) {
    const key = String(row.character_link_id);
    if (!byCharacter.has(key)) byCharacter.set(key, []);
    byCharacter.get(key).push(row);
  }
  return characters.rows.map((row) => monitorCharacter(
    row,
    cacheRowsToMap(byCharacter.get(String(row.id)) || [])
  ));
}

async function characterMonitorSnapshotForUser(userId, characterId) {
  await ensureEsiSchema();
  const normalizedCharacterId = validCharacterId(characterId);
  if (!normalizedCharacterId) throw makeError("invalid_character_id", 400);
  const result = await db().query(
    `SELECT * FROM fitting_esi_characters
     WHERE user_id = $1 AND character_id = $2 AND sso_app = 'skillnix' AND revoked_at IS NULL
     LIMIT 1`,
    [userId, normalizedCharacterId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return monitorSnapshot(row, await cacheForCharacterLink(row.id));
}

async function refreshCharacterMonitorInternal(userId, character) {
  const cache = await cacheForCharacterLink(character.id);
  const scopes = scopesArray(character.scopes);
  const force = Boolean(character.__forceRefresh);
  const summary = {
    requestedAt: nowDate().toISOString(),
    force,
    refreshedKinds: [],
    notModifiedKinds: [],
    skippedFreshKinds: [],
    skippedMissingScopeKinds: [],
    failedKinds: [],
  };
  const dueKinds = [];
  for (const kind of MONITOR_KINDS) {
    const requiredScope = KIND_SCOPE[kind];
    if (requiredScope && !scopes.includes(requiredScope)) {
      summary.skippedMissingScopeKinds.push(kind);
    } else if (!force && cacheIsFresh(cache[kind])) {
      summary.skippedFreshKinds.push(kind);
    } else {
      dueKinds.push(kind);
    }
  }

  const privateKinds = dueKinds.filter((kind) => KIND_SCOPE[kind]);
  let accessToken = null;
  let authError = null;
  if (privateKinds.length) {
    const requiredScopes = [...new Set(privateKinds.map((kind) => KIND_SCOPE[kind]))];
    try {
      const auth = await accessTokenForCharacter(character, requiredScopes);
      accessToken = auth.accessToken;
      character = auth.character || character;
    } catch (err) {
      authError = err;
      await Promise.all(privateKinds.map((kind) => writeCacheFailure(character.id, kind, err)));
      for (const kind of privateKinds) {
        summary.failedKinds.push({
          kind,
          error: safeErrorCode(err),
          retryAfterMs: Number.isFinite(Number(err?.retryAfterMs)) ? Number(err.retryAfterMs) : null,
        });
      }
    }
  }

  const runnableKinds = dueKinds.filter((kind) => !KIND_SCOPE[kind] || accessToken);
  await Promise.all(runnableKinds.map(async (kind) => {
    try {
      const response = await fetchMonitorKind(kind, character.character_id, accessToken, cache[kind]);
      if (response.notModified) {
        await writeCacheNotModified(character.id, kind, response);
        if (kind === "skills") {
          await db().query(
            `UPDATE fitting_esi_characters
             SET skills_synced_at = now(), token_status = 'ok', last_error = NULL, updated_at = now()
             WHERE user_id = $1 AND character_id = $2 AND sso_app = 'skillnix'`,
            [userId, character.character_id]
          );
        }
        summary.notModifiedKinds.push(kind);
      } else {
        await writeCacheSuccess(character.id, kind, response.body, response);
        await mirrorLegacyCache(userId, character.character_id, kind, response.body, SSO_APP_SKILLNIX);
        summary.refreshedKinds.push(kind);
      }
    } catch (err) {
      await writeCacheFailure(character.id, kind, err);
      if ([401, 403].includes(Number(err?.status))) {
        await markTokenFailure(userId, character.character_id, err, SSO_APP_SKILLNIX);
      }
      summary.failedKinds.push({
        kind,
        error: safeErrorCode(err),
        retryAfterMs: Number.isFinite(Number(err?.retryAfterMs)) ? Number(err.retryAfterMs) : null,
      });
    }
  }));

  const tokenRejected = summary.failedKinds.some((item) => [
    "esi_unauthorized",
    "esi_forbidden",
    "invalid_grant",
    "character_owner_changed",
    "character_owner_unverifiable",
    "character_token_mismatch",
  ].includes(item.error));
  if (accessToken && !tokenRejected) {
    await db().query(
      `UPDATE fitting_esi_characters
       SET token_status = 'ok', last_error = NULL, updated_at = now()
       WHERE user_id = $1 AND character_id = $2 AND sso_app = 'skillnix' AND revoked_at IS NULL`,
      [userId, character.character_id]
    );
  }

  const updated = await characterMonitorSnapshotForUser(userId, character.character_id);
  if (!updated && authError) throw authError;
  return { ...updated, sync: summary };
}

async function refreshCharacterMonitor(userId, characterId, { force = false } = {}) {
  await ensureEsiSchema();
  const status = skillnixConfigStatus();
  if (!status.ok) throw makeError("esi_not_configured", 503, { missing: status.missing });
  const normalizedCharacterId = validCharacterId(characterId);
  if (!normalizedCharacterId) throw makeError("invalid_character_id", 400);
  const result = await db().query(
    `SELECT * FROM fitting_esi_characters
     WHERE user_id = $1 AND character_id = $2 AND sso_app = 'skillnix' AND revoked_at IS NULL
     LIMIT 1`,
    [userId, normalizedCharacterId]
  );
  const character = result.rows[0];
  if (!character) throw makeError("character_not_found", 404);
  const key = `${character.id}:monitor`;
  return oneFlight(monitorRefreshFlights, key, () => refreshCharacterMonitorInternal(
    userId,
    { ...character, __forceRefresh: Boolean(force) }
  ));
}

async function unlinkCharacter(userId, characterId) {
  await ensureEsiSchema();
  const normalizedCharacterId = validCharacterId(characterId);
  if (!normalizedCharacterId) return false;
  const result = await db().query(
    `DELETE FROM fitting_esi_characters
     WHERE user_id = $1 AND character_id = $2 AND sso_app = 'fitting'`,
    [userId, normalizedCharacterId]
  );
  return result.rowCount > 0;
}

async function unlinkMonitorCharacter(userId, characterId) {
  await ensureEsiSchema();
  const normalizedCharacterId = validCharacterId(characterId);
  if (!normalizedCharacterId) return false;
  const result = await db().query(
    `DELETE FROM fitting_esi_characters
     WHERE user_id = $1 AND character_id = $2 AND sso_app = 'skillnix'`,
    [userId, normalizedCharacterId]
  );
  return result.rowCount > 0;
}

async function skillProfileForUser(userId, profile) {
  if (profile?.mode === "alpha_clone") return { mode: "alpha_clone" };
  if (!profile || profile.mode !== "esi_character") return { mode: "all_v" };
  if (!userId) {
    return { mode: "all_v", warning: "Character skills require sign-in; using All V." };
  }
  await ensureEsiSchema();
  const characterId = validCharacterId(profile.characterId);
  if (!characterId) return { mode: "all_v", warning: "Invalid character profile; using All V." };
  const { rows } = await db().query(
    `SELECT character_id, character_name, skills_json, skills_synced_at, token_status
     FROM fitting_esi_characters
     WHERE user_id = $1 AND character_id = $2 AND sso_app = 'fitting' AND revoked_at IS NULL
     LIMIT 1`,
    [userId, characterId]
  );
  const row = rows[0];
  if (!row || !row.skills_json?.skills) {
    return { mode: "all_v", warning: "Selected character has no cached skills yet; using All V." };
  }
  return {
    mode: "esi_character",
    characterId: Number(row.character_id),
    characterName: row.character_name,
    skills: row.skills_json.skills || {},
    skillsSyncedAt: row.skills_synced_at || null,
    tokenStatus: row.token_status || "ok",
  };
}

function setTestDependencies(overrides = {}) {
  dependencies = { ...defaultDependencies, ...overrides };
  schemaReady = false;
  schemaPromise = null;
  jwksCache = { fetchedAt: 0, keys: [] };
  esiErrorBudget = { remaining: null, resetAt: 0 };
  tokenRefreshFlights.clear();
  monitorRefreshFlights.clear();
}

function resetTestDependencies() {
  setTestDependencies({});
}

module.exports = {
  REQUIRED_SCOPE,
  REQUIRED_SCOPES,
  REQUIRED_DATA_SCOPES,
  MONITOR_REQUIRED_SCOPE,
  MONITOR_REQUIRED_SCOPES,
  MONITOR_DATA_SCOPES,
  SSO_APP_FITTING,
  SSO_APP_SKILLNIX,
  callbackHtml,
  configStatus,
  skillnixConfigStatus,
  createLoginUrl,
  createMonitorLoginUrl,
  consumeOAuthState,
  consumeSkillnixOAuthState,
  ensureEsiSchema,
  linkCharacterFromCode,
  linkSkillnixCharacterFromCode,
  listCharacters,
  listMonitorCharacters,
  missingRequiredScopes,
  missingMonitorScopes,
  normalizeAttributesResponse,
  normalizeClonesResponse,
  normalizeImplantsResponse,
  normalizePublicProfileResponse,
  normalizeSkillQueueResponse,
  normalizeSkillsResponse,
  normalizeWalletResponse,
  characterMonitorSnapshotForUser,
  refreshCharacterMonitor,
  refreshCharacterSkills,
  skillProfileForUser,
  unlinkCharacter,
  unlinkMonitorCharacter,
  __testing: {
    accessTokenForCharacter,
    assertTokenIdentity,
    cacheFreshness,
    encryptToken,
    decryptToken,
    fetchMonitorKind,
    monitorCharacter,
    monitorSnapshot,
    inferredCloneStateFromSkills,
    normalizeRequestedScopes,
    normalizeReturnTo,
    ssoConfig,
    configStatusFor,
    consumeState,
    linkCharacterFromCodeForApp,
    requestEsiResource,
    resetTestDependencies,
    safeCharacter,
    safeErrorCode,
    setTestDependencies,
  },
};
