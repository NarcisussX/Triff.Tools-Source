/*
 * React page for /wormhole-sites.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import { useEffect, useState } from "react";
import SiteCard from "../components/SiteCard";
import { ToolChrome, ToolEmptyState } from "../components/tool-ui";

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

interface Wave {
  wave: string;
  ships: Ship[];
}

interface Site {
  site: string;
  type: "Combat" | "Data" | "Relic";
  blue_loot_isk?: number;
  waves: Wave[];
  class: string;
}

const classKeys = ["C1", "C2", "C3", "C4", "C5", "C6"];
const types = ["Combat", "Data", "Relic"];
const fileMap = [
  { path: "c1_combat_sites_clean.json", class: "C1", type: "Combat" },
  { path: "c1_datarelic_sites_clean.json", class: "C1", type: "Mixed" },
  { path: "c2_combat_sites_clean.json", class: "C2", type: "Combat" },
  { path: "c2_datarelic_sites_clean.json", class: "C2", type: "Mixed" },
  { path: "c3_combat_sites_clean.json", class: "C3", type: "Combat" },
  { path: "c3_datarelic_sites_clean.json", class: "C3", type: "Mixed" },
  { path: "c4_combat_sites_clean.json", class: "C4", type: "Combat" },
  { path: "c4_datarelic_sites_clean.json", class: "C4", type: "Mixed" },
  { path: "c5_combat_sites_clean.json", class: "C5", type: "Combat" },
  { path: "c5_datarelic_sites_clean.json", class: "C5", type: "Mixed" },
  { path: "c6_combat_sites_clean.json", class: "C6", type: "Combat" },
  { path: "c6_datarelic_sites_clean.json", class: "C6", type: "Mixed" },
];

const avengerWaveC5 = {
  wave: "Upgraded Avengers",
  ships: [
    {
      qty: 3,
      name: "Upgraded Avenger",
      dps: 1210,
      alpha: 0,
      ehp: 1400000,
      sig: 30000,
      orbit_velocity: "300 m/s",
      distance: "20km",
      special: { Scram: 15, Neut: 75, Web: 1 },
    },
  ],
};

const avengerWaveC6 = {
  wave: "Upgraded Avengers",
  ships: [
    {
      qty: 4,
      name: "Upgraded Avenger",
      dps: 1210,
      alpha: 0,
      ehp: 1400000,
      sig: 30000,
      orbit_velocity: "300 m/s",
      distance: "20km",
      special: { Scram: 15, Neut: 75, Web: 1 },
    },
  ],
};

export default function WormholeSites() {
  const [sites, setSites] = useState<Site[]>([]);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<string>("C5");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [showMiniDrifter, setShowMiniDrifter] = useState(false);
  const [showBigDrifter, setShowBigDrifter] = useState(false);
  const [referenceMode, setReferenceMode] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      const all: Site[] = [];

      for (const entry of fileMap) {
        try {
          const res = await fetch(`/api/data/${entry.path}`);
          const json = await res.json();
          const typed = json.map((s: Site) => ({
            ...s,
            class: entry.class,
            type: s.type || (entry.type === "Mixed" ? "Data" : "Combat"),
          }));
          all.push(...typed);
        } catch (err) {
          console.error(`[PVE_SITES]: Failed to load ${entry.path}`, err);
        }
      }

      setSites(all);
    };

    fetchData();
  }, []);

  const filtered = sites.filter((s) => {
    const matchesClass = !classFilter || s.class === classFilter;
    const matchesType = !typeFilter || s.type === typeFilter;
    const matchesSearch = s.site.toLowerCase().includes(search.toLowerCase());
    return matchesClass && matchesType && matchesSearch;
  });

  return (
    <div className="tt-tool-v2 tt2-reference-page tt2-wormhole-sites min-h-screen text-slate-100 leading-snug">
      <div className="mx-auto max-w-[1320px] px-2 py-3 sm:px-4 sm:py-6">
        <div className="tt2-window">
          <ToolChrome
            section="Wormholes & Exploration"
            title="Wormhole Sites"
            badge="Drifters out"
            context="Wormhole Sites"
            status="Market prices online"
            contextAside={<span>{filtered.length} matching sites</span>}
          />

          { }
          <div className="space-y-4 p-2 sm:p-3">
            { }
            <div className="border border-[#262933] bg-[#05070b]/90 px-3 py-3 sm:px-4">
              <p className="text-[12px] text-slate-300 mb-1">
                Browse known{" "}
                <span className="text-slate-100">
                  wormhole combat and data/relic sites
                </span>{" "}
                by class, type and name. Each site shows wave breakdowns, total
                EHP / DPS / alpha and special effects.
              </p>
              <p className="text-[12px] text-slate-400 mb-1">
                Use the{" "}
                <span className="text-slate-100">Drifter wave toggles</span> to
                inject Recon/Response battleships into C5–C6 sites and adjust
                blue loot.{" "}
                <span className="text-slate-100">Reference mode</span> trims
                waves down to triggers and Drifters for fast in-fleet calls.
              </p>
              <p className="text-[12px] text-slate-400">
                Site rows expand to show detailed NPC tables. Wave headers
                display total EHP, DPS, alpha and aggregated tackle/utility.
              </p>
            </div>

            { }
            <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              { }
              <fieldset className="overflow-hidden border border-[#2c2f36] bg-[#070910]">
                <legend className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300">
                  <span>Filters</span>
                  <div className="flex items-center gap-2">
                    <button
                      className={`px-2 py-0.5 border text-[10px] uppercase tracking-widest rounded-sm transition-colors ${
                        referenceMode
                          ? "bg-[#8a4b1b] border-[#d68a3a] text-slate-50"
                          : "bg-[#05070b] border-[#303236] text-slate-300 hover:bg-[#0c0f16]"
                      }`}
                      onClick={() => setReferenceMode((v) => !v)}
                      type="button"
                    >
                      Trigger-Only Toggle
                    </button>
                    { }
                    <div className="relative group flex items-center">
                      <span
                        className="inline-flex items-center justify-center w-4 h-4 rounded-sm border border-[#4b9cff]/60 bg-[#0b111a] text-[10px] font-bold leading-none text-[#c1e5ff] group-hover:border-[#7fc5ff] group-hover:text-white cursor-help translate-y-[1px]"
                        aria-hidden="true"
                      >
                        ?
                      </span>
                      <div
                        className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 hidden group-hover:block w-64 max-w-xs px-2 py-1 rounded-sm border border-[#262933] shadow-lg bg-[#05070b]/95 text-[11px] leading-snug text-slate-100 whitespace-normal"
                        role="tooltip"
                      >
                        <b>Reference mode:</b> only shows trigger and DTA ships
                        in each wave plus Upgraded Avengers and Drifter waves.
                        Hides all other NPCs and stats for quick in-site calls.
                      </div>
                    </div>
                  </div>
                </legend>
                <div className="space-y-3 p-3">
                  <div className="grid grid-cols-3 gap-1 sm:flex sm:flex-wrap">
                    {classKeys.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          setClassFilter((prev) => (prev === c ? null : c))
                        }
                        className={`min-w-0 px-3 py-1 rounded-sm border text-[11px] uppercase tracking-widest transition-colors ${
                          classFilter === c
                            ? "bg-[#1b2433] border-[#46b2ff] text-[#e5f3ff] shadow-[0_0_8px_rgba(70,178,255,0.4)]"
                            : "bg-[#05070b] border-[#303236] text-slate-300 hover:bg-[#0c0f16]"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
                    <label className="grid gap-1">
                      <span className="text-[10px] uppercase tracking-widest text-slate-400">
                        Type
                      </span>
                      <select
                        className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                        value={typeFilter ?? ""}
                        onChange={(e) =>
                          setTypeFilter(e.target.value || null)
                        }
                      >
                        <option value="">All Types</option>
                        {types.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="grid min-w-0 gap-1">
                      <span className="text-[10px] uppercase tracking-widest text-slate-400">
                        Search
                      </span>
                      <input
                        type="text"
                        className="flex-1 bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                        placeholder="Search site name..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                  </div>
                </div>
              </fieldset>

              { }
              <fieldset className="overflow-hidden border border-[#2c2f36] bg-[#070910]">
                <legend className="px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300">
                  Drifter Waves
                </legend>
                <div className="grid gap-2 p-3">
                  <button
                    type="button"
                    className={`w-full px-3 py-1.5 rounded-sm border text-[11px] font-medium transition-colors ${
                      showMiniDrifter
                        ? "bg-[#1b2433] border-[#46b2ff] text-[#e5f3ff] shadow-[0_0_8px_rgba(70,178,255,0.4)]"
                        : "bg-[#05070b] border-[#303236] text-slate-300 hover:bg-[#0c0f16]"
                    }`}
                    onClick={() => {
                      setShowMiniDrifter(!showMiniDrifter);
                      if (!showMiniDrifter) setShowBigDrifter(false);
                    }}
                  >
                    Drifter Recon Battleship (Mini Drifter)
                  </button>
                  <button
                    type="button"
                    className={`w-full px-3 py-1.5 rounded-sm border text-[11px] font-medium transition-colors ${
                      showBigDrifter
                        ? "bg-[#1b2433] border-[#46b2ff] text-[#e5f3ff] shadow-[0_0_8px_rgba(70,178,255,0.4)]"
                        : "bg-[#05070b] border-[#303236] text-slate-300 hover:bg-[#0c0f16]"
                    }`}
                    onClick={() => {
                      setShowBigDrifter(!showBigDrifter);
                      if (!showBigDrifter) setShowMiniDrifter(false);
                    }}
                  >
                    Drifter Response Battleship (Big Drifter)
                  </button>
                  <p className="text-[10px] text-slate-500 leading-snug">
                    Applies only to C5–C6 sites. Adds optional waves and{" "}
                    <span className="text-slate-100">extra blue loot</span>{" "}
                    based on configuration.
                  </p>
                </div>
              </fieldset>
            </div>

            { }
            <div className="space-y-3">
              {filtered.length === 0 ? (
                <ToolEmptyState title="No matching sites">
                  Clear a class filter or broaden the site-name search.
                </ToolEmptyState>
              ) : null}
              {filtered.map((site, i) => {
                let preWave: any[] = [];
                let extraWaves: any[] = [];
                let extraLoot = 0;

                if (site.class === "C5" || site.class === "C6") {
                  if (showBigDrifter) {
                    preWave.push(
                      site.class === "C5" ? avengerWaveC5 : avengerWaveC6
                    );
                    extraLoot += site.class === "C5" ? 150000000 : 200000000;
                  }
                  if (site.type === "Combat") {
                    if (showMiniDrifter) {
                      extraWaves.push({
                        wave: "Drifter Recon Battleship",
                        ships: [
                          {
                            qty: 1,
                            name: "Drifter Recon Battleship",
                            dps: 1067,
                            alpha: 0,
                            ehp: 770000,
                            sig: 25000,
                            orbit_velocity: "400 m/s",
                            distance: "13km",
                            special: { Scram: 20, Neut: 100, Web: 1 },
                          },
                        ],
                      });
                      extraLoot += 100000000;
                    }

                    if (showBigDrifter) {
                      extraWaves.push({
                        wave: "Drifter Response Battleship",
                        ships: [
                          {
                            qty: 1,
                            name: "Drifter Response Battleship",
                            dps: 1600,
                            alpha: 0,
                            ehp: 2350000,
                            sig: 25000,
                            orbit_velocity: "400 m/s",
                            distance: "13km",
                            special: { Scram: 20, Neut: 200, Web: 1 },
                          },
                        ],
                      });
                      extraLoot += 300000000;
                    }
                  }
                }

                let allWaves: any[] = [...preWave, ...site.waves, ...extraWaves];
                const hasWebs = allWaves.some((wave) =>
                  wave.ships.some(
                    (ship: any) =>
                      ship.special?.Web && ship.special.Web > 0
                  )
                );
                const hasScrams = allWaves.some((wave) =>
                  wave.ships.some(
                    (ship: any) =>
                      ship.special?.Scram && ship.special.Scram > 0
                  )
                );
                const tackleLabel = hasWebs && hasScrams
                  ? "Webs and Scrams"
                  : hasWebs
                    ? "Webs"
                    : hasScrams
                      ? "Scrams"
                      : "No webs or scrams";

                if (referenceMode) {
                  allWaves = allWaves
                    .filter(
                      (wave) =>
                        wave.wave.toLowerCase().includes("avenger") ||
                        wave.wave.toLowerCase().includes("drifter") ||
                        wave.ships.some(
                          (ship: any) =>
                            ship.trigger === true ||
                            ship.triggerOnAttack === true ||
                            ship.dta === true
                        )
                    )
                    .map((wave) => ({
                      ...wave,
                      ships: wave.ships.filter(
                        (ship: any) =>
                          wave.wave.toLowerCase().includes("avenger") ||
                          wave.wave.toLowerCase().includes("drifter") ||
                          ship.trigger === true ||
                          ship.triggerOnAttack === true ||
                          ship.dta === true
                      ),
                    }));
                }

                const adjustedSite = {
                  ...site,
                  waves: allWaves,
                  blue_loot_isk: site.blue_loot_isk
                    ? site.blue_loot_isk + extraLoot
                    : extraLoot,
                };

                return (
                  <SiteCard
                    key={`${site.site}-${i}`}
                    site={adjustedSite as any}
                    referenceMode={referenceMode}
                    tackleLabel={tackleLabel}
                    hasWebs={hasWebs}
                    hasScrams={hasScrams}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
