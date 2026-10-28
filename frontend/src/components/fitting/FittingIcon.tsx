import { useEffect, useMemo, useState } from "react";
import { triffApiUrl } from "../../lib/webRuntime";

export type PyfaGuiIconName =
  | "overheat"
  | "firepower"
  | "mining"
  | "defense"
  | "resources"
  | "ship"
  | "em"
  | "thermal"
  | "kinetic"
  | "explosive";

function pyfaGuiIconUrl(name: PyfaGuiIconName) {
  return triffApiUrl(`/api/fitting/browser/gui-icon/${name}`);
}

function eveTypeIconUrl(typeId: number, size = 32) {
  return `https://images.evetech.net/types/${typeId}/icon?size=${size}`;
}

function fallbackGlyph(label: string, className: string) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center border border-[#30343d] bg-black font-mono text-[8px] text-slate-500 ${className}`}
      title={label}
      aria-label={label}
    >
      {label.slice(0, 1)}
    </span>
  );
}

export function PyfaGuiIcon({
  name,
  label,
  className = "h-4 w-4",
}: {
  name: PyfaGuiIconName;
  label: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [name]);

  if (failed) return fallbackGlyph(label, className);
  return (
    <img
      src={pyfaGuiIconUrl(name)}
      alt=""
      className={`inline-block shrink-0 object-contain ${className}`}
      title={label}
      aria-label={label}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function EveTypeIcon({
  typeId,
  label,
  className = "h-4 w-4",
}: {
  typeId: number;
  label: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [typeId]);

  if (failed) return fallbackGlyph(label, className);
  return (
    <img
      src={eveTypeIconUrl(typeId)}
      alt=""
      className={`inline-block shrink-0 object-contain ${className}`}
      title={label}
      aria-label={label}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function EveUiSymbolIcon({
  svg,
  label,
  className = "h-4 w-4",
}: {
  svg: string;
  label: string;
  className?: string;
}) {
  const markup = useMemo(
    () => svg.replace(/^\s*<symbol\b[^>]*>/, "").replace(/<\/symbol>\s*$/, ""),
    [svg],
  );

  return (
    <svg
      aria-label={label}
      role="img"
      viewBox="0 0 128 128"
      className={`inline-block shrink-0 ${className}`}
    >
      <style>{".shape{fill:currentColor}"}</style>
      <g dangerouslySetInnerHTML={{ __html: markup }} />
    </svg>
  );
}
