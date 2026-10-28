import routeData from "./seoRoutes.json";
import { analyticsAllowed, loadGoogleAnalytics } from "./lib/analyticsConsent";

export type SeoMeta = {
  path: string;
  aliases?: string[];
  title: string;
  description: string;
  image: string;
  canonicalPath?: string;
  robots?: string;
  feature?: string;
};

const SITE_URL = "https://www.triff.tools";
const DEFAULT_IMAGE = `${SITE_URL}/static/og/home-1200x630v7.jpg`;

function featureEnabled(route: SeoMeta): boolean {
  return !route.feature;
}

export const SEO_ROUTES = (routeData as SeoMeta[]).filter(featureEnabled);

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

function normalizePath(pathname: string): string {
  const withoutTrailingSlash = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return withoutTrailingSlash || "/";
}

function samePath(a: string, b: string): boolean {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

function canonicalUrl(pathname: string): string {
  const path = pathname === "/" ? "/" : normalizePath(pathname);
  return `${SITE_URL}${path}`;
}

function findRoute(pathname: string): SeoMeta | undefined {
  return SEO_ROUTES.find((route) =>
    [route.path, ...(route.aliases || [])].some((candidate) => samePath(candidate, pathname))
  );
}

function dynamicRoute(pathname: string): SeoMeta | undefined {
  const path = normalizePath(pathname);

  if (samePath(path, "/hulls")) {
    return {
      path: "/hulls",
      title: "Hull Activity | Triff.Tools",
      description: "Daily regional ship volume against 7, 30, and 365-day historical averages.",
      image: DEFAULT_IMAGE,
      robots: "noindex,nofollow",
    };
  }

  if (/^\/(?:skillnix|triffmon)(?:\/|$)/i.test(path)) {
    return {
      path,
      title: "Skillnix Character Monitor | Triff.Tools",
      description:
        "Private EVE character monitoring, skill queues, training plans, remap analysis, and multibox readiness in Skillnix.",
      image: DEFAULT_IMAGE,
      robots: "noindex,nofollow,noarchive,nosnippet",
    };
  }

  if (samePath(path, "/secret")) {
    return {
      path: "/secret",
      title: "Restricted | Triff.Tools",
      description: "Restricted Triff.Tools area.",
      image: DEFAULT_IMAGE,
      robots: "noindex,nofollow,noarchive,nosnippet",
    };
  }

  if (/^\/items\/\d+$/i.test(path)) {
    const typeId = path.split("/").pop();
    return {
      path,
      title: `EVE Item ${typeId} | Triff.Tools`,
      description:
        "View EVE item details, market context, attributes, descriptions, industry relationships, and quick actions in the Triff.Tools item database.",
      image: `${SITE_URL}/static/og/items-1200x630v1.jpg`,
    };
  }

  if (/^\/appraisals\/[A-Za-z0-9_-]+$/i.test(path)) {
    return {
      path,
      title: "Shared EVE Appraisal | Triff.Tools",
      description:
        "View a shared EVE appraisal with hub prices, item totals, buy and sell values, and market-based cargo pricing.",
      image: `${SITE_URL}/static/og/appraisals-1200x630v2.png`,
      robots: "noindex,follow",
    };
  }

  if (/^\/br\/[A-Za-z0-9_-]+$/i.test(path)) {
    return {
      path,
      title: "Shared EVE Battle Report | Triff.Tools",
      description:
        "View a shared EVE battle report with killmail data, ISK losses, involved pilots, groups, and after-action context.",
      image: `${SITE_URL}/static/og/dreadFight.jpg`,
    };
  }

  if (/^\/combat-logs\/[A-Za-z0-9_-]+$/i.test(path)) {
    return {
      path,
      title: "Shared EVE Combat Log Report | Triff.Tools",
      description:
        "View a shared EVE combat log report with damage, capacitor pressure, repairs, tackle, timelines, and parsed event summaries.",
      image: `${SITE_URL}/static/og/dreadFight.jpg`,
      robots: "noindex,follow",
    };
  }

  if (samePath(path, "/triff-local")) {
    return {
      path: "/triff-local",
      title: "TriffLocal Intel | Triff.Tools",
      description:
        "Generate shareable EVE local intel reports with hydrated pilot, corporation, alliance, and zKill threat snapshots.",
      image: `${SITE_URL}/static/og/dreadFight.jpg`,
    };
  }

  if (/^\/triff-local\/[A-Za-z0-9_-]+$/i.test(path)) {
    return {
      path,
      title: "Shared TriffLocal Report | Triff.Tools",
      description:
        "View a shared EVE local intel report with hydrated pilot, corporation, alliance, and zKill threat snapshots.",
      image: `${SITE_URL}/static/og/dreadFight.jpg`,
      robots: "noindex,follow",
    };
  }

  return undefined;
}

export function resolveSeo(pathname: string): SeoMeta {
  const route = findRoute(pathname) || dynamicRoute(pathname);
  if (route) {
    const canonicalPath = route.canonicalPath || route.path;
    return {
      ...route,
      canonicalPath,
    };
  }

  return {
    path: normalizePath(pathname),
    title: "Triff.Tools - EVE Online Tools",
    description:
      "Browser-based tools for EVE Online pilots, including wormhole, industry, market, fitting, appraisal, and planning utilities.",
    image: DEFAULT_IMAGE,
    robots: "noindex,follow",
  };
}

function upsertMeta(attribute: "name" | "property", key: string, content: string): void {
  let node = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute(attribute, key);
    document.head.appendChild(node);
  }
  node.setAttribute("content", content);
}

