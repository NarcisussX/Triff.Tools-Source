import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CalendarClock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Unlink,
} from "lucide-react";
import { ToolButton, ToolEmptyState, ToolPanel, ToolStat, ToolStatus, ToolTabs } from "../../components/tool-ui";
import { analyzePlan } from "./api";
import type { CharacterSkill, CharacterSnapshot, PlanAnalysis, PlanQueuePair, SkillPlan, TriffMonCharacter } from "./types";
import { BusyLine, CharacterPortrait, InlineFeedback, LevelPips, ProgressBar, QueueStatus } from "./shared";
import { apiErrorMessage, formatDateTime, formatDuration, formatNumber, freshnessLabel, liveQueueHealth, secondsBetween, secondsUntil, trainingProgress } from "./utils";

type SkillFilter = "all" | "trained" | "partial" | "untrained" | "level5" | "training" | "queued" | "missing";
type SkillSort = "name" | "group" | "level" | "sp" | "next";

type CharacterViewProps = {
  character: TriffMonCharacter | null;
  snapshot: CharacterSnapshot | null;
  plans: SkillPlan[];
  tab: "skills" | "queue";
  now: number;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  onBack: () => void;
  onTab: (tab: "skills" | "queue") => void;
  onSync: () => void;
  onUnlink: () => void;
  onAddSkill: (planId: string, skillTypeId: number, targetLevel: number, addPrerequisites: boolean) => Promise<void>;
};

function skillMatchesFilter(skill: CharacterSkill, filter: SkillFilter): boolean {
  if (filter === "trained") return skill.level > 0;
  if (filter === "partial") return skill.partiallyTrained;
  if (filter === "untrained") return skill.level === 0 && !skill.partiallyTrained;
  if (filter === "level5") return skill.level === 5;
  if (filter === "training") return skill.currentlyTraining;
  if (filter === "queued") return skill.queued;
  if (filter === "missing") return skill.missingPrerequisites.length > 0;
  return true;
}

