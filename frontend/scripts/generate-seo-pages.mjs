import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const templatePath = path.join(dist, "index.html");
const routesPath = path.join(root, "src", "seoRoutes.json");
const siteUrl = "https://www.triff.tools";

const template = fs.readFileSync(templatePath, "utf8");
const routes = JSON.parse(fs.readFileSync(routesPath, "utf8")).filter((route) => !route.feature);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizePath(routePath) {
  if (!routePath || routePath === "/") return "/";
  return routePath.replace(/\/+$/, "");
}

function canonicalFor(route) {
  const canonicalPath = normalizePath(route.canonicalPath || route.path);
  return `${siteUrl}${canonicalPath === "/" ? "/" : canonicalPath}`;
}

function pageName(route) {
  return route.title.replace(" | Triff.Tools", "").replace(" - Triff.Tools", "");
}

function setTitle(html, title) {
  return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
}

function setMeta(html, attribute, key, content) {
  const escaped = escapeHtml(content);
  const pattern = new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*/?>`, "i");
  const tag = `<meta ${attribute}="${key}" content="${escaped}" />`;
  if (pattern.test(html)) return html.replace(pattern, tag);
  return html.replace("</head>", `  ${tag}\n</head>`);
}

function setCanonical(html, href) {
  const escaped = escapeHtml(href);
  const tag = `<link rel="canonical" href="${escaped}" />`;
  if (/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i.test(html)) {
    return html.replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i, tag);
  }
  return html.replace("</head>", `  ${tag}\n</head>`);
}

function setJsonLd(html, route, canonical) {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: pageName(route),
        url: canonical,
        description: route.description,
        image: route.image,
        screenshot: route.image,
        applicationCategory: "GameApplication",
        operatingSystem: "Web browser",
        isAccessibleForFree: true,
        publisher: {
          "@type": "Organization",
          name: "Triff.Tools",
          url: siteUrl,
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Triff.Tools",
            item: siteUrl,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: pageName(route),
            item: canonical,
          },
        ],
      },
    ],
  };
  const tag = `<script id="triff-tools-seo-jsonld" type="application/ld+json">${JSON.stringify(data)}</script>`;
  if (/<script\s+id="triff-tools-seo-jsonld"[\s\S]*?<\/script>/i.test(html)) {
    return html.replace(/<script\s+id="triff-tools-seo-jsonld"[\s\S]*?<\/script>/i, tag);
  }
  return html.replace("</head>", `  ${tag}\n</head>`);
}

function addNoscriptSummary(html, route, canonical) {
  const summary = `
  <noscript>
    <main style="max-width: 760px; margin: 40px auto; padding: 24px; font-family: system-ui, sans-serif; color: #dcecff; background: #05070b;">
      <h1>${escapeHtml(pageName(route))}</h1>
      <p>${escapeHtml(route.description)}</p>
      <p><a href="${escapeHtml(canonical)}" style="color: #8fc7ff;">Open this Triff.Tools EVE Online tool</a></p>
    </main>
  </noscript>`;
  return html.replace(/<noscript>[\s\S]*?<\/noscript>/i, "").replace("</body>", `${summary}\n</body>`);
}

function renderRoute(route) {
  const canonical = canonicalFor(route);
  let html = template;

  html = setTitle(html, route.title);
  html = setMeta(html, "name", "description", route.description);
  html = setMeta(html, "name", "robots", route.robots || "index,follow");
  html = setCanonical(html, canonical);
  html = setMeta(html, "property", "og:type", "website");
  html = setMeta(html, "property", "og:site_name", "Triff.Tools");
  html = setMeta(html, "property", "og:url", canonical);
  html = setMeta(html, "property", "og:title", route.title);
  html = setMeta(html, "property", "og:description", route.description);
  html = setMeta(html, "property", "og:image", route.image);
  html = setMeta(html, "property", "og:image:width", "1200");
  html = setMeta(html, "property", "og:image:height", "630");
  html = setMeta(html, "name", "twitter:card", "summary_large_image");
  html = setMeta(html, "name", "twitter:title", route.title);
  html = setMeta(html, "name", "twitter:description", route.description);
  html = setMeta(html, "name", "twitter:image", route.image);
  html = setJsonLd(html, route, canonical);
  html = addNoscriptSummary(html, route, canonical);

  return html;
}

function writeRoute(route) {
  const routePath = normalizePath(route.path);
  if (routePath === "/" || routePath.startsWith("/api/")) return;

  const relative = routePath.replace(/^\/+/, "");
  const outputDir = path.join(dist, relative);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "index.html"), renderRoute(route));
}

const homeRoute = routes.find((route) => normalizePath(route.path) === "/");
if (homeRoute) {
  fs.writeFileSync(templatePath, renderRoute(homeRoute));
}

for (const route of routes) {
  if (route.robots && route.robots.includes("noindex")) continue;
  writeRoute(route);
}

console.log(`Generated SEO HTML for ${routes.filter((route) => !route.robots?.includes("noindex") && !route.path.startsWith("/api/")).length} routes.`);
