from __future__ import annotations

from typing import Any

from . import configure_pyfa
from .serializers import safe_float


def _profile_payload(pattern: Any) -> dict[str, Any]:
    profile_id = getattr(pattern, "ID", None)
    return {
        "profileId": str(profile_id) if profile_id is not None else None,
        "name": getattr(pattern, "name", None) or getattr(pattern, "shortName", None) or "Damage Profile",
        "label": getattr(pattern, "shortName", None) or getattr(pattern, "name", None) or "Damage Profile",
        "fullName": getattr(pattern, "fullName", None) or getattr(pattern, "name", None),
        "em": safe_float(getattr(pattern, "emAmount", None)),
        "thermal": safe_float(getattr(pattern, "thermalAmount", None)),
        "kinetic": safe_float(getattr(pattern, "kineticAmount", None)),
        "explosive": safe_float(getattr(pattern, "explosiveAmount", None)),
        "source": "pyfa/eos",
    }


def damage_profile_payload(pattern: Any) -> dict[str, Any] | None:
    if pattern is None:
        return None
    return _profile_payload(pattern)


def damage_profile_tree() -> dict[str, Any]:
    configure_pyfa()
    from eos.saveddata.damagePattern import DamagePattern

    root: list[dict[str, Any]] = []
    category_lookup: dict[tuple[str, ...], dict[str, Any]] = {}

    for pattern in DamagePattern.getBuiltinList():
        hierarchy = list(getattr(pattern, "hierarchy", None) or [])
        parent_children = root
        path: list[str] = []

        for label in hierarchy:
            path.append(str(label))
            key = tuple(path)
            node = category_lookup.get(key)
            if node is None:
                node = {
                    "key": "category:" + "/".join(path),
                    "label": str(label),
                    "children": [],
                    "source": "pyfa/eos",
                }
                category_lookup[key] = node
                parent_children.append(node)
            parent_children = node["children"]

        payload = _profile_payload(pattern)
        parent_children.append({
            "key": f"profile:{payload['profileId']}",
            **payload,
        })

    return {
        "ok": True,
        "profiles": root,
        "source": "pyfa/eos",
        "errors": [],
    }
