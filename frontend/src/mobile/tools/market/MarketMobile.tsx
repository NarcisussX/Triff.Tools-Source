import { useEffect, useLayoutEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useSearchParams } from "react-router-dom";
import { Star } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  requestSiteAuthModal,
  SITE_AUTH_CHANGED_EVENT,
  type SiteAuthChangeDetail,
} from "../../../auth/siteAuthEvents";
import type { AuthUser } from "../../../components/fitting/types";
import browserIconRaw from "../../../assets/icons/browser.svg?raw";
import bookmarksIconRaw from "../../../assets/icons/browserbookmarks.svg?raw";
import folderIconRaw from "../../../assets/icons/Folder.svg?raw";
import infoIconRaw from "../../../assets/icons/info.svg?raw";
import journalIconRaw from "../../../assets/icons/journal.svg?raw";
import marketIconRaw from "../../../assets/icons/market.svg?raw";
import trainingQueueIconRaw from "../../../assets/icons/trainingqueue.svg?raw";
import searchMarketIconRaw from "../../../assets/icons/searchmarket.svg?raw";
import walletIconRaw from "../../../assets/icons/wallet.svg?raw";
import { BottomSheet } from "../../shell/BottomSheet";
import { EveIcon, makeEveIcon } from "../../shell/EveIcon";
import { MobileToolShell, type MobileNavItem } from "../../shell/MobileToolShell";
import { TouchRow } from "../../shell/TouchRow";

type MobileView = "scope" | "browser" | "orders" | "history" | "graphs";
type BrowserMode = "market" | "saved";
type StationType = "all" | "npc" | "player";
type HistoryToggleKey = "average" | "range" | "volume" | "ma7" | "ma28";

type Item = { type_id: number; type_name: string };

type Region = {
  region_id: number;
  region_name: string;
  order_count: number;
  item_count: number;
};

type Bootstrap = {
  regions: Region[];
  top_region_ids: number[];
  plex_type_id: number;
  status: {
    orders_last_seen: string | null;
    order_count: number;
    live_item_count: number;
    history_last_date: string | null;
    history_row_count: number;
  };
};

type MarketTreeNode = {
  id: number;
  name: string;
  children?: MarketTreeNode[];
  types?: { type_id: number; name: string }[];
};

type BrowserRow = {
  type_id: number;
  type_name: string;
  market_group_id: number | null;
  market_group_name: string | null;
  volume_m3: number | null;
  best_sell: number | null;
  best_buy: number | null;
  spread: number | null;
  spread_pct: number | null;
  avg_price: number | null;
  delta_price: number | null;
  isk_day: number | null;
  vol_day: number | null;
  sell_volume: number | null;
  buy_volume: number | null;
  sell_orders: number | null;
  buy_orders: number | null;
  sparkline?: { date: string; avg_price: number | null }[];
};

type OrderRow = {
  order_id: number;
  type_id: number;
  region_id: number;
  region_name: string;
  system_id: number;
  system_name: string;
  location_id: number;
  station_name: string | null;
  location_name: string;
  station_type: "npc" | "player";
  is_buy_order: boolean;
  price: number | null;
  volume_remain: number | null;
  volume_m3: number | null;
  min_volume: number | null;
  range: number | null;
  issued: string;
  expires_at: string;
  reported_at: string;
  last_seen: string;
};

type OrdersResponse = {
  sellers: OrderRow[];
  buyers: OrderRow[];
  counts: {
    sell_count: number;
    buy_count: number;
    sell_volume: number;
    buy_volume: number;
    best_sell: number | null;
    best_buy: number | null;
    sell_median: number | null;
    buy_median: number | null;
  };
  depth: { side: "sell" | "buy"; price: number; volume: number }[];
};

type ItemSummary = BrowserRow & {
  breadcrumb: { id: number; name: string }[];
  sell_median: number | null;
  buy_median: number | null;
};

type HistoryRow = {
  date: string;
  region_id: number;
  region_name: string;
  type_id: number;
  low_price: number | null;
  high_price: number | null;
  avg_price: number | null;
  volume: number | null;
  orders: number | null;
  ma7: number | null;
  ma28: number | null;
};

type HistoryResponse = {
  days: number;
  rows: HistoryRow[];
  stats: {
    avg_price: number | null;
    vol_day: number | null;
    isk_day: number | null;
    first_date: string | null;
    last_date: string | null;
  };
};

type TickerRow = {
  type_id: number;
  type_name: string;
  lowest_sell: number | null;
  highest_buy: number | null;
  latest_avg_price: number | null;
  sell_vs_avg_pct: number | null;
};

type MarketQuickbarState = {
  version?: 1;
  quickbar?: unknown;
};

const PLEX_TYPE_ID = 44992;
const HISTORY_RANGES = [7, 14, 30, 90, 180, 365];
const TOP_REGION_ORDER = [10000002, 10000043, 10000042, 10000032, 10000030];
const QUICKBAR_STORAGE_KEY = "tt-market-quickbar";
const MARKET_QUICKBAR_STATE_TOOL_KEY = "market-browser-quickbar";
const TRADE_HUBS_ONLY_STORAGE_KEY = "tt-market-trade-hubs-only";
const DEPTH_STORAGE_KEY = "tt-market-depth-v3";
const NO_SCAM_STORAGE_KEY = "tt-market-no-scam";
const EMPTY_REGION_IDS: number[] = [];
const ACTIVE_BUTTON_CLASS = "mobile-market-button-active";
const ACTIVE_INPUT_CLASS = "mobile-market-input-active";

const TRADE_HUBS = [
  { region_id: 10000002, location_id: 60003760, name: "Jita 4-4" },
  { region_id: 10000043, location_id: 60008494, name: "Amarr VIII" },
  { region_id: 10000032, location_id: 60011866, name: "Dodixie IX" },
  { region_id: 10000030, location_id: 60004588, name: "Rens VI" },
  { region_id: 10000042, location_id: 60005686, name: "Hek VIII" },
];

const icons = {
  shell: makeEveIcon(marketIconRaw),
  scope: makeEveIcon(marketIconRaw),
  browser: makeEveIcon(searchMarketIconRaw),
  orders: makeEveIcon(walletIconRaw),
  history: makeEveIcon(journalIconRaw),
  graphs: makeEveIcon(trainingQueueIconRaw),
  saved: makeEveIcon(folderIconRaw),
  bookmarks: makeEveIcon(bookmarksIconRaw),
  market: makeEveIcon(marketIconRaw),
  browse: makeEveIcon(browserIconRaw),
  info: makeEveIcon(infoIconRaw),
};

const navItems: MobileNavItem<MobileView>[] = [
  { key: "scope", label: "Scope", icon: icons.scope },
  { key: "browser", label: "Browser", icon: icons.browser },
  { key: "orders", label: "Orders", icon: icons.orders },
  { key: "history", label: "History", icon: icons.history },
  { key: "graphs", label: "Graphs", icon: icons.graphs },
];

const chartColors = ["#53b6ff", "#3bbf5a", "#f59e0b", "#ff8b8b", "#a78bfa", "#22d3ee"];

function classNames(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

async function copyToClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection fallback below.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    try {
      return document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }
  } catch {
    return false;
  }
}

function normalizeQuickbar(raw: unknown): Item[] {
  const source = Array.isArray(raw) ? raw : [];
  const byTypeId = new Map<number, Item>();
  for (const item of source) {
    const row = item as Partial<Item> & { typeId?: unknown; typeName?: unknown };
    const typeId = Number(row.type_id ?? row.typeId);
    const typeName = String(row.type_name ?? row.typeName ?? "").trim();
    if (Number.isFinite(typeId) && typeId > 0 && typeName) {
      byTypeId.set(typeId, { type_id: typeId, type_name: typeName });
    }
  }
  return Array.from(byTypeId.values()).slice(0, 150);
}

