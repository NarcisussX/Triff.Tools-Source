import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  ChevronLeft,
  ChevronRight,
  Link2,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Save,
  Search,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import assetsIconRaw from "../assets/icons/assets.svg?raw";
import fittingIconRaw from "../assets/icons/fitting.svg?raw";
import fleetIconRaw from "../assets/icons/fleet.svg?raw";
import jumpClonesIconRaw from "../assets/icons/jumpclones.svg?raw";
import logIconRaw from "../assets/icons/log.svg?raw";
import marketIconRaw from "../assets/icons/market.svg?raw";
import { groupCharges } from "../components/fitting/chargeGrouping";
import EnvironmentEffectMenu from "../components/fitting/EnvironmentEffectMenu";
import FittingGraphsPanel, { type GraphPanelState } from "../components/fitting/FittingGraphsPanel";
import FittingStatsPanel from "../components/fitting/FittingStatsPanel";
import FittingWarnings from "../components/fitting/FittingWarnings";
import { PyfaGuiIcon } from "../components/fitting/FittingIcon";
import ImportFitModal from "../components/fitting/ImportFitModal";
import ModuleBrowser from "../components/fitting/ModuleBrowser";
import MutationEditorModal from "../components/fitting/MutationEditorModal";
import CargoQuantityInput from "../components/fitting/CargoQuantityInput";
import { addCargoStack, setCargoStackQuantity } from "../components/fitting/cargo";
import { FILLABLE_RACKS, moduleForRackFill, rackFillBlocker } from "../components/fitting/moduleFill";
import { readFittingWorkspaceSnapshot, writeFittingWorkspaceSnapshot } from "../components/fitting/workspaceMemory";
import {
  requestSiteAuthModal,
  SITE_AUTH_CHANGED_EVENT,
  type SiteAuthChangeDetail,
} from "../auth/siteAuthEvents";
import {
  isNativeRuntime,
  openTriffExternalUrl,
  triffApiFetch,
  triffToolsUrl,
} from "../lib/webRuntime";
import type {
  AffectedSkill,
  AuthUser,
  CalculationResponse,
  ChargeResult,
  CommandBurstSelection,
  CommandFitLink,
  CrossFitSourceSummary,
  DamageProfileSelection,
  EnvironmentEffect,
  FitMessage,
  FitPayload,
  FittedModuleRow,
  FittingModule,
  FittingStats,
  HardpointKind,
  ImplantSet,
  ImplantSetGrade,
  LinkedEsiCharacter,
  ModuleMutation,
  MutaplasmidResult,
  ProjectedFitLink,
  QuantityItem,
  SavedFitFocus,
  SavedFitGroup,
  SavedFitRecord,
  SearchResult,
  ShipModeOption,
  SkillOverrideMap,
  SkillProfile,
  SlotKey,
} from "../components/fitting/types";
import { emptyFit, ensureFitPayload, SLOT_LABELS, SLOT_ORDER } from "../components/fitting/types";

type MobileView = "fit" | "browser" | "stats" | "additions" | "projected" | "command";
type AdditionTab = "drones" | "fighters" | "cargo" | "implants" | "boosters" | "notes";
type MobileStatsMode = "stats" | "graphs";
type ModuleSheetMode = "actions" | "charges" | "chargeGroup" | "variants" | "mutaplasmids" | "spool" | "moduleSkills" | "shipSkills" | "skillLevels";
type CharacterSheetMode = "actions" | "variants" | "sets" | "setGrades";
type SkillSheetKind = "module" | "ship";

type OpenFitTab = {
  tabId: string;
  savedFitId: string | null;
  fitName: string;
  shipTypeId: number | null;
  shipName: string | null;
  fitState: FitPayload;
  calculationResult: CalculationResponse | null;
  stats: FittingStats | null;
  warnings: FitMessage[];
  errors: FitMessage[];
  dirty: boolean;
  openedFromSavedAt: string | null;
  lastSavedHash: string;
  currentHash: string;
  projectedLinks: ProjectedFitLink[];
  commandLinks: CommandFitLink[];
};

type WorkspaceState = {
  openFits: OpenFitTab[];
  activeTabId: string;
};

type SubsystemKind = "core" | "defense" | "offense" | "propulsion";

type ImportedFitResponse = {
  ok: boolean;
  payload: FitPayload;
  warnings?: FitMessage[];
  errors?: FitMessage[];
  calculation?: CalculationResponse;
  inGameFitting?: InGameFittingSummary;
  sharedFit?: {
    id: string;
    url: string;
    fitName?: string;
    shipName?: string;
  };
};

type InGameFittingCharacter = {
  characterId: number;
  characterName: string;
  tokenStatus?: string | null;
  lastError?: string | null;
  lastFittingsFetchAt?: string | null;
};

type InGameFittingSummary = {
  fittingId: number;
  name: string;
  description?: string | null;
  shipTypeId: number;
  shipTypeName: string;
  shipGroupName?: string | null;
  shipCategoryName?: string | null;
  itemCount: number;
  moduleCount: number;
  droneCount: number;
  cargoCount: number;
};

type SharedFitLinkResponse = {
  ok: boolean;
  id: string;
  url: string;
  path: string;
  fitName: string;
  shipName: string;
  shipTypeId: number;
  duplicate?: boolean;
};

type ModuleSheetState = {
  slot: SlotKey;
  index: number;
  module: FittingModule;
  mode: ModuleSheetMode;
  openChargeGroup?: string | null;
} | null;

type CharacterSheetState = {
  kind: "implants" | "boosters";
  index: number;
  item: QuantityItem;
  mode: CharacterSheetMode;
  openSetKey?: string | null;
} | null;

type ItemInfoTarget = {
  typeId: number;
  typeName?: string;
} | null;

type MobileItemInfoPayload = {
  ok: boolean;
  item?: {
    type_id: number;
    name: string;
    description: string | null;
    published: boolean;
    group: { group_id: number; name: string | null } | null;
    category: { category_id: number; name: string | null } | null;
    market_group: { market_group_id: number; name: string | null } | null;
    market_group_path?: { market_group_id: number; name: string | null }[];
    volume: number | null;
    packaged_volume: number | null;
    mass: number | null;
    capacity: number | null;
    icon_url: string | null;
    render_url: string;
  };
  dogma?: {
    attribute_id: number;
    name: string | null;
    display_name: string;
    value: string | number | null;
    display_value?: string | null;
  }[];
  traits?: {
    miscBonuses: { bonus: number | null; unit: string | null; text: string }[];
    roleBonuses: { bonus: number | null; unit: string | null; text: string }[];
    types: {
      skill_type_id: number;
      skill_name: string | null;
      bonuses: { bonus: number | null; unit: string | null; text: string }[];
    }[];
  } | null;
  error?: string;
};

type MobileToast = {
  id: number;
  message: string;
  tone: "success" | "error";
} | null;

type AffectedSkillsResponse = {
  ok: boolean;
  skills: AffectedSkill[];
  errors?: Array<{ code?: string; message?: string }>;
};

type ImportApplyOptions = {
  stayInCurrentView?: boolean;
};

type MobileFittingPageProps = {
  sharedFitId?: string;
  workspaceStorageKey?: string;
  topBarAccessory?: ReactNode;
  standalone?: boolean;
};

type MutationEditorState = {
  slot: SlotKey;
  index: number;
  module: FittingModule;
  mutation: ModuleMutation;
} | null;

type EveUiIconDef = {
  markup: string;
};

const eveUiIcons = {
  assets: makeEveUiIcon(assetsIconRaw),
  fitting: makeEveUiIcon(fittingIconRaw),
  fleet: makeEveUiIcon(fleetIconRaw),
  jumpClones: makeEveUiIcon(jumpClonesIconRaw),
  log: makeEveUiIcon(logIconRaw),
  market: makeEveUiIcon(marketIconRaw),
};

const navItems: { key: MobileView; label: string; icon: ReactNode }[] = [
  { key: "fit", label: "Fit", icon: <EveUiIcon icon={eveUiIcons.fitting} /> },
  { key: "browser", label: "Browser", icon: <EveUiIcon icon={eveUiIcons.market} /> },
  { key: "stats", label: "Stats", icon: <EveUiIcon icon={eveUiIcons.log} /> },
  { key: "additions", label: "Additions", icon: <EveUiIcon icon={eveUiIcons.assets} /> },
  { key: "projected", label: "Projected", icon: <EveUiIcon icon={eveUiIcons.jumpClones} /> },
  { key: "command", label: "Command", icon: <EveUiIcon icon={eveUiIcons.fleet} /> },
];

const buttonClass =
  "inline-flex min-h-8 items-center justify-center gap-1 border border-[#303236] bg-[#05070b] px-1.5 text-[9px] uppercase tracking-widest text-slate-300 active:bg-[#16202a] disabled:opacity-40";
const primaryClass =
  "inline-flex min-h-8 items-center justify-center gap-1 border border-[#46b2ff]/70 bg-gradient-to-b from-[#1b8cc8] to-[#14608a] px-1.5 text-[9px] font-semibold uppercase tracking-widest text-slate-50 shadow-[0_0_10px_rgba(70,178,255,0.25)] disabled:opacity-50";
const rowButton =
  "inline-flex h-7 items-center justify-center gap-1 border border-[#2f5367] bg-[#082033] px-2 text-[10px] uppercase tracking-widest text-[#9fddff] active:border-[#53b6ff] active:bg-[#0b304d] disabled:cursor-not-allowed disabled:opacity-50";

const additionTabs: { key: AdditionTab; label: string }[] = [
  { key: "drones", label: "Drones" },
  { key: "fighters", label: "Fighters" },
  { key: "cargo", label: "Cargo" },
  { key: "implants", label: "Implants" },
  { key: "boosters", label: "Boosters" },
  { key: "notes", label: "Notes" },
];

const ITEM_INFO_ATTRIBUTE_LIMIT = 80;

const IN_GAME_FIT_SHIP_GROUP_ORDER = [
  "Assault Frigate",
  "Attack Battlecruiser",
  "Battleship",
  "Black Ops",
  "Blockade Runner",
  "Capital Industrial Ship",
  "Carrier",
  "Citadel",
  "Combat Battlecruiser",
  "Combat Recon Ship",
  "Command Destroyer",
  "Command Ship",
  "Corvette",
  "Covert Ops",
  "Cruiser",
  "Deep Space Transport",
  "Destroyer",
  "Dreadnought",
  "Electronic Attack Ship",
  "Engineering Complex",
  "Exhumer",
  "Expedition Frigate",
  "Flag Cruiser",
  "Force Auxiliary",
  "Force Recon Ship",
  "Freighter",
  "Frigate",
  "Hauler",
  "Heavy Assault Cruiser",
  "Heavy Interdiction Cruiser",
  "Industrial Command Ship",
  "Interceptor",
  "Interdictor",
  "Jump Freighter",
  "Lancer Dreadnought",
  "Limited Issue Ships",
  "Logistics",
  "Logistics Frigate",
  "Marauder",
  "Mining Barge",
  "Prototype Exploration Ship",
  "Refinery",
  "Shuttle",
  "Special Edition Yachts",
  "Stealth Bomber",
  "Strategic Cruiser",
  "Supercarrier",
  "Tactical Destroyer",
  "Titan",
  "Upwell Cyno Beacon",
  "Upwell Cyno Jammer",
  "Upwell Jump Gate",
];

const IN_GAME_FIT_SHIP_GROUP_ORDER_INDEX = new Map(IN_GAME_FIT_SHIP_GROUP_ORDER.map((name, index) => [name.toLowerCase(), index]));

function eveIcon(typeId?: number | null, size = 64) {
  return typeId ? `https://images.evetech.net/types/${typeId}/icon?size=${size}` : "";
}

function makeEveUiIcon(svg: string): EveUiIconDef {
  return {
    markup: svg.replace(/^\s*<symbol\b[^>]*>/, "").replace(/<\/symbol>\s*$/, ""),
  };
}

function EveUiIcon({ icon, className = "h-[22px] w-[22px]" }: { icon: EveUiIconDef; className?: string }) {
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

function makeTabId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fitHash(fit: FitPayload) {
  return JSON.stringify(fit);
}

function fitWithSkillOverrides(fit: FitPayload, overrides?: SkillOverrideMap | null): FitPayload {
  if (!overrides || Object.keys(overrides).length === 0) {
    const cleanFit = { ...fit };
    delete cleanFit.skillOverrides;
    return cleanFit;
  }
  return { ...fit, skillOverrides: overrides };
}

function skillLevelLabel(level: number | null | undefined) {
  if (level == null) return "Profile";
  return level < 0 ? "Not Learned" : `Level ${level}`;
}

function skillRowSubtitle(skill: AffectedSkill) {
  const parts: string[] = [];
  if (skill.required) parts.push(`Required: ${skill.requiredLevel ?? "?"}`);
  return parts.length > 0 ? parts.join(" - ") : undefined;
}

function fitShipName(fit: FitPayload) {
  return fit.shipTypeName || (fit.shipTypeId ? `Type ${fit.shipTypeId}` : null);
}

function makeWorkspaceTab(
  fitState: FitPayload,
  options: {
    savedFitId?: string | null;
    calculationResult?: CalculationResponse | null;
    warnings?: FitMessage[];
    errors?: FitMessage[];
    openedFromSavedAt?: string | null;
  } = {}
): OpenFitTab {
  const fit = ensureFitPayload(fitState);
  const hash = fitHash(fit);
  return {
    tabId: makeTabId(),
    savedFitId: options.savedFitId || null,
    fitName: fit.fitName || "New Fit",
    shipTypeId: fit.shipTypeId || null,
    shipName: fitShipName(fit),
    fitState: fit,
    calculationResult: options.calculationResult || null,
    stats: options.calculationResult?.stats || null,
    warnings: options.warnings || options.calculationResult?.warnings || [],
    errors: options.errors || options.calculationResult?.errors || [],
    dirty: false,
    openedFromSavedAt: options.openedFromSavedAt || null,
    lastSavedHash: hash,
    currentHash: hash,
    projectedLinks: [],
    commandLinks: [],
  };
}

function updateTabFit(tab: OpenFitTab, fitState: FitPayload, options: { savedFitId?: string | null; resetBaseline?: boolean } = {}) {
  const fit = ensureFitPayload(fitState);
  const currentHash = fitHash(fit);
  const lastSavedHash = options.resetBaseline ? currentHash : tab.lastSavedHash;
  const savedFitId = Object.prototype.hasOwnProperty.call(options, "savedFitId") ? options.savedFitId || null : tab.savedFitId;
  return {
    ...tab,
    savedFitId,
    fitName: fit.fitName || "New Fit",
    shipTypeId: fit.shipTypeId || null,
    shipName: fitShipName(fit),
    fitState: fit,
    currentHash,
    lastSavedHash,
    dirty: currentHash !== lastSavedHash,
  };
}

function isReusableEmptyTab(tab: OpenFitTab) {
  return !tab.savedFitId && !tab.dirty && !tab.fitState.shipTypeId && tab.currentHash === tab.lastSavedHash;
}

function normalizeType(raw: SearchResult): SearchResult {
  return { ...raw, typeId: Number(raw.typeId) };
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.message || data?.errors?.[0]?.message || data?.error || "request_failed");
  }
  return data as T;
}

function fmt(value: unknown, decimals = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

function isAbyssalPlaceholder(module?: FittingModule | null, row?: FittedModuleRow | null) {
  return Boolean(module?.abyssalPlaceholder || row?.abyssalPlaceholder);
}

function abyssalPlaceholderTooltip(module?: FittingModule | null, row?: FittedModuleRow | null) {
  return row?.placeholderReason || module?.placeholderReason || "Imported abyssal placeholder. No mutation attributes were provided, so this item is not included in calculated stats.";
}

function fittingDeepLinkTypeId(searchParams: URLSearchParams) {
  const raw =
    searchParams.get("type_id") ||
    searchParams.get("typeId") ||
    searchParams.get("ship_type_id") ||
    searchParams.get("shipTypeId");
  const typeId = Number(raw);
  return Number.isInteger(typeId) && typeId > 0 ? typeId : null;
}

function isk(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}b`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return fmt(n);
}

function profileValue(profile?: SkillProfile | null) {
  if (profile?.mode === "alpha_clone") return "alpha_clone";
  return profile?.mode === "esi_character" ? `esi:${profile.characterId}` : "all_v";
}

function itemName(item: { typeName?: string; typeId: number }) {
  return item.typeName || `Type ${item.typeId}`;
}

function treeKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "other";
}

function isTrustedSsoOrigin(origin: string) {
  try {
    if (origin === window.location.origin) return true;
    const messageUrl = new URL(origin);
    const currentHost = window.location.hostname;
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (localHosts.has(currentHost) && localHosts.has(messageUrl.hostname)) return true;
    const triffHosts = new Set(["triff.tools", "www.triff.tools", "dev.triff.tools"]);
    if (isNativeRuntime() && triffHosts.has(messageUrl.hostname)) return true;
    return triffHosts.has(currentHost) && triffHosts.has(messageUrl.hostname);
  } catch {
    return false;
  }
}

function additionSlot(key: "implants" | "boosters", item: QuantityItem | SearchResult) {
  const value = key === "implants" ? item.implantSlot ?? item.slot : item.boosterSlot ?? item.slot;
  const slot = Number(value);
  return Number.isFinite(slot) && slot > 0 ? slot : null;
}

function additionWithSlot(key: "implants" | "boosters", item: QuantityItem | SearchResult): QuantityItem {
  const slot = additionSlot(key, item);
  return {
    typeId: item.typeId,
    typeName: item.typeName,
    quantity: 1,
    slot,
    ...(key === "implants" ? { implantSlot: slot } : { boosterSlot: slot }),
  };
}

function hydrateCharacterItemSlots(key: "implants" | "boosters", current: QuantityItem[], calculated: QuantityItem[] = []) {
  const used = new Set<number>();
  let changed = false;
  const hydrated = current.map((item, index) => {
    const direct = calculated[index]?.typeId === item.typeId ? calculated[index] : null;
    const matchIndex = direct
      ? index
      : calculated.findIndex((candidate, candidateIndex) => !used.has(candidateIndex) && candidate.typeId === item.typeId);
    const source = direct || (matchIndex >= 0 ? calculated[matchIndex] : null);
    if (source) used.add(direct ? index : matchIndex);
    const slot = additionSlot(key, item) ?? (source ? additionSlot(key, source) : null);
    if (slot == null) return item;
    const next = { ...item, typeName: item.typeName || source?.typeName, slot, ...(key === "implants" ? { implantSlot: slot } : { boosterSlot: slot }) };
    if (next.slot !== item.slot || next.implantSlot !== item.implantSlot || next.boosterSlot !== item.boosterSlot || next.typeName !== item.typeName) changed = true;
    return next;
  });
  return changed ? hydrated : current;
}

function hydrateCharacterSlots(fit: FitPayload, calculated?: FitPayload | null): FitPayload {
  if (!calculated) return fit;
  const implants = hydrateCharacterItemSlots("implants", fit.implants || [], calculated.implants || []);
  const boosters = hydrateCharacterItemSlots("boosters", fit.boosters || [], calculated.boosters || []);
  const calculatedMode = calculated.shipMode ?? null;
  const modeChanged = JSON.stringify(fit.shipMode ?? null) !== JSON.stringify(calculatedMode);
  const calculatedDamageProfile = calculated.damageProfile ?? null;
  const damageProfileChanged = JSON.stringify(fit.damageProfile ?? null) !== JSON.stringify(calculatedDamageProfile);
  return implants === fit.implants && boosters === fit.boosters && !modeChanged && !damageProfileChanged
    ? fit
    : { ...fit, implants, boosters, shipMode: calculatedMode, damageProfile: calculatedDamageProfile };
}

function slotTotal(stats: FittingStats | null, slot: SlotKey) {
  const total = Number(stats?.slots?.[slot]?.total);
  return Number.isFinite(total) ? total : null;
}

function slotDestination(slot: SlotKey) {
  return SLOT_LABELS[slot]?.toLowerCase() || "fit";
}

function hardpointKindFromType(item?: { hardpoint?: string | null; hardpointName?: string | null } | null): HardpointKind {
  const direct = String(item?.hardpoint || "").toLowerCase();
  if (direct === "turret" || direct === "launcher" || direct === "none") return direct;
  const name = String(item?.hardpointName || "").toLowerCase();
  if (name.includes("turret")) return "turret";
  if (name.includes("launcher") || name.includes("missile")) return "launcher";
  return "none";
}

function hardpointLabel(kind: HardpointKind) {
  return kind === "turret" ? "turret" : kind === "launcher" ? "launcher" : "module";
}

function hardpointFree(stats: FittingStats | null, kind: HardpointKind) {
  if (kind !== "turret" && kind !== "launcher") return null;
  const row = stats?.hardpoints?.[kind];
  const free = Number(row?.free);
  if (Number.isFinite(free)) return free;
  const used = Number(row?.used);
  const total = Number(row?.total);
  if (Number.isFinite(used) && Number.isFinite(total)) return total - used;
  return null;
}

function subsystemKindFromItem(item?: { typeName?: string; groupName?: string | null; marketGroupName?: string | null } | null): SubsystemKind | null {
  const text = [item?.typeName, item?.groupName, item?.marketGroupName].filter(Boolean).join(" ").toLowerCase();
  if (!text) return null;
  if (/\bcore\b/.test(text)) return "core";
  if (/\bdefensive\b|\bdefen[cs]e\b/.test(text)) return "defense";
  if (/\boffensive\b|\boffen[cs]e\b/.test(text)) return "offense";
  if (/\bpropulsion\b/.test(text)) return "propulsion";
  return null;
}

function subsystemKindLabel(kind: SubsystemKind) {
  return kind === "defense" ? "defense" : kind;
}

function countText(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n)) : "-";
}

function quantity(value: unknown, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function moduleKey(slot: SlotKey, index: number) {
  return `${slot}:${index}`;
}

function moduleInstanceKey(module: FittingModule, slot: SlotKey, index: number) {
  return module.id || moduleKey(slot, index);
}

function normalizedModuleState(state?: string) {
  return (state || "active").toLowerCase();
}

const MODULE_STATE_ORDER = ["offline", "online", "active", "overheated"] as const;

function rememberedOnlineState(module: FittingModule) {
  const previous = normalizedModuleState(module.previousState);
  if (previous === "active" || previous === "overheated" || previous === "online") return previous;
  const current = normalizedModuleState(module.state);
  if (current === "active" || current === "overheated" || current === "online") return current;
  return "active";
}

function withModuleState(module: FittingModule, requestedState: string): FittingModule {
  const requested = normalizedModuleState(requestedState);
  if (requested === "offline") return { ...module, state: "offline", previousState: rememberedOnlineState(module) };
  if (requested === "online") {
    const { previousState, ...rest } = module;
    return { ...rest, state: "online" };
  }
  if (requested === "active" || requested === "overheated") {
    const { previousState, ...rest } = module;
    return { ...rest, state: requested };
  }
  return { ...module, state: requestedState };
}

function isCommandBurstModule(module: FittingModule, detail?: SearchResult) {
  const haystack = `${module.typeName || ""} ${detail?.typeName || ""} ${detail?.groupName || ""}`.toLowerCase();
  return haystack.includes("command burst") && !haystack.includes("charge blueprint");
}

function commandBurstsForFit(fit: FitPayload, details: Record<number, SearchResult> = {}): CommandBurstSelection[] {
  const bursts: CommandBurstSelection[] = [];
  for (const slot of SLOT_ORDER) {
    fit.modules[slot].forEach((module, index) => {
      const detail = details[module.typeId];
      if (!isCommandBurstModule(module, detail)) return;
      bursts.push({
        sourceModuleInstanceId: moduleInstanceKey(module, slot, index),
        moduleTypeId: module.typeId,
        moduleName: module.typeName || detail?.typeName || `Type ${module.typeId}`,
        chargeTypeId: module.chargeTypeId || null,
        chargeTypeName: module.chargeTypeName || null,
        enabled: normalizedModuleState(module.state) !== "offline",
      });
    });
  }
  return bursts;
}

function moduleWarningTitle(stats: FittingStats | null, slot: SlotKey, index: number) {
  const warning = (stats?.skillWarnings || []).find((entry) => entry.slot === slot && entry.index === index);
  if (!warning?.missingSkills?.length) return "";
  return ["Skills required:", ...warning.missingSkills.map((skill) => `${skill.skillName}: ${skill.requiredLevel}${skill.actualLevel != null ? ` (you have ${skill.actualLevel})` : ""}`)].join("\n");
}

function BottomSheet({
  title,
  subtitle,
  leading,
  children,
  onClose,
}: {
  title: string;
  subtitle?: ReactNode;
  leading?: ReactNode;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="mobile-fitting-action-sheet-backdrop fixed inset-0 z-[10000] flex items-end bg-black/65" onMouseDown={onClose}>
      <div
        className="mobile-fitting-action-sheet flex w-full flex-col overflow-hidden border border-[#34404c] bg-[#070910] text-slate-100 shadow-2xl shadow-black"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-[#20242c] bg-[#101219] px-2">
          {leading}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-semibold uppercase tracking-widest text-slate-200">{title}</div>
            {subtitle && <div className="truncate font-mono text-[10px] text-slate-600">{subtitle}</div>}
          </div>
          <button type="button" className="flex h-8 w-8 items-center justify-center text-slate-400 active:text-slate-100" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(0.5rem+env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

function TouchRow({
  icon,
  title,
  subtitle,
  right,
  onClick,
  danger = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`grid min-h-9 w-full ${icon ? "grid-cols-[22px,1fr,auto]" : "grid-cols-[1fr,auto]"} items-center gap-1.5 border-b border-[#151922] bg-[#070910] px-2 py-1 text-left active:bg-[#101721] ${
        danger ? "text-red-200" : "text-slate-100"
      }`}
      onClick={onClick}
    >
      {icon && <span className="flex h-5 w-5 items-center justify-center">{icon}</span>}
      <span className="min-w-0">
        <span className="block truncate text-[11px]">{title}</span>
        {subtitle && <span className="block truncate text-[9px] text-slate-500">{subtitle}</span>}
      </span>
      <span className="text-[10px] text-slate-500">{right}</span>
    </button>
  );
}

function ActionGlyph({ label, danger = false }: { label: string; danger?: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 items-center justify-center border bg-[#05070b] font-mono text-[9px] ${
        danger ? "border-red-500/40 text-red-300" : "border-[#30343d] text-slate-500"
      }`}
    >
      {label}
    </span>
  );
}

