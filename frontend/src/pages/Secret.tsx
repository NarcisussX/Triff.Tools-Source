/*
 * Private structure-observation dashboard for /secret.
 * Access is backed by a server-issued HttpOnly session; no secret is persisted in the browser.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  LogOut,
  RefreshCw,
  Zap,
} from "lucide-react";

type SecretAccessState = "checking" | "locked" | "authenticated";
const ADMIN_REPLAY_STORAGE_KEY = "trifftools:admin-replay-token";
const EXCLUDE_UNKNOWN_JCODE_STORAGE_KEY = "trifftools:secret:exclude-unknown-jcode";

type StructureObservation = {
  structureId: string;
  jcode: string | null;
  wormholeClass: string | number | null;
  typeId: string | number | null;
  typeName: string | null;
  method: string | null;
  midISO: string | null;
  lowISO: string | null;
  highISO: string | null;
  daysWide: string | number | null;
  corpName: string | null;
  defenderTimezone: string | null;
  defenderPeakHour: number | null;
  defenderConfidence: number | null;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  lastSeen: string | null;
  observationCount: number;
};

type SortKey =
  | "jcode"
  | "wormholeClass"
  | "typeName"
  | "estimatedAge"
  | "corpName"
  | "defenderTimezone"
  | "structureId"
  | "observationCount"
  | "lastSeen";

type SortDirection = "asc" | "desc";

type ForceAgeCheckResult = {
  scanned: number;
  updated: number;
  skipped: number;
  failed: number;
};

const POLL_INTERVAL_MS = 30_000;
const OBSERVATION_PAGE_SIZE = 250;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function initialExcludeUnknownJcode(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(EXCLUDE_UNKNOWN_JCODE_STORAGE_KEY);
    return stored === null ? true : stored !== "false";
  } catch {
    return true;
  }
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function ageInDays(midISO: string | null): number | null {
  const timestamp = parseTimestamp(midISO);
  if (timestamp === null) return null;
  return Math.max(0, (Date.now() - timestamp) / 86_400_000);
}

function formatAge(midISO: string | null): string {
  const days = ageInDays(midISO);
  if (days === null) return "Unknown";
  if (days < 14) return `${Math.floor(days)}d`;
  if (days < 120) return `${Math.round(days / 7)}w`;

  const months = Math.floor(days / 30.4375);
  if (months < 24) return `${months}mo`;

  const years = Math.floor(months / 12);
  const remainder = months % 12;
  return remainder ? `${years}y ${remainder}mo` : `${years}y`;
}

function formatWindow(value: StructureObservation["daysWide"]): string {
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) return "Window unknown";
  return `${days.toFixed(1)}d window`;
}

function formatWormholeClass(value: StructureObservation["wormholeClass"]): string {
  if (value === null || value === undefined || value === "") return "Unknown";
  const label = String(value).trim();
  return /^\d+$/.test(label) ? `C${label}` : label;
}

function formatPeakHour(value: number | null): string | null {
  if (!Number.isFinite(value)) return null;
  const hour = Math.max(0, Math.min(23, Math.floor(value as number)));
  return `${String(hour).padStart(2, "0")}:00 UTC`;
}

function formatLastSeen(value: string | null): string {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) return "Unknown";
  return new Date(timestamp).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeObservation(value: unknown): StructureObservation | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const structureId = safeString(row.structureId);
  if (!structureId || !/^\d{10,}$/.test(structureId)) return null;

  const count = finiteNumber(row.observationCount);
  const peakHour = finiteNumber(row.defenderPeakHour);
  const confidence = finiteNumber(row.defenderConfidence);

  return {
    structureId,
    jcode: safeString(row.jcode),
    wormholeClass:
      typeof row.wormholeClass === "number" || typeof row.wormholeClass === "string"
        ? row.wormholeClass
        : null,
    typeId:
      typeof row.typeId === "number" || typeof row.typeId === "string" ? row.typeId : null,
    typeName: safeString(row.typeName),
    method: safeString(row.method),
    midISO: safeString(row.midISO),
    lowISO: safeString(row.lowISO),
    highISO: safeString(row.highISO),
    daysWide:
      typeof row.daysWide === "number" || typeof row.daysWide === "string" ? row.daysWide : null,
    corpName: safeString(row.corpName),
    defenderTimezone: safeString(row.defenderTimezone),
    defenderPeakHour: peakHour,
    defenderConfidence: confidence,
    firstObservedAt: safeString(row.firstObservedAt),
    lastObservedAt: safeString(row.lastObservedAt),
    lastSeen: safeString(row.lastSeen) || safeString(row.lastObservedAt),
    observationCount: count !== null && count > 0 ? Math.floor(count) : 1,
  };
}

function compareNullable<T>(
  left: T | null,
  right: T | null,
  compare: (a: T, b: T) => number,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compare(left, right);
}

function valueForSort(row: StructureObservation, key: SortKey): string | number | null {
  switch (key) {
    case "jcode":
      return row.jcode;
    case "wormholeClass":
      return row.wormholeClass === null ? null : formatWormholeClass(row.wormholeClass);
    case "typeName":
      return row.typeName || (row.typeId === null ? null : String(row.typeId));
    case "estimatedAge":
      return ageInDays(row.midISO);
    case "corpName":
      return row.corpName;
    case "defenderTimezone":
      return row.defenderTimezone;
    case "structureId":
      return row.structureId;
    case "observationCount":
      return row.observationCount;
    case "lastSeen":
      return parseTimestamp(row.lastSeen);
  }
}

function compareRows(
  left: StructureObservation,
  right: StructureObservation,
  key: SortKey,
  direction: SortDirection,
): number {
  const a = valueForSort(left, key);
  const b = valueForSort(right, key);
  if (a === null && b === null) return collator.compare(left.structureId, right.structureId);
  if (a === null) return 1;
  if (b === null) return -1;
  const compared = compareNullable(a, b, (one, two) => {
    if (typeof one === "number" && typeof two === "number") return one - two;
    return collator.compare(String(one), String(two));
  });
  return (direction === "asc" ? compared : -compared) || collator.compare(left.structureId, right.structureId);
}

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return <ChevronsUpDown size={12} aria-hidden="true" className="text-slate-600" />;
  return direction === "asc" ? (
    <ArrowUp size={12} aria-hidden="true" className="text-[#53b6ff]" />
  ) : (
    <ArrowDown size={12} aria-hidden="true" className="text-[#53b6ff]" />
  );
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = activeKey === sortKey;
  return (
    <th
      scope="col"
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className="whitespace-nowrap border-b border-r border-[#2b2d36] bg-[#0b0e14] p-0 last:border-r-0"
    >
      <button
        type="button"
        className={`flex w-full items-center gap-1.5 px-3 py-2.5 text-[10px] uppercase tracking-[0.14em] text-slate-300 hover:bg-[#111620] hover:text-slate-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#53b6ff] ${
          align === "right" ? "justify-end" : "justify-start"
        }`}
        onClick={() => onSort(sortKey)}
      >
        {label}
        <SortIcon active={active} direction={direction} />
      </button>
    </th>
  );
}

export default function Secret() {
  const [access, setAccess] = useState<SecretAccessState>("checking");
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const [observations, setObservations] = useState<StructureObservation[]>([]);
  const [totalObservations, setTotalObservations] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [dataError, setDataError] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const [replayError, setReplayError] = useState(false);
  const [replayBusyId, setReplayBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [forceAgeCheckBusy, setForceAgeCheckBusy] = useState(false);
  const [forceAgeCheckResult, setForceAgeCheckResult] = useState<ForceAgeCheckResult | null>(null);
  const [forceAgeCheckError, setForceAgeCheckError] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("jcode");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [excludeUnknownJcode, setExcludeUnknownJcode] = useState(initialExcludeUnknownJcode);
  const loginInputRef = useRef<HTMLInputElement | null>(null);
  const tableViewportRef = useRef<HTMLElement | null>(null);
  const latestRequestId = useRef(0);

  const lockDashboard = useCallback(() => {
    latestRequestId.current += 1;
    setAccess("locked");
    setPassword("");
    setLoginError(false);
    setObservations([]);
    setTotalObservations(0);
    setPageIndex(0);
    setDataError(false);
    setLogoutError(false);
    setReplayError(false);
    setReplayBusyId(null);
    setRefreshing(false);
    setLastRefreshedAt(null);
    setForceAgeCheckBusy(false);
    setForceAgeCheckResult(null);
    setForceAgeCheckError(false);
  }, []);

  const loadObservations = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++latestRequestId.current;
    setRefreshing(true);

    try {
      // Age is displayed as elapsed time, so its sort direction is the inverse
      // of the stored midpoint timestamp used by the server.
      const serverDirection = sortKey === "estimatedAge"
        ? (sortDirection === "asc" ? "desc" : "asc")
        : sortDirection;
      const params = new URLSearchParams({
        sort: sortKey,
        direction: serverDirection,
        limit: String(OBSERVATION_PAGE_SIZE),
        offset: String(pageIndex * OBSERVATION_PAGE_SIZE),
      });
      if (excludeUnknownJcode) params.set("excludeUnknownJcode", "1");
      const response = await fetch(`/api/secret/observations?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
        signal,
      });

      if (requestId !== latestRequestId.current || signal?.aborted) return;
      if (response.status === 401 || response.status === 403) {
        lockDashboard();
        return;
      }
      if (!response.ok) throw new Error("request failed");

      const payload = await response.json();
      if (requestId !== latestRequestId.current || signal?.aborted) return;
      const source = Array.isArray(payload) ? payload : payload?.observations;
      if (!Array.isArray(source)) throw new Error("invalid response");

      const next = source
        .map(normalizeObservation)
        .filter((row: StructureObservation | null): row is StructureObservation => row !== null);
      const declaredTotal = finiteNumber(payload?.total);
      const total = declaredTotal !== null && declaredTotal >= 0
        ? Math.floor(declaredTotal)
        : next.length;

      setObservations(next);
      setTotalObservations(total);
      setDataError(false);
      setLastRefreshedAt(Date.now());
    } catch (error) {
      if (
        requestId === latestRequestId.current &&
        !(error instanceof DOMException && error.name === "AbortError")
      ) {
        setDataError(true);
      }
    } finally {
      if (requestId === latestRequestId.current) setRefreshing(false);
    }
  }, [excludeUnknownJcode, lockDashboard, pageIndex, sortDirection, sortKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        EXCLUDE_UNKNOWN_JCODE_STORAGE_KEY,
        String(excludeUnknownJcode),
      );
    } catch {
      // The filter still works for this page when browser storage is unavailable.
    }
  }, [excludeUnknownJcode]);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch("/api/secret/status", {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          lockDashboard();
          return;
        }
        const payload = await response.json();
        if (payload?.authenticated === true) {
          setAccess("authenticated");
        } else {
          lockDashboard();
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) lockDashboard();
      }
    })();

    return () => controller.abort();
  }, [lockDashboard]);

  useEffect(() => {
    if (access !== "locked") return;
    loginInputRef.current?.focus();
  }, [access]);

  useEffect(() => {
    if (access !== "authenticated") return;
    const controller = new AbortController();
    void loadObservations(controller.signal);

    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadObservations();
    }, POLL_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void loadObservations();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      controller.abort();
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [access, loadObservations]);

  const sortedObservations = useMemo(() => {
    const visible = excludeUnknownJcode
      ? observations.filter((observation) => observation.jcode !== null)
      : observations;
    return [...visible].sort((a, b) => compareRows(a, b, sortKey, sortDirection));
  }, [excludeUnknownJcode, observations, sortDirection, sortKey]);

  const pageCount = Math.max(1, Math.ceil(totalObservations / OBSERVATION_PAGE_SIZE));
  const pageStart = totalObservations ? pageIndex * OBSERVATION_PAGE_SIZE + 1 : 0;
  const pageEnd = totalObservations
    ? Math.min(totalObservations, pageIndex * OBSERVATION_PAGE_SIZE + observations.length)
    : 0;

  useEffect(() => {
    if (pageIndex >= pageCount) setPageIndex(pageCount - 1);
  }, [pageCount, pageIndex]);

  useEffect(() => {
    tableViewportRef.current?.scrollTo({ top: 0 });
  }, [pageIndex, sortDirection, sortKey]);

  function changeSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      setPageIndex(0);
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
    setPageIndex(0);
  }

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || loginBusy) return;

    setLoginBusy(true);
    setLoginError(false);
    try {
      const response = await fetch("/api/secret/login", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) throw new Error("access denied");
      const payload = await response.json();
      if (payload?.authenticated !== true && payload?.ok !== true) throw new Error("access denied");

      setPassword("");
      setAccess("authenticated");
    } catch {
      setPassword("");
      setLoginError(true);
      window.requestAnimationFrame(() => loginInputRef.current?.focus());
    } finally {
      setLoginBusy(false);
    }
  }

  async function logout() {
    try {
      setLogoutError(false);
      const response = await fetch("/api/secret/logout", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error("logout failed");
      lockDashboard();
    } catch {
      setLogoutError(true);
    }
  }

  async function forceAgeCheck() {
    if (forceAgeCheckBusy) return;

    setForceAgeCheckBusy(true);
    setForceAgeCheckResult(null);
    setForceAgeCheckError(false);

    try {
      const response = await fetch("/api/secret/force-age-check", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (response.status === 401 || response.status === 403) {
        lockDashboard();
        return;
      }

      const payload = await response.json();
      if (!response.ok || payload?.ok !== true) throw new Error("force age check failed");

      const count = (value: unknown) => {
        const parsed = finiteNumber(value);
        return parsed !== null && parsed >= 0 ? Math.floor(parsed) : 0;
      };
      setForceAgeCheckResult({
        scanned: count(payload.scanned),
        updated: count(payload.updated),
        skipped: count(payload.skipped),
        failed: count(payload.failed),
      });

      // This reload keeps the current page, sort, and saved unknown-system filter.
      await loadObservations();
    } catch {
      setForceAgeCheckError(true);
    } finally {
      setForceAgeCheckBusy(false);
    }
  }

  function openReplay(row: StructureObservation) {
    // Opening synchronously keeps this compatible with strict popup blockers. The
    // destination is assigned only after the server returns an opaque, short-lived token.
    const replayWindow = window.open("about:blank", "_blank");
    if (!replayWindow) {
      setReplayError(true);
      return;
    }

    try {
      replayWindow.opener = null;
      if (replayWindow.opener) throw new Error("opener isolation unavailable");
      const referrerPolicy = replayWindow.document.createElement("meta");
      referrerPolicy.name = "referrer";
      referrerPolicy.content = "no-referrer";
      replayWindow.document.head.appendChild(referrerPolicy);
      replayWindow.document.title = "Loading structure intel…";
      replayWindow.document.body.style.background = "#03050a";
    } catch {
      replayWindow.close();
      setReplayError(true);
      return;
    }

    setReplayError(false);
    setReplayBusyId(row.structureId);

    void (async () => {
      let sessionExpired = false;
      try {
        const response = await fetch("/api/secret/replay", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ structureId: row.structureId }),
        });
        if (response.status === 401 || response.status === 403) {
          sessionExpired = true;
          lockDashboard();
          throw new Error("session expired");
        }
        if (!response.ok) throw new Error("replay unavailable");

        const payload = await response.json();
        const token = safeString(payload?.token);
        if (!token || token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token)) {
          throw new Error("invalid replay token");
        }

        if (!replayWindow.closed) {
          replayWindow.sessionStorage.setItem(ADMIN_REPLAY_STORAGE_KEY, token);
          const params = new URLSearchParams({ adminReplay: "1", autorun: "1" });
          replayWindow.location.replace(`/holeintel?${params.toString()}`);
        }
      } catch {
        if (!replayWindow.closed) replayWindow.close();
        if (!sessionExpired) setReplayError(true);
      } finally {
        setReplayBusyId((current) => (current === row.structureId ? null : current));
      }
    })();
  }

  if (access !== "authenticated") {
    return (
      <div className="fixed inset-0 z-[100] grid min-h-screen place-items-center bg-[#03050a] px-4 text-slate-100">
        <form className="w-full max-w-[320px]" onSubmit={submitPassword}>
          <label htmlFor="secret-password" className="sr-only">
            Password
          </label>
          <input
            ref={loginInputRef}
            id="secret-password"
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setLoginError(false);
            }}
            autoComplete="current-password"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={loginBusy || access === "checking" ? "Checking…" : "Password"}
            disabled={loginBusy || access === "checking"}
            aria-invalid={loginError}
            aria-describedby={loginError ? "secret-login-error" : undefined}
            className="h-10 w-full border border-[#353943] bg-[#080b11] px-3 font-mono text-[13px] text-slate-100 caret-[#53b6ff] shadow-[0_0_24px_rgba(0,0,0,0.75)] outline-none placeholder:text-slate-600 hover:border-[#48505e] focus:border-[#53b6ff]/80 focus:shadow-[0_0_18px_rgba(83,182,255,0.14)] disabled:cursor-wait disabled:opacity-70"
          />
          <button type="submit" className="sr-only" tabIndex={-1}>
            Continue
          </button>
          {loginError ? (
            <p id="secret-login-error" role="alert" className="mt-2 text-center text-[10px] uppercase tracking-[0.16em] text-[#d97878]">
              Unable to continue
            </p>
          ) : null}
        </form>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex min-h-screen flex-col overflow-hidden bg-[#03050a] text-slate-100">
      <header className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-[#353943] bg-gradient-to-r from-[#0b0e14] via-[#11151d] to-[#171c26] px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-[11px] uppercase tracking-[0.2em] text-slate-200">
            Structure Observations
          </h1>
          <span className="hidden items-center gap-1.5 text-[10px] uppercase tracking-[0.13em] text-slate-500 sm:flex">
            <span className="h-1.5 w-1.5 bg-[#45cf78] shadow-[0_0_7px_rgba(69,207,120,0.7)]" aria-hidden="true" />
            {totalObservations.toLocaleString()} structures
          </span>
          {dataError ? (
            <span role="status" className="text-[10px] uppercase tracking-[0.13em] text-[#d9a45f]">
              Refresh unavailable
            </span>
          ) : null}
          {logoutError ? (
            <span role="alert" className="text-[10px] uppercase tracking-[0.13em] text-[#d97878]">
              Unable to lock
            </span>
          ) : null}
          {replayError ? (
            <span role="alert" className="text-[10px] uppercase tracking-[0.13em] text-[#d97878]">
              Replay unavailable
            </span>
          ) : null}
          <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {forceAgeCheckBusy
              ? "Checking stored structure ages."
              : forceAgeCheckResult
                ? `Force check complete: ${forceAgeCheckResult.scanned} scanned, ${forceAgeCheckResult.updated} updated, ${forceAgeCheckResult.skipped} skipped, ${forceAgeCheckResult.failed} failed.`
                : ""}
          </span>
          {forceAgeCheckBusy ? (
            <span aria-hidden="true" className="hidden text-[10px] uppercase tracking-[0.13em] text-[#e9c46a] xl:inline">
              Checking stored structure ages…
            </span>
          ) : forceAgeCheckResult ? (
            <span aria-hidden="true" className="hidden whitespace-nowrap text-[10px] text-slate-500 xl:inline">
              Force check: {forceAgeCheckResult.scanned.toLocaleString()} scanned · {forceAgeCheckResult.updated.toLocaleString()} updated · {forceAgeCheckResult.skipped.toLocaleString()} skipped · {forceAgeCheckResult.failed.toLocaleString()} failed
            </span>
          ) : forceAgeCheckError ? (
            <span role="alert" className="text-[10px] uppercase tracking-[0.13em] text-[#d97878]">
              Force age check failed
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 whitespace-nowrap border border-[#353943] bg-[#080b11] px-2 text-[9px] uppercase tracking-[0.12em] text-slate-400 hover:border-[#53b6ff]/60 hover:text-slate-100 focus-within:ring-1 focus-within:ring-[#53b6ff]">
            <input
              type="checkbox"
              checked={excludeUnknownJcode}
              onChange={(event) => {
                setExcludeUnknownJcode(event.currentTarget.checked);
                setPageIndex(0);
              }}
              className="h-3 w-3 accent-[#53b6ff]"
            />
            <span>Hide unknown systems</span>
          </label>
          {lastRefreshedAt ? (
            <span className="hidden text-[10px] text-slate-600 md:inline">
              Updated {new Date(lastRefreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          ) : null}
          <span className="hidden whitespace-nowrap font-mono text-[10px] text-slate-500 lg:inline">
            {pageStart.toLocaleString()}–{pageEnd.toLocaleString()} / {totalObservations.toLocaleString()}
          </span>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center border border-[#353943] bg-[#080b11] text-slate-400 hover:border-[#53b6ff]/60 hover:text-slate-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#53b6ff] disabled:cursor-not-allowed disabled:opacity-30"
            onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
            disabled={refreshing || pageIndex <= 0}
            aria-label="Previous observation page"
          >
            <ChevronLeft size={13} />
          </button>
          <span className="whitespace-nowrap font-mono text-[9px] text-slate-500">
            {pageIndex + 1}/{pageCount}
          </span>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center border border-[#353943] bg-[#080b11] text-slate-400 hover:border-[#53b6ff]/60 hover:text-slate-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#53b6ff] disabled:cursor-not-allowed disabled:opacity-30"
            onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
            disabled={refreshing || pageIndex >= pageCount - 1}
            aria-label="Next observation page"
          >
            <ChevronRight size={13} />
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 border border-[#353943] bg-[#080b11] px-2 text-[9px] uppercase tracking-[0.14em] text-slate-400 hover:border-[#53b6ff]/60 hover:text-slate-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#53b6ff] disabled:opacity-50"
            onClick={() => void loadObservations()}
            disabled={refreshing || forceAgeCheckBusy}
            aria-label="Refresh observations"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap border border-[#6f5a28] bg-[#151006] px-2 text-[9px] uppercase tracking-[0.13em] text-[#e9c46a] hover:border-[#d9a45f] hover:bg-[#211807] hover:text-[#ffe5a3] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#e9c46a] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void forceAgeCheck()}
            disabled={forceAgeCheckBusy || refreshing}
            aria-label={forceAgeCheckBusy ? "Force age check in progress" : "Force age check"}
            aria-describedby="force-age-check-description"
            title="Re-run age estimation for every stored structure"
          >
            <Zap size={12} className={forceAgeCheckBusy ? "animate-pulse" : ""} aria-hidden="true" />
            {forceAgeCheckBusy ? "Checking ages…" : "Force age check"}
          </button>
          <span id="force-age-check-description" className="sr-only">
            Re-run age estimation for every stored structure and reload this table when complete.
          </span>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 border border-[#353943] bg-[#080b11] px-2 text-[9px] uppercase tracking-[0.14em] text-slate-400 hover:border-[#7b2f2f] hover:bg-[#160a0a] hover:text-slate-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#d97878]"
            onClick={() => void logout()}
          >
            <LogOut size={12} />
            <span className="hidden sm:inline">Lock</span>
          </button>
        </div>
      </header>

      <main ref={tableViewportRef} className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1580px] table-auto border-collapse text-left">
          <thead className="sticky top-0 z-10 shadow-[0_4px_14px_rgba(0,0,0,0.55)]">
            <tr>
              <SortHeader label="J-code" sortKey="jcode" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortHeader label="Class" sortKey="wormholeClass" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortHeader label="Structure Type" sortKey="typeName" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortHeader label="Estimated Age / Window" sortKey="estimatedAge" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortHeader label="Corporation" sortKey="corpName" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortHeader label="Defender Timezone" sortKey="defenderTimezone" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <SortHeader label="Structure ID" sortKey="structureId" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
              <th scope="col" className="whitespace-nowrap border-b border-r border-[#2b2d36] bg-[#0b0e14] px-3 py-2.5 text-[10px] uppercase tracking-[0.14em] text-slate-300">
                Load
              </th>
              <SortHeader label="Observations" sortKey="observationCount" activeKey={sortKey} direction={sortDirection} onSort={changeSort} align="right" />
              <SortHeader label="Last Seen" sortKey="lastSeen" activeKey={sortKey} direction={sortDirection} onSort={changeSort} />
            </tr>
          </thead>
          <tbody>
            {sortedObservations.map((row) => {
              const peakHour = formatPeakHour(row.defenderPeakHour);
              const lastSeenTimestamp = parseTimestamp(row.lastSeen);
              const lastSeenIso = lastSeenTimestamp === null
                ? null
                : new Date(lastSeenTimestamp).toISOString();
              return (
                <tr key={row.structureId} className="group border-b border-[#242833] bg-[#05070b]/95 hover:bg-[#0b1018]">
                  <td className="whitespace-nowrap border-r border-[#242833] px-3 py-2 font-mono text-[11px] font-semibold text-[#dff5ff]">
                    {row.jcode || "—"}
                  </td>
                  <td className="whitespace-nowrap border-r border-[#242833] px-3 py-2 font-mono text-[11px] text-slate-300">
                    {formatWormholeClass(row.wormholeClass)}
                  </td>
                  <td className="border-r border-[#242833] px-3 py-2 text-[11px] text-slate-100">
                    <div>{row.typeName || "Unknown"}</div>
                    {row.typeId !== null ? <div className="font-mono text-[9px] text-slate-600">{row.typeId}</div> : null}
                  </td>
                  <td className="whitespace-nowrap border-r border-[#242833] px-3 py-2">
                    <div className="font-mono text-[11px] text-slate-100">≈ {formatAge(row.midISO)}</div>
                    <div className="text-[9px] uppercase tracking-[0.1em] text-slate-500">{formatWindow(row.daysWide)}</div>
                  </td>
                  <td className="max-w-[280px] border-r border-[#242833] px-3 py-2 text-[11px] text-slate-200">
                    <div className="truncate" title={row.corpName || undefined}>{row.corpName || "Unknown"}</div>
                  </td>
                  <td className="whitespace-nowrap border-r border-[#242833] px-3 py-2">
                    <div className="text-[11px] text-slate-200">{row.defenderTimezone || "Unknown"}</div>
                    {(peakHour || row.defenderConfidence !== null) ? (
                      <div className="font-mono text-[9px] text-slate-600">
                        {[peakHour, row.defenderConfidence !== null ? `${Math.round(row.defenderConfidence)}% confidence` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap border-r border-[#242833] px-3 py-2 font-mono text-[10px] text-[#9bdcff]">
                    {row.structureId}
                  </td>
                  <td className="whitespace-nowrap border-r border-[#242833] px-3 py-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 border border-[#35404a] bg-[#07111a] px-2 py-1 text-[9px] uppercase tracking-[0.15em] text-[#bde9ff] hover:border-[#53b6ff] hover:bg-[#0b2233] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#53b6ff] disabled:cursor-not-allowed disabled:opacity-35"
                      disabled={replayBusyId !== null}
                      onClick={() => openReplay(row)}
                      title="Open and rerun this observation"
                    >
                      {replayBusyId === row.structureId ? "Opening" : "Load"} <ExternalLink size={10} />
                    </button>
                  </td>
                  <td className="whitespace-nowrap border-r border-[#242833] px-3 py-2 text-right font-mono text-[11px] font-semibold text-slate-200">
                    {row.observationCount.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[10px] text-slate-300">
                    {lastSeenIso ? (
                      <time dateTime={lastSeenIso} title={lastSeenIso}>
                        {formatLastSeen(row.lastSeen)}
                      </time>
                    ) : (
                      "Unknown"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!refreshing && !dataError && sortedObservations.length === 0 ? (
          <div className="grid min-h-[240px] place-items-center text-[10px] uppercase tracking-[0.18em] text-slate-600">
            No observations
          </div>
        ) : null}
      </main>
    </div>
  );
}
