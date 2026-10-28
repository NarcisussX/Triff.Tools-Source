const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const siteAuth = require("./siteAuth");

const REQUIRED_SCOPES = ["esi-fittings.read_fittings.v1"];
const REQUIRED_SCOPE = REQUIRED_SCOPES.join(" ");
const AUTHORIZE_URL = "https://login.eveonline.com/v2/oauth/authorize";
const TOKEN_URL = "https://login.eveonline.com/v2/oauth/token";
const JWKS_URL = "https://login.eveonline.com/oauth/jwks";
const ESI_BASE_URL = process.env.ESI_BASE_URL || "https://esi.evetech.net/latest";
const STATE_TTL_MS = 10 * 60 * 1000;
const JWKS_TTL_MS = 60 * 60 * 1000;

let schemaReady = false;
let schemaPromise = null;
let jwksCache = { fetchedAt: 0, keys: [] };

async function getFetch() {
  if (typeof global.fetch === "function") return global.fetch;
  const mod = await import("node-fetch");
  return mod.default || mod;
}

function config() {
  return {
    clientId: process.env.EVE_FITTINGS_SSO_CLIENT_ID || "",
    clientSecret: process.env.EVE_FITTINGS_SSO_CLIENT_SECRET || "",
    callbackUrl: process.env.EVE_FITTINGS_SSO_CALLBACK_URL || "",
    encryptionKey: process.env.ESI_TOKEN_ENCRYPTION_KEY || "",
    scopes: REQUIRED_SCOPE,
  };
}

function configStatus() {
  const cfg = config();
  const missing = [];
  if (!cfg.clientId) missing.push("EVE_FITTINGS_SSO_CLIENT_ID");
  if (!cfg.clientSecret) missing.push("EVE_FITTINGS_SSO_CLIENT_SECRET");
  if (!cfg.callbackUrl) missing.push("EVE_FITTINGS_SSO_CALLBACK_URL");
  if (!cfg.encryptionKey) missing.push("ESI_TOKEN_ENCRYPTION_KEY");
  return {
    ok: missing.length === 0,
    missing,
    scopes: REQUIRED_SCOPE,
  };
}

function encryptionKey() {
  const key = config().encryptionKey;
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
      await siteAuth.ensureAuthSchema();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS in_game_fitting_esi_oauth_states (
          id UUID PRIMARY KEY,
          state_hash TEXT UNIQUE NOT NULL,
          user_id BIGINT NOT NULL REFERENCES anoikis_command_users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL
        );

        CREATE INDEX IF NOT EXISTS in_game_fitting_esi_oauth_states_expires_idx
          ON in_game_fitting_esi_oauth_states(expires_at);

        CREATE TABLE IF NOT EXISTS in_game_fitting_esi_characters (
          id UUID PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES anoikis_command_users(id) ON DELETE CASCADE,
          character_id BIGINT NOT NULL,
          character_name TEXT NOT NULL,
          owner_hash TEXT,
          scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
          access_token_encrypted TEXT,
          refresh_token_encrypted TEXT NOT NULL,
          access_token_expires_at TIMESTAMPTZ,
          token_status TEXT NOT NULL DEFAULT 'ok',
          last_error TEXT,
          revoked_at TIMESTAMPTZ,
          last_fittings_fetch_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE(user_id, character_id)
        );

        CREATE INDEX IF NOT EXISTS in_game_fitting_esi_characters_user_idx
          ON in_game_fitting_esi_characters(user_id);
      `);
      schemaReady = true;
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

function callbackHtml({ ok, message, characterId = null, characterName = null }) {
  const safe = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const payload = JSON.stringify({
    type: "TRIFF_IN_GAME_FITTINGS_SSO_COMPLETE",
    ok: Boolean(ok),
    characterId,
    characterName,
    message,
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>triff.tools In-Game Fittings SSO</title>
  <style>
    body { margin: 0; background: #05070b; color: #d6e2f1; font: 13px system-ui, sans-serif; display: grid; min-height: 100vh; place-items: center; }
    main { border: 1px solid #2c2f36; background: #070910; padding: 18px; width: min(440px, calc(100vw - 32px)); }
    h1 { margin: 0 0 8px; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: ${ok ? "#9dffbd" : "#ffaaaa"}; }
    p { margin: 0; color: #94a3b8; line-height: 1.45; }
  </style>
</head>
<body>
  <main>
    <h1>${ok ? "In-game fittings authorized" : "EVE SSO failed"}</h1>
    <p>${safe(message || (ok ? "You can close this tab." : "Return to /fitting and try again."))}</p>
  </main>
  <script>
    (function () {
      var message = ${payload};
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(message, "*");
        if (message.ok) window.setTimeout(function () { window.close(); }, 1400);
      }
    }());
  </script>
</body>
</html>`;
}

