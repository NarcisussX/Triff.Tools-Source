const test = require("node:test");
const assert = require("node:assert/strict");
const { installExternalModuleFallbacks } = require("./helpers/moduleStubs");

installExternalModuleFallbacks();
const fittingEsi = require("../services/fittingEsi");

test("EVE SSO scopes keep the minimal fitting character access set", () => {
  assert.deepEqual(fittingEsi.REQUIRED_SCOPES, [
    "publicData",
    "esi-skills.read_skills.v1",
  ]);
});

test("monitor SSO scopes are progressive and leave fitting scopes unchanged", () => {
  assert.deepEqual(fittingEsi.MONITOR_REQUIRED_SCOPES, [
    "publicData",
    "esi-skills.read_skills.v1",
    "esi-skills.read_skillqueue.v1",
    "esi-clones.read_implants.v1",
    "esi-clones.read_clones.v1",
    "esi-wallet.read_character_wallet.v1",
  ]);
  assert.deepEqual(fittingEsi.missingMonitorScopes([
    "esi-skills.read_skills.v1",
    "esi-skills.read_skillqueue.v1",
  ]), [
    "esi-clones.read_implants.v1",
    "esi-clones.read_clones.v1",
    "esi-wallet.read_character_wallet.v1",
  ]);
  assert.deepEqual(fittingEsi.missingRequiredScopes([
    "esi-skills.read_skills.v1",
  ]), []);
});

test("missing-scope checks enforce only fitting data scopes", () => {
  assert.deepEqual(fittingEsi.REQUIRED_DATA_SCOPES, [
    "esi-skills.read_skills.v1",
  ]);
  assert.deepEqual(fittingEsi.missingRequiredScopes(["esi-skills.read_skills.v1"]), []);
  assert.deepEqual(fittingEsi.missingRequiredScopes(["publicData"]), ["esi-skills.read_skills.v1"]);
});

