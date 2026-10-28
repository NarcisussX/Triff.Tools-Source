from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from pyfa_adapter import configure_pyfa, pyfa_root
from pyfa_adapter.calculator import calculate
from pyfa_adapter.combat_profile import SCHEMA_VERSION, combat_profile
from pyfa_adapter.browser import compatible_charges
from pyfa_adapter.damage_profiles import damage_profile_tree
from pyfa_adapter.environment import environment_effect_tree
from pyfa_adapter.eft import export_eft, import_eft
from pyfa_adapter.graphs import calculate_graph, graph_metadata
from pyfa_adapter.implants import fitting_variants, implant_sets
from pyfa_adapter.mutations import compatible_mutaplasmids
from pyfa_adapter.rolling_stats import rolling_stats
from pyfa_adapter.serializers import classify_type
from pyfa_adapter.skill_affectors import affecting_skills
from pyfa_adapter.version_info import installed_version_info


class CalculateRequest(BaseModel):
    shipTypeId: int | None = None
    fitName: str | None = None
    characterMode: str | None = "all_v"
    skillProfile: dict | None = None
    skillOverrides: dict | None = None
    shipMode: dict | None = None
    shipModeId: int | str | None = None
    modeId: int | str | None = None
    damageProfile: dict | None = None
    damageProfileId: int | str | None = None
    modules: dict | None = None
    drones: list | None = None
    fighters: list | None = None
    cargo: list | None = None
    implants: list | None = None
    boosters: list | None = None
    projectedEffects: list | None = None
    environment: dict | None = None
    targetFit: dict | None = None
    sourceFits: list | None = None
    projectedLinks: list | None = None
    commandLinks: list | None = None


class EftImportRequest(BaseModel):
    text: str


class EftExportRequest(BaseModel):
    payload: dict


class GraphRequest(BaseModel):
    payload: dict


class SkillAffectorsRequest(BaseModel):
    payload: dict
    context: dict


class RollingStatsRequest(BaseModel):
    eft: str | None = None
    eftText: str | None = None
    text: str | None = None


app = FastAPI(title="triff.tools fitting-service", version="0.1.0")

GUI_ICON_FILES = {
    "overheat": "state_overheated_small.png",
    "firepower": "turret_big.png",
    "mining": "mining_big.png",
    "defense": "armor_big.png",
    "resources": "cpu_big.png",
    "ship": "ship_small.png",
    "em": "em_big.png",
    "thermal": "thermal_big.png",
    "kinetic": "kinetic_big.png",
    "explosive": "explosive_big.png",
}


@app.on_event("startup")
async def startup() -> None:
    configure_pyfa()


@app.get("/health")
async def health() -> dict:
    configure_pyfa()
    import eos.db

    rifter = eos.db.getItem(587)
    version = installed_version_info(include_latest=True)
    return {
        "ok": True,
        "service": "fitting-service",
        "engine": "pyfa/eos",
        "pyfaRoot": pyfa_root(),
        "pyfaVersion": version.get("installedPyfaVersion"),
        "probeType": rifter.typeName if rifter else None,
        **version,
    }


@app.get("/type/{type_id}")
async def get_type(type_id: int) -> dict:
    try:
        return {"ok": True, "type": classify_type(type_id), "errors": []}
    except Exception as exc:
        return {"ok": False, "type": None, "errors": [{"code": "type_lookup_failed", "message": str(exc)}]}


@app.get("/charges/{type_id}")
async def get_charges(type_id: int) -> dict:
    try:
        return compatible_charges(type_id)
    except Exception as exc:
        return {"ok": False, "charges": [], "errors": [{"code": "charges_lookup_failed", "message": str(exc)}]}


@app.get("/mutaplasmids/{type_id}")
async def get_mutaplasmids(type_id: int) -> dict:
    try:
        return compatible_mutaplasmids(type_id)
    except Exception as exc:
        return {"ok": False, "mutaplasmids": [], "errors": [{"code": "mutaplasmids_lookup_failed", "message": str(exc)}]}


@app.get("/variants/{type_id}")
async def get_variants(type_id: int) -> dict:
    try:
        return fitting_variants(type_id)
    except Exception as exc:
        return {"ok": False, "variants": [], "errors": [{"code": "variants_lookup_failed", "message": str(exc)}]}


@app.get("/implant-sets")
async def get_implant_sets() -> dict:
    try:
        return implant_sets()
    except Exception as exc:
        return {"ok": False, "sets": [], "errors": [{"code": "implant_sets_lookup_failed", "message": str(exc)}]}


