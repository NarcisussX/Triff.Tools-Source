import { useEffect, useMemo, useState } from "react";
import { requestSiteAuthModal, SITE_AUTH_CHANGED_EVENT } from "../../../auth/siteAuthEvents";
import calculatorIconRaw from "../../../assets/icons/calculator.svg?raw";
import cargoContainerIconRaw from "../../../assets/icons/cargocontainer.svg?raw";
import cargoContainerLockedIconRaw from "../../../assets/icons/cargocontainerlocked.svg?raw";
import fleetIconRaw from "../../../assets/icons/fleet.svg?raw";
import folderIconRaw from "../../../assets/icons/Folder.svg?raw";
import infoIconRaw from "../../../assets/icons/info.svg?raw";
import lockedContainerIconRaw from "../../../assets/icons/lockedcontainer.svg?raw";
import { EveIcon, makeEveIcon } from "../../shell/EveIcon";
import {
  ToolBottomSheetV2,
  ToolMobileShellV2,
  ToolTouchRowV2,
  type ToolMobileNavItem,
} from "../../tool-ui/ToolMobileV2";

type GasFamily = "fullerite" | "mykoserocin" | "cytoserocin";
type MobileView = "setup" | GasFamily;
type GasSkillKey = "Frigate" | "Barge" | "Exhumer" | "Expedition" | "MiningDestroyer" | "CommandDestroyer";
type GasPriceField = "buy_5pct" | "buy_max" | "sell_5pct" | "sell_min";
type ShipClass = "F" | "C" | "B" | "T";

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

type ResultRow = {
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
};

type ResultsByFamily = Record<GasFamily, ResultRow[]>;

type SiteSummary = {
  site: string;
  siteName: string;
  family: GasFamily;
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
  bestCloudIskPerHour: number;
};

type SiteGroup = {
  key: string;
  family: GasFamily;
  rows: ResultRow[];
  summary: SiteSummary;
};

type AuthUser = {
  id?: string | number;
  username?: string;
  displayName?: string;
  email?: string;
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

type DefenderRow = {
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
};

type DefenderSite = {
  siteName: string;
  rats: DefenderRow[];
};

const icons = {
  gas: makeEveIcon(cargoContainerIconRaw),
  wh: makeEveIcon(cargoContainerIconRaw),
  myko: makeEveIcon(cargoContainerLockedIconRaw),
  cyko: makeEveIcon(lockedContainerIconRaw),
  fleet: makeEveIcon(fleetIconRaw),
  saved: makeEveIcon(folderIconRaw),
  calculate: makeEveIcon(calculatorIconRaw),
};

const navItems: ToolMobileNavItem<MobileView>[] = [
  { key: "setup", label: "Setup", icon: icons.fleet },
  { key: "fullerite", label: "WH", icon: icons.wh },
  { key: "mykoserocin", label: "Myko", icon: icons.myko },
  { key: "cytoserocin", label: "Cyto", icon: icons.cyko },
];

const gasFamilyTabs: { key: GasFamily; label: string; sublabel: string }[] = [
  { key: "fullerite", label: "WH Gas", sublabel: "Fullerites" },
  { key: "mykoserocin", label: "Myko", sublabel: "Mykoserocin" },
  { key: "cytoserocin", label: "Cyto", sublabel: "Cytoserocin" },
];

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

const scoopModules = [
  "Gas Cloud Scoop I",
  "Crop' Gas Cloud Scoop",
  "Plow' Gas Cloud Scoop",
  "Gas Cloud Scoop II",
  "Syndicate Gas Cloud Scoop",
];

const harvesterModules = [
  "Gas Cloud Harvester I",
  "Gas Cloud Harvester II",
  "ORE Gas Cloud Harvester",
];

const frigateShips = [
  "Unbonused Ship",
  "Venture",
  "Prospect",
  "Venture Consortium Issue",
  "Pioneer Consortium Issue",
  "Odysseus",
];

const bargeShips = ["Covetor", "Retriever", "Procurer", "Hulk", "Skiff", "Mackinaw"];

const implantOptions = [
  { label: "None", value: 0 },
  { label: "GH-801 (+1%)", value: 0.01 },
  { label: "GH-803 (+3%)", value: 0.03 },
  { label: "GH-805 (+5%)", value: 0.05 },
];

const boostShipOptions = [
  { value: "None", label: "None" },
  { value: "gnosis", label: "Gnosis / Command Destroyer / Other" },
  { value: "Porpoise", label: "Porpoise" },
  { value: "Orca", label: "Orca" },
  { value: "Outrider", label: "Outrider" },
];

const boostImplantOptions = [
  { label: "None", value: "none" },
  { label: "Mining Foreman Mindlink", value: "mindlink" },
  { label: "ORE Mining Director Mindlink", value: "ore" },
];

const boostModules = [
  { label: "Burst I", value: "T1" },
  { label: "Burst II", value: "T2" },
];

const industrialCoreOptions = ["No", "T1", "T2"] as const;

const gasPriceOptions: Array<{ label: string; value: GasPriceField }> = [
  { label: "Buy 5%", value: "buy_5pct" },
  { label: "Buy Max", value: "buy_max" },
  { label: "Sell 5%", value: "sell_5pct" },
  { label: "Sell Min", value: "sell_min" },
];

const shipSkillFields: GasSkillKey[] = [
  "Frigate",
  "Barge",
  "Exhumer",
  "Expedition",
  "MiningDestroyer",
];

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

const emptyResultsByFamily = (): ResultsByFamily => ({
  fullerite: [],
  mykoserocin: [],
  cytoserocin: [],
});

const GAS_SETUP_TOOL_KEY = "gas-calc";

const infoIconPath = infoIconRaw.match(/<path\b[^>]*\bd="([^"]+)"/)?.[1] ?? "";

