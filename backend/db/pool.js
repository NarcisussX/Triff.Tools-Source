/*
 * Database helper for pool.
 * Configures Postgres access or schema initialization used by backend routes and services.
 */

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
});

module.exports = pool;
