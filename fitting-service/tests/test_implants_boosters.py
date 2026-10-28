from __future__ import annotations

from pyfa_adapter.calculator import calculate
from pyfa_adapter.implants import implant_or_booster_variants, implant_sets
from pyfa_adapter.serializers import classify_type


RIFTER = 587
HIGH_GRADE_CRYSTAL_ALPHA = 20121
HIGH_GRADE_CRYSTAL_OMEGA = 20161
MID_GRADE_CRYSTAL_ALPHA = 22107
LOW_GRADE_CRYSTAL_ALPHA = 33923
RAPID_LAUNCH_HARDWIRING = 24638
STANDARD_BLUE_PILL = 9950
IMPROVED_BLUE_PILL = 10155


def _payload(**overrides: object) -> dict:
    base = {
        "shipTypeId": RIFTER,
        "fitName": "Implants Test",
        "characterMode": "all_v",
        "modules": {"high": [], "mid": [], "low": [], "rig": [], "subsystem": []},
        "drones": [],
        "fighters": [],
        "cargo": [],
        "implants": [],
        "boosters": [],
        "projectedEffects": [],
    }
    base.update(overrides)
    return base


def test_implant_and_booster_slot_lookup_uses_pyfa_eos_slots() -> None:
    assert classify_type(HIGH_GRADE_CRYSTAL_ALPHA)["implantSlot"] == 1
    assert classify_type(HIGH_GRADE_CRYSTAL_OMEGA)["implantSlot"] == 6
    assert classify_type(RAPID_LAUNCH_HARDWIRING)["implantSlot"] == 10
    assert classify_type(IMPROVED_BLUE_PILL)["boosterSlot"] == 1


def test_calculation_payload_serializes_implants_and_boosters_with_slots() -> None:
    result = calculate(_payload(
        implants=[{"typeId": HIGH_GRADE_CRYSTAL_ALPHA}],
        boosters=[{"typeId": IMPROVED_BLUE_PILL}],
    ))

    assert result["ok"] is True, result.get("errors")
    assert result["payload"]["implants"][0]["slot"] == 1
    assert result["payload"]["implants"][0]["implantSlot"] == 1
    assert result["payload"]["boosters"][0]["slot"] == 1
    assert result["payload"]["boosters"][0]["boosterSlot"] == 1


def test_duplicate_implant_slots_are_rejected() -> None:
    result = calculate(_payload(implants=[
        {"typeId": HIGH_GRADE_CRYSTAL_ALPHA},
        {"typeId": LOW_GRADE_CRYSTAL_ALPHA},
    ]))

    assert result["ok"] is False
    assert result["errors"][0]["code"] == "DUPLICATE_IMPLANT_SLOT"
    assert result["errors"][0]["details"]["slot"] == 1


def test_duplicate_booster_slots_are_rejected() -> None:
    result = calculate(_payload(boosters=[
        {"typeId": STANDARD_BLUE_PILL},
        {"typeId": IMPROVED_BLUE_PILL},
    ]))

    assert result["ok"] is False
    assert result["errors"][0]["code"] == "DUPLICATE_BOOSTER_SLOT"
    assert result["errors"][0]["details"]["slot"] == 1


def test_disabled_implants_and_boosters_do_not_occupy_slots() -> None:
    result = calculate(_payload(
        implants=[
            {"typeId": HIGH_GRADE_CRYSTAL_ALPHA, "enabled": False},
            {"typeId": LOW_GRADE_CRYSTAL_ALPHA},
        ],
        boosters=[
            {"typeId": STANDARD_BLUE_PILL, "enabled": False},
            {"typeId": IMPROVED_BLUE_PILL},
        ],
    ))

    assert result["ok"] is True, result.get("errors")
    assert [row["typeId"] for row in result["payload"]["implants"]] == [LOW_GRADE_CRYSTAL_ALPHA]
    assert [row["typeId"] for row in result["payload"]["boosters"]] == [IMPROVED_BLUE_PILL]


def test_implant_variants_are_limited_to_related_same_slot_family() -> None:
    variants = implant_or_booster_variants(HIGH_GRADE_CRYSTAL_ALPHA)["variants"]
    names = {row["typeName"] for row in variants}
    slots = {row["implantSlot"] for row in variants}

    assert LOW_GRADE_CRYSTAL_ALPHA in {row["typeId"] for row in variants}
    assert MID_GRADE_CRYSTAL_ALPHA in {row["typeId"] for row in variants}
    assert HIGH_GRADE_CRYSTAL_ALPHA in {row["typeId"] for row in variants}
    assert names.issuperset({"Low-grade Crystal Alpha", "Mid-grade Crystal Alpha", "High-grade Crystal Alpha"})
    assert slots == {1}


def test_booster_variants_are_limited_to_related_same_slot_family() -> None:
    variants = implant_or_booster_variants(IMPROVED_BLUE_PILL)["variants"]
    names = {row["typeName"] for row in variants}
    slots = {row["boosterSlot"] for row in variants}

    assert {"Standard Blue Pill Booster", "Improved Blue Pill Booster"}.issubset(names)
    assert slots == {1}
    assert [row["variantGroup"] for row in variants] == ["Synth", "Standard", "Improved", "Strong"]


def test_implant_sets_include_crystal_grade_slots_one_through_six() -> None:
    sets = implant_sets()["sets"]
    crystal = next(row for row in sets if row["label"] == "Crystal")
    high_grade = next(row for row in crystal["grades"] if row["label"] == "High-grade")

    assert {item["slot"] for item in high_grade["items"]} == {1, 2, 3, 4, 5, 6}
    assert high_grade["items"][0]["typeName"] == "High-grade Crystal Alpha"


def test_implant_sets_include_named_sets_without_set_attributes() -> None:
    sets = implant_sets()["sets"]
    families = {row["label"]: row for row in sets}

    for family_name in ("Mimesis", "Nirvana", "Rapture"):
        family = families[family_name]
        assert {grade["label"] for grade in family["grades"]} == {"Low-grade", "Mid-grade", "High-grade"}
        for grade in family["grades"]:
            assert {item["slot"] for item in grade["items"]} == {1, 2, 3, 4, 5, 6}
