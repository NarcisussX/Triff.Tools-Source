/*
 * React page for /compressed.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import infoIconRaw from "../assets/icons/info.svg?raw";
import {
    requestSiteAuthModal,
    SITE_AUTH_CHANGED_EVENT,
    type SiteAuthChangeDetail,
} from "../auth/siteAuthEvents";
import type { AuthUser } from "../components/fitting/types";

const FIELD =
    "w-full bg-[#05070b] border border-[#303236] px-2 py-1.5 text-[11px] " +
    "text-slate-100 placeholder-slate-400 rounded-[2px] " +
    "focus:outline-none focus:border-[#53b6ff] focus:ring-0";

const FIELD_SELECT =
    "w-full bg-[#05070b] border border-[#303236] px-2 py-1.5 text-[11px] " +
    "text-slate-100 rounded-[2px] focus:outline-none focus:border-[#53b6ff] focus:ring-0 appearance-none";

export type Mineral =
    | "Tritanium"
    | "Pyerite"
    | "Mexallon"
    | "Isogen"
    | "Nocxium"
    | "Zydrine"
    | "Megacyte"
    | "Morphite";

const MINERALS: Mineral[] = [
    "Tritanium",
    "Pyerite",
    "Mexallon",
    "Isogen",
    "Nocxium",
    "Zydrine",
    "Megacyte",
    "Morphite",
];

const MINERAL_TYPE_IDS: Record<Mineral, number> = {
    Tritanium: 34,
    Pyerite: 35,
    Mexallon: 36,
    Isogen: 37,
    Nocxium: 38,
    Zydrine: 39,
    Megacyte: 40,
    Morphite: 11399,
};

const HUBS = [
    { id: 60003760, label: "Jita 4-4" },
    { id: 60008494, label: "Amarr (Oris) – Emperor Family Academy" },
    { id: 60011866, label: "Dodixie IX-20 – Fed Navy Assembly Plant" },
    { id: 60005686, label: "Hek VIII-12 – Boundless Creation Factory" },
    { id: 60004588, label: "Rens VI-8 – Brutor Tribe Treasury" },
] as const;

const ORE_CATEGORIES: Record<string, string[]> = {
    "Simple ores": ["Veldspar", "Scordite", "Pyroxeres", "Plagioclase", "Mordunium"],
    "Coherent ores": [
        "Omber",
        "Kernite",
        "Jaspet",
        "Hemorphite",
        "Hedbergite",
        "Ytirium",
        "Nocxite",
        "Griemeer",
    ],
    "Variegated ores": ["Gneiss", "Dark Ochre", "Crokite", "Kylixium"],
    "Complex ores": [
        "Bistot",
        "Arkonor",
        "Spodumain",
        "Eifyrium",
        "Ducinium",
        "Ueganite",
        "Hezorime",
    ],
    "Abyssal ores": ["Bezdnacine", "Rakovene", "Talassonite"],
    Mercoxit: ["Mercoxit"],
};

const RIGS = [
    { label: "No rig", value: 0 },
    { label: "T1 (+1%)", value: 0.01 },
    { label: "T2 (+3%)", value: 0.03 },
] as const;

const IMPLANTS = [
    { label: "No implant", value: 0 },
    { label: "RX-801 (+1%)", value: 0.01 },
    { label: "RX-802 (+2%)", value: 0.02 },
    { label: "RX-804 (+4%)", value: 0.04 },
] as const;

const SECURITIES = [
    { label: "HS (0%)", value: 0 },
    { label: "LS (+6%)", value: 0.06 },
    { label: "NS (+12%)", value: 0.12 },
    { label: "WH (+12%)", value: 0.12 },
] as const;

const STRUCTURES = [
    { label: "Unbonused (0%)", value: 0 },
    { label: "Athanor (+2%)", value: 0.02 },
    { label: "Tatara (+5.5%)", value: 0.055 },
] as const;

const ORE_REPROCESSING_STATE_TOOL_KEY = "ore-reprocessing";

type Targets = Record<Mineral, number>;
function zeroTargets(): Targets {
    return {
        Tritanium: 0,
        Pyerite: 0,
        Mexallon: 0,
        Isogen: 0,
        Nocxium: 0,
        Zydrine: 0,
        Megacyte: 0,
        Morphite: 0,
    };
}

type OreMeta = { typeId?: number | null; m3?: number | null };

type OreReprocessingRememberedInputs = {
    rateInput?: string;
    useRateBuilder?: boolean;
    rigBonus?: number;
    implBonus?: number;
    secBonus?: number;
    structBonus?: number;
    reproc?: number;
    reprocEff?: number;
    specOre?: number;
    allowedOres?: string[];
};

const UNIT_M3_PER_MINERAL = 0.01;

function clampInt(value: unknown, min: number, max: number, fallback: number) {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
    const next = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
    return Math.min(max, Math.max(min, next));
}

function optionValue<T extends readonly { value: number }[]>(value: unknown, options: T, fallback: number) {
    const next = Number(value);
    return options.some((option) => option.value === next) ? next : fallback;
}

function normalizeOreReprocessingRememberedInputs(raw: unknown): OreReprocessingRememberedInputs {
    const source = raw && typeof raw === "object" ? raw as OreReprocessingRememberedInputs : {};
    const allowedOres = Array.isArray(source.allowedOres)
        ? source.allowedOres.filter((name): name is string => typeof name === "string")
        : undefined;
    return {
        rateInput: typeof source.rateInput === "string" ? source.rateInput.slice(0, 32) : "86.0284",
        useRateBuilder: Boolean(source.useRateBuilder),
        rigBonus: optionValue(source.rigBonus, RIGS, 0),
        implBonus: optionValue(source.implBonus, IMPLANTS, 0),
        secBonus: optionValue(source.secBonus, SECURITIES, 0),
        structBonus: optionValue(source.structBonus, STRUCTURES, 0),
        reproc: clampInt(source.reproc, 0, 5, 5),
        reprocEff: clampInt(source.reprocEff, 0, 5, 5),
        specOre: clampInt(source.specOre, 0, 5, 4),
        allowedOres,
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

function formatInt(n?: number | null) {
    if (n == null) return "—";
    return Number(n).toLocaleString();
}
function formatM3(n?: number | null) {
    if (n == null) return "—";
    return `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`;
}
function formatISK(n?: number | null) {
    if (n == null) return "—";
    return `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })} ISK`;
}

function classNames(...values: (string | false | null | undefined)[]) {
    return values.filter(Boolean).join(" ");
}

const infoIconMarkup = infoIconRaw.replace(/^\s*<symbol\b[^>]*>/, "").replace(/<\/symbol>\s*$/, "");

function InfoGlyph({ className = "h-3.5 w-3.5" }: { className?: string }) {
    return (
        <svg aria-hidden="true" focusable="false" viewBox="0 0 128 128" className={classNames("inline-block shrink-0", className)}>
            <style>{".shape{fill:currentColor}"}</style>
            <g dangerouslySetInnerHTML={{ __html: infoIconMarkup }} />
        </svg>
    );
}

function ItemInfoLink({
    typeId,
    label,
    className = "",
}: {
    typeId?: number | null;
    label: string;
    className?: string;
}) {
    if (!Number.isInteger(typeId)) return null;
    return (
        <a
            href={`/items/${typeId}`}
            target="_blank"
            rel="noreferrer"
            className={classNames(
                "inline-flex h-5 w-5 shrink-0 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 opacity-80 hover:border-[#53b6ff]/70 hover:bg-[#101b27] hover:text-[#9dd8ff] hover:opacity-100",
                className,
            )}
            title={`Show info: ${label}`}
            aria-label={`Show info: ${label}`}
        >
            <InfoGlyph className="h-3 w-3" />
        </a>
    );
}

type InfoHeadProps = {
    children: React.ReactNode;
    tip: string;
    id: string;
    className?: string;
};

function InfoHead({ children, tip, className = "", id }: InfoHeadProps) {
    return (
        <th
            scope="col"
            className={`border border-[#2b2d33] bg-[#14161c] px-2.5 py-1.5 text-left text-[11px] relative overflow-visible whitespace-nowrap ${className}`}
        >
            <span
                className="group/ih inline-flex items-center gap-1 cursor-help"
                aria-describedby={id}
            >
                {children}
                <span
                    aria-hidden="true"
                    className="inline-flex items-center justify-center w-4 h-4 rounded-sm border border-[#4b9cff]/60 bg-[#0b111a] text-[10px] font-bold leading-none text-[#c1e5ff] group-hover/ih:border-[#7fc5ff] group-hover/ih:text-white transition-colors duration-150 translate-y-[1px]"
                >
                    ?
                </span>

                <div
                    id={id}
                    role="tooltip"
                    className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 hidden group-hover/ih:block group-focus-within/ih:block w-44 sm:w-56 max-w-xs px-2 py-1 rounded-sm border border-[#262933] shadow-lg bg-[#05070b]/95 text-[11px] leading-snug text-slate-100 whitespace-normal break-words pointer-events-none select-none"
                >
                    {tip}
                </div>
            </span>
        </th>
    );
}

export default function CompressedOrePlanner() {

    const allowedInitializedRef = useRef(false);
    const [oreNames, setOreNames] = useState<string[]>([]);
    const [oreMetaByName, setOreMetaByName] = useState<Map<string, OreMeta>>(new Map());
    const [allowed, setAllowed] = useState<Set<string>>(new Set());
    const [rememberedAllowedOres, setRememberedAllowedOres] = useState<string[] | null>(null);

    const [targets, setTargets] = useState<Targets>(() => zeroTargets());
    const [rateInput, setRateInput] = useState("86.0284");

    const [strategy, setStrategy] = useState<"min_cost" | "min_haul" | "blend">("min_cost");
    const [haulMode, setHaulMode] = useState<"m3" | "batches">("m3");
    const [stationId, setStationId] = useState<number>(60003760);
    const [priceField, setPriceField] = useState<string>("sell_5pct");
    const [blendWeight, setBlendWeight] = useState<number>(0.5);

    const [plan, setPlan] = useState<any>(null);
    const [err, setErr] = useState<string | null>(null);

    const [useRateBuilder, setUseRateBuilder] = useState(false);
    const [rigBonus, setRigBonus] = useState<number>(0);
    const [implBonus, setImplBonus] = useState<number>(0);
    const [secBonus, setSecBonus] = useState<number>(0);
    const [structBonus, setStructBonus] = useState<number>(0);
    const [reproc, setReproc] = useState<number>(5);
    const [reprocEff, setReprocEff] = useState<number>(5);
    const [specOre, setSpecOre] = useState<number>(4);

    const [unitPriceByTypeId, setUnitPriceByTypeId] = useState<Map<number, number>>(new Map());

    const [mineralPriceById, setMineralPriceById] = useState<Map<number, number>>(new Map());

    const [copied, setCopied] = useState(false);
    const [authUser, setAuthUser] = useState<AuthUser | null>(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [remoteStateReady, setRemoteStateReady] = useState(false);

    function copyShoppingList() {
        if (!plan?.rows?.length) return;
        const lines = plan.rows.map((r: any) => {
            const units = (Number(r.batches) || 0) * 100;
            return `${units}\tCompressed ${r.name}`;
        });
        const blob = lines.join("\n");
        navigator.clipboard
            ?.writeText(blob)
            .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => {
                const ta = document.createElement("textarea");
                ta.value = blob;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            });
    }

    function computeEffectiveRate(): number {
        const base = 0.5;
        const baseWithRig = base + rigBonus;

        const securityMultiplier = rigBonus > 0 ? 1 + secBonus : 1;
        const rate =
            baseWithRig *
            (1 + 0.03 * reproc) *
            (1 + 0.02 * reprocEff) *
            (1 + 0.02 * specOre) *
            (1 + implBonus) *
            securityMultiplier *
            (1 + structBonus);
        return Math.min(Math.max(rate, 0), 1);
    }

    const effectiveRate = useMemo(computeEffectiveRate, [
        rigBonus,
        implBonus,
        secBonus,
        structBonus,
        reproc,
        reprocEff,
        specOre,
    ]);

    useEffect(() => {
        if (useRateBuilder) {
            setRateInput((effectiveRate * 100).toFixed(4));
        }
    }, [effectiveRate, useRateBuilder]);

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
            setRememberedAllowedOres(null);
            allowedInitializedRef.current = false;
            if (oreNames.length) setAllowed(new Set(oreNames));
            return;
        }

        let cancelled = false;

        async function loadRemoteState() {
            setRemoteStateReady(false);
            try {
                const response = await fetch(`/api/tool-state/${ORE_REPROCESSING_STATE_TOOL_KEY}`, {
                    credentials: "include",
                });
                const data = await readJson<{
                    ok: boolean;
                    state: { stateJson?: unknown } | null;
                }>(response);
                if (cancelled) return;
                if (!data.state?.stateJson) {
                    setRememberedAllowedOres(null);
                    allowedInitializedRef.current = false;
                    return;
                }
                const remembered = normalizeOreReprocessingRememberedInputs(data.state.stateJson);
                setRateInput(remembered.rateInput || "86.0284");
                setUseRateBuilder(Boolean(remembered.useRateBuilder));
                setRigBonus(remembered.rigBonus ?? 0);
                setImplBonus(remembered.implBonus ?? 0);
                setSecBonus(remembered.secBonus ?? 0);
                setStructBonus(remembered.structBonus ?? 0);
                setReproc(remembered.reproc ?? 5);
                setReprocEff(remembered.reprocEff ?? 5);
                setSpecOre(remembered.specOre ?? 4);
                setRememberedAllowedOres(remembered.allowedOres ?? null);
            } catch {
                if (!cancelled) {
                    setRememberedAllowedOres(null);
                    allowedInitializedRef.current = false;
                }
            } finally {
                if (!cancelled) setRemoteStateReady(true);
            }
        }

        void loadRemoteState();
        return () => {
            cancelled = true;
        };
    }, [authUser, oreNames]);

    const [needsMode, setNeedsMode] = useState<"form" | "paste">("form");
    const [needsPaste, setNeedsPaste] = useState("");

    function parseNeedsFromText(text: string) {

        const parsed: Targets = {
            Tritanium: 0,
            Pyerite: 0,
            Mexallon: 0,
            Isogen: 0,
            Nocxium: 0,
            Zydrine: 0,
            Megacyte: 0,
            Morphite: 0,
        };
        const lines = text
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);

        for (const line of lines) {
            const lc = line.toLowerCase();
            const name = MINERALS.find((m) => lc.includes(m.toLowerCase()));
            if (!name) continue;
            const numMatch = line.match(/(?:^|[^\d])([0-9][\d_,\.]*)/);
            if (!numMatch) continue;
            const qty = parseInt(numMatch[1].replace(/[^\d]/g, ""), 10);
            if (Number.isFinite(qty)) parsed[name] = (parsed[name] || 0) + qty;
        }
        return parsed;
    }

    function applyParsedNeeds() {
        const parsed = parseNeedsFromText(needsPaste);
        setTargets(parsed);
        setNeedsMode("form");
    }

    useEffect(() => {
        fetch("/api/ore-planner/ores")
            .then((r) => r.json())
            .then((data) => {
                const names: string[] = (data?.ores || []).map((o: any) => o.name);
                setOreNames(names);
                const meta = new Map<string, OreMeta>();
                (data?.ores || []).forEach((o: any) => {
                    const typeId = o?.typeIdCompressed ?? o?.compressedTypeId ?? null;
                    const m3 = o?.volumeCompressedM3 ?? o?.compressedM3 ?? null;
                    meta.set(o.name, {
                        typeId: Number.isFinite(typeId)
                            ? Number(typeId)
                            : typeof typeId === "string"
                                ? Number(typeId)
                                : null,
                        m3: m3 == null ? null : Number(m3),
                    });
                });
                setOreMetaByName(meta);
            })
            .catch((e) => setErr(e?.message || "Failed to load ores"));
    }, []);

    useEffect(() => {
        if (!oreNames.length) return;

        if (rememberedAllowedOres) {
            const valid = rememberedAllowedOres.filter((name) => oreNames.includes(name));
            setAllowed(new Set(valid));
            allowedInitializedRef.current = true;
            return;
        }

        if (authUser && !remoteStateReady) return;

        if (allowedInitializedRef.current) {
            setAllowed((prev) => new Set(Array.from(prev).filter((name) => oreNames.includes(name))));
            return;
        }

        setAllowed(new Set(oreNames));
        allowedInitializedRef.current = true;
    }, [authUser, oreNames, rememberedAllowedOres, remoteStateReady]);

    const allowedSignature = useMemo(() => Array.from(allowed).sort().join("\u001f"), [allowed]);

    useEffect(() => {
        if (!authUser || !remoteStateReady || !oreNames.length || !allowedInitializedRef.current) return;

        const validAllowedOres = Array.from(allowed)
            .filter((name) => oreNames.includes(name))
            .sort();
        const snapshot: OreReprocessingRememberedInputs = {
            rateInput,
            useRateBuilder,
            rigBonus,
            implBonus,
            secBonus,
            structBonus,
            reproc,
            reprocEff,
            specOre,
            allowedOres: validAllowedOres,
        };

        const timer = window.setTimeout(() => {
            void fetch(`/api/tool-state/${ORE_REPROCESSING_STATE_TOOL_KEY}`, {
                method: "PUT",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ stateJson: snapshot }),
            }).catch(() => { });
        }, 600);

        return () => window.clearTimeout(timer);
    }, [
        allowedSignature,
        authUser,
        implBonus,
        oreNames,
        rateInput,
        remoteStateReady,
        reproc,
        reprocEff,
        rigBonus,
        secBonus,
        specOre,
        structBonus,
        useRateBuilder,
    ]);

    function toggleOre(name: string) {
        setAllowed((prev) => {
            const n = new Set(prev);
            n.has(name) ? n.delete(name) : n.add(name);
            return n;
        });
    }
    function setAllAllowed(v: boolean) {
        setAllowed(() => (v ? new Set(oreNames) : new Set()));
    }
    function ignoreLowVolumeTritSources() {
        const lows = ["Spodumain", "Bezdnacine", "Rakovene", "Talassonite"];
        setAllowed((prev) => {
            const n = new Set(prev);
            for (const x of lows) n.delete(x);
            return n;
        });
    }
    function onChangeTarget(m: Mineral, v: string) {
        const num = Math.max(0, parseInt(v.replace(/[^0-9]/g, "") || "0", 10));
        setTargets((t) => ({ ...t, [m]: num }));
    }

    function onCalculate() {
        setErr(null);
        const body: any = {
            targets,
            refineRate: rateInput.trim(),
            allowedOres: Array.from(allowed),
            strategy,
        };
        if (strategy === "min_haul") {
            body.haul_mode = haulMode;
        } else if (strategy === "min_cost") {
            body.station_id = stationId;
            body.price_field = priceField;
        } else if (strategy === "blend") {
            body.station_id = stationId;
            body.price_field = priceField;
            body.blend_weight = blendWeight;
        }

        fetch("/api/ore-planner/plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        })
            .then(async (r) => {
                const payload = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(payload?.error || `HTTP ${r.status}`);
                return payload;
            })
            .then(setPlan)
            .catch((e) => {
                setPlan(null);
                setErr(e?.message || "Failed to calculate");
            });
    }

    useEffect(() => {
        if (!plan?.rows?.length) {
            setUnitPriceByTypeId(new Map());
            return;
        }
        const typeIds = Array.from(
            new Set(
                plan.rows
                    .map((r: any) => oreMetaByName.get(r.name)?.typeId)
                    .filter((id: any): id is number => Number.isInteger(id)),
            ),
        );
        if (typeIds.length === 0) {
            setUnitPriceByTypeId(new Map());
            return;
        }

        const qs = new URLSearchParams({
            station_id: String(stationId),
            type_ids: typeIds.join(","),
        });
        fetch(`https://triff.tools/api/prices/station?${qs.toString()}`, {
            headers: { Accept: "application/json" },
        })
            .then((r) => r.json())
            .then((data) => {
                const m = new Map<number, number>();
                const rows = Array.isArray(data?.rows) ? data.rows : [];
                for (const row of rows) {
                    const unit = row?.[priceField] ?? row?.sell_5pct ?? row?.sell_min ?? null;
                    const val = unit == null ? null : Number(unit);
                    if (Number.isFinite(val)) m.set(Number(row.type_id), val);
                }
                setUnitPriceByTypeId(m);
            })
            .catch(() => setUnitPriceByTypeId(new Map()));
    }, [plan, stationId, priceField, oreMetaByName]);

    useEffect(() => {
        const ids = Object.values(MINERAL_TYPE_IDS);
        const qs = new URLSearchParams({
            station_id: String(stationId),
            type_ids: ids.join(","),
        });
        fetch(`https://triff.tools/api/prices/station?${qs.toString()}`, {
            headers: { Accept: "application/json" },
        })
            .then((r) => r.json())
            .then((data) => {
                const m = new Map<number, number>();
                const rows = Array.isArray(data?.rows) ? data.rows : [];
                for (const row of rows) {
                    const unit = row?.[priceField] ?? row?.sell_5pct ?? row?.sell_min ?? null;
                    const val = unit == null ? null : Number(unit);
                    if (Number.isFinite(val)) m.set(Number(row.type_id), val);
                }
                setMineralPriceById(m);
            })
            .catch(() => setMineralPriceById(new Map()));
    }, [stationId, priceField]);

    function rowM3(name: string, batches: number): number | null {
        const m3 = oreMetaByName.get(name)?.m3;
        return m3 == null ? null : batches * 100 * m3;
    }
    function rowUnitOrePrice(name: string): number | null {
        const tid = oreMetaByName.get(name)?.typeId;
        if (!Number.isInteger(tid)) return null;
        const p = unitPriceByTypeId.get(tid as number);
        return typeof p === "number" && isFinite(p) ? p : null;
    }
    function rowCost(name: string, batches: number): number | null {
        const unit = rowUnitOrePrice(name);
        return unit == null ? null : batches * 100 * unit;
    }
    function mineralUnitPrice(mineral: Mineral): number | null {
        const tid = MINERAL_TYPE_IDS[mineral];
        const p = mineralPriceById.get(tid);
        return typeof p === "number" && isFinite(p) ? p : null;
    }
    function rowReprocessedValue(row: any): number | null {
        let total = 0,
            any = false;
        for (const m of MINERALS) {
            const qty = Number(row.yields?.[m] || 0);
            if (qty <= 0) continue;
            const unit = mineralUnitPrice(m);
            if (unit != null) {
                total += qty * unit;
                any = true;
            }
        }
        return any ? total : null;
    }

    const totalsForList = useMemo(() => {
        const rows = plan?.rows ?? [];
        let tb = 0,
            tm3 = 0,
            tc = 0,
            tv = 0;
        let anyM3 = false,
            anyCost = false,
            anyVal = false;
        for (const r of rows) {
            const b = Number(r.batches) || 0;
            tb += b;
            const m3 = rowM3(r.name, b);
            if (m3 != null) {
                tm3 += m3;
                anyM3 = true;
            }
            const c = rowCost(r.name, b);
            if (c != null) {
                tc += c;
                anyCost = true;
            }
            const v = rowReprocessedValue(r);
            if (v != null) {
                tv += v;
                anyVal = true;
            }
        }
        return {
            batches: tb,
            m3: anyM3 ? tm3 : null,
            cost: anyCost ? tc : null,
            value: anyVal ? tv : null,
        };
    }, [plan, unitPriceByTypeId, mineralPriceById, oreMetaByName]);

    const producedMinerals = useMemo(() => {
        const out: Record<Mineral, number> = {
            Tritanium: 0,
            Pyerite: 0,
            Mexallon: 0,
            Isogen: 0,
            Nocxium: 0,
            Zydrine: 0,
            Megacyte: 0,
            Morphite: 0,
        };
        if (plan?.totals) {
            for (const m of MINERALS) {
                const t = plan.totals[m];
                if (t) out[m] = Number(t.produced) || 0;
            }
        } else if (plan?.rows) {

            for (const r of plan.rows)
                for (const m of MINERALS) out[m] += Number(r.yields?.[m] || 0);
        }
        return out;
    }, [plan]);

    const productTotalM3 = useMemo(() => {
        const sum = MINERALS.reduce((acc, m) => acc + (producedMinerals[m] || 0), 0);
        return sum * UNIT_M3_PER_MINERAL;
    }, [producedMinerals]);

    const bottomSummary = useMemo(() => {
        const oresM3 = totalsForList.m3 ?? 0;

        let targetedM3 = 0,
            surplusM3 = 0,
            allM3 = 0;
        let targetedVal = 0,
            surplusVal = 0,
            allVal = 0;

        for (const m of MINERALS) {
            const t = plan?.totals?.[m];
            const produced = t ? Number(t.produced) || 0 : 0;
            const target = t ? Number(t.target) || 0 : Number(targets[m] || 0);

            const used = Math.min(produced, target);
            const extra = Math.max(0, produced - target);

            const unitPrice = mineralUnitPrice(m) ?? 0;

            targetedM3 += used * UNIT_M3_PER_MINERAL;
            surplusM3 += extra * UNIT_M3_PER_MINERAL;
            allM3 += (used + extra) * UNIT_M3_PER_MINERAL;

            targetedVal += used * unitPrice;
            surplusVal += extra * unitPrice;
            allVal += (used + extra) * unitPrice;
        }

        return {
            oresM3,
            targetedM3,
            surplusM3,
            allM3,
            oresCost: totalsForList.cost ?? 0,
            targetedVal,
            surplusVal,
            allVal,
        };
    }, [plan, totalsForList, targets, mineralPriceById]);

    const TriStateCheckbox: React.FC<{
        checked: boolean;
        indeterminate: boolean;
        onChange: (nextChecked: boolean) => void;
    }> = ({ checked, indeterminate, onChange }) => {
        const ref = React.useRef<HTMLInputElement>(null);
        React.useEffect(() => {
            if (ref.current) ref.current.indeterminate = indeterminate;
        }, [indeterminate]);
        return (
            <input
                ref={ref}
                type="checkbox"
                className="h-3 w-3 rounded-[2px] border border-[#303236] bg-[#05070b] checked:bg-[#53b6ff] checked:border-[#53b6ff] focus:outline-none focus:ring-0"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
            />
        );
    };

    useEffect(() => {
        const html = document.documentElement;
        const prev = html.style.colorScheme;
        html.style.colorScheme = "dark";
        return () => {
            html.style.colorScheme = prev;
        };
    }, []);

    const hasRows = (plan?.rows?.length ?? 0) > 0;
    const rows: any[] = plan?.rows ?? [];

    return (
        <div
            className="tt-tool-v2 min-h-screen text-slate-100 text-[11px] leading-snug"
            style={{ colorScheme: "dark" }}
        >
            <div className="tt2-frame tt2-frame--centered">
                { }
                <div className="tt2-window">
                    { }
                    <div className="tt2-titlebar">
                        <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
                            <span className="uppercase tracking-widest text-[10px] text-slate-300">
                                Science &amp; Industry ▸ Compressed Ore Reprocessing Planner
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-[9px] text-slate-400">
                            <span className="px-1 py-0.5 bg-[#0b0d11] border border-[#303236]">
                                Industry
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
                                Overview ▸ Ore Planning
                            </span>
                            <span className="flex items-center gap-1">
                                <span className="h-2 w-2 rounded-full bg-[#3bbf5a]" />
                                <span>Market prices online</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-2" />
                    </div>

                    { }
                    <div className="px-4 py-4 space-y-4">
                        { }
                        <div className="border border-[#262933] bg-[#05070b]/90 px-3 py-2 text-[11px] text-slate-300">
                            <p>
                                Plan compressed ore purchases to meet specific mineral targets using your
                                refine rate and preferred strategy. Choose allowed ores on the right,
                                set your effective refine rate or build it from skills/structure, then
                                calculate a shopping list based on cost, hauling volume, or a blend of
                                both.
                            </p>
                            {authChecked && !authUser && (
                                <div className="mt-2 flex flex-wrap items-center gap-2 border border-[#27435a] bg-[#07111a] px-2 py-1.5 text-[10px] text-[#9bdcff]">
                                    <span className="uppercase tracking-widest">
                                        Sign in to remember refine defaults and allowed ores across devices.
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
                        </div>

                        { }
                        <div className="grid gap-3 md:grid-cols-3 md:auto-rows-[minmax(0,1fr)]">
                            { }
                            <section className="border border-[#2c2f36] bg-[#070910] flex flex-col">
                                <div className="flex items-center justify-between px-3 py-1.5 bg-[#101219] border-b border-[#2c2f36]">
                                    <span className="uppercase tracking-[0.16em] text-[10px] text-slate-300">
                                        Mineral Needs
                                    </span>
                                    <div className="flex gap-1 text-[10px]">
                                        <button
                                            className={`px-2 py-0.5 border ${needsMode === "form"
                                                    ? "border-[#53b6ff] bg-[#0b111a] text-slate-100"
                                                    : "border-[#303236] bg-[#05070b] text-slate-300"
                                                }`}
                                            onClick={() => setNeedsMode("form")}
                                        >
                                            Form
                                        </button>
                                        <button
                                            className={`px-2 py-0.5 border ${needsMode === "paste"
                                                    ? "border-[#53b6ff] bg-[#0b111a] text-slate-100"
                                                    : "border-[#303236] bg-[#05070b] text-slate-300"
                                                }`}
                                            onClick={() => setNeedsMode("paste")}
                                        >
                                            Paste
                                        </button>
                                    </div>
                                </div>
                                <div className="p-3 space-y-2">
                                    {needsMode === "form" ? (
                                        <div className="grid grid-cols-2 gap-2">
                                            {MINERALS.map((m) => (
                                                <label key={m} className="flex flex-col gap-1">
                                                    <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                                        {m}
                                                    </span>
                                                    <input
                                                        inputMode="numeric"
                                                        pattern="[0-9]*"
                                                        className={FIELD}
                                                        placeholder="0"
                                                        value={(targets[m] || 0).toString()}
                                                        onChange={(e) => onChangeTarget(m, e.target.value)}
                                                    />
                                                </label>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <textarea
                                                className="w-full min-h-[8rem] bg-[#05070b] border border-[#303236] px-2 py-1.5 text-[11px] rounded-[2px] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-[#53b6ff]"
                                                placeholder={`100,000 Tritanium\n100000 Pyerite\nMexallon 100,000\nIsogen 100000\nNocxium x100000`}
                                                value={needsPaste}
                                                onChange={(e) => setNeedsPaste(e.target.value)}
                                            />
                                            <div className="flex gap-2">
                                                <button
                                                    className="px-3 py-1 bg-[#1b75bc] hover:bg-[#238ad9] text-[11px] border border-[#2f6fa3] rounded-[2px]"
                                                    onClick={applyParsedNeeds}
                                                >
                                                    Parse &amp; Apply
                                                </button>
                                                <button
                                                    className="px-3 py-1 bg-[#05070b] border border-[#303236] hover:bg-[#0b0f18] rounded-[2px]"
                                                    onClick={() => setNeedsPaste("")}
                                                >
                                                    Clear
                                                </button>
                                            </div>
                                            <p className="text-[10px] text-slate-400">
                                                Tip: one mineral per line. Accepts &quot;100000 Tritanium&quot;,
                                                &quot;Tritanium x100000&quot;; commas and periods are ignored.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </section>

                            { }
                            <section className="border border-[#2c2f36] bg-[#070910] flex flex-col md:row-span-2">
                                <div className="flex items-center justify-between px-3 py-1.5 bg-[#101219] border-b border-[#2c2f36]">
                                    <span className="uppercase tracking-[0.16em] text-[10px] text-slate-300">
                                        Refine Rate
                                    </span>
                                </div>
                                <div className="p-3 space-y-3">
                                    <label className="flex flex-col gap-1">
                                        <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                            Effective rate
                                        </span>
                                        <input
                                            className={FIELD}
                                            placeholder="e.g. 89.6 or 0.896"
                                            value={rateInput}
                                            onChange={(e) => setRateInput(e.target.value)}
                                            disabled={useRateBuilder}
                                        />
                                    </label>
                                    <p className="text-[10px] text-slate-400">
                                        Values &gt; 1 are treated as percentages (&quot;89.6&quot; → 0.896).
                                    </p>

                                    <div className="flex items-center justify-between pt-1 border-t border-[#262933] mt-2">
                                        <span className="text-[10px] uppercase tracking-wide text-slate-300">
                                            Skills / structure builder
                                        </span>
                                        <label className="flex items-center gap-1">
                                            <input
                                                type="checkbox"
                                                checked={useRateBuilder}
                                                onChange={(e) => setUseRateBuilder(e.target.checked)}
                                                className="h-3 w-3 rounded-[2px] border border-[#303236] bg-[#05070b]"
                                            />
                                            <span className="text-[10px] text-slate-300">Use builder</span>
                                        </label>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <label className="flex flex-col gap-1">
                                            <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                                Rig
                                            </span>
                                            <select
                                                className={FIELD_SELECT}
                                                value={rigBonus}
                                                onChange={(e) => setRigBonus(parseFloat(e.target.value))}
                                                disabled={!useRateBuilder}
                                            >
                                                {RIGS.map((r) => (
                                                    <option key={r.label} value={r.value}>
                                                        {r.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className="flex flex-col gap-1">
                                            <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                                Implant
                                            </span>
                                            <select
                                                className={FIELD_SELECT}
                                                value={implBonus}
                                                onChange={(e) => setImplBonus(parseFloat(e.target.value))}
                                                disabled={!useRateBuilder}
                                            >
                                                {IMPLANTS.map((r) => (
                                                    <option key={r.label} value={r.value}>
                                                        {r.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className="flex flex-col gap-1">
                                            <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                                System security
                                            </span>
                                            <select
                                                className={FIELD_SELECT}
                                                value={secBonus}
                                                onChange={(e) => setSecBonus(parseFloat(e.target.value))}
                                                disabled={!useRateBuilder}
                                            >
                                                {SECURITIES.map((r) => (
                                                    <option key={r.label} value={r.value}>
                                                        {r.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className="flex flex-col gap-1">
                                            <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                                Structure
                                            </span>
                                            <select
                                                className={FIELD_SELECT}
                                                value={structBonus}
                                                onChange={(e) => setStructBonus(parseFloat(e.target.value))}
                                                disabled={!useRateBuilder}
                                            >
                                                {STRUCTURES.map((r) => (
                                                    <option key={r.label} value={r.value}>
                                                        {r.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>
                                    <div className="pt-2 mt-2 border-t border-[#262933] space-y-2">
                                        <span className="text-[10px] uppercase tracking-wide text-slate-300">
                                            Skills
                                        </span>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <label className="flex flex-col gap-1">
                                                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                                    Reprocessing
                                                </span>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={5}
                                                    step={1}
                                                    className={FIELD}
                                                    value={reproc}
                                                    onChange={(e) =>
                                                        setReproc(Math.max(0, Math.min(5, Number(e.target.value))))
                                                    }
                                                    disabled={!useRateBuilder}
                                                />
                                            </label>

                                            <label className="flex flex-col gap-1">
                                                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                                    Reprocessing Efficiency
                                                </span>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={5}
                                                    step={1}
                                                    className={FIELD}
                                                    value={reprocEff}
                                                    onChange={(e) =>
                                                        setReprocEff(Math.max(0, Math.min(5, Number(e.target.value))))
                                                    }
                                                    disabled={!useRateBuilder}
                                                />
                                            </label>

                                            <label className="flex flex-col gap-1">
                                                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                                    Specialized Ore Processing
                                                </span>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={5}
                                                    step={1}
                                                    className={FIELD}
                                                    value={specOre}
                                                    onChange={(e) =>
                                                        setSpecOre(Math.max(0, Math.min(5, Number(e.target.value))))
                                                    }
                                                    disabled={!useRateBuilder}
                                                />
                                            </label>
                                        </div>
                                    </div>
                                    <div className="border border-[#262933] bg-[#05070b]/80 px-2 py-2 space-y-1">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] text-slate-300">Calculated rate</span>
                                            <span className="font-medium tabular-nums text-[11px]">
                                                {(effectiveRate * 100).toFixed(4)}%
                                            </span>
                                        </div>
                                        <div className="text-[10px] text-slate-400 leading-snug">
                                            Formula: (Base 50% + Rig) × (1+0.03·Reproc) × (1+0.02·Eff) ×
                                            (1+0.02·Spec) × (1+Implant) × (1+Security if rig) × (1+Structure)
                                        </div>
                                    </div>
                                </div>
                            </section>

                            { }
                            <section className="border border-[#2c2f36] bg-[#070910] flex flex-col md:row-span-2">
                                <div className="flex items-center justify-between px-3 py-1.5 bg-[#101219] border-b border-[#2c2f36]">
                                    <span className="uppercase tracking-[0.16em] text-[10px] text-slate-300">
                                        Allowed Ores
                                    </span>
                                    <div className="flex gap-1 text-[10px]">
                                        <button
                                            className="px-2 py-0.5 border border-[#303236] bg-[#05070b] hover:bg-[#0b0f18]"
                                            onClick={() => setAllAllowed(true)}
                                        >
                                            Select all
                                        </button>
                                        <button
                                            className="px-2 py-0.5 border border-[#303236] bg-[#05070b] hover:bg-[#0b0f18]"
                                            onClick={() => setAllAllowed(false)}
                                        >
                                            Deselect all
                                        </button>
                                    </div>
                                </div>
                                <div className="p-3 space-y-2 flex-1 min-h-0">
                                    <button
                                        className="px-2 py-1 text-[10px] border border-amber-400/40 bg-amber-500/10 hover:bg-amber-500/20"
                                        onClick={ignoreLowVolumeTritSources}
                                    >
                                        Ignore low-market-volume (Spod/Bezd/Rako/Talas)
                                    </button>
                                    <div className="mt-2 pr-1 space-y-4 overflow-auto">
                                        {Object.entries(ORE_CATEGORIES).map(([category, names]) => {
                                            const list = names.filter((n) => oreNames.includes(n));
                                            if (list.length === 0) return null;

                                            const selectedCount = list.filter((n) => allowed.has(n)).length;
                                            const all = selectedCount === list.length;
                                            const some = selectedCount > 0 && !all;

                                            const toggleCategory = (nextChecked: boolean) => {
                                                setAllowed((prev) => {
                                                    const next = new Set(prev);
                                                    for (const n of list) {
                                                        if (nextChecked) next.add(n);
                                                        else next.delete(n);
                                                    }
                                                    return next;
                                                });
                                            };

                                            return (
                                                <div key={category}>
                                                    <div className="flex items-center justify-between pb-1 mb-2 border-b border-[#262933]">
                                                        <label className="flex items-center gap-2">
                                                            <TriStateCheckbox
                                                                checked={all}
                                                                indeterminate={some}
                                                                onChange={toggleCategory}
                                                            />
                                                            <span className="text-[11px] text-slate-200">{category}</span>
                                                        </label>
                                                        <span className="text-[10px] text-slate-400">
                                                            {selectedCount}/{list.length}
                                                        </span>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-1">
                                                        {list.map((name) => (
                                                            <label
                                                                key={name}
                                                                className="flex items-center gap-2 text-[11px] text-slate-200"
                                                            >
                                                                <input
                                                                    type="checkbox"
                                                                    className="h-3 w-3 rounded-[2px] border border-[#303236] bg-[#05070b]"
                                                                    checked={allowed.has(name)}
                                                                    onChange={() => toggleOre(name)}
                                                                />
                                                                <span>{name}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </section>

                            { }
                            <section className="border border-[#2c2f36] bg-[#070910] flex flex-col">
                                <div className="flex items-center justify-between px-3 py-1.5 bg-[#101219] border-b border-[#2c2f36]">
                                    <span className="uppercase tracking-[0.16em] text-[10px] text-slate-300">
                                        Strategy
                                    </span>
                                </div>
                                <div className="p-3 space-y-3">
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            onClick={() => setStrategy("min_cost")}
                                            className={`px-3 py-1 text-[11px] border ${strategy === "min_cost"
                                                    ? "border-[#53b6ff] bg-[#0b111a] text-slate-100"
                                                    : "border-[#303236] bg-[#05070b] text-slate-300"
                                                }`}
                                        >
                                            Prioritize Cost
                                        </button>
                                        <button
                                            onClick={() => setStrategy("min_haul")}
                                            className={`px-3 py-1 text-[11px] border ${strategy === "min_haul"
                                                    ? "border-[#53b6ff] bg-[#0b111a] text-slate-100"
                                                    : "border-[#303236] bg-[#05070b] text-slate-300"
                                                }`}
                                        >
                                            Prioritize Hauling
                                        </button>
                                        <button
                                            onClick={() => setStrategy("blend")}
                                            className={`px-3 py-1 text-[11px] border ${strategy === "blend"
                                                    ? "border-[#53b6ff] bg-[#0b111a] text-slate-100"
                                                    : "border-[#303236] bg-[#05070b] text-slate-300"
                                                }`}
                                        >
                                            Blend
                                        </button>
                                    </div>

                                    {strategy === "min_haul" && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                                Haul by
                                            </span>
                                            <select
                                                value={haulMode}
                                                onChange={(e) => setHaulMode(e.target.value as any)}
                                                className={FIELD_SELECT}
                                            >
                                                <option value="m3">m³ (recommended)</option>
                                                <option value="batches">batches</option>
                                            </select>
                                        </div>
                                    )}

                                    {(strategy === "min_cost" || strategy === "blend") && (
                                        <>
                                            <div className="flex flex-col gap-1">
                                                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                                    Trade Hub
                                                </span>
                                                <select
                                                    value={stationId}
                                                    onChange={(e) => setStationId(parseInt(e.target.value, 10))}
                                                    className={FIELD_SELECT}
                                                >
                                                    {HUBS.map((h) => (
                                                        <option key={h.id} value={h.id}>
                                                            {h.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                                    Price Field
                                                </span>
                                                <select
                                                    value={priceField}
                                                    onChange={(e) => setPriceField(e.target.value)}
                                                    className={FIELD_SELECT}
                                                >
                                                    <option value="sell_5pct">sell_5pct (default)</option>
                                                    <option value="sell_min">sell_min</option>
                                                    <option value="avg_price">avg_price</option>
                                                    <option value="buy_max">buy_max</option>
                                                </select>
                                            </div>
                                            {strategy === "blend" && (
                                                <div className="space-y-1">
                                                    <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                                        Blend weight (cost ⇄ m³)
                                                    </span>
                                                    <input
                                                        type="range"
                                                        min={0}
                                                        max={1}
                                                        step={0.05}
                                                        value={blendWeight}
                                                        onChange={(e) => setBlendWeight(parseFloat(e.target.value))}
                                                        className="w-full"
                                                    />
                                                    <div className="text-[10px] text-slate-400">
                                                        {blendWeight.toFixed(2)} — 1.00 = all cost, 0.00 = all m³
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </section>
                        </div>

                        { }
                        <div className="flex items-center justify-between pt-2">
                            {err && (
                                <div className="text-[11px] text-[#ff6b6b] max-w-sm">
                                    Error: <span className="text-slate-100">{err}</span>
                                </div>
                            )}
                            <div className="ml-auto">
                                <button
                                    onClick={onCalculate}
                                    className="px-6 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] bg-gradient-to-b from-[#1b75bc] via-[#1c88d9] to-[#0f5b9c] border border-[#285b82] hover:from-[#27a0df] hover:to-[#1672a4] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-150"
                                >
                                    Calculate
                                </button>
                            </div>
                        </div>

                        { }
                        {hasRows && (
                            <div className="space-y-3 pt-2">
                                <div className="grid gap-3 md:grid-cols-3 md:auto-rows-[minmax(0,1fr)]">
                                    { }
                                    <section className="border border-[#303236] bg-[#05070b]/95 md:col-span-2 flex flex-col">
                                        <div className="flex items-center justify-between px-3 py-1.5 bg-[#101219] border-b border-[#2b2d36]">
                                            <span className="uppercase tracking-[0.16em] text-[10px] text-slate-300">
                                                Shopping List
                                            </span>
                                            <div className="flex items-center gap-2 text-[10px]">
                                                {copied && (
                                                    <span className="text-[#3bbf5a]">Copied to clipboard</span>
                                                )}
                                                <button
                                                    onClick={copyShoppingList}
                                                    className="px-3 py-1 border border-[#303236] bg-[#05070b] hover:bg-[#0b0f18] text-[11px]"
                                                    disabled={!rows.length}
                                                    title="Copy: units<TAB>Compressed Ore"
                                                >
                                                    Copy list
                                                </button>
                                            </div>
                                        </div>
                                        <div className="p-3 pt-2 overflow-x-auto">
                                            {!rows.length ? (
                                                <p className="text-[11px] text-slate-400">
                                                    No solution with current settings.
                                                </p>
                                            ) : (
                                                <table className="table-auto w-full text-[11px]">
                                                    <thead>
                                                        <tr className="bg-[#14161d] text-slate-100">
                                                            <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                                                                Ore
                                                            </th>
                                                            <InfoHead
                                                                id="batches"
                                                                tip="Number of 100-unit compressed batches to purchase."
                                                            >
                                                                Batches (×100)
                                                            </InfoHead>
                                                            <InfoHead
                                                                id="m3"
                                                                tip="Total m³ volume of the compressed ore batches."
                                                                className="text-right"
                                                            >
                                                                <span className="ml-auto block text-right">m³</span>
                                                            </InfoHead>
                                                            <InfoHead
                                                                id="cost"
                                                                tip="Estimated ISK cost of buying the ore using the selected price field."
                                                                className="text-right"
                                                            >
                                                                <span className="ml-auto block text-right">Cost</span>
                                                            </InfoHead>
                                                            <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                                                                Product
                                                            </th>
                                                            <InfoHead
                                                                id="reprocess"
                                                                tip="Estimated ISK value of minerals after refining at your effective rate."
                                                                className="text-right"
                                                            >
                                                                <span className="ml-auto block text-right">
                                                                    Reprocessed Value
                                                                </span>
                                                            </InfoHead>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {rows.map((row, idx) => {
                                                            const batches = Number(row.batches) || 0;
                                                            const rowm3 = rowM3(row.name, batches);
                                                            const cost = rowCost(row.name, batches);
                                                            const value = rowReprocessedValue(row);
                                                            const oreTypeId = oreMetaByName.get(row.name)?.typeId ?? null;
                                                            return (
                                                                <tr
                                                                    key={row.name}
                                                                    className={
                                                                        idx % 2 === 0
                                                                            ? "bg-[#090b11] hover:bg-[#141821]"
                                                                            : "bg-[#0c0f16] hover:bg-[#141821]"
                                                                    }
                                                                >
                                                                    <td className="border border-[#262933] px-2.5 py-1.5">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="min-w-0 flex-1 truncate">{row.name}</span>
                                                                            <ItemInfoLink
                                                                                typeId={oreTypeId}
                                                                                label={`Compressed ${row.name}`}
                                                                                className="ml-auto"
                                                                            />
                                                                        </div>
                                                                    </td>
                                                                    <td className="border border-[#262933] px-2.5 py-1.5 text-right tabular-nums">
                                                                        {formatInt(batches)}
                                                                    </td>
                                                                    <td className="border border-[#262933] px-2.5 py-1.5 text-right tabular-nums">
                                                                        {formatM3(rowm3)}
                                                                    </td>
                                                                    <td className="border border-[#262933] px-2.5 py-1.5 text-right tabular-nums">
                                                                        {formatISK(cost)}
                                                                    </td>
                                                                    <td className="border border-[#262933] px-2.5 py-1.5">
                                                                        {MINERALS.map((m) => {
                                                                            const qty = Number(row.yields?.[m] || 0);
                                                                            if (!qty) return null;
                                                                            return (
                                                                                <span
                                                                                    key={m}
                                                                                    className="inline-block mr-3 text-slate-200"
                                                                                >
                                                                                    {m}:{" "}
                                                                                    <span className="tabular-nums">
                                                                                        {qty.toLocaleString()}
                                                                                    </span>
                                                                                </span>
                                                                            );
                                                                        })}
                                                                    </td>
                                                                    <td className="border border-[#262933] px-2.5 py-1.5 text-right tabular-nums">
                                                                        {formatISK(value)}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}

                                                        { }
                                                        <tr className="bg-[#101219] font-semibold">
                                                            <td className="border border-[#262933] px-2.5 py-1.5">
                                                                Totals
                                                            </td>
                                                            <td className="border border-[#262933] px-2.5 py-1.5 text-right tabular-nums">
                                                                {formatInt(totalsForList.batches)}
                                                            </td>
                                                            <td className="border border-[#262933] px-2.5 py-1.5 text-right tabular-nums">
                                                                {formatM3(totalsForList.m3)}
                                                            </td>
                                                            <td className="border border-[#262933] px-2.5 py-1.5 text-right tabular-nums">
                                                                {formatISK(totalsForList.cost)}
                                                            </td>
                                                            <td className="border border-[#262933] px-2.5 py-1.5" />
                                                            <td className="border border-[#262933] px-2.5 py-1.5 text-right tabular-nums">
                                                                {formatISK(totalsForList.value)}
                                                            </td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            )}
                                        </div>
                                    </section>

                                    { }
                                    <section className="border border-[#303236] bg-[#070910] flex flex-col">
                                        <div className="px-3 py-1.5 bg-[#101219] border-b border-[#2c2f36]">
                                            <span className="uppercase tracking-[0.16em] text-[10px] text-slate-300">
                                                Totals vs Targets
                                            </span>
                                        </div>
                                        <div className="p-3 grid grid-cols-2 gap-2">
                                            {MINERALS.map((m) => {
                                                const totalEntry = plan?.totals?.[m];
                                                const produced = totalEntry
                                                    ? Number(totalEntry.produced) || 0
                                                    : producedMinerals[m] || 0;
                                                const target = totalEntry
                                                    ? Number(totalEntry.target) || Number(targets[m] || 0)
                                                    : Number(targets[m] || 0);
                                                const diff = produced - target;
                                                return (
                                                    <div
                                                        key={m}
                                                        className="border border-[#303236] bg-[#05070b] px-2 py-1.5 space-y-0.5"
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[10px] uppercase tracking-wide text-slate-300">
                                                                {m}
                                                            </span>
                                                            <ItemInfoLink typeId={MINERAL_TYPE_IDS[m]} label={m} />
                                                        </div>
                                                        <div className="flex justify-between text-[11px] tabular-nums">
                                                            <span className="text-slate-400">Target</span>
                                                            <span>{target.toLocaleString()}</span>
                                                        </div>
                                                        <div className="flex justify-between text-[11px] tabular-nums">
                                                            <span className="text-slate-400">Produced</span>
                                                            <span>{produced.toLocaleString()}</span>
                                                        </div>
                                                        <div className="flex justify-between text-[11px] tabular-nums">
                                                            <span className="text-slate-400">Surplus</span>
                                                            <span
                                                                className={
                                                                    diff >= 0 ? "text-[#9be07b]" : "text-[#ff6b6b]"
                                                                }
                                                            >
                                                                {diff.toLocaleString()}
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div className="px-3 pb-2 text-[10px] text-slate-400">
                                            Total product volume:{" "}
                                            <span className="tabular-nums">
                                                {productTotalM3.toLocaleString(undefined, {
                                                    maximumFractionDigits: 2,
                                                })}
                                            </span>{" "}
                                            m³
                                        </div>
                                    </section>
                                </div>

                                { }
                                <section className="border border-[#303236] bg-[#070910]">
                                    <div className="px-3 py-1.5 bg-[#101219] border-b border-[#2c2f36]">
                                        <span className="uppercase tracking-[0.16em] text-[10px] text-slate-300">
                                            Summary (Volumes &amp; Values)
                                        </span>
                                    </div>
                                    <div className="p-3 grid gap-4 md:grid-cols-2 text-[11px]">
                                        <div className="space-y-1">
                                            <div className="font-semibold text-slate-200">Volumes</div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-400">
                                                    Total m³ of ores (shopping list)
                                                </span>
                                                <span className="tabular-nums">
                                                    {bottomSummary.oresM3.toLocaleString(undefined, {
                                                        maximumFractionDigits: 2,
                                                    })}{" "}
                                                    m³
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-400">
                                                    Total m³ of targeted minerals
                                                </span>
                                                <span className="tabular-nums">
                                                    {bottomSummary.targetedM3.toLocaleString(undefined, {
                                                        maximumFractionDigits: 2,
                                                    })}{" "}
                                                    m³
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-400">
                                                    Total m³ of surplus minerals
                                                </span>
                                                <span className="tabular-nums">
                                                    {bottomSummary.surplusM3.toLocaleString(undefined, {
                                                        maximumFractionDigits: 2,
                                                    })}{" "}
                                                    m³
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-400">Total m³ of all minerals</span>
                                                <span className="tabular-nums">
                                                    {bottomSummary.allM3.toLocaleString(undefined, {
                                                        maximumFractionDigits: 2,
                                                    })}{" "}
                                                    m³
                                                </span>
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <div className="font-semibold text-slate-200">ISK</div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-400">Total ISK cost of ores</span>
                                                <span className="tabular-nums">
                                                    {formatISK(bottomSummary.oresCost)}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-400">
                                                    Total ISK value of targeted minerals
                                                </span>
                                                <span className="tabular-nums">
                                                    {formatISK(bottomSummary.targetedVal)}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-400">
                                                    Total ISK value of surplus minerals
                                                </span>
                                                <span className="tabular-nums">
                                                    {formatISK(bottomSummary.surplusVal)}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-slate-400">
                                                    Total ISK value of all minerals
                                                </span>
                                                <span className="tabular-nums">
                                                    {formatISK(bottomSummary.allVal)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="px-3 pb-2 text-[10px] text-slate-500">
                                        Note: &quot;targeted&quot; counts up to your target per mineral;
                                        &quot;surplus&quot; is anything produced above the target. Mineral
                                        volumes use 0.01 m³ per unit.
                                    </div>
                                </section>
                            </div>
                        )}

                        {!hasRows && !err && (
                            <div className="pt-2 text-[10px] text-slate-500">
                                Set your mineral needs and strategy, then click{" "}
                                <span className="text-[#53b6ff]">Calculate</span> to generate a shopping
                                list.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
