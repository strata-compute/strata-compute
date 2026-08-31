# Strata Compute — Backend

The computation layer. Ingests market data, normalizes it, computes the Strata
Score and derived views, and serves them over a read-only REST API.

```
DATA SOURCES → INGESTION → NORMALIZATION → DATABASE
                                              ↓
                         COMPUTATION ENGINE → STRATA API → FRONTEND
```

Node.js 22.6+ (TypeScript runs natively — no build step in development),
Express 5, Postgres, zod. No ORM, no scheduler framework.

---

## Required accounts

| Provider | What it supplies | Key needed |
| --- | --- | --- |
| [Alchemy](https://alchemy.com) | Robinhood Chain RPC + enhanced APIs | yes |
| [Robinhood Stock Token API](https://docs.robinhood.com/chain/stock-token-apis/) | Stock token metadata, quotes, corporate actions | **no** |
| [CoinGecko](https://coingecko.com/api) | Crypto market data | yes (demo tier works) |
| [Blockscout](https://blockscout.com) | Indexed onchain data | yes |
| [Alpha Vantage](https://alphavantage.co) | Equity quotes and fundamentals | yes (free = 25/day) |
| [GoPlus](https://gopluslabs.io) | Token security flags | app key + secret |

See [PROVIDERS.md](PROVIDERS.md) for what each one actually returns, verified
against the live APIs.

## Configure

```bash
cd server
npm install
cp .env.example .env.local     # or .env — both are read, .env.local wins
```

Fill in the credentials. The only ones that gate a capability:

```bash
MARKET_PROVIDER=live           # `mock` needs no credentials at all

ALCHEMY_RPC_URL=https://robinhood-mainnet.g.alchemy.com/v2/<key>
ROBINHOOD_CHAIN_ID=4663
COINGECKO_API_KEY=<key>
BLOCKSCOUT_API_KEY=<key>
ALPHA_VANTAGE_API_KEY=<key>
GOPLUS_APP_KEY=<key>
GOPLUS_APP_SECRET=<secret>
```

A missing credential disables that one capability and is logged — it never
stops the service from starting.

## PostgreSQL

Optional. Without `DATABASE_URL` the service runs on the in-memory store,
reports `degraded` on `/api/health`, and stamps every response
`meta.source: "memory"` — honest about not persisting rather than pretending to.

```bash
# macOS
brew install postgresql@16 && brew services start postgresql@16
# Linux
sudo apt install postgresql && sudo systemctl start postgresql
# Docker
docker run -d --name strata-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16

createdb strata
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/strata
npm run migrate
```

`npm run migrate` applies every file in `migrations/` once, in filename order,
each inside a transaction, recording them in `schema_migrations`.

## Run

```bash
npm run dev        # http://localhost:4000
```

Startup runs one ingestion pass so the API has data immediately. Background
jobs are separate and off by default:

```bash
JOBS_ENABLED=true npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Watch mode, native TS |
| `npm test` | 42 tests, no network |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Emit `dist/` |
| `npm start` | Run `dist/` |
| `npm run migrate` | Apply pending migrations |

## Verify provider health

```bash
curl -s localhost:4000/api/health | jq '.data.providers'
```

```json
{
  "robinhood_stock_tokens": { "status": "healthy", "detail": "194 stock tokens listed" },
  "alchemy":                { "status": "healthy", "detail": "chain 4663 at block 49074061" },
  "coingecko":              { "status": "healthy", "detail": "(V3) To the Moon!" },
  "blockscout":             { "status": "healthy", "detail": "indexing 4 chains; Robinhood Chain (4663) not indexed" },
  "alpha_vantage":          { "status": "healthy", "detail": "quote ok, 25 calls left today" },
  "goplus":                 { "status": "healthy", "detail": "43 chains supported, authenticated" }
}
```

Per-provider ingestion state — last sync, records stored, errors:

```bash
curl -s localhost:4000/api/compute/status | jq '.data.providers, .data.providerErrors'
```

## Run ingestion jobs

Each provider has its own job at its own cadence, because their limits differ
by orders of magnitude (CoinGecko tolerates a two-minute loop; Alpha Vantage
allows 25 calls a **day**).

| Job | Default cadence | Env |
| --- | --- | --- |
| `ingest-robinhood-stock-tokens` | 120s | `MARKET_REFRESH_INTERVAL_SECONDS` |
| `ingest-crypto-markets` | 120s | `MARKET_REFRESH_INTERVAL_SECONDS` |
| `ingest-robinhood-chain` | 300s | `ONCHAIN_REFRESH_INTERVAL_SECONDS` |
| `ingest-onchain-index` | 300s | `ONCHAIN_REFRESH_INTERVAL_SECONDS` |
| `ingest-stocks` | 3600s | `STOCK_REFRESH_INTERVAL_SECONDS` |
| `ingest-security-data` | 21600s | `SECURITY_REFRESH_INTERVAL_SECONDS` |
| `compute-metrics` | 60s | `JOB_COMPUTE_INTERVAL_MS` |

Compute reads what ingestion stored rather than fetching itself — which is what
keeps one provider outage from stopping scoring for the domains still healthy.

---

## Layout

```
src/
  config/         validated environment — the only reader of process.env
  utils/          logger, errors, timestamp and numeric coercion
  types/          the domain contract shared by every layer
  providers/      provider interfaces + the mock implementation + registry
  normalization/  provider shape → NormalizedMarketData
  compute/        versioned scoring engine, registry, run status
  signals/        detector interface + six detectors + runner
  rankings/       ranking projection, reused by the arena
  arena/          rounds and standings
  ingestion/      provider → normalize → persist
  database/       store interface, Postgres + memory implementations, migrations
  cache/          cache interface + memory / no-op drivers
  jobs/           job contract, scheduler, definitions
  intelligence/   detection, significance, event lifecycle, market detectors
  api/            express app, middleware, routes, DTOs
  pipeline.ts     the composition root for one full pass
```

Two rules hold this together:

1. **Nothing above the provider layer imports a provider.** Ingestion, compute,
   signals, rankings, arena and the API depend on `MarketDataProvider`.
   Swapping the mock for a real provider is a change in
   `providers/registry.ts` and nowhere else.
2. **Nothing outside `database/` imports `pg`.** Services depend on the
   `StrataStore` interface, which has two implementations.

---

## The pipeline

`pipeline.ts` is the only file that knows the order of operations:

```
runIngestion()      provider snapshots → normalize → upsert assets, prices, snapshots
runComputation()    NormalizedMarketData + peer context → ComputedMetrics + score
rankAssets()        projection over the computed metrics
runDetectors()      six detectors over the current pass and the previous one
runIntelligenceDetection()  detectors over each asset's own stored history,
                    reconciled against the events already open
syncRoundStandings() arena entries from the same ranking function
```

The API binds its port before this runs. The pass refreshes what the store
already holds rather than creating it, and a detection pass that reads history
for every covered asset takes long enough that binding afterwards would mean
minutes of refused connections on every restart.

---

## Intelligence

`intelligence/` answers a narrower question than scoring does: *what changed,
by how much, is it meaningful, what caused it, and how confident are we?*

The unit is an **event**, and an event is a condition that persists — not a
moment that passed. A signal fires when a threshold is crossed and expires on a
timer. An intelligence event says "this has been true since 10:03, it still is,
and here is how far it has come". The same condition observed across fifteen
passes is one event seen fifteen times, never fifteen events.

```
windows.ts           what "recent" means, and when there is not enough of it
significance.ts      how much credit a condition earns for having held
detectors.ts         nine per-asset detectors, pure functions over series
market-detectors.ts  breadth, rotation, regime shift
engine.ts            significance floor, severity, priority, lifecycle
pass.ts              read history → detect → reconcile → persist
```

Four properties are load-bearing:

- **Nothing triggers on price alone.** Detectors read computed evidence —
  score, its components, rank, volume against its own baseline. An asset can
  rise or fall on nothing, and neither is intelligence.
- **Significance is a product**, not a mean:
  `magnitude × persistence × historicalDeviation × dataConfidence`. Any one
  reading near zero collapses the result, which is correct — a huge move, seen
  once, on data we do not trust is not a finding. The persistence term has a
  floor, because without one no first detection could ever clear the raising
  threshold and the engine would be permanently silent while merely looking
  quiet.
- **Deduplication is a schema property.** At most one open event per
  `(asset_id, event_type)`, enforced by a partial unique index, so it holds
  even if the reconciliation code is wrong.
- **Resolved is not expired.** A condition measured to have ended is
  `resolved`; one that stopped being observed is `expired`. Conflating them
  would let a pipeline outage read as a market change.

Windows are `15m / 1h / 4h / 24h / 7d`. A window must meet both an observation
count and a span — dense recent history satisfies the 4h count while covering
one hour, and a baseline named "4h" that never saw four hours is a mislabelled
claim rather than a weaker one.

---

## Scoring versions

`compute/versions/v1.ts` is a **development formula**, not the finished Strata
Score. Its contract:

- pure — same input and context give the same output, no I/O;
- five factors, each 0–100, combined by published weights
  (momentum 28%, volume 22%, activity 18%, liquidity 18%, market strength 14%);
- factors computed from missing inputs are reported in `degradedFactors`
  rather than silently defaulted.

A new formula is a new file plus one line in `compute/registry.ts`. Every score
row and compute event stores the version that produced it, so history stays
interpretable across changes.

---

## Mock data

`MockMarketProvider` generates structurally realistic data from an invented
catalogue. It is **not market data**, and the service says so at every layer:
`isMock: true` on snapshots, `meta.mock: true` on responses,
`usingMockData` in `/api/compute/status`, and a provider health detail that
reads *"synthetic development provider — not market data"*.

It deliberately reproduces provider misbehaviour — dropped fields, numbers as
strings, epoch-second timestamps — so the normalization layer is exercised
rather than bypassed.

---

## API

Every response is `{ data, meta }`. Every error is
`{ error: { code, message, details? }, meta }`.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | Store, database, providers, cache, jobs |
| GET | `/api/assets` | `?type=&search=&limit=&offset=` |
| GET | `/api/assets/:id` | Accepts an id or a symbol |
| GET | `/api/markets` | Latest price + metrics + score per asset |
| GET | `/api/markets/:id` | Adds metric and score history |
| GET | `/api/rankings` | `?metric=score\|momentum\|volume\|activity&type=&limit=` |
| GET | `/api/signals` | `?type=&assetType=&assetId=&sinceMinutes=&limit=` |
| GET | `/api/arena` | Current round, standings, recent rounds |
| GET | `/api/arena/:round` | One round by number |
| GET | `/api/compute/status` | State, version, weights, timings, job states |
| GET | `/api/compute/metrics/:assetId` | Current metrics + history for one asset |
| GET | `/api/intelligence` | `?type=&assetType=&severity=&status=&since=&limit=` — open conditions by default |
| GET | `/api/intelligence/event/:id` | One event with its drivers and significance |
| GET | `/api/intelligence/assets/:assetId` | Active and recent events for one asset |
| GET | `/api/intelligence/market` | Breadth, regime, and open events grouped by kind |

`meta.source` is `database` or `memory`; `meta.mock` is true when any figure in
the payload came from the mock provider.

---

## Operational notes

- **Jobs** are off by default (`JOBS_ENABLED=false`). Intervals are configured,
  never hardcoded. The scheduler skips a tick rather than queueing when a run
  overruns, and a failing job never crashes the process.
- **Logging** is one JSON line per event, with `provider` / `asset` / `job` /
  `computation` / `requestId` context. Keys that look like credentials are
  redacted before serialisation.
- **Errors** are converted to `AppError` before they reach a client; 5xx
  messages are replaced with a generic string in production.
- **Rate limiting** is an interface with a per-process fixed-window driver.
- **CORS** is an allowlist from `CORS_ORIGINS`.
- **Secrets** live only in `server/.env`. No provider key is ever sent to the
  frontend — the browser only talks to this API.
- **Detection reads in bulk.** `getDetectionSeries` and `getRankSeries` fetch
  every asset's history in one statement each. The per-asset variants exist for
  scripts; using them in the pass cost 161s of a 189s cycle, against 6s for the
  batched form.

### Development scripts

| Command | What it does |
| --- | --- |
| `npm run verify:schema` | Compares TypeScript vocabularies against the database's CHECK constraints |
| `npm run verify:intelligence` | Audits the events table: statuses, duplicate open events, conditions carried across passes |
| `npm run replay:intelligence` | Replays the detectors over stored history and prints what would have been raised. Read-only |
| `npm run calibrate:replay` | Replays the scoring formula over stored observations |
| `npm run validate:score` | Ordering, explanation and monotonicity checks on the current scores |

None of them write. Replay in particular exists to see what a threshold change
would have done *before* it goes near production data.
