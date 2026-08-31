import type { RawMarketSnapshot } from "../../types/domain.ts";
import type { NormalizedAsset } from "../../types/providers.ts";
import { toNumber } from "../../utils/number.ts";
import { nowIso, toIso } from "../../utils/time.ts";
import { HttpClient } from "../http/client.ts";
import type { CorporateAction, ProviderHealth, StockTokenProvider } from "../types.ts";

/**
 * Robinhood official Stock Token API.
 *
 * Endpoints verified live against https://docs.robinhood.com/chain/stock-token-apis/:
 *   GET /rhj/assets              — token metadata + deployments  (60 req/s)
 *   GET /rhj/prices/{symbol}     — bid/ask/volume/halt          (60 req/s, 15s cache)
 *   GET /rhj/corporate-actions   — dividends, splits            (60 req/s, 1h cache)
 *
 * No API key. This is distinct from the Robinhood Chain RPC — that is
 * `AlchemyChainProvider`. This provider answers "what is this stock token and
 * what is it worth"; the chain provider answers "what happened onchain".
 *
 * The live response carries fields beyond the published schema (dailyHigh,
 * dailyLow, mintBurnTokenVolume, mintBurnUsdVolume). They are read
 * defensively — present-if-present, never required.
 */

export const ROBINHOOD_SOURCE = "robinhood_stock_tokens";
const ROBINHOOD_CHAIN_ID = 4663;

interface RhDeployment {
  contractAddress?: string;
  chainId?: number;
  networkName?: string;
}

interface RhAsset {
  id?: string;
  tokenSymbol?: string;
  tokenName?: string;
  deployments?: RhDeployment[];
  currentMultiplier?: string;
  pendingMultiplier?: string;
  pendingMultiplierEffectiveTime?: string;
  logoUrl?: string;
  status?: string;
  tradingCapabilities?: Record<string, unknown>;
}

interface RhQuote {
  tokenSymbol?: string;
  deployments?: RhDeployment[];
  bid?: string;
  ask?: string;
  currency?: string;
  dailyTradingVolume?: string;
  isTradingHalt?: boolean;
  generatedAt?: string;
  dailyHigh?: string;
  dailyLow?: string;
  mintBurnTokenVolume?: string;
  mintBurnUsdVolume?: string;
}

interface RhCorporateAction {
  id?: string;
  type?: string;
  status?: string;
  processDate?: { year?: number; month?: number; day?: number };
  tokenSymbol?: string;
  deployments?: RhDeployment[];
  details?: Record<string, unknown>;
}

function primaryDeployment(deployments?: RhDeployment[]): RhDeployment | null {
  if (!deployments || deployments.length === 0) return null;
  return (
    deployments.find((d) => d.chainId === ROBINHOOD_CHAIN_ID) ?? deployments[0] ?? null
  );
}

/** Mid-price from bid/ask. Returns null rather than guessing on a one-sided book. */
function midPrice(bid: string | undefined, ask: string | undefined): number | null {
  const b = toNumber(bid);
  const a = toNumber(ask);
  if (b !== null && a !== null && b > 0 && a > 0) return (b + a) / 2;
  return b ?? a ?? null;
}

/**
 * Robinhood publishes a `logoUrl` for every tokenised stock, but it is not the
 * company's logo — it is Robinhood's own token badge, served from a
 * per-contract path that makes it look asset-specific.
 *
 * Verified against the live catalogue: 20 of 20 sampled tokens returned
 * byte-identical artwork (md5 7458db13b24a41c3…, 4058 bytes) from 20
 * different URLs.
 *
 * Passing that through would put the same green mark on Intel, Salesforce and
 * every other position, and the interface would caption each one "<company>
 * logo" — a claim the image does not support. So it is dropped here, at the
 * provider, and those assets fall back to the symbol monogram, which does not
 * pretend to be an official mark.
 *
 * If Robinhood later publishes genuine per-company artwork, deleting this
 * function is the only change required.
 */
function companyLogoFrom(logoUrl: string | undefined): string | null {
  // no company artwork is currently distinguishable in this feed
  void logoUrl;
  return null;
}

export class RobinhoodStockTokenProvider implements StockTokenProvider {
  readonly name = ROBINHOOD_SOURCE;
  readonly isMock = false;

  private readonly http: HttpClient;

  constructor(baseUrl = "https://api.robinhood.com") {
    this.http = new HttpClient({
      provider: this.name,
      baseUrl,
      // documented at 60 req/s; a fraction of that is plenty for ingestion
      rateLimit: { perSecond: 5 },
      timeoutMs: 12_000,
      maxRetries: 2,
    });
  }

