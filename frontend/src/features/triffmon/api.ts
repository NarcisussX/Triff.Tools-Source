import type {
  CatalogSkill,
  CharacterAttribute,
  CharacterImplant,
  CharacterRequirementResult,
  CharacterSkill,
  CharacterSnapshot,
  ExportedPlan,
  ImportedPlan,
  PlanAnalysis,
  PlanOptimization,
  PlanOptimizationSegment,
  PlanQueueComparison,
  PlanQueuePair,
  QueueHealth,
  RequirementAnalysis,
  RequirementSkill,
  RequirementTarget,
  SkillPlan,
  SkillPlanEntry,
  SkillPlanSection,
  SkillPrerequisite,
  TrainingItem,
  TriffMonCatalog,
  TriffMonCharacter,
} from "./types";
import type { TriffMonRequiredSkillTarget } from "./fitIntegration";

const API_ROOT = "/api/character-monitor";

type JsonRecord = Record<string, unknown>;

export class TriffMonApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TriffMonApiError";
    this.status = status;
  }
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function first(source: JsonRecord, keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function nested(source: JsonRecord, keys: string[]): JsonRecord {
  return record(first(source, keys));
}

function stringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function nullableString(value: unknown): string | null {
  const result = stringValue(value).trim();
  return result ? result : null;
}

function warningMessage(value: unknown): string | null {
  if (typeof value === "string") return nullableString(value);
  const source = record(value);
  const explicit = nullableString(first(source, ["message", "error", "detail"]));
  if (explicit) return explicit;

  const code = stringValue(first(source, ["code", "type"])).trim().toUpperCase();
  const row = integerValue(first(source, ["row", "line"]));
  if (code === "SKILL_ID_NAME_MISMATCH") {
    const importedName = stringValue(first(source, ["importedName", "imported_name"]), "the imported name");
    const canonicalName = stringValue(first(source, ["canonicalName", "canonical_name"]), "the current EVE name");
    return `Renamed ${importedName} to ${canonicalName} for skill type ${integerValue(first(source, ["skillTypeId", "skill_type_id"]))}.`;
  }
  if (code === "UNKNOWN_ID_NAME_FALLBACK") {
    return `Obsolete or unknown skill type ${integerValue(first(source, ["importedSkillTypeId", "imported_skill_type_id"]))} was resolved by name to type ${integerValue(first(source, ["resolvedSkillTypeId", "resolved_skill_type_id"]))}.`;
  }
  if (code === "UNRESOLVED_SKILL") {
    const name = nullableString(first(source, ["skillName", "skill_name"]));
    const typeId = numericValue(first(source, ["skillTypeId", "skill_type_id"]));
    return `Skipped unresolved skill ${name ? `\"${name}\"` : typeId ? `type ${typeId}` : "entry"}.`;
  }
  if (code === "INVALID_LEVEL") return `Skipped row ${row || "?"} because its target level is invalid.`;
  if (code === "MISSING_SKILL") return `Skipped row ${row || "?"} because it does not identify a skill.`;
  if (code === "UNPARSED_TEXT_LINE") return `Skipped line ${row || "?"} because it could not be parsed.`;
  if (code === "DUPLICATE_DESIRED_SKILL") {
    return `Combined a duplicate target for skill type ${integerValue(first(source, ["skillTypeId", "skill_type_id"]))}.`;
  }
  if (code) return code.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()) + ".";
  return null;
}

function warningList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : arrayValue(value);
  return [...new Set(items.map(warningMessage).filter((warning): warning is string => Boolean(warning)))];
}

