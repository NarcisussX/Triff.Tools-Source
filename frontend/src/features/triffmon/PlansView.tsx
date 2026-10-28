import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  Copy,
  Download,
  FileInput,
  GripVertical,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { ToolButton, ToolEmptyState, ToolField, ToolNotice, ToolPanel, ToolStat, ToolStatus } from "../../components/tool-ui";
import {
  addPlanEntry,
  analyzePlan,
  createPlan,
  deletePlan,
  exportPlan,
  getPlan,
  importPlan,
  optimizePlan,
  patchPlan,
  TriffMonApiError,
} from "./api";
import type {
  CatalogSkill,
  ExportedPlan,
  PlanAnalysis,
  PlanOptimization,
  SkillPlan,
  SkillPlanEntry,
  TriffMonCatalog,
  TriffMonCharacter,
} from "./types";
import { BusyLine, InlineFeedback, LevelPips } from "./shared";
import { apiErrorMessage, formatDateTime, formatDuration, formatNumber, monitorCharacterId } from "./utils";

type PlansViewProps = {
  planId: string | null;
  plans: SkillPlan[];
  characters: TriffMonCharacter[];
  catalog: TriffMonCatalog;
  loading: boolean;
  error: string | null;
  onOpenPlan: (planId: string | null) => void;
  onPlansChanged: () => Promise<void>;
};

