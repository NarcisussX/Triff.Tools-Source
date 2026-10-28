import type { QueueHealth, TrainingItem, TriffMonCharacter, TriffMonRoute } from "./types";

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const COMPACT_NUMBER = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const ISK = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function parseTriffMonRoute(pathname: string): TriffMonRoute {
  const parts = pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  const root = parts[0]?.toLowerCase();
  if (root !== "skillnix" && root !== "triffmon") return { view: "dashboard" };
  if (parts[1] === "characters" && parts[2]) {
    return { view: "character", characterId: parts[2], tab: parts[3] === "queue" ? "queue" : "skills" };
  }
  if (parts[1] === "plans") return { view: "plans", planId: parts[2] ?? null };
  if (parts[1] === "requirements") return { view: "requirements" };
  return { view: "dashboard" };
}

export function characterPath(characterId: string, tab: "skills" | "queue"): string {
  return `/skillnix/characters/${encodeURIComponent(characterId)}/${tab}`;
}

export function planPath(planId?: string | null): string {
  return planId ? `/skillnix/plans/${encodeURIComponent(planId)}` : "/skillnix/plans";
}

export function monitorCharacterId(character: Pick<TriffMonCharacter, "id" | "characterId">): string {
  return String(character.characterId ?? character.id);
}

export function formatNumber(value: number | null | undefined, compact = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return (compact ? COMPACT_NUMBER : NUMBER).format(value);
}

export function formatIsk(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${ISK.format(value)} ISK`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? DATE.format(date) : "—";
}

export function formatDuration(seconds: number | null | undefined, options: { short?: boolean; empty?: string } = {}): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return options.empty ?? "—";
  const sign = seconds < 0 ? "-" : "";
  let remaining = Math.max(0, Math.floor(Math.abs(seconds)));
  const days = Math.floor(remaining / 86_400);
  remaining -= days * 86_400;
  const hours = Math.floor(remaining / 3_600);
  remaining -= hours * 3_600;
  const minutes = Math.floor(remaining / 60);
  const secs = remaining - minutes * 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  if (!days && (minutes || hours)) parts.push(`${minutes}m`);
  if (!days && !hours && (!options.short || parts.length === 0)) parts.push(`${secs}s`);
  return `${sign}${parts.slice(0, options.short ? 2 : 3).join(" ") || "0s"}`;
}

export function secondsUntil(value: string | null | undefined, now: number): number | null {
  if (!value) return null;
  const target = new Date(value).getTime();
  return Number.isFinite(target) ? Math.max(0, (target - now) / 1000) : null;
}

export function secondsBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  return Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, (endMs - startMs) / 1000) : null;
}

export function trainingProgress(item: TrainingItem | null, now: number): number {
  if (!item) return 0;
  const startMs = item.startAt ? new Date(item.startAt).getTime() : Number.NaN;
  const endMs = item.endAt ? new Date(item.endAt).getTime() : Number.NaN;
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
    return Math.max(0, Math.min(1, (now - startMs) / (endMs - startMs)));
  }
  if (item.startSp !== null && item.endSp !== null && item.completedSp !== null && item.endSp > item.startSp) {
    return Math.max(0, Math.min(1, (item.completedSp - item.startSp) / (item.endSp - item.startSp)));
  }
  return 0;
}

export function freshnessLabel(value: string | null | undefined, now: number): string {
  if (!value) return "Never synced";
  const updated = new Date(value).getTime();
  if (!Number.isFinite(updated)) return "Unknown sync";
  const seconds = Math.max(0, (now - updated) / 1000);
  if (seconds < 45) return "Just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function healthLabel(health: QueueHealth): string {
  switch (health) {
    case "healthy": return "Healthy";
    case "warning": return "Warning";
    case "critical": return "Critical";
    case "gap": return "Training gap";
    case "paused": return "Queue paused";
    case "empty": return "Queue empty";
    case "error": return "Attention";
  }
}

export function healthTone(health: QueueHealth): "success" | "warning" | "danger" | "info" {
  if (health === "healthy") return "success";
  if (health === "warning" || health === "gap" || health === "paused") return "warning";
  if (health === "critical" || health === "error") return "danger";
  return "info";
}

export function liveTrainingItem(character: TriffMonCharacter, now: number): TrainingItem | null {
  return [character.currentTraining, character.nextTraining].find((item) => {
    if (!item) return false;
    const start = item.startAt ? new Date(item.startAt).getTime() : Number.NaN;
    const end = item.endAt ? new Date(item.endAt).getTime() : Number.NaN;
    return (!Number.isFinite(start) || start <= now) && Number.isFinite(end) && end > now;
  }) ?? null;
}

export function liveQueueHealth(character: TriffMonCharacter, now: number): QueueHealth {
  if (character.error || ["reauth_required", "missing_scopes", "revoked", "invalid"].includes(character.tokenStatus.toLowerCase())) return "error";
  const state = character.queueState.toLowerCase();
  const active = liveTrainingItem(character, now);
  const hasFutureTraining = [character.currentTraining, character.nextTraining].some((item) => {
    if (!item) return false;
    const start = item.startAt ? new Date(item.startAt).getTime() : Number.NaN;
    const end = item.endAt ? new Date(item.endAt).getTime() : Number.NaN;
    return Number.isFinite(start) && start > now && Number.isFinite(end) && end > now;
  });
  if (!active && (hasFutureTraining || state === "gap")) return "gap";
  const endMs = character.queueEndAt ? new Date(character.queueEndAt).getTime() : Number.NaN;
  if (!Number.isFinite(endMs) || endMs <= now) return "empty";
  if (!active && (state === "paused" || character.queueLength > 0)) return "paused";
  const remaining = endMs - now;
  if (remaining <= 24 * 60 * 60 * 1000) return "critical";
  if (remaining <= 72 * 60 * 60 * 1000) return "warning";
  return "healthy";
}

export function safeLocalStorageGet<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value && allowed.includes(value as T) ? value as T : fallback;
  } catch {
    return fallback;
  }
}

export function safeLocalStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Device-local display preferences are optional.
  }
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong while loading Skillnix.";
}

export function uniqueBy<T>(items: T[], key: (item: T) => string | number): T[] {
  const seen = new Set<string | number>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
