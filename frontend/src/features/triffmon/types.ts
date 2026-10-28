export type QueueHealth = "healthy" | "warning" | "critical" | "gap" | "paused" | "empty" | "error";

export type CharacterPreference = {
  pinned: boolean;
  hidden: boolean;
  group: string | null;
};

export type TrainingItem = {
  id: string;
  skillTypeId: number | null;
  skillName: string;
  targetLevel: number | null;
  startAt: string | null;
  endAt: string | null;
  startSp: number | null;
  endSp: number | null;
  completedSp: number | null;
  queuePosition: number;
  planState: string | null;
};

export type TriffMonCharacter = CharacterPreference & {
  id: string;
  characterId: number | null;
  name: string;
  portraitUrl: string | null;
  corporationName: string | null;
  allianceName: string | null;
  totalSp: number | null;
  unallocatedSp: number | null;
  walletBalance: number | null;
  cloneState: string | null;
  currentTraining: TrainingItem | null;
  nextTraining: TrainingItem | null;
  queueState: string;
  queueEndAt: string | null;
  queueDurationSeconds: number | null;
  queueHealth: QueueHealth;
  queueLength: number;
  tokenStatus: string;
  missingScopes: string[];
  lastUpdatedAt: string | null;
  stale: boolean;
  error: string | null;
};

export type SkillPrerequisite = {
  skillTypeId: number | null;
  skillName: string;
  requiredLevel: number;
  currentLevel: number;
  missing: boolean;
};

export type CharacterSkill = {
  skillTypeId: number;
  skillName: string;
  groupId: number | null;
  groupName: string;
  level: number;
  activeLevel: number;
  skillpoints: number;
  rank: number | null;
  primaryAttribute: string | null;
  secondaryAttribute: string | null;
  prerequisites: SkillPrerequisite[];
  missingPrerequisites: SkillPrerequisite[];
  spToNextLevel: number | null;
  spToLevelFive: number | null;
  secondsToNextLevel: number | null;
  secondsToLevelFive: number | null;
  partiallyTrained: boolean;
  currentlyTraining: boolean;
  queued: boolean;
};

export type CharacterAttribute = {
  name: string;
  value: number;
};

export type CharacterImplant = {
  typeId: number | null;
  name: string;
  slot: number | null;
  bonus: string | null;
};

export type CharacterDataStatus = {
  available: boolean;
  missingScope: boolean;
  fetchedAt: string | null;
  stale: boolean;
  error: string | null;
};

export type CharacterJumpClone = {
  jumpCloneId: number;
  name: string | null;
  locationId: number;
  locationType: "station" | "structure" | null;
  implants: CharacterImplant[];
  implantCount: number;
};

export type CharacterClones = {
  activeClone: {
    implants: CharacterImplant[];
    implantCount: number;
  };
  jumpClones: CharacterJumpClone[];
  homeLocation: {
    locationId: number;
    locationType: "station" | "structure" | null;
  } | null;
  lastCloneJumpDate: string | null;
  lastStationChangeDate: string | null;
};

export type CharacterSnapshot = {
  characterId: string;
  character: TriffMonCharacter | null;
  skills: CharacterSkill[];
  queue: TrainingItem[];
  attributes: CharacterAttribute[];
  implants: CharacterImplant[];
  implantStatus: CharacterDataStatus;
  clones: CharacterClones;
  cloneStatus: CharacterDataStatus;
  temporaryAttributeBonus: number | null;
  attributeEstimateWarning: string | null;
  fetchedAt: string | null;
  stale: boolean;
  error: string | null;
};

export type CatalogSkill = {
  skillTypeId: number;
  skillName: string;
  groupId: number | null;
  groupName: string;
  rank: number | null;
  primaryAttribute: string | null;
  secondaryAttribute: string | null;
  prerequisites: SkillPrerequisite[];
};

export type RequirementTarget = {
  typeId: number;
  name: string;
  groupName: string | null;
  categoryName: string | null;
  iconUrl: string | null;
};

export type TriffMonCatalog = {
  skills: CatalogSkill[];
  skillGroups: Array<{ id: number | null; name: string }>;
  requirementTargets: RequirementTarget[];
};

