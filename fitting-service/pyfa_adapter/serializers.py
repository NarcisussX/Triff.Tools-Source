from __future__ import annotations

from typing import Any

from . import configure_pyfa
from .implants import booster_slot, implant_slot
from .mutations import mutation_payload

SLOT_BY_VALUE = {
    1: "low",
    2: "mid",
    3: "high",
    4: "rig",
    5: "subsystem",
    8: "service",
}

SLOT_VALUE_BY_NAME = {value: key for key, value in SLOT_BY_VALUE.items()}
MODULE_SLOTS = ("high", "mid", "low", "rig", "subsystem")


def safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def safe_total(value: Any) -> float:
    total = getattr(value, "total", None)
    if total is None:
        return safe_float(value) or 0.0
    return safe_float(total) or 0.0


def _display_number(value: Any, decimals: int = 1) -> str:
    number = safe_float(value)
    if number is None:
        return ""
    rounded = round(number, decimals)
    if abs(rounded) >= 100 or decimals == 0:
        return f"{rounded:,.0f}"
    text = f"{rounded:,.{decimals}f}"
    return text.rstrip("0").rstrip(".")


def _display_seconds(milliseconds: Any) -> str:
    seconds = (safe_float(milliseconds) or 0.0) / 1000.0
    if seconds <= 0:
        return ""
    return f"{_display_number(seconds, 1)}s"


def _display_km(meters: Any) -> str:
    km = (safe_float(meters) or 0.0) / 1000.0
    if km <= 0:
        return ""
    return f"{_display_number(km, 1)}km"


def _display_stat(value: str, tooltip: str = "", **raw: Any) -> dict[str, Any]:
    return {
        "value": value,
        "tooltip": tooltip,
        **raw,
    }


def item_summary(item: Any) -> dict[str, Any] | None:
    if item is None:
        return None
    return {
        "typeId": int(item.ID),
        "typeName": item.typeName,
        "groupId": int(item.groupID) if item.groupID is not None else None,
        "groupName": item.group.name if getattr(item, "group", None) else None,
        "categoryName": item.category.name if getattr(item, "category", None) else None,
    }


def _mode_label(mode_name: str, ship_name: str | None = None) -> str:
    label = mode_name or ""
    if ship_name and label.lower().startswith(ship_name.lower()):
        label = label[len(ship_name):].strip()
    if label.lower().endswith(" mode"):
        label = label[:-5].strip()
    return label or mode_name


def _ship_mode_option(mode: Any, ship_name: str | None = None) -> dict[str, Any] | None:
    item = getattr(mode, "item", None)
    if item is None:
        return None
    full_name = item.typeName
    return {
        "modeId": str(int(item.ID)),
        "typeId": int(item.ID),
        "label": _mode_label(full_name, ship_name),
        "fullName": full_name,
    }


def ship_modes_payload(fit: Any) -> dict[str, Any]:
    ship = getattr(fit, "ship", None)
    ship_name = getattr(getattr(ship, "item", None), "typeName", None)
    available = [
        option for option in (
            _ship_mode_option(mode, ship_name)
            for mode in (getattr(ship, "modes", None) or [])
        )
        if option is not None
    ]
    active = _ship_mode_option(getattr(fit, "mode", None), ship_name)
    return {
        "activeModeId": active["modeId"] if active else None,
        "activeModeTypeId": active["typeId"] if active else None,
        "available": available,
    }


def active_ship_mode_payload(fit: Any) -> dict[str, Any] | None:
    active = _ship_mode_option(getattr(fit, "mode", None), getattr(getattr(getattr(fit, "ship", None), "item", None), "typeName", None))
    if active is None:
        return None
    return {
        "modeId": active["modeId"],
        "typeId": active["typeId"],
        "modeName": active["fullName"],
        "label": active["label"],
        "fullName": active["fullName"],
    }


def classify_type(type_id: int) -> dict[str, Any]:
    configure_pyfa()
    import eos.db
    from eos.saveddata.booster import Booster
    from eos.saveddata.cargo import Cargo
    from eos.saveddata.drone import Drone
    from eos.saveddata.fighter import Fighter
    from eos.saveddata.implant import Implant
    from eos.saveddata.module import Module
    from eos.saveddata.ship import Ship

    item = eos.db.getItem(int(type_id), eager=("group.category", "effects", "attributes"))
    if item is None:
        raise ValueError(f"type_id {type_id} was not found in Pyfa game data")

    data = item_summary(item) or {}
    data["slot"] = None
    data["pyfaKind"] = None
    data["hardpoint"] = None
    data["hardpointName"] = None
    fits_to_ship_attr = item.attribsWithOverrides.get("fitsToShipType")
    data["fitsToShipTypeId"] = int(safe_float(getattr(fits_to_ship_attr, "value", None)) or 0) or None

    constructors = (
        ("ship", Ship),
        ("module", Module),
        ("drone", Drone),
        ("fighter", Fighter),
        ("implant", Implant),
        ("booster", Booster),
        ("cargo", Cargo),
    )
    for kind, ctor in constructors:
        try:
            obj = ctor(item)
        except Exception:
            continue
        data["pyfaKind"] = kind
        slot_value = getattr(obj, "slot", None)
        data["slot"] = SLOT_BY_VALUE.get(int(slot_value)) if slot_value is not None else None
        if kind == "implant":
            data["implantSlot"] = implant_slot(item)
        if kind == "booster":
            data["boosterSlot"] = booster_slot(item)
        if kind == "module":
            hardpoint = getattr(obj, "hardpoint", None)
            hardpoint_name = str(getattr(hardpoint, "name", hardpoint or "")).lower()
            if hardpoint_name == "turret":
                data["hardpoint"] = "turret"
                data["hardpointName"] = "Turret"
            elif hardpoint_name == "missile":
                data["hardpoint"] = "launcher"
                data["hardpointName"] = "Launcher"
            else:
                data["hardpoint"] = "none"
                data["hardpointName"] = None
        break

    return data


