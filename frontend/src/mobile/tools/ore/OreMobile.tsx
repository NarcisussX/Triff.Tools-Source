import { useEffect, useMemo, useState } from "react";
import { requestSiteAuthModal, SITE_AUTH_CHANGED_EVENT, type SiteAuthChangeDetail } from "../../../auth/siteAuthEvents";
import calculatorIconRaw from "../../../assets/icons/calculator.svg?raw";
import cargoContainerLockedIconRaw from "../../../assets/icons/cargocontainerlocked.svg?raw";
import fleetIconRaw from "../../../assets/icons/fleet.svg?raw";
import folderIconRaw from "../../../assets/icons/Folder.svg?raw";
import shipScanIconRaw from "../../../assets/icons/shipscan.svg?raw";
import { EveIcon, makeEveIcon } from "../../shell/EveIcon";
import {
  ToolBottomSheetV2,
  ToolMobileShellV2,
  ToolTouchRowV2,
  type ToolMobileNavItem,
} from "../../tool-ui/ToolMobileV2";

type MobileView = "fleet" | "results";
type OreSurveyChipset = "None" | "T1" | "T2";
type ResourceType = "ore" | "moonOre";

type MiningCrystal = {
  resourceType?: ResourceType;
  durationMult?: number;
  yieldMult?: number;
};

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

type OreBoostSkillKey =
  | "director"
  | "industrial"
  | "capitalIndustrial"
  | "miningDestroyer";

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

