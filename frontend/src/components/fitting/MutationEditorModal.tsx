import { useEffect, useMemo, useState } from "react";
import type { FittingModule, ModuleMutation, MutationAttribute } from "./types";

type Props = {
  open: boolean;
  module: FittingModule | null;
  mutation: ModuleMutation | null;
  onClose: () => void;
  onApply: (mutation: ModuleMutation) => void;
};

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fmt(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

function attributeRows(mutation: ModuleMutation): MutationAttribute[] {
  if (mutation.attributeDetails?.length) return mutation.attributeDetails;
  return Object.keys(mutation.attributes || {}).sort().map((attributeName, index) => ({
    attributeId: index,
    attributeName,
    displayName: attributeName,
    value: mutation.attributes[attributeName],
    baseValue: mutation.attributes[attributeName],
  }));
}

export default function MutationEditorModal({ open, module, mutation, onClose, onApply }: Props) {
  const rows = useMemo(() => (mutation ? attributeRows(mutation) : []), [mutation]);
  const [values, setValues] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!mutation) return;
    const next: Record<string, number> = {};
    for (const row of attributeRows(mutation)) {
      next[row.attributeName] = numeric(mutation.attributes?.[row.attributeName], numeric(row.value, numeric(row.baseValue)));
    }
    setValues(next);
  }, [mutation]);

  if (!open || !mutation) return null;

  function setValue(row: MutationAttribute, value: number) {
    setValues((prev) => ({ ...prev, [row.attributeName]: value }));
  }

  function resetDefaults() {
    const next: Record<string, number> = {};
    for (const row of rows) next[row.attributeName] = numeric(row.baseValue, numeric(row.value));
    setValues(next);
  }

  function revertChanges() {
    const next: Record<string, number> = {};
    for (const row of rows) next[row.attributeName] = numeric(mutation.attributes?.[row.attributeName], numeric(row.value, numeric(row.baseValue)));
    setValues(next);
  }

  function apply() {
    const attributeIds: Record<string, number> = {};
    for (const row of rows) {
      if (row.attributeId != null) attributeIds[String(row.attributeId)] = numeric(values[row.attributeName]);
    }
    onApply({
      ...mutation,
      displayName: mutation.displayName || `Abyssal ${module?.typeName || mutation.baseTypeName || "Module"}`,
      attributes: values,
      attributeIds,
      attributeDetails: rows.map((row) => ({ ...row, value: numeric(values[row.attributeName]) })),
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-xl border border-[#34404c] bg-[#070910] text-[11px] text-slate-200 shadow-2xl shadow-black">
        <div className="border-b border-[#20242c] bg-[#101219] px-3 py-2">
          <div className="text-[10px] uppercase tracking-widest text-[#d3b3ff]">Module Stats</div>
          <div className="truncate text-sm text-slate-100">{mutation.displayName || `Abyssal ${module?.typeName || mutation.baseTypeName || "Module"}`}</div>
          <div className="truncate font-mono text-[10px] text-slate-500">{mutation.mutaplasmidName}</div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-3">
          <div className="grid grid-cols-[1fr,88px,88px,88px] gap-x-2 border-b border-[#20242c] pb-1 text-[9px] uppercase tracking-widest text-slate-600">
            <div>Attribute</div>
            <div className="text-right">Min</div>
            <div className="text-right">Value</div>
            <div className="text-right">Max</div>
          </div>
          <div className="divide-y divide-[#151922]">
            {rows.map((row) => {
              const value = numeric(values[row.attributeName], numeric(row.value, numeric(row.baseValue)));
              const min = numeric(row.minValue, value);
              const max = numeric(row.maxValue, value);
              const low = Math.min(min, max);
              const high = Math.max(min, max);
              const canSlide = Number.isFinite(low) && Number.isFinite(high) && high > low;
              return (
                <div key={row.attributeName} className="grid grid-cols-[1fr,88px,88px,88px] items-center gap-x-2 py-1.5">
                  <div className="min-w-0">
                    <div className="truncate text-slate-200" title={row.attributeName}>{row.displayName || row.attributeName}</div>
                    <div className="font-mono text-[9px] text-slate-600">{row.attributeName}</div>
                    {canSlide && (
                      <input
                        type="range"
                        min={low}
                        max={high}
                        step={(high - low) / 1000}
                        value={Math.min(high, Math.max(low, value))}
                        onChange={(event) => setValue(row, Number(event.target.value))}
                        className="mt-1 h-1 w-full accent-[#8b5cf6]"
                      />
                    )}
                  </div>
                  <div className="text-right font-mono text-slate-600">{fmt(min)}</div>
                  <input
                    type="number"
                    value={fmt(value)}
                    onChange={(event) => setValue(row, Number(event.target.value))}
                    className="h-7 border border-[#303236] bg-[#05070b] px-1 text-right font-mono text-slate-100 outline-none focus:border-[#8b5cf6]"
                  />
                  <div className="text-right font-mono text-slate-600">{fmt(max)}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[#20242c] px-3 py-2">
          <div className="text-[10px] text-slate-600">Values are passed to Pyfa/eos as mutator attributes.</div>
          <div className="flex gap-1.5">
            <button type="button" className="border border-[#303236] bg-[#05070b] px-2 py-1 text-[10px] uppercase tracking-widest text-slate-400 hover:bg-[#101721]" onClick={resetDefaults}>
              Reset defaults
            </button>
            <button type="button" className="border border-[#303236] bg-[#05070b] px-2 py-1 text-[10px] uppercase tracking-widest text-slate-400 hover:bg-[#101721]" onClick={revertChanges}>
              Revert
            </button>
            <button type="button" className="border border-[#303236] bg-[#05070b] px-2 py-1 text-[10px] uppercase tracking-widest text-slate-400 hover:bg-[#101721]" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="border border-[#8b5cf6]/70 bg-[#29194a] px-2 py-1 text-[10px] uppercase tracking-widest text-[#e9d5ff] hover:bg-[#3b2369]" onClick={apply}>
              Apply/Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
