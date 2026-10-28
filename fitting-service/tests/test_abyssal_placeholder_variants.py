from __future__ import annotations

import re

from pyfa_adapter import configure_pyfa
from pyfa_adapter.implants import fitting_variants


def _type_id(name: str) -> int:
    configure_pyfa()
    import eos.db

    item = eos.db.getItem(name)
    assert item is not None, name
    return int(item.ID)


def _variant_names(name: str) -> list[str]:
    result = fitting_variants(_type_id(name))
    assert result["ok"] is True, result.get("errors")
    return [row["typeName"] for row in result["variants"]]


def _tokens(name: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", name.lower()))


def _assert_all_include(names: list[str], *tokens: str) -> None:
    assert names
    wanted = {token.lower() for token in tokens}
    for name in names:
        assert wanted.issubset(_tokens(name)), name


def _assert_none_include(names: list[str], *tokens: str) -> None:
    unwanted = {token.lower() for token in tokens}
    for name in names:
        assert unwanted.isdisjoint(_tokens(name)), name


def test_large_abyssal_shield_extender_variants_stay_large_shield_extenders() -> None:
    names = _variant_names("Large Abyssal Shield Extender")

    _assert_all_include(names, "large", "shield", "extender")
    _assert_none_include(names, "small", "medium")


def test_100mn_abyssal_afterburner_variants_stay_100mn_afterburners() -> None:
    names = _variant_names("100MN Abyssal Afterburner")

    _assert_all_include(names, "100mn", "afterburner")
    _assert_none_include(names, "1mn", "5mn", "10mn", "50mn", "500mn", "10000mn", "microwarpdrive")


def test_50mn_abyssal_microwarpdrive_variants_stay_50mn_microwarpdrives() -> None:
    names = _variant_names("50MN Abyssal Microwarpdrive")

    _assert_all_include(names, "50mn", "microwarpdrive")
    _assert_none_include(names, "1mn", "5mn", "10mn", "100mn", "500mn", "10000mn", "afterburner")


def test_small_abyssal_armor_repairer_variants_stay_small_armor_repairers() -> None:
    names = _variant_names("Small Abyssal Armor Repairer")

    _assert_all_include(names, "small", "armor", "repairer")
    _assert_none_include(names, "medium", "large")


def test_small_abyssal_energy_neutralizer_variants_stay_small_neuts() -> None:
    names = _variant_names("Small Abyssal Energy Neutralizer")

    _assert_all_include(names, "small", "energy", "neutralizer")
    _assert_none_include(names, "medium", "heavy", "nosferatu")


def test_small_abyssal_energy_nosferatu_variants_stay_small_nos() -> None:
    names = _variant_names("Small Abyssal Energy Nosferatu")

    _assert_all_include(names, "small", "energy", "nosferatu")
    _assert_none_include(names, "medium", "heavy", "neutralizer")