test("Skillnix configuration never falls back to fitting EVE SSO credentials", (t) => {
  const keys = [
    "EVE_SSO_CLIENT_ID",
    "EVE_SSO_CLIENT_SECRET",
    "EVE_SSO_CALLBACK_URL",
    "SKILLNIX_EVE_SSO_CLIENT_ID",
    "SKILLNIX_EVE_SSO_CLIENT_SECRET",
    "SKILLNIX_EVE_SSO_CALLBACK_URL",
    "ESI_TOKEN_ENCRYPTION_KEY",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.EVE_SSO_CLIENT_ID = "fitting-id";
  process.env.EVE_SSO_CLIENT_SECRET = "fitting-secret";
  process.env.EVE_SSO_CALLBACK_URL = "https://triff.tools/api/fitting/esi/callback";
  process.env.ESI_TOKEN_ENCRYPTION_KEY = "unit-test-encryption-key-with-sufficient-entropy";
  delete process.env.SKILLNIX_EVE_SSO_CLIENT_ID;
  delete process.env.SKILLNIX_EVE_SSO_CLIENT_SECRET;
  delete process.env.SKILLNIX_EVE_SSO_CALLBACK_URL;
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  assert.equal(fittingEsi.configStatus().ok, true);
  assert.deepEqual(fittingEsi.skillnixConfigStatus().missing, [
    "SKILLNIX_EVE_SSO_CLIENT_ID",
    "SKILLNIX_EVE_SSO_CLIENT_SECRET",
    "SKILLNIX_EVE_SSO_CALLBACK_URL",
  ]);
});

test("normalizes ESI skills to typeID level map", () => {
  const normalized = fittingEsi.normalizeSkillsResponse({
    total_sp: 1234,
    unallocated_sp: 56,
    skills: [
      { skill_id: 3327, trained_skill_level: 5 },
      { skill_id: 3300, trained_skill_level: 4 },
      { skill_id: 9999, trained_skill_level: 12 },
    ],
  });

  assert.equal(normalized.skills["3327"], 5);
  assert.equal(normalized.skills["3300"], 4);
  assert.equal(normalized.skills["9999"], 5);
  assert.equal(normalized.total_sp, 1234);
  assert.equal(normalized.unallocated_sp, 56);
  assert.ok(normalized.synced_at);
});

test("monitor endpoint normalizers reject malformed values and preserve safe aliases", () => {
  const attributes = fittingEsi.normalizeAttributesResponse({
    charisma: 20,
    intelligence: "27",
    memory: -1,
    perception: 101,
    willpower: 22,
    bonus_remaps: 2,
    last_remap_date: "not-a-date",
  });
  assert.deepEqual(attributes.attributes, {
    charisma: 20,
    intelligence: 27,
    memory: null,
    perception: null,
    willpower: 22,
  });
  assert.equal(attributes.last_remap_date, null);

  const queue = fittingEsi.normalizeSkillQueueResponse([
    { skill_id: 3301, queue_position: 2, finished_level: 4, finish_date: "2027-01-02T00:00:00Z" },
    { skill_id: 3300, queue_position: 0, finished_level: 3, finish_date: "2027-01-01T00:00:00Z" },
    { skill_id: Number.MAX_SAFE_INTEGER + 1, queue_position: 1 },
  ]);
  assert.deepEqual(queue.queue.map((row) => row.skillTypeId), [3300, 3301]);
  assert.equal(queue.queue[0].targetLevel, 3);
  assert.equal(queue.queue[0].endAt, "2027-01-01T00:00:00.000Z");

  const implants = fittingEsi.normalizeImplantsResponse([10208, "10208", -3, Number.MAX_SAFE_INTEGER + 1]);
  assert.deepEqual(implants.implants, [10208]);
  assert.deepEqual(implants.items, [{ typeId: 10208, type_id: 10208 }]);

  const clones = fittingEsi.normalizeClonesResponse({
    home_location: { location_id: 60003760, location_type: "station" },
    jump_clones: [
      {
        jump_clone_id: 42,
        name: "Training clone",
        location_id: 60008494,
        location_type: "station",
        implants: [10208, "10208", 10209, -1],
      },
      { jump_clone_id: 42, location_id: 60008494, location_type: "station", implants: [10210] },
      { jump_clone_id: -1, location_id: 60008494, location_type: "station", implants: [] },
    ],
    last_clone_jump_date: "2026-08-07T14:00:00Z",
    last_station_change_date: "not-a-date",
  });
  assert.deepEqual(clones.homeLocation, {
    locationId: 60003760,
    location_id: 60003760,
    locationType: "station",
    location_type: "station",
  });
  assert.equal(clones.jumpClones.length, 1);
  assert.deepEqual(clones.jumpClones[0].implants, [10208, 10209]);
  assert.equal(clones.jumpClones[0].name, "Training clone");
  assert.equal(clones.lastCloneJumpDate, "2026-08-07T14:00:00.000Z");
  assert.equal(clones.lastStationChangeDate, null);
  assert.equal(fittingEsi.normalizeWalletResponse(null).balance, null);
  assert.equal(fittingEsi.normalizeWalletResponse("123.45").balance, 123.45);
});

test("public profile normalization exposes identity without token-owner data", () => {
  const profile = fittingEsi.normalizePublicProfileResponse({
    name: "Ada Capsuleer",
    corporation_id: 98000001,
    alliance_id: 99000001,
    security_status: 2.5,
  }, {
    characterId: 2112345678,
    corporation: { name: "Example Corp" },
    alliance: { name: "Example Alliance" },
  });
  assert.equal(profile.name, "Ada Capsuleer");
  assert.equal(profile.corporationName, "Example Corp");
  assert.equal(profile.allianceName, "Example Alliance");
  assert.match(profile.portraitUrl, /2112345678/);
  assert.equal(Object.prototype.hasOwnProperty.call(profile, "ownerHash"), false);
});

test("safe character and monitor snapshots never serialize owner or token material", () => {
  const row = {
    id: "00000000-0000-0000-0000-000000000001",
    user_id: 7,
    character_id: 2112345678,
    character_name: "Ada Capsuleer",
    owner_hash: "owner-secret",
    access_token_encrypted: "access-secret",
    refresh_token_encrypted: "refresh-secret",
    access_token_expires_at: "2030-01-01T00:00:00Z",
    scopes: ["esi-skills.read_skills.v1"],
    skills_json: { skills: { 3300: 4 }, total_sp: 1234 },
    token_status: "ok",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  const safe = fittingEsi.__testing.safeCharacter(row);
  const snapshot = fittingEsi.__testing.monitorSnapshot(row, {
    skills: {
      data_kind: "skills",
      payload: row.skills_json,
      fetched_at: "2026-01-01T00:00:00Z",
      expires_at: "2026-01-01T00:05:00Z",
      last_error_code: "esi_unavailable",
      last_error_at: "2026-01-01T00:01:00Z",
      failure_count: 1,
    },
    clones: {
      data_kind: "clones",
      payload: {
        jumpClones: [{
          jumpCloneId: 7,
          locationId: 60003760,
          locationType: "station",
          implants: [10208],
        }],
      },
      fetched_at: "2026-01-01T00:00:00Z",
      expires_at: "2026-01-01T00:02:00Z",
    },
  });
  const serialized = JSON.stringify({ safe, snapshot });
  assert.equal(serialized.includes("owner-secret"), false);
  assert.equal(serialized.includes("access-secret"), false);
  assert.equal(serialized.includes("refresh-secret"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safe, "ownerHash"), false);
  assert.deepEqual(snapshot.skills.skills, { 3300: 4 });
  assert.equal(snapshot.freshness.skills.available, true);
  assert.equal(snapshot.freshness.skills.lastError, "esi_unavailable");
  assert.equal(snapshot.freshness.clones.available, true);
  assert.equal(snapshot.jumpClones[0].jumpCloneId, 7);
  assert.deepEqual(snapshot.missingScopes, [
    "esi-skills.read_skillqueue.v1",
    "esi-clones.read_implants.v1",
    "esi-clones.read_clones.v1",
    "esi-wallet.read_character_wallet.v1",
  ]);
  assert.equal(snapshot.reauthRequired, true);
  assert.equal(snapshot.stale, true);
});

test("monitor summaries infer Alpha and distinguish a scheduled queue gap from active training", (t) => {
  fittingEsi.__testing.setTestDependencies({
    now: () => Date.parse("2026-08-07T17:00:00Z"),
  });
  t.after(() => fittingEsi.__testing.resetTestDependencies());
  const character = fittingEsi.__testing.monitorCharacter({
    id: "00000000-0000-0000-0000-000000000001",
    character_id: 2112345678,
    character_name: "Alpha Pilot",
    scopes: fittingEsi.MONITOR_REQUIRED_SCOPES,
    token_status: "ok",
  }, {
    skills: {
      data_kind: "skills",
      payload: {
        skill_details: {
          3300: { trained_skill_level: 5, active_skill_level: 3, skillpoints_in_skill: 256000 },
        },
      },
      fetched_at: "2026-08-07T16:59:00Z",
      expires_at: "2026-08-07T17:05:00Z",
    },
    skill_queue: {
      data_kind: "skill_queue",
      payload: {
        queue: [{
          skill_id: 3301,
          queue_position: 0,
          finished_level: 4,
          start_date: "2026-08-07T18:00:00Z",
          finish_date: "2026-08-08T18:00:00Z",
        }],
      },
      fetched_at: "2026-08-07T16:59:00Z",
      expires_at: "2026-08-07T17:05:00Z",
    },
  });
  assert.equal(character.cloneState, "alpha");
  assert.equal(character.cloneStateInferred, true);
  assert.equal(character.currentTraining, null);
  assert.equal(character.queueState, "gap");
  assert.equal(character.nextTraining.skill_id, 3301);
});

function mockResponse(status, body, headers = {}) {
  const values = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => values.get(String(name).toLowerCase()) || null },
    text: async () => body == null ? "" : JSON.stringify(body),
  };
}

