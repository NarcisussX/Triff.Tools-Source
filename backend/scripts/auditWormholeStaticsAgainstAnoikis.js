#!/usr/bin/env node
/*
 * Audits backend/data/enriched_systems.json wormhole statics against Anoik.is.
 *
 * Anoik.is exposes the data used by system pages in /static/static.json, so this
 * script fetches that single dataset, caches it locally, compares every local
 * J-code, and updates only unambiguous static mismatches.
 */

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "enriched_systems.json");
const REPORT_PATH = path.join(
  __dirname,
  "..",
  "data",
  "wormhole_statics_anoikis_audit.json"
);
const CACHE_DIR = path.join(__dirname, "..", "data", "cache", "anoikis-wormholes");
const CACHE_PATH = path.join(CACHE_DIR, "static.json");
const CACHE_META_PATH = path.join(CACHE_DIR, "static.meta.json");
const CONTROLLER_URL = "https://anoik.is/static/controller.js?23";
const STATIC_JSON_FALLBACK_URL = "https://anoik.is/static/static.json?version=11";
const USER_AGENT = "TriffTools/wormhole-static-audit (+https://triff.tools)";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function parseArgs(argv) {
  const args = {
    refresh: false,
    update: true,
    limit: null,
    jcodes: null,
    reportPath: REPORT_PATH,
  };

  for (const arg of argv) {
    if (arg === "--refresh") args.refresh = true;
    else if (arg === "--no-update") args.update = false;
    else if (arg.startsWith("--limit=")) {
      args.limit = Math.max(1, Number(arg.split("=")[1]) || 1);
    } else if (arg.startsWith("--jcode=")) {
      args.jcodes = arg
        .split("=")[1]
        .split(",")
        .map((s) => normalizeJcode(s))
        .filter(Boolean);
    } else if (arg.startsWith("--report=")) {
      args.reportPath = path.resolve(process.cwd(), arg.split("=")[1]);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node backend/scripts/auditWormholeStaticsAgainstAnoikis.js [options]

Options:
  --jcode=J004686,J110117  Audit only specific J-codes.
  --limit=25              Audit first N systems from enriched_systems.json.
  --refresh               Ignore cached Anoik.is static.json.
  --no-update             Write report, but do not update enriched_systems.json.
  --report=path           Custom report path.
`);
}

function normalizeJcode(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase();
  const standard = raw.match(/J?\d{6}/);
  if (standard) {
    const digits = standard[0].replace(/^J/, "");
    return `J${digits}`;
  }
  const nonStandard = raw.match(/^J[0-9-]+$/);
  return nonStandard ? nonStandard[0] : null;
}

function normalizeStatics(input) {
  const values = Array.isArray(input) ? input : [];
  return Array.from(
    new Set(
      values
        .map((code) => String(code || "").trim().toUpperCase())
        .filter((code) => /^[A-Z]\d{3}$/.test(code))
    )
  ).sort();
}

function sameStatics(a, b) {
  const left = normalizeStatics(a);
  const right = normalizeStatics(b);
  return left.length === right.length && left.every((code, index) => code === right[index]);
}

function cacheFresh() {
  try {
    const stat = fs.statSync(CACHE_PATH);
    return Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "*/*",
      "User-Agent": USER_AGENT,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 160)}`);
  return text;
}

async function resolveStaticJsonUrl() {
  try {
    const controller = await fetchText(CONTROLLER_URL);
    const match = controller.match(/static_expected_version\s*=\s*(\d+)/);
    if (match) {
      return `https://anoik.is/static/static.json?version=${match[1]}`;
    }
  } catch (err) {
    console.warn("[audit] Could not resolve Anoik.is static data version from controller:", err.message);
  }

  return STATIC_JSON_FALLBACK_URL;
}

async function loadAnoikisData(options) {
  if (!options.refresh && cacheFresh()) {
    const meta = JSON.parse(fs.readFileSync(CACHE_META_PATH, "utf8"));
    return {
      sourceUrl: meta.sourceUrl,
      fetchedAt: meta.fetchedAt,
      fromCache: true,
      data: JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")),
    };
  }

  const sourceUrl = await resolveStaticJsonUrl();
  console.log(`[audit] Fetching Anoik.is static data: ${sourceUrl}`);
  const text = await fetchText(sourceUrl);
  const data = JSON.parse(text);

  if (!data || typeof data !== "object" || !data.systems || !data.wormholes) {
    throw new Error("Anoik.is static.json did not contain systems and wormholes data.");
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_PATH, `${JSON.stringify(data)}\n`);
  fs.writeFileSync(
    CACHE_META_PATH,
    `${JSON.stringify({ sourceUrl, fetchedAt: new Date().toISOString() }, null, 2)}\n`
  );

  return {
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
    data,
  };
}

function classifyResult(jcode, localStatics, anoikisSystem) {
  const local = normalizeStatics(localStatics);

  if (!anoikisSystem) {
    return {
      jcode,
      local,
      anoikis: [],
      status: "failed",
      reason: "System missing from Anoik.is static.json",
    };
  }

  const anoikis = normalizeStatics(anoikisSystem.statics || []);

  if (sameStatics(local, anoikis)) {
    return {
      jcode,
      local,
      anoikis,
      status: "match",
    };
  }

  return {
    jcode,
    local,
    anoikis,
    status: "mismatch",
  };
}

function printExample(label, result) {
  if (!result) return;
  console.log(
    `[audit] ${label}: ${result.jcode} local=[${result.local.join(",") || "-"}] ` +
      `anoikis=[${result.anoikis.join(",") || "-"}] status=${result.status}`
  );
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("This script requires Node 18+ with global fetch.");
  }

  const options = parseArgs(process.argv.slice(2));
  const localData = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const anoikis = await loadAnoikisData(options);

  const allJcodes = Object.keys(localData).map(normalizeJcode).filter(Boolean);
  const selected = options.jcodes
    ? allJcodes.filter((jcode) => options.jcodes.includes(jcode))
    : allJcodes.slice(0, options.limit || allJcodes.length);

  if (!selected.length) {
    throw new Error("No matching J-codes found to audit.");
  }

  console.log(
    `[audit] Auditing ${selected.length} wormhole systems against Anoik.is ` +
      `(update=${options.update}, cache=${anoikis.fromCache ? "hit" : "refreshed"})`
  );

  const systems = selected.map((jcode) =>
    classifyResult(jcode, localData[jcode]?.statics || [], anoikis.data.systems[jcode])
  );

  const mismatches = systems.filter((result) => result.status === "mismatch");
  const failed = systems.filter((result) => result.status === "failed");
  const matches = systems.filter((result) => result.status === "match");
  const localMissing = systems.filter((result) => result.local.length === 0);
  const anoikisMissing = systems.filter((result) => result.anoikis.length === 0);
  const updated = [];

  for (const result of mismatches.slice(0, 25)) {
    console.log(
      `[audit] MISMATCH ${result.jcode}: ` +
        `local=[${result.local.join(",") || "-"}] anoikis=[${result.anoikis.join(",") || "-"}]`
    );
  }
  if (mismatches.length > 25) {
    console.log(`[audit] ... ${mismatches.length - 25} more mismatches omitted from console`);
  }

  if (options.update) {
    for (const result of mismatches) {
      localData[result.jcode].statics = result.anoikis;
      result.updated = true;
      updated.push({
        jcode: result.jcode,
        from: result.local,
        to: result.anoikis,
      });
    }

    if (updated.length > 0) {
      fs.writeFileSync(DATA_PATH, `${JSON.stringify(localData, null, 2)}\n`);
      console.log(`[audit] Updated ${updated.length} unambiguous mismatches in ${DATA_PATH}`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: anoikis.sourceUrl,
    sourceFetchedAt: anoikis.fetchedAt,
    checkedCount: systems.length,
    matchedCount: matches.length,
    mismatchedCount: mismatches.length,
    failedCount: failed.length,
    updatedCount: updated.length,
    systemsWithLocalStaticsMissing: localMissing.map((result) => result.jcode),
    systemsWithAnoikisStaticsMissing: anoikisMissing.map((result) => ({
      jcode: result.jcode,
      local: result.local,
      status: result.status,
      reason: result.reason || null,
    })),
    mismatches,
    failed,
    updated,
    systems,
  };

  fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const byJcode = new Map(systems.map((result) => [result.jcode, result]));
  printExample("required check", byJcode.get("J004686"));
  printExample("known disagreement check", byJcode.get("J002757"));
  printExample(
    "multiple statics example",
    systems.find((result) => result.anoikis.length > 1 || result.local.length > 1)
  );
  printExample(
    "no statics example",
    systems.find((result) => result.local.length === 0 && result.anoikis.length === 0)
  );

  console.log(
    `[audit] Done. checked=${report.checkedCount} matched=${report.matchedCount} ` +
      `mismatched=${report.mismatchedCount} failed=${report.failedCount} updated=${report.updatedCount}`
  );
  console.log(`[audit] Report written to ${options.reportPath}`);
}

main().catch((err) => {
  console.error(`[audit] ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
