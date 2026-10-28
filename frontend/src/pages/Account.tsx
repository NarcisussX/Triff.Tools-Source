import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Copy,
  ExternalLink,
  Loader2,
  LogIn,
  Pencil,
  RefreshCw,
  Trash2,
  User,
} from "lucide-react";
import { notifySiteAuthChanged, requestSiteAuthModal } from "../auth/siteAuthEvents";
import type { AuthUser } from "../components/fitting/types";
import cargoContainerIconRaw from "../assets/icons/cargocontainer.svg?raw";
import cargoContainerLockedIconRaw from "../assets/icons/cargocontainerlocked.svg?raw";
import combatLogIconRaw from "../assets/icons/combatlog.svg?raw";
import industryIconRaw from "../assets/icons/industry.svg?raw";
import journalIconRaw from "../assets/icons/journal.svg?raw";
import marketIconRaw from "../assets/icons/market.svg?raw";
import officesIconRaw from "../assets/icons/offices.svg?raw";
import sanctionableActionsIconRaw from "../assets/icons/sanctionableactions.svg?raw";
import walletIconRaw from "../assets/icons/wallet.svg?raw";

type EveUiIconDef = {
  markup: string;
};

function makeEveUiIcon(svg: string): EveUiIconDef {
  return {
    markup: svg.replace(/^\s*<symbol\b[^>]*>/, "").replace(/<\/symbol>\s*$/, ""),
  };
}

function EveUiIcon({
  icon,
  className = "h-4 w-4",
}: {
  icon: EveUiIconDef;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 128 128"
      className={`inline-block shrink-0 ${className}`}
    >
      <style>{".shape{fill:currentColor}"}</style>
      <g dangerouslySetInnerHTML={{ __html: icon.markup }} />
    </svg>
  );
}

const ACCOUNT_ICONS = {
  gas: makeEveUiIcon(cargoContainerIconRaw),
  ore: makeEveUiIcon(cargoContainerLockedIconRaw),
  industry: makeEveUiIcon(industryIconRaw),
  item: makeEveUiIcon(journalIconRaw),
  market: makeEveUiIcon(marketIconRaw),
  pos: makeEveUiIcon(officesIconRaw),
  battleReport: makeEveUiIcon(sanctionableActionsIconRaw),
  combatLog: makeEveUiIcon(combatLogIconRaw),
  appraisal: makeEveUiIcon(walletIconRaw),
};

type AccountPageProps = {
  authUser: AuthUser | null;
  authChecked: boolean;
};

type AccountAppraisal = {
  id: string;
  url: string;
  display_name?: string | null;
  created_at: string;
  station_id: number | string;
  mode: string;
  totals: Record<string, unknown>;
  row_count: number;
};

type AccountBattleReport = {
  id: string;
  url: string;
  display_name?: string | null;
  title: string | null;
  created_at: string;
  system_name: string | null;
  start_time: string | null;
  end_time: string | null;
  summary: Record<string, unknown>;
};

type AccountCombatLogReport = {
  id: string;
  url: string;
  display_name?: string | null;
  title: string | null;
  created_at: string;
  file_name: string | null;
  listener: string | null;
  start_time: string | null;
  end_time: string | null;
  summary: Record<string, unknown>;
};

type AccountLinksPayload = {
  ok: boolean;
  appraisals: AccountAppraisal[];
  battle_reports: AccountBattleReport[];
  combat_log_reports: AccountCombatLogReport[];
};

type ToolSetup = {
  id: string;
  setupName: string;
  summaryJson?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  lastOpenedAt?: string | null;
};

type ToolSetupPayload = {
  ok: boolean;
  setups: ToolSetup[];
};

type ItemBookmark = {
  type_id: number;
  name: string;
  icon_url?: string;
  group?: { id?: number; name?: string | null } | null;
  category?: { id?: number; name?: string | null } | null;
  market_group?: { id?: number; name?: string | null } | null;
  createdAt?: string;
  updatedAt?: string;
};

type ItemBookmarksPayload = {
  ok: boolean;
  bookmarks: ItemBookmark[];
};

type QuickbarItem = {
  type_id: number;
  type_name: string;
};

type ToolStatePayload = {
  ok: boolean;
  state: { stateJson?: unknown } | null;
};

type AccountDeletionSummary = {
  totalRows: number;
  sections: { key: string; label: string; count: number }[];
  generatedPagesRemain?: boolean;
};

type AccountDeletionSummaryPayload = {
  ok: boolean;
  summary: AccountDeletionSummary;
};

type GeneratedKind = "appraisals" | "battle-reports" | "combat-logs";

type SetupGroupKey = "gas" | "ore" | "industry" | "pos";

type SetupGroupDef = {
  key: SetupGroupKey;
  title: string;
  subtitle: string;
  toolKey: string;
  toolPath: string;
  emptyText: string;
  action: string;
  icon: EveUiIconDef;
  iconClass: string;
};

const GENERATED_PAGE_SIZE = 5;
const SETUP_PAGE_SIZE = 5;
const ITEM_PAGE_SIZE = 6;
const QUICKBAR_TOOL_KEY = "market-browser-quickbar";

const HUB_LABELS: Record<string, string> = {
  "60003760": "Jita 4-4",
  "60008494": "Amarr",
  "60011866": "Dodixie",
  "60005686": "Hek",
  "60004588": "Rens",
};

