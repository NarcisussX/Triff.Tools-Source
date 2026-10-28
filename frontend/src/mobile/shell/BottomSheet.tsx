import type { ReactNode } from "react";
import stopIconRaw from "../../assets/icons/stop.svg?raw";
import { EveIcon, makeEveIcon } from "./EveIcon";

const stopIcon = makeEveIcon(stopIconRaw);

type BottomSheetProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
};

export function BottomSheet({ title, subtitle, children, onClose }: BottomSheetProps) {
  return (
    <div
      className="fixed inset-0 z-[10000] flex items-end bg-black/65 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-[calc(0.5rem+env(safe-area-inset-top))]"
      onMouseDown={onClose}
    >
      <div
        className="mobile-bottom-sheet flex min-h-0 w-full flex-col overflow-hidden border border-[#34404c] bg-[#070910] text-slate-100 shadow-2xl shadow-black"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="grid min-h-11 shrink-0 grid-cols-[1fr,36px] items-center gap-2 border-b border-[#20242c] bg-[#101219] px-3">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold uppercase tracking-widest text-slate-200">
              {title}
            </div>
            {subtitle && <div className="truncate text-[10px] text-slate-500">{subtitle}</div>}
          </div>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-400 active:border-[#53b6ff]/70 active:text-slate-100"
            onClick={onClose}
            aria-label="Close"
          >
            <EveIcon icon={stopIcon} className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}
