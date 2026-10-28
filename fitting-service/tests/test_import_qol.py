from __future__ import annotations

from pathlib import Path

from pyfa_adapter import configure_pyfa
from pyfa_adapter.calculator import calculate
from pyfa_adapter.damage_profiles import damage_profile_tree
from pyfa_adapter.eft import export_eft, import_eft


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "imports"
FIT_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "fits"


def _type_id(name: str) -> int:
    configure_pyfa()
    import eos.db

    item = eos.db.getItem(name)
    assert item is not None, name
    return int(item.ID)


def _empty_payload(ship_name: str, fit_name: str) -> dict:
    return {
        "shipTypeId": _type_id(ship_name),
        "fitName": fit_name,
        "characterMode": "all_v",
        "modules": {"high": [], "mid": [], "low": [], "rig": [], "subsystem": []},
        "drones": [],
        "fighters": [],
        "cargo": [],
        "implants": [],
        "boosters": [],
        "projectedEffects": [],
        "environment": {"wormholeEffect": None, "abyssalWeather": None},
    }


def test_tempest_refit_modules_after_drone_block_import_as_cargo() -> None:
    imported = import_eft((FIXTURE_DIR / "tempest_fleet_issue_refit_cargo.eft").read_text(encoding="utf-8"))
    assert imported["ok"] is True, imported.get("errors")

    payload = imported["payload"]
    assert payload["shipTypeName"] == "Tempest Fleet Issue"
    assert len(payload["modules"]["low"]) == 7
    assert len(payload["modules"]["mid"]) == 5
    assert len(payload["modules"]["high"]) == 8
    assert len(payload["modules"]["rig"]) == 3

    cargo_names = {item["typeName"] for item in payload["cargo"]}
    assert "Warp Scrambler II" in cargo_names
    assert "Sensor Booster II" in cargo_names
    assert "1200mm Artillery Cannon II" in cargo_names
    assert "Heavy Infectious Scoped Energy Neutralizer" in cargo_names

    drone_names = {item["typeName"] for item in payload["drones"]}
    assert "Warrior II" in drone_names
    assert "Republic Fleet Bouncer" in drone_names

    exported = export_eft(payload)
    assert exported["ok"] is True
    assert "Warp Scrambler II x1" in exported["text"]
    assert "1200mm Artillery Cannon II x6" in exported["text"]


def test_precursor_weapon_spool_cycles_affect_firepower() -> None:
    imported = import_eft((FIT_FIXTURE_DIR / "003_turret_armor_leshak.eft").read_text(encoding="utf-8"))
    assert imported["ok"] is True, imported.get("errors")

    default_stats = imported["calculation"]["stats"]
    spool = default_stats["moduleRows"]["high"][0]["spool"]
    assert spool["eligible"] is True
    assert spool["minCycles"] == 0
    assert spool["maxCycles"] > 0
    assert default_stats["firepower"]["weaponDps"] > 2000

    payload = imported["payload"]
    payload["modules"]["high"][0]["spoolType"] = "cycles"
    payload["modules"]["high"][0]["spoolAmount"] = 0
    base = calculate(payload)
    assert base["ok"] is True, base.get("errors")
    assert base["stats"]["moduleRows"]["high"][0]["spool"]["currentCycles"] == 0
    assert base["stats"]["firepower"]["weaponDps"] < default_stats["firepower"]["weaponDps"]


def test_over_slot_payload_is_rejected_without_stats() -> None:
    payload = {
        "shipTypeId": _type_id("Rifter"),
        "fitName": "Too Many Mids",
        "characterMode": "all_v",
        "modules": {
            "high": [],
            "mid": [{"typeId": _type_id("1MN Afterburner I")} for _ in range(8)],
            "low": [],
            "rig": [],
            "subsystem": [],
        },
        "drones": [],
        "fighters": [],
        "cargo": [],
        "implants": [],
        "boosters": [],
        "projectedEffects": [],
        "environment": {"wormholeEffect": None, "abyssalWeather": None},
    }

    result = calculate(payload)
    assert result["ok"] is False
    assert result["stats"] is None
    assert any(error["code"] == "slot_over" for error in result["errors"])


