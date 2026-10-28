const crypto = require("crypto");
const { promisify } = require("util");
const pool = require("../db/pool");

const scryptAsync = promisify(crypto.scrypt);
const COOKIE_NAME = "anoikis_command_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 20;

let schemaReady = false;
let schemaPromise = null;
const authAttempts = new Map();

async function ensureAuthSchema() {
  if (schemaReady) return;
  if (!schemaPromise) {
    schemaPromise = pool
      .query(`
        CREATE TABLE IF NOT EXISTS anoikis_command_users (
          id BIGSERIAL PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          username_normalized TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_login_at TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS anoikis_command_sessions (
          id BIGSERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES anoikis_command_users(id) ON DELETE CASCADE,
          token_hash TEXT UNIQUE NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL,
          user_agent TEXT,
          ip TEXT
        );

        CREATE INDEX IF NOT EXISTS anoikis_command_sessions_user_idx
          ON anoikis_command_sessions(user_id);

        CREATE INDEX IF NOT EXISTS anoikis_command_sessions_expires_idx
          ON anoikis_command_sessions(expires_at);
      `)
      .then(() => {
        schemaReady = true;
      })
      .catch((err) => {
        schemaPromise = null;
        throw err;
      });
  }
  await schemaPromise;
}

function safeUser(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    username: row.username,
    created_at: row.created_at,
  };
}

function validateUsername(username) {
  const value = String(username || "").trim();
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(value)) {
    return { error: "Username must be 3-32 characters using letters, numbers, underscores, or dashes." };
  }
  return { username: value, usernameNormalized: value.toLowerCase() };
}

function validateRegisterCredentials(body) {
  const username = validateUsername(body?.username);
  if (username.error) return username;
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < 10) return { error: "Password must be at least 10 characters." };
  if (password.length > 512) return { error: "Password is too long." };
  return { ...username, password };
}

function validateLoginCredentials(body) {
  const username = validateUsername(body?.username);
  if (username.error) return { error: "Invalid username or password." };
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || password.length > 512) return { error: "Invalid username or password." };
  return { ...username, password };
}

function authAttemptKey(req, usernameNormalized) {
  return `${String(req.ip || "").slice(0, 80)}:${String(usernameNormalized || "").slice(0, 80)}`;
}

function checkAuthRateLimit(req, usernameNormalized) {
  const key = authAttemptKey(req, usernameNormalized);
  const now = Date.now();
  const current = (authAttempts.get(key) || []).filter((time) => now - time < AUTH_WINDOW_MS);
  if (current.length >= AUTH_MAX_ATTEMPTS) {
    authAttempts.set(key, current);
    return { ok: false, error: "Too many attempts. Wait a few minutes and try again." };
  }
  current.push(now);
  authAttempts.set(key, current);
  return { ok: true };
}

function clearAuthAttempts(req, usernameNormalized) {
  authAttempts.delete(authAttemptKey(req, usernameNormalized));
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = await scryptAsync(password, salt, 64);
  return { salt, hash: derived.toString("hex") };
}

