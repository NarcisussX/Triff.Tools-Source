import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";

export type FittingItemInfoTarget = {
  typeId: number;
  typeName?: string;
};

type ItemInfoPayload = {
  ok: boolean;
  item?: {
    type_id: number;
    name: string;
    description: string | null;
    group: { group_id: number; name: string | null } | null;
    category: { category_id: number; name: string | null } | null;
    market_group: { market_group_id: number; name: string | null } | null;
    market_group_path?: { market_group_id: number; name: string | null }[];
  };
  dogma?: {
    attribute_id: number;
    name: string | null;
    display_name: string;
    value: string | number | null;
    display_value?: string | null;
  }[];
  traits?: {
    miscBonuses: TraitBonus[];
    roleBonuses: TraitBonus[];
    types: {
      skill_type_id: number;
      skill_name: string | null;
      bonuses: TraitBonus[];
    }[];
  } | null;
  error?: string;
};

type TraitBonus = {
  bonus: number | null;
  unit: string | null;
  text: string;
};

const ATTRIBUTE_LIMIT = 96;

function eveIcon(typeId?: number | null, size = 64) {
  return typeId ? `https://images.evetech.net/types/${typeId}/icon?size=${size}` : "";
}

function plainDescription(value: string | null | undefined) {
  if (!value) return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function formatNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: 4 }) : String(value ?? "-");
}

function marketPath(item: NonNullable<ItemInfoPayload["item"]>) {
  const path = item.market_group_path?.map((entry) => entry.name).filter(Boolean) || [];
  if (path.length) return path.join(" > ");
  return item.market_group?.name || "";
}

function traitPrefix(bonus: TraitBonus) {
  if (bonus.bonus == null) return "";
  return `${formatNumber(bonus.bonus)}${bonus.unit ? ` ${bonus.unit}` : ""}`;
}

function TraitLine({ bonus }: { bonus: TraitBonus }) {
  const prefix = traitPrefix(bonus);
  return (
    <div className="text-[11px] leading-5 text-slate-300">
      {prefix && <span className="font-mono text-[#f1c26d]">{prefix}</span>} {bonus.text}
    </div>
  );
}

