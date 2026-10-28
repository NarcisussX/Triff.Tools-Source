import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  LogIn,
  RefreshCw,
  Share2,
  Upload,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { requestSiteAuthModal, SITE_AUTH_CHANGED_EVENT, type SiteAuthChangeDetail } from "../auth/siteAuthEvents";
import type { AuthUser } from "../components/fitting/types";
import { ToolChrome } from "../components/tool-ui";
import {
  isDroneCombatEvent,
  parseCombatLog,
  type CombatActor,
  type CombatEngagement,
  type CombatLogEvent,
  type CombatLogReport,
  type CombatMetricRow,
  type CombatModuleRow,
  type CombatTimelineRow,
} from "../lib/combatLogParser";

type TabKey = "overview" | "damage" | "capacitor" | "ewar" | "events";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const panel = "border border-[#2c2f36] bg-[#070910]";
const panelHeader =
  "border-b border-[#2c2f36] bg-[#101219] px-3 py-2 text-[10px] font-semibold uppercase text-slate-300";
const inputClass =
  "w-full border border-[#303236] bg-[#05070b] px-2.5 py-1.5 text-[11px] text-[#e4e7f5] outline-none focus:border-[#53b6ff] focus:ring-0";
const buttonBase =
  "inline-flex min-h-9 items-center justify-center gap-1.5 border px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-200 disabled:cursor-not-allowed disabled:opacity-50";
const buttonSecondary =
  `${buttonBase} border-[#303236] bg-[#05070b] hover:border-[#53b6ff]/60 hover:bg-[#101219]`;
const buttonPrimary =
  `${buttonBase} border-[#46b2ff]/70 bg-[#146791] text-[#e3f4ff] shadow-[0_0_12px_rgba(70,178,255,0.16)] hover:bg-[#1979aa]`;

type TimelineRange = { startIndex: number; endIndex: number };
type ReportScopeOptions = { ignoreDrones?: boolean };
type SortDirection = "asc" | "desc";

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function compareSortValues(a: string | number | null | undefined, b: string | number | null | undefined, direction: SortDirection) {
  const modifier = direction === "asc" ? 1 : -1;
  if (typeof a === "number" || typeof b === "number") {
    return (Number(a || 0) - Number(b || 0)) * modifier;
  }
  return String(a || "").localeCompare(String(b || "")) * modifier;
}

function nextSortDirection(currentKey: string, nextKey: string, currentDirection: SortDirection, defaultDirection: SortDirection = "desc") {
  return currentKey === nextKey ? (currentDirection === "asc" ? "desc" : "asc") : defaultDirection;
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  align = "right",
  defaultDirection = "desc",
  onSort,
}: {
  label: string;
  sortKey: string;
  activeKey: string;
  direction: SortDirection;
  align?: "left" | "right";
  defaultDirection?: SortDirection;
  onSort: (key: string, direction: SortDirection) => void;
}) {
  const active = activeKey === sortKey;
  return (
    <button
      type="button"
      className={classNames(
        "flex w-full items-center gap-1 uppercase hover:text-slate-100",
        align === "right" ? "justify-end text-right" : "justify-start text-left",
        active ? "text-slate-100" : "text-slate-400"
      )}
      onClick={() => onSort(sortKey, nextSortDirection(activeKey, sortKey, direction, defaultDirection))}
    >
      <span>{label}</span>
      <span className={classNames("text-[8px]", active ? "text-[#53b6ff]" : "text-slate-600")}>{active ? (direction === "asc" ? "^" : "v") : ""}</span>
    </button>
  );
}

function fmtNumber(value?: number, digits = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtCompact(value?: number) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(Math.abs(n) >= 10_000_000 ? 1 : 2)}m`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(Math.abs(n) >= 100_000 ? 0 : 1)}k`;
  return Math.round(n).toLocaleString();
}

