import { useEffect, useMemo, useRef, useState } from "react";
import { requestSiteAuthModal, SITE_AUTH_CHANGED_EVENT } from "../../../auth/siteAuthEvents";
import folderIconRaw from "../../../assets/icons/Folder.svg?raw";
import industryIconRaw from "../../../assets/icons/industry.svg?raw";
import searchMarketIconRaw from "../../../assets/icons/searchmarket.svg?raw";
import settingsIconRaw from "../../../assets/icons/Settings.svg?raw";
import walletIconRaw from "../../../assets/icons/wallet.svg?raw";
import cargoIconRaw from "../../../assets/icons/cargo.svg?raw";
import journalIconRaw from "../../../assets/icons/journal.svg?raw";
import calculatorIconRaw from "../../../assets/icons/calculator.svg?raw";
import type { BomRow, FacilityConfig, FlatJob, IndustryPlanResponse, IndustrySettings, TreeNode } from "../../../types/industry";
import { EveIcon, makeEveIcon } from "../../shell/EveIcon";
import {
  ToolBottomSheetV2,
  ToolMobileShellV2,
  ToolTouchRowV2,
  type ToolMobileNavItem,
} from "../../tool-ui/ToolMobileV2";

type MobileView = "products" | "settings" | "results" | "materials" | "jobs";
type JobMode = "jobs" | "tree";
type JobSortKey = "tree" | "jobCost" | "costShare" | "runs" | "output";

type ProductInput = {
  id: number;
  typeId?: number;
  typeName?: string;
  query: string;
  quantity: number;
  runsPerBpc: number;
  suggestions: TypeSuggestion[];
};

type TypeSuggestion = {
  type_id: number;
  name: string;
};

type RouteOverride = "build" | "buy";

type AuthUser = {
  id?: string | number;
  username?: string;
  displayName?: string;
  email?: string;
};

type SavedToolSetup = {
  id: string;
  setupName: string;
  setupJson?: unknown;
  summaryJson?: {
    itemCount?: number;
    firstItem?: string;
  };
  updatedAt?: string;
};

type IndustrySetupSnapshot = {
  version: 1;
  items: ProductInput[];
  settings: IndustrySettings;
  overrides: Record<number, RouteOverride>;
  stock: Record<number, number>;
  leafStock: Record<number, number>;
};

type MobileIndustryPlan = Omit<IndustryPlanResponse, "summary"> & {
  summary: IndustryPlanResponse["summary"] & {
    totalOutputValue?: number;
    profit?: number;
    profitMargin?: number;
    totalVolume?: number;
  };
};

type PriceRow = {
  sell_min?: number;
  buy_max?: number;
  sell_5pct?: number;
  buy_5pct?: number;
};

type UnitEconomicsRow = MobileIndustryPlan["goals"][number] & {
  unitValue: number;
  unitCost: number;
  unitProfit: number;
  margin: number;
};

const icons = {
  industry: makeEveIcon(industryIconRaw),
  chains: makeEveIcon(folderIconRaw),
  products: makeEveIcon(searchMarketIconRaw),
  settings: makeEveIcon(settingsIconRaw),
  results: makeEveIcon(walletIconRaw),
  materials: makeEveIcon(cargoIconRaw),
  jobs: makeEveIcon(journalIconRaw),
  calculate: makeEveIcon(calculatorIconRaw),
};

const defaultFacility: FacilityConfig = {
  structure: "NPC_STATION",
  rig: "NONE",
  security: "HIGH",
};

const defaultSettings: IndustrySettings = {
  systemCostIndexManufacturing: 0,
  systemCostIndexReactions: 0,
  facilityTax: 0,
  sccSurcharge: 0.04,
  includeReactions: false,
  additionalCost: 0,
  productMe: 0,
  componentMe: 0,
  reactionMe: 0,
  productFacility: defaultFacility,
  componentFacility: defaultFacility,
  reactionFacility: defaultFacility,
  inputPriceMode: "sell",
  outputPriceMode: "buy",
  overrideRoutes: {},
};

const INDUSTRY_SETUP_TOOL_KEY = "industry-cost";

const navItems: ToolMobileNavItem<MobileView>[] = [
  { key: "products", label: "Products", icon: icons.products },
  { key: "settings", label: "Settings", icon: icons.settings },
  { key: "results", label: "Results", icon: icons.results },
  { key: "materials", label: "BOM", icon: icons.materials },
  { key: "jobs", label: "Jobs", icon: icons.jobs },
];

function defaultProduct(id = 1): ProductInput {
  return {
    id,
    query: "",
    quantity: 1,
    runsPerBpc: 1,
    suggestions: [],
  };
}

function typeIconUrl(typeId?: number | null, size = 64) {
  return typeId ? `https://images.evetech.net/types/${typeId}/icon?size=${size}` : "";
}

function isHiddenIndustrySearchSuggestion(suggestion: TypeSuggestion) {
  return /\bSKIN\b/i.test(suggestion.name) || /\bBlueprint\b/i.test(suggestion.name);
}