function decodeBase64(content: string): ArrayBuffer {
  const compact = content.replace(/\s+/g, "");
  if (!compact || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw new Error("The server returned an invalid base64 export.");
  }
  const binary = window.atob(compact);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function downloadExport(result: ExportedPlan) {
  const body = result.encoding === "base64" ? decodeBase64(result.content) : result.content;
  const url = URL.createObjectURL(new Blob([body], { type: result.mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function ImportPanel({ characters, onImported, onOpenPlan }: { characters: TriffMonCharacter[]; onImported: (plan: SkillPlan) => void; onOpenPlan: (planId: string) => void }) {
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "danger">("success");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [importedPlan, setImportedPlan] = useState<SkillPlan | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    setWarnings([]);
    setImportedPlan(null);
    if (file.size > 2 * 1024 * 1024) {
      setMessage("Plan files must be 2 MB or smaller.");
      setMessageTone("danger");
      return;
    }
    setFilename(file.name);
    if (/\.(?:emp|epb)$/i.test(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      setContent(window.btoa(binary));
    } else {
      setContent(await file.text());
    }
  };
  const submit = async () => {
    if (!content.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    setWarnings([]);
    setImportedPlan(null);
    try {
      const result = await importPlan({ content, filename: filename || undefined, characterId: characterId || null, format: "auto" });
      setMessage("Plan imported and converted to the native Skillnix format.");
      setMessageTone("success");
      setWarnings(result.warnings);
      setImportedPlan(result.plan);
      onImported(result.plan);
    } catch (error) {
      setMessage(apiErrorMessage(error));
      setMessageTone("danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolPanel title="Import plan" description="EVEMon XML/EMP and native JSON are converted into Skillnix entries" bodyClassName="space-y-2">
      <input ref={fileInput} className="sr-only" type="file" accept=".emp,.epb,.xml,.json,.csv,.txt" onChange={(event) => void readFile(event.target.files?.[0])} />
      <div className="grid gap-2 md:grid-cols-[auto_220px_1fr]">
        <ToolButton onClick={() => fileInput.current?.click()}><FileInput className="h-4 w-4" />Choose file</ToolButton>
        <select aria-label="Character for imported plan" value={characterId} onChange={(event) => setCharacterId(event.target.value)} className="h-[30px] border px-2 text-[11px]"><option value="">Unassigned plan</option>{characters.map((character) => <option key={character.id} value={monitorCharacterId(character)}>{character.name}</option>)}</select>
        <div className="truncate border border-[#2c2f36] bg-[#080b10] px-2 py-1.5 text-[10px] text-slate-500">{filename || "No file selected — paste below instead"}</div>
      </div>
      <textarea value={content} onChange={(event) => setContent(event.target.value)} className="min-h-28 w-full border p-2 font-mono text-[10px]" placeholder="Paste an EVEMon plan or native Skillnix JSON…" />
      {message ? <InlineFeedback message={message} tone={messageTone} /> : null}
      {warnings.length ? <div className="space-y-1" aria-label="Import warnings">{warnings.map((warning, index) => <ToolNotice key={`${index}-${warning}`} tone="warning">{warning}</ToolNotice>)}</div> : null}
      {importedPlan ? <div className="flex justify-end"><ToolButton onClick={() => onOpenPlan(importedPlan.id)}>Open imported plan</ToolButton></div> : null}
      <div className="flex justify-end"><ToolButton variant="primary" disabled={!content.trim() || busy} onClick={submit}><Upload className="h-4 w-4" />{busy ? "Importing…" : "Import plan"}</ToolButton></div>
    </ToolPanel>
  );
}

function PlansIndex(props: PlansViewProps) {
  const [name, setName] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const plan = await createPlan({ name: name.trim(), characterId: characterId || null });
      await props.onPlansChanged();
      props.onOpenPlan(plan.id);
    } catch (error) {
      setMessage(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <ToolPanel title="New skill plan" description="Plans persist to your Triff.Tools account" actions={<ToolButton size="sm" onClick={() => setShowImport((value) => !value)}><Upload className="h-3.5 w-3.5" />Import</ToolButton>}>
        <form onSubmit={submit} className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_240px_auto] md:items-end">
          <ToolField label="Plan name"><input required value={name} onChange={(event) => setName(event.target.value)} className="h-9 border px-2 text-xs" placeholder="Marauders V" /></ToolField>
          <ToolField label="Character"><select value={characterId} onChange={(event) => setCharacterId(event.target.value)} className="h-9 border px-2 text-xs"><option value="">Unassigned plan</option>{props.characters.map((character) => <option key={character.id} value={monitorCharacterId(character)}>{character.name}</option>)}</select></ToolField>
          <ToolButton type="submit" variant="primary" disabled={!name.trim() || busy}><Plus className="h-4 w-4" />{busy ? "Creating…" : "Create plan"}</ToolButton>
        </form>
        {message ? <div className="mt-2"><InlineFeedback message={message} tone="danger" /></div> : null}
      </ToolPanel>
      {showImport ? <ImportPanel characters={props.characters} onImported={() => { void props.onPlansChanged(); }} onOpenPlan={props.onOpenPlan} /> : null}
      <ToolPanel title="Skill plans" description={`${props.plans.length} saved plans`}>
        {props.loading && props.plans.length === 0 ? <BusyLine>Loading plans…</BusyLine> : props.plans.length === 0 ? <ToolEmptyState title="No skill plans yet">Create a plan or import an existing EVEMon plan.</ToolEmptyState> : (
          <div className="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
            {props.plans.map((plan) => (
              <button key={plan.id} type="button" onClick={() => props.onOpenPlan(plan.id)} className="group border border-[#30343d] bg-[#070a0f] p-3 text-left hover:border-[#567691] hover:bg-[#0b1119]">
                <div className="flex items-start justify-between gap-3"><span className="truncate text-xs font-semibold text-slate-100 group-hover:text-[#8bd3ff]">{plan.name}</span><span className="shrink-0 font-mono text-[9px] text-slate-600">{plan.entries.length} skills</span></div>
                <div className="mt-1 truncate text-[10px] text-slate-500">{plan.characterName ?? props.characters.find((character) => monitorCharacterId(character) === plan.characterId)?.name ?? "Unassigned"}</div>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[#242830] pt-2 text-[9px] uppercase tracking-wider text-slate-600">
                  <span>Remaining <strong className="block font-mono text-[10px] normal-case tracking-normal text-slate-300">{plan.remainingSp === null ? "Open to calculate" : `${formatNumber(plan.remainingSp, true)} SP`}</strong></span>
                  <span>Training <strong className="block font-mono text-[10px] normal-case tracking-normal text-slate-300">{plan.trainingSeconds === null ? "Open to calculate" : formatDuration(plan.trainingSeconds, { short: true })}</strong></span>
                </div>
                <div className="mt-2 text-[9px] text-slate-600">Updated {formatDateTime(plan.updatedAt)}</div>
              </button>
            ))}
          </div>
        )}
      </ToolPanel>
    </div>
  );
}

function PlanAnalysisPanel({ analysis, optimization }: { analysis: PlanAnalysis | null; optimization: PlanOptimization | null }) {
  if (!analysis && !optimization) return null;
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {analysis ? (
        <ToolPanel title="Plan analysis" bodyClassName="space-y-2">
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-5"><ToolStat label="Remaining SP" value={formatNumber(analysis.remainingSp, true)} /><ToolStat label="Training" value={formatDuration(analysis.trainingSeconds, { short: true })} /><ToolStat label="Trained" value={analysis.trainedCount} /><ToolStat label="Partial" value={analysis.partialCount} /><ToolStat label="Missing" value={analysis.missingCount} /></div>
          {analysis.completionAt ? <div className="text-[10px] text-slate-500">Projected completion <span className="font-mono text-slate-300">{formatDateTime(analysis.completionAt)}</span></div> : null}
          {analysis.warnings.map((warning) => <ToolNotice key={warning} tone="warning">{warning}</ToolNotice>)}
        </ToolPanel>
      ) : null}
      {optimization ? (
        <ToolPanel title="Attribute optimization" bodyClassName="space-y-2">
          <div className="grid grid-cols-3 gap-1"><ToolStat label="Current" value={formatDuration(optimization.currentSeconds, { short: true })} /><ToolStat label="Optimized" value={formatDuration(optimization.optimizedSeconds, { short: true })} /><ToolStat label="Time saved" value={formatDuration(optimization.secondsSaved, { short: true })} /></div>
          {Object.keys(optimization.attributes).length ? <div className="flex flex-wrap gap-1">{Object.entries(optimization.attributes).map(([name, value]) => <span key={name} className="border border-[#354254] bg-[#0b1119] px-2 py-1 text-[9px] capitalize text-slate-400">{name.replaceAll("_", " ")} <strong className="font-mono text-slate-200">{value}</strong></span>)}</div> : null}
          {optimization.segments.map((segment) => <div key={`${segment.label}-${segment.startsAtEntry}`} className="border-l-2 border-[#53b6ff] bg-[#090d13] px-2 py-1.5 text-[10px]"><div className="font-semibold text-slate-300">{segment.label}</div><div className="text-slate-500">{segment.primaryAttribute ?? "—"} / {segment.secondaryAttribute ?? "—"} · {formatDuration(segment.trainingSeconds, { short: true })}</div></div>)}
          {optimization.warnings.map((warning) => <ToolNotice key={warning} tone="warning">{warning}</ToolNotice>)}
        </ToolPanel>
      ) : null}
    </div>
  );
}

function PlanEntryRow({ entry, index, count, dragging, onDragStart, onDrop, onMove, onTarget, onSection, onRemove }: {
  entry: SkillPlanEntry;
  index: number;
  count: number;
  dragging: boolean;
  onDragStart: (entryId: string) => void;
  onDrop: (targetEntryId: string) => void;
  onMove: (from: number, to: number) => void;
  onTarget: (entryId: string, level: number) => void;
  onSection: (entryId: string, section: string | null) => void;
  onRemove: (entryId: string) => void;
}) {
  const handleDrag = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", entry.id);
    onDragStart(entry.id);
  };
  return (
    <div
      draggable
      onDragStart={handleDrag}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
      onDrop={(event) => { event.preventDefault(); onDrop(entry.id); }}
      className={`grid gap-1 border-b border-[#22262e] px-1 py-1.5 transition-colors motion-reduce:transition-none md:grid-cols-[28px_minmax(190px,1fr)_100px_115px_110px_100px] md:items-center ${dragging ? "bg-[#142130] opacity-60" : index % 2 ? "bg-[#080b11]" : "bg-[#05070b]"}`}
    >
      <div className="hidden cursor-grab place-items-center text-slate-600 md:grid" title="Drag to reorder"><GripVertical className="h-4 w-4" /></div>
      <div className="min-w-0">
        <div className="flex items-center gap-2"><span className="truncate text-[11px] font-medium text-slate-200">{entry.skillName}</span>{entry.autoAdded ? <span className="shrink-0 border border-[#5c4e2c] bg-[#201a0d] px-1 py-0.5 text-[8px] uppercase tracking-wider text-[#e4b44c]">Prereq</span> : null}{entry.alreadyTrained ? <span className="shrink-0 border border-[#285c3b] bg-[#0d2115] px-1 py-0.5 text-[8px] uppercase tracking-wider text-[#65dc91]">Trained</span> : entry.partiallyTrained ? <span className="shrink-0 border border-[#315a78] bg-[#0b1b28] px-1 py-0.5 text-[8px] uppercase tracking-wider text-[#75c9ff]">Partial</span> : entry.remainingSp !== null ? <span className="shrink-0 border border-[#4d465b] bg-[#17131e] px-1 py-0.5 text-[8px] uppercase tracking-wider text-slate-400">Needed</span> : null}</div>
        <div className="mt-0.5 flex items-center gap-2"><LevelPips level={entry.currentLevel ?? 0} targetLevel={entry.targetLevel} /><span className="font-mono text-[9px] text-slate-600">{entry.currentSp !== null ? `${formatNumber(entry.currentSp, true)} current · ` : ""}{formatNumber(entry.remainingSp, true)} left · {formatDuration(entry.trainingSeconds, { short: true })}</span></div>
      </div>
      <select aria-label={`Target level for ${entry.skillName}`} value={entry.targetLevel} onChange={(event) => onTarget(entry.id, Number(event.target.value))} className="h-8 border px-2 text-[10px]">{[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>Level {level}</option>)}</select>
      <input aria-label={`Section for ${entry.skillName}`} defaultValue={entry.section ?? ""} placeholder="Section" className="h-8 border px-2 text-[10px]" onBlur={(event) => { const value = event.currentTarget.value.trim() || null; if (value !== entry.section) onSection(entry.id, value); }} />
      <div className="font-mono text-[10px] text-slate-400"><span className="md:hidden">Time: </span>{formatDuration(entry.trainingSeconds, { short: true })}</div>
      <div className="flex justify-end gap-0.5">
        <button type="button" disabled={index === 0} onClick={() => onMove(index, index - 1)} className="tt2-touch-target grid h-7 w-7 place-items-center text-slate-500 hover:bg-[#15202d] hover:text-[#8bd3ff] disabled:opacity-25" aria-label={`Move ${entry.skillName} up`}><ArrowUp className="h-3.5 w-3.5" /></button>
        <button type="button" disabled={index === count - 1} onClick={() => onMove(index, index + 1)} className="tt2-touch-target grid h-7 w-7 place-items-center text-slate-500 hover:bg-[#15202d] hover:text-[#8bd3ff] disabled:opacity-25" aria-label={`Move ${entry.skillName} down`}><ArrowDown className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => onRemove(entry.id)} className="tt2-touch-target grid h-7 w-7 place-items-center text-slate-600 hover:bg-[#2a1015] hover:text-[#ff9eaa]" aria-label={`Remove ${entry.skillName}`}><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

function mergePlanAnalysis(plan: SkillPlan, analysis: PlanAnalysis): SkillPlan {
  const analyzedBySkill = new Map(analysis.entries.map((entry) => [entry.skillTypeId, entry]));
  return {
    ...plan,
    remainingSp: analysis.remainingSp,
    trainingSeconds: analysis.trainingSeconds,
    completionAt: analysis.completionAt,
    entries: plan.entries.map((entry) => {
      const calculated = analyzedBySkill.get(entry.skillTypeId);
      if (!calculated) return entry;
      return {
        ...entry,
        currentLevel: calculated.currentLevel,
        activeLevel: calculated.activeLevel,
        currentSp: calculated.currentSp,
        targetSp: calculated.targetSp,
        remainingSp: calculated.remainingSp,
        trainingSeconds: calculated.trainingSeconds,
        alreadyTrained: calculated.alreadyTrained,
        partiallyTrained: calculated.partiallyTrained,
      };
    }),
  };
}

type AcrossCharacterResult = {
  analysis?: PlanAnalysis;
  analysisRevision?: string;
  analysisError?: string;
  copiedPlan?: SkillPlan;
  copyError?: string;
};

function analysisReadiness(analysis: PlanAnalysis): { label: string; tone: "info" | "success" | "warning" } {
  if (analysis.missingCount === 0 || analysis.remainingSp === 0) return { label: "Ready", tone: "success" };
  if (analysis.partialCount > 0 || analysis.trainedCount > 0) return { label: "In progress", tone: "warning" };
  return { label: "Training needed", tone: "info" };
}

function PlanAcrossCharacters({ plan, characters, metadataDirty, onPlansChanged, onOpenPlan }: {
  plan: SkillPlan;
  characters: TriffMonCharacter[];
  metadataDirty: boolean;
  onPlansChanged: () => Promise<void>;
  onOpenPlan: (planId: string | null) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => plan.characterId && characters.some((character) => monitorCharacterId(character) === plan.characterId) ? [plan.characterId] : []);
  const [results, setResults] = useState<Record<string, AcrossCharacterResult>>({});
  const [busy, setBusy] = useState<"analysis" | "copy" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "warning" | "danger">("success");

  const characterIds = useMemo(() => characters.map(monitorCharacterId), [characters]);
  const selectedCharacters = useMemo(() => {
    const selected = new Set(selectedIds);
    return characters.filter((character) => selected.has(monitorCharacterId(character)));
  }, [characters, selectedIds]);
  const analysisRevision = useMemo(
    () => plan.entries.map((entry) => `${entry.skillTypeId}:${entry.targetLevel}:${entry.position}`).join("|"),
    [plan.entries],
  );

  const toggleCharacter = (characterId: string) => {
    setSelectedIds((current) => current.includes(characterId)
      ? current.filter((value) => value !== characterId)
      : [...current, characterId]);
  };

  const analyzeSelected = async () => {
    if (!selectedCharacters.length || busy) return;
    setBusy("analysis");
    setMessage(null);
    setResults((current) => {
      const next = { ...current };
      selectedCharacters.forEach((character) => {
        const characterId = monitorCharacterId(character);
        next[characterId] = { ...next[characterId], analysisError: undefined };
      });
      return next;
    });

    const completed = await Promise.all(selectedCharacters.map(async (character) => {
      const characterId = monitorCharacterId(character);
      try {
        return { characterId, analysis: await analyzePlan({ planId: plan.id, characterId }) };
      } catch (error) {
        return { characterId, error: apiErrorMessage(error) };
      }
    }));

    setResults((current) => {
      const next = { ...current };
      completed.forEach((result) => {
        next[result.characterId] = result.analysis
          ? { ...next[result.characterId], analysis: result.analysis, analysisRevision, analysisError: undefined }
          : { ...next[result.characterId], analysisError: result.error };
      });
      return next;
    });
    const failed = completed.filter((result) => result.error).length;
    setMessage(failed
      ? `Analyzed ${completed.length - failed} of ${completed.length} characters; ${failed} failed independently.`
      : `Analyzed ${completed.length} character${completed.length === 1 ? "" : "s"}.`);
    setMessageTone(failed ? "warning" : "success");
    setBusy(null);
  };

  const copyToSelected = async () => {
    if (!selectedCharacters.length || busy || metadataDirty) return;
    setBusy("copy");
    setMessage(null);
    setResults((current) => {
      const next = { ...current };
      selectedCharacters.forEach((character) => {
        const characterId = monitorCharacterId(character);
        next[characterId] = { ...next[characterId], copyError: undefined };
      });
      return next;
    });

    const completed = await Promise.all(selectedCharacters.map(async (character) => {
      const characterId = monitorCharacterId(character);
      try {
        const copiedPlan = await createPlan({
          name: plan.name,
          characterId,
          notes: plan.notes,
          entries: plan.entries,
          sections: plan.sections,
          settings: plan.settings,
          sourceType: plan.sourceType,
          sourceMetadata: plan.sourceMetadata,
        });
        return { characterId, copiedPlan };
      } catch (error) {
        return { characterId, error: apiErrorMessage(error) };
      }
    }));

    setResults((current) => {
      const next = { ...current };
      completed.forEach((result) => {
        next[result.characterId] = result.copiedPlan
          ? { ...next[result.characterId], copiedPlan: result.copiedPlan, copyError: undefined }
          : { ...next[result.characterId], copyError: result.error };
      });
      return next;
    });

    const created = completed.filter((result) => result.copiedPlan).length;
    const failed = completed.length - created;
    let refreshFailed = false;
    if (created) {
      try { await onPlansChanged(); } catch { refreshFailed = true; }
    }
    setMessage(failed
      ? `Created ${created} of ${completed.length} assigned copies; ${failed} failed independently.`
      : `Created ${created} assigned plan cop${created === 1 ? "y" : "ies"}${refreshFailed ? ", but the plan index could not be refreshed" : ""}.`);
    setMessageTone(failed || refreshFailed ? "warning" : "success");
    setBusy(null);
  };

  return (
    <ToolPanel
      title="Plan across characters"
      description="Analyze independently, then create one fully native assigned copy per selected character"
      actions={<span className="font-mono text-[9px] text-slate-500">{selectedCharacters.length}/{characters.length} selected</span>}
      bodyClassName="space-y-2"
    >
      {characters.length === 0 ? <ToolEmptyState title="No linked characters">Link an EVE character before comparing or applying this plan.</ToolEmptyState> : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1">
              <ToolButton size="sm" variant="ghost" disabled={Boolean(busy) || selectedCharacters.length === characterIds.length} onClick={() => setSelectedIds(characterIds)}>Select all</ToolButton>
              <ToolButton size="sm" variant="ghost" disabled={Boolean(busy) || selectedIds.length === 0} onClick={() => setSelectedIds([])}>Clear</ToolButton>
            </div>
            <div className="flex flex-wrap gap-1">
              <ToolButton size="sm" disabled={!selectedCharacters.length || Boolean(busy)} onClick={analyzeSelected}><BarChart3 className="h-3.5 w-3.5" />{busy === "analysis" ? "Analyzing…" : "Analyze selected"}</ToolButton>
              <ToolButton size="sm" variant="primary" disabled={!selectedCharacters.length || Boolean(busy) || metadataDirty} onClick={copyToSelected} title={metadataDirty ? "Save plan details before creating assigned copies." : undefined}><Copy className="h-3.5 w-3.5" />{busy === "copy" ? "Creating…" : "Create assigned copies"}</ToolButton>
            </div>
          </div>
          {metadataDirty ? <ToolNotice tone="warning">Save the plan details before creating copies so the name, notes, and assignment are unambiguous.</ToolNotice> : null}
          {message ? <InlineFeedback message={message} tone={messageTone} /> : null}
          <div className="overflow-x-auto border border-[#272c34]">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[minmax(180px,1fr)_115px_110px_115px_145px] border-b border-[#343943] bg-[#101219] px-2 py-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                <span>Character</span><span>Readiness</span><span>Remaining SP</span><span>Training</span><span>Completion</span>
              </div>
              {characters.map((character, index) => {
                const characterId = monitorCharacterId(character);
                const selected = selectedIds.includes(characterId);
                const result = results[characterId];
                const analysisIsCurrent = Boolean(result?.analysis && result.analysisRevision === analysisRevision);
                const readiness = analysisIsCurrent && result?.analysis ? analysisReadiness(result.analysis) : null;
                return (
                  <div key={character.id} className={`grid min-h-12 grid-cols-[minmax(180px,1fr)_115px_110px_115px_145px] items-center border-b border-[#22262e] px-2 py-1.5 text-[10px] last:border-b-0 ${selected ? "bg-[#0d1722]" : index % 2 ? "bg-[#080b11]" : "bg-[#05070b]"}`}>
                    <label className="flex min-w-0 cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={selected} disabled={Boolean(busy)} onChange={() => toggleCharacter(characterId)} />
                      <span className="min-w-0"><span className="block truncate font-semibold text-slate-200">{character.name}</span><span className="block truncate text-[9px] text-slate-600">{character.corporationName ?? "No corporation"}{plan.characterId === characterId ? " · source assignment" : ""}</span></span>
                    </label>
                    <span>
                      {result?.analysisError ? <ToolStatus tone="danger">Analysis failed</ToolStatus>
                        : busy === "analysis" && selected ? <ToolStatus tone="info">Analyzing</ToolStatus>
                          : result?.analysis && !analysisIsCurrent ? <ToolStatus tone="warning">Analysis stale</ToolStatus>
                            : readiness ? <ToolStatus tone={readiness.tone}>{readiness.label}</ToolStatus>
                              : <span className="text-slate-600">Not analyzed</span>}
                    </span>
                    <span className="font-mono text-slate-300">{analysisIsCurrent ? formatNumber(result?.analysis?.remainingSp, true) : "—"}</span>
                    <span className="font-mono text-slate-300">{analysisIsCurrent ? formatDuration(result?.analysis?.trainingSeconds, { short: true }) : "—"}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-slate-300">{analysisIsCurrent && result?.analysis?.completionAt ? formatDateTime(result.analysis.completionAt) : analysisIsCurrent && readiness?.label === "Ready" ? "Ready now" : "—"}</span>
                      {result?.analysisError ? <span className="block truncate text-[9px] text-[#ff9eaa]" title={result.analysisError}>{result.analysisError}</span> : null}
                      {analysisIsCurrent && result?.analysis?.warnings.length ? <span className="block text-[9px] text-[#e4b44c]" title={result.analysis.warnings.join("\n")}>{result.analysis.warnings.length} warning{result.analysis.warnings.length === 1 ? "" : "s"}</span> : null}
                      {result?.copiedPlan ? <button type="button" className="block text-[9px] text-[#75c9ff] hover:underline" onClick={() => onOpenPlan(result.copiedPlan!.id)}>Open assigned copy</button> : null}
                      {result?.copyError ? <span className="block truncate text-[9px] text-[#ff9eaa]" title={result.copyError}>Copy failed: {result.copyError}</span> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="text-[9px] text-slate-600">Creating copies never overwrites this source plan. Notes, sections, remap metadata, settings, entry order, and plan/entry provenance are retained.</div>
        </>
      )}
    </ToolPanel>
  );
}

function PlanEditor(props: PlansViewProps & { initialPlanId: string }) {
  const [plan, setPlan] = useState<SkillPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"success" | "warning" | "danger">("success");
  const [draftName, setDraftName] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftCharacterId, setDraftCharacterId] = useState("");
  const [skillQuery, setSkillQuery] = useState("");
  const [targetLevel, setTargetLevel] = useState(1);
  const [section, setSection] = useState("");
  const [addPrerequisites, setAddPrerequisites] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PlanAnalysis | null>(null);
  const [optimization, setOptimization] = useState<PlanOptimization | null>(null);
  const [exportFormat, setExportFormat] = useState("json");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setMessage(null);
    setAnalysis(null);
    setOptimization(null);
    void (async () => {
      try {
        const loaded = await getPlan(props.initialPlanId, controller.signal);
        if (controller.signal.aborted) return;
        setPlan(loaded);
        setDraftName(loaded.name);
        setDraftNotes(loaded.notes ?? "");
        setDraftCharacterId(loaded.characterId ?? "");

        const result = await analyzePlan({ planId: loaded.id, characterId: loaded.characterId }, controller.signal);
        if (controller.signal.aborted) return;
        setAnalysis(result);
        setPlan(mergePlanAnalysis(loaded, result));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMessage(apiErrorMessage(error));
        setMessageTone("danger");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [props.initialPlanId]);

  const selectedCatalogSkill = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    if (!query) return null;
    return props.catalog.skills.find((skill) => String(skill.skillTypeId) === query || skill.skillName.toLowerCase() === query) ?? null;
  }, [props.catalog.skills, skillQuery]);

  const suggestedSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    if (query.length < 2) return [];
    return props.catalog.skills.filter((skill) => skill.skillName.toLowerCase().includes(query) || String(skill.skillTypeId).startsWith(query)).slice(0, 8);
  }, [props.catalog.skills, skillQuery]);

  const showMessage = (value: string, tone: "success" | "warning" | "danger" = "success") => {
    setMessage(value);
    setMessageTone(tone);
  };

  const replacePlan = (updated: SkillPlan, preserveAnalysis = false) => {
    const displayPlan = preserveAnalysis && analysis ? mergePlanAnalysis(updated, analysis) : updated;
    setPlan(displayPlan);
    setDraftName(displayPlan.name);
    setDraftNotes(displayPlan.notes ?? "");
    setDraftCharacterId(displayPlan.characterId ?? "");
  };

  const saveMetadata = async () => {
    if (!plan || !draftName.trim()) return;
    setBusy("save");
    try {
      replacePlan(await patchPlan(plan.id, { name: draftName.trim(), notes: draftNotes.trim() || null, characterId: draftCharacterId || null, lockVersion: plan.lockVersion }), true);
      await props.onPlansChanged();
      showMessage("Plan details saved.");
    } catch (error) {
      showMessage(apiErrorMessage(error), "danger");
      if (error instanceof TriffMonApiError && error.status === 409) {
        try { replacePlan(await getPlan(plan.id)); setAnalysis(null); setOptimization(null); } catch { /* Keep the conflict message if reloading also fails. */ }
      }
    } finally {
      setBusy(null);
    }
  };

  const persistEntries = async (entries: SkillPlanEntry[], successMessage?: string) => {
    if (!plan) return;
    const normalized = entries.map((entry, index) => ({ ...entry, position: index }));
    setPlan({ ...plan, entries: normalized });
    setAnalysis(null);
    setOptimization(null);
    setBusy("entries");
    try {
      replacePlan(await patchPlan(plan.id, { entries: normalized, sections: plan.sections, lockVersion: plan.lockVersion }));
      if (successMessage) showMessage(successMessage);
      await props.onPlansChanged();
    } catch (error) {
      showMessage(apiErrorMessage(error), "danger");
      try { replacePlan(await getPlan(plan.id)); } catch { /* Retain the optimistic state when reloading also fails. */ }
    } finally {
      setBusy(null);
      setDraggingId(null);
    }
  };

  const moveEntry = (from: number, to: number) => {
    if (!plan || to < 0 || to >= plan.entries.length || from === to) return;
    const entries = [...plan.entries];
    const [moved] = entries.splice(from, 1);
    if (!moved) return;
    entries.splice(to, 0, moved);
    void persistEntries(entries);
  };

  const dropEntry = (targetId: string) => {
    if (!plan || !draggingId || draggingId === targetId) { setDraggingId(null); return; }
    const from = plan.entries.findIndex((entry) => entry.id === draggingId);
    const to = plan.entries.findIndex((entry) => entry.id === targetId);
    moveEntry(from, to);
  };

  const addSkill = async () => {
    if (!plan || !selectedCatalogSkill) return;
    setBusy("add");
    try {
      replacePlan(await addPlanEntry(plan.id, { skillTypeId: selectedCatalogSkill.skillTypeId, targetLevel, addPrerequisites, section: section.trim() || null }));
      setAnalysis(null);
      setOptimization(null);
      setSkillQuery("");
      showMessage(addPrerequisites ? "Skill and missing prerequisites added." : "Skill added to plan.");
      await props.onPlansChanged();
    } catch (error) {
      showMessage(apiErrorMessage(error), "danger");
    } finally {
      setBusy(null);
    }
  };

  const runAnalysis = async () => {
    if (!plan) return;
    setBusy("analysis");
    try {
      const result = await analyzePlan({ planId: plan.id, characterId: plan.characterId });
      setAnalysis(result);
      setPlan((current) => current && current.id === plan.id ? mergePlanAnalysis(current, result) : current);
      showMessage("Plan analysis refreshed.");
    } catch (error) {
      showMessage(apiErrorMessage(error), "danger");
    } finally { setBusy(null); }
  };

  const runOptimization = async () => {
    if (!plan) return;
    setBusy("optimize");
    try {
      setOptimization(await optimizePlan({ planId: plan.id, characterId: plan.characterId, maxRemaps: 2 }));
      showMessage("Attribute optimization complete.");
    } catch (error) {
      showMessage(apiErrorMessage(error), "danger");
    } finally { setBusy(null); }
  };

  const duplicate = async () => {
    if (!plan) return;
    setBusy("duplicate");
    try {
      const copy = await createPlan({ name: `${plan.name} (Copy)`, characterId: plan.characterId, notes: plan.notes, entries: plan.entries, sections: plan.sections, settings: plan.settings, sourceType: plan.sourceType, sourceMetadata: plan.sourceMetadata });
      await props.onPlansChanged();
      props.onOpenPlan(copy.id);
    } catch (error) { showMessage(apiErrorMessage(error), "danger"); }
    finally { setBusy(null); }
  };

  const removePlan = async () => {
    if (!plan || !window.confirm(`Delete “${plan.name}”? This cannot be undone.`)) return;
    setBusy("delete");
    try {
      await deletePlan(plan.id);
      await props.onPlansChanged();
      props.onOpenPlan(null);
    } catch (error) { showMessage(apiErrorMessage(error), "danger"); setBusy(null); }
  };

  const exportCurrentPlan = async () => {
    if (!plan) return;
    setBusy("export");
    try {
      const result = await exportPlan({ planId: plan.id, format: exportFormat });
      downloadExport(result);
      showMessage(`Exported ${result.filename}.`);
    } catch (error) { showMessage(apiErrorMessage(error), "danger"); }
    finally { setBusy(null); }
  };

  if (loading) return <BusyLine>Loading skill plan…</BusyLine>;
  if (!plan) return <ToolEmptyState title="Plan unavailable">The plan may have been deleted or belongs to another account.</ToolEmptyState>;

  const metadataDirty = draftName.trim() !== plan.name
    || (draftNotes.trim() || null) !== plan.notes
    || (draftCharacterId || null) !== plan.characterId;
  const sections = plan.sections.length
    ? plan.sections
    : [...new Set(plan.entries.map((entry) => entry.section).filter((value): value is string => Boolean(value)))];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 border border-[#2c2f36] bg-[#0a0d13] p-2">
        <ToolButton size="sm" variant="ghost" onClick={() => props.onOpenPlan(null)}><ArrowLeft className="h-3.5 w-3.5" />All plans</ToolButton>
        <div className="flex flex-wrap gap-1">
          <ToolButton size="sm" onClick={duplicate} disabled={Boolean(busy)}><Copy className="h-3.5 w-3.5" />Duplicate</ToolButton>
          <select aria-label="Export format" value={exportFormat} onChange={(event) => setExportFormat(event.target.value)} className="h-[26px] border px-2 text-[10px]"><option value="json">Native JSON</option><option value="evemon">EVEMon XML (.xml)</option><option value="emp">EVEMon EMP (.emp)</option><option value="epb">EVEMon EPB (.epb)</option><option value="csv">CSV</option></select>
          <ToolButton size="sm" onClick={exportCurrentPlan} disabled={Boolean(busy)}><Download className="h-3.5 w-3.5" />Export</ToolButton>
          <ToolButton size="sm" variant="danger" onClick={removePlan} disabled={Boolean(busy)}><Trash2 className="h-3.5 w-3.5" />Delete</ToolButton>
        </div>
      </div>
      <InlineFeedback message={message} tone={messageTone} />
      {plan.importWarnings.length ? <ToolPanel title="Import warnings" description="Items adjusted or skipped while converting this plan" bodyClassName="space-y-1">{plan.importWarnings.map((warning, index) => <ToolNotice key={`${index}-${warning}`} tone="warning">{warning}</ToolNotice>)}</ToolPanel> : null}
      <ToolPanel title="Plan details" actions={<ToolButton size="sm" variant="primary" onClick={saveMetadata} disabled={!draftName.trim() || Boolean(busy)}><Save className="h-3.5 w-3.5" />Save</ToolButton>}>
        <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_230px]">
          <ToolField label="Name"><input value={draftName} onChange={(event) => setDraftName(event.target.value)} className="h-9 border px-2 text-xs" /></ToolField>
          <ToolField label="Character"><select value={draftCharacterId} onChange={(event) => setDraftCharacterId(event.target.value)} className="h-9 border px-2 text-xs"><option value="">Unassigned</option>{props.characters.map((character) => <option key={character.id} value={monitorCharacterId(character)}>{character.name}</option>)}</select></ToolField>
          <ToolField label="Notes" className="md:col-span-2"><textarea value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} className="min-h-16 w-full border p-2 text-xs" placeholder="Plan goals, remap notes, or handoff details…" /></ToolField>
        </div>
      </ToolPanel>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-5"><ToolStat label="Entries" value={plan.entries.length} /><ToolStat label="Sections" value={sections.length} /><ToolStat label="Remaining SP" value={formatNumber(analysis?.remainingSp ?? plan.remainingSp, true)} /><ToolStat label="Training" value={formatDuration(analysis?.trainingSeconds ?? plan.trainingSeconds, { short: true })} /><ToolStat label="Completes" value={formatDateTime(analysis?.completionAt ?? plan.completionAt)} /></div>
      <PlanAcrossCharacters key={plan.id} plan={plan} characters={props.characters} metadataDirty={metadataDirty} onPlansChanged={props.onPlansChanged} onOpenPlan={props.onOpenPlan} />
      <ToolPanel title="Add skill target" description="Targets are canonical skill levels; prerequisites can be inserted automatically" bodyClassName="space-y-2">
        <div className="grid gap-1.5 md:grid-cols-[minmax(200px,1fr)_110px_150px_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-slate-500" />
            <input value={skillQuery} onChange={(event) => setSkillQuery(event.target.value)} className="h-8 w-full border pl-7 pr-2 text-[11px]" placeholder="Search skill catalog…" />
            {suggestedSkills.length && !selectedCatalogSkill ? <div className="absolute z-20 mt-0.5 max-h-52 w-full overflow-y-auto border border-[#3a4655] bg-[#080b10] shadow-xl">{suggestedSkills.map((skill) => <button key={skill.skillTypeId} type="button" onClick={() => setSkillQuery(skill.skillName)} className="flex w-full justify-between gap-3 border-b border-[#20242b] px-2 py-2 text-left text-[10px] hover:bg-[#14202d]"><span className="truncate text-slate-300">{skill.skillName}</span><span className="shrink-0 text-slate-600">{skill.groupName}</span></button>)}</div> : null}
          </div>
          <select aria-label="Target level" value={targetLevel} onChange={(event) => setTargetLevel(Number(event.target.value))} className="h-8 border px-2 text-[10px]">{[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>Level {level}</option>)}</select>
          <input aria-label="Plan section" value={section} onChange={(event) => setSection(event.target.value)} className="h-8 border px-2 text-[10px]" placeholder="Optional section" />
          <ToolButton size="sm" variant="primary" disabled={!selectedCatalogSkill || Boolean(busy)} onClick={addSkill}><Plus className="h-3.5 w-3.5" />Add</ToolButton>
        </div>
        <label className="inline-flex items-center gap-2 text-[10px] text-slate-400"><input type="checkbox" checked={addPrerequisites} onChange={(event) => setAddPrerequisites(event.target.checked)} />Automatically add missing prerequisites</label>
        {selectedCatalogSkill ? <div className="border-l-2 border-[#53b6ff] bg-[#0a1018] px-2 py-1.5 text-[10px] text-slate-400"><strong className="text-slate-200">{selectedCatalogSkill.skillName}</strong> · {selectedCatalogSkill.groupName} · rank {selectedCatalogSkill.rank ?? "—"} · {selectedCatalogSkill.primaryAttribute ?? "—"}/{selectedCatalogSkill.secondaryAttribute ?? "—"}{selectedCatalogSkill.prerequisites.length ? ` · ${selectedCatalogSkill.prerequisites.length} direct prerequisites` : ""}</div> : null}
      </ToolPanel>
      <ToolPanel title="Training order" description="Drag rows on desktop or use arrow controls on touch devices" actions={<div className="flex gap-1"><ToolButton size="sm" onClick={runAnalysis} disabled={!plan.entries.length || Boolean(busy)}><BarChart3 className="h-3.5 w-3.5" />Analyze</ToolButton><ToolButton size="sm" onClick={runOptimization} disabled={!plan.entries.length || Boolean(busy)}><Sparkles className="h-3.5 w-3.5" />Optimize attributes</ToolButton></div>} bodyClassName="p-0">
        {plan.entries.length === 0 ? <ToolEmptyState title="Plan is empty">Add a target skill above. Skillnix can insert its prerequisite chain.</ToolEmptyState> : (
          <div>
            <div className="hidden grid-cols-[28px_minmax(190px,1fr)_100px_115px_110px_100px] border-b border-[#343943] bg-[#101219] px-1 py-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400 md:grid"><span /><span>Skill</span><span>Target</span><span>Section</span><span>Training</span><span>Actions</span></div>
            {plan.entries.map((entry, index) => <PlanEntryRow key={entry.id} entry={entry} index={index} count={plan.entries.length} dragging={draggingId === entry.id} onDragStart={setDraggingId} onDrop={dropEntry} onMove={moveEntry} onTarget={(entryId, level) => { void persistEntries(plan.entries.map((item) => item.id === entryId ? { ...item, targetLevel: level } : item)); }} onSection={(entryId, value) => { void persistEntries(plan.entries.map((item) => item.id === entryId ? { ...item, section: value } : item)); }} onRemove={(entryId) => { void persistEntries(plan.entries.filter((item) => item.id !== entryId), "Skill removed from plan."); }} />)}
          </div>
        )}
      </ToolPanel>
      {busy === "analysis" || busy === "optimize" ? <ToolStatus tone="info">Running accurate server-side skill calculations…</ToolStatus> : null}
      <PlanAnalysisPanel analysis={analysis} optimization={optimization} />
    </div>
  );
}

export function PlansView(props: PlansViewProps) {
  if (!props.planId) return <PlansIndex {...props} />;
  return <PlanEditor {...props} initialPlanId={props.planId} />;
}
