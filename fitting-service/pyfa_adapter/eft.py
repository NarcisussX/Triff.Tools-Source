from __future__ import annotations

import re
from typing import Any

from . import configure_pyfa
from .calculator import calculate
from .serializers import MODULE_SLOTS, SLOT_BY_VALUE, classify_type

HEADER_RE = re.compile(r"^\[\s*(?P<ship>[^,\]]+)\s*,\s*(?P<name>[^\]]+)\s*\]$")
QTY_RE = re.compile(r"^(?P<name>.+?)\s+x(?P<qty>\d+)$", re.IGNORECASE)
MUTATION_REF_RE = re.compile(r"\s+\[(?P<ref>\d+)\]\s*$")
MUTATION_BLOCK_HEADER_RE = re.compile(r"^\[(?P<ref>\d+)\]\s*(?P<base>.+)$")
OFFLINE_RE = re.compile(r"\s+/offline\s*$", re.IGNORECASE)
ATTR_PAIR_RE = re.compile(r"^(?P<name>[A-Za-z0-9_]+)\s+(?P<value>[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)$")


def _empty_payload() -> dict[str, Any]:
    return {
        "shipTypeId": None,
        "fitName": "",
        "characterMode": "all_v",
        "modules": {slot: [] for slot in MODULE_SLOTS},
        "drones": [],
        "fighters": [],
        "cargo": [],
        "implants": [],
        "boosters": [],
        "projectedEffects": [],
        "environment": {
            "wormholeEffect": None,
            "abyssalWeather": None,
        },
    }


def _resolve_item(name: str):
    configure_pyfa()
    import eos.db

    return eos.db.getItem(name.strip(), eager=("group.category", "effects", "attributes"))


def _module_hardpoint(mod: Any) -> tuple[str, str | None]:
    hardpoint = getattr(mod, "hardpoint", None)
    hardpoint_name = str(getattr(hardpoint, "name", hardpoint or "")).lower()
    if hardpoint_name == "turret":
        return "turret", "Turret"
    if hardpoint_name == "missile":
        return "launcher", "Launcher"
    return "none", None


def _abyssal_placeholder_info(item: Any) -> dict[str, Any] | None:
    if not getattr(item, "isAbyssal", False) or not getattr(item, "isModule", False):
        return None

    try:
        from eos.saveddata.module import Module
    except Exception:
        return None

    group = getattr(item, "group", None)
    for candidate in getattr(group, "items", []) or []:
        if int(getattr(candidate, "ID", 0) or 0) == int(item.ID):
            continue
        if getattr(candidate, "isAbyssal", False):
            continue
        if not getattr(candidate, "published", True):
            continue
        try:
            mod = Module(candidate)
        except Exception:
            continue
        slot_value = getattr(mod, "slot", None)
        slot = SLOT_BY_VALUE.get(int(slot_value)) if slot_value is not None else None
        if slot not in MODULE_SLOTS:
            continue
        hardpoint, hardpoint_name = _module_hardpoint(mod)
        return {
            "slot": slot,
            "hardpoint": hardpoint,
            "hardpointName": hardpoint_name,
            "groupName": getattr(group, "name", None),
        }
    return None


def _split_blocks(lines: list[str]) -> list[list[str]]:
    blocks: list[list[str]] = []
    current: list[str] = []
    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            if current:
                blocks.append(current)
                current = []
            continue
        current.append(line)
    if current:
        blocks.append(current)
    return blocks


def _item_name_from_line(line: str) -> tuple[str, str | None, int, int | None, bool, bool]:
    mutation_ref = None
    offline = False
    ref_match = MUTATION_REF_RE.search(line)
    if ref_match:
        mutation_ref = int(ref_match.group("ref"))
        line = MUTATION_REF_RE.sub("", line).strip()

    if OFFLINE_RE.search(line):
        offline = True
        line = OFFLINE_RE.sub("", line).strip()

    quantity = 1
    quantity_match = QTY_RE.match(line)
    if quantity_match:
        return quantity_match.group("name").strip(), None, int(quantity_match.group("qty")), mutation_ref, offline, True

    if "," in line:
        module_name, charge_name = [part.strip() for part in line.split(",", 1)]
        return module_name, charge_name, quantity, mutation_ref, offline, False

    return line.strip(), None, quantity, mutation_ref, offline, False


