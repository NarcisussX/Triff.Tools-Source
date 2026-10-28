import type { SVGProps } from "react";

export type EveIconDef = {
  markup: string;
};

export function makeEveIcon(svg: string): EveIconDef {
  return {
    markup: svg.replace(/^\s*<symbol\b[^>]*>/, "").replace(/<\/symbol>\s*$/, ""),
  };
}

type EveIconProps = SVGProps<SVGSVGElement> & {
  icon: EveIconDef;
};

export function EveIcon({ icon, className = "h-5 w-5", ...props }: EveIconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 128 128"
      className={`inline-block shrink-0 ${className}`}
      {...props}
    >
      <style>{".shape{fill:currentColor}"}</style>
      <g dangerouslySetInnerHTML={{ __html: icon.markup }} />
    </svg>
  );
}
