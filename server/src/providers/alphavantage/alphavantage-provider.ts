import type { AssetType, RawMarketSnapshot } from "../../types/domain.ts";
import type {
  NormalizedHistoricalData,
  NormalizedHistoricalPoint,
} from "../../types/providers.ts";
import { toNumber } from "../../utils/number.ts";
import { logger } from "../../utils/logger.ts";
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
 * Alpha Vantage — equities.
 *
 * The binding constraint, verified live: the free tier allows **25 requests
 * per day** and asks for at most one per second. Exceeding it does not return
 * 429 — it returns HTTP 200 with an `Information` key explaining the limit,
 * which is why the shared client supports body-based throttle detection.
 *
 * Consequences, deliberately designed for rather than worked around:
 *  - the daily quota is enforced locally by the limiter, so the service never
 *    burns the budget it cannot see;
 *  - ingestion covers a small rotating slice of symbols per pass rather than
 *    the whole universe;
 *  - quotes are cached for a long TTL upstream in the ingestion job.
 */

export const ALPHA_VANTAGE_SOURCE = "alpha_vantage";

interface AvGlobalQuote {
  "Global Quote"?: {
    "01. symbol"?: string;
    "02. open"?: string;
    "03. high"?: string;
    "04. low"?: string;
    "05. price"?: string;
    "06. volume"?: string;
    "07. latest trading day"?: string;
    "08. previous close"?: string;
    "09. change"?: string;
    "10. change percent"?: string;
  };
  Information?: string;
  Note?: string;
  "Error Message"?: string;
}

interface AvOverview {
  Symbol?: string;
  Name?: string;
  Sector?: string;
  Industry?: string;
  MarketCapitalization?: string;
  Exchange?: string;
  Information?: string;
}

export interface NormalizedStockQuote {
  symbol: string;
  price: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  change24h: number | null;
  timestamp: string;
  source: string;
}

/** Alpha Vantage signals throttling in the body, not the status line. */
function throttleReason(body: unknown): string | null {
  const b = body as { Information?: string; Note?: string } | null;
  const message = b?.Information ?? b?.Note;
  if (!message) return null;
  return /higher API call|rate limit|premium|per day|sparingly/i.test(message)
    ? message.slice(0, 160)
    : null;
}

function parsePercent(value: string | undefined): number | null {
  if (!value) return null;
  return toNumber(value.replace("%", ""));
}

export class AlphaVantageProvider implements MarketDataProvider {
  readonly name = ALPHA_VANTAGE_SOURCE;
  readonly isMock = false;
  readonly supports: readonly AssetType[] = ["stock"];

  private readonly http: HttpClient;
  private readonly apiKey: string;

  constructor(
    apiKey: string,
    options: { perDay?: number; baseUrl?: string } = {},
  ) {
    this.apiKey = apiKey;
    this.http = new HttpClient({
      provider: this.name,
      baseUrl: options.baseUrl ?? "https://www.alphavantage.co",
      // free tier: 25/day, 1/second. Both enforced locally.
      rateLimit: { perSecond: 0.8, perDay: options.perDay ?? 25 },
      timeoutMs: 15_000,
      maxRetries: 1,
      detectThrottle: throttleReason,
    });
  }

  /** How many calls remain before the daily quota is gone. */
  get remainingCallsToday(): number | null {
    return this.http.limiter.remainingToday;
  }

  async getAssets(): Promise<ProviderAssetRef[]> {
    // Alpha Vantage has no free "list everything" endpoint. Discovery is not
    // this provider's job — the asset universe comes from Robinhood stock
    // tokens and the store; Alpha Vantage answers quotes for symbols it is
    // given. Returning [] is the honest answer, not an invented list.
    return [];
  }

  async getQuote(symbol: string): Promise<NormalizedStockQuote | null> {
    const body = await this.http.get<AvGlobalQuote>("/query", {
      params: { function: "GLOBAL_QUOTE", symbol: symbol.toUpperCase(), apikey: this.apiKey },
    });

    if (body?.["Error Message"]) {
      logger.warn("alpha vantage rejected a symbol", {
        provider: this.name,
        asset: symbol,
      });
      return null;
    }

    const quote = body?.["Global Quote"];
    if (!quote || !quote["05. price"]) return null;

    const day = quote["07. latest trading day"];
    return {
      symbol: (quote["01. symbol"] ?? symbol).toUpperCase(),
      price: toNumber(quote["05. price"]),
      open: toNumber(quote["02. open"]),
      high: toNumber(quote["03. high"]),
      low: toNumber(quote["04. low"]),
      close: toNumber(quote["05. price"]),
      volume: toNumber(quote["06. volume"]),
      change24h: parsePercent(quote["10. change percent"]),
      timestamp: day ? new Date(`${day}T00:00:00Z`).toISOString() : nowIso(),
      source: ALPHA_VANTAGE_SOURCE,
    };
  }

  async getMarketSnapshot(asset: ProviderAssetRef): Promise<RawMarketSnapshot> {
    const quote = await this.getQuote(asset.symbol);
    if (!quote) throw new Error(`Alpha Vantage returned no quote for ${asset.symbol}`);
    return quoteToSnapshot(quote);
  }

