const test = require("node:test");
const assert = require("node:assert/strict");
const { startDisposablePostgres } = require("./disposablePostgres");

async function maybeStartPostgres(t) {
  try {
    return await startDisposablePostgres();
  } catch (err) {
    t.skip(err.message);
    return null;
  }
}

function requireIntegrationDependency(t, request) {
  try {
    return require(request);
  } catch (err) {
    if (err && err.code === "MODULE_NOT_FOUND") {
      t.skip(`${request} dependency is not installed; run npm install before integration tests`);
      return null;
    }
    throw err;
  }
}

function updateCookieJar(headers, jar) {
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie")].filter(Boolean);

  for (const raw of setCookies) {
    const pair = String(raw).split(";")[0];
    if (!pair) continue;
    const [name, value] = pair.split("=");
    if (value) jar.set(name, `${name}=${value}`);
    else jar.delete(name);
  }
}

function makeClient(baseUrl) {
  const jar = new Map();

  return async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (jar.size) headers.set("cookie", Array.from(jar.values()).join("; "));

    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });
    updateCookieJar(response.headers, jar);
    return response;
  };
}

async function startIntegrationApp(t, databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
  process.env.PGSSL = "false";

  const express = requireIntegrationDependency(t, "express");
  if (!express) return null;

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/auth", require("../../routes/auth"));
  app.use("/api/tool-setups", require("../../routes/toolSetups"));
  app.use("/api/tool-state", require("../../routes/toolState"));
  app.use("/api/account", require("../../routes/account"));
  app.use("/api", require("../../routes/appraisals"));

  const pool = require("../../db/pool");
  const legacyPool = require("../../db").pool;
  let stopping = false;
  const failBeforeShutdown = (err) => {
    if (!stopping) throw err;
  };
  pool.on("error", failBeforeShutdown);
  legacyPool.on("error", failBeforeShutdown);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appraisals (
      id text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      station_id bigint NOT NULL,
      mode text NOT NULL,
      input_raw text NOT NULL,
      totals jsonb NOT NULL,
      rows jsonb NOT NULL,
      version int NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS battle_reports (
      id text PRIMARY KEY,
      title text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      system_id bigint,
      system_name text,
      start_time timestamptz,
      end_time timestamptz,
      summary jsonb NOT NULL DEFAULT '{}'::jsonb
    );
  `);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async stop() {
      stopping = true;
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await Promise.all([pool.end(), legacyPool.end()]);
    },
  };
}

test("account auth persists saved setups, remembered state, and generated appraisal links", async (t) => {
  const pg = await maybeStartPostgres(t);
  if (!pg) return;

  const app = await startIntegrationApp(t, pg.databaseUrl);
  if (!app) {
    pg.stop();
    return;
  }
  t.after(async () => {
    await app.stop();
    pg.stop();
  });

  const request = makeClient(app.baseUrl);

  const register = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username: "IntegrationPilot",
      password: "correct-horse-battery-staple",
    }),
  });
  assert.equal(register.status, 201);
  assert.equal((await register.json()).user.username, "IntegrationPilot");

  const me = await request("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal((await me.json()).authenticated, true);

  const createSetup = await request("/api/tool-setups/gas-calc", {
    method: "POST",
    body: JSON.stringify({
      setupName: "C540 Venture Pair",
      setupJson: { version: 1, ships: 2, gas: "Fullerite-C540" },
      summaryJson: { ship: "Venture", shipCount: 2 },
    }),
  });
  assert.equal(createSetup.status, 201);
  const setup = (await createSetup.json()).setup;
  assert.equal(setup.setupName, "C540 Venture Pair");
  assert.deepEqual(setup.setupJson, { version: 1, ships: 2, gas: "Fullerite-C540" });

  const setupList = await request("/api/tool-setups/gas-calc");
  assert.equal(setupList.status, 200);
  assert.deepEqual((await setupList.json()).setups.map((row) => row.setupName), ["C540 Venture Pair"]);

  const stateUpdate = await request("/api/tool-state/market-browser-quickbar", {
    method: "PUT",
    body: JSON.stringify({
      stateJson: {
        version: 1,
        quickbar: [{ type_id: 34, type_name: "Tritanium" }],
      },
    }),
  });
  assert.equal(stateUpdate.status, 200);

  const stateRead = await request("/api/tool-state/market-browser-quickbar");
  assert.equal(stateRead.status, 200);
  assert.deepEqual((await stateRead.json()).state.stateJson.quickbar, [
    { type_id: 34, type_name: "Tritanium" },
  ]);

  const appraisalCreate = await request("/api/appraisals", {
    method: "POST",
    body: JSON.stringify({
      station_id: 60003760,
      mode: "sell",
      input_raw: "10 Tritanium",
      totals: { sell: 55, itemCount: 1 },
      rows: [{ type_id: 34, name: "Tritanium", qty: 10, price: 5.5, lineISK: 55 }],
    }),
  });
  assert.equal(appraisalCreate.status, 200);
  const appraisal = await appraisalCreate.json();
  assert.match(appraisal.id, /^[0-9A-Za-z]{6}$/);

  const links = await request("/api/account/links?limit=10");
  assert.equal(links.status, 200);
  const body = await links.json();
  assert.deepEqual(body.appraisals.map((row) => row.id), [appraisal.id]);
  assert.equal(body.appraisals[0].row_count, 1);

  const deletionSummary = await request("/api/account/deletion-summary");
  assert.equal(deletionSummary.status, 200);
  const summary = (await deletionSummary.json()).summary;
  assert.ok(summary.sections.some((section) => section.key === "toolSetups" && section.count === 1));
  assert.ok(summary.sections.some((section) => section.key === "toolState" && section.count === 1));
  assert.ok(summary.sections.some((section) => section.key === "accountLinks" && section.count === 1));

  const wrongDelete = await request("/api/account/me", {
    method: "DELETE",
    body: JSON.stringify({
      password: "wrong-horse-battery-staple",
      confirmation: "DELETE",
    }),
  });
  assert.equal(wrongDelete.status, 401);

  const accountDelete = await request("/api/account/me", {
    method: "DELETE",
    body: JSON.stringify({
      password: "correct-horse-battery-staple",
      confirmation: "DELETE",
    }),
  });
  assert.equal(accountDelete.status, 200);
  assert.equal((await accountDelete.json()).deleted, true);

  const meAfterDelete = await request("/api/auth/me");
  assert.equal(meAfterDelete.status, 200);
  assert.equal((await meAfterDelete.json()).authenticated, false);

  const pool = require("../../db/pool");
  const deletedRows = await pool.query(
    `SELECT
       (SELECT COUNT(*)::integer FROM anoikis_command_users WHERE username_normalized = 'integrationpilot') AS users,
       (SELECT COUNT(*)::integer FROM tool_saved_setups) AS setups,
       (SELECT COUNT(*)::integer FROM tool_user_state) AS states,
       (SELECT COUNT(*)::integer FROM account_generated_links) AS links`
  );
  assert.deepEqual(deletedRows.rows[0], {
    users: 0,
    setups: 0,
    states: 0,
    links: 0,
  });
});
