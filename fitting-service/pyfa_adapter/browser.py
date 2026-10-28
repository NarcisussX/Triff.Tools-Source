from __future__ import annotations

from typing import Any

from . import configure_pyfa
from .mutations import compatible_mutaplasmids
from .serializers import item_summary


def compatible_charges(module_type_id: int, limit: int = 160) -> dict[str, Any]:
    configure_pyfa()
    import eos.db
    from eos.db import get_gamedata_session
    from eos.saveddata.module import Module
    from sqlalchemy import bindparam, text

    item = eos.db.getItem(int(module_type_id), eager=("group.category", "attributes", "effects"))
    if item is None:
        return {"ok": False, "charges": [], "errors": [{"code": "unknown_module", "message": "Module typeID was not found."}]}

    try:
        module = Module(item)
    except Exception as exc:
        return {"ok": False, "charges": [], "errors": [{"code": "not_module", "message": str(exc)}]}

    charge_group_ids: set[int] = set()
    for index in range(1, 6):
        value = module.getModifiedItemAttr(f"chargeGroup{index}", None)
        if value:
            charge_group_ids.add(int(value))

    if not charge_group_ids:
        return {"ok": True, "charges": [], "errors": []}

    # SQLAlchemy 2 requires an executable statement instead of a raw SQL string.
    query = text(
        """
        SELECT "typeID"
        FROM invtypes
        WHERE published = 1
          AND "groupID" IN :group_ids
        ORDER BY "typeName"
        LIMIT 500
        """
    ).bindparams(bindparam("group_ids", expanding=True))
    rows = get_gamedata_session().execute(query, {"group_ids": sorted(charge_group_ids)}).fetchall()
    candidate_ids = [int(row[0]) for row in rows]
    charges = []
    for charge in eos.db.getItems(tuple(candidate_ids), eager=("group.category", "attributes")):
        try:
            if module.isValidCharge(charge):
                summary = item_summary(charge) or {}
                summary["chargeGroupId"] = int(charge.groupID)
                summary["chargeGroupName"] = charge.group.name if getattr(charge, "group", None) else None
                charges.append(summary)
        except Exception:
            continue

    charges.sort(key=lambda entry: (entry.get("chargeGroupName") or "", entry.get("typeName") or ""))
    return {"ok": True, "charges": charges[:limit], "errors": []}
