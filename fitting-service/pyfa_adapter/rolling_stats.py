from __future__ import annotations

from copy import deepcopy
from typing import Any

from . import configure_pyfa
from .calculator import calculate
from .eft import import_eft
from .serializers import MODULE_SLOTS, safe_float


PROP_GROUP_KEYWORDS = ("afterburner", "microwarpdrive")
PROP_NAME_KEYWORDS = ("afterburner", "microwarpdrive")
ZERO_POINT_KEYWORDS = ("zero-point mass entangler", "zero point mass entangler")
CLOAK_KEYWORDS = ("cloaking device", "cloak")
JUMP_BLOCKER_KEYWORDS = (
    "bastion",
    "siege module",
    "triage module",
    "industrial core",
    "capital industrial core",
)


def _module_type_id(raw: dict[str, Any]) -> int | None:
    try:
        value = raw.get("typeId") or raw.get("type_id")
        return int(value) if value else None
    except (TypeError, ValueError):
        return None


def _module_name(raw: dict[str, Any], meta: dict[str, Any] | None = None) -> str:
    return str(raw.get("typeName") or raw.get("type_name") or (meta or {}).get("typeName") or "Unknown Module")


def _module_id(raw: dict[str, Any], slot: str, index: int) -> str:
    return str(raw.get("id") or raw.get("instanceId") or raw.get("instance_id") or f"{slot}:{index}")


def _iter_modules(payload: dict[str, Any]):
    modules = payload.get("modules") or {}
    for slot_name in MODULE_SLOTS:
        for index, raw in enumerate(modules.get(slot_name) or []):
            if isinstance(raw, dict):
                yield slot_name, index, raw


def _item_meta(type_id: int | None) -> dict[str, Any]:
    if not type_id:
        return {}
    try:
        configure_pyfa()
        import eos.db

        item = eos.db.getItem(int(type_id), eager=("group.category", "effects"))
        if item is None:
            return {}
        return {
            "typeId": int(item.ID),
            "typeName": item.typeName,
            "groupName": getattr(getattr(item, "group", None), "groupName", None),
            "categoryName": getattr(getattr(getattr(item, "group", None), "category", None), "categoryName", None),
            "effectNames": [str(getattr(effect, "effectName", "")) for effect in getattr(item, "effects", [])],
        }
    except Exception:
        return {}


def _module_ref(slot: str, index: int, raw: dict[str, Any], meta: dict[str, Any] | None = None) -> dict[str, Any]:
    type_id = _module_type_id(raw)
    return {
        "id": _module_id(raw, slot, index),
        "typeId": type_id,
        "typeName": _module_name(raw, meta),
        "slot": slot,
        "index": index,
    }


def _text_matches(text: str | None, keywords: tuple[str, ...]) -> bool:
    normalized = str(text or "").lower()
    return any(keyword in normalized for keyword in keywords)


def _module_matches(raw: dict[str, Any], meta: dict[str, Any], group_keywords: tuple[str, ...], name_keywords: tuple[str, ...]) -> bool:
    if _text_matches(meta.get("groupName"), group_keywords):
        return True
    if _text_matches(meta.get("typeName") or _module_name(raw, meta), name_keywords):
        return True
    return any(_text_matches(effect, name_keywords) for effect in meta.get("effectNames") or [])


def _is_prop_module(raw: dict[str, Any], meta: dict[str, Any]) -> bool:
    return _module_matches(raw, meta, PROP_GROUP_KEYWORDS, PROP_NAME_KEYWORDS)


def _is_zero_point_module(raw: dict[str, Any], meta: dict[str, Any]) -> bool:
    return _module_matches(raw, meta, ZERO_POINT_KEYWORDS, ZERO_POINT_KEYWORDS)


def _is_cloak_module(raw: dict[str, Any], meta: dict[str, Any]) -> bool:
    return _module_matches(raw, meta, CLOAK_KEYWORDS, CLOAK_KEYWORDS)


def _is_jump_blocker(raw: dict[str, Any], meta: dict[str, Any]) -> bool:
    return _module_matches(raw, meta, JUMP_BLOCKER_KEYWORDS, JUMP_BLOCKER_KEYWORDS)


