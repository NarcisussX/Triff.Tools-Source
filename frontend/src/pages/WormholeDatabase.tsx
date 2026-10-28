/*
 * React page for /wormholes.
 * Uses local component state, browser APIs, and Triff.Tools backend endpoints to render the page workflow.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { Bookmark, Filter, Plus, Search, Tag, Trash2, X } from "lucide-react";
import {
  type WormholeBookmarkRecord,
  WormholeDetails,
  WormholeModal,
  type Planet,
  type WormholeSystem,
  classColorFor,
  isA0System,
  isShatteredSystem,
  planetTypeLabel,
  sortStatics,
  staticDestinationForCode,
  systemClassLabel,
} from "../components/WormholeModal";
import {
  requestSiteAuthModal,
  SITE_AUTH_CHANGED_EVENT,
  type SiteAuthChangeDetail,
} from "../auth/siteAuthEvents";
import type { AuthUser } from "../components/fitting/types";

type Filters = {
  classes: string[];
  statics: string[];
  planets: string[];
  effects: string[];
  a0: boolean;
  shattered: "all" | "only" | "none";
};

type SystemRow = {
  system: WormholeSystem;
  planetCount: number;
  moonCount: number;
  staticDestinations: string[];
};

type BookmarkTagDefinition = {
  tag: string;
  color: string;
};

const emptyFilters: Filters = {
  classes: [],
  statics: [],
  planets: [],
  effects: [],
  a0: false,
  shattered: "all",
};

const classMap: Record<string, string> = {
  c1: "1",
  c2: "2",
  c3: "3",
  c4: "4",
  c5: "5",
  c6: "6",
  c13: "13",
  sentinel: "Sentinel",
  barbican: "Barbican",
  vidette: "Vidette",
  redoubt: "Redoubt",
  conflux: "Conflux",
};

const classFilters = Object.keys(classMap);
const staticFilters = [
  "c1",
  "c2",
  "c3",
  "c4",
  "c5",
  "c6",
  "hs",
  "ls",
  "ns",
];
const planetFilters = ["Barren", "Gas", "Ice", "Lava", "Oceanic", "Plasma", "Storm", "Temperate"];
const effectFilters = [
  "Black Hole",
  "Cataclysmic Variable",
  "Magnetar",
  "Pulsar",
  "Red Giant",
  "Wolf-Rayet",
  "No Effect",
];

const DEFAULT_BOOKMARK_TAG_COLOR = "#53b6ff";

const classSortOrder = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "13",
  "Sentinel",
  "Barbican",
  "Vidette",
  "Redoubt",
  "Conflux",
];

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia(query).matches
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia(query);
    setMatches(media.matches);

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

function normalizeJcode(value: string | null | undefined) {
  const raw = String(value || "").trim().toUpperCase();
  const nonStandard = raw.match(/^J[0-9-]+$/);
  if (nonStandard) return nonStandard[0];
  const standard = raw.match(/J?\d{1,6}/);
  if (standard) {
    const digits = standard[0].replace(/^J/, "");
    return digits ? `J${digits}` : "";
  }
  return "";
}

function normalizeEffect(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, " ");
}

function totalMoons(planets: Planet[] = []) {
  return planets.reduce((total, planet) => total + (Number(planet.moon_count ?? planet.moons) || 0), 0);
}

function buildRow(system: WormholeSystem): SystemRow {
  const statics = sortStatics(system.statics || []);
  const planets = system.planets || [];

  return {
    system,
    planetCount: typeof system.planetCount === "number" ? system.planetCount : planets.length,
    moonCount: typeof system.moonCount === "number" ? system.moonCount : totalMoons(planets),
    staticDestinations: statics.map((code) => staticDestinationForCode(code)),
  };
}

function rowFlagsText(system: WormholeSystem) {
  const flags = [
    isA0System(system) ? "A0" : null,
    isShatteredSystem(system) ? "Shattered" : null,
  ].filter(Boolean);
  return flags.join(" / ");
}

function effectTextColor(effect: string) {
  const normalized = normalizeEffect(effect);
  if (normalized === "magnetar") return "text-[#c6bdd6]";
  if (normalized === "black hole") return "text-[#b6c4d6]";
  if (normalized === "cataclysmic variable" || normalized === "cataclysmic") return "text-[#b8cbd6]";
  if (normalized === "pulsar") return "text-[#b7d2dc]";
  if (normalized === "red giant") return "text-[#d2b0a2]";
  if (normalized === "wolf rayet") return "text-[#d2c28f]";
  return "text-[#cfd9e3]";
}

function resultEffectLabel(effect: string) {
  return normalizeEffect(effect) === "cataclysmic variable" ? "Cataclysmic" : effect;
}

function ResultMetaValue({
  value,
  tone = "text-[#cfd9e3]",
}: {
  value: string | number;
  tone?: string;
}) {
  return <span className={`whitespace-nowrap ${tone}`}>{value}</span>;
}

function StaticDestinationReadout({ destinations }: { destinations: string[] }) {
  if (!destinations.length) {
    return <ResultMetaValue value="NONE" tone="text-slate-600" />;
  }

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1 font-mono text-[11px] uppercase">
      {destinations.map((destination, index) => (
        <span key={`${destination}-${index}`} className="inline-flex items-baseline gap-x-1">
          {index > 0 ? <span className="text-slate-700">/</span> : null}
          <span className={classColorFor(destination)}>{destination.toUpperCase()}</span>
        </span>
      ))}
    </span>
  );
}

function ResultField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 overflow-hidden whitespace-nowrap font-mono text-[11px] ${className}`}>
      <span className="text-slate-500">{label}: </span>
      {children}
    </div>
  );
}

function classFilterLabel(value: string) {
  if (value.startsWith("c")) return value.toUpperCase();
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function staticFilterLabel(value: string) {
  return value === "thera" ? "Thera" : value.toUpperCase();
}

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${
        active
          ? "border-[#4b9cff]/70 bg-[#0b1119] text-[#d8ecff]"
          : "border-[#303236] bg-[#05070b] text-slate-500 hover:border-[#4b9cff]/70 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[82px_minmax(0,1fr)] items-start gap-2">
      <div className="pt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
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

function normalizeTags(tags: unknown) {
  const input = Array.isArray(tags) ? tags : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const value = raw && typeof raw === "object" ? (raw as { tag?: unknown }).tag : raw;
    const tag = String(value || "").trim().replace(/\s+/g, " ").slice(0, 32);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

function tagKey(value: string) {
  return value.trim().toLowerCase();
}

function normalizeBookmarkTagColor(value: unknown) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : DEFAULT_BOOKMARK_TAG_COLOR;
}

function normalizeBookmarkTagDefinitions(tags: unknown) {
  const input = Array.isArray(tags) ? tags : [];
  const out: BookmarkTagDefinition[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const tag = normalizeTags([raw])[0];
    if (!tag) continue;
    const key = tagKey(tag);
    if (seen.has(key)) continue;
    const color =
      raw && typeof raw === "object"
        ? normalizeBookmarkTagColor((raw as { color?: unknown }).color)
        : DEFAULT_BOOKMARK_TAG_COLOR;
    seen.add(key);
    out.push({ tag, color });
  }
  return out;
}

function bookmarkTagStyle(color: string, active = false): CSSProperties {
  const clean = normalizeBookmarkTagColor(color);
  return {
    borderColor: `${clean}${active ? "d9" : "99"}`,
    backgroundColor: `${clean}${active ? "26" : "14"}`,
    color: active ? "#f4faff" : "#cbd5e1",
    boxShadow: active ? `0 0 12px ${clean}33` : undefined,
  };
}

function BookmarkTagPill({
  tag,
  color,
  onRemove,
}: {
  tag: string;
  color: string;
  onRemove?: () => void;
}) {
  const content = (
    <>
      <span className="h-1.5 w-1.5 shrink-0" style={{ backgroundColor: normalizeBookmarkTagColor(color) }} />
      <span className="truncate">{tag}</span>
      {onRemove ? <X size={10} className="shrink-0" /> : null}
    </>
  );

  if (!onRemove) {
    return (
      <span
        className="inline-flex max-w-[180px] items-center gap-1 border px-2 py-0.5 text-[10px]"
        style={bookmarkTagStyle(color)}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
      className="inline-flex max-w-[180px] items-center gap-1 border px-2 py-0.5 text-[10px] hover:border-[#bf3b3b] hover:text-[#ffaaaa]"
      style={bookmarkTagStyle(color)}
      title={`Remove tag ${tag}`}
    >
      {content}
    </button>
  );
}

function BookmarkTagFilterChip({
  tag,
  color,
  active,
  onToggle,
  onDelete,
}: {
  tag: string;
  color: string;
  active: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <span className="inline-flex overflow-hidden border" style={bookmarkTagStyle(color, active)}>
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
      >
        <span className="h-1.5 w-1.5" style={{ backgroundColor: normalizeBookmarkTagColor(color) }} />
        {tag}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="flex w-6 items-center justify-center border-l border-current/20 text-current/70 hover:bg-[#2a090b] hover:text-[#ffaaaa]"
        title={`Delete tag ${tag}`}
      >
        <Trash2 size={10} />
      </button>
    </span>
  );
}

function ResultRow({
  row,
  selected,
  onSelect,
  bookmark,
  showBookmarkTools,
  availableTags,
  onAddTag,
  onRemoveTag,
}: {
  row: SystemRow;
  selected: boolean;
  onSelect: (system: WormholeSystem) => void;
  bookmark?: WormholeBookmarkRecord | null;
  showBookmarkTools: boolean;
  availableTags: BookmarkTagDefinition[];
  onAddTag: (jcode: string, tag: string) => void;
  onRemoveTag: (jcode: string, tag: string) => void;
}) {
  const { system, planetCount, moonCount, staticDestinations } = row;
  const effect = system.effect?.trim();
  const shownEffect = effect && normalizeEffect(effect) !== "no effect" ? effect : "";
  const shownEffectLabel = shownEffect ? resultEffectLabel(shownEffect) : "";
  const flags = rowFlagsText(system);
  const bookmarked = Boolean(bookmark);
  const nickname = bookmark?.nickname?.trim() || "";
  const addableTags = availableTags.filter(
    (tag) => !(bookmark?.tags || []).some((current) => tagKey(current) === tagKey(tag.tag))
  );
  const tagColor = (tag: string) =>
    availableTags.find((item) => tagKey(item.tag) === tagKey(tag))?.color || DEFAULT_BOOKMARK_TAG_COLOR;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(system)}
      onKeyDown={(event) => {
        if (event.currentTarget !== event.target) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect(system);
      }}
      className={`group w-full border-l-2 px-3 py-2 text-left transition-colors ${
        selected
          ? "border-l-[#53b6ff] bg-[#101722]"
          : "border-l-transparent bg-[#070910] hover:border-l-[#4b9cff] hover:bg-[#0d111a]"
      } cursor-pointer outline-none focus-visible:border-l-[#53b6ff] focus-visible:bg-[#101722]`}
    >
      <div className="grid grid-cols-2 items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(132px,1fr)_48px_minmax(0,1fr)_auto_auto] lg:grid-cols-[minmax(168px,0.9fr)_42px_minmax(118px,1fr)_minmax(120px,0.95fr)_minmax(92px,0.7fr)_76px_66px]">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1 font-mono text-[14px] font-semibold text-[#53b6ff] group-hover:text-[#7fc5ff]">
            {bookmarked ? <Bookmark size={12} fill="currentColor" /> : null}
            <span>{system.jcode}</span>
          </span>
          {nickname ? (
            <div className="mt-0.5 truncate pl-4 font-mono text-[11px] text-slate-300">
              &quot;{nickname}&quot;
            </div>
          ) : null}
        </div>

        <div className="min-w-0 font-mono text-[12px] font-bold">
          <span className={classColorFor(system.class)}>{systemClassLabel(system.class)}</span>
        </div>

        <ResultField label="Statics" className="col-span-2 sm:col-span-1">
          <StaticDestinationReadout destinations={staticDestinations} />
        </ResultField>

        {shownEffectLabel ? (
          <ResultField label="Effect" className="col-span-2 sm:col-span-1">
            <ResultMetaValue value={shownEffectLabel} tone={effectTextColor(shownEffect)} />
          </ResultField>
        ) : (
          <div aria-hidden="true" className="hidden min-w-0 lg:block" />
        )}

        {flags ? (
          <ResultField label="Flags" className="col-span-2 sm:col-span-1">
            <ResultMetaValue value={flags} tone="text-[#b9c7d6]" />
          </ResultField>
        ) : (
          <div aria-hidden="true" className="hidden min-w-0 lg:block" />
        )}

        <ResultField label="Planets">
          <ResultMetaValue value={planetCount} tone="text-slate-300" />
        </ResultField>

        <ResultField label="Moons">
          <ResultMetaValue value={moonCount} tone="text-slate-300" />
        </ResultField>
      </div>

      {showBookmarkTools && bookmark ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[#20232b] pt-2">
          <div className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-slate-500">
            <Tag size={12} />
            Tags
          </div>
          {bookmark.tags.length ? (
            bookmark.tags.map((tag) => (
              <BookmarkTagPill
                key={tag}
                tag={tag}
                color={tagColor(tag)}
                onRemove={() => onRemoveTag(system.jcode, tag)}
              />
            ))
          ) : (
            <span className="text-[10px] text-slate-600">No tags</span>
          )}
          <div className="ml-auto min-w-[180px]" onClick={(event) => event.stopPropagation()}>
            <select
              defaultValue=""
              disabled={!addableTags.length}
              onChange={(event) => {
                const tag = event.currentTarget.value;
                if (tag) onAddTag(system.jcode, tag);
                event.currentTarget.value = "";
              }}
              className="h-6 w-full border border-[#303236] bg-[#05070b] px-2 text-[11px] text-slate-100 outline-none disabled:cursor-not-allowed disabled:text-slate-600 focus:border-[#53b6ff]"
              title="Add tag"
            >
              <option value="">{addableTags.length ? "Add tag..." : "No tags to add"}</option>
              {addableTags.map((tag) => (
                <option key={tag.tag} value={tag.tag}>
                  {tag.tag}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const WormholeDatabase = () => {
  const [wormholes, setWormholes] = useState<WormholeSystem[]>([]);
  const [selected, setSelected] = useState<WormholeSystem | null>(null);
  const [jcodeSearch, setJcodeSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(260);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const isDesktop = useMediaQuery("(min-width: 1430px)");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [bookmarks, setBookmarks] = useState<WormholeBookmarkRecord[]>([]);
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const [selectedBookmarkTags, setSelectedBookmarkTags] = useState<string[]>([]);
  const [accountBookmarkTags, setAccountBookmarkTags] = useState<BookmarkTagDefinition[]>([]);
  const [newBookmarkTag, setNewBookmarkTag] = useState("");
  const [newBookmarkTagColor, setNewBookmarkTagColor] = useState(DEFAULT_BOOKMARK_TAG_COLOR);

  useEffect(() => {
    let alive = true;

    axios
      .get<WormholeSystem[]>("/api/wormholes")
      .then((res) => {
        if (!alive) return;
        setWormholes(res.data);
        setLoadError(null);
      })
      .catch((err: Error) => {
        if (!alive) return;
        setLoadError(err.message || "Failed to load wormhole systems");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  async function refreshBookmarks() {
    if (!authUser) return;
    try {
      const response = await fetch("/api/wormhole-bookmarks", { credentials: "include" });
      const payload = await readJson<{ ok: boolean; bookmarks: WormholeBookmarkRecord[] }>(response);
      setBookmarks((payload.bookmarks || []).map((bookmark) => ({
        ...bookmark,
        nickname: String(bookmark.nickname || "").trim().slice(0, 80),
        tags: normalizeTags(bookmark.tags),
      })));
      setBookmarkError(null);
    } catch (error: any) {
      setBookmarks([]);
      setBookmarkError(error?.message || "Failed to load wormhole bookmarks.");
    }
  }

  async function refreshBookmarkTags() {
    if (!authUser) return;
    try {
      const response = await fetch("/api/wormhole-bookmarks/tags", { credentials: "include" });
      const payload = await readJson<{ ok: boolean; tags: BookmarkTagDefinition[] }>(response);
      setAccountBookmarkTags(normalizeBookmarkTagDefinitions(payload.tags || []));
      setBookmarkError(null);
    } catch (error: any) {
      setAccountBookmarkTags([]);
      setBookmarkError(error?.message || "Failed to load wormhole bookmark tags.");
    }
  }

  useEffect(() => {
    let alive = true;

    async function loadAuth() {
      try {
        const response = await fetch("/api/auth/me", { credentials: "include" });
        const payload = await readJson<{ ok: boolean; authenticated: boolean; user: AuthUser | null }>(response);
        if (alive) setAuthUser(payload.authenticated ? payload.user : null);
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
      setBookmarks([]);
      setBookmarksOnly(false);
      setSelectedBookmarkTags([]);
      setAccountBookmarkTags([]);
      setNewBookmarkTag("");
      setNewBookmarkTagColor(DEFAULT_BOOKMARK_TAG_COLOR);
      setBookmarkError(null);
      return;
    }
    void refreshBookmarks();
    void refreshBookmarkTags();
  }, [authUser]);

  const rows = useMemo(() => wormholes.map(buildRow), [wormholes]);
  const bookmarksByJcode = useMemo(() => {
    const map = new Map<string, WormholeBookmarkRecord>();
    for (const bookmark of bookmarks) map.set(bookmark.jcode.toUpperCase(), bookmark);
    return map;
  }, [bookmarks]);
  const bookmarkTags = useMemo(() => {
    const tags = new Map<string, BookmarkTagDefinition>();
    for (const item of accountBookmarkTags) {
      const key = tagKey(item.tag);
      if (!tags.has(key)) tags.set(key, item);
    }
    for (const bookmark of bookmarks) {
      for (const tag of bookmark.tags || []) {
        const key = tagKey(tag);
        if (!tags.has(key)) tags.set(key, { tag, color: DEFAULT_BOOKMARK_TAG_COLOR });
      }
    }
    return Array.from(tags.values()).sort((a, b) => a.tag.localeCompare(b.tag));
  }, [accountBookmarkTags, bookmarks]);
  const bookmarkTagColorMap = useMemo(() => {
    const colors: Record<string, string> = {};
    for (const tag of bookmarkTags) colors[tagKey(tag.tag)] = tag.color;
    return colors;
  }, [bookmarkTags]);

  useEffect(() => {
    if (!bookmarksOnly) {
      setSelectedBookmarkTags([]);
    }
  }, [bookmarksOnly]);

  useEffect(() => {
    const available = new Set(bookmarkTags.map((tag) => tagKey(tag.tag)));
    setSelectedBookmarkTags((prev) => {
      const next = prev.filter((tag) => available.has(tagKey(tag)));
      return next.length === prev.length ? prev : next;
    });
  }, [bookmarkTags]);

  useEffect(() => {
    const requested = normalizeJcode(searchParams.get("system"));
    if (!requested || !wormholes.length) return;

    const hit = wormholes.find((system) => system.jcode.toUpperCase() === requested);
    if (hit && selected?.jcode !== hit.jcode) {
      setSelected(hit);
      if (!isDesktop) setDetailModalOpen(true);
    }
  }, [isDesktop, searchParams, selected?.jcode, wormholes]);

  useEffect(() => {
    setVisibleCount(260);
  }, [bookmarksOnly, filters, jcodeSearch, selectedBookmarkTags]);

  const toggleFilter = <K extends "classes" | "statics" | "planets" | "effects">(key: K, value: string) => {
    setFilters((prev) => {
      const values = prev[key];
      return {
        ...prev,
        [key]: values.includes(value)
          ? values.filter((item) => item !== value)
          : [...values, value],
      };
    });
  };

  const toggleBookmarkTagFilter = (tag: string) => {
    setSelectedBookmarkTags((prev) => {
      const key = tagKey(tag);
      return prev.some((item) => tagKey(item) === key)
        ? prev.filter((item) => tagKey(item) !== key)
        : [...prev, tag];
    });
  };

  const createBookmarkTag = useCallback(async () => {
    if (!authUser) {
      requestSiteAuthModal("login");
      return;
    }
    const tag = newBookmarkTag.trim().replace(/\s+/g, " ").slice(0, 32);
    if (!tag) return;
    const color = normalizeBookmarkTagColor(newBookmarkTagColor);
    try {
      const response = await fetch("/api/wormhole-bookmarks/tags", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, color }),
      });
      const payload = await readJson<{ ok: boolean; tag: BookmarkTagDefinition }>(response);
      setAccountBookmarkTags((prev) => normalizeBookmarkTagDefinitions([...prev, payload.tag || { tag, color }]));
      setNewBookmarkTag("");
      setBookmarkError(null);
    } catch (error: any) {
      setBookmarkError(error?.message || "Failed to create bookmark tag.");
    }
  }, [authUser, newBookmarkTag, newBookmarkTagColor]);

  const upsertBookmark = useCallback(
    async (jcode: string, next: { nickname?: string; notes?: string; tags?: string[] }) => {
      if (!authUser) {
        requestSiteAuthModal("login");
        return null;
      }

      const current = bookmarksByJcode.get(jcode.toUpperCase());
      const response = await fetch(`/api/wormhole-bookmarks/${encodeURIComponent(jcode)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: next.nickname ?? current?.nickname ?? "",
          notes: next.notes ?? current?.notes ?? "",
          tags: normalizeTags(next.tags ?? current?.tags ?? []),
        }),
      });
      const payload = await readJson<{ ok: boolean; bookmark: WormholeBookmarkRecord }>(response);
      const bookmark = {
        ...payload.bookmark,
        nickname: String(payload.bookmark.nickname || "").trim().slice(0, 80),
        tags: normalizeTags(payload.bookmark.tags),
      };
      setBookmarks((prev) => {
        const without = prev.filter((item) => item.jcode.toUpperCase() !== bookmark.jcode.toUpperCase());
        return [bookmark, ...without].sort((a, b) => a.jcode.localeCompare(b.jcode));
      });
      setAccountBookmarkTags((prev) => normalizeBookmarkTagDefinitions([...prev, ...(bookmark.tags || [])]));
      setBookmarkError(null);
      return bookmark;
    },
    [authUser, bookmarksByJcode]
  );

  const toggleBookmark = useCallback(
    async (system: WormholeSystem) => {
      if (!authUser) {
        requestSiteAuthModal("login");
        return;
      }

      const jcode = system.jcode.toUpperCase();
      const current = bookmarksByJcode.get(jcode);
      try {
        if (current) {
          const response = await fetch(`/api/wormhole-bookmarks/${encodeURIComponent(jcode)}`, {
            method: "DELETE",
            credentials: "include",
          });
          await readJson<{ ok: boolean }>(response);
          setBookmarks((prev) => prev.filter((bookmark) => bookmark.jcode.toUpperCase() !== jcode));
        } else {
          await upsertBookmark(jcode, { notes: "", tags: [] });
        }
        setBookmarkError(null);
      } catch (error: any) {
        setBookmarkError(error?.message || "Failed to update bookmark.");
      }
    },
    [authUser, bookmarksByJcode, upsertBookmark]
  );

  const saveBookmarkNotes = useCallback(
    async (system: WormholeSystem, notes: string, nickname?: string) => {
      try {
        await upsertBookmark(system.jcode.toUpperCase(), { nickname, notes });
      } catch (error: any) {
        setBookmarkError(error?.message || "Failed to save notes.");
        throw error;
      }
    },
    [upsertBookmark]
  );

  const addBookmarkTag = useCallback(
    async (jcode: string, tag: string) => {
      const selectedTag = tag.trim();
      if (!selectedTag) return;
      const current = bookmarksByJcode.get(jcode.toUpperCase());
      if (!current) return;
      try {
        await upsertBookmark(jcode, { tags: normalizeTags([...(current.tags || []), selectedTag]) });
      } catch (error: any) {
        setBookmarkError(error?.message || "Failed to add tag.");
      }
    },
    [bookmarksByJcode, upsertBookmark]
  );

  const removeBookmarkTag = useCallback(
    async (jcode: string, tag: string) => {
      const current = bookmarksByJcode.get(jcode.toUpperCase());
      if (!current) return;
      try {
        await upsertBookmark(jcode, {
          tags: current.tags.filter((item) => item.toLowerCase() !== tag.toLowerCase()),
        });
      } catch (error: any) {
        setBookmarkError(error?.message || "Failed to remove tag.");
      }
    },
    [bookmarksByJcode, upsertBookmark]
  );

  const deleteBookmarkTag = useCallback(
    async (tag: string) => {
      if (!authUser) {
        requestSiteAuthModal("login");
        return;
      }
      const clean = tag.trim();
      if (!clean) return;
      const confirmed = window.confirm(`Delete the "${clean}" tag from all bookmarked wormholes?`);
      if (!confirmed) return;

      try {
        const response = await fetch(`/api/wormhole-bookmarks/tags/${encodeURIComponent(clean)}`, {
          method: "DELETE",
          credentials: "include",
        });
        await readJson<{ ok: boolean }>(response);
        setSelectedBookmarkTags((prev) => prev.filter((item) => tagKey(item) !== tagKey(clean)));
        setAccountBookmarkTags((prev) => prev.filter((item) => tagKey(item.tag) !== tagKey(clean)));
        setBookmarks((prev) =>
          prev.map((bookmark) => ({
            ...bookmark,
            tags: bookmark.tags.filter((item) => tagKey(item) !== tagKey(clean)),
          }))
        );
        setBookmarkError(null);
      } catch (error: any) {
        setBookmarkError(error?.message || "Failed to delete bookmark tag.");
      }
    },
    [authUser]
  );

  const filteredRows = useMemo(() => {
    const normalizedSearch = jcodeSearch.trim().toLowerCase().replace(/^j/, "");
    const selectedTagKeys = selectedBookmarkTags.map(tagKey);

    return rows
      .filter((row) => {
        const system = row.system;
        const bookmark = bookmarksByJcode.get(system.jcode.toUpperCase());

        if (bookmarksOnly && !bookmark) return false;
        if (bookmarksOnly && selectedTagKeys.length) {
          const systemTagKeys = new Set((bookmark?.tags || []).map(tagKey));
          if (!selectedTagKeys.every((tag) => systemTagKeys.has(tag))) return false;
        }

        if (normalizedSearch) {
          const jcode = system.jcode.toLowerCase().replace(/^j/, "");
          if (!jcode.includes(normalizedSearch)) return false;
        }

        const matchClass =
          filters.classes.length === 0 ||
          filters.classes.some((classKey) => classMap[classKey] === system.class || classKey === system.class);

        const matchStatics =
          filters.statics.length === 0 ||
          filters.statics.every((required) =>
            (system.statics || []).some((code) => staticDestinationForCode(code) === required)
          );

        const planetTypes = new Set((system.planets || []).map((planet) => planetTypeLabel(planet.type_name)));
        const matchPlanets =
          filters.planets.length === 0 || filters.planets.every((planet) => planetTypes.has(planet));

        const systemEffect = normalizeEffect(system.effect);
        const matchEffect =
          filters.effects.length === 0 ||
          filters.effects.some((effect) =>
            effect === "No Effect" ? !systemEffect : systemEffect === normalizeEffect(effect)
          );

        const matchA0 = !filters.a0 || isA0System(system);
        const shattered = isShatteredSystem(system);
        const matchShattered =
          filters.shattered === "all" ||
          (filters.shattered === "only" && shattered) ||
          (filters.shattered === "none" && !shattered);

        return matchClass && matchStatics && matchPlanets && matchEffect && matchA0 && matchShattered;
      })
      .sort((a, b) => {
        const aIndex = classSortOrder.indexOf(String(a.system.class || ""));
        const bIndex = classSortOrder.indexOf(String(b.system.class || ""));
        return (
          (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex) ||
          a.system.jcode.localeCompare(b.system.jcode)
        );
      });
  }, [bookmarksByJcode, bookmarksOnly, filters, jcodeSearch, rows, selectedBookmarkTags]);

  const activeFilters = useMemo(() => {
    const active: string[] = [];
    if (jcodeSearch.trim()) active.push(`Search: ${jcodeSearch.trim()}`);
    if (bookmarksOnly) active.push("Bookmarked systems");
    if (bookmarksOnly) active.push(...selectedBookmarkTags.map((tag) => `Tag ${tag}`));
    active.push(...filters.classes.map((item) => `Class ${classFilterLabel(item)}`));
    active.push(...filters.statics.map((item) => `Static ${staticFilterLabel(item)}`));
    active.push(...filters.planets.map((item) => `Planet ${item}`));
    active.push(...filters.effects.map((item) => `Effect ${item}`));
    if (filters.a0) active.push("A0 stars");
    if (filters.shattered !== "all") active.push(`Shattered ${filters.shattered}`);
    return active;
  }, [bookmarksOnly, filters, jcodeSearch, selectedBookmarkTags]);

  const visibleRows = filteredRows.slice(0, visibleCount);

  const clearFilters = () => {
    setFilters(emptyFilters);
    setJcodeSearch("");
    setBookmarksOnly(false);
    setSelectedBookmarkTags([]);
  };

  const clearSelected = useCallback(() => {
    setSelected(null);
    setDetailModalOpen(false);
    const next = new URLSearchParams(searchParams);
    next.delete("system");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const selectSystem = useCallback(
    (system: WormholeSystem) => {
      setSelected(system);

      const next = new URLSearchParams(searchParams);
      next.set("system", system.jcode);
      setSearchParams(next, { replace: false });

      if (!isDesktop) setDetailModalOpen(true);
    },
    [isDesktop, searchParams, setSearchParams]
  );

  const closeModal = () => {
    setDetailModalOpen(false);
    if (!isDesktop) clearSelected();
  };

  return (
    <div className="min-h-screen text-slate-100 text-[11px] leading-snug">
      <div className="mx-auto max-w-[1500px] px-3 py-6">
        <div className="border border-[#3a3c40] bg-[#05070b]/95 shadow-[0_0_32px_rgba(0,0,0,0.95)]">
          <div className="flex items-center justify-between border-b border-[#3a3c40] bg-gradient-to-r from-[#111319] via-[#171920] to-[#242833] px-3 py-1.5">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 bg-[#53b6ff] shadow-[0_0_8px_rgba(83,182,255,0.7)]" />
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-300">
                Wormholes & Exploration &gt; System Browser
              </span>
            </div>
            <div className="hidden items-center gap-2 text-[9px] text-slate-400 sm:flex">
              <span className="border border-[#303236] bg-[#0b0d11] px-1 py-0.5">All the tools</span>
              <span className="text-[#53b6ff]">Triff.Tools</span>
              <span className="flex gap-1">
                <span className="h-2 w-2 bg-[#53b6ff]" />
                <span className="h-2 w-2 bg-[#3bbf5a]" />
                <span className="h-2 w-2 bg-[#bf3b3b]" />
              </span>
            </div>
          </div>

          <div className="border-b border-[#262933] bg-[#05070b] px-3 py-3">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-end">
              <div>
                <h1 className="text-[22px] font-semibold uppercase tracking-[0.18em] text-slate-50">
                  Wormhole Database
                </h1>
                <p className="mt-1 text-[12px] text-slate-400">
                  Search J-space systems, statics, effects, planets, and activity.
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-500">
                  <span className="border border-[#303236] bg-[#070910] px-2 py-0.5">
                    {wormholes.length || 2603} systems loaded locally
                  </span>
                  <span className="border border-[#303236] bg-[#070910] px-2 py-0.5">Filters run client-side</span>
                  <span className="border border-[#303236] bg-[#070910] px-2 py-0.5">
                    {loading ? "Loading local database" : "Local database loaded"}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] uppercase tracking-[0.18em] text-slate-500">J-code Search</label>
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center border border-[#303236] bg-[#05070b]">
                  <div className="flex h-9 w-9 items-center justify-center text-slate-500">
                    <Search size={15} />
                  </div>
                  <input
                    type="text"
                    placeholder="J110117"
                    className="h-9 bg-transparent text-[13px] font-mono text-slate-100 outline-none placeholder:text-slate-600"
                    value={jcodeSearch}
                    onChange={(event) => setJcodeSearch(event.target.value)}
                  />
                  {jcodeSearch ? (
                    <button
                      type="button"
                      onClick={() => setJcodeSearch("")}
                      title="Clear search"
                      className="flex h-9 w-9 items-center justify-center text-slate-500 hover:text-slate-100"
                    >
                      <X size={14} />
                    </button>
                  ) : (
                    <span className="h-9 w-2" />
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3 p-3">
            <div className="border border-[#2c2f36] bg-[#070910]">
              <div className="flex items-center justify-between border-b border-[#2c2f36] bg-[#101219] px-2 py-1">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                  <Filter size={13} />
                  Filters
                </div>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="border border-[#303236] bg-[#05070b] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-slate-400 hover:border-[#53b6ff] hover:text-slate-100"
                >
                  Clear filters
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 p-2 xl:grid-cols-2">
                <div className="space-y-2">
                  <FilterGroup label="Class">
                    {classFilters.map((item) => (
                      <Chip
                        key={item}
                        active={filters.classes.includes(item)}
                        onClick={() => toggleFilter("classes", item)}
                      >
                        {classFilterLabel(item)}
                      </Chip>
                    ))}
                  </FilterGroup>

                  <FilterGroup label="Statics">
                    {staticFilters.map((item) => (
                      <Chip
                        key={item}
                        active={filters.statics.includes(item)}
                        onClick={() => toggleFilter("statics", item)}
                      >
                        {staticFilterLabel(item)}
                      </Chip>
                    ))}
                  </FilterGroup>

                  <div className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Flags</div>
                    <div className="flex flex-wrap gap-1">
                      <Chip
                        active={filters.a0}
                        onClick={() => setFilters((prev) => ({ ...prev, a0: !prev.a0 }))}
                      >
                        A0 blue star
                      </Chip>
                      {(["all", "only", "none"] as const).map((item) => (
                        <Chip
                          key={item}
                          active={filters.shattered === item}
                          onClick={() => setFilters((prev) => ({ ...prev, shattered: item }))}
                        >
                          Shattered {item}
                        </Chip>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Account</div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Chip
                        active={bookmarksOnly}
                        onClick={() => {
                          if (!authUser) {
                            requestSiteAuthModal("login");
                            return;
                          }
                          setBookmarksOnly((value) => !value);
                        }}
                      >
                        Bookmarked only
                      </Chip>
                      <span className="px-2 py-0.5 text-[10px] text-slate-500">
                        {!authChecked
                          ? "checking account"
                          : authUser
                            ? `${bookmarks.length} saved`
                            : "sign in to use bookmarks"}
                      </span>
                    </div>
                  </div>

                  {bookmarksOnly ? (
                    <FilterGroup label="Tags">
                      {bookmarkTags.length ? (
                        bookmarkTags.map((tag) => (
                          <BookmarkTagFilterChip
                            key={tag.tag}
                            tag={tag.tag}
                            color={tag.color}
                            active={selectedBookmarkTags.some((item) => tagKey(item) === tagKey(tag.tag))}
                            onToggle={() => toggleBookmarkTagFilter(tag.tag)}
                            onDelete={() => void deleteBookmarkTag(tag.tag)}
                          />
                        ))
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] text-slate-600">No tags created yet</span>
                      )}
                      {selectedBookmarkTags.length ? (
                        <button
                          type="button"
                          onClick={() => setSelectedBookmarkTags([])}
                          className="border border-[#303236] bg-[#05070b] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-slate-500 hover:border-[#53b6ff] hover:text-slate-100"
                        >
                          Clear tags
                        </button>
                      ) : null}
                      <div className="flex min-w-[220px] items-center gap-1">
                        <input
                          value={newBookmarkTag}
                          onChange={(event) => setNewBookmarkTag(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void createBookmarkTag();
                            }
                          }}
                          placeholder="Create tag"
                          className="h-6 min-w-0 flex-1 border border-[#303236] bg-[#05070b] px-2 text-[11px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#53b6ff]"
                          maxLength={32}
                        />
                        <input
                          type="color"
                          value={newBookmarkTagColor}
                          onChange={(event) => setNewBookmarkTagColor(normalizeBookmarkTagColor(event.target.value))}
                          className="h-6 w-8 shrink-0 cursor-pointer border border-[#303236] bg-[#05070b] p-0.5"
                          title="Tag color"
                        />
                        <button
                          type="button"
                          onClick={() => void createBookmarkTag()}
                          className="flex h-6 w-6 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-300 hover:border-[#53b6ff] hover:text-[#e5f4ff]"
                          title="Create tag"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </FilterGroup>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <FilterGroup label="Planets">
                    {planetFilters.map((item) => (
                      <Chip
                        key={item}
                        active={filters.planets.includes(item)}
                        onClick={() => toggleFilter("planets", item)}
                      >
                        {item}
                      </Chip>
                    ))}
                  </FilterGroup>

                  <FilterGroup label="Effects">
                    {effectFilters.map((item) => (
                      <Chip
                        key={item}
                        active={filters.effects.includes(item)}
                        onClick={() => toggleFilter("effects", item)}
                      >
                        {item}
                      </Chip>
                    ))}
                  </FilterGroup>

                  <div className="grid grid-cols-[82px_minmax(0,1fr)] items-start gap-2">
                    <div className="pt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">Active</div>
                    <div className="flex min-h-[24px] flex-wrap gap-1">
                      {activeFilters.length ? (
                        activeFilters.map((item) => (
                          <span
                            key={item}
                            className="border border-[#303236] bg-[#05070b] px-2 py-0.5 text-[10px] text-slate-400"
                          >
                            {item}
                          </span>
                        ))
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] text-slate-600">No active filters</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              {bookmarkError ? (
                <div className="border-t border-[#2c2f36] bg-[#1d090b] px-3 py-2 text-[11px] text-[#ffaaaa]">
                  {bookmarkError}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 [@media(min-width:1430px)]:grid-cols-[minmax(0,1fr)_680px]">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-col gap-2 border border-[#2c2f36] bg-[#070910] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-300">Results</div>
                    <div className="text-[10px] text-slate-500">
                      Showing <span className="font-mono text-slate-200">{filteredRows.length}</span> of{" "}
                      <span className="font-mono text-slate-200">{wormholes.length || 2603}</span> wormholes
                      {bookmarksOnly ? <span className="ml-2 text-[#53b6ff]">Tag editing enabled</span> : null}
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {visibleRows.length < filteredRows.length ? (
                      <>
                        Rendering <span className="font-mono text-slate-200">{visibleRows.length}</span> rows for scan speed
                      </>
                    ) : (
                      "All matching rows rendered"
                    )}
                  </div>
                </div>

                <div className="border border-[#303236] bg-[#05070b]">
                  {loading ? (
                    <div className="px-3 py-8 text-center text-[12px] text-slate-500">Loading local wormhole database...</div>
                  ) : loadError ? (
                    <div className="border border-[#7a2c2c] bg-[#19080a] px-3 py-3 text-[12px] text-[#ff9999]">
                      {loadError}
                    </div>
                  ) : visibleRows.length ? (
                    <div className="divide-y divide-[#20232b]">
                      {visibleRows.map((row) => (
                        <ResultRow
                          key={row.system.jcode}
                          row={row}
                          selected={selected?.jcode === row.system.jcode}
                          onSelect={selectSystem}
                          bookmark={bookmarksByJcode.get(row.system.jcode.toUpperCase()) || null}
                          showBookmarkTools={bookmarksOnly}
                          availableTags={bookmarkTags}
                          onAddTag={(jcode, tag) => void addBookmarkTag(jcode, tag)}
                          onRemoveTag={(jcode, tag) => void removeBookmarkTag(jcode, tag)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="px-3 py-8 text-center text-[12px] text-slate-500">No systems match the active filters.</div>
                  )}
                </div>

                {visibleRows.length < filteredRows.length ? (
                  <button
                    type="button"
                    onClick={() => setVisibleCount((count) => count + 260)}
                    className="w-full border border-[#303236] bg-[#070910] px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-slate-400 hover:border-[#53b6ff] hover:text-slate-100"
                  >
                    Render next 260 rows
                  </button>
                ) : null}
              </div>

              <aside className="hidden min-w-0 [@media(min-width:1430px)]:block">
                <div className="min-h-[420px] border border-[#3a3c40] bg-[#05070b] shadow-[0_0_24px_rgba(0,0,0,0.7)]">
                  {selected ? (
                    <WormholeDetails
                      system={selected}
                      onClose={clearSelected}
                      onExpand={() => setDetailModalOpen(true)}
                      bookmark={bookmarksByJcode.get(selected.jcode.toUpperCase()) || null}
                      bookmarkTagColors={bookmarkTagColorMap}
                      authChecked={authChecked}
                      canUseBookmarks={Boolean(authUser)}
                      onToggleBookmark={(system) => void toggleBookmark(system)}
                      onSaveNotes={saveBookmarkNotes}
                      onRequestSignIn={() => requestSiteAuthModal("login")}
                    />
                  ) : null}
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>

      {selected && detailModalOpen ? (
        <WormholeModal
          system={selected}
          onClose={closeModal}
          bookmark={bookmarksByJcode.get(selected.jcode.toUpperCase()) || null}
          bookmarkTagColors={bookmarkTagColorMap}
          authChecked={authChecked}
          canUseBookmarks={Boolean(authUser)}
          onToggleBookmark={(system) => void toggleBookmark(system)}
          onSaveNotes={saveBookmarkNotes}
          onRequestSignIn={() => requestSiteAuthModal("login")}
        />
      ) : null}
    </div>
  );
};

export default WormholeDatabase;