def module_to_payload(module: Any) -> dict[str, Any] | None:
    if getattr(module, "isEmpty", False) or getattr(module, "item", None) is None:
        return None
    mutation = mutation_payload(module, getattr(module, "triffMutationReference", None))
    source_item = module.baseItem if mutation else module.item
    payload = {
        "typeId": int(source_item.ID),
        "typeName": source_item.typeName,
        "state": getattr(getattr(module, "state", None), "name", str(getattr(module, "state", ""))).lower(),
    }
    instance_id = getattr(module, "triffInstanceId", None)
    if instance_id:
        payload["id"] = instance_id
    if mutation:
        payload["mutation"] = mutation
    charge = getattr(module, "charge", None)
    if charge is not None:
        payload["chargeTypeId"] = int(charge.ID)
        payload["chargeTypeName"] = charge.typeName
    spool_type = getattr(module, "spoolType", None)
    spool_amount = getattr(module, "spoolAmount", None)
    if spool_type is not None and spool_amount is not None:
        spool_type_name = getattr(spool_type, "name", str(spool_type)).lower()
        payload["spoolType"] = spool_type_name
        payload["spoolAmount"] = safe_float(spool_amount)
    return payload


def _max_spool_options() -> Any:
    try:
        from eos.const import SpoolType
        from eos.utils.spoolSupport import SpoolOptions

        return SpoolOptions(SpoolType.SPOOL_SCALE, 1, False)
    except Exception:
        return None


def _forced_spool_options(scale: float) -> Any:
    try:
        from eos.const import SpoolType
        from eos.utils.spoolSupport import SpoolOptions

        return SpoolOptions(SpoolType.SPOOL_SCALE, scale, True)
    except Exception:
        return None


def _module_spool_payload(module: Any) -> dict[str, Any] | None:
    group = getattr(getattr(module, "item", None), "group", None)
    group_name = getattr(group, "name", None)
    if group_name not in ("Precursor Weapon", "Mutadaptive Remote Armor Repairer"):
        return None

    try:
        cycle_min = int(module.getSpoolData(spoolOptions=_forced_spool_options(0))[0])
        cycle_max = int(module.getSpoolData(spoolOptions=_forced_spool_options(1))[0])
        cycle_current, time_current = module.getSpoolData(spoolOptions=_max_spool_options())
    except Exception:
        return None

    if cycle_max <= cycle_min:
        return None

    spool_type = getattr(module, "spoolType", None)
    spool_amount = getattr(module, "spoolAmount", None)
    return {
        "eligible": True,
        "groupName": group_name,
        "minCycles": cycle_min,
        "maxCycles": cycle_max,
        "currentCycles": int(cycle_current),
        "currentTimeSeconds": safe_float(time_current),
        "spoolType": getattr(spool_type, "name", str(spool_type)).lower() if spool_type is not None else None,
        "spoolAmount": safe_float(spool_amount),
    }


def _module_cycle_ms(module: Any) -> float | None:
    try:
        cycle = module.getCycleParameters()
    except Exception:
        cycle = None
    return safe_float(getattr(cycle, "averageTime", None)) if cycle is not None else None


def _module_cap_or_fuel_display(module: Any) -> dict[str, Any]:
    cap_need = safe_float(module.getModifiedItemAttr("capacitorNeed"))
    cycle_ms = _module_cycle_ms(module)
    fuel_quantity = safe_float(module.getModifiedItemAttr("consumptionQuantity"))
    fuel_type_id = safe_float(module.getModifiedItemAttr("consumptionType"))
    parts: list[str] = []
    tooltip_parts: list[str] = []

    if cap_need:
        cap = f"{'+' if cap_need < 0 else ''}{_display_number(abs(cap_need), 1)} GJ"
        cycle = _display_seconds(cycle_ms)
        parts.append(f"{cap} / {cycle}" if cycle else cap)
        tooltip_parts.append("Capacitor activation cost" if cap_need > 0 else "Capacitor gained per activation")

    if fuel_quantity:
        fuel_name = "fuel"
        if fuel_type_id:
            try:
                import eos.db

                fuel_item = eos.db.getItem(int(fuel_type_id))
                if fuel_item is not None:
                    fuel_name = fuel_item.typeName
            except Exception:
                fuel_name = "fuel"
        parts.append(f"{_display_number(fuel_quantity, 0)} {fuel_name}")
        tooltip_parts.append("Fuel consumed per activation")

    return _display_stat(" + ".join(parts), " / ".join(tooltip_parts), capacitorGj=cap_need, cycleMs=cycle_ms, fuelQuantity=fuel_quantity, fuelTypeId=fuel_type_id)


