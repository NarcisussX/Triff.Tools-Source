from __future__ import annotations

import pytest

from pyfa_adapter import configure_pyfa
from pyfa_adapter.calculator import calculate
from pyfa_adapter.eft import import_eft
from pyfa_adapter.serializers import _capacitor_stats
from tests.parity import IMPORTANT_DAMAGE_TYPES, fit_fixture_paths


class _FakeFit:
    capStable = False
    capState = 0.0
    capUsed = 0.0
    capRecharge = 0.0

    def __init__(self, cap_delta: float) -> None:
        self.capDelta = cap_delta


class _FakeShip:
    def __init__(self, neut_resonance: float) -> None:
        self.neut_resonance = neut_resonance

    def getModifiedItemAttr(self, name: str) -> float:
        return {
            "capacitorCapacity": 75000.0,
            "energyWarfareResistance": self.neut_resonance,
            "rechargeRate": 100000.0,
        }.get(name, 0.0)


def test_defense_recharge_and_price_shape_are_explicit() -> None:
    imported = import_eft(fit_fixture_paths()[0].read_text(encoding="utf-8"))
    assert imported["ok"] is True, imported.get("errors")
    stats = imported["calculation"]["stats"]

    defense = stats["defense"]
    for layer in ("shield", "armor", "hull"):
        assert layer in defense["rawHp"]
        assert layer in defense["ehp"]
        assert set(IMPORTANT_DAMAGE_TYPES).issubset(defense["resists"][layer])

    assert "total" in defense["rawHp"]
    assert "total" in defense["ehp"]

    recharge = stats["rechargeRates"]
    for key in ("passiveShield", "activeShield", "activeArmor", "activeHull", "total"):
        assert "stableEhpPerSecond" in recharge[key]
        assert "maxEhpPerSecond" in recharge[key]

    local_tank = stats["localTank"]
    for key in (
        "passiveShieldEhpPerSecond",
        "activeShieldEhpPerSecond",
        "activeArmorEhpPerSecond",
        "activeHullEhpPerSecond",
        "totalEhpPerSecond",
    ):
        assert key in local_tank["stable"]
        assert key in local_tank["max"]

    assert set(("shield", "armor", "hull", "capacitor")).issubset(stats["remoteReps"])
    assert set(("shieldHpPerSecond", "armorHpPerSecond", "hullHpPerSecond", "capacitorGjPerSecond")).issubset(stats["remoteReps"])

    capacitor = stats["capacitor"]
    for key in (
        "lastsSeconds",
        "stablePercent",
        "deltaGjPerSecond",
        "capacityGj",
        "neutralizerResistancePercent",
        "effectiveExcessGainGjPerSecond",
    ):
        assert key in capacitor

    assert "price" in stats
    assert stats["price"] is None


def test_hull_resist_display_uses_pyfa_structure_resonance_attrs() -> None:
    baseline = import_eft("[Rifter, Bare Hull]\n\n")
    hardened = import_eft("[Rifter, Hull Resist]\n\nDamage Control II\n")

    assert baseline["ok"] is True, baseline.get("errors")
    assert hardened["ok"] is True, hardened.get("errors")

    base_hull = baseline["calculation"]["stats"]["defense"]["resists"]["hull"]
    hardened_hull = hardened["calculation"]["stats"]["defense"]["resists"]["hull"]

    for damage_type in IMPORTANT_DAMAGE_TYPES:
        assert base_hull[damage_type] > 0.0
        assert hardened_hull[damage_type] > base_hull[damage_type]


def _type_id(name: str) -> int:
    configure_pyfa()
    import eos.db

    item = eos.db.getItem(name)
    assert item is not None, name
    return int(item.ID)


