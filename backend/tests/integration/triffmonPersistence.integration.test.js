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

test("TriffMon migrations preserve legacy plans and enforce account ownership", async (t) => {
  const postgres = await maybeStartPostgres(t);
  if (!postgres) return;

  process.env.DATABASE_URL = postgres.databaseUrl;
  process.env.PGSSL = "false";
  const pool = require("../../db/pool");
  t.after(async () => {
    await pool.end().catch(() => undefined);
    postgres.stop();
  });

  const siteAuth = require("../../services/siteAuth");
  const fittingEsi = require("../../services/fittingEsi");
  await siteAuth.ensureAuthSchema();
  await fittingEsi.ensureEsiSchema();

  const users = await pool.query(`
    INSERT INTO anoikis_command_users (
      username, username_normalized, password_hash, password_salt
    ) VALUES
      ('LegacyPilot', 'legacypilot', 'hash', 'salt'),
      ('OtherPilot', 'otherpilot', 'hash', 'salt')
    RETURNING id, username_normalized
  `);
  const userByName = Object.fromEntries(users.rows.map((row) => [row.username_normalized, row.id]));
  const ownerId = userByName.legacypilot;
  const otherId = userByName.otherpilot;
  const characterId = 2112345678;
  await pool.query(
    `INSERT INTO fitting_esi_characters (
       id, user_id, character_id, sso_app, character_name, scopes, refresh_token_encrypted
     ) VALUES ($1, $2, $3, 'skillnix', 'Legacy Capsuleer', '[]'::jsonb, 'encrypted-test-token')`,
    ["10000000-0000-4000-8000-000000000001", ownerId, characterId]
  );

  await pool.query(`
    CREATE TABLE skillnix_plans (
      id UUID PRIMARY KEY,
      user_id BIGINT NOT NULL,
      character_id BIGINT,
      plan_name TEXT,
      plan_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_opened_at TIMESTAMPTZ
    )
  `);
  const legacyPlanId = "20000000-0000-4000-8000-000000000001";
  await pool.query(
    `INSERT INTO skillnix_plans (
       id, user_id, character_id, plan_name, plan_json
     ) VALUES ($1, $2, $3, 'Legacy Plan', $4::jsonb)`,
    [legacyPlanId, ownerId, characterId, JSON.stringify({
      entries: [
        { skillTypeId: 3413, level: 3, entryType: "Planned" },
        { type: "remap", name: "Perception remap", baseAttributes: { perception: 27, willpower: 21, intelligence: 17, memory: 17, charisma: 17 } },
        { skillTypeId: 3413, level: 5, entryType: "Planned" },
        { skillTypeId: 3426, level: 4, entryType: "Prerequisite" },
      ],
    })]
  );

  const { runMigrations } = require("../../db/migrations");
  await runMigrations();

  const migrated = await pool.query(
    `SELECT p.user_id, p.character_id, p.source_type, p.source_metadata,
            e.skill_type_id, e.target_level, e.is_explicit
     FROM triffmon_skill_plans p
     JOIN triffmon_skill_plan_entries e ON e.plan_id = p.id
     WHERE p.id = $1
     ORDER BY e.skill_type_id`,
    [legacyPlanId]
  );
  assert.equal(migrated.rows.length, 2);
  assert.equal(String(migrated.rows[0].user_id), String(ownerId));
  assert.equal(Number(migrated.rows[0].character_id), characterId);
  assert.equal(migrated.rows[0].source_type, "legacy_skillnix");
  assert.deepEqual(
    migrated.rows.map((row) => [row.skill_type_id, row.target_level, row.is_explicit]),
    [[3413, 5, true], [3426, 4, false]]
  );
  assert.ok(migrated.rows[0].source_metadata.warnings.some((warning) => warning.includes("collapsed")));
  assert.deepEqual(migrated.rows[0].source_metadata.originalPlanJson.entries[0], {
    skillTypeId: 3413,
    level: 3,
    entryType: "Planned",
  });

  await pool.query(
    `INSERT INTO triffmon_character_preferences (user_id, character_id, is_favorite)
     VALUES ($1, $2, true)`,
    [ownerId, characterId]
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO triffmon_character_preferences (user_id, character_id)
       VALUES ($1, $2)`,
      [otherId, characterId]
    ),
    (error) => error.code === "23503"
  );

  const migrationRows = await pool.query(
    "SELECT id FROM triff_schema_migrations WHERE id = '2026080701_triffmon'"
  );
  assert.equal(migrationRows.rowCount, 1);

  await pool.query("DELETE FROM anoikis_command_users WHERE id = $1", [ownerId]);
  const remaining = await pool.query(`
    SELECT
      (SELECT count(*)::integer FROM triffmon_skill_plans) AS plans,
      (SELECT count(*)::integer FROM triffmon_character_preferences) AS preferences,
      (SELECT count(*)::integer FROM fitting_esi_characters) AS characters
  `);
  assert.deepEqual(remaining.rows[0], { plans: 0, preferences: 0, characters: 0 });
});
