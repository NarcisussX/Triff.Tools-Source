import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isNativeRuntime, openTriffExternalUrl, triffToolsUrl } from "../lib/webRuntime";
import "../styles/tool-v2.css";
import "../styles/eol.css";

const STORAGE_KEY = "triff-tools-eol-2026-10-30-acknowledged";

export default function EndOfLifeNotice() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [acknowledged, setAcknowledged] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (acknowledged) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [acknowledged]);

  function acknowledge() {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Dismiss for this visit; show again on the next load if storage is unavailable.
    }
    setAcknowledged(true);
  }

  if (acknowledged) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="tt-tool-v2 eol-dialog"
      aria-labelledby="eol-notice-title"
      aria-describedby="eol-notice-summary eol-notice-export"
      onCancel={(event) => {
        event.preventDefault();
        acknowledge();
      }}
    >
      <div className="tt2-titlebar">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
          <span className="text-[10px] uppercase tracking-widest text-slate-300">Triff.Tools &gt; End of service</span>
        </div>
        <span className="flex gap-1" aria-hidden="true">
          <span className="h-2 w-2 bg-[#53b6ff]" />
          <span className="h-2 w-2 bg-[#3bbf5a]" />
          <span className="h-2 w-2 bg-[#bf3b3b]" />
        </span>
      </div>
      <div className="tt2-contextbar">
        <span>Website and TriffFits app</span>
        <span>October 30, 2026</span>
      </div>
      <div className="space-y-4 px-4 py-4 text-[13px] leading-6 text-slate-400 sm:px-5">
        <h2 id="eol-notice-title" className="text-[17px] font-semibold uppercase leading-snug tracking-widest text-slate-100">Triff.Tools and TriffFits are shutting down October 30</h2>
        <p id="eol-notice-summary">On October 30, 2026, I’m shutting down the infrastructure that powers Triff.Tools and TriffFits.</p>
        <div className="tt2-notice space-y-2 px-3 py-3" id="eol-notice-export">
          <strong className="text-slate-100">Please export any fits you want to keep before October 30.</strong>
          <p>Fits are <strong className="text-slate-100">NOT saved locally</strong> and will be inaccessible via the browser or app after this date.</p>
        </div>
        <p>Thank you to everyone who used these tools, shared feedback, and supported the project.</p>
        <div className="flex flex-wrap gap-2 border-t border-[#2c2f36] pt-3">
          <a
            className="tt2-button tt2-button--primary"
            href={triffToolsUrl("/eol")}
            onClick={(event) => {
              acknowledge();
              if (isNativeRuntime()) {
                event.preventDefault();
                void openTriffExternalUrl("/eol");
              }
            }}
          >Read the full announcement</a>
          <button type="button" className="tt2-button tt2-button--secondary" onClick={acknowledge}>Got it</button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