test("Skillnix clone refresh uses the clone endpoint and normalizes jump-clone implants", async (t) => {
  const calls = [];
  fittingEsi.__testing.setTestDependencies({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return mockResponse(200, {
        jump_clones: [{
          jump_clone_id: 7,
          location_id: 60003760,
          location_type: "station",
          implants: [10208],
        }],
      }, { "cache-control": "private, max-age=120" });
    },
    now: () => Date.parse("2026-08-07T17:00:00Z"),
  });
  t.after(() => fittingEsi.__testing.resetTestDependencies());

  const response = await fittingEsi.__testing.fetchMonitorKind(
    "clones",
    2112345678,
    "skillnix-access-token",
  );
  assert.match(calls[0].url, /\/characters\/2112345678\/clones\/\?datasource=tranquility$/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer skillnix-access-token");
  assert.equal(response.expiresAt.toISOString(), "2026-08-07T17:02:00.000Z");
  assert.equal(response.body.jumpClones[0].jumpCloneId, 7);
  assert.deepEqual(response.body.jumpClones[0].implants, [10208]);
});

test("ESI requests send User-Agent, timeout-compatible auth, ETag, and parse Expires", async (t) => {
  const calls = [];
  fittingEsi.__testing.setTestDependencies({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return mockResponse(200, { ok: true }, {
        etag: '"etag-2"',
        expires: "Fri, 07 Aug 2026 18:00:00 GMT",
        "x-esi-error-limit-remain": "99",
        "x-esi-error-limit-reset": "60",
      });
    },
    now: () => Date.parse("2026-08-07T17:00:00Z"),
  });
  t.after(() => fittingEsi.__testing.resetTestDependencies());
  const result = await fittingEsi.__testing.requestEsiResource("/characters/2112345678/skills/", {
    accessToken: "internal-access-token",
    etag: '"etag-1"',
  });
  assert.equal(result.etag, '"etag-2"');
  assert.equal(result.expiresAt.toISOString(), "2026-08-07T18:00:00.000Z");
  assert.match(calls[0].url, /datasource=tranquility/);
  assert.equal(calls[0].options.headers["If-None-Match"], '"etag-1"');
  assert.equal(calls[0].options.headers.Authorization, "Bearer internal-access-token");
  assert.match(calls[0].options.headers["User-Agent"], /triff\.tools/);
  assert.ok(calls[0].options.signal);
});

