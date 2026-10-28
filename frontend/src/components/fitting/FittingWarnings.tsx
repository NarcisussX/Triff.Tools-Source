import { AlertTriangle, CircleAlert } from "lucide-react";
import type { FitMessage } from "./types";

type Props = {
  warnings?: FitMessage[];
  errors?: FitMessage[];
};

export default function FittingWarnings({ warnings = [], errors = [] }: Props) {
  if (!warnings.length && !errors.length) return null;

  return (
    <div className="space-y-1">
      {errors.map((err, index) => (
        <div
          key={`err-${err.code || index}`}
          className="flex items-start gap-2 border border-[#6b2424] bg-[#21090b] px-2 py-1.5 text-[11px] text-red-200"
        >
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
          <span>{err.message}</span>
        </div>
      ))}
      {warnings.map((warning, index) => (
        <div
          key={`warn-${warning.code || index}`}
          className="flex items-start gap-2 border border-[#5d4a1f] bg-[#171207] px-2 py-1.5 text-[11px] text-amber-100"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
          <span>{warning.message}</span>
        </div>
      ))}
    </div>
  );
}
