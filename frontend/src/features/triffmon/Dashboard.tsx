import { useMemo, useState } from "react";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Eye,
  EyeOff,
  LayoutGrid,
  List,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Unlink,
} from "lucide-react";
import { ToolButton, ToolEmptyState, ToolPanel, ToolStat } from "../../components/tool-ui";
import type { CharacterPreference, QueueHealth, TriffMonCharacter } from "./types";
import { CharacterPortrait, InlineFeedback, ProgressBar, QueueStatus } from "./shared";
import {
  formatDateTime,
  formatDuration,
  formatIsk,
  formatNumber,
  freshnessLabel,
  healthTone,
  liveQueueHealth,
  liveTrainingItem,
  monitorCharacterId,
  safeLocalStorageGet,
  safeLocalStorageSet,
  secondsUntil,
  trainingProgress,
} from "./utils";

type SortKey = "name" | "sp" | "remaining" | "queueEnd" | "updated";
type GroupKey = "none" | "corporation" | "alliance" | "custom";
type ViewMode = "table" | "cards";
type Visibility = "visible" | "all" | "hidden";
type HealthFilter = "all" | "attention" | QueueHealth;

type DashboardProps = {
  characters: TriffMonCharacter[];
  now: number;
  loading: boolean;
  error: string | null;
  busyCharacterId: string | null;
  onOpenCharacter: (characterId: string, tab: "skills" | "queue") => void;
  onPreference: (characterId: string, patch: Partial<CharacterPreference>) => void;
  onSync: (characterId: string) => void;
  onUnlink: (character: TriffMonCharacter) => void;
  onLink: () => void;
  onReload: () => void;
};

const VIEW_KEY = "triffmon.dashboard.view";
const GROUP_KEY = "triffmon.dashboard.group";

function remainingSeconds(character: TriffMonCharacter, now: number): number | null {
  return secondsUntil(character.currentTraining?.endAt ?? character.queueEndAt, now);
}

