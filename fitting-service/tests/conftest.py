from __future__ import annotations

import os
import sys
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1]
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

os.environ.setdefault("PYFA_ROOT", "/opt/pyfa")
os.environ.setdefault("PYFA_GAME_DB", "/opt/pyfa/eve.db")