function IconImage({ typeId, className = "h-8 w-8" }: { typeId?: number | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!typeId || failed) return <span className={`${className} border border-[#30343d] bg-black`} />;
  return <img src={eveIcon(typeId)} alt="" className={`${className} border border-[#30343d] bg-black object-cover`} onError={() => setFailed(true)} />;
}

function groupInGameFittings(fittings: InGameFittingSummary[], query: string) {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? fittings.filter((fit) => (
        fit.name.toLowerCase().includes(needle) ||
        fit.shipTypeName.toLowerCase().includes(needle) ||
        String(fit.shipGroupName || "").toLowerCase().includes(needle)
      ))
    : fittings;
  const groups = new Map<string, InGameFittingSummary[]>();
  for (const fitting of filtered) {
    const label = fitting.shipGroupName || "Other Ships";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(fitting);
  }
  return Array.from(groups.entries())
    .map(([label, items]) => ({
      key: treeKey(label),
      label,
      items: items.slice().sort((a, b) => a.shipTypeName.localeCompare(b.shipTypeName) || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => {
      const aOrder = IN_GAME_FIT_SHIP_GROUP_ORDER_INDEX.get(a.label.toLowerCase());
      const bOrder = IN_GAME_FIT_SHIP_GROUP_ORDER_INDEX.get(b.label.toLowerCase());
      if (aOrder !== undefined || bOrder !== undefined) return (aOrder ?? 9999) - (bOrder ?? 9999);
      return a.label.localeCompare(b.label);
    });
}

function SourceFitPicker({
  label,
  sources,
  onAdd,
}: {
  label: string;
  sources: CrossFitSourceSummary[];
  onAdd: (sourceTabId: string) => void;
}) {
  const [selected, setSelected] = useState("");
  return (
    <div className="flex gap-1.5">
      <select
        className="min-h-8 min-w-0 flex-1 border border-[#303236] bg-[#05070b] px-2 text-[11px] text-slate-100 outline-none"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
      >
        <option value="">{sources.length ? label : "No other open fits"}</option>
        {sources.map((source) => (
          <option key={source.tabId} value={source.tabId}>
            {source.fitName}{source.dirty ? " *" : ""}{source.shipName ? ` - ${source.shipName}` : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={primaryClass}
        disabled={!selected}
        onClick={() => {
          if (!selected) return;
          onAdd(selected);
          setSelected("");
        }}
      >
        Add
      </button>
    </div>
  );
}

function MobileInGameFittingsSheet({
  authUser,
  onClose,
  onImported,
}: {
  authUser: AuthUser | null;
  onClose: () => void;
  onImported: (data: ImportedFitResponse) => void;
}) {
  const [characters, setCharacters] = useState<InGameFittingCharacter[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);
  const [fittings, setFittings] = useState<InGameFittingSummary[]>([]);
  const [query, setQuery] = useState("");
  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [characterMenuId, setCharacterMenuId] = useState<number | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [loadingCharacters, setLoadingCharacters] = useState(false);
  const [loadingFittings, setLoadingFittings] = useState(false);
  const [importingId, setImportingId] = useState<number | null>(null);
  const [unlinkingCharacterId, setUnlinkingCharacterId] = useState<number | null>(null);
  const [configured, setConfigured] = useState(true);
  const [configMissing, setConfigMissing] = useState<string[]>([]);
  const [pendingAuth, setPendingAuth] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const knownCharacterIds = useRef<Set<number>>(new Set());

  const selectedCharacter = characters.find((character) => character.characterId === selectedCharacterId) || null;
  const managedCharacter = characters.find((character) => character.characterId === characterMenuId) || null;
  const groupedFittings = useMemo(() => groupInGameFittings(fittings, query), [fittings, query]);

  async function loadCharacters(preferredCharacterId: number | null = selectedCharacterId) {
    if (!authUser) {
      setCharacters([]);
      setSelectedCharacterId(null);
      setFittings([]);
      return [];
    }
    setLoadingCharacters(true);
    setError(null);
    try {
      const data = await readJson<{
        ok: boolean;
        configured?: boolean;
        configMissing?: string[];
        characters: InGameFittingCharacter[];
      }>(await triffApiFetch("/api/in-game-fitting/esi/characters"));
      const nextCharacters = data.characters || [];
      setConfigured(data.configured !== false);
      setConfigMissing(data.configMissing || []);
      setCharacters(nextCharacters);
      const preferred = preferredCharacterId
        ? nextCharacters.find((character) => Number(character.characterId) === Number(preferredCharacterId))
        : null;
      const nextSelected = preferred || nextCharacters[0] || null;
      setSelectedCharacterId(nextSelected?.characterId || null);
      if (!nextSelected) setFittings([]);
      return nextCharacters;
    } catch (err) {
      setError((err as Error).message || "Unable to load authorized characters.");
      setCharacters([]);
      setFittings([]);
      return [];
    } finally {
      setLoadingCharacters(false);
    }
  }

  async function loadFittings(characterId = selectedCharacterId) {
    if (!authUser || !characterId) {
      setFittings([]);
      return;
    }
    setLoadingFittings(true);
    setError(null);
    try {
      const data = await readJson<{ ok: boolean; fittings: InGameFittingSummary[] }>(
        await triffApiFetch(`/api/in-game-fitting/esi/characters/${encodeURIComponent(characterId)}/fittings`)
      );
      setFittings(data.fittings || []);
    } catch (err) {
      setError((err as Error).message || "Unable to fetch in-game fittings.");
      setFittings([]);
    } finally {
      setLoadingFittings(false);
    }
  }

  function beginAuthorization() {
    knownCharacterIds.current = new Set(characters.map((character) => Number(character.characterId)));
    setPendingAuth(true);
    setCharacterPickerOpen(false);
    setError("Waiting for EVE SSO authorization...");
  }

  async function beginNativeAuthorization() {
    beginAuthorization();
    try {
      const response = await triffApiFetch("/api/in-game-fitting/esi/login-url");
      const data = await readJson<{ ok: boolean; url: string }>(response);
      const opened = await openTriffExternalUrl(data.url, "triff-eve-fittings-sso");
      if (!opened) throw new Error("popup_blocked");
    } catch (err) {
      setPendingAuth(false);
      setError((err as Error).message || "Could not open EVE SSO.");
    }
  }

  function handleAuthorizeClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!authUser || !configured) {
      event.preventDefault();
      return;
    }
    if (!isNativeRuntime()) {
      beginAuthorization();
      return;
    }
    event.preventDefault();
    void beginNativeAuthorization();
  }

  async function importFitting(fitting: InGameFittingSummary) {
    if (!selectedCharacterId) return;
    setImportingId(fitting.fittingId);
    setError(null);
    try {
      const data = await readJson<ImportedFitResponse>(
        await triffApiFetch(`/api/in-game-fitting/esi/characters/${encodeURIComponent(selectedCharacterId)}/fittings/${encodeURIComponent(fitting.fittingId)}/import`, {
          method: "POST",
        })
      );
      onImported(data);
    } catch (err) {
      setError((err as Error).message || "Unable to import in-game fitting.");
    } finally {
      setImportingId(null);
    }
  }

  async function refreshCharacterFittings(character: InGameFittingCharacter) {
    setCharacterMenuId(null);
    setSelectedCharacterId(character.characterId);
    setCharacterPickerOpen(false);
    await loadFittings(character.characterId);
  }

  async function unlinkCharacter(character: InGameFittingCharacter) {
    setCharacterMenuId(null);
    if (!window.confirm(`Unlink ${character.characterName} from in-game fitting import?\n\nSkill profiles are not changed.`)) return;
    setUnlinkingCharacterId(character.characterId);
    setError(null);
    try {
      await readJson<{ ok: boolean }>(
        await triffApiFetch(`/api/in-game-fitting/esi/characters/${encodeURIComponent(character.characterId)}`, {
          method: "DELETE",
        })
      );
      await loadCharacters(character.characterId === selectedCharacterId ? null : selectedCharacterId);
      setError(`Unlinked in-game fitting access for ${character.characterName}.`);
    } catch (err) {
      setError((err as Error).message || "Unable to unlink character.");
    } finally {
      setUnlinkingCharacterId(null);
    }
  }

  useEffect(() => {
    void loadCharacters();
  }, [authUser?.id]);

  useEffect(() => {
    if (!selectedCharacterId) return;
    void loadFittings(selectedCharacterId);
  }, [selectedCharacterId]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!isTrustedSsoOrigin(event.origin)) return;
      const data = event.data || {};
      if (data.type !== "TRIFF_IN_GAME_FITTINGS_SSO_COMPLETE") return;
      setPendingAuth(false);
      if (data.ok) {
        void loadCharacters(Number(data.characterId) || null);
        setError(`Authorized in-game fittings for ${data.characterName || "character"}.`);
      } else {
        setError(data.message || "EVE SSO authorization failed.");
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [authUser?.id, selectedCharacterId]);

  useEffect(() => {
    if (!pendingAuth || !authUser) return;
    let stopped = false;
    let attempts = 0;
    async function pollCharacters() {
      attempts += 1;
      const nextCharacters = await loadCharacters();
      if (stopped) return;
      const newlyAuthorized = nextCharacters.find((character) => !knownCharacterIds.current.has(Number(character.characterId)));
      if (newlyAuthorized) {
        setPendingAuth(false);
        setSelectedCharacterId(newlyAuthorized.characterId);
        setError(`Authorized in-game fittings for ${newlyAuthorized.characterName}.`);
      } else if (attempts >= 60) {
        setPendingAuth(false);
        setError("EVE SSO is still pending. Use Refresh characters if it completed.");
      }
    }
    const first = window.setTimeout(() => void pollCharacters(), 1000);
    const timer = window.setInterval(() => void pollCharacters(), 2000);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [pendingAuth, authUser?.id]);

  const authorizeButton = configured ? (
    <a
      href={triffToolsUrl("/api/in-game-fitting/esi/login")}
      target="triff-eve-fittings-sso"
      rel="opener"
      className={`${primaryClass} w-full`}
      onClick={handleAuthorizeClick}
    >
      {pendingAuth ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
      Authorize Character
    </a>
  ) : (
    <button type="button" className={`${primaryClass} w-full`} disabled>
      Authorize Character
    </button>
  );

  return (
    <>
      <BottomSheet
        title="Import In-Game Fits"
        subtitle="esi-fittings.read_fittings.v1"
        onClose={onClose}
      >
        <div className="flex min-h-[min(28rem,calc(var(--mobile-fitting-visual-height,100dvh)-6rem))] flex-col p-2">
          {!authUser && (
            <div className="mb-2 border border-[#6b4b1e] bg-[#1a1206] p-2 text-[11px] leading-5 text-[#ffd596]">
              Sign in before importing in-game fits.
            </div>
          )}
          {!configured && (
            <div className="mb-2 border border-[#6b2b32] bg-[#1d090b] p-2 text-[11px] leading-5 text-[#ffaaaa]">
              In-game fitting SSO is not configured{configMissing.length ? `: ${configMissing.join(", ")}` : "."}
            </div>
          )}
          <button
            type="button"
            className="mb-2 grid min-h-10 w-full grid-cols-[auto,1fr,auto] items-center gap-2 border border-[#303236] bg-[#05070b] px-2 text-left active:border-[#53b6ff]/70 active:bg-[#101721]"
            onClick={() => setCharacterPickerOpen(true)}
            disabled={!authUser}
          >
            <span className="text-[9px] uppercase tracking-widest text-slate-500">Character</span>
            <span className="min-w-0 truncate text-[12px] text-slate-100">{selectedCharacter?.characterName || "No character authorized"}</span>
            <ChevronRight size={14} className="text-slate-500" />
          </button>
          <label className="mb-2 flex h-8 items-center gap-2 border border-[#303236] bg-[#030509] px-2">
            <Search size={13} className="text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[11px] text-slate-100 outline-none placeholder:text-slate-600"
              placeholder="Search in-game fits or ships..."
            />
          </label>
          {error && (
            <div className={`mb-2 border px-2 py-1.5 text-[11px] ${/authorized|waiting|unlinked/i.test(error) ? "border-[#1d76ad]/70 bg-[#07111a] text-[#9fddff]" : "border-[#6b2b32] bg-[#1d090b] text-[#ffaaaa]"}`}>
              {error}
            </div>
          )}
          <div className="mb-1 flex items-center justify-between px-1 text-[10px] uppercase tracking-widest text-[#7f91a8]">
            <span>{selectedCharacter ? `${selectedCharacter.characterName}'s Fits` : "In-Game Fits"}</span>
            <span className="font-mono text-slate-500">{groupedFittings.reduce((total, group) => total + group.items.length, 0)} / {fittings.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto border border-[#252a33] bg-[#05070b]">
            {loadingFittings ? (
              <div className="flex h-full min-h-40 items-center justify-center gap-2 text-[11px] text-slate-500">
                <Loader2 size={14} className="animate-spin" />
                Loading in-game fits...
              </div>
            ) : !selectedCharacterId ? (
              <div className="flex h-full min-h-40 flex-col justify-center gap-3 p-4 text-center text-[11px] leading-5 text-slate-500">
                <span>Authorize a character to list in-game saved fittings.</span>
                {authorizeButton}
              </div>
            ) : groupedFittings.length ? (
              groupedFittings.map((group) => {
                const isOpen = query.trim().length > 0 || !!expandedGroups[group.key];
                return (
                  <section key={group.key} className="border-b border-[#151922]">
                    <button
                      type="button"
                      className={`flex h-7 w-full items-center gap-1.5 px-1.5 text-left text-[11px] ${isOpen ? "bg-[#111923] text-slate-100" : "text-slate-400 active:bg-[#0d1118]"}`}
                      onClick={() => setExpandedGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                    >
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <PyfaGuiIcon name="ship" label="Ship group" className="h-4 w-4" />
                      <span className="min-w-0 flex-1 truncate">{group.label}</span>
                      <span className="pr-1 font-mono text-[10px] text-slate-600">{group.items.length}</span>
                    </button>
                    {isOpen && (
                      <div className="divide-y divide-[#171d27] border-t border-[#151922]">
                        {group.items.map((fitting) => (
                          <div key={fitting.fittingId} className="grid grid-cols-[34px,minmax(0,1fr),auto] items-center gap-2 px-2 py-2 active:bg-[#0b1018]">
                            <IconImage typeId={fitting.shipTypeId} className="h-8 w-8" />
                            <div className="min-w-0">
                              <div className="truncate text-[11px] font-semibold text-slate-100">{fitting.name}</div>
                              <div className="mt-0.5 truncate text-[9px] text-[#7f91a8]">
                                {fitting.shipTypeName} - {fitting.moduleCount} modules - {fitting.droneCount} drones - {fitting.cargoCount} cargo
                              </div>
                            </div>
                            <button
                              type="button"
                              className={rowButton}
                              disabled={importingId === fitting.fittingId}
                              onClick={() => void importFitting(fitting)}
                            >
                              {importingId === fitting.fittingId ? <Loader2 size={13} className="animate-spin" /> : null}
                              Open
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })
            ) : (
              <div className="flex h-full min-h-40 items-center justify-center px-4 text-center text-[11px] leading-5 text-slate-500">
                {query.trim() ? "No in-game fits match." : "No in-game fits found for this character."}
              </div>
            )}
          </div>
        </div>
      </BottomSheet>

      {characterPickerOpen && (
        <BottomSheet title="Characters" subtitle="In-game fitting import access" onClose={() => setCharacterPickerOpen(false)}>
          <div className="space-y-2 p-2">
            {authorizeButton}
            <button type="button" className={`${buttonClass} w-full`} onClick={() => void loadCharacters()} disabled={loadingCharacters}>
              {loadingCharacters ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Refresh Characters
            </button>
            <div className="max-h-[min(24rem,calc(var(--mobile-fitting-visual-height,100dvh)-14rem))] overflow-y-auto border border-[#252a33]">
              {characters.length ? (
                characters.map((character) => (
                  <div key={character.characterId} className={`relative grid grid-cols-[minmax(0,1fr),2rem] border-b border-[#151922] last:border-b-0 ${character.characterId === selectedCharacterId ? "bg-[#0b1723]" : "bg-[#05070b]"}`}>
                    <button
                      type="button"
                      className="min-w-0 px-2 py-2 text-left"
                      onClick={() => {
                        setSelectedCharacterId(character.characterId);
                        setCharacterPickerOpen(false);
                      }}
                    >
                      <div className="truncate text-[12px] font-semibold text-slate-100">{character.characterName}</div>
                      <div className="mt-0.5 truncate text-[10px] text-slate-500">{character.tokenStatus || "ok"}</div>
                    </button>
                    <button
                      type="button"
                      className="flex items-center justify-center border-l border-[#252a33] text-slate-500 active:bg-[#101721] active:text-[#9fddff]"
                      onClick={() => setCharacterMenuId((current) => (current === character.characterId ? null : character.characterId))}
                      disabled={unlinkingCharacterId === character.characterId}
                      aria-label={`Manage ${character.characterName}`}
                    >
                      {unlinkingCharacterId === character.characterId ? <Loader2 size={13} className="animate-spin" /> : <Settings size={13} />}
                    </button>
                  </div>
                ))
              ) : (
                <div className="px-3 py-3 text-[11px] text-slate-500">
                  {loadingCharacters ? "Loading characters..." : "No characters authorized for fitting import yet."}
                </div>
              )}
            </div>
          </div>
        </BottomSheet>
      )}

      {managedCharacter && (
        <BottomSheet
          title={managedCharacter.characterName}
          subtitle="In-game fitting access"
          onClose={() => setCharacterMenuId(null)}
        >
          <div className="p-2">
            <TouchRow
              icon={<RefreshCw size={14} className="text-[#9fddff]" />}
              title="Refresh Fits"
              subtitle="Fetch this character's in-game saved fittings."
              onClick={() => void refreshCharacterFittings(managedCharacter)}
            />
            <TouchRow
              icon={<X size={14} className="text-[#ffb4bd]" />}
              title="Unlink Character"
              subtitle="Only removes in-game fitting import access."
              danger
              onClick={() => void unlinkCharacter(managedCharacter)}
            />
          </div>
        </BottomSheet>
      )}
    </>
  );
}

type PersistedMobileWorkspace = {
  version: 1;
  savedAt: string;
  workspace: WorkspaceState;
  view?: MobileView;
  additionTab?: AdditionTab;
};

const PERSISTED_WORKSPACE_VERSION = 1;

function isMobileView(value: unknown): value is MobileView {
  return ["fit", "browser", "stats", "additions", "projected", "command"].includes(String(value));
}

function isAdditionTab(value: unknown): value is AdditionTab {
  return ["drones", "fighters", "cargo", "implants", "boosters", "notes"].includes(String(value));
}

function normalizePersistedWorkspace(raw: unknown): WorkspaceState | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<WorkspaceState>;
  if (!Array.isArray(candidate.openFits)) return null;

  const openFits = candidate.openFits
    .map((tab) => {
      if (!tab || typeof tab !== "object") return null;
      const rawTab = tab as Partial<OpenFitTab>;
      const fitState = ensureFitPayload(rawTab.fitState);
      const currentHash = fitHash(fitState);
      return {
        tabId: rawTab.tabId || makeTabId(),
        savedFitId: rawTab.savedFitId || null,
        fitName: fitState.fitName || rawTab.fitName || "New Fit",
        shipTypeId: fitState.shipTypeId || rawTab.shipTypeId || null,
        shipName: fitShipName(fitState) || rawTab.shipName || null,
        fitState,
        calculationResult: rawTab.calculationResult || null,
        stats: rawTab.stats || null,
        warnings: Array.isArray(rawTab.warnings) ? rawTab.warnings : [],
        errors: Array.isArray(rawTab.errors) ? rawTab.errors : [],
        dirty: Boolean(rawTab.dirty),
        openedFromSavedAt: rawTab.openedFromSavedAt || null,
        lastSavedHash: rawTab.lastSavedHash || currentHash,
        currentHash: rawTab.currentHash || currentHash,
        projectedLinks: Array.isArray(rawTab.projectedLinks) ? rawTab.projectedLinks : [],
        commandLinks: Array.isArray(rawTab.commandLinks) ? rawTab.commandLinks : [],
      } satisfies OpenFitTab;
    })
    .filter(Boolean) as OpenFitTab[];

  if (!openFits.length) return null;
  const activeTabId = openFits.some((tab) => tab.tabId === candidate.activeTabId) ? String(candidate.activeTabId) : openFits[0].tabId;
  return { openFits, activeTabId };
}

function readPersistedMobileWorkspace(storageKey?: string): PersistedMobileWorkspace | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedMobileWorkspace>;
    if (parsed.version !== PERSISTED_WORKSPACE_VERSION) return null;
    const workspace = normalizePersistedWorkspace(parsed.workspace);
    if (!workspace) return null;
    return {
      version: PERSISTED_WORKSPACE_VERSION,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
      workspace,
      view: isMobileView(parsed.view) ? parsed.view : undefined,
      additionTab: isAdditionTab(parsed.additionTab) ? parsed.additionTab : undefined,
    };
  } catch {
    return null;
  }
}

function writePersistedMobileWorkspace(storageKey: string | undefined, snapshot: Omit<PersistedMobileWorkspace, "version" | "savedAt">) {
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: PERSISTED_WORKSPACE_VERSION,
        savedAt: new Date().toISOString(),
        ...snapshot,
      })
    );
  } catch {
    // Persistence is best-effort; the fitting workspace remains usable in memory.
  }
}

export default function MobileFittingPage({
  sharedFitId,
  workspaceStorageKey,
  topBarAccessory = null,
  standalone = false,
}: MobileFittingPageProps = {}) {
  const [searchParams] = useSearchParams();
  const deepLinkShipTypeId = useMemo(() => fittingDeepLinkTypeId(searchParams), [searchParams]);
  const persistedSnapshot = useRef<PersistedMobileWorkspace | null | undefined>(undefined);
  if (persistedSnapshot.current === undefined) {
    persistedSnapshot.current = readPersistedMobileWorkspace(workspaceStorageKey);
  }
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => readFittingWorkspaceSnapshot<WorkspaceState>(() => {
    if (persistedSnapshot.current?.workspace) return persistedSnapshot.current.workspace;
    const tab = makeWorkspaceTab(emptyFit());
    return { openFits: [tab], activeTabId: tab.tabId };
  }));
  const [view, setView] = useState<MobileView>(() => persistedSnapshot.current?.view || "browser");
  const [statsMode, setStatsMode] = useState<MobileStatsMode>("stats");
  const [shipBrowserFocusToken, setShipBrowserFocusToken] = useState(0);
  const [additionTab, setAdditionTab] = useState<AdditionTab>(() => persistedSnapshot.current?.additionTab || "drones");
  const [typeDetails, setTypeDetails] = useState<Record<number, SearchResult>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [modal, setModal] = useState<"import" | "export" | null>(null);
  const [eftText, setEftText] = useState("");
  const [exportText, setExportText] = useState("");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [moduleSheet, setModuleSheet] = useState<ModuleSheetState>(null);
  const [characterSheet, setCharacterSheet] = useState<CharacterSheetState>(null);
  const [itemInfoTarget, setItemInfoTarget] = useState<ItemInfoTarget>(null);
  const [fitsSheetOpen, setFitsSheetOpen] = useState(false);
  const [importChoiceOpen, setImportChoiceOpen] = useState(false);
  const [inGameFitsOpen, setInGameFitsOpen] = useState(false);
  const [mutationEditor, setMutationEditor] = useState<MutationEditorState>(null);
  const [charges, setCharges] = useState<ChargeResult[]>([]);
  const [variants, setVariants] = useState<SearchResult[]>([]);
  const [mutaplasmids, setMutaplasmids] = useState<MutaplasmidResult[]>([]);
  const [implantSets, setImplantSets] = useState<ImplantSet[]>([]);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [pendingSaveAfterAuth, setPendingSaveAfterAuth] = useState(false);
  const [savedFitGroups, setSavedFitGroups] = useState<SavedFitGroup[]>([]);
  const [savedFitsLoading, setSavedFitsLoading] = useState(false);
  const [savedFitsError, setSavedFitsError] = useState<string | null>(null);
  const [savedFitFocus, setSavedFitFocus] = useState<SavedFitFocus | null>(null);
  const [linkedCharacters, setLinkedCharacters] = useState<LinkedEsiCharacter[]>([]);
  const [esiConfigured, setEsiConfigured] = useState(true);
  const [esiConfigMissing, setEsiConfigMissing] = useState<string[]>([]);
  const [esiBusy, setEsiBusy] = useState<string | null>(null);
  const [esiPending, setEsiPending] = useState(false);
  const [esiLinkSheetOpen, setEsiLinkSheetOpen] = useState(false);
  const [manageCharactersOpen, setManageCharactersOpen] = useState(false);
  const [pendingEsiLinkAfterAuth, setPendingEsiLinkAfterAuth] = useState(false);
  const [pendingInGameImportAfterAuth, setPendingInGameImportAfterAuth] = useState(false);
  const [mobileGraphStateByTab, setMobileGraphStateByTab] = useState<Record<string, GraphPanelState>>({});
  const [skillOverridesByTab, setSkillOverridesByTab] = useState<Record<string, SkillOverrideMap>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [mobileToast, setMobileToast] = useState<MobileToast>(null);
  const esiPendingKnownIds = useRef<Set<number>>(new Set());
  const handledDeepLinkShipTypeId = useRef<number | null>(null);
  const handledSharedFitId = useRef<string | null>(null);
  const previousAuthUserId = useRef<string | null>(null);

  useEffect(() => {
    writeFittingWorkspaceSnapshot(workspace);
    writePersistedMobileWorkspace(workspaceStorageKey, { workspace, view, additionTab });
  }, [workspace, workspaceStorageKey, view, additionTab]);

  useEffect(() => {
    const openTabIds = new Set(workspace.openFits.map((tab) => tab.tabId));
    setSkillOverridesByTab((prev) => {
      let changed = false;
      const next: Record<string, SkillOverrideMap> = {};
      for (const [tabId, overrides] of Object.entries(prev)) {
        if (openTabIds.has(tabId)) {
          next[tabId] = overrides;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [workspace.openFits]);

  const activeTab = workspace.openFits.find((tab) => tab.tabId === workspace.activeTabId) || workspace.openFits[0];
  const fit = activeTab?.fitState || emptyFit();
  const stats = activeTab?.stats || null;
  const warnings = activeTab?.warnings || [];
  const errors = activeTab?.errors || [];
  const activeSavedFitId = activeTab?.savedFitId || null;
  const projectedLinks = activeTab?.projectedLinks || [];
  const commandLinks = activeTab?.commandLinks || [];
  const activeSkillOverrides = activeTab ? skillOverridesByTab[activeTab.tabId] || {} : {};
  const skillOverrideCount = Object.keys(activeSkillOverrides).length;
  const calculationFit = useMemo(() => fitWithSkillOverrides(fit, activeSkillOverrides), [fit, activeSkillOverrides]);
  const skillProfile = fit.skillProfile || { mode: "all_v" as const };
  const selectedLinkedCharacter = skillProfile.mode === "esi_character" ? linkedCharacters.find((character) => character.characterId === skillProfile.characterId) || null : null;
  const shipSummary = fit.shipTypeId ? { typeId: fit.shipTypeId, typeName: fit.shipTypeName || `Type ${fit.shipTypeId}` } : null;

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehaviorY;
    const root = document.documentElement;
    let stableStandaloneHeight = Math.max(window.innerHeight || 0, window.visualViewport?.height || 0);
    const safeAreaProbe = document.createElement("div");
    safeAreaProbe.style.cssText = [
      "position: fixed",
      "visibility: hidden",
      "pointer-events: none",
      "inset: 0",
      "padding-bottom: env(safe-area-inset-bottom)",
    ].join(";");
    document.body.appendChild(safeAreaProbe);
    const setViewportVars = () => {
      const viewport = window.visualViewport;
      const rawHeight = viewport?.height || window.innerHeight;
      const rawTop = viewport?.offsetTop || 0;
      const rem = parseFloat(window.getComputedStyle(root).fontSize) || 16;
      const siteChromeHeight = standalone ? 0 : rem * 3;
      const safeBottom = parseFloat(window.getComputedStyle(safeAreaProbe).paddingBottom) || 0;
      const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
      const installedStandalone =
        standalone &&
        (window.matchMedia?.("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true);
      const activeElement = document.activeElement;
      const activeInput =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement;
      const layoutHeight = Math.max(window.innerHeight || 0, rawHeight || 0);
      const keyboardOpen = standalone && activeInput && Math.max(0, stableStandaloneHeight - rawHeight) > 80;
      if (standalone && !keyboardOpen) {
        stableStandaloneHeight = layoutHeight;
      }
      const visualHeight = keyboardOpen ? stableStandaloneHeight : rawHeight;
      const visualTop = keyboardOpen ? 0 : rawTop;
      const height = Math.max(0, visualHeight - siteChromeHeight);
      const top = visualTop + siteChromeHeight;
      const appHeight = standalone
        ? (installedStandalone ? stableStandaloneHeight + safeBottom : stableStandaloneHeight)
        : height;
      root.style.setProperty("--mobile-fitting-visual-height", `${height}px`);
      root.style.setProperty("--mobile-fitting-visual-top", `${top}px`);
      root.style.setProperty("--mobile-fitting-app-height", `${appHeight}px`);
    };
    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehaviorY = "none";
    setViewportVars();
    window.visualViewport?.addEventListener("resize", setViewportVars);
    window.visualViewport?.addEventListener("scroll", setViewportVars);
    window.addEventListener("resize", setViewportVars);
    window.addEventListener("orientationchange", setViewportVars);
    window.addEventListener("focusin", setViewportVars);
    window.addEventListener("focusout", setViewportVars);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overscrollBehaviorY = previousHtmlOverscroll;
      window.visualViewport?.removeEventListener("resize", setViewportVars);
      window.visualViewport?.removeEventListener("scroll", setViewportVars);
      window.removeEventListener("resize", setViewportVars);
      window.removeEventListener("orientationchange", setViewportVars);
      window.removeEventListener("focusin", setViewportVars);
      window.removeEventListener("focusout", setViewportVars);
      root.style.removeProperty("--mobile-fitting-visual-height");
      root.style.removeProperty("--mobile-fitting-visual-top");
      root.style.removeProperty("--mobile-fitting-app-height");
      safeAreaProbe.remove();
    };
  }, [standalone]);

  const sourceFitOptions = useMemo<CrossFitSourceSummary[]>(
    () =>
      workspace.openFits
        .filter((tab) => tab.tabId !== workspace.activeTabId)
        .map((tab) => ({ tabId: tab.tabId, fitName: tab.fitName || "New Fit", shipTypeId: tab.shipTypeId, shipName: tab.shipName, dirty: tab.dirty })),
    [workspace.openFits, workspace.activeTabId]
  );
  const graphOpenFitTargets = useMemo(
    () =>
      workspace.openFits
        .filter((tab) => tab.tabId !== workspace.activeTabId)
        .map((tab) => ({
          tabId: tab.tabId,
          fitName: tab.fitName || "New Fit",
          shipName: tab.shipName,
          dirty: tab.dirty,
          fitState: fitWithSkillOverrides(tab.fitState, skillOverridesByTab[tab.tabId]),
        })),
    [workspace.openFits, workspace.activeTabId, skillOverridesByTab]
  );

  const commandBurstsBySource = useMemo<Record<string, CommandBurstSelection[]>>(() => {
    const out: Record<string, CommandBurstSelection[]> = {};
    for (const tab of workspace.openFits) {
      if (tab.tabId === workspace.activeTabId) continue;
      out[tab.tabId] = commandBurstsForFit(tab.fitState, typeDetails);
    }
    return out;
  }, [workspace.openFits, workspace.activeTabId, typeDetails]);

  const calculationRequest = useMemo(() => {
    const linkedSourceIds = new Set<string>();
    for (const link of projectedLinks) linkedSourceIds.add(link.sourceTabId);
    for (const link of commandLinks) linkedSourceIds.add(link.sourceTabId);
    const sourceFits = Array.from(linkedSourceIds)
      .map((tabId) => workspace.openFits.find((tab) => tab.tabId === tabId))
      .filter(Boolean)
      .map((tab) => ({ tabId: tab!.tabId, fitName: tab!.fitName, shipName: tab!.shipName, dirty: tab!.dirty, fitState: fitWithSkillOverrides(tab!.fitState, skillOverridesByTab[tab!.tabId]) }));
    return { ...calculationFit, targetFit: calculationFit, sourceFits, projectedLinks, commandLinks };
  }, [calculationFit, projectedLinks, commandLinks, workspace.openFits, skillOverridesByTab]);

  const calculationKey = useMemo(() => JSON.stringify(calculationRequest), [calculationRequest]);
  const moduleIdsKey = useMemo(() => {
    const ids = new Set<number>();
    for (const tab of workspace.openFits) {
      for (const slot of SLOT_ORDER) {
        for (const module of tab.fitState.modules[slot]) {
          if (module.typeId) ids.add(module.typeId);
          if (module.chargeTypeId) ids.add(module.chargeTypeId);
        }
      }
    }
    return Array.from(ids).sort((a, b) => a - b).join(",");
  }, [workspace.openFits]);

  function updateActiveTab(mutator: (tab: OpenFitTab) => OpenFitTab) {
    setWorkspace((prev) => ({ ...prev, openFits: prev.openFits.map((tab) => (tab.tabId === prev.activeTabId ? mutator(tab) : tab)) }));
  }

  function setFit(next: FitPayload | ((prev: FitPayload) => FitPayload)) {
    updateActiveTab((tab) => updateTabFit(tab, typeof next === "function" ? next(tab.fitState) : next));
  }

  function setTabCalculation(tabId: string, result: CalculationResponse | null) {
    setWorkspace((prev) => ({
      ...prev,
      openFits: prev.openFits.map((tab) => {
        if (tab.tabId !== tabId) return tab;
        const fitState = result?.payload ? hydrateCharacterSlots(tab.fitState, ensureFitPayload(result.payload)) : tab.fitState;
        const currentHash = fitState === tab.fitState ? tab.currentHash : fitHash(fitState);
        const lastSavedHash = fitState === tab.fitState || tab.dirty ? tab.lastSavedHash : currentHash;
        return {
          ...tab,
          fitState,
          currentHash,
          lastSavedHash,
          dirty: currentHash !== lastSavedHash,
          calculationResult: result,
          stats: result?.stats || null,
          warnings: result?.warnings || [],
          errors: result?.errors || [],
        };
      }),
    }));
  }

  function setTabErrors(tabId: string, nextErrors: FitMessage[]) {
    setWorkspace((prev) => ({ ...prev, openFits: prev.openFits.map((tab) => (tab.tabId === tabId ? { ...tab, errors: nextErrors } : tab)) }));
  }

  function setErrors(nextErrors: FitMessage[]) {
    updateActiveTab((tab) => ({ ...tab, errors: nextErrors }));
  }

  function clearErrorCode(code: string) {
    updateActiveTab((tab) => ({ ...tab, errors: tab.errors.filter((error) => error.code !== code) }));
  }

  function setActiveMobileGraphState(nextState: GraphPanelState) {
    const tabId = activeTab?.tabId;
    if (!tabId) return;
    setMobileGraphStateByTab((prev) => ({ ...prev, [tabId]: nextState }));
  }

  function setWarnings(nextWarnings: FitMessage[] | ((prev: FitMessage[]) => FitMessage[])) {
    updateActiveTab((tab) => ({ ...tab, warnings: typeof nextWarnings === "function" ? nextWarnings(tab.warnings) : nextWarnings }));
  }

  function openShipBrowser() {
    setView("browser");
    setShipBrowserFocusToken((token) => token + 1);
  }

  useEffect(() => {
    const calculationTabId = activeTab?.tabId;
    if (!calculationTabId) return;
    if (!fit.shipTypeId) {
      setTabCalculation(calculationTabId, null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCalculating(true);
      try {
        const response = await triffApiFetch("/api/fitting/calculate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(calculationRequest),
          signal: controller.signal,
        });
        setTabCalculation(calculationTabId, await readJson<CalculationResponse>(response));
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setTabCalculation(calculationTabId, null);
          setTabErrors(calculationTabId, [{ code: "calculate_failed", message: (err as Error).message }]);
        }
      } finally {
        setCalculating(false);
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [calculationKey, activeTab?.tabId]);

  useEffect(() => {
    let alive = true;
    async function loadAuth() {
      try {
        const response = await triffApiFetch("/api/auth/me");
        const data = await readJson<{ ok: boolean; authenticated: boolean; user: AuthUser | null }>(response);
        if (alive) setAuthUser(data.authenticated ? data.user : null);
      } catch {
        if (alive) setAuthUser(null);
      }
    }
    function handleAuthChanged(event: Event) {
      const detail = (event as CustomEvent<SiteAuthChangeDetail>).detail;
      if (detail && "user" in detail) {
        setAuthUser(detail.user);
      } else {
        void loadAuth();
      }
    }
    void loadAuth();
    window.addEventListener(SITE_AUTH_CHANGED_EVENT, handleAuthChanged);
    return () => {
      alive = false;
      window.removeEventListener(SITE_AUTH_CHANGED_EVENT, handleAuthChanged);
    };
  }, []);

  useEffect(() => {
    if (!authUser) {
      setSavedFitGroups([]);
      setLinkedCharacters([]);
      return;
    }
    void refreshSavedFitTree();
    void refreshLinkedCharacters();
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    if (pendingSaveAfterAuth) {
      setPendingSaveAfterAuth(false);
      window.setTimeout(() => void saveCurrentFit(true), 0);
    }
    if (pendingEsiLinkAfterAuth) {
      setPendingEsiLinkAfterAuth(false);
      setEsiLinkSheetOpen(true);
    }
    if (pendingInGameImportAfterAuth) {
      setPendingInGameImportAfterAuth(false);
      setInGameFitsOpen(true);
    }
  }, [authUser, pendingSaveAfterAuth, pendingEsiLinkAfterAuth, pendingInGameImportAfterAuth]);

  useEffect(() => {
    const previous = previousAuthUserId.current;
    const current = authUser?.id || null;
    if (previous && !current) {
      setWorkspace((prev) => ({
        ...prev,
        openFits: prev.openFits.map((tab) => updateTabFit(tab, { ...tab.fitState, skillProfile: { mode: "all_v" } }, { savedFitId: null, resetBaseline: true })),
      }));
      setNotice("Signed out.");
    }
    previousAuthUserId.current = current;
  }, [authUser]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!mobileToast) return;
    const timer = window.setTimeout(() => setMobileToast(null), mobileToast.tone === "error" ? 3200 : 2200);
    return () => window.clearTimeout(timer);
  }, [mobileToast]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!isTrustedSsoOrigin(event.origin)) return;
      const data = event.data || {};
      if (data.type !== "TRIFF_EVE_SSO_COMPLETE") return;
      setEsiPending(false);
      if (data.ok) {
        void refreshLinkedCharacters({ preserveOnError: true }).then((characters) => {
          const linked = characters.find((character) => Number(character.characterId) === Number(data.characterId));
          if (linked) selectLinkedCharacter(linked);
        });
        setNotice(`Linked EVE character: ${data.characterName || "character"}.`);
      } else {
        setErrors([{ code: "esi_sso_failed", message: data.message || "EVE SSO linking failed." }]);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [authUser]);

  useEffect(() => {
    if (!esiPending || !authUser) return;
    let stopped = false;
    let attempts = 0;
    async function pollLinkedCharacters() {
      attempts += 1;
      const characters = await refreshLinkedCharacters({ preserveOnError: true });
      if (stopped) return;
      const linked = characters.find((character) => !esiPendingKnownIds.current.has(Number(character.characterId)));
      if (linked) {
        setEsiPending(false);
        selectLinkedCharacter(linked);
        setNotice(`Linked EVE character: ${linked.characterName}.`);
      } else if (attempts >= 60) {
        setEsiPending(false);
        setNotice("EVE SSO is still pending. Use Refresh selected character or Manage linked characters if it completed.");
      }
    }
    const first = window.setTimeout(() => void pollLinkedCharacters(), 1000);
    const timer = window.setInterval(() => void pollLinkedCharacters(), 2000);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [esiPending, authUser]);

  useEffect(() => {
    const ids = moduleIdsKey ? moduleIdsKey.split(",").map(Number).filter(Boolean) : [];
    const missing = ids.filter((id) => !typeDetails[id]);
    if (!missing.length) return;
    let alive = true;
    async function loadDetails() {
      const pairs = await Promise.allSettled(missing.map(async (id) => [id, await fetchType(id)] as const));
      if (!alive) return;
      setTypeDetails((prev) => {
        const next = { ...prev };
        for (const pair of pairs) if (pair.status === "fulfilled") next[pair.value[0]] = pair.value[1];
        return next;
      });
    }
    void loadDetails();
    return () => {
      alive = false;
    };
  }, [moduleIdsKey, typeDetails]);

  async function fetchType(typeId: number) {
    const response = await triffApiFetch(`/api/fitting/type/${typeId}`);
    const data = await readJson<{ ok: boolean; type: SearchResult }>(response);
    return normalizeType(data.type);
  }

  useEffect(() => {
    if (!deepLinkShipTypeId || handledDeepLinkShipTypeId.current === deepLinkShipTypeId) return;
    let alive = true;

    async function hydrateDeepLinkedShip() {
      try {
        const detail = await fetchType(deepLinkShipTypeId);
        if (!alive) return;
        setTypeDetails((prev) => ({ ...prev, [detail.typeId]: detail }));
        if (detail.pyfaKind === "ship" || detail.categoryName === "Ship") {
          setShip(detail);
        } else {
          setErrors([{
            code: "unsupported_fitting_deep_link",
            message: "Fitting deep links open ship hulls only. Select a ship before adding modules or charges.",
          }]);
        }
        handledDeepLinkShipTypeId.current = deepLinkShipTypeId;
      } catch (err) {
        if (!alive) return;
        handledDeepLinkShipTypeId.current = deepLinkShipTypeId;
        setErrors([{ code: "fitting_deep_link_failed", message: (err as Error).message || "Unable to open linked ship." }]);
      }
    }

    void hydrateDeepLinkedShip();
    return () => {
      alive = false;
    };
  }, [deepLinkShipTypeId]);

  async function fetchChargesFor(typeId: number) {
    const response = await triffApiFetch(`/api/fitting/charges/${typeId}`);
    const data = await readJson<{ ok: boolean; charges: ChargeResult[] }>(response);
    return data.charges || [];
  }

  async function fetchVariantsFor(typeId: number) {
    const response = await triffApiFetch(`/api/fitting/variants/${typeId}`);
    const data = await readJson<{ ok: boolean; variants: SearchResult[] }>(response);
    return data.variants || [];
  }

  async function fetchMutaplasmidsFor(typeId: number) {
    const response = await triffApiFetch(`/api/fitting/mutaplasmids/${typeId}`);
    const data = await readJson<{ ok: boolean; mutaplasmids: MutaplasmidResult[] }>(response);
    return data.mutaplasmids || [];
  }

  async function fetchImplantSets() {
    const response = await triffApiFetch("/api/fitting/implant-sets");
    const data = await readJson<{ ok: boolean; sets: ImplantSet[] }>(response);
    return data.sets || [];
  }

  async function refreshSavedFitTree(force = false) {
    if (!authUser && !force) return [];
    setSavedFitsLoading(true);
    setSavedFitsError(null);
    try {
      const response = await triffApiFetch("/api/fitting/saved-fits/tree");
      const data = await readJson<{ ok: boolean; groups: SavedFitGroup[] }>(response);
      setSavedFitGroups(data.groups || []);
      return data.groups || [];
    } catch (err) {
      setSavedFitsError((err as Error).message || "Saved fits failed to load.");
      setSavedFitGroups([]);
      return [];
    } finally {
      setSavedFitsLoading(false);
    }
  }

  async function refreshLinkedCharacters(options: { preserveOnError?: boolean } = {}) {
    if (!authUser) {
      setLinkedCharacters([]);
      return [];
    }
    try {
      const response = await triffApiFetch("/api/fitting/esi/characters");
      const data = await readJson<{ ok: boolean; configured?: boolean; configMissing?: string[]; characters: LinkedEsiCharacter[] }>(response);
      setEsiConfigured(data.configured !== false);
      setEsiConfigMissing(data.configMissing || []);
      setLinkedCharacters(data.characters || []);
      return data.characters || [];
    } catch {
      if (!options.preserveOnError) setLinkedCharacters([]);
      return options.preserveOnError ? linkedCharacters : [];
    }
  }

  function openNewFitTab() {
    const tab = makeWorkspaceTab(emptyFit());
    setWorkspace((prev) => ({ openFits: [...prev.openFits, tab], activeTabId: tab.tabId }));
    openShipBrowser();
  }

  function switchFitTab(tabId: string) {
    setWorkspace((prev) => ({ ...prev, activeTabId: tabId }));
    setFitsSheetOpen(false);
    setModuleSheet(null);
    setCharacterSheet(null);
  }

  function closeFitTab(tabId: string) {
    const target = workspace.openFits.find((tab) => tab.tabId === tabId);
    if (!target) return;
    if (target.dirty && !window.confirm("This fit has unsaved changes. Close without saving?")) return;
    setWorkspace((prev) => {
      const remaining = prev.openFits
        .filter((tab) => tab.tabId !== tabId)
        .map((tab) => ({
          ...tab,
          projectedLinks: tab.projectedLinks.filter((link) => link.sourceTabId !== tabId),
          commandLinks: tab.commandLinks.filter((link) => link.sourceTabId !== tabId),
        }));
      if (!remaining.length) {
        const next = makeWorkspaceTab(emptyFit());
        return { openFits: [next], activeTabId: next.tabId };
      }
      return { openFits: remaining, activeTabId: prev.activeTabId === tabId ? remaining[0].tabId : prev.activeTabId };
    });
  }

  function renameFitTab(tabId: string) {
    const target = workspace.openFits.find((tab) => tab.tabId === tabId);
    if (!target) return;
    const currentName = target.fitState.fitName || target.fitName || "New Fit";
    const nextName = window.prompt("Rename fit", currentName);
    if (nextName == null) return;
    const fitName = nextName.trim() || "New Fit";
    setWorkspace((prev) => ({
      ...prev,
      openFits: prev.openFits.map((tab) => (tab.tabId === tabId ? updateTabFit(tab, { ...tab.fitState, fitName }) : tab)),
    }));
  }

  function setShip(item: SearchResult) {
    setWorkspace((prev) => {
      const current = prev.openFits.find((tab) => tab.tabId === prev.activeTabId);
      const nextFit = ensureFitPayload({
        ...emptyFit(),
        skillProfile: current?.fitState.skillProfile || { mode: "all_v" },
        shipTypeId: item.typeId,
        shipTypeName: item.typeName,
        fitName: `${item.typeName} Fit`,
      });
      if (current && isReusableEmptyTab(current)) {
        return { ...prev, openFits: prev.openFits.map((tab) => (tab.tabId === current.tabId ? updateTabFit(tab, nextFit, { savedFitId: null, resetBaseline: true }) : tab)) };
      }
      const tab = makeWorkspaceTab(nextFit);
      return { openFits: [...prev.openFits, tab], activeTabId: tab.tabId };
    });
    setView("fit");
  }

  function pushMobileToast(message: string, tone: "success" | "error" = "success") {
    setMobileToast({ id: Date.now(), message, tone });
  }

  function moduleHardpointKind(module: FittingModule | SearchResult): HardpointKind {
    const own = hardpointKindFromType(module);
    if (own !== "none" || module.hardpoint === "none") return own;
    return hardpointKindFromType(typeDetails[module.typeId]);
  }

  function blockSubsystemAdd(
    item: { typeName?: string; typeId: number; fitsToShipTypeId?: number | null; groupName?: string | null; marketGroupName?: string | null },
    exceptIndexes: Set<number> = new Set()
  ) {
    const requiredShipTypeId = Number(item.fitsToShipTypeId);
    if (Number.isFinite(requiredShipTypeId) && requiredShipTypeId > 0 && fit.shipTypeId && requiredShipTypeId !== fit.shipTypeId) {
      setErrors([{
        code: "invalid_subsystem",
        message: `${itemName(item)} does not fit ${fit.shipTypeName || "this strategic cruiser"}.`,
      }]);
      pushMobileToast("Subsystem does not fit this hull.", "error");
      return true;
    }

    const kind = subsystemKindFromItem(item);
    if (!kind) return false;
    const existing = fit.modules.subsystem.find((module, index) => {
      if (exceptIndexes.has(index)) return false;
      return subsystemKindFromItem(typeDetails[module.typeId] || module) === kind;
    });
    if (!existing) return false;
    setErrors([{
      code: "duplicate_subsystem",
      message: `A ${subsystemKindLabel(kind)} subsystem is already fitted: ${itemName(existing)}.`,
    }]);
    pushMobileToast(`${subsystemKindLabel(kind)} subsystem already fitted.`, "error");
    return true;
  }

  function blockHardpointReplacement(slot: SlotKey, index: number, replacement: SearchResult) {
    const kind = hardpointKindFromType(replacement);
    if (kind === "none") return false;
    const free = hardpointFree(stats, kind);
    if (free == null) {
      setWarnings((prev) => [
        { code: "hardpoint_data_pending", message: `Waiting for hull ${hardpointLabel(kind)} hardpoint data before replacing modules.` },
        ...prev.filter((warning) => warning.code !== "hardpoint_data_pending"),
      ]);
      pushMobileToast(`Waiting for ${hardpointLabel(kind)} hardpoint data.`, "error");
      return true;
    }
    const current = fit.modules[slot]?.[index];
    const preserved = current && moduleHardpointKind(current) === kind ? 1 : 0;
    if (free < 1 - preserved) {
      setErrors([{ code: "hardpoint_full", message: `No ${hardpointLabel(kind)} hardpoints available for that replacement.` }]);
      pushMobileToast(`No ${hardpointLabel(kind)} hardpoints available.`, "error");
      return true;
    }
    return false;
  }

  function pyfaCandidateBlocker(result: CalculationResponse, slot: SlotKey, module: FittingModule) {
    const messages = [...(result.errors || []), ...(result.warnings || [])];
    const name = itemName(module).toLowerCase();
    const typeId = Number(module.typeId);
    const hardpointKind = moduleHardpointKind(module);

    return messages.find((message) => {
      const code = String(message.code || "");
      const text = String(message.message || "").toLowerCase();
      const detailsTypeId = Number((message as FitMessage & { details?: { typeId?: number } }).details?.typeId);

      if (code === "slot_over") {
        return text.includes(slot) || text.includes(SLOT_LABELS[slot].toLowerCase().split(" ")[0]);
      }
      if (code === "HARDPOINT_LIMIT_EXCEEDED") {
        return hardpointKind !== "none";
      }
      if (code === "INVALID_SUBSYSTEM") {
        return slot === "subsystem" && (detailsTypeId === typeId || text.includes(name));
      }
      if (code === "module_invalid" || code === "module_validation_failed") {
        return detailsTypeId === typeId || text.includes(name);
      }
      return false;
    });
  }

  async function blockPyfaInvalidCandidate(slot: SlotKey, module: FittingModule) {
    const candidate = ensureFitPayload({
      ...fit,
      modules: {
        ...fit.modules,
        [slot]: [...fit.modules[slot], module],
      },
    });
    const candidateCalculationFit = fitWithSkillOverrides(candidate, activeSkillOverrides);
    try {
      const response = await triffApiFetch("/api/fitting/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...calculationRequest,
          ...candidateCalculationFit,
          targetFit: candidateCalculationFit,
        }),
      });
      const data = await readJson<CalculationResponse>(response);
      const blocker = pyfaCandidateBlocker(data, slot, module);
      if (!blocker) return false;
      const reason = blocker.message || "This item does not fit this hull or fit state.";
      setErrors([{ code: blocker.code || "module_invalid", message: `Could not fit ${itemName(module)}: ${reason}` }]);
      pushMobileToast(`Could not fit: ${reason}`, "error");
      return true;
    } catch {
      return false;
    }
  }

  async function addModule(slot: SlotKey, module: FittingModule) {
    const limit = slotTotal(stats, slot);
    if (!fit.shipTypeId) {
      setErrors([{ code: "missing_ship", message: "Select a ship hull before fitting modules." }]);
      pushMobileToast("Select a ship hull first.", "error");
      return false;
    }
    if (limit == null) {
      setWarnings((prev) => [
        { code: "slot_data_pending", message: "Waiting for hull slot data before fitting modules." },
        ...prev.filter((warning) => warning.code !== "slot_data_pending"),
      ]);
      pushMobileToast("Waiting for hull slot data.", "error");
      return false;
    }
    if (slot === "subsystem" && blockSubsystemAdd(module)) {
      return false;
    }
    if (limit != null && fit.modules[slot].length >= limit) {
      setErrors([{ code: "slot_full", message: `${SLOT_LABELS[slot]} is full: ${fit.modules[slot].length} / ${limit}.` }]);
      pushMobileToast(`Not enough ${slotDestination(slot)}.`, "error");
      return false;
    }
    const kind = slot === "high" ? moduleHardpointKind(module) : "none";
    const free = hardpointFree(stats, kind);
    if (kind !== "none" && free == null) {
      setWarnings((prev) => [
        { code: "hardpoint_data_pending", message: `Waiting for hull ${hardpointLabel(kind)} hardpoint data before fitting this module.` },
        ...prev.filter((warning) => warning.code !== "hardpoint_data_pending"),
      ]);
      pushMobileToast(`Waiting for ${hardpointLabel(kind)} hardpoint data.`, "error");
      return false;
    }
    if (kind !== "none" && free != null && free < 1) {
      setErrors([{ code: "hardpoint_full", message: `No ${hardpointLabel(kind)} hardpoints available.` }]);
      pushMobileToast(`No ${hardpointLabel(kind)} hardpoints available.`, "error");
      return false;
    }
    if (await blockPyfaInvalidCandidate(slot, module)) {
      return false;
    }
    setFit((prev) => ({ ...prev, modules: { ...prev.modules, [slot]: [...prev.modules[slot], module] } }));
    pushMobileToast(`Added ${module.typeName || `Type ${module.typeId}`} to ${slotDestination(slot)}.`);
    return true;
  }

  function addQuantity(key: "drones" | "fighters" | "cargo" | "implants" | "boosters", item: QuantityItem) {
    setFit((prev) => ({ ...prev, [key]: [...prev[key], item] }));
  }

  function addCargoItem(item: Pick<QuantityItem, "typeId" | "typeName">) {
    setFit((prev) => ({ ...prev, cargo: addCargoStack(prev.cargo, item) }));
    pushMobileToast(`Added ${item.typeName || `Type ${item.typeId}`} to cargo.`);
  }

  function slotConflict(key: "implants" | "boosters", item: QuantityItem, items: QuantityItem[], exceptIndex: number | null = null) {
    const slot = additionSlot(key, item);
    if (slot == null) return null;
    const existing = items.find((entry, index) => index !== exceptIndex && entry.enabled !== false && additionSlot(key, entry) === slot);
    return existing ? { slot, existing } : null;
  }

  function addCharacterItem(key: "implants" | "boosters", detail: SearchResult) {
    const item = additionWithSlot(key, detail);
    const conflict = slotConflict(key, item, fit[key]);
    if (conflict) {
      setErrors([{ code: `${key}_slot_occupied`, message: `${key === "implants" ? "Implant" : "Booster"} slot ${conflict.slot} is already occupied by ${conflict.existing.typeName}.` }]);
      pushMobileToast(`${key === "implants" ? "Implant" : "Booster"} slot ${conflict.slot} is occupied.`, "error");
      return false;
    }
    addQuantity(key, item);
    pushMobileToast(`Added ${detail.typeName} to ${key === "implants" ? "implants" : "boosters"}.`);
    return true;
  }

  async function handleSelect(item: SearchResult) {
    const base = normalizeType(item);
    setBusyAction(`type-${base.typeId}`);
    try {
      const detail = await fetchType(base.typeId);
      setTypeDetails((prev) => ({ ...prev, [detail.typeId]: detail }));
      if (detail.pyfaKind === "ship" || detail.categoryName === "Ship") {
        setShip(detail);
      } else if (detail.pyfaKind === "module" && detail.slot && SLOT_ORDER.includes(detail.slot as SlotKey)) {
        await addModule(detail.slot as SlotKey, {
          typeId: detail.typeId,
          typeName: detail.typeName,
          state: "active",
          fitting: detail.fitting || null,
          hardpoint: detail.hardpoint || null,
          hardpointName: detail.hardpointName || null,
          fitsToShipTypeId: detail.fitsToShipTypeId || null,
        });
      } else if (detail.pyfaKind === "fighter" || detail.categoryName === "Fighter") {
        addQuantity("fighters", { typeId: detail.typeId, typeName: detail.typeName, quantity: 1, active: 1 });
        pushMobileToast(`Added ${detail.typeName} to fighters.`);
      } else if (detail.pyfaKind === "drone" || detail.categoryName === "Drone") {
        addQuantity("drones", { typeId: detail.typeId, typeName: detail.typeName, quantity: 1, active: 1 });
        pushMobileToast(`Added ${detail.typeName} to drone bay.`);
      } else if (detail.pyfaKind === "implant") {
        addCharacterItem("implants", detail);
      } else if (detail.pyfaKind === "booster" || /booster/i.test(detail.groupName || "")) {
        addCharacterItem("boosters", detail);
      } else {
        addCargoItem(detail);
      }
    } catch (err) {
      setErrors([{ code: "type_lookup_failed", message: (err as Error).message }]);
      pushMobileToast("Could not add item.", "error");
    } finally {
      setBusyAction(null);
    }
  }

  function updateModule(slot: SlotKey, index: number, updater: (module: FittingModule) => FittingModule) {
    setFit((prev) => ({ ...prev, modules: { ...prev.modules, [slot]: prev.modules[slot].map((module, i) => (i === index ? updater(module) : module)) } }));
  }

  function removeModule(slot: SlotKey, index: number) {
    setFit((prev) => ({ ...prev, modules: { ...prev.modules, [slot]: prev.modules[slot].filter((_, i) => i !== index) } }));
    setModuleSheet(null);
  }

  function moduleCanOverheat(slot: SlotKey, index: number) {
    return stats?.moduleRows?.[slot]?.[index]?.canOverheat === true;
  }

  function nextModuleState(slot: SlotKey, index: number, module: FittingModule) {
    const row = stats?.moduleRows?.[slot]?.[index];
    const validStates = new Set((row?.validStates || []).map(normalizedModuleState));
    if (!validStates.size) {
      validStates.add("offline");
      validStates.add("online");
      validStates.add("active");
    }
    if (row?.canOverheat) validStates.add("overheated");
    const current = normalizedModuleState(row?.state || module.state);
    const rawIndex = MODULE_STATE_ORDER.indexOf(current as (typeof MODULE_STATE_ORDER)[number]);
    const currentIndex = rawIndex < 0 ? -1 : rawIndex;
    for (let offset = 1; offset <= MODULE_STATE_ORDER.length; offset += 1) {
      const candidate = MODULE_STATE_ORDER[(currentIndex + offset) % MODULE_STATE_ORDER.length];
      if (validStates.has(candidate)) return candidate;
    }
    return current;
  }

  function setTemporarySkillOverride(skillTypeId: number, level: number | null) {
    const tabId = activeTab?.tabId;
    if (!tabId) return;
    setSkillOverridesByTab((prev) => {
      const current = { ...(prev[tabId] || {}) };
      if (level == null) {
        delete current[String(skillTypeId)];
      } else {
        current[String(skillTypeId)] = Math.max(-1, Math.min(5, Math.trunc(level)));
      }
      const next = { ...prev };
      if (Object.keys(current).length === 0) {
        delete next[tabId];
      } else {
        next[tabId] = current;
      }
      return next;
    });
  }

  function clearTemporarySkillOverrides() {
    const tabId = activeTab?.tabId;
    if (!tabId) return;
    setSkillOverridesByTab((prev) => {
      if (!prev[tabId]) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }

  function setModuleState(slot: SlotKey, index: number, state: string) {
    if (normalizedModuleState(state) === "overheated" && !moduleCanOverheat(slot, index)) {
      setModuleSheet(null);
      return;
    }
    updateModule(slot, index, (module) => withModuleState(module, state));
    setModuleSheet(null);
  }

  function setModuleSpool(slot: SlotKey, index: number, cycles: number) {
    const spool = stats?.moduleRows?.[slot]?.[index]?.spool;
    if (!spool?.eligible) {
      setModuleSheet(null);
      return;
    }
    const min = Number(spool.minCycles ?? 0);
    const max = Number(spool.maxCycles ?? cycles);
    const clamped = Math.max(min, Math.min(max, cycles));
    updateModule(slot, index, (module) => ({ ...module, spoolType: "cycles", spoolAmount: clamped }));
    setModuleSheet(null);
  }

  function cycleModuleState(slot: SlotKey, index: number) {
    updateModule(slot, index, (module) => withModuleState(module, nextModuleState(slot, index, module)));
  }

  function setRackState(slot: SlotKey, state: "offline" | "online" | "active" | "overheated") {
    setFit((prev) => ({
      ...prev,
      modules: {
        ...prev.modules,
        [slot]: prev.modules[slot].map((module, index) => {
          if (state === "overheated" && !moduleCanOverheat(slot, index)) return module;
          return withModuleState(module, state);
        }),
      },
    }));
  }

  function loadCharge(slot: SlotKey, index: number, charge: ChargeResult | null) {
    updateModule(slot, index, (module) => {
      if (!charge) {
        const { chargeTypeId, chargeTypeName, ...rest } = module;
        return rest;
      }
      return { ...module, chargeTypeId: charge.typeId, chargeTypeName: charge.typeName };
    });
    setModuleSheet(null);
  }

  async function replaceVariant(slot: SlotKey, index: number, variant: SearchResult) {
    const variantDetail = await fetchType(variant.typeId).catch(() => normalizeType(variant));
    if (slot === "subsystem" && blockSubsystemAdd(variantDetail, new Set([index]))) return;
    if (blockHardpointReplacement(slot, index, variantDetail)) return;
    setTypeDetails((prev) => ({ ...prev, [variantDetail.typeId]: variantDetail }));
    updateModule(slot, index, (module) => {
      const baseModule = { ...module };
      delete baseModule.abyssalPlaceholder;
      delete baseModule.placeholderReason;
      delete baseModule.groupName;
      return {
        ...baseModule,
        typeId: variantDetail.typeId,
        typeName: variantDetail.typeName,
        fitting: variantDetail.fitting || null,
        hardpoint: variantDetail.hardpoint || null,
        hardpointName: variantDetail.hardpointName || null,
        fitsToShipTypeId: variantDetail.fitsToShipTypeId || null,
        mutation: null,
        spoolType: undefined,
        spoolAmount: undefined,
      };
    });
    setModuleSheet(null);
  }

  function nextMutationReference() {
    let max = 0;
    for (const slot of SLOT_ORDER) {
      for (const module of fit.modules[slot]) {
        const ref = Number(module.mutation?.reference);
        if (Number.isFinite(ref)) max = Math.max(max, ref);
      }
    }
    return max + 1;
  }

  function mutationFromMutaplasmid(module: FittingModule, mutaplasmid: MutaplasmidResult): ModuleMutation {
    const attributes: Record<string, number> = {};
    const attributeIds: Record<string, number> = {};
    const details = (mutaplasmid.attributes || []).map((attribute) => {
      const value = Number(attribute.baseValue ?? attribute.value ?? 0);
      attributes[attribute.attributeName] = Number.isFinite(value) ? value : 0;
      attributeIds[String(attribute.attributeId)] = attributes[attribute.attributeName];
      return { ...attribute, value: attributes[attribute.attributeName] };
    });
    return {
      reference: nextMutationReference(),
      baseTypeId: module.typeId,
      baseTypeName: module.typeName || `Type ${module.typeId}`,
      mutaplasmidTypeId: mutaplasmid.typeId,
      mutaplasmidName: mutaplasmid.typeName,
      prefix: mutaplasmid.shortName || null,
      resultingTypeId: mutaplasmid.resultingTypeId || null,
      resultingTypeName: mutaplasmid.resultingTypeName || null,
      displayName: `Abyssal ${module.typeName || `Type ${module.typeId}`}`,
      attributes,
      attributeIds,
      attributeDetails: details,
    };
  }

  function applyMutaplasmid(slot: SlotKey, index: number, mutaplasmid: MutaplasmidResult) {
    const current = fit.modules[slot]?.[index];
    if (!current) return;
    const mutation = mutationFromMutaplasmid(current, mutaplasmid);
    const nextModule = { ...current, mutation };
    updateModule(slot, index, () => nextModule);
    setMutationEditor({ slot, index, module: nextModule, mutation });
    setModuleSheet(null);
  }

  function editMutation(slot: SlotKey, index: number) {
    const current = fit.modules[slot]?.[index];
    if (!current?.mutation) return;
    setMutationEditor({ slot, index, module: current, mutation: current.mutation });
    setModuleSheet(null);
  }

  function clearMutation(slot: SlotKey, index: number) {
    updateModule(slot, index, (module) => {
      const next = { ...module };
      delete next.mutation;
      return next;
    });
    setMutationEditor(null);
    setModuleSheet(null);
  }

  function applyMutationEditor(mutation: ModuleMutation) {
    if (!mutationEditor) return;
    updateModule(mutationEditor.slot, mutationEditor.index, (module) => ({ ...module, mutation }));
  }

  function removeQuantity(key: "drones" | "fighters" | "cargo" | "implants" | "boosters", index: number) {
    setFit((prev) => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }));
  }

  function toggleCharacterItem(key: "implants" | "boosters", index: number, enabled: boolean) {
    const item = fit[key][index];
    if (!item) return;
    if (enabled) {
      const conflict = slotConflict(key, item, fit[key], index);
      if (conflict) {
        setErrors([{ code: `${key}_slot_occupied`, message: `${key === "implants" ? "Implant" : "Booster"} slot ${conflict.slot} is already occupied by ${conflict.existing.typeName}.` }]);
        return;
      }
    }
    setFit((prev) => ({ ...prev, [key]: prev[key].map((entry, i) => (i === index ? { ...entry, enabled } : entry)) }));
  }

  function replaceCharacterItem(key: "implants" | "boosters", index: number, variant: SearchResult) {
    const replacement = additionWithSlot(key, variant);
    const current = fit[key][index];
    const conflict = slotConflict(key, replacement, fit[key], index);
    if (conflict) {
      setErrors([{ code: `${key}_slot_occupied`, message: `${key === "implants" ? "Implant" : "Booster"} slot ${conflict.slot} is already occupied by ${conflict.existing.typeName}.` }]);
      return;
    }
    setFit((prev) => ({ ...prev, [key]: prev[key].map((item, itemIndex) => (itemIndex === index ? { ...replacement, enabled: current?.enabled !== false } : item)) }));
    setCharacterSheet(null);
  }

  function applyImplantSet(grade: ImplantSetGrade) {
    const replacementSlots = new Set(grade.items.map((item) => Number(item.slot)).filter(Boolean));
    const replacements = grade.items
      .slice()
      .sort((a, b) => Number(a.slot) - Number(b.slot))
      .map((item) => ({ typeId: item.typeId, typeName: item.typeName, quantity: 1, slot: item.slot, implantSlot: item.slot }));
    setFit((prev) => ({
      ...prev,
      implants: [
        ...prev.implants.filter((item) => {
          const slot = additionSlot("implants", item);
          return slot == null || !replacementSlots.has(slot);
        }),
        ...replacements,
      ].sort((a, b) => Number(additionSlot("implants", a) || 999) - Number(additionSlot("implants", b) || 999)),
    }));
    setNotice(`Applied ${grade.label}${grade.familyLabel ? ` ${grade.familyLabel}` : ""} implant set.`);
    setCharacterSheet(null);
  }

  function setDroneActive(index: number, active: number) {
    const owned = quantity(fit.drones[index]?.quantity);
    const next = Math.max(0, Math.min(owned, Math.floor(active)));
    setFit((prev) => ({ ...prev, drones: prev.drones.map((drone, i) => (i === index ? { ...drone, active: next } : drone)) }));
  }

  function setDroneQuantity(index: number, nextQuantity: number) {
    const next = Math.max(1, Math.floor(nextQuantity));
    const target = fit.drones[index];
    if (!target || !Number.isFinite(next)) return;
    const nextActive = Math.min(Math.max(0, Math.floor(Number(target.active ?? target.quantity ?? 0))), next);
    setFit((prev) => ({
      ...prev,
      drones: prev.drones.map((drone, i) => (i === index ? { ...drone, quantity: next, active: nextActive } : drone)),
    }));
  }

  function setFighterActive(index: number, active: number) {
    const owned = quantity(fit.fighters[index]?.quantity);
    const next = Math.max(0, Math.min(owned, Math.floor(active)));
    setFit((prev) => ({ ...prev, fighters: prev.fighters.map((fighter, i) => (i === index ? { ...fighter, active: next } : fighter)) }));
  }

  function addProjectedEffect(effect: EnvironmentEffect) {
    setFit((prev) => ({ ...prev, projectedEffects: [...prev.projectedEffects.filter((current) => current.kind !== "environment" || current.category !== effect.category), effect] }));
  }

  function removeProjectedEffect(index: number) {
    setFit((prev) => ({ ...prev, projectedEffects: prev.projectedEffects.filter((_, i) => i !== index) }));
  }

  function addProjectedSource(sourceTabId: string) {
    if (!sourceTabId || sourceTabId === workspace.activeTabId) return;
    updateActiveTab((tab) => (tab.projectedLinks.some((link) => link.sourceTabId === sourceTabId) ? tab : { ...tab, projectedLinks: [...tab.projectedLinks, { id: makeTabId(), sourceTabId, enabled: true, type: "projected_fit" }] }));
  }

  function toggleProjectedSource(linkId: string, enabled: boolean) {
    updateActiveTab((tab) => ({ ...tab, projectedLinks: tab.projectedLinks.map((link) => (link.id === linkId ? { ...link, enabled } : link)) }));
  }

  function removeProjectedSource(linkId: string) {
    updateActiveTab((tab) => ({ ...tab, projectedLinks: tab.projectedLinks.filter((link) => link.id !== linkId) }));
  }

  function addCommandSource(sourceTabId: string) {
    if (!sourceTabId || sourceTabId === workspace.activeTabId) return;
    updateActiveTab((tab) =>
      tab.commandLinks.some((link) => link.sourceTabId === sourceTabId)
        ? tab
        : { ...tab, commandLinks: [...tab.commandLinks, { id: makeTabId(), sourceTabId, enabled: true, selectedBursts: commandBurstsBySource[sourceTabId] || [] }] }
    );
  }

  function toggleCommandSource(linkId: string, enabled: boolean) {
    updateActiveTab((tab) => ({ ...tab, commandLinks: tab.commandLinks.map((link) => (link.id === linkId ? { ...link, enabled } : link)) }));
  }

  function toggleCommandBurst(linkId: string, sourceModuleInstanceId: string, enabled: boolean) {
    updateActiveTab((tab) => ({
      ...tab,
      commandLinks: tab.commandLinks.map((link) => {
        if (link.id !== linkId) return link;
        const sourceBursts = commandBurstsBySource[link.sourceTabId] || [];
        const byId = new Map(link.selectedBursts.map((burst) => [burst.sourceModuleInstanceId, burst]));
        const fallback = sourceBursts.find((burst) => burst.sourceModuleInstanceId === sourceModuleInstanceId);
        byId.set(sourceModuleInstanceId, { ...(fallback || byId.get(sourceModuleInstanceId) || { sourceModuleInstanceId }), enabled });
        return { ...link, selectedBursts: Array.from(byId.values()) };
      }),
    }));
  }

  function removeCommandSource(linkId: string) {
    updateActiveTab((tab) => ({ ...tab, commandLinks: tab.commandLinks.filter((link) => link.id !== linkId) }));
  }

  function applyImportedFit(data: ImportedFitResponse, options: ImportApplyOptions = {}) {
    const importedFit = ensureFitPayload({ ...data.payload, skillProfile: fit.skillProfile || { mode: "all_v" } });
    const importedTab = makeWorkspaceTab(importedFit, {
      calculationResult: data.calculation || null,
      warnings: data.warnings || data.calculation?.warnings || [],
      errors: data.errors || data.calculation?.errors || [],
    });
    setWorkspace((prev) => {
      const current = prev.openFits.find((tab) => tab.tabId === prev.activeTabId);
      if (current && isReusableEmptyTab(current)) return { ...prev, openFits: prev.openFits.map((tab) => (tab.tabId === current.tabId ? { ...importedTab, tabId: current.tabId } : tab)) };
      return { openFits: [...prev.openFits, importedTab], activeTabId: importedTab.tabId };
    });
    setModuleSheet(null);
    setCharacterSheet(null);
    setFitsSheetOpen(false);
    if (!options.stayInCurrentView) setView("fit");
  }

  async function fillWithModule(slot: SlotKey, index: number) {
    if (!FILLABLE_RACKS.includes(slot)) return;
    const source = fit.modules[slot]?.[index];
    const limit = slotTotal(stats, slot);
    if (!source || limit == null) {
      pushMobileToast("Waiting for current rack data.", "error");
      return;
    }

    let fillModule = moduleForRackFill(source);
    if (fillModule.typeId !== source.typeId || !typeDetails[fillModule.typeId]) {
      try {
        const detail = await fetchType(fillModule.typeId);
        setTypeDetails((prev) => ({ ...prev, [detail.typeId]: detail }));
        fillModule = {
          ...fillModule,
          typeName: detail.typeName || fillModule.typeName,
          fitting: detail.fitting || fillModule.fitting || null,
          hardpoint: detail.hardpoint ?? fillModule.hardpoint ?? null,
          hardpointName: detail.hardpointName ?? fillModule.hardpointName ?? null,
          fitsToShipTypeId: detail.fitsToShipTypeId ?? fillModule.fitsToShipTypeId ?? null,
        };
      } catch {
        // The fitted source still supplies conservative metadata for validation.
      }
    }

    let available = Math.max(0, Math.floor(limit) - fit.modules[slot].length);
    if (slot === "high") {
      const kind = moduleHardpointKind(fillModule);
      if (kind !== "none") {
        const free = hardpointFree(stats, kind);
        if (free == null) {
          pushMobileToast(`Waiting for ${hardpointLabel(kind)} hardpoint data.`, "error");
          return;
        }
        available = Math.min(available, Math.max(0, Math.floor(free)));
      }
    }
    if (available < 1) {
      pushMobileToast(`No available ${slotDestination(slot)}.`, "error");
      return;
    }

    setBusyAction(`fill-${slot}-${index}`);
    let lastBlocker: FitMessage | null = null;
    try {
      for (let count = available; count >= 1; count -= 1) {
        const additions = Array.from({ length: count }, () => ({ ...fillModule }));
        const candidate = ensureFitPayload({
          ...fit,
          modules: { ...fit.modules, [slot]: [...fit.modules[slot], ...additions] },
        });
        const candidateCalculationFit = fitWithSkillOverrides(candidate, activeSkillOverrides);
        const response = await triffApiFetch("/api/fitting/calculate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...calculationRequest,
            ...candidateCalculationFit,
            targetFit: candidateCalculationFit,
          }),
        });
        const result = await readJson<CalculationResponse>(response);
        lastBlocker = rackFillBlocker(result, slot, fillModule);
        if (lastBlocker) continue;
        setFit(candidate);
        pushMobileToast(`Filled ${count} ${slotDestination(slot)} with ${fillModule.typeName || `Type ${fillModule.typeId}`}.`);
        return;
      }
      const message = lastBlocker?.message || `No legal ${slotDestination(slot)} can be filled.`;
      setErrors([{ code: lastBlocker?.code || "fill_module_blocked", message }]);
      pushMobileToast(message, "error");
    } catch (err) {
      const message = (err as Error).message || "Unable to fill the rack.";
      setErrors([{ code: "fill_module_failed", message }]);
      pushMobileToast(message, "error");
    } finally {
      setBusyAction(null);
    }
  }

  function setCargoQuantity(index: number, nextQuantity: number) {
    const target = fit.cargo[index];
    if (!target || !Number.isFinite(nextQuantity)) return;
    setFit((prev) => ({ ...prev, cargo: setCargoStackQuantity(prev.cargo, index, nextQuantity) }));
    pushMobileToast(nextQuantity <= 0 ? "Removed from cargo." : "Updated cargo quantity.");
  }

  async function importFit() {
    setBusyAction("import");
    try {
      const response = await triffApiFetch("/api/fitting/import/eft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: eftText }) });
      const data = await readJson<ImportedFitResponse>(response);
      applyImportedFit(data);
      setModal(null);
    } catch (err) {
      setErrors([{ code: "import_failed", message: (err as Error).message }]);
    } finally {
      setBusyAction(null);
    }
  }

  async function importSharedFit(id: string) {
    setBusyAction("shared-fit");
    try {
      const response = await triffApiFetch(`/api/fitting/shared-fits/${encodeURIComponent(id)}/import`);
      const data = await readJson<ImportedFitResponse>(response);
      applyImportedFit(data);
      pushMobileToast(`Imported ${data.sharedFit?.fitName || data.payload.fitName || "shared fit"}.`);
    } catch (err) {
      setErrors([{ code: "shared_fit_import_failed", message: (err as Error).message || "Could not import shared fit." }]);
    } finally {
      setBusyAction(null);
    }
  }

  useEffect(() => {
    if (!sharedFitId || handledSharedFitId.current === sharedFitId) return;
    handledSharedFitId.current = sharedFitId;
    void importSharedFit(sharedFitId);
  }, [sharedFitId]);

  async function exportFit() {
    setBusyAction("export");
    try {
      const response = await triffApiFetch("/api/fitting/export/eft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: fit }) });
      const data = await readJson<{ ok: boolean; text: string }>(response);
      setExportText(data.text);
      setShareLink(null);
      setShareError(null);
      clearErrorCode("export_failed");
      setModal("export");
      copyToClipboard(data.text);
    } catch (err) {
      setErrors([{ code: "export_failed", message: (err as Error).message }]);
    } finally {
      setBusyAction(null);
    }
  }

  function copyToClipboard(text: string) {
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(text).catch(() => undefined);
  }

  async function createShareLink() {
    if (!exportText.trim()) return;
    setBusyAction("share");
    setShareError(null);
    try {
      const response = await triffApiFetch("/api/fitting/shared-fits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eftText: exportText, source: "triff.tools" }),
      });
      const data = await readJson<SharedFitLinkResponse>(response);
      setShareLink(data.url);
      pushMobileToast("Share link created.");
    } catch (err) {
      setShareError((err as Error).message || "Could not create share link.");
    } finally {
      setBusyAction(null);
    }
  }

  function copyShareLink() {
    if (!shareLink) return;
    if (!navigator.clipboard?.writeText) {
      pushMobileToast("Copy unavailable here.", "error");
      return;
    }
    navigator.clipboard
      .writeText(shareLink)
      .then(() => pushMobileToast("Share link copied to clipboard."))
      .catch(() => pushMobileToast("Copy unavailable here.", "error"));
  }

  function openInGameImportSheet() {
    setImportChoiceOpen(false);
    if (!authUser) {
      setPendingInGameImportAfterAuth(true);
      requestSiteAuthModal("login");
      return;
    }
    setInGameFitsOpen(true);
  }

  async function exportFitTextForSave(payload: FitPayload = fit) {
    try {
      const response = await triffApiFetch("/api/fitting/export/eft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload }) });
      const data = await readJson<{ ok: boolean; text: string }>(response);
      return data.text || "";
    } catch {
      return "";
    }
  }

  async function saveCurrentFit(forceAuthenticated = false) {
    if (!authUser && !forceAuthenticated) {
      setPendingSaveAfterAuth(true);
      requestSiteAuthModal("login");
      return;
    }
    if (!fit.shipTypeId) {
      setErrors([{ code: "save_missing_ship", message: "Select a ship hull before saving this fit." }]);
      return;
    }
    const shipName = fit.shipTypeName || shipSummary?.typeName || `Type ${fit.shipTypeId}`;
    const fitName = (fit.fitName || "").trim() || `${shipName} Fit`;
    const fitJson = fit.fitName === fitName ? fit : { ...fit, fitName };
    setBusyAction("save");
    try {
      const eftText = await exportFitTextForSave(fitJson);
      const response = await triffApiFetch(activeSavedFitId ? `/api/fitting/saved-fits/${activeSavedFitId}` : "/api/fitting/saved-fits", {
        method: activeSavedFitId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fitName, shipTypeId: fit.shipTypeId, shipName, fitJson, eftText }),
      });
      const data = await readJson<{ ok: boolean; fit: SavedFitRecord }>(response);
      setWorkspace((prev) => ({
        ...prev,
        openFits: prev.openFits.map((tab) =>
          tab.tabId === prev.activeTabId
            ? { ...updateTabFit(tab, data.fit.fitJson ? ensureFitPayload(data.fit.fitJson) : fitJson, { savedFitId: data.fit.id, resetBaseline: true }), openedFromSavedAt: data.fit.updatedAt || new Date().toISOString() }
            : tab
        ),
      }));
      await refreshSavedFitTree(true);
      setSavedFitFocus({ savedFitId: data.fit.id, shipTypeId: data.fit.shipTypeId, token: Date.now() });
      setNotice("Fit saved.");
    } catch (err) {
      if ((err as Error).message === "unauthorized") {
        setPendingSaveAfterAuth(true);
        requestSiteAuthModal("login");
      } else {
        setErrors([{ code: "save_failed", message: (err as Error).message || "Save failed." }]);
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function openSavedFit(id: string) {
    const existing = workspace.openFits.find((tab) => tab.savedFitId === id);
    if (existing) {
      setWorkspace((prev) => ({ ...prev, activeTabId: existing.tabId }));
      setSavedFitFocus({ savedFitId: id, shipTypeId: existing.shipTypeId || 0, token: Date.now() });
      setView("fit");
      if (existing.dirty) setNotice("Saved fit is already open with unsaved changes.");
      return;
    }
    setBusyAction(`open-${id}`);
    try {
      const response = await triffApiFetch(`/api/fitting/saved-fits/${id}`);
      const data = await readJson<{ ok: boolean; fit: SavedFitRecord }>(response);
      if (!data.fit.fitJson) throw new Error("saved_fit_missing_payload");
      const tab = makeWorkspaceTab(ensureFitPayload(data.fit.fitJson), { savedFitId: data.fit.id, openedFromSavedAt: data.fit.lastOpenedAt || data.fit.updatedAt || new Date().toISOString() });
      setWorkspace((prev) => ({ openFits: [...prev.openFits, tab], activeTabId: tab.tabId }));
      setSavedFitFocus({ savedFitId: data.fit.id, shipTypeId: data.fit.shipTypeId, token: Date.now() });
      setView("fit");
      void refreshSavedFitTree(true);
    } catch (err) {
      setErrors([{ code: "open_saved_fit_failed", message: (err as Error).message || "Unable to open saved fit." }]);
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteSavedFit(id: string) {
    try {
      const response = await triffApiFetch(`/api/fitting/saved-fits/${id}`, { method: "DELETE" });
      await readJson<{ ok: boolean }>(response);
      setWorkspace((prev) => ({ ...prev, openFits: prev.openFits.map((tab) => (tab.savedFitId === id ? updateTabFit(tab, tab.fitState, { savedFitId: null, resetBaseline: true }) : tab)) }));
      await refreshSavedFitTree(true);
      setNotice("Saved fit deleted.");
    } catch (err) {
      setErrors([{ code: "delete_saved_fit_failed", message: (err as Error).message || "Unable to delete saved fit." }]);
    }
  }

  function selectLinkedCharacter(character: LinkedEsiCharacter) {
    setSkillProfile({ mode: "esi_character", characterId: character.characterId, characterName: character.characterName, skillsSyncedAt: character.skillsSyncedAt, tokenStatus: character.tokenStatus });
  }

  function setSkillProfile(profile: SkillProfile) {
    setFit((prev) => ({ ...prev, skillProfile: profile }));
  }

  function setShipMode(mode: ShipModeOption) {
    setFit((prev) => {
      if (String(prev.shipMode?.modeId || "") === String(mode.modeId)) return prev;
      return {
        ...prev,
        shipMode: {
          modeId: mode.modeId,
          typeId: mode.typeId,
          modeName: mode.fullName,
          label: mode.label,
          fullName: mode.fullName,
        },
      };
    });
  }

  function setDamageProfile(profile: DamageProfileSelection) {
    setFit((prev) => {
      if (String(prev.damageProfile?.profileId || "") === String(profile.profileId)) return prev;
      return { ...prev, damageProfile: profile };
    });
  }

  function handleSkillProfileChange(value: string) {
    if (value === "all_v") {
      setSkillProfile({ mode: "all_v" });
      return;
    }
    if (value === "alpha_clone") {
      setSkillProfile({ mode: "alpha_clone" });
      return;
    }
    if (value === "link") {
      linkEveCharacter();
      return;
    }
    if (value === "manage") {
      setManageCharactersOpen(true);
      return;
    }
    if (value === "refresh" && selectedLinkedCharacter) {
      void refreshEsiCharacter(selectedLinkedCharacter.characterId);
      return;
    }
    if (value.startsWith("esi:")) {
      const characterId = Number(value.slice(4));
      const character = linkedCharacters.find((entry) => entry.characterId === characterId);
      if (character) selectLinkedCharacter(character);
    }
  }

  function linkEveCharacter() {
    if (!authUser) {
      setPendingEsiLinkAfterAuth(true);
      requestSiteAuthModal("login");
      return;
    }
    if (!esiConfigured) {
      setErrors([{ code: "esi_not_configured", message: `EVE SSO is not configured${esiConfigMissing.length ? `: ${esiConfigMissing.join(", ")}` : "."}` }]);
      return;
    }
    setManageCharactersOpen(false);
    setEsiLinkSheetOpen(true);
  }

  function beginEsiLink() {
    esiPendingKnownIds.current = new Set(linkedCharacters.map((character) => Number(character.characterId)));
    setEsiPending(true);
    setEsiLinkSheetOpen(false);
  }

  async function beginNativeEsiLink() {
    beginEsiLink();
    try {
      const response = await triffApiFetch("/api/fitting/esi/login-url");
      const data = await readJson<{ ok: boolean; url: string }>(response);
      const opened = await openTriffExternalUrl(data.url, "triff-eve-sso");
      if (!opened) throw new Error("popup_blocked");
    } catch (err) {
      setEsiPending(false);
      setErrors([{ code: "esi_sso_failed", message: (err as Error).message || "Could not open EVE SSO." }]);
    }
  }

  function handleEsiLinkClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!isNativeRuntime()) {
      beginEsiLink();
      return;
    }
    event.preventDefault();
    void beginNativeEsiLink();
  }

  async function refreshEsiCharacter(characterId: number) {
    setEsiBusy(`refresh-${characterId}`);
    try {
      const response = await triffApiFetch(`/api/fitting/esi/characters/${characterId}/refresh-skills`, { method: "POST" });
      await readJson<{ ok: boolean }>(response);
      await refreshLinkedCharacters({ preserveOnError: true });
      setNotice("Character skills refreshed.");
    } catch (err) {
      setErrors([{ code: "esi_refresh_failed", message: (err as Error).message || "Could not refresh character." }]);
    } finally {
      setEsiBusy(null);
    }
  }

  async function unlinkEsiCharacter(characterId: number) {
    if (!window.confirm("Unlink this EVE character?")) return;
    setEsiBusy(`unlink-${characterId}`);
    try {
      const response = await triffApiFetch(`/api/fitting/esi/characters/${characterId}`, { method: "DELETE" });
      await readJson<{ ok: boolean }>(response);
      await refreshLinkedCharacters({ preserveOnError: true });
      if (skillProfile.mode === "esi_character" && skillProfile.characterId === characterId) setSkillProfile({ mode: "all_v" });
      setNotice("Character unlinked.");
    } finally {
      setEsiBusy(null);
    }
  }

  async function openModuleSheet(slot: SlotKey, index: number, mode: ModuleSheetMode = "actions") {
    const module = fit.modules[slot][index];
    if (!module) return;
    setModuleSheet({ slot, index, module, mode });
    setSheetLoading(true);
    try {
      const [chargeRows, variantRows, mutaplasmidRows] = await Promise.all([
        fetchChargesFor(module.typeId).catch(() => []),
        fetchVariantsFor(module.typeId).catch(() => []),
        fetchMutaplasmidsFor(module.typeId).catch(() => []),
      ]);
      setCharges(chargeRows);
      setVariants(variantRows);
      setMutaplasmids(mutaplasmidRows);
    } finally {
      setSheetLoading(false);
    }
  }

  async function openCharacterSheet(kind: "implants" | "boosters", index: number, item: QuantityItem, mode: CharacterSheetMode = "actions") {
    setCharacterSheet({ kind, index, item, mode });
    setSheetLoading(true);
    try {
      const [variantRows, sets] = await Promise.all([
        item.typeId ? fetchVariantsFor(item.typeId).catch(() => []) : Promise.resolve([]),
        kind === "implants" ? fetchImplantSets().catch(() => []) : Promise.resolve([]),
      ]);
      setVariants(variantRows);
      setImplantSets(sets);
    } finally {
      setSheetLoading(false);
    }
  }

  const moduleSheetModule = moduleSheet ? fit.modules[moduleSheet.slot]?.[moduleSheet.index] || moduleSheet.module : null;
  const moduleSheetRow = moduleSheet && stats?.moduleRows?.[moduleSheet.slot]?.[moduleSheet.index];

  return (
    <div className={`mobile-fitting-shell ${standalone ? "mobile-fitting-shell--standalone top-0" : "top-12"} fixed inset-x-0 z-0 flex min-h-0 flex-col overflow-hidden bg-[#030509] text-slate-100`}>
      <MobileTopBar
        activeTab={activeTab}
        shipSummary={shipSummary}
        skillProfile={skillProfile}
        linkedCharacters={linkedCharacters}
        busyAction={busyAction}
        skillOverrideCount={skillOverrideCount}
        accessory={topBarAccessory}
        appChrome={standalone}
        onOpenFits={() => setFitsSheetOpen(true)}
        onNew={openNewFitTab}
        onImport={() => setImportChoiceOpen(true)}
        onExport={() => void exportFit()}
        onSave={() => void saveCurrentFit()}
        onSkillProfileChange={handleSkillProfileChange}
        onClearSkillOverrides={clearTemporarySkillOverrides}
      />

      <main className="mobile-fitting-main min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5 pt-1.5">
        <FittingWarnings warnings={warnings} errors={errors} />
        {view === "fit" && (
          <MobileFitView
            fit={fit}
            stats={stats}
            typeDetails={typeDetails}
            onShipModeChange={setShipMode}
            onModuleAction={(slot, index) => void openModuleSheet(slot, index)}
            onRackStateChange={setRackState}
            onModuleStateCycle={cycleModuleState}
          />
        )}
        {view === "browser" && (
          <div className="h-full min-h-0 overflow-hidden border border-[#2c2f36] bg-[#070910]">
            <ModuleBrowser
              mobileCompact
              initialTab="ships"
              initialShipSubtab="all"
              shipBrowserFocusToken={shipBrowserFocusToken}
              onSelect={(item) => void handleSelect(item)}
              onShowInfo={(item) => setItemInfoTarget({ typeId: item.typeId, typeName: item.typeName })}
              onAddToCargo={addCargoItem}
              authUser={authUser}
              savedFitGroups={savedFitGroups}
              savedFitsLoading={savedFitsLoading}
              selectedSavedFitId={activeSavedFitId}
              savedFitFocus={savedFitFocus}
              onOpenSavedFit={(id) => void openSavedFit(id)}
              onDeleteSavedFit={(id) => void deleteSavedFit(id)}
            />
          </div>
        )}
        {view === "stats" && (
          <div className="flex h-full min-h-0 flex-col gap-1.5">
            <div className="grid h-8 shrink-0 grid-cols-2 border border-[#303236] bg-[#05070b]">
              {(["stats", "graphs"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`text-[10px] uppercase tracking-widest ${
                    statsMode === mode
                      ? "bg-[#101721] text-[#8bd3ff]"
                      : "text-slate-500 active:bg-[#0d1118] active:text-slate-300"
                  }`}
                  onClick={() => setStatsMode(mode)}
                >
                  {mode === "stats" ? "Stats" : "Graphs"}
                </button>
              ))}
            </div>
            <div className={`min-h-0 flex-1 ${statsMode === "stats" ? "overflow-y-auto pb-[calc(0.75rem+env(safe-area-inset-bottom))]" : "overflow-hidden"}`}>
              {statsMode === "stats" ? (
                <FittingStatsPanel
                  stats={stats}
                  warnings={warnings}
                  errors={errors}
                  loading={calculating}
                  skillProfile={skillProfile}
                  linkedCharacters={linkedCharacters}
                  selectedCharacter={selectedLinkedCharacter}
                  esiPending={esiPending}
                  esiBusy={esiBusy}
                  onSkillProfileChange={handleSkillProfileChange}
                  skillOverrideCount={skillOverrideCount}
                  onClearSkillOverrides={clearTemporarySkillOverrides}
                  showSkillSelector={false}
                  showMessages={false}
                  damageProfile={fit.damageProfile}
                  onDamageProfileChange={setDamageProfile}
                  mobileDamageProfileMenu
                />
              ) : (
                <FittingGraphsPanel
                  key={activeTab?.tabId || "mobile-graphs"}
                  calculationPayload={calculationRequest}
                  openFitTargets={graphOpenFitTargets}
                  viewMode="graphs"
                  onViewModeChange={() => undefined}
                  stateKey={activeTab?.tabId}
                  state={activeTab?.tabId ? mobileGraphStateByTab[activeTab.tabId] || null : null}
                  onStateChange={setActiveMobileGraphState}
                  variant="mobile"
                />
              )}
            </div>
          </div>
        )}
        {view === "additions" && (
          <MobileAdditionsView
            active={additionTab}
            onActive={setAdditionTab}
            fit={fit}
            stats={stats}
            onRemove={removeQuantity}
            onDroneActive={setDroneActive}
            onDroneQuantity={setDroneQuantity}
            onCargoQuantity={setCargoQuantity}
            onFighterActive={setFighterActive}
            onToggleCharacterItem={toggleCharacterItem}
            onCharacterAction={(kind, index, item) => void openCharacterSheet(kind, index, item)}
          />
        )}
        {view === "projected" && (
          <MobileProjectedView
            fit={fit}
            stats={stats}
            projectedLinks={projectedLinks}
            sourceFits={sourceFitOptions}
            onAddEffect={addProjectedEffect}
            onRemoveEffect={removeProjectedEffect}
            onAddSource={addProjectedSource}
            onToggleSource={toggleProjectedSource}
            onRemoveSource={removeProjectedSource}
          />
        )}
        {view === "command" && (
          <MobileCommandView
            commandLinks={commandLinks}
            sourceFits={sourceFitOptions}
            commandBurstsBySource={commandBurstsBySource}
            stats={stats}
            onAddSource={addCommandSource}
            onToggleSource={toggleCommandSource}
            onToggleBurst={toggleCommandBurst}
            onRemoveSource={removeCommandSource}
          />
        )}
      </main>

      <MobileBottomNav view={view} onView={setView} />

      {fitsSheetOpen && (
        <MobileOpenFitsSheet
          tabs={workspace.openFits}
          activeTabId={workspace.activeTabId}
          onSwitch={switchFitTab}
          onRename={renameFitTab}
          onCloseTab={closeFitTab}
          onNew={() => {
            openNewFitTab();
            setFitsSheetOpen(false);
          }}
          onClose={() => setFitsSheetOpen(false)}
        />
      )}

      {moduleSheet && moduleSheetModule && (
        <MobileModuleActionSheet
          state={moduleSheet}
          module={moduleSheetModule}
          row={moduleSheetRow}
          loading={sheetLoading}
          charges={charges}
          variants={variants}
          mutaplasmids={mutaplasmids}
          fitPayload={calculationFit}
          activeSkillOverrides={activeSkillOverrides}
          skillOverrideCount={skillOverrideCount}
          onMode={(mode, groupKey) => setModuleSheet((prev) => (prev ? { ...prev, mode, openChargeGroup: groupKey ?? prev.openChargeGroup ?? null } : prev))}
          onClose={() => setModuleSheet(null)}
          onRemove={() => removeModule(moduleSheet.slot, moduleSheet.index)}
          onFillWithModule={() => {
            const { slot, index } = moduleSheet;
            setModuleSheet(null);
            void fillWithModule(slot, index);
          }}
          onState={(state) => setModuleState(moduleSheet.slot, moduleSheet.index, state)}
          onSpool={(cycles) => setModuleSpool(moduleSheet.slot, moduleSheet.index, cycles)}
          onCharge={(charge) => loadCharge(moduleSheet.slot, moduleSheet.index, charge)}
          onVariant={(variant) => void replaceVariant(moduleSheet.slot, moduleSheet.index, variant)}
          onMutaplasmid={(mutaplasmid) => applyMutaplasmid(moduleSheet.slot, moduleSheet.index, mutaplasmid)}
          onEditMutation={() => editMutation(moduleSheet.slot, moduleSheet.index)}
          onClearMutation={() => clearMutation(moduleSheet.slot, moduleSheet.index)}
          onSkillOverride={setTemporarySkillOverride}
          onClearSkillOverrides={clearTemporarySkillOverrides}
          onShowInfo={(typeId, typeName) => {
            setModuleSheet(null);
            setItemInfoTarget({ typeId, typeName });
          }}
        />
      )}

      {characterSheet && (
        <MobileCharacterActionSheet
          state={characterSheet}
          loading={sheetLoading}
          variants={variants}
          implantSets={implantSets}
          onMode={(mode, setKey) => setCharacterSheet((prev) => (prev ? { ...prev, mode, openSetKey: setKey ?? prev.openSetKey ?? null } : prev))}
          onClose={() => setCharacterSheet(null)}
          onRemove={() => {
            removeQuantity(characterSheet.kind, characterSheet.index);
            setCharacterSheet(null);
          }}
          onVariant={(variant) => replaceCharacterItem(characterSheet.kind, characterSheet.index, variant)}
          onApplySet={applyImplantSet}
          onShowInfo={(typeId, typeName) => {
            setCharacterSheet(null);
            setItemInfoTarget({ typeId, typeName });
          }}
        />
      )}

      {itemInfoTarget && (
        <MobileItemInfoSheet
          target={itemInfoTarget}
          onClose={() => setItemInfoTarget(null)}
        />
      )}

      <MutationEditorModal
        open={mutationEditor !== null}
        module={mutationEditor?.module || null}
        mutation={mutationEditor?.mutation || null}
        onClose={() => setMutationEditor(null)}
        onApply={applyMutationEditor}
      />

      {importChoiceOpen && (
        <BottomSheet title="Import Fit" onClose={() => setImportChoiceOpen(false)}>
          <div className="p-2">
            <TouchRow
              icon={<ClipboardPaste size={15} className="text-[#9fddff]" />}
              title="Import from Clipboard / EFT"
              subtitle="Paste a Pyfa or EFT text fit."
              right={<ChevronRight size={13} />}
              onClick={() => {
                setImportChoiceOpen(false);
                setModal("import");
              }}
            />
            <TouchRow
              icon={<Upload size={15} className="text-[#9fddff]" />}
              title="Import from In-Game"
              subtitle="Load saved fittings from an authorized EVE character."
              right={<ChevronRight size={13} />}
              onClick={openInGameImportSheet}
            />
          </div>
        </BottomSheet>
      )}

      {inGameFitsOpen && (
        <MobileInGameFittingsSheet
          authUser={authUser}
          onClose={() => setInGameFitsOpen(false)}
          onImported={(data) => {
            applyImportedFit(data, { stayInCurrentView: true });
            pushMobileToast(`Imported ${data.inGameFitting?.name || data.payload.fitName || "in-game fit"}.`);
          }}
        />
      )}

      <ImportFitModal
        open={modal !== null}
        mode={modal || "import"}
        text={modal === "export" ? exportText : eftText}
        busy={busyAction === "import"}
        shareBusy={busyAction === "share"}
        shareLink={shareLink}
        shareError={shareError}
        onTextChange={modal === "export" ? setExportText : setEftText}
        onClose={() => setModal(null)}
        onShareLink={modal === "export" ? createShareLink : undefined}
        onCopyShareLink={modal === "export" ? copyShareLink : undefined}
        onSubmit={modal === "export" ? () => copyToClipboard(exportText) : importFit}
      />

      {esiLinkSheetOpen && authUser && (
        <BottomSheet title="Link EVE Character" subtitle="Opens EVE SSO in a new tab" onClose={() => setEsiLinkSheetOpen(false)}>
          <div className="p-3">
            <div className="mb-3 border border-[#20242c] bg-[#05070b] p-3 text-[12px] leading-5 text-slate-400">
              Safari requires this to be opened from a direct tap. Your current fitting page will stay open, and the character list will refresh here after authorization.
            </div>
            <a
              href={triffToolsUrl("/api/fitting/esi/login")}
              target="triff-eve-sso"
              rel="opener"
              className={`${primaryClass} w-full`}
              onClick={handleEsiLinkClick}
            >
              Open EVE SSO
            </a>
          </div>
        </BottomSheet>
      )}

      {manageCharactersOpen && (
        <BottomSheet title="Linked EVE Characters" onClose={() => setManageCharactersOpen(false)}>
          <div className="p-3">
            {!esiConfigured && <div className="mb-2 border border-amber-500/30 bg-amber-950/20 p-2 text-[11px] text-amber-200">EVE SSO is not configured. Missing: {esiConfigMissing.join(", ")}</div>}
            {!linkedCharacters.length ? (
              <div className="border border-[#20242c] bg-[#05070b] p-3 text-[12px] text-slate-500">No linked EVE characters.</div>
            ) : (
              linkedCharacters.map((character) => (
                <div key={character.characterId} className="mb-2 border border-[#20242c] bg-[#05070b] p-2">
                  <div className="text-[12px] text-slate-100">{character.characterName}</div>
                  <div className="mb-2 text-[10px] text-slate-600">{character.tokenStatus || "ok"}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" className={buttonClass} onClick={() => void refreshEsiCharacter(character.characterId)} disabled={esiBusy === `refresh-${character.characterId}`}>
                      Refresh
                    </button>
                    <button type="button" className={buttonClass} onClick={() => void unlinkEsiCharacter(character.characterId)} disabled={esiBusy === `unlink-${character.characterId}`}>
                      Unlink
                    </button>
                  </div>
                </div>
              ))
            )}
            <button type="button" className={`${primaryClass} mt-2 w-full`} onClick={linkEveCharacter}>
              Link EVE Character
            </button>
          </div>
        </BottomSheet>
      )}

      {mobileToast && (
        <div
          key={mobileToast.id}
          className={`fixed left-3 right-3 top-[calc(var(--mobile-fitting-visual-top,0px)+3.5rem)] z-[10001] border px-3 py-1.5 text-center text-[11px] shadow-2xl shadow-black/60 ${
            mobileToast.tone === "error"
              ? "border-[#6b2b32] bg-[#1d090b] text-[#ffaaaa]"
              : "border-[#2f6b46] bg-[#07130c] text-[#9dffbd]"
          }`}
        >
          {mobileToast.message}
        </div>
      )}
      {notice && <div className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-3 right-3 z-[10001] border border-[#2f6b46] bg-[#07130c] px-3 py-2 text-center text-[12px] text-[#9dffbd] shadow-2xl shadow-black/60">{notice}</div>}
      {savedFitsError && <div className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-3 right-3 z-[10001] border border-[#6b2b32] bg-[#1d090b] px-3 py-2 text-center text-[12px] text-[#ffaaaa] shadow-2xl shadow-black/60">{savedFitsError}</div>}
    </div>
  );
}

function MobileTopBar({
  activeTab,
  shipSummary,
  skillProfile,
  linkedCharacters,
  busyAction,
  skillOverrideCount = 0,
  accessory,
  appChrome = false,
  onOpenFits,
  onNew,
  onImport,
  onExport,
  onSave,
  onSkillProfileChange,
  onClearSkillOverrides,
}: {
  activeTab: OpenFitTab;
  shipSummary: { typeId: number; typeName: string } | null;
  skillProfile: SkillProfile;
  linkedCharacters: LinkedEsiCharacter[];
  busyAction: string | null;
  skillOverrideCount?: number;
  accessory?: ReactNode;
  appChrome?: boolean;
  onOpenFits: () => void;
  onNew: () => void;
  onImport: () => void;
  onExport: () => void;
  onSave: () => void;
  onSkillProfileChange: (value: string) => void;
  onClearSkillOverrides?: () => void;
}) {
  return (
    <header className={`shrink-0 border-b border-[#2c2f36] bg-[#070910] px-2 pb-1.5 ${appChrome ? "pt-[calc(0.375rem+env(safe-area-inset-top))]" : "pt-1.5"} shadow-lg shadow-black/40`}>
      <div className="mb-1.5 grid grid-cols-[36px,1fr] items-center gap-1.5">
        <IconImage typeId={shipSummary?.typeId} className="h-9 w-9" />
        <div className="min-w-0">
          <button
            type="button"
            className="grid h-9 w-full grid-cols-[auto,1fr,auto] items-center gap-1.5 border border-[#303236] bg-[#05070b] px-2 text-left active:border-[#53b6ff]/70 active:bg-[#101721]"
            onClick={onOpenFits}
            aria-label="Open fit selector"
          >
            <span className="text-[9px] uppercase tracking-widest text-slate-500">Fit:</span>
            <span className="min-w-0 truncate text-[11px] uppercase tracking-widest text-[#8bd3ff]">
              {activeTab.fitName || "New Fit"}{activeTab.dirty ? " *" : ""}
            </span>
            <ChevronRight size={13} className="text-slate-500" />
          </button>
        </div>
      </div>
      {accessory && <div className="mb-1.5">{accessory}</div>}
      <div className="mb-1.5">
        <select
          className="h-8 w-full border border-[#303236] bg-[#05070b] px-2 text-[11px] text-slate-100 outline-none"
          value={profileValue(skillProfile)}
          onChange={(event) => onSkillProfileChange(event.target.value)}
        >
          <option value="all_v">All V Skills</option>
          <option value="alpha_clone">All Alpha Skills</option>
          {linkedCharacters.map((character) => (
            <option key={character.characterId} value={`esi:${character.characterId}`}>
              {character.characterName}{character.tokenStatus && character.tokenStatus !== "ok" ? " !" : ""}
            </option>
          ))}
          <option value="link">Link EVE Character</option>
          {linkedCharacters.length > 0 && <option value="manage">Manage linked characters</option>}
          {skillProfile.mode === "esi_character" && <option value="refresh">Refresh selected character</option>}
        </select>
      </div>
      {skillOverrideCount > 0 && (
        <div className="mb-1.5 flex min-h-7 items-center justify-between gap-2 border border-[#3a3230] bg-[#100d07] px-2 text-[9px] uppercase tracking-widest text-yellow-300">
          <span className="flex min-w-0 items-center gap-1.5">
            <AlertTriangle size={11} className="shrink-0" />
            <span className="truncate">{skillOverrideCount} skill{skillOverrideCount === 1 ? "" : "s"} overridden</span>
          </span>
          {onClearSkillOverrides && (
            <button type="button" className="shrink-0 text-[#ffb4a6] active:text-[#ffd2ca]" onClick={onClearSkillOverrides}>
              Clear
            </button>
          )}
        </div>
      )}
      <div className="grid grid-cols-4 gap-1">
        <button type="button" className={buttonClass} onClick={onImport}><Upload size={13} />Import</button>
        <button type="button" className={buttonClass} onClick={onExport} disabled={!activeTab.fitState.shipTypeId || busyAction === "export"}><Link2 size={13} />Share/EFT</button>
        <button type="button" className={buttonClass} onClick={onSave} disabled={!activeTab.fitState.shipTypeId || busyAction === "save"}>{busyAction === "save" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}Save</button>
        <button type="button" className={primaryClass} onClick={onNew}><Plus size={13} />New</button>
      </div>
    </header>
  );
}

function MobileOpenFitsSheet({
  tabs,
  activeTabId,
  onSwitch,
  onRename,
  onCloseTab,
  onNew,
  onClose,
}: {
  tabs: OpenFitTab[];
  activeTabId: string;
  onSwitch: (tabId: string) => void;
  onRename: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet title="Open Fits" onClose={onClose}>
      <div className="divide-y divide-[#151922]">
        {tabs.map((tab) => {
          const active = tab.tabId === activeTabId;
          return (
            <div
              key={tab.tabId}
              className={`grid min-h-[58px] grid-cols-[34px,1fr,auto] items-center gap-2 px-2 py-2 ${
                active ? "bg-[#101721]" : "bg-[#070910]"
              }`}
            >
              {tab.shipTypeId ? (
                <IconImage typeId={tab.shipTypeId} className="h-8 w-8" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center border border-[#30343d] bg-black text-slate-600">
                  <EveUiIcon icon={eveUiIcons.fitting} className="h-5 w-5" />
                </span>
              )}
              <button type="button" className="min-w-0 text-left" onClick={() => onSwitch(tab.tabId)}>
                <span className="block truncate text-[12px] text-slate-100">
                  {tab.fitName || "New Fit"}{tab.dirty ? " *" : ""}
                </span>
                <span className="block truncate font-mono text-[10px] text-slate-600">
                  {active ? "Active · " : ""}{tab.shipName || "No hull selected"}
                </span>
              </button>
              <div className="flex items-center gap-1">
                {!active && (
                  <button
                    type="button"
                    className="h-9 border border-[#303236] bg-[#05070b] px-2 text-[10px] uppercase tracking-widest text-slate-400 active:text-[#8bd3ff]"
                    onClick={() => onSwitch(tab.tabId)}
                  >
                    Switch
                  </button>
                )}
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-400 active:border-[#53b6ff]/60 active:text-[#8bd3ff]"
                  onClick={() => onRename(tab.tabId)}
                  aria-label={`Rename ${tab.fitName || "fit"}`}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center border border-[#303236] bg-[#05070b] text-red-300 active:border-red-400/60"
                  onClick={() => onCloseTab(tab.tabId)}
                  aria-label={`Close ${tab.fitName || "fit"}`}
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          className="grid min-h-11 w-full grid-cols-[34px,1fr] items-center gap-2 bg-[#070910] px-2 text-left active:bg-[#101721]"
          onClick={onNew}
        >
          <ActionGlyph label="+" />
          <span className="text-[12px] uppercase tracking-widest text-[#8bd3ff]">New Fit</span>
        </button>
      </div>
    </BottomSheet>
  );
}

function MobileFitView({
  fit,
  stats,
  typeDetails,
  onShipModeChange,
  onModuleAction,
  onRackStateChange,
  onModuleStateCycle,
}: {
  fit: FitPayload;
  stats: FittingStats | null;
  typeDetails: Record<number, SearchResult>;
  onShipModeChange: (mode: ShipModeOption) => void;
  onModuleAction: (slot: SlotKey, index: number) => void;
  onRackStateChange: (slot: SlotKey, state: "offline" | "online" | "active" | "overheated") => void;
  onModuleStateCycle: (slot: SlotKey, index: number) => void;
}) {
  if (!fit.shipTypeId) {
    return (
      <div className="flex min-h-[55vh] flex-col items-center justify-center border border-[#20242c] bg-[#070910] p-5 text-center">
        <EveUiIcon icon={eveUiIcons.fitting} className="mb-3 h-12 w-12 text-slate-600" />
        <div className="text-[13px] uppercase tracking-widest text-slate-300">No hull selected</div>
        <div className="mt-1 text-[12px] text-slate-600">Use Browser or Import to start a mobile fit.</div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <MobileShipModeSelector stats={stats} onShipModeChange={onShipModeChange} />
      {SLOT_ORDER.map((slot) => (
        <MobileSlotGroup
          key={slot}
          slot={slot}
          fit={fit}
          stats={stats}
          typeDetails={typeDetails}
          onModuleAction={onModuleAction}
          onRackStateChange={onRackStateChange}
          onModuleStateCycle={onModuleStateCycle}
        />
      ))}
    </div>
  );
}

function MobileShipModeSelector({ stats, onShipModeChange }: { stats: FittingStats | null; onShipModeChange: (mode: ShipModeOption) => void }) {
  const modes = stats?.shipModes?.available || [];
  if (!modes.length) return null;
  const activeModeId = stats?.shipModes?.activeModeId || modes[0]?.modeId || null;
  return (
    <section className="border border-[#2c2f36] bg-[#070910] px-2 py-1.5">
      <div className="mb-1 text-[9px] uppercase tracking-widest text-slate-500">Mode</div>
      <div className="grid grid-cols-3 gap-1">
        {modes.map((mode) => {
          const active = String(mode.modeId) === String(activeModeId);
          return (
            <button
              key={mode.modeId}
              type="button"
              className={`min-h-7 border px-1.5 text-[10px] uppercase tracking-widest ${
                active
                  ? "border-[#53b6ff]/60 bg-[#16202a] text-[#8bd3ff]"
                  : "border-[#303236] bg-[#05070b] text-slate-500 active:border-[#53b6ff]/60 active:text-slate-200"
              }`}
              onClick={() => onShipModeChange(mode)}
              title={mode.fullName}
            >
              {mode.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function moduleStateDotClass(state: string) {
  if (state === "unresolved" || state === "placeholder") return "border-amber-300 bg-[#1b1407]";
  if (state === "offline") return "border-slate-500 bg-slate-700";
  if (state === "online") return "border-[#8bd3ff] bg-[#1c6f9f]";
  if (state === "overheated") return "border-orange-300 bg-orange-400";
  return "border-emerald-300 bg-emerald-400";
}

function MobileRackActionButtons({
  slot,
  canOverheat,
  onRackStateChange,
}: {
  slot: SlotKey;
  canOverheat: boolean;
  onRackStateChange: (slot: SlotKey, state: "offline" | "online" | "active" | "overheated") => void;
}) {
  const buttonClass = "flex h-6 w-6 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 active:border-[#53b6ff]/60 active:text-slate-100";
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={buttonClass} title={`Offline ${SLOT_LABELS[slot]}`} onClick={() => onRackStateChange(slot, "offline")}>
        <Power size={12} />
      </button>
      <button type="button" className={buttonClass} title={`Online ${SLOT_LABELS[slot]}`} onClick={() => onRackStateChange(slot, "online")}>
        <Power size={12} className="text-[#8bd3ff]" />
      </button>
      <button type="button" className={buttonClass} title={`Activate ${SLOT_LABELS[slot]}`} onClick={() => onRackStateChange(slot, "active")}>
        <CheckCircle2 size={12} className="text-emerald-300" />
      </button>
      <button
        type="button"
        disabled={!canOverheat}
        className={`${buttonClass} ${canOverheat ? "" : "cursor-not-allowed opacity-35"}`}
        title={canOverheat ? `Overheat ${SLOT_LABELS[slot]}` : `No heatable modules in ${SLOT_LABELS[slot]}`}
        onClick={() => onRackStateChange(slot, "overheated")}
      >
        <PyfaGuiIcon name="overheat" label="Overheat" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function MobileSlotGroup({
  slot,
  fit,
  stats,
  typeDetails,
  onModuleAction,
  onRackStateChange,
  onModuleStateCycle,
}: {
  slot: SlotKey;
  fit: FitPayload;
  stats: FittingStats | null;
  typeDetails: Record<number, SearchResult>;
  onModuleAction: (slot: SlotKey, index: number) => void;
  onRackStateChange: (slot: SlotKey, state: "offline" | "online" | "active" | "overheated") => void;
  onModuleStateCycle: (slot: SlotKey, index: number) => void;
}) {
  const modules = fit.modules[slot] || [];
  const total = slotTotal(stats, slot);
  const turretHardpoints = stats?.hardpoints?.turret;
  const launcherHardpoints = stats?.hardpoints?.launcher;
  const canOverheatRack = modules.some((_, index) => stats?.moduleRows?.[slot]?.[index]?.canOverheat);
  if (!modules.length && slot === "subsystem") return null;
  return (
      <section className="overflow-hidden border border-[#2c2f36] bg-[#070910]">
      <div className="flex h-7 items-center justify-between border-b border-[#2c2f36] bg-[#101219] px-2">
        <div className="text-[10px] uppercase tracking-widest text-slate-300">{SLOT_LABELS[slot]}</div>
        <div className="flex items-center gap-2">
          {slot !== "rig" && slot !== "subsystem" && modules.length > 0 && (
            <MobileRackActionButtons slot={slot} canOverheat={canOverheatRack} onRackStateChange={onRackStateChange} />
          )}
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
            {slot === "high" && (
              <span title="Turret and launcher hardpoints used / available">
                T {countText(turretHardpoints?.used)}/{countText(turretHardpoints?.total)} | L {countText(launcherHardpoints?.used)}/{countText(launcherHardpoints?.total)}
              </span>
            )}
            <span>{modules.length}{total != null ? ` / ${total}` : ""}</span>
          </div>
        </div>
      </div>
      <div className="divide-y divide-[#151922]">
        {modules.length ? (
          modules.map((module, index) => (
            <MobileModuleRow
              key={`${module.typeId}-${index}`}
              slot={slot}
              index={index}
              module={module}
              row={stats?.moduleRows?.[slot]?.[index]}
              detail={typeDetails[module.typeId]}
              warningTitle={moduleWarningTitle(stats, slot, index)}
              onAction={() => onModuleAction(slot, index)}
              onStateCycle={() => onModuleStateCycle(slot, index)}
            />
          ))
        ) : (
          <div className="px-3 py-3 text-[12px] text-slate-600">No fitted modules</div>
        )}
      </div>
    </section>
  );
}

function MobileModuleRow({
  module,
  row,
  detail,
  warningTitle,
  onAction,
  onStateCycle,
}: {
  slot: SlotKey;
  index: number;
  module: FittingModule;
  row?: FittedModuleRow;
  detail?: SearchResult;
  warningTitle?: string;
  onAction: () => void;
  onStateCycle: () => void;
}) {
  const fitting = detail?.fitting || module.fitting || {};
  const placeholder = isAbyssalPlaceholder(module, row);
  const placeholderTitle = abyssalPlaceholderTooltip(module, row);
  const state = placeholder ? "unresolved" : normalizedModuleState(row?.state || module.state);
  const cap = placeholder ? null : row?.displayStats?.capOrFuel?.value;
  const range = placeholder ? null : row?.displayStats?.range?.value;
  const tracking = placeholder ? null : row?.displayStats?.trackingOrApplication?.value;
  return (
    <div className="grid grid-cols-[34px,1fr,36px] gap-1.5 px-2 py-1.5">
      <IconImage typeId={module.typeId} className="mt-0.5 h-8 w-8" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1">
          <button type="button" className="flex h-5 w-5 shrink-0 items-center justify-center" title={placeholder ? placeholderTitle : `Cycle module state: ${state}`} onClick={placeholder ? undefined : onStateCycle} disabled={placeholder}>
            <span className={`h-2 w-2 border ${moduleStateDotClass(state)}`} />
          </button>
          <div className={`truncate text-[12px] ${placeholder ? "text-amber-100" : "text-slate-100"}`}>{module.mutation?.displayName || module.typeName || row?.name || `Type ${module.typeId}`}</div>
          {placeholder && <AlertTriangle size={13} className="shrink-0 text-amber-300" title={placeholderTitle} />}
          {warningTitle && <AlertTriangle size={13} className="shrink-0 text-amber-300" title={warningTitle} />}
        </div>
        {module.chargeTypeId && (
          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-[#8bd3ff]">
            <IconImage typeId={module.chargeTypeId} className="h-4 w-4" />
            <span className="truncate">{module.chargeTypeName}</span>
          </div>
        )}
        <div className="mt-0.5 flex flex-wrap gap-x-1.5 gap-y-0.5 font-mono text-[9px] text-slate-500">
          {placeholder ? (
            <span title={placeholderTitle}>unresolved abyssal - not calculated</span>
          ) : (
            <>
              <span>CPU {fmt(row?.cpu ?? fitting.cpu, 1)}</span>
              <span>PG {fmt(row?.powergrid ?? fitting.powergrid, 1)}</span>
              {cap && <span>{cap}</span>}
              {range && <span>{range}</span>}
              {tracking && <span>{tracking}</span>}
            </>
          )}
        </div>
      </div>
      <button type="button" className="flex h-9 w-9 items-center justify-center text-slate-400 active:text-slate-100" onClick={onAction} aria-label="Module actions">
        <MoreVertical size={18} />
      </button>
    </div>
  );
}

function MobileBottomNav({ view, onView }: { view: MobileView; onView: (view: MobileView) => void }) {
  return (
    <nav className="mobile-fitting-bottom-nav z-40 grid shrink-0 grid-cols-6 border-t border-[#2c2f36] bg-[#070910]/95 backdrop-blur">
      {navItems.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`flex min-h-[50px] flex-col items-center justify-center gap-0.5 text-[8px] uppercase tracking-widest ${
            view === item.key ? "text-[#8bd3ff]" : "text-slate-500"
          }`}
          onClick={() => onView(item.key)}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function MobileModuleActionSheet({
  state,
  module,
  row,
  loading,
  charges,
  variants,
  mutaplasmids,
  fitPayload,
  activeSkillOverrides,
  skillOverrideCount,
  onMode,
  onClose,
  onRemove,
  onFillWithModule,
  onState,
  onSpool,
  onCharge,
  onVariant,
  onMutaplasmid,
  onEditMutation,
  onClearMutation,
  onSkillOverride,
  onClearSkillOverrides,
  onShowInfo,
}: {
  state: NonNullable<ModuleSheetState>;
  module: FittingModule;
  row?: FittedModuleRow;
  loading: boolean;
  charges: ChargeResult[];
  variants: SearchResult[];
  mutaplasmids: MutaplasmidResult[];
  fitPayload: FitPayload;
  activeSkillOverrides: SkillOverrideMap;
  skillOverrideCount: number;
  onMode: (mode: ModuleSheetMode, groupKey?: string | null) => void;
  onClose: () => void;
  onRemove: () => void;
  onFillWithModule: () => void;
  onState: (state: string) => void;
  onSpool: (cycles: number) => void;
  onCharge: (charge: ChargeResult | null) => void;
  onVariant: (variant: SearchResult) => void;
  onMutaplasmid: (mutaplasmid: MutaplasmidResult) => void;
  onEditMutation: () => void;
  onClearMutation: () => void;
  onSkillOverride: (skillTypeId: number, level: number | null) => void;
  onClearSkillOverrides: () => void;
  onShowInfo: (typeId: number, typeName?: string) => void;
}) {
  const title = module.mutation?.displayName || module.typeName || `Type ${module.typeId}`;
  const chargeGroups = groupCharges(charges);
  const activeChargeGroup = chargeGroups.find((group) => group.key === state.openChargeGroup);
  const placeholder = isAbyssalPlaceholder(module, row);
  const placeholderTitle = abyssalPlaceholderTooltip(module, row);
  const moduleState = placeholder ? "unresolved" : normalizedModuleState(row?.state || module.state);
  const canOverheat = moduleState === "overheated" || row?.canOverheat === true;
  const spool = row?.spool?.eligible ? row.spool : null;
  const spoolMin = Number(spool?.minCycles ?? 0);
  const spoolMax = Number(spool?.maxCycles ?? -1);
  const spoolCurrent = Number(module.spoolAmount ?? spool?.currentCycles ?? spoolMax);
  const skillModeKind: SkillSheetKind | null = state.mode === "moduleSkills" ? "module" : state.mode === "shipSkills" ? "ship" : null;
  const [affectedSkills, setAffectedSkills] = useState<Record<SkillSheetKind, AffectedSkill[]>>({ module: [], ship: [] });
  const [skillLoading, setSkillLoading] = useState<Record<SkillSheetKind, boolean>>({ module: false, ship: false });
  const [skillError, setSkillError] = useState<Record<SkillSheetKind, string | null>>({ module: null, ship: null });
  const [selectedSkillKind, setSelectedSkillKind] = useState<SkillSheetKind>("module");
  const [selectedSkillTypeId, setSelectedSkillTypeId] = useState<number | null>(null);
  const selectedSkill = affectedSkills[selectedSkillKind].find((skill) => skill.skillTypeId === selectedSkillTypeId) || null;
  const activeSkillOverridesKey = useMemo(() => JSON.stringify(activeSkillOverrides), [activeSkillOverrides]);
  const groupedVariants = useMemo(() => {
    const groups = new Map<string, SearchResult[]>();
    for (const variant of variants) {
      const label = variant.variantGroup || variant.metaGroupName || variant.groupName || "Variants";
      groups.set(label, [...(groups.get(label) || []), variant]);
    }
    return Array.from(groups.entries());
  }, [variants]);

  useEffect(() => {
    if (!skillModeKind || !fitPayload?.shipTypeId) return;
    const controller = new AbortController();
    setSkillLoading((prev) => ({ ...prev, [skillModeKind]: true }));
    setSkillError((prev) => ({ ...prev, [skillModeKind]: null }));
    triffApiFetch("/api/fitting/affected-skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payload: fitPayload,
        context: skillModeKind === "ship" ? { kind: "ship" } : { kind: "module", slot: state.slot, index: state.index },
      }),
      signal: controller.signal,
    })
      .then((response) => readJson<AffectedSkillsResponse>(response))
      .then((data) => {
        setAffectedSkills((prev) => ({ ...prev, [skillModeKind]: data.skills || [] }));
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") {
          setSkillError((prev) => ({ ...prev, [skillModeKind]: (err as Error).message || "Unable to load skills" }));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSkillLoading((prev) => ({ ...prev, [skillModeKind]: false }));
        }
      });
    return () => controller.abort();
  }, [skillModeKind, fitPayload, state.slot, state.index, activeSkillOverridesKey]);

  function openSkillList(kind: SkillSheetKind) {
    setSelectedSkillKind(kind);
    setSelectedSkillTypeId(null);
    onMode(kind === "module" ? "moduleSkills" : "shipSkills");
  }

  function openSkillLevels(kind: SkillSheetKind, skill: AffectedSkill) {
    setSelectedSkillKind(kind);
    setSelectedSkillTypeId(skill.skillTypeId);
    onMode("skillLevels");
  }

  function backFromMode() {
    if (state.mode === "skillLevels") {
      onMode(selectedSkillKind === "module" ? "moduleSkills" : "shipSkills");
      return;
    }
    onMode("actions", null);
  }

  function applySkillLevel(level: number | null) {
    if (!selectedSkill) return;
    onSkillOverride(selectedSkill.skillTypeId, level);
    onMode(selectedSkillKind === "module" ? "moduleSkills" : "shipSkills");
  }
  return (
    <BottomSheet
      title={title}
      subtitle={placeholder ? "Unresolved abyssal - not calculated" : module.chargeTypeName || "No charge loaded"}
      leading={<IconImage typeId={module.typeId} className="h-8 w-8" />}
      onClose={onClose}
    >
      {state.mode !== "actions" && (
        <button type="button" className="flex min-h-10 items-center gap-2 border-b border-[#151922] px-3 text-[12px] text-slate-400" onClick={backFromMode}>
          <ChevronLeft size={15} /> Back
        </button>
      )}
      {loading && <div className="flex min-h-12 items-center justify-center gap-2 text-[12px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading</div>}
      {!loading && state.mode === "actions" && (
        <div>
          <div className="border-b border-[#151922] px-3 py-2 text-[11px] text-slate-500">
            {placeholder ? placeholderTitle : `${row?.displayStats?.range?.value || "No range"} - ${row?.displayStats?.trackingOrApplication?.value || "No application stat"}`}
          </div>
          <TouchRow title="Show Info" subtitle={`typeID ${module.typeId}`} onClick={() => onShowInfo(module.typeId, module.typeName)} />
          {!placeholder && <TouchRow icon={module.chargeTypeId ? <IconImage typeId={module.chargeTypeId} className="h-5 w-5" /> : undefined} title="Load Charge / Script" subtitle={module.chargeTypeName || "No charge loaded"} right={<ChevronRight size={14} />} onClick={() => onMode("charges")} />}
          {!placeholder && !!mutaplasmids.length && !module.mutation && <TouchRow title="Apply Mutaplasmid" subtitle={`${mutaplasmids.length} compatible`} right={<ChevronRight size={14} />} onClick={() => onMode("mutaplasmids")} />}
          {!placeholder && module.mutation && (
            <>
              <TouchRow title="Edit Mutation" subtitle={module.mutation.mutaplasmidName || "Abyssal attributes"} onClick={onEditMutation} />
              <TouchRow title="Revert Mutation" subtitle="Restore original module" onClick={onClearMutation} />
            </>
          )}
          {!placeholder && <TouchRow icon={<Power size={12} className="text-slate-400" />} title={moduleState === "offline" ? "Online" : "Offline"} onClick={() => onState(moduleState === "offline" ? "online" : "offline")} />}
          {!placeholder && moduleState === "online" && <TouchRow icon={<CheckCircle2 size={12} className="text-emerald-300" />} title="Activate" onClick={() => onState("active")} />}
          {!placeholder && canOverheat && <TouchRow icon={<PyfaGuiIcon name="overheat" label="Overheat" className="h-3.5 w-3.5" />} title={moduleState === "overheated" ? "Stop Overheating" : "Overheat"} onClick={() => onState(moduleState === "overheated" ? "active" : "overheated")} />}
          {!placeholder && spool && spoolMax >= spoolMin && (
            <TouchRow title="Spool Cycles" subtitle={`${Number.isFinite(spoolCurrent) ? spoolCurrent : spoolMax} / ${spoolMax}`} right={<ChevronRight size={14} />} onClick={() => onMode("spool")} />
          )}
          {!placeholder && <TouchRow title="Change Module Skills" subtitle="Skills affecting or required by this module" right={<ChevronRight size={14} />} onClick={() => openSkillList("module")} />}
          <TouchRow title="Change Ship Skills" subtitle="Skills affecting or required by this hull" right={<ChevronRight size={14} />} onClick={() => openSkillList("ship")} />
          {!placeholder && FILLABLE_RACKS.includes(state.slot) && <TouchRow title="Fill With Module" subtitle={`Fill available ${slotDestination(state.slot)}`} onClick={onFillWithModule} />}
          <TouchRow icon={<Trash2 size={12} className="text-red-300" />} title="Remove Module" danger onClick={onRemove} />
          <TouchRow title="Variants" subtitle={`${variants.length} available`} right={<ChevronRight size={14} />} onClick={() => onMode("variants")} />
        </div>
      )}
      {!loading && state.mode === "charges" && (
        <div>
          {module.chargeTypeId && <TouchRow icon={<Trash2 size={12} className="text-red-300" />} title="Unload Charge" danger onClick={() => onCharge(null)} />}
          {chargeGroups.length ? (
            chargeGroups.map((group) =>
              group.items.length > 1 ? (
                <TouchRow key={group.key} icon={<IconImage typeId={group.items[0]?.typeId} className="h-7 w-7" />} title={group.label} subtitle={`${group.items.length} variants`} right={<ChevronRight size={14} />} onClick={() => onMode("chargeGroup", group.key)} />
              ) : (
                <TouchRow key={group.key} icon={<IconImage typeId={group.items[0]?.typeId} className="h-7 w-7" />} title={group.items[0]?.typeName} onClick={() => onCharge(group.items[0])} />
              )
            )
          ) : (
            <div className="px-3 py-4 text-[12px] text-slate-600">No compatible charges found.</div>
          )}
        </div>
      )}
      {!loading && state.mode === "chargeGroup" && activeChargeGroup && (
        <div>
          {activeChargeGroup.items.map((charge) => (
            <TouchRow key={charge.typeId} icon={<IconImage typeId={charge.typeId} className="h-7 w-7" />} title={charge.typeName} subtitle={charge.metaGroupName || charge.groupName} onClick={() => onCharge(charge)} />
          ))}
        </div>
      )}
      {!loading && state.mode === "variants" && (
        <div>
          {groupedVariants.map(([label, rows]) => (
            <div key={label}>
              <div className="border-b border-[#151922] bg-[#090d13] px-3 py-1 text-[9px] uppercase tracking-widest text-slate-600">{label}</div>
              {rows.map((variant) => <TouchRow key={variant.typeId} icon={<IconImage typeId={variant.typeId} className="h-7 w-7" />} title={variant.typeName} onClick={() => onVariant(variant)} />)}
            </div>
          ))}
        </div>
      )}
      {!loading && state.mode === "mutaplasmids" && (
        <div>
          {mutaplasmids.map((mutaplasmid) => (
            <TouchRow key={mutaplasmid.typeId} icon={<IconImage typeId={mutaplasmid.typeId} className="h-7 w-7" />} title={mutaplasmid.typeName} onClick={() => onMutaplasmid(mutaplasmid)} />
          ))}
        </div>
      )}
      {!loading && state.mode === "spool" && spool && spoolMax >= spoolMin && (
        <div>
          {Array.from({ length: spoolMax - spoolMin + 1 }, (_, i) => spoolMin + i).map((cycles) => (
            <TouchRow
              key={cycles}
              title={`${cycles}`}
              subtitle={cycles === spoolMax ? "max spool" : undefined}
              right={cycles === spoolCurrent ? <span className="text-[11px] uppercase tracking-widest text-[#8bd3ff]">set</span> : undefined}
              onClick={() => onSpool(cycles)}
            />
          ))}
        </div>
      )}
      {!loading && (state.mode === "moduleSkills" || state.mode === "shipSkills") && (
        <div>
          {skillOverrideCount > 0 && (
            <TouchRow
              icon={<AlertTriangle size={12} className="text-yellow-300" />}
              title={`${skillOverrideCount} skill${skillOverrideCount === 1 ? "" : "s"} overridden`}
              subtitle="Clear all session-only skill overrides"
              right={<span className="text-[#ffb4a6]">Clear</span>}
              onClick={onClearSkillOverrides}
            />
          )}
          {skillLoading[skillModeKind || "module"] && (
            <div className="flex min-h-12 items-center justify-center gap-2 text-[12px] text-slate-500">
              <Loader2 size={14} className="animate-spin" /> Loading skills
            </div>
          )}
          {skillModeKind && skillError[skillModeKind] && (
            <div className="px-3 py-4 text-[12px] text-red-300">{skillError[skillModeKind]}</div>
          )}
          {skillModeKind && !skillLoading[skillModeKind] && !skillError[skillModeKind] && affectedSkills[skillModeKind].length === 0 && (
            <div className="px-3 py-4 text-[12px] text-slate-600">No affecting skills found.</div>
          )}
          {skillModeKind && affectedSkills[skillModeKind].map((skill) => (
            <TouchRow
              key={skill.skillTypeId}
              title={skill.skillName}
              subtitle={skillRowSubtitle(skill)}
              right={<span className={skill.hasOverride ? "text-yellow-300" : "text-slate-500"}>{skill.hasOverride ? skillLevelLabel(skill.overrideLevel ?? null) : skillLevelLabel(skill.currentLevel)} <ChevronRight size={12} className="inline" /></span>}
              onClick={() => openSkillLevels(skillModeKind, skill)}
            />
          ))}
        </div>
      )}
      {!loading && state.mode === "skillLevels" && selectedSkill && (
        <div>
          <div className="border-b border-[#151922] bg-[#090d13] px-3 py-2">
            <div className="text-[11px] font-semibold text-slate-100">{selectedSkill.skillName}</div>
            {skillRowSubtitle(selectedSkill) && (
              <div className="font-mono text-[10px] text-slate-500">{skillRowSubtitle(selectedSkill)}</div>
            )}
          </div>
          <TouchRow
            title="Use profile level"
            subtitle={`Return to ${skillLevelLabel(selectedSkill.currentLevel)}`}
            right={!selectedSkill.hasOverride ? <span className="text-[#8bd3ff]">set</span> : undefined}
            onClick={() => applySkillLevel(null)}
          />
          {[-1, 0, 1, 2, 3, 4, 5].map((level) => {
            const selected = selectedSkill.hasOverride && Number(selectedSkill.overrideLevel) === level;
            return (
              <TouchRow
                key={level}
                title={skillLevelLabel(level)}
                subtitle={level === -1 ? "Treat as not learned" : undefined}
                right={selected ? <span className="text-[#8bd3ff]">set</span> : undefined}
                onClick={() => applySkillLevel(level)}
              />
            );
          })}
        </div>
      )}
    </BottomSheet>
  );
}

function MobileCharacterActionSheet({
  state,
  loading,
  variants,
  implantSets,
  onMode,
  onClose,
  onRemove,
  onVariant,
  onApplySet,
  onShowInfo,
}: {
  state: NonNullable<CharacterSheetState>;
  loading: boolean;
  variants: SearchResult[];
  implantSets: ImplantSet[];
  onMode: (mode: CharacterSheetMode, setKey?: string | null) => void;
  onClose: () => void;
  onRemove: () => void;
  onVariant: (variant: SearchResult) => void;
  onApplySet: (grade: ImplantSetGrade) => void;
  onShowInfo: (typeId: number, typeName?: string) => void;
}) {
  const activeSet = implantSets.find((set) => set.key === state.openSetKey);
  const groupedVariants = useMemo(() => {
    const groups = new Map<string, SearchResult[]>();
    for (const variant of variants) {
      const label = variant.variantGroup || variant.metaGroupName || variant.groupName || "Variants";
      groups.set(label, [...(groups.get(label) || []), variant]);
    }
    return Array.from(groups.entries());
  }, [variants]);
  return (
    <BottomSheet
      title={state.item.typeName || (state.kind === "implants" ? "Implant" : "Booster")}
      subtitle={`Slot ${additionSlot(state.kind, state.item) ?? "?"}`}
      leading={<IconImage typeId={state.item.typeId} className="h-8 w-8" />}
      onClose={onClose}
    >
      {state.mode !== "actions" && (
        <button type="button" className="flex min-h-10 items-center gap-2 border-b border-[#151922] px-3 text-[12px] text-slate-400" onClick={() => onMode("actions", null)}>
          <ChevronLeft size={15} /> Back
        </button>
      )}
      {loading && <div className="flex min-h-12 items-center justify-center gap-2 text-[12px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading</div>}
      {!loading && state.mode === "actions" && (
        <div>
          <div className="border-b border-[#151922] px-3 py-2 text-[11px] text-slate-500">Slot {additionSlot(state.kind, state.item) ?? "?"}</div>
          <TouchRow title="Show Info" subtitle={`typeID ${state.item.typeId}`} onClick={() => onShowInfo(state.item.typeId, state.item.typeName)} />
          <TouchRow title="Variants" subtitle={`${variants.length} available`} right={<ChevronRight size={14} />} onClick={() => onMode("variants")} />
          {state.kind === "implants" && <TouchRow title="Apply Implant Set" subtitle={`${implantSets.length} families`} right={<ChevronRight size={14} />} onClick={() => onMode("sets")} />}
          <TouchRow icon={<Trash2 size={12} className="text-red-300" />} title={state.kind === "implants" ? "Remove Implant" : "Remove Booster"} danger onClick={onRemove} />
        </div>
      )}
      {!loading && state.mode === "variants" && (
        <div>
          {groupedVariants.map(([label, rows]) => (
            <div key={label}>
              <div className="border-b border-[#151922] bg-[#090d13] px-3 py-1 text-[9px] uppercase tracking-widest text-slate-600">{label}</div>
              {rows.map((variant) => <TouchRow key={variant.typeId} icon={<IconImage typeId={variant.typeId} className="h-7 w-7" />} title={variant.typeName} subtitle={`Slot ${state.kind === "implants" ? variant.implantSlot ?? variant.slot ?? "?" : variant.boosterSlot ?? variant.slot ?? "?"}`} onClick={() => onVariant(variant)} />)}
            </div>
          ))}
        </div>
      )}
      {!loading && state.mode === "sets" && (
        <div>
          {implantSets.map((set) => <TouchRow key={set.key} title={set.label} subtitle={`${set.grades.length} grades`} right={<ChevronRight size={14} />} onClick={() => onMode("setGrades", set.key)} />)}
        </div>
      )}
      {!loading && state.mode === "setGrades" && activeSet && (
        <div>
          <div className="border-b border-[#151922] bg-[#090d13] px-3 py-1 text-[9px] uppercase tracking-widest text-slate-600">{activeSet.label}</div>
          {activeSet.grades.map((grade) => <TouchRow key={grade.key} title={grade.label} subtitle={`${grade.items.length} slots`} onClick={() => onApplySet({ ...grade, familyLabel: activeSet.label })} />)}
        </div>
      )}
    </BottomSheet>
  );
}

function mobileItemMarketPath(item: NonNullable<MobileItemInfoPayload["item"]>) {
  const path = item.market_group_path?.map((entry) => entry.name).filter(Boolean) || [];
  if (path.length) return path.join(" > ");
  return item.market_group?.name || "";
}

function plainItemDescription(value: string | null | undefined) {
  if (!value) return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function formatMobileItemNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: 4 }) : String(value ?? "-");
}

function mobileTraitPrefix(bonus: { bonus: number | null; unit: string | null }) {
  if (bonus.bonus == null) return "";
  return `${formatMobileItemNumber(bonus.bonus)}${bonus.unit ? ` ${bonus.unit}` : ""}`;
}

function MobileTraitLine({ bonus }: { bonus: { bonus: number | null; unit: string | null; text: string } }) {
  const prefix = mobileTraitPrefix(bonus);
  return (
    <div className="text-[11px] leading-5 text-slate-300">
      {prefix && <span className="font-mono text-[#f1c26d]">{prefix}</span>} {bonus.text}
    </div>
  );
}

function MobileItemInfoSheet({ target, onClose }: { target: NonNullable<ItemInfoTarget>; onClose: () => void }) {
  const [payload, setPayload] = useState<MobileItemInfoPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    triffApiFetch(`/api/items/${target.typeId}`, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(response.status === 404 ? "Item not found" : `HTTP ${response.status}`);
        return response.json() as Promise<MobileItemInfoPayload>;
      })
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Item failed to load");
        setPayload(data);
      })
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError") return;
        setPayload(null);
        setError((err as Error).message || "Item failed to load");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [target.typeId]);

  const item = payload?.item;
  const traits = payload?.traits;
  const hasTraits = !!traits && (traits.types.length > 0 || traits.roleBonuses.length > 0 || traits.miscBonuses.length > 0);
  const description = plainItemDescription(item?.description);
  const attributes = (payload?.dogma || [])
    .filter((row) => row.display_name && row.value != null)
    .slice(0, ITEM_INFO_ATTRIBUTE_LIMIT);

  function openFullItemPage(event: MouseEvent<HTMLAnchorElement>) {
    if (!isNativeRuntime()) return;
    event.preventDefault();
    void openTriffExternalUrl(`/items/${item?.type_id || target.typeId}`);
  }

  return (
    <BottomSheet
      title="Show Info"
      subtitle={`${item?.name || target.typeName || `Type ${target.typeId}`} - typeID ${target.typeId}`}
      leading={<IconImage typeId={target.typeId} className="h-8 w-8" />}
      onClose={onClose}
    >
      {loading && <div className="flex min-h-24 items-center justify-center gap-2 text-[12px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading item info</div>}
      {!loading && error && <div className="m-3 border border-[#6b2b32] bg-[#1d090b] p-3 text-[12px] text-[#ffaaaa]">{error}</div>}
      {!loading && item && (
        <div className="space-y-2 p-2">
          <div className="grid grid-cols-[54px,1fr] gap-2 border border-[#20242c] bg-[#05070b] p-2">
            <IconImage typeId={item.type_id} className="h-12 w-12" />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-100">{item.name}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {[item.category?.name, item.group?.name].filter(Boolean).map((label) => (
                  <span key={label} className="border border-[#303236] bg-[#070910] px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-400">{label}</span>
                ))}
              </div>
              {mobileItemMarketPath(item) && <div className="mt-1 truncate font-mono text-[9px] text-slate-600">{mobileItemMarketPath(item)}</div>}
            </div>
          </div>

          {description && (
            <section className="border border-[#20242c] bg-[#05070b]">
              <div className="border-b border-[#20242c] bg-[#101219] px-2 py-1 text-[9px] uppercase tracking-widest text-[#8bd3ff]">Description</div>
              <p className="max-h-32 overflow-y-auto whitespace-pre-wrap px-2 py-2 text-[11px] leading-5 text-slate-300">{description}</p>
            </section>
          )}

          {hasTraits && (
            <section className="border border-[#20242c] bg-[#05070b]">
              <div className="border-b border-[#20242c] bg-[#101219] px-2 py-1 text-[9px] uppercase tracking-widest text-[#8bd3ff]">Traits</div>
              <div className="space-y-2 p-2">
                {traits.types.map((entry) => (
                  <div key={entry.skill_type_id} className="border border-[#252832] bg-[#070910] p-2">
                    <div className="mb-1 text-[11px] font-semibold text-[#f1c26d]">
                      {entry.skill_name || `Skill ${entry.skill_type_id}`} <span className="font-normal text-slate-500">per level</span>
                    </div>
                    {entry.bonuses.map((bonus, index) => <MobileTraitLine key={`${entry.skill_type_id}-${index}`} bonus={bonus} />)}
                  </div>
                ))}
                {!!traits.roleBonuses.length && (
                  <div className="border border-[#252832] bg-[#070910] p-2">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-200">Role Bonuses</div>
                    {traits.roleBonuses.map((bonus, index) => <MobileTraitLine key={`role-${index}`} bonus={bonus} />)}
                  </div>
                )}
                {!!traits.miscBonuses.length && (
                  <div className="border border-[#252832] bg-[#070910] p-2">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-200">Misc Bonuses</div>
                    {traits.miscBonuses.map((bonus, index) => <MobileTraitLine key={`misc-${index}`} bonus={bonus} />)}
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="border border-[#20242c] bg-[#05070b]">
            <div className="flex items-center justify-between border-b border-[#20242c] bg-[#101219] px-2 py-1">
              <span className="text-[9px] uppercase tracking-widest text-[#8bd3ff]">Attributes</span>
              <span className="font-mono text-[9px] text-slate-600">{attributes.length}</span>
            </div>
            {attributes.length ? (
              <div className="divide-y divide-[#151922]">
                {attributes.map((row) => (
                  <div key={row.attribute_id} className="grid grid-cols-[1fr,92px] gap-2 px-2 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-slate-300">{row.display_name}</div>
                      {row.name && <div className="truncate font-mono text-[8px] text-slate-700">attr {row.attribute_id}</div>}
                    </div>
                    <div className="self-center truncate text-right font-mono text-[10px] text-slate-100" title={String(row.display_value ?? row.value ?? "")}>
                      {row.display_value || formatMobileItemNumber(row.value)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-2 py-3 text-[11px] text-slate-600">No local attributes imported for this type.</div>
            )}
          </section>

          <a
            href={triffToolsUrl(`/items/${item.type_id}`)}
            target="_blank"
            rel="noreferrer"
            className={`${primaryClass} w-full`}
            onClick={openFullItemPage}
          >
            Open Full Item Page
          </a>
        </div>
      )}
    </BottomSheet>
  );
}

function MobileAdditionsView({
  active,
  onActive,
  fit,
  stats,
  onRemove,
  onDroneActive,
  onDroneQuantity,
  onCargoQuantity,
  onFighterActive,
  onToggleCharacterItem,
  onCharacterAction,
}: {
  active: AdditionTab;
  onActive: (tab: AdditionTab) => void;
  fit: FitPayload;
  stats: FittingStats | null;
  onRemove: (key: "drones" | "fighters" | "cargo" | "implants" | "boosters", index: number) => void;
  onDroneActive: (index: number, active: number) => void;
  onDroneQuantity: (index: number, quantity: number) => void;
  onCargoQuantity: (index: number, quantity: number) => void;
  onFighterActive: (index: number, active: number) => void;
  onToggleCharacterItem: (key: "implants" | "boosters", index: number, enabled: boolean) => void;
  onCharacterAction: (kind: "implants" | "boosters", index: number, item: QuantityItem) => void;
}) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const activeLabel = additionTabs.find((tab) => tab.key === active)?.label || "Drones";
  const activeCount =
    active === "notes"
      ? ""
      : String((fit[active as "drones" | "fighters" | "cargo" | "implants" | "boosters"] || []).length);
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1fr,auto] items-center border border-[#2c2f36] bg-[#070910]">
        <button
          type="button"
          className="grid min-h-9 grid-cols-[auto,1fr,auto] items-center gap-1.5 bg-[#05070b] px-2 text-left active:bg-[#101721]"
          onClick={() => setSelectorOpen(true)}
        >
          <span className="text-[9px] uppercase tracking-widest text-slate-500">Additions</span>
          <span className="truncate text-[12px] uppercase tracking-widest text-[#8bd3ff]">{activeLabel}</span>
          <ChevronRight size={13} className="text-slate-500" />
        </button>
        <div className="border-l border-[#2c2f36] px-2 font-mono text-[10px] text-slate-600">
          {activeCount}
        </div>
      </div>
      {selectorOpen && (
        <BottomSheet title="Additions" subtitle="Choose section" onClose={() => setSelectorOpen(false)}>
          <div className="divide-y divide-[#151922]">
            {additionTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`grid min-h-9 w-full grid-cols-[22px,1fr] items-center gap-1.5 px-2 text-left ${
                  active === tab.key ? "bg-[#101721] text-[#8bd3ff]" : "bg-[#070910] text-slate-200"
                }`}
                onClick={() => {
                  onActive(tab.key);
                  setSelectorOpen(false);
                }}
              >
                <ActionGlyph label={active === tab.key ? ">" : ""} />
                <span className="text-[11px] uppercase tracking-widest">{tab.label}</span>
              </button>
            ))}
          </div>
        </BottomSheet>
      )}
      <section className="border border-[#2c2f36] bg-[#070910]">
        {active === "drones" && <QuantityRows kind="drones" items={fit.drones} rows={stats?.droneRows || []} onRemove={onRemove} onActive={onDroneActive} onQuantity={onDroneQuantity} />}
        {active === "fighters" && <QuantityRows kind="fighters" items={fit.fighters} rows={stats?.fighterRows || []} onRemove={onRemove} onActive={onFighterActive} />}
        {active === "cargo" && <SimpleItemRows kind="cargo" items={fit.cargo} onRemove={onRemove} onQuantity={onCargoQuantity} />}
        {active === "implants" && <CharacterItemRows kind="implants" items={fit.implants} onRemove={onRemove} onToggleEnabled={onToggleCharacterItem} onAction={onCharacterAction} />}
        {active === "boosters" && <CharacterItemRows kind="boosters" items={fit.boosters} onRemove={onRemove} onToggleEnabled={onToggleCharacterItem} onAction={onCharacterAction} />}
        {active === "notes" && <textarea className="h-60 w-full resize-none bg-[#05070b] p-3 text-[13px] text-slate-100 outline-none" placeholder="Fit notes" />}
      </section>
    </div>
  );
}

function QuantityRows({
  kind,
  items,
  rows,
  onRemove,
  onActive,
  onQuantity,
}: {
  kind: "drones" | "fighters";
  items: QuantityItem[];
  rows: QuantityItem[];
  onRemove: (key: "drones" | "fighters" | "cargo" | "implants" | "boosters", index: number) => void;
  onActive: (index: number, active: number) => void;
  onQuantity?: (index: number, quantity: number) => void;
}) {
  if (!items.length) return <div className="p-3 text-[12px] text-slate-600">No {kind}</div>;
  return (
    <div className="divide-y divide-[#151922]">
      {items.map((item, index) => {
        const row = rows.find((entry) => entry.typeId === item.typeId);
        const owned = quantity(item.quantity);
        const active = Math.max(0, Number(item.active ?? item.quantity ?? 0));
        return (
          <div key={`${item.typeId}-${index}`} className="grid grid-cols-[32px,1fr,86px] gap-1.5 px-2 py-1.5">
            <IconImage typeId={item.typeId} className="h-7 w-7" />
            <div className="min-w-0">
              <div className="truncate text-[12px] text-slate-100">{item.typeName}</div>
              <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
                {kind === "drones" && onQuantity ? (
                  <>
                    <span>Bay</span>
                    <input
                      type="number"
                      min={1}
                      value={owned}
                      className="h-6 w-12 border border-[#303236] bg-[#05070b] px-1 text-right text-[10px] text-slate-200 outline-none focus:border-[#53b6ff]"
                      title="Drones in bay"
                      onChange={(event) => {
                        const next = Math.floor(Number(event.target.value));
                        if (Number.isFinite(next) && next > 0) onQuantity(index, next);
                      }}
                    />
                  </>
                ) : (
                  <span>Bay x{owned}</span>
                )}
                <span>DPS {fmt(row?.dps, 1)}</span>
              </div>
            </div>
            <div className="flex items-center justify-end gap-1">
              <button className="h-8 w-8 border border-[#303236] bg-[#05070b] text-slate-300" onClick={() => onActive(index, active - 1)}>-</button>
              <span className="w-6 text-center font-mono text-[11px]">{active}</span>
              <button className="h-8 w-8 border border-[#303236] bg-[#05070b] text-slate-300" onClick={() => onActive(index, active + 1)}>+</button>
              <button className="h-8 w-8 text-red-300" onClick={() => onRemove(kind, index)}><X size={15} /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SimpleItemRows({
  kind,
  items,
  onRemove,
  onQuantity,
}: {
  kind: "cargo";
  items: QuantityItem[];
  onRemove: (key: "drones" | "fighters" | "cargo" | "implants" | "boosters", index: number) => void;
  onQuantity: (index: number, quantity: number) => void;
}) {
  if (!items.length) return <div className="p-3 text-[12px] text-slate-600">No cargo</div>;
  return (
    <div className="divide-y divide-[#151922]">
      {items.map((item, index) => (
        <div key={`${item.typeId}-${index}`} className="grid grid-cols-[32px,1fr,58px,32px] items-center gap-1.5 px-2 py-1.5">
          <IconImage typeId={item.typeId} className="h-7 w-7" />
          <div className="truncate text-[12px] text-slate-100">{item.typeName}</div>
          <CargoQuantityInput
            quantity={quantity(item.quantity)}
            onQuantity={(next) => onQuantity(index, next)}
            className="h-7 w-14 border border-[#303236] bg-[#05070b] px-1 text-right font-mono text-[11px] text-slate-200 outline-none focus:border-[#53b6ff]"
            ariaLabel={`${item.typeName || `Type ${item.typeId}`} cargo quantity`}
          />
          <button className="h-8 w-8 text-red-300" onClick={() => onRemove(kind, index)}><X size={15} /></button>
        </div>
      ))}
    </div>
  );
}

function CharacterItemRows({
  kind,
  items,
  onRemove,
  onToggleEnabled,
  onAction,
}: {
  kind: "implants" | "boosters";
  items: QuantityItem[];
  onRemove: (key: "drones" | "fighters" | "cargo" | "implants" | "boosters", index: number) => void;
  onToggleEnabled: (key: "implants" | "boosters", index: number, enabled: boolean) => void;
  onAction: (kind: "implants" | "boosters", index: number, item: QuantityItem) => void;
}) {
  const sorted = items
    .map((item, index) => ({ item, index, slot: additionSlot(kind, item) }))
    .sort((a, b) => Number(a.slot || 999) - Number(b.slot || 999) || (a.item.typeName || "").localeCompare(b.item.typeName || ""));
  if (!items.length) return <div className="p-3 text-[12px] text-slate-600">No {kind}</div>;
  return (
    <div className="divide-y divide-[#151922]">
      {sorted.map(({ item, index, slot }) => {
        const enabled = item.enabled !== false;
        return (
          <div key={`${item.typeId}-${index}`} className={`grid grid-cols-[46px,32px,1fr,42px,36px,32px] items-center gap-1.5 px-2 py-1.5 ${enabled ? "" : "opacity-55"}`}>
            <div className="font-mono text-[10px] text-slate-500">Slot {slot ?? "?"}</div>
            <IconImage typeId={item.typeId} className="h-7 w-7" />
            <div className="truncate text-[12px] text-slate-100">{item.typeName}</div>
            <button
              type="button"
              aria-pressed={enabled}
              title={enabled ? "Disable without removing" : "Enable"}
              className={`inline-flex h-7 w-10 items-center justify-center gap-1 border bg-[#05070b] font-mono text-[8px] uppercase tracking-[0.12em] active:bg-[#101721] ${
                enabled ? "border-[#48677a] text-[#8bd3ff] shadow-[inset_0_0_0_1px_rgba(83,182,255,0.08)]" : "border-[#303236] text-slate-600"
              }`}
              onClick={() => onToggleEnabled(kind, index, !enabled)}
            >
              <span className={`h-3 w-px ${enabled ? "bg-[#53b6ff]" : "bg-slate-700"}`} />
              <span>{enabled ? "On" : "Off"}</span>
            </button>
            <button className="h-8 w-8 text-slate-300" onClick={() => onAction(kind, index, item)}><MoreVertical size={16} /></button>
            <button className="h-8 w-8 text-red-300" onClick={() => onRemove(kind, index)}><X size={15} /></button>
          </div>
        );
      })}
    </div>
  );
}

function MobileProjectedView({
  fit,
  stats,
  projectedLinks,
  sourceFits,
  onAddEffect,
  onRemoveEffect,
  onAddSource,
  onToggleSource,
  onRemoveSource,
}: {
  fit: FitPayload;
  stats: FittingStats | null;
  projectedLinks: ProjectedFitLink[];
  sourceFits: CrossFitSourceSummary[];
  onAddEffect: (effect: EnvironmentEffect) => void;
  onRemoveEffect: (index: number) => void;
  onAddSource: (sourceTabId: string) => void;
  onToggleSource: (linkId: string, enabled: boolean) => void;
  onRemoveSource: (linkId: string) => void;
}) {
  return (
    <div className="space-y-2">
      <section className="border border-[#2c2f36] bg-[#070910] p-1.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-widest text-slate-400">Environmental Effects</div>
          <EnvironmentEffectMenu onSelect={onAddEffect} buttonLabel="Add Effect" mobileSheet />
        </div>
        {!fit.projectedEffects.length ? <div className="text-[11px] text-slate-600">No environmental effects</div> : fit.projectedEffects.map((effect, index) => (
          <div key={`${effect.effectId}-${index}`} className="mb-1 grid min-h-9 grid-cols-[1fr,32px] items-center border border-[#151922] bg-[#05070b] px-2">
            <div className="min-w-0">
              <div className="truncate text-[11px] text-slate-100">{effect.label}</div>
              <div className="truncate text-[10px] text-slate-500">{effect.categoryLabel || effect.category}</div>
            </div>
            <button className="h-8 w-8 text-red-300" onClick={() => onRemoveEffect(index)}><X size={15} /></button>
          </div>
        ))}
      </section>
      <section className="border border-[#2c2f36] bg-[#070910] p-1.5">
        <div className="mb-1.5 text-[10px] uppercase tracking-widest text-slate-400">Projected Fits</div>
        <SourceFitPicker label="Add Open Fit Projection" sources={sourceFits} onAdd={onAddSource} />
        <div className="mt-1.5 divide-y divide-[#151922] border border-[#151922]">
          {!projectedLinks.length ? <div className="p-2 text-[11px] text-slate-600">No projected fit sources</div> : projectedLinks.map((link) => {
            const source = sourceFits.find((entry) => entry.tabId === link.sourceTabId);
            const result = stats?.crossFit?.projectedSources?.find((entry) => entry.id === link.id);
            return (
              <div key={link.id} className="grid min-h-10 grid-cols-[24px,1fr,32px] items-center gap-1.5 px-2">
                <input type="checkbox" checked={link.enabled} onChange={(event) => onToggleSource(link.id, event.target.checked)} />
                <div className="min-w-0">
                  <div className="truncate text-[11px] text-slate-100">{source?.fitName || result?.fitName || "Missing source"}{source?.dirty ? " *" : ""}</div>
                  <div className="truncate text-[10px] text-slate-500">{source?.shipName || result?.shipName || "Open fit source"} · {result?.appliedEffects?.length || 0} effects</div>
                </div>
                <button className="h-8 w-8 text-red-300" onClick={() => onRemoveSource(link.id)}><X size={15} /></button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function MobileCommandView({
  commandLinks,
  sourceFits,
  commandBurstsBySource,
  stats,
  onAddSource,
  onToggleSource,
  onToggleBurst,
  onRemoveSource,
}: {
  commandLinks: CommandFitLink[];
  sourceFits: CrossFitSourceSummary[];
  commandBurstsBySource: Record<string, CommandBurstSelection[]>;
  stats: FittingStats | null;
  onAddSource: (sourceTabId: string) => void;
  onToggleSource: (linkId: string, enabled: boolean) => void;
  onToggleBurst: (linkId: string, sourceModuleInstanceId: string, enabled: boolean) => void;
  onRemoveSource: (linkId: string) => void;
}) {
  return (
    <section className="border border-[#2c2f36] bg-[#070910] p-1.5">
      <div className="mb-1.5 text-[10px] uppercase tracking-widest text-slate-400">Command Sources</div>
      <SourceFitPicker label="Add Open Fit Command Source" sources={sourceFits} onAdd={onAddSource} />
      <div className="mt-1.5 divide-y divide-[#151922] border border-[#151922]">
        {!commandLinks.length ? <div className="p-2 text-[11px] text-slate-600">No command sources</div> : commandLinks.map((link) => {
          const source = sourceFits.find((entry) => entry.tabId === link.sourceTabId);
          const bursts = commandBurstsBySource[link.sourceTabId] || [];
          const result = stats?.crossFit?.commandSources?.find((entry) => entry.id === link.id);
          return (
            <div key={link.id} className="p-1.5">
              <div className="mb-1 grid min-h-9 grid-cols-[24px,1fr,32px] items-center gap-1.5">
                <input type="checkbox" checked={link.enabled} onChange={(event) => onToggleSource(link.id, event.target.checked)} />
                <div className="min-w-0">
                  <div className="truncate text-[11px] text-slate-100">{source?.fitName || result?.fitName || "Missing source"}{source?.dirty ? " *" : ""}</div>
                  <div className="truncate text-[10px] text-slate-500">{source?.shipName || result?.shipName || "Open fit source"}</div>
                </div>
                <button className="h-8 w-8 text-red-300" onClick={() => onRemoveSource(link.id)}><X size={15} /></button>
              </div>
              {!bursts.length ? <div className="pl-7 text-[11px] text-slate-600">No command bursts found on this fit.</div> : bursts.map((burst) => {
                const selected = link.selectedBursts.find((entry) => entry.sourceModuleInstanceId === burst.sourceModuleInstanceId);
                const enabled = selected?.enabled ?? false;
                return (
                  <label key={burst.sourceModuleInstanceId} className="grid min-h-10 grid-cols-[26px,28px,1fr] items-center gap-2 border-t border-[#10141c] text-[11px]">
                    <input type="checkbox" checked={enabled} onChange={(event) => onToggleBurst(link.id, burst.sourceModuleInstanceId, event.target.checked)} />
                    <IconImage typeId={burst.moduleTypeId} className="h-6 w-6" />
                    <span className="min-w-0">
                      <span className="block truncate text-slate-200">{burst.moduleName || "Command Burst"}</span>
                      <span className="block truncate text-slate-500">{burst.chargeTypeName || "No charge loaded"}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
