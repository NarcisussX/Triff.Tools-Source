/*
 * React page for /schedule.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import React, { useEffect, useMemo, useState } from 'react';

type TypeSearchResult = {
    type_id: number;
    name: string;
};

type TargetItem = {
    typeId: number;
    typeName: string;
    quantity: number;
    runsPerBpc: number;
};

type SlotConfig = {
    manufacturingSlots: number;
    copySlots: number;
};

type BlueprintProduct = {
    typeId: number | null;
    typeName: string;
};

type BlueprintPlan = {
    blueprintId: number;
    blueprintLabel: string;
    products: BlueprintProduct[];
    runsNeeded: number;
    bpoCount: number;
    maxRunsPerBpc: number;
    copiesNeeded: number;
    runsPerCopy: number[];
    copyTimePerRunSeconds: number;
    mfgTimePerRunSeconds: number;
    totalCopyWorkSeconds: number;
    totalMfgWorkSeconds: number;
    effectiveCopyParallelism: number;
    effectiveMfgParallelism: number;
    copySpanSeconds: number;
    mfgSpanSeconds: number;
    copyPlanned?: boolean;
    copyDisabledReason?: string | null;
    isCopyBottleneck?: boolean;
    medianCopySpanSeconds?: number;
    recommendedBpoCountForMedian?: number;
    runsPerCopyUnified?: number | null;
    directRunsPerBpo?: number | null;
    isFinalProductBlueprint?: boolean;
};

type ScheduleTotals = {
    totalRuns: number;
    totalCopyWorkSeconds: number;
    totalMfgWorkSeconds: number;
    estimatedCopySpanSeconds: number;
    estimatedMfgSpanSeconds: number;
};

type TreeNode = {
    id: string;
    label: string;
    children?: TreeNode[];
};

type ScheduleResult = {
    slotConfig: SlotConfig;
    assumeTe20: boolean;
    totals: ScheduleTotals;
    blueprints: BlueprintPlan[];
    tree?: TreeNode[];
};

type Structure = 'RAITARU' | 'AZBEL' | 'SOTIYO' | 'NPC_STATION';
type FacilityRig = 'NONE' | 'T1' | 'T2';
type SecurityBand = 'HS' | 'LS' | 'NULL_WH';

type FinalBpcInfo = {
    bpcCount: number;
    runsPerBpc: number;
    teLevel: number;
};

function formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0 || !Number.isFinite(seconds)) return '—';
    const s = Math.round(seconds);
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const minutes = Math.floor((s % 3600) / 60);

    const parts: string[] = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (!days && minutes) parts.push(`${minutes}m`);
    if (parts.length === 0) return '<1m';
    return parts.join(' ');
}

function formatNumber(n: number): string {
    if (n === undefined || n === null || !Number.isFinite(n)) return '—';
    return n.toLocaleString();
}

function renderRunsPerCopy(runsPerCopy: number[]): string {
    if (!runsPerCopy || runsPerCopy.length === 0) return '—';
    const first = runsPerCopy[0];
    const allSame = runsPerCopy.every((r) => r === first);
    if (allSame) {
        return formatNumber(first);
    }
    return runsPerCopy.map((r) => formatNumber(r)).join(', ');
}

const ManufacturingPlanner: React.FC = () => {
    const [items, setItems] = useState<TargetItem[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<TypeSearchResult[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);

    const [characters, setCharacters] = useState(8);
    const [mfgSlotsPerChar, setMfgSlotsPerChar] = useState(10);
    const [copySlotsPerChar, setCopySlotsPerChar] = useState(9);

    const [assumeTe20, setAssumeTe20] = useState(true);

    const [productMe, setProductMe] = useState(3);
    const [structure, setStructure] = useState<Structure>('RAITARU');
    const [rig, setRig] = useState<FacilityRig>('T2');
    const [security, setSecurity] = useState<SecurityBand>('NULL_WH');

    const [bpoCounts, setBpoCounts] = useState<Record<number, number>>({});
    const [finalBpcs, setFinalBpcs] = useState<Record<number, FinalBpcInfo>>({});
    const [scheduleResult, setScheduleResult] = useState<ScheduleResult | null>(null);
    const [loadingSchedule, setLoadingSchedule] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const manufacturingSlots = useMemo(
        () => Math.max(1, characters * mfgSlotsPerChar),
        [characters, mfgSlotsPerChar]
    );
    const copySlots = useMemo(
        () => Math.max(1, characters * copySlotsPerChar),
        [characters, copySlotsPerChar]
    );

    useEffect(() => {
        if (!searchQuery || searchQuery.length < 3) {
            setSearchResults([]);
            return;
        }

        let cancelled = false;
        setSearchLoading(true);

        const handle = setTimeout(async () => {
            try {
                const resp = await fetch(
                    `/api/types/search?q=${encodeURIComponent(searchQuery)}&limit=20`
                );
                if (!resp.ok) throw new Error(`Search failed: ${resp.status}`);
                const data: TypeSearchResult[] = await resp.json();
                if (!cancelled) setSearchResults(data);
            } catch (err) {
                console.error('search error', err);
                if (!cancelled) setSearchResults([]);
            } finally {
                if (!cancelled) setSearchLoading(false);
            }
        }, 300);

        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
    }, [searchQuery]);

    const addItem = (result: TypeSearchResult) => {
        setItems((prev) => {
            const existing = prev.find((p) => p.typeId === result.type_id);
            if (existing) {
                return prev.map((p) =>
                    p.typeId === result.type_id ? { ...p, quantity: p.quantity + 1 } : p
                );
            }
            return [
                ...prev,
                {
                    typeId: result.type_id,
                    typeName: result.name,
                    quantity: 1,
                    runsPerBpc: 1
                }
            ];
        });
        setSearchQuery('');
        setSearchResults([]);
    };

    const updateItemQuantity = (typeId: number, quantity: number) => {
        setItems((prev) =>
            prev.map((p) => (p.typeId === typeId ? { ...p, quantity: Math.max(1, quantity) } : p))
        );
    };

    const updateItemRunsPerBpc = (typeId: number, runsPerBpc: number) => {
        setItems((prev) =>
            prev.map((p) =>
                p.typeId === typeId
                    ? { ...p, runsPerBpc: Math.max(1, runsPerBpc || 1) }
                    : p
            )
        );
    };

    const removeItem = (typeId: number) => {
        setItems((prev) => prev.filter((p) => p.typeId !== typeId));
    };

    const handleGenerateSchedule = async () => {
        setError(null);
        if (!items.length) {
            setError('Add at least one product to plan.');
            return;
        }

        setLoadingSchedule(true);
        try {
            const body = {
                items: items.map((it) => ({
                    typeId: it.typeId,
                    quantity: it.quantity,
                    runsPerBpc: it.runsPerBpc,
                    typeName: it.typeName
                })),
                slotConfig: {
                    manufacturingSlots,
                    copySlots
                },
                bpoInventory: Object.entries(bpoCounts)
                    .filter(([, count]) => count && count > 0)
                    .map(([blueprintId, count]) => ({
                        blueprintId: Number(blueprintId),
                        count
                    })),
                settings: {
                    assumeTe20,
                    productMe,
                    componentMe: productMe,

                    productFacility: { structure, rig, security },
                    componentFacility: { structure, rig, security },
                    includeReactions: false
                }
            };

            const resp = await fetch('/api/industry/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!resp.ok) {
                const text = await resp.text();
                throw new Error(`Schedule error ${resp.status}: ${text}`);
            }

            const data: ScheduleResult = await resp.json();
            setScheduleResult(data);

            const newBpoCounts: Record<number, number> = { ...bpoCounts };
            const newFinalBpcs: Record<number, FinalBpcInfo> = { ...finalBpcs };

            for (const bp of data.blueprints) {
                if (newBpoCounts[bp.blueprintId] == null) {
                    newBpoCounts[bp.blueprintId] = bp.bpoCount ?? 1;
                }

                if (bp.isFinalProductBlueprint) {
                    const runs = bp.runsNeeded || 0;
                    const maxRuns = bp.maxRunsPerBpc || (runs || 1);

                    if (!newFinalBpcs[bp.blueprintId]) {
                        const defaultBpcCount = runs > 0 ? Math.ceil(runs / maxRuns) : 1;
                        const defaultRunsPerBpc = runs > 0 ? Math.min(maxRuns, runs) : 1;
                        newFinalBpcs[bp.blueprintId] = {
                            bpcCount: defaultBpcCount,
                            runsPerBpc: defaultRunsPerBpc,
                            teLevel: 3
                        };
                    }
                }
            }

            setBpoCounts(newBpoCounts);
            setFinalBpcs(newFinalBpcs);
        } catch (err: any) {
            console.error('schedule error', err);
            setError(err?.message || 'Failed to generate schedule.');
        } finally {
            setLoadingSchedule(false);
        }
    };

    const handleBpoCountChange = (blueprintId: number, value: string) => {
        const n = Number(value.replace(/[^0-9]/g, ''));
        setBpoCounts((prev) => ({
            ...prev,
            [blueprintId]: Number.isFinite(n) && n > 0 ? n : 0
        }));
    };

    const handleFinalBpcCountChange = (blueprintId: number, value: string) => {
        const n = Number(value.replace(/[^0-9]/g, ''));
        setFinalBpcs((prev) => {
            const prevInfo = prev[blueprintId] || { bpcCount: 1, runsPerBpc: 1, teLevel: 0 };
            return {
                ...prev,
                [blueprintId]: {
                    ...prevInfo,
                    bpcCount: Number.isFinite(n) && n > 0 ? n : 1
                }
            };
        });
    };

    const handleFinalRunsPerBpcChange = (blueprintId: number, value: string) => {
        const n = Number(value.replace(/[^0-9]/g, ''));
        setFinalBpcs((prev) => {
            const prevInfo = prev[blueprintId] || { bpcCount: 1, runsPerBpc: 1, teLevel: 0 };
            return {
                ...prev,
                [blueprintId]: {
                    ...prevInfo,
                    runsPerBpc: Number.isFinite(n) && n > 0 ? n : 1
                }
            };
        });
    };

    const handleFinalTeChange = (blueprintId: number, value: string) => {
        const n = Number(value.replace(/[^0-9]/g, ''));
        const clamped = Math.min(20, Math.max(0, Number.isFinite(n) ? n : 0));
        setFinalBpcs((prev) => {
            const prevInfo = prev[blueprintId] || { bpcCount: 1, runsPerBpc: 1, teLevel: 0 };
            return {
                ...prev,
                [blueprintId]: {
                    ...prevInfo,
                    teLevel: clamped
                }
            };
        });
    };

    const computeFinalHullMfgSpan = (bp: BlueprintPlan): string => {
        const info = finalBpcs[bp.blueprintId];
        const runsNeeded = bp.runsNeeded || 0;
        const basePerRun = bp.mfgTimePerRunSeconds || 0;

        if (!info || !runsNeeded || !basePerRun) {
            return formatDuration(bp.mfgSpanSeconds);
        }

        const te = Math.min(20, Math.max(0, info.teLevel || 0));
        const teMultiplier = 1 - te * 0.01;
        const perRun = basePerRun * teMultiplier;

        const parallel = Math.max(
            1,
            Math.min(manufacturingSlots, info.bpcCount || 1)
        );
        const spanSeconds = (perRun * runsNeeded) / parallel;
        return formatDuration(spanSeconds);
    };

    const totals = scheduleResult?.totals;
    const blueprints = scheduleResult?.blueprints || [];
    const components = blueprints.filter((bp) => !bp.isFinalProductBlueprint);
    const finalHulls = blueprints.filter((bp) => bp.isFinalProductBlueprint);
    const tree = scheduleResult?.tree || [];

    const renderTreeNodes = (nodes: TreeNode[], depth = 0): React.ReactNode => {
        return nodes.map((node) => {
            const label = node.label?.trim?.() ?? '';
            if (label.startsWith('Buy ')) {
                return null;
            }
            return (
                <React.Fragment key={node.id}>
                    <div
                        className="font-mono text-[11px] text-slate-200"
                        style={{ paddingLeft: depth * 16 }}
                    >
                        {node.label}
                    </div>
                    {node.children && node.children.length > 0 && renderTreeNodes(node.children, depth + 1)}
                </React.Fragment>
            );
        });
    };

    return (
        <div className="tt-tool-v2 min-h-screen text-slate-100 text-[11px] leading-snug">
            <div className="tt2-frame tt2-frame--centered">
                { }
                <div className="tt2-window">
                    { }
                    <div className="tt2-titlebar">
                        <div className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
                            <span className="uppercase tracking-widest text-[10px] text-slate-300">
                                Science &amp; Industry ▸ Manufacturing BPC Scheduler
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-[9px] text-slate-400">
                            <span className="px-1 py-0.5 bg-[#0b0d11] border border-[#303236]">
                                Industry Park
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
                                Overview ▸ BPO/BPC Planning
                            </span>
                            <span className="flex items-center gap-1">
                                <span className="h-2 w-2 rounded-full bg-[#3bbf5a]" />
                                <span>SDE Data loaded</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-2" />
                    </div>

                    { }
                    <div className="p-3 space-y-4">
                        { }
                        <div className="border border-[#262933] bg-[#05070b]/90 px-3 py-2 space-y-1">
                            <p className="text-[12px] text-slate-300">
                                This panel turns an industry plan into an actionable{" "}
                                <span className="text-slate-100">BPO/BPC schedule</span>. Define your target
                                products and slot capacity, then see how many copies and runs you need per
                                blueprint, which components are your copy bottlenecks, and how long the
                                whole chain will run.
                            </p>
                            <p className="text-[12px] text-slate-400">
                                This tool specifically is tailored to my own setup (all indy characters share
                                the same copying/mfg skills) and is made public as-is; updates generally track
                                changes to my personal systems rather than the wider meta.
                            </p>
                        </div>

                        { }
                        <div className="grid md:grid-cols-2 gap-3">
                            { }
                            <fieldset className="border border-[#2c2f36] bg-[#070910]">
                                <legend className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300">
                                    <span>Target products</span>
                                </legend>
                                <div className="p-2 space-y-3">
                                    <div>
                                        <label className="block text-[10px] uppercase tracking-widest text-slate-400 mb-1">
                                            Search products (3+ chars)
                                        </label>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="w-full bg-[#05070b] border border-[#303236] px-2 py-1.5 text-[11px] text-slate-100 placeholder-slate-500 outline-none focus:border-[#53b6ff]"
                                                placeholder="Cerberus, Nightmare, Scimitar..."
                                            />
                                            {searchLoading && (
                                                <div className="absolute right-2 top-1.5 text-[10px] text-slate-500 animate-pulse">
                                                    searching...
                                                </div>
                                            )}
                                        </div>
                                        {searchResults.length > 0 && (
                                            <div className="mt-2 max-h-56 overflow-y-auto bg-[#05070b] border border-[#303236] text-[11px]">
                                                {searchResults.map((r) => (
                                                    <button
                                                        key={r.type_id}
                                                        type="button"
                                                        onClick={() => addItem(r)}
                                                        className="w-full text-left px-2 py-1.5 hover:bg-[#101319] flex justify-between items-center"
                                                    >
                                                        <span className="text-slate-100">{r.name}</span>
                                                        <span className="text-[10px] text-slate-500">#{r.type_id}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div>
                                        <h3 className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">
                                            Selected products
                                        </h3>
                                        {items.length === 0 ? (
                                            <p className="text-[11px] text-slate-500">
                                                No products added yet. Search above and click to add.
                                            </p>
                                        ) : (
                                            <div className="border border-[#262933] bg-[#05070b]/80 divide-y divide-[#262933]">
                                                {items.map((item) => (
                                                    <div
                                                        key={item.typeId}
                                                        className="flex items-center justify-between px-2 py-1.5 gap-2"
                                                    >
                                                        <div className="min-w-0">
                                                            <div className="text-[11px] text-slate-100 truncate">
                                                                {item.typeName}
                                                            </div>
                                                            <div className="text-[10px] text-slate-500 truncate">
                                                                typeId: {item.typeId}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                value={item.quantity}
                                                                onChange={(e) =>
                                                                    updateItemQuantity(
                                                                        item.typeId,
                                                                        Number(e.target.value) || 1
                                                                    )
                                                                }
                                                                className="w-20 bg-[#05070b] border border-[#303236] px-1.5 py-1 text-[11px] text-slate-100 text-right outline-none focus:border-[#53b6ff]"
                                                                title="Total runs / units to build"
                                                            />
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                value={item.runsPerBpc}
                                                                onChange={(e) =>
                                                                    updateItemRunsPerBpc(
                                                                        item.typeId,
                                                                        Number(e.target.value) || 1
                                                                    )
                                                                }
                                                                className="w-20 bg-[#05070b] border border-[#303236] px-1.5 py-1 text-[11px] text-slate-100 text-right outline-none focus:border-[#53b6ff]"
                                                                title="Runs per BPC for this item"
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => removeItem(item.typeId)}
                                                                className="text-[11px] text-red-400 hover:text-red-300"
                                                            >
                                                                ✕
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </fieldset>

                            { }
                            <fieldset className="border border-[#2c2f36] bg-[#070910]">
                                <legend className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300">
                                    <span>Capacity &amp; settings</span>
                                </legend>
                                <div className="p-2 space-y-3">
                                    <div className="grid grid-cols-3 gap-2">
                                        <div>
                                            <label className="block text-[10px] uppercase tracking-widest text-slate-400 mb-0.5">
                                                Characters
                                            </label>
                                            <input
                                                type="number"
                                                min={1}
                                                value={characters}
                                                onChange={(e) =>
                                                    setCharacters(
                                                        Math.max(
                                                            1,
                                                            Number.isFinite(Number(e.target.value))
                                                                ? Number(e.target.value)
                                                                : 1
                                                        )
                                                    )
                                                }
                                                className="w-full bg-[#05070b] border border-[#303236] px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-[#53b6ff]"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] uppercase tracking-widest text-slate-400 mb-0.5">
                                                Mfg slots / char
                                            </label>
                                            <input
                                                type="number"
                                                min={1}
                                                value={mfgSlotsPerChar}
                                                onChange={(e) =>
                                                    setMfgSlotsPerChar(
                                                        Math.max(
                                                            1,
                                                            Number.isFinite(Number(e.target.value))
                                                                ? Number(e.target.value)
                                                                : 1
                                                        )
                                                    )
                                                }
                                                className="w-full bg-[#05070b] border border-[#303236] px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-[#53b6ff]"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] uppercase tracking-widest text-slate-400 mb-0.5">
                                                Copy slots / char
                                            </label>
                                            <input
                                                type="number"
                                                min={1}
                                                value={copySlotsPerChar}
                                                onChange={(e) =>
                                                    setCopySlotsPerChar(
                                                        Math.max(
                                                            1,
                                                            Number.isFinite(Number(e.target.value))
                                                                ? Number(e.target.value)
                                                                : 1
                                                        )
                                                    )
                                                }
                                                className="w-full bg-[#05070b] border border-[#303236] px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-[#53b6ff]"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                                        <div className="bg-[#070910] border border-[#262933] px-3 py-2 space-y-0.5">
                                            <div className="text-slate-400">Total manufacturing slots</div>
                                            <div className="text-[13px] font-semibold text-[#9fd7ff]">
                                                {manufacturingSlots.toLocaleString()}
                                            </div>
                                        </div>
                                        <div className="bg-[#070910] border border-[#262933] px-3 py-2 space-y-0.5">
                                            <div className="text-slate-400">Total copy slots</div>
                                            <div className="text-[13px] font-semibold text-[#9fd7ff]">
                                                {copySlots.toLocaleString()}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between text-[11px] pt-1">
                                        <label className="flex items-center gap-2 text-slate-300">
                                            <input
                                                type="checkbox"
                                                checked={assumeTe20}
                                                onChange={(e) => setAssumeTe20(e.target.checked)}
                                                className="h-3.5 w-3.5 rounded border-[#303236] bg-[#05070b] text-[#53b6ff] focus:ring-0"
                                            />
                                            <span>Assume TE 20 on component BPOs (final hulls use their own TE)</span>
                                        </label>
                                    </div>

                                    <div className="mt-2 border-t border-[#262933] pt-2 space-y-2 text-[11px]">
                                        <div className="flex items-center justify-between">
                                            <span className="text-slate-300">
                                                Facility settings (for both copy + mfg jobs)
                                            </span>
                                            <span className="text-[10px] text-slate-500">
                                                Raitaru −15% time, Azbel −20%, Sotiyo −30%
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-4 gap-2">
                                            <div>
                                                <label className="block text-[10px] uppercase tracking-widest text-slate-400 mb-0.5">
                                                    Final hull ME
                                                </label>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={10}
                                                    value={productMe}
                                                    onChange={(e) =>
                                                        setProductMe(
                                                            Math.min(
                                                                10,
                                                                Math.max(
                                                                    0,
                                                                    Number.isFinite(Number(e.target.value))
                                                                        ? Number(e.target.value)
                                                                        : 0
                                                                )
                                                            )
                                                        )
                                                    }
                                                    className="w-full bg-[#05070b] border border-[#303236] px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-[#53b6ff]"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] uppercase tracking-widest text-slate-400 mb-0.5">
                                                    Structure
                                                </label>
                                                <select
                                                    value={structure}
                                                    onChange={(e) => setStructure(e.target.value as Structure)}
                                                    className="w-full bg-[#05070b] border border-[#303236] px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-[#53b6ff]"
                                                >
                                                    <option value="RAITARU">Raitaru</option>
                                                    <option value="AZBEL">Azbel</option>
                                                    <option value="SOTIYO">Sotiyo</option>
                                                    <option value="NPC_STATION">NPC Station</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] uppercase tracking-widest text-slate-400 mb-0.5">
                                                    Rig
                                                </label>
                                                <select
                                                    value={rig}
                                                    onChange={(e) => setRig(e.target.value as FacilityRig)}
                                                    className="w-full bg-[#05070b] border border-[#303236] px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-[#53b6ff]"
                                                >
                                                    <option value="NONE">None</option>
                                                    <option value="T1">T1</option>
                                                    <option value="T2">T2</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] uppercase tracking-widest text-slate-400 mb-0.5">
                                                    Security
                                                </label>
                                                <select
                                                    value={security}
                                                    onChange={(e) => setSecurity(e.target.value as SecurityBand)}
                                                    className="w-full bg-[#05070b] border border-[#303236] px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-[#53b6ff]"
                                                >
                                                    <option value="HS">High-sec</option>
                                                    <option value="LS">Low-sec</option>
                                                    <option value="NULL_WH">Null / WH</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    {error && (
                                        <div className="text-[11px] text-red-300 bg-red-900/20 border border-red-700 px-2 py-1 mt-1">
                                            {error}
                                        </div>
                                    )}

                                    <div className="pt-2 border-t border-[#262933] flex justify-end">
                                        <button
                                            type="button"
                                            onClick={handleGenerateSchedule}
                                            disabled={loadingSchedule}
                                            className="min-w-[160px] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest
                                                   bg-gradient-to-b from-[#1b8cc8] to-[#14608a]
                                                   border border-[#46b2ff]/70
                                                   shadow-[0_0_12px_rgba(70,178,255,0.55)]
                                                   hover:from-[#27a0df] hover:to-[#1672a4]
                                                   disabled:opacity-60 disabled:cursor-not-allowed
                                                   transition-all duration-150"
                                        >
                                            {loadingSchedule ? 'Generating plan…' : 'Generate plan / recalc'}
                                        </button>
                                    </div>

                                    {scheduleResult && (
                                        <p className="text-[10px] text-slate-500 pt-1">
                                            Times use SDE base values scaled by structure size and (optionally) TE 20 for
                                            components. Skills and rigs are ignored on purpose – this tool is meant to
                                            identify BP copying &amp; manufacturing bottlenecks, not be a perfect stopwatch.
                                        </p>
                                    )}
                                </div>
                            </fieldset>
                        </div>

                        { }
                        {scheduleResult && (
                            <>
                                { }
                                <section className="border border-[#303236] bg-[#05070b]/90 px-3 py-2.5 space-y-2.5">
                                    <h2 className="text-[12px] font-semibold text-slate-100">
                                        Plan summary
                                    </h2>
                                    <div className="grid md:grid-cols-3 gap-2 text-[11px]">
                                        <div className="bg-[#070910] border border-[#262933] px-3 py-2 space-y-0.5">
                                            <div className="text-slate-400">Total blueprint runs</div>
                                            <div className="text-[13px] font-semibold text-[#9fd7ff]">
                                                {formatNumber(totals?.totalRuns ?? 0)}
                                            </div>
                                        </div>
                                        <div className="bg-[#070910] border border-[#262933] px-3 py-2 space-y-0.5">
                                            <div className="text-slate-400">Copy work (all labs)</div>
                                            <div className="text-[13px] font-semibold text-[#9fd7ff]">
                                                {formatDuration(totals?.totalCopyWorkSeconds ?? 0)}
                                            </div>
                                        </div>
                                        <div className="bg-[#070910] border border-[#262933] px-3 py-2 space-y-0.5">
                                            <div className="text-slate-400">Manufacturing work (all lines)</div>
                                            <div className="text-[13px] font-semibold text-[#9fd7ff]">
                                                {formatDuration(totals?.totalMfgWorkSeconds ?? 0)}
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                { }
                                <section className="border border-[#303236] bg-[#05070b]/90 px-3 py-2.5 space-y-2.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <h2 className="text-[12px] font-semibold text-slate-100">
                                            Blueprint breakdown
                                        </h2>
                                        <p className="text-[10px] text-slate-500 max-w-md text-right">
                                            Components that are tiny or have very high max-run BPCs are marked as
                                            &quot;run directly from BPOs&quot; and don&apos;t get copy jobs. Bottleneck
                                            rows are highlighted.
                                        </p>
                                    </div>

                                    {components.length === 0 ? (
                                        <p className="text-[11px] text-slate-500">
                                            No component blueprints – this usually means you are only building from
                                            existing hull BPCs.
                                        </p>
                                    ) : (
                                        <div className="border border-[#262933] bg-[#05070b]/95 overflow-x-auto">
                                            <table className="table-auto w-full text-[11px]">
                                                <thead className="text-[11px] uppercase tracking-wide text-slate-300">
                                                    <tr className="bg-[#14161d]">
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 w-16" />
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                                                            Product / Blueprint
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                            Runs needed
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                            Max runs / BPC
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                            BPCs needed
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                            Runs / BPC
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                            Copy span
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                            Mfg span
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                            BPOs you own
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                                                            Notes
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {components.map((bp) => {
                                                        const bpoCount = bpoCounts[bp.blueprintId] ?? bp.bpoCount ?? 1;
                                                        const isSmallJob =
                                                            !bp.copyPlanned &&
                                                            (bp.copyDisabledReason === 'noCopiesNeeded' ||
                                                                bp.copyDisabledReason === 'bpoEnoughForDirectRuns' ||
                                                                (bp.directRunsPerBpo ?? 0) > 0);

                                                        const rowBase =
                                                            'border border-[#2b2d33] ' +
                                                            'bg-[#090b11] hover:bg-[#141821]';

                                                        return (
                                                            <tr
                                                                key={bp.blueprintId}
                                                                className={`${rowBase}${bp.isCopyBottleneck
                                                                        ? ' bg-[#14100a] border-l-2 border-l-amber-400 border-t-amber-400 border-b-amber-400'
                                                                        : ''
                                                                    }`}
                                                            >
                                                                <td className="px-3 py-2 align-top">
                                                                    {bp.products[0]?.typeId ? (
                                                                        <img
                                                                            src={`https://image.eveonline.com/Type/${bp.products[0].typeId}_32.png`}
                                                                            alt={bp.products[0].typeName}
                                                                            className="w-10 h-10 rounded border border-[#303236] bg-black/40"
                                                                        />
                                                                    ) : (
                                                                        <div className="w-10 h-10 rounded border border-[#262933] bg-[#070910]" />
                                                                    )}
                                                                </td>
                                                                <td className="px-2 py-2 align-top">
                                                                    <div className="text-slate-100">
                                                                        {bp.products.length === 1
                                                                            ? bp.products[0].typeName
                                                                            : bp.products.map((p) => p.typeName).join(', ')}
                                                                    </div>
                                                                    <div className="text-[10px] text-slate-500">
                                                                        {bp.blueprintLabel} (#{bp.blueprintId})
                                                                    </div>
                                                                </td>
                                                                <td className="px-2 py-2 text-right align-top text-slate-100">
                                                                    {formatNumber(bp.runsNeeded)}
                                                                </td>
                                                                <td className="px-2 py-2 text-right align-top text-slate-100">
                                                                    {isSmallJob ? '—' : formatNumber(bp.maxRunsPerBpc)}
                                                                </td>
                                                                <td className="px-2 py-2 text-right align-top text-slate-100">
                                                                    {isSmallJob ? '—' : formatNumber(bp.copiesNeeded)}
                                                                </td>
                                                                <td className="px-2 py-2 text-right align-top text-slate-100">
                                                                    {bp.copyPlanned
                                                                        ? bp.runsPerCopyUnified != null
                                                                            ? formatNumber(bp.runsPerCopyUnified)
                                                                            : renderRunsPerCopy(bp.runsPerCopy)
                                                                        : isSmallJob && bp.directRunsPerBpo
                                                                            ? formatNumber(bp.directRunsPerBpo)
                                                                            : '—'}
                                                                </td>
                                                                <td className="px-2 py-2 text-right align-top">
                                                                    {bp.copyPlanned ? (
                                                                        <div className="text-slate-100">
                                                                            {formatDuration(bp.copySpanSeconds)}
                                                                        </div>
                                                                    ) : isSmallJob ? (
                                                                        <div className="text-[10px] text-slate-500">n/a</div>
                                                                    ) : (
                                                                        <div className="text-[10px] text-slate-500">
                                                                            not planned
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td className="px-2 py-2 text-right align-top">
                                                                    <div className="text-slate-100">
                                                                        {formatDuration(bp.mfgSpanSeconds)}
                                                                    </div>
                                                                    <div className="text-[10px] text-slate-500">
                                                                        with {bp.effectiveMfgParallelism ?? manufacturingSlots} slots
                                                                    </div>
                                                                </td>
                                                                <td className="px-2 py-2 text-right align-top">
                                                                    <input
                                                                        type="number"
                                                                        min={0}
                                                                        value={bpoCount}
                                                                        onChange={(e) =>
                                                                            handleBpoCountChange(
                                                                                bp.blueprintId,
                                                                                e.target.value
                                                                            )
                                                                        }
                                                                        className="w-20 bg-[#05070b] border border-[#303236] px-1.5 py-1 text-[11px] text-slate-100 text-right outline-none focus:border-[#53b6ff]"
                                                                    />
                                                                </td>
                                                                <td className="px-2 py-2 align-top text-[10px] text-slate-400 max-w-xs">
                                                                    {isSmallJob
                                                                        ? 'Job is small enough to run directly from your BPOs without tying up labs.'
                                                                        : bp.copyDisabledReason === 'bpoEnoughForDirectRuns'
                                                                            ? 'Run directly from your BPOs; max runs are split across owned originals.'
                                                                            : bp.isCopyBottleneck
                                                                                ? `Copy bottleneck – median copy span ${formatDuration(
                                                                                    bp.medianCopySpanSeconds ?? 0
                                                                                )}. Recommended BPOs: ${bp.recommendedBpoCountForMedian ?? '-'
                                                                                }`
                                                                                : bp.copyPlanned
                                                                                    ? 'Copies planned in labs.'
                                                                                    : '—'}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </section>

                                { }
                                {finalHulls.length > 0 && (
                                    <section className="border border-[#303236] bg-[#05070b]/90 px-3 py-2.5 space-y-2.5">
                                        <div className="flex items-center justify-between gap-2">
                                            <h2 className="text-[12px] font-semibold text-slate-100">
                                                Final hulls / products
                                            </h2>
                                            <p className="text-[10px] text-slate-500 max-w-md text-right">
                                                These use existing BPCs. Tell the tool how many BPCs you have, how many runs
                                                you put on each, and the TE of those BPCs. We&apos;ll estimate hull
                                                manufacturing span using your total manufacturing slots.
                                            </p>
                                        </div>
                                        <div className="border border-[#262933] bg-[#05070b]/95 overflow-x-auto">
                                            <table className="table-auto w-full text-[11px]">
                                                <thead className="text-[11px] uppercase tracking-wide text-slate-300">
                                                    <tr className="bg-[#14161d]">
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 w-16" />
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                                                            Product / Blueprint
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                            Runs needed
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                            BPCs you have
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                            TE
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                                                            Mfg span
                                                        </th>
                                                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                                                            Notes
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {finalHulls.map((bp) => {
                                                        const info = finalBpcs[bp.blueprintId];
                                                        const bpcCount = info?.bpcCount ?? 1;
                                                        const runsPerBpc = info?.runsPerBpc ?? bp.runsNeeded;

                                                        return (
                                                            <tr
                                                                key={bp.blueprintId}
                                                                className="border border-[#2b2d33] bg-[#090b11] hover:bg-[#141821]"
                                                            >
                                                                <td className="px-3 py-2 align-top">
                                                                    {bp.products[0]?.typeId ? (
                                                                        <img
                                                                            src={`https://image.eveonline.com/Type/${bp.products[0].typeId}_32.png`}
                                                                            alt={bp.products[0].typeName}
                                                                            className="w-10 h-10 rounded border border-[#303236] bg-black/40"
                                                                        />
                                                                    ) : (
                                                                        <div className="w-10 h-10 rounded border border-[#262933] bg-[#070910]" />
                                                                    )}
                                                                </td>
                                                                <td className="px-2 py-2 align-top">
                                                                    <div className="text-slate-100">
                                                                        {bp.products.length === 1
                                                                            ? bp.products[0].typeName
                                                                            : bp.products.map((p) => p.typeName).join(', ')}
                                                                    </div>
                                                                    <div className="text-[10px] text-slate-500">
                                                                        {bp.blueprintLabel} (#{bp.blueprintId})
                                                                    </div>
                                                                </td>
                                                                <td className="px-2 py-2 text-right align-top text-slate-100">
                                                                    {formatNumber(bp.runsNeeded)}
                                                                </td>
                                                                <td className="px-2 py-2 text-right align-top">
                                                                    <input
                                                                        type="number"
                                                                        min={1}
                                                                        value={bpcCount}
                                                                        onChange={(e) =>
                                                                            handleFinalBpcCountChange(
                                                                                bp.blueprintId,
                                                                                e.target.value
                                                                            )
                                                                        }
                                                                        className="w-20 bg-[#05070b] border border-[#303236] px-1.5 py-1 text-[11px] text-slate-100 text-right outline-none focus:border-[#53b6ff]"
                                                                    />
                                                                </td>
                                                                <td className="px-2 py-2 text-right align-top">
                                                                    <input
                                                                        type="number"
                                                                        min={0}
                                                                        max={20}
                                                                        value={info?.teLevel ?? 0}
                                                                        onChange={(e) =>
                                                                            handleFinalTeChange(
                                                                                bp.blueprintId,
                                                                                e.target.value
                                                                            )
                                                                        }
                                                                        className="w-16 bg-[#05070b] border border-[#303236] px-1.5 py-1 text-[11px] text-slate-100 text-right outline-none focus:border-[#53b6ff]"
                                                                    />
                                                                </td>
                                                                <td className="px-2 py-2 text-right align-top">
                                                                    <div className="text-slate-100">
                                                                        {computeFinalHullMfgSpan(bp)}
                                                                    </div>
                                                                    <div className="text-[10px] text-slate-500">
                                                                        with {bpcCount} BPCs (up to{' '}
                                                                        {Math.min(manufacturingSlots, bpcCount)} slots)
                                                                    </div>
                                                                </td>
                                                                <td className="px-2 py-2 align-top text-[10px] text-slate-400">
                                                                    Final hulls use existing BPCs only; copying is not
                                                                    scheduled here.
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </section>
                                )}

                                { }
                                {tree.length > 0 && (
                                    <section className="border border-[#303236] bg-[#05070b]/90 px-3 py-2.5 space-y-2">
                                        <h2 className="text-[12px] font-semibold text-slate-100">
                                            Build tree
                                        </h2>
                                        <p className="text-[10px] text-slate-500">
                                            Same build tree as the cost planner, trimmed to only show manufacturing
                                            steps. &quot;Buy X @ Y ISK&quot; leaves are hidden so the tree focuses on
                                            what you&apos;re actually building.
                                        </p>
                                        <div className="mt-1 space-y-0.5">{renderTreeNodes(tree)}</div>
                                    </section>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ManufacturingPlanner;