def _module_range_display(module: Any) -> dict[str, Any]:
    max_range = safe_float(getattr(module, "maxRange", None))
    falloff = safe_float(getattr(module, "falloff", None))
    hardpoint_name = getattr(getattr(module, "hardpoint", None), "name", "")

    if hardpoint_name == "MISSILE":
        return _display_stat(_display_km(max_range), "Missile range", missileRangeMeters=max_range)

    if max_range and falloff and falloff > 1:
        return _display_stat(f"{_display_km(max_range)} + {_display_km(falloff)}", "Optimal + falloff", optimalMeters=max_range, falloffMeters=falloff)
    if max_range:
        return _display_stat(_display_km(max_range), "Range", optimalMeters=max_range)
    if falloff and falloff > 1:
        return _display_stat(_display_km(falloff), "Falloff", falloffMeters=falloff)
    return _display_stat("")


def _module_repair_rate(module: Any, cycle_ms: float | None) -> tuple[float, str] | None:
    if not cycle_ms or cycle_ms <= 0:
        return None
    try:
        remote_reps = module.getRemoteReps()
    except Exception:
        remote_reps = None
    if remote_reps is not None:
        remote_total = sum(safe_float(getattr(remote_reps, key, 0.0)) or 0.0 for key in ("shield", "armor", "hull", "capacitor"))
        if remote_total:
            return remote_total, "Remote repair/transfer rate"

    repair_amount = max(
        safe_float(module.getModifiedItemAttr("armorDamageAmount")) or 0.0,
        safe_float(module.getModifiedItemAttr("shieldBonus")) or 0.0,
        safe_float(module.getModifiedItemAttr("structureDamageAmount")) or 0.0,
    )
    if repair_amount:
        return repair_amount / (cycle_ms / 1000.0), "Repair rate"
    return None


def _module_tracking_application_display(module: Any) -> dict[str, Any]:
    hardpoint_name = getattr(getattr(module, "hardpoint", None), "name", "")
    cycle_ms = _module_cycle_ms(module)

    if hardpoint_name == "TURRET":
        tracking = safe_float(module.getModifiedItemAttr("trackingSpeed"))
        return _display_stat(_display_number(tracking, 4), "Tracking", tracking=tracking)

    if hardpoint_name == "MISSILE":
        explosion_velocity = safe_float(module.getModifiedChargeAttr("aoeVelocity")) if getattr(module, "charge", None) else None
        explosion_radius = safe_float(module.getModifiedChargeAttr("aoeCloudSize")) if getattr(module, "charge", None) else None
        if explosion_velocity or explosion_radius:
            value = f"{_display_number(explosion_velocity, 1)}m/s / {_display_number(explosion_radius, 0)}m"
            return _display_stat(value, "Explosion velocity / Explosion radius", explosionVelocity=explosion_velocity, explosionRadius=explosion_radius)

    group_name = getattr(getattr(module, "item", None), "group", None).name if getattr(module, "item", None) and getattr(module.item, "group", None) else ""
    if group_name == "Energy Neutralizer" and cycle_ms and cycle_ms > 0:
        amount = safe_float(module.getModifiedItemAttr("energyNeutralizerAmount")) or 0.0
        rate = -(amount / (cycle_ms / 1000.0)) if amount else 0.0
        return _display_stat(f"{_display_number(rate, 1)}/s", "Neutralizer rate", ratePerSecond=rate)
    if group_name == "Energy Nosferatu" and cycle_ms and cycle_ms > 0:
        amount = safe_float(module.getModifiedItemAttr("powerTransferAmount")) or 0.0
        rate = amount / (cycle_ms / 1000.0) if amount else 0.0
        return _display_stat(f"+{_display_number(rate, 1)}/s", "Nosferatu rate", ratePerSecond=rate)

    repair_rate = _module_repair_rate(module, cycle_ms)
    if repair_rate:
        rate, tooltip = repair_rate
        return _display_stat(f"{_display_number(rate, 1)} HP/s", tooltip, ratePerSecond=rate)

    return _display_stat("")


def _module_row(module: Any, slot: str, index: int) -> dict[str, Any]:
    from eos.const import FittingModuleState

    charge = getattr(module, "charge", None)
    state = getattr(getattr(module, "state", None), "name", str(getattr(module, "state", ""))).lower()
    mutation = mutation_payload(module, getattr(module, "triffMutationReference", None))
    source_item = module.baseItem if mutation else module.item
    valid_states = [
        candidate.name.lower()
        for candidate in (
            FittingModuleState.OFFLINE,
            FittingModuleState.ONLINE,
            FittingModuleState.ACTIVE,
            FittingModuleState.OVERHEATED,
        )
        if module.isValidState(candidate)
    ]
    return {
        "slot": slot,
        "index": index,
        "typeId": int(source_item.ID),
        "name": mutation.get("displayName") if mutation else module.item.typeName,
        "baseName": source_item.typeName,
        "state": state,
        "validStates": valid_states,
        "canOverheat": "overheated" in valid_states,
        "spool": _module_spool_payload(module),
        "chargeTypeId": int(charge.ID) if charge is not None else None,
        "chargeName": charge.typeName if charge is not None else None,
        "cpu": safe_float(module.getModifiedItemAttr("cpu")) or 0.0,
        "powergrid": safe_float(module.getModifiedItemAttr("power")) or 0.0,
        "mutation": mutation,
        "displayStats": {
            "capOrFuel": _module_cap_or_fuel_display(module),
            "range": _module_range_display(module),
            "trackingOrApplication": _module_tracking_application_display(module),
        },
    }


