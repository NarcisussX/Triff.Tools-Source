from __future__ import annotations

import importlib.util
import json
import tarfile
from pathlib import Path

import pytest


# Pyfa also has a scripts package on PYTHONPATH; load our installer by its path.
_spec = importlib.util.spec_from_file_location(
    "install_pyfa", Path(__file__).resolve().parents[1] / "scripts" / "install_pyfa.py"
)
install_pyfa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(install_pyfa)


def test_latest_release_installs_its_own_runtime_requirements(tmp_path, monkeypatch):
    source = tmp_path / "release"
    source.mkdir()
    (source / "version.yml").write_text("version: v2.69.0\n", encoding="utf-8")
    (source / "pyproject.toml").write_text(
        '[project]\ndependencies = ["sqlalchemy==2.0.51", "numpy==2.5.1"]\n'
        '[dependency-groups]\nwx-source = ["wxPython==4.3.1"]\n'
        'dev = ["ruff==0.16.1"]\n',
        encoding="utf-8",
    )
    archive = tmp_path / "release.tar.gz"
    with tarfile.open(archive, "w:gz") as handle:
        handle.add(source, arcname="Pyfa-v2.69.0")

    monkeypatch.setattr(install_pyfa, "request_json", lambda url: {"tag_name": "v2.69.0"})

    def download(ref, destination):
        assert ref == "v2.69.0"
        destination.write_bytes(archive.read_bytes())
        return f"https://example.test/{ref}.tar.gz"

    monkeypatch.setattr(install_pyfa, "download_archive", download)
    root = tmp_path / "installed"
    metadata = tmp_path / "metadata.json"
    monkeypatch.setattr("sys.argv", ["install_pyfa.py", "--root", str(root), "--metadata", str(metadata)])
    install_pyfa.main()

    requirements = (root / "requirements-headless.txt").read_text(encoding="utf-8")
    assert "sqlalchemy==2.0.51\n" in requirements
    assert "numpy==2.5.1\n" in requirements
    assert "wxPython" not in requirements
    assert "ruff" not in requirements
    installed = json.loads(metadata.read_text(encoding="utf-8"))
    assert installed["requestedPyfaRef"] == "latest"
    assert installed["resolvedPyfaRef"] == installed["installedPyfaVersion"] == "v2.69.0"
    assert installed["pyfaRequirements"] == ["sqlalchemy==2.0.51", "numpy==2.5.1"]


def test_latest_lookup_failure_does_not_fall_back_to_an_old_release(monkeypatch):
    monkeypatch.setattr(install_pyfa, "request_json", lambda url: {})
    with pytest.raises(RuntimeError, match="tag_name"):
        install_pyfa.resolve_ref("latest")


@pytest.mark.parametrize("manifest", [None, "[project]\n", '[project]\ndependencies = []\n'])
def test_missing_upstream_dependencies_fail_instead_of_using_stale_pins(tmp_path, manifest):
    if manifest is not None:
        (tmp_path / "pyproject.toml").write_text(manifest, encoding="utf-8")
    with pytest.raises(RuntimeError, match="manifest|runtime dependencies"):
        install_pyfa.export_requirements(tmp_path)
    assert not (tmp_path / "requirements-headless.txt").exists()
