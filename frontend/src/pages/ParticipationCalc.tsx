/*
 * React page for /participation.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import React, { useEffect, useState } from "react";

export default function ParticipationCalc() {
  const [siteTier, setSiteTier] = useState("C5");
  const [siteNames, setSiteNames] = useState<string[]>([]);
  const [players, setPlayers] = useState<any[]>([]);
  const [playerName, setPlayerName] = useState("");
  const [drifterRan, setDrifterRan] = useState(true);
  const [usedDread, setUsedDread] = useState(true);
  const [accounting, setAccounting] = useState(5);
  const [results, setResults] = useState<any[]>([]);
  const [totalISK, setTotalISK] = useState(0);
  const [siteTotals, setSiteTotals] = useState<Record<string, number>>({});
  const [siteValues, setSiteValues] = useState<Record<string, number>>({});
  const [noTaxes, setNoTaxes] = useState(false);
  const [corpTax, setCorpTax] = useState<number>(0);
  const [allianceTax, setAllianceTax] = useState<number>(0);
  const [resultsMeta, setResultsMeta] = useState<{
    brokerTaxAmount?: number;
    corpTaxAmount?: number;
    allianceTaxAmount?: number;
  }>({});

  useEffect(() => {
    const fetchSites = async () => {
      const tiers = ["combat", "datarelic"];
      let allSites: string[] = [];
      const values: Record<string, number> = {};

      for (let tier of tiers) {
        const res = await fetch(
          `/api/data/${siteTier.toLowerCase()}_${tier}_sites_clean.json`
        );
        const data = await res.json();
        for (const row of data) {
          allSites.push(row.site);
          values[row.site] = Number(row.blue_loot_isk) || 0;
        }
      }

      setSiteNames(allSites);
      setSiteValues(values);

      const initTotals: Record<string, number> = {};
      allSites.forEach((s) => (initTotals[s] = 0));
      setSiteTotals(initTotals);

      setPlayers((prev) =>
        prev.map((p) => ({
          ...p,
          participation: allSites.reduce((acc, s) => {
            acc[s] = p.participation?.[s] ?? 0;
            return acc;
          }, {} as Record<string, number>),
        }))
      );
    };

    fetchSites();
  }, [siteTier]);

  const addPlayer = () => {
    if (!playerName.trim()) return;
    const participation: Record<string, number> = {};
    siteNames.forEach((site) => (participation[site] = 0));
    setPlayers([...players, { name: playerName.trim(), participation }]);
    setPlayerName("");
  };

  const updateSiteTotal = (site: string, value: string) => {
    setSiteTotals((prev) => ({ ...prev, [site]: parseInt(value) || 0 }));
  };

  const updateParticipation = (
    playerIndex: number,
    site: string,
    value: string
  ) => {
    const updated = [...players];
    updated[playerIndex].participation[site] = parseInt(value) || 0;
    setPlayers(updated);
  };

  const removePlayer = (index: number) => {
    setPlayers(players.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      siteTier,
      players,
      siteTotals,
      drifterRan,
      usedDread,
      accounting,
      noTaxes,
      corpTax,
      allianceTax,
    };
    const res = await fetch("/api/participation-calc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(
        "[PARTICIPATION_CALC]: participation POST failed",
        res.status,
        await res.text()
      );
      setResults([]);
      return;
    }

    const data = await res.json();
    setResults(data.payouts);
    setTotalISK(data.totalISK);
    setResultsMeta({
      brokerTaxAmount: data.brokerTaxAmount,
      corpTaxAmount: data.corpTaxAmount,
      allianceTaxAmount: data.allianceTaxAmount,
    });
  };

  const fmtISK = (n: number | undefined) => {
    if (n == null) return "—";

    const formatNum = (value: number, suffix: string) => {
      let formatted = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
      return `${formatted}${suffix}`;
    };

    if (n >= 1_000_000_000) return formatNum(n / 1_000_000_000, "B");
    if (n >= 1_000_000) return formatNum(n / 1_000_000, "M");
    if (n >= 1_000) return formatNum(n / 1_000, "K");
    return `${n}`;
  };

  const displayVal = (n: number | undefined) =>
    n === 0 || n === undefined ? "" : String(n);
  const isOverLimit = (site: string, count: number) =>
    count > (siteTotals[site] ?? 0);

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
                Market &amp; Trade ▸ Participation Loot Split
              </span>
            </div>
            <div className="flex items-center gap-2 text-[9px] text-slate-400">
              <span className="px-1 py-0.5 bg-[#0b0d11] border border-[#303236]">
                All the tools
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
                Overview ▸ Wormhole Sites
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
            <div className="border border-[#262933] bg-[#05070b]/90 px-3 py-2 text-[12px] text-slate-300">
              <p className="mb-1">
                This panel calculates a{" "}
                <span className="text-slate-100">
                  participation-based ISK split
                </span>{" "}
                for all wormhole sites based on how many players were present.
              </p>
              <p className="mb-1 text-slate-400">
                Input the total number of each site type your group ran, then
                for each pilot add the{" "}
                <span className="text-slate-100">
                  number of sites that player participated in
                </span>
                . C5 and C6 tiers automatically include Avenger loot if the
                dread dropdown is set to YES and apply mini/big drifter logic
                based on the dread/drifter toggles.
              </p>
            </div>

            { }
            <form onSubmit={handleSubmit} className="space-y-3">
              { }
              <div className="grid gap-3 lg:grid-cols-2">
                { }
                <fieldset className="border border-[#2c2f36] bg-[#070910]">
                  <legend className="px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300">
                    Site &amp; Drifters
                  </legend>
                  <div className="p-2 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-widest text-slate-400">
                        <span>Site Tier</span>
                        <select
                          className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0 min-w-[90px]"
                          value={siteTier}
                          onChange={(e) => setSiteTier(e.target.value)}
                        >
                          {["C1", "C2", "C3", "C4", "C5", "C6"].map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </select>
                      </label>

                      {(siteTier === "C5" || siteTier === "C6") && (
                        <>
                          <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-widest text-slate-400">
                            <span>Drifter Ran?</span>
                            <select
                              className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0 min-w-[90px]"
                              value={drifterRan ? "yes" : "no"}
                              onChange={(e) =>
                                setDrifterRan(e.target.value === "yes")
                              }
                            >
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          </label>

                          <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-widest text-slate-400">
                            <span>Dread Used?</span>
                            <select
                              className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0 min-w-[90px]"
                              value={usedDread ? "yes" : "no"}
                              onChange={(e) =>
                                setUsedDread(e.target.value === "yes")
                              }
                            >
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          </label>
                        </>
                      )}
                    </div>
                  </div>
                </fieldset>

                { }
                <fieldset className="border border-[#2c2f36] bg-[#070910]">
                  <legend className="px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300">
                    Taxes &amp; Broker
                  </legend>
                  <div className="p-2 grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-widest text-slate-400">
                      <span>Accounting Level</span>
                      <select
                        className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                        value={accounting}
                        onChange={(e) =>
                          setAccounting(parseInt(e.target.value))
                        }
                        title="Used for broker tax. Ignored if 'No taxes' is checked."
                      >
                        {[0, 1, 2, 3, 4, 5].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-widest text-slate-400">
                      <span>Corp Tax %</span>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] text-right outline-none focus:border-[#53b6ff] focus:ring-0"
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

                    <label className="flex flex-col gap-0.5 text-[10px] uppercase tracking-widest text-slate-400">
                      <span>Alliance Tax %</span>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] text-right outline-none focus:border-[#53b6ff] focus:ring-0"
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

                    <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-400 relative group">
                      <input
                        type="checkbox"
                        checked={noTaxes}
                        onChange={(e) => setNoTaxes(e.target.checked)}
                        className="h-3 w-3 bg-[#05070b] border border-[#303236]"
                      />
                      <span>No Broker Taxes</span>
                      <span
                        className="relative group cursor-help select-none"
                        aria-hidden="true"
                      >
                        <span
                          className="inline-flex items-center justify-center w-4 h-4 rounded-sm border border-[#4b9cff]/60 bg-[#0b111a] text-[10px] font-bold leading-none text-[#c1e5ff] group-hover:border-[#7fc5ff] group-hover:text-white transition-colors duration-150 translate-y-[1px]"
                        >
                          ?
                        </span>
                        <span
                          role="tooltip"
                          className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-50 hidden group-hover:block group-focus-within:block w-56 max-w-xs px-2 py-1 rounded-sm border border-[#262933] shadow-lg bg-[#05070b]/95 text-[11px] leading-snug text-slate-100 whitespace-normal break-words pointer-events-none"
                        >
                          Use this if you are using a buyback program instead of
                          selling to an NPC market.
                        </span>
                      </span>
                    </label>
                  </div>
                </fieldset>
              </div>

              { }
              <div className="border border-[#303236] bg-[#05070b]/95 overflow-x-auto">
                <table className="table-auto w-full text-[11px]">
                  <thead>
                    <tr className="bg-[#14161d] text-slate-100">
                      <th className="sticky left-0 bg-[#14161d] border border-[#2b2d33] px-3 py-1.5 text-left w-40">
                        Player
                      </th>
                      {siteNames.map((site) => (
                        <th
                          key={site}
                          className="border border-[#2b2d33] px-2.5 py-1.5 whitespace-normal break-words leading-tight tracking-tight min-w-[6.5rem] max-w-[8rem] text-left"
                          title={site}
                        >
                          {site}
                        </th>
                      ))}
                      <th className="border border-[#2b2d33] px-2.5 py-1.5 text-center w-16">
                        Remove
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    { }
                    <tr className="bg-[#090b11] hover:bg-[#141821]">
                      <td className="sticky left-0 bg-[#090b11] border border-[#2b2d33] px-3 py-1.5 font-semibold text-slate-200">
                        Site Value
                      </td>
                      {siteNames.map((site) => (
                        <td
                          key={site}
                          className="border border-[#2b2d33] px-2.5 py-1.5 text-center"
                        >
                          <span className="inline-block bg-[#05070b] border border-[#303236] px-2 py-0.5 text-[11px]">
                            {fmtISK(siteValues[site])}
                          </span>
                        </td>
                      ))}
                      <td className="border border-[#2b2d33] px-2.5 py-1.5 text-center text-slate-500">
                        —
                      </td>
                    </tr>

                    { }
                    <tr className="bg-[#0c0f16] hover:bg-[#141821]">
                      <td className="sticky left-0 bg-[#0c0f16] border border-[#2b2d33] px-3 py-1.5 font-semibold text-slate-200">
                        Number Ran
                      </td>
                      {siteNames.map((site) => (
                        <td
                          key={site}
                          className="border border-[#2b2d33] px-2.5 py-1.5 text-center"
                        >
                          <input
                            type="number"
                            min={0}
                            className="w-12 bg-[#05070b] border border-[#303236] px-1 py-0.5 text-[11px] text-center outline-none focus:border-[#53b6ff] focus:ring-0"
                            value={displayVal(siteTotals[site])}
                            placeholder="0"
                            onChange={(e) =>
                              updateSiteTotal(site, e.target.value)
                            }
                            onFocus={(e) => e.currentTarget.select()}
                          />
                        </td>
                      ))}
                      <td className="border border-[#2b2d33] px-2.5 py-1.5 text-center text-slate-500">
                        —
                      </td>
                    </tr>

                    { }
                    <tr>
                      <td
                        colSpan={siteNames.length + 2}
                        className="h-1 bg-[#05070b]"
                      />
                    </tr>

                    { }
                    {players.map((p, i) => {
                      const bgColor =
                        i % 2 === 0 ? "bg-[#090b11]" : "bg-[#0c0f16]";
                      return (
                        <tr
                          key={i}
                          className={`${bgColor} hover:bg-[#141821] transition-colors`}
                        >
                          <td className="sticky left-0 bg-inherit border border-[#2b2d33] px-3 py-1.5 font-semibold text-slate-100">
                            {p.name}
                          </td>
                          {siteNames.map((site) => {
                            const count = Number(p.participation[site] || 0);
                            const over = isOverLimit(site, count);
                            return (
                              <td
                                key={site}
                                className="border border-[#2b2d33] px-2.5 py-1.5 text-center"
                              >
                                <input
                                  type="number"
                                  min={0}
                                  className={`w-12 bg-[#05070b] border px-1 py-0.5 text-[11px] text-center outline-none focus:ring-0 ${
                                    over
                                      ? "border-[#bf3b3b] focus:border-[#ff6666]"
                                      : "border-[#303236] focus:border-[#53b6ff]"
                                  }`}
                                  value={displayVal(count)}
                                  placeholder="0"
                                  title={
                                    over
                                      ? `Player count (${count}) exceeds Number Ran (${
                                          siteTotals[site] ?? 0
                                        })`
                                      : ""
                                  }
                                  onChange={(e) =>
                                    updateParticipation(i, site, e.target.value)
                                  }
                                  onFocus={(e) => e.currentTarget.select()}
                                />
                              </td>
                            );
                          })}
                          <td className="border border-[#2b2d33] px-2.5 py-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => removePlayer(i)}
                              className="text-[#ff6666] hover:text-[#ff9999]"
                              title="Remove player"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              { }
              <div className="flex items-center gap-2 border border-[#262933] bg-[#070910] px-3 py-2">
                <input
                  type="text"
                  className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] w-64 outline-none focus:border-[#53b6ff] focus:ring-0"
                  placeholder="Player name"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addPlayer();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={addPlayer}
                  className="px-3 py-1.5 text-[11px] uppercase tracking-widest bg-[#1b8cc8] border border-[#46b2ff]/70 hover:bg-[#27a0df] transition-colors duration-150"
                >
                  Add Player
                </button>
              </div>

              { }
              <div className="flex justify-end pt-2 border-t border-[#262933]">
                <button
                  type="submit"
                  className="min-w-[160px] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest bg-gradient-to-b from-[#1b8cc8] to-[#14608a] border border-[#46b2ff]/70 shadow-[0_0_12px_rgba(70,178,255,0.55)] hover:from-[#27a0df] hover:to-[#1672a4] transition-all duration-150"
                >
                  Calculate
                </button>
              </div>
            </form>

            { }
            {results.length > 0 && (
              <div className="mt-4 border border-[#262933] bg-[#05070b]/90 px-3 py-3">
                <div className="flex items-baseline justify-between mb-2">
                  <h2 className="text-[13px] font-semibold text-slate-100">
                    Payout Breakdown —{" "}
                    {(totalISK / 1_000_000).toFixed(0)}m ISK
                  </h2>
                </div>
                <div className="text-[11px] space-y-1 mb-3 text-slate-200">
                  {!noTaxes ? (
                    <div className="text-slate-200">
                      Applied Broker Tax:{" "}
                      <span className="text-slate-100">
                        {(7.5 - 0.462 * accounting).toFixed(2)}%
                      </span>
                      {typeof (resultsMeta as any)?.brokerTaxAmount ===
                        "number" && (
                        <span className="ml-2 text-slate-300">
                          (− {fmtISK((resultsMeta as any).brokerTaxAmount)})
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="text-slate-200">
                      No broker tax applied.
                    </div>
                  )}
                  {corpTax > 0 &&
                    typeof (resultsMeta as any)?.corpTaxAmount ===
                      "number" && (
                      <div className="text-slate-200">
                        Corp Tax:{" "}
                        <span className="text-slate-100">{corpTax}%</span>
                        <span className="ml-2 text-slate-300">
                          (− {fmtISK((resultsMeta as any).corpTaxAmount)})
                        </span>
                      </div>
                    )}
                  {allianceTax > 0 &&
                    typeof (resultsMeta as any)?.allianceTaxAmount ===
                      "number" && (
                      <div className="text-slate-200">
                        Alliance Tax:{" "}
                        <span className="text-slate-100">
                          {allianceTax}%
                        </span>
                        <span className="ml-2 text-slate-300">
                          (− {fmtISK((resultsMeta as any).allianceTaxAmount)})
                        </span>
                      </div>
                    )}
                </div>

                <div className="border border-[#303236] bg-[#05070b]/95 overflow-x-auto">
                  <table className="table-auto w-full text-[11px]">
                    <thead>
                      <tr className="bg-[#14161d] text-slate-100">
                        <th className="border border-[#2b2d33] px-3 py-1.5 text-left">
                          Player
                        </th>
                        <th className="border border-[#2b2d33] px-3 py-1.5 text-right">
                          ISK Earned
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r, i) => (
                        <tr
                          key={i}
                          className={
                            i % 2 === 0
                              ? "bg-[#090b11] hover:bg-[#141821]"
                              : "bg-[#0c0f16] hover:bg-[#141821]"
                          }
                        >
                          <td className="border border-[#2b2d33] px-3 py-1.5">
                            {r.name}
                          </td>
                          <td className="border border-[#2b2d33] px-3 py-1.5 text-right">
                            {r.payout.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
