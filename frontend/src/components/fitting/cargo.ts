import type { QuantityItem } from "./types";

function cargoQuantity(value: unknown) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function addCargoStack(items: QuantityItem[], item: Pick<QuantityItem, "typeId" | "typeName">) {
  const existingIndex = items.findIndex((entry) => Number(entry.typeId) === Number(item.typeId));
  if (existingIndex < 0) {
    return [...items, { typeId: Number(item.typeId), typeName: item.typeName, quantity: 1 }];
  }
  return items.map((entry, index) => (
    index === existingIndex
      ? {
          ...entry,
          typeName: entry.typeName || item.typeName,
          quantity: cargoQuantity(entry.quantity) + 1,
        }
      : entry
  ));
}

export function setCargoStackQuantity(items: QuantityItem[], index: number, quantity: number) {
  const next = Math.floor(Number(quantity));
  if (!Number.isFinite(next)) return items;
  if (next <= 0) return items.filter((_, itemIndex) => itemIndex !== index);
  return items.map((entry, itemIndex) => (itemIndex === index ? { ...entry, quantity: next } : entry));
}
