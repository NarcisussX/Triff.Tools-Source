/*
 * Seeds wormhole system data into Postgres when the table is empty.
 * Reads bundled enriched system data and writes rows during startup or manual seeding.
 */

const fs = require('fs');
const path = require('path');
const { pool, ensureSchemaWithRetry } = require('./db');

async function ensureTablesExist() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wormhole_systems (
      id SERIAL PRIMARY KEY,
      jcode TEXT UNIQUE,
      region TEXT,
      constellation TEXT,
      solarsystemid TEXT,
      class TEXT,
      effect TEXT,
      statics TEXT[],
      star_id BIGINT,
      star_type_id INT,
      star_name TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS planets (
      planet_id   BIGINT PRIMARY KEY,
      jcode       TEXT NOT NULL REFERENCES wormhole_systems(jcode) ON DELETE CASCADE,
      name        TEXT,
      type_id     INT,
      type_name   TEXT,
      moon_count  INT DEFAULT 0
    );
  `);
}
async function seedIfEmpty() {
  console.log('[SEED_WORMHOLES]: Attempting to ensure DB schema...');
  await ensureTablesExist();

  const res = await pool.query('SELECT COUNT(*) FROM wormhole_systems');
  const count = parseInt(res.rows[0].count, 10);

  if (count === 0) {
    console.log('[SEED_WORMHOLES]: Seeding database from enriched_systems.json...');
    await seed();
    console.log('[SEED_WORMHOLES]: Seeding complete!');
  } else {
    console.log(`[SEED_WORMHOLES]: Database already seeded (${count} entries). Skipping.`);
  }
}

async function seed() {
  await ensureSchemaWithRetry();

  const dataPath = path.join(__dirname, 'data', 'enriched_systems.json');
  const rawData = fs.readFileSync(dataPath);
  const systems = JSON.parse(rawData);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const jcode of Object.keys(systems)) {
      const system = systems[jcode];
      const celestials = system.celestials || {};

      const star = celestials.star || {};
      const planets = celestials.planets || [];

      await pool.query(
        `
        INSERT INTO wormhole_systems (
          jcode, region, constellation, solarsystemid, class, effect, statics, star_id, star_name, star_type_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (jcode) DO NOTHING;
        `,
        [
          jcode,
          system.region,
          system.constellation,
          system.solarsystemid,
          system.class,
          system.effect,
          system.statics || null,
          star.id || null,
          star.name || null,
          star.type_id || null,
        ]
      );

      for (const planet of planets) {
        await pool.query(
          `
          INSERT INTO planets (
            planet_id, jcode, name, type_id, type_name, moon_count
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (planet_id) DO NOTHING;
          `,
          [
            planet.id,
            jcode,
            planet.esi_name || null,
            planet.type_id || null,
            planet.type_name || null,
            planet.moons || 0,
          ]
        );
      }
    }

    await client.query('COMMIT');
    console.log('[SEED_WORMHOLES]: Seed complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[SEED_WORMHOLES]: Seed failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

(async () => {
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    try {
      console.log(`[SEED_WORMHOLES]: Attempt ${attempts + 1} to ensure DB schema...`);
      await seedIfEmpty();
      break;
    } catch (err) {
      attempts++;
      console.error(`[SEED_WORMHOLES]: Attempt ${attempts} failed:`, err);
      if (attempts >= maxAttempts) {
        console.error('[SEED_WORMHOLES]: Max retries reached. Exiting.');
        process.exit(1);
      }
      await new Promise((res) => setTimeout(res, 3000));
    }
  }

  await pool.end();
})();