test("ESI cache freshness prefers Cache-Control s-maxage then max-age over Expires", async (t) => {
  const responses = [
    mockResponse(200, { ok: true }, {
      "cache-control": "public, max-age=60, s-maxage=120",
      expires: "Fri, 07 Aug 2026 20:00:00 GMT",
    }),
    mockResponse(200, { ok: true }, {
      "cache-control": "public, max-age=45",
      expires: "Fri, 07 Aug 2026 20:00:00 GMT",
    }),
  ];
  fittingEsi.__testing.setTestDependencies({
    fetch: async () => responses.shift(),
    now: () => Date.parse("2026-08-07T17:00:00Z"),
  });
  t.after(() => fittingEsi.__testing.resetTestDependencies());
  const shared = await fittingEsi.__testing.requestEsiResource("/characters/2112345678/");
  const browser = await fittingEsi.__testing.requestEsiResource("/characters/2112345678/");
  assert.equal(shared.expiresAt.toISOString(), "2026-08-07T17:02:00.000Z");
  assert.equal(browser.expiresAt.toISOString(), "2026-08-07T17:00:45.000Z");
});

test("ESI conditional requests preserve cached payload on 304", async (t) => {
  fittingEsi.__testing.setTestDependencies({
    fetch: async () => mockResponse(304, null, {
      etag: '"same"',
      expires: "Fri, 07 Aug 2026 18:00:00 GMT",
      "x-esi-error-limit-remain": "50",
      "x-esi-error-limit-reset": "60",
    }),
    now: () => Date.parse("2026-08-07T17:00:00Z"),
  });
  t.after(() => fittingEsi.__testing.resetTestDependencies());
  const result = await fittingEsi.__testing.requestEsiResource("/characters/2112345678/", { etag: '"same"' });
  assert.equal(result.notModified, true);
  assert.equal(result.body, null);
  assert.equal(result.etag, '"same"');
});

test("ESI error-budget headers pause requests before CCP exhausts the budget", async (t) => {
  let calls = 0;
  fittingEsi.__testing.setTestDependencies({
    fetch: async () => {
      calls += 1;
      return mockResponse(200, { ok: true }, {
        "x-esi-error-limit-remain": "2",
        "x-esi-error-limit-reset": "30",
      });
    },
    now: () => Date.parse("2026-08-07T17:00:00Z"),
  });
  t.after(() => fittingEsi.__testing.resetTestDependencies());
  await fittingEsi.__testing.requestEsiResource("/characters/2112345678/");
  await assert.rejects(
    fittingEsi.__testing.requestEsiResource("/characters/2112345678/"),
    (err) => err.code === "esi_error_budget_limited" && err.retryAfterMs === 30_000
  );
  assert.equal(calls, 1);
});