function numericValue(value: unknown, fallback: number | null = null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function integerValue(value: unknown, fallback = 0): number {
  const result = numericValue(value);
  return result === null ? fallback : Math.trunc(result);
}

function booleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function dateString(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const source = record(value);
  const candidate = first(source, ["items", "rows", "results", "data"]);
  return Array.isArray(candidate) ? candidate : [];
}

function listFrom(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const source = record(payload);
  for (const key of keys) {
    const value = source[key];
    const list = arrayValue(value);
    if (Array.isArray(value) || list.length > 0) return list;
  }
  const data = source.data;
  if (data !== undefined && data !== payload) return listFrom(data, keys);
  return [];
}

function objectFrom(payload: unknown, keys: string[]): JsonRecord {
  const source = record(payload);
  for (const key of keys) {
    const candidate = record(source[key]);
    if (Object.keys(candidate).length > 0) return candidate;
  }
  const data = record(source.data);
  return Object.keys(data).length > 0 ? data : source;
}

function statusHealth(value: unknown): QueueHealth | null {
  const normalized = stringValue(value).toLowerCase();
  if (["healthy", "ok", "active", "good"].includes(normalized)) return "healthy";
  if (["warning", "warn", "low"].includes(normalized)) return "warning";
  if (["critical", "urgent"].includes(normalized)) return "critical";
  if (["gap", "scheduled", "scheduled_gap"].includes(normalized)) return "gap";
  if (["paused", "pause"].includes(normalized)) return "paused";
  if (["empty", "idle", "stopped", "none"].includes(normalized)) return "empty";
  if (["error", "failed", "revoked", "invalid"].includes(normalized)) return "error";
  return null;
}

function deriveHealth(source: JsonRecord, queueEndAt: string | null, current: TrainingItem | null): QueueHealth {
  const explicit = statusHealth(first(source, ["queueHealth", "queue_health", "health", "queueStatus"]));
  if (explicit) return explicit;
  const error = nullableString(first(source, ["error", "lastError", "last_error"]));
  if (error) return "error";
  if (!queueEndAt && !current) return "empty";
  const endMs = queueEndAt ? new Date(queueEndAt).getTime() : Number.NaN;
  if (!Number.isFinite(endMs)) return current ? "healthy" : "empty";
  const remaining = endMs - Date.now();
  if (remaining <= 0) return "empty";
  if (remaining <= 24 * 60 * 60 * 1000) return "critical";
  if (remaining <= 72 * 60 * 60 * 1000) return "warning";
  return "healthy";
}

export function normalizeTrainingItem(value: unknown, fallbackPosition = 0): TrainingItem {
  const source = record(value);
  const skill = nested(source, ["skill", "type"]);
  const skillTypeId = numericValue(first(source, ["skillTypeId", "skill_type_id", "typeId", "type_id", "skillId", "skill_id"]))
    ?? numericValue(first(skill, ["id", "typeId", "type_id"]));
  const skillName = stringValue(first(source, ["skillName", "skill_name", "name"]))
    || stringValue(first(skill, ["name", "skillName"]), "Unknown skill");
  const position = integerValue(first(source, ["queuePosition", "queue_position", "position", "index"]), fallbackPosition);
  return {
    id: stringValue(first(source, ["id", "queueId", "queue_id"]), `${skillTypeId ?? "skill"}-${position}`),
    skillTypeId,
    skillName,
    targetLevel: numericValue(first(source, ["targetLevel", "target_level", "finishedLevel", "finished_level", "level"])),
    startAt: dateString(first(source, ["startAt", "start_at", "startDate", "start_date", "start"])),
    endAt: dateString(first(source, ["endAt", "end_at", "finishDate", "finish_date", "endDate", "end_date", "end"])),
    startSp: numericValue(first(source, ["startSp", "start_sp", "levelStartSp", "level_start_sp"])),
    endSp: numericValue(first(source, ["endSp", "end_sp", "levelEndSp", "level_end_sp"])),
    completedSp: numericValue(first(source, ["completedSp", "completed_sp", "currentSp", "current_sp", "trainingStartSp"])),
    queuePosition: position,
    planState: nullableString(first(source, ["planState", "plan_state", "status"])),
  };
}

export function normalizeCharacter(value: unknown): TriffMonCharacter {
  const source = record(value);
  const identity = nested(source, ["character", "identity"]);
  const trainingSource = first(source, ["currentTraining", "current_training", "currentSkill", "current_skill", "training"]);
  const currentTraining = trainingSource ? normalizeTrainingItem(trainingSource) : null;
  const nextTrainingSource = first(source, ["nextTraining", "next_training", "scheduledTraining", "scheduled_training"]);
  const nextTraining = nextTrainingSource ? normalizeTrainingItem(nextTrainingSource) : null;
  const characterId = numericValue(first(source, ["characterId", "character_id", "eveCharacterId", "eve_character_id"]))
    ?? numericValue(first(identity, ["characterId", "character_id", "id"]));
  const id = stringValue(first(source, ["id", "profileId", "profile_id"]), String(characterId ?? ""));
  const queueEndAt = dateString(first(source, ["queueEndAt", "queue_end_at", "queueEnd", "queue_end", "queueFinishDate"]));
  const preferences = nested(source, ["preferences", "preference"]);
  const token = nested(source, ["token", "authorization"]);
  const corporation = first(source, ["corporationName", "corporation_name", "corporation"]);
  const alliance = first(source, ["allianceName", "alliance_name", "alliance"]);
  const corporationRecord = record(corporation);
  const allianceRecord = record(alliance);
  const result: TriffMonCharacter = {
    id: id || String(characterId ?? "unknown"),
    characterId,
    name: stringValue(first(source, ["name", "characterName", "character_name"]))
      || stringValue(first(identity, ["name", "characterName"]), "Unknown character"),
    portraitUrl: nullableString(first(source, ["portraitUrl", "portrait_url", "portrait"]))
      ?? nullableString(first(identity, ["portraitUrl", "portrait_url", "portrait"])),
    corporationName: nullableString(corporation) ?? nullableString(first(corporationRecord, ["name", "corporationName"])),
    allianceName: nullableString(alliance) ?? nullableString(first(allianceRecord, ["name", "allianceName"])),
    totalSp: numericValue(first(source, ["totalSp", "totalSP", "total_sp", "skillpoints", "skillPoints"])),
    unallocatedSp: numericValue(first(source, ["unallocatedSp", "unallocatedSP", "unallocated_sp"])),
    walletBalance: numericValue(first(source, ["walletBalance", "wallet_balance", "wallet", "balance"])),
    cloneState: nullableString(first(source, ["cloneState", "clone_state", "accountState", "account_state", "omegaState"])),
    currentTraining,
    nextTraining,
    queueState: stringValue(first(source, ["queueState", "queue_state"]), currentTraining ? "active" : nextTraining ? "gap" : "empty"),
    queueEndAt: queueEndAt ?? currentTraining?.endAt ?? null,
    queueDurationSeconds: numericValue(first(source, ["queueDurationSeconds", "queue_duration_seconds", "queueSeconds", "queue_seconds"])),
    queueHealth: "empty",
    queueLength: integerValue(first(source, ["queueLength", "queue_length", "queuedSkills", "queued_skills"]), currentTraining ? 1 : 0),
    tokenStatus: stringValue(first(source, ["tokenStatus", "token_status", "monitorStatus", "monitor_status"]), stringValue(first(token, ["status", "state"]), "unknown")),
    missingScopes: listFrom(source, ["missingScopes", "missing_scopes", "monitorMissingScopes", "monitor_missing_scopes"])
      .map((scope) => stringValue(scope)).filter(Boolean),
    lastUpdatedAt: dateString(first(source, ["lastUpdatedAt", "last_updated_at", "syncedAt", "synced_at", "updatedAt", "updated_at", "fetchedAt"])),
    stale: booleanValue(first(source, ["stale", "isStale", "is_stale"])),
    error: nullableString(first(source, ["error", "lastError", "last_error"])),
    pinned: booleanValue(first(source, ["pinned", "favorite", "isFavorite", "is_favorite"]), booleanValue(first(preferences, ["pinned", "favorite"]))),
    hidden: booleanValue(first(source, ["hidden", "isHidden", "is_hidden"]), booleanValue(first(preferences, ["hidden"]))),
    group: nullableString(first(source, ["group", "customGroup", "custom_group"])) ?? nullableString(first(preferences, ["group", "customGroup"])),
  };
  result.queueHealth = deriveHealth(source, result.queueEndAt, result.currentTraining);
  return result;
}

function normalizePrerequisite(value: unknown): SkillPrerequisite {
  const source = record(value);
  const skill = nested(source, ["skill", "type"]);
  const requiredLevel = integerValue(first(source, ["requiredLevel", "required_level", "level"]), 1);
  const currentLevel = integerValue(first(source, ["currentLevel", "current_level", "trainedLevel", "trained_level"]));
  return {
    skillTypeId: numericValue(first(source, ["skillTypeId", "skill_type_id", "typeId", "type_id", "id"]))
      ?? numericValue(first(skill, ["id", "typeId", "type_id"])),
    skillName: stringValue(first(source, ["skillName", "skill_name", "name"]))
      || stringValue(first(skill, ["name", "skillName"]), "Unknown skill"),
    requiredLevel,
    currentLevel,
    missing: booleanValue(first(source, ["missing", "isMissing", "is_missing"]), currentLevel < requiredLevel),
  };
}

function normalizeSkill(value: unknown): CharacterSkill {
  const source = record(value);
  const type = nested(source, ["skill", "type"]);
  const rawPrerequisites = listFrom(source, ["prerequisites", "requiredSkills", "required_skills"]);
  const prerequisites = rawPrerequisites.map(normalizePrerequisite);
  const missing = listFrom(source, ["missingPrerequisites", "missing_prerequisites"]);
  const trainedLevelValue = first(source, ["level", "trainedLevel", "trained_level", "trained_skill_level"]);
  const activeLevelValue = first(source, ["activeLevel", "active_level", "activeSkillLevel", "active_skill_level"]);
  const level = Math.max(0, Math.min(5, integerValue(trainedLevelValue, integerValue(activeLevelValue))));
  const activeLevel = Math.max(0, Math.min(5, integerValue(activeLevelValue, level)));
  const skillTypeId = integerValue(first(source, ["skillTypeId", "skill_type_id", "typeId", "type_id", "skillId", "skill_id", "id"]), integerValue(first(type, ["id", "typeId", "type_id"])));
  const skillpoints = integerValue(first(source, ["skillpoints", "skillPoints", "skill_points", "sp"]));
  return {
    skillTypeId,
    skillName: stringValue(first(source, ["skillName", "skill_name", "name"])) || stringValue(first(type, ["name", "skillName"]), "Unknown skill"),
    groupId: numericValue(first(source, ["groupId", "group_id"])),
    groupName: stringValue(first(source, ["groupName", "group_name", "group"]), "Other"),
    level,
    activeLevel,
    skillpoints,
    rank: numericValue(first(source, ["rank", "trainingMultiplier", "training_multiplier", "timeConstant", "time_constant"])),
    primaryAttribute: nullableString(first(source, ["primaryAttribute", "primary_attribute", "primary"])),
    secondaryAttribute: nullableString(first(source, ["secondaryAttribute", "secondary_attribute", "secondary"])),
    prerequisites,
    missingPrerequisites: missing.length > 0 ? missing.map(normalizePrerequisite) : prerequisites.filter((item) => item.missing),
    spToNextLevel: numericValue(first(source, ["spToNextLevel", "sp_to_next_level", "skillpointsToNextLevel"])),
    spToLevelFive: numericValue(first(source, ["spToLevelFive", "sp_to_level_five", "skillpointsToLevelFive"])),
    secondsToNextLevel: numericValue(first(source, ["secondsToNextLevel", "seconds_to_next_level", "trainingSecondsToNextLevel"])),
    secondsToLevelFive: numericValue(first(source, ["secondsToLevelFive", "seconds_to_level_five", "trainingSecondsToLevelFive"])),
    partiallyTrained: booleanValue(first(source, ["partiallyTrained", "partially_trained", "partial"]), level < 5 && skillpoints > 0),
    currentlyTraining: booleanValue(first(source, ["currentlyTraining", "currently_training", "training"])),
    queued: booleanValue(first(source, ["queued", "isQueued", "is_queued"])),
  };
}

function normalizeAttribute(value: unknown, key?: string): CharacterAttribute | null {
  if (typeof value === "number" && key) return { name: key, value };
  const source = record(value);
  const name = stringValue(first(source, ["name", "attribute", "key"]), key ?? "");
  const amount = numericValue(first(source, ["value", "amount", "points"]));
  return name && amount !== null ? { name, value: amount } : null;
}

function normalizeImplant(value: unknown): CharacterImplant {
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
    const typeId = Number(value);
    return { typeId, name: `Type ${typeId}`, slot: null, bonus: null };
  }
  const source = record(value);
  return {
    typeId: numericValue(first(source, ["typeId", "type_id", "id"])),
    name: stringValue(first(source, ["name", "typeName", "type_name"]), "Unknown implant"),
    slot: numericValue(first(source, ["slot", "implantSlot", "implant_slot"])),
    bonus: nullableString(first(source, ["bonus", "description", "effect"])),
  };
}

