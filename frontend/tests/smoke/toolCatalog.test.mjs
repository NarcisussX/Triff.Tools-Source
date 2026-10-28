import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOCUMENT_ROUTES, SPA_TOOL_ROUTES, normalizePath } from "./toolRoutes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "../..");
const sourceRoot = path.join(frontendRoot, "src");

function readSource(relativePath) {
  return fs.readFileSync(path.join(sourceRoot, relativePath), "utf8");
}

function unique(values) {
  return Array.from(new Set(values));
}

function normalizedSet(paths) {
  return new Set(paths.map(normalizePath));
}

function expectSetContainsAll(actualSet, expectedPaths, label) {
  const missing = expectedPaths.filter((route) => !actualSet.has(normalizePath(route.path || route)));
  assert.deepEqual(
    missing.map((route) => route.path || route),
    [],
    `${label} is missing:\n${missing.map((route) => `${route.label || route.path || route} (${route.path || route})`).join("\n")}`
  );
}

function extractBetween(source, startPattern, endPattern) {
  const start = source.search(startPattern);
  assert.notEqual(start, -1, `Could not find ${startPattern}`);
  const rest = source.slice(start);
  const end = rest.search(endPattern);
  assert.notEqual(end, -1, `Could not find ${endPattern}`);
  return rest.slice(0, end);
}

function extractStringProps(source, propName) {
  const values = [];
  const pattern = new RegExp(`${propName}:\\s*"([^"]+)"`, "g");
  let match;
  while ((match = pattern.exec(source))) values.push(match[1]);
  return values;
}

function extractAppNavRoutes() {
  const source = readSource("App.tsx");
  const navSource = extractBetween(source, /const CALCULATORS:/, /const UI_SCALE_PRESETS/);
  return unique(extractStringProps(navSource, "to"));
}

function extractLandingToolRoutes() {
  const source = readSource(path.join("pages", "Landing.tsx"));
  const toolsSource = extractBetween(source, /const TOOLS:/, /const CATEGORIES:/);
  return unique(extractStringProps(toolsSource, "path"));
}

function extractMountedRoutes() {
  const source = readSource("App.tsx");
  const values = [];
  const pattern = /<Route\s+path="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(source))) values.push(match[1]);
  return unique(values);
}

function readSeoRoutes() {
  return JSON.parse(fs.readFileSync(path.join(sourceRoot, "seoRoutes.json"), "utf8"));
}

test("route smoke catalog covers all mounted visible tools", () => {
  const smokeRoutes = normalizedSet(SPA_TOOL_ROUTES.map((route) => route.path));
  const visibleRoutes = extractAppNavRoutes()
    .filter((route) => !route.startsWith("/api/"))
    .map((path) => ({ path, label: path }));
  visibleRoutes.push({ path: "/account", label: "Account Workspace" });

  expectSetContainsAll(smokeRoutes, visibleRoutes, "frontend smoke route catalog");
});

test("App navigation and landing tool catalog stay in sync", () => {
  const appRoutes = normalizedSet(extractAppNavRoutes());
  const landingRoutes = normalizedSet(extractLandingToolRoutes());

  const appOnly = [...appRoutes].filter((route) => !landingRoutes.has(route));
  const landingOnly = [...landingRoutes].filter((route) => !appRoutes.has(route));

  assert.deepEqual(appOnly, [], "Routes in App.tsx nav but not Landing.tsx tool catalog");
  assert.deepEqual(landingOnly, [], "Routes in Landing.tsx tool catalog but not App.tsx nav");
});

test("Hull Activity stays link-only and out of public tool discovery", () => {
  assert.ok(extractMountedRoutes().includes('/hulls'));
  assert.ok(!extractAppNavRoutes().includes('/hulls'));
  assert.ok(!extractLandingToolRoutes().includes('/hulls'));
  assert.ok(!readSeoRoutes().some((route) => route.path === '/hulls'));
  assert.doesNotMatch(readSource(path.join('pages', 'Desktop.tsx')), /HullActivity|Hull Activity/);
});

test("visible SPA tools are mounted by App routes", () => {
  const mountedRoutes = normalizedSet(extractMountedRoutes());
  const expectedRoutes = SPA_TOOL_ROUTES
    .filter((route) => !route.path.includes(":"))
    .filter((route) => route.path !== "/fitting-app.html")
    .map((route) => {
      if (route.path.startsWith("/fitting/fit/")) return { ...route, path: "/fitting/fit/:sharedFitId" };
      if (route.path.startsWith("/items/")) return { ...route, path: "/items/:typeID" };
      return route;
    });

  expectSetContainsAll(mountedRoutes, expectedRoutes, "App.tsx mounted routes");
});

test("visible tools have SEO metadata", () => {
  const seoRoutes = readSeoRoutes();
  const seoPaths = normalizedSet(
    seoRoutes.flatMap((route) => [route.path, ...(route.aliases || [])])
  );
  const visibleRoutes = extractAppNavRoutes()
    .map((path) => ({ path, label: path }));
  visibleRoutes.push({ path: "/account", label: "Account Workspace" });

  expectSetContainsAll(seoPaths, visibleRoutes, "seoRoutes.json");
});