test("valid cached access tokens are reused without refreshing", async (t) => {
  const previousKey = process.env.ESI_TOKEN_ENCRYPTION_KEY;
  process.env.ESI_TOKEN_ENCRYPTION_KEY = "unit-test-encryption-key-with-sufficient-entropy";
  fittingEsi.__testing.setTestDependencies({
    now: () => Date.parse("2026-08-07T17:00:00Z"),
    pool: { connect: async () => { throw new Error("refresh should not run"); } },
  });
  t.after(() => {
    fittingEsi.__testing.resetTestDependencies();
    if (previousKey === undefined) delete process.env.ESI_TOKEN_ENCRYPTION_KEY;
    else process.env.ESI_TOKEN_ENCRYPTION_KEY = previousKey;
  });
  const encrypted = fittingEsi.__testing.encryptToken("cached-access-token");
  const result = await fittingEsi.__testing.accessTokenForCharacter({
    id: "link-1",
    user_id: 7,
    character_id: 2112345678,
    scopes: ["esi-skills.read_skills.v1"],
    access_token_encrypted: encrypted,
    access_token_expires_at: "2026-08-07T18:00:00Z",
  }, ["esi-skills.read_skills.v1"]);
  assert.equal(result.accessToken, "cached-access-token");
});

test("concurrent expired-token requests share one locked refresh", async (t) => {
  const previousKey = process.env.ESI_TOKEN_ENCRYPTION_KEY;
  process.env.ESI_TOKEN_ENCRYPTION_KEY = "unit-test-encryption-key-with-sufficient-entropy";
  const refreshToken = fittingEsi.__testing.encryptToken("old-refresh-token");
  const row = {
    id: "link-single-flight",
    user_id: 7,
    character_id: 2112345678,
    character_name: "Ada Capsuleer",
    owner_hash: "owner-1",
    scopes: ["esi-skills.read_skills.v1"],
    access_token_encrypted: fittingEsi.__testing.encryptToken("expired-access"),
    refresh_token_encrypted: refreshToken,
    access_token_expires_at: "2026-08-07T16:00:00Z",
  };
  let connectCount = 0;
  let tokenCount = 0;
  const client = {
    query: async (sql) => {
      const normalized = String(sql).trim();
      if (normalized.startsWith("SELECT * FROM fitting_esi_characters")) return { rows: [row] };
      if (normalized.startsWith("UPDATE fitting_esi_characters")) return { rows: [{ ...row, access_token_expires_at: "2026-08-07T18:00:00Z" }] };
      return { rows: [] };
    },
    release: () => {},
  };
  fittingEsi.__testing.setTestDependencies({
    now: () => Date.parse("2026-08-07T17:00:00Z"),
    pool: {
      connect: async () => { connectCount += 1; return client; },
      query: async () => ({ rows: [], rowCount: 0 }),
    },
    tokenRequest: async () => {
      tokenCount += 1;
      return { access_token: "new-access", refresh_token: "rotated-refresh", expires_in: 1200 };
    },
    validateAccessToken: async () => ({
      characterId: 2112345678,
      characterName: "Ada Capsuleer",
      ownerHash: "owner-1",
      scopes: ["esi-skills.read_skills.v1"],
      expiresAt: new Date("2026-08-07T18:00:00Z"),
    }),
  });
  t.after(() => {
    fittingEsi.__testing.resetTestDependencies();
    if (previousKey === undefined) delete process.env.ESI_TOKEN_ENCRYPTION_KEY;
    else process.env.ESI_TOKEN_ENCRYPTION_KEY = previousKey;
  });
  const [first, second] = await Promise.all([
    fittingEsi.__testing.accessTokenForCharacter(row, ["esi-skills.read_skills.v1"]),
    fittingEsi.__testing.accessTokenForCharacter(row, ["esi-skills.read_skills.v1"]),
  ]);
  assert.equal(first.accessToken, "new-access");
  assert.equal(second.accessToken, "new-access");
  assert.equal(connectCount, 1);
  assert.equal(tokenCount, 1);
});

