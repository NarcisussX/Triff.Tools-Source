from __future__ import annotations

from typing import Any

from .fit_builder import build_fit


def _skill_level(skill: Any) -> int:
    try:
        if not skill.learned:
            return -1
    except Exception:
        return -1
    try:
        return int(skill.level)
    except Exception:
        return 0


def _skill_name(skill: Any) -> str:
    item = getattr(skill, "item", None)
    return (
        getattr(item, "typeName", None)
        or getattr(item, "name", None)
        or f"Skill {getattr(skill, 'itemID', '')}".strip()
    )


def _skill_type_id(skill: Any) -> int | None:
    item = getattr(skill, "item", None)
    raw = getattr(item, "ID", None) or getattr(skill, "itemID", None)
    try:
        type_id = int(raw)
    except (TypeError, ValueError):
        return None
    return type_id if type_id > 0 else None


def _collect_skills(container: Any) -> dict[int, Any]:
    from eos.saveddata.character import Skill

    skills: dict[int, Any] = {}
    if container is None:
        return skills

    try:
        attr_names = list(container.iterAfflictions())
    except Exception:
        return skills

    for attr_name in attr_names:
        try:
            if container[attr_name] == 0:
                continue
        except Exception:
            pass

        try:
            afflictions = container.getAfflictions(attr_name).values()
        except Exception:
            continue

        for afflictors in afflictions:
            for afflictor_row in afflictors:
                afflictor = afflictor_row[0] if afflictor_row else None
                if not isinstance(afflictor, Skill):
                    continue
                type_id = _skill_type_id(afflictor)
                if type_id is not None:
                    skills[type_id] = afflictor

    return skills


def _required_level(raw_level: Any) -> int:
    try:
        return max(0, min(5, int(float(raw_level))))
    except (TypeError, ValueError):
        return 0


def _collect_required_skills(character: Any, item: Any) -> dict[int, tuple[Any, int]]:
    if character is None or item is None:
        return {}

    try:
        required = item.requiredSkills or {}
    except Exception:
        return {}

    skills: dict[int, tuple[Any, int]] = {}
    for skill_item, raw_level in required.items():
        try:
            type_id = int(skill_item.ID)
            skill = character.getSkill(type_id)
        except Exception:
            continue
        skills[type_id] = (skill, _required_level(raw_level))
    return skills


def _module_for_context(fit: Any, context: dict[str, Any]) -> Any | None:
    slot = str(context.get("slot") or "")
    try:
        index = int(context.get("index"))
    except (TypeError, ValueError):
        return None

    fallback: list[Any] = []
    for module in list(getattr(fit, "modules", []) or []):
        module_slot = getattr(module, "triffSlotName", None)
        module_index = getattr(module, "triffSlotIndex", None)
        if module_slot == slot and int(module_index) == index:
            return module
        if module_slot == slot:
            fallback.append(module)

    return fallback[index] if 0 <= index < len(fallback) else None


def affecting_skills(payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    fit, warnings, errors = build_fit(payload)
    if fit is None or errors:
        return {
            "ok": False,
            "skills": [],
            "warnings": warnings,
            "errors": errors,
        }

    kind = str((context or {}).get("kind") or "").lower()
    containers: list[Any] = []
    required_items: list[Any] = []
    target_name: str | None = None

    if kind == "ship":
        containers.append(getattr(fit.ship, "itemModifiedAttributes", None))
        required_items.append(getattr(fit.ship, "item", None))
        target_name = getattr(getattr(fit.ship, "item", None), "typeName", None)
    elif kind == "module":
        module = _module_for_context(fit, context or {})
        if module is None:
            return {
                "ok": False,
                "skills": [],
                "warnings": warnings,
                "errors": [{"code": "module_not_found", "message": "The requested fitted module was not found."}],
            }
        containers.append(getattr(module, "itemModifiedAttributes", None))
        # Our UI does not expose a separate charge-row context menu, so include charge
        # afflictors here when a loaded charge contributes skill-modified attributes.
        containers.append(getattr(module, "chargeModifiedAttributes", None))
        required_items.append(getattr(module, "item", None))
        required_items.append(getattr(module, "charge", None))
        target_name = getattr(getattr(module, "item", None), "typeName", None)
    else:
        return {
            "ok": False,
            "skills": [],
            "warnings": warnings,
            "errors": [{"code": "invalid_context", "message": "Skill context must be ship or module."}],
        }

    overrides = payload.get("skillOverrides") or {}
    skill_map: dict[int, Any] = {}
    stat_affectors: set[int] = set()
    for container in containers:
        collected = _collect_skills(container)
        skill_map.update(collected)
        stat_affectors.update(collected.keys())

    required_levels: dict[int, int] = {}
    character = getattr(fit, "character", None)
    for item in required_items:
        for type_id, (skill, required_level) in _collect_required_skills(character, item).items():
            skill_map.setdefault(type_id, skill)
            required_levels[type_id] = max(required_levels.get(type_id, 0), required_level)

    skills = []
    for type_id, skill in sorted(skill_map.items(), key=lambda row: _skill_name(row[1]).lower()):
        override_key = str(type_id)
        has_override = override_key in overrides
        skills.append({
            "skillTypeId": type_id,
            "skillName": _skill_name(skill),
            "currentLevel": _skill_level(skill),
            "learned": bool(getattr(skill, "learned", False)),
            "hasOverride": has_override,
            "overrideLevel": overrides.get(override_key) if has_override else None,
            "affectsStats": type_id in stat_affectors,
            "requiredLevel": required_levels.get(type_id),
            "required": type_id in required_levels,
        })

    return {
        "ok": True,
        "context": {"kind": kind, "targetName": target_name},
        "skills": skills,
        "warnings": warnings,
        "errors": [],
    }
