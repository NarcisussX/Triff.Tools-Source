from __future__ import annotations

import re
from typing import Any

from . import configure_pyfa


TOP_LEVEL_ORDER = [
    ("metaliminal_storm", "Metaliminal Storm"),
    ("wormhole", "Wormhole"),
    ("abyssal_weather", "Abyssal Weather"),
    ("sansha_incursion", "Sansha Incursion"),
    ("drifter_incursion", "Drifter Incursion"),
    ("triglavian_invasion", "Triglavian Invasion"),
    ("pirate_insurgency", "Pirate Insurgency"),
    ("ihub_upgrades", "iHub Upgrades"),
]

WORMHOLE_ORDER = ["Red Giant", "Magnetar", "Pulsar", "Cataclysmic Variable", "Black Hole", "Wolf Rayet"]
STORM_ORDER = ["Electrical", "Exotic", "Gamma", "Plasma"]

ABYSSAL_WEATHER_ENVIRONMENT_IDS = {
    "caustic_toxin_weather": 47862,
    "darkness_weather": 47863,
    "infernal_weather": 47864,
    "electric_storm_weather": 47865,
    "xenon_gas_weather": 47866,
}


def _slug(value: str) -> str:
    return re.sub(r"(^_+|_+$)", "", re.sub(r"[^a-z0-9]+", "_", value.lower()))


def _node(key: str, label: str, children: list[dict[str, Any]] | None = None, item: Any | None = None, category: str | None = None) -> dict[str, Any]:
    node = {
        "key": key,
        "label": label,
        "children": children or [],
        "disabled": False,
        "source": "pyfa/eos",
    }
    if item is not None:
        node.update({
            "effectId": str(int(item.ID)),
            "typeId": int(item.ID),
            "typeName": item.typeName,
            "category": category,
        })
    return node


def _effect_beacons():
    configure_pyfa()
    import eos.db

    group = eos.db.getGroup("Effect Beacon")
    return list(getattr(group, "items", []) or [])


def _clean_effect_name(name: str, *garbage: str) -> str:
    cleaned = name
    for part in ("System Effects", "Effects", "Beacon", *garbage):
        cleaned = re.sub(re.escape(part), "", cleaned, flags=re.IGNORECASE)
    return re.sub(r"\s{2,}", " ", cleaned).strip()


def _items_matching(*needles: str) -> list[Any]:
    out = []
    for item in _effect_beacons():
        if not item.isType("projected"):
            continue
        if any(needle.lower() in item.name.lower() for needle in needles):
            out.append(item)
    return out


def _leaf_from_item(item: Any, label: str, category: str, key_prefix: str = "") -> dict[str, Any]:
    key = f"{key_prefix}_{item.ID}" if key_prefix else str(item.ID)
    return _node(_slug(key), label, item=item, category=category)


def _wormholes() -> dict[str, Any]:
    groups = []
    for family in WORMHOLE_ORDER:
        leaves = []
        for class_num in range(1, 7):
            expected = f"Class {class_num} {family}"
            item = next((candidate for candidate in _effect_beacons() if candidate.isType("projected") and expected.lower() in candidate.name.lower()), None)
            if item is not None:
                leaves.append(_leaf_from_item(item, f"Class {class_num}", "wormhole", f"wormhole_{_slug(family)}_c{class_num}"))
        groups.append(_node(_slug(family), family, leaves))
    return _node("wormhole", "Wormhole", groups)


def _metaliminal_storms() -> dict[str, Any]:
    groups = []
    for family in STORM_ORDER:
        items = _items_matching(f"Metaliminal {family}", f"{family} Matter", f"{family} Ray", f"{family} Firestorm")
        leaves = [
            _leaf_from_item(item, _clean_effect_name(item.name, "Metaliminal", "Storm", "Matter", "Ray", "Firestorm", family), "metaliminal_storm", f"metaliminal_{family}")
            for item in sorted(items, key=lambda entry: entry.name)
        ]
        if leaves:
            groups.append(_node(_slug(family), family, leaves))
    return _node("metaliminal_storm", "Metaliminal Storm", groups)


