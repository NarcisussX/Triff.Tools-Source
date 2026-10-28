/*
 * Shared React component for Wormhole show-info details.
 * Used as a desktop side panel and as a modal/fullscreen detail view.
 */

import { useEffect, useMemo, useState } from "react";
import { Bookmark, Copy, ExternalLink, Maximize2, X } from "lucide-react";

export interface Planet {
  planet_id?: string | number;
  id?: string | number;
  jcode?: string;
  name?: string | null;
  esi_name?: string | null;
  type_id?: number | null;
  type_name?: string | null;
  moon_count?: number | null;
  moons?: number | null;
}

export interface WormholeSystem {
  id?: number;
  jcode: string;
  region?: string | null;
  constellation?: string | null;
  solarsystemid?: string | number | null;
  solarSystemID?: string | number | null;
  solar_system_id?: string | number | null;
  class?: string | null;
  effect?: string | null;
  statics?: string[];
  star_id?: string | number | null;
  star_type_id?: number | null;
  star_name?: string | null;
  star?: {
    id?: string | number | null;
    type_id?: number | null;
    name?: string | null;
  } | null;
  planets?: Planet[];
  planetSummary?: { type: string; count: number }[];
  planetCount?: number;
  moonCount?: number;
  shattered?: boolean;
  isShattered?: boolean;
  isA0?: boolean;
  isA0Star?: boolean;
}

type Activity = { days?: string[]; max?: number } & Record<number, Record<number, number>>;

type EntityActivity = {
  id?: string | number | null;
  name: string;
  lastSeenDaysAgo: number;
  activeDays: number;
};

type KillboardSummary = {
  totalKills?: number;
  daysCovered?: number;
  mostRecentKillDaysAgo?: number | null;
  activeCorporations?: EntityActivity[];
  activeAlliances?: EntityActivity[];
};

export type WormholeBookmarkRecord = {
  jcode: string;
  nickname?: string;
  notes: string;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
};

type WormholeDetailsProps = {
  system: WormholeSystem;
  onClose?: () => void;
  onExpand?: () => void;
  mode?: "panel" | "modal";
  bookmark?: WormholeBookmarkRecord | null;
  bookmarkTagColors?: Record<string, string>;
  authChecked?: boolean;
  canUseBookmarks?: boolean;
  onToggleBookmark?: (system: WormholeSystem) => void;
  onSaveNotes?: (system: WormholeSystem, notes: string, nickname?: string) => Promise<void> | void;
  onRequestSignIn?: () => void;
};

const STATIC_CODES_BY_CLASS: Record<string, readonly string[]> = {
  c1: ["E004", "H121", "P060", "Q317", "V301", "Y790", "Z647", "Z971"],
  c2: ["C125", "D364", "D382", "G024", "I182", "L005", "N766", "R943"],
  c3: ["C247", "L477", "M267", "N968", "O477", "O883", "X702", "Z006"],
  c4: ["E175", "M001", "M609", "O128", "T405", "X877", "Y683", "Z457"],
  c5: ["C008", "H296", "H900", "L614", "M555", "N062", "N432", "N770", "V911"],
  c6: ["A982", "B041", "G008", "R474", "S804", "U319", "U574", "V753", "W237"],
  hs: ["N110", "B274", "D845", "S047", "D792", "B520", "A641", "B449", "Q063"],
  ls: ["J244", "A239", "U210", "N290", "C140", "R051", "N944", "V898"],
  ns: ["C248", "E545", "E587", "K329", "K346", "Q003", "S199", "V283", "Z060", "Z142"],
  thera: ["F353", "F135", "T458", "M164", "L031"],
  c13: ["A009"],
  sentinel: ["S877"],
  barbican: ["B735"],
  vidette: ["V928"],
  redoubt: ["R259"],
  conflux: ["C414"],
};

