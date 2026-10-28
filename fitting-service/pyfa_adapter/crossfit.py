from __future__ import annotations

from typing import Any

from .fit_builder import build_fit
from .serializers import SLOT_BY_VALUE, safe_float


def _fit_id(index: int) -> int:
    return 9_000_000 + index


def _module_key(module: Any, index: int) -> str:
    instance_id = getattr(module, "triffInstanceId", None)
    if instance_id:
        return str(instance_id)
    slot_name = getattr(module, "triffSlotName", None)
    slot_index = getattr(module, "triffSlotIndex", None)
    if slot_name is not None and slot_index is not None:
        return f"{slot_name}:{slot_index}"
    slot = SLOT_BY_VALUE.get(int(module.slot)) if getattr(module, "slot", None) is not None else "module"
    return f"{slot}:{index}"


def _state_name(module: Any) -> str:
    return getattr(getattr(module, "state", None), "name", str(getattr(module, "state", ""))).lower()


def _item_effects(module: Any) -> list[Any]:
    try:
        return list((module.item.effects or {}).values())
    except Exception:
        return []


def _is_command_burst(module: Any) -> bool:
    group_name = getattr(getattr(module, "item", None), "group", None).name if getattr(module, "item", None) and getattr(module.item, "group", None) else ""
    if group_name == "Command Burst":
        return True
    if "command burst" in (getattr(module.item, "typeName", "") or "").lower():
        return True
    if getattr(module, "charge", None) is not None:
        charge_group = getattr(getattr(module.charge, "group", None), "name", "") or ""
        if "Command Burst Charges" in charge_group:
            return True
    return any(effect.isType("gang") for effect in _item_effects(module))


def _is_projectable_module(module: Any) -> bool:
    if _is_command_burst(module):
        return False
    if _state_name(module) == "offline":
        return False
    return any(effect.isType("projected") for effect in _item_effects(module))


def _module_summary(module: Any, index: int, effect_type: str) -> dict[str, Any]:
    charge = getattr(module, "charge", None)
    return {
        "sourceModuleInstanceId": _module_key(module, index),
        "typeId": int(module.item.ID),
        "typeName": module.item.typeName,
        "state": _state_name(module),
        "chargeTypeId": int(charge.ID) if charge is not None else None,
        "chargeTypeName": charge.typeName if charge is not None else None,
        "effectType": effect_type,
    }


