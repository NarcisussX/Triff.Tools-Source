import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plus, Search, ShieldCheck, Target, Users, XCircle } from "lucide-react";
import { ToolButton, ToolEmptyState, ToolNotice, ToolPanel, ToolStat, ToolStatus } from "../../components/tool-ui";
import { addPlanEntry, analyzeRequirements } from "./api";
import type { TriffMonRequiredSkillTarget } from "./fitIntegration";
import type { RequirementAnalysis, RequirementSkill, SkillPlan, TriffMonCatalog, TriffMonCharacter } from "./types";
import { CharacterPortrait, InlineFeedback, LevelPips } from "./shared";
import { apiErrorMessage, formatDuration, formatNumber, monitorCharacterId, uniqueBy } from "./utils";

type RequirementsViewProps = {
  characters: TriffMonCharacter[];
  plans: SkillPlan[];
  catalog: TriffMonCatalog;
  initialTypeId?: number | null;
  initialRequiredSkills?: TriffMonRequiredSkillTarget[];
  initialLabel?: string | null;
  onPlansChanged: () => Promise<void>;
};

function mergeMissingSkills(result: RequirementAnalysis): RequirementSkill[] {
  const flattened = result.characters.flatMap((character) => character.missingSkills).filter((skill) => !skill.inactiveDueToCloneState);
  const byType = new Map<number, RequirementSkill>();
  flattened.forEach((skill) => {
    const current = byType.get(skill.skillTypeId);
    if (!current || skill.requiredLevel > current.requiredLevel) byType.set(skill.skillTypeId, skill);
  });
  return [...byType.values()];
}

