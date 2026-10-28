from . import configure_pyfa


def all_v_character():
    configure_pyfa()
    from eos.saveddata.character import Character

    return Character.getAll5()


def alpha_clone_character():
    configure_pyfa()
    import eos.db
    from eos.saveddata.character import Character

    alpha_clones = eos.db.getAlphaCloneList()
    character = Character("All Alpha Skills", defaultLevel=0)
    if not alpha_clones:
        return character

    alpha_clone = alpha_clones[0]
    skills = [
        {"typeID": int(skill.typeID), "level": max(0, min(5, int(skill.level)))}
        for skill in alpha_clone.skills
    ]
    character.apiUpdateCharSheet(skills)
    character.alphaCloneID = getattr(alpha_clone, "alphaCloneID", None)
    return character


def _normalized_skill_overrides(overrides: dict | None) -> dict[int, int | None]:
    normalized: dict[int, int | None] = {}
    for raw_type_id, raw_level in (overrides or {}).items():
        try:
            type_id = int(raw_type_id)
            level = int(raw_level)
        except (TypeError, ValueError):
            continue
        if type_id <= 0:
            continue
        if level < 0:
            normalized[type_id] = None
        else:
            normalized[type_id] = max(0, min(5, level))
    return normalized


def _apply_skill_overrides(character, overrides: dict | None):
    for type_id, level in _normalized_skill_overrides(overrides).items():
        try:
            character.getSkill(type_id).setLevel(level, ignoreRestrict=True)
        except Exception:
            continue
    return character


def character_from_skill_profile(profile: dict | None, skill_overrides: dict | None = None):
    configure_pyfa()
    overrides = _normalized_skill_overrides(skill_overrides)
    if profile and profile.get("mode") == "alpha_clone":
        return _apply_skill_overrides(alpha_clone_character(), overrides)
    if not profile or profile.get("mode") != "esi_character":
        if overrides:
            from eos.saveddata.character import Character

            return _apply_skill_overrides(Character("All 5 with overrides", defaultLevel=5), overrides)
        return all_v_character()

    from eos.saveddata.character import Character

    character = Character(profile.get("characterName") or "ESI Character", defaultLevel=0)
    skills = []
    for raw_type_id, raw_level in (profile.get("skills") or {}).items():
        try:
            type_id = int(raw_type_id)
            level = max(0, min(5, int(raw_level)))
        except (TypeError, ValueError):
            continue
        skills.append({"typeID": type_id, "level": level})
    character.apiUpdateCharSheet(skills)
    return _apply_skill_overrides(character, overrides)
