from __future__ import annotations

import importlib
import math
import re
import sys
import threading
import types
from collections import namedtuple
from pathlib import Path
from typing import Any

from . import configure_pyfa, pyfa_root
from .crossfit import apply_cross_fit_links
from .fit_builder import build_fit

InputData = namedtuple("InputData", ("handle", "unit", "value"))

_GRAPH_LOCK = threading.Lock()

_GRAPH_TYPES: dict[str, tuple[str, str]] = {
    "dmgStatsGraph": ("graphs.data.fitDamageStats.graph", "FitDamageStatsGraph"),
    "capacitorGraph": ("graphs.data.fitCapacitor.graph", "FitCapacitorGraph"),
    "ewarStatsGraph": ("graphs.data.fitEwarStats.graph", "FitEwarStatsGraph"),
    "remoteRepsGraph": ("graphs.data.fitRemoteReps.graph", "FitRemoteRepsGraph"),
    "shieldRegenGraph": ("graphs.data.fitShieldRegen.graph", "FitShieldRegenGraph"),
    "mobilityGraph": ("graphs.data.fitMobility.graph", "FitMobilityGraph"),
    "warpTimeGraph": ("graphs.data.fitWarpTime.graph", "FitWarpTimeGraph"),
    "lockTimeGraph": ("graphs.data.fitLockTime.graph", "FitLockTimeGraph"),
}

_GRAPH_ORDER = [
    "dmgStatsGraph",
    "capacitorGraph",
    "ewarStatsGraph",
    "remoteRepsGraph",
    "shieldRegenGraph",
    "mobilityGraph",
    "warpTimeGraph",
    "lockTimeGraph",
]

_OPTION_KEYS = ("mobileDroneMode", "ignoreDCR", "ignoreResists", "ignoreLockRange", "applyProjected")


def _install_graph_import_shim() -> None:
    configure_pyfa()
    root = Path(pyfa_root()) / "graphs"
    data_root = root / "data"
    graphs_pkg = sys.modules.get("graphs")
    if graphs_pkg is None or not hasattr(graphs_pkg, "__path__"):
        graphs_pkg = types.ModuleType("graphs")
        graphs_pkg.__path__ = [str(root)]
        sys.modules["graphs"] = graphs_pkg
    data_pkg = sys.modules.get("graphs.data")
    if data_pkg is None or not hasattr(data_pkg, "__path__"):
        data_pkg = types.ModuleType("graphs.data")
        data_pkg.__path__ = [str(data_root)]
        sys.modules["graphs.data"] = data_pkg


def _install_shield_regen_gui_shim() -> None:
    gui_pkg = sys.modules.get("gui")
    if gui_pkg is None or not hasattr(gui_pkg, "__path__"):
        gui_pkg = types.ModuleType("gui")
        gui_pkg.__path__ = []
        sys.modules["gui"] = gui_pkg

    main_frame_module = types.ModuleType("gui.mainFrame")

    class _ResistanceView:
        showEffective = True

    class _StatsPane:
        nameViewMap = {"resistancesViewFull": _ResistanceView()}

    class _Frame:
        statsPane = _StatsPane()

    class _MainFrame:
        @staticmethod
        def getInstance() -> _Frame:
            return _Frame()

    main_frame_module.MainFrame = _MainFrame
    sys.modules["gui.mainFrame"] = main_frame_module
    gui_pkg.mainFrame = main_frame_module


def _graph_class(graph_type: str) -> type[Any]:
    _install_graph_import_shim()
    if graph_type == "shieldRegenGraph":
        _install_shield_regen_gui_shim()
    module_name, class_name = _GRAPH_TYPES[graph_type]
    module = importlib.import_module(module_name)
    return getattr(module, class_name)


def _safe_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def _json_number(value: Any) -> float | None:
    out = _safe_number(value)
    return None if out is None else out


def _unit(value: Any) -> str | None:
    return None if value is None else str(value)


def _axis_key(axis: Any) -> str:
    return f"{axis.handle}:{_unit(axis.unit) or ''}"


def _serialize_range(value: Any) -> list[float | None] | None:
    if value is None:
        return None
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return [_json_number(value[0]), _json_number(value[1])]
    return None


def _input_key(handle: str, unit: Any = None) -> str:
    return f"{handle}:{_unit(unit) or ''}"


