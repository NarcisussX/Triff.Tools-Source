from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import tarfile
import tempfile
import tomllib
import urllib.error
import urllib.request


PYFA_REPO = "pyfa-org/Pyfa"
GITHUB_API_LATEST = f"https://api.github.com/repos/{PYFA_REPO}/releases/latest"
ARCHIVE_CANDIDATES = (
    "https://github.com/pyfa-org/Pyfa/archive/refs/tags/{ref}.tar.gz",
    "https://github.com/pyfa-org/Pyfa/archive/refs/heads/{ref}.tar.gz",
    "https://github.com/pyfa-org/Pyfa/archive/{ref}.tar.gz",
)


def request_json(url: str, timeout: float = 20.0) -> dict:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "triff-tools-fitting-service-build",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def resolve_ref(requested_ref: str) -> tuple[str, str]:
    if requested_ref == "latest":
        data = request_json(GITHUB_API_LATEST)
        tag = data.get("tag_name")
        if not tag:
            raise RuntimeError("GitHub latest release response did not include tag_name")
        return tag, "latest-release"
    return requested_ref, "explicit-ref"


def download_archive(ref: str, destination: pathlib.Path) -> str:
    last_error: Exception | None = None
    for template in ARCHIVE_CANDIDATES:
        url = template.format(ref=ref)
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "triff-tools-fitting-service-build"})
            with urllib.request.urlopen(request, timeout=60.0) as response:
                with destination.open("wb") as handle:
                    shutil.copyfileobj(response, handle)
            return url
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code == 404:
                continue
            raise
        except Exception as exc:
            last_error = exc
            continue
    raise RuntimeError(f"Could not download Pyfa archive for ref {ref}: {last_error}")


def parse_version(root: pathlib.Path) -> str | None:
    version_file = root / "version.yml"
    if not version_file.exists():
        return None
    for line in version_file.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("version:"):
            return line.split(":", 1)[1].strip()
    return version_file.read_text(encoding="utf-8").strip() or None


def export_requirements(root: pathlib.Path) -> list[str]:
    """Use the downloaded release's runtime requirements, excluding optional groups."""
    manifest = root / "pyproject.toml"
    if not manifest.is_file():
        raise RuntimeError(f"Pyfa dependency manifest is missing: {manifest}")
    with manifest.open("rb") as handle:
        project = tomllib.load(handle).get("project", {})
    requirements = project.get("dependencies")
    if not isinstance(requirements, list) or not requirements:
        raise RuntimeError("Pyfa pyproject.toml must declare its runtime dependencies")
    if any(not isinstance(item, str) or not item.strip() or "\n" in item or "\r" in item for item in requirements):
        raise RuntimeError("Pyfa runtime dependencies must be nonempty, single-line requirements")
    # Desktop wxPython, development and packaging tools live in dependency-groups.
    # Install only project.dependencies for the headless calculation service.
    (root / "requirements-headless.txt").write_text(
        "# Generated from this Pyfa release's pyproject.toml\n" + "\n".join(requirements) + "\n",
        encoding="utf-8",
    )
    return requirements


def main() -> None:
    parser = argparse.ArgumentParser(description="Install the latest Pyfa release or an explicit ref into the fitting-service image.")
    parser.add_argument("--ref", default="latest")
    parser.add_argument("--root", default="/opt/pyfa")
    parser.add_argument("--metadata", default="/opt/pyfa-install.json")
    args = parser.parse_args()

    requested_ref = args.ref.strip() or "latest"
    resolved_ref, resolution = resolve_ref(requested_ref)
    pyfa_root = pathlib.Path(args.root)
    metadata_path = pathlib.Path(args.metadata)

    if pyfa_root.exists():
        shutil.rmtree(pyfa_root)
    pyfa_root.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as temp_dir:
        archive_path = pathlib.Path(temp_dir) / "pyfa.tar.gz"
        archive_url = download_archive(resolved_ref, archive_path)
        extract_dir = pathlib.Path(temp_dir) / "extract"
        extract_dir.mkdir()
        with tarfile.open(archive_path, "r:gz") as archive:
            archive.extractall(extract_dir, filter="data")
        extracted_roots = [path for path in extract_dir.iterdir() if path.is_dir()]
        if len(extracted_roots) != 1:
            raise RuntimeError(f"Expected one Pyfa archive root, found {len(extracted_roots)}")
        extracted_roots[0].rename(pyfa_root)

    requirements = export_requirements(pyfa_root)
    installed_version = parse_version(pyfa_root)
    metadata = {
        "requestedPyfaRef": requested_ref,
        "resolvedPyfaRef": resolved_ref,
        "resolution": resolution,
        "archiveUrl": archive_url,
        "installedPyfaVersion": installed_version,
        "pyfaRequirements": requirements,
    }
    metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
