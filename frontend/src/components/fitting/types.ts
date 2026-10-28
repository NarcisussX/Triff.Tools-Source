export type SlotKey = "high" | "mid" | "low" | "rig" | "subsystem";
export type HardpointKind = "turret" | "launcher" | "none";

export type SkillProfile =
  | { mode: "all_v" }
  | { mode: "alpha_clone" }
  | {
      mode: "esi_character";
      characterId: number;
      characterName?: string;
      skillsSyncedAt?: string | null;
      tokenStatus?: string | null;
    };

export type SkillOverrideMap = Record<string, number>;

export type AffectedSkill = {
  skillTypeId: number;
  skillName: string;
  currentLevel: number;
  learned?: boolean;
  hasOverride?: boolean;
  overrideLevel?: number | null;
  affectsStats?: boolean;
  required?: boolean;
  requiredLevel?: number | null;
};

export type ShipModeOption = {
  modeId: string;
  typeId: number;
  label: string;
  fullName: string;
};

export type SelectedShipMode = {
  modeId: string;
  typeId?: number | null;
  modeName?: string | null;
  label?: string | null;
  fullName?: string | null;
};

export type DamageProfileSelection = {
  profileId: string;
  name?: string | null;
  label?: string | null;
  fullName?: string | null;
  em?: number | null;
  thermal?: number | null;
  kinetic?: number | null;
  explosive?: number | null;
  source?: string | null;
};

export type DamageProfileNode = {
  key: string;
  label: string;
  children?: DamageProfileNode[];
  profileId?: string | null;
  name?: string | null;
  fullName?: string | null;
  em?: number | null;
  thermal?: number | null;
  kinetic?: number | null;
  explosive?: number | null;
  source?: string | null;
};

export type LinkedEsiCharacter = {
  id: string;
  characterId: number;
  characterName: string;
  scopes?: string[];
  skillsSyncedAt?: string | null;
  tokenStatus?: string | null;
  lastError?: string | null;
  totalSp?: number | null;
  unallocatedSp?: number | null;
};

export type FittingModule = {
  id?: string;
  typeId: number;
  typeName?: string;
  chargeTypeId?: number;
  chargeTypeName?: string;
  state?: string;
  previousState?: string;
  fitting?: FittingAttributes | null;
  hardpoint?: HardpointKind | null;
  hardpointName?: string | null;
  fitsToShipTypeId?: number | null;
  mutation?: ModuleMutation | null;
  abyssalPlaceholder?: boolean;
  placeholderReason?: string | null;
  groupName?: string | null;
  spoolType?: "cycles" | "spool_scale" | "cycle_scale" | "time" | string | null;
  spoolAmount?: number | null;
};

export type QuantityItem = {
  typeId: number;
  typeName?: string;
  quantity?: number;
  active?: number;
  enabled?: boolean;
  slot?: number | null;
  implantSlot?: number | null;
  boosterSlot?: number | null;
  bandwidthPerDrone?: number | null;
  bandwidthUsed?: number | null;
  dps?: number | null;
  volley?: number | null;
};

export type FitPayload = {
  shipTypeId: number | null;
  shipTypeName?: string;
  fitName: string;
  characterMode: "all_v";
  skillProfile?: SkillProfile;
  skillOverrides?: SkillOverrideMap;
  shipMode?: SelectedShipMode | null;
  damageProfile?: DamageProfileSelection | null;
  modules: Record<SlotKey, FittingModule[]>;
  drones: QuantityItem[];
  fighters: QuantityItem[];
  cargo: QuantityItem[];
  implants: QuantityItem[];
  boosters: QuantityItem[];
  projectedEffects: EnvironmentEffect[];
  environment: {
    wormholeEffect: unknown | null;
    abyssalWeather: unknown | null;
  };
};

export type SearchResult = {
  typeId: number;
  typeName: string;
  groupId?: number | null;
  groupName?: string | null;
  categoryId?: number | null;
  categoryName?: string | null;
  marketGroupId?: number | null;
  marketGroupName?: string | null;
  pyfaKind?: string | null;
  slot?: SlotKey | string | null;
  metaGroupId?: number | null;
  metaGroupName?: string | null;
  parentTypeId?: number | null;
  fitting?: FittingAttributes | null;
  hardpoint?: HardpointKind | null;
  hardpointName?: string | null;
  fitsToShipTypeId?: number | null;
  implantSlot?: number | null;
  boosterSlot?: number | null;
  variantGroup?: string | null;
  implantFamily?: string | null;
  boosterFamily?: string | null;
  setSlotName?: string | null;
};

