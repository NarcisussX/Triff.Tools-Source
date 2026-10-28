/*
 * React page for /bloot.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import { useState } from "react";

export default function BlootCalc() {
  const [siteTier, setSiteTier] = useState("C5");
  const [siteRuns, setSiteRuns] = useState({});
  const [players, setPlayers] = useState([]);
  const [playerName, setPlayerName] = useState("");
  const [results, setResults] = useState([]);
  const [totalISK, setTotalISK] = useState(0);
  const [accounting, setAccounting] = useState(5);
  const [drifterRan, setDrifterRan] = useState(true);
  const [useDpsLogiMode, setUseDpsLogiMode] = useState(false);
  const [noTaxes, setNoTaxes] = useState(false);
  const [corpTax, setCorpTax] = useState<number>(0);
  const [allianceTax, setAllianceTax] = useState<number>(0);
  const [resultsMeta, setResultsMeta] = useState<{
    brokerTaxAmount?: number;
    corpTaxAmount?: number;
    allianceTaxAmount?: number;
  }>({});

  const removePlayer = (index: number) => {
    setPlayers((prev) => prev.filter((_, i) => i !== index));
  };

  const siteData = {
    C5: [
      "Core Garrison",
      "Core Stronghold",
      "Oruze Osobnyk",
      "Quarantine Area",
      "Unsecured Frontier Enclave Relay",
      "Unsecured Frontier Server Bank",
      "Forgotten Core Data Field",
      "Forgotten Core Information Pen",
    ],
    C6: [
      "Core Bastion",
      "Core Citadel",
      "Strange Energy Readings",
      "The Mirror",
      "Unsecured Core Backup Array",
      "Unsecured Core Emergence",
      "Forgotten Core Assembly Hall",
      "Forgotten Core Circuitry Disassembler",
    ],
  };

  const handleSiteChange = (site, value) => {
    setSiteRuns((prev) => ({ ...prev, [site]: parseInt(value) || 0 }));
  };

  const addPlayer = () => {
    if (!playerName.trim()) return;

    const base = {
      name: playerName.trim(),
      bubbler: false,
      extraShares: 0,
    };

    const player = useDpsLogiMode
      ? { ...base, dps: 0, logi: 0 }
      : { ...base, marauders: 0, dread: 0 };

    setPlayers([...players, player]);
    setPlayerName("");
  };

  const updatePlayer = (index, field, value) => {
    const updated = [...players];
    if (field === "bubbler") {
      updated[index][field] = value;
    } else if (field === "extraShares") {
      updated[index][field] = parseFloat(value) || 0;
    } else {
      updated[index][field] = parseInt(value) || 0;
    }
    setPlayers(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const formattedSiteRuns = Object.entries(siteRuns).map(
      ([siteName, count]) => ({
        siteName,
        count,
        usedDread: players.some((p) => p.dread > 0),
        useDpsLogiMode,
      })
    );

    try {
      const response = await fetch("/api/blue-loot-calc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          siteRuns: formattedSiteRuns,
          players,
          accounting,
          drifterRan,
          noTaxes,
          corpTax,
          allianceTax,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[BLOOT_CALC]: Server error:", errText);
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setResults(data.payouts);
      setTotalISK(data.totalISK);
      setResultsMeta({
        brokerTaxAmount: data.brokerTaxAmount,
        corpTaxAmount: data.corpTaxAmount,
        allianceTaxAmount: data.allianceTaxAmount,
      });
    } catch (error) {
      console.error("[BLOOT_CALC]: Failed to fetch results:", error);
    }
  };

  const tooltipStyle = "relative group cursor-help select-none";
  const tooltipBox =
    "absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-[#05070b]/95 text-slate-100 text-xs px-3 py-2 rounded-sm opacity-0 group-hover:opacity-100 transition z-10 w-64 text-left whitespace-normal pointer-events-none border border-[#262933]";

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
                Market &amp; Trade ▸ Blue Loot Split
              </span>
            </div>
            <div className="flex items-center gap-2 text-[9px] text-slate-400">
              <span className="px-1 py-0.5 bg-[#0b0d11] border border-[#303236]">
                Calculator Ready
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
                Overview ▸ C5 / C6 Sites
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#3bbf5a]" />
                <span>Sites Bookmarked</span>
              </span>
            </div>
            <div className="flex items-center gap-2" />
          </div>

          { }
          <div className="p-3 space-y-4">
            { }
            <div className="border border-[#262933] bg-[#05070b]/90 px-3 py-2">
              <p className="text-[12px] text-slate-300 mb-1">
                This panel calculates a{" "}
                <span className="text-slate-100">fair (share based) ISK split</span> for
                C5 and C6 wormhole sites based on how many ships each player brought —
                including tiered share system for multiboxed marauders, dreads, and
                tackle.
              </p>
              <p className="text-[12px] text-slate-400 mb-1">
                Enter the number of sites and ships used; the tool handles the math for
                you. Upgraded Avenger and big drifter loot are automatically included if
                a dread is in fleet composition and the{" "}
                <span className="text-slate-100">“Drifter ran?”</span> box is set to{" "}
                <span className="text-slate-100">Yes</span>.
              </p>
            </div>

            { }
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid gap-3 lg:grid-cols-[1.4fr_1.6fr]">
                { }
                <fieldset className="border border-[#2c2f36] bg-[#070910]">
                  <legend className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300">
                    <span>Sites &amp; Taxes</span>
                  </legend>
                  <div className="p-2 space-y-3">
                    { }
                    <div>
                      <div className="mb-2 flex flex-row items-center gap-x-4">
                        <label className="text-[10px] uppercase tracking-widest text-slate-400">
                          Site Tier
                        </label>
                        <select
                          value={siteTier}
                          onChange={(e) => setSiteTier(e.target.value)}
                          className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                        >
                          <option value="C5">C5</option>
                          <option value="C6">C6</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4">
                        {siteData[siteTier].map((site) => (
                          <div
                            key={site}
                            className="flex items-center justify-between gap-2"
                          >
                            <label className="text-[11px] font-semibold truncate">
                              {site}
                            </label>
                            <input
                              type="number"
                              min="0"
                              value={siteRuns[site] || ""}
                              onChange={(e) =>
                                handleSiteChange(site, e.target.value)
                              }
                              className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] text-right w-20 outline-none focus:border-[#53b6ff] focus:ring-0"
                              placeholder="0"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    { }
                    <div className="pt-2 border-t border-[#262933] space-y-2">
                      <div className="flex items-center gap-3">
                        <label className="text-[11px] font-semibold text-red-300">
                          Drifter ran?
                        </label>
                        <select
                          value={drifterRan ? "yes" : "no"}
                          onChange={(e) => setDrifterRan(e.target.value === "yes")}
                          className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                        >
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-[11px]">
                        <label className="flex items-center gap-2">
                          <span className="text-slate-300">Accounting Level</span>
                          <select
                            className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                            value={accounting}
                            onChange={(e) =>
                              setAccounting(Number(e.target.value))
                            }
                            title="Used for broker tax. Ignored if 'No taxes' is checked."
                          >
                            {[0, 1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="flex items-center gap-2">
                          <span className="text-slate-300">Corp Tax %</span>
                          <input
                            type="number"
                            min={0}
                            step="0.1"
                            className="w-16 bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] text-right outline-none focus:border-[#53b6ff] focus:ring-0"
                            value={
                              Number.isFinite(corpTax) ? String(corpTax) : ""
                            }
                            placeholder="0"
                            onChange={(e) =>
                              setCorpTax(parseFloat(e.target.value) || 0)
                            }
                            onFocus={(e) => e.currentTarget.select()}
                            title="Applied after broker tax (if enabled)."
                          />
                        </label>

                        <label className="flex items-center gap-2">
                          <span className="text-slate-300">Alliance Tax %</span>
                          <input
                            type="number"
                            min={0}
                            step="0.1"
                            className="w-16 bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] text-right outline-none focus:border-[#53b6ff] focus:ring-0"
                            value={
                              Number.isFinite(allianceTax)
                                ? String(allianceTax)
                                : ""
                            }
                            placeholder="0"
                            onChange={(e) =>
                              setAllianceTax(parseFloat(e.target.value) || 0)
                            }
                            onFocus={(e) => e.currentTarget.select()}
                            title="Applied after broker & corp tax (if enabled)."
                          />
                        </label>

                        <label
                          className="flex items-center gap-2 text-slate-300 relative group"
                        >
                          <input
                            type="checkbox"
                            checked={noTaxes}
                            onChange={(e) => setNoTaxes(e.target.checked)}
                            className="accent-[#53b6ff]"
                          />
                          <span>No Broker taxes</span>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className="w-4 h-4 text-slate-400 group-hover:text-slate-100 transition"
                          >
                            <path
                              fillRule="evenodd"
                              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10
           10-4.48 10-10S17.52 2 12 2zm0 15h-1v-6h2v6h-1zm0-8h-1V7h2v2h-1z"
                              clipRule="evenodd"
                            />
                          </svg>
                          <span className={tooltipBox}>
                            Use this if you are using a buyback program instead of
                            selling to an NPC market.
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                </fieldset>

                { }
                <fieldset className="border border-[#2c2f36] bg-[#070910]">
                  <legend className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300">
                    <span>Player Setup</span>
                  </legend>
                  <div className="p-2 space-y-3">
                    { }
                    <div className="flex gap-2 mb-1">
                      <input
                        type="text"
                        placeholder="Player name"
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addPlayer();
                          }
                        }}
                        className="flex-1 bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                      />
                      <button
                        type="button"
                        onClick={addPlayer}
                        className="px-3 py-1 text-[11px] uppercase tracking-widest bg-gradient-to-b from-[#1b8cc8] to-[#14608a] border border-[#46b2ff]/70 shadow-[0_0_12px_rgba(70,178,255,0.55)] hover:from-[#27a0df] hover:to-[#1672a4] transition-all duration-150"
                      >
                        Add
                      </button>
                    </div>

                    { }
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-[11px] font-semibold">Share Mode:</span>
                      <div className="flex rounded-sm overflow-hidden border border-[#303236] text-[11px]">
                        <button
                          type="button"
                          className={`px-3 py-1 transition ${
                            !useDpsLogiMode
                              ? "bg-[#1b8cc8] text-white"
                              : "bg-[#05070b] text-slate-300 hover:bg-[#101219]"
                          }`}
                          onClick={() => {
                            if (useDpsLogiMode) {
                              const updated = players.map((p) => ({
                                name: p.name,
                                marauders: 0,
                                dread: 0,
                                bubbler: p.bubbler || false,
                                extraShares: p.extraShares || 0,
                              }));
                              setPlayers(updated);
                              setUseDpsLogiMode(false);
                            }
                          }}
                        >
                          Dread / Marauder
                        </button>
                        <button
                          type="button"
                          className={`px-3 py-1 transition ${
                            useDpsLogiMode
                              ? "bg-[#1b8cc8] text-white"
                              : "bg-[#05070b] text-slate-300 hover:bg-[#101219]"
                          }`}
                          onClick={() => {
                            if (!useDpsLogiMode) {
                              const updated = players.map((p) => ({
                                name: p.name,
                                dps: 0,
                                logi: 0,
                                bubbler: p.bubbler || false,
                                extraShares: p.extraShares || 0,
                              }));
                              setPlayers(updated);
                              setUseDpsLogiMode(true);
                            }
                          }}
                        >
                          DPS / Logi
                        </button>
                      </div>
                      <div
                        className={
                          tooltipStyle +
                          " flex items-center justify-center gap-1 text-slate-300"
                        }
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          className="w-4 h-4 text-slate-400 group-hover:text-slate-100 transition"
                        >
                          <path
                            fillRule="evenodd"
                            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm.01 17a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm1.61-7.84-.9.92c-.68.7-1.01 1.27-1.01 2.42h-1.5v-.38c0-1.1.33-1.93 1.11-2.74l1.24-1.26c.38-.39.55-.83.55-1.31 0-1.02-.84-1.85-1.87-1.85s-1.87.83-1.87 1.85H8c0-1.83 1.52-3.35 3.38-3.35S14.75 8.7 14.75 10c0 .78-.29 1.44-.83 1.96z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <div className={tooltipBox}>
                          Toggle between Marauders/Dreads or Logi/DPS. Dread payouts
                          account for avengers and big drifter if applicable. Logi/DPS
                          mode is intended for Leshak/Nestor and WR fleets with adjusted
                          payouts.
                        </div>
                      </div>
                    </div>

                    { }
                    {players.length > 0 && (
                      <div className="grid grid-cols-[8rem_6rem_6rem_6rem_6rem_4rem] gap-3 text-[11px] text-slate-400 text-center font-semibold mb-1 px-1">
                        <div>Name</div>
                        {useDpsLogiMode ? (
                          <>
                            <div>DPS</div>
                            <div>Logi</div>
                          </>
                        ) : (
                          <>
                            <div>Marauders</div>
                            <div>Dreads</div>
                          </>
                        )}
                        <div>Tackle</div>
                        <div
                          className={
                            tooltipStyle + " flex items-center justify-center gap-1"
                          }
                        >
                          <span>+ Shares</span>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className="w-4 h-4 text-slate-400 group-hover:text-slate-100 transition"
                          >
                            <path
                              fillRule="evenodd"
                              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm.01 17a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm1.61-7.84-.9.92c-.68.7-1.01 1.27-1.01 2.42h-1.5v-.38c0-1.1.33-1.93 1.11-2.74l1.24-1.26c.38-.39.55-.83.55-1.31 0-1.02-.84-1.85-1.87-1.85s-1.87.83-1.87 1.85H8c0-1.83 1.52-3.35 3.38-3.35S14.75 8.7 14.75 10c0 .78-.29 1.44-.83 1.96z"
                              clipRule="evenodd"
                            />
                          </svg>
                          <div className={tooltipBox}>
                            Use this if someone brought something abnormal, like a vindi
                            or booster. You can also use this for boosting soloboxer and
                            newbro shares, or tipping your scanner/eyes/rollers.
                          </div>
                        </div>
                        <div>Delete</div>
                      </div>
                    )}

                    { }
                    <div className="space-y-1">
                      {players.map((player, index) => (
                        <div
                          key={index}
                          className="grid grid-cols-[8rem_6rem_6rem_6rem_6rem_4rem] gap-3 items-center px-1"
                        >
                          <span className="text-center text-[11px]">
                            {player.name}
                          </span>
                          {useDpsLogiMode ? (
                            <>
                              <input
                                type="number"
                                inputMode="numeric"
                                value={player.dps || ""}
                                onChange={(e) =>
                                  updatePlayer(index, "dps", e.target.value)
                                }
                                className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] text-center outline-none focus:border-[#53b6ff] focus:ring-0"
                              />
                              <input
                                type="number"
                                inputMode="numeric"
                                value={player.logi || ""}
                                onChange={(e) =>
                                  updatePlayer(index, "logi", e.target.value)
                                }
                                className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] text-center outline-none focus:border-[#53b6ff] focus:ring-0"
                              />
                            </>
                          ) : (
                            <>
                              <input
                                type="number"
                                inputMode="numeric"
                                value={player.marauders || ""}
                                onChange={(e) =>
                                  updatePlayer(index, "marauders", e.target.value)
                                }
                                className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] text-center outline-none focus:border-[#53b6ff] focus:ring-0"
                              />
                              <input
                                type="number"
                                inputMode="numeric"
                                value={player.dread || ""}
                                onChange={(e) =>
                                  updatePlayer(index, "dread", e.target.value)
                                }
                                className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] text-center outline-none focus:border-[#53b6ff] focus:ring-0"
                              />
                            </>
                          )}
                          <div className="flex justify-center">
                            <input
                              type="checkbox"
                              checked={player.bubbler}
                              onChange={(e) =>
                                updatePlayer(index, "bubbler", e.target.checked)
                              }
                              className="accent-[#53b6ff]"
                            />
                          </div>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={player.extraShares || ""}
                            onChange={(e) =>
                              updatePlayer(index, "extraShares", e.target.value)
                            }
                            className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] text-center outline-none focus:border-[#53b6ff] focus:ring-0"
                          />
                          <button
                            type="button"
                            onClick={() => removePlayer(index)}
                            className="text-[#ff5b5b] hover:text-[#ff8383] text-lg leading-none"
                          >
                            ❌
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </fieldset>
              </div>

              { }
              <div className="flex justify-end pt-2 border-t border-[#262933]">
                <button
                  type="submit"
                  className="min-w-[140px] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest bg-gradient-to-b from-[#1b8cc8] to-[#14608a] border border-[#46b2ff]/70 shadow-[0_0_12px_rgba(70,178,255,0.55)] hover:from-[#27a0df] hover:to-[#1672a4] transition-all duration-150"
                >
                  Calculate
                </button>
              </div>
            </form>

            { }
            {results.length > 0 && (
              <div className="mt-4 border border-[#303236] bg-[#05070b]/95">
                <div className="px-3 py-2 border-b border-[#303236]">
                  <h2 className="text-[12px] font-bold text-slate-100">
                    Payout Breakdown —{" "}
                    {(totalISK / 1_000_000_000).toFixed(1)}b ISK
                  </h2>
                </div>

                { }
                <div className="px-3 py-2 text-[11px] space-y-1">
                  {!noTaxes ? (
                    <div className="text-[#8acbff] font-semibold">
                      Applied Broker Tax:{" "}
                      {(7.5 - 0.462 * accounting).toFixed(2)}%
                      {typeof resultsMeta.brokerTaxAmount === "number" && (
                        <span className="ml-2 text-slate-200">
                          (− {resultsMeta.brokerTaxAmount.toLocaleString()})
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="text-[#8acbff] font-semibold">
                      No broker tax applied.
                    </div>
                  )}

                  {corpTax > 0 &&
                    typeof resultsMeta.corpTaxAmount === "number" && (
                      <div className="text-[#8acbff]">
                        Corp Tax: {corpTax}%{" "}
                        <span className="ml-2 text-slate-200">
                          (− {resultsMeta.corpTaxAmount.toLocaleString()})
                        </span>
                      </div>
                    )}

                  {allianceTax > 0 &&
                    typeof resultsMeta.allianceTaxAmount === "number" && (
                      <div className="text-[#8acbff]">
                        Alliance Tax: {allianceTax}%{" "}
                        <span className="ml-2 text-slate-200">
                          (− {resultsMeta.allianceTaxAmount.toLocaleString()})
                        </span>
                      </div>
                    )}
                </div>

                <div className="overflow-x-auto">
                  <table className="table-auto w-full text-[11px]">
                    <thead>
                      <tr className="bg-[#14161d] text-slate-100">
                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                          Player
                        </th>
                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                          Total Shares
                        </th>
                        <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                          ISK Earned
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r, i) => {
                        const rowBg =
                          i % 2 === 0 ? "bg-[#090b11]" : "bg-[#0c0f16]";
                        return (
                          <tr
                            key={i}
                            className={`${rowBg} hover:bg-[#141821]`}
                          >
                            <td className="border border-[#2b2d33] px-2.5 py-1.5">
                              {r.name}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5">
                              {r.shares}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5">
                              {(r.payout ?? 0).toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            { }
            <div className="border border-[#262933] bg-[#05070b]/90 px-3 py-2 text-[11px] space-y-2">
              {useDpsLogiMode ? (
                <>
                  <p className="text-slate-100 font-semibold">
                    FCs: If you have a few people who can only fly logi{" "}
                    <span className="italic">or</span> DPS and a few who are
                    flying both, consider adding shares to the single-type
                    pilots or subtracting (negative values in the extra-shares
                    column) from the dual-type pilots to bring things in line.
                  </p>
                  <div>
                    <p className="text-slate-100 font-semibold">
                      Share allocation for DPS:
                    </p>
                    <ul className="list-disc list-inside text-slate-200">
                      <li>First 2 DPS ships: +1.0 shares each</li>
                      <li>Next 3 DPS ships: +0.5 shares each</li>
                      <li>Each additional: +0.25 shares each</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-slate-100 font-semibold mt-1">
                      Share allocation for Logi:
                    </p>
                    <ul className="list-disc list-inside text-slate-200">
                      <li>First logi ship: +1.5 shares</li>
                      <li>Second logi ship: +0.75 shares</li>
                      <li>Each additional: +0.25 shares</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-slate-100 font-semibold mt-1">
                      Tackle / Bubbler:
                    </p>
                    <p className="text-slate-200">+0.5 shares</p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <p className="text-slate-100 font-semibold">
                      Share allocation for Marauders:
                    </p>
                    <ul className="list-disc list-inside text-slate-200">
                      <li>First marauder: +1.5 shares</li>
                      <li>Second marauder: +1.0 shares</li>
                      <li>Each additional: +0.5 shares</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-slate-100 font-semibold mt-1">
                      Share allocation for Dreads:
                    </p>
                    <ul className="list-disc list-inside text-slate-200">
                      <li>First dread: +2.5 shares</li>
                      <li>Each additional: +1.5 shares</li>
                    </ul>
                  </div>
                  <div>
                    <p className="text-slate-100 font-semibold mt-1">
                      Tackle / Bubbler:
                    </p>
                    <p className="text-slate-200">+0.5 shares</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