def _discover_modules(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    prop_modules: list[dict[str, Any]] = []
    zero_point_modules: list[dict[str, Any]] = []
    jump_blockers: list[dict[str, Any]] = []
    rolling_inactive_modules: list[dict[str, Any]] = []
    for slot, index, raw in _iter_modules(payload):
        meta = _item_meta(_module_type_id(raw))
        ref = _module_ref(slot, index, raw, meta)
        if _is_prop_module(raw, meta):
            prop_modules.append(ref)
        if _is_zero_point_module(raw, meta):
            zero_point_modules.append(ref)
        if _is_jump_blocker(raw, meta):
            jump_blockers.append(ref)
            rolling_inactive_modules.append(ref)
        elif _is_cloak_module(raw, meta):
            rolling_inactive_modules.append(ref)
    return prop_modules, zero_point_modules, jump_blockers, rolling_inactive_modules


def _set_module_state(payload: dict[str, Any], target: dict[str, Any], state: str) -> None:
    modules = payload.get("modules") or {}
    slot = target.get("slot")
    index = target.get("index")
    try:
        modules[slot][int(index)]["state"] = state
    except (KeyError, IndexError, TypeError, ValueError):
        return


def _base_scenario_payload(payload: dict[str, Any], prop_modules: list[dict[str, Any]], forced_inactive_modules: list[dict[str, Any]]) -> dict[str, Any]:
    scenario = deepcopy(payload)
    scenario["characterMode"] = "all_v"
    scenario["skillProfile"] = None
    scenario["skillOverrides"] = None
    for prop in prop_modules:
        _set_module_state(scenario, prop, "online")
    for module in forced_inactive_modules:
        _set_module_state(scenario, module, "online")
    return scenario


def _navigation_from_result(result: dict[str, Any]) -> dict[str, float | None]:
    stats = result.get("stats") or {}
    nav = stats.get("navigation") or {}
    return {
        "massKg": safe_float(nav.get("mass")),
        "maxVelocityMs": safe_float(nav.get("maxSpeed")),
        "alignTimeSeconds": safe_float(nav.get("alignTime")),
        "agility": safe_float(nav.get("agility")),
        "warpSpeedAuPerSecond": safe_float(nav.get("warpSpeed")),
    }


def _scenario(
    key: str,
    label: str,
    payload: dict[str, Any],
    module_state: dict[str, Any] | None = None,
    warnings: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    result = calculate(payload)
    scenario_warnings = list(warnings or []) + list(result.get("warnings") or [])
    if not result.get("ok"):
        return {
            "key": key,
            "label": label,
            "moduleState": module_state or {},
            "massKg": None,
            "maxVelocityMs": None,
            "alignTimeSeconds": None,
            "agility": None,
            "warpSpeedAuPerSecond": None,
            "warnings": scenario_warnings,
            "errors": result.get("errors") or [{"code": "scenario_calculation_failed", "message": f"{label} failed to calculate."}],
        }
    return {
        "key": key,
        "label": label,
        "moduleState": module_state or {},
        **_navigation_from_result(result),
        "warnings": scenario_warnings,
        "errors": [],
    }


def _best_scenario(scenarios: list[dict[str, Any]], field: str) -> dict[str, Any] | None:
    valid = [scenario for scenario in scenarios if scenario.get(field) is not None and not scenario.get("errors")]
    if not valid:
        return None
    return max(valid, key=lambda scenario: float(scenario.get(field) or 0))


def _prop_scenarios_by_state(scenarios: list[dict[str, Any]], state: str) -> list[dict[str, Any]]:
    return [
        scenario for scenario in scenarios
        if (scenario.get("moduleState") or {}).get("activePropState") == state
    ]


def _summary(ship: dict[str, Any], cold: dict[str, Any], prop_scenarios: list[dict[str, Any]], zero_point: dict[str, Any] | None) -> dict[str, Any]:
    active_prop_scenarios = _prop_scenarios_by_state(prop_scenarios, "active")
    overheated_prop_scenarios = _prop_scenarios_by_state(prop_scenarios, "overheated")
    best_mass = _best_scenario(active_prop_scenarios, "massKg")
    best_speed = _best_scenario(active_prop_scenarios, "maxVelocityMs")
    best_heated_speed = _best_scenario(overheated_prop_scenarios, "maxVelocityMs")
    return {
        "ship": ship,
        "mass": {
            "coldKg": cold.get("massKg"),
            "bestPropKg": best_mass.get("massKg") if best_mass else None,
            "zeroPointKg": zero_point.get("massKg") if zero_point else None,
        },
        "movement": {
            "coldMaxVelocityMs": cold.get("maxVelocityMs"),
            "bestPropMaxVelocityMs": best_speed.get("maxVelocityMs") if best_speed else None,
            "bestPropMaxVelocityMsHeated": best_heated_speed.get("maxVelocityMs") if best_heated_speed else None,
            "bestPropAlignTimeSeconds": best_speed.get("alignTimeSeconds") if best_speed else None,
            "bestPropAgility": best_speed.get("agility") if best_speed else None,
        },
        "bestPropMassModule": (best_mass.get("moduleState") or {}).get("activePropModule") if best_mass else None,
        "bestPropSpeedModule": (best_speed.get("moduleState") or {}).get("activePropModule") if best_speed else None,
        "bestPropSpeedHeatedModule": (best_heated_speed.get("moduleState") or {}).get("activePropModule") if best_heated_speed else None,
    }


def rolling_stats(eft_text: str) -> dict[str, Any]:
    imported = import_eft(eft_text, calculate_fit=False)
    if not imported.get("ok"):
        return {
            "ok": False,
            "ship": None,
            "assumptions": {"skills": "all_v"},
            "summary": None,
            "scenarios": [],
            "warnings": imported.get("warnings") or [],
            "errors": imported.get("errors") or [{"code": "import_failed", "message": "The EFT fit could not be imported."}],
        }

    payload = imported.get("payload") or {}
    ship = {
        "typeId": payload.get("shipTypeId"),
        "typeName": payload.get("shipTypeName"),
        "fitName": payload.get("fitName"),
    }
    prop_modules, zero_point_modules, jump_blockers, forced_inactive_modules = _discover_modules(payload)
    warnings = list(imported.get("warnings") or [])
    if jump_blockers:
        warnings.append({
            "code": "jump_blocking_modules_forced_inactive",
            "message": "Jump-blocking modules were forced inactive for rolling scenarios.",
            "modules": jump_blockers,
        })
    rolling_inactive_non_blockers = [
        module for module in forced_inactive_modules
        if module.get("id") not in {blocker.get("id") for blocker in jump_blockers}
    ]
    if rolling_inactive_non_blockers:
        warnings.append({
            "code": "rolling_modules_forced_inactive",
            "message": "Modules that would distort rolling movement, such as cloaks, were forced inactive for rolling scenarios.",
            "modules": rolling_inactive_non_blockers,
        })

    base_payload = _base_scenario_payload(payload, prop_modules, forced_inactive_modules)
    cold = _scenario(
        "cold",
        "Cold",
        base_payload,
        {
            "activeModules": [],
            "disabledJumpBlockers": jump_blockers,
            "forcedInactiveModules": forced_inactive_modules,
        },
    )

    prop_scenarios: list[dict[str, Any]] = []
    for prop in prop_modules:
        for state in ("active", "overheated"):
            scenario_payload = _base_scenario_payload(payload, prop_modules, forced_inactive_modules)
            _set_module_state(scenario_payload, prop, state)
            prop_scenarios.append(_scenario(
                f"prop:{state}:{prop.get('id')}",
                f"{prop.get('typeName')} {state}",
                scenario_payload,
                {
                    "activeModules": [prop],
                    "activePropModule": prop,
                    "activePropState": state,
                    "disabledJumpBlockers": jump_blockers,
                    "forcedInactiveModules": forced_inactive_modules,
                },
            ))

    zero_point = None
    if zero_point_modules:
        scenario_payload = _base_scenario_payload(payload, prop_modules, forced_inactive_modules)
        active_zero = zero_point_modules[0]
        _set_module_state(scenario_payload, active_zero, "active")
        zero_point = _scenario(
            "zero_point",
            f"{active_zero.get('typeName')} active",
            scenario_payload,
            {
                "activeModules": [active_zero],
                "activeZeroPointModule": active_zero,
                "disabledJumpBlockers": jump_blockers,
                "forcedInactiveModules": forced_inactive_modules,
            },
        )

    scenarios = [cold, *prop_scenarios]
    if zero_point is not None:
        scenarios.append(zero_point)

    return {
        "ok": not any(scenario.get("errors") for scenario in scenarios),
        "ship": ship,
        "assumptions": {
            "skills": "all_v",
            "hotMassDefinition": "prop module active, not overheated",
            "acceleration": "represented by Pyfa/eos alignTime and agility; no custom acceleration formula is applied",
            "jumpBlockingModulesDisabled": True,
            "propMode": "all fitted afterburner/microwarpdrive active and overheated scenarios returned; best-by-mass and best-by-speed summarized separately",
            "zeroPointMode": "returned only when a fitted Zero-Point Mass Entangler scenario is detectable",
        },
        "summary": _summary(ship, cold, prop_scenarios, zero_point),
        "scenarios": scenarios,
        "warnings": warnings,
        "errors": [error for scenario in scenarios for error in (scenario.get("errors") or [])],
    }
