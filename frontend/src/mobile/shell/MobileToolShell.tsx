import { useLayoutEffect, type ReactNode } from "react";
import { EveIcon, type EveIconDef } from "./EveIcon";

export type MobileNavItem<T extends string> = {
  key: T;
  label: string;
  icon: EveIconDef;
  badge?: string | number;
};

type MobileToolShellProps<T extends string> = {
  title: string;
  subtitle?: string;
  icon: EveIconDef;
  actions?: ReactNode;
  navItems: MobileNavItem<T>[];
  activeView: T;
  onView: (view: T) => void;
  children: ReactNode;
};

export function MobileToolShell<T extends string>({
  title,
  subtitle,
  icon,
  actions,
  navItems,
  activeView,
  onView,
  children,
}: MobileToolShellProps<T>) {
  useLayoutEffect(() => {
    const documentClass = "mobile-suite-document";
    document.documentElement.classList.add(documentClass);
    document.body.classList.add(documentClass);
    return () => {
      document.documentElement.classList.remove(documentClass);
      document.body.classList.remove(documentClass);
    };
  }, []);

  return (
    <div
      data-mobile-viewport-shell
      className="mobile-tool-shell flex min-h-0 flex-col overflow-hidden bg-[#030509] text-slate-100"
    >
      <header className="shrink-0 border-b border-[#2c2f36] bg-[#070910] px-2 pb-1.5 pt-1.5 shadow-lg shadow-black/40">
        <div className="grid min-h-10 grid-cols-[36px,1fr] items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center border border-[#303236] bg-[#05070b] text-[#8bd3ff]">
            <EveIcon icon={icon} className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold uppercase tracking-widest text-slate-100">
              {title}
            </div>
            {subtitle && (
              <div className="truncate text-[10px] text-slate-500">
                {subtitle}
              </div>
            )}
          </div>
        </div>
        {actions && <div className="mt-1.5">{actions}</div>}
      </header>

      <main data-mobile-scroll-root className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-1.5">
        {children}
      </main>

      <nav
        className="grid shrink-0 border-t border-[#2c2f36] bg-[#070910]/95 pb-[calc(0.25rem+env(safe-area-inset-bottom))] pt-0.5 backdrop-blur"
        style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
      >
        {navItems.map((item) => {
          const active = item.key === activeView;
          return (
            <button
              key={item.key}
              type="button"
              className={`relative flex min-h-[50px] flex-col items-center justify-center gap-0.5 text-[8px] uppercase tracking-widest ${
                active ? "text-[#8bd3ff]" : "text-slate-500"
              }`}
              onClick={() => onView(item.key)}
            >
              <span className="relative flex h-[24px] w-[24px] items-center justify-center">
                <EveIcon icon={item.icon} className="h-[22px] w-[22px]" />
                {item.badge !== undefined && item.badge !== "" && (
                  <span className="absolute -right-3 -top-1 min-w-4 border border-[#303236] bg-[#05070b] px-1 text-center font-mono text-[8px] leading-4 text-slate-400">
                    {item.badge}
                  </span>
                )}
              </span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
