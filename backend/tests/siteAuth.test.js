const test = require("node:test");
const assert = require("node:assert/strict");
const { installExternalModuleFallbacks } = require("./helpers/moduleStubs");

installExternalModuleFallbacks();
const siteAuth = require("../services/siteAuth");

const {
  validateUsername,
  validateRegisterCredentials,
  validateLoginCredentials,
  checkAuthRateLimit,
  clearAuthAttempts,
  hashPassword,
  verifyPassword,
  tokenHash,
  shouldUseSecureCookie,
  sessionTokenFromRequest,
  sessionCookieOptions,
} = siteAuth._test;

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

test.afterEach(() => {
  if (ORIGINAL_NODE_ENV == null) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

test("username and credential validation normalizes public input", () => {
  assert.deepEqual(validateUsername("  Pilot_One-7  "), {
    username: "Pilot_One-7",
    usernameNormalized: "pilot_one-7",
  });

  assert.match(validateUsername("ab").error, /3-32/);
  assert.match(validateUsername("bad name").error, /letters/);

  assert.equal(
    validateRegisterCredentials({ username: "Pilot", password: "short" }).error,
    "Password must be at least 10 characters."
  );

  assert.deepEqual(validateRegisterCredentials({
    username: "Pilot",
    password: "long-enough-password",
  }), {
    username: "Pilot",
    usernameNormalized: "pilot",
    password: "long-enough-password",
  });

  assert.equal(
    validateLoginCredentials({ username: "bad name", password: "anything" }).error,
    "Invalid username or password."
  );
});

test("password hashing verifies only the original password", async () => {
  const { salt, hash } = await hashPassword("correct horse battery staple", "fixed-test-salt");

  assert.equal(salt, "fixed-test-salt");
  assert.match(hash, /^[a-f0-9]{128}$/);
  assert.equal(await verifyPassword("correct horse battery staple", salt, hash), true);
  assert.equal(await verifyPassword("wrong horse battery staple", salt, hash), false);
});

test("session token hashes and cookie security options are stable", () => {
  const token = "0123456789abcdef";
  assert.equal(tokenHash(token), tokenHash(token));
  assert.notEqual(tokenHash(token), token);
  assert.match(tokenHash(token), /^[a-f0-9]{64}$/);

  assert.equal(shouldUseSecureCookie({ secure: false, headers: {} }), false);
  assert.equal(shouldUseSecureCookie({
    secure: false,
    headers: { "x-forwarded-proto": "https, http" },
  }), true);

  process.env.NODE_ENV = "production";
  assert.deepEqual(sessionCookieOptions({ secure: false, headers: {} }, 1234), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 1234,
  });
});

test("website sessions use cookies", () => {
  assert.equal(sessionTokenFromRequest({ cookies: {} }), null);
  assert.equal(sessionTokenFromRequest({ cookies: { [siteAuth.COOKIE_NAME]: "cookie-token" } }), "cookie-token");
});

test("auth rate limit blocks repeated attempts per ip and username", () => {
  const req = { ip: "203.0.113.10" };
  const username = "pilot";
  clearAuthAttempts(req, username);

  for (let i = 0; i < 20; i += 1) {
    assert.equal(checkAuthRateLimit(req, username).ok, true);
  }

  const blocked = checkAuthRateLimit(req, username);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /Too many attempts/);

  clearAuthAttempts(req, username);
  assert.equal(checkAuthRateLimit(req, username).ok, true);
  clearAuthAttempts(req, username);
});
