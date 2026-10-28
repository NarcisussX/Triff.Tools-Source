from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from pyfa_adapter.eft import import_eft
from pyfa_adapter.version_info import installed_version_info
from tests.parity import expected_path_for_fit, fit_fixture_paths, normalize_calculation


def main() -> int:
    version = installed_version_info(include_latest=False)
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    failures: list[str] = []

    for fit_path in fit_fixture_paths():
        imported = import_eft(fit_path.read_text(encoding="utf-8"))
        if not imported.get("ok") or not imported.get("calculation", {}).get("ok"):
            failures.append(f"{fit_path.name}: {imported.get('errors') or imported.get('calculation', {}).get('errors')}")
            continue

        stats = normalize_calculation(imported["calculation"])
        stats["fitName"] = imported["payload"]["fitName"]
        output = {
            "_meta": {
                "generatedBy": "fitting-service",
                "pyfaVersion": version.get("installedPyfaVersion"),
                "pyfaRef": version.get("installedPyfaRef"),
                "requestedPyfaRef": version.get("requestedPyfaRef"),
                "generatedAt": generated_at,
                "note": "Generated baseline from the currently installed Pyfa/eos. Compare against desktop Pyfa before committing new or changed fixture expectations.",
            },
            "stats": stats,
        }

        expected_path = expected_path_for_fit(fit_path)
        expected_path.parent.mkdir(parents=True, exist_ok=True)
        expected_path.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"blessed {expected_path.relative_to(APP_ROOT)}")

    if failures:
        print("snapshot blessing failed:", file=sys.stderr)
        for failure in failures:
            print(f"  {failure}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
