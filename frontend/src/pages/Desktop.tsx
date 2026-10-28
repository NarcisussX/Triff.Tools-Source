/*
 * React page for /desktop.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import React, { useState } from "react";
import { Rnd } from "react-rnd";
import { Minus, RotateCcw, X } from "lucide-react";

import GasCalc from "./GasCalc";
import PiCalc from "./piCalc";
import RollingMass from "./RollingMass";
import WormholeSites from "./WormholeSites";
import OreCalculator from "./OreCalculator";
import TimestampTool from "./Timestamp";
import ReactionCalc from "./ReactionCalc";
import Appraisals from "./Appraisals";
import CompressedOrePlanner from "./CompressedOrePlanner";
import Industry from "./Industry";
import MarketBrowser from "./MarketBrowser";
import ManufacturingPlanner from "./ManufacturingPlanner";
import Fitting from "./Fitting";
import ItemBrowser from "./ItemBrowser";
import ItemDetail from "./ItemDetail";
import RoachFits from "./RoachFits";
import StructureAge from "./StructureAge";
import WormholeDatabase from "./WormholeDatabase";

type DesktopToolId =
  | "gas"
  | "pi"
  | "rolling"
  | "sites"
  | "ore"
  | "timestamp"
  | "wormholes"
  | "reaction"
  | "appraisals"
  | "compressedOre"
  | "industry"
  | "marketBrowser"
  | "manufacturing"
  | "fitting"
  | "items"
  | "roachfits"
  | "structureAge";

type ToolCategory = "industry" | "fitting" | "reference" | "market";

type ToolConfig = {
  id: DesktopToolId;
  title: string;
  component: React.ComponentType;
  category: ToolCategory;
  defaultWidth?: number;
  defaultHeight?: number;
};

const TOOL_CONFIG: Record<DesktopToolId, ToolConfig> = {
  industry: {
    id: "industry",
    title: "Industry Calculator",
    component: Industry,
    category: "industry",
    defaultWidth: 1150,
    defaultHeight: 900,
  },
  manufacturing: {
    id: "manufacturing",
    title: "BPC Copy Planner",
    component: ManufacturingPlanner,
    category: "industry",
    defaultWidth: 1150,
    defaultHeight: 900,
  },
  compressedOre: {
    id: "compressedOre",
    title: "Ore Reprocessor",
    component: CompressedOrePlanner,
    category: "industry",
    defaultWidth: 1150,
    defaultHeight: 900,
  },
  gas: {
    id: "gas",
    title: "Gas Calculator",
    component: GasCalc,
    category: "industry",
    defaultWidth: 1150,
    defaultHeight: 800,
  },
  ore: {
    id: "ore",
    title: "Ore Calculator",
    component: OreCalculator,
    category: "industry",
    defaultWidth: 1150,
    defaultHeight: 800,
  },
  pi: {
    id: "pi",
    title: "PI Profit Calculator",
    component: PiCalc,
    category: "industry",
    defaultWidth: 1150,
    defaultHeight: 800,
  },
  reaction: {
    id: "reaction",
    title: "Reaction Calculator",
    component: ReactionCalc,
    category: "industry",
    defaultWidth: 1150,
    defaultHeight: 800,
  },

  marketBrowser: {
    id: "marketBrowser",
    title: "Market Browser",
    component: MarketBrowser,
    category: "market",
    defaultWidth: 1556,
    defaultHeight: 900,
  },
  appraisals: {
    id: "appraisals",
    title: "ISKtimate",
    component: Appraisals,
    category: "market",
    defaultWidth: 1150,
    defaultHeight: 800,
  },

  fitting: {
    id: "fitting",
    title: "Fitting Tool",
    component: Fitting,
    category: "fitting",
    defaultWidth: 1500,
    defaultHeight: 900,
  },
  roachfits: {
    id: "roachfits",
    title: "C5 Ratting Fits",
    component: RoachFits,
    category: "fitting",
    defaultWidth: 1200,
    defaultHeight: 850,
  },
  items: {
    id: "items",
    title: "Item Browser",
    component: DesktopItemBrowserWindow,
    category: "fitting",
    defaultWidth: 1200,
    defaultHeight: 850,
  },
  structureAge: {
    id: "structureAge",
    title: "Structure Age Calculator",
    component: StructureAge,
    category: "reference",
    defaultWidth: 1150,
    defaultHeight: 800,
  },
  wormholes: {
    id: "wormholes",
    title: "Wormhole Database",
    component: WormholeDatabase,
    category: "reference",
    defaultWidth: 1320,
    defaultHeight: 900,
  },
  timestamp: {
    id: "timestamp",
    title: "Time Converter",
    component: TimestampTool,
    category: "reference",
    defaultWidth: 1000,
    defaultHeight: 742,
  },
  rolling: {
    id: "rolling",
    title: "Rolling Mass Helper",
    component: RollingMass,
    category: "reference",
    defaultWidth: 1150,
    defaultHeight: 800,
  },
  sites: {
    id: "sites",
    title: "Wormhole Sites",
    component: WormholeSites,
    category: "reference",
    defaultWidth: 1150,
    defaultHeight: 800,
  },
};

function DesktopItemBrowserWindow() {
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);

  if (selectedTypeId != null) {
    return (
      <ItemDetail
        typeID={selectedTypeId}
        onOpenItem={setSelectedTypeId}
        onBackToSearch={() => setSelectedTypeId(null)}
      />
    );
  }

  return <ItemBrowser onOpenItem={setSelectedTypeId} />;
}

type DesktopWindow = {
  windowId: number;
  toolId: DesktopToolId;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  refreshToken: number;
};

const Desktop: React.FC = () => {
  const [windows, setWindows] = useState<DesktopWindow[]>([]);

  const getNextZIndex = (wins: DesktopWindow[]) => {
    if (wins.length === 0) return 1;
    return wins.reduce((max, w) => (w.zIndex > max ? w.zIndex : max), 0) + 1;
  };

  const getNextWindowId = (wins: DesktopWindow[]) => {
    if (wins.length === 0) return 1;
    return wins.reduce(
      (max, w) => (w.windowId > max ? w.windowId : max),
      0
    ) + 1;
  };

  const openTool = (toolId: DesktopToolId) => {
    setWindows((prev) => {
      const config = TOOL_CONFIG[toolId];
      const viewportWidth =
        typeof window !== "undefined" ? window.innerWidth : 1600;
      const viewportHeight =
        typeof window !== "undefined" ? window.innerHeight : 900;

      const width =
        config.defaultWidth ?? Math.min(1050, viewportWidth - 260);
      const height =
        config.defaultHeight ?? Math.min(680, viewportHeight - 200);

      const nextZ = getNextZIndex(prev);
      const nextWindowId = getNextWindowId(prev);

      const newWindow: DesktopWindow = {
        windowId: nextWindowId,
        toolId,
        title: config.title,
        x: 220 + prev.length * 32,
        y: 110 + prev.length * 32,
        width,
        height,
        zIndex: nextZ,
        minimized: false,
        refreshToken: 0,
      };

      return [...prev, newWindow];
    });
  };

  const focusWindow = (windowId: number) => {
    setWindows((prev) => {
      const nextZ = getNextZIndex(prev);
      return prev.map((w) =>
        w.windowId === windowId ? { ...w, minimized: false, zIndex: nextZ } : w
      );
    });
  };

  const minimizeWindow = (windowId: number) => {
    setWindows((prev) =>
      prev.map((w) =>
        w.windowId === windowId ? { ...w, minimized: true } : w
      )
    );
  };

  const closeWindow = (windowId: number) => {
    setWindows((prev) => prev.filter((w) => w.windowId !== windowId));
  };

  const refreshWindow = (windowId: number) => {
    setWindows((prev) =>
      prev.map((w) =>
        w.windowId === windowId
          ? { ...w, refreshToken: w.refreshToken + 1 }
          : w
      )
    );
  };

  const updateWindowPosition = (windowId: number, x: number, y: number) => {
    setWindows((prev) =>
      prev.map((w) => (w.windowId === windowId ? { ...w, x, y } : w))
    );
  };

  const updateWindowSize = (
    windowId: number,
    width: number,
    height: number,
    x: number,
    y: number
  ) => {
    setWindows((prev) =>
      prev.map((w) =>
        w.windowId === windowId ? { ...w, width, height, x, y } : w
      )
    );
  };

  const allTools = Object.values(TOOL_CONFIG);
  const minimizedWindows = windows.filter((w) => w.minimized);

  const industryTools = allTools.filter((t) => t.category === "industry");
  const fittingTools = allTools.filter((t) => t.category === "fitting");
  const referenceTools = allTools.filter((t) => t.category === "reference");
  const marketTools = allTools.filter((t) => t.category === "market");

  const renderLauncherButton = (tool: ToolConfig) => {
    const toolWindows = windows.filter((w) => w.toolId === tool.id);
    const hasOpen = toolWindows.some((w) => !w.minimized);
    const hasMinimized = toolWindows.some((w) => w.minimized);

    const isOpen = hasOpen;
    const isMinimized = !hasOpen && hasMinimized;

    return (
      <button
        key={tool.id}
        onClick={() => openTool(tool.id)}
        className={[
          "w-full flex items-center justify-between border px-2 py-1.5 text-left text-[11px] leading-tight",
          "border-[#2c2f36] bg-[#05070b]/95 hover:bg-[#101219] transition-colors",
          isOpen
            ? "border-[#4ade80] shadow-[0_0_8px_rgba(74,222,128,0.7)]"
            : "",
          isMinimized ? "opacity-70" : "",
        ].join(" ")}
      >
        <span className="truncate text-slate-200">{tool.title}</span>
        {isOpen && (
          <span className="ml-1 h-1.5 w-1.5 rounded-full bg-[#4ade80] shadow-[0_0_6px_rgba(74,222,128,0.9)]" />
        )}
      </button>
    );
  };

  return (
    <div className="relative min-h-screen font-mono text-slate-100 text-[11px] leading-snug">
      <div className="relative z-10 flex h-screen">
        <aside className="flex flex-col w-56 border-r border-[#2c2f36] bg-[#05070b]/95">
          <div className="px-3 pt-3 pb-2 border-b border-[#2c2f36] bg-[#070910]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
              Neocom
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                Industry
              </div>
              <div className="space-y-1.5">
                {industryTools.map((tool) => renderLauncherButton(tool))}
              </div>
            </div>

            <div>
              <div className="mt-2 mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                Fitting
              </div>
              <div className="space-y-1.5">
                {fittingTools.map((tool) => renderLauncherButton(tool))}
              </div>
            </div>

            <div>
              <div className="mt-2 mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                Reference
              </div>
              <div className="space-y-1.5">
                {referenceTools.map((tool) => renderLauncherButton(tool))}
              </div>
            </div>

            <div>
              <div className="mt-2 mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                Market
              </div>
              <div className="space-y-1.5">
                {marketTools.map((tool) => renderLauncherButton(tool))}
              </div>
            </div>
          </div>
        </aside>

        <main className="relative flex-1 overflow-hidden">
          {minimizedWindows.length > 0 && (
            <div className="absolute inset-x-0 top-0 z-[2000] flex h-9 items-center gap-2 border-b border-[#2c2f36] bg-[#05070b]/98 px-2 shadow-[0_8px_18px_rgba(0,0,0,0.55)]">
              <div className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                Minimized
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-color:#334155_#05070b] [scrollbar-width:thin]">
                {minimizedWindows.map((w) => (
                  <div
                    key={w.windowId}
                    className="group flex h-7 min-w-[150px] max-w-[240px] shrink-0 items-center border border-[#3a2e1f] bg-[#120b05] text-[11px] text-slate-300 hover:border-[#f97316]/70 hover:bg-[#1b1007] hover:text-slate-100"
                  >
                    <button
                      type="button"
                      onClick={() => focusWindow(w.windowId)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left"
                      title={`Restore ${w.title}`}
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-[2px] bg-[#f97316] shadow-[0_0_6px_rgba(249,115,22,0.9)]" />
                      <span className="truncate">{w.title}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Close ${w.title}`}
                      onClick={() => closeWindow(w.windowId)}
                      className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center border border-transparent text-slate-600 hover:border-[#5e1e20] hover:bg-[#20080b] hover:text-red-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div
            className={[
              "absolute inset-x-0 bottom-0 desktop-area",
              minimizedWindows.length > 0 ? "top-9" : "top-0",
            ].join(" ")}
          >
            {windows.map((w) => {
              const ToolComponent = TOOL_CONFIG[w.toolId].component;
              const hidden = w.minimized;

              return (
                <Rnd
                  key={w.windowId}
                  bounds=".desktop-area"
                  size={{ width: w.width, height: w.height }}
                  position={{ x: w.x, y: w.y }}
                  onDragStop={(_e, d) => {
                    updateWindowPosition(w.windowId, d.x, d.y);
                  }}
                  onResizeStop={(_e, _dir, ref, _delta, position) => {
                    const width = parseInt(ref.style.width, 10);
                    const height = parseInt(ref.style.height, 10);
                    updateWindowSize(
                      w.windowId,
                      width,
                      height,
                      position.x,
                      position.y
                    );
                  }}
                  minWidth={700}
                  minHeight={420}
                  dragHandleClassName="desktop-window-titlebar"
                  enableResizing={!hidden}
                  disableDragging={hidden}
                  style={{
                    zIndex: w.zIndex,
                    display: hidden ? "none" : "block",
                  }}
                  onMouseDown={() => focusWindow(w.windowId)}
                >
                  <div className="flex h-full flex-col border border-[#3a3c40] bg-[#05070b]/96 shadow-[0_0_32px_rgba(0,0,0,0.95)]">
                    <div className="desktop-window-titlebar flex items-center justify-between px-3 py-1.5 bg-gradient-to-r from-[#111319] via-[#171920] to-[#242833] border-b border-[#3a3c40] cursor-move">
                      <div className="flex items-center gap-2" />
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-label={`Minimize ${w.title}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            minimizeWindow(w.windowId);
                          }}
                          className="inline-flex h-6 w-6 items-center justify-center border border-[#303236] bg-[#101219] text-slate-200 hover:bg-[#181c24]"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Refresh ${w.title}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            refreshWindow(w.windowId);
                          }}
                          className="inline-flex h-6 w-6 items-center justify-center border border-[#303236] bg-[#101219] text-slate-200 hover:bg-[#181c24]"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Close ${w.title}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            closeWindow(w.windowId);
                          }}
                          className="inline-flex h-6 w-6 items-center justify-center border border-[#5e1e20] bg-[#20080b] text-red-100 hover:bg-[#3a1013]"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-auto bg-[#05070b]/90">
                      <ToolComponent
                        key={`${w.toolId}-${w.windowId}-${w.refreshToken}`}
                      />
                    </div>
                  </div>
                </Rnd>
              );
            })}
          </div>
        </main>
      </div>
    </div>
  );
};

export default Desktop;