def _parse_mutation_attrs(line: str, warnings: list[dict[str, str]]) -> tuple[dict[str, float], dict[str, float], list[str]]:
    configure_pyfa()
    import eos.db

    attributes: dict[str, float] = {}
    attribute_ids: dict[str, float] = {}
    unknown: list[str] = []
    for part in [part.strip() for part in line.split(",") if part.strip()]:
        match = ATTR_PAIR_RE.match(part)
        if not match:
            unknown.append(part)
            continue
        name = match.group("name")
        value = float(match.group("value"))
        attr = eos.db.getAttributeInfo(name)
        if attr is None:
            unknown.append(name)
            continue
        attributes[attr.name] = value
        attribute_ids[str(int(attr.ID))] = value
    if unknown:
        warnings.append({"code": "unknown_mutation_attribute", "message": f"Could not map mutation attributes: {', '.join(unknown)}."})
    return attributes, attribute_ids, unknown


def _parse_mutation_block(reference: int, block: list[str], warnings: list[dict[str, str]]) -> dict[str, Any] | None:
    configure_pyfa()
    import eos.db

    if len(block) < 2:
        warnings.append({"code": "bad_mutation_block", "message": f"Mutation block [{reference}] is incomplete."})
        return None

    base_name = block[0].strip()
    mutaplasmid_name = block[1].strip()
    base_item = _resolve_item(base_name)
    mutaplasmid_item = _resolve_item(mutaplasmid_name)
    if base_item is None:
        warnings.append({"code": "unknown_mutation_base", "message": f"Could not find mutation base item '{base_name}'."})
        return None
    if mutaplasmid_item is None:
        warnings.append({"code": "unknown_mutaplasmid", "message": f"Could not find mutaplasmid '{mutaplasmid_name}'."})
        return None
    mutaplasmid = eos.db.getDynamicItem(int(mutaplasmid_item.ID))
    if mutaplasmid is None:
        warnings.append({"code": "not_mutaplasmid", "message": f"{mutaplasmid_item.typeName} is not a Pyfa mutaplasmid."})
        return None

    attr_line = ", ".join(block[2:]).strip()
    attributes, attribute_ids, unknown = _parse_mutation_attrs(attr_line, warnings) if attr_line else ({}, {}, [])
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
        "attributes": attributes,
        "attributeIds": attribute_ids,
        "unknownAttributes": unknown,
    }


def _extract_mutation_blocks(lines: list[str], warnings: list[dict[str, str]]) -> tuple[list[str], dict[int, dict[str, Any]]]:
    cleaned: list[str] = []
    mutations: dict[int, dict[str, Any]] = {}
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        header = MUTATION_BLOCK_HEADER_RE.match(line)
        if not header:
            cleaned.append(lines[index])
            index += 1
            continue

        reference = int(header.group("ref"))
        block = [header.group("base").strip()]
        index += 1
        while index < len(lines):
            next_line = lines[index].strip()
            if not next_line:
                index += 1
                break
            if MUTATION_BLOCK_HEADER_RE.match(next_line):
                break
            block.append(next_line)
            index += 1
        parsed = _parse_mutation_block(reference, block, warnings)
        if parsed:
            mutations[reference] = parsed
    return cleaned, mutations


def _is_empty_slot(line: str) -> bool:
    return line.startswith("[Empty ")