const fulleriteDefenders: Record<string, DefenderSite> = {
  Barren: {
    siteName: "Barren Perimeter Reservoir",
    rats: [
      { qty: 3, name: "Emergent Patroller", class: "F", ehp: 3000, dps: 16, alpha: 115, sig: 35, orbit: "250 m/s", dist: "8,000 m" },
      { qty: 2, name: "Emergent Watchman", class: "F", ehp: 2000, dps: 12, alpha: 95, sig: 35, orbit: "275 m/s", dist: "5,000 m", neut: -3 },
    ],
  },
  Token: {
    siteName: "Token Perimeter Reservoir",
    rats: [
      { qty: 2, name: "Emergent Escort", class: "F", ehp: 1300, dps: 23, alpha: 163, sig: 35, orbit: "300 m/s", dist: "5,000 m", web: 1 },
      { qty: 1, name: "Awakened Watchman", class: "C", ehp: 8750, dps: 31, alpha: 266, sig: 150, orbit: "200 m/s", dist: "30,000 m", neut: -6 },
    ],
  },
  Minor: {
    siteName: "Minor Perimeter Reservoir",
    rats: [
      { qty: 2, name: "Awakened Patroller", class: "C", ehp: 19167, dps: 42, alpha: 432, sig: 150, orbit: "170 m/s", dist: "15,000 m" },
    ],
  },
  Ordinary: {
    siteName: "Ordinary Perimeter Reservoir",
    rats: [
      { qty: 3, name: "Emergent Patroller", class: "F", ehp: 3000, dps: 16, alpha: 115, sig: 35, orbit: "250 m/s", dist: "8,000 m" },
      { qty: 3, name: "Emergent Watchman", class: "F", ehp: 2000, dps: 12, alpha: 95, sig: 35, orbit: "275 m/s", dist: "5,000 m", neut: -3 },
    ],
  },
  Sizeable: {
    siteName: "Sizeable Perimeter Reservoir",
    rats: [
      { qty: 3, name: "Emergent Patroller", class: "F", ehp: 3000, dps: 16, alpha: 115, sig: 35, orbit: "250 m/s", dist: "8,000 m" },
      { qty: 3, name: "Emergent Watchman", class: "F", ehp: 2000, dps: 12, alpha: 95, sig: 35, orbit: "275 m/s", dist: "5,000 m", neut: -3 },
    ],
  },
  Bountiful: {
    siteName: "Bountiful Frontier Reservoir",
    rats: [
      { qty: 6, name: "Emergent Defender", class: "F", ehp: 4200, dps: 23, alpha: 161, sig: 35, orbit: "270 m/s", dist: "6,500 m", web: 1 },
      { qty: 4, name: "Awakened Defender", class: "C", ehp: 26833, dps: 59, alpha: 605, sig: 150, orbit: "185 m/s", dist: "15,000 m" },
    ],
  },
  Vast: {
    siteName: "Vast Frontier Reservoir",
    rats: [
      { qty: 4, name: "Awakened Defender", class: "C", ehp: 26833, dps: 59, alpha: 605, sig: 150, orbit: "185 m/s", dist: "15,000 m" },
      { qty: 4, name: "Awakened Upholder", class: "C", ehp: 12250, dps: 43, alpha: 372, sig: 150, orbit: "216 m/s", dist: "30,000 m", web: 1, neut: -6 },
    ],
  },
  Vital: {
    siteName: "Vital Core Reservoir",
    rats: [
      { qty: 4, name: "Emergent Keeper", class: "F", ehp: 4400, dps: 22, alpha: 171, sig: 26, orbit: "320 m/s", dist: "5,000 m", neut: -3, rrep: 26 },
      { qty: 4, name: "Sleepless Keeper", class: "B", ehp: 88629, dps: 565, alpha: 3802, sig: 400, orbit: "105 m/s", dist: "65,000 m", neut: -12 },
    ],
  },
  Instrumental: {
    siteName: "Instrumental Core Reservoir",
    rats: [
      { qty: 4, name: "Sleepless Sentinel", class: "B", ehp: 147714, dps: 465, alpha: 5746, sig: 400, orbit: "125 m/s", dist: "19,000 m", scram: 1, web: 1, neut: -18 },
    ],
  },
};

