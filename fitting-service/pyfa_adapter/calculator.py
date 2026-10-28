from __future__ import annotations

from typing import Any

from .crossfit import apply_cross_fit_links
from .fit_builder import build_fit
from .serializers import MODULE_SLOTS, fit_to_payload, stats_from_fit


def _is_abyssal_placeholder(raw_module: dict[str, Any] | None) -> bool:
    return bool(raw_module and (raw_module.get("abyssalPlaceholder") or raw_module.get("abyssal_placeholder")))


def _placeholder_reason(raw_module: dict[str, Any]) -> str:
    return raw_module.get("placeholderReason") or raw_module.get("placeholder_reason") or (
        "Imported from external EFT without base module, mutaplasmid, or mutated attributes."
    )


def _placeholder_warning(raw_modules: list[dict[str, Any]]) -> dict[str, Any]:
    if len(raw_modules) == 1:
        module = raw_modules[0]
        name = module.get("typeName") or f"Type {module.get('typeId')}"
        message = f"{name} was imported as an unresolved abyssal placeholder and is not included in calculated stats."
    else:
        message = f"{len(raw_modules)} abyssal modules were imported as unresolved placeholders and are not included in calculated stats."
    return {
        "code": "abyssal_placeholder",
        "message": message,
        "details": {
            "items": [
                {
                    "typeId": module.get("typeId") or module.get("type_id"),
                    "typeName": module.get("typeName"),
                }
                for module in raw_modules
            ],
        },
    }


def _normalized_placeholder(raw_module: dict[str, Any]) -> dict[str, Any]:
    row = dict(raw_module)
    row["abyssalPlaceholder"] = True
    row["placeholderReason"] = _placeholder_reason(row)
    row.setdefault("state", "placeholder")
    row.pop("mutation", None)
    return row


def _placeholder_display_cell() -> dict[str, str]:
    return {
        "value": "unresolved",
        "tooltip": "This external EFT abyssal has no mutation attributes, so it is not included in calculated stats.",
    }


def _placeholder_module_row(slot: str, index: int, raw_module: dict[str, Any]) -> dict[str, Any]:
    name = raw_module.get("typeName") or f"Type {raw_module.get('typeId')}"
    return {
        "slot": slot,
        "index": index,
        "typeId": int(raw_module.get("typeId") or raw_module.get("type_id") or 0),
        "name": name,
        "baseName": name,
        "state": "placeholder",
        "validStates": [],
        "canOverheat": False,
        "chargeTypeId": raw_module.get("chargeTypeId") or raw_module.get("charge_type_id"),
        "chargeName": raw_module.get("chargeTypeName") or raw_module.get("charge_type_name"),
        "cpu": None,
        "powergrid": None,
        "mutation": None,
        "abyssalPlaceholder": True,
        "placeholderReason": _placeholder_reason(raw_module),
        "displayStats": {
            "capOrFuel": _placeholder_display_cell(),
            "range": _placeholder_display_cell(),
            "trackingOrApplication": _placeholder_display_cell(),
        },
    }


def _merge_abyssal_placeholders(original_payload: dict[str, Any], calculated_payload: dict[str, Any], stats: dict[str, Any], warnings: list[dict[str, Any]]) -> None:
    original_modules = original_payload.get("modules") or {}
    calculated_modules = calculated_payload.get("modules") or {}
    module_rows = stats.get("moduleRows") or {}
    placeholders: list[dict[str, Any]] = []

    for slot in MODULE_SLOTS:
        original_slot = list(original_modules.get(slot) or [])
        if not any(_is_abyssal_placeholder(module) for module in original_slot):
            continue

        calculated_slot = list(calculated_modules.get(slot) or [])
        calculated_rows = list(module_rows.get(slot) or [])
        next_modules: list[dict[str, Any]] = []
        next_rows: list[dict[str, Any]] = []
        calc_module_index = 0
        calc_row_index = 0

        for raw_module in original_slot:
            if _is_abyssal_placeholder(raw_module):
                placeholder = _normalized_placeholder(raw_module)
                next_modules.append(placeholder)
                next_rows.append(_placeholder_module_row(slot, len(next_rows), placeholder))
                placeholders.append(placeholder)
                continue

            if calc_module_index < len(calculated_slot):
                next_modules.append(calculated_slot[calc_module_index])
                calc_module_index += 1
            else:
                next_modules.append(raw_module)

            if calc_row_index < len(calculated_rows):
                row = dict(calculated_rows[calc_row_index])
                row["index"] = len(next_rows)
                next_rows.append(row)
                calc_row_index += 1

        for row in calculated_slot[calc_module_index:]:
            next_modules.append(row)
        for row in calculated_rows[calc_row_index:]:
            next_row = dict(row)
            next_row["index"] = len(next_rows)
            next_rows.append(next_row)

        calculated_modules[slot] = next_modules
        module_rows[slot] = next_rows

        slot_stats = (stats.get("slots") or {}).get(slot)
        if slot_stats:
            total = slot_stats.get("total")
            used = len(next_modules)
            slot_stats["used"] = used
            try:
                slot_stats["free"] = float(total) - used
            except (TypeError, ValueError):
                slot_stats["free"] = slot_stats.get("free")

    stats["moduleRows"] = module_rows
    calculated_payload["modules"] = calculated_modules

    hardpoints = stats.get("hardpoints") or {}
    for kind in ("turret", "launcher"):
        row = hardpoints.get(kind)
        if not row:
            continue
        placeholder_count = sum(
            1
            for modules in original_modules.values()
            for module in modules or []
            if _is_abyssal_placeholder(module) and module.get("hardpoint") == kind
        )
        if placeholder_count <= 0:
            continue
        used = float(row.get("used") or 0) + placeholder_count
        row["used"] = used
        total = row.get("total")
        try:
            row["free"] = float(total) - used
        except (TypeError, ValueError):
            row["free"] = row.get("free")

    if placeholders:
        warnings.append(_placeholder_warning(placeholders))


def calculate(payload: dict[str, Any]) -> dict[str, Any]:
    target_payload = payload.get("targetFit") if isinstance(payload.get("targetFit"), dict) else payload
    fit, warnings, errors = build_fit(target_payload)
    if fit is None or errors:
        return {
            "ok": False,
            "warnings": warnings,
            "errors": errors,
            "payload": target_payload,
            "stats": None,
        }

    try:
        crossfit = apply_cross_fit_links(fit, payload, warnings)
        stats = stats_from_fit(fit)
        serialized_payload = fit_to_payload(fit)
        _merge_abyssal_placeholders(target_payload, serialized_payload, stats, warnings)
        if crossfit.get("projectedSources") or crossfit.get("commandSources"):
            stats["crossFit"] = crossfit
    except Exception as exc:
        return {
            "ok": False,
            "warnings": warnings,
            "errors": [{"code": "serialization_failed", "message": str(exc)}],
            "payload": fit_to_payload(fit),
            "stats": None,
        }

    return {
        "ok": True,
        "warnings": warnings,
        "errors": [],
        "payload": serialized_payload,
        "stats": stats,
    }
