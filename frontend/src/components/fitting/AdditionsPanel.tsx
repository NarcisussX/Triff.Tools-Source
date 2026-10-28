import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Loader2, Minus, Plus, X } from "lucide-react";
import CargoQuantityInput from "./CargoQuantityInput";
import EnvironmentEffectMenu from "./EnvironmentEffectMenu";
import type {
  CommandBurstSelection,
  CommandFitLink,
  CrossFitSourceSummary,
  EnvironmentEffect,
  FittingStats,
  ImplantSet,
  ImplantSetGrade,
  ProjectedFitLink,
  QuantityItem,
  SearchResult,
} from "./types";

type TabKey = "drones" | "fighters" | "cargo" | "implants" | "boosters" | "projected" | "command" | "notes";

type Props = {
  drones: QuantityItem[];
  fighters: QuantityItem[];
  cargo: QuantityItem[];
  implants: QuantityItem[];
  boosters: QuantityItem[];
  projectedEffects: EnvironmentEffect[];
  projectedLinks: ProjectedFitLink[];
  commandLinks: CommandFitLink[];
  sourceFits: CrossFitSourceSummary[];
  commandBurstsBySource: Record<string, CommandBurstSelection[]>;
  stats: FittingStats | null;
  onRemove: (key: "drones" | "fighters" | "cargo" | "implants" | "boosters", index: number) => void;
  onReplaceCharacterItem: (key: "implants" | "boosters", index: number, variant: SearchResult) => void;
  onApplyImplantSet: (grade: ImplantSetGrade) => void;
  onToggleCharacterItem: (key: "implants" | "boosters", index: number, enabled: boolean) => void;
  onSetDroneActive: (index: number, active: number) => void;
  onSetDroneQuantity: (index: number, quantity: number) => void;
  onSetCargoQuantity: (index: number, quantity: number) => void;
  onSetFighterActive: (index: number, active: number) => void;
  onAddProjectedEffect: (effect: EnvironmentEffect) => void;
  onRemoveProjectedEffect: (index: number) => void;
  onAddProjectedSource: (sourceTabId: string) => void;
  onToggleProjectedSource: (linkId: string, enabled: boolean) => void;
  onRemoveProjectedSource: (linkId: string) => void;
  onAddCommandSource: (sourceTabId: string) => void;
  onToggleCommandSource: (linkId: string, enabled: boolean) => void;
  onToggleCommandBurst: (linkId: string, sourceModuleInstanceId: string, enabled: boolean) => void;
  onRemoveCommandSource: (linkId: string) => void;
  onShowInfo?: (typeId: number, typeName?: string) => void;
};

const tabs: { key: TabKey; label: string }[] = [
  { key: "drones", label: "Drones" },
  { key: "fighters", label: "Fighters" },
  { key: "cargo", label: "Cargo" },
  { key: "implants", label: "Implants" },
  { key: "boosters", label: "Boosters" },
  { key: "projected", label: "Projected" },
  { key: "command", label: "Command" },
  { key: "notes", label: "Notes" },
];

function eveIcon(typeId: number) {
  return `https://images.evetech.net/types/${typeId}/icon?size=64`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data?.ok === false) throw new Error(data?.error || "request_failed");
  return data as T;
}