  async getStockTokens(): Promise<NormalizedAsset[]> {
    const body = await this.http.get<{ assets?: RhAsset[] }>("/rhj/assets");
    const fetchedAt = nowIso();

    return (body?.assets ?? [])
      .filter((asset) => asset.tokenSymbol)
      .map((asset) => {
        const deployment = primaryDeployment(asset.deployments);
        return {
          symbol: String(asset.tokenSymbol).toUpperCase(),
          name: asset.tokenName ?? String(asset.tokenSymbol),
          assetType: "stock" as const,
          chain: deployment?.networkName || "Robinhood Chain",
          chainId: deployment?.chainId ?? ROBINHOOD_CHAIN_ID,
          contractAddress: deployment?.contractAddress?.toLowerCase() ?? null,
          decimals: null,
          logoUrl: companyLogoFrom(asset.logoUrl),
          source: ROBINHOOD_SOURCE,
          fetchedAt,
        };
      });
  }

  async getStockToken(symbol: string): Promise<NormalizedAsset | null> {
    const all = await this.getStockTokens();
    return all.find((a) => a.symbol === symbol.toUpperCase()) ?? null;
  }

  /**
   * A quote in provider shape. It is deliberately returned as
   * `RawMarketSnapshot` so it flows through the same normalization layer as
   * every other market source rather than bypassing it.
   */
  async getStockTokenPrice(symbol: string): Promise<RawMarketSnapshot | null> {
    const body = await this.http.get<{ quotes?: RhQuote[] }>(
      `/rhj/prices/${encodeURIComponent(symbol.toUpperCase())}`,
    );

    const quote = body?.quotes?.[0];
    if (!quote) return null;

    const deployment = primaryDeployment(quote.deployments);
    const price = midPrice(quote.bid, quote.ask);

    return {
      symbol: String(quote.tokenSymbol ?? symbol).toUpperCase(),
      assetType: "stock",
      name: undefined,
      chain: deployment?.networkName || "Robinhood Chain",
      contractAddress: deployment?.contractAddress ?? null,
      price,
      // the API publishes no intraday change; the compute engine derives it
      // from stored history rather than this provider inventing one
      priceChange1h: undefined,
      priceChange24h: undefined,
      volume24h: quote.dailyTradingVolume,
      marketCap: undefined,
      liquidity: undefined,
      tradeCount24h: undefined,
      uniqueParticipants24h: undefined,
      timestamp: quote.generatedAt,
      source: ROBINHOOD_SOURCE,
      isMock: false,
    };
  }

  /** Quotes for many symbols, paced by the shared limiter. */
  async getStockTokenPrices(symbols: string[]): Promise<RawMarketSnapshot[]> {
    const out: RawMarketSnapshot[] = [];
    for (const symbol of symbols) {
      try {
        const snapshot = await this.getStockTokenPrice(symbol);
        if (snapshot) out.push(snapshot);
      } catch {
        // one unavailable symbol must not fail the batch
      }
    }
    return out;
  }

  async getCorporateActions(): Promise<CorporateAction[]> {
    const body = await this.http.get<{ corpActions?: RhCorporateAction[] }>(
      "/rhj/corporate-actions",
    );

    return (body?.corpActions ?? []).map((action) => {
      const deployment = primaryDeployment(action.deployments);
      const date = action.processDate;
      const processDate =
        date?.year && date?.month && date?.day
          ? `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`
          : null;

      return {
        id: action.id ?? `${action.tokenSymbol}-${action.type}-${processDate}`,
        type: action.type ?? "UNKNOWN",
        status: action.status ?? "UNKNOWN",
        symbol: String(action.tokenSymbol ?? "").toUpperCase(),
        processDate,
        contractAddress: deployment?.contractAddress?.toLowerCase() ?? null,
        chainId: deployment?.chainId ?? ROBINHOOD_CHAIN_ID,
        details: action.details ?? {},
        source: ROBINHOOD_SOURCE,
      };
    });
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = performance.now();
    try {
      const body = await this.http.get<{ assets?: RhAsset[] }>("/rhj/assets", { retries: 0 });
      const count = body?.assets?.length ?? 0;
      return {
        provider: this.name,
        healthy: count > 0,
        latencyMs: Number((performance.now() - started).toFixed(1)),
        checkedAt: nowIso(),
        detail: `${count} stock tokens listed`,
      };
    } catch (error) {
      return {
        provider: this.name,
        healthy: false,
        latencyMs: null,
        checkedAt: nowIso(),
        detail: error instanceof Error ? error.message : "health check failed",
      };
    }
  }

  health() {
    return this.http.health();
  }
}

/** Exported for tests: the quote → snapshot mapping without any network call. */
export function mapQuoteToSnapshot(quote: RhQuote, symbol: string): RawMarketSnapshot {
  const deployment = primaryDeployment(quote.deployments);
  return {
    symbol: String(quote.tokenSymbol ?? symbol).toUpperCase(),
    assetType: "stock",
    chain: deployment?.networkName || "Robinhood Chain",
    contractAddress: deployment?.contractAddress ?? null,
    price: midPrice(quote.bid, quote.ask),
    volume24h: quote.dailyTradingVolume,
    timestamp: toIso(quote.generatedAt) ?? nowIso(),
    source: ROBINHOOD_SOURCE,
    isMock: false,
  };
}
