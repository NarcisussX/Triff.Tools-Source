import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2, Power, Trash2 } from "lucide-react";
import { groupCharges } from "./chargeGrouping";
import { PyfaGuiIcon } from "./FittingIcon";
import type { AffectedSkill, ChargeResult, FitPayload, FittingModule, ModuleRowRef, MutaplasmidResult, SearchResult, SlotKey } from "./types";

type Props = {
  x: number;
  y: number;
  slot: SlotKey;
  index: number;
  module: FittingModule;
  targets?: ModuleRowRef[];
  onClose: () => void;
  onRemove: (slot: SlotKey, index: number) => void;
  onFillWithModule?: (slot: SlotKey, index: number) => void;
  onState: (slot: SlotKey, index: number, state: string) => void;
  onCharge: (slot: SlotKey, index: number, charge: ChargeResult | null) => void;
  onVariant: (slot: SlotKey, index: number, variant: SearchResult) => void;
  onSpool: (slot: SlotKey, index: number, cycles: number) => void;
  onMutaplasmid: (slot: SlotKey, index: number, mutaplasmid: MutaplasmidResult) => void;
  onEditMutation: (slot: SlotKey, index: number) => void;
  onClearMutation: (slot: SlotKey, index: number) => void;
  onShowInfo?: (typeId: number, typeName?: string) => void;
  fitPayload?: FitPayload;
  onSkillOverride?: (skillTypeId: number, level: number | null) => void;
};

function eveIcon(typeId: number) {
  return `https://images.evetech.net/types/${typeId}/icon?size=64`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok || data?.ok === false) throw new Error(data?.error || "request_failed");
  return data as T;
}

type AffectedSkillsResponse = {
  ok: boolean;
  skills: AffectedSkill[];
  errors?: Array<{ code?: string; message?: string }>;
};

type SkillMenuKind = "module" | "ship";

const VARIANT_GROUPS = [
  "Tech I",
  "Meta / Named",
  "Tech II",
  "Storyline",
  "Faction",
  "Deadspace",
  "Officer",
  "Abyssal / Mutated / Other",
] as const;

type VariantGroup = (typeof VARIANT_GROUPS)[number];

function variantGroup(variant: SearchResult): VariantGroup {
  const meta = variant.metaGroupName || "";
  if (meta === "Tech I" || !meta) return variant.parentTypeId ? "Meta / Named" : "Tech I";
  if (meta === "Tech II") return "Tech II";
  if (meta === "Storyline") return "Storyline";
  if (meta === "Faction") return "Faction";
  if (meta === "Deadspace") return "Deadspace";
  if (meta === "Officer") return "Officer";
  return "Abyssal / Mutated / Other";
}

function deadspaceRank(name: string) {
  const match = name.match(/\b([CBAX])-Type\b/i);
  if (!match) return 99;
  return { C: 0, B: 1, A: 2, X: 3 }[match[1].toUpperCase() as "C" | "B" | "A" | "X"] ?? 99;
}

function sortVariants(a: SearchResult, b: SearchResult) {
  const groupA = variantGroup(a);
  const groupB = variantGroup(b);
  if (groupA !== groupB) return VARIANT_GROUPS.indexOf(groupA) - VARIANT_GROUPS.indexOf(groupB);
  if (groupA === "Deadspace") {
    const rank = deadspaceRank(a.typeName) - deadspaceRank(b.typeName);
    if (rank !== 0) return rank;
  }
  if (groupA === "Tech I") {
    const baseRank = Number(Boolean(a.parentTypeId)) - Number(Boolean(b.parentTypeId));
    if (baseRank !== 0) return baseRank;
  }
  return a.typeName.localeCompare(b.typeName);
}

function skillLevelLabel(level: number) {
  return level < 0 ? "Not Learned" : `Level ${level}`;
}

function skillCurrentLabel(skill: AffectedSkill) {
  return skill.hasOverride ? `${skillLevelLabel(skill.currentLevel)} *` : skillLevelLabel(skill.currentLevel);
}