function normalizeDataStatus(value: unknown, freshnessValue: unknown, missingScope: boolean): CharacterSnapshot["implantStatus"] {
  const source = record(value);
  const freshness = record(freshnessValue);
  return {
    available: booleanValue(first(source, ["available", "hasData", "has_data"]), booleanValue(first(freshness, ["available"]))),
    missingScope: booleanValue(first(source, ["missingScope", "missing_scope"]), missingScope),
    fetchedAt: dateString(first(source, ["fetchedAt", "fetched_at"]))
      ?? dateString(first(freshness, ["fetchedAt", "fetched_at"])),
    stale: booleanValue(first(source, ["stale", "isStale", "is_stale"]), booleanValue(first(freshness, ["isStale", "is_stale", "stale"]))),
    error: nullableString(first(source, ["error", "lastError", "last_error"]))
      ?? nullableString(first(freshness, ["lastError", "last_error", "error"])),
  };
}

export function normalizeSnapshot(payload: unknown, characterId: string): CharacterSnapshot {
  const source = objectFrom(payload, ["snapshot"]);
  const data = nested(source, ["data", "snapshotData", "snapshot_data"]);
  const snapshotData = Object.keys(data).length > 0 ? data : source;
  const skillsPayload = first(snapshotData, ["skills", "characterSkills", "character_skills"]);
  const skillsSource = record(skillsPayload);
  const rawAttributes = first(snapshotData, ["attributes", "characterAttributes", "character_attributes"]);
  const attributeRecord = record(rawAttributes);
  const attributes = Array.isArray(rawAttributes)
    ? rawAttributes.map((value) => normalizeAttribute(value)).filter((value): value is CharacterAttribute => value !== null)
    : Object.entries(attributeRecord).map(([key, value]) => normalizeAttribute(value, key)).filter((value): value is CharacterAttribute => value !== null);
  const rawCharacter = record(first(source, ["character", "summary"]));
  const publicProfile = record(first(snapshotData, ["publicProfile", "public_profile", "profile"]));
  const queue = listFrom(snapshotData, ["queue", "skillQueue", "skill_queue", "trainingQueue"]).map((value, index) => normalizeTrainingItem(value, index));
  const snapshotNow = Date.now();
  const activeQueueItem = queue.find((item) => {
    const start = item.startAt ? new Date(item.startAt).getTime() : Number.NaN;
    const end = item.endAt ? new Date(item.endAt).getTime() : Number.NaN;
    return Number.isFinite(start) && start <= snapshotNow && Number.isFinite(end) && end > snapshotNow;
  }) ?? null;
  const nextQueueItem = queue.find((item) => {
    const start = item.startAt ? new Date(item.startAt).getTime() : Number.NaN;
    const end = item.endAt ? new Date(item.endAt).getTime() : Number.NaN;
    return Number.isFinite(start) && start > snapshotNow && Number.isFinite(end) && end > snapshotNow;
  }) ?? null;
  const queueEndAt = queue.reduce<string | null>((latest, item) => {
    if (!item.endAt) return latest;
    if (!latest) return item.endAt;
    return new Date(item.endAt).getTime() > new Date(latest).getTime() ? item.endAt : latest;
  }, null);
  const walletPayload = first(snapshotData, ["wallet", "walletBalance", "wallet_balance"]);
  const walletRecord = record(walletPayload);
  const combinedCharacter: JsonRecord = {
    ...rawCharacter,
    ...publicProfile,
    id: first(rawCharacter, ["id", "profileId", "profile_id"]) ?? characterId,
    characterId: first(rawCharacter, ["characterId", "character_id"]) ?? first(publicProfile, ["characterId", "character_id", "id"]) ?? characterId,
    totalSp: first(rawCharacter, ["totalSp", "total_sp"]) ?? first(skillsSource, ["totalSp", "total_sp", "totalSP"]),
    unallocatedSp: first(rawCharacter, ["unallocatedSp", "unallocated_sp"]) ?? first(skillsSource, ["unallocatedSp", "unallocated_sp"]),
    walletBalance: first(rawCharacter, ["walletBalance", "wallet_balance"]) ?? numericValue(walletPayload) ?? first(walletRecord, ["balance", "walletBalance", "wallet_balance"]),
    currentTraining: first(rawCharacter, ["currentTraining", "current_training"]) ?? activeQueueItem,
    nextTraining: first(rawCharacter, ["nextTraining", "next_training"]) ?? nextQueueItem,
    queueState: first(rawCharacter, ["queueState", "queue_state"]) ?? (activeQueueItem ? "active" : nextQueueItem ? "gap" : queue.length ? "paused" : "empty"),
    queueEndAt: first(rawCharacter, ["queueEndAt", "queue_end_at"]) ?? queueEndAt,
    queueLength: first(rawCharacter, ["queueLength", "queue_length"]) ?? queue.length,
    tokenStatus: first(rawCharacter, ["tokenStatus", "token_status"]) ?? (booleanValue(first(source, ["reauthRequired", "reauth_required"])) ? "reauthorize" : undefined),
  };
  const freshness = record(first(source, ["freshness"]));
  const freshnessRows = Object.values(freshness).map(record);
  const fetchedAt = dateString(first(source, ["fetchedAt", "fetched_at", "syncedAt", "synced_at", "updatedAt", "updated_at"]))
    ?? freshnessRows.map((item) => dateString(first(item, ["fetchedAt", "fetched_at"]))).filter((value): value is string => value !== null).sort().at(-1)
    ?? null;
  const freshnessError = freshnessRows.map((item) => nullableString(first(item, ["lastError", "last_error", "error"]))).find((value): value is string => value !== null) ?? null;
  const isStale = booleanValue(first(source, ["stale", "isStale", "is_stale"]), freshnessRows.some((item) => booleanValue(first(item, ["isStale", "is_stale", "stale"]))));
  const normalizedCharacter = Object.keys(combinedCharacter).length > 0 ? normalizeCharacter(combinedCharacter) : null;
  const implantFreshness = record(first(freshness, ["implants"]));
  const missingImplantScope = normalizedCharacter?.missingScopes.includes("esi-clones.read_implants.v1") ?? false;
  const clonesSource = record(first(snapshotData, ["clones", "cloneData", "clone_data"]));
  const activeCloneSource = record(first(clonesSource, ["activeClone", "active_clone"]));
  const activeCloneImplants = listFrom(activeCloneSource, ["implants", "items"]).map(normalizeImplant);
  const jumpClones = listFrom(clonesSource, ["jumpClones", "jump_clones", "items"]).map((value) => {
    const clone = record(value);
    const implants = listFrom(clone, ["implants", "items"]).map(normalizeImplant);
    const locationType = stringValue(first(clone, ["locationType", "location_type"])).toLowerCase();
    return {
      jumpCloneId: integerValue(first(clone, ["jumpCloneId", "jump_clone_id", "id"])),
      name: nullableString(first(clone, ["name", "cloneName", "clone_name"])),
      locationId: integerValue(first(clone, ["locationId", "location_id"])),
      locationType: locationType === "station" || locationType === "structure" ? locationType : null,
      implants,
      implantCount: integerValue(first(clone, ["implantCount", "implant_count"]), implants.length),
    };
  }).filter((clone) => clone.jumpCloneId > 0);
  const homeLocationSource = record(first(clonesSource, ["homeLocation", "home_location"]));
  const homeLocationId = integerValue(first(homeLocationSource, ["locationId", "location_id"]));
  const homeLocationType = stringValue(first(homeLocationSource, ["locationType", "location_type"])).toLowerCase();
  const missingCloneScope = normalizedCharacter?.missingScopes.includes("esi-clones.read_clones.v1") ?? false;
  return {
    characterId,
    character: normalizedCharacter,
    skills: listFrom(skillsPayload, ["skills", "items", "rows"]).map(normalizeSkill),
    queue,
    attributes,
    implants: listFrom(snapshotData, ["implants", "characterImplants", "character_implants"]).map(normalizeImplant),
    implantStatus: normalizeDataStatus(first(source, ["implantStatus", "implant_status"]), implantFreshness, missingImplantScope),
    clones: {
      activeClone: {
        implants: activeCloneImplants,
        implantCount: integerValue(first(activeCloneSource, ["implantCount", "implant_count"]), activeCloneImplants.length),
      },
      jumpClones,
      homeLocation: homeLocationId > 0 ? {
        locationId: homeLocationId,
        locationType: homeLocationType === "station" || homeLocationType === "structure" ? homeLocationType : null,
      } : null,
      lastCloneJumpDate: dateString(first(clonesSource, ["lastCloneJumpDate", "last_clone_jump_date"])),
      lastStationChangeDate: dateString(first(clonesSource, ["lastStationChangeDate", "last_station_change_date"])),
    },
    cloneStatus: normalizeDataStatus(first(source, ["cloneStatus", "clone_status"]), first(freshness, ["clones"]), missingCloneScope),
    temporaryAttributeBonus: numericValue(first(source, ["temporaryAttributeBonus", "temporary_attribute_bonus", "boosterBonus", "booster_bonus"])),
    attributeEstimateWarning: nullableString(first(source, ["attributeEstimateWarning", "attribute_estimate_warning", "optimizerWarning", "optimizer_warning"])),
    fetchedAt,
    stale: isStale,
    error: nullableString(first(source, ["error", "lastError", "last_error"])) ?? freshnessError,
  };
}

