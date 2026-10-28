/*
 * React page for /appraisals/:id.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import infoIconRaw from "../assets/icons/info.svg?raw";

const card =
  "border border-[#2c2f36] bg-[#070910] px-3 py-2";

type Mode = "buy" | "sell" | "split" | "buy5" | "sell5";

type AppraisalRow = {
  type_id: number | null;
  name: string;
  qty: number;
  m3: number | null;
  price: number | null;
  lineISK: number | null;
  source: string;
  status?: "ok" | "unpriced" | "invalid";
};

type Appraisal = {
  id: string;
  created_at: string;
  station_id: number;
  mode: Mode;
  input_raw: string;
  totals: {
    volume: number;
    sell: number;
    buy: number;
    split: number;
    itemCount: number;
    adjusted?: number | null;
    adjustmentPct?: number | null;
  };
  rows: AppraisalRow[];
};

const STATION_LABEL: Record<number, string> = {
  60003760: "Jita 4-4",
  60008494: "Amarr (Oris) – Emperor Family Academy",
  60011866: "Dodixie IX-20 – Fed Navy Assembly Plant",
  60005686: "Hek VIII-12 – Boundless Creation Factory",
  60004588: "Rens VI-8 – Brutor Tribe Treasury",
};

const eveTypeIcon = (typeId: number, size = 32) =>
  `https://images.evetech.net/types/${typeId}/icon?size=${size}`;

const ICON_BOX_PX = 24;
const ICON_SCALE = 1.6;
const ICON_FETCH = 64;

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

const infoIconMarkup = infoIconRaw.replace(/^\s*<symbol\b[^>]*>/, "").replace(/<\/symbol>\s*$/, "");

function InfoGlyph({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 128 128" className={classNames("inline-block shrink-0", className)}>
      <style>{".shape{fill:currentColor}"}</style>
      <g dangerouslySetInnerHTML={{ __html: infoIconMarkup }} />
    </svg>
  );
}

function ItemInfoLink({ typeId, label }: { typeId: number | null; label: string }) {
  if (!Number.isInteger(typeId)) return null;
  return (
    <a
      href={`/items/${typeId}`}
      target="_blank"
      rel="noreferrer"
      className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 opacity-80 hover:border-[#53b6ff]/70 hover:bg-[#101b27] hover:text-[#9dd8ff] hover:opacity-100"
      title={`Show info: ${label}`}
      aria-label={`Show info: ${label}`}
      onClick={(event) => event.stopPropagation()}
    >
      <InfoGlyph className="h-3 w-3" />
    </a>
  );
}

function normalizeAppraisal(j: any) {
  const parsed: any = { ...j };
  if (typeof parsed.rows === "string") {
    try {
      parsed.rows = JSON.parse(parsed.rows);
    } catch {
      parsed.rows = [];
    }
  }
  if (!Array.isArray(parsed.rows)) parsed.rows = [];

  if (typeof parsed.totals === "string") {
    try {
      parsed.totals = JSON.parse(parsed.totals);
    } catch {
      parsed.totals = {};
    }
  }
  parsed.totals = parsed.totals || {};
  const num = (v: any) => (v == null ? null : Number(v));
  parsed.totals.volume = num(parsed.totals.volume) ?? 0;
  parsed.totals.sell = num(parsed.totals.sell) ?? 0;
  parsed.totals.buy = num(parsed.totals.buy) ?? 0;
  parsed.totals.split = num(parsed.totals.split) ?? 0;
  parsed.totals.itemCount = Number(
    parsed.totals.itemCount ?? parsed.totals.itemcount ?? parsed.rows.length
  );
  if (parsed.totals.adjusted != null)
    parsed.totals.adjusted = num(parsed.totals.adjusted);
  if (parsed.totals.adjustmentPct != null)
    parsed.totals.adjustmentPct = num(parsed.totals.adjustmentPct);
  return parsed;
}

export default function AppraisalView() {
  const { id } = useParams<{ id: string }>();

  const [data, setData] = useState<Appraisal | null>(null);
  const [err, setErr] = useState<string | null>(null);

  type SortKey =
    | "name"
    | "qty"
    | "m3"
    | "price"
    | "lineISK"
    | "source"
    | "status";
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/appraisals/${id}`);
        if (!r.ok) throw new Error("Not found");
        const j = await r.json();
        setData(normalizeAppraisal(j));
      } catch (e: any) {
        setErr(e.message || "Failed to load");
      }
    })();
  }, [id]);

  const modeLabel = useMemo(() => {
    const m = data?.mode;
    if (!m) return "";
    return m === "sell5"
      ? "Sell (5%)"
      : m === "buy5"
      ? "Buy (5%)"
      : m === "sell"
      ? "Sell (min)"
      : m === "buy"
      ? "Buy (max)"
      : "Split (avg)";
  }, [data?.mode]);

  const baseGrand = useMemo(() => {
    if (!data) return 0;
    return data.mode === "split"
      ? Number(data.totals.split || 0)
      : data.mode.startsWith("sell")
      ? Number(data.totals.sell || 0)
      : Number(data.totals.buy || 0);
  }, [data]);

  const adjustedTotal = useMemo(
    () => data?.totals.adjusted ?? null,
    [data]
  );
  const adjustmentPct = useMemo(
    () => data?.totals.adjustmentPct ?? null,
    [data]
  );

  const rowsWithStatus: AppraisalRow[] = useMemo(() => {
    if (!data) return [];
    return data.rows.map((r) => {
      if (r.status) return r;
      if (r.type_id == null) return { ...r, status: "invalid" };
      if (r.price == null || Number(r.price) <= 0)
        return { ...r, status: "unpriced" };
      return { ...r, status: "ok" };
    });
  }, [data]);

  const sortedRows = useMemo(() => {
    const copy = [...rowsWithStatus];
    const dir = sortDir === "asc" ? 1 : -1;
    copy.sort((a, b) => {
      const A: any = (a as any)[sortKey];
      const B: any = (b as any)[sortKey];
      if (A == null && B == null) return 0;
      if (A == null) return 1;
      if (B == null) return -1;
      if (typeof A === "number" && typeof B === "number") return (A - B) * dir;
      return String(A).localeCompare(String(B)) * dir;
    });
    return copy;
  }, [rowsWithStatus, sortKey, sortDir]);

  const invalidCount = useMemo(
    () => rowsWithStatus.filter((r) => r.status === "invalid").length,
    [rowsWithStatus]
  );
  const unpricedCount = useMemo(
    () => rowsWithStatus.filter((r) => r.status === "unpriced").length,
    [rowsWithStatus]
  );

  function clickSort(k: SortKey) {
    setSortKey((prev) => (prev === k ? prev : k));
    setSortDir((prev) =>
      sortKey === k ? (prev === "asc" ? "desc" : "asc") : "asc"
    );
  }

  function handleCopyTotal() {
    const value = Math.round(baseGrand);
    const text = `${value.toLocaleString()} ISK`;
    if (typeof navigator !== "undefined" && "clipboard" in navigator) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  function handleCopyRaw() {
    if (!data?.input_raw) return;
    const text = data.input_raw;
    if (typeof navigator !== "undefined" && "clipboard" in navigator) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  if (err) {
    return (
      <div className="tt-tool-v2 min-h-screen px-4 py-6 text-slate-100 text-[11px] leading-snug">
        <div className="tt2-panel mx-auto max-w-md p-4">
          <p className="text-red-400 mb-3">{err}</p>
          <Link
            to="/appraisals"
            className="text-[#53b6ff] hover:text-[#7fc5ff] underline text-[11px]"
          >
            Back to appraisals
          </Link>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="tt-tool-v2 min-h-screen px-4 py-6 text-slate-100 text-[11px] leading-snug">
        <div className="tt2-panel mx-auto max-w-md p-4">
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="tt-tool-v2 min-h-screen text-slate-100 text-[11px] leading-snug">
      <div className="tt2-frame tt2-frame--centered">
        <div className="tt2-window">
          { }
          <div className="tt2-titlebar">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
              <span className="uppercase tracking-widest text-[10px] text-slate-300">
                Market &amp; Trade ▸ ISKtimate Appraisal
              </span>
            </div>
            <div className="flex items-center gap-2 text-[9px] text-slate-400">
              <span className="px-1 py-0.5 bg-[#0b0d11] border border-[#303236]">
                {STATION_LABEL[data.station_id] || data.station_id}
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
                Overview ▸ Appraisal #{data.id}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#3bbf5a]" />
                <span>Market prices online</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-slate-500">
                {new Date(data.created_at).toLocaleString()}
              </span>
              <Link
                to="/appraisals"
                className="text-[#53b6ff] hover:text-[#7fc5ff] underline text-[10px]"
              >
                New appraisal
              </Link>
            </div>
          </div>

          { }
          <div className="p-3 space-y-3">
            { }
            <div className="border border-[#262933] bg-[#05070b]/90 px-3 py-2">
              <p className="text-[12px] text-slate-300 mb-1">
                This window shows a snapshot of your{" "}
                <span className="text-slate-100">ISKtimate</span> at the
                time it was saved.
              </p>
              <p className="text-[12px] text-slate-400">
                Columns are sortable by clicking the headers. Snapshot values
                are frozen; re-appraise to refresh with current market data.
              </p>
            </div>

            { }
            <div className="grid gap-3 lg:grid-cols-3">
              { }
              <div className={card}>
                <div className="border-b border-[#2c2f36] pb-1 mb-2">
                  <span className="uppercase tracking-widest text-[10px] text-slate-300">
                    Appraisal Info
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-y-1 gap-x-3 text-[11px]">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-slate-400">
                      Hub
                    </div>
                    <div className="text-slate-100">
                      {STATION_LABEL[data.station_id] || data.station_id}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-slate-400">
                      Mode
                    </div>
                    <div className="text-slate-100">{modeLabel}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-slate-400">
                      Created
                    </div>
                    <div className="text-slate-100">
                      {new Date(data.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-slate-400">
                      Items
                    </div>
                    <div className="text-slate-100">
                      {data.totals.itemCount}
                    </div>
                  </div>
                </div>
              </div>

              { }
              <div className={card}>
                <div className="border-b border-[#2c2f36] pb-1 mb-2">
                  <span className="uppercase tracking-widest text-[10px] text-slate-300">
                    Totals
                  </span>
                </div>
                <div className="space-y-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-widest text-slate-400">
                      Volume
                    </span>
                    <span className="font-mono text-slate-100">
                      {Number(data.totals.volume).toLocaleString()} m³
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-widest text-slate-400">
                      {data.mode === "split"
                        ? "Split Total"
                        : data.mode.startsWith("sell")
                        ? "Sell Total"
                        : "Buy Total"}
                    </span>
                    <span className="font-mono text-slate-100">
                      {(
                        data.mode === "split"
                          ? Math.round(Number(data.totals.split))
                          : data.mode.startsWith("sell")
                          ? Math.round(Number(data.totals.sell))
                          : Math.round(Number(data.totals.buy))
                      ).toLocaleString()}{" "}
                      ISK
                    </span>
                  </div>
                </div>
              </div>

              { }
              <div className={card}>
                <div className="border-b border-[#2c2f36] pb-1 mb-2">
                  <span className="uppercase tracking-widest text-[10px] text-slate-300">
                    Appraised Value
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-slate-400">
                    {data.mode === "split"
                      ? "Estimated Value (Split)"
                      : data.mode.startsWith("sell")
                      ? "Total Sell Value"
                      : "Total Buy Value"}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <div className="font-bold font-mono leading-none text-3xl md:text-4xl text-slate-50">
                      {Math.round(baseGrand).toLocaleString()} ISK
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyTotal}
                      className="shrink-0 px-2 py-1 border border-[#333c4f] bg-[#05070b] hover:bg-[#0b1018] text-[10px] uppercase tracking-widest text-[#53b6ff]"
                      title="Copy total ISK to clipboard"
                    >
                      ⧉
                    </button>
                  </div>

                  {adjustedTotal != null && adjustmentPct != null && (
                    <div className="mt-2">
                      <div className="text-[10px] uppercase tracking-widest text-slate-400">
                        Adjusted Total
                      </div>
                      <div className="font-bold font-mono text-2xl text-slate-50">
                        {Math.round(Number(adjustedTotal)).toLocaleString()} ISK{" "}
                        <span className="text-[10px] text-slate-400 ml-1">
                          ({Number(adjustmentPct)}%)
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            { }
            <div className="border border-[#2c2f36] bg-[#070910] px-3 py-2">
              <div className="flex flex-wrap gap-4 text-[10px] text-slate-300 mb-1">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded bg-[#0b0d11] border border-[#3a3c40]" />
                  Normal
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded bg-[#4a320e] border border-[#c18a2e]" />
                  No active orders at hub (may use region fallback when
                  appraised)
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded bg-[#4a1515] border border-[#c13c3c]" />
                  Invalid / not an item
                </span>
              </div>

              {(invalidCount > 0 || unpricedCount > 0) && (
                <div className="text-[10px] text-amber-300">
                  {invalidCount > 0 && (
                    <span>{invalidCount} invalid item(s). </span>
                  )}
                  {unpricedCount > 0 && (
                    <span>
                      {unpricedCount} item(s) had no hub orders at save time.
                    </span>
                  )}
                </div>
              )}
            </div>

            { }
            <div className="border border-[#303236] bg-[#05070b]/95 overflow-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-[#14161d] text-slate-100">
                    <th className="border border-[#2b2d33] px-2.5 py-1.5 w-10" />
                    {[
                      ["Item", "name"],
                      ["Qty", "qty"],
                      ["m³", "m3"],
                      ["Price", "price"],
                      ["Line ISK", "lineISK"],
                      ["Src", "source"],
                      ["Status", "status"],
                    ].map(([label, key]) => {
                      const k = key as SortKey;
                      const isNumeric =
                        k === "qty" || k === "m3" || k === "price" || k === "lineISK";
                      const active = sortKey === k;
                      return (
                        <th
                          key={key}
                          className={classNames(
                            "border border-[#2b2d33] px-2.5 py-1.5 text-left whitespace-nowrap select-none cursor-pointer hover:text-[#53b6ff]",
                            isNumeric && "text-right"
                          )}
                          onClick={() => clickSort(k)}
                          title="Click to sort"
                        >
                          <span className="inline-flex items-center gap-1">
                            {label}
                            <span className="text-slate-500 text-[9px]">
                              {active ? (sortDir === "asc" ? "▲" : "▼") : ""}
                            </span>
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r, i) => {
                    const rowClass =
                      r.status === "invalid"
                        ? "bg-[#3b1111]"
                        : r.status === "unpriced"
                        ? "bg-[#3b2b11]"
                        : "";
                    const zebra =
                      i % 2 === 0 ? "bg-[#090b11]" : "bg-[#0c0f16]";
                    const baseBg = rowClass || zebra;
                    return (
                      <tr
                        key={i}
                        className={classNames(
                          "border-t border-[#2b2d33] hover:bg-[#141821]",
                          baseBg
                        )}
                      >
                        <td className="px-2 py-2 border border-[#2b2d33]">
                          {r.type_id ? (
                            <div className="relative w-6 h-6 overflow-visible">
                              <img
                                src={eveTypeIcon(r.type_id, ICON_FETCH)}
                                srcSet={`${eveTypeIcon(
                                  r.type_id,
                                  ICON_FETCH
                                )} 1x, ${eveTypeIcon(r.type_id, 128)} 2x`}
                                alt=""
                                width={ICON_BOX_PX}
                                height={ICON_BOX_PX}
                                loading="lazy"
                                decoding="async"
                                referrerPolicy="no-referrer"
                                className="absolute inset-0 rounded pointer-events-none select-none"
                                style={{
                                  transform: `scale(${ICON_SCALE})`,
                                  transformOrigin: "center",
                                  translate: "0 0.5px",
                                }}
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.display =
                                    "none";
                                }}
                              />
                            </div>
                          ) : null}
                        </td>

                        <td className="px-2.5 py-1.5 border border-[#2b2d33]">
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate">
                              {r.name}
                            </span>
                            <ItemInfoLink typeId={r.type_id} label={r.name} />
                          </div>
                        </td>
                        <td className="px-2.5 py-1.5 border border-[#2b2d33] text-right font-mono">
                          {Number(r.qty).toLocaleString()}
                        </td>
                        <td className="px-2.5 py-1.5 border border-[#2b2d33] text-right font-mono">
                          {r.m3 != null
                            ? Number(r.m3).toLocaleString()
                            : "—"}
                        </td>
                        <td className="px-2.5 py-1.5 border border-[#2b2d33] text-right font-mono">
                          {r.price != null
                            ? Math.round(Number(r.price)).toLocaleString()
                            : "N/A"}
                        </td>
                        <td className="px-2.5 py-1.5 border border-[#2b2d33] text-right font-mono">
                          {r.lineISK != null
                            ? Math.round(Number(r.lineISK)).toLocaleString()
                            : "—"}
                        </td>
                        <td className="px-2.5 py-1.5 border border-[#2b2d33] text-xs text-slate-400">
                          {r.source}
                        </td>
                        <td className="px-2.5 py-1.5 border border-[#2b2d33] text-xs">
                          {r.status === "ok" && (
                            <span className="text-slate-300">OK</span>
                          )}
                          {r.status === "unpriced" && (
                            <span className="text-amber-300">
                              No orders found
                            </span>
                          )}
                          {r.status === "invalid" && (
                            <span className="text-red-300">Invalid</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="text-[10px] text-slate-500 mt-2">
              Snapshot is frozen; re-appraise to refresh with current market.
              Sources may include hub orders (sell/buy) and region fallback
              values for visibility.
            </div>

            { }
            <div className="mt-3 border border-[#2c2f36] bg-[#070910]">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#2c2f36]">
                <span className="uppercase tracking-widest text-[10px] text-slate-300">
                  Raw Appraisal
                </span>
                <button
                  type="button"
                  onClick={handleCopyRaw}
                  className="px-2 py-1 border border-[#333c4f] bg-[#05070b] hover:bg-[#0b1018] text-[10px] uppercase tracking-widest text-[#53b6ff]"
                  title="Copy raw appraisal text"
                >
                  ⧉ Copy
                </button>
              </div>
              <div className="px-3 py-2">
                <pre className="max-h-24 overflow-y-auto bg-[#05070b] border border-[#303236] text-[11px] font-mono whitespace-pre-wrap leading-snug p-2 text-slate-100">
                  {data.input_raw || ""}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