def _is_fit_block(block: list[str]) -> bool:
    found_module = False
    for line in block:
        if _is_empty_slot(line):
            continue
        module_name, _charge_name, quantity, _mutation_ref, _offline, _explicit_quantity = _item_name_from_line(line)
        if quantity != 1:
            return False
        item = _resolve_item(module_name)
        if item is None:
            return False
        placeholder = _abyssal_placeholder_info(item)
        if placeholder:
            found_module = True
            continue
        try:
            info = classify_type(int(item.ID))
        except Exception:
            return False
        if info.get("pyfaKind") != "module" or info.get("slot") not in MODULE_SLOTS:
            return False
        found_module = True
    return found_module


def _append_addition(payload: dict[str, Any], item: Any, info: dict[str, Any], quantity: int, explicit_quantity: bool) -> None:
    category = info.get("categoryName")
    kind = info.get("pyfaKind")
    entry = {"typeId": int(item.ID), "typeName": item.typeName, "quantity": quantity}

    if category == "Fighter" or kind == "fighter":
        payload["fighters"].append(entry)
    elif category == "Drone" or kind == "drone":
        payload["drones"].append(entry)
    elif kind == "implant":
        slot = info.get("implantSlot")
        occupied = slot is None or any(existing.get("slot") == slot or existing.get("implantSlot") == slot for existing in payload["implants"])
        if quantity == 1 and not explicit_quantity and not occupied:
            entry["slot"] = slot
            entry["implantSlot"] = slot
            payload["implants"].append(entry)
        else:
            payload["cargo"].append(entry)
    elif kind == "booster":
        slot = info.get("boosterSlot")
        occupied = slot is None or any(existing.get("slot") == slot or existing.get("boosterSlot") == slot for existing in payload["boosters"])
        if quantity == 1 and not explicit_quantity and not occupied:
            entry["slot"] = slot
            entry["boosterSlot"] = slot
            payload["boosters"].append(entry)
        else:
            payload["cargo"].append(entry)
    else:
        payload["cargo"].append(entry)