function fmt(value: unknown, decimals = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function qty(value: unknown, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function activeQty(item: QuantityItem) {
  const active = Number(item.active ?? item.quantity ?? 0);
  return Number.isFinite(active) && active > 0 ? active : 0;
}

function characterSlot(kind: "implants" | "boosters", item: QuantityItem) {
  const slot = Number(kind === "implants" ? item.implantSlot ?? item.slot : item.boosterSlot ?? item.slot);
  return Number.isFinite(slot) && slot > 0 ? slot : null;
}

function Stepper({
  value,
  min = 0,
  max,
  onChange,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 hover:border-[#53b6ff]/60 hover:text-slate-200 disabled:opacity-30"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        title="Deactivate one"
      >
        <Minus size={10} />
      </button>
      <span className="w-5 text-center font-mono text-[10px] text-slate-100">{value}</span>
      <button
        type="button"
        className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 hover:border-[#53b6ff]/60 hover:text-slate-200 disabled:opacity-30"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        title="Activate one"
      >
        <Plus size={10} />
      </button>
    </div>
  );
}

function DroneRows({
  items,
  stats,
  onRemove,
  onSetActive,
  onSetQuantity,
}: {
  items: QuantityItem[];
  stats: FittingStats | null;
  onRemove: (index: number) => void;
  onSetActive: (index: number, active: number) => void;
  onSetQuantity: (index: number, quantity: number) => void;
}) {
  if (!items.length) return <div className="px-2 py-2 text-[11px] text-slate-600">No drones loaded</div>;
  return (
    <div>
      <div className="grid h-6 grid-cols-[22px,1fr,58px,76px,70px,62px,22px] items-center gap-1.5 border-b border-[#20242c] bg-[#0d1016] px-1.5 text-[9px] uppercase tracking-widest text-slate-600">
        <span />
        <span>Drone</span>
        <span className="text-right">Bay</span>
        <span className="text-right">Active</span>
        <span className="text-right">BW</span>
        <span className="text-right">DPS</span>
        <span />
      </div>
      <div className="divide-y divide-[#151922]">
        {items.map((item, index) => {
          const row = stats?.droneRows?.find((entry) => entry.typeId === item.typeId);
          const quantity = qty(item.quantity);
          const active = activeQty(item);
          return (
            <div key={`${item.typeId}-${index}`} className="grid h-7 grid-cols-[22px,1fr,58px,76px,70px,62px,22px] items-center gap-1.5 px-1.5">
              <img src={eveIcon(item.typeId)} alt="" className="h-5 w-5 border border-[#30343d] bg-black" />
              <div className="truncate text-[11px] text-slate-100">{item.typeName || `Type ${item.typeId}`}</div>
              <div className="flex justify-end">
                <input
                  type="number"
                  min={1}
                  value={quantity}
                  className="h-5 w-11 border border-[#303236] bg-[#05070b] px-1 text-right font-mono text-[10px] text-slate-200 outline-none focus:border-[#53b6ff]"
                  title="Drones in bay"
                  onChange={(event) => {
                    const next = Math.floor(Number(event.target.value));
                    if (Number.isFinite(next) && next > 0) onSetQuantity(index, next);
                  }}
                />
              </div>
              <Stepper value={active} max={quantity} onChange={(value) => onSetActive(index, value)} />
              <div className="text-right font-mono text-[10px] text-slate-500">
                {fmt(row?.bandwidthUsed ?? active * Number(row?.bandwidthPerDrone || 0), 0)}
              </div>
              <div className="text-right font-mono text-[10px] text-slate-300">{fmt(row?.dps, 1)}</div>
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 hover:border-red-400 hover:text-red-200"
                onClick={() => onRemove(index)}
                title="Remove"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FighterRows({
  items,
  stats,
  onRemove,
  onSetActive,
}: {
  items: QuantityItem[];
  stats: FittingStats | null;
  onRemove: (index: number) => void;
  onSetActive: (index: number, active: number) => void;
}) {
  if (!items.length) return <div className="px-2 py-2 text-[11px] text-slate-600">No fighters</div>;
  return (
    <div>
      <div className="grid h-6 grid-cols-[22px,1fr,58px,76px,62px,22px] items-center gap-1.5 border-b border-[#20242c] bg-[#0d1016] px-1.5 text-[9px] uppercase tracking-widest text-slate-600">
        <span />
        <span>Fighter</span>
        <span className="text-right">Bay</span>
        <span className="text-right">Active</span>
        <span className="text-right">DPS</span>
        <span />
      </div>
      <div className="divide-y divide-[#151922]">
        {items.map((item, index) => {
          const row = stats?.fighterRows?.find((entry) => entry.typeId === item.typeId);
          const quantity = qty(item.quantity);
          const active = activeQty(item);
          return (
            <div key={`${item.typeId}-${index}`} className="grid h-7 grid-cols-[22px,1fr,58px,76px,62px,22px] items-center gap-1.5 px-1.5">
              <img src={eveIcon(item.typeId)} alt="" className="h-5 w-5 border border-[#30343d] bg-black" />
              <div className="truncate text-[11px] text-slate-100">{item.typeName || `Type ${item.typeId}`}</div>
              <div className="text-right font-mono text-[10px] text-slate-500">x{quantity}</div>
              <Stepper value={active} max={quantity} onChange={(value) => onSetActive(index, value)} />
              <div className="text-right font-mono text-[10px] text-slate-300">{fmt(row?.dps, 1)}</div>
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 hover:border-red-400 hover:text-red-200"
                onClick={() => onRemove(index)}
                title="Remove"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ItemRows({
  items,
  empty,
  onRemove,
}: {
  items: QuantityItem[];
  empty: string;
  onRemove?: (index: number) => void;
}) {
  if (!items.length) return <div className="px-2 py-2 text-[11px] text-slate-600">{empty}</div>;
  return (
    <div className="divide-y divide-[#151922]">
      {items.map((item, index) => (
        <div key={`${item.typeId}-${index}`} className="grid h-7 grid-cols-[22px,1fr,64px,22px] items-center gap-1.5 px-1.5">
          <img src={eveIcon(item.typeId)} alt="" className="h-5 w-5 border border-[#30343d] bg-black" />
          <div className="truncate text-[11px] text-slate-100">{item.typeName || `Type ${item.typeId}`}</div>
          <div className="font-mono text-[10px] text-slate-500">
            x{item.quantity || 1}
            {typeof item.active === "number" ? ` / ${item.active}` : ""}
          </div>
          {onRemove ? (
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 hover:border-red-400 hover:text-red-200"
              onClick={() => onRemove(index)}
              title="Remove"
            >
              <X size={11} />
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
    </div>
  );
}

function CargoRows({
  items,
  onRemove,
  onSetQuantity,
}: {
  items: QuantityItem[];
  onRemove: (index: number) => void;
  onSetQuantity: (index: number, quantity: number) => void;
}) {
  if (!items.length) return <div className="px-2 py-2 text-[11px] text-slate-600">No cargo</div>;
  return (
    <div>
      <div className="grid h-6 grid-cols-[22px,1fr,72px,22px] items-center gap-1.5 border-b border-[#20242c] bg-[#0d1016] px-1.5 text-[9px] uppercase tracking-widest text-slate-600">
        <span />
        <span>Item</span>
        <span className="text-right">Quantity</span>
        <span />
      </div>
      <div className="divide-y divide-[#151922]">
        {items.map((item, index) => (
          <div key={`${item.typeId}-${index}`} className="grid h-7 grid-cols-[22px,1fr,72px,22px] items-center gap-1.5 px-1.5">
            <img src={eveIcon(item.typeId)} alt="" className="h-5 w-5 border border-[#30343d] bg-black" />
            <div className="truncate text-[11px] text-slate-100">{item.typeName || `Type ${item.typeId}`}</div>
            <div className="flex justify-end">
              <CargoQuantityInput
                quantity={qty(item.quantity)}
                onQuantity={(next) => onSetQuantity(index, next)}
                className="h-5 w-14 border border-[#303236] bg-[#05070b] px-1 text-right font-mono text-[10px] text-slate-200 outline-none focus:border-[#53b6ff]"
                ariaLabel={`${item.typeName || `Type ${item.typeId}`} cargo quantity`}
              />
            </div>
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 hover:border-red-400 hover:text-red-200"
              onClick={() => onRemove(index)}
              title="Remove"
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function groupLabel(item: SearchResult) {
  return item.variantGroup || item.metaGroupName || item.groupName || "Variants";
}

function CharacterContextMenu({
  x,
  y,
  kind,
  item,
  index,
  onClose,
  onRemove,
  onVariant,
  onApplyImplantSet,
  onShowInfo,
}: {
  x: number;
  y: number;
  kind: "implants" | "boosters";
  item: QuantityItem;
  index: number;
  onClose: () => void;
  onRemove: () => void;
  onVariant: (variant: SearchResult) => void;
  onApplyImplantSet: (grade: ImplantSetGrade) => void;
  onShowInfo?: (typeId: number, typeName?: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [openSection, setOpenSection] = useState<"variants" | "sets" | null>(null);
  const [openSetFamily, setOpenSetFamily] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [variants, setVariants] = useState<SearchResult[]>([]);
  const [implantSets, setImplantSets] = useState<ImplantSet[]>([]);
  const [loading, setLoading] = useState({ variants: false, sets: false });

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
    setPosition({ left: x, top: y });
  }, [x, y]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const margin = 8;
    const next = {
      left: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin)),
    };
    setPosition((prev) => (prev.left === next.left && prev.top === next.top ? prev : next));
  }, [x, y, openSection, openSetFamily, variants.length, implantSets.length, loading.variants, loading.sets]);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading({ variants: true, sets: kind === "implants" });
      const [variantData, setData] = await Promise.allSettled([
        item.typeId > 0
          ? fetchJson<{ ok: boolean; variants: SearchResult[] }>(`/api/fitting/variants/${item.typeId}`)
          : Promise.resolve({ ok: true, variants: [] as SearchResult[] }),
        kind === "implants"
          ? fetchJson<{ ok: boolean; sets: ImplantSet[] }>("/api/fitting/implant-sets")
          : Promise.resolve({ ok: true, sets: [] as ImplantSet[] }),
      ]);
      if (!alive) return;
      if (variantData.status === "fulfilled") setVariants(variantData.value.variants || []);
      if (setData.status === "fulfilled") setImplantSets(setData.value.sets || []);
      setLoading({ variants: false, sets: false });
    }
    void load();
    return () => {
      alive = false;
    };
  }, [kind, item.typeId]);

  const groupedVariants = useMemo(() => {
    const groups = new Map<string, SearchResult[]>();
    for (const variant of variants) {
      const label = groupLabel(variant);
      groups.set(label, [...(groups.get(label) || []), variant]);
    }
    return Array.from(groups.entries()).map(([label, rows]) => ({
      label,
      rows: rows.sort((a, b) => a.typeName.localeCompare(b.typeName)),
    }));
  }, [variants]);

  const activeSet = implantSets.find((set) => set.key === openSetFamily) || null;
  const canRemove = index >= 0 && item.typeId > 0;
  const title = item.typeName || `Type ${item.typeId}`;
  const menu = (
    <div
      ref={ref}
      className="fixed z-[9999] flex border border-[#34404c] bg-[#070910] text-[11px] text-slate-200 shadow-2xl shadow-black/70"
      style={{ left: position.left, top: position.top }}
    >
      <div className="w-52 py-1">
        <div className="border-b border-[#20242c] px-2 py-1">
          <div className="truncate text-slate-100">{title}</div>
          <div className="font-mono text-[10px] text-slate-600">Slot {characterSlot(kind, item) ?? "?"}</div>
        </div>
        {item.typeId > 0 && onShowInfo && (
          <button
            type="button"
            className="flex h-7 w-full items-center gap-2 px-2 text-left hover:bg-[#101721]"
            onClick={() => {
              onShowInfo(item.typeId, item.typeName);
              onClose();
            }}
          >
            <span className="flex h-4 w-4 items-center justify-center border border-[#303236] bg-[#05070b] font-mono text-[9px] text-[#8bd3ff]">i</span>
            Show Info
          </button>
        )}
        {canRemove && (
          <button
            type="button"
            className="flex h-7 w-full items-center gap-2 px-2 text-left hover:bg-[#101721]"
            onClick={() => {
              onRemove();
              onClose();
            }}
          >
            <X size={12} className="text-red-300" />
            {kind === "implants" ? "Remove Implant" : "Remove Booster"}
          </button>
        )}
        {item.typeId > 0 && (
          <button
            type="button"
            className={`flex h-7 w-full items-center justify-between px-2 text-left hover:bg-[#101721] ${openSection === "variants" ? "bg-[#101721]" : ""}`}
            onMouseEnter={() => {
              setOpenSection("variants");
              setOpenSetFamily(null);
            }}
            onClick={() => {
              setOpenSection(openSection === "variants" ? null : "variants");
              setOpenSetFamily(null);
            }}
          >
            <span>Variants</span>
            {loading.variants ? <Loader2 size={12} className="animate-spin text-[#53b6ff]" /> : <ChevronRight size={12} />}
          </button>
        )}
        {kind === "implants" && (
          <button
            type="button"
            className={`flex h-7 w-full items-center justify-between px-2 text-left hover:bg-[#101721] ${openSection === "sets" ? "bg-[#101721]" : ""}`}
            onMouseEnter={() => setOpenSection("sets")}
            onClick={() => setOpenSection(openSection === "sets" ? null : "sets")}
          >
            <span>Apply Implant Set</span>
            {loading.sets ? <Loader2 size={12} className="animate-spin text-[#53b6ff]" /> : <ChevronRight size={12} />}
          </button>
        )}
      </div>

      {openSection === "variants" && (
        <div className="max-h-80 w-80 overflow-y-auto border-l border-[#20242c] py-1">
          {variants.length <= 1 ? (
            <div className="px-2 py-2 text-slate-600">No variants found</div>
          ) : (
            groupedVariants.map((group) => (
              <div key={group.label}>
                <div className="border-y border-[#20242c] bg-[#090d13] px-2 py-1 text-[9px] uppercase tracking-widest text-slate-600 first:border-t-0">
                  {group.label}
                </div>
                {group.rows.map((variant) => (
                  <button
                    key={variant.typeId}
                    type="button"
                    className={`grid h-7 w-full grid-cols-[22px,1fr,42px] items-center gap-1.5 px-2 text-left hover:bg-[#101721] ${
                      variant.typeId === item.typeId ? "text-[#8bd3ff]" : ""
                    }`}
                    onClick={() => {
                      onVariant(variant);
                      onClose();
                    }}
                  >
                    <img src={eveIcon(variant.typeId)} alt="" className="h-5 w-5 border border-[#30343d] bg-black" />
                    <span className="truncate">{variant.typeName}</span>
                    <span className="text-right font-mono text-[10px] text-slate-600">
                      S{kind === "implants" ? variant.implantSlot ?? variant.slot ?? "?" : variant.boosterSlot ?? variant.slot ?? "?"}
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {openSection === "sets" && kind === "implants" && (
        <div className="max-h-80 w-56 overflow-y-auto border-l border-[#20242c] py-1">
          {!implantSets.length ? (
            <div className="px-2 py-2 text-slate-600">No implant sets found</div>
          ) : (
            implantSets.map((set) => (
              <button
                key={set.key}
                type="button"
                className={`grid h-7 w-full grid-cols-[1fr,16px] items-center gap-1.5 px-2 text-left hover:bg-[#101721] ${
                  openSetFamily === set.key ? "bg-[#101721] text-[#8bd3ff]" : ""
                }`}
                onMouseEnter={() => setOpenSetFamily(set.key)}
                onClick={() => setOpenSetFamily(openSetFamily === set.key ? null : set.key)}
              >
                <span className="truncate">{set.label}</span>
                <ChevronRight size={12} />
              </button>
            ))
          )}
        </div>
      )}

      {openSection === "sets" && kind === "implants" && activeSet && (
        <div className="max-h-80 w-44 overflow-y-auto border-l border-[#20242c] py-1">
          <div className="border-b border-[#20242c] px-2 py-1 text-[9px] uppercase tracking-widest text-slate-600">
            {activeSet.label}
          </div>
          {activeSet.grades.map((grade) => (
            <button
              key={`${activeSet.key}-${grade.key}`}
              type="button"
              className="grid h-7 w-full grid-cols-[1fr,48px] items-center gap-1.5 px-2 text-left hover:bg-[#101721]"
              onClick={() => {
                onApplyImplantSet({ ...grade, familyLabel: activeSet.label });
                onClose();
              }}
            >
              <span className="truncate">{grade.label}</span>
              <span className="text-right font-mono text-[10px] text-slate-600">{grade.items.length} slots</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return createPortal(menu, document.body);
}

function CharacterRows({
  kind,
  items,
  empty,
  onRemove,
  onVariant,
  onApplyImplantSet,
  onToggleEnabled,
  onShowInfo,
}: {
  kind: "implants" | "boosters";
  items: QuantityItem[];
  empty: string;
  onRemove: (index: number) => void;
  onVariant: (index: number, variant: SearchResult) => void;
  onApplyImplantSet: (grade: ImplantSetGrade) => void;
  onToggleEnabled: (index: number, enabled: boolean) => void;
  onShowInfo?: (typeId: number, typeName?: string) => void;
}) {
  const [context, setContext] = useState<{ x: number; y: number; index: number; item: QuantityItem } | null>(null);
  const sorted = items
    .map((item, index) => ({ item, index, slot: characterSlot(kind, item) }))
    .sort((a, b) => Number(a.slot || 999) - Number(b.slot || 999) || (a.item.typeName || "").localeCompare(b.item.typeName || ""));

  if (!items.length) {
    return (
      <>
        <div
          className="h-full px-2 py-2 text-[11px] text-slate-600"
          onContextMenu={(event) => {
            if (kind !== "implants") return;
            event.preventDefault();
            setContext({ x: event.clientX, y: event.clientY, index: -1, item: { typeId: 0, typeName: "Implants" } });
          }}
        >
          {empty}
        </div>
        {context && (
          <CharacterContextMenu
            x={context.x}
            y={context.y}
            kind={kind}
            item={context.item}
            index={context.index}
            onClose={() => setContext(null)}
            onRemove={() => undefined}
            onVariant={() => undefined}
            onApplyImplantSet={onApplyImplantSet}
            onShowInfo={onShowInfo}
          />
        )}
      </>
    );
  }

  return (
    <div className="divide-y divide-[#151922]">
      {sorted.map(({ item, index, slot }) => (
        (() => {
          const enabled = item.enabled !== false;
          return (
        <div
          key={`${item.typeId}-${index}`}
          className={`grid h-7 grid-cols-[48px,22px,1fr,44px,22px] items-center gap-1.5 px-1.5 hover:bg-[#101721] ${enabled ? "" : "opacity-55"}`}
          onContextMenu={(event) => {
            event.preventDefault();
            setContext({ x: event.clientX, y: event.clientY, index, item });
          }}
        >
          <div className="font-mono text-[10px] text-slate-500">Slot {slot ?? "?"}</div>
          <img src={eveIcon(item.typeId)} alt="" className="h-5 w-5 border border-[#30343d] bg-black" />
          <div className="truncate text-[11px] text-slate-100" title={item.typeName || `Type ${item.typeId}`}>
            {item.typeName || `Type ${item.typeId}`}
          </div>
          <button
            type="button"
            aria-pressed={enabled}
            className={`inline-flex h-5 w-10 items-center justify-center gap-1 border bg-[#05070b] font-mono text-[8px] uppercase tracking-[0.12em] ${
              enabled
                ? "border-[#48677a] text-[#8bd3ff] shadow-[inset_0_0_0_1px_rgba(83,182,255,0.08)] hover:border-[#53b6ff]/70"
                : "border-[#303236] bg-[#05070b] text-slate-500 hover:border-[#53b6ff]/60 hover:text-slate-200"
            }`}
            onClick={() => onToggleEnabled(index, !enabled)}
            title={enabled ? "Disable without removing" : "Enable"}
          >
            <span className={`h-2.5 w-px ${enabled ? "bg-[#53b6ff]" : "bg-slate-700"}`} />
            <span>{enabled ? "On" : "Off"}</span>
          </button>
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 hover:border-red-400 hover:text-red-200"
            onClick={() => onRemove(index)}
            title="Remove"
          >
            <X size={11} />
          </button>
        </div>
          );
        })()
      ))}
      {context && (
        <CharacterContextMenu
          x={context.x}
          y={context.y}
          kind={kind}
          item={context.item}
          index={context.index}
          onClose={() => setContext(null)}
          onRemove={() => {
            if (context.index >= 0) onRemove(context.index);
          }}
          onVariant={(variant) => {
            if (context.index >= 0) onVariant(context.index, variant);
          }}
          onApplyImplantSet={onApplyImplantSet}
          onShowInfo={onShowInfo}
        />
      )}
    </div>
  );
}

function ProjectedRows({
  effects,
  projectedLinks,
  sourceFits,
  crossFit,
  onAdd,
  onRemove,
  onAddSource,
  onToggleSource,
  onRemoveSource,
}: {
  effects: EnvironmentEffect[];
  projectedLinks: ProjectedFitLink[];
  sourceFits: CrossFitSourceSummary[];
  crossFit?: FittingStats["crossFit"];
  onAdd: (effect: EnvironmentEffect) => void;
  onRemove: (index: number) => void;
  onAddSource: (sourceTabId: string) => void;
  onToggleSource: (linkId: string, enabled: boolean) => void;
  onRemoveSource: (linkId: string) => void;
}) {
  return (
    <div className="space-y-2 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-slate-500">Environmental Effects</div>
        <EnvironmentEffectMenu onSelect={onAdd} />
      </div>
      {!effects.length ? (
        <div className="text-[11px] text-slate-600">No projected effects</div>
      ) : (
        <div className="divide-y divide-[#151922] border border-[#20242c]">
          {effects.map((effect, index) => (
            <div key={`${effect.effectId}-${index}`} className="grid h-7 grid-cols-[1fr,120px,22px] items-center gap-1.5 px-1.5">
              <div className="truncate text-[11px] text-slate-100" title={effect.typeName || effect.label}>{effect.label}</div>
              <div className="truncate text-[10px] text-slate-500">{effect.categoryLabel || effect.category}</div>
              <button
                type="button"
                className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 hover:border-red-400 hover:text-red-200"
                onClick={() => onRemove(index)}
                title="Remove effect"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-[#20242c] pt-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Projected Fits</div>
          <SourceFitPicker label="Add Open Fit Projection" sources={sourceFits} onAdd={onAddSource} />
        </div>
        {!projectedLinks.length ? (
          <div className="text-[11px] text-slate-600">No projected fit sources</div>
        ) : (
          <div className="divide-y divide-[#151922] border border-[#20242c]">
            {projectedLinks.map((link) => {
              const source = sourceFits.find((entry) => entry.tabId === link.sourceTabId);
              const result = crossFit?.projectedSources?.find((entry) => entry.id === link.id);
              const effects = result?.appliedEffects || [];
              return (
                <div key={link.id} className="px-1.5 py-1">
                  <div className="grid min-h-7 grid-cols-[18px,1fr,70px,22px] items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={link.enabled}
                      onChange={(event) => onToggleSource(link.id, event.target.checked)}
                      title="Enable projected source"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-[11px] text-slate-100" title={source?.fitName || link.sourceTabId}>
                        {source?.fitName || result?.fitName || "Missing source"}{source?.dirty ? " *" : ""}
                      </div>
                      <div className="truncate text-[10px] text-slate-600">{source?.shipName || result?.shipName || "Open fit source"}</div>
                    </div>
                    <div className="text-right font-mono text-[10px] text-slate-500">{effects.length ? `${effects.length} effects` : "No effects"}</div>
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 hover:border-red-400 hover:text-red-200"
                      onClick={() => onRemoveSource(link.id)}
                      title="Remove projected source"
                    >
                      <X size={11} />
                    </button>
                  </div>
                  {effects.length > 0 && (
                    <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 pl-5">
                      {effects.slice(0, 8).map((effect) => (
                        <div key={`${effect.sourceModuleInstanceId}-${effect.typeId}`} className="truncate text-[10px] text-slate-500" title={effect.typeName}>
                          {effect.typeName}{effect.chargeTypeName ? `, ${effect.chargeTypeName}` : ""}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceFitPicker({
  label,
  sources,
  onAdd,
}: {
  label: string;
  sources: CrossFitSourceSummary[];
  onAdd: (sourceTabId: string) => void;
}) {
  const [selected, setSelected] = useState("");
  return (
    <div className="flex items-center gap-1">
      <select
        className="h-6 max-w-[220px] border border-[#303236] bg-[#05070b] px-1 text-[10px] text-slate-300 outline-none"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
      >
        <option value="">{sources.length ? label : "No other open fits"}</option>
        {sources.map((source) => (
          <option key={source.tabId} value={source.tabId}>
            {source.fitName}{source.dirty ? " *" : ""}{source.shipName ? ` - ${source.shipName}` : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="flex h-6 items-center gap-1 border border-[#303236] bg-[#05070b] px-2 text-[10px] uppercase tracking-widest text-slate-400 hover:border-[#53b6ff]/60 hover:text-slate-100 disabled:opacity-30"
        disabled={!selected}
        onClick={() => {
          if (!selected) return;
          onAdd(selected);
          setSelected("");
        }}
      >
        <Plus size={11} />
        Add
      </button>
    </div>
  );
}

function CommandRows({
  commandLinks,
  sourceFits,
  commandBurstsBySource,
  crossFit,
  onAddSource,
  onToggleSource,
  onToggleBurst,
  onRemoveSource,
}: {
  commandLinks: CommandFitLink[];
  sourceFits: CrossFitSourceSummary[];
  commandBurstsBySource: Record<string, CommandBurstSelection[]>;
  crossFit?: FittingStats["crossFit"];
  onAddSource: (sourceTabId: string) => void;
  onToggleSource: (linkId: string, enabled: boolean) => void;
  onToggleBurst: (linkId: string, sourceModuleInstanceId: string, enabled: boolean) => void;
  onRemoveSource: (linkId: string) => void;
}) {
  return (
    <div className="space-y-2 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-slate-500">Command Sources</div>
        <SourceFitPicker label="Add Open Fit Command Source" sources={sourceFits} onAdd={onAddSource} />
      </div>
      {!commandLinks.length ? (
        <div className="text-[11px] text-slate-600">No command sources</div>
      ) : (
        <div className="divide-y divide-[#151922] border border-[#20242c]">
          {commandLinks.map((link) => {
            const source = sourceFits.find((entry) => entry.tabId === link.sourceTabId);
            const bursts = commandBurstsBySource[link.sourceTabId] || [];
            const result = crossFit?.commandSources?.find((entry) => entry.id === link.id);
            return (
              <div key={link.id} className="px-1.5 py-1">
                <div className="grid min-h-7 grid-cols-[18px,1fr,70px,22px] items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={link.enabled}
                    onChange={(event) => onToggleSource(link.id, event.target.checked)}
                    title="Enable command source"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[11px] text-slate-100" title={source?.fitName || link.sourceTabId}>
                      {source?.fitName || result?.fitName || "Missing source"}{source?.dirty ? " *" : ""}
                    </div>
                    <div className="truncate text-[10px] text-slate-600">{source?.shipName || result?.shipName || "Open fit source"}</div>
                  </div>
                  <div className="text-right font-mono text-[10px] text-slate-500">{bursts.length ? `${bursts.length} bursts` : "No bursts"}</div>
                  <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 hover:border-red-400 hover:text-red-200"
                    onClick={() => onRemoveSource(link.id)}
                    title="Remove command source"
                  >
                    <X size={11} />
                  </button>
                </div>
                {!bursts.length ? (
                  <div className="pl-5 text-[10px] text-slate-600">No command bursts found on this fit.</div>
                ) : (
                  <div className="mt-1 divide-y divide-[#10141c] border-t border-[#151922]">
                    {bursts.map((burst) => {
                      const selected = link.selectedBursts.find((entry) => entry.sourceModuleInstanceId === burst.sourceModuleInstanceId);
                      const enabled = selected?.enabled ?? false;
                      return (
                        <label key={burst.sourceModuleInstanceId} className="grid h-6 grid-cols-[18px,20px,1fr,150px] items-center gap-1.5 text-[10px]">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(event) => onToggleBurst(link.id, burst.sourceModuleInstanceId, event.target.checked)}
                          />
                          {burst.moduleTypeId ? <img src={eveIcon(burst.moduleTypeId)} alt="" className="h-4 w-4 border border-[#30343d] bg-black" /> : <span />}
                          <span className="truncate text-slate-300" title={burst.moduleName || ""}>{burst.moduleName || "Command Burst"}</span>
                          <span className="truncate text-slate-500" title={burst.chargeTypeName || ""}>{burst.chargeTypeName || "No charge loaded"}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdditionsPanel({
  drones,
  fighters,
  cargo,
  implants,
  boosters,
  projectedEffects,
  projectedLinks,
  commandLinks,
  sourceFits,
  commandBurstsBySource,
  stats,
  onRemove,
  onReplaceCharacterItem,
  onApplyImplantSet,
  onToggleCharacterItem,
  onSetDroneActive,
  onSetDroneQuantity,
  onSetCargoQuantity,
  onSetFighterActive,
  onAddProjectedEffect,
  onRemoveProjectedEffect,
  onAddProjectedSource,
  onToggleProjectedSource,
  onRemoveProjectedSource,
  onAddCommandSource,
  onToggleCommandSource,
  onToggleCommandBurst,
  onRemoveCommandSource,
  onShowInfo,
}: Props) {
  const [active, setActive] = useState<TabKey>("drones");

  return (
    <section className="flex min-h-0 flex-col overflow-hidden border border-[#2c2f36] bg-[#070910]">
      <div className="flex h-7 shrink-0 overflow-x-auto border-b border-[#2c2f36] bg-[#101219]">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`min-w-20 border-r border-[#2c2f36] px-2 text-[10px] uppercase tracking-widest ${
              active === tab.key ? "bg-[#16202a] text-[#8bd3ff]" : "text-slate-500 hover:text-slate-200"
            }`}
            onClick={() => setActive(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {active === "drones" && (
          <DroneRows
            items={drones}
            stats={stats}
            onRemove={(index) => onRemove("drones", index)}
            onSetActive={onSetDroneActive}
            onSetQuantity={onSetDroneQuantity}
          />
        )}
        {active === "cargo" && (
          <CargoRows
            items={cargo}
            onRemove={(index) => onRemove("cargo", index)}
            onSetQuantity={onSetCargoQuantity}
          />
        )}
        {active === "implants" && (
          <CharacterRows
            kind="implants"
            items={implants}
            empty="No implants"
            onRemove={(index) => onRemove("implants", index)}
            onVariant={(index, variant) => onReplaceCharacterItem("implants", index, variant)}
            onApplyImplantSet={onApplyImplantSet}
            onToggleEnabled={(index, enabled) => onToggleCharacterItem("implants", index, enabled)}
            onShowInfo={onShowInfo}
          />
        )}
        {active === "boosters" && (
          <CharacterRows
            kind="boosters"
            items={boosters}
            empty="No boosters"
            onRemove={(index) => onRemove("boosters", index)}
            onVariant={(index, variant) => onReplaceCharacterItem("boosters", index, variant)}
            onApplyImplantSet={onApplyImplantSet}
            onToggleEnabled={(index, enabled) => onToggleCharacterItem("boosters", index, enabled)}
            onShowInfo={onShowInfo}
          />
        )}
        {active === "fighters" && (
          <FighterRows
            items={fighters}
            stats={stats}
            onRemove={(index) => onRemove("fighters", index)}
            onSetActive={onSetFighterActive}
          />
        )}
        {active === "projected" && (
          <ProjectedRows
            effects={projectedEffects}
            projectedLinks={projectedLinks}
            sourceFits={sourceFits}
            crossFit={stats?.crossFit}
            onAdd={onAddProjectedEffect}
            onRemove={onRemoveProjectedEffect}
            onAddSource={onAddProjectedSource}
            onToggleSource={onToggleProjectedSource}
            onRemoveSource={onRemoveProjectedSource}
          />
        )}
        {active === "command" && (
          <CommandRows
            commandLinks={commandLinks}
            sourceFits={sourceFits}
            commandBurstsBySource={commandBurstsBySource}
            crossFit={stats?.crossFit}
            onAddSource={onAddCommandSource}
            onToggleSource={onToggleCommandSource}
            onToggleBurst={onToggleCommandBurst}
            onRemoveSource={onRemoveCommandSource}
          />
        )}
        {active === "notes" && (
          <textarea
            className="h-full w-full resize-none bg-[#05070b] p-2 text-[11px] text-slate-300 outline-none"
            placeholder="Fit notes"
          />
        )}
      </div>
    </section>
  );
}