def _serialize_axis(axis: Any, inputs_by_key: dict[str, Any]) -> dict[str, Any]:
    main_input = getattr(axis, "mainInput", None)
    input_handle, input_unit = main_input if main_input is not None else (None, None)
    input_def = inputs_by_key.get(_input_key(input_handle, input_unit)) if input_handle is not None else None
    return {
        "key": _axis_key(axis),
        "handle": axis.handle,
        "unit": _unit(axis.unit),
        "label": axis.label,
        "mainInput": {"handle": input_handle, "unit": _unit(input_unit)} if input_handle is not None else None,
        "defaultRange": _serialize_range(getattr(input_def, "defaultRange", None)),
    }


def _serialize_input(input_def: Any, kind: str = "number") -> dict[str, Any]:
    default_value = getattr(input_def, "defaultValue", None)
    if isinstance(default_value, (list, tuple)):
        default_value = [_json_number(value) for value in default_value]
    else:
        default_value = _json_number(default_value) if kind != "checkbox" else bool(default_value)
    return {
        "key": _input_key(input_def.handle, getattr(input_def, "unit", None)),
        "handle": input_def.handle,
        "unit": _unit(getattr(input_def, "unit", None)),
        "label": getattr(input_def, "label", input_def.handle),
        "defaultValue": default_value,
        "defaultRange": _serialize_range(getattr(input_def, "defaultRange", None)),
        "kind": kind,
    }


def _serialize_vector_input(handle: str, unit: Any, label: str, default_value: float) -> dict[str, Any]:
    return {
        "key": _input_key(handle, unit),
        "handle": handle,
        "unit": _unit(unit),
        "label": label,
        "defaultValue": _json_number(default_value),
        "kind": "number",
    }


def _serialize_vector(vector_def: Any, length_default: float, angle_default: float) -> dict[str, Any] | None:
    if vector_def is None:
        return None
    label = getattr(vector_def, "label", "Vector")
    length_handle = getattr(vector_def, "lengthHandle", None)
    angle_handle = getattr(vector_def, "angleHandle", None)
    if not length_handle or not angle_handle:
        return None
    return {
        "label": label,
        "length": _serialize_vector_input(
            length_handle,
            getattr(vector_def, "lengthUnit", None),
            f"{label} speed",
            length_default,
        ),
        "angle": _serialize_vector_input(
            angle_handle,
            getattr(vector_def, "angleUnit", None),
            f"{label} angle",
            angle_default,
        ),
    }


def _split_bracketed_target_name(name: str) -> tuple[list[str], str]:
    path: list[str] = []
    rest = name or ""
    while rest.startswith("["):
        match = re.match(r"^\[([^\]]+)\](.*)$", rest)
        if match is None:
            break
        part = match.group(1).strip()
        if part:
            path.append(part)
        rest = match.group(2).strip()
    return path, rest or name


def _target_profile_payload(profile: Any) -> dict[str, Any]:
    path = []
    parent = getattr(profile, "parent", None)
    while parent is not None:
        path.append(getattr(parent, "name", ""))
        parent = getattr(parent, "parent", None)
    path = [row for row in reversed(path) if row]
    raw_name = getattr(profile, "name", "Target")
    bracket_path, label = _split_bracketed_target_name(raw_name)
    if bracket_path:
        path = [*path, *bracket_path]
    else:
        label = raw_name
    resists = getattr(profile, "resists", None) or (0, 0, 0, 0)
    return {
        "profileId": int(getattr(profile, "ID", 0) or 0),
        "label": label,
        "fullName": " > ".join([*path, label]) if path else label,
        "path": path,
        "resists": [_json_number(value) for value in resists],
        "maxVelocity": _json_number(getattr(profile, "maxVelocity", None)),
        "signatureRadius": _json_number(getattr(profile, "signatureRadius", None)),
        "radius": _json_number(getattr(profile, "radius", None)),
    }


def _target_profiles() -> list[dict[str, Any]]:
    _install_graph_import_shim()
    from eos.saveddata.targetProfile import TargetProfile

    profiles = [
        {
            "profileId": 0,
            "label": "Ideal Target",
            "fullName": "Ideal Target",
            "path": [],
            "resists": [0, 0, 0, 0],
            "maxVelocity": 0,
            "signatureRadius": None,
            "radius": 0,
        }
    ]
    profiles.extend(_target_profile_payload(profile) for profile in TargetProfile.getBuiltinList())
    profiles.sort(key=lambda row: (row["path"], row["label"]))
    return profiles


