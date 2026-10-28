/*
 * TriffLocal report generator and immutable saved report viewer.
 * POSTs pasted names for server-side hydration, then renders stored snapshots for shared links.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Loader2,
  RotateCcw,
  Send,
  ShieldAlert,
} from "lucide-react";
import { ToolChrome } from "../components/tool-ui";

type TriffLocalSummary = {
  parsedCount: number;
  characterCount: number;
  resolvedCount: number;
  unresolvedCount: number;
  partialCount: number;
  totalShipsDestroyed: number;
  totalShipsLost: number;
  highDangerCount: number;
};

type TriffLocalGroupEntity = {
  id: number;
  name: string | null;
  pilotCount: number;
  zkillUrl: string;
  imageUrl: string;
};

type TriffLocalEntity = {
  id: number;
  name: string | null;
  zkillUrl: string;
  imageUrl: string;
};

type TriffLocalShip = {
  typeId: number;
  name: string;
  zkillUrl: string;
  imageUrl: string;
};

type TriffLocalCharacterRow = {
  inputName: string;
  status: "ok" | "partial" | "unresolved";
  errors: string[];
  character: {
    id: number | null;
    name: string;
    zkillUrl?: string;
    imageUrl?: string;
  };
  corporation: TriffLocalEntity | null;
  alliance: TriffLocalEntity | null;
  faction: TriffLocalEntity | null;
  zkill: {
    shipsDestroyed: number | null;
    shipsLost: number | null;
    dangerRatio: number | null;
    dangerPercent: number | null;
    gangRatio: number | null;
    gangPercent: number | null;
    topShips: TriffLocalShip[];
  };
};

type TriffLocalDiagnostic =
  | string
  | {
      level?: string;
      code?: string;
      message?: string;
      inputName?: string;
      name?: string;
    };

type TriffLocalReportData = {
  version: number;
  id: string;
  title: string;
  createdAt: string;
  source: {
    parsedNames: string[];
    truncated: boolean;
  };
  summary: TriffLocalSummary;
  groups: {
    corporations: TriffLocalGroupEntity[];
    alliances: TriffLocalGroupEntity[];
    factions: TriffLocalGroupEntity[];
  };
  characters: TriffLocalCharacterRow[];
  diagnostics: TriffLocalDiagnostic[];
};

type ApiReportResponse = {
  ok: boolean;
  id?: string;
  url?: string;
  report?: TriffLocalReportData;
  error?: string;
};

type SortKey = "danger" | "kills" | "losses" | "name" | "corp";

const panelBase = "border border-[#2c2f36] bg-[#070910]";
const panelHeader =
  "flex min-h-[30px] items-center justify-between gap-2 border-b border-[#2c2f36] bg-[#101219] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300";
const panelLegend =
  "border border-[#2c2f36] bg-[#101219] px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300";
const inputClass =
  "min-h-[184px] w-full resize-y border border-[#303236] bg-[#05070b] px-2.5 py-2 text-[12px] leading-relaxed text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#53b6ff] focus:ring-0";
const buttonBase =
  "inline-flex min-h-9 items-center justify-center gap-1.5 border border-[#3a4655] bg-[#101219] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-200 transition-colors hover:border-[#53b6ff]/70 hover:bg-[#141a23] hover:text-white disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton =
  "inline-flex min-h-9 items-center justify-center gap-1.5 border border-[#46b2ff]/75 bg-[#146791] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white shadow-[0_0_12px_rgba(70,178,255,0.16)] transition-colors hover:bg-[#1979aa] disabled:cursor-not-allowed disabled:opacity-60";
const tableHead =
  "border-b border-r border-[#262933] bg-[#14161d] px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300";
const tableCell = "border-r border-[#262933] px-2 py-1.5 align-middle";

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

async function readJson<T>(response: Response): Promise<T> {
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
  }
  return data as T;
}

async function loadReport(id: string) {
  const response = await fetch(`/api/triff-local/reports/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json" },
  });
  return readJson<ApiReportResponse>(response);
}

async function createReport(input: string) {
  const response = await fetch("/api/triff-local/reports", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "text/plain",
    },
    body: input,
  });
  return readJson<ApiReportResponse>(response);
}

function errorLabel(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "");
  const labels: Record<string, string> = {
    not_found: "That TriffLocal report does not exist.",
    invalid_report_id: "That TriffLocal report ID is invalid.",
    triff_local_report_read_failed: "The report could not be loaded.",
  };
  return labels[raw] || raw || "The report could not be loaded.";
}

function apiErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "");
  const labels: Record<string, string> = {
    input_required: "Paste a local list, chat transcript, or member list first.",
    input_too_large: "That paste is too large for the Local Intel API.",
    no_character_names: "No EVE character names were found in that paste.",
    rate_limited: "Too many Local Intel reports are being generated. Try again in a minute.",
    not_found: "That Local Intel report does not exist.",
    invalid_report_id: "That TriffLocal report ID is invalid.",
    triff_local_report_create_failed: "The report could not be generated.",
  };
  return labels[raw] || raw || "Local Intel request failed.";
}

function fmtDate(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtInt(value: unknown, fallback = "0") {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number).toLocaleString() : fallback;
}

function fmtPercent(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number.toFixed(number >= 10 ? 0 : 1)}%`;
}

function inputLineCount(value: string) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function rowIssueText(row: TriffLocalCharacterRow) {
  if (row.status === "ok" && !row.errors?.length) return "";
  if (row.errors?.length) return row.errors.join(", ");
  if (row.status === "unresolved") return "Character not found";
  return "Partial hydration";
}

function publicReportUrl(id: string) {
  if (typeof window === "undefined") return `/triff-local/${id}`;
  return `${window.location.origin}/triff-local/${id}`;
}

function diagnosticText(item: TriffLocalDiagnostic) {
  if (typeof item === "string") return item;
  return [item.inputName || item.name, item.message || item.code || item.level].filter(Boolean).join(": ");
}

function dangerTone(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "text-slate-500";
  if (number >= 75) return "text-[#ff8a94]";
  if (number >= 45) return "text-[#ffc86d]";
  return "text-[#8ee6a6]";
}

function EntityLink({ entity }: { entity: TriffLocalEntity | null }) {
  if (!entity) return <span className="text-slate-600">-</span>;
  return (
    <a
      href={entity.zkillUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-w-0 items-center gap-2 text-slate-200 hover:text-[#9dd8ff]"
      title={entity.name || String(entity.id)}
    >
      {entity.imageUrl ? <img src={entity.imageUrl} alt="" className="h-5 w-5 shrink-0 bg-black" /> : null}
      <span className="truncate">{entity.name || entity.id}</span>
    </a>
  );
}

function GroupPanel({
  title,
  items,
  hiddenIds,
  onToggle,
}: {
  title: string;
  items: TriffLocalGroupEntity[];
  hiddenIds: Set<number>;
  onToggle: (id: number) => void;
}) {
  return (
    <section className={panelBase}>
      <div className={panelHeader}>
        <span>{title}</span>
        <span className="font-mono text-[#53b6ff]">{items.length}</span>
      </div>
      <div className="max-h-[118px] overflow-y-auto p-1.5">
        {items.length ? (
          <div className="flex flex-wrap gap-1.5">
            {items.map((item) => {
              const checked = !hiddenIds.has(item.id);
              const inputId = `visibility-${title.toLowerCase()}-${item.id}`;

              return (
                <div
                  key={item.id}
                  className={classNames(
                    "inline-flex max-w-full items-center border px-1.5 py-1 text-[10px] transition-colors",
                    checked
                      ? "border-[#1d2632] bg-[#05070b] text-slate-300"
                      : "border-[#242933] bg-[#0a0c10] text-slate-600 opacity-70"
                  )}
                >
                  <label htmlFor={inputId} className="flex min-w-0 cursor-pointer items-center gap-1.5">
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(item.id)}
                      className="h-3.5 w-3.5 shrink-0 accent-[#1897ff]"
                    />
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" className={classNames("h-5 w-5 shrink-0 bg-black", !checked && "grayscale")} />
                    ) : null}
                    <span className="truncate">{item.name || item.id}</span>
                    <span className={classNames("font-mono", checked ? "text-[#53b6ff]" : "text-slate-600")}>{item.pilotCount}</span>
                  </label>
                  <a
                    href={item.zkillUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1.5 shrink-0 border-l border-[#263140] pl-1.5 text-slate-500 hover:text-[#9dd8ff]"
                    title={`Open ${item.name || item.id} on zKillboard`}
                    aria-label={`Open ${item.name || item.id} on zKillboard`}
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-2 py-3 text-center text-[11px] text-slate-600">Empty</div>
        )}
      </div>
    </section>
  );
}

function SortButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={classNames(
        "border px-2 py-1 text-[9px] uppercase tracking-[0.1em]",
        active
          ? "border-[#53b6ff] bg-[#0e2234] text-white"
          : "border-[#303236] bg-[#05070b] text-slate-400 hover:border-[#53b6ff]/60 hover:text-white"
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function TriffLocalShellHeader({
  report,
  mode,
}: {
  report?: TriffLocalReportData | null;
  mode?: "create" | "loading" | "error" | "report";
}) {
  const statusLabel = report ? "Saved Report" : mode === "loading" ? "Hydrating" : "Paste Console";
  const overviewLabel = report ? "Saved Report" : "Threat Snapshot";

  return (
    <ToolChrome
      section="Wormholes & Intel"
      title="Local Intel"
      badge={statusLabel}
      context={overviewLabel}
      contextAside={(
        <Link to="/account" className="hidden text-[9px] uppercase tracking-[0.18em] text-slate-500 hover:text-[#9dd8ff] sm:block">
          Workspace
        </Link>
      )}
    />
  );
}

function PageShell({
  children,
  report,
  mode = "create",
}: {
  children: ReactNode;
  report?: TriffLocalReportData | null;
  mode?: "create" | "loading" | "error" | "report";
}) {
  return (
    <div className="tt-tool-v2 tt2-report-page tt2-local-intel min-h-screen leading-snug text-slate-100">
      <div className="mx-auto max-w-[1320px] px-2 py-3 sm:px-4 sm:py-6">
        <div className="tt2-window">
          <TriffLocalShellHeader report={report} mode={mode} />
          <div className="space-y-3 p-2 sm:p-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <PageShell mode="loading">
      <section className={classNames(panelBase, "mx-auto max-w-[620px]")}>
        <div className={panelHeader}>
          <span>Loading Report</span>
          <span className="text-slate-500">TriffLocal</span>
        </div>
        <div className="flex items-start gap-3 p-4">
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[#53b6ff]" />
          <div>
            <div className="text-[13px] font-semibold text-slate-100">Fetching saved snapshot</div>
            <div className="mt-1 text-[12px] leading-relaxed text-slate-500">
              This page reads the stored report only.
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <PageShell mode="error">
      <section className={classNames(panelBase, "mx-auto max-w-[620px]")}>
        <div className={panelHeader}>
          <span>TriffLocal Report</span>
          <span className="text-[#ff9aa3]">Unavailable</span>
        </div>
        <div className="space-y-4 p-4">
          <div className="flex items-start gap-2 text-[13px] text-[#ff9aa3]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{message}</span>
          </div>
          <Link to="/" className={buttonBase}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back Home
          </Link>
        </div>
      </section>
    </PageShell>
  );
}

function HydratingState({ inputCount }: { inputCount: number }) {
  return (
    <PageShell mode="loading">
      <section className={classNames(panelBase, "mx-auto mt-8 max-w-[620px]")}>
        <div className={panelHeader}>
          <span>Generating Report</span>
          <span className="text-slate-500">Triff.Tools</span>
        </div>
        <div className="flex items-start gap-3 p-4">
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[#53b6ff]" />
          <div className="space-y-2 text-[12px] text-slate-300">
            <div className="font-semibold text-slate-100">Hydrating Local Intel</div>
            <div className="leading-relaxed text-slate-500">
              Resolving pilots, corporations, alliances, and zKill stats
              {inputCount ? ` for roughly ${inputCount.toLocaleString()} pasted lines` : ""}.
            </div>
            <div className="h-1.5 overflow-hidden border border-[#243348] bg-[#05070b]">
              <div className="h-full w-1/3 animate-pulse bg-[#53b6ff]/60" />
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}

function CreateReportView({
  input,
  setInput,
  busy,
  error,
  onSubmit,
  onClear,
}: {
  input: string;
  setInput: (value: string) => void;
  busy: boolean;
  error: string;
  onSubmit: () => void;
  onClear: () => void;
}) {
  const [clipboardError, setClipboardError] = useState("");
  const visibleError = clipboardError || error;

  async function pasteClipboard() {
    setClipboardError("");
    try {
      const text = await navigator.clipboard?.readText?.();
      if (!text) {
        setClipboardError("Clipboard is empty or unavailable.");
        return;
      }
      setInput(text);
    } catch {
      setClipboardError("Clipboard read was blocked by the browser.");
    }
  }

  return (
    <PageShell mode="create">
      <fieldset className={classNames(panelBase, "overflow-hidden")}>
        <legend className={panelLegend}>New Report</legend>
        <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <textarea
              className={classNames(inputClass, "min-h-[220px] font-mono text-[12px]")}
              value={input}
              onChange={(event) => {
                setClipboardError("");
                setInput(event.target.value);
              }}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  onSubmit();
                }
              }}
              placeholder={"Paste EVE local, copied member list, or chat transcript...\n\nPilot One\nPilot Two\nPilot Three"}
              spellCheck={false}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <div className="border border-[#303236] bg-[#05070b] px-2 py-1.5 text-[10px] uppercase tracking-[0.18em] text-[#53b6ff]">
              Local Intel
            </div>
            <div className="border border-[#303236] bg-[#05070b] px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] text-slate-400">
              Local / Chat / Member List
            </div>
            <div className="min-h-[31px] border border-[#262933] bg-[#05070b] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
              <span>
                {input.trim() ? `${inputLineCount(input).toLocaleString()} non-empty lines` : "Waiting for pasted local"}
              </span>
            </div>

            {visibleError ? (
              <div className="flex items-start gap-2 border border-[#5f2630] bg-[#16080c] px-2 py-1.5 text-[11px] text-[#ff9aa3]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{visibleError}</span>
              </div>
            ) : null}

            <div className="mt-auto grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
              <button type="button" className={buttonBase} disabled={busy} onClick={() => void pasteClipboard()}>
                <ClipboardPaste className="h-3.5 w-3.5" />
                Paste
              </button>
              <button type="button" className={buttonBase} disabled={busy || !input} onClick={onClear}>
                <RotateCcw className="h-3.5 w-3.5" />
                Clear
              </button>
              <button type="button" className={classNames(primaryButton, "col-span-2 sm:col-span-1")} disabled={busy || !input.trim()} onClick={onSubmit}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Generate
              </button>
            </div>
          </div>
        </div>
      </fieldset>
    </PageShell>
  );
}

export default function TriffLocalReport() {
  const { id = "" } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [report, setReport] = useState<TriffLocalReportData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(id));
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("danger");
  const [copied, setCopied] = useState(false);
  const [hiddenCorporationIds, setHiddenCorporationIds] = useState<Set<number>>(() => new Set());
  const [hiddenAllianceIds, setHiddenAllianceIds] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    setHiddenCorporationIds(new Set());
    setHiddenAllianceIds(new Set());
  }, [id]);

  useEffect(() => {
    if (!id) {
      setReport(null);
      setError("");
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    loadReport(id)
      .then((payload) => {
        if (!alive) return;
        if (!payload.ok || !payload.report) throw new Error(payload.error || "not_found");
        setReport(payload.report);
      })
      .catch((err) => {
        if (alive) setError(errorLabel(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  async function submitReport() {
    const source = input.trim();
    if (!source) {
      setCreateError("Paste a local list, chat transcript, or member list first.");
      return;
    }

    setCreating(true);
    setCreateError("");
    try {
      const payload = await createReport(source);
      if (!payload.ok) throw new Error(payload.error || "triff_local_report_create_failed");
      const reportId = payload.report?.id || payload.id;
      const target = payload.url || (reportId ? `/triff-local/${reportId}` : "");
      if (!target) throw new Error("triff_local_report_create_failed");

      if (/^https?:\/\//i.test(target)) {
        const parsed = new URL(target);
        navigate(`${parsed.pathname}${parsed.search}${parsed.hash}`);
      } else {
        navigate(target);
      }
    } catch (err) {
      setCreateError(apiErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  const sortedCharacters = useMemo(() => {
    const rows = [...(report?.characters || [])];
    rows.sort((a, b) => {
      if (sortKey === "name") return (a.character.name || a.inputName).localeCompare(b.character.name || b.inputName);
      if (sortKey === "corp") return String(a.corporation?.name || "").localeCompare(String(b.corporation?.name || ""));
      if (sortKey === "kills") return Number(b.zkill?.shipsDestroyed || 0) - Number(a.zkill?.shipsDestroyed || 0);
      if (sortKey === "losses") return Number(b.zkill?.shipsLost || 0) - Number(a.zkill?.shipsLost || 0);
      const dangerDelta = Number(b.zkill?.dangerPercent || 0) - Number(a.zkill?.dangerPercent || 0);
      if (dangerDelta !== 0) return dangerDelta;
      return Number(b.zkill?.shipsDestroyed || 0) - Number(a.zkill?.shipsDestroyed || 0);
    });
    return rows;
  }, [report?.characters, sortKey]);

  const visibleCharacters = useMemo(
    () =>
      sortedCharacters.filter((row) => {
        if (row.status === "unresolved") return true;
        const corporationId = row.corporation?.id;
        const allianceId = row.alliance?.id;
        return !(
          (typeof corporationId === "number" && hiddenCorporationIds.has(corporationId)) ||
          (typeof allianceId === "number" && hiddenAllianceIds.has(allianceId))
        );
      }),
    [hiddenAllianceIds, hiddenCorporationIds, sortedCharacters]
  );

  function toggleHiddenId(id: number, setHiddenIds: React.Dispatch<React.SetStateAction<Set<number>>>) {
    setHiddenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copyLink() {
    if (!report || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(publicReportUrl(report.id));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  if (!id) {
    if (creating) return <HydratingState inputCount={inputLineCount(input)} />;
    return (
      <CreateReportView
        input={input}
        setInput={setInput}
        busy={creating}
        error={createError}
        onSubmit={() => void submitReport()}
        onClear={() => {
          setInput("");
          setCreateError("");
        }}
      />
    );
  }

  if (loading) return <LoadingState />;
  if (error || !report) return <ErrorState message={error || "That TriffLocal report could not be loaded."} />;

  const groups = report.groups || { corporations: [], alliances: [], factions: [] };
  const diagnostics = Array.isArray(report.diagnostics) ? report.diagnostics : [];
  const url = publicReportUrl(report.id);

  return (
    <PageShell report={report} mode="report">
        <section className={panelBase}>
          <div className="flex flex-col gap-2 border-b border-[#2c2f36] bg-[#101219] px-2 py-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                Intel &gt; Local Intel
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-[0.12em] text-[#7fa7d7]">
                <span>#{report.id}</span>
                <span>{fmtDate(report.createdAt)}</span>
                {report.source?.truncated ? <span className="text-[#ffc86d]">Input truncated</span> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonBase} onClick={copyLink}>
                <Copy className="h-3.5 w-3.5" />
                {copied ? "Copied" : "Copy Link"}
              </button>
              <a href={url} target="_blank" rel="noreferrer" className={buttonBase}>
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </a>
            </div>
          </div>
        </section>

        <div className="grid gap-2 lg:grid-cols-2">
          <GroupPanel
            title="Corporations"
            items={groups.corporations || []}
            hiddenIds={hiddenCorporationIds}
            onToggle={(entityId) => toggleHiddenId(entityId, setHiddenCorporationIds)}
          />
          <GroupPanel
            title="Alliances"
            items={groups.alliances || []}
            hiddenIds={hiddenAllianceIds}
            onToggle={(entityId) => toggleHiddenId(entityId, setHiddenAllianceIds)}
          />
        </div>

        {diagnostics.length ? (
          <section className="border border-[#6f4d16] bg-[#171005] px-3 py-2 text-[11px] text-[#d9c08a]">
            <div className="mb-1 flex items-center gap-2 font-bold uppercase tracking-[0.14em]">
              <ShieldAlert className="h-4 w-4" />
              Diagnostics
            </div>
            <ul className="space-y-1">
              {diagnostics.slice(0, 8).map((item, index) => (
                <li key={index}>{diagnosticText(item)}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className={panelBase}>
          <div className={panelHeader}>
            <div className="flex flex-wrap items-center gap-2">
              <span>Characters</span>
              <span className="font-mono normal-case tracking-normal text-[#53b6ff]">
                {visibleCharacters.length} of {report.characters.length} pilots visible
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <button
                type="button"
                className="border border-[#303236] bg-[#05070b] px-2 py-1 text-[9px] uppercase tracking-[0.1em] text-slate-400 hover:border-[#53b6ff]/60 hover:text-white disabled:cursor-default disabled:opacity-40"
                onClick={() => {
                  setHiddenCorporationIds(new Set());
                  setHiddenAllianceIds(new Set());
                }}
                disabled={!hiddenCorporationIds.size && !hiddenAllianceIds.size}
              >
                Show All
              </button>
              <span className="text-slate-500">Sort</span>
              <SortButton active={sortKey === "danger"} label="Danger" onClick={() => setSortKey("danger")} />
              <SortButton active={sortKey === "kills"} label="Kills" onClick={() => setSortKey("kills")} />
              <SortButton active={sortKey === "losses"} label="Losses" onClick={() => setSortKey("losses")} />
              <SortButton active={sortKey === "name"} label="Name" onClick={() => setSortKey("name")} />
              <SortButton active={sortKey === "corp"} label="Corp" onClick={() => setSortKey("corp")} />
            </div>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[980px] border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className={tableHead}>Pilot</th>
                  <th className={tableHead}>Corporation</th>
                  <th className={tableHead}>Alliance</th>
                  <th className={classNames(tableHead, "text-right")}>Danger</th>
                  <th className={classNames(tableHead, "text-right")}>Gang</th>
                  <th className={classNames(tableHead, "text-right")}>Kills</th>
                  <th className={classNames(tableHead, "text-right")}>Losses</th>
                  <th className={tableHead}>Recent Top Ships</th>
                </tr>
              </thead>
              <tbody>
                {visibleCharacters.map((row, index) => {
                  const issue = rowIssueText(row);
                  const name = row.character?.name || row.inputName;
                  const characterContent = (
                    <div className="flex min-w-0 items-center gap-2">
                      {row.character?.imageUrl ? (
                        <img src={row.character.imageUrl} alt="" className="h-7 w-7 shrink-0 bg-black" />
                      ) : (
                        <div className="h-7 w-7 shrink-0 border border-[#283241] bg-[#05070b]" />
                      )}
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-semibold">{name}</span>
                        </div>
                        {issue ? <div className="truncate text-[10px] text-[#ff9aa3]">{issue}</div> : null}
                      </div>
                    </div>
                  );

                  return (
                    <tr key={`${row.inputName}:${index}`} className={index % 2 === 0 ? "bg-[#0a0d13]" : "bg-[#05070b]"}>
                      <td className={tableCell}>
                        {row.character?.zkillUrl ? (
                          <a
                            href={row.character.zkillUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-100 hover:text-[#9dd8ff]"
                            title={name}
                          >
                            {characterContent}
                          </a>
                        ) : (
                          characterContent
                        )}
                      </td>
                      <td className={tableCell}>
                        <EntityLink entity={row.corporation} />
                      </td>
                      <td className={tableCell}>
                        <EntityLink entity={row.alliance} />
                      </td>
                      <td className={classNames(tableCell, "text-right font-mono", dangerTone(row.zkill?.dangerPercent))}>
                        {fmtPercent(row.zkill?.dangerPercent)}
                      </td>
                      <td className={classNames(tableCell, "text-right font-mono text-[#d7e9ff]")}>
                        {fmtPercent(row.zkill?.gangPercent)}
                      </td>
                      <td className={classNames(tableCell, "text-right font-mono text-slate-100")}>
                        {fmtInt(row.zkill?.shipsDestroyed, "-")}
                      </td>
                      <td className={classNames(tableCell, "text-right font-mono text-slate-100")}>
                        {fmtInt(row.zkill?.shipsLost, "-")}
                      </td>
                      <td className={tableCell}>
                        <div className="flex max-w-[260px] gap-1 overflow-x-auto">
                          {(row.zkill?.topShips || []).length ? (
                            row.zkill.topShips.slice(0, 10).map((ship) => (
                              <a
                                key={ship.typeId}
                                href={ship.zkillUrl}
                                target="_blank"
                                rel="noreferrer"
                                title={ship.name}
                                className="shrink-0 hover:opacity-90"
                              >
                                <img src={ship.imageUrl} alt={ship.name} className="h-7 w-7 bg-black" />
                              </a>
                            ))
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
    </PageShell>
  );
}
