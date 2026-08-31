import { env } from "../config/env.ts";
import { getCache } from "../cache/index.ts";
import { resolveCompanyLogos } from "../providers/logos/company-logo.ts";
import { getStore } from "../database/index.ts";
import {
  getChainProvider,
  getCryptoProvider,
  getOnchainIndexProvider,
  getSecurityProvider,
  getStockProvider,
  getStockTokenProvider,
} from "../providers/registry.ts";
import type { RawMarketSnapshot } from "../types/domain.ts";
import type { NormalizedSecurityData } from "../types/providers.ts";
import { describeError, logger } from "../utils/logger.ts";
import { nowIso } from "../utils/time.ts";
import { persistSnapshots, type PersistResult } from "./persist.ts";
import { recordAttempt, recordFailure, recordSuccess } from "./provider-stats.ts";

/**
 * One ingestion routine per provider.
 *
 * Each follows the same shape — FETCH → NORMALIZE → VALIDATE → STORE → LOG —
 * and each is independently failable: a provider that is down records its
 * error and returns, so the other domains keep ingesting. Nothing here throws
 * to the scheduler.
 */

export interface IngestionOutcome {
  provider: string;
  ok: boolean;
  fetched: number;
  stored: number;
  duplicates: number;
  rejected: number;
  durationMs: number;
  detail?: string;
}

async function run(
  provider: string,
  fn: () => Promise<Omit<IngestionOutcome, "provider" | "ok" | "durationMs">>,
): Promise<IngestionOutcome> {
  const started = performance.now();
  recordAttempt(provider);

  try {
    const result = await fn();
    const durationMs = Number((performance.now() - started).toFixed(1));

    recordSuccess(provider, {
      fetched: result.fetched,
      stored: result.stored,
      rejected: result.rejected,
      durationMs,
    });

    logger.info("ingestion complete", {
      provider,
      fetched: result.fetched,
      stored: result.stored,
      duplicates: result.duplicates,
      rejected: result.rejected,
      durationMs,
    });

    return { provider, ok: true, durationMs, ...result };
  } catch (error) {
    const durationMs = Number((performance.now() - started).toFixed(1));
    recordFailure(provider, error);
    logger.error("ingestion failed", { provider, durationMs, ...describeError(error) });
    return {
      provider,
      ok: false,
      fetched: 0,
      stored: 0,
      duplicates: 0,
      rejected: 0,
      durationMs,
      detail: error instanceof Error ? error.message : "ingestion failed",
    };
  }
}

function summarise(result: PersistResult) {
  return {
    fetched: result.fetched,
    stored: result.stored,
    duplicates: result.duplicates,
    rejected: result.rejected.length,
  };
}

/* ------------------------------------------- 1. Robinhood stock tokens --- */

/**
 * Primary source for Robinhood stock tokens. Metadata comes from /rhj/assets,
 * quotes from /rhj/prices/{symbol}. Quotes are per-symbol, so the universe is
 * capped per pass to stay well inside the published 60 req/s.
 */
export async function ingestRobinhoodStockTokens(limit = 40): Promise<IngestionOutcome> {
  const provider = getStockTokenProvider();
  if (!provider) {
    return {
      provider: "robinhood_stock_tokens",
      ok: false,
      fetched: 0,
      stored: 0,
      duplicates: 0,
      rejected: 0,
      durationMs: 0,
      detail: "provider not configured",
    };
  }

  return run("robinhood_stock_tokens", async () => {
    const cache = getCache();

    const tokens = await cache.wrap(
      "robinhood:assets",
      env.CACHE_TTL_METADATA_SECONDS,
      () => provider.getStockTokens(),
    );

    const symbols = tokens.slice(0, limit).map((t) => t.symbol);

    // Robinhood's own logoUrl is the same token badge for every stock, so the
    // company mark is resolved separately and verified before use. A ticker
    // the CDN does not know simply has no logo.
    const companyLogos = await resolveCompanyLogos(symbols);

    const snapshots: RawMarketSnapshot[] = [];

    for (const symbol of symbols) {
      try {
        const quote = await provider.getStockTokenPrice(symbol);
        if (quote) {
          // carry the catalogue identity onto the quote: the price endpoint
          // publishes neither the display name nor the artwork
          const meta = tokens.find((t) => t.symbol === symbol);
          snapshots.push({
            ...quote,
            name: meta?.name ?? symbol,
            logoUrl: companyLogos.get(symbol.toUpperCase()),
          });
        }
      } catch (error) {
        logger.warn("stock token quote failed", {
          provider: "robinhood_stock_tokens",
          asset: symbol,
          ...describeError(error),
        });
      }
    }

    const result = await persistSnapshots("robinhood_stock_tokens", snapshots);
    return summarise(result);
  });
}

