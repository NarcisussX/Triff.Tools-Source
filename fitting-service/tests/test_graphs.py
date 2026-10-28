from __future__ import annotations

from pyfa_adapter.graphs import calculate_graph, graph_metadata


def _rifter_payload() -> dict:
    return {
        "shipTypeId": 587,
        "fitName": "Graph Probe",
        "characterMode": "all_v",
        "modules": {"high": [], "mid": [], "low": [], "rig": [], "subsystem": []},
        "drones": [],
        "fighters": [],
        "cargo": [],
        "implants": [],
        "boosters": [],
        "projectedEffects": [],
    }


def test_graph_metadata_exposes_pyfa_graphs_and_targets() -> None:
    metadata = graph_metadata()
    assert metadata["ok"] is True
    graph_names = {graph["label"] for graph in metadata["graphs"]}
    assert "Damage Stats" in graph_names
    assert "Capacitor" in graph_names
    assert len(metadata["targetProfiles"]) > 10
    damage_graph = next(graph for graph in metadata["graphs"] if graph["graphType"] == "dmgStatsGraph")
    assert damage_graph["vectors"]["source"]["angle"]["handle"] == "atkAngle"
    assert damage_graph["vectors"]["target"]["angle"]["handle"] == "tgtAngle"


def test_target_profiles_are_grouped_from_pyfa_bracket_names() -> None:
    metadata = graph_metadata()
    abyssal = next(profile for profile in metadata["targetProfiles"] if profile["label"] == "All" and profile["path"][:2] == ["NPC", "Abyssal"])
    assert abyssal["fullName"].startswith("NPC > Abyssal")


def test_damage_graph_calculates_points_through_pyfa() -> None:
    result = calculate_graph({
        **_rifter_payload(),
        "graphType": "dmgStatsGraph",
        "x": {"handle": "distance", "unit": None, "range": [0, 50000]},
        "y": {"handle": "outgoingDps", "unit": None},
        "targetProfileId": 0,
        "inputs": {"atkSpeed:%": 0, "atkAngle:degrees": 0, "tgtSpeed:%": 100, "tgtAngle:degrees": 90},
        "options": {"ignoreResists": True, "applyProjected": True},
    })
    assert result["ok"] is True
    assert not result["errors"]
    assert len(result["points"]) > 10


def test_damage_graph_accepts_open_fit_targets() -> None:
    result = calculate_graph({
        **_rifter_payload(),
        "targetFit": _rifter_payload(),
        "graphType": "dmgStatsGraph",
        "x": {"handle": "distance", "unit": None, "range": [0, 50000]},
        "y": {"handle": "outgoingDps", "unit": None},
        "graphTargets": [
            {
                "id": "profile:0",
                "kind": "profile",
                "profileId": 0,
                "label": "Ideal Target",
            },
            {
                "id": "fit:target",
                "kind": "open_fit",
                "tabId": "target",
                "fitName": "Target Rifter",
                "shipName": "Rifter",
                "fitState": _rifter_payload(),
            },
        ],
        "inputs": {},
        "options": {"ignoreResists": True, "applyProjected": True},
    })
    assert result["ok"] is True
    assert not result["errors"]
    assert len(result["series"]) == 2
    assert all(len(series["points"]) > 10 for series in result["series"])


def test_damage_graph_uses_selected_builtin_target_profile() -> None:
    result = calculate_graph({
        **_rifter_payload(),
        "targetFit": _rifter_payload(),
        "graphType": "dmgStatsGraph",
        "x": {"handle": "distance", "unit": None, "range": [0, 50000]},
        "y": {"handle": "outgoingDps", "unit": None},
        "graphTargets": [
            {
                "id": "profile:-13",
                "kind": "profile",
                "profileId": -13,
                "label": "Caldari (Shield)",
            },
        ],
        "inputs": {"tgtSpeed:%": 100, "tgtAngle:degrees": 0},
        "options": {"ignoreResists": False, "applyProjected": True},
    })
    assert result["ok"] is True
    assert not result["errors"]
    assert result["series"][0]["target"]["profileId"] == -13
    assert result["series"][0]["label"] != "Ideal Target"


def test_capacitor_graph_calculates_points_through_pyfa() -> None:
    result = calculate_graph({
        **_rifter_payload(),
        "graphType": "capacitorGraph",
        "x": {"handle": "time", "unit": None, "range": [0, 300000]},
        "y": {"handle": "capacitor", "unit": None},
        "inputs": {"useCapsim": True},
        "options": {},
    })
    assert result["ok"] is True
    assert not result["errors"]
    assert len(result["points"]) > 10
