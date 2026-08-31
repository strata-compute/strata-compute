# Strata Compute

**One computation layer. Every market.**

A Next.js frontend, a standalone Node/Express backend and a Supabase
PostgreSQL database. Real market providers, a versioned compute engine, the
Strata Score, an intelligence engine and background jobs. There is no mock
data path in production — the switch was removed rather than defaulted off.

| Route | What it is |
| --- | --- |
| `/` | Public landing page — positioning and the computation story |
| `/about` · `/platform` | Why Strata exists, and how the platform is put together |
| `/docs` · `/status` | Public methodology and pipeline health |
| `/app/*` | The console — Overview, Arena, Rankings, Assets, Signals, Activity, Watchlist, Compare, Compute |

The backend lives in [`server/`](server/README.md) as a separate service,
with its own README covering the pipeline, scoring and intelligence engines.

`/app` redirects to `/app/overview`, so "Launch App" can point at the short
URL. The landing page is marketing only; every feature CTA routes into the
matching console page.

```bash
# frontend
npm install
npm run dev          # http://localhost:3000
npm run typecheck
npm run build

# backend — see server/README.md
cd server && npm install && npm run dev
```

Deploying is documented under [Running in production](#running-in-production).

---

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Radix primitives ·
cmdk · Lucide. Charts are hand-built SVG — no charting dependency.

---

## Design system

Tokens live in [`app/globals.css`](app/globals.css) under `@theme`. Nothing
hardcodes a hex value; components reference token utilities (`bg-surface`,
`text-muted`, `border-border`).

| Token | Value | Use |
| --- | --- | --- |
| `bg` | `#080A09` | Page ground |
| `surface` / `surface-2` / `elevated` | `#101412` → `#1A211C` | Cards, rows, controls |
| `border` / `border-strong` | `#202621` / `#2B332D` | Hairlines, hover borders |
| `text` / `muted` / `faint` | `#F2F5F3` / `#8A938D` / `#5B635E` | Type hierarchy |
| `green` / `green-bright` | `#CCFF00` / `#DDFF4D` | Brand accent — see below |
| `red` / `amber` / `blue` | `#FF4B4B` / `#E5A50A` / `#4C8DFF` | Signal semantics only |

**Accent discipline (roughly 90 / 8 / 2).** The brand accent is a high-luminance
lime, so it is used less, not more: positive movement, live
indicators, active navigation, high scores, primary CTAs and the
selected chart series. Progress rails, factor bars, momentum bars and score
rails below the top of the distribution are all neutral — that is what keeps the
accent readable in a dense table. As a fill it always carries dark text
(`text-bg`), never light.

Type is Inter with JetBrains Mono for every number. All numerics are tabular.

---

## Architecture

```
app/
  layout.tsx             document, fonts, tokens — no chrome of its own
  not-found.tsx          global 404, standalone
  (marketing)/           the public site
    layout.tsx           landing nav + footer
    page.tsx             /
    about/               /about — purpose and stage
    platform/            /platform — how the platform is built
    docs/                /docs — methodology and API surface
    status/              /status — pipeline health
  app/                   the console, mounted at /app
    layout.tsx           AppShell (sidebar, topbar, command palette)
    overview/            /app/overview     arena/         Arena
    rankings/            Rankings          assets/        Assets + [symbol]
    signals/             Signals           compute/       Compute
    settings/            Settings          loading.tsx per route, error, not-found

components/
  landing/    nav, hero + engine, ticker, problem, pipeline, score preview,
              arena preview, signals, categories, infrastructure, CTA, footer
  layout/     app shell, sidebar, topbar, hero, page header, command menu,
              page transition, skeletons
  ui/         button, primitives (card/badge/skeleton/empty state/status dot),
              segmented control, tooltip, search input
  data/       asset table + column library, asset/arena/metric/signal cards,
              score primitives, live price, animated number, ticker, round timer
  charts/     sparkline, area chart (measured, with crosshair), multi-line
  sections/   page-level compositions (arena/, asset/, compute/, …)

lib/
  types.ts        the domain contract every component depends on
  routes.ts       every internal URL — nothing hardcodes a path
  utils.ts        formatters, seeded PRNG, deterministic path builders
  nav.ts          console navigation config
  landing-data.ts every number the landing page renders
  api/            typed client for the Strata API — the only data source
  data/           server-only resolvers; a failure becomes an explicit
                  unavailable state, never a fallback value
```

**Routing.** `lib/routes.ts` is the single source of truth for internal URLs.
The console is mounted at `APP_BASE = "/app"`; changing that constant moves the
whole console without touching a component. `/docs` and `/status` sit outside
that base because they are public pages, and the console sidebar links out to
them. The `/app` → `/app/overview` redirect lives in `next.config.mjs`, so it
resolves before a render happens.

Two rules hold the structure together:

1. **Pages compose, components render.** No page defines table cells, card
   markup or chart internals. The asset table, for example, is driven by a
   column library — a page picks `["asset", "price", "change", "score"]` rather
   than redefining cells.
2. **Everything renders on the server unless it needs not to.** Only genuinely
   interactive pieces are client components (filters, sorting, tabs, the
   palette, ticking values). Detail-page tab panels are server-rendered and
   passed into the client tab bar as props.

---

## Determinism

Server and client markup must match, so nothing calls `Math.random()` or
`Date.now()` during render:

- Relative times are stored as `minutesAgo` / `secondsAgo` integers, not
  timestamps, and resolve to the same string everywhere.
- The clock, ticking quotes, round timer and battle feed all start from the
  seeded value and only begin moving after mount.

---

## Running in production

### Architecture

Three pieces, deployed independently:

```
  browser ──► Next.js frontend ──► Strata API ──► Supabase PostgreSQL
             (renders on server)   (Node/Express)  (source of truth)
                                        │
                                        └──► market data providers
```

The browser never talks to the API or to a provider. Pages render on the
server, and the few client-side calls go to same-origin route handlers in
`app/api/*` that proxy onward. Two consequences worth knowing: no provider
credential can reach a client bundle, and the API's public surface is
effectively just the frontend.

Nothing else is required. No queue, no cache server, no orchestrator — the
scheduler runs inside the backend process and the cache is in-memory.

### Required environment

**Frontend** — see [`.env.example`](.env.example):

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | Deployed backend URL, no trailing slash. **Required**: a production build without it fails rather than silently pointing at localhost. |
| `PORT` | Usually set by the host. |

**Backend** — see [`server/.env.example`](server/.env.example):

| Variable | Notes |
| --- | --- |
| `NODE_ENV` | `production`. Enables the startup guards below. |
| `PORT` | Usually set by the host. |
| `DATABASE_URL` | Supabase **session pooler** (port 5432), not the direct host — the direct host is IPv6-only. Percent-encode reserved characters in the password. |
| `DATABASE_SSL` | `true` for any managed Postgres. |
| `DATABASE_CA_CERT` | Optional PEM path. Without it the connection is encrypted but the server is unauthenticated. |
| `DATABASE_POOL_MAX` | Per instance. Must stay inside the database plan's own connection ceiling. |
| `DATA_STORE` | `postgres`. `memory` is refused under `NODE_ENV=production`. |
| `DATA_MODE` | `live`. Anything else is refused under `NODE_ENV=production`. |
| `CORS_ORIGINS` | The frontend origin. **Required** in production; `*` is refused. |
| `JOBS_ENABLED` | `true` on exactly one instance. See scaling below. |
| `TRUST_PROXY` | `true` only when a proxy in front actually sets `X-Forwarded-For`. |
| Provider keys | `COINGECKO_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `ALCHEMY_API_KEY`, `BLOCKSCOUT_API_KEY`, `GOPLUS_APP_KEY`, `GOPLUS_APP_SECRET`. A missing key disables that capability and says so; it is never replaced with synthetic data. |

Secrets belong in the host's environment or `server/.env`. Both `.env` and
`.env.local` are gitignored; only the `.env.example` templates are tracked.

### Startup guards

The backend refuses to start, rather than starting wrong, when:

- `NODE_ENV=production` and `DATA_MODE` is not `live`
- `NODE_ENV=production` and `DATA_STORE=memory`
- `NODE_ENV=production` and `DATABASE_URL` is unset
- the database is unreachable — there is no in-memory fallback
- `CORS_ORIGINS` is unset in production, or contains `*`
- no market data source is configured at all

Each names the specific problem; configuration errors exit `78` (EX_CONFIG).

### Database and migrations

Migrations are forward-only, applied in filename order, each inside a
transaction, and recorded in `schema_migrations`. **They do not run at
startup** — deploying a new build never alters the schema on its own.

```bash
cd server
npm run migrate            # apply pending migrations
npm run verify:schema      # TypeScript vocabularies vs the CHECK constraints
npm run verify:database    # tables, migrations, indexes, constraints, row counts
```

Run `migrate` as an explicit step before starting the new build.
`verify:schema` exists because a value set drifting from its CHECK constraint
has taken a pipeline pass down three times; run it after any migration.

### Production commands

```bash
# backend
cd server
npm ci
npm run build                       # tsc → dist/
npm run migrate                     # explicit, not automatic
NODE_ENV=production node dist/index.js

# frontend
npm ci
npm run build                       # NEXT_PUBLIC_API_BASE_URL must be set here
NODE_ENV=production npm start
```

`npm run dev` and `node --watch` are development commands and must not serve
production traffic.

`NEXT_PUBLIC_API_BASE_URL` is read at **build** time, not run time. Changing
the backend URL means rebuilding the frontend.

### Health checks

| Endpoint | Use |
| --- | --- |
| `GET /api/ready` | Readiness probe. ~100ms, checks the database only, 503 when it is unreachable. |
| `GET /api/health` | Liveness and diagnostics: `healthy` / `degraded` / `unhealthy`, per-source status, last ingestion, last computation, open intelligence events. |

Point the platform's probe at `/api/ready`. `/api/health` also probes
providers and takes longer; it stays 200 while a single provider is down,
because a degraded service is still worth serving traffic. In production it
omits provider error prose and the source priority list.

### Scaling

The backend holds two pieces of process-local state: the scheduler and the
in-memory event buffer behind the live stream. Run **one instance with
`JOBS_ENABLED=true`**. Further read-only instances (`JOBS_ENABLED=false`) can
serve API traffic, but each keeps its own event buffer, so a client's live feed
would depend on which instance it reached. One instance is the supported
configuration for launch.

### Shutdown

On `SIGTERM`/`SIGINT` the backend stops the scheduler, stops listening, ends
open SSE streams (they never close on their own and would otherwise hold the
process until a timer forced it), waits up to 12s for a running pass, closes
the pool and exits 0. A second signal during shutdown is ignored rather than
restarting the sequence.

### Troubleshooting

| Symptom | Cause |
| --- | --- |
| Startup exits 78 | A configuration guard fired; the message names the variable. |
| `Strata requires PostgreSQL and could not reach it` | `DATABASE_URL`, `DATABASE_SSL`, or the host. Supabase's direct host is IPv6-only — use the session pooler. |
| Frontend build fails on `NEXT_PUBLIC_API_BASE_URL` | Set it in the build environment; it is inlined at build time. |
| `503 Market data temporarily unavailable` | Transient database contention: the pool could not hand out a connection within 5s. Raise `DATABASE_POOL_MAX` if it persists. |
| Health is `degraded` | A provider is failing. `/api/health` names which outside production; a rate-limited free tier is the usual cause. |
| Pages render "unavailable" panels | The API is unreachable, or has no data for that resource. This is the designed state, not a crash — check `/api/ready`. |
| Shutdown takes ~20s | Something did not drain; look for `shutdown timed out` in the logs. |

---

## Landing page

Sections in order: hero (with the live computation engine graphic), market
ticker, the problem, the pipeline, the Strata Score preview, the Arena, the
signal feed, market coverage, the architecture, final CTA.

Every section is a preview with a CTA into the console — a ranked list rather
than a working ranking, five signal cards rather than a feed. The score preview
and coverage sections are server-rendered; their bars fill on scroll through a
CSS rule keyed off the reveal attribute, so no client component is needed.

Section headlines are set in caps to match the hero statement. Long-form pages
(`/docs`, `/status`) stay in sentence case.

**Navigation.** The marketing navbar is deliberately short — About, Platform,
Docs, and `Open App` as the strongest element. Feature navigation lives in the
console sidebar, not here: the site explains the product, the app holds the
tools. Every marketing section links into the matching `/app` page rather than
reproducing it.

Three pieces carry motion, and all three respect `prefers-reduced-motion`:

- **Hero engine** — market rows enter, five modules scan, one score leaves.
  Drawn as a schematic with hairline rails and travelling packets rather than a
  dashboard card, so it reads as the computation itself.
- **Arena preview** — rows swap position on a timer. The rising row is given a
  higher stacking order and an opaque background so it passes over the falling
  one instead of colliding with it, and scores are adjusted on each swap so the
  order stays consistent with the numbers that produced it.
- **Pipeline and coverage bus** — packets travel the connectors between stages.

Headline copy is set in sentence case except the hero statement, which is the
brand line and runs in caps.

## Interaction notes

- `⌘K` / `Ctrl+K` opens the command palette; `/` opens it from anywhere;
  `S` focuses search on the Assets page.
- Segmented controls and detail tabs are arrow-key navigable with roving
  tabindex and correct ARIA roles.
- Tables expose `aria-sort`; sortable headers are buttons.
- Every route has a skeleton (`loading.tsx`), and empty states exist for
  filtered tables, the signal feed, per-asset signals and eliminations.
- `prefers-reduced-motion` disables ticking, count-ups and chart draw-in.
