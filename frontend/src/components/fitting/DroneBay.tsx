import { X } from "lucide-react";
import type { QuantityItem } from "./types";

type Props = {
  title: string;
  items: QuantityItem[];
  emptyLabel: string;
  onRemove: (index: number) => void;
};

function eveIcon(typeId: number) {
  return `https://images.evetech.net/types/${typeId}/icon?size=64`;
}

export default function DroneBay({ title, items, emptyLabel, onRemove }: Props) {
  return (
    <section className="border border-[#2c2f36] bg-[#070910]">
      <div className="flex h-7 items-center justify-between border-b border-[#2c2f36] bg-[#101219] px-2">
        <div className="text-[10px] uppercase tracking-widest text-slate-300">{title}</div>
        <div className="font-mono text-[10px] text-slate-500">{items.length}</div>
      </div>
      <div className="divide-y divide-[#20242c]">
        {items.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-slate-600">{emptyLabel}</div>
        ) : (
          items.map((item, index) => (
            <div
              key={`${item.typeId}-${index}`}
              className="grid grid-cols-[28px,1fr,24px] items-center gap-2 px-2 py-1"
            >
              <img src={eveIcon(item.typeId)} alt="" className="h-7 w-7 border border-[#30343d] bg-black" />
              <div className="min-w-0">
                <div className="truncate text-[11px] text-slate-100">{item.typeName || `Type ${item.typeId}`}</div>
                <div className="font-mono text-[10px] text-slate-500">
                  x{item.quantity || 1}
                  {typeof item.active === "number" ? ` / ${item.active} active` : ""}
                </div>
              </div>
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-400 hover:border-red-400/70 hover:text-red-200"
                onClick={() => onRemove(index)}
                title="Remove"
              >
                <X size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