export type SkillPlanEntry = {
  id: string;
  skillTypeId: number;
  skillName: string;
  targetLevel: number;
  position: number;
  sectionId: string | null;
  section: string | null;
  notes: string | null;
  autoAdded: boolean;
  sourceType: string | null;
  sourceMetadata: Record<string, unknown>;
  currentLevel: number | null;
  activeLevel: number | null;
  currentSp: number | null;
  targetSp: number | null;
  remainingSp: number | null;
  trainingSeconds: number | null;
  alreadyTrained: boolean;
  partiallyTrained: boolean;
};

export type SkillPlanSection = {
  id: string;
  title: string;
  position: number;
  notes: string | null;
  remapAttributes: Record<string, unknown> | null;
  settings: Record<string, unknown>;
};

export type SkillPlan = {
  id: string;
  name: string;
  characterId: string | null;
  characterName: string | null;
  notes: string | null;
  sections: SkillPlanSection[];
  entries: SkillPlanEntry[];
  totalSp: number | null;
  remainingSp: number | null;
  trainingSeconds: number | null;
  completionAt: string | null;
  settings: Record<string, unknown>;
  sourceType: string | null;
  sourceMetadata: Record<string, unknown>;
  lockVersion: number;
  importWarnings: string[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type PlanQueuePair = {
  skillTypeId: number;
  level: number;
  order: number;
  queuePosition: number | null;
  status: string | null;
};

export type PlanQueueOrderMismatch = {
  index: number;
  queued: PlanQueuePair | null;
  planned: PlanQueuePair | null;
};

export type PlanQueueComparison = {
  queued: PlanQueuePair[];
  planned: PlanQueuePair[];
  matched: PlanQueuePair[];
  queuedNotPlanned: PlanQueuePair[];
  plannedNotQueued: PlanQueuePair[];
  inOrderPrefixLength: number;
  orderMismatches: PlanQueueOrderMismatch[];
  exactMatch: boolean;
};

export type ImportedPlan = {
  plan: SkillPlan;
  warnings: string[];
};

export type PlanAnalysis = {
  remainingSp: number | null;
  trainingSeconds: number | null;
  completionAt: string | null;
  trainedCount: number;
  partialCount: number;
  missingCount: number;
  warnings: string[];
  entries: SkillPlanEntry[];
  queueComparison: PlanQueueComparison | null;
};

export type PlanOptimizationSegment = {
  label: string;
  primaryAttribute: string | null;
  secondaryAttribute: string | null;
  attributes: Record<string, number>;
  trainingSeconds: number | null;
  startsAtEntry: number | null;
};

export type PlanOptimization = {
  currentSeconds: number | null;
  optimizedSeconds: number | null;
  secondsSaved: number | null;
  attributes: Record<string, number>;
  segments: PlanOptimizationSegment[];
  warnings: string[];
};

export type RequirementSkill = {
  skillTypeId: number;
  skillName: string;
  requiredLevel: number;
  currentLevel: number;
  trainedLevel: number;
  activeLevel: number;
  inactiveDueToCloneState: boolean;
  missingLevels: number;
  missingSp: number | null;
  trainingSeconds: number | null;
  prerequisites: SkillPrerequisite[];
};

export type CharacterRequirementResult = {
  characterId: string;
  characterName: string;
  portraitUrl: string | null;
  canUse: boolean;
  inactiveDueToCloneState: boolean;
  missingSp: number | null;
  trainingSeconds: number | null;
  missingSkills: RequirementSkill[];
};

export type RequirementAnalysis = {
  typeId: number;
  typeName: string;
  iconUrl: string | null;
  selectedCount: number;
  readyCount: number;
  underOneDayCount: number;
  overSevenDaysCount: number;
  inactiveCloneCount: number;
  characters: CharacterRequirementResult[];
  warnings: string[];
};

export type ExportedPlan = {
  content: string;
  filename: string;
  mimeType: string;
  encoding?: "base64";
};

export type TriffMonRoute =
  | { view: "dashboard" }
  | { view: "character"; characterId: string; tab: "skills" | "queue" }
  | { view: "plans"; planId: string | null }
  | { view: "requirements" };
