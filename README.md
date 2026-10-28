# TriffTools

TriffTools is the source for [triff.tools](https://triff.tools), a multi-service EVE Online utility site focused on wormhole, market, industry, fitting, and planning workflows.

The repo contains a React frontend, an Express/Postgres backend, background market workers, and a Python fitting sidecar built around Pyfa/eos.

## What Is In Here

The application includes calculators, planners, browsers, and game/reference tools:

- Mining and resource calculators: gas huffing, ore mining, ore reprocessing, PI, reactions, blue loot splits, participation splits.
- Industry tools: manufacturing cost planning, build-vs-buy trees, BPC copy scheduling, job-cost support, and market-aware material pricing.
- Market tools: item market browser, regional order/history views, station price APIs, appraisals, quickbar, and shareable appraisal links.
- Item/reference tools: item browser, dogma/traits/industry relations, POS planner, wormhole database, wormhole sites, rolling mass, time conversion, and wormhole structure stats.
- Character and fitting tools: Skillnix multi-character monitoring and skill plans, Pyfa-backed fitting workspace, saved fits, ESI skill profiles, and hard-requirement handoff between fits/ships and plans.
- Community/game tools: Anoikis Command, battle report generation, status pages, contact form, and account-owned saved tool state.

## Repository Map

| Path | Purpose |
| --- | --- |
| `frontend/` | React 18 + Vite + Tailwind application. Main route shell lives in `frontend/src/App.tsx`. |
| `backend/` | Node 20 / Express API, Postgres schema setup, route handlers, workers, SDE import scripts, and bot embed rendering. |
| `fitting-service/` | FastAPI sidecar for the `/fitting` tool. Builds a Pyfa game DB during Docker build and exposes fitting calculations to the backend. |
| `market-worker/` | Separate Node worker for market aggregation support. |
| `data/` | Local static data used by selected tools. |
| `docker-compose.yml` | Production-style local stack: frontend, backend, Postgres, workers, Traefik, and fitting service. |
| `Accounts.md` | Site account model, auth/session behavior, account-owned saves, and per-tool persistence notes. |
| `anoikis-command.md` | Current game design and mechanics reference for Anoikis Command. |
| `THIRD_PARTY_NOTICES.md` | Repo-wide third-party notices. Service-specific notes may exist in subdirectories. |
| `docs/evemon-integration.md` | Skillnix behavior audit, clean-room licensing decision, architecture mapping, ESI limits, and implementation status. |

## Services

`docker-compose.yml` defines the main runtime stack:

| Service | Role |
| --- | --- |
| `triffnix-frontend` | Builds the Vite frontend and serves it with nginx. Proxies `/api` to the backend in containerized runs. |
| `triffnix-backend` | Express API on port `3000`. Seeds wormholes, initializes shared schemas, mounts all API routes, and starts scheduled backend jobs. |
| `postgres` | Postgres 16 database for market data, SDE slices, account data, saves, appraisals, reports, and game state. |
| `fitting-service` | Python/FastAPI Pyfa/eos calculation engine for fitting stats and EFT import/export support. |
| `market-worker` | Market aggregation worker. |
| `market-orders-worker` | Imports CCP SDE data and polls live ESI market orders. |
| `market-history-worker` | Imports rolling market history into `market_history_daily`. |
| `traefik` | TLS/reverse proxy configuration for hosted domains. |

## Data Sources

The project uses several data inputs. Keep these boundaries clear when changing tools:

- **CCP SDE**: imported by backend scripts into the `evesde` schema for types, groups, dogma, blueprints, market groups, stations, and map data.
- **ESI**: used for live market orders, character/skill data, SSO-linked characters, public lookups, and other live EVE data.
- **Everef market history**: `market-history-worker` imports rolling daily market history CSVs from `data.everef.net` into `market_history_daily`.
- **Pyfa/eos**: downloaded during the fitting-service Docker build and used as the fitting calculation source of truth.
- **Checked-in local data**: wormhole data, site data, PI/resource tables, static tool data, and fallback datasets live in the repo.
- **Killmail/public battle-report sources**: battle report and structure-intel features use public upstream APIs where configured.

The CCP SDE import is not Everef. In this codebase, the active Everef dependency to watch is the market-history feed used by Market Browser, market history APIs, and selected bot embeds.

## Local Docker Run

Copy the example environment file and fill in the values that apply to the feature set you are running:

```bash
cp .env.example .env
```

For the full Compose stack, `DATABASE_URL` should point at the Compose Postgres service:

```env
DATABASE_URL=postgres://user:pass@postgres:5432/triffnix
PGSSL=false
```

The example file includes placeholders/defaults for contact webhooks, price warmup, R2Z2 polling, public base URLs, EVE SSO credentials, and ESI token encryption.

The EVE SSO applications are deliberately separate:

- `EVE_SSO_*` is only for TriffFits skill profiles and requests `publicData` plus `esi-skills.read_skills.v1`.
- `SKILLNIX_EVE_SSO_*` is only for Skillnix. Its production callback is `https://triff.tools/api/character-monitor/esi/callback`; grant `publicData`, `esi-skills.read_skills.v1`, `esi-skills.read_skillqueue.v1`, `esi-clones.read_implants.v1`, `esi-clones.read_clones.v1`, and `esi-wallet.read_character_wallet.v1`.
- `EVE_FITTINGS_SSO_*` is only for importing saved in-game fittings.

Skillnix is in a closed, link-only test at `/skillnix`; it is intentionally absent from the landing page and Neocom.

Start the stack:

```bash
docker compose up --build -d
```

Useful local URLs:

- Frontend: `http://localhost:8080`
- Backend API: `http://localhost:3000`
- API docs: `http://localhost:3000/api/docs`
- ReDoc: `http://localhost:3000/api/redoc`

Useful commands:

```bash
docker compose ps
docker compose logs -f triffnix-backend
docker compose logs -f market-orders-worker
docker compose logs -f market-history-worker
```

To rebuild data-heavy services after SDE-related changes:

```bash
docker compose build --no-cache triffnix-backend market-orders-worker market-history-worker
```

## Local App Development

For frontend-only work:

```bash
cd frontend
npm install
npm run dev
```

For backend work outside Compose, provide a reachable `DATABASE_URL` first:

```powershell
cd backend
npm install
$env:DATABASE_URL="postgres://user:pass@localhost:5432/triffnix"
npm start
```

The Compose Postgres service is not published to the host by default. Either run backend code inside Compose, publish Postgres locally for development, or point `DATABASE_URL` at another development database.

## Tests And Checks

There is no single root test command. Use the service-level checks that match the change:

```bash
cd frontend
npm run build
```

```bash
cd backend
npm test
```

```bash
cd backend
npm run test:integration
```

```bash
cd fitting-service
pytest
```

```bash
cd frontend
npm run dev
```

```bash
cd frontend
FRONTEND_BASE_URL=http://127.0.0.1:5173 npm run test:smoke
```

The backend integration suite uses Docker to start a disposable `postgres:16` container. The frontend smoke suite expects a running frontend server and checks that core SPA routes return the app shell. The fitting service also has parity/smoke helpers under `fitting-service/scripts/` and focused tests under `fitting-service/tests/`.

## API And Persistence Notes

- API docs are generated from `backend/openapi.yaml` and served at `/api/docs` and `/api/redoc`.
- Account/session behavior and account-owned tool saves are documented in `Accounts.md`.
- Generic saved setups live behind `/api/tool-setups/:toolKey`.
- Generic remembered tool state lives behind `/api/tool-state/:toolKey`.
- Specialized persistence exists for fitting saves, item bookmarks, wormhole bookmarks, appraisals, battle reports, and Anoikis Command saves.

## Operational Notes

- The backend creates and migrates many tables idempotently at startup or route initialization time.
- `market-orders-worker` imports CCP SDE data before polling ESI market orders.
- `market-history-worker` retains 420 complete UTC days of raw market history. Every sync discovers missing dates across that entire window, including the additional older days on an existing 365-day installation, even when `totals.json` is unavailable. Available totals also repair incomplete days atomically. Hull Activity at `/hulls` uses the preceding 7/30/365 calendar days; the selected day is excluded and missing days count as zero.
- The frontend nginx config proxies `/api` to `triffnix-backend:3000` in Docker.
- Traefik labels target `triff.tools`, `www.triff.tools`, and `dev.triff.tools` for hosted deployments.

## Licensing

This project is licensed as GPL-3.0-or-later. See `LICENSE`, `LICENSE_POLICY.md`, and `THIRD_PARTY_NOTICES.md`.

Subservices may include additional third-party notices. For example, fitting-service details Pyfa/eos licensing and update notes in `fitting-service/README.md` and `fitting-service/docs/HARDENING.md`.