function CharacterSummary({ character, snapshot, now }: { character: TriffMonCharacter; snapshot: CharacterSnapshot | null; now: number }) {
  const implantEmptyMessage = snapshot?.implantStatus.missingScope
    ? "Implant access is not authorized. Reauthorize this character to grant the implant scope."
    : snapshot?.implantStatus.error
      ? snapshot.implantStatus.available
        ? "No implants in cached data; the latest implant sync failed."
        : "Implant data is unavailable because the latest sync failed."
      : snapshot?.implantStatus.available
        ? "No implants installed in the active clone."
        : "Implant data has not synced yet.";
  const jumpCloneEmptyMessage = snapshot?.cloneStatus.missingScope
    ? "Jump-clone access is not authorized. Reauthorize this character to grant the clone scope."
    : snapshot?.cloneStatus.error
      ? "Jump-clone data is unavailable because the latest sync failed."
      : snapshot?.cloneStatus.available
        ? "No jump clones reported by ESI."
        : "Jump-clone data has not synced yet.";
  return (
    <div className="space-y-2">
      <ToolPanel bodyClassName="space-y-3">
        <div className="flex gap-3 lg:block">
          <CharacterPortrait character={character} size="lg" />
          <div className="min-w-0 lg:mt-2">
            <h2 className="truncate text-sm font-semibold text-slate-100">{character.name}</h2>
            <p className="truncate text-[10px] text-slate-400">{character.corporationName ?? "Corporation unavailable"}</p>
            <p className="truncate text-[9px] text-slate-600">{character.allianceName ?? "No alliance"}</p>
            <div className="mt-2"><QueueStatus health={liveQueueHealth(character, now)} /></div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">
          <ToolStat label="Total SP" value={formatNumber(character.totalSp)} />
          <ToolStat label="Unallocated" value={formatNumber(character.unallocatedSp)} />
        </div>
        <div className="border-t border-[#2a2e36] pt-2 text-[10px] text-slate-500">
          <div className="flex justify-between gap-2"><span>Data age</span><span className={character.stale ? "text-[#e4b44c]" : "text-slate-300"}>{freshnessLabel(snapshot?.fetchedAt ?? character.lastUpdatedAt, now)}</span></div>
          <div className="mt-1 flex justify-between gap-2"><span>Token</span><span className="truncate text-slate-300">{character.tokenStatus}</span></div>
          {character.cloneState ? <div className="mt-1 flex justify-between gap-2"><span>Clone</span><span className="text-slate-300">{character.cloneState}</span></div> : null}
        </div>
      </ToolPanel>

      <ToolPanel title="Attributes" bodyClassName="grid grid-cols-2 gap-1 lg:grid-cols-1">
        {snapshot?.attributes.length ? snapshot.attributes.map((attribute) => (
          <div key={attribute.name} className="flex items-center justify-between border-b border-[#20242b] px-1 py-1 text-[10px]"><span className="capitalize text-slate-500">{attribute.name.replaceAll("_", " ")}</span><span className="font-mono text-slate-200">{attribute.value}</span></div>
        )) : <span className="text-[10px] text-slate-600">No attribute snapshot.</span>}
        {snapshot?.temporaryAttributeBonus ? <div className="col-span-2 border-t border-[#302d20] pt-1 text-[9px] leading-relaxed text-[#e4b44c] lg:col-span-1">Live ESI values include an inferred +{snapshot.temporaryAttributeBonus} temporary accelerator. Training estimates exclude it and use the character&apos;s persistent remap plus active implants.</div> : null}
      </ToolPanel>

      <ToolPanel title="Active clone implants" bodyClassName="space-y-1">
        {snapshot?.implants.length ? snapshot.implants.map((implant, index) => (
          <div key={`${implant.typeId ?? implant.name}-${index}`} className="border-b border-[#20242b] py-1 text-[10px]">
            <div className="flex justify-between gap-2"><span className="truncate text-slate-300">{implant.name}</span>{implant.slot ? <span className="shrink-0 font-mono text-slate-600">Slot {implant.slot}</span> : null}</div>
            {implant.bonus ? <div className="truncate text-[9px] text-slate-600">{implant.bonus}</div> : null}
          </div>
        )) : <span className="text-[10px] text-slate-600">{implantEmptyMessage}</span>}
      </ToolPanel>

      <ToolPanel title="Jump clones" description={snapshot?.clones.jumpClones.length ? `${snapshot.clones.jumpClones.length} stored clones` : undefined} bodyClassName="space-y-1.5">
        {snapshot?.clones.jumpClones.length ? snapshot.clones.jumpClones.map((clone) => (
          <div key={clone.jumpCloneId} className="border border-[#20242b] bg-[#070a0f] p-1.5 text-[10px]">
            <div className="flex items-start justify-between gap-2">
              <span className="truncate font-semibold text-slate-300">{clone.name || `Jump clone ${clone.jumpCloneId}`}</span>
              <span className="shrink-0 font-mono text-[9px] text-slate-600">{clone.locationType ? `${clone.locationType} ` : ""}{clone.locationId}</span>
            </div>
            {clone.implants.length ? (
              <div className="mt-1 space-y-0.5 border-t border-[#20242b] pt-1">
                {clone.implants.map((implant, index) => (
                  <div key={`${clone.jumpCloneId}-${implant.typeId ?? implant.name}-${index}`} className="flex justify-between gap-2 text-[9px]">
                    <span className="truncate text-slate-400">{implant.name}</span>
                    {implant.slot ? <span className="shrink-0 font-mono text-slate-600">Slot {implant.slot}</span> : null}
                  </div>
                ))}
              </div>
            ) : <div className="mt-1 text-[9px] text-slate-600">No implants installed.</div>}
          </div>
        )) : <span className="text-[10px] text-slate-600">{jumpCloneEmptyMessage}</span>}
      </ToolPanel>
    </div>
  );
}

