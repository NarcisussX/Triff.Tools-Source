# fitting-service Third-Party Notices

`fitting-service` is the isolated Python service that powers Triff.Tools `/fitting`.

Triff.Tools glue code in this service is licensed under `GPL-3.0-or-later`; see the repository root `LICENSE` and `LICENSE_POLICY.md`.

## Pyfa / eos

- Project: Pyfa
- Upstream: https://github.com/pyfa-org/Pyfa
- License: GNU GPL v3.0. Pyfa's `eos` engine files are LGPL-family licensed where marked upstream.
- Default ref: `latest` stable release, configurable with `FITTING_PYFA_REF`

The Docker image downloads Pyfa during build and installs it under `/opt/pyfa`. Pyfa source is not committed into this repository.

The installed Pyfa ref, archive URL, parsed version, and upstream runtime requirements are written to `/opt/pyfa-install.json` by `scripts/install_pyfa.py`. Dependencies are installed from that release's `pyproject.toml`. Runtime version metadata is exposed by the service health endpoint.

## Triff.Tools Modifications And Glue

- `pyfa_adapter/` contains Triff.Tools glue code that imports Pyfa/eos and exposes a JSON service API.
- `Dockerfile` creates `/opt/pyfa/wx.py`, a small headless compatibility shim that lets Pyfa's `db_update.py` run without wxPython. This shim was added by Triff.Tools in May 2026. Its full source is embedded in `Dockerfile`.
- The image runs Pyfa's `db_update.py` to build `/opt/pyfa/eve.db` from the static data bundled with the selected Pyfa ref.

Pyfa's upstream license and notices remain in the downloaded `/opt/pyfa` tree.
