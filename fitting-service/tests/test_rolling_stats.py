from __future__ import annotations

from pathlib import Path

from pyfa_adapter.rolling_stats import _is_zero_point_module, rolling_stats


FIT_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "fits"


def test_rolling_stats_bare_hull_returns_cold_scenario_only() -> None:
    result = rolling_stats("[Rifter, Bare Hull]\n\n")

    assert result["ok"] is True, result.get("errors")
    assert result["ship"]["typeName"] == "Rifter"
    assert result["assumptions"]["skills"] == "all_v"
    assert [scenario["key"] for scenario in result["scenarios"]] == ["cold"]
    assert result["summary"]["mass"]["coldKg"] is not None
    assert result["summary"]["mass"]["bestPropKg"] is None
    assert result["summary"]["movement"]["coldMaxVelocityMs"] is not None
    assert result["summary"]["movement"]["bestPropMaxVelocityMs"] is None


def test_rolling_stats_mwd_fit_returns_prop_summary_and_jump_blocker_warning() -> None:
    eft = (FIT_FIXTURE_DIR / "002_missile_bastion_golem.eft").read_text(encoding="utf-8")
    result = rolling_stats(eft)

    assert result["ok"] is True, result.get("errors")
    assert result["ship"]["typeName"] == "Golem"

    prop_scenarios = [scenario for scenario in result["scenarios"] if scenario["key"].startswith("prop:")]
    assert len(prop_scenarios) == 2
    assert result["summary"]["mass"]["bestPropKg"] is not None
    assert result["summary"]["movement"]["bestPropMaxVelocityMs"] is not None
    assert result["summary"]["bestPropMassModule"]["typeName"] == "500MN Quad LiF Restrained Microwarpdrive"
    assert result["summary"]["bestPropSpeedModule"]["typeName"] == "500MN Quad LiF Restrained Microwarpdrive"
    assert result["summary"]["movement"]["bestPropMaxVelocityMsHeated"] >= result["summary"]["movement"]["bestPropMaxVelocityMs"]
    assert result["summary"]["bestPropSpeedHeatedModule"]["typeName"] == "500MN Quad LiF Restrained Microwarpdrive"
    assert any(warning["code"] == "jump_blocking_modules_forced_inactive" for warning in result["warnings"])
    assert prop_scenarios[0]["moduleState"]["disabledJumpBlockers"]


def test_rolling_stats_dual_prop_returns_each_prop_and_separate_bests() -> None:
    result = rolling_stats(
        """[Raven, Dual Prop]
Damage Control II

100MN Monopropellant Enduring Afterburner
500MN Quad LiF Restrained Microwarpdrive

Cruise Missile Launcher II, Scourge Cruise Missile
"""
    )

    assert result["ok"] is True, result.get("errors")
    prop_scenarios = [scenario for scenario in result["scenarios"] if scenario["key"].startswith("prop:")]
    prop_names = {scenario["moduleState"]["activePropModule"]["typeName"] for scenario in prop_scenarios}

    assert len(prop_scenarios) == 4
    assert "100MN Monopropellant Enduring Afterburner" in prop_names
    assert "500MN Quad LiF Restrained Microwarpdrive" in prop_names
    assert result["summary"]["bestPropMassModule"]["typeName"] in prop_names
    assert result["summary"]["bestPropSpeedModule"]["typeName"] in prop_names
    assert result["summary"]["bestPropSpeedHeatedModule"]["typeName"] in prop_names
    assert result["summary"]["movement"]["bestPropMaxVelocityMsHeated"] >= result["summary"]["movement"]["bestPropMaxVelocityMs"]


def test_rolling_stats_forces_cloak_inactive_and_uses_fastest_prop_speed_variant() -> None:
    result = rolling_stats(
        """[Typhoon, ROL 555 Typhoon]
Damage Control II
Inertial Stabilizers II
Inertial Stabilizers II
Inertial Stabilizers II
Overdrive Injector System II
Overdrive Injector System II
Overdrive Injector System II

Heavy F-RX Compact Capacitor Booster
Large Micro Jump Drive
100MN Monopropellant Enduring Afterburner
Cetus Scoped Burst Jammer
500MN Quad LiF Restrained Microwarpdrive

Improved Cloaking Device II
Core Probe Launcher I
Heavy Gremlin Compact Energy Neutralizer
Heavy Gremlin Compact Energy Neutralizer
Heavy Gremlin Compact Energy Neutralizer
Medium Infectious Scoped Energy Neutralizer
Medium Infectious Scoped Energy Neutralizer

Large Higgs Anchor I
Large Hyperspatial Velocity Optimizer I
Large Hyperspatial Velocity Optimizer I
"""
    )

    assert result["ok"] is True, result.get("errors")
    assert 50 < result["summary"]["movement"]["coldMaxVelocityMs"] < 60
    assert 220 < result["summary"]["movement"]["bestPropMaxVelocityMs"] < 230
    assert result["summary"]["movement"]["bestPropMaxVelocityMsHeated"] > 300
    assert result["summary"]["bestPropSpeedModule"]["typeName"] == "500MN Quad LiF Restrained Microwarpdrive"
    assert result["summary"]["bestPropSpeedHeatedModule"]["typeName"] == "500MN Quad LiF Restrained Microwarpdrive"
    assert any(warning["code"] == "rolling_modules_forced_inactive" for warning in result["warnings"])


def test_rolling_stats_invalid_eft_returns_structured_error() -> None:
    result = rolling_stats("")

    assert result["ok"] is False
    assert result["summary"] is None
    assert result["scenarios"] == []
    assert result["errors"]


def test_zero_point_module_detection_is_conservative() -> None:
    meta = {
        "typeName": "Zero-Point Mass Entangler",
        "groupName": "Mass Entanglers",
        "effectNames": [],
    }

    assert _is_zero_point_module({"typeName": "Zero-Point Mass Entangler"}, meta) is True
    assert _is_zero_point_module({"typeName": "Warp Disruption Field Generator II"}, {"typeName": "Warp Disruption Field Generator II"}) is False
