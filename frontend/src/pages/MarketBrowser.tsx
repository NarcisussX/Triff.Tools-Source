/*
 * Upgraded Triff.Tools market browser.
 * Uses local browser preferences and read-only backend market-browser endpoints.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Bar,
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import {
    ChevronDown,
    ChevronRight,
    ClipboardPaste,
    Copy,
    Download,
    RefreshCcw,
    Search,
    Star,
    Trash2,
    X,
} from 'lucide-react';
import infoIconRaw from '../assets/icons/info.svg?raw';
import {
    requestSiteAuthModal,
    SITE_AUTH_CHANGED_EVENT,
    type SiteAuthChangeDetail,
} from '../auth/siteAuthEvents';
import type { AuthUser } from '../components/fitting/types';

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
    capabilities: {
        security_filters: boolean;
        station_type_filters: boolean;
        player_structure_locations: boolean;
        order_source_filters: boolean;
    };
    status: {
        orders_last_seen: string | null;
        orders_reported_at: string | null;
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
    sparkline: { date: string; avg_price: number | null }[];
};

type AllItemsResponse = {
    rows: BrowserRow[];
    total: number;
    limit: number;
    offset: number;
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
    station_type: 'npc' | 'player';
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
    depth: { side: 'sell' | 'buy'; price: number; volume: number }[];
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

type ActiveView = 'all' | 'category' | 'item';
type HistoryView = 'chart' | 'both' | 'table';
type MarketQuickbarState = {
    version?: 1;
    quickbar?: unknown;
};

const PLEX_TYPE_ID = 44992;
const HISTORY_RANGES = [7, 14, 21, 30, 90, 180, 365];
const PAGE_SIZE = 100;
const EMPTY_REGION_SCOPE: number[] = [];
const QUICKBAR_STORAGE_KEY = 'tt-market-quickbar';
const QUICKBAR_COLLAPSED_STORAGE_KEY = 'tt-market-quickbar-collapsed';
const MARKET_QUICKBAR_STATE_TOOL_KEY = 'market-browser-quickbar';
const DEPTH_STORAGE_KEY = 'tt-market-depth-v2';
const TRADE_HUBS_ONLY_STORAGE_KEY = 'tt-market-trade-hubs-only';

const panelBase = 'border border-[#2c2f36] bg-[#070910]';
const panelHeader =
    'px-2 py-1 [@media(max-height:1100px)]:py-0.5 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300';
const inputClass =
    'bg-[#05070b] border border-[#303236] px-2 py-1.5 [@media(max-height:1100px)]:py-0.5 text-[11px] text-slate-100 placeholder-slate-600 outline-none focus:border-[#53b6ff] focus:ring-0';
const selectClass =
    'bg-[#05070b] border border-[#303236] px-2 py-1.5 [@media(max-height:1100px)]:py-0.5 text-[11px] text-slate-100 outline-none focus:border-[#53b6ff] focus:ring-0';
const buttonBase =
    'inline-flex items-center justify-center gap-1 border border-[#303236] bg-[#05070b] px-2 py-1 [@media(max-height:1100px)]:py-0.5 text-[10px] uppercase tracking-widest text-slate-300 hover:border-[#53b6ff]/60 hover:bg-[#101219] disabled:cursor-not-allowed disabled:opacity-50';
const buttonActive =
    'border-[#53b6ff] bg-[#101b27] text-slate-100 shadow-[0_0_10px_rgba(83,182,255,0.22)]';
const primaryButton =
    'inline-flex items-center justify-center gap-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest bg-gradient-to-b from-[#1b8cc8] to-[#14608a] border border-[#46b2ff]/70 shadow-[0_0_10px_rgba(70,178,255,0.35)] hover:from-[#27a0df] hover:to-[#1672a4] transition-colors disabled:opacity-60 disabled:cursor-not-allowed';
const tableHead =
    'px-2.5 py-1.5 [@media(max-height:1100px)]:px-2 [@media(max-height:1100px)]:py-1 border-b border-[#2b2d33] border-r border-[#262933] bg-[#14161d] text-slate-200 whitespace-nowrap';
const tableCell = 'px-2.5 py-1.5 [@media(max-height:1100px)]:px-2 [@media(max-height:1100px)]:py-1 border-r border-[#262933] align-middle';

const chartColors = [
    '#53b6ff',
    '#3bbf5a',
    '#f59e0b',
    '#f472b6',
    '#a78bfa',
    '#22d3ee',
    '#fb7185',
];

function classNames(...values: (string | false | null | undefined)[]) {
    return values.filter(Boolean).join(' ');
}

const infoIconMarkup = infoIconRaw.replace(/^\s*<symbol\b[^>]*>/, '').replace(/<\/symbol>\s*$/, '');

function InfoGlyph({ className = 'h-3.5 w-3.5' }: { className?: string }) {
    return (
        <svg aria-hidden="true" focusable="false" viewBox="0 0 128 128" className={classNames('inline-block shrink-0', className)}>
            <style>{'.shape{fill:currentColor}'}</style>
            <g dangerouslySetInnerHTML={{ __html: infoIconMarkup }} />
        </svg>
    );
}

function readJson<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback;
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

function writeJson(key: string, value: unknown) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, JSON.stringify(value));
}

function normalizeQuickbar(raw: unknown): Item[] {
    const source = Array.isArray(raw) ? raw : [];
    const byTypeId = new Map<number, Item>();
    for (const item of source) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Partial<Item> & { typeId?: unknown; typeName?: unknown };
        const typeId = Number(row.type_id ?? row.typeId);
        const typeName = String(row.type_name ?? row.typeName ?? '').trim();
        if (!Number.isInteger(typeId) || typeId <= 0 || !typeName) continue;
        byTypeId.set(typeId, { type_id: typeId, type_name: typeName.slice(0, 240) });
    }
    return Array.from(byTypeId.values())
        .sort((a, b) => a.type_name.localeCompare(b.type_name))
        .slice(0, 500);
}

function normalizeQuickbarState(raw: unknown): Item[] {
    if (Array.isArray(raw)) return normalizeQuickbar(raw);
    const source = raw && typeof raw === 'object' ? raw as MarketQuickbarState : {};
    return normalizeQuickbar(source.quickbar);
}

function typeIconUrl(typeId: number, name?: string, size = 32) {
    const lower = typeof name === 'string' ? name.toLowerCase() : '';
    if (lower.includes(' blueprint')) {
        return `https://images.evetech.net/types/${typeId}/bp?size=${size}`;
    }
    return `https://images.evetech.net/types/${typeId}/icon?size=${size}`;
}

function onImgError(e: React.SyntheticEvent<HTMLImageElement>) {
    const el = e.currentTarget;
    if (!el.dataset.triedRender) {
        el.dataset.triedRender = '1';
        try {
            const url = new URL(el.src);
            url.pathname = url.pathname.replace(/\/(icon|bp)(?=\?)/, '/render');
            el.src = url.toString();
        } catch {
            el.style.display = 'none';
        }
    } else {
        el.style.display = 'none';
    }
}

function n(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function fmtCompact(value: number | null | undefined, digits = 2) {
    if (value == null || !Number.isFinite(value)) return '-';
    const abs = Math.abs(value);
    if (abs >= 1e12) return `${(value / 1e12).toFixed(digits)}t`;
    if (abs >= 1e9) return `${(value / 1e9).toFixed(digits)}b`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(digits)}m`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(digits)}k`;
    return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtIsk(value: number | null | undefined, compact = true) {
    if (value == null || !Number.isFinite(value)) return '-';
    if (compact && Math.abs(value) >= 100000) return `${fmtCompact(value)} ISK`;
    return `${value.toLocaleString(undefined, {
        minimumFractionDigits: value < 1000 ? 2 : 0,
        maximumFractionDigits: 2,
    })} ISK`;
}

function fmtQty(value: number | null | undefined) {
    if (value == null || !Number.isFinite(value)) return '-';
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtM3(value: number | null | undefined) {
    if (value == null || !Number.isFinite(value)) return '-';
    return `${fmtCompact(value)} m3`;
}

function fmtPct(value: number | null | undefined) {
    if (value == null || !Number.isFinite(value)) return '-';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
}

function fmtDate(value: string | null | undefined) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    return d.toISOString().slice(0, 10);
}

function fmtDateTime(value: string | null | undefined) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString(undefined, {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function fmtAgo(value: string | null | undefined) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    const hours = Math.floor((Date.now() - d.getTime()) / 3600000);
    if (hours <= 0) return 'just now';
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function fmtExpires(value: string | null | undefined) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    const hours = Math.floor((d.getTime() - Date.now()) / 3600000);
    if (hours <= 0) return 'expired';
    const days = Math.floor(hours / 24);
    const h = hours % 24;
    if (days && h) return `${days}d ${h}h`;
    if (days) return `${days}d`;
    return `${h}h`;
}

function rangeText(value: number | null | undefined) {
    if (value == null || !Number.isFinite(value)) return '-';
    if (value < 0) return 'region/system';
    if (value === 0) return 'station';
    return `${value} jumps`;
}

function isPlex(item: Item | null) {
    return !!item && (item.type_id === PLEX_TYPE_ID || item.type_name.toLowerCase() === 'plex');
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, { cache: 'no-store', ...init });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
}

function copyText(value: string) {
    if (!value) return;
    if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(value);
        return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
}

function toggleNumber(list: number[], id: number) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function sortRegions(regions: Region[]) {
    return [...regions].sort((a, b) => {
        const ai = TOP_REGION_ORDER.indexOf(a.region_id);
        const bi = TOP_REGION_ORDER.indexOf(b.region_id);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        return (b.order_count || 0) - (a.order_count || 0) || a.region_name.localeCompare(b.region_name);
    });
}

const TOP_REGION_ORDER = [10000002, 10000043, 10000042, 10000032, 10000030];
const NO_TRADE_HUB_LOCATION_ID = 1;
const TRADE_HUBS = [
    { region_id: 10000002, location_id: 60003760, name: 'Jita IV - Moon 4' },
    { region_id: 10000043, location_id: 60008494, name: 'Amarr VIII (Oris)' },
    { region_id: 10000032, location_id: 60011866, name: 'Dodixie IX - Moon 20' },
    { region_id: 10000030, location_id: 60004588, name: 'Rens VI - Moon 8' },
    { region_id: 10000042, location_id: 60005686, name: 'Hek VIII - Moon 12' },
];

export default function MarketBrowser() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
    const [tree, setTree] = useState<MarketTreeNode[]>([]);
    const [expanded, setExpanded] = useState<Record<number, boolean>>({});

    const [search, setSearch] = useState('');
    const [items, setItems] = useState<Item[]>([]);
    const [selected, setSelected] = useState<Item | null>(null);
    const [activeView, setActiveView] = useState<ActiveView>('all');
    const [category, setCategory] = useState<{ id: number; name: string } | null>(null);

    const [homeRegions, setHomeRegions] = useState<number[]>(() =>
        readJson<number[]>('tt-market-home-regions', [])
    );
    const [quickbar, setQuickbar] = useState<Item[]>(() =>
        normalizeQuickbar(readJson<Item[]>(QUICKBAR_STORAGE_KEY, []))
    );
    const [quickbarCollapsed, setQuickbarCollapsed] = useState<boolean>(() =>
        readJson<boolean>(QUICKBAR_COLLAPSED_STORAGE_KEY, false)
    );
    const [authUser, setAuthUser] = useState<AuthUser | null>(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [remoteQuickbarReady, setRemoteQuickbarReady] = useState(false);

    const [allSearch, setAllSearch] = useState('');
    const [allRows, setAllRows] = useState<BrowserRow[]>([]);
    const [allTotal, setAllTotal] = useState(0);
    const [allOffset, setAllOffset] = useState(0);
    const [allSort, setAllSort] = useState('item');
    const [allDirection, setAllDirection] = useState<'asc' | 'desc'>('asc');
    const [loadingAll, setLoadingAll] = useState(false);

    const [historyRegions, setHistoryRegions] = useState<number[]>(() =>
        readJson<number[]>('tt-market-last-history-regions', [])
    );
    const [stationType, setStationType] = useState<'all' | 'npc' | 'player'>('all');
    const [selectedLocation, setSelectedLocation] = useState<number | null>(null);
    const [noScam, setNoScam] = useState<boolean>(() => readJson<boolean>('tt-market-no-scam', false));
    const [showDepth, setShowDepth] = useState<boolean>(() => readJson<boolean>(DEPTH_STORAGE_KEY, false));
    const [tradeHubsOnly, setTradeHubsOnly] = useState<boolean>(() =>
        readJson<boolean>(TRADE_HUBS_ONLY_STORAGE_KEY, false)
    );

    const [orders, setOrders] = useState<OrdersResponse | null>(null);
    const [itemSummary, setItemSummary] = useState<ItemSummary | null>(null);
    const [loadingOrders, setLoadingOrders] = useState(false);

    const [historyDays, setHistoryDays] = useState<number>(() =>
        readJson<number>('tt-market-history-days', 30)
    );
    const [historyView, setHistoryView] = useState<HistoryView>(() =>
        readJson<HistoryView>('tt-market-history-view', 'both')
    );
    const [historyToggles, setHistoryToggles] = useState(() =>
        readJson('tt-market-history-toggles', {
            average: true,
            range: true,
            volume: true,
            ma7: true,
            ma28: false,
        })
    );
    const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
    const [historyStats, setHistoryStats] = useState<HistoryResponse['stats'] | null>(null);
    const [historySort, setHistorySort] = useState<'date' | 'region' | 'avg' | 'low' | 'high' | 'volume' | 'orders' | 'ma7' | 'ma28'>('date');
    const [historyDir, setHistoryDir] = useState<'asc' | 'desc'>('desc');
    const [loadingHistory, setLoadingHistory] = useState(false);

    const [ticker, setTicker] = useState<TickerRow[]>([]);
    const [bulkText, setBulkText] = useState('');
    const [bulkOpen, setBulkOpen] = useState(false);
    const [quickbarMsg, setQuickbarMsg] = useState('');
    const [clearConfirm, setClearConfirm] = useState(false);
    const [highlightAdded, setHighlightAdded] = useState<number[]>([]);
    const [leftTab, setLeftTab] = useState<'browse' | 'quickbar'>('browse');

    const regions = useMemo(() => sortRegions(bootstrap?.regions || []), [bootstrap]);
    const scopeRegions = homeRegions;
    const plexSelected = isPlex(selected);
    const orderScopeRegions = plexSelected ? EMPTY_REGION_SCOPE : historyRegions;
    const historyScopeRegions = plexSelected ? EMPTY_REGION_SCOPE : historyRegions;
    const tradeHubLocationIds = useMemo(() => {
        if (!tradeHubsOnly || plexSelected) return [];
        const selectedRegions = new Set(orderScopeRegions);
        const hubs = orderScopeRegions.length === 0
            ? TRADE_HUBS
            : TRADE_HUBS.filter((hub) => selectedRegions.has(hub.region_id));
        return hubs.map((hub) => hub.location_id);
    }, [tradeHubsOnly, plexSelected, orderScopeRegions]);

    useEffect(() => {
        let alive = true;

        async function loadAuth() {
            try {
                const data = await apiJson<{ ok: boolean; authenticated: boolean; user: AuthUser | null }>(
                    '/api/auth/me',
                    { credentials: 'include' }
                );
                if (alive) setAuthUser(data.authenticated ? data.user : null);
            } catch {
                if (alive) setAuthUser(null);
            } finally {
                if (alive) setAuthChecked(true);
            }
        }

        function handleAuthChanged(event: Event) {
            const detail = (event as CustomEvent<SiteAuthChangeDetail>).detail;
            if (detail && 'user' in detail) {
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
            setRemoteQuickbarReady(false);
            if (authChecked) setQuickbar(normalizeQuickbar(readJson<Item[]>(QUICKBAR_STORAGE_KEY, [])));
            return;
        }

        let cancelled = false;

        async function loadRemoteQuickbar() {
            setRemoteQuickbarReady(false);
            let loaded = false;
            try {
                const data = await apiJson<{
                    ok: boolean;
                    state: { stateJson?: unknown } | null;
                }>(`/api/tool-state/${MARKET_QUICKBAR_STATE_TOOL_KEY}`, {
                    credentials: 'include',
                });
                if (cancelled) return;
                loaded = true;
                if (data.state?.stateJson) setQuickbar(normalizeQuickbarState(data.state.stateJson));
            } catch {
                // Keep the in-memory quickbar; avoid overwriting an unknown account state after a failed read.
            } finally {
                if (!cancelled) setRemoteQuickbarReady(loaded);
            }
        }

        void loadRemoteQuickbar();
        return () => {
            cancelled = true;
        };
    }, [authUser, authChecked]);

    useEffect(() => writeJson('tt-market-home-regions', homeRegions), [homeRegions]);
    useEffect(() => {
        if (!authUser) writeJson(QUICKBAR_STORAGE_KEY, quickbar);
    }, [authUser, quickbar]);
    useEffect(() => {
        if (!authUser || !remoteQuickbarReady) return;
        const snapshot: MarketQuickbarState = {
            version: 1,
            quickbar: normalizeQuickbar(quickbar),
        };

        const timer = window.setTimeout(() => {
            void fetch(`/api/tool-state/${MARKET_QUICKBAR_STATE_TOOL_KEY}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stateJson: snapshot }),
            }).catch(() => {});
        }, 600);

        return () => window.clearTimeout(timer);
    }, [authUser, quickbar, remoteQuickbarReady]);
    useEffect(() => writeJson(QUICKBAR_COLLAPSED_STORAGE_KEY, quickbarCollapsed), [quickbarCollapsed]);
    useEffect(() => writeJson('tt-market-history-days', historyDays), [historyDays]);
    useEffect(() => writeJson('tt-market-history-view', historyView), [historyView]);
    useEffect(() => writeJson('tt-market-history-toggles', historyToggles), [historyToggles]);
    useEffect(() => writeJson('tt-market-no-scam', noScam), [noScam]);
    useEffect(() => writeJson(DEPTH_STORAGE_KEY, showDepth), [showDepth]);
    useEffect(() => writeJson(TRADE_HUBS_ONLY_STORAGE_KEY, tradeHubsOnly), [tradeHubsOnly]);
    useEffect(() => writeJson('tt-market-last-history-regions', historyRegions), [historyRegions]);

    useEffect(() => {
        apiJson<Bootstrap>('/api/market/browser/bootstrap')
            .then(setBootstrap)
            .catch((err: unknown) => console.error('[market/browser/bootstrap] failed', err));
        apiJson<MarketTreeNode[]>('/api/market/tree')
            .then((data) => setTree(data || []))
            .catch((err: unknown) => console.error('[market/tree] failed', err));
    }, []);

    useEffect(() => {
        const typeId = Number(searchParams.get('type_id') || searchParams.get('typeId') || 0);
        if (!Number.isFinite(typeId) || typeId <= 0) return;
        if (selected?.type_id === typeId && activeView === 'item') return;

        const controller = new AbortController();
        apiJson<ItemSummary>(`/api/market/browser/item/${typeId}`, { signal: controller.signal })
            .then((data) => {
                const name = data?.type_name || `Type ${typeId}`;
                setSelected({ type_id: typeId, type_name: name });
                setActiveView('item');
                setSearch(name);
                setItems([]);
                setOrders(null);
                setItemSummary(null);
                setHistoryRows([]);
                setHistoryStats(null);
                setStationType('all');
                setSelectedLocation(null);
                setHistoryRegions(typeId === PLEX_TYPE_ID ? [] : homeRegions);
            })
            .catch((err: unknown) => {
                if ((err as Error).name !== 'AbortError') console.error('[market/deeplink] failed', err);
            });
        return () => controller.abort();
    }, [searchParams, selected?.type_id, activeView, homeRegions]);

    useEffect(() => {
        if (search.trim().length < 2) {
            setItems([]);
            return;
        }

        const controller = new AbortController();
        apiJson<Item[]>(`/api/market/items?q=${encodeURIComponent(search.trim())}`, {
            signal: controller.signal,
        })
            .then((data) => setItems(data || []))
            .catch((err: unknown) => {
                if ((err as Error).name !== 'AbortError') console.error('[market/items] failed', err);
            });
        return () => controller.abort();
    }, [search]);

    useEffect(() => {
        if (activeView !== 'all' && activeView !== 'category') return;
        const controller = new AbortController();
        const params = new URLSearchParams({
            limit: String(PAGE_SIZE),
            offset: String(allOffset),
            sort: allSort,
            direction: allDirection,
        });
        if (scopeRegions.length) params.set('regions', scopeRegions.join(','));
        if (allSearch.trim()) params.set('search', allSearch.trim());
        if (noScam) params.set('no_scam', 'true');
        if (activeView === 'category' && category) params.set('group_id', String(category.id));

        setLoadingAll(true);
        const url =
            activeView === 'category' && category
                ? `/api/market/browser/category?${params.toString()}`
                : `/api/market/browser/all-items?${params.toString()}`;
        apiJson<AllItemsResponse>(url, { signal: controller.signal })
            .then((data) => {
                setAllRows(data.rows || []);
                setAllTotal(data.total || 0);
            })
            .catch((err: unknown) => {
                if ((err as Error).name !== 'AbortError') console.error('[market/all-items] failed', err);
                setAllRows([]);
                setAllTotal(0);
            })
            .finally(() => setLoadingAll(false));
        return () => controller.abort();
    }, [activeView, category, scopeRegions, allSearch, allOffset, allSort, allDirection, noScam]);

    useEffect(() => {
        if (!selected || activeView !== 'item') return;

        const controller = new AbortController();
        const params = new URLSearchParams();
        if (orderScopeRegions.length) params.set('regions', orderScopeRegions.join(','));
        if (noScam) params.set('no_scam', 'true');

        apiJson<ItemSummary>(`/api/market/browser/item/${selected.type_id}?${params.toString()}`, {
            signal: controller.signal,
        })
            .then(setItemSummary)
            .catch((err: unknown) => {
                if ((err as Error).name !== 'AbortError') console.error('[market/item] failed', err);
                setItemSummary(null);
            });
        return () => controller.abort();
    }, [selected, activeView, orderScopeRegions, noScam]);

    useEffect(() => {
        if (!selected || activeView !== 'item') return;

        const controller = new AbortController();
        const locationIds = tradeHubsOnly && !plexSelected
            ? selectedLocation && tradeHubLocationIds.includes(selectedLocation)
                ? [selectedLocation]
                : tradeHubLocationIds.length
                    ? tradeHubLocationIds
                    : [NO_TRADE_HUB_LOCATION_ID]
            : selectedLocation && !plexSelected
                ? [selectedLocation]
                : [];
        const params = new URLSearchParams({
            side: 'both',
            limit: '700',
        });
        if (orderScopeRegions.length) params.set('regions', orderScopeRegions.join(','));
        if (locationIds.length) params.set('locations', locationIds.join(','));
        if (stationType !== 'all' && !plexSelected && !tradeHubsOnly) params.set('station_type', stationType);
        if (noScam) params.set('no_scam', 'true');

        setLoadingOrders(true);
        apiJson<OrdersResponse>(`/api/market/browser/item/${selected.type_id}/orders?${params.toString()}`, {
            signal: controller.signal,
        })
            .then(setOrders)
            .catch((err: unknown) => {
                if ((err as Error).name !== 'AbortError') console.error('[market/orders] failed', err);
                setOrders(null);
            })
            .finally(() => setLoadingOrders(false));
        return () => controller.abort();
    }, [
        selected,
        activeView,
        orderScopeRegions,
        selectedLocation,
        stationType,
        tradeHubsOnly,
        tradeHubLocationIds,
        noScam,
        plexSelected,
    ]);

    useEffect(() => {
        if (!selected || activeView !== 'item') return;

        const controller = new AbortController();
        const params = new URLSearchParams({ days: String(historyDays) });
        if (historyScopeRegions.length) params.set('regions', historyScopeRegions.join(','));

        setLoadingHistory(true);
        apiJson<HistoryResponse>(`/api/market/browser/item/${selected.type_id}/history?${params.toString()}`, {
            signal: controller.signal,
        })
            .then((data) => {
                setHistoryRows(data.rows || []);
                setHistoryStats(data.stats || null);
            })
            .catch((err: unknown) => {
                if ((err as Error).name !== 'AbortError') console.error('[market/history] failed', err);
                setHistoryRows([]);
                setHistoryStats(null);
            })
            .finally(() => setLoadingHistory(false));
        return () => controller.abort();
    }, [selected, activeView, historyDays, historyScopeRegions]);

    useEffect(() => {
        const ids = Array.from(new Set([PLEX_TYPE_ID, ...quickbar.map((q) => q.type_id)])).slice(0, 80);
        if (!ids.length) {
            setTicker([]);
            return;
        }
        const params = new URLSearchParams({ type_ids: ids.join(',') });
        if (scopeRegions.length) params.set('regions', scopeRegions.join(','));

        let live = true;
        const load = () => {
            apiJson<{ rows: TickerRow[] }>(`/api/market/browser/ticker?${params.toString()}`)
                .then((data) => {
                    if (live) setTicker(data.rows || []);
                })
                .catch((err: unknown) => {
                    if (live) console.error('[market/ticker] failed', err);
                });
        };
        load();
        const interval = window.setInterval(load, 60000);
        return () => {
            live = false;
            window.clearInterval(interval);
        };
    }, [quickbar, scopeRegions]);

    const locations = useMemo(() => {
        const map = new Map<number, string>();
        for (const row of [...(orders?.sellers || []), ...(orders?.buyers || [])]) {
            if (row.location_id) map.set(row.location_id, row.location_name || `Location ${row.location_id}`);
        }
        return Array.from(map.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [orders]);

    const visibleStats = useMemo(() => {
        const base = itemSummary;
        const counts = orders?.counts;
        return {
            avg_price: historyStats?.avg_price ?? base?.avg_price ?? null,
            delta_price: base?.delta_price ?? null,
            isk_day: historyStats?.isk_day ?? base?.isk_day ?? null,
            vol_day: historyStats?.vol_day ?? base?.vol_day ?? null,
            best_sell: counts?.best_sell ?? base?.best_sell ?? null,
            best_buy: counts?.best_buy ?? base?.best_buy ?? null,
            spread:
                counts?.best_buy != null && counts?.best_sell != null
                    ? counts.best_buy - counts.best_sell
                    : base?.spread ?? null,
            sell_orders: counts?.sell_count ?? base?.sell_orders ?? null,
            buy_orders: counts?.buy_count ?? base?.buy_orders ?? null,
            sell_volume: counts?.sell_volume ?? base?.sell_volume ?? null,
            buy_volume: counts?.buy_volume ?? base?.buy_volume ?? null,
        };
    }, [historyStats, itemSummary, orders]);

    function onSelectType(typeId: number, name: string) {
        const item = { type_id: typeId, type_name: name };
        setSelected(item);
        setActiveView('item');
        setSearch(name);
        setItems([]);
        setOrders(null);
        setItemSummary(null);
        setHistoryRows([]);
        setHistoryStats(null);
        setStationType('all');
        setSelectedLocation(null);
        const defaultRegions = typeId === PLEX_TYPE_ID ? [] : homeRegions;
        setHistoryRegions(defaultRegions);
        const next = new URLSearchParams(searchParams);
        next.set('type_id', String(typeId));
        setSearchParams(next);
    }

    function setHomeRegionScope(nextRegions: number[]) {
        setHomeRegions(nextRegions);
        setSelectedLocation(null);
        if (selected && activeView === 'item' && !isPlex(selected)) {
            setHistoryRegions(nextRegions);
        }
    }

    function setTradeHubScope(nextValue: boolean) {
        setTradeHubsOnly(nextValue);
        setSelectedLocation(null);
        if (nextValue) setStationType('all');
    }

    function openAllItems() {
        setActiveView('all');
        setCategory(null);
        setAllOffset(0);
        const next = new URLSearchParams(searchParams);
        next.delete('type_id');
        next.delete('typeId');
        setSearchParams(next);
    }

    function openCategory(id: number, name: string) {
        setCategory({ id, name });
        setActiveView('category');
        setAllOffset(0);
        const next = new URLSearchParams(searchParams);
        next.delete('type_id');
        next.delete('typeId');
        setSearchParams(next);
    }

    function clickAllSort(key: string) {
        if (allSort === key) {
            setAllDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setAllSort(key);
            setAllDirection(key === 'item' ? 'asc' : 'desc');
        }
        setAllOffset(0);
    }

    function clickHistorySort(key: typeof historySort) {
        if (historySort === key) {
            setHistoryDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setHistorySort(key);
            setHistoryDir(key === 'date' ? 'desc' : 'asc');
        }
    }

    function toggleFavorite(item: Item) {
        const exists = quickbar.some((q) => q.type_id === item.type_id);
        if (exists) {
            setQuickbar((prev) => prev.filter((q) => q.type_id !== item.type_id));
            setQuickbarMsg(`Removed ${item.type_name}`);
            return;
        }
        setQuickbar((prev) => [...prev, item].sort((a, b) => a.type_name.localeCompare(b.type_name)));
        setQuickbarCollapsed(false);
        setHighlightAdded([item.type_id]);
        setQuickbarMsg(`Added ${item.type_name}`);
        window.setTimeout(() => setHighlightAdded([]), 1400);
    }

    async function importQuickbar() {
        const res = await apiJson<{
            resolved: { type_id: number; type_name: string }[];
            not_found: string[];
        }>('/api/market/browser/quickbar/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: bulkText }),
        });

        const existing = new Set(quickbar.map((q) => q.type_id));
        const resolved = res.resolved || [];
        const toAdd = resolved
            .filter((r) => !existing.has(r.type_id))
            .map((r) => ({ type_id: r.type_id, type_name: r.type_name }));
        const already = resolved.length - toAdd.length;

        if (toAdd.length) {
            setQuickbar((prev) =>
                [...prev, ...toAdd]
                    .filter((item, idx, arr) => arr.findIndex((x) => x.type_id === item.type_id) === idx)
                    .sort((a, b) => a.type_name.localeCompare(b.type_name))
            );
            setQuickbarCollapsed(false);
            setHighlightAdded(toAdd.map((i) => i.type_id));
            window.setTimeout(() => setHighlightAdded([]), 1400);
        }
        setQuickbarMsg(`${toAdd.length} added, ${already} already present, ${(res.not_found || []).length} not found`);
    }

    const activeRegionText =
        scopeRegions.length === 0
            ? 'All Regions'
            : scopeRegions
                .map((id) => regions.find((r) => r.region_id === id)?.region_name || id)
                .slice(0, 3)
                .join(', ') + (scopeRegions.length > 3 ? ` +${scopeRegions.length - 3}` : '');

    return (
        <div className="h-[calc(100dvh-3rem)] overflow-hidden text-slate-100 text-[11px] leading-snug">
            <div className="w-full h-full px-2 lg:px-3 py-2 pb-3 [@media(max-height:1100px)]:px-1 [@media(max-height:1100px)]:py-1">
                <div className="border border-[#3a3c40] bg-[#05070b]/95 shadow-[0_0_32px_rgba(0,0,0,0.95)] flex flex-col h-full min-h-0">
                    <Header
                        bootstrap={bootstrap}
                        scopeText={activeRegionText}
                        activeView={activeView}
                        selected={selected}
                    />

                    <div className="flex-1 min-h-0 p-2 [@media(max-height:1100px)]:p-1 flex gap-2 [@media(max-height:1100px)]:gap-1 overflow-hidden">
                        <Sidebar
                            search={search}
                            setSearch={setSearch}
                            items={items}
                            onSelectType={onSelectType}
                            tree={tree}
                            expanded={expanded}
                            setExpanded={setExpanded}
                            openAllItems={openAllItems}
                            openCategory={openCategory}
                            activeView={activeView}
                            category={category}
                            allTotal={allTotal}
                            leftTab={leftTab}
                            setLeftTab={setLeftTab}
                            regions={regions}
                            homeRegions={homeRegions}
                            setHomeRegions={setHomeRegionScope}
                            tradeHubsOnly={tradeHubsOnly}
                            setTradeHubsOnly={setTradeHubScope}
                            quickbar={quickbar}
                            quickbarCollapsed={quickbarCollapsed}
                            setQuickbarCollapsed={setQuickbarCollapsed}
                            quickbarMsg={quickbarMsg}
                            authChecked={authChecked}
                            authUser={authUser}
                            remoteQuickbarReady={remoteQuickbarReady}
                            requestQuickbarSignIn={() => requestSiteAuthModal('login')}
                            bulkOpen={bulkOpen}
                            setBulkOpen={setBulkOpen}
                            bulkText={bulkText}
                            setBulkText={setBulkText}
                            importQuickbar={importQuickbar}
                            exportQuickbar={() => {
                                copyText(quickbar.map((q) => q.type_name).join('\n'));
                                setQuickbarMsg(`Exported ${quickbar.length} items`);
                            }}
                            clearConfirm={clearConfirm}
                            setClearConfirm={setClearConfirm}
                            clearQuickbar={() => {
                                setQuickbar([]);
                                setClearConfirm(false);
                                setQuickbarMsg('Quickbar cleared');
                            }}
                            onSelectQuickbar={onSelectType}
                            removeQuickbar={(id) => setQuickbar((prev) => prev.filter((q) => q.type_id !== id))}
                            highlightAdded={highlightAdded}
                        />

                        <section className="flex-1 min-h-0 border border-[#2c2f36] bg-[#070910] flex flex-col overflow-hidden">
                            {activeView === 'item' && selected ? (
                                <ItemView
                                    selected={selected}
                                    itemSummary={itemSummary}
                                    orders={orders}
                                    visibleStats={visibleStats}
                                    regions={regions}
                                    historyRegions={historyRegions}
                                    setHistoryRegions={setHistoryRegions}
                                    plexSelected={plexSelected}
                                    stationType={stationType}
                                    setStationType={setStationType}
                                    selectedLocation={selectedLocation}
                                    setSelectedLocation={setSelectedLocation}
                                    locations={locations}
                                    tradeHubsOnly={tradeHubsOnly}
                                    noScam={noScam}
                                    setNoScam={setNoScam}
                                    showDepth={showDepth}
                                    setShowDepth={setShowDepth}
                                    loadingOrders={loadingOrders}
                                    historyDays={historyDays}
                                    setHistoryDays={setHistoryDays}
                                    historyView={historyView}
                                    setHistoryView={setHistoryView}
                                    historyToggles={historyToggles}
                                    setHistoryToggles={setHistoryToggles}
                                    historyRows={historyRows}
                                    historyStats={historyStats}
                                    loadingHistory={loadingHistory}
                                    historySort={historySort}
                                    historyDir={historyDir}
                                    clickHistorySort={clickHistorySort}
                                    quickbar={quickbar}
                                    toggleFavorite={toggleFavorite}
                                />
                            ) : (
                                <AllItemsView
                                    activeView={activeView}
                                    category={category}
                                    rows={allRows}
                                    total={allTotal}
                                    offset={allOffset}
                                    setOffset={setAllOffset}
                                    loading={loadingAll}
                                    search={allSearch}
                                    setSearch={(v) => {
                                        setAllSearch(v);
                                        setAllOffset(0);
                                    }}
                                    sort={allSort}
                                    direction={allDirection}
                                    clickSort={clickAllSort}
                                    onSelectType={onSelectType}
                                    quickbar={quickbar}
                                    toggleFavorite={toggleFavorite}
                                    scopeText={activeRegionText}
                                    noScam={noScam}
                                    setNoScam={setNoScam}
                                />
                            )}
                        </section>
                    </div>

                    <TickerBar
                        ticker={ticker}
                        quickbar={quickbar}
                        scopeText={activeRegionText}
                        onSelectType={onSelectType}
                    />
                </div>
            </div>
        </div>
    );
}

function Header({
    bootstrap,
    scopeText,
    activeView,
    selected,
}: {
    bootstrap: Bootstrap | null;
    scopeText: string;
    activeView: ActiveView;
    selected: Item | null;
}) {
    const itemCount = bootstrap?.status.live_item_count ?? null;
    return (
        <>
            <div className="flex items-center justify-between px-3 py-1.5 bg-gradient-to-r from-[#111319] via-[#171920] to-[#242833] border-b border-[#3a3c40] [@media(max-height:1100px)]:hidden">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
                    <span className="uppercase tracking-widest text-[10px] text-slate-300 truncate">
                        Market &amp; Trade &gt; Market Browser
                    </span>
                    <span className="text-[10px] text-slate-500 truncate">
                        {activeView === 'item' && selected ? selected.type_name : activeView === 'category' ? 'Category View' : 'All Items'}
                    </span>
                </div>
                <div className="flex items-center gap-2 text-[9px] text-slate-400">
                    <span className="px-1 py-0.5 bg-[#0b0d11] border border-[#303236]">Browser</span>
                    <span className="text-[#53b6ff]">Triff.Tools</span>
                    <span className="flex gap-1">
                        <span className="h-2 w-2 bg-[#53b6ff]" />
                        <span className="h-2 w-2 bg-[#3bbf5a]" />
                        <span className="h-2 w-2 bg-[#bf3b3b]" />
                    </span>
                </div>
            </div>

            <div className="flex items-center justify-between gap-3 px-3 py-1.5 [@media(max-height:1100px)]:px-2 [@media(max-height:1100px)]:py-1 border-b border-[#262933] bg-[#05070b] text-[10px] text-slate-400 overflow-hidden">
                <div className="flex items-center gap-2 [@media(max-height:1100px)]:gap-1 min-w-0">
                    <span className="uppercase tracking-widest text-slate-300 whitespace-nowrap">Overview &gt; Live Market</span>
                    <StatusPill label="Orders" tone={bootstrap?.status.orders_last_seen ? 'ok' : 'warn'}>
                        {bootstrap?.status.orders_last_seen ? fmtAgo(bootstrap.status.orders_last_seen) : 'unknown'}
                    </StatusPill>
                    <StatusPill label="History" tone={bootstrap?.status.history_last_date ? 'ok' : 'warn'}>
                        {bootstrap?.status.history_last_date ? fmtDate(bootstrap.status.history_last_date) : 'unknown'}
                    </StatusPill>
                    <StatusPill label="Scope" tone="info">{scopeText}</StatusPill>
                    <StatusPill label="Items" tone="info">{itemCount == null ? '-' : itemCount.toLocaleString()}</StatusPill>
                </div>
                <div className="text-[9px] text-slate-500 whitespace-nowrap">
                    Orders: {bootstrap?.status.order_count?.toLocaleString() || '-'} rows
                </div>
            </div>
        </>
    );
}

function StatusPill({
    label,
    tone,
    children,
}: {
    label: string;
    tone: 'ok' | 'warn' | 'info';
    children: React.ReactNode;
}) {
    const dot = tone === 'ok' ? 'bg-[#3bbf5a]' : tone === 'warn' ? 'bg-[#bf3b3b]' : 'bg-[#53b6ff]';
    return (
        <span className="inline-flex items-center gap-1 border border-[#303236] bg-[#0b0d11] px-1.5 py-0.5 [@media(max-height:1100px)]:py-0 whitespace-nowrap">
            <span className={classNames('h-1.5 w-1.5 rounded-full', dot)} />
            <span className="uppercase tracking-widest text-slate-500">{label}</span>
            <span className="text-slate-300">{children}</span>
        </span>
    );
}

function Sidebar(props: {
    search: string;
    setSearch: (v: string) => void;
    items: Item[];
    onSelectType: (typeId: number, name: string) => void;
    tree: MarketTreeNode[];
    expanded: Record<number, boolean>;
    setExpanded: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
    openAllItems: () => void;
    openCategory: (id: number, name: string) => void;
    activeView: ActiveView;
    category: { id: number; name: string } | null;
    allTotal: number;
    leftTab: 'browse' | 'quickbar';
    setLeftTab: (tab: 'browse' | 'quickbar') => void;
    regions: Region[];
    homeRegions: number[];
    setHomeRegions: (v: number[]) => void;
    tradeHubsOnly: boolean;
    setTradeHubsOnly: (v: boolean) => void;
    quickbar: Item[];
    quickbarCollapsed: boolean;
    setQuickbarCollapsed: (v: boolean) => void;
    quickbarMsg: string;
    authChecked: boolean;
    authUser: AuthUser | null;
    remoteQuickbarReady: boolean;
    requestQuickbarSignIn: () => void;
    bulkOpen: boolean;
    setBulkOpen: (v: boolean) => void;
    bulkText: string;
    setBulkText: (v: string) => void;
    importQuickbar: () => void;
    exportQuickbar: () => void;
    clearConfirm: boolean;
    setClearConfirm: (v: boolean) => void;
    clearQuickbar: () => void;
    onSelectQuickbar: (typeId: number, name: string) => void;
    removeQuickbar: (id: number) => void;
    highlightAdded: number[];
}) {
    const renderNode = (node: MarketTreeNode, depth = 0): JSX.Element => {
        const hasChildren = !!((node.children && node.children.length) || (node.types && node.types.length));
        const isExpanded = !!props.expanded[node.id];
        const active = props.activeView === 'category' && props.category?.id === node.id;

        return (
            <div key={node.id}>
                <button
                    type="button"
                    className={classNames(
                        'w-full flex items-center gap-1 hover:bg-[#141821] px-2 py-1 text-[11px] text-slate-300 text-left',
                        active && 'bg-[#101b27] text-slate-100'
                    )}
                    style={{ paddingLeft: 5 + depth * 10 }}
                    onClick={() => {
                        props.openCategory(node.id, node.name);
                        if (hasChildren) props.setExpanded((prev) => ({ ...prev, [node.id]: !prev[node.id] }));
                    }}
                >
                    {hasChildren ? (
                        isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />
                    ) : (
                        <span className="w-[11px] text-slate-600">.</span>
                    )}
                    <span className="truncate">{node.name}</span>
                </button>
                {isExpanded && node.children?.map((c) => renderNode(c, depth + 1))}
                {isExpanded &&
                    node.types?.map((t) => (
                        <button
                            type="button"
                            key={t.type_id}
                            className="w-full hover:bg-[#141821] px-2 py-1 text-[11px] text-slate-300 flex items-center gap-2 text-left"
                            style={{ paddingLeft: 20 + depth * 10 }}
                            onClick={() => props.onSelectType(t.type_id, t.name)}
                        >
                            <img
                                src={typeIconUrl(t.type_id, t.name, 32)}
                                alt=""
                                className="w-4 h-4 flex-none"
                                loading="lazy"
                                onError={onImgError}
                            />
                            <span className="truncate">{t.name}</span>
                        </button>
                    ))}
            </div>
        );
    };

    const selectedHomeRegion = props.homeRegions.length === 1 ? String(props.homeRegions[0]) : '';

    return (
        <aside className="w-[255px] min-w-[255px] max-w-[255px] [@media(max-height:1100px)]:w-[245px] [@media(max-height:1100px)]:min-w-[245px] [@media(max-height:1100px)]:max-w-[245px] flex-none overflow-hidden border border-[#2c2f36] bg-[#070910] flex flex-col">
            <div className={panelHeader}>Market Browser</div>
            <div className="p-2 [@media(max-height:1100px)]:p-1.5 border-b border-[#2c2f36] space-y-2 [@media(max-height:1100px)]:space-y-1">
                <div className="relative">
                        <Search size={13} className="absolute left-2 top-2 text-slate-500" />
                        <input
                            className={classNames(inputClass, 'w-full pl-7')}
                            value={props.search}
                            onChange={(e) => props.setSearch(e.target.value)}
                            placeholder="Search items..."
                        />
                </div>
                {props.items.length > 0 && (
                    <div className="max-h-48 [@media(max-height:1100px)]:max-h-24 overflow-y-auto bg-[#05070b] border border-[#303236] text-[11px] scrollbar-thin scrollbar-track-[#05070b] scrollbar-thumb-[#252836]">
                            {props.items.map((i) => (
                                <button
                                    type="button"
                                    key={i.type_id}
                                    className="w-full px-2 py-1 hover:bg-[#141821] cursor-pointer flex items-center gap-2 text-left"
                                    onClick={() => props.onSelectType(i.type_id, i.type_name)}
                                >
                                    <img
                                        src={typeIconUrl(i.type_id, i.type_name, 32)}
                                        alt=""
                                        className="w-4 h-4 flex-none"
                                        loading="lazy"
                                        onError={onImgError}
                                    />
                                    <span className="truncate">{i.type_name}</span>
                                </button>
                            ))}
                        </div>
                )}

                <div className="grid grid-cols-[1fr,auto,auto] gap-1">
                    <select
                        className={classNames(selectClass, 'w-full py-1')}
                        value={selectedHomeRegion}
                        onChange={(e) => props.setHomeRegions(e.target.value ? [Number(e.target.value)] : [])}
                        title="Home Region scopes all-items, quickbar ticker, and default item filters. Empty means all regions."
                    >
                        <option value="">All Regions</option>
                        {props.regions.map((r) => (
                            <option key={r.region_id} value={r.region_id}>
                                {r.region_name}
                            </option>
                        ))}
                    </select>
                    <button type="button" className={buttonBase} onClick={() => props.setHomeRegions([])}>All</button>
                    <button type="button" className={buttonBase} onClick={() => props.setHomeRegions(TOP_REGION_ORDER)}>Top</button>
                </div>

                <button
                    type="button"
                    className={classNames(buttonBase, 'w-full', props.tradeHubsOnly && buttonActive)}
                    onClick={() => props.setTradeHubsOnly(!props.tradeHubsOnly)}
                    title="Limit the selected item order book to Jita, Amarr, Dodixie, Rens, and Hek within the current market-region scope."
                >
                    Trade Hubs Only
                </button>

                <div className="grid grid-cols-2 border border-[#303236] bg-[#05070b]">
                    <button
                        type="button"
                        className={classNames('px-2 py-1 text-[10px] uppercase tracking-widest hover:bg-[#101219]', props.leftTab === 'browse' && 'bg-[#101b27] text-[#53b6ff]')}
                        onClick={() => props.setLeftTab('browse')}
                    >
                        Browse
                    </button>
                    <button
                        type="button"
                        className={classNames('px-2 py-1 text-[10px] uppercase tracking-widest hover:bg-[#101219]', props.leftTab === 'quickbar' && 'bg-[#101b27] text-[#53b6ff]')}
                        onClick={() => props.setLeftTab('quickbar')}
                    >
                        Quickbar
                    </button>
                </div>
            </div>

            {props.leftTab === 'browse' ? (
                <div className="flex-1 min-h-0 overflow-y-auto text-[11px] scrollbar-thin scrollbar-track-[#05070b] scrollbar-thumb-[#252836]">
                    <button
                        type="button"
                        className={classNames(
                            'w-full flex items-center justify-between px-2 py-1.5 border-b border-[#262933] text-left',
                            props.activeView === 'all' ? 'bg-[#101b27] text-slate-100' : 'hover:bg-[#141821] text-slate-300'
                        )}
                        onClick={props.openAllItems}
                    >
                        <span>All Items</span>
                        <span className="text-[10px] text-slate-500">{props.allTotal ? props.allTotal.toLocaleString() : ''}</span>
                    </button>
                    {props.tree.length === 0 ? (
                        <div className="px-3 py-2 text-slate-500">Loading...</div>
                    ) : (
                        props.tree.map((node) => renderNode(node))
                    )}
                </div>
            ) : (
                <div className="flex-1 min-h-0 p-2 [@media(max-height:1100px)]:p-1.5 flex flex-col gap-2 [@media(max-height:1100px)]:gap-1 overflow-hidden">
                    <div className="flex flex-wrap gap-1">
                        <button
                            type="button"
                            className={buttonBase}
                            onClick={() => props.setBulkOpen(!props.bulkOpen)}
                            title="Bulk paste item names"
                        >
                            <ClipboardPaste size={12} /> Paste
                        </button>
                        <button type="button" className={buttonBase} onClick={props.exportQuickbar} title="Copy quickbar names">
                            <Download size={12} /> Export
                        </button>
                        <button
                            type="button"
                            className={buttonBase}
                            onClick={() => props.setQuickbarCollapsed(!props.quickbarCollapsed)}
                        >
                            {props.quickbarCollapsed ? 'Expand' : 'Collapse'}
                        </button>
                        <button
                            type="button"
                            className={classNames(buttonBase, props.clearConfirm && 'border-[#bf3b3b] text-[#ffb4b4]')}
                            onClick={() => (props.clearConfirm ? props.clearQuickbar() : props.setClearConfirm(true))}
                            title="Clear quickbar"
                        >
                            <Trash2 size={12} /> {props.clearConfirm ? 'Confirm' : 'Clear'}
                        </button>
                    </div>
                    <div className="border border-[#262933] bg-[#05070b] px-2 py-1 text-[10px] text-slate-400">
                        {!props.authChecked ? (
                            <span>Checking account sync...</span>
                        ) : props.authUser ? (
                            <span className="text-[#9bdcff]">
                                {props.remoteQuickbarReady ? 'Account quickbar syncing across devices.' : 'Loading account quickbar...'}
                            </span>
                        ) : (
                            <div className="flex items-center justify-between gap-2">
                                <span>Browser quickbar only.</span>
                                <button
                                    type="button"
                                    className="border border-[#53b6ff]/50 bg-[#0b1b2a] px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-100 hover:border-[#53b6ff]"
                                    onClick={props.requestQuickbarSignIn}
                                >
                                    Sign In
                                </button>
                            </div>
                        )}
                    </div>
                    {props.bulkOpen && (
                        <div className="space-y-1">
                            <textarea
                                className={classNames(inputClass, 'w-full min-h-[86px] resize-none')}
                                value={props.bulkText}
                                onChange={(e) => props.setBulkText(e.target.value)}
                                placeholder="Paste item names, fits, hangar lists, or comma-separated text..."
                            />
                            <button type="button" className={primaryButton} onClick={props.importQuickbar}>
                                Resolve & Add
                            </button>
                        </div>
                    )}
                    {props.quickbarMsg && <div className="text-[10px] text-[#53b6ff]">{props.quickbarMsg}</div>}
                    {!props.quickbarCollapsed && (
                        <div className="min-h-0 flex-1 overflow-y-auto border border-[#303236] bg-[#05070b] scrollbar-thin scrollbar-track-[#05070b] scrollbar-thumb-[#252836]">
                            {props.quickbar.length === 0 ? (
                                <div className="px-2 py-2 text-[10px] text-slate-500">Star items to track them here.</div>
                            ) : (
                                props.quickbar.map((item) => (
                                    <div
                                        key={item.type_id}
                                        className={classNames(
                                            'flex items-center gap-2 px-2 py-1 border-b border-[#262933] hover:bg-[#141821]',
                                            props.highlightAdded.includes(item.type_id) && 'bg-[#101b27]'
                                        )}
                                    >
                                        <button
                                            type="button"
                                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                            onClick={() => props.onSelectQuickbar(item.type_id, item.type_name)}
                                        >
                                            <img
                                                src={typeIconUrl(item.type_id, item.type_name, 32)}
                                                alt=""
                                                className="w-4 h-4"
                                                onError={onImgError}
                                            />
                                            <span className="truncate text-slate-200">{item.type_name}</span>
                                        </button>
                                        <button
                                            type="button"
                                            className="text-slate-500 hover:text-slate-100"
                                            onClick={() => props.removeQuickbar(item.type_id)}
                                            title="Remove"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            )}

            <div className="border-t border-[#262933] px-2 py-1 text-[9px] text-slate-500">
                Local live orders / regional history / SDE
            </div>
        </aside>
    );
}

function CategorySidebar(props: {
    tree: MarketTreeNode[];
    expanded: Record<number, boolean>;
    setExpanded: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
    openAllItems: () => void;
    openCategory: (id: number, name: string) => void;
    onSelectType: (typeId: number, name: string) => void;
    activeView: ActiveView;
    category: { id: number; name: string } | null;
    allTotal: number;
}) {
    const renderNode = (node: MarketTreeNode, depth = 0): JSX.Element => {
        const hasChildren = !!((node.children && node.children.length) || (node.types && node.types.length));
        const isExpanded = !!props.expanded[node.id];
        const active = props.activeView === 'category' && props.category?.id === node.id;

        return (
            <div key={node.id}>
                <button
                    type="button"
                    className={classNames(
                        'w-full flex items-center gap-1 cursor-pointer hover:bg-[#141821] px-2 py-1 text-[11px] text-slate-200 text-left',
                        active && 'bg-[#101b27] text-slate-100'
                    )}
                    style={{ paddingLeft: 6 + depth * 12 }}
                    onClick={() => {
                        props.openCategory(node.id, node.name);
                        if (hasChildren) {
                            props.setExpanded((prev) => ({ ...prev, [node.id]: !prev[node.id] }));
                        }
                    }}
                >
                    {hasChildren ? (
                        isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
                    ) : (
                        <span className="w-3 text-slate-600">.</span>
                    )}
                    <span className="truncate">{node.name}</span>
                </button>

                {isExpanded && node.children?.map((c) => renderNode(c, depth + 1))}
                {isExpanded &&
                    node.types?.map((t) => (
                        <button
                            type="button"
                            key={t.type_id}
                            className="w-full cursor-pointer hover:bg-[#141821] px-2 py-1 text-[11px] text-slate-200 flex items-center gap-2 text-left"
                            style={{ paddingLeft: 24 + depth * 12 }}
                            onClick={() => props.onSelectType(t.type_id, t.name)}
                        >
                            <img
                                src={typeIconUrl(t.type_id, t.name, 32)}
                                alt=""
                                className="w-4 h-4 flex-none"
                                loading="lazy"
                                onError={onImgError}
                            />
                            <span className="truncate">{t.name}</span>
                        </button>
                    ))}
            </div>
        );
    };

    return (
        <fieldset className="w-[320px] min-w-[320px] max-w-[320px] flex-none overflow-hidden border border-[#2c2f36] bg-[#070910] flex flex-col">
            <legend className={panelHeader}>Market Categories</legend>
            <div className="border-b border-[#2c2f36] p-2">
                <button
                    type="button"
                    className={classNames(
                        'w-full flex items-center justify-between px-2 py-1.5 border text-left text-[11px]',
                        props.activeView === 'all'
                            ? 'border-[#53b6ff] bg-[#101b27] text-slate-100'
                            : 'border-[#303236] bg-[#05070b] hover:border-[#53b6ff]/60'
                    )}
                    onClick={props.openAllItems}
                >
                    <span>All Items</span>
                    <span className="text-[10px] text-slate-500">{props.allTotal ? props.allTotal.toLocaleString() : ''}</span>
                </button>
            </div>
            <div className="flex-1 overflow-y-auto text-[11px] scrollbar-thin scrollbar-track-[#05070b] scrollbar-thumb-[#252836]">
                {props.tree.length === 0 ? (
                    <div className="px-3 py-2 text-slate-500">Loading...</div>
                ) : (
                    props.tree.map((node) => renderNode(node))
                )}
            </div>
        </fieldset>
    );
}

function Panel({
    title,
    children,
    className,
}: {
    title: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section className={classNames(panelBase, 'flex flex-col gap-2 p-2', className)}>
            <div className="text-[10px] uppercase tracking-widest text-slate-400">{title}</div>
            {children}
        </section>
    );
}

function AllItemsView(props: {
    activeView: ActiveView;
    category: { id: number; name: string } | null;
    rows: BrowserRow[];
    total: number;
    offset: number;
    setOffset: (n: number) => void;
    loading: boolean;
    search: string;
    setSearch: (v: string) => void;
    sort: string;
    direction: 'asc' | 'desc';
    clickSort: (key: string) => void;
    onSelectType: (typeId: number, name: string) => void;
    quickbar: Item[];
    toggleFavorite: (item: Item) => void;
    scopeText: string;
    noScam: boolean;
    setNoScam: (v: boolean) => void;
}) {
    const from = props.total === 0 ? 0 : props.offset + 1;
    const to = Math.min(props.offset + PAGE_SIZE, props.total);
    const title = props.activeView === 'category' && props.category ? props.category.name : 'All Items';
    return (
        <div className="flex h-full flex-col overflow-hidden">
            <div className="px-3 py-2 bg-[#101219] border-b border-[#2c2f36] flex items-center justify-between gap-3">
                <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-widest">
                        {props.activeView === 'category' ? 'Category View' : 'Flat Market View'}
                    </div>
                    <div className="text-[15px] font-semibold text-slate-100">{title}</div>
                </div>
                <div className="flex items-center gap-2">
                    <label className="relative">
                        <Search size={13} className="absolute left-2 top-2 text-slate-500" />
                        <input
                            className={classNames(inputClass, 'w-72 pl-7')}
                            value={props.search}
                            onChange={(e) => props.setSearch(e.target.value)}
                            placeholder="Filter by item name..."
                        />
                    </label>
                    <button
                        type="button"
                        className={classNames(buttonBase, props.noScam && buttonActive)}
                        onClick={() => props.setNoScam(!props.noScam)}
                        title="Median-based tail clipping for obvious outlier orders."
                    >
                        NO SCAM
                    </button>
                    <span className="border border-[#303236] bg-[#05070b] px-2 py-1 text-[10px] text-slate-400">
                        {props.scopeText}
                    </span>
                </div>
            </div>

            <div className="flex-1 min-h-0 p-3 overflow-hidden">
                <div className="h-full overflow-auto border border-[#303236] bg-[#05070b] scrollbar-thin scrollbar-track-[#05070b] scrollbar-thumb-[#252836]">
                    <table className="min-w-[1500px] w-full text-[11px] border-collapse">
                        <thead className="sticky top-0 z-10">
                            <tr>
                                <th className={classNames(tableHead, 'w-8')} />
                                <SortTh label="Item" keyName="item" {...props} align="left" />
                                <SortTh label="m3" keyName="volume_m3" {...props} align="right" />
                                <SortTh label="Best Sell" keyName="best_sell" {...props} align="right" />
                                <SortTh label="Best Buy" keyName="best_buy" {...props} align="right" />
                                <SortTh label="Spread" keyName="spread" {...props} align="right" />
                                <SortTh label="Avg Price" keyName="avg_price" {...props} align="right" />
                                <SortTh label="Delta" keyName="delta_price" {...props} align="right" />
                                <th className={classNames(tableHead, 'text-left')}>Trend</th>
                                <SortTh label="ISK/day" keyName="isk_day" {...props} align="right" />
                                <SortTh label="Vol/day" keyName="vol_day" {...props} align="right" />
                                <SortTh label="Sell Vol" keyName="sell_volume" {...props} align="right" />
                                <SortTh label="Buy Vol" keyName="buy_volume" {...props} align="right" />
                                <SortTh label="Sell Orders" keyName="sell_orders" {...props} align="right" />
                                <SortTh label="Buy Orders" keyName="buy_orders" {...props} align="right" />
                            </tr>
                        </thead>
                        <tbody>
                            {props.loading ? (
                                <tr><td colSpan={15} className="px-3 py-4 text-slate-400">Loading market rows...</td></tr>
                            ) : props.rows.length === 0 ? (
                                <tr><td colSpan={15} className="px-3 py-4 text-slate-400">No live-order items match the current scope.</td></tr>
                            ) : (
                                props.rows.map((row, i) => {
                                    const fav = props.quickbar.some((q) => q.type_id === row.type_id);
                                    return (
                                        <tr
                                            key={row.type_id}
                                            className={classNames(
                                                i % 2 === 0 ? 'bg-[#090b11]' : 'bg-[#0c0f16]',
                                                'hover:bg-[#141821] border-b border-[#2b2d33]/70'
                                            )}
                                        >
                                            <td className={tableCell}>
                                                <button
                                                    type="button"
                                                    className="text-[#53b6ff] hover:text-slate-100"
                                                    onClick={() => props.toggleFavorite({ type_id: row.type_id, type_name: row.type_name })}
                                                    title={fav ? 'Remove from quickbar' : 'Add to quickbar'}
                                                >
                                                    <Star size={14} fill={fav ? '#53b6ff' : 'none'} />
                                                </button>
                                            </td>
                                            <td className={classNames(tableCell, 'min-w-[260px]')}>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-slate-100 hover:text-[#53b6ff]"
                                                        onClick={() => props.onSelectType(row.type_id, row.type_name)}
                                                    >
                                                        <img
                                                            src={typeIconUrl(row.type_id, row.type_name, 32)}
                                                            alt=""
                                                            className="w-5 h-5 flex-none"
                                                            loading="lazy"
                                                            onError={onImgError}
                                                        />
                                                        <span className="truncate">{row.type_name}</span>
                                                    </button>
                                                    <a
                                                        href={`/items/${row.type_id}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="ml-auto inline-flex h-6 w-6 flex-none items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 opacity-75 hover:border-[#53b6ff]/70 hover:bg-[#101b27] hover:text-[#9dd8ff] hover:opacity-100"
                                                        title={`Show info: ${row.type_name}`}
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <InfoGlyph />
                                                        <span className="sr-only">Show info</span>
                                                    </a>
                                                </div>
                                            </td>
                                            <TdRight>{fmtM3(row.volume_m3)}</TdRight>
                                            <TdRight>{fmtIsk(row.best_sell)}</TdRight>
                                            <TdRight>{fmtIsk(row.best_buy)}</TdRight>
                                            <TdRight>
                                                <span className={row.spread != null && row.spread > 0 ? 'text-[#3bbf5a]' : ''}>
                                                    {fmtIsk(row.spread)} {row.spread_pct != null ? `(${fmtPct(row.spread_pct)})` : ''}
                                                </span>
                                            </TdRight>
                                            <TdRight>{fmtIsk(row.avg_price)}</TdRight>
                                            <TdRight>
                                                <Delta value={row.delta_price} />
                                            </TdRight>
                                            <td className={tableCell}>
                                                <Sparkline points={row.sparkline} />
                                            </td>
                                            <TdRight>{fmtIsk(row.isk_day)}</TdRight>
                                            <TdRight>{fmtQty(row.vol_day)}</TdRight>
                                            <TdRight>{fmtQty(row.sell_volume)}</TdRight>
                                            <TdRight>{fmtQty(row.buy_volume)}</TdRight>
                                            <TdRight>{fmtQty(row.sell_orders)}</TdRight>
                                            <TdRight>{fmtQty(row.buy_orders)}</TdRight>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="flex items-center justify-between px-3 py-2 border-t border-[#2c2f36] bg-[#05070b] text-[10px] text-slate-400">
                <span>
                    Showing {from.toLocaleString()}-{to.toLocaleString()} of {props.total.toLocaleString()}
                </span>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        className={buttonBase}
                        disabled={props.offset === 0 || props.loading}
                        onClick={() => props.setOffset(Math.max(0, props.offset - PAGE_SIZE))}
                    >
                        Prev
                    </button>
                    <button
                        type="button"
                        className={buttonBase}
                        disabled={props.offset + PAGE_SIZE >= props.total || props.loading}
                        onClick={() => props.setOffset(props.offset + PAGE_SIZE)}
                    >
                        Next
                    </button>
                </div>
            </div>
        </div>
    );
}

function SortTh({
    label,
    keyName,
    sort,
    direction,
    clickSort,
    align,
}: {
    label: string;
    keyName: string;
    sort: string;
    direction: 'asc' | 'desc';
    clickSort: (key: string) => void;
    align: 'left' | 'right';
}) {
    const active = sort === keyName;
    return (
        <th
            className={classNames(tableHead, align === 'right' ? 'text-right' : 'text-left', 'cursor-pointer select-none')}
            onClick={() => clickSort(keyName)}
            title="Click to sort"
        >
            {label} <span className="text-[#53b6ff]">{active ? (direction === 'asc' ? '^' : 'v') : ''}</span>
        </th>
    );
}

function TdRight({ children }: { children: React.ReactNode }) {
    return <td className={classNames(tableCell, 'text-right font-mono whitespace-nowrap')}>{children}</td>;
}

function Delta({ value }: { value: number | null | undefined }) {
    if (value == null || !Number.isFinite(value)) return <span>-</span>;
    return <span className={value >= 0 ? 'text-[#3bbf5a]' : 'text-[#ff8b8b]'}>{fmtPct(value)}</span>;
}

function Sparkline({ points }: { points: { date: string; avg_price: number | null }[] }) {
    const vals = points.map((p) => n(p.avg_price)).filter((v): v is number => v != null);
    if (vals.length < 2) return <span className="text-slate-600">-</span>;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const coords = vals
        .map((v, idx) => {
            const x = (idx / (vals.length - 1)) * 80;
            const y = 22 - ((v - min) / range) * 18;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
    const rising = vals[vals.length - 1] >= vals[0];
    return (
        <svg width="88" height="26" viewBox="0 0 88 26" className="block">
            <polyline
                points={coords}
                transform="translate(4 1)"
                fill="none"
                stroke={rising ? '#3bbf5a' : '#ff8b8b'}
                strokeWidth="1.5"
            />
        </svg>
    );
}

function ItemView(props: {
    selected: Item;
    itemSummary: ItemSummary | null;
    orders: OrdersResponse | null;
    visibleStats: Record<string, number | null>;
    regions: Region[];
    historyRegions: number[];
    setHistoryRegions: (v: number[]) => void;
    plexSelected: boolean;
    stationType: 'all' | 'npc' | 'player';
    setStationType: (v: 'all' | 'npc' | 'player') => void;
    selectedLocation: number | null;
    setSelectedLocation: (v: number | null) => void;
    locations: { id: number; name: string }[];
    tradeHubsOnly: boolean;
    noScam: boolean;
    setNoScam: (v: boolean) => void;
    showDepth: boolean;
    setShowDepth: (v: boolean) => void;
    loadingOrders: boolean;
    historyDays: number;
    setHistoryDays: (v: number) => void;
    historyView: HistoryView;
    setHistoryView: (v: HistoryView) => void;
    historyToggles: {
        average: boolean;
        range: boolean;
        volume: boolean;
        ma7: boolean;
        ma28: boolean;
    };
    setHistoryToggles: React.Dispatch<React.SetStateAction<{
        average: boolean;
        range: boolean;
        volume: boolean;
        ma7: boolean;
        ma28: boolean;
    }>>;
    historyRows: HistoryRow[];
    historyStats: HistoryResponse['stats'] | null;
    loadingHistory: boolean;
    historySort: 'date' | 'region' | 'avg' | 'low' | 'high' | 'volume' | 'orders' | 'ma7' | 'ma28';
    historyDir: 'asc' | 'desc';
    clickHistorySort: (key: 'date' | 'region' | 'avg' | 'low' | 'high' | 'volume' | 'orders' | 'ma7' | 'ma28') => void;
    quickbar: Item[];
    toggleFavorite: (item: Item) => void;
}) {
    const favorite = props.quickbar.some((q) => q.type_id === props.selected.type_id);
    const breadcrumb = props.itemSummary?.breadcrumb?.map((b) => b.name).join(' / ');

    return (
        <div className="flex h-full flex-col overflow-hidden">
            <div className="px-3 py-2 [@media(max-height:1100px)]:px-2 [@media(max-height:1100px)]:py-1 bg-[#101219] border-b border-[#2c2f36] flex items-center justify-between gap-3 [@media(max-height:1100px)]:gap-2">
                <div className="flex items-center gap-3 [@media(max-height:1100px)]:gap-2 min-w-0">
                    <img
                        src={typeIconUrl(props.selected.type_id, props.selected.type_name, 64)}
                        alt=""
                        className="w-10 h-10 [@media(max-height:1100px)]:w-8 [@media(max-height:1100px)]:h-8 rounded-sm flex-none"
                        loading="lazy"
                        onError={onImgError}
                    />
                    <div className="min-w-0">
                        <div className="text-[10px] text-slate-500 uppercase tracking-widest truncate [@media(max-height:1100px)]:text-[9px]">
                            {breadcrumb || 'Market Browser'} {props.plexSelected ? ' / Global PLEX' : ''}
                        </div>
                        <div className="flex items-center gap-2 text-[15px] [@media(max-height:1100px)]:text-[13px] font-semibold text-slate-100 min-w-0">
                            <span className="truncate">{props.selected.type_name}</span>
                            <span className="flex-none text-[10px] text-slate-500">#{props.selected.type_id}</span>
                            <a
                                href={`/items/${props.selected.type_id}`}
                                target="_blank"
                                rel="noreferrer"
                                className={classNames(
                                    buttonBase,
                                    'h-6 flex-none border-[#53b6ff]/50 px-2 py-0 text-[9px] text-[#9dd8ff] hover:border-[#53b6ff] hover:text-slate-100 [@media(max-height:1100px)]:h-5 [@media(max-height:1100px)]:py-0'
                                )}
                                title={`Open Item Browser for ${props.selected.type_name}`}
                            >
                                <InfoGlyph className="h-3 w-3" /> Show Info
                            </a>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        className={classNames(buttonBase, favorite && buttonActive)}
                        onClick={() => props.toggleFavorite(props.selected)}
                        title={favorite ? 'Remove from quickbar' : 'Add to quickbar'}
                    >
                        <Star size={13} fill={favorite ? '#53b6ff' : 'none'} />
                    </button>
                    <button type="button" className={buttonBase} onClick={() => copyText(props.selected.type_name)}>
                        <Copy size={13} /> Name
                    </button>
                    <button type="button" className={buttonBase} onClick={() => copyText(String(props.selected.type_id))}>
                        <Copy size={13} /> Type ID
                    </button>
                </div>
            </div>

            <div className="border-b border-[#2c2f36] bg-[#05070b] px-2 py-1.5 [@media(max-height:1100px)]:py-1">
                <div className="grid grid-cols-5 2xl:grid-cols-10 gap-1">
                    <Stat label="Avg Price" value={fmtIsk(props.visibleStats.avg_price)} title="Volume-weighted average price over the selected history range and region scope." />
                    <Stat label="Delta Price" value={<Delta value={props.visibleStats.delta_price} />} title="30-day volume-weighted average versus the previous 30-day window." />
                    <Stat label="ISK/day" value={fmtIsk(props.visibleStats.isk_day)} title="Average daily traded ISK from regional history in the selected scope." />
                    <Stat label="Vol/day" value={fmtQty(props.visibleStats.vol_day)} title="Average daily traded units from regional history in the selected scope." />
                    <Stat label="Spread" value={fmtIsk(props.visibleStats.spread)} title="Best Buy minus Best Sell. Positive means the highest buy order is above the lowest sell order." />
                    <Stat label="Best Sell" value={fmtIsk(props.visibleStats.best_sell)} title="Lowest sell order: what you pay to buy immediately." />
                    <Stat label="Best Buy" value={fmtIsk(props.visibleStats.best_buy)} title="Highest buy order: what you receive when selling immediately." />
                    <Stat label="Sell Orders" value={fmtQty(props.visibleStats.sell_orders)} title="Live sell order count after current order filters." />
                    <Stat label="Buy Orders" value={fmtQty(props.visibleStats.buy_orders)} title="Live buy order count after current order filters." />
                    <Stat label="Live Volume" value={`${fmtCompact(props.visibleStats.sell_volume)} / ${fmtCompact(props.visibleStats.buy_volume)}`} title="Sell volume / buy volume after current order filters." />
                </div>
            </div>

            <div className="flex-1 min-h-0 p-2 [@media(max-height:1100px)]:p-1 grid grid-rows-[minmax(220px,30vh)_auto_minmax(0,1fr)] [@media(max-height:1100px)]:grid-rows-[minmax(260px,30vh)_auto_minmax(0,1fr)] gap-2 [@media(max-height:1100px)]:gap-1 overflow-hidden">
                <div className={classNames('min-h-0 grid gap-2 [@media(max-height:1100px)]:gap-1', props.showDepth ? 'grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] [@media(max-height:1100px)]:grid-cols-[minmax(0,2.35fr)_minmax(320px,0.85fr)]' : 'grid-cols-1')}>
                    <HistorySection {...props} />
                    {props.showDepth && props.orders && (
                        <fieldset className={classNames(panelBase, 'min-h-0 flex flex-col overflow-hidden')}>
                            <legend className={panelHeader}>Depth Chart</legend>
                            <div className="min-h-0 flex-1 p-2 [@media(max-height:1100px)]:p-1">
                                <DepthChart levels={props.orders.depth || []} />
                            </div>
                        </fieldset>
                    )}
                </div>

                <OrderFilters {...props} />

                <div className="min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 [@media(max-height:1100px)]:gap-1">
                    <OrderTable title="Sell Orders" side="sell" rows={props.orders?.sellers || []} loading={props.loadingOrders} plex={props.plexSelected} />
                    <OrderTable title="Buy Orders" side="buy" rows={props.orders?.buyers || []} loading={props.loadingOrders} plex={props.plexSelected} />
                </div>
            </div>
        </div>
    );
}

function Stat({ label, value, title }: { label: string; value: React.ReactNode; title: string }) {
    return (
        <div className="border border-[#303236] bg-[#070910] px-2 [@media(max-height:1100px)]:px-1.5 py-0.5 [@media(max-height:1100px)]:py-0 min-w-0" title={title}>
            <div className="text-[9px] [@media(max-height:1100px)]:text-[8px] uppercase tracking-widest text-slate-500">{label}</div>
            <div className="font-mono text-[11px] [@media(max-height:1100px)]:text-[10px] text-slate-100 truncate">{value}</div>
        </div>
    );
}

function OrderFilters(props: Parameters<typeof ItemView>[0]) {
    const reset = () => {
        props.setSelectedLocation(null);
        props.setStationType('all');
    };

    if (props.plexSelected) {
        return (
            <fieldset className={classNames(panelBase, 'p-1')}>
                <legend className={panelHeader}>Order Filters</legend>
                <div className="flex items-center gap-2 overflow-hidden">
                    <span className="min-w-0 truncate border border-[#303236] bg-[#05070b] px-2 py-0.5 text-[10px] text-slate-400">
                        PLEX uses global order context.
                    </span>
                    <ToggleButton active={props.noScam} onClick={() => props.setNoScam(!props.noScam)} title="Median-based tail clipping.">
                        NO SCAM
                    </ToggleButton>
                    <ToggleButton active={props.showDepth} onClick={() => props.setShowDepth(!props.showDepth)} title="Show cumulative depth chart.">
                        Depth
                    </ToggleButton>
                </div>
            </fieldset>
        );
    }

    return (
        <fieldset className={classNames(panelBase, 'p-1')}>
            <legend className={panelHeader}>Order Filters</legend>
            <div className="flex items-end gap-2 [@media(max-height:1100px)]:gap-1 overflow-hidden">
                <label className="min-w-[220px] flex-[1_1_360px]">
                    <span className="block text-[10px] [@media(max-height:1100px)]:text-[9px] uppercase tracking-widest text-slate-400">
                        Location
                    </span>
                    <select
                        className={classNames(selectClass, 'w-full')}
                        value={props.selectedLocation ?? ''}
                        onChange={(e) => props.setSelectedLocation(e.target.value ? Number(e.target.value) : null)}
                    >
                        <option value="">Any location</option>
                        {props.locations.map((l) => (
                            <option key={l.id} value={l.id}>
                                {l.name}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="w-[190px] [@media(max-height:1100px)]:w-[170px] flex-none">
                    <span className="block text-[10px] [@media(max-height:1100px)]:text-[9px] uppercase tracking-widest text-slate-400">
                        Station
                    </span>
                    <select
                        className={classNames(selectClass, 'w-full')}
                        value={props.stationType}
                        disabled={props.tradeHubsOnly}
                        onChange={(e) => props.setStationType(e.target.value as 'all' | 'npc' | 'player')}
                        title={props.tradeHubsOnly ? 'Trade Hubs Only already limits orders to NPC trade hub stations.' : undefined}
                    >
                        <option value="all">NPC + Player stations</option>
                        <option value="npc">NPC stations</option>
                        <option value="player">Player structures</option>
                    </select>
                </label>

                <ToggleButton active={props.noScam} onClick={() => props.setNoScam(!props.noScam)} title="Drops sells above 10x median and buys below 0.1x median after normal filters.">
                    NO SCAM
                </ToggleButton>
                <ToggleButton active={props.showDepth} onClick={() => props.setShowDepth(!props.showDepth)}>
                    Depth
                </ToggleButton>
                <button type="button" className={buttonBase} onClick={reset}>
                    <RefreshCcw size={12} /> Reset
                </button>
                <span className="min-w-0 truncate text-[10px] text-slate-500">
                    {props.tradeHubsOnly
                        ? 'Orders use trade hubs inside the market regions selected above.'
                        : 'Orders use the market regions selected above and always show sell + buy.'}
                </span>
            </div>
        </fieldset>
    );
}

function ToggleButton({
    active,
    onClick,
    children,
    title,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
    title?: string;
}) {
    return (
        <button type="button" className={classNames(buttonBase, active && buttonActive)} onClick={onClick} title={title}>
            {children}
        </button>
    );
}

function DepthChart({ levels }: { levels: { side: 'sell' | 'buy'; price: number; volume: number }[] }) {
    const sells = levels
        .filter((l) => l.side === 'sell' && Number.isFinite(l.price) && Number.isFinite(l.volume))
        .sort((a, b) => a.price - b.price);
    const buys = levels
        .filter((l) => l.side === 'buy' && Number.isFinite(l.price) && Number.isFinite(l.volume))
        .sort((a, b) => b.price - a.price);
    const toPoints = (rows: typeof sells) => {
        let acc = 0;
        return rows.map((r) => {
            acc += Number(r.volume) || 0;
            return { price: r.price, volume: acc };
        });
    };
    const sellPoints = toPoints(sells);
    const buyPoints = toPoints(buys);
    const all = [...sellPoints, ...buyPoints];
    if (all.length < 2) return <div className="px-2 py-3 text-slate-500">No depth data for the current filters.</div>;

    const minPrice = Math.min(...all.map((p) => p.price));
    const maxPrice = Math.max(...all.map((p) => p.price));
    const maxVol = Math.max(...all.map((p) => p.volume));
    const width = 900;
    const height = 180;
    const x = (price: number) => ((price - minPrice) / (maxPrice - minPrice || 1)) * (width - 40) + 20;
    const y = (vol: number) => height - 20 - (vol / (maxVol || 1)) * (height - 40);
    const line = (rows: typeof sellPoints) => rows.map((p) => `${x(p.price).toFixed(1)},${y(p.volume).toFixed(1)}`).join(' ');

    return (
        <div className="h-full min-h-[180px] bg-[#05070b] border border-[#303236] overflow-hidden">
            <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full">
                <line x1="20" y1={height - 20} x2={width - 20} y2={height - 20} stroke="#303236" />
                <line x1="20" y1="20" x2="20" y2={height - 20} stroke="#303236" />
                <polyline points={line(buyPoints)} fill="none" stroke="#3bbf5a" strokeWidth="2" />
                <polyline points={line(sellPoints)} fill="none" stroke="#ff8b8b" strokeWidth="2" />
                <text x="28" y="36" fill="#3bbf5a" fontSize="11">Buy cumulative</text>
                <text x="28" y="52" fill="#ff8b8b" fontSize="11">Sell cumulative</text>
                <text x={width - 170} y={height - 7} fill="#7f8798" fontSize="10">
                    {fmtIsk(minPrice)} to {fmtIsk(maxPrice)}
                </text>
            </svg>
        </div>
    );
}

function OrderTable({
    title,
    side,
    rows,
    loading,
    plex,
}: {
    title: string;
    side: 'sell' | 'buy';
    rows: OrderRow[];
    loading: boolean;
    plex: boolean;
}) {
    return (
        <fieldset className={classNames(panelBase, 'h-full min-h-0 min-w-0 flex flex-col overflow-hidden')}>
            <legend className={panelHeader}>{title}</legend>
            <div className="flex-1 min-h-0 bg-[#05070b] border-t border-[#2c2f36] overflow-auto scrollbar-thin scrollbar-track-[#05070b] scrollbar-thumb-[#252836]">
                <table className={classNames(plex ? 'min-w-full' : 'min-w-full [@media(min-height:1101px)]:min-w-[940px]', 'w-full text-[11px] [@media(max-height:1100px)]:text-[10px] border-collapse')}>
                    <thead className="bg-[#14161d] sticky top-0 z-10">
                        <tr>
                            <th className={classNames(tableHead, 'text-right')}>Price</th>
                            <th className={classNames(tableHead, 'text-right')}>Volume</th>
                            {!plex && <th className={classNames(tableHead, 'text-right')}>m3</th>}
                            {!plex && <th className={classNames(tableHead, 'text-left')}>Region</th>}
                            {!plex && <th className={classNames(tableHead, 'text-left [@media(max-height:1100px)]:hidden')}>Station</th>}
                            {!plex && <th className={classNames(tableHead, 'text-left')}>Location</th>}
                            {side === 'buy' && <th className={classNames(tableHead, 'text-right')}>Range</th>}
                            {side === 'buy' && <th className={classNames(tableHead, 'text-right')}>Min</th>}
                            <th className={classNames(tableHead, 'text-right')}>Expires</th>
                            <th className={classNames(tableHead, 'text-right border-r-0 [@media(max-height:1100px)]:hidden')}>Issued</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={10} className="px-3 py-3 text-slate-400">Loading orders...</td></tr>
                        ) : rows.length === 0 ? (
                            <tr><td colSpan={10} className="px-3 py-3 text-slate-400">No {side} orders match the current filters.</td></tr>
                        ) : (
                            rows.map((o, i) => (
                                <tr
                                    key={o.order_id}
                                    className={classNames(
                                        i % 2 === 0 ? 'bg-[#090b11]' : 'bg-[#0c0f16]',
                                        'hover:bg-[#141821] border-b border-[#2b2d33]/70'
                                    )}
                                >
                                    <TdRight>{fmtIsk(o.price, false)}</TdRight>
                                    <TdRight>{fmtQty(o.volume_remain)}</TdRight>
                                    {!plex && <TdRight>{fmtM3(o.volume_m3)}</TdRight>}
                                    {!plex && <td className={tableCell}>{o.region_name}</td>}
                                    {!plex && <td className={classNames(tableCell, '[@media(max-height:1100px)]:hidden')}>{o.station_type === 'npc' ? 'NPC STN' : 'PLR STN'}</td>}
                                    {!plex && (
                                        <td className={classNames(tableCell, 'min-w-[145px] max-w-[220px] [@media(min-height:1101px)]:min-w-[240px]')}>
                                            <div className="flex items-center gap-2">
                                                <span className="truncate">{o.location_name}</span>
                                                <button
                                                    type="button"
                                                    className="text-slate-500 hover:text-slate-100"
                                                    onClick={() => copyText(o.location_name)}
                                                    title="Copy location name"
                                                >
                                                    <Copy size={11} />
                                                </button>
                                            </div>
                                            <div className="text-[10px] [@media(max-height:1100px)]:text-[9px] text-slate-600">{o.system_name}</div>
                                        </td>
                                    )}
                                    {side === 'buy' && <TdRight>{rangeText(o.range)}</TdRight>}
                                    {side === 'buy' && <TdRight>{fmtQty(o.min_volume)}</TdRight>}
                                    <TdRight>{fmtExpires(o.expires_at)}</TdRight>
                                    <td className={classNames(tableCell, 'text-right font-mono whitespace-nowrap [@media(max-height:1100px)]:hidden')}>{fmtAgo(o.issued)}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </fieldset>
    );
}

function HistorySection(props: Parameters<typeof ItemView>[0]) {
    const regionMap = useMemo(() => {
        const map = new Map<number, string>();
        for (const row of props.historyRows) map.set(row.region_id, row.region_name);
        return map;
    }, [props.historyRows]);

    const regionIds = useMemo(() => Array.from(regionMap.keys()).sort((a, b) => {
        const an = regionMap.get(a) || '';
        const bn = regionMap.get(b) || '';
        return an.localeCompare(bn);
    }), [regionMap]);
    const singleRegion = regionIds.length <= 1;

    const chartData = useMemo(() => {
        const byDate = new Map<string, Record<string, string | number | null>>();
        for (const row of props.historyRows) {
            const key = fmtDate(row.date);
            const entry = byDate.get(key) || { date: key, volume_total: 0 };
            if (singleRegion) {
                entry.avg = row.avg_price;
                entry.low = row.low_price;
                entry.high = row.high_price;
                entry.ma7 = row.ma7;
                entry.ma28 = row.ma28;
                entry.volume_total = Number(entry.volume_total || 0) + Number(row.volume || 0);
            } else {
                entry[`avg_${row.region_id}`] = row.avg_price;
                entry[`ma7_${row.region_id}`] = row.ma7;
                entry[`ma28_${row.region_id}`] = row.ma28;
                entry.volume_total = Number(entry.volume_total || 0) + Number(row.volume || 0);
            }
            byDate.set(key, entry);
        }
        return Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }, [props.historyRows, singleRegion]);

    const sortedRows = useMemo(() => {
        const rows = [...props.historyRows];
        rows.sort((a, b) => {
            const dir = props.historyDir === 'asc' ? 1 : -1;
            const pick = (r: HistoryRow): string | number => {
                if (props.historySort === 'date') return new Date(r.date).getTime();
                if (props.historySort === 'region') return r.region_name;
                if (props.historySort === 'avg') return r.avg_price ?? -1;
                if (props.historySort === 'low') return r.low_price ?? -1;
                if (props.historySort === 'high') return r.high_price ?? -1;
                if (props.historySort === 'volume') return r.volume ?? -1;
                if (props.historySort === 'orders') return r.orders ?? -1;
                if (props.historySort === 'ma7') return r.ma7 ?? -1;
                return r.ma28 ?? -1;
            };
            const av = pick(a);
            const bv = pick(b);
            if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * dir;
            return (av - bv) * dir;
        });
        return rows;
    }, [props.historyRows, props.historySort, props.historyDir]);

    return (
        <fieldset className={classNames(panelBase, 'h-full min-h-0 flex flex-col overflow-hidden')}>
            <legend className={panelHeader}>Price History</legend>
            <div className="flex flex-wrap items-center justify-between gap-1 border-b border-[#2c2f36] bg-[#05070b] p-1 [@media(max-height:1100px)]:p-0.5">
                <div className="flex flex-wrap items-center gap-1">
                    {HISTORY_RANGES.map((days) => (
                        <ToggleButton key={days} active={props.historyDays === days} onClick={() => props.setHistoryDays(days)}>
                            {days}D
                        </ToggleButton>
                    ))}
                    <span className="mx-1 h-5 w-px bg-[#303236]" />
                    {(['chart', 'both', 'table'] as HistoryView[]).map((mode) => (
                        <ToggleButton key={mode} active={props.historyView === mode} onClick={() => props.setHistoryView(mode)}>
                            {mode}
                        </ToggleButton>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                    {[
                        ['average', 'Average'],
                        ['range', 'High/Low'],
                        ['volume', 'Volume'],
                        ['ma7', '7D MA'],
                        ['ma28', '28D MA'],
                    ].map(([key, label]) => (
                        <ToggleButton
                            key={key}
                            active={!!props.historyToggles[key as keyof typeof props.historyToggles]}
                            onClick={() =>
                                props.setHistoryToggles((prev) => ({
                                    ...prev,
                                    [key]: !prev[key as keyof typeof prev],
                                }))
                            }
                        >
                            {label}
                        </ToggleButton>
                    ))}
                </div>
            </div>

            {!props.plexSelected && (
                <div className="border-b border-[#2c2f36] bg-[#05070b] p-1 [@media(max-height:1100px)]:p-0.5">
                    <div className="flex items-start gap-2 [@media(max-height:1100px)]:gap-1">
                        <div className="text-[10px] uppercase tracking-widest text-slate-400 pt-1 [@media(max-height:1100px)]:pt-0.5">Market Regions</div>
                        <select
                            multiple
                            size={2}
                            className={classNames(selectClass, 'min-w-[260px] py-0.5 [@media(max-height:1100px)]:h-7 [@media(max-height:1100px)]:min-w-[220px]')}
                            value={props.historyRegions.map(String)}
                            onChange={(e) => props.setHistoryRegions(Array.from(e.currentTarget.selectedOptions).map((o) => Number(o.value)))}
                            title="Scopes both price history and the order book. Empty means all regions."
                        >
                            {props.regions.map((r) => (
                                <option key={r.region_id} value={r.region_id}>
                                    {r.region_name}
                                </option>
                            ))}
                        </select>
                        <button type="button" className={buttonBase} onClick={() => props.setHistoryRegions([])}>
                            All Regions
                        </button>
                        <div className="text-[10px] text-slate-500 pt-1 [@media(max-height:1100px)]:pt-0.5">
                            VWAP: {fmtIsk(props.historyStats?.avg_price)} / Vol/day: {fmtQty(props.historyStats?.vol_day)}
                        </div>
                    </div>
                </div>
            )}

            <div
                className={classNames(
                    'flex-1 min-h-0 p-1 [@media(max-height:1100px)]:p-0.5 gap-1',
                    props.historyView === 'both' ? 'grid grid-cols-1 2xl:grid-cols-2' : 'flex flex-col'
                )}
            >
                {(props.historyView === 'chart' || props.historyView === 'both') && (
                    <div className="h-full min-h-0 border border-[#303236] bg-[#05070b] p-1 [@media(max-height:1100px)]:p-0.5">
                        {props.loadingHistory ? (
                            <div className="text-slate-400">Loading history...</div>
                        ) : chartData.length === 0 ? (
                            <div className="text-slate-400">No history data for this scope.</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={chartData} margin={{ top: 8, right: 20, bottom: 8, left: 8 }}>
                                    <CartesianGrid stroke="#242733" strokeDasharray="3 3" />
                                    <XAxis dataKey="date" stroke="#7f8798" tick={{ fontSize: 10 }} minTickGap={24} />
                                    <YAxis yAxisId="price" stroke="#7f8798" tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmtCompact(v, 1)} />
                                    <YAxis yAxisId="volume" orientation="right" stroke="#4b5563" tick={{ fontSize: 10 }} tickFormatter={(v: number) => fmtCompact(v, 1)} />
                                    <Tooltip content={(tipProps: any) => <HistoryTooltip {...tipProps} regionMap={regionMap} singleRegion={singleRegion} />} />
                                    <Legend wrapperStyle={{ fontSize: 10, color: '#cbd5e1' }} />
                                    {props.historyToggles.volume && (
                                        <Bar yAxisId="volume" dataKey="volume_total" name="Volume" fill="#253348" opacity={0.75} />
                                    )}
                                    {singleRegion && props.historyToggles.range && (
                                        <>
                                            <Line yAxisId="price" type="monotone" dataKey="high" name="High" stroke="#7f8798" dot={false} strokeWidth={1} />
                                            <Line yAxisId="price" type="monotone" dataKey="low" name="Low" stroke="#7f8798" dot={false} strokeWidth={1} />
                                        </>
                                    )}
                                    {singleRegion ? (
                                        <>
                                            {props.historyToggles.average && <Line yAxisId="price" type="monotone" dataKey="avg" name="Average" stroke="#53b6ff" dot={false} strokeWidth={2} />}
                                            {props.historyToggles.ma7 && <Line yAxisId="price" type="monotone" dataKey="ma7" name="7D MA" stroke="#3bbf5a" dot={false} strokeWidth={1.5} />}
                                            {props.historyToggles.ma28 && <Line yAxisId="price" type="monotone" dataKey="ma28" name="28D MA" stroke="#f59e0b" dot={false} strokeWidth={1.5} />}
                                        </>
                                    ) : (
                                        regionIds.slice(0, 6).map((rid, idx) => (
                                            <Line
                                                key={rid}
                                                yAxisId="price"
                                                type="monotone"
                                                dataKey={`avg_${rid}`}
                                                name={regionMap.get(rid) || String(rid)}
                                                stroke={chartColors[idx % chartColors.length]}
                                                dot={false}
                                                strokeWidth={1.8}
                                            />
                                        ))
                                    )}
                                </ComposedChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                )}

                {(props.historyView === 'table' || props.historyView === 'both') && (
                    <HistoryTable
                        rows={sortedRows}
                        loading={props.loadingHistory}
                        sort={props.historySort}
                        dir={props.historyDir}
                        clickSort={props.clickHistorySort}
                        multiRegion={regionIds.length > 1}
                    />
                )}
            </div>
        </fieldset>
    );
}

function HistoryTooltip(props: any & { regionMap: Map<number, string>; singleRegion: boolean }) {
    if (!props.active || !props.payload?.length) return null;
    return (
        <div className="border border-[#303236] bg-[#05070b] px-2 py-1 text-[11px] text-slate-200 shadow-[0_0_18px_rgba(0,0,0,0.85)]">
            <div className="text-slate-400">{props.label}</div>
            {props.payload.slice(0, 12).map((p: any, idx: number) => (
                <div key={`${p.dataKey}-${idx}`} style={{ color: p.color }}>
                    {p.name}: {p.dataKey === 'volume_total' ? fmtQty(n(p.value)) : fmtIsk(n(p.value))}
                </div>
            ))}
        </div>
    );
}

function HistoryTable({
    rows,
    loading,
    sort,
    dir,
    clickSort,
    multiRegion,
}: {
    rows: HistoryRow[];
    loading: boolean;
    sort: string;
    dir: 'asc' | 'desc';
    clickSort: (key: 'date' | 'region' | 'avg' | 'low' | 'high' | 'volume' | 'orders' | 'ma7' | 'ma28') => void;
    multiRegion: boolean;
}) {
    const Head = ({ label, keyName, right = true }: { label: string; keyName: Parameters<typeof clickSort>[0]; right?: boolean }) => (
        <th
            className={classNames(tableHead, right ? 'text-right' : 'text-left', 'cursor-pointer select-none')}
            onClick={() => clickSort(keyName)}
        >
            {label} <span className="text-[#53b6ff]">{sort === keyName ? (dir === 'asc' ? '^' : 'v') : ''}</span>
        </th>
    );

    return (
        <div className="h-full min-h-0 overflow-auto border border-[#303236] bg-[#05070b] scrollbar-thin scrollbar-track-[#05070b] scrollbar-thumb-[#252836]">
            <table className="min-w-full [@media(min-height:1101px)]:min-w-[900px] w-full text-[10px] [@media(min-height:1101px)]:text-[11px] table-fixed [@media(min-height:1101px)]:table-auto border-collapse">
                <thead className="sticky top-0 z-10 bg-[#14161d]">
                    <tr>
                        <Head label="Date" keyName="date" right={false} />
                        {multiRegion && <Head label="Region" keyName="region" right={false} />}
                        <Head label="Avg" keyName="avg" />
                        <Head label="Low" keyName="low" />
                        <Head label="High" keyName="high" />
                        <Head label="Volume" keyName="volume" />
                        <Head label="Orders" keyName="orders" />
                        <Head label="7D MA" keyName="ma7" />
                        <Head label="28D MA" keyName="ma28" />
                    </tr>
                </thead>
                <tbody>
                    {loading ? (
                        <tr><td colSpan={9} className="px-3 py-3 text-slate-400">Loading history...</td></tr>
                    ) : rows.length === 0 ? (
                        <tr><td colSpan={9} className="px-3 py-3 text-slate-400">No history rows for the current scope.</td></tr>
                    ) : (
                        rows.map((r, i) => (
                            <tr
                                key={`${r.date}-${r.region_id}`}
                                className={classNames(i % 2 === 0 ? 'bg-[#090b11]' : 'bg-[#0c0f16]', 'hover:bg-[#141821] border-b border-[#2b2d33]/70')}
                            >
                                <td className={tableCell}>{fmtDate(r.date)}</td>
                                {multiRegion && <td className={classNames(tableCell, 'truncate')}>{r.region_name}</td>}
                                <TdRight>{fmtIsk(r.avg_price)}</TdRight>
                                <TdRight>{fmtIsk(r.low_price)}</TdRight>
                                <TdRight>{fmtIsk(r.high_price)}</TdRight>
                                <TdRight>{fmtQty(r.volume)}</TdRight>
                                <TdRight>{fmtQty(r.orders)}</TdRight>
                                <TdRight>{fmtIsk(r.ma7)}</TdRight>
                                <TdRight>{fmtIsk(r.ma28)}</TdRight>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}

function TickerBar({
    ticker,
    quickbar,
    scopeText,
    onSelectType,
}: {
    ticker: TickerRow[];
    quickbar: Item[];
    scopeText: string;
    onSelectType: (typeId: number, name: string) => void;
}) {
    const known = new Map(quickbar.map((q) => [q.type_id, q.type_name]));
    return (
        <div className="border-t border-[#2c2f36] bg-[#05070b] px-3 py-1.5 [@media(max-height:1100px)]:py-0.5 flex items-center gap-3 [@media(max-height:1100px)]:gap-2 overflow-x-auto text-[10px] scrollbar-thin scrollbar-track-[#05070b] scrollbar-thumb-[#252836]">
            <span className="uppercase tracking-widest text-slate-500 whitespace-nowrap">Ticker</span>
            <span className="text-slate-600 whitespace-nowrap">{scopeText}</span>
            {ticker.length === 0 ? (
                <span className="text-slate-500">Add quickbar items to populate the ticker.</span>
            ) : (
                ticker.map((row) => (
                    <button
                        type="button"
                        key={row.type_id}
                        className="inline-flex items-center gap-1 border border-[#303236] bg-[#070910] px-2 py-0.5 whitespace-nowrap hover:border-[#53b6ff]/60"
                        onClick={() => onSelectType(row.type_id, known.get(row.type_id) || row.type_name)}
                        title={`Lowest sell in scope compared with latest daily average. ${scopeText === 'All Regions' ? 'All Regions means lowest sell anywhere in the local order set.' : scopeText}`}
                    >
                        <span className="text-slate-300">{row.type_name}</span>
                        <span className="font-mono text-slate-100">{fmtIsk(row.lowest_sell)}</span>
                        <span className={row.sell_vs_avg_pct != null && row.sell_vs_avg_pct >= 0 ? 'text-[#3bbf5a]' : 'text-[#ff8b8b]'}>
                            {fmtPct(row.sell_vs_avg_pct)}
                        </span>
                    </button>
                ))
            )}
        </div>
    );
}