const terminalToneMap: Record<string, string> = {
  c1: "text-[#a8d8e8]",
  c2: "text-[#9cc8e2]",
  c3: "text-[#91b8d4]",
  c4: "text-[#d2c28f]",
  c5: "text-[#d2b06d]",
  c6: "text-[#d09668]",
  c13: "text-[#c6bdd6]",
  hs: "text-[#a7d3bd]",
  ls: "text-[#d2c28f]",
  ns: "text-[#d2a0a0]",
  thera: "text-[#c6bdd6]",
  sentinel: "text-[#c6bdd6]",
  barbican: "text-[#c6bdd6]",
  vidette: "text-[#c6bdd6]",
  redoubt: "text-[#c6bdd6]",
  conflux: "text-[#c6bdd6]",
  other: "text-slate-200",
};

const specialClassNames = new Set(["Sentinel", "Barbican", "Vidette", "Redoubt", "Conflux"]);

export function staticDestinationForCode(code: string) {
  const normalized = String(code || "").toUpperCase();
  for (const [destination, codes] of Object.entries(STATIC_CODES_BY_CLASS)) {
    if (codes.includes(normalized)) return destination;
  }
  return "other";
}

export function sortStatics(statics: string[] = []) {
  const order = ["c1", "c2", "c3", "c4", "c5", "c6", "hs", "ls", "ns", "thera", "other"];
  return [...statics].sort((a, b) => {
    const aIndex = order.indexOf(staticDestinationForCode(a));
    const bIndex = order.indexOf(staticDestinationForCode(b));
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex) || a.localeCompare(b);
  });
}

export function systemClassLabel(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "Unknown";
  if (/^\d+$/.test(raw)) return `C${raw}`;
  if (specialClassNames.has(raw)) return raw;
  return raw.toUpperCase();
}

export function classColorFor(value?: string | null) {
  const raw = String(value || "").trim();
  const key = /^\d+$/.test(raw) ? `c${raw}` : raw.toLowerCase();
  return terminalToneMap[key] || terminalToneMap.other;
}

export function staticReadoutForCode(code: string) {
  const normalized = String(code || "").toUpperCase();
  const destination = staticDestinationForCode(normalized).toUpperCase();
  return destination === "OTHER" ? normalized : `${normalized} -> ${destination}`;
}

export function planetTypeLabel(typeName?: string | null) {
  return String(typeName || "")
    .replace(/^Planet\s*\(/i, "")
    .replace(/^Planet\s+/i, "")
    .replace(/\)$/g, "")
    .trim();
}

export function systemSolarId(system: WormholeSystem) {
  return system.solarsystemid || system.solarSystemID || system.solar_system_id || null;
}

export function isA0System(system: WormholeSystem) {
  const starTypeId = Number(system.star_type_id ?? system.star?.type_id);
  if (Number.isFinite(starTypeId)) return starTypeId === 3801;
  return /^Sun A0\b(?!IV)/i.test(String(system.star_name || system.star?.name || ""));
}

export function isShatteredSystem(system: WormholeSystem) {
  return Boolean(
    system.shattered ||
      system.isShattered ||
      String(system.star_name || system.star?.name || "").toLowerCase().includes("a0iv") ||
      (system.planets || []).some((planet) =>
        String(planet.type_name || "").toLowerCase().includes("shattered")
      )
  );
}

function compactEffect(effect?: string | null) {
  const value = String(effect || "").trim();
  if (!value || value.toLowerCase() === "no effect") return "None";
  return value;
}

