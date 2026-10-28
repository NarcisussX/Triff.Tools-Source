/*
 * Server helper for bot Embeds.
 * Supports Express middleware, metadata, or bot-facing responses without defining frontend routes.
 */

const { metaByPath } = require("./metaMap.js");
const hullActivity = require("../services/hullActivity");
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const {
  getBlueprintsForProduct,
  getBlueprintsUsingMaterial,
  getType,
} = require("../lib/everefData");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ENRICHED_SYSTEMS_PATH = path.join(__dirname, "..", "data", "enriched_systems.json");
const TRUE_A0_STAR_TYPE_ID = 45041;
const JITA_4_4_STATION_ID = 60003760;
const WORMHOLE_GROUP_ID = 988;
const FALLBACK_WORMHOLE_TYPE_ID = 30657;
const DOT = " \u2022 ";

const BOT_REGEX =
  /Discordbot|Twitterbot|Slackbot|LinkedInBot|facebookexternalhit|embedly|WhatsApp|redditbot|TelegramBot/i;

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));

function pickMeta(pathname) {
  const keys = Object.keys(metaByPath).filter((p) => pathname.startsWith(p));
  const key = (keys.sort((a, b) => b.length - a.length)[0]) || "/";
  return metaByPath[key] || metaByPath["/"];
}

function absoluteUrl(req) {
  return `https://${req.headers.host}${req.originalUrl}`;
}

function sendEmbedHtml(req, res, {
  title,
  desc,
  image,
  imageWidth,
  imageHeight,
  twitterCard = "summary_large_image",
}) {
  const absUrl = absoluteUrl(req);
  const imageMeta = image ? `
<meta property="og:image" content="${escapeHtml(image)}"/>
<meta property="og:image:secure_url" content="${escapeHtml(image)}"/>
${imageWidth ? `<meta property="og:image:width" content="${imageWidth}"/>` : ""}
${imageHeight ? `<meta property="og:image:height" content="${imageHeight}"/>` : ""}
<meta name="twitter:image" content="${escapeHtml(image)}"/>` : "";

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${escapeHtml(absUrl)}"/>
<meta property="og:title" content="${escapeHtml(title)}"/>
<meta property="og:description" content="${escapeHtml(desc)}"/>${imageMeta}
<meta property="og:site_name" content="Triff.Tools"/>
<meta name="twitter:card" content="${escapeHtml(twitterCard)}"/>
<meta name="twitter:title" content="${escapeHtml(title)}"/>
<meta name="twitter:description" content="${escapeHtml(desc)}"/>
<meta name="theme-color" content="#0b1220"/>
<link rel="icon" href="/favicon.ico"/>
</head><body><noscript>Preview: ${escapeHtml(title)}</noscript></body></html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(200).send(html);
}

const STATION_LABEL = {
  60003760: "Jita 4-4",
  60008494: "Amarr (Oris) – Emperor Family Academy",
  60011866: "Dodixie IX-20 – Fed Navy Assembly Plant",
  60005686: "Hek VIII-12 – Boundless Creation Factory",
  60004588: "Rens VI-8 – Brutor Tribe Treasury",
};

const MODE_LABEL = {
  sell5: "Sell (5%)",
  buy5:  "Buy (5%)",
  sell:  "Sell (min)",
  buy:   "Buy (max)",
  split: "Split (avg)",
};

let enrichedSystemsCache = null;

function getEnrichedSystems() {
  if (enrichedSystemsCache) return enrichedSystemsCache;

  try {
    enrichedSystemsCache = JSON.parse(fs.readFileSync(ENRICHED_SYSTEMS_PATH, "utf8"));
  } catch (err) {
    console.warn("[BOT_EMBED]: enriched wormhole data unavailable:", err.message);
    enrichedSystemsCache = {};
  }

  return enrichedSystemsCache;
}

