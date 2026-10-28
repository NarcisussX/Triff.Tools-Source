/*
 * Initializes shared Postgres schema pieces used by market pricing and industry cost features.
 * Uses DATABASE_URL and runs startup DDL before the server accepts requests.
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function ensureSchemaWithRetry(retries = 10, delayMs = 3000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[MARKET_PRICES]: Attempt ${attempt} to ensure DB schema...`);
      await ensureSchema();
      console.log('[MARKET_PRICES]: Schema ensured');
      return;
    } catch (err) {
      console.error(`[MARKET_PRICES]: Attempt ${attempt} failed:`, err.message);
      if (attempt === retries) {
        throw new Error('[MARKET_PRICES]: All attempts to connect to DB failed.');
      }
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
}

async function ensureSchema() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_prices (
      id SERIAL PRIMARY KEY,
      type_id INTEGER NOT NULL,
      station VARCHAR(64) NOT NULL,
      buy_price NUMERIC(16,2) NOT NULL,
      sell_price NUMERIC(16,2) NOT NULL,
      avg_price NUMERIC(16,2) NOT NULL,
      fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE (type_id, station)
    );
  `);

  await pool.query(`
  CREATE TABLE IF NOT EXISTS wormhole_systems (
    jcode TEXT PRIMARY KEY,
    region TEXT,
    constellation TEXT,
    solarsystemid TEXT,
    class TEXT,
    effect TEXT,
    statics TEXT[],
    star_id BIGINT,
    star_name TEXT,
    star_type_id INTEGER
  );
`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS planets (
      planet_id BIGINT PRIMARY KEY,
      jcode TEXT REFERENCES wormhole_systems(jcode),
      name TEXT,
      type_id INTEGER,
      type_name TEXT,
      moon_count INTEGER
    );
  `);
}

module.exports = {
  pool,
  query: (...args) => pool.query(...args),
  ensureSchemaWithRetry,
};