def _build_sources(payload: dict[str, Any], warnings: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    sources: dict[str, dict[str, Any]] = {}
    for index, source in enumerate(payload.get("sourceFits") or [], start=1):
        tab_id = str(source.get("tabId") or "")
        fit_state = source.get("fitState") or {}
        if not tab_id or not fit_state:
            continue
        source_fit, source_warnings, source_errors = build_fit(fit_state)
        warnings.extend({**warning, "sourceTabId": tab_id} for warning in source_warnings)
        if source_fit is None or source_errors:
            warnings.append({
                "code": "crossfit_source_invalid",
                "message": f"{source.get('fitName') or tab_id} could not be used as a source fit.",
                "sourceTabId": tab_id,
                "details": source_errors,
            })
            continue
        source_fit.ID = _fit_id(index)
        sources[tab_id] = {
            "tabId": tab_id,
            "fit": source_fit,
            "fitName": source.get("fitName") or fit_state.get("fitName") or source_fit.name,
            "shipName": source.get("shipName") or getattr(source_fit.ship.item, "typeName", None),
            "dirty": bool(source.get("dirty")),
        }
    return sources


def _link_projected_fit(target_fit: Any, source_fit: Any, active: bool = True, amount: int = 1, projection_range: float | None = None) -> None:
    from eos.db.saveddata.fit import ProjectedFit

    projected = ProjectedFit(source_fit.ID, source_fit, amount=amount, active=active)
    projected.victimID = target_fit.ID
    projected.victim_fit = target_fit
    projected.projectionRange = projection_range
    source_fit.projectedOnto[target_fit.ID] = projected
    target_fit.victimOf[source_fit.ID] = projected


def _link_command_fit(target_fit: Any, source_fit: Any, active: bool = True) -> None:
    from eos.db.saveddata.fit import CommandFit

    command = CommandFit(source_fit.ID, source_fit, active=active)
    command.boostedID = target_fit.ID
    command.boosted_fit = target_fit
    source_fit.boostedOnto[target_fit.ID] = command
    target_fit.boostedOf[source_fit.ID] = command


def _selected_burst_ids(link: dict[str, Any]) -> tuple[set[str], bool]:
    if "selectedBursts" not in link:
        return set(), False
    selected = {
        str(row.get("sourceModuleInstanceId"))
        for row in link.get("selectedBursts") or []
        if row and row.get("enabled", True) and row.get("sourceModuleInstanceId")
    }
    return selected, True


def _filter_command_bursts(source_fit: Any, selected_ids: set[str], has_explicit_selection: bool) -> list[dict[str, Any]]:
    from eos.const import FittingModuleState

    summaries: list[dict[str, Any]] = []
    for index, module in enumerate(source_fit.modules):
        if not _is_command_burst(module):
            continue
        key = _module_key(module, index)
        enabled = (key in selected_ids) if has_explicit_selection else True
        if not enabled and module.isValidState(FittingModuleState.OFFLINE):
            module.state = FittingModuleState.OFFLINE
        if enabled:
            summaries.append(_module_summary(module, index, "command_burst"))
    return summaries


def _projected_summary(source_fit: Any) -> list[dict[str, Any]]:
    return [
        _module_summary(module, index, "projected")
        for index, module in enumerate(source_fit.modules)
        if _is_projectable_module(module)
    ]


def apply_cross_fit_links(target_fit: Any, payload: dict[str, Any], warnings: list[dict[str, Any]]) -> dict[str, Any]:
    target_fit.ID = _fit_id(0)
    sources = _build_sources(payload, warnings)
    crossfit = {
        "projectedSources": [],
        "commandSources": [],
    }

    for link in payload.get("projectedLinks") or []:
        if not link or not link.get("enabled", True):
            continue
        tab_id = str(link.get("sourceTabId") or "")
        source = sources.get(tab_id)
        if not source:
            warnings.append({"code": "projected_source_missing", "message": "Projected source fit is no longer open.", "sourceTabId": tab_id})
            continue
        source_fit = source["fit"]
        effects = _projected_summary(source_fit)
        _link_projected_fit(
            target_fit,
            source_fit,
            active=True,
            amount=max(1, int(link.get("amount") or 1)),
            projection_range=safe_float(link.get("projectionRange")),
        )
        crossfit["projectedSources"].append({
            "id": link.get("id"),
            "sourceTabId": tab_id,
            "fitName": source["fitName"],
            "shipName": source["shipName"],
            "dirty": source["dirty"],
            "enabled": True,
            "appliedEffects": effects,
        })

    for link in payload.get("commandLinks") or []:
        if not link or not link.get("enabled", True):
            continue
        tab_id = str(link.get("sourceTabId") or "")
        source = sources.get(tab_id)
        if not source:
            warnings.append({"code": "command_source_missing", "message": "Command source fit is no longer open.", "sourceTabId": tab_id})
            continue
        selected_ids, has_explicit_selection = _selected_burst_ids(link)
        source_fit = source["fit"]
        bursts = _filter_command_bursts(source_fit, selected_ids, has_explicit_selection)
        if bursts:
            _link_command_fit(target_fit, source_fit, active=True)
        crossfit["commandSources"].append({
            "id": link.get("id"),
            "sourceTabId": tab_id,
            "fitName": source["fitName"],
            "shipName": source["shipName"],
            "dirty": source["dirty"],
            "enabled": True,
            "bursts": bursts,
        })

    if crossfit["projectedSources"] or crossfit["commandSources"]:
        target_fit.clear()
        target_fit.calculateModifiedAttributes()

    return crossfit
