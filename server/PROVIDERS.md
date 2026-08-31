# Provider integration notes

What each provider actually returns, verified against the live APIs rather
than assumed from documentation. Where a capability does not exist, that is
recorded here instead of being worked around silently.

---

## 1. Alchemy — Robinhood Chain

`src/providers/alchemy/alchemy-chain-provider.ts`

| Check | Result |
| --- | --- |
| `eth_chainId` | `0x1237` → **4663**, matches Robinhood Chain mainnet |
| `net_version` | `4663` |
| `eth_blockNumber` | responds |
| `alchemy_getAssetTransfers` | **available** on this chain |

The enhanced API is confirmed at runtime by `supportsEnhancedApi()`, which
probes once and caches. `getTokenTransfers()` uses it when present and falls
back to `eth_getLogs` filtered on the ERC-20 `Transfer` topic over a bounded
block window when it is not — so the provider works on a plain JSON-RPC
endpoint too.

Everything else is standard JSON-RPC: `getLatestBlock`, `getBlock`,
`getTransaction`, `getTransactionReceipt`, `getLogs`.

`ROBINHOOD_WS_URL` is configured but not yet subscribed to. Websocket
subscriptions are only worth opening once something consumes a live stream;
polling the head every `ONCHAIN_REFRESH_INTERVAL_SECONDS` is enough today and
costs far less.

---

## 2. Robinhood official Stock Token API

`src/providers/robinhood/robinhood-stock-token-provider.ts`

No API key. Documented at
<https://docs.robinhood.com/chain/stock-token-apis/> and verified live.

| Endpoint | Returns | Limits |
| --- | --- | --- |
| `GET /rhj/assets` | 194 stock tokens with deployments, multipliers, status | 60 req/s |
| `GET /rhj/prices/{symbol}` | bid, ask, currency, daily volume, halt flag | 60 req/s, 15s cache |
| `GET /rhj/corporate-actions` | dividends and splits with process dates | 60 req/s, 1h cache |

Fields present in the live response but absent from the published schema —
`dailyHigh`, `dailyLow`, `mintBurnTokenVolume`, `mintBurnUsdVolume`,
`networkName` — are read defensively.

**Price derivation:** the API publishes bid and ask, not a last price. Strata
uses the mid, and falls back to whichever side exists when the book is
one-sided (a halted token). It publishes no intraday change, so
`priceChange1h` / `priceChange24h` are left absent rather than fabricated; the
compute engine derives movement from stored history instead.

---

## 3. CoinGecko

`src/providers/coingecko/coingecko-provider.ts`

Demo key sent as `x-cg-demo-api-key`. Verified against `/ping` and
`/coins/markets`.

Ingestion uses the **batch** `/coins/markets` call — one request covers the
whole universe, which keeps a ~30/min demo allowance comfortable. Per-asset
calls would exhaust it immediately.

CoinGecko keys on ids, not tickers, and tickers are ambiguous across listings,
so `COINGECKO_IDS` maps symbol → id explicitly rather than guessing.

`getLiquidity()` returns `null`: the markets endpoint publishes no book depth,
and inventing one would corrupt the liquidity factor.

---

## 4. Blockscout

`src/providers/blockscout/blockscout-provider.ts`

**There is no Blockscout instance for Robinhood Chain.** Both
`robinhood.blockscout.com` and `robinhood-mainnet.blockscout.com` return 404.

Consequence, and the reason the source-priority table reads the way it does:
chain 4663 is served by **Alchemy alone**. `supportsChain(4663)` is `false`,
and the ingestion job skips those assets rather than substituting a different
chain's data.

Verified working on the per-chain instances (ethereum, base, optimism,
arbitrum): `/stats`, `/tokens/{address}`, `/tokens/{address}/holders`,
`/addresses/{address}/transactions`.

Endpoint availability differs between instances, so every call treats a 404 as
"this instance does not offer it" and returns `null`.

---

## 5. Alpha Vantage

`src/providers/alphavantage/alphavantage-provider.ts`

**The binding constraint is 25 requests per day** on the free tier, plus a
request-per-second ask. Verified: the second call in a burst returned an
`Information` notice.

Two things follow, and they shape the whole equity path:

1. **Throttling arrives as HTTP 200.** Alpha Vantage does not return 429 — it
   returns a success status with an `Information` key. This is why the shared
   HTTP client supports body-based throttle detection.
2. **The daily quota is enforced locally.** `RateLimiter` counts calls against
   `ALPHA_VANTAGE_DAILY_LIMIT` and refuses rather than spending a budget it
   cannot see. The ingestion job rotates through a small slice of symbols per
   pass and stops when fewer than two calls remain; the health check skips its
   probe near the limit rather than spending the quota it is reporting on.

`getAssets()` returns `[]` — there is no free "list everything" endpoint, and
discovery is not this provider's job. The equity universe comes from Robinhood
stock tokens.

**Volume conversion:** Alpha Vantage reports share count. The compute engine
expects notional, so `quoteToSnapshot` multiplies by price.

---

## 6. GoPlus

`src/providers/goplus/goplus-provider.ts`

Authentication verified: `POST /api/v1/token` with `app_key`, `time`, and
`sign = sha1(app_key + time + app_secret)` returns a bearer token. A failed
exchange degrades to anonymous access rather than disabling security lookups.

**Robinhood Chain is not supported.** GoPlus lists 43 chains; 4663 is not among
them. `supportsChain()` is driven by that live list, and unsupported tokens are
counted as skipped — never reported as having passed a security check.

**No invented score.** GoPlus publishes individual flags, not a composite, so
`securityScore` stays `null` and every raw flag is preserved in `flags` for a
future Strata-computed score. Booleans arrive as `"0"` / `"1"` strings and
absent fields mean "not determined", so the mapper returns `null` rather than
`false`.

---

## Source priority

Declared in `src/providers/registry.ts` as `SOURCE_PRIORITY` and surfaced on
`/api/health`. A provider is never silently swapped for another: if the primary
source for a capability is down, that capability degrades and is reported,
because attributing data to the wrong source is worse than having none.

| Domain | Priority |
| --- | --- |
| Robinhood stock tokens | Robinhood official API → Alchemy (onchain verification) |
| Robinhood Chain | Alchemy only (Blockscout does not index 4663) |
| Crypto markets | CoinGecko |
| Equities | Alpha Vantage |
| Indexed onchain | Blockscout (ethereum, base, optimism, arbitrum) |
| Token security | GoPlus (4663 unsupported upstream) |

Every stored record carries its `source`, and every API response reports
`meta.mock` and `meta.source`.
