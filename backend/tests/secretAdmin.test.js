const test = require("node:test");
const assert = require("node:assert/strict");
const { installExternalModuleFallbacks } = require("./helpers/moduleStubs");

installExternalModuleFallbacks();

const secretAuth = require("../services/secretAdminAuth");
const observations = require("../services/structureObservations");
const secretRouter = require("../routes/secret");
const secretRoute = secretRouter._test;
const ageRoute = require("../routes/age");
const ageMaintenance = require("../services/structureAgeMaintenance");
const ageGate = require("../services/structureAgeGate");
const pool = require("../db/pool");

const ORIGINAL_ENV = {
  SECRET_ADMIN_PASSWORD: process.env.SECRET_ADMIN_PASSWORD,
  SECRET_ADMIN_SESSION_SECRET: process.env.SECRET_ADMIN_SESSION_SECRET,
  SECRET_ADMIN_SESSION_HOURS: process.env.SECRET_ADMIN_SESSION_HOURS,
  SECRET_ADMIN_ALLOWED_ORIGIN: process.env.SECRET_ADMIN_ALLOWED_ORIGIN,
  NODE_ENV: process.env.NODE_ENV,
};

test.afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("secret admin session is signed, expiring, HttpOnly, and SameSite Strict", () => {
  process.env.SECRET_ADMIN_PASSWORD = "a-long-admin-password";
  process.env.SECRET_ADMIN_SESSION_SECRET = "a-session-secret-with-at-least-thirty-two-characters";
  process.env.SECRET_ADMIN_SESSION_HOURS = "2";
  process.env.NODE_ENV = "production";

  const config = secretAuth.getSecretConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.sessionMs, 2 * 60 * 60 * 1000);
  const now = Date.now();
  const token = secretAuth.createSessionToken(config, now);
  assert.ok(secretAuth.verifySessionToken(token, config, now + 1000));
  assert.equal(secretAuth.verifySessionToken(`${token}x`, config, now + 1000), null);
  assert.equal(secretAuth.verifySessionToken(token, config, now + config.sessionMs + 1), null);
  assert.deepEqual(secretAuth.sessionCookieOptions({ secure: false, headers: {} }, 1000), {
    httpOnly: true,
    sameSite: "strict",
    secure: true,
    path: "/api/secret",
    maxAge: 1000,
  });
});

test("secret admin fails closed when credentials are weak or missing", () => {
  process.env.SECRET_ADMIN_PASSWORD = "short";
  process.env.SECRET_ADMIN_SESSION_SECRET = "also-short";
  assert.equal(secretAuth.getSecretConfig().enabled, false);
});

test("secret admin accepts only its configured or request origin", () => {
  delete process.env.SECRET_ADMIN_ALLOWED_ORIGIN;
  const sameOrigin = {
    headers: { origin: "https://triff.tools", host: "triff.tools" },
    get(name) { return this.headers[String(name).toLowerCase()]; },
  };
  const crossOrigin = {
    headers: { origin: "https://evil.example", host: "triff.tools" },
    get(name) { return this.headers[String(name).toLowerCase()]; },
  };
  assert.equal(secretAuth.isSameOriginRequest(sameOrigin), true);
  assert.equal(secretAuth.isSameOriginRequest(crossOrigin), false);

  process.env.SECRET_ADMIN_ALLOWED_ORIGIN = "https://admin.triff.tools";
  const configuredOrigin = {
    headers: { origin: "https://admin.triff.tools", host: "triff.tools" },
    get(name) { return this.headers[String(name).toLowerCase()]; },
  };
  assert.equal(secretAuth.isSameOriginRequest(configuredOrigin), true);
  assert.equal(secretAuth.isSameOriginRequest(sameOrigin), false);
});