function parsePositiveInt(value) {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeJcode(value) {
  const raw = String(value || "").trim().toUpperCase();
  const standard = raw.match(/J\d{6}/);
  if (standard) return standard[0];
  const nonStandard = raw.match(/^J[0-9-]+$/);
  return nonStandard ? nonStandard[0] : null;
}

function arrayFromDb(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to comma/braced-array parsing.
    }
    return value.replace(/[{}"]/g, "").split(",");
  }
  return [];
}

function normalizeStatics(statics) {
  return Array.from(
    new Set(
      arrayFromDb(statics)
        .map((code) => String(code || "").trim().toUpperCase())
        .filter((code) => /^[A-Z]\d{3}$/.test(code))
    )
  );
}

function planetTypeLabel(typeName) {
  return String(typeName || "")
    .replace(/^Planet\s*\(/i, "")
    .replace(/^Planet\s+/i, "")
    .replace(/\)$/g, "")
    .trim();
}

function formatPiSummary(planets) {
  const counts = new Map();
  for (const planet of planets) {
    const type = planetTypeLabel(planet.type_name);
    if (!type) continue;
    counts.set(type, (counts.get(type) || 0) + 1);
  }

  const preferred = ["Barren", "Temperate", "Gas", "Lava", "Oceanic", "Storm", "Ice", "Plasma"];
  return Array.from(counts.entries())
    .sort(([a], [b]) => {
      const ai = preferred.indexOf(a);
      const bi = preferred.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return a.localeCompare(b);
    })
    .map(([type, count]) => (count > 1 ? `${type} x${count}` : type))
    .join(", ");
}

function moonCount(planets) {
  return planets.reduce((total, planet) => total + (Number(planet.moon_count) || 0), 0);
}

function isShatteredSystem(system, planets) {
  const starName = String(system.star_name || "").toLowerCase();
  return (
    starName.includes("a0iv") ||
    planets.some((planet) => String(planet.type_name || "").toLowerCase().includes("shattered"))
  );
}

function formatStarName(value) {
  const cleaned = String(value || "")
    .replace(/^Sun\s+/i, "")
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

function formatCompactNumber(value, digits = 1) {
  if (value === null || value === undefined || value === "") return "n/a";
  const n = Number(value);
  if (!Number.isFinite(n)) return "n/a";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(digits)}t`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(digits)}b`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(digits)}m`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(digits)}k`;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function formatIsk(value) {
  return `${formatCompactNumber(value)} ISK`;
}

function formatQuantity(value) {
  return formatCompactNumber(value);
}

function formatPlainNumber(value, suffix = "") {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n).toLocaleString("en-US")}${suffix}`;
}

function formatWholeCompact(value) {
  return formatCompactNumber(value, 0);
}

function formatCombatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes) return `${minutes}m ${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

function formatCombatParseRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "n/a";
  const percent = n <= 1 ? n * 100 : n;
  return `${Math.round(percent)}%`;
}

function formatEmbedDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function formatEmbedTimestamp(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "saved report";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const now = new Date();
  const year = date.getUTCFullYear();
  const yearPart = year === now.getUTCFullYear() ? "" : ` ${year}`;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${months[date.getUTCMonth()]} ${day}${yearPart}, ${hour}:${minute} UTC`;
}

function normalizeSharedFitId(value) {
  const id = String(value || "").trim().toUpperCase();
  return /^[A-HJ-NP-Z2-9]{6,24}$/.test(id) ? id : null;
}

function formatPercent(value) {
  if (value === null || value === undefined || value === "") return "n/a";
  const n = Number(value);
  if (!Number.isFinite(n)) return "n/a";
  return `${n.toFixed(1)}%`;
}

function formatKt(value) {
  if (value === null || value === undefined || value === "") return "0";
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

function compactPath(entries, maxEntries = 5) {
  const names = (entries || []).map((entry) => entry.name).filter(Boolean);
  if (names.length <= maxEntries) return names.join(" > ");
  return [...names.slice(0, 2), "...", ...names.slice(-(maxEntries - 3))].join(" > ");
}

function isBlueprintType(row) {
  const category = String(row?.category_name || "").toLowerCase();
  const group = String(row?.group_name || "").toLowerCase();
  const name = String(row?.name || "").toLowerCase();
  return category === "blueprint" || group.includes("blueprint") || /\bblueprint\b/.test(name);
}

function isRenderableType(row) {
  const category = String(row?.category_name || "").toLowerCase();
  const group = String(row?.group_name || "").toLowerCase();
  return (
    category === "ship" ||
    category === "drone" ||
    category === "structure" ||
    group.includes("deployable")
  );
}

function itemImageUrl(typeId, row, size = 512) {
  if (isBlueprintType(row)) return `https://images.evetech.net/types/${typeId}/bp?size=${size}`;
  if (isRenderableType(row)) return `https://images.evetech.net/types/${typeId}/render?size=${size}`;
  return `https://images.evetech.net/types/${typeId}/icon?size=${Math.min(size, 128)}`;
}

async function getMarketGroupPath(marketGroupId) {
  if (!marketGroupId) return [];
  const { rows } = await pool.query(
    `
    WITH RECURSIVE crumb AS (
      SELECT
        "marketGroupID" AS market_group_id,
        "parentGroupID" AS parent_id,
        "marketGroupName" AS name,
        0 AS depth
      FROM evesde."invMarketGroups"
      WHERE "marketGroupID" = $1
      UNION ALL
      SELECT
        p."marketGroupID",
        p."parentGroupID",
        p."marketGroupName",
        c.depth + 1
      FROM crumb c
      JOIN evesde."invMarketGroups" p ON p."marketGroupID" = c.parent_id
    )
    SELECT market_group_id, name
    FROM crumb
    ORDER BY depth DESC
    `,
    [marketGroupId]
  );
  return rows;
}

