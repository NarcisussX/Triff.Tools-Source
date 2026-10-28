from copy import deepcopy
import json
from pathlib import Path

import pytest

from pyfa_adapter import configure_pyfa
from pyfa_adapter.calculator import calculate
from pyfa_adapter.combat_profile import combat_profile, prepare_request, serialize_module, spool_options
from pyfa_adapter.fit_builder import build_fit
from pyfa_adapter.eft import import_eft

FIXTURES = Path(__file__).parent / "fixtures" / "combat_profiles"


def type_id(name):
    configure_pyfa()
    import eos.db
    return int(eos.db.getItem(name).ID)


def eft(name):
    return (FIXTURES / f"{name}.eft").read_text(encoding="utf-8")


def profile(request):
    result = combat_profile(request)
    assert result["ok"], result
    assert not result["errors"]
    json.dumps(result, allow_nan=False)
    return result["profile"]


@pytest.mark.parametrize("name", ["leshak", "guardian", "devoter", "loki", "raven", "gila", "claymore", "nestor"])
def test_combat_profile_matches_calculation_and_native_modules(name):
    request = {"eft": eft(name)}
    payload, _, _ = prepare_request(request)
    before = deepcopy(payload)
    result = profile({"payload": payload})
    calculated = calculate(payload)
    assert calculated["ok"]
    assert payload == before
    for layer in ("shield", "armor", "hull"):
        assert result["defense"][layer]["hp"] == calculated["stats"]["defense"]["hp"][layer]
        for kind, value in result["defense"][layer]["resists"].items():
            assert value == pytest.approx(calculated["stats"]["defense"]["resists"][layer][kind])
    assert result["movement"]["maxVelocityMps"] == calculated["stats"]["navigation"]["maxSpeed"]
    assert result["capacitor"]["capacityGj"] == calculated["stats"]["capacitor"]["capacityGj"]
    assert result["capacitor"]["rechargeTimeMs"] == pytest.approx(calculated["stats"]["capacitor"]["rechargeTime"] * 1000)
    fit, _, errors = build_fit(payload)
    assert not errors
    for layer in ("shield", "armor", "hull"):
        for kind, value in result["defense"][layer]["resists"].items():
            name = kind.capitalize() if layer != "hull" else kind
            key = f"{layer if layer != 'hull' else ''}{name}DamageResonance"
            assert value == pytest.approx(1 - fit.ship.getModifiedItemAttr(key))
    for row in result["modules"]:
        native = next(mod for mod in fit.modules if mod.triffSlotName == row["rack"] and mod.triffSlotIndex == row["index"])
        assert row["cycleTimeMs"] == (native.rawCycleTime or None)
        assert row["reloadTimeMs"] == native.reloadTime
        assert row["reactivationDelayMs"] == native.reactivationDelay
        missile = row["application"]["missile"] if row["application"] else None
        if missile:
            assert missile["maxVelocityMps"] == native.getModifiedChargeAttr("maxVelocity")
            assert missile["explosionVelocityMps"] == native.getModifiedChargeAttr("aoeVelocity")
            assert missile["flightTimeMs"] == native.getModifiedChargeAttr("explosionDelay")
        if row["damage"]:
            assert row["damage"]["volleyHp"]["total"] == pytest.approx(native.getVolley(spoolOptions=spool_options()).total)
            assert row["damage"]["dps"]["total"] == pytest.approx(native.getDps(spoolOptions=spool_options()).total)
    for row, native in zip(result["drones"], fit.drones, strict=True):
        assert row["maxVelocityMps"] == native.getModifiedItemAttr("maxVelocity")
        assert row["orbitVelocityMps"] == native.getModifiedItemAttr("entityCruiseSpeed")
        assert row["cycleTimeMs"] == (native.cycleTime or None)
    assert profile(request) == profile(request)


@pytest.mark.parametrize("name", ["leshak", "guardian", "devoter", "loki", "raven", "gila", "claymore", "nestor"])
def test_reviewed_combat_profile_snapshots(name):
    actual = combat_profile({"eft": eft(name)})
    expected = json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    assert actual["profile"]["engine"] == expected["profile"]["engine"], "Engine changed; review and regenerate CombatProfile snapshots."
    assert actual == expected