test("secret password comparison and login limiter do not expose variable-length comparisons", () => {
  assert.equal(secretAuth.constantTimePasswordMatches("correct", "correct"), true);
  assert.equal(secretAuth.constantTimePasswordMatches("wrong", "correct"), false);
  const req = { ip: `test-${Date.now()}-${Math.random()}` };
  secretAuth.clearLoginFailures(req);
  for (let index = 0; index < 4; index += 1) {
    assert.equal(secretAuth.noteLoginFailure(req).allowed, true);
  }
  assert.equal(secretAuth.noteLoginFailure(req).allowed, false);
  assert.equal(secretAuth.loginRateStatus(req).allowed, false);
  secretAuth.clearLoginFailures(req);
  assert.equal(secretAuth.loginRateStatus(req).allowed, true);
});

test("structure observation normalization rejects invalid identifiers and keeps structured facts only", () => {
  const normalized = observations._test.normalizeObservation({
    structureId: "1041287104869",
    jcode: "j100640",
    typeId: "35833",
    corpName: "  Nosferatu  Security Foundation  ",
    method: "interpolate",
    midISO: "2023-03-10T02:26:33.000Z",
    daysWide: "4.0",
  });
  assert.equal(normalized.structureId, "1041287104869");
  assert.equal(normalized.jcode, "J100640");
  assert.equal(normalized.typeId, 35833);
  assert.equal(normalized.corpName, "Nosferatu Security Foundation");
  assert.equal(normalized.daysWide, 4);
  assert.equal("input" in normalized, false);
  assert.throws(
    () => observations._test.normalizeObservation({ structureId: "not-an-id" }),
    /invalid_structure_id/
  );
});

test("structure check rejects oversized identifiers before attempting an estimate", () => {
  assert.deepEqual(ageRoute._test.estimateResponse("9".repeat(20)), {
    status: 400,
    error: "Invalid structure ID",
  });
});

test("structure checks reject cross-site browser submissions", () => {
  const request = (headers) => ({
    get(name) { return headers[String(name).toLowerCase()] || ""; },
  });
  assert.equal(ageRoute._test.isTrustedCheckRequest(request({
    origin: "https://triff.tools",
    host: "triff.tools",
    "sec-fetch-site": "same-origin",
  })), true);
  assert.equal(ageRoute._test.isTrustedCheckRequest(request({
    origin: "https://evil.example",
    host: "triff.tools",
    "sec-fetch-site": "cross-site",
  })), false);
});

test("saved-history backfill parses type IDs and uses deterministic idempotency IDs", () => {
  const setupId = "e60c07ec-1c12-490d-96c7-c19c5a57981a";
  const row = {
    id: setupId,
    created_at: "2026-07-11T23:41:00.000Z",
    setup_json: {
      input: "<url=showinfo:35833//1041287104869>J100640 - Structure (Corp Name)</url>",
      structureId: "1041287104869",
      jcode: "J100640",
      corpName: "Corp Name",
    },
    summary_json: {
      method: "exact",
      midISO: "2023-03-10T00:00:00.000Z",
      checkedAt: "1900-01-01T00:00:00.000Z",
    },
  };
  const first = observations._test.observationFromSavedSetup(row);
  const second = observations._test.observationFromSavedSetup(row);
  assert.equal(first.typeId, 35833);
  assert.equal(first.observationId, second.observationId);
  assert.equal(first.sourceSetupId, null);
  assert.equal(first.observedAt, row.created_at);
  assert.equal(first.daysWide, 6);
});

test("repeat successful observations advance last seen using the tool-query time", async () => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const aggregateWrites = [];

  pool.query = async (sql) => {
    assert.match(String(sql), /CREATE TABLE IF NOT EXISTS structure_observations/);
    return { rows: [] };
  };
  pool.connect = async () => ({
    async query(sql, values = []) {
      const text = String(sql);
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };
      if (text.includes("INSERT INTO structure_observation_events")) {
        return { rows: [{ event_id: values[0] }] };
      }
      if (text.includes("INSERT INTO structure_observations")) {
        aggregateWrites.push({ text, observedAt: values[14] });
        return {
          rows: [{
            structure_id: values[0],
            jcode: null,
            type_id: null,
            type_name: null,
          }],
        };
      }
      throw new Error(`Unexpected test query: ${text.slice(0, 80)}`);
    },
    release() {},
  });

  try {
    const firstSeen = "2026-08-10T10:00:00.000Z";
    const lastSeen = "2026-08-11T11:30:00.000Z";
    await observations.recordObservation({
      structureId: "1041287104869",
      observedAt: firstSeen,
    });
    await observations.recordObservation({
      structureId: "1041287104869",
      observedAt: lastSeen,
    });

    assert.deepEqual(
      aggregateWrites.map((write) => write.observedAt.toISOString()),
      [firstSeen, lastSeen]
    );
    assert.match(
      aggregateWrites[1].text,
      /last_observed_at = GREATEST\(structure_observations\.last_observed_at, EXCLUDED\.last_observed_at\)/
    );
    assert.match(
      aggregateWrites[1].text,
      /observation_count = structure_observations\.observation_count \+ 1/
    );
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
});

