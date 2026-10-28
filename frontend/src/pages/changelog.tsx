/*
 * React page for /changelog.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import React from "react";

const pillBase =
  "inline-flex min-h-6 items-center rounded-sm border px-2 text-[10px] font-semibold uppercase leading-none tracking-wide";

function VersionPill({ v }: { v: string }) {
  return (
    <span
      className={`${pillBase} border-[#3a3c40] bg-[#05070b] text-slate-200`}
      title={`Version ${v}`}
    >
      {v}
    </span>
  );
}

type PatchKind = "Major" | "Minor" | "Patch";

function patchTypeFrom(version: string): PatchKind {
  const [maj, min, pat] = version
    .replace(/^v/i, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  if (min === 0 && pat === 0) return "Major";
  if (pat === 0) return "Minor";
  return "Patch";
}

const patchClasses: Record<PatchKind, string> = {
  Major: "border-rose-500/60 bg-[#1b1013] text-rose-200",
  Minor: "border-amber-500/60 bg-[#1b150b] text-amber-200",
  Patch: "border-slate-500/60 bg-[#111319] text-slate-200",
};

function PatchTypePill({ version }: { version: string }) {
  const kind = patchTypeFrom(version);
  const label = kind.charAt(0).toUpperCase() + kind.slice(1);
  return <span className={`${pillBase} ${patchClasses[kind]}`}>{label}</span>;
}

function DateHeading({
  date,
  id,
  version,
}: {
  date: string;
  id: string;
  version: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <div className="relative flex items-center justify-center">
        <span className="block w-2.5 h-2.5 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
        <span className="absolute left-1/2 top-full -translate-x-1/2 h-6 w-px bg-[#2c2f36]" />
      </div>

      <a
        href={`#${id}`}
        id={id}
        className="group inline-flex items-center gap-2 text-[12px] font-semibold text-slate-100 tracking-wide"
        title="Copy link to this date"
      >
        {date}
        <span className="opacity-0 group-hover:opacity-100 text-[#53b6ff] transition-opacity text-[11px]">
          🔗
        </span>
      </a>

      <div className="flex items-center gap-2">
        <VersionPill v={version} />
        <PatchTypePill version={version} />
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <article className="tt2-panel relative p-5">
      {children}
    </article>
  );
}

function ChangeCard({
  date,
  id,
  version,
  children,
}: {
  date: string;
  id: string;
  version: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative pl-7 sm:pl-9">
      <span className="pointer-events-none absolute left-[11px] top-0 bottom-0 w-px bg-[#2c2f36]" />
      <DateHeading date={date} id={id} version={version} />
      <article className="tt2-panel relative px-4 py-4 text-[12px] leading-5 shadow-[0_10px_24px_rgba(0,0,0,0.22)] sm:px-5">
        {children}
      </article>
    </div>
  );
}

export default function Changelog() {
  return (
    <div
      id="top"
      className="tt-tool-v2 min-h-screen bg-transparent text-slate-100 leading-snug"
    >
      <div className="tt2-frame tt2-frame--centered">
        { }
        <div className="tt2-window">
          { }
          <div className="tt2-titlebar">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
              <span className="uppercase tracking-widest text-[10px] text-slate-300">
                Platform ▸ Changelog
              </span>
            </div>
            <div className="flex items-center gap-2 text-[9px] text-slate-400">
              <span className="px-1 py-0.5 bg-[#0b0d11] border border-[#303236]">
                What's no longer next
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
          <div className="tt2-contextbar text-[11px] text-slate-400">
            <div className="flex items-center gap-3">
              <span className="uppercase tracking-widest text-slate-300">
                Overview ▸ Release History
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#3bbf5a]" />
                <span>The opposite of a roadmap</span>
              </span>
            </div>
            <div className="flex items-center gap-2" />
          </div>

          { }
          <div className="tt2-workspace space-y-5">
            { }
            <div className="tt2-notice">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h1 className="text-[17px] font-semibold uppercase tracking-[0.14em] text-slate-100">
                  Changelog
                </h1>
                <p className="text-[10px] text-slate-400">
                  Major = platform shifts · Minor = new features · Patch =
                  fixes/tweaks
                </p>
              </div>
            </div>

            { }
            <section className="space-y-7 border-t border-[#202631] pt-5">
              { }
              <ChangeCard date="09/04/2026" id="2026-09-04" version="v3.2.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      BR's generated with a future end date will now automatically show new kills and stats as they come in - live!
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      You can now re-order corps and alliances on the BR reports by dragging and dropping. Shoutout to EveTools for the mechanics. 
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="09/03/2026" id="2026-09-03" version="v3.17.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Corrected PI planet resource mappings for Autotrophs, Base Metals and Noble Gas - found by Ankh
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added corporation and alliance filters to Local Intel reports - suggested by kulnor
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added base-site ISK/EHP values to Wormhole PvE site cards, excluding Avengers and Drifters - suggested by kulnor
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed the Battle Report date picker being clipped or opening off-screen - found by Agate West
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Updated Rolling Mass wormhole types and corrected their mass bands against current EVE data - reported by kulnor
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="08/11/2026" id="2026-08-11" version="v3.16.2b">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added 334 more reference structure ID's for the age calculator (last 12 week)
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="08/05/2026" id="2026-08-05" version="v3.16.2">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed loaded charges crashing the mobile Fitting Tool and TriffFits when opening module actions - found by Marcus
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="08/04/2026" id="2026-08-04" version="v3.16.1">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed current stock only reducing the Industry Calculator BOM instead of also reducing job runs, build steps, materials and costs - found by Gybb
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Add to Cargo actions and editable cargo quantities to desktop, mobile and TriffFits - suggested by Incon
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Pyfa-style Fill With Module actions to desktop, mobile and TriffFits - suggested by Incon
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added custom saved fit groups to the desktop Fitting Tool - suggested by Incon
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="07/30/2026" id="2026-07-30" version="v3.16.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Reworked the UI across most of Triff.Tools so the site finally looks like one site
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Standardized tool windows, title bars, context strips, panels, buttons, inputs, tabs, tables, loading states and empty states
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Tightened spacing and control sizing across the calculators so they actually fit on a normal monitor again
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Improved input contrast, alignment, focus states and mobile touch sizing across tools
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added consistent tool viewport backgrounds to Fitting, Combat Logs, Battle Reports and Item Details
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Removed the landing page hero and replaced it with a search bar + API/market/SDE status strip
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added new mobile layouts for Gas, Ore and Industry calculators
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed mobile overflow and clipping in Rolling Mass, Reactions and the TriffView demo
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed the Market Browser mobile navbar being clipped off-screen
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added a small fade, loading state and proper scroll restoration when switching tools
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added a reload screen when a tool fails to load
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="07/26/2026" id="2026-07-26" version="v3.15.1">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed sentry drone damage against structures being attributed to the structure and bypassing Ignore Drones - found by Bronzer
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Improved sharing support for very large combat log reports
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Changed Active DPS to split combat after 20 seconds without damage
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added moon ores and moon mining crystals to the Mining Calculator - suggested by LETUSDIG
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="07/25/2026" id="2026-07-25" version="v3.15.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Michi's Implant as a secondary implant option to the Mining Calculator - suggested by LETUSDIG
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Webs and Scrams indicators to Wormhole PvE site cards - suggested by General Calarin
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Corrected the Unsecured Frontier Receiver Wave 4 trigger to Trigger on Attack - found by General Calarin
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Corrected the Forgotten Frontier Recursive Depot Wave 4 frigate to Emergent Preserver - found by General Calarin
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="07/08/2026" id="2026-07-08" version="v3.14.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      TriffView fleet manager and preview alerts - /TriffView
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="07/03/2026" id="2026-07-03" version="v3.13.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Release of TriffView - /TriffView
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Moved Local Intel from a TriffHud only tool to triff.tools - /triff-local
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Removed navigation for Anoikis Command, its still reachable at /anoikis-command
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="06/03/2026" id="2026-06-05" version="v3.12.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added D-Scan Intel - /dscan
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added wormhole mass math to D-scan reports
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed timestamp ions being invisible in dark mode - Found by Geroni
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="06/01/2026" id="2026-06-01" version="v3.11.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Combat Log Parser - /combat-logs
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Discord embeds for shared combat log reports
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="05/30/2026" id="2026-05-30" version="v3.10.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Pyfa-style graphs to desktop /fitting
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added graph targets for open fits and built-in target profiles
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added target speed, angle, signature, and multi-target overlays to /fitting graphs
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added click-to-read graph values in /fitting graphs
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Polished Desktop UI - /Desktop
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Updated Cache Behavior
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="05/25/2026" id="2026-05-25" version="v3.9.7">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added shareable TriffFits links from the Share/EFT export flow in /fitting
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added shared fit imports at /fitting/fit/:id so full EFT fits can open directly in TriffFits
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Discord/social embeds for shared TriffFits links
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Improved EFT imports for external abyssal modules by importing placeholders instead of dropping modules
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added unresolved abyssal warnings and excluded unresolved abyssals from calculated stats
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed abyssal variant replacement clearing the wrong metadata in /fitting
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Limited unresolved abyssal variant menus by module size and type
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed quantity implants and boosters in EFT imports being treated as active instead of cargo
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added stronger fitting guards for invalid hull restrictions, hardpoint limits, and extra T3C subsystem roles
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added turret and launcher hardpoint counts to /fitting slot headers on mobile
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Restyled some TriffFits controls
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed mobile fitting missing skills popup positioning
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Polished mobile fitting export, stats, and show-info modal behavior 
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added account deletion option for Triff.Tools accounts
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Privacy Policy and Terms of Use pages
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Reworked the status page with service health and worker freshness details
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added backend metrics, client error reporting, and worker error logging
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Changed the header UI scale control to use layout zoom instead of transform scaling
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed SDE schema and meta table handling for fitting variants
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Google Analytics
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="05/20/2026" id="2026-05-20" version="v3.9.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Beta account-wide implementation
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Updated SDE (Markets now index Exordium)
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Gas and Ore calcs now correctly use T1/T2 industrial core
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Ore calc now has correct ore names (finally)
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="05/19/2026" id="2026-05-19" version="v3.7.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Item DB - /items
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added deeplinks to market browser for individual items
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added deeplinks to reaction calc for reaction items
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added deeplinks to indy calc for indy related items
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added deeplinks to PI calc for PI related items
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added deeplinks to wormholes in wormhole DB
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Re-worked wormhole database - /wormholes
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added biochemical and composite reactions to reaction calc - /reactions
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added myko/cyko gasses to gas calc - /gas
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Completely rework PI calc - /pi-calc
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Updated + added discord bot embeds across site. 
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Stopped the mobile fitting tool clearing market search when adding modules.
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added show info work flow to fitting tool on both mobile and desktop.
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="05/17/2026" id="2026-05-17" version="v3.5.1">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed T3C's not allowing you to fit modules /fitting - found by Funxy
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed T3D's not letting you switch modes in /fitting - found by Funxy
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed iOS Safari blocking ESI add in /fitting - found by Apolline_Dufour-Roux
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed window resizing clearing fit in /fitting - found by NoSpaceDude
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed double click bug with market tabs in /fitting - found by NoSpaceDude
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed search fighting with market tabs in /fitting - found by NoSpaceDude
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Changed status icon to status toggle button in /fitting - Suggested by NoSpaceDude
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added edit drone stack amount in /fitting - Suggested by NoSpaceDude
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Overheat/online/offline rack toggles in /fitting - Suggested by NoSpaceDude
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Items now sorted by meta level in /fitting - Suggested by NoSpaceDude
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added preset "all alpha skills" character in /fitting - Suggested by ethertitan
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="05/16/2026" id="2026-05-16" version="v3.5.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added ESI skill reading to /fitting
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Mining rate math to /fitting
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added accounts for saving fits to /fitting 
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added ability to project fits & command to /fitting
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added multiple open tabs to /fitting
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added full new mobile UI to /fitting
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="05/14/2026" id="2026-05-14" version="v3.0.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Launched browser-based fitting powered by Pyfa/eos - /fitting
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="05/13/2026" id="2026-05-13" version="v2.9.4">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added eviction stats tool - /evictions
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              <ChangeCard date="04/30/2026" id="2026-04-30" version="v2.9.1">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Anoikis Command PvP mode added 
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              { }
              <ChangeCard date="04/30/2026" id="2026-04-30" version="v2.9.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Refreshed Market Browser with charts and shit /market
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Browser idle game idk /anoikis-command
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Huge code clean up.
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              { }
              <ChangeCard date="04/21/2026" id="2026-04-21" version="v2.8.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added BR Generating tool - /br
                    </span>
                  </li>
                </ul>
              </ChangeCard>
              { }
              <ChangeCard date="03/23/2026" id="2026-03-23" version="v2.5.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added C5 Rattings fits - /RoachFits
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added a POS Planner - /POSPlanner
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="03/18/2026" id="2026-03-18" version="v2.4.4">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Updated Ordinary gas site rats (no more sentries)
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Updated PvE Sites to reflect lower EHP on recon drifter
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Updated SDE
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="03/04/2026" id="2026-03-04" version="v2.4.3">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added taxes to hybrid reactions calc - suggested by Frenly
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="02/17/2026" id="2026-02-17" version="v2.4.2">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      CCP broke their SDE columns. I fixed them.
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="02/14/2026" id="2026-02-14" version="v2.4.1">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed missing trigger of wave 3 on C3 Quarantine Outpost - Found by Tas'Adar
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="02/06/2026" id="2026-02-06" version="v2.4.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Wormhole intel tool - /holeintel
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="01/30/2026" id="2026-01-30" version="v2.3.3">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added /api/market/history/batch endpoint, see docs for usage - Requested by Atagar
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              <ChangeCard date="01/29/2026" id="2026-01-29" version="v2.3.2">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added /api/market/quote endpoint, see docs for usage - Requested by Atagar
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="01/24/2026" id="2026-01-24" version="v2.3.1">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added O477 to rolling mass chart - Found by 'Sidhion Aivo' and 'New Character Imade'
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="01/14/2026" id="2026-01-14" version="v2.3.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Updated Timestamp generator to accept Eve Time (UTC)
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Landing page industrial branding removed
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added inventory parser to industry tool (Removes items from shopping list)
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed percentages doing weird things in the industry tool (5.78% became 0.056999999999995)
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Clarity to the system cost index boxes and SCC surcharge box for /industry
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Gas site rats to gas calculator table return
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Made desktop window manager at /desktop no longer password protected (secret tool for my 2k+ resolution monitor brethren)
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added the ability to open mnultiple tabs of the same tool in /desktop
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="12/04/2025" id="2025-12-04" version="v2.1.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Completely new UI. For every tool. All at once.
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Deprecated animated bg image in favor of static CCP-
                      supplied bg.
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Repurposed settings button in header to allow scaling
                      of UI (for my 4k monitor capsuleers).
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="11/28/2025" id="2025-11-28" version="v2.0.5">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Updated API documentation - /api/docs
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added "% of total cost" column to industry cost calc -
                      suggested by Kulnor
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added "Amount in stock" column to industry cost calc -
                      suggested by Kulnor
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed some incorrectly mapped J-code statics - found by
                      roperman
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="11/22/2025" id="2025-11-22" version="v2.0.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Updated for Catalyst Expansion!
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Implemented Crits to ore calc
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added new ships to both ore and gas calcs
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added new BP's to both indy tools
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added new items / new item names to ISKtimate and market
                      browser/index
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Platform: Moved away from 3rd party SDE, now parse/convert
                      CCP SDE directly
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="11/17/2025" id="2025-11-17" version="v1.9.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Manufacturing BP copying scheduler - /schedule
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed bug with large runs of low qty items in indy calc -
                      found by Alan
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed bug where indy calc search didnt return expected
                      results - found by Alan
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed bug with discord embeds
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="11/12/2025" id="2025-11-12" version="v1.8.1">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added per-unit cost/value statement to /industry -
                      suggested by Alan
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="11/09/2025" id="2025-11-09" version="v1.8.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Industrial Revolution!
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Industry Manufacturing cost calculator - /industry
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Market Browser - /market
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Changed most of triff.tools data to run off the SDE (VS
                      self-maintained JSON)
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Re-organized landing page buttons and added a temporary
                      theme!
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="11/08/2025" id="2025-11-08" version="v1.2.2">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Bug: ISKtimate incorrectly displayed buy_max/sell_min
                      values - found by Alan
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="10/28/2025" id="2025-10-28" version="v1.2.1">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Bug: ore reprocessor applied sec bonus to unrigged
                      structures - found by Alan
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="10/27/2025" id="2025-10-27" version="v1.2.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added compressed ore reprocessing calculator - /compressed
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="10/25/2025" id="2025-10-25" version="v1.1.6">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed E175 incorrectly mapping to C5's in WH database.
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Changed wording in boosting ship drop down on huffing
                      calculator.
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Re-organized landing page buttons.
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Grammar fixes across site.
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="10/02/2025" id="2025-10-02" version="v1.1.5">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Updated hole rolling guide with new C4 wandering K space
                      holes
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="9/24/2025" id="2025-09-24" version="v1.1.4">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Updated ISKtimate to support copy/pasted fits
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Updated ISKtimate to support copy/pasting from asset list
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Updated ISKtimate to support copy/pasting from "show
                      contents"
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Overall improvements to ISKtimate language parsing and
                      tokenization.
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Improvements to ISKtimate's UX and legibility.
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added images to ISKtimate!
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="9/22/2025" id="2025-09-21" version="v1.1.1">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed Neut pressure in PvE sites - Found by Axium
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="9/21/2025" id="2025-09-21" version="v1.1.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Contact form page (no email needed)- /contact
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Huge code rebase (YUGE)
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="9/20/2025" id="2025-09-20" version="v1.0.2">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added status page for the API + Deps - /statuses
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Slider for ISKtimate! (0%-200%)
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Facelift for the Acknowledgements page!
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Facelift + speed improvements for the PI Calc page!
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Facelift + speed improvements for the Reactions Calc page!
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Facelift + speed improvements for the Timestamp page!
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="9/18/2025" id="2025-09-18" version="v1.0.1">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added info page for the site + tech - /about
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Code clean-up
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Discord Embeds added!
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Changelog page overhauled
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="9/17/2025" id="2025-09-17" version="v1.0.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added ISKtimate! Similar to Janice, but fully self reliant
                      for pricing
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Built in-house market scraper for all items/all trade hubs
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Swagger API documentation
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Removed all Fuzzworks calls from public tools
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Implemented in-house Market API calls for Gas, Ore and PI
                      calcs
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="9/16/2025" id="2025-09-16" version="v0.7.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Beefed up the server and moved it to the East coast.
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="9/14/2025" id="2025-09-14" version="v0.6.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Pyfa as a browser based tool!
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Face lift for the landing page and navbar/drawer
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="9/10/2025" id="2025-09-10" version="v0.5.4">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Adjusted Avengers to 50m each to account for release
                      23.01 changes
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="8/11/2025" id="2025-08-11" version="v0.5.3">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Bug: Fixed Barge/Exhumer yield bonus not adding correctly
                    </span>{" "}
                    - Found by Alan
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="8/10/2025" id="2025-08-10" version="v0.5.2">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added site isk values to /participation
                    </span>{" "}
                    - Suggested by Axium
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Massively cleaned up UI/UX in /participation
                    </span>{" "}
                    - Suggested by Axium
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added corp/alliance tax and buyback options to
                      /participation
                    </span>{" "}
                    - Suggested by Axium
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added site isk values to /participation
                    </span>{" "}
                    - Suggested by Axium
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added corp/alliance tax and buyback options to /bloot
                    </span>{" "}
                    - Suggested by Axium
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="8/07/2025" id="2025-08-07" version="v0.5.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added participation-based blue loot calculator -
                      /participation
                    </span>{" "}
                    - Suggested by Axium
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="8/03/2025" id="2025-08-03" version="v0.4.2">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Bug: O477 WH's were listed as C2
                    </span>{" "}
                    - Found by Axium
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Bug: Trigger-only toggle caused Peak DPS/Alpha/Neut to
                      recalculate
                    </span>{" "}
                    - Found by Axium
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Allowed sorting on Ore/Gas/Reactions calculator return
                      tables
                    </span>{" "}
                    - Suggested by Axium
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added "No tackle" badge to sites with no tackle in PvE
                      reference page
                    </span>{" "}
                    - Suggested by Axium
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="8/01/2025" id="2025-08-01" version="v0.4.1">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Updated domain name to triff.tools - old (triffnix.com)
                      will redirect.
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added peak Alpha stat to wormhole PvE sites
                    </span>{" "}
                    - Suggested by Styx
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Addjusted PvE site waves to show dps/ehp/alpha per ship
                    </span>{" "}
                    - Suggested by Styx
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="7/31/2025" id="2025-07-31" version="v0.4.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Add hybrid reactions calculator - /reaction-calc
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="7/29/2025" id="2025-07-29" version="01.3.1">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added DPS/Logi toggle to Blue loot share splitter
                    </span>{" "}
                    - Suggested by Kattar
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="7/26/2025" id="2025-07-26" version="v0.3.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Add wormhole database - /wormholes
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Minor UI/UX upgrades
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      New DB and API schema to accommodate wormhole database
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="7/25/2025" id="2025-07-25" version="v0.2.2">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Add EVE time converter and discord timestamp generator -
                      /timestamp
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Update navbar to drawer
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Add current TQ population count to header
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="7/24/2025" id="2025-07-24" version="v0.2.0">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Add ore mining calculator - /ore
                    </span>
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="7/23/2025" id="2025-07-23" version="v0.1.5">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Only show scoops for frigates/collectors for barges in gas
                      calc
                    </span>{" "}
                    — Suggested by Sorf
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Add custom + share value to bloot calc
                    </span>{" "}
                    — Suggested by Absurdly
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Trigger ship view only on PvE sites (Trigger-Only Toggle)
                    </span>{" "}
                    — Suggested by Luxx
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Drifter toggle for blue loot split calculator
                    </span>{" "}
                    - Suggested by Battleangel
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Blue loot calculator split shares calculation info
                    </span>{" "}
                    - Suggested by Sorf
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added residue calculations to gas huffing calculator
                    </span>{" "}
                    - Suggested by Sorf
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Eliminated redundant implants in Gas Calculator
                    </span>{" "}
                    - Suggested by Sorf
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Changed gas-huffing boost dropdown from "Bastion" to
                      "industrial Core"
                    </span>{" "}
                    - Suggested by Alan
                  </li>
                </ul>
              </ChangeCard>

              { }
              <ChangeCard date="7/22/2025" id="2025-07-22" version="v0.1.1">
                <ul className="list-disc list-inside space-y-1.5">
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Changelog page to /changelog
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Roadmap page to /roadmap
                    </span>
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Made animated background toggleable
                    </span>{" "}
                    - Suggested by Sorf
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Updated outlier hole-rolling instructions
                    </span>{" "}
                    - Suggested by Sorf
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Upgraded Avengers C5/C6 Sites if big drifter active
                    </span>{" "}
                    - Suggested by Sorf
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Changed DTA to DTR in PvE sites
                    </span>{" "}
                    - Suggested by Sorf
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Fixed drifter orbit range statistic
                    </span>{" "}
                    - Suggested by Sorf
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added Blue loot calculator split shares calculation info
                    </span>{" "}
                    - Suggested by Sorf
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Added residue calculations to gas huffing calculator
                    </span>{" "}
                    - Suggested by Sorf
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Eliminated redundant implants in Gas Calculator
                    </span>{" "}
                    - Suggested by Sorf
                  </li>
                  <li>
                    <span className="text-slate-100 font-semibold">
                      Changed gas-huffing boost dropdown from "Bastion" to
                      "industrial Core"
                    </span>{" "}
                    - Suggested by Alan
                  </li>
                </ul>
              </ChangeCard>
            </section>
          </div>
        </div>
      </div>

      { }
      <a
        href="#top"
        onClick={(e) => {
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        className="tt2-button tt2-button--secondary fixed bottom-4 right-4 z-20 shadow-[0_8px_24px_rgba(0,0,0,0.55)] sm:bottom-6 sm:right-6"
        aria-label="Back to top"
      >
        ↑ Top
      </a>
    </div>
  );
}
