/*
 * React page for /appraisals.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import infoIconRaw from "../assets/icons/info.svg?raw";

const HUBS = [
  { id: 60003760, label: "Jita 4-4" },
  { id: 60008494, label: "Amarr (Oris) – Emperor Family Academy" },
  { id: 60011866, label: "Dodixie IX-20 – Fed Navy Assembly Plant" },
  { id: 60005686, label: "Hek VIII-12 – Boundless Creation Factory" },
  { id: 60004588, label: "Rens VI-8 – Brutor Tribe Treasury" },
] as const;

const STATION_REGION: Record<number, number> = {
  60003760: 10000002,
  60008494: 10000043,
  60011866: 10000032,
  60005686: 10000042,
  60004588: 10000030,
};

type Mode = "sell5" | "buy5" | "sell" | "buy" | "split";

type ParsedLine = { raw: string; nameOrId: string; qty: number };

type ResolvedItem = {
  name: string;
  canonicalName: string | null;
  type_id: number | null;
  m3: number | null;
  error?: string;
};

type PriceRow = {
  station_id: number;
  type_id: number;
  sell_min: number | null;
  buy_max: number | null;
  sell_5pct: number | null;
  buy_5pct: number | null;
  last_updated: string;
};

type StatusKind = "ok" | "unpriced" | "invalid";

type PreviewRow = {
  type_id: number | null;
  name: string;
  qty: number;
  m3: number | null;
  unitPrice: number | null;
  lineISK: number | null;
  priceSource: "sell5" | "buy5" | "sell" | "buy" | "split" | "fw-sell" | "fw-buy" | "n/a";
  status: StatusKind;
};

function classNames(...x: (string | false | null | undefined)[]) {
  return x.filter(Boolean).join(" ");
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

const panelBase = "border border-[#2c2f36] bg-[#070910]";
const inputClass =
  "w-full bg-[#05070b] border border-[#303236] px-2.5 py-1.5 text-[11px] text-[#e4e7f5] placeholder-[#717784] rounded-sm focus:outline-none focus:border-[#3c9ae8] focus:ring-0";
const selectClass =
  "w-full bg-[#05070b] border border-[#303236] px-2 py-1.5 text-[11px] text-[#e4e7f5] rounded-sm focus:outline-none focus:border-[#3c9ae8] focus:ring-0";
const btnPrimary =
  "px-4 py-1.5 text-[11px] uppercase tracking-wide rounded-sm bg-gradient-to-b from-[#1e90ff] to-[#145caa] border border-[#1b5c9a] shadow-[0_0_6px_rgba(0,0,0,0.8)] hover:from-[#2aa2ff] hover:to-[#1b6fd1] disabled:opacity-60 disabled:cursor-not-allowed";
const btnSecondary =
  "px-4 py-1.5 text-[11px] uppercase tracking-wide rounded-sm bg-[#29233c] border border-[#4a3d63] hover:bg-[#3a3053] disabled:opacity-60 disabled:cursor-not-allowed";

export default function Appraisals() {
  const nav = useNavigate();
  const [lastAppraisedStationId, setLastAppraisedStationId] = useState<number | null>(null);
  const [input, setInput] = useState<string>("");
  const [stationId, setStationId] = useState<number>(HUBS[0].id);
  const [mode, setMode] = useState<Mode>("sell5");
  const [combine, setCombine] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [totals, setTotals] = useState<{
    volume: number;
    sell: number;
    buy: number;
    split: number;
    itemCount: number;
    adjusted?: number;
    adjustmentPct?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  type SortKey = "name" | "qty" | "m3" | "unitPrice" | "lineISK" | "priceSource" | "status";
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [adjustPct, setAdjustPct] = useState<number>(100);

  const parsedLines = useMemo<ParsedLine[]>(() => {
    const out: ParsedLine[] = [];

    const normalize = (s: string) =>
      s
        .replace(/\u00A0/g, " ")
        .replace(/[‐-‒–—−]/g, "-")
        .trim();

    const isNumericToken = (s: string) => /^\d[\d,._]*$/.test(s);
    const cleanInt = (s: string) => {
      const n = Number(s.replace(/[^\d]/g, ""));
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    };

    const stripTailPairs = (toks: string[]) => {
      const isUnit = (x: string, re: RegExp) => re.test(x);
      while (toks.length >= 2) {
        const last = toks[toks.length - 1];
        const prev = toks[toks.length - 2];

        if (isUnit(last, /\bISK\b/i) && isNumericToken(prev)) {
          toks.pop();
          toks.pop();
          continue;
        }

        if (isUnit(last, /\bm3\b|\bm³\b/i) && isNumericToken(prev)) {
          toks.pop();
          toks.pop();
          continue;
        }
        break;
      }
      return toks;
    };

    const parseFitHeader = (raw: string): string | null => {

      const m = raw.match(/^\s*\[\s*([^\],]+?)(?:\s*,.*)?\s*\]\s*$/);
      return m ? m[1].trim() : null;
    };

    const parseTypeIdForm = (raw: string): { id: string; qty: number } | null => {
      const m = raw.match(
        /^\s*(?:type\s*[_\s-]*id|typeid|id)\s*[:=#-]?\s*(\d+)(?:\s*[xX×]?\s*(\d[\d,._]*))?\s*$/i
      );
      if (!m) return null;
      const id = m[1];
      const qty = m[2] ? cleanInt(m[2]) : 1;
      return { id, qty: qty || 1 };
    };

    const extractNameQtyFromTokens = (raw: string) => {
      let line = normalize(raw);
      if (!line) return null;

      const hull = parseFitHeader(line);
      if (hull) return { nameOrId: hull, qty: 1 };

      if (/^\d+$/.test(line)) {
        return { nameOrId: line, qty: 1 };
      }

      const ti = parseTypeIdForm(line);
      if (ti) return { nameOrId: ti.id, qty: ti.qty || 1 };

      {
        const csvSplit = line.split(/[;,|]/).map((s) => s.trim()).filter(Boolean);
        if (csvSplit.length === 2 && isNumericToken(csvSplit[1])) {
          return { nameOrId: csvSplit[0], qty: cleanInt(csvSplit[1]) || 1 };
        }
        const dash = line.match(/^(.+?)\s*-\s*(\d[\d,._]*)$/);
        if (dash) {
          return { nameOrId: dash[1].trim(), qty: cleanInt(dash[2]) || 1 };
        }
      }

      let toks = line.split(/\s+/).filter(Boolean);

      if (toks.length >= 2) {
        const t0 = toks[0].replace(/[,:;]+$/, "");
        const t1 = toks[1];
        if (isNumericToken(t0)) {
          if (/^[xX×]$/.test(t1)) {
            return { nameOrId: toks.slice(2).join(" "), qty: cleanInt(t0) || 1 };
          }
          if (/^[xX×]\d[\d,._]*$/.test(t1)) {
            return { nameOrId: toks.slice(2).join(" "), qty: cleanInt(t1.slice(1)) || 1 };
          }

          return { nameOrId: toks.slice(1).join(" "), qty: cleanInt(t0) || 1 };
        }
      }

      toks = stripTailPairs(toks);

      const last = toks[toks.length - 1];
      if (/^[xX×]\d[\d,._]*$/.test(last)) {
        const qty = cleanInt(last.slice(1)) || 1;
        const name = toks.slice(0, -1).join(" ").trim();
        if (name) return { nameOrId: name, qty };
      }
      if (
        toks.length >= 2 &&
        /^[xX×]$/.test(toks[toks.length - 2]) &&
        isNumericToken(last)
      ) {
        const qty = cleanInt(last) || 1;
        const name = toks.slice(0, -2).join(" ").trim();
        if (name) return { nameOrId: name, qty };
      }

      if (isNumericToken(last)) {
        const qty = cleanInt(last) || 1;
        const name = toks.slice(0, -1).join(" ").trim();
        if (name) return { nameOrId: name, qty };
      }

      return { nameOrId: line, qty: 1 };
    };

    for (const raw0 of input.split(/\r?\n/)) {
      let raw = normalize(raw0);
      if (!raw) continue;

      if (/\t/.test(raw) || / {2,}/.test(raw)) {
        const cols = raw.split(/\t+| {2,}/).map((c) => c.trim()).filter(Boolean);
        if (!cols.length) continue;

        let nameCol = cols[0];
        if (/^\d[\d,._\s]*$/.test(cols[0]) && cols[1] && !/^\d[\d,._\s]*$/.test(cols[1])) {
          nameCol = cols[1];
        }

        let qty: number | null = null;
        for (let i = cols.length - 1; i >= 0; i--) {
          const c = cols[i];
          if (/\b(ISK|m3|m³)\b/i.test(c)) continue;
          const m1 = c.match(/^(?:[xX×]\s*)?(\d[\d,._\s]*)$/);
          if (m1) {
            qty = cleanInt(m1[1]);
            break;
          }
        }
        if (!qty || qty <= 0) qty = 1;

        const nameOrId = nameCol.trim();
        if (nameOrId) out.push({ raw, nameOrId, qty });
        continue;
      }

      const parsed = extractNameQtyFromTokens(raw);
      if (!parsed) continue;
      const { nameOrId, qty } = parsed;

      if (nameOrId) {
        out.push({
          raw,
          nameOrId,
          qty: !Number.isFinite(qty) || qty <= 0 ? 1 : qty,
        });
      }
    }

    return out;
  }, [input]);

  const eveTypeIcon = (typeId: number, size = 32) =>
    `https://images.evetech.net/types/${typeId}/icon?size=${size}`;

  const ICON_BOX_PX = 24;
  const ICON_SCALE = 1.6;
  const ICON_FETCH = 64;

  function round(n: number, d = 2) {
    const p = Math.pow(10, d);
    return Math.round(n * p) / p;
  }
  function sumUsing(rows: PreviewRow[], pick: (r: PreviewRow) => number | null): number | null {
    let acc = 0,
      any = false;
    for (const r of rows) {
      if (r.qty && r.type_id) {
        const unit = pick(r);
        if (unit != null) {
          acc += unit * r.qty;
          any = true;
        }
      }
    }
    return any ? acc : null;
  }

  function combineResolved(
    items: { type_id: number | null; name: string; qty: number; m3: number | null }[]
  ) {
    if (!combine) return items;
    const byKey = new Map<
      string,
      { type_id: number | null; name: string; qty: number; m3: number | null }
    >();
    for (const it of items) {
      const key = it.type_id ? `id:${it.type_id}` : `name:${it.name.trim().toLowerCase()}`;
      const prev = byKey.get(key);
      if (prev) {
        prev.qty += it.qty;
        if (prev.m3 == null && it.m3 != null) prev.m3 = it.m3;
      } else {
        byKey.set(key, { ...it });
      }
    }
    return Array.from(byKey.values());
  }

  async function resolveNamesOrIds(lines: ParsedLine[]) {
    const names = lines.filter((l) => !/^\d+$/.test(l.nameOrId)).map((l) => l.nameOrId);
    let resolved: ResolvedItem[] = [];
    if (names.length) {
      const r = await fetch("/api/types/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
      });
      if (!r.ok) throw new Error("Type resolver failed");
      const data = await r.json();
      resolved = data.results as ResolvedItem[];
    }

    const byName = new Map(resolved.map((it) => [it.name.trim().toLowerCase(), it]));
    const unifiedPre: { type_id: number | null; name: string; qty: number; m3: number | null }[] =
      [];

    for (const ln of lines) {
      if (/^\d+$/.test(ln.nameOrId)) {
        unifiedPre.push({
          type_id: Number(ln.nameOrId),
          name: ln.nameOrId,
          qty: ln.qty,
          m3: null,
        });
      } else {
        const key = ln.nameOrId.trim().toLowerCase();
        const hit = byName.get(key);
        if (hit && hit.type_id) {
          unifiedPre.push({
            type_id: hit.type_id,
            name: hit.canonicalName || ln.nameOrId,
            qty: ln.qty,
            m3: hit.m3 ?? null,
          });
        } else {
          unifiedPre.push({ type_id: null, name: ln.nameOrId, qty: ln.qty, m3: null });
        }
      }
    }
    return { unified: combineResolved(unifiedPre) };
  }

  async function fetchFuzzworksFallback(regionId: number, typeIds: number[]) {
    if (!typeIds.length) return new Map<number, { sell: number | null; buy: number | null }>();
    const url = `/api/prices/fallback?region_id=${regionId}&type_ids=${typeIds.join(",")}`;
    const r = await fetch(url);
    if (!r.ok) return new Map();
    const data = await r.json();
    const map = new Map<number, { sell: number | null; buy: number | null }>();
    for (const row of (data.rows || []) as any[]) {
      const sell = row.sell_median ?? row.sell_min ?? null;
      const buy = row.buy_median ?? row.buy_max ?? null;
      map.set(Number(row.type_id), { sell, buy });
    }
    return map;
  }

  async function onAppraise() {
    try {
      setError(null);
      setLoading(true);
      setPreview(null);
      setTotals(null);

      if (parsedLines.length === 0) {
        setError("Paste items like 'Tritanium 100000' (one per line).");
        return;
      }

      const { unified } = await resolveNamesOrIds(parsedLines);
      const valid = unified.filter((u) => u.type_id);
      const missing = unified.filter((u) => !u.type_id);

      if (valid.length === 0 && missing.length > 0) {
        setError("No recognizable item names or type IDs.");
        return;
      }

      const typeIds = Array.from(new Set(valid.map((v) => v.type_id))).join(",");
      let rows: PriceRow[] = [];
      if (typeIds) {
        const resp = await fetch(
          `/api/prices/station?station_id=${stationId}&type_ids=${typeIds}`
        );
        if (!resp.ok) throw new Error("Price API failed");
        const d = await resp.json();
        rows = (d.rows || []).map((r: any) => ({
          station_id: Number(r.station_id),
          type_id: Number(r.type_id),
          sell_min: r.sell_min == null ? null : Number(r.sell_min),
          buy_max: r.buy_max == null ? null : Number(r.buy_max),
          sell_5pct: r.sell_5pct == null ? null : Number(r.sell_5pct),
          buy_5pct: r.buy_5pct == null ? null : Number(r.buy_5pct),
          last_updated: r.last_updated,
        }));
      }

      const byType = new Map(rows.map((r) => [r.type_id, r]));

      let previewRows: PreviewRow[] = unified.map((u) => {
        const unitM3 = u.m3 ?? null;
        const m3Total = unitM3 != null ? unitM3 * u.qty : null;

        if (!u.type_id) {
          return {
            type_id: null,
            name: u.name,
            qty: u.qty,
            m3: m3Total,
            unitPrice: null,
            lineISK: null,
            priceSource: "n/a",
            status: "invalid",
          };
        }

        const pr = byType.get(u.type_id);
        if (!pr) {
          return {
            type_id: u.type_id,
            name: u.name,
            qty: u.qty,
            m3: m3Total,
            unitPrice: null,
            lineISK: null,
            priceSource: "n/a",
            status: "unpriced",
          };
        }

        let unit: number | null = null;
        let src: PreviewRow["priceSource"] = "n/a";
        if (mode === "sell5") {
          unit = pr.sell_5pct ?? pr.sell_min ?? null;
          src = pr.sell_5pct != null ? "sell5" : pr.sell_min != null ? "sell" : "n/a";
        } else if (mode === "buy5") {
          unit = pr.buy_5pct ?? pr.buy_max ?? null;
          src = pr.buy_5pct != null ? "buy5" : pr.buy_max != null ? "buy" : "n/a";
        } else if (mode === "sell") {
          unit = pr.sell_min ?? pr.sell_5pct ?? null;
          src = pr.sell_min != null ? "sell" : pr.sell_5pct != null ? "sell5" : "n/a";
        } else if (mode === "buy") {
          unit = pr.buy_max ?? pr.buy_5pct ?? null;
          src = pr.buy_max != null ? "buy" : pr.buy_5pct != null ? "buy5" : "n/a";
        } else if (mode === "split") {
          const s = pr.sell_5pct ?? pr.sell_min ?? null;
          const b = pr.buy_5pct ?? pr.buy_max ?? null;
          if (s != null && b != null) {
            unit = (s + b) / 2;
            src = "split";
          } else {
            unit = s ?? b ?? null;
            src = s != null ? "sell5" : b != null ? "buy5" : "n/a";
          }
        }
        if (unit != null && unit <= 0) {
          unit = null;
          src = "n/a";
        }
        const hasPrice = unit != null;
        const line = hasPrice ? unit! * u.qty : null;
        return {
          type_id: u.type_id,
          name: u.name,
          qty: u.qty,
          m3: m3Total,
          unitPrice: unit,
          lineISK: line,
          priceSource: src,
          status: hasPrice ? "ok" : "unpriced",
        };
      });

      const regionId = STATION_REGION[stationId] || 10000002;
      const needFallback = previewRows
        .filter((r) => r.status === "unpriced" && r.type_id)
        .map((r) => r.type_id!) as number[];
      if (needFallback.length) {
        const fw = await fetchFuzzworksFallback(regionId, Array.from(new Set(needFallback)));
        previewRows = previewRows.map((r) => {
          if (r.status !== "unpriced" || !r.type_id) return r;
          const alt = fw.get(r.type_id);
          if (!alt) return r;

          let unit: number | null = null;
          let src: PreviewRow["priceSource"] = "n/a";
          if (mode.startsWith("sell")) {
            unit = alt.sell ?? null;
            src = "fw-sell";
          } else if (mode.startsWith("buy")) {
            unit = alt.buy ?? null;
            src = "fw-buy";
          } else {

            if (alt.sell != null && alt.buy != null) {
              unit = (alt.sell + alt.buy) / 2;
              src = "split";
            } else
              (unit = alt.sell ?? alt.buy ?? null),
                (src = alt.sell != null ? "fw-sell" : alt.buy != null ? "fw-buy" : "n/a");
          }
          if (unit == null || unit <= 0) return r;
          const line = unit * r.qty;
          return { ...r, unitPrice: unit, lineISK: line, priceSource: src, status: "ok" };
        });
      }

      const pricedRows = previewRows.filter((r) => r.status === "ok");
      const totalVolume = pricedRows.reduce((sum, r) => sum + (r.m3 ?? 0), 0);
      const totalFromRows = pricedRows.reduce((sum, r) => sum + (r.lineISK ?? 0), 0);
      let sellTotal = 0;
      let buyTotal = 0;
      let splitTotal = 0;

      if (mode === "split") {
        splitTotal = totalFromRows;
      } else if (mode.startsWith("sell")) {
        sellTotal = totalFromRows;
      } else {

        buyTotal = totalFromRows;
      }

      const baseTotals = {
        volume: round(totalVolume, 3),
        sell: round(sellTotal, 2),
        buy: round(buyTotal, 2),
        split: round(splitTotal, 2),
        itemCount: previewRows.length,
      };

      setPreview(previewRows);
      const baseGrand =
        mode === "split"
          ? baseTotals.split
          : mode.startsWith("sell")
            ? baseTotals.sell
            : baseTotals.buy;
      const adjusted = round((baseGrand || 0) * (adjustPct / 100), 2);
      setTotals({ ...baseTotals, adjusted, adjustmentPct: adjustPct });
      setLastAppraisedStationId(stationId);
      const unresolved = previewRows.filter((r) => r.status === "invalid");
      const unpriced = previewRows.filter((r) => r.status === "unpriced");
      if (unresolved.length || unpriced.length) {
        const msgs = [];
        if (unresolved.length) msgs.push(`${unresolved.length} invalid item(s)`);
        if (unpriced.length) msgs.push(`${unpriced.length} item(s) have no active orders at this hub`);
        setError(msgs.join("; "));
      }
    } catch (e: any) {
      setError(e.message || "Appraise failed");
    } finally {
      setLoading(false);
    }
  }
  const handleCopyTotal = (value: number | null) => {
    if (value == null) return;

    const text = `${Math.round(value).toLocaleString()} ISK`;

    const markCopied = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => markCopied(),
        () => {

        }
      );
    } else {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        markCopied();
      } catch {

      }
    }
  };

  async function onSave() {
    if (!parsedLines.length) return;
    if (lastAppraisedStationId !== stationId) {
      await onAppraise();
    }
    if (!preview || !totals) return;
    try {
      setLoading(true);
      const rowsPayload = preview.map((r) => ({
        type_id: r.type_id,
        name: r.name,
        qty: r.qty,
        m3: r.m3,
        price: r.unitPrice,
        lineISK: r.lineISK,
        source: r.priceSource,
        status: r.status,
      }));

      const baseGrand =
        mode === "split"
          ? totals.split
          : mode.startsWith("sell")
            ? totals.sell
            : totals.buy;
      const adjustedNow =
        Math.round((baseGrand || 0) * (adjustPct / 100) * 100) / 100;

      const payloadTotals = {
        volume: totals.volume,
        sell: totals.sell,
        buy: totals.buy,
        split: totals.split,
        itemCount: totals.itemCount,
        adjusted: adjustedNow,
        adjustmentPct: adjustPct,
      };

      const resp = await fetch("/api/appraisals", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          station_id: stationId,
          mode,
          input_raw: input,
          totals: payloadTotals,
          rows: rowsPayload,
        }),
      });
      if (!resp.ok) throw new Error("Save failed");
      const data = await resp.json();
      nav(`/appraisals/${data.id}`);
    } catch (e: any) {
      setError(e.message || "Save failed");
    } finally {
      setLoading(false);
    }
  }

  const baseGrand = totals
    ? mode === "split"
      ? totals.split
      : mode.startsWith("sell")
        ? totals.sell
        : totals.buy
    : null;

  const sortedPreview = useMemo(() => {
    if (!preview) return null;
    const copy = [...preview];
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
  }, [preview, sortKey, sortDir]);

  const modeExplain: Record<Mode, string> = {
    sell5:
      "Sell (5%): volume-weighted average of the cheapest 5% of sell orders — dampens 1-ISK wall spam.",
    buy5:
      "Buy (5%): volume-weighted average of the highest-priced 5% of buy orders — dampens tiny troll orders.",
    sell: "Sell (min): the single cheapest active sell order at the hub.",
    buy: "Buy (max): the single highest active buy order at the hub.",
    split:
      "Split (avg): midpoint between Sell (5%) and Buy (5%) — a simple ‘fair value’ estimate.",
  };

  function clickSort(k: SortKey) {
    setSortKey((prev) => (prev === k ? prev : k));
    setSortDir((prev) => (sortKey === k ? (prev === "asc" ? "desc" : "asc") : "asc"));
  }
  useEffect(() => {
    if (parsedLines.length === 0) return;

    if (lastAppraisedStationId === stationId) return;

    (async () => {
      try {
        setLoading(true);
        await onAppraise();
      } finally {
        setLoading(false);
      }
    })();

  }, [stationId]);

  const adjustedNow = useMemo(() => {
    if (!totals) return null;
    const base =
      mode === "split"
        ? totals.split
        : mode.startsWith("sell")
          ? totals.sell
          : totals.buy;
    if (base == null) return null;
    return Math.round(base * (adjustPct / 100));
  }, [totals, mode, adjustPct]);

  useEffect(() => {
    if (!totals) return;
    const base =
      mode === "split"
        ? totals.split
        : mode.startsWith("sell")
          ? totals.sell
          : totals.buy;
    const adjustedNow =
      Math.round((base || 0) * (adjustPct / 100) * 100) / 100;
    setTotals({ ...totals, adjusted: adjustedNow, adjustmentPct: adjustPct });

  }, [mode]);

  const activeHubLabel =
    HUBS.find((h) => h.id === stationId)?.label.split(" – ")[0] ?? "Hub";

  return (
    <div className="tt-tool-v2 min-h-screen text-slate-100 text-[11px] leading-snug">
      <div className="tt2-frame tt2-frame--centered">
        { }
        <div className="tt2-window">
          { }
          <div className="tt2-titlebar">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
              <span className="uppercase tracking-widest text-[10px] text-slate-300">
                Market &amp; Trade ▸ Isk Appraisal Tool
              </span>
            </div>
            <div className="flex items-center gap-2 text-[9px] text-slate-400">
              <span className="px-1 py-0.5 bg-[#0b0d11] border border-[#303236]">
                Regional Hubs
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
                Overview ▸ ISKtimate
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#3bbf5a]" />
                <span>Market prices online</span>
              </span>
              <div className="flex items-center gap-2">
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[#7c8496]">
                Mode:{" "}
                <span className="text-[#c5cad8]">
                  {mode === "sell5"
                    ? "Sell (5%)"
                    : mode === "buy5"
                      ? "Buy (5%)"
                      : mode === "sell"
                        ? "Sell (min)"
                        : mode === "buy"
                          ? "Buy (max)"
                          : "Split (avg)"}
                </span>
              </span>
              {!!parsedLines.length && (
                <span className="text-[#7c8496]">
                  Parsed{" "}
                  <span className="text-[#c5cad8]">
                    {parsedLines.length} line{parsedLines.length === 1 ? "" : "s"}
                  </span>
                </span>
              )}
            </div>
          </div>

          { }
          <div className="p-4 space-y-4 bg-[#05070b]/90">
            { }
            <div
              className={classNames(
                "border border-[#262933] bg-[#05070b]/90 px-4 py-3 text-[11px] leading-relaxed text-[#c7ccd8]"
              )}
            >
              <p className="text-[11px] text-[#c7ccd8]">
                This is a hub-only Eve appraisal tool. Paste items, pick a hub, and get realistic
                prices (no region averages).{" "}
                <span className="font-semibold text-[#ffffff]">
                  I catalog my own station prices
                </span>{" "}
                for Jita, Amarr, Dodixie, Hek, and Rens using direct ESI order scrapes, updated on a
                schedule, then aggregated with a 5% method. That means{" "}
                <span className="font-semibold text-[#ffffff]">
                  fewer outliers and more trustworthy numbers
                </span>{" "}
                for sell/buy calculations.
              </p>
            </div>

            { }
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
              { }
              <section className={classNames(panelBase, "flex flex-col")}>
                <header className="flex items-center justify-between px-3 py-1.5 border-b border-[#2c2f36] bg-[#101219]">
                  <div className="text-[10px] tracking-[0.18em] uppercase text-[#c7ccd8]">
                    Paste Items
                  </div>
                  <div className="text-[10px] text-[#80889b]">Input ▸ Cargo / Asset list</div>
                </header>
                <div className="p-3 space-y-2">
                  <textarea
                    className={classNames(
                      inputClass,
                      "h-48 resize-none font-mono text-[11px] leading-snug"
                    )}
                    placeholder={`Tritanium 100000\nPyerite 50000\nMexallon 20000`}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                  />
                  <p className="text-[10px] text-[#8d93a4]">
                    Formats:{" "}
                    <span className="font-mono text-[#cfd3e3]">Name 12345</span>,{" "}
                    <span className="font-mono text-[#cfd3e3]">Name x 12345</span>,{" "}
                    <span className="font-mono text-[#cfd3e3]">typeId 12345</span>, or just{" "}
                    <span className="font-mono text-[#cfd3e3]">Name</span> /
                    <span className="font-mono text-[#cfd3e3]">typeId</span> (defaults to 1).
                  </p>
                  {error && (
                    <p className="mt-1 text-[10px] text-[#ff9e9e]">
                      {error}
                    </p>
                  )}
                </div>
              </section>

              { }
              <section className={classNames(panelBase, "flex flex-col")}>
                <header className="flex items-center justify-between px-3 py-1.5 border-b border-[#2c2f36] bg-[#101219]">
                  <div className="text-[10px] tracking-[0.18em] uppercase text-[#c7ccd8]">
                    Hub &amp; Pricing
                  </div>
                  <div className="text-[10px] text-[#80889b]">
                    Station ▸ {activeHubLabel}
                  </div>
                </header>
                <div className="p-3 space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-[10px] tracking-[0.18em] uppercase text-[#a5abbc]">
                        Hub (station)
                      </label>
                      <select
                        className={selectClass}
                        value={stationId}
                        onChange={(e) => setStationId(Number(e.target.value))}
                      >
                        {HUBS.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-[10px] text-[#8d93a4]">
                        Prices come only from active orders at the selected hub.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] tracking-[0.18em] uppercase text-[#a5abbc]">
                        Price mode
                      </label>
                      <select
                        className={selectClass}
                        value={mode}
                        onChange={(e) => setMode(e.target.value as Mode)}
                      >
                        <option value="sell5">Sell (5%) — smooth</option>
                        <option value="buy5">Buy (5%) — smooth</option>
                        <option value="sell">Sell (min)</option>
                        <option value="buy">Buy (max)</option>
                        <option value="split">Split (avg)</option>
                      </select>
                      <p className="text-[10px] text-[#8d93a4] leading-snug">
                        {modeExplain[mode]}
                      </p>
                    </div>
                  </div>

                  { }
                  <div className="border-t border-[#262933] pt-3 mt-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="w-36 text-[10px] tracking-[0.18em] uppercase text-[#a5abbc]">
                        Adjust Total (%)
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={200}
                        value={adjustPct}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setAdjustPct(v);
                          if (totals) {
                            const base =
                              mode === "split"
                                ? totals.split
                                : mode.startsWith("sell")
                                  ? totals.sell
                                  : totals.buy;
                            const adjusted =
                              Math.round((base || 0) * (v / 100) * 100) / 100;
                            setTotals({ ...totals, adjusted, adjustmentPct: v });
                          }
                        }}
                        className="flex-1 accent-[#1e90ff]"
                      />
                      <input
                        type="number"
                        min={0}
                        max={200}
                        value={adjustPct}
                        onChange={(e) => {
                          let v = Number(e.target.value);
                          if (!Number.isFinite(v)) v = 100;
                          v = Math.max(0, Math.min(200, v));
                          setAdjustPct(v);
                          if (totals) {
                            const base =
                              mode === "split"
                                ? totals.split
                                : mode.startsWith("sell")
                                  ? totals.sell
                                  : totals.buy;
                            const adjusted =
                              Math.round((base || 0) * (v / 100) * 100) / 100;
                            setTotals({ ...totals, adjusted, adjustmentPct: v });
                          }
                        }}
                        className="w-16 bg-[#05070b] border border-[#303236] px-1.5 py-1 text-right text-[11px] rounded-sm focus:outline-none focus:border-[#3c9ae8]"
                      />
                    </div>
                    <p className="text-[10px] text-[#8d93a4]">
                      Scale the total to list at a discount/premium (0–200%). Saved with the
                      appraisal.
                    </p>
                    {adjustedNow != null && (
                      <div className="text-[11px] text-[#c7ccd8]">
                        <span className="text-[#8d93a4] mr-1">Estimated value</span>
                        <span className="font-mono font-semibold">
                          {adjustedNow.toLocaleString()} ISK
                        </span>
                        <span className="ml-2 text-[#8d93a4]">
                          ({adjustPct}% •{" "}
                          {mode === "split"
                            ? "Split"
                            : mode.startsWith("sell")
                              ? "Sell"
                              : "Buy"}
                          )
                        </span>
                      </div>
                    )}
                  </div>

                  { }
                  <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[#262933] mt-2">
                    <button
                      className={btnPrimary}
                      onClick={onAppraise}
                      disabled={loading || !parsedLines.length}
                    >
                      {loading ? "Working…" : "Appraise"}
                    </button>
                    <button
                      className={btnSecondary}
                      onClick={onSave}
                      disabled={loading || !preview}
                      title={!preview ? "Appraise first" : "Save this appraisal"}
                    >
                      Save &amp; Share
                    </button>
                    <label className="ml-auto inline-flex items-center gap-2 text-[11px] text-[#c7ccd8]">
                      <input
                        type="checkbox"
                        className="accent-[#1e90ff]"
                        checked={combine}
                        onChange={(e) => setCombine(e.target.checked)}
                      />
                      Combine identical items
                    </label>
                  </div>
                </div>
              </section>
            </div>

            { }
            {sortedPreview && totals && (
              <section className={classNames(panelBase, "mt-1")}>
                <header className="flex items-center justify-between px-3 py-1.5 border-b border-[#2c2f36] bg-[#101219]">
                  <div className="text-[10px] tracking-[0.18em] uppercase text-[#c7ccd8]">
                    Preview
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-[#9ea4b9]">
                    <span>
                      Volume:{" "}
                      <span className="font-mono text-[#dde2f2]">
                        {totals.volume.toLocaleString()} m³
                      </span>
                    </span>
                    <span>
                      Items:{" "}
                      <span className="font-mono text-[#dde2f2]">
                        {totals.itemCount}
                      </span>
                    </span>
                  </div>
                </header>

                <div className="px-3 pt-3 pb-2 space-y-3">
                  { }
                  <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[#a5abbc]">
                        Adjusted Total
                      </div>
                      {totals?.adjusted != null && (
                        <div className="font-mono text-xl md:text-2xl text-[#f5f6ff]">
                          {Math.round(totals.adjusted).toLocaleString()} ISK{" "}
                          <span className="text-[11px] text-[#8d93a4]">
                            ({adjustPct}%)
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="text-right space-y-1">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[#a5abbc]">
                        {mode === "split"
                          ? "Estimated Value (Split)"
                          : mode.startsWith("sell")
                            ? "Total Sell Value"
                            : "Total Buy Value"}
                      </div>
                      <div className="flex items-center justify-end gap-2 font-mono text-xl md:text-2xl text-[#f5f6ff]">
                        <span>
                          {baseGrand != null
                            ? Math.round(baseGrand).toLocaleString()
                            : "—"}{" "}
                          ISK
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyTotal(baseGrand)}
                          disabled={baseGrand == null}
                          className="px-1.5 py-0.5 text-[10px] border border-[#3a3c40] bg-[#151820] rounded-sm hover:border-[#4c576a] disabled:opacity-50"
                          title={copied ? "Copied" : "Copy total to clipboard"}
                        >
                          {copied ? "✔" : "⧉"}
                        </button>
                      </div>
                    </div>
                  </div>

                  { }
                  <div className="flex flex-wrap gap-4 text-[10px] text-[#8d93a4]">
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-3 w-3 border border-[#2b2d33] bg-[#090b11]" />{" "}
                      Normal
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-3 w-3 border border-[#6f5a2d] bg-[#2b210f]" />{" "}
                      No active orders at hub
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-3 w-3 border border-[#7c3131] bg-[#301112]" />{" "}
                      Invalid / not an item
                    </span>
                  </div>

                  { }
                  <div className="overflow-auto border border-[#2b2d33]">
                    <table className="min-w-full text-[11px]">
                      <thead className="bg-[#14161d] border-b border-[#2b2d33]">
                        <tr className="text-left text-[#c7ccd8]">
                          <th className="w-10 px-2 py-2" />
                          {[
                            ["Item", "name"],
                            ["Qty", "qty"],
                            ["m³", "m3"],
                            ["Price", "unitPrice"],
                            ["Line ISK", "lineISK"],
                            ["Src", "priceSource"],
                            ["Status", "status"],
                          ].map(([label, key]) => {
                            const k = key as SortKey;
                            const active = sortKey === k;
                            const isNumeric =
                              k === "qty" ||
                              k === "m3" ||
                              k === "unitPrice" ||
                              k === "lineISK";
                            return (
                              <th
                                key={key}
                                className={classNames(
                                  "px-3 py-2 border-l border-[#2b2d33] select-none",
                                  isNumeric && "text-right"
                                )}
                                onClick={() => clickSort(k)}
                                style={{ cursor: "pointer" }}
                                title="Click to sort"
                              >
                                <span className="inline-flex items-center gap-1">
                                  {label}
                                  <span className="text-[#6f7380]">
                                    {active ? (sortDir === "asc" ? "▲" : "▼") : ""}
                                  </span>
                                </span>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedPreview.map((r, i) => {
                          const zebra =
                            r.status === "invalid" || r.status === "unpriced"
                              ? ""
                              : i % 2 === 0
                                ? "bg-[#090b11]"
                                : "bg-[#0c0f16]";
                          const highlight =
                            r.status === "invalid"
                              ? "bg-[#301112]"
                              : r.status === "unpriced"
                                ? "bg-[#2b210f]"
                                : "";
                          return (
                            <tr
                              key={i}
                              className={classNames(
                                "border-t border-[#2b2d33] hover:bg-[#141821]",
                                zebra,
                                highlight
                              )}
                            >
                              <td className="px-2 py-1.5">
                                {r.type_id ? (
                                  <div className="relative h-6 w-6 overflow-visible">
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
                                      className="pointer-events-none absolute inset-0 select-none rounded"
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
                              <td className="px-3 py-1.5 text-[#e0e4f3]">
                                <div className="flex items-center gap-2">
                                  <span className="min-w-0 flex-1 truncate">
                                    {r.name}
                                  </span>
                                  <ItemInfoLink typeId={r.type_id} label={r.name} />
                                </div>
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono">
                                {r.qty.toLocaleString()}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono">
                                {r.m3 != null ? r.m3.toLocaleString() : "—"}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono">
                                {r.unitPrice != null
                                  ? Math.round(r.unitPrice).toLocaleString()
                                  : "N/A"}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono">
                                {r.lineISK != null
                                  ? Math.round(r.lineISK).toLocaleString()
                                  : "—"}
                              </td>
                              <td className="px-3 py-1.5 text-[10px] text-[#9ea4b9]">
                                {r.priceSource}
                              </td>
                              <td className="px-3 py-1.5 text-[10px]">
                                {r.status === "ok" && (
                                  <span className="text-[#c7ccd8]">OK</span>
                                )}
                                {r.status === "unpriced" && (
                                  <span className="text-[#e0c27b]">
                                    No orders found
                                  </span>
                                )}
                                {r.status === "invalid" && (
                                  <span className="text-[#f29f9f]">Invalid</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="text-[10px] text-[#8d93a4]">
                    Prices are sourced from{" "}
                    <span className="font-semibold text-[#dde2f2]">
                      active orders at the selected hub
                    </span>
                    . Items with no hub orders may use region fallback (Fuzzworks) for visibility.
                    “5%” means volume-weighted smoothing over the cheapest/highest 5% of sell/buy
                    volume.
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
