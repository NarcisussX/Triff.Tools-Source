import type { ReactNode } from "react";

type TouchRowProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  tone?: "default" | "danger";
  active?: boolean;
  onClick?: () => void;
};

export function TouchRow({ title, subtitle, icon, right, tone = "default", active = false, onClick }: TouchRowProps) {
  const content = (
    <>
      {icon && <span className="flex h-8 w-8 items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[12px] ${tone === "danger" ? "text-[#ffaaaa]" : "text-slate-100"}`}>
          {title}
        </span>
        {subtitle && <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-500">{subtitle}</span>}
      </span>
      {right && <span className="shrink-0 text-[11px] text-slate-400">{right}</span>}
    </>
  );

  const className = `grid min-h-12 w-full grid-cols-[auto,1fr,auto] items-center gap-2 border-b border-[#151922] px-2 py-1.5 text-left ${
    active ? "bg-[#101721]" : "bg-[#070910]"
  }`;

  if (onClick) {
    return (
      <button type="button" className={`${className} active:bg-[#101721]`} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}
