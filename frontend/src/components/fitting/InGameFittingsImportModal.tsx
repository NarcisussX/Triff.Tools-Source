import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Search, Settings, Upload, X } from "lucide-react";
import { PyfaGuiIcon } from "./FittingIcon";
import type { AuthUser, CalculationResponse, FitMessage, FitPayload } from "./types";

type InGameFittingCharacter = {
  characterId: number;
  characterName: string;
  tokenStatus?: string | null;
  lastError?: string | null;
  lastFittingsFetchAt?: string | null;
};

type InGameFittingSummary = {
  fittingId: number;
  name: string;
  description?: string | null;
  shipTypeId: number;
  shipTypeName: string;
  shipGroupName?: string | null;
  shipCategoryName?: string | null;
  itemCount: number;
  moduleCount: number;
  droneCount: number;
  cargoCount: number;
};

type ImportedFitResponse = {
  ok: boolean;
  payload: FitPayload;
  warnings?: FitMessage[];
  errors?: FitMessage[];
  calculation?: CalculationResponse;
  inGameFitting?: InGameFittingSummary;
};

type Props = {
  open: boolean;
  authUser: AuthUser | null;
  onClose: () => void;
  onImported: (data: ImportedFitResponse) => void;
};

const buttonBase =
  "inline-flex items-center justify-center gap-1 border border-[#303236] bg-[#05070b] px-3 py-1.5 text-[10px] uppercase tracking-widest text-slate-300 hover:border-[#53b6ff]/60 hover:bg-[#101219] disabled:cursor-not-allowed disabled:opacity-50";

const rowButton =
  "inline-flex h-7 items-center justify-center border border-[#2f5367] bg-[#082033] px-2 text-[10px] uppercase tracking-widest text-[#9fddff] hover:border-[#53b6ff] hover:bg-[#0b304d] disabled:cursor-not-allowed disabled:opacity-50";

const SHIP_GROUP_ORDER = [
  "Assault Frigate",
  "Attack Battlecruiser",
  "Battleship",
  "Black Ops",
  "Blockade Runner",
  "Capital Industrial Ship",
  "Carrier",
  "Citadel",
  "Combat Battlecruiser",
  "Combat Recon Ship",
  "Command Destroyer",
  "Command Ship",
  "Corvette",
  "Covert Ops",
  "Cruiser",
  "Deep Space Transport",
  "Destroyer",
  "Dreadnought",
  "Electronic Attack Ship",
  "Engineering Complex",
  "Exhumer",
  "Expedition Frigate",
  "Flag Cruiser",
  "Force Auxiliary",
  "Force Recon Ship",
  "Freighter",
  "Frigate",
  "Hauler",
  "Heavy Assault Cruiser",
  "Heavy Interdiction Cruiser",
  "Industrial Command Ship",
  "Interceptor",
  "Interdictor",
  "Jump Freighter",
  "Lancer Dreadnought",
  "Limited Issue Ships",
  "Logistics",
  "Logistics Frigate",
  "Marauder",
  "Mining Barge",
  "Prototype Exploration Ship",
  "Refinery",
  "Shuttle",
  "Special Edition Yachts",
  "Stealth Bomber",
  "Strategic Cruiser",
  "Supercarrier",
  "Tactical Destroyer",
  "Titan",
  "Upwell Cyno Beacon",
  "Upwell Cyno Jammer",
  "Upwell Jump Gate",
];

const SHIP_GROUP_ORDER_INDEX = new Map(SHIP_GROUP_ORDER.map((name, index) => [name.toLowerCase(), index]));

function treeKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "other";
}

function isTrustedSsoOrigin(origin: string) {
  try {
    if (origin === window.location.origin) return true;
    const messageUrl = new URL(origin);
    const currentHost = window.location.hostname;
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (localHosts.has(currentHost) && localHosts.has(messageUrl.hostname)) return true;
    const triffHosts = new Set(["triff.tools", "www.triff.tools", "dev.triff.tools"]);
    return triffHosts.has(currentHost) && triffHosts.has(messageUrl.hostname);
  } catch {
    return false;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const message = typeof data === "object" && data && "message" in data
      ? String((data as { message?: string }).message || "")
      : "";
    const error = typeof data === "object" && data && "error" in data
      ? String((data as { error?: string }).error || "")
      : "";
    throw new Error(message || error || `Request failed (${response.status})`);
  }
  return data as T;
}

