import type { AssetType, RawMarketSnapshot } from "../../types/domain.ts";
import type {
  NormalizedAsset,
  NormalizedHistoricalData,
  NormalizedHistoricalPoint,
} from "../../types/providers.ts";
import { nowIso } from "../../utils/time.ts";
import { HttpClient } from "../http/client.ts";
import type {
  HistoricalRange,
  MarketDataProvider,
  ProviderAssetRef,
  ProviderHealth,
  ProviderLiquidity,
  ProviderPrice,
  ProviderVolume,
} from "../types.ts";

/**
 * CoinGecko — crypto market data.
 *
 * Verified live: `/ping`, `/coins/markets` with the demo key header. The demo
 * tier allows roughly 30 calls a minute, so ingestion uses the batch
 * `/coins/markets` endpoint — one request covers the whole universe instead of
 * one request per asset.
 */

export const COINGECKO_SOURCE = "coingecko";

/**
 * Symbol → CoinGecko id. CoinGecko keys on ids, not tickers, and tickers are
 * ambiguous across listings, so the mapping is explicit rather than guessed.
 */
export const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  LINK: "chainlink",
  AVAX: "avalanche-2",
  XRP: "ripple",
  DOGE: "dogecoin",
  TON: "the-open-network",
  SUI: "sui",
  ARB: "arbitrum",
  HYPE: "hyperliquid",
  ENA: "ethena",
  PENDLE: "pendle",
  AERO: "aerodrome-finance",
  ONDO: "ondo-finance",
  JUP: "jupiter-exchange-solana",
  EIGEN: "eigenlayer",
  MORPHO: "morpho",
};

const ID_TO_SYMBOL: Record<string, string> = Object.fromEntries(
  Object.entries(COINGECKO_IDS).map(([symbol, id]) => [id, symbol]),
);

/** Assets that are tokens on a chain rather than a chain's own asset. */
const ONCHAIN_SYMBOLS = new Set([
  "HYPE",
  "ENA",
  "PENDLE",
  "AERO",
  "ONDO",
  "JUP",
  "EIGEN",
  "MORPHO",
]);

interface CgMarket {
  id?: string;
  symbol?: string;
  name?: string;
  current_price?: number;
  market_cap?: number;
  total_volume?: number;
  price_change_percentage_1h_in_currency?: number;
  price_change_percentage_24h_in_currency?: number;
  price_change_percentage_24h?: number;
  last_updated?: string;
  image?: string;
}

function assetTypeFor(symbol: string): AssetType {
  return ONCHAIN_SYMBOLS.has(symbol) ? "onchain" : "crypto";
}

export class CoinGeckoProvider implements MarketDataProvider {
  readonly name = COINGECKO_SOURCE;
  readonly isMock = false;
  readonly supports: readonly AssetType[] = ["crypto", "onchain"];

  private readonly http: HttpClient;

  constructor(apiKey: string | undefined, baseUrl = "https://api.coingecko.com/api/v3") {
    this.http = new HttpClient({
      provider: this.name,
      baseUrl,
      // demo keys use x-cg-demo-api-key; pro keys use x-cg-pro-api-key
      headers: apiKey ? { "x-cg-demo-api-key": apiKey } : {},
      // demo tier is ~30/min; stay well inside it
      rateLimit: { perSecond: 0.4 },
      timeoutMs: 15_000,
      maxRetries: 2,
      detectThrottle: (body) => {
        const status = (body as { status?: { error_code?: number; error_message?: string } })
          ?.status;
        if (status?.error_code === 429) return status.error_message ?? "rate limited";
        return null;
      },
    });
  }

  private idsFor(refs?: ProviderAssetRef[]): string[] {
    if (!refs || refs.length === 0) return Object.values(COINGECKO_IDS);
    return refs
      .map((ref) => COINGECKO_IDS[ref.symbol.toUpperCase()])
      .filter((id): id is string => Boolean(id));
  }

  async getAssets(): Promise<ProviderAssetRef[]> {
    const markets = await this.fetchMarkets();
    return markets.map((market) => {
      const symbol = ID_TO_SYMBOL[market.id ?? ""] ?? String(market.symbol ?? "").toUpperCase();
      return {
        symbol,
        name: market.name ?? symbol,
        assetType: assetTypeFor(symbol),
        chain: null,
        contractAddress: null,
      };
    });
  }

  private async fetchMarkets(refs?: ProviderAssetRef[]): Promise<CgMarket[]> {
    const ids = this.idsFor(refs);
    if (ids.length === 0) return [];

    const markets = await this.http.get<CgMarket[]>("/coins/markets", {
      params: {
        vs_currency: "usd",
        ids: ids.join(","),
        order: "market_cap_desc",
        per_page: 250,
        page: 1,
        sparkline: false,
        price_change_percentage: "1h,24h",
      },
    });

    return Array.isArray(markets) ? markets : [];
  }

  private toSnapshot(market: CgMarket): RawMarketSnapshot | null {
    const symbol = ID_TO_SYMBOL[market.id ?? ""] ?? String(market.symbol ?? "").toUpperCase();
    if (!symbol) return null;

    return {
      symbol,
      assetType: assetTypeFor(symbol),
      name: market.name,
      chain: null,
      contractAddress: null,
      logoUrl: market.image,
      price: market.current_price,
      priceChange1h: market.price_change_percentage_1h_in_currency,
      priceChange24h:
        market.price_change_percentage_24h_in_currency ?? market.price_change_percentage_24h,
      volume24h: market.total_volume,
      marketCap: market.market_cap,
      // CoinGecko's market endpoint carries no depth or participant counts;
      // left absent so normalization records them as missing
      liquidity: undefined,
      tradeCount24h: undefined,
      uniqueParticipants24h: undefined,
      timestamp: market.last_updated,
      source: COINGECKO_SOURCE,
      isMock: false,
    };
  }