function upsertCanonical(href: string): void {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.href = href;
}

function upsertJsonLd(id: string, value: Record<string, unknown>): void {
  let script = document.head.querySelector<HTMLScriptElement>(`script#${id}`);
  if (!script) {
    script = document.createElement("script");
    script.id = id;
    script.type = "application/ld+json";
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(value);
}

export function buildSoftwareApplicationJsonLd(seo: SeoMeta, canonical: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: seo.title.replace(" | Triff.Tools", "").replace(" - Triff.Tools", ""),
    url: canonical,
    description: seo.description,
    image: seo.image,
    screenshot: seo.image,
    applicationCategory: "GameApplication",
    operatingSystem: "Web browser",
    isAccessibleForFree: true,
    publisher: {
      "@type": "Organization",
      name: "Triff.Tools",
      url: SITE_URL,
    },
  };
}

export function buildBreadcrumbJsonLd(seo: SeoMeta, canonical: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Triff.Tools",
        item: SITE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: seo.title.replace(" | Triff.Tools", "").replace(" - Triff.Tools", ""),
        item: canonical,
      },
    ],
  };
}

export function applySeo(pathname: string): SeoMeta {
  const seo = resolveSeo(pathname);
  const canonical = canonicalUrl(seo.canonicalPath || seo.path);

  if (typeof document === "undefined") return seo;

  document.title = seo.title;
  upsertMeta("name", "description", seo.description);
  upsertMeta("name", "robots", seo.robots || "index,follow");
  upsertCanonical(canonical);

  upsertMeta("property", "og:type", "website");
  upsertMeta("property", "og:site_name", "Triff.Tools");
  upsertMeta("property", "og:url", canonical);
  upsertMeta("property", "og:title", seo.title);
  upsertMeta("property", "og:description", seo.description);
  upsertMeta("property", "og:image", seo.image);
  upsertMeta("property", "og:image:width", "1200");
  upsertMeta("property", "og:image:height", "630");

  upsertMeta("name", "twitter:card", "summary_large_image");
  upsertMeta("name", "twitter:title", seo.title);
  upsertMeta("name", "twitter:description", seo.description);
  upsertMeta("name", "twitter:image", seo.image);

  upsertJsonLd("triff-tools-seo-jsonld", {
    "@context": "https://schema.org",
    "@graph": [
      buildSoftwareApplicationJsonLd(seo, canonical),
      buildBreadcrumbJsonLd(seo, canonical),
    ],
  });

  return seo;
}

export function trackPageView(seo: SeoMeta): boolean {
  if (typeof window === "undefined" || !analyticsAllowed()) return false;

  loadGoogleAnalytics();
  if (typeof window.gtag !== "function") return false;

  window.gtag("event", "page_view", {
    page_title: seo.title,
    page_location: window.location.href,
    page_path: `${window.location.pathname}${window.location.search}`,
  });
  return true;
}
