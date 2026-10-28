from __future__ import annotations

from pyfa_adapter.calculator import calculate
from pyfa_adapter.environment import environment_effect_tree


def _find_leaf(nodes, predicate):
    for node in nodes:
        if predicate(node):
            return node
        found = _find_leaf(node.get("children") or [], predicate)
        if found:
            return found
    return None


def _rifter_payload(projected_effects=None):
    return {
        "shipTypeId": 587,
        "fitName": "Environment Probe",
        "characterMode": "all_v",
        "modules": {"high": [], "mid": [], "low": [], "rig": [], "subsystem": []},
        "drones": [],
        "fighters": [],
        "cargo": [],
        "implants": [],
        "boosters": [],
        "projectedEffects": projected_effects or [],
        "environment": {"wormholeEffect": None, "abyssalWeather": None},
    }


def test_environment_tree_has_pyfa_top_level_categories() -> None:
    tree = environment_effect_tree()
    assert tree["ok"] is True
    labels = [category["label"] for category in tree["categories"]]
    assert labels == [
        "Metaliminal Storm",
        "Wormhole",
        "Abyssal Weather",
        "Sansha Incursion",
        "Drifter Incursion",
        "Triglavian Invasion",
        "Pirate Insurgency",
        "iHub Upgrades",
    ]


def test_wormhole_tree_has_all_families_and_classes() -> None:
    tree = environment_effect_tree()
    wormhole = next(category for category in tree["categories"] if category["key"] == "wormhole")
    families = {child["label"]: child for child in wormhole["children"]}
    assert set(families) == {"Red Giant", "Magnetar", "Pulsar", "Cataclysmic Variable", "Black Hole", "Wolf Rayet"}
    for family in families.values():
        assert [child["label"] for child in family["children"]] == [f"Class {index}" for index in range(1, 7)]
        assert all(child.get("typeId") for child in family["children"])


def test_wormhole_effect_changes_and_removes_stats_through_eos() -> None:
    tree = environment_effect_tree()
    pulsar_c5 = _find_leaf(tree["categories"], lambda node: node.get("category") == "wormhole" and node.get("label") == "Class 5" and "pulsar" in node.get("key", ""))
    assert pulsar_c5 is not None

    baseline = calculate(_rifter_payload())
    with_effect = calculate(_rifter_payload([{
        "kind": "environment",
        "effectId": pulsar_c5["effectId"],
        "typeId": pulsar_c5["typeId"],
        "category": "wormhole",
        "categoryLabel": "Wormhole",
        "label": "Pulsar Class 5",
    }]))
    removed = calculate(_rifter_payload([]))

    assert baseline["ok"] is True
    assert with_effect["ok"] is True
    assert removed["ok"] is True
    assert with_effect["stats"]["defense"]["rawHp"]["shield"] != baseline["stats"]["defense"]["rawHp"]["shield"]
    assert removed["stats"]["defense"]["rawHp"]["shield"] == baseline["stats"]["defense"]["rawHp"]["shield"]


def test_non_wormhole_environment_effect_changes_stats_when_supported() -> None:
    tree = environment_effect_tree()
    electrical = _find_leaf(tree["categories"], lambda node: node.get("category") == "metaliminal_storm" and "Electrical" in node.get("typeName", ""))
    assert electrical is not None

    baseline = calculate(_rifter_payload())
    with_effect = calculate(_rifter_payload([{
        "kind": "environment",
        "effectId": electrical["effectId"],
        "typeId": electrical["typeId"],
        "category": "metaliminal_storm",
        "categoryLabel": "Metaliminal Storm",
        "label": electrical["label"],
    }]))

    assert baseline["ok"] is True
    assert with_effect["ok"] is True
    assert with_effect["stats"]["capacitor"] != baseline["stats"]["capacitor"]
