import { useEffect } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border border-[#20242c] bg-[#05070b]">
      <div className="border-b border-[#20242c] bg-[#101219] px-2 py-1 text-[9px] uppercase tracking-widest text-[#8bd3ff]">
        {title}
      </div>
      <div className="space-y-2 p-3 text-[12px] leading-5 text-slate-300">{children}</div>
    </section>
  );
}

function BulletList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2">
          <span className="mt-[0.55em] h-1 w-1 shrink-0 bg-[#53b6ff]" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function FittingHelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        className="flex max-h-[min(820px,calc(100vh-2rem))] w-[min(900px,calc(100vw-2rem))] flex-col overflow-hidden border border-[#34404c] bg-[#070910] text-slate-100 shadow-2xl shadow-black"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-[#20242c] bg-[#101219] px-3">
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold uppercase tracking-widest text-slate-100">
              Triff.Tools Fitting Workbench
            </div>
            <div className="font-mono text-[10px] text-slate-600">Pyfa/eos-backed fitting, in the browser</div>
          </div>
          <button type="button" className="flex h-8 w-8 items-center justify-center text-slate-400 hover:text-slate-100" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="space-y-3">
            <Section title="What This Tool Is">
              <p>
                This page is a browser fitting workbench for EVE Online. It is meant to feel familiar if you use Pyfa:
                fit modules, load charges, compare variants, apply environments, project other fits, use command bursts,
                switch skill profiles, save private fits, and inspect graphs without leaving triff.tools.
              </p>
            </Section>

            <Section title="Pyfa Is The Source Of Truth">
              <p>
                The math here is delegated to Pyfa/eos. Triff.Tools builds fit payloads, sends them through the fitting
                service, and renders the calculated results. It does not try to replace or modify Pyfa&apos;s fitting engine
                at all.
              </p>
              <p>
                Pyfa remains the gold standard EVE fitting application: deep, tested, and maintained by people who have
                carried the community for years. This tool stands on that work. If you need the final word for a
                tournament fit, doctrine review, or strange edge case, compare against desktop Pyfa and treat differences
                as bugs to report to Triff.Tools. Please consider supporting the Pyfa project.
              </p>
              <a
                href="https://github.com/pyfa-org/Pyfa"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center border border-[#46b2ff]/60 bg-[#08131d] px-2 text-[10px] uppercase tracking-widest text-[#8bd3ff] hover:bg-[#101923]"
              >
                Open Pyfa Project
              </a>
            </Section>

            <Section title="How To Use">
              <BulletList
                items={[
                  <>Use the open-fit tabs at the top to keep several fits in memory. Modified unsaved tabs show <span className="font-mono">*</span>.</>,
                  <>Use <span className="font-mono">Import</span> and <span className="font-mono">Share/EFT</span> for text fits.</>,
                  <>Right-click fitted modules for charges, variants, abyssal controls, spool cycles, state changes, and show-info.</>,
                  <>Use the browser on the left for market items, hulls, and private saved fits.</>,
                  <>Use the bottom panels for drones, cargo, implants, boosters, projected effects, command bursts, and notes.</>,
                  <>Use the Graphs view in the fitting box for Pyfa-derived damage/electronic warfare curves.</>,
                ]}
              />
            </Section>

            <Section title="Saved Fits And Privacy">
              <p>
                Saved fits are private to your signed-in triff.tools account. Public share links and global fit browsing
                are intentionally not part of this system. Cross-fit projected/command links are session-only and are not
                saved into your fit records.
              </p>
            </Section>

            <Section title="If Something Looks Wrong">
              <p>
                First check the selected skills, damage profile, environmental effects, source projections, command bursts,
                and module states. If it still disagrees with Pyfa, the correct answer is almost always to report it to
                Triff.Tools, because the issue is probably on my end.
              </p>
            </Section>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
