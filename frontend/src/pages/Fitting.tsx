/*
 * Web-native EVE fitting workbench backed by Pyfa/eos through /api/fitting.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ClipboardPaste, Link2, Loader2, Save, Upload, X } from "lucide-react";
import AdditionsPanel from "../components/fitting/AdditionsPanel";
import FittingHelpModal from "../components/fitting/FittingHelpModal";
import FittingItemInfoModal from "../components/fitting/FittingItemInfoModal";
import type { FittingItemInfoTarget } from "../components/fitting/FittingItemInfoModal";
import FittingGraphsPanel, { type GraphPanelState } from "../components/fitting/FittingGraphsPanel";
import FittingStatsPanel from "../components/fitting/FittingStatsPanel";
import FittingTable from "../components/fitting/FittingTable";
import InGameFittingsImportModal from "../components/fitting/InGameFittingsImportModal";
import ImportFitModal from "../components/fitting/ImportFitModal";
import ModuleBrowser from "../components/fitting/ModuleBrowser";
import ModuleContextMenu from "../components/fitting/ModuleContextMenu";
import MutationEditorModal from "../components/fitting/MutationEditorModal";
import { addCargoStack, setCargoStackQuantity } from "../components/fitting/cargo";
import { FILLABLE_RACKS, moduleForRackFill, rackFillBlocker } from "../components/fitting/moduleFill";
import { readFittingWorkspaceSnapshot, writeFittingWorkspaceSnapshot } from "../components/fitting/workspaceMemory";
import {
  requestSiteAuthModal,
  SITE_AUTH_CHANGED_EVENT,
  type SiteAuthChangeDetail,
} from "../auth/siteAuthEvents";
import MobileFittingPage from "./FittingMobile";
import fittingIconRaw from "../assets/icons/fitting.svg?raw";
import type {
  AuthUser,
  CalculationResponse,
  ChargeResult,
  CommandBurstSelection,
  CommandFitLink,
  CustomSavedFitGroup,
  CrossFitSourceSummary,
  DamageProfileSelection,
  EnvironmentEffect,
  FitMessage,
  FitPayload,
  FittingModule,
  FittingStats,
  HardpointKind,
  LinkedEsiCharacter,
  ModuleMutation,
  ModuleRowRef,
  MutaplasmidResult,
  ImplantSetGrade,
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
import { emptyFit, ensureFitPayload, SLOT_ORDER } from "../components/fitting/types";

const panelBase = "border border-[#2c2f36] bg-[#070910]";
const inputClass =
  "bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] text-slate-100 placeholder-slate-600 outline-none focus:border-[#53b6ff] focus:ring-0";
const buttonBase =
  "inline-flex h-7 items-center justify-center gap-1 border border-[#303236] bg-[#05070b] px-2 text-[10px] uppercase tracking-widest text-slate-300 hover:border-[#53b6ff]/60 hover:bg-[#101219] disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton =
  "inline-flex h-7 items-center justify-center gap-1 px-2.5 text-[10px] font-semibold uppercase tracking-widest bg-gradient-to-b from-[#1b8cc8] to-[#14608a] border border-[#46b2ff]/70 shadow-[0_0_10px_rgba(70,178,255,0.35)] hover:from-[#27a0df] hover:to-[#1672a4] disabled:opacity-60 disabled:cursor-not-allowed";

type EveUiIconDef = { markup: string };

function makeEveUiIcon(svg: string): EveUiIconDef {
  return {
    markup: svg.replace(/^\s*<symbol\b[^>]*>/, "").replace(/<\/symbol>\s*$/, ""),
  };
}

const fittingUiIcon = makeEveUiIcon(fittingIconRaw);

function EveUiIcon({ icon, className = "h-4 w-4" }: { icon: EveUiIconDef; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 128 128" className={`inline-block shrink-0 ${className}`}>
      <style>{".shape{fill:currentColor}"}</style>
      <g dangerouslySetInnerHTML={{ __html: icon.markup }} />
    </svg>
  );
}

type ContextMenuState = {
  x: number;
  y: number;
  slot: SlotKey;
  index: number;
  module: FittingModule;
  targetKeys: string[];
} | null;

type MutationEditorState = {
  slot: SlotKey;
  index: number;
  module: FittingModule;
  mutation: ModuleMutation;
} | null;

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

type CenterViewMode = "fitting" | "graphs";

type GraphUiState = {
  viewMode: CenterViewMode;
  graphState: GraphPanelState | null;
};

type SubsystemKind = "core" | "defense" | "offense" | "propulsion";

type ImportedFitResponse = {
  ok: boolean;
  payload: FitPayload;
  warnings?: FitMessage[];
  errors?: FitMessage[];
  calculation?: CalculationResponse;
  sharedFit?: {
    id: string;
    url: string;
    fitName?: string;
    shipName?: string;
  };
  inGameFitting?: {
    fittingId: number;
    name?: string;
    shipTypeName?: string;
  };
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

function eveIcon(typeId: number) {
  return `https://images.evetech.net/types/${typeId}/icon?size=64`;
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

function fitShipName(fit: FitPayload) {
  return fit.shipTypeName || (fit.shipTypeId ? `Type ${fit.shipTypeId}` : null);
}

function skillProfileKey(profile?: SkillProfile | null) {
  if (profile?.mode === "alpha_clone") return "alpha_clone";
  return profile?.mode === "esi_character" ? `esi:${profile.characterId}` : "all_v";
}

function skillProfileLabel(profile?: SkillProfile | null) {
  if (profile?.mode === "alpha_clone") return "All Alpha Skills";
  return profile?.mode === "esi_character" ? profile.characterName || `Character ${profile.characterId}` : "All V Skills";
}

function relativeTime(value?: string | null) {
  if (!value) return "not synced";
  const age = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(age)) return "not synced";
  const minutes = Math.max(0, Math.round(age / 60000));
  if (minutes < 1) return "synced just now";
  if (minutes < 60) return `synced ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `synced ${hours}h ago`;
  return `synced ${Math.round(hours / 24)}d ago`;
}

function isTrustedSsoOrigin(origin: string) {
  try {
    if (origin === window.location.origin) return true;
    const messageUrl = new URL(origin);
    const currentHost = window.location.hostname;
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (localHosts.has(currentHost) && localHosts.has(messageUrl.hostname)) return true;
    const triffHosts = new Set(["triff.tools", "www.triff.tools", "dev.triff.tools"]);
    return triffHosts.has(currentHost) && triffHosts.has(messageUrl.hostname);
  } catch {
    return false;
  }
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

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.message || data?.errors?.[0]?.message || data?.error || "request_failed");
  }
  return data as T;
}

function normalizeType(raw: SearchResult): SearchResult {
  return {
    ...raw,
    typeId: Number(raw.typeId),
  };
}

function itemName(item: { typeName?: string; typeId: number }) {
  return item.typeName || `Type ${item.typeId}`;
}

function allModuleTypeIds(fit: FitPayload) {
  const ids = new Set<number>();
  for (const slot of SLOT_ORDER) {
    for (const module of fit.modules[slot]) {
      if (module.typeId) ids.add(module.typeId);
      if (module.chargeTypeId) ids.add(module.chargeTypeId);
    }
  }
  return Array.from(ids).sort((a, b) => a - b);
}

function slotTotal(stats: FittingStats | null, slot: SlotKey) {
  const total = Number(stats?.slots?.[slot]?.total);
  return Number.isFinite(total) ? total : null;
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

function quantity(value: unknown, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function additionSlot(key: "implants" | "boosters", item: QuantityItem | SearchResult) {
  const value = key === "implants"
    ? item.implantSlot ?? item.slot
    : item.boosterSlot ?? item.slot;
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

    const next: QuantityItem = {
      ...item,
      typeName: item.typeName || source?.typeName,
      slot,
      ...(key === "implants" ? { implantSlot: slot } : { boosterSlot: slot }),
    };
    if (
      next.slot !== item.slot ||
      next.implantSlot !== item.implantSlot ||
      next.boosterSlot !== item.boosterSlot ||
      next.typeName !== item.typeName
    ) {
      changed = true;
    }
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
  if (implants === fit.implants && boosters === fit.boosters && !modeChanged && !damageProfileChanged) return fit;
  return { ...fit, implants, boosters, shipMode: calculatedMode, damageProfile: calculatedDamageProfile };
}

function moduleKey(slot: SlotKey, index: number) {
  return `${slot}:${index}`;
}

function moduleInstanceKey(module: FittingModule, slot: SlotKey, index: number) {
  return module.id || moduleKey(slot, index);
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

function parseModuleKey(key: string): { slot: SlotKey; index: number } | null {
  const [slot, rawIndex] = key.split(":");
  const index = Number(rawIndex);
  if (!SLOT_ORDER.includes(slot as SlotKey) || !Number.isInteger(index) || index < 0) return null;
  return { slot: slot as SlotKey, index };
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
  if (requested === "offline") {
    return {
      ...module,
      state: "offline",
      previousState: rememberedOnlineState(module),
    };
  }
  if (requested === "online") {
    const { previousState, ...rest } = module;
    return {
      ...rest,
      state: "online",
    };
  }
  if (requested === "active" || requested === "overheated") {
    const { previousState, ...rest } = module;
    return {
      ...rest,
      state: requested,
    };
  }
  return {
    ...module,
    state: requestedState,
  };
}

function useMobileFittingViewport() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return isMobile;
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

export default function Fitting() {
  const { sharedFitId } = useParams<{ sharedFitId?: string }>();
  return useMobileFittingViewport() ? <MobileFittingPage sharedFitId={sharedFitId} /> : <DesktopFittingPage sharedFitId={sharedFitId} />;
}

function DesktopFittingPage({ sharedFitId }: { sharedFitId?: string }) {
  const [searchParams] = useSearchParams();
  const deepLinkShipTypeId = useMemo(() => fittingDeepLinkTypeId(searchParams), [searchParams]);
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => readFittingWorkspaceSnapshot<WorkspaceState>(() => {
    const tab = makeWorkspaceTab(emptyFit());
    return { openFits: [tab], activeTabId: tab.tabId };
  }));
  const [calculating, setCalculating] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [modal, setModal] = useState<"import" | "export" | null>(null);
  const [inGameFitsOpen, setInGameFitsOpen] = useState(false);
  const [graphUiByTab, setGraphUiByTab] = useState<Record<string, GraphUiState>>({});
  const [skillOverridesByTab, setSkillOverridesByTab] = useState<Record<string, SkillOverrideMap>>({});
  const [eftText, setEftText] = useState("");
  const [exportText, setExportText] = useState("");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [typeDetails, setTypeDetails] = useState<Record<number, SearchResult>>({});
  const [selectedModuleKeys, setSelectedModuleKeys] = useState<Set<string>>(() => new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [itemInfoTarget, setItemInfoTarget] = useState<FittingItemInfoTarget | null>(null);
  const [fittingHelpOpen, setFittingHelpOpen] = useState(false);
  const [mutationEditor, setMutationEditor] = useState<MutationEditorState>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [pendingSaveAfterAuth, setPendingSaveAfterAuth] = useState(false);
  const [savedFitGroups, setSavedFitGroups] = useState<SavedFitGroup[]>([]);
  const [customSavedFitGroups, setCustomSavedFitGroups] = useState<CustomSavedFitGroup[]>([]);
  const [savedFitsLoading, setSavedFitsLoading] = useState(false);
  const [savedFitsError, setSavedFitsError] = useState<string | null>(null);
  const [savedFitFocus, setSavedFitFocus] = useState<SavedFitFocus | null>(null);
  const [linkedCharacters, setLinkedCharacters] = useState<LinkedEsiCharacter[]>([]);
  const [esiConfigured, setEsiConfigured] = useState(true);
  const [esiConfigMissing, setEsiConfigMissing] = useState<string[]>([]);
  const [esiBusy, setEsiBusy] = useState<string | null>(null);
  const [esiPending, setEsiPending] = useState(false);
  const [manageCharactersOpen, setManageCharactersOpen] = useState(false);
  const [pendingEsiLinkAfterAuth, setPendingEsiLinkAfterAuth] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const esiPendingKnownIds = useRef<Set<number>>(new Set());
  const handledDeepLinkShipTypeId = useRef<number | null>(null);
  const handledSharedFitId = useRef<string | null>(null);
  const previousAuthUserId = useRef<string | null>(null);

  useEffect(() => {
    writeFittingWorkspaceSnapshot(workspace);
  }, [workspace]);

  useEffect(() => {
    const openTabIds = new Set(workspace.openFits.map((tab) => tab.tabId));
    setGraphUiByTab((prev) => {
      let changed = false;
      const next: Record<string, GraphUiState> = {};
      for (const [tabId, state] of Object.entries(prev)) {
        if (openTabIds.has(tabId)) {
          next[tabId] = state;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
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
  const activeGraphUi = activeTab ? graphUiByTab[activeTab.tabId] : null;
  const centerView: CenterViewMode = activeGraphUi?.viewMode || "fitting";
  const activeGraphState = activeGraphUi?.graphState || null;
  const activeSkillOverrides = activeTab ? skillOverridesByTab[activeTab.tabId] || {} : {};
  const calculationFit = useMemo(() => fitWithSkillOverrides(fit, activeSkillOverrides), [fit, activeSkillOverrides]);
  const skillProfile = fit.skillProfile || { mode: "all_v" as const };
  const selectedLinkedCharacter = skillProfile.mode === "esi_character"
    ? linkedCharacters.find((character) => character.characterId === skillProfile.characterId) || null
    : null;
  const sourceFitOptions = useMemo<CrossFitSourceSummary[]>(() => (
    workspace.openFits
      .filter((tab) => tab.tabId !== workspace.activeTabId)
      .map((tab) => ({
        tabId: tab.tabId,
        fitName: tab.fitName || "New Fit",
        shipTypeId: tab.shipTypeId,
        shipName: tab.shipName,
        dirty: tab.dirty,
      }))
  ), [workspace.openFits, workspace.activeTabId]);
  const commandBurstsBySource = useMemo<Record<string, CommandBurstSelection[]>>(() => {
    const out: Record<string, CommandBurstSelection[]> = {};
    for (const tab of workspace.openFits) {
      if (tab.tabId === workspace.activeTabId) continue;
      out[tab.tabId] = commandBurstsForFit(tab.fitState, typeDetails);
    }
    return out;
  }, [workspace.openFits, workspace.activeTabId, typeDetails]);
  const graphOpenFitTargets = useMemo(() => (
    workspace.openFits
      .filter((tab) => tab.tabId !== workspace.activeTabId)
      .map((tab) => ({
        tabId: tab.tabId,
        fitName: tab.fitName || "New Fit",
        shipName: tab.shipName,
        dirty: tab.dirty,
        fitState: fitWithSkillOverrides(tab.fitState, skillOverridesByTab[tab.tabId]),
      }))
  ), [workspace.openFits, workspace.activeTabId, skillOverridesByTab]);
  const calculationRequest = useMemo(() => {
    const linkedSourceIds = new Set<string>();
    for (const link of projectedLinks) linkedSourceIds.add(link.sourceTabId);
    for (const link of commandLinks) linkedSourceIds.add(link.sourceTabId);
    const sourceFits = Array.from(linkedSourceIds)
      .map((tabId) => workspace.openFits.find((tab) => tab.tabId === tabId))
      .filter(Boolean)
      .map((tab) => ({
        tabId: tab!.tabId,
        fitName: tab!.fitName,
        shipName: tab!.shipName,
        dirty: tab!.dirty,
        fitState: fitWithSkillOverrides(tab!.fitState, skillOverridesByTab[tab!.tabId]),
      }));
    return {
      ...calculationFit,
      targetFit: calculationFit,
      sourceFits,
      projectedLinks,
      commandLinks,
    };
  }, [calculationFit, projectedLinks, commandLinks, workspace.openFits, skillOverridesByTab]);

  function updateActiveTab(mutator: (tab: OpenFitTab) => OpenFitTab) {
    setWorkspace((prev) => ({
      ...prev,
      openFits: prev.openFits.map((tab) => (tab.tabId === prev.activeTabId ? mutator(tab) : tab)),
    }));
  }

  function setCenterView(mode: CenterViewMode) {
    const tabId = activeTab?.tabId;
    if (!tabId) return;
    setGraphUiByTab((prev) => ({
      ...prev,
      [tabId]: {
        viewMode: mode,
        graphState: prev[tabId]?.graphState || null,
      },
    }));
  }

  function setActiveGraphState(nextState: GraphPanelState) {
    const tabId = activeTab?.tabId;
    if (!tabId) return;
    setGraphUiByTab((prev) => ({
      ...prev,
      [tabId]: {
        viewMode: prev[tabId]?.viewMode || "graphs",
        graphState: nextState,
      },
    }));
  }

  function setFit(next: FitPayload | ((prev: FitPayload) => FitPayload)) {
    updateActiveTab((tab) => {
      const nextFit = typeof next === "function" ? next(tab.fitState) : next;
      return updateTabFit(tab, nextFit);
    });
  }

  function setStats(next: FittingStats | null | ((prev: FittingStats | null) => FittingStats | null)) {
    updateActiveTab((tab) => ({
      ...tab,
      stats: typeof next === "function" ? next(tab.stats) : next,
    }));
  }

  function setWarnings(next: FitMessage[] | ((prev: FitMessage[]) => FitMessage[])) {
    updateActiveTab((tab) => ({
      ...tab,
      warnings: typeof next === "function" ? next(tab.warnings) : next,
    }));
  }

  function setErrors(next: FitMessage[] | ((prev: FitMessage[]) => FitMessage[])) {
    updateActiveTab((tab) => ({
      ...tab,
      errors: typeof next === "function" ? next(tab.errors) : next,
    }));
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
    setWorkspace((prev) => ({
      ...prev,
      openFits: prev.openFits.map((tab) => (tab.tabId === tabId ? { ...tab, errors: nextErrors } : tab)),
    }));
  }

  const calculationKey = useMemo(() => JSON.stringify(calculationRequest), [calculationRequest]);
  const moduleIdsKey = useMemo(() => {
    const ids = new Set<number>();
    for (const tab of workspace.openFits) {
      for (const id of allModuleTypeIds(tab.fitState)) ids.add(id);
    }
    return Array.from(ids).sort((a, b) => a - b).join(",");
  }, [workspace.openFits]);

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
        const response = await fetch("/api/fitting/calculate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(calculationRequest),
          signal: controller.signal,
        });
        const data = await readJson<CalculationResponse>(response);
        setTabCalculation(calculationTabId, data);
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
        const response = await fetch("/api/auth/me", { credentials: "include" });
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
      setCustomSavedFitGroups([]);
      setSavedFitsError(null);
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
      setNotice("Signed in. Click Link EVE Character again to open EVE SSO.");
    }
  }, [authUser, pendingSaveAfterAuth, pendingEsiLinkAfterAuth]);

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
    function handleMessage(event: MessageEvent) {
      if (!isTrustedSsoOrigin(event.origin)) return;
      const data = event.data || {};
      if (data.type !== "TRIFF_EVE_SSO_COMPLETE") return;
      setEsiPending(false);
      if (data.ok) {
        void refreshLinkedCharacters({ preserveOnError: true }).then((characters) => {
          const linked = characters.find((character) => Number(character.characterId) === Number(data.characterId));
          if (linked) {
            selectLinkedCharacter(linked);
          }
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
    setSelectedModuleKeys((prev) => {
      const next = new Set<string>();
      for (const key of prev) {
        const parsed = parseModuleKey(key);
        if (parsed && fit.modules[parsed.slot]?.[parsed.index]) next.add(key);
      }
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [fit]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedModuleKeys(new Set());
        setContextMenu(null);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    const ids = moduleIdsKey ? moduleIdsKey.split(",").map(Number).filter(Boolean) : [];
    const missing = ids.filter((id) => !typeDetails[id]);
    if (!missing.length) return;
    let alive = true;
    async function loadDetails() {
      const pairs = await Promise.allSettled(
        missing.map(async (id) => {
          const detail = await fetchType(id);
          return [id, detail] as const;
        })
      );
      if (!alive) return;
      setTypeDetails((prev) => {
        const next = { ...prev };
        for (const pair of pairs) {
          if (pair.status === "fulfilled") next[pair.value[0]] = pair.value[1];
        }
        return next;
      });
    }
    void loadDetails();
    return () => {
      alive = false;
    };
  }, [moduleIdsKey, typeDetails]);

  const shipSummary = fit.shipTypeId
    ? {
        typeId: fit.shipTypeId,
        typeName: fit.shipTypeName || `Type ${fit.shipTypeId}`,
      }
    : null;

  async function fetchType(typeId: number) {
    const response = await fetch(`/api/fitting/type/${typeId}`);
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

  async function fetchCharges(typeId: number) {
    const response = await fetch(`/api/fitting/charges/${typeId}`);
    const data = await readJson<{ ok: boolean; charges: ChargeResult[] }>(response);
    return data.charges || [];
  }

  async function refreshSavedFitTree(force = false) {
    if (!authUser && !force) return [];
    setSavedFitsLoading(true);
    setSavedFitsError(null);
    try {
      const response = await fetch("/api/fitting/saved-fits/tree");
      const data = await readJson<{ ok: boolean; groups: SavedFitGroup[]; customGroups?: CustomSavedFitGroup[] }>(response);
      setSavedFitGroups(data.groups || []);
      setCustomSavedFitGroups(data.customGroups || []);
      return data.groups || [];
    } catch (err) {
      setSavedFitsError((err as Error).message || "Saved fits failed to load.");
      setSavedFitGroups([]);
      setCustomSavedFitGroups([]);
      return [];
    } finally {
      setSavedFitsLoading(false);
    }
  }

  function selectLinkedCharacter(character: LinkedEsiCharacter) {
    setSkillProfile({
      mode: "esi_character",
      characterId: character.characterId,
      characterName: character.characterName,
      skillsSyncedAt: character.skillsSyncedAt,
      tokenStatus: character.tokenStatus,
    });
  }

  async function refreshLinkedCharacters(options: { preserveOnError?: boolean } = {}) {
    if (!authUser) {
      setLinkedCharacters([]);
      return [];
    }
    try {
      const response = await fetch("/api/fitting/esi/characters");
      const data = await readJson<{
        ok: boolean;
        configured?: boolean;
        configMissing?: string[];
        characters: LinkedEsiCharacter[];
      }>(response);
      setEsiConfigured(data.configured !== false);
      setEsiConfigMissing(data.configMissing || []);
      setLinkedCharacters(data.characters || []);
      return data.characters || [];
    } catch {
      if (!options.preserveOnError) setLinkedCharacters([]);
      return options.preserveOnError ? linkedCharacters : [];
    }
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
        return {
          ...prev,
          openFits: prev.openFits.map((tab) => (tab.tabId === current.tabId ? updateTabFit(tab, nextFit, { savedFitId: null, resetBaseline: true }) : tab)),
        };
      }
      const tab = makeWorkspaceTab(nextFit);
      return {
        openFits: [...prev.openFits, tab],
        activeTabId: tab.tabId,
      };
    });
    setSelectedModuleKeys(new Set());
    setContextMenu(null);
    setMutationEditor(null);
  }

  function addModule(slot: SlotKey, module: FittingModule) {
    const limit = slotTotal(stats, slot);
    if (!fit.shipTypeId) {
      setErrors([{ code: "missing_ship", message: "Select a ship hull before fitting modules." }]);
      return;
    }
    if (limit == null) {
      setWarnings((prev) => [{ code: "slot_data_pending", message: "Waiting for hull slot data before fitting modules." }, ...prev.filter((warning) => warning.code !== "slot_data_pending")]);
      return;
    }
    if (slot === "subsystem" && blockSubsystemAdd(module)) {
      return;
    }
    if (limit != null && fit.modules[slot].length >= limit) {
      setErrors([{
        code: "slot_full",
        message: `${SLOT_ORDER.includes(slot) ? slot : "Module"} slot group is full: ${fit.modules[slot].length} / ${limit}.`,
      }]);
      return;
    }
    if (slot === "high" && blockHardpointAdd(module)) {
      return;
    }
    setFit((prev) => ({
      ...prev,
      modules: {
        ...prev.modules,
        [slot]: [...prev.modules[slot], module],
      },
    }));
  }

  function updateModule(slot: SlotKey, index: number, updater: (module: FittingModule) => FittingModule) {
    setFit((prev) => ({
      ...prev,
      modules: {
        ...prev.modules,
        [slot]: prev.modules[slot].map((module, i) => (i === index ? updater(module) : module)),
      },
    }));
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

  function updateModules(keys: string[], updater: (module: FittingModule, slot: SlotKey, index: number) => FittingModule) {
    const keySet = new Set(keys);
    setFit((prev) => ({
      ...prev,
      modules: Object.fromEntries(
        SLOT_ORDER.map((slot) => [
          slot,
          prev.modules[slot].map((module, index) => (keySet.has(moduleKey(slot, index)) ? updater(module, slot, index) : module)),
        ])
      ) as Record<SlotKey, FittingModule[]>,
    }));
  }

  function contextTargetKeys(slot: SlotKey, index: number) {
    const fallback = moduleKey(slot, index);
    return contextMenu?.targetKeys?.length ? contextMenu.targetKeys : [fallback];
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

  function addQuantity(key: "drones" | "fighters" | "cargo" | "implants" | "boosters", item: QuantityItem) {
    setFit((prev) => ({
      ...prev,
      [key]: [...prev[key], item],
    }));
  }

  function slotConflict(key: "implants" | "boosters", item: QuantityItem, items: QuantityItem[], exceptIndex: number | null = null) {
    const slot = additionSlot(key, item);
    if (slot == null) return null;
    const existing = items.find((entry, index) => index !== exceptIndex && entry.enabled !== false && additionSlot(key, entry) === slot);
    return existing ? { slot, existing } : null;
  }

  function blockCharacterSlotAdd(key: "implants" | "boosters", item: QuantityItem) {
    const conflict = slotConflict(key, item, fit[key]);
    if (!conflict) return false;
    const label = key === "implants" ? "Implant" : "Booster";
    setErrors([{
      code: `${key}_slot_occupied`,
      message: `${label} slot ${conflict.slot} is already occupied by ${conflict.existing.typeName || `Type ${conflict.existing.typeId}`}.`,
    }]);
    return true;
  }

  function addCharacterItem(key: "implants" | "boosters", detail: SearchResult) {
    const item = additionWithSlot(key, detail);
    if (blockCharacterSlotAdd(key, item)) return;
    addQuantity(key, item);
  }

  function toggleCharacterItem(key: "implants" | "boosters", index: number, enabled: boolean) {
    const item = fit[key][index];
    if (!item) return;
    if (enabled) {
      const conflict = slotConflict(key, item, fit[key], index);
      if (conflict) {
        const label = key === "implants" ? "Implant" : "Booster";
        setErrors([{
          code: `${key}_slot_occupied`,
          message: `${label} slot ${conflict.slot} is already occupied by ${conflict.existing.typeName || `Type ${conflict.existing.typeId}`}.`,
        }]);
        return;
      }
    }
    setFit((prev) => ({
      ...prev,
      [key]: prev[key].map((entry, entryIndex) => (entryIndex === index ? { ...entry, enabled } : entry)),
    }));
  }

  function moduleHardpointKind(module: FittingModule): HardpointKind {
    const own = hardpointKindFromType(module);
    if (own !== "none" || module.hardpoint === "none") return own;
    return hardpointKindFromType(typeDetails[module.typeId]);
  }

  function blockHardpointAdd(module: FittingModule) {
    const kind = moduleHardpointKind(module);
    if (kind === "none") return false;
    const free = hardpointFree(stats, kind);
    if (free == null) {
      setWarnings((prev) => [
        { code: "hardpoint_data_pending", message: `Waiting for hull ${hardpointLabel(kind)} hardpoint data before fitting this module.` },
        ...prev.filter((warning) => warning.code !== "hardpoint_data_pending"),
      ]);
      return true;
    }
    if (free < 1) {
      setErrors([{ code: "hardpoint_full", message: `No ${hardpointLabel(kind)} hardpoints available.` }]);
      return true;
    }
    return false;
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
    return true;
  }

  function blockHardpointReplacement(targets: ModuleRowRef[], replacement: SearchResult) {
    const kind = hardpointKindFromType(replacement);
    if (kind === "none") return false;
    const free = hardpointFree(stats, kind);
    if (free == null) {
      setWarnings((prev) => [
        { code: "hardpoint_data_pending", message: `Waiting for hull ${hardpointLabel(kind)} hardpoint data before replacing modules.` },
        ...prev.filter((warning) => warning.code !== "hardpoint_data_pending"),
      ]);
      return true;
    }
    const preserved = targets.filter((target) => moduleHardpointKind(target.module) === kind).length;
    const needed = Math.max(0, targets.length - preserved);
    if (free < needed) {
      setErrors([{ code: "hardpoint_full", message: `No ${hardpointLabel(kind)} hardpoints available for that replacement.` }]);
      return true;
    }
    return false;
  }

  function addProjectedEffect(effect: EnvironmentEffect) {
    setFit((prev) => ({
      ...prev,
      projectedEffects: [
        ...prev.projectedEffects.filter((current) => current.kind !== "environment" || current.category !== effect.category),
        effect,
      ],
    }));
  }

  function removeProjectedEffect(index: number) {
    setFit((prev) => ({
      ...prev,
      projectedEffects: prev.projectedEffects.filter((_, i) => i !== index),
    }));
  }

  function addProjectedSource(sourceTabId: string) {
    if (!sourceTabId || sourceTabId === workspace.activeTabId) return;
    updateActiveTab((tab) => {
      if (tab.projectedLinks.some((link) => link.sourceTabId === sourceTabId)) return tab;
      return {
        ...tab,
        projectedLinks: [...tab.projectedLinks, { id: makeTabId(), sourceTabId, enabled: true, type: "projected_fit" }],
      };
    });
  }

  function toggleProjectedSource(linkId: string, enabled: boolean) {
    updateActiveTab((tab) => ({
      ...tab,
      projectedLinks: tab.projectedLinks.map((link) => (link.id === linkId ? { ...link, enabled } : link)),
    }));
  }

  function removeProjectedSource(linkId: string) {
    updateActiveTab((tab) => ({
      ...tab,
      projectedLinks: tab.projectedLinks.filter((link) => link.id !== linkId),
    }));
  }

  function addCommandSource(sourceTabId: string) {
    if (!sourceTabId || sourceTabId === workspace.activeTabId) return;
    updateActiveTab((tab) => {
      if (tab.commandLinks.some((link) => link.sourceTabId === sourceTabId)) return tab;
      return {
        ...tab,
        commandLinks: [...tab.commandLinks, {
          id: makeTabId(),
          sourceTabId,
          enabled: true,
          selectedBursts: commandBurstsBySource[sourceTabId] || [],
        }],
      };
    });
  }

  function toggleCommandSource(linkId: string, enabled: boolean) {
    updateActiveTab((tab) => ({
      ...tab,
      commandLinks: tab.commandLinks.map((link) => (link.id === linkId ? { ...link, enabled } : link)),
    }));
  }

  function toggleCommandBurst(linkId: string, sourceModuleInstanceId: string, enabled: boolean) {
    updateActiveTab((tab) => ({
      ...tab,
      commandLinks: tab.commandLinks.map((link) => {
        if (link.id !== linkId) return link;
        const sourceBursts = commandBurstsBySource[link.sourceTabId] || [];
        const byId = new Map(link.selectedBursts.map((burst) => [burst.sourceModuleInstanceId, burst]));
        const fallback = sourceBursts.find((burst) => burst.sourceModuleInstanceId === sourceModuleInstanceId);
        byId.set(sourceModuleInstanceId, {
          ...(fallback || byId.get(sourceModuleInstanceId) || { sourceModuleInstanceId }),
          enabled,
        });
        return { ...link, selectedBursts: Array.from(byId.values()) };
      }),
    }));
  }

  function removeCommandSource(linkId: string) {
    updateActiveTab((tab) => ({
      ...tab,
      commandLinks: tab.commandLinks.filter((link) => link.id !== linkId),
    }));
  }

  async function handleSelect(item: SearchResult) {
    const base = normalizeType(item);
    if (base.categoryName === "Ship") {
      setShip(base);
      return;
    }

    setBusyAction(`type-${base.typeId}`);
    try {
      const detail = await fetchType(base.typeId);
      setTypeDetails((prev) => ({ ...prev, [detail.typeId]: detail }));
      if (detail.pyfaKind === "ship" || detail.categoryName === "Ship") {
        setShip(detail);
      } else if (detail.pyfaKind === "module" && detail.slot && SLOT_ORDER.includes(detail.slot as SlotKey)) {
        addModule(detail.slot as SlotKey, {
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
      } else if (detail.pyfaKind === "drone" || detail.categoryName === "Drone") {
        addQuantity("drones", { typeId: detail.typeId, typeName: detail.typeName, quantity: 1, active: 1 });
      } else if (detail.pyfaKind === "implant") {
        addCharacterItem("implants", detail);
      } else if (detail.pyfaKind === "booster" || /booster/i.test(detail.groupName || "")) {
        addCharacterItem("boosters", detail);
      } else {
        addCargoItem(detail);
      }
    } catch (err) {
      setErrors([{ code: "type_lookup_failed", message: (err as Error).message }]);
    } finally {
      setBusyAction(null);
    }
  }

  function removeModule(slot: SlotKey, index: number) {
    const keys = contextTargetKeys(slot, index);
    const keySet = new Set(keys);
    setFit((prev) => ({
      ...prev,
      modules: {
        ...prev.modules,
        ...Object.fromEntries(
          SLOT_ORDER.map((slotName) => [slotName, prev.modules[slotName].filter((_, i) => !keySet.has(moduleKey(slotName, i)))])
        ),
      },
    }));
    setSelectedModuleKeys(new Set());
  }

  function removeQuantity(key: "drones" | "fighters" | "cargo" | "implants" | "boosters", index: number) {
    setFit((prev) => ({
      ...prev,
      [key]: prev[key].filter((_, i) => i !== index),
    }));
  }

  function replaceCharacterItem(key: "implants" | "boosters", index: number, variant: SearchResult) {
    const replacement = additionWithSlot(key, variant);
    const current = fit[key][index];
    if (!current) return;
    const conflict = slotConflict(key, replacement, fit[key], index);
    if (conflict) {
      const label = key === "implants" ? "Implant" : "Booster";
      setErrors([{
        code: `${key}_slot_occupied`,
        message: `${label} slot ${conflict.slot} is already occupied by ${conflict.existing.typeName || `Type ${conflict.existing.typeId}`}.`,
      }]);
      return;
    }
    setTypeDetails((prev) => ({ ...prev, [variant.typeId]: normalizeType(variant) }));
    setFit((prev) => ({
      ...prev,
      [key]: prev[key].map((item, itemIndex) => (itemIndex === index ? { ...replacement, enabled: current.enabled !== false } : item)),
    }));
  }

  function applyImplantSet(grade: ImplantSetGrade) {
    const replacementSlots = new Set(grade.items.map((item) => Number(item.slot)).filter(Boolean));
    const replacements = grade.items
      .slice()
      .sort((a, b) => Number(a.slot) - Number(b.slot))
      .map((item) => ({
        typeId: item.typeId,
        typeName: item.typeName,
        quantity: 1,
        slot: item.slot,
        implantSlot: item.slot,
      }));
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
  }

  function droneBandwidth(typeId: number) {
    const row = stats?.droneRows?.find((item) => item.typeId === typeId);
    return Number(row?.bandwidthPerDrone || 0);
  }

  function canSetDroneActive(index: number, nextActive: number) {
    const target = fit.drones[index];
    if (!target) return { ok: false, message: "Drone row no longer exists." };
    const next = Math.max(0, Math.floor(nextActive));
    const owned = quantity(target.quantity);
    if (next > owned) return { ok: false, message: `Only ${owned} ${target.typeName || "drones"} are in the bay.` };

    let activeTotal = 0;
    let bandwidthTotal = 0;
    for (const [i, drone] of fit.drones.entries()) {
      const active = i === index ? next : Math.max(0, Math.floor(Number(drone.active ?? drone.quantity ?? 0)));
      activeTotal += active;
      bandwidthTotal += active * droneBandwidth(drone.typeId);
    }

    const maxActive = 5;
    if (activeTotal > maxActive) return { ok: false, message: `Active drones exceed the ${maxActive} drone control limit.` };

    const bandwidthLimit = Number(stats?.drones?.bandwidthTotal);
    if (Number.isFinite(bandwidthLimit) && bandwidthLimit > 0 && bandwidthTotal > bandwidthLimit + 0.0001) {
      return { ok: false, message: `Active drones exceed bandwidth: ${bandwidthTotal} / ${bandwidthLimit} Mbit/s.` };
    }

    return { ok: true, message: "" };
  }

  function setDroneActive(index: number, active: number) {
    const check = canSetDroneActive(index, active);
    if (!check.ok) {
      setWarnings((prev) => [{ code: "drone_active_blocked", message: check.message }, ...prev.filter((warning) => warning.code !== "drone_active_blocked")]);
      return;
    }
    setFit((prev) => ({
      ...prev,
      drones: prev.drones.map((drone, i) => (i === index ? { ...drone, active: Math.max(0, Math.floor(active)) } : drone)),
    }));
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
    const target = fit.fighters[index];
    if (!target) return;
    const owned = quantity(target.quantity);
    const next = Math.max(0, Math.min(owned, Math.floor(active)));
    const otherActive = fit.fighters.reduce((sum, fighter, i) => sum + (i === index ? 0 : Math.max(0, Number(fighter.active ?? fighter.quantity ?? 0))), 0);
    const tubeLimit = Number(stats?.fighters?.tubesTotal);
    if (Number.isFinite(tubeLimit) && tubeLimit > 0 && otherActive + next > tubeLimit) {
      setWarnings((prev) => [{ code: "fighter_active_blocked", message: `Active fighters exceed available tubes: ${otherActive + next} / ${tubeLimit}.` }, ...prev.filter((warning) => warning.code !== "fighter_active_blocked")]);
      return;
    }
    setFit((prev) => ({
      ...prev,
      fighters: prev.fighters.map((fighter, i) => (i === index ? { ...fighter, active: next } : fighter)),
    }));
  }

  function applyImportedFit(data: ImportedFitResponse) {
    const importedFit = ensureFitPayload({ ...data.payload, skillProfile: fit.skillProfile || { mode: "all_v" } });
    const importedTab = makeWorkspaceTab(importedFit, {
      calculationResult: data.calculation || null,
      warnings: data.warnings || data.calculation?.warnings || [],
      errors: data.errors || data.calculation?.errors || [],
    });
    setWorkspace((prev) => {
      const current = prev.openFits.find((tab) => tab.tabId === prev.activeTabId);
      if (current && isReusableEmptyTab(current)) {
        return {
          ...prev,
          openFits: prev.openFits.map((tab) => (tab.tabId === current.tabId ? { ...importedTab, tabId: current.tabId } : tab)),
        };
      }
      return {
        openFits: [...prev.openFits, importedTab],
        activeTabId: importedTab.tabId,
      };
    });
    setSelectedModuleKeys(new Set());
    setMutationEditor(null);
    setContextMenu(null);
  }

  async function importFit() {
    setBusyAction("import");
    try {
      const response = await fetch("/api/fitting/import/eft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: eftText }),
      });
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
      const response = await fetch(`/api/fitting/shared-fits/${encodeURIComponent(id)}/import`);
      const data = await readJson<ImportedFitResponse>(response);
      applyImportedFit(data);
      setNotice(`Imported ${data.sharedFit?.fitName || data.payload.fitName || "shared fit"}.`);
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
      const response = await fetch("/api/fitting/export/eft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: fit }),
      });
      const data = await readJson<{ ok: boolean; text: string }>(response);
      setExportText(data.text);
      setShareLink(null);
      setShareError(null);
      setModal("export");
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(data.text);
      }
    } catch (err) {
      setErrors([{ code: "export_failed", message: (err as Error).message }]);
    } finally {
      setBusyAction(null);
    }
  }

  async function createShareLink() {
    if (!exportText.trim()) return;
    setBusyAction("share");
    setShareError(null);
    try {
      const response = await fetch("/api/fitting/shared-fits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eftText: exportText, source: "triff.tools" }),
      });
      const data = await readJson<SharedFitLinkResponse>(response);
      setShareLink(data.url);
      setNotice("Share link created.");
    } catch (err) {
      setShareError((err as Error).message || "Could not create share link.");
    } finally {
      setBusyAction(null);
    }
  }

  async function copyShareLink() {
    if (!shareLink) return;
    if (!navigator.clipboard?.writeText) {
      setNotice("Share link created. Copy unavailable here.");
      return;
    }
    try {
      await navigator.clipboard.writeText(shareLink);
      setNotice("Share link copied to clipboard.");
    } catch {
      setNotice("Share link created. Copy unavailable here.");
    }
  }

  async function exportFitTextForSave(payload: FitPayload = fit) {
    try {
      const response = await fetch("/api/fitting/export/eft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
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
    if (fit.fitName !== fitName) setFit(fitJson);

    setBusyAction("save");
    try {
      const eftText = await exportFitTextForSave(fitJson);
      const response = await fetch(activeSavedFitId ? `/api/fitting/saved-fits/${activeSavedFitId}` : "/api/fitting/saved-fits", {
        method: activeSavedFitId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fitName,
          shipTypeId: fit.shipTypeId,
          shipName,
          fitJson,
          eftText,
        }),
      });
      const data = await readJson<{ ok: boolean; fit: SavedFitRecord }>(response);
      setWorkspace((prev) => ({
        ...prev,
        openFits: prev.openFits.map((tab) => (
          tab.tabId === prev.activeTabId
            ? {
                ...updateTabFit(tab, data.fit.fitJson ? ensureFitPayload(data.fit.fitJson) : fitJson, {
                  savedFitId: data.fit.id,
                  resetBaseline: true,
                }),
                openedFromSavedAt: data.fit.updatedAt || new Date().toISOString(),
              }
            : tab
        )),
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
      setSelectedModuleKeys(new Set());
      setContextMenu(null);
      setMutationEditor(null);
      setSavedFitFocus({ savedFitId: id, shipTypeId: existing.shipTypeId || 0, token: Date.now() });
      if (existing.dirty) setNotice("Saved fit is already open with unsaved changes.");
      return;
    }

    setBusyAction(`open-${id}`);
    try {
      const response = await fetch(`/api/fitting/saved-fits/${id}`);
      const data = await readJson<{ ok: boolean; fit: SavedFitRecord }>(response);
      if (!data.fit.fitJson) throw new Error("saved_fit_missing_payload");
      const tab = makeWorkspaceTab(ensureFitPayload(data.fit.fitJson), {
        savedFitId: data.fit.id,
        openedFromSavedAt: data.fit.lastOpenedAt || data.fit.updatedAt || new Date().toISOString(),
      });
      setWorkspace((prev) => ({
        openFits: [...prev.openFits, tab],
        activeTabId: tab.tabId,
      }));
      setSelectedModuleKeys(new Set());
      setMutationEditor(null);
      setSavedFitFocus({ savedFitId: data.fit.id, shipTypeId: data.fit.shipTypeId, token: Date.now() });
      void refreshSavedFitTree(true);
    } catch (err) {
      setErrors([{ code: "open_saved_fit_failed", message: (err as Error).message || "Unable to open saved fit." }]);
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteSavedFit(id: string) {
    setBusyAction(`delete-${id}`);
    try {
      const response = await fetch(`/api/fitting/saved-fits/${id}`, { method: "DELETE" });
      await readJson<{ ok: boolean }>(response);
      setWorkspace((prev) => ({
        ...prev,
        openFits: prev.openFits.map((tab) => (
          tab.savedFitId === id ? updateTabFit(tab, tab.fitState, { savedFitId: null, resetBaseline: true }) : tab
        )),
      }));
      await refreshSavedFitTree(true);
      setNotice("Saved fit deleted.");
    } catch (err) {
      setErrors([{ code: "delete_saved_fit_failed", message: (err as Error).message || "Unable to delete saved fit." }]);
    } finally {
      setBusyAction(null);
    }
  }

  async function createSavedFitGroup(name: string) {
    setBusyAction("create-fit-group");
    try {
      const response = await fetch("/api/fitting/saved-fit-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await readJson<{ ok: boolean }>(response);
      await refreshSavedFitTree(true);
      setNotice(`Created fit group: ${name}.`);
    } catch (err) {
      setSavedFitsError((err as Error).message || "Unable to create fit group.");
    } finally {
      setBusyAction(null);
    }
  }

  async function renameSavedFitGroup(id: string, name: string) {
    setBusyAction(`rename-fit-group-${id}`);
    try {
      const response = await fetch(`/api/fitting/saved-fit-groups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await readJson<{ ok: boolean }>(response);
      await refreshSavedFitTree(true);
      setNotice(`Renamed fit group to ${name}.`);
    } catch (err) {
      setSavedFitsError((err as Error).message || "Unable to rename fit group.");
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteSavedFitGroup(id: string) {
    setBusyAction(`delete-fit-group-${id}`);
    try {
      const response = await fetch(`/api/fitting/saved-fit-groups/${id}`, { method: "DELETE" });
      await readJson<{ ok: boolean }>(response);
      await refreshSavedFitTree(true);
      setNotice("Fit group deleted. Saved fits were kept.");
    } catch (err) {
      setSavedFitsError((err as Error).message || "Unable to delete fit group.");
    } finally {
      setBusyAction(null);
    }
  }

  async function addSavedFitToGroup(groupId: string, fitId: string) {
    try {
      const response = await fetch(`/api/fitting/saved-fit-groups/${groupId}/fits/${fitId}`, { method: "POST" });
      await readJson<{ ok: boolean }>(response);
      await refreshSavedFitTree(true);
      setNotice("Added fit to group.");
    } catch (err) {
      setSavedFitsError((err as Error).message || "Unable to add fit to group.");
    }
  }

  async function removeSavedFitFromGroup(groupId: string, fitId: string) {
    try {
      const response = await fetch(`/api/fitting/saved-fit-groups/${groupId}/fits/${fitId}`, { method: "DELETE" });
      await readJson<{ ok: boolean }>(response);
      await refreshSavedFitTree(true);
      setNotice("Removed fit from group.");
    } catch (err) {
      setSavedFitsError((err as Error).message || "Unable to remove fit from group.");
    }
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

  function addCargoItem(item: Pick<QuantityItem, "typeId" | "typeName">) {
    setFit((prev) => ({ ...prev, cargo: addCargoStack(prev.cargo, item) }));
    setNotice(`Added ${item.typeName || `Type ${item.typeId}`} to cargo.`);
  }

  function setCargoQuantity(index: number, nextQuantity: number) {
    const target = fit.cargo[index];
    if (!target || !Number.isFinite(nextQuantity)) return;
    setFit((prev) => ({ ...prev, cargo: setCargoStackQuantity(prev.cargo, index, nextQuantity) }));
    setNotice(nextQuantity <= 0 ? "Removed from cargo." : "Updated cargo quantity.");
  }

  function setDamageProfile(profile: DamageProfileSelection) {
    setFit((prev) => {
      if (String(prev.damageProfile?.profileId || "") === String(profile.profileId)) return prev;
      return { ...prev, damageProfile: profile };
    });
  }

  function linkEveCharacter() {
    if (!authUser) {
      setPendingEsiLinkAfterAuth(true);
      requestSiteAuthModal("login");
      return;
    }
    if (!esiConfigured) {
      setErrors([{ code: "esi_not_configured", message: `EVE SSO is not configured (${esiConfigMissing.join(", ")}).` }]);
      return;
    }
    esiPendingKnownIds.current = new Set(linkedCharacters.map((character) => Number(character.characterId)));
    const popup = window.open("/api/fitting/esi/login", "triff-eve-sso", "width=720,height=860");
    if (!popup) {
      setErrors([{ code: "esi_popup_blocked", message: "Popup blocked. Allow popups for triff.tools, then click Link EVE Character again." }]);
      return;
    }
    setEsiPending(true);
    setNotice("Waiting for EVE SSO authorization...");
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
    if (value === "refresh") {
      void refreshSelectedCharacter();
      return;
    }
    if (value.startsWith("esi:")) {
      const characterId = Number(value.slice(4));
      const character = linkedCharacters.find((entry) => entry.characterId === characterId);
      if (character) {
        setSkillProfile({
          mode: "esi_character",
          characterId: character.characterId,
          characterName: character.characterName,
          skillsSyncedAt: character.skillsSyncedAt,
          tokenStatus: character.tokenStatus,
        });
      }
    }
  }

  async function refreshSelectedCharacter() {
    if (skillProfile.mode !== "esi_character") return;
    await refreshEsiCharacter(skillProfile.characterId);
  }

  async function refreshEsiCharacter(characterId: number) {
    setEsiBusy(`refresh-${characterId}`);
    try {
      const response = await fetch(`/api/fitting/esi/characters/${characterId}/refresh-skills`, { method: "POST" });
      const data = await readJson<{ ok: boolean; character: LinkedEsiCharacter }>(response);
      await refreshLinkedCharacters();
      setSkillProfile({
        mode: "esi_character",
        characterId: data.character.characterId,
        characterName: data.character.characterName,
        skillsSyncedAt: data.character.skillsSyncedAt,
        tokenStatus: data.character.tokenStatus,
      });
      setNotice(`Refreshed skills for ${data.character.characterName}.`);
    } catch (err) {
      setErrors([{ code: "esi_refresh_failed", message: (err as Error).message || "Unable to refresh character skills." }]);
    } finally {
      setEsiBusy(null);
    }
  }

  async function unlinkEsiCharacter(characterId: number) {
    if (!window.confirm("Unlink this EVE character from your triff.tools account?")) return;
    setEsiBusy(`unlink-${characterId}`);
    try {
      const response = await fetch(`/api/fitting/esi/characters/${characterId}`, { method: "DELETE" });
      await readJson<{ ok: boolean }>(response);
      await refreshLinkedCharacters();
      setWorkspace((prev) => ({
        ...prev,
        openFits: prev.openFits.map((tab) => (
          tab.fitState.skillProfile?.mode === "esi_character" && tab.fitState.skillProfile.characterId === characterId
            ? updateTabFit(tab, { ...tab.fitState, skillProfile: { mode: "all_v" } })
            : tab
        )),
      }));
      setNotice("EVE character unlinked.");
    } catch (err) {
      setErrors([{ code: "esi_unlink_failed", message: (err as Error).message || "Unable to unlink character." }]);
    } finally {
      setEsiBusy(null);
    }
  }

  function modalSubmit() {
    if (modal === "import") {
      void importFit();
    } else if (modal === "export" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(exportText).then(() => setNotice("EFT copied to clipboard."));
    }
  }

  function handleModuleClick(event: MouseEvent, slot: SlotKey, index: number, _module: FittingModule) {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) return;
    event.preventDefault();
    const key = moduleKey(slot, index);
    setSelectedModuleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openModuleContext(event: MouseEvent, slot: SlotKey, index: number, module: FittingModule) {
    event.preventDefault();
    const key = moduleKey(slot, index);
    const selected = selectedModuleKeys.has(key) && selectedModuleKeys.size > 1;
    const targetKeys = selected ? Array.from(selectedModuleKeys) : [key];
    if (!selected) setSelectedModuleKeys(new Set([key]));
    setContextMenu({ x: event.clientX, y: event.clientY, slot, index, module, targetKeys });
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
    updateModules(contextTargetKeys(slot, index), (module, targetSlot, targetIndex) => {
      if (normalizedModuleState(state) === "overheated" && !moduleCanOverheat(targetSlot, targetIndex)) return module;
      return withModuleState(module, state);
    });
  }

  function setModuleSpool(slot: SlotKey, index: number, cycles: number) {
    updateModules(contextTargetKeys(slot, index), (module, targetSlot, targetIndex) => {
      const spool = stats?.moduleRows?.[targetSlot]?.[targetIndex]?.spool;
      if (!spool?.eligible) return module;
      const min = Number(spool.minCycles ?? 0);
      const max = Number(spool.maxCycles ?? cycles);
      const clamped = Math.max(min, Math.min(max, cycles));
      return { ...module, spoolType: "cycles", spoolAmount: clamped };
    });
  }

  function cycleModuleState(slot: SlotKey, index: number) {
    updateModules([moduleKey(slot, index)], (module) => withModuleState(module, nextModuleState(slot, index, module)));
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
    setSelectedModuleKeys(new Set());
    setContextMenu(null);
  }

  function loadCharge(slot: SlotKey, index: number, charge: ChargeResult | null) {
    updateModules(contextTargetKeys(slot, index), (module) => {
      if (!charge) {
        const { chargeTypeId, chargeTypeName, ...rest } = module;
        return rest;
      }
      return {
        ...module,
        chargeTypeId: charge.typeId,
        chargeTypeName: charge.typeName,
      };
    });
  }

  async function fillWithModule(slot: SlotKey, index: number) {
    if (!FILLABLE_RACKS.includes(slot)) return;
    const source = fit.modules[slot]?.[index];
    const limit = slotTotal(stats, slot);
    if (!source || limit == null) {
      setErrors([{ code: "fill_module_unavailable", message: "Waiting for current rack data before filling slots." }]);
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
        // The already-fitted module still carries enough metadata for a conservative fill attempt.
      }
    }

    let available = Math.max(0, Math.floor(limit) - fit.modules[slot].length);
    if (slot === "high") {
      const kind = moduleHardpointKind(fillModule);
      if (kind !== "none") {
        const free = hardpointFree(stats, kind);
        if (free == null) {
          setErrors([{ code: "fill_module_unavailable", message: `Waiting for ${hardpointLabel(kind)} hardpoint data.` }]);
          return;
        }
        available = Math.min(available, Math.max(0, Math.floor(free)));
      }
    }
    if (available < 1) {
      setNotice(`No available ${slot === "rig" ? "rig slots" : `${slot} slots`}.`);
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
        const response = await fetch("/api/fitting/calculate", {
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
        setSelectedModuleKeys(new Set());
        setNotice(`Filled ${count} ${slot === "rig" ? "rig slot" : `${slot} slot`}${count === 1 ? "" : "s"} with ${fillModule.typeName || `Type ${fillModule.typeId}`}.`);
        return;
      }
      setErrors([{
        code: lastBlocker?.code || "fill_module_blocked",
        message: lastBlocker?.message || `No legal ${slot} slots can be filled with that module.`,
      }]);
    } catch (err) {
      setErrors([{ code: "fill_module_failed", message: (err as Error).message || "Unable to fill the rack." }]);
    } finally {
      setBusyAction(null);
    }
  }

  function replaceVariant(slot: SlotKey, index: number, variant: SearchResult) {
    void (async () => {
      const targetKeys = contextTargetKeys(slot, index);
      const targets = targetKeys
        .map((key) => {
          const parsed = parseModuleKey(key);
          if (!parsed) return null;
          const module = fit.modules[parsed.slot]?.[parsed.index];
          return module ? { key, slot: parsed.slot, index: parsed.index, module } : null;
        })
        .filter(Boolean) as ModuleRowRef[];
      const selected = targets.map((target) => target.module);
      const missingTargetIds = Array.from(new Set(selected.map((module) => module.typeId).filter((id) => !typeDetails[id])));
      const loadedTargetDetails: Record<number, SearchResult> = {};
      if (missingTargetIds.length) {
        const pairs = await Promise.allSettled(missingTargetIds.map(async (typeId) => [typeId, await fetchType(typeId)] as const));
        for (const pair of pairs) {
          if (pair.status === "fulfilled") loadedTargetDetails[pair.value[0]] = pair.value[1];
        }
        if (Object.keys(loadedTargetDetails).length) {
          setTypeDetails((prev) => ({ ...prev, ...loadedTargetDetails }));
        }
      }
      const enrichedTargets = targets.map((target) => {
        const detail = loadedTargetDetails[target.module.typeId];
        return detail
          ? {
              ...target,
              module: {
                ...target.module,
                hardpoint: target.module.hardpoint ?? detail.hardpoint ?? null,
                hardpointName: target.module.hardpointName ?? detail.hardpointName ?? null,
              },
            }
          : target;
      });
      const variantDetail = await fetchType(variant.typeId).catch(() => normalizeType(variant));
      const subsystemIndexes = new Set(enrichedTargets.filter((target) => target.slot === "subsystem").map((target) => target.index));
      if (subsystemIndexes.size && blockSubsystemAdd(variantDetail, subsystemIndexes)) return;
      if (blockHardpointReplacement(enrichedTargets, variantDetail)) return;
      let keepCharge = false;
      let compatible: ChargeResult[] = [];
      if (selected.some((current) => current?.chargeTypeId)) {
        try {
          compatible = await fetchCharges(variantDetail.typeId);
          keepCharge = true;
        } catch {
          keepCharge = false;
        }
      }
      setTypeDetails((prev) => ({ ...prev, [variantDetail.typeId]: variantDetail }));
      updateModules(targetKeys, (module) => {
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
          chargeTypeId: keepCharge && compatible.some((charge) => charge.typeId === module.chargeTypeId) ? module.chargeTypeId : undefined,
          chargeTypeName: keepCharge && compatible.some((charge) => charge.typeId === module.chargeTypeId) ? module.chargeTypeName : undefined,
        };
      });
    })();
  }

  function applyMutaplasmid(slot: SlotKey, index: number, mutaplasmid: MutaplasmidResult) {
    const current = fit.modules[slot]?.[index];
    if (!current) return;
    const mutation = mutationFromMutaplasmid(current, mutaplasmid);
    const nextModule = { ...current, mutation };
    updateModule(slot, index, () => nextModule);
    setMutationEditor({ slot, index, module: nextModule, mutation });
  }

  function editMutation(slot: SlotKey, index: number) {
    const current = fit.modules[slot]?.[index];
    if (!current?.mutation) return;
    setMutationEditor({ slot, index, module: current, mutation: current.mutation });
  }

  function clearMutation(slot: SlotKey, index: number) {
    updateModule(slot, index, (module) => {
      const { mutation, ...rest } = module;
      return rest;
    });
  }

  function applyMutationEditor(mutation: ModuleMutation) {
    if (!mutationEditor) return;
    updateModule(mutationEditor.slot, mutationEditor.index, (module) => ({
      ...module,
      mutation,
    }));
  }

  function switchFitTab(tabId: string) {
    setWorkspace((prev) => ({ ...prev, activeTabId: tabId }));
    setSelectedModuleKeys(new Set());
    setContextMenu(null);
    setMutationEditor(null);
  }

  function openNewFitTab() {
    const tab = makeWorkspaceTab(emptyFit());
    setWorkspace((prev) => ({
      openFits: [...prev.openFits, tab],
      activeTabId: tab.tabId,
    }));
    setSelectedModuleKeys(new Set());
    setContextMenu(null);
    setMutationEditor(null);
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
      const activeTabId = prev.activeTabId === tabId ? remaining[Math.max(0, prev.openFits.findIndex((tab) => tab.tabId === tabId) - 1)]?.tabId || remaining[0].tabId : prev.activeTabId;
      return { openFits: remaining, activeTabId };
    });
    setSelectedModuleKeys(new Set());
    setContextMenu(null);
    setMutationEditor(null);
  }

  return (
    <div className="h-[calc(100vh-48px)] overflow-hidden px-2 py-2 text-slate-100">
      <div className="mx-auto flex h-full min-h-0 max-w-[1900px] flex-col gap-2 border border-[#3a3c40] bg-[#030509]/90 p-2 shadow-[0_0_28px_rgba(0,0,0,0.45)]">
        <div className={`${panelBase} flex h-8 shrink-0 items-end bg-[#05070b] px-1 pt-1`}>
          <div className="flex min-w-0 flex-1 items-end overflow-x-auto">
            {workspace.openFits.map((tab) => {
              const active = tab.tabId === workspace.activeTabId;
              return (
                <div
                  key={tab.tabId}
                  className={`mr-1 grid h-7 min-w-[120px] max-w-[220px] grid-cols-[18px,1fr,18px] items-center gap-1 border px-1.5 text-[11px] ${
                    active
                      ? "border-[#3f6f91] bg-[#101b26] text-[#8bd3ff]"
                      : "border-[#252a33] bg-[#080b11] text-slate-500 hover:text-slate-200"
                  }`}
                >
                  {tab.shipTypeId ? (
                    <img src={eveIcon(tab.shipTypeId)} alt="" className="h-4 w-4 border border-[#30343d] bg-black" />
                  ) : (
                    <EveUiIcon icon={fittingUiIcon} className="h-[15px] w-[15px]" />
                  )}
                  <button
                    type="button"
                    className="min-w-0 truncate text-left"
                    onClick={() => switchFitTab(tab.tabId)}
                    title={`${tab.fitName}${tab.dirty ? " *" : ""}`}
                  >
                    {tab.fitName || "New Fit"}{tab.dirty ? " *" : ""}
                  </button>
                  <button
                    type="button"
                    className="flex h-4 w-4 items-center justify-center text-slate-600 hover:text-red-200"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeFitTab(tab.tabId);
                    }}
                    title="Close fit tab"
                  >
                    <X size={11} />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="mb-1 ml-1 flex h-6 w-6 shrink-0 items-center justify-center border border-[#303236] bg-[#05070b] font-mono text-[12px] text-slate-500 hover:border-[#53b6ff]/70 hover:bg-[#101721] hover:text-[#8bd3ff]"
            onClick={() => setFittingHelpOpen(true)}
            title="About the fitting tool"
            aria-label="About the fitting tool"
          >
            ?
          </button>
        </div>

        <header className={`${panelBase} flex shrink-0 flex-wrap items-center gap-2 px-2 py-1.5`}>
          <div className="flex min-w-[280px] flex-1 items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center border border-[#30343d] bg-black">
              {shipSummary ? (
                <img src={eveIcon(shipSummary.typeId)} alt="" className="h-8 w-8 object-cover" />
              ) : (
                <EveUiIcon icon={fittingUiIcon} className="h-7 w-7 text-slate-500" />
              )}
            </div>
            <div className="min-w-[180px] flex-1">
              <div className="relative">
                <input
                  value={fit.fitName}
                  onChange={(event) => setFit((prev) => ({ ...prev, fitName: event.target.value }))}
                  className={`${inputClass} w-full ${activeTab?.dirty ? "pr-6" : ""}`}
                  aria-label="Fit name"
                />
                {activeTab?.dirty && (
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[12px] text-[#8bd3ff]">*</span>
                )}
              </div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
              <span className="truncate text-slate-300">{shipSummary ? itemName(shipSummary) : "No hull selected"}</span>
              <span className="font-mono">All skills V</span>
              {fit.projectedEffects.length > 0 && (
                <span className="truncate font-mono text-[#8bd3ff]" title={fit.projectedEffects.map((effect) => effect.label).join(", ")}>
                  Environment: {fit.projectedEffects.map((effect) => effect.label).join(", ")}
                </span>
              )}
            </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className={buttonBase} onClick={() => setModal("import")}>
              <ClipboardPaste size={13} />
              Import from Clipboard/EFT
            </button>
            <button type="button" className={buttonBase} onClick={() => setInGameFitsOpen(true)}>
              <Upload size={13} />
              Import from In-Game
            </button>
            <button type="button" className={buttonBase} onClick={() => void exportFit()} disabled={!fit.shipTypeId || busyAction === "export"}>
              {busyAction === "export" ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
              Share/EFT
            </button>
            <button type="button" className={buttonBase} onClick={() => void saveCurrentFit()} disabled={!fit.shipTypeId || busyAction === "save"}>
              {busyAction === "save" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Save Fit
            </button>
            <button type="button" className={primaryButton} onClick={() => {
              openNewFitTab();
            }}>
              <Upload size={13} />
              New
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden xl:grid-cols-[340px,minmax(680px,1fr),330px]">
          <ModuleBrowser
            onSelect={(item) => void handleSelect(item)}
            onShowInfo={(item) => setItemInfoTarget({ typeId: item.typeId, typeName: item.typeName })}
            onAddToCargo={addCargoItem}
            authUser={authUser}
            savedFitGroups={savedFitGroups}
            customSavedFitGroups={customSavedFitGroups}
            savedFitsLoading={savedFitsLoading}
            selectedSavedFitId={activeSavedFitId}
            savedFitFocus={savedFitFocus}
            onOpenSavedFit={(id) => void openSavedFit(id)}
            onDeleteSavedFit={(id) => void deleteSavedFit(id)}
            onCreateSavedFitGroup={(name) => void createSavedFitGroup(name)}
            onRenameSavedFitGroup={(id, name) => void renameSavedFitGroup(id, name)}
            onDeleteSavedFitGroup={(id) => void deleteSavedFitGroup(id)}
            onAddSavedFitToGroup={(groupId, fitId) => void addSavedFitToGroup(groupId, fitId)}
            onRemoveSavedFitFromGroup={(groupId, fitId) => void removeSavedFitFromGroup(groupId, fitId)}
          />

          <main className={`grid min-h-0 gap-2 overflow-hidden ${centerView === "graphs" ? "grid-rows-[auto,180px]" : "grid-rows-[minmax(0,1fr),180px]"}`}>
            {centerView === "graphs" ? (
              <FittingGraphsPanel
                key={activeTab?.tabId || "graphs"}
                calculationPayload={calculationRequest}
                openFitTargets={graphOpenFitTargets}
                viewMode={centerView}
                onViewModeChange={setCenterView}
                stateKey={activeTab?.tabId}
                state={activeGraphState}
                onStateChange={setActiveGraphState}
              />
            ) : (
              <FittingTable
                modules={fit.modules}
                stats={stats}
                typeDetails={typeDetails}
                selectedKeys={selectedModuleKeys}
                onModuleClick={handleModuleClick}
                onModuleContextMenu={openModuleContext}
                onClearSelection={() => setSelectedModuleKeys(new Set())}
                onShipModeChange={setShipMode}
                onRackStateChange={setRackState}
                onModuleStateCycle={cycleModuleState}
                viewMode={centerView}
                onViewModeChange={setCenterView}
              />
            )}
            <AdditionsPanel
              drones={fit.drones}
              fighters={fit.fighters}
              cargo={fit.cargo}
              implants={fit.implants}
              boosters={fit.boosters}
              projectedEffects={fit.projectedEffects}
              projectedLinks={projectedLinks}
              commandLinks={commandLinks}
              sourceFits={sourceFitOptions}
              commandBurstsBySource={commandBurstsBySource}
              stats={stats}
              onRemove={removeQuantity}
              onReplaceCharacterItem={replaceCharacterItem}
              onApplyImplantSet={applyImplantSet}
              onToggleCharacterItem={toggleCharacterItem}
              onSetDroneActive={setDroneActive}
              onSetDroneQuantity={setDroneQuantity}
              onSetCargoQuantity={setCargoQuantity}
              onSetFighterActive={setFighterActive}
              onAddProjectedEffect={addProjectedEffect}
              onRemoveProjectedEffect={removeProjectedEffect}
              onAddProjectedSource={addProjectedSource}
              onToggleProjectedSource={toggleProjectedSource}
              onRemoveProjectedSource={removeProjectedSource}
              onAddCommandSource={addCommandSource}
              onToggleCommandSource={toggleCommandSource}
              onToggleCommandBurst={toggleCommandBurst}
              onRemoveCommandSource={removeCommandSource}
              onShowInfo={(typeId, typeName) => setItemInfoTarget({ typeId, typeName })}
            />
          </main>

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
            skillOverrideCount={Object.keys(activeSkillOverrides).length}
            onClearSkillOverrides={clearTemporarySkillOverrides}
            damageProfile={fit.damageProfile}
            onDamageProfileChange={setDamageProfile}
          />
        </div>
      </div>

      {contextMenu && (
        <ModuleContextMenu
          {...contextMenu}
          targets={contextMenu.targetKeys
            .map((key) => {
              const parsed = parseModuleKey(key);
              const targetModule = parsed ? fit.modules[parsed.slot]?.[parsed.index] : null;
              return parsed && targetModule
                ? { key, slot: parsed.slot, index: parsed.index, module: targetModule, row: stats?.moduleRows?.[parsed.slot]?.[parsed.index] || null }
                : null;
            })
            .filter(Boolean) as ModuleRowRef[]}
          onClose={() => setContextMenu(null)}
          onRemove={removeModule}
          onFillWithModule={(slot, index) => void fillWithModule(slot, index)}
          onState={setModuleState}
          onCharge={loadCharge}
          onVariant={replaceVariant}
          onSpool={setModuleSpool}
          onMutaplasmid={applyMutaplasmid}
          onEditMutation={editMutation}
          onClearMutation={clearMutation}
          onShowInfo={(typeId, typeName) => setItemInfoTarget({ typeId, typeName })}
          fitPayload={calculationFit}
          onSkillOverride={setTemporarySkillOverride}
        />
      )}

      {itemInfoTarget && (
        <FittingItemInfoModal
          target={itemInfoTarget}
          onClose={() => setItemInfoTarget(null)}
        />
      )}
      {fittingHelpOpen && <FittingHelpModal onClose={() => setFittingHelpOpen(false)} />}

      <MutationEditorModal
        open={mutationEditor !== null}
        module={mutationEditor?.module || null}
        mutation={mutationEditor?.mutation || null}
        onClose={() => setMutationEditor(null)}
        onApply={applyMutationEditor}
      />

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
        onSubmit={modalSubmit}
        onShareLink={modal === "export" ? createShareLink : undefined}
        onCopyShareLink={modal === "export" ? copyShareLink : undefined}
      />

      <InGameFittingsImportModal
        open={inGameFitsOpen}
        authUser={authUser}
        onClose={() => setInGameFitsOpen(false)}
        onImported={(data) => {
          applyImportedFit(data);
          setInGameFitsOpen(false);
          setNotice(`Imported in-game fit: ${data.inGameFitting?.name || data.payload.fitName || "fit"}.`);
        }}
      />

      {manageCharactersOpen && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-lg border border-[#2c2f36] bg-[#070910] shadow-2xl shadow-black">
            <div className="flex h-8 items-center justify-between border-b border-[#2c2f36] bg-[#101219] px-3">
              <div className="text-[10px] uppercase tracking-widest text-slate-300">Linked EVE Characters</div>
              <button type="button" className="text-slate-500 hover:text-slate-100" onClick={() => setManageCharactersOpen(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="space-y-2 p-3 text-[11px]">
              {!esiConfigured && (
                <div className="border border-amber-500/30 bg-amber-950/20 p-2 text-amber-200">
                  EVE SSO is not configured. Missing: {esiConfigMissing.join(", ")}
                </div>
              )}
              {linkedCharacters.length === 0 ? (
                <div className="border border-[#20242c] bg-[#05070b] p-3 text-slate-500">No linked EVE characters.</div>
              ) : linkedCharacters.map((character) => (
                <div key={character.characterId} className="grid grid-cols-[1fr,auto] gap-2 border border-[#20242c] bg-[#05070b] p-2">
                  <div className="min-w-0">
                    <div className="truncate text-slate-100">{character.characterName}</div>
                    <div className="font-mono text-[10px] text-slate-600">
                      {relativeTime(character.skillsSyncedAt)} · {character.tokenStatus || "ok"}
                      {character.lastError ? ` · ${character.lastError}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className={buttonBase}
                      disabled={esiBusy === `refresh-${character.characterId}`}
                      onClick={() => void refreshEsiCharacter(character.characterId)}
                    >
                      Refresh
                    </button>
                    <button
                      type="button"
                      className={buttonBase}
                      disabled={esiBusy === `unlink-${character.characterId}`}
                      onClick={() => void unlinkEsiCharacter(character.characterId)}
                    >
                      Unlink
                    </button>
                  </div>
                </div>
              ))}
              <button type="button" className={primaryButton} onClick={linkEveCharacter}>
                Link EVE Character
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className="fixed bottom-4 right-4 z-[9999] border border-[#2f6b46] bg-[#07130c] px-3 py-2 text-[11px] text-[#9dffbd] shadow-2xl shadow-black/60">
          {notice}
        </div>
      )}
      {savedFitsError && (
        <div className="fixed bottom-4 left-4 z-[9999] border border-[#6b2b32] bg-[#1d090b] px-3 py-2 text-[11px] text-[#ffaaaa] shadow-2xl shadow-black/60">
          {savedFitsError}
        </div>
      )}
    </div>
  );
}
