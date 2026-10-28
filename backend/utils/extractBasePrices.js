/*
 * Backend utility module for extract Base Prices.
 * Provides reusable helper functions for routes, workers, or startup tasks.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '../../sde/sqlite-latest.sqlite');
const sqlite = new Database(dbPath);
const output = {};

const rows = sqlite.prepare(`
  SELECT typeID, basePrice
  FROM invTypes
  WHERE basePrice IS NOT NULL
`).all();

for (const row of rows) {
  output[row.typeID] = Number(row.basePrice);
}

fs.writeFileSync(
  path.join(__dirname, '../routes/data/basePrices.json'),
  JSON.stringify(output, null, 2)
);

console.log(`[EXTRACT_BASE_PRICES]: Extracted ${Object.keys(output).length} base prices.`);
