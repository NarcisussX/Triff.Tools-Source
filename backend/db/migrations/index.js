const pool = require("../pool");
const siteAuth = require("../../services/siteAuth");
const fittingEsi = require("../../services/fittingEsi");
const triffmon = require("./2026080701_triffmon");

const migrations = [triffmon];
let migrationPromise = null;

async function applyMigrations() {
  await siteAuth.ensureAuthSchema();
  await fittingEsi.ensureEsiSchema();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS triff_schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["triff.tools:schema-migrations"]);

    for (const migration of migrations) {
      const applied = await client.query("SELECT 1 FROM triff_schema_migrations WHERE id = $1", [migration.id]);
      if (applied.rowCount) continue;
      await migration.up(client);
      await client.query("INSERT INTO triff_schema_migrations (id) VALUES ($1)", [migration.id]);
      console.log(`[migrations] Applied ${migration.id}`);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function runMigrations() {
  if (!migrationPromise) {
    migrationPromise = applyMigrations().catch((err) => {
      migrationPromise = null;
      throw err;
    });
  }
  return migrationPromise;
}

module.exports = {
  migrations,
  runMigrations,
};