def _module_rows(fit: Any) -> dict[str, list[dict[str, Any]]]:
    rows = {slot: [] for slot in MODULE_SLOTS}
    for module in fit.modules:
        if getattr(module, "isEmpty", False) or getattr(module, "item", None) is None:
            continue
        slot = SLOT_BY_VALUE.get(int(module.slot)) if module.slot is not None else None
        if slot in rows:
            rows[slot].append(_module_row(module, slot, len(rows[slot])))
    return rows


def fit_to_payload(fit: Any) -> dict[str, Any]:
    modules = {slot: [] for slot in MODULE_SLOTS}
    for module in fit.modules:
        entry = module_to_payload(module)
        if not entry:
            continue
        slot = SLOT_BY_VALUE.get(int(module.slot)) if module.slot is not None else None
        if slot in modules:
            modules[slot].append(entry)

    drones = []
    for drone in fit.drones:
        drones.append({
            "typeId": int(drone.item.ID),
            "typeName": drone.item.typeName,
            "quantity": int(drone.amount),
            "active": int(drone.amountActive),
        })

    fighters_by_type: dict[int, dict[str, Any]] = {}
    for fighter in fit.fighters:
        row = fighters_by_type.setdefault(int(fighter.item.ID), {
            "typeId": int(fighter.item.ID),
            "typeName": fighter.item.typeName,
            "quantity": 0,
            "active": 0,
        })
        row["quantity"] += 1
        if getattr(fighter, "active", False):
            row["active"] += 1
    fighters = list(fighters_by_type.values())

    cargo = []
    for item in fit.cargo:
        cargo.append({
            "typeId": int(item.item.ID),
            "typeName": item.item.typeName,
            "quantity": int(item.amount),
        })

    implants = [
        {
            "typeId": int(implant.item.ID),
            "typeName": implant.item.typeName,
            "quantity": 1,
            "enabled": True,
            "slot": implant_slot(implant.item),
            "implantSlot": implant_slot(implant.item),
        }
        for implant in fit.implants
    ]
    boosters = [
        {
            "typeId": int(booster.item.ID),
            "typeName": booster.item.typeName,
            "quantity": 1,
            "enabled": True,
            "slot": booster_slot(booster.item),
            "boosterSlot": booster_slot(booster.item),
        }
        for booster in fit.boosters
    ]
    projected_effects = []
    for module in getattr(fit, "projectedModules", []) or []:
        if getattr(module, "isEmpty", False) or getattr(module, "item", None) is None:
            continue
        raw = getattr(module, "triffProjectedEffect", None)
        if raw:
            projected_effects.append(raw)
        elif getattr(module.item, "group", None) and module.item.group.name in ("Effect Beacon", "MassiveEnvironments", "Abyssal Hazards", "Non-Interactable Object"):
            projected_effects.append({
                "kind": "environment",
                "effectId": str(int(module.item.ID)),
                "typeId": int(module.item.ID),
                "typeName": module.item.typeName,
                "label": module.item.typeName,
                "category": "environment",
                "categoryLabel": "Environment",
            })

    return {
        "shipTypeId": int(fit.ship.item.ID),
        "shipTypeName": fit.ship.item.typeName,
        "fitName": fit.name,
        "characterMode": "all_v",
        "shipMode": active_ship_mode_payload(fit),
        "damageProfile": _damage_profile(fit),
        "modules": modules,
        "drones": drones,
        "fighters": fighters,
        "cargo": cargo,
        "implants": implants,
        "boosters": boosters,
        "projectedEffects": projected_effects,
        "environment": {
            "wormholeEffect": None,
            "abyssalWeather": None,
        },
    }


def _attr(ship: Any, name: str, default: float = 0.0) -> float:
    value = ship.getModifiedItemAttr(name)
    return safe_float(value) if value is not None else default


def _extra_attr(fit: Any, name: str, default: float = 0.0) -> float:
    try:
        value = fit.extraAttributes[name]
    except Exception:
        value = default
    return safe_float(value) if value is not None else default


def _resist(ship: Any, attr_name: str) -> float:
    resonance = _attr(ship, attr_name, 1.0)
    return max(0.0, min(1.0, 1.0 - resonance))


def _resist_block(ship: Any, prefix: str) -> dict[str, float]:
    return {
        "em": _resist(ship, f"{prefix}EmDamageResonance"),
        "thermal": _resist(ship, f"{prefix}ThermalDamageResonance"),
        "kinetic": _resist(ship, f"{prefix}KineticDamageResonance"),
        "explosive": _resist(ship, f"{prefix}ExplosiveDamageResonance"),
    }


