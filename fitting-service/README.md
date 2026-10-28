# triff.tools fitting-service

This service is the isolated Python backend for `/fitting`. It uses Pyfa's `eos` calculation engine as the fitting source of truth and exposes JSON endpoints for the existing Node backend to proxy.

Pyfa is GPL-3.0 and its `eos` engine files are LGPL-family licensed as marked upstream. Each Compose build downloads the latest stable Pyfa release by default and installs the runtime dependencies declared by that release. The image adds a tiny headless `wx` compatibility shim, builds Pyfa's `eve.db` from its bundled staticdata, and verifies a fitting calculation. See [the update workflow](../docs/pyfa-updates.md) for validation and deployment instructions.

Third-party license and modification notices for this service live in `THIRD_PARTY_NOTICES.md`. Repo-wide notices live in the root `THIRD_PARTY_NOTICES.md`.

At runtime the service uses a temporary file-backed Pyfa saved-data SQLite DB so eos can create its expected saved-data tables and built-in "All 5" character without any manual migration step.

Current parity notes:
- Core ship/module/dogma calculations come from Pyfa/eos.
- All fits use Pyfa's built-in "All 5" character.
- EFT import/export supports normal Pyfa clipboard fits with modules, loaded charges, drones, implants, boosters, and cargo.

Rolling stats API:
- Node exposes the public `POST /api/fitting/rolling-stats` route and proxies to this service's `POST /rolling-stats`.
- The request accepts JSON with one of `eft`, `eftText`, or `text`.
- The endpoint imports EFT through the existing fitting-service import path, calculates with All V skills, and reads mass/movement values from Pyfa/eos-derived `stats.navigation`.
- Returned scenarios are intentionally narrow: cold, active and overheated variants for each fitted afterburner/microwarpdrive, and a zero-point scenario only when a fitted Zero-Point Mass Entangler is detectable.
- Bastion, siege, triage, industrial core, cloaks, and similar jump/movement-distorting modules are forced inactive for jumpable rolling scenarios.
- Acceleration is represented by Pyfa/eos-derived `alignTime` and `agility`; the service does not apply a custom acceleration formula.
- The public Node route is unauthenticated and locally rate-limited by IP or signed-in user bucket.

Hardening, Pyfa update, and parity test details live in `docs/HARDENING.md`.
