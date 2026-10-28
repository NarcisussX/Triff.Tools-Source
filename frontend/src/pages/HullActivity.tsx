import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { classLabel, liquidityOptions, liquidityThreshold, matchesHullFilters, meetsLiquidity, parseSelection, roleOptions, sizeOptions } from './hullActivityFilters';

type Hull = {
    type_id: number;
    type_name: string;
    group_name: string;
    market_group_name: string | null;
    volume: number;
    avg_7d: number;
    vs_7d_pct: number | null;
    avg_30d: number;
    vs_30d_pct: number | null;
    avg_365d: number;
    vs_365d_pct: number | null;
    avg_last_7d: number;
    avg_prev_30d: number;
    vs_prev_30d_pct: number | null;
};
type Region = { region_id: number; region_name: string };
type Activity = Region & { date: string | null; available_dates: string[]; hulls: Hull[] };
type SortKey = Exclude<keyof Hull, 'type_id' | 'group_name' | 'market_group_name'>;
type Column = { key: SortKey; label: string; title: string };
const dailyColumns: Column[] = [
    { key: 'type_name', label: 'Hull', title: 'Published Ship types from the SDE' },
    { key: 'volume', label: 'Daily Volume', title: 'Units traded on the selected UTC date' },
    { key: 'avg_7d', label: '7d Avg', title: 'Daily average over the preceding 7 calendar days' },
    { key: 'vs_7d_pct', label: 'vs 7d', title: 'Daily volume deviation from the 7-day average' },
    { key: 'avg_30d', label: '30d Avg', title: 'Daily average over the preceding 30 calendar days' },
    { key: 'vs_30d_pct', label: 'vs 30d', title: 'Daily volume deviation from the 30-day average' },
    { key: 'avg_365d', label: '1y Avg', title: 'Daily average over the preceding 365 calendar days' },
    { key: 'vs_365d_pct', label: 'vs 1y', title: 'Daily volume deviation from the 365-day average' },
];
const weeklyColumns: Column[] = [
    { key: 'type_name', label: 'Hull', title: 'Published Ship types from the SDE' },
    { key: 'avg_last_7d', label: 'Last 7d Avg', title: 'Daily average over the 7 calendar days ending on the selected date (inclusive)' },
    { key: 'avg_prev_30d', label: 'Previous 30d Avg', title: 'Daily average over the 30 calendar days immediately before that week; no overlap' },
    { key: 'vs_prev_30d_pct', label: '7d vs prev 30d', title: 'Percentage change in daily average: (last 7d average − previous 30d average) / previous 30d average × 100' },
    { key: 'avg_365d', label: '1y Avg', title: 'Daily average over the preceding 365 calendar days' },
];

// Keep the established Market Browser table/control treatment local to this tool.
const panelBase = 'border border-[#2c2f36] bg-[#070910]';
const panelHeader = 'px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300';
const inputClass = 'bg-[#05070b] border border-[#303236] px-2 py-1.5 sm:py-0.5 text-[11px] text-slate-100 placeholder-slate-600 outline-none focus:border-[#53b6ff] focus:ring-0';
const selectClass = 'bg-[#05070b] border border-[#303236] px-2 py-1.5 sm:py-0.5 text-[11px] text-slate-100 outline-none focus:border-[#53b6ff] focus:ring-0';
const buttonBase = 'inline-flex items-center justify-center gap-1 border border-[#303236] bg-[#05070b] px-2 py-1 text-[10px] uppercase tracking-widest text-slate-300 hover:border-[#53b6ff]/60 hover:bg-[#101219] focus-visible:outline focus-visible:outline-[#53b6ff]';
const tableHead = 'p-0 border-b border-[#2b2d33] border-r border-[#262933] bg-[#14161d] text-slate-200 whitespace-nowrap';
const tableCell = 'px-2 py-1 border-r border-[#262933] align-middle';