export default function ModuleContextMenu({
  x,
  y,
  slot,
  index,
  module,
  targets = [{ key: `${slot}:${index}`, slot, index, module }],
  onClose,
  onRemove,
  onFillWithModule,
  onState,
  onCharge,
  onVariant,
  onSpool,
  onMutaplasmid,
  onEditMutation,
  onClearMutation,
  onShowInfo,
  fitPayload,
  onSkillOverride,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [openSection, setOpenSection] = useState<"charges" | "variants" | "mutaplasmids" | "spool" | "moduleSkills" | "shipSkills" | null>(null);
  const [openChargeGroup, setOpenChargeGroup] = useState<string | null>(null);
  const [openSkillTypeId, setOpenSkillTypeId] = useState<number | null>(null);
  const [charges, setCharges] = useState<ChargeResult[]>([]);
  const [variants, setVariants] = useState<SearchResult[]>([]);
  const [mutaplasmids, setMutaplasmids] = useState<MutaplasmidResult[]>([]);
  const [affectedSkills, setAffectedSkills] = useState<Record<SkillMenuKind, AffectedSkill[]>>({ module: [], ship: [] });
  const [skillLoading, setSkillLoading] = useState<Record<SkillMenuKind, boolean>>({ module: false, ship: false });
  const [skillErrors, setSkillErrors] = useState<Record<SkillMenuKind, string | null>>({ module: null, ship: null });
  const [loading, setLoading] = useState({ charges: false, variants: false, mutaplasmids: false });
  const targetTypeIds = useMemo(() => Array.from(new Set(targets.map((target) => target.module.typeId).filter(Boolean))).sort((a, b) => a - b), [targets]);
  const targetTypeIdsKey = targetTypeIds.join(",");
  const multi = targets.length > 1;

  async function loadAffectedSkills(kind: SkillMenuKind) {
    if (!fitPayload?.shipTypeId || !onSkillOverride) return;
    if (skillLoading[kind] || affectedSkills[kind].length > 0 || skillErrors[kind]) return;
    setSkillLoading((prev) => ({ ...prev, [kind]: true }));
    setSkillErrors((prev) => ({ ...prev, [kind]: null }));
    try {
      const data = await fetchJson<AffectedSkillsResponse>("/api/fitting/affected-skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: fitPayload,
          context: kind === "ship" ? { kind: "ship" } : { kind: "module", slot, index },
        }),
      });
      setAffectedSkills((prev) => ({ ...prev, [kind]: data.skills || [] }));
    } catch (err) {
      setSkillErrors((prev) => ({ ...prev, [kind]: (err as Error).message || "Unable to load skills" }));
    } finally {
      setSkillLoading((prev) => ({ ...prev, [kind]: false }));
    }
  }

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    function intersectByTypeId<T extends { typeId: number }>(sets: T[][]) {
      if (sets.length === 0) return [];
      const counts = new Map<number, { count: number; item: T }>();
      for (const set of sets) {
        const seen = new Set<number>();
        for (const item of set) {
          const typeId = Number(item.typeId);
          if (!typeId || seen.has(typeId)) continue;
          seen.add(typeId);
          const current = counts.get(typeId) || { count: 0, item };
          current.count += 1;
          counts.set(typeId, current);
        }
      }
      return Array.from(counts.values())
        .filter((entry) => entry.count === sets.length)
        .map((entry) => entry.item);
    }
    async function load() {
      const typeIds = targetTypeIdsKey ? targetTypeIdsKey.split(",").map(Number).filter(Boolean) : [];
      setLoading({ charges: true, variants: true, mutaplasmids: !multi });
      try {
        const [chargeData, variantData, mutaplasmidData] = await Promise.allSettled([
          Promise.all(typeIds.map((typeId) => fetchJson<{ ok: boolean; charges: ChargeResult[] }>(`/api/fitting/charges/${typeId}`))),
          Promise.all(typeIds.map((typeId) => fetchJson<{ ok: boolean; variants: SearchResult[] }>(`/api/fitting/variants/${typeId}`))),
          multi
            ? Promise.resolve([])
            : Promise.all(typeIds.map((typeId) => fetchJson<{ ok: boolean; mutaplasmids: MutaplasmidResult[] }>(`/api/fitting/mutaplasmids/${typeId}`))),
        ]);
        if (!alive) return;
        if (chargeData.status === "fulfilled") setCharges(intersectByTypeId(chargeData.value.map((data) => data.charges || [])));
        if (variantData.status === "fulfilled") setVariants(intersectByTypeId(variantData.value.map((data) => data.variants || [])));
        if (mutaplasmidData.status === "fulfilled") setMutaplasmids(intersectByTypeId(mutaplasmidData.value.map((data) => data.mutaplasmids || [])));
      } finally {
        if (alive) setLoading({ charges: false, variants: false, mutaplasmids: false });
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [targetTypeIdsKey, multi]);

  const onlineState = module.state === "offline" ? "online" : "offline";
  const showActivate = module.state === "online";
  const heatState = module.state === "overheated" ? "active" : "overheated";
  const canHeatSelection = targets.some((target) => target.row?.canOverheat);
  const placeholder = Boolean(module.abyssalPlaceholder || targets.some((target) => target.row?.abyssalPlaceholder || target.module.abyssalPlaceholder));
  const spoolTargets = targets.filter((target) => target.row?.spool?.eligible);
  const spoolRange = useMemo(() => {
    if (!spoolTargets.length) return null;
    const min = Math.max(...spoolTargets.map((target) => Number(target.row?.spool?.minCycles ?? 0)));
    const max = Math.min(...spoolTargets.map((target) => Number(target.row?.spool?.maxCycles ?? -1)));
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;
    return {
      min,
      max,
      current: Number(module.spoolAmount ?? targets[0]?.row?.spool?.currentCycles ?? max),
    };
  }, [module.spoolAmount, spoolTargets, targets]);
  const showSpoolMenu = !placeholder && spoolRange !== null && spoolTargets.length === targets.length;
  const placeholderTarget = targets.find((target) => target.row?.placeholderReason || target.module.placeholderReason);
  const placeholderTitle = module.placeholderReason || placeholderTarget?.row?.placeholderReason || placeholderTarget?.module.placeholderReason || "Imported abyssal placeholder. No mutation attributes were provided, so this item is not included in calculated stats.";
  const left = Math.min(x, window.innerWidth - 720);
  const top = Math.min(y, window.innerHeight - 360);
  const anyChargeLoaded = !placeholder && targets.some((target) => target.module.chargeTypeId);
  const showMutaplasmidMenu = !placeholder && !multi && !module.mutation && (loading.mutaplasmids || mutaplasmids.length > 0);
  const showSkillMenus = !placeholder && !multi && Boolean(fitPayload?.shipTypeId && onSkillOverride);
  const chargeGroups = useMemo(() => groupCharges(charges), [charges]);
  const activeChargeGroup = chargeGroups.find((group) => group.key === openChargeGroup && group.items.length > 1) || null;
  const groupedVariants = useMemo(() => {
    const sorted = [...variants].sort(sortVariants);
    return VARIANT_GROUPS.map((label) => ({
      label,
      variants: sorted.filter((variant) => variantGroup(variant) === label),
    })).filter((group) => group.variants.length > 0);
  }, [variants]);
  const activeSkillKind: SkillMenuKind | null = openSection === "moduleSkills" ? "module" : openSection === "shipSkills" ? "ship" : null;
  const activeSkillList = activeSkillKind ? affectedSkills[activeSkillKind] : [];
  const activeSkill = activeSkillList.find((skill) => skill.skillTypeId === openSkillTypeId) || activeSkillList[0] || null;

  const menu = (
    <div
      ref={ref}
      className="fixed z-[9999] flex border border-[#34404c] bg-[#070910] text-[11px] text-slate-200 shadow-2xl shadow-black/70"
      style={{ left: Math.max(8, left), top: Math.max(8, top) }}
    >
      <div className="w-52 py-1">
        <div className="border-b border-[#20242c] px-2 py-1">
          <div className="truncate text-slate-100">{multi ? `${targets.length} modules selected` : module.typeName || `Type ${module.typeId}`}</div>
          {!multi && <div className="font-mono text-[10px] text-slate-600">{placeholder ? "Unresolved abyssal - not calculated" : module.chargeTypeName || "No charge loaded"}</div>}
        </div>
        {placeholder && (
          <div className="flex gap-1.5 border-b border-[#20242c] px-2 py-1.5 text-[10px] leading-4 text-amber-200">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>{placeholderTitle}</span>
          </div>
        )}
        {!multi && onShowInfo && (
          <button
            type="button"
            className="flex h-7 w-full items-center gap-2 px-2 text-left hover:bg-[#101721]"
            onClick={() => {
              onShowInfo(module.typeId, module.typeName);
              onClose();
            }}
          >
            <span className="flex h-4 w-4 items-center justify-center border border-[#303236] bg-[#05070b] font-mono text-[9px] text-[#8bd3ff]">i</span>
            Show Info
          </button>
        )}
        <button
          type="button"
          className="flex h-7 w-full items-center gap-2 px-2 text-left hover:bg-[#101721]"
          onClick={() => {
            onRemove(slot, index);
            onClose();
          }}
        >
          <Trash2 size={12} className="text-red-300" />
          {multi ? "Remove selected modules" : "Remove module"}
        </button>
        {!multi && !placeholder && onFillWithModule && ["high", "mid", "low", "rig"].includes(slot) && (
          <button
            type="button"
            className="flex h-7 w-full items-center gap-2 px-2 text-left hover:bg-[#101721]"
            onClick={() => {
              onFillWithModule(slot, index);
              onClose();
            }}
          >
            <span className="w-3" />
            Fill With Module
          </button>
        )}
        {!placeholder && <button
          type="button"
          className="flex h-7 w-full items-center gap-2 px-2 text-left hover:bg-[#101721]"
          onClick={() => {
            onState(slot, index, onlineState);
            onClose();
          }}
        >
          <Power size={12} className="text-slate-400" />
          {module.state === "offline" ? (multi ? "Online selected" : "Online") : multi ? "Offline selected" : "Offline"}
        </button>}
        {!placeholder && showActivate && (
          <button
            type="button"
            className="flex h-7 w-full items-center gap-2 px-2 text-left hover:bg-[#101721]"
            onClick={() => {
              onState(slot, index, "active");
              onClose();
            }}
          >
            <CheckCircle2 size={12} className="text-emerald-300" />
            {multi ? "Activate selected" : "Activate"}
          </button>
        )}
        {!placeholder && (module.state === "overheated" || canHeatSelection) && (
          <button
            type="button"
            className="flex h-7 w-full items-center gap-2 px-2 text-left hover:bg-[#101721]"
            onClick={() => {
              onState(slot, index, heatState);
              onClose();
            }}
          >
            <PyfaGuiIcon name="overheat" label="Overheat" className="h-3.5 w-3.5" />
            {module.state === "overheated" ? (multi ? "Stop overheating selected" : "Stop overheating") : multi ? "Overheat selected" : "Overheat"}
          </button>
        )}
        {showSpoolMenu && spoolRange && (
          <button
            type="button"
            className={`flex h-7 w-full items-center justify-between px-2 text-left hover:bg-[#101721] ${openSection === "spool" ? "bg-[#101721]" : ""}`}
            onMouseEnter={() => setOpenSection("spool")}
            onClick={() => setOpenSection(openSection === "spool" ? null : "spool")}
          >
            <span>Spool Cycles</span>
            <span className="flex items-center gap-1 text-[10px] text-slate-500">
              {Number.isFinite(spoolRange.current) ? spoolRange.current : spoolRange.max}
              <ChevronRight size={12} />
            </span>
          </button>
        )}
        {!placeholder && !multi && module.mutation && (
          <>
            <button
              type="button"
              className="flex h-7 w-full items-center gap-2 px-2 text-left text-[#d3b3ff] hover:bg-[#101721]"
              onClick={() => {
                onEditMutation(slot, index);
                onClose();
              }}
            >
              <span className="text-[10px]">M</span>
              Edit mutation
            </button>
            <button
              type="button"
              className="flex h-7 w-full items-center gap-2 px-2 text-left hover:bg-[#101721]"
              onClick={() => {
                onClearMutation(slot, index);
                onClose();
              }}
            >
              <span className="text-[10px] text-slate-500">M</span>
              Revert mutation
            </button>
          </>
        )}
        {showMutaplasmidMenu && (
          <button
            type="button"
            className={`flex h-7 w-full items-center justify-between px-2 text-left hover:bg-[#101721] ${openSection === "mutaplasmids" ? "bg-[#101721]" : ""}`}
            onMouseEnter={() => setOpenSection("mutaplasmids")}
            onClick={() => setOpenSection(openSection === "mutaplasmids" ? null : "mutaplasmids")}
          >
            <span>Apply Mutaplasmid</span>
            {loading.mutaplasmids ? <Loader2 size={12} className="animate-spin text-[#53b6ff]" /> : <ChevronRight size={12} />}
          </button>
        )}
        {!placeholder && <button
          type="button"
          className={`flex h-7 w-full items-center justify-between px-2 text-left hover:bg-[#101721] ${openSection === "charges" ? "bg-[#101721]" : ""}`}
          onMouseEnter={() => setOpenSection("charges")}
          onClick={() => setOpenSection(openSection === "charges" ? null : "charges")}
        >
          <span>Load charge/script</span>
          {loading.charges ? <Loader2 size={12} className="animate-spin text-[#53b6ff]" /> : <ChevronRight size={12} />}
        </button>}
        <button
          type="button"
          className={`flex h-7 w-full items-center justify-between px-2 text-left hover:bg-[#101721] ${openSection === "variants" ? "bg-[#101721]" : ""}`}
          onMouseEnter={() => setOpenSection("variants")}
          onClick={() => setOpenSection(openSection === "variants" ? null : "variants")}
        >
          <span>Variants</span>
          {loading.variants ? <Loader2 size={12} className="animate-spin text-[#53b6ff]" /> : <ChevronRight size={12} />}
        </button>
        {showSkillMenus && (
          <>
            <button
              type="button"
              className={`flex h-7 w-full items-center justify-between px-2 text-left hover:bg-[#101721] ${openSection === "moduleSkills" ? "bg-[#101721]" : ""}`}
              onMouseEnter={() => {
                setOpenSection("moduleSkills");
                void loadAffectedSkills("module");
              }}
              onClick={() => {
                const next = openSection === "moduleSkills" ? null : "moduleSkills";
                setOpenSection(next);
                if (next) void loadAffectedSkills("module");
              }}
            >
              <span>Change Module Skills</span>
              {skillLoading.module ? <Loader2 size={12} className="animate-spin text-[#53b6ff]" /> : <ChevronRight size={12} />}
            </button>
            <button
              type="button"
              className={`flex h-7 w-full items-center justify-between px-2 text-left hover:bg-[#101721] ${openSection === "shipSkills" ? "bg-[#101721]" : ""}`}
              onMouseEnter={() => {
                setOpenSection("shipSkills");
                void loadAffectedSkills("ship");
              }}
              onClick={() => {
                const next = openSection === "shipSkills" ? null : "shipSkills";
                setOpenSection(next);
                if (next) void loadAffectedSkills("ship");
              }}
            >
              <span>Change Ship Skills</span>
              {skillLoading.ship ? <Loader2 size={12} className="animate-spin text-[#53b6ff]" /> : <ChevronRight size={12} />}
            </button>
          </>
        )}
      </div>

      {openSection === "charges" && (
        <div className="max-h-80 w-72 overflow-y-auto border-l border-[#20242c] py-1">
          {anyChargeLoaded && (
            <button
              type="button"
              className="h-7 w-full px-2 text-left text-slate-400 hover:bg-[#101721]"
              onClick={() => {
                onCharge(slot, index, null);
                onClose();
              }}
            >
              {multi ? "Unload selected charges" : "Unload charge"}
            </button>
          )}
          {charges.length === 0 ? (
            <div className="px-2 py-2 text-slate-600">{multi ? "No common compatible charges" : "No compatible charges"}</div>
          ) : (
            chargeGroups.map((group) => {
              const first = group.items[0];
              const hasVariants = group.items.length > 1;
              return (
                <button
                  key={group.key}
                  type="button"
                  className={`grid h-7 w-full grid-cols-[22px,1fr,14px] items-center gap-1.5 px-2 text-left hover:bg-[#101721] ${
                    openChargeGroup === group.key ? "bg-[#101721]" : ""
                  }`}
                  onMouseEnter={() => setOpenChargeGroup(hasVariants ? group.key : null)}
                  onClick={() => {
                    if (hasVariants) {
                      setOpenChargeGroup(group.key);
                      return;
                    }
                    onCharge(slot, index, first);
                    onClose();
                  }}
                >
                  <img src={eveIcon(first.typeId)} alt="" className="h-5 w-5 border border-[#30343d] bg-black" />
                  <span className="truncate">{hasVariants ? group.label : first.typeName}</span>
                  {hasVariants ? <ChevronRight size={12} /> : <span />}
                </button>
              );
            })
          )}
        </div>
      )}

      {openSection === "charges" && activeChargeGroup && (
        <div className="max-h-80 w-80 overflow-y-auto border-l border-[#20242c] py-1">
          <div className="border-b border-[#20242c] bg-[#090d13] px-2 py-1 text-[9px] uppercase tracking-widest text-slate-600">
            {activeChargeGroup.label}
          </div>
          {activeChargeGroup.items.map((charge) => (
            <button
              key={charge.typeId}
              type="button"
              className="grid h-7 w-full grid-cols-[22px,1fr,68px] items-center gap-1.5 px-2 text-left hover:bg-[#101721]"
              onClick={() => {
                onCharge(slot, index, charge);
                onClose();
              }}
            >
              <img src={eveIcon(charge.typeId)} alt="" className="h-5 w-5 border border-[#30343d] bg-black" />
              <span className="truncate">{charge.typeName}</span>
              <span className="truncate text-right text-[10px] text-slate-600">{charge.metaGroupName || charge.groupName || ""}</span>
            </button>
          ))}
        </div>
      )}

      {openSection === "mutaplasmids" && showMutaplasmidMenu && (
        <div className="max-h-80 w-72 overflow-y-auto border-l border-[#20242c] py-1">
          {mutaplasmids.length === 0 ? (
            <div className="px-2 py-2 text-slate-600">No compatible mutaplasmids</div>
          ) : (
            mutaplasmids.map((mutaplasmid) => (
              <button
                key={mutaplasmid.typeId}
                type="button"
                className="grid h-7 w-full grid-cols-[22px,1fr] items-center gap-1.5 px-2 text-left hover:bg-[#101721]"
                onClick={() => {
                  onMutaplasmid(slot, index, mutaplasmid);
                  onClose();
                }}
              >
                <img src={eveIcon(mutaplasmid.typeId)} alt="" className="h-5 w-5 border border-[#30343d] bg-black" />
                <span className="truncate">{mutaplasmid.shortName || mutaplasmid.typeName}</span>
              </button>
            ))
          )}
        </div>
      )}

      {openSection === "spool" && showSpoolMenu && spoolRange && (
        <div className="max-h-80 w-44 overflow-y-auto border-l border-[#20242c] py-1">
          <div className="border-b border-[#20242c] bg-[#090d13] px-2 py-1 text-[9px] uppercase tracking-widest text-slate-600">
            Spool Cycles
          </div>
          {Array.from({ length: spoolRange.max - spoolRange.min + 1 }, (_, i) => spoolRange.min + i).map((cycles) => (
            <button
              key={cycles}
              type="button"
              className={`flex h-7 w-full items-center justify-between px-2 text-left hover:bg-[#101721] ${
                cycles === spoolRange.current ? "text-[#8bd3ff]" : ""
              }`}
              onClick={() => {
                onSpool(slot, index, cycles);
                onClose();
              }}
            >
              <span>{cycles}</span>
              {cycles === spoolRange.max && <span className="text-[10px] uppercase text-slate-600">max</span>}
            </button>
          ))}
        </div>
      )}

      {openSection === "variants" && (
        <div className="max-h-80 w-80 overflow-y-auto border-l border-[#20242c] py-1">
          {variants.length <= 1 ? (
            <div className="px-2 py-2 text-slate-600">{multi ? "No common variant family" : "No variants found"}</div>
          ) : (
            groupedVariants.map((group) => (
              <Fragment key={group.label}>
                <div className="border-y border-[#20242c] bg-[#090d13] px-2 py-1 text-[9px] uppercase tracking-widest text-slate-600 first:border-t-0">
                  {group.label}
                </div>
                {group.variants.map((variant) => (
                  <button
                    key={variant.typeId}
                    type="button"
                    className={`grid h-7 w-full grid-cols-[22px,1fr] items-center gap-1.5 px-2 text-left hover:bg-[#101721] ${
                      variant.typeId === module.typeId ? "text-[#8bd3ff]" : ""
                    }`}
                    onClick={() => {
                      onVariant(slot, index, variant);
                      onClose();
                    }}
                  >
                    <img src={eveIcon(variant.typeId)} alt="" className="h-5 w-5 border border-[#30343d] bg-black" />
                    <span className="truncate">{variant.typeName}</span>
                  </button>
                ))}
              </Fragment>
            ))
          )}
        </div>
      )}

      {activeSkillKind && (
        <div className="max-h-80 w-72 overflow-y-auto border-l border-[#20242c] py-1">
          <div className="border-b border-[#20242c] bg-[#090d13] px-2 py-1 text-[9px] uppercase tracking-widest text-slate-600">
            {activeSkillKind === "ship" ? "Ship Skills" : "Module Skills"}
          </div>
          {skillLoading[activeSkillKind] ? (
            <div className="flex h-8 items-center gap-2 px-2 text-slate-500">
              <Loader2 size={12} className="animate-spin text-[#53b6ff]" />
              Loading skills
            </div>
          ) : skillErrors[activeSkillKind] ? (
            <div className="px-2 py-2 text-red-300">{skillErrors[activeSkillKind]}</div>
          ) : activeSkillList.length === 0 ? (
            <div className="px-2 py-2 text-slate-600">No affecting skills found</div>
          ) : (
            activeSkillList.map((skill) => (
              <button
                key={skill.skillTypeId}
                type="button"
                className={`grid h-7 w-full grid-cols-[1fr,72px,14px] items-center gap-2 px-2 text-left hover:bg-[#101721] ${
                  activeSkill?.skillTypeId === skill.skillTypeId ? "bg-[#101721]" : ""
                }`}
                onMouseEnter={() => setOpenSkillTypeId(skill.skillTypeId)}
                onClick={() => setOpenSkillTypeId(skill.skillTypeId)}
              >
                <span className="truncate">{skill.skillName}</span>
                <span className={`truncate text-right text-[10px] ${skill.hasOverride ? "text-[#d3b3ff]" : "text-slate-500"}`}>{skillCurrentLabel(skill)}</span>
                <ChevronRight size={12} />
              </button>
            ))
          )}
        </div>
      )}

      {activeSkillKind && activeSkill && (
        <div className="max-h-80 w-44 overflow-y-auto border-l border-[#20242c] py-1">
          <div className="border-b border-[#20242c] bg-[#090d13] px-2 py-1 text-[9px] uppercase tracking-widest text-slate-600">
            {activeSkill.skillName}
          </div>
          {activeSkill.hasOverride && (
            <button
              type="button"
              className="flex h-7 w-full items-center justify-between px-2 text-left text-[#d3b3ff] hover:bg-[#101721]"
              onClick={() => {
                onSkillOverride?.(activeSkill.skillTypeId, null);
                onClose();
              }}
            >
              <span>Use profile level</span>
              <span className="text-[10px]">*</span>
            </button>
          )}
          {[-1, 0, 1, 2, 3, 4, 5].map((level) => (
            <button
              key={level}
              type="button"
              className={`flex h-7 w-full items-center justify-between px-2 text-left hover:bg-[#101721] ${
                level === activeSkill.currentLevel ? "text-[#8bd3ff]" : ""
              }`}
              onClick={() => {
                onSkillOverride?.(activeSkill.skillTypeId, level);
                onClose();
              }}
            >
              <span>{skillLevelLabel(level)}</span>
              {level === activeSkill.currentLevel && <span className="text-[10px] text-slate-500">current</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return createPortal(menu, document.body);
}
