# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
For people, the same map with diagrams is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What this is

openGym is a self-hosted gym and body-weight tracker. Two containers (`api` + `web`) plus a
`./data` folder the user owns: no third-party account, no telemetry. Passkey (WebAuthn) login,
installable as a PWA, and Capacitor apps for Android and iPhone (with an Apple Watch app and
widgets) that work on their own or synced to a server. License: AGPL-3.0-or-later; the exercise
media are licensed separately (NOTICE.md).

## Project layout

```
frontend/   React 19 + Vite app (src/views, src/components, src/store, src/lib, src/sheets.tsx).
            android/ + ios/ are the Capacitor shells (docs/MOBILE.md); ios/ also holds the watch
            app (Watch, WatchCore, WatchWidgets), the widgets and the animation-pack downloader.
api/        Backend: server.ts (plain node:http) plus small testable modules beside it.
            coach/ is the optional AI coach; coach/core/ is shared with the phone apps.
            openapi.yaml documents every route.
web/        Multi-stage Dockerfile (builds frontend, adds catalogue/media, serves with nginx) and
            nginx.conf.template (serves the app, proxies /api).
catalogue/  The exercise database: exercises/<id>.json, i18n/, licensed 180 px media/.
mcp/        Optional stdio MCP server: reads DATA_DIR, and its one write tool (log_workout)
            saves through the api. Not in the Docker build.
scripts/    Build, CI and release helpers (scripts/README.md).
website/    opengym.ch, plain HTML/CSS/JS, deployed separately.
helm/, kubernetes/, contrib/nix/   Other ways to deploy.
docs/       Guides indexed in docs/README.md; docs/dev/ holds feature design notes.
```

## Commands

```bash
# Local stack (api + web, prebuilt or built from source)
cp .env.example .env
docker compose up -d --build

# Frontend dev server (hot reload), proxies /api to :3000
cd frontend && npm install && npm run dev

# Tests (Node 22, the version CI and the Dockerfiles use)
cd frontend && npm test                          # vitest run, the whole suite
cd frontend && npx vitest run src/lib/progression.test.js   # one file
cd frontend && npx vitest run -t "some test name"           # one test by name
cd api && npm test                               # node --test
cd mcp && npm test

# Checks CI runs besides the suites (run `npm ci` in the repo root once, for js-yaml)
cd frontend && node scripts/check-locales.mjs && node scripts/check-source-strings.mjs --strict
node scripts/catalogue/build.mjs --check
node scripts/build-coach-assets.mjs --check
node scripts/build-api-docs.mjs --check

# Builds
cd frontend && npm run build
cd frontend && npm run build:mobile   # VITE_MOBILE build + 180 px media from catalogue/media + cap sync
```

Business implementations use TS/TSX with strict compilation; explicit legacy dynamic types remain.
Run `npm ci` at the repository root, then `npm run typecheck`; see
`docs/TYPESCRIPT_MIGRATION.zh-CN.md`. Run `npm run check:migration` for the source/debt inventory.
JS compatibility entries and data resource modules are intentionally retained.
There is no linter/formatter config; match the existing style by hand.

GitHub (`github.com/DuarteSantos8/openGym`) is the home of the project; `.github/workflows/mirror.yml`
pushes `main` and `v*` tags to the GitLab mirror (fast-forward only, never push or merge there).
Pull requests are gated by `.github/workflows/test.yml`; `ios.yml` compiles the iPhone app on a Mac
runner. Release packages (APK, Play bundle, App Store IPA) are built and signed on the release
machine, never in CI (see "Exercise media" below and docs/APP_STORES.md).

## Architecture

### Frontend (`frontend/src`)

- **`store/useStore.ts`**: a single Zustand store holding the client-side app state (`S`),
  persisted to `localStorage` (`gym_state_v1`) and debounce-pushed to the server when signed in
  (`pushState`, see `lib/api.ts`). On the phones it is also mirrored to a file via `lib/mobile.ts`
  (`nativeSave`), since WebView storage can be evicted. `store/useUI.ts` holds ephemeral UI state
  (modals, active sheet, rest timer) separately from persisted data.
- **`lib/`**: pure, framework-free helpers, each paired with a same-directory `*.test.js`. The
  domain logic lives here, most importantly:
  - `progression.ts`: the progression-rule engine (linear, Greyskull LP, double and triple
    progression, time-based). Rules implement a shared policy interface.
  - `onerm.ts`: estimated 1RM from logged sets (several formulas).
  - `finish-workout.ts`: reduces a completed session back into state (weights advance, PRs).
  - `recovery.ts` / `recovery-view.ts`: the fatigue and muscle-recovery model.
  - `workout-model.ts`, `supersetFlow.ts`: the in-session workout state machine.
  - `sync-merge.ts`: the field-by-field merge behind the 409 retry (see "Sync" below).
  - `exercises.ts` / `exercises-data.js`: the exercise library (5,632 catalogue exercises plus
    user-defined ones). `exercises-data.js`, `instr/`, `exercise-names/` and `exercise-desc/` are
    generated from `catalogue/` by `scripts/catalogue/build.mjs`; never edit them by hand.
  - `api.ts`: the only place that talks to the backend (`fetch` wrapper, session flows).
  - Native bridges: `mobile.ts` (the `MOBILE` flag, file persistence, notifications),
    `channel.ts` (APK or store build), `watch-sync.ts`, `widgets.ts`, `health-sync.ts`,
    `anim-quality.ts` / `anim-packs.ts` (animation sizes in the store apps).
  - CONTRIBUTING.md is explicit: **anything that decides what you lift next, or reads a logged
    session back, is a pure helper here with a unit test beside it.**
