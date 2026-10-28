"""Read-only, simulation-facing export of an existing calculated eos fit."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import math
from typing import Any

from .combat_profile_fields import (
    APPLICATION_FIELDS, COMMAND_BUFFS, EWAR_FIELDS, EWAR_ROLES, MISSILE_FIELDS,
    MODULE_HEAT_FIELDS, PROPULSION_FIELDS,
)
from .crossfit import apply_cross_fit_links
from .eft import import_eft
from .fit_builder import build_fit
from .serializers import MODULE_SLOTS, SLOT_BY_VALUE, fit_to_payload, stats_from_fit
from .version_info import installed_version_info

SCHEMA_VERSION = "1.1.0"
EXPORTER_VERSION = "2"
MAX_REQUEST_BYTES = 256 * 1024
MAX_SOURCE_FITS = 8
MAX_ITEMS = 256
STATES = ("offline", "online", "active", "overheated")
DAMAGE_TYPES = ("em", "thermal", "kinetic", "explosive")


class InvalidCombatProfile(ValueError):
    pass


def number(value: Any) -> float | None:
    if value is None:
        return None
    result = float(value)
    return result if math.isfinite(result) else None


def attr(item: Any, key: str, charge: bool = False) -> float | None:
    attributes = item.chargeModifiedAttributes if charge else item.itemModifiedAttributes
    if key not in attributes:
        return None
    getter = item.getModifiedChargeAttr if charge else item.getModifiedItemAttr
    return number(getter(key, None))


def fields(item: Any, mapping: dict, charge: bool = False) -> dict:
    return {key: attr(item, source, charge) for key, source in mapping.items()}


def identity(item: Any) -> dict | None:
    return {"typeId": int(item.ID), "typeName": item.typeName} if item is not None else None


def digest(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def damage_split(value: Any, divisor: float = 1) -> dict:
    return {key: number(getattr(value, key) / divisor) for key in (*DAMAGE_TYPES, "total")}


def spool_options(scale: float | None = None):
    from eos.utils.spoolSupport import SpoolOptions, SpoolType
    return SpoolOptions(SpoolType.SPOOL_SCALE, 1 if scale is None else scale, scale is not None)


def damage(module: Any, options=None) -> dict:
    return {
        "volleyHp": damage_split(module.getVolley(spoolOptions=options)),
        "dps": damage_split(module.getDps(spoolOptions=options)),
        "activationVolleyHp": damage_split(module.getVolley(spoolOptions=options, ignoreState=True)),
        "activationDps": damage_split(module.getDps(spoolOptions=options, ignoreState=True)),
    }


def repair_events(module: Any, options=None) -> list[dict]:
    events = module.getRepAmountParameters(spoolOptions=options, ignoreState=True)
    return [
        {"offsetMs": number(delay), "shieldHp": number(amount.shield),
         "armorHp": number(amount.armor), "hullHp": number(amount.hull),
         "capacitorGj": number(amount.capacitor)}
        for delay, amount in sorted(events.items()) if any(getattr(amount, key) for key in ("shield", "armor", "hull", "capacitor"))
    ]


def spool(module: Any, has_damage: bool) -> dict | None:
    damage_step = attr(module, "damageMultiplierBonusPerCycle")
    repair_step = attr(module, "repairMultiplierBonusPerCycle")
    if not damage_step and not repair_step:
        return None
    states = {}
    for key, scale in (("minimum", 0), ("current", None), ("maximum", 1)):
        options = spool_options(scale)
        cycles, seconds = module.getSpoolData(spoolOptions=options)
        states[key] = {
            "cycles": number(cycles), "timeSeconds": number(seconds),
            "damage": damage(module, options) if has_damage else None,
            "remoteRepairEvents": repair_events(module, options),
        }
    return {
        "eligible": True,
        "kind": "damage" if damage_step else "remote_repair",
        "incrementFractionPerCycle": damage_step or repair_step,
        "maximumBonusFraction": attr(module, "damageMultiplierBonusMax" if damage_step else "repairMultiplierBonusMax"),
        "configuredType": getattr(getattr(module, "spoolType", None), "name", None),
        "configuredAmount": number(getattr(module, "spoolAmount", None)),
        **states,
    }


def application(item: Any) -> dict:
    missile = fields(item, MISSILE_FIELDS, charge=True) if item.charge is not None else None
    if missile and missile["explosionRadiusM"] is None:
        missile = None
    if missile:
        missile["theoreticalRangeM"] = number(item.maxRange)
    return {**fields(item, APPLICATION_FIELDS), "missile": missile}


def local_repair(module: Any) -> dict | None:
    amounts = {}
    for layer in ("shield", "armor", "hull"):
        contributions = module.owner.extraAttributes.getAfflictions(f"{layer}Repair").get(module.owner, [])
        rates = [post for source, _operator, _group, _pre, post, used in contributions if source is module and used]
        if rates:
            # Native fitted HP/s contribution -> HP per raw activation cycle.
            # This preserves charged ancillary and skill/ship bonuses from eos.
            amounts[f"{layer}HpPerCycle"] = number(sum(rates) * module.rawCycleTime / 1000)
    if not amounts:
        return None
    return {"shieldHpPerCycle": None, "armorHpPerCycle": None, "hullHpPerCycle": None,
            "landingOffsetMs": None, **amounts}


def module_roles(module: Any) -> list[str]:
    group = int(module.item.groupID)
    effects = set(module.item.effects)
    charge_effects = set(module.charge.effects) if module.charge is not None else set()
    roles = []
    hardpoint = getattr(getattr(module, "hardpoint", None), "name", "").lower()
    if hardpoint in ("turret", "missile"):
        roles.append("turret" if hardpoint == "turret" else "missile_launcher")
    if group in EWAR_ROLES:
        roles.append(EWAR_ROLES[group])
    if group == 52:
        roles.append("warp_scrambler" if "warpScrambleBlockMWDWithNPCEffect" in effects else "warp_disruptor")
    if group in (65, 1672):
        roles.append("grappler" if group == 1672 else "stasis_web")
    if group == 899:
        if "shipModuleFocusedWarpScramblingScript" in charge_effects:
            roles.append("focused_warp_scrambler")
        elif "shipModuleFocusedWarpDisruptionScript" in charge_effects:
            roles.append("focused_warp_disruptor")
        else:
            roles.append("warp_disruption_field")
    if group in (71, 68):
        roles.append("neutralizer" if group == 71 else "nosferatu")
    for effect, role in (("moduleBonusMicrowarpdrive", "microwarpdrive"),
                         ("moduleBonusAfterburner", "afterburner"),
                         ("massEntanglerEffect5", "mass_entangler")):
        if effect in effects:
            roles.append(role)
    if group == 1770:
        roles.append("command_burst")
    if module.isRemoteRepping(ignoreState=True):
        roles.append("remote_repair_or_cap_transfer")
    return roles


def command_burst(module: Any, warnings: list, module_id: str) -> dict:
    effects = []
    for index in range(1, 5):
        buff_id = attr(module, f"warfareBuff{index}ID", charge=True)
        if not buff_id:
            continue
        buff_id = int(buff_id)
        semantics = COMMAND_BUFFS.get(buff_id)
        effects.append({
            "buffId": buff_id, "supported": semantics is not None,
            "effect": semantics[0] if semantics else None,
            "affectedStats": semantics[1] if semantics else [],
            "bonusPercent": attr(module, f"warfareBuff{index}Value"),
        })
        if semantics is None:
            warnings.append({"code": "unsupported_command_buff", "moduleId": module_id,
                             "message": f"No normalized semantics for command buff {buff_id}."})
    return {"radiusM": number(module.maxRange), "durationMs": attr(module, "buffDuration"), "effects": effects}


def serialize_module(module: Any, warnings: list, cargo: list[dict]) -> dict:
    from eos.const import FittingModuleState

    rack = getattr(module, "triffSlotName", None) or SLOT_BY_VALUE.get(int(module.slot))
    index = int(module.triffSlotIndex)
    module_id = f"{rack}:{index}"
    roles = module_roles(module)
    cycle = module.getCycleParameters()
    valid_states = [state for state in STATES if module.isValidState(getattr(FittingModuleState, state.upper()))]
    state = module.state.name.lower()
    has_damage = module.canDealDamage(ignoreState=True)
    exotic = bool(module.isBreacher) or (has_damage and any(delay != 0 for delay in module.getVolleyParameters(ignoreState=True)))
    if exotic:
        warnings.append({"code": "unsupported_damage_timing", "moduleId": module_id,
                         "message": "Special delayed/target-dependent damage is not normalized in schema 1."})
    if has_damage and not roles:
        roles.append("other_weapon")
    reps = repair_events(module, spool_options())
    tackle_roles = {"warp_scrambler", "warp_disruptor", "focused_warp_scrambler", "focused_warp_disruptor", "warp_disruption_field", "stasis_web", "grappler"}
    row = {
        "id": module_id, "instanceId": getattr(module, "triffInstanceId", None),
        **identity(module.item), "baseType": identity(getattr(module, "baseItem", None) or module.item),
        "groupId": int(module.item.groupID), "rack": rack, "index": index,
        "state": state, "active": state in ("active", "overheated"),
        "validStates": valid_states, "canOverheat": "overheated" in valid_states,
        "roles": roles, "charge": identity(module.charge),
        "cycleTimeMs": number(module.rawCycleTime) or None,
        "averageCycleTimeMs": number(cycle.averageTime) if cycle else None,
        "reactivationDelayMs": number(module.reactivationDelay),
        "reloadTimeMs": number(module.reloadTime),
        "magazineCharges": number(module.numCharges) if module.charge is not None else None,
        "cyclesUntilReload": number(module.numShots) if module.charge is not None else None,
        "chargeConsumptionPerCycle": attr(module, "chargeRate"),
        "capacitorCostGj": attr(module, "capacitorNeed"),
        "optimalRangeM": number(module.maxRange), "falloffM": number(module.falloff),
        "damage": damage(module, spool_options()) if has_damage and not exotic else None,
        "application": application(module) if has_damage and not exotic else None,
        "remoteRepairEvents": reps,
        "localRepair": local_repair(module),
        "spool": spool(module, has_damage and not exotic),
        "heat": fields(module, MODULE_HEAT_FIELDS),
        "capWarfare": None, "tackle": None, "ewar": None, "propulsion": None, "commandBurst": None,
        "capacitorBooster": None,
        "unsupportedMechanics": ["special_damage_timing"] if exotic else [],
    }
    # Native EVE group 76 is Capacitor Booster; batteries and nosferatu are separate groups.
    if row["groupId"] == 76:
        charge = row["charge"]
        cost = row["capacitorCostGj"]
        # powerBooster (native effect 48) only writes capacitorNeed while active.
        gain = max(0.0, -cost) if cost is not None else attr(module, "capacitorBonus", charge=True)
        row["capacitorBooster"] = {
            "capacitorGainGj": gain if charge else 0.0,
            "chargeTypeId": charge["typeId"] if charge else None,
            "chargeName": charge["typeName"] if charge else None,
            "cycleTimeMs": row["cycleTimeMs"], "reloadTimeMs": row["reloadTimeMs"],
            "magazineCapacity": row["magazineCharges"],
            "chargeConsumptionPerActivation": row["chargeConsumptionPerCycle"],
            # The normalized fitting model represents a full magazine, not a runtime remaining count.
            "loadedCharges": row["magazineCharges"] if charge else 0,
            "spareCharges": sum(item["quantity"] for item in cargo if item["typeId"] == charge["typeId"]) if charge else None,
        }
    if {"neutralizer", "nosferatu"}.intersection(roles):
        row["capWarfare"] = {
            "kind": "neutralizer" if "neutralizer" in roles else "nosferatu",
            "amountGj": attr(module, "energyNeutralizerAmount" if "neutralizer" in roles else "powerTransferAmount"),
            "signatureResolutionM": attr(module, "energyNeutralizerSignatureResolution"),
            **fields(module, {"smallTargetFactor": "entityCapacitorLevelModifierSmall",
                              "mediumTargetFactor": "entityCapacitorLevelModifierMedium",
                              "largeTargetFactor": "entityCapacitorLevelModifierLarge"}),
        }
    if tackle_roles.intersection(roles):
        is_field = "warp_disruption_field" in roles
        row["tackle"] = {
            "kind": next(role for role in roles if role in tackle_roles),
            "warpDisruptionStrength": attr(module, "warpScrambleStrength"),
            "blocksMicrowarpdrive": bool({"warp_scrambler", "focused_warp_scrambler"}.intersection(roles)),
            "velocityBonusPercent": attr(module, "speedFactor"),
            "fieldRadiusM": attr(module, "warpScrambleRange") if is_field else None,
            "requiresTarget": not is_field,
        }
    if int(module.item.groupID) in EWAR_ROLES:
        row["ewar"] = {"kind": EWAR_ROLES[int(module.item.groupID)], **fields(module, EWAR_FIELDS)}
    if {"afterburner", "microwarpdrive", "mass_entangler"}.intersection(roles):
        row["propulsion"] = fields(module, PROPULSION_FIELDS)
    if "command_burst" in roles:
        row["commandBurst"] = command_burst(module, warnings, module_id)
    if row["localRepair"]:
        row["roles"].append("local_repair")
        row["unsupportedMechanics"].append("local_repair_landing_timing")
    return row


def serialize_drone(drone: Any, index: int) -> dict:
    active = int(drone.amountActive)
    # eos has no ignoreState/per-unit damage getter for drones. Feed its native
    # getter a detached one-drone copy of the already modified attributes instead
    # of changing deployment on the fitted object or reproducing its damage math.
    unit = deepcopy(drone)
    unit.amount = unit.amountActive = 1
    for key in drone.itemModifiedAttributes:
        unit.itemModifiedAttributes[key] = drone.getModifiedItemAttr(key)
    if drone.charge is not None:
        for key in drone.chargeModifiedAttributes:
            unit.chargeModifiedAttributes[key] = drone.getModifiedChargeAttr(key)
    per_unit = {"volleyHp": damage_split(unit.getVolley()), "dps": damage_split(unit.getDps())}
    return {
        "id": f"drone:{index}", **identity(drone.item), "quantityAvailable": int(drone.amount),
        "quantityDeployed": active, "perUnitDamage": per_unit,
        "activeStackDamage": {"volleyHp": damage_split(drone.getVolley()), "dps": damage_split(drone.getDps())},
        "cycleTimeMs": number(drone.cycleTime) or None,
        "optimalRangeM": number(drone.maxRange), "falloffM": attr(drone, "falloff"),
        "application": application(drone),
        **fields(drone, {"maxVelocityMps": "maxVelocity", "orbitVelocityMps": "entityCruiseSpeed",
                         "orbitRangeM": "entityFlyRange", "signatureRadiusM": "signatureRadius",
                         "bandwidthMbitPerSecond": "droneBandwidthUsed", "massKg": "mass", "agility": "agility"}),
        "hp": {key: number(value) for key, value in drone.hp.items()},
    }


def _validate_fit(payload: Any) -> None:
    if not isinstance(payload, dict):
        raise InvalidCombatProfile("payload and each fitState must be JSON objects.")
    modules = payload.get("modules") if payload.get("modules") is not None else {}
    if not isinstance(modules, dict) or any(key not in MODULE_SLOTS for key in modules):
        raise InvalidCombatProfile("modules must contain supported rack names only.")
    total = 0
    for rows in [*modules.values(), *(payload.get(key) or [] for key in ("drones", "fighters", "cargo", "implants", "boosters", "projectedEffects"))]:
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise InvalidCombatProfile("Fit item collections must be arrays of objects.")
        total += len(rows)
        for row in rows:
            for key in ("quantity", "active"):
                value = row.get(key)
                if value is not None and (type(value) is not int or value < 0 or value > 1_000_000):
                    raise InvalidCombatProfile(f"{key} must be a bounded non-negative integer.")
    if total > MAX_ITEMS:
        raise InvalidCombatProfile(f"Each fit is limited to {MAX_ITEMS} item rows.")
    if sum(row.get("quantity", 1) for row in payload.get("fighters") or []) > 25:
        raise InvalidCombatProfile("Fighter quantity exceeds the export limit.")
    for key in ("skillProfile", "skillOverrides", "environment"):
        if payload.get(key) is not None and not isinstance(payload[key], dict):
            raise InvalidCombatProfile(f"{key} must be an object.")
    for skill_id, level in (payload.get("skillOverrides") or {}).items():
        if not str(skill_id).isdigit() or int(skill_id) <= 0 or type(level) is not int or not -1 <= level <= 5:
            raise InvalidCombatProfile("Skill overrides must map positive skill IDs to integer levels -1 through 5.")


def prepare_request(request: dict) -> tuple[dict, list, list]:
    if not isinstance(request, dict):
        raise InvalidCombatProfile("Request must be a JSON object.")
    try:
        size = len(json.dumps(request, allow_nan=False).encode("utf-8"))
    except (TypeError, ValueError):
        raise InvalidCombatProfile("Request must contain finite JSON values.") from None
    if size > MAX_REQUEST_BYTES:
        raise InvalidCombatProfile("Combat profile request exceeds 256 KiB.")
    if set(request) - {"eft", "eftText", "text", "payload", "skillProfile", "skillOverrides", "moduleOverrides"}:
        raise InvalidCombatProfile("Unknown combat-profile request field.")
    efts = [request[key] for key in ("eft", "eftText", "text") if request.get(key) is not None]
    if len(efts) + (request.get("payload") is not None) != 1:
        raise InvalidCombatProfile("Supply exactly one of eft, eftText, text, or payload.")
    warnings = []
    if efts:
        if not isinstance(efts[0], str) or not efts[0].strip():
            raise InvalidCombatProfile("EFT must be a non-empty string.")
        if len(efts[0].splitlines()) > 1024:
            raise InvalidCombatProfile("EFT exceeds 1024 lines.")
        imported = import_eft(efts[0], calculate_fit=False)
        if not imported.get("ok"):
            raise InvalidCombatProfile("; ".join(error.get("message", "Invalid EFT") for error in imported.get("errors", [])))
        payload = imported["payload"]
        warnings.extend(imported.get("warnings", []))
        for key in ("skillProfile", "skillOverrides"):
            if request.get(key) is not None:
                payload[key] = deepcopy(request[key])
    else:
        if request.get("skillProfile") is not None or request.get("skillOverrides") is not None:
            raise InvalidCombatProfile("Put skills inside payload when using payload input.")
        payload = deepcopy(request["payload"])
    if not isinstance(payload, dict):
        raise InvalidCombatProfile("payload must be an object.")
    if "graphTargets" in payload:
        raise InvalidCombatProfile("graphTargets are not combat-profile inputs.")
    if "targetFit" not in payload and any(key in payload for key in ("sourceFits", "projectedLinks", "commandLinks")):
        raise InvalidCombatProfile("Cross-fit inputs require a targetFit envelope.")
    target = payload.get("targetFit", payload)
    _validate_fit(target)
    sources = payload.get("sourceFits") or []
    if not isinstance(sources, list) or len(sources) > MAX_SOURCE_FITS:
        raise InvalidCombatProfile("At most eight sourceFits are supported.")
    for source in sources:
        if not isinstance(source, dict):
            raise InvalidCombatProfile("sourceFits must contain objects.")
        _validate_fit(source.get("fitState"))
    for key in ("projectedLinks", "commandLinks"):
        links = payload.get(key) or []
        if not isinstance(links, list) or len(links) > 32 or any(not isinstance(link, dict) for link in links):
            raise InvalidCombatProfile(f"{key} must be a bounded array of objects.")
    overrides = request.get("moduleOverrides") or []
    if not isinstance(overrides, list) or len(overrides) > 64:
        raise InvalidCombatProfile("moduleOverrides must be an array of at most 64 entries.")
    seen = set()
    for override in overrides:
        if not isinstance(override, dict) or set(override) - {"rack", "index", "chargeTypeId", "state"}:
            raise InvalidCombatProfile("Module overrides accept rack, index, chargeTypeId, and state only.")
        rack, index = override.get("rack"), override.get("index")
        rows = (target.get("modules") or {}).get(rack, []) if isinstance(rack, str) else []
        if rack not in MODULE_SLOTS or type(index) is not int or not 0 <= index < len(rows):
            raise InvalidCombatProfile("Module override must identify an existing rack/index.")
        if (rack, index) in seen:
            raise InvalidCombatProfile("Duplicate module override.")
        seen.add((rack, index))
        if "state" in override:
            if override["state"] not in STATES:
                raise InvalidCombatProfile("Unknown module activation state.")
            rows[index]["state"] = override["state"]
        if "chargeTypeId" in override:
            charge = override["chargeTypeId"]
            if charge is not None and (type(charge) is not int or charge <= 0):
                raise InvalidCombatProfile("chargeTypeId must be a positive integer or null to unload.")
            rows[index].pop("charge_type_id", None)
            rows[index]["chargeTypeId"] = charge
    return payload, warnings, overrides


def combat_profile(request: dict) -> dict:
    warnings = []
    try:
        payload, warnings, overrides = prepare_request(request)
        target = payload.get("targetFit", payload)
        fit, fit_warnings, errors = build_fit(target)
        warnings.extend(fit_warnings)
        if fit is None or errors:
            return {"ok": False, "combatProfileSchemaVersion": SCHEMA_VERSION, "profile": None, "warnings": warnings, "errors": errors}
        crossfit = apply_cross_fit_links(fit, payload, warnings)
        stats = stats_from_fit(fit)
        normalized = fit_to_payload(fit)
        modules = sorted([serialize_module(mod, warnings, normalized["cargo"]) for mod in fit.modules if mod.item is not None and not mod.isEmpty],
                         key=lambda mod: (MODULE_SLOTS.index(mod["rack"]), mod["index"]))
        for override in overrides:
            row = next((mod for mod in modules if mod["rack"] == override["rack"] and mod["index"] == override["index"]), None)
            if row is None or ("state" in override and row["state"] != override["state"]) or ("chargeTypeId" in override and (row["charge"] or {}).get("typeId") != override["chargeTypeId"]):
                raise InvalidCombatProfile("Requested charge/state is not legal for the selected module.")
        unsupported = ["dynamic_heat", "target_dependent_application", "dynamic_drone_travel", "command_recipient_stacking", "nosferatu_target_condition"]
        if normalized.get("fighters"):
            unsupported.append("fighter_abilities")
            warnings.append({"code": "unsupported_fighters", "message": "Fighter ability profiles are not exported in schema 1."})
        if any(row.get("abyssalPlaceholder") or row.get("abyssal_placeholder") for rows in (target.get("modules") or {}).values() for row in rows):
            warnings.append({"code": "abyssal_placeholder", "message": "Unresolved abyssal placeholders are excluded from calculated combat attributes."})
        version = installed_version_info(include_latest=False)
        defense, nav, cap, targeting = (stats[key] for key in ("defense", "navigation", "capacitor", "targeting"))
        ship = fit.ship
        profile = {
            "combatProfileSchemaVersion": SCHEMA_VERSION,
            "engine": {"name": "Pyfa/eos", "source": "TriffFits fitting-service", "exporterVersion": EXPORTER_VERSION,
                       "pyfaVersion": version.get("installedPyfaVersion"), "pyfaRef": version.get("installedPyfaRef"),
                       "eosVersion": version.get("installedEosVersion")},
            "fitHash": digest(payload),
            "ship": {**identity(ship.item), "fitName": normalized["fitName"], "mode": identity(fit.mode.item) if fit.mode else None},
            "skills": {"profile": normalized.get("skillProfile") or {"mode": "all_v"},
                       "overrides": target.get("skillOverrides") or {},
                       "effectiveSkillsHash": digest({"profile": target.get("skillProfile") or {"mode": "all_v"}, "overrides": target.get("skillOverrides") or {}})},
            "defense": {key: {"hp": number(defense["hp"][key]),
                              "resists": {damage: number(defense["resists"][key][damage]) for damage in DAMAGE_TYPES}}
                        for key in ("shield", "armor", "hull")},
            "shieldRechargeTimeMs": attr(ship, "shieldRechargeRate"),
            "movement": {"signatureRadiusM": number(targeting["signatureRadius"]), "massKg": number(nav["mass"]),
                         "agility": number(nav["agility"]), "alignTimeSeconds": number(nav["alignTime"]),
                         "maxVelocityMps": number(nav["maxSpeed"]), "warpSpeedAuPerSecond": number(nav["warpSpeed"])},
            "targeting": {"scanResolutionMm": number(targeting["scanResolution"]), "maxRangeM": number(targeting["range"]),
                          "maxLockedTargets": number(targeting["maxTargets"]), "sensorStrength": number(targeting["sensorStrength"]),
                          "sensorType": targeting["sensorType"], "signatureRadiusM": number(targeting["signatureRadius"]),
                          "droneControlRangeM": number(targeting["droneControlRange"])},
            "capacitor": {"capacityGj": number(cap["capacityGj"]), "rechargeTimeMs": attr(ship, "rechargeRate"),
                          "neutralizerResistanceFraction": number(cap["neutralizerResistancePercent"] / 100)},
            "electronicResistances": fields(ship, {"sensorDampenerMultiplier": "sensorDampenerResistance",
                "weaponDisruptionMultiplier": "weaponDisruptionResistance", "targetPainterMultiplier": "targetPainterResistance",
                "stasisWebMultiplier": "stasisWebifierResistance", "remoteAssistanceMultiplier": "remoteAssistanceImpedance"}),
            "modules": modules, "drones": [serialize_drone(drone, index) for index, drone in enumerate(fit.drones)],
            "fighters": None,
            "cargo": normalized["cargo"],
            "heat": {"generationMultiplier": attr(ship, "heatGenerationMultiplier"),
                     "racks": {rack: {"capacity": attr(ship, f"heatCapacity{suffix}"),
                                      "dissipationRate": attr(ship, f"heatDissipationRate{suffix}"),
                                      "attenuation": attr(ship, f"heatAttenuation{suffix}")}
                               for rack, suffix in (("high", "Hi"), ("mid", "Med"), ("low", "Low"))}},
            "context": {"implants": normalized["implants"], "boosters": normalized["boosters"],
                        "environment": normalized.get("environment"), "crossFit": crossfit},
            "unsupportedMechanics": unsupported,
        }
        profile["profileId"] = digest(profile)
        return {"ok": True, "combatProfileSchemaVersion": SCHEMA_VERSION, "profile": profile, "warnings": warnings, "errors": []}
    except InvalidCombatProfile as exc:
        return {"ok": False, "combatProfileSchemaVersion": SCHEMA_VERSION, "profile": None, "warnings": warnings,
                "errors": [{"code": "invalid_combat_profile_request", "message": str(exc)}]}