def _hull_resist_block(ship: Any) -> dict[str, float]:
    # eos/Pyfa expose structure resists through the unprefixed resonance attrs.
    return {
        "em": _resist(ship, "emDamageResonance"),
        "thermal": _resist(ship, "thermalDamageResonance"),
        "kinetic": _resist(ship, "kineticDamageResonance"),
        "explosive": _resist(ship, "explosiveDamageResonance"),
    }


def _hardpoint_stats(fit: Any, ship: Any) -> dict[str, dict[str, float | None]]:
    try:
        from eos.const import FittingHardpoint
    except Exception:
        return {
            "turret": {"used": None, "total": None, "free": None},
            "launcher": {"used": None, "total": None, "free": None},
        }

    def build(kind: Any, total_attr: str) -> dict[str, float | None]:
        total = _attr(ship, total_attr)
        used = safe_float(fit.getHardpointsUsed(kind)) or 0.0
        return {
            "used": used,
            "total": total,
            "free": total - used,
        }

    return {
        "turret": build(FittingHardpoint.TURRET, "turretSlotsLeft"),
        "launcher": build(FittingHardpoint.MISSILE, "launcherSlotsLeft"),
    }


def _tank_value(values: dict[str, Any], *keys: str) -> float:
    for key in keys:
        if key in values:
            return safe_float(values.get(key)) or 0.0
    return 0.0


def _recharge_rates(max_values: dict[str, Any], stable_values: dict[str, Any]) -> dict[str, Any]:
    rows = {
        "passiveShield": ("passiveShield",),
        "activeShield": ("shieldRepair",),
        "activeArmor": ("armorRepairFullSpool", "armorRepair"),
        "activeHull": ("hullRepair",),
    }
    out: dict[str, Any] = {}
    stable_total = 0.0
    max_total = 0.0
    for name, keys in rows.items():
        stable = _tank_value(stable_values, *keys)
        maximum = _tank_value(max_values, *keys)
        out[name] = {
            "stableEhpPerSecond": stable,
            "maxEhpPerSecond": maximum,
        }
        stable_total += stable
        max_total += maximum
    out["total"] = {
        "stableEhpPerSecond": stable_total,
        "maxEhpPerSecond": max_total,
    }
    return out


def _remote_reps(fit: Any) -> dict[str, float]:
    try:
        reps = fit.getRemoteReps()
    except Exception:
        reps = None
    shield = safe_float(getattr(reps, "shield", 0.0)) or 0.0
    armor = safe_float(getattr(reps, "armor", 0.0)) or 0.0
    hull = safe_float(getattr(reps, "hull", 0.0)) or 0.0
    capacitor = safe_float(getattr(reps, "capacitor", 0.0)) or 0.0
    return {
        "shield": shield,
        "armor": armor,
        "hull": hull,
        "capacitor": capacitor,
        "shieldHpPerSecond": shield,
        "armorHpPerSecond": armor,
        "hullHpPerSecond": hull,
        "capacitorGjPerSecond": capacitor,
    }


def _mining_yield(fit: Any) -> dict[str, Any]:
    miner_yield = safe_float(getattr(fit, "minerYield", 0.0)) or 0.0
    drone_yield = safe_float(getattr(fit, "droneYield", 0.0)) or 0.0
    total_yield = safe_float(getattr(fit, "totalYield", 0.0)) or 0.0
    miner_drain = safe_float(getattr(fit, "minerDrain", 0.0)) or 0.0
    drone_drain = safe_float(getattr(fit, "droneDrain", 0.0)) or 0.0
    total_drain = safe_float(getattr(fit, "totalDrain", 0.0)) or 0.0
    return {
        "minerYieldM3PerSecond": miner_yield,
        "droneYieldM3PerSecond": drone_yield,
        "totalYieldM3PerSecond": total_yield,
        "minerDrainM3PerSecond": miner_drain,
        "droneDrainM3PerSecond": drone_drain,
        "totalDrainM3PerSecond": total_drain,
        "unit": "m3/s",
    }


def _damage_profile(fit: Any) -> dict[str, Any]:
    pattern = getattr(fit, "damagePattern", None)
    if pattern is None:
        return {
            "profileId": None,
            "name": "Pyfa/eos default",
            "label": "Pyfa/eos default",
            "fullName": "Pyfa/eos default",
            "em": None,
            "thermal": None,
            "kinetic": None,
            "explosive": None,
            "source": "pyfa/eos",
        }
    profile_id = getattr(pattern, "ID", None)
    return {
        "profileId": str(profile_id) if profile_id is not None else None,
        "name": getattr(pattern, "name", None) or getattr(pattern, "shortName", None) or "Pyfa/eos default",
        "label": getattr(pattern, "shortName", None) or getattr(pattern, "name", None) or "Pyfa/eos default",
        "fullName": getattr(pattern, "fullName", None) or getattr(pattern, "name", None),
        "em": safe_float(getattr(pattern, "emAmount", None)),
        "thermal": safe_float(getattr(pattern, "thermalAmount", None)),
        "kinetic": safe_float(getattr(pattern, "kineticAmount", None)),
        "explosive": safe_float(getattr(pattern, "explosiveAmount", None)),
        "source": "pyfa/eos",
    }