def test_mining_yield_stats_are_serialized_from_pyfa_fit_values() -> None:
    combat = import_eft("[Rifter, Bare Hull]\n\n")
    assert combat["ok"] is True, combat.get("errors")
    combat_mining = combat["calculation"]["stats"]["mining"]
    assert combat_mining["unit"] == "m3/s"
    assert combat_mining["totalYieldM3PerSecond"] == 0.0

    mining = calculate({
        "shipTypeId": _type_id("Venture"),
        "fitName": "Mining Probe",
        "modules": {
            "high": [
                {"typeId": _type_id("Miner I"), "state": "active"},
            ],
            "mid": [],
            "low": [],
            "rig": [],
            "subsystem": [],
        },
        "drones": [
            {"typeId": _type_id("Mining Drone I"), "quantity": 2, "active": 2},
        ],
        "fighters": [],
        "cargo": [],
        "implants": [],
        "boosters": [],
        "projectedEffects": [],
        "environment": {},
    })

    assert mining["ok"] is True, mining.get("errors")
    mining_stats = mining["stats"]["mining"]
    assert mining_stats["minerYieldM3PerSecond"] > 0
    assert mining_stats["droneYieldM3PerSecond"] > 0
    assert mining_stats["totalYieldM3PerSecond"] == pytest.approx(
        mining_stats["minerYieldM3PerSecond"] + mining_stats["droneYieldM3PerSecond"]
    )


def test_effective_excess_capacitor_gain_matches_pyfa_semantics() -> None:
    negative_delta = _capacitor_stats(_FakeFit(-361.72), _FakeShip(1.0))
    zero_neut_resist = _capacitor_stats(_FakeFit(206.0), _FakeShip(1.0))
    resisted_neut = _capacitor_stats(_FakeFit(206.0), _FakeShip(0.693))

    assert negative_delta["effectiveExcessGainGjPerSecond"] == 0.0
    assert zero_neut_resist["effectiveExcessGainGjPerSecond"] == pytest.approx(206.0)
    assert resisted_neut["neutralizerResistancePercent"] == pytest.approx(30.7)
    assert resisted_neut["effectiveExcessGainGjPerSecond"] == pytest.approx(206.0 / (1.0 - 0.307))


def _first_high_row(eft: str) -> dict:
    imported = import_eft(eft)
    assert imported["ok"] is True, imported.get("errors")
    row = imported["calculation"]["stats"]["moduleRows"]["high"][0]
    assert row["displayStats"]
    return row


def test_module_rows_are_charge_aware_for_turret_range_and_tracking() -> None:
    scorch = _first_high_row("[Omen, Scorch]\n\nFocused Medium Pulse Laser II, Scorch M\n")
    conflag = _first_high_row("[Omen, Conflag]\n\nFocused Medium Pulse Laser II, Conflagration M\n")

    assert scorch["chargeName"] == "Scorch M"
    assert conflag["chargeName"] == "Conflagration M"
    assert scorch["displayStats"]["range"]["value"] != conflag["displayStats"]["range"]["value"]
    assert scorch["displayStats"]["trackingOrApplication"]["tooltip"] == "Tracking"
    assert scorch["displayStats"]["trackingOrApplication"]["value"] != conflag["displayStats"]["trackingOrApplication"]["value"]


def test_module_rows_expose_missile_range_and_application() -> None:
    row = _first_high_row("[Caracal, Missiles]\n\nRapid Light Missile Launcher II, Scourge Fury Light Missile\n")

    assert row["displayStats"]["range"]["tooltip"] == "Missile range"
    assert "+" not in row["displayStats"]["range"]["value"]
    assert row["displayStats"]["trackingOrApplication"]["tooltip"] == "Explosion velocity / Explosion radius"
    assert "m/s" in row["displayStats"]["trackingOrApplication"]["value"]
    assert "/ " in row["displayStats"]["trackingOrApplication"]["value"]


def test_module_rows_expose_neut_range_and_rate() -> None:
    row = _first_high_row("[Tempest Fleet Issue, Neut]\n\nHeavy Energy Neutralizer II\n")

    assert row["displayStats"]["range"]["tooltip"] == "Optimal + falloff"
    assert "+" in row["displayStats"]["range"]["value"]
    assert row["displayStats"]["trackingOrApplication"]["tooltip"] == "Neutralizer rate"
    assert row["displayStats"]["trackingOrApplication"]["value"].startswith("-")


def test_module_rows_expose_cap_using_module_cost_and_loaded_charge() -> None:
    imported = import_eft("[Tempest Fleet Issue, Cap]\n\nMedium Capacitor Booster II, Navy Cap Booster 800\n")
    assert imported["ok"] is True, imported.get("errors")
    row = imported["calculation"]["stats"]["moduleRows"]["mid"][0]

    assert row["chargeName"] == "Navy Cap Booster 800"
    assert row["displayStats"]["capOrFuel"]["tooltip"] == "Capacitor gained per activation"
    assert "GJ" in row["displayStats"]["capOrFuel"]["value"]
