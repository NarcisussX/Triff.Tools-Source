/*
 * React page for /wh-structure-stats.
 * Runs cached WH structure loss scans and displays attacker corp/alliance stats.
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Download,
  ExternalLink,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { ToolChrome } from "../components/tool-ui";

type StructureType = {
  type_id: number;
  name: string;
  enabled_default: boolean;
};

type ProgressState = {
  phase?: string;
  status?: string;
  currentMonth?: string | null;
  currentType?: { type_id: number; name: string } | null;
  currentPage?: number | null;
  zkillRequests?: number;
  candidatesFound?: number;
  candidatesToHydrate?: number;
  hydrated?: number;
  skipped?: number;
  skipReasons?: Record<string, number>;
  errors?: string[];
  percent?: number;
  warning?: string | null;
};

type JobResponse = {
  jobId: string;
  status: "queued" | "running" | "done" | "error" | string;
  progress?: ProgressState;
  error?: string | null;
};

type WindowResponse = {
  window: {
    startDate: string;
    endDate: string;
    days: number;
  };
  dailyRefresh: {
    days: number;
    utcHour: number;
    disabled: boolean;
  };
  activeJob?: JobResponse | null;
};

type SummaryRow = {
  entityId: number;
  entityName: string;
  structureKillsOn: number;
  uniqueJcodes: number;
  lowClassEvictions: number;
  uniqueVictimCorps: number;
  totalValue: number;
  structureTypes: Record<string, number>;
  lastSeen: string | null;
};

type SummaryResponse = {
  range: { startDate: string; endDate: string; typeIds: number[] };
  groupBy: GroupBy;
  totals: {
    structureKills: number;
    uniqueJcodes: number;
    lowClassEvictions: number;
    uniqueVictimCorps: number;
    totalValue: number;
  };
  rows: SummaryRow[];
};

type KillRow = {
  killmail_id: number;
  killmail_time: string;
  jcode: string | null;
  wormhole_class: string | null;
  is_low_class: boolean;
  solar_system_id: number;
  structure_type_name: string;
  victim_corporation_id: number | null;
  victim_corporation_name: string | null;
  victim_alliance_id: number | null;
  victim_alliance_name: string | null;
  zkb_total_value: number;
  attackers_count_for_entity: number;
  damage_done_for_entity: number;
  final_blow_for_entity: boolean;
  zkillUrl: string;
};

type GroupBy = "corporation" | "alliance";
type SortKey =
  | "entityName"
  | "structureKillsOn"
  | "uniqueJcodes"
  | "lowClassEvictions"
  | "uniqueVictimCorps"
  | "totalValue"
  | "lastSeen";

const inputClass =
  "w-full border border-[#303236] bg-[#05070b] px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-[#53b6ff] focus:ring-0";

const buttonClass =
  "inline-flex items-center justify-center gap-2 border border-[#3a3c40] bg-[#101219] px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-100 transition hover:border-[#53b6ff]/70 hover:bg-[#151a24] disabled:cursor-not-allowed disabled:opacity-50";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

function fmtIsk(value?: number) {
  const n = Number(value || 0);
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(n >= 10_000_000_000_000 ? 1 : 2)}T`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 1 : 2)}b`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function fmtNum(value?: number) {
  return Number(value || 0).toLocaleString();
}

function fmtDateTime(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toISOString().replace("T", " ").slice(0, 16);
}

async function api<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (opts.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(url, {
    cache: "no-store",
    ...opts,
    headers,
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const message =
      json && typeof json === "object" && "error" in json
        ? String((json as { error?: string }).error || "")
        : text;
    throw new Error(message || `HTTP ${res.status}`);
  }
  return json as T;
}

function selectedTypeQuery(typeIds: number[]) {
  return typeIds.join(",");
}

function csvEscape(value: unknown) {
  const raw = String(value ?? "");
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-[#2c2f36] bg-[#070910] px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 text-[15px] font-semibold leading-none text-slate-100">{value}</div>
      {sub ? <div className="mt-1 text-[10px] text-slate-500">{sub}</div> : null}
    </div>
  );
}

function prettyReason(reason: string) {
  const labels: Record<string, string> = {
    outside_date_range: "Outside exact date range",
    esi_not_found: "ESI not found",
    hydrate_error: "Hydration errors",
    type_outside_selection: "Different victim type",
    missing_killmail_time: "Missing killmail time",
    missing_solar_system: "Missing system",
    not_known_wormhole_system: "System not in local WH map",
    empty_esi: "Empty ESI response",
  };
  return labels[reason] || reason.replace(/_/g, " ");
}

function SortHead({
  label,
  sortKey,
  active,
  asc,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  asc: boolean;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th
      className="cursor-pointer whitespace-nowrap border border-[#2b2d33] bg-[#14161d] px-2 py-1 text-left font-medium hover:text-[#53b6ff]"
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active === sortKey ? <span className="text-[9px] text-[#53b6ff]">{asc ? "asc" : "desc"}</span> : null}
      </span>
    </th>
  );
}

export default function WormholeStructureStats() {
  const [types, setTypes] = useState<StructureType[]>([]);
  const [selectedTypeIds, setSelectedTypeIds] = useState<number[]>([]);
  const [startDate, setStartDate] = useState(daysAgo(30));
  const [endDate, setEndDate] = useState(today());
  const [groupBy, setGroupBy] = useState<GroupBy>("corporation");

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [windowMeta, setWindowMeta] = useState<WindowResponse | null>(null);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [minKills, setMinKills] = useState(1);
  const [structureFilter, setStructureFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("structureKillsOn");
  const [sortAsc, setSortAsc] = useState(false);

  const [selectedRow, setSelectedRow] = useState<SummaryRow | null>(null);
  const [kills, setKills] = useState<KillRow[]>([]);
  const [killsLoading, setKillsLoading] = useState(false);
  const [killsError, setKillsError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoadingTypes(true);
    Promise.all([
      api<{ types: StructureType[] }>("/api/wh-structure-stats/types"),
      api<WindowResponse>("/api/wh-structure-stats/window"),
    ])
      .then(([data, windowData]) => {
        if (!alive) return;
        setTypes(data.types || []);
        setSelectedTypeIds(
          (data.types || [])
            .filter((type) => type.enabled_default)
            .map((type) => type.type_id)
        );
        setWindowMeta(windowData);
        if (windowData?.window) {
          setStartDate((value) => value < windowData.window.startDate ? windowData.window.startDate : value);
          setEndDate((value) => value > windowData.window.endDate ? windowData.window.endDate : value);
          if (windowData.activeJob) setJob(windowData.activeJob);
        }
      })
      .catch((err) => {
        if (alive) setError(err.message || "Failed to load structure types");
      })
      .finally(() => {
        if (alive) setLoadingTypes(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (structureFilter === "all") return;
    const stillSelected = types.some(
      (type) => selectedTypeIds.includes(type.type_id) && type.name === structureFilter
    );
    if (!stillSelected) setStructureFilter("all");
  }, [selectedTypeIds, structureFilter, types]);

  const selectedTypeNames = useMemo(
    () => types.filter((type) => selectedTypeIds.includes(type.type_id)).map((type) => type.name),
    [selectedTypeIds, types]
  );

  const progress = job?.progress || {};
  const canRequest = selectedTypeIds.length > 0 && startDate && endDate;

  const loadSummary = async () => {
    setError("");
    setLoadingSummary(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        typeIds: selectedTypeQuery(selectedTypeIds),
        groupBy,
      });
      const data = await api<SummaryResponse>(`/api/wh-structure-stats/summary?${params.toString()}`);
      setSummary(data);
    } catch (err: any) {
      setError(err.message || "Failed to load summary");
    } finally {
      setLoadingSummary(false);
    }
  };

  const toggleType = (typeId: number) => {
    setSelectedTypeIds((prev) => {
      if (prev.includes(typeId)) {
        return prev.length === 1 ? prev : prev.filter((id) => id !== typeId);
      }
      return [...prev, typeId].sort((a, b) => a - b);
    });
  };

  const sortRows = (rows: SummaryRow[]) => {
    return [...rows].sort((a, b) => {
      const av =
        sortKey === "entityName"
          ? a.entityName.toLowerCase()
          : sortKey === "lastSeen"
            ? Date.parse(a.lastSeen || "") || 0
            : Number(a[sortKey] || 0);
      const bv =
        sortKey === "entityName"
          ? b.entityName.toLowerCase()
          : sortKey === "lastSeen"
            ? Date.parse(b.lastSeen || "") || 0
            : Number(b[sortKey] || 0);

      if (typeof av === "string" && typeof bv === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
    });
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = summary?.rows || [];
    return sortRows(
      rows.filter((row) => {
        const haystack = [row.entityName, row.entityId].join(" ").toLowerCase();
        if (q && !haystack.includes(q)) return false;
        if (row.structureKillsOn < minKills) return false;
        if (structureFilter !== "all" && !Number(row.structureTypes?.[structureFilter] || 0)) return false;
        return true;
      })
    );
  }, [summary, search, minKills, structureFilter, sortKey, sortAsc]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(key === "entityName");
    }
  };

  const exportCsv = () => {
    const firstLabel = groupBy === "corporation" ? "Corporation" : "Alliance";
    const headers = [
      "Rank",
      firstLabel,
      "Entity ID",
      "Structure kills on",
      "Unique J-codes",
      "Low-class J-codes",
      "Victim corps hit",
      "Total value",
      "Last seen",
    ];
    const body = filteredRows.map((row, idx) => [
      idx + 1,
      row.entityName,
      row.entityId,
      row.structureKillsOn,
      row.uniqueJcodes,
      row.lowClassEvictions,
      row.uniqueVictimCorps,
      row.totalValue,
      row.lastSeen || "",
    ]);
    const csv = [headers, ...body].map((line) => line.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wh-structure-stats-${startDate}-${endDate}-${groupBy}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openDrilldown = async (row: SummaryRow) => {
    setSelectedRow(row);
    setKills([]);
    setKillsError("");
    setKillsLoading(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        typeIds: selectedTypeQuery(selectedTypeIds),
      });
      const data = await api<{ kills: KillRow[] }>(
        `/api/wh-structure-stats/entity/${groupBy}/${row.entityId}/kills?${params.toString()}`
      );
      setKills(data.kills || []);
    } catch (err: any) {
      setKillsError(err.message || "Failed to load kill drilldown");
    } finally {
      setKillsLoading(false);
    }
  };

  return (
    <div className="tt-tool-v2 tt2-reference-page tt2-structure-stats min-h-screen leading-snug text-slate-100">
      <div className="mx-auto max-w-[1320px] px-2 py-3 sm:px-4 sm:py-6">
        <div className="tt2-window">
          <ToolChrome
            section="Wormhole Intel"
            title="WH Structure Stats"
            badge="J-Space"
            context="Cached Structure Losses"
            status="Server cache online"
          />

          <div className="space-y-4 p-2 sm:p-3">
            <div className="border border-[#262933] bg-[#05070b]/90 px-3 py-3 sm:px-4">
              <p className="mb-1 text-[12px] text-slate-300">
                Track wormhole Upwell structure kills by attacker corporation or alliance.
              </p>
              <p className="text-[12px] text-slate-400">
                Results are loaded from the local cached dataset and can be filtered by date, structure type, and entity view.
              </p>
            </div>

        <section className="overflow-hidden border border-[#2c2f36] bg-[#070910]">
          <div className="border-b border-[#2c2f36] bg-[#101219] px-2 py-1 text-[10px] uppercase tracking-widest text-slate-300">
            Stats Filters
          </div>
          <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[190px_190px_1fr_190px]">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">Start date</span>
              <input
                className={inputClass}
                type="date"
                min={windowMeta?.window.startDate}
                max={windowMeta?.window.endDate}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">End date</span>
              <input
                className={inputClass}
                type="date"
                min={windowMeta?.window.startDate}
                max={windowMeta?.window.endDate}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>

            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-widest text-slate-500">Structure types</span>
                <span className="text-[10px] text-slate-600">{selectedTypeIds.length} selected</span>
              </div>
              <div className="grid grid-cols-2 gap-1 border border-[#303236] bg-[#05070b] p-2 md:grid-cols-3">
                {loadingTypes ? (
                  <div className="col-span-full text-slate-500">Loading types...</div>
                ) : (
                  types.map((type) => (
                    <label key={type.type_id} className="flex items-center gap-2 text-[11px] text-slate-300">
                      <input
                        type="checkbox"
                        checked={selectedTypeIds.includes(type.type_id)}
                        onChange={() => toggleType(type.type_id)}
                        className="h-3.5 w-3.5 accent-[#53b6ff]"
                      />
                      <span className="truncate" title={`${type.name} (${type.type_id})`}>
                        {type.name}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">Group by</div>
                <div className="grid grid-cols-2 border border-[#303236] bg-[#070910] p-0.5">
                  {(["corporation", "alliance"] as GroupBy[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setGroupBy(mode)}
                      className={`px-2 py-1.5 text-[11px] font-semibold uppercase tracking-widest ${
                        groupBy === mode
                          ? "bg-[#53b6ff] text-[#061018]"
                          : "text-slate-300 hover:bg-[#101219]"
                      }`}
                    >
                      {mode === "corporation" ? "Corp" : "Alliance"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#262933] px-2 py-2">
            <div className="flex flex-wrap gap-2">
              <button className={buttonClass} onClick={loadSummary} disabled={!canRequest || loadingSummary}>
                {loadingSummary ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Load Stats
              </button>
            </div>
          </div>
        </section>

        {error ? (
          <div className="border border-[#bf3b3b] bg-[#19080a] px-3 py-2 text-[12px] text-[#ff6666]">
            {error}
          </div>
        ) : null}

        {job ? (
          <section className="border border-[#303236] bg-[#05070b]/95">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#303236] bg-[#101219] px-3 py-1.5">
              <div className="text-[10px] uppercase tracking-widest text-slate-300">
                Job {job.jobId}
              </div>
              <div className="font-mono text-[11px] text-[#53b6ff]">{job.status}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3 text-[11px] md:grid-cols-6">
              <div>
                <div className="text-slate-500">Phase</div>
                <div className="text-slate-200">{progress.phase || "-"}</div>
              </div>
              <div>
                <div className="text-slate-500">Month</div>
                <div className="text-slate-200">{progress.currentMonth || "-"}</div>
              </div>
              <div>
                <div className="text-slate-500">Type</div>
                <div className="truncate text-slate-200">{progress.currentType?.name || "-"}</div>
              </div>
              <div>
                <div className="text-slate-500">Candidates</div>
                <div className="text-slate-200">{fmtNum(progress.candidatesFound)}</div>
              </div>
              <div>
                <div className="text-slate-500">Hydrated</div>
                <div className="text-slate-200">{fmtNum(progress.hydrated)}</div>
              </div>
              <div>
                <div className="text-slate-500">Skipped / Errors</div>
                <div className="text-slate-200">
                  {fmtNum(progress.skipped)} / {fmtNum(progress.errors?.length)}
                </div>
              </div>
            </div>
            <div className="px-3 pb-3">
              <div className="h-2 overflow-hidden border border-[#262933] bg-[#070910]">
                <div
                  className="h-full bg-[#53b6ff]"
                  style={{ width: `${Math.max(0, Math.min(100, Number(progress.percent || 0)))}%` }}
                />
              </div>
              {progress.skipReasons && Object.keys(progress.skipReasons).length ? (
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-slate-400">
                  {Object.entries(progress.skipReasons)
                    .sort((a, b) => Number(b[1]) - Number(a[1]))
                    .map(([reason, count]) => (
                      <span key={reason} className="border border-[#303236] bg-[#070910] px-2 py-0.5">
                        {prettyReason(reason)}: <span className="text-slate-100">{fmtNum(count)}</span>
                      </span>
                    ))}
                </div>
              ) : null}
              {progress.warning ? <div className="mt-2 text-[11px] text-[#d9c08a]">{progress.warning}</div> : null}
              {progress.errors?.length ? (
                <div className="mt-2 max-h-24 overflow-y-auto border border-[#4f2c2c] bg-[#12080a] p-2 text-[11px] text-[#ff9999]">
                  {progress.errors.map((line, idx) => (
                    <div key={`${line}-${idx}`}>{line}</div>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <StatCard label="Structure kills found" value={fmtNum(summary?.totals.structureKills)} />
          <StatCard label="Unique J-codes" value={fmtNum(summary?.totals.uniqueJcodes)} />
          <StatCard label="Low-class J-codes" value={fmtNum(summary?.totals.lowClassEvictions)} />
          <StatCard label="Victim corps" value={fmtNum(summary?.totals.uniqueVictimCorps)} />
          <StatCard label="ISK destroyed" value={fmtIsk(summary?.totals.totalValue)} />
          <StatCard label="Date range" value={summary ? `${summary.range.startDate} / ${summary.range.endDate}` : `${startDate} / ${endDate}`} />
        </div>

        <section className="overflow-hidden border border-[#2c2f36] bg-[#070910]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2c2f36] bg-[#101219] px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-widest text-slate-300">
              Leaderboard
            </div>
            <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
              <label className="relative w-full sm:w-auto">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  className={`${inputClass} w-full pl-7 sm:w-56`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or ID"
                />
              </label>
              <label className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-[11px] text-slate-400">
                Min kills
                <input
                  className={`${inputClass} w-full sm:w-20`}
                  type="number"
                  min={1}
                  value={minKills}
                  onChange={(e) => setMinKills(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
              <select
                className={`${inputClass} w-full sm:w-44`}
                value={structureFilter}
                onChange={(e) => setStructureFilter(e.target.value)}
              >
                <option value="all">All structures</option>
                {selectedTypeNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <button className={buttonClass} onClick={exportCsv} disabled={!filteredRows.length}>
                <Download className="h-3.5 w-3.5" />
                CSV
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] border-collapse text-[11px]">
              <thead className="bg-[#14161d] text-slate-200">
                <tr>
                  <th className="border border-[#2b2d33] px-2 py-1.5 text-left">Rank</th>
                  <SortHead label={groupBy === "corporation" ? "Corporation" : "Alliance"} sortKey="entityName" active={sortKey} asc={sortAsc} onSort={onSort} />
                  <SortHead label="Structure kills on" sortKey="structureKillsOn" active={sortKey} asc={sortAsc} onSort={onSort} />
                  <SortHead label="Unique J-codes" sortKey="uniqueJcodes" active={sortKey} asc={sortAsc} onSort={onSort} />
                  <SortHead label="Low-class J-codes" sortKey="lowClassEvictions" active={sortKey} asc={sortAsc} onSort={onSort} />
                  <SortHead label="Victim corps hit" sortKey="uniqueVictimCorps" active={sortKey} asc={sortAsc} onSort={onSort} />
                  <SortHead label="Total value" sortKey="totalValue" active={sortKey} asc={sortAsc} onSort={onSort} />
                  <SortHead label="Last seen" sortKey="lastSeen" active={sortKey} asc={sortAsc} onSort={onSort} />
                  <th className="border border-[#2b2d33] px-2 py-1.5 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!summary ? (
                  <tr>
                    <td className="border border-[#2b2d33] px-3 py-8 text-center text-slate-500" colSpan={9}>
                      No cached results loaded yet. Load stats for the selected range.
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td className="border border-[#2b2d33] px-3 py-8 text-center text-slate-500" colSpan={9}>
                      No rows match this range and filter set.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, idx) => (
                    <tr key={`${row.entityId}-${idx}`} className={idx % 2 ? "bg-[#090b11] hover:bg-[#141821]" : "bg-[#0c0f16] hover:bg-[#141821]"}>
                      <td className="border border-[#2b2d33] px-2 py-1.5 text-slate-500">{idx + 1}</td>
                      <td className="border border-[#2b2d33] px-2 py-1.5">
                        <div className="max-w-[260px] truncate text-slate-100" title={row.entityName}>
                          {row.entityName}
                        </div>
                        <div className="font-mono text-[10px] text-slate-600">{row.entityId}</div>
                      </td>
                      <td className="border border-[#2b2d33] px-2 py-1.5 text-slate-100">{fmtNum(row.structureKillsOn)}</td>
                      <td className="border border-[#2b2d33] px-2 py-1.5">{fmtNum(row.uniqueJcodes)}</td>
                      <td className="border border-[#2b2d33] px-2 py-1.5 text-[#ffcf8a]">{fmtNum(row.lowClassEvictions)}</td>
                      <td className="border border-[#2b2d33] px-2 py-1.5">{fmtNum(row.uniqueVictimCorps)}</td>
                      <td className="border border-[#2b2d33] px-2 py-1.5 text-[#ffb073]">{fmtIsk(row.totalValue)}</td>
                      <td className="border border-[#2b2d33] px-2 py-1.5 font-mono text-slate-400">{fmtDateTime(row.lastSeen)}</td>
                      <td className="border border-[#2b2d33] px-2 py-1.5">
                        <button className={buttonClass} onClick={() => openDrilldown(row)}>
                          Details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
          </div>
        </div>
      </div>

      {selectedRow ? createPortal(
        <div className="tt-tool-v2 fixed inset-0 z-[100] bg-black/75">
          <div className="absolute left-1/2 top-1/2 flex max-h-[calc(100vh-24px)] w-[calc(100vw-24px)] max-w-6xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden border border-[#303236] bg-[#05070b] shadow-[0_0_32px_rgba(0,0,0,0.9)]">
            <div className="flex flex-none items-center justify-between border-b border-[#303236] bg-gradient-to-r from-[#111319] via-[#171920] to-[#242833] px-3 py-2">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Kill Drilldown</div>
                <div className="text-[14px] font-semibold text-slate-100">{selectedRow.entityName}</div>
              </div>
              <button
                className="flex h-7 w-7 items-center justify-center border border-[#3a3c40] bg-[#05070b] text-slate-200 hover:border-[#bf3b3b] hover:text-white"
                onClick={() => setSelectedRow(null)}
                aria-label="Close drilldown"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              {killsLoading ? (
                <div className="flex items-center gap-2 p-6 text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading killmails...
                </div>
              ) : killsError ? (
                <div className="border border-[#bf3b3b] bg-[#19080a] px-3 py-2 text-[#ff6666]">{killsError}</div>
              ) : kills.length === 0 ? (
                <div className="p-6 text-center text-slate-500">No killmail drilldown rows found for this filter.</div>
              ) : (
                <table className="w-full min-w-[980px] border-collapse text-[11px]">
                  <thead className="bg-[#14161d] text-slate-200">
                    <tr>
                      <th className="border border-[#2b2d33] px-2 py-1.5 text-left">Time</th>
                      <th className="border border-[#2b2d33] px-2 py-1.5 text-left">J-code / Class</th>
                      <th className="border border-[#2b2d33] px-2 py-1.5 text-left">Structure</th>
                      <th className="border border-[#2b2d33] px-2 py-1.5 text-left">Victim corp / alliance</th>
                      <th className="border border-[#2b2d33] px-2 py-1.5 text-left">Value</th>
                      <th className="border border-[#2b2d33] px-2 py-1.5 text-left">Damage</th>
                      <th className="border border-[#2b2d33] px-2 py-1.5 text-left">Final blow</th>
                      <th className="border border-[#2b2d33] px-2 py-1.5 text-left">zKill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kills.map((kill, idx) => (
                      <tr key={kill.killmail_id} className={idx % 2 ? "bg-[#090b11]" : "bg-[#0c0f16]"}>
                        <td className="whitespace-nowrap border border-[#2b2d33] px-2 py-1.5 font-mono text-slate-400">{fmtDateTime(kill.killmail_time)}</td>
                        <td className="border border-[#2b2d33] px-2 py-1.5">
                          <div className="font-mono text-slate-100">{kill.jcode || "-"}</div>
                          {kill.wormhole_class ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              <span className="border border-[#303236] bg-[#101219] px-1.5 py-0.5 text-[10px] font-semibold text-slate-200">
                                {kill.wormhole_class}
                              </span>
                              {kill.is_low_class ? (
                                <span className="border border-[#8a5f22] bg-[#241607] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#ffcf8a]">
                                  Low class
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <div className="text-[10px] text-slate-600">Class unknown</div>
                          )}
                          <div className="text-[10px] text-slate-600">{kill.solar_system_id}</div>
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1.5 text-slate-100">{kill.structure_type_name}</td>
                        <td className="border border-[#2b2d33] px-2 py-1.5">
                          <div className="text-slate-200">{kill.victim_corporation_name || (kill.victim_corporation_id ? `Corporation ${kill.victim_corporation_id}` : "-")}</div>
                          <div className="text-[10px] text-slate-500">{kill.victim_alliance_name || (kill.victim_alliance_id ? `Alliance ${kill.victim_alliance_id}` : "")}</div>
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1.5 text-[#ffb073]">{fmtIsk(kill.zkb_total_value)}</td>
                        <td className="border border-[#2b2d33] px-2 py-1.5">
                          <div>{fmtNum(kill.damage_done_for_entity)}</div>
                          <div className="text-[10px] text-slate-600">{kill.attackers_count_for_entity} attackers</div>
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1.5">{kill.final_blow_for_entity ? "Yes" : "No"}</td>
                        <td className="border border-[#2b2d33] px-2 py-1.5">
                          <a
                            href={kill.zkillUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[#53b6ff] hover:text-[#8fd2ff]"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Open
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
