import DroneBay from "./DroneBay";
import type { QuantityItem } from "./types";

type Props = {
  implants: QuantityItem[];
  boosters: QuantityItem[];
  onRemoveImplant: (index: number) => void;
  onRemoveBooster: (index: number) => void;
};

export default function ImplantPanel({
  implants,
  boosters,
  onRemoveImplant,
  onRemoveBooster,
}: Props) {
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <DroneBay title="Implants" items={implants} emptyLabel="No implants" onRemove={onRemoveImplant} />
      <DroneBay title="Boosters" items={boosters} emptyLabel="No boosters" onRemove={onRemoveBooster} />
    </div>
  );
}