  async getMarketSnapshots(assets: ProviderAssetRef[]): Promise<RawMarketSnapshot[]> {
    const markets = await this.fetchMarkets(assets);
    return markets
      .map((market) => this.toSnapshot(market))
      .filter((s): s is RawMarketSnapshot => s !== null);
  }

  async getMarketSnapshot(asset: ProviderAssetRef): Promise<RawMarketSnapshot> {
    const [snapshot] = await this.getMarketSnapshots([asset]);
    if (!snapshot) throw new Error(`CoinGecko has no market for ${asset.symbol}`);
    return snapshot;
  }

  async getPrice(asset: ProviderAssetRef): Promise<ProviderPrice> {
    const snapshot = await this.getMarketSnapshot(asset);
    return {
      symbol: snapshot.symbol,
      price: typeof snapshot.price === "number" ? snapshot.price : null,
      priceChange1h: typeof snapshot.priceChange1h === "number" ? snapshot.priceChange1h : null,
      priceChange24h:
        typeof snapshot.priceChange24h === "number" ? snapshot.priceChange24h : null,
      timestamp: nowIso(),
    };
  }

  async getVolume(asset: ProviderAssetRef): Promise<ProviderVolume> {
    const snapshot = await this.getMarketSnapshot(asset);
    return {
      symbol: snapshot.symbol,
      volume24h: typeof snapshot.volume24h === "number" ? snapshot.volume24h : null,
      tradeCount24h: null,
      timestamp: nowIso(),
    };
  }

  /** CoinGecko does not publish book depth; the honest answer is null. */
  async getLiquidity(asset: ProviderAssetRef): Promise<ProviderLiquidity> {
    return { symbol: asset.symbol.toUpperCase(), liquidity: null, timestamp: nowIso() };
  }

  async getHistoricalData(asset: ProviderAssetRef, range: HistoricalRange) {
    const data = await this.getCryptoHistory(asset.symbol, range);
    return data.points.map((point) => ({
      timestamp: point.timestamp,
      price: point.close,
      volume: point.volume,
    }));
  }

  async getCryptoHistory(
    symbol: string,
    range: HistoricalRange,
  ): Promise<NormalizedHistoricalData> {
    const id = COINGECKO_IDS[symbol.toUpperCase()];
    if (!id) {
      return {
        symbol: symbol.toUpperCase(),
        assetType: assetTypeFor(symbol.toUpperCase()),
        range,
        points: [],
        source: COINGECKO_SOURCE,
        fetchedAt: nowIso(),
      };
    }

    const days: Record<HistoricalRange, string> = {
      "1h": "1",
      "24h": "1",
      "7d": "7",
      "30d": "30",
      "1y": "365",
    };

    const body = await this.http.get<{ prices?: [number, number][]; total_volumes?: [number, number][] }>(
      `/coins/${id}/market_chart`,
      { params: { vs_currency: "usd", days: days[range] } },
    );

    const volumeByTs = new Map((body?.total_volumes ?? []).map(([ts, v]) => [ts, v]));
    const points: NormalizedHistoricalPoint[] = (body?.prices ?? []).map(([ts, price]) => ({
      timestamp: new Date(ts).toISOString(),
      open: null,
      high: null,
      low: null,
      close: price,
      volume: volumeByTs.get(ts) ?? null,
    }));

    return {
      symbol: symbol.toUpperCase(),
      assetType: assetTypeFor(symbol.toUpperCase()),
      range,
      points,
      source: COINGECKO_SOURCE,
      fetchedAt: nowIso(),
    };
  }

  async getCryptoAssets(): Promise<NormalizedAsset[]> {
    const markets = await this.fetchMarkets();
    const fetchedAt = nowIso();
    return markets.map((market) => {
      const symbol = ID_TO_SYMBOL[market.id ?? ""] ?? String(market.symbol ?? "").toUpperCase();
      return {
        symbol,
        name: market.name ?? symbol,
        assetType: assetTypeFor(symbol),
        chain: null,
        chainId: null,
        contractAddress: null,
        decimals: null,
        logoUrl: market.image ?? null,
        source: COINGECKO_SOURCE,
        fetchedAt,
      };
    });
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = performance.now();
    try {
      const body = await this.http.get<{ gecko_says?: string }>("/ping", { retries: 0 });
      return {
        provider: this.name,
        healthy: Boolean(body?.gecko_says),
        latencyMs: Number((performance.now() - started).toFixed(1)),
        checkedAt: nowIso(),
        detail: body?.gecko_says ?? "no response body",
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

/** Exported for tests: mapping without a network call. */
export function mapCoinGeckoMarket(market: CgMarket): RawMarketSnapshot | null {
  const symbol = ID_TO_SYMBOL[market.id ?? ""] ?? String(market.symbol ?? "").toUpperCase();
  if (!symbol) return null;
  return {
    symbol,
    assetType: assetTypeFor(symbol),
    name: market.name,
    chain: null,
    contractAddress: null,
    price: market.current_price,
    priceChange1h: market.price_change_percentage_1h_in_currency,
    priceChange24h:
      market.price_change_percentage_24h_in_currency ?? market.price_change_percentage_24h,
    volume24h: market.total_volume,
    marketCap: market.market_cap,
    timestamp: market.last_updated,
    source: COINGECKO_SOURCE,
    isMock: false,
  };
}