test("owner-hash changes revoke the link instead of accepting rotated tokens", async (t) => {
  const previousKey = process.env.ESI_TOKEN_ENCRYPTION_KEY;
  process.env.ESI_TOKEN_ENCRYPTION_KEY = "unit-test-encryption-key-with-sufficient-entropy";
  const row = {
    id: "link-owner-change",
    user_id: 7,
    character_id: 2112345678,
    character_name: "Ada Capsuleer",
    owner_hash: "owner-before-transfer",
    scopes: ["esi-skills.read_skills.v1"],
    refresh_token_encrypted: fittingEsi.__testing.encryptToken("refresh-token"),
    access_token_expires_at: "2026-08-07T16:00:00Z",
  };
  const failureUpdates = [];
  const client = {
    query: async (sql) => {
      const normalized = String(sql).trim();
      if (normalized.startsWith("SELECT * FROM fitting_esi_characters")) return { rows: [row] };
      return { rows: [] };
    },
    release: () => {},
  };
  fittingEsi.__testing.setTestDependencies({
    now: () => Date.parse("2026-08-07T17:00:00Z"),
    pool: {
      connect: async () => client,
      query: async (sql, params) => { failureUpdates.push({ sql: String(sql), params }); return { rows: [], rowCount: 1 }; },
    },
    tokenRequest: async () => ({ access_token: "new-owner-token", refresh_token: "new-refresh", expires_in: 1200 }),
    validateAccessToken: async () => ({
      characterId: 2112345678,
      characterName: "Ada Capsuleer",
      ownerHash: "owner-after-transfer",
      scopes: ["esi-skills.read_skills.v1"],
      expiresAt: new Date("2026-08-07T18:00:00Z"),
    }),
  });
  t.after(() => {
    fittingEsi.__testing.resetTestDependencies();
    if (previousKey === undefined) delete process.env.ESI_TOKEN_ENCRYPTION_KEY;
    else process.env.ESI_TOKEN_ENCRYPTION_KEY = previousKey;
  });
  await assert.rejects(
    fittingEsi.__testing.accessTokenForCharacter(row, ["esi-skills.read_skills.v1"]),
    (err) => err.code === "character_owner_changed" && err.reauthRequired === true
  );
  assert.equal(failureUpdates.length, 1);
  assert.deepEqual(failureUpdates[0].params.slice(2), ["reauth_required", "character_owner_changed", true, "fitting"]);
});

test("Skillnix token refresh locks and updates only the Skillnix app row", async (t) => {
  const previousKey = process.env.ESI_TOKEN_ENCRYPTION_KEY;
  process.env.ESI_TOKEN_ENCRYPTION_KEY = "unit-test-encryption-key-with-sufficient-entropy";
  const row = {
    id: "link-skillnix-refresh",
    user_id: 7,
    character_id: 2112345678,
    sso_app: "skillnix",
    character_name: "Ada Capsuleer",
    owner_hash: "owner-1",
    scopes: fittingEsi.MONITOR_REQUIRED_SCOPES,
    refresh_token_encrypted: fittingEsi.__testing.encryptToken("skillnix-refresh-token"),
    access_token_expires_at: "2026-08-07T16:00:00Z",
  };
  const clientCalls = [];
  const appCalls = [];
  const client = {
    query: async (sql, params) => {
      clientCalls.push({ sql: String(sql), params });
      const normalized = String(sql).trim();
      if (normalized.startsWith("SELECT * FROM fitting_esi_characters")) return { rows: [row] };
      if (normalized.startsWith("UPDATE fitting_esi_characters")) return { rows: [{ ...row, access_token_expires_at: "2026-08-07T18:00:00Z" }] };
      return { rows: [] };
    },
    release: () => {},
  };
  fittingEsi.__testing.setTestDependencies({
    now: () => Date.parse("2026-08-07T17:00:00Z"),
    pool: { connect: async () => client, query: async () => ({ rows: [], rowCount: 0 }) },
    tokenRequest: async (params, ssoApp) => {
      appCalls.push({ operation: "token", params, ssoApp });
      return { access_token: "new-skillnix-access", refresh_token: "rotated-skillnix-refresh", expires_in: 1200 };
    },
    validateAccessToken: async (_token, requiredScopes, ssoApp) => {
      appCalls.push({ operation: "validate", requiredScopes, ssoApp });
      return {
        characterId: 2112345678,
        characterName: "Ada Capsuleer",
        ownerHash: "owner-1",
        scopes: fittingEsi.MONITOR_REQUIRED_SCOPES,
        expiresAt: new Date("2026-08-07T18:00:00Z"),
      };
    },
  });
  t.after(() => {
    fittingEsi.__testing.resetTestDependencies();
    if (previousKey === undefined) delete process.env.ESI_TOKEN_ENCRYPTION_KEY;
    else process.env.ESI_TOKEN_ENCRYPTION_KEY = previousKey;
  });

  const result = await fittingEsi.__testing.accessTokenForCharacter(row, ["esi-skills.read_skills.v1"]);
  assert.equal(result.accessToken, "new-skillnix-access");
  const locked = clientCalls.find((call) => call.sql.includes("FOR UPDATE"));
  assert.deepEqual(locked.params, [7, 2112345678, "skillnix"]);
  const updated = clientCalls.find((call) => call.sql.trim().startsWith("UPDATE fitting_esi_characters"));
  assert.equal(updated.params.at(-1), "skillnix");
  assert.deepEqual(appCalls.map((call) => call.ssoApp), ["skillnix", "skillnix"]);
});

