/*
 * Public Item Browser detail page.
 * Conservative EVE type summary using local SDE, market, dogma, and industry sources.
 */

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  BatteryCharging,
  Bookmark,
  Copy,
  Cpu,
  Crosshair,
  Database,
  ExternalLink,
  Hammer,
  Layers,
  Navigation,
  Package,
  Search,
  Shield,
  Target,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ToolChrome } from "../components/tool-ui";
import { useItemBookmarks } from "../items/itemBookmarks";

type ItemDetailPayload = {
  ok: boolean;
  item?: ItemSummary;
  market?: MarketSummary;
  dogma?: DogmaRow[];
  traits?: ItemTraits | null;
  industry?: IndustrySummary;
  tools?: ToolLink[];
  error?: string;
};

type NamedGroup = { market_group_id: number; name: string | null };

type ItemSummary = {
  type_id: number;
  name: string;
  description: string | null;
  published: boolean;
  group: { group_id: number; name: string | null } | null;
  category: { category_id: number; name: string | null } | null;
  market_group: NamedGroup | null;
  market_group_path?: NamedGroup[];
  volume: number | null;
  packaged_volume: number | null;
  mass: number | null;
  capacity: number | null;
  portion_size: number | null;
  radius: number | null;
  icon_url: string | null;
  render_url: string;
};

type MarketSummary = {
  available: boolean;
  station: string;
  station_id: number;
  sell_min: string | number | null;
  buy_max: string | number | null;
  sell_5pct: string | number | null;
  buy_5pct: string | number | null;
  updated_at: string | null;
};

type DogmaRow = {
  attribute_id: number;
  name: string | null;
  display_name: string;
  unit: number | null;
  category_id?: number | null;
  value: string | number | null;
  display_value?: string | null;
  reference?: DogmaReference | null;
};

type DogmaReference = {
  kind: "type" | "group";
  id: number;
  name: string | null;
  path?: string | null;
};

type TraitBonus = {
  bonus: number | null;
  unit: string | null;
  unit_id: number | null;
  text: string;
};

type TraitSkillGroup = {
  skill_type_id: number;
  skill_name: string | null;
  bonuses: TraitBonus[];
};

type ItemTraits = {
  miscBonuses: TraitBonus[];
  roleBonuses: TraitBonus[];
  types: TraitSkillGroup[];
};

type ItemSearchResult = {
  type_id: number;
  name: string;
  description: string | null;
  published: boolean;
  group: { group_id: number; name: string | null } | null;
  category: { category_id: number; name: string | null } | null;
  market_group: { market_group_id: number; name: string | null } | null;
  icon_url: string | null;
};

type IndustryLink = {
  blueprint_type_id: number | null;
  blueprint_name: string | null;
  product_type_id?: number | null;
  product_name?: string | null;
  activity?: string | null;
  activity_id: number | null;
  quantity: number | null;
  product_quantity?: number | null;
};

type IndustrySummary = {
  blueprint_products?: IndustryLink[];
  produced_by: IndustryLink[];
  used_in: IndustryLink[];
};

type ToolLink = {
  label: string;
  path: string;
};

type QuickAction = {
  key: string;
  label: string;
  path?: string;
  copy?: "type_id" | "name";
};

type ItemOpenHandler = (typeId: number) => void;

type AttributeDisplayRow = {
  key: string;
  label: string;
  value: string | number | null;
  formatted?: string;
  attrId?: number;
  unit?: number | null;
  rawValue?: string | number | null;
  displayValue?: string | null;
  reference?: DogmaReference | null;
};

type AttributeSection = {
  key: string;
  label: string;
  rows: AttributeDisplayRow[];
};

type DefenseLayer = {
  key: "shield" | "armor" | "structure";
  label: string;
  hp: number | null;
  resists: Record<DamageKey, number | null>;
};

type DamageKey = "em" | "thermal" | "kinetic" | "explosive";

const EMPTY = "\u2014";
const CUBIC_METERS = " m\u00b3";
const panel = "tt2-panel overflow-hidden shadow-[0_10px_24px_rgba(0,0,0,0.22)]";
const panelHeader =
  "tt2-panel-head tt2-panel-title shadow-[inset_2px_0_0_rgba(83,182,255,0.32)]";
const button =
  "tt2-button tt2-button--secondary tt2-button--sm";
const RELATION_COLLAPSED_LIMIT = 5;
const RELATION_EXPANDED_VISIBLE_ROWS = 10;
const RELATION_EXPANDED_BATCH = 30;
const ATTRIBUTE_SECTIONS = [
  ["basic", "Basic"],
  ["resistances", "Resistances"],
  ["fitting", "Fitting"],
  ["rigging", "Rigging"],
  ["targeting", "Targeting"],
  ["navigation", "Navigation"],
  ["drones", "Drones"],
  ["capacitor", "Capacitor"],
  ["shield", "Shield"],
  ["armor", "Armor"],
  ["structure", "Structure"],
  ["mining", "Mining / Resource"],
  ["industry", "Industry"],
  ["other", "Other"],
  ["typeInfo", "Type Info"],
] as const;
const ATTRIBUTE_SECTION_LABELS = new Map(ATTRIBUTE_SECTIONS.map(([key, label]) => [key, label]));
const ATTRIBUTE_THREE_COLUMN_LAYOUT = [
  ["basic", "fitting", "mining"],
  ["resistances", "shield", "armor", "structure", "capacitor", "rigging", "other"],
  ["targeting", "navigation", "drones", "industry", "typeInfo"],
];
const ATTRIBUTE_TWO_COLUMN_LAYOUT = [
  ["basic", "fitting", "rigging", "mining", "targeting", "navigation", "drones"],
  ["resistances", "shield", "armor", "structure", "capacitor", "industry", "typeInfo", "other"],
];
const SECTION_ICONS: Record<string, LucideIcon> = {
  basic: Database,
  resistances: Activity,
  fitting: Cpu,
  rigging: Layers,
  targeting: Crosshair,
  navigation: Navigation,
  drones: Target,
  capacitor: BatteryCharging,
  shield: Shield,
  armor: Layers,
  structure: Package,
  mining: Hammer,
  industry: Hammer,
  other: Database,
  typeInfo: Database,
};
const DAMAGE_TYPES: { key: DamageKey; label: string; color: string; fill: string }[] = [
  { key: "em", label: "EM", color: "text-[#7dd3fc]", fill: "bg-[#7dd3fc]" },
  { key: "thermal", label: "TH", color: "text-[#fca5a5]", fill: "bg-[#f87171]" },
  { key: "kinetic", label: "KI", color: "text-slate-300", fill: "bg-slate-300" },
  { key: "explosive", label: "EX", color: "text-[#fdba74]", fill: "bg-[#fb923c]" },
];

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtNumber(value: unknown, suffix = "") {
  const n = num(value);
  if (n == null) return EMPTY;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}${suffix}`;
}

function fmtCompactNumber(value: number, maximumFractionDigits = 2) {
  return value.toLocaleString(undefined, { maximumFractionDigits });
}

function fmtIsk(value: unknown) {
  const n = num(value);
  if (n == null) return EMPTY;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ISK`;
}

function fmtDate(value: string | null | undefined) {
  if (!value) return EMPTY;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function lower(value: string | null | undefined) {
  return String(value || "").toLowerCase();
}

function dogmaText(row: DogmaRow) {
  return `${row.display_name || ""} ${row.name || ""}`.toLowerCase();
}

function includesAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle));
}

