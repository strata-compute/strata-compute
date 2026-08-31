import { env } from "../config/env.ts";
import { scrubSecrets } from "../utils/secrets.ts";
import type { AssetType } from "../types/domain.ts";
import { describeError, logger } from "../utils/logger.ts";
import { AlchemyChainProvider } from "./alchemy/alchemy-chain-provider.ts";
import { AlphaVantageProvider } from "./alphavantage/alphavantage-provider.ts";
import { BlockscoutProvider } from "./blockscout/blockscout-provider.ts";
import { CoinGeckoProvider } from "./coingecko/coingecko-provider.ts";
import { GoPlusProvider } from "./goplus/goplus-provider.ts";
import { RobinhoodStockTokenProvider } from "./robinhood/robinhood-stock-token-provider.ts";
import type {
  ChainDataProvider,
  MarketDataProvider,
  OnchainIndexProvider,
  ProviderHealth,
  SecurityDataProvider,
  StockTokenProvider,
} from "./types.ts";

/**
 * The one place that knows which concrete providers exist.
 *
 * Everything above this file depends on the capability interfaces, so adding
 * or replacing a provider is a change here and nowhere else.
 *
 * SOURCE PRIORITY — explicit, and never silently substituted. If the primary
 * source for a capability is unavailable, that capability degrades and is
 * reported; a different provider is not quietly swapped in, because the data
 * would then be attributed to the wrong source.
 *
 *   Robinhood stock tokens : Robinhood official API  → Alchemy (onchain verify)
 *   Robinhood Chain        : Alchemy                 (Blockscout does not index 4663)
 *   Crypto markets         : CoinGecko
 *   Equities               : Alpha Vantage
 *   Indexed onchain        : Blockscout              (ethereum, base, op, arbitrum)
 *   Token security         : GoPlus                  (4663 unsupported upstream)
 */

export const SOURCE_PRIORITY = {
  robinhoodStockTokens: ["robinhood_stock_tokens", "alchemy"],
  robinhoodChain: ["alchemy"],
  crypto: ["coingecko"],
  stocks: ["alpha_vantage"],
  onchainIndex: ["blockscout"],
  security: ["goplus"],
} as const;

interface Registry {
  market: MarketDataProvider | null;
  crypto: CoinGeckoProvider | null;
  stocks: AlphaVantageProvider | null;
  stockTokens: RobinhoodStockTokenProvider | null;
  chain: AlchemyChainProvider | null;
  onchainIndex: BlockscoutProvider | null;
  security: GoPlusProvider | null;
}

let registry: Registry | null = null;

function build(): Registry {
  // Each provider is optional: a missing credential disables that capability
  // rather than preventing the service from starting.
  const crypto = new CoinGeckoProvider(env.COINGECKO_API_KEY);
  const stockTokens = new RobinhoodStockTokenProvider();

  const stocks = env.ALPHA_VANTAGE_API_KEY
    ? new AlphaVantageProvider(env.ALPHA_VANTAGE_API_KEY, {
        perDay: env.ALPHA_VANTAGE_DAILY_LIMIT,
      })
    : null;

  const rpcUrl = env.ROBINHOOD_RPC_URL || env.ALCHEMY_RPC_URL;
  const chain = rpcUrl ? new AlchemyChainProvider(rpcUrl, env.ROBINHOOD_CHAIN_ID) : null;

  const onchainIndex = new BlockscoutProvider(env.BLOCKSCOUT_API_KEY);
  const security = new GoPlusProvider(env.GOPLUS_APP_KEY, env.GOPLUS_APP_SECRET);

  const enabled = [
    crypto && "coingecko",
    stockTokens && "robinhood_stock_tokens",
    stocks && "alpha_vantage",
    chain && "alchemy",
    onchainIndex && "blockscout",
    security && "goplus",
  ].filter(Boolean);

  logger.info("provider registry: live mode", { providers: enabled });

  if (!stocks) {
    logger.warn("ALPHA_VANTAGE_API_KEY missing — equity quotes disabled", {
      provider: "alpha_vantage",
    });
  }
  if (!chain) {
    logger.warn("no Robinhood Chain RPC configured — chain data disabled", {
      provider: "alchemy",
    });
  }

  return {
    // CoinGecko is the market provider for the generic ingestion path
    market: crypto,
    crypto,
    stocks,
    stockTokens,
    chain,
    onchainIndex,
    security,
  };
}

function get(): Registry {
  if (!registry) registry = build();
  return registry;
}

/* ------------------------------------------------------------- accessors */

export function getMarketProvider(): MarketDataProvider {
  const provider = get().market;
  if (!provider) throw new Error("No market data provider is configured");
  return provider;
}

export function getCryptoProvider(): CoinGeckoProvider | null {
  return get().crypto;
}

export function getStockProvider(): AlphaVantageProvider | null {
  return get().stocks;
}

export function getStockTokenProvider(): StockTokenProvider | null {
  return get().stockTokens;
}

