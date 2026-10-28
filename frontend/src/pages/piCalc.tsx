/*
 * React page for /pi-calc.
 * Wormhole-focused PI profitability browser using selected planet types,
 * local market prices, imported P1 assumptions, and recursive PI chain breakdowns.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Info, Package, Search, X } from "lucide-react";
import infoIconRaw from "../assets/icons/info.svg?raw";
import {
  requestSiteAuthModal,
  SITE_AUTH_CHANGED_EVENT,
  type SiteAuthChangeDetail,
} from "../auth/siteAuthEvents";
import type { AuthUser } from "../components/fitting/types";

type PlanetType =
  | "Barren"
  | "Gas"
  | "Ice"
  | "Lava"
  | "Oceanic"
  | "Plasma"
  | "Storm"
  | "Temperate";

type MarketMode = "sell" | "buy" | "impatient" | "patient";
type Viability = "fully_local" | "partial" | "import_required" | "not_priced";
type TierFilter = "all" | "P1" | "P2" | "P3" | "P4";
type ViabilityFilter = "all" | Viability;
type SortKey =
  | "profitLocalPlanetChain"
  | "profitFullMarketChain"
  | "profitFinalStep"
  | "marginLocalPlanetChain"
  | "missingP0Count"
  | "tier"
  | "name";

type CommodityInput = {
  typeID: number;
  typeId?: number;
  name: string;
  tier: string;
  qty: number;
  unitPrice: number | null;
  totalCost?: number | null;
  marketCost?: number | null;
  appliedCost?: number | null;
  planetTypes?: string[];
  local?: boolean;
  imported?: boolean;
  notProduced?: boolean;
  icon_url?: string;
  priceMissing?: boolean;
};

type ChainNode = {
  typeID: number;
  name: string;
  tier: string;
  qty: number;
  batchQty: number;
  icon_url?: string;
  planetTypes?: string[];
  local?: boolean;
  imported?: boolean;
  notProduced?: boolean;
  ingredients?: ChainNode[];
};

type PiProduct = {
  typeID: number;
  name: string;
  tier: "P1" | "P2" | "P3" | "P4";
  batchQty: number;
  icon_url: string;
  lowestSeller: number | null;
  highestBuyer: number | null;
  outputUnitPrice: number | null;
  outputValue: number | null;
  taxCost: number | null;
  directIngredients: CommodityInput[];
  p0Inputs: CommodityInput[];
  p1Inputs?: CommodityInput[];
  localP0: CommodityInput[];
  importedP0: CommodityInput[];
  importedP1?: CommodityInput[];
  notProducedP0?: CommodityInput[];
  missingP0Names: string[];
  missingP0Count: number;
  notProducedCommodityNames?: string[];
  notProducedCommodityCount?: number;
  missingPriceNames: string[];
  localP0Count: number;
  totalP0Count: number;
  importedP0Cost: number | null;
  importedP1Cost?: number | null;
  p0MarketInputCost: number | null;
  p1MarketInputCost?: number | null;
  localPlanetInputCost: number | null;
  directInputCost: number | null;
  profitFullMarketChain: number | null;
  profitLocalPlanetChain: number | null;
  profitFinalStep: number | null;
  marginLocalPlanetChain: number | null;
  marginFullMarketChain: number | null;
  marginFinalStep: number | null;
  viability: Viability;
  viabilityLabel: string;
  chain: ChainNode;
};

type SummaryProduct = {
  typeID: number;
  name: string;
  tier: string;
  icon_url: string;
  viability: Viability;
  viabilityLabel: string;
  profitLocalPlanetChain: number | null;
  profitFullMarketChain: number | null;
  profitFinalStep: number | null;
};

type PiCalcPayload = {
  ok: true;
  market: {
    station: string;
    station_id: number;
    mode: MarketMode;
    input_price_mode: "sell" | "buy";
    output_price_mode: "sell" | "buy";
    updated_at: string | null;
    price_age_seconds: number | null;
    row_count: number;
    cache_ttl_seconds: number;
  };
  settings: {
    taxRate: number;
    taxModel: "simple_market_value" | "not_applied";
    selectedPlanets: PlanetType[];
    marketMode: MarketMode;
  };
  summary: {
    totalProducts: number;
    fullyLocal: number;
    partiallyLocal: number;
    importRequired: number;
    notPriced: number;
    bestLocalChain: SummaryProduct | null;
    bestFinalStep: SummaryProduct | null;
  };
  planetTypes?: PlanetType[];
  products: PiProduct[];
};

type ApiErrorPayload = {
  ok: false;
  error?: string;
};

const PLANET_TYPES: PlanetType[] = [
  "Barren",
  "Gas",
  "Ice",
  "Lava",
  "Oceanic",
  "Plasma",
  "Storm",
  "Temperate",
];

const MARKET_MODES: { key: MarketMode; label: string; detail: string }[] = [
  {
    key: "sell",
    label: "Jita Sell",
    detail: "Jita Sell Price for inputs, Jita Sell Price for outputs",
  },
  {
    key: "buy",
    label: "Jita Buy",
    detail: "Jita Buy Price for inputs, Jita Buy Price for outputs",
  },
  {
    key: "impatient",
    label: "Impatient Industrialist",
    detail: "Jita Sell Price for inputs, Jita Buy Price for outputs",
  },
  {
    key: "patient",
    label: "Patient Capitalist",
    detail: "Jita Buy Price for inputs, Jita Sell Price for outputs",
  },
];

const TIER_FILTERS: TierFilter[] = ["all", "P1", "P2", "P3", "P4"];
const VIABILITY_FILTERS: { key: ViabilityFilter; label: string }[] = [
  { key: "all", label: "All viability" },
  { key: "fully_local", label: "Fully Self-Supplied" },
  { key: "partial", label: "Partial Self-Supply" },
  { key: "import_required", label: "Import Required" },
  { key: "not_priced", label: "Not Priced" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "profitLocalPlanetChain", label: "Chain Profit" },
  { key: "profitFullMarketChain", label: "Profit Importing All P1" },
  { key: "profitFinalStep", label: "Final Step Profit" },
  { key: "marginLocalPlanetChain", label: "Margin" },
  { key: "missingP0Count", label: "Commodities not produced" },
  { key: "tier", label: "Tier" },
  { key: "name", label: "Product name" },
];

const PI_STATE_TOOL_KEY = "pi-calc";

type PiRememberedInputs = {
  selectedPlanets?: PlanetType[];
  marketMode?: MarketMode;
  search?: string;
  tierFilter?: TierFilter;
  viabilityFilter?: ViabilityFilter;
  sortKey?: SortKey;
};

function rememberedPiPlanets(value: unknown): PlanetType[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<PlanetType>();
  for (const entry of value) {
    if (PLANET_TYPES.includes(entry as PlanetType)) unique.add(entry as PlanetType);
  }
  return Array.from(unique);
}

function rememberedOption<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function normalizePiRememberedInputs(raw: unknown): PiRememberedInputs {
  const source = raw && typeof raw === "object" ? raw as PiRememberedInputs : {};
  return {
    selectedPlanets: rememberedPiPlanets(source.selectedPlanets),
    marketMode: rememberedOption(source.marketMode, MARKET_MODES.map((mode) => mode.key), "sell"),
    search: typeof source.search === "string" ? source.search : "",
    tierFilter: rememberedOption(source.tierFilter, TIER_FILTERS, "all"),
    viabilityFilter: rememberedOption(source.viabilityFilter, VIABILITY_FILTERS.map((filter) => filter.key), "all"),
    sortKey: rememberedOption(source.sortKey, SORTS.map((sort) => sort.key), "profitLocalPlanetChain"),
  };
}

async function readJson<T>(response: Response): Promise<T> {
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
  }
  return data as T;
}

const panel = "border border-[#2c2f36] bg-[#070910]";
const panelHeader =
  "border-b border-[#2c2f36] bg-[#101219] px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-slate-300";
const hardButton =
  "border border-[#303236] bg-[#05070b] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300 transition-colors hover:border-[#53b6ff]/60 hover:bg-[#101923] hover:text-slate-50 disabled:cursor-not-allowed disabled:opacity-55";
const inputClass =
  "border border-[#303236] bg-[#05070b] px-2 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#53b6ff]";
const tierRank: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };
const infoIconMarkup = infoIconRaw.replace(/^\s*<symbol\b[^>]*>/, "").replace(/<\/symbol>\s*$/, "");

function typeIconUrl(typeID: number, size = 32) {
  return `https://images.evetech.net/types/${typeID}/icon?size=${size}`;
}

function numberOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatIsk(value: number | null | undefined, compact = false) {
  const number = numberOrNull(value);
  if (number == null) return "--";
  const sign = number < 0 ? "-" : "";
  const abs = Math.abs(number);
  if (compact) {
    if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}b`;
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}m`;
    if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
  }
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 0 })} ISK`;
}

function formatNumber(value: number | null | undefined, maxFractionDigits = 0) {
  const number = numberOrNull(value);
  if (number == null) return "--";
  return number.toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits });
}

function formatQty(value: number | null | undefined) {
  const number = numberOrNull(value);
  if (number == null) return "--";
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPct(value: number | null | undefined) {
  const number = numberOrNull(value);
  if (number == null) return "--";
  return `${(number * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function formatAge(seconds: number | null | undefined) {
  const value = numberOrNull(seconds);
  if (value == null) return "unknown age";
  if (value < 60) return `${Math.floor(value)}s ago`;
  if (value < 3600) return `${Math.floor(value / 60)}m ago`;
  if (value < 86400) return `${Math.floor(value / 3600)}h ago`;
  return `${Math.floor(value / 86400)}d ago`;
}

function profitClass(value: number | null | undefined) {
  const number = numberOrNull(value);
  if (number == null) return "text-slate-500";
  if (number < 0) return "text-[#ff7777]";
  if (number === 0) return "text-slate-400";
  if (number > 100_000_000) return "text-[#72f2aa] font-semibold";
  if (number > 10_000_000) return "text-[#5ee5a5] font-semibold";
  return "text-[#47d883]";
}

function viabilityClass(value: Viability) {
  if (value === "fully_local") return "border-[#2f7d4a]/60 text-[#8df2b0]";
  if (value === "partial") return "border-[#75612c]/70 text-[#f0cd72]";
  if (value === "not_priced") return "border-[#5d3340]/70 text-[#ffacac]";
  return "border-[#3a3c40] text-slate-400";
}

function viabilityText(value: Viability) {
  if (value === "fully_local") return "Full Self-Supply";
  if (value === "partial") return "Partial Self-Supply";
  if (value === "import_required") return "Import Required";
  return "Not Priced";
}

function TypeIcon({
  typeID,
  name,
  src,
  size = "h-8 w-8",
}: {
  typeID: number;
  name: string;
  src?: string;
  size?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src, typeID]);

  if (failed) {
    return (
      <div className={`flex items-center justify-center border border-[#252832] bg-[#05070b] text-slate-600 ${size}`}>
        <Package size={14} />
      </div>
    );
  }

  return (
    <img
      src={src || typeIconUrl(typeID)}
      alt={name}
      className={`border border-[#252832] bg-[#05070b] object-contain ${size}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function CommodityLink({
  typeID,
  name,
  children,
  className = "",
}: {
  typeID: number;
  name: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={`/items/${typeID}`}
      target="_blank"
      rel="noreferrer"
      title={`Show info: ${name}`}
      className={`text-slate-100 hover:text-[#9bdcff] ${className}`}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </a>
  );
}

function InfoLink({ typeID, name }: { typeID: number; name: string }) {
  return (
    <a
      href={`/items/${typeID}`}
      target="_blank"
      rel="noreferrer"
      title={`Show info: ${name}`}
      aria-label={`Show info: ${name}`}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 opacity-85 hover:border-[#53b6ff]/70 hover:bg-[#101b27] hover:text-[#9dd8ff] hover:opacity-100"
      onClick={(event) => event.stopPropagation()}
    >
      <svg aria-hidden="true" focusable="false" viewBox="0 0 128 128" className="h-3 w-3 shrink-0">
        <style>{".shape{fill:currentColor}"}</style>
        <g dangerouslySetInnerHTML={{ __html: infoIconMarkup }} />
      </svg>
    </a>
  );
}

function ViabilityLabel({ product }: { product: Pick<PiProduct, "viability" | "viabilityLabel"> }) {
  return (
    <span
      className={`inline-flex border-l px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${viabilityClass(
        product.viability
      )}`}
    >
      {viabilityText(product.viability)}
    </span>
  );
}

function SummaryCell({
  label,
  value,
  sub,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-[13px] font-semibold text-slate-100">{value}</div>
      {sub && <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">{sub}</div>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 border border-[#252832] bg-[#05070b] px-3 py-2 text-left hover:border-[#53b6ff]/55 hover:bg-[#0d141f]"
      >
        {content}
      </button>
    );
  }

  return <div className="min-w-0 border border-[#252832] bg-[#05070b] px-3 py-2">{content}</div>;
}

function ProfitValue({
  value,
  compact = false,
}: {
  value: number | null | undefined;
  compact?: boolean;
}) {
  return <span className={`font-mono ${profitClass(value)}`}>{formatIsk(value, compact)}</span>;
}

function StatCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="border border-[#252832] bg-[#05070b] px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className={`mt-1 font-mono text-[12px] ${tone || "text-slate-100"}`}>{value}</div>
      {hint && <div className="mt-1 text-[9px] leading-3 text-slate-600">{hint}</div>}
    </div>
  );
}

function matchesSearch(product: PiProduct, query: string) {
  const notProducedNames = product.notProducedCommodityNames || product.missingP0Names;
  if (!query) return true;
  const text = [
    product.name,
    product.tier,
    product.viabilityLabel,
    viabilityText(product.viability),
    ...notProducedNames,
    ...product.directIngredients.map((ingredient) => ingredient.name),
    ...product.p0Inputs.map((input) => input.name),
    ...(product.importedP1 || []).map((input) => input.name),
  ]
    .join(" ")
    .toLowerCase();
  return text.includes(query);
}

function missingP0Summary(names: string[]) {
  if (!names.length) return "None";
  const shown = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${names.length} - ${shown}, ...` : `${names.length} - ${shown}`;
}

function commodityNotProducedNames(product: PiProduct) {
  return product.notProducedCommodityNames || product.missingP0Names;
}

function commodityNotProducedCount(product: PiProduct) {
  return product.notProducedCommodityCount ?? product.missingP0Count;
}

function tierAccent(tier: string) {
  if (tier === "P4") return "border-[#60a5fa]/60 text-[#9bdcff]";
  if (tier === "P3") return "border-[#a78bfa]/50 text-[#c4b5fd]";
  if (tier === "P2") return "border-[#34d399]/50 text-[#86efac]";
  if (tier === "P1") return "border-[#facc15]/45 text-[#fde68a]";
  return "border-[#3a3c40] text-slate-400";
}

function sortProducts(products: PiProduct[], sortKey: SortKey) {
  const rows = [...products];
  rows.sort((a, b) => {
    if (sortKey === "name") return a.name.localeCompare(b.name);
    if (sortKey === "tier") {
      return tierRank[a.tier] - tierRank[b.tier] || a.name.localeCompare(b.name);
    }
    if (sortKey === "missingP0Count") {
      return commodityNotProducedCount(a) - commodityNotProducedCount(b) || a.name.localeCompare(b.name);
    }
    const av = numberOrNull(a[sortKey]);
    const bv = numberOrNull(b[sortKey]);
    if (av == null && bv == null) return a.name.localeCompare(b.name);
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av || a.name.localeCompare(b.name);
  });
  return rows;
}

function CommodityCostRow({
  row,
  costField,
  label,
}: {
  row: CommodityInput;
  costField: "totalCost" | "marketCost" | "appliedCost";
  label?: string;
}) {
  return (
    <div className="grid grid-cols-[34px,minmax(0,1fr),auto] gap-2 border border-[#242832] bg-[#070910] px-2 py-1.5">
      <TypeIcon typeID={row.typeID} name={row.name} src={row.icon_url} size="h-7 w-7" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <CommodityLink typeID={row.typeID} name={row.name} className="truncate">
            {row.name}
          </CommodityLink>
          <span className="shrink-0 border border-[#303236] px-1 text-[8px] uppercase tracking-[0.12em] text-slate-500">
            {row.tier}
          </span>
        </div>
        <div className="mt-0.5 truncate font-mono text-[9px] text-slate-500">
          qty {formatQty(row.qty)}
          {row.unitPrice != null ? ` - unit ${formatIsk(row.unitPrice, true)}` : " - no price"}
        </div>
        {row.planetTypes?.length ? (
          <div className="mt-0.5 truncate text-[9px] text-slate-600">
            {row.planetTypes.join(", ")}
          </div>
        ) : null}
      </div>
      <div className="self-center text-right">
        {label && <div className="text-[8px] uppercase tracking-[0.12em] text-slate-600">{label}</div>}
        <div className="font-mono text-[10px] text-slate-200">{formatIsk(row[costField], true)}</div>
      </div>
    </div>
  );
}

function CommodityList({
  rows,
  emptyText,
  costField,
  label,
}: {
  rows: CommodityInput[];
  emptyText: string;
  costField: "totalCost" | "marketCost" | "appliedCost";
  label?: string;
}) {
  if (!rows.length) {
    return <div className="border border-[#252832] bg-[#05070b] px-3 py-4 text-slate-500">{emptyText}</div>;
  }

  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <CommodityCostRow
          key={row.typeID}
          row={row}
          costField={costField}
          label={label}
        />
      ))}
    </div>
  );
}

type ChainTier = "P4" | "P3" | "P2" | "P1" | "P0";
type TieredChainNode = Omit<ChainNode, "ingredients">;

const CHAIN_TIER_ORDER: ChainTier[] = ["P4", "P3", "P2", "P1", "P0"];
const CHAIN_LEFT_TO_RIGHT: ChainTier[] = ["P0", "P1", "P2", "P3", "P4"];
const CHAIN_TIER_RANK: Record<ChainTier, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
const DIAGRAM_NODE_WIDTH = 176;
const DIAGRAM_COLUMN_WIDTH = 252;
const DIAGRAM_ROW_HEIGHT = 78;
const DIAGRAM_TOP_PAD = 54;
const DIAGRAM_LEFT_PAD = 110;

function isChainTier(tier: string): tier is ChainTier {
  return tier === "P0" || tier === "P1" || tier === "P2" || tier === "P3" || tier === "P4";
}

function emptyChainBuckets() {
  return CHAIN_TIER_ORDER.reduce((acc, tier) => {
    acc[tier] = new Map<number, TieredChainNode>();
    return acc;
  }, {} as Record<ChainTier, Map<number, TieredChainNode>>);
}

function collectChainNodesByTier(chain: ChainNode) {
  const buckets = emptyChainBuckets();

  const visit = (node: ChainNode) => {
    if (isChainTier(node.tier)) {
      const bucket = buckets[node.tier];
      const existing = bucket.get(node.typeID);
      const nodeQty = numberOrNull(node.qty) ?? 0;
      const planetTypes = node.planetTypes || [];

      if (existing) {
        existing.qty += nodeQty;
        existing.local = Boolean(existing.local || node.local);
        existing.imported = Boolean(existing.imported || node.imported);
        existing.notProduced = Boolean(existing.notProduced || node.notProduced);
        existing.planetTypes = Array.from(new Set([...(existing.planetTypes || []), ...planetTypes])).sort();
        if (!existing.icon_url && node.icon_url) existing.icon_url = node.icon_url;
      } else {
        bucket.set(node.typeID, {
          typeID: node.typeID,
          name: node.name,
          tier: node.tier,
          qty: nodeQty,
          batchQty: node.batchQty,
          icon_url: node.icon_url,
          planetTypes: [...planetTypes].sort(),
          local: node.local,
          imported: node.imported,
          notProduced: node.notProduced,
        });
      }
    }

    node.ingredients?.forEach(visit);
  };

  visit(chain);

  return CHAIN_TIER_ORDER.reduce((acc, tier) => {
    const rows = Array.from(buckets[tier].values());
    rows.sort((a, b) => {
      if (tier === "P0" && Boolean(a.local) !== Boolean(b.local)) {
        return a.local ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });
    acc[tier] = rows;
    return acc;
  }, {} as Record<ChainTier, TieredChainNode[]>);
}

function chainTierLabel(tier: ChainTier, targetTier: string) {
  if (tier === "P0") return "P0 Base Resources";
  if (tier === targetTier) return `${tier} Target`;
  return `${tier} Inputs`;
}

function chainAccentClass(node: Pick<ChainNode, "tier" | "local">) {
  if (node.tier === "P4") return "border-l-[#60a5fa] text-[#bfe8ff]";
  if (node.tier === "P3") return "border-l-[#a78bfa] text-[#d7ccff]";
  if (node.tier === "P2") return "border-l-[#34d399] text-[#bdf7d5]";
  if (node.tier === "P1") return "border-l-[#facc15] text-[#fff0a8]";
  return node.local ? "border-l-[#47d883] text-[#b9f6cc]" : "border-l-[#566070] text-slate-500";
}

type ChainDiagramNode = TieredChainNode & { graphKey: string };
type PositionedChainDiagramNode = ChainDiagramNode & { x: number; y: number };
type ChainDiagramEdge = {
  from: string;
  to: string;
  childTier: string;
  childLocal?: boolean;
};
type DiagramLine = {
  key: string;
  d: string;
  tone: string;
};

function chainNodeToTiered(node: ChainNode): TieredChainNode {
  return {
    typeID: node.typeID,
    name: node.name,
    tier: node.tier,
    qty: node.qty,
    batchQty: node.batchQty,
    icon_url: node.icon_url,
    planetTypes: node.planetTypes,
    local: node.local,
    imported: node.imported,
    notProduced: node.notProduced,
  };
}

function buildOwnedChainDiagram(chain: ChainNode) {
  const nodes: PositionedChainDiagramNode[] = [];
  const edges: ChainDiagramEdge[] = [];
  let leafIndex = 0;

  const placeNode = (node: ChainNode, graphKey: string): PositionedChainDiagramNode => {
    const children = (node.ingredients || []).map((child, index) =>
      placeNode(child, `${graphKey}.${index}`)
    );
    const tier = isChainTier(node.tier) ? node.tier : "P0";
    const y = children.length
      ? (children[0].y + children[children.length - 1].y) / 2
      : DIAGRAM_TOP_PAD + leafIndex++ * DIAGRAM_ROW_HEIGHT;
    const placed: PositionedChainDiagramNode = {
      ...chainNodeToTiered(node),
      qty: numberOrNull(node.qty) ?? 0,
      graphKey,
      x: DIAGRAM_LEFT_PAD + CHAIN_TIER_RANK[tier] * DIAGRAM_COLUMN_WIDTH,
      y,
    };

    nodes.push(placed);
    children.forEach((child) => {
      edges.push({
        from: child.graphKey,
        to: placed.graphKey,
        childTier: child.tier,
        childLocal: child.local,
      });
    });
    return placed;
  };

  placeNode(chain, "target");
  const maxTierRank = Math.max(...nodes.map((node) => (isChainTier(node.tier) ? CHAIN_TIER_RANK[node.tier] : 0)));
  const leafCount = Math.max(1, leafIndex);

  return {
    nodes,
    edges,
    width: DIAGRAM_LEFT_PAD + maxTierRank * DIAGRAM_COLUMN_WIDTH + DIAGRAM_NODE_WIDTH + 96,
    height: DIAGRAM_TOP_PAD + leafCount * DIAGRAM_ROW_HEIGHT + 54,
    maxTierRank,
  };
}

function diagramLineTone(edge: ChainDiagramEdge) {
  if (edge.childTier === "P0" && edge.childLocal === false) return "#7f8db1";
  return "#3478ff";
}

function DiagramNodeCard({
  node,
  isTarget,
  registerNode,
}: {
  node: ChainDiagramNode;
  isTarget: boolean;
  registerNode?: (key: string, element: HTMLDivElement | null) => void;
}) {
  const isP0 = node.tier === "P0";
  const isImportedP1 = node.tier === "P1" && Boolean(node.imported);
  const p0IsLocal = Boolean(node.local);
  const statusClass = p0IsLocal ? "text-[#8df2b0]" : "text-slate-500";
  const fadedClass = isP0 && !p0IsLocal ? "opacity-55" : "";

  return (
    <div
      ref={(element) => registerNode?.(node.graphKey, element)}
      className={`border border-[#262d38] border-l-2 bg-[#05070b] px-2 py-1.5 ${chainAccentClass(
        node
      )} ${fadedClass} w-[172px] ${isTarget ? "shadow-[inset_0_0_0_1px_rgba(83,182,255,0.24)]" : ""}`}
    >
      <div className="grid grid-cols-[26px,minmax(0,1fr),20px] items-start gap-1.5">
        <TypeIcon typeID={node.typeID} name={node.name} src={node.icon_url} size="h-6 w-6" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1">
            <CommodityLink typeID={node.typeID} name={node.name} className="truncate text-[10px] font-medium">
              {node.name}
            </CommodityLink>
            <span className={`shrink-0 border px-1 text-[7px] uppercase tracking-[0.12em] ${tierAccent(node.tier)}`}>
              {node.tier}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-[11px] text-slate-400">
            <span>x {formatQty(node.qty)}</span>
            {isTarget ? <span className="uppercase tracking-[0.12em] text-[#9bdcff]">Target</span> : null}
          </div>
        </div>
        <InfoLink typeID={node.typeID} name={node.name} />
      </div>
      {isImportedP1 ? (
        <div className="mt-1 border-t border-[#28313e] pt-1 text-[8px] uppercase tracking-[0.12em] text-[#ffb4a8]">
          Import Required
        </div>
      ) : null}
      {isP0 ? (
        <div className={`mt-1 border-t border-[#28313e] pt-1 text-[8px] uppercase tracking-[0.12em] ${statusClass}`}>
          {p0IsLocal ? "Self-Supplied" : "Not Produced"}
        </div>
      ) : null}
    </div>
  );
}

function TierTotalsSummary({ product }: { product: PiProduct }) {
  const tiers = useMemo(() => collectChainNodesByTier(product.chain), [product.chain]);
  const visibleTiers = CHAIN_TIER_ORDER.filter((tier) => tiers[tier].length);

  return (
    <details className="mt-3 border border-[#252b36] bg-[#05070b]">
      <summary className="cursor-pointer bg-[#0b0f17] px-3 py-2 text-[9px] uppercase tracking-[0.16em] text-slate-400 hover:text-slate-200">
        Aggregated Tier Totals
      </summary>
      <div className="space-y-2 p-3">
        {visibleTiers.map((tier) => {
          const rows = tiers[tier];
          return (
            <div key={tier} className="border border-[#1f2530] bg-[#070910] px-2 py-2">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className={`border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.14em] ${tierAccent(tier)}`}>
                  {chainTierLabel(tier, product.tier)}
                </span>
                <span className="font-mono text-[9px] text-slate-600">
                  {rows.length} {rows.length === 1 ? "item" : "items"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {rows.map((node) => (
                  <DiagramNodeCard
                    key={`${tier}-${node.typeID}`}
                    node={{ ...node, graphKey: `${tier}:${node.typeID}` }}
                    isTarget={node.typeID === product.typeID}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function ProductionChainDiagram({ product }: { product: PiProduct }) {
  const graph = useMemo(() => buildOwnedChainDiagram(product.chain), [product.chain]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [lines, setLines] = useState<DiagramLine[]>([]);
  const visibleTiers = CHAIN_LEFT_TO_RIGHT.filter((tier) =>
    graph.nodes.some((node) => node.tier === tier)
  );

  const registerNode = useCallback((key: string, element: HTMLDivElement | null) => {
    nodeRefs.current[key] = element;
  }, []);

  const measureLines = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const nextLines = graph.edges.flatMap((edge) => {
      const from = nodeRefs.current[edge.from]?.getBoundingClientRect();
      const to = nodeRefs.current[edge.to]?.getBoundingClientRect();
      if (!from || !to) return [];

      const x1 = from.right - canvasRect.left;
      const y1 = from.top + from.height / 2 - canvasRect.top;
      const x2 = to.left - canvasRect.left;
      const y2 = to.top + to.height / 2 - canvasRect.top;
      const midX = x1 + Math.max(26, (x2 - x1) * 0.58);

      return [
        {
          key: `${edge.from}->${edge.to}`,
          d: `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`,
          tone: diagramLineTone(edge),
        },
      ];
    });
    setLines(nextLines);
  }, [graph.edges]);

  useLayoutEffect(() => {
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(measureLines);
    });
    window.addEventListener("resize", measureLines);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.removeEventListener("resize", measureLines);
    };
  }, [measureLines]);

  return (
    <section className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2c2f36] bg-[#101219] px-3 py-1.5">
        <div className="text-[10px] uppercase tracking-[0.18em] text-slate-300">Production Chain</div>
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-500">P0 inputs -&gt; target product</div>
      </div>
      <div className="bg-[#05070b] p-3">
        <div className="overflow-x-auto pb-2 [scrollbar-color:#334155_#05070b] [scrollbar-width:thin]">
          <div
            ref={canvasRef}
            className="relative border border-[#1f2530] bg-[#03050a]"
            style={{ minWidth: Math.max(920, graph.width), height: graph.height }}
          >
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              aria-hidden="true"
            >
              {lines.map((line) => (
                <path
                  key={line.key}
                  d={line.d}
                  fill="none"
                  stroke={line.tone}
                  strokeOpacity={0.68}
                  strokeWidth={1.15}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            <div className="relative z-10">
              {visibleTiers.map((tier) => (
                <div
                  key={tier}
                  className="absolute top-3 text-center"
                  style={{
                    left: DIAGRAM_LEFT_PAD + CHAIN_TIER_RANK[tier] * DIAGRAM_COLUMN_WIDTH,
                    width: DIAGRAM_NODE_WIDTH,
                  }}
                >
                  <div className={`inline-flex border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.14em] ${tierAccent(tier)}`}>
                    {chainTierLabel(tier, product.tier)}
                  </div>
                </div>
              ))}
              {graph.nodes.map((node) => (
                <div
                  key={node.graphKey}
                  className="absolute"
                  style={{ left: node.x, top: node.y }}
                >
                  <DiagramNodeCard
                    node={node}
                    isTarget={node.typeID === product.typeID}
                    registerNode={registerNode}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        <TierTotalsSummary product={product} />
      </div>
    </section>
  );
}

function SelfSuppliedP0Summary({ rows }: { rows: CommodityInput[] }) {
  if (!rows.length) {
    return (
      <div className="border border-[#252832] bg-[#05070b] px-3 py-4 text-slate-500">
        No selected planet supplies required P0.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <StatCard label="Self-Supplied P0" value={`${rows.length} inputs`} />
        <StatCard label="Applied Input Cost" value="0 ISK" tone="text-[#8df2b0]" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((row) => (
          <CommodityLink
            key={row.typeID}
            typeID={row.typeID}
            name={row.name}
            className="inline-flex items-center gap-1 border border-[#2f7d4a]/45 bg-[#061109] px-1.5 py-1 text-[10px] text-[#b9f6cc] hover:border-[#53b6ff]/70"
          >
            <TypeIcon typeID={row.typeID} name={row.name} src={row.icon_url} size="h-5 w-5" />
            <span>{row.name}</span>
          </CommodityLink>
        ))}
      </div>
    </div>
  );
}

function ProductModal({
  product,
  selectedPlanets,
  onClose,
}: {
  product: PiProduct | null;
  selectedPlanets: PlanetType[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!product) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, product]);

  useEffect(() => {
    if (!product || typeof document === "undefined") return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [product]);

  if (!product) return null;

  const notProducedNames = commodityNotProducedNames(product);
  const notProducedCount = commodityNotProducedCount(product);
  const importedP1Rows = product.importedP1 || product.importedP0;
  const importedP1Cost = product.importedP1Cost ?? product.importedP0Cost;

  const modal = (
    <div
      className="fixed inset-0 z-[100] bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-label={`PI Product Show Info: ${product.name}`}
      onMouseDown={onClose}
    >
      <div className="fixed inset-0 flex items-center justify-center px-2 py-3 sm:px-4 sm:py-6">
        <div
          className="flex max-h-[calc(100dvh-24px)] w-full max-w-6xl flex-col border border-[#3a3c40] bg-[#05070b] shadow-[0_0_38px_rgba(0,0,0,0.92)] sm:max-h-[90vh]"
          onMouseDown={(event) => event.stopPropagation()}
        >
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-[#3a3c40] bg-gradient-to-r from-[#111319] via-[#171920] to-[#242833] px-3 py-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
              PI Product Show Info
            </div>
            <div className="mt-0.5 truncate text-[13px] font-semibold uppercase tracking-[0.12em] text-slate-100">
              {product.name}
            </div>
          </div>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center border border-[#3a3c40] bg-[#05070b] text-slate-300 hover:border-[#53b6ff]/70 hover:text-slate-50"
            onClick={onClose}
            aria-label="Close product detail"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-color:#334155_#05070b] [scrollbar-width:thin]">
          <div className="space-y-3">
            <section className={panel}>
              <div className={panelHeader}>Target Commodity</div>
              <div className="grid gap-3 p-3 md:grid-cols-[64px,minmax(0,1fr),220px]">
                <TypeIcon typeID={product.typeID} name={product.name} src={product.icon_url} size="h-16 w-16" />
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <CommodityLink
                      typeID={product.typeID}
                      name={product.name}
                      className="min-w-0 text-[18px] font-semibold uppercase tracking-[0.08em]"
                    >
                      {product.name}
                    </CommodityLink>
                    <span className={`border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${tierAccent(product.tier)}`}>
                      {product.tier}
                    </span>
                    <ViabilityLabel product={product} />
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-slate-500">
                    batch qty {formatQty(product.batchQty)} - typeID {product.typeID}
                  </div>
                </div>
                <div className="flex flex-wrap items-start gap-1.5 md:justify-end">
                  <InfoLink typeID={product.typeID} name={product.name} />
                  <a
                    href={`/market?type_id=${product.typeID}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 border border-[#303236] bg-[#05070b] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[#9bdcff] hover:border-[#53b6ff]/70 hover:bg-[#101923] hover:text-slate-50"
                  >
                    Market <ArrowUpRight size={10} />
                  </a>
                </div>
              </div>
            </section>

            <section className={panel}>
              <div className={panelHeader}>Viability / Selected Planets</div>
              <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_220px_180px]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Selected planets</span>
                    {selectedPlanets.length ? (
                      selectedPlanets.map((planet) => (
                        <span key={planet} className="border border-[#303236] px-1.5 py-0.5 text-[9px] text-slate-300">
                          {planet}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-500">none</span>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-slate-400">
                    Self-Supplied P0 is P0 available from selected planet types and is treated as 0 ISK. P1 commodities that cannot be produced locally are bought from market.
                  </p>
                  {notProducedNames.length ? (
                    <div className="mt-2 text-[10px] leading-4 text-slate-400">
                      Commodities not produced: {notProducedNames.join(", ")}
                    </div>
                  ) : (
                    <div className="mt-2 text-[10px] text-[#8df2b0]">
                      All required P1 can be produced from selected planets.
                    </div>
                  )}
                  {product.missingPriceNames.length ? (
                    <div className="mt-2 border border-[#5d3340] bg-[#17090d] px-2 py-1.5 text-[10px] text-[#ffb4b4]">
                      Missing price data: {product.missingPriceNames.join(", ")}
                    </div>
                  ) : null}
                </div>
                <StatCard label="Self-Supplied P0" value={`${product.localP0Count}/${product.totalP0Count}`} />
                <StatCard label="Imported P1" value={notProducedCount} />
              </div>
            </section>

            <section className={panel}>
              <div className={panelHeader}>Profit Summary</div>
              <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard
                  label="Chain Profit"
                  value={<ProfitValue value={product.profitLocalPlanetChain} />}
                  tone={profitClass(product.profitLocalPlanetChain)}
                  hint="Selected planets at 0 ISK, unproduced P1 bought."
                />
                <StatCard
                  label="Profit Importing All P1"
                  value={<ProfitValue value={product.profitFullMarketChain} />}
                  tone={profitClass(product.profitFullMarketChain)}
                  hint="All P1 inputs bought from market."
                />
                <StatCard
                  label="Final Step Profit"
                  value={<ProfitValue value={product.profitFinalStep} />}
                  tone={profitClass(product.profitFinalStep)}
                  hint="Direct ingredients to product."
                />
                <StatCard label="Output Value" value={formatIsk(product.outputValue)} />
                <StatCard label="Imported P1 Cost" value={formatIsk(importedP1Cost)} />
              </div>
            </section>

            <section className={panel}>
              <div className={panelHeader}>Direct Ingredients</div>
              <div className="p-3">
                <CommodityList
                  rows={product.directIngredients}
                  emptyText="No direct ingredient list."
                  costField="totalCost"
                  label="cost"
                />
              </div>
            </section>

            <div className="grid gap-3 lg:grid-cols-2">
              <section className={panel}>
                <div className={panelHeader}>Self-Supplied P0</div>
                <div className="p-3">
                  <SelfSuppliedP0Summary rows={product.localP0} />
                </div>
              </section>

              <section className={panel}>
                <div className={panelHeader}>Imported P1</div>
                <div className="p-3">
                  <CommodityList
                    rows={importedP1Rows}
                    emptyText="No P1 import needed."
                    costField="marketCost"
                    label="import"
                  />
                </div>
              </section>
            </div>

            <ProductionChainDiagram product={product} />
          </div>
        </div>
      </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return modal;
  return createPortal(modal, document.body);
}

export default function PiCalc() {
  const [selectedPlanets, setSelectedPlanets] = useState<PlanetType[]>([]);
  const [marketMode, setMarketMode] = useState<MarketMode>("sell");
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [viabilityFilter, setViabilityFilter] = useState<ViabilityFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("profitLocalPlanetChain");
  const [helpOpen, setHelpOpen] = useState(false);
  const [data, setData] = useState<PiCalcPayload | null>(null);
  const [modalTypeID, setModalTypeID] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [remoteStateReady, setRemoteStateReady] = useState(false);

  useEffect(() => {
    let alive = true;

    async function loadAuth() {
      try {
        const response = await fetch("/api/auth/me", { credentials: "include" });
        const data = await readJson<{ ok: boolean; authenticated: boolean; user: AuthUser | null }>(response);
        if (alive) setAuthUser(data.authenticated ? data.user : null);
      } catch {
        if (alive) setAuthUser(null);
      } finally {
        if (alive) setAuthChecked(true);
      }
    }

    function handleAuthChanged(event: Event) {
      const detail = (event as CustomEvent<SiteAuthChangeDetail>).detail;
      if (detail && "user" in detail) {
        setAuthUser(detail.user);
        setAuthChecked(true);
      } else {
        void loadAuth();
      }
    }

    void loadAuth();
    window.addEventListener(SITE_AUTH_CHANGED_EVENT, handleAuthChanged);
    return () => {
      alive = false;
      window.removeEventListener(SITE_AUTH_CHANGED_EVENT, handleAuthChanged);
    };
  }, []);

  useEffect(() => {
    if (!authUser) {
      setRemoteStateReady(false);
      return;
    }

    let cancelled = false;

    async function loadRemoteState() {
      setRemoteStateReady(false);
      try {
        const response = await fetch(`/api/tool-state/${PI_STATE_TOOL_KEY}`, {
          credentials: "include",
        });
        const data = await readJson<{
          ok: boolean;
          state: { stateJson?: unknown } | null;
        }>(response);
        if (cancelled || !data.state?.stateJson) return;
        const remembered = normalizePiRememberedInputs(data.state.stateJson);
        setSelectedPlanets(remembered.selectedPlanets || []);
        setMarketMode(remembered.marketMode || "sell");
        setSearch(remembered.search || "");
        setTierFilter(remembered.tierFilter || "all");
        setViabilityFilter(remembered.viabilityFilter || "all");
        setSortKey(remembered.sortKey || "profitLocalPlanetChain");
      } catch {
        if (!cancelled) setRemoteStateReady(true);
        return;
      } finally {
        if (!cancelled) setRemoteStateReady(true);
      }
    }

    void loadRemoteState();
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  const runCalc = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/pi/calc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selectedPlanets,
            marketMode,
          }),
          signal,
        });
        const payload = (await response.json()) as PiCalcPayload | ApiErrorPayload;
        if (!response.ok || !payload.ok) {
          throw new Error((payload as ApiErrorPayload).error || `HTTP ${response.status}`);
        }
        setData(payload);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message || "PI calculation failed.");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [marketMode, selectedPlanets]
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void runCalc(controller.signal);
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [runCalc]);

  useEffect(() => {
    if (!authUser || !remoteStateReady) return;
    const snapshot: PiRememberedInputs = {
      selectedPlanets,
      marketMode,
      search,
      tierFilter,
      viabilityFilter,
      sortKey,
    };

    const timer = window.setTimeout(() => {
      void fetch(`/api/tool-state/${PI_STATE_TOOL_KEY}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateJson: snapshot }),
      }).catch(() => {});
    }, 600);

    return () => window.clearTimeout(timer);
  }, [
    authUser,
    remoteStateReady,
    marketMode,
    search,
    selectedPlanets,
    sortKey,
    tierFilter,
    viabilityFilter,
  ]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = (data?.products || []).filter((product) => {
      if (tierFilter !== "all" && product.tier !== tierFilter) return false;
      if (viabilityFilter !== "all" && product.viability !== viabilityFilter) return false;
      return matchesSearch(product, query);
    });
    return sortProducts(rows, sortKey);
  }, [data?.products, search, sortKey, tierFilter, viabilityFilter]);

  const modalProduct = useMemo(() => {
    if (!data?.products.length) return null;
    return data.products.find((product) => product.typeID === modalTypeID) || null;
  }, [data?.products, modalTypeID]);

  const summary = data?.summary;
  const market = data?.market;
  const priceAge = formatAge(market?.price_age_seconds);
  const stalePriceWarning =
    market?.price_age_seconds != null && market.price_age_seconds > 3600;
  const activeMode = MARKET_MODES.find((mode) => mode.key === marketMode);
  const selectedPlanetText = selectedPlanets.length
    ? selectedPlanets.join(", ")
    : "No planets selected";

  function togglePlanet(planet: PlanetType) {
    setSelectedPlanets((current) =>
      current.includes(planet)
        ? current.filter((entry) => entry !== planet)
        : [...current, planet]
    );
  }

  return (
    <div className="tt-tool-v2 min-h-screen px-3 py-4 text-[11px] leading-snug text-slate-100 sm:px-4">
      <div className="tt2-window mx-auto max-w-7xl">
        <div className="tt2-titlebar flex-wrap gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-3 w-3 bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
            <span className="truncate text-[10px] uppercase tracking-widest text-slate-300">
              Science & Industry &gt; Wormhole PI Profitability
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] text-slate-400">
            <span className="border border-[#303236] bg-[#0b0d11] px-1.5 py-0.5">
              {market?.station || "Jita 4-4"}
            </span>
            <span className={stalePriceWarning ? "text-[#f0cd72]" : "text-[#53b6ff]"}>
              prices {priceAge}
            </span>
            <span>{loading ? "refreshing" : "ready"}</span>
          </div>
        </div>

        <div className="space-y-3 p-3">
          <section className={panel}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2c2f36] bg-[#05070b] px-3 py-2">
              <div>
                <h1 className="text-[17px] font-semibold uppercase tracking-[0.12em] text-slate-50">
                  Planet-Constrained PI Browser
                </h1>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  Selected planets decide which P0 is self-supplied. P1 commodities that cannot be produced locally are imported.
                </div>
              </div>
              <button
                type="button"
                className={hardButton}
                onClick={() => setHelpOpen((value) => !value)}
              >
                <span className="inline-flex items-center gap-1">
                  <Info size={12} /> How pricing works
                </span>
              </button>
            </div>

            {helpOpen && (
              <div className="grid gap-2 border-b border-[#2c2f36] bg-[#070910] px-3 py-2 text-[11px] text-slate-300 md:grid-cols-2">
                <div>
                  <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Planet logic</div>
                  <p className="mt-1 leading-5">
                    Products are expanded down to P0. Selected planet types mark self-supplied P0; P1 commodities that cannot be fully sourced locally are treated as imported.
                  </p>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Costs</div>
                  <p className="mt-1 leading-5">
                    Self-supplied P0 is applied at 0 ISK. Any P1 commodity that cannot be produced from selected planets is bought from market. Tax is not included.
                  </p>
                </div>
                <div className="md:col-span-2">
                  <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Market modes</div>
                  <div className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
                    {MARKET_MODES.map((mode) => (
                      <div key={mode.key} className="border border-[#252832] bg-[#05070b] px-2 py-1">
                        <span className="text-slate-100">{mode.label}</span>
                        <span className="ml-1 text-slate-500">- {mode.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {authChecked && !authUser && (
              <div className="mx-3 mt-3 flex flex-wrap items-center gap-2 border border-[#27435a] bg-[#07111a] px-2 py-1.5 text-[10px] text-[#9bdcff]">
                <span className="uppercase tracking-widest">
                  Sign in to remember PI inputs across devices.
                </span>
                <button
                  type="button"
                  className="border border-[#53b6ff]/50 bg-[#0b1b2a] px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-100 hover:border-[#53b6ff]"
                  onClick={() => requestSiteAuthModal("login")}
                >
                  Sign In
                </button>
              </div>
            )}

            <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(260px,0.8fr)]">
              <fieldset className="min-w-0 border border-[#2c2f36] bg-[#05070b]">
                <legend className="px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                  Available Planet Types
                </legend>
                <div className="space-y-2 p-2">
                  <div className="flex flex-wrap gap-1">
                    {PLANET_TYPES.map((planet) => {
                      const active = selectedPlanets.includes(planet);
                      return (
                        <button
                          key={planet}
                          type="button"
                          onClick={() => togglePlanet(planet)}
                          className={`min-w-[86px] border px-2 py-1 text-[10px] uppercase tracking-[0.14em] transition-colors ${
                            active
                              ? "border-[#53b6ff]/70 bg-[#102033] text-slate-50 shadow-[inset_2px_0_0_rgba(83,182,255,0.65)]"
                              : "border-[#303236] bg-[#070910] text-slate-400 hover:border-[#53b6ff]/45 hover:text-slate-100"
                          }`}
                        >
                          {planet}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="truncate text-[10px] text-slate-500">{selectedPlanetText}</div>
                    <div className="flex gap-1">
                      <button type="button" className={hardButton} onClick={() => setSelectedPlanets(PLANET_TYPES)}>
                        Select all
                      </button>
                      <button type="button" className={hardButton} onClick={() => setSelectedPlanets([])}>
                        Clear
                      </button>
                    </div>
                  </div>
                </div>
              </fieldset>

              <fieldset className="min-w-0 border border-[#2c2f36] bg-[#05070b]">
                <legend className="px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                  Market Mode
                </legend>
                <div className="grid gap-1 p-2 sm:grid-cols-2">
                  {MARKET_MODES.map((mode) => {
                    const active = marketMode === mode.key;
                    return (
                      <button
                        key={mode.key}
                        type="button"
                        onClick={() => setMarketMode(mode.key)}
                        className={`border px-2 py-1.5 text-left transition-colors ${
                          active
                            ? "border-[#53b6ff]/70 bg-[#102033] text-slate-50"
                            : "border-[#303236] bg-[#070910] text-slate-400 hover:border-[#53b6ff]/45 hover:text-slate-100"
                        }`}
                      >
                        <div className="text-[10px] uppercase tracking-[0.14em]">{mode.label}</div>
                        <div className="mt-0.5 text-[9px] text-slate-500">{mode.detail}</div>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="min-w-0 border border-[#2c2f36] bg-[#05070b]">
                <legend className="px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                  Self-Supplied Inputs
                </legend>
                <div className="p-2">
                  <div className="text-[10px] leading-4 text-slate-400">
                    P0 available from selected planets is treated as 0 ISK. P1 commodities that cannot be produced locally are bought from market.
                  </div>
                </div>
              </fieldset>
            </div>
          </section>

          <section className={panel}>
            <div className="grid gap-2 p-3 lg:grid-cols-[minmax(240px,1fr)_140px_180px_220px]">
              <label className="flex min-w-0 items-center border border-[#303236] bg-[#05070b] focus-within:border-[#53b6ff]">
                <span className="flex w-9 justify-center text-slate-500">
                  <Search size={14} />
                </span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search product or ingredient..."
                  className="min-w-0 flex-1 bg-transparent px-1.5 py-1.5 text-[11px] text-slate-100 outline-none placeholder:text-slate-600"
                />
              </label>
              <select
                value={tierFilter}
                onChange={(event) => setTierFilter(event.target.value as TierFilter)}
                className={inputClass}
              >
                {TIER_FILTERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {tier === "all" ? "All tiers" : tier}
                  </option>
                ))}
              </select>
              <select
                value={viabilityFilter}
                onChange={(event) => setViabilityFilter(event.target.value as ViabilityFilter)}
                className={inputClass}
              >
                {VIABILITY_FILTERS.map((filter) => (
                  <option key={filter.key} value={filter.key}>
                    {filter.label}
                  </option>
                ))}
              </select>
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
                className={inputClass}
              >
                {SORTS.map((sort) => (
                  <option key={sort.key} value={sort.key}>
                    Sort: {sort.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {error && (
            <div className="border border-[#5d3340] bg-[#17090d] px-3 py-2 text-[12px] text-[#ffb4b4]">
              {error}
            </div>
          )}

          {summary && (
            <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              <SummaryCell label="Products" value={summary.totalProducts} sub={`${filteredProducts.length} visible`} />
              <SummaryCell label="Fully Self-Supplied" value={summary.fullyLocal} />
              <SummaryCell label="Partial Self-Supply" value={summary.partiallyLocal} />
              <SummaryCell label="Import Required" value={summary.importRequired} />
              <SummaryCell label="Not Priced" value={summary.notPriced} />
              <SummaryCell
                label="Best Chain Profit"
                value={summary.bestLocalChain?.name || "--"}
                sub={formatIsk(summary.bestLocalChain?.profitLocalPlanetChain, true)}
                onClick={
                  summary.bestLocalChain
                    ? () => setModalTypeID(summary.bestLocalChain!.typeID)
                    : undefined
                }
              />
              <SummaryCell
                label="Best Final Step"
                value={summary.bestFinalStep?.name || "--"}
                sub={formatIsk(summary.bestFinalStep?.profitFinalStep, true)}
                onClick={
                  summary.bestFinalStep
                    ? () => setModalTypeID(summary.bestFinalStep!.typeID)
                    : undefined
                }
              />
            </section>
          )}

          {(stalePriceWarning || (summary?.notPriced || 0) > 0) && (
            <div className="border border-[#75612c] bg-[#151106] px-3 py-2 text-[11px] text-[#f0cd72]">
              {stalePriceWarning ? `Market prices are ${priceAge}. ` : ""}
              {(summary?.notPriced || 0) > 0
                ? `${summary?.notPriced} products are missing enough price data for the chain calculation.`
                : ""}
            </div>
          )}

          <section className={`${panel} min-w-0`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2c2f36] bg-[#101219] px-3 py-1.5">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-300">
                PI Product Results
              </div>
              <div className="font-mono text-[9px] text-slate-500">
                {activeMode?.label} - self-supplied P0 at 0 ISK, missing chains imported as P1
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] table-fixed text-[11px]">
                <thead className="bg-[#14161d] text-slate-100">
                  <tr>
                    <th className="w-[360px] border border-[#2b2d33] px-2 py-1.5 text-left">Product</th>
                    <th className="w-[56px] border border-[#2b2d33] px-2 py-1.5 text-center">Tier</th>
                    <th className="w-[154px] border border-[#2b2d33] px-2 py-1.5 text-left">Viability</th>
                    <th className="w-[210px] border border-[#2b2d33] px-2 py-1.5 text-left">Commodities Not Produced</th>
                    <th className="w-[120px] border border-[#2b2d33] px-2 py-1.5 text-right">Chain Profit</th>
                    <th className="w-[120px] border border-[#2b2d33] px-2 py-1.5 text-right">All P1 Import</th>
                    <th className="w-[110px] border border-[#2b2d33] px-2 py-1.5 text-right">Final Step</th>
                    <th className="w-[84px] border border-[#2b2d33] px-2 py-1.5 text-right">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !data && (
                    <tr>
                      <td colSpan={8} className="border border-[#2b2d33] px-3 py-6 text-center text-slate-400">
                        Calculating PI chains...
                      </td>
                    </tr>
                  )}

                  {!loading && data && filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={8} className="border border-[#2b2d33] px-3 py-6 text-center text-slate-500">
                        No products match the current filters.
                      </td>
                    </tr>
                  )}

                  {filteredProducts.map((product, index) => {
                    const selected = modalProduct?.typeID === product.typeID;
                    const notProducedNames = commodityNotProducedNames(product);
                    const missingTitle = notProducedNames.length
                      ? notProducedNames.join(", ")
                      : "None";
                    return (
                      <tr
                        key={product.typeID}
                        onClick={() => setModalTypeID(product.typeID)}
                        className={`cursor-pointer transition-colors ${
                          selected
                            ? "bg-[#122033] shadow-[inset_2px_0_0_rgba(83,182,255,0.72)]"
                            : index % 2 === 0
                              ? "bg-[#090b11] hover:bg-[#101621]"
                              : "bg-[#0c0f16] hover:bg-[#101621]"
                        }`}
                      >
                        <td className="border border-[#2b2d33] px-2 py-1.5">
                          <div className="grid grid-cols-[34px,minmax(0,1fr),auto] items-center gap-2">
                            <TypeIcon typeID={product.typeID} name={product.name} src={product.icon_url} />
                            <div className="min-w-0">
                              <button
                                type="button"
                                className="block w-full text-left text-[12px] font-medium text-slate-100 hover:text-[#9bdcff]"
                                onClick={() => setModalTypeID(product.typeID)}
                              >
                                {product.name}
                              </button>
                              <div className="font-mono text-[9px] text-slate-600">typeID {product.typeID}</div>
                            </div>
                            <InfoLink typeID={product.typeID} name={product.name} />
                          </div>
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1.5 text-center font-mono text-slate-300">
                          {product.tier}
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1.5">
                          <ViabilityLabel product={product} />
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1.5">
                          <div className="truncate text-slate-300" title={missingTitle}>
                            {missingP0Summary(notProducedNames)}
                          </div>
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1.5 text-right">
                          <ProfitValue value={product.profitLocalPlanetChain} compact />
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1.5 text-right">
                          <ProfitValue value={product.profitFullMarketChain} compact />
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1.5 text-right">
                          <ProfitValue value={product.profitFinalStep} compact />
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1.5 text-right font-mono text-slate-300">
                          {formatPct(product.marginLocalPlanetChain)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
      <ProductModal
        product={modalProduct}
        selectedPlanets={selectedPlanets}
        onClose={() => setModalTypeID(null)}
      />
    </div>
  );
}
