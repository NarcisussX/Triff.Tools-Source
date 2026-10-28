from __future__ import annotations

import re
from typing import Any

from . import configure_pyfa


GRADE_ORDER = {
    "Low-grade": 10,
    "Mid-grade": 20,
    "High-grade": 30,
    "Standard": 40,
}

SET_SUFFIX_ORDER = {
    "Alpha": 1,
    "Beta": 2,
    "Gamma": 3,
    "Delta": 4,
    "Epsilon": 5,
    "Omega": 6,
}

SET_SLOT_NAMES = set(SET_SUFFIX_ORDER)

BOOSTER_ORDER = {
    "Synth": 10,
    "Standard": 20,
    "Improved": 30,
    "Strong": 40,
    "Agency": 50,
    "Other": 90,
}

MODULE_META_ORDER = {
    "Tech I": 10,
    "": 10,
    None: 10,
    "Tech II": 20,
    "Storyline": 30,
    "Faction": 40,
    "Deadspace": 50,
    "Officer": 60,
}


def _published(item: Any) -> bool:
    return bool(getattr(item, "published", True))


def implant_slot(item: Any) -> int | None:
    try:
        from eos.saveddata.implant import Implant

        return int(Implant(item).slot)
    except Exception:
        try:
            value = item.getAttribute("implantness")
            return int(value) if value is not None else None
        except Exception:
            return None


def booster_slot(item: Any) -> int | None:
    try:
        from eos.saveddata.booster import Booster

        return int(Booster(item).slot)
    except Exception:
        try:
            value = item.getAttribute("boosterness")
            return int(value) if value is not None else None
        except Exception:
            return None


def implant_set_attrs(item: Any) -> list[str]:
    attrs = []
    try:
        attrs = [name for name in item.attributes if name.startswith("implantSet") and "FAKE" not in name]
    except Exception:
        attrs = []
    return sorted(attrs)


def _market_group_name(item: Any) -> str | None:
    market_group = getattr(item, "marketGroup", None)
    return getattr(market_group, "name", None) if market_group is not None else None


def _group_name(item: Any) -> str | None:
    group = getattr(item, "group", None)
    return getattr(group, "name", None) if group is not None else None


def _category_name(item: Any) -> str | None:
    category = getattr(item, "category", None)
    return getattr(category, "name", None) if category is not None else None


def _meta_group_name(item: Any) -> str | None:
    meta_group = getattr(item, "metaGroup", None)
    return getattr(meta_group, "name", None) if meta_group is not None else None


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def _implant_name_parts(name: str) -> dict[str, Any] | None:
    match = re.match(r"^(Low-grade|Mid-grade|High-grade)\s+(.+?)\s+(Alpha|Beta|Gamma|Delta|Epsilon|Omega)$", name)
    if match:
        return {
            "family": match.group(2),
            "grade": match.group(1),
            "suffix": match.group(3),
            "familyKey": _slug(match.group(2)),
        }

    genolution = re.match(r"^(Genolution)\s+Core Augmentation\s+CA-\d+$", name)
    if genolution:
        return {
            "family": "Genolution",
            "grade": "Standard",
            "suffix": None,
            "familyKey": "genolution",
        }

    hardwiring = re.match(r"^(.+?)\s+([A-Z]{1,4})-\d{3,4}$", name)
    if hardwiring:
        family = hardwiring.group(1).strip()
        return {
            "family": family,
            "grade": hardwiring.group(2),
            "suffix": None,
            "familyKey": _slug(family),
        }

    return None


def _booster_name_parts(name: str) -> dict[str, Any] | None:
    quoted = re.search(r"'([^']+)'", name)
    if quoted:
        family = quoted.group(1)
        grade = "Agency" if name.startswith("Agency ") else "Other"
        return {"family": family, "grade": grade, "familyKey": _slug(family)}

    match = re.match(r"^(Synth|Standard|Improved|Strong)\s+(.+?)\s+Booster$", name)
    if match:
        return {
            "family": match.group(2),
            "grade": match.group(1),
            "familyKey": _slug(match.group(2)),
        }

    match = re.match(r"^AIR\s+(.+?)\s+Booster\s+[IVX]+$", name)
    if match:
        return {"family": match.group(1), "grade": "Other", "familyKey": _slug(match.group(1))}

    return None