function normalizeCatalogSkill(value: unknown): CatalogSkill {
  const skill = normalizeSkill(value);
  return {
    skillTypeId: skill.skillTypeId,
    skillName: skill.skillName,
    groupId: skill.groupId,
    groupName: skill.groupName,
    rank: skill.rank,
    primaryAttribute: skill.primaryAttribute,
    secondaryAttribute: skill.secondaryAttribute,
    prerequisites: skill.prerequisites,
  };
}

function normalizeRequirementTarget(value: unknown): RequirementTarget {
  const source = record(value);
  return {
    typeId: integerValue(first(source, ["typeId", "type_id", "id"])),
    name: stringValue(first(source, ["name", "typeName", "type_name"]), "Unknown type"),
    groupName: nullableString(first(source, ["groupName", "group_name", "group"])),
    categoryName: nullableString(first(source, ["categoryName", "category_name", "category"])),
    iconUrl: nullableString(first(source, ["iconUrl", "icon_url", "icon"])),
  };
}

export function normalizeCatalog(payload: unknown): TriffMonCatalog {
  const source = objectFrom(payload, ["catalog"]);
  const skills = listFrom(source, ["skills", "items"]).map(normalizeCatalogSkill).filter((skill) => skill.skillTypeId > 0);
  const rawGroups = listFrom(source, ["skillGroups", "skill_groups", "groups"]);
  const groupMap = new Map<string, { id: number | null; name: string }>();
  rawGroups.forEach((value) => {
    const item = record(value);
    const name = stringValue(first(item, ["name", "groupName", "group_name"]));
    if (name) groupMap.set(name, { id: numericValue(first(item, ["id", "groupId", "group_id"])), name });
  });
  skills.forEach((skill) => {
    if (!groupMap.has(skill.groupName)) groupMap.set(skill.groupName, { id: skill.groupId, name: skill.groupName });
  });
  const targets = listFrom(source, ["requirementTargets", "requirement_targets", "types", "ships"])
    .map(normalizeRequirementTarget)
    .filter((target) => target.typeId > 0);
  return { skills, skillGroups: [...groupMap.values()].sort((a, b) => a.name.localeCompare(b.name)), requirementTargets: targets };
}