function normalizeQuickbarState(raw: unknown): Item[] {
  const source = raw && typeof raw === "object" ? raw as MarketQuickbarState : {};
  return normalizeQuickbar(source.quickbar);
}

function normalizeTickerRow(row: TickerRow): TickerRow {
  return {
    ...row,
    type_id: Number(row.type_id),
    type_name: String(row.type_name || `Type ${row.type_id}`),
    lowest_sell: n(row.lowest_sell),
    highest_buy: n(row.highest_buy),
    latest_avg_price: n(row.latest_avg_price),
    sell_vs_avg_pct: n(row.sell_vs_avg_pct),
  };
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
  return data as T;
}

function n(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmtCompact(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 1 : digits)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : digits)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 1 : digits)}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtIsk(value: number | null | undefined, compact = true) {
  if (value == null || !Number.isFinite(value)) return "-";
  if (!compact) return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ISK`;
  return `${fmtCompact(value)} ISK`;
}

function fmtQty(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtM3(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${fmtCompact(value)} m3`;
}

function fmtPct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(Math.abs(value) >= 10 ? 1 : 2)}%`;
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

function fmtAgo(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const hours = Math.floor((Date.now() - date.getTime()) / 3_600_000);
  if (hours <= 0) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fmtExpires(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const hours = Math.floor((date.getTime() - Date.now()) / 3_600_000);
  if (hours <= 0) return "expired";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function rangeText(value: number | null | undefined) {
  if (value == null) return "-";
  if (value === -1) return "region";
  if (value === 32767) return "station";
  return `${value} jumps`;
}

function typeIconUrl(typeId: number, name?: string, size = 32) {
  const lower = typeof name === "string" ? name.toLowerCase() : "";
  if (lower.includes("plex")) return `https://images.evetech.net/types/${typeId}/icon?size=${size}`;
  return `https://images.evetech.net/types/${typeId}/icon?size=${size}`;
}

function onImgError(event: { currentTarget: HTMLImageElement }) {
  const element = event.currentTarget;
  if (element.dataset.fallback) return;
  element.dataset.fallback = "1";
  element.src = "https://images.evetech.net/types/34/icon?size=32";
}

function isPlex(item: Item | null) {
  return Number(item?.type_id) === PLEX_TYPE_ID;
}

function regionName(regions: Region[], id: number) {
  return regions.find((region) => Number(region.region_id) === Number(id))?.region_name || String(id);
}

function scopeLabel(regions: Region[], scopeRegions: number[]) {
  if (!scopeRegions.length) return "All Regions";
  return scopeRegions
    .map((id) => regionName(regions, id))
    .slice(0, 2)
    .join(", ") + (scopeRegions.length > 2 ? ` +${scopeRegions.length - 2}` : "");
}

function sameIds(left: number[], right: number[]) {
  return left.length === right.length && left.every((id, index) => Number(id) === Number(right[index]));
}

function buildRegionParam(regions: number[]) {
  return regions.length ? regions.join(",") : "";
}

function Delta({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) return <span>-</span>;
  return <span className={value >= 0 ? "text-[#3bbf5a]" : "text-[#ff8b8b]"}>{fmtPct(value)}</span>;
}

function SectionTitle({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="mb-2 grid grid-cols-[1fr,auto] items-center gap-2">
      <div className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-300">{title}</div>
      {right}
    </div>
  );
}

