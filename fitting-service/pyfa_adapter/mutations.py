from __future__ import annotations

from typing import Any

from . import configure_pyfa


def safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _display_name(attr: Any) -> str:
    return (
        getattr(attr, "displayName", None)
        or getattr(attr, "name", None)
        or f"Attribute {getattr(attr, 'ID', '')}".strip()
    )


def _float_or_none(value: Any) -> float | None:
    parsed = safe_float(value)
    return parsed if parsed is not None else None


def _mutaplasmid_sort_key(mutaplasmid: Any) -> tuple[int, str]:
    order = {
        "Decayed": 10,
        "Gl. Decayed": 20,
        "Gravid": 30,
        "Gl. Gravid": 40,
        "Unstable": 50,
        "Gl. Unstable": 60,
        "Radical": 70,
        "Gl. Radical": 80,
    }
    name = getattr(mutaplasmid, "shortName", None) or getattr(getattr(mutaplasmid, "item", None), "typeName", "")
    return order.get(name, 900), name


def _attribute_detail(dynamic_attr: Any, base_item: Any) -> dict[str, Any]:
    base_attr = getattr(base_item, "attributes", {}).get(dynamic_attr.name)
    base_value = _float_or_none(getattr(base_attr, "value", None))
    min_mod = _float_or_none(getattr(dynamic_attr, "min", None))
    max_mod = _float_or_none(getattr(dynamic_attr, "max", None))
    min_value = base_value * min_mod if base_value is not None and min_mod is not None else None
    max_value = base_value * max_mod if base_value is not None and max_mod is not None else None
    return {
        "attributeId": int(dynamic_attr.ID),
        "attributeName": dynamic_attr.name,
        "displayName": _display_name(dynamic_attr),
        "baseValue": base_value,
        "minValue": min_value,
        "maxValue": max_value,
        "minModifier": min_mod,
        "maxModifier": max_mod,
        "highIsGood": bool(getattr(dynamic_attr, "highIsGood", False)),
        "unit": getattr(getattr(dynamic_attr, "unit", None), "displayName", None),
    }


def compatible_mutaplasmids(module_type_id: int) -> dict[str, Any]:
    configure_pyfa()
    import eos.db

    item = eos.db.getItem(int(module_type_id), eager=("attributes", "group.category"))
    if item is None:
        return {"ok": False, "mutaplasmids": [], "errors": [{"code": "unknown_module", "message": "Module typeID was not found."}]}

    mutaplasmids = []
    for mutaplasmid in sorted(getattr(item, "mutaplasmids", []) or [], key=_mutaplasmid_sort_key):
        mutaplasmids.append({
            "typeId": int(mutaplasmid.ID),
            "typeName": mutaplasmid.item.typeName,
            "shortName": mutaplasmid.shortName,
            "resultingTypeId": int(mutaplasmid.resultingItem.ID),
            "resultingTypeName": mutaplasmid.resultingItem.typeName,
            "attributes": [_attribute_detail(attr, item) for attr in mutaplasmid.attributes],
        })

    return {"ok": True, "mutaplasmids": mutaplasmids, "errors": []}