const SETUP_GROUPS: SetupGroupDef[] = [
  {
    key: "gas",
    title: "Gas Saved Fleets",
    subtitle: "Fleet input snapshots for the gas huffing calculator.",
    toolKey: "gas-calc",
    toolPath: "/gas-calc",
    emptyText: "Saved gas fleets will appear here after you create them in the gas calculator.",
    action: "Open Gas",
    icon: ACCOUNT_ICONS.gas,
    iconClass: "text-[#53b6ff]",
  },
  {
    key: "ore",
    title: "Ore Saved Fleets",
    subtitle: "Fleet input snapshots for the ore mining calculator.",
    toolKey: "ore-mining",
    toolPath: "/ore",
    emptyText: "Saved ore fleets will appear here after you create them in the ore calculator.",
    action: "Open Ore",
    icon: ACCOUNT_ICONS.ore,
    iconClass: "text-[#3bbf5a]",
  },
  {
    key: "industry",
    title: "Industry Chains",
    subtitle: "Saved production chain inputs for the industry cost calculator.",
    toolKey: "industry-cost",
    toolPath: "/industry",
    emptyText: "Saved industry chains will appear here after you save them from the calculator.",
    action: "Open Industry",
    icon: ACCOUNT_ICONS.industry,
    iconClass: "text-[#ffb073]",
  },
  {
    key: "pos",
    title: "POS Designs",
    subtitle: "Saved POS designs and shopping-list references.",
    toolKey: "pos-planner",
    toolPath: "/POSPlanner",
    emptyText: "Saved POS designs will appear here after you save them from POS Planner.",
    action: "Open POS",
    icon: ACCOUNT_ICONS.pos,
    iconClass: "text-[#a78bfa]",
  },
];

const emptySetups: Record<SetupGroupKey, ToolSetup[]> = {
  gas: [],
  ore: [],
  industry: [],
  pos: [],
};

function fmtDate(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtEveRange(start?: string | null, end?: string | null) {
  if (!start && !end) return "EVE time unavailable";
  const clean = (value?: string | null) => {
    if (!value) return "?";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "?";
    return date.toISOString().replace("T", " ").slice(0, 16);
  };
  return `${clean(start)} - ${clean(end)} ET`;
}

function fmtIsk(value: unknown) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0 ISK";
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(n >= 10_000_000_000_000 ? 1 : 2)}T ISK`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 1 : 2)}B ISK`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)}M ISK`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K ISK`;
  return `${Math.round(n).toLocaleString()} ISK`;
}

function typeIconUrl(typeId: number, name?: string, size = 32) {
  const lower = String(name || "").toLowerCase();
  if (lower.includes(" blueprint")) return `https://images.evetech.net/types/${typeId}/bp?size=${size}`;
  return `https://images.evetech.net/types/${typeId}/icon?size=${size}`;
}

function appraisalTotal(row: AccountAppraisal) {
  const totals = row.totals || {};
  if (totals.adjusted != null) return totals.adjusted;
  if (row.mode === "split") return totals.split;
  if (String(row.mode).startsWith("sell")) return totals.sell;
  return totals.buy;
}

function modeLabel(mode: string) {
  if (mode === "sell5") return "Sell 5%";
  if (mode === "buy5") return "Buy 5%";
  if (mode === "sell") return "Sell min";
  if (mode === "buy") return "Buy max";
  if (mode === "split") return "Split";
  return mode || "Mode";
}

function appraisalFallbackTitle(item: AccountAppraisal) {
  const hub = HUB_LABELS[String(item.station_id)] || String(item.station_id);
  return `${hub} ${modeLabel(item.mode)} appraisal`;
}

function battleReportFallbackTitle(item: AccountBattleReport) {
  return item.title || `${item.system_name || "Battle"} Report`;
}

function combatLogFallbackTitle(item: AccountCombatLogReport) {
  return item.title || `${item.listener || "Combat"} Log Report`;
}

function copyUrl(path: string) {
  if (typeof window === "undefined" || !navigator.clipboard?.writeText) return;
  void navigator.clipboard.writeText(`${window.location.origin}${path}`);
}

function valueText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function intText(value: unknown, fallback = "0") {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : fallback;
}

function normalizeQuickbar(raw: unknown): QuickbarItem[] {
  const source = Array.isArray(raw) ? raw : [];
  const byTypeId = new Map<number, QuickbarItem>();
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<QuickbarItem> & { typeId?: unknown; typeName?: unknown };
    const typeId = Number(row.type_id ?? row.typeId);
    const typeName = String(row.type_name ?? row.typeName ?? "").trim();
    if (!Number.isInteger(typeId) || typeId <= 0 || !typeName) continue;
    byTypeId.set(typeId, { type_id: typeId, type_name: typeName.slice(0, 240) });
  }
  return Array.from(byTypeId.values()).sort((a, b) => a.type_name.localeCompare(b.type_name));
}

function normalizeQuickbarState(raw: unknown): QuickbarItem[] {
  if (Array.isArray(raw)) return normalizeQuickbar(raw);
  const source = raw && typeof raw === "object" ? raw as { quickbar?: unknown } : {};
  return normalizeQuickbar(source.quickbar);
}