def graph_metadata() -> dict[str, Any]:
    graphs: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for graph_type in _GRAPH_ORDER:
        try:
            graph = _graph_class(graph_type)()
            inputs_by_key = {
                _input_key(input_def.handle, input_def.unit): input_def
                for input_def in getattr(graph, "inputs", [])
            }
            inputs = [_serialize_input(input_def) for input_def in getattr(graph, "inputs", [])]
            inputs.extend(_serialize_input(input_def, "checkbox") for input_def in getattr(graph, "checkboxes", []))
            graphs.append({
                "graphType": graph.internalName,
                "label": graph.name,
                "hasTargets": bool(graph.hasTargets),
                "xDefs": [_serialize_axis(axis, inputs_by_key) for axis in graph.xDefs],
                "yDefs": [_serialize_axis(axis, inputs_by_key) for axis in graph.yDefs],
                "inputs": inputs,
                "vectors": {
                    "source": _serialize_vector(getattr(graph, "srcVectorDef", None), 0, 0),
                    "target": _serialize_vector(getattr(graph, "tgtVectorDef", None), 100, 0),
                },
            })
        except Exception as exc:
            errors.append({"code": "graph_unavailable", "message": f"{graph_type}: {exc}"})
    return {
        "ok": True,
        "graphs": graphs,
        "targetProfiles": _target_profiles(),
        "defaults": {
            "graphType": graphs[0]["graphType"] if graphs else None,
            "targetProfileId": 0,
            "options": {
                "mobileDroneMode": "auto",
                "ignoreDCR": False,
                "ignoreResists": False,
                "ignoreLockRange": True,
                "applyProjected": True,
            },
        },
        "errors": errors,
    }


def _find_axis(axes: list[Any], requested: dict[str, Any] | None, fallback_index: int = 0) -> Any:
    if requested:
        handle = requested.get("handle")
        unit = requested.get("unit")
        key = requested.get("key")
        for axis in axes:
            if key and _axis_key(axis) == key:
                return axis
            if handle == axis.handle and (unit is None or str(unit) == str(axis.unit)):
                return axis
    return axes[fallback_index]


def _raw_input_value(inputs: dict[str, Any], handle: str, unit: Any = None, fallback: Any = None) -> Any:
    key = _input_key(handle, unit)
    if key in inputs:
        return inputs[key]
    if handle in inputs:
        return inputs[handle]
    return fallback


def _coerce_input_value(value: Any, default: Any) -> Any:
    if isinstance(default, bool):
        return bool(value)
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return tuple(_safe_number(row) for row in value)
    return _safe_number(value)


def _add_misc(misc_by_handle: dict[str, InputData], main_handle: str, handle: str, unit: Any, value: Any) -> None:
    if handle == main_handle:
        return
    misc_by_handle[handle] = InputData(handle, unit, value)


def _graph_inputs(graph: Any, x_def: Any, request: dict[str, Any]) -> tuple[InputData, list[InputData]]:
    raw_inputs = request.get("inputs") if isinstance(request.get("inputs"), dict) else {}
    x_request = request.get("x") if isinstance(request.get("x"), dict) else {}
    main_handle, main_unit = x_def.mainInput
    input_defs = {
        _input_key(input_def.handle, input_def.unit): input_def
        for input_def in getattr(graph, "inputs", [])
    }
    main_def = input_defs.get(_input_key(main_handle, main_unit))
    default_range = getattr(main_def, "defaultRange", None) or (0, 1)
    main_range = x_request.get("range") or _raw_input_value(raw_inputs, main_handle, main_unit, default_range)
    if not isinstance(main_range, (list, tuple)) or len(main_range) < 2:
        main_range = default_range
    main_input = InputData(
        main_handle,
        main_unit,
        (_safe_number(main_range[0]) or 0, _safe_number(main_range[1]) or 1),
    )

    misc_by_handle: dict[str, InputData] = {}
    for input_def in getattr(graph, "inputs", []):
        value = _raw_input_value(raw_inputs, input_def.handle, input_def.unit, input_def.defaultValue)
        value = _coerce_input_value(value, input_def.defaultValue)
        _add_misc(misc_by_handle, main_handle, input_def.handle, input_def.unit, value)
    for checkbox in getattr(graph, "checkboxes", []):
        value = _raw_input_value(raw_inputs, checkbox.handle, None, checkbox.defaultValue)
        _add_misc(misc_by_handle, main_handle, checkbox.handle, None, bool(value))

    src_vector = getattr(graph, "srcVectorDef", None)
    if src_vector is not None:
        length = _raw_input_value(raw_inputs, src_vector.lengthHandle, src_vector.lengthUnit, 0)
        angle = _raw_input_value(raw_inputs, src_vector.angleHandle, src_vector.angleUnit, 0)
        _add_misc(misc_by_handle, main_handle, src_vector.lengthHandle, src_vector.lengthUnit, _safe_number(length) or 0)
        _add_misc(misc_by_handle, main_handle, src_vector.angleHandle, src_vector.angleUnit, _safe_number(angle) or 0)

    tgt_vector = getattr(graph, "tgtVectorDef", None)
    if tgt_vector is not None:
        length = _raw_input_value(raw_inputs, tgt_vector.lengthHandle, tgt_vector.lengthUnit, 100)
        angle = _raw_input_value(raw_inputs, tgt_vector.angleHandle, tgt_vector.angleUnit, 0)
        _add_misc(misc_by_handle, main_handle, tgt_vector.lengthHandle, tgt_vector.lengthUnit, _safe_number(length) or 0)
        _add_misc(misc_by_handle, main_handle, tgt_vector.angleHandle, tgt_vector.angleUnit, _safe_number(angle) or 0)

    return main_input, list(misc_by_handle.values())


