import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Loader2, Package, PackagePlus, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { triffApiFetch, triffApiUrl } from "../../lib/webRuntime";
import { PyfaGuiIcon } from "./FittingIcon";
import type { AuthUser, BrowserCategory, CustomSavedFitGroup, CustomSavedFitGroupFit, SavedFitFocus, SavedFitGroup, SavedFitShipNode, SearchResult } from "./types";

type Props = {
  onSelect: (item: SearchResult) => void;
  onShowInfo?: (item: SearchResult) => void;
  onAddToCargo?: (item: SearchResult) => void;
  authUser?: AuthUser | null;
  savedFitGroups?: SavedFitGroup[];
  customSavedFitGroups?: CustomSavedFitGroup[];
  savedFitsLoading?: boolean;
  selectedSavedFitId?: string | null;
  savedFitFocus?: SavedFitFocus | null;
  onOpenSavedFit?: (id: string) => void;
  onDeleteSavedFit?: (id: string) => void;
  onCreateSavedFitGroup?: (name: string) => void;
  onRenameSavedFitGroup?: (id: string, name: string) => void;
  onDeleteSavedFitGroup?: (id: string) => void;
  onAddSavedFitToGroup?: (groupId: string, fitId: string) => void;
  onRemoveSavedFitFromGroup?: (groupId: string, fitId: string) => void;
  mobileCompact?: boolean;
  initialTab?: BrowserTab;
  initialShipSubtab?: ShipSubtab;
  shipBrowserFocusToken?: number;
};

type BrowserTab = "market" | "ships";
type ShipSubtab = "all" | "saved";

const inputClass =
  "w-full bg-[#05070b] border border-[#303236] px-2 py-1 pl-7 text-[11px] text-slate-100 placeholder-slate-600 outline-none focus:border-[#53b6ff] focus:ring-0";
const MARKET_RESULTS_SPLIT_STORAGE_KEY = "triff:fitting:desktop-market-results-height";
const DEFAULT_MARKET_RESULTS_PERCENT = 38;
const MIN_MARKET_RESULTS_PERCENT = 22;
const MAX_MARKET_RESULTS_PERCENT = 70;

function eveIcon(typeId: number) {
  return `https://images.evetech.net/types/${typeId}/icon?size=32`;
}

function eveShipRender(typeId: number) {
  return `https://images.evetech.net/types/${typeId}/render?size=32`;
}

function marketIcon(iconId: number) {
  return triffApiUrl(`/api/fitting/browser/market/icon/${iconId}`);
}

function normalizeResults(results: SearchResult[] = []) {
  return results.map((item) => ({ ...item, typeId: Number(item.typeId) }));
}

function findCategory(categories: BrowserCategory[], key: string): BrowserCategory | null {
  for (const category of categories) {
    if (category.key === key) return category;
    const child = findCategory(category.children || [], key);
    if (child) return child;
  }
  return null;
}

function categoryContainsKey(category: BrowserCategory, key: string) {
  if (!key) return false;
  if (category.key === key) return true;
  return (category.children || []).some((child) => categoryContainsKey(child, key));
}

function findSavedFitPath(groups: SavedFitGroup[], savedFitId: string | null | undefined) {
  if (!savedFitId) return null;
  for (const group of groups) {
    for (const ship of group.children || []) {
      if ((ship.fits || []).some((fit) => fit.id === savedFitId)) {
        return { group, ship };
      }
    }
  }
  return null;
}

function marketTier(item: SearchResult) {
  const meta = String(item.metaGroupName || "").toLowerCase();
  if (meta.includes("officer")) return { key: "officer", label: "Officer", order: 60, color: "#b889ff" };
  if (meta.includes("deadspace")) return { key: "deadspace", label: "Deadspace", order: 50, color: "#53b6ff" };
  if (meta.includes("faction")) return { key: "faction", label: "Faction", order: 40, color: "#55d68a" };
  if (meta.includes("storyline")) return { key: "storyline", label: "Storyline", order: 30, color: "#d6c66a" };
  if (meta.includes("tech ii") || meta === "tech 2") return { key: "tech2", label: "Tech II", order: 20, color: "#f0a34a" };
  if (meta.includes("abyssal")) return { key: "abyssal", label: "Abyssal", order: 55, color: "#c084fc" };
  return { key: "t1meta", label: "Tech I / Meta", order: 10, color: "#cbd5e1" };
}

