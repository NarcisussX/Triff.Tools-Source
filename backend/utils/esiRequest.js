/*
 * Backend utility module for esi Request.
 * Provides reusable helper functions for routes, workers, or startup tasks.
 */

const axios = require("axios");

const ESI_HEADERS = {
  "User-Agent": "Triff.Tools/2.1.0 (contact: cooperbroderick25@gmail.com)",
};

async function fetchESI(url) {
  try {
    const response = await axios.get(url, { headers: ESI_HEADERS });
    return response.data;
  } catch (error) {
    console.error(`[ESI]: Error fetching ESI: ${url}`, error.response?.status || error.message);
    return null;
  }
}

module.exports = fetchESI;
