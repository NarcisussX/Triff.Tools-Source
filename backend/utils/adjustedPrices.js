/*
 * Backend utility module for adjusted Prices.
 * Provides reusable helper functions for routes, workers, or startup tasks.
 */

const fs = require("fs");
const path = require("path");

let adjustedPrices = {};

try {
  const filePath = path.join(__dirname, "../cache/adjusted_prices.json");
  if (fs.existsSync(filePath)) {
    adjustedPrices = JSON.parse(fs.readFileSync(filePath, "utf8"));
    console.log("[ADJUSTED_PRICES]: Loaded adjusted prices into memory");
  } else {
    console.warn("[ADJUSTED_PRICES]: adjusted_prices.json not found at:", filePath);
  }
} catch (err) {
  console.error("[ADJUSTED_PRICES]: Failed to load adjusted_prices.json:", err);
}

module.exports = adjustedPrices;
