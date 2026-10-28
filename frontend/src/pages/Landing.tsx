/*
 * React page for /.
 * Public command hub for the Neocom-visible triff.tools routes.
 */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";

import agentFinderIconRaw from "../assets/icons/agentfinder.svg?raw";
import attributesIconRaw from "../assets/icons/attributes.svg?raw";
import augmentationsIconRaw from "../assets/icons/augmentations.svg?raw";
import biographyIconRaw from "../assets/icons/biography.svg?raw";
import bountyOfficeIconRaw from "../assets/icons/bountyoffice.svg?raw";
import calendarIconRaw from "../assets/icons/calendar.svg?raw";
import capitalNavigationIconRaw from "../assets/icons/capitalnavigation.svg?raw";
import cargoContainerIconRaw from "../assets/icons/cargocontainer.svg?raw";
import cargoContainerLockedIconRaw from "../assets/icons/cargocontainerlocked.svg?raw";
import chatChannelsIconRaw from "../assets/icons/chatchannels.svg?raw";
import compareToolIconRaw from "../assets/icons/comparetool.svg?raw";
import contractAuctionIconRaw from "../assets/icons/contractauction.svg?raw";
import corpMapIconRaw from "../assets/icons/corpmap.svg?raw";
import fittingIconRaw from "../assets/icons/fitting.svg?raw";
import folderCargoIconRaw from "../assets/icons/folder_cargo.svg?raw";
import industryIconRaw from "../assets/icons/industry.svg?raw";
import insuranceIconRaw from "../assets/icons/insurance.svg?raw";
import journalIconRaw from "../assets/icons/journal.svg?raw";
import jumpClonesIconRaw from "../assets/icons/jumpclones.svg?raw";
import killRightsIconRaw from "../assets/icons/killrights.svg?raw";
import marketIconRaw from "../assets/icons/market.svg?raw";
import officesIconRaw from "../assets/icons/offices.svg?raw";
import otherIconRaw from "../assets/icons/other.svg?raw";
import personalStandingsIconRaw from "../assets/icons/personalstandings.svg?raw";
import planetsIconRaw from "../assets/icons/planets.svg?raw";
import recruitmentIconRaw from "../assets/icons/recruitment.svg?raw";
import reprocessingIconRaw from "../assets/icons/reprocessing.svg?raw";
import sanctionableActionsIconRaw from "../assets/icons/sanctionableactions.svg?raw";
import walletIconRaw from "../assets/icons/wallet.svg?raw";
import warReportIconRaw from "../assets/icons/warreport.svg?raw";

type Icon = EveUiIconDef;
type Category = "Calculators" | "Reference" | "Meta";

type Tool = {
  name: string;
  path: string;
  description: string;
  category: Category;
  service: string;
  tags: string[];
  Icon?: Icon;
  iconSrc?: string;
};

type PriceStatus = { station_id: string | number; age_seconds: number };
type StatusPayload = {
  prices?: PriceStatus[];
  pipeline?: { status: string; detail: string };
};
type SdePayload = {
  ok?: boolean;
  sde?: {
    available?: boolean;
    build?: number | string | null;
    version?: string | null;
    updated_at?: string | null;
  };
};

type Telemetry =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; data: StatusPayload };
type SdeTelemetry =
  | { state: "loading" }
  | { state: "hidden" }
  | { state: "ready"; data: NonNullable<SdePayload["sde"]> };
type FeaturedTool = {
  tool: string;
  description: string;
};

type EveUiIconDef = {
  markup: string;
};

function makeEveUiIcon(svg: string): EveUiIconDef {
  return {
    markup: svg.replace(/^\s*<symbol\b[^>]*>/, "").replace(/<\/symbol>\s*$/, ""),
  };
}

function EveUiIcon({
  icon,
  className = "h-5 w-5",
}: {
  icon: EveUiIconDef;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 128 128"
      className={`inline-block shrink-0 ${className}`}
    >
      <style>{".shape{fill:currentColor}"}</style>
      <g dangerouslySetInnerHTML={{ __html: icon.markup }} />
    </svg>
  );
}