function normalizePlanEntry(value: unknown, fallbackPosition = 0): SkillPlanEntry {
  const source = record(value);
  const skill = nested(source, ["skill", "type"]);
  const skillTypeId = integerValue(first(source, ["skillTypeId", "skill_type_id", "typeId", "type_id"]), integerValue(first(skill, ["id", "typeId", "type_id"])));
  const position = integerValue(first(source, ["position", "sortOrder", "sort_order", "index"]), fallbackPosition);
  const remainingSp = numericValue(first(source, ["remainingSp", "remaining_sp", "missingSp", "missing_sp"]));
  return {
    id: stringValue(first(source, ["id", "entryId", "entry_id"]), `${skillTypeId}-${position}`),
    skillTypeId,
    skillName: stringValue(first(source, ["skillName", "skill_name", "name"])) || stringValue(first(skill, ["name", "skillName"]), "Unknown skill"),
    targetLevel: integerValue(first(source, ["targetLevel", "target_level", "level"]), 1),
    position,
    sectionId: nullableString(first(source, ["sectionId", "section_id"])),
    section: nullableString(first(source, ["section", "sectionName", "section_name", "group"])),
    notes: nullableString(first(source, ["notes", "note"])),
    autoAdded: booleanValue(first(source, ["autoAdded", "auto_added", "prerequisite", "isPrerequisite"])),
    sourceType: nullableString(first(source, ["sourceType", "source_type"])),
    sourceMetadata: record(first(source, ["sourceMetadata", "source_metadata"])),
    currentLevel: numericValue(first(source, ["currentLevel", "current_level", "trainedLevel", "trained_level"])),
    activeLevel: numericValue(first(source, ["activeLevel", "active_level"])),
    currentSp: numericValue(first(source, ["currentSp", "current_sp", "skillpoints"])),
    targetSp: numericValue(first(source, ["targetSp", "target_sp"])),
    remainingSp,
    trainingSeconds: numericValue(first(source, ["trainingSeconds", "training_seconds", "durationSeconds", "duration_seconds"])),
    alreadyTrained: booleanValue(first(source, ["alreadyTrained", "already_trained"]), remainingSp === 0),
    partiallyTrained: booleanValue(first(source, ["partiallyTrained", "partially_trained"])),
  };
}

function normalizePlanSection(value: unknown, fallbackPosition = 0): SkillPlanSection {
  const source = record(value);
  const remap = first(source, ["remapAttributes", "remap_attributes"]);
  return {
    id: stringValue(first(source, ["id", "sectionId", "section_id"])),
    title: stringValue(first(source, ["title", "name", "section"]), "Training plan"),
    position: integerValue(first(source, ["position", "sortOrder", "sort_order"]), fallbackPosition),
    notes: nullableString(first(source, ["notes", "note"])),
    remapAttributes: remap === null || remap === undefined ? null : record(remap),
    settings: record(first(source, ["settings"])),
  };
}