async function getBaseItem(typeId) {
  const { rows } = await pool.query(
    `
    SELECT
      t."typeID" AS type_id,
      t."typeName" AS name,
      t."description" AS description,
      COALESCE(t."published", true) AS published,
      t."volume" AS volume,
      t."mass" AS mass,
      t."capacity" AS capacity,
      t."portionSize" AS portion_size,
      g."groupID" AS group_id,
      g."groupName" AS group_name,
      c."categoryID" AS category_id,
      c."categoryName" AS category_name,
      mg."marketGroupID" AS market_group_id,
      mg."marketGroupName" AS market_group_name
    FROM evesde."invTypes" t
    LEFT JOIN evesde."invGroups" g ON g."groupID" = t."groupID"
    LEFT JOIN evesde."invCategories" c ON c."categoryID" = g."categoryID"
    LEFT JOIN evesde."invMarketGroups" mg ON mg."marketGroupID" = t."marketGroupID"
    WHERE t."typeID" = $1
    LIMIT 1
    `,
    [typeId]
  );
  return rows[0] || null;
}

async function getBlueprintProductLine(typeId) {
  const { rows } = await pool.query(
    `
    SELECT
      pt."typeName" AS product_name,
      p."activityID" AS activity_id,
      p."quantity" AS quantity
    FROM evesde."industryActivityProducts" p
    LEFT JOIN evesde."invTypes" pt ON pt."typeID" = p."productTypeID"
    WHERE p."typeID" = $1
      AND p."activityID" IN (1, 11)
    ORDER BY p."activityID", pt."typeName" NULLS LAST
    LIMIT 1
    `,
    [typeId]
  );
  const row = rows[0];
  if (!row?.product_name) return null;
  const activity = Number(row.activity_id) === 11 ? "Reaction" : "Manufacturing";
  const qty = Number(row.quantity) > 1 ? ` x${Number(row.quantity).toLocaleString("en-US")}` : "";
  return `Produces: ${row.product_name}${qty}${DOT}${activity}`;
}

async function getItemStatsLine(typeId, row) {
  const typeMeta = getType(typeId) || {};
  const category = String(row.category_name || "").toLowerCase();

  if (category === "ship") {
    const packaged = formatPlainNumber(typeMeta.packagedVolume ?? row.packaged_volume, " m3");
    const mass = formatPlainNumber(row.mass ?? typeMeta.mass, " kg");
    return [
      packaged ? `Packaged: ${packaged}` : null,
      mass ? `Mass: ${mass}` : null,
      `Type ID: ${typeId}`,
    ].filter(Boolean).join(DOT);
  }

  if (isBlueprintType(row)) {
    const productLine = await getBlueprintProductLine(typeId);
    return [productLine, `Type ID: ${typeId}`].filter(Boolean).join(DOT);
  }

  const producedBy = getBlueprintsForProduct(typeId).length;
  const usedIn = getBlueprintsUsingMaterial(typeId).length;
  const industryBits = [];
  if (producedBy) industryBits.push(`Produced by ${producedBy.toLocaleString("en-US")} blueprint${producedBy === 1 ? "" : "s"}`);
  if (usedIn) industryBits.push(`Used in ${usedIn.toLocaleString("en-US")} blueprint${usedIn === 1 ? "" : "s"}`);
  if (industryBits.length) return `${industryBits.join(DOT)}${DOT}Type ID: ${typeId}`;

  const volume = formatPlainNumber(row.volume ?? typeMeta.volume, " m3");
  return [volume ? `Volume: ${volume}` : null, `Type ID: ${typeId}`].filter(Boolean).join(DOT);
}

function normalizeRecord(row) {
  const out = { ...row };
  if (typeof out.rows === "string") {
    try { out.rows = JSON.parse(out.rows); } catch { out.rows = []; }
  }
  if (!Array.isArray(out.rows)) out.rows = [];

  if (typeof out.totals === "string") {
    try { out.totals = JSON.parse(out.totals); } catch { out.totals = {}; }
  }
  out.totals = out.totals || {};
  const n = (v) => (v == null ? null : Number(v));
  out.totals.sell = n(out.totals.sell) ?? 0;
  out.totals.buy = n(out.totals.buy) ?? 0;
  out.totals.split = n(out.totals.split) ?? 0;
  out.totals.adjusted = n(out.totals.adjusted);
  out.totals.itemCount = Number(out.totals.itemCount ?? out.rows.length);
  return out;
}

async function wormholeIconUrl(statics) {
  const names = normalizeStatics(statics).map((code) => `Wormhole ${code}`);
  if (names.length) {
    const { rows } = await pool.query(
      `
      SELECT "typeID" AS type_id
      FROM evesde."invTypes"
      WHERE "groupID" = $1
        AND "typeName" = ANY($2::text[])
      ORDER BY array_position($2::text[], "typeName")
      LIMIT 1
      `,
      [WORMHOLE_GROUP_ID, names]
    );
    if (rows[0]?.type_id) {
      return `https://images.evetech.net/types/${Number(rows[0].type_id)}/icon?size=128`;
    }
  }
  return `https://images.evetech.net/types/${FALLBACK_WORMHOLE_TYPE_ID}/icon?size=128`;
}