async function verifyPassword(password, salt, expectedHash) {
  const { hash } = await hashPassword(password, salt);
  const actual = Buffer.from(hash, "hex");
  const expected = Buffer.from(String(expectedHash || ""), "hex");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

async function verifyCurrentPassword(userId, password) {
  const rawPassword = typeof password === "string" ? password : "";
  if (!rawPassword || rawPassword.length > 512) return false;
  await ensureAuthSchema();
  const { rows } = await pool.query(
    `SELECT password_hash, password_salt
     FROM anoikis_command_users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );
  const user = rows[0];
  if (!user) return false;
  return verifyPassword(rawPassword, user.password_salt, user.password_hash);
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function shouldUseSecureCookie(req) {
  return (
    process.env.NODE_ENV === "production" ||
    req.secure ||
    String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https"
  );
}

function sessionTokenFromRequest(req) {
  return req.cookies?.[COOKIE_NAME] || null;
}

function sessionCookieOptions(req, maxAge = SESSION_MS) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(req),
    path: "/",
    maxAge,
  };
}

function clearSessionCookie(res, req) {
  res.clearCookie(COOKIE_NAME, {
    sameSite: "lax",
    secure: shouldUseSecureCookie(req),
    path: "/",
  });
}

async function createSession(userId, req, res) {
  await pool.query("DELETE FROM anoikis_command_sessions WHERE expires_at < now()");
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_MS);
  await pool.query(
    `INSERT INTO anoikis_command_sessions (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      userId,
      tokenHash(token),
      expiresAt,
      String(req.get("user-agent") || "").slice(0, 300),
      String(req.ip || "").slice(0, 80),
    ]
  );
  res.cookie(COOKIE_NAME, token, sessionCookieOptions(req));
  return token;
}

async function getSessionUser(req) {
  const token = sessionTokenFromRequest(req);
  if (!token) return null;
  await ensureAuthSchema();
  const { rows } = await pool.query(
    `SELECT
       s.id AS session_id,
       s.expires_at,
       u.id,
       u.username,
       u.created_at
     FROM anoikis_command_sessions s
     JOIN anoikis_command_users u ON u.id = s.user_id
     WHERE s.token_hash = $1
     LIMIT 1`,
    [tokenHash(token)]
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await pool.query("DELETE FROM anoikis_command_sessions WHERE id = $1", [row.session_id]);
    return null;
  }
  return {
    sessionId: row.session_id,
    user: safeUser(row),
  };
}

async function requireAuth(req, res, next) {
  try {
    const session = await getSessionUser(req);
    if (!session) return res.status(401).json({ ok: false, error: "unauthorized" });
    req.siteUser = session.user;
    req.siteSessionId = session.sessionId;
    return next();
  } catch (err) {
    console.error("[siteAuth] auth failed", err);
    return res.status(503).json({ ok: false, error: "auth_unavailable" });
  }
}

async function register(req, res) {
  try {
    await ensureAuthSchema();
    const validation = validateRegisterCredentials(req.body);
    if (validation.error) return res.status(400).json({ ok: false, error: validation.error });
    const rate = checkAuthRateLimit(req, validation.usernameNormalized);
    if (!rate.ok) return res.status(429).json({ ok: false, error: rate.error });
    const { username, usernameNormalized, password } = validation;
    const { salt, hash } = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO anoikis_command_users (username, username_normalized, password_hash, password_salt, last_login_at)
       VALUES ($1, $2, $3, $4, now())
       RETURNING id, username, created_at`,
      [username, usernameNormalized, hash, salt]
    );
    clearAuthAttempts(req, usernameNormalized);
    const sessionToken = await createSession(rows[0].id, req, res);
    const payload = { ok: true, authenticated: true, user: safeUser(rows[0]) };
    return res.status(201).json(payload);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ ok: false, error: "Username already exists." });
    console.error("[siteAuth] register failed", err);
    return res.status(503).json({ ok: false, error: "register_failed" });
  }
}

async function login(req, res) {
  try {
    await ensureAuthSchema();
    const validation = validateLoginCredentials(req.body);
    if (validation.error) return res.status(400).json({ ok: false, error: "Invalid username or password." });
    const rate = checkAuthRateLimit(req, validation.usernameNormalized);
    if (!rate.ok) return res.status(429).json({ ok: false, error: rate.error });
    const { rows } = await pool.query(
      `SELECT id, username, password_hash, password_salt, created_at
       FROM anoikis_command_users
       WHERE username_normalized = $1
       LIMIT 1`,
      [validation.usernameNormalized]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ ok: false, error: "Invalid username or password." });
    const ok = await verifyPassword(validation.password, user.password_salt, user.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: "Invalid username or password." });
    clearAuthAttempts(req, validation.usernameNormalized);
    await pool.query("UPDATE anoikis_command_users SET last_login_at = now() WHERE id = $1", [user.id]);
    const sessionToken = await createSession(user.id, req, res);
    const payload = { ok: true, authenticated: true, user: safeUser(user) };
    return res.json(payload);
  } catch (err) {
    console.error("[siteAuth] login failed", err);
    return res.status(503).json({ ok: false, error: "login_failed" });
  }
}

async function logout(req, res) {
  try {
    const token = sessionTokenFromRequest(req);
    if (token) {
      await ensureAuthSchema();
      await pool.query("DELETE FROM anoikis_command_sessions WHERE token_hash = $1", [tokenHash(token)]);
    }
  } catch (err) {
    console.warn("[siteAuth] logout session cleanup failed:", err.message);
  }
  clearSessionCookie(res, req);
  return res.json({ ok: true });
}

async function me(req, res) {
  try {
    const session = await getSessionUser(req);
    if (!session) return res.json({ ok: true, authenticated: false, user: null });
    return res.json({ ok: true, authenticated: true, user: session.user });
  } catch (err) {
    console.error("[siteAuth] me failed", err);
    return res.status(503).json({ ok: false, error: "auth_unavailable" });
  }
}

module.exports = {
  COOKIE_NAME,
  ensureAuthSchema,
  getSessionUser,
  requireAuth,
  verifyCurrentPassword,
  clearSessionCookie,
  register,
  login,
  logout,
  me,
  _test: {
    safeUser,
    validateUsername,
    validateRegisterCredentials,
    validateLoginCredentials,
    authAttemptKey,
    checkAuthRateLimit,
    clearAuthAttempts,
    hashPassword,
    verifyPassword,
    verifyCurrentPassword,
    tokenHash,
    shouldUseSecureCookie,
    sessionTokenFromRequest,
    sessionCookieOptions,
  },
};