export function normalizePlan(value: unknown): SkillPlan {
  const source = objectFrom(value, ["plan", "item", "result"]);
  const character = nested(source, ["character"]);
  const sourceMetadata = record(first(source, ["sourceMetadata", "source_metadata"]));
  return {
    id: stringValue(first(source, ["id", "planId", "plan_id"])),
    name: stringValue(first(source, ["name", "title"]), "Untitled plan"),
    characterId: nullableString(first(source, ["characterId", "character_id"])) ?? nullableString(first(character, ["id", "characterId"])),
    characterName: nullableString(first(source, ["characterName", "character_name"])) ?? nullableString(first(character, ["name", "characterName"])),
    notes: nullableString(first(source, ["notes", "description"])),
    sections: listFrom(source, ["sections", "planSections", "plan_sections"]).map(normalizePlanSection).sort((a, b) => a.position - b.position),
    entries: listFrom(source, ["entries", "skills", "items"]).map(normalizePlanEntry).sort((a, b) => a.position - b.position),
    totalSp: numericValue(first(source, ["totalSp", "total_sp"])),
    remainingSp: numericValue(first(source, ["remainingSp", "remaining_sp"])),
    trainingSeconds: numericValue(first(source, ["trainingSeconds", "training_seconds", "durationSeconds", "duration_seconds"])),
    completionAt: dateString(first(source, ["completionAt", "completion_at", "projectedCompletionAt", "projected_completion_at"])),
    settings: record(first(source, ["settings"])),
    sourceType: nullableString(first(source, ["sourceType", "source_type"])),
    sourceMetadata,
    lockVersion: Math.max(1, integerValue(first(source, ["lockVersion", "lock_version"]), 1)),
    importWarnings: [...new Set([
      ...warningList(first(source, ["importWarnings", "import_warnings", "warnings"])),
      ...warningList(first(sourceMetadata, ["warnings", "importWarnings", "import_warnings"])),
    ])],
    createdAt: dateString(first(source, ["createdAt", "created_at"])),
    updatedAt: dateString(first(source, ["updatedAt", "updated_at"])),
  };
}

function normalizePlanQueuePair(value: unknown, fallbackOrder = 0): PlanQueuePair {
  const source = record(value);
  return {
    skillTypeId: integerValue(first(source, ["skillTypeId", "skill_type_id", "skillId", "skill_id"])),
    level: integerValue(first(source, ["level", "targetLevel", "target_level", "finishedLevel", "finished_level"])),
    order: integerValue(first(source, ["order", "position", "index"]), fallbackOrder),
    queuePosition: numericValue(first(source, ["queuePosition", "queue_position"])),
    status: nullableString(first(source, ["status", "state"])),
  };
}

function normalizePlanQueueComparison(value: unknown): PlanQueueComparison | null {
  const source = record(value);
  if (Object.keys(source).length === 0) return null;
  const pairs = (keys: string[]) => listFrom(source, keys).map(normalizePlanQueuePair);
  return {
    queued: pairs(["queued", "queue"]),
    planned: pairs(["planned", "plan"]),
    matched: pairs(["matched", "matches"]),
    queuedNotPlanned: pairs(["queuedNotPlanned", "queued_not_planned", "extras"]),
    plannedNotQueued: pairs(["plannedNotQueued", "planned_not_queued", "missing"]),
    inOrderPrefixLength: integerValue(first(source, ["inOrderPrefixLength", "in_order_prefix_length", "prefixLength", "prefix_length"])),
    orderMismatches: listFrom(source, ["orderMismatches", "order_mismatches", "mismatches"]).map((value, index) => {
      const mismatch = record(value);
      const queued = record(first(mismatch, ["queued", "actual"]));
      const planned = record(first(mismatch, ["planned", "expected"]));
      return {
        index: integerValue(first(mismatch, ["index", "position"]), index),
        queued: Object.keys(queued).length ? normalizePlanQueuePair(queued, index) : null,
        planned: Object.keys(planned).length ? normalizePlanQueuePair(planned, index) : null,
      };
    }),
    exactMatch: booleanValue(first(source, ["exactMatch", "exact_match"])),
  };
}

function normalizeAnalysis(payload: unknown): PlanAnalysis {
  const source = objectFrom(payload, ["analysis", "result"]);
  return {
    remainingSp: numericValue(first(source, ["remainingSp", "remaining_sp", "missingSp", "missing_sp"])),
    trainingSeconds: numericValue(first(source, ["trainingSeconds", "training_seconds", "durationSeconds", "duration_seconds"])),
    completionAt: dateString(first(source, ["completionAt", "completion_at", "projectedCompletionAt"])),
    trainedCount: integerValue(first(source, ["trainedCount", "trained_count"])),
    partialCount: integerValue(first(source, ["partialCount", "partial_count"])),
    missingCount: integerValue(first(source, ["missingCount", "missing_count"])),
    warnings: listFrom(source, ["warnings", "errors"]).map((value) => stringValue(typeof value === "string" ? value : first(record(value), ["message", "error"]))).filter(Boolean),
    entries: listFrom(source, ["entries", "skills", "items"]).map(normalizePlanEntry),
    queueComparison: normalizePlanQueueComparison(first(source, ["queueComparison", "queue_comparison"])),
  };
}

function normalizeOptimizationSegment(value: unknown, index: number): PlanOptimizationSegment {
  const source = record(value);
  const attributes = record(first(source, ["attributes", "attributeMap", "attribute_map"]));
  const normalizedAttributes: Record<string, number> = {};
  Object.entries(attributes).forEach(([key, item]) => {
    const amount = numericValue(item);
    if (amount !== null) normalizedAttributes[key] = amount;
  });
  return {
    label: stringValue(first(source, ["label", "name"]), `Segment ${index + 1}`),
    primaryAttribute: nullableString(first(source, ["primaryAttribute", "primary_attribute", "primary"])),
    secondaryAttribute: nullableString(first(source, ["secondaryAttribute", "secondary_attribute", "secondary"])),
    attributes: normalizedAttributes,
    trainingSeconds: numericValue(first(source, ["trainingSeconds", "training_seconds", "durationSeconds"])),
    startsAtEntry: numericValue(first(source, ["startsAtEntry", "starts_at_entry", "entryIndex", "entry_index"])),
  };
}