const EVE_ICONS = {
  agentFinder: makeEveUiIcon(agentFinderIconRaw),
  attributes: makeEveUiIcon(attributesIconRaw),
  augmentations: makeEveUiIcon(augmentationsIconRaw),
  biography: makeEveUiIcon(biographyIconRaw),
  bountyOffice: makeEveUiIcon(bountyOfficeIconRaw),
  calendar: makeEveUiIcon(calendarIconRaw),
  capitalNavigation: makeEveUiIcon(capitalNavigationIconRaw),
  cargoContainer: makeEveUiIcon(cargoContainerIconRaw),
  cargoContainerLocked: makeEveUiIcon(cargoContainerLockedIconRaw),
  chatChannels: makeEveUiIcon(chatChannelsIconRaw),
  compareTool: makeEveUiIcon(compareToolIconRaw),
  contractAuction: makeEveUiIcon(contractAuctionIconRaw),
  corpMap: makeEveUiIcon(corpMapIconRaw),
  fitting: makeEveUiIcon(fittingIconRaw),
  folderCargo: makeEveUiIcon(folderCargoIconRaw),
  industry: makeEveUiIcon(industryIconRaw),
  insurance: makeEveUiIcon(insuranceIconRaw),
  journal: makeEveUiIcon(journalIconRaw),
  jumpClones: makeEveUiIcon(jumpClonesIconRaw),
  killRights: makeEveUiIcon(killRightsIconRaw),
  market: makeEveUiIcon(marketIconRaw),
  offices: makeEveUiIcon(officesIconRaw),
  other: makeEveUiIcon(otherIconRaw),
  personalStandings: makeEveUiIcon(personalStandingsIconRaw),
  planets: makeEveUiIcon(planetsIconRaw),
  recruitment: makeEveUiIcon(recruitmentIconRaw),
  reprocessing: makeEveUiIcon(reprocessingIconRaw),
  sanctionableActions: makeEveUiIcon(sanctionableActionsIconRaw),
  wallet: makeEveUiIcon(walletIconRaw),
  warReport: makeEveUiIcon(warReportIconRaw),
};


