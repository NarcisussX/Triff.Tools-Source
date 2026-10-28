import { X } from "lucide-react";
import type { FittingModule, SlotKey } from "./types";
import { SLOT_LABELS } from "./types";

type Props = {
  slot: SlotKey;
  modules: FittingModule[];
  total?: number;
  onRemove: (slot: SlotKey, index: number) => void;
};

const slotTone: Record<SlotKey, string> = {
  high: "border-[#4b252b] bg-[#10090b]",
  mid: "border-[#25384f] bg-[#081018]",
  low: "border-[#4a3a1d] bg-[#110e07]",
  rig: "border-[#34363d] bg-[#090b10]",
  subsystem: "border-[#38452a] bg-[#0b1208]",
};

function eveIcon(typeId: number) {
  return `https://images.evetech.net/types/${typeId}/icon?size=64`;
}

export default function FitSlot({ slot, modules, total = 0, onRemove }: Props) {
  const rows = Math.max(total || 0, modules.length, slot === "subsystem" ? 0 : 1);
  const placeholders = Array.from({ length: rows });

  return (
    <section className={`border ${slotTone[slot]}`}>
      <div className="flex h-7 items-center justify-between border-b border-[#2c2f36] bg-[#101219] px-2">
        <div className="text-[10px] uppercase tracking-widest text-slate-300">
          {SLOT_LABELS[slot]}
        </div>
        <div className="font-mono text-[10px] text-slate-500">
          {modules.length}/{total || "-"}
        </div>
      </div>

      <div className="divide-y divide-[#20242c]">
        {placeholders.length === 0 && (
          <div className="px-2 py-2 text-[11px] text-slate-600">None</div>
        )}
        {placeholders.map((_, index) => {
          const module = modules[index];
          return (
            <div
              key={`${slot}-${index}`}
              className="grid min-h-9 grid-cols-[28px,1fr,24px] items-center gap-2 px-2 py-1"
            >
              {module ? (
                <>
                  <img
                    src={eveIcon(module.typeId)}
                    alt=""
                    className="h-7 w-7 border border-[#30343d] bg-black object-cover"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[11px] text-slate-100">
                      {module.typeName || `Type ${module.typeId}`}
                    </div>
                    <div className="truncate font-mono text-[10px] text-slate-500">
                      {module.chargeTypeName || module.state || "online"}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="flex h-6 w-6 items-center justify-center border border-[#303236] bg-[#05070b] text-slate-400 hover:border-red-400/70 hover:text-red-200"
                    onClick={() => onRemove(slot, index)}
                    title="Remove"
                  >
                    <X size={13} />
                  </button>
                </>
              ) : (
                <>
                  <div className="h-7 w-7 border border-dashed border-[#30343d] bg-[#05070b]" />
                  <div className="text-[11px] text-slate-600">Empty</div>
                  <div />
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