def _profile_target_wrapper(profile_id: int, line_style_id: int = 0) -> tuple[Any, dict[str, Any]]:
    from eos.saveddata.targetProfile import TargetProfile
    from graphs.wrapper import TargetWrapper

    profile = TargetProfile.getIdeal() if profile_id == 0 else TargetProfile.getBuiltinById(profile_id)
    if profile is None:
        profile = TargetProfile.getIdeal()
    wrapper = TargetWrapper(profile, 0, line_style_id)
    return wrapper, {
        "id": f"profile:{profile_id}",
        "kind": "profile",
        "profileId": profile_id,
        "label": wrapper.shortName or wrapper.name or "Target Profile",
    }


def _fit_target_wrapper(target: dict[str, Any], index: int, warnings: list[dict[str, Any]]) -> tuple[Any, dict[str, Any]] | None:
    from graphs.wrapper import TargetWrapper

    fit_payload = target.get("fitState") if isinstance(target.get("fitState"), dict) else None
    if not fit_payload:
        warnings.append({
            "code": "graph_target_missing_fit",
            "message": f"{target.get('label') or target.get('tabId') or 'Open fit'} could not be used as a graph target.",
        })
        return None
    fit, fit_warnings, fit_errors = build_fit(fit_payload)
    warnings.extend({**warning, "graphTargetId": target.get("id") or target.get("tabId")} for warning in fit_warnings)
    if fit is None or fit_errors:
        warnings.append({
            "code": "graph_target_invalid_fit",
            "message": f"{target.get('label') or target.get('tabId') or 'Open fit'} could not be used as a graph target.",
            "details": fit_errors,
        })
        return None
    fit.ID = 9_100_000 + index
    wrapper = TargetWrapper(fit, 0, index % 5)
    label = target.get("label") or target.get("fitName") or getattr(fit, "name", None) or "Open Fit"
    ship_item = getattr(getattr(fit, "ship", None), "item", None)
    ship_name = target.get("shipName") or (getattr(ship_item, "typeName", None) if ship_item is not None else None)
    return wrapper, {
        "id": target.get("id") or f"fit:{target.get('tabId') or index}",
        "kind": "open_fit",
        "tabId": target.get("tabId"),
        "label": label,
        "shipName": ship_name,
        "dirty": bool(target.get("dirty")),
    }


def _target_wrappers(graph: Any, request: dict[str, Any], warnings: list[dict[str, Any]]) -> list[tuple[Any | None, dict[str, Any] | None]]:
    if not graph.hasTargets:
        return [(None, None)]
    _install_graph_import_shim()

    requested = request.get("graphTargets") if isinstance(request.get("graphTargets"), list) else []
    targets: list[tuple[Any | None, dict[str, Any] | None]] = []
    for index, target in enumerate(requested):
        if not target or target.get("enabled") is False:
            continue
        kind = target.get("kind") or "profile"
        if kind == "open_fit":
            wrapped = _fit_target_wrapper(target, index, warnings)
            if wrapped is not None:
                targets.append(wrapped)
            continue
        raw_id = target.get("profileId") or target.get("targetProfileId") or 0
        try:
            profile_id = int(raw_id or 0)
        except (TypeError, ValueError):
            profile_id = 0
        targets.append(_profile_target_wrapper(profile_id, index % 5))

    if targets:
        return targets

    raw_id = request.get("targetProfileId") or (request.get("target") or {}).get("profileId")
    try:
        profile_id = int(raw_id or 0)
    except (TypeError, ValueError):
        profile_id = 0
    return [_profile_target_wrapper(profile_id, 0)]