// This intentionally mirrors only the Neocom-visible tools from App.tsx. Do not add hidden mounted routes here.
const TOOLS: Tool[] = [
  {
    name: "Gas Huffing ISK/h",
    path: "/gas-calc",
    description: "Gas huffing profits with live market data and boost math.",
    category: "Calculators",
    service: "Market",
    tags: ["gas", "mining", "huffing", "boosts", "isk"],
    Icon: EVE_ICONS.cargoContainer,
  },
  {
    name: "Ore Mining ISK/h",
    path: "/ore",
    description: "Ore mining output with boosts, crystals, and residue.",
    category: "Calculators",
    service: "Market",
    tags: ["ore", "mining", "boosts", "crystals", "isk"],
    Icon: EVE_ICONS.cargoContainerLocked,
  },
  {
    name: "Ore Reprocessing Calculator",
    path: "/compressed",
    description: "Calculate compressed ore needed for minerals.",
    category: "Calculators",
    service: "Market",
    tags: ["ore", "reprocessing", "compressed", "minerals"],
    Icon: EVE_ICONS.reprocessing,
  },
  {
    name: "ISKtimate",
    path: "/appraisals",
    description: "Real hub prices. No regions. Our data only.",
    category: "Calculators",
    service: "Market",
    tags: ["market", "price", "appraisal", "isk"],
    Icon: EVE_ICONS.wallet,
  },
  {
    name: "Industry Cost Calculator",
    path: "/industry",
    description: "Manufacturing costs, materials, and profit planning.",
    category: "Calculators",
    service: "Market",
    tags: ["industry", "manufacturing", "materials", "profit"],
    Icon: EVE_ICONS.industry,
  },
  {
    name: "BPC Copy Planner",
    path: "/schedule",
    description: "Plan copy jobs and BPC runs efficiently.",
    category: "Calculators",
    service: "Production",
    tags: ["bpc", "copy", "planner", "industry"],
    Icon: EVE_ICONS.other,
  },
  {
    name: "Reactions Calculator",
    path: "/reaction-calc",
    description: "Hybrid reaction profit planning for wormhole industry.",
    category: "Calculators",
    service: "Market",
    tags: ["reactions", "industry", "profit", "hybrid"],
    Icon: EVE_ICONS.attributes,
  },
  {
    name: "PI Profitability Calculator",
    path: "/pi-calc",
    description: "Batch profit calculator for Planetary Interaction chains.",
    category: "Calculators",
    service: "Market",
    tags: ["pi", "planetary", "industry", "profit"],
    Icon: EVE_ICONS.planets,
  },
  {
    name: "Ratting Split Calculator",
    path: "/bloot",
    description: "Share-based ratting loot splitter.",
    category: "Calculators",
    service: "Wormholer Tools",
    tags: ["loot", "split", "ratting", "shares"],
    Icon: EVE_ICONS.personalStandings,
  },
  {
    name: "Participation Calculator",
    path: "/participation",
    description: "Split wormhole loot by site participation.",
    category: "Calculators",
    service: "Wormholer Tools",
    tags: ["loot", "split", "wormhole", "participation"],
    Icon: EVE_ICONS.recruitment,
  },
  {
    name: "POS Planner",
    path: "/POSPlanner",
    description: "Calculate POS PG, CPU, fuel, and setup cost.",
    category: "Calculators",
    service: "Production",
    tags: ["pos", "fuel", "cpu", "powergrid"],
    Icon: EVE_ICONS.offices,
  },
  {
    name: "Fitting Tool",
    path: "/fitting",
    description: "Browser-based Pyfa-backed fitting tool.",
    category: "Meta",
    service: "Fitting",
    tags: ["fitting", "ship", "pyfa", "modules"],
    Icon: EVE_ICONS.fitting,
  },
  {
    name: "C5 Ratting Fits",
    path: "/roachfits",
    description: "Marauder fits for C5 ratting with/without dread escalation.",
    category: "Reference",
    service: "Wormholer Tools",
    tags: ["c5", "ratting", "fits", "marauder"],
    Icon: EVE_ICONS.insurance,
  },
  {
    name: "Market Browser",
    path: "/market",
    description: "Browse EVE market orders, history, hubs, and regions.",
    category: "Reference",
    service: "Market",
    tags: ["market", "orders", "history", "hubs"],
    Icon: EVE_ICONS.market,
  },
  {
    name: "Wormhole PvE Sites",
    path: "/wormhole-sites",
    description: "Sleeper combat, data, and relic site reference.",
    category: "Reference",
    service: "Wormholer Tools",
    tags: ["wormhole", "sleeper", "pve", "sites"],
    Icon: EVE_ICONS.killRights,
  },
  {
    name: "Rolling Mass",
    path: "/rolling-mass",
    description: "Quick wormhole rolling mass reference.",
    category: "Reference",
    service: "Wormholer Tools",
    tags: ["wormhole", "rolling", "mass", "reference"],
    Icon: EVE_ICONS.compareTool,
  },
  {
    name: "Wormhole Database",
    path: "/wormholes",
    description: "Search and filter J-space systems.",
    category: "Reference",
    service: "Wormholer Tools",
    tags: ["wormhole", "j-space", "database", "systems"],
    Icon: EVE_ICONS.corpMap,
  },
  {
    name: "Structure Age Calculator",
    path: "/holeintel",
    description: "Estimate structure age and inspect system ownership.",
    category: "Reference",
    service: "Wormholer Tools",
    tags: ["structure", "age", "intel", "ownership"],
    Icon: EVE_ICONS.agentFinder,
  },
  {
    name: "Eviction Stats",
    path: "/evictions",
    description: "Track wormhole structure kill activity.",
    category: "Reference",
    service: "Wormholer Tools",
    tags: ["eviction", "wormhole", "structure", "kills"],
    Icon: EVE_ICONS.warReport,
  },
  {
    name: "D-Scan Intel",
    path: "/dscan",
    description: "Parse wormhole D-scans and estimate wormhole transit mass.",
    category: "Reference",
    service: "Wormholer Tools",
    tags: ["dscan", "intel", "wormhole", "mass"],
    Icon: EVE_ICONS.biography,
  },
  {
    name: "Local intel",
    path: "/triff-local",
    description: "Generate shareable local threat snapshots with hydrated pilot intel.",
    category: "Reference",
    service: "Wormholer Tools",
    tags: ["local", "intel", "pilots", "zkill"],
    Icon: EVE_ICONS.bountyOffice,
  },
  {
    name: "Combat Log Parser",
    path: "/combat-logs",
    description: "Parse EVE gamelogs into shareable combat reports.",
    category: "Reference",
    service: "Meta & Utilities",
    tags: ["combat", "logs", "damage", "aar"],
    Icon: EVE_ICONS.folderCargo,
  },
  {
    name: "BattleReport Generator",
    path: "/br",
    description: "Generate battle reports for AARs and sharing.",
    category: "Reference",
    service: "Meta & Utilities",
    tags: ["battle", "report", "aar", "killmail"],
    Icon: EVE_ICONS.sanctionableActions,
  },
  {
    name: "Time Converter",
    path: "/timestamp",
    description: "Discord timestamps and EVE-time conversion.",
    category: "Meta",
    service: "Meta & Utilities",
    tags: ["time", "discord", "timestamp", "eve"],
    Icon: EVE_ICONS.calendar,
  },
  {
    name: "Desktop",
    path: "/desktop",
    description: "Open multiple Triff.Tools pages in a draggable desktop workspace.",
    category: "Meta",
    service: "Meta & Utilities",
    tags: ["desktop", "workspace", "multi-tool", "window"],
    Icon: EVE_ICONS.other,
  },
  {
    name: "Contact Me",
    path: "/contact",
    description: "Bug reports, feedback, and contact info.",
    category: "Meta",
    service: "Meta & Utilities",
    tags: ["contact", "feedback", "bugs", "meta"],
    Icon: EVE_ICONS.chatChannels,
  },
  {
    name: "Changelog",
    path: "/changelog",
    description: "Recent changes and release notes.",
    category: "Meta",
    service: "Meta & Utilities",
    tags: ["changes", "release", "notes", "meta"],
    Icon: EVE_ICONS.contractAuction,
  },
  {
    name: "Status",
    path: "/statuses",
    description: "Service and data freshness status.",
    category: "Meta",
    service: "Meta & Utilities",
    tags: ["status", "service", "data", "freshness"],
    Icon: EVE_ICONS.folderCargo,
  },
  {
    name: "API Docs",
    path: "/api/docs",
    description: "OpenAPI documentation for triff.tools endpoints.",
    category: "Meta",
    service: "Meta & Utilities",
    tags: ["api", "docs", "openapi", "endpoints"],
    Icon: EVE_ICONS.augmentations,
  },
  {
    name: "Item Browser",
    path: "/items",
    description: "Search EVE items, typeIDs, attributes, market data, and industry links.",
    category: "Meta",
    service: "SDE",
    tags: ["items", "types", "typeid", "dogma", "sde"],
    Icon: EVE_ICONS.journal,
  },
];

