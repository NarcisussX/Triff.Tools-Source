/*
 * Shared React component for Site Card.
 * Accepts props from pages and renders reusable UI without defining public routes.
 */

import { useState } from "react";
import WaveTable from "./WaveTable";
import { getWaveTotals } from "./WaveTable";

interface Ship {
  qty: number;
  name: string;
  dps: number;
  alpha: number;
  ehp: number;
  sig: number;
  orbit_velocity: number;
  distance: number;
  special: Record<string, number>;
}
const specialEffectIconMap: Record<string, string> = {
  scram: "/icons/specials/scram.png",
  web: "/icons/specials/web.png",
  neut: "/icons/specials/neut.png",
  rr: "/icons/specials/rr.png",
};

const specialSortOrder: Record<string, number> = {
  rr: 1,
  web: 2,
  scram: 3,
  neut: 4,
};
interface Wave {
  wave: string;
  ships: Ship[];
}

interface Site {
  site: string;
  type: "Combat" | "Data" | "Relic";
  class: string;
  blue_loot_isk?: number;
  waves: Wave[];
}

function getPeakStats(waves: Wave[]) {
  let peakDPS = 0;
  let peakNeuts = 0;
  let peakAlpha = 0;

  for (const wave of waves) {

    if (
      wave.wave === "Drifter Recon Battleship" ||
      wave.wave === "Drifter Response Battleship" ||
      wave.wave === "Upgraded Avengers"
    ) {
      continue;
    }
    const alpha = wave.ships.reduce((sum, s) => sum + s.alpha * s.qty, 0);
    peakAlpha = Math.max(peakAlpha, alpha);

    const dps = wave.ships.reduce((sum, s) => sum + s.dps * s.qty, 0);
    peakDPS = Math.max(peakDPS, dps);

    const totalNeuts = wave.ships.reduce((sum, s) => {
      const neutCount = (s.special as any)?.Neut || 0;
      return sum + neutCount * s.qty;
    }, 0);

    peakNeuts = Math.max(peakNeuts, totalNeuts);
  }

  return { peakDPS, peakNeuts, peakAlpha };
}

function getTotalSiteEHP(waves: Wave[]) {
  if (!Array.isArray(waves)) return null;
  try {
    const total = waves.reduce((sum, wave) => {
      if (!Array.isArray(wave?.ships)) return Number.NaN;
      return sum + getWaveTotals(wave.ships).totalEHP;
    }, 0);
    return Number.isFinite(total) && total > 0 ? total : null;
  } catch {
    return null;
  }
}