def import_eft(text: str, calculate_fit: bool = True) -> dict[str, Any]:
    configure_pyfa()
    payload = _empty_payload()
    warnings: list[dict[str, str]] = []

    lines = [line.strip() for line in str(text or "").splitlines()]
    while lines and not lines[0]:
        lines.pop(0)

    if not lines:
        return {
            "ok": False,
            "payload": payload,
            "warnings": [],
            "errors": [{"code": "empty_eft", "message": "Paste an EFT/Pyfa fit to import."}],
            "calculation": None,
        }

    header = HEADER_RE.match(lines[0])
    if not header:
        return {
            "ok": False,
            "payload": payload,
            "warnings": [],
            "errors": [{"code": "bad_header", "message": "The first line must look like [Ship, Fit Name]."}],
            "calculation": None,
        }

    lines, mutations = _extract_mutation_blocks(lines, warnings)
    header = HEADER_RE.match(lines[0])

    ship = _resolve_item(header.group("ship"))
    if ship is None:
        return {
            "ok": False,
            "payload": payload,
            "warnings": [],
            "errors": [{"code": "unknown_ship", "message": f"Could not find ship '{header.group('ship')}'."}],
            "calculation": None,
        }

    payload["shipTypeId"] = int(ship.ID)
    payload["shipTypeName"] = ship.typeName
    payload["fitName"] = header.group("name").strip()

    additions_started = False
    for block in _split_blocks(lines[1:]):
        is_fit_block = (not additions_started) and _is_fit_block(block)
        if not is_fit_block:
            additions_started = True

        for line in block:
            if _is_empty_slot(line):
                continue

            module_name, charge_name, quantity, mutation_ref, offline, explicit_quantity = _item_name_from_line(line)
            item = _resolve_item(module_name)
            if item is None:
                warnings.append({"code": "unknown_item", "message": f"Could not find '{module_name}'."})
                continue

            try:
                info = classify_type(int(item.ID))
            except Exception as exc:
                warnings.append({"code": "classify_failed", "message": f"{item.typeName}: {exc}"})
                continue
            placeholder = _abyssal_placeholder_info(item)

            if is_fit_block:
                slot = placeholder["slot"] if placeholder else info.get("slot")
                entry: dict[str, Any] = {"typeId": int(item.ID), "typeName": item.typeName}
                entry["id"] = f"eft-{slot}-{len(payload['modules'][slot]) + 1}"
                if offline:
                    entry["state"] = "offline"
                if placeholder:
                    entry["abyssalPlaceholder"] = True
                    entry["placeholderReason"] = "Imported from external EFT without base module, mutaplasmid, or mutated attributes."
                    entry["hardpoint"] = placeholder.get("hardpoint")
                    entry["hardpointName"] = placeholder.get("hardpointName")
                    entry["groupName"] = placeholder.get("groupName")
                if charge_name:
                    charge = _resolve_item(charge_name)
                    if charge is None:
                        warnings.append({"code": "unknown_charge", "message": f"Could not find charge '{charge_name}'."})
                    else:
                        entry["chargeTypeId"] = int(charge.ID)
                        entry["chargeTypeName"] = charge.typeName
                if mutation_ref is not None:
                    if placeholder:
                        warnings.append({"code": "placeholder_mutation_ignored", "message": f"{item.typeName} is already an unresolved abyssal placeholder; ignored mutation reference [{mutation_ref}]."})
                        payload["modules"][slot].append(entry)
                        continue
                    mutation = mutations.get(mutation_ref)
                    if mutation is None:
                        warnings.append({"code": "missing_mutation_block", "message": f"Module references mutation [{mutation_ref}], but no block was found."})
                    else:
                        if mutation.get("baseTypeId") != int(item.ID):
                            warnings.append({
                                "code": "mutation_base_mismatch",
                                "message": f"Mutation [{mutation_ref}] is for {mutation.get('baseTypeName')}, but was attached to {item.typeName}.",
                            })
                        entry["id"] = f"eft-mutation-{mutation_ref}"
                        entry["mutation"] = mutation
                payload["modules"][slot].append(entry)
            else:
                if charge_name:
                    warnings.append({"code": "ignored_cargo_charge", "message": f"Ignored cargo charge suffix on '{line}'."})
                _append_addition(payload, item, info, quantity, explicit_quantity)

    calculation = calculate(payload) if calculate_fit else None
    if calculation and not calculation.get("ok"):
        return {
            "ok": False,
            "payload": payload,
            "warnings": warnings + (calculation.get("warnings") or []),
            "errors": calculation.get("errors") or [],
            "calculation": calculation,
        }
    return {
        "ok": True,
        "payload": (calculation or {}).get("payload") or payload,
        "warnings": warnings + ((calculation or {}).get("warnings") or []),
        "errors": (calculation or {}).get("errors") or [],
        "calculation": calculation,
    }


def _format_mutation_value(value: Any) -> str:
    try:
        return f"{float(value):.10g}"
    except (TypeError, ValueError):
        return str(value)


def _mutation_export_block(reference: int, mutation: dict[str, Any], base_name: str) -> str:
    attributes = mutation.get("attributes") or {}
    attr_line = ", ".join(f"{name} {_format_mutation_value(attributes[name])}" for name in sorted(attributes))
    mutaplasmid_name = mutation.get("mutaplasmidName") or mutation.get("mutaplasmid_name") or "Unknown Mutaplasmid"
    return "\n".join([
        f"[{reference}] {mutation.get('baseTypeName') or base_name}",
        f"  {mutaplasmid_name}",
        f"  {attr_line}",
    ])