export default function FittingItemInfoModal({ target, onClose }: { target: FittingItemInfoTarget; onClose: () => void }) {
  const [payload, setPayload] = useState<ItemInfoPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/items/${target.typeId}`, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(response.status === 404 ? "Item not found" : `HTTP ${response.status}`);
        return response.json() as Promise<ItemInfoPayload>;
      })
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Item failed to load");
        setPayload(data);
      })
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError") return;
        setPayload(null);
        setError((err as Error).message || "Item failed to load");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [target.typeId]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const item = payload?.item;
  const description = plainDescription(item?.description);
  const traits = payload?.traits;
  const hasTraits = !!traits && (traits.types.length > 0 || traits.roleBonuses.length > 0 || traits.miscBonuses.length > 0);
  const attributes = (payload?.dogma || [])
    .filter((row) => row.display_name && row.value != null)
    .slice(0, ATTRIBUTE_LIMIT);

  const body = (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        className="flex max-h-[min(820px,calc(100vh-2rem))] w-[min(920px,calc(100vw-2rem))] flex-col overflow-hidden border border-[#34404c] bg-[#070910] text-slate-100 shadow-2xl shadow-black"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-[#20242c] bg-[#101219] px-3">
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold uppercase tracking-widest text-slate-100">
              {item?.name || target.typeName || `Type ${target.typeId}`}
            </div>
            <div className="font-mono text-[10px] text-slate-600">typeID {target.typeId}</div>
          </div>
          <button type="button" className="flex h-8 w-8 items-center justify-center text-slate-400 hover:text-slate-100" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading && <div className="flex min-h-32 items-center justify-center gap-2 text-[12px] text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading item info</div>}
          {!loading && error && <div className="border border-[#6b2b32] bg-[#1d090b] p-3 text-[12px] text-[#ffaaaa]">{error}</div>}
          {!loading && item && (
            <div className="space-y-3">
              <div className="grid grid-cols-[72px,1fr,168px] gap-3 border border-[#20242c] bg-[#05070b] p-3">
                <img src={eveIcon(item.type_id)} alt="" className="h-16 w-16 border border-[#30343d] bg-black object-cover" />
                <div className="min-w-0">
                  <div className="truncate text-[16px] font-semibold uppercase tracking-[0.08em] text-slate-100">{item.name}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {[item.category?.name, item.group?.name].filter(Boolean).map((label) => (
                      <span key={label} className="border border-[#303236] bg-[#070910] px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-slate-400">{label}</span>
                    ))}
                  </div>
                  {marketPath(item) && <div className="mt-2 truncate font-mono text-[10px] text-slate-600">{marketPath(item)}</div>}
                </div>
                <a
                  href={`/items/${item.type_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center justify-center self-start border border-[#46b2ff]/60 bg-[#08131d] px-2 text-[10px] uppercase tracking-widest text-[#8bd3ff] hover:bg-[#101923]"
                >
                  Open Full Item Page
                </a>
              </div>

              {description && (
                <section className="border border-[#20242c] bg-[#05070b]">
                  <div className="border-b border-[#20242c] bg-[#101219] px-2 py-1 text-[9px] uppercase tracking-widest text-[#8bd3ff]">Description</div>
                  <p className="max-h-32 overflow-y-auto whitespace-pre-wrap px-3 py-2 text-[12px] leading-5 text-slate-300">{description}</p>
                </section>
              )}

              {hasTraits && (
                <section className="border border-[#20242c] bg-[#05070b]">
                  <div className="border-b border-[#20242c] bg-[#101219] px-2 py-1 text-[9px] uppercase tracking-widest text-[#8bd3ff]">Traits</div>
                  <div className="grid gap-2 p-2 lg:grid-cols-2">
                    {traits.types.map((entry) => (
                      <div key={entry.skill_type_id} className="border border-[#252832] bg-[#070910] p-2">
                        <div className="mb-1 text-[11px] font-semibold text-[#f1c26d]">
                          {entry.skill_name || `Skill ${entry.skill_type_id}`} <span className="font-normal text-slate-500">per level</span>
                        </div>
                        {entry.bonuses.map((bonus, index) => <TraitLine key={`${entry.skill_type_id}-${index}`} bonus={bonus} />)}
                      </div>
                    ))}
                    {!!traits.roleBonuses.length && (
                      <div className="border border-[#252832] bg-[#070910] p-2">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-200">Role Bonuses</div>
                        {traits.roleBonuses.map((bonus, index) => <TraitLine key={`role-${index}`} bonus={bonus} />)}
                      </div>
                    )}
                    {!!traits.miscBonuses.length && (
                      <div className="border border-[#252832] bg-[#070910] p-2">
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-200">Misc Bonuses</div>
                        {traits.miscBonuses.map((bonus, index) => <TraitLine key={`misc-${index}`} bonus={bonus} />)}
                      </div>
                    )}
                  </div>
                </section>
              )}

              <section className="border border-[#20242c] bg-[#05070b]">
                <div className="flex items-center justify-between border-b border-[#20242c] bg-[#101219] px-2 py-1">
                  <span className="text-[9px] uppercase tracking-widest text-[#8bd3ff]">Attributes</span>
                  <span className="font-mono text-[9px] text-slate-600">{attributes.length}</span>
                </div>
                <div className="grid divide-y divide-[#151922] md:grid-cols-2 md:divide-x md:divide-y-0">
                  {[0, 1].map((column) => (
                    <div key={column} className="divide-y divide-[#151922]">
                      {attributes.filter((_, index) => index % 2 === column).map((row) => (
                        <div key={row.attribute_id} className="grid grid-cols-[1fr,128px] gap-2 px-2 py-1.5">
                          <div className="min-w-0">
                            <div className="truncate text-[10px] text-slate-300">{row.display_name}</div>
                            {row.name && <div className="truncate font-mono text-[8px] text-slate-700">attr {row.attribute_id}</div>}
                          </div>
                          <div className="self-center truncate text-right font-mono text-[10px] text-slate-100" title={String(row.display_value ?? row.value ?? "")}>
                            {row.display_value || formatNumber(row.value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