function planetSummary(system: WormholeSystem) {
  const planets = system.planets || [];

  if (isShatteredSystem(system) && planets.length) {
    return `${planets.length} shattered planets`;
  }

  if (system.planetSummary?.length) {
    return system.planetSummary.map((item) => `${item.type} x${item.count}`).join(" / ");
  }

  const counts = new Map<string, number>();
  for (const planet of system.planets || []) {
    const type = planetTypeLabel(planet.type_name);
    if (!type) continue;
    counts.set(type, (counts.get(type) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${type} x${count}`)
    .join(" / ");
}

function moonTotal(system: WormholeSystem) {
  if (typeof system.moonCount === "number") return system.moonCount;
  return (system.planets || []).reduce(
    (total, planet) => total + (Number(planet.moon_count ?? planet.moons) || 0),
    0
  );
}

function staticsText(system: WormholeSystem) {
  const statics = sortStatics(system.statics || []);
  if (!statics.length) return "No listed statics";
  return statics
    .map((code) => staticDestinationForCode(code).toUpperCase())
    .join(" / ");
}

function staticsReadout(system: WormholeSystem) {
  const statics = sortStatics(system.statics || []);
  if (!statics.length) return "NONE";
  return statics.map(staticReadoutForCode).join(" / ");
}

function flagsText(system: WormholeSystem) {
  const flags = [
    isA0System(system) ? "A0 STAR" : null,
    isShatteredSystem(system) ? "SHATTERED" : null,
  ].filter(Boolean);
  return flags.length ? flags.join(" / ") : "NONE";
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

function topEntities(entities: EntityActivity[] = []) {
  return [...entities]
    .sort((a, b) => b.activeDays - a.activeDays || a.lastSeenDaysAgo - b.lastSeenDaysAgo)
    .slice(0, 8);
}

function ExternalLinkText({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-[#53b6ff] hover:text-[#7fc5ff] underline underline-offset-2"
    >
      {children}
      <ExternalLink size={11} />
    </a>
  );
}

function Metric({
  label,
  value,
  tone = "text-[#cfd9e3]",
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="border border-[#2c2f36] bg-[#05070b]/80 px-2 py-2">
      <div className="text-[9px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-1 truncate font-mono text-[12px] ${tone}`}>{value}</div>
    </div>
  );
}

function bookmarkTagKey(value: string) {
  return value.trim().toLowerCase();
}

function bookmarkTagColor(value?: string) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : "#53b6ff";
}

