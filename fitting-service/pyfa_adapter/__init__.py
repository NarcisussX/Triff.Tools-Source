import os
import sys
import tempfile
import threading

_LOCK = threading.Lock()
_INITIALIZED = False


def pyfa_root() -> str:
    return os.environ.get("PYFA_ROOT", "/opt/pyfa")


def configure_pyfa() -> None:
    global _INITIALIZED
    if _INITIALIZED:
        return

    with _LOCK:
        if _INITIALIZED:
            return

        root = pyfa_root()
        if root not in sys.path:
            sys.path.insert(0, root)

        import eos.config

        game_db = os.environ.get("PYFA_GAME_DB", os.path.join(root, "eve.db"))
        eos.config.gamedata_connectionstring = "sqlite:///" + game_db.replace("\\", "/")
        default_saveddata_db = os.path.join(tempfile.gettempdir(), "triff_pyfa_saveddata.sqlite")
        eos.config.saveddata_connectionstring = os.environ.get(
            "PYFA_SAVEDDATA_DB",
            "sqlite:///" + default_saveddata_db.replace("\\", "/"),
        )
        eos.config.settings = {
            "useStaticAdaptiveArmorHardener": False,
            "strictSkillLevels": True,
            "globalDefaultSpoolupPercentage": 1.0,
        }
        eos.config.set_lang("en")

        import eos.db

        if getattr(eos.db, "saveddata_meta", None) is not None:
            eos.db.saveddata_meta.create_all(bind=eos.db.saveddata_engine)

        _INITIALIZED = True