async function renderWormholeEmbed(req, res) {
  const jcode = normalizeJcode(req.query.system);
  if (!jcode) return null;

  try {
    const { rows } = await pool.query("SELECT * FROM wormhole_systems WHERE jcode = $1 LIMIT 1", [jcode]);
    const system = rows[0];
    if (!system) return null;

    const planetsRes = await pool.query(
      "SELECT * FROM planets WHERE jcode = $1 ORDER BY name",
      [jcode]
    );
    const planets = planetsRes.rows || [];
    const enriched = getEnrichedSystems()[jcode] || {};
    const enrichedStar = enriched.celestials?.star || {};
    const statics = normalizeStatics(enriched.statics || system.statics);
    const starTypeId = system.star_type_id ?? enrichedStar.type_id ?? null;
    const starName = formatStarName(system.star_name ?? enrichedStar.name);
    const effect = String(system.effect || enriched.effectName || "").trim() || "No effect";
    const isA0 = Number(starTypeId) === TRUE_A0_STAR_TYPE_ID;
    const shattered = isShatteredSystem({ ...system, star_name: system.star_name ?? enrichedStar.name }, planets);

    const flags = [isA0 ? "A0" : null, shattered ? "Shattered" : null].filter(Boolean);
    const title = `${jcode} - C${system.class} Wormhole | Triff.Tools`;
    const firstLine = [
      `Static: ${statics.length ? statics.join(", ") : "Unknown"}`,
      `Effect: ${effect}`,
      starName ? `Star: ${starName}` : null,
      flags.length ? `Flags: ${flags.join(", ")}` : null,
    ].filter(Boolean).join(DOT);
    const secondLine = [
      `Planets: ${planets.length}`,
      `Moons: ${moonCount(planets)}`,
      formatPiSummary(planets) ? `PI: ${formatPiSummary(planets)}` : null,
    ].filter(Boolean).join(DOT);

    sendEmbedHtml(req, res, {
      title,
      desc: `${firstLine}\n${secondLine}`,
      image: await wormholeIconUrl(statics),
      imageWidth: 128,
      imageHeight: 128,
      twitterCard: "summary",
    });
    return true;
  } catch (e) {
    console.error("[BOT_EMBED]: wormhole embed error:", e);
    return null;
  }
}

async function renderItemEmbed(req, res, typeId) {
  try {
    const item = await getBaseItem(typeId);
    if (!item) return null;

    const marketPath = await getMarketGroupPath(item.market_group_id);
    const categoryLine = [
      item.category_name,
      item.group_name,
      compactPath(marketPath),
    ].filter(Boolean).join(DOT);
    const statsLine = await getItemStatsLine(typeId, item);

    sendEmbedHtml(req, res, {
      title: `${item.name} - Item Browser | Triff.Tools`,
      desc: [categoryLine, statsLine].filter(Boolean).join("\n"),
      image: itemImageUrl(typeId, item, 512),
      imageWidth: 512,
      imageHeight: 512,
      twitterCard: "summary",
    });
    return true;
  } catch (e) {
    console.error("[BOT_EMBED]: item embed error:", e);
    return null;
  }
}