def export_eft(payload: dict[str, Any]) -> dict[str, Any]:
    configure_pyfa()
    import eos.db

    ship_id = payload.get("shipTypeId")
    if not ship_id:
        return {"ok": False, "text": "", "errors": [{"code": "missing_ship", "message": "Select a ship before exporting."}]}

    ship = eos.db.getItem(int(ship_id))
    if ship is None:
        return {"ok": False, "text": "", "errors": [{"code": "unknown_ship", "message": f"Ship typeID {ship_id} was not found."}]}

    fit_name = payload.get("fitName") or ship.typeName
    sections: list[str] = [f"[{ship.typeName}, {fit_name}]"]
    modules = payload.get("modules") or {}
    mutation_blocks: list[str] = []
    used_mutation_refs: set[int] = set()
    next_mutation_ref = 1

    def mutation_reference(raw_mutation: dict[str, Any]) -> int:
        nonlocal next_mutation_ref
        requested = raw_mutation.get("reference")
        try:
            requested_ref = int(requested)
        except (TypeError, ValueError):
            requested_ref = 0
        if requested_ref > 0 and requested_ref not in used_mutation_refs:
            used_mutation_refs.add(requested_ref)
            next_mutation_ref = max(next_mutation_ref, requested_ref + 1)
            return requested_ref
        while next_mutation_ref in used_mutation_refs:
            next_mutation_ref += 1
        ref = next_mutation_ref
        used_mutation_refs.add(ref)
        next_mutation_ref += 1
        return ref

    for slot in ("low", "mid", "high", "rig", "subsystem"):
        lines: list[str] = []
        for raw_module in modules.get(slot) or []:
            type_id = raw_module.get("typeId") or raw_module.get("type_id")
            if not type_id:
                continue
            item = eos.db.getItem(int(type_id))
            if item is None:
                continue
            line = item.typeName
            charge_id = raw_module.get("chargeTypeId") or raw_module.get("charge_type_id")
            if charge_id:
                charge = eos.db.getItem(int(charge_id))
                if charge is not None:
                    line = f"{line}, {charge.typeName}"
            mutation = raw_module.get("mutation")
            if mutation:
                ref = mutation_reference(mutation)
                line = f"{line} [{ref}]"
                mutation_blocks.append(_mutation_export_block(ref, mutation, item.typeName))
            lines.append(line)
        if lines:
            sections.append("\n".join(lines))

    drone_lines = []
    for raw_drone in payload.get("drones") or []:
        type_id = raw_drone.get("typeId") or raw_drone.get("type_id")
        if not type_id:
            continue
        item = eos.db.getItem(int(type_id))
        if item is not None:
            drone_lines.append(f"{item.typeName} x{int(raw_drone.get('quantity') or raw_drone.get('amount') or 1)}")
    if drone_lines:
        sections.append("\n".join(drone_lines))

    fighter_lines = []
    for raw_fighter in payload.get("fighters") or []:
        type_id = raw_fighter.get("typeId") or raw_fighter.get("type_id")
        if not type_id:
            continue
        item = eos.db.getItem(int(type_id))
        if item is not None:
            fighter_lines.append(f"{item.typeName} x{int(raw_fighter.get('quantity') or raw_fighter.get('amount') or 1)}")
    if fighter_lines:
        sections.append("\n".join(fighter_lines))

    for key in ("implants", "boosters"):
        lines = []
        for raw_item in payload.get(key) or []:
            if raw_item.get("enabled") is False:
                continue
            type_id = raw_item.get("typeId") or raw_item.get("type_id")
            if not type_id:
                continue
            item = eos.db.getItem(int(type_id))
            if item is not None:
                qty = int(raw_item.get("quantity") or raw_item.get("amount") or 1)
                lines.append(f"{item.typeName} x{qty}" if qty > 1 else item.typeName)
        if lines:
            sections.append("\n".join(lines))

    cargo_lines = []
    for raw_item in payload.get("cargo") or []:
        type_id = raw_item.get("typeId") or raw_item.get("type_id")
        if not type_id:
            continue
        item = eos.db.getItem(int(type_id))
        if item is not None:
            qty = int(raw_item.get("quantity") or raw_item.get("amount") or 1)
            cargo_lines.append(f"{item.typeName} x{qty}")
    if cargo_lines:
        sections.append("\n".join(cargo_lines))

    if mutation_blocks:
        sections.append("\n".join(mutation_blocks))

    return {"ok": True, "text": "\n\n".join(sections), "errors": []}
