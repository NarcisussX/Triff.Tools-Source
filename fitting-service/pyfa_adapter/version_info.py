from __future__ import annotations

import json
import os
import platform
import time
import urllib.request
from pathlib import Path
from typing import Any

from . import configure_pyfa, pyfa_root


LATEST_RELEASE_URL = "https://api.github.com/repos/pyfa-org/Pyfa/releases/latest"
DEFAULT_LATEST_TTL_SECONDS = 6 * 60 * 60

_LATEST_CACHE: dict[str, Any] = {
    "checkedAt": 0.0,
    "version": None,
    "ok": False,
    "error": None,
}


def _read_json(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    file_path = Path(path)
    if not file_path.exists():
        return {}
    try:
        return json.loads(file_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _read_version_yml() -> str | None:
    version_path = Path(pyfa_root()) / "version.yml"
    if not version_path.exists():
        return None
    try:
        text = version_path.read_text(encoding="utf-8")
    except Exception:
        return None
    for line in text.splitlines():
        if line.strip().startswith("version:"):
            return line.split(":", 1)[1].strip()
    return text.strip() or None


def _latest_cache_ttl() -> float:
    try:
        return float(os.environ.get("FITTING_PYFA_LATEST_TTL_SECONDS", DEFAULT_LATEST_TTL_SECONDS))
    except ValueError:
        return float(DEFAULT_LATEST_TTL_SECONDS)


def _fetch_latest_release() -> tuple[str | None, bool, str | None]:
    request = urllib.request.Request(
        LATEST_RELEASE_URL,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "triff-tools-fitting-service-health",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=2.0) as response:
            payload = json.loads(response.read().decode("utf-8"))
        tag = payload.get("tag_name")
        if not tag:
            return None, False, "GitHub latest release response did not include tag_name"
        return tag, True, None
    except Exception as exc:
        return None, False, str(exc)


def latest_pyfa_release() -> dict[str, Any]:
    now = time.time()
    if now - float(_LATEST_CACHE.get("checkedAt") or 0) < _latest_cache_ttl():
        return {
            "latestKnownPyfaVersion": _LATEST_CACHE.get("version"),
            "latestCheckOk": bool(_LATEST_CACHE.get("ok")),
            "latestCheckError": _LATEST_CACHE.get("error"),
        }

    version, ok, error = _fetch_latest_release()
    _LATEST_CACHE.update({
        "checkedAt": now,
        "version": version,
        "ok": ok,
        "error": error,
    })
    return {
        "latestKnownPyfaVersion": version,
        "latestCheckOk": ok,
        "latestCheckError": error,
    }


def installed_version_info(include_latest: bool = True) -> dict[str, Any]:
    configure_pyfa()
    import eos

    metadata = _read_json(os.environ.get("PYFA_INSTALL_METADATA"))
    installed_version = metadata.get("installedPyfaVersion") or _read_version_yml()
    installed_ref = metadata.get("resolvedPyfaRef") or os.environ.get("PYFA_REF") or installed_version
    requested_ref = metadata.get("requestedPyfaRef") or os.environ.get("PYFA_REF")
    eos_version = getattr(eos, "__version__", None) or (
        f"bundled-with-{installed_version}" if installed_version else None
    )

    data = {
        "installedPyfaVersion": installed_version,
        "installedPyfaRef": installed_ref,
        "requestedPyfaRef": requested_ref,
        "installedEosVersion": eos_version,
        "pythonVersion": platform.python_version(),
        "pyfaInstallMetadata": metadata or None,
    }
    if include_latest:
        data.update(latest_pyfa_release())
    else:
        data.update({
            "latestKnownPyfaVersion": None,
            "latestCheckOk": False,
            "latestCheckError": "latest check skipped",
        })
    return data
