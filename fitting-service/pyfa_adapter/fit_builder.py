from __future__ import annotations

from typing import Any

from . import configure_pyfa
from .implants import booster_slot, implant_slot
from .character import character_from_skill_profile
from .mutations import build_mutated_module
from .serializers import MODULE_SLOTS, SLOT_VALUE_BY_NAME, safe_float


MAX_ACTIVE_DRONES = 5


def _module_state(mod: Any, requested: str | None, previous: str | None = None):
    from eos.const import FittingModuleState

    normalized = (requested or "active").lower()

    if normalized == "offline" and mod.isValidState(FittingModuleState.OFFLINE):
        return FittingModuleState.OFFLINE
    if normalized == "online" and mod.isValidState(FittingModuleState.ONLINE):
        return FittingModuleState.ONLINE
    if normalized == "overheated" and mod.isValidState(FittingModuleState.OVERHEATED):
        return FittingModuleState.OVERHEATED
    if mod.isValidState(FittingModuleState.ACTIVE):
        return FittingModuleState.ACTIVE
    if mod.isValidState(FittingModuleState.ONLINE):
        return FittingModuleState.ONLINE
    if mod.isValidState(FittingModuleState.OFFLINE):
        return FittingModuleState.OFFLINE
    return mod.state


def _spool_type_from_payload(raw: Any):
    from eos.const import SpoolType

    if raw is None:
        return None
    if isinstance(raw, SpoolType):
        return raw
    if isinstance(raw, int):
        try:
            return SpoolType(raw)
        except ValueError:
            return None
    normalized = str(raw).strip().lower()
    if normalized in ("cycles", "cycle", "spool_cycles"):
        return SpoolType.CYCLES
    if normalized in ("spool_scale", "spoolscale", "scale"):
        return SpoolType.SPOOL_SCALE
    if normalized in ("cycle_scale", "cyclescale"):
        return SpoolType.CYCLE_SCALE
    if normalized == "time":
        return SpoolType.TIME
    try:
        return SpoolType(int(normalized))
    except (TypeError, ValueError):
        return None


def _apply_module_spool(mod: Any, raw_module: dict[str, Any]) -> None:
    spool = raw_module.get("spool") if isinstance(raw_module.get("spool"), dict) else {}
    raw_amount = raw_module.get("spoolAmount", spool.get("spoolAmount") if spool else None)
    if raw_amount is None:
        return
    spool_type = _spool_type_from_payload(raw_module.get("spoolType", spool.get("spoolType") if spool else None))
    if spool_type is None:
        from eos.const import SpoolType

        spool_type = SpoolType.CYCLES
    try:
        mod.spoolAmount = int(raw_amount) if spool_type.name == "CYCLES" else float(raw_amount)
        mod.spoolType = spool_type
    except (TypeError, ValueError):
        return


def _drone_bandwidth(drone: Any) -> float:
    bandwidth = safe_float(drone.getModifiedItemAttr("droneBandwidthUsed"))
    if bandwidth is not None:
        return bandwidth
    try:
        return safe_float(drone.item.attribsWithOverrides["volume"].value) or 0.0
    except Exception:
        return 0.0