test("defender timezone calculation matches the structure-intel display", () => {
  const activity = { days: ["2026-08-01"] };
  activity[0] = { 21: 8, 20: 2 };
  assert.deepEqual(observations._test.defenderFromActivity(activity), {
    timezone: "AU/Asia",
    peakHour: 21,
    confidence: 80,
  });
  assert.equal(observations._test.defenderFromActivity({ days: [] }), null);
});

test("canonical replay is generated from structured fields with a parseable corporation", () => {
  const replay = observations.canonicalReplayInput({
    structure_id: "1041287104869",
    jcode: "J100640",
    type_id: 35833,
    corporation_name: "Nosferatu Security Foundation",
  });
  assert.equal(
    replay,
    "<url=showinfo:35833//1041287104869>J100640 - Structure (Nosferatu Security Foundation)</url>"
  );
});

test("admin observation sorting is whitelist-only and bounded", () => {
  assert.deepEqual(secretRoute.listOptions({
    sort: "observation_count desc; drop table users",
    direction: "sideways",
    limit: "999999",
    offset: "-4",
  }), {
    sort: "jcode",
    direction: "asc",
    limit: 50000,
    offset: 0,
    excludeUnknownJcode: false,
  });
  assert.equal(secretRoute.listOptions({ sortBy: "observationCount", order: "DESC" }).sort, "observationCount");
  assert.equal(secretRoute.listOptions({ sortBy: "observationCount", order: "DESC" }).direction, "desc");
});

test("admin observation list filters unknown J-codes before totals and pagination", () => {
  const options = secretRoute.listOptions({
    sort: "lastSeen",
    direction: "desc",
    excludeUnknownJcode: "1",
    limit: "25",
    offset: "50",
  });
  assert.deepEqual(options, {
    sort: "lastSeen",
    direction: "desc",
    limit: 25,
    offset: 50,
    excludeUnknownJcode: true,
  });

  const query = secretRoute.observationListQuery(options);
  assert.match(query.text, /SELECT observation\.\*, COUNT\(\*\) OVER\(\) AS total_count/);
  assert.match(query.text, /WHERE observation\.jcode IS NOT NULL\s+ORDER BY observation\.last_observed_at DESC/);
  assert.deepEqual(query.values, [25, 50]);
  assert.doesNotMatch(query.text, /\b(?:INSERT|UPDATE|DELETE)\b/i);

  assert.equal(secretRoute.listOptions({ excludeUnknownJcode: "true" }).excludeUnknownJcode, true);
  assert.equal(secretRoute.listOptions({ excludeUnknownJcode: "0" }).excludeUnknownJcode, false);
  assert.equal(secretRoute.listOptions({ excludeUnknownJcode: "false" }).excludeUnknownJcode, false);
});

test("admin observation records expose last seen from the durable tool-query timestamp", () => {
  const lastSeen = "2026-08-11T15:04:05.000Z";
  const record = secretRoute.observationRecord({
    structure_id: "1041287104869",
    last_observed_at: lastSeen,
    observation_count: "3",
  });
  assert.equal(record.lastSeen, lastSeen);
  assert.equal(record.lastObservedAt, lastSeen);
  assert.equal(record.observationCount, 3);
});