function isk(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || !n) return "0 ISK";
  if (Math.abs(n) >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(3)}T ISK`;
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(3)}B ISK`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(3)}M ISK`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k ISK`;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ISK`;
}

function numberInput(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numericField(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveInt(value: unknown, fallback: number) {
  return Math.max(1, Math.trunc(numericField(value, fallback)));
}

function nonNegativeNumber(value: unknown, fallback = 0) {
  return Math.max(0, numericField(value, fallback));
}

function normalizeRecordNumbers(raw: unknown): Record<number, number> {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const out: Record<number, number> = {};
  for (const [key, value] of Object.entries(source)) {
    const typeId = Number(key);
    if (!Number.isFinite(typeId) || typeId <= 0) continue;
    out[typeId] = nonNegativeNumber(value);
  }
  return out;
}

function normalizeOverrides(raw: unknown): Record<number, RouteOverride> {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const out: Record<number, RouteOverride> = {};
  for (const [key, value] of Object.entries(source)) {
    const typeId = Number(key);
    if (!Number.isFinite(typeId) || typeId <= 0) continue;
    if (value === "build" || value === "buy") out[typeId] = value;
  }
  return out;
}

function normalizeFacilityConfig(raw: unknown): FacilityConfig {
  const source = raw && typeof raw === "object" ? raw as Partial<FacilityConfig> : {};
  return {
    structure: source.structure || defaultFacility.structure,
    rig: source.rig || defaultFacility.rig,
    security: source.security || defaultFacility.security,
  };
}

function normalizeIndustrySettings(raw: unknown): IndustrySettings {
  const source = raw && typeof raw === "object" ? raw as Partial<IndustrySettings> : {};
  const inputPriceMode = source.inputPriceMode === "buy" || source.inputPriceMode === "sell"
    ? source.inputPriceMode
    : defaultSettings.inputPriceMode;
  const outputPriceMode = source.outputPriceMode === "buy" || source.outputPriceMode === "sell"
    ? source.outputPriceMode
    : defaultSettings.outputPriceMode;

  return {
    ...defaultSettings,
    systemCostIndexManufacturing: numericField(source.systemCostIndexManufacturing, defaultSettings.systemCostIndexManufacturing),
    systemCostIndexReactions: numericField(source.systemCostIndexReactions, defaultSettings.systemCostIndexReactions),
    facilityTax: numericField(source.facilityTax, defaultSettings.facilityTax),
    sccSurcharge: numericField(source.sccSurcharge, defaultSettings.sccSurcharge),
    includeReactions: Boolean(source.includeReactions),
    additionalCost: nonNegativeNumber(source.additionalCost, defaultSettings.additionalCost),
    productMe: Math.max(0, Math.min(10, numericField(source.productMe, defaultSettings.productMe))),
    componentMe: Math.max(0, Math.min(10, numericField(source.componentMe, defaultSettings.componentMe))),
    reactionMe: Math.max(0, Math.min(10, numericField(source.reactionMe, defaultSettings.reactionMe))),
    productFacility: normalizeFacilityConfig(source.productFacility),
    componentFacility: normalizeFacilityConfig(source.componentFacility),
    reactionFacility: normalizeFacilityConfig(source.reactionFacility),
    inputPriceMode,
    outputPriceMode,
    overrideRoutes: normalizeOverrides(source.overrideRoutes),
  };
}

function normalizeIndustryProducts(raw: unknown): ProductInput[] {
  const source = Array.isArray(raw) ? raw : [];
  const rows = source.map((item, index): ProductInput | null => {
    if (!item || typeof item !== "object") return null;
    const row = item as Partial<ProductInput>;
    const typeId = numericField(row.typeId, 0);
    const typeName = typeof row.typeName === "string" ? row.typeName : "";
    const query = typeof row.query === "string" ? row.query : typeName;
    return {
      id: index + 1,
      typeId: typeId > 0 ? typeId : undefined,
      typeName: typeName || undefined,
      query,
      quantity: positiveInt(row.quantity, 1),
      runsPerBpc: positiveInt(row.runsPerBpc, 1),
      suggestions: [],
    };
  }).filter(Boolean) as ProductInput[];

  return rows.length ? rows : [defaultProduct()];
}

function snapshotFromSetupJson(setupJson: unknown): IndustrySetupSnapshot {
  const payload = setupJson && typeof setupJson === "object"
    ? setupJson as Partial<IndustrySetupSnapshot>
    : {};

  return {
    version: 1,
    items: normalizeIndustryProducts(payload.items),
    settings: normalizeIndustrySettings(payload.settings),
    overrides: normalizeOverrides(payload.overrides),
    stock: normalizeRecordNumbers(payload.stock),
    leafStock: normalizeRecordNumbers(payload.leafStock),
  };
}

function defaultChainName(products: ProductInput[]) {
  const valid = products.filter((product) => product.typeId || product.query.trim());
  if (!valid.length) return "Industry Chain";
  const first = valid[0].typeName || valid[0].query || "Industry Chain";
  return valid.length > 1 ? `${first} + ${valid.length - 1}` : first;
}

function fieldForMode(mode: "buy" | "sell") {
  return mode === "buy" ? "buy_max" : "sell_min";
}

function typeIdFromTreeNodeId(id: string) {
  const parts = id.split(":");
  if (parts[0] === "job") return Number(parts[3]) || null;
  if (parts[0] === "buy") return Number(parts[1]) || null;
  return null;
}

async function readJson<T>(response: Response): Promise<T> {
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
  return data as T;
}

async function fetchStationPrices(typeIds: number[]) {
  if (!typeIds.length) return {};
  const response = await fetch(`/api/prices/station?station_id=60003760&type_ids=${typeIds.join(",")}&_=${Date.now()}`, {
    cache: "no-store",
  });
  if (!response.ok) return {};
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload.rows || [];
  const out: Record<number, PriceRow> = {};
  for (const row of rows) {
    out[Number(row.type_id)] = {
      sell_min: Number(row.sell_min) || 0,
      buy_max: Number(row.buy_max) || 0,
      sell_5pct: Number(row.sell_5pct) || 0,
      buy_5pct: Number(row.buy_5pct) || 0,
    };
  }
  return out;
}

export default function IndustryMobile() {
  const [view, setView] = useState<MobileView>("products");
  const [products, setProducts] = useState<ProductInput[]>([defaultProduct()]);
  const [settings, setSettings] = useState<IndustrySettings>(defaultSettings);
  const [plan, setPlan] = useState<MobileIndustryPlan | null>(null);
  const [overrides, setOverrides] = useState<Record<number, RouteOverride>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [jobMode, setJobMode] = useState<JobMode>("jobs");
  const [jobSort, setJobSort] = useState<JobSortKey>("tree");
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const [outputPrices, setOutputPrices] = useState<Record<number, PriceRow>>({});
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [savedChains, setSavedChains] = useState<SavedToolSetup[]>([]);
  const [savedChainsLoading, setSavedChainsLoading] = useState(false);
  const [selectedChainId, setSelectedChainId] = useState("");
  const [chainsSheetOpen, setChainsSheetOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [setupBusy, setSetupBusy] = useState<"load" | "save" | "rename" | "delete" | null>(null);
  const [setupError, setSetupError] = useState("");
  const pendingScrollTop = useRef<number | null>(null);
  const selectedChain = savedChains.find((chain) => chain.id === selectedChainId) || null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const typeId = Number(params.get("type_id") || params.get("typeId") || 0);
    if (!Number.isFinite(typeId) || typeId <= 0) return;
    const controller = new AbortController();
    fetch(`/api/items/${typeId}`, { cache: "no-store", signal: controller.signal })
      .then((response) => readJson<{ ok: boolean; item?: { type_id: number; name: string } }>(response))
      .then((data) => {
        if (!data.item) return;
        setProducts([{
          id: 1,
          typeId: data.item.type_id,
          typeName: data.item.name,
          query: data.item.name,
          quantity: 1,
          runsPerBpc: 1,
          suggestions: [],
        }]);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const ids = plan?.goals?.map((goal) => goal.typeId) || [];
    if (!ids.length) {
      setOutputPrices({});
      return;
    }
    void fetchStationPrices(ids).then(setOutputPrices);
  }, [plan?.goals]);

  useEffect(() => {
    let alive = true;

    async function loadAuth() {
      try {
        const response = await fetch("/api/auth/me", { credentials: "include" });
        const data = await readJson<{ ok: boolean; authenticated: boolean; user: AuthUser | null }>(response);
        if (alive) setAuthUser(data.authenticated ? data.user : null);
      } catch {
        if (alive) setAuthUser(null);
      } finally {
        if (alive) setAuthChecked(true);
      }
    }

    function handleAuthChanged(event: Event) {
      const detail = (event as CustomEvent<{ user?: AuthUser | null }>).detail;
      if (detail && "user" in detail) {
        setAuthUser(detail.user ?? null);
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
      setSavedChains([]);
      setSelectedChainId("");
      setSetupError("");
      return;
    }
    void refreshSavedChains();
  }, [authUser]);

  const selectedProducts = products.filter((product) => product.typeId && product.quantity > 0);
  const validProductCount = selectedProducts.length;

  const topSubtitle = plan
    ? `${validProductCount} product${validProductCount === 1 ? "" : "s"} - ${isk(plan.summary.grandTotal)} total`
    : `${validProductCount || products.length} product${(validProductCount || products.length) === 1 ? "" : "s"} configured`;

  function updateProduct(id: number, patch: Partial<ProductInput>) {
    setProducts((prev) => prev.map((product) => (product.id === id ? { ...product, ...patch } : product)));
  }

  async function searchProduct(id: number, query: string) {
    updateProduct(id, { query, typeId: undefined, typeName: undefined, suggestions: [] });
    if (query.trim().length < 2) return;
    try {
      const response = await fetch(`/api/types/search?q=${encodeURIComponent(query.trim())}`);
      const rows = await readJson<TypeSuggestion[]>(response);
      updateProduct(id, { suggestions: rows.filter((row) => !isHiddenIndustrySearchSuggestion(row)).slice(0, 8) });
    } catch {
      updateProduct(id, { suggestions: [] });
    }
  }

  function chooseSuggestion(id: number, suggestion: TypeSuggestion) {
    updateProduct(id, {
      typeId: suggestion.type_id,
      typeName: suggestion.name,
      query: suggestion.name,
      suggestions: [],
    });
  }

  function addProduct() {
    setProducts((prev) => [...prev, defaultProduct(prev.length ? Math.max(...prev.map((p) => p.id)) + 1 : 1)]);
    setView("products");
  }

  function removeProduct(id: number) {
    setProducts((prev) => (prev.length > 1 ? prev.filter((product) => product.id !== id) : [defaultProduct()]));
  }

  async function calculate(
    nextOverrides = overrides,
    options: {
      showResults?: boolean;
      preserveScroll?: boolean;
      products?: ProductInput[];
      settings?: IndustrySettings;
    } = {},
  ) {
    const sourceProducts = options.products ?? products;
    const sourceSettings = options.settings ?? settings;
    const items = sourceProducts
      .filter((product) => product.typeId && product.quantity > 0)
      .map((product) => ({
        typeId: product.typeId as number,
        quantity: Math.max(1, Math.floor(product.quantity || 1)),
        runsPerBpc: Math.max(1, Math.floor(product.runsPerBpc || 1)),
      }));

    if (!items.length) {
      setError("Add at least one product before calculating.");
      setView("products");
      return;
    }

    if (options.preserveScroll) {
      const scrollRoot = document.querySelector<HTMLElement>("[data-mobile-scroll-root]");
      pendingScrollTop.current = scrollRoot?.scrollTop ?? null;
    }

    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/industry/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          options: {
            ...sourceSettings,
            overrideRoutes: nextOverrides,
          },
        }),
      });
      const data = await readJson<MobileIndustryPlan>(response);
      setPlan(data);
      if (options.showResults !== false) {
        setView("results");
      }
      if (options.preserveScroll && pendingScrollTop.current !== null) {
        const scrollTop = pendingScrollTop.current;
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            const scrollRoot = document.querySelector<HTMLElement>("[data-mobile-scroll-root]");
            if (scrollRoot) scrollRoot.scrollTop = scrollTop;
            pendingScrollTop.current = null;
          });
        });
      }
    } catch (err) {
      setError((err as Error).message || "Failed to calculate industry plan.");
    } finally {
      setLoading(false);
    }
  }

  function updateSetting<K extends keyof IndustrySettings>(key: K, value: IndustrySettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function updateFacility(key: "productFacility" | "componentFacility" | "reactionFacility", patch: Partial<FacilityConfig>) {
    setSettings((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  const unitRows = useMemo(() => {
    if (!plan?.goals?.length) return [];
    const outputField = fieldForMode(settings.outputPriceMode);
    const totalRevenue = plan.summary.totalOutputValue || plan.goals.reduce((sum, goal) => {
      const price = Number(outputPrices[goal.typeId]?.[outputField]) || 0;
      return sum + price * goal.quantity;
    }, 0);
    const totalQty = plan.goals.reduce((sum, goal) => sum + goal.quantity, 0) || 1;
    const additionalPerUnit = (plan.summary.additionalCost || 0) / totalQty;

    return plan.goals.map((goal) => {
      const unitValue = Number(outputPrices[goal.typeId]?.[outputField]) || 0;
      const unitCost = (goal.costPerUnit || 0) + additionalPerUnit;
      const unitProfit = unitValue - unitCost;
      return {
        ...goal,
        unitValue,
        unitCost,
        unitProfit,
        margin: unitValue > 0 ? unitProfit / unitValue : 0,
        totalRevenue,
      };
    });
  }, [outputPrices, plan, settings.outputPriceMode]);

  const treeMeta = useMemo(() => {
    const jobsByOutput = new Set(plan?.jobs?.map((job) => job.outputTypeId) || []);
    const meta = new Map<number, { order: number; depth: number }>();
    let order = 0;
    const visit = (node: TreeNode, depth: number) => {
      node.children?.forEach((child) => visit(child, depth + 1));
      const typeId = typeIdFromTreeNodeId(node.id);
      if (typeId && jobsByOutput.has(typeId) && !meta.has(typeId)) {
        meta.set(typeId, { order, depth });
        order += 1;
      }
    };
    plan?.tree?.forEach((root) => visit(root, 0));
    return meta;
  }, [plan?.jobs, plan?.tree]);

  const sortedJobs = useMemo(() => {
    const jobs = [...(plan?.jobs || [])];
    const treeRank = (job: FlatJob, index: number) => treeMeta.get(job.outputTypeId)?.order ?? Number.MAX_SAFE_INTEGER - 10000 + index;
    return jobs
      .map((job, index) => ({ job, index }))
      .sort((a, b) => {
        if (jobSort === "tree") return treeRank(a.job, a.index) - treeRank(b.job, b.index);
        if (jobSort === "jobCost") return (b.job.jobCost || 0) - (a.job.jobCost || 0);
        if (jobSort === "costShare") return jobCostShare(b.job, plan) - jobCostShare(a.job, plan);
        if (jobSort === "runs") return (b.job.runs || 0) - (a.job.runs || 0);
        return (a.job.outputTypeName || "").localeCompare(b.job.outputTypeName || "", undefined, { numeric: true, sensitivity: "base" });
      })
      .map(({ job }) => job);
  }, [jobSort, plan, treeMeta]);

  function updateJobMode(job: FlatJob, mode: "build" | "buy") {
    const next = { ...overrides, [job.outputTypeId]: mode };
    setOverrides(next);
    void calculate(next, { showResults: false, preserveScroll: true });
  }

  function copyBom(bufferPct = 0) {
    const rows = plan?.bom || [];
    const text = rows.map((row) => `${Math.ceil(row.quantity * (1 + bufferPct))} ${row.typeName}`).join("\n");
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  async function refreshSavedChains(preferredChainId?: string) {
    if (!authUser) return;
    setSavedChainsLoading(true);
    try {
      const response = await fetch(`/api/tool-setups/${INDUSTRY_SETUP_TOOL_KEY}`, { credentials: "include" });
      const data = await readJson<{ ok: boolean; setups: SavedToolSetup[] }>(response);
      const next = data.setups || [];
      setSavedChains(next);
      setSelectedChainId((prev) => {
        const candidate = preferredChainId || prev;
        return candidate && next.some((chain) => chain.id === candidate) ? candidate : "";
      });
      setSetupError("");
    } catch (err) {
      setSavedChains([]);
      setSetupError((err as Error).message || "Saved chains failed to load.");
    } finally {
      setSavedChainsLoading(false);
    }
  }

  function currentSnapshot(): IndustrySetupSnapshot {
    return {
      version: 1,
      items: normalizeIndustryProducts(products),
      settings: normalizeIndustrySettings(settings),
      overrides: normalizeOverrides(overrides),
      stock: {},
      leafStock: {},
    };
  }

  function setupPayload(name: string, snapshot: IndustrySetupSnapshot = currentSnapshot()) {
    const validItems = snapshot.items.filter((product) => product.typeId || product.query.trim());
    return {
      setupName: name,
      setupJson: snapshot,
      summaryJson: {
        itemCount: validItems.length,
        firstItem: validItems[0]?.typeName || validItems[0]?.query || "",
      },
    };
  }

  function openChainsSheet() {
    setSetupError("");
    setSaveName(selectedChain?.setupName || defaultChainName(products));
    setChainsSheetOpen(true);
    if (authUser) void refreshSavedChains(selectedChainId || undefined);
  }

  async function saveCurrentChain(mode: "create" | "update") {
    if (!authUser) {
      requestSiteAuthModal("login");
      return;
    }

    const name = saveName.trim() || defaultChainName(products);
    if (!name) {
      setSetupError("Chain name is required.");
      return;
    }

    const updating = mode === "update" && selectedChain;
    setSetupBusy("save");
    try {
      const response = await fetch(
        updating
          ? `/api/tool-setups/${INDUSTRY_SETUP_TOOL_KEY}/${selectedChain.id}`
          : `/api/tool-setups/${INDUSTRY_SETUP_TOOL_KEY}`,
        {
          method: updating ? "PUT" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(setupPayload(name)),
        },
      );
      const data = await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
      setSaveName(data.setup.setupName);
      setSetupError("");
      await refreshSavedChains(data.setup.id);
    } catch (err) {
      setSetupError((err as Error).message === "setup_name_exists"
        ? "A saved chain with that name already exists."
        : (err as Error).message || "Saved chain update failed.");
    } finally {
      setSetupBusy(null);
    }
  }

  async function renameSelectedChain() {
    if (!authUser) {
      requestSiteAuthModal("login");
      return;
    }
    if (!selectedChain) return;

    const name = saveName.trim();
    if (!name) {
      setSetupError("Chain name is required.");
      return;
    }

    setSetupBusy("rename");
    try {
      const response = await fetch(`/api/tool-setups/${INDUSTRY_SETUP_TOOL_KEY}/${selectedChain.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupName: name }),
      });
      await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
      setSetupError("");
      await refreshSavedChains(selectedChain.id);
    } catch (err) {
      setSetupError((err as Error).message === "setup_name_exists"
        ? "A saved chain with that name already exists."
        : (err as Error).message || "Saved chain rename failed.");
    } finally {
      setSetupBusy(null);
    }
  }

  async function loadSavedChain(id = selectedChainId) {
    if (!id) return;
    if (!authUser) {
      requestSiteAuthModal("login");
      return;
    }

    setSetupBusy("load");
    try {
      const response = await fetch(`/api/tool-setups/${INDUSTRY_SETUP_TOOL_KEY}/${id}`, { credentials: "include" });
      const data = await readJson<{ ok: boolean; setup: SavedToolSetup }>(response);
      const snapshot = snapshotFromSetupJson(data.setup.setupJson);
      setProducts(snapshot.items);
      setSettings(snapshot.settings);
      setOverrides(snapshot.overrides);
      setSelectedChainId(id);
      setSaveName(data.setup.setupName);
      setSetupError("");
      setChainsSheetOpen(false);
      await calculate(snapshot.overrides, {
        products: snapshot.items,
        settings: snapshot.settings,
      });
    } catch (err) {
      setSetupError((err as Error).message || "Saved chain failed to load.");
    } finally {
      setSetupBusy(null);
    }
  }

  async function deleteSelectedChain() {
    if (!authUser) {
      requestSiteAuthModal("login");
      return;
    }
    if (!selectedChain) return;
    if (!window.confirm(`Delete saved chain "${selectedChain.setupName}"?`)) return;

    setSetupBusy("delete");
    try {
      const response = await fetch(`/api/tool-setups/${INDUSTRY_SETUP_TOOL_KEY}/${selectedChain.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      await readJson<{ ok: boolean }>(response);
      setSelectedChainId("");
      setSaveName(defaultChainName(products));
      setSetupError("");
      await refreshSavedChains();
    } catch (err) {
      setSetupError((err as Error).message || "Saved chain delete failed.");
    } finally {
      setSetupBusy(null);
    }
  }

  const actions = (
    <div className="grid grid-cols-3 gap-1">
      <button type="button" className="mobile-action-button" onClick={addProduct}>
        <span className="text-[14px] leading-none">+</span>
        Add
      </button>
      <button type="button" className="mobile-action-button" onClick={openChainsSheet}>
        <EveIcon icon={icons.chains} className="h-4 w-4" />
        Saved
      </button>
      <button
        type="button"
        disabled={loading}
        className="inline-flex min-h-8 items-center justify-center gap-1 border border-[#46b2ff]/70 bg-gradient-to-b from-[#1b8cc8] to-[#14608a] px-1.5 text-[9px] font-semibold uppercase tracking-widest text-slate-50 shadow-[0_0_10px_rgba(70,178,255,0.25)] disabled:opacity-50"
        onClick={() => void calculate()}
      >
        <EveIcon icon={icons.calculate} className="h-4 w-4" />
        {loading ? "Calc..." : "Calc"}
      </button>
    </div>
  );

  return (
    <ToolMobileShellV2
      title="Industry Planner"
      subtitle={topSubtitle}
      icon={icons.industry}
      actions={actions}
      navItems={navItems}
      activeView={view}
      onView={setView}
    >
      <style>{`
        .mobile-action-button {
          display: inline-flex;
          min-height: 2rem;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
          border: 1px solid #303236;
          background: #05070b;
          padding: 0 0.375rem;
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: #cbd5e1;
        }
        .mobile-industry-input {
          min-height: 2.25rem;
          border: 1px solid #303236;
          background: #05070b;
          padding: 0.25rem 0.5rem;
          font-size: 16px;
          line-height: 1.25;
          color: #f8fafc;
          outline: none;
        }
      `}</style>

      {error && (
        <div className="mb-1.5 border border-[#6b2b32] bg-[#1d090b] px-2 py-1.5 text-[12px] text-[#ffaaaa]">
          {error}
        </div>
      )}

      {view === "products" && (
        <ProductsView
          products={products}
          onSearch={searchProduct}
          onChoose={chooseSuggestion}
          onUpdate={updateProduct}
          onRemove={removeProduct}
        />
      )}
      {view === "settings" && (
        <SettingsView
          settings={settings}
          onSetting={updateSetting}
          onFacility={updateFacility}
        />
      )}
      {view === "results" && (
        <ResultsView
          plan={plan}
          rows={unitRows}
        />
      )}
      {view === "materials" && (
        <MaterialsView
          plan={plan}
          onCopy={copyBom}
        />
      )}
      {view === "jobs" && (
        <JobsView
          plan={plan}
          jobs={sortedJobs}
          treeMeta={treeMeta}
          overrides={overrides}
          jobMode={jobMode}
          jobSort={jobSort}
          onMode={setJobMode}
          onSortSheet={() => setSortSheetOpen(true)}
          onJobMode={updateJobMode}
        />
      )}

      {chainsSheetOpen && (
        <SavedChainsSheet
          authChecked={authChecked}
          authUser={authUser}
          chains={savedChains}
          loading={savedChainsLoading}
          busy={setupBusy}
          error={setupError}
          selectedChainId={selectedChainId}
          selectedChain={selectedChain}
          saveName={saveName}
          onClose={() => setChainsSheetOpen(false)}
          onSignIn={() => requestSiteAuthModal("login")}
          onSelect={(chain) => {
            setSelectedChainId(chain.id);
            setSaveName(chain.setupName);
            setSetupError("");
          }}
          onName={setSaveName}
          onRefresh={() => void refreshSavedChains(selectedChainId || undefined)}
          onSaveNew={() => void saveCurrentChain("create")}
          onUpdate={() => void saveCurrentChain("update")}
          onRename={() => void renameSelectedChain()}
          onLoad={() => void loadSavedChain()}
          onDelete={() => void deleteSelectedChain()}
        />
      )}

      {sortSheetOpen && (
        <ToolBottomSheetV2 title="Sort Jobs" subtitle="Choose mobile job order" onClose={() => setSortSheetOpen(false)}>
          {[
            ["tree", "Build order", "Inputs first, final product last"] as const,
            ["jobCost", "Job cost", "Highest job cost first"] as const,
            ["costShare", "% total cost", "Highest share first"] as const,
            ["runs", "Runs", "Most runs first"] as const,
            ["output", "Output name", "Alphabetical"] as const,
          ].map(([key, title, subtitle]) => (
            <ToolTouchRowV2
              key={key}
              title={title}
              subtitle={subtitle}
              active={jobSort === key}
              right={jobSort === key ? "set" : undefined}
              onClick={() => {
                setJobSort(key);
                setSortSheetOpen(false);
              }}
            />
          ))}
        </ToolBottomSheetV2>
      )}
    </ToolMobileShellV2>
  );
}

function SavedChainsSheet({
  authChecked,
  authUser,
  chains,
  loading,
  busy,
  error,
  selectedChainId,
  selectedChain,
  saveName,
  onClose,
  onSignIn,
  onSelect,
  onName,
  onRefresh,
  onSaveNew,
  onUpdate,
  onRename,
  onLoad,
  onDelete,
}: {
  authChecked: boolean;
  authUser: AuthUser | null;
  chains: SavedToolSetup[];
  loading: boolean;
  busy: "load" | "save" | "rename" | "delete" | null;
  error: string;
  selectedChainId: string;
  selectedChain: SavedToolSetup | null;
  saveName: string;
  onClose: () => void;
  onSignIn: () => void;
  onSelect: (chain: SavedToolSetup) => void;
  onName: (value: string) => void;
  onRefresh: () => void;
  onSaveNew: () => void;
  onUpdate: () => void;
  onRename: () => void;
  onLoad: () => void;
  onDelete: () => void;
}) {
  const disabled = Boolean(busy);

  return (
    <ToolBottomSheetV2
      title="Saved Chains"
      subtitle={authUser ? "Save and load industry plans" : "Sign in required"}
      onClose={onClose}
    >
      <div className="space-y-2 p-2">
        {!authChecked && (
          <div className="border border-[#20242c] bg-[#05070b] px-2 py-3 text-[12px] text-slate-400">
            Checking account...
          </div>
        )}

        {authChecked && !authUser && (
          <div className="space-y-2 border border-[#20242c] bg-[#05070b] p-2">
            <div className="text-[12px] text-slate-300">
              Saved industry chains are tied to your Triff.Tools account.
            </div>
            <button type="button" className="mobile-action-button min-h-9 w-full" onClick={onSignIn}>
              Sign In
            </button>
          </div>
        )}

        {authUser && (
          <>
            <section className="border border-[#2c2f36] bg-[#070910] p-2">
              <SectionTitle title={selectedChain ? "Selected Chain" : "Save Current Chain"} />
              <input
                className="mobile-industry-input w-full"
                value={saveName}
                placeholder="Chain name"
                disabled={disabled}
                onChange={(event) => onName(event.target.value)}
              />
              {selectedChain ? (
                <>
                  <div className="mt-2 grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      className="mobile-action-button min-h-9"
                      disabled={disabled}
                      onClick={onSaveNew}
                    >
                      Save New
                    </button>
                    <button
                      type="button"
                      className="mobile-action-button min-h-9"
                      disabled={disabled}
                      onClick={onUpdate}
                    >
                      {busy === "save" ? "Saving..." : "Update"}
                    </button>
                  </div>
                  <div className="mt-1 grid grid-cols-3 gap-1">
                    <button
                      type="button"
                      className="mobile-action-button min-h-9"
                      disabled={disabled}
                      onClick={onRename}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="mobile-action-button min-h-9"
                      disabled={disabled}
                      onClick={onLoad}
                    >
                      {busy === "load" ? "Loading..." : "Load"}
                    </button>
                    <button
                      type="button"
                      className="mobile-action-button min-h-9 border-[#6b2b32] text-[#ffaaaa]"
                      disabled={disabled}
                      onClick={onDelete}
                    >
                      Delete
                    </button>
                  </div>
                </>
              ) : (
                <div className="mt-2">
                  <button
                    type="button"
                    className="mobile-action-button min-h-9 w-full"
                    disabled={disabled}
                    onClick={onSaveNew}
                  >
                    {busy === "save" ? "Saving..." : "Save Chain"}
                  </button>
                </div>
              )}
            </section>

            {error && (
              <div className="border border-[#6b2b32] bg-[#1d090b] px-2 py-1.5 text-[12px] text-[#ffaaaa]">
                {error}
              </div>
            )}

            <section className="border border-[#2c2f36] bg-[#070910]">
              <div className="grid grid-cols-[1fr,82px] items-center gap-2 border-b border-[#151922] px-2 py-2">
                <SectionTitle title="Saved" />
                <button type="button" className="mobile-action-button min-h-8" disabled={disabled || loading} onClick={onRefresh}>
                  Refresh
                </button>
              </div>
              {loading && (
                <div className="px-2 py-3 text-[12px] text-slate-500">Loading saved chains...</div>
              )}
              {!loading && chains.length === 0 && (
                <div className="px-2 py-3 text-[12px] text-slate-500">No saved chains yet.</div>
              )}
              {!loading && chains.map((chain) => {
                const itemCount = Number(chain.summaryJson?.itemCount) || 0;
                const firstItem = chain.summaryJson?.firstItem || "Industry Chain";
                const subtitle = itemCount > 1 ? `${firstItem} + ${itemCount - 1}` : firstItem;
                return (
                  <ToolTouchRowV2
                    key={chain.id}
                    title={chain.setupName}
                    subtitle={subtitle}
                    icon={<EveIcon icon={icons.chains} className="h-5 w-5 text-[#8bd3ff]" />}
                    active={chain.id === selectedChainId}
                    right={chain.id === selectedChainId ? "selected" : undefined}
                    onClick={() => onSelect(chain)}
                  />
                );
              })}
            </section>
          </>
        )}
      </div>
    </ToolBottomSheetV2>
  );
}

function ProductsView({
  products,
  onSearch,
  onChoose,
  onUpdate,
  onRemove,
}: {
  products: ProductInput[];
  onSearch: (id: number, query: string) => Promise<void>;
  onChoose: (id: number, suggestion: TypeSuggestion) => void;
  onUpdate: (id: number, patch: Partial<ProductInput>) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      {products.map((product) => (
        <section key={product.id} className="border border-[#2c2f36] bg-[#070910]">
          <div className="grid grid-cols-[40px,1fr,34px] gap-2 border-b border-[#151922] px-2 py-2">
            {product.typeId ? (
              <img src={typeIconUrl(product.typeId)} alt="" className="h-9 w-9" />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center border border-[#303236] bg-[#05070b] text-[#8bd3ff]">
                <EveIcon icon={icons.products} className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0">
              <input
                className="mobile-industry-input w-full"
                value={product.query}
                placeholder="Product name..."
                onChange={(event) => void onSearch(product.id, event.target.value)}
              />
              {product.typeName && (
                <div className="mt-1 truncate font-mono text-[10px] text-slate-500">
                  {product.typeName} ({product.typeId})
                </div>
              )}
            </div>
            <button
              type="button"
              className="flex h-9 w-8 items-center justify-center text-[#ffaaaa]"
              onClick={() => onRemove(product.id)}
              aria-label="Remove product"
            >
              x
            </button>
          </div>

          {product.suggestions.length > 0 && (
            <div className="divide-y divide-[#151922] border-b border-[#151922]">
              {product.suggestions.map((suggestion) => (
                <ToolTouchRowV2
                  key={suggestion.type_id}
                  title={suggestion.name}
                  subtitle={`typeID ${suggestion.type_id}`}
                  icon={<img src={typeIconUrl(suggestion.type_id)} alt="" className="h-7 w-7" />}
                  onClick={() => onChoose(product.id, suggestion)}
                />
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 px-2 py-2">
            <label className="min-w-0">
              <span className="mb-1 block text-[9px] uppercase tracking-widest text-slate-500">Quantity</span>
              <input
                type="number"
                min={1}
                className="mobile-industry-input w-full text-right"
                value={product.quantity}
                onChange={(event) => onUpdate(product.id, { quantity: Math.max(1, Math.floor(numberInput(event.target.value) || 1)) })}
              />
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[9px] uppercase tracking-widest text-slate-500">Runs/BPC</span>
              <input
                type="number"
                min={1}
                className="mobile-industry-input w-full text-right"
                value={product.runsPerBpc}
                onChange={(event) => onUpdate(product.id, { runsPerBpc: Math.max(1, Math.floor(numberInput(event.target.value) || 1)) })}
              />
            </label>
          </div>
        </section>
      ))}
    </div>
  );
}

function SettingsView({
  settings,
  onSetting,
  onFacility,
}: {
  settings: IndustrySettings;
  onSetting: <K extends keyof IndustrySettings>(key: K, value: IndustrySettings[K]) => void;
  onFacility: (key: "productFacility" | "componentFacility" | "reactionFacility", patch: Partial<FacilityConfig>) => void;
}) {
  return (
    <div className="space-y-1.5">
      <section className="border border-[#2c2f36] bg-[#070910] p-2">
        <SectionTitle title="Pricing" />
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Input" value={settings.inputPriceMode} onChange={(value) => onSetting("inputPriceMode", value as "buy" | "sell")} options={[["sell", "Sell Min"], ["buy", "Buy Max"]]} />
          <SelectField label="Output" value={settings.outputPriceMode} onChange={(value) => onSetting("outputPriceMode", value as "buy" | "sell")} options={[["buy", "Buy Max"], ["sell", "Sell Min"]]} />
        </div>
      </section>

      <section className="border border-[#2c2f36] bg-[#070910] p-2">
        <SectionTitle title="Costs" />
        <div className="space-y-2">
          <NumberSetting label="Manufacturing System Cost Index %" value={settings.systemCostIndexManufacturing * 100} step="0.01" onChange={(value) => onSetting("systemCostIndexManufacturing", value / 100)} />
          <NumberSetting label="Reaction System Cost Index %" value={settings.systemCostIndexReactions * 100} step="0.01" onChange={(value) => onSetting("systemCostIndexReactions", value / 100)} />
          <NumberSetting label="Facility Tax %" value={settings.facilityTax * 100} step="0.01" onChange={(value) => onSetting("facilityTax", value / 100)} />
          <NumberSetting label="SCC Surcharge" value={settings.sccSurcharge} step="0.001" onChange={(value) => onSetting("sccSurcharge", value)} />
          <NumberSetting label="Additional Cost" value={settings.additionalCost} step="1" onChange={(value) => onSetting("additionalCost", value)} />
        </div>
      </section>

      <section className="border border-[#2c2f36] bg-[#070910] p-2">
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle title="Facilities" />
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-300">
            <input
              type="checkbox"
              checked={settings.includeReactions}
              className="h-4 w-4 accent-[#53b6ff]"
              onChange={(event) => onSetting("includeReactions", event.target.checked)}
            />
            Reactions
          </label>
        </div>
        <FacilityPicker title="Final Products" facility={settings.productFacility} me={settings.productMe} onMe={(value) => onSetting("productMe", value)} onFacility={(patch) => onFacility("productFacility", patch)} />
        <FacilityPicker title="Components" facility={settings.componentFacility} me={settings.componentMe} onMe={(value) => onSetting("componentMe", value)} onFacility={(patch) => onFacility("componentFacility", patch)} />
        {settings.includeReactions && (
          <FacilityPicker title="Reactions" facility={settings.reactionFacility} me={settings.reactionMe} onMe={(value) => onSetting("reactionMe", value)} onFacility={(patch) => onFacility("reactionFacility", patch)} reaction />
        )}
      </section>
    </div>
  );
}

function ResultsView({ plan, rows }: { plan: MobileIndustryPlan | null; rows: UnitEconomicsRow[] }) {
  if (!plan) return <EmptyState title="No plan yet" subtitle="Add a product and calculate to see results." />;
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <SummaryTile label="Output Value" value={isk(plan.summary.totalOutputValue)} />
        <SummaryTile label="Profit" value={isk(plan.summary.profit)} accent={(plan.summary.profit || 0) >= 0 ? "good" : "bad"} sub={plan.summary.totalOutputValue ? `${((plan.summary.profitMargin || 0) * 100).toFixed(2)}%` : undefined} />
        <SummaryTile label="Materials" value={isk(plan.summary.totalMaterialCost)} sub="Leaf buy inputs" />
        <SummaryTile label="Job Costs" value={isk(plan.summary.totalJobCost)} sub="EIV + taxes" />
        <SummaryTile label="Additional" value={isk(plan.summary.additionalCost)} />
        <SummaryTile label="Grand Total" value={isk(plan.summary.grandTotal)} accent="blue" />
      </div>
      {rows.length > 0 && (
        <div className="divide-y divide-[#151922] border border-[#2c2f36] bg-[#070910]">
          <div className="px-2 py-2">
            <SectionTitle title="Unit Economics" />
          </div>
          {rows.map((row) => (
            <div key={row.typeId} className="grid grid-cols-[34px,1fr] gap-2 px-2 py-2">
              <img src={typeIconUrl(row.typeId)} alt="" className="h-8 w-8" />
              <div className="min-w-0">
                <div className="truncate text-[12px] text-slate-100">{row.typeName}</div>
                <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px] text-slate-500">
                  <span>Qty {row.quantity.toLocaleString()}</span>
                  <span>Margin {(row.margin * 100).toFixed(2)}%</span>
                  <span>Cost {isk(row.unitCost)}</span>
                  <span>Value {isk(row.unitValue)}</span>
                  <span className={row.unitProfit >= 0 ? "text-emerald-300" : "text-rose-300"}>Profit {isk(row.unitProfit)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MaterialsView({ plan, onCopy }: { plan: MobileIndustryPlan | null; onCopy: (bufferPct?: number) => void }) {
  if (!plan) return <EmptyState title="No BOM yet" subtitle="Calculate a plan to generate materials." />;
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-1">
        <button type="button" className="mobile-action-button" onClick={() => onCopy(0)}>Copy List</button>
        <button type="button" className="mobile-action-button" onClick={() => onCopy(0.07)}>Copy +7%</button>
      </div>
      <div className="divide-y divide-[#151922] border border-[#2c2f36] bg-[#070910]">
        {plan.bom.map((row) => <BomMobileRow key={row.typeId} row={row} />)}
      </div>
    </div>
  );
}

function JobsView({
  plan,
  jobs,
  treeMeta,
  overrides,
  jobMode,
  jobSort,
  onMode,
  onSortSheet,
  onJobMode,
}: {
  plan: MobileIndustryPlan | null;
  jobs: FlatJob[];
  treeMeta: Map<number, { order: number; depth: number }>;
  overrides: Record<number, "build" | "buy">;
  jobMode: JobMode;
  jobSort: JobSortKey;
  onMode: (mode: JobMode) => void;
  onSortSheet: () => void;
  onJobMode: (job: FlatJob, mode: "build" | "buy") => void;
}) {
  if (!plan) return <EmptyState title="No jobs yet" subtitle="Calculate a plan to generate build steps." />;
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1fr,88px] gap-1">
        <Segmented value={jobMode} onChange={onMode} options={[["jobs", "Jobs"], ["tree", "Tree"]]} />
        <button type="button" className="mobile-action-button" onClick={onSortSheet}>
          Sort
        </button>
      </div>
      {jobMode === "jobs" ? (
        <div className="divide-y divide-[#151922] border border-[#2c2f36] bg-[#070910]">
          {jobs.map((job) => (
            <JobMobileRow
              key={job.id}
              job={job}
              depth={treeMeta.get(job.outputTypeId)?.depth || 0}
              mode={overrides[job.outputTypeId] || "build"}
              share={jobCostShare(job, plan)}
              sortActive={jobSort !== "tree"}
              onMode={(mode) => onJobMode(job, mode)}
            />
          ))}
        </div>
      ) : (
        <TreeMobileView nodes={plan.tree} />
      )}
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <div className="mb-2 text-[10px] uppercase tracking-widest text-slate-300">{title}</div>;
}

function NumberSetting({ label, value, step, onChange }: { label: string; value: number; step: string; onChange: (value: number) => void }) {
  return (
    <label className="grid grid-cols-[1fr,110px] items-center gap-2">
      <span className="text-[10px] uppercase tracking-widest text-slate-500">{label}</span>
      <input
        type="number"
        step={step}
        className="mobile-industry-input w-full text-right"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(numberInput(event.target.value))}
      />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] uppercase tracking-widest text-slate-500">{label}</span>
      <select className="mobile-industry-input w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([key, labelText]) => <option key={key} value={key}>{labelText}</option>)}
      </select>
    </label>
  );
}

function FacilityPicker({
  title,
  facility,
  me,
  reaction,
  onMe,
  onFacility,
}: {
  title: string;
  facility: FacilityConfig;
  me: number;
  reaction?: boolean;
  onMe: (value: number) => void;
  onFacility: (patch: Partial<FacilityConfig>) => void;
}) {
  return (
    <div className="mb-2 border border-[#20242c] bg-[#05070b] p-2 last:mb-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-slate-300">{title}</div>
        <label className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-slate-500">
          ME
          <input
            type="number"
            min={0}
            max={10}
            className="mobile-industry-input h-8 w-16 text-right"
            value={me}
            onChange={(event) => onMe(Math.max(0, Math.min(10, numberInput(event.target.value))))}
          />
        </label>
      </div>
      <div className="grid grid-cols-3 gap-1">
        <SelectField label="Structure" value={facility.structure} onChange={(value) => onFacility({ structure: value as FacilityConfig["structure"] })} options={reaction ? [["NPC_STATION", "NPC"], ["ATHANOR", "Athanor"], ["TATARA", "Tatara"]] : [["NPC_STATION", "NPC"], ["RAITARU", "Raitaru"], ["AZBEL", "Azbel"], ["SOTIYO", "Sotiyo"]]} />
        <SelectField label="Rig" value={facility.rig} onChange={(value) => onFacility({ rig: value as FacilityConfig["rig"] })} options={[["NONE", "None"], ["T1", "T1"], ["T2", "T2"]]} />
        <SelectField label="Sec" value={facility.security} onChange={(value) => onFacility({ security: value as FacilityConfig["security"] })} options={[["HIGH", "High"], ["LOW", "Low"], ["NULL_WH", "Null/WH"]]} />
      </div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <div className="grid min-h-9 grid-cols-2 border border-[#303236] bg-[#05070b]">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={`text-[10px] uppercase tracking-widest ${value === key ? "bg-[#101721] text-[#8bd3ff]" : "text-slate-500 active:bg-[#0d1118] active:text-slate-300"}`}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SummaryTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "good" | "bad" | "blue" }) {
  const color = accent === "good" ? "text-emerald-300" : accent === "bad" ? "text-rose-300" : accent === "blue" ? "text-[#8bd3ff]" : "text-slate-100";
  return (
    <div className="min-h-[76px] border border-[#2c2f36] bg-[#070910] px-2 py-2">
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`mt-1 font-mono text-[13px] ${color}`}>{value}</div>
      {sub && <div className="mt-1 truncate text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

function BomMobileRow({ row }: { row: BomRow & { volume?: number; lineVolume?: number } }) {
  return (
    <div className="grid grid-cols-[34px,1fr] gap-2 px-2 py-2">
      <img src={typeIconUrl(row.typeId)} alt="" className="h-8 w-8" />
      <div className="min-w-0">
        <div className="truncate text-[12px] text-slate-100">{row.typeName}</div>
        <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px] text-slate-500">
          <span>Need {row.quantity.toLocaleString()}</span>
          <span>Total {isk(row.totalPrice)}</span>
          <span>Unit {isk(row.unitPrice)}</span>
          <span>m3 {Number(row.lineVolume ?? (row.volume || 0) * row.quantity).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
      </div>
    </div>
  );
}

function JobMobileRow({ job, depth, mode, share, sortActive, onMode }: { job: FlatJob; depth: number; mode: "build" | "buy"; share: number; sortActive: boolean; onMode: (mode: "build" | "buy") => void }) {
  return (
    <div className="px-2 py-2">
      <div className="grid grid-cols-[34px,1fr] gap-2">
        <img src={typeIconUrl(job.outputTypeId)} alt="" className="h-8 w-8" />
        <div className="min-w-0" style={{ paddingLeft: sortActive ? 0 : Math.min(depth, 5) * 10 }}>
          <div className="grid grid-cols-[1fr,92px] items-start gap-2">
            <div className="min-w-0">
              <div className="truncate text-[12px] text-slate-100">{job.outputTypeName}</div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
                {job.activity} - {job.outputQuantity.toLocaleString()} total
              </div>
            </div>
            <select className="mobile-industry-input h-8 w-full py-0 text-[12px]" value={mode} onChange={(event) => onMode(event.target.value as "build" | "buy")}>
              <option value="build">Build</option>
              <option value="buy">Buy</option>
            </select>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px] text-slate-500">
            <span>Runs {job.runs.toLocaleString()}</span>
            <span>Share {(share * 100).toFixed(1)}%</span>
            <span>Job {isk(job.jobCost)}</span>
            <span>Unit {isk(job.jobCostPerUnit)}</span>
          </div>
        </div>
      </div>
      {job.materials.length > 0 && (
        <div className="mt-2 border border-[#20242c] bg-[#05070b] px-2 py-1.5">
          <div className="mb-1 text-[9px] uppercase tracking-widest text-slate-500">
            Inputs
          </div>
          <div className="space-y-1">
            {job.materials.map((mat) => (
              <div
                key={mat.typeId}
                className="grid min-h-7 grid-cols-[28px,1fr,auto] items-center gap-2 text-[10px] leading-4"
              >
                <img src={typeIconUrl(mat.typeId, 32)} alt="" className="h-6 w-6" />
                <span className="min-w-0 break-words text-slate-300">{mat.typeName}</span>
                <span className="font-mono text-slate-500">{mat.quantity.toLocaleString()}x</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TreeMobileView({ nodes }: { nodes: TreeNode[] }) {
  return (
    <div className="border border-[#2c2f36] bg-[#070910]">
      {nodes.map((node) => <TreeNodeRow key={node.id} node={node} depth={0} />)}
    </div>
  );
}

function TreeNodeRow({ node, depth }: { node: TreeNode; depth: number }) {
  return (
    <div>
      <div className="border-b border-[#151922] px-2 py-1.5 text-[11px] text-slate-200" style={{ paddingLeft: 8 + Math.min(depth, 8) * 14 }}>
        {node.label}
      </div>
      {node.children?.map((child) => <TreeNodeRow key={child.id} node={child} depth={depth + 1} />)}
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex min-h-[48vh] flex-col items-center justify-center border border-[#20242c] bg-[#070910] p-5 text-center">
      <EveIcon icon={icons.industry} className="mb-3 h-12 w-12 text-slate-600" />
      <div className="text-[13px] uppercase tracking-widest text-slate-300">{title}</div>
      <div className="mt-1 text-[12px] text-slate-600">{subtitle}</div>
    </div>
  );
}

function jobCostShare(job: FlatJob, plan: MobileIndustryPlan | null) {
  const total = Number(plan?.summary?.grandTotal) || 0;
  return total > 0 ? (Number(job.jobCost) || 0) / total : 0;
}