def test_launcher_hardpoint_limit_rejects_extra_launchers_but_allows_other_high_modules() -> None:
    too_many = _empty_payload("Drake", "Too Many Launchers")
    too_many["modules"]["high"] = [{"typeId": _type_id("Heavy Missile Launcher I")} for _ in range(7)]

    result = calculate(too_many)
    assert result["ok"] is False
    assert result["stats"] is None
    launcher_error = next(error for error in result["errors"] if error["code"] == "HARDPOINT_LIMIT_EXCEEDED")
    assert launcher_error["details"]["launcherHardpointsUsed"] == 7
    assert launcher_error["details"]["launcherHardpointsMax"] == 6

    legal = _empty_payload("Drake", "Six Launchers And Utility")
    legal["modules"]["high"] = [
        *[{"typeId": _type_id("Heavy Missile Launcher I")} for _ in range(6)],
        {"typeId": _type_id("Salvager I")},
    ]
    allowed = calculate(legal)
    assert allowed["ok"] is True, allowed.get("errors")
    assert allowed["stats"]["hardpoints"]["launcher"]["used"] == 6


def test_zero_turret_hull_rejects_turret_even_when_high_slot_is_free() -> None:
    payload = _empty_payload("Kestrel", "No Turret Hardpoint")
    payload["modules"]["high"] = [{"typeId": _type_id("200mm AutoCannon II")}]

    result = calculate(payload)
    assert result["ok"] is False
    turret_error = next(error for error in result["errors"] if error["code"] == "HARDPOINT_LIMIT_EXCEEDED")
    assert turret_error["details"]["turretHardpointsUsed"] == 1
    assert turret_error["details"]["turretHardpointsMax"] == 0


def test_mode_capable_ship_returns_and_applies_ship_modes() -> None:
    payload = _empty_payload("Confessor", "Mode Test")

    default_result = calculate(payload)
    assert default_result["ok"] is True, default_result.get("errors")
    modes = default_result["stats"]["shipModes"]["available"]
    labels = {mode["label"] for mode in modes}
    assert {"Defense", "Propulsion", "Sharpshooter"}.issubset(labels)
    assert default_result["payload"]["shipMode"]["label"] == "Defense"

    sharpshooter = next(mode for mode in modes if mode["label"] == "Sharpshooter")
    sharpshooter_result = calculate({**payload, "shipMode": {"modeId": sharpshooter["modeId"]}})
    assert sharpshooter_result["ok"] is True, sharpshooter_result.get("errors")
    assert sharpshooter_result["payload"]["shipMode"]["label"] == "Sharpshooter"
    assert (
        sharpshooter_result["stats"]["targeting"]["range"]
        > default_result["stats"]["targeting"]["range"]
    )


def test_normal_ship_has_no_ship_modes() -> None:
    result = calculate(_empty_payload("Catalyst", "No Modes"))
    assert result["ok"] is True, result.get("errors")
    assert result["stats"]["shipModes"]["available"] == []
    assert result["stats"]["shipModes"]["activeModeId"] is None
    assert result["payload"]["shipMode"] is None


def test_invalid_ship_mode_falls_back_to_default() -> None:
    payload = _empty_payload("Confessor", "Bad Mode")
    payload["shipMode"] = {"modeId": str(_type_id("Svipul Defense Mode"))}

    result = calculate(payload)
    assert result["ok"] is True, result.get("errors")
    assert result["payload"]["shipMode"]["label"] == "Defense"
    assert any(warning["code"] == "ship_mode_invalid" for warning in result["warnings"])


def test_damage_profile_tree_uses_pyfa_builtins() -> None:
    tree = damage_profile_tree()

    assert tree["ok"] is True
    labels = {node["label"] for node in tree["profiles"]}
    assert "Uniform" in labels
    assert "Generic" in labels
    npc = next(node for node in tree["profiles"] if node["label"] == "NPC")
    assert any(child["label"] == "Mission" for child in npc["children"])


def test_damage_profile_selection_changes_effective_defense() -> None:
    payload = _empty_payload("Punisher", "Damage Profile")
    uniform = calculate({**payload, "damageProfile": {"profileId": "-1"}})
    em = calculate({**payload, "damageProfile": {"profileId": "-2"}})

    assert uniform["ok"] is True, uniform.get("errors")
    assert em["ok"] is True, em.get("errors")
    assert uniform["payload"]["damageProfile"]["profileId"] == "-1"
    assert em["payload"]["damageProfile"]["profileId"] == "-2"
    assert uniform["stats"]["damageProfile"]["label"] == "Uniform"
    assert em["stats"]["damageProfile"]["label"] == "EM"
    assert uniform["stats"]["defense"]["ehp"]["total"] != em["stats"]["defense"]["ehp"]["total"]