def _apply_graph_settings(options: dict[str, Any]) -> dict[str, Any]:
    _install_graph_import_shim()
    from service.const import GraphDpsDroneMode
    from service.settings import GraphSettings

    settings = GraphSettings.getInstance()
    previous = {key: settings.get(key) for key in _OPTION_KEYS}
    drone_mode = str(options.get("mobileDroneMode") or previous.get("mobileDroneMode") or "auto").lower()
    drone_mode_value = {
        "auto": GraphDpsDroneMode.auto,
        "followattacker": GraphDpsDroneMode.followAttacker,
        "follow_attacker": GraphDpsDroneMode.followAttacker,
        "followtarget": GraphDpsDroneMode.followTarget,
        "follow_target": GraphDpsDroneMode.followTarget,
    }.get(drone_mode, GraphDpsDroneMode.auto)
    settings.set("mobileDroneMode", drone_mode_value)
    for key in ("ignoreDCR", "ignoreResists", "ignoreLockRange", "applyProjected"):
        if key in options:
            settings.set(key, bool(options[key]))
    return previous


def _restore_graph_settings(previous: dict[str, Any]) -> None:
    from service.settings import GraphSettings

    settings = GraphSettings.getInstance()
    for key, value in previous.items():
        settings.set(key, value)


def _point_payload(x_values: list[Any], y_values: list[Any]) -> list[dict[str, float]]:
    points: list[dict[str, float]] = []
    for raw_x, raw_y in zip(x_values or [], y_values or []):
        x = _safe_number(raw_x)
        y = _safe_number(raw_y)
        if x is None or y is None:
            continue
        points.append({"x": x, "y": y})
    return points


def calculate_graph(payload: dict[str, Any]) -> dict[str, Any]:
    request = payload or {}
    fit_payload = request.get("targetFit") if isinstance(request.get("targetFit"), dict) else request
    fit, warnings, errors = build_fit(fit_payload)
    if fit is None or errors:
        return {
            "ok": False,
            "points": [],
            "series": [],
            "warnings": warnings,
            "errors": errors,
        }

    crossfit = apply_cross_fit_links(fit, request, warnings)
    graph_type = str(request.get("graphType") or "dmgStatsGraph")
    if graph_type not in _GRAPH_TYPES:
        graph_type = "dmgStatsGraph"

    _install_graph_import_shim()
    from graphs.wrapper import SourceWrapper

    graph = _graph_class(graph_type)()
    x_def = _find_axis(graph.xDefs, request.get("x") if isinstance(request.get("x"), dict) else None)
    y_def = _find_axis(graph.yDefs, request.get("y") if isinstance(request.get("y"), dict) else None)
    main_input, misc_inputs = _graph_inputs(graph, x_def, request)
    source = SourceWrapper(fit, 0)
    targets = _target_wrappers(graph, request, warnings)

    with _GRAPH_LOCK:
        previous_settings = _apply_graph_settings(request.get("options") if isinstance(request.get("options"), dict) else {})
        try:
            series: list[dict[str, Any]] = []
            for index, (target, target_meta) in enumerate(targets):
                x_values, y_values = graph.getPlotPoints(main_input, misc_inputs, x_def, y_def, source, target)
                points = _point_payload(list(x_values or []), list(y_values or []))
                label = target_meta.get("label") if target_meta else getattr(fit, "name", None) or "Active Fit"
                series.append({
                    "id": target_meta.get("id") if target_meta else "activeFit",
                    "label": label,
                    "target": target_meta,
                    "colorIndex": index,
                    "points": points,
                })
        except Exception as exc:
            return {
                "ok": False,
                "points": [],
                "series": [],
                "warnings": warnings,
                "errors": [{"code": "graph_calculation_failed", "message": str(exc)}],
            }
        finally:
            _restore_graph_settings(previous_settings)

    points = series[0]["points"] if series else []
    return {
        "ok": True,
        "graphType": graph.internalName,
        "label": graph.name,
        "axes": {
            "x": {"handle": x_def.handle, "unit": _unit(x_def.unit), "label": x_def.label},
            "y": {"handle": y_def.handle, "unit": _unit(y_def.unit), "label": y_def.label},
        },
        "points": points,
        "series": series,
        "crossfit": crossfit,
        "warnings": warnings,
        "errors": [],
    }