export function RequirementsView(props: RequirementsViewProps) {
  const [query, setQuery] = useState(() => props.initialTypeId ? String(props.initialTypeId) : "");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(props.characters.filter((character) => !character.hidden).map(monitorCharacterId)));
  const [result, setResult] = useState<RequirementAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "warning" | "danger">("warning");
  const [selectedPlanId, setSelectedPlanId] = useState(props.plans[0]?.id ?? "");

  useEffect(() => {
    setSelected((current) => {
      if (current.size > 0) return current;
      return new Set(props.characters.filter((character) => !character.hidden).map(monitorCharacterId));
    });
  }, [props.characters]);

  const selectedTarget = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return null;
    return props.catalog.requirementTargets.find((target) => String(target.typeId) === normalized || target.name.toLowerCase() === normalized) ?? null;
  }, [props.catalog.requirementTargets, query]);
  const numericTypeId = /^\d+$/.test(query.trim()) ? Number(query.trim()) : null;
  const typeId = selectedTarget?.typeId ?? numericTypeId;
  const suggestions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length < 2 || selectedTarget) return [];
    return props.catalog.requirementTargets.filter((target) => target.name.toLowerCase().includes(normalized) || String(target.typeId).startsWith(normalized)).slice(0, 10);
  }, [props.catalog.requirementTargets, query, selectedTarget]);

  const toggleCharacter = (characterId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(characterId)) next.delete(characterId);
      else next.add(characterId);
      return next;
    });
  };

  const analyze = async () => {
    if ((!typeId && !props.initialRequiredSkills?.length) || selected.size === 0 || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      setResult(await analyzeRequirements({ typeId, characterIds: [...selected], requiredSkills: props.initialRequiredSkills, label: props.initialLabel }));
    } catch (error) {
      setMessage(apiErrorMessage(error));
      setMessageTone("danger");
    } finally {
      setBusy(false);
    }
  };

  const addSkills = async (skills: RequirementSkill[]) => {
    if (!selectedPlanId || !skills.length || adding) return;
    setAdding(true);
    setMessage(null);
    try {
      const unique = uniqueBy(skills, (skill) => skill.skillTypeId);
      for (const skill of unique) {
        await addPlanEntry(selectedPlanId, { skillTypeId: skill.skillTypeId, targetLevel: skill.requiredLevel, addPrerequisites: true, section: result?.typeName ?? "Requirements" });
      }
      await props.onPlansChanged();
      setMessage(`${unique.length} requirement targets added to the selected plan.`);
      setMessageTone("success");
    } catch (error) {
      setMessage(apiErrorMessage(error));
      setMessageTone("danger");
    } finally {
      setAdding(false);
    }
  };

  const allSelected = props.characters.length > 0 && props.characters.every((character) => selected.has(monitorCharacterId(character)));
  const allMissingSkills = result ? mergeMissingSkills(result) : [];

  return (
    <div className="space-y-2">
      <ToolPanel title="Ship & type requirements" description="Check hard skill requirements across many linked characters" bodyClassName="space-y-2">
        <div className="grid gap-1.5 md:grid-cols-[minmax(220px,1fr)_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-500" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 w-full border pl-8 pr-2 text-xs" placeholder="Search ship/type name or enter a type ID…" />
            {suggestions.length ? <div className="absolute z-20 mt-0.5 max-h-64 w-full overflow-y-auto border border-[#3a4655] bg-[#080b10] shadow-xl">{suggestions.map((target) => <button key={target.typeId} type="button" onClick={() => setQuery(target.name)} className="flex w-full justify-between gap-4 border-b border-[#20242b] px-2 py-2 text-left text-[10px] hover:bg-[#14202d]"><span className="truncate text-slate-300">{target.name}</span><span className="shrink-0 text-slate-600">{target.groupName ?? target.typeId}</span></button>)}</div> : null}
          </div>
          <ToolButton variant="primary" disabled={(!typeId && !props.initialRequiredSkills?.length) || selected.size === 0 || busy} onClick={analyze}><Target className="h-4 w-4" />{busy ? "Analyzing…" : `Check ${selected.size} characters`}</ToolButton>
        </div>
        {selectedTarget ? <div className="flex items-center gap-2 border-l-2 border-[#53b6ff] bg-[#0a1018] px-2 py-1.5 text-[10px]"><strong className="text-slate-200">{selectedTarget.name}</strong><span className="text-slate-500">{selectedTarget.groupName ?? selectedTarget.categoryName ?? "EVE type"} · type {selectedTarget.typeId}</span></div> : numericTypeId ? <div className="text-[10px] text-slate-500">Type ID {numericTypeId}; the server will resolve its current name and requirements.</div> : null}
        {props.initialRequiredSkills?.length ? <div className="flex items-center justify-between gap-3 border-l-2 border-[#45cf78] bg-[#07130d] px-2 py-1.5 text-[10px]"><span><strong className="text-slate-200">{props.initialLabel?.trim() || "Fit requirements"}</strong><span className="ml-2 text-slate-500">{props.initialRequiredSkills.length} hard skill targets from TriffFits</span></span><span className="font-mono text-[9px] text-[#78d99a]">FIT SEAM</span></div> : null}
      </ToolPanel>

      <ToolPanel title="Characters" description={`${selected.size} selected`} actions={<ToolButton size="sm" onClick={() => setSelected(allSelected ? new Set() : new Set(props.characters.map(monitorCharacterId)))}>{allSelected ? "Clear" : "Select all"}</ToolButton>} bodyClassName="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {props.characters.length === 0 ? <div className="sm:col-span-2 lg:col-span-3 xl:col-span-4"><ToolEmptyState title="No linked characters">Link characters from the monitor before checking coverage.</ToolEmptyState></div> : props.characters.map((character) => (
          <label key={character.id} className={`flex cursor-pointer items-center gap-2 border p-1.5 ${selected.has(monitorCharacterId(character)) ? "border-[#466e8d] bg-[#0d1924]" : "border-[#292d35] bg-[#07090e] opacity-70"}`}>
            <input type="checkbox" checked={selected.has(monitorCharacterId(character))} onChange={() => toggleCharacter(monitorCharacterId(character))} />
            <CharacterPortrait character={character} size="sm" />
            <span className="min-w-0"><span className="block truncate text-[10px] font-semibold text-slate-200">{character.name}</span><span className="block truncate text-[9px] text-slate-600">{formatNumber(character.totalSp, true)} SP</span></span>
          </label>
        ))}
      </ToolPanel>

      <InlineFeedback message={message} tone={messageTone} />
      {result ? (
        <>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-6">
            <ToolStat label="Selected" value={result.selectedCount} />
            <ToolStat label="Ready now" value={`${result.readyCount} / ${result.selectedCount}`} className="border-l-2 border-l-[#45cf78]" />
            <ToolStat label="Under 1 day" value={result.underOneDayCount} className="border-l-2 border-l-[#53b6ff]" />
            <ToolStat label="Over 7 days" value={result.overSevenDaysCount} className="border-l-2 border-l-[#e4b44c]" />
            <ToolStat label="Clone limited" value={result.inactiveCloneCount} className="border-l-2 border-l-[#ff6978]" />
            <ToolStat label="Unique skills" value={allMissingSkills.length} />
          </div>
          {result.warnings.map((warning) => <ToolNotice key={warning} tone="warning">{warning}</ToolNotice>)}
          <ToolPanel title={`${result.typeName} coverage`} description="Training estimates use each character’s current skills, attributes, and implants" actions={
            <div className="flex gap-1">
              <select aria-label="Plan for missing requirements" value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)} className="h-[26px] max-w-48 border px-2 text-[10px]"><option value="">Choose plan…</option>{props.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select>
              <ToolButton size="sm" disabled={!selectedPlanId || !allMissingSkills.length || adding} onClick={() => void addSkills(allMissingSkills)}><Plus className="h-3.5 w-3.5" />{adding ? "Adding…" : "Add all missing"}</ToolButton>
            </div>
          } bodyClassName="space-y-1.5">
            {result.characters.length === 0 ? <ToolEmptyState title="No coverage results">The server returned no authorized characters.</ToolEmptyState> : result.characters.map((character) => (
              <article key={character.characterId} className={`border ${character.canUse ? "border-[#285e3b] bg-[#07120c]" : "border-[#30343d] bg-[#070a0f]"}`}>
                <div className="flex flex-wrap items-center gap-2 border-b border-[#262b33] p-2">
                  <div className="grid h-8 w-8 place-items-center border border-[#354254] bg-[#0b1119]">{character.canUse ? <CheckCircle2 className="h-4 w-4 text-[#45cf78]" /> : <XCircle className="h-4 w-4 text-[#e4b44c]" />}</div>
                  <div className="min-w-36 flex-1"><div className="text-[11px] font-semibold text-slate-200">{character.characterName}</div><div className={character.canUse ? "text-[9px] uppercase tracking-wider text-[#45cf78]" : "text-[9px] uppercase tracking-wider text-[#e4b44c]"}>{character.canUse ? "Ready now" : `${character.missingSkills.length} missing skill targets`}</div></div>
                  <div className="grid grid-cols-2 gap-4 text-[9px] uppercase tracking-wider text-slate-600"><span>Missing SP<strong className="block font-mono text-[10px] normal-case tracking-normal text-slate-300">{formatNumber(character.missingSp, true)}</strong></span><span>Training<strong className={`block font-mono text-[10px] normal-case tracking-normal ${character.inactiveDueToCloneState ? "text-[#ff9eaa]" : "text-slate-300"}`}>{character.inactiveDueToCloneState ? "Clone limited" : formatDuration(character.trainingSeconds, { short: true })}</strong></span></div>
                  {!character.canUse ? <ToolButton size="sm" disabled={!selectedPlanId || adding} onClick={() => void addSkills(character.missingSkills)}><Plus className="h-3.5 w-3.5" />Add to plan</ToolButton> : <ToolStatus tone="success"><ShieldCheck className="h-3.5 w-3.5" />Can use</ToolStatus>}
                </div>
                {character.missingSkills.length ? <div className="grid gap-px bg-[#20242b] sm:grid-cols-2 xl:grid-cols-3">{character.missingSkills.map((skill) => (
                  <div key={skill.skillTypeId} className="bg-[#080b10] p-2 text-[10px]">
                    <div className="flex items-center justify-between gap-2"><span className="truncate text-slate-300">{skill.skillName}</span><LevelPips level={skill.currentLevel} targetLevel={skill.requiredLevel} /></div>
                    {skill.inactiveDueToCloneState ? (
                      <div className="mt-1 border-l-2 border-[#ff6978] pl-1.5 text-[9px] text-[#ff9eaa]">Trained L{skill.trainedLevel}, active L{skill.activeLevel} — unavailable in the current clone state</div>
                    ) : (
                      <div className="mt-1 flex justify-between gap-2 font-mono text-[9px] text-slate-600"><span>{formatNumber(skill.missingSp, true)} SP</span><span>{formatDuration(skill.trainingSeconds, { short: true })}</span></div>
                    )}
                  </div>
                ))}</div> : null}
              </article>
            ))}
          </ToolPanel>
        </>
      ) : (
        <ToolEmptyState title="Choose a ship or type"><span className="inline-flex items-center gap-2"><Users className="h-4 w-4" />Run a coverage check to compare requirements across selected characters.</span></ToolEmptyState>
      )}
    </div>
  );
}
