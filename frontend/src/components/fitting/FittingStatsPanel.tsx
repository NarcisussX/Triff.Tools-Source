import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import walletIconRaw from "../../assets/icons/wallet.svg?raw";
import { triffApiFetch } from "../../lib/webRuntime";
import FittingWarnings from "./FittingWarnings";
import { EveTypeIcon, EveUiSymbolIcon, PyfaGuiIcon } from "./FittingIcon";
import type { PyfaGuiIconName } from "./FittingIcon";
import type { DamageProfileNode, DamageProfileSelection, DamageValues, FitMessage, FittingStats, LinkedEsiCharacter, LocalTankRows, RechargeRateRow, SkillProfile, SkillWarning } from "./types";

type Props = {
  stats: FittingStats | null;
  warnings: FitMessage[];
  errors: FitMessage[];
  loading?: boolean;
  skillProfile?: SkillProfile;
  linkedCharacters?: LinkedEsiCharacter[];
  selectedCharacter?: LinkedEsiCharacter | null;
  esiPending?: boolean;
  esiBusy?: string | null;
  onSkillProfileChange?: (value: string) => void;
  skillOverrideCount?: number;
  onClearSkillOverrides?: () => void;
  showSkillSelector?: boolean;
  showMessages?: boolean;
  damageProfile?: DamageProfileSelection | null;
  onDamageProfileChange?: (profile: DamageProfileSelection) => void;
  mobileDamageProfileMenu?: boolean;
};

function fmt(value: unknown, decimals = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function pct(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(0)}%`;
}

function pct1(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(1)}%`;
}

function isk(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (n === 0) return "0 ISK";
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}b`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${fmt(n)} ISK`;
}

function miningValue(value: unknown) {
  return `${fmt(value, 1)} m³/s`;
}

function eveIcon(typeId: number) {
  return `https://images.evetech.net/types/${typeId}/icon?size=32`;
}

function timeText(seconds: unknown) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return "-";
  if (n > 60) {
    const mins = Math.floor(n / 60);
    const secs = Math.round(n % 60);
    return `${mins}m ${secs}s`;
  }
  return `${fmt(n, 1)}s`;
}

function capStateText(cap: FittingStats["capacitor"]) {
  if (cap?.stable) return `${fmt(cap.stablePercent ?? cap.state, 1)}%`;
  return timeText(cap?.lastsSeconds ?? cap?.state);
}

function profileValue(profile?: SkillProfile | null) {
  if (profile?.mode === "alpha_clone") return "alpha_clone";
  return profile?.mode === "esi_character" ? `esi:${profile.characterId}` : "all_v";
}

function syncedText(character?: LinkedEsiCharacter | null) {
  if (!character?.skillsSyncedAt) return "not synced";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(character.skillsSyncedAt).getTime()) / 60000));
  if (minutes < 1) return "synced now";
  if (minutes < 60) return `synced ${minutes}m`;
  return `synced ${Math.round(minutes / 60)}h`;
}

function skillWarningTooltip(skillWarnings: SkillWarning[] = []) {
  const bySkill = new Map<number, { skillName: string; requiredLevel: number; actualLevel?: number | null }>();
  for (const warning of skillWarnings) {
    for (const skill of warning.missingSkills || []) {
      const existing = bySkill.get(skill.skillTypeId);
      if (!existing || skill.requiredLevel > existing.requiredLevel) {
        bySkill.set(skill.skillTypeId, {
          skillName: skill.skillName,
          requiredLevel: skill.requiredLevel,
          actualLevel: skill.actualLevel,
        });
      }
    }
  }
  const rows = Array.from(bySkill.values())
    .sort((a, b) => a.skillName.localeCompare(b.skillName))
    .slice(0, 10)
    .map((skill) => `${skill.skillName}: ${skill.requiredLevel}${skill.actualLevel != null ? ` (you have ${skill.actualLevel})` : ""}`);
  const remaining = Math.max(0, bySkill.size - rows.length);
  return [
    "Skills required:",
    ...rows,
    remaining > 0 ? `+ ${remaining} more` : "",
  ].filter(Boolean).join("\n");
}

