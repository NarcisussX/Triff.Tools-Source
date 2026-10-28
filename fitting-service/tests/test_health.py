from __future__ import annotations

import asyncio

from app import health


def test_health_reports_pyfa_versions() -> None:
    result = asyncio.run(health())
    assert result["ok"] is True
    assert result["service"] == "fitting-service"
    assert result["engine"] == "pyfa/eos"
    assert result["installedPyfaVersion"]
    assert result["installedPyfaRef"]
    assert "installedEosVersion" in result
    assert result["pythonVersion"]
    assert "latestKnownPyfaVersion" in result
    assert "latestCheckOk" in result
    assert "latestCheckError" in result