function normalizeOptimization(payload: unknown): PlanOptimization {
  const source = objectFrom(payload, ["optimization", "result"]);
  const attributes = record(first(source, ["attributes", "optimalAttributes", "optimal_attributes"]));
  const normalizedAttributes: Record<string, number> = {};
  Object.entries(attributes).forEach(([key, value]) => {
    const amount = numericValue(value);
    if (amount !== null) normalizedAttributes[key] = amount;
  });
  return {
    currentSeconds: numericValue(first(source, ["currentSeconds", "current_seconds", "currentTrainingSeconds"])),
    optimizedSeconds: numericValue(first(source, ["optimizedSeconds", "optimized_seconds", "optimizedTrainingSeconds"])),
    secondsSaved: numericValue(first(source, ["secondsSaved", "seconds_saved", "timeSavedSeconds"])),
    attributes: normalizedAttributes,
    segments: listFrom(source, ["segments", "remaps"]).map(normalizeOptimizationSegment),
    warnings: listFrom(source, ["warnings", "errors"]).map((value) => stringValue(typeof value === "string" ? value : first(record(value), ["message", "error"]))).filter(Boolean),
  };
}

function normalizeRequirementSkill(value: unknown): RequirementSkill {
  const source = record(value);
  const requiredLevel = integerValue(first(source, ["requiredLevel", "required_level", "targetLevel", "target_level"]), 1);
  const currentLevel = integerValue(first(source, ["currentLevel", "current_level", "trainedLevel", "trained_level"]));
  const trainedLevel = integerValue(first(source, ["trainedLevel", "trained_level"]), currentLevel);
  const activeLevel = integerValue(first(source, ["activeLevel", "active_level"]), currentLevel);
  return {
    skillTypeId: integerValue(first(source, ["skillTypeId", "skill_type_id", "typeId", "type_id", "id"])),
    skillName: stringValue(first(source, ["skillName", "skill_name", "name"]), "Unknown skill"),
    requiredLevel,
    currentLevel,
    trainedLevel,
    activeLevel,
    inactiveDueToCloneState: booleanValue(first(source, ["inactiveDueToCloneState", "inactive_due_to_clone_state"]), trainedLevel >= requiredLevel && activeLevel < requiredLevel),
    missingLevels: integerValue(first(source, ["missingLevels", "missing_levels"]), Math.max(0, requiredLevel - currentLevel)),
    missingSp: numericValue(first(source, ["missingSp", "missing_sp", "remainingSp", "remaining_sp"])),
    trainingSeconds: numericValue(first(source, ["trainingSeconds", "training_seconds", "durationSeconds"])),
    prerequisites: listFrom(source, ["prerequisites", "requiredSkills", "required_skills"]).map(normalizePrerequisite),
  };
}

function normalizeCharacterRequirement(value: unknown): CharacterRequirementResult {
  const source = record(value);
  const character = nested(source, ["character"]);
  const missingSkills = listFrom(source, ["missingSkills", "missing_skills", "requirements"]).map(normalizeRequirementSkill);
  return {
    characterId: stringValue(first(source, ["characterId", "character_id", "id"]), stringValue(first(character, ["id", "characterId"]))),
    characterName: stringValue(first(source, ["characterName", "character_name", "name"]), stringValue(first(character, ["name"]), "Unknown character")),
    portraitUrl: nullableString(first(source, ["portraitUrl", "portrait_url", "portrait"])) ?? nullableString(first(character, ["portraitUrl", "portrait_url"])),
    canUse: booleanValue(first(source, ["canUse", "can_use", "ready"]), missingSkills.length === 0),
    inactiveDueToCloneState: booleanValue(first(source, ["inactiveDueToCloneState", "inactive_due_to_clone_state"]), missingSkills.some((skill) => skill.inactiveDueToCloneState)),
    missingSp: numericValue(first(source, ["missingSp", "missing_sp", "remainingSp", "remaining_sp"])),
    trainingSeconds: numericValue(first(source, ["trainingSeconds", "training_seconds", "durationSeconds"])),
    missingSkills,
  };
}

function normalizeRequirements(payload: unknown): RequirementAnalysis {
  const source = objectFrom(payload, ["analysis", "requirements", "result"]);
  const type = nested(source, ["type", "target"]);
  const characters = listFrom(source, ["characters", "items", "results"]).map(normalizeCharacterRequirement);
  const selectedCount = integerValue(first(source, ["selectedCount", "selected_count", "totalCharacters"]), characters.length);
  const readyCount = integerValue(first(source, ["readyCount", "ready_count", "canUseCount", "can_use_count"]), characters.filter((item) => item.canUse).length);
  const oneDay = 24 * 60 * 60;
  const sevenDays = 7 * oneDay;
  const trainableCharacters = characters.filter((item) => !item.inactiveDueToCloneState);
  return {
    typeId: integerValue(first(source, ["typeId", "type_id"]), integerValue(first(type, ["id", "typeId", "type_id"]))),
    typeName: stringValue(first(source, ["typeName", "type_name", "name"]), stringValue(first(type, ["name", "typeName"]), "Selected type")),
    iconUrl: nullableString(first(source, ["iconUrl", "icon_url", "icon"])) ?? nullableString(first(type, ["iconUrl", "icon_url", "icon"])),
    selectedCount,
    readyCount,
    underOneDayCount: integerValue(first(source, ["underOneDayCount", "under_one_day_count"]), trainableCharacters.filter((item) => !item.canUse && item.trainingSeconds !== null && item.trainingSeconds < oneDay).length),
    overSevenDaysCount: integerValue(first(source, ["overSevenDaysCount", "over_seven_days_count"]), trainableCharacters.filter((item) => !item.canUse && item.trainingSeconds !== null && item.trainingSeconds > sevenDays).length),
    inactiveCloneCount: integerValue(first(source, ["inactiveCloneCount", "inactive_clone_count"]), characters.filter((item) => item.inactiveDueToCloneState).length),
    characters,
    warnings: listFrom(source, ["warnings", "errors"]).map((value) => stringValue(typeof value === "string" ? value : first(record(value), ["message", "error"]))).filter(Boolean),
  };
}

function messageFromPayload(payload: unknown, fallback: string): string {
  const source = record(payload);
  return stringValue(first(source, ["message", "error", "detail"]), fallback);
}