def test_t3c_subsystems_update_slot_and_hardpoint_limits_before_validation() -> None:
    payload = _empty_payload("Loki", "Subsystem Slots")
    payload["modules"]["subsystem"] = [
        {"typeId": _type_id("Loki Defensive - Adaptive Defense Node")},
        {"typeId": _type_id("Loki Offensive - Projectile Scoping Array")},
        {"typeId": _type_id("Loki Core - Augmented Nuclear Reactor")},
        {"typeId": _type_id("Loki Propulsion - Intercalated Nanofibers")},
    ]
    payload["modules"]["high"] = [{"typeId": _type_id("425mm AutoCannon II")} for _ in range(5)]

    result = calculate(payload)

    assert result["ok"] is True, result.get("errors")
    assert result["stats"]["slots"]["high"]["total"] > 0
    assert result["stats"]["slots"]["high"]["used"] == 5
    assert result["stats"]["hardpoints"]["turret"]["total"] >= 5
    assert result["stats"]["hardpoints"]["turret"]["used"] == 5


def test_t3c_wrong_hull_subsystem_is_rejected() -> None:
    payload = _empty_payload("Loki", "Wrong Subsystem")
    payload["modules"]["subsystem"] = [{"typeId": _type_id("Tengu Defensive - Covert Reconfiguration")}]

    result = calculate(payload)

    assert result["ok"] is False
    assert any(error["code"] == "INVALID_SUBSYSTEM" for error in result["errors"])


def test_eft_import_rejects_hardpoint_invalid_fit() -> None:
    eft = "[Drake, Bad Hardpoints]\n\n" + "\n".join(["Heavy Missile Launcher I"] * 7)
    imported = import_eft(eft)

    assert imported["ok"] is False
    assert any(error["code"] == "HARDPOINT_LIMIT_EXCEEDED" for error in imported["errors"])


def test_drone_active_count_is_clamped_by_bandwidth() -> None:
    base_payload = {
        "shipTypeId": _type_id("Paladin"),
        "fitName": "Paladin Drone Clamp",
        "characterMode": "all_v",
        "modules": {"high": [], "mid": [], "low": [], "rig": [], "subsystem": []},
        "drones": [{"typeId": _type_id("Ogre II"), "typeName": "Ogre II", "quantity": 9, "active": 9}],
        "fighters": [],
        "cargo": [],
        "implants": [],
        "boosters": [],
        "projectedEffects": [],
        "environment": {"wormholeEffect": None, "abyssalWeather": None},
    }

    clamped = calculate(base_payload)
    assert clamped["ok"] is True, clamped.get("errors")
    assert clamped["payload"]["drones"][0]["active"] == 1
    assert clamped["stats"]["drones"]["active"] == 1
    assert clamped["stats"]["drones"]["bandwidthUsed"] == 25

    legal_payload = {**base_payload, "drones": [{**base_payload["drones"][0], "active": 1}]}
    legal = calculate(legal_payload)
    assert legal["ok"] is True, legal.get("errors")
    assert clamped["stats"]["firepower"]["droneDps"] == legal["stats"]["firepower"]["droneDps"]


def test_five_light_drones_can_be_active() -> None:
    payload = {
        "shipTypeId": _type_id("Vexor"),
        "fitName": "Five Lights",
        "characterMode": "all_v",
        "modules": {"high": [], "mid": [], "low": [], "rig": [], "subsystem": []},
        "drones": [{"typeId": _type_id("Warrior II"), "typeName": "Warrior II", "quantity": 5, "active": 5}],
        "fighters": [],
        "cargo": [],
        "implants": [],
        "boosters": [],
        "projectedEffects": [],
        "environment": {"wormholeEffect": None, "abyssalWeather": None},
    }

    result = calculate(payload)
    assert result["ok"] is True, result.get("errors")
    assert result["stats"]["drones"]["active"] == 5
    assert result["stats"]["drones"]["bandwidthUsed"] == 25
    assert result["stats"]["firepower"]["droneDps"] > 0


def test_fighter_import_populates_fighter_rows_and_dps() -> None:
    imported = import_eft((FIXTURE_DIR / "thanatos_fighters.eft").read_text(encoding="utf-8"))
    assert imported["ok"] is True, imported.get("errors")

    payload = imported["payload"]
    assert payload["fighters"][0]["typeName"] == "Einherji I"
    assert payload["fighters"][0]["quantity"] == 2
    assert payload["fighters"][0]["active"] == 2

    stats = imported["calculation"]["stats"]
    assert stats["fighters"]["tubesUsed"] == 2
    assert stats["fighterRows"][0]["dps"] > 0
    assert stats["firepower"]["droneDps"] > 0


