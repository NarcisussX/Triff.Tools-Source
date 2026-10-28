/*
 * Thin HTTP client for the isolated Python fitting-service.
 * Keeps browser traffic routed through the existing Express backend.
 */

const DEFAULT_URL = "http://fitting-service:8000";

async function getFetch() {
  if (typeof global.fetch === "function") return global.fetch;
  const mod = await import("node-fetch");
  return mod.default || mod;
}

function baseUrl() {
  return (process.env.FITTING_SERVICE_URL || DEFAULT_URL).replace(/\/+$/, "");
}

async function request(path, options = {}) {
  const fetch = await getFetch();
  const url = `${baseUrl()}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { ok: false, error: "bad_json", raw: text };
  }

  if (!response.ok) {
    const err = new Error(`fitting-service ${response.status}`);
    err.status = response.status;
    err.body = body;
    throw err;
  }

  return body;
}

async function binaryRequest(path, options = {}) {
  const fetch = await getFetch();
  const url = `${baseUrl()}${path}`;
  const response = await fetch(url, options);
  if (!response.ok) {
    const err = new Error(`fitting-service ${response.status}`);
    err.status = response.status;
    throw err;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    contentType: response.headers.get("content-type") || "application/octet-stream",
    cacheControl: response.headers.get("cache-control") || null,
  };
}

function getHealth() {
  return request("/health", { method: "GET" });
}

function getType(typeId) {
  return request(`/type/${encodeURIComponent(typeId)}`, { method: "GET" });
}

function getCharges(typeId) {
  return request(`/charges/${encodeURIComponent(typeId)}`, { method: "GET" });
}

function getMutaplasmids(typeId) {
  return request(`/mutaplasmids/${encodeURIComponent(typeId)}`, { method: "GET" });
}

function getVariants(typeId) {
  return request(`/variants/${encodeURIComponent(typeId)}`, { method: "GET" });
}

function getImplantSets() {
  return request("/implant-sets", { method: "GET" });
}

function getEnvironmentEffects() {
  return request("/environment-effects", { method: "GET" });
}

function getDamageProfiles() {
  return request("/damage-profiles", { method: "GET" });
}

function getGraphs() {
  return request("/graphs", { method: "GET" });
}

function calculateGraph(payload) {
  return request("/graphs/calculate", {
    method: "POST",
    body: JSON.stringify({ payload: payload || {} }),
  });
}

function getIcon(iconId) {
  return binaryRequest(`/icons/${encodeURIComponent(iconId)}`, { method: "GET" });
}

function getGuiIcon(iconName) {
  return binaryRequest(`/gui-icons/${encodeURIComponent(iconName)}`, { method: "GET" });
}

function calculate(payload) {
  return request("/calculate", {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
}

function getAffectedSkills(payload, context) {
  return request("/affected-skills", {
    method: "POST",
    body: JSON.stringify({ payload: payload || {}, context: context || {} }),
  });
}

function getRollingStats(eft) {
  return request("/rolling-stats", {
    method: "POST",
    body: JSON.stringify({ eft: eft || "" }),
  });
}

function getCombatProfile(payload) {
  return request("/combat-profile", {
    method: "POST",
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
}

function importEft(text) {
  return request("/import/eft", {
    method: "POST",
    body: JSON.stringify({ text: text || "" }),
  });
}

function exportEft(payload) {
  return request("/export/eft", {
    method: "POST",
    body: JSON.stringify({ payload: payload || {} }),
  });
}

module.exports = {
  getHealth,
  getType,
  getCharges,
  getMutaplasmids,
  getVariants,
  getImplantSets,
  getEnvironmentEffects,
  getDamageProfiles,
  getGraphs,
  calculateGraph,
  getIcon,
  getGuiIcon,
  calculate,
  getAffectedSkills,
  getRollingStats,
  getCombatProfile,
  importEft,
  exportEft,
};
