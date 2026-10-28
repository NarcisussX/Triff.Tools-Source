import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";

export type ToolFrameVariant = "centered" | "wide" | "report";
export type ToolTone = "info" | "success" | "warning" | "danger";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type ToolFrameProps = {
  section: string;
  title: string;
  subtitle?: string;
  context?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  variant?: ToolFrameVariant;
  className?: string;
  children: ReactNode;
};

type ToolChromeProps = {
  section: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  context?: ReactNode;
  status?: ReactNode;
  contextAside?: ReactNode;
  actions?: ReactNode;
};

export function ToolChrome({
  section,
  title,
  badge,
  context = "Overview",
  status,
  contextAside,
  actions,
}: ToolChromeProps) {
  return (
    <>
      <header className="tt2-titlebar">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-3 w-3 shrink-0 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]"
            aria-hidden="true"
          />
          <div className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-300">
            {section} <span className="text-slate-500">›</span> {title}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[9px] text-slate-400">
          {badge ? <span className="border border-[#303236] bg-[#0b0d11] px-1 py-0.5">{badge}</span> : null}
          {actions}
          <span className="hidden text-[#53b6ff] sm:inline">Triff.Tools</span>
          <span className="hidden gap-1 sm:flex" aria-hidden="true">
            <span className="h-2 w-2 bg-[#53b6ff]" />
            <span className="h-2 w-2 bg-[#3bbf5a]" />
            <span className="h-2 w-2 bg-[#bf3b3b]" />
          </span>
        </div>
      </header>
      <div className="tt2-contextbar">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate uppercase tracking-widest text-slate-300">Overview › {context}</span>
          {status ? (
            <span className="inline-flex shrink-0 items-center gap-1 normal-case tracking-normal text-[#9dc7ad]">
              <span className="h-1.5 w-1.5 bg-[#45cf78]" aria-hidden="true" />
              {status}
            </span>
          ) : null}
        </div>
        {contextAside ? <div className="shrink-0">{contextAside}</div> : null}
      </div>
    </>
  );
}

export function ToolFrame({
  section,
  title,
  subtitle,
  context,
  status,
  actions,
  variant = "centered",
  className,
  children,
}: ToolFrameProps) {
  return (
    <div className={cx("tt-tool-v2 min-h-screen", className)}>
      <div className={cx("tt2-frame", `tt2-frame--${variant}`)}>
        <div className="tt2-window">
          <header className="tt2-titlebar">
            <div className="min-w-0">
              <div className="tt2-title">{section} › {title}</div>
              {subtitle ? <div className="tt2-subtitle">{subtitle}</div> : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
          </header>
          {(context || status) ? (
            <div className="tt2-contextbar">
              <div>{context}</div>
              <div>{status}</div>
            </div>
          ) : null}
          <div className="tt2-workspace">{children}</div>
        </div>
      </div>
    </div>
  );
}

type ToolPanelProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  bodyClassName?: string;
};

export function ToolPanel({ title, description, actions, bodyClassName, className, children, ...props }: ToolPanelProps) {
  return (
    <section className={cx("tt2-panel", className)} {...props}>
      {(title || description || actions) ? (
        <div className="tt2-panel-head">
          <div className="min-w-0">
            {title ? <div className="tt2-panel-title">{title}</div> : null}
            {description ? <div className="tt2-panel-description">{description}</div> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cx("tt2-panel-body", bodyClassName)}>{children}</div>
    </section>
  );
}

type ToolButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function ToolButton({ variant = "secondary", size = "md", className, type = "button", ...props }: ToolButtonProps) {
  return <button type={type} className={cx("tt2-button", `tt2-button--${variant}`, size === "sm" && "tt2-button--sm", className)} {...props} />;
}

type ToolFieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function ToolField({ label, hint, error, className, children }: ToolFieldProps) {
  return (
    <label className={cx("tt2-field", className)}>
      <span className="tt2-field-label">{label}</span>
      {children}
      {error ? <span className="tt2-field-error">{error}</span> : hint ? <span className="tt2-field-hint">{hint}</span> : null}
    </label>
  );
}

export function ToolStatus({ tone = "info", children, className }: { tone?: ToolTone; children: ReactNode; className?: string }) {
  return <span className={cx("tt2-status", `tt2-status--${tone}`, className)}>{children}</span>;
}

export function ToolStat({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return <div className={cx("tt2-stat", className)}><div className="tt2-stat-label">{label}</div><div className="tt2-stat-value">{value}</div></div>;
}

export function ToolNotice({ tone, children, className }: { tone?: Exclude<ToolTone, "info">; children: ReactNode; className?: string }) {
  return <div className={cx("tt2-notice", tone && `tt2-notice--${tone}`, className)}>{children}</div>;
}

export function ToolEmptyState({ title, children, className }: { title: ReactNode; children?: ReactNode; className?: string }) {
  return <div className={cx("tt2-empty", className)}><div className="tt2-empty-title">{title}</div>{children ? <div className="tt2-empty-copy">{children}</div> : null}</div>;
}

export type ToolTab<T extends string> = { key: T; label: ReactNode; disabled?: boolean };

export function ToolTabs<T extends string>({ tabs, active, onChange, className }: { tabs: ToolTab<T>[]; active: T; onChange: (key: T) => void; className?: string }) {
  return (
    <div className={cx("tt2-tabs", className)} role="tablist">
      {tabs.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={tab.key === active} disabled={tab.disabled} className="tt2-tab" onClick={() => onChange(tab.key)}>{tab.label}</button>)}
    </div>
  );
}

export function ToolV2Scope({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("tt-tool-v2", className)}>{children}</div>;
}