function TypeImage({ item, isShip }: { item: SearchResult; isShip: boolean }) {
  const [fallback, setFallback] = useState(0);
  const src = isShip
    ? fallback === 0
      ? eveShipRender(item.typeId)
      : fallback === 1
        ? eveIcon(item.typeId)
        : ""
    : fallback === 0
      ? eveIcon(item.typeId)
      : fallback === 1
        ? eveShipRender(item.typeId)
        : "";

  if (!src) {
    return (
      <span className="flex h-5 w-5 items-center justify-center border border-[#30343d] bg-black font-mono text-[8px] text-slate-600">
        {String(item.typeId).slice(-2)}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className="h-5 w-5 border border-[#30343d] bg-black object-cover"
      onError={() => setFallback((value) => value + 1)}
    />
  );
}

function MarketCategoryIcon({ category, hasChildren }: { category: BrowserCategory; hasChildren: boolean }) {
  const [failed, setFailed] = useState(false);
  const iconId = category.iconId == null ? null : Number(category.iconId);
  if (!iconId || failed) {
    return <Package size={12} className={hasChildren ? "shrink-0 text-slate-500" : "shrink-0 text-slate-600"} />;
  }
  return (
    <img
      src={marketIcon(iconId)}
      alt=""
      className="h-4 w-4 shrink-0 object-contain"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default function ModuleBrowser({
  onSelect,
  onShowInfo,
  onAddToCargo,
  authUser = null,
  savedFitGroups = [],
  customSavedFitGroups = [],
  savedFitsLoading = false,
  selectedSavedFitId = null,
  savedFitFocus = null,
  onOpenSavedFit,
  onDeleteSavedFit,
  onCreateSavedFitGroup,
  onRenameSavedFitGroup,
  onDeleteSavedFitGroup,
  onAddSavedFitToGroup,
  onRemoveSavedFitFromGroup,
  mobileCompact = false,
  initialTab = "market",
  initialShipSubtab = "all",
  shipBrowserFocusToken,
}: Props) {
  const [tab, setTab] = useState<BrowserTab>(initialTab);
  const [shipSubtab, setShipSubtab] = useState<ShipSubtab>(initialShipSubtab);
  const [query, setQuery] = useState("");
  const [marketCategories, setMarketCategories] = useState<BrowserCategory[]>([]);
  const [shipCategories, setShipCategories] = useState<BrowserCategory[]>([]);
  const [activeMarket, setActiveMarket] = useState("");
  const [activeShip, setActiveShip] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultContext, setResultContext] = useState<{ x: number; y: number; item: SearchResult } | null>(null);
  const [savedFitContext, setSavedFitContext] = useState<{
    x: number;
    y: number;
    fit: CustomSavedFitGroupFit;
    sourceGroupId?: string | null;
    groupsOpen: boolean;
  } | null>(null);
  const marketSplitRef = useRef<HTMLDivElement | null>(null);
  const [desktopMarketResultsPercent, setDesktopMarketResultsPercent] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_MARKET_RESULTS_PERCENT;
    const stored = Number(window.localStorage.getItem(MARKET_RESULTS_SPLIT_STORAGE_KEY));
    if (!Number.isFinite(stored)) return DEFAULT_MARKET_RESULTS_PERCENT;
    return Math.min(MAX_MARKET_RESULTS_PERCENT, Math.max(MIN_MARKET_RESULTS_PERCENT, stored));
  });
  const activeMarketNode = useMemo(() => findCategory(marketCategories, activeMarket), [marketCategories, activeMarket]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MARKET_RESULTS_SPLIT_STORAGE_KEY, String(Math.round(desktopMarketResultsPercent)));
  }, [desktopMarketResultsPercent]);

  const filteredSavedGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return savedFitGroups;
    return savedFitGroups
      .map((group) => ({
        ...group,
        children: (group.children || [])
          .map((ship) => ({
            ...ship,
            fits: (ship.fits || []).filter(
              (fit) => fit.fitName.toLowerCase().includes(needle) || ship.shipName.toLowerCase().includes(needle) || group.shipClass.toLowerCase().includes(needle)
            ),
          }))
          .filter((ship) => ship.fits.length > 0 || ship.shipName.toLowerCase().includes(needle)),
      }))
      .filter((group) => group.children.length > 0);
  }, [query, savedFitGroups]);

  const filteredCustomSavedGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customSavedFitGroups;
    return customSavedFitGroups
      .map((group) => {
        if (group.name.toLowerCase().includes(needle)) return group;
        return {
          ...group,
          fits: group.fits.filter((fit) => (
            fit.fitName.toLowerCase().includes(needle) ||
            fit.shipName.toLowerCase().includes(needle) ||
            String(fit.groupName || "").toLowerCase().includes(needle)
          )),
        };
      })
      .filter((group) => group.fits.length > 0 || group.name.toLowerCase().includes(needle));
  }, [customSavedFitGroups, query]);

  useEffect(() => {
    if (!resultContext && !savedFitContext) return;
    const close = () => {
      setResultContext(null);
      setSavedFitContext(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [resultContext, savedFitContext]);

  useEffect(() => {
    let alive = true;
    async function loadRoots() {
      try {
        const [market, ships] = await Promise.all([
          triffApiFetch("/api/fitting/browser/market").then((res) => res.json()),
          triffApiFetch("/api/fitting/browser/ships").then((res) => res.json()),
        ]);
        if (!alive) return;
        if (market?.ok) setMarketCategories(market.categories || []);
        if (ships?.ok) setShipCategories(ships.categories || []);
      } catch {
        if (alive) setError("Browser categories failed");
      }
    }
    void loadRoots();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!savedFitFocus) return;
    setTab("ships");
    setShipSubtab("saved");
    setQuery("");
    const path = findSavedFitPath(savedFitGroups, savedFitFocus.savedFitId);
    if (path) {
      setExpanded((prev) => ({
        ...prev,
        [`saved-class:${path.group.key}`]: true,
        [`saved-ship:${path.ship.shipTypeId}`]: true,
      }));
    }
  }, [savedFitFocus, savedFitGroups]);

  useEffect(() => {
    if (shipBrowserFocusToken == null) return;
    setTab("ships");
    setShipSubtab("all");
    setQuery("");
    setActiveMarket("");
    setActiveShip("");
  }, [shipBrowserFocusToken]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("query", query.trim());
        if (tab === "market" && activeMarketNode?.placeholder && !query.trim()) {
          setResults([]);
          setLoading(false);
          return;
        }
        if (tab === "market" && activeMarketNode?.marketGroupId) params.set("marketGroupId", String(activeMarketNode.marketGroupId));
        if (tab === "market" && activeMarket && !activeMarketNode?.marketGroupId) params.set("category", activeMarket);
        if (tab === "ships" && shipSubtab === "saved") {
          setResults([]);
          setLoading(false);
          return;
        }
        if (tab === "ships" && activeShip && !query.trim()) params.set("group", activeShip);
        const endpoint = tab === "market" ? "/api/fitting/browser/market" : "/api/fitting/browser/ships";
        const response = await triffApiFetch(`${endpoint}?${params.toString()}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "browser_failed");
        setResults(normalizeResults(data.results || []));
        if (tab === "market" && data.categories) setMarketCategories(data.categories);
        if (tab === "ships" && data.categories) setShipCategories(data.categories);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError("Browser load failed");
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    }, query.trim() ? 250 : 50);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [tab, shipSubtab, activeMarket, activeMarketNode?.marketGroupId, activeMarketNode?.placeholder, activeShip, query]);

  const searchMode = query.trim().length > 0;
  const marketResultsVisible =
    !mobileCompact || searchMode || loading || Boolean(activeMarketNode?.marketGroupId || (activeMarket && results.length > 0));

  function clampMarketResultsPercent(value: number, containerHeight?: number) {
    const minPercent = containerHeight ? Math.max(MIN_MARKET_RESULTS_PERCENT, (180 / containerHeight) * 100) : MIN_MARKET_RESULTS_PERCENT;
    return Math.min(MAX_MARKET_RESULTS_PERCENT, Math.max(minPercent, value));
  }

  function beginMarketResultsResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (mobileCompact) return;
    const container = marketSplitRef.current;
    if (!container) return;
    event.preventDefault();

    const updateFromClientY = (clientY: number) => {
      const rect = container.getBoundingClientRect();
      if (!rect.height) return;
      const nextPercent = ((rect.bottom - clientY) / rect.height) * 100;
      setDesktopMarketResultsPercent(clampMarketResultsPercent(nextPercent, rect.height));
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      updateFromClientY(moveEvent.clientY);
    };
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    updateFromClientY(event.clientY);
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  const groupedResults = useMemo(() => {
    const map = new Map<string, { label: string; order: number; items: SearchResult[] }>();
    for (const item of results) {
      if (tab === "market") {
        const tier = marketTier(item);
        const group = map.get(tier.key) || { label: tier.label, order: tier.order, items: [] };
        group.items.push(item);
        map.set(tier.key, group);
      } else {
        const key = item.groupName || item.categoryName || "Items";
        const group = map.get(key) || { label: key, order: 100, items: [] };
        group.items.push(item);
        map.set(key, group);
      }
    }
    return Array.from(map.entries())
      .map(([key, group]) => ({ key, ...group, items: group.items.slice().sort((a, b) => a.typeName.localeCompare(b.typeName)) }))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  }, [results, tab]);

  function selectCategory(category: BrowserCategory) {
    const prefix = tab;
    const key = `${prefix}:${category.key}`;
    const currentActive = tab === "market" ? activeMarket : activeShip;
    const hasChildren = Boolean(category.children?.length || category.hasChildren);
    if (tab === "market") {
      const isOpen = !!expanded[key];
      if (query.trim()) setQuery("");
      if (hasChildren && isOpen) {
        setExpanded((prev) => ({ ...prev, [key]: false }));
        if (categoryContainsKey(category, currentActive)) {
          setActiveMarket("");
          setResults([]);
        }
        return;
      }
      if (!hasChildren && currentActive === category.key) {
        setActiveMarket("");
        setResults([]);
        return;
      }
      if (hasChildren) {
        setExpanded((prev) => ({ ...prev, [key]: true }));
      }
      setActiveMarket(category.key);
    } else {
      setExpanded((prev) => ({ ...prev, [key]: !prev[key] || currentActive !== category.key }));
      setActiveShip(category.key);
    }
  }

  function renderItem(item: SearchResult) {
    const isShip = item.categoryName === "Ship";
    const tier = tab === "market" ? marketTier(item) : null;
    const canAddToCargo = tab === "market" && Boolean(onAddToCargo);
    if (onShowInfo) {
      return (
        <div
          key={item.typeId}
          className={`grid w-full ${canAddToCargo ? "grid-cols-[22px,1fr,20px,20px,20px]" : "grid-cols-[22px,1fr,20px,20px]"} items-center gap-1.5 border-l-2 px-1.5 py-1 text-left hover:bg-[#111720] ${
            tier ? "" : "border-l-transparent"
          }`}
          style={tier ? { borderLeftColor: tier.color } : undefined}
          onContextMenu={(event) => {
            if (!canAddToCargo) return;
            event.preventDefault();
            setResultContext({ x: event.clientX, y: event.clientY, item });
          }}
        >
          <TypeImage item={item} isShip={isShip} />
          <button type="button" className="min-w-0 text-left" onClick={() => onSelect(item)}>
            <span className="block truncate text-[11px] leading-4 text-slate-100">{item.typeName}</span>
            <span className="block truncate text-[9px] leading-3 text-slate-500">{item.groupName || item.marketGroupName || item.metaGroupName || item.categoryName}</span>
          </button>
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] font-mono text-[10px] text-[#8bd3ff]"
            title="Show info"
            aria-label={`Show info for ${item.typeName}`}
            onClick={() => onShowInfo(item)}
          >
            i
          </button>
          {canAddToCargo && (
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-400 hover:border-[#53b6ff]/60 hover:text-[#8bd3ff]"
              title="Add to cargo"
              aria-label={`Add ${item.typeName} to cargo`}
              onClick={() => onAddToCargo?.(item)}
            >
              <PackagePlus size={11} />
            </button>
          )}
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-400"
            title="Add item"
            aria-label={`Add ${item.typeName}`}
            onClick={() => onSelect(item)}
          >
            <Plus size={11} />
          </button>
        </div>
      );
    }
    return (
      <button
        key={item.typeId}
        type="button"
        className={`grid w-full grid-cols-[22px,1fr,20px] items-center gap-1.5 border-l-2 px-1.5 py-1 text-left hover:bg-[#111720] ${
          tier ? "" : "border-l-transparent"
        }`}
        style={tier ? { borderLeftColor: tier.color } : undefined}
        onClick={() => onSelect(item)}
      >
        <TypeImage item={item} isShip={isShip} />
        <span className="min-w-0">
          <span className="block truncate text-[11px] leading-4 text-slate-100">{item.typeName}</span>
          <span className="block truncate text-[9px] leading-3 text-slate-500">{item.groupName || item.marketGroupName || item.metaGroupName || item.categoryName}</span>
        </span>
        <span className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-400">
          <Plus size={11} />
        </span>
      </button>
    );
  }

  function renderMarketNode(category: BrowserCategory, depth = 0) {
    const key = `market:${category.key}`;
    const isOpen = !!expanded[key];
    const isActive = activeMarket === category.key;
    const hasChildren = Boolean(category.children?.length || category.hasChildren);
    return (
      <div key={category.key} className={depth === 0 ? "border-b border-[#151922]" : ""}>
        <button
          type="button"
          className={`flex h-6 w-full items-center gap-1.5 pr-1.5 text-left text-[11px] ${
            isActive ? "bg-[#111923] text-slate-100" : "text-slate-400 hover:bg-[#0d1118]"
          }`}
          style={{ paddingLeft: `${6 + depth * 12}px` }}
          onClick={() => selectCategory(category)}
        >
          {hasChildren ? (
            isOpen ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <MarketCategoryIcon category={category} hasChildren={hasChildren} />
          <span className="truncate">{category.label}</span>
        </button>
        {hasChildren && isOpen && (
          <div className="bg-[#05070b]">
            {(category.children || []).map((child) => renderMarketNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  function renderShipCategoryTree() {
    return shipCategories.map((category) => {
      const key = `ships:${category.key}`;
      const isOpen = !!expanded[key];
      const isActive = activeShip === category.key;
      return (
        <div key={category.key} className="border-b border-[#151922]">
          <button
            type="button"
            className={`flex h-6 w-full items-center gap-1.5 px-1.5 text-left text-[11px] ${
              isActive ? "bg-[#111923] text-slate-100" : "text-slate-400 hover:bg-[#0d1118]"
            }`}
            onClick={() => selectCategory(category)}
          >
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <PyfaGuiIcon name="ship" label="Ship group" className="h-4 w-4" />
            <span className="truncate">{category.label}</span>
          </button>
          {isOpen && isActive && !searchMode && (
            <div className="border-t border-[#151922] bg-[#05070b]">
              {results.length === 0 ? (
                <div className="px-6 py-1.5 text-[10px] text-slate-600">
                  {category.placeholder ? "Context list will populate from the active fit later." : loading ? "Loading..." : "No entries"}
                </div>
              ) : (
                results.slice(0, 80).map(renderItem)
              )}
            </div>
          )}
        </div>
      );
    });
  }

  function renderSavedShip(ship: SavedFitShipNode, groupKey: string) {
    const shipKey = `saved-ship:${ship.shipTypeId}`;
    const isOpen = !!expanded[shipKey];
    return (
      <div key={`${groupKey}-${ship.shipTypeId}`} className="border-t border-[#151922] bg-[#05070b]">
        <button
          type="button"
          className="grid h-7 w-full grid-cols-[14px,22px,1fr,34px] items-center gap-1.5 px-2 text-left text-[11px] text-slate-300 hover:bg-[#0d1118]"
          onClick={() => setExpanded((prev) => ({ ...prev, [shipKey]: !prev[shipKey] }))}
        >
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <img src={eveShipRender(ship.shipTypeId)} alt="" className="h-5 w-5 border border-[#30343d] bg-black object-cover" />
          <span className="min-w-0">
            <span className="block truncate text-slate-100">{ship.shipName}</span>
            <span className="block truncate text-[9px] text-slate-600">{ship.groupName || "Saved hull"}</span>
          </span>
          <span className="text-right font-mono text-[10px] text-slate-600">{ship.fits.length}</span>
        </button>
        {isOpen && (
          <div className="border-t border-[#151922]">
            {ship.fits.map((fit) => (
              <div
                key={fit.id}
                className={`grid h-7 grid-cols-[1fr,22px] items-center gap-1 px-3 pl-10 text-[11px] ${
                  selectedSavedFitId === fit.id ? "bg-[#132233] text-[#8bd3ff]" : "text-slate-300 hover:bg-[#101721]"
                }`}
                onContextMenu={(event) => {
                  if (mobileCompact) return;
                  event.preventDefault();
                  setSavedFitContext({
                    x: event.clientX,
                    y: event.clientY,
                    groupsOpen: false,
                    fit: {
                      ...fit,
                      shipTypeId: ship.shipTypeId,
                      shipName: ship.shipName,
                      groupName: ship.groupName,
                    },
                  });
                }}
              >
                <button type="button" className="min-w-0 truncate text-left" onClick={() => onOpenSavedFit?.(fit.id)} title={fit.fitName}>
                  {fit.fitName}
                </button>
                {onDeleteSavedFit ? (
                  <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 hover:border-red-400 hover:text-red-200"
                    onClick={() => {
                      if (window.confirm(`Delete saved fit "${fit.fitName}"?`)) onDeleteSavedFit(fit.id);
                    }}
                    title="Delete saved fit"
                  >
                    <Trash2 size={10} />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderCustomSavedFitGroups() {
    if (mobileCompact || !authUser) return null;
    const rootKey = "saved-custom-groups";
    const rootOpen = expanded[rootKey] !== false;
    return (
      <div className="border-b border-[#20242c]">
        <div className="grid h-7 grid-cols-[1fr,24px] items-center bg-[#0d1016]">
          <button
            type="button"
            className="flex h-full min-w-0 items-center gap-1.5 px-1.5 text-left text-[10px] uppercase tracking-widest text-[#8bd3ff] hover:bg-[#101721]"
            onClick={() => setExpanded((prev) => ({ ...prev, [rootKey]: !rootOpen }))}
          >
            {rootOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="truncate">Fit Groups</span>
          </button>
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-400 hover:border-[#53b6ff]/60 hover:text-[#8bd3ff]"
            title="Create fit group"
            onClick={() => {
              const name = window.prompt("New fit group name");
              if (name?.trim()) onCreateSavedFitGroup?.(name.trim());
            }}
          >
            <Plus size={11} />
          </button>
        </div>
        {rootOpen && (
          <div>
            {!filteredCustomSavedGroups.length && (
              <div className="px-7 py-1.5 text-[10px] text-slate-600">
                {query.trim() ? "No custom groups match." : "No custom fit groups yet."}
              </div>
            )}
            {filteredCustomSavedGroups.map((group) => {
              const key = `saved-custom:${group.id}`;
              const isOpen = !!expanded[key] || query.trim().length > 0;
              return (
                <div key={group.id} className="border-t border-[#151922] bg-[#05070b]">
                  <div className="grid h-7 grid-cols-[1fr,22px,22px] items-center gap-1 px-1.5">
                    <button
                      type="button"
                      className="flex h-full min-w-0 items-center gap-1.5 text-left text-[11px] text-slate-300 hover:text-slate-100"
                      onClick={() => setExpanded((prev) => ({ ...prev, [key]: !isOpen }))}
                    >
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span className="truncate">{group.name}</span>
                      <span className="ml-auto font-mono text-[9px] text-slate-600">{group.fits.length}</span>
                    </button>
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 hover:border-[#53b6ff]/60 hover:text-[#8bd3ff]"
                      title="Rename fit group"
                      onClick={() => {
                        const name = window.prompt("Rename fit group", group.name);
                        if (name?.trim() && name.trim() !== group.name) onRenameSavedFitGroup?.(group.id, name.trim());
                      }}
                    >
                      <Pencil size={10} />
                    </button>
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-500 hover:border-red-400 hover:text-red-200"
                      title="Delete fit group"
                      onClick={() => {
                        if (window.confirm(`Delete fit group "${group.name}"? Saved fits will not be deleted.`)) onDeleteSavedFitGroup?.(group.id);
                      }}
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                  {isOpen && (
                    <div className="border-t border-[#151922]">
                      {!group.fits.length && <div className="px-8 py-1.5 text-[10px] text-slate-600">No fits in this group.</div>}
                      {group.fits.map((fit) => (
                        <div
                          key={`${group.id}-${fit.id}`}
                          className={`grid min-h-8 grid-cols-[24px,1fr] items-center gap-1.5 px-2 pl-6 text-[11px] ${
                            selectedSavedFitId === fit.id ? "bg-[#132233] text-[#8bd3ff]" : "text-slate-300 hover:bg-[#101721]"
                          }`}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setSavedFitContext({ x: event.clientX, y: event.clientY, fit, sourceGroupId: group.id, groupsOpen: false });
                          }}
                        >
                          <img src={eveShipRender(fit.shipTypeId)} alt="" className="h-5 w-5 border border-[#30343d] bg-black object-cover" />
                          <button type="button" className="min-w-0 text-left" onClick={() => onOpenSavedFit?.(fit.id)}>
                            <span className="block truncate text-slate-100">{fit.fitName}</span>
                            <span className="block truncate text-[9px] text-slate-600">{fit.shipName}</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function renderSavedFitTree() {
    if (!authUser) {
      return (
        <div className="px-3 py-3 text-[11px] text-slate-600">
          Saved fits appear here after signing in from the site header.
        </div>
      );
    }
    if (savedFitsLoading) return <div className="px-3 py-3 text-[11px] text-slate-600">Loading saved fits...</div>;
    const classGroups = filteredSavedGroups.map((group) => {
      const key = `saved-class:${group.key}`;
      const isOpen = !!expanded[key] || query.trim().length > 0;
      return (
        <div key={group.key} className="border-b border-[#151922]">
          <button
            type="button"
            className="flex h-6 w-full items-center gap-1.5 px-1.5 text-left text-[11px] text-slate-400 hover:bg-[#0d1118]"
            onClick={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
          >
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <PyfaGuiIcon name="ship" label="Ship group" className="h-4 w-4" />
            <span className="truncate">{group.shipClass}</span>
          </button>
          {isOpen && <div>{group.children.map((ship) => renderSavedShip(ship, group.key))}</div>}
        </div>
      );
    });
    return (
      <>
        {renderCustomSavedFitGroups()}
        {!classGroups.length && (
          <div className="px-3 py-3 text-[11px] text-slate-600">{query.trim() ? "No saved fits match." : "No saved fits yet."}</div>
        )}
        {classGroups}
      </>
    );
  }

  function renderCategoryTree() {
    return tab === "market" ? marketCategories.map((category) => renderMarketNode(category)) : renderShipCategoryTree();
  }

  function renderGroupedResults(header: string) {
    return (
      <>
        <div className="sticky top-0 z-10 flex h-6 items-center justify-between border-b border-[#20242c] bg-[#0d1016] px-2">
          <span className="text-[10px] uppercase tracking-widest text-slate-500">{header}</span>
          <span className="font-mono text-[10px] text-slate-600">{results.length}</span>
        </div>
        {groupedResults.length === 0 ? (
          <div className="px-3 py-3 text-[11px] text-slate-600">{loading ? "Loading..." : "No results"}</div>
        ) : (
          groupedResults.map((group) => (
            <div key={group.key} className="border-b border-[#181c23]">
              <div className="bg-[#090c12] px-2 py-0.5 text-[9px] uppercase tracking-widest text-slate-600">{group.label}</div>
              <div className="divide-y divide-[#121722]">{group.items.map(renderItem)}</div>
            </div>
          ))
        )}
      </>
    );
  }

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden border border-[#2c2f36] bg-[#070910]">
      <div className="grid shrink-0 grid-cols-2 border-b border-[#2c2f36] bg-[#101219]">
        {(["market", "ships"] as BrowserTab[]).map((key) => (
          <button
            key={key}
            type="button"
            className={`h-7 border-r border-[#2c2f36] text-[10px] uppercase tracking-widest ${
              tab === key ? "bg-[#16202a] text-[#8bd3ff]" : "text-slate-500 hover:text-slate-200"
            }`}
            onClick={() => {
              setTab(key);
              setQuery("");
            }}
          >
            {key === "market" ? "Market" : "Ships"}
          </button>
        ))}
      </div>

      <div className="shrink-0 border-b border-[#20242c] p-1.5">
        {tab === "ships" && (
          <div className="mb-1.5 grid grid-cols-2 border border-[#303236] bg-[#05070b]">
            <button
              type="button"
              className={`h-6 text-[10px] uppercase tracking-widest ${
                shipSubtab === "all" ? "bg-[#16202a] text-[#8bd3ff]" : "text-slate-500 hover:text-slate-200"
              }`}
              onClick={() => {
                setShipSubtab("all");
                setQuery("");
              }}
            >
              All Ships
            </button>
            <button
              type="button"
              className={`h-6 border-l border-[#303236] text-[10px] uppercase tracking-widest ${
                shipSubtab === "saved" ? "bg-[#16202a] text-[#8bd3ff]" : "text-slate-500 hover:text-slate-200"
              } disabled:cursor-not-allowed disabled:opacity-40`}
              disabled={!authUser}
              onClick={() => {
                if (!authUser) return;
                setShipSubtab("saved");
                setQuery("");
              }}
            >
              Saved Fits
            </button>
          </div>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={inputClass}
            placeholder={tab === "market" ? "Search modules, charges, drones..." : shipSubtab === "saved" ? "Search saved fits..." : "Search hulls..."}
          />
          {loading && <Loader2 className="absolute right-2 top-1.5 h-3.5 w-3.5 animate-spin text-[#53b6ff]" />}
        </div>
        {error && <div className="mt-1 text-[10px] text-red-300">{error}</div>}
      </div>

      {tab === "market" ? (
        <div ref={marketSplitRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto border-b border-[#20242c]">{renderCategoryTree()}</div>
          {marketResultsVisible && (
            <>
              {!mobileCompact && (
                <div
                  role="separator"
                  aria-label="Resize selected results"
                  aria-orientation="horizontal"
                  title="Drag to resize Selected Results"
                  className="group flex h-2 shrink-0 cursor-row-resize items-center border-y border-[#20242c] bg-[#080b11]"
                  onPointerDown={beginMarketResultsResize}
                  onDoubleClick={() => setDesktopMarketResultsPercent(DEFAULT_MARKET_RESULTS_PERCENT)}
                >
                  <div className="mx-auto h-px w-14 bg-[#243244] group-hover:bg-[#53b6ff]" />
                </div>
              )}
              <div
                className={`${mobileCompact ? "h-[34%] min-h-[112px] max-h-[42%]" : "shrink-0"} overflow-y-auto`}
                style={
                  mobileCompact
                    ? undefined
                    : {
                        height: `${desktopMarketResultsPercent}%`,
                        minHeight: 180,
                        maxHeight: `${MAX_MARKET_RESULTS_PERCENT}%`,
                      }
                }
              >
                {renderGroupedResults(searchMode ? "Search Results" : "Selected Results")}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shipSubtab === "saved" ? renderSavedFitTree() : searchMode ? renderGroupedResults("Search Results") : renderCategoryTree()}
        </div>
      )}
      {resultContext && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[10020] w-44 border border-[#30343d] bg-[#080b11] py-1 text-[11px] text-slate-200 shadow-2xl shadow-black/70"
          style={{
            left: Math.max(4, Math.min(resultContext.x, window.innerWidth - 184)),
            top: Math.max(4, Math.min(resultContext.y, window.innerHeight - 44)),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="flex h-7 w-full items-center px-2 text-left hover:bg-[#101721]"
            onClick={() => {
              onAddToCargo?.(resultContext.item);
              setResultContext(null);
            }}
          >
            Add to Cargo
          </button>
        </div>,
        document.body
      )}
      {savedFitContext && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[10020] flex border border-[#30343d] bg-[#080b11] text-[11px] text-slate-200 shadow-2xl shadow-black/70"
          style={{
            left: Math.max(4, Math.min(savedFitContext.x, window.innerWidth - (savedFitContext.groupsOpen ? 388 : 184))),
            top: Math.max(4, Math.min(savedFitContext.y, window.innerHeight - Math.max(72, customSavedFitGroups.length * 28 + 16))),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="w-44 py-1">
            <button
              type="button"
              className={`flex h-7 w-full items-center justify-between px-2 text-left hover:bg-[#101721] ${savedFitContext.groupsOpen ? "bg-[#101721]" : ""}`}
              onMouseEnter={() => setSavedFitContext((prev) => (prev ? { ...prev, groupsOpen: true } : prev))}
              onClick={() => setSavedFitContext((prev) => (prev ? { ...prev, groupsOpen: !prev.groupsOpen } : prev))}
            >
              <span>Add to Group</span>
              <ChevronRight size={12} />
            </button>
            {savedFitContext.sourceGroupId && (
              <button
                type="button"
                className="h-7 w-full px-2 text-left text-red-200 hover:bg-[#101721]"
                onClick={() => {
                  onRemoveSavedFitFromGroup?.(savedFitContext.sourceGroupId as string, savedFitContext.fit.id);
                  setSavedFitContext(null);
                }}
              >
                Remove from Group
              </button>
            )}
          </div>
          {savedFitContext.groupsOpen && (
            <div className="max-h-72 w-52 overflow-y-auto border-l border-[#30343d] py-1">
              {!customSavedFitGroups.length && <div className="px-2 py-2 text-slate-600">Create a fit group first.</div>}
              {customSavedFitGroups.map((group) => {
                const alreadyAdded = group.fits.some((fit) => fit.id === savedFitContext.fit.id);
                return (
                  <button
                    key={group.id}
                    type="button"
                    disabled={alreadyAdded}
                    className="grid h-7 w-full grid-cols-[1fr,34px] items-center gap-1 px-2 text-left hover:bg-[#101721] disabled:text-slate-600"
                    onClick={() => {
                      onAddSavedFitToGroup?.(group.id, savedFitContext.fit.id);
                      setSavedFitContext(null);
                    }}
                  >
                    <span className="truncate">{group.name}</span>
                    <span className="text-right font-mono text-[9px]">{alreadyAdded ? "Added" : "+ Add"}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>,
        document.body
      )}
    </aside>
  );
}