function fmtDuration(seconds?: number) {
  const n = Math.max(0, Math.round(Number(seconds || 0)));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtEveTime(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toISOString().replace("T", " ").slice(0, 16);
}

function fmtEveTimeSeconds(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function fmtEveClockSeconds(value?: string | null) {
  const formatted = fmtEveTimeSeconds(value);
  return formatted === "Unknown" ? formatted : formatted.slice(11);
}

function copyUrl(path: string) {
  if (typeof window === "undefined" || !navigator.clipboard?.writeText) return;
  void navigator.clipboard.writeText(path.startsWith("http") ? path : `${window.location.origin}${path}`);
}

function actorKey(actor?: CombatActor | null) {
  if (!actor) return "unknown";
  return [actor.name, actor.corporation || "", actor.ship || ""].join("|").toLowerCase();
}

function moduleKey(value?: string | null) {
  return String(value || "Unknown module").replace(/\s+/g, " ").trim().toLowerCase();
}

function ensureMetric(map: Map<string, CombatMetricRow>, actor?: CombatActor | null) {
  const key = actorKey(actor);
  let row = map.get(key);
  if (!row) {
    row = {
      key,
      name: actor?.name || "Unknown",
      corporation: actor?.corporation || null,
      alliance: actor?.alliance || null,
      ship: actor?.ship || null,
      amount: 0,
      events: 0,
      hits: 0,
      misses: 0,
      minHit: 0,
      maxHit: 0,
      avgHit: 0,
      firstSeen: null,
      lastSeen: null,
    };
    map.set(key, row);
  }
  return row;
}

function addMetric(map: Map<string, CombatMetricRow>, actor: CombatActor | null | undefined, event: CombatLogEvent) {
  const row = ensureMetric(map, actor);
  const amount = Number(event.amount || 0);
  row.amount += amount;
  row.events += 1;
  if (amount > 0) {
    row.hits = Number(row.hits || 0) + 1;
    row.minHit = row.minHit && row.minHit > 0 ? Math.min(row.minHit, amount) : amount;
  } else {
    row.misses = Number(row.misses || 0) + 1;
  }
  row.maxHit = Math.max(row.maxHit || 0, amount);
  row.avgHit = row.hits ? row.amount / row.hits : 0;
  row.firstSeen = row.firstSeen || event.time;
  row.lastSeen = event.time;
}

function addMiss(map: Map<string, CombatMetricRow>, actor: CombatActor | null | undefined, event: CombatLogEvent) {
  const row = ensureMetric(map, actor);
  row.events += 1;
  row.misses = Number(row.misses || 0) + 1;
  row.firstSeen = row.firstSeen || event.time;
  row.lastSeen = event.time;
}

function addModule(map: Map<string, CombatModuleRow>, event: CombatLogEvent) {
  const key = moduleKey(event.module);
  let row = map.get(key);
  if (!row) {
    row = { key, name: event.module || "Unknown module", amount: 0, events: 0, maxHit: 0 };
    map.set(key, row);
  }
  row.amount += Number(event.amount || 0);
  row.events += 1;
  row.maxHit = Math.max(row.maxHit || 0, Number(event.amount || 0));
}

function topRows<T extends { amount: number; events: number }>(map: Map<string, T>, limit = 60) {
  return Array.from(map.values())
    .sort((a, b) => b.amount - a.amount || b.events - a.events)
    .slice(0, limit);
}

function ewarShipRows(rows: CombatMetricRow[]) {
  const map = new Map<string, CombatMetricRow>();
  for (const row of rows) {
    const ship = row.ship || "Unknown ship";
    const key = ship.toLowerCase();
    const current = map.get(key) || {
      key,
      name: ship,
      corporation: null,
      alliance: null,
      ship,
      amount: 0,
      events: 0,
      hits: 0,
      misses: 0,
      minHit: 0,
      maxHit: 0,
      avgHit: 0,
      firstSeen: row.firstSeen || null,
      lastSeen: row.lastSeen || null,
    };
    current.amount += Number(row.amount || row.events || 0);
    current.events += Number(row.events || 0);
    current.hits = Number(current.hits || 0) + Number(row.hits || row.events || 0);
    if (!current.firstSeen || (row.firstSeen && row.firstSeen < current.firstSeen)) current.firstSeen = row.firstSeen || current.firstSeen;
    if (!current.lastSeen || (row.lastSeen && row.lastSeen > current.lastSeen)) current.lastSeen = row.lastSeen || current.lastSeen;
    map.set(key, current);
  }
  return topRows(map);
}

function activeDamageSeconds(events: CombatLogEvent[], direction: "in" | "out") {
  const times = events
    .filter((event) => event.kind === "damage" && event.direction === direction && event.amount > 0)
    .map((event) => new Date(event.time).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);

  if (!times.length) return 0;

  let activeSeconds = 0;
  let clusterStart = times[0];
  let previous = times[0];

  for (const time of times.slice(1)) {
    if ((time - previous) / 1000 > 45) {
      activeSeconds += Math.max(1, Math.round((previous - clusterStart) / 1000));
      clusterStart = time;
    }
    previous = time;
  }

  activeSeconds += Math.max(1, Math.round((previous - clusterStart) / 1000));
  return activeSeconds;
}

function makeScopedEngagements(events: CombatLogEvent[]) {
  const relevant = events.filter((event) => event.kind !== "other");
  const groups: CombatEngagement[] = [];
  let current: CombatEngagement | null = null;
  let previousTime = 0;

  for (const event of relevant) {
    const eventMs = new Date(event.time).getTime();
    if (!Number.isFinite(eventMs)) continue;

    if (!current || eventMs - previousTime > 120000) {
      current = {
        id: `engagement-${groups.length + 1}`,
        startTime: event.time,
        endTime: event.time,
        durationSeconds: 0,
        events: 0,
        damageOut: 0,
        damageIn: 0,
        capacitorOut: 0,
        capacitorIn: 0,
      };
      groups.push(current);
    }

    current.endTime = event.time;
    current.durationSeconds = Math.max(
      1,
      Math.round((new Date(current.endTime).getTime() - new Date(current.startTime).getTime()) / 1000)
    );
    current.events += 1;
    if (event.kind === "damage" && event.direction === "out") current.damageOut += event.amount;
    if (event.kind === "damage" && event.direction === "in") current.damageIn += event.amount;
    if (event.kind === "capacitor" && event.direction === "out") current.capacitorOut += event.amount;
    if (event.kind === "capacitor" && event.direction === "in") current.capacitorIn += event.amount;
    previousTime = eventMs;
  }

  return groups;
}

function rangeBounds(report: CombatLogReport, range: TimelineRange | null) {
  const timeline = report.data.timeline || [];
  if (!range || !timeline.length) return null;
  const startIndex = Math.max(0, Math.min(range.startIndex, timeline.length - 1));
  const endIndex = Math.max(startIndex, Math.min(range.endIndex, timeline.length - 1));
  const start = timeline[startIndex];
  const end = timeline[endIndex];
  const startMs = new Date(start.time).getTime();
  const endMs = new Date(end.time).getTime() + Math.max(1, Number(end.bucketSeconds || 60)) * 1000 - 1;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { startIndex, endIndex, startMs, endMs, startTime: new Date(startMs).toISOString(), endTime: new Date(endMs).toISOString() };
}

function isFullRange(report: CombatLogReport, range: TimelineRange | null) {
  const timeline = report.data.timeline || [];
  if (!range || !timeline.length) return true;
  return range.startIndex <= 0 && range.endIndex >= timeline.length - 1;
}

function resetTimelineRow(row: CombatTimelineRow): CombatTimelineRow {
  return {
    ...row,
    damageOut: 0,
    damageIn: 0,
    repairsOut: 0,
    repairsIn: 0,
    capacitorOut: 0,
    capacitorIn: 0,
    ewar: 0,
  };
}

function bucketTimeForReport(report: CombatLogReport, time: string) {
  const bucketSeconds = Math.max(1, Number(report.data.timeline?.[0]?.bucketSeconds || 10));
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Math.floor(date.getTime() / (bucketSeconds * 1000)) * bucketSeconds * 1000).toISOString();
}

function rebuildTimeline(report: CombatLogReport, events: CombatLogEvent[], bounds: ReturnType<typeof rangeBounds>) {
  const sourceTimeline = report.data.timeline || [];
  const sourceRows = bounds ? sourceTimeline.slice(bounds.startIndex, bounds.endIndex + 1) : sourceTimeline;
  const rows = sourceRows.map(resetTimelineRow);
  const byTime = new Map(rows.map((row) => [row.time, row]));

  for (const event of events) {
    const bucket = bucketTimeForReport(report, event.time);
    const point = bucket ? byTime.get(bucket) : null;
    if (!point) continue;

    if (event.kind === "damage" && event.direction === "out") point.damageOut += event.amount;
    if (event.kind === "damage" && event.direction === "in") point.damageIn += event.amount;
    if (event.kind === "repair" && event.direction === "out") point.repairsOut += event.amount;
    if (event.kind === "repair" && event.direction === "in") point.repairsIn += event.amount;
    if (event.kind === "capacitor" && event.direction === "out") point.capacitorOut += event.amount;
    if (event.kind === "capacitor" && event.direction === "in") point.capacitorIn += event.amount;
    if (event.kind === "ewar") point.ewar += 1;
  }

  return rows;
}

function scopedReport(report: CombatLogReport, range: TimelineRange | null, options: ReportScopeOptions = {}): CombatLogReport {
  const bounds = rangeBounds(report, range);
  const events = report.data.events || [];
  const ignoreDrones = Boolean(options.ignoreDrones);
  const fullRange = isFullRange(report, range);
  if (!events.length) return report;

  const filteredEvents = events.filter((event) => {
    const eventMs = new Date(event.time).getTime();
    const inRange = !bounds || fullRange || (Number.isFinite(eventMs) && eventMs >= bounds.startMs && eventMs <= bounds.endMs);
    return inRange && (!ignoreDrones || !isDroneCombatEvent(event));
  });
  const filteredTimeline = rebuildTimeline(report, filteredEvents, bounds && !fullRange ? bounds : null);

  const damageOutTargets = new Map<string, CombatMetricRow>();
  const damageInSources = new Map<string, CombatMetricRow>();
  const outgoingWeapons = new Map<string, CombatModuleRow>();
  const incomingWeapons = new Map<string, CombatModuleRow>();
  const capacitorTargets = new Map<string, CombatMetricRow>();
  const capacitorSources = new Map<string, CombatMetricRow>();
  const repairTargets = new Map<string, CombatMetricRow>();
  const repairSources = new Map<string, CombatMetricRow>();
  const ewar = new Map<string, CombatMetricRow>();
  const ewarTargets = new Map<string, CombatMetricRow>();
  const ewarSources = new Map<string, CombatMetricRow>();
  const ewarModules = new Map<string, CombatModuleRow>();
  const quality = new Map<string, { quality: string; outgoing: number; incoming: number }>();

  let damageOut = 0;
  let damageIn = 0;
  let repairsOut = 0;
  let repairsIn = 0;
  let capacitorOut = 0;
  let capacitorIn = 0;
  let ewarEvents = 0;
  let missedShots = 0;

  for (const event of filteredEvents) {
    if (event.kind === "damage") {
      if (event.direction === "out") {
        damageOut += event.amount;
        addMetric(damageOutTargets, event.target, event);
        addModule(outgoingWeapons, event);
      } else {
        damageIn += event.amount;
        addMetric(damageInSources, event.actor, event);
        addModule(incomingWeapons, event);
      }
      const key = event.quality || "Hit";
      const row = quality.get(key) || { quality: key, outgoing: 0, incoming: 0 };
      if (event.direction === "out") row.outgoing += 1;
      if (event.direction === "in") row.incoming += 1;
      quality.set(key, row);
    }

    if (event.kind === "capacitor") {
      if (event.direction === "out") {
        capacitorOut += event.amount;
        addMetric(capacitorTargets, event.target, event);
      } else {
        capacitorIn += event.amount;
        addMetric(capacitorSources, event.actor, event);
      }
    }

    if (event.kind === "repair") {
      if (event.direction === "out") {
        repairsOut += event.amount;
        addMetric(repairTargets, event.target, event);
      } else {
        repairsIn += event.amount;
        addMetric(repairSources, event.actor, event);
      }
    }

    if (event.kind === "ewar") {
      ewarEvents += 1;
      if (event.direction === "out") addMetric(ewarTargets, event.target, event);
      if (event.direction === "in") addMetric(ewarSources, event.actor, event);
      addMetric(ewar, event.direction === "out" ? event.target : event.direction === "in" ? event.actor : event.target || event.actor, event);
      if (event.direction !== "neutral") addModule(ewarModules, event);
    }

    if (event.kind === "miss") {
      missedShots += 1;
      if (event.direction === "out") {
        addMiss(damageOutTargets, event.target, event);
        addModule(outgoingWeapons, event);
      }
      if (event.direction === "in") {
        addMiss(damageInSources, event.actor, event);
        addModule(incomingWeapons, event);
      }
    }
  }

  const filteredTimes = filteredEvents
    .map((event) => new Date(event.time).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  const fallbackStartMs = bounds?.startMs ?? new Date(report.startTime || "").getTime();
  const fallbackEndMs = bounds?.endMs ?? new Date(report.endTime || "").getTime();
  const scopedStartMs = filteredTimes[0] ?? (Number.isFinite(fallbackStartMs) ? fallbackStartMs : Date.now());
  const scopedEndMs = filteredTimes[filteredTimes.length - 1] ?? (Number.isFinite(fallbackEndMs) ? fallbackEndMs : scopedStartMs);
  const durationSeconds = filteredTimes.length ? Math.max(1, Math.round((scopedEndMs - scopedStartMs) / 1000)) : 0;
  const activeDamageOutSeconds = activeDamageSeconds(filteredEvents, "out");
  const activeDamageInSeconds = activeDamageSeconds(filteredEvents, "in");
  const activeDpsOut = activeDamageOutSeconds ? damageOut / activeDamageOutSeconds : 0;
  const activeDpsIn = activeDamageInSeconds ? damageIn / activeDamageInSeconds : 0;
  const windowDpsOut = durationSeconds ? damageOut / durationSeconds : 0;
  const windowDpsIn = durationSeconds ? damageIn / durationSeconds : 0;
  const targetCount = new Set(
    [...damageOutTargets.keys(), ...capacitorTargets.keys(), ...ewarTargets.keys()].filter((key) => key !== "unknown")
  ).size;
  const attackerCount = new Set(
    [...damageInSources.keys(), ...capacitorSources.keys(), ...ewarSources.keys()].filter((key) => key !== "unknown")
  ).size;
  const engagements = makeScopedEngagements(filteredEvents);

  return {
    ...report,
    startTime: filteredTimes.length ? new Date(scopedStartMs).toISOString() : bounds?.startTime || report.startTime,
    endTime: filteredTimes.length ? new Date(scopedEndMs).toISOString() : bounds?.endTime || report.endTime,
    summary: {
      ...report.summary,
      combatEvents: filteredEvents.length,
      damageOut,
      damageIn,
      repairsOut,
      repairsIn,
      capacitorOut,
      capacitorIn,
      ewarEvents,
      missedShots,
      targets: targetCount,
      attackers: attackerCount,
      weapons: new Set([...outgoingWeapons.keys(), ...incomingWeapons.keys()]).size,
      durationSeconds,
      activeDamageOutSeconds,
      activeDamageInSeconds,
      activeDpsOut,
      activeDpsIn,
      windowDpsOut,
      windowDpsIn,
      dpsOut: activeDpsOut,
      dpsIn: activeDpsIn,
    },
    data: {
      ...report.data,
      topDamageOutTargets: topRows(damageOutTargets),
      topDamageInSources: topRows(damageInSources),
      outgoingWeapons: topRows(outgoingWeapons),
      incomingWeapons: topRows(incomingWeapons),
      capacitorTargets: topRows(capacitorTargets),
      capacitorSources: topRows(capacitorSources),
      repairTargets: topRows(repairTargets),
      repairSources: topRows(repairSources),
      ewar: topRows(ewar),
      ewarTargets: topRows(ewarTargets),
      ewarSources: topRows(ewarSources),
      ewarModules: topRows(ewarModules),
      hitQuality: Array.from(quality.values()).sort((a, b) => b.outgoing + b.incoming - (a.outgoing + a.incoming)),
      timeline: filteredTimeline,
      engagements,
      events: filteredEvents,
      diagnostics: {
        ...report.data.diagnostics,
        droneEventsIgnored: ignoreDrones ? events.length - filteredEvents.length : report.data.diagnostics?.droneEventsIgnored || 0,
      },
    },
  };
}

async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Request failed (${response.status})`);
  return payload as T;
}

function normalizeReport(raw: any): CombatLogReport {
  const events = Array.isArray(raw?.data?.events)
    ? raw.data.events.map((event: any, index: number) => ({
        ...event,
        id: event?.id || `${event?.time || "event"}-${index}`,
        text: event?.text || "",
      }))
    : [];
  return {
    id: raw?.id,
    title: String(raw?.title || "Combat Log Report"),
    fileName: String(raw?.fileName ?? raw?.file_name ?? ""),
    listener: raw?.listener || null,
    sessionStartedAt: raw?.sessionStartedAt ?? raw?.session_started_at ?? null,
    startTime: raw?.startTime ?? raw?.start_time ?? null,
    endTime: raw?.endTime ?? raw?.end_time ?? null,
    summary: raw?.summary || {},
    data: {
      version: Number(raw?.data?.version || 1),
      generatedAt: raw?.data?.generatedAt || raw?.data?.generated_at || raw?.created_at || new Date().toISOString(),
      topDamageOutTargets: raw?.data?.topDamageOutTargets || [],
      topDamageInSources: raw?.data?.topDamageInSources || [],
      outgoingWeapons: raw?.data?.outgoingWeapons || [],
      incomingWeapons: raw?.data?.incomingWeapons || [],
      capacitorTargets: raw?.data?.capacitorTargets || [],
      capacitorSources: raw?.data?.capacitorSources || [],
      repairTargets: raw?.data?.repairTargets || [],
      repairSources: raw?.data?.repairSources || [],
      ewar: raw?.data?.ewar || [],
      ewarTargets: raw?.data?.ewarTargets || [],
      ewarSources: raw?.data?.ewarSources || [],
      ewarModules: raw?.data?.ewarModules || [],
      hitQuality: raw?.data?.hitQuality || [],
      timeline: raw?.data?.timeline || [],
      engagements: raw?.data?.engagements || [],
      events,
      diagnostics: raw?.data?.diagnostics || { unparsedCombatLines: 0, notifyLines: 0, capBoosterReloads: 0, droneEventsIgnored: 0, channels: {} },
    },
  };
}

function compactReportForShare(report: CombatLogReport) {
  return {
    ...report,
    data: {
      ...report.data,
      events: report.data.events.map(({ id: _id, text: _text, ...event }) => event),
    },
  };
}

function Header({ report }: { report: CombatLogReport | null }) {
  const summary = report?.summary;
  return (
    <ToolChrome
      section="Combat Intel"
      title="Combat Log Parser"
      badge={(
        <span className="block max-w-[120px] truncate sm:max-w-[220px]" title={report?.listener || "None"}>
          Pilot: {report?.listener || "None"}
        </span>
      )}
      context={report ? `Window: ${fmtEveTime(report.startTime)} - ${fmtEveTime(report.endTime)} ET · Damage: ${fmtCompact(summary?.damageOut)} out / ${fmtCompact(summary?.damageIn)} in` : "Log Analyzer · No file"}
      status={report ? `${fmtNumber(summary?.combatEvents)} events` : undefined}
    />
  );
}

function StatBox({ label, value, accent = "text-slate-200" }: { label: string; value: string; accent?: string }) {
  return (
    <div className="border border-[#252a33] bg-[#05070b] px-3 py-2">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className={classNames("mt-1 font-mono text-[18px] leading-none", accent)}>{value}</div>
    </div>
  );
}

function EmptyWorkbench() {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center border border-dashed border-[#27313d] bg-[#04070c] px-4 text-center">
      <FileText className="h-10 w-10 text-slate-600" />
      <div className="mt-3 text-[13px] font-semibold text-slate-200">No combat log loaded.</div>
      <div className="mt-1 max-w-lg text-[11px] leading-relaxed text-slate-500">
        Drop a Gamelogs text file to calculate damage, reps, capacitor pressure, tackle markers, timelines, and report tables.
      </div>
    </div>
  );
}

function metricHits(row: CombatMetricRow) {
  return Number(row.hits ?? row.events ?? 0);
}

function metricMin(row: CombatMetricRow) {
  const explicit = Number(row.minHit || 0);
  if (explicit > 0) return explicit;
  const hits = metricHits(row);
  if (hits <= 0 || row.amount <= 0) return 0;
  if (hits === 1) return Number(row.maxHit || row.amount || 0);
  return Number(row.maxHit || 0) === Number(row.amount || 0) ? Number(row.maxHit || 0) : 0;
}

function metricAverage(row: CombatMetricRow) {
  const hits = metricHits(row);
  return Number(row.avgHit || (hits ? row.amount / hits : 0));
}

function metricMisses(row: CombatMetricRow) {
  return Number(row.misses || 0);
}

function fmtMetricMin(row: CombatMetricRow) {
  const min = metricMin(row);
  return min > 0 ? fmtNumber(min) : "-";
}

function DetailedMetricTable({
  title,
  rows,
  amountLabel,
  failLabel,
}: {
  title: string;
  rows: CombatMetricRow[];
  amountLabel: string;
  failLabel: string;
}) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({ key: "amount", direction: "desc" });
  const sortedRows = useMemo(() => {
    const valueFor = (row: CombatMetricRow, key: string): string | number => {
      if (key === "name") return row.name;
      if (key === "amount") return row.amount;
      if (key === "min") return metricMin(row);
      if (key === "max") return Number(row.maxHit || 0);
      if (key === "average") return metricAverage(row);
      if (key === "hits") return metricHits(row);
      if (key === "fails") return metricMisses(row);
      return row.amount;
    };
    return [...rows].sort((a, b) => compareSortValues(valueFor(a, sort.key), valueFor(b, sort.key), sort.direction));
  }, [rows, sort]);
  const onSort = (key: string, direction: SortDirection) => setSort({ key, direction });

  return (
    <section className={panel}>
      <div className={panelHeader}>{title}</div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full table-fixed border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#11151d] text-[9px] uppercase text-slate-400">
            <tr>
              <th className="w-[38%] border-b border-[#2c2f36] px-2 py-1.5 text-left">
                <SortHeader label="Name" sortKey="name" activeKey={sort.key} direction={sort.direction} align="left" defaultDirection="asc" onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-1.5 py-1.5 text-right">
                <SortHeader label={amountLabel} sortKey="amount" activeKey={sort.key} direction={sort.direction} onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-1.5 py-1.5 text-right">
                <SortHeader label="Min" sortKey="min" activeKey={sort.key} direction={sort.direction} onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-1.5 py-1.5 text-right">
                <SortHeader label="Max" sortKey="max" activeKey={sort.key} direction={sort.direction} onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-1.5 py-1.5 text-right">
                <SortHeader label="Average" sortKey="average" activeKey={sort.key} direction={sort.direction} onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-1.5 py-1.5 text-right">
                <SortHeader label="Hits" sortKey="hits" activeKey={sort.key} direction={sort.direction} onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-1.5 py-1.5 text-right">
                <SortHeader label={failLabel} sortKey="fails" activeKey={sort.key} direction={sort.direction} onSort={onSort} />
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length ? sortedRows.map((row) => (
              <tr key={row.key} className="odd:bg-[#090b11] even:bg-[#0c0f16] hover:bg-[#141821]">
                <td className="border-b border-[#1d222b] px-2 py-1.5">
                  <div className="truncate font-semibold text-slate-100" title={row.name}>{row.name}</div>
                  <div className="truncate text-[10px] text-slate-500" title={`${row.corporation || row.alliance || "-"} / ${row.ship || "-"}`}>
                    {row.corporation || row.alliance || "-"} / {row.ship || "-"}
                  </div>
                </td>
                <td className="border-b border-[#1d222b] px-1.5 py-1.5 text-right font-mono text-[#53b6ff]">{fmtNumber(row.amount)}</td>
                <td className="border-b border-[#1d222b] px-1.5 py-1.5 text-right font-mono text-slate-300">{fmtMetricMin(row)}</td>
                <td className="border-b border-[#1d222b] px-1.5 py-1.5 text-right font-mono text-slate-300">{fmtNumber(row.maxHit || 0)}</td>
                <td className="border-b border-[#1d222b] px-1.5 py-1.5 text-right font-mono text-slate-300">{fmtNumber(metricAverage(row), 1)}</td>
                <td className="border-b border-[#1d222b] px-1.5 py-1.5 text-right font-mono text-slate-300">{fmtNumber(metricHits(row))}</td>
                <td className="border-b border-[#1d222b] px-1.5 py-1.5 text-right font-mono text-slate-300">{fmtNumber(metricMisses(row))}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[11px] text-slate-500">No rows.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MetricTable({ title, rows, amountLabel = "Amount" }: { title: string; rows: CombatMetricRow[]; amountLabel?: string }) {
  if (amountLabel === "Damage") return <DetailedMetricTable title={title} rows={rows} amountLabel="Damage" failLabel="Misses" />;
  if (amountLabel === "GJ" && title.toLowerCase().startsWith("cap pressure")) {
    return <DetailedMetricTable title={title} rows={rows} amountLabel="GJ" failLabel="Fails" />;
  }
  return <SimpleMetricTable title={title} rows={rows} amountLabel={amountLabel} />;
}

function SimpleMetricTable({ title, rows, amountLabel = "Amount" }: { title: string; rows: CombatMetricRow[]; amountLabel?: string }) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({ key: "amount", direction: "desc" });
  const sortedRows = useMemo(() => {
    const valueFor = (row: CombatMetricRow, key: string): string | number => {
      if (key === "name") return row.name;
      if (key === "ship") return row.ship || "";
      if (key === "amount") return row.amount;
      if (key === "events") return row.events;
      if (key === "max") return Number(row.maxHit || 0);
      return row.amount;
    };
    return [...rows].sort((a, b) => compareSortValues(valueFor(a, sort.key), valueFor(b, sort.key), sort.direction));
  }, [rows, sort]);
  const onSort = (key: string, direction: SortDirection) => setSort({ key, direction });

  return (
    <section className={panel}>
      <div className={panelHeader}>{title}</div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#11151d] text-[10px] uppercase text-slate-400">
            <tr>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-left">
                <SortHeader label="Pilot" sortKey="name" activeKey={sort.key} direction={sort.direction} align="left" defaultDirection="asc" onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-left">
                <SortHeader label="Ship" sortKey="ship" activeKey={sort.key} direction={sort.direction} align="left" defaultDirection="asc" onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-right">
                <SortHeader label={amountLabel} sortKey="amount" activeKey={sort.key} direction={sort.direction} onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-right">
                <SortHeader label="Events" sortKey="events" activeKey={sort.key} direction={sort.direction} onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-right">
                <SortHeader label="Max" sortKey="max" activeKey={sort.key} direction={sort.direction} onSort={onSort} />
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length ? sortedRows.map((row) => (
              <tr key={row.key} className="odd:bg-[#090b11] even:bg-[#0c0f16] hover:bg-[#141821]">
                <td className="border-b border-[#1d222b] px-2 py-1.5">
                  <div className="font-semibold text-slate-100">{row.name}</div>
                  <div className="text-[10px] text-slate-500">{row.corporation || row.alliance || "-"}</div>
                </td>
                <td className="border-b border-[#1d222b] px-2 py-1.5 text-slate-300">{row.ship || "-"}</td>
                <td className="border-b border-[#1d222b] px-2 py-1.5 text-right font-mono text-[#53b6ff]">{fmtNumber(row.amount)}</td>
                <td className="border-b border-[#1d222b] px-2 py-1.5 text-right font-mono text-slate-300">{fmtNumber(row.events)}</td>
                <td className="border-b border-[#1d222b] px-2 py-1.5 text-right font-mono text-slate-400">{fmtNumber(row.maxHit || 0)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-[11px] text-slate-500">No rows.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ModuleTable({ title, rows }: { title: string; rows: CombatModuleRow[] }) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({ key: "amount", direction: "desc" });
  const sortedRows = useMemo(() => {
    const valueFor = (row: CombatModuleRow, key: string): string | number => {
      if (key === "name") return row.name;
      if (key === "amount") return row.amount;
      if (key === "events") return row.events;
      if (key === "max") return Number(row.maxHit || 0);
      return row.amount;
    };
    return [...rows].sort((a, b) => compareSortValues(valueFor(a, sort.key), valueFor(b, sort.key), sort.direction));
  }, [rows, sort]);
  const onSort = (key: string, direction: SortDirection) => setSort({ key, direction });

  return (
    <section className={panel}>
      <div className={panelHeader}>{title}</div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#11151d] text-[10px] uppercase text-slate-400">
            <tr>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-left">
                <SortHeader label="Module" sortKey="name" activeKey={sort.key} direction={sort.direction} align="left" defaultDirection="asc" onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-right">
                <SortHeader label="Amount" sortKey="amount" activeKey={sort.key} direction={sort.direction} onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-right">
                <SortHeader label="Events" sortKey="events" activeKey={sort.key} direction={sort.direction} onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-right">
                <SortHeader label="Max" sortKey="max" activeKey={sort.key} direction={sort.direction} onSort={onSort} />
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length ? sortedRows.map((row) => (
              <tr key={row.key} className="odd:bg-[#090b11] even:bg-[#0c0f16] hover:bg-[#141821]">
                <td className="border-b border-[#1d222b] px-2 py-1.5 font-semibold text-slate-100">{row.name}</td>
                <td className="border-b border-[#1d222b] px-2 py-1.5 text-right font-mono text-[#53b6ff]">{fmtNumber(row.amount)}</td>
                <td className="border-b border-[#1d222b] px-2 py-1.5 text-right font-mono text-slate-300">{fmtNumber(row.events)}</td>
                <td className="border-b border-[#1d222b] px-2 py-1.5 text-right font-mono text-slate-400">{fmtNumber(row.maxHit || 0)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-[11px] text-slate-500">No rows.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EventMetricTable({ title, rows }: { title: string; rows: CombatMetricRow[] }) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({ key: "events", direction: "desc" });
  const sortedRows = useMemo(() => {
    const valueFor = (row: CombatMetricRow, key: string): string | number => {
      if (key === "name") return row.name;
      if (key === "ship") return row.ship || "";
      if (key === "events") return row.events;
      if (key === "first") return row.firstSeen ? new Date(row.firstSeen).getTime() : 0;
      if (key === "last") return row.lastSeen ? new Date(row.lastSeen).getTime() : 0;
      return row.events;
    };
    return [...rows].sort((a, b) => compareSortValues(valueFor(a, sort.key), valueFor(b, sort.key), sort.direction));
  }, [rows, sort]);
  const onSort = (key: string, direction: SortDirection) => setSort({ key, direction });

  return (
    <section className={panel}>
      <div className={panelHeader}>{title}</div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#11151d] text-[10px] uppercase text-slate-400">
            <tr>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-left">
                <SortHeader label="Name" sortKey="name" activeKey={sort.key} direction={sort.direction} align="left" defaultDirection="asc" onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-left">
                <SortHeader label="Ship" sortKey="ship" activeKey={sort.key} direction={sort.direction} align="left" defaultDirection="asc" onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-right">
                <SortHeader label="Events" sortKey="events" activeKey={sort.key} direction={sort.direction} onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-right">
                <SortHeader label="First" sortKey="first" activeKey={sort.key} direction={sort.direction} defaultDirection="asc" onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-right">
                <SortHeader label="Last" sortKey="last" activeKey={sort.key} direction={sort.direction} defaultDirection="asc" onSort={onSort} />
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length ? sortedRows.map((row) => (
              <tr key={row.key} className="odd:bg-[#090b11] even:bg-[#0c0f16] hover:bg-[#141821]">
                <td className="border-b border-[#1d222b] px-2 py-1.5">
                  <div className="font-semibold text-slate-100">{row.name}</div>
                  <div className="text-[10px] text-slate-500">{row.corporation || row.alliance || "-"}</div>
                </td>
                <td className="border-b border-[#1d222b] px-2 py-1.5 text-slate-300">{row.ship || "-"}</td>
                <td className="border-b border-[#1d222b] px-2 py-1.5 text-right font-mono text-[#53b6ff]">{fmtNumber(row.events)}</td>
                <td className="border-b border-[#1d222b] px-2 py-1.5 text-right font-mono text-slate-400">{row.firstSeen ? fmtEveClockSeconds(row.firstSeen) : "-"}</td>
                <td className="border-b border-[#1d222b] px-2 py-1.5 text-right font-mono text-slate-400">{row.lastSeen ? fmtEveClockSeconds(row.lastSeen) : "-"}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-[11px] text-slate-500">No rows.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EventModuleTable({ title, rows }: { title: string; rows: CombatModuleRow[] }) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({ key: "events", direction: "desc" });
  const sortedRows = useMemo(() => {
    const valueFor = (row: CombatModuleRow, key: string): string | number => {
      if (key === "name") return row.name;
      if (key === "events") return row.events;
      return row.events;
    };
    return [...rows].sort((a, b) => compareSortValues(valueFor(a, sort.key), valueFor(b, sort.key), sort.direction));
  }, [rows, sort]);
  const onSort = (key: string, direction: SortDirection) => setSort({ key, direction });

  return (
    <section className={panel}>
      <div className={panelHeader}>{title}</div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#11151d] text-[10px] uppercase text-slate-400">
            <tr>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-left">
                <SortHeader label="Module" sortKey="name" activeKey={sort.key} direction={sort.direction} align="left" defaultDirection="asc" onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-right">
                <SortHeader label="Events" sortKey="events" activeKey={sort.key} direction={sort.direction} onSort={onSort} />
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length ? sortedRows.map((row) => (
              <tr key={row.key} className="odd:bg-[#090b11] even:bg-[#0c0f16] hover:bg-[#141821]">
                <td className="border-b border-[#1d222b] px-2 py-1.5 font-semibold text-slate-100">{row.name}</td>
                <td className="border-b border-[#1d222b] px-2 py-1.5 text-right font-mono text-[#53b6ff]">{fmtNumber(row.events)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={2} className="px-3 py-8 text-center text-[11px] text-slate-500">No rows.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function timelineRate(row: { bucketSeconds?: number }, key: string) {
  const bucketSeconds = Math.max(1, Number(row.bucketSeconds || 60));
  return Number((row as Record<string, unknown>)[key] || 0) / bucketSeconds;
}

function nearestTimelineBucket(timeline: Array<{ time: string }>, time: string) {
  if (!timeline.length) return null;
  const target = new Date(time).getTime();
  if (!Number.isFinite(target)) return null;
  let best = timeline[0];
  let bestDelta = Math.abs(new Date(best.time).getTime() - target);
  for (const row of timeline.slice(1)) {
    const delta = Math.abs(new Date(row.time).getTime() - target);
    if (delta < bestDelta) {
      best = row;
      bestDelta = delta;
    }
  }
  return best.time;
}

function isJamEvent(event: CombatLogEvent) {
  if (event.kind !== "ewar") return false;
  return /jam/i.test(`${event.quality || ""} ${event.module || ""} ${event.text || ""}`);
}

function actorShortLabel(actor?: CombatActor | null) {
  if (!actor?.name) return "Unknown";
  return actor.ship ? `${actor.name} (${actor.ship})` : actor.name;
}

function jamTooltipSummary(events: CombatLogEvent[], direction: "in" | "out") {
  if (!events.length) return "";
  const first = events[0];
  const count = events.length;
  const subject = direction === "in" ? actorShortLabel(first.actor) : actorShortLabel(first.target);
  const module = first.module ? ` - ${first.module}` : "";
  const prefix = count === 1 ? "Jammed" : `${count}x jammed`;
  return `${prefix} ${direction === "in" ? "by" : "on"} ${subject}${module}`;
}

function TimelineTooltipContent({ active, label, payload }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload || {};
  const visibleKeys = new Set(payload.map((item: any) => item?.dataKey).filter(Boolean));
  const rows: Array<{ label: string; value: string; color: string }> = [];

  if (point.jamInCount) rows.push({ label: "Jammed In", value: point.jamInSummary, color: "#c084fc" });
  if (point.jamOutCount) rows.push({ label: "Jammed Out", value: point.jamOutSummary, color: "#f472b6" });

  const addRate = (key: string, labelText: string, color: string) => {
    if (!visibleKeys.has(key)) return;
    rows.push({ label: labelText, value: fmtNumber(Number(point[key] || 0), 1), color });
  };

  addRate("damageInRate", "Damage In", "#fb7185");
  addRate("damageOutRate", "Damage Out", "#53b6ff");
  addRate("repairsInRate", "Reps In", "#3bbf5a");
  addRate("repairsOutRate", "Reps Out", "#f59e0b");
  addRate("capacitorInRate", "Cap Press. In", "#a78bfa");
  addRate("capacitorOutRate", "Cap Press. Out", "#f8fafc");

  return (
    <div className="border border-[#303236] bg-[#05070b] px-3 py-2 text-[11px] shadow-[0_0_18px_rgba(0,0,0,0.65)]">
      <div className="mb-2 font-mono text-slate-100">{fmtEveTimeSeconds(String(label))} ET</div>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={`${row.label}-${row.value}`} className="flex gap-2 font-mono">
            <span style={{ color: row.color }}>{row.label}:</span>
            <span className="text-slate-100">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineChart({
  report,
  range,
  onRangeChange,
  showCapPressure,
  onShowCapPressureChange,
}: {
  report: CombatLogReport;
  range: TimelineRange | null;
  onRangeChange: (range: TimelineRange | null) => void;
  showCapPressure: boolean;
  onShowCapPressureChange: (show: boolean) => void;
}) {
  const timeline = report.data.timeline || [];
  const chartRows = useMemo(
    () => {
      const markerRows = new Map<string, { jamIn: CombatLogEvent[]; jamOut: CombatLogEvent[] }>();
      for (const event of report.data.events || []) {
        if (!isJamEvent(event) || (event.direction !== "in" && event.direction !== "out")) continue;
        const bucket = nearestTimelineBucket(timeline, event.time);
        if (!bucket) continue;
        const markers = markerRows.get(bucket) || { jamIn: [], jamOut: [] };
        if (event.direction === "in") markers.jamIn.push(event);
        if (event.direction === "out") markers.jamOut.push(event);
        markerRows.set(bucket, markers);
      }

      return timeline.map((row) => {
        const markers = markerRows.get(row.time);
        return {
        ...row,
        damageOutRate: timelineRate(row, "damageOut"),
        damageInRate: timelineRate(row, "damageIn"),
        repairsOutRate: timelineRate(row, "repairsOut"),
        repairsInRate: timelineRate(row, "repairsIn"),
        capacitorOutRate: timelineRate(row, "capacitorOut"),
        capacitorInRate: timelineRate(row, "capacitorIn"),
          jamInY: markers?.jamIn.length ? 0.96 : null,
          jamOutY: markers?.jamOut.length ? 0.04 : null,
          jamInCount: markers?.jamIn.length || 0,
          jamOutCount: markers?.jamOut.length || 0,
          jamInSummary: jamTooltipSummary(markers?.jamIn || [], "in"),
          jamOutSummary: jamTooltipSummary(markers?.jamOut || [], "out"),
        };
      });
    },
    [report.data.events, timeline]
  );
  const engagementMarkers = useMemo(
    () =>
      (report.data.engagements || [])
        .slice(0, 12)
        .map((engagement, index) => ({
          key: engagement.id,
          label: `Fight ${index + 1}`,
          time: nearestTimelineBucket(chartRows, engagement.startTime),
        }))
        .filter((marker): marker is { key: string; label: string; time: string } => Boolean(marker.time)),
    [chartRows, report.data.engagements]
  );
  const startIndex = range ? Math.max(0, Math.min(range.startIndex, Math.max(0, chartRows.length - 1))) : 0;
  const endIndex = range ? Math.max(startIndex, Math.min(range.endIndex, Math.max(0, chartRows.length - 1))) : Math.max(0, chartRows.length - 1);

  return (
    <section className={`${panel} combat-timeline-panel`}>
      <style>{`
        .combat-timeline-panel .recharts-brush rect {
          shape-rendering: crispEdges;
        }
        .combat-timeline-panel .recharts-brush > rect:first-child {
          fill: #05070b;
          stroke: #2c3542;
        }
        .combat-timeline-panel .recharts-brush-slide {
          fill: rgba(83, 182, 255, 0.14);
          stroke: #53b6ff;
          stroke-width: 1;
          filter: drop-shadow(0 0 5px rgba(83, 182, 255, 0.35));
        }
        .combat-timeline-panel .recharts-brush-traveller rect {
          fill: #0b1521;
          stroke: #9dd8ff;
          stroke-width: 1.5;
          rx: 0;
        }
        .combat-timeline-panel .recharts-brush-traveller line {
          stroke: #53b6ff;
          stroke-width: 1;
        }
        .combat-timeline-panel .recharts-brush text {
          fill: #8ea4bc;
          font-size: 10px;
        }
      `}</style>
      <div className={`${panelHeader} flex items-center justify-between gap-3`}>
        <span>Combat Timeline</span>
        <label className="flex cursor-pointer items-center gap-2 text-[10px] font-bold uppercase text-slate-400">
          <input
            type="checkbox"
            checked={showCapPressure}
            onChange={(event) => onShowCapPressureChange(event.currentTarget.checked)}
            className="h-3.5 w-3.5 border-[#303236] bg-[#05070b] text-[#53b6ff]"
          />
          Cap Pressure
        </label>
      </div>
      <div className="h-[420px] p-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartRows} margin={{ top: 12, right: 18, left: -10, bottom: 22 }}>
            <CartesianGrid stroke="#20242d" strokeDasharray="3 3" />
            <XAxis
              dataKey="time"
              tick={{ fill: "#788294", fontSize: 10 }}
              minTickGap={18}
              tickFormatter={(value) => fmtEveClockSeconds(String(value))}
            />
            <YAxis
              yAxisId="rate"
              tick={{ fill: "#788294", fontSize: 10 }}
              tickFormatter={fmtCompact}
              label={{ value: "DPS / Rep/s", angle: -90, position: "insideLeft", fill: "#8b96aa", fontSize: 10 }}
            />
            <YAxis yAxisId="jam" hide domain={[0, 1]} />
            <Tooltip content={<TimelineTooltipContent />} />
            <Legend verticalAlign="top" align="right" wrapperStyle={{ color: "#9aa7bd", fontSize: 11, paddingBottom: 8 }} />
            {engagementMarkers.map((marker) => (
              <ReferenceLine
                key={marker.key}
                yAxisId="rate"
                x={marker.time}
                stroke="#64748b"
                strokeDasharray="4 4"
                label={{ value: marker.label, fill: "#94a3b8", fontSize: 10, position: "top" }}
              />
            ))}
            <Scatter yAxisId="jam" dataKey="jamInY" name="Jammed In" fill="#c084fc" shape="diamond" legendType="diamond" isAnimationActive={false} />
            <Scatter yAxisId="jam" dataKey="jamOutY" name="Jammed Out" fill="#f472b6" shape="diamond" legendType="diamond" isAnimationActive={false} />
            <Line yAxisId="rate" type="monotone" dataKey="damageOutRate" name="Damage Out" stroke="#53b6ff" legendType="plainline" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line yAxisId="rate" type="monotone" dataKey="damageInRate" name="Damage In" stroke="#fb7185" legendType="plainline" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line yAxisId="rate" type="monotone" dataKey="repairsOutRate" name="Reps Out" stroke="#f59e0b" legendType="plainline" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line yAxisId="rate" type="monotone" dataKey="repairsInRate" name="Reps In" stroke="#3bbf5a" legendType="plainline" dot={false} strokeWidth={2} isAnimationActive={false} />
            {showCapPressure && (
              <>
                <Line yAxisId="rate" type="monotone" dataKey="capacitorOutRate" name="Cap Press. Out" stroke="#f8fafc" legendType="plainline" strokeDasharray="6 5" dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line yAxisId="rate" type="monotone" dataKey="capacitorInRate" name="Cap Press. In" stroke="#a78bfa" legendType="plainline" strokeDasharray="6 5" dot={false} strokeWidth={2} isAnimationActive={false} />
              </>
            )}
            <Brush
              dataKey="label"
              height={30}
              travellerWidth={10}
              stroke="#53b6ff"
              fill="#05070b"
              startIndex={startIndex}
              endIndex={endIndex}
              onChange={(next) => {
                if (typeof next?.startIndex !== "number" || typeof next?.endIndex !== "number") return;
                onRangeChange({ startIndex: next.startIndex, endIndex: next.endIndex });
              }}
              tickFormatter={(value) => String(value).slice(0, 8)}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function QualityChart({ report }: { report: CombatLogReport }) {
  const data = report.data.hitQuality || [];
  const chart = (
    <div className="h-[260px] p-3">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="#20242d" strokeDasharray="3 3" />
          <XAxis dataKey="quality" tick={{ fill: "#788294", fontSize: 10 }} minTickGap={8} />
          <YAxis tick={{ fill: "#788294", fontSize: 10 }} tickFormatter={fmtCompact} />
          <Tooltip
            contentStyle={{ background: "#05070b", border: "1px solid #303236", borderRadius: 0, color: "#dbeafe", fontSize: 11 }}
            formatter={(value: number, name: string) => [fmtNumber(Number(value)), name]}
          />
          <Bar dataKey="outgoing" name="Outgoing" fill="#53b6ff" />
          <Bar dataKey="incoming" name="Incoming" fill="#fb7185" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
  return (
    <details className={panel}>
      <summary className={`${panelHeader} cursor-pointer list-none`}>Hit Quality</summary>
      {chart}
    </details>
  );
}

function EventActorCell({ actor }: { actor?: CombatActor | null }) {
  if (!actor) return <td className="border-b border-[#1d222b] px-2 py-1.5 text-slate-500">-</td>;
  return (
    <td className="border-b border-[#1d222b] px-2 py-1.5">
      <div className="font-semibold text-slate-100">{actor.name || "-"}</div>
      <div className="text-[10px] text-slate-500">{actor.ship || actor.corporation ? `${actor.corporation || "-"} / ${actor.ship || "-"}` : "-"}</div>
    </td>
  );
}

function EventsTable({ events }: { events: CombatLogEvent[] }) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({ key: "time", direction: "desc" });
  const rows = useMemo(() => {
    const valueFor = (event: CombatLogEvent, key: string): string | number => {
      if (key === "time") return new Date(event.time).getTime();
      if (key === "type") return `${event.direction} ${event.kind}`;
      if (key === "actor") return event.actor?.name || "";
      if (key === "target") return event.target?.name || "";
      if (key === "module") return event.module || "";
      if (key === "amount") return Number(event.amount || 0);
      return new Date(event.time).getTime();
    };
    return [...events]
      .sort((a, b) => compareSortValues(valueFor(a, sort.key), valueFor(b, sort.key), sort.direction))
      .slice(0, 500);
  }, [events, sort]);
  const onSort = (key: string, direction: SortDirection) => setSort({ key, direction });

  return (
    <section className={panel}>
      <div className={panelHeader}>Parsed Events</div>
      <div className="max-h-[540px] overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#11151d] text-[10px] uppercase text-slate-400">
            <tr>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-left">
                <SortHeader label="Time" sortKey="time" activeKey={sort.key} direction={sort.direction} align="left" onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-left">
                <SortHeader label="Type" sortKey="type" activeKey={sort.key} direction={sort.direction} align="left" defaultDirection="asc" onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-left">
                <SortHeader label="Actor" sortKey="actor" activeKey={sort.key} direction={sort.direction} align="left" defaultDirection="asc" onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-left">
                <SortHeader label="Target" sortKey="target" activeKey={sort.key} direction={sort.direction} align="left" defaultDirection="asc" onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-left">
                <SortHeader label="Module" sortKey="module" activeKey={sort.key} direction={sort.direction} align="left" defaultDirection="asc" onSort={onSort} />
              </th>
              <th className="border-b border-[#2c2f36] px-2 py-1.5 text-right">
                <SortHeader label="Amount" sortKey="amount" activeKey={sort.key} direction={sort.direction} onSort={onSort} />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((event) => (
              <tr key={event.id} className="odd:bg-[#090b11] even:bg-[#0c0f16] hover:bg-[#141821]">
                <td className="whitespace-nowrap border-b border-[#1d222b] px-2 py-1.5 font-mono text-slate-400">{fmtEveClockSeconds(event.time)}</td>
                <td className="border-b border-[#1d222b] px-2 py-1.5 uppercase text-slate-300">{event.direction} {event.kind}</td>
                <EventActorCell actor={event.actor} />
                <EventActorCell actor={event.target} />
                <td className="border-b border-[#1d222b] px-2 py-1.5 text-slate-300">{event.module || "-"}</td>
                <td className="border-b border-[#1d222b] px-2 py-1.5 text-right font-mono text-[#53b6ff]">{event.amount ? fmtNumber(event.amount) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function CombatLogs() {
  const { id } = useParams<{ id: string }>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [report, setReport] = useState<CombatLogReport | null>(null);
  const [title, setTitle] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [timelineRange, setTimelineRange] = useState<TimelineRange | null>(null);
  const [showCapPressure, setShowCapPressure] = useState(false);
  const [ignoreDrones, setIgnoreDrones] = useState(false);

  const readAuth = useCallback(async () => {
    try {
      const data = await apiJson<{ authenticated: boolean; user: AuthUser | null }>("/api/auth/me");
      setAuthUser(data.authenticated ? data.user : null);
    } catch {
      setAuthUser(null);
    }
  }, []);

  useEffect(() => {
    void readAuth();
    const onAuthChanged = (event: Event) => {
      const detail = (event as CustomEvent<SiteAuthChangeDetail>).detail;
      setAuthUser(detail?.user || null);
    };
    window.addEventListener(SITE_AUTH_CHANGED_EVENT, onAuthChanged);
    return () => window.removeEventListener(SITE_AUTH_CHANGED_EVENT, onAuthChanged);
  }, [readAuth]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    setError(null);
    apiJson<{ ok: boolean; report: any }>(`/api/combat-logs/reports/${encodeURIComponent(id)}`)
      .then((payload) => {
        if (!alive) return;
        const next = normalizeReport(payload.report);
        setReport(next);
        setTitle(next.title);
        setSavedUrl(`/combat-logs/${next.id || id}`);
        setTimelineRange(null);
      })
      .catch((err) => alive && setError((err as Error).message || "Failed to load report."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  const parseFile = useCallback(async (file: File) => {
    setError(null);
    setSavedUrl(null);
    setTimelineRange(null);
    if (file.size > MAX_FILE_BYTES) {
      setError("That log is larger than the current 12 MB browser parse limit.");
      return;
    }
    setLoading(true);
    try {
      const text = await file.text();
      const next = parseCombatLog(text, file.name);
      if (!next.summary.combatEvents) throw new Error("No combat events were found in that log.");
      setReport(next);
      setTitle(next.title);
      setActiveTab("overview");
    } catch (err) {
      setError((err as Error).message || "Failed to parse combat log.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const file = Array.from(files)[0];
    if (file) void parseFile(file);
  }, [parseFile]);

  async function shareReport() {
    if (!report) return;
    const reportToSave = compactReportForShare(timelineReport || report);
    setSharing(true);
    setError(null);
    try {
      const payload = await apiJson<{ ok: boolean; id: string; url: string; report: any }>("/api/combat-logs/reports", {
        method: "POST",
        body: JSON.stringify({
          report: {
            ...reportToSave,
            title: title.trim() || reportToSave.title,
          },
        }),
      });
      const next = normalizeReport(payload.report);
      setReport(next);
      setTitle(next.title);
      setSavedUrl(payload.url);
      copyUrl(payload.url);
    } catch (err) {
      setError((err as Error).message || "Failed to share report.");
    } finally {
      setSharing(false);
    }
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "damage", label: "Damage" },
    { key: "capacitor", label: "Capacitor" },
    { key: "ewar", label: "EWAR" },
    { key: "events", label: "Events" },
  ];

  const timelineReport = useMemo(() => (report ? scopedReport(report, null, { ignoreDrones }) : null), [report, ignoreDrones]);
  const activeReport = useMemo(() => (timelineReport ? scopedReport(timelineReport, timelineRange) : null), [timelineReport, timelineRange]);
  const activeBounds = useMemo(() => (timelineReport ? rangeBounds(timelineReport, timelineRange) : null), [timelineReport, timelineRange]);
  const timelineSelectionActive = Boolean(timelineReport && activeBounds && !isFullRange(timelineReport, timelineRange));
  const topEvents = useMemo(() => activeReport?.data.events || [], [activeReport]);

  return (
    <div className="tt-tool-v2 tt2-report-page tt2-combat-logs min-h-screen px-2 py-3 text-slate-100 sm:px-4 sm:py-5">
      <div className="tt2-window mx-auto max-w-[1320px]">
        <Header report={activeReport || report} />

        <div className="space-y-3 p-2 sm:p-3">
        {error && (
          <section className="flex items-center gap-2 border border-[#5f2630] bg-[#16080c] px-3 py-3 text-[12px] text-[#ff9aa3]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </section>
        )}

        <section className="border border-[#222a36] bg-[#05070b]/90 p-2 shadow-[0_0_40px_rgba(0,0,0,0.55)] sm:p-3">
        <div className="grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <section className={panel}>
              <div className={panelHeader}>Source Log</div>
              <div
                className={classNames(
                  "m-3 flex min-h-[200px] cursor-pointer flex-col items-center justify-center border border-dashed px-4 text-center transition",
                  dragActive ? "border-[#53b6ff] bg-[#08131e]" : "border-[#27313d] bg-[#04070c] hover:border-[#415064]"
                )}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  handleFiles(event.dataTransfer.files);
                }}
              >
                <Upload className="h-8 w-8 text-[#53b6ff]" />
                <div className="mt-3 text-[12px] font-semibold text-slate-200">Drop Gamelog file</div>
                <div className="mt-1 text-[11px] text-slate-500">.txt or .log, parsed locally first</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.log,text/plain"
                  className="hidden"
                  onChange={(event) => event.currentTarget.files && handleFiles(event.currentTarget.files)}
                />
              </div>
              <div className="border-t border-[#252a33] px-3 py-2 text-[11px] text-slate-400">
                <div className="flex justify-between gap-3">
                  <span>File</span>
                  <span className="truncate text-slate-200">{report?.fileName || "None"}</span>
                </div>
                <div className="mt-1 flex justify-between gap-3">
                  <span>Parse</span>
                  <span className="font-mono text-[#53b6ff]">{report ? `${Math.round(Number(report.summary.parseRatio || 0) * 100)}%` : "0%"}</span>
                </div>
              </div>
            </section>

            <section className={panel}>
              <div className={panelHeader}>Share Report</div>
              <div className="space-y-2 p-3">
                <label className="block text-[10px] uppercase text-slate-500">Report Label</label>
                <input className={inputClass} value={title} disabled={!report || Boolean(id)} onChange={(event) => setTitle(event.target.value)} />
                <div className={classNames("grid gap-2", savedUrl || !authUser ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-2" : "grid-cols-1")}>
                  <button type="button" className={buttonPrimary} disabled={!report || sharing || Boolean(id)} onClick={() => void shareReport()}>
                    {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                    Share
                  </button>
                  {savedUrl ? (
                    <button type="button" className={buttonSecondary} onClick={() => copyUrl(savedUrl)}>
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </button>
                  ) : !authUser ? (
                    <button type="button" className={buttonSecondary} onClick={() => requestSiteAuthModal("login")}>
                      <LogIn className="h-3.5 w-3.5" />
                      Sign In
                    </button>
                  ) : (
                    null
                  )}
                </div>
                {savedUrl && (
                  <Link to={savedUrl} target="_blank" rel="noreferrer" className={`${buttonSecondary} w-full`}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Shared Link
                  </Link>
                )}
                <div className="border border-[#252a33] bg-[#05070b] px-2 py-2 text-[10px] uppercase text-slate-500">
                  {authUser ? "Shared links save to account workspace." : "Sign in before sharing to save the link to your workspace."}
                </div>
              </div>
            </section>

            {report && (
              <section className={panel}>
                <div className={panelHeader}>Diagnostics</div>
                <div className="space-y-1 p-3 text-[11px] text-slate-400">
                  <div className="flex justify-between"><span>Total lines</span><span className="font-mono text-slate-200">{fmtNumber(report.summary.totalLines)}</span></div>
                  <div className="flex justify-between"><span>Parsed log lines</span><span className="font-mono text-slate-200">{fmtNumber(report.summary.parsedLines)}</span></div>
                  <div className="flex justify-between"><span>Unparsed combat</span><span className="font-mono text-[#ffb073]">{fmtNumber(report.data.diagnostics?.unparsedCombatLines)}</span></div>
                  {Number(report.data.diagnostics?.capBoosterReloads || 0) > 0 && (
                    <div className="flex justify-between"><span>Cap booster reloads</span><span className="font-mono text-[#a78bfa]">{fmtNumber(report.data.diagnostics?.capBoosterReloads)}</span></div>
                  )}
                  {ignoreDrones && Number(timelineReport?.data.diagnostics?.droneEventsIgnored || 0) > 0 && (
                    <div className="flex justify-between"><span>Drone events ignored</span><span className="font-mono text-[#f59e0b]">{fmtNumber(timelineReport?.data.diagnostics?.droneEventsIgnored)}</span></div>
                  )}
                  <div className="flex justify-between"><span>Engagements</span><span className="font-mono text-[#53b6ff]">{fmtNumber(report.data.engagements.length)}</span></div>
                </div>
              </section>
            )}
          </aside>

          <main className="min-w-0 space-y-3">
            {loading && (
              <div className="flex min-h-[360px] items-center justify-center border border-[#2c2f36] bg-[#070910] text-[12px] text-slate-400">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin text-[#53b6ff]" />
                Loading combat report...
              </div>
            )}

            {!loading && !report && <EmptyWorkbench />}

            {!loading && report && activeReport && (
              <>
                {timelineSelectionActive && activeBounds && (
                  <section className="flex flex-wrap items-center justify-between gap-2 border border-[#27313d] bg-[#080d15] px-3 py-2 text-[10px] uppercase text-slate-400">
                    <span>
                      Timeline Window: <span className="font-mono text-slate-200">{fmtEveTimeSeconds(activeBounds.startTime)} - {fmtEveTimeSeconds(activeBounds.endTime)} ET</span>
                    </span>
                    <button type="button" className="border border-[#303236] bg-[#05070b] px-2 py-1 font-bold text-slate-300 hover:border-[#53b6ff]/60" onClick={() => setTimelineRange(null)}>
                      Reset Window
                    </button>
                  </section>
                )}
                <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <StatBox label="Damage Out" value={fmtNumber(activeReport.summary.damageOut)} accent="text-[#53b6ff]" />
                  <StatBox label="Damage In" value={fmtNumber(activeReport.summary.damageIn)} accent="text-[#fb7185]" />
                  <StatBox label="Reps Out" value={fmtNumber(activeReport.summary.repairsOut)} accent="text-[#f59e0b]" />
                  <StatBox label="Reps In" value={fmtNumber(activeReport.summary.repairsIn)} accent="text-[#3bbf5a]" />
                  <StatBox label="Active DPS" value={fmtNumber(activeReport.summary.activeDpsOut ?? activeReport.summary.dpsOut, 1)} />
                  <StatBox label="Cap Pressure Out" value={`${fmtNumber(activeReport.summary.capacitorOut)} GJ`} accent="text-[#53b6ff]" />
                  <StatBox label="Cap Pressure In" value={`${fmtNumber(activeReport.summary.capacitorIn)} GJ`} accent="text-[#fb7185]" />
                  <StatBox label="Targets" value={fmtNumber(activeReport.summary.targets)} />
                  <StatBox label="Attackers" value={fmtNumber(activeReport.summary.attackers)} />
                  <StatBox label="Time In Combat" value={fmtDuration(activeReport.summary.durationSeconds)} />
                </section>

                <div className="flex flex-wrap items-center justify-between gap-2 border border-[#2c2f36] bg-[#05070b] p-1">
                  <div className="flex flex-wrap gap-1">
                    {tabs.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        className={classNames(
                          "h-8 border px-3 text-[10px] font-bold uppercase text-slate-300",
                          activeTab === tab.key
                            ? "border-[#53b6ff]/70 bg-[#102234] text-[#dff5ff]"
                            : "border-transparent bg-transparent hover:border-[#303236] hover:bg-[#101219]"
                        )}
                        onClick={() => setActiveTab(tab.key)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <label className="mr-2 flex h-8 cursor-pointer items-center gap-2 px-2 text-[10px] font-bold uppercase text-slate-400">
                    <input
                      type="checkbox"
                      checked={ignoreDrones}
                      onChange={(event) => setIgnoreDrones(event.currentTarget.checked)}
                      className="h-3.5 w-3.5 border-[#303236] bg-[#05070b] text-[#53b6ff]"
                    />
                    Ignore drones
                  </label>
                </div>

                {activeTab === "overview" && (
                  <div className="space-y-3">
                    <TimelineChart
                      report={timelineReport || report}
                      range={timelineRange}
                      onRangeChange={setTimelineRange}
                      showCapPressure={showCapPressure}
                      onShowCapPressureChange={setShowCapPressure}
                    />
                    <div className="grid gap-3 2xl:grid-cols-2">
                      <MetricTable title="Top Outgoing Targets" rows={activeReport.data.topDamageOutTargets} amountLabel="Damage" />
                      <MetricTable title="Top Incoming Sources" rows={activeReport.data.topDamageInSources} amountLabel="Damage" />
                    </div>
                    <div className="grid gap-3 2xl:grid-cols-2">
                      <MetricTable title="Repair Targets" rows={activeReport.data.repairTargets} amountLabel="HP" />
                      <MetricTable title="Repair Sources" rows={activeReport.data.repairSources} amountLabel="HP" />
                    </div>
                    <QualityChart report={activeReport} />
                  </div>
                )}

                {activeTab === "damage" && (
                  <div className="grid gap-3 2xl:grid-cols-2">
                    <MetricTable title="Damage Out By Target" rows={activeReport.data.topDamageOutTargets} amountLabel="Damage" />
                    <MetricTable title="Damage In By Source" rows={activeReport.data.topDamageInSources} amountLabel="Damage" />
                    <MetricTable title="Repair Out By Target" rows={activeReport.data.repairTargets} amountLabel="HP" />
                    <MetricTable title="Repair In By Source" rows={activeReport.data.repairSources} amountLabel="HP" />
                    <ModuleTable title="Outgoing Weapons" rows={activeReport.data.outgoingWeapons} />
                    <ModuleTable title="Incoming Weapons" rows={activeReport.data.incomingWeapons} />
                  </div>
                )}

                {activeTab === "capacitor" && (
                  <div className="grid gap-3 2xl:grid-cols-2">
                    <MetricTable title="Cap Pressure Out" rows={activeReport.data.capacitorTargets} amountLabel="GJ" />
                    <MetricTable title="Cap Pressure In Sources" rows={activeReport.data.capacitorSources} amountLabel="GJ" />
                  </div>
                )}

                {activeTab === "ewar" && (
                  <div className="grid gap-3 2xl:grid-cols-2">
                    <EventMetricTable title="EWAR Out By Target" rows={activeReport.data.ewarTargets} />
                    <EventMetricTable title="EWAR In Sources" rows={activeReport.data.ewarSources} />
                    <EventMetricTable title="EWAR Out By Ship Type" rows={ewarShipRows(activeReport.data.ewarTargets)} />
                    <EventModuleTable title="EWAR Modules" rows={activeReport.data.ewarModules} />
                  </div>
                )}

                {activeTab === "events" && (
                  <div className="space-y-3">
                    <section className={panel}>
                      <div className={panelHeader}>Engagement Windows</div>
                      <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
                        {activeReport.data.engagements.slice(0, 9).map((row) => (
                          <div key={row.id} className="border border-[#252a33] bg-[#05070b] px-2 py-2 text-[11px]">
                            <div className="flex items-center gap-2 text-slate-100">
                              <BarChart3 className="h-3.5 w-3.5 text-[#53b6ff]" />
                              {fmtEveClockSeconds(row.startTime)} - {fmtEveClockSeconds(row.endTime)}
                            </div>
                            <div className="mt-1 grid grid-cols-3 gap-2 text-[10px] uppercase text-slate-500">
                              <span>{fmtDuration(row.durationSeconds)}</span>
                              <span className="text-[#53b6ff]">{fmtCompact(row.damageOut)} out</span>
                              <span className="text-[#fb7185]">{fmtCompact(row.damageIn)} in</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                    <EventsTable events={topEvents} />
                  </div>
                )}
              </>
            )}
          </main>
        </div>
        </section>
        </div>
      </div>
    </div>
  );
}
