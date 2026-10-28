/*
 * Backend library module for market Db.
 * Provides shared data loading, pricing, or planning helpers used by API routes and jobs.
 */

const pool = require('../db/pool');

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
