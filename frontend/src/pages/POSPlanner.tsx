/*
 * React page for /POSPlanner.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Pencil, Save, Trash2, X } from "lucide-react";
import {
    requestSiteAuthModal,
    SITE_AUTH_CHANGED_EVENT,
    type SiteAuthChangeDetail,
} from "../auth/siteAuthEvents";
import type { AuthUser } from "../components/fitting/types";

type Tower = {
    type_id: number;

    name?: string;
    type_name?: string;
};

type ModuleGroup = {

    group_id?: number;
    group_name?: string;
    marketgroup_id?: number;
    marketgroup_name?: string;
};

type ModuleItem = {
    type_id: number;

    name?: string;
    type_name?: string;
    group_id?: number;
    group_name?: string;
    marketgroup_id?: number;
    marketgroup_name?: string;
    volume_m3?: number;
    powergrid_mw?: number;
    cpu_tf?: number;
    pg_mw?: number;
    cpu_tf_raw?: number;
    shield_bonus?: { em: number; exp: number; kin: number; therm: number };
};

type FitLine = { type_id: number; qty: number };

type CalcResponse = {
    tower: {
        type_id: number;
        pg_out_mw: number;
        cpu_out_tf: number;
        hp: { shield: number; armor: number; hull: number };
        shield_resists: {
            base: { em: number; exp: number; kin: number; therm: number };
            final: { em: number; exp: number; kin: number; therm: number };
        };
        ehp: { shield: number; total: number };
    };
    fitting: { pg_used_mw: number; cpu_used_tf: number; pg_pct: number; cpu_pct: number };
};

type PlanLine = {
    type_id: number;
    name: string;
    group_name: string;
    qty: number;
    unit_price: number | null;
    line_isk: number;
    volume_m3: number;
    powergrid_mw: number;
    cpu_tf: number;
};

type PlanResponse = {
    tower: {
        type_id: number;
        name: string;
        unit_price: number | null;
        cost_isk: number;
        fuel_blocks_per_hour: number;
        fuel_blocks: number;
    };
    fuel?: {
        type_id: number | null;
        name: string | null;
        unit_price: number | null;
        cost_isk: number | null;
    };
    lines: PlanLine[];
    totals: {
        tower_cost_isk: number;
        modules_cost_isk: number;
        fuel_cost_isk: number;
        total_cost_isk: number;
        deployment_m3: number;
    };
};

type SavedToolSetup = {
    id: string;
    setupName: string;
    setupJson?: unknown;
    summaryJson?: {
        towerName?: string;
        moduleCount?: number;
        hours?: number;
    };
    updatedAt?: string;
};

type SaveDialogMode = "create" | "update" | "rename";

type PosSetupSnapshot = {
    version: 1;
    towerTypeId: number | null;
    hours: number;
    fit: FitLine[];
};

const POS_SETUP_TOOL_KEY = "pos-planner";

function safeNum(v: any, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
    const next = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
    return Math.min(max, Math.max(min, next));
}

function fmtNum(v: any, decimals = 0) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtInt(v: any) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return Math.round(n).toLocaleString();
}

function fmtISK(v: any) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function normalizeFit(raw: unknown): FitLine[] {
    const source = Array.isArray(raw) ? raw : [];
    const byTypeId = new Map<number, number>();
    for (const line of source) {
        if (!line || typeof line !== "object") continue;
        const rawTypeId = Number((line as Partial<FitLine>).type_id);
        if (!Number.isFinite(rawTypeId) || rawTypeId <= 0) continue;
        const typeId = Math.trunc(rawTypeId);
        const qty = clampInt((line as Partial<FitLine>).qty, 1, 100000, 1);
        byTypeId.set(typeId, (byTypeId.get(typeId) || 0) + qty);
    }
    return Array.from(byTypeId.entries()).map(([type_id, qty]) => ({
        type_id,
        qty: Math.min(100000, qty),
    }));
}

function snapshotFromSetupJson(setupJson: unknown): PosSetupSnapshot {
    const source = setupJson && typeof setupJson === "object" ? setupJson as Partial<PosSetupSnapshot> : {};
    const rawTowerTypeId = Number(source.towerTypeId);
    const towerTypeId = Number.isFinite(rawTowerTypeId) && rawTowerTypeId > 0 ? Math.trunc(rawTowerTypeId) : null;
    return {
        version: 1,
        towerTypeId,
        hours: clampInt(source.hours, 1, 24 * 365, 168),
        fit: normalizeFit(source.fit),
    };
}

function defaultDesignName(tower: Tower | null) {
    return tower?.name ?? tower?.type_name ?? "POS Design";
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

export default function POSPlanner() {
    const [loading, setLoading] = useState(true);

    const [towers, setTowers] = useState<Tower[]>([]);
    const [towerTypeId, setTowerTypeId] = useState<number | null>(null);

    const [groups, setGroups] = useState<ModuleGroup[]>([]);
    const [groupId, setGroupId] = useState<number | null>(null);

    const [groupModules, setGroupModules] = useState<ModuleItem[]>([]);
    const [modulePick, setModulePick] = useState<number | null>(null);

    const [fit, setFit] = useState<FitLine[]>([]);

    const [hours, setHours] = useState(168);
    const usageColor = (pct: number | null | undefined) => {
        const p = Number(pct ?? 0);
        if (!Number.isFinite(p)) return "bg-emerald-500";
        if (p < 50) return "bg-emerald-500";
        if (p < 90) return "bg-yellow-400";
        if (p <= 100) return "bg-orange-500";
        return "bg-red-500";
    };

    const [calc, setCalc] = useState<CalcResponse | null>(null);
    const [plan, setPlan] = useState<PlanResponse | null>(null);
    const [authUser, setAuthUser] = useState<AuthUser | null>(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [savedDesigns, setSavedDesigns] = useState<SavedToolSetup[]>([]);
    const [savedDesignsLoading, setSavedDesignsLoading] = useState(false);
    const [selectedDesignId, setSelectedDesignId] = useState("");
    const [setupBusy, setSetupBusy] = useState<"load" | "save" | "rename" | "delete" | null>(null);
    const [setupError, setSetupError] = useState<string | null>(null);
    const [saveDialogMode, setSaveDialogMode] = useState<SaveDialogMode | null>(null);
    const [saveName, setSaveName] = useState("");

    const tower = useMemo(() => towers.find((t) => t.type_id === towerTypeId) ?? null, [towers, towerTypeId]);
    const selectedDesign = savedDesigns.find((design) => design.id === selectedDesignId) || null;

    const nameByTypeId = useMemo(() => {
        const m = new Map<number, { name: string; group?: string; pg?: number; cpu?: number }>();
        if (plan?.lines?.length) {
            for (const l of plan.lines) {
                m.set(l.type_id, { name: l.name, group: l.group_name, pg: l.powergrid_mw, cpu: l.cpu_tf });
            }
        }
        return m;
    }, [plan]);

    const fuelBlocksPerHour = safeNum(plan?.tower?.fuel_blocks_per_hour ?? 0);
    const fuelBlocksTotal = safeNum(plan?.tower?.fuel_blocks ?? 0);

    const fuelCostISK = plan?.totals?.fuel_cost_isk ?? (plan as any)?.fuel?.cost_isk ?? null;

    const towerCostISK = safeNum(plan?.tower?.cost_isk ?? plan?.totals?.tower_cost_isk ?? 0);
    const modulesCostISK = safeNum(
        plan?.lines?.reduce((acc, l) => acc + safeNum(l?.line_isk), 0) ?? plan?.totals?.modules_cost_isk ?? 0
    );
    const totalCostWithFuel = towerCostISK + modulesCostISK + safeNum(fuelCostISK ?? 0);

    const shieldHP = calc?.tower?.hp?.shield ?? 0;
    const armorHP = calc?.tower?.hp?.armor ?? 0;
    const hullHP = calc?.tower?.hp?.hull ?? 0;

    const shieldEHP = useMemo(() => {
        const fromBackend = calc?.tower?.ehp?.shield;
        if (typeof fromBackend === "number" && Number.isFinite(fromBackend)) return fromBackend;

        const r = calc?.tower?.shield_resists?.final ?? { em: 0, therm: 0, kin: 0, exp: 0 };
        const avgShieldTaken =
            (1 - safeNum(r.em) / 100) * 0.25 +
            (1 - safeNum(r.therm) / 100) * 0.25 +
            (1 - safeNum(r.kin) / 100) * 0.25 +
            (1 - safeNum(r.exp) / 100) * 0.25;

        return avgShieldTaken > 0 ? shieldHP / avgShieldTaken : 0;
    }, [calc, shieldHP]);

    const totalEHP = useMemo(() => {
        const fromBackend = calc?.tower?.ehp?.total;
        if (typeof fromBackend === "number" && Number.isFinite(fromBackend)) return fromBackend;
        return shieldEHP + armorHP + hullHP;
    }, [calc, shieldEHP, armorHP, hullHP]);

    const fitExpanded = useMemo(() => {
        const byId = new Map<number, ModuleItem>();
        for (const m of groupModules) byId.set(m.type_id, m);
        return fit.map((l) => {
            const info = byId.get(l.type_id) ?? null;
            return { ...l, info };
        });
    }, [fit, groupModules]);

    const addModule = () => {
        if (!modulePick) return;
        setFit((prev) => {
            const existing = prev.find((x) => x.type_id === modulePick);
            if (existing) return prev.map((x) => (x.type_id === modulePick ? { ...x, qty: x.qty + 1 } : x));
            return [...prev, { type_id: modulePick, qty: 1 }];
        });
    };

    const removeLine = (type_id: number) => setFit((prev) => prev.filter((x) => x.type_id !== type_id));
    const updateQty = (type_id: number, qty: number) =>
        setFit((prev) => prev.map((x) => (x.type_id === type_id ? { ...x, qty } : x)));

    const copyShoppingList = async () => {
        if (!plan?.tower?.name) return;

        const lines: string[] = [];

        lines.push(`1 ${plan.tower.name}`);

        for (const l of plan.lines || []) {
            if (!l?.qty || l.qty <= 0) continue;
            lines.push(`${l.qty} ${l.name}`);
        }

        if (fuelBlocksTotal > 0) {
            const fuelName = plan?.fuel?.name || "Fuel Blocks";
            lines.push(`${fuelBlocksTotal} ${fuelName}`);
        }

        const text = lines.join("\n");

        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return;
            }

            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
        } catch (e) {
            console.error("copyShoppingList failed", e);
        }
    };

    async function refreshSavedDesigns(preferredDesignId?: string) {
        if (!authUser) return;
        setSavedDesignsLoading(true);
        try {
            const response = await fetch(`/api/tool-setups/${POS_SETUP_TOOL_KEY}`, { credentials: "include" });
            const data = await readJson<{ ok: boolean; setups: SavedToolSetup[] }>(response);
            const next = data.setups || [];
            setSavedDesigns(next);
            setSelectedDesignId((prev) => {
                const candidate = preferredDesignId || prev;
                return candidate && next.some((design) => design.id === candidate) ? candidate : "";
            });
            setSetupError(null);
        } catch (err) {
            setSavedDesigns([]);
            setSetupError((err as Error).message || "Saved designs failed to load.");
        } finally {
            setSavedDesignsLoading(false);
        }
    }

    function currentSnapshot(): PosSetupSnapshot {
        return {
            version: 1,
            towerTypeId,
            hours: clampInt(hours, 1, 24 * 365, 168),
            fit: normalizeFit(fit),
        };
    }

    function setupPayload(name: string) {
        const setupJson = currentSnapshot();
        const moduleCount = setupJson.fit.reduce((acc, line) => acc + line.qty, 0);
        return {
            setupName: name,
            setupJson,
            summaryJson: {
                towerName: defaultDesignName(tower),
                moduleCount,
                hours: setupJson.hours,
            },
        };
    }

    function openSaveDesignDialog() {
        if (!authUser) {
            requestSiteAuthModal("login");
            return;
        }
        if (!towerTypeId) {
            setSetupError("Select a tower before saving a POS design.");
            return;
        }
        setSetupError(null);
        setSaveDialogMode(selectedDesign ? "update" : "create");
        setSaveName(selectedDesign?.setupName || defaultDesignName(tower));
    }

    function openRenameDesignDialog() {
        if (!authUser) {
            requestSiteAuthModal("login");
            return;
        }
        if (!selectedDesign) return;
        setSetupError(null);
        setSaveDialogMode("rename");
        setSaveName(selectedDesign.setupName);
    }

    async function handleSaveDialogSubmit(event: React.FormEvent) {
        event.preventDefault();
        if (!authUser) {
            requestSiteAuthModal("login");
            return;
        }

        const name = saveName.trim();
        if (!name) {
            setSetupError("Design name is required.");
            return;
        }

        try {
            if (saveDialogMode === "rename") {
                if (!selectedDesign) return;
                setSetupBusy("rename");
                const response = await fetch(`/api/tool-setups/${POS_SETUP_TOOL_KEY}/${selectedDesign.id}`, {
                    method: "PATCH",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ setupName: name }),
                });
                await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
                await refreshSavedDesigns(selectedDesign.id);
            } else {
                if (!towerTypeId) {
                    setSetupError("Select a tower before saving a POS design.");
                    return;
                }
                setSetupBusy("save");
                const updating = saveDialogMode === "update" && selectedDesign;
                const response = await fetch(
                    updating
                        ? `/api/tool-setups/${POS_SETUP_TOOL_KEY}/${selectedDesign.id}`
                        : `/api/tool-setups/${POS_SETUP_TOOL_KEY}`,
                    {
                        method: updating ? "PUT" : "POST",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(setupPayload(name)),
                    }
                );
                const data = await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
                await refreshSavedDesigns(data.setup.id);
            }

            setSaveDialogMode(null);
            setSaveName("");
            setSetupError(null);
        } catch (err) {
            const message = (err as Error).message === "setup_name_exists"
                ? "A saved POS design with that name already exists."
                : (err as Error).message || "Saved POS design update failed.";
            setSetupError(message);
        } finally {
            setSetupBusy(null);
        }
    }

    async function loadSavedDesign(id: string) {
        if (!id) {
            setSelectedDesignId("");
            return;
        }
        if (!authUser) {
            requestSiteAuthModal("login");
            return;
        }

        setSetupBusy("load");
        try {
            const response = await fetch(`/api/tool-setups/${POS_SETUP_TOOL_KEY}/${id}`, { credentials: "include" });
            const data = await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
            const snapshot = snapshotFromSetupJson(data.setup.setupJson);
            if (!snapshot.towerTypeId) throw new Error("Saved design is missing a tower.");
            setTowerTypeId(snapshot.towerTypeId);
            setHours(snapshot.hours);
            setFit(snapshot.fit);
            setSelectedDesignId(id);
            setSetupError(null);
        } catch (err) {
            setSetupError((err as Error).message || "Saved design failed to load.");
        } finally {
            setSetupBusy(null);
        }
    }

    async function deleteSelectedDesign() {
        if (!authUser) {
            requestSiteAuthModal("login");
            return;
        }
        if (!selectedDesign) return;
        if (!window.confirm(`Delete saved POS design "${selectedDesign.setupName}"?`)) return;

        setSetupBusy("delete");
        try {
            const response = await fetch(`/api/tool-setups/${POS_SETUP_TOOL_KEY}/${selectedDesign.id}`, {
                method: "DELETE",
                credentials: "include",
            });
            await readJson<{ ok: boolean }>(response);
            setSelectedDesignId("");
            setSetupError(null);
            await refreshSavedDesigns();
        } catch (err) {
            setSetupError((err as Error).message || "Saved design delete failed.");
        } finally {
            setSetupBusy(null);
        }
    }

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
            setSavedDesigns([]);
            setSelectedDesignId("");
            setSetupError(null);
            return;
        }
        void refreshSavedDesigns();
    }, [authUser]);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                setLoading(true);

                const [tRes, gRes] = await Promise.all([
                    fetch("/api/pos/towers").then((r) => r.json()),
                    fetch("/api/pos/module-groups").then((r) => r.json()),
                ]);

                if (cancelled) return;

                const ts: Tower[] = Array.isArray(tRes?.towers) ? tRes.towers : Array.isArray(tRes) ? tRes : [];
                const gs: ModuleGroup[] = Array.isArray(gRes?.groups) ? gRes.groups : Array.isArray(gRes) ? gRes : [];

                setTowers(ts);
                setGroups(gs);

                if (ts.length) setTowerTypeId((prev) => (prev == null ? ts[0].type_id : prev));
                if (gs.length)
                    setGroupId((prev) =>
                        prev == null ? ((gs[0].marketgroup_id ?? gs[0].group_id) ?? null) : prev
                    );

                setLoading(false);
            } catch (e) {
                console.error(e);
                if (!cancelled) {
                    setTowers([]);
                    setGroups([]);
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                if (!groupId) {
                    setGroupModules([]);
                    setModulePick(null);
                    return;
                }

                const res = await fetch(`/api/pos/modules?group_id=${groupId}&marketgroup_id=${groupId}`);
                const data = await res.json();

                if (cancelled) return;

                const arr: ModuleItem[] = Array.isArray(data?.modules) ? data.modules : Array.isArray(data) ? data : [];
                setGroupModules(arr);
                setModulePick(arr?.[0]?.type_id ?? null);
            } catch (e) {
                console.error(e);
                if (!cancelled) {
                    setGroupModules([]);
                    setModulePick(null);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [groupId]);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                if (!towerTypeId) {
                    setCalc(null);
                    setPlan(null);
                    return;
                }

                const body = { tower_type_id: towerTypeId, modules: fit };

                const [cRes, planRes] = await Promise.all([
                    fetch("/api/pos/calc", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                    }).then((r) => r.json()),
                    fetch("/api/pos/plan", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            ...body,
                            hours,
                        }),
                    }).then((r) => r.json()),
                ]);

                if (cancelled) return;
                setCalc(cRes?.tower ? cRes : null);
                setPlan(planRes?.tower ? planRes : null);
            } catch (e) {
                console.error(e);
                if (!cancelled) {
                    setCalc(null);
                    setPlan(null);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [towerTypeId, JSON.stringify(fit), hours]);

    const selectBase =
        "w-full border border-[#303236] bg-[#05070b] px-2 py-2 text-[11px] text-slate-100 outline-none focus:border-[#4b9cff]/60 disabled:opacity-50";
    const inputBase =
        "w-full border border-[#303236] bg-[#05070b] px-2 py-2 text-[11px] text-slate-100 outline-none focus:border-[#4b9cff]/60 disabled:opacity-50";
    const readoutBase = "w-full border border-[#303236] bg-[#05070b] px-2 py-2 text-[11px] text-slate-100";
    const optionBase = "bg-[#05070b] text-slate-100";

    return (
        <div className="tt-tool-v2 min-h-screen text-slate-100 text-[11px] leading-snug">
            <div className="tt2-frame tt2-frame--centered">
                <div className="tt2-window">
                    { }
                    <div className="tt2-titlebar">
                        <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
                            <span className="uppercase tracking-widest text-[10px] text-slate-300">
                                Science &amp; Industry ▸ POS Planner
                            </span>
                        </div>

                        <div className="flex items-center gap-2 text-[9px] text-slate-400">
                            <span className="px-1 py-0.5 bg-[#0b0d11] border border-[#303236]">Jita 4-4</span>
                            <span className="px-1 py-0.5 bg-[#0b0d11] border border-[#303236]">
                                <span className="text-[#53b6ff]">Triff.Tools</span>
                            </span>
                            <span className="text-slate-500">{loading ? "loading…" : "ready"}</span>
                        </div>
                    </div>

                    { }
                    <div className="tt2-contextbar">
                        <div className="flex items-center gap-3">
                            <span className="uppercase tracking-widest text-slate-300">Overview ▸ POS Planner</span>
                            <span className="flex items-center gap-1">
                                <span className="h-2 w-2 rounded-full bg-[#3bbf5a]" />
                                <span>Market prices online</span>
                            </span>
                        </div>
                        <div className="text-slate-500" />
                    </div>

                    { }
                    <div className="p-4">
                        <div className="mb-4 border border-[#2c2f36] bg-[#070910] px-2 py-2">
                            <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                                <label className="min-w-0 flex-1">
                                    <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-400">
                                        Saved Designs
                                    </span>
                                    <select
                                        value={selectedDesignId}
                                        disabled={!authUser || savedDesignsLoading || setupBusy === "load"}
                                        onChange={(event) => void loadSavedDesign(event.target.value)}
                                        className={selectBase}
                                    >
                                        <option value="">
                                            {!authChecked
                                                ? "Checking account..."
                                                : !authUser
                                                    ? "Sign in to use saved designs"
                                                    : savedDesignsLoading
                                                        ? "Loading saved designs..."
                                                        : savedDesigns.length
                                                            ? "Select a saved design"
                                                            : "No saved designs yet"}
                                        </option>
                                        {savedDesigns.map((design) => (
                                            <option key={design.id} value={design.id} className={optionBase}>
                                                {design.setupName}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <div className="flex shrink-0 flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        disabled={!authUser || !selectedDesign || !!setupBusy}
                                        onClick={openRenameDesignDialog}
                                        className="inline-flex h-8 items-center gap-1 border border-[#303236] bg-[#05070b] px-2 text-[10px] uppercase tracking-widest text-slate-300 hover:border-[#53b6ff]/60 hover:bg-[#101219] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <Pencil size={12} />
                                        Rename
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!authUser || !selectedDesign || !!setupBusy}
                                        onClick={() => void deleteSelectedDesign()}
                                        className="inline-flex h-8 items-center gap-1 border border-[#4a2730] bg-[#10070a] px-2 text-[10px] uppercase tracking-widest text-[#ffaaaa] hover:border-[#bf3b3b] hover:bg-[#1d090b] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <Trash2 size={12} />
                                        Delete
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!!setupBusy || !towerTypeId}
                                        onClick={openSaveDesignDialog}
                                        className="inline-flex h-8 items-center gap-1.5 border border-[#46b2ff]/70 bg-gradient-to-b from-[#1b8cc8] to-[#14608a] px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-50 shadow-[0_0_10px_rgba(70,178,255,0.25)] hover:from-[#27a0df] hover:to-[#1672a4] disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <Save size={13} />
                                        {selectedDesign ? "Update Design" : "Save Design"}
                                    </button>
                                </div>
                            </div>
                            {setupError && (
                                <div className="mt-2 border border-[#6b2b32] bg-[#1d090b] px-2 py-1.5 text-[11px] text-[#ffaaaa]">
                                    {setupError}
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-12 gap-4">
                            { }
                            <div className="col-span-12 lg:col-span-5 space-y-4">
                                { }
                                <div className="border border-[#2c2f36] bg-[#070910]">
                                    <div className="px-3 py-1.5 bg-[#101219] border-b border-[#2c2f36]">
                                        <span className="uppercase tracking-widest text-[10px] text-slate-300">
                                            Tower
                                        </span>
                                    </div>
                                    <div className="p-3">
                                        <select
                                            className={selectBase}
                                            value={towerTypeId ?? ""}
                                            onChange={(e) =>
                                                setTowerTypeId(e.target.value ? Number(e.target.value) : null)
                                            }
                                        >
                                            {towers.map((t) => (
                                                <option key={t.type_id} value={t.type_id} className={optionBase}>
                                                    {t.name ?? t.type_name ?? `TypeID ${t.type_id}`}
                                                </option>
                                            ))}
                                        </select>

                                        <div className="mt-3 grid grid-cols-12 gap-3">
                                            <div className="col-span-6">
                                                <label className="block text-[10px] uppercase tracking-widest text-slate-400">
                                                    Fuel window (hours)
                                                </label>
                                                <input
                                                    className={inputBase}
                                                    type="number"
                                                    min={1}
                                                    max={24 * 365}
                                                    value={hours}
                                                    onChange={(e) => setHours(Number(e.target.value))}
                                                />
                                            </div>

                                            <div className="col-span-6">
                                                <label className="block text-[10px] uppercase tracking-widest text-slate-400">
                                                    Fuel type
                                                </label>
                                                <div className={readoutBase}>{plan?.fuel?.name || "—"}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                { }
                                <div className="border border-[#2c2f36] bg-[#070910]">
                                    <div className="px-3 py-1.5 bg-[#101219] border-b border-[#2c2f36]">
                                        <span className="uppercase tracking-widest text-[10px] text-slate-300">
                                            Add modules
                                        </span>
                                    </div>
                                    <div className="p-3 space-y-3">
                                        <div>
                                            <label className="block text-[10px] uppercase tracking-widest text-slate-400">
                                                Module category
                                            </label>
                                            <select
                                                className={selectBase}
                                                value={groupId ?? ""}
                                                onChange={(e) =>
                                                    setGroupId(e.target.value ? Number(e.target.value) : null)
                                                }
                                            >
                                                {groups.map((g) => {
                                                    const id = (g.marketgroup_id ?? g.group_id) ?? 0;
                                                    const name =
                                                        g.marketgroup_name ?? g.group_name ?? `Group ${id}`;
                                                    return (
                                                        <option key={id} value={id} className={optionBase}>
                                                            {name}
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-[10px] uppercase tracking-widest text-slate-400">
                                                Module
                                            </label>
                                            <select
                                                className={selectBase}
                                                value={modulePick ?? ""}
                                                onChange={(e) =>
                                                    setModulePick(e.target.value ? Number(e.target.value) : null)
                                                }
                                                disabled={!groupId || groupModules.length === 0}
                                            >
                                                {groupModules.length === 0 ? (
                                                    <option value="" className={optionBase}>
                                                        No modules
                                                    </option>
                                                ) : (
                                                    groupModules.map((m) => (
                                                        <option key={m.type_id} value={m.type_id} className={optionBase}>
                                                            {m.name ?? m.type_name ?? `TypeID ${m.type_id}`}
                                                        </option>
                                                    ))
                                                )}
                                            </select>
                                        </div>

                                        <button
                                            className="w-full border border-[#2c2f36] bg-[#0b111a] px-3 py-2 text-[11px] uppercase tracking-widest text-slate-200 hover:bg-[#101a26] disabled:opacity-50"
                                            type="button"
                                            onClick={addModule}
                                            disabled={!modulePick}
                                        >
                                            Add to fit
                                        </button>
                                    </div>
                                </div>

                                { }
                                <div className="border border-[#2c2f36] bg-[#070910]">
                                    <div className="flex items-center justify-between px-3 py-1.5 bg-[#101219] border-b border-[#2c2f36]">
                                        <span className="uppercase tracking-widest text-[10px] text-slate-300">Fit</span>
                                        <span className="text-[10px] text-slate-500">{fit.length} line(s)</span>
                                    </div>

                                    <div className="p-3">
                                        {fit.length === 0 ? (
                                            <div className="text-[11px] text-slate-500">No modules selected.</div>
                                        ) : (
                                            <div className="space-y-2">
                                                {fit.map((l) => (
                                                    <div
                                                        key={l.type_id}
                                                        className="flex items-center gap-2 border border-[#2c2f36] bg-[#05070b] px-2 py-2"
                                                    >
                                                        <div className="min-w-0 flex-1">
                                                            <div className="truncate text-[11px] text-slate-100">
                                                                {nameByTypeId.get(l.type_id)?.name ?? `TypeID ${l.type_id}`}
                                                            </div>
                                                            <div className="text-[10px] uppercase tracking-widest text-slate-500">
                                                                qty
                                                            </div>
                                                        </div>

                                                        <input
                                                            className="w-20 border border-[#303236] bg-[#05070b] px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-[#4b9cff]/60"
                                                            type="number"
                                                            min={0}
                                                            value={l.qty}
                                                            onChange={(e) => updateQty(l.type_id, Number(e.target.value))}
                                                        />

                                                        <button
                                                            className="border border-[#2c2f36] bg-[#160a0a] px-2 py-1 text-[11px] text-red-300 hover:bg-[#1d0c0c]"
                                                            onClick={() => removeLine(l.type_id)}
                                                            type="button"
                                                            title="Remove"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            { }
                            <div className="col-span-12 lg:col-span-7 space-y-4">
                                { }
                                <div className="border border-[#2c2f36] bg-[#070910]">
                                    <div className="px-3 py-1.5 bg-[#101219] border-b border-[#2c2f36]">
                                        <span className="uppercase tracking-widest text-[10px] text-slate-300">
                                            Fitting
                                        </span>
                                    </div>

                                    <div className="p-3">
                                        <div className="grid grid-cols-12 gap-3">
                                            <div className="col-span-6 border border-[#2c2f36] bg-[#05070b] p-2">
                                                <div className="text-[10px] uppercase tracking-widest text-slate-500">
                                                    Powergrid
                                                </div>
                                                <div className="mt-1 flex items-baseline justify-between">
                                                    <span className="text-slate-100">
                                                        {fmtInt(calc?.fitting?.pg_used_mw)} / {fmtInt(calc?.tower?.pg_out_mw)} MW
                                                    </span>
                                                    <span className="text-slate-500">{fmtNum(calc?.fitting?.pg_pct, 1)}%</span>
                                                </div>
                                                <div className="mt-2 h-1.5 w-full bg-[#0b0d11] border border-[#262933]">
                                                    <div
                                                        className={`h-1.5 ${usageColor(calc?.fitting?.pg_pct)}`}
                                                        style={{
                                                            width: `${Math.min(120, Math.max(0, Number(calc?.fitting?.pg_pct ?? 0)))}%`,
                                                        }}
                                                    />
                                                </div>
                                            </div>

                                            <div className="col-span-6 border border-[#2c2f36] bg-[#05070b] p-2">
                                                <div className="text-[10px] uppercase tracking-widest text-slate-500">
                                                    CPU
                                                </div>
                                                <div className="mt-1 flex items-baseline justify-between">
                                                    <span className="text-slate-100">
                                                        {fmtInt(calc?.fitting?.cpu_used_tf)} / {fmtInt(calc?.tower?.cpu_out_tf)} tf
                                                    </span>
                                                    <span className="text-slate-500">{fmtNum(calc?.fitting?.cpu_pct, 1)}%</span>
                                                </div>
                                                <div className="mt-2 h-1.5 w-full bg-[#0b0d11] border border-[#262933]">
                                                    <div
                                                        className={`h-1.5 ${usageColor(calc?.fitting?.cpu_pct)}`}
                                                        style={{
                                                            width: `${Math.min(120, Math.max(0, Number(calc?.fitting?.cpu_pct ?? 0)))}%`,
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        { }
                                        <div className="mt-4 border border-[#2c2f36] bg-[#05070b]">
                                            <div className="px-3 py-1.5 bg-[#101219] border-b border-[#2c2f36]">
                                                <span className="uppercase tracking-widest text-[10px] text-slate-300">
                                                    Shield resists
                                                </span>
                                            </div>
                                            <div className="p-3 grid grid-cols-12 gap-2">
                                                {(["em", "therm", "kin", "exp"] as const).map((k) => (
                                                    <div
                                                        key={k}
                                                        className="col-span-6 md:col-span-3 border border-[#2c2f36] bg-[#070910] p-2"
                                                    >
                                                        <div className="text-[10px] uppercase tracking-widest text-slate-500">
                                                            {k}
                                                        </div>
                                                        <div className="mt-1 flex items-baseline justify-between">
                                                            <span className="text-slate-100">
                                                                {fmtNum(calc?.tower?.shield_resists?.final?.[k], 2)}%
                                                            </span>
                                                            <span className="text-slate-500">
                                                                base {fmtNum(calc?.tower?.shield_resists?.base?.[k], 2)}%
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        { }
                                        <div className="mt-4 border border-[#2c2f36] bg-[#05070b]">
                                            <div className="px-3 py-1.5 bg-[#101219] border-b border-[#2c2f36]">
                                                <span className="uppercase tracking-widest text-[10px] text-slate-300">
                                                    HP / EHP
                                                </span>
                                            </div>
                                            <div className="p-3 grid grid-cols-12 gap-2">
                                                <div className="col-span-6 md:col-span-3 border border-[#2c2f36] bg-[#070910] p-2">
                                                    <div className="text-[10px] uppercase tracking-widest text-slate-500">
                                                        Shield HP
                                                    </div>
                                                    <div className="mt-1 text-slate-100">{fmtISK(shieldHP)}</div>
                                                </div>

                                                <div className="col-span-6 md:col-span-3 border border-[#2c2f36] bg-[#070910] p-2">
                                                    <div className="text-[10px] uppercase tracking-widest text-slate-500">
                                                        Shield EHP
                                                    </div>
                                                    <div className="mt-1 text-slate-100">{fmtISK(shieldEHP)}</div>
                                                </div>

                                                <div className="col-span-6 md:col-span-2 border border-[#2c2f36] bg-[#070910] p-2">
                                                    <div className="text-[10px] uppercase tracking-widest text-slate-500">
                                                        Armor HP
                                                    </div>
                                                    <div className="mt-1 text-slate-100">{fmtISK(armorHP)}</div>
                                                </div>

                                                <div className="col-span-6 md:col-span-2 border border-[#2c2f36] bg-[#070910] p-2">
                                                    <div className="text-[10px] uppercase tracking-widest text-slate-500">
                                                        Hull HP
                                                    </div>
                                                    <div className="mt-1 text-slate-100">{fmtISK(hullHP)}</div>
                                                </div>

                                                <div className="col-span-12 md:col-span-2 border border-[#2c2f36] bg-[#070910] p-2">
                                                    <div className="text-[10px] uppercase tracking-widest text-slate-500">
                                                        Total EHP
                                                    </div>
                                                    <div className="mt-1 text-slate-100">{fmtISK(totalEHP)}</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                { }
                                <div className="border border-[#2c2f36] bg-[#070910]">
                                    <div className="flex items-center justify-between px-3 py-1.5 bg-[#101219] border-b border-[#2c2f36]">
                                        <span className="uppercase tracking-widest text-[10px] text-slate-300">
                                            Costs (Jita sell_min)
                                        </span>
                                        <span className="text-[10px] text-slate-500">window: {hours}h</span>
                                    </div>

                                    <div className="p-3">
                                        <div className="grid grid-cols-12 gap-3">
                                            <div className="col-span-6 md:col-span-3 border border-[#2c2f36] bg-[#05070b] p-2">
                                                <div className="text-[10px] uppercase tracking-widest text-slate-500">
                                                    Tower
                                                </div>
                                                <div className="mt-1 text-slate-100">{fmtISK(plan ? towerCostISK : null)}</div>
                                            </div>
                                            <div className="col-span-6 md:col-span-3 border border-[#2c2f36] bg-[#05070b] p-2">
                                                <div className="text-[10px] uppercase tracking-widest text-slate-500">
                                                    Modules
                                                </div>
                                                <div className="mt-1 text-slate-100">{fmtISK(plan ? modulesCostISK : null)}</div>
                                            </div>
                                            <div className="col-span-6 md:col-span-3 border border-[#2c2f36] bg-[#05070b] p-2">
                                                <div className="text-[10px] uppercase tracking-widest text-slate-500">
                                                    Fuel
                                                </div>
                                                <div className="mt-1 text-slate-100">{fmtISK(fuelCostISK)}</div>
                                            </div>
                                            <div className="col-span-6 md:col-span-3 border border-[#2c2f36] bg-[#05070b] p-2">
                                                <div className="text-[10px] uppercase tracking-widest text-slate-500">
                                                    Total
                                                </div>
                                                <div className="mt-1 text-slate-100">{fmtISK(plan ? totalCostWithFuel : null)}</div>
                                            </div>
                                        </div>

                                        <div className="mt-3 grid grid-cols-12 gap-3">
                                            <div className="col-span-12 md:col-span-6 border border-[#2c2f36] bg-[#05070b] p-2">
                                                <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-500">
                                                    <span>Fuel</span>
                                                    <span className="normal-case tracking-normal text-slate-500">
                                                        {fuelBlocksPerHour} blocks/h
                                                    </span>
                                                </div>
                                                <div className="mt-1 text-slate-100">{fmtNum(fuelBlocksTotal, 0)} blocks</div>
                                            </div>
                                            <div className="col-span-12 md:col-span-6 border border-[#2c2f36] bg-[#05070b] p-2">
                                                <div className="text-[10px] uppercase tracking-widest text-slate-500">
                                                    Deployment volume
                                                </div>
                                                <div className="mt-1 text-slate-100">
                                                    {fmtInt(plan?.totals?.deployment_m3 ?? 0)} m³
                                                </div>
                                            </div>
                                        </div>

                                        { }
                                        <div className="mt-4 border border-[#2b2d33] overflow-hidden">
                                            <div className="flex items-center justify-between px-3 py-1.5 bg-[#101219] border-b border-[#2b2d33]">
                                                <div className="text-[10px] uppercase tracking-widest text-slate-400">Line items</div>

                                                <button
                                                    type="button"
                                                    onClick={copyShoppingList}
                                                    disabled={!plan?.tower?.name}
                                                    className="border border-[#2b2d33] bg-[#0b0d11] px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-200 hover:bg-[#141821] disabled:opacity-50"
                                                    title="Copy tower, modules, and fuel blocks to clipboard"
                                                >
                                                    Copy shopping list
                                                </button>
                                            </div>

                                            <div className="max-h-[340px] overflow-auto">
                                                {plan?.lines?.length ? (
                                                    <table className="w-full text-left text-[11px]">
                                                        <thead className="sticky top-0 bg-[#14161c] text-slate-300">
                                                            <tr>
                                                                <th className="border border-[#2b2d33] px-2.5 py-1.5">Item</th>
                                                                <th className="border border-[#2b2d33] px-2.5 py-1.5">Qty</th>
                                                                <th className="border border-[#2b2d33] px-2.5 py-1.5">PG</th>
                                                                <th className="border border-[#2b2d33] px-2.5 py-1.5">CPU</th>
                                                                <th className="border border-[#2b2d33] px-2.5 py-1.5">Unit</th>
                                                                <th className="border border-[#2b2d33] px-2.5 py-1.5">Line</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {plan?.lines?.map((l, idx) => (
                                                                <tr
                                                                    key={l.type_id}
                                                                    className={`${idx % 2 === 0 ? "bg-[#090b11]" : "bg-[#0c0f16]"} hover:bg-[#141821]`}
                                                                >
                                                                    <td className="border border-[#2b2d33] px-2.5 py-1.5">
                                                                        <div className="text-slate-100">{l.name}</div>
                                                                        <div className="text-[10px] text-slate-500">{l.group_name}</div>
                                                                    </td>
                                                                    <td className="border border-[#2b2d33] px-2.5 py-1.5 text-slate-100">{l.qty}</td>
                                                                    <td className="border border-[#2b2d33] px-2.5 py-1.5 text-slate-100">
                                                                        {fmtInt((l.powergrid_mw ?? 0) * l.qty)} MW
                                                                    </td>
                                                                    <td className="border border-[#2b2d33] px-2.5 py-1.5 text-slate-100">
                                                                        {fmtInt((l.cpu_tf ?? 0) * l.qty)} tf
                                                                    </td>
                                                                    <td className="border border-[#2b2d33] px-2.5 py-1.5 text-slate-100">{fmtISK(l.unit_price)}</td>
                                                                    <td className="border border-[#2b2d33] px-2.5 py-1.5 text-slate-100">{fmtISK(l.line_isk)}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                ) : (
                                                    <div className="px-3 py-3 text-[11px] text-slate-500">
                                                        No line items (only tower).
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            { }
                            <div className="hidden">{fitExpanded.length}</div>
                        </div>
                    </div>
                </div>
            </div>
            {saveDialogMode && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-3">
                    <div className="w-full max-w-md border border-[#34404c] bg-[#070910] text-slate-100 shadow-2xl shadow-black/70">
                        <div className="flex min-h-9 items-center justify-between border-b border-[#20242c] bg-[#101219] px-3 py-1.5">
                            <div>
                                <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-200">
                                    {saveDialogMode === "rename"
                                        ? "Rename POS Design"
                                        : saveDialogMode === "update"
                                            ? "Update POS Design"
                                            : "Save POS Design"}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                    {saveDialogMode === "rename"
                                        ? "Rename this saved POS design."
                                        : "Save this tower, fuel window, and module fit to your Triff.Tools account."}
                                </div>
                            </div>
                            <button
                                type="button"
                                className="text-slate-500 hover:text-slate-100"
                                onClick={() => {
                                    if (setupBusy) return;
                                    setSaveDialogMode(null);
                                    setSaveName("");
                                }}
                                aria-label="Close"
                            >
                                <X size={15} />
                            </button>
                        </div>

                        <form className="space-y-3 p-3" onSubmit={handleSaveDialogSubmit}>
                            <label className="block">
                                <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">
                                    Design Name
                                </span>
                                <input
                                    value={saveName}
                                    onChange={(event) => setSaveName(event.target.value)}
                                    className="w-full border border-[#303236] bg-[#05070b] px-2 py-1.5 text-[12px] text-slate-100 outline-none focus:border-[#53b6ff]"
                                    maxLength={160}
                                    autoFocus
                                />
                            </label>

                            {saveDialogMode !== "rename" && (
                                <div className="border border-[#20242c] bg-[#080c13] px-2 py-2 text-[11px] leading-relaxed text-slate-400">
                                    This saves the selected tower, fuel duration, module type IDs, and quantities. Costs, EHP, fuel blocks, and shopping lists recalculate when the design is loaded.
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
                                        setSaveName("");
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={!!setupBusy}
                                    className="inline-flex h-7 items-center justify-center gap-1 border border-[#46b2ff]/70 bg-gradient-to-b from-[#1b8cc8] to-[#14608a] px-2.5 text-[10px] font-semibold uppercase tracking-widest text-slate-50 shadow-[0_0_10px_rgba(70,178,255,0.35)] hover:from-[#27a0df] hover:to-[#1672a4] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {setupBusy ? "Saving..." : saveDialogMode === "rename" ? "Rename" : "Save"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