def test_velocity_units_use_mps_and_ms_is_reserved_for_milliseconds():
    velocity_fields = set()
    timing_fields = set()

    def check(value):
        if isinstance(value, list):
            for entry in value:
                check(entry)
        elif isinstance(value, dict):
            for key, entry in value.items():
                if key.endswith("Mps"):
                    velocity_fields.add(key)
                if key.endswith("Ms"):
                    timing_fields.add(key)
                check(entry)

    for fixture in FIXTURES.glob("*.json"):
        check(json.loads(fixture.read_text(encoding="utf-8")))
    assert velocity_fields == {"maxVelocityMps", "explosionVelocityMps", "orbitVelocityMps"}
    assert timing_fields == {
        "averageCycleTimeMs", "cycleTimeMs", "durationMs", "flightTimeMs", "offsetMs",
        "reactivationDelayMs", "rechargeTimeMs", "reloadTimeMs", "shieldRechargeTimeMs",
    }


def test_spool_minimum_current_maximum_and_alternate_ammo():
    request = {"eft": eft("leshak")}
    baseline = profile(request)
    gun = baseline["modules"][0]
    assert gun["spool"]["minimum"]["damage"]["volleyHp"]["total"] < gun["spool"]["maximum"]["damage"]["volleyHp"]["total"]
    assert gun["spool"]["current"] == gun["spool"]["maximum"]
    assert gun["application"]["missile"] is None
    changed = profile({**request, "moduleOverrides": [{"rack": "high", "index": 0, "chargeTypeId": type_id("Mystic L")}]})
    assert changed["modules"][0]["optimalRangeM"] > gun["optimalRangeM"]
    assert changed["modules"][0]["damage"] != gun["damage"]
    assert changed["profileId"] != baseline["profileId"]
    assert changed["fitHash"] != baseline["fitHash"]
    payload = import_eft(eft("leshak"), calculate_fit=False)["payload"]
    payload["modules"]["high"][0]["spool"] = {"spoolType": "cycles", "spoolAmount": 3}
    current = profile({"payload": payload})["modules"][0]["spool"]
    assert current["current"]["cycles"] == 3
    repair = profile({"eft": "[Zarmazd, Spool Reps]\nHeavy Mutadaptive Remote Armor Repairer II\n"})["modules"][0]
    assert repair["spool"]["kind"] == "remote_repair"
    assert repair["spool"]["maximum"]["remoteRepairEvents"][0]["armorHp"] > repair["spool"]["minimum"]["remoteRepairEvents"][0]["armorHp"]


def test_remote_repair_and_cap_transfer_are_discrete_native_events():
    result = profile({"eft": eft("guardian")})
    armor, cap, ancillary = result["modules"][:3]
    assert armor["remoteRepairEvents"][0]["offsetMs"] == armor["cycleTimeMs"]
    assert armor["remoteRepairEvents"][0]["armorHp"] > 0
    assert cap["remoteRepairEvents"][0]["capacitorGj"] > cap["capacitorCostGj"]
    assert cap["remoteRepairEvents"][0]["offsetMs"] == cap["cycleTimeMs"]
    assert ancillary["remoteRepairEvents"][0]["armorHp"] > 0
    payload, _, _ = prepare_request({"eft": eft("guardian")})
    native_fit, _, _ = build_fit(payload)
    for row in (armor, cap, ancillary):
        mod = next(mod for mod in native_fit.modules if mod.triffSlotName == "high" and mod.triffSlotIndex == row["index"])
        for offset, amounts in mod.getRepAmountParameters(ignoreState=True).items():
            if any(getattr(amounts, key) for key in ("shield", "armor", "hull", "capacitor")):
                exported = next(event for event in row["remoteRepairEvents"] if event["offsetMs"] == offset)
                for key, output in (("armor", "armorHp"), ("capacitor", "capacitorGj")):
                    assert exported[output] == pytest.approx(getattr(amounts, key))
    shield = profile({"eft": "[Basilisk, Shield]\nLarge Remote Shield Booster II\n"})["modules"][0]
    assert shield["remoteRepairEvents"][0]["offsetMs"] == 0
    assert shield["remoteRepairEvents"][0]["shieldHp"] > 0


def test_hic_bubble_and_scripts_are_distinguished_by_effects():
    modules = profile({"eft": eft("devoter")})["modules"]
    bubble, point, scram = (mod["tackle"] for mod in modules[:3])
    assert bubble["kind"] == "warp_disruption_field"
    assert bubble["requiresTarget"] is False
    assert bubble["fieldRadiusM"] > 0
    assert point["kind"] == "focused_warp_disruptor"
    assert point["blocksMicrowarpdrive"] is False
    assert scram["kind"] == "focused_warp_scrambler"
    assert scram["blocksMicrowarpdrive"] is True
    assert "mass_entangler" in modules[3]["roles"]