export type FittingAttributes = {
  cpu?: number | null;
  powergrid?: number | null;
  capacitorNeed?: number | null;
  duration?: number | null;
  optimalRange?: number | null;
  falloff?: number | null;
  trackingSpeed?: number | null;
  chargeSize?: number | null;
  capacity?: number | null;
};

export type BrowserCategory = {
  key: string;
  label: string;
  id?: number | null;
  parentId?: number | null;
  marketGroupId?: number | null;
  iconId?: number | null;
  iconName?: string | null;
  hasChildren?: boolean;
  hasItems?: boolean;
  children?: BrowserCategory[];
  placeholder?: boolean;
  groupNames?: string[];
  categoryNames?: string[];
  marketGroupNames?: string[];
};

export type AuthUser = {
  id: string;
  username: string;
};

export type SavedFitRecord = {
  id: string;
  fitName: string;
  shipTypeId: number;
  shipName: string;
  shipClass?: string | null;
  groupName?: string | null;
  fitJson?: FitPayload;
  eftText?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  lastOpenedAt?: string | null;
};

export type SavedFitShipNode = {
  key: string;
  shipTypeId: number;
  shipName: string;
  groupName?: string | null;
  fits: Array<{
    id: string;
    fitName: string;
    updatedAt?: string;
    lastOpenedAt?: string | null;
  }>;
};

export type SavedFitGroup = {
  key: string;
  shipClass: string;
  children: SavedFitShipNode[];
};

export type CustomSavedFitGroupFit = {
  id: string;
  fitName: string;
  shipTypeId: number;
  shipName: string;
  groupName?: string | null;
  updatedAt?: string;
  lastOpenedAt?: string | null;
};

export type CustomSavedFitGroup = {
  id: string;
  key: string;
  name: string;
  fits: CustomSavedFitGroupFit[];
  createdAt?: string;
  updatedAt?: string;
};

export type SavedFitFocus = {
  savedFitId: string;
  shipTypeId: number;
  token: number;
};

export type EnvironmentEffect = {
  kind: "environment";
  effectId: string;
  typeId: number;
  typeName?: string;
  label: string;
  category: string;
  categoryLabel?: string;
  source?: string;
};

export type EnvironmentEffectNode = {
  key: string;
  label: string;
  children?: EnvironmentEffectNode[];
  disabled?: boolean;
  source?: string;
  effectId?: string;
  typeId?: number;
  typeName?: string;
  category?: string;
};

export type ImplantSetGrade = {
  key: string;
  label: string;
  familyLabel?: string | null;
  items: Array<{
    typeId: number;
    typeName: string;
    slot: number;
    setSlotName?: string | null;
  }>;
};

export type ImplantSet = {
  key: string;
  label: string;
  grades: ImplantSetGrade[];
};

export type CrossFitSourceSummary = {
  tabId: string;
  fitName: string;
  shipTypeId: number | null;
  shipName?: string | null;
  dirty?: boolean;
};

export type ProjectedFitLink = {
  id: string;
  sourceTabId: string;
  enabled: boolean;
  type: "projected_fit";
};

export type CommandBurstSelection = {
  sourceModuleInstanceId: string;
  moduleTypeId?: number | null;
  moduleName?: string | null;
  chargeTypeId?: number | null;
  chargeTypeName?: string | null;
  enabled: boolean;
};

export type CommandFitLink = {
  id: string;
  sourceTabId: string;
  enabled: boolean;
  selectedBursts: CommandBurstSelection[];
};

export type CrossFitAppliedModule = {
  sourceModuleInstanceId?: string;
  typeId?: number;
  typeName?: string;
  state?: string;
  chargeTypeId?: number | null;
  chargeTypeName?: string | null;
  effectType?: string;
};

export type CrossFitSourceResult = {
  id?: string;
  sourceTabId: string;
  fitName?: string;
  shipName?: string | null;
  dirty?: boolean;
  enabled?: boolean;
  appliedEffects?: CrossFitAppliedModule[];
  bursts?: CrossFitAppliedModule[];
};

export type ChargeResult = SearchResult & {
  chargeGroupId?: number | null;
  chargeGroupName?: string | null;
};