export function getChainProvider(): ChainDataProvider | null {
  return get().chain;
}

export function getOnchainIndexProvider(): OnchainIndexProvider | null {
  return get().onchainIndex;
}

export function getSecurityProvider(): SecurityDataProvider | null {
  return get().security;
}

export function getProviderFor(assetType: AssetType): MarketDataProvider {
  const provider = getMarketProvider();
  if (!provider.supports.includes(assetType)) {
    throw new Error(`Provider '${provider.name}' does not support asset type '${assetType}'`);
  }
  return provider;
}

/* ----------------------------------------------------------------- health */

interface HealthCheckable {
  readonly name: string;
  healthCheck(): Promise<ProviderHealth>;
}

function checkables(): HealthCheckable[] {
  const r = get();
  const all: (HealthCheckable | null)[] = [
    r.stockTokens,
    r.chain,
    r.crypto,
    r.onchainIndex,
    r.stocks,
    r.security,
  ];
  return all.filter((p): p is HealthCheckable => p !== null);
}

/**
 * Probes every configured provider in parallel. Never throws: a failing probe
 * is reported as unhealthy so one bad provider cannot take down /api/health.
 *
 * Every `detail` is scrubbed on the way out. The string is provider-supplied
 * prose and at least one provider answers a throttled request by quoting the
 * caller's own API key back at them — which /api/health would then publish.
 * Scrubbing here covers both paths (a returned detail and a thrown message)
 * and every provider at once, rather than trusting each one to be careful.
 */
export async function checkProviderHealth(): Promise<ProviderHealth[]> {
  const now = Date.now();
  if (healthCache && now - healthCache.at < HEALTH_CACHE_MS) {
    return healthCache.result;
  }
  // Concurrent callers share one probe round rather than each starting their
  // own. /api/health is the endpoint a load balancer hits most often.
  if (healthInFlight) return healthInFlight;

  healthInFlight = probeProviders().finally(() => {
    healthInFlight = null;
  });
  return healthInFlight;
}

/**
 * Bounds one provider probe.
 *
 * A health check that waits for the slowest provider is a health check that
 * eventually exceeds whatever timeout sits in front of it, and a healthy
 * instance then gets pulled from rotation for someone else's outage. A probe
 * that has not answered in this long has answered: it is not healthy right
 * now.
 */
const PROBE_TIMEOUT_MS = 3_000;

/**
 * How long a probe round is reused.
 *
 * Six outbound requests per health check, on an endpoint polled every few
 * seconds, is a self-inflicted rate-limit problem. Provider state does not
 * change faster than this anyway.
 */
const HEALTH_CACHE_MS = 15_000;

let healthCache: { at: number; result: ProviderHealth[] } | null = null;
let healthInFlight: Promise<ProviderHealth[]> | null = null;

function timedOut(provider: string): ProviderHealth {
  return {
    provider,
    healthy: false,
    latencyMs: null,
    checkedAt: new Date().toISOString(),
    detail: `health check exceeded ${PROBE_TIMEOUT_MS}ms`,
  };
}

async function probeProviders(): Promise<ProviderHealth[]> {
  const results = await Promise.allSettled(
    checkables().map(async (provider) => {
      try {
        return await Promise.race([
          provider.healthCheck(),
          new Promise<ProviderHealth>((resolve) =>
            setTimeout(() => resolve(timedOut(provider.name)), PROBE_TIMEOUT_MS).unref?.(),
          ),
        ]);
      } catch (error) {
        logger.warn("provider health check threw", {
          provider: provider.name,
          ...describeError(error),
        });
        return {
          provider: provider.name,
          healthy: false,
          latencyMs: null,
          checkedAt: new Date().toISOString(),
          detail: error instanceof Error ? error.message : "health check failed",
        } satisfies ProviderHealth;
      }
    }),
  );

  const scrubbed = (health: ProviderHealth): ProviderHealth => ({
    ...health,
    detail: health.detail ? scrubSecrets(health.detail) : health.detail,
  });

  const result = results.map((entry, index) =>
    entry.status === "fulfilled"
      ? scrubbed(entry.value)
      : {
          provider: checkables()[index]?.name ?? "unknown",
          healthy: false,
          latencyMs: null,
          checkedAt: new Date().toISOString(),
          detail: "health check rejected",
        },
  );

  healthCache = { at: Date.now(), result };
  return result;
}

/** Test seam. Never called by the service. */
export function __resetProviderHealthCache(): void {
  healthCache = null;
  healthInFlight = null;
}

export function listProviders(): { name: string; isMock: boolean }[] {
  return checkables().map((p) => ({
    name: p.name,
    isMock: (p as unknown as { isMock: boolean }).isMock ?? false,
  }));
}

/** Test seam — lets a suite install fakes without touching the environment. */
export function __setRegistryForTesting(next: Partial<Registry> | null) {
  registry = next === null ? null : { ...build(), ...next };
}
