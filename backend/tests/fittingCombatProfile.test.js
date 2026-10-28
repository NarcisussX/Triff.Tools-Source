const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandler, createRateLimiter, readRequest } = require("../services/combatProfileApi");

function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

const success = () => ({ ok: true, combatProfileSchemaVersion: "1.1.0", profile: { profileId: "test" }, warnings: [], errors: [] });
function handler(overrides = {}) {
  return createHandler({
    requestIp: () => "127.0.0.1", consume: () => true, logError: () => {},
    prepareSkills: async (_req, body) => ({ payload: { ...body, skillProfile: { mode: "all_v" } }, warnings: [] }),
    client: async () => success(), ...overrides,
  });
}

test("combat profile normalizes aliases and accepts normalized payloads", () => {
  for (const key of ["eft", "eftText", "text"]) assert.equal(readRequest({ [key]: "[Rifter, Fit]" }).eft, "[Rifter, Fit]");
  assert.equal(readRequest({ payload: { shipTypeId: 587 } }).payload.shipTypeId, 587);
  assert.throws(() => readRequest({ eft: "x", payload: {} }));
  assert.throws(() => readRequest({ eft: " " }));
  assert.throws(() => readRequest({ payload: [] }));
  assert.throws(() => readRequest({ payload: { shipTypeId: 587, sourceFits: [{ fitState: { shipTypeId: 587 } }] } }));
  assert.throws(() => readRequest({ payload: { targetFit: [] } }));
  assert.throws(() => readRequest({ payload: { targetFit: null } }));
  assert.throws(() => readRequest({ payload: { sourceFits: new Array(9).fill({ fitState: {} }) } }));
  assert.throws(() => readRequest({ eft: "x".repeat(256 * 1024) }));
  assert.throws(() => readRequest({ payload: {}, skillProfile: { mode: "alpha_clone" } }));
});

test("combat profile limiter refills and retains independent client budgets", () => {
  const consume = createRateLimiter({ perMinute: 2, burst: 2 });
  assert.equal(consume("a", 0), true);
  assert.equal(consume("a", 0), true);
  assert.equal(consume("a", 0), false);
  assert.equal(consume("b", 0), true);
  assert.equal(consume("a", 30000), true);
  assert.equal(consume("a", 30000), false);
  assert.equal(consume("a", 90000), true);
});

test("combat profile rejects before calling the fitting service", async () => {
  let calls = 0;
  const api = handler({ client: async () => { calls += 1; return success(); } });
  const res = response();
  await api({ body: { eft: "" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.profile, null);
  assert.equal(res.body.combatProfileSchemaVersion, "1.1.0");
  assert.equal(calls, 0);
  const limited = response();
  await handler({ consume: () => false })({ body: { eft: "x" } }, limited);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers["Retry-After"], "60");
  assert.equal(limited.headers["Cache-Control"], "no-store");
});

test("EFT requests forward server-resolved skills and preserve explicit module/skill overrides", async () => {
  let forwarded;
  const moduleOverrides = [{ rack: "high", index: 0, chargeTypeId: 34 }];
  const api = handler({
    prepareSkills: async (_req, body) => {
      assert.equal(body.skillProfile.mode, "esi_character");
      return { payload: { skillProfile: { mode: "all_v" } }, warnings: [{ code: "skill_profile_fallback" }] };
    },
    client: async (body) => { forwarded = body; return success(); },
  });
  const res = response();
  await api({ body: { eft: "[Rifter, Fit]", skillProfile: { mode: "esi_character", skills: { 1: 5 } }, skillOverrides: { 2: 4 }, moduleOverrides } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(forwarded.skillProfile, { mode: "all_v" });
  assert.deepEqual(forwarded.skillOverrides, { 2: 4 });
  assert.deepEqual(forwarded.moduleOverrides, moduleOverrides);
  assert.equal(res.body.warnings[0].code, "skill_profile_fallback");
});

test("normalized and cross-fit requests use the existing skill preparation path", async () => {
  const payload = { targetFit: { shipTypeId: 587 }, sourceFits: [{ tabId: "a", fitState: { shipTypeId: 621 } }] };
  let forwarded;
  const api = handler({
    prepareSkills: async (req, body) => {
      assert.equal(req.userMarker, "same request");
      assert.deepEqual(body, payload);
      return { payload: { ...body, targetFit: { ...body.targetFit, skillProfile: { mode: "alpha_clone" } } }, warnings: [] };
    },
    client: async (body) => { forwarded = body; return success(); },
  });
  const res = response();
  await api({ userMarker: "same request", body: { payload } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(forwarded.payload.targetFit.skillProfile.mode, "alpha_clone");
  assert.deepEqual(forwarded.payload.sourceFits, payload.sourceFits);
});

test("service validation failures are 422; exceptions/malformed responses are structured 502", async () => {
  const invalid = { ok: false, combatProfileSchemaVersion: "1.1.0", profile: null, errors: [{ code: "invalid_combat_profile_request" }] };
  const res = response();
  await handler({ client: async () => invalid })({ body: { eft: "bad" } }, res);
  assert.equal(res.statusCode, 422);
  for (const client of [async () => { throw new Error("private service detail"); }, async () => "html", async () => ({ ok: true })]) {
    const failed = response();
    await handler({ client })({ body: { eft: "fit" } }, failed);
    assert.equal(failed.statusCode, 502);
    assert.equal(failed.body.errors[0].code, "fitting_service_error");
    assert.doesNotMatch(JSON.stringify(failed.body), /private service detail/);
  }
});

test("the mounted route resolves target and source ESI skills with the signed-in owner", async () => {
  const { installExternalModuleFallbacks } = require("./helpers/moduleStubs");
  installExternalModuleFallbacks();
  const siteAuth = require("../services/siteAuth");
  const esi = require("../services/fittingEsi");
  const originalSession = siteAuth.getSessionUser;
  const originalSkills = esi.skillProfileForUser;
  const calls = [];
  siteAuth.getSessionUser = async () => ({ user: { id: 77 } });
  esi.skillProfileForUser = async (owner, selection) => {
    calls.push([owner, selection.characterId]);
    return { mode: "esi_character", characterId: selection.characterId, skills: { 3300: 3 } };
  };
  try {
    const { calculationPayloadWithSkills } = require("../routes/fitting")._test;
    let forwarded;
    const api = handler({ prepareSkills: calculationPayloadWithSkills, client: async (body) => { forwarded = body; return success(); } });
    const fit = (id) => ({ shipTypeId: 587, skillProfile: { mode: "esi_character", characterId: id, skills: { 3300: 5 } } });
    const res = response();
    await api({ body: { payload: { targetFit: fit(1), sourceFits: [{ tabId: "a", fitState: fit(2) }] } } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls, [[77, 2], [77, 1]]);
    assert.deepEqual(forwarded.payload.targetFit.skillProfile.skills, { 3300: 3 });
    assert.deepEqual(forwarded.payload.sourceFits[0].fitState.skillProfile.skills, { 3300: 3 });
    assert.equal(Object.hasOwn(forwarded.payload, "graphTargets"), false);
  } finally {
    siteAuth.getSessionUser = originalSession;
    esi.skillProfileForUser = originalSkills;
  }
});