test("state consumption and character reads/unlinks are app-isolated", async (t) => {
  const calls = [];
  fittingEsi.__testing.setTestDependencies({
    ensureAuthSchema: async () => {},
    pool: {
      query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        return { rows: [], rowCount: String(sql).includes("DELETE FROM fitting_esi_characters") ? 1 : 0 };
      },
    },
  });
  t.after(() => fittingEsi.__testing.resetTestDependencies());

  await fittingEsi.consumeOAuthState("fitting-state");
  await fittingEsi.consumeSkillnixOAuthState("skillnix-state");
  await fittingEsi.listCharacters(7);
  await fittingEsi.listMonitorCharacters(7);
  await fittingEsi.unlinkCharacter(7, 2112345678);
  await fittingEsi.unlinkMonitorCharacter(7, 2112345678);

  const stateDeletes = calls.filter((call) => call.sql.includes("DELETE FROM fitting_esi_oauth_states") && call.params);
  assert.equal(stateDeletes.length, 2);
  assert.ok(stateDeletes.every((call) => call.sql.includes("sso_app = $2")));
  assert.deepEqual(stateDeletes.map((call) => call.params[1]), ["fitting", "skillnix"]);
  assert.ok(calls.some((call) => call.sql.includes("sso_app = 'fitting'") && call.sql.includes("ORDER BY lower(character_name)")));
  assert.ok(calls.some((call) => call.sql.includes("sso_app = 'skillnix'") && call.sql.includes("ORDER BY lower(character_name)")));
  assert.ok(calls.some((call) => call.sql.includes("DELETE FROM fitting_esi_characters") && call.sql.includes("sso_app = 'fitting'")));
  assert.ok(calls.some((call) => call.sql.includes("DELETE FROM fitting_esi_characters") && call.sql.includes("sso_app = 'skillnix'")));
});