/* ------------------------------------------------- 2. Crypto markets ----- */

export async function ingestCryptoMarkets(): Promise<IngestionOutcome> {
  const provider = getCryptoProvider();
  if (!provider) {
    return {
      provider: "coingecko",
      ok: false,
      fetched: 0,
      stored: 0,
      duplicates: 0,
      rejected: 0,
      durationMs: 0,
      detail: "provider not configured",
    };
  }

  return run("coingecko", async () => {
    const cache = getCache();
    // one batch call covers the whole universe
    const snapshots = await cache.wrap(
      "coingecko:markets",
      env.CACHE_TTL_MARKET_SECONDS,
      () => provider.getMarketSnapshots([]),
    );
    const result = await persistSnapshots("coingecko", snapshots);
    return summarise(result);
  });
}

/* --------------------------------------------------- 3. Equities -------- */

/**
 * Alpha Vantage free tier is 25 requests a day. Ingesting the whole equity
 * universe every pass is impossible, so a small slice rotates each run and
 * the job stops early when the daily budget is nearly gone.
 *
 * The rotation is driven by which symbols were observed least recently, read
 * from the database, rather than by a counter held in memory. A counter reset
 * to zero on every restart, so the head of the list was polled repeatedly
 * while the tail could go indefinitely without an observation — the more
 * often the service restarted, the worse the starvation.
 */

export async function ingestStocks(batchSize = 3): Promise<IngestionOutcome> {
  const provider = getStockProvider();
  if (!provider) {
    return {
      provider: "alpha_vantage",
      ok: false,
      fetched: 0,
      stored: 0,
      duplicates: 0,
      rejected: 0,
      durationMs: 0,
      detail: "ALPHA_VANTAGE_API_KEY not configured",
    };
  }

  return run("alpha_vantage", async () => {
    const remaining = provider.remainingCallsToday;
    if (remaining !== null && remaining <= 2) {
      logger.info("alpha vantage daily budget nearly spent — skipping pass", {
        provider: "alpha_vantage",
        remaining,
      });
      return { fetched: 0, stored: 0, duplicates: 0, rejected: 0 };
    }

    const store = getStore();
    const assets = await store.listAssets({ assetType: "stock", limit: 500 });
    if (assets.length === 0) return { fetched: 0, stored: 0, duplicates: 0, rejected: 0 };

    // Rotate by staleness: whichever symbols have gone longest without an
    // observation go first. Derived from stored history rather than a
    // counter, so a restart resumes the rotation instead of returning to the
    // head of the list and starving the tail.
    const take = Math.min(batchSize, remaining ?? batchSize, assets.length);

    const observedAt = new Map<string, number>();
    for (const asset of assets) {
      const [latest] = await store.getObservationHistory(asset.id, 1);
      observedAt.set(
        asset.symbol,
        latest ? new Date(latest.timestamp).getTime() : 0,
      );
    }

    const slice = [...assets]
      .sort(
        (a, b) =>
          (observedAt.get(a.symbol) ?? 0) - (observedAt.get(b.symbol) ?? 0) ||
          a.symbol.localeCompare(b.symbol),
      )
      .slice(0, take)
      .map((asset) => asset.symbol);

    const snapshots: RawMarketSnapshot[] = [];
    for (const symbol of slice) {
      try {
        const quote = await provider.getQuote(symbol);
        if (quote) {
          const { quoteToSnapshot } = await import(
            "../providers/alphavantage/alphavantage-provider.ts"
          );
          snapshots.push(quoteToSnapshot(quote));
        }
      } catch (error) {
        logger.warn("equity quote failed", {
          provider: "alpha_vantage",
          asset: symbol,
          ...describeError(error),
        });
      }
    }

    const result = await persistSnapshots("alpha_vantage", snapshots);
    return summarise(result);
  });
}

/* ---------------------------------------------- 4. Robinhood Chain ------ */

/**
 * Chain-level observation. This does not produce market snapshots — it
 * records chain liveness and recent transfer activity, which later phases
 * fold into the activity factor.
 */
export interface ChainIngestionResult {
  chainId: number;
  blockNumber: number;
  blockTimestamp: string;
  transferSample: number;
  enhancedApi: boolean;
}

let lastChainObservation: ChainIngestionResult | null = null;

export function getLastChainObservation(): ChainIngestionResult | null {
  return lastChainObservation;
}