test("force age refresh reloads first, batches rows, and updates only derived age fields", async () => {
  const calls = [];
  const pages = [
    [{ structure_id: "1041287104869" }, { structure_id: "1041287104870" }],
    [{ structure_id: "1041287104871" }],
  ];
  const client = {
    async query(sql, values = []) {
      const text = String(sql);
      calls.push({ text, values });
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (text.includes("MAX(structure_id)")) {
        assert.equal(calls.some((call) => call.text === "reload"), true);
        return { rows: [{ max_structure_id: "1041287104871" }] };
      }
      if (text.includes("SELECT structure_id::text")) return { rows: pages.shift() || [] };
      if (text.startsWith("UPDATE structure_observations")) {
        assert.match(text, /SET age_method = refreshed\.age_method/);
        assert.match(text, /age_window_days = refreshed\.age_window_days/);
        assert.doesNotMatch(text, /last_observed_at|first_observed_at|observation_count|corporation_name|jcode/);
        assert.match(text, /IS DISTINCT FROM/);
        return { rows: values[0].map((structureId) => ({ structure_id: structureId })), rowCount: values[0].length };
      }
      if (text.includes("pg_advisory_unlock")) return { rows: [{ unlocked: true }] };
      throw new Error(`Unexpected test query: ${text.slice(0, 100)}`);
    },
    release() { calls.push({ text: "release", values: [] }); },
  };

  const result = await ageMaintenance._test.runObservationAgeRefresh({
    batchSize: 2,
    ensureSchema: async () => {},
    connect: async () => client,
    reloadAgeIndex: () => { calls.push({ text: "reload", values: [] }); },
    estimateStructureAge: (structureId) => {
      if (structureId === "1041287104870") return { status: 404, error: "Not estimable" };
      return {
        status: 200,
        data: {
          method: "interpolate",
          midISO: "2026-06-01T00:00:00.000Z",
          lowISO: "2026-05-29T00:00:00.000Z",
          highISO: "2026-06-04T00:00:00.000Z",
          daysWide: "6.0",
        },
      };
    },
  });

  assert.deepEqual(result, { scanned: 3, updated: 2, skipped: 1, failed: 0 });
  assert.ok(calls.findIndex((call) => call.text === "reload") < calls.findIndex((call) => call.text.includes("MAX(structure_id)")));
  assert.equal(calls.filter((call) => call.text.startsWith("UPDATE structure_observations")).length, 2);
  assert.equal(calls.at(-1).text, "release");
});

test("force age refresh releases its cross-process lock when reloading fails", async () => {
  const calls = [];
  const client = {
    async query(sql) {
      const text = String(sql);
      calls.push(text);
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (text.includes("pg_advisory_unlock")) return { rows: [{ unlocked: true }] };
      throw new Error(`Unexpected test query: ${text}`);
    },
    release() { calls.push("release"); },
  };

  await assert.rejects(
    ageMaintenance._test.runObservationAgeRefresh({
      ensureSchema: async () => {},
      connect: async () => client,
      reloadAgeIndex: () => { throw new Error("replacement file is invalid"); },
    }),
    /replacement file is invalid/
  );
  assert.equal(calls.some((text) => text.includes("pg_advisory_unlock")), true);
  assert.equal(calls.at(-1), "release");
});

test("force age refresh reports an existing cross-process run without reloading", async () => {
  let reloaded = false;
  let released = false;
  await assert.rejects(
    ageMaintenance._test.runObservationAgeRefresh({
      ensureSchema: async () => {},
      connect: async () => ({
        async query(sql) {
          if (String(sql).includes("pg_try_advisory_lock")) return { rows: [{ acquired: false }] };
          throw new Error("unexpected query");
        },
        release() { released = true; },
      }),
      reloadAgeIndex: () => { reloaded = true; },
    }),
    (error) => error?.code === "age_refresh_in_progress"
  );
  assert.equal(reloaded, false);
  assert.equal(released, true);
});