def test_loki_post_skill_web_and_scripted_damp():
    result = profile({"eft": eft("loki")})
    web = next(mod for mod in result["modules"] if "stasis_web" in mod["roles"])
    assert web["optimalRangeM"] > 10000
    assert web["tackle"]["velocityBonusPercent"] < 0
    damp = next(mod for mod in result["modules"] if mod["ewar"])
    assert damp["ewar"]["maxTargetRangeBonusPercent"] < 0
    assert damp["ewar"]["scanResolutionBonusPercent"] == 0


def test_missile_application_neut_nos_and_cap_booster():
    result = profile({"eft": eft("raven")})
    launcher, neut, nos = result["modules"][:3]
    assert launcher["application"]["missile"]["explosionRadiusM"] > 0
    assert launcher["application"]["trackingRadPerSecond"] is None
    assert launcher["magazineCharges"] > 0
    assert launcher["optimalRangeM"] > 0
    assert neut["capWarfare"]["kind"] == "neutralizer"
    assert neut["capWarfare"]["amountGj"] > 0
    assert nos["capWarfare"]["kind"] == "nosferatu"
    assert nos["capWarfare"]["amountGj"] > 0
    booster = next(mod for mod in result["modules"] if mod["typeId"] == type_id("Heavy Capacitor Booster II"))
    assert booster["capacitorCostGj"] < 0


def test_nestor_capacitor_boosters_describe_native_values_and_shared_cargo():
    request = {"eft": eft("nestor")}
    result = profile(request)
    assert result["combatProfileSchemaVersion"] == "1.1.0"
    boosters = [row for row in result["modules"] if row["capacitorBooster"] is not None]
    assert [row["id"] for row in boosters] == ["mid:0", "mid:1"]
    payload, _, _ = prepare_request(request)
    fit, _, errors = build_fit(payload)
    assert not errors
    for row in boosters:
        native = next(mod for mod in fit.modules if mod.triffSlotName == row["rack"] and mod.triffSlotIndex == row["index"])
        block = row["capacitorBooster"]
        assert block == {
            "capacitorGainGj": 3200, "chargeTypeId": 41490, "chargeName": "Navy Cap Booster 3200",
            "cycleTimeMs": 12000, "reloadTimeMs": 10000, "magazineCapacity": 1,
            "chargeConsumptionPerActivation": 1, "loadedCharges": 1, "spareCharges": 20,
        }
        assert block["capacitorGainGj"] == -row["capacitorCostGj"] == -native.getModifiedItemAttr("capacitorNeed")
        assert block["chargeTypeId"] == row["charge"]["typeId"] == int(native.charge.ID)
        assert block["chargeName"] == row["charge"]["typeName"] == native.charge.typeName
        assert block["cycleTimeMs"] == row["cycleTimeMs"] == native.rawCycleTime
        assert block["reloadTimeMs"] == row["reloadTimeMs"] == native.reloadTime
        assert block["magazineCapacity"] == row["magazineCharges"] == native.numCharges
        assert block["chargeConsumptionPerActivation"] == row["chargeConsumptionPerCycle"] == native.getModifiedItemAttr("chargeRate")
        assert block["loadedCharges"] == native.numCharges
        assert block["spareCharges"] == sum(item["quantity"] for item in result["cargo"] if item["typeId"] == block["chargeTypeId"])
    assert len(result["cargo"]) == 1 and result["cargo"][0]["quantity"] == 20
    assert profile(request) == result