def _apply_drone_active_limits(fit: Any, drone_requests: list[tuple[Any, int, bool]], warnings: list[dict[str, Any]]) -> None:
    remaining_count = MAX_ACTIVE_DRONES
    remaining_bandwidth = safe_float(fit.ship.getModifiedItemAttr("droneBandwidth")) or 0.0

    for drone, requested, explicit in drone_requests:
        desired = max(0, min(int(getattr(drone, "amount", 0) or 0), int(requested)))
        bandwidth = _drone_bandwidth(drone)
        bandwidth_limit = desired if bandwidth <= 0 else int(remaining_bandwidth // bandwidth)
        active = max(0, min(desired, remaining_count, bandwidth_limit))
        drone.amountActive = active
        remaining_count -= active
        remaining_bandwidth -= bandwidth * active
        if explicit and active < desired:
            warnings.append({
                "code": "drone_active_clamped",
                "message": f"{drone.item.typeName} active drones clamped to {active} by active drone or bandwidth limits.",
            })


def _apply_fighter_active_limits(fit: Any, fighter_requests: list[tuple[Any, bool]], warnings: list[dict[str, Any]]) -> None:
    remaining_tubes = int(safe_float(fit.fighterTubesTotal) or 0)
    remaining_by_slot: dict[int, int] = {}

    for fighter, requested in fighter_requests:
        slot = int(fighter.slot) if fighter.slot is not None else 0
        if slot not in remaining_by_slot:
            try:
                remaining_by_slot[slot] = int(safe_float(fit.getNumSlots(fighter.slot)) or 0)
            except Exception:
                remaining_by_slot[slot] = remaining_tubes
        can_activate = requested and remaining_tubes > 0 and remaining_by_slot.get(slot, 0) > 0
        fighter.active = bool(can_activate)
        if can_activate:
            remaining_tubes -= 1
            remaining_by_slot[slot] = remaining_by_slot.get(slot, 0) - 1
        elif requested:
            warnings.append({
                "code": "fighter_active_clamped",
                "message": f"{fighter.item.typeName} fighter squadron was deactivated by fighter tube or slot limits.",
            })


def _slot_capacity_errors(fit: Any) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    for slot_name in MODULE_SLOTS:
        total = safe_float(fit.getNumSlots(SLOT_VALUE_BY_NAME[slot_name])) or 0.0
        used = safe_float(fit.getSlotsUsed(SLOT_VALUE_BY_NAME[slot_name])) or 0.0
        if used > total:
            errors.append({
                "code": "slot_over",
                "message": f"{slot_name.title()} slots over limit: {used:.0f} / {total:.0f}. Remove extra fitted modules before calculating.",
            })
    return errors


def _hardpoint_capacity_errors(fit: Any) -> list[dict[str, Any]]:
    try:
        from eos.const import FittingHardpoint
    except Exception:
        return []

    errors: list[dict[str, Any]] = []

    checks = (
        (
            "turret",
            "Turret hardpoint limit exceeded",
            FittingHardpoint.TURRET,
            "turretSlotsLeft",
            "turretHardpointsUsed",
            "turretHardpointsMax",
        ),
        (
            "launcher",
            "Launcher hardpoint limit exceeded",
            FittingHardpoint.MISSILE,
            "launcherSlotsLeft",
            "launcherHardpointsUsed",
            "launcherHardpointsMax",
        ),
    )
    for kind, message, hardpoint, total_attr, used_key, max_key in checks:
        used = safe_float(fit.getHardpointsUsed(hardpoint)) or 0.0
        total = safe_float(fit.ship.getModifiedItemAttr(total_attr)) or 0.0
        if used > total:
            errors.append({
                "code": "HARDPOINT_LIMIT_EXCEEDED",
                "message": f"{message}: {used:.0f} / {total:.0f}.",
                "details": {
                    "kind": kind,
                    used_key: used,
                    max_key: total,
                },
            })
    return errors


def _calculate_modified_attributes(fit: Any) -> list[dict[str, Any]]:
    try:
        fit.calculateModifiedAttributes()
        return []
    except Exception as exc:
        return [{"code": "calculation_failed", "message": str(exc)}]


def _requested_ship_mode_id(payload: dict[str, Any]) -> int | None:
    raw = payload.get("shipMode")
    if isinstance(raw, dict):
        raw = raw.get("typeId") or raw.get("modeId") or raw.get("activeModeId")
    elif raw is None:
        raw = payload.get("shipModeId") or payload.get("modeId")
    try:
        mode_id = int(str(raw))
        return mode_id if mode_id > 0 else None
    except (TypeError, ValueError):
        return None


def _apply_ship_mode(fit: Any, payload: dict[str, Any], eos_db: Any, warnings: list[dict[str, Any]]) -> None:
    requested_mode_id = _requested_ship_mode_id(payload)
    available_items = getattr(getattr(fit, "ship", None), "modeItems", None) or []

    if not available_items:
        if requested_mode_id:
            warnings.append({
                "code": "ship_mode_ignored",
                "message": "This hull does not support selectable ship modes.",
            })
        fit.mode = fit.ship.validateModeItem(None, owner=fit)
        return

    if not requested_mode_id:
        fit.mode = fit.ship.validateModeItem(None, owner=fit)
        return

    valid_mode_ids = {int(item.ID) for item in available_items if getattr(item, "ID", None) is not None}
    mode_item = eos_db.getItem(int(requested_mode_id), eager=("group.category", "effects", "attributes"))
    if mode_item is None or int(mode_item.ID) not in valid_mode_ids:
        fit.mode = fit.ship.validateModeItem(None, owner=fit)
        warnings.append({
            "code": "ship_mode_invalid",
            "message": "Selected ship mode is not valid for this hull; using the default mode.",
            "details": {
                "requestedModeId": requested_mode_id,
                "activeModeId": int(fit.mode.item.ID) if fit.mode is not None else None,
            },
        })
        return

    fit.mode = fit.ship.validateModeItem(mode_item, owner=fit)


def _requested_damage_profile_id(payload: dict[str, Any]) -> int | None:
    raw = payload.get("damageProfile")
    if isinstance(raw, dict):
        raw = raw.get("profileId") or raw.get("id") or raw.get("damageProfileId")
    elif raw is None:
        raw = payload.get("damageProfileId")
    try:
        return int(str(raw))
    except (TypeError, ValueError):
        return None


def _apply_damage_profile(fit: Any, payload: dict[str, Any], warnings: list[dict[str, Any]]) -> None:
    requested_profile_id = _requested_damage_profile_id(payload)
    if requested_profile_id is None:
        return

    from eos.saveddata.damagePattern import DamagePattern

    pattern = DamagePattern.getBuiltinById(requested_profile_id)
    if pattern is None:
        default = DamagePattern.getDefaultBuiltin()
        if default is not None:
            fit.damagePattern = default
        warnings.append({
            "code": "damage_profile_invalid",
            "message": "Selected damage profile is not valid; using the default damage profile.",
            "details": {
                "requestedProfileId": requested_profile_id,
                "activeProfileId": getattr(default, "ID", None) if default is not None else None,
            },
        })
        return

    fit.damagePattern = pattern


def _invalid_subsystem_errors(fit: Any) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    subsystem_slot = SLOT_VALUE_BY_NAME["subsystem"]
    for module in fit.modules:
        if getattr(module, "isEmpty", False) or getattr(module, "item", None) is None:
            continue
        if module.slot is None or int(module.slot) != subsystem_slot:
            continue
        try:
            valid = module.fits(fit)
        except Exception as exc:
            errors.append({
                "code": "INVALID_SUBSYSTEM",
                "message": f"{module.item.typeName} could not be validated for this hull: {exc}",
                "details": {
                    "typeId": int(module.item.ID),
                    "typeName": module.item.typeName,
                },
            })
            continue
        if not valid:
            errors.append({
                "code": "INVALID_SUBSYSTEM",
                "message": f"{module.item.typeName} does not fit this hull or subsystem configuration.",
                "details": {
                    "typeId": int(module.item.ID),
                    "typeName": module.item.typeName,
                },
            })
    return errors


def _unique_character_slot_errors(fit: Any) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    for kind, items, slot_fn, code in (
        ("implant", getattr(fit, "implants", []) or [], implant_slot, "DUPLICATE_IMPLANT_SLOT"),
        ("booster", getattr(fit, "boosters", []) or [], booster_slot, "DUPLICATE_BOOSTER_SLOT"),
    ):
        occupied: dict[int, str] = {}
        for entry in items:
            item = getattr(entry, "item", None)
            if item is None:
                continue
            slot = slot_fn(item)
            if slot is None:
                continue
            if slot in occupied:
                errors.append({
                    "code": code,
                    "message": f"{kind.title()} slot {slot} is already occupied by {occupied[slot]}; cannot also fit {item.typeName}.",
                    "details": {
                        "kind": kind,
                        "slot": slot,
                        "existing": occupied[slot],
                        "duplicate": item.typeName,
                    },
                })
            else:
                occupied[slot] = item.typeName
    return errors


def _payload_character_slot_errors(payload: dict[str, Any], eos_db: Any) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    for key, kind, slot_fn, code in (
        ("implants", "implant", implant_slot, "DUPLICATE_IMPLANT_SLOT"),
        ("boosters", "booster", booster_slot, "DUPLICATE_BOOSTER_SLOT"),
    ):
        occupied: dict[int, str] = {}
        for raw_entry in payload.get(key) or []:
            if raw_entry.get("enabled") is False:
                continue
            type_id = raw_entry.get("typeId") or raw_entry.get("type_id")
            if not type_id:
                continue
            item = eos_db.getItem(int(type_id), eager=("group.category", "effects", "attributes"))
            if item is None:
                continue
            slot = slot_fn(item)
            if slot is None:
                continue
            if slot in occupied:
                errors.append({
                    "code": code,
                    "message": f"{kind.title()} slot {slot} is already occupied by {occupied[slot]}; cannot also fit {item.typeName}.",
                    "details": {
                        "kind": kind,
                        "slot": slot,
                        "existing": occupied[slot],
                        "duplicate": item.typeName,
                    },
                })
            else:
                occupied[slot] = item.typeName
    return errors


def build_fit(payload: dict[str, Any]) -> tuple[Any | None, list[dict[str, Any]], list[dict[str, Any]]]:
    configure_pyfa()
    import eos.db
    from eos.saveddata.booster import Booster
    from eos.saveddata.cargo import Cargo
    from eos.saveddata.drone import Drone
    from eos.saveddata.fighter import Fighter
    from eos.saveddata.fit import Fit
    from eos.saveddata.implant import Implant
    from eos.saveddata.module import Module
    from eos.saveddata.ship import Ship

    warnings: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    ship_type_id = payload.get("shipTypeId")
    if not ship_type_id:
        return None, warnings, [{"code": "missing_ship", "message": "Select a ship hull before calculating."}]

    ship_item = eos.db.getItem(int(ship_type_id), eager=("group.category", "effects", "attributes"))
    if ship_item is None:
        return None, warnings, [{"code": "unknown_ship", "message": f"Ship typeID {ship_type_id} was not found."}]

    try:
        fit = Fit(Ship(ship_item), payload.get("fitName") or ship_item.typeName)
    except Exception as exc:
        return None, warnings, [{"code": "invalid_ship", "message": str(exc)}]

    errors.extend(_payload_character_slot_errors(payload, eos.db))
    if errors:
        return fit, warnings, errors

    skill_profile = payload.get("skillProfile") or {"mode": "all_v"}
    fit.character = character_from_skill_profile(skill_profile, payload.get("skillOverrides"))
    public_skill_profile = {
        key: value for key, value in skill_profile.items()
        if key != "skills"
    }
    setattr(fit, "triffSkillProfile", public_skill_profile or {"mode": "all_v"})
    _apply_ship_mode(fit, payload, eos.db, warnings)
    _apply_damage_profile(fit, payload, warnings)

    modules_by_slot = payload.get("modules") or {}
    ordered_slots = ("subsystem", "low", "mid", "high", "rig")

    for slot_name in ordered_slots:
        for slot_index, raw_module in enumerate(modules_by_slot.get(slot_name) or []):
            type_id = raw_module.get("typeId") or raw_module.get("type_id")
            if not type_id:
                continue
            if raw_module.get("abyssalPlaceholder") or raw_module.get("abyssal_placeholder"):
                continue
            item = eos.db.getItem(int(type_id), eager=("group.category", "effects", "attributes"))
            if item is None:
                warnings.append({"code": "unknown_module", "message": f"Module typeID {type_id} was not found."})
                continue
            mutation = raw_module.get("mutation")
            if mutation:
                mod = build_mutated_module(item, mutation, warnings)
                if mod is None:
                    warnings.append({"code": "mutation_ignored", "message": f"{item.typeName} was fitted without its mutation data."})
            else:
                mod = None

            if mod is None:
                try:
                    mod = Module(item)
                except Exception as exc:
                    warnings.append({"code": "not_module", "message": f"{item.typeName} is not a fittable module: {exc}"})
                    continue

            mod.owner = fit
            instance_id = raw_module.get("id") or raw_module.get("instanceId") or raw_module.get("instance_id")
            if instance_id:
                setattr(mod, "triffInstanceId", str(instance_id))
            setattr(mod, "triffSlotName", slot_name)
            setattr(mod, "triffSlotIndex", slot_index)
            if mutation and mutation.get("reference") is not None:
                setattr(mod, "triffMutationReference", int(mutation.get("reference")))
            mod.state = _module_state(mod, raw_module.get("state"), raw_module.get("previousState"))
            _apply_module_spool(mod, raw_module)

            actual_slot_name = None
            if mod.slot is not None:
                for name, value in SLOT_VALUE_BY_NAME.items():
                    if value == int(mod.slot):
                        actual_slot_name = name
                        break
            if actual_slot_name and actual_slot_name != slot_name:
                warnings.append({
                    "code": "slot_mismatch",
                    "message": f"{item.typeName} is a {actual_slot_name} slot module, not {slot_name}.",
                })

            charge_type_id = raw_module.get("chargeTypeId") or raw_module.get("charge_type_id")
            if charge_type_id:
                charge = eos.db.getItem(int(charge_type_id), eager=("group.category", "attributes"))
                if charge is None:
                    warnings.append({"code": "unknown_charge", "message": f"Charge typeID {charge_type_id} was not found."})
                elif mod.isValidCharge(charge):
                    mod.charge = charge
                else:
                    warnings.append({
                        "code": "invalid_charge",
                        "message": f"{charge.typeName} cannot be loaded into {item.typeName}.",
                    })

            fit.modules.append(mod)

    # T3C high/mid/low slots and hardpoints are supplied by subsystem effects.
    # Calculate those module-provided attributes before enforcing capacity.
    errors.extend(_calculate_modified_attributes(fit))
    errors.extend(_invalid_subsystem_errors(fit))
    errors.extend(_slot_capacity_errors(fit))
    errors.extend(_hardpoint_capacity_errors(fit))
    if errors:
        return fit, warnings, errors

    drone_requests: list[tuple[Any, int, bool]] = []
    for raw_drone in payload.get("drones") or []:
        type_id = raw_drone.get("typeId") or raw_drone.get("type_id")
        if not type_id:
            continue
        item = eos.db.getItem(int(type_id), eager=("group.category", "effects", "attributes"))
        if item is None:
            warnings.append({"code": "unknown_drone", "message": f"Drone typeID {type_id} was not found."})
            continue
        try:
            drone = Drone(item)
        except Exception as exc:
            warnings.append({"code": "not_drone", "message": f"{item.typeName} is not a drone: {exc}"})
            continue
        quantity = max(1, int(raw_drone.get("quantity") or raw_drone.get("amount") or 1))
        drone.owner = fit
        drone.amount = quantity
        requested_active = raw_drone.get("active")
        explicit_active = requested_active is not None
        if requested_active is None:
            requested_active = quantity
        drone.amountActive = 0
        fit.drones.append(drone)
        drone_requests.append((drone, int(requested_active), explicit_active))

    _apply_drone_active_limits(fit, drone_requests, warnings)

    fighter_requests: list[tuple[Any, bool]] = []
    for raw_fighter in payload.get("fighters") or []:
        type_id = raw_fighter.get("typeId") or raw_fighter.get("type_id")
        if not type_id:
            continue
        item = eos.db.getItem(int(type_id), eager=("group.category", "effects", "attributes"))
        if item is None:
            warnings.append({"code": "unknown_fighter", "message": f"Fighter typeID {type_id} was not found."})
            continue
        try:
            quantity = max(1, int(raw_fighter.get("quantity") or raw_fighter.get("amount") or 1))
            requested_active = raw_fighter.get("active")
            if requested_active is None:
                requested_active = quantity
            requested_active = max(0, min(quantity, int(requested_active)))
            for index in range(quantity):
                fighter = Fighter(item)
                fighter.owner = fit
                fighter.active = False
                fit.fighters.append(fighter)
                fighter_requests.append((fighter, index < requested_active))
        except Exception as exc:
            warnings.append({"code": "not_fighter", "message": f"{item.typeName} is not a fighter: {exc}"})
            continue

    _apply_fighter_active_limits(fit, fighter_requests, warnings)

    for raw_implant in payload.get("implants") or []:
        if raw_implant.get("enabled") is False:
            continue
        type_id = raw_implant.get("typeId") or raw_implant.get("type_id")
        if not type_id:
            continue
        item = eos.db.getItem(int(type_id), eager=("group.category", "effects", "attributes"))
        if item is None:
            warnings.append({"code": "unknown_implant", "message": f"Implant typeID {type_id} was not found."})
            continue
        try:
            implant = Implant(item)
        except Exception as exc:
            warnings.append({"code": "not_implant", "message": f"{item.typeName} is not an implant: {exc}"})
            continue
        fit.implants.append(implant)

    for raw_booster in payload.get("boosters") or []:
        if raw_booster.get("enabled") is False:
            continue
        type_id = raw_booster.get("typeId") or raw_booster.get("type_id")
        if not type_id:
            continue
        item = eos.db.getItem(int(type_id), eager=("group.category", "effects", "attributes"))
        if item is None:
            warnings.append({"code": "unknown_booster", "message": f"Booster typeID {type_id} was not found."})
            continue
        try:
            booster = Booster(item)
        except Exception as exc:
            warnings.append({"code": "not_booster", "message": f"{item.typeName} is not a booster: {exc}"})
            continue
        fit.boosters.append(booster)

    errors.extend(_unique_character_slot_errors(fit))
    if errors:
        return fit, warnings, errors

    for raw_cargo in payload.get("cargo") or []:
        type_id = raw_cargo.get("typeId") or raw_cargo.get("type_id")
        if not type_id:
            continue
        item = eos.db.getItem(int(type_id), eager=("group.category", "attributes"))
        if item is None:
            warnings.append({"code": "unknown_cargo", "message": f"Cargo typeID {type_id} was not found."})
            continue
        cargo = Cargo(item)
        cargo.amount = max(1, int(raw_cargo.get("quantity") or raw_cargo.get("amount") or 1))
        cargo.owner = fit
        fit.cargo.append(cargo)

    for raw_effect in payload.get("projectedEffects") or []:
        if (raw_effect or {}).get("kind") not in (None, "environment"):
            continue
        type_id = raw_effect.get("typeId") or raw_effect.get("effectId")
        if not type_id:
            continue
        item = eos.db.getItem(int(type_id), eager=("group.category", "effects", "attributes"))
        if item is None:
            warnings.append({"code": "unknown_projected_effect", "message": f"Projected effect typeID {type_id} was not found."})
            continue
        try:
            effect_mod = Module(item)
        except Exception as exc:
            warnings.append({"code": "not_projected_effect", "message": f"{item.typeName} is not a projectable environment effect: {exc}"})
            continue
        effect_mod.owner = fit
        effect_mod.state = _module_state(effect_mod, raw_effect.get("state") or "active", None)
        setattr(effect_mod, "triffProjectedEffect", {
            "kind": "environment",
            "effectId": str(int(item.ID)),
            "typeId": int(item.ID),
            "typeName": item.typeName,
            "label": raw_effect.get("label") or item.typeName,
            "category": raw_effect.get("category") or "environment",
            "categoryLabel": raw_effect.get("categoryLabel") or raw_effect.get("category") or "Environment",
        })
        fit.projectedModules.append(effect_mod)

    errors.extend(_calculate_modified_attributes(fit))

    if not errors:
        _add_fit_warnings(fit, warnings)

    return fit, warnings, errors


def _add_fit_warnings(fit: Any, warnings: list[dict[str, Any]]) -> None:
    cpu_output = fit.ship.getModifiedItemAttr("cpuOutput") or 0
    pg_output = fit.ship.getModifiedItemAttr("powerOutput") or 0
    calibration_output = fit.ship.getModifiedItemAttr("upgradeCapacity") or 0

    if fit.cpuUsed > cpu_output:
        warnings.append({"code": "cpu_over", "message": f"CPU over limit: {fit.cpuUsed:.2f} / {cpu_output:.2f} tf."})
    if fit.pgUsed > pg_output:
        warnings.append({"code": "powergrid_over", "message": f"Powergrid over limit: {fit.pgUsed:.2f} / {pg_output:.2f} MW."})
    if fit.calibrationUsed > calibration_output:
        warnings.append({
            "code": "calibration_over",
            "message": f"Calibration over limit: {fit.calibrationUsed:.0f} / {calibration_output:.0f}.",
        })

    for slot_name in MODULE_SLOTS:
        total = fit.getNumSlots(SLOT_VALUE_BY_NAME[slot_name]) or 0
        used = fit.getSlotsUsed(SLOT_VALUE_BY_NAME[slot_name]) or 0
        if used > total:
            warnings.append({"code": "slot_over", "message": f"{slot_name.title()} slots over limit: {used:.0f} / {total:.0f}."})

    for module in fit.modules:
        if getattr(module, "isEmpty", False):
            continue
        try:
            if not module.fits(fit):
                warnings.append({"code": "module_invalid", "message": f"{module.item.typeName} does not fit this hull or fit state."})
        except Exception as exc:
            warnings.append({"code": "module_validation_failed", "message": f"{module.item.typeName}: {exc}"})