async function readJson<T>(url: string, signal: AbortSignal): Promise<T> {
    const response = await fetch(url, { signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
}

function formatNumber(value: number | null, digits = 1) {
    return value === null || !Number.isFinite(value) ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function relativeDate(date: string, days: number) {
    const day = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(day.getTime())) return '—';
    day.setUTCDate(day.getUTCDate() + days);
    return day.toISOString().slice(0, 10);
}

export default function HullActivity() {
    const [params, setParams] = useSearchParams();
    const region = params.get('region_id') ?? '10000002';
    const date = params.get('date') ?? '';
    const search = params.get('q') ?? '';
    const minAverage = liquidityThreshold(params.get('min_365d'));
    const sizes = useMemo(() => parseSelection(params.get('sizes')), [params]);
    const classes = useMemo(() => parseSelection(params.get('classes')), [params]);
    const roles = useMemo(() => parseSelection(params.get('roles')), [params]);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const weekly = params.get('view') === 'weekly';
    const columns = weekly ? weeklyColumns : dailyColumns;
    const sort = columns.some((c) => c.key === params.get('sort')) ? params.get('sort') as SortKey : weekly ? 'vs_prev_30d_pct' : 'vs_30d_pct';
    const direction = params.get('dir') === 'asc' ? 'asc' : 'desc';
    const [regions, setRegions] = useState<Region[]>([]);
    const [data, setData] = useState<Activity | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const currentParams = useRef(params);
    const updateParams = useRef(setParams);
    currentParams.current = params;
    updateParams.current = setParams;

    useEffect(() => {
        const controller = new AbortController();
        readJson<{ regions: Region[] }>('/api/hulls/regions', controller.signal)
            .then((result) => setRegions(result.regions))
            .catch(() => { /* Activity request supplies the selected region and the visible error. */ });
        return () => controller.abort();
    }, [retry]);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError('');
        const query = new URLSearchParams({ region_id: region });
        if (date) query.set('date', date);
        readJson<Activity>(`/api/hulls/activity?${query}`, controller.signal)
            .then((result) => {
                if (controller.signal.aborted) return;
                setData(result);
                // Resolve implicit defaults into a copyable URL without creating a Back entry.
                const next = new URLSearchParams(currentParams.current);
                next.set('region_id', String(result.region_id));
                if (result.date) next.set('date', result.date);
                if (next.toString() !== currentParams.current.toString()) updateParams.current(next, { replace: true });
            })
            .catch((err: Error) => {
                if (!controller.signal.aborted) { setData(null); setError(err.message); }
            })
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [region, date, retry]);

    function change(values: Record<string, string | null>, replace = false) {
        const next = new URLSearchParams(currentParams.current);
        for (const [key, value] of Object.entries(values)) {
            if (value === null || value === '') next.delete(key); else next.set(key, value);
        }
        currentParams.current = next;
        updateParams.current(next, { replace });
    }

    function toggleFilter(key: string, value: string) {
        const selected = parseSelection(currentParams.current.get(key));
        change({ [key]: (selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]).sort().join(',') });
    }

    const classOptions = useMemo(() => [...new Set(data?.hulls.map((hull) => hull.group_name) ?? [])].sort((a, b) => classLabel(a).localeCompare(classLabel(b))), [data]);
    const filterCount = sizes.length + classes.length + roles.length;

    const rows = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        return (data?.hulls ?? []).filter((h) => h.type_name.toLocaleLowerCase().includes(query) && matchesHullFilters(h, sizes, classes, roles) && meetsLiquidity(h.avg_365d, minAverage)).sort((a, b) => {
            const left = a[sort];
            const right = b[sort];
            // Undefined comparisons always sort last, in either direction.
            if (left === null || right === null) return left === right ? a.type_name.localeCompare(b.type_name) : left === null ? 1 : -1;
            const order = typeof left === 'string' ? left.localeCompare(String(right)) : left - Number(right);
            return (direction === 'asc' ? order : -order) || a.type_name.localeCompare(b.type_name) || a.type_id - b.type_id;
        });
    }, [data, search, sort, direction, sizes, classes, roles, minAverage]);

    const sameRegion = String(data?.region_id) === region;
    const dates = sameRegion ? data?.available_dates ?? [] : [];
    const regionOptions = regions.length ? regions : [{ region_id: Number(region), region_name: data?.region_name || (region === '10000002' ? 'The Forge' : `Region ${region}`) }];

    return (
        <div className="mx-auto h-[calc(100dvh-3rem)] w-full max-w-[816px] min-w-0 overflow-hidden px-1 py-2 text-[11px] leading-snug text-slate-100 sm:px-2 sm:py-6">
            <div className="flex h-full min-h-0 min-w-0 flex-col border border-[#3a3c40] bg-[#05070b]/95 shadow-[0_0_32px_rgba(0,0,0,0.95)]">
                <div className="flex items-center justify-between gap-2 border-b border-[#2c2f36] bg-[#101219] px-3 py-2">
                    <h1 className="text-[15px] font-semibold">Hull Activity</h1>
                    <span className="text-[10px] text-slate-500">Regional market history</span>
                </div>
                <div className="grid grid-cols-2 items-end gap-2 border-b border-[#262933] px-2 py-2 sm:grid-cols-[1fr_150px_1.2fr]">
                    <label className="flex min-w-0 flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-widest text-slate-500">Region</span>
                        <select aria-label="Region" className={`${selectClass} w-full min-w-0`} value={region} onChange={(e) => change({ region_id: e.target.value, date: null })}>
                            {!regionOptions.some((r) => String(r.region_id) === region) && <option value={region}>Region {region}</option>}
                            {regionOptions.map((r) => <option key={r.region_id} value={r.region_id}>{r.region_name}</option>)}
                        </select>
                    </label>
                    <label className="flex min-w-0 flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-widest text-slate-500">Date / UTC</span>
                        <select aria-label="Date" className={`${selectClass} w-full min-w-0`} value={date} disabled={loading || !dates.length} onChange={(e) => change({ date: e.target.value })}>
                            {!dates.includes(date) && <option value={date}>{date || (loading ? 'Loading…' : 'No history')}</option>}
                            {dates.map((day) => <option key={day} value={day}>{day}</option>)}
                        </select>
                    </label>
                    <label className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
                        <span className="text-[10px] uppercase tracking-widest text-slate-500">Hull search</span>
                        <input aria-label="Hull search" type="search" className={`${inputClass} w-full`} placeholder="Filter by hull name…" value={search} onChange={(e) => change({ q: e.target.value }, true)} />
                    </label>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[#262933] px-2 py-1.5">
                    <button className={buttonBase} aria-expanded={filtersOpen} aria-controls="hull-filters" onClick={() => setFiltersOpen(!filtersOpen)}>Ship filters{filterCount ? ` (${filterCount})` : ''} {filtersOpen ? '−' : '+'}</button>
                    <span className="ml-1 text-[10px] text-slate-500">Show:</span>
                    {roleOptions.map((role) => <button key={role.id} title={role.title} aria-pressed={roles.includes(role.id)} className={`${buttonBase} ${roles.includes(role.id) ? 'border-[#53b6ff] bg-[#101b27] text-[#9dd8ff]' : ''}`} onClick={() => toggleFilter('roles', role.id)}>{role.label}</button>)}
                    {filterCount > 0 && <button className={`${buttonBase} ml-auto`} onClick={() => change({ sizes: null, classes: null, roles: null })}>Clear filters</button>}
                </div>
                <label className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#262933] px-2 py-1.5">
                    <span className="text-[10px] uppercase tracking-widest text-slate-400">Minimum 1y avg</span>
                    <select aria-label="Minimum 1y average" className={selectClass} value={minAverage} onChange={(e) => change({ min_365d: e.target.value })}>{liquidityOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
                    <span className="text-[10px] text-slate-500">Filters out rarely traded hulls.</span>
                </label>
                {filtersOpen && <div id="hull-filters" className="max-h-[32vh] shrink-0 overflow-y-auto border-b border-[#262933] bg-[#070910] px-2 py-2">
                    <p className="mb-2 text-[10px] text-slate-500">Select any within a section; sections combine. Nothing selected = all hulls.</p>
                    <fieldset className="mb-2"><legend className="mb-1 text-[10px] uppercase tracking-widest text-slate-400">Ship size / family</legend>
                        <div className="flex flex-wrap gap-x-3 gap-y-1">{sizeOptions.map(([id, label]) => <label key={id} className="flex cursor-pointer items-center gap-1.5 py-1 sm:py-0"><input type="checkbox" className="accent-[#53b6ff]" checked={sizes.includes(id)} onChange={() => toggleFilter('sizes', id)} />{label}</label>)}</div>
                    </fieldset>
                    <fieldset><legend className="mb-1 text-[10px] uppercase tracking-widest text-slate-400">Ship class</legend>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">{classOptions.map((group) => <label key={group} className="flex cursor-pointer items-center gap-1.5 py-1 sm:py-0"><input type="checkbox" className="shrink-0 accent-[#53b6ff]" checked={classes.includes(group)} onChange={() => toggleFilter('classes', group)} />{classLabel(group)}</label>)}</div>
                    </fieldset>
                </div>}
                <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[#262933] px-2 py-1.5" role="group" aria-label="Activity comparison">
                    <span className="mr-1 text-[10px] uppercase tracking-widest text-slate-400">Compare</span>
                    {([[false, 'Daily'], [true, '7-day trend']] as const).map(([isWeekly, label]) => <button key={label} className={`${buttonBase} ${weekly === isWeekly ? 'border-[#53b6ff] bg-[#101b27] text-[#9dd8ff]' : ''}`} aria-pressed={weekly === isWeekly} onClick={() => { if (weekly !== isWeekly) change({ view: isWeekly ? 'weekly' : null, sort: null, dir: null }); }}>{label}</button>)}
                </div>
                {weekly && date && <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-0.5 border-b border-[#262933] px-2 py-1 text-[10px] text-slate-400">
                    <span>Last 7d: {relativeDate(date, -6)} – {date}</span>
                    <span>Previous 30d: {relativeDate(date, -36)} – {relativeDate(date, -7)}</span>
                </div>}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col p-1">
                    <section className={`${panelBase} flex min-h-0 min-w-0 flex-1 flex-col`} aria-label="Hull activity results" aria-busy={loading}>
                        <div className={`${panelHeader} flex flex-wrap justify-between gap-x-3 gap-y-1`}>
                            <span>{loading ? 'Loading hull activity…' : `${rows.length} / ${data?.hulls.length ?? 0} hulls`}</span>
                            <span className="text-slate-500">Units / day · <span className="sm:hidden">Scroll table →</span><span className="hidden sm:inline">Click a column to sort</span></span>
                        </div>
                        {error ? <div role="alert" className="px-3 py-4 text-[#ff8b8b]">{error}<div className="mt-2 flex gap-2"><button className={buttonBase} onClick={() => setRetry((n) => n + 1)}>Retry</button><button className={buttonBase} onClick={() => change({ region_id: '10000002', date: null })}>Latest / The Forge</button></div></div> :
                            <div className="min-h-0 min-w-0 flex-1 overflow-auto scrollbar-thin scrollbar-track-[#05070b] scrollbar-thumb-[#252836]" tabIndex={0} role="region" aria-label="Scrollable hull activity table">
                                <table className={`w-full ${weekly ? 'min-w-[640px]' : 'min-w-[752px]'} table-fixed border-collapse text-[11px]`}>
                                    <thead className="sticky top-0 z-10"><tr>{columns.map((column) => <th key={column.key} scope="col" className={`${tableHead} ${column.key === 'type_name' ? 'sticky left-0 z-20 w-[210px] text-left' : column.key === 'volume' ? 'w-[92px] text-right' : 'text-right'}`} aria-sort={sort === column.key ? direction === 'asc' ? 'ascending' : 'descending' : 'none'}>
                                        <button className="w-full px-1.5 py-2 text-inherit [text-align:inherit] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#53b6ff] sm:py-1" title={column.title} onClick={() => change({ sort: column.key, dir: sort === column.key && direction === 'desc' ? 'asc' : 'desc' })}>{column.label}<span className="ml-0.5 text-[#53b6ff]">{sort === column.key ? direction === 'asc' ? '↑' : '↓' : ''}</span></button>
                                    </th>)}</tr></thead>
                                    <tbody>{loading ? <tr><td colSpan={columns.length} className="px-3 py-4 text-slate-400">Loading hull activity…</td></tr> : rows.length === 0 ? <tr><td colSpan={columns.length} className="px-3 py-4 text-slate-400">{data?.date ? 'No hulls match the current search or filters.' : 'No complete market history is available for this region.'}</td></tr> : rows.map((row, i) => <tr key={row.type_id} className={`${i % 2 === 0 ? 'bg-[#090b11]' : 'bg-[#0c0f16]'} border-b border-[#2b2d33]/70 hover:bg-[#141821]`}>
                                        <td className={`${tableCell} sticky left-0 z-[1] bg-inherit`}><div className="flex min-w-0 items-center gap-2" title={`${row.type_name} · ${classLabel(row.group_name)}`}><img src={`https://images.evetech.net/types/${row.type_id}/icon?size=32`} className="h-5 w-5 shrink-0" alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /><a className="truncate text-slate-200 hover:text-[#53b6ff] focus-visible:outline focus-visible:outline-[#53b6ff]" href={`/items/${row.type_id}`}>{row.type_name}</a></div></td>
                                        {columns.slice(1).map((column) => {
                                            const value = row[column.key] as number | null;
                                            const percent = column.key.startsWith('vs_');
                                            const valid = value !== null && Number.isFinite(value);
                                            return <td key={column.key} className={`${tableCell} whitespace-nowrap text-right font-mono ${percent && valid && value !== 0 ? value > 0 ? 'text-[#3bbf5a]' : 'text-[#ff8b8b]' : 'text-slate-300'}`} title={percent && !valid ? 'No volume in this baseline; percentage is undefined' : undefined}>{percent ? valid ? `${value > 0 ? '+' : ''}${formatNumber(value, 0)}%` : '—' : formatNumber(value, column.key === 'volume' ? 0 : 1)}</td>;
                                        })}
                                    </tr>)}</tbody>
                                </table>
                            </div>}
                    </section>
                </div>
                <div className="border-t border-[#262933] px-2 py-1 text-[10px] text-slate-500">{weekly ? 'Week includes the selected day; previous 30d ends before the week.' : 'Baselines exclude the selected day.'} Missing days = 0. <span className="whitespace-nowrap">— = zero baseline.</span></div>
            </div>
        </div>
    );
}