export async function ingestRobinhoodChain(): Promise<IngestionOutcome> {
  const provider = getChainProvider();
  if (!provider) {
    return {
      provider: "alchemy",
      ok: false,
      fetched: 0,
      stored: 0,
      duplicates: 0,
      rejected: 0,
      durationMs: 0,
      detail: "no Robinhood Chain RPC configured",
    };
  }

  return run("alchemy", async () => {
    const block = await provider.getLatestBlock();
    const enhanced = await provider.supportsEnhancedApi();

    // a small bounded sample; the spec is explicit about not polling hard
    const transfers = await provider.getTokenTransfers({ limit: 25 });

    lastChainObservation = {
      chainId: block.chainId,
      blockNumber: block.number,
      blockTimestamp: block.timestamp,
      transferSample: transfers.length,
      enhancedApi: enhanced,
    };

    const store = getStore();
    await store.insertComputeEvents([
      {
        assetId: null,
        eventType: "CHAIN_OBSERVED",
        inputData: { chainId: block.chainId, blockNumber: block.number },
        outputData: lastChainObservation,
        computationVersion: env.COMPUTE_VERSION,
        createdAt: nowIso(),
      },
    ]);

    return { fetched: transfers.length, stored: 1, duplicates: 0, rejected: 0 };
  });
}

/* ------------------------------------------------- 5. Token security ---- */

const securityByToken = new Map<string, NormalizedSecurityData>();

export function getSecuritySnapshot(
  chainId: number,
  address: string,
): NormalizedSecurityData | null {
  return securityByToken.get(`${chainId}:${address.toLowerCase()}`) ?? null;
}

export function listSecuritySnapshots(): NormalizedSecurityData[] {
  return [...securityByToken.values()];
}

/**
 * Security checks for onchain assets that have a contract address on a chain
 * GoPlus actually supports. Tokens on unsupported chains — Robinhood Chain
 * among them — are skipped and counted, never reported as clean.
 */
export async function ingestSecurityData(limit = 5): Promise<IngestionOutcome> {
  const provider = getSecurityProvider();
  if (!provider) {
    return {
      provider: "goplus",
      ok: false,
      fetched: 0,
      stored: 0,
      duplicates: 0,
      rejected: 0,
      durationMs: 0,
      detail: "provider not configured",
    };
  }

  return run("goplus", async () => {
    const store = getStore();
    const cache = getCache();
    const assets = await store.listAssets({ assetType: "onchain", limit: 200 });

    const candidates = assets.filter((asset) => asset.contractAddress);
    let checked = 0;
    let skipped = 0;

    for (const asset of candidates.slice(0, limit)) {
      // chain id is not stored on the asset row yet; onchain assets in the
      // current universe are Ethereum-deployed unless stated otherwise
      const chainId = asset.chain === "base" ? 8453 : 1;

      if (!provider.supportsChain(chainId)) {
        skipped += 1;
        continue;
      }

      const key = `security:${chainId}:${asset.contractAddress}`;
      const security = await cache.wrap(key, env.CACHE_TTL_SECURITY_SECONDS, () =>
        provider.getTokenSecurity(chainId, asset.contractAddress as string),
      );

      if (security) {
        securityByToken.set(`${chainId}:${security.tokenAddress}`, security);
        checked += 1;
      }
    }

    if (skipped > 0) {
      logger.info("security checks skipped for unsupported chains", {
        provider: "goplus",
        count: skipped,
      });
    }

    return { fetched: checked + skipped, stored: checked, duplicates: 0, rejected: skipped };
  });
}

/* ------------------------------------------------- 6. Onchain index ----- */

export async function ingestOnchainIndex(limit = 5): Promise<IngestionOutcome> {
  const provider = getOnchainIndexProvider();
  if (!provider) {
    return {
      provider: "blockscout",
      ok: false,
      fetched: 0,
      stored: 0,
      duplicates: 0,
      rejected: 0,
      durationMs: 0,
      detail: "provider not configured",
    };
  }

  return run("blockscout", async () => {
    const store = getStore();
    const assets = await store.listAssets({ assetType: "onchain", limit: 200 });
    const candidates = assets.filter((a) => a.contractAddress).slice(0, limit);

    let observed = 0;
    let unsupported = 0;

    for (const asset of candidates) {
      const chainId = asset.chain === "base" ? 8453 : 1;
      if (!provider.supportsChain(chainId)) {
        unsupported += 1;
        continue;
      }

      const activity = await provider.getAddressActivity(
        chainId,
        asset.contractAddress as string,
      );
      if (!activity) continue;

      await store.insertComputeEvents([
        {
          assetId: asset.id,
          eventType: "ONCHAIN_OBSERVED",
          inputData: { chainId, address: activity.address },
          outputData: activity,
          computationVersion: env.COMPUTE_VERSION,
          createdAt: nowIso(),
        },
      ]);
      observed += 1;
    }

    return {
      fetched: candidates.length,
      stored: observed,
      duplicates: 0,
      rejected: unsupported,
    };
  });
}
