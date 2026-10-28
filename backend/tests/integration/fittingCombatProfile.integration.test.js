const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

test("real fitting router exports profiles through the live eos service", {
  skip: process.env.RUN_COMBAT_PROFILE_INTEGRATION !== "1",
  timeout: 60_000,
}, async () => {
  process.env.FITTING_COMBAT_PROFILE_RATE_PER_MINUTE = "1";
  process.env.FITTING_COMBAT_PROFILE_RATE_BURST = "4";
  const express = require("express");
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use("/api/fitting", require("../../routes/fitting"));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/api/fitting/combat-profile`;
  async function send(body) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { response, body: await response.json() };
  }
  try {
    const first = await send({ eft: "[Raven, HTTP]\nCruise Missile Launcher II, Scourge Fury Cruise Missile\nHeavy Capacitor Booster II, Navy Cap Booster 800\n\nNavy Cap Booster 800 x12\n",
      skillProfile: { mode: "esi_character", characterId: 1, skills: { 3300: 1 } } });
    assert.equal(first.response.status, 200, JSON.stringify(first.body));
    assert.equal(first.response.headers.get("cache-control"), "no-store");
    assert.equal(first.body.profile.ship.typeName, "Raven");
    assert.equal(first.body.combatProfileSchemaVersion, "1.1.0");
    assert.equal(first.body.profile.combatProfileSchemaVersion, "1.1.0");
    assert.equal(first.body.profile.skills.profile.mode, "all_v");
    assert.equal(first.body.profile.skills.profile.skills, undefined);
    assert.ok(first.body.warnings.some((warning) => warning.code === "skill_profile_fallback"));
    assert.ok(first.body.profile.modules[0].damage.dps.total > 0);
    const booster = first.body.profile.modules.find((module) => module.capacitorBooster)?.capacitorBooster;
    assert.ok(booster);
    assert.equal(booster.capacitorGainGj, 800);
    assert.equal(booster.spareCharges, 12);
    assert.equal(booster.loadedCharges, booster.magazineCapacity);
    const normalized = await send({ payload: { shipTypeId: 587, fitName: "HTTP Payload", modules: {} } });
    assert.equal(normalized.response.status, 200, JSON.stringify(normalized.body));
    assert.equal(normalized.body.profile.ship.typeName, "Rifter");
    const crossfit = await send({ payload: { targetFit: { shipTypeId: 587, fitName: "Cross-fit HTTP", modules: {} },
      sourceFits: [{ tabId: "source", fitState: { shipTypeId: 587, modules: {} } }], commandLinks: [] } });
    assert.equal(crossfit.response.status, 200, JSON.stringify(crossfit.body));
    const incompatible = await send({ eft: "[Raven, Invalid]\nCruise Missile Launcher II, Scourge Fury Cruise Missile\n",
      moduleOverrides: [{ rack: "high", index: 0, chargeTypeId: 34 }] });
    assert.equal(incompatible.response.status, 422, JSON.stringify(incompatible.body));
    assert.equal(incompatible.body.profile, null);
    const limited = await send({ eft: "[Rifter, Limited]\n" });
    assert.equal(limited.response.status, 429);
    assert.equal(limited.response.headers.get("retry-after"), "60");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