const CATEGORIES: Category[] = ["Calculators", "Reference", "Meta"];

const FEATURED_TOOLS: FeaturedTool[] = [
  {
    tool: "Fitting Tool",
    description: "Browser-based Pyfa-backed fitting.",
  },
  {
    tool: "Market Browser",
    description: "Orders, history, hubs, and regional market data.",
  },
  {
    tool: "Industry Cost Calculator",
    description: "Plan manufacturing costs, materials, and profit.",
  },
  {
    tool: "Wormhole PvE Sites",
    description: "Sleeper combat, data, and relic site reference.",
  },
];

export default function Landing() {
  const [query, setQuery] = useState("");
  const [telemetry, setTelemetry] = useState<Telemetry>({ state: "loading" });
  const [sdeTelemetry, setSdeTelemetry] = useState<SdeTelemetry>({
    state: "loading",
  });

  useEffect(() => {
    let alive = true;

    fetch("/api/statuses")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: StatusPayload) => {
        if (alive) setTelemetry({ state: "ready", data });
      })
      .catch(() => {
        if (alive) setTelemetry({ state: "error" });
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    fetch("/api/statuses/sde")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((payload: SdePayload) => {
        if (!alive) return;
        if (payload.sde?.available && (payload.sde.build || payload.sde.version)) {
          setSdeTelemetry({ state: "ready", data: payload.sde });
        } else {
          setSdeTelemetry({ state: "hidden" });
        }
      })
      .catch(() => {
        if (alive) setSdeTelemetry({ state: "hidden" });
      });

    return () => {
      alive = false;
    };
  }, []);

  const toolByName = useMemo(
    () => new Map(TOOLS.map((tool) => [tool.name, tool])),
    []
  );

  const matchesSearch = useMemo(() => {
    const q = query.trim().toLowerCase();

    return (tool: Tool) => {
      if (!q) return true;
      return [
        tool.name,
        tool.description,
        tool.category,
        tool.service,
        ...tool.tags,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    };
  }, [query]);

  const filteredTools = useMemo(
    () => TOOLS.filter((tool) => matchesSearch(tool)),
    [matchesSearch]
  );

  const matchingNames = useMemo(
    () => new Set(filteredTools.map((tool) => tool.name)),
    [filteredTools]
  );

  const visibleCategories = CATEGORIES.map((category) => ({
    category,
    tools: filteredTools.filter((tool) => tool.category === category),
  })).filter((group) => group.tools.length > 0);

  const featuredTools = FEATURED_TOOLS.map((featured) => {
    const tool = toolByName.get(featured.tool);
    if (!tool) return null;
    return { ...featured, tool };
  }).filter(
    (featured): featured is Omit<FeaturedTool, "tool"> & { tool: Tool } =>
      Boolean(featured)
  );

  const hasResults = filteredTools.length > 0;

  return (
    <div className="tt-tool-v2 min-h-screen text-slate-100 leading-snug">
      <div className="tt2-frame tt2-frame--wide relative">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute left-1/2 top-0 h-72 w-[54rem] -translate-x-1/2 bg-[radial-gradient(circle,rgba(83,182,255,0.13),transparent_66%)]" />
          <div className="absolute inset-x-0 top-28 h-px bg-gradient-to-r from-transparent via-[#53b6ff]/25 to-transparent" />
        </div>

        <div className="tt2-window">
          <div className="tt2-titlebar">
            <div className="flex items-center gap-2 uppercase tracking-[0.18em] text-[10px] text-slate-300">
              <span className="h-2.5 w-2.5 bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.75)]" />
              <h1>Tools / Command Hub</h1>
            </div>
            <span className="hidden text-[10px] uppercase tracking-[0.18em] text-slate-500 sm:inline">
              Triff.Tools
            </span>
          </div>

          <div className="tt2-contextbar">
            <TelemetryRow telemetry={telemetry} sdeTelemetry={sdeTelemetry} />
          </div>

          <div className="tt2-workspace space-y-6 bg-[#05070b] sm:p-4">
            <div
              role="search"
              className="flex min-h-[46px] border border-[#3a4655] bg-[#030509]/95 focus-within:border-[#53b6ff] focus-within:shadow-[0_0_0_2px_rgba(83,182,255,0.14)] sm:min-h-10"
            >
              <span
                aria-hidden="true"
                className="flex w-10 shrink-0 items-center justify-center border-r border-[#303642] bg-[#0c1119] text-[#70c6ff]"
              >
                <Search size={15} strokeWidth={1.7} />
              </span>
              <input
                id="tool-search"
                type="search"
                aria-label="Search tools"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tools, markets, fits, wormholes, industry..."
                className="min-h-11 min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-left text-[13px] text-slate-100 outline-none placeholder:text-slate-600 sm:min-h-0 sm:text-[12px]"
              />
              {query.trim() && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="border-l border-[#303642] bg-[#090d14] px-3 text-[10px] uppercase tracking-[0.12em] text-slate-500 hover:bg-[#101722] hover:text-slate-200 focus:outline-none focus-visible:text-slate-100"
                >
                  Clear
                </button>
              )}
            </div>

            {!hasResults && (
              <div className="tt2-empty border-[#70404a]">
                <div className="tt2-empty-title">No tools matched.</div>
              </div>
            )}

            <FeaturedTools
              featuredTools={featuredTools}
              matchingNames={matchingNames}
              query={query}
            />

            {visibleCategories.length > 0 && (
              <section className="border-t border-[#202631] pt-1">
                <SectionHeader
                  eyebrow="Full Tool Index"
                  title="Everything you need in one place"
                />
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  {visibleCategories.map((group) => (
                    <ToolIndexColumn key={group.category} group={group} />
                  ))}
                </div>
              </section>
            )}

            <footer className="border-t border-[#262933] pt-3 text-center text-[10px] text-slate-600">
              <div>
                Licensed GPL-3.0-or-later.
                <span className="px-2">|</span>
                Not affiliated with CCP Games. EVE Online and related trademarks
                are property of CCP hf.
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 uppercase tracking-[0.14em]">
                <Link to="/privacy" className="text-slate-500 hover:text-[#53b6ff]">
                  Privacy Policy
                </Link>
                <span className="text-slate-700">|</span>
                <Link to="/terms" className="text-slate-500 hover:text-[#53b6ff]">
                  Terms of Use
                </Link>
              </div>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}

function isApiPath(path: string) {
  return path.startsWith("/api/");
}

function formatAge(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "unavailable";
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return `${hours}h ${remaining}m ago`;
}

function telemetryItems(telemetry: Telemetry, sdeTelemetry: SdeTelemetry) {
  if (telemetry.state === "loading") {
    const items = [
      { label: "API", value: "checking...", tone: "neutral" },
      { label: "Market prices", value: "checking...", tone: "neutral" },
    ];
    return appendSdeItem(items, sdeTelemetry);
  }

  if (telemetry.state === "error") {
    const items = [
      { label: "API", value: "offline", tone: "bad" },
      { label: "Market prices", value: "unavailable", tone: "muted" },
    ];
    return appendSdeItem(items, sdeTelemetry);
  }

  const { data } = telemetry;
  const freshestPrice = data.prices?.length
    ? Math.min(...data.prices.map((price) => price.age_seconds))
    : null;

  const items = [
    { label: "API", value: "online", tone: "good" },
    {
      label: "Market prices",
      value: freshestPrice == null ? "unavailable" : `updated ${formatAge(freshestPrice)}`,
      tone: freshestPrice == null ? "muted" : "good",
    },
  ];

  return appendSdeItem(items, sdeTelemetry);
}

function appendSdeItem(
  items: { label: string; value: string; tone: string }[],
  sdeTelemetry: SdeTelemetry
) {
  if (sdeTelemetry.state !== "ready") return items;

  const build = sdeTelemetry.data.build;
  const version = sdeTelemetry.data.version;
  const value =
    build !== null && build !== undefined && String(build).trim()
      ? `build ${build}`
      : version && version.trim()
        ? version
        : null;

  if (!value) return items;
  return [...items, { label: "SDE", value, tone: "good" }];
}

function TelemetryRow({
  telemetry,
  sdeTelemetry,
}: {
  telemetry: Telemetry;
  sdeTelemetry: SdeTelemetry;
}) {
  return (
    <div className="flex max-w-full flex-wrap justify-start gap-x-3 gap-y-1 text-[9px] uppercase tracking-[0.08em] text-slate-500 sm:flex-nowrap sm:gap-y-0 sm:text-[10px] sm:tracking-[0.1em]">
      {telemetryItems(telemetry, sdeTelemetry).map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span
            className={[
              "h-1.5 w-1.5",
              item.tone === "good"
                ? "bg-[#48d27c] shadow-[0_0_6px_rgba(72,210,124,0.65)]"
                : item.tone === "bad"
                  ? "bg-[#d24848] shadow-[0_0_6px_rgba(210,72,72,0.55)]"
                  : "bg-slate-600",
            ].join(" ")}
          />
          <span className="text-slate-500">{item.label}:</span>
          <span className="text-slate-300">{item.value}</span>
        </span>
      ))}
    </div>
  );
}

