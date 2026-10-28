import { useEffect, useState } from "react";

type Props = {
  quantity: number;
  onQuantity: (quantity: number) => void;
  className?: string;
  title?: string;
  ariaLabel?: string;
};

function positiveQuantity(value: unknown) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default function CargoQuantityInput({
  quantity,
  onQuantity,
  className,
  title = "Cargo quantity; set to 0 to remove",
  ariaLabel = "Cargo quantity",
}: Props) {
  const current = positiveQuantity(quantity);
  const [draft, setDraft] = useState(String(current));

  useEffect(() => {
    setDraft(String(current));
  }, [current]);

  function commit() {
    const value = draft.trim();
    if (!value) {
      setDraft(String(current));
      return;
    }
    if (!/^\d+$/.test(value)) {
      setDraft(String(current));
      return;
    }
    const next = Number(value);
    if (!Number.isSafeInteger(next)) {
      setDraft(String(current));
      return;
    }
    if (next === current) {
      setDraft(String(current));
      return;
    }
    onQuantity(next);
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={draft}
      className={className}
      title={title}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(String(current));
          event.currentTarget.blur();
        }
      }}
    />
  );
}
