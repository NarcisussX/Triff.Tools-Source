import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MouseEvent } from "react";
import { AlertTriangle, CheckCircle2, Power } from "lucide-react";
import { PyfaGuiIcon } from "./FittingIcon";
import type { FittedModuleRow, FittingModule, FittingStats, SearchResult, ShipModeOption, SkillWarning, SlotKey } from "./types";
import { SLOT_LABELS, SLOT_ORDER } from "./types";

type Props = {
  modules: Record<SlotKey, FittingModule[]>;
  stats: FittingStats | null;
  typeDetails: Record<number, SearchResult>;
  selectedKeys: Set<string>;
  onModuleClick: (event: MouseEvent, slot: SlotKey, index: number, module: FittingModule) => void;
  onModuleContextMenu: (event: MouseEvent, slot: SlotKey, index: number, module: FittingModule) => void;
  onClearSelection: () => void;
  onShipModeChange?: (mode: ShipModeOption) => void;
  onRackStateChange?: (slot: SlotKey, state: "offline" | "online" | "active" | "overheated") => void;
  onModuleStateCycle?: (slot: SlotKey, index: number) => void;
  viewMode?: "fitting" | "graphs";
  onViewModeChange?: (mode: "fitting" | "graphs") => void;
};

const slotTone: Record<SlotKey, string> = {
  high: "text-red-200",
  mid: "text-sky-200",
  low: "text-amber-200",
  rig: "text-slate-300",
  subsystem: "text-lime-200",
};

function eveIcon(typeId: number) {
  return `https://images.evetech.net/types/${typeId}/icon?size=64`;
}

function fmt(value: unknown, decimals = 1) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function countText(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "-";
}

