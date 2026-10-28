from __future__ import annotations

from pyfa_adapter.eft import import_eft
from tests.parity import fit_fixture_paths, normalize_calculation


def test_startup_smoke_fixture_calculates_core_stats() -> None:
    fit_path = fit_fixture_paths()[0]
    imported = import_eft(fit_path.read_text(encoding="utf-8"))
    assert imported["ok"] is True, imported.get("errors")
    normalized = normalize_calculation(imported["calculation"])
    assert normalized["resources"]["cpuTotal"] > 0
    assert normalized["resources"]["powergridTotal"] > 0
    assert normalized["defense"]["ehp"] > 0
