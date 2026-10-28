/*
 * Triff.Tools D-scan intel page.
 * Renders D-scan paste submission, shareable scan reports, and wormhole transit-mass checks.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  ExternalLink,
  RefreshCcw,
  Send,
} from "lucide-react";
import { ToolChrome } from "../components/tool-ui";

type ReportResponse = {
  ok: boolean;
  id?: string;
  path?: string;
  createdAt?: string;
  scanType?: string;
  report?: DscanReport;
  error?: string;
};

type Summary = {
  itemCount?: number;
  shipCount?: number;
  totalMassKg?: number;
  totalMassKt?: number;
  largestShipMassKg?: number;
  massKnownCount?: number;
  ignoredCount?: number;
  unresolvedCount?: number;
  uniqueShipTypes?: number;
  uniqueClasses?: number;
};

type DscanGroup = {
  key: string;
  type_id?: number | null;
  type_name: string;
  group_name?: string | null;
  category_name?: string | null;
  kind: string;
  quantity: number;
  mass_kg?: number | null;
  total_mass_kg?: number;
  sample_names?: string[];
};

type DscanEntry = {
  line: number;
  name?: string | null;
  type_id?: number | null;
  type_name?: string | null;
  input_type_name?: string | null;
  distance?: string | null;
  group_name?: string | null;
  category_name?: string | null;
  kind: string;
  mass_kg?: number | null;
  raw: string;
  resolved: boolean;
};

type WormholeComparison = {
  key: string;
  label: string;
  note?: string;
  codes: string[];
  massKg: number;
  capacityKg: number;
  totalMassKg: number;
  usedPct: number | null;
  remainingKg: number;
  status: "ok" | "reduced" | "critical" | "over";
  reduced?: boolean;
};

type WormholeBand = {
  label: string;
  totalMassKg: number;
  codes: string[];
};

type WormholeType = {
  code: string;
  label: string;
  totalMassKg: number;
  minimumMassKg: number;
  criticalMassKg: number;
  band: string;
};

type DscanReport = {
  id?: string;
  ok: boolean;
  version: number;
  scanType: "dscan";
  createdAt: string;
  inputLineCount: number;
  summary: Summary;
  wormhole: {
    totalMassKg: number;
    totalMassKt: number;
    largestShipMassKg: number;
    comparisons: WormholeComparison[];
    selectedCodes: string[];
    bands: WormholeBand[];
    types: WormholeType[];
  };
  ships: DscanGroup[];
  shipClasses: DscanGroup[];
  objects: DscanGroup[];
  entries: DscanEntry[];
  unresolved: Array<{
    line: number;
    name?: string | null;
    type_id?: number | null;
    type_name?: string | null;
    reason: string;
    raw: string;
  }>;
};

const panelBase = "border border-[#2c2f36] bg-[#070910]";
const panelHeader =
  "px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300";
const inputClass =
  "bg-[#05070b] border border-[#303236] px-2 py-1.5 text-[11px] text-slate-100 placeholder-slate-600 outline-none focus:border-[#53b6ff] focus:ring-0";
const buttonBase =
  "inline-flex min-h-9 items-center justify-center gap-1.5 border border-[#3a4655] bg-[#101219] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-200 hover:border-[#53b6ff]/70 hover:bg-[#141a23] disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton =
  "inline-flex min-h-9 items-center justify-center gap-1.5 border border-[#46b2ff]/70 bg-[#146791] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-white shadow-[0_0_12px_rgba(70,178,255,0.16)] hover:bg-[#1979aa] disabled:cursor-not-allowed disabled:opacity-60";
const tableHead =
  "px-2.5 py-1.5 border-b border-[#2b2d33] border-r border-[#262933] bg-[#14161d] text-slate-200 whitespace-nowrap";
const tableCell = "px-2.5 py-1.5 border-r border-[#262933] align-middle";
const defaultCodePlaceholder = ["H296", "E175", "D364"];
const defaultComparisonLabels = ["XL", "3m", "2m", "1m"];

function classNames(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
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

function fmtMassKg(value: number | null | undefined, unit: "kg" | "kt" | "compact" = "compact") {
  if (value == null || !Number.isFinite(value)) return "-";
  if (unit === "kg") return `${Math.round(value).toLocaleString()} kg`;
  if (unit === "kt") return `${Math.round(value / 1000).toLocaleString()} kt`;
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} Gg`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} Mg`;
  return `${Math.round(value).toLocaleString()} kg`;
}

function fmtKt(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return Math.round(value / 1000).toLocaleString();
}

function fmtNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return Math.round(value).toLocaleString();
}

function fmtPct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function copyText(value: string) {
  if (!value) return;
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function typeIconUrl(typeId: number, size = 32) {
  return `https://images.evetech.net/types/${typeId}/icon?size=${size}`;
}

const classIconSources = {
  frigate: "https://wiki.eveuniversity.org/Special:Redirect/file/Isis_frigate.png",
  destroyer: "https://wiki.eveuniversity.org/Special:Redirect/file/Isis_destroyer.png",
  cruiser: "https://wiki.eveuniversity.org/Special:Redirect/file/Isis_cruiser.png",
  battlecruiser: "https://wiki.eveuniversity.org/Special:Redirect/file/Isis_battlecruiser.png",
  battleship: "https://wiki.eveuniversity.org/Special:Redirect/file/Isis_battleship.png",
  miningBarge: "https://wiki.eveuniversity.org/Special:Redirect/file/Isis_miningbarge.png",
  dreadnought: "https://wiki.eveuniversity.org/Special:Redirect/file/Icon_blue_dreadnought.png",
  carrier: "https://wiki.eveuniversity.org/Special:Redirect/file/Icon_blue_carrier.png",
  supercarrier: "https://wiki.eveuniversity.org/Special:Redirect/file/Icon_blue_supercarrier.png",
  titan: "https://wiki.eveuniversity.org/Special:Redirect/file/Icon_blue_titan.png",
} as const;

type ClassIconKey = keyof typeof classIconSources;

function shipClassIconKey(className?: string | null): ClassIconKey | null {
  const name = String(className || "").toLowerCase();
  if (!name) return null;
  if (name.includes("titan")) return "titan";
  if (name.includes("supercarrier")) return "supercarrier";
  if (name.includes("carrier") || name.includes("force auxiliary")) return "carrier";
  if (name.includes("dread")) return "dreadnought";
  if (name.includes("mining barge") || name.includes("exhumer")) return "miningBarge";
  if (name.includes("battlecruiser") || name.includes("command ship")) return "battlecruiser";
  if (name.includes("battleship") || name.includes("marauder") || name.includes("black ops")) return "battleship";
  if (name.includes("cruiser") || name.includes("recon") || name.includes("logistics") || name.includes("heavy interdictor")) return "cruiser";
  if (name.includes("destroyer") || name.includes("interdictor")) return "destroyer";
  if (
    name.includes("frigate") ||
    name.includes("interceptor") ||
    name.includes("covert ops") ||
    name.includes("stealth bomber") ||
    name.includes("shuttle")
  ) {
    return "frigate";
  }
  return null;
}

function ClassIcon({ className }: { className?: string | null }) {
  const key = shipClassIconKey(className);
  if (!key) {
    const initial = String(className || "?").trim().slice(0, 1).toUpperCase() || "?";
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-[#262933] bg-[#05070b] text-[10px] font-semibold text-slate-500">
        {initial}
      </span>
    );
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-[#26384a] bg-[#05070b]">
      <img src={classIconSources[key]} alt="" className="h-5 w-5 object-contain" onError={onImgError} />
    </span>
  );
}

function onImgError(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.display = "none";
}

function itemPath(typeId?: number | null) {
  return typeId ? `/items/${typeId}` : null;
}

function codeListFromInput(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,]+/)
        .map((code) => code.trim().toUpperCase())
        .filter((code) => /^[A-Z]\d{3}$/.test(code))
    )
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight,
  tone = "blue",
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  tone?: "blue" | "green" | "amber" | "red";
}) {
  const toneClass =
    tone === "green"
      ? "text-[#a7f3b0]"
      : tone === "amber"
        ? "text-[#ffd18a]"
        : tone === "red"
          ? "text-[#ffaaaa]"
          : "text-[#c1e5ff]";
  return (
    <div
      className={classNames(
        "border bg-[#05070b]/90 px-3 py-2",
        highlight
          ? "border-[#46b2ff]/70 shadow-[0_0_18px_rgba(70,178,255,0.25)]"
          : "border-[#262933]"
      )}
    >
      <div className="text-[10px] uppercase tracking-widest text-slate-400">{label}</div>
      <div className={classNames("truncate text-[16px] font-semibold", toneClass)}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

function ShellHeader({ report }: { report?: DscanReport | null }) {
  const reportLabel = report?.scanType === "dscan" ? "Directional Scan" : "Paste Console";
  return (
    <ToolChrome
      section="Wormholes & Intel"
      title="D-Scan Intel"
      badge={reportLabel}
      context="Scan Report"
      contextAside={(
        <Link to="/rolling-mass" className="hidden text-[9px] uppercase tracking-widest text-slate-500 hover:text-[#9dd8ff] sm:block">
          Rolling Mass
        </Link>
      )}
    />
  );
}

function PasteConsole({
  paste,
  setPaste,
  codeInput,
  setCodeInput,
  busy,
  error,
  onSubmit,
}: {
  paste: string;
  setPaste: (value: string) => void;
  codeInput: string;
  setCodeInput: (value: string) => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  const selectedCodes = codeListFromInput(codeInput);

  return (
    <fieldset className={classNames(panelBase, "overflow-hidden")}>
      <legend className={panelHeader}>New Scan</legend>
      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <textarea
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            className={classNames(inputClass, "min-h-[220px] w-full resize-y font-mono text-[12px] leading-relaxed")}
            spellCheck={false}
            placeholder="Paste copied EVE D-scan rows here"
          />
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <div className="border border-[#303236] bg-[#05070b] px-2 py-1.5 text-[10px] uppercase tracking-widest text-[#53b6ff]">
            D-Scan
          </div>

          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-400">
              Wormhole Codes
            </span>
            <input
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              className={classNames(inputClass, "w-full")}
              placeholder={defaultCodePlaceholder.join(", ")}
            />
          </label>

          <div className="min-h-[31px] border border-[#262933] bg-[#05070b] px-2 py-1 text-[10px] text-slate-500">
            {selectedCodes.length ? (
              <div className="flex flex-wrap gap-1">
                {selectedCodes.map((code) => (
                  <span key={code} className="border border-[#303236] bg-[#0b0d11] px-1.5 py-0.5 text-slate-300">
                    {code}
                  </span>
                ))}
              </div>
            ) : (
              <span>Default comparison set: {defaultComparisonLabels.join(" / ")}</span>
            )}
          </div>

          {error && (
            <div className="border border-[#6b2b32] bg-[#1d090b] px-2 py-1.5 text-[11px] text-[#ffaaaa]">
              {error}
            </div>
          )}

          <div className="mt-auto grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-end">
            <button
              type="button"
              className={buttonBase}
              onClick={() => setPaste("")}
              disabled={busy || !paste}
            >
              <RefreshCcw size={12} />
              Clear
            </button>
            <button
              type="button"
              className={primaryButton}
              onClick={onSubmit}
              disabled={busy || !paste.trim()}
            >
              {busy ? <RefreshCcw size={12} className="animate-spin" /> : <Send size={12} />}
              {busy ? "Parsing" : "Create Report"}
            </button>
          </div>
        </div>
      </div>
    </fieldset>
  );
}

function DscanReportHeader({ report }: { report: DscanReport }) {
  const id = report.id;
  const url = id ? `${window.location.origin}/dscan/${id}` : "";
  const s = report.summary;
  return (
    <div className="grid gap-2 border border-[#262933] bg-[#05070b]/90 p-2 lg:grid-cols-[170px_minmax(0,1fr)_112px]">
      <div className="flex min-w-0 flex-col justify-center gap-1 border border-[#262933] bg-[#070910] px-2 py-1.5">
        <div className="text-[10px] uppercase tracking-widest text-slate-300">Report</div>
        <div className="truncate font-mono text-[11px] text-[#9dd8ff]">{id || "unsaved"}</div>
        <div className="truncate text-[10px] text-slate-500">{fmtDate(report.createdAt)}</div>
      </div>

      <section className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
        <StatCard label="Ships" value={fmtNumber(s.shipCount)} sub={`${fmtNumber(s.uniqueShipTypes)} hull types`} />
        <StatCard label="Ship Classes" value={fmtNumber(s.uniqueClasses)} sub="combat profile" />
        <StatCard label="Scan Objects" value={fmtNumber(s.itemCount)} sub={`${fmtNumber(s.ignoredCount)} non-ship rows`} />
      </section>

      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
        {id && (
          <button type="button" className={classNames(buttonBase, "w-full")} onClick={() => copyText(url)}>
            <Copy size={12} />
            Copy Link
          </button>
        )}
        <Link to="/dscan" className={classNames(buttonBase, "w-full")}>
          <ClipboardPaste size={12} />
          New Scan
        </Link>
      </div>
    </div>
  );
}

function statusBoxTone() {
  return "border-[#303236] bg-[#05070b]";
}

type MassAdjustment = -0.1 | 0 | 0.1;

function statusTextTone(status: WormholeComparison["status"]) {
  if (status === "over") return "text-[#ffaaaa]";
  if (status === "critical") return "text-[#ffd18a]";
  if (status === "reduced") return "text-[#ffb86c]";
  return "text-slate-200";
}

function wormholeSizeLabel(row: WormholeComparison) {
  if (row.key === "BAND_XL" || row.key === "H296") return "3,300,000 (XL) Mass Holes";
  if (row.key === "BAND_3M") return "3,000,000 Mass holes";
  if (row.key === "BAND_2M") return "2,000,000 Mass holes";
  if (row.key === "BAND_1M") return "1,000,000 Mass holes";
  return row.label;
}

function wormholeSizeNote(row: WormholeComparison, codes: string) {
  return row.note || codes;
}

function readoutLabel(status: WormholeComparison["status"]) {
  if (status === "over") return "Too large!";
  if (status === "critical") return "Critical";
  if (status === "reduced") return "Over half mass!";
  return "Fits";
}

function massAdjustedStatus(remainingKg: number, usedPct: number | null): WormholeComparison["status"] {
  if (remainingKg < 0) return "over";
  if (usedPct != null && usedPct >= 90) return "critical";
  if (usedPct != null && usedPct >= 50) return "reduced";
  return "ok";
}

function adjustedComparison(row: WormholeComparison, adjustment: MassAdjustment): WormholeComparison {
  const baseCapacity = Number(row.massKg || row.capacityKg);
  const capacityKg = Number.isFinite(baseCapacity) ? Math.round(baseCapacity * (1 + adjustment)) : row.capacityKg;
  const totalMassKg = Number(row.totalMassKg || 0);
  const usedPct = capacityKg > 0 ? (totalMassKg / capacityKg) * 100 : null;
  const remainingKg = capacityKg - totalMassKg;
  return {
    ...row,
    capacityKg,
    usedPct,
    remainingKg,
    status: massAdjustedStatus(remainingKg, usedPct),
  };
}

function MassAdjustButtons({
  value,
  onChange,
}: {
  value: MassAdjustment;
  onChange: (value: MassAdjustment) => void;
}) {
  const options: Array<{ label: string; value: MassAdjustment }> = [
    { label: "-10%", value: -0.1 },
    { label: "+10%", value: 0.1 },
  ];
  return (
    <div className="flex items-center gap-1">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.label}
            type="button"
            className={classNames(
              "inline-flex h-6 items-center justify-center border px-1.5 text-[10px] uppercase tracking-widest",
              active
                ? "border-[#53b6ff]/70 bg-[#0b1722] text-[#c1e5ff] shadow-[0_0_10px_rgba(83,182,255,0.18)]"
                : "border-[#303236] bg-[#05070b] text-slate-400 hover:border-[#53b6ff]/60 hover:text-slate-200"
            )}
            onClick={() => onChange(active ? 0 : option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function WormholePanel({ report }: { report: DscanReport }) {
  const [adjustments, setAdjustments] = useState<Record<string, MassAdjustment>>({});
  const comparisons = useMemo(
    () => (report.wormhole?.comparisons || []).filter((row) => !row.reduced && !/_MIN$/i.test(row.key || "")),
    [report.wormhole?.comparisons]
  );
  const rows = useMemo(
    () => comparisons.map((row) => adjustedComparison(row, adjustments[row.key] || 0)),
    [adjustments, comparisons]
  );
  const setAdjustment = (key: string, value: MassAdjustment) => {
    setAdjustments((current) => ({
      ...current,
      [key]: value,
    }));
  };
  return (
    <fieldset className={panelBase}>
      <legend className={panelHeader}>Wormhole Mass</legend>
      <div className="p-2">
        <div className="mb-2 grid gap-2 text-[10px] text-slate-500 sm:grid-cols-3">
          <div className="border border-[#262933] bg-[#05070b] px-2 py-1">
            <span className="uppercase tracking-widest text-slate-400">Transit mass</span>
            <span className="ml-2 font-mono text-slate-100">{fmtKt(report.wormhole?.totalMassKg)} kt</span>
          </div>
          <div className="border border-[#262933] bg-[#05070b] px-2 py-1">
            <span className="uppercase tracking-widest text-slate-400">Largest hull</span>
            <span className="ml-2 font-mono text-slate-100">{fmtKt(report.wormhole?.largestShipMassKg)} kt</span>
          </div>
          <div className="border border-[#262933] bg-[#05070b] px-2 py-1">
            <span className="uppercase tracking-widest text-slate-400">Basis</span>
            <span className="ml-2 text-slate-100">ship hull mass only</span>
          </div>
        </div>

        <div className="space-y-1 sm:hidden">
          {rows.map((row) => {
            const codes = Array.isArray(row.codes) ? row.codes.join(" / ") : String(row.codes || "");
            const adjustment = adjustments[row.key] || 0;
            return (
              <div key={row.key || row.label} className="border border-[#303236] bg-[#090b11] px-2 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-100">{wormholeSizeLabel(row)}</div>
                    <div className="text-[10px] text-slate-500">{wormholeSizeNote(row, codes)}</div>
                  </div>
                  <MassAdjustButtons value={adjustment} onChange={(value) => setAdjustment(row.key, value)} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-px border border-[#262933] bg-[#262933] text-[10px]">
                  <div className="bg-[#05070b] px-2 py-1">
                    <div className="uppercase tracking-widest text-slate-500">Capacity</div>
                    <div className="font-mono text-slate-100">{fmtKt(row.capacityKg)}</div>
                  </div>
                  <div className="bg-[#05070b] px-2 py-1">
                    <div className="uppercase tracking-widest text-slate-500">Fleet</div>
                    <div className="font-mono text-slate-100">{fmtKt(row.totalMassKg)}</div>
                  </div>
                  <div className="bg-[#05070b] px-2 py-1">
                    <div className="uppercase tracking-widest text-slate-500">Used</div>
                    <div className={classNames("font-mono", statusTextTone(row.status))}>{fmtPct(row.usedPct)}</div>
                  </div>
                  <div className="bg-[#05070b] px-2 py-1">
                    <div className="uppercase tracking-widest text-slate-500">Remaining</div>
                    <div className={classNames("font-mono", row.remainingKg < 0 ? "text-[#ffaaaa]" : "text-slate-100")}>{fmtKt(row.remainingKg)}</div>
                  </div>
                </div>
                <div className="mt-2">
                  <span className={classNames("inline-flex border px-1.5 py-0.5 text-[10px]", statusBoxTone(), statusTextTone(row.status))}>
                    {readoutLabel(row.status)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto border border-[#303236] bg-[#05070b] scrollbar-thin scrollbar-track-[#05070b] scrollbar-thumb-[#252836] sm:block">
          <table className="min-w-[820px] w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#14161d]">
            <tr>
              <th className={classNames(tableHead, "text-left")}>Size</th>
              <th className={classNames(tableHead, "text-left")}>Adjust</th>
              <th className={classNames(tableHead, "text-right")}>Capacity</th>
              <th className={classNames(tableHead, "text-right")}>Fleet</th>
              <th className={classNames(tableHead, "text-right")}>Used</th>
              <th className={classNames(tableHead, "text-right")}>Remaining</th>
              <th className={classNames(tableHead, "border-r-0 text-left")}>Readout</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const codes = Array.isArray(row.codes) ? row.codes.join(" / ") : String(row.codes || "");
              const adjustment = adjustments[row.key] || 0;
              return (
                <tr
                  key={row.key || row.label}
                  className={classNames(index % 2 === 0 ? "bg-[#090b11]" : "bg-[#0c0f16]", "border-b border-[#2b2d33]/70 hover:bg-[#141821]")}
                >
                  <td className={tableCell}>
                    <div className="font-semibold text-slate-100">{wormholeSizeLabel(row)}</div>
                    <div className="text-[10px] text-slate-500">{wormholeSizeNote(row, codes)}</div>
                  </td>
                  <td className={tableCell}>
                    <MassAdjustButtons value={adjustment} onChange={(value) => setAdjustment(row.key, value)} />
                  </td>
                  <td className={classNames(tableCell, "text-right font-mono")}>{fmtKt(row.capacityKg)}</td>
                  <td className={classNames(tableCell, "text-right font-mono")}>{fmtKt(row.totalMassKg)}</td>
                  <td className={classNames(tableCell, "text-right font-mono", statusTextTone(row.status))}>{fmtPct(row.usedPct)}</td>
                  <td className={classNames(tableCell, "text-right font-mono", row.remainingKg < 0 ? "text-[#ffaaaa]" : "text-slate-200")}>
                    {fmtKt(row.remainingKg)}
                  </td>
                  <td className={classNames(tableCell, "border-r-0")}>
                    <span className={classNames("inline-flex border px-1.5 py-0.5 text-[10px]", statusBoxTone(), statusTextTone(row.status))}>
                      {readoutLabel(row.status)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>
    </fieldset>
  );
}

function TypeLink({ row }: { row: { type_id?: number | null; type_name?: string | null } }) {
  const path = itemPath(row.type_id);
  const name = row.type_name || "Unknown";
  if (!path) return <span className="truncate">{name}</span>;
  return (
    <a
      href={path}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-w-0 items-center gap-1 text-slate-100 hover:text-[#9dd8ff]"
    >
      <span className="truncate">{name}</span>
      <ExternalLink size={10} className="shrink-0 text-slate-600" />
    </a>
  );
}

function GroupTable({
  title,
  rows,
  massLabel = "Mass",
  iconMode = "type",
  focal = false,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  rows: DscanGroup[];
  massLabel?: string;
  iconMode?: "type" | "class";
  focal?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <fieldset className={classNames(panelBase, "min-h-0")}>
      {collapsible ? (
        <legend className="p-0">
          <button type="button" className={classNames(panelHeader, "inline-flex items-center gap-1")} onClick={() => setOpen((value) => !value)}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {title}
          </button>
        </legend>
      ) : (
        <legend className={panelHeader}>{title}</legend>
      )}
      {open ? (
      <div className={classNames(
        focal ? "max-h-[540px]" : "max-h-[420px]",
        "overflow-auto border-t border-[#2c2f36] bg-[#05070b] scrollbar-thin scrollbar-track-[#05070b] scrollbar-thumb-[#252836]"
      )}>
        <table className="min-w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#14161d]">
            <tr>
              <th className={classNames(tableHead, "text-left")}>Type</th>
              <th className={classNames(tableHead, "text-right")}>Qty</th>
              <th className={classNames(tableHead, "border-r-0 text-right")}>{massLabel}</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length ? (
              <tr>
                <td colSpan={3} className="px-3 py-3 text-slate-500">No rows.</td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr
                  key={row.key || `${row.type_name}-${index}`}
                  className={classNames(index % 2 === 0 ? "bg-[#090b11]" : "bg-[#0c0f16]", "border-b border-[#2b2d33]/70 hover:bg-[#141821]")}
                >
                  <td className={classNames(tableCell, "min-w-[180px]")}>
                    <div className="flex min-w-0 items-center gap-2">
                      {iconMode === "class" ? (
                        <ClassIcon className={row.group_name || row.type_name} />
                      ) : row.type_id ? (
                        <img src={typeIconUrl(row.type_id, 32)} alt="" className="h-6 w-6 shrink-0 border border-[#262933] bg-[#05070b]" onError={onImgError} />
                      ) : (
                        <span className="h-6 w-6 shrink-0 border border-[#262933] bg-[#05070b]" />
                      )}
                      <div className="min-w-0">
                        <TypeLink row={row} />
                        {row.group_name && <div className="truncate text-[10px] text-slate-500">{row.group_name}</div>}
                      </div>
                    </div>
                  </td>
                  <td className={classNames(tableCell, "text-right font-mono")}>{fmtNumber(row.quantity)}</td>
                  <td className={classNames(tableCell, "border-r-0 text-right font-mono")}>{fmtKt(row.total_mass_kg)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      ) : (
        <div className="border-t border-[#2c2f36] bg-[#05070b] px-2 py-1.5 text-[10px] text-slate-500">
          {fmtNumber(rows.length)} grouped rows hidden.
        </div>
      )}
    </fieldset>
  );
}

function EntriesTable({ entries, defaultOpen = true }: { entries: DscanEntry[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <fieldset className={panelBase}>
      <legend className="p-0">
        <button type="button" className={classNames(panelHeader, "inline-flex items-center gap-1")} onClick={() => setOpen((value) => !value)}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Detailed Scan Rows
        </button>
      </legend>
      {open ? (
      <>
      <div className="max-h-[520px] overflow-y-auto border-t border-[#2c2f36] bg-[#05070b] scrollbar-thin scrollbar-track-[#05070b] scrollbar-thumb-[#252836] sm:hidden">
        {entries.map((entry, index) => (
          <div
            key={`${entry.line}-${index}`}
            className={classNames(index % 2 === 0 ? "bg-[#090b11]" : "bg-[#0c0f16]", "border-b border-[#2b2d33]/70 px-2 py-2")}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-100">{entry.name || "-"}</div>
                <div className="mt-0.5 min-w-0 text-[10px]">
                  <TypeLink row={entry} />
                </div>
              </div>
              <div className="shrink-0 font-mono text-[10px] text-slate-500">#{entry.line}</div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-px border border-[#262933] bg-[#262933] text-[10px]">
              <div className="bg-[#05070b] px-2 py-1">
                <div className="uppercase tracking-widest text-slate-500">Class</div>
                <div className="truncate text-slate-300">{entry.group_name || "-"}</div>
              </div>
              <div className="bg-[#05070b] px-2 py-1">
                <div className="uppercase tracking-widest text-slate-500">Kind</div>
                <div className={classNames("uppercase tracking-widest", entry.kind === "ship" ? "text-[#a7f3b0]" : "text-slate-500")}>{entry.kind}</div>
              </div>
              <div className="bg-[#05070b] px-2 py-1">
                <div className="uppercase tracking-widest text-slate-500">Mass</div>
                <div className="font-mono text-slate-300">{entry.mass_kg ? fmtMassKg(entry.mass_kg, "kt") : "-"}</div>
              </div>
              <div className="bg-[#05070b] px-2 py-1">
                <div className="uppercase tracking-widest text-slate-500">Distance</div>
                <div className="font-mono text-slate-300">{entry.distance || "-"}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="hidden max-h-[520px] overflow-auto border-t border-[#2c2f36] bg-[#05070b] scrollbar-thin scrollbar-track-[#05070b] scrollbar-thumb-[#252836] sm:block">
        <table className="min-w-[920px] w-full border-collapse text-[10px]">
          <thead className="sticky top-0 z-10 bg-[#14161d]">
            <tr>
              <th className={classNames(tableHead, "text-right")}>Line</th>
              <th className={classNames(tableHead, "text-left")}>Name</th>
              <th className={classNames(tableHead, "text-left")}>Type</th>
              <th className={classNames(tableHead, "text-left")}>Class</th>
              <th className={classNames(tableHead, "text-left")}>Kind</th>
              <th className={classNames(tableHead, "text-right")}>Mass</th>
              <th className={classNames(tableHead, "border-r-0 text-left")}>Distance</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <tr
                key={`${entry.line}-${index}`}
                className={classNames(index % 2 === 0 ? "bg-[#090b11]" : "bg-[#0c0f16]", "border-b border-[#2b2d33]/70 hover:bg-[#141821]")}
              >
                <td className={classNames(tableCell, "text-right font-mono text-slate-500")}>{entry.line}</td>
                <td className={classNames(tableCell, "max-w-[240px] truncate")}>{entry.name || "-"}</td>
                <td className={classNames(tableCell, "max-w-[240px]")}>
                  <TypeLink row={entry} />
                </td>
                <td className={classNames(tableCell, "max-w-[160px] truncate text-slate-400")}>{entry.group_name || "-"}</td>
                <td className={classNames(tableCell, "uppercase tracking-widest", entry.kind === "ship" ? "text-[#a7f3b0]" : "text-slate-500")}>{entry.kind}</td>
                <td className={classNames(tableCell, "text-right font-mono")}>{entry.mass_kg ? fmtMassKg(entry.mass_kg, "kt") : "-"}</td>
                <td className={classNames(tableCell, "border-r-0 font-mono text-slate-400")}>{entry.distance || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>
      ) : (
        <div className="border-t border-[#2c2f36] bg-[#05070b] px-2 py-1.5 text-[10px] text-slate-500">
          {fmtNumber(entries.length)} raw rows hidden.
        </div>
      )}
    </fieldset>
  );
}

function UnresolvedPanel({ report }: { report: DscanReport }) {
  if (!report.unresolved?.length) {
    return null;
  }
  return (
    <fieldset className="border border-[#5d4521] bg-[#120d05]">
      <legend className="border-b border-[#5d4521] bg-[#1c1304] px-2 py-1 text-[10px] uppercase tracking-widest text-[#ffd18a]">
        Attention
      </legend>
      <div className="space-y-1 p-2">
        {report.unresolved.slice(0, 12).map((row) => (
          <div key={`${row.line}-${row.raw}`} className="flex items-start gap-2 border border-[#3e321d] bg-[#090704] px-2 py-1 text-[10px] text-slate-300">
            <AlertTriangle size={12} className="mt-0.5 shrink-0 text-[#ffd18a]" />
            <div className="min-w-0">
              <div className="truncate">
                Line {row.line}: {row.type_name || row.name || row.raw}
              </div>
              <div className="text-slate-500">{row.reason}</div>
            </div>
          </div>
        ))}
        {report.unresolved.length > 12 && (
          <div className="px-2 py-1 text-[10px] text-slate-500">
            +{report.unresolved.length - 12} more unresolved rows
          </div>
        )}
      </div>
    </fieldset>
  );
}

function DscanReportView({ report }: { report: DscanReport }) {
  return (
    <div className="space-y-3">
      <DscanReportHeader report={report} />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <GroupTable title="Ships" rows={report.ships || []} focal />
        <GroupTable title="Ship Classes" rows={report.shipClasses || []} iconMode="class" focal />
      </div>
      <WormholePanel report={report} />
      <UnresolvedPanel report={report} />
      <GroupTable title="Scan Objects" rows={report.objects || []} collapsible defaultOpen={false} />
      <EntriesTable entries={report.entries || []} defaultOpen={false} />
    </div>
  );
}

function ReportView({ report }: { report: DscanReport }) {
  return <DscanReportView report={report} />;
}

export default function DScan() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [paste, setPaste] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [report, setReport] = useState<DscanReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function loadReport(reportId: string) {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/dscan/reports/${encodeURIComponent(reportId)}`, {
          cache: "no-store",
        });
        const data = await readJson<ReportResponse>(response);
        if (alive) setReport(data.report || null);
      } catch (err) {
        if (alive) setError((err as Error).message || "Could not load report.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    if (id) {
      void loadReport(id);
    } else {
      setReport(null);
      setError(null);
    }
    return () => {
      alive = false;
    };
  }, [id]);

  const selectedCodes = useMemo(() => codeListFromInput(codeInput), [codeInput]);

  async function submitScan() {
    if (!paste.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/dscan/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paste,
          wormholeCodes: selectedCodes,
        }),
      });
      const data = await readJson<ReportResponse>(response);
      if (!data.id || !data.report) throw new Error("Report was not created.");
      setReport(data.report);
      navigate(`/dscan/${data.id}`);
    } catch (err) {
      setError((err as Error).message || "Could not create report.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="tt-tool-v2 tt2-report-page tt2-dscan min-h-screen leading-snug text-slate-100">
      <div className="mx-auto max-w-[1320px] px-2 py-3 sm:px-4 sm:py-6">
        <div className="tt2-window">
          <ShellHeader report={report} />

          <div className="space-y-3 p-2 sm:p-3">
            {!id && (
              <PasteConsole
                paste={paste}
                setPaste={setPaste}
                codeInput={codeInput}
                setCodeInput={setCodeInput}
                busy={submitting}
                error={error}
                onSubmit={submitScan}
              />
            )}

            {id && loading && (
              <div className="border border-[#303236] bg-[#05070b] px-3 py-8 text-center text-slate-400">
                Loading scan report...
              </div>
            )}

            {id && error && !loading && (
              <div className="border border-[#6b2b32] bg-[#1d090b] px-3 py-2 text-[#ffaaaa]">
                {error}
              </div>
            )}

            {report && <ReportView report={report} />}
          </div>
        </div>
      </div>
    </div>
  );
}
