/*
 * Backend utility module for fetch Adjusted Prices.
 * Provides reusable helper functions for routes, workers, or startup tasks.
 */

const fs = require("fs");
const path = require("path");
const fetchESI = require("./esiRequest");

const OUTPUT_PATH = path.join(__dirname, "../cache/adjusted_prices.json");
const TTL_HOURS = 24;
const ESI_URL = "https://esi.evetech.net/latest/markets/prices/";

async function fetchAdjustedPrices() {
  const data = await fetchESI(ESI_URL);
  if (!data || !Array.isArray(data)) {
    console.error("[ADJUSTED_PRICES]: Adjusted price fetch failed or returned invalid format.");
    return;
  }

  const now = new Date().toISOString();
  const priceMap = {};

  for (const entry of data) {
    if (entry.type_id && entry.adjusted_price) {
      priceMap[entry.type_id] = {
        adjusted: entry.adjusted_price,
        average: entry.average_price ?? null
      };
    }
  }

  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ fetchedAt: now, prices: priceMap }, null, 2)
  );

  console.log(`[ADJUSTED_PRICES]: Cached ${Object.keys(priceMap).length} entries at ${now}`);
}

if (require.main === module) {
  fetchAdjustedPrices();
}

module.exports = { fetchAdjustedPrices };