def _local_tank(rates: dict[str, Any]) -> dict[str, Any]:
    return {
        "stable": {
            "passiveShieldEhpPerSecond": _tank_value(rates.get("passiveShield", {}), "stableEhpPerSecond"),
            "activeShieldEhpPerSecond": _tank_value(rates.get("activeShield", {}), "stableEhpPerSecond"),
            "activeArmorEhpPerSecond": _tank_value(rates.get("activeArmor", {}), "stableEhpPerSecond"),
            "activeHullEhpPerSecond": _tank_value(rates.get("activeHull", {}), "stableEhpPerSecond"),
            "totalEhpPerSecond": _tank_value(rates.get("total", {}), "stableEhpPerSecond"),
        },
        "max": {
            "passiveShieldEhpPerSecond": _tank_value(rates.get("passiveShield", {}), "maxEhpPerSecond"),
            "activeShieldEhpPerSecond": _tank_value(rates.get("activeShield", {}), "maxEhpPerSecond"),
            "activeArmorEhpPerSecond": _tank_value(rates.get("activeArmor", {}), "maxEhpPerSecond"),
            "activeHullEhpPerSecond": _tank_value(rates.get("activeHull", {}), "maxEhpPerSecond"),
            "totalEhpPerSecond": _tank_value(rates.get("total", {}), "maxEhpPerSecond"),
        },
    }


def _drone_rows(fit: Any) -> list[dict[str, Any]]:
    rows = []
    for drone in fit.drones:
        bandwidth = safe_float(drone.getModifiedItemAttr("droneBandwidthUsed"))
        if bandwidth is None:
            try:
                bandwidth = safe_float(drone.item.attribsWithOverrides["volume"].value)
            except Exception:
                bandwidth = 0.0
        active = int(getattr(drone, "amountActive", 0) or 0)
        rows.append({
            "typeId": int(drone.item.ID),
            "typeName": drone.item.typeName,
            "quantity": int(getattr(drone, "amount", 0) or 0),
            "active": active,
            "bandwidthPerDrone": bandwidth or 0.0,
            "bandwidthUsed": (bandwidth or 0.0) * active,
            "dps": safe_total(drone.getDps()),
            "volley": safe_total(drone.getVolley()),
        })
    return rows


def _fighter_rows(fit: Any) -> list[dict[str, Any]]:
    rows: dict[int, dict[str, Any]] = {}
    for fighter in fit.fighters:
        row = rows.setdefault(int(fighter.item.ID), {
            "typeId": int(fighter.item.ID),
            "typeName": fighter.item.typeName,
            "quantity": 0,
            "active": 0,
            "dps": 0.0,
            "volley": 0.0,
        })
        row["quantity"] += 1
        if getattr(fighter, "active", False):
            row["active"] += 1
        row["dps"] += safe_total(fighter.getDps())
        row["volley"] += safe_total(fighter.getVolley())
    return list(rows.values())


def _character_skill_level(character: Any, skill_item: Any) -> int:
    try:
        skill = character.getSkill(int(skill_item.ID))
    except Exception:
        return 0
    return int(safe_float(getattr(skill, "level", 0)) or 0)


def _required_skills_for_item(item: Any) -> list[dict[str, Any]]:
    if item is None:
        return []
    try:
        required = item.requiredSkills or {}
    except Exception:
        return []
    rows = []
    for skill_item, raw_required in required.items():
        required_level = int(safe_float(raw_required) or 0)
        if required_level <= 0:
            continue
        rows.append({
            "skillTypeId": int(skill_item.ID),
            "skillName": skill_item.typeName,
            "requiredLevel": required_level,
        })
    return rows


def _missing_skills_for_item(character: Any, item: Any) -> list[dict[str, Any]]:
    if item is None or character is None:
        return []
    try:
        required = item.requiredSkills or {}
    except Exception:
        return []

    missing: list[dict[str, Any]] = []
    for skill_item, raw_required in required.items():
        required_level = int(safe_float(raw_required) or 0)
        actual_level = _character_skill_level(character, skill_item)
        if required_level > actual_level:
            missing.append({
                "skillTypeId": int(skill_item.ID),
                "skillName": skill_item.typeName,
                "requiredLevel": required_level,
                "actualLevel": actual_level,
            })
    missing.sort(key=lambda row: (row["skillName"], row["requiredLevel"]))
    return missing


