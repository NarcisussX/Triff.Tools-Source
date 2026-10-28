import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { triffApiFetch } from "../../lib/webRuntime";
import type { FitMessage } from "./types";

type CenterViewMode = "fitting" | "graphs";

type GraphAxisDef = {
  key: string;
  handle: string;
  unit: string | null;
  label: string;
  mainInput: { handle: string; unit: string | null } | null;
  defaultRange?: [number | null, number | null] | null;
};

type GraphInputDef = {
  key: string;
  handle: string;
  unit: string | null;
  label: string;
  defaultValue: number | boolean | null;
  defaultRange?: [number | null, number | null] | null;
  kind: "number" | "checkbox";
};

type GraphVectorDef = {
  label: string;
  length: GraphInputDef;
  angle: GraphInputDef;
};

type GraphDef = {
  graphType: string;
  label: string;
  hasTargets: boolean;
  xDefs: GraphAxisDef[];
  yDefs: GraphAxisDef[];
  inputs: GraphInputDef[];
  vectors?: {
    source?: GraphVectorDef | null;
    target?: GraphVectorDef | null;
  };
};

type TargetProfile = {
  profileId: number;
  label: string;
  fullName: string;
  path?: string[];
};

type GraphMetadata = {
  ok: boolean;
  graphs: GraphDef[];
  targetProfiles: TargetProfile[];
  defaults?: {
    graphType?: string | null;
    targetProfileId?: number;
  };
  errors?: FitMessage[];
};

type GraphPoint = {
  x: number;
  y: number;
};

type GraphSeries = {
  id: string;
  label: string;
  colorIndex?: number;
  points: GraphPoint[];
};

type GraphResult = {
  ok: boolean;
  label?: string;
  axes?: {
    x?: { label?: string; unit?: string | null };
    y?: { label?: string; unit?: string | null };
  };
  points?: GraphPoint[];
  series?: GraphSeries[];
  errors?: FitMessage[];
  warnings?: FitMessage[];
};

type GraphProbe = {
  x: number;
  y: number;
  seriesLabel: string;
  colorIndex: number;
};

type OpenFitGraphTarget = {
  tabId: string;
  fitName: string;
  shipName: string | null;
  dirty: boolean;
  fitState: unknown;
};

export type SelectedTarget = {
  id: string;
  kind: "profile" | "open_fit";
  label: string;
  sublabel?: string;
  profileId?: number;
  tabId?: string;
};

type TargetNode = {
  key: string;
  label: string;
  sublabel?: string;
  children?: TargetNode[];
  target?: SelectedTarget;
};

export type GraphPanelState = {
  graphType?: string;
  xKey?: string;
  yKey?: string;
  selectedTargets?: SelectedTarget[];
  xMin?: string;
  xMax?: string;
  inputValues?: Record<string, number | boolean | null>;
  ignoreResists?: boolean;
  applyProjected?: boolean;
};

type Props = {
  calculationPayload: Record<string, unknown>;
  openFitTargets: OpenFitGraphTarget[];
  viewMode: CenterViewMode;
  onViewModeChange: (mode: CenterViewMode) => void;
  stateKey?: string;
  state?: GraphPanelState | null;
  onStateChange?: (state: GraphPanelState) => void;
  variant?: "desktop" | "mobile";
};

const inputClass =
  "h-6 border border-[#303236] bg-[#05070b] px-1.5 text-[10px] text-slate-100 outline-none focus:border-[#53b6ff]";
const sectionTitleClass = "mb-1 text-[9px] uppercase tracking-widest text-slate-500";
const seriesColors = ["#53b6ff", "#f59e0b", "#34d399", "#c084fc", "#f87171", "#eab308", "#38bdf8", "#f472b6"];

const idealTarget: SelectedTarget = {
  id: "profile:0",
  kind: "profile",
  profileId: 0,
  label: "Ideal Target",
};

function initialTargets(value?: SelectedTarget[] | null) {
  return value?.length ? value : [idealTarget];
}

function graphVectorInputs(graph: GraphDef | null | undefined) {
  const vectors = [graph?.vectors?.source, graph?.vectors?.target].filter(Boolean) as GraphVectorDef[];
  return vectors.flatMap((vector) => [vector.length, vector.angle]);
}

function defaultInputValues(graph: GraphDef | null | undefined, previous: Record<string, number | boolean | null> = {}) {
  const values: Record<string, number | boolean | null> = {};
  for (const input of graph?.inputs || []) {
    values[input.key] = previous[input.key] ?? input.defaultValue;
  }
  for (const input of graphVectorInputs(graph)) {
    values[input.key] = previous[input.key] ?? input.defaultValue;
  }
  return values;
}

