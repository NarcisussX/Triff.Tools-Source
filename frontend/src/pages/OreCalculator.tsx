/*
 * React page for /ore.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import React, { useEffect, useState } from "react";
import axios from "axios";
import { Pencil, Save, Trash2, X } from "lucide-react";
import infoIconRaw from "../assets/icons/info.svg?raw";
import {
  requestSiteAuthModal,
  SITE_AUTH_CHANGED_EVENT,
  type SiteAuthChangeDetail,
} from "../auth/siteAuthEvents";
import type { AuthUser } from "../components/fitting/types";

const LOW_SLOT_UPGRADES = [
  { name: "Mining Laser Upgrade II", bonus: 0.09 },
  { name: "Elara Restrained Mining Laser Upgrade", bonus: 0.08 },
  { name: "'Aoede' Mining Laser Upgrade", bonus: 0.10 },
  { name: "'Carpo' Mining Laser Upgrade", bonus: 0.09 },
  { name: "Mining Laser Upgrade I", bonus: 0.05 }
];

const IMPLANT_OPTIONS = [
  "None",
  "Inherent Implants 'Highwall' Mining MX-1001",
  "Inherent Implants 'Highwall' Mining MX-1003",
  "Inherent Implants 'Highwall' Mining MX-1005"
];

const STRIP_MINERS = [
  "Strip Miner I",
  "Modulated Strip Miner II",
  "ORE Strip Miner"
];

const EXPEDITION_FRIGATES = [
  "Prospect",
  "Endurance",
  "Venture",
  "Venture Consortium Issue",
  "Pioneer",
  "Outrider",
  "Pioneer Consortium Issue"
];

const SURVEY_CHIPSET_OPTIONS = [
  { value: "None", label: "No Mining Survey Chipset" },
  { value: "T1", label: "Mining Survey Chipset I" },
  { value: "T2", label: "Mining Survey Chipset II" }
];

const CRYSTAL_PROFILE_ORDER = ["A I", "A II", "B I", "B II", "C I", "C II"];

function sortCrystalEntries(entries: Array<[string, MiningCrystal]>) {
  return [...entries].sort(([nameA], [nameB]) => {
    const indexFor = (name: string) => {
      const index = CRYSTAL_PROFILE_ORDER.findIndex((profile) => name.endsWith(`Type ${profile}`));
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    return indexFor(nameA) - indexFor(nameB) || nameA.localeCompare(nameB);
  });
}

function classNames(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

const infoIconMarkup = infoIconRaw.replace(/^\s*<symbol\b[^>]*>/, "").replace(/<\/symbol>\s*$/, "");

function InfoGlyph({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 128 128" className={classNames("inline-block shrink-0", className)}>
      <style>{".shape{fill:currentColor}"}</style>
      <g dangerouslySetInnerHTML={{ __html: infoIconMarkup }} />
    </svg>
  );
}

function ItemInfoLink({
  typeId,
  label
}: {
  typeId?: number | null;
  label: string;
}) {
  if (!Number.isInteger(typeId)) return null;
  return (
    <a
      href={`/items/${typeId}`}
      target="_blank"
      rel="noreferrer"
      className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 opacity-80 hover:border-[#53b6ff]/70 hover:bg-[#101b27] hover:text-[#9dd8ff] hover:opacity-100"
      title={`Show info: ${label}`}
      aria-label={`Show info: ${label}`}
    >
      <InfoGlyph className="h-3 w-3" />
    </a>
  );
}

function InfoHead({
  children,
  tip,
  id,
  className = ""
}: {
  children: React.ReactNode;
  tip: string;
  id: string;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`relative overflow-visible whitespace-nowrap border border-[#2b2d33] bg-[#14161c] px-3 py-1.5 text-left text-[11px] font-semibold tracking-[0.16em] uppercase text-slate-100 select-none ${className}`}
    >
      <span
        className="group/ih inline-flex items-center gap-1 cursor-pointer"
        aria-describedby={id}
      >
        {children}
        <span
          aria-hidden="true"
          className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-[#4b9cff]/60 bg-[#0b111a] text-[9px] font-bold leading-none text-sky-200 group-hover/ih:border-sky-400 group-hover/ih:text-sky-100"
        >
          ?
        </span>
        <div
          id={id}
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 hidden w-48 max-w-xs -translate-x-1/2 whitespace-normal break-words rounded-sm border border-[#242c3c] bg-[#050810] px-2 py-1 text-[11px] leading-snug text-slate-100 shadow-lg group-hover/ih:block"
        >
          {tip}
        </div>
      </span>
    </th>
  );
}

const ORE_SETUP_TOOL_KEY = "ore-mining";

type OreSkillKey =
  | "barge"
  | "exhumer"
  | "frigate"
  | "expedition"
  | "destroyer"
  | "mining"
  | "astrogeology"
  | "precision"
  | "exploitation";

type OreSurveyChipset = "None" | "T1" | "T2";
type ResourceType = "ore" | "moonOre";

type MiningCrystal = {
  resourceType?: ResourceType;
  durationMult?: number;
  yieldMult?: number;
};

type OreConfig = {
  ship: string;
  module: string;
  numModules: number;
  crystal: string;
  numShips: number;
  lowSlotName: string;
  lowSlotCount: number;
  surveyChipset: OreSurveyChipset;
  skills: Record<OreSkillKey, number>;
};

type OreBoostSkillKey =
  | "director"
  | "industrial"
  | "capitalIndustrial"
  | "miningDestroyer";

type OreBoost = {
  ship: string;
  director: number;
  industrial: number;
  capitalIndustrial: number;
  miningDestroyer: number;
  implant: string;
  module: string;
  bastion: string;
  efficiencyCharge: string;
};

type SavedToolSetup = {
  id: string;
  setupName: string;
  setupJson?: unknown;
  summaryJson?: {
    ship?: string;
    shipCount?: number;
    module?: string;
    boostShip?: string;
  };
  updatedAt?: string;
};

type SaveDialogMode = "create" | "update" | "rename";

const oreSkillKeys: OreSkillKey[] = [
  "barge",
  "exhumer",
  "frigate",
  "expedition",
  "destroyer",
  "mining",
  "astrogeology",
  "precision",
  "exploitation",
];

const oreBoostSkillKeys: OreBoostSkillKey[] = [
  "director",
  "industrial",
  "capitalIndustrial",
  "miningDestroyer",
];

const defaultOreConfig: OreConfig = {
  ship: "",
  module: "",
  numModules: 1,
  crystal: "",
  numShips: 1,
  lowSlotName: "",
  lowSlotCount: 0,
  surveyChipset: "None",
  skills: {
    barge: 0,
    exhumer: 0,
    frigate: 0,
    expedition: 0,
    destroyer: 0,
    mining: 0,
    astrogeology: 0,
    precision: 0,
    exploitation: 0,
  },
};

const defaultOreBoost: OreBoost = {
  ship: "None",
  director: 0,
  industrial: 0,
  capitalIndustrial: 0,
  miningDestroyer: 0,
  implant: "None",
  module: "T1",
  bastion: "No",
  efficiencyCharge: "No",
};

const industrialCoreOptions = ["No", "T1", "T2"] as const;

function isOreSkillKey(key: string): key is OreSkillKey {
  return oreSkillKeys.includes(key as OreSkillKey);
}

function isOreBoostSkillKey(key: keyof OreBoost): key is OreBoostSkillKey {
  return oreBoostSkillKeys.includes(key as OreBoostSkillKey);
}

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  const next = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.min(max, Math.max(min, next));
}

function normalizeSurveyChipset(value: unknown): OreSurveyChipset {
  return value === "T1" || value === "T2" ? value : "None";
}

function normalizeIndustrialCore(value: unknown) {
  if (value === "T1" || value === "T2") return value;
  if (value === "Yes") return "T2";
  return "No";
}

function normalizeOreConfig(raw: unknown): OreConfig {
  const source = raw && typeof raw === "object" ? raw as Partial<OreConfig> : {};
  const rawSkills = source.skills && typeof source.skills === "object"
    ? source.skills as Partial<Record<OreSkillKey, unknown>>
    : {};

  return {
    ...defaultOreConfig,
    ship: typeof source.ship === "string" ? source.ship : defaultOreConfig.ship,
    module: typeof source.module === "string" ? source.module : defaultOreConfig.module,
    numModules: clampInt(source.numModules, 1, 99, defaultOreConfig.numModules),
    crystal: typeof source.crystal === "string" ? source.crystal : defaultOreConfig.crystal,
    numShips: clampInt(source.numShips, 1, 999, defaultOreConfig.numShips),
    lowSlotName: typeof source.lowSlotName === "string" ? source.lowSlotName : defaultOreConfig.lowSlotName,
    lowSlotCount: clampInt(source.lowSlotCount, 0, 8, defaultOreConfig.lowSlotCount),
    surveyChipset: normalizeSurveyChipset(source.surveyChipset),
    skills: {
      barge: clampInt(rawSkills.barge, 0, 5, defaultOreConfig.skills.barge),
      exhumer: clampInt(rawSkills.exhumer, 0, 5, defaultOreConfig.skills.exhumer),
      frigate: clampInt(rawSkills.frigate, 0, 5, defaultOreConfig.skills.frigate),
      expedition: clampInt(rawSkills.expedition, 0, 5, defaultOreConfig.skills.expedition),
      destroyer: clampInt(rawSkills.destroyer, 0, 5, defaultOreConfig.skills.destroyer),
      mining: clampInt(rawSkills.mining, 0, 5, defaultOreConfig.skills.mining),
      astrogeology: clampInt(rawSkills.astrogeology, 0, 5, defaultOreConfig.skills.astrogeology),
      precision: clampInt(rawSkills.precision, 0, 5, defaultOreConfig.skills.precision),
      exploitation: clampInt(rawSkills.exploitation, 0, 5, defaultOreConfig.skills.exploitation),
    },
  };
}

function normalizeOreBoost(raw: unknown): OreBoost {
  const source = raw && typeof raw === "object" ? raw as Partial<OreBoost> : {};
  return {
    ...defaultOreBoost,
    ship: typeof source.ship === "string" ? source.ship : defaultOreBoost.ship,
    director: clampInt(source.director, 0, 5, defaultOreBoost.director),
    industrial: clampInt(source.industrial, 0, 5, defaultOreBoost.industrial),
    capitalIndustrial: clampInt(source.capitalIndustrial, 0, 5, defaultOreBoost.capitalIndustrial),
    miningDestroyer: clampInt(source.miningDestroyer, 0, 5, defaultOreBoost.miningDestroyer),
    implant: typeof source.implant === "string" ? source.implant : defaultOreBoost.implant,
    module: typeof source.module === "string" ? source.module : defaultOreBoost.module,
    bastion: normalizeIndustrialCore(source.bastion),
    efficiencyCharge: typeof source.efficiencyCharge === "string"
      ? source.efficiencyCharge
      : defaultOreBoost.efficiencyCharge,
  };
}

function stateFromSetupJson(setupJson: unknown) {
  const payload = setupJson && typeof setupJson === "object"
    ? setupJson as { config?: unknown; boost?: unknown; implant?: unknown; michiImplant?: unknown }
    : {};
  return {
    config: normalizeOreConfig(payload.config),
    boost: normalizeOreBoost(payload.boost),
    implant: typeof payload.implant === "string" ? payload.implant : "None",
    michiImplant: payload.michiImplant === true,
  };
}

function defaultFleetName(config: OreConfig) {
  const shipCount = Math.max(1, Math.round(config.numShips || 1));
  return `${shipCount}x ${config.ship || "Ore Fleet"}`;
}

async function readJson<T>(response: Response): Promise<T> {
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
  }
  return data as T;
}

type OreResultRow = {
  name: string;
  baseName: string;
  grade: string;
  yieldBonus: number;
  marketTypeId?: number | null;
  legacyName?: string;
  rarity?: string | null;
  family?: string | null;
  m3?: number;
  iskPerUnit: number;
  unitsPerHour: number;
  iskPerHour: number;
};

type OreResultGroup = {
  baseName: string;
  rows: OreResultRow[];
};

const MOON_RARITY_META = [
  { rarity: "R4", family: "Ubiquitous" },
  { rarity: "R8", family: "Common" },
  { rarity: "R16", family: "Uncommon" },
  { rarity: "R32", family: "Rare" },
  { rarity: "R64", family: "Exceptional" },
] as const;

const gradeOrder: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
};

function normalizeOreResults(raw: unknown): OreResultRow[] {
  if (Array.isArray(raw)) {
    return raw.map((row: any) => ({
      name: String(row?.name || row?.baseName || "Unknown Ore"),
      baseName: String(row?.baseName || row?.name || "Unknown Ore"),
      grade: String(row?.grade || "I"),
      yieldBonus: Number(row?.yieldBonus) || 0,
      marketTypeId: Number.isFinite(Number(row?.marketTypeId))
        ? Number(row.marketTypeId)
        : null,
      legacyName: typeof row?.legacyName === "string" ? row.legacyName : undefined,
      rarity: typeof row?.rarity === "string" ? row.rarity : null,
      family: typeof row?.family === "string" ? row.family : null,
      m3: Number(row?.m3) || 0,
      iskPerUnit: Number(row?.iskPerUnit) || 0,
      unitsPerHour: Number(row?.unitsPerHour) || 0,
      iskPerHour: Number(row?.iskPerHour) || 0,
    }));
  }

  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, any>).map(([name, row]) => ({
      name,
      baseName: name,
      grade: "I",
      yieldBonus: 0,
      marketTypeId: null,
      legacyName: name,
      rarity: null,
      family: null,
      m3: 0,
      iskPerUnit: Number(row?.iskPerUnit) || 0,
      unitsPerHour: Number(row?.unitsPerHour) || 0,
      iskPerHour: Number(row?.iskPerHour) || 0,
    }));
  }

  return [];
}

function formatYieldBonus(value: number) {
  if (!value) return "";
  return `+${Math.round(value * 100)}%`;
}

function formatCompactIsk(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 1 : 2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 1 : 2)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function groupedOreResults(
  raw: unknown,
  sortKey: string,
  sortAsc: boolean
): OreResultGroup[] {
  const groups = new Map<string, OreResultRow[]>();
  for (const row of normalizeOreResults(raw)) {
    const key = row.baseName || row.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const result = Array.from(groups.entries()).map(([baseName, rows]) => ({
    baseName,
    rows: rows.sort((a, b) => {
      const gradeA = gradeOrder[a.grade] || Number.MAX_SAFE_INTEGER;
      const gradeB = gradeOrder[b.grade] || Number.MAX_SAFE_INTEGER;
      return gradeA - gradeB || a.name.localeCompare(b.name);
    }),
  }));

  result.sort((a, b) => {
    if (sortKey === "ore") {
      return sortAsc
        ? a.baseName.localeCompare(b.baseName)
        : b.baseName.localeCompare(a.baseName);
    }

    const metric = (group: OreResultGroup) =>
      Math.max(...group.rows.map((row: any) => Number(row[sortKey]) || 0));
    const valA = metric(a);
    const valB = metric(b);
    return sortAsc ? valA - valB : valB - valA;
  });

  return result;
}

export default function OreCalculator() {
  const [sortKey, setSortKey] = useState("iskPerHour");
  const [sortAsc, setSortAsc] = useState(false);
  const [modules, setModules] = useState<Record<string, any>>({});
  const [ships, setShips] = useState<string[]>([]);
  const [crystals, setCrystals] = useState<Record<string, MiningCrystal>>({});
  const [output, setOutput] = useState<any>(null);
  const [activeResultTab, setActiveResultTab] = useState<ResourceType>("ore");
  const [collapsedMoonRarities, setCollapsedMoonRarities] = useState<Record<string, boolean>>({});
  const [implant, setImplant] = useState("None");
  const [michiImplant, setMichiImplant] = useState(false);
  const [shipsObj, setShipsObj] = useState<Record<string, any>>({});

  function isBargeOrExhumer(shipName: string) {
    const data = shipsObj[shipName];
    return data?.type === "barge" || data?.type === "exhumer";
  }

  function isExpeditionFrigate(shipName: string) {
    return EXPEDITION_FRIGATES.includes(shipName);
  }

  const [config, setConfig] = useState<OreConfig>(() => normalizeOreConfig(defaultOreConfig));
  const [boost, setBoost] = useState<OreBoost>(() => normalizeOreBoost(defaultOreBoost));
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [savedFleets, setSavedFleets] = useState<SavedToolSetup[]>([]);
  const [savedFleetsLoading, setSavedFleetsLoading] = useState(false);
  const [selectedFleetId, setSelectedFleetId] = useState("");
  const [setupBusy, setSetupBusy] = useState<"load" | "save" | "rename" | "delete" | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [saveDialogMode, setSaveDialogMode] = useState<SaveDialogMode | null>(null);
  const [saveName, setSaveName] = useState("");
  const selectedFleet = savedFleets.find((fleet) => fleet.id === selectedFleetId) || null;

  const [collapsed, setCollapsed] = useState({
    fleet: false,
    skills: false,
    boosts: false
  });
  const toggleSection = (section: keyof typeof collapsed) =>
    setCollapsed(prev => ({ ...prev, [section]: !prev[section] }));
  const toggleMoonRarity = (rarity: string) =>
    setCollapsedMoonRarities((current) => ({ ...current, [rarity]: !current[rarity] }));

  useEffect(() => {
    let alive = true;

    async function loadAuth() {
      try {
        const response = await fetch("/api/auth/me", { credentials: "include" });
        const data = await readJson<{ ok: boolean; authenticated: boolean; user: AuthUser | null }>(response);
        if (alive) setAuthUser(data.authenticated ? data.user : null);
      } catch {
        if (alive) setAuthUser(null);
      } finally {
        if (alive) setAuthChecked(true);
      }
    }

    function handleAuthChanged(event: Event) {
      const detail = (event as CustomEvent<SiteAuthChangeDetail>).detail;
      if (detail && "user" in detail) {
        setAuthUser(detail.user);
        setAuthChecked(true);
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
      setSavedFleets([]);
      setSelectedFleetId("");
      setSetupError(null);
      return;
    }
    void refreshSavedFleets();
  }, [authUser]);

  useEffect(() => {
    const fetchData = async () => {
      const moduleRes = await fetch("/api/data/mining_modules.json");
      const shipRes = await fetch("/api/data/mining_ship_bonuses.json");
      const crystalRes = await fetch("/api/data/mining_crystals.json");

      const modulesData = await moduleRes.json();
      const shipsObjData = await shipRes.json();
      const crystalsData = await crystalRes.json();

      setModules(modulesData);
      setShips(Object.keys(shipsObjData));
      setShipsObj(shipsObjData);
      setCrystals(crystalsData);
    };
    fetchData();
  }, []);

  useEffect(() => {
    const resourceType = crystals[config.crystal]?.resourceType;
    if (resourceType === "ore" || resourceType === "moonOre") {
      setActiveResultTab(resourceType);
    }
  }, [config.crystal, crystals]);

  const updateConfig = (key: string, value: any) => {
    if (key === "module") {
      setConfig(c => ({
        ...c,
        module: value,
        crystal: value === "Modulated Strip Miner II" ? c.crystal : ""
      }));
    } else if (key === "numModules") {
      setConfig(c => ({ ...c, numModules: clampInt(value, 1, 99, c.numModules) }));
    } else if (key === "numShips") {
      setConfig(c => ({ ...c, numShips: clampInt(value, 1, 999, c.numShips) }));
    } else if (key === "lowSlotCount") {
      setConfig(c => ({ ...c, lowSlotCount: clampInt(value, 0, 8, c.lowSlotCount) }));
    } else if (key === "surveyChipset") {
      setConfig(c => ({ ...c, surveyChipset: normalizeSurveyChipset(value) }));
    } else if (isOreSkillKey(key)) {
      setConfig(c => ({
        ...c,
        skills: {
          ...c.skills,
          [key]: clampInt(value, 0, 5, c.skills[key]),
        },
      }));
    } else if (key === "ship" || key === "crystal" || key === "lowSlotName") {
      setConfig(c => ({ ...c, [key]: String(value) }));
    }
  };

  const updateBoost = (key: keyof OreBoost, value: any) => {
    if (isOreBoostSkillKey(key)) {
      setBoost(b => ({ ...b, [key]: clampInt(value, 0, 5, b[key]) }));
    } else {
      setBoost(b => ({ ...b, [key]: String(value) }));
    }
  };

  async function calculateOre(
    nextConfig: OreConfig = config,
    nextBoost: OreBoost = boost,
    nextImplant: string = implant,
    nextMichiImplant: boolean = michiImplant
  ) {
    const res = await axios.post("/api/ore-calc", {
      config: nextConfig,
      boost: nextBoost,
      implantName: nextImplant,
      michiImplant: nextMichiImplant
    });
    setOutput(res.data);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await calculateOre();
  };

  async function refreshSavedFleets(preferredFleetId?: string) {
    if (!authUser) return;
    setSavedFleetsLoading(true);
    try {
      const response = await fetch(`/api/tool-setups/${ORE_SETUP_TOOL_KEY}`, { credentials: "include" });
      const data = await readJson<{ ok: boolean; setups: SavedToolSetup[] }>(response);
      const next = data.setups || [];
      setSavedFleets(next);
      setSelectedFleetId((prev) => {
        const candidate = preferredFleetId || prev;
        return candidate && next.some((fleet) => fleet.id === candidate) ? candidate : "";
      });
    } catch (err) {
      setSavedFleets([]);
      setSetupError((err as Error).message || "Saved fleets failed to load.");
    } finally {
      setSavedFleetsLoading(false);
    }
  }

  function setupPayload(
    name: string,
    nextConfig: OreConfig = config,
    nextBoost: OreBoost = boost,
    nextImplant: string = implant,
    nextMichiImplant: boolean = michiImplant
  ) {
    return {
      setupName: name,
      setupJson: {
        version: 1,
        config: nextConfig,
        boost: nextBoost,
        implant: nextImplant,
        michiImplant: nextMichiImplant,
      },
      summaryJson: {
        ship: nextConfig.ship,
        shipCount: nextConfig.numShips,
        module: nextConfig.module,
        boostShip: nextBoost.ship,
      },
    };
  }

  function openSaveFleetDialog() {
    if (!authUser) {
      requestSiteAuthModal("login");
      return;
    }
    setSetupError(null);
    setSaveDialogMode(selectedFleet ? "update" : "create");
    setSaveName(selectedFleet?.setupName || defaultFleetName(config));
  }

  function openRenameFleetDialog() {
    if (!authUser) {
      requestSiteAuthModal("login");
      return;
    }
    if (!selectedFleet) return;
    setSetupError(null);
    setSaveDialogMode("rename");
    setSaveName(selectedFleet.setupName);
  }

  async function handleSaveDialogSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!authUser) {
      requestSiteAuthModal("login");
      return;
    }

    const name = saveName.trim();
    if (!name) {
      setSetupError("Fleet name is required.");
      return;
    }

    try {
      if (saveDialogMode === "rename") {
        if (!selectedFleet) return;
        setSetupBusy("rename");
        const response = await fetch(`/api/tool-setups/${ORE_SETUP_TOOL_KEY}/${selectedFleet.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setupName: name }),
        });
        await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
        await refreshSavedFleets(selectedFleet.id);
      } else {
        setSetupBusy("save");
        const updating = saveDialogMode === "update" && selectedFleet;
        const response = await fetch(
          updating ? `/api/tool-setups/${ORE_SETUP_TOOL_KEY}/${selectedFleet.id}` : `/api/tool-setups/${ORE_SETUP_TOOL_KEY}`,
          {
            method: updating ? "PUT" : "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(setupPayload(name)),
          }
        );
        const data = await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
        await refreshSavedFleets(data.setup.id);
      }

      setSaveDialogMode(null);
      setSaveName("");
      setSetupError(null);
    } catch (err) {
      const message = (err as Error).message === "setup_name_exists"
        ? "A saved fleet with that name already exists."
        : (err as Error).message || "Saved fleet update failed.";
      setSetupError(message);
    } finally {
      setSetupBusy(null);
    }
  }

  async function loadSavedFleet(id: string) {
    if (!id) {
      setSelectedFleetId("");
      return;
    }
    if (!authUser) {
      requestSiteAuthModal("login");
      return;
    }

    setSetupBusy("load");
    try {
      const response = await fetch(`/api/tool-setups/${ORE_SETUP_TOOL_KEY}/${id}`, { credentials: "include" });
      const data = await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
      const nextState = stateFromSetupJson(data.setup.setupJson);
      setConfig(nextState.config);
      setBoost(nextState.boost);
      setImplant(nextState.implant);
      setMichiImplant(nextState.michiImplant);
      setSelectedFleetId(id);
      setSetupError(null);
      await calculateOre(nextState.config, nextState.boost, nextState.implant, nextState.michiImplant);
    } catch (err) {
      setSetupError((err as Error).message || "Saved fleet failed to load.");
    } finally {
      setSetupBusy(null);
    }
  }

  async function deleteSelectedFleet() {
    if (!authUser) {
      requestSiteAuthModal("login");
      return;
    }
    if (!selectedFleet) return;
    if (!window.confirm(`Delete saved fleet "${selectedFleet.setupName}"?`)) return;

    setSetupBusy("delete");
    try {
      const response = await fetch(`/api/tool-setups/${ORE_SETUP_TOOL_KEY}/${selectedFleet.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      await readJson<{ ok: boolean }>(response);
      setSelectedFleetId("");
      setSetupError(null);
      await refreshSavedFleets();
    } catch (err) {
      setSetupError((err as Error).message || "Saved fleet delete failed.");
    } finally {
      setSetupBusy(null);
    }
  }

  const handleSort = (key: string) => {
    if (sortKey === key) setSortAsc(a => !a);
    else {
      setSortKey(key);
      setSortAsc(key === "ore" ? true : false);
    }
  };

  const critChance =
    typeof output?.critChance === "number" ? output.critChance : null;
  const critYieldMultiplier =
    typeof output?.critYieldMultiplier === "number"
      ? output.critYieldMultiplier
      : 1;
  const selectedCrystalResourceType = crystals[config.crystal]?.resourceType;
  const oreTabDisabled = selectedCrystalResourceType === "moonOre";
  const moonTabDisabled = selectedCrystalResourceType === "ore";
  const activeResults = activeResultTab === "moonOre"
    ? output?.moonResult || []
    : output?.result || [];
  const normalizedActiveResults = normalizeOreResults(activeResults);
  const resultSections = activeResultTab === "moonOre"
    ? MOON_RARITY_META.map((meta) => ({
        ...meta,
        groups: groupedOreResults(
          normalizedActiveResults.filter((row) => row.rarity === meta.rarity),
          sortKey,
          sortAsc
        ),
      }))
    : [{
        rarity: null,
        family: null,
        groups: groupedOreResults(normalizedActiveResults, sortKey, sortAsc),
      }];

  return (
    <div className="tt-tool-v2 min-h-screen text-slate-100 text-[11px] leading-snug">
      <div className="tt2-frame tt2-frame--centered">
        { }
        <div className="tt2-window">
          { }
          <div className="tt2-titlebar">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
              <span className="uppercase tracking-widest text-[10px] text-slate-300">
                Science &amp; Industry ▸ Ore Mining Yield
              </span>
            </div>
            <div className="flex items-center gap-2 text-[9px] text-slate-400">
              <span className="px-1 py-0.5 bg-[#0b0d11] border border-[#303236]">
                Jita 4-4
              </span>
              <span className="text-[#53b6ff]">Triff.Tools</span>
              <span className="flex gap-1">
                <span className="h-2 w-2 bg-[#53b6ff]" />
                <span className="h-2 w-2 bg-[#3bbf5a]" />
                <span className="h-2 w-2 bg-[#bf3b3b]" />
              </span>
            </div>
          </div>

          { }
          <div className="tt2-contextbar">
            <div className="flex items-center gap-3">
              <span className="uppercase tracking-widest text-slate-300">
                Overview ▸ Ore Types
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#3bbf5a]" />
                <span>Market prices online</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
            </div>
          </div>

          { }
          <div className="border-t border-[#101622] bg-[#050810]/90 px-3 pb-4 pt-3 md:px-4 md:pb-5 md:pt-4">
            { }
            <div className="mb-4 border border-[#222b3a] bg-[#050810] px-3 py-3 text-[12px] leading-snug text-slate-200 md:px-4 md:py-3">
              <p className="mb-1">
                You can{" "}
                <span className="font-semibold text-slate-50">
                  sort by any header
                </span>{" "}
                by clicking the column title.
              </p>
              <p className="mb-1 text-slate-300">
                <span className="font-semibold text-slate-50">
                  Configure your fleet
                </span>{" "}
                and skills below to preview yield and ISK for{" "}
                <span className="text-slate-50">every asteroid and moon ore type</span>. Ice
                is not included. Mining drones remain on the
                someday™ roadmap.
              </p>
              <p className="mb-1 text-slate-300">
                <span className="font-semibold text-slate-50">
                  Updated for Catalyst:
                </span>{" "}
                accelerated mining cycles, mining crits (Mining Precision /
                Exploitation &amp; Mining Laser Efficiency burst), the new ORE /
                navy hulls, Mining Survey Chipset I/II, and Outrider boost
                bonuses.
              </p>
              <p className="mt-1 text-slate-300">
                <span className="font-semibold text-slate-50">
                  Market pricing
                </span>{" "}
                is provided by the{" "}
                <a
                  href="/api/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border-b border-sky-400/70 text-sky-300 hover:text-sky-200"
                >
                  TriffTools Market API
                </a>{" "}
                (Jita 4–4) and is kept up to date automatically.
              </p>
            </div>

            { }
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="border border-[#2c2f36] bg-[#070910] px-2 py-2">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                  <label className="min-w-0 flex-1">
                    <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-400">
                      Saved Fleets
                    </span>
                    <select
                      value={selectedFleetId}
                      disabled={!authUser || savedFleetsLoading || setupBusy === "load"}
                      onChange={(event) => void loadSavedFleet(event.target.value)}
                      className="w-full border border-[#333c4f] bg-[#050810] px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">
                        {!authChecked
                          ? "Checking account..."
                          : !authUser
                            ? "Sign in to use saved fleets"
                            : savedFleetsLoading
                              ? "Loading saved fleets..."
                              : savedFleets.length
                                ? "Select a saved fleet"
                                : "No saved fleets yet"}
                      </option>
                      {savedFleets.map((fleet) => (
                        <option key={fleet.id} value={fleet.id}>
                          {fleet.setupName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!authUser || !selectedFleet || !!setupBusy}
                      onClick={openRenameFleetDialog}
                      className="inline-flex h-7 items-center gap-1 border border-[#303236] bg-[#05070b] px-2 text-[10px] uppercase tracking-widest text-slate-300 hover:border-[#53b6ff]/60 hover:bg-[#101219] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Pencil size={12} />
                      Rename
                    </button>
                    <button
                      type="button"
                      disabled={!authUser || !selectedFleet || !!setupBusy}
                      onClick={() => void deleteSelectedFleet()}
                      className="inline-flex h-7 items-center gap-1 border border-[#4a2730] bg-[#10070a] px-2 text-[10px] uppercase tracking-widest text-[#ffaaaa] hover:border-[#bf3b3b] hover:bg-[#1d090b] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  </div>
                </div>
                {setupError && (
                  <div className="mt-2 border border-[#6b2b32] bg-[#1d090b] px-2 py-1.5 text-[11px] text-[#ffaaaa]">
                    {setupError}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                { }
                <fieldset className="border border-[#2c2f36] bg-[#070910]">
                  <legend
                    onClick={() => toggleSection("fleet")}
                    className="flex cursor-pointer items-center justify-between bg-[#101219] border-b border-[#2c2f36] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-200"
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-3 w-3 border border-[#3a4a5f] bg-[#050810]" />
                      Ship
                    </span>
                    <span className="text-[9px] text-slate-400">
                      {collapsed.fleet ? "▼" : "▲"}
                    </span>
                  </legend>
                  <div
                    className={`overflow-hidden border-t border-[#262933] transition-all duration-200 ease-out ${
                      collapsed.fleet ? "max-h-0 px-3 py-0" : "max-h-[1200px] px-3 py-3"
                    }`}
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="ship"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          Ship
                        </label>
                        <select
                          id="ship"
                          name="ship"
                          value={config.ship}
                          onChange={e => updateConfig("ship", e.target.value)}
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                        >
                          <option value="">Select Ship</option>
                          {ships.map(s => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>

                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="module"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          High Slot Module
                        </label>
                        <select
                          id="module"
                          name="module"
                          value={config.module}
                          onChange={e => updateConfig("module", e.target.value)}
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                        >
                          <option value="">Select Module</option>
                          {isBargeOrExhumer(config.ship)
                            ? STRIP_MINERS.map(m => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))
                            : isExpeditionFrigate(config.ship)
                            ? Object.keys(modules)
                                .filter(m => !STRIP_MINERS.includes(m))
                                .map(m => (
                                  <option key={m} value={m}>
                                    {m}
                                  </option>
                                ))
                            : Object.keys(modules).map(m => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                        </select>
                      </div>

                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="numModules"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          Module Count
                        </label>
                        <input
                          id="numModules"
                          name="numModules"
                          type="number"
                          min="1"
                          value={config.numModules}
                          onChange={e =>
                            updateConfig("numModules", e.target.value)
                          }
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                        />
                      </div>

                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="numShips"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          Ship Count
                        </label>
                        <input
                          id="numShips"
                          name="numShips"
                          type="number"
                          min="1"
                          value={config.numShips}
                          onChange={e =>
                            updateConfig("numShips", e.target.value)
                          }
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                        />
                      </div>

                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="lowSlotName"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          Low Slot Module
                        </label>
                        <select
                          id="lowSlotName"
                          name="lowSlotName"
                          value={config.lowSlotName}
                          onChange={e =>
                            updateConfig("lowSlotName", e.target.value)
                          }
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                        >
                          <option value="">No Low Slot</option>
                          {LOW_SLOT_UPGRADES.map(upg => (
                            <option key={upg.name} value={upg.name}>
                              {upg.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="lowSlotCount"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          Number of Low Slots
                        </label>
                        <input
                          id="lowSlotCount"
                          name="lowSlotCount"
                          type="number"
                          min="0"
                          max="8"
                          value={config.lowSlotCount}
                          onChange={e =>
                            updateConfig("lowSlotCount", e.target.value)
                          }
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                        />
                      </div>

                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="surveyChipset"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          Mining Survey Chipset
                        </label>
                        <select
                          id="surveyChipset"
                          name="surveyChipset"
                          value={config.surveyChipset}
                          onChange={e =>
                            updateConfig("surveyChipset", e.target.value)
                          }
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                        >
                          {SURVEY_CHIPSET_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="crystal"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          Mining Crystal
                        </label>
                        <select
                          id="crystal"
                          name="crystal"
                          value={config.crystal}
                          onChange={e =>
                            updateConfig("crystal", e.target.value)
                          }
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none disabled:border-[#222735] disabled:text-slate-600 focus:border-sky-400"
                          disabled={config.module !== "Modulated Strip Miner II"}
                        >
                          <option value="">No Crystal</option>
                          {config.module === "Modulated Strip Miner II" && (
                            <>
                              <optgroup label="Asteroid Mining Crystals">
                                {sortCrystalEntries(
                                  Object.entries(crystals).filter(
                                    ([, crystal]) => crystal.resourceType !== "moonOre"
                                  )
                                )
                                  .map(([name]) => (
                                    <option key={name} value={name}>
                                      {name}
                                    </option>
                                  ))}
                              </optgroup>
                              <optgroup label="Moon Mining Crystals">
                                {sortCrystalEntries(
                                  Object.entries(crystals).filter(
                                    ([, crystal]) => crystal.resourceType === "moonOre"
                                  )
                                )
                                  .map(([name]) => (
                                    <option key={name} value={name}>
                                      {name}
                                    </option>
                                  ))}
                              </optgroup>
                            </>
                          )}
                        </select>
                      </div>
                    </div>
                  </div>
                </fieldset>

                { }
                <fieldset className="border border-[#2c2f36] bg-[#070c14]">
                  <legend
                    onClick={() => toggleSection("skills")}
                    className="flex cursor-pointer items-center justify-between border-b border-[#252f3f] bg-[#101219] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-200"
                  >
                    <span className="flex items-center gap-2">
                      <span className="h-3 w-3 border border-[#3a4a5f] bg-[#050810]" />
                      Skills
                    </span>
                    <span className="text-[9px] text-slate-400">
                      {collapsed.skills ? "▼" : "▲"}
                    </span>
                  </legend>
                  <div
                    className={`overflow-hidden border-t border-[#262933] transition-all duration-200 ease-out ${
                      collapsed.skills ? "max-h-0 px-3 py-0" : "max-h-[1200px] px-3 py-3"
                    }`}
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="frigate"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          Mining Frigate Level
                        </label>
                        <input
                          id="frigate"
                          name="frigate"
                          type="number"
                          min="0"
                          max="5"
                          value={config.skills.frigate}
                          onChange={e =>
                            updateConfig("frigate", e.target.value)
                          }
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                        />
                      </div>

                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="expedition"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          Expedition Frigate Level
                        </label>
                        <input
                          id="expedition"
                          name="expedition"
                          type="number"
                          min="0"
                          max="5"
                          value={config.skills.expedition}
                          onChange={e =>
                            updateConfig("expedition", e.target.value)
                          }
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                        />
                      </div>

                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="barge"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          Mining Barge Level
                        </label>
                        <input
                          id="barge"
                          name="barge"
                          type="number"
                          min="0"
                          max="5"
                          value={config.skills.barge}
                          onChange={e =>
                            updateConfig("barge", e.target.value)
                          }
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                        />
                      </div>

                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="exhumer"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          Exhumers Level
                        </label>
                        <input
                          id="exhumer"
                          name="exhumer"
                          type="number"
                          min="0"
                          max="5"
                          value={config.skills.exhumer}
                          onChange={e =>
                            updateConfig("exhumer", e.target.value)
                          }
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                        />
                      </div>

                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="destroyer"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          Mining Destroyer Level
                        </label>
                        <input
                          id="destroyer"
                          name="destroyer"
                          type="number"
                          min="0"
                          max="5"
                          value={config.skills.destroyer}
                          onChange={e =>
                            updateConfig("destroyer", e.target.value)
                          }
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                        />
                      </div>

                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="mining"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          Mining Level
                        </label>
                        <input
                          id="mining"
                          name="mining"
                          type="number"
                          min="0"
                          max="5"
                          value={config.skills.mining}
                          onChange={e =>
                            updateConfig("mining", e.target.value)
                          }
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                        />
                      </div>

                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="astrogeology"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          Astrogeology Level
                        </label>
                        <input
                          id="astrogeology"
                          name="astrogeology"
                          type="number"
                          min="0"
                          max="5"
                          value={config.skills.astrogeology}
                          onChange={e =>
                            updateConfig("astrogeology", e.target.value)
                          }
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                        />
                      </div>

                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="precision"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          Mining Precision Level
                        </label>
                        <input
                          id="precision"
                          name="precision"
                          type="number"
                          min="0"
                          max="5"
                          value={config.skills.precision}
                          onChange={e =>
                            updateConfig("precision", e.target.value)
                          }
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                        />
                      </div>

                      { }
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="exploitation"
                          className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                        >
                          Mining Exploitation Level
                        </label>
                        <input
                          id="exploitation"
                          name="exploitation"
                          type="number"
                          min="0"
                          max="5"
                          value={config.skills.exploitation}
                          onChange={e =>
                            updateConfig("exploitation", e.target.value)
                          }
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                        />
                      </div>

                      { }
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                          <label
                            htmlFor="implant"
                            className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                          >
                            Implant
                          </label>
                          <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-300">
                            <input
                              type="checkbox"
                              checked={michiImplant}
                              onChange={e => setMichiImplant(e.target.checked)}
                              className="h-3 w-3 accent-sky-500"
                            />
                            <span>Michi&apos;s Implant</span>
                          </label>
                        </div>
                        <select
                          id="implant"
                          className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                          value={implant}
                          onChange={e => setImplant(e.target.value)}
                        >
                          {IMPLANT_OPTIONS.map(opt => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </fieldset>
              </div>

              { }
              <fieldset className="border border-[#2c2f36] bg-[#070c14]">
                <legend
                  onClick={() => toggleSection("boosts")}
                  className="flex cursor-pointer items-center justify-between border-b border-[#252f3f] bg-[#101219] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-200"
                >
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 border border-[#3a4a5f] bg-[#050810]" />
                    Boosts
                  </span>
                  <span className="text-[9px] text-slate-400">
                    {collapsed.boosts ? "▼" : "▲"}
                  </span>
                </legend>
                <div
                  className={`overflow-hidden border-t border-[#262933] transition-all duration-200 ease-out ${
                    collapsed.boosts ? "max-h-0 px-3 py-0" : "max-h-[1200px] px-3 py-3"
                  }`}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    { }
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="boostShip"
                        className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                      >
                        Boost Ship
                      </label>
                      <select
                        id="boostShip"
                        name="boostShip"
                        value={boost.ship}
                        onChange={e =>
                          updateBoost("ship", e.target.value)
                        }
                        className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                      >
                        {["None", "Gnosis", "Porpoise", "Orca", "Outrider", "Rorqual"].map(
                          ship => (
                            <option key={ship} value={ship}>
                              {ship}
                            </option>
                          )
                        )}
                      </select>
                    </div>

                    { }
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="director"
                        className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                      >
                        Mining Director
                      </label>
                      <input
                        id="director"
                        name="director"
                        type="number"
                        min="0"
                        max="5"
                        value={boost.director}
                        onChange={e =>
                          updateBoost("director", e.target.value)
                        }
                        className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                      />
                    </div>

                    { }
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="industrial"
                        className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                      >
                        Industrial Command Ships
                      </label>
                      <input
                        id="industrial"
                        name="industrial"
                        type="number"
                        min="0"
                        max="5"
                        value={boost.industrial}
                        onChange={e =>
                          updateBoost("industrial", e.target.value)
                        }
                        className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                      />
                    </div>

                    { }
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="capitalIndustrial"
                        className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                      >
                        Capital Industrial Ships
                      </label>
                      <input
                        id="capitalIndustrial"
                        name="capitalIndustrial"
                        type="number"
                        min="0"
                        max="5"
                        value={boost.capitalIndustrial}
                        onChange={e =>
                          updateBoost("capitalIndustrial", e.target.value)
                        }
                        className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                      />
                    </div>

                    { }
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="boostDestroyer"
                        className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                      >
                        Mining Destroyer (Boost)
                      </label>
                      <input
                        id="boostDestroyer"
                        name="boostDestroyer"
                        type="number"
                        min="0"
                        max="5"
                        value={boost.miningDestroyer}
                        onChange={e =>
                          updateBoost("miningDestroyer", e.target.value)
                        }
                        className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                      />
                    </div>

                    { }
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="boostImplant"
                        className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                      >
                        Boost Implant
                      </label>
                      <select
                        id="boostImplant"
                        name="boostImplant"
                        value={boost.implant}
                        onChange={e =>
                          updateBoost("implant", e.target.value)
                        }
                        className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                      >
                        <option value="None">No</option>
                        <option value="mindlink">Yes</option>
                      </select>
                    </div>

                    { }
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="moduleType"
                        className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                      >
                        Boost Type
                      </label>
                      <select
                        id="moduleType"
                        name="moduleType"
                        value={boost.module}
                        onChange={e =>
                          updateBoost("module", e.target.value)
                        }
                        className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                      >
                        <option value="T1">T1</option>
                        <option value="T2">T2</option>
                      </select>
                    </div>

                    { }
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="bastion"
                        className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                      >
                        Industrial Core
                      </label>
                      <select
                        id="bastion"
                        name="bastion"
                        value={boost.bastion}
                        onChange={e =>
                          updateBoost("bastion", e.target.value)
                        }
                        className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                      >
                        {industrialCoreOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>

                    { }
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="efficiencyCharge"
                        className="text-[10px] uppercase tracking-[0.16em] text-slate-400"
                      >
                        Mining Laser Efficiency Burst
                      </label>
                      <select
                        id="efficiencyCharge"
                        name="efficiencyCharge"
                        value={boost.efficiencyCharge}
                        onChange={e =>
                          updateBoost("efficiencyCharge", e.target.value)
                        }
                        className="h-7 w-full border border-[#333c4f] bg-[#050810] px-2 text-[11px] text-slate-100 outline-none focus:border-sky-400"
                      >
                        <option value="No">No</option>
                        <option value="Yes">Yes</option>
                      </select>
                    </div>
                  </div>
                </div>
              </fieldset>

              { }
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={!!setupBusy}
                  onClick={openSaveFleetDialog}
                  className="inline-flex min-w-[140px] items-center justify-center gap-1.5 border border-[#303236] bg-[#05070b] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-300 transition-colors hover:border-[#53b6ff]/60 hover:bg-[#101219] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save size={13} />
                  {selectedFleet ? "Update Fleet" : "Save Fleet"}
                </button>
                <button
                  className="min-w-[140px] border border-[#2b93c9] bg-gradient-to-b from-[#2b93c9] to-[#0a3959] px-7 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-50 shadow-[0_0_10px_rgba(37,150,190,0.8)] transition hover:from-[#37a3dc] hover:to-[#0c466e] focus:outline-none"
                  type="submit"
                >
                  Calculate
                </button>
              </div>
            </form>

            { }
            {output && (
              <>
                <div className="mt-5 mb-3 flex flex-wrap items-center justify-center gap-3 text-[11px]">
                  <div className="border border-[#2b3345] bg-[#050810] px-4 py-2 text-[11px] tracking-wide text-slate-200">
                    <span className="mr-1 font-semibold text-sky-300">
                      Cycle Time:
                    </span>
                    <span className="text-slate-50">
                      {output.cycleTime?.toFixed(2)}
                    </span>
                    <span className="ml-1 text-slate-400">s</span>
                  </div>
                  <div className="border border-[#2b3345] bg-[#050810] px-4 py-2 text-[11px] tracking-wide text-slate-200">
                    <span className="mr-1 font-semibold text-sky-300">
                      Yield/Cycle:
                    </span>
                    <span className="text-slate-50">
                      {output.yieldPerCycle?.toFixed(2)}
                    </span>
                    <span className="ml-1 text-slate-400">m³</span>
                  </div>
                  {critChance !== null && (
                    <div className="border border-[#2b3345] bg-[#050810] px-4 py-2 text-[11px] tracking-wide text-slate-200">
                      <span className="mr-1 font-semibold text-sky-300">
                        Crits:
                      </span>
                      <span className="text-slate-50">
                        {(critChance * 100).toFixed(2)}%
                      </span>
                      <span className="ml-1 text-slate-400">
                        chance, ~
                        {((critYieldMultiplier - 1) * 100).toFixed(1)}% avg
                        bonus
                      </span>
                    </div>
                  )}
                </div>

                { }
                <div className="mt-3 grid grid-cols-2 border border-[#252f3f] bg-[#050810] p-1">
                  <button
                    type="button"
                    disabled={oreTabDisabled}
                    onClick={() => setActiveResultTab("ore")}
                    className={classNames(
                      "h-8 border px-3 text-[10px] font-semibold uppercase tracking-[0.18em] transition-colors",
                      activeResultTab === "ore"
                        ? "border-sky-500/70 bg-[#0d2435] text-sky-100"
                        : "border-transparent bg-[#080c13] text-slate-400 hover:border-[#334155] hover:text-slate-200",
                      oreTabDisabled && "cursor-not-allowed border-transparent bg-[#06080c] text-slate-700 opacity-60"
                    )}
                  >
                    Ores
                  </button>
                  <button
                    type="button"
                    disabled={moonTabDisabled}
                    onClick={() => setActiveResultTab("moonOre")}
                    className={classNames(
                      "h-8 border px-3 text-[10px] font-semibold uppercase tracking-[0.18em] transition-colors",
                      activeResultTab === "moonOre"
                        ? "border-emerald-500/70 bg-[#0c271f] text-emerald-100"
                        : "border-transparent bg-[#080c13] text-slate-400 hover:border-[#334155] hover:text-slate-200",
                      moonTabDisabled && "cursor-not-allowed border-transparent bg-[#06080c] text-slate-700 opacity-60"
                    )}
                    title={moonTabDisabled ? "Select No Crystal or a Moon Mining Crystal to view moon ores" : undefined}
                  >
                    Moon Ores
                  </button>
                </div>

                { }
                <div className="mt-3 overflow-x-auto border border-[#252f3f] bg-[#050810]">
                  <table className="min-w-[560px] w-full border-collapse text-[11px]">
                    <thead>
                      <tr>
                        <InfoHead id="ore1" tip="Type of ore">
                          <span
                            className="cursor-pointer"
                            onClick={() => handleSort("ore")}
                          >
                            Ore {sortKey === "ore" && (sortAsc ? "▲" : "▼")}
                          </span>
                        </InfoHead>
                        <InfoHead id="grade1" tip="Current ore grade and reprocessing yield bonus">
                          Grade
                        </InfoHead>
                        <InfoHead
                          id="isk1"
                          tip="Highest buy price in Jita, per unit"
                        >
                          <span
                            className="cursor-pointer"
                            onClick={() => handleSort("iskPerUnit")}
                          >
                            ISK/unit{" "}
                            {sortKey === "iskPerUnit" &&
                              (sortAsc ? "▲" : "▼")}
                          </span>
                        </InfoHead>
                        <InfoHead
                          id="units1"
                          tip="Total raw ore units produced per hour"
                        >
                          <span
                            className="cursor-pointer"
                            onClick={() => handleSort("unitsPerHour")}
                          >
                            Units/hr{" "}
                            {sortKey === "unitsPerHour" &&
                              (sortAsc ? "▲" : "▼")}
                          </span>
                        </InfoHead>
                        <InfoHead
                          id="iskhr1"
                          tip="Estimated ISK per hour (highest buyer)"
                        >
                          <span
                            className="cursor-pointer"
                            onClick={() => handleSort("iskPerHour")}
                          >
                            ISK/hr{" "}
                            {sortKey === "iskPerHour" &&
                              (sortAsc ? "▲" : "▼")}
                          </span>
                        </InfoHead>
                      </tr>
                    </thead>
                    <tbody>
                      {resultSections.flatMap((section) => {
                        const rows: React.ReactNode[] = [];
                        if (section.rarity) {
                          rows.push(
                            <tr key={`rarity-${section.rarity}`}>
                              <th
                                colSpan={5}
                                className="border border-[#294438] bg-[#0a1713] p-0 text-left text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-200"
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleMoonRarity(section.rarity!)}
                                  aria-expanded={!collapsedMoonRarities[section.rarity]}
                                  className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-emerald-950/30"
                                >
                                  <span>
                                    {section.rarity} <span className="ml-1 text-slate-500">{section.family}</span>
                                  </span>
                                  <span className="ml-3 font-mono text-sm text-emerald-400" aria-hidden="true">
                                    {collapsedMoonRarities[section.rarity] ? "+" : "−"}
                                  </span>
                                </button>
                              </th>
                            </tr>
                          );
                        }

                        if (!section.rarity || !collapsedMoonRarities[section.rarity]) section.groups.forEach((group, groupIdx) => {
                          group.rows.forEach((data, rowIdx) => {
                            const rowTone = groupIdx % 2 === 0 ? "bg-[#070c14]" : "bg-[#050810]";
                            rows.push(
                            <tr
                              key={`${section.rarity || "ore"}-${group.baseName}-${data.grade}-${data.marketTypeId || data.name}`}
                              className={`${rowTone} hover:bg-[#111927] ${
                                rowIdx === 0 ? "border-t border-[#334155]" : ""
                              }`}
                            >
                              <td className="border border-[#1b2333] px-3 py-1.5 text-left align-top">
                                {rowIdx === 0 && (
                                  <span className="font-semibold text-slate-100">{group.baseName}</span>
                                )}
                              </td>
                              <td className="border border-[#1b2333] px-3 py-1.5 text-left">
                                <div className="flex items-center gap-2">
                                  <span className="inline-flex min-w-9 justify-center border border-[#334155] bg-[#07111d] px-1.5 py-0.5 font-mono text-[10px] text-sky-200">
                                    {data.grade}
                                  </span>
                                  {data.yieldBonus > 0 && (
                                    <span className="font-mono text-[10px] text-emerald-300">
                                      {formatYieldBonus(data.yieldBonus)}
                                    </span>
                                  )}
                                  <span
                                    className="min-w-0 flex-1 truncate text-slate-500"
                                    title={data.legacyName && data.legacyName !== data.name ? `Previously ${data.legacyName}` : data.name}
                                  >
                                    {data.legacyName && data.legacyName !== data.name ? data.legacyName : ""}
                                  </span>
                                  <ItemInfoLink typeId={data.marketTypeId} label={data.name} />
                                </div>
                              </td>
                              <td className="border border-[#1b2333] px-3 py-1.5 text-right tabular-nums">
                                {(data.iskPerUnit ?? 0).toLocaleString(
                                  undefined,
                                  {
                                    maximumFractionDigits: 2
                                  }
                                )}
                              </td>
                              <td className="border border-[#1b2333] px-3 py-1.5 text-right tabular-nums">
                                {(data.unitsPerHour ?? 0).toLocaleString(
                                  undefined,
                                  {
                                    maximumFractionDigits: 0
                                  }
                                )}
                              </td>
                              <td className="border border-[#1b2333] px-3 py-1.5 text-right tabular-nums font-semibold text-sky-200">
                                <span>{formatCompactIsk(data.iskPerHour ?? 0)}</span>
                                <span className="ml-1 text-[10px] font-normal text-slate-500">ISK/h</span>
                              </td>
                            </tr>
                            );
                          });
                        });

                        return rows;
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {saveDialogMode && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-3">
          <div className="w-full max-w-md border border-[#34404c] bg-[#070910] text-slate-100 shadow-2xl shadow-black/70">
            <div className="flex min-h-9 items-center justify-between border-b border-[#20242c] bg-[#101219] px-3 py-1.5">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-200">
                  {saveDialogMode === "rename"
                    ? "Rename Saved Fleet"
                    : saveDialogMode === "update"
                      ? "Update Saved Fleet"
                      : "Save Fleet"}
                </div>
                <div className="text-[10px] text-slate-500">
                  {saveDialogMode === "rename"
                    ? "Rename this ore mining fleet setup."
                    : "Save the current ore mining inputs to your Triff.Tools account."}
                </div>
              </div>
              <button
                type="button"
                className="text-slate-500 hover:text-slate-100"
                onClick={() => {
                  if (setupBusy) return;
                  setSaveDialogMode(null);
                  setSaveName("");
                }}
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>

            <form className="space-y-3 p-3" onSubmit={handleSaveDialogSubmit}>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-slate-500">
                  Fleet Name
                </span>
                <input
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  className="w-full border border-[#303236] bg-[#05070b] px-2 py-1.5 text-[12px] text-slate-100 outline-none focus:border-[#53b6ff]"
                  maxLength={160}
                  autoFocus
                />
              </label>

              {saveDialogMode !== "rename" && (
                <div className="border border-[#20242c] bg-[#080c13] px-2 py-2 text-[11px] leading-relaxed text-slate-400">
                  This saves ship, modules, crystals, skills, implants, and boost inputs. Prices and results recalculate when the fleet is loaded.
                </div>
              )}

              {setupError && (
                <div className="border border-[#6b2b32] bg-[#1d090b] px-2 py-1.5 text-[11px] text-[#ffaaaa]">
                  {setupError}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="inline-flex h-7 items-center justify-center gap-1 border border-[#303236] bg-[#05070b] px-2.5 text-[10px] uppercase tracking-widest text-slate-300 hover:border-[#53b6ff]/60 hover:bg-[#101219] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!!setupBusy}
                  onClick={() => {
                    setSaveDialogMode(null);
                    setSaveName("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!!setupBusy}
                  className="inline-flex h-7 items-center justify-center gap-1 border border-[#46b2ff]/70 bg-gradient-to-b from-[#1b8cc8] to-[#14608a] px-2.5 text-[10px] font-semibold uppercase tracking-widest text-slate-50 shadow-[0_0_10px_rgba(70,178,255,0.35)] hover:from-[#27a0df] hover:to-[#1672a4] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {setupBusy ? "Saving..." : saveDialogMode === "rename" ? "Rename" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
