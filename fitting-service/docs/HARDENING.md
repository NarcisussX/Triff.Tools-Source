# Fitting-service hardening notes

## Current Pyfa/eos integration

`fitting-service` uses Pyfa's bundled `eos` engine as the calculation authority. Pyfa is not installed from pip and is not vendored in this repository. The Docker image resolves the latest stable Pyfa release by default, downloads its GitHub archive, and installs the runtime dependencies from that archive's `pyproject.toml`. It places Pyfa at `/opt/pyfa`, adds that path to `PYTHONPATH`, writes a tiny headless `wx.py` compatibility shim, then runs Pyfa's `db_update.py` to build `/opt/pyfa/eve.db` from the bundled staticdata. Dependency consistency and a fitting calculation are checked during the build.

Runtime does not `git pull`, `pip install`, or mutate Pyfa. The browser still talks only to the existing Node backend at `/api/fitting/*`; Node proxies calculation/import/export requests to `fitting-service`.

## License and modification record

Pyfa is GPL-3.0 and its `eos` engine files are LGPL-family licensed as marked upstream. The image keeps Pyfa's upstream license and copyright notices in the downloaded `/opt/pyfa` tree.

The Docker build writes `/opt/pyfa/wx.py`, a small Triff.Tools compatibility shim added in May 2026. It exists only to satisfy Pyfa build-time imports while running `db_update.py` in a headless Linux container. The shim source is embedded directly in `fitting-service/Dockerfile`, so the corresponding source for this local modification is available in this repository.

See `../THIRD_PARTY_NOTICES.md` and the repo root `THIRD_PARTY_NOTICES.md` for the public notice record.

## Installed version reporting

The build writes `/opt/pyfa-install.json` with:

- requested Pyfa ref
- resolved Pyfa ref
- archive URL
- installed Pyfa version parsed from `version.yml`
- runtime requirements exported from that release's `pyproject.toml`

`GET /health` reports that metadata as `installedPyfaVersion`, `installedPyfaRef`, `requestedPyfaRef`, `installedEosVersion`, `pythonVersion`, and `pyfaInstallMetadata`.

The health endpoint also tries to read the latest Pyfa GitHub release with a short timeout and an in-memory cache. A failed latest-release check never fails health; it returns `latestKnownPyfaVersion: null`, `latestCheckOk: false`, and `latestCheckError`.

## Updating Pyfa intentionally

Default builds use `latest` via `FITTING_PYFA_REF`. Compose disables the fitting-service build cache so every build checks the latest release. Its dependencies follow that release rather than a separate list of old version pins. See [the update workflow and reviewed baseline changes](../../docs/pyfa-updates.md).

Windows CMD-friendly examples:

```cmd
docker compose build fitting-service
docker compose up -d fitting-service triffnix-backend
```

Build a specific Pyfa tag/ref:

```cmd
set FITTING_PYFA_REF=v2.69.0 && docker compose build fitting-service && docker compose up -d fitting-service triffnix-backend
```

Build the latest GitHub release at image build time:

```cmd
set FITTING_PYFA_REF=latest && docker compose build fitting-service && docker compose up -d fitting-service triffnix-backend
```

You can also pass Docker's build arg directly:

```cmd
docker compose build --build-arg PYFA_REF=latest fitting-service
docker compose up -d fitting-service triffnix-backend
```

`latest` is resolved during image build only. The running container does not self-update.

## Running tests

Run the full fitting-service tests:

```cmd
docker compose exec fitting-service pytest
```

Run only parity snapshots:

```cmd
docker compose exec fitting-service pytest tests/test_parity_snapshots.py
```

Run the lightweight smoke check:

```cmd
docker compose exec fitting-service python scripts/smoke.py
```

## Blessing parity snapshots

Normal tests never update snapshots. To deliberately regenerate expected values from the currently installed Pyfa/eos:

```cmd
docker compose exec fitting-service python scripts/bless_parity_snapshots.py
```

Snapshot metadata marks these as generated baselines. When adding or changing fixtures, compare the generated values against desktop Pyfa before committing the snapshot.

## Current parity coverage

The snapshot harness asserts stable normalized values for ship identity, fit name, CPU, powergrid, calibration, HP, resists, EHP, capacitor, DPS/volley, navigation, targeting, drone bandwidth, and warning/error codes.

Current fixtures cover:

- passive armor Punisher
- missile/bastion Golem
- turret armor Leshak
- drone Gila
- active armor/cap-sensitive Myrmidon
- scripted/charged Omen