function SystemMeta({
  label,
  value,
  tone = "text-[#cfd9e3]",
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1 border-l border-[#354052] pl-2 font-mono">
      <span className="text-[9px] uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <span className={`text-[10px] uppercase ${tone}`}>{value}</span>
    </span>
  );
}

function Heatmap({ activity, loading }: { activity: Activity | null; loading: boolean }) {
  if (loading && !activity) {
    return <div className="px-2 py-3 text-[11px] text-slate-500">Loading zKill activity...</div>;
  }

  if (!activity?.days?.length) {
    return <div className="px-2 py-3 text-[11px] text-slate-500">No activity heatmap available.</div>;
  }

  const hours = Array.from({ length: 24 }, (_, index) => index);
  const max = Math.max(1, Number(activity.max) || 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[430px] border-collapse table-fixed text-center text-[9px] text-slate-300">
        <thead>
          <tr className="bg-[#14161d]">
            <th className="w-[58px] border border-[#2b2d33] px-1 py-1 text-left font-medium">Day</th>
            {hours.map((hour) => (
              <th key={hour} className="border border-[#2b2d33] px-[1px] py-1 font-mono font-medium">
                {hour}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {activity.days.map((day, dayIndex) => (
            <tr key={day} className={dayIndex % 2 ? "bg-[#090b11]" : "bg-[#0c0f16]"}>
              <td className="border border-[#2b2d33] px-1 py-[3px] text-left text-slate-300">{day}</td>
              {hours.map((hour) => {
                const count = activity[dayIndex]?.[hour] || 0;
                const alpha = count ? 0.14 + (count / max) * 0.72 : 0.05;
                return (
                  <td
                    key={hour}
                    title={`${count} kills`}
                    style={{ backgroundColor: `rgba(191,59,59,${alpha})` }}
                    className="h-[14px] border border-[#2b2d33] p-0"
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EntityRows({ entities, kind }: { entities: EntityActivity[]; kind: "corporation" | "alliance" }) {
  const top = topEntities(entities);
  if (!top.length) {
    return <div className="text-[11px] text-slate-500">No recent {kind} activity in fetched kills.</div>;
  }

  return (
    <div className="space-y-1">
      {top.map((entity) => {
        const body = (
          <>
            <span className="truncate text-slate-200">{entity.name}</span>
            <span className="shrink-0 text-slate-500">
              {entity.activeDays}d active / last {entity.lastSeenDaysAgo}d
            </span>
          </>
        );

        return entity.id ? (
          <a
            key={String(entity.id)}
            href={`https://zkillboard.com/${kind}/${entity.id}/`}
            target="_blank"
            rel="noreferrer"
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-[11px] hover:text-[#7fc5ff]"
          >
            {body}
          </a>
        ) : (
          <div key={entity.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-[11px]">
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function WormholeDetails({
  system,
  onClose,
  onExpand,
  mode = "panel",
  bookmark,
  bookmarkTagColors = {},
  authChecked = true,
  canUseBookmarks = false,
  onToggleBookmark,
  onSaveNotes,
  onRequestSignIn,
}: WormholeDetailsProps) {
  const [copied, setCopied] = useState(false);
  const [summary, setSummary] = useState<KillboardSummary | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loadingIntel, setLoadingIntel] = useState(false);
  const [intelError, setIntelError] = useState<string | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  const solarId = systemSolarId(system);
  const summaryText = planetSummary(system);
  const planetCount = system.planetCount ?? system.planets?.length ?? 0;
  const systemIdText = solarId ? String(solarId) : "Unknown";
  const modalMode = mode === "modal";
  const classLabel = systemClassLabel(system.class);
  const effectLabel = compactEffect(system.effect);
  const hasEffect = effectLabel !== "None";
  const flagReadout = flagsText(system);
  const isBookmarked = Boolean(bookmark);
  const savedNickname = bookmark?.nickname?.trim() || "";

  useEffect(() => {
    setNicknameDraft(savedNickname);
    setNoteDraft(bookmark?.notes || "");
    setNotesSaved(false);
  }, [bookmark?.notes, savedNickname, system.jcode]);

  useEffect(() => {
    if (!solarId) return;

    const controller = new AbortController();
    setLoadingIntel(true);
    setIntelError(null);
    setSummary(null);
    setActivity(null);

    Promise.allSettled([
      fetchJson<KillboardSummary>(`/api/killboard-summary/${encodeURIComponent(String(solarId))}`, controller.signal),
      fetchJson<Activity>(`/api/structure-intel/zkill-activity/${encodeURIComponent(String(solarId))}`, controller.signal),
    ])
      .then(([summaryResult, activityResult]) => {
        if (controller.signal.aborted) return;

        if (summaryResult.status === "fulfilled") setSummary(summaryResult.value);
        if (activityResult.status === "fulfilled") setActivity(activityResult.value);

        const errors = [summaryResult, activityResult]
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => result.reason?.message || String(result.reason));

        setIntelError(errors.length ? errors.join(" / ") : null);
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) setIntelError(err.message || "Failed to load killboard intel");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingIntel(false);
      });

    return () => controller.abort();
  }, [solarId]);

  const relatedLinks = useMemo(() => {
    const base = [
      { label: "Wormhole PvE Sites", to: "/wormhole-sites" },
      { label: "Rolling Mass", to: "/rolling-mass" },
      { label: "Structure Age Calc", to: "/holeintel" },
      { label: "BattleReport", to: "/br" },
      { label: "Eviction Stats", to: "/evictions" },
    ];

    if (["5", "6"].includes(String(system.class || ""))) {
      base.push({ label: "C5 Ratting Fits", to: "/roachfits" });
    }

    return base;
  }, [system.class]);

  const copyJcode = async () => {
    try {
      await navigator.clipboard.writeText(system.jcode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const saveNotes = async () => {
    if (!canUseBookmarks) {
      onRequestSignIn?.();
      return;
    }
    if (!onSaveNotes) return;
    try {
      setSavingNotes(true);
      await onSaveNotes(system, noteDraft, nicknameDraft);
      setNotesSaved(true);
      window.setTimeout(() => setNotesSaved(false), 1200);
    } finally {
      setSavingNotes(false);
    }
  };

  return (
    <div className={`text-slate-100 text-[11px] leading-snug ${modalMode ? "" : "h-full"}`}>
      <div className="flex items-start justify-between gap-3 border-b border-[#3a3c40] bg-gradient-to-r from-[#111319] via-[#171920] to-[#242833] px-3 py-2">
        <div className="min-w-0">
          <div className="mb-1 text-[9px] uppercase tracking-[0.18em] text-slate-400">
            Show Info &gt; Wormhole System
          </div>
          <div>
            <h2 className="font-mono text-[24px] font-semibold leading-none text-slate-50">{system.jcode}</h2>
            {isBookmarked && savedNickname ? (
              <div className="mt-1 max-w-[360px] truncate font-mono text-[13px] text-[#53b6ff]">
                &quot;{savedNickname}&quot;
              </div>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
            <span>{system.region || "Unknown region"}</span>
            <span>{system.constellation || "Unknown constellation"}</span>
            <span className="font-mono">{systemIdText}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={copyJcode}
            title="Copy J-code"
            className="flex h-7 w-7 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-300 hover:border-[#53b6ff] hover:text-[#e5f4ff]"
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (!canUseBookmarks) onRequestSignIn?.();
              else onToggleBookmark?.(system);
            }}
            title={canUseBookmarks ? (isBookmarked ? "Remove bookmark" : "Bookmark system") : "Sign in to bookmark systems"}
            className={`flex h-7 w-7 items-center justify-center border bg-[#05070b] ${
              isBookmarked
                ? "border-[#53b6ff]/70 text-[#53b6ff] hover:text-[#9bdcff]"
                : "border-[#303236] text-slate-300 hover:border-[#53b6ff] hover:text-[#e5f4ff]"
            }`}
          >
            <Bookmark size={14} fill={isBookmarked ? "currentColor" : "none"} />
          </button>
          {onExpand ? (
            <button
              type="button"
              onClick={onExpand}
              title="Expand detail"
              className="flex h-7 w-7 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-300 hover:border-[#53b6ff] hover:text-[#e5f4ff]"
            >
              <Maximize2 size={14} />
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              title="Close"
              className="flex h-7 w-7 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-300 hover:border-[#bf3b3b] hover:text-[#ff6666]"
            >
              <X size={15} />
            </button>
          ) : null}
        </div>
      </div>

      {copied ? (
        <div className="border-b border-[#2c2f36] bg-[#071018] px-3 py-1 text-[10px] text-[#53b6ff]">
          {system.jcode} copied to clipboard
        </div>
      ) : null}

      <div className="border-b border-[#262933] bg-[#05070b] px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <SystemMeta label="Class" value={classLabel} tone={classColorFor(system.class)} />
          <SystemMeta label="Static" value={staticsReadout(system)} />
          <SystemMeta
            label="Effect"
            value={hasEffect ? effectLabel : "No effect"}
            tone={hasEffect ? "text-[#cfd9e3]" : "text-slate-500"}
          />
          {flagReadout !== "NONE" ? (
            <SystemMeta label="Flags" value={flagReadout} tone="text-[#b9c7d6]" />
          ) : null}
        </div>
      </div>

      <div className="p-3">
        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-4">
          <Metric label="Class" value={classLabel} tone={classColorFor(system.class)} />
          <Metric label="Statics" value={staticsText(system)} />
          <Metric label="Effect" value={effectLabel} tone={hasEffect ? "text-[#cfd9e3]" : "text-slate-500"} />
          <Metric
            label="Star"
            value={system.star_name || system.star?.name || "Unknown"}
            tone={isA0System(system) ? "text-[#bcd9ee]" : "text-[#cfd9e3]"}
          />
          <Metric label="Planets" value={planetCount} />
          <Metric label="Moons" value={moonTotal(system)} />
          <Metric label="Flags" value={flagReadout} tone={flagReadout === "NONE" ? "text-slate-500" : "text-[#cfd9e3]"} />
          <Metric
            label="Recent Kills"
            value={
              summary
                ? `${summary.totalKills ?? 0} / ${summary.daysCovered ?? 0}d`
                : loadingIntel
                  ? "Loading"
                  : "Unknown"
            }
            tone="text-[#53b6ff]"
          />
        </div>

        <div className="mb-3 border border-[#2c2f36] bg-[#070910]">
          <div className="border-b border-[#2c2f36] bg-[#101219] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
            External Links
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 p-2 text-[11px]">
            <ExternalLinkText href={`https://evemaps.dotlan.net/system/${system.jcode}`}>Dotlan</ExternalLinkText>
            {solarId ? (
              <ExternalLinkText href={`https://zkillboard.com/system/${solarId}/`}>zKillboard</ExternalLinkText>
            ) : null}
            <ExternalLinkText href={`https://anoik.is/systems/${system.jcode}`}>Anoik.is</ExternalLinkText>
          </div>
        </div>

        <div className="mb-3 border border-[#2c2f36] bg-[#070910]">
          <div className="border-b border-[#2c2f36] bg-[#101219] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
            Related Tools
          </div>
          <div className="grid grid-cols-2 gap-px bg-[#262933] text-[11px]">
            {relatedLinks.map((link) => (
              <a
                key={link.to}
                href={link.to}
                target="_blank"
                rel="noreferrer"
                className="bg-[#05070b] px-2 py-1.5 text-slate-300 hover:bg-[#11141d] hover:text-[#e5f4ff]"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="border border-[#2c2f36] bg-[#070910]">
            <div className="flex items-center justify-between border-b border-[#2c2f36] bg-[#101219] px-2 py-1">
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-300">
                Killboard Activity Calendar
              </span>
              {loadingIntel ? <span className="text-[10px] text-[#53b6ff]">loading</span> : null}
            </div>
            <Heatmap activity={activity} loading={loadingIntel} />
          </div>

          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-3">
            <div className="border border-[#2c2f36] bg-[#070910] p-2">
              <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">Recent Kills</div>
              <div className="text-[11px] text-slate-300">
                {summary ? (
                  <>
                    <span className="font-mono text-slate-100">{summary.totalKills ?? 0}</span> kills in the last{" "}
                    <span className="font-mono text-slate-100">{summary.daysCovered ?? 0}</span> days; latest{" "}
                    <span className="font-mono text-slate-100">{summary.mostRecentKillDaysAgo ?? "?"}</span>d ago.
                  </>
                ) : loadingIntel ? (
                  "Loading kill summary..."
                ) : (
                  "No kill summary available."
                )}
              </div>
              {intelError ? (
                <div className="mt-2 border border-[#7a2c2c] bg-[#19080a] px-2 py-1 text-[10px] text-[#ff9999]">
                  {intelError}
                </div>
              ) : null}
            </div>

            <div className="border border-[#2c2f36] bg-[#070910] p-2">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-300">Recent Corps</div>
              {summary ? <EntityRows entities={summary.activeCorporations || []} kind="corporation" /> : (
                <div className="text-[11px] text-slate-500">Loading corporation activity...</div>
              )}
            </div>

            <div className="border border-[#2c2f36] bg-[#070910] p-2">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-300">Recent Alliances</div>
              {summary ? <EntityRows entities={summary.activeAlliances || []} kind="alliance" /> : (
                <div className="text-[11px] text-slate-500">Loading alliance activity...</div>
              )}
            </div>
          </div>

          <div className="border border-[#2c2f36] bg-[#070910]">
            <div className="flex items-center justify-between border-b border-[#2c2f36] bg-[#101219] px-2 py-1">
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-300">Celestials</span>
              <span className="text-[10px] text-slate-500">{summaryText || "No planet summary"}</span>
            </div>
            <div className="space-y-2 p-2">
              {system.star_type_id || system.star?.type_id ? (
                <div className="flex items-center gap-2 border border-[#262933] bg-[#05070b]/70 px-2 py-1">
                  <img
                    src={`https://image.eveonline.com/Type/${system.star_type_id || system.star?.type_id}_32.png`}
                    alt=""
                    className="h-6 w-6"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[11px] text-slate-100">{system.star_name || system.star?.name || "Unknown Star"}</div>
                    <div className="text-[10px] text-slate-500">Star</div>
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-1">
                {(system.planets || []).map((planet) => {
                  const name = planet.name || planet.esi_name || "Unknown planet";
                  const type = planetTypeLabel(planet.type_name) || "Unknown";
                  const moons = Number(planet.moon_count ?? planet.moons) || 0;
                  return (
                    <div
                      key={String(planet.planet_id || planet.id || name)}
                      className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 border border-[#20232b] bg-[#05070b]/50 px-2 py-1"
                    >
                      {planet.type_id ? (
                        <img
                          src={`https://image.eveonline.com/Type/${planet.type_id}_32.png`}
                          alt=""
                          className="h-4 w-4"
                        />
                      ) : (
                        <span className="h-4 w-4 border border-[#303236]" />
                      )}
                      <div className="min-w-0 truncate text-[11px] text-slate-200">
                        {name} <span className="text-slate-500">- {type}</span>
                      </div>
                      <div className={moons ? "font-mono text-[10px] text-slate-300" : "font-mono text-[10px] text-slate-600"}>
                        {moons} moon{moons === 1 ? "" : "s"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="border border-[#2c2f36] bg-[#070910]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2c2f36] bg-[#101219] px-2 py-1">
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-300">Notes</span>
              {bookmark?.tags?.length ? (
                <span className="flex flex-wrap justify-end gap-1">
                  {bookmark.tags.map((tag) => {
                    const color = bookmarkTagColor(bookmarkTagColors[bookmarkTagKey(tag)]);
                    return (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] text-slate-200"
                        style={{ borderColor: `${color}99`, backgroundColor: `${color}14` }}
                      >
                        <span className="h-1.5 w-1.5" style={{ backgroundColor: color }} />
                        {tag}
                      </span>
                    );
                  })}
                </span>
              ) : null}
            </div>
            <div className="space-y-2 p-2">
              {!authChecked ? (
                <div className="text-[11px] text-slate-500">Checking account...</div>
              ) : !canUseBookmarks ? (
                <div className="flex flex-wrap items-center gap-2 border border-[#27435a] bg-[#07111a] px-2 py-1.5 text-[10px] text-[#9bdcff]">
                  <span className="uppercase tracking-widest">Sign in to save private system notes.</span>
                  <button
                    type="button"
                    className="border border-[#53b6ff]/50 bg-[#0b1b2a] px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-100 hover:border-[#53b6ff]"
                    onClick={onRequestSignIn}
                  >
                    Sign In
                  </button>
                </div>
              ) : !isBookmarked ? (
                <div className="flex flex-wrap items-center gap-2 border border-[#303236] bg-[#05070b] px-2 py-2 text-[11px] text-slate-400">
                  <span>Bookmark this system to add private notes.</span>
                  <button
                    type="button"
                    className="border border-[#53b6ff]/50 bg-[#0b1b2a] px-2 py-1 text-[10px] uppercase tracking-widest text-slate-100 hover:border-[#53b6ff]"
                    onClick={() => onToggleBookmark?.(system)}
                  >
                    Bookmark
                  </button>
                </div>
              ) : (
                <>
                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      Nickname
                    </span>
                    <input
                      value={nicknameDraft}
                      onChange={(event) => setNicknameDraft(event.target.value)}
                      className="h-8 w-full border border-[#303236] bg-[#05070b] px-2 font-mono text-[12px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#53b6ff]"
                      placeholder={`Nickname for ${system.jcode}`}
                      maxLength={80}
                    />
                  </label>
                  <textarea
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    className="min-h-[120px] w-full resize-y border border-[#303236] bg-[#05070b] px-2 py-1.5 text-[12px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#53b6ff]"
                    placeholder={`Private notes for ${system.jcode}...`}
                    maxLength={12000}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] text-slate-500">
                      Tags are managed from the bookmarked-results view.
                    </div>
                    <button
                      type="button"
                      disabled={savingNotes}
                      onClick={() => void saveNotes()}
                      className="border border-[#46b2ff]/70 bg-gradient-to-b from-[#1b8cc8] to-[#14608a] px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-50 hover:from-[#27a0df] hover:to-[#1672a4] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savingNotes ? "Saving..." : notesSaved ? "Saved" : "Save Bookmark"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WormholeModal({
  system,
  onClose,
  bookmark,
  bookmarkTagColors,
  authChecked,
  canUseBookmarks,
  onToggleBookmark,
  onSaveNotes,
  onRequestSignIn,
}: WormholeDetailsProps & { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-3 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl border border-[#3a3c40] bg-[#05070b] shadow-[0_0_32px_rgba(0,0,0,0.95)]"
        onClick={(event) => event.stopPropagation()}
      >
        <WormholeDetails
          system={system}
          onClose={onClose}
          mode="modal"
          bookmark={bookmark}
          bookmarkTagColors={bookmarkTagColors}
          authChecked={authChecked}
          canUseBookmarks={canUseBookmarks}
          onToggleBookmark={onToggleBookmark}
          onSaveNotes={onSaveNotes}
          onRequestSignIn={onRequestSignIn}
        />
      </div>
    </div>
  );
}