test("fitting and Skillnix logins use separate apps and flow-bound OAuth state", async (t) => {
  const previous = {
    id: process.env.EVE_SSO_CLIENT_ID,
    secret: process.env.EVE_SSO_CLIENT_SECRET,
    callback: process.env.EVE_SSO_CALLBACK_URL,
    skillnixId: process.env.SKILLNIX_EVE_SSO_CLIENT_ID,
    skillnixSecret: process.env.SKILLNIX_EVE_SSO_CLIENT_SECRET,
    skillnixCallback: process.env.SKILLNIX_EVE_SSO_CALLBACK_URL,
    encryption: process.env.ESI_TOKEN_ENCRYPTION_KEY,
  };
  process.env.EVE_SSO_CLIENT_ID = "fitting-client-id";
  process.env.EVE_SSO_CLIENT_SECRET = "fitting-client-secret";
  process.env.EVE_SSO_CALLBACK_URL = "https://triff.tools/api/fitting/esi/callback";
  process.env.SKILLNIX_EVE_SSO_CLIENT_ID = "skillnix-client-id";
  process.env.SKILLNIX_EVE_SSO_CLIENT_SECRET = "skillnix-client-secret";
  process.env.SKILLNIX_EVE_SSO_CALLBACK_URL = "https://triff.tools/api/character-monitor/esi/callback";
  process.env.ESI_TOKEN_ENCRYPTION_KEY = "unit-test-encryption-key-with-sufficient-entropy";
  const calls = [];
  fittingEsi.__testing.setTestDependencies({
    ensureAuthSchema: async () => {},
    pool: {
      query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        return { rows: [], rowCount: 0 };
      },
    },
    now: () => Date.parse("2026-08-07T17:00:00Z"),
  });
  t.after(() => {
    fittingEsi.__testing.resetTestDependencies();
    const restore = (key, value) => value === undefined ? delete process.env[key] : process.env[key] = value;
    restore("EVE_SSO_CLIENT_ID", previous.id);
    restore("EVE_SSO_CLIENT_SECRET", previous.secret);
    restore("EVE_SSO_CALLBACK_URL", previous.callback);
    restore("SKILLNIX_EVE_SSO_CLIENT_ID", previous.skillnixId);
    restore("SKILLNIX_EVE_SSO_CLIENT_SECRET", previous.skillnixSecret);
    restore("SKILLNIX_EVE_SSO_CALLBACK_URL", previous.skillnixCallback);
    restore("ESI_TOKEN_ENCRYPTION_KEY", previous.encryption);
  });
  const fittingUrl = new URL(await fittingEsi.createLoginUrl(7));
  const skillnixUrl = new URL(await fittingEsi.createMonitorLoginUrl(7, { returnTo: "/skillnix/plans?selected=abc" }));
  assert.equal(fittingUrl.searchParams.get("client_id"), "fitting-client-id");
  assert.equal(fittingUrl.searchParams.get("redirect_uri"), "https://triff.tools/api/fitting/esi/callback");
  assert.deepEqual(fittingUrl.searchParams.get("scope").split(" "), fittingEsi.REQUIRED_SCOPES);
  assert.equal(skillnixUrl.searchParams.get("client_id"), "skillnix-client-id");
  assert.equal(skillnixUrl.searchParams.get("redirect_uri"), "https://triff.tools/api/character-monitor/esi/callback");
  assert.deepEqual(skillnixUrl.searchParams.get("scope").split(" "), fittingEsi.MONITOR_REQUIRED_SCOPES);
  const inserts = calls.filter((call) => call.sql.includes("INSERT INTO fitting_esi_oauth_states (") && call.params);
  assert.equal(inserts.length, 2);
  assert.equal(inserts[0].params[3], "fitting");
  assert.deepEqual(JSON.parse(inserts[0].params[4]), fittingEsi.REQUIRED_SCOPES);
  assert.equal(inserts[0].params[5], "/fitting");
  assert.equal(inserts[1].params[3], "skillnix");
  assert.deepEqual(JSON.parse(inserts[1].params[4]), fittingEsi.MONITOR_REQUIRED_SCOPES);
  assert.equal(inserts[1].params[5], "/skillnix/plans?selected=abc");
  assert.ok(calls.some((call) => call.sql.includes("CREATE TABLE IF NOT EXISTS fitting_esi_character_cache")));
});

test("OAuth return targets are same-site and callback HTML supports direct navigation", () => {
  assert.equal(fittingEsi.__testing.normalizeReturnTo("/skillnix/character/7/skills"), "/skillnix/character/7/skills");
  assert.equal(fittingEsi.__testing.normalizeReturnTo("/triffmon/character/7/skills"), "/triffmon/character/7/skills");
  assert.equal(fittingEsi.__testing.normalizeReturnTo("https://evil.example/"), "/fitting");
  assert.equal(fittingEsi.__testing.normalizeReturnTo("//evil.example/"), "/fitting");
  const html = fittingEsi.callbackHtml({ ok: true, returnTo: "/triffmon", characterId: 7 });
  assert.match(html, /TRIFF_EVE_SSO_COMPLETE/);
  assert.match(html, /window\.location\.replace\(message\.returnTo\)/);
  assert.match(html, /postMessage\(message, window\.location\.origin\)/);
});