def test_babyfooji_abyssal_import_attaches_mutations_to_module_instances() -> None:
    imported = import_eft((FIXTURE_DIR / "babyfooji_golem_abyssal.eft").read_text(encoding="utf-8"))
    assert imported["ok"] is True, imported.get("errors")

    payload = imported["payload"]
    mutated = [
        module
        for modules in payload["modules"].values()
        for module in modules
        if module.get("mutation")
    ]
    assert len(mutated) == 5
    assert sorted(module["mutation"]["reference"] for module in mutated) == [1, 2, 3, 4, 5]

    bcs_modules = [module for module in payload["modules"]["low"] if module.get("typeName") == "Caldari Navy Ballistic Control System"]
    assert len(bcs_modules) == 3
    assert [module["mutation"]["attributes"]["missileDamageMultiplierBonus"] for module in bcs_modules] == [1.13752, 1.13644, 1.13464]

    booster = next(module for module in payload["modules"]["mid"] if module.get("typeName") == "Pith X-Type X-Large Shield Booster")
    assert booster["mutation"]["attributes"]["shieldBonus"] == 1091.43
    booster_row = next(row for row in imported["calculation"]["stats"]["moduleRows"]["mid"] if row.get("baseName") == "Pith X-Type X-Large Shield Booster")
    assert booster_row["mutation"]["attributes"]["shieldBonus"] == 1091.43
    assert booster_row["cpu"] == 238.0
    assert booster_row["powergrid"] == 500.0

    cap_battery = next(module for module in payload["modules"]["mid"] if module.get("typeName") == "Republic Fleet Large Cap Battery")
    assert cap_battery["mutation"]["attributes"]["energyWarfareResistanceBonus"] == -30.7
    assert imported["calculation"]["stats"]["capacitor"]["neutralizerResistancePercent"] > 0


def test_external_abyssal_names_import_as_unresolved_placeholders() -> None:
    eft = """[Golem, External Abyssals]

Abyssal Ballistic Control System
Abyssal Ballistic Control System
Abyssal Ballistic Control System
Abyssal Ballistic Control System

100MN Abyssal Afterburner
Abyssal Stasis Webifier
Large Abyssal Shield Extender

Cruise Missile Launcher II, Dread Guristas Nova Cruise Missile
Cruise Missile Launcher II, Dread Guristas Nova Cruise Missile
Cruise Missile Launcher II, Dread Guristas Nova Cruise Missile
Cruise Missile Launcher II, Dread Guristas Nova Cruise Missile
"""
    imported = import_eft(eft)
    assert imported["ok"] is True, imported.get("errors")

    payload = imported["payload"]
    assert [module["typeName"] for module in payload["modules"]["low"]] == ["Abyssal Ballistic Control System"] * 4
    assert all(module.get("abyssalPlaceholder") is True for module in payload["modules"]["low"])
    assert [module["typeName"] for module in payload["modules"]["mid"][:3]] == [
        "100MN Abyssal Afterburner",
        "Abyssal Stasis Webifier",
        "Large Abyssal Shield Extender",
    ]
    assert all(module.get("abyssalPlaceholder") is True for module in payload["modules"]["mid"][:3])

    stats = imported["calculation"]["stats"]
    assert stats["moduleRows"]["low"][0]["abyssalPlaceholder"] is True
    assert stats["moduleRows"]["low"][0]["cpu"] is None
    assert stats["moduleRows"]["mid"][0]["displayStats"]["range"]["value"] == "unresolved"
    assert stats["slots"]["low"]["used"] == 4
    assert any(warning["code"] == "abyssal_placeholder" for warning in imported["warnings"])

    exported = export_eft(payload)
    assert exported["ok"] is True
    assert "Abyssal Ballistic Control System" in exported["text"]
    assert "Mutaplasmid" not in exported["text"]