function compareNullable(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function groupName(character: TriffMonCharacter, group: GroupKey): string {
  if (character.pinned) return "Pinned";
  if (group === "corporation") return character.corporationName ?? "No corporation";
  if (group === "alliance") return character.allianceName ?? "No alliance";
  if (group === "custom") return character.group ?? "Ungrouped";
  return "Characters";
}

function SummaryStrip({ characters }: { characters: TriffMonCharacter[] }) {
  const visible = characters.filter((character) => !character.hidden);
  const count = (health: QueueHealth) => visible.filter((character) => character.queueHealth === health).length;
  const warningCount = count("warning") + count("gap") + count("paused");
  return (
    <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-6">
      <ToolStat label="Visible" value={formatNumber(visible.length)} />
      <ToolStat label="Healthy" value={formatNumber(count("healthy"))} className="border-l-2 border-l-[#45cf78]" />
      <ToolStat label="Warning / gap" value={formatNumber(warningCount)} className="border-l-2 border-l-[#e4b44c]" />
      <ToolStat label="Critical" value={formatNumber(count("critical"))} className="border-l-2 border-l-[#ff6978]" />
      <ToolStat label="Empty" value={formatNumber(count("empty"))} className="border-l-2 border-l-[#53b6ff]" />
      <ToolStat label="Hidden" value={formatNumber(characters.length - visible.length)} />
    </div>
  );
}

function RowActions({ character, busy, onPreference, onSync, onUnlink }: {
  character: TriffMonCharacter;
  busy: boolean;
  onPreference: DashboardProps["onPreference"];
  onSync: DashboardProps["onSync"];
  onUnlink: DashboardProps["onUnlink"];
}) {
  const characterId = monitorCharacterId(character);
  return (
    <div className="flex items-center justify-end gap-0.5">
      <button type="button" className="tt2-touch-target grid h-7 w-7 place-items-center text-slate-400 hover:bg-[#15202d] hover:text-[#8bd3ff]" onClick={() => onPreference(characterId, { pinned: !character.pinned })} aria-label={character.pinned ? `Unpin ${character.name}` : `Pin ${character.name}`}>
        {character.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
      </button>
      <button type="button" className="tt2-touch-target grid h-7 w-7 place-items-center text-slate-400 hover:bg-[#15202d] hover:text-[#8bd3ff]" onClick={() => onPreference(characterId, { hidden: !character.hidden })} aria-label={character.hidden ? `Show ${character.name}` : `Hide ${character.name}`}>
        {character.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>
      <button type="button" disabled={busy} className="tt2-touch-target grid h-7 w-7 place-items-center text-slate-400 hover:bg-[#15202d] hover:text-[#8bd3ff] disabled:opacity-40" onClick={() => onSync(characterId)} aria-label={`Sync ${character.name}`}>
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`} />
      </button>
      <button type="button" className="tt2-touch-target grid h-7 w-7 place-items-center text-slate-500 hover:bg-[#2a1015] hover:text-[#ff9eaa]" onClick={() => onUnlink(character)} aria-label={`Unlink ${character.name}`}>
        <Unlink className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function CharacterTable({ characters, now, group, busyCharacterId, onOpenCharacter, onPreference, onSync, onUnlink }: {
  characters: TriffMonCharacter[];
  now: number;
  group: GroupKey;
  busyCharacterId: string | null;
  onOpenCharacter: DashboardProps["onOpenCharacter"];
  onPreference: DashboardProps["onPreference"];
  onSync: DashboardProps["onSync"];
  onUnlink: DashboardProps["onUnlink"];
}) {
  return (
    <div className="overflow-x-auto border border-[#2c2f36]">
      <table className="tt2-table w-full min-w-[1120px] border-collapse text-left text-[10px]">
        <thead className="sticky top-0 z-10 bg-[#101219]">
          <tr className="border-b border-[#343943]">
            <th className="w-[250px] px-2 py-2">Character</th>
            {group === "custom" ? <th className="w-32 px-2 py-2">Group</th> : null}
            <th className="w-28 px-2 py-2 text-right">Skillpoints</th>
            <th className="min-w-[250px] px-2 py-2">Training</th>
            <th className="w-24 px-2 py-2">Remaining</th>
            <th className="w-28 px-2 py-2">Queue</th>
            <th className="w-28 px-2 py-2 text-right">Wallet</th>
            <th className="w-24 px-2 py-2">Updated</th>
            <th className="w-28 px-2 py-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {characters.map((character, index) => {
            const progress = trainingProgress(character.currentTraining, now);
            const remaining = remainingSeconds(character, now);
            return (
              <tr key={character.id} className={`border-b border-[#22262e] ${index % 2 ? "bg-[#080b11]" : "bg-[#05070b]"} hover:bg-[#0d1520]`}>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <CharacterPortrait character={character} size="sm" />
                    <div className="min-w-0">
                      <button type="button" className="block max-w-[190px] truncate text-left text-[11px] font-semibold text-slate-100 hover:text-[#74c8ff]" onClick={() => onOpenCharacter(monitorCharacterId(character), "skills")}>{character.name}</button>
                      <div className="max-w-[190px] truncate text-[9px] text-slate-500">{character.corporationName ?? "Corporation unavailable"}{character.allianceName ? ` · ${character.allianceName}` : ""}</div>
                    </div>
                  </div>
                </td>
                {group === "custom" ? (
                  <td className="px-2 py-1.5">
                    <input
                      aria-label={`Custom group for ${character.name}`}
                      className="h-7 w-full border px-1.5 text-[10px]"
                      defaultValue={character.group ?? ""}
                      placeholder="Ungrouped"
                      onBlur={(event) => {
                        const value = event.currentTarget.value.trim() || null;
                        if (value !== character.group) onPreference(monitorCharacterId(character), { group: value });
                      }}
                    />
                  </td>
                ) : null}
                <td className="px-2 py-1.5 text-right font-mono text-[11px] text-slate-300">
                  <div>{formatNumber(character.totalSp, true)}</div>
                  {character.unallocatedSp ? <div className="text-[9px] text-[#e4b44c]">+{formatNumber(character.unallocatedSp, true)} free</div> : null}
                </td>
                <td className="px-2 py-1.5">
                  {character.currentTraining ? (
                    <button type="button" className="block w-full text-left" onClick={() => onOpenCharacter(monitorCharacterId(character), "queue")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] text-slate-200">{character.currentTraining.skillName} {character.currentTraining.targetLevel ? `→ ${character.currentTraining.targetLevel}` : ""}</span>
                        <span className="shrink-0 font-mono text-[9px] text-slate-500">{Math.round(progress * 100)}%</span>
                      </div>
                      <div className="mt-1"><ProgressBar value={progress} compact tone={healthTone(character.queueHealth)} /></div>
                    </button>
                  ) : <span className="text-slate-600">No active training</span>}
                </td>
                <td className="px-2 py-1.5 font-mono text-[10px] text-slate-300">{formatDuration(remaining, { short: true })}</td>
                <td className="px-2 py-1.5">
                  <QueueStatus health={character.queueHealth} />
                  <div className="mt-0.5 text-[9px] text-slate-500">{character.queueLength} entries · {formatDateTime(character.queueEndAt)}</div>
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-[10px] text-slate-400">{formatIsk(character.walletBalance)}</td>
                <td className="px-2 py-1.5">
                  <div className={character.stale ? "text-[#e4b44c]" : "text-slate-400"}>{freshnessLabel(character.lastUpdatedAt, now)}</div>
                  <div className="mt-0.5 truncate text-[9px] text-slate-600">{character.tokenStatus}</div>
                </td>
                <td className="px-2 py-1.5"><RowActions character={character} busy={busyCharacterId === monitorCharacterId(character)} onPreference={onPreference} onSync={onSync} onUnlink={onUnlink} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CharacterCards({ characters, now, group, busyCharacterId, onOpenCharacter, onPreference, onSync, onUnlink }: {
  characters: TriffMonCharacter[];
  now: number;
  group: GroupKey;
  busyCharacterId: string | null;
  onOpenCharacter: DashboardProps["onOpenCharacter"];
  onPreference: DashboardProps["onPreference"];
  onSync: DashboardProps["onSync"];
  onUnlink: DashboardProps["onUnlink"];
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
      {characters.map((character) => {
        const remaining = remainingSeconds(character, now);
        const progress = trainingProgress(character.currentTraining, now);
        return (
          <article key={character.id} className="border border-[#30343d] bg-[#070a0f] p-2 hover:border-[#44576d]">
            <div className="flex items-start gap-2">
              <CharacterPortrait character={character} />
              <div className="min-w-0 flex-1">
                <button type="button" className="block max-w-full truncate text-left text-xs font-semibold text-slate-100 hover:text-[#74c8ff]" onClick={() => onOpenCharacter(monitorCharacterId(character), "skills")}>{character.name}</button>
                <div className="truncate text-[9px] text-slate-500">{character.corporationName ?? "Corporation unavailable"}</div>
                <div className="mt-1"><QueueStatus health={character.queueHealth} /></div>
              </div>
              <RowActions character={character} busy={busyCharacterId === monitorCharacterId(character)} onPreference={onPreference} onSync={onSync} onUnlink={onUnlink} />
            </div>
            {group === "custom" ? (
              <input
                aria-label={`Custom group for ${character.name}`}
                className="mt-2 h-8 w-full border px-2 text-[10px]"
                defaultValue={character.group ?? ""}
                placeholder="Custom group"
                onBlur={(event) => {
                  const value = event.currentTarget.value.trim() || null;
                  if (value !== character.group) onPreference(monitorCharacterId(character), { group: value });
                }}
              />
            ) : null}
            <button type="button" className="mt-2 block w-full border-y border-[#20252d] py-2 text-left" onClick={() => onOpenCharacter(monitorCharacterId(character), "queue")}>
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-[11px] text-slate-200">{character.currentTraining?.skillName ?? "No active training"}</span>
                <span className="shrink-0 font-mono text-[10px] text-slate-400">{formatDuration(remaining, { short: true })}</span>
              </div>
              <div className="mt-1.5"><ProgressBar value={progress} compact tone={healthTone(character.queueHealth)} /></div>
            </button>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[9px] text-slate-500">
              <div><span className="block uppercase tracking-wider">SP</span><span className="font-mono text-[10px] text-slate-300">{formatNumber(character.totalSp, true)}</span></div>
              <div><span className="block uppercase tracking-wider">Queue end</span><span className="font-mono text-[10px] text-slate-300">{formatDateTime(character.queueEndAt)}</span></div>
              <div><span className="block uppercase tracking-wider">Updated</span><span className={character.stale ? "font-mono text-[10px] text-[#e4b44c]" : "font-mono text-[10px] text-slate-300"}>{freshnessLabel(character.lastUpdatedAt, now)}</span></div>
            </div>
            {character.error ? <div className="mt-2 truncate border-l-2 border-[#ff6978] pl-2 text-[9px] text-[#ff9eaa]" title={character.error}>{character.error}</div> : null}
          </article>
        );
      })}
    </div>
  );
}

export function Dashboard(props: DashboardProps) {
  const [search, setSearch] = useState("");
  const [health, setHealth] = useState<HealthFilter>("all");
  const [visibility, setVisibility] = useState<Visibility>("visible");
  const [sort, setSort] = useState<SortKey>("remaining");
  const [descending, setDescending] = useState(false);
  const [group, setGroup] = useState<GroupKey>(() => safeLocalStorageGet(GROUP_KEY, ["none", "corporation", "alliance", "custom"] as const, "none"));
  const [view, setView] = useState<ViewMode>(() => safeLocalStorageGet(VIEW_KEY, ["table", "cards"] as const, "table"));

  const liveCharacters = useMemo(() => props.characters.map((character) => ({
    ...character,
    currentTraining: liveTrainingItem(character, props.now),
    queueHealth: liveQueueHealth(character, props.now),
  })), [props.characters, props.now]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return liveCharacters
      .filter((character) => visibility === "all" || (visibility === "hidden" ? character.hidden : !character.hidden))
      .filter((character) => health === "all" || (health === "attention" ? character.queueHealth !== "healthy" : character.queueHealth === health))
      .filter((character) => !query || [character.name, character.corporationName, character.allianceName, character.group, character.currentTraining?.skillName].some((value) => value?.toLowerCase().includes(query)))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        let compared = 0;
        if (sort === "name") compared = a.name.localeCompare(b.name);
        if (sort === "sp") compared = compareNullable(a.totalSp, b.totalSp);
        if (sort === "remaining") compared = compareNullable(remainingSeconds(a, props.now), remainingSeconds(b, props.now));
        if (sort === "queueEnd") compared = compareNullable(a.queueEndAt ? new Date(a.queueEndAt).getTime() : null, b.queueEndAt ? new Date(b.queueEndAt).getTime() : null);
        if (sort === "updated") compared = compareNullable(a.lastUpdatedAt ? new Date(a.lastUpdatedAt).getTime() : null, b.lastUpdatedAt ? new Date(b.lastUpdatedAt).getTime() : null);
        return descending ? -compared : compared;
      });
  }, [descending, health, liveCharacters, props.now, search, sort, visibility]);

  const groups = useMemo(() => {
    const result = new Map<string, TriffMonCharacter[]>();
    filtered.forEach((character) => {
      const name = groupName(character, group);
      const values = result.get(name) ?? [];
      values.push(character);
      result.set(name, values);
    });
    return [...result.entries()];
  }, [filtered, group]);

  const setGroupAndStore = (value: GroupKey) => {
    setGroup(value);
    safeLocalStorageSet(GROUP_KEY, value);
  };
  const setViewAndStore = (value: ViewMode) => {
    setView(value);
    safeLocalStorageSet(VIEW_KEY, value);
  };

  return (
    <div className="space-y-2">
      <SummaryStrip characters={liveCharacters} />
      <InlineFeedback message={props.error} tone="danger" />
      <ToolPanel
        title="Character monitor"
        description={`${filtered.length} of ${props.characters.length} linked characters`}
        actions={<ToolButton size="sm" onClick={props.onReload} disabled={props.loading}><RefreshCw className={`h-3.5 w-3.5 ${props.loading ? "animate-spin motion-reduce:animate-none" : ""}`} />Reload</ToolButton>}
        bodyClassName="space-y-2"
      >
        <div className="grid gap-1.5 md:grid-cols-[minmax(180px,1fr)_130px_130px_140px_130px_auto]">
          <label className="relative block">
            <span className="sr-only">Search characters</span>
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="h-8 w-full border pl-7 pr-2 text-[11px]" placeholder="Search characters, corps, skills…" />
          </label>
          <select aria-label="Queue health filter" value={health} onChange={(event) => setHealth(event.target.value as HealthFilter)} className="h-8 border px-2 text-[10px]">
            <option value="all">All queue states</option><option value="attention">Needs attention</option><option value="healthy">Healthy</option><option value="warning">Warning</option><option value="critical">Critical</option><option value="gap">Training gap</option><option value="paused">Paused</option><option value="empty">Empty</option><option value="error">Error</option>
          </select>
          <select aria-label="Character visibility" value={visibility} onChange={(event) => setVisibility(event.target.value as Visibility)} className="h-8 border px-2 text-[10px]">
            <option value="visible">Visible only</option><option value="all">Visible + hidden</option><option value="hidden">Hidden only</option>
          </select>
          <select aria-label="Group characters" value={group} onChange={(event) => setGroupAndStore(event.target.value as GroupKey)} className="h-8 border px-2 text-[10px]">
            <option value="none">No grouping</option><option value="corporation">Group by corp</option><option value="alliance">Group by alliance</option><option value="custom">Custom groups</option>
          </select>
          <div className="flex">
            <select aria-label="Sort characters" value={sort} onChange={(event) => setSort(event.target.value as SortKey)} className="h-8 min-w-0 flex-1 border px-2 text-[10px]">
              <option value="remaining">Time remaining</option><option value="queueEnd">Queue end</option><option value="name">Name</option><option value="sp">Skillpoints</option><option value="updated">Last update</option>
            </select>
            <button type="button" className="tt2-touch-target grid h-8 w-8 place-items-center border border-l-0 border-[#3a4655] bg-[#0c1119] text-slate-400" onClick={() => setDescending((value) => !value)} aria-label={descending ? "Sort ascending" : "Sort descending"}>
              {descending ? <ArrowDownAZ className="h-4 w-4" /> : <ArrowUpAZ className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex border border-[#3a4655] bg-[#0c1119]">
            <button type="button" aria-label="Table view" aria-pressed={view === "table"} className={`tt2-touch-target grid h-[30px] w-9 place-items-center ${view === "table" ? "bg-[#18334a] text-[#8bd3ff]" : "text-slate-500"}`} onClick={() => setViewAndStore("table")}><List className="h-4 w-4" /></button>
            <button type="button" aria-label="Card view" aria-pressed={view === "cards"} className={`tt2-touch-target grid h-[30px] w-9 place-items-center ${view === "cards" ? "bg-[#18334a] text-[#8bd3ff]" : "text-slate-500"}`} onClick={() => setViewAndStore("cards")}><LayoutGrid className="h-4 w-4" /></button>
          </div>
        </div>

        {props.loading && props.characters.length === 0 ? (
          <div className="space-y-1" aria-label="Loading characters">{[0, 1, 2, 3].map((key) => <div key={key} className="h-12 animate-pulse border border-[#242830] bg-[#0b0e14] motion-reduce:animate-none" />)}</div>
        ) : props.characters.length === 0 ? (
          <ToolEmptyState title="No linked characters"><span>Link an EVE character to start monitoring skills and queues.</span><div className="mt-3"><ToolButton variant="primary" onClick={props.onLink}>Link EVE character</ToolButton></div></ToolEmptyState>
        ) : filtered.length === 0 ? (
          <ToolEmptyState title="No matching characters">Try a different search, queue state, or visibility filter.</ToolEmptyState>
        ) : (
          <div className="space-y-2">
            {groups.map(([name, characters]) => (
              <section key={name} aria-label={name}>
                {(group !== "none" || name === "Pinned") ? <div className="mb-1 flex items-center gap-2 border-b border-[#2a2e36] pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400"><span>{name}</span><span className="font-mono text-[9px] text-slate-600">{characters.length}</span></div> : null}
                {view === "cards" ? (
                  <CharacterCards characters={characters} now={props.now} group={group} busyCharacterId={props.busyCharacterId} onOpenCharacter={props.onOpenCharacter} onPreference={props.onPreference} onSync={props.onSync} onUnlink={props.onUnlink} />
                ) : (
                  <>
                    <div className="hidden md:block"><CharacterTable characters={characters} now={props.now} group={group} busyCharacterId={props.busyCharacterId} onOpenCharacter={props.onOpenCharacter} onPreference={props.onPreference} onSync={props.onSync} onUnlink={props.onUnlink} /></div>
                    <div className="md:hidden"><CharacterCards characters={characters} now={props.now} group={group} busyCharacterId={props.busyCharacterId} onOpenCharacter={props.onOpenCharacter} onPreference={props.onPreference} onSync={props.onSync} onUnlink={props.onUnlink} /></div>
                  </>
                )}
              </section>
            ))}
          </div>
        )}
      </ToolPanel>
    </div>
  );
}