async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Request failed (${response.status})`);
  }
  return payload as T;
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="tt-tool-v2 min-h-screen text-slate-100">
      <div className="tt2-frame tt2-frame--report space-y-4">{children}</div>
    </div>
  );
}

function Header({ user }: { user: AuthUser | null }) {
  return (
    <section className="tt2-window">
      <div className="tt2-titlebar flex-col items-stretch py-3 md:flex-row md:items-center">
        <div>
          <div className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
            Triff.Tools / Account
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-[26px] font-semibold leading-none text-slate-100">
            <User className="h-5 w-5 text-[#53b6ff]" />
            Account Workspace
          </h1>
        </div>
        {user && (
          <div className="border border-[#3a4655] bg-[#030509] px-3 py-2 text-[11px]">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Signed in as</div>
            <div className="mt-0.5 font-mono text-[#d7e9ff]">{user.username}</div>
          </div>
        )}
      </div>
      <div className="tt2-contextbar justify-start px-4 py-3 text-[12px] leading-relaxed text-slate-300">
        Manage Triff.Tools data here. Wormhole bookmarks and notes management is done in the Wormhole DB tool.
      </div>
    </section>
  );
}

function ActionLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      target="_blank"
      rel="noreferrer"
      className="tt2-button tt2-button--secondary tt2-button--sm"
    >
      {children}
    </Link>
  );
}

function IconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="tt2-button tt2-button--secondary tt2-button--sm w-8 px-0"
    >
      {children}
    </button>
  );
}

function Section({
  title,
  subtitle,
  count,
  children,
}: {
  title: string;
  subtitle: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="tt2-panel shadow-[0_10px_24px_rgba(0,0,0,0.2)]">
      <div className="tt2-panel-head min-h-[64px] px-3 py-2">
        <div>
          <div className="tt2-panel-title text-[#d7e9ff]">{title}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">{subtitle}</div>
        </div>
        <div className="border border-[#303236] bg-[#05070b] px-2 py-1 font-mono text-[11px] text-[#53b6ff]">
          {count}
        </div>
      </div>
      <div className="tt2-panel-body p-2">{children}</div>
    </section>
  );
}

function EmptyState({
  icon,
  title,
  text,
  to,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  to: string;
  action: string;
}) {
  return (
    <div className="tt2-empty flex min-h-full flex-col items-center justify-center border-dashed px-3 py-8 text-center">
      <div className="text-slate-500">{icon}</div>
      <div className="mt-2 text-[12px] font-semibold text-slate-200">{title}</div>
      <div className="mt-1 max-w-md text-[11px] leading-relaxed text-slate-500">{text}</div>
      <Link
        to={to}
        target="_blank"
        rel="noreferrer"
        className="tt2-button tt2-button--primary tt2-button--sm mt-3"
      >
        {action}
      </Link>
    </div>
  );
}

function PaginationControls({
  page,
  pageCount,
  setPage,
}: {
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
}) {
  if (pageCount <= 1) return <div className="mt-2 min-h-[31px]" aria-hidden />;
  return (
    <div className="mt-2 flex items-center justify-between border border-[#1d2632] bg-[#04070c] px-2 py-2 text-[10px] uppercase tracking-[0.12em] text-slate-500">
      <button
        type="button"
        className="tt2-button tt2-button--secondary tt2-button--sm"
        disabled={page <= 0}
        onClick={() => setPage(Math.max(0, page - 1))}
      >
        Prev
      </button>
      <span>
        Page <span className="font-mono text-[#53b6ff]">{page + 1}</span> / {pageCount}
      </span>
      <button
        type="button"
        className="tt2-button tt2-button--secondary tt2-button--sm"
        disabled={page >= pageCount - 1}
        onClick={() => setPage(Math.min(pageCount - 1, page + 1))}
      >
        Next
      </button>
    </div>
  );
}

function PagedList<T>({
  items,
  pageSize,
  rowMinHeight = 64,
  empty,
  render,
}: {
  items: T[];
  pageSize: number;
  rowMinHeight?: number;
  empty: ReactNode;
  render: (item: T) => ReactNode;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [items.length, pageCount]);

  const minListHeight = pageSize * rowMinHeight + Math.max(0, pageSize - 1) * 6;

  if (!items.length) {
    return (
      <>
        <div className="flex" style={{ minHeight: minListHeight }}>
          <div className="flex-1">{empty}</div>
        </div>
        <PaginationControls page={0} pageCount={1} setPage={() => undefined} />
      </>
    );
  }

  const visible = items.slice(page * pageSize, page * pageSize + pageSize);
  return (
    <>
      <div className="space-y-1.5" style={{ minHeight: minListHeight }}>{visible.map(render)}</div>
      <PaginationControls page={page} pageCount={pageCount} setPage={setPage} />
    </>
  );
}

function AppraisalRow({
  item,
  busy,
  onRename,
  onRemove,
}: {
  item: AccountAppraisal;
  busy: boolean;
  onRename: (item: AccountAppraisal) => void;
  onRemove: (item: AccountAppraisal) => void;
}) {
  const hub = HUB_LABELS[String(item.station_id)] || String(item.station_id);
  const title = valueText(item.display_name, appraisalFallbackTitle(item));
  return (
    <div className="grid min-h-[68px] gap-2 border border-[#1d2632] bg-[#060a10] px-2.5 py-2 text-[11px] hover:border-[#33445b] md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <EveUiIcon icon={ACCOUNT_ICONS.appraisal} className="h-4 w-4 text-[#53b6ff]" />
          <Link to={item.url} target="_blank" rel="noreferrer" className="truncate font-semibold text-slate-100 hover:text-[#9dd8ff]">
            {title}
          </Link>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
          <span>#{item.id}</span>
          <span>{hub}</span>
          <span>{modeLabel(item.mode)}</span>
          <span>{item.row_count.toLocaleString()} rows</span>
          <span>{fmtDate(item.created_at)}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 md:justify-end">
        <div className="pr-1 text-right font-mono text-[12px] text-[#39e979]">{fmtIsk(appraisalTotal(item))}</div>
        <ActionLink to={item.url}>
          <ExternalLink className="h-3.5 w-3.5" />
          Open
        </ActionLink>
        <IconButton title="Copy appraisal link" onClick={() => copyUrl(item.url)}>
          <Copy className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton title="Rename account label" disabled={busy} onClick={() => onRename(item)}>
          <Pencil className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton title="Remove from account list" disabled={busy} onClick={() => onRemove(item)}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

function BattleReportRow({
  item,
  busy,
  onRename,
  onRemove,
}: {
  item: AccountBattleReport;
  busy: boolean;
  onRename: (item: AccountBattleReport) => void;
  onRemove: (item: AccountBattleReport) => void;
}) {
  const summary = item.summary || {};
  const title = valueText(item.display_name, battleReportFallbackTitle(item));
  return (
    <div className="grid min-h-[68px] gap-2 border border-[#1d2632] bg-[#060a10] px-2.5 py-2 text-[11px] hover:border-[#33445b] md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <EveUiIcon icon={ACCOUNT_ICONS.battleReport} className="h-4 w-4 text-[#ff9a3c]" />
          <Link to={item.url} target="_blank" rel="noreferrer" className="truncate font-semibold text-slate-100 hover:text-[#9dd8ff]">
            {title}
          </Link>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
          <span>#{item.id}</span>
          <span>{item.system_name || "Multi-system"}</span>
          <span>{fmtEveRange(item.start_time, item.end_time)}</span>
          <span>{fmtDate(item.created_at)}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 md:justify-end">
        <div className="pr-1 text-right text-[10px] uppercase tracking-[0.12em] text-slate-500">
          <span className="font-mono text-[12px] text-[#ffb073]">{fmtIsk(summary.totalIskDestroyed)}</span>
          <span className="ml-2">{Number(summary.totalKills || summary.shipsLost || 0).toLocaleString()} kills</span>
        </div>
        <ActionLink to={item.url}>
          <ExternalLink className="h-3.5 w-3.5" />
          Open
        </ActionLink>
        <IconButton title="Copy battle report link" onClick={() => copyUrl(item.url)}>
          <Copy className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton title="Rename account label" disabled={busy} onClick={() => onRename(item)}>
          <Pencil className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton title="Remove from account list" disabled={busy} onClick={() => onRemove(item)}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

function CombatLogReportRow({
  item,
  busy,
  onRename,
  onRemove,
}: {
  item: AccountCombatLogReport;
  busy: boolean;
  onRename: (item: AccountCombatLogReport) => void;
  onRemove: (item: AccountCombatLogReport) => void;
}) {
  const summary = item.summary || {};
  const title = valueText(item.display_name, combatLogFallbackTitle(item));
  return (
    <div className="grid min-h-[68px] gap-2 border border-[#1d2632] bg-[#060a10] px-2.5 py-2 text-[11px] hover:border-[#33445b] md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <EveUiIcon icon={ACCOUNT_ICONS.combatLog} className="h-4 w-4 text-[#53b6ff]" />
          <Link to={item.url} target="_blank" rel="noreferrer" className="truncate font-semibold text-slate-100 hover:text-[#9dd8ff]">
            {title}
          </Link>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
          <span>#{item.id}</span>
          <span>{item.listener || "Unknown pilot"}</span>
          <span>{fmtEveRange(item.start_time, item.end_time)}</span>
          <span>{fmtDate(item.created_at)}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 md:justify-end">
        <div className="pr-1 text-right text-[10px] uppercase tracking-[0.12em] text-slate-500">
          <span className="font-mono text-[12px] text-[#53b6ff]">{intText(summary.damageOut)} dmg</span>
          <span className="ml-2">{Number(summary.combatEvents || 0).toLocaleString()} events</span>
        </div>
        <ActionLink to={item.url}>
          <ExternalLink className="h-3.5 w-3.5" />
          Open
        </ActionLink>
        <IconButton title="Copy combat log report link" onClick={() => copyUrl(item.url)}>
          <Copy className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton title="Rename account label" disabled={busy} onClick={() => onRename(item)}>
          <Pencil className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton title="Remove from account list" disabled={busy} onClick={() => onRemove(item)}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

function setupSummary(def: SetupGroupDef, setup: ToolSetup) {
  const s = setup.summaryJson || {};
  if (def.key === "gas") {
    return [
      `${intText(s.shipCount, "1")}x ${valueText(s.ship, "Fleet")}`,
      valueText(s.moduleType),
      valueText(s.boostShip, "No boosts"),
    ].filter(Boolean);
  }
  if (def.key === "ore") {
    return [
      `${intText(s.shipCount, "1")}x ${valueText(s.ship, "Fleet")}`,
      valueText(s.module),
      valueText(s.boostShip, "No boosts"),
    ].filter(Boolean);
  }
  if (def.key === "industry") {
    return [
      valueText(s.firstItem, "Production chain"),
      `${intText(s.itemCount)} item${Number(s.itemCount || 0) === 1 ? "" : "s"}`,
    ].filter(Boolean);
  }
  return [
    valueText(s.towerName, "POS design"),
    `${intText(s.moduleCount)} modules`,
    `${intText(s.hours)} hours`,
  ].filter(Boolean);
}

function ToolSetupRow({
  def,
  setup,
  busy,
  onRename,
  onDelete,
}: {
  def: SetupGroupDef;
  setup: ToolSetup;
  busy: boolean;
  onRename: (def: SetupGroupDef, setup: ToolSetup) => void;
  onDelete: (def: SetupGroupDef, setup: ToolSetup) => void;
}) {
  const summary = setupSummary(def, setup);
  return (
    <div className="grid min-h-[64px] gap-2 border border-[#1d2632] bg-[#060a10] px-2.5 py-2 text-[11px] hover:border-[#33445b] md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <EveUiIcon icon={def.icon} className={`h-4 w-4 ${def.iconClass}`} />
          <Link to={def.toolPath} target="_blank" rel="noreferrer" className="truncate font-semibold text-slate-100 hover:text-[#9dd8ff]">
            {setup.setupName}
          </Link>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
          {summary.map((part) => (
            <span key={part}>{part}</span>
          ))}
          <span>Updated {fmtDate(setup.updatedAt)}</span>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <ActionLink to={def.toolPath}>
          <ExternalLink className="h-3.5 w-3.5" />
          Tool
        </ActionLink>
        <IconButton title="Rename saved setup" disabled={busy} onClick={() => onRename(def, setup)}>
          <Pencil className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton title="Delete saved setup" disabled={busy} onClick={() => onDelete(def, setup)}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

function ItemBookmarkRow({
  item,
  busy,
  onRemove,
}: {
  item: ItemBookmark;
  busy: boolean;
  onRemove: (item: ItemBookmark) => void;
}) {
  const icon = item.icon_url || typeIconUrl(item.type_id, item.name, 32);
  const group = item.market_group?.name || item.group?.name || item.category?.name || "Item";
  return (
    <div className="grid min-h-[60px] gap-2 border border-[#1d2632] bg-[#060a10] px-2.5 py-2 text-[11px] hover:border-[#33445b] md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex min-w-0 items-center gap-2">
        <img src={icon} alt="" className="h-7 w-7 shrink-0 bg-[#02050a]" />
        <div className="min-w-0">
          <Link to={`/items/${item.type_id}`} target="_blank" rel="noreferrer" className="block truncate font-semibold text-slate-100 hover:text-[#9dd8ff]">
            {item.name}
          </Link>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
            <span>TypeID {item.type_id}</span>
            <span>{group}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <ActionLink to={`/items/${item.type_id}`}>
          <ExternalLink className="h-3.5 w-3.5" />
          Item
        </ActionLink>
        <IconButton title="Remove item bookmark" disabled={busy} onClick={() => onRemove(item)}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

function QuickbarRow({
  item,
  busy,
  onRemove,
}: {
  item: QuickbarItem;
  busy: boolean;
  onRemove: (item: QuickbarItem) => void;
}) {
  return (
    <div className="grid min-h-[60px] gap-2 border border-[#1d2632] bg-[#060a10] px-2.5 py-2 text-[11px] hover:border-[#33445b] md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex min-w-0 items-center gap-2">
        <img src={typeIconUrl(item.type_id, item.type_name, 32)} alt="" className="h-7 w-7 shrink-0 bg-[#02050a]" />
        <div className="min-w-0">
          <Link to={`/market?type_id=${item.type_id}`} target="_blank" rel="noreferrer" className="block truncate font-semibold text-slate-100 hover:text-[#9dd8ff]">
            {item.type_name}
          </Link>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-500">TypeID {item.type_id}</div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <ActionLink to={`/market?type_id=${item.type_id}`}>
          <ExternalLink className="h-3.5 w-3.5" />
          Market
        </ActionLink>
        <IconButton title="Remove from quickbar" disabled={busy} onClick={() => onRemove(item)}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

function SignedOut() {
  return (
    <section className="tt2-panel p-4 shadow-[0_10px_28px_rgba(0,0,0,0.3)]">
      <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-[#53b6ff]">Account required</div>
          <h2 className="mt-1 text-[20px] font-semibold text-slate-100">Sign in to open your workspace.</h2>
          <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-slate-400">
            Saved links, fleets, chains, POS designs, bookmarks, and quickbar items are tied to your Triff.Tools account.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => requestSiteAuthModal("login")}
            className="tt2-button tt2-button--secondary"
          >
            <LogIn className="h-4 w-4" />
            Sign In
          </button>
          <button
            type="button"
            onClick={() => requestSiteAuthModal("register")}
            className="tt2-button tt2-button--primary"
          >
            Create Account
          </button>
        </div>
      </div>
    </section>
  );
}

function AccountDeletionPanel({
  user,
  onDeleted,
}: {
  user: AuthUser;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<AccountDeletionSummary | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openDeleteDialog() {
    setOpen(true);
    setPassword("");
    setConfirmation("");
    setError(null);
    setLoading(true);
    try {
      const payload = await apiJson<AccountDeletionSummaryPayload>("/api/account/deletion-summary");
      setSummary(payload.summary);
    } catch (err) {
      setError((err as Error).message || "Failed to load account deletion summary.");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  async function submitDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiJson<{ ok: boolean; deleted: boolean }>("/api/account/me", {
        method: "DELETE",
        body: JSON.stringify({ password, confirmation }),
      });
      setOpen(false);
      setPassword("");
      setConfirmation("");
      onDeleted();
    } catch (err) {
      setError((err as Error).message || "Failed to delete account.");
    } finally {
      setBusy(false);
    }
  }

  const topSections = summary?.sections.slice(0, 6) || [];
  const remainingSections = Math.max(0, (summary?.sections.length || 0) - topSections.length);
  const canSubmit = password.length > 0 && confirmation === "DELETE" && !busy;

  return (
    <section className="border border-[#53252d] bg-[#10070a] shadow-[0_0_28px_rgba(0,0,0,0.72)]">
      <div className="grid gap-3 px-3 py-4 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border border-[#6b2c35] bg-[#1a080d] text-[#ff8792]">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-[#ff8792]">Danger Zone</div>
            <h2 className="mt-1 text-[18px] font-semibold text-slate-100">Delete Triff.Tools account</h2>
            <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-slate-400">
              Permanently deletes your sign-in, sessions, saved fits, ESI links, bookmarks, saved tool
              setups, and account-owned workspace state. Generated public appraisal and battle report pages are detached
              from your account rather than removed.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void openDeleteDialog()}
          className="inline-flex h-9 items-center justify-center gap-2 border border-[#7e303b] bg-[#21080e] px-4 text-[11px] font-bold uppercase tracking-[0.12em] text-[#ffd3d7] hover:border-[#ff8792] hover:bg-[#2e0b13]"
        >
          <Trash2 className="h-4 w-4" />
          Delete Account
        </button>
      </div>

      {open && typeof document !== "undefined" && createPortal(
        <div className="tt-tool-v2 fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 px-3 py-6">
          <form
            onSubmit={(event) => void submitDelete(event)}
            className="w-full max-w-[560px] border border-[#58313a] bg-[#070a10] text-slate-100 shadow-[0_0_40px_rgba(0,0,0,0.9)]"
          >
            <div className="border-b border-[#30343d] bg-[#111821] px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[#ff8792]">Permanent Action</div>
              <h3 className="mt-1 text-[18px] font-semibold">Delete {user.username}</h3>
            </div>
            <div className="space-y-4 px-4 py-4">
              <p className="text-[12px] leading-relaxed text-slate-300">
                This cannot be undone. You will be signed out everywhere, and ESI tokens stored by Triff.Tools will be
                removed.
              </p>

              <div className="border border-[#242b36] bg-[#05070b] p-3">
                <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">Deletion Summary</div>
                {loading ? (
                  <div className="flex items-center gap-2 text-[12px] text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin text-[#53b6ff]" />
                    Checking account data...
                  </div>
                ) : topSections.length ? (
                  <>
                    <div className="grid gap-1.5">
                      {topSections.map((section) => (
                        <div key={section.key} className="flex items-center justify-between gap-3 text-[12px]">
                          <span className="text-slate-300">{section.label}</span>
                          <span className="font-mono text-slate-500">{section.count}</span>
                        </div>
                      ))}
                    </div>
                    {remainingSections > 0 && (
                      <div className="mt-2 text-[11px] text-slate-500">
                        Plus {remainingSections} more account data group{remainingSections === 1 ? "" : "s"}.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-[12px] text-slate-500">No saved account rows were found yet.</div>
                )}
              </div>

              {error && (
                <div className="border border-[#74313b] bg-[#18080d] px-3 py-2 text-[12px] text-[#ff9aa3]">
                  {error}
                </div>
              )}

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  className="mt-1 w-full border border-[#343842] bg-[#05070b] px-3 py-2 text-[14px] text-slate-100 outline-none focus:border-[#5f9edb]"
                />
              </label>

              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Type DELETE</span>
                <input
                  type="text"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                  className="mt-1 w-full border border-[#343842] bg-[#05070b] px-3 py-2 font-mono text-[14px] text-slate-100 outline-none focus:border-[#5f9edb]"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#30343d] px-4 py-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="h-9 border border-[#343842] bg-[#05070b] px-4 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-300 hover:border-[#5f9edb] hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex h-9 items-center justify-center gap-2 border border-[#8f3944] bg-[#341019] px-4 text-[11px] font-bold uppercase tracking-[0.12em] text-[#ffdce0] hover:border-[#ff8792] hover:bg-[#461622] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete Forever
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </section>
  );
}

export default function Account({ authUser, authChecked }: AccountPageProps) {
  const [links, setLinks] = useState<AccountLinksPayload | null>(null);
  const [setups, setSetups] = useState<Record<SetupGroupKey, ToolSetup[]>>(emptySetups);
  const [bookmarks, setBookmarks] = useState<ItemBookmark[]>([]);
  const [quickbar, setQuickbar] = useState<QuickbarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    if (!authChecked) return;
    if (!authUser) {
      setLinks(null);
      setSetups(emptySetups);
      setBookmarks([]);
      setQuickbar([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [linkData, bookmarkData, gas, ore, industry, pos, quickbarState] = await Promise.all([
        apiJson<AccountLinksPayload>("/api/account/links?limit=100"),
        apiJson<ItemBookmarksPayload>("/api/items/bookmarks"),
        apiJson<ToolSetupPayload>("/api/tool-setups/gas-calc"),
        apiJson<ToolSetupPayload>("/api/tool-setups/ore-mining"),
        apiJson<ToolSetupPayload>("/api/tool-setups/industry-cost"),
        apiJson<ToolSetupPayload>("/api/tool-setups/pos-planner"),
        apiJson<ToolStatePayload>(`/api/tool-state/${QUICKBAR_TOOL_KEY}`),
      ]);

      setLinks(linkData);
      setBookmarks(bookmarkData.bookmarks || []);
      setSetups({
        gas: gas.setups || [],
        ore: ore.setups || [],
        industry: industry.setups || [],
        pos: pos.setups || [],
      });
      setQuickbar(normalizeQuickbarState(quickbarState.state?.stateJson));
    } catch (err) {
      setError((err as Error).message || "Failed to load account workspace.");
    } finally {
      setLoading(false);
    }
  }, [authChecked, authUser?.id]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const counts = useMemo(
    () => ({
      appraisals: links?.appraisals?.length || 0,
      battleReports: links?.battle_reports?.length || 0,
      combatLogs: links?.combat_log_reports?.length || 0,
      bookmarks: bookmarks.length,
      quickbar: quickbar.length,
    }),
    [bookmarks.length, links, quickbar.length]
  );

  async function removeGenerated(kind: GeneratedKind, item: { id: string }) {
    const label = kind === "appraisals" ? "appraisal" : kind === "battle-reports" ? "battle report" : "combat log report";
    if (!window.confirm(`Remove this ${label} link from your account page? The shared page will still exist.`)) return;
    setBusyKey(`${kind}:${item.id}`);
    try {
      await apiJson<{ ok: boolean }>(`/api/account/links/${kind}/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      setLinks((prev) => {
        if (!prev) return prev;
        if (kind === "appraisals") {
          return { ...prev, appraisals: prev.appraisals.filter((row) => row.id !== item.id) };
        }
        if (kind === "battle-reports") {
          return { ...prev, battle_reports: prev.battle_reports.filter((row) => row.id !== item.id) };
        }
        return { ...prev, combat_log_reports: (prev.combat_log_reports || []).filter((row) => row.id !== item.id) };
      });
    } catch (err) {
      setError((err as Error).message || `Failed to remove ${label}.`);
    } finally {
      setBusyKey(null);
    }
  }

  async function renameGenerated(kind: GeneratedKind, item: AccountAppraisal | AccountBattleReport | AccountCombatLogReport) {
    const currentName =
      kind === "appraisals"
        ? valueText((item as AccountAppraisal).display_name, appraisalFallbackTitle(item as AccountAppraisal))
        : kind === "battle-reports"
        ? valueText((item as AccountBattleReport).display_name, battleReportFallbackTitle(item as AccountBattleReport))
        : valueText((item as AccountCombatLogReport).display_name, combatLogFallbackTitle(item as AccountCombatLogReport));
    const nextName = window.prompt(`Rename account label`, currentName)?.trim();
    if (!nextName || nextName === currentName) return;
    setBusyKey(`${kind}:${item.id}`);
    try {
      const payload = await apiJson<{ ok: boolean; link: { displayName: string } }>(
        `/api/account/links/${kind}/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ displayName: nextName }),
        }
      );
      setLinks((prev) => {
        if (!prev) return prev;
        if (kind === "appraisals") {
          return {
            ...prev,
            appraisals: prev.appraisals.map((row) =>
              row.id === item.id ? { ...row, display_name: payload.link.displayName } : row
            ),
          };
        }
        if (kind === "battle-reports") {
          return {
            ...prev,
            battle_reports: prev.battle_reports.map((row) =>
              row.id === item.id ? { ...row, display_name: payload.link.displayName } : row
            ),
          };
        }
        return {
          ...prev,
          combat_log_reports: (prev.combat_log_reports || []).map((row) =>
            row.id === item.id ? { ...row, display_name: payload.link.displayName } : row
          ),
        };
      });
    } catch (err) {
      setError((err as Error).message || "Failed to rename account label.");
    } finally {
      setBusyKey(null);
    }
  }

  async function renameSetup(def: SetupGroupDef, setup: ToolSetup) {
    const nextName = window.prompt(`Rename ${setup.setupName}`, setup.setupName)?.trim();
    if (!nextName || nextName === setup.setupName) return;
    setBusyKey(`${def.key}:${setup.id}`);
    try {
      const payload = await apiJson<{ ok: boolean; setup: ToolSetup }>(
        `/api/tool-setups/${def.toolKey}/${encodeURIComponent(setup.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ setupName: nextName }),
        }
      );
      setSetups((prev) => ({
        ...prev,
        [def.key]: prev[def.key].map((row) => (row.id === setup.id ? payload.setup : row)),
      }));
    } catch (err) {
      setError((err as Error).message || "Failed to rename saved setup.");
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteSetup(def: SetupGroupDef, setup: ToolSetup) {
    if (!window.confirm(`Delete "${setup.setupName}" from your saved ${def.title.toLowerCase()}?`)) return;
    setBusyKey(`${def.key}:${setup.id}`);
    try {
      await apiJson<{ ok: boolean }>(`/api/tool-setups/${def.toolKey}/${encodeURIComponent(setup.id)}`, {
        method: "DELETE",
      });
      setSetups((prev) => ({
        ...prev,
        [def.key]: prev[def.key].filter((row) => row.id !== setup.id),
      }));
    } catch (err) {
      setError((err as Error).message || "Failed to delete saved setup.");
    } finally {
      setBusyKey(null);
    }
  }

  async function removeBookmark(item: ItemBookmark) {
    if (!window.confirm(`Remove item bookmark "${item.name}"?`)) return;
    setBusyKey(`item:${item.type_id}`);
    try {
      await apiJson<{ ok: boolean }>(`/api/items/bookmarks/${encodeURIComponent(String(item.type_id))}`, {
        method: "DELETE",
      });
      setBookmarks((prev) => prev.filter((row) => row.type_id !== item.type_id));
    } catch (err) {
      setError((err as Error).message || "Failed to remove item bookmark.");
    } finally {
      setBusyKey(null);
    }
  }

  async function saveQuickbar(nextQuickbar: QuickbarItem[]) {
    await apiJson<{ ok: boolean }>(`/api/tool-state/${QUICKBAR_TOOL_KEY}`, {
      method: "PUT",
      body: JSON.stringify({
        stateJson: {
          version: 1,
          quickbar: normalizeQuickbar(nextQuickbar),
        },
      }),
    });
  }

  async function removeQuickbarItem(item: QuickbarItem) {
    if (!window.confirm(`Remove "${item.type_name}" from your market quickbar?`)) return;
    const next = quickbar.filter((row) => row.type_id !== item.type_id);
    setBusyKey(`quickbar:${item.type_id}`);
    try {
      await saveQuickbar(next);
      setQuickbar(next);
    } catch (err) {
      setError((err as Error).message || "Failed to update market quickbar.");
    } finally {
      setBusyKey(null);
    }
  }

  async function clearQuickbar() {
    if (!quickbar.length || !window.confirm("Clear your account market quickbar?")) return;
    setBusyKey("quickbar:clear");
    try {
      await saveQuickbar([]);
      setQuickbar([]);
    } catch (err) {
      setError((err as Error).message || "Failed to clear market quickbar.");
    } finally {
      setBusyKey(null);
    }
  }

  function handleAccountDeleted() {
    setLinks(null);
    setSetups(emptySetups);
    setBookmarks([]);
    setQuickbar([]);
    setBusyKey(null);
    setError(null);
    notifySiteAuthChanged(null);
  }

  return (
    <PageShell>
      <Header user={authUser} />

      {!authChecked && (
        <section className="tt2-notice flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-[#53b6ff]" />
          Checking account session...
        </section>
      )}

      {authChecked && !authUser && <SignedOut />}

      {authUser && (
        <>
          {loading && (
            <section className="tt2-notice flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-[#53b6ff]" />
              Loading account workspace...
            </section>
          )}

          {error && (
            <section className="tt2-notice tt2-notice--danger flex items-center justify-between gap-3">
              <span>{error}</span>
              <button
                type="button"
                className="tt2-button tt2-button--danger tt2-button--sm"
                onClick={() => {
                  setError(null);
                  void loadWorkspace();
                }}
              >
                Retry
              </button>
            </section>
          )}

          {!loading && (
            <>
              <div className="grid gap-3 xl:grid-cols-2">
                <Section
                  title="Saved Appraisal Links"
                  subtitle="ISKtimate snapshots generated while signed in."
                  count={counts.appraisals}
                >
                  <PagedList
                    items={links?.appraisals || []}
                    pageSize={GENERATED_PAGE_SIZE}
                    rowMinHeight={68}
                    render={(item) => (
                      <AppraisalRow
                        key={item.id}
                        item={item}
                        busy={busyKey === `appraisals:${item.id}`}
                        onRename={(row) => void renameGenerated("appraisals", row)}
                        onRemove={(row) => void removeGenerated("appraisals", row)}
                      />
                    )}
                    empty={
                      <EmptyState
                        icon={<EveUiIcon icon={ACCOUNT_ICONS.appraisal} className="h-7 w-7" />}
                        title="No appraisal links yet."
                        text="Create an ISKtimate appraisal while signed in and it will show up here."
                        to="/appraisals"
                        action="Create Appraisal"
                      />
                    }
                  />
                </Section>

                <Section
                  title="Generated Battle Reports"
                  subtitle="Shareable BR pages created from this account."
                  count={counts.battleReports}
                >
                  <PagedList
                    items={links?.battle_reports || []}
                    pageSize={GENERATED_PAGE_SIZE}
                    rowMinHeight={68}
                    render={(item) => (
                      <BattleReportRow
                        key={item.id}
                        item={item}
                        busy={busyKey === `battle-reports:${item.id}`}
                        onRename={(row) => void renameGenerated("battle-reports", row)}
                        onRemove={(row) => void removeGenerated("battle-reports", row)}
                      />
                    )}
                    empty={
                      <EmptyState
                        icon={<EveUiIcon icon={ACCOUNT_ICONS.battleReport} className="h-7 w-7" />}
                        title="No battle reports yet."
                        text="Generate a BattleReport while signed in and the finished link will be saved here."
                        to="/br"
                        action="Generate BR"
                      />
                    }
                  />
                </Section>

                <Section
                  title="Combat Log Reports"
                  subtitle="Shareable combat log parses created from this account."
                  count={counts.combatLogs}
                >
                  <PagedList
                    items={links?.combat_log_reports || []}
                    pageSize={GENERATED_PAGE_SIZE}
                    rowMinHeight={68}
                    render={(item) => (
                      <CombatLogReportRow
                        key={item.id}
                        item={item}
                        busy={busyKey === `combat-logs:${item.id}`}
                        onRename={(row) => void renameGenerated("combat-logs", row)}
                        onRemove={(row) => void removeGenerated("combat-logs", row)}
                      />
                    )}
                    empty={
                      <EmptyState
                        icon={<EveUiIcon icon={ACCOUNT_ICONS.combatLog} className="h-7 w-7" />}
                        title="No combat log reports yet."
                        text="Share a combat log report while signed in and the finished link will be saved here."
                        to="/combat-logs"
                        action="Parse Log"
                      />
                    }
                  />
                </Section>
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                {SETUP_GROUPS.map((def) => (
                  <Section key={def.key} title={def.title} subtitle={def.subtitle} count={setups[def.key].length}>
                    <PagedList
                      items={setups[def.key]}
                      pageSize={SETUP_PAGE_SIZE}
                      rowMinHeight={64}
                      render={(item) => (
                        <ToolSetupRow
                          key={item.id}
                          def={def}
                          setup={item}
                          busy={busyKey === `${def.key}:${item.id}`}
                          onRename={(group, setup) => void renameSetup(group, setup)}
                          onDelete={(group, setup) => void deleteSetup(group, setup)}
                        />
                      )}
                      empty={
                        <EmptyState
                          icon={<EveUiIcon icon={def.icon} className="h-7 w-7" />}
                          title={`No ${def.title.toLowerCase()} yet.`}
                          text={def.emptyText}
                          to={def.toolPath}
                          action={def.action}
                        />
                      }
                    />
                  </Section>
                ))}
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                <Section
                  title="Bookmarked Items"
                  subtitle="Item Browser bookmarks for quick reference."
                  count={counts.bookmarks}
                >
                  <PagedList
                    items={bookmarks}
                    pageSize={ITEM_PAGE_SIZE}
                    rowMinHeight={60}
                    render={(item) => (
                      <ItemBookmarkRow
                        key={item.type_id}
                        item={item}
                        busy={busyKey === `item:${item.type_id}`}
                        onRemove={(row) => void removeBookmark(row)}
                      />
                    )}
                    empty={
                      <EmptyState
                        icon={<EveUiIcon icon={ACCOUNT_ICONS.item} className="h-7 w-7" />}
                        title="No bookmarked items yet."
                        text="Bookmark items from the Item Browser and they will appear here."
                        to="/items"
                        action="Open Items"
                      />
                    }
                  />
                </Section>

                <Section
                  title="Market Quickbar"
                  subtitle="Synced Market Browser quickbar items."
                  count={counts.quickbar}
                >
                  {!!quickbar.length && (
                    <div className="mb-2 flex justify-end">
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 border border-[#2f425b] bg-[#0d1521] px-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300 hover:border-[#5f9edb] hover:bg-[#111d2b] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={busyKey === "quickbar:clear"}
                        onClick={() => void clearQuickbar()}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Clear
                      </button>
                    </div>
                  )}
                  <PagedList
                    items={quickbar}
                    pageSize={ITEM_PAGE_SIZE}
                    rowMinHeight={60}
                    render={(item) => (
                      <QuickbarRow
                        key={item.type_id}
                        item={item}
                        busy={busyKey === `quickbar:${item.type_id}` || busyKey === "quickbar:clear"}
                        onRemove={(row) => void removeQuickbarItem(row)}
                      />
                    )}
                    empty={
                      <EmptyState
                        icon={<EveUiIcon icon={ACCOUNT_ICONS.market} className="h-7 w-7" />}
                        title="No quickbar items yet."
                        text="Add items to the Market Browser quickbar while signed in and they will sync here."
                        to="/market"
                        action="Open Market"
                      />
                    }
                  />
                </Section>
              </div>

              <AccountDeletionPanel user={authUser} onDeleted={handleAccountDeleted} />
            </>
          )}
        </>
      )}
    </PageShell>
  );
}