def test_eft_cargo_boosters_with_quantities_do_not_conflict_with_active_boosters() -> None:
    eft = """[Golem, BabyFooji Cargo Boosters]

Expanded Cargohold II
Caldari Navy Ballistic Control System
Caldari Navy Ballistic Control System
Caldari Navy Ballistic Control System

Pith X-Type X-Large Shield Booster
Domination Target Painter
Vepas' Modified Shield Boost Amplifier
Heavy F-RX Compact Capacitor Booster, Navy Cap Booster 3200
Heavy Capacitor Booster II, Navy Cap Booster 150
Pithum A-Type Multispectrum Shield Hardener
Pithum A-Type Multispectrum Shield Hardener

Caldari Navy Torpedo Launcher, Nova Rage Torpedo
Caldari Navy Torpedo Launcher, Nova Rage Torpedo
Caldari Navy Torpedo Launcher, Nova Rage Torpedo
Caldari Navy Torpedo Launcher, Nova Rage Torpedo
Bastion Module I
Display Launcher
Auto Targeting System I
[Empty High slot]

Large Core Defense Operational Solidifier II
Large Core Defense Operational Solidifier II

Hobgoblin II x15

High-grade Crystal Alpha
High-grade Crystal Beta
High-grade Crystal Gamma
High-grade Crystal Delta
High-grade Crystal Epsilon
High-grade Crystal Omega

Improved Blue Pill Booster
Agency 'Hardshell' TB9 Dose IV

Mjolnir Rage Torpedo x1708
Navy Cap Booster 3200 x16
Agency 'Hardshell' TB5 Dose II x1
Agency 'Pyrolancea' DB5 Dose II x1
Synth Blue Pill Booster x2
Synth Crash Booster x2
"""
    imported = import_eft(eft)
    assert imported["ok"] is True, imported.get("errors")

    payload = imported["payload"]
    active_boosters = {item["typeName"] for item in payload["boosters"]}
    cargo = {item["typeName"]: item["quantity"] for item in payload["cargo"]}

    assert active_boosters == {"Improved Blue Pill Booster", "Agency 'Hardshell' TB9 Dose IV"}
    assert cargo["Agency 'Hardshell' TB5 Dose II"] == 1
    assert cargo["Agency 'Pyrolancea' DB5 Dose II"] == 1
    assert cargo["Synth Blue Pill Booster"] == 2
    assert cargo["Synth Crash Booster"] == 2
    assert all(error["code"] != "DUPLICATE_BOOSTER_SLOT" for error in imported.get("errors") or [])


def test_eft_implant_quantity_lines_import_as_cargo_not_active_implants() -> None:
    imported = import_eft("""[Rifter, Cargo Implant]

High-grade Crystal Alpha

High-grade Crystal Alpha x1
High-grade Crystal Beta x2
""")
    assert imported["ok"] is True, imported.get("errors")

    payload = imported["payload"]
    assert [item["typeName"] for item in payload["implants"]] == ["High-grade Crystal Alpha"]
    cargo = {item["typeName"]: item["quantity"] for item in payload["cargo"]}
    assert cargo["High-grade Crystal Alpha"] == 1
    assert cargo["High-grade Crystal Beta"] == 2


def test_babyfooji_abyssal_export_round_trips_mutation_metadata() -> None:
    imported = import_eft((FIXTURE_DIR / "babyfooji_golem_abyssal.eft").read_text(encoding="utf-8"))
    assert imported["ok"] is True, imported.get("errors")

    exported = export_eft(imported["payload"])
    assert exported["ok"] is True
    text = exported["text"]
    assert "Caldari Navy Ballistic Control System [1]" in text
    assert "[1] Caldari Navy Ballistic Control System" in text
    assert "Unstable Ballistic Control System Mutaplasmid" in text
    assert "missileDamageMultiplierBonus 1.13752" in text
    assert "[5] Republic Fleet Large Cap Battery" in text
    assert "energyWarfareResistanceBonus -30.7" in text

    round_trip = import_eft(text)
    assert round_trip["ok"] is True, round_trip.get("errors")
    mutated = [
        module
        for modules in round_trip["payload"]["modules"].values()
        for module in modules
        if module.get("mutation")
    ]
    assert len(mutated) == 5
    assert sorted(module["mutation"]["reference"] for module in mutated) == [1, 2, 3, 4, 5]


def test_mutation_survives_state_and_charge_changes() -> None:
    imported = import_eft((FIXTURE_DIR / "babyfooji_golem_abyssal.eft").read_text(encoding="utf-8"))
    payload = imported["payload"]
    shield_booster = next(module for module in payload["modules"]["mid"] if module.get("typeName") == "Pith X-Type X-Large Shield Booster")
    shield_booster["state"] = "offline"
    offline = calculate(payload)
    assert offline["ok"] is True, offline.get("errors")
    offline_booster = next(module for module in offline["payload"]["modules"]["mid"] if module.get("typeName") == "Pith X-Type X-Large Shield Booster")
    assert offline_booster["mutation"]["attributes"]["shieldBonus"] == 1091.43

    offline_booster["state"] = "active"
    launcher = next(module for module in offline["payload"]["modules"]["high"] if module.get("typeName") == "Caldari Navy Torpedo Launcher")
    launcher["chargeTypeId"] = _type_id("Mjolnir Rage Torpedo")
    launcher["chargeTypeName"] = "Mjolnir Rage Torpedo"
    recalculated = calculate(offline["payload"])
    assert recalculated["ok"] is True, recalculated.get("errors")
    active_booster = next(module for module in recalculated["payload"]["modules"]["mid"] if module.get("typeName") == "Pith X-Type X-Large Shield Booster")
    assert active_booster["mutation"]["attributes"]["shieldBonus"] == 1091.43