function classNames(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

function InfoGlyph({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 128 128" className={classNames("inline-block shrink-0", className)}>
      {infoIconPath ? (
        <path d={infoIconPath} fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
      ) : (
        <path
          d="M64 24a40 40 0 1 1 0 80 40 40 0 0 1 0-80Zm-4.3 15h10v10h-10v-10Zm-2.8 16.7h12.8V79h1.4v10H58.3V79h1.4V65.7h-2.8v-10Z"
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
        />
      )}
    </svg>
  );
}

function ItemInfoLink({ typeId, label }: { typeId?: number | null; label: string }) {
  if (!Number.isInteger(typeId)) return null;
  return (
    <a
      href={`/items/${typeId}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 active:border-[#53b6ff]/70 active:text-[#9dd8ff]"
      title={`Show info: ${label}`}
      aria-label={`Show info: ${label}`}
      onClick={(event) => event.stopPropagation()}
    >
      <InfoGlyph className="h-3.5 w-3.5" />
    </a>
  );
}

function typeIconUrl(typeId?: number | null, size = 64) {
  return typeId ? `https://images.evetech.net/types/${typeId}/icon?size=${size}` : "";
}

function shipClassIcon(cls: ShipClass) {
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
}

function specialIcon(key: "scram" | "web" | "neut" | "rrep") {
  if (key === "scram") return "/icons/specials/scram.png";
  if (key === "web") return "/icons/specials/web.png";
  if (key === "neut") return "/icons/specials/neut.png";
  return "/icons/specials/rr.png";
}

function moduleOptionsForShip(ship: string) {
  if (frigateShips.includes(ship)) return scoopModules;
  if (bargeShips.includes(ship)) return harvesterModules;
  return scoopModules;
}

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
  if (value === "buy_max" || value === "sell_5pct" || value === "sell_min") return value;
  return "buy_5pct";
}

function normalizeGasForm(raw: unknown): GasCalcForm {
  const source = raw && typeof raw === "object" ? raw as Partial<GasCalcForm> : {};
  const rawSkills = source.skills && typeof source.skills === "object"
    ? source.skills as Partial<Record<GasSkillKey, unknown>>
    : {};
  const ship = typeof source.ship === "string" && ships.includes(source.ship)
    ? source.ship
    : defaultGasForm.ship;
  const modules = moduleOptionsForShip(ship);
  const moduleType = typeof source.moduleType === "string" && modules.includes(source.moduleType)
    ? source.moduleType
    : modules[0] || defaultGasForm.moduleType;

  return {
    ...defaultGasForm,
    ship,
    moduleType,
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
  return normalizeGasForm(payload.form || setupJson);
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
  if (!response.ok) throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
  return data as T;
}

async function postGasFamily(form: GasCalcForm, family: GasFamily) {
  const body = family === "fullerite" ? form : { ...form, gasFamily: family };
  const response = await fetch("/api/gas-calc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson<ResultRow[]>(response);
}

function parseDurationMinutes(ttk: string) {
  if (!ttk) return Infinity;
  const match = /(?:(\d+)h)?\s*(\d+)m/.exec(ttk);
  if (!match) return Infinity;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  return hours * 60 + minutes;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const totalMinutes = Math.ceil(seconds / 60);
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
  }
  return `${totalMinutes}m`;
}

function isk(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || !n) return "0 ISK";
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(3)}B ISK`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M ISK`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k ISK`;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} ISK`;
}

function compactNumber(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || !n) return "0";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function skillLabel(skill: GasSkillKey) {
  return skill.replace(/([A-Z])/g, " $1").trim();
}

function buildSiteSummary(family: GasFamily, rows: ResultRow[]): SiteSummary {
  const first = rows[0];
  const biggestCloud = [...rows].sort((a, b) => (b.m3_per_cloud || 0) - (a.m3_per_cloud || 0))[0] || first;
  const cloudCount = rows.reduce((sum, row) => sum + (row.cloudCount ?? 1), 0);
  const m3PerSite = rows.reduce(
    (sum, row) => sum + (row.m3_per_cloud ?? row.m3PerCloud ?? 0) * (row.cloudCount ?? 1),
    0,
  );
  const m3LostResidue = rows.reduce(
    (sum, row) => sum + (row.m3LostResidue ?? 0) * (row.cloudCount ?? 1),
    0,
  );
  const iskPerSite = rows.reduce(
    (sum, row) => sum + (row.iskPerCloud ?? row.totalIskPerCloud ?? 0) * (row.cloudCount ?? 1),
    0,
  );
  const iskLostResidue = rows.reduce(
    (sum, row) => sum + (row.iskLostResidue ?? 0) * (row.cloudCount ?? 1),
    0,
  );
  const secondsToHuff = rows.reduce(
    (sum, row) => sum + (row.totalSeconds ?? parseDurationMinutes(row.ttk || row.minutesToHuff) * 60) * (row.cloudCount ?? 1),
    0,
  );
  const bestCloudIskPerHour = Number(biggestCloud.iskPerHour) || 0;

  return {
    site: first.site,
    siteName: first.siteName || first.site,
    family,
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
    iskPerHour: secondsToHuff > 0 ? iskPerSite / (secondsToHuff / 3600) : first.iskPerHour,
    bestCloudIskPerHour,
  };
}

function siteGroupsForFamily(family: GasFamily, rows: ResultRow[]) {
  const groups = new Map<string, ResultRow[]>();
  for (const row of rows) {
    const key = row.siteName || row.site;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  return Array.from(groups.entries())
    .map(([key, groupRows]): SiteGroup => ({
      key,
      family,
      rows: [...groupRows].sort((a, b) => (b.m3_per_cloud || 0) - (a.m3_per_cloud || 0)),
      summary: buildSiteSummary(family, groupRows),
    }))
    .sort((a, b) => {
      const comparison = b.summary.bestCloudIskPerHour - a.summary.bestCloudIskPerHour;
      if (comparison !== 0) return comparison;
      return a.summary.siteName.localeCompare(b.summary.siteName, undefined, { numeric: true });
    });
}

function bestGroup(groups: SiteGroup[]) {
  return [...groups].sort((a, b) => b.summary.bestCloudIskPerHour - a.summary.bestCloudIskPerHour)[0] || null;
}

function defenderTotals(site?: DefenderSite) {
  if (!site) return { totalEhp: 0, totalDps: 0, totalAlpha: 0, scram: 0, web: 0, neut: 0, rrep: 0 };
  return site.rats.reduce(
    (acc, rat) => {
      acc.totalEhp += rat.ehp * rat.qty;
      acc.totalDps += rat.dps * rat.qty;
      acc.totalAlpha += rat.alpha * rat.qty;
      acc.scram += (rat.scram || 0) * rat.qty;
      acc.web += (rat.web || 0) * rat.qty;
      acc.neut += (rat.neut || 0) * rat.qty;
      acc.rrep += (rat.rrep || 0) * rat.qty;
      return acc;
    },
    { totalEhp: 0, totalDps: 0, totalAlpha: 0, scram: 0, web: 0, neut: 0, rrep: 0 },
  );
}

export default function GasMobile() {
  const [view, setView] = useState<MobileView>("setup");
  const [form, setForm] = useState<GasCalcForm>(() => normalizeGasForm(defaultGasForm));
  const [resultsByFamily, setResultsByFamily] = useState<ResultsByFamily>(emptyResultsByFamily);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedSite, setSelectedSite] = useState<SiteGroup | null>(null);
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
  const moduleOptions = useMemo(() => moduleOptionsForShip(form.ship), [form.ship]);
  const activeFamily: GasFamily = view === "setup" ? "fullerite" : view;
  const activeGroups = useMemo(
    () => siteGroupsForFamily(activeFamily, resultsByFamily[activeFamily]),
    [activeFamily, resultsByFamily],
  );
  const allGroups = useMemo(
    () => gasFamilyTabs.flatMap((family) => siteGroupsForFamily(family.key, resultsByFamily[family.key])),
    [resultsByFamily],
  );
  const bestOverall = useMemo(() => bestGroup(allGroups), [allGroups]);
  const topSubtitle = bestOverall
    ? `${bestOverall.summary.siteName} - ${isk(bestOverall.summary.bestCloudIskPerHour)}/hr`
    : `${form.shipCount}x ${form.ship} - ${form.moduleType}`;

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
      const detail = (event as CustomEvent<{ user?: AuthUser | null }>).detail;
      if (detail && "user" in detail) {
        setAuthUser(detail.user ?? null);
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
      setSetupError("");
      return;
    }
    void refreshSavedFleets();
  }, [authUser]);

  function updateForm(patch: Partial<GasCalcForm>) {
    setForm((prev) => normalizeGasForm({ ...prev, ...patch }));
  }

  function updateShip(ship: string) {
    setForm((prev) => {
      const modules = moduleOptionsForShip(ship);
      return normalizeGasForm({
        ...prev,
        ship,
        moduleType: modules.includes(prev.moduleType) ? prev.moduleType : modules[0],
      });
    });
  }

  function updateSkill(skill: GasSkillKey, value: number) {
    setForm((prev) => normalizeGasForm({
      ...prev,
      skills: {
        ...prev.skills,
        [skill]: value,
      },
    }));
  }

  async function calculate(nextForm: GasCalcForm = form, options: { showResults?: boolean } = {}) {
    setLoading(true);
    setError("");
    try {
      const [fullerite, mykoserocin, cytoserocin] = await Promise.all([
        postGasFamily(nextForm, "fullerite"),
        postGasFamily(nextForm, "mykoserocin"),
        postGasFamily(nextForm, "cytoserocin"),
      ]);
      setResultsByFamily({ fullerite, mykoserocin, cytoserocin });
      if (options.showResults !== false) setView("fullerite");
    } catch (err) {
      setError((err as Error).message || "Gas calculation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshSavedFleets(preferredFleetId?: string) {
    if (!authUser) return;
    setSavedFleetsLoading(true);
    try {
      const response = await fetch(`/api/tool-setups/${GAS_SETUP_TOOL_KEY}`, { credentials: "include" });
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

  function setupPayload(name: string, nextForm: GasCalcForm = form) {
    return {
      setupName: name,
      setupJson: {
        version: 1,
        form: normalizeGasForm(nextForm),
      },
      summaryJson: {
        ship: nextForm.ship,
        shipCount: nextForm.shipCount,
        moduleType: nextForm.moduleType,
        boostShip: nextForm.boostShip,
      },
    };
  }

  function openSavedSheet() {
    setSetupError("");
    setSaveName(selectedFleet?.setupName || defaultFleetName(form));
    setSavedSheetOpen(true);
    if (authUser) void refreshSavedFleets(selectedFleetId || undefined);
  }

  async function saveCurrentFleet(mode: "create" | "update") {
    if (!authUser) {
      requestSiteAuthModal("login");
      return;
    }

    const name = saveName.trim() || defaultFleetName(form);
    if (!name) {
      setSetupError("Fleet name is required.");
      return;
    }

    const updating = mode === "update" && selectedFleet;
    setSetupBusy("save");
    try {
      const response = await fetch(
        updating
          ? `/api/tool-setups/${GAS_SETUP_TOOL_KEY}/${selectedFleet.id}`
          : `/api/tool-setups/${GAS_SETUP_TOOL_KEY}`,
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
      const response = await fetch(`/api/tool-setups/${GAS_SETUP_TOOL_KEY}/${selectedFleet.id}`, {
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
      const response = await fetch(`/api/tool-setups/${GAS_SETUP_TOOL_KEY}/${id}`, { credentials: "include" });
      const data = await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
      const nextForm = formFromSetupJson(data.setup.setupJson);
      setForm(nextForm);
      setSelectedFleetId(id);
      setSaveName(data.setup.setupName);
      setSetupError("");
      setSavedSheetOpen(false);
      await calculate(nextForm);
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
      setSaveName(defaultFleetName(form));
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
      <button type="button" className="mobile-gas-button" onClick={openSavedSheet}>
        <EveIcon icon={icons.saved} className="h-4 w-4" />
        Saved
      </button>
      <button
        type="button"
        disabled={loading}
        className="inline-flex min-h-8 items-center justify-center gap-1 border border-[#46b2ff]/70 bg-gradient-to-b from-[#1b8cc8] to-[#14608a] px-1.5 text-[9px] font-semibold uppercase tracking-widest text-slate-50 shadow-[0_0_10px_rgba(70,178,255,0.25)] disabled:opacity-50"
        onClick={() => void calculate()}
      >
        <EveIcon icon={icons.calculate} className="h-4 w-4" />
        {loading ? "Calc..." : "Calc"}
      </button>
    </div>
  );

  return (
    <ToolMobileShellV2
      title="Gas Huffing"
      subtitle={topSubtitle}
      icon={icons.gas}
      actions={actions}
      navItems={navItems}
      activeView={view}
      onView={setView}
    >
      <style>{`
        .mobile-gas-button {
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
        .mobile-gas-input {
          min-height: 2.25rem;
          border: 1px solid #303236;
          background: #05070b;
          padding: 0.25rem 0.5rem;
          font-size: 16px;
          line-height: 1.25;
          color: #f8fafc;
          outline: none;
        }
        .mobile-gas-slider {
          height: 1.25rem;
          accent-color: #53b6ff;
        }
      `}</style>

      {error && (
        <div className="mb-1.5 border border-[#6b2b32] bg-[#1d090b] px-2 py-1.5 text-[12px] text-[#ffaaaa]">
          {error}
        </div>
      )}

      {view === "setup" && (
        <SetupView
          form={form}
          moduleOptions={moduleOptions}
          onShip={updateShip}
          onForm={updateForm}
          onSkill={updateSkill}
        />
      )}
      {view !== "setup" && (
        <GasFamilyView
          family={view}
          loading={loading}
          groups={activeGroups}
          onSite={setSelectedSite}
          onCalculate={() => void calculate()}
        />
      )}

      {selectedSite && (
        <SiteDetailsSheet group={selectedSite} onClose={() => setSelectedSite(null)} />
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

function SetupView({
  form,
  moduleOptions,
  onShip,
  onForm,
  onSkill,
}: {
  form: GasCalcForm;
  moduleOptions: string[];
  onShip: (ship: string) => void;
  onForm: (patch: Partial<GasCalcForm>) => void;
  onSkill: (skill: GasSkillKey, value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <FleetView
        form={form}
        moduleOptions={moduleOptions}
        onShip={onShip}
        onForm={onForm}
      />
      <SkillsView
        form={form}
        onSkill={onSkill}
      />
      <BoostsView
        form={form}
        onForm={onForm}
        onSkill={onSkill}
      />
      <PricingView
        form={form}
        onForm={onForm}
      />
    </div>
  );
}

function FleetView({
  form,
  moduleOptions,
  onShip,
  onForm,
}: {
  form: GasCalcForm;
  moduleOptions: string[];
  onShip: (ship: string) => void;
  onForm: (patch: Partial<GasCalcForm>) => void;
}) {
  return (
    <div className="space-y-1.5">
      <section className="border border-[#2c2f36] bg-[#070910] p-2">
        <SectionTitle title="Fleet" />
        <div className="space-y-2">
          <SelectField
            label="Ship"
            value={form.ship}
            options={ships.map((ship) => ({ label: ship, value: ship }))}
            onChange={onShip}
          />
          <SelectField
            label="Module"
            value={form.moduleType}
            options={moduleOptions.map((module) => ({ label: module, value: module }))}
            onChange={(moduleType) => onForm({ moduleType })}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Modules"
              value={form.moduleCount}
              min={1}
              max={99}
              onChange={(moduleCount) => onForm({ moduleCount })}
            />
            <NumberField
              label="Ships"
              value={form.shipCount}
              min={1}
              max={999}
              onChange={(shipCount) => onForm({ shipCount })}
            />
          </div>
          <SelectField
            label="Gas Implant"
            value={String(form.implant)}
            options={implantOptions.map((option) => ({ label: option.label, value: String(option.value) }))}
            onChange={(value) => onForm({ implant: Number(value) })}
          />
        </div>
      </section>
    </div>
  );
}

function SkillsView({
  form,
  onSkill,
}: {
  form: GasCalcForm;
  onSkill: (skill: GasSkillKey, value: number) => void;
}) {
  return (
    <section className="border border-[#2c2f36] bg-[#070910] p-2">
      <SectionTitle title="Ship Skills" />
      <div className="space-y-1.5">
        {shipSkillFields.map((skill) => (
          <LevelSlider
            key={skill}
            label={skillLabel(skill)}
            value={form.skills[skill]}
            onChange={(value) => onSkill(skill, value)}
          />
        ))}
      </div>
    </section>
  );
}

function BoostsView({
  form,
  onForm,
  onSkill,
}: {
  form: GasCalcForm;
  onForm: (patch: Partial<GasCalcForm>) => void;
  onSkill: (skill: GasSkillKey, value: number) => void;
}) {
  return (
    <section className="border border-[#2c2f36] bg-[#070910] p-2">
      <SectionTitle title="Boosts" />
      <div className="space-y-2">
        <SelectField
          label="Boost Ship"
          value={form.boostShip}
          options={boostShipOptions}
          onChange={(boostShip) => onForm({ boostShip })}
        />
        <div className="space-y-1.5">
          <LevelSlider
            label="Mining Director"
            value={form.miningDirector}
            onChange={(miningDirector) => onForm({ miningDirector })}
          />
          <LevelSlider
            label="Industrial Command"
            value={form.industrialCommand}
            onChange={(industrialCommand) => onForm({ industrialCommand })}
          />
          <LevelSlider
            label="Command Destroyers"
            value={form.skills.CommandDestroyer}
            onChange={(value) => onSkill("CommandDestroyer", value)}
          />
        </div>
        <SelectField
          label="Boost Implant"
          value={form.boostImplant}
          options={boostImplantOptions}
          onChange={(boostImplant) => onForm({ boostImplant })}
        />
        <div className="grid grid-cols-2 gap-2">
          <SelectField
            label="Boost Module"
            value={form.boostModule}
            options={boostModules}
            onChange={(boostModule) => onForm({ boostModule })}
          />
          <SelectField
            label="Industrial Core"
            value={form.bastion}
            options={industrialCoreOptions.map((value) => ({ label: value, value }))}
            onChange={(bastion) => onForm({ bastion })}
          />
        </div>
      </div>
    </section>
  );
}

function PricingView({
  form,
  onForm,
}: {
  form: GasCalcForm;
  onForm: (patch: Partial<GasCalcForm>) => void;
}) {
  return (
    <section className="border border-[#2c2f36] bg-[#070910] p-2">
      <SectionTitle title="Pricing" />
      <SelectField
        label="Jita Price Mode"
        value={form.priceField}
        options={gasPriceOptions}
        onChange={(priceField) => onForm({ priceField: priceField as GasPriceField })}
      />
    </section>
  );
}

function GasFamilyView({
  family,
  loading,
  groups,
  onSite,
  onCalculate,
}: {
  family: GasFamily;
  loading: boolean;
  groups: SiteGroup[];
  onSite: (group: SiteGroup) => void;
  onCalculate: () => void;
}) {
  const familyMeta = gasFamilyTabs.find((tab) => tab.key === family)!;

  if (!groups.length) {
    return <EmptyResults loading={loading} onCalculate={onCalculate} />;
  }

  return (
    <div className="space-y-1.5">
      <section className="border border-[#303236] bg-[#05070b]/95">
        <div className="border-b border-[#151922] px-2 py-2">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold uppercase tracking-widest text-slate-200">
              {familyMeta.label}
            </div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
              {groups.length} site{groups.length === 1 ? "" : "s"} - sorted by biggest cloud ISK/hr
            </div>
          </div>
        </div>
        {family === "cytoserocin" && (
          <div className="border-t border-amber-500/40 bg-amber-950/30 px-2 py-1.5 text-[11px] leading-snug text-amber-100">
            Cytoserocin danger data is incomplete and may be stale.
          </div>
        )}
      </section>

      <div className="space-y-1.5">
        {groups.map((group) => (
          <SiteCard key={group.key} group={group} onClick={() => onSite(group)} />
        ))}
      </div>
    </div>
  );
}

function EmptyResults({ loading, onCalculate }: { loading: boolean; onCalculate: () => void }) {
  return (
    <section className="border border-[#2c2f36] bg-[#070910] p-3">
      <div className="text-[12px] font-semibold uppercase tracking-widest text-slate-200">No Results Yet</div>
      <div className="mt-1 text-[12px] leading-snug text-slate-400">
        Configure the fleet, then calculate to rank fullerite, mykoserocin, and cytoserocin sites.
      </div>
      <button
        type="button"
        disabled={loading}
        className="mobile-gas-button mt-3 min-h-9 w-full border-[#46b2ff]/70 text-[#dff3ff] disabled:opacity-50"
        onClick={onCalculate}
      >
        {loading ? "Calculating..." : "Calculate Gas"}
      </button>
    </section>
  );
}

function SiteCard({ group, onClick }: { group: SiteGroup; onClick: () => void }) {
  const summary = group.summary;

  return (
    <button type="button" className="w-full border border-[#2c2f36] bg-[#070910] text-left active:border-[#53b6ff]/70" onClick={onClick}>
      <div className="border-b border-[#151922] px-2 py-2">
        <div className="truncate text-[12px] font-semibold text-slate-100">{summary.siteName}</div>
        <div className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-widest text-slate-500">Tap for details</div>
      </div>

      <div className="border-b border-[#151922] px-2 py-1">
        <div className="grid grid-cols-[32px,minmax(0,1fr),56px,64px,44px,66px] gap-1 font-mono text-[9px] uppercase tracking-wider text-slate-500">
          <span />
          <span>Gas</span>
          <span className="text-right">m3</span>
          <span className="text-right">ISK</span>
          <span className="text-right">TTK</span>
          <span className="text-right">ISK/hr</span>
        </div>
      </div>

      <div className="divide-y divide-[#151922] px-2">
        {group.rows.map((row) => (
          <div
            key={`${row.site}-${row.gas}-${row._rowIndex}`}
            className="grid grid-cols-[32px,minmax(0,1fr),56px,64px,44px,66px] items-center gap-1 py-2.5"
          >
            <span className="flex h-8 w-8 items-center justify-center">
              {row.gasTypeId ? (
                <img src={typeIconUrl(row.gasTypeId)} alt="" className="h-8 w-8" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center border border-[#303236] bg-[#05070b] text-[#8bd3ff]">
                  <EveIcon icon={icons.gas} className="h-5 w-5" />
                </span>
              )}
            </span>
            <span className="min-w-0 truncate text-[12px] text-slate-100">{row.gas}</span>
            <span className="text-right font-mono text-[11px] text-slate-300">{compactNumber(row.m3PerCloud ?? row.m3_per_cloud)}</span>
            <span className="text-right font-mono text-[11px] text-slate-300">{compactNumber(row.iskPerCloud ?? row.totalIskPerCloud)}</span>
            <span className="text-right font-mono text-[11px] text-slate-300">{row.ttk || row.minutesToHuff}</span>
            <span className="text-right font-mono text-[11px] font-semibold text-[#8bd3ff]">{compactNumber(row.iskPerHour)}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[1fr,auto] items-center gap-2 border-t border-[#151922] px-2 py-1.5">
        <div className="font-mono text-[9px] uppercase tracking-widest text-slate-500">Site total value</div>
        <div className="font-mono text-[11px] font-semibold text-slate-100">{isk(summary.iskPerSite)}</div>
      </div>
    </button>
  );
}

function SiteDetailsSheet({ group, onClose }: { group: SiteGroup; onClose: () => void }) {
  const summary = group.summary;
  const defender = group.family === "fullerite" ? fulleriteDefenders[summary.site] : undefined;
  const totals = defenderTotals(defender);
  const effectChips = [
    totals.scram !== 0 && { key: "scram" as const, label: "Scram", value: totals.scram },
    totals.web !== 0 && { key: "web" as const, label: "Web", value: totals.web },
    totals.neut !== 0 && { key: "neut" as const, label: "Neut", value: totals.neut },
    totals.rrep !== 0 && { key: "rrep" as const, label: "Remote Rep", value: totals.rrep },
  ].filter(Boolean) as { key: "scram" | "web" | "neut" | "rrep"; label: string; value: number }[];

  return (
    <ToolBottomSheetV2 title={summary.siteName} subtitle={`${gasFamilyLabel(group.family)} site details`} onClose={onClose}>
      <div className="space-y-2 p-2">
        <section className="grid grid-cols-2 gap-1">
          <MetricTile label="Top Cloud" value={`${isk(summary.bestCloudIskPerHour)}/hr`} />
          <MetricTile label="Site Value" value={isk(summary.iskPerSite)} />
          <MetricTile label="Time" value={summary.ttk} />
          <MetricTile label="Clouds" value={summary.cloudCount.toLocaleString()} />
        </section>

        <section className="border border-[#2c2f36] bg-[#070910]">
          <div className="border-b border-[#151922] px-2 py-1.5">
            <SectionTitle title="Gas Lines" />
          </div>
          <div className="divide-y divide-[#151922]">
            {group.rows.map((row) => (
              <div key={`${row.site}-${row.gas}-${row._rowIndex}`} className="grid grid-cols-[36px,1fr,32px] items-center gap-2 px-2 py-2">
                {row.gasTypeId ? <img src={typeIconUrl(row.gasTypeId)} alt="" className="h-8 w-8" /> : <span />}
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-slate-100">{row.gas}</span>
                    <ItemInfoLink typeId={row.gasTypeId} label={row.gas} />
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-1 font-mono text-[10px] text-slate-500">
                    <span>{compactNumber(row.m3_per_cloud)} m3/cloud</span>
                    <span>{row.ttk || row.minutesToHuff}</span>
                    <span>{isk(row.iskPerCloud ?? row.totalIskPerCloud)}</span>
                    <span className="text-[#ffaaaa]">{isk(row.iskLostResidue)} lost</span>
                  </div>
                </div>
                <span className="text-right font-mono text-[10px] text-slate-500">x{row.cloudCount ?? 1}</span>
              </div>
            ))}
          </div>
        </section>

        {(summary.location || summary.security || summary.cloudDamage || summary.hasNpcs || summary.deadspace) && (
          <section className="border border-[#2c2f36] bg-[#070910] p-2">
            <SectionTitle title="Site Notes" />
            <div className="mt-1 space-y-1 text-[12px] text-slate-300">
              {summary.location && <div className="leading-snug">{summary.location}</div>}
              <div className="flex flex-wrap gap-1">
                {summary.security && <Chip label={summary.security} />}
                {summary.hasNpcs && <Chip label="NPCs reported" tone="warning" />}
                {summary.deadspace && <Chip label="Deadspace" tone="warning" />}
                {summary.cloudDamage && summary.cloudDamage !== "None" && <Chip label={summary.cloudDamage} tone="danger" />}
              </div>
            </div>
          </section>
        )}

        {defender && (
          <section className="border border-[#2c2f36] bg-[#070910]">
            <div className="border-b border-[#151922] px-2 py-1.5">
              <SectionTitle title="Defenders" />
              <div className="mt-1 grid grid-cols-3 gap-1">
                <MetricTile label="EHP" value={compactNumber(totals.totalEhp)} />
                <MetricTile label="DPS" value={compactNumber(totals.totalDps)} />
                <MetricTile label="Alpha" value={compactNumber(totals.totalAlpha)} />
              </div>
              {effectChips.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {effectChips.map((chip) => (
                    <span key={chip.key} className="inline-flex items-center gap-1 border border-[#303236] bg-[#05070b] px-1.5 py-1 text-[10px] text-slate-200">
                      <img src={specialIcon(chip.key)} alt="" className="h-3 w-3" />
                      {chip.label}
                      <span className="text-amber-200">{chip.key === "neut" ? chip.value : `x${chip.value}`}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="divide-y divide-[#151922]">
              {defender.rats.map((rat) => (
                <div key={rat.name} className="grid grid-cols-[34px,1fr,auto] items-center gap-2 px-2 py-2">
                  <img src={shipClassIcon(rat.class)} alt="" className="h-7 w-7 opacity-85" />
                  <div className="min-w-0">
                    <div className="truncate text-[12px] text-slate-100">{rat.qty} x {rat.name}</div>
                    <div className="font-mono text-[10px] text-slate-500">
                      {rat.ehp.toLocaleString()} EHP - {rat.dps} DPS - {rat.dist}
                    </div>
                  </div>
                  <div className="text-right font-mono text-[10px] text-slate-500">{rat.orbit}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </ToolBottomSheetV2>
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
    <ToolBottomSheetV2 title="Saved Fleets" subtitle={authUser ? "Save and load gas setups" : "Sign in required"} onClose={onClose}>
      <div className="space-y-2 p-2">
        {!authChecked && (
          <div className="border border-[#20242c] bg-[#05070b] px-2 py-3 text-[12px] text-slate-400">
            Checking account...
          </div>
        )}

        {authChecked && !authUser && (
          <div className="space-y-2 border border-[#20242c] bg-[#05070b] p-2">
            <div className="text-[12px] text-slate-300">
              Saved gas fleets are tied to your Triff.Tools account.
            </div>
            <button type="button" className="mobile-gas-button min-h-9 w-full" onClick={onSignIn}>
              Sign In
            </button>
          </div>
        )}

        {authUser && (
          <>
            <section className="border border-[#2c2f36] bg-[#070910] p-2">
              <SectionTitle title={selectedFleet ? "Selected Fleet" : "Save Current Fleet"} />
              <input
                className="mobile-gas-input w-full"
                value={saveName}
                placeholder="Fleet name"
                disabled={disabled}
                onChange={(event) => onName(event.target.value)}
              />
              {selectedFleet ? (
                <>
                  <div className="mt-2 grid grid-cols-2 gap-1">
                    <button type="button" className="mobile-gas-button min-h-9" disabled={disabled} onClick={onSaveNew}>
                      Save New
                    </button>
                    <button type="button" className="mobile-gas-button min-h-9" disabled={disabled} onClick={onUpdate}>
                      {busy === "save" ? "Saving..." : "Update"}
                    </button>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-1">
                    <button type="button" className="mobile-gas-button min-h-9" disabled={disabled} onClick={onRename}>
                      Rename
                    </button>
                    <button type="button" className="mobile-gas-button min-h-9" disabled={disabled} onClick={onLoad}>
                      {busy === "load" ? "Loading..." : "Load"}
                    </button>
                    <button type="button" className="mobile-gas-button min-h-9 border-[#6b2b32] text-[#ffaaaa]" disabled={disabled} onClick={onDelete}>
                      Delete
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className="mobile-gas-button mt-2 min-h-9 w-full" disabled={disabled} onClick={onSaveNew}>
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
                <button type="button" className="mobile-gas-button min-h-8" disabled={disabled || loading} onClick={onRefresh}>
                  Refresh
                </button>
              </div>
              {loading && <div className="px-2 py-3 text-[12px] text-slate-500">Loading saved fleets...</div>}
              {!loading && fleets.length === 0 && <div className="px-2 py-3 text-[12px] text-slate-500">No saved fleets yet.</div>}
              {!loading && fleets.map((fleet) => {
                const shipCount = Number(fleet.summaryJson?.shipCount) || 1;
                const ship = fleet.summaryJson?.ship || "Gas Fleet";
                const moduleType = fleet.summaryJson?.moduleType || "";
                return (
                  <ToolTouchRowV2
                    key={fleet.id}
                    title={fleet.setupName}
                    subtitle={`${shipCount}x ${ship}${moduleType ? ` - ${moduleType}` : ""}`}
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
  onChange,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[9px] uppercase tracking-widest text-slate-500">{label}</span>
      <select className="mobile-gas-input w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
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
        className="mobile-gas-input w-full text-right"
        value={value}
        onChange={(event) => onChange(clampNumberField(event.target.value, min, max, value))}
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
        className="mobile-gas-slider w-full"
        onChange={(event) => onChange(clampNumberField(event.target.value, 0, 5, value))}
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

function Chip({ label, tone = "default" }: { label: string; tone?: "default" | "warning" | "danger" }) {
  return (
    <span className={classNames(
      "inline-flex border px-1.5 py-0.5 text-[10px]",
      tone === "danger"
        ? "border-[#6b2b32] bg-[#1d090b] text-[#ffaaaa]"
        : tone === "warning"
          ? "border-amber-500/40 bg-amber-950/30 text-amber-100"
          : "border-[#303236] bg-[#05070b] text-slate-300",
    )}>
      {label}
    </span>
  );
}

function gasFamilyLabel(family: GasFamily) {
  if (family === "fullerite") return "Fullerite";
  if (family === "mykoserocin") return "Mykoserocin";
  return "Cytoserocin";
}
