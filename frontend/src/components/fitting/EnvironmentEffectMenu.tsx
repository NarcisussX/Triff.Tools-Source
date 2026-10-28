import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Loader2, Plus, X } from "lucide-react";
import { triffApiFetch } from "../../lib/webRuntime";
import type { EnvironmentEffect, EnvironmentEffectNode } from "./types";

type Props = {
  onSelect: (effect: EnvironmentEffect) => void;
  buttonLabel?: string;
  mobileSheet?: boolean;
};

async function fetchTree(): Promise<EnvironmentEffectNode[]> {
  const response = await triffApiFetch("/api/fitting/environment-effects");
  const data = await response.json();
  if (!response.ok || !data?.ok) throw new Error(data?.error || "environment_effects_failed");
  return data.categories || [];
}

function effectLabel(path: EnvironmentEffectNode[]) {
  const leaf = path[path.length - 1];
  if (path.length >= 3) return `${path[path.length - 2].label} ${leaf.label}`;
  return leaf.label;
}

function toEffect(path: EnvironmentEffectNode[]): EnvironmentEffect | null {
  const top = path[0];
  const leaf = path[path.length - 1];
  if (!leaf?.typeId || !leaf.effectId || !leaf.category) return null;
  return {
    kind: "environment",
    effectId: leaf.effectId,
    typeId: leaf.typeId,
    typeName: leaf.typeName,
    label: effectLabel(path),
    category: leaf.category,
    categoryLabel: top?.label || leaf.category,
    source: leaf.source || "pyfa/eos",
  };
}

export default function EnvironmentEffectMenu({ onSelect, buttonLabel = "Add Environmental Effect", mobileSheet = false }: Props) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<EnvironmentEffectNode[]>([]);
  const [path, setPath] = useState<EnvironmentEffectNode[]>([]);

  useEffect(() => {
    if (!open || categories.length) return;
    let alive = true;
    setLoading(true);
    fetchTree()
      .then((tree) => {
        if (alive) setCategories(tree);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, categories.length]);

  useEffect(() => {
    if (!open) return;
    function handleMouse(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", handleMouse);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleMouse);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const columns = useMemo(() => {
    const out: EnvironmentEffectNode[][] = [categories];
    for (const node of path) {
      if (node.children?.length) out.push(node.children);
      else break;
    }
    return out;
  }, [categories, path]);

  const rect = buttonRef.current?.getBoundingClientRect();
  const left = rect ? Math.min(rect.left, window.innerWidth - 780) : 16;
  const top = rect ? Math.min(rect.bottom + 4, window.innerHeight - 340) : 120;
  const mobileNodes = path.length ? path[path.length - 1]?.children || [] : categories;
  const mobileTitle = path.length ? path[path.length - 1]?.label || "Environmental Effects" : "Add Environmental Effect";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex h-6 items-center gap-1 border border-[#303236] bg-[#05070b] px-2 text-[10px] uppercase tracking-widest text-slate-300 hover:border-[#53b6ff]/60 hover:bg-[#101721]"
        onClick={() => {
          if (!open) setPath([]);
          setOpen((value) => !value);
        }}
      >
        {loading ? <Loader2 size={12} className="animate-spin text-[#53b6ff]" /> : <Plus size={12} />}
        {buttonLabel}
      </button>
      {open &&
        createPortal(
          mobileSheet ? (
            <div ref={menuRef} className="fixed inset-0 z-[9998] flex items-end bg-black/65">
              <div className="mobile-fitting-sheet flex w-full flex-col overflow-hidden border border-[#34404c] bg-[#070910] text-[11px] text-slate-200 shadow-2xl shadow-black/70">
                <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-[#20242c] bg-[#101219] px-2">
                  {path.length > 0 ? (
                    <button type="button" className="flex h-8 w-8 items-center justify-center text-slate-400 active:text-slate-100" onClick={() => setPath((value) => value.slice(0, -1))}>
                      <ChevronLeft size={16} />
                    </button>
                  ) : (
                    <span className="h-8 w-8" />
                  )}
                  <div className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-widest text-slate-200">{mobileTitle}</div>
                  <button type="button" className="flex h-8 w-8 items-center justify-center text-slate-400 active:text-slate-100" onClick={() => setOpen(false)}>
                    <X size={16} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
                  {mobileNodes.length === 0 ? (
                    <div className="px-3 py-3 text-slate-600">{loading ? "Loading..." : "No effects"}</div>
                  ) : (
                    mobileNodes.map((node) => {
                      const nextPath = [...path, node];
                      const hasChildren = Boolean(node.children?.length);
                      const effect = toEffect(nextPath);
                      return (
                        <button
                          key={node.key}
                          type="button"
                          disabled={node.disabled}
                          className="grid min-h-9 w-full grid-cols-[1fr,20px] items-center gap-2 border-b border-[#151922] px-2 text-left active:bg-[#101721] disabled:text-slate-700"
                          onClick={() => {
                            if (hasChildren) {
                              setPath(nextPath);
                              return;
                            }
                            if (effect) {
                              onSelect(effect);
                              setOpen(false);
                            }
                          }}
                          title={node.typeName || node.label}
                        >
                          <span className="truncate">{node.label}</span>
                          {hasChildren && <ChevronRight size={12} className="shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div
              ref={menuRef}
              className="fixed z-[9998] flex max-h-80 border border-[#34404c] bg-[#070910] text-[11px] text-slate-200 shadow-2xl shadow-black/70"
              style={{ left: Math.max(8, left), top: Math.max(8, top) }}
            >
              {columns.map((nodes, columnIndex) => (
                <div key={columnIndex} className="max-h-80 w-56 overflow-y-auto border-r border-[#20242c] py-1 last:border-r-0">
                  {nodes.length === 0 ? (
                    <div className="px-2 py-2 text-slate-600">{loading ? "Loading..." : "No effects"}</div>
                  ) : (
                    nodes.map((node) => {
                      const selected = path[columnIndex]?.key === node.key;
                      const nextPath = [...path.slice(0, columnIndex), node];
                      const hasChildren = Boolean(node.children?.length);
                      const effect = toEffect(nextPath);
                      return (
                        <button
                          key={node.key}
                          type="button"
                          disabled={node.disabled}
                          className={`flex h-7 w-full items-center justify-between gap-2 px-2 text-left hover:bg-[#101721] disabled:text-slate-700 ${
                            selected ? "bg-[#101721] text-[#8bd3ff]" : ""
                          }`}
                          onMouseEnter={() => setPath(nextPath)}
                          onClick={() => {
                            if (hasChildren) {
                              setPath(nextPath);
                              return;
                            }
                            if (effect) {
                              onSelect(effect);
                              setOpen(false);
                            }
                          }}
                          title={node.typeName || node.label}
                        >
                          <span className="truncate">{node.label}</span>
                          {hasChildren && <ChevronRight size={12} className="shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>
              ))}
            </div>
          ),
          document.body
        )}
    </>
  );
}