type OreOutput = {
  result?: unknown;
  moonResult?: unknown;
  compatibleResourceTypes?: ResourceType[];
  error?: string;
  cycleTime?: number;
  yieldPerCycle?: number;
  critChance?: number;
  critBonus?: number;
  critYieldMultiplier?: number;
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

type AuthUser = {
  id?: string | number;
  username?: string;
  displayName?: string;
  email?: string;
};

type MiningModule = {
  baseYield?: number;
  cycle?: number;
  charge?: boolean;
};

type ShipBonus = {
  type?: string;
};

const icons = {
  ore: makeEveIcon(cargoContainerLockedIconRaw),
  fleet: makeEveIcon(fleetIconRaw),
  results: makeEveIcon(cargoContainerLockedIconRaw),
  saved: makeEveIcon(folderIconRaw),
  calculate: makeEveIcon(calculatorIconRaw),
  ship: makeEveIcon(shipScanIconRaw),
};

const navItems: ToolMobileNavItem<MobileView>[] = [
  { key: "fleet", label: "Fleet", icon: icons.fleet },
  { key: "results", label: "Results", icon: icons.results },
];

const ORE_SETUP_TOOL_KEY = "ore-mining";

const LOW_SLOT_UPGRADES = [
  { name: "Mining Laser Upgrade II", bonus: 0.09 },
  { name: "Elara Restrained Mining Laser Upgrade", bonus: 0.08 },
  { name: "'Aoede' Mining Laser Upgrade", bonus: 0.1 },
  { name: "'Carpo' Mining Laser Upgrade", bonus: 0.09 },
  { name: "Mining Laser Upgrade I", bonus: 0.05 },
];

const IMPLANT_OPTIONS = [
  "None",
  "Inherent Implants 'Highwall' Mining MX-1001",
  "Inherent Implants 'Highwall' Mining MX-1003",
  "Inherent Implants 'Highwall' Mining MX-1005",
];

const SURVEY_CHIPSET_OPTIONS: { value: OreSurveyChipset; label: string }[] = [
  { value: "None", label: "No Mining Survey Chipset" },
  { value: "T1", label: "Mining Survey Chipset I" },
  { value: "T2", label: "Mining Survey Chipset II" },
];

const industrialCoreOptions = ["No", "T1", "T2"] as const;
const boostShips = ["None", "Gnosis", "Porpoise", "Orca", "Outrider", "Rorqual"];
const boostModules = ["T1", "T2"];
const yesNoOptions = ["No", "Yes"];

const oreSkillKeys: OreSkillKey[] = [
  "frigate",
  "expedition",
  "barge",
  "exhumer",
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

const gradeOrder: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
};

const MOON_RARITY_META = [
  { rarity: "R4", family: "Ubiquitous" },
  { rarity: "R8", family: "Common" },
  { rarity: "R16", family: "Uncommon" },
  { rarity: "R32", family: "Rare" },
  { rarity: "R64", family: "Exceptional" },
] as const;

const defaultOreConfig: OreConfig = {
  ship: "Venture",
  module: "Miner II",
  numModules: 2,
  crystal: "",
  numShips: 1,
  lowSlotName: "",
  lowSlotCount: 0,
  surveyChipset: "None",
  skills: {
    barge: 0,
    exhumer: 0,
    frigate: 5,
    expedition: 0,
    destroyer: 0,
    mining: 5,
    astrogeology: 5,
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

function classNames(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

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
  if (!response.ok) throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
  return data as T;
}

function normalizeOreResults(raw: unknown): OreResultRow[] {
  if (Array.isArray(raw)) {
    return raw.map((row: any) => ({
      name: String(row?.name || row?.baseName || "Unknown Ore"),
      baseName: String(row?.baseName || row?.name || "Unknown Ore"),
      grade: String(row?.grade || "I"),
      yieldBonus: Number(row?.yieldBonus) || 0,
      marketTypeId: Number.isFinite(Number(row?.marketTypeId)) ? Number(row.marketTypeId) : null,
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

function groupedOreResults(raw: unknown): OreResultGroup[] {
  const groups = new Map<string, OreResultRow[]>();
  for (const row of normalizeOreResults(raw)) {
    const key = row.baseName || row.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  return Array.from(groups.entries())
    .map(([baseName, rows]) => ({
      baseName,
      rows: rows.sort((a, b) => {
        const gradeA = gradeOrder[a.grade] || Number.MAX_SAFE_INTEGER;
        const gradeB = gradeOrder[b.grade] || Number.MAX_SAFE_INTEGER;
        return gradeA - gradeB || a.name.localeCompare(b.name);
      }),
    }))
    .sort((a, b) => {
      const aPrimary = primaryOreRow(a)?.iskPerHour || 0;
      const bPrimary = primaryOreRow(b)?.iskPerHour || 0;
      return bPrimary - aPrimary || a.baseName.localeCompare(b.baseName);
    });
}

function primaryOreRow(group: OreResultGroup) {
  return group.rows.find((row) => row.grade === "I") || group.rows[0] || null;
}

function formatYieldBonus(value: number) {
  if (!value) return "";
  return `+${Math.round(value * 100)}%`;
}

function isk(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || !n) return "0 ISK";
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B ISK`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M ISK`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k ISK`;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} ISK`;
}

function compactNumber(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || !n) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 1 : 2)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 1 : 2)}k`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function typeIconUrl(typeId?: number | null) {
  return typeId ? `https://images.evetech.net/types/${typeId}/icon?size=32` : "";
}

function skillLabel(skill: OreSkillKey | OreBoostSkillKey) {
  const labels: Record<string, string> = {
    frigate: "Mining Frigate",
    expedition: "Expedition Frigate",
    barge: "Mining Barge",
    exhumer: "Exhumers",
    destroyer: "Mining Destroyer",
    mining: "Mining",
    astrogeology: "Astrogeology",
    precision: "Mining Precision",
    exploitation: "Mining Exploitation",
    director: "Mining Director",
    industrial: "Industrial Command",
    capitalIndustrial: "Capital Industrial",
    miningDestroyer: "Mining Destroyer Boost",
  };
  return labels[skill] || skill;
}

export default function OreMobile() {
  const [view, setView] = useState<MobileView>("fleet");
  const [config, setConfig] = useState<OreConfig>(() => normalizeOreConfig(defaultOreConfig));
  const [boost, setBoost] = useState<OreBoost>(() => normalizeOreBoost(defaultOreBoost));
  const [implant, setImplant] = useState("None");
  const [michiImplant, setMichiImplant] = useState(false);
  const [modules, setModules] = useState<Record<string, MiningModule>>({});
  const [shipsObj, setShipsObj] = useState<Record<string, ShipBonus>>({});
  const [crystals, setCrystals] = useState<Record<string, MiningCrystal>>({});
  const [output, setOutput] = useState<OreOutput | null>(null);
  const [activeResultTab, setActiveResultTab] = useState<ResourceType>("ore");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savedSheetOpen, setSavedSheetOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [savedFleets, setSavedFleets] = useState<SavedToolSetup[]>([]);
  const [savedFleetsLoading, setSavedFleetsLoading] = useState(false);
  const [selectedFleetId, setSelectedFleetId] = useState("");
  const [saveName, setSaveName] = useState("");
  const [setupBusy, setSetupBusy] = useState<"load" | "save" | "rename" | "delete" | null>(null);
  const [setupError, setSetupError] = useState("");

  const selectedFleet = savedFleets.find((fleet) => fleet.id === selectedFleetId) || null;
  const ships = useMemo(() => Object.keys(shipsObj), [shipsObj]);
  const moduleOptions = useMemo(() => Object.keys(modules), [modules]);
  const oreGroups = useMemo(() => groupedOreResults(output?.result || []), [output]);
  const moonSections = useMemo(() => {
    const rows = normalizeOreResults(output?.moonResult || []);
    return MOON_RARITY_META.map((meta) => ({
      ...meta,
      groups: groupedOreResults(rows.filter((row) => row.rarity === meta.rarity)),
    }));
  }, [output]);

  const topSubtitle = `${config.numShips}x ${config.ship || "Ore Fleet"} - ${config.module || "No module"}`;

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
        setAuthUser(detail.user as AuthUser | null);
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
    const resourceType = crystals[config.crystal]?.resourceType;
    if (resourceType === "ore" || resourceType === "moonOre") {
      setActiveResultTab(resourceType);
    }
  }, [config.crystal, crystals]);

  useEffect(() => {
    if (!authUser) {
      setSavedFleets([]);
      setSelectedFleetId("");
      setSetupError("");
      return;
    }
    void refreshSavedFleets();
  }, [authUser]);

  useEffect(() => {
    let alive = true;

    async function loadData() {
      try {
        const [moduleRes, shipRes, crystalRes] = await Promise.all([
          fetch("/api/data/mining_modules.json"),
          fetch("/api/data/mining_ship_bonuses.json"),
          fetch("/api/data/mining_crystals.json"),
        ]);
        const [modulesData, shipsData, crystalsData] = await Promise.all([
          moduleRes.json(),
          shipRes.json(),
          crystalRes.json(),
        ]);
        if (!alive) return;
        setModules(modulesData || {});
        setShipsObj(shipsData || {});
        setCrystals(crystalsData || {});
      } catch (err) {
        if (alive) setError((err as Error).message || "Mining data failed to load.");
      }
    }

    void loadData();
    return () => {
      alive = false;
    };
  }, []);

  function updateConfig(key: string, value: unknown) {
    if (key === "module") {
      setConfig((current) => ({
        ...current,
        module: String(value),
        crystal: String(value) === "Modulated Strip Miner II" ? current.crystal : "",
      }));
    } else if (key === "numModules") {
      setConfig((current) => ({ ...current, numModules: clampInt(value, 1, 99, current.numModules) }));
    } else if (key === "numShips") {
      setConfig((current) => ({ ...current, numShips: clampInt(value, 1, 999, current.numShips) }));
    } else if (key === "lowSlotCount") {
      setConfig((current) => ({ ...current, lowSlotCount: clampInt(value, 0, 8, current.lowSlotCount) }));
    } else if (key === "surveyChipset") {
      setConfig((current) => ({ ...current, surveyChipset: normalizeSurveyChipset(value) }));
    } else if (isOreSkillKey(key)) {
      setConfig((current) => ({
        ...current,
        skills: {
          ...current.skills,
          [key]: clampInt(value, 0, 5, current.skills[key]),
        },
      }));
    } else if (key === "ship" || key === "crystal" || key === "lowSlotName") {
      setConfig((current) => ({ ...current, [key]: String(value) }));
    }
  }

  function updateBoost(key: keyof OreBoost, value: unknown) {
    if (isOreBoostSkillKey(key)) {
      setBoost((current) => ({ ...current, [key]: clampInt(value, 0, 5, current[key]) }));
    } else {
      setBoost((current) => ({ ...current, [key]: String(value) }));
    }
  }

  async function calculateOre(
    nextConfig: OreConfig = config,
    nextBoost: OreBoost = boost,
    nextImplant: string = implant,
    nextMichiImplant: boolean = michiImplant,
    options: { showResults?: boolean } = {},
  ) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/ore-calc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: nextConfig,
          boost: nextBoost,
          implantName: nextImplant,
          michiImplant: nextMichiImplant,
        }),
      });
      const data = await readJson<OreOutput>(response);
      if (data.error) throw new Error(data.error);
      setOutput(data);
      if (options.showResults !== false) setView("results");
    } catch (err) {
      setError((err as Error).message || "Ore calculation failed.");
    } finally {
      setLoading(false);
    }
  }

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
      setSetupError("");
    } catch (err) {
      setSavedFleets([]);
      setSetupError((err as Error).message || "Saved fleets failed to load.");
    } finally {
      setSavedFleetsLoading(false);
    }
  }

  function setupPayload(name: string, nextConfig: OreConfig = config, nextBoost: OreBoost = boost, nextImplant: string = implant, nextMichiImplant: boolean = michiImplant) {
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

  function openSavedSheet() {
    setSetupError("");
    setSaveName(selectedFleet?.setupName || defaultFleetName(config));
    setSavedSheetOpen(true);
    if (authUser) void refreshSavedFleets(selectedFleetId || undefined);
  }

  async function saveCurrentFleet(mode: "create" | "update") {
    if (!authUser) {
      requestSiteAuthModal("login");
      return;
    }

    const name = saveName.trim() || defaultFleetName(config);
    if (!name) {
      setSetupError("Fleet name is required.");
      return;
    }

    const updating = mode === "update" && selectedFleet;
    setSetupBusy("save");
    try {
      const response = await fetch(
        updating ? `/api/tool-setups/${ORE_SETUP_TOOL_KEY}/${selectedFleet.id}` : `/api/tool-setups/${ORE_SETUP_TOOL_KEY}`,
        {
          method: updating ? "PUT" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(setupPayload(name)),
        },
      );
      const data = await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
      setSaveName(data.setup.setupName);
      setSetupError("");
      await refreshSavedFleets(data.setup.id);
    } catch (err) {
      setSetupError((err as Error).message === "setup_name_exists"
        ? "A saved fleet with that name already exists."
        : (err as Error).message || "Saved fleet update failed.");
    } finally {
      setSetupBusy(null);
    }
  }

  async function renameSelectedFleet() {
    if (!authUser) {
      requestSiteAuthModal("login");
      return;
    }
    if (!selectedFleet) return;

    const name = saveName.trim();
    if (!name) {
      setSetupError("Fleet name is required.");
      return;
    }

    setSetupBusy("rename");
    try {
      const response = await fetch(`/api/tool-setups/${ORE_SETUP_TOOL_KEY}/${selectedFleet.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupName: name }),
      });
      await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
      setSetupError("");
      await refreshSavedFleets(selectedFleet.id);
    } catch (err) {
      setSetupError((err as Error).message === "setup_name_exists"
        ? "A saved fleet with that name already exists."
        : (err as Error).message || "Saved fleet rename failed.");
    } finally {
      setSetupBusy(null);
    }
  }

  async function loadSavedFleet(id = selectedFleetId) {
    if (!id) return;
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
      setSaveName(data.setup.setupName);
      setSetupError("");
      setSavedSheetOpen(false);
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
      setSaveName(defaultFleetName(config));
      setSetupError("");
      await refreshSavedFleets();
    } catch (err) {
      setSetupError((err as Error).message || "Saved fleet delete failed.");
    } finally {
      setSetupBusy(null);
    }
  }

  const actions = (
    <div className="grid grid-cols-2 gap-1">
      <button type="button" className="mobile-ore-button" onClick={openSavedSheet}>
        <EveIcon icon={icons.saved} className="h-4 w-4" />
        Saved
      </button>
      <button
        type="button"
        disabled={loading}
        className="inline-flex min-h-8 items-center justify-center gap-1 border border-[#46b2ff]/70 bg-gradient-to-b from-[#1b8cc8] to-[#14608a] px-1.5 text-[9px] font-semibold uppercase tracking-widest text-slate-50 shadow-[0_0_10px_rgba(70,178,255,0.25)] disabled:opacity-50"
        onClick={() => void calculateOre()}
      >
        <EveIcon icon={icons.calculate} className="h-4 w-4" />
        {loading ? "Calc..." : "Calc"}
      </button>
    </div>
  );

  return (
    <ToolMobileShellV2
      title="Ore Mining"
      subtitle={topSubtitle}
      icon={icons.ore}
      actions={actions}
      navItems={navItems}
      activeView={view}
      onView={setView}
    >
      <style>{`
        .mobile-ore-button {
          display: inline-flex;
          min-height: 2rem;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
          border: 1px solid #303236;
          background: #05070b;
          padding: 0 0.375rem;
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: #cbd5e1;
        }
        .mobile-ore-input {
          min-height: 2.25rem;
          border: 1px solid #303236;
          background: #05070b;
          padding: 0.25rem 0.5rem;
          font-size: 16px;
          line-height: 1.25;
          color: #f8fafc;
          outline: none;
        }
        .mobile-ore-slider {
          height: 1.25rem;
          accent-color: #53b6ff;
        }
      `}</style>

      {error && (
        <div className="mb-1.5 border border-[#6b2b32] bg-[#1d090b] px-2 py-1.5 text-[12px] text-[#ffaaaa]">
          {error}
        </div>
      )}

      {view === "fleet" && (
        <FleetView
          config={config}
          boost={boost}
          implant={implant}
          michiImplant={michiImplant}
          ships={ships}
          modules={moduleOptions}
          crystals={crystals}
          onConfig={updateConfig}
          onBoost={updateBoost}
          onImplant={setImplant}
          onMichiImplant={setMichiImplant}
        />
      )}

      {view === "results" && (
        <ResultsView
          loading={loading}
          output={output}
          activeTab={activeResultTab}
          oreGroups={oreGroups}
          moonSections={moonSections}
          oreTabDisabled={crystals[config.crystal]?.resourceType === "moonOre"}
          moonTabDisabled={crystals[config.crystal]?.resourceType === "ore"}
          onTab={setActiveResultTab}
          onCalculate={() => void calculateOre()}
        />
      )}

      {savedSheetOpen && (
        <SavedFleetsSheet
          authChecked={authChecked}
          authUser={authUser}
          fleets={savedFleets}
          loading={savedFleetsLoading}
          busy={setupBusy}
          error={setupError}
          selectedFleetId={selectedFleetId}
          selectedFleet={selectedFleet}
          saveName={saveName}
          onClose={() => setSavedSheetOpen(false)}
          onSignIn={() => requestSiteAuthModal("login")}
          onSelect={(fleet) => {
            setSelectedFleetId(fleet.id);
            setSaveName(fleet.setupName);
            setSetupError("");
          }}
          onName={setSaveName}
          onRefresh={() => void refreshSavedFleets(selectedFleetId || undefined)}
          onSaveNew={() => void saveCurrentFleet("create")}
          onUpdate={() => void saveCurrentFleet("update")}
          onRename={() => void renameSelectedFleet()}
          onLoad={() => void loadSavedFleet()}
          onDelete={() => void deleteSelectedFleet()}
        />
      )}
    </ToolMobileShellV2>
  );
}

function FleetView({
  config,
  boost,
  implant,
  michiImplant,
  ships,
  modules,
  crystals,
  onConfig,
  onBoost,
  onImplant,
  onMichiImplant,
}: {
  config: OreConfig;
  boost: OreBoost;
  implant: string;
  michiImplant: boolean;
  ships: string[];
  modules: string[];
  crystals: Record<string, MiningCrystal>;
  onConfig: (key: string, value: unknown) => void;
  onBoost: (key: keyof OreBoost, value: unknown) => void;
  onImplant: (value: string) => void;
  onMichiImplant: (value: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      <section className="border border-[#2c2f36] bg-[#070910] p-2">
        <SectionTitle title="Fleet" />
        <div className="space-y-2">
          <SelectField
            label="Ship"
            value={config.ship}
            options={(ships.length ? ships : [config.ship]).filter(Boolean).map((ship) => ({ label: ship, value: ship }))}
            onChange={(ship) => onConfig("ship", ship)}
          />
          <SelectField
            label="Module"
            value={config.module}
            options={(modules.length ? modules : [config.module]).filter(Boolean).map((module) => ({ label: module, value: module }))}
            onChange={(module) => onConfig("module", module)}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Modules"
              value={config.numModules}
              min={1}
              max={99}
              onChange={(numModules) => onConfig("numModules", numModules)}
            />
            <NumberField
              label="Ships"
              value={config.numShips}
              min={1}
              max={999}
              onChange={(numShips) => onConfig("numShips", numShips)}
            />
          </div>
          <SelectField
            label="Mining Crystal"
            value={config.crystal}
            options={[{ label: "No Crystal", value: "" }]}
            optionGroups={[
              {
                label: "Asteroid Mining Crystals",
                options: sortCrystalEntries(
                  Object.entries(crystals).filter(
                    ([, crystal]) => crystal.resourceType !== "moonOre"
                  )
                )
                  .map(([name]) => ({ label: name, value: name })),
              },
              {
                label: "Moon Mining Crystals",
                options: sortCrystalEntries(
                  Object.entries(crystals).filter(
                    ([, crystal]) => crystal.resourceType === "moonOre"
                  )
                )
                  .map(([name]) => ({ label: name, value: name })),
              },
            ]}
            disabled={config.module !== "Modulated Strip Miner II"}
            onChange={(crystal) => onConfig("crystal", crystal)}
          />
          <SelectField
            label="Implant"
            value={implant}
            options={IMPLANT_OPTIONS.map((option) => ({ label: option, value: option }))}
            onChange={onImplant}
          />
          <label className="flex h-9 cursor-pointer items-center gap-2 border border-[#30343c] bg-[#090c13] px-2 text-[12px] text-slate-100">
            <input
              type="checkbox"
              checked={michiImplant}
              onChange={(event) => onMichiImplant(event.target.checked)}
              className="h-4 w-4 accent-sky-500"
            />
            <span>Michi&apos;s Implant</span>
          </label>
        </div>
      </section>

      <section className="border border-[#2c2f36] bg-[#070910] p-2">
        <SectionTitle title="Upgrades" />
        <div className="space-y-2">
          <SelectField
            label="Low Slot Upgrade"
            value={config.lowSlotName}
            options={[
              { label: "No Low Slot", value: "" },
              ...LOW_SLOT_UPGRADES.map((upgrade) => ({ label: upgrade.name, value: upgrade.name })),
            ]}
            onChange={(lowSlotName) => onConfig("lowSlotName", lowSlotName)}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Low Slots"
              value={config.lowSlotCount}
              min={0}
              max={8}
              onChange={(lowSlotCount) => onConfig("lowSlotCount", lowSlotCount)}
            />
            <SelectField
              label="Survey Chip"
              value={config.surveyChipset}
              options={SURVEY_CHIPSET_OPTIONS}
              onChange={(surveyChipset) => onConfig("surveyChipset", surveyChipset)}
            />
          </div>
        </div>
      </section>

      <section className="border border-[#2c2f36] bg-[#070910] p-2">
        <SectionTitle title="Skills" />
        <div className="space-y-1.5">
          {oreSkillKeys.map((skill) => (
            <LevelSlider
              key={skill}
              label={skillLabel(skill)}
              value={config.skills[skill]}
              onChange={(value) => onConfig(skill, value)}
            />
          ))}
        </div>
      </section>

      <section className="border border-[#2c2f36] bg-[#070910] p-2">
        <SectionTitle title="Boosts" />
        <div className="space-y-2">
          <SelectField
            label="Boost Ship"
            value={boost.ship}
            options={boostShips.map((ship) => ({ label: ship, value: ship }))}
            onChange={(ship) => onBoost("ship", ship)}
          />
          <div className="space-y-1.5">
            {oreBoostSkillKeys.map((skill) => (
              <LevelSlider
                key={skill}
                label={skillLabel(skill)}
                value={boost[skill]}
                onChange={(value) => onBoost(skill, value)}
              />
            ))}
          </div>
          <SelectField
            label="Boost Implant"
            value={boost.implant}
            options={[
              { label: "No", value: "None" },
              { label: "Yes", value: "mindlink" },
            ]}
            onChange={(value) => onBoost("implant", value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label="Boost Type"
              value={boost.module}
              options={boostModules.map((module) => ({ label: module, value: module }))}
              onChange={(module) => onBoost("module", module)}
            />
            <SelectField
              label="Industrial Core"
              value={boost.bastion}
              options={industrialCoreOptions.map((value) => ({ label: value, value }))}
              onChange={(bastion) => onBoost("bastion", bastion)}
            />
          </div>
          <SelectField
            label="Mining Laser Efficiency Burst"
            value={boost.efficiencyCharge}
            options={yesNoOptions.map((value) => ({ label: value, value }))}
            onChange={(efficiencyCharge) => onBoost("efficiencyCharge", efficiencyCharge)}
          />
        </div>
      </section>
    </div>
  );
}

function ResultsView({
  loading,
  output,
  activeTab,
  oreGroups,
  moonSections,
  oreTabDisabled,
  moonTabDisabled,
  onTab,
  onCalculate,
}: {
  loading: boolean;
  output: OreOutput | null;
  activeTab: ResourceType;
  oreGroups: OreResultGroup[];
  moonSections: Array<{ rarity: string; family: string; groups: OreResultGroup[] }>;
  oreTabDisabled: boolean;
  moonTabDisabled: boolean;
  onTab: (tab: ResourceType) => void;
  onCalculate: () => void;
}) {
  const [collapsedRarities, setCollapsedRarities] = useState<Record<string, boolean>>({});

  if (!output) {
    return (
      <section className="border border-[#2c2f36] bg-[#070910] p-3">
        <div className="text-[12px] font-semibold uppercase tracking-widest text-slate-200">No Results Yet</div>
        <div className="mt-1 text-[12px] leading-snug text-slate-400">
          Configure the fleet, then calculate to rank ores and moon ores by estimated Jita buy ISK per hour.
        </div>
        <button
          type="button"
          disabled={loading}
          className="mobile-ore-button mt-3 min-h-9 w-full border-[#46b2ff]/70 text-[#dff3ff] disabled:opacity-50"
          onClick={onCalculate}
        >
          {loading ? "Calculating..." : "Calculate Ore"}
        </button>
      </section>
    );
  }

  const critChance = typeof output.critChance === "number" ? output.critChance : null;
  const critYieldMultiplier = typeof output.critYieldMultiplier === "number" ? output.critYieldMultiplier : 1;
  const activeGroupCount = activeTab === "ore"
    ? oreGroups.length
    : moonSections.reduce((total, section) => total + section.groups.length, 0);

  return (
    <div className="space-y-1.5">
      <section className="border border-[#303236] bg-[#05070b]/95">
        <div className="border-b border-[#151922] px-2 py-2">
          <div className="truncate text-[11px] font-semibold uppercase tracking-widest text-slate-200">
            {activeTab === "ore" ? "Ore Results" : "Moon Ore Results"}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
            {activeGroupCount} ore groups - sorted by grade I ISK/hr
          </div>
        </div>
        <div className="grid grid-cols-3 gap-px bg-[#151922] p-px">
          <MetricTile label="Cycle" value={`${Number(output.cycleTime || 0).toFixed(1)}s`} />
          <MetricTile label="Yield" value={`${compactNumber(output.yieldPerCycle)} m3`} />
          <MetricTile
            label="Crits"
            value={critChance === null ? "0%" : `${(critChance * 100).toFixed(1)}%`}
            sub={critChance === null ? undefined : `+${((critYieldMultiplier - 1) * 100).toFixed(1)}% avg`}
          />
        </div>
      </section>

      <div className="grid grid-cols-2 border border-[#303236] bg-[#05070b] p-1">
        <button
          type="button"
          disabled={oreTabDisabled}
          onClick={() => onTab("ore")}
          className={classNames(
            "min-h-9 border px-2 text-[10px] font-semibold uppercase tracking-widest",
            activeTab === "ore"
              ? "border-[#46b2ff]/70 bg-[#0d2435] text-[#dff3ff]"
              : "border-transparent bg-[#080c13] text-slate-400",
            oreTabDisabled && "cursor-not-allowed border-transparent bg-[#06080c] text-slate-700 opacity-60"
          )}
        >
          Ores
        </button>
        <button
          type="button"
          disabled={moonTabDisabled}
          onClick={() => onTab("moonOre")}
          className={classNames(
            "min-h-9 border px-2 text-[10px] font-semibold uppercase tracking-widest",
            activeTab === "moonOre"
              ? "border-emerald-500/70 bg-[#0c271f] text-emerald-100"
              : "border-transparent bg-[#080c13] text-slate-400",
            moonTabDisabled && "cursor-not-allowed border-transparent bg-[#06080c] text-slate-700 opacity-60"
          )}
        >
          Moon Ores
        </button>
      </div>

      <div className="space-y-1.5">
        {activeTab === "ore"
          ? oreGroups.map((group) => (
              <OreCard key={group.baseName} group={group} />
            ))
          : moonSections.map((section) => (
              <section key={section.rarity} className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setCollapsedRarities((current) => ({
                    ...current,
                    [section.rarity]: !current[section.rarity],
                  }))}
                  aria-expanded={!collapsedRarities[section.rarity]}
                  className="flex w-full items-center justify-between border border-[#294438] bg-[#0a1713] px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200"
                >
                  <span>
                    {section.rarity} <span className="ml-1 text-slate-500">{section.family}</span>
                  </span>
                  <span className="ml-3 font-mono text-sm text-emerald-400" aria-hidden="true">
                    {collapsedRarities[section.rarity] ? "+" : "−"}
                  </span>
                </button>
                {!collapsedRarities[section.rarity] && section.groups.map((group) => (
                    <OreCard key={`${section.rarity}-${group.baseName}`} group={group} />
                  ))}
              </section>
            ))}
      </div>
    </div>
  );
}

function OreCard({ group }: { group: OreResultGroup }) {
  const [expanded, setExpanded] = useState(false);
  const primary = primaryOreRow(group);
  const rows = expanded ? group.rows : primary ? [primary] : [];

  return (
    <section className="border border-[#2c2f36] bg-[#070910]">
      <button
        type="button"
        className="w-full border-b border-[#151922] px-2 py-2 text-left active:border-[#53b6ff]/70"
        onClick={() => setExpanded((value) => !value)}
      >
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-slate-100">{group.baseName}</div>
          <div className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-widest text-slate-500">
            {expanded ? "Tap to collapse" : "Tap for all grades"}
          </div>
        </div>
      </button>
      <div className="border-b border-[#151922] px-2 py-1">
        <div className="grid grid-cols-[36px_repeat(4,minmax(0,1fr))] gap-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">
          <span />
          <span>Grade</span>
          <span className="text-right">ISK/u</span>
          <span className="text-right">Units/hr</span>
          <span className="text-right">ISK/hr</span>
        </div>
      </div>
      <div className="divide-y divide-[#151922] px-2">
        {rows.map((row) => (
          <div
            key={`${row.baseName}-${row.grade}-${row.marketTypeId || row.name}`}
            className="grid grid-cols-[36px_repeat(4,minmax(0,1fr))] items-center gap-2 py-2.5"
          >
            <span className="flex h-8 w-8 items-center justify-center">
              {row.marketTypeId ? (
                <img src={typeIconUrl(row.marketTypeId)} alt="" className="h-8 w-8" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center border border-[#303236] bg-[#05070b] text-[#8bd3ff]">
                  <EveIcon icon={icons.ore} className="h-5 w-5" />
                </span>
              )}
            </span>
            <span className="font-mono text-[12px] text-slate-100">
              {row.grade}
              {row.yieldBonus > 0 && <span className="ml-1 text-[10px] text-emerald-300">{formatYieldBonus(row.yieldBonus)}</span>}
            </span>
            <span className="text-right font-mono text-[12px] text-slate-300">{compactNumber(row.iskPerUnit)}</span>
            <span className="text-right font-mono text-[12px] text-slate-300">{compactNumber(row.unitsPerHour)}</span>
            <span className="text-right font-mono text-[12px] font-semibold text-[#8bd3ff]">{compactNumber(row.iskPerHour)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SavedFleetsSheet({
  authChecked,
  authUser,
  fleets,
  loading,
  busy,
  error,
  selectedFleetId,
  selectedFleet,
  saveName,
  onClose,
  onSignIn,
  onSelect,
  onName,
  onRefresh,
  onSaveNew,
  onUpdate,
  onRename,
  onLoad,
  onDelete,
}: {
  authChecked: boolean;
  authUser: AuthUser | null;
  fleets: SavedToolSetup[];
  loading: boolean;
  busy: "load" | "save" | "rename" | "delete" | null;
  error: string;
  selectedFleetId: string;
  selectedFleet: SavedToolSetup | null;
  saveName: string;
  onClose: () => void;
  onSignIn: () => void;
  onSelect: (fleet: SavedToolSetup) => void;
  onName: (value: string) => void;
  onRefresh: () => void;
  onSaveNew: () => void;
  onUpdate: () => void;
  onRename: () => void;
  onLoad: () => void;
  onDelete: () => void;
}) {
  const disabled = Boolean(busy);

  return (
    <ToolBottomSheetV2 title="Saved Fleets" subtitle={authUser ? "Save and load ore setups" : "Sign in required"} onClose={onClose}>
      <div className="space-y-2 p-2">
        {!authChecked && (
          <div className="border border-[#20242c] bg-[#05070b] px-2 py-3 text-[12px] text-slate-400">
            Checking account...
          </div>
        )}

        {authChecked && !authUser && (
          <div className="space-y-2 border border-[#20242c] bg-[#05070b] p-2">
            <div className="text-[12px] text-slate-300">
              Saved ore fleets are tied to your Triff.Tools account.
            </div>
            <button type="button" className="mobile-ore-button min-h-9 w-full" onClick={onSignIn}>
              Sign In
            </button>
          </div>
        )}

        {authUser && (
          <>
            <section className="border border-[#2c2f36] bg-[#070910] p-2">
              <SectionTitle title={selectedFleet ? "Selected Fleet" : "Save Current Fleet"} />
              <input
                className="mobile-ore-input w-full"
                value={saveName}
                placeholder="Fleet name"
                disabled={disabled}
                maxLength={160}
                onChange={(event) => onName(event.target.value)}
              />
              {selectedFleet ? (
                <>
                  <div className="mt-2 grid grid-cols-2 gap-1">
                    <button type="button" className="mobile-ore-button min-h-9" disabled={disabled} onClick={onSaveNew}>
                      Save New
                    </button>
                    <button type="button" className="mobile-ore-button min-h-9" disabled={disabled} onClick={onUpdate}>
                      {busy === "save" ? "Saving..." : "Update"}
                    </button>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-1">
                    <button type="button" className="mobile-ore-button min-h-9" disabled={disabled} onClick={onRename}>
                      Rename
                    </button>
                    <button type="button" className="mobile-ore-button min-h-9" disabled={disabled} onClick={onLoad}>
                      {busy === "load" ? "Loading..." : "Load"}
                    </button>
                    <button type="button" className="mobile-ore-button min-h-9 border-[#6b2b32] text-[#ffaaaa]" disabled={disabled} onClick={onDelete}>
                      Delete
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className="mobile-ore-button mt-2 min-h-9 w-full" disabled={disabled} onClick={onSaveNew}>
                  {busy === "save" ? "Saving..." : "Save Fleet"}
                </button>
              )}
            </section>

            {error && (
              <div className="border border-[#6b2b32] bg-[#1d090b] px-2 py-1.5 text-[12px] text-[#ffaaaa]">
                {error}
              </div>
            )}

            <section className="border border-[#2c2f36] bg-[#070910]">
              <div className="grid grid-cols-[1fr,82px] items-center gap-2 border-b border-[#151922] px-2 py-2">
                <SectionTitle title="Saved" />
                <button type="button" className="mobile-ore-button min-h-8" disabled={disabled || loading} onClick={onRefresh}>
                  Refresh
                </button>
              </div>
              {loading && <div className="px-2 py-3 text-[12px] text-slate-500">Loading saved fleets...</div>}
              {!loading && fleets.length === 0 && <div className="px-2 py-3 text-[12px] text-slate-500">No saved fleets yet.</div>}
              {!loading && fleets.map((fleet) => {
                const shipCount = Number(fleet.summaryJson?.shipCount) || 1;
                const ship = fleet.summaryJson?.ship || "Ore Fleet";
                const module = fleet.summaryJson?.module || "";
                return (
                  <ToolTouchRowV2
                    key={fleet.id}
                    title={fleet.setupName}
                    subtitle={`${shipCount}x ${ship}${module ? ` - ${module}` : ""}`}
                    icon={<EveIcon icon={icons.saved} className="h-5 w-5 text-[#8bd3ff]" />}
                    active={fleet.id === selectedFleetId}
                    right={fleet.id === selectedFleetId ? "selected" : undefined}
                    onClick={() => onSelect(fleet)}
                  />
                );
              })}
            </section>
          </>
        )}
      </div>
    </ToolBottomSheetV2>
  );
}

function SelectField({
  label,
  value,
  options,
  optionGroups = [],
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  optionGroups?: Array<{
    label: string;
    options: { label: string; value: string }[];
  }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[9px] uppercase tracking-widest text-slate-500">{label}</span>
      <select
        className="mobile-ore-input w-full disabled:border-[#20242c] disabled:text-slate-600"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>{option.label}</option>
        ))}
        {optionGroups.map((group) => (
          <optgroup key={`${label}-${group.label}`} label={group.label}>
            {group.options.map((option) => (
              <option key={`${label}-${group.label}-${option.value}`} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[9px] uppercase tracking-widest text-slate-500">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        className="mobile-ore-input w-full text-right"
        value={value}
        onChange={(event) => onChange(clampInt(event.target.value, min, max, value))}
      />
    </label>
  );
}

function LevelSlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block min-w-0">
      <div className="mb-1 grid grid-cols-[1fr,36px] items-center gap-2">
        <span className="truncate text-[9px] uppercase tracking-widest text-slate-500">{label}</span>
        <span className="text-right font-mono text-[10px] text-[#8bd3ff]">{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={5}
        step={1}
        value={value}
        className="mobile-ore-slider w-full"
        onChange={(event) => onChange(clampInt(event.target.value, 0, 5, value))}
      />
    </label>
  );
}

function MetricTile({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "danger" }) {
  return (
    <div className="min-w-0 border border-[#20242c] bg-[#05070b] px-2 py-1.5">
      <div className="truncate text-[8px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={classNames("mt-0.5 truncate font-mono text-[11px] font-semibold", tone === "danger" ? "text-[#ffaaaa]" : "text-slate-100")}>
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-[9px] text-slate-500">{sub}</div>}
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-300">{title}</div>;
}