export type MutationAttribute = {
  attributeId: number;
  attributeName: string;
  displayName?: string | null;
  value?: number | null;
  baseValue?: number | null;
  minValue?: number | null;
  maxValue?: number | null;
  minModifier?: number | null;
  maxModifier?: number | null;
  highIsGood?: boolean | null;
  unit?: string | null;
};

export type ModuleMutation = {
  reference?: number | null;
  baseTypeId?: number | null;
  baseTypeName?: string | null;
  mutaplasmidTypeId: number;
  mutaplasmidName: string;
  prefix?: string | null;
  resultingTypeId?: number | null;
  resultingTypeName?: string | null;
  displayName?: string | null;
  pyfaFullName?: string | null;
  attributes: Record<string, number>;
  attributeIds?: Record<string, number>;
  attributeDetails?: MutationAttribute[];
  unknownAttributes?: string[];
};

export type MutaplasmidResult = {
  typeId: number;
  typeName: string;
  shortName?: string | null;
  resultingTypeId?: number | null;
  resultingTypeName?: string | null;
  attributes?: MutationAttribute[];
};

export type ModuleRowRef = {
  key: string;
  slot: SlotKey;
  index: number;
  module: FittingModule;
  row?: FittedModuleRow | null;
};

export type FitMessage = {
  code?: string;
  message: string;
};

export type MissingSkill = {
  skillTypeId: number;
  skillName: string;
  requiredLevel: number;
  actualLevel?: number | null;
};

export type SkillWarning = {
  code: "MISSING_SKILLS";
  scope: "ship" | "module" | "drone" | "fighter" | "implant" | "booster" | string;
  itemTypeId: number;
  itemName: string;
  slot?: SlotKey | null;
  index?: number | null;
  moduleInstanceId?: string | null;
  chargeTypeId?: number | null;
  chargeName?: string | null;
  missingSkills: MissingSkill[];
};

export type DamageValues = {
  em?: number | null;
  thermal?: number | null;
  kinetic?: number | null;
  explosive?: number | null;
};

export type RechargeRateRow = {
  stableEhpPerSecond?: number | null;
  maxEhpPerSecond?: number | null;
};

export type LocalTankRows = {
  stable?: {
    passiveShieldEhpPerSecond?: number | null;
    activeShieldEhpPerSecond?: number | null;
    activeArmorEhpPerSecond?: number | null;
    activeHullEhpPerSecond?: number | null;
    totalEhpPerSecond?: number | null;
  };
  max?: {
    passiveShieldEhpPerSecond?: number | null;
    activeShieldEhpPerSecond?: number | null;
    activeArmorEhpPerSecond?: number | null;
    activeHullEhpPerSecond?: number | null;
    totalEhpPerSecond?: number | null;
  };
};

export type FitPrice = {
  ship?: number;
  fittings?: number;
  drones?: number;
  cargo?: number;
  character?: number;
  total?: number;
  mode?: string;
  stationId?: number;
  priceField?: string;
  itemPrices?: Record<string, number>;
  missingTypeIds?: number[];
  error?: string;
} | null;

export type ModuleDisplayCell = {
  value?: string | null;
  tooltip?: string | null;
  [key: string]: unknown;
};

export type FittedModuleRow = {
  slot: SlotKey;
  index: number;
  typeId: number;
  name?: string;
  baseName?: string;
  state?: string;
  validStates?: string[];
  canOverheat?: boolean;
  spool?: {
    eligible?: boolean;
    groupName?: string | null;
    minCycles?: number | null;
    maxCycles?: number | null;
    currentCycles?: number | null;
    currentTimeSeconds?: number | null;
    spoolType?: string | null;
    spoolAmount?: number | null;
  } | null;
  chargeTypeId?: number | null;
  chargeName?: string | null;
  cpu?: number | null;
  powergrid?: number | null;
  mutation?: ModuleMutation | null;
  abyssalPlaceholder?: boolean;
  placeholderReason?: string | null;
  displayStats?: {
    capOrFuel?: ModuleDisplayCell;
    range?: ModuleDisplayCell;
    trackingOrApplication?: ModuleDisplayCell;
  };
};