def mutation_from_raw(raw_mutation: dict[str, Any] | None, base_item: Any, warnings: list[dict[str, Any]]) -> tuple[Any | None, dict[int, float]]:
    configure_pyfa()
    import eos.db

    if not raw_mutation:
        return None, {}

    mutaplasmid_id = raw_mutation.get("mutaplasmidTypeId") or raw_mutation.get("mutaplasmid_type_id")
    mutaplasmid_name = raw_mutation.get("mutaplasmidName") or raw_mutation.get("mutaplasmid_name")
    mutaplasmid = None
    if mutaplasmid_id:
        mutaplasmid = eos.db.getDynamicItem(int(mutaplasmid_id))
    elif mutaplasmid_name:
        item = eos.db.getItem(str(mutaplasmid_name))
        if item is not None:
            mutaplasmid = eos.db.getDynamicItem(int(item.ID))

    if mutaplasmid is None:
        warnings.append({"code": "unknown_mutaplasmid", "message": f"Mutaplasmid was not found for {base_item.typeName}."})
        return None, {}

    if base_item not in getattr(mutaplasmid, "applicableItems", []):
        warnings.append({
            "code": "incompatible_mutaplasmid",
            "message": f"{mutaplasmid.item.typeName} is not compatible with {base_item.typeName}.",
        })
        return None, {}

    attributes_by_name = raw_mutation.get("attributes") or {}
    attributes_by_id = raw_mutation.get("attributeIds") or raw_mutation.get("attribute_ids") or {}
    values: dict[int, float] = {}
    for dynamic_attr in mutaplasmid.attributes:
        value = None
        if dynamic_attr.name in attributes_by_name:
            value = attributes_by_name.get(dynamic_attr.name)
        elif str(dynamic_attr.ID) in attributes_by_id:
            value = attributes_by_id.get(str(dynamic_attr.ID))
        parsed = safe_float(value)
        if parsed is not None:
            values[int(dynamic_attr.ID)] = parsed

    return mutaplasmid, values


def build_mutated_module(base_item: Any, raw_mutation: dict[str, Any], warnings: list[dict[str, Any]]) -> Any | None:
    configure_pyfa()
    from eos.saveddata.module import Module

    mutaplasmid, values = mutation_from_raw(raw_mutation, base_item, warnings)
    if mutaplasmid is None:
        return None

    try:
        module = Module(mutaplasmid.resultingItem, baseItem=base_item, mutaplasmid=mutaplasmid)
    except Exception as exc:
        warnings.append({"code": "mutation_build_failed", "message": f"{base_item.typeName}: {exc}"})
        return None

    for attr_id, mutator in module.mutators.items():
        if int(attr_id) in values:
            mutator.value = values[int(attr_id)]
    return module


def mutation_payload(module: Any, reference: int | None = None) -> dict[str, Any] | None:
    if not getattr(module, "isMutated", False):
        return None

    attributes: dict[str, float] = {}
    attribute_ids: dict[str, float] = {}
    details: list[dict[str, Any]] = []
    for attr_id, mutator in sorted(module.mutators.items(), key=lambda item: getattr(item[1].attribute, "name", str(item[0]))):
        attr = mutator.attribute
        value = safe_float(mutator.value) or 0.0
        attributes[attr.name] = value
        attribute_ids[str(int(attr_id))] = value
        details.append({
            "attributeId": int(attr_id),
            "attributeName": attr.name,
            "displayName": _display_name(attr),
            "value": value,
            "baseValue": _float_or_none(mutator.baseValue),
            "minValue": _float_or_none(mutator.minValue),
            "maxValue": _float_or_none(mutator.maxValue),
            "minModifier": _float_or_none(mutator.minMod),
            "maxModifier": _float_or_none(mutator.maxMod),
            "highIsGood": bool(getattr(attr, "highIsGood", False)),
            "unit": getattr(getattr(attr, "unit", None), "displayName", None),
        })

    base_item = module.baseItem
    mutaplasmid = module.mutaplasmid
    return {
        "reference": reference,
        "baseTypeId": int(base_item.ID),
        "baseTypeName": base_item.typeName,
        "mutaplasmidTypeId": int(mutaplasmid.ID),
        "mutaplasmidName": mutaplasmid.item.typeName,
        "prefix": mutaplasmid.shortName,
        "resultingTypeId": int(mutaplasmid.resultingItem.ID),
        "resultingTypeName": mutaplasmid.resultingItem.typeName,
        "displayName": f"Abyssal {base_item.typeName}",
        "pyfaFullName": module.fullName,
        "attributes": attributes,
        "attributeIds": attribute_ids,
        "attributeDetails": details,
    }