function ViewTabs({ value, onChange }: { value: CenterViewMode; onChange: (mode: CenterViewMode) => void }) {
  return (
    <div className="flex h-full items-end gap-1">
      {(["fitting", "graphs"] as CenterViewMode[]).map((mode) => (
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

function axisKey(axis: GraphAxisDef | undefined | null) {
  return axis?.key || "";
}

function labelWithUnit(row: { label?: string; unit?: string | null }) {
  const label = row.label || "";
  return row.unit ? `${label} (${row.unit})` : label;
}

function fmt(value: number, decimals = 1) {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isTruthy(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function addProfileNode(nodes: TargetNode[], path: string[], profile: TargetProfile) {
  if (!path.length) {
    nodes.push({
      key: `profile:${profile.profileId}`,
      label: profile.label,
      sublabel: profile.profileId === 0 ? undefined : profile.fullName,
      target: {
        id: `profile:${profile.profileId}`,
        kind: "profile",
        profileId: profile.profileId,
        label: profile.label,
        sublabel: profile.fullName,
      },
    });
    return;
  }
  const [head, ...rest] = path;
  let node = nodes.find((row) => row.key === `group:${head}`);
  if (!node) {
    node = { key: `group:${head}`, label: head, children: [] };
    nodes.push(node);
  }
  addProfileNode(node.children || (node.children = []), rest, profile);
}

function buildProfileNodes(profiles: TargetProfile[]) {
  const nodes: TargetNode[] = [];
  for (const profile of profiles) {
    if (profile.profileId === 0) {
      addProfileNode(nodes, [], profile);
      continue;
    }
    addProfileNode(nodes, profile.path || [], profile);
  }
  const sortNodes = (rows: TargetNode[]): TargetNode[] => rows
    .map((row) => ({ ...row, children: row.children ? sortNodes(row.children) : undefined }))
    .sort((a, b) => {
      if (a.children?.length && !b.children?.length) return -1;
      if (!a.children?.length && b.children?.length) return 1;
      return a.label.localeCompare(b.label);
    });
  return sortNodes(nodes);
}

function buildTargetNodes(profiles: TargetProfile[], openFits: OpenFitGraphTarget[]): TargetNode[] {
  return [
    {
      key: "open-fits",
      label: "Open Fits",
      children: openFits.map((fit) => ({
        key: `fit:${fit.tabId}`,
        label: `${fit.fitName || "New Fit"}${fit.dirty ? " *" : ""}`,
        sublabel: fit.shipName || "No hull selected",
        target: {
          id: `fit:${fit.tabId}`,
          kind: "open_fit",
          tabId: fit.tabId,
          label: fit.fitName || "New Fit",
          sublabel: fit.shipName || "No hull selected",
        },
      })),
    },
    {
      key: "target-profiles",
      label: "Target Profiles",
      children: buildProfileNodes(profiles),
    },
  ];
}

function nodeAtPath(nodes: TargetNode[], path: string[]) {
  let current = { key: "root", label: "Targets", children: nodes } as TargetNode;
  for (const key of path) {
    const next = (current.children || []).find((node) => node.key === key);
    if (!next) return { key: "root", label: "Targets", children: nodes } as TargetNode;
    current = next;
  }
  return current;
}

function TargetMenuPopup({
  nodes,
  selectedTargets,
  onToggle,
  onClose,
  className = "",
  style,
}: {
  nodes: TargetNode[];
  selectedTargets: SelectedTarget[];
  onToggle: (target: SelectedTarget) => void;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const [path, setPath] = useState<string[]>([]);
  const selectedIds = useMemo(() => new Set(selectedTargets.map((target) => target.id)), [selectedTargets]);
  const current = nodeAtPath(nodes, path);

  return (
    <div className={`z-50 border border-[#344050] bg-[#070910] shadow-2xl shadow-black/80 ${className}`} style={style}>
      <div className="flex h-7 items-center justify-between border-b border-[#20242c] bg-[#101219] px-2 text-[10px] uppercase tracking-widest text-slate-400">
        {path.length ? (
          <button type="button" className="text-[#8bd3ff] hover:text-white" onClick={() => setPath((prev) => prev.slice(0, -1))}>
            {"< Back"}
          </button>
        ) : (
          <span>Add Target</span>
        )}
        <button type="button" className="text-slate-500 hover:text-slate-100" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {(current.children || []).map((node) => {
          const checked = node.target ? selectedIds.has(node.target.id) : false;
          return (
            <button
              key={node.key}
              type="button"
              className="flex w-full items-center gap-2 border-b border-[#151922] px-2 py-1.5 text-left text-[11px] text-slate-200 hover:bg-[#101721]"
              onClick={() => {
                if (node.children?.length) {
                  setPath((prev) => [...prev, node.key]);
                } else if (node.target) {
                  onToggle(node.target);
                }
              }}
            >
              {node.target ? (
                <span className={`h-3 w-3 border ${checked ? "border-[#53b6ff] bg-[#53b6ff]" : "border-[#465161] bg-[#05070b]"}`} />
              ) : (
                <span className="h-3 w-3 text-slate-500">{">"}</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{node.label}</span>
                {node.sublabel ? <span className="block truncate font-mono text-[9px] text-slate-600">{node.sublabel}</span> : null}
              </span>
              {node.children?.length ? <span className="text-slate-500">{">"}</span> : null}
            </button>
          );
        })}
        {!current.children?.length && (
          <div className="px-2 py-4 text-center text-[10px] uppercase tracking-widest text-slate-600">No targets</div>
        )}
      </div>
    </div>
  );
}

function AddTargetButton({
  nodes,
  selectedTargets,
  onToggle,
}: {
  nodes: TargetNode[];
  selectedTargets: SelectedTarget[];
  onToggle: (target: SelectedTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="h-6 border border-[#303236] bg-[#05070b] px-2 text-[10px] uppercase tracking-widest text-[#8bd3ff] hover:border-[#53b6ff]/60 hover:bg-[#101721]"
        onClick={() => setOpen((value) => !value)}
      >
        + Add Target
      </button>
      {open && (
        <TargetMenuPopup
          nodes={nodes}
          selectedTargets={selectedTargets}
          onToggle={onToggle}
          onClose={() => setOpen(false)}
          className="absolute right-0 top-7 w-72"
        />
      )}
    </div>
  );
}

function GraphTargetsPanel({
  selectedTargets,
  result,
  nodes,
  onToggle,
}: {
  selectedTargets: SelectedTarget[];
  result: GraphResult | null;
  nodes: TargetNode[];
  onToggle: (target: SelectedTarget) => void;
}) {
  const [contextPosition, setContextPosition] = useState<{ x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const targets = selectedTargets.length ? selectedTargets : [idealTarget];

  useEffect(() => {
    if (!contextPosition) return;
    const close = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setContextPosition(null);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [contextPosition]);

  function openContextMenu(event: ReactMouseEvent) {
    event.preventDefault();
    const width = 288;
    const height = 360;
    setContextPosition({
      x: clamp(event.clientX, 8, window.innerWidth - width - 8),
      y: clamp(event.clientY, 8, window.innerHeight - height - 8),
    });
  }

  return (
    <div ref={panelRef} className="mt-2 border border-[#20242c] bg-[#070910]" onContextMenu={openContextMenu}>
      <div className="flex h-7 items-center justify-between border-b border-[#20242c] bg-[#0b0f15] px-2">
        <div className="text-[9px] uppercase tracking-widest text-slate-500">Targets</div>
        <AddTargetButton nodes={nodes} selectedTargets={targets} onToggle={onToggle} />
      </div>
      <div className="max-h-28 overflow-y-auto">
        {targets.map((target, index) => {
          const series = result?.series?.[index];
          const label = series?.label || target.label;
          const sublabel = target.kind === "open_fit" ? target.sublabel : target.sublabel && target.sublabel !== label ? target.sublabel : "";
          const canRemove = targets.length > 1;
          return (
            <div key={`${target.id}-${index}`} className="grid grid-cols-[14px,minmax(0,1fr),auto] items-center gap-2 border-b border-[#151922] px-2 py-1.5 text-[11px]">
              <span className="h-2.5 w-2.5" style={{ backgroundColor: seriesColors[index % seriesColors.length] }} />
              <div className="min-w-0">
                <div className="truncate text-slate-200" title={label}>{label}</div>
                {sublabel ? <div className="truncate font-mono text-[9px] text-slate-600" title={sublabel}>{sublabel}</div> : null}
              </div>
              <button
                type="button"
                className="h-5 border border-[#303236] px-1.5 text-[10px] uppercase tracking-widest text-slate-500 hover:border-red-400/60 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-35"
                disabled={!canRemove}
                onClick={() => onToggle(target)}
                title={canRemove ? `Remove ${label}` : "At least one target is required"}
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
      {contextPosition && (
        <TargetMenuPopup
          nodes={nodes}
          selectedTargets={targets}
          onToggle={onToggle}
          onClose={() => setContextPosition(null)}
          className="fixed w-72"
          style={{ left: contextPosition.x, top: contextPosition.y }}
        />
      )}
    </div>
  );
}

function VectorControls({
  vector,
  inputValues,
  onChange,
}: {
  vector: GraphVectorDef;
  inputValues: Record<string, number | boolean | null>;
  onChange: (key: string, value: number | null) => void;
}) {
  return (
    <div className="border border-[#1b2230] bg-[#070910] p-1.5">
      <div className="mb-1 text-[9px] uppercase tracking-widest text-slate-500">{vector.label}</div>
      <div className="grid grid-cols-2 gap-2">
        {[vector.length, vector.angle].map((input) => (
          <label key={input.key} className="flex flex-col gap-1 text-[10px] text-slate-400">
            <span className="truncate" title={labelWithUnit(input)}>{labelWithUnit(input)}</span>
            <input
              className={inputClass}
              inputMode="decimal"
              value={String(inputValues[input.key] ?? "")}
              onChange={(event) => onChange(input.key, event.target.value === "" ? null : Number(event.target.value))}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function interpolateY(points: GraphPoint[], x: number) {
  const rows = (points || [])
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .slice()
    .sort((a, b) => a.x - b.x);
  if (!rows.length) return null;
  if (x <= rows[0].x) return rows[0].y;
  if (x >= rows[rows.length - 1].x) return rows[rows.length - 1].y;
  for (let index = 1; index < rows.length; index += 1) {
    const leftPoint = rows[index - 1];
    const rightPoint = rows[index];
    if (x > rightPoint.x) continue;
    const span = rightPoint.x - leftPoint.x;
    if (!span) return rightPoint.y;
    const ratio = (x - leftPoint.x) / span;
    return leftPoint.y + (rightPoint.y - leftPoint.y) * ratio;
  }
  return rows[rows.length - 1].y;
}

function GraphCanvas({ result, compact = false }: { result: GraphResult | null; compact?: boolean }) {
  const [probe, setProbe] = useState<GraphProbe | null>(null);
  const series = useMemo<GraphSeries[]>(() => {
    if (result?.series?.length) return result.series;
    if (result?.points?.length) return [{ id: "active", label: "Active Fit", points: result.points }];
    return [];
  }, [result]);
  useEffect(() => {
    setProbe(null);
  }, [result]);
  const allPoints = series.flatMap((row) => row.points || []).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!allPoints.length) {
    return (
      <div className={`flex ${compact ? "min-h-[260px]" : "min-h-[300px]"} items-center justify-center border border-[#20242c] bg-[#05070b] text-[11px] uppercase tracking-widest text-slate-600`}>
        No graph points
      </div>
    );
  }

  const width = compact ? 420 : 900;
  const height = compact ? 300 : 360;
  const left = compact ? 42 : 52;
  const right = compact ? 10 : 14;
  const top = 14;
  const bottom = compact ? 34 : 38;
  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(0, ...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const xSpan = maxX - minX || 1;
  const ySpan = maxY - minY || 1;
  const xScale = (value: number) => left + ((value - minX) / xSpan) * (width - left - right);
  const yScale = (value: number) => top + (1 - (value - minY) / ySpan) * (height - top - bottom);
  const tickCount = compact ? 4 : 5;
  const xTicks = Array.from({ length: tickCount }, (_, index) => minX + (xSpan * index) / (tickCount - 1));
  const yTicks = Array.from({ length: tickCount }, (_, index) => minY + (ySpan * index) / (tickCount - 1));
  const plotLeft = left;
  const plotRight = width - right;
  const plotTop = top;
  const plotBottom = height - bottom;
  const probeX = probe ? xScale(probe.x) : null;
  const probeY = probe ? yScale(probe.y) : null;
  const probeLabelX = probeX == null ? 0 : clamp(probeX + 5, plotLeft + 4, plotRight - 86);
  const probeValueY = probeY == null ? 0 : clamp(probeY - 4, plotTop + 24, plotBottom - 4);

  function handleGraphClick(event: ReactMouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const rawX = ((event.clientX - rect.left) / rect.width) * width;
    const rawY = ((event.clientY - rect.top) / rect.height) * height;
    const svgX = clamp(rawX, plotLeft, plotRight);
    const svgY = clamp(rawY, plotTop, plotBottom);
    const x = minX + ((svgX - plotLeft) / (plotRight - plotLeft)) * xSpan;
    const candidates = series
      .map((row, index) => {
        const y = interpolateY(row.points || [], x);
        if (y == null || !Number.isFinite(y)) return null;
        return {
          x,
          y,
          seriesLabel: row.label,
          colorIndex: index,
          pixelDistance: Math.abs(yScale(y) - svgY),
        };
      })
      .filter(Boolean) as (GraphProbe & { pixelDistance: number })[];
    candidates.sort((a, b) => a.pixelDistance - b.pixelDistance);
    const next = candidates[0];
    if (next) {
      setProbe({
        x: next.x,
        y: next.y,
        seriesLabel: next.seriesLabel,
        colorIndex: next.colorIndex,
      });
    }
  }

  return (
    <div className="border border-[#20242c] bg-[#05070b]">
      <svg viewBox={`0 0 ${width} ${height}`} className={`block ${compact ? "h-[300px]" : "h-[360px]"} w-full cursor-crosshair`} onClick={handleGraphClick}>
        <rect x="0" y="0" width={width} height={height} fill="#05070b" />
        {xTicks.map((tick) => {
          const x = xScale(tick);
          return <line key={`x-${tick}`} x1={x} x2={x} y1={top} y2={height - bottom} stroke="#17202b" strokeWidth="1" />;
        })}
        {yTicks.map((tick) => {
          const y = yScale(tick);
          return <line key={`y-${tick}`} x1={left} x2={width - right} y1={y} y2={y} stroke="#17202b" strokeWidth="1" />;
        })}
        <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} stroke="#334155" />
        <line x1={left} x2={left} y1={top} y2={height - bottom} stroke="#334155" />
        {series.map((row, index) => {
          const points = (row.points || []).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
          if (!points.length) return null;
          const path = points.map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${xScale(point.x).toFixed(2)} ${yScale(point.y).toFixed(2)}`).join(" ");
          return <path key={row.id || index} d={path} fill="none" stroke={seriesColors[index % seriesColors.length]} strokeWidth="2" />;
        })}
        {probe && probeX != null && probeY != null && (
          <g pointerEvents="none">
            <line x1={probeX} x2={probeX} y1={plotTop} y2={plotBottom} stroke="#94a3b8" strokeDasharray="2 3" strokeWidth="1" />
            <line x1={plotLeft} x2={plotRight} y1={probeY} y2={probeY} stroke="#475569" strokeDasharray="2 3" strokeWidth="0.8" opacity="0.55" />
            <circle cx={probeX} cy={probeY} r="3" fill={seriesColors[probe.colorIndex % seriesColors.length]} stroke="#dbeafe" strokeWidth="1" />
            <rect x={probeLabelX - 3} y={plotTop + 2} width="82" height="16" fill="#05070b" opacity="0.85" />
            <text x={probeLabelX} y={plotTop + 14} fill="#dbeafe" fontSize="11">
              {fmt(probe.x, compact ? 0 : 1)} {result?.axes?.x?.unit || ""}
            </text>
            <rect x={clamp(probeX + 5, plotLeft + 4, plotRight - 86)} y={probeValueY - 13} width="82" height="16" fill="#05070b" opacity="0.85" />
            <text x={clamp(probeX + 8, plotLeft + 7, plotRight - 83)} y={probeValueY} fill="#dbeafe" fontSize="11">
              {fmt(probe.y, compact ? 0 : 1)}
            </text>
          </g>
        )}
        {xTicks.map((tick) => (
          <text key={`xt-${tick}`} x={xScale(tick)} y={height - 12} textAnchor="middle" fill="#718096" fontSize={compact ? "11" : "10"}>
            {fmt(tick, 0)}
          </text>
        ))}
        {yTicks.map((tick) => (
          <text key={`yt-${tick}`} x={left - 7} y={yScale(tick) + 3} textAnchor="end" fill="#718096" fontSize={compact ? "11" : "10"}>
            {fmt(tick, 0)}
          </text>
        ))}
      </svg>
      {probe && (
        <div className="flex items-center justify-between gap-2 border-t border-[#20242c] px-2 py-1 font-mono text-[10px] text-slate-400">
          <span className="truncate">
            Probe: {fmt(probe.x, 2)} {result?.axes?.x?.unit || ""} / {fmt(probe.y, 2)} {result?.axes?.y?.unit || ""}
          </span>
          <span className="truncate text-slate-600">{probe.seriesLabel}</span>
        </div>
      )}
      {series.length > 1 && (
        <div className="flex flex-wrap gap-2 border-t border-[#20242c] px-2 py-1">
          {series.map((row, index) => (
            <span key={row.id || index} className="flex items-center gap-1 text-[10px] text-slate-400">
              <span className="h-2 w-4" style={{ backgroundColor: seriesColors[index % seriesColors.length] }} />
              {row.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FittingGraphsPanel({
  calculationPayload,
  openFitTargets,
  viewMode,
  onViewModeChange,
  stateKey,
  state,
  onStateChange,
  variant = "desktop",
}: Props) {
  const [metadata, setMetadata] = useState<GraphMetadata | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [graphType, setGraphType] = useState(state?.graphType || "");
  const [xKey, setXKey] = useState(state?.xKey || "");
  const [yKey, setYKey] = useState(state?.yKey || "");
  const [selectedTargets, setSelectedTargets] = useState<SelectedTarget[]>(() => initialTargets(state?.selectedTargets));
  const [xMin, setXMin] = useState(state?.xMin || "");
  const [xMax, setXMax] = useState(state?.xMax || "");
  const [inputValues, setInputValues] = useState<Record<string, number | boolean | null>>(state?.inputValues || {});
  const [ignoreResists, setIgnoreResists] = useState(state?.ignoreResists ?? false);
  const [applyProjected, setApplyProjected] = useState(state?.applyProjected ?? true);
  const [result, setResult] = useState<GraphResult | null>(null);
  const [loading, setLoading] = useState(false);
  const lastStateKey = useRef<string | undefined>(stateKey);

  useEffect(() => {
    let cancelled = false;
    triffApiFetch("/api/fitting/graphs")
      .then((response) => response.json())
      .then((body: GraphMetadata) => {
        if (cancelled) return;
        setMetadata(body);
        setMetadataError(body.ok ? null : body.errors?.[0]?.message || "Could not load graph definitions.");
        const defaultGraph = body.defaults?.graphType || body.graphs?.[0]?.graphType || "";
        setGraphType((current) => current || defaultGraph);
      })
      .catch((err) => {
        if (!cancelled) setMetadataError(err?.message || "Could not load graph definitions.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (lastStateKey.current === stateKey) return;
    lastStateKey.current = stateKey;
    setGraphType(state?.graphType || metadata?.defaults?.graphType || metadata?.graphs?.[0]?.graphType || "");
    setXKey(state?.xKey || "");
    setYKey(state?.yKey || "");
    setSelectedTargets(initialTargets(state?.selectedTargets));
    setXMin(state?.xMin || "");
    setXMax(state?.xMax || "");
    setInputValues(state?.inputValues || {});
    setIgnoreResists(state?.ignoreResists ?? false);
    setApplyProjected(state?.applyProjected ?? true);
    setResult(null);
  }, [metadata?.defaults?.graphType, metadata?.graphs, state, stateKey]);

  useEffect(() => {
    onStateChange?.({
      graphType,
      xKey,
      yKey,
      selectedTargets,
      xMin,
      xMax,
      inputValues,
      ignoreResists,
      applyProjected,
    });
  }, [applyProjected, graphType, ignoreResists, inputValues, selectedTargets, xKey, xMax, xMin, yKey]);

  const graph = useMemo(() => metadata?.graphs?.find((row) => row.graphType === graphType) || metadata?.graphs?.[0] || null, [metadata, graphType]);
  const xDef = useMemo(() => graph?.xDefs.find((axis) => axis.key === xKey) || graph?.xDefs[0] || null, [graph, xKey]);
  const yDef = useMemo(() => graph?.yDefs.find((axis) => axis.key === yKey) || graph?.yDefs[0] || null, [graph, yKey]);
  const mainInputHandle = xDef?.mainInput?.handle || "";
  const vectorInputKeys = useMemo(() => new Set(graphVectorInputs(graph).map((input) => input.key)), [graph]);
  const editableInputs = useMemo(() => (
    (graph?.inputs || []).filter((input) => input.handle !== mainInputHandle && !vectorInputKeys.has(input.key))
  ), [graph, mainInputHandle, vectorInputKeys]);
  const targetNodes = useMemo(() => buildTargetNodes(metadata?.targetProfiles || [], openFitTargets), [metadata?.targetProfiles, openFitTargets]);
  const hasShip = Boolean((calculationPayload.targetFit as { shipTypeId?: number } | undefined)?.shipTypeId || (calculationPayload as { shipTypeId?: number }).shipTypeId);
  const movementVectors = useMemo(() => (
    [graph?.vectors?.source, graph?.vectors?.target].filter(Boolean) as GraphVectorDef[]
  ), [graph]);

  useEffect(() => {
    if (!graph) return;
    const nextX = graph.xDefs[0];
    const nextY = graph.yDefs[0];
    setXKey((current) => graph.xDefs.some((axis) => axis.key === current) ? current : axisKey(nextX));
    setYKey((current) => graph.yDefs.some((axis) => axis.key === current) ? current : axisKey(nextY));
    setInputValues((current) => defaultInputValues(graph, current));
  }, [graph?.graphType]);

  useEffect(() => {
    if (!xDef) return;
    const range = xDef.defaultRange || [0, 1];
    setXMin((current) => current || String(range[0] ?? 0));
    setXMax((current) => current || String(range[1] ?? 1));
  }, [xDef?.key]);

  useEffect(() => {
    const openIds = new Set(openFitTargets.map((target) => `fit:${target.tabId}`));
    setSelectedTargets((prev) => {
      const filtered = prev.filter((target) => target.kind !== "open_fit" || openIds.has(target.id));
      return filtered.length ? filtered : [idealTarget];
    });
  }, [openFitTargets]);

  function toggleTarget(target: SelectedTarget) {
    setSelectedTargets((prev) => {
      const exists = prev.some((row) => row.id === target.id);
      if (exists) {
        const next = prev.filter((row) => row.id !== target.id);
        return next.length ? next : prev;
      }
      return [...prev, target];
    });
  }

  const graphTargets = useMemo(() => {
    if (!graph?.hasTargets) return [];
    return selectedTargets.map((target) => {
      if (target.kind === "open_fit") {
        const openFit = openFitTargets.find((row) => `fit:${row.tabId}` === target.id);
        if (!openFit) return null;
        return {
          ...target,
          fitName: openFit.fitName,
          shipName: openFit.shipName,
          dirty: openFit.dirty,
          fitState: openFit.fitState,
          enabled: true,
        };
      }
      return { ...target, enabled: true };
    }).filter(Boolean);
  }, [graph?.hasTargets, openFitTargets, selectedTargets]);

  useEffect(() => {
    if (!graph || !xDef || !yDef || !hasShip) {
      setResult(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      const inputs: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(inputValues)) {
        inputs[key] = value;
      }
      triffApiFetch("/api/fitting/graphs/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...calculationPayload,
          graphType: graph.graphType,
          x: { key: xDef.key, handle: xDef.handle, unit: xDef.unit, range: [Number(xMin), Number(xMax)] },
          y: { key: yDef.key, handle: yDef.handle, unit: yDef.unit },
          graphTargets,
          inputs,
          options: {
            ignoreResists,
            applyProjected,
          },
        }),
        signal: controller.signal,
      })
        .then((response) => response.json())
        .then((body: GraphResult) => setResult(body))
        .catch((err) => {
          if (err?.name !== "AbortError") {
            setResult({ ok: false, errors: [{ code: "graph_request_failed", message: err?.message || "Graph request failed." }] });
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [applyProjected, calculationPayload, graph, graphTargets, hasShip, ignoreResists, inputValues, xDef, xMax, xMin, yDef]);

  const error = metadataError || result?.errors?.[0]?.message || null;
  const isMobile = variant === "mobile";

  return (
    <section className={`${isMobile ? "h-full" : ""} flex min-h-0 flex-col overflow-hidden border border-[#2c2f36] bg-[#070910]`}>
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-[#2c2f36] bg-[#101219] px-2">
        {isMobile ? (
          <div className="text-[10px] font-semibold uppercase tracking-widest text-[#8bd3ff]">Graphs</div>
        ) : (
          <ViewTabs value={viewMode} onChange={onViewModeChange} />
        )}
        <div className="font-mono text-[10px] text-slate-500">{loading ? "plotting" : "pyfa graph data"}</div>
      </div>

      <div className={`${isMobile ? "overflow-y-auto overscroll-contain p-1.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))]" : "overflow-auto p-2"} min-h-0 flex-1`}>
        {!hasShip ? (
          <div className={`flex h-full ${isMobile ? "min-h-[220px]" : "min-h-[260px]"} items-center justify-center border border-[#20242c] bg-[#05070b] text-[11px] uppercase tracking-widest text-slate-600`}>
            Select a hull to graph this fit.
          </div>
        ) : (
          <div className={`${isMobile ? "flex min-h-0 flex-col" : "grid min-h-full grid-rows-[auto,minmax(0,1fr)]"} gap-2`}>
            <div className={`${isMobile ? "grid grid-cols-[auto,minmax(0,1fr)] p-1.5" : "flex p-2"} items-center gap-2 border border-[#20242c] bg-[#0b0f15]`}>
              <label className="text-[9px] uppercase tracking-widest text-slate-500">Graph</label>
              <select
                className={`${inputClass} ${isMobile ? "w-full" : "w-64 max-w-full"}`}
                value={graph?.graphType || ""}
                onChange={(event) => {
                  setGraphType(event.target.value);
                  setXKey("");
                  setYKey("");
                  setXMin("");
                  setXMax("");
                  setInputValues({});
                  setSelectedTargets([idealTarget]);
                }}
              >
                {(metadata?.graphs || []).map((row) => <option key={row.graphType} value={row.graphType}>{row.label}</option>)}
              </select>
            </div>

            <div className={`${isMobile ? "flex min-h-0 flex-col" : "grid min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr),250px]"} gap-2`}>
              <div className="min-w-0">
                <GraphCanvas result={result} compact={isMobile} />
                {graph?.hasTargets ? (
                  <GraphTargetsPanel selectedTargets={selectedTargets} result={result} nodes={targetNodes} onToggle={toggleTarget} />
                ) : null}
                <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-slate-500">
                  <span>{labelWithUnit(result?.axes?.x || xDef || { label: "X", unit: null })}</span>
                  <span>{labelWithUnit(result?.axes?.y || yDef || { label: "Y", unit: null })}</span>
                </div>
                {error && (
                  <div className="mt-2 border border-amber-500/30 bg-amber-950/20 px-2 py-1.5 text-[11px] text-amber-100">{error}</div>
                )}
              </div>

              <div className={`${isMobile ? "overflow-visible pb-2" : "min-h-0 overflow-auto"} border border-[#20242c] bg-[#0b0f15] p-2`}>
                {movementVectors.length ? (
                  <div className="mb-3">
                    <div className={sectionTitleClass}>Movement</div>
                    <div className="space-y-2">
                      {movementVectors.map((vector) => (
                        <VectorControls
                          key={vector.label}
                          vector={vector}
                          inputValues={inputValues}
                          onChange={(key, value) => setInputValues((prev) => ({ ...prev, [key]: value }))}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mb-3 border-t border-[#20242c] pt-2">
                  <div className={sectionTitleClass}>Axes</div>
                  <label className="mb-2 flex flex-col gap-1 text-[10px] text-slate-400">
                    X Axis
                    <select
                      className={inputClass}
                      value={xDef?.key || ""}
                      onChange={(event) => {
                        setXKey(event.target.value);
                        setXMin("");
                        setXMax("");
                      }}
                    >
                      {(graph?.xDefs || []).map((axis) => <option key={axis.key} value={axis.key}>{labelWithUnit(axis)}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-[10px] text-slate-400">
                    Y Axis
                    <select className={inputClass} value={yDef?.key || ""} onChange={(event) => setYKey(event.target.value)}>
                      {(graph?.yDefs || []).map((axis) => <option key={axis.key} value={axis.key}>{labelWithUnit(axis)}</option>)}
                    </select>
                  </label>
                </div>

                <div className="mb-3 border-t border-[#20242c] pt-2">
                  <div className={sectionTitleClass}>Range</div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 text-[10px] text-slate-400">
                      Min
                      <input className={inputClass} inputMode="decimal" value={xMin} onChange={(event) => setXMin(event.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1 text-[10px] text-slate-400">
                      Max
                      <input className={inputClass} inputMode="decimal" value={xMax} onChange={(event) => setXMax(event.target.value)} />
                    </label>
                  </div>
                </div>

                <div className="mb-3 border-t border-[#20242c] pt-2">
                  <div className={sectionTitleClass}>Inputs</div>
                  <div className="space-y-2">
                    {editableInputs.map((input) => (
                      <label key={input.key} className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                        <span className="min-w-0 truncate" title={labelWithUnit(input)}>{labelWithUnit(input)}</span>
                        {input.kind === "checkbox" ? (
                          <input
                            type="checkbox"
                            checked={isTruthy(inputValues[input.key])}
                            onChange={(event) => setInputValues((prev) => ({ ...prev, [input.key]: event.target.checked }))}
                          />
                        ) : (
                          <input
                            className={`${inputClass} w-20`}
                            inputMode="decimal"
                            value={String(inputValues[input.key] ?? "")}
                            onChange={(event) => setInputValues((prev) => ({ ...prev, [input.key]: event.target.value === "" ? null : Number(event.target.value) }))}
                          />
                        )}
                      </label>
                    ))}
                    {!editableInputs.length && (
                      <div className="text-[10px] uppercase tracking-widest text-slate-600">No extra inputs</div>
                    )}
                  </div>
                </div>

                <div className="border-t border-[#20242c] pt-2">
                  <div className={sectionTitleClass}>Options</div>
                  <label className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                    Ignore resists
                    <input type="checkbox" checked={ignoreResists} onChange={(event) => setIgnoreResists(event.target.checked)} />
                  </label>
                  <label className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                    Apply projected
                    <input type="checkbox" checked={applyProjected} onChange={(event) => setApplyProjected(event.target.checked)} />
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
