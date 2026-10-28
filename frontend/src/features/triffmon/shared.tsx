import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, Radio } from "lucide-react";
import { ToolNotice, ToolStatus } from "../../components/tool-ui";
import type { QueueHealth, TriffMonCharacter } from "./types";
import { healthLabel, healthTone } from "./utils";

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

export function CharacterPortrait({ character, size = "md" }: { character: Pick<TriffMonCharacter, "name" | "portraitUrl">; size?: "sm" | "md" | "lg" }) {
  const className = size === "sm" ? "h-8 w-8 text-[9px]" : size === "lg" ? "h-16 w-16 text-sm" : "h-10 w-10 text-[10px]";
  return character.portraitUrl ? (
    <img src={character.portraitUrl} alt="" loading="lazy" className={`${className} shrink-0 border border-[#354254] bg-[#0a0d12] object-cover`} />
  ) : (
    <div aria-hidden="true" className={`${className} grid shrink-0 place-items-center border border-[#354254] bg-[#101722] font-semibold tracking-wider text-slate-400`}>
      {initials(character.name)}
    </div>
  );
}

export function QueueStatus({ health }: { health: QueueHealth }) {
  return <ToolStatus tone={healthTone(health)}>{healthLabel(health)}</ToolStatus>;
}

export function ProgressBar({ value, label, tone = "info", compact = false }: { value: number; label?: string; tone?: "info" | "success" | "warning" | "danger"; compact?: boolean }) {
  const clamped = Math.max(0, Math.min(1, value));
  const color = tone === "success" ? "#45cf78" : tone === "warning" ? "#e4b44c" : tone === "danger" ? "#ff6978" : "#53b6ff";
  return (
    <div className="min-w-0">
      <div className={`${compact ? "h-1" : "h-1.5"} overflow-hidden bg-[#161b23]`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)} aria-label={label ?? "Progress"}>
        <div className="h-full transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${clamped * 100}%`, backgroundColor: color }} />
      </div>
      {label ? <div className="mt-1 flex justify-between gap-2 text-[9px] tabular-nums text-slate-500"><span>{label}</span><span>{Math.round(clamped * 100)}%</span></div> : null}
    </div>
  );
}

export function LevelPips({ level, targetLevel }: { level: number; targetLevel?: number | null }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`Level ${level}${targetLevel ? ` of target ${targetLevel}` : ""}`}>
      {[1, 2, 3, 4, 5].map((pip) => (
        <span
          key={pip}
          aria-hidden="true"
          className={`h-2.5 w-1.5 border ${pip <= level ? "border-[#68c4ff] bg-[#3689bd]" : pip <= (targetLevel ?? 0) ? "border-[#5c5567] bg-[#272331]" : "border-[#353a43] bg-[#101219]"}`}
        />
      ))}
    </span>
  );
}

export function BusyLine({ children = "Loading" }: { children?: ReactNode }) {
  return <div className="flex min-h-24 items-center justify-center gap-2 text-xs text-slate-400"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />{children}</div>;
}

export function InlineFeedback({ message, tone = "warning" }: { message: string | null; tone?: "success" | "warning" | "danger" }) {
  if (!message) return null;
  return <ToolNotice tone={tone} className="text-xs">{message}</ToolNotice>;
}

export function StateIcon({ state }: { state: "ready" | "training" | "warning" | "error" }) {
  if (state === "ready") return <CheckCircle2 className="h-4 w-4 text-[#45cf78]" aria-hidden="true" />;
  if (state === "training") return <Radio className="h-4 w-4 text-[#53b6ff]" aria-hidden="true" />;
  if (state === "error") return <AlertTriangle className="h-4 w-4 text-[#ff6978]" aria-hidden="true" />;
  return <Clock3 className="h-4 w-4 text-[#e4b44c]" aria-hidden="true" />;
}

export function LabeledValue({ label, children, className = "" }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="mt-0.5 text-[11px] tabular-nums text-slate-200">{children}</div>
    </div>
  );
}

