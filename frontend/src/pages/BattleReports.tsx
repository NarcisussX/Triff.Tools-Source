/*
 * React page for /br and /br/:id.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import { CSSProperties, DragEvent as ReactDragEvent, FormEvent, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LayoutGroup, animate, motion, useMotionValue, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  ExternalLink,
  GripVertical,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Star,
  Trash2,
} from "lucide-react";
import { ToolChrome } from "../components/tool-ui";

type ParticipantShip = {
  key: string;
  ship_type_id: number | null;
  ship_name: string;
  ship_group_name?: string | null;
  ship_class?: string | null;
  ship_class_rank?: number | null;
  loss_count: number;
  isk_lost: number;
  amount_tanked?: number;
  damage_taken?: number;
  tanked?: number;
  kills_on: number;
  damage_done: number;
  final_blows: number;
  loss_killmail_ids?: number[];
  zkill_url?: string | null;
};

type Participant = {
  key: string;
  character_id: number | null;
  character_name: string;
  ship_type_id: number | null;
  ship_name: string;
  ship_group_name?: string | null;
  ship_class?: string | null;
  ship_class_rank?: number | null;
  ship_count?: number;
  ships?: ParticipantShip[];
  corporation_id?: number | null;
  corporation_name?: string | null;
  alliance_id?: number | null;
  alliance_name?: string | null;
  loss_count: number;
  isk_lost: number;
  amount_tanked?: number;
  damage_taken?: number;
  tanked?: number;
  kills_on: number;
  damage_done: number;
  final_blows: number;
  zkill_url?: string | null;
};

type Entity = {
  key: string;
  kind: string;
  id: number;
  name: string;
  side_id: string;
  ships_lost: number;
  isk_lost: number;
  damage_done: number;
  final_blows: number;
  pilot_count?: number;
  corporation_count?: number;
  alliance_count?: number;
};

type EntityMove = {
  entity: Entity;
  sourceSideId: string;
  targetSideId: string;
};

type DraggedEntity = Omit<EntityMove, "targetSideId">;

type EntityMoveNotice = {
  kind: "success" | "error";
  message: string;
  undo?: {
    entity: Entity;
    sourceSideId: string;
    targetSideId: string;
    previousOverride: string | null;
  };
};

type Side = {
  id: string;
  name: string;
  iskLost: number;
  iskKilled: number;
  efficiency: number;
  shipsLost: number;
  pilotCount: number;
  corporationCount: number;
  allianceCount: number;
  damageDone: number;
  finalBlows: number;
  shipLosses: { type_id: number | null; name: string; count: number; value: number }[];
  participants?: Participant[];
  entities?: Entity[];
};

type KillRow = {
  killmail_id: number;
  killmail_time: string;
  solar_system_id: number;
  system_name: string;
  total_value: number;
  damage_taken?: number;
  amount_tanked?: number;
  victim_name: string;
  victim_character_id?: number | null;
  victim_corporation_id?: number | null;
  victim_corporation_name?: string | null;
  victim_alliance_id?: number | null;
  victim_alliance_name?: string | null;
  victim_ship_type_id: number | null;
  victim_ship_name: string;
  victim_side_id: string;
  final_blow_name: string;
  final_blow_character_id?: number | null;
  final_blow_corporation_id?: number | null;
  final_blow_alliance_id?: number | null;
  zkill_url: string;
};

type BattleReport = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  system_id: number | null;
  system_name: string | null;
  start_time: string | null;
  end_time: string | null;
  value_mode: string;
  source_mode: string;
  summary: {
    totalIskDestroyed: number;
    totalKills: number;
    shipsLost?: number;
    totalPilots?: number;
    totalParticipants?: number;
    durationMinutes?: number;
    sideCount: number;
    valueMode: string;
    excludedKills?: number;
  };
  sides: Side[];
  entities: Entity[];
  side_overrides: Record<string, string>;
  side_names: Record<string, string>;
  revision: number;
  live: {
    status: "scheduled" | "live" | "final";
    source: "zkill-r2z2";
    acceptsUntil: string | null;
    lastUpdateAt: string | null;
  };
  data: {
    killmails: KillRow[];
    generated_at: string;
    discovery?: Record<string, number | string | null>;
    exclusions?: {
      entity_keys?: string[];
      killmail_count?: number;
      killmail_ids?: number[];
    };
    r2z2_note?: string;
  };
};

type LiveEvent = {
  revision: number;
  status: "scheduled" | "live" | "final";
  updatedAt: string | null;
  totalKills: number;
  newKillCount: number;
};

type LiveChangeSet = {
  revision: number;
  addedParticipants: Set<string>;
  lossIncreased: Set<string>;
  movedParticipants: Set<string>;
  newTopDamage: Set<string>;
  addedKillmails: Set<number>;
};

const EMPTY_LIVE_CHANGES: LiveChangeSet = {
  revision: 0,
  addedParticipants: new Set(),
  lossIncreased: new Set(),
  movedParticipants: new Set(),
  newTopDamage: new Set(),
  addedKillmails: new Set(),
};

type AnalyzeJob = {
  job_id: string;
  status: "queued" | "running" | "complete" | "error";
  message?: string;
  report_id?: string;
  error?: string;
  created_at?: string;
  updated_at?: string;
};

type SystemSearchResult = {
  id: number;
  name: string;
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

type TabKey = "participants" | "kills" | "composition" | "editor";

const EVE_KILL_BASE = "https://eve-kill.com";
const EXCLUDED_SIDE_ID = "side_excluded";
function eveKillUrlFromMaybeZkill(url?: string | null) {
  if (!url) return null;
  const killMatch = String(url).match(/zkillboard\.com\/kill\/(\d+)/i);
  if (killMatch) return `${EVE_KILL_BASE}/kill/${killMatch[1]}`;
  return url.replace(/\/+$/, "");
}
function eveKillKillmailUrl(id?: number | null) {
  return id ? `${EVE_KILL_BASE}/kill/${id}` : null;
}
function openExternal(url?: string | null) {
  const next = eveKillUrlFromMaybeZkill(url);
  if (!next) return;
  window.open(next, "_blank", "noopener,noreferrer");
}
function zkillEntityUrl(kind?: string | null, id?: number | null) {
  if (!id) return null;
  if (kind === "character") return `${EVE_KILL_BASE}/character/${id}`;
  if (kind === "corporation") return `${EVE_KILL_BASE}/corporation/${id}`;
  if (kind === "alliance") return `${EVE_KILL_BASE}/alliance/${id}`;
  if (kind === "faction") return `${EVE_KILL_BASE}/faction/${id}`;
  return null;
}

const fmtIsk = (value?: number) => {
  const n = Number(value || 0);
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(n >= 10_000_000_000_000 ? 1 : 2)}T`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 1 : 2)}b`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
};

const amountTankedFrom = (row?: { amount_tanked?: number; damage_taken?: number; tanked?: number } | null) =>
  Number(row?.amount_tanked ?? row?.damage_taken ?? row?.tanked ?? 0) || 0;

function participantLossCount(participant: Participant) {
  if (Array.isArray(participant.ships) && participant.ships.length) {
    return participant.ships.reduce((total, ship) => total + Number(ship.loss_count || 0), 0);
  }
  return Number(participant.loss_count || 0);
}

function participantIndex(report: BattleReport) {
  const out = new Map<string, { sideId: string; participant: Participant }>();
  for (const side of report.sides || []) {
    for (const participant of side.participants || []) out.set(participant.key, { sideId: side.id, participant });
  }
  return out;
}

function topDamageKeys(report: BattleReport) {
  const out = new Set<string>();
  for (const side of report.sides || []) {
    const participants = side.participants || [];
    const top = participants.reduce((best, participant) => Math.max(best, Number(participant.damage_done || 0)), 0);
    if (!top) continue;
    for (const participant of participants) {
      if (Number(participant.damage_done || 0) === top) out.add(`${side.id}:${participant.key}`);
    }
  }
  return out;
}

function diffBattleReports(previous: BattleReport, next: BattleReport): LiveChangeSet {
  const before = participantIndex(previous);
  const after = participantIndex(next);
  const oldTopDamage = topDamageKeys(previous);
  const nextTopDamage = topDamageKeys(next);
  const previousKillmails = new Set((previous.data?.killmails || []).map((kill) => Number(kill.killmail_id)));
  const changes: LiveChangeSet = {
    revision: Number(next.revision || 0),
    addedParticipants: new Set(),
    lossIncreased: new Set(),
    movedParticipants: new Set(),
    newTopDamage: new Set(),
    addedKillmails: new Set(),
  };

  for (const [key, current] of after) {
    const prior = before.get(key);
    if (!prior) changes.addedParticipants.add(key);
    else {
      if (participantLossCount(current.participant) > participantLossCount(prior.participant)) changes.lossIncreased.add(key);
      if (current.sideId !== prior.sideId) changes.movedParticipants.add(key);
    }
    const topKey = `${current.sideId}:${key}`;
    if (nextTopDamage.has(topKey) && !oldTopDamage.has(topKey)) changes.newTopDamage.add(topKey);
  }
  const addedKillmails = (next.data?.killmails || [])
    .filter((kill) => !previousKillmails.has(Number(kill.killmail_id)))
    .slice(-6);
  for (const kill of addedKillmails) changes.addedKillmails.add(Number(kill.killmail_id));
  return changes;
}

const fmtDate = (value?: string | null) => {
  if (!value) return "—";
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
};

const fmtDuration = (mins?: number) => {
  const n = Math.max(0, Number(mins || 0));
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
};

const toEveDateInput = (date: Date) => date.toISOString().slice(0, 10);
const toEveTimeInput = (date: Date) => date.toISOString().slice(11, 16);
const isEveClock = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const combineEveDateTime = (date: string, clock: string) => (date && clock ? `${date}T${clock}:00Z` : "");

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function maskEveClock(raw: string) {
  const value = raw.trim();

  if (value.includes(":")) {
    const [rawHour = "", rawMinute = ""] = value.split(":");
    const hour = rawHour.replace(/\D/g, "").slice(0, 2);
    const minute = rawMinute.replace(/\D/g, "").slice(0, 2);
    return `${hour}:${minute}`;
  }

  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function finalizeEveClock(raw: string) {
  const value = raw.trim();
  let hour = 0;
  let minute = 0;

  if (value.includes(":")) {
    const [rawHour = "0", rawMinute = "0"] = value.split(":");
    hour = Number(rawHour.replace(/\D/g, "") || 0);
    minute = Number(rawMinute.replace(/\D/g, "") || 0);
  } else {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 2) {
      hour = Number(digits || 0);
      minute = 0;
    } else {
      hour = Number(digits.slice(0, -2) || 0);
      minute = Number(digits.slice(-2) || 0);
    }
  }

  hour = clamp(Number.isFinite(hour) ? hour : 0, 0, 23);
  minute = clamp(Number.isFinite(minute) ? minute : 0, 0, 59);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function addClockMinutes(clock: string, delta: number) {
  const normalized = finalizeEveClock(clock);
  const [hh, mm] = normalized.split(":").map(Number);
  const next = (hh * 60 + mm + delta + 24 * 60) % (24 * 60);
  return `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
}

function api<T>(url: string, opts: RequestInit = {}): Promise<T> {
  return fetch(url, {
    cache: "no-store",
    credentials: "include",
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  }).then(async (res) => {
    const text = await res.text();
    const contentType = res.headers.get("content-type") || "";
    let json: any = null;

    if (text && contentType.includes("application/json")) {
      try {
        json = JSON.parse(text);
      } catch (_err) {
        throw new Error(`API returned malformed JSON from ${url}: ${text.slice(0, 180)}`);
      }
    }

    if (!res.ok) {
      if (json?.error) throw new Error(json.error);
      if (text.trim().startsWith("<")) {
        throw new Error(`API returned HTML instead of JSON from ${url}. This usually means nginx/Traefik returned a timeout or backend error page before Express could respond.`);
      }
      throw new Error(text || `HTTP ${res.status}`);
    }

    if (!contentType.includes("application/json")) {
      if (text.trim().startsWith("<")) {
        throw new Error(`API returned HTML instead of JSON from ${url}. This usually means nginx/Traefik returned a timeout or backend error page.`);
      }
      throw new Error(`API returned non-JSON response from ${url}: ${text.slice(0, 180)}`);
    }

    return json as T;
  });
}

function iconUrl(kind: string, id?: number | null, size = 32) {
  if (!id) return "";
  if (kind === "alliance") return `https://images.evetech.net/alliances/${id}/logo?size=${size}`;
  if (kind === "corporation") return `https://images.evetech.net/corporations/${id}/logo?size=${size}`;
  if (kind === "character") return `https://images.evetech.net/characters/${id}/portrait?size=${size}`;
  return "";
}

function Panel({
  title,
  right,
  children,
  className = "",
  allowOverflow = false,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  allowOverflow?: boolean;
}) {
  return (
    <section className={`${allowOverflow ? "overflow-visible" : "overflow-hidden"} border border-[#2c2f36] bg-[#070910] shadow-[0_0_20px_rgba(0,0,0,0.28)] ${className}`}>
      {title && (
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b border-[#2c2f36] bg-[#101219] px-3 py-2">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#d7e9ff]">{title}</div>
          {right && <div className="text-[11px] text-slate-500">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

function inputClass(extra = "") {
  return `w-full border border-[#1d2938] bg-[#04070c] px-2.5 py-2 text-[12px] text-slate-200 outline-none transition placeholder:text-slate-700 focus:border-[#4b8fd6] ${extra}`;
}

function buttonClass(extra = "") {
  return `inline-flex min-h-9 items-center justify-center gap-2 border border-[#3a4655] bg-[#101219] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-100 transition hover:border-[#5f9edb] hover:bg-[#141a23] disabled:cursor-not-allowed disabled:opacity-50 ${extra}`;
}

function EveTimeInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <input
      className={inputClass("py-1.5 font-mono tabular-nums")}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="HH:mm"
      value={value}
      onChange={(e) => onChange(maskEveClock(e.target.value))}
      onBlur={() => onChange(finalizeEveClock(value))}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          onChange(addClockMinutes(value, e.shiftKey ? 60 : 1));
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          onChange(addClockMinutes(value, e.shiftKey ? -60 : -1));
        }
      }}
      aria-label="24-hour EVE time"
    />
  );
}

type ScopeInput = {
  id: string;
  systemQuery: string;
  startValue: string;
  endValue: string;
};

const toEveDateTimeField = (date: Date) => date.toISOString().slice(0, 16);
const normalizeEveDateTimeField = (value: string) => value.trim().replace(" ", "T").slice(0, 16);
const isEveDateTimeField = (value: string) => /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalizeEveDateTimeField(value));
const eveDateTimeFieldToIso = (value: string) => `${normalizeEveDateTimeField(value)}:00Z`;
const newScopeId = () => `scope_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function splitEveDateTimeField(value: string) {
  const normalized = normalizeEveDateTimeField(value);
  const [rawDate = "", rawTime = "00:00"] = normalized.split("T");
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : toEveDateInput(new Date());
  const safeTime = isEveClock(rawTime) ? rawTime : "00:00";
  const [hour = "00", minute = "00"] = safeTime.split(":");
  return { date: safeDate, hour, minute };
}

function formatEveDateTimeDisplay(value: string) {
  const { date, hour, minute } = splitEveDateTimeField(value);
  return `${date} ${hour}:${minute}`;
}

function monthName(date: Date) {
  return date.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
}

function EveDateTimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const calendarRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({ left: 0, above: false });
  const { date, hour, minute } = splitEveDateTimeField(value);
  const selectedDate = new Date(`${date}T00:00:00Z`);
  const [viewMonth, setViewMonth] = useState<Date>(() => new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), 1)));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) setViewMonth(new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), 1)));

  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    const updatePlacement = () => {
      if (!rootRef.current || !calendarRef.current) return;
      const rootRect = rootRef.current.getBoundingClientRect();
      const calendarRect = calendarRef.current.getBoundingClientRect();
      const viewportPadding = 8;
      const gap = 4;
      const maxViewportLeft = Math.max(viewportPadding, window.innerWidth - calendarRect.width - viewportPadding);
      const viewportLeft = clamp(rootRect.left, viewportPadding, maxViewportLeft);
      const spaceBelow = window.innerHeight - rootRect.bottom - gap - viewportPadding;
      const spaceAbove = rootRect.top - gap - viewportPadding;
      const next = {
        left: viewportLeft - rootRect.left,
        above: calendarRect.height > spaceBelow && spaceAbove > spaceBelow,
      };
      setPlacement((current) =>
        current.left === next.left && current.above === next.above ? current : next
      );
    };

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open]);

  const setPart = (patch: Partial<{ date: string; hour: string; minute: string }>) => {
    const nextDate = patch.date ?? date;
    const nextHour = patch.hour ?? hour;
    const nextMinute = patch.minute ?? minute;
    onChange(`${nextDate}T${nextHour}:${nextMinute}`);
  };

  const addTime = (kind: "hour" | "minute", delta: number) => {
    const current = Number(kind === "hour" ? hour : minute) || 0;
    const limit = kind === "hour" ? 24 : 60;
    const next = (current + delta + limit) % limit;
    setPart({ [kind]: String(next).padStart(2, "0") } as Partial<{ hour: string; minute: string }>);
  };

  const firstOfMonth = new Date(Date.UTC(viewMonth.getUTCFullYear(), viewMonth.getUTCMonth(), 1));
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setUTCDate(gridStart.getUTCDate() + i);
    return d;
  });

  const changeMonth = (delta: number) => {
    setViewMonth((old) => new Date(Date.UTC(old.getUTCFullYear(), old.getUTCMonth() + delta, 1)));
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`${inputClass("flex h-[34px] items-center justify-between py-1.5 font-mono tabular-nums text-left")} hover:border-[#426081]`}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{formatEveDateTimeDisplay(value)}</span>
        <Calendar className="h-3.5 w-3.5 text-slate-500" />
      </button>

      {open && (
        <div
          ref={calendarRef}
          className="absolute z-50 w-[min(270px,calc(100vw-16px))] border border-[#28364a] bg-[#1b1b1b] p-2.5 text-[12px] text-slate-200 shadow-[0_18px_60px_rgba(0,0,0,0.72)]"
          style={placement.above ? { bottom: 38, left: placement.left } : { top: 38, left: placement.left }}
        >
          <div className="mb-2 flex items-center justify-between">
            <button type="button" className="px-1.5 py-1 text-slate-400 hover:text-white" onClick={() => changeMonth(-1)}>‹</button>
            <div className="flex items-center gap-2 font-bold text-slate-300">
              <span>{monthName(viewMonth)}</span>
              <span>{viewMonth.getUTCFullYear()}</span>
            </div>
            <button type="button" className="px-1.5 py-1 text-slate-400 hover:text-white" onClick={() => changeMonth(1)}>›</button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-slate-400">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <div key={d}>{d}</div>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1 text-center">
            {days.map((d) => {
              const dayValue = d.toISOString().slice(0, 10);
              const muted = d.getUTCMonth() !== viewMonth.getUTCMonth();
              const selected = dayValue === date;
              return (
                <button
                  key={dayValue}
                  type="button"
                  className={`h-7 border text-[12px] ${selected ? "border-[#4aa3ff] bg-[#1897ff] font-bold text-white" : muted ? "border-transparent text-slate-600 hover:border-[#33445b]" : "border-transparent text-slate-300 hover:border-[#4b5c72] hover:bg-[#2a2d32]"}`}
                  onClick={() => setPart({ date: dayValue })}
                >
                  {d.getUTCDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-center gap-2">
            <Clock className="h-4 w-4 text-[#6daeea]" />
            <div className="grid grid-cols-[34px_8px_34px] items-center justify-center gap-1 text-center font-mono">
              <button type="button" className="col-start-1 text-slate-400 hover:text-white" onClick={() => addTime("hour", 1)}>⌃</button>
              <span />
              <button type="button" className="col-start-3 text-slate-400 hover:text-white" onClick={() => addTime("minute", 1)}>⌃</button>
              <input className="h-8 border border-[#313a47] bg-[#10151d] text-center text-slate-100" value={hour} onChange={(e) => setPart({ hour: String(clamp(Number(e.target.value.replace(/\D/g, "") || 0), 0, 23)).padStart(2, "0") })} />
              <span className="text-slate-500">:</span>
              <input className="h-8 border border-[#313a47] bg-[#10151d] text-center text-slate-100" value={minute} onChange={(e) => setPart({ minute: String(clamp(Number(e.target.value.replace(/\D/g, "") || 0), 0, 59)).padStart(2, "0") })} />
              <button type="button" className="col-start-1 text-slate-400 hover:text-white" onClick={() => addTime("hour", -1)}>⌄</button>
              <span />
              <button type="button" className="col-start-3 text-slate-400 hover:text-white" onClick={() => addTime("minute", -1)}>⌄</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SystemSearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<SystemSearchResult[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const query = value.trim();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (query.length < 2) {
      setOptions([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await api<SystemSearchResult[]>(`/api/br/systems/search?q=${encodeURIComponent(query)}`);
        if (cancelled) return;
        setOptions(rows || []);
        setHighlighted(0);
        setOpen(true);
      } catch (_err) {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const pick = (system: SystemSearchResult) => {
    onChange(system.name);
    setOpen(false);
    setOptions([]);
  };

  const exactMatch = options.some((row) => row.name.toLowerCase() === query.toLowerCase());
  const showNoResults = open && query.length >= 3 && !loading && options.length === 0;
  const showHint = query.length >= 3 && !loading && options.length > 0 && !exactMatch;

  return (
    <div ref={rootRef} className="relative">
      <input
        className={inputClass("py-1.5")}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (query.length >= 2 && options.length) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            setOpen(true);
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((old) => Math.min(old + 1, Math.max(options.length - 1, 0)));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((old) => Math.max(old - 1, 0));
          }
          if (e.key === "Enter" && open && options[highlighted]) {
            e.preventDefault();
            pick(options[highlighted]);
          }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Enter system"
        autoComplete="off"
        spellCheck={false}
      />

      {(open && (options.length > 0 || showNoResults || loading)) && (
        <div className="absolute left-0 right-0 top-[36px] z-50 overflow-hidden border border-[#28364a] bg-[#050a11] shadow-[0_18px_60px_rgba(0,0,0,0.72)]">
          {loading && <div className="px-2.5 py-2 text-[11px] text-slate-500">Searching systems…</div>}

          {!loading && options.map((system, idx) => (
            <button
              key={system.id}
              type="button"
              className={`flex w-full items-center justify-between px-2.5 py-2 text-left text-[12px] ${idx === highlighted ? "bg-[#112033] text-[#d7e9ff]" : "text-slate-300 hover:bg-[#0d1826] hover:text-[#d7e9ff]"}`}
              onMouseEnter={() => setHighlighted(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(system);
              }}
            >
              <span className="font-semibold">{system.name}</span>
              <span className="font-mono text-[10px] text-slate-600">{system.id}</span>
            </button>
          ))}

          {showNoResults && <div className="px-2.5 py-2 text-[11px] text-red-300">No matching systems found.</div>}
        </div>
      )}

      {showHint && !open && (
        <div className="mt-1 text-[10px] text-[#7aa7d4]">Select a matching system from the dropdown, or keep typing.</div>
      )}
    </div>
  );
}

function CreateReport({ onCreated }: { onCreated: (id: string) => void }) {
  const now = new Date();
  const defaultStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const [scopes, setScopes] = useState<ScopeInput[]>([
    {
      id: newScopeId(),
      systemQuery: "",
      startValue: toEveDateTimeField(defaultStart),
      endValue: toEveDateTimeField(now),
    },
  ]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [jobMessage, setJobMessage] = useState("");

  const updateScope = (id: string, patch: Partial<ScopeInput>) => {
    setScopes((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addScope = () => {
    const last = scopes[scopes.length - 1];
    setScopes((rows) => [
      ...rows,
      {
        id: newScopeId(),
        systemQuery: "",
        startValue: last?.startValue || toEveDateTimeField(defaultStart),
        endValue: last?.endValue || toEveDateTimeField(now),
      },
    ]);
  };

  const removeScope = (id: string) => {
    setScopes((rows) => (rows.length <= 1 ? rows : rows.filter((row) => row.id !== id)));
  };

  const clearScopes = () => {
    setScopes([
      {
        id: newScopeId(),
        systemQuery: "",
        startValue: toEveDateTimeField(defaultStart),
        endValue: toEveDateTimeField(now),
      },
    ]);
    setTitle("");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setJobMessage("");
    try {
      const parsedScopes = scopes
        .map((scope) => ({
          systemQuery: scope.systemQuery.trim(),
          startValue: normalizeEveDateTimeField(scope.startValue),
          endValue: normalizeEveDateTimeField(scope.endValue),
        }))
        .filter((scope) => scope.systemQuery || scope.startValue || scope.endValue);

      if (!parsedScopes.length || parsedScopes.some((scope) => !scope.systemQuery)) {
        throw new Error("Add at least one system scope, for example J144636.");
      }

      for (const scope of parsedScopes) {
        if (!isEveDateTimeField(scope.startValue) || !isEveDateTimeField(scope.endValue)) {
          throw new Error("Use the date/time picker in 24-hour EVE time, for example 2026-04-26 17:19.");
        }
        const startMs = new Date(eveDateTimeFieldToIso(scope.startValue)).getTime();
        const endMs = new Date(eveDateTimeFieldToIso(scope.endValue)).getTime();
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
          throw new Error(`End time must be after start time for ${scope.systemQuery}.`);
        }
      }

      const payload = {
        scopes: parsedScopes.map((scope) => ({
          systemQuery: scope.systemQuery,
          startTime: eveDateTimeFieldToIso(scope.startValue),
          endTime: eveDateTimeFieldToIso(scope.endValue),
        })),
        title: title.trim() || undefined,
        async: true,
      };

      setJobMessage("Starting analysis job...");
      const started = await api<AnalyzeJob | BattleReport>("/api/br/analyze", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if ((started as BattleReport).id) {
        onCreated((started as BattleReport).id);
        return;
      }

      const jobId = (started as AnalyzeJob).job_id;
      if (!jobId) throw new Error("Analyze job did not return a job id.");

      const startedAt = Date.now();
      while (Date.now() - startedAt < 45 * 60 * 1000) {
        await sleep(2500);
        const job = await api<AnalyzeJob>(`/api/br/jobs/${jobId}?t=${Date.now()}`);
        setJobMessage(job.message || `Analysis ${job.status}...`);

        if (job.status === "complete") {
          if (!job.report_id) throw new Error("Analyze job completed without a report id.");
          onCreated(job.report_id);
          return;
        }

        if (job.status === "error") {
          throw new Error(job.error || "Analyze job failed.");
        }
      }

      throw new Error("Analyze job is still running after 45 minutes. Refresh later or check backend logs for the job id.");
    } catch (err: any) {
      setError(err?.message || "Failed to create report");
      setJobMessage("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel title="Create Battle Report" right="eve-kill search mode" allowOverflow>
      <form onSubmit={submit} className="mx-auto max-w-[920px] space-y-4 p-3 pb-5 sm:p-4">
        <div className="grid grid-cols-[minmax(190px,1fr)_210px_210px_38px] items-end gap-2 text-[12px] max-md:grid-cols-1">
          <div className="hidden text-[11px] text-slate-300 md:block">System</div>
          <div className="hidden text-[11px] text-slate-300 md:block">Start time (ET)</div>
          <div className="hidden text-[11px] text-slate-300 md:block">End time (ET)</div>
          <div className="hidden md:block" />

          {scopes.map((scope, idx) => (
            <div key={scope.id} className="contents max-md:block max-md:space-y-3 max-md:border max-md:border-[#2c2f36] max-md:bg-[#05070b] max-md:p-3">
              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 md:hidden">System</span>
                <SystemSearchInput
                  value={scope.systemQuery}
                  onChange={(value) => updateScope(scope.id, { systemQuery: value })}
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 md:hidden">Start time (ET)</span>
                <EveDateTimePicker
                  value={scope.startValue}
                  onChange={(value) => updateScope(scope.id, { startValue: value })}
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 md:hidden">End time (ET)</span>
                <EveDateTimePicker
                  value={scope.endValue}
                  onChange={(value) => updateScope(scope.id, { endValue: value })}
                />
              </label>

              <div className="flex gap-1 md:justify-end">
                {idx === 0 ? (
                  <button type="button" className={buttonClass("h-[34px] w-[34px] p-0")} title="Add another system/time window" onClick={addScope}>
                    <Plus className="h-5 w-5" strokeWidth={3} />
                  </button>
                ) : (
                  <button type="button" className={buttonClass("h-[34px] w-[34px] p-0")} title="Remove this system/time window" onClick={() => removeScope(scope.id)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[minmax(160px,1fr)_auto] items-end gap-2 max-md:grid-cols-1">
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">Report Title</span>
            <input className={inputClass("py-1.5")} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" />
          </label>

          <div className="grid grid-cols-2 gap-2 md:flex md:justify-end">
            <button type="button" className={buttonClass("py-1.5")} onClick={clearScopes} disabled={loading}>
              <Trash2 className="h-4 w-4" /> Clear
            </button>
            <button className={buttonClass("border-[#46b2ff]/70 bg-[#146791] py-1.5 text-white hover:bg-[#1979aa]")} disabled={loading}>
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {loading ? "Analyzing" : "Analyze"}
            </button>
          </div>
        </div>

        {jobMessage && !error && (
          <div className="flex items-start gap-2 border border-[#2d8cff]/30 bg-[#07101a] px-3 py-2 text-[12px] text-[#9fc8ff]">
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> {jobMessage}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 border border-red-500/30 bg-red-950/30 px-3 py-2 text-[12px] text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}
      </form>
    </Panel>
  );
}

function AnimatedMetric({ value, format = (current) => Math.round(current).toLocaleString() }: { value: number; format?: (value: number) => string }) {
  const reduceMotion = useReducedMotion();
  const animatedValue = useMotionValue(Number(value || 0));
  const [displayValue, setDisplayValue] = useState(Number(value || 0));

  useEffect(() => {
    if (reduceMotion) {
      animatedValue.set(Number(value || 0));
      setDisplayValue(Number(value || 0));
      return;
    }
    const controls = animate(animatedValue, Number(value || 0), {
      duration: 0.3,
      ease: "easeOut",
      onUpdate: setDisplayValue,
    });
    return () => controls.stop();
  }, [animatedValue, reduceMotion, value]);

  return <>{format(displayValue)}</>;
}

function TeamStat({ label, value, hot = false, format }: { label: string; value: number; hot?: boolean; format?: (value: number) => string }) {
  return (
    <div className="border border-[#142030] bg-[#060b12] px-2 py-1.5 shadow-[inset_2px_0_0_rgba(77,181,255,0.28)]">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#7aa7d4]">{label}</div>
      <div className={`mt-0.5 text-[20px] leading-none font-bold ${hot ? "text-[#ff9a3c]" : "text-slate-100"}`}><AnimatedMetric value={value} format={format} /></div>
    </div>
  );
}

function corpOrAllianceIcon(kind: "corporation" | "alliance", id?: number | null, name?: string | null, compact = false) {
  const sizeClass = compact ? "h-5 w-5" : "h-6 w-6";
  if (!id) return <div className={`${sizeClass} shrink-0 border border-[#182536] bg-black/30`} />;
  return (
    <img
      src={iconUrl(kind, id, 32)}
      className={`${sizeClass} shrink-0 border border-[#22344b] bg-black/30`}
      title={name || `${kind}:${id}`}
      alt={name || kind}
    />
  );
}

function rankShipClass(groupName?: string | null, shipName?: string | null, fallback = 90) {
  const group = String(groupName || "").toLowerCase();
  const name = String(shipName || "").toLowerCase();
  const haystack = `${group} ${name}`;

  if (/(citadel|engineering complex|refinery|upwell|structure|starbase|control tower|customs office|infrastructure hub|territorial claim unit|cynosural jammer|cynosural beacon|pharolux|ansiblex|tenebrex|keepstar|fortizar|azbel|sotiyo|astrahus|raitaru|athanor|tatara)/.test(haystack)) return 0;
  if (/(titan|dreadnought|supercarrier|carrier|force auxiliary|capital industrial ship)/.test(haystack)) return 10;
  if (/(marauder|black ops|battleship)/.test(haystack)) return 20;
  if (/(command ship|battlecruiser)/.test(haystack)) return 30;
  if (/(strategic cruiser|heavy assault cruiser|heavy interdiction cruiser|combat recon ship|force recon ship|logistics cruiser|recon ship|cruiser)/.test(haystack)) return 40;
  if (/(command destroyer|tactical destroyer|interdictor|destroyer)/.test(haystack)) return 50;
  if (/(assault frigate|covert ops|electronic attack ship|expedition frigate|interceptor|logistics frigate|stealth bomber|frigate)/.test(haystack)) return 60;
  if (/shuttle/.test(haystack)) return 70;
  if (/(industrial|transport ship|blockade runner|deep space transport|mining barge|exhumer|freighter|jump freighter|ore industrial)/.test(haystack)) return 80;
  return fallback;
}

function sortShipRowsForDisplay(rows: ParticipantShip[]) {
  return [...rows].sort((a, b) =>
    rankShipClass(a.ship_group_name, a.ship_name, a.ship_class_rank || 90) - rankShipClass(b.ship_group_name, b.ship_name, b.ship_class_rank || 90) ||
    String(a.ship_name || "").localeCompare(String(b.ship_name || "")) ||
    Number((b.loss_count || 0) > 0) - Number((a.loss_count || 0) > 0) ||
    (b.isk_lost || 0) - (a.isk_lost || 0) ||
    (b.damage_done || 0) - (a.damage_done || 0) ||
    (b.kills_on || 0) - (a.kills_on || 0)
  );
}

function participantShipRows(participant: Participant): ParticipantShip[] {
  const rows = participant.ships?.length ? participant.ships : [{
    key: String(participant.ship_type_id || "unknown"),
    ship_type_id: participant.ship_type_id || null,
    ship_name: participant.ship_name || "Unknown Ship",
    ship_group_name: participant.ship_group_name || null,
    ship_class: participant.ship_class || null,
    ship_class_rank: participant.ship_class_rank || 90,
    loss_count: participant.loss_count || 0,
    isk_lost: participant.isk_lost || 0,
    amount_tanked: amountTankedFrom(participant),
    damage_taken: amountTankedFrom(participant),
    kills_on: participant.kills_on || 0,
    damage_done: participant.damage_done || 0,
    final_blows: participant.final_blows || 0,
    zkill_url: participant.zkill_url || null,
  }];

  return sortShipRowsForDisplay(rows);
}

function primaryShipForParticipant(participant: Participant) {
  return participantShipRows(participant)[0] || null;
}

function topDamageShipForParticipant(participant: Participant) {
  const rows = participantShipRows(participant);
  return rows.reduce<ParticipantShip | null>((best, ship) => {
    if (!best) return ship;
    return (ship.damage_done || 0) > (best.damage_done || 0) ? ship : best;
  }, null);
}

function isCenotaphShip(shipName?: string | null) {
  return String(shipName || "").trim().toLowerCase() === "cenotaph";
}

function amountTanked(ship?: ParticipantShip | null, participant?: Participant | null) {
  const candidates = [
    ship?.amount_tanked,
    ship?.damage_taken,
    ship?.tanked,
    participant?.amount_tanked,
    participant?.damage_taken,
    participant?.tanked,
  ];

  for (const value of candidates) {
    const n = Number(value || 0);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return 0;
}

function sortParticipantsForDisplay(rows: Participant[]) {
  return [...rows].sort((a, b) => {
    const aPrimary = primaryShipForParticipant(a);
    const bPrimary = primaryShipForParticipant(b);
    return (
      rankShipClass(aPrimary?.ship_group_name, aPrimary?.ship_name, aPrimary?.ship_class_rank || a.ship_class_rank || 90) -
      rankShipClass(bPrimary?.ship_group_name, bPrimary?.ship_name, bPrimary?.ship_class_rank || b.ship_class_rank || 90) ||
      String(aPrimary?.ship_name || a.ship_name || "").localeCompare(String(bPrimary?.ship_name || b.ship_name || "")) ||
      (b.isk_lost || 0) - (a.isk_lost || 0) ||
      (b.damage_done || 0) - (a.damage_done || 0) ||
      (b.kills_on || 0) - (a.kills_on || 0) ||
      String(a.character_name || "").localeCompare(String(b.character_name || ""))
    );
  });
}

function EntityRow({
  entity,
  sideId,
  sideOptions,
  dragging,
  moving,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  entity: Entity;
  sideId: string;
  sideOptions: { id: string; name: string }[];
  dragging: boolean;
  moving: boolean;
  onDragStart: (event: ReactDragEvent<HTMLDivElement>, entity: Entity, sideId: string) => void;
  onDragEnd: () => void;
  onMove: (entity: Entity, sourceSideId: string, targetSideId: string) => void;
}) {
  const shownCount = entity.pilot_count ?? 0;
  const shownValue = entity.isk_lost || entity.damage_done || 0;
  const moveOptions = sideOptions.filter((side) => side.id !== sideId);

  return (
    <div
      draggable={!moving}
      onDragStart={(event) => onDragStart(event, entity, sideId)}
      onDragEnd={onDragEnd}
      className={`group flex select-none items-center gap-1.5 border-b border-[#132033] px-1 py-1.5 text-xs last:border-b-0 hover:bg-[#0c1624] ${moving ? "cursor-wait opacity-60" : "cursor-grab active:cursor-grabbing"} ${dragging ? "opacity-45" : ""}`}
      title={moving ? `Moving ${entity.name}` : `Drag ${entity.name} to another team`}
    >
      <label
        className="relative flex h-6 w-4 shrink-0 cursor-pointer items-center justify-center text-slate-600 group-hover:text-[#9fc8ff]"
        title="Move to another team"
        onClick={(event) => event.stopPropagation()}
      >
        <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        <select
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={`Move ${entity.name} to another team`}
          value=""
          disabled={moving || moveOptions.length === 0}
          onChange={(event) => {
            const targetSideId = event.target.value;
            if (targetSideId) onMove(entity, sideId, targetSideId);
          }}
        >
          <option value="" disabled>Move to team</option>
          {moveOptions.map((side) => <option key={side.id} value={side.id}>{side.name}</option>)}
        </select>
      </label>

      {iconUrl(entity.kind, entity.id, 32) ? (
        <img src={iconUrl(entity.kind, entity.id, 32)} className="h-6 w-6 shrink-0 bg-black/30" alt={entity.name} />
      ) : (
        <div className="h-6 w-6 shrink-0 bg-black/30" />
      )}

      <div className="min-w-0 flex-1 leading-tight">
        <button
          type="button"
          className="block max-w-full truncate text-left font-bold text-slate-100 hover:text-[#9fc8ff] hover:underline"
          onClick={(e) => { e.stopPropagation(); openExternal(zkillEntityUrl(entity.kind, entity.id)); }}
          title={`Open ${entity.name} on zKillboard`}
        >
          {entity.name}
        </button>
        <div className="text-[10px] text-slate-500">{entity.kind}</div>
      </div>

      <div className="shrink-0 text-right leading-tight">
        <div className="text-slate-200">{shownCount.toLocaleString()}</div>
        <div className="text-[10px] text-slate-500">{fmtIsk(shownValue)}</div>
      </div>
    </div>
  );
}

function ParticipantShipDetailRow({ ship }: { ship: ParticipantShip }) {
  const isLoss = (ship.loss_count || 0) > 0;
  const tanked = amountTanked(ship);
  const body = (
    <div className={`grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2 border-t border-[#1b2b40] px-2 py-1.5 text-xs ${isLoss ? "bg-[#510b0b]/80" : "bg-[#050816]"}`}>
      {ship.ship_type_id ? (
        <img src={`https://images.evetech.net/types/${ship.ship_type_id}/icon?size=32`} className="h-7 w-7 bg-black/30" alt={ship.ship_name} />
      ) : (
        <div className="h-7 w-7 bg-black/30" />
      )}

      <div className="min-w-0 leading-tight">
        <div className="truncate text-slate-100">{ship.ship_name}</div>
        <div className="text-[10px] text-slate-400">
          {isLoss ? `${ship.loss_count} lost, ${fmtIsk(ship.isk_lost)}${tanked ? ` · ${fmtIsk(tanked)} tanked` : ""}` : "survived"}
        </div>
      </div>

      <div className="text-right leading-tight">
        <div className="text-xs font-bold text-[#c3dbff]">dmg {fmtIsk(ship.damage_done)}</div>
        <div className="text-[11px] text-slate-400">[{ship.kills_on || 0}]</div>
      </div>
    </div>
  );

  if (ship.zkill_url) {
    return <button className="block w-full text-left" onClick={() => openExternal(ship.zkill_url)}>{body}</button>;
  }

  return body;
}

function ParticipantRow({
  participant,
  compact,
  expanded,
  isTopDamage,
  isTopKills,
  isNew,
  lossIncreased,
  animateTopStar,
  onToggleExpanded,
}: {
  participant: Participant;
  compact: boolean;
  expanded: boolean;
  isTopDamage: boolean;
  isTopKills: boolean;
  isNew: boolean;
  lossIncreased: boolean;
  animateTopStar: boolean;
  onToggleExpanded: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const shipRows = participantShipRows(participant);
  const primaryShip = shipRows[0];
  const isLoss = (primaryShip?.loss_count || 0) > 0;
  const primaryZkillUrl = primaryShip?.zkill_url || participant.zkill_url || null;
  const primaryTanked = amountTanked(primaryShip, participant);
  const topDamageShip = topDamageShipForParticipant(participant);
  const characterZkillUrl = zkillEntityUrl("character", participant.character_id);
  const hasExtraShips = shipRows.length > 1;
  const damageClass = isTopDamage ? "text-[#4ade80]" : "text-slate-300";
  const killsClass = isTopKills ? "text-[#4ade80]" : "text-slate-400";
  const showTopDamageStar = isTopDamage && !isCenotaphShip(topDamageShip?.ship_name || primaryShip?.ship_name || participant.ship_name);
  const rowClass = isLoss
    ? "border-[#5f2411] bg-[#341105] hover:bg-[#42170a]"
    : "border-[#142131] bg-[#050c15] hover:bg-[#091320]";

  const openLoss = () => {
    if (isLoss && !hasExtraShips && primaryZkillUrl) openExternal(primaryZkillUrl);
  };
  const topDamageStar = showTopDamageStar ? (
    <motion.span
      className="flex h-4 w-4 shrink-0 items-center justify-center text-[#facc15]"
      title="Top damage, and not in a cenotaph!"
      aria-label="Top damage, and not in a cenotaph!"
      initial={!reduceMotion && animateTopStar ? { opacity: 0, scale: 0.72 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
    >
      <Star size={13} fill="currentColor" />
    </motion.span>
  ) : null;

  return (
    <motion.div
      layout={!reduceMotion}
      layoutId={`br-participant-${participant.key}`}
      initial={!reduceMotion && isNew ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : (isNew ? 0.18 : 0.22), ease: "easeOut" }}
      className="overflow-hidden border border-[#142131]"
    >
      <motion.div
        className={`grid w-full items-center text-left text-[11px] ${compact ? "grid-cols-[16px_28px_minmax(78px,1fr)_minmax(108px,auto)_20px_20px] gap-1 px-1 py-1" : "grid-cols-[18px_30px_minmax(0,1fr)_auto_26px_26px] gap-2 px-1.5 py-1"} ${rowClass} ${isLoss && !hasExtraShips && primaryZkillUrl ? "cursor-pointer" : ""}`}
        onClick={openLoss}
        animate={lossIncreased && !reduceMotion ? {
          boxShadow: [
            "inset 0 0 0 rgba(127,29,29,0)",
            "inset 0 0 30px rgba(127,29,29,0.72)",
            "inset 0 0 0 rgba(127,29,29,0)",
          ],
        } : { boxShadow: "inset 0 0 0 rgba(127,29,29,0)" }}
        transition={{ duration: reduceMotion ? 0 : 0.7, ease: "easeOut" }}
      >
        {hasExtraShips ? (
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center text-slate-300 hover:text-[#9fc8ff]"
            title={expanded ? "Collapse extra ship types" : "Show extra ship types"}
            onClick={(e) => { e.stopPropagation(); onToggleExpanded(); }}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="h-5 w-5" />
        )}

        {primaryShip?.ship_type_id ? (
          <img src={`https://images.evetech.net/types/${primaryShip.ship_type_id}/icon?size=32`} className="h-7 w-7 bg-black/30" alt={primaryShip.ship_name || participant.ship_name} />
        ) : (
          <div className="h-7 w-7 bg-black/30" />
        )}

        <div className="min-w-0 leading-tight">
          <button
            type="button"
            className={`block max-w-full truncate text-left font-bold hover:text-[#9fc8ff] hover:underline ${isLoss ? "text-[#ffe083]" : "text-slate-100"}`}
            onClick={(e) => { e.stopPropagation(); openExternal(characterZkillUrl); }}
            title={characterZkillUrl ? `Open ${participant.character_name} on eve-kill` : participant.character_name}
          >
            {participant.character_name}
          </button>
          <div className="truncate text-slate-300">{primaryShip?.ship_name || participant.ship_name}</div>
        </div>

        <div className={compact ? "min-w-0 shrink-0 text-right leading-tight" : (isLoss
          ? "flex min-w-[224px] shrink-0 items-center justify-end gap-1.5 whitespace-nowrap text-right leading-none"
          : "min-w-[112px] shrink-0 text-right leading-tight")}
        >
          {compact ? (
            <div className="grid min-h-[28px] grid-rows-2 content-center whitespace-nowrap">
              {isLoss ? (
                <div className="flex min-w-0 items-center justify-end gap-1 text-[10px] font-semibold leading-none">
                  {primaryTanked > 0 && <span className="text-[#94a3b8]">{fmtIsk(primaryTanked)} tanked</span>}
                  {primaryTanked > 0 && <span className="text-[#49617e]" aria-hidden="true">|</span>}
                  <span className="text-[#ffd3b3]">{fmtIsk(primaryShip?.isk_lost || 0)}</span>
                </div>
              ) : (
                <span aria-hidden="true" />
              )}
              <div className="flex items-center justify-end gap-1 text-[11px] font-semibold leading-none">
                {topDamageStar}
                <span className={damageClass}>dmg {fmtIsk(participant.damage_done || 0)}</span>
                <span className={killsClass}>[{participant.kills_on || 0}]</span>
              </div>
            </div>
          ) : isLoss ? (
            <>
              {topDamageStar}
              <span className={`text-[13px] font-semibold ${damageClass}`}>dmg {fmtIsk(participant.damage_done || 0)}</span>
              <span className={`text-[12px] font-semibold ${killsClass}`}>[{participant.kills_on || 0}]</span>
              {primaryTanked > 0 && (
                <>
                  <span className="h-3 w-px bg-[#37506e]" aria-hidden="true" />
                  <span className="text-[12px] font-semibold text-[#94a3b8]">{fmtIsk(primaryTanked)} tanked</span>
                </>
              )}
              <span className="h-3 w-px bg-[#37506e]" aria-hidden="true" />
              <span className="text-[13px] font-bold text-[#ffd3b3]">{fmtIsk(primaryShip?.isk_lost || 0)}</span>
            </>
          ) : (
            <div className="flex items-center justify-end gap-1.5 whitespace-nowrap text-[13px] font-semibold">
              {topDamageStar}
              <span className={damageClass}>dmg {fmtIsk(participant.damage_done || 0)}</span>
              <span className={killsClass}>[{participant.kills_on || 0}]</span>
            </div>
          )}
        </div>

        {corpOrAllianceIcon("corporation", participant.corporation_id, participant.corporation_name, compact)}
        {corpOrAllianceIcon("alliance", participant.alliance_id, participant.alliance_name, compact)}
      </motion.div>

      {hasExtraShips && (
        <button
          type="button"
          className="flex w-full items-center gap-2 border-t border-[#172338] bg-[#2d3238] px-2 py-1 text-left text-xs text-slate-400 hover:text-[#9fc8ff]"
          onClick={onToggleExpanded}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span>{expanded ? "collapse extra ship types" : `${shipRows.length} total ship types`}</span>
        </button>
      )}

      {hasExtraShips && expanded && shipRows.map((ship) => <ParticipantShipDetailRow key={ship.key} ship={ship} />)}
    </motion.div>
  );
}

function TeamCard({
  side,
  changes,
  compact,
  entitySectionHeight,
  sideOptions,
  draggedEntity,
  pendingMove,
  dropTargetSideId,
  onEntityDragStart,
  onEntityDragEnd,
  onEntityDragOver,
  onEntityDrop,
  onMoveEntity,
}: {
  side: Side;
  changes: LiveChangeSet;
  compact: boolean;
  entitySectionHeight: number | null;
  sideOptions: { id: string; name: string }[];
  draggedEntity: DraggedEntity | null;
  pendingMove: EntityMove | null;
  dropTargetSideId: string | null;
  onEntityDragStart: (event: ReactDragEvent<HTMLDivElement>, entity: Entity, sideId: string) => void;
  onEntityDragEnd: () => void;
  onEntityDragOver: (sideId: string | null) => void;
  onEntityDrop: (targetSideId: string) => void;
  onMoveEntity: (entity: Entity, sourceSideId: string, targetSideId: string) => void;
}) {
  const [expandedEntities, setExpandedEntities] = useState(false);
  const [expandedParticipants, setExpandedParticipants] = useState(false);
  const [expandedShipRows, setExpandedShipRows] = useState<Record<string, boolean>>({});

  const entities = useMemo(() => {
    const rows = [...(side.entities || [])]
      .filter((e) => e.kind === "alliance" || e.kind === "corporation")
      .filter((e) => !pendingMove || e.key !== pendingMove.entity.key);

    if (pendingMove?.targetSideId === side.id) {
      rows.push({ ...pendingMove.entity, side_id: side.id });
    }

    return rows
      .sort((a, b) => {
        return (
          (b.pilot_count || 0) - (a.pilot_count || 0) ||
          (b.isk_lost || 0) - (a.isk_lost || 0) ||
          (b.damage_done || 0) - (a.damage_done || 0) ||
          String(a.name || "").localeCompare(String(b.name || ""))
        );
      });
  }, [pendingMove, side.entities, side.id]);

  const participants = useMemo(() => sortParticipantsForDisplay(side.participants || []), [side.participants]);
  const visibleEntities = expandedEntities ? entities : entities.slice(0, 5);
  const visibleParticipants = expandedParticipants ? participants : participants.slice(0, 30);
  const entityExtraCount = Math.max(0, entities.length - visibleEntities.length);
  const participantExtraCount = Math.max(0, participants.length - visibleParticipants.length);
  const topDamageDone = participants.reduce((best, participant) => Math.max(best, Number(participant.damage_done || 0)), 0);
  const topKillsOn = participants.reduce((best, participant) => Math.max(best, Number(participant.kills_on || 0)), 0);
  const expandableParticipantKeys = visibleParticipants
    .filter((p) => participantShipRows(p).length > 1)
    .map((p) => p.key);
  const allVisibleShipRowsExpanded = expandableParticipantKeys.length > 0 && expandableParticipantKeys.every((key) => expandedShipRows[key]);

  const toggleParticipantShipRows = (participantKey: string) => {
    setExpandedShipRows((current) => ({ ...current, [participantKey]: !current[participantKey] }));
  };

  const toggleVisibleShipRows = () => {
    const expandRows = !allVisibleShipRowsExpanded;
    setExpandedShipRows((current) => {
      const next = { ...current };
      expandableParticipantKeys.forEach((key) => {
        next[key] = expandRows;
      });
      return next;
    });
  };

  const acceptsDrop = Boolean(draggedEntity && draggedEntity.sourceSideId !== side.id);
  const isDropTarget = acceptsDrop && dropTargetSideId === side.id;

  return (
    <div
      className={`min-h-0 transition-[outline-color,background-color] duration-150 ${isDropTarget ? "bg-[#071624] outline outline-2 outline-[#55c3ff] outline-offset-[-2px]" : "outline outline-2 outline-transparent outline-offset-[-2px]"}`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (acceptsDrop) onEntityDragOver(side.id);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (acceptsDrop) onEntityDragOver(side.id);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        if (dropTargetSideId === side.id) onEntityDragOver(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onEntityDrop(side.id);
      }}
    >
      <Panel className="min-h-0">
      <div className="border-b border-[#1c2a3d] bg-[#09111b] px-2.5 py-2 text-center text-[13px] font-bold text-slate-100">
        {side.name} <span className="text-slate-500">({side.pilotCount.toLocaleString()})</span>
      </div>

      <div className="p-1.5">
        <div className="grid grid-cols-2 gap-1.5">
          <TeamStat label="Lost" value={side.iskLost} format={fmtIsk} hot />
          <TeamStat label="Ships Lost" value={side.shipsLost} hot />
          <TeamStat label="Destroyed" value={side.iskKilled} format={fmtIsk} />
          <TeamStat label="Participants" value={side.pilotCount} />
          <TeamStat label="Damage" value={side.damageDone} />
          <TeamStat label="Efficiency" value={side.efficiency} format={(value) => `${Math.round(value)}%`} />
        </div>

        <div
          className={`mt-2 border border-[#172536] bg-[#04070d] ${compact ? "xl:flex xl:h-[var(--br-entity-height)] xl:flex-col xl:overflow-hidden" : ""}`}
          style={compact && entitySectionHeight ? ({ "--br-entity-height": `${entitySectionHeight}px` } as CSSProperties) : undefined}
        >
          <div className="flex items-center justify-between border-b border-[#172338] bg-[#090f18] px-2 py-1.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9fc8ff]">Corps / Alliances</div>
            <div className="text-[10px] text-slate-500">pilots / value</div>
          </div>

          <div className={`p-0.5 ${compact ? "xl:min-h-0 xl:flex-1 xl:overflow-y-auto" : ""}`}>
            {visibleEntities.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-600">No corps or alliances on this side.</div>
            ) : (
              visibleEntities.map((e) => (
                <EntityRow
                  key={e.key}
                  entity={e}
                  sideId={side.id}
                  sideOptions={sideOptions}
                  dragging={draggedEntity?.entity.key === e.key}
                  moving={pendingMove?.entity.key === e.key}
                  onDragStart={onEntityDragStart}
                  onDragEnd={onEntityDragEnd}
                  onMove={onMoveEntity}
                />
              ))
            )}
          </div>

          {entities.length > 5 && (
            <button
              className="w-full shrink-0 border-t border-[#172338] bg-[#090f18] px-2 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#9fc8ff] hover:bg-[#101824]"
              onClick={() => setExpandedEntities((v) => !v)}
            >
              {expandedEntities ? "Show top 5" : `Show ${entityExtraCount} more`}
            </button>
          )}
        </div>

        <div className="mt-2 border border-[#172536] bg-[#04070d]">
          <div className="flex items-center justify-between border-b border-[#172338] bg-[#090f18] px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              {expandableParticipantKeys.length > 0 && (
                <button
                  type="button"
                  className="flex h-5 w-5 items-center justify-center text-slate-300 hover:text-[#9fc8ff]"
                  title={allVisibleShipRowsExpanded ? "Collapse all multi-ship pilots" : "Expand all multi-ship pilots"}
                  aria-label={allVisibleShipRowsExpanded ? "Collapse all multi-ship pilots" : "Expand all multi-ship pilots"}
                  onClick={toggleVisibleShipRows}
                >
                  {allVisibleShipRowsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              )}
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9fc8ff]">Pilots / Ships</div>
            </div>
            <div className="text-[10px] text-slate-500">{compact ? "tanked / loss · damage [kills]" : "Loss value or damage [kills]"}</div>
          </div>

          <div className="space-y-0.5 p-0.5">
            {visibleParticipants.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-600">No pilots on this side.</div>
            ) : (
              visibleParticipants.map((p) => (
                <ParticipantRow
                  key={p.key}
                  participant={p}
                  compact={compact}
                  expanded={!!expandedShipRows[p.key]}
                  isTopDamage={topDamageDone > 0 && Number(p.damage_done || 0) === topDamageDone}
                  isTopKills={topKillsOn > 0 && Number(p.kills_on || 0) === topKillsOn}
                  isNew={changes.addedParticipants.has(p.key)}
                  lossIncreased={changes.lossIncreased.has(p.key)}
                  animateTopStar={changes.newTopDamage.has(`${side.id}:${p.key}`)}
                  onToggleExpanded={() => toggleParticipantShipRows(p.key)}
                />
              ))
            )}
          </div>

          {participants.length > 30 && (
            <button
              className="w-full border-t border-[#172338] bg-[#090f18] px-2 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#9fc8ff] hover:bg-[#101824]"
              onClick={() => setExpandedParticipants((v) => !v)}
            >
              {expandedParticipants ? "Show top 30" : `Show ${participantExtraCount} more`}
            </button>
          )}
        </div>
      </div>
      </Panel>
    </div>
  );
}

function LiveIndicator({ report, connectionState, catchupCount }: {
  report: BattleReport;
  connectionState: "connecting" | "connected" | "reconnecting";
  catchupCount: number;
}) {
  const status = report.live?.status || "final";
  const label = status === "live" && connectionState === "reconnecting"
    ? "RECONNECTING"
    : status.toUpperCase();
  const colorClass = label === "LIVE"
    ? "border-[#2f8f63] bg-[#071a13] text-[#6ee7a8]"
    : label === "RECONNECTING"
      ? "border-[#9b6b23] bg-[#1b1205] text-[#f4c56d]"
      : label === "SCHEDULED"
        ? "border-[#356da0] bg-[#07131f] text-[#8ac7ff]"
        : "border-[#3a4655] bg-[#101219] text-slate-400";
  const updated = report.live?.lastUpdateAt || report.updated_at;
  const time = updated ? new Date(updated).toISOString().slice(11, 19) : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`border px-1.5 py-0.5 text-[9px] font-black tracking-[0.12em] ${colorClass}`}>{label}</span>
      {time && <span className="text-[9px] text-slate-600">updated {time} ET</span>}
      {catchupCount > 0 && <span className="border border-[#8b641f] bg-[#1a1205] px-1.5 py-0.5 text-[9px] font-bold text-[#f6c96b]">+{catchupCount.toLocaleString()} killmails</span>}
    </div>
  );
}

function HeaderReport({ report, connectionState, catchupCount }: {
  report: BattleReport;
  connectionState: "connecting" | "connected" | "reconnecting";
  catchupCount: number;
}) {
  const cards: { label: string; value: number; format?: (value: number) => string }[] = [
    { label: "Lost", value: Number(report.summary.totalIskDestroyed || 0), format: fmtIsk },
    { label: "Ships Lost", value: Number(report.summary.shipsLost || report.summary.totalKills || 0) },
    { label: "Participants", value: Number(report.summary.totalParticipants || report.summary.totalPilots || 0) },
    { label: "Duration", value: Number(report.summary.durationMinutes || 0), format: fmtDuration },
  ];
  return (
    <div className="overflow-hidden border border-[#2c2f36] bg-[#070910] shadow-[0_0_28px_rgba(0,0,0,0.34)]">
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr]">
        <div className="border-l-[3px] border-[#2d8cff] bg-[#070d17] px-3.5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#7fa8d5]">Report Scope</div>
            <LiveIndicator report={report} connectionState={connectionState} catchupCount={catchupCount} />
          </div>
          <div className="mt-1 truncate text-[14px] font-black text-slate-100">{report.title}</div>
          <div className="mt-2 grid grid-cols-[54px_1fr] gap-x-2 gap-y-1 text-[11px] leading-tight">
            <span className="uppercase tracking-[0.14em] text-slate-600">Systems</span>
            <span className="truncate font-semibold text-[#7db7ff]" title={String(report.system_name || report.system_id || "Unknown")}>{report.system_name || report.system_id || "Unknown"}</span>
            <span className="uppercase tracking-[0.14em] text-slate-600">Window</span>
            <span className="text-slate-300">{fmtDate(report.start_time).slice(11)}–{fmtDate(report.end_time).slice(11)} ET</span>
            <span className="uppercase tracking-[0.14em] text-slate-600">Date</span>
            <span className="text-slate-500">{fmtDate(report.start_time).slice(0, 10)}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4">
          {cards.map((card, idx) => (
            <div key={card.label} className={`border-l border-[#122031] px-4 py-3 ${idx < 2 ? "border-b md:border-b-0" : ""}`}>
              <div className="text-[18px] leading-none font-black text-[#ff9a3c]"><AnimatedMetric value={card.value} format={card.format} /></div>
              <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#8fb7dd]">{card.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TabButton({ tab, active, setActive, children }: { tab: TabKey; active: TabKey; setActive: (t: TabKey) => void; children: ReactNode }) {
  return (
    <button
      onClick={() => setActive(tab)}
      className={`border px-3 py-1.5 text-[11px] font-bold ${active === tab ? "border-[#5b9ad8] bg-[#6db8ff] text-[#061018]" : "border-[#2e4057] bg-[#0d1520] text-slate-200 hover:border-[#5b9ad8] hover:bg-[#101b28]"}`}
    >
      {children}
    </button>
  );
}

function KillmailTable({ report, changes }: { report: BattleReport; changes: LiveChangeSet }) {
  const reduceMotion = useReducedMotion();
  const sideName = (id: string) => report.sides.find((s) => s.id === id)?.name || id;
  return (
    <Panel title="Killmails" right="click a row to open eve-kill">
      <div className="overflow-x-auto p-3">
        <table className="w-full min-w-[960px] text-left text-[12px]">
          <thead className="bg-[#0d1520] text-[10px] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-2 py-2">Time</th>
              <th className="px-2 py-2">Victim</th>
              <th className="px-2 py-2">Corp / Alliance</th>
              <th className="px-2 py-2">Ship</th>
              <th className="px-2 py-2">Final Blow</th>
              <th className="px-2 py-2">Value</th>
              <th className="px-2 py-2">Team</th>
              <th className="px-2 py-2">zKill</th>
            </tr>
          </thead>
          <tbody>
            {(report.data?.killmails || []).map((k) => (
              <motion.tr
                key={k.killmail_id}
                className="cursor-pointer border-t border-[#172338] hover:bg-[#0d1520]"
                onClick={() => { window.location.href = eveKillKillmailUrl(k.killmail_id) || eveKillUrlFromMaybeZkill(k.zkill_url) || k.zkill_url; }}
                initial={!reduceMotion && changes.addedKillmails.has(Number(k.killmail_id)) ? { boxShadow: "inset 0 0 0 999px rgba(180,112,20,0.4)" } : false}
                animate={{ boxShadow: "inset 0 0 0 999px rgba(180,112,20,0)" }}
                transition={{ duration: reduceMotion ? 0 : 0.6, ease: "easeOut" }}
              >
                <td className="whitespace-nowrap px-2 py-2 text-slate-400">{fmtDate(k.killmail_time)}</td>
                <td className="px-2 py-2 text-slate-100">{k.victim_name}</td>
                <td className="px-2 py-2 text-slate-400">
                  <div className="truncate">{k.victim_corporation_name || "—"}</div>
                  <div className="truncate text-[10px] text-slate-600">{k.victim_alliance_name || ""}</div>
                </td>
                <td className="px-2 py-2 text-slate-300">
                  <div className="flex items-center gap-2">
                    {k.victim_ship_type_id && <img src={`https://images.evetech.net/types/${k.victim_ship_type_id}/icon?size=32`} className="h-6 w-6" />}
                    {k.victim_ship_name}
                  </div>
                </td>
                <td className="px-2 py-2 text-slate-400">{k.final_blow_name}</td>
                <td className="px-2 py-2 font-bold text-[#ffb073]">
                  <div>{fmtIsk(k.total_value)}</div>
                  {amountTankedFrom(k) > 0 && <div className="text-[10px] text-[#a7f3d0]">{fmtIsk(amountTankedFrom(k))} tanked</div>}
                </td>
                <td className="px-2 py-2 text-[#9fc8ff]">{sideName(k.victim_side_id)}</td>
                <td className="px-2 py-2 text-blue-300"><ExternalLink className="h-4 w-4" /></td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

type CompositionRow = {
  key: string;
  type_id: number | null;
  name: string;
  pilots: number;
  lost: number;
  value: number;
  damage: number;
  kills: number;
};

function buildCompositionRows(side: Side): CompositionRow[] {
  const groups = new Map<string, CompositionRow>();

  for (const p of side.participants || []) {
    for (const ship of participantShipRows(p)) {
      const key = `${ship.ship_type_id || 0}:${ship.ship_name || "Unknown"}`;
      const existing = groups.get(key) || {
        key,
        type_id: ship.ship_type_id || null,
        name: ship.ship_name || "Unknown",
        pilots: 0,
        lost: 0,
        value: 0,
        damage: 0,
        kills: 0,
      };

      existing.pilots += 1;
      existing.lost += ship.loss_count || 0;
      existing.value += ship.isk_lost || 0;
      existing.damage += ship.damage_done || 0;
      existing.kills += ship.kills_on || 0;
      groups.set(key, existing);
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    if (b.pilots !== a.pilots) return b.pilots - a.pilots;
    return b.damage - a.damage;
  });
}

function Composition({ report }: { report: BattleReport }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      {report.sides
        .filter((side) => side.id !== EXCLUDED_SIDE_ID && (side.pilotCount > 0 || side.shipsLost > 0 || (side.participants?.length || 0) > 0))
        .map((side) => {
          const rows = buildCompositionRows(side);

          return (
            <Panel key={side.id} title={side.name} right={`${rows.length} ship types / ${(side.participants?.length || 0).toLocaleString()} pilots`}>
              <div className="max-h-[620px] overflow-y-auto p-1">
                {rows.length === 0 ? (
                  <div className="px-3 py-8 text-center text-xs text-slate-600">No participant ships on this side.</div>
                ) : (
                  rows.map((ship) => (
                    <div key={`${side.id}-${ship.key}`} className="flex items-center justify-between border-b border-[#172338] px-1.5 py-1 text-[11px] last:border-b-0 hover:bg-[#0a131f]">
                      <div className="flex min-w-0 items-center gap-2">
                        {ship.type_id ? <img src={`https://images.evetech.net/types/${ship.type_id}/icon?size=32`} className="h-7 w-7 shrink-0" alt={ship.name} /> : <div className="h-6 w-6 shrink-0 bg-black/30" />}
                        <div className="min-w-0 leading-tight">
                          <div className="truncate text-slate-200">{ship.pilots}× {ship.name}</div>
                          <div className="text-[10px] text-slate-500">{ship.lost} lost · {fmtIsk(ship.damage)} dmg</div>
                        </div>
                      </div>
                      <span className="shrink-0 pl-3 text-[#ffb073]">{fmtIsk(ship.value)}</span>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          );
        })}
    </div>
  );
}

function SideEditor({ report, onSaved }: { report: BattleReport; onSaved: (r: BattleReport) => void }) {
  const [overrides, setOverrides] = useState<Record<string, string>>(report.side_overrides || {});
  const [sideNames, setSideNames] = useState<Record<string, string>>(report.side_names || {});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOverrides(report.side_overrides || {});
    setSideNames(report.side_names || {});
  }, [report.id]);

  const sideOptions = useMemo(() => {
    const base = report.sides
      .filter((s) => s.id !== "side_unknown" && s.id !== EXCLUDED_SIDE_ID)
      .map((s) => ({ id: s.id, name: sideNames[s.id] || s.name }));
    for (let i = 1; i <= Math.max(3, report.sides.length + 1); i++) {
      const id = `side_${i}`;
      if (!base.find((s) => s.id === id)) base.push({ id, name: sideNames[id] || `Team ${i}` });
    }
    return base;
  }, [report.sides, sideNames]);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api<BattleReport>(`/api/br/${report.id}/sides`, {
        method: "PATCH",
        body: JSON.stringify({ side_overrides: overrides, side_names: sideNames }),
      });
      setOverrides(updated.side_overrides || {});
      setSideNames(updated.side_names || {});
      onSaved(updated);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title="Side Editor" right={report.summary?.excludedKills ? `${report.summary.excludedKills.toLocaleString()} excluded killmails` : "manual overrides / exclusions"}>
      <div className="space-y-3 p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {sideOptions.slice(0, 6).map((s) => (
            <label key={s.id} className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">{s.id} Name</span>
              <input className={inputClass()} value={sideNames[s.id] || s.name} onChange={(e) => setSideNames((old) => ({ ...old, [s.id]: e.target.value }))} />
            </label>
          ))}
        </div>

        <div className="max-h-[520px] overflow-y-auto border border-[#1b2b40]">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[#101824] text-[10px] uppercase tracking-widest text-slate-500">
              <tr><th className="px-2 py-2">Entity</th><th className="px-2 py-2">Type</th><th className="px-2 py-2">Lost</th><th className="px-2 py-2">Damage</th><th className="px-2 py-2">Side</th></tr>
            </thead>
            <tbody>
              {report.entities.map((e) => {
                const selectedSide = overrides[e.key] || e.side_id || "side_unknown";
                const isExcluded = selectedSide === EXCLUDED_SIDE_ID;

                return (
                  <tr key={e.key} className={`border-t border-[#172338] hover:bg-[#101824] ${isExcluded ? "bg-[#2a1010]/55" : ""}`}>
                    <td className="px-2 py-2 text-slate-200">
                      <div className="flex items-center gap-1.5">
                        {iconUrl(e.kind, e.id) ? <img src={iconUrl(e.kind, e.id)} className="h-6 w-6" /> : null}
                        <div>
                          <div>{e.name}</div>
                          <div className="text-[10px] text-slate-600">{e.key}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-slate-400">
                      <div>{e.kind}</div>
                      {isExcluded && <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#ff9a9a]">excluded</div>}
                    </td>
                    <td className="px-2 py-2 text-slate-400">{fmtIsk(e.isk_lost)}</td>
                    <td className="px-2 py-2 text-slate-400">{e.damage_done.toLocaleString()}</td>
                    <td className="px-2 py-2">
                      <select
                        className="border border-[#2c3a50] bg-[#05070b] px-2 py-1 text-xs text-slate-200"
                        value={selectedSide}
                        onChange={(ev) => setOverrides((old) => ({ ...old, [e.key]: ev.target.value }))}
                      >
                        {sideOptions.map((s) => <option key={s.id} value={s.id}>{sideNames[s.id] || s.name}</option>)}
                        <option value="side_unknown">Unknown / Third Party</option>
                        <option value={EXCLUDED_SIDE_ID}>Exclude from BR</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button className={buttonClass()} onClick={save} disabled={saving}>
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save BR Adjustments
        </button>
      </div>
    </Panel>
  );
}

function ReportView({ id, onWideLayoutChange }: { id: string; onWideLayoutChange?: (wide: boolean) => void }) {
  const [report, setReport] = useState<BattleReport | null>(null);
  const [tab, setTab] = useState<TabKey>("participants");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const [liveChanges, setLiveChanges] = useState<LiveChangeSet>(EMPTY_LIVE_CHANGES);
  const [catchupCount, setCatchupCount] = useState(0);
  const [draggedEntity, setDraggedEntity] = useState<DraggedEntity | null>(null);
  const [dropTargetSideId, setDropTargetSideId] = useState<string | null>(null);
  const [pendingEntityMove, setPendingEntityMove] = useState<EntityMove | null>(null);
  const [entityMoveNotice, setEntityMoveNotice] = useState<EntityMoveNotice | null>(null);
  const reportRef = useRef<BattleReport | null>(null);
  const draggedEntityRef = useRef<DraggedEntity | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const changeTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const entityMoveNoticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setConnectionState("connecting");
    setLiveChanges(EMPTY_LIVE_CHANGES);
    setDraggedEntity(null);
    draggedEntityRef.current = null;
    setDropTargetSideId(null);
    setPendingEntityMove(null);
    setEntityMoveNotice(null);
    api<BattleReport>(`/api/br/${id}`, { signal: controller.signal })
      .then((next) => {
        reportRef.current = next;
        setReport(next);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") setError(err.message || "Failed to load report");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    reportRef.current = report;
  }, [report]);

  const visibleSideCount = report?.sides.filter((side) => side.id !== EXCLUDED_SIDE_ID && (side.pilotCount > 0 || side.shipsLost > 0 || (side.participants?.length || 0) > 0)).length || 0;

  useEffect(() => {
    onWideLayoutChange?.(visibleSideCount >= 3);
  }, [onWideLayoutChange, visibleSideCount]);

  useEffect(() => () => onWideLayoutChange?.(false), [onWideLayoutChange]);

  const streamStatus = report?.live?.status;
  useEffect(() => {
    if (!report || (streamStatus !== "scheduled" && streamStatus !== "live")) {
      if (streamStatus === "final") setConnectionState("connected");
      return;
    }

    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let fallbackTimer: number | null = null;
    let latestRequestedRevision = Number(reportRef.current?.revision || 0);
    let hiddenRevision = 0;
    let hiddenTotalKills = Number(reportRef.current?.summary?.totalKills || reportRef.current?.summary?.shipsLost || 0);

    const clearFallback = () => {
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      if (fallbackTimer != null) window.clearInterval(fallbackTimer);
      reconnectTimer = null;
      fallbackTimer = null;
    };

    const fetchSnapshot = async (targetRevision: number, suppressAnimations = false, caughtUp = 0) => {
      const currentRevision = Number(reportRef.current?.revision || 0);
      if (targetRevision <= currentRevision || targetRevision <= latestRequestedRevision) return;
      latestRequestedRevision = targetRevision;
      const requestedRevision = targetRevision;
      fetchAbortRef.current?.abort();
      const controller = new AbortController();
      fetchAbortRef.current = controller;
      try {
        const next = await api<BattleReport>(`/api/br/${id}`, { signal: controller.signal });
        const prior = reportRef.current;
        if (!prior || Number(next.revision || 0) <= Number(prior.revision || 0)) return;
        reportRef.current = next;
        setReport(next);
        if (suppressAnimations) {
          setLiveChanges(EMPTY_LIVE_CHANGES);
        } else {
          setLiveChanges(diffBattleReports(prior, next));
          if (changeTimerRef.current != null) window.clearTimeout(changeTimerRef.current);
          changeTimerRef.current = window.setTimeout(() => setLiveChanges(EMPTY_LIVE_CHANGES), 1100);
        }
        if (caughtUp > 0) {
          setCatchupCount(caughtUp);
          if (noticeTimerRef.current != null) window.clearTimeout(noticeTimerRef.current);
          noticeTimerRef.current = window.setTimeout(() => setCatchupCount(0), 4500);
        }
      } catch (err: any) {
        if (latestRequestedRevision === requestedRevision) {
          latestRequestedRevision = Number(reportRef.current?.revision || 0);
        }
        if (err?.name !== "AbortError") console.warn("Battle report live snapshot failed", err);
      }
    };

    const receiveRevision = (event: LiveEvent) => {
      const current = reportRef.current;
      const revision = Number(event.revision || 0);
      if (!revision || revision <= Number(current?.revision || 0)) return;
      if (document.hidden) {
        hiddenRevision = Math.max(hiddenRevision, revision);
        hiddenTotalKills = Math.max(hiddenTotalKills, Number(event.totalKills || 0));
        return;
      }
      void fetchSnapshot(revision);
    };

    const parseEvent = (event: MessageEvent<string>) => {
      try {
        receiveRevision(JSON.parse(event.data) as LiveEvent);
      } catch {
        // A malformed invalidation is harmless; the fallback check will recover.
      }
    };

    const pollRevision = async () => {
      try {
        const status = await api<LiveEvent>(`/api/br/${id}/live`);
        receiveRevision(status);
      } catch (err) {
        console.warn("Battle report live fallback failed", err);
      }
    };

    const startFallback = () => {
      if (fallbackTimer != null) return;
      void pollRevision();
      fallbackTimer = window.setInterval(pollRevision, 15000);
    };

    source = new EventSource(`/api/br/${id}/events`);
    source.addEventListener("ready", parseEvent as EventListener);
    source.addEventListener("report-updated", parseEvent as EventListener);
    source.addEventListener("finalized", parseEvent as EventListener);
    source.onopen = () => {
      clearFallback();
      setConnectionState("connected");
    };
    source.onerror = () => {
      setConnectionState("reconnecting");
      if (reconnectTimer == null) reconnectTimer = window.setTimeout(startFallback, 30000);
    };

    const onVisibilityChange = () => {
      if (document.hidden || !hiddenRevision) return;
      const revision = hiddenRevision;
      const currentKills = Number(reportRef.current?.summary?.totalKills || reportRef.current?.summary?.shipsLost || 0);
      const added = Math.max(0, hiddenTotalKills - currentKills);
      hiddenRevision = 0;
      hiddenTotalKills = currentKills;
      void fetchSnapshot(revision, true, added);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      source?.close();
      clearFallback();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      fetchAbortRef.current?.abort();
    };
  }, [id, streamStatus]);

  useEffect(() => () => {
    if (changeTimerRef.current != null) window.clearTimeout(changeTimerRef.current);
    if (noticeTimerRef.current != null) window.clearTimeout(noticeTimerRef.current);
    if (entityMoveNoticeTimerRef.current != null) window.clearTimeout(entityMoveNoticeTimerRef.current);
  }, []);

  const showEntityMoveNotice = (notice: EntityMoveNotice) => {
    setEntityMoveNotice(notice);
    if (entityMoveNoticeTimerRef.current != null) window.clearTimeout(entityMoveNoticeTimerRef.current);
    entityMoveNoticeTimerRef.current = window.setTimeout(() => setEntityMoveNotice(null), notice.kind === "error" ? 6500 : 5000);
  };

  const applyEntityMoveSnapshot = (updated: BattleReport) => {
    const current = reportRef.current;
    if (current && Number(updated.revision || 0) <= Number(current.revision || 0)) return;
    const changes = current ? diffBattleReports(current, updated) : EMPTY_LIVE_CHANGES;
    reportRef.current = updated;
    setReport(updated);
    setLiveChanges(changes);
    if (changeTimerRef.current != null) window.clearTimeout(changeTimerRef.current);
    changeTimerRef.current = window.setTimeout(() => setLiveChanges(EMPTY_LIVE_CHANGES), 1100);
  };

  const moveEntity = async (
    entity: Entity,
    sourceSideId: string,
    targetSideId: string,
    options: { undo?: boolean; previousOverride?: string | null } = {}
  ) => {
    const current = reportRef.current;
    if (!current || pendingEntityMove || sourceSideId === targetSideId) return;

    const hadPreviousOverride = Object.prototype.hasOwnProperty.call(current.side_overrides || {}, entity.key);
    const previousOverride = hadPreviousOverride ? current.side_overrides[entity.key] : null;
    const sideOverrides = { ...(current.side_overrides || {}) };
    if (options.undo) {
      if (options.previousOverride == null) delete sideOverrides[entity.key];
      else sideOverrides[entity.key] = options.previousOverride;
    } else {
      sideOverrides[entity.key] = targetSideId;
    }

    const targetName = current.sides.find((side) => side.id === targetSideId)?.name || targetSideId;
    draggedEntityRef.current = null;
    setDraggedEntity(null);
    setDropTargetSideId(null);
    setPendingEntityMove({ entity, sourceSideId, targetSideId });
    setEntityMoveNotice(null);

    try {
      const updated = await api<BattleReport>(`/api/br/${current.id}/sides`, {
        method: "PATCH",
        body: JSON.stringify({ side_overrides: sideOverrides, side_names: current.side_names || {} }),
      });
      applyEntityMoveSnapshot(updated);
      setPendingEntityMove(null);

      if (options.undo) {
        showEntityMoveNotice({ kind: "success", message: `Moved ${entity.name} back.` });
      } else {
        showEntityMoveNotice({
          kind: "success",
          message: `Moved ${entity.name} to ${targetName}.`,
          undo: { entity, sourceSideId, targetSideId, previousOverride },
        });
      }
    } catch (err: any) {
      setPendingEntityMove(null);
      showEntityMoveNotice({ kind: "error", message: err?.message || `Could not move ${entity.name}.` });
    }
  };

  const handleEntityDragStart = (event: ReactDragEvent<HTMLDivElement>, entity: Entity, sourceSideId: string) => {
    if (pendingEntityMove) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", entity.key);
    const dragged = { entity, sourceSideId };
    draggedEntityRef.current = dragged;
    setDraggedEntity(dragged);
    setDropTargetSideId(null);
  };

  const handleEntityDragEnd = () => {
    draggedEntityRef.current = null;
    setDraggedEntity(null);
    setDropTargetSideId(null);
  };

  const handleEntityDrop = (targetSideId: string) => {
    const dragged = draggedEntityRef.current || draggedEntity;
    if (!dragged || dragged.sourceSideId === targetSideId) {
      handleEntityDragEnd();
      return;
    }
    void moveEntity(dragged.entity, dragged.sourceSideId, targetSideId);
  };

  if (loading) return <Panel title="Battle Report"><div className="p-3 text-sm text-slate-400">Loading report…</div></Panel>;
  if (error) return <Panel title="Battle Report"><div className="p-3 text-sm text-red-300">{error}</div></Panel>;
  if (!report) return null;

  const visibleSides = report.sides.filter((side) => side.id !== EXCLUDED_SIDE_ID && (side.pilotCount > 0 || side.shipsLost > 0 || (side.participants?.length || 0) > 0));
  const sideOptions = visibleSides.map((side) => ({ id: side.id, name: side.name }));
  const compactTeams = visibleSides.length >= 3;
  const gridCols = compactTeams ? "xl:grid-cols-3" : "lg:grid-cols-2";
  const visibleEntityCounts = visibleSides.map((side) => (
    (side.entities || []).filter((entity) => entity.kind === "alliance" || entity.kind === "corporation").length
  ));
  const maxVisibleEntityRows = Math.max(1, ...visibleEntityCounts.map((count) => Math.min(count, 5)));
  const hasEntityOverflow = visibleEntityCounts.some((count) => count > 5);
  const entitySectionHeight = compactTeams
    ? 34 + maxVisibleEntityRows * 37 + (hasEntityOverflow ? 29 : 0)
    : null;

  return (
    <div className="space-y-4">
      <HeaderReport report={report} connectionState={connectionState} catchupCount={catchupCount} />

      {entityMoveNotice && (
        <motion.div
          key={`${entityMoveNotice.kind}-${entityMoveNotice.message}`}
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className={`fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 border px-3 py-2 text-xs shadow-lg ${entityMoveNotice.kind === "error" ? "border-[#8f3838] bg-[#250b0b] text-[#ffc2c2]" : "border-[#38658f] bg-[#071321] text-slate-100"}`}
        >
          <span className="min-w-0 truncate">{entityMoveNotice.message}</span>
          {entityMoveNotice.undo && (
            <button
              type="button"
              className="flex shrink-0 items-center gap-1 font-bold uppercase text-[#9fc8ff] hover:text-white"
              onClick={() => {
                const undo = entityMoveNotice.undo;
                if (!undo) return;
                setEntityMoveNotice(null);
                void moveEntity(undo.entity, undo.targetSideId, undo.sourceSideId, { undo: true, previousOverride: undo.previousOverride });
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Undo
            </button>
          )}
        </motion.div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2 border border-[#2c2f36] bg-[#070910] p-2">
        <TabButton tab="participants" active={tab} setActive={setTab}>Participants</TabButton>
        <TabButton tab="kills" active={tab} setActive={setTab}>Killmails</TabButton>
        <TabButton tab="composition" active={tab} setActive={setTab}>Composition</TabButton>
        <TabButton tab="editor" active={tab} setActive={setTab}><Settings2 className="inline h-3.5 w-3.5" /> Editor</TabButton>
        <button
          type="button"
          className={buttonClass("py-1.5")}
          onClick={async () => {
            const url = `${window.location.origin}/br/${report.id}`;
            await navigator.clipboard.writeText(url);
            setCopiedLink(true);
            window.setTimeout(() => setCopiedLink(false), 1400);
          }}
          title="Copy clean Discord embed link"
        >
          <Copy className="h-3.5 w-3.5" /> {copiedLink ? "Copied" : "Copy Link"}
        </button>
      </div>

      <div className="flex items-start gap-2 border border-[#6f4d16] bg-[#171005] px-3 py-2 text-[11px] text-[#d9c08a]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        This tool is in active development. Please contact me for changes, suggestions or bugs.
      </div>

      {tab === "participants" && (
        <LayoutGroup id={`battle-report-${report.id}`}>
          <div className={`grid grid-cols-1 items-start gap-2 ${gridCols}`}>
            {visibleSides.map((side) => (
              <TeamCard
                key={side.id}
                side={side}
                compact={compactTeams}
                entitySectionHeight={entitySectionHeight}
                changes={liveChanges}
                sideOptions={sideOptions}
                draggedEntity={draggedEntity}
                pendingMove={pendingEntityMove}
                dropTargetSideId={dropTargetSideId}
                onEntityDragStart={handleEntityDragStart}
                onEntityDragEnd={handleEntityDragEnd}
                onEntityDragOver={setDropTargetSideId}
                onEntityDrop={handleEntityDrop}
                onMoveEntity={(entity, sourceSideId, targetSideId) => void moveEntity(entity, sourceSideId, targetSideId)}
              />
            ))}
          </div>
        </LayoutGroup>
      )}
      {tab === "kills" && <KillmailTable report={report} changes={liveChanges} />}
      {tab === "composition" && <Composition report={report} />}
      {tab === "editor" && <SideEditor report={report} onSaved={(updated) => {
        reportRef.current = updated;
        setReport(updated);
      }} />}
    </div>
  );
}

export default function BattleReports() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [wideReport, setWideReport] = useState(false);

  useEffect(() => {
    if (!id) setWideReport(false);
  }, [id]);

  return (
    <div className="tt-tool-v2 tt2-report-page tt2-battle-reports min-h-screen px-2 py-3 text-slate-200 sm:px-4 sm:py-5">
      <div className={`tt2-window mx-auto ${wideReport ? "max-w-[1600px]" : "max-w-[1320px]"}`}>
        <ToolChrome
          section="Combat Intel"
          title="Battle Report Generator"
          badge="EVE-KILL"
          context={id ? "Report View" : "Report Builder"}
          status="search ready"
          actions={id ? (
            <button
              className="h-8 shrink-0 border border-[#438ec0] bg-[#146791] px-2.5 text-[10px] font-semibold uppercase text-white hover:border-[#71c9ff] hover:bg-[#1979aa] sm:h-6 sm:text-[9px]"
              onClick={() => navigate("/br")}
            >
              New Report
            </button>
          ) : null}
        />

        <div className="p-2 sm:p-3">
          {id ? (
            <ReportView id={id} onWideLayoutChange={setWideReport} />
          ) : (
            <CreateReport onCreated={(newId) => navigate(`/br/${newId}`)} />
          )}
        </div>
      </div>
    </div>
  );
}
