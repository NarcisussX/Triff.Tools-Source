from __future__ import annotations

from pathlib import Path
from typing import Any

IMPORTANT_LAYERS = ("shield", "armor", "hull")
IMPORTANT_DAMAGE_TYPES = ("em", "thermal", "kinetic", "explosive")


def _round_number(value: Any) -> Any:
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)):
        return round(float(value), 6)
    return value


def _get(data: dict[str, Any], *keys: str) -> Any:
    current: Any = data
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            raise AssertionError(f"Missing stat path: {'.'.join(keys)}")
        current = current[key]
    return current


def _resists(stats: dict[str, Any], layer: str) -> dict[str, Any]:
    values = _get(stats, "defense", "resists", layer)
    return {damage_type: _round_number(_get(values, damage_type)) for damage_type in IMPORTANT_DAMAGE_TYPES}


def _hp(stats: dict[str, Any]) -> dict[str, Any]:
    values = _get(stats, "defense", "hp")
    return {layer: _round_number(_get(values, layer)) for layer in IMPORTANT_LAYERS}


def normalize_calculation(result: dict[str, Any]) -> dict[str, Any]:
    if not result.get("ok"):
        raise AssertionError(f"Calculation failed: {result.get('errors')}")
    stats = result.get("stats")
    if not isinstance(stats, dict):
        raise AssertionError("Calculation response did not include stats")

    resources = _get(stats, "resources")
    capacitor = _get(stats, "capacitor")
    firepower = _get(stats, "firepower")
    navigation = _get(stats, "navigation")
    targeting = _get(stats, "targeting")
    drones = _get(stats, "drones")

    warnings = result.get("warnings") or []
    errors = result.get("errors") or []

    return {
        "ship": {
            "typeId": _get(stats, "ship", "typeId"),
            "typeName": _get(stats, "ship", "typeName"),
        },
        "resources": {
            "cpuUsed": _round_number(_get(resources, "cpu", "used")),
            "cpuTotal": _round_number(_get(resources, "cpu", "output")),
            "powergridUsed": _round_number(_get(resources, "powergrid", "used")),
            "powergridTotal": _round_number(_get(resources, "powergrid", "output")),
            "calibrationUsed": _round_number(_get(resources, "calibration", "used")),
            "calibrationTotal": _round_number(_get(resources, "calibration", "output")),
        },
        "defense": {
            "hp": _hp(stats),
            "shieldResists": _resists(stats, "shield"),
            "armorResists": _resists(stats, "armor"),
            "hullResists": _resists(stats, "hull"),
            "ehp": _round_number(_get(stats, "defense", "ehp", "total")),
        },
        "capacitor": {
            "capacity": _round_number(_get(capacitor, "capacity")),
            "stable": bool(_get(capacitor, "stable")),
            "state": _round_number(_get(capacitor, "state")),
            "stateUnit": _get(capacitor, "stateUnit"),
            "rechargeTime": _round_number(_get(capacitor, "rechargeTime")),
        },
        "firepower": {
            "totalDps": _round_number(_get(firepower, "dps")),
            "weaponDps": _round_number(_get(firepower, "weaponDps")),
            "turretDps": None,
            "missileDps": None,
            "droneDps": _round_number(_get(firepower, "droneDps")),
            "volley": _round_number(_get(firepower, "volley")),
        },
        "navigation": {
            "maxVelocity": _round_number(_get(navigation, "maxSpeed")),
            "alignTime": _round_number(_get(navigation, "alignTime")),
            "mass": _round_number(_get(navigation, "mass")),
        },
        "targeting": {
            "range": _round_number(_get(targeting, "range")),
            "scanResolution": _round_number(_get(targeting, "scanResolution")),
            "maxLockedTargets": _round_number(_get(targeting, "maxTargets")),
        },
        "drones": {
            "bandwidthUsed": _round_number(_get(drones, "bandwidthUsed")),
            "bandwidthTotal": _round_number(_get(drones, "bandwidthTotal")),
        },
        "messages": {
            "warningCount": len(warnings),
            "warningCodes": sorted({warning.get("code") for warning in warnings if warning.get("code")}),
            "errorCount": len(errors),
            "errorCodes": sorted({error.get("code") for error in errors if error.get("code")}),
        },
    }


def fit_fixture_paths() -> list[Path]:
    return sorted((Path(__file__).parent / "fixtures" / "fits").glob("*.eft"))


def expected_path_for_fit(fit_path: Path) -> Path:
    return Path(__file__).parent / "fixtures" / "expected" / f"{fit_path.stem}.json"