function metaLine(item: ItemSearchResult) {
  return [
    `typeID ${item.type_id}`,
    item.group?.name,
    item.market_group?.name,
    item.category?.name,
  ]
    .filter(Boolean)
    .join(" - ");
}

function isImmediateNumeric(value: string) {
  return /^\d+$/.test(value.trim());
}

function itemTypeIdFromPath(path: string) {
  const match = path.match(/^\/items\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function itemIdentityText(item: ItemSummary) {
  return [
    item.name,
    item.category?.name,
    item.group?.name,
    item.market_group?.name,
    ...(item.market_group_path || []).map((entry) => entry.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isResourceLikeItem(item: ItemSummary) {
  const category = lower(item.category?.name);
  if (includesAny(category, ["ship", "module", "structure", "drone", "charge"])) return false;
  if (includesAny(category, ["asteroid", "material"])) return true;

  const identity = itemIdentityText(item);
  return includesAny(identity, [
    "ore",
    "mineral",
    "ice",
    "gas cloud",
    "harvestable cloud",
    "raw material",
    "salvaged material",
    "planetary material",
    "moon material",
    "reaction material",
  ]);
}

function isResourceNoiseSection(key: string) {
  return [
    "resistances",
    "fitting",
    "targeting",
    "navigation",
    "drones",
    "capacitor",
    "shield",
    "armor",
    "structure",
    "rigging",
  ].includes(key);
}

function copyText(value: string) {
  if (!value) return;
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function marketPath(item: ItemSummary) {
  const path = item.market_group_path?.filter((entry) => entry.name) || [];
  if (path.length) return path;
  return item.market_group ? [item.market_group] : [];
}

function marketPathText(item: ItemSummary) {
  const path = marketPath(item).map((entry) => entry.name).filter(Boolean);
  return path.length ? path.join(" > ") : EMPTY;
}

function itemClassifierText(item: ItemSummary, industry?: IndustrySummary) {
  const pathText = marketPath(item)
    .map((entry) => entry.name)
    .filter(Boolean)
    .join(" ");
  const industryText = [
    ...(industry?.produced_by || []).map((row) => row.activity),
    ...(industry?.used_in || []).map((row) => row.activity),
  ].join(" ");
  return [
    item.name,
    item.category?.name,
    item.group?.name,
    item.market_group?.name,
    pathText,
    industryText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isBlueprintItem(item: ItemSummary) {
  const text = [
    item.name,
    item.category?.name,
    item.group?.name,
    item.market_group?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return lower(item.category?.name) === "blueprint" || lower(item.group?.name).includes("blueprint") || text.includes(" blueprint");
}

function reactionFamilyForBlueprintId(blueprintTypeId: number | null | undefined) {
  const id = Number(blueprintTypeId);
  if (!Number.isFinite(id)) return null;
  if (id >= 46157 && id <= 46165) return "Hybrid";
  if ((id >= 46166 && id <= 46218) || [57490, 57491, 57492, 57493, 57494].includes(id)) return "Composite";
  if ((id >= 46219 && id <= 46251) || (id >= 57495 && id <= 57506)) return "Biochemical";
  return null;
}

function isReactionRow(row: IndustryLink) {
  return row.activity === "reaction" || Number(row.activity_id) === 11;
}

function reactionRecipeBlueprintId(industry?: IndustrySummary) {
  const formulaProduct = (industry?.blueprint_products || []).find((row) => isReactionRow(row) && row.blueprint_type_id);
  if (formulaProduct?.blueprint_type_id) return Number(formulaProduct.blueprint_type_id);
  const producedBy = (industry?.produced_by || []).find((row) => isReactionRow(row) && row.blueprint_type_id);
  return producedBy?.blueprint_type_id ? Number(producedBy.blueprint_type_id) : null;
}

function reactionRecipePath(blueprintTypeId: number) {
  const family = reactionFamilyForBlueprintId(blueprintTypeId);
  const params = new URLSearchParams({
    blueprint_id: String(blueprintTypeId),
    open: "1",
  });
  if (family) params.set("family", family);
  return `/reaction-calc?${params.toString()}`;
}

function denyReactionInputQuickLink(item: ItemSummary) {
  const text = itemClassifierText(item);
  return includesAny(text, ["fuel block", "planetary", "planetary commodities", "planetary materials"]) || lower(item.name) === "water";
}

function isPlanetaryInteractionItem(item: ItemSummary, classifierText = itemClassifierText(item)) {
  return includesAny(classifierText, [
    "planetary",
    "planetary commodities",
    "planetary materials",
    "planetary resources",
    "planetary interaction",
  ]);
}

function reactionInputPath(item: ItemSummary, industry?: IndustrySummary) {
  if (denyReactionInputQuickLink(item)) return null;
  const rows = (industry?.used_in || []).filter(isReactionRow);
  if (!rows.length) return null;
  const families = Array.from(
    new Set(rows.map((row) => reactionFamilyForBlueprintId(row.blueprint_type_id)).filter(Boolean) as string[])
  );
  const params = new URLSearchParams({ input_type_id: String(item.type_id) });
  params.set("family", families.length === 1 ? families[0] : "All");
  return `/reaction-calc?${params.toString()}`;
}

function buildQuickActions(item: ItemSummary, industry?: IndustrySummary): QuickAction[] {
  const text = itemClassifierText(item, industry);
  const category = lower(item.category?.name);
  const group = lower(item.group?.name);
  const isBlueprint = category === "blueprint" || group.includes("blueprint") || text.includes(" blueprint");
  const isOre =
    category === "asteroid" ||
    includesAny(text, [" ore", "compressed", "asteroid", "mercoxit", "gneiss", "jaspet", "hedbergite", "hemorphite"]);
  const isGas = includesAny(text, [" gas", "fullerite", "mykoserocin", "cytoserocin", "cloud"]);
  const isPi = isPlanetaryInteractionItem(item, text);
  const isProduced = (industry?.produced_by || []).length > 0;
  const isShip = category === "ship";

  const actions: QuickAction[] = [];
  const add = (action: QuickAction) => {
    if (!actions.some((existing) => existing.key === action.key)) actions.push(action);
  };

  const recipeBlueprintId = reactionRecipeBlueprintId(industry);
  if (recipeBlueprintId) {
    add({ key: "reactions", label: "Open Reaction Recipe", path: reactionRecipePath(recipeBlueprintId) });
  } else {
    const inputPath = reactionInputPath(item, industry);
    if (inputPath) add({ key: "reactions", label: "Find Reactions Using This", path: inputPath });
  }

  if (isBlueprint) {
    const productTypeId = industry?.blueprint_products?.find((row) => row.product_type_id)?.product_type_id || null;
    // The Industry calculator expects the produced item typeID, not the blueprint typeID.
    add({
      key: "industry",
      label: "Open Industry Cost Calculator",
      path: productTypeId ? `/industry?type_id=${productTypeId}` : "/industry",
    });
  } else {
    if (isPi) {
      add({ key: "pi", label: "Open PI Calculator", path: "/pi-calc" });
    }
    if (isOre) {
      add({ key: "ore", label: "Open Ore Calculator", path: "/ore" });
    }
    if (isGas) {
      add({ key: "gas", label: "Open Gas Calculator", path: "/gas-calc" });
    }
    if (isProduced) {
      add({ key: "industry", label: "Open Industry Cost Calculator", path: `/industry?type_id=${item.type_id}` });
    }
    if (isShip) {
      add({ key: "fitting", label: "Open Fitting Tool", path: `/fitting?type_id=${item.type_id}` });
    }
  }

  add({ key: "market", label: "Open Market Browser", path: `/market?type_id=${item.type_id}` });
  return actions.slice(0, 6);
}

function physicalInfoRows(item: ItemSummary): AttributeDisplayRow[] {
  return [
    { key: "type-volume", label: "Volume", value: item.volume, formatted: fmtNumber(item.volume, CUBIC_METERS) },
    {
      key: "type-packaged-volume",
      label: "Packaged Volume",
      value: item.packaged_volume,
      formatted: fmtNumber(item.packaged_volume, CUBIC_METERS),
    },
    { key: "type-mass", label: "Mass", value: item.mass, formatted: fmtNumber(item.mass, " kg") },
    { key: "type-capacity", label: "Capacity", value: item.capacity, formatted: fmtNumber(item.capacity, CUBIC_METERS) },
    { key: "type-portion-size", label: "Industry Batch Size", value: item.portion_size, formatted: fmtNumber(item.portion_size) },
    { key: "type-radius", label: "Size", value: item.radius, formatted: fmtNumber(item.radius, " m") },
  ];
}

function typeInfoRows(item: ItemSummary): AttributeDisplayRow[] {
  return [
    { key: "type-id", label: "TypeID", value: item.type_id, formatted: String(item.type_id) },
    { key: "type-category", label: "Category", value: item.category?.name || null, formatted: item.category?.name || EMPTY },
    { key: "type-group", label: "Group", value: item.group?.name || null, formatted: item.group?.name || EMPTY },
    { key: "type-market-group", label: "Market Group", value: marketPathText(item), formatted: marketPathText(item) },
    { key: "type-published", label: "Published", value: item.published ? "yes" : "no", formatted: item.published ? "yes" : "no" },
  ];
}

function attributeSectionKey(row: DogmaRow) {
  const text = dogmaText(row);

  if (includesAny(text, ["meta level", "tech level", "item damage"])) return "basic";
  if (includesAny(text, ["rig slots", "rig size", "calibration"])) return "rigging";
  if (text.includes("resistance")) return "resistances";
  if (includesAny(text, ["cargo", "hold", "bay"])) return "basic";
  if (includesAny(text, ["cpu", "powergrid", "power load", "slots", "hardpoints"])) return "fitting";
  if (includesAny(text, ["target", "sensor", "scan", "signature radius", "locked targets"])) return "targeting";
  if (includesAny(text, ["velocity", "warp", "inertia", "agility"])) return "navigation";
  if (includesAny(text, ["drone", "fighter"])) return "drones";
  if (includesAny(text, ["capacitor", "activation cost"])) return "capacitor";
  if (text.includes("shield")) return "shield";
  if (text.includes("armor")) return "armor";
  if (text.includes("structure")) return "structure";
  if (includesAny(text, ["mining", "asteroid", "reprocessing", "ore", "gas", "resource", "harvest", "residue", "crystal"])) {
    return "mining";
  }
  if (includesAny(text, ["manufacturing", "reaction", "industry", "job", "material"])) return "industry";
  if (includesAny(text, ["skill required", "required", "can be fitted", "used with", "race", "faction", "group"])) {
    return "typeInfo";
  }
  return "other";
}

function isLayerDamageResistanceText(text: string) {
  return (
    includesAny(text, ["shield", "armor", "structure"]) &&
    includesAny(text, ["em", "thermal", "kinetic", "explosive"]) &&
    text.includes("damage resistance")
  );
}

function isLayerDamageResistanceRow(row: DogmaRow) {
  return isLayerDamageResistanceText(dogmaText(row));
}

function isDefenseHitpointRow(row: DogmaRow) {
  return includesAny(dogmaText(row), ["shield capacity", "armor hitpoints", "structure hitpoints"]);
}

function isFittingLoadRow(row: DogmaRow) {
  const text = dogmaText(row);
  return text.includes("cpu load") || text.includes("power load");
}

function isZeroSensorStrengthRow(row: DogmaRow) {
  return dogmaText(row).includes("sensor strength") && num(row.value) === 0;
}

function isMaximumDirectionalScanRangeRow(row: DogmaRow) {
  return dogmaText(row).includes("maximum directional scan range");
}

function isDuplicateSectionRow(existingRows: AttributeDisplayRow[], row: AttributeDisplayRow) {
  const label = row.label.toLowerCase();
  return existingRows.some((existing) => existing.label.toLowerCase() === label);
}

function dogmaDisplayRow(row: DogmaRow): AttributeDisplayRow {
  return {
    key: `dogma-${row.attribute_id}`,
    label: row.display_name,
    value: row.value,
    rawValue: row.value,
    attrId: row.attribute_id,
    unit: row.unit,
    displayValue: row.display_value || null,
    reference: row.reference || null,
  };
}

function basicRowRank(row: AttributeDisplayRow) {
  const physicalOrder = [
    "type-volume",
    "type-packaged-volume",
    "type-mass",
    "type-capacity",
    "type-portion-size",
    "type-radius",
  ];
  const physicalIndex = physicalOrder.indexOf(row.key);
  if (physicalIndex >= 0) return physicalIndex;

  const text = row.label.toLowerCase();
  if (includesAny(text, ["cargo", "hold", "bay"])) return 900;
  return 100;
}

function fittingRowRank(row: AttributeDisplayRow) {
  const text = row.label.toLowerCase();
  if (text.includes("cpu output")) return 10;
  if (text.includes("powergrid output")) return 20;
  if (text.includes("turret hardpoints")) return 30;
  if (text.includes("launcher hardpoints")) return 40;
  if (text.includes("high slots")) return 50;
  if (text.includes("medium slots")) return 60;
  if (text.includes("low slots")) return 70;
  return 100;
}

function targetingRowRank(row: AttributeDisplayRow) {
  const text = row.label.toLowerCase();
  if (text.includes("sensor strength")) return 10;
  if (text.includes("maximum locked targets")) return 20;
  if (text.includes("targeting range")) return 30;
  if (text.includes("scan resolution")) return 40;
  if (text.includes("signature radius")) return 50;
  return 100;
}

function riggingRowRank(row: AttributeDisplayRow) {
  const text = row.label.toLowerCase();
  if (text.includes("calibration")) return 10;
  if (text.includes("rig size")) return 20;
  if (text.includes("rig slots")) return 30;
  return 100;
}

function sortSectionRows(key: string, rows: AttributeDisplayRow[]) {
  if (key === "typeInfo") return rows;

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const rankA =
        key === "basic"
          ? basicRowRank(a.row)
          : key === "fitting"
            ? fittingRowRank(a.row)
            : key === "targeting"
              ? targetingRowRank(a.row)
              : key === "rigging"
                ? riggingRowRank(a.row)
                : 100;
      const rankB =
        key === "basic"
          ? basicRowRank(b.row)
          : key === "fitting"
            ? fittingRowRank(b.row)
            : key === "targeting"
              ? targetingRowRank(b.row)
              : key === "rigging"
                ? riggingRowRank(b.row)
                : 100;

      if (rankA !== rankB) return rankA - rankB;
      if (rankA !== 100) return a.index - b.index;
      return a.row.label.localeCompare(b.row.label);
    })
    .map(({ row }) => row);
}

function buildAttributeSections(item: ItemSummary, rows: DogmaRow[], hideDefenseProfileRows: boolean): AttributeSection[] {
  const buckets = new Map<string, AttributeDisplayRow[]>();
  const resourceLike = isResourceLikeItem(item);

  buckets.set("basic", physicalInfoRows(item));
  buckets.set("typeInfo", typeInfoRows(item));

  rows.forEach((row) => {
    if (hideDefenseProfileRows && isLayerDamageResistanceRow(row)) return;
    if (hideDefenseProfileRows && isDefenseHitpointRow(row)) return;
    if (isFittingLoadRow(row)) return;
    if (isZeroSensorStrengthRow(row)) return;
    if (isMaximumDirectionalScanRangeRow(row)) return;

    const initialKey = attributeSectionKey(row);
    const key = resourceLike && isResourceNoiseSection(initialKey) ? "other" : initialKey;
    const displayRow = dogmaDisplayRow(row);
    const sectionRows = buckets.get(key) || [];
    if (key === "rigging" && isDuplicateSectionRow(sectionRows, displayRow)) return;
    buckets.set(key, [...sectionRows, displayRow]);
  });

  return ATTRIBUTE_SECTIONS.map(([key]) => {
    const sectionRows = buckets.get(key) || [];
    const rowsForSection = sortSectionRows(key, sectionRows);

    return {
      key,
      label: ATTRIBUTE_SECTION_LABELS.get(key) || key,
      rows: rowsForSection,
    };
  }).filter((section) => section.rows.length > 0);
}

function formatAttributeValue(row: AttributeDisplayRow) {
  if (row.formatted != null) return row.formatted;

  const n = num(row.value);
  if (n == null) return EMPTY;
  const text = row.label.toLowerCase();

  if (isLayerDamageResistanceText(text)) {
    const percent = damageResistancePercent(n);
    return percent == null ? EMPTY : `${fmtCompactNumber(percent, 2)}%`;
  }
  if (row.unit === 108 || text.includes("resistance")) {
    const percent = Math.abs(n) <= 1 ? n * 100 : n;
    return `${fmtCompactNumber(percent, 2)}%`;
  }
  if (row.unit === 105 || text.includes("bonus")) return `${fmtCompactNumber(n, 2)}%`;
  if (row.unit === 101 || includesAny(text, ["recharge time", "reload time", "rate of fire", "duration"])) {
    return `${fmtCompactNumber(n / 1000, 2)} s`;
  }
  if (row.unit === 1 && includesAny(text, ["range", "falloff"])) return `${fmtCompactNumber(n / 1000, 2)} km`;
  if (row.unit === 1 || text.includes("signature radius") || text.includes("radius")) {
    return `${fmtCompactNumber(n, 2)} m`;
  }
  if (row.unit === 11 || text.includes("velocity")) return `${fmtCompactNumber(n, 2)} m/s`;
  if (row.unit === 102 || text.includes("scan resolution")) return `${fmtCompactNumber(n, 2)} mm`;
  if (text.includes("warp speed multiplier")) return `${fmtCompactNumber(n, 2)} AU/s`;
  if (row.unit === 106 || text.includes("cpu")) return `${fmtCompactNumber(n, 2)} tf`;
  if (row.unit === 107 || text.includes("powergrid")) {
    const value = includesAny(text, ["usage", "load"]) && n >= 1000 ? n / 1000 : n;
    return `${fmtCompactNumber(value, 2)} MW`;
  }
  if (row.unit === 9 || (text.includes("capacity") && !text.includes("capacitor")) || text.includes("volume")) {
    return `${fmtCompactNumber(n, 2)}${CUBIC_METERS}`;
  }
  if (row.unit === 114 || text.includes("capacitor capacity") || text.includes("activation cost")) {
    return `${fmtCompactNumber(n, 2)} GJ`;
  }
  if (text.includes("mass")) return `${fmtCompactNumber(n, 2)} kg`;
  if (text.includes("hitpoint")) return `${fmtCompactNumber(n, 2)} HP`;
  if (row.unit === 128 || text.includes("drone bandwidth")) return `${fmtCompactNumber(n, 2)} Mbit/s`;
  return fmtCompactNumber(n, 4);
}

function dogmaValue(rows: DogmaRow[], predicate: (text: string) => boolean) {
  const row = rows.find((candidate) => predicate(dogmaText(candidate)));
  return row ? num(row.value) : null;
}

function defenseLayers(rows: DogmaRow[]): DefenseLayer[] {
  const layerDefs: { key: DefenseLayer["key"]; label: string; hpMatch: string[] }[] = [
    { key: "shield", label: "Shield", hpMatch: ["shield capacity"] },
    { key: "armor", label: "Armor", hpMatch: ["armor hitpoints"] },
    { key: "structure", label: "Structure", hpMatch: ["structure hitpoints"] },
  ];

  return layerDefs
    .map((layer) => {
      const hp = dogmaValue(rows, (text) => layer.hpMatch.some((match) => text.includes(match)));
      const resists = DAMAGE_TYPES.reduce<Record<DamageKey, number | null>>(
        (acc, damage) => {
          acc[damage.key] = dogmaValue(
            rows,
            (text) =>
              text.includes(layer.key) &&
              text.includes(damage.key) &&
              text.includes("damage resistance")
          );
          return acc;
        },
        { em: null, thermal: null, kinetic: null, explosive: null }
      );
      return { ...layer, hp, resists };
    })
    .filter((layer) => layer.hp != null || Object.values(layer.resists).some((value) => value != null));
}

function hasLayerResistance(layer: DefenseLayer) {
  return Object.values(layer.resists).some((value) => value != null);
}

function hasLayerHitpoints(layer: DefenseLayer) {
  return layer.hp != null && layer.hp > 0;
}

function isDefenseProfileItem(item: ItemSummary) {
  const category = lower(item.category?.name);
  const identity = itemIdentityText(item);
  return (
    category === "ship" ||
    category === "structure" ||
    includesAny(identity, ["deployable", "starbase", "citadel", "engineering complex", "refinery", "upwell structure"])
  );
}

function shouldShowDefenseProfile(item: ItemSummary, layers: DefenseLayer[]) {
  if (isResourceLikeItem(item)) return false;
  if (!layers.some((layer) => hasLayerHitpoints(layer) && hasLayerResistance(layer))) return false;
  return isDefenseProfileItem(item) || layers.filter((layer) => hasLayerHitpoints(layer) && hasLayerResistance(layer)).length >= 2;
}

function damageResistancePercent(value: number | null) {
  if (value == null) return null;
  if (Math.abs(value) <= 1) return (1 - value) * 100;
  return 100 - value;
}

function DefenseSummary({ layers }: { layers: DefenseLayer[] }) {
  if (!layers.length) return null;

  return (
    <div className="border border-[#2f3844] bg-[#05070b] shadow-[inset_0_1px_0_rgba(83,182,255,0.08)]">
      <div className="flex items-center justify-between border-b border-[#263241] bg-[#0b1018] px-3 py-2">
        <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[#9bdcff]">
          <Shield size={14} /> Defensive Profile
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-slate-600">HP / Resistances</div>
      </div>
      <div className="divide-y divide-[#20242d]">
        {layers.map((layer) => (
          <div key={layer.key} className="grid gap-2 px-3 py-2 md:grid-cols-[118px,1fr]">
            <div className="flex items-center justify-between gap-2 md:block">
              <div className="text-[11px] uppercase tracking-[0.14em] text-slate-300">{layer.label}</div>
              <div className="font-mono text-[12px] text-slate-100">
                {layer.hp == null ? EMPTY : `${fmtCompactNumber(layer.hp, 0)} HP`}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {DAMAGE_TYPES.map((damage) => {
                const percent = damageResistancePercent(layer.resists[damage.key]);
                const width = percent == null ? 0 : Math.max(0, Math.min(100, percent));
                return (
                  <div key={`${layer.key}-${damage.key}`} className="border border-[#252832] bg-[#070910] px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[9px] uppercase tracking-[0.12em] ${damage.color}`}>{damage.label}</span>
                      <span className="font-mono text-[10px] text-slate-200">
                        {percent == null ? EMPTY : `${fmtCompactNumber(percent, 1)}%`}
                      </span>
                    </div>
                    <div className="mt-1 h-1 border border-[#1b2028] bg-[#02040a]">
                      <div className={`h-full ${damage.fill}`} style={{ width: `${width}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="tt2-stat shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
      <div className="tt2-stat-label">{label}</div>
      <div className="tt2-stat-value truncate text-[13px]" title={value}>
        {value}
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="tt2-empty m-3 py-5"><div className="tt2-empty-copy mt-0">{children}</div></div>;
}

function hasTraits(traits: ItemTraits | null | undefined): traits is ItemTraits {
  return !!traits && (traits.miscBonuses.length > 0 || traits.roleBonuses.length > 0 || traits.types.length > 0);
}

function traitBonusPrefix(bonus: TraitBonus) {
  if (bonus.bonus == null) return "";
  return `${fmtCompactNumber(bonus.bonus, 2)}${bonus.unit ? ` ${bonus.unit}` : ""}`;
}

function TraitLine({ bonus }: { bonus: TraitBonus }) {
  const prefix = traitBonusPrefix(bonus);
  return (
    <div className="text-[12px] leading-5 text-slate-300">
      {prefix && <span className="font-mono text-[#f1c26d]">{prefix}</span>} {bonus.text}
    </div>
  );
}

function TraitsPanel({ traits }: { traits: ItemTraits }) {
  return (
    <section className={panel}>
      <div className={panelHeader}>Traits</div>
      <div className="grid gap-4 p-3 lg:grid-cols-2">
        {traits.types.length > 0 && (
          <div className="space-y-3">
            {traits.types.map((entry) => (
              <div key={entry.skill_type_id} className="border border-[#252832] bg-[#05070b] p-3">
                <div className="mb-1.5 text-[12px] font-semibold text-[#f1c26d]">
                  {entry.skill_name || `Skill ${entry.skill_type_id}`} <span className="font-normal text-slate-500">bonuses per level</span>
                </div>
                <div className="space-y-1">
                  {entry.bonuses.map((bonus, index) => (
                    <TraitLine key={`${entry.skill_type_id}-${index}`} bonus={bonus} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {(traits.roleBonuses.length > 0 || traits.miscBonuses.length > 0) && (
          <div className="space-y-3">
            {traits.roleBonuses.length > 0 && (
              <div className="border border-[#252832] bg-[#05070b] p-3">
                <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-100">Role Bonuses</div>
                <div className="space-y-1">
                  {traits.roleBonuses.map((bonus, index) => (
                    <TraitLine key={`role-${index}`} bonus={bonus} />
                  ))}
                </div>
              </div>
            )}

            {traits.miscBonuses.length > 0 && (
              <div className="border border-[#252832] bg-[#05070b] p-3">
                <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-100">Misc Bonuses</div>
                <div className="space-y-1">
                  {traits.miscBonuses.map((bonus, index) => (
                    <TraitLine key={`misc-${index}`} bonus={bonus} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ActionButton({ action, item }: { action: QuickAction; item: ItemSummary }) {
  if (action.path) {
    return (
      <Link to={action.path} target="_blank" rel="noreferrer" className={button}>
        <ExternalLink size={13} /> {action.label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={button}
      onClick={() => copyText(action.copy === "type_id" ? String(item.type_id) : item.name)}
    >
      <Copy size={13} /> {action.label}
    </button>
  );
}

function TypeImage({
  sources,
  alt = "",
  className,
  fallbackClassName,
}: {
  sources: string[];
  alt?: string;
  className: string;
  fallbackClassName: string;
}) {
  const cleanSources = sources.filter(Boolean);
  const [sourceIndex, setSourceIndex] = useState(0);

  useEffect(() => {
    setSourceIndex(0);
  }, [cleanSources.join("|")]);

  if (!cleanSources.length || sourceIndex >= cleanSources.length) {
    return (
      <div className={`${fallbackClassName} flex items-center justify-center text-slate-600`}>
        <Package size={18} />
      </div>
    );
  }

  return (
    <img
      src={cleanSources[sourceIndex]}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setSourceIndex((index) => index + 1)}
    />
  );
}

function DetailItemSearch({
  currentTypeId,
  onOpenItem,
}: {
  currentTypeId: number;
  onOpenItem?: ItemOpenHandler;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ItemSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const trimmed = query.trim();
  const canSearch = trimmed.length >= 2 || isImmediateNumeric(trimmed);

  useEffect(() => {
    if (!canSearch) {
      setResults([]);
      setError("");
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const delay = isImmediateNumeric(trimmed) ? 0 : 220;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      fetch(`/api/items/search?q=${encodeURIComponent(trimmed)}&limit=8`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<{ ok: boolean; results: ItemSearchResult[]; error?: string }>;
        })
        .then((payload) => {
          if (!payload.ok) throw new Error(payload.error || "Search failed");
          setResults((payload.results || []).filter((row) => row.type_id !== currentTypeId));
        })
        .catch((err: unknown) => {
          if ((err as Error).name === "AbortError") return;
          setError("Search failed");
          setResults([]);
        })
        .finally(() => setLoading(false));
    }, delay);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canSearch, currentTypeId, trimmed]);

  const openResult = (typeId: number) => {
    setQuery("");
    setResults([]);
    if (onOpenItem) {
      onOpenItem(typeId);
      return;
    }
    navigate(`/items/${typeId}`);
  };

  return (
    <form
      className="relative"
      onSubmit={(event) => {
        event.preventDefault();
        const exact = results.find((row) => String(row.type_id) === trimmed || row.name.toLowerCase() === trimmed.toLowerCase());
        const target = exact || results[0];
        if (target) openResult(target.type_id);
      }}
    >
      <div className="flex h-8 border border-[#303236] bg-[#05070b] focus-within:border-[#53b6ff]/70">
        <div className="flex w-8 items-center justify-center text-slate-500">
          <Search size={13} />
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search item..."
          className="min-w-0 flex-1 bg-transparent pr-2 text-[11px] text-slate-100 outline-none placeholder:text-slate-600"
        />
      </div>

      {canSearch && (
        <div className="absolute right-0 z-30 mt-1 w-[min(88vw,380px)] border border-[#303946] bg-[#05070b] shadow-[0_10px_30px_rgba(0,0,0,0.6)]">
          {loading && <div className="px-2.5 py-2 text-[11px] text-slate-500">Searching...</div>}
          {error && <div className="px-2.5 py-2 text-[11px] text-[#ffb4b4]">{error}</div>}
          {!loading && !error && results.length === 0 && (
            <div className="px-2.5 py-2 text-[11px] text-slate-500">No matching items.</div>
          )}
          {!loading &&
            !error &&
            results.map((result) => (
              <button
                type="button"
                key={result.type_id}
                className="group grid w-full grid-cols-[34px,1fr,20px] gap-2 border-b border-[#20242d] px-2 py-1.5 text-left last:border-b-0 hover:bg-[#101621]"
                onClick={() => openResult(result.type_id)}
              >
                <TypeImage
                  sources={[result.icon_url]}
                  className="h-8 w-8 border border-[#252b35] bg-[#05070b]"
                  fallbackClassName="h-8 w-8 border border-[#252b35] bg-[#05070b]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] text-slate-200 group-hover:text-[#9bdcff]">{result.name}</span>
                  <span className="block truncate font-mono text-[9px] text-slate-600">{metaLine(result)}</span>
                </span>
                <span className="flex items-center justify-center text-slate-700 group-hover:text-[#53b6ff]">
                  <ArrowUpRight size={12} />
                </span>
              </button>
            ))}
        </div>
      )}
    </form>
  );
}

function AttributeValue({ row, onOpenItem }: { row: AttributeDisplayRow; onOpenItem?: ItemOpenHandler }) {
  if (row.displayValue) {
    const content = (
      <>
        <span>{row.displayValue}</span>
        {row.reference?.id != null && <span className="ml-1 text-slate-600">· {row.reference.id}</span>}
      </>
    );

    if (row.reference?.kind === "type" && row.reference.path) {
      const typeId = itemTypeIdFromPath(row.reference.path);
      if (onOpenItem && typeId != null) {
        return (
          <button type="button" onClick={() => onOpenItem(typeId)} className="text-[#9bdcff] hover:text-slate-50">
            {content}
          </button>
        );
      }

      return (
        <Link to={row.reference.path} className="text-[#9bdcff] hover:text-slate-50">
          {content}
        </Link>
      );
    }

    return <span>{content}</span>;
  }

  return <>{formatAttributeValue(row)}</>;
}

function AttributeSectionPanel({
  section,
  onOpenItem,
}: {
  section: AttributeSection;
  onOpenItem?: ItemOpenHandler;
}) {
  const Icon = SECTION_ICONS[section.key] || Database;
  const rowsClass = [
    "divide-y divide-[#20242d]",
    section.key === "other"
      ? "max-h-[420px] overflow-y-auto [scrollbar-color:#334155_#05070b] [scrollbar-width:thin]"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="border border-[#2b3340] bg-[#05070b] shadow-[inset_0_1px_0_rgba(83,182,255,0.05)]">
      <div className="flex items-center justify-between border-b border-[#2a3340] bg-[#0a0f17] px-2.5 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[#9bdcff]">
          <Icon size={12} /> {section.label}
        </span>
        <span className="font-mono text-[9px] text-slate-600">{section.rows.length}</span>
      </div>
      <div className={rowsClass}>
        {section.rows.map((row) => (
          <div
            key={`${section.key}-${row.key}`}
            className="grid grid-cols-[minmax(0,1fr),minmax(88px,136px)] gap-2 px-2.5 py-2 odd:bg-[#080a10] hover:bg-[#0d111a]"
          >
            <div className="min-w-0">
              <div className="truncate text-[11px] text-slate-300" title={row.label}>
                {row.label}
              </div>
              {row.attrId != null && <div className="font-mono text-[9px] text-slate-600">attr {row.attrId}</div>}
            </div>
            <div
              className="self-center text-right font-mono text-[11px] text-slate-100"
              title={`${row.rawValue == null ? "" : `raw: ${String(row.rawValue)}`}${row.unit == null ? "" : `, unit ${row.unit}`}`}
            >
              <AttributeValue row={row} onOpenItem={onOpenItem} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AttributeSectionsPanel({
  sections,
  defenses,
  onOpenItem,
}: {
  sections: AttributeSection[];
  defenses: DefenseLayer[];
  onOpenItem?: ItemOpenHandler;
}) {
  const byKey = new Map(sections.map((section) => [section.key, section]));
  const inLayout = new Set(ATTRIBUTE_THREE_COLUMN_LAYOUT.flat());
  const extraSections = sections.filter((section) => !inLayout.has(section.key));

  const buildColumns = (layout: string[][]) =>
    layout.map((columnKeys, index) => {
      const columnSections = columnKeys
        .map((key) => byKey.get(key))
        .filter(Boolean) as AttributeSection[];

      return index === layout.length - 1 ? [...columnSections, ...extraSections] : columnSections;
    });

  const twoColumns = buildColumns(ATTRIBUTE_TWO_COLUMN_LAYOUT);
  const threeColumns = buildColumns(ATTRIBUTE_THREE_COLUMN_LAYOUT);

  return (
    <>
      {defenses.length > 0 && (
        <div className="p-3 pb-0">
          <DefenseSummary layers={defenses} />
        </div>
      )}

      <div className="space-y-2 px-3 pb-3 md:hidden">
        {sections.map((section) => (
          <AttributeSectionPanel key={section.key} section={section} onOpenItem={onOpenItem} />
        ))}
      </div>

      <div className="hidden gap-3 px-3 pb-3 md:grid md:grid-cols-2 xl:hidden">
        {twoColumns.map((column, index) => (
          <div key={`attr-md-${index}`} className="space-y-3">
            {column.map((section) => (
              <AttributeSectionPanel key={section.key} section={section} onOpenItem={onOpenItem} />
            ))}
          </div>
        ))}
      </div>

      <div className="hidden gap-3 px-3 pb-3 xl:grid xl:grid-cols-3">
        {threeColumns.map((column, index) => (
          <div key={`attr-xl-${index}`} className="space-y-3">
            {column.map((section) => (
              <AttributeSectionPanel key={section.key} section={section} onOpenItem={onOpenItem} />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function relationLabel(row: IndustryLink, mode: "produced" | "used") {
  const activity = row.activity || (row.activity_id === 11 ? "reaction" : "manufacturing");
  if (mode === "produced") {
    return `${row.quantity ?? "-"} per ${activity} run`;
  }
  return `${row.quantity ?? "-"} input${row.product_quantity ? ` - ${row.product_quantity} output` : ""} - ${activity}`;
}

function RelationList({
  rows,
  mode,
  onOpenItem,
}: {
  rows: IndustryLink[];
  mode: "produced" | "used";
  onOpenItem?: ItemOpenHandler;
}) {
  const [expanded, setExpanded] = useState(false);
  const [renderLimit, setRenderLimit] = useState(RELATION_EXPANDED_BATCH);

  useEffect(() => {
    setExpanded(false);
    setRenderLimit(RELATION_EXPANDED_BATCH);
  }, [rows, mode]);

  if (!rows.length) return <Empty>No local industry relationship found.</Empty>;

  const hasOverflow = rows.length > RELATION_COLLAPSED_LIMIT;
  const scrollExpanded = expanded && rows.length > RELATION_EXPANDED_VISIBLE_ROWS;
  const displayedRows = expanded
    ? rows.slice(0, Math.min(rows.length, renderLimit))
    : rows.slice(0, RELATION_COLLAPSED_LIMIT);
  const statusText = expanded
    ? rows.length > RELATION_EXPANDED_VISIBLE_ROWS
      ? `Showing ${RELATION_EXPANDED_VISIBLE_ROWS} of ${rows.length} \u00b7 scroll for more`
      : `Showing ${displayedRows.length} of ${rows.length}`
    : `Showing ${Math.min(RELATION_COLLAPSED_LIMIT, rows.length)} of ${rows.length}`;

  return (
    <div>
      <div
        className={[
          "space-y-1.5 p-1.5",
          scrollExpanded ? "max-h-[520px] overflow-y-auto pr-2 [scrollbar-color:#334155_#05070b] [scrollbar-width:thin]" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onScroll={(event) => {
          const target = event.currentTarget;
          if (!expanded || renderLimit >= rows.length) return;
          if (target.scrollTop + target.clientHeight >= target.scrollHeight - 48) {
            setRenderLimit((current) => Math.min(rows.length, current + RELATION_EXPANDED_BATCH));
          }
        }}
      >
      {displayedRows.map((row, index) => {
        const targetTypeId = mode === "produced" ? row.blueprint_type_id : row.product_type_id;
        const title = mode === "produced" ? row.blueprint_name : row.product_name;
        const linkedContent = (
          <>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[12px] font-medium text-slate-200 group-hover:text-[#53b6ff]">
                {title || `Type ${targetTypeId}`}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-[9px] uppercase tracking-[0.14em] text-slate-600 group-hover:text-[#53b6ff]">
                Open <ArrowUpRight size={11} />
              </span>
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-slate-500 group-hover:text-slate-400">
              {relationLabel(row, mode)}
            </div>
          </>
        );
        const linkClass =
          "group block cursor-pointer border border-[#252832] bg-[#070910] px-2.5 py-2.5 transition-colors hover:border-[#9bdcff]/70 hover:bg-[#0d141f] hover:shadow-[0_0_14px_rgba(83,182,255,0.2)] focus:border-[#53b6ff]/70 focus:bg-[#0d141f] focus:outline-none";

        return (
          <div key={`${targetTypeId}-${row.blueprint_type_id}-${index}`}>
            {targetTypeId && onOpenItem ? (
              <button
                type="button"
                title="Open item"
                onClick={() => onOpenItem(targetTypeId)}
                className={`${linkClass} w-full text-left`}
              >
                {linkedContent}
              </button>
            ) : targetTypeId ? (
              <Link
                to={`/items/${targetTypeId}`}
                title="Open item"
                className={linkClass}
              >
                {linkedContent}
              </Link>
            ) : (
              <div className="border border-[#252832] bg-[#070910] px-2.5 py-2.5">
                <div className="text-[12px] text-slate-200">{title || "Unknown type"}</div>
                <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                  {relationLabel(row, mode)}
                </div>
              </div>
            )}
          </div>
        );
      })}
      </div>
      {hasOverflow && (
        <div className="flex items-center justify-between gap-2 border-t border-[#252832] bg-[#070910] px-2.5 py-2">
          <span className="font-mono text-[10px] text-slate-500">{statusText}</span>
          <button
            type="button"
            className="border border-[#303236] bg-[#05070b] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#9bdcff] transition-colors hover:border-[#53b6ff]/70 hover:bg-[#101923] hover:text-slate-50"
            onClick={() => {
              setExpanded((current) => !current);
              setRenderLimit(RELATION_EXPANDED_BATCH);
            }}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        </div>
      )}
    </div>
  );
}

type ItemDetailProps = {
  typeID?: string | number;
  onOpenItem?: ItemOpenHandler;
  onBackToSearch?: () => void;
};

export default function ItemDetail({ typeID: typeIDProp, onOpenItem, onBackToSearch }: ItemDetailProps = {}) {
  const { typeID: routeTypeID } = useParams();
  const typeID = typeIDProp == null ? routeTypeID : String(typeIDProp);
  const [payload, setPayload] = useState<ItemDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const {
    authUser,
    authChecked,
    bookmarkedTypeIds,
    bookmarkError,
    toggleBookmark,
  } = useItemBookmarks();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/items/${encodeURIComponent(typeID || "")}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((res) => {
        if (res.status === 404) throw new Error("not_found");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ItemDetailPayload>;
      })
      .then(setPayload)
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message === "not_found" ? "Item not found" : "Item failed to load");
        setPayload(null);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [typeID]);

  const item = payload?.item;
  const dogma = useMemo(
    () => (payload?.dogma || []).filter((row) => row.display_name && row.value != null),
    [payload?.dogma]
  );
  const rawDefenseProfile = useMemo(() => defenseLayers(dogma), [dogma]);
  const showDefenseProfile = useMemo(
    () => (item ? shouldShowDefenseProfile(item, rawDefenseProfile) : false),
    [item, rawDefenseProfile]
  );
  const attributeSections = useMemo(
    () => (item ? buildAttributeSections(item, dogma, showDefenseProfile) : []),
    [item, dogma, showDefenseProfile]
  );
  const defenseProfile = showDefenseProfile ? rawDefenseProfile : [];
  const quickActions = useMemo(
    () => (item ? buildQuickActions(item, payload?.industry) : []),
    [item, payload?.industry]
  );
  const standaloneChrome = typeIDProp == null ? (
    <ToolChrome
      section="Reference"
      title="Item Detail"
      badge={typeID ? `typeID ${typeID}` : "Show Info"}
      context={item?.name || (loading ? "Loading item" : "Show Info")}
    />
  ) : null;

  if (loading) {
    return (
      <div className="tt-tool-v2 min-h-screen text-slate-400">
        <div className="tt2-frame tt2-frame--wide">
          <div className="tt2-window">
            {standaloneChrome}
            <div className="p-3">
              <div className="tt2-notice flex items-center gap-2"><span className="h-2 w-2 animate-pulse bg-[#53b6ff]" /> Loading item...</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="tt-tool-v2 min-h-screen text-slate-300">
        <div className="tt2-frame tt2-frame--centered">
          <div className="tt2-window">
            {standaloneChrome}
            <div className="p-3">
              <div className="tt2-notice tt2-notice--danger p-4 shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
          <div className="text-[15px] font-semibold text-slate-100">{error || "Item not found"}</div>
          {onBackToSearch ? (
            <button
              type="button"
              onClick={onBackToSearch}
              className="mt-3 inline-flex items-center gap-1 text-[#53b6ff] hover:text-slate-100"
            >
              <Search size={14} /> Back to Item Browser
            </button>
          ) : (
            <Link to="/items" className="mt-3 inline-flex items-center gap-1 text-[#53b6ff] hover:text-slate-100">
              <Search size={14} /> Back to Item Browser
            </Link>
          )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const path = marketPath(item);
  const itemBookmarked = bookmarkedTypeIds.has(item.type_id);
  const bookmarkLabel = !authChecked
    ? "Checking Account"
    : authUser
      ? itemBookmarked
        ? "Bookmarked"
        : "Bookmark Item"
      : "Sign In to Bookmark";

  return (
    <div className="tt-tool-v2 min-h-screen text-slate-100">
      <div className="tt2-frame tt2-frame--wide">
        <div className="tt2-window">
        {standaloneChrome}
        <div className="space-y-4 p-3">
        <section className={panel}>
          <div className={panelHeader}>Item Browser / Show Info</div>
          <div className="grid gap-4 p-4 lg:grid-cols-[172px,1fr,224px] lg:items-start">
            <div className="flex items-center justify-center border border-[#252832] bg-[#05070b] p-2">
              <TypeImage
                sources={isBlueprintItem(item) ? [item.icon_url, item.render_url] : [item.render_url, item.icon_url]}
                className="max-h-36 max-w-full object-contain"
                fallbackClassName="h-36 w-full bg-[#05070b]"
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="min-w-0 truncate text-[24px] font-semibold uppercase tracking-[0.08em] text-slate-50 sm:text-[28px]">
                  {item.name}
                </h1>
                {!item.published && (
                  <span className="border border-[#5b4a2e] bg-[#1b1308] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[#f1c26d]">
                    Unpublished
                  </span>
                )}
              </div>
              <div className="mt-1 font-mono text-[11px] text-slate-500">typeID {item.type_id}</div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] uppercase tracking-[0.13em] text-slate-400">
                {[item.category?.name, item.group?.name].filter(Boolean).map((value) => (
                  <span key={value} className="border border-[#303236] bg-[#05070b] px-2 py-1">
                    {value}
                  </span>
                ))}
              </div>
              {path.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                  <span className="uppercase tracking-[0.16em] text-slate-600">Market</span>
                  {path.map((entry, index) => (
                    <span key={entry.market_group_id} className="inline-flex items-center gap-1.5">
                      {index > 0 && <span className="text-slate-700">&gt;</span>}
                      <span className={index === path.length - 1 ? "text-slate-300" : "text-slate-500"}>
                        {entry.name}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {onBackToSearch ? (
                <button type="button" className={button} onClick={onBackToSearch}>
                  <Search size={13} /> Back to Search
                </button>
              ) : null}
              <button
                type="button"
                className={`${button} ${
                  itemBookmarked ? "border-[#53b6ff]/70 bg-[#0b1b2a] text-[#d8ecff]" : ""
                }`}
                disabled={!authChecked}
                onClick={() => void toggleBookmark(item.type_id)}
              >
                <Bookmark size={13} fill={itemBookmarked ? "currentColor" : "none"} /> {bookmarkLabel}
              </button>
              <button type="button" className={button} onClick={() => copyText(String(item.type_id))}>
                <Copy size={13} /> Copy TypeID
              </button>
              <button type="button" className={button} onClick={() => copyText(item.name)}>
                <Copy size={13} /> Copy Name
              </button>
              <DetailItemSearch currentTypeId={item.type_id} onOpenItem={onOpenItem} />
              {bookmarkError ? (
                <div className="border border-[#52343a] bg-[#170a0e] px-2 py-1.5 text-[10px] text-[#ffb4b4]">
                  {bookmarkError}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className={panel}>
          <div className={panelHeader}>Quick Actions</div>
          <div className="flex flex-wrap gap-2.5 p-3">
            {quickActions.map((action) => (
              <ActionButton key={action.key} action={action} item={item} />
            ))}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-[1fr,380px]">
          <section className={panel}>
            <div className={panelHeader}>Basic Info</div>
            <div className="border-b border-[#252832] px-3 py-2.5 text-[11px] text-slate-400">
              <span className="mr-2 text-[9px] uppercase tracking-[0.16em] text-slate-600">Market Group</span>
              <span className="font-mono text-slate-300">{marketPathText(item)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 p-3 md:grid-cols-4">
              <Stat label="Volume" value={fmtNumber(item.volume, CUBIC_METERS)} />
              <Stat label="Packaged Volume" value={fmtNumber(item.packaged_volume, CUBIC_METERS)} />
              <Stat label="Mass" value={fmtNumber(item.mass, " kg")} />
              <Stat label="Capacity" value={fmtNumber(item.capacity, CUBIC_METERS)} />
              <Stat label="Industry Batch Size" value={fmtNumber(item.portion_size)} />
              <Stat label="Size" value={fmtNumber(item.radius, " m")} />
              <Stat label="Published" value={item.published ? "yes" : "no"} />
              <Stat label="Group" value={item.group?.name || EMPTY} />
            </div>
          </section>

          <section className={panel}>
            <div className={panelHeader}>Jita Market Snapshot</div>
            {payload.market?.available ? (
              <div className="grid grid-cols-2 gap-2.5 p-3">
                <Stat label="Sell Min" value={fmtIsk(payload.market.sell_min)} />
                <Stat label="Buy Max" value={fmtIsk(payload.market.buy_max)} />
                <Stat label="Sell 5%" value={fmtIsk(payload.market.sell_5pct)} />
                <Stat label="Buy 5%" value={fmtIsk(payload.market.buy_5pct)} />
                <div className="col-span-2 font-mono text-[10px] text-slate-500">
                  {payload.market.station} - updated {fmtDate(payload.market.updated_at)}
                </div>
              </div>
            ) : (
              <Empty>No local Jita snapshot for this type.</Empty>
            )}
          </section>
        </div>

        <section className={panel}>
          <div className={panelHeader}>Description</div>
          {item.description ? (
            <p className="whitespace-pre-wrap px-4 py-4 text-[13px] leading-6 text-slate-300 sm:px-5">{item.description}</p>
          ) : (
            <Empty>No local description available.</Empty>
          )}
        </section>

        {hasTraits(payload.traits) && <TraitsPanel traits={payload.traits} />}

        <div className="space-y-4">
          <section className={panel}>
            <div className={panelHeader}>Attributes</div>
            {attributeSections.length ? (
              <AttributeSectionsPanel sections={attributeSections} defenses={defenseProfile} onOpenItem={onOpenItem} />
            ) : (
              <Empty>No local attributes imported for this type.</Empty>
            )}
          </section>

          <section className={panel}>
            <div className={panelHeader}>Industry Relationships</div>
            <div className="grid gap-3 p-3 md:grid-cols-2">
              <div className="border border-[#2b3340] bg-[#05070b] shadow-[inset_0_1px_0_rgba(83,182,255,0.05)]">
                <div className="flex items-center justify-between border-b border-[#2a3340] bg-[#0a0f17] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[#9bdcff]">
                  <span className="inline-flex items-center gap-1.5">
                    <Hammer size={12} /> Produced By
                  </span>
                  <span className="font-mono text-[9px] text-slate-600">{payload.industry?.produced_by?.length || 0}</span>
                </div>
                <RelationList rows={payload.industry?.produced_by || []} mode="produced" onOpenItem={onOpenItem} />
              </div>
              <div className="border border-[#2b3340] bg-[#05070b] shadow-[inset_0_1px_0_rgba(83,182,255,0.05)]">
                <div className="flex items-center justify-between border-b border-[#2a3340] bg-[#0a0f17] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[#9bdcff]">
                  <span className="inline-flex items-center gap-1.5">
                    <Package size={12} /> Used In
                  </span>
                  <span className="font-mono text-[9px] text-slate-600">{payload.industry?.used_in?.length || 0}</span>
                </div>
                <RelationList rows={payload.industry?.used_in || []} mode="used" onOpenItem={onOpenItem} />
              </div>
            </div>
          </section>
        </div>
      </div>
      </div>
      </div>
    </div>
  );
}