@pytest.mark.parametrize("charge_name", ["Navy Cap Booster 800", "Cap Booster 400"])
def test_capacitor_booster_uses_selected_charge_and_only_matching_cargo(charge_name):
    payload = import_eft(eft("nestor"), calculate_fit=False)["payload"]
    charge_id = type_id(charge_name)
    payload["modules"]["mid"][0]["chargeTypeId"] = charge_id
    payload["cargo"].extend([{"typeId": charge_id, "quantity": 7}, {"typeId": charge_id, "quantity": 3}])
    before = deepcopy(payload)
    result = profile({"payload": payload})
    fit, _, errors = build_fit(payload)
    assert not errors
    row = next(mod for mod in result["modules"] if mod["id"] == "mid:0")
    native = next(mod for mod in fit.modules if mod.triffSlotName == "mid" and mod.triffSlotIndex == 0)
    block = row["capacitorBooster"]
    assert block["capacitorGainGj"] == -native.getModifiedItemAttr("capacitorNeed")
    assert block["capacitorGainGj"] > 0 and block["capacitorGainGj"] != 3200
    assert block["chargeTypeId"] == charge_id
    assert block["chargeName"] == charge_name
    assert block["magazineCapacity"] == block["loadedCharges"] == native.numCharges
    assert block["magazineCapacity"] > 1
    assert block["spareCharges"] == 10
    other = next(mod for mod in result["modules"] if mod["id"] == "mid:1")
    assert other["capacitorBooster"]["spareCharges"] == 20
    assert payload == before
    payload["cargo"] = []
    without_spares = next(mod for mod in profile({"payload": payload})["modules"] if mod["id"] == "mid:0")
    assert without_spares["capacitorBooster"]["spareCharges"] == 0
    assert without_spares["capacitorBooster"]["loadedCharges"] == native.numCharges


def test_capacitor_booster_classification_does_not_use_names_or_signed_cost(monkeypatch):
    result = profile({"eft": eft("nestor")})
    battery = next(row for row in result["modules"] if row["groupId"] == 61)
    assert battery["capacitorBooster"] is None
    assert all(row["capacitorBooster"] is None for row in result["modules"] if row["groupId"] != 76)
    raven = profile({"eft": eft("raven")})
    nos = next(row for row in raven["modules"] if "nosferatu" in row["roles"])
    assert nos["capacitorCostGj"] < 0 and nos["capacitorBooster"] is None
    fit, _, errors = build_fit(import_eft(eft("nestor"), calculate_fit=False)["payload"])
    assert not errors
    booster = next(mod for mod in fit.modules if mod.item.groupID == 76)
    battery = next(mod for mod in fit.modules if mod.item.groupID == 61)
    monkeypatch.setattr(booster.item, "typeName", "Unrelated display label")
    monkeypatch.setattr(battery.item, "typeName", "Cap Booster")
    assert serialize_module(booster, [], [])["capacitorBooster"] is not None
    assert serialize_module(battery, [], [])["capacitorBooster"] is None


def test_unloaded_capacitor_booster_is_explicit_without_guessing_from_cargo():
    result = profile({"eft": eft("nestor"), "moduleOverrides": [{"rack": "mid", "index": 0, "chargeTypeId": None}]})
    row = next(mod for mod in result["modules"] if mod["id"] == "mid:0")
    assert row["charge"] is None
    assert row["capacitorBooster"] == {
        "capacitorGainGj": 0, "chargeTypeId": None, "chargeName": None,
        "cycleTimeMs": row["cycleTimeMs"], "reloadTimeMs": row["reloadTimeMs"],
        "magazineCapacity": None, "chargeConsumptionPerActivation": row["chargeConsumptionPerCycle"],
        "loadedCharges": 0, "spareCharges": None,
    }
    assert result["cargo"][0]["quantity"] == 20


@pytest.mark.parametrize("state", ["offline", "online", "active", "overheated"])
def test_capacitor_booster_follows_native_selected_state(state):
    request = {"eft": eft("nestor"), "moduleOverrides": [{"rack": "mid", "index": 0, "state": state}]}
    payload, _, _ = prepare_request(request)
    fit, _, errors = build_fit(payload)
    assert not errors
    result = profile(request)
    row = next(mod for mod in result["modules"] if mod["id"] == "mid:0")
    native = next(mod for mod in fit.modules if mod.triffSlotName == "mid" and mod.triffSlotIndex == 0)
    assert row["state"] == state
    assert row["capacitorBooster"]["capacitorGainGj"] == native.getModifiedChargeAttr("capacitorBonus")
    if row["capacitorCostGj"] is not None:
        assert row["capacitorBooster"]["capacitorGainGj"] == -row["capacitorCostGj"]
    assert row["capacitorBooster"]["cycleTimeMs"] == native.rawCycleTime


