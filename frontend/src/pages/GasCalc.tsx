/*
 * React page for /gas-calc.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { Pencil, Save, Trash2, X } from "lucide-react";
import infoIconRaw from "../assets/icons/info.svg?raw";
import {
  requestSiteAuthModal,
  SITE_AUTH_CHANGED_EVENT,
  type SiteAuthChangeDetail,
} from "../auth/siteAuthEvents";
import type { AuthUser } from "../components/fitting/types";

type ShipClass = "F" | "C" | "B" | "T";

interface GasSiteRat {
  qty: number;
  name: string;
  class: ShipClass;
  ehp: number;
  dps: number;
  alpha: number;
  sig: number;
  orbit: string;
  dist: string;
  scram?: number;
  web?: number;
  neut?: number;
  rrep?: number;
}

interface GasSiteInfo {
  siteName: string;
  rats: GasSiteRat[];
}

type GasSiteKey =
  | "Barren"
  | "Token"
  | "Minor"
  | "Ordinary"
  | "Sizeable"
  | "Bountiful"
  | "Vast"
  | "Vital"
  | "Instrumental";

const gasSiteNpcData: Record<GasSiteKey, GasSiteInfo> = {
  Barren: {
    siteName: "Barren Perimeter Reservoir",
    rats: [
      {
        qty: 3,
        name: "Emergent Patroller",
        class: "F",
        ehp: 3000,
        dps: 16,
        alpha: 115,
        sig: 35,
        orbit: "250 m/s",
        dist: "8,000 m"
      },
      {
        qty: 2,
        name: "Emergent Watchman",
        class: "F",
        ehp: 2000,
        dps: 12,
        alpha: 95,
        sig: 35,
        orbit: "275 m/s",
        dist: "5,000 m",
        neut: -3,
      },
    ]
  },
  Token: {
    siteName: "Token Perimeter Reservoir",
    rats: [
      {
        qty: 2,
        name: "Emergent Escort",
        class: "F",
        ehp: 1300,
        dps: 23,
        alpha: 163,
        sig: 35,
        orbit: "300 m/s",
        dist: "5,000 m",
        web: 1,
      },
      {
        qty: 1,
        name: "Awakened Watchman",
        class: "C",
        ehp: 8750,
        dps: 31,
        alpha: 266,
        sig: 150,
        orbit: "200 m/s",
        dist: "30,000 m",
        neut: -6,
      },
    ],
  },
  Minor: {
    siteName: "Minor Perimeter Reservoir",
    rats: [
      {
        qty: 2,
        name: "Awakened Patroller",
        class: "C",
        ehp: 19167,
        dps: 42,
        alpha: 432,
        sig: 150,
        orbit: "170 m/s",
        dist: "15,000 m"
      }
    ]
  },
  Ordinary: {
    siteName: "Ordinary Perimeter Reservoir",
rats: [
      {
        qty: 3,
        name: "Emergent Patroller",
        class: "F",
        ehp: 3000,
        dps: 16,
        alpha: 115,
        sig: 35,
        orbit: "250 m/s",
        dist: "8,000 m"
      },
      {
        qty: 3,
        name: "Emergent Watchman",
        class: "F",
        ehp: 2000,
        dps: 12,
        alpha: 95,
        sig: 35,
        orbit: "275 m/s",
        dist: "5,000 m",
        neut: -3,
      },
    ]
  },
  Sizeable: {
    siteName: "Sizeable Perimeter Reservoir",
    rats: [
      {
        qty: 3,
        name: "Emergent Patroller",
        class: "F",
        ehp: 3000,
        dps: 16,
        alpha: 115,
        sig: 35,
        orbit: "250 m/s",
        dist: "8,000 m"
      },
      {
        qty: 3,
        name: "Emergent Watchman",
        class: "F",
        ehp: 2000,
        dps: 12,
        alpha: 95,
        sig: 35,
        orbit: "275 m/s",
        dist: "5,000 m",
        neut: -3,
      },
    ]
  },
  Bountiful: {
    siteName: "Bountiful Frontier Reservoir",
    rats: [
      {
        qty: 6,
        name: "Emergent Defender",
        class: "F",
        ehp: 4200,
        dps: 23,
        alpha: 161,
        sig: 35,
        orbit: "270 m/s",
        dist: "6,500 m",
        web: 1,
      },
      {
        qty: 4,
        name: "Awakened Defender",
        class: "C",
        ehp: 26833,
        dps: 59,
        alpha: 605,
        sig: 150,
        orbit: "185 m/s",
        dist: "15,000 m",
      },
    ],
  },
  Vast: {
    siteName: "Vast Frontier Reservoir",
    rats: [
      {
        qty: 4,
        name: "Awakened Defender",
        class: "C",
        ehp: 26833,
        dps: 59,
        alpha: 605,
        sig: 150,
        orbit: "185 m/s",
        dist: "15,000 m",
      },
      {
        qty: 4,
        name: "Awakened Upholder",
        class: "C",
        ehp: 12250,
        dps: 43,
        alpha: 372,
        sig: 150,
        orbit: "216 m/s",
        dist: "30,000 m",
        web: 1,
        neut: -6,
      },
    ],
  },
  Vital: {
    siteName: "Vital Core Reservoir",
    rats: [
      {
        qty: 4,
        name: "Emergent Keeper",
        class: "F",
        ehp: 4400,
        dps: 22,
        alpha: 171,
        sig: 26,
        orbit: "320 m/s",
        dist: "5,000 m",
        neut: -3,
        rrep: 26,
      },
      {
        qty: 4,
        name: "Sleepless Keeper",
        class: "B",
        ehp: 88629,
        dps: 565,
        alpha: 3802,
        sig: 400,
        orbit: "105 m/s",
        dist: "65,000 m",
        neut: -12,

      },
    ],
  },
  Instrumental: {
    siteName: "Instrumental Core Reservoir",
    rats: [
      {
        qty: 4,
        name: "Sleepless Sentinel",
        class: "B",
        ehp: 147714,
        dps: 465,
        alpha: 5746,
        sig: 400,
        orbit: "125 m/s",
        dist: "19,000 m",
        scram: 1,
        web: 1,
        neut: -18,
      },
    ],
  }
};

const shipClassIcon = (cls: ShipClass) => {
  switch (cls) {
    case "F":
      return "/icons/ships/frigate.png";
    case "C":
      return "/icons/ships/cruiser.png";
    case "B":
      return "/icons/ships/battleship.png";
    case "T":
      return "/icons/ships/sentry.png";
    default:
      return "/icons/ships/frigate.png";
  }
};

const summarizeEffects = (site: GasSiteInfo) => {
  let scram = 0;
  let web = 0;
  let neut = 0;
  let rrep = 0;

  let totalEhp = 0;
  let totalDps = 0;
  let totalAlpha = 0;

  site.rats.forEach((rat) => {
    const mult = rat.qty;

    totalEhp += rat.ehp * mult;
    totalDps += rat.dps * mult;
    totalAlpha += rat.alpha * mult;

    if (typeof rat.scram === "number") scram += rat.scram * mult;
    if (typeof rat.web === "number") web += rat.web * mult;
    if (typeof rat.neut === "number") neut += rat.neut * mult;
    if (typeof rat.rrep === "number") rrep += rat.rrep * mult;
  });

  return { scram, web, neut, rrep, totalEhp, totalDps, totalAlpha };
};

const ships = [
  "Unbonused Ship",
  "Venture",
  "Venture Consortium Issue",
  "Prospect",
  "Pioneer Consortium Issue",
  "Odysseus",
  "Covetor",
  "Retriever",
  "Procurer",
  "Hulk",
  "Skiff",
  "Mackinaw",
];

const implants = [
  { label: "None", value: 0 },
  { label: "GH-801 (+1%)", value: 0.01 },
  { label: "GH-803 (+3%)", value: 0.03 },
  { label: "GH-805 (+5%)", value: 0.05 },
];

const boostShips = ["None", "Gnosis", "Porpoise", "Orca"];

const boostImplants = [
  { label: "None", value: "none" },
  { label: "Mining Mindlink", value: "mindlink" },
  { label: "ORE Mining Director", value: "ore" },
];

const boostModules = [
  { label: "Burst I", value: "T1" },
  { label: "Burst II", value: "T2" },
];

type GasFamily = "fullerite" | "mykoserocin" | "cytoserocin";

interface ResultRow {
  family?: GasFamily;
  site: string;
  siteName?: string;
  location?: string;
  security?: string;
  cloudDamage?: string;
  hasNpcs?: boolean;
  deadspace?: boolean;
  gas: string;
  gasTypeId?: number | null;
  cloudCount?: number;
  m3_per_unit: number;
  units_per_cloud: number;
  m3_per_cloud: number;
  price: number;
  unitsPerHour: number;
  iskPerHour: number;
  minutesToHuff: string;
  totalSeconds?: number;
  totalMinutes?: number;
  totalIskPerCloud: number;
  m3PerCloud: number;
  m3LostResidue: number;
  iskPerCloud: number;
  iskLostResidue: number;
  ttk: string;
  _rowIndex?: number;
}

type ResultsByFamily = Record<GasFamily, ResultRow[]>;

interface SiteSummary {
  site: string;
  siteName?: string;
  location?: string;
  security?: string;
  cloudDamage?: string;
  hasNpcs?: boolean;
  deadspace?: boolean;
  gas: string;
  gasTypeId?: number | null;
  cloudCount: number;
  m3PerSite: number;
  m3LostResidue: number;
  iskPerSite: number;
  iskLostResidue: number;
  secondsToHuff: number;
  ttk: string;
  iskPerHour: number;
}

const emptyResultsByFamily = (): ResultsByFamily => ({
  fullerite: [],
  mykoserocin: [],
  cytoserocin: [],
});

const gasFamilyTabs: { key: GasFamily; label: string; sublabel: string }[] = [
  { key: "fullerite", label: "Fullerites", sublabel: "WH" },
  { key: "mykoserocin", label: "Mykoserocin", sublabel: "HS/LS/NS" },
  { key: "cytoserocin", label: "Cytoserocin", sublabel: "LS/NS" },
];

const moneyIcon = String.fromCodePoint(0x1f4b0);

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
  label,
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

type InfoHeadProps = {
  children: React.ReactNode;
  tip: string;
  id: string;
  className?: string;
};

const boostShipOptions = [
  { value: "None", label: "None" },
  { value: "gnosis", label: "Gnosis/Command Dessy/Other Ship" },
  { value: "Porpoise", label: "Porpoise" },
  { value: "Orca", label: "Orca" },
  { value: "Outrider", label: "Outrider" },
];

const GAS_SETUP_TOOL_KEY = "gas-calc";

type GasSkillKey =
  | "Frigate"
  | "Barge"
  | "Exhumer"
  | "Expedition"
  | "MiningDestroyer"
  | "CommandDestroyer";

type GasPriceField = "buy_5pct" | "buy_max" | "sell_5pct" | "sell_min";

type GasCalcForm = {
  ship: string;
  moduleType: string;
  moduleCount: number;
  shipCount: number;
  skills: Record<GasSkillKey, number>;
  implant: number;
  boostShip: string;
  miningDirector: number;
  industrialCommand: number;
  boostImplant: string;
  boostModule: string;
  bastion: string;
  priceField: GasPriceField;
};

type SavedToolSetup = {
  id: string;
  setupName: string;
  setupJson?: unknown;
  summaryJson?: {
    ship?: string;
    shipCount?: number;
    moduleType?: string;
    boostShip?: string;
  };
  updatedAt?: string;
};

type SaveDialogMode = "create" | "update" | "rename";

const defaultGasForm: GasCalcForm = {
  ship: "Prospect",
  moduleType: "Syndicate Gas Cloud Scoop",
  moduleCount: 2,
  shipCount: 1,
  skills: {
    Frigate: 5,
    Barge: 0,
    Exhumer: 0,
    Expedition: 0,
    MiningDestroyer: 0,
    CommandDestroyer: 0,
  },
  implant: 0,
  boostShip: "None",
  miningDirector: 0,
  industrialCommand: 0,
  boostImplant: "none",
  boostModule: "T1",
  bastion: "No",
  priceField: "buy_5pct",
};

const industrialCoreOptions = ["No", "T1", "T2"] as const;
const gasPriceOptions: Array<{ label: string; value: GasPriceField }> = [
  { label: "Buy 5%", value: "buy_5pct" },
  { label: "Buy Max", value: "buy_max" },
  { label: "Sell 5%", value: "sell_5pct" },
  { label: "Sell Min", value: "sell_min" },
];

const gasSkillFields: GasSkillKey[] = [
  "Frigate",
  "Barge",
  "Exhumer",
  "Expedition",
  "MiningDestroyer",
  "CommandDestroyer",
];

function numberField(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clampNumberField(value: unknown, min: number, max: number, fallback: number) {
  const next = numberField(value, fallback);
  return Math.min(max, Math.max(min, Math.trunc(next)));
}

function normalizeIndustrialCore(value: unknown) {
  if (value === "T1" || value === "T2") return value;
  if (value === "Yes") return "T2";
  return "No";
}

function normalizeGasPriceField(value: unknown): GasPriceField {
  if (value === "buy_max" || value === "sell_5pct" || value === "sell_min") {
    return value;
  }
  return "buy_5pct";
}

function normalizeGasForm(raw: unknown): GasCalcForm {
  const source = raw && typeof raw === "object" ? raw as Partial<GasCalcForm> : {};
  const rawSkills = source.skills && typeof source.skills === "object" ? source.skills as Partial<Record<GasSkillKey, unknown>> : {};

  return {
    ...defaultGasForm,
    ship: typeof source.ship === "string" ? source.ship : defaultGasForm.ship,
    moduleType: typeof source.moduleType === "string" ? source.moduleType : defaultGasForm.moduleType,
    moduleCount: clampNumberField(source.moduleCount, 1, 99, defaultGasForm.moduleCount),
    shipCount: clampNumberField(source.shipCount, 1, 999, defaultGasForm.shipCount),
    skills: {
      Frigate: clampNumberField(rawSkills.Frigate, 0, 5, defaultGasForm.skills.Frigate),
      Barge: clampNumberField(rawSkills.Barge, 0, 5, defaultGasForm.skills.Barge),
      Exhumer: clampNumberField(rawSkills.Exhumer, 0, 5, defaultGasForm.skills.Exhumer),
      Expedition: clampNumberField(rawSkills.Expedition, 0, 5, defaultGasForm.skills.Expedition),
      MiningDestroyer: clampNumberField(rawSkills.MiningDestroyer, 0, 5, defaultGasForm.skills.MiningDestroyer),
      CommandDestroyer: clampNumberField(rawSkills.CommandDestroyer, 0, 5, defaultGasForm.skills.CommandDestroyer),
    },
    implant: numberField(source.implant, defaultGasForm.implant),
    boostShip: typeof source.boostShip === "string" ? source.boostShip : defaultGasForm.boostShip,
    miningDirector: clampNumberField(source.miningDirector, 0, 5, defaultGasForm.miningDirector),
    industrialCommand: clampNumberField(source.industrialCommand, 0, 5, defaultGasForm.industrialCommand),
    boostImplant: typeof source.boostImplant === "string" ? source.boostImplant : defaultGasForm.boostImplant,
    boostModule: typeof source.boostModule === "string" ? source.boostModule : defaultGasForm.boostModule,
    bastion: normalizeIndustrialCore(source.bastion),
    priceField: normalizeGasPriceField(source.priceField),
  };
}

function formFromSetupJson(setupJson: unknown) {
  const payload = setupJson && typeof setupJson === "object" ? setupJson as { form?: unknown } : {};
  return normalizeGasForm(payload.form);
}

function defaultFleetName(form: GasCalcForm) {
  const shipCount = Math.max(1, Math.round(form.shipCount || 1));
  return `${shipCount}x ${form.ship}`;
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

function InfoHead({
  children,
  tip,
  className = "",
  id,
}: {
  children: React.ReactNode;
  tip: string;
  className?: string;
  id: string;
}) {
  return (
    <th
      scope="col"
      className={`border border-[#2b2d33] bg-[#14161c] px-2.5 py-1.5 text-left text-[11px] relative overflow-visible whitespace-nowrap ${className}`}
    >
      <span
        className="group/ih inline-flex items-center gap-1 cursor-help"
        aria-describedby={id}
      >
        {children}
        <span
          aria-hidden="true"
          className="
            inline-flex items-center justify-center
            w-4 h-4
            rounded-sm
            border border-[#4b9cff]/60
            bg-[#0b111a]
            text-[10px] font-bold leading-none
            text-[#c1e5ff]
            group-hover/ih:border-[#7fc5ff] group-hover/ih:text-white
            transition-colors duration-150
            translate-y-[1px]
          "
        >
          ?
        </span>

        { }
        <div
          id={id}
          role="tooltip"
          className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-50 hidden
                     group-hover/ih:block group-focus-within/ih:block
                     w-44 sm:w-56 max-w-xs px-2 py-1 rounded-sm border border-[#262933] shadow-lg
                     bg-[#05070b]/95 text-[11px] leading-snug text-slate-100
                     whitespace-normal break-words pointer-events-none select-none"
        >
          {tip}
        </div>
      </span>
    </th>
  );
}

export default function GasCalc() {
  const [form, setForm] = useState<GasCalcForm>(() => normalizeGasForm(defaultGasForm));

  const [resultsByFamily, setResultsByFamily] = useState<ResultsByFamily>(
    emptyResultsByFamily
  );
  const [activeGasFamily, setActiveGasFamily] = useState<GasFamily>("fullerite");
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<keyof ResultRow>("iskPerHour");
  const [sortAsc, setSortAsc] = useState(false);
  const [hoveredSite, setHoveredSite] = useState<GasSiteKey | null>(null);
  const [openSiteModal, setOpenSiteModal] = useState<GasSiteKey | null>(null);
  const [openKSpaceSiteModal, setOpenKSpaceSiteModal] = useState<{
    family: GasFamily;
    site: SiteSummary;
  } | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [savedFleets, setSavedFleets] = useState<SavedToolSetup[]>([]);
  const [savedFleetsLoading, setSavedFleetsLoading] = useState(false);
  const [selectedFleetId, setSelectedFleetId] = useState("");
  const [setupBusy, setSetupBusy] = useState<"load" | "save" | "rename" | "delete" | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [saveDialogMode, setSaveDialogMode] = useState<SaveDialogMode | null>(null);
  const [saveName, setSaveName] = useState("");
  const results = resultsByFamily[activeGasFamily];
  const hasAnyResults = gasFamilyTabs.some(
    (tab) => resultsByFamily[tab.key].length > 0
  );
  const selectedFleet = savedFleets.find((fleet) => fleet.id === selectedFleetId) || null;

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;

    if (gasSkillFields.includes(name as GasSkillKey)) {
      setForm((prev) => ({
        ...prev,
        skills: {
          ...prev.skills,
          [name]: clampNumberField(value, 0, 5, prev.skills[name as GasSkillKey]),
        } as Record<GasSkillKey, number>,
      }));
    } else if (["implant"].includes(name)) {
      setForm((prev) => ({ ...prev, [name]: numberField(value, prev.implant) }));
    } else if (["miningDirector", "industrialCommand"].includes(name)) {
      setForm((prev) => ({
        ...prev,
        [name]: clampNumberField(value, 0, 5, prev[name as "miningDirector" | "industrialCommand"]),
      }));
    } else if (name === "priceField") {
      setForm((prev) => ({ ...prev, priceField: normalizeGasPriceField(value) }));
    } else if (["boostShip", "boostModule", "boostImplant", "bastion"].includes(name)) {
      setForm((prev) => ({ ...prev, [name]: value }));
    } else {
      setForm((prev) => ({
        ...prev,
        [name]: name.includes("Count")
          ? clampNumberField(value, 1, name === "shipCount" ? 999 : 99, prev[name as "moduleCount" | "shipCount"])
          : value,
      }));
    }
  };

  const [collapsed, setCollapsed] = useState({
    fleet: false,
    skills: false,
    boosts: false,
  });

  const toggleSection = (section: keyof typeof collapsed) => {
    setCollapsed((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

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

  async function calculateGas(nextForm: GasCalcForm) {
    setLoading(true);
    try {
      const requestConfig = { headers: { "Content-Type": "application/json" } };
      const [fullerite, mykoserocin, cytoserocin] = await Promise.all([
        axios.post("/api/gas-calc", nextForm, requestConfig),
        axios.post("/api/gas-calc", { ...nextForm, gasFamily: "mykoserocin" }, requestConfig),
        axios.post("/api/gas-calc", { ...nextForm, gasFamily: "cytoserocin" }, requestConfig),
      ]);

      setResultsByFamily({
        fullerite: fullerite.data,
        mykoserocin: mykoserocin.data,
        cytoserocin: cytoserocin.data,
      });
    } catch (err: any) {
      console.error("[GAS_CALC]: API call failed:", err?.response?.data || err.message);
      alert("Calculation failed. Check console for details.");
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await calculateGas(form);
  };

  async function refreshSavedFleets() {
    if (!authUser) return;
    setSavedFleetsLoading(true);
    try {
      const response = await fetch(`/api/tool-setups/${GAS_SETUP_TOOL_KEY}`, { credentials: "include" });
      const data = await readJson<{ ok: boolean; setups: SavedToolSetup[] }>(response);
      const next = data.setups || [];
      setSavedFleets(next);
      setSelectedFleetId((prev) => prev && next.some((fleet) => fleet.id === prev) ? prev : "");
    } catch (err) {
      setSavedFleets([]);
      setSetupError((err as Error).message || "Saved fleets failed to load.");
    } finally {
      setSavedFleetsLoading(false);
    }
  }

  function setupPayload(name: string, nextForm: GasCalcForm = form) {
    return {
      setupName: name,
      setupJson: {
        version: 1,
        form: nextForm,
      },
      summaryJson: {
        ship: nextForm.ship,
        shipCount: nextForm.shipCount,
        moduleType: nextForm.moduleType,
        boostShip: nextForm.boostShip,
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
    setSaveName(selectedFleet?.setupName || defaultFleetName(form));
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
        const response = await fetch(`/api/tool-setups/${GAS_SETUP_TOOL_KEY}/${selectedFleet.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setupName: name }),
        });
        await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
      } else {
        setSetupBusy("save");
        const updating = saveDialogMode === "update" && selectedFleet;
        const response = await fetch(
          updating ? `/api/tool-setups/${GAS_SETUP_TOOL_KEY}/${selectedFleet.id}` : `/api/tool-setups/${GAS_SETUP_TOOL_KEY}`,
          {
            method: updating ? "PUT" : "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(setupPayload(name)),
          }
        );
        const data = await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
        setSelectedFleetId(data.setup.id);
      }

      setSaveDialogMode(null);
      setSaveName("");
      setSetupError(null);
      await refreshSavedFleets();
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
      const response = await fetch(`/api/tool-setups/${GAS_SETUP_TOOL_KEY}/${id}`, { credentials: "include" });
      const data = await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
      const nextForm = formFromSetupJson(data.setup.setupJson);
      setForm(nextForm);
      setSelectedFleetId(id);
      setSetupError(null);
      await calculateGas(nextForm);
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
      const response = await fetch(`/api/tool-setups/${GAS_SETUP_TOOL_KEY}/${selectedFleet.id}`, {
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

  const scoops = {
    "Gas Cloud Scoop I": {},
    "Crop' Gas Cloud Scoop": {},
    "Plow' Gas Cloud Scoop": {},
    "Gas Cloud Scoop II": {},
    "Syndicate Gas Cloud Scoop": {},
  };

  const harvesters = {
    "Gas Cloud Harvester I": {},
    "Gas Cloud Harvester II": {},
    "ORE Gas Cloud Harvester": {},
  };

  const isFrigate = [
    "Unbonused Ship",
    "Venture",
    "Prospect",
    "Venture Consortium Issue",
    "Pioneer Consortium Issue",
    "Odysseus",
  ].includes(form.ship);

  const isBargeLike = [
    "Covetor",
    "Retriever",
    "Procurer",
    "Hulk",
    "Skiff",
    "Mackinaw",
  ].includes(form.ship);

  const modules = Object.keys(isFrigate ? scoops : isBargeLike ? harvesters : {});

  function handleSort(
    key:
      | keyof ResultRow
      | "ttk"
      | "m3PerCloud"
      | "m3LostResidue"
      | "iskPerCloud"
      | "iskLostResidue"
      | "iskPerHour"
  ) {
    if (key === sortKey) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key as keyof ResultRow);
      setSortAsc(true);
    }
  }

  const getSortedGroupedResults = () => {
    const grouped: ResultRow[][] = [];

    for (let i = 0; i < results.length; i += 2) {
      grouped.push([results[i], results[i + 1]]);
    }

    grouped.sort((a, b) => {
      let valA: any = a[0][sortKey];
      let valB: any = b[0][sortKey];

      if (sortKey === "ttk") {
        const parseTTK = (ttk: string) => {
          if (!ttk) return Infinity;
          const match = /(?:(\d+)h)?\s*(\d+)m/.exec(ttk);
          if (!match) return Infinity;
          const hours = parseInt(match[1] || "0", 10);
          const minutes = parseInt(match[2], 10);
          return hours * 60 + minutes;
        };
        valA = parseTTK(a[0].ttk ?? a[0].minutesToHuff);
        valB = parseTTK(b[0].ttk ?? b[0].minutesToHuff);
      }

      if (typeof valA === "number" && typeof valB === "number") {
        return sortAsc ? valA - valB : valB - valA;
      }

      if (typeof valA === "string" && typeof valB === "string") {
        return sortAsc
          ? valA.localeCompare(valB, undefined, { numeric: true })
          : valB.localeCompare(valA, undefined, { numeric: true });
      }

      return 0;
    });

    return grouped;
  };

  const parseTTK = (ttk: string) => {
    if (!ttk) return Infinity;
    const match = /(?:(\d+)h)?\s*(\d+)m/.exec(ttk);
    if (!match) return Infinity;
    const hours = parseInt(match[1] || "0", 10);
    const minutes = parseInt(match[2], 10);
    return hours * 60 + minutes;
  };

  const formatDuration = (seconds: number) => {
    const totalMinutes = Math.ceil(seconds / 60);
    if (totalMinutes >= 60) {
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return `${hours}h ${minutes}m`;
    }

    return `${totalMinutes}m`;
  };

  const sortValueForRow = (row: ResultRow) => {
    if (sortKey === "ttk") return parseTTK(row.ttk ?? row.minutesToHuff);
    return row[sortKey];
  };

  const compareRows = (a: ResultRow, b: ResultRow) => {
    const valA = sortValueForRow(a);
    const valB = sortValueForRow(b);

    if (typeof valA === "number" && typeof valB === "number") {
      return sortAsc ? valA - valB : valB - valA;
    }

    if (typeof valA === "string" && typeof valB === "string") {
      return sortAsc
        ? valA.localeCompare(valB, undefined, { numeric: true })
        : valB.localeCompare(valA, undefined, { numeric: true });
    }

    return 0;
  };

  const getSortedSiteGroups = () => {
    const groups = new Map<string, ResultRow[]>();

    for (const row of results) {
      const key = row.siteName || row.site;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const sortedGroups = Array.from(groups.values()).map((group) =>
      [...group].sort(compareRows)
    );

    sortedGroups.sort((a, b) => compareRows(a[0], b[0]));
    return sortedGroups;
  };

  const getKSpaceSiteSummaries = () => {
    const summaries = getSortedSiteGroups().map((siteRows): SiteSummary => {
      const first = siteRows[0];
      const cloudCount = siteRows.reduce(
        (sum, row) => sum + (row.cloudCount ?? 1),
        0
      );
      const m3PerSite = siteRows.reduce(
        (sum, row) => sum + (row.m3_per_cloud ?? 0) * (row.cloudCount ?? 1),
        0
      );
      const m3LostResidue = siteRows.reduce(
        (sum, row) => sum + (row.m3LostResidue ?? 0) * (row.cloudCount ?? 1),
        0
      );
      const iskPerSite = siteRows.reduce(
        (sum, row) => sum + (row.iskPerCloud ?? row.totalIskPerCloud ?? 0) * (row.cloudCount ?? 1),
        0
      );
      const iskLostResidue = siteRows.reduce(
        (sum, row) => sum + (row.iskLostResidue ?? 0) * (row.cloudCount ?? 1),
        0
      );
      const secondsToHuff = siteRows.reduce(
        (sum, row) =>
          sum + (row.totalSeconds ?? parseTTK(row.ttk ?? row.minutesToHuff) * 60) * (row.cloudCount ?? 1),
        0
      );

      return {
        site: first.site,
        siteName: first.siteName,
        location: first.location,
        security: first.security,
        cloudDamage: first.cloudDamage,
        hasNpcs: first.hasNpcs,
        deadspace: first.deadspace,
        gas: first.gas,
        gasTypeId: first.gasTypeId,
        cloudCount,
        m3PerSite,
        m3LostResidue,
        iskPerSite,
        iskLostResidue,
        secondsToHuff,
        ttk: formatDuration(secondsToHuff),
        iskPerHour:
          secondsToHuff > 0 ? iskPerSite / (secondsToHuff / 3600) : first.iskPerHour,
      };
    });

    const summaryValue = (summary: SiteSummary) => {
      if (sortKey === "m3PerCloud") return summary.m3PerSite;
      if (sortKey === "m3LostResidue") return summary.m3LostResidue;
      if (sortKey === "iskPerCloud") return summary.iskPerSite;
      if (sortKey === "iskLostResidue") return summary.iskLostResidue;
      if (sortKey === "ttk") return summary.secondsToHuff;
      if (sortKey === "iskPerHour") return summary.iskPerHour;
      return summary.siteName || summary.site;
    };

    summaries.sort((a, b) => {
      const valA = summaryValue(a);
      const valB = summaryValue(b);

      if (typeof valA === "number" && typeof valB === "number") {
        return sortAsc ? valA - valB : valB - valA;
      }

      return sortAsc
        ? String(valA).localeCompare(String(valB), undefined, { numeric: true })
        : String(valB).localeCompare(String(valA), undefined, { numeric: true });
    });

    return summaries;
  };

  interface GasSiteNpcModalProps {
    siteKey: GasSiteKey;
    site: GasSiteInfo;
    onClose: () => void;
  }

  const GasSiteNpcModal: React.FC<GasSiteNpcModalProps> = ({
    siteKey,
    site,
    onClose,
  }) => {
    const { scram, web, neut, rrep, totalEhp, totalDps, totalAlpha } =
      summarizeEffects(site);

    const effectChips = [
      scram !== 0 && {
        key: "scram",
        label: "Scram",
        value: scram,
        icon: "/icons/specials/scram.png",
      },
      web !== 0 && {
        key: "web",
        label: "Web",
        value: web,
        icon: "/icons/specials/web.png",
      },
      neut !== 0 && {
        key: "neut",
        label: "Neut",
        value: neut,
        icon: "/icons/specials/neut.png",
      },
      rrep !== 0 && {
        key: "rrep",
        label: "Remote Rep",
        value: rrep,
        icon: "/icons/specials/rr.png",
      },
    ].filter(Boolean) as {
      key: string;
      label: string;
      value: number;
      icon: string;
    }[];

    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-4xl overflow-hidden rounded-md border border-[#3a3c40] bg-[#05070b]/95 shadow-[0_0_24px_rgba(0,0,0,0.85)]">
          { }
          <div className="flex items-center justify-between border-b border-[#3a3c40] bg-[linear-gradient(to_r,#111319,#171920,#242833)] px-4 py-2">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-300">
                Gas Site Defenders
              </div>
              <div className="text-sm font-semibold text-slate-100">
                {site.siteName}{" "}
                <span className="text-slate-400">({siteKey})</span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-sm border border-[#3a3c40] bg-[#101219] px-3 py-1 text-xs font-medium text-slate-200 hover:border-red-500 hover:bg-red-600/80 hover:text-white"
            >
              Close
            </button>
          </div>

          { }
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#262933] bg-[#05070b] px-4 py-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-400">Effects:</span>
              {effectChips.length === 0 && (
                <span className="text-slate-500">None</span>
              )}
              {effectChips.map((eff) => (
                <span
                  key={eff.key}
                  className="inline-flex items-center gap-1 rounded-sm bg-[#101219] px-2 py-0.5 text-[10px] text-slate-100"
                >
                  <img src={eff.icon} alt={eff.label} className="h-3 w-3" />
                  <span>{eff.label}</span>
                  <span className="text-amber-300">
                    {eff.key === "neut" ? eff.value : `x${eff.value}`}
                  </span>
                </span>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400">
              <span>
                Total EHP{" "}
                <span className="text-slate-100">
                  {totalEhp.toLocaleString()}
                </span>
              </span>
              <span>
                DPS{" "}
                <span className="text-slate-100">
                  {totalDps.toLocaleString()}
                </span>
              </span>
              <span>
                Alpha{" "}
                <span className="text-slate-100">
                  {totalAlpha.toLocaleString()}
                </span>
              </span>
            </div>
          </div>

          { }
          <div className="px-4 py-3">
            <div className="overflow-x-auto rounded border border-[#262933] bg-[#05070b]">
              <table className="min-w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-[#14161d] text-slate-200">
                    <th className="border border-[#2b2d33] px-2 py-1 text-left font-medium">
                      Qty
                    </th>
                    <th className="border border-[#2b2d33] px-2 py-1 text-left font-medium">
                      Name
                    </th>
                    <th className="border border-[#2b2d33] px-2 py-1 text-left font-medium">
                      EHP
                    </th>
                    <th className="border border-[#2b2d33] px-2 py-1 text-left font-medium">
                      DPS
                    </th>
                    <th className="border border-[#2b2d33] px-2 py-1 text-left font-medium">
                      Alpha
                    </th>
                    <th className="border border-[#2b2d33] px-2 py-1 text-left font-medium">
                      Sig
                    </th>
                    <th className="border border-[#2b2d33] px-2 py-1 text-left font-medium">
                      Orbit
                    </th>
                    <th className="border border-[#2b2d33] px-2 py-1 text-left font-medium">
                      Dist
                    </th>
                    <th className="border border-[#2b2d33] px-2 py-1 text-left font-medium">
                      Special
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {site.rats.map((rat) => {
                    const specials: {
                      key: string;
                      label: string;
                      icon: string;
                      value: number;
                    }[] = [];

                    if (typeof rat.scram === "number")
                      specials.push({
                        key: "scram",
                        label: "Scram",
                        icon: "/icons/specials/scram.png",
                        value: rat.scram,
                      });
                    if (typeof rat.web === "number")
                      specials.push({
                        key: "web",
                        label: "Web",
                        icon: "/icons/specials/web.png",
                        value: rat.web,
                      });
                    if (typeof rat.neut === "number")
                      specials.push({
                        key: "neut",
                        label: "Neut",
                        icon: "/icons/specials/neut.png",
                        value: rat.neut,
                      });
                    if (typeof rat.rrep === "number")
                      specials.push({
                        key: "rrep",
                        label: "Remote Rep",
                        icon: "/icons/specials/rr.png",
                        value: rat.rrep,
                      });

                    return (
                      <tr
                        key={rat.name}
                        className="border-t border-[#262933] odd:bg-[#090b11] even:bg-[#0c0f16]"
                      >
                        <td className="border border-[#2b2d33] px-2 py-1 text-slate-100">
                          {rat.qty}
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1 text-slate-100">
                          <div className="flex items-center gap-2">
                            <img
                              src={shipClassIcon(rat.class)}
                              alt={rat.class}
                              className="h-4 w-4 opacity-80"
                            />
                            <span>{rat.name}</span>
                          </div>
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1">
                          {rat.ehp.toLocaleString()}
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1">
                          {rat.dps}
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1">
                          {rat.alpha}
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1">
                          {rat.sig}
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1">
                          {rat.orbit}
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1">
                          {rat.dist}
                        </td>
                        <td className="border border-[#2b2d33] px-2 py-1">
                          <div className="flex flex-wrap gap-1">
                            {specials.map((s) => (
                              <span
                                key={s.key}
                                className="inline-flex items-center gap-1 rounded-sm bg-[#101219] px-1.5 py-0.5 text-[10px] text-slate-100"
                              >
                                <img
                                  src={s.icon}
                                  alt={s.label}
                                  className="h-3 w-3"
                                />
                                {s.key === "neut" ? (
                                  <span className="text-amber-200">
                                    {s.value}
                                  </span>
                                ) : (
                                  <span className="text-amber-200">
                                    x{s.value}
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  interface KSpaceSiteModalProps {
    family: GasFamily;
    site: SiteSummary;
    onClose: () => void;
  }

  const KSpaceSiteModal: React.FC<KSpaceSiteModalProps> = ({
    family,
    site,
    onClose,
  }) => {
    const dangerRows = [
      family !== "mykoserocin" &&
        site.security && { label: "Space", value: site.security },
      site.hasNpcs && { label: "NPCs", value: "Reported" },
      site.deadspace && { label: "Deadspace", value: "Yes" },
      site.cloudDamage &&
        site.cloudDamage !== "None" && {
          label: "Cloud Damage",
          value: site.cloudDamage,
        },
    ].filter(Boolean) as { label: string; value: string }[];

    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-3xl overflow-hidden rounded-md border border-[#3a3c40] bg-[#05070b]/95 shadow-[0_0_24px_rgba(0,0,0,0.85)]">
          <div className="flex items-center justify-between border-b border-[#3a3c40] bg-[linear-gradient(to_r,#111319,#171920,#242833)] px-4 py-2">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-300">
                Gas Site Details
              </div>
              <div className="text-sm font-semibold text-slate-100">
                {site.siteName || site.site}
                <span className="ml-2 text-slate-400">
                  ({family === "mykoserocin" ? "Mykoserocin" : "Cytoserocin"})
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-sm border border-[#3a3c40] bg-[#101219] px-3 py-1 text-xs font-medium text-slate-200 hover:border-red-500 hover:bg-red-600/80 hover:text-white"
            >
              Close
            </button>
          </div>

          <div className="grid gap-3 px-4 py-3 md:grid-cols-2">
            <div className="rounded-sm border border-[#262933] bg-[#05070b]">
              <div className="border-b border-[#262933] bg-[#14161d] px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-300">
                Location
              </div>
              <div className="px-3 py-2 text-[11px] leading-relaxed text-slate-200">
                {site.location || "No location data available."}
              </div>
            </div>

            <div className="rounded-sm border border-[#262933] bg-[#05070b]">
              <div className="border-b border-[#262933] bg-[#14161d] px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-300">
                Site Danger
              </div>
              <div className="px-3 py-2">
                {dangerRows.length > 0 ? (
                  <table className="w-full border-collapse text-[11px]">
                    <tbody>
                      {dangerRows.map((row) => (
                        <tr key={row.label}>
                          <td className="border border-[#2b2d33] px-2 py-1 text-slate-400">
                            {row.label}
                          </td>
                          <td className="border border-[#2b2d33] px-2 py-1 text-right text-slate-100">
                            {row.value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-[11px] text-slate-300">
                    No NPCs, cloud damage, or deadspace effects are listed for this
                    site type.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-[#262933] px-4 py-3">
            <table className="w-full border-collapse text-[11px]">
              <tbody>
                <tr>
                  <td className="border border-[#2b2d33] px-2 py-1 text-slate-400">
                    Gas
                  </td>
                  <td className="border border-[#2b2d33] px-2 py-1 text-right text-slate-100">
                    {site.gas}
                  </td>
                  <td className="border border-[#2b2d33] px-2 py-1 text-slate-400">
                    Clouds
                  </td>
                  <td className="border border-[#2b2d33] px-2 py-1 text-right text-slate-100">
                    {site.cloudCount.toLocaleString()}
                  </td>
                </tr>
                <tr>
                  <td className="border border-[#2b2d33] px-2 py-1 text-slate-400">
                    M3/Site
                  </td>
                  <td className="border border-[#2b2d33] px-2 py-1 text-right text-slate-100">
                    {Math.round(site.m3PerSite).toLocaleString()}
                  </td>
                  <td className="border border-[#2b2d33] px-2 py-1 text-slate-400">
                    TTK/Site
                  </td>
                  <td className="border border-[#2b2d33] px-2 py-1 text-right text-slate-100">
                    {site.ttk}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>,
      document.body
    );
  };

  return (
    <div className="tt-tool-v2 min-h-screen text-slate-100 text-[11px] leading-snug">
      <div className="tt2-frame tt2-frame--centered">
        <div className="tt2-window">
          { }
          <div className="tt2-titlebar">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
              <span className="uppercase tracking-widest text-[10px] text-slate-300">
                Science &amp; Industry ▸ Gas Cloud Yield
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
                Overview ▸ Fullerite Sites
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
          <div className="p-3 space-y-4">
            <div className="border border-[#262933] bg-[#05070b]/90 px-3 py-2">
              <p className="text-[12px] text-slate-300 mb-1">
                This panel calculates{" "}
                <span className="text-slate-100">
                  gas cloud yield, residue loss and ISK/hr
                </span>{" "}
                for wormhole sites based on your fleet configuration.
              </p>
              <p className="text-[12px] text-slate-400 mb-1">
                Adjust ships, modules, skills and fleet boosts on the left; the
                results table updates using live prices from the{" "}
                <a
                  href="/api/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#53b6ff] hover:text-[#7fc5ff] underline"
                >
                  Triff.Tools Market API
                </a>
                .
              </p>
              <p className="text-[12px] text-slate-400">
                Columns are sortable by clicking the headers. Default sort is{" "}
                <span className="text-slate-100">ISK/hr</span> (descending).
              </p>
            </div>

            { }
            <form onSubmit={handleSubmit} className="space-y-3">
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
                      className="w-full bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
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

              <div className="grid gap-3 lg:grid-cols-3">
                { }
                <fieldset className="border border-[#2c2f36] bg-[#070910]">
                  <legend
                    onClick={() => toggleSection("fleet")}
                    className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300 cursor-pointer select-none"
                  >
                    <span>Fleet</span>
                    <span className="text-[9px] text-slate-500">
                      {collapsed.fleet ? "▸" : "▾"}
                    </span>
                  </legend>
                  <div
                    className={`transition-all duration-200 ease-in-out overflow-hidden ${collapsed.fleet
                      ? "max-h-0 p-0"
                      : "max-h-[1000px] p-2 space-y-2"
                      }`}
                  >
                    {["ship", "moduleType", "moduleCount", "shipCount"].map((field) => (
                      <div className="flex flex-col gap-0.5" key={field}>
                        <label
                          htmlFor={field}
                          className="text-[10px] uppercase tracking-widest text-slate-400"
                        >
                          {field
                            .replace(/([A-Z])/g, " $1")
                            .replace("module", "Module")
                            .replace("ship", "Ship")
                            .trim()}
                        </label>
                        {field.includes("Count") ? (
                          <input
                            id={field}
                            name={field}
                            type="number"
                            value={(form as any)[field]}
                            onChange={handleChange}
                            className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                          />
                        ) : (
                          <select
                            id={field}
                            name={field}
                            value={(form as any)[field]}
                            onChange={handleChange}
                            className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                          >
                            {(field === "ship" ? ships : modules).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                </fieldset>

                { }
                <fieldset className="border border-[#2c2f36] bg-[#070910]">
                  <legend
                    onClick={() => toggleSection("skills")}
                    className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300 cursor-pointer select-none"
                  >
                    <span>Skills</span>
                    <span className="text-[9px] text-slate-500">
                      {collapsed.skills ? "▸" : "▾"}
                    </span>
                  </legend>
                  <div
                    className={`transition-all duration-200 ease-in-out overflow-hidden ${collapsed.skills
                      ? "max-h-0 p-0"
                      : "max-h-[1000px] p-2 grid grid-cols-2 gap-2"
                      }`}
                  >
                    {gasSkillFields.map((skill) => (
                      <div className="flex flex-col gap-0.5" key={skill}>
                        <label
                          htmlFor={skill}
                          className="text-[10px] uppercase tracking-widest text-slate-400"
                        >
                          {skill.replace(/([A-Z])/g, " $1").trim()} Level
                        </label>
                        <input
                          id={skill}
                          name={skill}
                          type="number"
                          min="0"
                          max="5"
                          value={(form.skills as any)[skill]}
                          onChange={handleChange}
                          className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                        />
                      </div>
                    ))}
                    <div className="flex flex-col gap-0.5 col-span-2">
                      <label
                        htmlFor="implant"
                        className="text-[10px] uppercase tracking-widest text-slate-400"
                      >
                        Gas Implant
                      </label>
                      <select
                        id="implant"
                        name="implant"
                        value={form.implant}
                        onChange={handleChange}
                        className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                      >
                        {implants.map((imp) => (
                          <option key={imp.label} value={imp.value}>
                            {imp.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </fieldset>

                { }
                <fieldset className="border border-[#2c2f36] bg-[#070910]">
                  <legend
                    onClick={() => toggleSection("boosts")}
                    className="flex items-center justify-between px-2 py-1 bg-[#101219] border-b border-[#2c2f36] uppercase tracking-widest text-[10px] text-slate-300 cursor-pointer select-none"
                  >
                    <span>Boosts</span>
                    <span className="text-[9px] text-slate-500">
                      {collapsed.boosts ? "▸" : "▾"}
                    </span>
                  </legend>
                  <div
                    className={`transition-all duration-200 ease-in-out overflow-hidden ${collapsed.boosts
                      ? "max-h-0 p-0"
                      : "max-h-[1000px] p-2 grid grid-cols-2 gap-2"
                      }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <label
                        htmlFor="boostShip"
                        className="text-[10px] uppercase tracking-widest text-slate-400"
                      >
                        Boost Ship
                      </label>
                      <select
                        id="boostShip"
                        name="boostShip"
                        value={form.boostShip}
                        onChange={handleChange}
                        className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                      >
                        {boostShipOptions.map(({ value, label }) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <label
                        htmlFor="miningDirector"
                        className="text-[10px] uppercase tracking-widest text-slate-400"
                      >
                        Mining Director Level
                      </label>
                      <input
                        id="miningDirector"
                        name="miningDirector"
                        type="number"
                        min="0"
                        max="5"
                        value={form.miningDirector}
                        onChange={handleChange}
                        className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                      />
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <label
                        htmlFor="industrialCommand"
                        className="text-[10px] uppercase tracking-widest text-slate-400"
                      >
                        Industrial Command Ships Level
                      </label>
                      <input
                        id="industrialCommand"
                        name="industrialCommand"
                        type="number"
                        min="0"
                        max="5"
                        value={form.industrialCommand}
                        onChange={handleChange}
                        className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                      />
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <label
                        htmlFor="CommandDestroyer"
                        className="text-[10px] uppercase tracking-widest text-slate-400"
                      >
                        Command Destroyers Level (Outrider)
                      </label>
                      <input
                        id="CommandDestroyer"
                        name="CommandDestroyer"
                        type="number"
                        min="0"
                        max="5"
                        value={form.skills.CommandDestroyer}
                        onChange={handleChange}
                        className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                      />
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <label
                        htmlFor="boostImplant"
                        className="text-[10px] uppercase tracking-widest text-slate-400 flex items-center gap-1"
                      >
                        Boost Implant
                        <span className="relative group cursor-help select-none">
                          <span
                            aria-hidden="true"
                            className="
                              inline-flex items-center justify-center
                              w-4 h-4
                              rounded-sm
                              border border-[#4b9cff]/60
                              bg-[#0b111a]
                              text-[10px] font-bold leading-none
                              text-[#c1e5ff]
                              group-hover:border-[#7fc5ff] group-hover:text-white
                              transition-colors duration-150
                              translate-y-[1px]
                            "
                          >
                            ?
                          </span>
                          <span
                            role="tooltip"
                            className="
                              absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-50 hidden
                              group-hover:block group-focus-within:block
                              w-48 max-w-xs px-2 py-1 rounded-sm border border-[#262933] shadow-lg
                              bg-[#05070b]/95 text-[11px] leading-snug text-slate-100
                              whitespace-normal break-words pointer-events-none
                            "
                          >
                            Mining Foreman Mindlink and ORE Mining Director give the
                            same mining burst bonus. ORE also adds shield boosts
                            (ignored here).
                          </span>
                        </span>
                      </label>

                      <select
                        id="boostImplant"
                        name="boostImplant"
                        value={form.boostImplant}
                        onChange={handleChange}
                        className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                      >
                        <option value="none">No</option>
                        <option value="mindlink">Yes</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <label
                        htmlFor="boostModule"
                        className="text-[10px] uppercase tracking-widest text-slate-400"
                      >
                        Boost Module
                      </label>
                      <select
                        id="boostModule"
                        name="boostModule"
                        value={form.boostModule}
                        onChange={handleChange}
                        className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                      >
                        {boostModules.map((mod) => (
                          <option key={mod.label} value={mod.value}>
                            {mod.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <label
                        htmlFor="bastion"
                        className="text-[10px] uppercase tracking-widest text-slate-400"
                      >
                        Industrial Core
                      </label>
                      <select
                        id="bastion"
                        name="bastion"
                        value={form.bastion}
                        onChange={handleChange}
                        className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                      >
                        {industrialCoreOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <label
                        htmlFor="priceField"
                        className="text-[10px] uppercase tracking-widest text-slate-400"
                      >
                        Jita Price Mode
                      </label>
                      <select
                        id="priceField"
                        name="priceField"
                        value={form.priceField}
                        onChange={handleChange}
                        className="bg-[#05070b] border border-[#303236] px-2 py-1 text-[11px] outline-none focus:border-[#53b6ff] focus:ring-0"
                      >
                        {gasPriceOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </fieldset>
              </div>

              { }
              <div className="flex justify-end gap-2 pt-2 border-t border-[#262933]">
                <button
                  type="button"
                  disabled={!!setupBusy}
                  onClick={openSaveFleetDialog}
                  className="inline-flex min-w-[140px] items-center justify-center gap-1.5 border border-[#303236] bg-[#05070b] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-300 transition-colors hover:border-[#53b6ff]/60 hover:bg-[#101219] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save size={13} />
                  {selectedFleet ? "Update Fleet" : "Save Fleet"}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="min-w-[140px] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest
                             bg-gradient-to-b from-[#1b8cc8] to-[#14608a]
                             border border-[#46b2ff]/70
                             shadow-[0_0_12px_rgba(70,178,255,0.55)]
                             hover:from-[#27a0df] hover:to-[#1672a4]
                             disabled:opacity-60 disabled:cursor-not-allowed
                             transition-all duration-150"
                >
                  {loading ? "Calculating..." : "Calculate"}
                </button>
              </div>
            </form>

            {hasAnyResults && (
              <div className="mb-2 grid grid-cols-3 gap-1 border border-[#303236] bg-[#05070b]/95 p-1">
                {gasFamilyTabs.map((tab) => {
                  const isActive = activeGasFamily === tab.key;

                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveGasFamily(tab.key)}
                      className={`w-full border px-3 py-2 text-left text-[11px] uppercase tracking-widest transition-colors ${
                        isActive
                          ? "border-[#53b6ff] bg-[#102033] text-slate-50"
                          : "border-[#262933] bg-[#090b11] text-slate-400 hover:border-[#3f5368] hover:text-slate-100"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2 font-semibold">
                        <span>{tab.label}</span>
                        <span className="text-[9px] tracking-wider text-slate-500">
                          {tab.sublabel}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            { }
            {results.length > 0 && activeGasFamily === "fullerite" && (
              <div className="border border-[#303236] bg-[#05070b]/95 overflow-x-visible">
                <div className="border border-[#bf3b3b] bg-[#19080a] px-3 py-1 text-center text-[11px] text-[#ff6666]">
                  Click a site name to see rats on the site
                </div>
                <table className="table-auto w-full text-[11px]">
                  <thead>
                    <tr className="bg-[#14161d] text-slate-100">
                      <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                        Site
                      </th>
                      <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                        Gas
                      </th>

                      <th
                        className="border border-[#2b2d33] px-2.5 py-1.5 cursor-pointer hover:text-[#53b6ff]"
                        onClick={() => handleSort("m3PerCloud")}
                      >
                        M³/Cloud {sortKey === "m3PerCloud" && (sortAsc ? "▲" : "▼")}
                      </th>

                      <InfoHead
                        id="m3lost"
                        tip="Expected m³ destroyed by residue (waste) instead of harvested. Based on module residue % × multiplier."
                      >
                        <span
                          className="cursor-pointer hover:text-[#53b6ff]"
                          onClick={() => handleSort("m3LostResidue")}
                        >
                          M³ Lost{" "}
                          {sortKey === "m3LostResidue" && (sortAsc ? "▲" : "▼")}
                        </span>
                      </InfoHead>

                      <th
                        className="border border-[#2b2d33] px-2.5 py-1.5 cursor-pointer hover:text-[#53b6ff]"
                        onClick={() => handleSort("iskPerCloud")}
                      >
                        ISK/Cloud {sortKey === "iskPerCloud" && (sortAsc ? "▲" : "▼")}
                      </th>

                      <InfoHead
                        id="isklost"
                        tip="ISK value of expected residue (waste) destroyed instead of harvested."
                      >
                        <span
                          className="cursor-pointer hover:text-[#53b6ff]"
                          onClick={() => handleSort("iskLostResidue")}
                        >
                          ISK Lost{" "}
                          {sortKey === "iskLostResidue" && (sortAsc ? "▲" : "▼")}
                        </span>
                      </InfoHead>

                      <th
                        className="border border-[#2b2d33] px-2.5 py-1.5 cursor-pointer hover:text-[#53b6ff]"
                        onClick={() => handleSort("ttk")}
                      >
                        TTK {sortKey === "ttk" && (sortAsc ? "▲" : "▼")}
                      </th>

                      <th
                        className="border border-[#2b2d33] px-2.5 py-1.5 cursor-pointer hover:text-[#53b6ff]"
                        onClick={() => handleSort("iskPerHour")}
                      >
                        ISK/hr {sortKey === "iskPerHour" && (sortAsc ? "▲" : "▼")}
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {(() => {
                      const rows: JSX.Element[] = [];
                      let rowIndex = 0;

                      for (const [r1, r2] of getSortedGroupedResults()) {
                        if (!r1 || !r2) continue;

                        const ttk1 = r1.ttk ?? r1.minutesToHuff;
                        const ttk2 = r2.ttk ?? r2.minutesToHuff;

                        const siteIskAdj =
                          (r1.iskPerCloud ?? r1.totalIskPerCloud ?? 0) +
                          (r2?.iskPerCloud ?? r2?.totalIskPerCloud ?? 0);

                        const bgColor =
                          rowIndex % 2 === 0 ? "bg-[#090b11]" : "bg-[#0c0f16]";

                        const siteKey = r1.site as GasSiteKey;
                        const npcInfo = gasSiteNpcData[siteKey];

                        rows.push(
                          <tr
                            key={`${r1.site}-1`}
                            className={`${bgColor} hover:bg-[#141821]`}
                          >
                            <td
                              className="border border-[#2b2d33] px-2.5 py-2 text-center align-middle relative group cursor-pointer"
                              rowSpan={2}
                              onClick={() => npcInfo && setOpenSiteModal(siteKey)}
                            >
                              <div className="text-sm font-semibold text-slate-50">
                                <span className="underline decoration-dotted decoration-slate-500 group-hover:decoration-[#53b6ff]">
                                  {r1.site}
                                </span>
                              </div>
                              <div className="mt-1 text-[10px] text-slate-400">
                                {moneyIcon}{" "}
                                {Math.round(siteIskAdj / 1_000_000).toLocaleString()}M ISK
                              </div>

                              { }
                              {npcInfo && (
                                <div
                                  className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-50 hidden
                     w-56 max-w-xs rounded-sm border border-[#262933] bg-[#05070b]/95 px-2 py-1
                     text-[11px] leading-snug text-slate-100 shadow-lg group-hover:block"
                                >
                                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                    Defenders
                                  </div>
                                  <div className="mb-1 text-[11px] font-medium text-slate-100">
                                    {npcInfo.siteName}
                                  </div>
                                  <div className="space-y-1">
                                    {npcInfo.rats.map((rat) => (
                                      <div
                                        key={rat.name}
                                        className="flex items-center gap-1 text-[11px]"
                                      >
                                        <span className="w-5 text-slate-400">
                                          {rat.qty}×
                                        </span>
                                        <img
                                          src={shipClassIcon(rat.class)}
                                          alt={rat.class}
                                          className="h-3 w-3 opacity-80"
                                        />
                                        <span>{rat.name}</span>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="mt-1 text-[9px] text-slate-500">
                                    Click for full defender breakdown.
                                  </div>
                                </div>
                              )}
                            </td>

                            { }
                            <td className="border border-[#2b2d33] px-2.5 py-1.5">
                              <div className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate">{r1.gas}</span>
                                <ItemInfoLink typeId={r1.gasTypeId} label={r1.gas} />
                              </div>
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5">
                              {Math.round(r1.m3PerCloud ?? r1.m3_per_cloud).toLocaleString()}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-[#ff6666]">
                              {Math.round(r1.m3LostResidue ?? 0).toLocaleString()}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5">
                              {(r1.iskPerCloud ?? r1.totalIskPerCloud).toLocaleString(
                                undefined,
                                { maximumFractionDigits: 0 }
                              )}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-[#ff6666]">
                              {(r1.iskLostResidue ?? 0).toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5 font-mono">
                              {ttk1}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5">
                              {r1.iskPerHour.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}
                            </td>
                          </tr>,
                          <tr
                            key={`${r1.site}-2`}
                            className={`${bgColor} hover:bg-[#141821]`}
                          >
                            { }
                            <td className="border border-[#2b2d33] px-2.5 py-1.5">
                              <div className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate">{r2.gas}</span>
                                <ItemInfoLink typeId={r2.gasTypeId} label={r2.gas} />
                              </div>
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5">
                              {Math.round(r2.m3PerCloud ?? r2.m3_per_cloud).toLocaleString()}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-[#ff6666]">
                              {Math.round(r2.m3LostResidue ?? 0).toLocaleString()}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5">
                              {(r2.iskPerCloud ?? r2.totalIskPerCloud).toLocaleString(
                                undefined,
                                { maximumFractionDigits: 0 }
                              )}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-[#ff6666]">
                              {(r2.iskLostResidue ?? 0).toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5 font-mono">
                              {ttk2}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5">
                              {r2.iskPerHour.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}
                            </td>
                          </tr>
                        );

                        rowIndex++;
                      }

                      return rows;
                    })()}
                  </tbody>
                </table>
              </div>
            )}

            {results.length > 0 && activeGasFamily !== "fullerite" && (
              <div className="border border-[#303236] bg-[#05070b]/95 overflow-x-visible">
                {activeGasFamily === "cytoserocin" && (
                  <div className="border border-amber-500/70 bg-amber-950/50 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
                    Cytoserocin site danger data is incomplete. I have never
                    huffed k-space gas myself, so this tool relies on missing,
                    incomplete, and outdated wiki information. I would be happy
                    to accept details from any capsuleer willing to catalog the
                    exact effects, rats, and dangers for these sites.
                  </div>
                )}
                <div className="border border-[#bf3b3b] bg-[#19080a] px-3 py-1 text-center text-[11px] text-[#ff6666]">
                  Click a site name to see locations and site details
                </div>
                <table className="table-auto w-full text-[11px]">
                  <thead>
                    <tr className="bg-[#14161d] text-slate-100">
                      <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                        Site
                      </th>
                      <th className="border border-[#2b2d33] px-2.5 py-1.5 text-left">
                        Gas
                      </th>
                      <th className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                        Clouds
                      </th>
                      <th
                        className="border border-[#2b2d33] px-2.5 py-1.5 cursor-pointer text-right hover:text-[#53b6ff]"
                        onClick={() => handleSort("m3PerCloud")}
                      >
                        M3/Site {sortKey === "m3PerCloud" && (sortAsc ? "^" : "v")}
                      </th>
                      <InfoHead
                        id={`${activeGasFamily}-m3lost`}
                        className="text-right"
                        tip="Expected m3 destroyed by residue across the whole site."
                      >
                        <span
                          className="cursor-pointer hover:text-[#53b6ff]"
                          onClick={() => handleSort("m3LostResidue")}
                        >
                          M3 Lost/Site{" "}
                          {sortKey === "m3LostResidue" && (sortAsc ? "^" : "v")}
                        </span>
                      </InfoHead>
                      <th
                        className="border border-[#2b2d33] px-2.5 py-1.5 cursor-pointer text-right hover:text-[#53b6ff]"
                        onClick={() => handleSort("iskPerCloud")}
                      >
                        ISK/Site {sortKey === "iskPerCloud" && (sortAsc ? "^" : "v")}
                      </th>
                      <InfoHead
                        id={`${activeGasFamily}-isklost`}
                        className="text-right"
                        tip="ISK value of expected residue across the whole site."
                      >
                        <span
                          className="cursor-pointer hover:text-[#53b6ff]"
                          onClick={() => handleSort("iskLostResidue")}
                        >
                          ISK Lost/Site{" "}
                          {sortKey === "iskLostResidue" && (sortAsc ? "^" : "v")}
                        </span>
                      </InfoHead>
                      <th
                        className="border border-[#2b2d33] px-2.5 py-1.5 cursor-pointer text-right hover:text-[#53b6ff]"
                        onClick={() => handleSort("ttk")}
                      >
                        TTK/Site {sortKey === "ttk" && (sortAsc ? "^" : "v")}
                      </th>
                      <th
                        className="border border-[#2b2d33] px-2.5 py-1.5 cursor-pointer text-right hover:text-[#53b6ff]"
                        onClick={() => handleSort("iskPerHour")}
                      >
                        ISK/hr {sortKey === "iskPerHour" && (sortAsc ? "^" : "v")}
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {(() => {
                      const rows: JSX.Element[] = [];
                      for (const [summaryIndex, site] of getKSpaceSiteSummaries().entries()) {
                        const bgColor =
                          summaryIndex % 2 === 0 ? "bg-[#090b11]" : "bg-[#0c0f16]";
                        const dangerLine = [
                          activeGasFamily !== "mykoserocin" && site.security,
                          site.hasNpcs && "NPCs",
                          site.deadspace && "Deadspace",
                          site.cloudDamage && site.cloudDamage !== "None" && site.cloudDamage,
                        ]
                          .filter(Boolean)
                          .join(" / ");

                        rows.push(
                          <tr
                            key={site.site}
                            className={`${bgColor} hover:bg-[#141821]`}
                          >
                            <td
                              className="border border-[#2b2d33] px-2.5 py-2 text-center align-middle relative group cursor-pointer"
                              onClick={() =>
                                setOpenKSpaceSiteModal({
                                  family: activeGasFamily,
                                  site,
                                })
                              }
                            >
                              <div className="text-sm font-semibold text-slate-50">
                                <span className="underline decoration-dotted decoration-slate-500 group-hover:decoration-[#53b6ff]">
                                  {site.siteName || site.site}
                                </span>
                              </div>
                              <div className="mt-1 text-[10px] text-slate-400">
                                {moneyIcon}{" "}
                                {Math.round(site.iskPerSite / 1_000_000).toLocaleString()}M ISK
                              </div>
                              <div
                                className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-50 hidden
                                           w-64 max-w-xs rounded-sm border border-[#262933] bg-[#05070b]/95 px-2 py-1
                                           text-left text-[11px] leading-snug text-slate-100 shadow-lg group-hover:block"
                              >
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                                  Site Details
                                </div>
                                <div className="mb-1 text-[11px] font-medium text-slate-100">
                                  {site.siteName || site.site}
                                </div>
                                <div className="line-clamp-3 text-[10px] text-slate-400">
                                  {site.location || "No location data available."}
                                </div>
                                {dangerLine && (
                                  <div className="mt-1 text-[10px] text-amber-200">
                                    {dangerLine}
                                  </div>
                                )}
                                <div className="mt-1 text-[9px] text-slate-500">
                                  Click for full site details.
                                </div>
                              </div>
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5">
                              <div className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate">{site.gas}</span>
                                <ItemInfoLink typeId={site.gasTypeId} label={site.gas} />
                              </div>
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                              {site.cloudCount.toLocaleString()}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                              {Math.round(site.m3PerSite).toLocaleString()}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right text-[#ff6666]">
                              {Math.round(site.m3LostResidue).toLocaleString()}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                              {site.iskPerSite.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right text-[#ff6666]">
                              {site.iskLostResidue.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right font-mono">
                              {site.ttk}
                            </td>
                            <td className="border border-[#2b2d33] px-2.5 py-1.5 text-right">
                              {site.iskPerHour.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}
                            </td>
                          </tr>
                        );
                      }

                      return rows;
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
      {openSiteModal && gasSiteNpcData[openSiteModal] && (
        <GasSiteNpcModal
          siteKey={openSiteModal}
          site={gasSiteNpcData[openSiteModal]}
          onClose={() => setOpenSiteModal(null)}
        />
      )}
      {openKSpaceSiteModal && (
        <KSpaceSiteModal
          family={openKSpaceSiteModal.family}
          site={openKSpaceSiteModal.site}
          onClose={() => setOpenKSpaceSiteModal(null)}
        />
      )}
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
                    ? "Rename this gas huffing fleet setup."
                    : "Save the current gas huffing inputs to your Triff.Tools account."}
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
                  This saves ship, module, skill, implant, and boost inputs. Prices and results recalculate when the fleet is loaded.
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
