# Third-Party Notices

This file records the third-party projects that Triff.Tools integrates with directly, especially code that is downloaded, executed, or wrapped by local services.

Triff.Tools' original source code is licensed under `GPL-3.0-or-later`; see `LICENSE` and `LICENSE_POLICY.md`.

## Pyfa / eos

- Project: Pyfa
- Upstream: https://github.com/pyfa-org/Pyfa
- License: GNU GPL v3.0. Pyfa's `eos` engine files are LGPL-family licensed where marked upstream.
- Used by: `fitting-service`
- Default pinned ref: `v2.66.3`, configurable with `FITTING_PYFA_REF`

Triff.Tools does not commit Pyfa source into this repository. The `fitting-service` Docker image downloads a pinned Pyfa archive during image build, installs it under `/opt/pyfa`, and uses Pyfa/eos as the fitting calculation authority behind the internal fitting API.

The exact installed Pyfa ref and archive URL are written to `/opt/pyfa-install.json` inside the image and are reported by `/api/fitting/health` through the backend proxy.

### Local Modifications And Glue

- `fitting-service/pyfa_adapter` is Triff.Tools glue code that imports Pyfa/eos and exposes the calculation, import/export, browser, implant, booster, mutation, and environment behavior needed by `/fitting`.
- During image build, `fitting-service/Dockerfile` writes a small `/opt/pyfa/wx.py` compatibility shim so Pyfa's `db_update.py` can run in a headless Linux container without the desktop wxPython UI runtime. This shim was added by Triff.Tools in May 2026. Its complete source is embedded in `fitting-service/Dockerfile`.
- Pyfa's upstream license and copyright notices remain in the downloaded Pyfa source tree under `/opt/pyfa`.

For fitting-service specific notes, see `fitting-service/THIRD_PARTY_NOTICES.md` and `fitting-service/docs/HARDENING.md`.

## EVE Online Static Data And Assets

Triff.Tools uses EVE Online static data, public ESI data, and EVE image server assets to provide EVE Online tools. EVE Online and related marks, names, and assets are owned by CCP hf. Triff.Tools is not affiliated with or endorsed by CCP hf.

## EVEMon behavioral reference

- Project: EVEMon
- Upstream: https://github.com/mgoeppner/evemon
- Audited ref: `32c11fec99e8db825939d025bf2aa62e3f681438`
- Upstream license: GNU GPL version 2 only (`GPL-2.0-only`; no “or later” grant)
- License text: https://github.com/mgoeppner/evemon/blob/32c11fec99e8db825939d025bf2aa62e3f681438/LICENSE

EVEMon was reviewed as a behavioral and historical reference for Skillnix skill mechanics and plan compatibility. Because Triff.Tools is `GPL-3.0-or-later`, EVEMon's GPL-2.0-only code is treated as an incompatible source boundary. Triff.Tools does not copy, translate, bundle, download, link, or execute EVEMon source or assets. The Skillnix domain layer is an independent clean-room implementation using EVE mechanics, current SDE/ESI schemas, and provenance-labeled expected-output fixtures. See `docs/evemon-integration.md`.