def test_drone_per_unit_values_include_undeployed_drones_without_changing_fit():
    payload = import_eft(eft("gila"), calculate_fit=False)["payload"]
    payload["drones"][0]["active"] = 2
    payload["drones"][1]["active"] = 0
    before = deepcopy(payload)
    result = profile({"payload": payload})
    active, spare = result["drones"]
    assert active["quantityAvailable"] == 4 and active["quantityDeployed"] == 2
    assert active["perUnitDamage"]["dps"]["total"] * 2 == pytest.approx(active["activeStackDamage"]["dps"]["total"])
    assert spare["quantityDeployed"] == 0
    assert spare["perUnitDamage"]["dps"]["total"] > 0
    assert spare["activeStackDamage"]["dps"]["total"] == 0
    assert payload == before
    payload["drones"][0]["active"] = 0
    payload["drones"][1]["active"] = 1
    deployed = profile({"payload": payload})["drones"][1]
    assert deployed["perUnitDamage"] == spare["perUnitDamage"]


def test_command_buffs_export_native_fitted_strength_and_context():
    request = {"eft": eft("claymore")}
    result = profile(request)
    burst = result["modules"][0]["commandBurst"]
    assert burst["effects"][0]["effect"] == "tackle_range"
    assert burst["effects"][0]["bonusPercent"] > 18
    assert burst["durationMs"] > 60000
    assert burst["radiusM"] > 0
    source = import_eft(eft("claymore"), calculate_fit=False)["payload"]
    target = import_eft(eft("loki"), calculate_fit=False)["payload"]
    cold = profile({"payload": target})
    boosted = profile({"payload": {"targetFit": target, "sourceFits": [{"tabId": "boost", "fitState": source}],
                                   "commandLinks": [{"sourceTabId": "boost", "selectedBursts": [{"sourceModuleInstanceId": source["modules"]["high"][0]["id"], "enabled": True}]}]}})
    web = lambda p: next(mod for mod in p["modules"] if "stasis_web" in mod["roles"])
    assert web(boosted)["optimalRangeM"] > web(cold)["optimalRangeM"]
    assert boosted["profileId"] != cold["profileId"]


def test_heat_and_skill_overrides_change_identity_and_native_output():
    baseline = profile({"eft": eft("raven")})
    hot = profile({"eft": eft("raven"), "moduleOverrides": [{"rack": "high", "index": 0, "state": "overheated"}]})
    assert hot["modules"][0]["damage"]["dps"]["total"] > baseline["modules"][0]["damage"]["dps"]["total"]
    assert hot["modules"][0]["heat"]["hp"] > 0
    assert hot["heat"]["racks"]["high"]["capacity"] > 0
    prop = next(mod for mod in baseline["modules"] if "microwarpdrive" in mod["roles"])
    assert prop["heat"]["overloadSpeedPercent"] > 0
    lowered = profile({"eft": eft("raven"), "skillOverrides": {str(type_id("Missile Launcher Operation")): 0}})
    assert lowered["skills"]["effectiveSkillsHash"] != baseline["skills"]["effectiveSkillsHash"]
    assert lowered["modules"][0]["cycleTimeMs"] > baseline["modules"][0]["cycleTimeMs"]
    assert len({baseline["profileId"], hot["profileId"], lowered["profileId"]}) == 3


@pytest.mark.parametrize("body", [{}, {"eft": ""}, {"eft": "nonsense"}, {"eft": 5}, {"payload": []},
    {"eft": "[Rifter, Fit]", "payload": {}}, {"payload": {"shipTypeId": 587, "modules": []}},
    {"payload": {"shipTypeId": 587, "drones": ["bad"]}},
    {"payload": {"shipTypeId": 587, "sourceFits": [{}]}},
    {"payload": {"shipTypeId": 587, "fighters": [{"typeId": 1, "quantity": 1000000}]}},
    {"eft": "[Rifter, Invalid]\n", "skillOverrides": {"3300": 6}},
    {"eft": "[Rifter, Invalid]\n", "skillOverrides": {"3300": None}},
    {"eft": "x" * (256 * 1024)},
])
def test_malformed_requests_fail_structurally(body):
    result = combat_profile(body)
    assert result["ok"] is False
    assert result["profile"] is None
    assert result["errors"]


@pytest.mark.parametrize("override", [
    {"rack": "high", "index": 0, "chargeTypeId": 34},
    {"rack": "high", "index": 0, "chargeTypeId": -1},
    {"rack": "high", "index": 40, "state": "active"},
    {"rack": "high", "index": 0, "state": "heated"},
    {"rack": "low", "index": 0, "state": "overheated"},
])
def test_invalid_ammo_and_state_overrides_do_not_silently_succeed(override):
    result = combat_profile({"eft": eft("raven"), "moduleOverrides": [override]})
    assert result["ok"] is False
    assert result["errors"][0]["code"] == "invalid_combat_profile_request"