@app.get("/environment-effects")
async def get_environment_effects() -> dict:
    try:
        return environment_effect_tree()
    except Exception as exc:
        return {"ok": False, "categories": [], "errors": [{"code": "environment_effects_failed", "message": str(exc)}]}


@app.get("/damage-profiles")
async def get_damage_profiles() -> dict:
    try:
        return damage_profile_tree()
    except Exception as exc:
        return {"ok": False, "profiles": [], "errors": [{"code": "damage_profiles_failed", "message": str(exc)}]}


@app.get("/graphs")
async def get_graphs() -> dict:
    try:
        return graph_metadata()
    except Exception as exc:
        return {"ok": False, "graphs": [], "targetProfiles": [], "errors": [{"code": "graphs_failed", "message": str(exc)}]}


@app.post("/graphs/calculate")
async def calculate_graph_route(request: GraphRequest) -> dict:
    try:
        return calculate_graph(request.payload or {})
    except Exception as exc:
        return {
            "ok": False,
            "points": [],
            "series": [],
            "warnings": [],
            "errors": [{"code": "unhandled_graph_calculation_error", "message": str(exc)}],
        }


@app.get("/icons/{icon_id}")
async def get_icon(icon_id: int) -> FileResponse:
    if icon_id <= 0:
        raise HTTPException(status_code=404, detail="icon_not_found")
    icon_dir = Path(pyfa_root()) / "imgs" / "icons"
    for suffix in ("@2x.png", "@1x.png", ".png"):
        path = icon_dir / f"{icon_id}{suffix}"
        if path.exists():
            return FileResponse(
                path,
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=604800, immutable"},
            )
    raise HTTPException(status_code=404, detail="icon_not_found")


@app.get("/gui-icons/{icon_name}")
async def get_gui_icon(icon_name: str) -> FileResponse:
    filename = GUI_ICON_FILES.get(icon_name)
    if not filename:
        raise HTTPException(status_code=404, detail="icon_not_found")
    path = Path(pyfa_root()) / "imgs" / "gui" / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="icon_not_found")
    return FileResponse(
        path,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=604800, immutable"},
    )


@app.post("/calculate")
async def calculate_route(request: CalculateRequest) -> dict:
    try:
        return calculate(request.dict())
    except Exception as exc:
        return {
            "ok": False,
            "warnings": [],
            "errors": [{"code": "unhandled_calculation_error", "message": str(exc)}],
            "payload": request.dict(),
            "stats": None,
        }


@app.post("/affected-skills")
async def affected_skills_route(request: SkillAffectorsRequest) -> dict:
    try:
        return affecting_skills(request.payload or {}, request.context or {})
    except Exception as exc:
        return {
            "ok": False,
            "skills": [],
            "warnings": [],
            "errors": [{"code": "affected_skills_failed", "message": str(exc)}],
        }


@app.post("/rolling-stats")
async def rolling_stats_route(request: RollingStatsRequest) -> dict:
    try:
        return rolling_stats(request.eft or request.eftText or request.text or "")
    except Exception as exc:
        return {
            "ok": False,
            "ship": None,
            "assumptions": {"skills": "all_v"},
            "summary": None,
            "scenarios": [],
            "warnings": [],
            "errors": [{"code": "unhandled_rolling_stats_error", "message": str(exc)}],
        }


@app.post("/combat-profile")
async def combat_profile_route(request: dict) -> dict:
    try:
        return combat_profile(request)
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Combat profile export failed")
        return {
            "ok": False, "combatProfileSchemaVersion": SCHEMA_VERSION,
            "profile": None, "warnings": [],
            "errors": [{"code": "combat_profile_failed", "message": "The fitting engine could not export this combat profile."}],
        }


@app.post("/import/eft")
async def import_eft_route(request: EftImportRequest) -> dict:
    try:
        return import_eft(request.text)
    except Exception as exc:
        return {
            "ok": False,
            "payload": None,
            "warnings": [],
            "errors": [{"code": "unhandled_import_error", "message": str(exc)}],
            "calculation": None,
        }


@app.post("/export/eft")
async def export_eft_route(request: EftExportRequest) -> dict:
    try:
        return export_eft(request.payload)
    except Exception as exc:
        return {
            "ok": False,
            "text": "",
            "errors": [{"code": "unhandled_export_error", "message": str(exc)}],
        }