function eveIcon(typeId: number) {
  return `https://images.evetech.net/types/${typeId}/icon?size=64`;
}

export default function InGameFittingsImportModal({ open, authUser, onClose, onImported }: Props) {
  const [characters, setCharacters] = useState<InGameFittingCharacter[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null);
  const [fittings, setFittings] = useState<InGameFittingSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loadingCharacters, setLoadingCharacters] = useState(false);
  const [loadingFittings, setLoadingFittings] = useState(false);
  const [importingId, setImportingId] = useState<number | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [configMissing, setConfigMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [popupUrl, setPopupUrl] = useState<string | null>(null);
  const [unlinkingCharacterId, setUnlinkingCharacterId] = useState<number | null>(null);
  const [characterMenuId, setCharacterMenuId] = useState<number | null>(null);
  const [expandedFitGroups, setExpandedFitGroups] = useState<Record<string, boolean>>({});
  const authorizingKnownIds = useRef<Set<number>>(new Set());

  const selectedCharacter = characters.find((character) => character.characterId === selectedCharacterId) || null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return fittings;
    return fittings.filter((fit) => (
      fit.name.toLowerCase().includes(needle) ||
      fit.shipTypeName.toLowerCase().includes(needle)
    ));
  }, [fittings, query]);
  const groupedFittings = useMemo(() => {
    const groups = new Map<string, InGameFittingSummary[]>();
    for (const fitting of filtered) {
      const label = fitting.shipGroupName || "Other Ships";
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(fitting);
    }
    return Array.from(groups.entries())
      .map(([label, items]) => ({
        key: treeKey(label),
        label,
        items: items.slice().sort((a, b) => (
          a.shipTypeName.localeCompare(b.shipTypeName) ||
          a.name.localeCompare(b.name)
        )),
      }))
      .sort((a, b) => {
        const aOrder = SHIP_GROUP_ORDER_INDEX.get(a.label.toLowerCase());
        const bOrder = SHIP_GROUP_ORDER_INDEX.get(b.label.toLowerCase());
        if (aOrder !== undefined || bOrder !== undefined) return (aOrder ?? 9999) - (bOrder ?? 9999);
        return a.label.localeCompare(b.label);
      });
  }, [filtered]);

  async function loadCharacters(preferredCharacterId: number | null = selectedCharacterId) {
    if (!authUser) {
      setCharacters([]);
      setSelectedCharacterId(null);
      setFittings([]);
      return [];
    }
    setLoadingCharacters(true);
    setError(null);
    try {
      const data = await readJson<{
        ok: boolean;
        configured?: boolean;
        configMissing?: string[];
        characters: InGameFittingCharacter[];
      }>(await fetch("/api/in-game-fitting/esi/characters", { credentials: "include" }));
      const nextCharacters = data.characters || [];
      setConfigured(data.configured !== false);
      setConfigMissing(data.configMissing || []);
      setCharacters(nextCharacters);
      const preferred = preferredCharacterId
        ? nextCharacters.find((character) => Number(character.characterId) === Number(preferredCharacterId))
        : null;
      const nextSelected = preferred || nextCharacters[0] || null;
      setSelectedCharacterId(nextSelected?.characterId || null);
      if (!nextSelected) setFittings([]);
      return nextCharacters;
    } catch (err) {
      setError((err as Error).message || "Unable to load authorized characters.");
      setCharacters([]);
      setFittings([]);
      return [];
    } finally {
      setLoadingCharacters(false);
    }
  }

  async function loadFittings(characterId = selectedCharacterId) {
    if (!authUser || !characterId) {
      setFittings([]);
      return;
    }
    setLoadingFittings(true);
    setError(null);
    try {
      const data = await readJson<{
        ok: boolean;
        fittings: InGameFittingSummary[];
      }>(await fetch(`/api/in-game-fitting/esi/characters/${encodeURIComponent(characterId)}/fittings`, { credentials: "include" }));
      setFittings(data.fittings || []);
    } catch (err) {
      setError((err as Error).message || "Unable to fetch in-game fittings.");
      setFittings([]);
    } finally {
      setLoadingFittings(false);
    }
  }

  async function authorizeFittings() {
    if (!authUser) {
      setError("Sign in to triff.tools before authorizing in-game fitting import.");
      return;
    }
    setAuthorizing(true);
    authorizingKnownIds.current = new Set(characters.map((character) => Number(character.characterId)));
    setPopupUrl(null);
    setError(null);
    const popup = window.open("/api/in-game-fitting/esi/login", "triff-eve-fittings-sso", "width=720,height=860");
    if (!popup) {
      try {
        const data = await readJson<{ ok: boolean; url: string }>(await fetch("/api/in-game-fitting/esi/login-url", { credentials: "include" }));
        setPopupUrl(data.url);
        setError("Popup was blocked. Use the Open EVE SSO button below.");
      } catch (err) {
        setError((err as Error).message || "Unable to start EVE SSO.");
      } finally {
        setAuthorizing(false);
      }
      return;
    }
    setError("Waiting for EVE SSO authorization...");
  }

  async function importFitting(fitting: InGameFittingSummary) {
    if (!selectedCharacterId) return;
    setImportingId(fitting.fittingId);
    setError(null);
    try {
      const data = await readJson<ImportedFitResponse>(
        await fetch(`/api/in-game-fitting/esi/characters/${encodeURIComponent(selectedCharacterId)}/fittings/${encodeURIComponent(fitting.fittingId)}/import`, {
          method: "POST",
          credentials: "include",
        })
      );
      onImported(data);
    } catch (err) {
      setError((err as Error).message || "Unable to import in-game fitting.");
    } finally {
      setImportingId(null);
    }
  }

  async function refreshCharacterFittings(character: InGameFittingCharacter) {
    setCharacterMenuId(null);
    setSelectedCharacterId(character.characterId);
    await loadFittings(character.characterId);
  }

  async function unlinkCharacter(character: InGameFittingCharacter) {
    setCharacterMenuId(null);
    const ok = window.confirm(
      `Unlink ${character.characterName} from in-game fitting import?\n\nThis only removes the esi-fittings.read_fittings.v1 authorization. Skill profiles are not changed.`
    );
    if (!ok) return;
    setUnlinkingCharacterId(character.characterId);
    setError(null);
    try {
      await readJson<{ ok: boolean }>(
        await fetch(`/api/in-game-fitting/esi/characters/${encodeURIComponent(character.characterId)}`, {
          method: "DELETE",
          credentials: "include",
        })
      );
      await loadCharacters(character.characterId === selectedCharacterId ? null : selectedCharacterId);
      setError(`Unlinked in-game fitting access for ${character.characterName}.`);
    } catch (err) {
      setError((err as Error).message || "Unable to unlink character.");
    } finally {
      setUnlinkingCharacterId(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    void loadCharacters();
  }, [open, authUser?.id]);

  useEffect(() => {
    if (!open) {
      setCharacterMenuId(null);
      setExpandedFitGroups({});
    }
  }, [open]);

  useEffect(() => {
    if (!open || !selectedCharacterId) return;
    void loadFittings(selectedCharacterId);
  }, [open, selectedCharacterId]);

  useEffect(() => {
    if (!open) return;
    function handleMessage(event: MessageEvent) {
      if (!isTrustedSsoOrigin(event.origin)) return;
      const data = event.data || {};
      if (data.type !== "TRIFF_IN_GAME_FITTINGS_SSO_COMPLETE") return;
      setAuthorizing(false);
      if (data.ok) {
        setError(`Authorized in-game fittings for ${data.characterName || "character"}.`);
        authorizingKnownIds.current = new Set();
        void loadCharacters(Number(data.characterId) || null);
      } else {
        setError(data.message || "EVE SSO authorization failed.");
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [open, authUser?.id, selectedCharacterId]);

  useEffect(() => {
    if (!authorizing || !open || !authUser) return;
    let stopped = false;
    let attempts = 0;
    async function pollCharacters() {
      attempts += 1;
      const nextCharacters = await loadCharacters();
      if (stopped) return;
      const newlyAuthorized = nextCharacters.find((character) => !authorizingKnownIds.current.has(Number(character.characterId)));
      if (newlyAuthorized) {
        setAuthorizing(false);
        authorizingKnownIds.current = new Set();
        setSelectedCharacterId(newlyAuthorized.characterId);
      } else if (attempts >= 45) {
        setAuthorizing(false);
        setError("EVE SSO is still pending. Try Refresh characters if it completed.");
      }
    }
    const first = window.setTimeout(() => void pollCharacters(), 1200);
    const timer = window.setInterval(() => void pollCharacters(), 2500);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [authorizing, open, authUser?.id]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/75 px-3 py-3">
      <div className="flex h-[calc(100dvh-32px)] max-h-[780px] w-[calc(100vw-24px)] max-w-5xl flex-col overflow-hidden border border-[#3a3c40] bg-[#05070b] shadow-[0_0_24px_rgba(0,0,0,0.9)]">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#3a3c40] bg-[#101219] px-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-300">Import In-Game Fits</div>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-300 hover:border-red-400/70 hover:text-red-200"
            onClick={onClose}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r border-[#252a33] bg-[#070910] p-3">
            <div className="mb-3 text-[10px] uppercase tracking-widest text-[#7f91a8]">Second-layer ESI access</div>
            <p className="mb-3 text-[11px] leading-5 text-slate-400">
              This asks only for <span className="font-mono text-[#9fddff]">esi-fittings.read_fittings.v1</span>. Imported fits open as unsaved workspace tabs.
            </p>
            {!authUser && (
              <div className="mb-3 border border-[#6b4b1e] bg-[#1a1206] px-2 py-2 text-[11px] text-[#ffd596]">
                Sign in from the site header before importing in-game fits.
              </div>
            )}
            {configured ? null : (
              <div className="mb-3 border border-[#6b2b32] bg-[#1d090b] px-2 py-2 text-[11px] text-[#ffaaaa]">
                Fitting SSO is not configured: {configMissing.join(", ") || "missing env vars"}.
              </div>
            )}
            <button type="button" className={`${buttonBase} w-full`} onClick={authorizeFittings} disabled={!authUser || !configured || authorizing}>
              {authorizing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Authorize Character
            </button>
            {popupUrl && (
              <a className={`${buttonBase} mt-2 w-full`} href={popupUrl} target="_blank" rel="noreferrer">
                Open EVE SSO
              </a>
            )}
            <button type="button" className={`${buttonBase} mt-2 w-full`} onClick={() => void loadCharacters()} disabled={!authUser || loadingCharacters}>
              {loadingCharacters ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh Characters
            </button>
            <div className="mt-4 text-[10px] uppercase tracking-widest text-[#7f91a8]">Characters</div>
            <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {characters.map((character) => (
                <div
                  key={character.characterId}
                  className={`relative grid grid-cols-[minmax(0,1fr)_auto] items-stretch border ${character.characterId === selectedCharacterId ? "border-[#1d76ad] bg-[#0b1723]" : "border-[#252a33] bg-[#05070b] hover:border-[#3b5b70]"}`}
                >
                  <button
                    type="button"
                    className="min-w-0 px-2 py-2 text-left"
                    onClick={() => setSelectedCharacterId(character.characterId)}
                  >
                    <div className="truncate text-[11px] font-semibold text-slate-100">{character.characterName}</div>
                    <div className="mt-0.5 truncate text-[10px] text-slate-500">{character.tokenStatus || "ok"}</div>
                  </button>
                  <button
                    type="button"
                    className="flex w-8 items-center justify-center border-l border-[#252a33] text-slate-500 hover:bg-[#101721] hover:text-[#9fddff] disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => setCharacterMenuId((current) => (current === character.characterId ? null : character.characterId))}
                    disabled={unlinkingCharacterId === character.characterId}
                    title={`Manage ${character.characterName}`}
                    aria-label={`Manage ${character.characterName}`}
                  >
                    {unlinkingCharacterId === character.characterId ? <Loader2 size={13} className="animate-spin" /> : <Settings size={13} />}
                  </button>
                  {characterMenuId === character.characterId && (
                    <div className="absolute right-0 top-[calc(100%+2px)] z-20 w-36 border border-[#303236] bg-[#05070b] shadow-[0_8px_20px_rgba(0,0,0,0.75)]">
                      <button
                        type="button"
                        className="flex h-7 w-full items-center gap-2 border-b border-[#171d27] px-2 text-left text-[10px] uppercase tracking-widest text-slate-300 hover:bg-[#101721] hover:text-[#9fddff]"
                        onClick={() => void refreshCharacterFittings(character)}
                        disabled={loadingFittings}
                      >
                        <RefreshCw size={12} />
                        Refresh fits
                      </button>
                      <button
                        type="button"
                        className="flex h-7 w-full items-center gap-2 px-2 text-left text-[10px] uppercase tracking-widest text-[#ffb4bd] hover:bg-[#1d090b]"
                        onClick={() => void unlinkCharacter(character)}
                      >
                        <X size={12} />
                        Unlink
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!characters.length && (
                <div className="border border-[#252a33] px-2 py-2 text-[11px] text-slate-500">
                  {loadingCharacters ? "Loading characters..." : "No characters authorized for fitting import yet."}
                </div>
              )}
            </div>
          </aside>
          <main className="flex min-h-0 flex-col p-3">
            <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <label className="flex h-8 items-center gap-2 border border-[#303236] bg-[#030509] px-2">
                <Search size={13} className="text-slate-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-[11px] text-slate-100 outline-none placeholder:text-slate-600"
                  placeholder="Search in-game fits or ships..."
                />
              </label>
              <button
                type="button"
                className={buttonBase}
                onClick={() => void loadFittings()}
                disabled={!selectedCharacterId || loadingFittings}
              >
                {loadingFittings ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Refresh Fits
              </button>
            </div>
            {error && (
              <div className={`mb-3 border px-2 py-1.5 text-[11px] ${/authorized|waiting/i.test(error) ? "border-[#1d76ad]/70 bg-[#07111a] text-[#9fddff]" : "border-[#6b2b32] bg-[#1d090b] text-[#ffaaaa]"}`}>
                {error}
              </div>
            )}
            <div className="mb-2 flex items-center justify-between border-b border-[#252a33] pb-1">
              <div className="text-[10px] uppercase tracking-widest text-[#7f91a8]">
                {selectedCharacter ? `${selectedCharacter.characterName}'s in-game fits` : "In-game fits"}
              </div>
              <div className="text-[10px] text-slate-500">{filtered.length.toLocaleString()} / {fittings.length.toLocaleString()}</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto border border-[#252a33]">
              {loadingFittings ? (
                <div className="flex h-full items-center justify-center gap-2 text-[11px] text-slate-500">
                  <Loader2 size={14} className="animate-spin" />
                  Loading in-game fits...
                </div>
              ) : filtered.length ? (
                <div>
                  {groupedFittings.map((group) => {
                    const isOpen = query.trim().length > 0 || !!expandedFitGroups[group.key];
                    return (
                      <section key={group.key} className="border-b border-[#151922]">
                        <button
                          type="button"
                          className={`flex h-6 w-full items-center gap-1.5 px-1.5 text-left text-[11px] ${
                            isOpen ? "bg-[#111923] text-slate-100" : "text-slate-400 hover:bg-[#0d1118]"
                          }`}
                          onClick={() => setExpandedFitGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                        >
                          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          <PyfaGuiIcon name="ship" label="Ship group" className="h-4 w-4" />
                          <span className="min-w-0 flex-1 truncate">{group.label}</span>
                          <span className="pr-1 text-right font-mono text-[10px] text-slate-600">{group.items.length}</span>
                        </button>
                        {isOpen && (
                          <div className="divide-y divide-[#171d27] border-t border-[#151922] bg-[#05070b]">
                            {group.items.map((fitting) => (
                              <div key={fitting.fittingId} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 hover:bg-[#0b1018]">
                                <img src={eveIcon(fitting.shipTypeId)} alt="" className="h-8 w-8 border border-[#303236] bg-black object-cover" />
                                <div className="min-w-0">
                                  <div className="truncate text-[11px] font-semibold text-slate-100">{fitting.name}</div>
                                  <div className="mt-0.5 truncate text-[10px] text-[#7f91a8]">
                                    {fitting.shipTypeName} - {fitting.moduleCount} modules - {fitting.droneCount} drones - {fitting.cargoCount} cargo
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className={rowButton}
                                  disabled={importingId === fitting.fittingId}
                                  onClick={() => void importFitting(fitting)}
                                >
                                  {importingId === fitting.fittingId ? <Loader2 size={13} className="animate-spin" /> : null}
                                  Open
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-[11px] leading-5 text-slate-500">
                  {selectedCharacterId ? "No in-game fits found for this character." : "Authorize a character to list in-game saved fittings."}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>,
    document.body
  );
}
