from __future__ import annotations

from pyfa_adapter import configure_pyfa
from pyfa_adapter.calculator import calculate
from pyfa_adapter.skill_affectors import affecting_skills


def _type_id(name: str) -> int:
    configure_pyfa()
    import eos.db

    item = eos.db.getItem(name)
    assert item is not None, name
    return int(item.ID)


def _payload(skill_profile: dict | None = None) -> dict:
    payload = {
        "shipTypeId": _type_id("Rifter"),
        "fitName": "Skill Profile Probe",
        "characterMode": "all_v",
        "modules": {
            "high": [{
                "id": "high:0",
                "typeId": _type_id("200mm AutoCannon II"),
                "chargeTypeId": _type_id("Republic Fleet EMP S"),
                "state": "active",
            }],
            "mid": [],
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
    if skill_profile is not None:
        payload["skillProfile"] = skill_profile
    return payload


def test_all_v_skill_profile_still_calculates() -> None:
    result = calculate(_payload({"mode": "all_v"}))

    assert result["ok"] is True, result.get("errors")
    assert result["stats"]["firepower"]["weaponDps"] > 0
    assert result["stats"]["requiredSkills"]
    assert result["stats"]["fitWarningSummary"]["missingSkillCount"] == 0
    assert result["stats"]["skillWarnings"] == []


def test_alpha_clone_skill_profile_uses_pyfa_alpha_caps() -> None:
    all_v = calculate(_payload({"mode": "all_v"}))
    alpha = calculate(_payload({"mode": "alpha_clone"}))

    assert alpha["ok"] is True, alpha.get("errors")
    assert alpha["stats"]["character"]["mode"] == "alpha_clone"
    assert alpha["stats"]["firepower"]["weaponDps"] < all_v["stats"]["firepower"]["weaponDps"]


def test_esi_skill_profile_accepts_skill_map_and_changes_stats() -> None:
    all_v = calculate(_payload({"mode": "all_v"}))
    low_skill = calculate(_payload({
        "mode": "esi_character",
        "characterId": 123,
        "characterName": "Low Skill Pilot",
        "skills": {},
    }))

    assert all_v["ok"] is True, all_v.get("errors")
    assert low_skill["ok"] is True, low_skill.get("errors")
    assert low_skill["stats"]["character"]["mode"] == "esi_character"
    assert low_skill["stats"]["firepower"]["weaponDps"] < all_v["stats"]["firepower"]["weaponDps"]


def test_low_skill_profile_reports_missing_skill_warnings() -> None:
    result = calculate(_payload({
        "mode": "esi_character",
        "characterId": 123,
        "characterName": "Low Skill Pilot",
        "skills": {},
    }))

    assert result["ok"] is True, result.get("errors")
    warnings = result["stats"]["skillWarnings"]
    assert result["stats"]["fitWarningSummary"]["missingSkillCount"] > 0
    assert any(warning["scope"] == "ship" for warning in warnings)
    module_warning = next(warning for warning in warnings if warning["scope"] == "module")
    assert module_warning["moduleInstanceId"] == "high:0"
    assert module_warning["slot"] == "high"
    assert module_warning["index"] == 0
    assert module_warning["missingSkills"]
    first_skill = module_warning["missingSkills"][0]
    assert {"skillTypeId", "skillName", "requiredLevel", "actualLevel"}.issubset(first_skill)
    assert first_skill["requiredLevel"] > first_skill["actualLevel"]
    full_requirements = {
        row["skillTypeId"]: row["requiredLevel"]
        for row in result["stats"]["requiredSkills"]
    }
    assert first_skill["skillTypeId"] in full_requirements
    assert full_requirements[first_skill["skillTypeId"]] >= first_skill["requiredLevel"]


def test_missing_skill_map_does_not_crash() -> None:
    result = calculate(_payload({
        "mode": "esi_character",
        "characterId": 456,
        "characterName": "No Skills",
    }))

    assert result["ok"] is True, result.get("errors")
    assert result["stats"]["character"]["mode"] == "esi_character"


def test_temporary_skill_override_changes_calculated_stats() -> None:
    skill_id = _type_id("Small Projectile Turret")
    all_v = calculate(_payload({"mode": "all_v"}))
    overridden = calculate({
        **_payload({"mode": "all_v"}),
        "skillOverrides": {str(skill_id): 0},
    })

    assert all_v["ok"] is True, all_v.get("errors")
    assert overridden["ok"] is True, overridden.get("errors")
    assert overridden["stats"]["firepower"]["weaponDps"] < all_v["stats"]["firepower"]["weaponDps"]


def test_affecting_skills_returns_pyfa_skill_afflictors() -> None:
    skill_id = _type_id("Small Projectile Turret")
    result = affecting_skills({
        **_payload({"mode": "all_v"}),
        "skillOverrides": {str(skill_id): 0},
    }, {"kind": "module", "slot": "high", "index": 0})

    assert result["ok"] is True, result.get("errors")
    skills = {skill["skillName"]: skill for skill in result["skills"]}
    assert "Small Projectile Turret" in skills
    assert skills["Small Projectile Turret"]["currentLevel"] == 0
    assert skills["Small Projectile Turret"]["hasOverride"] is True


def test_affecting_skills_includes_required_only_module_skills() -> None:
    payload = {
        "shipTypeId": _type_id("Zirnitra"),
        "fitName": "Required Skill Probe",
        "skillProfile": {
            "mode": "esi_character",
            "characterId": 123,
            "characterName": "No Spec",
            "skills": {},
        },
        "modules": {
            "high": [{
                "id": "high:0",
                "typeId": _type_id("Ultratidal Entropic Disintegrator II"),
                "state": "active",
            }],
            "mid": [],
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

    result = affecting_skills(payload, {"kind": "module", "slot": "high", "index": 0})

    assert result["ok"] is True, result.get("errors")
    skills = {skill["skillName"]: skill for skill in result["skills"]}
    specialization = skills["Capital Disintegrator Specialization"]
    assert specialization["currentLevel"] == 0
    assert specialization["required"] is True
    assert specialization["requiredLevel"] == 1
    assert specialization["affectsStats"] is False
