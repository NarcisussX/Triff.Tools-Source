from __future__ import annotations

import asyncio

import pytest

from app import get_charges
from pyfa_adapter import configure_pyfa
from pyfa_adapter.browser import compatible_charges


def _type_id(name: str) -> int:
    configure_pyfa()
    import eos.db

    item = eos.db.getItem(name)
    assert item is not None, name
    return int(item.ID)


@pytest.mark.parametrize(
    ("module_name", "expected", "excluded"),
    [
        (
            "Focused Medium Pulse Laser II",
            {"Multifrequency M", "Imperial Navy Multifrequency M", "Scorch M"},
            {"Multifrequency S", "Multifrequency L"},
        ),
        (
            "Light Neutron Blaster II",
            {"Antimatter Charge S", "Void S"},
            {"Antimatter Charge M", "Void M"},
        ),
        (
            "Cruise Missile Launcher II",
            {"Scourge Cruise Missile", "Scourge Fury Cruise Missile"},
            {"Scourge Heavy Missile"},
        ),
        (
            "Heavy Capacitor Booster II",
            {"Cap Booster 800", "Navy Cap Booster 800"},
            {"Tracking Speed Script"},
        ),
        (
            "Tracking Computer II",
            {"Tracking Speed Script", "Optimal Range Script"},
            {"Targeting Range Script"},
        ),
        (
            "Sensor Booster II",
            {"Targeting Range Script", "Scan Resolution Script"},
            {"Tracking Speed Script"},
        ),
        (
            "Missile Guidance Computer II",
            {"Missile Range Script", "Missile Precision Script"},
            {"Optimal Range Script"},
        ),
    ],
)
def test_charge_endpoint_lists_compatible_ammo_and_scripts(
    module_name: str, expected: set[str], excluded: set[str]
) -> None:
    module_type_id = _type_id(module_name)
    # Exercise the route too: lookup exceptions must not become a silent empty menu.
    result = asyncio.run(get_charges(module_type_id))

    assert result["ok"] is True, result.get("errors")
    assert result["errors"] == []
    names = {row["typeName"] for row in result["charges"]}
    assert expected <= names
    assert not excluded & names

    import eos.db
    from eos.saveddata.module import Module

    module = Module(eos.db.getItem(module_type_id))
    for row in result["charges"]:
        charge = eos.db.getItem(row["typeId"])
        assert charge.published
        assert module.isValidCharge(charge)
        assert row["categoryName"] == "Charge"
        assert row["chargeGroupId"] == charge.groupID
        assert row["chargeGroupName"] == charge.group.name


def test_module_without_charges_has_successful_empty_result() -> None:
    assert asyncio.run(get_charges(_type_id("Damage Control II"))) == {
        "ok": True, "charges": [], "errors": [],
    }


@pytest.mark.parametrize(("type_id", "error_code"), [(-1, "unknown_module"), (587, "not_module")])
def test_invalid_charge_target_returns_error(type_id: int, error_code: str) -> None:
    result = asyncio.run(get_charges(type_id))

    assert result["ok"] is False
    assert result["charges"] == []
    assert result["errors"][0]["code"] == error_code


def test_charge_limit_preserves_sorted_results() -> None:
    module_type_id = _type_id("Focused Medium Pulse Laser II")
    full = compatible_charges(module_type_id)
    limited = compatible_charges(module_type_id, limit=2)

    assert full["ok"] is limited["ok"] is True
    assert len(full["charges"]) > 2
    assert full["charges"] == sorted(
        full["charges"], key=lambda row: (row["chargeGroupName"], row["typeName"])
    )
    assert limited["charges"] == full["charges"][:2]