- **Body measurements (`lib/measurements.ts`, `views/Measurements.tsx`)**: one check-in per day.
  Built-in circumferences and legacy custom fields store cm and follow the profile's cm/in
  display. Custom definitions may specify `unit: 'cm' | 'in' | '%' | 'kg' | 'lb' | 'none'`; that
  display choice stays fixed when the profile switches kg/lb. Custom values store canonical cm, kg
  (to 0.001 kg so a tenth of a pound round-trips), percent (0 to 100) or a plain number. Each
  custom reading also carries its unit, preserving its meaning in backups without definitions.
  Once values exist, the unit selector permits cm/in or kg/lb conversions within the recorded
  type; a different type needs a new field. The body CSV names a custom column with its unit,
  "Muscle ratio (%)", and the importer reads those columns back (only from our own header).
- **`views/`**: one file per screen, routed by `react-router-dom` from `App.tsx`.
- **`sheets.tsx`**: the bottom sheets (exercise picker, exercise config, workout detail, plan
  import...). It is large; a new sheet can go into `components/` as its own file.
- **`components/`**: shared UI (charts, modals, timers, media).
- **`locales/`**: one i18n pack per language, keyed by the English string (`lib/i18n.ts`,
  `i18n-core.ts`). A new `t()` string goes into every pack; pt-BR inherits from pt and has a
  fingerprint test (`scripts/pt-br-inheritance-fingerprint.mjs`).

### API (`api/server.ts`)

Plain `node:http`, no framework. Requests are dispatched through a `routes` object keyed by
`'METHOD /path'` (e.g. `routes['GET /api/health']`); add an endpoint by adding a key and its entry
in `openapi.yaml` (`openapi-routes.test.js` compares them). State is JSON under `DATA_DIR`:
`db.json` (users, credentials, push subscriptions, invites) and `state-<uid>.json` per user,
written temp-then-rename (`durable.ts`). Custom-exercise photos and videos live in
`DATA_DIR/uploads` (`media.ts`). Auth is WebAuthn passkeys (`@simplewebauthn/server`), an optional
password, and a signed session cookie (HMAC with `DATA_DIR/secret`); paired phones get the same
session as a bearer token. Optional pieces are gated by env vars: `ADMIN_UIDS`, `INVITE_ONLY`,
`ALLOW_GUEST`, `PASSWORD_LOGIN`, `AUDIT_*`. Web Push (`web-push`, VAPID keys in `data/vapid.json`)
drives rest-timer and reminder notifications.

### Sync

Each profile is one document with a server revision. A device PUTs with the revision it last saw;
if another device wrote in between, the server answers 409 with the current document and the
client merges (`lib/sync-merge.ts`) and retries. Every change carries its own stamp, per setting
and per field, so the newest edit of each wins and deletions stay deleted.

### Code that exists twice on purpose

The API image cannot import the frontend, so some rules are hand-copied. Change both sides
together: `lib/sync-merge.ts` and `api/sync-stamps.ts` (parity test), `lib/glyphs.ts` and
`api/coach/core/glyphs.ts` (parity test), `lib/nudge.ts` and `api/nudge.ts`, `lib/queue.ts` and
`api/queue.ts` (mirrored test cases only, nothing compares the code). The other way round,
`lib/coach-local.ts` imports `api/coach/core/` directly so the phones run the same coach pipeline.

### MCP server (`mcp/src`)

Stdio MCP bridge (`@modelcontextprotocol/sdk`) that reads one user's data straight from
`DATA_DIR`. `state.ts` loads and derives the data, `tools.ts` defines the read tools (zod schemas),
`labels.ts` maps keys to readable labels, `index.ts` wires it together. The one write tool,
`log_workout` (`write-tools.ts`), never writes the file: it builds the workout with
`frontend/src/lib/log-workout.ts` and saves it with `PUT /api/data` over a paired-session token
(`api-client.ts`, `scripts/pair.mjs`), the way a device syncs. See `mcp/README.md`.

### Passkeys and self-hosting constraints

WebAuthn passkeys are bound to an exact hostname (`RP_ID`) and need HTTPS (localhost excepted).
Read `docs/SELF_HOSTING.md` before touching auth, session or notification code; it documents the
env-var contract (`RP_ID`, `ORIGIN`, `PORT`, `WEB_PORT`, `NGINX_PORT`, `BACKEND`, `SESSION_DAYS`,
`ADMIN_UIDS`, `INVITE_ONLY`, `ALLOW_GUEST`, `AUDIT_*`, `VAPID_SUBJECT`) that real deployments
depend on.

### Docker / deploy

`docker-compose.yml` has two services, `api` and `web`. The web image builds `frontend/`, copies
`catalogue/media` into it as `/exercise-media/`, and nginx proxies `/api` to the api (one origin,
which passkeys require). `web/nginx.conf.template` is rendered from env vars at start
(`NGINX_PORT`, `BACKEND`, `PORT`), so remapping works against prebuilt images.

### Exercise media (licence, read before touching media)

The stills and animations are licensed from Gym visual, not AGPL. Only 180 px files may be in the
repository, CI, the web image, the demo or a self-hosted server (`scripts/catalogue/check-media.mjs`
enforces it). Larger sizes exist only inside the APK and store packages, built on the release
machine, or as Apple-hosted / Play asset packs. Never commit, upload or serve anything larger, and
never feed the media to an AI tool.

## Guidelines from CONTRIBUTING.md worth knowing before changing code

- **Dependency-light is a hard constraint.** Frontend: React + Router + Zustand (plus Capacitor
  plugins). `api/`: three dependencies. New dependencies are a hard sell either side.
- Don't commit `data/`. Don't add or replace anything in `catalogue/media/`.
- Training-logic changes (progression, 1RM, session read-back) need a unit test in `src/lib`
  beside the code.
- User-facing text: plain and human, no em dashes. CHANGELOG.md is written at release time.
