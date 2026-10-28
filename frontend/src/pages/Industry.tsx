/*
 * React page for /industry.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    IndustryPlanResponse,
    IndustryGoal,
    IndustrySettings,
    BomRow,
    FlatJob,
    TreeNode,
    FacilityConfig
} from '../types/industry';
import { Pencil, Save, Search, Trash2, X } from 'lucide-react';
import infoIconRaw from '../assets/icons/info.svg?raw';
import {
    requestSiteAuthModal,
    SITE_AUTH_CHANGED_EVENT,
    type SiteAuthChangeDetail,
} from '../auth/siteAuthEvents';
import type { AuthUser } from '../components/fitting/types';

type ItemInput = {
    id: number;
    typeId?: number;
    typeName?: string;
    quantity: number;
    runsPerBpc: number;
    query: string;
    suggestions: { type_id: number; name: string }[];
    showSuggestions: boolean;
};

type RouteOverride = 'build' | 'buy';

type SavedToolSetup = {
    id: string;
    setupName: string;
    setupJson?: unknown;
    summaryJson?: {
        itemCount?: number;
        firstItem?: string;
    };
    updatedAt?: string;
};

type SaveDialogMode = 'create' | 'update' | 'rename';

type ResultTab = 'summary' | 'unit';
type DetailTab = 'bom' | 'jobs' | 'tree';

type SortDirection = 'asc' | 'desc';
type JobSortKey =
    | 'tree'
    | 'mode'
    | 'output'
    | 'stock'
    | 'runs'
    | 'materials'
    | 'costShare'
    | 'jobCost'
    | 'jobCostPerUnit';

type IndustrySetupSnapshot = {
    version: 1;
    items: ItemInput[];
    settings: IndustrySettings;
    overrides: Record<number, RouteOverride>;
    stock: Record<number, number>;
    leafStock: Record<number, number>;
};

const typeIconUrl = (typeId: number, size = 32) =>
    `https://images.evetech.net/types/${typeId}/icon?size=${size}`;

function isHiddenIndustrySearchSuggestion(suggestion: { name: string }) {
    return /\bSKIN\b/i.test(suggestion.name) || /\bBlueprint\b/i.test(suggestion.name);
}

function classNames(...values: (string | false | null | undefined)[]) {
    return values.filter(Boolean).join(' ');
}

const infoIconPath = infoIconRaw.match(/<path\b[^>]*\bd="([^"]+)"/)?.[1] ?? '';

function InfoGlyph({ className = 'h-3.5 w-3.5' }: { className?: string }) {
    return (
        <svg aria-hidden="true" focusable="false" viewBox="0 0 128 128" className={classNames('inline-block shrink-0', className)}>
            {infoIconPath ? (
                <path d={infoIconPath} fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
            ) : (
                <path
                    d="M64 24a40 40 0 1 1 0 80 40 40 0 0 1 0-80Zm-4.3 15h10v10h-10v-10Zm-2.8 16.7h12.8V79h1.4v10H58.3V79h1.4V65.7h-2.8v-10Z"
                    fill="currentColor"
                    fillRule="evenodd"
                    clipRule="evenodd"
                />
            )}
        </svg>
    );
}

function ItemInfoLink({
    typeId,
    label,
}: {
    typeId?: number | null;
    label: string;
}) {
    if (!Number.isInteger(typeId)) return null;
    return (
        <a
            href={`/items/${typeId}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 opacity-80 hover:border-[#53b6ff]/70 hover:bg-[#101b27] hover:text-[#9dd8ff] hover:opacity-100"
            title={`Show info: ${label}`}
            aria-label={`Show info: ${label}`}
        >
            <InfoGlyph className="h-3 w-3" />
        </a>
    );
}

const defaultFacility: FacilityConfig = {
    structure: 'NPC_STATION',
    rig: 'NONE',
    security: 'HIGH',
};

const defaultSettings: IndustrySettings = {
    systemCostIndexManufacturing: 0,
    systemCostIndexReactions: 0,
    facilityTax: 0,
    sccSurcharge: 0.04,
    includeReactions: false,
    additionalCost: 0,

    productMe: 0,
    componentMe: 0,
    reactionMe: 0,
    productFacility: defaultFacility,
    componentFacility: defaultFacility,
    reactionFacility: defaultFacility,

    inputPriceMode: 'sell',
    outputPriceMode: 'buy',
    overrideRoutes: {},
};

const INDUSTRY_SETUP_TOOL_KEY = 'industry-cost';

const JOB_SORT_DEFAULT_DIRECTIONS: Record<JobSortKey, SortDirection> = {
    tree: 'asc',
    mode: 'asc',
    output: 'asc',
    stock: 'desc',
    runs: 'desc',
    materials: 'asc',
    costShare: 'desc',
    jobCost: 'desc',
    jobCostPerUnit: 'desc',
};

const defaultIndustryItem = (): ItemInput => ({
    id: 1,
    quantity: 1,
    runsPerBpc: 1,
    query: '',
    suggestions: [],
    showSuggestions: false,
});

function numericField(value: unknown, fallback: number) {
    const next = Number(value);
    return Number.isFinite(next) ? next : fallback;
}

function positiveInt(value: unknown, fallback: number) {
    return Math.max(1, Math.trunc(numericField(value, fallback)));
}

function nonNegativeNumber(value: unknown, fallback = 0) {
    return Math.max(0, numericField(value, fallback));
}

function normalizeRecordNumbers(raw: unknown): Record<number, number> {
    const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const out: Record<number, number> = {};
    for (const [key, value] of Object.entries(source)) {
        const typeId = Number(key);
        if (!Number.isFinite(typeId) || typeId <= 0) continue;
        out[typeId] = nonNegativeNumber(value);
    }
    return out;
}

function mergeStockRecords(...records: Record<number, number>[]): Record<number, number> {
    const merged: Record<number, number> = {};
    for (const record of records) {
        for (const [typeIdRaw, quantityRaw] of Object.entries(record)) {
            const typeId = Number(typeIdRaw);
            const quantity = Math.floor(Math.max(0, Number(quantityRaw) || 0));
            if (!typeId || !quantity) continue;
            merged[typeId] = (merged[typeId] || 0) + quantity;
        }
    }
    return merged;
}

function normalizeOverrides(raw: unknown): Record<number, RouteOverride> {
    const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const out: Record<number, RouteOverride> = {};
    for (const [key, value] of Object.entries(source)) {
        const typeId = Number(key);
        if (!Number.isFinite(typeId) || typeId <= 0) continue;
        if (value === 'build' || value === 'buy') out[typeId] = value;
    }
    return out;
}

function normalizeFacilityConfig(raw: unknown): FacilityConfig {
    const source = raw && typeof raw === 'object' ? raw as Partial<FacilityConfig> : {};
    return {
        structure: source.structure || defaultFacility.structure,
        rig: source.rig || defaultFacility.rig,
        security: source.security || defaultFacility.security,
    };
}

function typeIdFromTreeNodeId(id: string): number | null {
    const parts = id.split(':');
    if (parts[0] === 'job') {
        const typeId = Number(parts[3]);
        return Number.isFinite(typeId) && typeId > 0 ? typeId : null;
    }
    if (parts[0] === 'buy') {
        const typeId = Number(parts[1]);
        return Number.isFinite(typeId) && typeId > 0 ? typeId : null;
    }
    return null;
}

function normalizeIndustrySettings(raw: unknown): IndustrySettings {
    const source = raw && typeof raw === 'object' ? raw as Partial<IndustrySettings> : {};
    const inputPriceMode = source.inputPriceMode === 'buy' || source.inputPriceMode === 'sell'
        ? source.inputPriceMode
        : defaultSettings.inputPriceMode;
    const outputPriceMode = source.outputPriceMode === 'buy' || source.outputPriceMode === 'sell'
        ? source.outputPriceMode
        : defaultSettings.outputPriceMode;

    return {
        ...defaultSettings,
        systemCostIndexManufacturing: numericField(source.systemCostIndexManufacturing, defaultSettings.systemCostIndexManufacturing),
        systemCostIndexReactions: numericField(source.systemCostIndexReactions, defaultSettings.systemCostIndexReactions),
        facilityTax: numericField(source.facilityTax, defaultSettings.facilityTax),
        sccSurcharge: numericField(source.sccSurcharge, defaultSettings.sccSurcharge),
        includeReactions: Boolean(source.includeReactions),
        additionalCost: nonNegativeNumber(source.additionalCost, defaultSettings.additionalCost),
        productMe: Math.max(0, Math.min(10, numericField(source.productMe, defaultSettings.productMe))),
        componentMe: Math.max(0, Math.min(10, numericField(source.componentMe, defaultSettings.componentMe))),
        reactionMe: Math.max(0, Math.min(10, numericField(source.reactionMe, defaultSettings.reactionMe))),
        productFacility: normalizeFacilityConfig(source.productFacility),
        componentFacility: normalizeFacilityConfig(source.componentFacility),
        reactionFacility: normalizeFacilityConfig(source.reactionFacility),
        inputPriceMode,
        outputPriceMode,
        overrideRoutes: normalizeOverrides(source.overrideRoutes),
    };
}

function normalizeIndustryItems(raw: unknown): ItemInput[] {
    const source = Array.isArray(raw) ? raw : [];
    const rows = source.map((item, index): ItemInput | null => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Partial<ItemInput>;
        const typeId = numericField(row.typeId, 0);
        const typeName = typeof row.typeName === 'string' ? row.typeName : '';
        const query = typeof row.query === 'string' ? row.query : typeName;
        return {
            id: index + 1,
            typeId: typeId > 0 ? typeId : undefined,
            typeName: typeName || undefined,
            quantity: positiveInt(row.quantity, 1),
            runsPerBpc: positiveInt(row.runsPerBpc, 1),
            query,
            suggestions: [],
            showSuggestions: false,
        };
    }).filter(Boolean) as ItemInput[];

    return rows.length ? rows : [defaultIndustryItem()];
}

function snapshotFromSetupJson(setupJson: unknown): IndustrySetupSnapshot {
    const payload = setupJson && typeof setupJson === 'object'
        ? setupJson as Partial<IndustrySetupSnapshot>
        : {};

    return {
        version: 1,
        items: normalizeIndustryItems(payload.items),
        settings: normalizeIndustrySettings(payload.settings),
        overrides: normalizeOverrides(payload.overrides),
        stock: normalizeRecordNumbers(payload.stock),
        leafStock: normalizeRecordNumbers(payload.leafStock),
    };
}

function defaultChainName(items: ItemInput[]) {
    const valid = items.filter((item) => item.typeId || item.query.trim());
    if (!valid.length) return 'Industry Chain';
    const first = valid[0].typeName || valid[0].query || 'Industry Chain';
    return valid.length > 1 ? `${first} + ${valid.length - 1}` : first;
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

const Industry: React.FC = () => {
    const [searchParams] = useSearchParams();
    const [hydratedTypeId, setHydratedTypeId] = useState<number | null>(null);
    const [items, setItems] = useState<ItemInput[]>([defaultIndustryItem()]);
    const [settings, setSettings] = useState<IndustrySettings>(defaultSettings);
    const [plan, setPlan] = useState<IndustryPlanResponse | null>(null);
    const [stockPlan, setStockPlan] = useState<IndustryPlanResponse | null>(null);
    const [stockReplanning, setStockReplanning] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [overrides, setOverrides] = useState<
        Record<number, RouteOverride>
    >({});
    const [stock, setStock] = useState<Record<number, number>>({});
    const [materialUnitCostMap, setMaterialUnitCostMap] = useState<Record<number, number>>({});
    const [jobShareMap, setJobShareMap] = useState<Record<number, number>>({});
    const [pasteOpen, setPasteOpen] = useState(false);
    const [pasteText, setPasteText] = useState('');
    const [activeResultTab, setActiveResultTab] = useState<ResultTab>('summary');
    const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>('bom');
    const [jobSort, setJobSort] = useState<{ key: JobSortKey; direction: SortDirection }>({
        key: 'tree',
        direction: 'asc',
    });
    const [leafStock, setLeafStock] = useState<Record<number, number>>({});
    const [resolvingStock, setResolvingStock] = useState(false);
    const [authUser, setAuthUser] = useState<AuthUser | null>(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [savedChains, setSavedChains] = useState<SavedToolSetup[]>([]);
    const [savedChainsLoading, setSavedChainsLoading] = useState(false);
    const [selectedChainId, setSelectedChainId] = useState('');
    const [setupBusy, setSetupBusy] = useState<'load' | 'save' | 'rename' | 'delete' | null>(null);
    const [setupError, setSetupError] = useState<string | null>(null);
    const [saveDialogMode, setSaveDialogMode] = useState<SaveDialogMode | null>(null);
    const [saveName, setSaveName] = useState('');
    const selectedChain = savedChains.find((chain) => chain.id === selectedChainId) || null;

    const JITA_STATION_ID = 60003760;

    type UnitRow = {
        typeId: number;
        name: string;
        qty: number;
        unitCost: number;
        unitRevenue: number;
        unitProfit: number;
        margin: number;
    };
    const [unitRows, setUnitRows] = useState<UnitRow[]>([]);
    const lastPlannerRequestRef = useRef<{
        items: { typeId: number; quantity: number; runsPerBpc: number }[];
        options: IndustrySettings & { overrideRoutes: Record<number, RouteOverride> };
    } | null>(null);
    const stockRequestVersionRef = useRef(0);

    useEffect(() => {
        let alive = true;

        async function loadAuth() {
            try {
                const response = await fetch('/api/auth/me', { credentials: 'include' });
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
            setSavedChains([]);
            setSelectedChainId('');
            setSetupError(null);
            return;
        }
        void refreshSavedChains();
    }, [authUser]);

    useEffect(() => {
        const typeId = Number(searchParams.get('type_id') || searchParams.get('typeId') || 0);
        if (!Number.isFinite(typeId) || typeId <= 0) {
            setHydratedTypeId(null);
            return;
        }
        if (hydratedTypeId === typeId) return;

        const controller = new AbortController();
        fetch(`/api/items/${typeId}`, { cache: 'no-store', signal: controller.signal })
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json() as Promise<{ ok: boolean; item?: { type_id: number; name: string } }>;
            })
            .then((payload) => {
                if (!payload.ok || !payload.item) throw new Error('Item not found');
                setItems((prev) => [
                    {
                        id: prev[0]?.id || 1,
                        typeId: payload.item!.type_id,
                        typeName: payload.item!.name,
                        quantity: 1,
                        runsPerBpc: 1,
                        query: payload.item!.name,
                        suggestions: [],
                        showSuggestions: false,
                    },
                    ...prev.slice(1),
                ]);
                setPlan(null);
                setError(null);
                setOverrides({});
                setHydratedTypeId(typeId);
            })
            .catch((err: unknown) => {
                if ((err as Error).name !== 'AbortError') {
                    setError(`Could not load linked product typeID ${typeId}.`);
                }
            });
        return () => controller.abort();
    }, [searchParams, hydratedTypeId]);

    const fieldForMode = (mode: 'buy' | 'sell') =>
        mode === 'buy' ? 'buy_max' : 'sell_min';

    async function fetchStationPrices(ids: number[]): Promise<Record<number, any>> {
        if (!ids.length) return {};
        const url = `/api/prices/station?station_id=${JITA_STATION_ID}&type_ids=${ids.join(',')}&_=${Date.now()}`;

        const res = await fetch(url, { cache: 'no-store' });

        if (res.status === 304) {
            const res2 = await fetch(`${url}&__=${Math.random()}`, { cache: 'reload' });
            if (!res2.ok) return {};
            const payload2 = await res2.json();
            const arr2 = Array.isArray(payload2) ? payload2 : (payload2.rows ?? []);
            const map2: Record<number, any> = {};
            for (const r of arr2) map2[Number(r.type_id)] = {
                sell_min: Number(r.sell_min) || 0,
                buy_max: Number(r.buy_max) || 0,
                sell_5pct: Number(r.sell_5pct) || 0,
                buy_5pct: Number(r.buy_5pct) || 0,
            };
            return map2;
        }

        if (!res.ok) return {};
        const payload = await res.json();
        const arr = Array.isArray(payload) ? payload : (payload.rows ?? []);
        const map: Record<number, any> = {};
        for (const r of arr) map[Number(r.type_id)] = {
            sell_min: Number(r.sell_min) || 0,
            buy_max: Number(r.buy_max) || 0,
            sell_5pct: Number(r.sell_5pct) || 0,
            buy_5pct: Number(r.buy_5pct) || 0,
        };
        return map;
    }

    type ParsedLine = { nameOrId: string; qty: number };

    const parsePastedLines = (input: string): ParsedLine[] => {
        const out: ParsedLine[] = [];
        const normalize = (s: string) =>
            s.replace(/\u00A0/g, ' ').replace(/[‐-‒–—−]/g, '-').trim();
        const isNumTok = (s: string) => /^\d[\d,._]*$/.test(s);
        const cleanInt = (s: string) => {
            const n = Number(s.replace(/[^\d]/g, ''));
            return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
        };
        const stripTailPairs = (t: string[]) => {
            while (t.length >= 2) {
                const last = t[t.length - 1], prev = t[t.length - 2];
                if (/\bISK\b/i.test(last) && isNumTok(prev)) { t.pop(); t.pop(); continue; }
                if (/\bm3\b|\bm³\b/i.test(last) && isNumTok(prev)) { t.pop(); t.pop(); continue; }
                break;
            }
            return t;
        };

        for (const raw0 of input.split(/\r?\n/)) {
            const raw = normalize(raw0);
            if (!raw) continue;

            if (/\t/.test(raw) || / {2,}/.test(raw)) {
                const cols = raw.split(/\t+| {2,}/).map(c => c.trim()).filter(Boolean);
                if (!cols.length) continue;
                let nameCol = cols[0];
                if (/^\d[\d,._\s]*$/.test(cols[0]) && cols[1] && !/^\d[\d,._\s]*$/.test(cols[1])) {
                    nameCol = cols[1];
                }
                let qty: number | null = null;
                for (let i = cols.length - 1; i >= 0; i--) {
                    const c = cols[i];
                    if (/\b(ISK|m3|m³)\b/i.test(c)) continue;
                    const m1 = c.match(/^(?:[xX×]\s*)?(\d[\d,._\s]*)$/);
                    if (m1) { qty = cleanInt(m1[1]); break; }
                }
                if (qty == null || !Number.isFinite(qty)) qty = 1;
                out.push({ nameOrId: nameCol.trim(), qty });
                continue;
            }

            {
                const m = raw.match(/^\s*(?:type\s*[_\s-]*id|typeid|id)[:=#-]?\s*(\d+)(?:\s*[xX×]?\s*(\d[\d,._]*))?\s*$/i);
                if (m) { out.push({ nameOrId: m[1], qty: m[2] ? cleanInt(m[2]) : 1 }); continue; }
                if (/^\d+$/.test(raw)) { out.push({ nameOrId: raw, qty: 1 }); continue; }
            }

            let toks = raw.split(/\s+/).filter(Boolean);
            toks = stripTailPairs(toks);

            if (toks.length >= 2 && isNumTok(toks[0])) {
                const t0 = toks[0], t1 = toks[1];
                if (/^[xX×]$/.test(t1)) out.push({ nameOrId: toks.slice(2).join(' '), qty: cleanInt(t0) || 1 });
                else if (/^[xX×]\d[\d,._]*$/.test(t1)) out.push({ nameOrId: toks.slice(2).join(' '), qty: cleanInt(t1.slice(1)) || 1 });
                else out.push({ nameOrId: toks.slice(1).join(' '), qty: cleanInt(t0) || 1 });
                continue;
            }

            const last = toks[toks.length - 1];
            if (/^[xX×]\d[\d,._]*$/.test(last)) { out.push({ nameOrId: toks.slice(0, -1).join(' '), qty: cleanInt(last.slice(1)) || 1 }); continue; }
            if (toks.length >= 2 && /^[xX×]$/.test(toks[toks.length - 2]) && isNumTok(last)) {
                out.push({ nameOrId: toks.slice(0, -2).join(' '), qty: cleanInt(last) || 1 }); continue;
            }
            if (isNumTok(last)) { out.push({ nameOrId: toks.slice(0, -1).join(' '), qty: cleanInt(last) || 1 }); continue; }

            out.push({ nameOrId: raw, qty: 1 });
        }
        return out;
    };
    const resolvePastedStock = async (text: string) => {
        const parsed = parsePastedLines(text);
        if (!parsed.length) {
            setStock({});
            setLeafStock({});
            return;
        }

        setResolvingStock(true);
        try {
            const acc: Record<number, number> = {};
            for (const line of parsed) {
                const asId = Number(line.nameOrId);
                if (Number.isFinite(asId) && asId > 0) {
                    acc[asId] = (acc[asId] || 0) + (Number.isFinite(line.qty) ? Math.max(0, line.qty) : 1);
                    continue;
                }
                const resp = await fetch(`/api/types/search?q=${encodeURIComponent(line.nameOrId)}`);
                if (!resp.ok) continue;
                const list: { type_id: number; name: string }[] = await resp.json();
                if (!Array.isArray(list) || !list.length) continue;

                const exact = list.find(x => x.name.toLowerCase() === line.nameOrId.toLowerCase());
                const pick = exact || list[0];
                acc[pick.type_id] = (acc[pick.type_id] || 0) + (Number.isFinite(line.qty) ? Math.max(0, line.qty) : 1);
            }
            setStock(acc);
            setLeafStock({});
        } finally {
            setResolvingStock(false);
        }
    };

    const toPct = (v?: number) =>
        Number.isFinite(v as number) ? parseFloat(((v as number) * 100).toFixed(4)) : 0;
    const fromPct = (s: string) => {
        const n = Number(s);
        return Number.isFinite(n) ? n / 100 : 0;
    };

    const updateItem = (id: number, patch: Partial<ItemInput>) => {
        setItems((prev) =>
            prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
        );
    };

    const addRow = () => {
        setItems((prev) => [
            ...prev,
            {
                id: prev.length ? Math.max(...prev.map((r) => r.id)) + 1 : 1,
                quantity: 1,
                runsPerBpc: 1,
                query: '',
                suggestions: [],
                showSuggestions: false,
            }
        ]);
    };
    const updateMe = (
        field: 'productMe' | 'componentMe' | 'reactionMe',
        value: string
    ) => {
        const v = Math.max(0, Math.min(10, Number(value) || 0));
        setSettings((prev) => ({ ...prev, [field]: v }));
    };

    const updateFacility = (
        field:
            | 'productFacility'
            | 'componentFacility'
            | 'reactionFacility',
        patch: Partial<FacilityConfig>
    ) => {
        setSettings((prev) => ({
            ...prev,
            [field]: { ...prev[field], ...patch },
        }));
    };

    const removeRow = (id: number) => {
        setItems((prev) => prev.filter((r) => r.id !== id));
    };

    const onSearchChange = async (id: number, value: string) => {
        updateItem(id, { query: value, showSuggestions: true });

        const q = value.trim();
        if (!q || q.length < 2) {
            updateItem(id, { suggestions: [] });
            return;
        }

        try {
            const res = await fetch(
                `/api/types/search?q=${encodeURIComponent(q)}`
            );
            if (!res.ok) return;
            const data: { type_id: number; name: string }[] = await res.json();
            updateItem(id, {
                suggestions: (data || []).filter((row) => !isHiddenIndustrySearchSuggestion(row)),
                showSuggestions: true,
            });
        } catch {

        }
    };

    const chooseSuggestion = (rowId: number, type_id: number, name: string) => {
        updateItem(rowId, {
            typeId: type_id,
            typeName: name,
            query: name,
            showSuggestions: false,
            suggestions: [],
        });
    };

    const handleSettingsChange = (
        field: keyof IndustrySettings,
        value: string
    ) => {
        const num = Number(value);

        if (field === 'includeReactions') {
            return;
        }

        if (
            field === 'systemCostIndexManufacturing' ||
            field === 'systemCostIndexReactions' ||
            field === 'facilityTax'
        ) {
            return setSettings(prev => ({ ...prev, [field]: fromPct(value) }));
        }

        setSettings((prev) => ({
            ...prev,
            [field]: isNaN(num) ? 0 : num,
        }));
    };

    const toggleIncludeReactions = () => {
        setSettings((prev) => ({
            ...prev,
            includeReactions: !prev.includeReactions,
        }));
    };

    type CalculateSource = {
        items?: ItemInput[];
        settings?: IndustrySettings;
        overrides?: Record<number, RouteOverride>;
    };

    const handleSubmit = async (
        overrideRoutes?: Record<number, RouteOverride>,
        source?: CalculateSource
    ) => {
        setError(null);
        setPlan(null);
        setStockPlan(null);
        setStockReplanning(false);
        stockRequestVersionRef.current += 1;

        const sourceItems = source?.items ?? items;
        const sourceSettings = source?.settings ?? settings;
        const sourceOverrides = overrideRoutes ?? source?.overrides ?? overrides;

        const normalized = sourceItems.map((r) => {
            if (!r.typeId && r.suggestions && r.suggestions.length > 0) {
                const first = r.suggestions[0];
                return {
                    ...r,
                    typeId: first.type_id,
                    typeName: first.name,
                    query: first.name,
                    showSuggestions: false,
                };
            }
            return r;
        });
        setItems(normalized);

        const payloadItems = normalized
            .filter((r) => r.typeId && r.quantity > 0)
            .map((r) => ({
                typeId: r.typeId as number,
                quantity: r.quantity,
                runsPerBpc: r.runsPerBpc ?? 1,
            }));

        if (!payloadItems.length) {
            setError('Add at least one valid product (type + quantity).');
            return;
        }

        const request = {
            items: payloadItems,
            options: {
                ...sourceSettings,
                overrideRoutes: sourceOverrides,
            },
        };
        lastPlannerRequestRef.current = request;

        setLoading(true);
        try {
            const res = await fetch('/api/industry/plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Request failed');
            }

            const data: IndustryPlanResponse = await res.json();
            setPlan(data);
        } catch (e: any) {
            setError(e.message || 'Failed to compute plan.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!plan || !lastPlannerRequestRef.current) {
            setStockPlan(null);
            setStockReplanning(false);
            return;
        }

        const inventory = mergeStockRecords(stock, leafStock);
        const requestVersion = ++stockRequestVersionRef.current;
        if (Object.keys(inventory).length === 0) {
            setStockPlan(null);
            setStockReplanning(false);
            return;
        }

        const controller = new AbortController();
        setStockReplanning(true);
        const timeout = window.setTimeout(async () => {
            try {
                const baseRequest = lastPlannerRequestRef.current;
                if (!baseRequest) return;
                const response = await fetch('/api/industry/plan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        ...baseRequest,
                        options: {
                            ...baseRequest.options,
                            stock: inventory,
                        },
                    }),
                });
                if (!response.ok) {
                    const detail = await response.json().catch(() => ({}));
                    throw new Error(detail.error || 'Stock recalculation failed');
                }
                const nextPlan: IndustryPlanResponse = await response.json();
                if (stockRequestVersionRef.current !== requestVersion) return;
                setStockPlan(nextPlan);
                setError(null);
            } catch (err) {
                if (controller.signal.aborted || stockRequestVersionRef.current !== requestVersion) return;
                setStockPlan(null);
                setError((err as Error).message || 'Failed to apply current stock.');
            } finally {
                if (stockRequestVersionRef.current === requestVersion) {
                    setStockReplanning(false);
                }
            }
        }, 180);

        return () => {
            window.clearTimeout(timeout);
            controller.abort();
        };
    }, [leafStock, plan, stock]);

    async function refreshSavedChains(preferredChainId?: string) {
        if (!authUser) return;
        setSavedChainsLoading(true);
        try {
            const response = await fetch(`/api/tool-setups/${INDUSTRY_SETUP_TOOL_KEY}`, { credentials: 'include' });
            const data = await readJson<{ ok: boolean; setups: SavedToolSetup[] }>(response);
            const next = data.setups || [];
            setSavedChains(next);
            setSelectedChainId((prev) => {
                const candidate = preferredChainId || prev;
                return candidate && next.some((chain) => chain.id === candidate) ? candidate : '';
            });
        } catch (err) {
            setSavedChains([]);
            setSetupError((err as Error).message || 'Saved chains failed to load.');
        } finally {
            setSavedChainsLoading(false);
        }
    }

    function currentSnapshot(): IndustrySetupSnapshot {
        return {
            version: 1,
            items: normalizeIndustryItems(items),
            settings: normalizeIndustrySettings(settings),
            overrides: normalizeOverrides(overrides),
            stock: normalizeRecordNumbers(stock),
            leafStock: normalizeRecordNumbers(leafStock),
        };
    }

    function setupPayload(name: string, snapshot: IndustrySetupSnapshot = currentSnapshot()) {
        const validItems = snapshot.items.filter((item) => item.typeId || item.query.trim());
        return {
            setupName: name,
            setupJson: snapshot,
            summaryJson: {
                itemCount: validItems.length,
                firstItem: validItems[0]?.typeName || validItems[0]?.query || '',
            },
        };
    }

    function openSaveChainDialog() {
        if (!authUser) {
            requestSiteAuthModal('login');
            return;
        }
        setSetupError(null);
        setSaveDialogMode(selectedChain ? 'update' : 'create');
        setSaveName(selectedChain?.setupName || defaultChainName(items));
    }

    function openRenameChainDialog() {
        if (!authUser) {
            requestSiteAuthModal('login');
            return;
        }
        if (!selectedChain) return;
        setSetupError(null);
        setSaveDialogMode('rename');
        setSaveName(selectedChain.setupName);
    }

    async function handleSaveDialogSubmit(event: React.FormEvent) {
        event.preventDefault();
        if (!authUser) {
            requestSiteAuthModal('login');
            return;
        }

        const name = saveName.trim();
        if (!name) {
            setSetupError('Chain name is required.');
            return;
        }

        try {
            if (saveDialogMode === 'rename') {
                if (!selectedChain) return;
                setSetupBusy('rename');
                const response = await fetch(`/api/tool-setups/${INDUSTRY_SETUP_TOOL_KEY}/${selectedChain.id}`, {
                    method: 'PATCH',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ setupName: name }),
                });
                await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
                await refreshSavedChains(selectedChain.id);
            } else {
                setSetupBusy('save');
                const updating = saveDialogMode === 'update' && selectedChain;
                const response = await fetch(
                    updating
                        ? `/api/tool-setups/${INDUSTRY_SETUP_TOOL_KEY}/${selectedChain.id}`
                        : `/api/tool-setups/${INDUSTRY_SETUP_TOOL_KEY}`,
                    {
                        method: updating ? 'PUT' : 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(setupPayload(name)),
                    }
                );
                const data = await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
                await refreshSavedChains(data.setup.id);
            }

            setSaveDialogMode(null);
            setSaveName('');
            setSetupError(null);
        } catch (err) {
            const message = (err as Error).message === 'setup_name_exists'
                ? 'A saved chain with that name already exists.'
                : (err as Error).message || 'Saved chain update failed.';
            setSetupError(message);
        } finally {
            setSetupBusy(null);
        }
    }

    async function loadSavedChain(id: string) {
        if (!id) {
            setSelectedChainId('');
            return;
        }
        if (!authUser) {
            requestSiteAuthModal('login');
            return;
        }

        setSetupBusy('load');
        try {
            const response = await fetch(`/api/tool-setups/${INDUSTRY_SETUP_TOOL_KEY}/${id}`, { credentials: 'include' });
            const data = await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
            const snapshot = snapshotFromSetupJson(data.setup.setupJson);
            setItems(snapshot.items);
            setSettings(snapshot.settings);
            setOverrides(snapshot.overrides);
            setStock(snapshot.stock);
            setLeafStock(snapshot.leafStock);
            setPasteText('');
            setPasteOpen(false);
            setSelectedChainId(id);
            setSetupError(null);
            await handleSubmit(undefined, {
                items: snapshot.items,
                settings: snapshot.settings,
                overrides: snapshot.overrides,
            });
        } catch (err) {
            setSetupError((err as Error).message || 'Saved chain failed to load.');
        } finally {
            setSetupBusy(null);
        }
    }

    async function deleteSelectedChain() {
        if (!authUser) {
            requestSiteAuthModal('login');
            return;
        }
        if (!selectedChain) return;
        if (!window.confirm(`Delete saved chain "${selectedChain.setupName}"?`)) return;

        setSetupBusy('delete');
        try {
            const response = await fetch(`/api/tool-setups/${INDUSTRY_SETUP_TOOL_KEY}/${selectedChain.id}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            await readJson<{ ok: boolean }>(response);
            setSelectedChainId('');
            setSetupError(null);
            await refreshSavedChains();
        } catch (err) {
            setSetupError((err as Error).message || 'Saved chain delete failed.');
        } finally {
            setSetupBusy(null);
        }
    }

    useEffect(() => {
        if (!plan) {
            setUnitRows([]);
            setMaterialUnitCostMap({});
            return;
        }

        (async () => {
            const jobsByOutput = new Map<number, any>();
            for (const j of plan.jobs) jobsByOutput.set(j.outputTypeId, j);

            const topProducts = items
                .filter(i => i.typeId && i.quantity > 0)
                .map(i => ({ typeId: i.typeId as number, qty: i.quantity, name: i.typeName || i.query }));

            const leafSet = new Set<number>();
            const visitLeaves = (typeId: number) => {
                const job = jobsByOutput.get(typeId);
                if (!job || overrides[typeId] === 'buy') { leafSet.add(typeId); return; }
                for (const m of job.materials) visitLeaves(m.typeId);
            };
            topProducts.forEach(p => visitLeaves(p.typeId));
            const [inputPrices, outputPrices] = await Promise.all([
                fetchStationPrices(Array.from(leafSet)),
                fetchStationPrices(topProducts.map(p => p.typeId)),
            ]);
            const inputField = fieldForMode(settings.inputPriceMode);
            const outputField = fieldForMode(settings.outputPriceMode);
            const priceOf = (map: Record<number, any>, id: number, field: string) =>
                Number(map[id]?.[field]) || 0;

            const matCostMemo = new Map<number, number>();
            const materialUnitCost = (typeId: number): number => {
                if (matCostMemo.has(typeId)) return matCostMemo.get(typeId)!;
                const job = jobsByOutput.get(typeId);
                if (!job || overrides[typeId] === 'buy') {
                    const c = priceOf(inputPrices, typeId, inputField);
                    matCostMemo.set(typeId, c);
                    return c;
                }
                let total = 0;
                for (const m of job.materials) {
                    const perUnit = job.outputQuantity > 0 ? m.quantity / job.outputQuantity : 0;
                    total += perUnit * materialUnitCost(m.typeId);
                }
                matCostMemo.set(typeId, total);
                return total;
            };

            const nextMatCosts: Record<number, number> = {};
            for (const j of plan.jobs) {
                nextMatCosts[j.outputTypeId] = materialUnitCost(j.outputTypeId);
            }
            setMaterialUnitCostMap(nextMatCosts);

            const totalOutputValue =
                topProducts.reduce((s, p) => s + (priceOf(outputPrices, p.typeId, outputField) * p.qty), 0) || 1;

            const rows = topProducts.map(p => {
                const unitRevenue = priceOf(outputPrices, p.typeId, outputField);
                const baseUnitCost = materialUnitCost(p.typeId) + unitJobCost(p.typeId);
                const addAllocPerUnit = settings.additionalCost
                    ? (settings.additionalCost * ((unitRevenue * p.qty) / totalOutputValue)) / p.qty
                    : 0;
                const finalUnitCost = baseUnitCost + addAllocPerUnit;
                const unitProfit = unitRevenue - finalUnitCost;
                const margin = unitRevenue > 0 ? unitProfit / unitRevenue : 0;

                return { typeId: p.typeId, name: p.name, qty: p.qty, unitCost: finalUnitCost, unitRevenue, unitProfit, margin };
            });
            setUnitRows(rows);
        })();
    }, [plan, items, settings.inputPriceMode, settings.outputPriceMode, settings.additionalCost, overrides]);

    const jobsByOutput = useMemo(() => {
        const m = new Map<number, FlatJob>();
        plan?.jobs?.forEach((j) => m.set(j.outputTypeId, j));
        return m;
    }, [plan]);

    const effectivePlan = stockPlan ?? plan;
    const effectiveJobs = useMemo(() => {
        if (!plan?.jobs?.length) return [];
        if (!stockPlan) return plan.jobs;

        const adjustedByOutput = new Map<number, FlatJob>();
        stockPlan.jobs.forEach((job) => adjustedByOutput.set(job.outputTypeId, job));
        return plan.jobs.map((baseJob) => {
            const adjusted = adjustedByOutput.get(baseJob.outputTypeId);
            if (adjusted) return adjusted;
            return {
                ...baseJob,
                runs: 0,
                outputQuantity: 0,
                materials: [],
                eiv: 0,
                jobCost: 0,
                jobCostPerUnit: 0,
            };
        });
    }, [plan, stockPlan]);

    const jobTreeMetaByOutput = useMemo(() => {
        const meta = new Map<number, { order: number; depth: number }>();
        let order = 0;

        const visit = (node: TreeNode, depth: number) => {
            const typeId = typeIdFromTreeNodeId(node.id);
            if (typeId && jobsByOutput.has(typeId) && !meta.has(typeId)) {
                meta.set(typeId, { order, depth });
                order += 1;
            }
            node.children?.forEach((child) => visit(child, depth + 1));
        };

        effectivePlan?.tree?.forEach((root) => visit(root, 0));
        return meta;
    }, [effectivePlan?.tree, jobsByOutput]);

    const sortedJobs = useMemo(() => {
        if (!effectiveJobs.length) return [];

        const originalIndex = new Map<number, number>();
        plan?.jobs?.forEach((job, index) => originalIndex.set(job.outputTypeId, index));

        const treeRank = (job: FlatJob) => {
            const index = originalIndex.get(job.outputTypeId) ?? 0;
            return jobTreeMetaByOutput.get(job.outputTypeId)?.order ?? Number.MAX_SAFE_INTEGER - 10000 + index;
        };

        const valueForSort = (job: FlatJob): string | number => {
            switch (jobSort.key) {
                case 'tree':
                    return treeRank(job);
                case 'mode':
                    return overrides[job.outputTypeId] || job.activity || 'build';
                case 'output':
                    return job.outputTypeName || '';
                case 'stock':
                    return stock[job.outputTypeId] ?? 0;
                case 'runs':
                    return job.runs || 0;
                case 'materials':
                    return job.materials.map((m) => m.typeName).join('|');
                case 'costShare':
                    return jobShareMap[job.outputTypeId] ?? -1;
                case 'jobCost':
                    return job.jobCost || 0;
                case 'jobCostPerUnit':
                    return job.jobCostPerUnit || 0;
                default:
                    return treeRank(job);
            }
        };

        const direction = jobSort.direction === 'asc' ? 1 : -1;
        return [...effectiveJobs].sort((a, b) => {
            const aValue = valueForSort(a);
            const bValue = valueForSort(b);
            let cmp = 0;

            if (typeof aValue === 'number' && typeof bValue === 'number') {
                cmp = aValue - bValue;
            } else {
                cmp = String(aValue).localeCompare(String(bValue), undefined, {
                    numeric: true,
                    sensitivity: 'base',
                });
            }

            if (cmp !== 0) return cmp * direction;
            return treeRank(a) - treeRank(b);
        });
    }, [effectiveJobs, jobShareMap, jobSort, jobTreeMetaByOutput, overrides, plan?.jobs, stock]);

    const unitJobCost = useMemo(() => {
        const memo = new Map<number, number>();
        const f = (typeId: number): number => {
            if (overrides[typeId] === 'buy') return 0;
            const j = jobsByOutput.get(typeId);
            if (!j) return 0;
            if (memo.has(typeId)) return memo.get(typeId)!;

            let sum = j.jobCostPerUnit || 0;
            const outPerRun = j.outputQuantity || 1;
            for (const m of j.materials) {
                const perUnit = (m.quantity || 0) / outPerRun;
                sum += perUnit * f(m.typeId);
            }
            memo.set(typeId, sum);
            return sum;
        };
        return f;
    }, [jobsByOutput, overrides]);

    const deductionsMap = useMemo(() => {
        const deduct: Record<number, number> = {};
        const adjustedQtyById = new Map<number, number>();
        effectivePlan?.bom?.forEach((row) => adjustedQtyById.set(row.typeId, row.quantity));
        plan?.bom?.forEach((row) => {
            const reduction = Math.max(0, row.quantity - (adjustedQtyById.get(row.typeId) || 0));
            if (reduction > 0) deduct[row.typeId] = reduction;
        });
        return deduct;
    }, [effectivePlan?.bom, plan?.bom]);

    const adjustedBom = useMemo(() => {
        if (!plan?.bom) return [];
        if (!stockPlan) return plan.bom;

        const adjustedById = new Map(stockPlan.bom.map((row) => [row.typeId, row]));
        return plan.bom.map((baseRow: BomRow & { volume?: number; lineVolume?: number }) => {
            const adjusted = adjustedById.get(baseRow.typeId);
            if (adjusted) return adjusted;
            return {
                ...baseRow,
                quantity: 0,
                totalPrice: 0,
                lineVolume: 0,
            };
        });
    }, [plan?.bom, stockPlan]);

    const origBomQtyById = useMemo(() => {
        const m = new Map<number, number>();
        plan?.bom?.forEach((r: any) => m.set(r.typeId, r.quantity));
        return m;
    }, [plan?.bom]);

    const componentStockRows = useMemo(() => {
        return (effectivePlan?.stockUsage || [])
            .filter((usage) => usage.applied > 0)
            .map((usage) => ({
                typeId: usage.typeId,
                typeName: usage.typeName,
                inStock: usage.available,
                applied: usage.applied,
                overflow: usage.unused,
            }))
            .sort((a, b) => b.applied - a.applied || a.typeName.localeCompare(b.typeName));
    }, [effectivePlan?.stockUsage]);

    const materialsTotalAdjusted = useMemo(
        () => adjustedBom.reduce((s, r: any) => s + (r.unitPrice || 0) * (r.quantity || 0), 0),
        [adjustedBom]
    );
    useEffect(() => {
        if (!plan) {
            setJobShareMap({});
            return;
        }

        const totalMats = materialsTotalAdjusted;
        if (!totalMats) {
            setJobShareMap({});
            return;
        }

        const shares: Record<number, number> = {};
        for (const j of effectiveJobs) {
            const effectiveUnits = Math.max(0, j.outputQuantity || 0);
            const unitMat = materialUnitCostMap[j.outputTypeId] || 0;

            const jobMatCost = effectiveUnits * unitMat;
            shares[j.outputTypeId] = totalMats > 0 ? jobMatCost / totalMats : 0;
        }

        setJobShareMap(shares);
    }, [effectiveJobs, effectivePlan, materialUnitCostMap, materialsTotalAdjusted]);

    const handleCopyShoppingList = (bufferPct: number = 0) => {
        const lines = adjustedBom.filter((row) => row.quantity > 0).map((row: BomRow) => {
            const qty = Math.ceil(row.quantity * (1 + bufferPct));
            return `${qty} ${row.typeName}`;
        });
        const text = lines.join('\n');
        navigator.clipboard.writeText(text).catch(() => {
            console.warn('Clipboard copy failed');
        });
    };

    const formatIsk = (v: number) => {
        if (!v || !isFinite(v)) return '0 ISK';
        if (v >= 1e12) return (v / 1e12).toFixed(3) + 'T ISK';
        if (v >= 1e9) return (v / 1e9).toFixed(3) + 'B ISK';
        if (v >= 1e6) return (v / 1e6).toFixed(3) + 'M ISK';

        return v.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        }) + ' ISK';
    };
    const formatIskUnit = (v: number) => {
        if (!v || !isFinite(v)) return '0';
        return v.toLocaleString('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
        });
    };

    const renderTree = (nodes: TreeNode[], depth = 0) => {
        return (
            <ul className={depth === 0 ? 'space-y-1' : 'ml-4 space-y-1'}>
                {nodes.map((n) => (
                    <li key={n.id}>
                        <div className="text-sm text-gray-200">
                            {Array(depth)
                                .fill('└─')
                                .join('')}
                            {n.label}
                        </div>
                        {n.children && n.children.length > 0 && renderTree(n.children, depth + 1)}
                    </li>
                ))}
            </ul>
        );
    };
    const resultTabs: { id: ResultTab; label: string; count: number }[] = [
        {
            id: 'summary',
            label: 'Profit/Loss Summary',
            count: 6,
        },
        {
            id: 'unit',
            label: 'Unit Economics',
            count: unitRows.length,
        },
    ];

    const detailTabs: { id: DetailTab; label: string; count: number }[] = [
        {
            id: 'bom',
            label: 'Bill of Materials',
            count: adjustedBom.length,
        },
        {
            id: 'jobs',
            label: 'Jobs & Build Steps',
            count: plan?.jobs?.length || 0,
        },
        {
            id: 'tree',
            label: 'Build Tree',
            count: plan?.tree?.length || 0,
        },
    ];

    const setJobSortKey = (key: JobSortKey) => {
        setJobSort((prev) => {
            if (prev.key !== key) {
                return {
                    key,
                    direction: JOB_SORT_DEFAULT_DIRECTIONS[key],
                };
            }
            return {
                key,
                direction: prev.direction === 'asc' ? 'desc' : 'asc',
            };
        });
    };

    const jobSortAria = (key: JobSortKey): 'ascending' | 'descending' | 'none' =>
        jobSort.key === key
            ? jobSort.direction === 'asc'
                ? 'ascending'
                : 'descending'
            : 'none';

    const renderJobSortHeader = (
        key: JobSortKey,
        label: string,
        align: 'left' | 'right' = 'left'
    ) => {
        const active = jobSort.key === key;
        return (
            <button
                type="button"
                onClick={() => setJobSortKey(key)}
                className={classNames(
                    "flex w-full items-center gap-1.5 text-left transition-colors hover:text-[#9dd8ff]",
                    align === 'right' ? "justify-end text-right" : "justify-start",
                    active ? "text-[#dff3ff]" : "text-slate-100"
                )}
            >
                <span>{label}</span>
                {active && (
                    <span className="text-[9px] font-normal text-[#53b6ff]">
                        {jobSort.direction === 'asc' ? 'ASC' : 'DESC'}
                    </span>
                )}
            </button>
        );
    };

    return (
        <div className="tt-tool-v2 min-h-screen text-slate-100 text-[11px] leading-snug">
            <div className="tt2-frame tt2-frame--centered">
                <div className="tt2-window">
                    { }
                    <div className="tt2-titlebar">
                        <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
                            <span className="uppercase tracking-widest text-[10px] text-slate-300">
                                Science &amp; Industry ▸ Manufacturing Cost Calculator
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-[9px] text-slate-400">
                            <span className="px-1 py-0.5 bg-[#0b0d11] border border-[#303236]">
                                Build Planner
                            </span>
                            <span className="text-[#53b6ff]">Triff.Tools</span>
                            <span className="flex gap-1">
                                <span className="h-2 w-2 bg-[#53b6ff]" />
                                <span className="h-2 w-2 bg-[#3bbf5a]" />
                                <span className="h-2 w-2 bg-[#bf3b3b]" />
                            </span>
                        </div>
                    </div>

                    { }
                    <div className="tt2-contextbar">
                        <div className="flex items-center gap-3">
                            <span className="uppercase tracking-widest text-slate-300">
                                Overview ▸ Build Plan
                            </span>
                            <span className="flex items-center gap-1">
                                <span className="h-2 w-2 rounded-full bg-[#3bbf5a]" />
                                <span>Market prices online</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-2" />
                    </div>

                    { }
                    <div className="p-3 space-y-4">
                        { }
                        <div className="border border-[#262933] bg-[#05070b]/90 px-3 py-2">
                            <p className="text-[12px] text-slate-300 mb-1">
                                This panel builds an{" "}
                                <span className="text-slate-100">
                                    end-to-end industry plan
                                </span>{" "}
                                from your chosen outputs, including materials, job
                                costs and profit margins.
                            </p>
                            <p className="text-[12px] text-slate-400 mb-1">
                                Add products in the list below, configure system and
                                facility settings, then calculate to generate a full
                                build script, bill of materials and job breakdown.
                            </p>
                            <p className="text-[12px] text-slate-400">
                                All ISK values use live prices from the{" "}
                                <span className="text-[#53b6ff]">
                                    Triff.Tools Market API
                                </span>
                                . Adjust input / output price modes to switch between
                                buy and sell orders.
                            </p>
                        </div>

                        { }
                        <section className="border border-[#2c2f36] bg-[#070910]">
                            { }
                            <div className="flex items-center justify-between px-3 py-2 bg-[#101219] border-b border-[#2c2f36]">
                                <div className="flex flex-col">
                                    <span className="uppercase tracking-widest text-[10px] text-slate-300">
                                        Products &amp; Settings
                                    </span>
                                    <span className="text-[10px] text-slate-500">
                                        Define build outputs, cost indices and
                                        facilities
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={addRow}
                                    className="px-3 py-1.5 text-[11px] uppercase tracking-widest font-semibold
                                               bg-[#151a22] border border-[#303236]
                                               hover:border-[#53b6ff] hover:text-[#e5f4ff] transition-colors"
                                >
                                    + Add product
                                </button>
                            </div>

                            <div className="p-3 space-y-3">
                                <div className="border border-[#2c2f36] bg-[#05070b]/80 px-2 py-2">
                                    <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                                        <label className="min-w-0 flex-1">
                                            <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-400">
                                                Saved Chains
                                            </span>
                                            <select
                                                value={selectedChainId}
                                                disabled={!authUser || savedChainsLoading || setupBusy === 'load'}
                                                onChange={(event) => void loadSavedChain(event.target.value)}
                                                className="w-full bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <option value="">
                                                    {!authChecked
                                                        ? 'Checking account...'
                                                        : !authUser
                                                            ? 'Sign in to use saved chains'
                                                            : savedChainsLoading
                                                                ? 'Loading saved chains...'
                                                                : savedChains.length
                                                                    ? 'Select a saved chain'
                                                                    : 'No saved chains yet'}
                                                </option>
                                                {savedChains.map((chain) => (
                                                    <option key={chain.id} value={chain.id}>
                                                        {chain.setupName}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>

                                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                                            <button
                                                type="button"
                                                disabled={!authUser || !selectedChain || !!setupBusy}
                                                onClick={openRenameChainDialog}
                                                className="inline-flex h-7 items-center gap-1 border border-[#303236] bg-[#05070b] px-2 text-[10px] uppercase tracking-widest text-slate-300 hover:border-[#53b6ff]/60 hover:bg-[#101219] disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                <Pencil size={12} />
                                                Rename
                                            </button>
                                            <button
                                                type="button"
                                                disabled={!authUser || !selectedChain || !!setupBusy}
                                                onClick={() => void deleteSelectedChain()}
                                                className="inline-flex h-7 items-center gap-1 border border-[#4a2730] bg-[#10070a] px-2 text-[10px] uppercase tracking-widest text-[#ffaaaa] hover:border-[#bf3b3b] hover:bg-[#1d090b] disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                <Trash2 size={12} />
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                    {setupError && (
                                        <div className="mt-2 border border-[#6b2b32] bg-[#1d090b] px-2 py-1.5 text-[11px] text-[#ffaaaa]">
                                            {setupError}
                                        </div>
                                    )}
                                </div>

                                { }
                                <div className="space-y-2">
                                    {items.map((row) => (
                                        <div
                                            key={row.id}
                                            className="grid grid-cols-1 gap-2 border border-[#262933] bg-[#05070b]/80 px-3 py-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-end"
                                        >
                                            { }
                                            <div className="relative min-w-0">
                                                <label className="block text-[10px] uppercase tracking-widest text-slate-400 mb-0.5">
                                                    Product
                                                </label>
                                                <div className="flex items-center gap-1">
                                                    <Search className="w-4 h-4 text-slate-500" />
                                                    <input
                                                        className="w-full bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                                                        placeholder="Type name..."
                                                        value={row.query}
                                                        onChange={(e) =>
                                                            onSearchChange(
                                                                row.id,
                                                                e.target.value
                                                            )
                                                        }
                                                        onFocus={() =>
                                                            updateItem(row.id, {
                                                                showSuggestions: true,
                                                            })
                                                        }
                                                    />
                                                </div>
                                                {row.showSuggestions &&
                                                    row.suggestions.length > 0 && (
                                                        <div className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto bg-[#05070b] border border-[#303236] shadow-lg">
                                                            {row.suggestions.map((s) => (
                                                                <div
                                                                    key={s.type_id}
                                                                    onClick={() =>
                                                                        chooseSuggestion(
                                                                            row.id,
                                                                            s.type_id,
                                                                            s.name
                                                                        )
                                                                    }
                                                                    className="px-2 py-1.5 text-[11px] hover:bg-[#141821] cursor-pointer"
                                                                >
                                                                    {s.name}{" "}
                                                                    <span className="text-slate-500">
                                                                        ({s.type_id})
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                            </div>

                                            { }
                                            <div className="flex items-center gap-2">
                                                <label className="text-[10px] uppercase tracking-widest text-slate-400">
                                                    Qty
                                                </label>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    value={row.quantity}
                                                    onChange={(e) =>
                                                        updateItem(row.id, {
                                                            quantity: Math.max(
                                                                1,
                                                                Number(e.target.value) || 1
                                                            ),
                                                        })
                                                    }
                                                    className="w-20 bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                                                />
                                            </div>

                                            { }
                                            <div className="flex items-center gap-2">
                                                <label className="text-[10px] uppercase tracking-widest text-slate-400">
                                                    Runs/BPC
                                                </label>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    value={row.runsPerBpc}
                                                    onChange={(e) =>
                                                        updateItem(row.id, {
                                                            runsPerBpc: Math.max(
                                                                1,
                                                                Number(e.target.value) || 1
                                                            ),
                                                        })
                                                    }
                                                    className="w-24 bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                                                />
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => removeRow(row.id)}
                                                className="justify-self-end px-2 py-1 text-[10px] uppercase tracking-widest text-[#ff6b6b] hover:text-[#ff8f8f]"
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ))}
                                </div>

                                { }
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-[#262933] mt-1 text-[11px]">
                                    <div className="flex h-full flex-col">
                                        <label className="block text-[10px] uppercase tracking-widest text-slate-400 mb-1">
                                            Manufacturing System Cost Index % (enter 2.78 for 2.78%)
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={toPct(settings.systemCostIndexManufacturing)}
                                            onChange={(e) => handleSettingsChange('systemCostIndexManufacturing', e.target.value)}
                                            className="mt-auto w-full bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff]"
                                        />
                                    </div>
                                    <div className="flex h-full flex-col">
                                        <label className="block text-[10px] uppercase tracking-widest text-slate-400 mb-1">
                                            Reaction System Cost Index % (enter 2.78 for 2.78%)
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={toPct(settings.systemCostIndexReactions)}
                                            onChange={(e) => handleSettingsChange('systemCostIndexReactions', e.target.value)}
                                            className="mt-auto w-full bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff]"
                                        />
                                    </div>
                                    <div className="flex h-full flex-col">
                                        <label className="block text-[10px] uppercase tracking-widest text-slate-400 mb-1">
                                            Facility Tax (%)
                                        </label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={toPct(settings.facilityTax)}
                                            onChange={(e) => handleSettingsChange('facilityTax', e.target.value)}
                                            className="mt-auto w-full bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff]"
                                        />
                                    </div>
                                    <div className="flex h-full flex-col">
                                        <label className="block text-[10px] uppercase tracking-widest text-slate-400 mb-1">
                                            SCC Surcharge (decimal, 0.04 = 4%)
                                        </label>
                                        <input
                                            type="number"
                                            step="0.001"
                                            value={settings.sccSurcharge}
                                            onChange={(e) =>
                                                handleSettingsChange(
                                                    "sccSurcharge",
                                                    e.target.value
                                                )
                                            }
                                            className="mt-auto w-full bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff]"
                                        />
                                    </div>
                                    <div className="flex h-full flex-col">
                                        <label className="block text-[10px] uppercase tracking-widest text-slate-400 mb-1">
                                            Additional Cost (BPCs, hauling, etc.)
                                        </label>
                                        <input
                                            type="number"
                                            step="1"
                                            value={settings.additionalCost}
                                            onChange={(e) =>
                                                handleSettingsChange(
                                                    "additionalCost",
                                                    e.target.value
                                                )
                                            }
                                            className="mt-auto w-full bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff]"
                                        />
                                    </div>
                                    <div className="flex h-full items-end">
                                        <label
                                            htmlFor="includeReactions"
                                            className="inline-flex items-center gap-3 text-[11px] text-slate-100 cursor-pointer"
                                        >
                                            <input
                                                id="includeReactions"
                                                type="checkbox"
                                                checked={settings.includeReactions}
                                                onChange={toggleIncludeReactions}
                                                className="h-4 w-4 rounded border-[#3a3c40] bg-[#05070b] accent-[#53b6ff] cursor-pointer"
                                            />
                                            Include building reaction outputs
                                        </label>
                                    </div>

                                    { }
                                    <div className="pt-4 border-t border-[#262933] grid grid-cols-1 md:grid-cols-2 gap-4 md:col-span-3">
                                        <FacilityCard
                                            title="Final products"
                                            me={settings.productMe}
                                            facility={settings.productFacility}
                                            onMeChange={(v) => updateMe("productMe", v)}
                                            onFacilityChange={(patch) =>
                                                updateFacility("productFacility", patch)
                                            }
                                        />

                                        <FacilityCard
                                            title="Components & intermediates"
                                            me={settings.componentMe}
                                            facility={settings.componentFacility}
                                            onMeChange={(v) =>
                                                updateMe("componentMe", v)
                                            }
                                            onFacilityChange={(patch) =>
                                                updateFacility("componentFacility", patch)
                                            }
                                        />

                                        {settings.includeReactions && (
                                            <FacilityCard
                                                title="Reactions"
                                                kind="reaction"
                                                me={settings.reactionMe}
                                                facility={settings.reactionFacility}
                                                onMeChange={(v) =>
                                                    updateMe("reactionMe", v)
                                                }
                                                onFacilityChange={(patch) =>
                                                    updateFacility(
                                                        "reactionFacility",
                                                        patch
                                                    )
                                                }
                                            />
                                        )}
                                    </div>

                                    { }
                                    <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400 md:col-span-3">
                                        <div className="flex flex-col gap-1">
                                            <span className="uppercase tracking-widest">
                                                Input pricing
                                            </span>
                                            <select
                                                className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[10px] outline-none focus:border-[#53b6ff]"
                                                value={settings.inputPriceMode}
                                                onChange={(e) =>
                                                    setSettings((prev) => ({
                                                        ...prev,
                                                        inputPriceMode:
                                                            e.target.value as "buy" | "sell",
                                                    }))
                                                }
                                            >
                                                <option value="buy">Jita Buy Max</option>
                                                <option value="sell">Jita Sell Min</option>
                                            </select>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <span className="uppercase tracking-widest">
                                                Output pricing
                                            </span>
                                            <select
                                                className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[10px] outline-none focus:border-[#53b6ff]"
                                                value={settings.outputPriceMode}
                                                onChange={(e) =>
                                                    setSettings((prev) => ({
                                                        ...prev,
                                                        outputPriceMode:
                                                            e.target.value as "buy" | "sell",
                                                    }))
                                                }
                                            >
                                                <option value="buy">Jita Buy Max</option>
                                                <option value="sell">Jita Sell Min</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                { }
                                <div className="flex items-center gap-3 px-3 py-2 border-t border-[#262933] bg-[#05070b]/80">
                                    <button
                                        type="button"
                                        disabled={!!setupBusy}
                                        onClick={openSaveChainDialog}
                                        className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest
                                                   bg-[#05070b] border border-[#303236] text-slate-300
                                                   hover:border-[#53b6ff]/60 hover:bg-[#101219] hover:text-slate-100
                                                   disabled:opacity-60 disabled:cursor-not-allowed
                                                   transition-all duration-150"
                                    >
                                        <Save size={13} />
                                        {selectedChain ? 'Update Chain' : 'Save Chain'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleSubmit()}
                                        className="inline-flex items-center px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest
                                                   bg-gradient-to-b from-[#1b8cc8] to-[#14608a]
                                                   border border-[#46b2ff]/70
                                                   shadow-[0_0_12px_rgba(70,178,255,0.55)]
                                                   hover:from-[#27a0df] hover:to-[#1672a4]
                                                   transition-all duration-150"
                                    >
                                        Calculate Plan
                                    </button>
                                    {error && (
                                        <div className="text-[11px] text-[#ff6b6b]">
                                            {error}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </section>

                        {plan && (
                            <>
                                { }
                                <section className="border border-[#303236] bg-[#05070b]/95">
                                    <div className="flex flex-col gap-2 border-b border-[#303236] bg-[#101219] px-3 py-2 md:flex-row md:items-center md:justify-between">
                                        <div>
                                            <h2 className="text-[12px] uppercase tracking-widest text-slate-300">
                                                Plan Results
                                            </h2>
                                            <div className="text-[10px] text-slate-500">
                                                High-level totals and per-product unit economics
                                            </div>
                                        </div>
                                        <div
                                            role="tablist"
                                            aria-label="Industry result view"
                                            className="flex flex-wrap items-center gap-1"
                                        >
                                            {resultTabs.map((tab) => {
                                                const selected = activeResultTab === tab.id;
                                                return (
                                                    <button
                                                        key={tab.id}
                                                        type="button"
                                                        role="tab"
                                                        aria-selected={selected}
                                                        aria-controls={`industry-result-${tab.id}`}
                                                        id={`industry-result-tab-${tab.id}`}
                                                        onClick={() => setActiveResultTab(tab.id)}
                                                        className={classNames(
                                                            "inline-flex h-7 items-center gap-1.5 border px-2.5 text-[10px] uppercase tracking-widest transition-colors",
                                                            selected
                                                                ? "border-[#53b6ff]/70 bg-[#101b27] text-[#dff3ff] shadow-[0_0_10px_rgba(83,182,255,0.18)]"
                                                                : "border-[#303236] bg-[#05070b] text-slate-400 hover:border-[#53b6ff]/60 hover:text-slate-100"
                                                        )}
                                                    >
                                                        <span>{tab.label}</span>
                                                        <span
                                                            className={classNames(
                                                                "min-w-5 border px-1 py-0 text-center text-[9px]",
                                                                selected
                                                                    ? "border-[#53b6ff]/40 bg-[#53b6ff]/10 text-[#9dd8ff]"
                                                                    : "border-[#303236] bg-[#0b0d11] text-slate-500"
                                                            )}
                                                        >
                                                            {tab.count.toLocaleString()}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <section
                                        id="industry-result-summary"
                                        role="tabpanel"
                                        aria-labelledby="industry-result-tab-summary"
                                        hidden={activeResultTab !== 'summary'}
                                        className="p-3 space-y-2"
                                    >
                                        <h2 className="text-[12px] uppercase tracking-widest text-slate-300">
                                            Profit/Loss Summary
                                        </h2>
                                        <div className="grid grid-cols-1 gap-3 text-[11px] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                                            <SummaryCard
                                                label="Output value"
                                                value={formatIsk(effectivePlan?.summary.totalOutputValue || 0)}
                                            />
                                            <SummaryCard
                                                label="Profit"
                                                value={formatIsk(effectivePlan?.summary.profit || 0)}
                                                extra={
                                                    (effectivePlan?.summary.totalOutputValue || 0) > 0
                                                        ? `(${(
                                                            (effectivePlan?.summary.profitMargin || 0) * 100
                                                        ).toFixed(2)}%)`
                                                        : ""
                                                }
                                            />
                                    <SummaryCard
                                        label="Materials"
                                        value={formatIsk(
                                            effectivePlan?.summary.totalMaterialCost || 0
                                        )}
                                        sub="Leaf buy inputs"
                                    />
                                    <SummaryCard
                                        label="Job Costs"
                                        value={formatIsk(effectivePlan?.summary.totalJobCost || 0)}
                                        sub="EIV × (SCI + tax + SCC)"
                                    />
                                    <SummaryCard
                                        label="Additional"
                                        value={formatIsk(
                                            effectivePlan?.summary.additionalCost || 0
                                        )}
                                        sub="User-defined extras"
                                    />
                                    <SummaryCard
                                        label="Grand Total Cost"
                                        value={formatIsk(effectivePlan?.summary.grandTotal || 0)}
                                        sub="All-in build cost"
                                        highlight
                                    />
                                        </div>
                                    </section>

                                { }
                                    <section
                                        id="industry-result-unit"
                                        role="tabpanel"
                                        aria-labelledby="industry-result-tab-unit"
                                        hidden={activeResultTab !== 'unit'}
                                        className="p-3 space-y-2"
                                    >
                                        <div className="flex items-center justify-between">
                                            <h2 className="text-[12px] uppercase tracking-widest text-slate-300">
                                                Per-product Unit Economics
                                            </h2>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-[11px]">
                                                <thead>
                                                    <tr className="bg-[#14161d] text-slate-100">
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 w-12" />
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                                                            Product
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                            Qty
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                            Unit Cost
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                            Unit Value
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                            Unit Profit
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                            Margin
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {unitRows.map((r, idx) => {
                                                        const bg =
                                                            idx % 2 === 0
                                                                ? "bg-[#090b11]"
                                                                : "bg-[#0c0f16]";
                                                        return (
                                                            <tr
                                                                key={r.typeId}
                                                                className={`${bg} hover:bg-[#141821]`}
                                                            >
                                                                <td className="border border-[#2b2d33] px-2.5 py-1.5 w-12">
                                                                    <img
                                                                        src={typeIconUrl(
                                                                            r.typeId,
                                                                            64
                                                                        )}
                                                                        alt=""
                                                                        className="w-8 h-8 rounded-sm"
                                                                    />
                                                                </td>
                                                                <td className="border border-[#2b2d33] px-2.5 py-1.5">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="min-w-0 flex-1">
                                                                            <span className="text-slate-100">
                                                                                {r.name}
                                                                            </span>{" "}
                                                                            <span className="text-slate-500">
                                                                                ({r.typeId})
                                                                            </span>
                                                                        </div>
                                                                        <ItemInfoLink typeId={r.typeId} label={r.name} />
                                                                    </div>
                                                                </td>
                                                                <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                                    {r.qty.toLocaleString()}
                                                                </td>
                                                                <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                                    {formatIsk(r.unitCost)}
                                                                </td>
                                                                <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                                    {formatIsk(r.unitRevenue)}
                                                                </td>
                                                                <td
                                                                    className={`border border-[#2b2d33] px-2.5 py-1.5 text-right ${r.unitProfit >= 0
                                                                        ? "text-emerald-300"
                                                                        : "text-rose-300"
                                                                        }`}
                                                                >
                                                                    {formatIsk(r.unitProfit)}
                                                                </td>
                                                                <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                                    {(r.margin * 100).toFixed(2)}%
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </section>
                                </section>

                                { }
                                <section className="border border-[#303236] bg-[#05070b]/95">
                                    <div className="flex flex-col gap-2 border-b border-[#303236] bg-[#101219] px-3 py-2 md:flex-row md:items-center md:justify-between">
                                        <div>
                                            <h2 className="text-[12px] uppercase tracking-widest text-slate-300">
                                                Production Details
                                            </h2>
                                            <div className="text-[10px] text-slate-500">
                                                Materials, build steps, and dependency tree
                                            </div>
                                        </div>
                                        <div
                                            role="tablist"
                                            aria-label="Production detail view"
                                            className="flex flex-wrap items-center gap-1"
                                        >
                                            {detailTabs.map((tab) => {
                                                const selected = activeDetailTab === tab.id;
                                                return (
                                                    <button
                                                        key={tab.id}
                                                        type="button"
                                                        role="tab"
                                                        aria-selected={selected}
                                                        aria-controls={`industry-detail-${tab.id}`}
                                                        id={`industry-detail-tab-${tab.id}`}
                                                        onClick={() => setActiveDetailTab(tab.id)}
                                                        className={classNames(
                                                            "inline-flex h-7 items-center gap-1.5 border px-2.5 text-[10px] uppercase tracking-widest transition-colors",
                                                            selected
                                                                ? "border-[#53b6ff]/70 bg-[#101b27] text-[#dff3ff] shadow-[0_0_10px_rgba(83,182,255,0.18)]"
                                                                : "border-[#303236] bg-[#05070b] text-slate-400 hover:border-[#53b6ff]/60 hover:text-slate-100"
                                                        )}
                                                    >
                                                        <span>{tab.label}</span>
                                                        <span
                                                            className={classNames(
                                                                "min-w-5 border px-1 py-0 text-center text-[9px]",
                                                                selected
                                                                    ? "border-[#53b6ff]/40 bg-[#53b6ff]/10 text-[#9dd8ff]"
                                                                    : "border-[#303236] bg-[#0b0d11] text-slate-500"
                                                            )}
                                                        >
                                                            {tab.count.toLocaleString()}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                <section
                                    id="industry-detail-bom"
                                    role="tabpanel"
                                    aria-labelledby="industry-detail-tab-bom"
                                    hidden={activeDetailTab !== 'bom'}
                                    className="p-3 space-y-2"
                                >
                                    <div className="flex items-center justify-between">
                                        <h2 className="text-[12px] uppercase tracking-widest text-slate-300">
                                            Bill of Materials
                                        </h2>
                                        {plan?.bom?.length > 0 && (
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setPasteOpen(v => !v)}
                                                    className="px-3 py-1.5 text-[10px] uppercase tracking-widest bg-[#151a22] border border-[#303236] hover:border-[#53b6ff] transition-colors"
                                                >
                                                    Paste stock
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handleCopyShoppingList(0)
                                                    }
                                                    className="px-3 py-1.5 text-[10px] uppercase tracking-widest bg-[#151a22] border border-[#303236] hover:border-[#53b6ff] transition-colors"
                                                    title="Copy exact BOM quantities"
                                                >
                                                    Copy shopping list
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handleCopyShoppingList(0.07)
                                                    }
                                                    className="px-3 py-1.5 text-[10px] uppercase tracking-widest bg-[#151a22] border border-[#303236] hover:border-[#53b6ff] transition-colors"
                                                    title="Copy BOM with a 7% buffer (ceil per line)"
                                                >
                                                    Copy shopping list +7%
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    {pasteOpen && (
                                        <div className="mt-2 border border-[#2b2f36] bg-[#070910] p-2 space-y-2">
                                            <div className="text-[11px] text-slate-300">
                                                Paste a list of items (names or IDs, with optional quantities), e.g.:
                                                <span className="ml-1 text-slate-400">“5 Tritanium”, “Isogen 1200”, “typeId 34 x 5000”</span>
                                            </div>
                                            <textarea
                                                value={pasteText}
                                                onChange={(e) => setPasteText(e.target.value)}
                                                rows={5}
                                                className="w-full bg-[#05070b] border border-[#303236] p-2 text-[11px] outline-none focus:border-[#53b6ff]"
                                                placeholder="Paste from EVE, spreadsheets, etc… DO NOT INCLUDE ZERO VALUES!!!"
                                            />
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    disabled={resolvingStock || !pasteText.trim()}
                                                    onClick={() => resolvePastedStock(pasteText)}
                                                    className="px-3 py-1.5 text-[10px] uppercase tracking-widest bg-[#151a22] border border-[#303236] hover:border-[#53b6ff] disabled:opacity-50"
                                                >
                                                    {resolvingStock ? 'Parsing…' : 'Apply to plan'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => { setPasteText(''); setStock({}); setLeafStock({}); }}
                                                    className="px-3 py-1.5 text-[10px] uppercase tracking-widest bg-[#151a22] border border-[#303236] hover:border-[#53b6ff]"
                                                >
                                                    Clear
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[11px]">
                                            <thead>
                                                <tr className="bg-[#14161d] text-slate-100">
                                                    <th className="border border-[#2b2d33] px-2.5 py-1.5 w-6" />
                                                    <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                                                        Type
                                                    </th>
                                                    <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                        Needed
                                                    </th>
                                                    <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                        Total
                                                    </th>
                                                    <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                        m³
                                                    </th>
                                                    <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                        Unit
                                                    </th>
                                                    <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                        Total
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {adjustedBom.map(
                                                    (
                                                        row: BomRow & {
                                                            lineVolume?: number;
                                                            volume?: number;
                                                        },
                                                        idx: number
                                                    ) => {
                                                        const rawLineVolume =
                                                            row.lineVolume !==
                                                                undefined &&
                                                                row.lineVolume !== null
                                                                ? row.lineVolume
                                                                : (row.volume ?? 0) *
                                                                row.quantity;
                                                        const lineVolume =
                                                            rawLineVolume || 0;
                                                        const bg =
                                                            idx % 2 === 0
                                                                ? "bg-[#090b11]"
                                                                : "bg-[#0c0f16]";
                                                        const origQty = origBomQtyById.get(row.typeId) ?? row.quantity;
                                                        const deducted = deductionsMap[row.typeId] || 0;
                                                        const full = deducted >= origQty;
                                                        const partial = !full && deducted > 0;
                                                        const total = origBomQtyById.get(row.typeId) ?? row.quantity;
                                                        return (
                                                            <tr
                                                                key={row.typeId}
                                                                className={`${bg} hover:bg-[#141821]`}
                                                            >
                                                                <td className="border border-[#2b2d33] px-2.5 py-1.5 w-10">
                                                                    <img
                                                                        src={typeIconUrl(
                                                                            row.typeId,
                                                                            64
                                                                        )}
                                                                        alt=""
                                                                        className="w-8 h-8 rounded-sm"
                                                                    />
                                                                </td>

                                                                <td className="border border-[#2b2d33] px-2.5 py-1.5">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="min-w-0 flex-1">
                                                                            <span className="text-slate-100">
                                                                                {row.typeName}
                                                                            </span>{" "}
                                                                            <span className="text-slate-500">({row.typeId})</span>
                                                                            {full && (
                                                                                <span className="ml-2 px-1.5 py-0.5 text-[9px] rounded bg-emerald-900/40 text-emerald-300 border border-emerald-700/40">
                                                                                    in stock
                                                                                </span>
                                                                            )}
                                                                            {partial && (
                                                                                <span className="ml-2 px-1.5 py-0.5 text-[9px] rounded bg-amber-900/40 text-amber-300 border border-amber-700/40">
                                                                                    partial
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <ItemInfoLink typeId={row.typeId} label={row.typeName} />
                                                                    </div>
                                                                </td>
                                                                <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                                    {row.quantity.toLocaleString()}
                                                                </td>
                                                                <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                                    {total.toLocaleString()}
                                                                </td>
                                                                <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                                    {lineVolume.toLocaleString(
                                                                        undefined,
                                                                        {
                                                                            maximumFractionDigits: 2,
                                                                        }
                                                                    )}
                                                                </td>
                                                                <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                                    {formatIsk(row.unitPrice)}
                                                                </td>
                                                                <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                                    {formatIsk(row.totalPrice)}
                                                                </td>
                                                            </tr>
                                                        );
                                                    }
                                                )}

                                                { }
                                                {adjustedBom.length > 0 &&
                                                    (() => {
                                                        const src = adjustedBom;
                                                        const totalVolume = src.reduce(
                                                            (sum: number, r: any) => {
                                                                const raw =
                                                                    r.lineVolume !==
                                                                        undefined &&
                                                                        r.lineVolume !== null
                                                                        ? r.lineVolume
                                                                        : (r.volume ?? 0) *
                                                                        r.quantity;
                                                                return sum + (raw || 0);
                                                            },
                                                            0
                                                        );
                                                        return (
                                                            <tr>
                                                                <td className="border border-[#2b2d33]" />
                                                                <td
                                                                    className="border border-[#2b2d33] px-2.5 py-1.5 text-right text-slate-500"
                                                                    colSpan={2}
                                                                >
                                                                    TOTAL m³ of all items
                                                                </td>
                                                                <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right font-semibold text-[#53b6ff]">
                                                                    {totalVolume.toLocaleString(
                                                                        undefined,
                                                                        {
                                                                            maximumFractionDigits: 2,
                                                                        }
                                                                    )}{" "}
                                                                    m³
                                                                </td>
                                                                <td className="border border-[#2b2d33]" />
                                                                <td className="border border-[#2b2d33]" />
                                                            </tr>
                                                        );
                                                    })()}
                                            </tbody>
                                        </table>
                                    </div>

                                    {componentStockRows.length > 0 && (
                                        <div className="border border-[#27364a] bg-[#071018]">
                                            <div className="flex items-center justify-between border-b border-[#1a2838] px-2.5 py-1.5">
                                                <div>
                                                    <div className="text-[10px] uppercase tracking-widest text-[#9dd8ff]">
                                                        Stock Applied
                                                    </div>
                                                    <div className="mt-0.5 text-[10px] text-slate-500">
                                                        Inventory consumed before runs and downstream material requirements were calculated.
                                                    </div>
                                                </div>
                                                <div className="font-mono text-[10px] text-slate-500">
                                                    {componentStockRows.length.toLocaleString()} line{componentStockRows.length === 1 ? '' : 's'}
                                                </div>
                                            </div>
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-[11px]">
                                                    <thead>
                                                        <tr className="bg-[#101721] text-slate-100">
                                                            <th className="border border-[#243243] px-2.5 py-1.5 w-10" />
                                                            <th className="border border-[#243243] px-2.5 py-1.5 text-left">
                                                                Component
                                                            </th>
                                                            <th className="border border-[#243243] px-2.5 py-1.5 text-right">
                                                                In Stock
                                                            </th>
                                                            <th className="border border-[#243243] px-2.5 py-1.5 text-right">
                                                                Applied
                                                            </th>
                                                            <th className="border border-[#243243] px-2.5 py-1.5 text-right">
                                                                Unused
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {componentStockRows.map((row, idx) => {
                                                            const bg = idx % 2 === 0 ? 'bg-[#071018]' : 'bg-[#09131d]';
                                                            return (
                                                                <tr key={row.typeId} className={`${bg} align-top hover:bg-[#101b27]`}>
                                                                    <td className="border border-[#243243] px-2.5 py-1.5">
                                                                        <img
                                                                            src={typeIconUrl(row.typeId, 64)}
                                                                            alt=""
                                                                            className="h-8 w-8 rounded-sm"
                                                                        />
                                                                    </td>
                                                                    <td className="border border-[#243243] px-2.5 py-1.5">
                                                                        <div className="flex items-start gap-2">
                                                                            <div className="min-w-0 flex-1">
                                                                                <span className="text-slate-100">{row.typeName}</span>{' '}
                                                                                <span className="text-slate-500">({row.typeId})</span>
                                                                            </div>
                                                                            <ItemInfoLink typeId={row.typeId} label={row.typeName} />
                                                                        </div>
                                                                    </td>
                                                                    <td className="border border-[#243243] px-2.5 py-1.5 text-right">
                                                                        {row.inStock.toLocaleString()}
                                                                    </td>
                                                                    <td className="border border-[#243243] px-2.5 py-1.5 text-right text-emerald-300">
                                                                        {row.applied.toLocaleString()}
                                                                    </td>
                                                                    <td className="border border-[#243243] px-2.5 py-1.5 text-right">
                                                                        {row.overflow.toLocaleString()}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </section>

                                { }
                                <section
                                    id="industry-detail-jobs"
                                    role="tabpanel"
                                    aria-labelledby="industry-detail-tab-jobs"
                                    hidden={activeDetailTab !== 'jobs'}
                                    className="p-3 space-y-2"
                                >
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <h2 className="text-[12px] uppercase tracking-widest text-slate-300">
                                            Jobs &amp; Build Steps
                                            {stockReplanning && (
                                                <span className="ml-2 text-[9px] font-normal text-[#9dd8ff]">
                                                    Applying stock…
                                                </span>
                                            )}
                                        </h2>
                                        <button
                                            type="button"
                                            onClick={() => setJobSort({ key: 'tree', direction: 'asc' })}
                                            className={classNames(
                                                "inline-flex h-7 items-center justify-center border px-2.5 text-[10px] uppercase tracking-widest transition-colors",
                                                jobSort.key === 'tree'
                                                    ? "border-[#53b6ff]/70 bg-[#101b27] text-[#dff3ff]"
                                                    : "border-[#303236] bg-[#05070b] text-slate-400 hover:border-[#53b6ff]/60 hover:text-slate-100"
                                            )}
                                        >
                                            Tree order
                                        </button>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[11px] align-top">
                                            <thead>
                                                <tr className="bg-[#14161d] text-slate-100">
                                                    <th
                                                        aria-sort={jobSortAria('mode')}
                                                        className="border border-[#2b2d33] px-2.5 py-1.5 w-40 text-left"
                                                    >
                                                        {renderJobSortHeader('mode', 'Mode')}
                                                    </th>
                                                    <th
                                                        aria-sort={jobSortAria('output')}
                                                        className="border border-[#2b2d33] px-2.5 py-1.5 text-left"
                                                    >
                                                        {renderJobSortHeader('output', 'Output')}
                                                    </th>
                                                    <th
                                                        aria-sort={jobSortAria('stock')}
                                                        className="border border-[#2b2d33] px-2.5 py-1.5 w-32 text-left"
                                                    >
                                                        {renderJobSortHeader('stock', 'Amount in stock')}
                                                    </th>
                                                    <th
                                                        aria-sort={jobSortAria('runs')}
                                                        className="border border-[#2b2d33] px-2.5 py-1.5 text-right"
                                                    >
                                                        {renderJobSortHeader('runs', 'Runs', 'right')}
                                                    </th>
                                                    <th
                                                        aria-sort={jobSortAria('materials')}
                                                        className="border border-[#2b2d33] px-2.5 py-1.5 text-left"
                                                    >
                                                        {renderJobSortHeader('materials', 'Materials')}
                                                    </th>
                                                    <th
                                                        aria-sort={jobSortAria('costShare')}
                                                        className="border border-[#2b2d33] px-2.5 py-1.5 text-right"
                                                    >
                                                        {renderJobSortHeader('costShare', '% of total cost', 'right')}
                                                    </th>
                                                    <th
                                                        aria-sort={jobSortAria('jobCost')}
                                                        className="border border-[#2b2d33] px-2.5 py-1.5 text-right"
                                                    >
                                                        {renderJobSortHeader('jobCost', 'Job Cost', 'right')}
                                                    </th>
                                                    <th
                                                        aria-sort={jobSortAria('jobCostPerUnit')}
                                                        className="border border-[#2b2d33] px-2.5 py-1.5 text-right"
                                                    >
                                                        {renderJobSortHeader('jobCostPerUnit', 'Job / unit', 'right')}
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {sortedJobs.map((job: FlatJob, idx: number) => {
                                                    const bg =
                                                        idx % 2 === 0
                                                            ? "bg-[#090b11]"
                                                            : "bg-[#0c0f16]";
                                                    const treeDepth =
                                                        jobTreeMetaByOutput.get(job.outputTypeId)?.depth ?? 0;
                                                    return (
                                                        <tr
                                                            key={job.id}
                                                            className={`${bg} hover:bg-[#141821] align-top`}
                                                        >
                                                            { }
                                                            <td className="border border-[#2b2d33] px-2.5 py-1.5 w-40">
                                                                <div className="flex items-center gap-2">
                                                                    <img
                                                                        src={typeIconUrl(
                                                                            job.outputTypeId,
                                                                            64
                                                                        )}
                                                                        alt=""
                                                                        className="w-8 h-8 rounded-sm"
                                                                    />
                                                                    <select
                                                                        className="bg-[#05070b] border border-[#303236] px-2 py-0.5 text-[9px] outline-none focus:border-[#53b6ff]"
                                                                        value={
                                                                            overrides[
                                                                            job.outputTypeId
                                                                            ] || "build"
                                                                        }
                                                                        onChange={(e) => {
                                                                            const mode =
                                                                                e.target.value as
                                                                                | "build"
                                                                                | "buy";
                                                                            setOverrides((prev) => {
                                                                                const next = {
                                                                                    ...prev,
                                                                                    [job.outputTypeId]:
                                                                                        mode,
                                                                                };
                                                                                handleSubmit(next);
                                                                                return next;
                                                                            });
                                                                        }}
                                                                    >
                                                                        <option value="build">
                                                                            Manufacture
                                                                        </option>
                                                                        <option value="buy">
                                                                            Buy
                                                                        </option>
                                                                    </select>
                                                                </div>
                                                            </td>

                                                            { }
                                                            <td className="border border-[#2b2d33] px-2.5 py-1.5">
                                                                <div
                                                                    className="flex items-start gap-2"
                                                                    style={{
                                                                        paddingLeft: `${Math.min(treeDepth, 6) * 12}px`,
                                                                    }}
                                                                >
                                                                    <div className="min-w-0 flex-1">
                                                                        {job.outputTypeName}{" "}
                                                                <span className="text-slate-500">
                                                                    ({job.outputTypeId})
                                                                </span>
                                                                <div className="text-slate-500 text-[10px]">
                                                                    {job.activity ===
                                                                        "manufacturing"
                                                                        ? "Manufacturing"
                                                                        : job.activity ===
                                                                            "reaction"
                                                                            ? "Reaction"
                                                                            : job.activity}
                                                                    {job.blueprintId
                                                                        ? ` • BP #${job.blueprintId}, ${job.outputQuantity} total`
                                                                        : ` • ${job.outputQuantity} total`}
                                                                </div>
                                                                    </div>
                                                                    <ItemInfoLink
                                                                        typeId={job.outputTypeId}
                                                                        label={job.outputTypeName}
                                                                    />
                                                                </div>
                                                            </td>

                                                            { }
                                                            <td className="border border-[#2b2d33] px-2.5 py-1.5 w-32">
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    value={
                                                                        stock[
                                                                        job.outputTypeId
                                                                        ] ?? 0
                                                                    }
                                                                    onChange={(e) =>
                                                                        setStock((prev) => ({
                                                                            ...prev,
                                                                            [job.outputTypeId]:
                                                                                Math.floor(Math.max(
                                                                                    0,
                                                                                    Number(
                                                                                        e.target.value
                                                                                    ) || 0
                                                                                )),
                                                                        }))
                                                                    }
                                                                    className="w-28 bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff]"
                                                                    placeholder="0"
                                                                />
                                                            </td>

                                                            { }
                                                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                                {job.runs.toLocaleString()}
                                                            </td>

                                                            { }
                                                            <td className="border border-[#2b2d33] px-2.5 py-1.5">
                                                                {job.materials.map((m) => (
                                                                    <div key={m.typeId}>
                                                                        {m.quantity.toLocaleString()}{" "}
                                                                        x {m.typeName}
                                                                    </div>
                                                                ))}
                                                            </td>

                                                            { }
                                                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                                {jobShareMap[job.outputTypeId] !=
                                                                    null
                                                                    ? `${(
                                                                        jobShareMap[
                                                                        job.outputTypeId
                                                                        ] * 100
                                                                    ).toFixed(1)}%`
                                                                    : "—"}
                                                            </td>

                                                            { }
                                                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                                {formatIsk(job.jobCost)}
                                                            </td>

                                                            { }
                                                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                                {formatIsk(job.jobCostPerUnit)}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </section>

                                { }
                                <section
                                    id="industry-detail-tree"
                                    role="tabpanel"
                                    aria-labelledby="industry-detail-tab-tree"
                                    hidden={activeDetailTab !== 'tree'}
                                    className="p-3 space-y-2"
                                >
                                    <h2 className="text-[12px] uppercase tracking-widest text-slate-300">
                                        Build Tree (per product)
                                    </h2>
                                    <p className="text-[11px] text-slate-400">
                                        Plain text script from goals to raw inputs. Invention is
                                        omitted; use Additional Cost for BPCs and related
                                        expenses.
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {(effectivePlan?.tree || []).map((root: TreeNode, idx: number) => (
                                            <div
                                                key={idx}
                                                className="bg-[#070910] border border-[#262933] px-3 py-2"
                                            >
                                                {renderTree([root])}
                                            </div>
                                        ))}
                                    </div>
                                </section>
                                </section>
                            </>
                        )}
                    </div>
                </div>
            </div>
            {saveDialogMode && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-3">
                    <div className="w-full max-w-md border border-[#34404c] bg-[#070910] text-slate-100 shadow-2xl shadow-black/70">
                        <div className="flex min-h-9 items-center justify-between border-b border-[#20242c] bg-[#101219] px-3 py-1.5">
                            <div>
                                <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-200">
                                    {saveDialogMode === 'rename'
                                        ? 'Rename Saved Chain'
                                        : saveDialogMode === 'update'
                                            ? 'Update Saved Chain'
                                            : 'Save Chain'}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                    {saveDialogMode === 'rename'
                                        ? 'Rename this industry production chain.'
                                        : 'Save the current products, settings, build/buy choices, and stock deductions.'}
                                </div>
                            </div>
                            <button
                                type="button"
                                className="text-slate-500 hover:text-slate-100"
                                onClick={() => {
                                    if (setupBusy) return;
                                    setSaveDialogMode(null);
                                    setSaveName('');
                                }}
                                aria-label="Close"
                            >
                                <X size={15} />
                            </button>
                        </div>

                        <form className="space-y-3 p-3" onSubmit={handleSaveDialogSubmit}>
                            <label className="block">
                                <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">
                                    Chain Name
                                </span>
                                <input
                                    value={saveName}
                                    onChange={(event) => setSaveName(event.target.value)}
                                    className="w-full border border-[#303236] bg-[#05070b] px-2 py-1.5 text-[12px] text-slate-100 outline-none focus:border-[#53b6ff]"
                                    maxLength={160}
                                    autoFocus
                                />
                            </label>

                            {saveDialogMode !== 'rename' && (
                                <div className="border border-[#20242c] bg-[#080c13] px-2 py-2 text-[11px] leading-relaxed text-slate-400">
                                    Results are not saved. Loading a chain restores the inputs and recalculates with current market and industry data.
                                </div>
                            )}

                            {setupError && (
                                <div className="border border-[#6b2b32] bg-[#1d090b] px-2 py-1.5 text-[11px] text-[#ffaaaa]">
                                    {setupError}
                                </div>
                            )}

                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    className="inline-flex h-7 items-center justify-center gap-1 border border-[#303236] bg-[#05070b] px-2.5 text-[10px] uppercase tracking-widest text-slate-300 hover:border-[#53b6ff]/60 hover:bg-[#101219] disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={!!setupBusy}
                                    onClick={() => {
                                        setSaveDialogMode(null);
                                        setSaveName('');
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!!setupBusy}
                                    className="inline-flex h-7 items-center justify-center gap-1 border border-[#46b2ff]/70 bg-gradient-to-b from-[#1b8cc8] to-[#14608a] px-2.5 text-[10px] font-semibold uppercase tracking-widest text-slate-50 shadow-[0_0_10px_rgba(70,178,255,0.35)] hover:from-[#27a0df] hover:to-[#1672a4] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {setupBusy ? 'Saving...' : saveDialogMode === 'rename' ? 'Rename' : 'Save'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

interface SummaryCardProps {
    label: string;
    value: string;
    sub?: string;
    highlight?: boolean;
    extra?: string;
}
interface FacilityCardProps {
    title: string;
    me: number;
    facility: FacilityConfig;
    onMeChange: (val: string) => void;
    onFacilityChange: (patch: Partial<FacilityConfig>) => void;
    kind?: "manufacturing" | "reaction";
}

const FacilityCard: React.FC<FacilityCardProps> = ({
    title,
    me,
    facility,
    onMeChange,
    onFacilityChange,
    kind = "manufacturing",
}) => {
    const isReaction = kind === "reaction";

    return (
        <div className="bg-[#05070b]/90 border border-[#262933] px-3 py-2 space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-slate-300">
                {title}
            </div>
            {!isReaction && (
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 uppercase tracking-widest">
                        Blueprint ME
                    </span>
                    <input
                        type="number"
                        min={0}
                        max={10}
                        step={1}
                        value={me}
                        onChange={(e) => onMeChange(e.target.value)}
                        className="w-16 bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff]"
                    />
                </div>
            )}
            {isReaction && (
                <div className="text-[10px] text-slate-500">
                    Reaction blueprints have no ME research; only structure &amp; rig
                    affect materials.
                </div>
            )}
            <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-400">
                <div className="flex flex-col gap-1">
                    <span className="uppercase tracking-widest">Structure</span>
                    <select
                        className="bg-[#05070b] border border-[#303236] px-1.5 py-1 text-[10px] outline-none focus:border-[#53b6ff]"
                        value={facility.structure}
                        onChange={(e) =>
                            onFacilityChange({
                                structure: e.target.value as FacilityStructure,
                            })
                        }
                    >
                        {isReaction ? (
                            <>
                                <option value="NPC_STATION">NPC Station</option>
                                <option value="ATHANOR">Athanor</option>
                                <option value="TATARA">Tatara</option>
                            </>
                        ) : (
                            <>
                                <option value="NPC_STATION">NPC Station</option>
                                <option value="RAITARU">Raitaru</option>
                                <option value="AZBEL">Azbel</option>
                                <option value="SOTIYO">Sotiyo</option>
                            </>
                        )}
                    </select>
                </div>

                <div className="flex flex-col gap-1">
                    <span className="uppercase tracking-widest">Rig</span>
                    <select
                        className="bg-[#05070b] border border-[#303236] px-1.5 py-1 text-[10px] outline-none focus:border-[#53b6ff]"
                        value={facility.rig}
                        onChange={(e) =>
                            onFacilityChange({
                                rig: e.target.value as FacilityConfig["rig"],
                            })
                        }
                    >
                        <option value="NONE">None</option>
                        <option value="T1">T1</option>
                        <option value="T2">T2</option>
                    </select>
                </div>

                <div className="flex flex-col gap-1">
                    <span className="uppercase tracking-widest">Security</span>
                    <select
                        className="bg-[#05070b] border border-[#303236] px-1.5 py-1 text-[10px] outline-none focus:border-[#53b6ff]"
                        value={facility.security}
                        onChange={(e) =>
                            onFacilityChange({
                                security: e.target.value as FacilityConfig["security"],
                            })
                        }
                    >
                        <option value="HIGH">High</option>
                        <option value="LOW">Low</option>
                        <option value="NULL_WH">Null / WH</option>
                    </select>
                </div>
            </div>
        </div>
    );
};

const SummaryCard: React.FC<SummaryCardProps> = ({
    label,
    value,
    sub,
    highlight,
    extra,
}) => {
    const displaySub = sub && /\bSCI\b/.test(sub)
        ? "EIV x (System Cost Index + facility tax + SCC surcharge)"
        : sub;

    return (
        <div
            className={`border px-3 py-3 bg-[#05070b]/90 ${highlight
                ? "border-[#46b2ff]/70 shadow-[0_0_18px_rgba(70,178,255,0.35)]"
                : "border-[#262933]"
                }`}
        >
            <div className="text-[10px] text-slate-400 uppercase tracking-widest">
                {label}
            </div>
            <div className="text-[16px] font-semibold text-[#c1e5ff]">
                {value}
                {extra && (
                    <span className="ml-1 text-[11px] text-slate-400 font-normal">
                        {extra}
                    </span>
                )}
            </div>
            {displaySub && (
                <div className="text-[10px] text-slate-500 mt-0.5">{displaySub}</div>
            )}
        </div>
    );
};

export default Industry;