  async getPrice(asset: ProviderAssetRef): Promise<ProviderPrice> {
    const quote = await this.getQuote(asset.symbol);
    return {
      symbol: asset.symbol.toUpperCase(),
      price: quote?.price ?? null,
      priceChange1h: null,
      priceChange24h: quote?.change24h ?? null,
      timestamp: quote?.timestamp ?? nowIso(),
    };
  }

  async getVolume(asset: ProviderAssetRef): Promise<ProviderVolume> {
    const quote = await this.getQuote(asset.symbol);
    return {
      symbol: asset.symbol.toUpperCase(),
      // share volume, not notional — the ingestion layer converts
      volume24h: quote?.volume ?? null,
      tradeCount24h: null,
      timestamp: quote?.timestamp ?? nowIso(),
    };
  }

  async getLiquidity(asset: ProviderAssetRef): Promise<ProviderLiquidity> {
    // Alpha Vantage publishes no depth data.
    return { symbol: asset.symbol.toUpperCase(), liquidity: null, timestamp: nowIso() };
  }

  async getHistoricalData(asset: ProviderAssetRef, range: HistoricalRange) {
    const history = await this.getHistory(asset.symbol, range);
    return history.points.map((p) => ({
      timestamp: p.timestamp,
      price: p.close,
      volume: p.volume,
    }));
  }

  async getHistory(symbol: string, range: HistoricalRange): Promise<NormalizedHistoricalData> {
    const daily = range === "1h" || range === "24h" ? "TIME_SERIES_INTRADAY" : "TIME_SERIES_DAILY";
    const body = await this.http.get<Record<string, unknown>>("/query", {
      params: {
        function: daily,
        symbol: symbol.toUpperCase(),
        apikey: this.apiKey,
        ...(daily === "TIME_SERIES_INTRADAY" ? { interval: "60min" } : {}),
        outputsize: "compact",
      },
    });

    const seriesKey = Object.keys(body ?? {}).find((k) => k.startsWith("Time Series"));
    const series = seriesKey
      ? (body[seriesKey] as Record<string, Record<string, string>>)
      : null;

    const points: NormalizedHistoricalPoint[] = series
      ? Object.entries(series)
          .map(([timestamp, values]) => ({
            timestamp: new Date(timestamp.includes(" ") ? `${timestamp}Z` : `${timestamp}T00:00:00Z`).toISOString(),
            open: toNumber(values["1. open"]),
            high: toNumber(values["2. high"]),
            low: toNumber(values["3. low"]),
            close: toNumber(values["4. close"]) ?? 0,
            volume: toNumber(values["5. volume"]),
          }))
          .filter((p) => p.close > 0)
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      : [];

    return {
      symbol: symbol.toUpperCase(),
      assetType: "stock",
      range,
      points,
      source: ALPHA_VANTAGE_SOURCE,
      fetchedAt: nowIso(),
    };
  }

  async getCompanyOverview(symbol: string): Promise<{
    symbol: string;
    name: string | null;
    sector: string | null;
    industry: string | null;
    marketCap: number | null;
    exchange: string | null;
    source: string;
  } | null> {
    const body = await this.http.get<AvOverview>("/query", {
      params: { function: "OVERVIEW", symbol: symbol.toUpperCase(), apikey: this.apiKey },
    });

    if (!body?.Symbol) return null;
    return {
      symbol: body.Symbol.toUpperCase(),
      name: body.Name ?? null,
      sector: body.Sector ?? null,
      industry: body.Industry ?? null,
      marketCap: toNumber(body.MarketCapitalization),
      exchange: body.Exchange ?? null,
      source: ALPHA_VANTAGE_SOURCE,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const remaining = this.remainingCallsToday;
    // a health probe that spends the quota it is reporting on is worse than
    // no probe: report configuration state instead once the budget is low
    if (remaining !== null && remaining <= 3) {
      return {
        provider: this.name,
        healthy: true,
        latencyMs: null,
        checkedAt: nowIso(),
        detail: `daily quota nearly exhausted (${remaining} left) — probe skipped to preserve it`,
      };
    }

    const started = performance.now();
    try {
      const quote = await this.getQuote("AAPL");
      return {
        provider: this.name,
        healthy: quote !== null,
        latencyMs: Number((performance.now() - started).toFixed(1)),
        checkedAt: nowIso(),
        detail: quote
          ? `quote ok, ${remaining ?? "?"} calls left today`
          : "no quote returned",
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
export function quoteToSnapshot(quote: NormalizedStockQuote): RawMarketSnapshot {
  return {
    symbol: quote.symbol,
    assetType: "stock",
    price: quote.price,
    priceChange1h: undefined,
    priceChange24h: quote.change24h,
    // share count × price gives the notional the compute engine expects
    volume24h:
      quote.volume !== null && quote.price !== null ? quote.volume * quote.price : undefined,
    marketCap: undefined,
    liquidity: undefined,
    tradeCount24h: undefined,
    uniqueParticipants24h: undefined,
    timestamp: quote.timestamp,
    source: ALPHA_VANTAGE_SOURCE,
    isMock: false,
  };
}

export { throttleReason as alphaVantageThrottleReason };
