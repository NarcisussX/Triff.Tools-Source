from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest

from pyfa_adapter import configure_pyfa
from pyfa_adapter.calculator import calculate
from pyfa_adapter.eft import import_eft


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "imports"


def _type_id(name: str) -> int:
    configure_pyfa()
    import eos.db

    item = eos.db.getItem(name)
    assert item is not None, name
    return int(item.ID)


def _calculate(payload: dict[str, Any]) -> dict[str, Any]:
    result = calculate(payload)
    assert result["ok"] is True, result.get("errors")
    return result


def _first_gun_stats(payload: dict[str, Any]) -> dict[str, float]:
    result = _calculate(payload)
    row = result["stats"]["moduleRows"]["high"][0]
    display = row["displayStats"]
    return {
        "optimal": float(display["range"].get("optimalMeters") or 0.0),
        "falloff": float(display["range"].get("falloffMeters") or 0.0),
        "tracking": float(display["trackingOrApplication"].get("tracking") or 0.0),
    }


def _tracking_computer(payload: dict[str, Any]) -> dict[str, Any]:
    for module in payload["modules"]["mid"]:
        if module.get("typeName") == "Tracking Computer II":
            return module
    raise AssertionError("Tracking Computer II was not imported in the mid-slot block")


def _with_tracking_computer_state(
    payload: dict[str, Any],
    state: str,
    previous_state: str | None = None,
    charge_name: str | None = None,
) -> dict[str, Any]:
    next_payload = deepcopy(payload)
    module = _tracking_computer(next_payload)
    module["state"] = state
    if previous_state is None:
        module.pop("previousState", None)
    else:
        module["previousState"] = previous_state

    if charge_name is None:
        module.pop("chargeTypeId", None)
        module.pop("chargeTypeName", None)
    else:
        module["chargeTypeId"] = _type_id(charge_name)
        module["chargeTypeName"] = charge_name

    return next_payload


def test_active_scripted_module_restores_effects_after_offline_online_cycle() -> None:
    imported = import_eft((FIXTURE_DIR / "tempest_fleet_issue_refit_cargo.eft").read_text(encoding="utf-8"))
    assert imported["ok"] is True, imported.get("errors")
    payload = imported["payload"]
    assert _tracking_computer(payload)["state"] == "active"

    active = _first_gun_stats(payload)

    offline_payload = _with_tracking_computer_state(payload, "offline", previous_state="active")
    offline = _first_gun_stats(offline_payload)
    assert offline["tracking"] < active["tracking"]

    online_payload = _with_tracking_computer_state(offline_payload, "online", previous_state="active")
    online = _first_gun_stats(online_payload)
    online_result = _calculate(online_payload)
    assert _tracking_computer(online_result["payload"])["state"] == "online"
    assert online["tracking"] < active["tracking"]

    restored_payload = _with_tracking_computer_state(online_payload, "active")
    restored = _first_gun_stats(restored_payload)
    assert restored["tracking"] == pytest.approx(active["tracking"])
    assert restored["optimal"] == pytest.approx(active["optimal"])
    assert restored["falloff"] == pytest.approx(active["falloff"])

    tracking_script_payload = _with_tracking_computer_state(restored_payload, "active", charge_name="Tracking Speed Script")
    tracking_script = _first_gun_stats(tracking_script_payload)
    assert tracking_script["tracking"] > restored["tracking"]
    assert _tracking_computer(tracking_script_payload)["chargeTypeName"] == "Tracking Speed Script"

    optimal_script_payload = _with_tracking_computer_state(tracking_script_payload, "active", charge_name="Optimal Range Script")
    optimal_script = _first_gun_stats(optimal_script_payload)
    assert optimal_script["optimal"] > tracking_script["optimal"]
    assert _tracking_computer(optimal_script_payload)["chargeTypeName"] == "Optimal Range Script"