function FeaturedTools({
  featuredTools,
  matchingNames,
  query,
}: {
  featuredTools: Array<Omit<FeaturedTool, "tool"> & { tool: Tool }>;
  matchingNames: Set<string>;
  query: string;
}) {
  const hasSearch = query.trim().length > 0;

  return (
    <section>
      <SectionHeader eyebrow="Featured Tools" title="The latest and greatest" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {featuredTools.map(({ description, tool }) => {
          const matched = !hasSearch || matchingNames.has(tool.name);

          return (
            <motion.div
              key={tool.name}
              initial={false}
              animate={{ opacity: matched ? 1 : 0.48 }}
              transition={{ duration: 0.15 }}
            >
              <Link
                to={tool.path}
                reloadDocument={isApiPath(tool.path)}
                className={[
                  "group flex h-full min-h-[112px] flex-col border bg-[#070910] p-3 outline-none transition-colors",
                  matched && hasSearch
                    ? "border-[#53b6ff]/70"
                    : "border-[#262933]",
                  "hover:border-[#53b6ff] hover:bg-[#0a1018] focus-visible:border-[#53b6ff] focus-visible:shadow-[0_0_0_1px_rgba(83,182,255,0.35)]",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden border border-[#252b35] bg-[#05070b]">
                    <ToolIcon
                      tool={tool}
                      className="h-11 w-11 text-slate-500 group-hover:text-[#53b6ff]"
                    />
                  </div>
                  <ArrowUpRight
                    className="h-3.5 w-3.5 shrink-0 text-slate-600 group-hover:text-[#53b6ff]"
                    aria-hidden
                  />
                </div>
                <div className="mt-3 flex flex-1 flex-col">
                  <h3 className="text-[13px] font-semibold text-slate-100 group-hover:text-white">
                    {tool.name}
                  </h3>
                  <p className="mt-1.5 line-clamp-2 text-[11px] leading-4 text-slate-400 group-hover:text-slate-300">
                    {description}
                  </p>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

function ToolIcon({
  tool,
  className,
}: {
  tool: Tool;
  className: string;
}) {
  if (tool.iconSrc) {
    return (
      <img
        src={tool.iconSrc}
        alt=""
        className={`${className} object-contain`}
        aria-hidden="true"
      />
    );
  }

  if (!tool.Icon) return null;

  return <EveUiIcon icon={tool.Icon} className={className} />;
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-[#53b6ff]">
        {eyebrow}
      </div>
      <h2 className="mt-0.5 text-[15px] font-semibold uppercase tracking-[0.12em] text-slate-100">
        {title}
      </h2>
    </div>
  );
}

function ToolIndexColumn({
  group,
}: {
  group: { category: Category; tools: Tool[] };
}) {
  return (
    <div className="tt2-panel overflow-hidden">
      <div className="tt2-panel-head">
        <h3 className="tt2-panel-title">
          {group.category}
        </h3>
      </div>
      <div className="divide-y divide-[#262933]">
        {group.tools.map((tool) => (
          <ToolIndexRow key={tool.name} tool={tool} />
        ))}
      </div>
    </div>
  );
}

function ToolIndexRow({ tool }: { tool: Tool }) {
  return (
    <Link
      to={tool.path}
      reloadDocument={isApiPath(tool.path)}
      className="group flex items-start gap-2 px-2.5 py-2.5 outline-none hover:bg-[#0d1119] focus-visible:bg-[#0d1119]"
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden">
        <ToolIcon
          tool={tool}
          className="h-[34px] w-[34px] text-slate-500 group-hover:text-[#53b6ff]"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h4 className="truncate text-[12px] font-medium text-slate-300 group-hover:text-white">
            {tool.name}
          </h4>
          <ArrowUpRight
            className="mt-0.5 h-3 w-3 shrink-0 text-slate-700 group-hover:text-[#53b6ff]"
            aria-hidden
          />
        </div>
        <p className="mt-0.5 line-clamp-1 text-[11px] leading-4 text-slate-500 group-hover:text-slate-400">
          {tool.description}
        </p>
      </div>
    </Link>
  );
}
