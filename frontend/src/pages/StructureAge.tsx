/*
 * React page for /holeintel.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { History, Trash2, X } from "lucide-react";
import SystemIntel from "./SystemIntel";
import {
  requestSiteAuthModal,
  SITE_AUTH_CHANGED_EVENT,
  type SiteAuthChangeDetail,
} from "../auth/siteAuthEvents";
import type { AuthUser } from "../components/fitting/types";
import { ToolChrome } from "../components/tool-ui";

const fmtUTC = (iso: string) => new Date(iso).toUTCString().replace(" GMT", " UTC");

const extractFromPaste = (raw: string) => {
  const text = raw.trim();

  const showinfoMatch = text.match(/showinfo:(\d+)\/\/(\d{10,19})(?!\d)/i);
  const typeId = showinfoMatch ? Number(showinfoMatch[1]) : null;
  const idMatch = showinfoMatch || text.match(/\/\/(\d{10,19})(?!\d)>/) || text.match(/\b(\d{10,19})\b/);
  const structureId = showinfoMatch ? showinfoMatch[2] : idMatch ? idMatch[1] : null;

  const jMatch = text.match(/\bJ\d{6}\b/i);
  const jcode = jMatch ? jMatch[0].toUpperCase() : null;

  let corpName: string | null = null;
  const corpInUrl = text.match(/\(([^()]+)\)\s*<\/url>/);
  if (corpInUrl) corpName = corpInUrl[1].trim();
  else {
    const corpAtEnd = text.match(/\(([^()]+)\)\s*$/);
    if (corpAtEnd) corpName = corpAtEnd[1].trim();
  }

  return { structureId, typeId, jcode, corpName };
};

function humanizeDays(days: number) {
  const abs = Math.abs(days);
  if (abs < 14) return `${Math.round(abs)}d`;
  if (abs < 120) return `${Math.round(abs / 7)}w`;
  return `${Math.round(abs / 30)}m`;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseUTCInput(raw: string) {
  const s = (raw || "").trim();
  if (!s) return null;

  const mColon = s.match(/^(\d{1,2})[:.](\d{2})$/);
  if (mColon) {
    const hh = Number(mColon[1]);
    const mm = Number(mColon[2]);
    if (Number.isFinite(hh) && Number.isFinite(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return { hh, mm };
    }
  }

  const mDigits = s.match(/^(\d{1,4})$/);
  if (mDigits) {
    const digits = mDigits[1];
    if (digits.length <= 2) {
      const hh = Number(digits);
      if (hh >= 0 && hh <= 23) return { hh, mm: 0 };
    } else {
      const padded = digits.padStart(4, "0");
      const hh = Number(padded.slice(0, 2));
      const mm = Number(padded.slice(2));
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return { hh, mm };
    }
  }

  return null;
}

function fmtInTZ(d: Date, timeZone: string) {
  try {
    const fmt = new Intl.DateTimeFormat(undefined, {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return fmt.format(d).replace(/\u202F|\u00A0/g, " ");
  } catch {
    return "";
  }
}

type AgeResponse = {
  id: string;
  method: "exact" | "interpolate" | "extrapolate-head" | "extrapolate-tail";
  midISO: string;
  lowISO: string;
  highISO: string;
  daysWide: string;
};

type ZKillActivity = { days: string[]; max: number } & Record<number, any>;
type SystemActivity = { days: string[]; max: number } & Record<number, any>;

const STRUCTURE_AGE_HISTORY_TOOL_KEY = "structure-age-checks";
const ADMIN_REPLAY_STORAGE_KEY = "trifftools:admin-replay-token";

type ParsedStructurePaste = ReturnType<typeof extractFromPaste>;

type SavedToolSetup = {
  id: string;
  setupName: string;
  setupJson?: unknown;
  summaryJson?: {
    structureId?: string;
    typeId?: number | null;
    jcode?: string | null;
    corpName?: string | null;
    checkedAt?: string;
    method?: string;
    midISO?: string;
    lowISO?: string;
    highISO?: string;
    daysWide?: string;
  };
  createdAt?: string;
  updatedAt?: string;
  lastOpenedAt?: string | null;
};

type SavedStructureCheck = {
  version: 1;
  input: string;
  structureId: string;
  typeId?: number | null;
  jcode: string | null;
  corpName: string | null;
};

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

function formatCheckedAt(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function savedCheckFromSetup(setupJson: unknown, summaryJson?: SavedToolSetup["summaryJson"]): SavedStructureCheck | null {
  const source = setupJson && typeof setupJson === "object" ? setupJson as Partial<SavedStructureCheck> : {};
  const structureId = String(source.structureId || summaryJson?.structureId || "").trim();
  if (!/^\d{10,19}$/.test(structureId)) return null;
  const jcode = typeof source.jcode === "string"
    ? source.jcode.toUpperCase()
    : typeof summaryJson?.jcode === "string"
      ? summaryJson.jcode.toUpperCase()
      : null;
  const corpName = typeof source.corpName === "string"
    ? source.corpName
    : typeof summaryJson?.corpName === "string"
      ? summaryJson.corpName
      : null;
  const input = typeof source.input === "string" && source.input.trim()
    ? source.input
    : `${jcode || ""} ${structureId}${corpName ? ` (${corpName})` : ""}`.trim();
  return {
    version: 1,
    input,
    structureId,
    typeId: Number.isInteger(Number(source.typeId)) ? Number(source.typeId) : null,
    jcode,
    corpName,
  };
}

export default function StructureAge() {
  const [searchParams] = useSearchParams();
  const adminReplayRequested = searchParams.get("adminReplay") === "1";
  const replayAutorun = searchParams.get("autorun") === "1";
  const [input, setInput] = useState("");
  const [data, setData] = useState<AgeResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [parsedJ, setParsedJ] = useState<string | undefined>();
  const [corpName, setCorpName] = useState<string | undefined>();
  const [corpId, setCorpId] = useState<number | undefined>();
  const [corpResolving, setCorpResolving] = useState(false);

  const [corpActivity, setCorpActivity] = useState<ZKillActivity | null>(null);

  const [tzMode, setTzMode] = useState<"UTC" | "US" | "BEST" | "DEF">("UTC");

  const [systemActivity, setSystemActivity] = useState<SystemActivity | null>(null);
  const [systemErr, setSystemErr] = useState<string | null>(null);

  const [reinforcementInput, setReinforcementInput] = useState<string>("");
  const [copyOk, setCopyOk] = useState(false);
  const [systemId, setSystemId] = useState<number | undefined>();
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [savedChecks, setSavedChecks] = useState<SavedToolSetup[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyBusy, setHistoryBusy] = useState<"load" | "delete" | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const replayStartedRef = useRef(false);

  async function refreshSavedChecks() {
    if (!authUser) return;
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/tool-setups/${STRUCTURE_AGE_HISTORY_TOOL_KEY}`, {
        credentials: "include",
      });
      const payload = await readJson<{ ok: boolean; setups: SavedToolSetup[] }>(response);
      const next = (payload.setups || []).sort((a, b) => {
        const at = Date.parse(a.summaryJson?.checkedAt || a.createdAt || "");
        const bt = Date.parse(b.summaryJson?.checkedAt || b.createdAt || "");
        return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
      });
      setSavedChecks(next);
      setHistoryError(null);
    } catch (error: any) {
      setSavedChecks([]);
      setHistoryError(error?.message || "Failed to load previous checks.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function saveStructureCheck(parsed: ParsedStructurePaste, rawInput: string, ageData: AgeResponse) {
    if (!authUser || !parsed.structureId) return;

    const checkedAt = new Date().toISOString();
    const jcode = parsed.jcode || null;
    const corp = parsed.corpName || null;
    const setupName = `${jcode || "Unknown"} ${corp || "No corp"} ${checkedAt}`.slice(0, 160);

    try {
      const response = await fetch(`/api/tool-setups/${STRUCTURE_AGE_HISTORY_TOOL_KEY}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setupName,
          setupJson: {
            version: 1,
            input: rawInput,
            structureId: parsed.structureId,
            typeId: parsed.typeId,
            jcode,
            corpName: corp,
          },
          summaryJson: {
            structureId: parsed.structureId,
            typeId: parsed.typeId,
            jcode,
            corpName: corp,
            checkedAt,
            method: ageData.method,
            midISO: ageData.midISO,
            lowISO: ageData.lowISO,
            highISO: ageData.highISO,
            daysWide: ageData.daysWide,
          },
        }),
      });
      await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
      await refreshSavedChecks();
    } catch {
      // History should never block the intel result.
    }
  }

  async function performCheck(rawInput: string, saveToHistory: boolean) {
    setErr(null);
    setData(null);
    setCorpActivity(null);

    const parsed = extractFromPaste(rawInput);
    setInput(rawInput);
    setParsedJ(parsed.jcode ?? undefined);
    setCorpName(parsed.corpName ?? undefined);
    setCorpId(undefined);
    setSystemId(undefined);

    if (!parsed.structureId) {
      setErr("Could not find a structure ID in that paste.");
      return;
    }

    let ageData: AgeResponse | null = null;
    try {
      const r = await fetch("/api/structure-intel/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          structureId: parsed.structureId,
          typeId: parsed.typeId,
          jcode: parsed.jcode,
          corpName: parsed.corpName,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      ageData = j;
      setData(j);
    } catch (e: any) {
      setErr(e.message || "Failed to estimate age");
      return;
    }

    if (saveToHistory && ageData) {
      void saveStructureCheck(parsed, rawInput, ageData);
    }

    if (parsed.corpName) {
      try {
        setCorpResolving(true);
        const r2 = await fetch(`/api/structure-intel/corp-id?name=${encodeURIComponent(parsed.corpName)}`);
        const j2 = await r2.json();
        if (j2?.id) {
          setCorpId(j2.id);
          const act = await fetch(`/api/structure-intel/zkill-corp-activity/${j2.id}`).then((rr) => rr.json());
          setCorpActivity(act);
        }
      } catch {

      } finally {
        setCorpResolving(false);
      }
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await performCheck(input, true);
  }

  async function loadSavedCheck(check: SavedToolSetup) {
    if (!authUser) {
      requestSiteAuthModal("login");
      return;
    }

    setHistoryBusy("load");
    try {
      const response = await fetch(`/api/tool-setups/${STRUCTURE_AGE_HISTORY_TOOL_KEY}/${check.id}`, {
        credentials: "include",
      });
      const payload = await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
      const saved = savedCheckFromSetup(payload.setup.setupJson, payload.setup.summaryJson);
      if (!saved) throw new Error("Saved check is missing its structure ID.");
      setHistoryOpen(false);
      setHistoryError(null);
      await performCheck(saved.input, false);
      await refreshSavedChecks();
    } catch (error: any) {
      setHistoryError(error?.message || "Failed to load previous check.");
    } finally {
      setHistoryBusy(null);
    }
  }

  async function deleteSavedCheck(check: SavedToolSetup) {
    if (!authUser) {
      requestSiteAuthModal("login");
      return;
    }

    setHistoryBusy("delete");
    try {
      const response = await fetch(`/api/tool-setups/${STRUCTURE_AGE_HISTORY_TOOL_KEY}/${check.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      await readJson<{ ok: boolean }>(response);
      setHistoryError(null);
      await refreshSavedChecks();
    } catch (error: any) {
      setHistoryError(error?.message || "Failed to delete previous check.");
    } finally {
      setHistoryBusy(null);
    }
  }

  useEffect(() => {
    let alive = true;

    async function loadAuth() {
      try {
        const response = await fetch("/api/auth/me", { credentials: "include" });
        const payload = await readJson<{ ok: boolean; authenticated: boolean; user: AuthUser | null }>(response);
        if (alive) setAuthUser(payload.authenticated ? payload.user : null);
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
      setSavedChecks([]);
      setHistoryError(null);
      return;
    }
    void refreshSavedChecks();
  }, [authUser]);

  useEffect(() => {
    if (!authChecked || !adminReplayRequested || replayStartedRef.current) return;
    replayStartedRef.current = true;
    window.history.replaceState(window.history.state, "", "/holeintel");

    void (async () => {
      try {
        const token = window.sessionStorage.getItem(ADMIN_REPLAY_STORAGE_KEY)?.trim() || "";
        window.sessionStorage.removeItem(ADMIN_REPLAY_STORAGE_KEY);
        if (!/^[A-Za-z0-9_-]{32,160}$/.test(token)) throw new Error("Replay unavailable");

        const response = await fetch("/api/secret/replay/consume", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const payload = await readJson<{ ok: boolean; replayInput: string }>(response);
        const replayInput = typeof payload.replayInput === "string" ? payload.replayInput.trim() : "";
        if (!replayInput || replayInput.length > 4_000) throw new Error("Replay unavailable");
        setInput(replayInput);
        if (replayAutorun) await performCheck(replayInput, true);
      } catch {
        setErr("Unable to load that structure observation.");
      }
    })();
  }, [adminReplayRequested, authChecked, replayAutorun]);

  useEffect(() => {
    let abort = false;

    (async () => {
      try {
        setSystemErr(null);
        setSystemActivity(null);
        if (!parsedJ) return;

        const sys = await fetch(`/api/structure-intel/system-id/${encodeURIComponent(parsedJ)}`).then((r) => r.json());
        if (!sys?.id) {
          setSystemErr("Could not resolve system ID");
          return;
        }
        setSystemId(sys.id);
        if (abort) return;

        const act = await fetch(`/api/structure-intel/zkill-activity/${sys.id}`).then((r) => r.json());
        if (abort) return;
        setSystemActivity(act);
      } catch (e: any) {
        if (!abort) setSystemErr(e.message || "Failed to load system activity");
      }
    })();

    return () => {
      abort = true;
    };
  }, [parsedJ]);

  const defenderGuess = useMemo(() => {
    if (!corpActivity?.days) return null;

    const hourTotals = new Array(24).fill(0);
    for (let di = 0; di < corpActivity.days.length; di++) {
      for (let h = 0; h < 24; h++) {
        const v = corpActivity[di]?.[h] || 0;
        hourTotals[h] += v;
      }
    }
    const total = hourTotals.reduce((a, b) => a + b, 0);
    const peakHour = hourTotals.reduce((best, v, h) => (v > hourTotals[best] ? h : best), 0);
    const confidence = total ? Math.round((hourTotals[peakHour] / total) * 100) : 0;

    const zone = peakHour >= 0 && peakHour <= 7 ? "Americas (US)" : peakHour <= 15 ? "Europe/Africa" : "AU/Asia";

    return { peakHour, confidence, zone };
  }, [corpActivity]);

  const estimateBlock = useMemo(() => {
    if (!data) return null;

    const low = fmtUTC(data.lowISO);
    const high = fmtUTC(data.highISO);
    const mid = fmtUTC(data.midISO);

    const daysWide = Number.parseFloat(data.daysWide || "0");
    const ageDays = Math.floor((Date.now() - Date.parse(data.midISO)) / 86400000);

    return {
      low,
      high,
      mid,
      daysWide,
      method: data.method,
      ageLabel: humanizeDays(ageDays),
    };
  }, [data]);

  const bestWindows = useMemo(() => {
    if (!systemActivity?.days) return null;

    const totals = new Array(24).fill(0);
    for (let di = 0; di < systemActivity.days.length; di++) {
      for (let h = 0; h < 24; h++) totals[h] += systemActivity[di]?.[h] || 0;
    }

    const windows: { start: number; end: number; sum: number }[] = [];
    for (let start = 0; start < 24; start++) {
      const sum = totals[start] + totals[(start + 1) % 24];
      windows.push({ start, end: (start + 2) % 24, sum });
    }
    windows.sort((a, b) => a.sum - b.sum);

    const fmt = (h: number) => `${pad2(h)}:00`;
    const out: string[] = [];
    const used = new Set<number>();

    for (const w of windows) {
      const h1 = w.start;
      const h2 = (w.start + 1) % 24;
      if (used.has(h1) || used.has(h2)) continue;
      used.add(h1);
      used.add(h2);
      out.push(`${fmt(h1)}–${fmt((w.start + 2) % 24)} UTC (low activity)`);
      if (out.length >= 3) break;
    }
    return out;
  }, [systemActivity]);

  const reinforcement = useMemo(() => {
    const parsed = parseUTCInput(reinforcementInput);
    if (!parsed) return null;

    const now = new Date();
    const utcYear = now.getUTCFullYear();
    const utcMonth = now.getUTCMonth();
    const utcDay = now.getUTCDate();

    const d = new Date(Date.UTC(utcYear, utcMonth, utcDay, parsed.hh, parsed.mm, 0));
    const unix = Math.floor(d.getTime() / 1000);

    const viewer = fmtInTZ(d, "America/Chicago");
    const pacific = fmtInTZ(d, "America/Los_Angeles");
    const central = fmtInTZ(d, "America/Chicago");
    const eastern = fmtInTZ(d, "America/New_York");

    return {
      inputUTC: `${pad2(parsed.hh)}:${pad2(parsed.mm)}`,
      viewer,
      pacific,
      central,
      eastern,
      discord: `<t:${unix}:t>`,
    };
  }, [reinforcementInput]);

  return (
    <div className="tt-tool-v2 tt2-reference-page tt2-structure-age min-h-screen text-slate-100 leading-snug">
      <div className="mx-auto max-w-[1320px] px-2 py-3 sm:px-4 sm:py-6">
        <div className="tt2-window">
          <ToolChrome
            section="Intel"
            title="Structure Intel"
            badge="Watching"
            context="Structure Age"
            status="zKill / ESI online"
          />

          { }
          <div className="space-y-4 p-2 sm:p-3">
            <div className="border border-[#262933] bg-[#05070b]/90 px-3 py-3 sm:px-4">
              <p className="mb-1 text-[14px] text-slate-200">
                Paste an in-game <span className="text-slate-100">showinfo link</span> to estimate structure age and view
                local activity intel. See bottom right for example.
              </p>
              <p className="text-[12px] text-slate-400">
                The parser will extract the structure ID, J-code, and corp (if present), then compare the ID to 36,306 known structure ID's with anchor dates, and provide info on the activity of the hole and holding corp.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {authChecked && authUser ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 border border-[#303236] bg-[#05070b] px-2 py-1 text-[10px] uppercase tracking-widest text-slate-300 hover:border-[#53b6ff]/60 hover:bg-[#101219]"
                    onClick={() => {
                      setHistoryOpen(true);
                      void refreshSavedChecks();
                    }}
                  >
                    <History size={13} />
                    Previous Checks
                    {savedChecks.length ? <span className="text-[#53b6ff]">({savedChecks.length})</span> : null}
                  </button>
                ) : authChecked ? (
                  <div className="flex flex-wrap items-center gap-2 border border-[#27435a] bg-[#07111a] px-2 py-1.5 text-[10px] text-[#9bdcff]">
                    <span className="uppercase tracking-widest">
                      Sign in to save and revisit previous structure checks.
                    </span>
                    <button
                      type="button"
                      className="border border-[#53b6ff]/50 bg-[#0b1b2a] px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-100 hover:border-[#53b6ff]"
                      onClick={() => requestSiteAuthModal("login")}
                    >
                      Sign In
                    </button>
                  </div>
                ) : (
                  <span className="text-[10px] uppercase tracking-widest text-slate-500">Checking account...</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-3">
              <div className="space-y-3">
                { }
                <fieldset className="overflow-hidden border border-[#2c2f36] bg-[#070910]">
                  <legend className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300 select-none">
                    <span>Structure Age Estimate</span>
                    <span className="text-[9px] text-slate-500">▾</span>
                  </legend>

                  <div className="p-3 space-y-3">
                    <form onSubmit={onSubmit} className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                        <textarea
                          ref={textareaRef}
                          className="w-full min-h-[86px] resize-y bg-[#05070b] border border-[#303236] px-2 py-1 text-[12px] text-slate-100 placeholder:text-slate-600 outline-none focus:border-[#53b6ff]"
                          placeholder="Paste a showinfo link (or any text containing the structure ID + J-code)…"
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                        />
                        <button
                          type="submit"
                          className="w-full px-4 text-[11px] font-semibold uppercase tracking-widest sm:min-w-[120px] sm:w-auto
                                     bg-[#146791]
                                     border border-[#46b2ff]/70
                                     shadow-[0_0_12px_rgba(70,178,255,0.18)]
                                     hover:bg-[#1979aa]"
                        >
                          Estimate
                        </button>
                      </div>

                      {err ? (
                        <div className="border border-[#bf3b3b] bg-[#19080a] px-3 py-2 text-[12px] text-[#ff6666]">
                          {err}
                        </div>
                      ) : null}
                    </form>

                    <div className="border border-[#262933] bg-[#05070b]/70 p-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">System</div>
                          <div className="flex items-center gap-2">
                            <div className="font-mono text-[12px] text-slate-100">{parsedJ ?? "—"}</div>
                            {parsedJ ? (
                              <>
                                <a
                                  href={`https://anoik.is/systems/${encodeURIComponent(parsedJ)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] text-[#53b6ff] hover:text-[#7fc5ff] underline"
                                  title="Open on anoik.is"
                                >
                                  anoik.is
                                </a>

                                {systemId ? (
                                  <a
                                    href={`https://zkillboard.com/system/${systemId}/`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[11px] text-[#53b6ff] hover:text-[#7fc5ff] underline"
                                    title="Open on zKillboard"
                                  >
                                    zKill
                                  </a>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        </div>

                        <div>
                          <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Corp</div>
                          <div className="text-[12px] text-slate-100 truncate">
                            {corpName ? (
                              <>
                                {corpName}{" "}
                                <span className="text-slate-500">
                                  {corpResolving ? (
                                    "resolving…"
                                  ) : corpId ? (
                                    <a
                                      href={`https://zkillboard.com/corporation/${corpId}/`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="ml-2 text-[11px] text-[#53b6ff] hover:text-[#7fc5ff] underline"
                                      title="Open corporation on zKillboard"
                                    >
                                      zKill
                                    </a>
                                  ) : null}
                                </span>
                              </>
                            ) : (
                              "—"
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="border border-[#303236] bg-[#05070b]/60 p-3">
                      <div className="text-[10px] uppercase tracking-widest text-slate-300 mb-2">Estimate</div>
                      {estimateBlock ? (
                        <div className="space-y-2 text-[12px]">
                          <div className="text-slate-300">
                            Between <span className="font-mono text-slate-100">{estimateBlock.low}</span> and{" "}
                            <span className="font-mono text-slate-100">{estimateBlock.high}</span>
                          </div>
                          <div className="text-slate-300">
                            Midpoint: <span className="font-mono text-slate-100">{estimateBlock.mid}</span>{" "}
                            <span className="text-slate-500">({estimateBlock.method})</span>
                          </div>
                          <div className="text-slate-300">
                            Window width:{" "}
                            <span className="font-mono text-slate-100">{estimateBlock.daysWide.toFixed(1)} days</span>
                          </div>
                          <div className="text-slate-300">
                            Estimated age: <span className="font-mono text-slate-100">≈ {estimateBlock.ageLabel}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-[12px] text-slate-500">Paste a structure showinfo and hit Estimate.</div>
                      )}
                    </div>
                  </div>
                </fieldset>

                { }
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  { }
                  <fieldset className="overflow-hidden border border-[#2c2f36] bg-[#070910]">
                    <legend className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300 select-none">
                      <span>Lowest Prime-time Picker</span>
                      <span className="text-[9px] text-slate-500">▾</span>
                    </legend>
                    <div className="p-3">
                      {systemErr ? (
                        <div className="text-[12px] text-[#ff6666]">{systemErr}</div>
                      ) : bestWindows ? (
                        <div className="text-[12px] text-slate-300 space-y-2">
                          {bestWindows.map((line, i) => (
                            <div key={i} className="font-mono">
                              {line}
                            </div>
                          ))}
                          <div className="text-[10px] text-slate-500 leading-snug">
                            Based on zKill last-period heatmap. Uses the 3 lowest 2-hour bands across the week.
                          </div>
                        </div>
                      ) : (
                        <div className="text-[12px] text-slate-500">
                          Paste a showinfo link with a system to compute low-activity windows.
                        </div>
                      )}
                    </div>
                  </fieldset>

                  { }
                  <fieldset className="border border-[#2c2f36] bg-[#070910]">
                    <legend className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300 select-none">
                      <span>Reinforcement Time</span>
                      <span className="text-[9px] text-slate-500">▾</span>
                    </legend>
                    <div className="p-3">
                      <input
                        value={reinforcementInput}
                        onChange={(e) => setReinforcementInput(e.target.value)}
                        placeholder="e.g. 300, 1800, 03:00 (UTC)"
                        className="w-full bg-[#05070b] border border-[#303236] px-2 py-1 text-[12px] text-slate-100 placeholder:text-slate-600 outline-none focus:border-[#53b6ff]"
                      />
                      <div className="mt-2 text-[10px] text-slate-500">Today&apos;s date; auto-DST.</div>

                      {reinforcement ? (
                        <div className="mt-3 text-[12px] text-slate-300 space-y-1">
                          <div className="font-mono">
                            <span className="text-slate-500">INPUT (UTC):</span> {reinforcement.inputUTC}
                          </div>
                          <div className="font-mono">
                            <span className="text-slate-500">Viewer (America/Chicago):</span> {reinforcement.viewer}
                          </div>
                          <div className="font-mono">
                            <span className="text-slate-500">Pacific:</span> {reinforcement.pacific}
                          </div>
                          <div className="font-mono">
                            <span className="text-slate-500">Central:</span> {reinforcement.central}
                          </div>
                          <div className="font-mono">
                            <span className="text-slate-500">Eastern:</span> {reinforcement.eastern}
                          </div>

                          <button
                            className="mt-2 w-full h-[34px] px-3 text-[11px] font-semibold uppercase tracking-widest
                                       bg-gradient-to-b from-[#1b8cc8] to-[#14608a]
                                       border border-[#46b2ff]/70
                                       hover:from-[#27a0df] hover:to-[#1672a4]
                                       transition-all duration-150"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(reinforcement.discord);
                                setCopyOk(true);
                                setTimeout(() => setCopyOk(false), 1200);
                              } catch {

                              }
                            }}
                          >
                            {copyOk ? "Copied!" : "Copy Discord timecode"}{" "}
                            <span className="font-mono text-slate-100/90">{reinforcement.discord}</span>
                          </button>
                        </div>
                      ) : (
                        <div className="mt-3 text-[12px] text-slate-500">
                          Enter a UTC time to see PT/CT/ET + Discord code.
                        </div>
                      )}
                    </div>
                  </fieldset>

                  { }
                  <fieldset className="border border-[#2c2f36] bg-[#070910]">
                    <legend className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300 select-none">
                      <span>Defender Timezone</span>
                      <span className="text-[9px] text-slate-500">▾</span>
                    </legend>
                    <div className="p-3">
                      {defenderGuess ? (
                        <div className="text-[12px] text-slate-300 space-y-1">
                          <div>
                            <span className="text-slate-500">Likely zone:</span>{" "}
                            <span className="text-slate-100 font-semibold">{defenderGuess.zone}</span>
                          </div>
                          <div className="font-mono">
                            <span className="text-slate-500">Peak hour:</span> ~{pad2(defenderGuess.peakHour)}:00 UTC
                          </div>
                          <div>
                            <span className="text-slate-500">Confidence:</span>{" "}
                            <span className="text-slate-100 font-semibold">~{defenderGuess.confidence}%</span>{" "}
                            <span className="text-slate-500">(share of activity in that hour)</span>
                          </div>
                          <div className="text-[10px] text-slate-500">Based on last-period zKill activity.</div>
                        </div>
                      ) : (
                        <div className="text-[12px] text-slate-500">
                          Paste a showinfo link with a corp name to compute defender timezone guess.
                        </div>
                      )}
                    </div>
                  </fieldset>
                </div>
                {tzMode === "DEF" ? null : null}
              </div>

              { }
              <div className="space-y-3">
                <fieldset className="border border-[#2c2f36] bg-[#070910]">
                  <legend className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300 select-none">
                    <span>System Intel</span>
                    <span className="text-[9px] text-slate-500">▾</span>
                  </legend>
                  <div className="p-3">
                    <div className="text-[12px] text-slate-500 mb-2">
                      Killboard heatmap + recent corp presence for the parsed system.
                    </div>
                    <SystemIntel jcode={parsedJ} />
                  </div>
                </fieldset>
                <div className="border border-[#262933] bg-[#05070b]/70 px-3 py-2 text-[11px] text-slate-400">
                  Paste example:{" "}
                  <span className="font-mono text-slate-300">
                    [05:47:41] Triffnixxx &gt;&lt;url=showinfo:35832//1052228942902&gt;J133252 - Petrolium
                    (FernWeh Holder)&lt;/url&gt;
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="px-3 py-2 border-t border-[#262933] bg-[#05070b] text-[10px] text-slate-400 flex items-center justify-between">
            <div>Structure Intel is public on Triff.Tools</div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-[#3bbf5a]" />
              <span>zKill / ESI online</span>
            </div>
          </div>
        </div>
      </div>
      {historyOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-3">
          <div className="w-full max-w-2xl border border-[#34404c] bg-[#070910] text-slate-100 shadow-2xl shadow-black/70">
            <div className="flex min-h-9 items-center justify-between border-b border-[#20242c] bg-[#101219] px-3 py-1.5">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-200">
                  Previous Structure Checks
                </div>
                <div className="text-[10px] text-slate-500">
                  Saved to your Triff.Tools account when an age estimate succeeds.
                </div>
              </div>
              <button
                type="button"
                className="text-slate-500 hover:text-slate-100"
                onClick={() => {
                  if (historyBusy) return;
                  setHistoryOpen(false);
                }}
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>

            <div className="p-3">
              {historyError && (
                <div className="mb-2 border border-[#6b2b32] bg-[#1d090b] px-2 py-1.5 text-[11px] text-[#ffaaaa]">
                  {historyError}
                </div>
              )}

              {historyLoading ? (
                <div className="border border-[#262933] bg-[#05070b] px-3 py-4 text-[12px] text-slate-400">
                  Loading previous checks...
                </div>
              ) : savedChecks.length === 0 ? (
                <div className="border border-[#262933] bg-[#05070b] px-3 py-4 text-[12px] text-slate-400">
                  No saved checks yet. Run an estimate while signed in and it will appear here.
                </div>
              ) : (
                <div className="max-h-[420px] overflow-auto border border-[#262933] bg-[#05070b]">
                  <table className="w-full text-left text-[11px]">
                    <thead className="sticky top-0 bg-[#14161c] text-slate-300">
                      <tr>
                        <th className="border border-[#2b2d33] px-2.5 py-1.5">J-code</th>
                        <th className="border border-[#2b2d33] px-2.5 py-1.5">Corp</th>
                        <th className="border border-[#2b2d33] px-2.5 py-1.5">Checked At</th>
                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {savedChecks.map((check, idx) => {
                        const summary = check.summaryJson || {};
                        return (
                          <tr
                            key={check.id}
                            className={`${idx % 2 === 0 ? "bg-[#090b11]" : "bg-[#0c0f16]"} hover:bg-[#141821]`}
                          >
                            <td className="border border-[#2b2d33] px-2.5 py-1.5 font-mono text-slate-100">
                              {summary.jcode || "—"}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-slate-100">
                              <div className="max-w-[260px] truncate">{summary.corpName || "—"}</div>
                              {summary.structureId ? (
                                <div className="font-mono text-[10px] text-slate-500">{summary.structureId}</div>
                              ) : null}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-slate-300">
                              {formatCheckedAt(summary.checkedAt || check.createdAt)}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5">
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  className="border border-[#303236] bg-[#05070b] px-2 py-1 text-[10px] uppercase tracking-widest text-slate-300 hover:border-[#53b6ff]/60 hover:bg-[#101219] disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={!!historyBusy}
                                  onClick={() => void loadSavedCheck(check)}
                                >
                                  Load
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 border border-[#4a2730] bg-[#10070a] px-2 py-1 text-[10px] uppercase tracking-widest text-[#ffaaaa] hover:border-[#bf3b3b] hover:bg-[#1d090b] disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={!!historyBusy}
                                  onClick={() => void deleteSavedCheck(check)}
                                  title="Delete saved check"
                                >
                                  <Trash2 size={12} />
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
