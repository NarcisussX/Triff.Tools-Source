/*
 * React page for /rolling-mass.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import React from "react";
import { Orbit } from "lucide-react";
import { ToolChrome } from "../components/tool-ui";

const COLORS = {
  blue: {
    border: "border-[#2c2f36]",
    bg: "bg-[#070910]",
    box: "bg-[#05070b] border-[#303236]",
  },
  green: {
    border: "border-[#2c2f36]",
    bg: "bg-[#070910]",
    box: "bg-[#05070b] border-[#303236]",
  },
  gold: {
    border: "border-[#2c2f36]",
    bg: "bg-[#070910]",
    box: "bg-[#05070b] border-[#303236]",
  },
  orange: {
    border: "border-[#2c2f36]",
    bg: "bg-[#070910]",
    box: "bg-[#05070b] border-[#303236]",
  },
};

const DATA = [
  {
    label: "1000Gg",
    color: "blue",
    codes: ["C729", "D364", "F216", "M267", "O128", "R081", "U372", "X450", "X702"],
    jump: {
      main: ["1 Cold Jump", "1 Hot Jump"],
      note: "Is the hole reduced?",
    },
    yes: {
      roll: ["2 Hot Jumps"],
      crit: ["2 Cold Jumps"],
    },
    no: {
      roll: ["2 Hot Jumps"],
      crit: ["1 Cold Jump", "1 Hot Jump"],
    },
  },
  {
    label: "2000Gg",
    color: "green",
    codes: [
      "A239",
      "A641",
      "B274",
      "B449",
      "C247",
      "D382",
      "E175",
      "E545",
      "G024",
      "I182",
      "L477",
      "M164",
      "N766",
      "N968",
      "O477",
      "T405",
      "V898",
      "X877",
      "Y683",
      "Z457",
    ],
    jump: {
      main: ["2 Cold Jumps", "2 Hot Jumps"],
      note: "Is the hole reduced?",
    },
    yes: {
      roll: ["2 Hot Jumps", "2 Cold Jumps"],
      crit: ["4 Cold Jumps"],
    },
    no: {
      roll: ["4 Hot Jumps"],
      crit: ["2 Cold Jumps", "2 Hot Jumps"],
    },
  },
  {
    label: "3000Gg",
    color: "gold",
    codes: [
      "A982",
      "B041",
      "B520",
      "D792",
      "E587",
      "H900",
      "K329",
      "K346",
      "L031",
      "M555",
      "N062",
      "N290",
      "N770",
      "R051",
      "R474",
      "S047",
      "U210",
      "U574",
      "V283",
    ],
    jump: {
      main: ["5 Hot Jumps"],
      note: "Is the hole reduced?",
    },
    yes: {
      roll: ["Return Hot", "4 Hot Jumps"],
      crit: ["Return Cold", "2 Cold Jumps", "2 Hot Jumps"],
    },
    no: {
      roll: ["Return Hot", "3 Cold Jumps", "3 Hot Jumps"],
      crit: ["Return Cold", "2 Cold Jumps", "2 Hot Jumps"],
    },
  },
  {
    label: "3300Gg",
    color: "orange",
    codes: [
      "C140",
      "C248",
      "C391",
      "H296",
      "N432",
      "N944",
      "S199",
      "U319",
      "V753",
      "V911",
      "W237",
      "Z142",
    ],
    jump: {
      main: ["1 Cold Jump", "5 Hot Jumps"],
      note: "Is the hole reduced?",
    },
    yes: {
      roll: ["2 Cold Jumps", "4 Hot Jumps"],
      crit: ["4 Hot Jumps", "HIC once", "(if needed)"],
    },
    no: {
      roll: ["6 Hot Jumps", "HIC once", "(if needed)"],
      crit: ["1 Cold Jump", "5 Hot Jumps"],
    },
  },
];

const CodeGrid = ({ codes }) => (
  <div className="grid grid-cols-4 gap-1.5 w-full pt-1">
    {codes.map((c, i) => (
      <div
        key={c + i}
        className="rounded-[2px] px-2 py-1 text-[11px] font-semibold border border-[#303236] bg-[#05070b] text-slate-100 text-center"
      >
        {c}
      </div>
    ))}
  </div>
);

const JumpBox = ({ jump }) => (
  <div className="flex flex-col items-center justify-center h-full w-full px-2 py-2">
    <div className="text-[12px] font-semibold text-slate-100 text-center leading-tight">
      {jump.main.map((line, idx) => (
        <div key={idx}>{line}</div>
      ))}
    </div>
    <div className="italic text-[11px] text-slate-300 text-center mt-1">
      {jump.note}
    </div>
  </div>
);

const YesBox = ({ yes, color }) => (
  <div
    className={`rounded-[2px] ${COLORS[color].box} w-full flex flex-col items-start justify-start px-3 py-2`}
  >
    <div className="text-[11px] font-bold text-slate-100 mb-1 text-center tracking-widest w-full">
      YES
    </div>
    <div className="font-semibold mb-0.5 text-[11px] leading-tight text-slate-200">
      To Roll:
    </div>
    <ul className="ml-3 mb-1 text-[11px] leading-tight">
      {yes.roll.length ? (
        yes.roll.map((r, i) => (
          <li key={i} className="text-slate-100 whitespace-nowrap">
            {r}
          </li>
        ))
      ) : (
        <li className="text-slate-500">—</li>
      )}
    </ul>
    <div className="font-semibold mb-0.5 text-[11px] leading-tight text-slate-200">
      To Crit:
    </div>
    <ul className="ml-3 text-[11px] leading-tight">
      {yes.crit.length ? (
        yes.crit.map((r, i) => (
          <li key={i} className="text-slate-100 whitespace-nowrap">
            {r}
          </li>
        ))
      ) : (
        <li className="text-slate-500">—</li>
      )}
    </ul>
  </div>
);

const NoBox = ({ no, color }) => (
  <div
    className={`rounded-[2px] ${COLORS[color].box} w-full flex flex-col items-start justify-start px-3 py-2`}
  >
    <div className="text-[11px] font-bold text-slate-100 mb-1 text-center tracking-widest w-full">
      NO
    </div>
    <div className="font-semibold mb-0.5 text-[11px] leading-tight text-slate-200">
      To Roll:
    </div>
    <ul className="ml-3 mb-1 text-[11px] leading-tight text-[11px]">
      {no.roll.length ? (
        no.roll.map((r, i) => (
          <li key={i} className="text-slate-100 whitespace-nowrap">
            {r}
          </li>
        ))
      ) : (
        <li className="text-slate-500">—</li>
      )}
    </ul>
    <div className="font-semibold mb-0.5 text-[11px] leading-tight text-slate-200">
      To Crit:
    </div>
    <ul className="ml-3 text-[11px] leading-tight">
      {no.crit.length ? (
        no.crit.map((r, i) => (
          <li key={i} className="text-slate-100 whitespace-nowrap">
            {r}
          </li>
        ))
      ) : (
        <li className="text-slate-500">—</li>
      )}
    </ul>
  </div>
);

export default function RollingMass() {
  const rowHeights = {
    codes: "min-h-[190px]",
    jumps: "min-h-[70px]",
    yesno: "min-h-[170px]",
  };

  return (
    <div className="tt-tool-v2 tt2-reference-page tt2-rolling-mass min-h-screen text-slate-100 leading-snug">
      <div className="mx-auto max-w-[1320px] px-2 py-3 sm:px-4 sm:py-6">
        { }
        <div className="tt2-window">
          <ToolChrome
            section="Wormholes & Exploration"
            title="Hole Rolling Guide"
            badge={<span className="flex items-center gap-1"><Orbit className="h-3 w-3" /> Reference Chart</span>}
            context="Wormholes"
            status="Hole is fresh"
          />

          { }
          <div className="min-w-0 space-y-4 p-2 sm:p-3">
            { }
            <div className="border border-[#262933] bg-[#05070b]/90 px-3 py-3 sm:px-4">
              <p className="text-[12px] text-slate-300 mb-1">
                This page is a quick-reference chart for{" "}
                <span className="text-slate-100">
                  rolling wormhole connections with battleships
                </span>{" "}
                using standard mass fits (200,000,000 kg cold, ~300,000,000 kg hot).
              </p>
              <p className="text-[12px] text-slate-400 mb-1">
                Find your wormhole type, check the total mass allowance, and
                plan your jumps. Each mass band shows the relevant wormhole
                codes, recommended cold / hot jump sequence, and the{" "}
                <span className="text-slate-100">
                  YES / NO flow for whether the hole is already reduced
                </span>
                . The code lists intentionally include only connections capable
                of accepting those battleship masses.
              </p>
              <p className="text-[12px] text-slate-400">
                For outlier cases with unknown prior mass, cold–hot roll it
                until crit, then use a HIC once (or twice) to finish. Reduced
                1000Gg holes are best rolled with HICs, as they won&apos;t show
                crit until roughly 100,000 kg remaining and a cold jump can
                close them early.
              </p>
            </div>

            { }
            <fieldset className="min-w-0 max-w-full border border-[#2c2f36] bg-[#070910]">
              <legend className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300">
                <span>Mass Bands</span>
                <span className="text-[9px] text-slate-500">
                  1000Gg ▸ 3300Gg
                </span>
              </legend>

              <div className="w-full min-w-0 max-w-full overflow-x-auto p-2">
                <div className="mx-auto min-w-[980px] max-w-full space-y-2 xl:min-w-0">
                  { }
                  <div className="flex flex-row gap-2 w-full mb-2">
                    {DATA.map((d) => (
                      <div
                        key={d.label + "-codes"}
                        className={`rounded-[2px] ${COLORS[d.color].border} ${COLORS[d.color].bg} px-3 pt-2 pb-2 flex flex-col items-stretch w-full ${rowHeights.codes} justify-start border`}
                      >
                        <div className="text-[13px] font-semibold text-slate-100 mb-1 tracking-wide">
                          {d.label}
                        </div>
                        <CodeGrid codes={d.codes} />
                      </div>
                    ))}
                  </div>

                  { }
                  <div className="flex flex-row gap-2 w-full mb-2">
                    {DATA.map((d) => (
                      <div
                        key={d.label + "-jumps"}
                        className={`rounded-[2px] border ${COLORS[d.color].border} ${COLORS[d.color].bg} w-full flex items-center justify-center ${rowHeights.jumps}`}
                      >
                        <JumpBox jump={d.jump} />
                      </div>
                    ))}
                  </div>

                  { }
                  <div className="flex flex-row gap-2 w-full">
                    {DATA.map((d) => (
                      <div
                        key={d.label + "-yesno-pair"}
                        className="flex flex-row w-1/4 gap-2"
                      >
                        <YesBox
                          yes={d.yes}
                          color={d.color}
                          className="flex-1"
                        />
                        <NoBox
                          no={d.no}
                          color={d.color}
                          className="flex-1"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </fieldset>
          </div>
        </div>
      </div>
    </div>
  );
}