function isk(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (n === 0) return "0";
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}b`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function itemPrice(priceMap: Record<string, number> | undefined, typeId?: number) {
  if (!typeId || !priceMap) return null;
  const value = priceMap[String(typeId)];
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function rowPrice(module: FittingModule, stats: FittingStats | null) {
  const prices = stats?.price?.itemPrices;
  const modulePrice = itemPrice(prices, module.typeId);
  const chargePrice = itemPrice(prices, module.chargeTypeId);
  if (modulePrice == null && chargePrice == null) return null;
  return Number(modulePrice || 0) + Number(chargePrice || 0);
}

function isAbyssalPlaceholder(module: FittingModule, row?: FittedModuleRow | null) {
  return Boolean(module.abyssalPlaceholder || row?.abyssalPlaceholder);
}

function abyssalPlaceholderTooltip(module: FittingModule, row?: FittedModuleRow | null) {
  return row?.placeholderReason || module.placeholderReason || "Imported abyssal placeholder. No mutation attributes were provided, so this item is not included in calculated stats.";
}

function moduleDisplayName(module: FittingModule, row: FittedModuleRow | null) {
  return row?.mutation?.displayName || module.mutation?.displayName || row?.name || module.typeName || `Type ${module.typeId}`;
}

function mutationTooltip(module: FittingModule, row: FittedModuleRow | null) {
  const mutation = row?.mutation || module.mutation;
  if (!mutation) return "";
  const attrs = mutation.attributes || {};
  const lines = [
    `Base: ${mutation.baseTypeName || module.typeName || row?.baseName || ""}`,
    `Mutaplasmid: ${mutation.mutaplasmidName || ""}`,
    ...Object.keys(attrs).sort().map((key) => `${key}: ${attrs[key]}`),
  ];
  return lines.filter(Boolean).join("\n");
}

function stateLabel(module: FittingModule, row?: FittedModuleRow | null) {
  if (isAbyssalPlaceholder(module, row)) return "unresolved";
  return (row?.state || module.state || "active").toLowerCase();
}

function stateTone(state: string) {
  if (state === "unresolved" || state === "placeholder") return "border-amber-300 bg-[#1b1407]";
  if (state === "offline") return "border-slate-500 bg-slate-700";
  if (state === "online") return "border-[#8bd3ff] bg-[#1c6f9f]";
  if (state === "overheated") return "border-red-300 bg-red-500";
  return "border-emerald-300 bg-emerald-500";
}

function moduleRow(stats: FittingStats | null, slot: SlotKey, index: number, module: FittingModule): FittedModuleRow | null {
  const row = stats?.moduleRows?.[slot]?.[index];
  if (!row || Number(row.typeId) !== Number(module.typeId)) return null;
  const rowCharge = row.chargeTypeId == null ? null : Number(row.chargeTypeId);
  const moduleCharge = module.chargeTypeId == null ? null : Number(module.chargeTypeId);
  if (rowCharge !== moduleCharge) return null;
  return row;
}

function displayCell(row: FittedModuleRow | null, key: "capOrFuel" | "range" | "trackingOrApplication") {
  const cell = row?.displayStats?.[key];
  return {
    value: cell?.value || "",
    tooltip: cell?.tooltip || "",
  };
}

function loadedCharge(module: FittingModule, row: FittedModuleRow | null) {
  const typeId = row?.chargeTypeId ?? module.chargeTypeId ?? null;
  const name = row?.chargeName || module.chargeTypeName || "";
  return {
    typeId: typeId == null ? null : Number(typeId),
    name,
  };
}

function rowKey(slot: SlotKey, index: number) {
  return `${slot}:${index}`;
}

function moduleSkillWarning(stats: FittingStats | null, slot: SlotKey, index: number, module: FittingModule): SkillWarning | null {
  const key = rowKey(slot, index);
  return (stats?.skillWarnings || []).find((warning) => (
    warning.scope === "module" && (
      warning.moduleInstanceId === key ||
      warning.moduleInstanceId === module.id ||
      (warning.slot === slot && Number(warning.index) === index)
    )
  )) || null;
}

function missingSkillTooltip(warning: SkillWarning) {
  const rows = (warning.missingSkills || []).slice(0, 8).map((skill) => (
    `${skill.skillName}: ${skill.requiredLevel}${skill.actualLevel != null ? ` (you have ${skill.actualLevel})` : ""}`
  ));
  const remaining = Math.max(0, (warning.missingSkills || []).length - rows.length);
  return [
    "Skills required:",
    ...rows,
    remaining > 0 ? `+ ${remaining} more` : "",
  ].filter(Boolean).join("\n");
}

function MissingSkillIndicator({ warning }: { warning: SkillWarning }) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    left: 12,
    top: 12,
    width: 224,
    maxHeight: 260,
    ready: false,
  });
  const tooltip = missingSkillTooltip(warning);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || typeof window === "undefined") return;

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const margin = 12;
      const gap = 8;
      const rect = anchor.getBoundingClientRect();
      const width = Math.max(180, Math.min(256, window.innerWidth - margin * 2));
      const popoverHeight = popoverRef.current?.offsetHeight || 0;
      let left = rect.left + rect.width / 2 - width / 2;
      let top = rect.bottom + gap;

      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

      if (popoverHeight && top + popoverHeight + margin > window.innerHeight) {
        top = Math.max(margin, rect.top - popoverHeight - gap);
      }

      const next = {
        left,
        top,
        width,
        maxHeight: Math.max(96, window.innerHeight - top - margin),
        ready: true,
      };

      setPosition((current) => (
        current.left === next.left &&
        current.top === next.top &&
        current.width === next.width &&
        current.maxHeight === next.maxHeight &&
        current.ready === next.ready
          ? current
          : next
      ));
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, tooltip]);

  const popover = open && typeof document !== "undefined"
    ? createPortal(
      <span
        ref={popoverRef}
        className="pointer-events-none fixed z-[1000] overflow-auto whitespace-pre-line border border-[#5d4a1f] bg-[#100d07] px-2 py-1.5 text-left text-[10px] leading-4 text-amber-100 shadow-xl shadow-black/70"
        style={{
          left: position.left,
          top: position.top,
          width: position.width,
          maxHeight: position.maxHeight,
          opacity: position.ready ? 1 : 0,
        }}
      >
        {tooltip}
      </span>,
      document.body,
    )
    : null;

  return (
    <span
      className="relative inline-flex h-4 w-4 items-center justify-center"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <span
        ref={anchorRef}
        tabIndex={0}
        className="flex h-4 w-4 items-center justify-center text-amber-300 outline-none focus:text-amber-100"
        aria-label={`Missing skills for ${warning.itemName}`}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <AlertTriangle size={12} />
      </span>
      {popover}
    </span>
  );
}

function ShipModeRow({
  stats,
  onShipModeChange,
}: {
  stats: FittingStats | null;
  onShipModeChange?: (mode: ShipModeOption) => void;
}) {
  const modes = stats?.shipModes?.available || [];
  if (!modes.length || !onShipModeChange) return null;
  const activeModeId = stats?.shipModes?.activeModeId || modes[0]?.modeId || null;
  return (
    <tr className="border-b border-[#20242c] bg-[#090d13]">
      <td colSpan={10} className="px-2 py-1">
        <div className="flex min-h-6 items-center gap-2">
          <div className="text-[9px] uppercase tracking-widest text-slate-500">Mode</div>
          <div className="flex flex-wrap gap-1">
            {modes.map((mode) => {
              const active = String(mode.modeId) === String(activeModeId);
              return (
                <button
                  key={mode.modeId}
                  type="button"
                  className={`border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                    active
                      ? "border-[#53b6ff]/60 bg-[#16202a] text-[#8bd3ff]"
                      : "border-[#303236] bg-[#05070b] text-slate-500 hover:border-[#3b4a5c] hover:text-slate-200"
                  }`}
                  onClick={() => onShipModeChange(mode)}
                  title={mode.fullName}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>
        </div>
      </td>
    </tr>
  );
}

function RackActionButtons({
  slot,
  onRackStateChange,
  canOverheat,
}: {
  slot: SlotKey;
  onRackStateChange?: Props["onRackStateChange"];
  canOverheat: boolean;
}) {
  if (!onRackStateChange) return null;
  const buttonClass = "flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 hover:border-[#53b6ff]/60 hover:text-slate-100";
  const disabledHeatClass = "cursor-not-allowed opacity-35 hover:border-[#303236] hover:text-slate-500";
  return (
    <span className="flex items-center gap-1">
      <button type="button" className={buttonClass} title={`Offline ${SLOT_LABELS[slot]}`} onClick={() => onRackStateChange(slot, "offline")}>
        <Power size={11} />
      </button>
      <button type="button" className={buttonClass} title={`Online ${SLOT_LABELS[slot]}`} onClick={() => onRackStateChange(slot, "online")}>
        <Power size={11} className="text-[#8bd3ff]" />
      </button>
      <button type="button" className={buttonClass} title={`Activate ${SLOT_LABELS[slot]}`} onClick={() => onRackStateChange(slot, "active")}>
        <CheckCircle2 size={11} className="text-emerald-300" />
      </button>
      <button
        type="button"
        className={`${buttonClass} ${canOverheat ? "" : disabledHeatClass}`}
        title={canOverheat ? `Overheat ${SLOT_LABELS[slot]}` : `No heatable modules in ${SLOT_LABELS[slot]}`}
        disabled={!canOverheat}
        onClick={() => onRackStateChange(slot, "overheated")}
      >
        <PyfaGuiIcon name="overheat" label="Overheat" className="h-3 w-3" />
      </button>
    </span>
  );
}

function ViewTabs({
  value = "fitting",
  onChange,
}: {
  value?: "fitting" | "graphs";
  onChange?: (mode: "fitting" | "graphs") => void;
}) {
  if (!onChange) {
    return <div className="text-[10px] uppercase tracking-widest text-slate-300">Fitting</div>;
  }
  return (
    <div className="flex h-full items-end gap-1">
      {(["fitting", "graphs"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={`h-6 border px-2 text-[10px] uppercase tracking-widest ${
            value === mode
              ? "border-[#53b6ff]/70 bg-[#101721] text-[#8bd3ff]"
              : "border-[#303236] bg-[#070910] text-slate-500 hover:border-[#3b4a5c] hover:text-slate-300"
          }`}
          onClick={() => onChange(mode)}
        >
          {mode === "fitting" ? "Fitting" : "Graphs"}
        </button>
      ))}
    </div>
  );
}

export default function FittingTable({ modules, stats, typeDetails, selectedKeys, onModuleClick, onModuleContextMenu, onClearSelection, onShipModeChange, onRackStateChange, onModuleStateCycle, viewMode, onViewModeChange }: Props) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden border border-[#2c2f36] bg-[#070910]">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-[#2c2f36] bg-[#101219] px-2">
        <ViewTabs value={viewMode} onChange={onViewModeChange} />
        <div className="flex items-center gap-2 font-mono text-[10px] text-slate-500">
          {selectedKeys.size > 0 && (
            <button type="button" className="border border-[#303236] px-1.5 py-0.5 text-[#8bd3ff] hover:bg-[#101721]" onClick={onClearSelection}>
              {selectedKeys.size} selected - clear
            </button>
          )}
          <span>ctrl/shift-click select, right-click actions</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[760px] table-fixed border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#0b0f15] text-[9px] uppercase tracking-widest text-slate-500">
            <tr className="border-b border-[#20242c]">
              <th className="w-9 px-1 py-1 text-center">St</th>
              <th className="w-7 px-1 py-1" aria-label="Loaded charge icon" />
              <th className="px-1 py-1 text-left">Item</th>
              <th className="w-14 px-1 py-1 text-right">CPU</th>
              <th className="w-14 px-1 py-1 text-right">PG</th>
              <th className="w-24 px-1 py-1 text-left" title="Capacitor or fuel activation cost">Cap / Fuel</th>
              <th className="w-24 px-1 py-1 text-left" title="Calculated module range">Range</th>
              <th className="w-28 px-1 py-1 text-left" title="Tracking, missile application, or effect rate">Trk / App</th>
              <th className="w-32 px-1 py-1 text-left">Loaded</th>
              <th className="w-16 px-1 py-1 text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            <ShipModeRow stats={stats} onShipModeChange={onShipModeChange} />
            {SLOT_ORDER.map((slot) => {
              const slotStats = stats?.slots?.[slot];
              const turretHardpoints = stats?.hardpoints?.turret;
              const launcherHardpoints = stats?.hardpoints?.launcher;
              const rows = Math.max(Number(slotStats?.total || 0), modules[slot]?.length || 0, slot === "subsystem" ? 0 : 1);
              const canOverheatRack = (modules[slot] || []).some((_, index) => stats?.moduleRows?.[slot]?.[index]?.canOverheat);
              return (
                <Fragment key={slot}>
                  <tr key={`${slot}-header`} className="border-y border-[#20242c] bg-[#0d1016]">
                    <td colSpan={10} className={`px-2 py-1 text-[10px] uppercase tracking-widest ${slotTone[slot]}`}>
                      {slot !== "rig" && slot !== "subsystem" && (modules[slot]?.length || 0) > 0 && (
                        <span className="float-right">
                          <RackActionButtons slot={slot} onRackStateChange={onRackStateChange} canOverheat={canOverheatRack} />
                        </span>
                      )}
                      {SLOT_LABELS[slot]} <span className="font-mono text-slate-600">{modules[slot]?.length || 0}/{slotStats?.total ?? "-"}</span>
                      {slot === "high" && (
                        <span className="ml-3 font-mono text-[9px] text-slate-500" title="Turret and launcher hardpoints used / available">
                          T {countText(turretHardpoints?.used)}/{countText(turretHardpoints?.total)} · L {countText(launcherHardpoints?.used)}/{countText(launcherHardpoints?.total)}
                        </span>
                      )}
                    </td>
                  </tr>
                  {rows === 0 && (
                    <tr key={`${slot}-none`} className="border-b border-[#151922]">
                      <td colSpan={10} className="px-2 py-1 text-slate-600">None</td>
                    </tr>
                  )}
                  {Array.from({ length: rows }).map((_, index) => {
                    const module = modules[slot]?.[index];
                    if (!module) {
                      return (
                        <tr key={`${slot}-${index}-empty`} className="h-7 border-b border-[#151922] text-slate-700" onClick={onClearSelection}>
                          <td className="px-1 py-0.5 text-center align-middle" />
                          <td className="px-1 py-0.5" />
                          <td className="px-1 py-0.5 italic">Empty</td>
                          <td colSpan={7} />
                        </tr>
                      );
                    }
                    const calculated = moduleRow(stats, slot, index, module);
                    const attrs = module.fitting || typeDetails[module.typeId]?.fitting;
                    const price = rowPrice(module, stats);
                    const capOrFuel = displayCell(calculated, "capOrFuel");
                    const range = displayCell(calculated, "range");
                    const tracking = displayCell(calculated, "trackingOrApplication");
                    const charge = loadedCharge(module, calculated);
                    const moduleName = moduleDisplayName(module, calculated);
                    const baseName = calculated?.baseName || module.typeName || `Type ${module.typeId}`;
                    const mutationTitle = mutationTooltip(module, calculated);
                    const selected = selectedKeys.has(rowKey(slot, index));
                    const skillWarning = moduleSkillWarning(stats, slot, index, module);
                    const effectiveState = stateLabel(module, calculated);
                    const abyssalPlaceholder = isAbyssalPlaceholder(module, calculated);
                    const placeholderTitle = abyssalPlaceholderTooltip(module, calculated);
                    return (
                      <tr
                        key={`${slot}-${index}-${module.typeId}`}
                        className={`h-7 cursor-context-menu border-b border-[#151922] hover:bg-[#101721] ${
                          selected ? "bg-[#12304a]/70 outline outline-1 outline-[#53b6ff]/35" : ""
                        }`}
                        onClick={(event) => onModuleClick(event, slot, index, module)}
                        onContextMenu={(event) => onModuleContextMenu(event, slot, index, module)}
                      >
                        <td className="px-1 py-0.5 align-middle">
                          <div className="flex items-center justify-center gap-0.5">
                          <button
                            type="button"
                            className="flex h-4 w-4 items-center justify-center"
                            title={abyssalPlaceholder ? placeholderTitle : `Cycle module state: ${effectiveState}`}
                            disabled={abyssalPlaceholder}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (abyssalPlaceholder) return;
                              onModuleStateCycle?.(slot, index);
                            }}
                          >
                            <span className={`inline-block h-2 w-2 border ${stateTone(effectiveState)}`} />
                          </button>
                          {skillWarning && <MissingSkillIndicator warning={skillWarning} />}
                          </div>
                        </td>
                        <td className="px-1 py-0.5 text-center align-middle">
                          {charge.typeId ? (
                            <img
                              src={eveIcon(charge.typeId)}
                              alt=""
                              title={charge.name}
                              className="mx-auto h-5 w-5 border border-[#30343d] bg-black"
                              onError={(event) => {
                                event.currentTarget.style.display = "none";
                              }}
                            />
                          ) : null}
                        </td>
                        <td className="min-w-0 px-1 py-0.5">
                          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                            <img src={eveIcon(module.typeId)} alt="" className="h-5 w-5 shrink-0 border border-[#30343d] bg-black" />
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-1">
                                {(calculated?.mutation || module.mutation) && (
                                  <span className="shrink-0 text-[10px] text-[#b889ff]" title={mutationTitle}>◆</span>
                                )}
                                {abyssalPlaceholder && (
                                  <AlertTriangle size={11} className="shrink-0 text-amber-300" title={placeholderTitle} />
                                )}
                                <div className={`truncate leading-4 ${abyssalPlaceholder ? "text-amber-100" : "text-slate-100"}`} title={abyssalPlaceholder ? placeholderTitle : mutationTitle || moduleName}>{moduleName}</div>
                              </div>
                              <div className="truncate font-mono text-[9px] leading-3 text-slate-600" title={abyssalPlaceholder ? placeholderTitle : baseName}>
                                {abyssalPlaceholder ? "unresolved abyssal - not calculated" : (calculated?.mutation || module.mutation) ? `${effectiveState} · ${baseName}` : effectiveState}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-1 py-0.5 text-right font-mono text-slate-300">{fmt(calculated?.cpu ?? attrs?.cpu, 1)}</td>
                        <td className="px-1 py-0.5 text-right font-mono text-slate-300">{fmt(calculated?.powergrid ?? attrs?.powergrid, 1)}</td>
                        <td className="px-1 py-0.5 font-mono text-slate-500" title={capOrFuel.tooltip}>{capOrFuel.value || "-"}</td>
                        <td className="px-1 py-0.5 font-mono text-slate-500" title={range.tooltip}>{range.value || "-"}</td>
                        <td className="px-1 py-0.5 font-mono text-slate-500" title={tracking.tooltip}>{tracking.value || "-"}</td>
                        <td className="truncate px-1 py-0.5 text-slate-400" title={charge.name}>{charge.name}</td>
                        <td className="px-1 py-0.5 text-right font-mono text-slate-400">{price == null ? "-" : isk(price)}</td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