export type FittingStats = {
  ship?: SearchResult | null;
  shipModes?: {
    activeModeId?: string | null;
    activeModeTypeId?: number | null;
    available?: ShipModeOption[];
  };
  resources?: Record<string, { used?: number; output?: number }>;
  slots?: Record<string, { used?: number; total?: number; free?: number }>;
  hardpoints?: Record<"turret" | "launcher", { used?: number | null; total?: number | null; free?: number | null }>;
  moduleRows?: Record<SlotKey, FittedModuleRow[]>;
  requiredSkills?: MissingSkill[];
  skillWarnings?: SkillWarning[];
  fitWarningSummary?: {
    missingSkillCount?: number;
    affectedItemCount?: number;
  };
  defense?: {
    hp?: Record<string, number>;
    rawHp?: Record<string, number>;
    ehp?: Record<string, number>;
    resists?: Record<string, DamageValues>;
    tank?: Record<string, number>;
    effectiveTank?: Record<string, number>;
  };
  damageProfile?: {
    profileId?: string | null;
    name?: string | null;
    label?: string | null;
    fullName?: string | null;
    em?: number | null;
    thermal?: number | null;
    kinetic?: number | null;
    explosive?: number | null;
    source?: string | null;
  };
  rechargeRates?: Record<string, RechargeRateRow>;
  localTank?: LocalTankRows;
  remoteReps?: Record<string, number>;
  mining?: {
    minerYieldM3PerSecond?: number | null;
    droneYieldM3PerSecond?: number | null;
    totalYieldM3PerSecond?: number | null;
    minerDrainM3PerSecond?: number | null;
    droneDrainM3PerSecond?: number | null;
    totalDrainM3PerSecond?: number | null;
    unit?: string;
  };
  price?: FitPrice;
  capacitor?: {
    stable?: boolean;
    state?: number;
    stateUnit?: string;
    used?: number;
    recharge?: number;
    delta?: number;
    capacity?: number;
    rechargeTime?: number;
    lastsSeconds?: number | null;
    stablePercent?: number | null;
    deltaGjPerSecond?: number;
    capacityGj?: number;
    neutralizerResistancePercent?: number | null;
    effectiveExcessGainGjPerSecond?: number | null;
  };
  firepower?: Record<string, number>;
  targeting?: Record<string, number | string>;
  navigation?: Record<string, number>;
  drones?: Record<string, number>;
  droneRows?: QuantityItem[];
  fighters?: Record<string, number>;
  fighterRows?: QuantityItem[];
  crossFit?: {
    projectedSources?: CrossFitSourceResult[];
    commandSources?: CrossFitSourceResult[];
  };
};

export type CalculationResponse = {
  ok: boolean;
  payload?: FitPayload;
  stats?: FittingStats | null;
  warnings?: FitMessage[];
  errors?: FitMessage[];
};

export const SLOT_LABELS: Record<SlotKey, string> = {
  high: "High Slots",
  mid: "Mid Slots",
  low: "Low Slots",
  rig: "Rigs",
  subsystem: "Subsystems",
};

export const SLOT_ORDER: SlotKey[] = ["high", "mid", "low", "rig", "subsystem"];

export function emptyFit(): FitPayload {
  return {
    shipTypeId: null,
    fitName: "New Fit",
    characterMode: "all_v",
    skillProfile: { mode: "all_v" },
    shipMode: null,
    damageProfile: null,
    modules: {
      high: [],
      mid: [],
      low: [],
      rig: [],
      subsystem: [],
    },
    drones: [],
    fighters: [],
    cargo: [],
    implants: [],
    boosters: [],
    projectedEffects: [],
    environment: {
      wormholeEffect: null,
      abyssalWeather: null,
    },
  };
}

export function ensureFitPayload(raw: Partial<FitPayload> | null | undefined): FitPayload {
  const base = emptyFit();
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    fitName: raw.fitName || base.fitName,
    characterMode: "all_v",
    skillProfile: raw.skillProfile || base.skillProfile,
    skillOverrides: raw.skillOverrides || undefined,
    shipMode: raw.shipMode ?? null,
    damageProfile: raw.damageProfile ?? null,
    modules: {
      high: raw.modules?.high || [],
      mid: raw.modules?.mid || [],
      low: raw.modules?.low || [],
      rig: raw.modules?.rig || [],
      subsystem: raw.modules?.subsystem || [],
    },
    drones: raw.drones || [],
    fighters: raw.fighters || [],
    cargo: raw.cargo || [],
    implants: raw.implants || [],
    boosters: raw.boosters || [],
    projectedEffects: raw.projectedEffects || [],
    environment: {
      wormholeEffect: raw.environment?.wormholeEffect ?? null,
      abyssalWeather: raw.environment?.abyssalWeather ?? null,
    },
  };
}