async function createLoginUrl(userId) {
  await ensureEsiSchema();
  const status = configStatus();
  if (!status.ok) {
    const err = new Error(`missing_config:${status.missing.join(",")}`);
    err.code = "esi_not_configured";
    err.missing = status.missing;
    throw err;
  }

  await pool.query("DELETE FROM in_game_fitting_esi_oauth_states WHERE expires_at < now()");
  const state = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO in_game_fitting_esi_oauth_states (id, state_hash, user_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [crypto.randomUUID(), hashState(state), userId, new Date(Date.now() + STATE_TTL_MS)]
  );

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config().callbackUrl);
  url.searchParams.set("client_id", config().clientId);
  url.searchParams.set("scope", REQUIRED_SCOPE);
  url.searchParams.set("state", state);
  return url.toString();
}

async function consumeState(state) {
  await ensureEsiSchema();
  const { rows } = await pool.query(
    `DELETE FROM in_game_fitting_esi_oauth_states
     WHERE state_hash = $1 AND expires_at > now()
     RETURNING user_id`,
    [hashState(state)]
  );
  return rows[0]?.user_id || null;
}

async function tokenRequest(params) {
  const cfg = config();
  const fetch = await getFetch();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams(params),
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: "bad_json" };
  }
  if (!response.ok) {
    const err = new Error(body.error || `eve_sso_token_${response.status}`);
    err.status = response.status;
    throw err;
  }
  return body;
}

async function fetchJwks() {
  if (Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS && jwksCache.keys.length) return jwksCache.keys;
  const fetch = await getFetch();
  const response = await fetch(JWKS_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`jwks_${response.status}`);
  const body = await response.json();
  jwksCache = { fetchedAt: Date.now(), keys: body.keys || [] };
  return jwksCache.keys;
}

function scopesFromClaims(claims) {
  const raw = claims.scp ?? claims.scope ?? [];
  if (Array.isArray(raw)) return raw.map(String);
  return String(raw || "").split(/\s+/).filter(Boolean);
}

function missingRequiredScopes(scopes = []) {
  const granted = new Set((Array.isArray(scopes) ? scopes : []).map(String));
  return REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
}

async function validateAccessToken(accessToken) {
  const decoded = jwt.decode(accessToken, { complete: true });
  const kid = decoded?.header?.kid;
  const keys = await fetchJwks();
  const jwk = keys.find((key) => key.kid === kid) || keys.find((key) => key.alg === "RS256");
  if (!jwk) throw new Error("jwks_key_not_found");
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const claims = jwt.verify(accessToken, publicKey, {
    algorithms: ["RS256"],
    issuer: ["login.eveonline.com", "https://login.eveonline.com"],
  });

  const cfg = config();
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud].filter(Boolean);
  if (!aud.includes("EVE Online") || !aud.includes(cfg.clientId)) throw new Error("bad_token_audience");
  if (claims.azp && claims.azp !== cfg.clientId) throw new Error("bad_token_client");

  const scopes = scopesFromClaims(claims);
  const missingScopes = missingRequiredScopes(scopes);
  if (missingScopes.length) {
    const err = new Error("missing_required_scope");
    err.missingScopes = missingScopes;
    throw err;
  }

  const sub = String(claims.sub || "");
  const match = sub.match(/^CHARACTER:EVE:(\d+)$/);
  if (!match) throw new Error("bad_character_subject");

  return {
    characterId: Number(match[1]),
    characterName: String(claims.name || `Character ${match[1]}`),
    ownerHash: claims.owner ? String(claims.owner) : null,
    scopes,
    expiresAt: claims.exp ? new Date(Number(claims.exp) * 1000) : null,
  };
}

async function linkCharacterFromCode(state, code) {
  if (!state || !code) throw new Error("missing_oauth_state_or_code");
  const userId = await consumeState(state);
  if (!userId) throw new Error("invalid_or_expired_oauth_state");

  const token = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: config().callbackUrl,
  });
  const claims = await validateAccessToken(token.access_token);
  const expiresAt = claims.expiresAt || new Date(Date.now() + Number(token.expires_in || 1200) * 1000);
  await pool.query(
    `INSERT INTO in_game_fitting_esi_characters (
       id, user_id, character_id, character_name, owner_hash, scopes,
       access_token_encrypted, refresh_token_encrypted, access_token_expires_at,
       token_status, last_error
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, 'ok', NULL)
     ON CONFLICT (user_id, character_id)
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
       updated_at = now()`,
    [
      crypto.randomUUID(),
      userId,
      claims.characterId,
      claims.characterName,
      claims.ownerHash,
      JSON.stringify(claims.scopes),
      encryptToken(token.access_token),
      encryptToken(token.refresh_token),
      expiresAt,
    ]
  );
  return {
    userId,
    characterId: claims.characterId,
    characterName: claims.characterName,
  };
}

