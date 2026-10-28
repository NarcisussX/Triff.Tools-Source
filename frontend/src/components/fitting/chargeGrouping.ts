import type { ChargeResult } from "./types";

export type ChargeFamilyGroup = {
  key: string;
  label: string;
  sortOrder: number;
  items: ChargeResult[];
};

const PROJECTILE_ORDER = [
  "Carbonized Lead",
  "Nuclear",
  "Proton",
  "Depleted Uranium",
  "Titanium Sabot",
  "Fusion",
  "Phased Plasma",
  "EMP",
  "Barrage",
  "Hail",
  "Tremor",
  "Quake",
];

const HYBRID_ORDER = [
  "Iron",
  "Tungsten",
  "Iridium",
  "Lead",
  "Thorium",
  "Uranium",
  "Plutonium",
  "Antimatter",
  "Null",
  "Void",
  "Spike",
  "Javelin",
];

const CRYSTAL_ORDER = [
  "Radio",
  "Microwave",
  "Infrared",
  "Standard",
  "Ultraviolet",
  "Xray",
  "Gamma",
  "Multifrequency",
  "Scorch",
  "Conflagration",
  "Aurora",
  "Gleam",
];

const MISSILE_ORDER = ["Mjolnir", "Scourge", "Inferno", "Nova"];
const CAP_BOOSTER_SIZES = [25, 50, 75, 100, 150, 200, 400, 800, 3200];

const VARIANT_PREFIXES = [
  "Republic Fleet",
  "Domination",
  "Arch Angel",
  "Caldari Navy",
  "Dread Guristas",
  "Federation Navy",
  "Shadow Serpentis",
  "Imperial Navy",
  "True Sansha",
  "Dark Blood",
  "Guristas",
  "Blood",
  "Sanshas",
  "Serpentis",
  "Angel",
  "Navy",
];

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function containsFamily(name: string, family: string) {
  return new RegExp(`(^|\\s)${family.replace(/\s+/g, "\\s+")}(\\s|$)`, "i").test(name);
}

function knownFamily(name: string, families: string[]) {
  return families.find((family) => containsFamily(name, family)) || null;
}

function groupText(charge: ChargeResult) {
  return `${charge.groupName || ""} ${charge.chargeGroupName || ""} ${charge.marketGroupName || ""}`.toLowerCase();
}

function fallbackFamily(name: string) {
  let base = name;
  for (const prefix of VARIANT_PREFIXES) {
    base = base.replace(new RegExp(`^${prefix}\\s+`, "i"), "");
  }
  base = base.replace(/\s+(?:XS|S|M|L|XL)$/i, "");
  base = base.replace(/\s+Charge$/i, "");
  return base.trim() || name;
}

function chargeFamily(charge: ChargeResult) {
  const name = charge.typeName;
  const text = groupText(charge);

  const cap = name.match(/\bCap Booster\s+(\d+)\b/i);
  if (cap) {
    const size = Number(cap[1]);
    const index = CAP_BOOSTER_SIZES.indexOf(size);
    return {
      label: `Cap Booster ${size}`,
      sortOrder: index >= 0 ? 300 + index : 399,
    };
  }

  if (text.includes("projectile") || text.includes("autocannon") || text.includes("artillery")) {
    const family = knownFamily(name, PROJECTILE_ORDER);
    if (family) return { label: family, sortOrder: 100 + PROJECTILE_ORDER.indexOf(family) };
  }

  if (text.includes("hybrid") || text.includes("railgun") || text.includes("blaster")) {
    const family = knownFamily(name, HYBRID_ORDER);
    if (family) return { label: family, sortOrder: 200 + HYBRID_ORDER.indexOf(family) };
  }

  if (text.includes("frequency") || text.includes("crystal") || text.includes("laser")) {
    const family = knownFamily(name, CRYSTAL_ORDER);
    if (family) return { label: family, sortOrder: 250 + CRYSTAL_ORDER.indexOf(family) };
  }

  if (text.includes("missile") || text.includes("rocket") || text.includes("torpedo") || text.includes("bomb")) {
    const family = knownFamily(name, MISSILE_ORDER);
    if (family) return { label: family, sortOrder: 400 + MISSILE_ORDER.indexOf(family) };
  }

  if (text.includes("script")) {
    const label = name.replace(/\s+Script$/i, "").trim() || name;
    return { label, sortOrder: 500 };
  }

  return { label: fallbackFamily(name), sortOrder: 900 };
}

function variantRank(name: string) {
  if (/^(?:Carbonized|Nuclear|Proton|Depleted|Titanium|Fusion|Phased|EMP|Iron|Tungsten|Iridium|Lead|Thorium|Uranium|Plutonium|Antimatter|Radio|Microwave|Infrared|Standard|Ultraviolet|Xray|Gamma|Multifrequency|Scorch|Conflagration|Aurora|Gleam|Barrage|Hail|Tremor|Quake|Null|Void|Spike|Javelin)\b/i.test(name)) {
    return 0;
  }
  if (/\b(?:Caldari|Federation|Imperial|Republic) Navy\b/i.test(name)) return 10;
  if (/^Domination\b/i.test(name)) return 20;
  if (/^Arch Angel\b/i.test(name)) return 30;
  if (/^Dread Guristas\b/i.test(name)) return 30;
  if (/^(?:True Sansha|Dark Blood|Shadow Serpentis)\b/i.test(name)) return 30;
  if (/\b(?:Precision|Javelin)\b/i.test(name)) return 40;
  if (/\b(?:Rage|Fury)\b/i.test(name)) return 50;
  return 60;
}

export function groupCharges(charges: ChargeResult[]): ChargeFamilyGroup[] {
  const map = new Map<string, ChargeFamilyGroup>();
  for (const charge of charges) {
    const family = chargeFamily(charge);
    const key = slug(family.label);
    const group = map.get(key) || { key, label: family.label, sortOrder: family.sortOrder, items: [] };
    group.sortOrder = Math.min(group.sortOrder, family.sortOrder);
    group.items.push(charge);
    map.set(key, group);
  }

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => variantRank(a.typeName) - variantRank(b.typeName) || a.typeName.localeCompare(b.typeName)),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}