async function renderMarketEmbed(req, res) {
  const typeId = parsePositiveInt(req.query.type_id ?? req.query.typeId);
  if (!typeId) return null;

  try {
    const item = await getBaseItem(typeId);
    if (!item) return null;

    const { rows } = await pool.query(
      `
      WITH
      jita_orders AS (
        SELECT
          MIN(price) FILTER (WHERE NOT is_buy_order) AS best_sell,
          MAX(price) FILTER (WHERE is_buy_order) AS best_buy
        FROM public.market_orders_current
        WHERE type_id = $1
          AND location_id = $2
      ),
      order_stats AS (
        SELECT
          COUNT(*) FILTER (WHERE NOT is_buy_order) AS sell_orders,
          COUNT(*) FILTER (WHERE is_buy_order) AS buy_orders
        FROM public.market_orders_current
        WHERE type_id = $1
      ),
      hist_recent AS (
        SELECT
          (SUM(avg_price * volume)::numeric / NULLIF(SUM(volume), 0)) AS avg_price,
          (SUM(volume)::numeric / NULLIF(COUNT(DISTINCT date), 0)) AS vol_day,
          (SUM(avg_price * volume)::numeric / NULLIF(COUNT(DISTINCT date), 0)) AS isk_day
        FROM public.market_history_daily
        WHERE type_id = $1
          AND date >= current_date - INTERVAL '30 days'
      )
      SELECT
        jo.best_sell,
        jo.best_buy,
        os.sell_orders,
        os.buy_orders,
        hr.avg_price,
        hr.vol_day,
        hr.isk_day
      FROM jita_orders jo
      CROSS JOIN order_stats os
      CROSS JOIN hist_recent hr
      `,
      [typeId, JITA_4_4_STATION_ID]
    );
    const market = rows[0] || {};
    const sell = Number(market.best_sell);
    const buy = Number(market.best_buy);
    const spreadValue = Number.isFinite(sell) && Number.isFinite(buy) ? Math.max(0, sell - buy) : null;
    const spreadPct = Number.isFinite(spreadValue) && sell > 0 ? (spreadValue / sell) * 100 : null;

    const priceLine = [
      `Jita sell: ${formatIsk(market.best_sell)}`,
      `Jita buy: ${formatIsk(market.best_buy)}`,
      `Spread: ${Number.isFinite(spreadValue) ? `${formatIsk(spreadValue)} (${formatPercent(spreadPct)})` : "n/a"}`,
    ].join(DOT);
    const historyLine = [
      `30d avg: ${formatIsk(market.avg_price)}`,
      `Volume/day: ${formatQuantity(market.vol_day)}`,
      `ISK/day: ${formatIsk(market.isk_day)}`,
    ].join(DOT);
    const ordersLine = [
      `Orders: ${Number(market.sell_orders || 0).toLocaleString("en-US")} sell / ${Number(market.buy_orders || 0).toLocaleString("en-US")} buy`,
      "Snapshot from indexed market data",
    ].join(DOT);

    sendEmbedHtml(req, res, {
      title: `${item.name} Market | Triff.Tools`,
      desc: `${priceLine}\n${historyLine}\n${ordersLine}`,
      image: itemImageUrl(typeId, item, 512),
      imageWidth: 512,
      imageHeight: 512,
      twitterCard: "summary",
    });
    return true;
  } catch (e) {
    console.error("[BOT_EMBED]: market embed error:", e);
    return null;
  }
}

async function renderAppraisalEmbed(req, res, id) {
  try {
    const { rows } = await pool.query("select * from appraisals where id = $1", [id]);
    if (!rows.length) return null;

    const a = normalizeRecord(rows[0]);

    const base = a.mode === "split" ? a.totals.split : (String(a.mode).startsWith("sell") ? a.totals.sell : a.totals.buy);
    const total = (a.totals.adjusted ?? base) || 0;

    const title = `Appraisal ${id} — ${Math.round(total).toLocaleString("en-US")} ISK (${MODE_LABEL[a.mode] || a.mode}) @ ${STATION_LABEL[a.station_id] || a.station_id}`;

    const lines = String(a.input_raw || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4);
    const list = lines.length ? lines.join(" • ") : `${a.totals.itemCount} item(s)`;

    const desc = `${list}\nMode: ${MODE_LABEL[a.mode] || a.mode} • Hub-only prices\nClick to view the full breakdown.`;

    sendEmbedHtml(req, res, {
      title,
      desc,
      twitterCard: "summary",
    });
    return true;
  } catch (e) {
    console.error("[BOT_EMBED]: embed error:", e);
    return null;
  }
}

async function renderCombatLogEmbed(req, res, id) {
  try {
    const { rows } = await pool.query("select * from combat_log_reports where id = $1", [id]);
    if (!rows.length) return null;

    const report = normalizeRecord(rows[0]);
    const summary = report.summary || {};
    const pilot = String(report.listener || "").trim() || "Unknown Pilot";
    const date = formatEmbedDate(report.start_time || report.session_started_at || report.created_at) || "Saved Report";
    const parsedEvents = Number(summary.combatEvents ?? summary.parsedLines ?? 0);
    const parseRatio = formatCombatParseRatio(summary.parseRatio);
    const introLine = [
      `${formatCombatDuration(summary.durationSeconds)} in combat`,
      `${parsedEvents.toLocaleString("en-US")} parsed events`,
      `${parseRatio} parse`,
    ].join(DOT);
    const damageLine = `Damage: ${formatWholeCompact(summary.damageOut)} out / ${formatWholeCompact(summary.damageIn)} in`;
    const pilotsLine = `Pilots: ${formatWholeCompact(summary.targets)} targets / ${formatWholeCompact(summary.attackers)} attackers`;
    const footerLine = `triff.tools Combat Log Parser${DOT}saved report`;

    sendEmbedHtml(req, res, {
      title: `Combat Log: ${pilot} - ${date}`,
      desc: `${introLine}\n${damageLine}\n${pilotsLine}\n${footerLine}`,
      twitterCard: "summary",
    });
    return true;
  } catch (e) {
    console.error("[BOT_EMBED]: combat log embed error:", e);
    return null;
  }
}

function normalizeDscanReport(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) || {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? value : {};
}