def test_unload_charge_and_inactive_module_are_explicit():
    result = profile({"eft": eft("raven"), "moduleOverrides": [{"rack": "high", "index": 0, "chargeTypeId": None}]})
    assert result["modules"][0]["charge"] is None
    inactive = profile({"eft": eft("raven"), "moduleOverrides": [{"rack": "high", "index": 0, "state": "online"}]})
    assert inactive["modules"][0]["damage"]["dps"]["total"] == 0
    assert inactive["modules"][0]["damage"]["activationDps"]["total"] > 0


def test_local_ancillary_repair_uses_native_contribution_not_unmultiplied_amount():
    text = "[Myrmidon, Local]\nMedium Ancillary Armor Repairer, Nanite Repair Paste\nMedium Armor Repairer II\n"
    result = profile({"eft": text})
    fit, _, _ = build_fit(import_eft(text, calculate_fit=False)["payload"])
    for row in result["modules"]:
        native = next(mod for mod in fit.modules if int(mod.item.ID) == row["typeId"])
        rate = sum(post for source, _op, _g, _pre, post, used in fit.extraAttributes.getAfflictions("armorRepair")[fit] if source is native and used)
        assert row["localRepair"]["armorHpPerCycle"] == pytest.approx(rate * native.rawCycleTime / 1000)
        assert row["localRepair"]["landingOffsetMs"] is None
    assert result["modules"][0]["localRepair"]["armorHpPerCycle"] > result["modules"][1]["localRepair"]["armorHpPerCycle"]


def test_ecm_weapon_disruption_grappler_and_point_have_semantic_roles():
    result = combat_profile({"eft": "[Armageddon, EWAR]\nTracking Disruptor II, Tracking Speed Disruption Script\nMultispectral ECM II\nHeavy Stasis Grappler II\nWarp Disruptor II\n"})
    assert result["ok"] and not result["warnings"]
    disruptor, ecm, grappler, point = result["profile"]["modules"]
    assert disruptor["ewar"]["trackingBonusPercent"] < 0
    assert disruptor["ewar"]["optimalBonusPercent"] == 0
    assert ecm["ewar"]["radarJamStrength"] > 0
    assert ecm["ewar"]["ladarJamStrength"] > 0
    assert grappler["tackle"]["kind"] == "grappler"
    assert grappler["falloffM"] > 0
    assert point["tackle"]["kind"] == "warp_disruptor"
    assert point["tackle"]["blocksMicrowarpdrive"] is False


def test_ship_mode_changes_profile_and_calculated_movement():
    payload = {"shipTypeId": type_id("Svipul"), "fitName": "Modes", "modules": {}}
    defense = profile({"payload": payload})
    propulsion = profile({"payload": {**payload, "shipMode": {"modeId": str(type_id("Svipul Propulsion Mode"))}}})
    assert defense["ship"]["mode"]["typeId"] != propulsion["ship"]["mode"]["typeId"]
    assert defense["profileId"] != propulsion["profileId"]
    assert defense["movement"]["alignTimeSeconds"] > propulsion["movement"]["alignTimeSeconds"]


def test_unknown_command_buff_has_null_semantics_not_guessed_effect():
    from pyfa_adapter.combat_profile import command_burst
    payload = import_eft(eft("claymore"), calculate_fit=False)["payload"]
    fit, _, _ = build_fit(payload)
    mod = next(mod for mod in fit.modules if mod.triffSlotName == "high")
    mod.chargeModifiedAttributes["warfareBuff1ID"] = 999999
    warnings = []
    result = command_burst(mod, warnings, "high:0")
    assert result["effects"][0]["supported"] is False
    assert result["effects"][0]["effect"] is None
    assert warnings[0]["code"] == "unsupported_command_buff"


def test_service_exception_is_structured_and_does_not_expose_internals(monkeypatch):
    import asyncio
    import app
    def broken(_request):
        raise RuntimeError("private traceback content")
    monkeypatch.setattr(app, "combat_profile", broken)
    result = asyncio.run(app.combat_profile_route({"eft": "[Rifter, Failure]"}))
    assert result["ok"] is False
    assert result["errors"][0]["code"] == "combat_profile_failed"
    assert "private traceback content" not in json.dumps(result)