function FitSkillWarning({ stats }: { stats: FittingStats | null }) {
  const count = Number(stats?.fitWarningSummary?.missingSkillCount || 0);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({
    left: 12,
    top: 12,
    width: 256,
    maxHeight: 320,
    ready: false,
  });
  const tooltip = skillWarningTooltip(stats?.skillWarnings || []);

  useLayoutEffect(() => {
    if (!count || !open || !anchorRef.current || typeof window === "undefined") {
      return;
    }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const margin = 12;
      const gap = 8;
      const rect = anchor.getBoundingClientRect();
      const width = Math.max(180, Math.min(256, window.innerWidth - margin * 2));
      const popoverHeight = popoverRef.current?.offsetHeight || 0;
      let left = rect.left + rect.width / 2 - width / 2;
      let top = rect.bottom + gap;

      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

      if (popoverHeight && top + popoverHeight + margin > window.innerHeight) {
        top = Math.max(margin, rect.top - popoverHeight - gap);
      }

      const next = {
        left,
        top,
        width,
        maxHeight: Math.max(96, window.innerHeight - top - margin),
        ready: true,
      };

      setPosition((current) => (
        current.left === next.left &&
        current.top === next.top &&
        current.width === next.width &&
        current.maxHeight === next.maxHeight &&
        current.ready === next.ready
          ? current
          : next
      ));
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [count, open, tooltip]);

  if (!count) return null;

  const popover = open && typeof document !== "undefined"
    ? createPortal(
      <span
        ref={popoverRef}
        className="pointer-events-none fixed z-[1000] overflow-auto whitespace-pre-line border border-[#5d4a1f] bg-[#100d07] px-2 py-1.5 text-left text-[10px] leading-4 text-amber-100 shadow-xl shadow-black/70"
        style={{
          left: position.left,
          top: position.top,
          width: position.width,
          maxHeight: position.maxHeight,
          opacity: position.ready ? 1 : 0,
        }}
      >
        {tooltip}
      </span>,
      document.body,
    )
    : null;

  return (
    <span
      className="relative inline-flex h-5 w-5 items-center justify-center"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <span
        ref={anchorRef}
        tabIndex={0}
        className="flex h-5 w-5 items-center justify-center text-amber-300 outline-none focus:text-amber-100"
        aria-label={`${count} missing skill requirements`}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <AlertTriangle size={13} />
      </span>
      {popover}
    </span>
  );
}

function IconImage({ typeId, label }: { typeId: number; label: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        className="flex h-6 w-6 items-center justify-center border border-[#30343d] bg-black text-[9px] text-slate-500"
        title={label}
        aria-label={label}
      >
        {label.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      src={eveIcon(typeId)}
      alt=""
      title={label}
      aria-label={label}
      className="h-6 w-6 border border-[#30343d] bg-black object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-[#2c2f36] bg-[#070910]">
      <div className="flex h-6 items-center justify-between gap-1.5 border-b border-[#2c2f36] bg-[#101219] px-2 text-[9px] uppercase tracking-widest text-slate-300">
        <div className="flex min-w-0 items-center gap-1.5">
          {icon}
          <span className="truncate">{title}</span>
        </div>
        {action}
      </div>
      <div className="space-y-1 p-1.5">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[10px] leading-4">
      <span className="truncate text-slate-500">{label}</span>
      <span className="font-mono text-slate-100">{value}</span>
    </div>
  );
}

function ResistTable({ resists }: { resists?: Record<string, DamageValues> }) {
  const rows = [
    ["Shield", resists?.shield],
    ["Armor", resists?.armor],
    ["Hull", resists?.hull],
  ] as const;
  const damageColumns: Array<{ key: keyof DamageValues; label: string; icon: PyfaGuiIconName }> = [
    { key: "em", label: "EM", icon: "em" },
    { key: "thermal", label: "Thermal", icon: "thermal" },
    { key: "kinetic", label: "Kinetic", icon: "kinetic" },
    { key: "explosive", label: "Explosive", icon: "explosive" },
  ];
  return (
    <div className="border border-[#1b2029] bg-[#05070b]">
      <div className="grid grid-cols-[52px_repeat(4,minmax(0,1fr))] items-center border-b border-[#1b2029] bg-[#090d13] px-1 py-0.5 text-center text-[9px] uppercase tracking-widest text-slate-500">
        <span />
        {damageColumns.map((column) => (
          <span key={column.key} className="flex justify-end">
            <PyfaGuiIcon name={column.icon} label={`${column.label} resistance`} className="h-4 w-4" />
          </span>
        ))}
      </div>
      {rows.map(([label, values]) => (
        <div key={label} className="grid grid-cols-[52px_repeat(4,minmax(0,1fr))] border-b border-[#101620] px-1 py-0.5 last:border-b-0 text-[10px] leading-4">
          <span className="truncate text-slate-500">{label}</span>
          {damageColumns.map((column) => (
            <span key={column.key} className="text-right font-mono text-slate-100">{pct1(values?.[column.key])}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

function HitpointRows({
  mode,
  rawHp,
  ehp,
}: {
  mode: "ehp" | "hp";
  rawHp?: Record<string, number>;
  ehp?: Record<string, number>;
}) {
  const values = mode === "ehp" ? ehp || {} : rawHp || {};
  const total = values.total ?? (Number(values.shield || 0) + Number(values.armor || 0) + Number(values.hull || 0));
  return (
    <div className="border border-[#1b2029] bg-[#05070b]">
      <div className="grid grid-cols-4 border-b border-[#1b2029] bg-[#090d13] px-1 py-0.5 text-center text-[9px] uppercase tracking-widest text-slate-500">
        <span>Shield</span>
        <span>Armor</span>
        <span>Hull</span>
        <span>Total</span>
      </div>
      <div className="grid grid-cols-4 px-1 py-0.5 text-right font-mono text-[10px] leading-4 text-slate-100">
        <span>{fmt(values.shield)}</span>
        <span>{fmt(values.armor)}</span>
        <span>{fmt(values.hull)}</span>
        <span>{fmt(total)}</span>
      </div>
    </div>
  );
}

function rateValue(row?: RechargeRateRow | null, key: "stableEhpPerSecond" | "maxEhpPerSecond" = "stableEhpPerSecond") {
  return fmt(row?.[key], 1);
}

function localTankFromRecharge(rates?: Record<string, RechargeRateRow>): LocalTankRows {
  return {
    stable: {
      passiveShieldEhpPerSecond: rates?.passiveShield?.stableEhpPerSecond,
      activeShieldEhpPerSecond: rates?.activeShield?.stableEhpPerSecond,
      activeArmorEhpPerSecond: rates?.activeArmor?.stableEhpPerSecond,
      activeHullEhpPerSecond: rates?.activeHull?.stableEhpPerSecond,
      totalEhpPerSecond: rates?.total?.stableEhpPerSecond,
    },
    max: {
      passiveShieldEhpPerSecond: rates?.passiveShield?.maxEhpPerSecond,
      activeShieldEhpPerSecond: rates?.activeShield?.maxEhpPerSecond,
      activeArmorEhpPerSecond: rates?.activeArmor?.maxEhpPerSecond,
      activeHullEhpPerSecond: rates?.activeHull?.maxEhpPerSecond,
      totalEhpPerSecond: rates?.total?.maxEhpPerSecond,
    },
  };
}

function LocalTankTable({ localTank }: { localTank?: LocalTankRows }) {
  const columns = [
    { key: "passiveShieldEhpPerSecond", label: "Passive shield recharge", icon: 393 },
    { key: "activeShieldEhpPerSecond", label: "Active shield repair", icon: 399 },
    { key: "activeArmorEhpPerSecond", label: "Active armor repair", icon: 523 },
    { key: "activeHullEhpPerSecond", label: "Active hull repair", icon: 524 },
  ] as const;
  return (
    <div className="border border-[#1b2029] bg-[#05070b]">
      <div className="grid grid-cols-[44px_repeat(4,minmax(0,1fr))] items-center border-b border-[#1b2029] bg-[#090d13] px-1 py-1">
        <span />
        {columns.map((column) => (
          <span key={column.key} className="flex justify-center">
            <IconImage typeId={column.icon} label={column.label} />
          </span>
        ))}
      </div>
      {(["stable", "max"] as const).map((row) => (
        <div key={row} className="grid grid-cols-[44px_repeat(4,minmax(0,1fr))] border-b border-[#101620] px-1 py-0.5 text-[10px] leading-4">
          <span className="text-[9px] uppercase tracking-widest text-slate-500">{row === "stable" ? "Stable" : "Max"}</span>
          {columns.map((column) => (
            <span key={column.key} className="text-right font-mono text-slate-100">
              {fmt(localTank?.[row]?.[column.key], 1)}
            </span>
          ))}
        </div>
      ))}
      <div className="px-1 pb-1 text-right text-[9px] text-slate-600">EHP/s, stable / max</div>
    </div>
  );
}

function RemoteRepTable({ reps }: { reps?: Record<string, number> }) {
  const columns = [
    { key: "shieldHpPerSecond", fallback: "shield", label: "Remote shield repair", icon: 3586, unit: "HP/s" },
    { key: "armorHpPerSecond", fallback: "armor", label: "Remote armor repair", icon: 11355, unit: "HP/s" },
    { key: "hullHpPerSecond", fallback: "hull", label: "Remote hull repair", icon: 27932, unit: "HP/s" },
    { key: "capacitorGjPerSecond", fallback: "capacitor", label: "Remote capacitor transfer", icon: 529, unit: "GJ/s" },
  ] as const;
  return (
    <div className="border border-[#1b2029] bg-[#05070b]">
      <div className="grid grid-cols-4 border-b border-[#1b2029] bg-[#090d13] px-1 py-1">
        {columns.map((column) => (
          <span key={column.key} className="flex justify-center">
            <IconImage typeId={column.icon} label={column.label} />
          </span>
        ))}
      </div>
      <div className="grid grid-cols-4 px-1 py-1 text-right font-mono text-[10px] leading-4 text-slate-100">
        {columns.map((column) => {
          const value = reps?.[column.key] ?? reps?.[column.fallback];
          return (
            <span key={column.key} title={column.label}>
              {fmt(value, 1)}
            </span>
          );
        })}
      </div>
      <div className="grid grid-cols-4 px-1 pb-1 text-center text-[9px] text-slate-600">
        {columns.map((column) => (
          <span key={column.key}>{column.unit}</span>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 border-b border-[#101620] px-1 py-0.5 last:border-b-0">
      <div className="truncate text-[9px] uppercase tracking-widest text-slate-600">{label}</div>
      <div className="truncate text-right font-mono text-[10px] leading-4 text-slate-100">{value}</div>
    </div>
  );
}

function StatGrid({ items, cols = 2 }: { items: { label: string; value: React.ReactNode }[]; cols?: 2 | 3 }) {
  return (
    <div className={`grid ${cols === 3 ? "grid-cols-3" : "grid-cols-2"} border border-[#1b2029] bg-[#05070b]`}>
      {items.map((item) => (
        <MiniStat key={item.label} label={item.label} value={item.value} />
      ))}
    </div>
  );
}

function CompactStatGrid({ items, cols = 2 }: { items: { label: string; value: React.ReactNode }[]; cols?: 2 | 3 }) {
  return (
    <div className={`grid ${cols === 3 ? "grid-cols-3" : "grid-cols-2"} border border-[#1b2029] bg-[#05070b]`}>
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 items-center justify-between gap-1 border-b border-[#101620] px-1 py-px text-[10px] leading-4">
          <span className="truncate text-[9px] uppercase tracking-widest text-slate-600">{item.label}</span>
          <span className="truncate text-right font-mono text-slate-100">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function profileLabel(profile: FittingStats["damageProfile"]) {
  if (!profile) return "Damage profile: Pyfa/eos default";
  const values = [profile.em, profile.thermal, profile.kinetic, profile.explosive]
    .map((value) => (Number.isFinite(Number(value)) ? `${Number(value).toFixed(0)}` : "-"))
    .join("/");
  return `Damage profile: ${profile.name || "Pyfa/eos default"} (${values})`;
}

function profileValues(profile: Pick<DamageProfileSelection, "em" | "thermal" | "kinetic" | "explosive"> | null | undefined) {
  return [profile?.em, profile?.thermal, profile?.kinetic, profile?.explosive]
    .map((value) => (Number.isFinite(Number(value)) ? `${Number(value).toFixed(0)}` : "-"))
    .join("/");
}

function hasProfileValues(profile: Pick<DamageProfileSelection, "em" | "thermal" | "kinetic" | "explosive"> | null | undefined) {
  return [profile?.em, profile?.thermal, profile?.kinetic, profile?.explosive].some((value) => Number.isFinite(Number(value)));
}

function profileButtonLabel(profile: FittingStats["damageProfile"] | DamageProfileSelection | null | undefined) {
  if (!profile) return "Pyfa/eos default";
  const name = profile.label || profile.name || "Pyfa/eos default";
  return hasProfileValues(profile) ? `${name} (${profileValues(profile)})` : name;
}

function damageProfileFromNode(node: DamageProfileNode): DamageProfileSelection | null {
  if (!node.profileId) return null;
  return {
    profileId: String(node.profileId),
    name: node.name || node.label,
    label: node.label,
    fullName: node.fullName || node.name || node.label,
    em: node.em ?? null,
    thermal: node.thermal ?? null,
    kinetic: node.kinetic ?? null,
    explosive: node.explosive ?? null,
    source: node.source || "pyfa/eos",
  };
}

async function fetchDamageProfileTree(): Promise<DamageProfileNode[]> {
  const response = await triffApiFetch("/api/fitting/damage-profiles");
  const data = await response.json();
  if (!response.ok || !data?.ok) throw new Error(data?.error || "damage_profiles_failed");
  return data.profiles || [];
}

function DamageProfileSelector({
  statsProfile,
  selectedProfile,
  onSelect,
  mobileSheet = false,
}: {
  statsProfile: FittingStats["damageProfile"];
  selectedProfile?: DamageProfileSelection | null;
  onSelect?: (profile: DamageProfileSelection) => void;
  mobileSheet?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nodes, setNodes] = useState<DamageProfileNode[]>([]);
  const [path, setPath] = useState<DamageProfileNode[]>([]);

  useEffect(() => {
    if (!open || nodes.length) return;
    let alive = true;
    setLoading(true);
    fetchDamageProfileTree()
      .then((tree) => {
        if (alive) setNodes(tree);
      })
      .catch(() => {
        if (alive) setNodes([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, nodes.length]);

  useEffect(() => {
    if (!open) return;
    function handleMouse(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", handleMouse);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleMouse);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const columns = useMemo(() => {
    const out: DamageProfileNode[][] = [nodes];
    for (const node of path) {
      if (node.children?.length) out.push(node.children);
      else break;
    }
    return out;
  }, [nodes, path]);

  const labelProfile = selectedProfile || statsProfile || null;
  const currentProfileId = String(selectedProfile?.profileId || statsProfile?.profileId || "");
  const rect = buttonRef.current?.getBoundingClientRect();
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 768;
  const menuMargin = 8;
  const right = rect ? Math.max(menuMargin, viewportWidth - rect.right) : menuMargin;
  const top = rect ? Math.min(rect.bottom + 4, viewportHeight - 340) : 120;
  const desktopColumns = useMemo(
    () => columns.map((columnNodes, columnIndex) => ({ columnNodes, columnIndex })).reverse(),
    [columns],
  );
  const mobileNodes = path.length ? path[path.length - 1]?.children || [] : nodes;
  const mobileTitle = path.length ? path[path.length - 1]?.label || "Damage Profiles" : "Damage Profile";

  const choose = (profile: DamageProfileSelection | null) => {
    if (!profile) return;
    onSelect?.(profile);
    setOpen(false);
  };

  const renderRow = (node: DamageProfileNode, selected: boolean, onHover?: () => void) => {
    const hasChildren = Boolean(node.children?.length);
    const profile = damageProfileFromNode(node);
    const active = profile?.profileId && String(profile.profileId) === currentProfileId;
    return (
      <button
        key={node.key}
        type="button"
        className={`grid h-7 w-full grid-cols-[minmax(0,1fr),auto,14px] items-center gap-1 px-2 text-left hover:bg-[#101721] ${
          selected || active ? "bg-[#101721] text-[#8bd3ff]" : "text-slate-200"
        }`}
        onMouseEnter={onHover}
        onClick={() => {
          if (hasChildren) return;
          choose(profile);
        }}
        title={profile ? `${profile.fullName || profile.name} (${profileValues(profile)})` : node.label}
      >
        <span className="truncate">{node.label}</span>
        {profile ? <span className="font-mono text-[9px] text-slate-500">{profileValues(profile)}</span> : <span />}
        {hasChildren ? <ChevronLeft size={12} className="shrink-0" /> : <span />}
      </button>
    );
  };

  return (
    <>
      <div className="flex w-full min-w-0 items-center gap-1 text-[9px] text-slate-600">
        <span className="shrink-0">Damage Profile:</span>
        <button
          ref={buttonRef}
          type="button"
          className="min-w-0 flex-1 truncate border border-[#303236] bg-[#05070b] px-1.5 py-0.5 text-center text-[9px] text-slate-300 hover:border-[#53b6ff]/60 hover:bg-[#101721] hover:text-[#8bd3ff] focus:border-[#53b6ff] focus:text-[#8bd3ff] focus:outline-none"
          onClick={() => {
            if (!open) setPath([]);
            setOpen((value) => !value);
          }}
          title={`${profileLabel(labelProfile)}. Click to change damage profile.`}
        >
          {loading ? "loading..." : profileButtonLabel(labelProfile)}
        </button>
      </div>
      {open && typeof document !== "undefined" &&
        createPortal(
          mobileSheet ? (
            <div ref={menuRef} className="fixed inset-0 z-[9998] flex items-end bg-black/65">
              <div className="mobile-fitting-sheet flex w-full flex-col overflow-hidden border border-[#34404c] bg-[#070910] text-[11px] text-slate-200 shadow-2xl shadow-black/70">
                <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-[#20242c] bg-[#101219] px-2">
                  {path.length > 0 ? (
                    <button type="button" className="flex h-8 w-8 items-center justify-center text-slate-400 active:text-slate-100" onClick={() => setPath((value) => value.slice(0, -1))}>
                      <ChevronLeft size={16} />
                    </button>
                  ) : (
                    <span className="h-8 w-8" />
                  )}
                  <div className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-widest text-slate-200">{mobileTitle}</div>
                  <button type="button" className="flex h-8 w-8 items-center justify-center text-slate-400 active:text-slate-100" onClick={() => setOpen(false)}>
                    <X size={16} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
                  {mobileNodes.length === 0 ? (
                    <div className="px-3 py-3 text-slate-600">{loading ? "Loading..." : "No damage profiles"}</div>
                  ) : (
                    mobileNodes.map((node) => {
                      const nextPath = [...path, node];
                      const hasChildren = Boolean(node.children?.length);
                      const profile = damageProfileFromNode(node);
                      return (
                        <button
                          key={node.key}
                          type="button"
                          className="grid min-h-9 w-full grid-cols-[minmax(0,1fr),auto,18px] items-center gap-2 border-b border-[#151922] px-2 text-left active:bg-[#101721]"
                          onClick={() => {
                            if (hasChildren) {
                              setPath(nextPath);
                              return;
                            }
                            choose(profile);
                          }}
                          title={profile ? `${profile.fullName || profile.name} (${profileValues(profile)})` : node.label}
                        >
                          <span className="truncate">{node.label}</span>
                          {profile ? <span className="font-mono text-[9px] text-slate-500">{profileValues(profile)}</span> : <span />}
                          {hasChildren && <ChevronRight size={12} className="shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div
              ref={menuRef}
              className="fixed z-[9998] flex max-h-80 max-w-[calc(100vw-16px)] overflow-x-auto border border-[#34404c] bg-[#070910] text-[11px] shadow-2xl shadow-black/70"
              style={{ right, top: Math.max(menuMargin, top) }}
            >
              {desktopColumns.map(({ columnNodes, columnIndex }) => (
                <div key={columnIndex} className="max-h-80 w-56 overflow-y-auto border-l border-[#20242c] py-1 first:border-l-0">
                  {columnNodes.length === 0 ? (
                    <div className="px-2 py-2 text-slate-600">{loading ? <Loader2 size={12} className="animate-spin text-[#53b6ff]" /> : "No damage profiles"}</div>
                  ) : (
                    columnNodes.map((node) => {
                      const selected = path[columnIndex]?.key === node.key;
                      const nextPath = [...path.slice(0, columnIndex), node];
                      return renderRow(node, selected, () => setPath(nextPath));
                    })
                  )}
                </div>
              ))}
            </div>
          ),
          document.body
        )}
    </>
  );
}

function Bar({ label, used, total, unit }: { label: string; used?: number; total?: number; unit: string }) {
  const pctUsed = total && total > 0 ? Math.max(0, Math.min(1.25, Number(used || 0) / total)) : 0;
  const over = pctUsed > 1;
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[10px] leading-4">
        <span className="text-slate-500">{label}</span>
        <span className={`font-mono ${over ? "text-red-300" : "text-slate-100"}`}>
          {fmt(used, label === "Calibration" ? 0 : 1)} / {fmt(total, label === "Calibration" ? 0 : 1)} {unit}
        </span>
      </div>
      <div className="h-1 border border-[#20242c] bg-[#030509]">
        <div
          className={over ? "h-full bg-red-500" : "h-full bg-[#53b6ff]"}
          style={{ width: `${Math.min(100, pctUsed * 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function FittingStatsPanel({
  stats,
  warnings,
  errors,
  loading = false,
  skillProfile,
  linkedCharacters = [],
  selectedCharacter = null,
  esiPending = false,
  esiBusy = null,
  onSkillProfileChange,
  skillOverrideCount = 0,
  onClearSkillOverrides,
  showSkillSelector = true,
  showMessages = true,
  damageProfile = null,
  onDamageProfileChange,
  mobileDamageProfileMenu = false,
}: Props) {
  const [defenseMode, setDefenseMode] = useState<"ehp" | "hp">("ehp");
  const [tankTab, setTankTab] = useState<"local" | "remote">("local");
  const [firepowerMode, setFirepowerMode] = useState<"dps" | "mining">("dps");
  const resources = stats?.resources || {};
  const defense = stats?.defense;
  const cap = stats?.capacitor;
  const firepower = stats?.firepower || {};
  const mining = stats?.mining || {};
  const targeting = stats?.targeting || {};
  const nav = stats?.navigation || {};
  const drones = stats?.drones || {};
  const rawHp = defense?.rawHp || defense?.hp || {};
  const price = stats?.price || null;
  const localTank = stats?.localTank || localTankFromRecharge(stats?.rechargeRates);

  return (
    <aside className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
      <div className="border border-[#2c2f36] bg-[#070910]">
        <div className="flex min-h-7 items-center justify-between gap-1 border-b border-[#2c2f36] bg-[#101219] px-2 py-0.5">
          {showSkillSelector ? (
            <label className="flex min-w-0 flex-1 items-center gap-1 text-[9px] uppercase tracking-widest text-slate-300">
              <span className="shrink-0">Skills</span>
              <select
                className="min-w-0 flex-1 border border-[#303236] bg-[#05070b] px-1 py-0.5 text-[10px] normal-case tracking-normal text-slate-100 outline-none focus:border-[#53b6ff]"
                value={profileValue(skillProfile)}
                onChange={(event) => onSkillProfileChange?.(event.target.value)}
              >
                <option value="all_v">All V Skills</option>
                <option value="alpha_clone">All Alpha Skills</option>
                {linkedCharacters.length > 0 && (
                  <optgroup label="Linked characters">
                    {linkedCharacters.map((character) => (
                      <option key={character.characterId} value={`esi:${character.characterId}`}>
                        {character.characterName}{character.tokenStatus && character.tokenStatus !== "ok" ? " !" : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value="link">Link EVE Character</option>
                {linkedCharacters.length > 0 && <option value="manage">Manage linked characters</option>}
                {skillProfile?.mode === "esi_character" && <option value="refresh">Refresh selected character</option>}
              </select>
              <FitSkillWarning stats={stats} />
            </label>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-1 text-[9px] uppercase tracking-widest text-slate-300">
              <span className="shrink-0">Skills</span>
              <FitSkillWarning stats={stats} />
            </div>
          )}
          <div className="shrink-0 text-right font-mono text-[9px] text-slate-500">
            <div>{loading ? "calculating" : stats ? "ready" : "idle"}</div>
            <div className="normal-case">{esiPending ? "waiting SSO" : skillProfile?.mode === "esi_character" ? syncedText(selectedCharacter) : esiBusy ? "working" : ""}</div>
          </div>
        </div>
        {!stats && (
          <div className="px-2 py-2 text-[11px] text-slate-600">Select a hull or import a fit</div>
        )}
        {skillOverrideCount > 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-[#2c2f36] bg-[#0b0d13] px-2 py-1 text-[9px] uppercase tracking-widest">
            <div className="flex min-w-0 items-center gap-1.5 text-yellow-300">
              <AlertTriangle size={11} className="shrink-0" />
              <span className="truncate">
                {skillOverrideCount} skill{skillOverrideCount === 1 ? "" : "s"} overridden
              </span>
            </div>
            {onClearSkillOverrides && (
              <button
                type="button"
                className="shrink-0 border border-[#3a3230] bg-[#140a08] px-2 py-0.5 text-[9px] uppercase tracking-widest text-[#ffb4a6] hover:border-[#ff8a75] hover:text-[#ffd2ca]"
                onClick={onClearSkillOverrides}
              >
                Clear Overrides
              </button>
            )}
          </div>
        )}
      </div>

      {showMessages && <FittingWarnings warnings={warnings} errors={errors} />}

      {stats && (
        <>
          <Section title="Resources" icon={<PyfaGuiIcon name="resources" label="CPU resources" className="h-4 w-4" />}>
            <Bar label="CPU" used={resources.cpu?.used} total={resources.cpu?.output} unit="tf" />
            <Bar label="Powergrid" used={resources.powergrid?.used} total={resources.powergrid?.output} unit="MW" />
            <Bar label="Calibration" used={resources.calibration?.used} total={resources.calibration?.output} unit="" />
          </Section>

          <Section
            title="Resistances / Defense"
            icon={<PyfaGuiIcon name="defense" label="Armor defense" className="h-4 w-4" />}
            action={
              <div className="flex border border-[#303236] bg-[#05070b] text-[9px] tracking-normal">
                {(["ehp", "hp"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`px-1.5 py-0.5 uppercase ${defenseMode === mode ? "bg-[#16202a] text-[#8bd3ff]" : "text-slate-500 hover:text-slate-200"}`}
                    onClick={() => setDefenseMode(mode)}
                  >
                    {mode.toUpperCase()}
                  </button>
                ))}
              </div>
            }
          >
            <ResistTable resists={defense?.resists} />
            <HitpointRows mode={defenseMode} rawHp={rawHp} ehp={defense?.ehp} />
            <DamageProfileSelector
              statsProfile={stats.damageProfile}
              selectedProfile={damageProfile}
              onSelect={onDamageProfileChange}
              mobileSheet={mobileDamageProfileMenu}
            />
          </Section>

          <Section
            title="Recharge / Reps"
            icon={<EveTypeIcon typeId={578} label="Multispectrum Shield Hardener I" className="h-4 w-4" />}
            action={
              <div className="flex border border-[#303236] bg-[#05070b] text-[9px] tracking-normal">
                {(["local", "remote"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`px-1.5 py-0.5 uppercase ${tankTab === tab ? "bg-[#16202a] text-[#8bd3ff]" : "text-slate-500 hover:text-slate-200"}`}
                    onClick={() => setTankTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            }
          >
            {tankTab === "local" ? <LocalTankTable localTank={localTank} /> : <RemoteRepTable reps={stats.remoteReps} />}
          </Section>

          <Section
            title={firepowerMode === "mining" ? "Mining Yield" : "Firepower"}
            icon={<PyfaGuiIcon name={firepowerMode === "mining" ? "mining" : "firepower"} label={firepowerMode === "mining" ? "Mining yield" : "Firepower"} className="h-4 w-4" />}
            action={
              <div className="flex border border-[#303236] bg-[#05070b] text-[9px] tracking-normal">
                {(["dps", "mining"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`px-1.5 py-0.5 uppercase ${firepowerMode === mode ? "bg-[#16202a] text-[#8bd3ff]" : "text-slate-500 hover:text-slate-200"}`}
                    onClick={() => setFirepowerMode(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            }
          >
            {firepowerMode === "mining" ? (
              <StatGrid
                cols={3}
                items={[
                  { label: "Miner", value: miningValue(mining.minerYieldM3PerSecond) },
                  { label: "Drone", value: miningValue(mining.droneYieldM3PerSecond) },
                  { label: "Total", value: miningValue(mining.totalYieldM3PerSecond) },
                ]}
              />
            ) : (
              <StatGrid
                cols={3}
                items={[
                  { label: "Weapon DPS", value: fmt(firepower.weaponDps, 1) },
                  { label: "Volley", value: fmt(firepower.volley, 1) },
                  { label: "Drone DPS", value: fmt(firepower.droneDps, 1) },
                ]}
              />
            )}
          </Section>

          <Section title="Capacitor" icon={<EveTypeIcon typeId={2018} label="Medium Cap Battery I" className="h-4 w-4" />}>
            <StatGrid
              items={[
                { label: cap?.stable ? "Stable" : "Lasts", value: capStateText(cap) },
                { label: "Delta", value: `${fmt(cap?.deltaGjPerSecond ?? cap?.delta, 2)} GJ/s` },
                { label: "Capacity", value: `${fmt(cap?.capacityGj ?? cap?.capacity, 1)} GJ` },
                { label: "Neut resist", value: `${fmt(cap?.neutralizerResistancePercent, 1)}%` },
                { label: "Excess gain", value: cap?.effectiveExcessGainGjPerSecond == null ? "-" : `${fmt(cap.effectiveExcessGainGjPerSecond, 2)} GJ/s` },
                { label: "Recharge", value: `${fmt(cap?.recharge, 2)} GJ/s` },
              ]}
            />
          </Section>

          <Section title="Targeting & Misc" icon={<EveTypeIcon typeId={12056} label="10MN Afterburner I" className="h-4 w-4" />}>
            <CompactStatGrid
              items={[
                { label: "Targets", value: fmt(targeting.maxTargets) },
                { label: "Speed", value: `${fmt(nav.maxSpeed)} m/s` },
                { label: "Range", value: `${fmt(Number(targeting.range || 0) / 1000, 1)} km` },
                { label: "Align", value: `${fmt(nav.alignTime, 2)} s` },
                { label: "Scan res", value: `${fmt(targeting.scanResolution)} mm` },
                { label: "Signature", value: `${fmt(targeting.signatureRadius)} m` },
                { label: "Sensor", value: `${fmt(targeting.sensorStrength, 1)} ${String(targeting.sensorType || "")}` },
                { label: "Warp", value: `${fmt(nav.warpSpeed, 1)} AU/s` },
                { label: "Drone range", value: `${fmt(Number(targeting.droneControlRange || 0) / 1000, 1)} km` },
                { label: "Cargo", value: `${fmt(targeting.cargoUsed, 1)} / ${fmt(targeting.cargoCapacity, 1)} m3` },
                { label: "Drones", value: `${fmt(drones.active)} act ${fmt(drones.bandwidthUsed)} / ${fmt(drones.bandwidthTotal)}` },
                { label: "Mass", value: `${fmt(nav.mass)} kg` },
              ]}
            />
          </Section>

          <Section title="Price" icon={<EveUiSymbolIcon svg={walletIconRaw} label="ISKtimate price" className="h-4 w-4 text-amber-200" />}>
            <StatGrid
              items={[
                { label: "Ship", value: isk(price?.ship) },
                { label: "Fittings", value: isk(price?.fittings) },
                { label: "Drones", value: isk(price?.drones) },
                { label: "Character", value: isk(price?.character) },
                { label: "Cargo", value: isk(price?.cargo) },
                { label: "Total", value: isk(price?.total) },
              ]}
            />
            <div className="truncate text-[9px] text-slate-600">{price?.mode || "Estimated price unavailable"}</div>
          </Section>
        </>
      )}
    </aside>
  );
}