test("force age refresh endpoint is POST-only and protected by the secret admin session", () => {
  const layerIndex = secretRouter.stack.findIndex((layer) => layer.route?.path === "/force-age-check");
  assert.ok(layerIndex > 0);
  const route = secretRouter.stack[layerIndex].route;
  assert.equal(route.methods.post, true);
  assert.equal(route.methods.get, undefined);
  assert.equal(route.stack.some((layer) => layer.handle === secretAuth.requireSecretAdmin), true);
  // The router-wide no-cache/same-origin middleware is registered ahead of
  // every private endpoint, including this state-changing maintenance route.
  assert.equal(secretRouter.stack.slice(0, layerIndex).some((layer) => !layer.route), true);
});

test("force age refresh rejects a second in-process run", async () => {
  let finishFirst;
  const pending = new Promise((resolve) => { finishFirst = resolve; });
  const first = ageMaintenance._test.startRefresh(() => pending);
  const second = ageMaintenance._test.startRefresh(() => Promise.resolve({}));
  assert.equal(second, null);
  finishFirst({ scanned: 0, updated: 0, skipped: 0, failed: 0 });
  await first;

  const afterCompletion = ageMaintenance._test.startRefresh(() => Promise.resolve({
    scanned: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  }));
  assert.ok(afterCompletion);
  await afterCompletion;
});

test("age index reload waits for in-flight observation writes and blocks new checks", async () => {
  const events = [];
  let finishOldCheck;
  let oldCheckStarted;
  const started = new Promise((resolve) => { oldCheckStarted = resolve; });
  const oldCheck = ageGate.withStructureAgeCheck(async () => {
    events.push("old-estimate");
    oldCheckStarted();
    await new Promise((resolve) => { finishOldCheck = resolve; });
    events.push("old-persisted");
  });
  await started;

  const reload = ageGate.reloadStructureAgeIndexExclusive(() => {
    events.push("reloaded");
  });
  const newCheck = ageGate.withStructureAgeCheck(async () => {
    events.push("new-estimate");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["old-estimate"]);

  finishOldCheck();
  await Promise.all([oldCheck, reload, newCheck]);
  assert.deepEqual(events, ["old-estimate", "old-persisted", "reloaded", "new-estimate"]);
  assert.deepEqual(ageGate._test.state(), { activeChecks: 0, pendingReloads: 0 });
});

test("unchanged age rows are skipped instead of rewritten or reported failed", async () => {
  const client = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (text.includes("MAX(structure_id)")) return { rows: [{ max_structure_id: "1041287104869" }] };
      if (text.includes("SELECT structure_id::text")) return { rows: [{ structure_id: "1041287104869" }] };
      if (text.startsWith("UPDATE structure_observations")) return { rows: [], rowCount: 0 };
      if (text.includes("pg_advisory_unlock")) return { rows: [{ unlocked: true }] };
      throw new Error(`Unexpected test query: ${text}`);
    },
    release() {},
  };
  const result = await ageMaintenance._test.runObservationAgeRefresh({
    batchSize: 2,
    ensureSchema: async () => {},
    connect: async () => client,
    reloadAgeIndex: async () => {},
    estimateStructureAge: () => ({
      status: 200,
      data: {
        method: "exact",
        midISO: "2026-06-01T00:00:00.000Z",
        lowISO: "2026-05-29T00:00:00.000Z",
        highISO: "2026-06-04T00:00:00.000Z",
        daysWide: 6,
      },
    }),
  });
  assert.deepEqual(result, { scanned: 1, updated: 0, skipped: 1, failed: 0 });
});

test("failed advisory unlock destroys the pooled connection", async () => {
  let releasedWith;
  const unlockFailure = new Error("connection lost during unlock");
  const client = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (text.includes("MAX(structure_id)")) return { rows: [{ max_structure_id: null }] };
      if (text.includes("pg_advisory_unlock")) throw unlockFailure;
      throw new Error(`Unexpected test query: ${text}`);
    },
    release(error) { releasedWith = error; },
  };
  const result = await ageMaintenance._test.runObservationAgeRefresh({
    ensureSchema: async () => {},
    connect: async () => client,
    reloadAgeIndex: async () => {},
  });
  assert.deepEqual(result, { scanned: 0, updated: 0, skipped: 0, failed: 0 });
  assert.equal(releasedWith, unlockFailure);
});