export default function SiteCard({
  site,
  referenceMode,
  tackleLabel,
  hasWebs,
  hasScrams,
}: {
  site: Site;
  referenceMode?: boolean;
  tackleLabel: string;
  hasWebs: boolean;
  hasScrams: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-[#303236] bg-[#05070b]/95 shadow-[0_0_18px_rgba(0,0,0,0.8)]">
      { }
      <div className="flex items-center justify-between px-3 py-2 bg-[#101219] border-b border-[#2c2f36]">
        <div>
          <h2 className="text-[13px] font-semibold text-slate-50">
            {site.site}
          </h2>
          <p className="text-[10px] text-slate-400">
            {site.class} • {site.type} Site
          </p>
        </div>
        <button
          className="px-3 py-1 text-[10px] uppercase tracking-widest border border-[#303236] bg-[#05070b] text-slate-200 hover:bg-[#0c0f16] rounded-sm"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Hide Waves" : "Show Waves"}
        </button>
      </div>

      { }
      {site.blue_loot_isk !== undefined &&
        !referenceMode &&
        (() => {
          const { peakDPS, peakNeuts, peakAlpha } = getPeakStats(site.waves);
          const totalSiteEHP = getTotalSiteEHP(site.waves);
          const blueLoot = Number(site.blue_loot_isk);
          const iskPerEHP =
            totalSiteEHP && Number.isFinite(blueLoot) ? blueLoot / totalSiteEHP : null;
          return (
            <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 border-b border-[#262933] bg-[#070910] text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-slate-200">
                  Blue Loot:{" "}
                  <span className="text-[#3bbf5a] font-semibold">
                    {site.blue_loot_isk.toLocaleString()} ISK
                  </span>
                </div>
                <div
                  className="border-l border-[#263140] pl-2 text-slate-400"
                  title="Adjusted blue loot divided by total displayed site EHP. A comparison metric, not literal ISK/hour."
                >
                  ISK/EHP:{" "}
                  <span className="font-mono font-semibold text-[#9fd3ff]">
                    {iskPerEHP !== null && Number.isFinite(iskPerEHP) ? iskPerEHP.toFixed(1) : "—"}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-[10px]">
                <div
                  className={`flex items-center gap-1 px-2 py-1 rounded-sm border border-[#406b37] bg-[#142317] text-[#3bbf5a] font-mono ${
                    !hasWebs && !hasScrams ? "font-bold" : ""
                  }`}
                >
                  {hasWebs && (
                    <img
                      src={specialEffectIconMap.web}
                      alt="web"
                      className="h-3.5 w-3.5"
                    />
                  )}
                  {hasScrams && (
                    <img
                      src={specialEffectIconMap.scram}
                      alt="scram"
                      className="h-3.5 w-3.5"
                    />
                  )}
                  <span>{tackleLabel}</span>
                </div>
                <div className="px-2 py-1 rounded-sm border border-[#5a2a32] bg-[#1b1114] text-[#ff9999]">
                  Peak DPS:{" "}
                  <span className="font-semibold">
                    {peakDPS.toLocaleString()}
                  </span>
                </div>
                <div className="px-2 py-1 rounded-sm border border-[#5a3a2a] bg-[#1b1511] text-[#ffb68a]">
                  Peak Alpha:{" "}
                  <span className="font-semibold">
                    {peakAlpha.toLocaleString()}
                  </span>
                </div>
                <div className="px-2 py-1 rounded-sm border border-[#335270] bg-[#101722] text-[#9fd3ff] flex items-center gap-1">
                  <span>Peak Neut:</span>
                  <img
                    src="/icons/specials/neut.png"
                    alt="neut"
                    className="w-4 h-4"
                  />
                  <span className="font-semibold">-{peakNeuts}</span> GJ/s
                </div>
              </div>
            </div>
          );
        })()}

      { }
      {expanded && (
        <div className="px-3 py-3 space-y-3">
          {site.waves.map((wave: any, idx: number) => (
            <div key={idx} className="space-y-1">
              {(() => {
                const { totalEHP, totalDPS, totalAlpha, totalSpecials } =
                  getWaveTotals(wave.ships);
                const sortedSpecials = Object.entries(totalSpecials).sort(
                  ([a], [b]) =>
                    (specialSortOrder[a.toLowerCase()] || 99) -
                    (specialSortOrder[b.toLowerCase()] || 99)
                );

                return (
                  <div className="flex flex-wrap items-center justify-between gap-3 px-2.5 py-1.5 bg-[#070910] border border-[#262933] text-[11px]">
                    <h3 className="font-semibold text-[12px] text-[#c1e5ff]">
                      {wave.wave}
                    </h3>
                    <div className="flex flex-wrap items-center gap-4 text-slate-300">
                      <div>
                        EHP:{" "}
                        <span className="text-slate-50">
                          {totalEHP.toLocaleString()}
                        </span>
                      </div>
                      <div>
                        DPS:{" "}
                        <span className="text-slate-50">
                          {totalDPS.toLocaleString()}
                        </span>
                      </div>
                      <div>
                        Alpha:{" "}
                        <span className="text-slate-50">
                          {totalAlpha.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {sortedSpecials.map(([effect, count], i) => {
                          const key = effect.toLowerCase();
                          const icon = specialEffectIconMap[key];
                          const label =
                            key === "neut" ? `-${count}` : `x${count}`;
                          return (
                            <div
                              key={i}
                              className="flex items-center gap-1 text-slate-200"
                            >
                              {icon && (
                                <img
                                  src={icon}
                                  alt={effect}
                                  className="w-4 h-4"
                                />
                              )}
                              <span className="text-[11px]">{label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {wave.triggerOnHack && (
                <div className="text-[11px] text-[#e2c56f] font-semibold px-2">
                  ⚠️ Triggered on Hack
                </div>
              )}

              <WaveTable ships={wave.ships} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
