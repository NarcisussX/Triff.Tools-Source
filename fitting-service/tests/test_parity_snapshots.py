from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from pyfa_adapter.eft import import_eft
from tests.parity import expected_path_for_fit, fit_fixture_paths, normalize_calculation


ABS_TOLERANCE = 0.001
REL_TOLERANCE = 0.000001


def _compare(expected: Any, actual: Any, path: str = "stats") -> None:
    if isinstance(expected, dict):
        assert isinstance(actual, dict), f"{path} should be an object"
        assert set(expected.keys()) == set(actual.keys()), f"{path} keys changed"
        for key in expected:
            _compare(expected[key], actual[key], f"{path}.{key}")
        return
    if isinstance(expected, list):
        assert actual == expected, f"{path} changed"
        return
    if isinstance(expected, (int, float)) and not isinstance(expected, bool):
        assert actual == pytest.approx(expected, abs=ABS_TOLERANCE, rel=REL_TOLERANCE), f"{path} changed"
        return
    assert actual == expected, f"{path} changed"


@pytest.mark.parametrize("fit_path", fit_fixture_paths(), ids=lambda path: Path(path).stem)
def test_fit_matches_pyfa_snapshot(fit_path: Path) -> None:
    expected_path = expected_path_for_fit(fit_path)
    assert expected_path.exists(), f"Missing expected snapshot for {fit_path.name}. Run scripts/bless_parity_snapshots.py intentionally."

    imported = import_eft(fit_path.read_text(encoding="utf-8"))
    assert imported["ok"] is True, imported.get("errors")
    assert imported.get("calculation"), "Import did not return a calculation result"

    actual = normalize_calculation(imported["calculation"])
    actual["fitName"] = imported["payload"]["fitName"]
    expected = json.loads(expected_path.read_text(encoding="utf-8"))["stats"]
    _compare(expected, actual)
