from __future__ import annotations

from pyfa_adapter import configure_pyfa
from pyfa_adapter.calculator import calculate


def _type_id(name: str) -> int:
    configure_pyfa()
    import eos.db

    item = eos.db.getItem(name)
    assert item is not None, name
    return int(item.ID)


def _empty_fit(ship_name: str, fit_name: str = "Fit") -> dict:
    return {
        "shipTypeId": _type_id(ship_name),
        "fitName": fit_name,
        "characterMode": "all_v",
        "modules": {"high": [], "mid": [], "low": [], "rig": [], "subsystem": []},
        "drones": [],
        "fighters": [],
        "cargo": [],
        "implants": [],
        "boosters": [],
        "projectedEffects": [],
        "environment": {"wormholeEffect": None, "abyssalWeather": None},
    }


def test_projected_open_fit_applies_active_projectable_modules_and_removes_cleanly() -> None:
    target = _empty_fit("Rifter", "Projected Target")
    source = _empty_fit("Rifter", "Web Source")
    source["modules"]["mid"].append({
        "typeId": _type_id("Stasis Webifier II"),
        "typeName": "Stasis Webifier II",
        "state": "active",
    })

    baseline = calculate(target)
    projected = calculate({
        "targetFit": target,
        "sourceFits": [{"tabId": "source-web", "fitName": "Web Source", "fitState": source}],
        "projectedLinks": [{"id": "projection-1", "sourceTabId": "source-web", "enabled": True}],
        "commandLinks": [],
    })
    removed = calculate({
        "targetFit": target,
        "sourceFits": [{"tabId": "source-web", "fitName": "Web Source", "fitState": source}],
        "projectedLinks": [{"id": "projection-1", "sourceTabId": "source-web", "enabled": False}],
        "commandLinks": [],
    })

    assert baseline["ok"] is True
    assert projected["ok"] is True
    assert removed["ok"] is True
    assert projected["stats"]["navigation"]["maxSpeed"] < baseline["stats"]["navigation"]["maxSpeed"]
    assert removed["stats"]["navigation"]["maxSpeed"] == baseline["stats"]["navigation"]["maxSpeed"]
    assert projected["stats"]["crossFit"]["projectedSources"][0]["appliedEffects"][0]["typeName"] == "Stasis Webifier II"


def test_offline_projected_source_module_does_not_apply() -> None:
    target = _empty_fit("Rifter", "Projected Target")
    source = _empty_fit("Rifter", "Offline Web Source")
    source["modules"]["mid"].append({
        "typeId": _type_id("Stasis Webifier II"),
        "typeName": "Stasis Webifier II",
        "state": "offline",
    })

    baseline = calculate(target)
    projected = calculate({
        "targetFit": target,
        "sourceFits": [{"tabId": "source-web", "fitName": "Offline Web Source", "fitState": source}],
        "projectedLinks": [{"id": "projection-1", "sourceTabId": "source-web", "enabled": True}],
        "commandLinks": [],
    })

    assert projected["ok"] is True
    assert projected["stats"]["navigation"]["maxSpeed"] == baseline["stats"]["navigation"]["maxSpeed"]
    assert projected["stats"]["crossFit"]["projectedSources"][0]["appliedEffects"] == []


def test_command_source_applies_only_selected_command_bursts() -> None:
    target = _empty_fit("Rifter", "Command Target")
    source = _empty_fit("Claymore", "Shield Link Source")
    source["modules"]["high"].append({
        "typeId": _type_id("Shield Command Burst I"),
        "typeName": "Shield Command Burst I",
        "chargeTypeId": _type_id("Shield Harmonizing Charge"),
        "chargeTypeName": "Shield Harmonizing Charge",
        "state": "active",
    })

    baseline = calculate(target)
    boosted = calculate({
        "targetFit": target,
        "sourceFits": [{"tabId": "source-command", "fitName": "Shield Link Source", "fitState": source}],
        "projectedLinks": [],
        "commandLinks": [{
            "id": "command-1",
            "sourceTabId": "source-command",
            "enabled": True,
            "selectedBursts": [{"sourceModuleInstanceId": "high:0", "enabled": True}],
        }],
    })
    disabled = calculate({
        "targetFit": target,
        "sourceFits": [{"tabId": "source-command", "fitName": "Shield Link Source", "fitState": source}],
        "projectedLinks": [],
        "commandLinks": [{
            "id": "command-1",
            "sourceTabId": "source-command",
            "enabled": True,
            "selectedBursts": [{"sourceModuleInstanceId": "high:0", "enabled": False}],
        }],
    })

    assert baseline["ok"] is True
    assert boosted["ok"] is True
    assert disabled["ok"] is True
    assert boosted["stats"]["defense"]["resists"]["shield"]["em"] > baseline["stats"]["defense"]["resists"]["shield"]["em"]
    assert disabled["stats"]["defense"]["resists"]["shield"]["em"] == baseline["stats"]["defense"]["resists"]["shield"]["em"]
    assert boosted["stats"]["crossFit"]["commandSources"][0]["bursts"][0]["chargeTypeName"] == "Shield Harmonizing Charge"


def test_projected_tab_does_not_apply_command_bursts() -> None:
    target = _empty_fit("Rifter", "Projected Target")
    source = _empty_fit("Claymore", "Command Source")
    source["modules"]["high"].append({
        "typeId": _type_id("Shield Command Burst I"),
        "typeName": "Shield Command Burst I",
        "chargeTypeId": _type_id("Shield Harmonizing Charge"),
        "chargeTypeName": "Shield Harmonizing Charge",
        "state": "active",
    })

    baseline = calculate(target)
    projected = calculate({
        "targetFit": target,
        "sourceFits": [{"tabId": "source-command", "fitName": "Command Source", "fitState": source}],
        "projectedLinks": [{"id": "projection-1", "sourceTabId": "source-command", "enabled": True}],
        "commandLinks": [],
    })

    assert projected["ok"] is True
    assert projected["stats"]["defense"]["resists"]["shield"]["em"] == baseline["stats"]["defense"]["resists"]["shield"]["em"]
    assert projected["stats"]["crossFit"]["projectedSources"][0]["appliedEffects"] == []