def _item_payload(item: Any, kind: str, *, variant_group: str | None = None) -> dict[str, Any]:
    payload = {
        "typeId": int(item.ID),
        "typeName": item.typeName,
        "groupId": int(item.groupID) if item.groupID is not None else None,
        "groupName": _group_name(item),
        "categoryName": _category_name(item),
        "marketGroupId": int(item.marketGroupID) if getattr(item, "marketGroupID", None) is not None else None,
        "marketGroupName": _market_group_name(item),
        "pyfaKind": kind,
        "variantGroup": variant_group,
    }
    if kind == "implant":
        payload["implantSlot"] = implant_slot(item)
    elif kind == "booster":
        payload["boosterSlot"] = booster_slot(item)
    elif kind == "module":
        payload["metaGroupName"] = _meta_group_name(item)
        parent = getattr(item, "variationParentTypeID", None)
        payload["parentTypeId"] = int(parent) if parent is not None else None
    return payload


def _all_implants() -> list[Any]:
    configure_pyfa()
    import eos.db

    return [item for item in eos.db.getItemsByCategory("Implant") if _published(item)]


def _is_implant(item: Any) -> bool:
    return implant_slot(item) is not None


def _is_booster(item: Any) -> bool:
    return booster_slot(item) is not None


def _variant_sort_key(row: dict[str, Any]) -> tuple[Any, ...]:
    group = str(row.get("variantGroup") or "")
    group_order = BOOSTER_ORDER.get(group, 90) if row.get("pyfaKind") == "booster" else GRADE_ORDER.get(group, 80)
    return (
        group_order,
        SET_SUFFIX_ORDER.get(str(row.get("setSlotName") or ""), 99),
        int(row.get("implantSlot") or row.get("boosterSlot") or 0),
        str(row.get("typeName") or ""),
    )


def _module_variant_sort_key(row: dict[str, Any]) -> tuple[Any, ...]:
    name = str(row.get("typeName") or "")
    deadspace = re.search(r"\b([CBAX])-Type\b", name)
    deadspace_order = {"C": 0, "B": 1, "A": 2, "X": 3}.get(deadspace.group(1).upper(), 99) if deadspace else 99
    return (
        MODULE_META_ORDER.get(row.get("metaGroupName"), 90),
        deadspace_order,
        name,
    )