export default function MarketMobile() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<MobileView>("browser");
  const [browserMode, setBrowserMode] = useState<BrowserMode>("market");
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [tree, setTree] = useState<MarketTreeNode[]>([]);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [scopeRegions, setScopeRegions] = useState<number[]>(() => readJson<number[]>("tt-market-home-regions", []));
  const [tradeHubsOnly, setTradeHubsOnly] = useState<boolean>(() => readJson<boolean>(TRADE_HUBS_ONLY_STORAGE_KEY, false));
  const [noScam, setNoScam] = useState<boolean>(() => readJson<boolean>(NO_SCAM_STORAGE_KEY, false));
  const [showDepth, setShowDepth] = useState<boolean>(() => readJson<boolean>(DEPTH_STORAGE_KEY, true));
  const [stationType, setStationType] = useState<StationType>("all");
  const [selectedLocation, setSelectedLocation] = useState<number | null>(null);
  const [quickbar, setQuickbar] = useState<Item[]>(() => normalizeQuickbar(readJson<Item[]>(QUICKBAR_STORAGE_KEY, [])));
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [remoteQuickbarReady, setRemoteQuickbarReady] = useState(false);
  const [quickbarMsg, setQuickbarMsg] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [clearConfirm, setClearConfirm] = useState(false);
  const [ticker, setTicker] = useState<TickerRow[]>([]);
  const [itemSummary, setItemSummary] = useState<ItemSummary | null>(null);
  const [orders, setOrders] = useState<OrdersResponse | null>(null);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyStats, setHistoryStats] = useState<HistoryResponse["stats"] | null>(null);
  const [historyDays, setHistoryDays] = useState<number>(() => readJson<number>("tt-market-history-days", 90));
  const [historyToggles, setHistoryToggles] = useState<Record<HistoryToggleKey, boolean>>(() =>
    readJson<Record<HistoryToggleKey, boolean>>("tt-market-history-toggles", {
      average: true,
      range: true,
      volume: true,
      ma7: true,
      ma28: true,
    }),
  );
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState("");

  const plexSelected = isPlex(selected);
  const regions = useMemo(() => {
    const source = bootstrap?.regions || [];
    return [...source].sort((a, b) => {
      const ai = TOP_REGION_ORDER.indexOf(a.region_id);
      const bi = TOP_REGION_ORDER.indexOf(b.region_id);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.region_name.localeCompare(b.region_name);
    });
  }, [bootstrap]);
  const effectiveRegions = plexSelected ? EMPTY_REGION_IDS : scopeRegions;
  const tradeHubLocationIds = useMemo(() => {
    if (!tradeHubsOnly || plexSelected) return [];
    if (!effectiveRegions.length) return TRADE_HUBS.map((hub) => hub.location_id);
    const regionSet = new Set(effectiveRegions);
    return TRADE_HUBS.filter((hub) => regionSet.has(hub.region_id)).map((hub) => hub.location_id);
  }, [effectiveRegions, plexSelected, tradeHubsOnly]);
  const effectiveStationType: StationType = tradeHubsOnly && !plexSelected ? "npc" : stationType;
  const orderLocations = tradeHubLocationIds.length ? tradeHubLocationIds : selectedLocation ? [selectedLocation] : [];
  const locations = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of [...(orders?.sellers || []), ...(orders?.buyers || [])]) {
      if (row.location_id) map.set(row.location_id, row.location_name || `Location ${row.location_id}`);
    }
    for (const hub of TRADE_HUBS) map.set(hub.location_id, hub.name);
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [orders]);
  const visibleStats = useMemo(() => {
    const counts = orders?.counts;
    return {
      avg_price: historyStats?.avg_price ?? itemSummary?.avg_price ?? null,
      delta_price: itemSummary?.delta_price ?? null,
      isk_day: historyStats?.isk_day ?? itemSummary?.isk_day ?? null,
      vol_day: historyStats?.vol_day ?? itemSummary?.vol_day ?? null,
      best_sell: counts?.best_sell ?? itemSummary?.best_sell ?? null,
      best_buy: counts?.best_buy ?? itemSummary?.best_buy ?? null,
      spread:
        counts?.best_buy != null && counts?.best_sell != null
          ? counts.best_buy - counts.best_sell
          : itemSummary?.spread ?? null,
      sell_orders: counts?.sell_count ?? itemSummary?.sell_orders ?? null,
      buy_orders: counts?.buy_count ?? itemSummary?.buy_orders ?? null,
      sell_volume: counts?.sell_volume ?? itemSummary?.sell_volume ?? null,
      buy_volume: counts?.buy_volume ?? itemSummary?.buy_volume ?? null,
    };
  }, [historyStats, itemSummary, orders]);

  const subtitle = selected
    ? `${selected.type_name} - ${plexSelected ? "Global PLEX" : scopeLabel(regions, scopeRegions)}`
    : `${scopeLabel(regions, scopeRegions)} - ${bootstrap?.status.live_item_count?.toLocaleString() || "live"} items`;

  useLayoutEffect(() => {
    document.querySelector<HTMLElement>("[data-mobile-scroll-root]")?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [browserMode, view]);

  useEffect(() => writeJson("tt-market-home-regions", scopeRegions), [scopeRegions]);
  useEffect(() => writeJson(TRADE_HUBS_ONLY_STORAGE_KEY, tradeHubsOnly), [tradeHubsOnly]);
  useEffect(() => writeJson(NO_SCAM_STORAGE_KEY, noScam), [noScam]);
  useEffect(() => writeJson(DEPTH_STORAGE_KEY, showDepth), [showDepth]);
  useEffect(() => writeJson("tt-market-history-days", historyDays), [historyDays]);
  useEffect(() => writeJson("tt-market-history-toggles", historyToggles), [historyToggles]);
  useEffect(() => writeJson(QUICKBAR_STORAGE_KEY, quickbar), [quickbar]);

  useEffect(() => {
    if (!tradeHubsOnly || plexSelected) return;
    setStationType((current) => current === "npc" ? current : "npc");
    setSelectedLocation(null);
  }, [plexSelected, tradeHubsOnly]);

  useEffect(() => {
    let alive = true;
    async function loadAuth() {
      try {
        const data = await apiJson<{ ok: boolean; authenticated: boolean; user: AuthUser | null }>("/api/auth/me", {
          credentials: "include",
        });
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
        setAuthUser(detail.user as AuthUser | null);
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
    if (!authChecked) return;
    if (!authUser) {
      setRemoteQuickbarReady(false);
      setQuickbar(normalizeQuickbar(readJson<Item[]>(QUICKBAR_STORAGE_KEY, [])));
      return;
    }
    let alive = true;
    async function loadRemoteQuickbar() {
      try {
        const data = await apiJson<{ ok: boolean; stateJson?: unknown }>(`/api/tool-state/${MARKET_QUICKBAR_STATE_TOOL_KEY}`, {
          credentials: "include",
        });
        const remote = normalizeQuickbarState(data.stateJson);
        if (alive && remote.length) setQuickbar(remote);
        if (alive) setRemoteQuickbarReady(true);
      } catch {
        if (alive) setRemoteQuickbarReady(false);
      }
    }
    void loadRemoteQuickbar();
    return () => {
      alive = false;
    };
  }, [authChecked, authUser]);

  useEffect(() => {
    if (!authUser || !remoteQuickbarReady) return;
    const snapshot: MarketQuickbarState = { version: 1, quickbar };
    const timer = window.setTimeout(() => {
      void fetch(`/api/tool-state/${MARKET_QUICKBAR_STATE_TOOL_KEY}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateJson: snapshot }),
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [authUser, quickbar, remoteQuickbarReady]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiJson<Bootstrap>("/api/market/browser/bootstrap"),
      apiJson<MarketTreeNode[]>("/api/market/tree"),
    ])
      .then(([boot, treeData]) => {
        if (!alive) return;
        setBootstrap(boot);
        setTree(treeData || []);
      })
      .catch((err) => alive && setError((err as Error).message || "Market bootstrap failed."));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const typeId = Number(searchParams.get("type_id") || searchParams.get("typeId") || 0);
    if (!typeId || selected?.type_id === typeId) return;
    const controller = new AbortController();
    apiJson<ItemSummary>(`/api/market/browser/item/${typeId}`, { signal: controller.signal })
      .then((data) => {
        const item = { type_id: typeId, type_name: data?.type_name || `Type ${typeId}` };
        setSelected(item);
        setView("orders");
      })
      .catch(() => {});
    return () => controller.abort();
  }, [searchParams, selected?.type_id]);

  useEffect(() => {
    if (search.trim().length < 2) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      apiJson<Item[]>(`/api/market/items?q=${encodeURIComponent(search.trim())}`, { signal: controller.signal })
        .then((data) => setItems(data || []))
        .catch(() => setItems([]));
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  useEffect(() => {
    if (!selected) {
      setItemSummary(null);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (effectiveRegions.length) params.set("regions", buildRegionParam(effectiveRegions));
    if (noScam) params.set("no_scam", "1");
    setLoadingSummary(true);
    apiJson<ItemSummary>(`/api/market/browser/item/${selected.type_id}?${params.toString()}`, { signal: controller.signal })
      .then(setItemSummary)
      .catch(() => setItemSummary(null))
      .finally(() => setLoadingSummary(false));
    return () => controller.abort();
  }, [effectiveRegions, noScam, selected]);

  useEffect(() => {
    if (!selected) {
      setOrders(null);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      limit: "100",
      side: "both",
      station_type: effectiveStationType,
      no_scam: noScam ? "1" : "0",
    });
    if (effectiveRegions.length) params.set("regions", buildRegionParam(effectiveRegions));
    if (orderLocations.length) params.set("locations", orderLocations.join(","));
    setLoadingOrders(true);
    apiJson<OrdersResponse>(`/api/market/browser/item/${selected.type_id}/orders?${params.toString()}`, { signal: controller.signal })
      .then(setOrders)
      .catch(() => setOrders(null))
      .finally(() => setLoadingOrders(false));
    return () => controller.abort();
  }, [effectiveRegions, effectiveStationType, noScam, orderLocations.join(","), selected]);

  useEffect(() => {
    if (!selected) {
      setHistoryRows([]);
      setHistoryStats(null);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ days: String(historyDays) });
    if (effectiveRegions.length) params.set("regions", buildRegionParam(effectiveRegions));
    setLoadingHistory(true);
    apiJson<HistoryResponse>(`/api/market/browser/item/${selected.type_id}/history?${params.toString()}`, { signal: controller.signal })
      .then((data) => {
        setHistoryRows(data.rows || []);
        setHistoryStats(data.stats || null);
      })
      .catch(() => {
        setHistoryRows([]);
        setHistoryStats(null);
      })
      .finally(() => setLoadingHistory(false));
    return () => controller.abort();
  }, [effectiveRegions, historyDays, selected]);

  useEffect(() => {
    if (!quickbar.length) {
      setTicker([]);
      return;
    }
    const ids = quickbar.map((item) => item.type_id).slice(0, 120);
    const params = new URLSearchParams({ type_ids: ids.join(",") });
    if (scopeRegions.length) params.set("regions", scopeRegions.join(","));
    let alive = true;
    const load = () => {
      apiJson<{ rows: TickerRow[] }>(`/api/market/browser/ticker?${params.toString()}`)
        .then((data) => alive && setTicker((data.rows || []).map(normalizeTickerRow)))
        .catch(() => alive && setTicker([]));
    };
    load();
    const interval = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
  }, [quickbar, scopeRegions]);

  function selectItem(item: Item, nextView: MobileView = "orders") {
    setSelected(item);
    setItems([]);
    setSelectedLocation(null);
    const next = new URLSearchParams(searchParams);
    next.set("type_id", String(item.type_id));
    setSearchParams(next);
    setView(nextView);
  }

  function toggleFavorite(item: Item) {
    const exists = quickbar.some((row) => row.type_id === item.type_id);
    setQuickbar((current) => exists
      ? current.filter((row) => row.type_id !== item.type_id)
      : [{ type_id: item.type_id, type_name: item.type_name }, ...current].slice(0, 150));
  }

  async function importQuickbar() {
    try {
      const data = await apiJson<{ resolved: Array<{ type_id: number; type_name: string }>; not_found: string[] }>("/api/market/browser/quickbar/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: bulkText }),
      });
      const existing = new Set(quickbar.map((row) => row.type_id));
      const added = (data.resolved || [])
        .filter((row) => !existing.has(row.type_id))
        .map((row) => ({ type_id: row.type_id, type_name: row.type_name }));
      setQuickbar((current) => [...added, ...current].slice(0, 150));
      setQuickbarMsg(`Added ${added.length}${data.not_found?.length ? `, missed ${data.not_found.length}` : ""}`);
      setBulkText("");
      setPasteOpen(false);
    } catch (err) {
      setQuickbarMsg((err as Error).message || "Import failed.");
    }
  }

  return (
    <MobileToolShell
      title="Market Browser"
      subtitle={subtitle}
      icon={icons.shell}
      navItems={navItems}
      activeView={view}
      onView={setView}
    >
      <style>{`
        .mobile-market-button {
          display: inline-flex;
          min-height: 2rem;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
          border: 1px solid #303236;
          background: #05070b;
          padding: 0 0.375rem;
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: #cbd5e1;
        }
        .mobile-market-button-active {
          border-color: #3f8fc0;
          background: #0b2233;
          color: #dff3ff;
          box-shadow: 0 0 8px rgba(70, 178, 255, 0.16), inset 0 0 0 1px rgba(83, 182, 255, 0.12);
        }
        .mobile-market-input {
          min-height: 2.35rem;
          border: 1px solid #303236;
          background: #05070b;
          padding: 0.25rem 0.5rem;
          font-size: 16px;
          line-height: 1.25;
          color: #f8fafc;
          outline: none;
        }
        .mobile-market-input-active {
          border-color: #3f8fc0;
          background: #071522;
          color: #dff3ff;
          box-shadow: inset 0 0 0 1px rgba(83, 182, 255, 0.12);
        }
      `}</style>

      {error && (
        <div className="mb-1.5 border border-[#6b2b32] bg-[#1d090b] px-2 py-1.5 text-[12px] text-[#ffaaaa]">
          {error}
        </div>
      )}

      {view === "scope" && (
        <ScopeView
          bootstrap={bootstrap}
          regions={regions}
          selected={selected}
          scopeRegions={scopeRegions}
          setScopeRegions={setScopeRegions}
          tradeHubsOnly={tradeHubsOnly}
          setTradeHubsOnly={(next) => {
            setTradeHubsOnly(next);
            if (next) {
              setStationType("npc");
              setSelectedLocation(null);
            }
          }}
          noScam={noScam}
          setNoScam={setNoScam}
          stationType={effectiveStationType}
          setStationType={setStationType}
          selectedLocation={selectedLocation}
          setSelectedLocation={setSelectedLocation}
          locations={locations}
        />
      )}

      {view === "browser" && (
        <BrowserView
          mode={browserMode}
          setMode={setBrowserMode}
          search={search}
          setSearch={setSearch}
          items={items}
          tree={tree}
          expanded={expanded}
          setExpanded={setExpanded}
          quickbar={quickbar}
          ticker={ticker}
          selected={selected}
          authChecked={authChecked}
          authUser={authUser}
          remoteQuickbarReady={remoteQuickbarReady}
          quickbarMsg={quickbarMsg}
          clearConfirm={clearConfirm}
          setClearConfirm={setClearConfirm}
          onSelect={selectItem}
          toggleFavorite={toggleFavorite}
          removeQuickbar={(id) => setQuickbar((current) => current.filter((row) => row.type_id !== id))}
          clearQuickbar={() => {
            setQuickbar([]);
            setClearConfirm(false);
            setQuickbarMsg("Quickbar cleared");
          }}
          openPaste={() => setPasteOpen(true)}
          signIn={() => requestSiteAuthModal("login")}
        />
      )}

      {view === "orders" && (
        <OrdersView
          selected={selected}
          summary={itemSummary}
          visibleStats={visibleStats}
          orders={orders}
          loadingSummary={loadingSummary}
          loadingOrders={loadingOrders}
          favorite={!!selected && quickbar.some((item) => item.type_id === selected.type_id)}
          onFavorite={() => selected && toggleFavorite(selected)}
          onBrowser={() => setView("browser")}
        />
      )}

      {view === "history" && (
        <HistoryView
          selected={selected}
          rows={historyRows}
          stats={historyStats}
          days={historyDays}
          setDays={setHistoryDays}
          loading={loadingHistory}
          onBrowser={() => setView("browser")}
        />
      )}

      {view === "graphs" && (
        <GraphsView
          selected={selected}
          rows={historyRows}
          stats={historyStats}
          days={historyDays}
          setDays={setHistoryDays}
          toggles={historyToggles}
          setToggles={setHistoryToggles}
          orders={orders}
          loadingOrders={loadingOrders}
          showDepth={showDepth}
          setShowDepth={setShowDepth}
          loading={loadingHistory}
          onBrowser={() => setView("browser")}
        />
      )}

      {pasteOpen && (
        <BottomSheet title="Paste Saved Items" subtitle="Resolve item names into your market quickbar" onClose={() => setPasteOpen(false)}>
          <div className="space-y-2 p-2">
            <textarea
              className="mobile-market-input min-h-[160px] w-full resize-none"
              value={bulkText}
              onChange={(event) => setBulkText(event.target.value)}
              placeholder="Paste item names, fits, hangar lists, or comma-separated text..."
            />
            <button type="button" className="mobile-market-button min-h-9 w-full border-[#46b2ff]/70 text-[#dff3ff]" onClick={() => void importQuickbar()}>
              Resolve and Add
            </button>
          </div>
        </BottomSheet>
      )}
    </MobileToolShell>
  );
}

function ScopeView({
  bootstrap,
  regions,
  selected,
  scopeRegions,
  setScopeRegions,
  tradeHubsOnly,
  setTradeHubsOnly,
  noScam,
  setNoScam,
  stationType,
  setStationType,
  selectedLocation,
  setSelectedLocation,
  locations,
}: {
  bootstrap: Bootstrap | null;
  regions: Region[];
  selected: Item | null;
  scopeRegions: number[];
  setScopeRegions: (regions: number[]) => void;
  tradeHubsOnly: boolean;
  setTradeHubsOnly: (value: boolean) => void;
  noScam: boolean;
  setNoScam: (value: boolean) => void;
  stationType: StationType;
  setStationType: (value: StationType) => void;
  selectedLocation: number | null;
  setSelectedLocation: (value: number | null) => void;
  locations: { id: number; name: string }[];
}) {
  const plex = isPlex(selected);
  const allRegionsActive = scopeRegions.length === 0;
  const topRegionsActive = sameIds(scopeRegions, TOP_REGION_ORDER);
  const jitaActive = sameIds(scopeRegions, [10000002]);
  return (
    <div className="space-y-1.5">
      <section className="border border-[#2c2f36] bg-[#070910] p-2">
        <SectionTitle title="Market Scope" />
        <div className="grid grid-cols-3 gap-1">
          <button type="button" className={classNames("mobile-market-button min-h-9", allRegionsActive && ACTIVE_BUTTON_CLASS)} onClick={() => setScopeRegions([])}>
            All
          </button>
          <button type="button" className={classNames("mobile-market-button min-h-9", topRegionsActive && ACTIVE_BUTTON_CLASS)} onClick={() => setScopeRegions(TOP_REGION_ORDER)}>
            Top
          </button>
          <button type="button" className={classNames("mobile-market-button min-h-9", jitaActive && ACTIVE_BUTTON_CLASS)} onClick={() => setScopeRegions([10000002])}>
            Jita
          </button>
        </div>
        <label className="mt-2 block">
          <span className="mb-1 block text-[9px] uppercase tracking-widest text-slate-500">Regions</span>
          <select
            multiple
            size={6}
            className="mobile-market-input min-h-[150px] w-full text-[13px]"
            value={scopeRegions.map(String)}
            disabled={plex}
            onChange={(event) => setScopeRegions(Array.from(event.currentTarget.selectedOptions).map((option) => Number(option.value)))}
          >
            {regions.map((region) => (
              <option key={region.region_id} value={region.region_id}>
                {region.region_name}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-2 text-[11px] leading-snug text-slate-500">
          {plex ? "PLEX ignores regional scope and always uses global market context." : `Active: ${scopeLabel(regions, scopeRegions)}`}
        </div>
      </section>

      <section className="border border-[#2c2f36] bg-[#070910] p-2">
        <SectionTitle title="Order Filters" />
        <div className="grid grid-cols-3 gap-1">
          <ToggleButton active={tradeHubsOnly} disabled={plex} onClick={() => setTradeHubsOnly(!tradeHubsOnly)}>
            Hubs Only
          </ToggleButton>
          <ToggleButton active={noScam} onClick={() => setNoScam(!noScam)}>
            No Scam
          </ToggleButton>
          <button type="button" className="mobile-market-button min-h-9" onClick={() => {
            setSelectedLocation(null);
            setStationType("all");
          }}>
            Reset
          </button>
        </div>
        <label className="mt-2 block">
          <span className="mb-1 block text-[9px] uppercase tracking-widest text-slate-500">Station Type</span>
          <select
            className={classNames("mobile-market-input w-full", !tradeHubsOnly && !plex && stationType !== "all" && ACTIVE_INPUT_CLASS)}
            value={stationType}
            disabled={tradeHubsOnly || plex}
            onChange={(event) => setStationType(event.target.value as StationType)}
          >
            <option value="all">NPC + Player stations</option>
            <option value="npc">NPC stations</option>
            <option value="player">Player structures</option>
          </select>
        </label>
        <label className="mt-2 block">
          <span className="mb-1 block text-[9px] uppercase tracking-widest text-slate-500">Location</span>
          <select
            className={classNames("mobile-market-input w-full", !tradeHubsOnly && !plex && selectedLocation !== null && ACTIVE_INPUT_CLASS)}
            value={selectedLocation ?? ""}
            disabled={tradeHubsOnly || plex}
            onChange={(event) => setSelectedLocation(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Any location</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>{location.name}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="border border-[#2c2f36] bg-[#070910] p-2">
        <SectionTitle title="Data Status" />
        <div className="grid grid-cols-2 gap-px bg-[#151922] p-px">
          <MetricTile label="Orders" value={bootstrap?.status.orders_last_seen ? fmtAgo(bootstrap.status.orders_last_seen) : "unknown"} />
          <MetricTile label="History" value={bootstrap?.status.history_last_date ? fmtDate(bootstrap.status.history_last_date) : "unknown"} />
          <MetricTile label="Live Items" value={bootstrap?.status.live_item_count?.toLocaleString() || "-"} />
          <MetricTile label="Order Rows" value={bootstrap?.status.order_count?.toLocaleString() || "-"} />
        </div>
      </section>
    </div>
  );
}

function BrowserView(props: {
  mode: BrowserMode;
  setMode: (mode: BrowserMode) => void;
  search: string;
  setSearch: (value: string) => void;
  items: Item[];
  tree: MarketTreeNode[];
  expanded: Record<number, boolean>;
  setExpanded: Dispatch<SetStateAction<Record<number, boolean>>>;
  quickbar: Item[];
  ticker: TickerRow[];
  selected: Item | null;
  authChecked: boolean;
  authUser: AuthUser | null;
  remoteQuickbarReady: boolean;
  quickbarMsg: string;
  clearConfirm: boolean;
  setClearConfirm: (value: boolean) => void;
  onSelect: (item: Item, view?: MobileView) => void;
  toggleFavorite: (item: Item) => void;
  removeQuickbar: (id: number) => void;
  clearQuickbar: () => void;
  openPaste: () => void;
  signIn: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 border border-[#303236] bg-[#05070b]">
        <button
          type="button"
          className={classNames("min-h-9 text-[10px] uppercase tracking-widest", props.mode === "market" && ACTIVE_BUTTON_CLASS)}
          onClick={() => props.setMode("market")}
        >
          Market
        </button>
        <button
          type="button"
          className={classNames("min-h-9 text-[10px] uppercase tracking-widest", props.mode === "saved" && ACTIVE_BUTTON_CLASS)}
          onClick={() => props.setMode("saved")}
        >
          Saved
        </button>
      </div>
      {props.mode === "market" ? <MarketBrowserPane {...props} /> : <SavedItemsPane {...props} />}
    </div>
  );
}

function MarketBrowserPane(props: Parameters<typeof BrowserView>[0]) {
  return (
    <div className="space-y-1.5">
      <section className="border border-[#2c2f36] bg-[#070910] p-2">
        <SectionTitle title="Find Item" />
        <input
          className="mobile-market-input w-full"
          value={props.search}
          onChange={(event) => props.setSearch(event.target.value)}
          placeholder="Search item..."
        />
        {props.items.length > 0 && (
          <div className="mt-2 max-h-[260px] overflow-y-auto border border-[#303236] bg-[#05070b]">
            {props.items.slice(0, 30).map((item) => (
              <TouchRow
                key={item.type_id}
                title={item.type_name}
                subtitle={`type ${item.type_id}`}
                icon={<ItemIcon item={item} />}
                onClick={() => props.onSelect(item)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="border border-[#2c2f36] bg-[#070910]">
        <div className="border-b border-[#151922] p-2">
          <SectionTitle title="Market Browser" />
        </div>
        <div className="divide-y divide-[#151922]">
          {props.tree.length === 0 ? (
            <div className="px-2 py-3 text-[12px] text-slate-500">Loading categories...</div>
          ) : (
            props.tree.map((node) => (
              <CategoryNode
                key={node.id}
                node={node}
                depth={0}
                expanded={props.expanded}
                setExpanded={props.setExpanded}
                onSelect={props.onSelect}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function CategoryNode({
  node,
  depth,
  expanded,
  setExpanded,
  onSelect,
}: {
  node: MarketTreeNode;
  depth: number;
  expanded: Record<number, boolean>;
  setExpanded: Dispatch<SetStateAction<Record<number, boolean>>>;
  onSelect: (item: Item, view?: MobileView) => void;
}) {
  const hasChildren = !!((node.children && node.children.length) || (node.types && node.types.length));
  const isExpanded = !!expanded[node.id];
  return (
    <div>
      <button
        type="button"
        className="grid min-h-8 w-full grid-cols-[18px,1fr] items-center gap-1 px-2 text-left text-[12px] text-slate-300 active:bg-[#101b27]"
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => {
          if (hasChildren) setExpanded((current) => ({ ...current, [node.id]: !current[node.id] }));
        }}
      >
        <span className="font-mono text-slate-500">{hasChildren ? (isExpanded ? "v" : ">") : "."}</span>
        <span className="truncate">{node.name}</span>
      </button>
      {isExpanded && node.children?.map((child) => (
        <CategoryNode
          key={child.id}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          setExpanded={setExpanded}
          onSelect={onSelect}
        />
      ))}
      {isExpanded && node.types?.slice(0, 80).map((type) => (
        <button
          type="button"
          key={type.type_id}
          className="grid min-h-8 w-full grid-cols-[24px,1fr] items-center gap-2 px-2 text-left text-[12px] text-slate-300 active:bg-[#101b27]"
          style={{ paddingLeft: 22 + depth * 12 }}
          onClick={() => onSelect({ type_id: type.type_id, type_name: type.name })}
        >
          <img src={typeIconUrl(type.type_id, type.name, 32)} alt="" className="h-5 w-5" loading="lazy" onError={onImgError} />
          <span className="truncate">{type.name}</span>
        </button>
      ))}
    </div>
  );
}

function SavedItemsPane(props: Parameters<typeof BrowserView>[0]) {
  const tickerById = new Map(props.ticker.map((row) => [row.type_id, row]));
  return (
    <div className="space-y-1.5">
      <section className="border border-[#2c2f36] bg-[#070910] p-2">
        <SectionTitle title="Saved Items" />
        <div className="grid grid-cols-3 gap-1">
          <button type="button" className="mobile-market-button min-h-9" onClick={props.openPaste}>
            Paste
          </button>
          <button type="button" className="mobile-market-button min-h-9" onClick={() => {
            void navigator.clipboard?.writeText(props.quickbar.map((item) => item.type_name).join("\n"));
          }}>
            Export
          </button>
          <button type="button" className={classNames("mobile-market-button min-h-9", props.clearConfirm && "border-[#6b2b32] text-[#ffaaaa]")} onClick={() => props.clearConfirm ? props.clearQuickbar() : props.setClearConfirm(true)}>
            {props.clearConfirm ? "Confirm" : "Clear"}
          </button>
        </div>
        <div className="mt-2 border border-[#20242c] bg-[#05070b] px-2 py-1.5 text-[11px] text-slate-400">
          {!props.authChecked ? "Checking account sync..." : props.authUser ? (props.remoteQuickbarReady ? "Account quickbar syncing." : "Loading account quickbar...") : (
            <button type="button" className="text-[#8bd3ff]" onClick={props.signIn}>Sign in to sync saved items.</button>
          )}
        </div>
        {props.quickbarMsg && <div className="mt-2 text-[11px] text-[#8bd3ff]">{props.quickbarMsg}</div>}
      </section>

      <section className="border border-[#2c2f36] bg-[#070910]">
        {props.quickbar.length === 0 ? (
          <div className="px-2 py-3 text-[12px] text-slate-500">Star items from the market browser to save them here.</div>
        ) : (
          props.quickbar.map((item) => {
            const ticker = tickerById.get(item.type_id);
            return (
              <div key={item.type_id} className="grid grid-cols-[1fr,26px] items-center border-b border-[#151922]">
                <button type="button" className="min-w-0 text-left" onClick={() => props.onSelect(item)}>
                  <div className="grid grid-cols-[34px,1fr] gap-2 px-2 py-2">
                    <ItemIcon item={item} />
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-slate-100">{item.type_name}</div>
                      <div className="mt-1 grid grid-cols-3 gap-1 font-mono text-[10px]">
                        <span className="text-slate-400">Sell {fmtIsk(ticker?.lowest_sell)}</span>
                        <span className="text-slate-400">Buy {fmtIsk(ticker?.highest_buy)}</span>
                        <span className={ticker?.sell_vs_avg_pct != null && ticker.sell_vs_avg_pct >= 0 ? "text-[#3bbf5a]" : "text-[#ff8b8b]"}>
                          {fmtPct(ticker?.sell_vs_avg_pct)}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
                <button type="button" className="h-full text-slate-500 active:text-slate-100" onClick={() => props.removeQuickbar(item.type_id)}>
                  x
                </button>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

function OrdersView({
  selected,
  summary,
  visibleStats,
  orders,
  loadingSummary,
  loadingOrders,
  favorite,
  onFavorite,
  onBrowser,
}: {
  selected: Item | null;
  summary: ItemSummary | null;
  visibleStats: Record<string, number | null>;
  orders: OrdersResponse | null;
  loadingSummary: boolean;
  loadingOrders: boolean;
  favorite: boolean;
  onFavorite: () => void;
  onBrowser: () => void;
}) {
  if (!selected) return <NoSelectedItem onBrowser={onBrowser} />;
  return (
    <div className="space-y-1.5">
      <SelectedItemHeader item={selected} summary={summary} favorite={favorite} onFavorite={onFavorite} />
      {loadingSummary && <div className="border border-[#2c2f36] bg-[#070910] px-2 py-2 text-[12px] text-slate-500">Loading item summary...</div>}
      <StatsGrid stats={visibleStats} />
      <OrderList title="Sell Orders" side="sell" rows={orders?.sellers || []} loading={loadingOrders} plex={isPlex(selected)} />
      <OrderList title="Buy Orders" side="buy" rows={orders?.buyers || []} loading={loadingOrders} plex={isPlex(selected)} />
    </div>
  );
}

function HistoryView({
  selected,
  rows,
  stats,
  days,
  setDays,
  loading,
  onBrowser,
}: {
  selected: Item | null;
  rows: HistoryRow[];
  stats: HistoryResponse["stats"] | null;
  days: number;
  setDays: (days: number) => void;
  loading: boolean;
  onBrowser: () => void;
}) {
  if (!selected) return <NoSelectedItem onBrowser={onBrowser} />;
  const sorted = [...rows].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return (
    <div className="space-y-1.5">
      <SelectedItemHeader item={selected} />
      <RangePicker days={days} setDays={setDays} />
      <section className="border border-[#2c2f36] bg-[#070910]">
        <div className="border-b border-[#151922] p-2">
          <SectionTitle title="History Summary" />
          <div className="grid grid-cols-3 gap-px bg-[#151922] p-px">
            <MetricTile label="Average" value={fmtIsk(stats?.avg_price)} />
            <MetricTile label="Vol/day" value={fmtQty(stats?.vol_day)} />
            <MetricTile label="ISK/day" value={fmtIsk(stats?.isk_day)} />
          </div>
        </div>
        {loading ? (
          <div className="px-2 py-3 text-[12px] text-slate-500">Loading history...</div>
        ) : sorted.length === 0 ? (
          <div className="px-2 py-3 text-[12px] text-slate-500">No history rows for this scope.</div>
        ) : (
          <div className="divide-y divide-[#151922]">
            {sorted.map((row) => <HistoryRowCard key={`${row.date}-${row.region_id}`} row={row} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function GraphsView({
  selected,
  rows,
  stats,
  days,
  setDays,
  toggles,
  setToggles,
  orders,
  loadingOrders,
  showDepth,
  setShowDepth,
  loading,
  onBrowser,
}: {
  selected: Item | null;
  rows: HistoryRow[];
  stats: HistoryResponse["stats"] | null;
  days: number;
  setDays: (days: number) => void;
  toggles: Record<HistoryToggleKey, boolean>;
  setToggles: Dispatch<SetStateAction<Record<HistoryToggleKey, boolean>>>;
  orders: OrdersResponse | null;
  loadingOrders: boolean;
  showDepth: boolean;
  setShowDepth: (value: boolean) => void;
  loading: boolean;
  onBrowser: () => void;
}) {
  const regionMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of rows) map.set(row.region_id, row.region_name);
    return map;
  }, [rows]);
  const regionIds = useMemo(() => Array.from(regionMap.keys()).sort((a, b) => (regionMap.get(a) || "").localeCompare(regionMap.get(b) || "")), [regionMap]);
  const singleRegion = regionIds.length <= 1;
  const chartData = useMemo(() => {
    const byDate = new Map<string, Record<string, string | number | null>>();
    for (const row of rows) {
      const key = fmtDate(row.date);
      const entry = byDate.get(key) || { date: key, volume_total: 0 };
      if (singleRegion) {
        entry.avg = row.avg_price;
        entry.low = row.low_price;
        entry.high = row.high_price;
        entry.ma7 = row.ma7;
        entry.ma28 = row.ma28;
      } else {
        entry[`avg_${row.region_id}`] = row.avg_price;
        entry[`ma7_${row.region_id}`] = row.ma7;
        entry[`ma28_${row.region_id}`] = row.ma28;
      }
      entry.volume_total = Number(entry.volume_total || 0) + Number(row.volume || 0);
      byDate.set(key, entry);
    }
    return Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [rows, singleRegion]);
  if (!selected) return <NoSelectedItem onBrowser={onBrowser} />;
  return (
    <div className="space-y-1.5">
      <SelectedItemHeader item={selected} />
      <RangePicker days={days} setDays={setDays} />
      <section className="border border-[#2c2f36] bg-[#070910] p-2">
        <SectionTitle title="Graph Layers" right={<span className="font-mono text-[10px] text-slate-500">{fmtIsk(stats?.avg_price)}</span>} />
        <div className="grid grid-cols-3 gap-1">
          <ToggleButton active={showDepth} onClick={() => setShowDepth(!showDepth)}>
            Depth
          </ToggleButton>
          {([
            ["average", "Average"],
            ["range", "High/Low"],
            ["volume", "Volume"],
            ["ma7", "7D MA"],
            ["ma28", "28D MA"],
          ] as Array<[HistoryToggleKey, string]>).map(([key, label]) => (
            <ToggleButton key={key} active={toggles[key]} onClick={() => setToggles((current) => ({ ...current, [key]: !current[key] }))}>
              {label}
            </ToggleButton>
          ))}
        </div>
      </section>
      <section className="h-[360px] border border-[#2c2f36] bg-[#070910] p-2">
        {loading ? (
          <div className="text-[12px] text-slate-500">Loading graph...</div>
        ) : chartData.length === 0 ? (
          <div className="text-[12px] text-slate-500">No graph data for this scope.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 6, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="#242733" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#7f8798" tick={{ fontSize: 9 }} minTickGap={18} />
              <YAxis yAxisId="price" stroke="#7f8798" tick={{ fontSize: 9 }} tickFormatter={(value: number) => fmtCompact(value, 1)} width={44} />
              <YAxis yAxisId="volume" orientation="right" stroke="#4b5563" tick={{ fontSize: 9 }} tickFormatter={(value: number) => fmtCompact(value, 1)} width={38} />
              <Tooltip content={<HistoryTooltip regionMap={regionMap} singleRegion={singleRegion} />} />
              {toggles.volume && <Bar yAxisId="volume" dataKey="volume_total" name="Volume" fill="#253348" opacity={0.75} />}
              {singleRegion && toggles.range && (
                <>
                  <Line yAxisId="price" type="monotone" dataKey="high" name="High" stroke="#7f8798" dot={false} strokeWidth={1} />
                  <Line yAxisId="price" type="monotone" dataKey="low" name="Low" stroke="#7f8798" dot={false} strokeWidth={1} />
                </>
              )}
              {singleRegion ? (
                <>
                  {toggles.average && <Line yAxisId="price" type="monotone" dataKey="avg" name="Average" stroke="#53b6ff" dot={false} strokeWidth={2} />}
                  {toggles.ma7 && <Line yAxisId="price" type="monotone" dataKey="ma7" name="7D MA" stroke="#3bbf5a" dot={false} strokeWidth={1.5} />}
                  {toggles.ma28 && <Line yAxisId="price" type="monotone" dataKey="ma28" name="28D MA" stroke="#f59e0b" dot={false} strokeWidth={1.5} />}
                </>
              ) : (
                regionIds.slice(0, 6).map((regionId, index) => (
                  <Line
                    key={regionId}
                    yAxisId="price"
                    type="monotone"
                    dataKey={`avg_${regionId}`}
                    name={regionMap.get(regionId) || String(regionId)}
                    stroke={chartColors[index % chartColors.length]}
                    dot={false}
                    strokeWidth={1.8}
                  />
                ))
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </section>
      {showDepth && (
        loadingOrders ? (
          <section className="border border-[#2c2f36] bg-[#070910] p-2">
            <SectionTitle title="Order Depth" />
            <div className="border border-[#303236] bg-[#05070b] px-2 py-3 text-[12px] text-slate-500">Loading depth...</div>
          </section>
        ) : (
          <DepthPanel levels={orders?.depth || []} />
        )
      )}
    </div>
  );
}

function SelectedItemHeader({
  item,
  summary,
  favorite,
  onFavorite,
}: {
  item: Item;
  summary?: ItemSummary | null;
  favorite?: boolean;
  onFavorite?: () => void;
}) {
  const breadcrumb = summary?.breadcrumb?.map((crumb) => crumb.name).join(" / ");
  const marketLink = typeof window !== "undefined" ? `${window.location.origin}/market?type_id=${item.type_id}` : `/market?type_id=${item.type_id}`;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  async function handleCopyLink() {
    const ok = await copyToClipboard(marketLink);
    setCopyState(ok ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 1400);
  }
  return (
    <section className="border border-[#2c2f36] bg-[#070910] p-2">
      <div className="grid grid-cols-[42px,1fr,34px] items-center gap-2">
        <img src={typeIconUrl(item.type_id, item.type_name, 64)} alt="" className="h-10 w-10" loading="lazy" onError={onImgError} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-slate-100">{item.type_name}</div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
            #{item.type_id}{breadcrumb ? ` - ${breadcrumb}` : ""}
          </div>
        </div>
        {onFavorite && (
          <button
            type="button"
            className={classNames("mobile-market-button h-9 min-h-9 px-0", favorite && ACTIVE_BUTTON_CLASS)}
            onClick={onFavorite}
            title={favorite ? "Remove from saved items" : "Save item"}
            aria-label={favorite ? "Remove from saved items" : "Save item"}
          >
            <Star size={16} fill={favorite ? "#f8fafc" : "none"} />
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1">
        <button
          type="button"
          className={classNames("mobile-market-button min-h-8", copyState === "copied" && ACTIVE_BUTTON_CLASS, copyState === "failed" && "border-[#6b2b32] bg-[#1d090b] text-[#ffaaaa]")}
          onClick={() => void handleCopyLink()}
        >
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy Failed" : "Copy Link"}
        </button>
        <a className="mobile-market-button min-h-8" href={`/items/${item.type_id}`} target="_blank" rel="noreferrer">
          Info
        </a>
      </div>
    </section>
  );
}

function StatsGrid({ stats }: { stats: Record<string, number | null> }) {
  return (
    <section className="grid grid-cols-2 gap-px bg-[#151922] p-px">
      <MetricTile label="Best Sell" value={fmtIsk(stats.best_sell)} />
      <MetricTile label="Best Buy" value={fmtIsk(stats.best_buy)} />
      <MetricTile label="Spread" value={fmtIsk(stats.spread)} />
      <MetricTile label="Average" value={fmtIsk(stats.avg_price)} />
      <MetricTile label="Delta" value={<Delta value={stats.delta_price} />} />
      <MetricTile label="ISK/day" value={fmtIsk(stats.isk_day)} />
      <MetricTile label="Sell Orders" value={fmtQty(stats.sell_orders)} />
      <MetricTile label="Buy Orders" value={fmtQty(stats.buy_orders)} />
      <MetricTile label="Sell Volume" value={fmtQty(stats.sell_volume)} />
      <MetricTile label="Buy Volume" value={fmtQty(stats.buy_volume)} />
    </section>
  );
}

function OrderList({ title, side, rows, loading, plex }: { title: string; side: "sell" | "buy"; rows: OrderRow[]; loading: boolean; plex: boolean }) {
  return (
    <section className="flex h-[330px] min-h-0 flex-col border border-[#2c2f36] bg-[#070910]">
      <div className="shrink-0 border-b border-[#151922] px-2 py-2">
        <SectionTitle title={title} right={<span className="font-mono text-[10px] text-slate-500">{rows.length}</span>} />
        <div className={classNames("grid gap-2 font-mono text-[9px] uppercase tracking-wider text-slate-500", plex ? "grid-cols-[1fr,64px,58px]" : "grid-cols-[1fr,58px,1fr,48px]")}>
          <span>Price</span>
          <span className="text-right">Volume</span>
          {!plex && <span>Location</span>}
          {side === "buy" && !plex ? <span className="text-right">Min</span> : <span className="text-right">Expires</span>}
        </div>
      </div>
      {loading ? (
        <div className="min-h-0 flex-1 px-2 py-3 text-[12px] text-slate-500">Loading orders...</div>
      ) : rows.length === 0 ? (
        <div className="min-h-0 flex-1 px-2 py-3 text-[12px] text-slate-500">No {side} orders match the current scope.</div>
      ) : (
        <div className="min-h-0 flex-1 divide-y divide-[#151922] overflow-y-auto overscroll-contain">
          {rows.slice(0, 100).map((order) => (
            <div key={order.order_id} className={classNames("grid gap-2 px-2 py-2 font-mono text-[11px]", plex ? "grid-cols-[1fr,64px,58px]" : "grid-cols-[1fr,58px,1fr,48px]")}>
              <span className={side === "sell" ? "text-[#ffb4b4]" : "text-[#9be7ae]"}>{fmtIsk(order.price, false)}</span>
              <span className="text-right text-slate-300">{fmtQty(order.volume_remain)}</span>
              {!plex && (
                <span className="min-w-0">
                  <span className="block truncate text-slate-300">{order.location_name}</span>
                  <span className="block truncate text-[10px] text-slate-600">{order.system_name} / {order.region_name}</span>
                </span>
              )}
              <span className="text-right text-slate-400">{side === "buy" && !plex ? fmtQty(order.min_volume) : fmtExpires(order.expires_at)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DepthPanel({ levels }: { levels: { side: "sell" | "buy"; price: number; volume: number }[] }) {
  const sells = levels.filter((level) => level.side === "sell" && Number.isFinite(level.price) && Number.isFinite(level.volume)).sort((a, b) => a.price - b.price);
  const buys = levels.filter((level) => level.side === "buy" && Number.isFinite(level.price) && Number.isFinite(level.volume)).sort((a, b) => b.price - a.price);
  const toPoints = (rows: typeof sells) => {
    let acc = 0;
    return rows.map((row) => {
      acc += Number(row.volume) || 0;
      return { price: row.price, volume: acc };
    });
  };
  const sellPoints = toPoints(sells);
  const buyPoints = toPoints(buys);
  const all = [...sellPoints, ...buyPoints];
  if (all.length < 2) return null;
  const minPrice = Math.min(...all.map((point) => point.price));
  const maxPrice = Math.max(...all.map((point) => point.price));
  const maxVol = Math.max(...all.map((point) => point.volume));
  const width = 360;
  const height = 170;
  const x = (price: number) => ((price - minPrice) / (maxPrice - minPrice || 1)) * (width - 32) + 16;
  const y = (vol: number) => height - 18 - (vol / (maxVol || 1)) * (height - 36);
  const line = (rows: typeof sellPoints) => rows.map((point) => `${x(point.price).toFixed(1)},${y(point.volume).toFixed(1)}`).join(" ");
  return (
    <section className="border border-[#2c2f36] bg-[#070910] p-2">
      <SectionTitle title="Order Depth" />
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[170px] w-full border border-[#303236] bg-[#05070b]">
        <line x1="16" y1={height - 18} x2={width - 16} y2={height - 18} stroke="#303236" />
        <line x1="16" y1="18" x2="16" y2={height - 18} stroke="#303236" />
        <polyline points={line(buyPoints)} fill="none" stroke="#3bbf5a" strokeWidth="2" />
        <polyline points={line(sellPoints)} fill="none" stroke="#ff8b8b" strokeWidth="2" />
        <text x="22" y="32" fill="#3bbf5a" fontSize="10">Buy cumulative</text>
        <text x="22" y="46" fill="#ff8b8b" fontSize="10">Sell cumulative</text>
      </svg>
    </section>
  );
}

function HistoryRowCard({ row }: { row: HistoryRow }) {
  return (
    <div className="px-2 py-2">
      <div className="grid grid-cols-[1fr,auto] gap-2">
        <div className="font-mono text-[11px] text-slate-100">{fmtDate(row.date)}</div>
        <div className="font-mono text-[11px] text-[#8bd3ff]">Avg {fmtIsk(row.avg_price)}</div>
      </div>
      <div className="mt-1 grid grid-cols-4 gap-1 font-mono text-[10px] text-slate-400">
        <span>Low {fmtIsk(row.low_price)}</span>
        <span>High {fmtIsk(row.high_price)}</span>
        <span>Vol {fmtQty(row.volume)}</span>
        <span>Orders {fmtQty(row.orders)}</span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1 font-mono text-[10px] text-slate-500">
        <span>7D {fmtIsk(row.ma7)}</span>
        <span>28D {fmtIsk(row.ma28)}</span>
      </div>
    </div>
  );
}

function HistoryTooltip(props: any & { regionMap?: Map<number, string>; singleRegion?: boolean }) {
  if (!props.active || !props.payload?.length) return null;
  return (
    <div className="border border-[#303236] bg-[#05070b] px-2 py-1 text-[11px] text-slate-200 shadow-[0_0_18px_rgba(0,0,0,0.85)]">
      <div className="text-slate-400">{props.label}</div>
      {props.payload.slice(0, 10).map((payload: any, index: number) => (
        <div key={`${payload.dataKey}-${index}`} style={{ color: payload.color }}>
          {payload.name}: {payload.dataKey === "volume_total" ? fmtQty(n(payload.value)) : fmtIsk(n(payload.value))}
        </div>
      ))}
    </div>
  );
}

function RangePicker({ days, setDays }: { days: number; setDays: (days: number) => void }) {
  return (
    <section className="border border-[#2c2f36] bg-[#070910] p-2">
      <SectionTitle title="Date Range" />
      <div className="grid grid-cols-6 gap-1">
        {HISTORY_RANGES.map((value) => (
          <button
            type="button"
            key={value}
            className={classNames("mobile-market-button min-h-8 px-0", days === value && ACTIVE_BUTTON_CLASS)}
            onClick={() => setDays(value)}
          >
            {value}D
          </button>
        ))}
      </div>
    </section>
  );
}

function MetricTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 border border-[#20242c] bg-[#05070b] px-2 py-1.5">
      <div className="truncate text-[8px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[11px] font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function ToggleButton({ active, disabled = false, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={classNames("mobile-market-button min-h-9", active && ACTIVE_BUTTON_CLASS, disabled && "opacity-50")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function NoSelectedItem({ onBrowser }: { onBrowser: () => void }) {
  return (
    <section className="border border-[#2c2f36] bg-[#070910] p-3">
      <div className="text-[12px] font-semibold uppercase tracking-widest text-slate-200">No Item Selected</div>
      <div className="mt-1 text-[12px] leading-snug text-slate-400">
        Pick an item from Browser or Saved to load orders, history, and graphs.
      </div>
      <button type="button" className="mobile-market-button mt-3 min-h-9 w-full border-[#46b2ff]/70 text-[#dff3ff]" onClick={onBrowser}>
        Open Browser
      </button>
    </section>
  );
}

function ItemIcon({ item }: { item: Item }) {
  return <img src={typeIconUrl(item.type_id, item.type_name, 32)} alt="" className="h-8 w-8" loading="lazy" onError={onImgError} />;
}