def _merge_missing_skills(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[int, dict[str, Any]] = {}
    for group in groups:
        for row in group:
            skill_type_id = int(row["skillTypeId"])
            existing = merged.get(skill_type_id)
            if existing is None or int(row["requiredLevel"]) > int(existing["requiredLevel"]):
                merged[skill_type_id] = dict(row)
            elif existing is not None:
                existing["actualLevel"] = min(int(existing["actualLevel"]), int(row["actualLevel"]))
    return sorted(merged.values(), key=lambda row: (row["skillName"], row["requiredLevel"]))


def _fit_required_skills(fit: Any) -> list[dict[str, Any]]:
    groups: list[list[dict[str, Any]]] = []
    groups.append(_required_skills_for_item(getattr(getattr(fit, "ship", None), "item", None)))

    for module in getattr(fit, "modules", []) or []:
        if getattr(module, "isEmpty", False) or getattr(module, "item", None) is None:
            continue
        mutation = mutation_payload(module, getattr(module, "triffMutationReference", None))
        groups.append(_required_skills_for_item(module.baseItem if mutation else module.item))
        groups.append(_required_skills_for_item(getattr(module, "charge", None)))

    for collection_name in ("drones", "fighters", "implants", "boosters"):
        for entry in getattr(fit, collection_name, []) or []:
            groups.append(_required_skills_for_item(getattr(entry, "item", None)))

    merged: dict[int, dict[str, Any]] = {}
    for group in groups:
        for row in group:
            skill_type_id = int(row["skillTypeId"])
            existing = merged.get(skill_type_id)
            if existing is None or int(row["requiredLevel"]) > int(existing["requiredLevel"]):
                merged[skill_type_id] = dict(row)
    return sorted(merged.values(), key=lambda row: (row["skillName"], row["requiredLevel"]))


def _skill_warning(scope: str, item: Any, missing: list[dict[str, Any]], **extra: Any) -> dict[str, Any] | None:
    if not missing or item is None:
        return None
    return {
        "code": "MISSING_SKILLS",
        "scope": scope,
        "itemTypeId": int(item.ID),
        "itemName": item.typeName,
        "missingSkills": missing,
        **extra,
    }


def _skill_warnings(fit: Any) -> list[dict[str, Any]]:
    character = getattr(fit, "character", None)
    if character is None:
        return []

    warnings: list[dict[str, Any]] = []
    ship_item = getattr(getattr(fit, "ship", None), "item", None)
    ship_warning = _skill_warning("ship", ship_item, _missing_skills_for_item(character, ship_item))
    if ship_warning:
        warnings.append(ship_warning)

    slot_indexes = {slot: 0 for slot in MODULE_SLOTS}
    for module in fit.modules:
        if getattr(module, "isEmpty", False) or getattr(module, "item", None) is None:
            continue
        slot = SLOT_BY_VALUE.get(int(module.slot)) if module.slot is not None else None
        index = slot_indexes.get(slot, 0)
        if slot in slot_indexes:
            slot_indexes[slot] += 1
        mutation = mutation_payload(module, getattr(module, "triffMutationReference", None))
        source_item = module.baseItem if mutation else module.item
        charge = getattr(module, "charge", None)
        missing = _merge_missing_skills(
            _missing_skills_for_item(character, source_item),
            _missing_skills_for_item(character, charge),
        )
        warning = _skill_warning(
            "module",
            source_item,
            missing,
            slot=slot,
            index=index,
            moduleInstanceId=getattr(module, "triffInstanceId", None) or (f"{slot}:{index}" if slot else None),
            chargeTypeId=int(charge.ID) if charge is not None else None,
            chargeName=charge.typeName if charge is not None else None,
        )
        if warning:
            warnings.append(warning)

    for scope, collection in (
        ("drone", getattr(fit, "drones", []) or []),
        ("fighter", getattr(fit, "fighters", []) or []),
        ("implant", getattr(fit, "implants", []) or []),
        ("booster", getattr(fit, "boosters", []) or []),
    ):
        seen: set[int] = set()
        for entry in collection:
            item = getattr(entry, "item", None)
            if item is None or int(item.ID) in seen:
                continue
            seen.add(int(item.ID))
            warning = _skill_warning(scope, item, _missing_skills_for_item(character, item))
            if warning:
                warnings.append(warning)

    return warnings


def _fit_warning_summary(skill_warnings: list[dict[str, Any]]) -> dict[str, Any]:
    missing_skill_count = sum(len(row.get("missingSkills") or []) for row in skill_warnings)
    return {
        "missingSkillCount": missing_skill_count,
        "affectedItemCount": len(skill_warnings),
    }


def _capacitor_stats(fit: Any, ship: Any) -> dict[str, Any]:
    cap_stable = bool(fit.capStable)
    cap_state = safe_float(fit.capState) or 0.0
    cap_delta = safe_float(fit.capDelta) or 0.0
    cap_capacity = _attr(ship, "capacitorCapacity")
    neut_resonance = _attr(ship, "energyWarfareResistance", 1.0)
    neut_resistance_percent = (1.0 - neut_resonance) * 100.0
    neut_resistance = neut_resistance_percent / 100.0
    # Pyfa displays effective excess gain as incoming neutralizer pressure that
    # the current positive capacitor delta can absorb after neut resistance.
    if cap_delta <= 0:
        effective_excess = 0.0
    elif neut_resistance <= 0:
        effective_excess = cap_delta
    elif neut_resistance < 1:
        effective_excess = cap_delta / (1.0 - neut_resistance)
    else:
        effective_excess = None
    return {
        "stable": cap_stable,
        "state": cap_state,
        "stateUnit": "percent" if cap_stable else "seconds",
        "used": safe_float(fit.capUsed) or 0.0,
        "recharge": safe_float(fit.capRecharge) or 0.0,
        "delta": cap_delta,
        "capacity": cap_capacity,
        "rechargeTime": _attr(ship, "rechargeRate") / 1000.0,
        "lastsSeconds": None if cap_stable else cap_state,
        "stablePercent": cap_state if cap_stable else None,
        "deltaGjPerSecond": cap_delta,
        "capacityGj": cap_capacity,
        "neutralizerResistancePercent": neut_resistance_percent,
        "effectiveExcessGainGjPerSecond": effective_excess,
    }


def stats_from_fit(fit: Any) -> dict[str, Any]:
    ship = fit.ship
    skill_warnings = _skill_warnings(fit)
    hp = {key: safe_float(value) or 0.0 for key, value in fit.hp.items()}
    ehp_layers = {key: safe_float(value) or 0.0 for key, value in fit.ehp.items()}
    tank = {key: safe_float(value) or 0.0 for key, value in fit.tank.items()}
    effective_tank = {key: safe_float(value) or 0.0 for key, value in fit.effectiveTank.items()}
    effective_sustainable_tank = {
        key: safe_float(value) or 0.0
        for key, value in fit.effectiveSustainableTank.items()
    }
    recharge_rates = _recharge_rates(effective_tank, effective_sustainable_tank)
    spool_options = _max_spool_options()

    slots = {}
    for slot_name in MODULE_SLOTS:
        slot_value = SLOT_VALUE_BY_NAME[slot_name]
        total = safe_float(fit.getNumSlots(slot_value)) or 0.0
        used = safe_float(fit.getSlotsUsed(slot_value)) or 0.0
        slots[slot_name] = {
            "used": used,
            "total": total,
            "free": total - used,
        }

    return {
        "ship": item_summary(ship.item),
        "shipModes": ship_modes_payload(fit),
        "character": getattr(fit, "triffSkillProfile", None) or "all_v",
        "resources": {
            "cpu": {
                "used": safe_float(fit.cpuUsed) or 0.0,
                "output": _attr(ship, "cpuOutput"),
            },
            "powergrid": {
                "used": safe_float(fit.pgUsed) or 0.0,
                "output": _attr(ship, "powerOutput"),
            },
            "calibration": {
                "used": safe_float(fit.calibrationUsed) or 0.0,
                "output": _attr(ship, "upgradeCapacity"),
            },
        },
        "slots": slots,
        "hardpoints": _hardpoint_stats(fit, ship),
        "moduleRows": _module_rows(fit),
        "requiredSkills": _fit_required_skills(fit),
        "skillWarnings": skill_warnings,
        "fitWarningSummary": _fit_warning_summary(skill_warnings),
        "defense": {
            "hp": hp,
            "rawHp": {
                **hp,
                "total": sum(hp.values()),
            },
            "ehp": {
                **ehp_layers,
                "total": sum(ehp_layers.values()),
            },
            "resists": {
                "shield": _resist_block(ship, "shield"),
                "armor": _resist_block(ship, "armor"),
                "hull": _hull_resist_block(ship),
            },
            "tank": tank,
            "effectiveTank": effective_tank,
        },
        "damageProfile": _damage_profile(fit),
        "rechargeRates": recharge_rates,
        "localTank": _local_tank(recharge_rates),
        "remoteReps": _remote_reps(fit),
        "mining": _mining_yield(fit),
        "price": None,
        "capacitor": _capacitor_stats(fit, ship),
        "firepower": {
            "dps": safe_total(fit.getTotalDps(spoolOptions=spool_options)),
            "weaponDps": safe_total(fit.getWeaponDps(spoolOptions=spool_options)),
            "droneDps": safe_total(fit.getDroneDps()),
            "volley": safe_total(fit.getTotalVolley(spoolOptions=spool_options)),
            "weaponVolley": safe_total(fit.getWeaponVolley(spoolOptions=spool_options)),
            "droneVolley": safe_total(fit.getDroneVolley()),
        },
        "targeting": {
            "maxTargets": safe_float(fit.maxTargets) or 0.0,
            "range": safe_float(fit.maxTargetRange) or 0.0,
            "scanResolution": _attr(ship, "scanResolution"),
            "sensorStrength": safe_float(fit.scanStrength) or 0.0,
            "sensorType": fit.scanType,
            "signatureRadius": _attr(ship, "signatureRadius"),
            "droneControlRange": _extra_attr(fit, "droneControlRange"),
            "cargoCapacity": _attr(ship, "capacity"),
            "cargoUsed": safe_float(getattr(fit, "cargoBayUsed", 0.0)) or 0.0,
        },
        "navigation": {
            "maxSpeed": safe_float(fit.maxSpeed) or 0.0,
            "alignTime": safe_float(fit.alignTime) or 0.0,
            "mass": _attr(ship, "mass"),
            "agility": _attr(ship, "agility"),
            "warpSpeed": safe_float(fit.warpSpeed) or 0.0,
        },
        "drones": {
            "active": safe_float(fit.activeDrones) or 0.0,
            "bandwidthUsed": safe_float(fit.droneBandwidthUsed) or 0.0,
            "bandwidthTotal": _attr(ship, "droneBandwidth"),
            "bayUsed": safe_float(fit.droneBayUsed) or 0.0,
            "bayTotal": _attr(ship, "droneCapacity"),
        },
        "droneRows": _drone_rows(fit),
        "fighters": {
            "active": safe_float(fit.fighterTubesUsed) or 0.0,
            "tubesUsed": safe_float(fit.fighterTubesUsed) or 0.0,
            "tubesTotal": safe_float(fit.fighterTubesTotal) or 0.0,
            "bayUsed": safe_float(fit.fighterBayUsed) or 0.0,
            "bayTotal": _attr(ship, "fighterCapacity"),
        },
        "fighterRows": _fighter_rows(fit),
    }
