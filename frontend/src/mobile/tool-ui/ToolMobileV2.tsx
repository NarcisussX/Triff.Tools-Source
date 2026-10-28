import { useLayoutEffect, type ReactNode } from "react";
import stopIconRaw from "../../assets/icons/stop.svg?raw";
import { EveIcon, makeEveIcon, type EveIconDef } from "../shell/EveIcon";

export type ToolMobileNavItem<T extends string> = {
  key: T;
  label: string;
  icon: EveIconDef;
  badge?: string | number;
};

export function ToolMobileShellV2<T extends string>({ title, subtitle, icon, actions, navItems, activeView, onView, children }: {
  title: string;
  subtitle?: string;
  icon: EveIconDef;
  actions?: ReactNode;
  navItems: ToolMobileNavItem<T>[];
  activeView: T;
  onView: (view: T) => void;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    document.documentElement.classList.add("mobile-suite-document");
    document.body.classList.add("mobile-suite-document");
    return () => {
      document.documentElement.classList.remove("mobile-suite-document");
      document.body.classList.remove("mobile-suite-document");
    };
  }, []);

  return (
    <div data-tool-mobile-v2 className="tt-tool-v2 mobile-tool-shell flex min-h-0 flex-col overflow-hidden bg-[#030509] text-slate-100">
      <header className="shrink-0 border-b border-[#3a4655] bg-[#070910] px-2 py-2 shadow-lg shadow-black/30">
        <div className="grid min-h-11 grid-cols-[44px,1fr] items-center gap-2">
          <span className="flex h-11 w-11 items-center justify-center border border-[#3a4655] bg-[#101219] text-[#8bd3ff]">
            <EveIcon icon={icon} className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold uppercase tracking-[0.1em] text-[#e6edf5]">{title}</div>
            {subtitle ? <div className="truncate text-[11px] text-[#8793a5]">{subtitle}</div> : null}
          </div>
        </div>
        {actions ? <div className="mt-2">{actions}</div> : null}
      </header>
      <main data-mobile-scroll-root className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">{children}</main>
      <nav className="grid shrink-0 border-t border-[#2c2f36] bg-[#070910]/95 pb-[calc(0.25rem+env(safe-area-inset-bottom))] pt-0.5 backdrop-blur" style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}>
        {navItems.map((item) => {
          const active = item.key === activeView;
          return <button key={item.key} type="button" className={`relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 text-[11px] uppercase tracking-[0.08em] ${active ? "bg-[#101b27] text-[#8bd3ff]" : "text-[#8793a5]"}`} onClick={() => onView(item.key)}>
            <span className="relative flex h-6 w-6 items-center justify-center"><EveIcon icon={item.icon} className="h-[22px] w-[22px]" />{item.badge !== undefined && item.badge !== "" ? <span className="absolute -right-3 -top-1 min-w-4 border border-[#3a4655] bg-[#030509] px-1 text-center font-mono text-[10px] leading-4">{item.badge}</span> : null}</span>
            <span>{item.label}</span>
          </button>;
        })}
      </nav>
    </div>
  );
}

export function ToolTouchRowV2({ title, subtitle, icon, right, active = false, danger = false, onClick }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; right?: ReactNode; active?: boolean; danger?: boolean; onClick?: () => void }) {
  const content = <>{icon ? <span className="flex h-9 w-9 items-center justify-center">{icon}</span> : null}<span className="min-w-0 flex-1"><span className={`block truncate text-[14px] ${danger ? "text-[#ffb4bd]" : "text-[#e6edf5]"}`}>{title}</span>{subtitle ? <span className="mt-0.5 block truncate text-[11px] text-[#8793a5]">{subtitle}</span> : null}</span>{right ? <span className="shrink-0 text-[12px] text-[#aeb9c7]">{right}</span> : null}</>;
  const className = `grid min-h-[52px] w-full grid-cols-[auto,1fr,auto] items-center gap-2 border-b border-[#202630] px-2 py-2 text-left ${active ? "bg-[#101b27]" : "bg-[#070910]"}`;
  return onClick ? <button type="button" className={className} onClick={onClick}>{content}</button> : <div className={className}>{content}</div>;
}

const stopIcon = makeEveIcon(stopIconRaw);

export function ToolBottomSheetV2({ title, subtitle, children, onClose }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void }) {
  return <div className="tt-tool-v2 fixed inset-0 z-[10000] flex items-end bg-black/70 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-[calc(0.5rem+env(safe-area-inset-top))]" onMouseDown={onClose}>
    <div className="flex min-h-0 w-full flex-col overflow-hidden border border-[#3a4655] bg-[#070910] shadow-2xl shadow-black" onMouseDown={(event) => event.stopPropagation()}>
      <div className="grid min-h-[52px] shrink-0 grid-cols-[1fr,44px] items-center gap-2 border-b border-[#2c2f36] bg-[#101219] px-3">
        <div className="min-w-0"><div className="truncate text-[14px] font-semibold uppercase tracking-[0.08em] text-[#e6edf5]">{title}</div>{subtitle ? <div className="truncate text-[11px] text-[#8793a5]">{subtitle}</div> : null}</div>
        <button type="button" className="flex h-11 w-11 items-center justify-center border border-[#3a4655] bg-[#030509] text-[#8793a5]" onClick={onClose} aria-label="Close"><EveIcon icon={stopIcon} className="h-5 w-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </div>
  </div>;
}