function safeCharacter(row) {
  if (!row) return null;
  const scopes = Array.isArray(row.scopes) ? row.scopes : [];
  const missingScopes = missingRequiredScopes(scopes);
  return {
    id: String(row.id),
    characterId: Number(row.character_id),
    characterName: row.character_name,
    ownerHash: row.owner_hash || null,
    scopes,
    requiredScopes: REQUIRED_SCOPES,
    missingScopes,
    tokenStatus: missingScopes.length ? "missing_scopes" : row.token_status || "ok",
    lastError: row.last_error || null,
    lastFittingsFetchAt: row.last_fittings_fetch_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listCharacters(userId) {
  await ensureEsiSchema();
  const { rows } = await pool.query(
    `SELECT * FROM in_game_fitting_esi_characters
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY lower(character_name) ASC`,
    [userId]
  );
  return rows.map(safeCharacter);
}

async function unlinkCharacter(userId, characterId) {
  await ensureEsiSchema();
  const result = await pool.query(
    `DELETE FROM in_game_fitting_esi_characters
     WHERE user_id = $1 AND character_id = $2`,
    [userId, characterId]
  );
  return result.rowCount > 0;
}

async function refreshedAccessTokenForCharacter(userId, characterId) {
  await ensureEsiSchema();
  const status = configStatus();
  if (!status.ok) {
    const err = new Error("esi_not_configured");
    err.missing = status.missing;
    throw err;
  }

  const { rows } = await pool.query(
    `SELECT * FROM in_game_fitting_esi_characters
     WHERE user_id = $1 AND character_id = $2 AND revoked_at IS NULL
     LIMIT 1`,
    [userId, characterId]
  );
  const character = rows[0];
  if (!character) {
    const err = new Error("character_not_found");
    err.status = 404;
    throw err;
  }

  try {
    const refreshToken = decryptToken(character.refresh_token_encrypted);
    const token = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    const claims = await validateAccessToken(token.access_token);
    if (Number(claims.characterId) !== Number(character.character_id)) throw new Error("character_token_mismatch");
    const nextRefreshToken = token.refresh_token || refreshToken;
    const expiresAt = claims.expiresAt || new Date(Date.now() + Number(token.expires_in || 1200) * 1000);
    const { rows: updated } = await pool.query(
      `UPDATE in_game_fitting_esi_characters
       SET
         character_name = $3,
         owner_hash = COALESCE($4, owner_hash),
         scopes = $5::jsonb,
         access_token_encrypted = $6,
         refresh_token_encrypted = $7,
         access_token_expires_at = $8,
         token_status = 'ok',
         last_error = NULL,
         updated_at = now()
       WHERE user_id = $1 AND character_id = $2
       RETURNING *`,
      [
        userId,
        character.character_id,
        claims.characterName,
        claims.ownerHash,
        JSON.stringify(claims.scopes),
        encryptToken(token.access_token),
        encryptToken(nextRefreshToken),
        expiresAt,
      ]
    );
    return {
      accessToken: token.access_token,
      character: safeCharacter(updated[0]),
    };
  } catch (err) {
    await pool.query(
      `UPDATE in_game_fitting_esi_characters
       SET token_status = 'error', last_error = $3, updated_at = now()
       WHERE user_id = $1 AND character_id = $2`,
      [userId, character.character_id, String(err.message || err).slice(0, 500)]
    );
    throw err;
  }
}

async function fetchFittings(userId, characterId) {
  const { accessToken, character } = await refreshedAccessTokenForCharacter(userId, characterId);
  const fetch = await getFetch();
  const base = ESI_BASE_URL.replace(/\/+$/, "");
  const url = `${base}/characters/${encodeURIComponent(characterId)}/fittings/?datasource=tranquility`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: "bad_json" };
  }
  if (!response.ok) {
    const err = new Error(body.error || `esi_fittings_${response.status}`);
    err.status = response.status;
    throw err;
  }
  await pool.query(
    `UPDATE in_game_fitting_esi_characters
     SET last_fittings_fetch_at = now(), token_status = 'ok', last_error = NULL, updated_at = now()
     WHERE user_id = $1 AND character_id = $2`,
    [userId, characterId]
  );
  return {
    character,
    fittings: Array.isArray(body) ? body : [],
  };
}

module.exports = {
  REQUIRED_SCOPE,
  REQUIRED_SCOPES,
  callbackHtml,
  configStatus,
  createLoginUrl,
  ensureEsiSchema,
  fetchFittings,
  linkCharacterFromCode,
  listCharacters,
  missingRequiredScopes,
  unlinkCharacter,
};