function dscanCount(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function dscanStatusLabel(comparison) {
  const usedPct = Number(comparison?.usedPct);
  const status = String(comparison?.status || "").toLowerCase();
  if (status === "over" || (Number.isFinite(usedPct) && usedPct > 100)) return "too large";
  if (status === "critical" || (Number.isFinite(usedPct) && usedPct >= 90)) return "critical";
  if (status === "reduced" || (Number.isFinite(usedPct) && usedPct >= 50)) return "over half";
  return "fits";
}

function dscanCapacity(comparison) {
  const value = Number(comparison?.capacityKg ?? comparison?.massKg);
  return Number.isFinite(value) ? value : null;
}

function findDscanComparison(comparisons, capacityKg, code = null) {
  const rows = Array.isArray(comparisons) ? comparisons : [];
  const exact = rows.find((row) => {
    if (Math.round(dscanCapacity(row) || 0) !== capacityKg) return false;
    if (!code) return true;
    return (row.codes || []).map((value) => String(value).toUpperCase()).includes(code);
  });
  if (exact) return exact;

  return rows.find((row) => Math.round(dscanCapacity(row) || 0) === capacityKg) || null;
}

function dscanMassLine(report) {
  const comparisons = report?.wormhole?.comparisons || [];
  const h296 = findDscanComparison(comparisons, 3_300_000_000, "H296");
  const twoM = findDscanComparison(comparisons, 2_000_000_000);
  const oneM = findDscanComparison(comparisons, 1_000_000_000);
  const parts = [];

  if (h296) parts.push(`H296 ${dscanStatusLabel(h296)} ${formatPercent(h296.usedPct)}`);
  if (twoM) parts.push(`2M hole: ${dscanStatusLabel(twoM)} ${formatPercent(twoM.usedPct)}`);
  if (oneM) parts.push(`1M hole: ${dscanStatusLabel(oneM)} ${formatPercent(oneM.usedPct)}`);

  return parts.length ? `Mass: ${parts.join(DOT)}` : null;
}

function dscanTopHulls(report, max = 3) {
  return (Array.isArray(report?.ships) ? report.ships : [])
    .filter((row) => row && String(row.type_name || "").trim())
    .sort((a, b) => dscanCount(b.quantity) - dscanCount(a.quantity) || String(a.type_name).localeCompare(String(b.type_name)))
    .slice(0, max);
}

function normalizeJsonObject(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) || {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? value : {};
}

function triffLocalCount(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function triffLocalTopGroups(report, max = 3) {
  const groups = report?.groups || {};
  const rows = [
    ...(Array.isArray(groups.alliances) ? groups.alliances.map((row) => ({ ...row, type: "Alliance" })) : []),
    ...(Array.isArray(groups.corporations) ? groups.corporations.map((row) => ({ ...row, type: "Corp" })) : []),
  ];
  return rows
    .filter((row) => row && String(row.name || "").trim())
    .sort((a, b) => triffLocalCount(b.pilotCount) - triffLocalCount(a.pilotCount) || String(a.name).localeCompare(String(b.name)))
    .slice(0, max);
}

function triffLocalImage(report) {
  const characters = Array.isArray(report?.characters) ? report.characters : [];
  const top = characters
    .filter((row) => row?.character?.imageUrl)
    .sort(
      (a, b) =>
        triffLocalCount(b?.zkill?.dangerPercent) - triffLocalCount(a?.zkill?.dangerPercent) ||
        triffLocalCount(b?.zkill?.shipsDestroyed) - triffLocalCount(a?.zkill?.shipsDestroyed)
    )[0];
  return top?.character?.imageUrl ? String(top.character.imageUrl).replace(/size=\d+/i, "size=128") : null;
}

async function renderTriffLocalEmbed(req, res, id) {
  try {
    const { rows } = await pool.query(
      `
      SELECT id, title, created_at, summary, report
      FROM triff_local_reports
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );
    if (!rows.length) return null;

    const row = rows[0];
    const report = normalizeJsonObject(row.report);
    const summary = {
      ...normalizeJsonObject(row.summary),
      ...normalizeJsonObject(report.summary),
    };
    const createdAt = report.createdAt || row.created_at;
    const pilotCount = triffLocalCount(summary.characterCount, Array.isArray(report.characters) ? report.characters.length : 0);
    const resolvedCount = triffLocalCount(summary.resolvedCount);
    const partialCount = triffLocalCount(summary.partialCount);
    const unresolvedCount = triffLocalCount(summary.unresolvedCount);
    const dangerousCount = triffLocalCount(summary.highDangerCount);
    const kills = triffLocalCount(summary.totalShipsDestroyed);
    const losses = triffLocalCount(summary.totalShipsLost);
    const topGroups = triffLocalTopGroups(report);

    const title = `TriffLocal ${formatEmbedTimestamp(createdAt)} - ${pilotCount.toLocaleString("en-US")} ${pilotCount === 1 ? "pilot" : "pilots"}, ${dangerousCount.toLocaleString("en-US")} dangerous`;
    const statusLine = [
      `Resolved: ${resolvedCount.toLocaleString("en-US")}`,
      partialCount ? `Partial: ${partialCount.toLocaleString("en-US")}` : null,
      unresolvedCount ? `Unresolved: ${unresolvedCount.toLocaleString("en-US")}` : null,
    ].filter(Boolean).join(DOT);
    const zkillLine = [
      `Kills: ${formatWholeCompact(kills)}`,
      `Losses: ${formatWholeCompact(losses)}`,
      `High danger: ${dangerousCount.toLocaleString("en-US")}`,
    ].join(DOT);
    const groupLine = topGroups.length
      ? `Top groups: ${topGroups.map((group) => `${group.name} (${triffLocalCount(group.pilotCount).toLocaleString("en-US")})`).join(", ")}`
      : null;
    const footerLine = `triff.tools TriffLocal${DOT}saved immutable report`;

    sendEmbedHtml(req, res, {
      title,
      desc: [statusLine, zkillLine, groupLine, footerLine].filter(Boolean).join("\n"),
      image: triffLocalImage(report),
      imageWidth: 128,
      imageHeight: 128,
      twitterCard: "summary",
    });
    return true;
  } catch (e) {
    console.error("[BOT_EMBED]: TriffLocal embed error:", e);
    return null;
  }
}

async function renderDscanEmbed(req, res, id) {
  try {
    const { rows } = await pool.query(
      `
      SELECT id, created_at, scan_type, report
      FROM dscan_reports
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );
    if (!rows.length) return null;

    const row = rows[0];
    const report = normalizeDscanReport(row.report);
    if (row.scan_type !== "dscan" && report.scanType !== "dscan") return null;

    const summary = report.summary || {};
    const topHulls = dscanTopHulls(report);
    const shipCount = dscanCount(summary.shipCount, topHulls.reduce((total, ship) => total + dscanCount(ship.quantity), 0));
    const hullTypes = dscanCount(summary.uniqueShipTypes, topHulls.length);
    const classes = dscanCount(summary.uniqueClasses, Array.isArray(report.shipClasses) ? report.shipClasses.length : 0);
    const totalMassKt = dscanCount(summary.totalMassKt ?? report.wormhole?.totalMassKt, dscanCount(summary.totalMassKg ?? report.wormhole?.totalMassKg) / 1000);

    const title = `D-Scan ${formatEmbedTimestamp(report.createdAt || row.created_at)} - ${shipCount.toLocaleString("en-US")} ${shipCount === 1 ? "ship" : "ships"}, ${formatKt(totalMassKt)} kt`;
    const statLine = [
      `Ships: ${shipCount.toLocaleString("en-US")}`,
      `Hull types: ${hullTypes.toLocaleString("en-US")}`,
      `Classes: ${classes.toLocaleString("en-US")}`,
    ].join(DOT);
    const topLine = topHulls.length
      ? `Top hulls: ${topHulls.map((ship) => `${ship.type_name} x${dscanCount(ship.quantity).toLocaleString("en-US")}`).join(", ")}`
      : null;
    const massLine = dscanMassLine(report);

    sendEmbedHtml(req, res, {
      title,
      desc: [statLine, topLine, massLine].filter(Boolean).join("\n"),
      twitterCard: "summary",
    });
    return true;
  } catch (e) {
    console.error("[BOT_EMBED]: dscan embed error:", e);
    return null;
  }
}

async function renderSharedFitEmbed(req, res, id) {
  const sharedFitId = normalizeSharedFitId(id);
  if (!sharedFitId) return null;

  try {
    const { rows } = await pool.query(
      `
      SELECT fit_name, ship_name, ship_type_id
      FROM fitting_shared_fits
      WHERE id = $1
      LIMIT 1
      `,
      [sharedFitId]
    );
    const fit = rows[0];
    if (!fit) return null;

    const shipTypeId = Number(fit.ship_type_id);
    const fitName = String(fit.fit_name || "Shared Fit").trim() || "Shared Fit";
    const shipName = String(fit.ship_name || "Unknown Ship").trim() || "Unknown Ship";

    sendEmbedHtml(req, res, {
      title: `${fitName} - ${shipName}`,
      desc: "Shared EFT fit, open in Triff.Tools.",
      image: Number.isFinite(shipTypeId) && shipTypeId > 0 ? `https://images.evetech.net/types/${shipTypeId}/icon?size=128` : null,
      imageWidth: 128,
      imageHeight: 128,
      twitterCard: "summary",
    });
    return true;
  } catch (e) {
    console.error("[BOT_EMBED]: fitting share embed error:", e);
    return null;
  }
}

async function renderHullActivityEmbed(req, res) {
  try {
    const activity = await hullActivity.getActivity(req.query);
    if (!activity.date) return null;
    const date = new Date(`${activity.date}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    });
    // Keep highlights focused on regularly traded hulls, matching the page default.
    const threshold = ['0', 'traded', '0.1', '1', '5', '10', '25'].includes(req.query.min_365d) ? req.query.min_365d : '1';
    const weekly = req.query.view === 'weekly';
    const valueKey = weekly ? 'avg_last_7d' : 'volume';
    const averageKey = weekly ? 'avg_prev_30d' : 'avg_30d';
    const percentKey = weekly ? 'vs_prev_30d_pct' : 'vs_30d_pct';
    const highlights = activity.hulls
      .filter((h) => threshold === 'traded' ? h.avg_365d > 0 : h.avg_365d >= Number(threshold))
      .filter((h) => h[averageKey] > 0 && Number.isFinite(h[averageKey]) && Number.isFinite(h[valueKey]) && Number.isFinite(h[percentKey]))
      .sort((a, b) => b[percentKey] - a[percentKey] || a.type_name.localeCompare(b.type_name) || a.type_id - b.type_id)
      .slice(0, 5)
      .map((h) => `${h.type_name} — ${h[valueKey].toLocaleString('en-US', { minimumFractionDigits: weekly ? 1 : 0, maximumFractionDigits: weekly ? 1 : 0 })} vs ${h[averageKey].toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/day (${h[percentKey] > 0 ? '+' : ''}${h[percentKey].toFixed(0)}%)`);
    sendEmbedHtml(req, res, {
      title: `Hull Activity — ${activity.region_name} — ${date}`,
      desc: `${weekly ? '7-day average (ending on selected date) vs the preceding 30-day average; no overlap.' : 'Daily ship-market volume vs historical averages.'}${threshold === '0' ? '' : ` 1y avg: ${threshold === 'traded' ? '> 0' : `≥ ${threshold}`}/day.`}\n\n${highlights.length ? `${weekly ? 'Top 7-day trends' : 'Top 30d activity'}:\n${highlights.join('\n')}` : 'No hulls match this volume threshold with a nonzero 30d baseline.'}`,
      twitterCard: 'summary',
    });
    return true;
  } catch (error) {
    if (!(error instanceof hullActivity.HullActivityError)) console.error('[BOT_EMBED]: hull activity:', error);
    return null;
  }
}

module.exports = async function botEmbeds(req, res, next) {
  const ua = String(req.headers["user-agent"] || "");
  const p = req.path;

  const looksLikeFile = /\.[a-z0-9]+$/i.test(p);
  const isAsset =
    p.startsWith("/static/") ||
    p.startsWith("/assets/") ||
    p.startsWith("/favicon") ||
    p === "/robots.txt" ||
    p === "/sitemap.xml" ||
    p.startsWith("/api/");

  if (!BOT_REGEX.test(ua) || isAsset || looksLikeFile ) {
    return next();
  }

  const m = p.match(/^\/appraisals\/([A-Za-z0-9_-]+)$/);
  if (m) {
    const ok = await renderAppraisalEmbed(req, res, m[1]);
    if (ok) return;
  }

  const combatLogMatch = p.match(/^\/combat-logs\/([A-Za-z0-9_-]+)$/);
  if (combatLogMatch) {
    const ok = await renderCombatLogEmbed(req, res, combatLogMatch[1]);
    if (ok) return;
  }

  const dscanMatch = p.match(/^\/dscan\/([0-9A-Za-z]{6,24})\/?$/);
  if (dscanMatch) {
    const ok = await renderDscanEmbed(req, res, dscanMatch[1]);
    if (ok) return;
  }

  const triffLocalMatch = p.match(/^\/triff-local\/([0-9A-Za-z_-]{8,32})\/?$/);
  if (triffLocalMatch) {
    const ok = await renderTriffLocalEmbed(req, res, triffLocalMatch[1]);
    if (ok) return;
  }

  const sharedFitMatch = p.match(/^\/fitting\/fit\/([A-HJ-NP-Z2-9]{6,24})\/?$/i);
  if (sharedFitMatch) {
    const ok = await renderSharedFitEmbed(req, res, sharedFitMatch[1]);
    if (ok) return;
  }

  if (p === "/wormholes" || p === "/wormholes/") {
    const ok = await renderWormholeEmbed(req, res);
    if (ok) return;
  }

  const itemMatch = p.match(/^\/items\/(\d+)\/?$/);
  if (itemMatch) {
    const ok = await renderItemEmbed(req, res, Number(itemMatch[1]));
    if (ok) return;
  }

  if (p === "/market" || p === "/market/") {
    const ok = await renderMarketEmbed(req, res);
    if (ok) return;
  }

  if (p === "/hulls" || p === "/hulls/") {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (await renderHullActivityEmbed(req, res)) return;
  }

  const { title, desc, image } = pickMeta(p);
  return sendEmbedHtml(req, res, {
    title,
    desc,
    image,
    imageWidth: 1200,
    imageHeight: 630,
  });
};
