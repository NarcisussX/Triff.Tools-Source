"""Regenerate reviewed CombatProfile examples using the installed engine.

Run in the fitting-service image. These are adapter regression snapshots, not
independent desktop Pyfa measurements. Review all changes before blessing them.
"""
from pathlib import Path
import json
import os
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pyfa_adapter.combat_profile import combat_profile


def main() -> None:
    os.environ.setdefault("PYFA_SAVEDDATA_DB", "sqlite:///:memory:")
    root = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "combat_profiles"
    for eft in sorted(root.glob("*.eft")):
        result = combat_profile({"eft": eft.read_text(encoding="utf-8")})
        if not result["ok"]:
            raise RuntimeError(f"{eft.name}: {result['errors']}")
        unexpected = [warning for warning in result["warnings"] if warning["code"] not in ("drone_bandwidth_exceeded", "drone_active_limited")]
        if unexpected:
            raise RuntimeError(f"Review fixture warnings before blessing {eft.name}: {unexpected}")
        eft.with_suffix(".json").write_text(json.dumps(result, indent=2, ensure_ascii=True, allow_nan=False) + "\n", encoding="utf-8")
        print(f"{eft.stem}: {result['profile']['profileId']}")


if __name__ == "__main__":
    main()