async function request(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers,
    signal,
  });
  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown = null;
  if (response.status !== 204) {
    payload = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text().catch(() => "");
  }
  if (!response.ok) throw new TriffMonApiError(messageFromPayload(payload, `Request failed (${response.status})`), response.status);
  return payload;
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

export async function getCharacters(signal?: AbortSignal): Promise<TriffMonCharacter[]> {
  const payload = await request(`${API_ROOT}/characters`, {}, signal);
  return listFrom(payload, ["characters", "items", "profiles"]).map(normalizeCharacter);
}

export async function getCatalog(signal?: AbortSignal): Promise<TriffMonCatalog> {
  return normalizeCatalog(await request(`${API_ROOT}/catalog`, {}, signal));
}

export async function getCharacterSnapshot(characterId: string, signal?: AbortSignal): Promise<CharacterSnapshot> {
  return normalizeSnapshot(await request(`${API_ROOT}/characters/${encodeURIComponent(characterId)}/snapshot`, {}, signal), characterId);
}

export async function syncCharacter(characterId: string): Promise<CharacterSnapshot> {
  return normalizeSnapshot(await request(`${API_ROOT}/characters/${encodeURIComponent(characterId)}/sync`, { method: "POST" }), characterId);
}

export async function updateCharacterPreferences(characterId: string, preferences: Partial<{ pinned: boolean; hidden: boolean; group: string | null }>): Promise<TriffMonCharacter | null> {
  const payload = await request(`${API_ROOT}/characters/${encodeURIComponent(characterId)}/preferences`, { method: "PATCH", body: jsonBody(preferences) });
  const source = objectFrom(payload, ["character", "item"]);
  return Object.keys(source).length > 0 ? normalizeCharacter(source) : null;
}

export async function unlinkCharacter(characterId: string): Promise<void> {
  await request(`${API_ROOT}/characters/${encodeURIComponent(characterId)}`, { method: "DELETE" });
}

export function esiLoginUrl(returnTo: string): string {
  const query = new URLSearchParams({ returnTo });
  return `${API_ROOT}/esi/login?${query.toString()}`;
}

export async function getPlans(signal?: AbortSignal): Promise<SkillPlan[]> {
  const payload = await request(`${API_ROOT}/plans`, {}, signal);
  return listFrom(payload, ["plans", "items"]).map(normalizePlan);
}

export async function createPlan(input: { name: string; characterId?: string | null; notes?: string | null; entries?: SkillPlanEntry[]; sections?: SkillPlanSection[]; settings?: Record<string, unknown>; sourceType?: string | null; sourceMetadata?: Record<string, unknown> }): Promise<SkillPlan> {
  return normalizePlan(await request(`${API_ROOT}/plans`, { method: "POST", body: jsonBody(input) }));
}

export async function getPlan(planId: string, signal?: AbortSignal): Promise<SkillPlan> {
  return normalizePlan(await request(`${API_ROOT}/plans/${encodeURIComponent(planId)}`, {}, signal));
}

export async function patchPlan(planId: string, patch: Partial<Omit<SkillPlan, "lockVersion">> & { lockVersion: number }): Promise<SkillPlan> {
  return normalizePlan(await request(`${API_ROOT}/plans/${encodeURIComponent(planId)}`, { method: "PATCH", body: jsonBody(patch) }));
}

export async function deletePlan(planId: string): Promise<void> {
  await request(`${API_ROOT}/plans/${encodeURIComponent(planId)}`, { method: "DELETE" });
}

export async function addPlanEntry(planId: string, input: { skillTypeId: number; targetLevel: number; addPrerequisites?: boolean; section?: string | null }): Promise<SkillPlan> {
  return normalizePlan(await request(`${API_ROOT}/plans/${encodeURIComponent(planId)}/entries`, { method: "POST", body: jsonBody(input) }));
}

export async function analyzePlan(input: { planId: string; characterId?: string | null }, signal?: AbortSignal): Promise<PlanAnalysis> {
  return normalizeAnalysis(await request(`${API_ROOT}/analyze`, { method: "POST", body: jsonBody(input) }, signal));
}

export async function optimizePlan(input: { planId: string; characterId?: string | null; maxRemaps?: number }): Promise<PlanOptimization> {
  return normalizeOptimization(await request(`${API_ROOT}/optimize`, { method: "POST", body: jsonBody(input) }));
}

export async function importPlan(input: { content: string; filename?: string; characterId?: string | null; format?: string }): Promise<ImportedPlan> {
  const payload = await request(`${API_ROOT}/plans/import`, { method: "POST", body: jsonBody(input) });
  const plan = normalizePlan(payload);
  const response = record(payload);
  const warnings = [...new Set([
    ...plan.importWarnings,
    ...warningList(first(response, ["warnings", "importWarnings", "import_warnings"])),
  ])];
  return { plan, warnings };
}

export async function exportPlan(input: { planId: string; format: string }): Promise<ExportedPlan> {
  const payload = await request(`${API_ROOT}/plans/export`, { method: "POST", body: jsonBody(input) });
  const extension = input.format === "evemon" || input.format === "xml" ? "xml" : input.format;
  if (typeof payload === "string") {
    return { content: payload, filename: `skillnix-plan.${extension}`, mimeType: input.format === "evemon" || input.format === "xml" ? "application/xml" : "text/plain" };
  }
  const source = objectFrom(payload, ["export", "result"]);
  const explicitEncoding = nullableString(first(source, ["encoding", "contentEncoding", "content_encoding"]));
  const hasBase64Field = typeof source.base64 === "string";
  const encoding = explicitEncoding?.toLowerCase() === "base64" || hasBase64Field ? "base64" as const : undefined;
  return {
    content: stringValue(first(source, ["content", "text", "data", "base64"]), JSON.stringify(payload, null, 2)),
    filename: stringValue(first(source, ["filename", "fileName", "name"]), `skillnix-plan.${extension}`),
    mimeType: stringValue(first(source, ["mimeType", "mime_type", "contentType"]), input.format === "json" ? "application/json" : "text/plain"),
    encoding,
  };
}

export async function analyzeRequirements(input: { typeId?: number | null; characterIds: string[]; requiredSkills?: TriffMonRequiredSkillTarget[]; label?: string | null }): Promise<RequirementAnalysis> {
  return normalizeRequirements(await request(`${API_ROOT}/requirements`, { method: "POST", body: jsonBody(input) }));
}
