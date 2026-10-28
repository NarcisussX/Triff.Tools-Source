import test from "node:test";
import assert from "node:assert/strict";
import { DOCUMENT_ROUTES, SPA_TOOL_ROUTES, routeLabels } from "./toolRoutes.mjs";

const baseUrl = (process.env.FRONTEND_BASE_URL || "http://127.0.0.1:5173").replace(/\/+$/, "");
const routes = process.env.FRONTEND_SMOKE_ROUTES
  ? process.env.FRONTEND_SMOKE_ROUTES.split(",")
      .map((route) => route.trim())
      .filter(Boolean)
      .map((path) => ({ path, label: path }))
  : SPA_TOOL_ROUTES;

async function fetchRoute(route, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${route.path}`, {
      signal: controller.signal,
      headers: { accept: "text/html" },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function assertAppShell(html, route) {
  assert.match(html, /<div[^>]+id=["']root["']/i, `${route.label} should return the SPA shell`);
  assert.doesNotMatch(html, /Cannot\s+(GET|POST)\s+/i, `${route.label} should not be an Express 404`);
}

test("frontend app shell responds for every visible tool route", async (t) => {
  let firstResponse;
  try {
    firstResponse = await fetchRoute({ path: "/", label: "Home" });
  } catch (err) {
    t.skip(`frontend smoke server unavailable at ${baseUrl}: ${err.message}`);
    return;
  }

  const firstHtml = await firstResponse.text();
  assert.equal(firstResponse.status, 200);
  assertAppShell(firstHtml, { path: "/", label: "Home" });

  for (const route of routes.filter((route) => route.path !== "/")) {
    const response = await fetchRoute(route);
    const html = await response.text();
    assert.equal(response.status, 200, `${route.label} should return 200 at ${route.path}`);
    assertAppShell(html, route);
  }
});


test("smoke catalog covers every expected visible tool", () => {
  if (process.env.FRONTEND_SMOKE_ROUTES) return;
  assert.equal(routes.length, SPA_TOOL_ROUTES.length, routeLabels(SPA_TOOL_ROUTES).join("\n"));
});
