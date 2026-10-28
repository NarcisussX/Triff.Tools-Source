from __future__ import annotations

import sys
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from pyfa_adapter.browser import compatible_charges
from pyfa_adapter.eft import import_eft
from tests.parity import fit_fixture_paths, normalize_calculation


def main() -> int:
    fit_paths = fit_fixture_paths()
    if not fit_paths:
        print("No EFT fixtures found", file=sys.stderr)
        return 1
    imported = import_eft(fit_paths[0].read_text(encoding="utf-8"))
    if not imported.get("ok") or not imported.get("calculation", {}).get("ok"):
        print(imported.get("errors") or imported.get("calculation", {}).get("errors"), file=sys.stderr)
        return 1
    stats = normalize_calculation(imported["calculation"])
    if stats["resources"]["cpuTotal"] <= 0 or stats["defense"]["ehp"] <= 0:
        print("Smoke calculation did not include core stats", file=sys.stderr)
        return 1
    # Imported charges bypass the menu lookup; check that path separately.
    import eos.db

    for module_name, charge_name in (
        ("Focused Medium Pulse Laser II", "Imperial Navy Multifrequency M"),
        ("Tracking Computer II", "Tracking Speed Script"),
    ):
        module = eos.db.getItem(module_name)
        if module is None:
            print(f"Smoke module was not found: {module_name}", file=sys.stderr)
            return 1
        result = compatible_charges(int(module.ID))
        if not result.get("ok") or charge_name not in {row["typeName"] for row in result.get("charges", [])}:
            print(f"Smoke charge lookup failed for {module_name}: {result}", file=sys.stderr)
            return 1
    print(f"ok {stats['ship']['typeName']} dps={stats['firepower']['totalDps']} ehp={stats['defense']['ehp']}")
    print("ok charge and script lookups")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