def _module_name_tokens(name: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", name.lower()))


def _abyssal_placeholder_signature(item: Any) -> set[str]:
    return {token for token in _module_name_tokens(getattr(item, "typeName", "")) if token != "abyssal"}


def _matches_abyssal_placeholder_signature(target_tokens: set[str], item: Any) -> bool:
    if not target_tokens:
        return True
    candidate_tokens = _module_name_tokens(getattr(item, "typeName", ""))
    return target_tokens.issubset(candidate_tokens)


def abyssal_placeholder_variants(type_id: int) -> dict[str, Any]:
    configure_pyfa()
    import eos.db
    from eos.saveddata.module import Module

    target = eos.db.getItem(int(type_id), eager=("group.category", "attributes"))
    if target is None:
        return {"ok": False, "variants": [], "errors": [{"code": "unknown_type", "message": f"TypeID {type_id} was not found."}]}
    if not getattr(target, "isAbyssal", False) or not getattr(target, "isModule", False):
        return {"ok": True, "variants": [], "errors": []}

    target_tokens = _abyssal_placeholder_signature(target)
    candidates = []
    for item in getattr(getattr(target, "group", None), "items", []) or []:
        if int(getattr(item, "ID", 0) or 0) == int(target.ID):
            continue
        if getattr(item, "isAbyssal", False):
            continue
        if not getattr(item, "published", True):
            continue
        try:
            Module(item)
        except Exception:
            continue
        row = _item_payload(item, "module", variant_group=_meta_group_name(item) or "Tech I")
        candidates.append((item, row))

    filtered = [row for item, row in candidates if _matches_abyssal_placeholder_signature(target_tokens, item)]
    rows = filtered or [row for _item, row in candidates]

    rows.sort(key=_module_variant_sort_key)
    return {"ok": True, "variants": rows, "errors": []}


def fitting_variants(type_id: int) -> dict[str, Any]:
    abyssal = abyssal_placeholder_variants(type_id)
    if abyssal.get("variants") or abyssal.get("errors"):
        return abyssal
    return implant_or_booster_variants(type_id)


def implant_or_booster_variants(type_id: int) -> dict[str, Any]:
    configure_pyfa()
    import eos.db

    target = eos.db.getItem(int(type_id), eager=("group.category", "attributes"))
    if target is None:
        return {"ok": False, "variants": [], "errors": [{"code": "unknown_type", "message": f"TypeID {type_id} was not found."}]}

    if _is_implant(target):
        slot = implant_slot(target)
        parts = _implant_name_parts(target.typeName)
        if not parts:
            return {"ok": True, "variants": [_item_payload(target, "implant")], "errors": []}

        target_set_attrs = set(implant_set_attrs(target))
        rows = []
        for item in _all_implants():
            if not _is_implant(item) or implant_slot(item) != slot:
                continue
            candidate_parts = _implant_name_parts(item.typeName)
            if not candidate_parts:
                continue
            same_set = bool(target_set_attrs and target_set_attrs.intersection(implant_set_attrs(item)))
            same_family = candidate_parts.get("familyKey") == parts.get("familyKey")
            if same_set or same_family:
                row = _item_payload(item, "implant", variant_group=candidate_parts.get("grade"))
                row["implantFamily"] = candidate_parts.get("family")
                row["setSlotName"] = candidate_parts.get("suffix")
                rows.append(row)
        rows.sort(key=_variant_sort_key)
        return {"ok": True, "variants": rows or [_item_payload(target, "implant")], "errors": []}

    if _is_booster(target):
        slot = booster_slot(target)
        parts = _booster_name_parts(target.typeName)
        if not parts:
            return {"ok": True, "variants": [_item_payload(target, "booster")], "errors": []}

        rows = []
        for item in _all_implants():
            if not _is_booster(item) or booster_slot(item) != slot:
                continue
            candidate_parts = _booster_name_parts(item.typeName)
            if not candidate_parts:
                continue
            if candidate_parts.get("familyKey") == parts.get("familyKey"):
                row = _item_payload(item, "booster", variant_group=candidate_parts.get("grade"))
                row["boosterFamily"] = candidate_parts.get("family")
                rows.append(row)
        rows.sort(key=_variant_sort_key)
        return {"ok": True, "variants": rows or [_item_payload(target, "booster")], "errors": []}

    return {"ok": True, "variants": [], "errors": []}


def implant_sets() -> dict[str, Any]:
    families: dict[str, dict[str, Any]] = {}
    for item in _all_implants():
        slot = implant_slot(item)
        if slot is None or slot > 10:
            continue
        parts = _implant_name_parts(item.typeName)
        if not parts:
            continue
        has_set_attrs = bool(implant_set_attrs(item))
        is_named_set_piece = (
            parts.get("suffix") in SET_SLOT_NAMES
            and parts.get("grade") in ("Low-grade", "Mid-grade", "High-grade")
            and 1 <= slot <= 6
        )
        if not has_set_attrs and not is_named_set_piece:
            continue
        family = parts["family"]
        family_key = parts["familyKey"]
        grade = parts["grade"]
        set_row = families.setdefault(family_key, {
            "key": family_key,
            "label": family,
            "grades": {},
        })
        grade_row = set_row["grades"].setdefault(_slug(grade), {
            "key": _slug(grade),
            "label": grade,
            "items": [],
        })
        grade_row["items"].append({
            "typeId": int(item.ID),
            "typeName": item.typeName,
            "slot": slot,
            "setSlotName": parts.get("suffix"),
        })

    output = []
    for family in families.values():
        grades = []
        for grade in family["grades"].values():
            grade["items"].sort(key=lambda row: (int(row["slot"]), SET_SUFFIX_ORDER.get(str(row.get("setSlotName") or ""), 99), row["typeName"]))
            grades.append(grade)
        grades.sort(key=lambda row: (GRADE_ORDER.get(row["label"], 80), row["label"]))
        output.append({
            "key": family["key"],
            "label": family["label"],
            "grades": grades,
        })
    output.sort(key=lambda row: row["label"])
    return {"ok": True, "sets": output, "source": "pyfa/eos item attributes"}