def _abyssal_weather() -> dict[str, Any]:
    configure_pyfa()
    import eos.db

    data: list[dict[str, Any]] = []
    environments = {
        int(item.ID): item
        for item in getattr(eos.db.getGroup("Abyssal Environment"), "items", []) or []
    }
    weather_items = list(getattr(eos.db.getGroup("MassiveEnvironments"), "items", []) or [])
    weather_items += list(getattr(eos.db.getGroup("Non-Interactable Object"), "items", []) or [])
    by_environment: dict[str, list[dict[str, Any]]] = {}
    for item in weather_items:
        if not item.isType("projected"):
            continue
        stem = item.name[:-2]
        environment = environments.get(ABYSSAL_WEATHER_ENVIRONMENT_IDS.get(stem, 0))
        if environment is None:
            continue
        label = f"{environment.name} {item.name[-1:]}"
        by_environment.setdefault(environment.name, []).append(_leaf_from_item(item, label, "abyssal_weather", f"abyssal_{environment.ID}"))

    for label in sorted(by_environment):
        data.append(_node(_slug(label), label, sorted(by_environment[label], key=lambda entry: entry["label"])))

    localized_groups: dict[str, list[dict[str, Any]]] = {}
    for item in getattr(eos.db.getGroup("Abyssal Hazards"), "items", []) or []:
        if not item.isType("projected"):
            continue
        custom_name = getattr(item, "customName", item.name)
        for label in ("Bioluminescence", "Tachyon", "Filament"):
            if label.lower() in custom_name.lower():
                localized_groups.setdefault(label, []).append(_leaf_from_item(item, custom_name, "abyssal_weather", f"abyssal_localized_{label}"))
                break
    if localized_groups:
        data.append(_node("localized", "Localized", [
            _node(_slug(label), label, sorted(items, key=lambda entry: entry["label"]))
            for label, items in sorted(localized_groups.items())
        ]))

    return _node("abyssal_weather", "Abyssal Weather", data)


def _simple_group(key: str, label: str, needle: str, category: str, extra_items: list[int] | None = None) -> dict[str, Any]:
    configure_pyfa()
    import eos.db

    items = _items_matching(needle)
    for type_id in extra_items or []:
        item = eos.db.getItem(type_id, eager=("group.category", "effects", "attributes"))
        if item is not None:
            items.append(item)
    leaves = [
        _leaf_from_item(item, _clean_effect_name(item.name, needle), category, key)
        for item in sorted({int(item.ID): item for item in items}.values(), key=lambda entry: entry.name)
    ]
    return _node(key, label, leaves)


def _triglavian_invasion() -> dict[str, Any]:
    configure_pyfa()
    import eos.db

    leaves = []
    for type_id in (87177, 87164, 74002):
        item = eos.db.getItem(type_id, eager=("group.category", "effects", "attributes"))
        if item is not None:
            leaves.append(_leaf_from_item(item, item.name, "triglavian_invasion", "triglavian"))
    return _node("triglavian_invasion", "Triglavian Invasion", leaves)


def _ihub_upgrades() -> dict[str, Any]:
    configure_pyfa()
    import eos.db

    labels = [(87950, "Electric"), (87949, "Plasma"), (87951, "Exotic"), (87815, "Gamma")]
    leaves = []
    for type_id, label in labels:
        item = eos.db.getItem(type_id, eager=("group.category", "effects", "attributes"))
        if item is not None:
            leaves.append(_leaf_from_item(item, label, "ihub_upgrades", "ihub"))
    return _node("ihub_upgrades", "iHub Upgrades", leaves)


def environment_effect_tree() -> dict[str, Any]:
    configure_pyfa()
    categories = [
        _metaliminal_storms(),
        _wormholes(),
        _abyssal_weather(),
        _simple_group("sansha_incursion", "Sansha Incursion", "Sansha Incursion", "sansha_incursion"),
        _simple_group("drifter_incursion", "Drifter Incursion", "Drifter Incursion", "drifter_incursion", extra_items=[87294]),
        _triglavian_invasion(),
        _simple_group("pirate_insurgency", "Pirate Insurgency", "Insurgency", "pirate_insurgency"),
        _ihub_upgrades(),
    ]
    by_key = {category["key"]: category for category in categories}
    ordered = [by_key[key] for key, _label in TOP_LEVEL_ORDER if key in by_key]
    return {"ok": True, "categories": ordered, "errors": []}
