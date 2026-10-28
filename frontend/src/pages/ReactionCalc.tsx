/*
 * React page for /reaction-calc.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import infoIconRaw from "../assets/icons/info.svg?raw";
import {
  requestSiteAuthModal,
  SITE_AUTH_CHANGED_EVENT,
  type SiteAuthChangeDetail,
} from "../auth/siteAuthEvents";
import type { AuthUser } from "../components/fitting/types";

const range = (start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, index) => start + index);

const HYBRID_IDS = range(46157, 46165);
const COMPOSITE_SIMPLE_IDS = [...range(46166, 46186), 57490, 57494, 57491];
const COMPOSITE_UNREFINED_IDS = range(46187, 46203);
const COMPOSITE_COMPLEX_IDS = [...range(46204, 46218), 57492, 57493];
const BOOSTER_SYNTH_IDS = [46219, 46220, 46221, 46228, 46229, 46232, 46233, 46234];
const BOOSTER_STANDARD_IDS = [46222, 46223, 46224, 46225, 46226, 46227, 46230, 46231];
const BOOSTER_IMPROVED_IDS = [46236, 46237, 46238, 46240, 46241, 46242, 46243, 46251];
const BOOSTER_STRONG_IDS = [46235, 46244, 46245, 46246, 46247, 46248, 46249, 46250];
const MOLECULAR_FORGING_IDS = range(57495, 57506);

const reactionSections = [
  { key: "hybrid", family: "Hybrid", title: "Hybrid Reactions", blueprintIDs: HYBRID_IDS },
  {
    key: "composite-simple",
    family: "Composite",
    title: "Simple Reactions",
    blueprintIDs: COMPOSITE_SIMPLE_IDS,
  },
  {
    key: "composite-complex",
    family: "Composite",
    title: "Complex Reactions",
    blueprintIDs: COMPOSITE_COMPLEX_IDS,
  },
  {
    key: "composite-complex-chain",
    family: "Composite",
    title: "Complex Chain Reactions",
    blueprintIDs: COMPOSITE_COMPLEX_IDS,
    chain: true,
  },
  {
    key: "composite-unrefined",
    family: "Composite",
    title: "Unrefined Reactions (not reprocessed)",
    blueprintIDs: COMPOSITE_UNREFINED_IDS,
  },
  {
    key: "booster-synth",
    family: "Biochemical",
    title: "Synth Booster Reactions",
    blueprintIDs: BOOSTER_SYNTH_IDS,
  },
  {
    key: "booster-standard",
    family: "Biochemical",
    title: "Standard Booster Reactions",
    blueprintIDs: BOOSTER_STANDARD_IDS,
  },
  {
    key: "booster-improved",
    family: "Biochemical",
    title: "Improved Booster Reactions",
    blueprintIDs: BOOSTER_IMPROVED_IDS,
  },
  {
    key: "booster-improved-chain",
    family: "Biochemical",
    title: "Improved Booster Chain Reactions",
    blueprintIDs: BOOSTER_IMPROVED_IDS,
    chain: true,
  },
  {
    key: "booster-strong",
    family: "Biochemical",
    title: "Strong Booster Reactions",
    blueprintIDs: BOOSTER_STRONG_IDS,
  },
  {
    key: "booster-strong-chain",
    family: "Biochemical",
    title: "Strong Booster Chain Reactions",
    blueprintIDs: BOOSTER_STRONG_IDS,
    chain: true,
  },
  {
    key: "molecular-forging",
    family: "Biochemical",
    title: "Molecular-Forging Reactions",
    blueprintIDs: MOLECULAR_FORGING_IDS,
  },
];

const reactionFamilies = ["All", "Hybrid", "Composite", "Biochemical"];

const isk = (value: number) => `${Math.round(value || 0).toLocaleString()} ISK`;
const quantity = (value: number) =>
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

function classNames(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
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

function ItemInfoLink({ typeId, label }: { typeId?: number | null; label: string }) {
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

function parsePositiveInt(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeReactionFamily(value: string | null) {
  const found = reactionFamilies.find((family) => family.toLowerCase() === String(value || "").toLowerCase());
  return found || null;
}

function reactionFamilyForBlueprintId(blueprintID: number | null) {
  if (!blueprintID) return null;
  const section = reactionSections.find((item) => !item.chain && item.blueprintIDs.includes(blueprintID));
  return section?.family || null;
}

function resultUsesInputType(result: any, typeID: number | null) {
  if (!typeID) return false;
  return (result.inputs || []).some((input: any) => Number(input.typeID) === typeID);
}

const REACTION_STATE_TOOL_KEY = "reaction-calc";

type ReactionRememberedInputs = {
  reactionFamily?: string;
  pricingModeInput?: string;
  pricingModeOutput?: string;
  taxRatePercent?: number;
  structureType?: string;
  rig1?: string;
  systemCostIndex?: number;
  facilityTaxPercent?: number;
  securityStatus?: string;
  sortKey?: string;
  sortAsc?: boolean;
};

function rememberedNumber(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function rememberedString(value: unknown, allowed: string[], fallback: string) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function normalizeReactionRememberedInputs(raw: unknown): ReactionRememberedInputs {
  const source = raw && typeof raw === "object" ? raw as ReactionRememberedInputs : {};
  return {
    reactionFamily: rememberedString(source.reactionFamily, reactionFamilies, "Hybrid"),
    pricingModeInput: rememberedString(source.pricingModeInput, ["buy", "sell"], "sell"),
    pricingModeOutput: rememberedString(source.pricingModeOutput, ["buy", "sell"], "buy"),
    taxRatePercent: rememberedNumber(source.taxRatePercent, 0),
    structureType: rememberedString(source.structureType, ["Station", "Athanor", "Tatara"], "Station"),
    rig1: rememberedString(source.rig1, ["None", "T1", "T2"], "None"),
    systemCostIndex: rememberedNumber(source.systemCostIndex, 0),
    facilityTaxPercent: rememberedNumber(source.facilityTaxPercent, 0),
    securityStatus: rememberedString(source.securityStatus, ["low", "null", "wh"], "wh"),
    sortKey: rememberedString(
      source.sortKey,
      ["productName", "inputCost", "totalTaxes", "outputValue", "profit", "profitPercent"],
      "profitPercent"
    ),
    sortAsc: Boolean(source.sortAsc),
  };
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

const ReactionCalc: React.FC = () => {
  const [searchParams] = useSearchParams();
  const linkedBlueprintID = useMemo(() => parsePositiveInt(searchParams.get("blueprint_id") || searchParams.get("blueprintID")), [searchParams]);
  const linkedInputTypeID = useMemo(() => parsePositiveInt(searchParams.get("input_type_id") || searchParams.get("inputTypeId")), [searchParams]);
  const linkedFamily = useMemo(
    () => reactionFamilyForBlueprintId(linkedBlueprintID) || normalizeReactionFamily(searchParams.get("family")),
    [linkedBlueprintID, searchParams]
  );
  const shouldOpenLinkedRecipe = searchParams.get("open") === "1" || searchParams.get("open") === "true";
  const linkedRecipeRowKey = linkedBlueprintID ? `${linkedBlueprintID}:simple` : null;
  const queryHydratedRef = useRef("");
  const openedRecipeRef = useRef("");
  const [sortKey, setSortKey] = useState("profitPercent");
  const [sortAsc, setSortAsc] = useState(false);
  const [station] = useState("Jita 4-4");
  const [reactionFamily, setReactionFamily] = useState(linkedFamily || "Hybrid");
  const [pricingModeInput, setPricingModeInput] = useState("sell");
  const [pricingModeOutput, setPricingModeOutput] = useState("buy");
  const [taxRatePercent, setTaxRatePercent] = useState(0);
  const [structureType, setStructureType] = useState("Station");
  const [rig1, setRig1] = useState("None");
  const [systemCostIndex, setSystemCostIndex] = useState(0);
  const [facilityTaxPercent, setFacilityTaxPercent] = useState(0);
  const [securityStatus, setSecurityStatus] = useState("wh");
  const [results, setResults] = useState<any[]>([]);
  const [selectedResult, setSelectedResult] = useState<any | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [remoteStateReady, setRemoteStateReady] = useState(false);

  const visibleSections = useMemo(
    () =>
      reactionSections.filter(
        (section) => reactionFamily === "All" || section.family === reactionFamily
      ),
    [reactionFamily]
  );

  useEffect(() => {
    let alive = true;

    async function loadAuth() {
      try {
        const response = await fetch("/api/auth/me", { credentials: "include" });
        const data = await readJson<{ ok: boolean; authenticated: boolean; user: AuthUser | null }>(response);
        if (alive) setAuthUser(data.authenticated ? data.user : null);
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
    const queryKey = searchParams.toString();
    if (queryHydratedRef.current === queryKey) return;
    queryHydratedRef.current = queryKey;
    openedRecipeRef.current = "";
    if (linkedFamily) setReactionFamily(linkedFamily);
  }, [linkedFamily, searchParams]);

  useEffect(() => {
    if (!authUser) {
      setRemoteStateReady(false);
      return;
    }

    let cancelled = false;

    async function loadRemoteState() {
      setRemoteStateReady(false);
      try {
        const response = await fetch(`/api/tool-state/${REACTION_STATE_TOOL_KEY}`, {
          credentials: "include",
        });
        const data = await readJson<{
          ok: boolean;
          state: { stateJson?: unknown } | null;
        }>(response);
        if (cancelled || !data.state?.stateJson) return;
        const remembered = normalizeReactionRememberedInputs(data.state.stateJson);
        setReactionFamily(linkedFamily || remembered.reactionFamily || "Hybrid");
        setPricingModeInput(remembered.pricingModeInput || "sell");
        setPricingModeOutput(remembered.pricingModeOutput || "buy");
        setTaxRatePercent(remembered.taxRatePercent ?? 0);
        setStructureType(remembered.structureType || "Station");
        setRig1(remembered.rig1 || "None");
        setSystemCostIndex(remembered.systemCostIndex ?? 0);
        setFacilityTaxPercent(remembered.facilityTaxPercent ?? 0);
        setSecurityStatus(remembered.securityStatus || "wh");
        setSortKey(remembered.sortKey || "profitPercent");
        setSortAsc(Boolean(remembered.sortAsc));
      } catch {
        if (!cancelled) setRemoteStateReady(true);
        return;
      } finally {
        if (!cancelled) setRemoteStateReady(true);
      }
    }

    void loadRemoteState();
    return () => {
      cancelled = true;
    };
  }, [authUser, linkedFamily]);

  useEffect(() => {
    if (!authUser || !remoteStateReady) return;
    const snapshot: ReactionRememberedInputs = {
      reactionFamily,
      pricingModeInput,
      pricingModeOutput,
      taxRatePercent,
      structureType,
      rig1,
      systemCostIndex,
      facilityTaxPercent,
      securityStatus,
      sortKey,
      sortAsc,
    };

    const timer = window.setTimeout(() => {
      void fetch(`/api/tool-state/${REACTION_STATE_TOOL_KEY}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stateJson: snapshot }),
      }).catch(() => {});
    }, 600);

    return () => window.clearTimeout(timer);
  }, [
    authUser,
    remoteStateReady,
    reactionFamily,
    pricingModeInput,
    pricingModeOutput,
    taxRatePercent,
    structureType,
    rig1,
    systemCostIndex,
    facilityTaxPercent,
    securityStatus,
    sortKey,
    sortAsc,
  ]);

  useEffect(() => {
    const fetchAll = async () => {
      const payload = {
        station,
        inputPricingMode: pricingModeInput,
        outputPricingMode: pricingModeOutput,
        taxRatePercent,
        structureType,
        meRig: rig1,
        systemCostIndex,
        facilityTaxPercent,
        securityStatus,
      };

      const requests = visibleSections.flatMap((section) =>
        section.blueprintIDs.map((blueprintID) => ({
          blueprintID,
          chain: Boolean(section.chain),
          sectionKey: section.key,
          sectionTitle: section.title,
        }))
      );

      const all = await Promise.all(
        requests.map(async (request) => {
          try {
            const { data } = await axios.post("/api/reaction-calc", {
              blueprintID: request.blueprintID,
              chain: request.chain,
              ...payload,
            });
            return {
              ...data,
              sectionKey: request.sectionKey,
              sectionTitle: request.sectionTitle,
            };
          } catch {
            return null;
          }
        })
      );

      setResults(all.filter(Boolean));
    };

    fetchAll();
  }, [
    visibleSections,
    station,
    pricingModeInput,
    pricingModeOutput,
    taxRatePercent,
    structureType,
    rig1,
    systemCostIndex,
    facilityTaxPercent,
    securityStatus,
  ]);

  useEffect(() => {
    if (!selectedResult) return;
    const refreshed = results.find((result) => result.rowKey === selectedResult.rowKey);
    if (refreshed && refreshed !== selectedResult) {
      setSelectedResult(refreshed);
    }
  }, [results, selectedResult]);

  const getSortValue = (result: any) => {
    if (sortKey === "profitPercent") {
      return result.inputCost > 0 ? result.profit / result.inputCost : 0;
    }
    if (sortKey === "productName") {
      return result.outputs[0]?.name || "";
    }
    return result[sortKey] ?? "";
  };

  const sortedSectionResults = (sectionKey: string) =>
    results
      .filter((result) => result.sectionKey === sectionKey)
      .sort((a, b) => {
        const valA = getSortValue(a);
        const valB = getSortValue(b);

        if (typeof valA === "string" || typeof valB === "string") {
          return sortAsc
            ? String(valA).localeCompare(String(valB))
            : String(valB).localeCompare(String(valA));
        }

        return sortAsc ? valA - valB : valB - valA;
      });

  const tableColumns = [
    { key: "productName", label: "Reaction" },
    { key: "inputCost", label: "Inputs" },
    { key: "totalTaxes", label: "Tax" },
    { key: "outputValue", label: "Output" },
    { key: "profit", label: "Profit" },
    { key: "profitPercent", label: "% Profit" },
  ];

  useEffect(() => {
    if (!shouldOpenLinkedRecipe || !linkedRecipeRowKey) return;
    const openKey = `${searchParams.toString()}:${linkedRecipeRowKey}`;
    if (openedRecipeRef.current === openKey) return;
    const linkedResult = results.find((result) => result.rowKey === linkedRecipeRowKey);
    if (!linkedResult) return;
    openedRecipeRef.current = openKey;
    setSelectedResult(linkedResult);
  }, [linkedRecipeRowKey, results, searchParams, shouldOpenLinkedRecipe]);

  const renderResultsTable = (sectionResults: any[]) => (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full min-w-[840px] table-fixed text-[11px]">
        <colgroup>
          <col className="w-[28%]" />
          <col span={5} className="w-[14.4%]" />
        </colgroup>
        <thead>
          <tr className="bg-[#101219] text-slate-100">
            {tableColumns.map((col) => (
              <th
                key={col.key}
                className="border border-[#2b2d33] px-2.5 py-1.5 text-left cursor-pointer select-none hover:text-[#53b6ff] transition-colors"
                onClick={() => {
                  if (sortKey === col.key) {
                    setSortAsc(!sortAsc);
                  } else {
                    setSortKey(col.key);
                    setSortAsc(false);
                  }
                }}
              >
                {col.label} {sortKey === col.key ? (sortAsc ? "^" : "v") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sectionResults.map((result) => {
            const profitPercent =
              result.inputCost > 0 ? (result.profit / result.inputCost) * 100 : 0;
            const isProfit = result.profit >= 0;
            const rowBg = isProfit
              ? "bg-emerald-950/35 hover:bg-emerald-900/35"
              : "bg-rose-950/40 hover:bg-rose-900/40";
            const isHighlighted = resultUsesInputType(result, linkedInputTypeID);

            return (
              <tr
                key={result.rowKey}
                className={`${isHighlighted ? "bg-cyan-950/55 outline outline-1 outline-[#53b6ff]/50 hover:bg-cyan-900/45" : rowBg} cursor-pointer transition-colors`}
                onClick={() => setSelectedResult(result)}
              >
                <td className="px-2.5 py-1.5 border border-[#2b2d33]">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{result.outputs[0]?.name}</span>
                    {isHighlighted && (
                      <span className="shrink-0 border border-[#53b6ff]/40 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-[#9bdcff]">
                        Uses Input
                      </span>
                    )}
                    <ItemInfoLink typeId={result.outputs[0]?.typeID} label={result.outputs[0]?.name || "Reaction output"} />
                  </div>
                </td>
                <td className="px-2.5 py-1.5 border border-[#2b2d33] text-right">
                  {isk(result.inputCost)}
                </td>
                <td className="px-2.5 py-1.5 border border-[#2b2d33] text-right">
                  {isk(result.totalTaxes)}
                </td>
                <td className="px-2.5 py-1.5 border border-[#2b2d33] text-right">
                  {isk(result.outputValue)}
                </td>
                <td className="px-2.5 py-1.5 border border-[#2b2d33] text-right">
                  {isk(result.profit)}
                </td>
                <td className="px-2.5 py-1.5 border border-[#2b2d33] text-right">
                  {profitPercent.toFixed(2)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <main
      id="grid"
      className="tt-tool-v2 min-h-screen text-slate-100 text-[11px] leading-snug"
    >
      <div className="tt2-frame tt2-frame--centered">
        <div className="tt2-window">
          <div className="tt2-titlebar">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
              <span className="uppercase tracking-widest text-[10px] text-slate-300">
                Science &amp; Industry &gt; Reactions
              </span>
            </div>
            <div className="flex items-center gap-2 text-[9px] text-slate-400">
              <span className="px-1 py-0.5 bg-[#0b0d11] border border-[#303236]">
                {station}
              </span>
              <span className="text-[#53b6ff]">Triff.Tools</span>
            </div>
          </div>

          <div className="tt2-contextbar">
            <div className="flex items-center gap-3">
              <span className="uppercase tracking-widest text-slate-300">
                Overview &gt; Reaction Calculator
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#3bbf5a]" />
                <span>Market prices online</span>
              </span>
            </div>
          </div>

          <div className="p-3 space-y-4">
            <div className="border border-[#262933] bg-[#05070b]/90 px-3 py-2">
              <p className="text-[12px] text-slate-300 mb-1">
                Reaction tables are grouped by the same tiers used by reactions.coalition.space. (Thank you.)
                Chain sections assume reaction-produced intermediate inputs are produced instead of bought.
              </p>
              {authChecked && !authUser && (
                <div className="mt-2 flex flex-wrap items-center gap-2 border border-[#27435a] bg-[#07111a] px-2 py-1.5 text-[10px] text-[#9bdcff]">
                  <span className="uppercase tracking-widest">
                    Sign in to remember these inputs across devices.
                  </span>
                  <button
                    type="button"
                    className="border border-[#53b6ff]/50 bg-[#0b1b2a] px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-100 hover:border-[#53b6ff]"
                    onClick={() => requestSiteAuthModal("login")}
                  >
                    Sign In
                  </button>
                </div>
              )}
              {linkedInputTypeID && (
                <div className="mt-2 border border-[#315069] bg-[#07111a] px-2 py-1 text-[10px] uppercase tracking-widest text-[#9bdcff]">
                  Highlighting reactions that use input typeID {linkedInputTypeID}
                </div>
              )}
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <fieldset className="border border-[#2c2f36] bg-[#070910]">
                <legend className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300">
                  <span>Pricing</span>
                </legend>
                <div className="p-2 space-y-2">
                  <div className="flex flex-col gap-0.5">
                    <label
                      htmlFor="reactionFamily"
                      className="text-[10px] uppercase tracking-widest text-slate-400"
                    >
                      Reaction Family
                    </label>
                    <select
                      id="reactionFamily"
                      value={reactionFamily}
                      onChange={(event) => setReactionFamily(event.target.value)}
                      className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                    >
                      {reactionFamilies.map((family) => (
                        <option key={family} value={family}>
                          {family}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <label
                      htmlFor="inputPricingMode"
                      className="text-[10px] uppercase tracking-widest text-slate-400"
                    >
                      Input Pricing Mode
                    </label>
                    <select
                      id="inputPricingMode"
                      value={pricingModeInput}
                      onChange={(event) => setPricingModeInput(event.target.value)}
                      className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                    >
                      <option value="buy">Buy</option>
                      <option value="sell">Sell</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <label
                      htmlFor="outputPricingMode"
                      className="text-[10px] uppercase tracking-widest text-slate-400"
                    >
                      Output Pricing Mode
                    </label>
                    <select
                      id="outputPricingMode"
                      value={pricingModeOutput}
                      onChange={(event) => setPricingModeOutput(event.target.value)}
                      className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                    >
                      <option value="buy">Buy</option>
                      <option value="sell">Sell</option>
                    </select>
                  </div>
                </div>
              </fieldset>

              <fieldset className="border border-[#2c2f36] bg-[#070910]">
                <legend className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300">
                  <span>Structure &amp; Rigs</span>
                </legend>
                <div className="p-2 space-y-2">
                  <div className="flex flex-col gap-0.5">
                    <label
                      htmlFor="structureType"
                      className="text-[10px] uppercase tracking-widest text-slate-400"
                    >
                      Structure Type
                    </label>
                    <select
                      id="structureType"
                      value={structureType}
                      onChange={(event) => setStructureType(event.target.value)}
                      className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                    >
                      <option>Station</option>
                      <option>Athanor</option>
                      <option>Tatara</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <label
                      htmlFor="meRig"
                      className="text-[10px] uppercase tracking-widest text-slate-400"
                    >
                      ME Rig
                    </label>
                    <select
                      id="meRig"
                      value={rig1}
                      onChange={(event) => setRig1(event.target.value)}
                      className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                    >
                      <option>None</option>
                      <option>T1</option>
                      <option>T2</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <label
                      htmlFor="securityStatus"
                      className="text-[10px] uppercase tracking-widest text-slate-400"
                    >
                      Security Status
                    </label>
                    <select
                      id="securityStatus"
                      value={securityStatus}
                      onChange={(event) => setSecurityStatus(event.target.value)}
                      className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                    >
                      <option value="low">Low-sec</option>
                      <option value="null">Null-sec</option>
                      <option value="wh">Wormhole</option>
                    </select>
                  </div>
                </div>
              </fieldset>

              <fieldset className="border border-[#2c2f36] bg-[#070910]">
                <legend className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300">
                  <span>Skills &amp; Costs</span>
                </legend>
                <div className="p-2 space-y-2">
                  <div className="flex flex-col gap-0.5">
                    <label
                      htmlFor="taxRatePercent"
                      className="text-[10px] uppercase tracking-widest text-slate-400"
                    >
                      Tax rate %
                    </label>
                    <input
                      id="taxRatePercent"
                      type="number"
                      min={0}
                      step={0.1}
                      value={taxRatePercent}
                      onChange={(event) =>
                        setTaxRatePercent(event.target.value === "" ? 0 : Number(event.target.value))
                      }
                      className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                    />
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <label
                      htmlFor="systemCostIndex"
                      className="text-[10px] uppercase tracking-widest text-slate-400"
                    >
                      System Cost Index (%)
                    </label>
                    <input
                      id="systemCostIndex"
                      type="number"
                      step="0.0001"
                      value={systemCostIndex}
                      onChange={(event) => setSystemCostIndex(Number(event.target.value))}
                      className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                    />
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <label
                      htmlFor="facilityTax"
                      className="text-[10px] uppercase tracking-widest text-slate-400"
                    >
                      Facility Tax %
                    </label>
                    <input
                      id="facilityTax"
                      type="number"
                      step="0.01"
                      value={facilityTaxPercent}
                      onChange={(event) => setFacilityTaxPercent(Number(event.target.value))}
                      className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                    />
                  </div>
                </div>
              </fieldset>
            </div>

            <div className="space-y-4">
              {visibleSections.map((section) => {
                const sectionResults = sortedSectionResults(section.key);
                if (!sectionResults.length) return null;

                return (
                  <section
                    key={section.key}
                    className="border border-[#303236] bg-[#05070b]/95"
                  >
                    <div className="border-b border-[#2c2f36] bg-gradient-to-r from-[#101219] via-[#151a23] to-[#101219] px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-widest text-slate-200">
                      {section.title}
                    </div>
                    {renderResultsTable(sectionResults)}
                  </section>
                );
              })}
            </div>
          </div>
        </div>

        {selectedResult &&
          createPortal(
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"
            onClick={() => setSelectedResult(null)}
          >
            <div
              className="max-h-[86vh] w-full max-w-6xl overflow-y-auto border border-[#3a3c40] bg-[#0b111c] shadow-[0_0_32px_rgba(0,0,0,0.85)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between px-3 py-1.5 bg-gradient-to-r from-[#111319] via-[#171920] to-[#242833] border-b border-[#3a3c40]">
                <span className="uppercase tracking-widest text-[10px] text-slate-300">
                  Reaction Details &gt; {selectedResult.sectionTitle} &gt;{" "}
                  {selectedResult.outputs[0]?.name}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedResult(null)}
                  className="text-[10px] uppercase tracking-widest text-slate-400 hover:text-slate-100"
                >
                  Close x
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <h3 className="text-xs font-semibold mb-2 text-rose-300 uppercase tracking-widest">
                      Inputs
                    </h3>
                    <div className="border border-[#2c2f36] bg-[#070910]">
                      <table className="w-full text-[11px]">
                        <thead className="bg-[#14161d]">
                          <tr>
                            <th className="px-2 py-1 border border-[#2b2d33] text-left">
                              Name
                            </th>
                            <th className="px-2 py-1 border border-[#2b2d33] text-right">
                              Quantity
                            </th>
                            {!selectedResult.inputsAreEffective && (
                              <th className="px-2 py-1 border border-[#2b2d33] text-right">
                                Effective
                              </th>
                            )}
                            <th className="px-2 py-1 border border-[#2b2d33] text-right">
                              Price
                            </th>
                            <th className="px-2 py-1 border border-[#2b2d33] text-right">
                              Cost
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedResult.inputs.map((input: any) => {
                            const price =
                              selectedResult.prices[input.typeID]?.[
                                selectedResult.inputPricingMode
                              ] ?? 0;
                            const effectiveQuantity = selectedResult.inputsAreEffective
                              ? input.quantity
                              : input.effectiveQuantity ??
                                input.quantity * (selectedResult.materialMult ?? 1);
                            const lineCost = price * effectiveQuantity;

                            return (
                              <tr key={input.typeID}>
                                <td className="border border-[#2b2d33] px-2 py-1">
                                  <div className="flex items-center gap-2">
                                    <span className="min-w-0 flex-1 truncate">{input.name}</span>
                                    <ItemInfoLink typeId={input.typeID} label={input.name} />
                                  </div>
                                </td>
                                <td className="border border-[#2b2d33] px-2 py-1 text-right">
                                  {quantity(input.quantity)}
                                </td>
                                {!selectedResult.inputsAreEffective && (
                                  <td className="border border-[#2b2d33] px-2 py-1 text-right">
                                    {quantity(effectiveQuantity)}
                                  </td>
                                )}
                                <td className="border border-[#2b2d33] px-2 py-1 text-right">
                                  {isk(price)}
                                </td>
                                <td className="border border-[#2b2d33] px-2 py-1 text-right">
                                  {isk(lineCost)}
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="bg-[#14161d] font-semibold">
                            <td
                              className="border border-[#2b2d33] px-2 py-1"
                              colSpan={selectedResult.inputsAreEffective ? 3 : 4}
                            >
                              Total
                            </td>
                            <td className="border border-[#2b2d33] px-2 py-1 text-right">
                              {isk(selectedResult.inputCost)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold mb-2 text-emerald-300 uppercase tracking-widest">
                      Outputs
                    </h3>
                    <div className="border border-[#2c2f36] bg-[#070910]">
                      <table className="w-full text-[11px]">
                        <thead className="bg-[#14161d]">
                          <tr>
                            <th className="px-2 py-1 border border-[#2b2d33] text-left">
                              Name
                            </th>
                            <th className="px-2 py-1 border border-[#2b2d33] text-right">
                              Quantity
                            </th>
                            <th className="px-2 py-1 border border-[#2b2d33] text-right">
                              Price
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedResult.outputs.map((output: any) => {
                            const price =
                              selectedResult.prices[output.typeID]?.[
                                selectedResult.outputPricingMode
                              ] ?? 0;

                            return (
                              <tr key={output.typeID}>
                                <td className="border border-[#2b2d33] px-2 py-1">
                                  <div className="flex items-center gap-2">
                                    <span className="min-w-0 flex-1 truncate">{output.name}</span>
                                    <ItemInfoLink typeId={output.typeID} label={output.name} />
                                  </div>
                                </td>
                                <td className="border border-[#2b2d33] px-2 py-1 text-right">
                                  {quantity(output.quantity)}
                                </td>
                                <td className="border border-[#2b2d33] px-2 py-1 text-right">
                                  {isk(price)}
                                </td>
                              </tr>
                            );
                          })}
                          {selectedResult.extraOutputs?.map((output: any) => (
                            <tr key={`extra-${output.typeID}`}>
                              <td className="border border-[#2b2d33] px-2 py-1">
                                <div className="flex items-center gap-2">
                                  <span className="min-w-0 flex-1 truncate">{output.name}</span>
                                  <ItemInfoLink typeId={output.typeID} label={output.name} />
                                </div>
                              </td>
                              <td className="border border-[#2b2d33] px-2 py-1 text-right">
                                {quantity(output.quantity)}
                              </td>
                              <td className="border border-[#2b2d33] px-2 py-1 text-right">
                                -
                              </td>
                            </tr>
                          ))}
                          <tr className="bg-[#14161d] font-semibold">
                            <td className="border border-[#2b2d33] px-2 py-1" colSpan={2}>
                              Total
                            </td>
                            <td className="border border-[#2b2d33] px-2 py-1 text-right">
                              {isk(selectedResult.outputValue)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold mb-2 text-sky-300 uppercase tracking-widest">
                      Taxes
                    </h3>
                    <div className="border border-[#2c2f36] bg-[#070910]">
                      <table className="w-full text-[11px]">
                        <tbody>
                          {[
                            ["Job Install Cost", selectedResult.jobInstallCost],
                            ["Facility Tax", selectedResult.facilityTax],
                            ["SCC Tax", selectedResult.sccTax],
                            ["Market Tax", selectedResult.marketTax],
                          ].map(([label, value]) => (
                            <tr key={label as string}>
                              <td className="border border-[#2b2d33] px-2 py-1">
                                {label}
                              </td>
                              <td className="border border-[#2b2d33] px-2 py-1 text-right">
                                {isk(value as number)}
                              </td>
                            </tr>
                          ))}
                          <tr className="bg-[#14161d] font-semibold">
                            <td className="border border-[#2b2d33] px-2 py-1">
                              Total
                            </td>
                            <td className="border border-[#2b2d33] px-2 py-1 text-right">
                              {isk(selectedResult.totalTaxes)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {!!selectedResult.intermediateGroups?.length && (
                  <div>
                    <h3 className="text-xs font-semibold mb-2 text-cyan-300 uppercase tracking-widest">
                      Chain Breakdown
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {selectedResult.intermediateGroups.map((group: any) => (
                        <div key={group.depth} className="border border-[#334155] bg-[#070910]">
                          <div className="border-b border-[#334155] bg-[#121a26] px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-widest text-slate-100">
                            {group.title}
                          </div>
                          {group.jobs.map((job: any) => (
                            <div key={`${group.depth}-${job.blueprintID}`} className="border-t border-[#263244]">
                              <div className="bg-[#0d1420] px-2 py-1 text-center text-[11px] text-cyan-100">
                                {job.product?.name}
                              </div>
                              <table className="w-full text-[11px]">
                                <thead className="bg-[#14161d]">
                                  <tr>
                                    <th className="border border-[#2b2d33] px-2 py-1 text-left">
                                      Name
                                    </th>
                                    <th className="border border-[#2b2d33] px-2 py-1 text-right">
                                      Quantity
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {job.inputs.map((input: any) => (
                                    <tr key={`${job.blueprintID}-${input.typeID}`}>
                                      <td className="border border-[#2b2d33] px-2 py-1">
                                        {input.name}
                                      </td>
                                      <td className="border border-[#2b2d33] px-2 py-1 text-right">
                                        {quantity(input.quantity)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ))}
                        </div>
                      ))}
                      {selectedResult.finalStep && (
                        <div className="border border-[#334155] bg-[#070910]">
                          <div className="border-b border-[#334155] bg-[#121a26] px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-widest text-slate-100">
                            Final Step
                          </div>
                          <div className="bg-[#0d1420] px-2 py-1 text-center text-[11px] text-cyan-100">
                            {selectedResult.finalStep.product?.name}
                          </div>
                          <table className="w-full text-[11px]">
                            <thead className="bg-[#14161d]">
                              <tr>
                                <th className="border border-[#2b2d33] px-2 py-1 text-left">
                                  Name
                                </th>
                                <th className="border border-[#2b2d33] px-2 py-1 text-right">
                                  Quantity
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedResult.finalStep.inputs.map((input: any) => (
                                <tr key={`final-${input.typeID}`}>
                                  <td className="border border-[#2b2d33] px-2 py-1">
                                    {input.name}
                                  </td>
                                  <td className="border border-[#2b2d33] px-2 py-1 text-right">
                                    {quantity(input.quantity)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <h3 className="text-xs font-semibold mb-2 text-cyan-300 uppercase tracking-widest">
                    Profit Report
                  </h3>
                  <div className="border border-[#2c2f36] bg-[#070910]">
                    <table className="w-full text-[11px]">
                      <tbody>
                        {[
                          ["Inputs", selectedResult.inputCost],
                          ["Taxes", selectedResult.totalTaxes],
                          ["Output", selectedResult.outputValue],
                          ["Total", selectedResult.profit],
                        ].map(([label, value]) => (
                          <tr
                            key={label as string}
                            className={label === "Total" ? "bg-[#14161d] font-semibold" : ""}
                          >
                            <td className="border border-[#2b2d33] px-3 py-1">
                              {label}
                            </td>
                            <td className="border border-[#2b2d33] px-3 py-1 text-right">
                              {isk(value as number)}
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <td className="border border-[#2b2d33] px-3 py-1">
                            Material Multiplier
                          </td>
                          <td className="border border-[#2b2d33] px-3 py-1 text-right">
                            {(selectedResult.materialMult ?? 1).toFixed(4)}x
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </main>
  );
};

export default ReactionCalc;