function AddToPlanButton({ plans, selectedPlanId, skill, onAdd }: { plans: SkillPlan[]; selectedPlanId: string; skill: CharacterSkill; onAdd: CharacterViewProps["onAddSkill"] }) {
  const [busy, setBusy] = useState(false);
  const targetLevel = Math.min(5, Math.max(1, skill.level + 1));
  const add = async () => {
    if (!selectedPlanId || busy) return;
    setBusy(true);
    try {
      await onAdd(selectedPlanId, skill.skillTypeId, targetLevel, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" disabled={!plans.length || !selectedPlanId || skill.level >= 5 || busy} onClick={add} className="tt2-touch-target inline-flex h-7 items-center gap-1 border border-[#354254] bg-[#0d131c] px-2 text-[9px] font-semibold uppercase tracking-wider text-slate-400 hover:border-[#5683a4] hover:text-[#8bd3ff] disabled:opacity-35" aria-label={`Add ${skill.skillName} level ${targetLevel} to selected plan`}>
      <Plus className="h-3 w-3" /> L{targetLevel}
    </button>
  );
}

function SkillsView({ snapshot, plans, onAddSkill }: { snapshot: CharacterSnapshot; plans: SkillPlan[]; onAddSkill: CharacterViewProps["onAddSkill"] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SkillFilter>("all");
  const [group, setGroup] = useState("all");
  const [sort, setSort] = useState<SkillSort>("group");
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0]?.id ?? "");
  const [feedback, setFeedback] = useState<string | null>(null);

  const groups = useMemo(() => [...new Set(snapshot.skills.map((skill) => skill.groupName))].sort(), [snapshot.skills]);
  const skills = useMemo(() => {
    const query = search.trim().toLowerCase();
    return snapshot.skills
      .filter((skill) => group === "all" || skill.groupName === group)
      .filter((skill) => skillMatchesFilter(skill, filter))
      .filter((skill) => !query || skill.skillName.toLowerCase().includes(query) || skill.groupName.toLowerCase().includes(query))
      .sort((a, b) => {
        if (sort === "name") return a.skillName.localeCompare(b.skillName);
        if (sort === "group") return a.groupName.localeCompare(b.groupName) || a.skillName.localeCompare(b.skillName);
        if (sort === "level") return b.level - a.level || a.skillName.localeCompare(b.skillName);
        if (sort === "sp") return b.skillpoints - a.skillpoints || a.skillName.localeCompare(b.skillName);
        return (a.secondsToNextLevel ?? Number.POSITIVE_INFINITY) - (b.secondsToNextLevel ?? Number.POSITIVE_INFINITY);
      });
  }, [filter, group, search, snapshot.skills, sort]);

  const addSkill = async (planId: string, skillTypeId: number, targetLevel: number, addPrerequisites: boolean) => {
    setFeedback(null);
    try {
      await onAddSkill(planId, skillTypeId, targetLevel, addPrerequisites);
      setFeedback("Skill and missing prerequisites added to the plan.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not update the plan.");
    }
  };

  return (
    <ToolPanel title="Character skills" description={`${skills.length} of ${snapshot.skills.length} skills`} bodyClassName="space-y-2">
      <div className="grid gap-1.5 md:grid-cols-[minmax(180px,1fr)_150px_160px_130px_minmax(170px,220px)]">
        <label className="relative block">
          <span className="sr-only">Search skills</span><Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input className="h-8 w-full border pl-7 pr-2 text-[11px]" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search skills…" />
        </label>
        <select aria-label="Skill status" value={filter} onChange={(event) => setFilter(event.target.value as SkillFilter)} className="h-8 border px-2 text-[10px]">
          <option value="all">All states</option><option value="trained">Trained</option><option value="partial">Partially trained</option><option value="untrained">Untrained</option><option value="level5">Level V</option><option value="training">Currently training</option><option value="queued">Queued</option><option value="missing">Missing prerequisite</option>
        </select>
        <select aria-label="Skill group" value={group} onChange={(event) => setGroup(event.target.value)} className="h-8 border px-2 text-[10px]">
          <option value="all">All skill groups</option>{groups.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select aria-label="Sort skills" value={sort} onChange={(event) => setSort(event.target.value as SkillSort)} className="h-8 border px-2 text-[10px]">
          <option value="group">Group</option><option value="name">Name</option><option value="level">Level</option><option value="sp">Skillpoints</option><option value="next">Next level time</option>
        </select>
        <select aria-label="Plan used by add buttons" value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)} className="h-8 border px-2 text-[10px]">
          <option value="">{plans.length ? "Choose a plan" : "No plans yet"}</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
        </select>
      </div>
      {feedback ? <InlineFeedback message={feedback} tone={feedback.startsWith("Skill") ? "success" : "danger"} /> : null}

      {skills.length === 0 ? <ToolEmptyState title="No matching skills">Adjust the filters or search query.</ToolEmptyState> : (
        <div className="overflow-x-auto border border-[#2c2f36]">
          <table className="tt2-table w-full min-w-[1000px] border-collapse text-left text-[10px]">
            <thead className="sticky top-0 z-10 bg-[#101219]"><tr className="border-b border-[#343943]"><th className="w-52 px-2 py-2">Skill</th><th className="w-36 px-2 py-2">Group</th><th className="w-24 px-2 py-2">Level</th><th className="w-24 px-2 py-2 text-right">SP</th><th className="w-16 px-2 py-2 text-right">Rank</th><th className="w-32 px-2 py-2">Attributes</th><th className="w-28 px-2 py-2">Next level</th><th className="min-w-48 px-2 py-2">Prerequisites</th><th className="w-20 px-2 py-2"><span className="sr-only">Plan</span></th></tr></thead>
            <tbody>{skills.map((skill, index) => (
              <tr key={skill.skillTypeId} className={`border-b border-[#22262e] ${index % 2 ? "bg-[#080b11]" : "bg-[#05070b]"}`}>
                <td className="px-2 py-1.5"><div className="flex items-center gap-1.5"><span className="truncate text-[11px] text-slate-200">{skill.skillName}</span>{skill.currentlyTraining ? <ToolStatus tone="info">Training</ToolStatus> : skill.queued ? <span className="text-[8px] uppercase tracking-wider text-[#8bd3ff]">Queued</span> : null}</div>{skill.partiallyTrained && skill.level < 5 ? <div className="text-[9px] text-[#e4b44c]">Partial progress</div> : null}</td>
                <td className="px-2 py-1.5 text-slate-500">{skill.groupName}</td>
                <td className="px-2 py-1.5">
                  <LevelPips level={skill.level} />
                  {skill.activeLevel < skill.level ? <div className="mt-0.5 text-[8px] font-semibold uppercase tracking-wider text-[#e4b44c]" title={`Trained to level ${skill.level}, active to level ${skill.activeLevel} in the current clone state`}>Active L{skill.activeLevel}</div> : null}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-slate-300">{formatNumber(skill.skillpoints)}</td>
                <td className="px-2 py-1.5 text-right font-mono text-slate-400">{skill.rank ?? "—"}</td>
                <td className="px-2 py-1.5 text-[9px] capitalize text-slate-500">{skill.primaryAttribute ?? "—"} / {skill.secondaryAttribute ?? "—"}</td>
                <td className="px-2 py-1.5 font-mono text-slate-300">{skill.level >= 5 ? "Complete" : formatDuration(skill.secondsToNextLevel, { short: true })}<div className="text-[9px] text-slate-600">{formatNumber(skill.spToNextLevel, true)} SP</div></td>
                <td className="px-2 py-1.5">
                  {skill.prerequisites.length === 0 ? <span className="text-slate-600">None</span> : (
                    <details><summary className={`cursor-pointer text-[10px] ${skill.missingPrerequisites.length ? "text-[#ff9eaa]" : "text-slate-400"}`}>{skill.missingPrerequisites.length ? `${skill.missingPrerequisites.length} missing` : `${skill.prerequisites.length} satisfied`}</summary><div className="mt-1 space-y-0.5 border-l border-[#343943] pl-2">{skill.prerequisites.map((item) => <div key={`${item.skillTypeId}-${item.requiredLevel}`} className={item.missing ? "text-[#ff9eaa]" : "text-slate-500"}>{item.skillName} {item.currentLevel}/{item.requiredLevel}</div>)}</div></details>
                  )}
                </td>
                <td className="px-2 py-1.5"><AddToPlanButton plans={plans} selectedPlanId={selectedPlanId} skill={skill} onAdd={addSkill} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </ToolPanel>
  );
}

function QueueView({ snapshot, plans, now }: { snapshot: CharacterSnapshot; plans: SkillPlan[]; now: number }) {
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0]?.id ?? "");
  const [analysis, setAnalysis] = useState<PlanAnalysis | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null;
  useEffect(() => {
    if (!selectedPlanId && plans[0]) setSelectedPlanId(plans[0].id);
  }, [plans, selectedPlanId]);
  useEffect(() => {
    if (!selectedPlanId) {
      setAnalysis(null);
      setComparisonError(null);
      setComparisonLoading(false);
      return;
    }
    let active = true;
    setComparisonLoading(true);
    setComparisonError(null);
    void analyzePlan({ planId: selectedPlanId, characterId: snapshot.characterId }).then((result) => {
      if (active) setAnalysis(result);
    }).catch((error) => {
      if (active) {
        setAnalysis(null);
        setComparisonError(apiErrorMessage(error));
      }
    }).finally(() => {
      if (active) setComparisonLoading(false);
    });
    return () => { active = false; };
  }, [selectedPlanId, snapshot.characterId]);
  const queuedLevelsByType = useMemo(() => {
    const levels = new Map<number, number>();
    snapshot.queue.forEach((item) => {
      if (item.skillTypeId === null || item.targetLevel === null) return;
      levels.set(item.skillTypeId, Math.max(levels.get(item.skillTypeId) ?? 0, item.targetLevel));
    });
    return levels;
  }, [snapshot.queue]);
  const skillsByType = useMemo(() => new Map(snapshot.skills.map((skill) => [skill.skillTypeId, skill])), [snapshot.skills]);
  const locallyPlannedNotQueued = selectedPlan?.entries.filter((entry) => {
    const trainedLevel = skillsByType.get(entry.skillTypeId)?.level ?? 0;
    const queuedLevel = queuedLevelsByType.get(entry.skillTypeId) ?? 0;
    return Math.max(trainedLevel, queuedLevel) < entry.targetLevel;
  }) ?? [];
  const comparison = analysis?.queueComparison ?? null;
  const plannedNotQueued = comparison?.plannedNotQueued ?? [];
  const queuedNotPlanned = comparison?.queuedNotPlanned ?? [];
  const plannedNotQueuedCount = comparison ? plannedNotQueued.length : locallyPlannedNotQueued.length;
  const queuedNotPlannedKeys = new Set(queuedNotPlanned.map((entry) => `${entry.skillTypeId}:${entry.level}`));
  const queueEnd = snapshot.queue.reduce<string | null>((latest, item) => !latest || (item.endAt && new Date(item.endAt) > new Date(latest)) ? item.endAt ?? latest : latest, null);
  const remainingQueue = secondsUntil(queueEnd, now);
  const queueState = snapshot.character?.queueState ?? "empty";
  const skillNameForPair = (pair: PlanQueuePair) => snapshot.skills.find((skill) => skill.skillTypeId === pair.skillTypeId)?.skillName
    ?? selectedPlan?.entries.find((entry) => entry.skillTypeId === pair.skillTypeId)?.skillName
    ?? `Skill ${pair.skillTypeId}`;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        <ToolStat label="Queue entries" value={snapshot.queue.length} />
        <ToolStat label="Queue remaining" value={formatDuration(remainingQueue, { short: true })} />
        <ToolStat label="Queue completes" value={formatDateTime(queueEnd)} />
        <ToolStat label="Plan not queued" value={selectedPlan ? (comparisonLoading ? "…" : plannedNotQueuedCount) : "—"} />
      </div>
      {queueState === "gap" ? <InlineFeedback message={`Training gap${snapshot.character?.nextTraining?.startAt ? ` until ${formatDateTime(snapshot.character.nextTraining.startAt)}` : " before the next scheduled skill"}.`} tone="warning" /> : null}
      {queueState === "paused" ? <InlineFeedback message="The queue contains unfinished entries, but none is actively training." tone="warning" /> : null}
      <InlineFeedback message={comparisonError} tone="danger" />
      <ToolPanel title="Actual training queue" description="Countdowns are calculated locally from ESI timestamps" actions={
        <select aria-label="Plan to compare against queue" value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)} className="h-7 max-w-52 border px-2 text-[10px]"><option value="">Compare with plan…</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select>
      } bodyClassName="p-0">
        {snapshot.queue.length === 0 ? <ToolEmptyState title="Training queue is empty">Start training in EVE, then sync this character.</ToolEmptyState> : (
          <div className="overflow-x-auto">
            <table className="tt2-table w-full min-w-[820px] border-collapse text-left text-[10px]">
              <thead className="bg-[#101219]"><tr className="border-b border-[#343943]"><th className="w-12 px-2 py-2">#</th><th className="px-2 py-2">Skill</th><th className="w-24 px-2 py-2">Duration</th><th className="w-36 px-2 py-2">Starts</th><th className="w-36 px-2 py-2">Ends</th><th className="w-40 px-2 py-2">Progress</th><th className="w-28 px-2 py-2">Plan</th></tr></thead>
              <tbody>{snapshot.queue.map((item, index) => {
                const progress = trainingProgress(item, now);
                const startMs = item.startAt ? new Date(item.startAt).getTime() : Number.NaN;
                const endMs = item.endAt ? new Date(item.endAt).getTime() : Number.NaN;
                const isActive = Number.isFinite(endMs) && endMs > now && (!Number.isFinite(startMs) || startMs <= now);
                const exactKey = item.skillTypeId !== null && item.targetLevel !== null ? `${item.skillTypeId}:${item.targetLevel}` : "";
                const inPlan = comparison
                  ? Boolean(exactKey) && !queuedNotPlannedKeys.has(exactKey)
                  : item.skillTypeId !== null && Boolean(selectedPlan?.entries.some((entry) => entry.skillTypeId === item.skillTypeId && entry.targetLevel === (item.targetLevel ?? 0)));
                return (
                  <tr key={item.id} className={`border-b border-[#22262e] ${isActive ? "bg-[#0c1924]" : index % 2 ? "bg-[#080b11]" : "bg-[#05070b]"}`}>
                    <td className="px-2 py-2 font-mono text-slate-600">{index + 1}</td>
                    <td className="px-2 py-2"><div className="text-[11px] text-slate-200">{item.skillName} {item.targetLevel ? `→ Level ${item.targetLevel}` : ""}</div>{isActive ? <ToolStatus tone="info">Training now</ToolStatus> : null}</td>
                    <td className="px-2 py-2 font-mono text-slate-400">{formatDuration(secondsBetween(item.startAt, item.endAt), { short: true })}</td>
                    <td className="px-2 py-2 font-mono text-slate-400">{formatDateTime(item.startAt)}</td>
                    <td className="px-2 py-2 font-mono text-slate-300">{formatDateTime(item.endAt)}</td>
                    <td className="px-2 py-2"><ProgressBar value={progress} compact label={isActive ? formatDuration(secondsUntil(item.endAt, now), { short: true }) : undefined} /></td>
                    <td className="px-2 py-2">{selectedPlan ? <span className={inPlan ? "text-[#45cf78]" : "text-[#e4b44c]"}>{inPlan ? "In plan" : "Not planned"}</span> : <span className="text-slate-600">—</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </ToolPanel>
      {selectedPlan ? (
        <ToolPanel title="Plan comparison" description={comparison ? `${comparison.inOrderPrefixLength} queue entries match the plan prefix` : "Comparing the saved plan with the live queue"}>
          {comparisonLoading ? <BusyLine>Comparing queue and plan…</BusyLine> : (
            <div className="space-y-2">
              {comparison?.exactMatch ? <ToolStatus tone="success">The live queue exactly matches the remaining plan</ToolStatus> : null}
              {comparison?.orderMismatches.length ? <ToolStatus tone="warning">Queue order diverges at position {comparison.orderMismatches[0].index + 1}</ToolStatus> : null}
              <div>
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500">Planned but not queued ({plannedNotQueuedCount})</div>
                {comparison ? (
                  plannedNotQueued.length ? <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">{plannedNotQueued.slice(0, 30).map((entry) => <div key={`${entry.skillTypeId}-${entry.level}-${entry.order}`} className="flex items-center justify-between gap-2 border border-[#282d35] bg-[#080b10] px-2 py-1.5 text-[10px]"><span className="truncate text-slate-300">{skillNameForPair(entry)}</span><span className="shrink-0 font-mono text-slate-500">L{entry.level}</span></div>)}</div> : <ToolStatus tone="success">Every remaining plan skill is queued</ToolStatus>
                ) : locallyPlannedNotQueued.length ? <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">{locallyPlannedNotQueued.slice(0, 30).map((entry) => <div key={entry.id} className="flex items-center justify-between gap-2 border border-[#282d35] bg-[#080b10] px-2 py-1.5 text-[10px]"><span className="truncate text-slate-300">{entry.skillName}</span><span className="shrink-0 font-mono text-slate-500">L{entry.targetLevel}</span></div>)}</div> : <ToolStatus tone="success">Every remaining plan skill is queued</ToolStatus>}
              </div>
              {comparison && queuedNotPlanned.length ? (
                <div>
                  <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500">Queued but not planned ({queuedNotPlanned.length})</div>
                  <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">{queuedNotPlanned.slice(0, 30).map((entry) => <div key={`${entry.skillTypeId}-${entry.level}-${entry.queuePosition}`} className="flex items-center justify-between gap-2 border border-[#493d20] bg-[#120f07] px-2 py-1.5 text-[10px]"><span className="truncate text-slate-300">{skillNameForPair(entry)}</span><span className="shrink-0 font-mono text-[#e4b44c]">L{entry.level}</span></div>)}</div>
                </div>
              ) : null}
            </div>
          )}
        </ToolPanel>
      ) : null}
    </div>
  );
}

export function CharacterView(props: CharacterViewProps) {
  const character = props.snapshot?.character ?? props.character;
  if (!character && props.loading) return <BusyLine>Loading character snapshot…</BusyLine>;
  if (!character) return <ToolEmptyState title="Character unavailable">This character may have been unlinked or you may not have access.</ToolEmptyState>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 border border-[#2c2f36] bg-[#0a0d13] p-2">
        <div className="flex min-w-0 items-center gap-2">
          <ToolButton size="sm" variant="ghost" onClick={props.onBack}><ArrowLeft className="h-3.5 w-3.5" />Monitor</ToolButton>
          <span className="hidden h-5 border-l border-[#30343c] sm:block" />
          <div className="min-w-0"><div className="truncate text-xs font-semibold text-slate-200">{character.name}</div><div className="text-[9px] uppercase tracking-wider text-slate-600">Character workspace</div></div>
        </div>
        <div className="flex gap-1">
          <ToolButton size="sm" onClick={props.onSync} disabled={props.syncing}><RefreshCw className={`h-3.5 w-3.5 ${props.syncing ? "animate-spin motion-reduce:animate-none" : ""}`} />Sync</ToolButton>
          <ToolButton size="sm" variant="danger" onClick={props.onUnlink}><Unlink className="h-3.5 w-3.5" />Unlink</ToolButton>
        </div>
      </div>
      <InlineFeedback message={props.error ?? props.snapshot?.error ?? null} tone="danger" />
      <ToolTabs tabs={[{ key: "skills" as const, label: <span className="inline-flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5" />Skills</span> }, { key: "queue" as const, label: <span className="inline-flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" />Queue</span> }]} active={props.tab} onChange={props.onTab} />
      <div className="grid gap-2 lg:grid-cols-[230px_minmax(0,1fr)]">
        <CharacterSummary character={character} snapshot={props.snapshot} now={props.now} />
        <div className="min-w-0">
          {props.loading && !props.snapshot ? <BusyLine>Loading skills and queue…</BusyLine> : props.snapshot ? (
            props.tab === "skills" ? <SkillsView snapshot={props.snapshot} plans={props.plans} onAddSkill={props.onAddSkill} /> : <QueueView snapshot={props.snapshot} plans={props.plans} now={props.now} />
          ) : <ToolEmptyState title="No snapshot available"><span className="inline-flex items-center gap-1"><ShieldAlert className="h-4 w-4" />Sync this character or reauthorize the required ESI scopes.</span></ToolEmptyState>}
        </div>
      </div>
    </div>
  );
}
