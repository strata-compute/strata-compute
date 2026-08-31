import type { AssetType, RawMarketSnapshot } from "../../types/domain.ts";
import { nowIso, type IsoTimestamp } from "../../utils/time.ts";
import type {
  HistoricalPoint,
  HistoricalRange,
  MarketDataProvider,
  ProviderAssetRef,
  ProviderHealth,
  ProviderLiquidity,
  ProviderPrice,
  ProviderVolume,
} from "../types.ts";
import { findCatalogEntry, MOCK_CATALOG, type CatalogEntry } from "./catalog.ts";

/**
 * MOCK PROVIDER — DEVELOPMENT ONLY.
 *
 * Generates structurally realistic market data from an invented catalogue so
 * the pipeline can be exercised end to end without any external dependency.
 * It is not market data: every record it emits carries `isMock: true` and
 * `source: "mock"`, and the API propagates that flag to clients.
 *
 * It deliberately reproduces provider misbehaviour — occasional missing
 * fields, numbers delivered as strings, timestamps in epoch seconds — so the
 * normalization layer is exercised rather than bypassed.
 */

const PROVIDER_NAME = "mock";

/** Mulberry32 — small deterministic PRNG. */
function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Values drift on a slow clock rather than jumping every call, so successive
 * polls look like a market moving instead of noise.
 */
function driftBucket(periodMs = 60_000): number {
  return Math.floor(Date.now() / periodMs);
}

function toRef(entry: CatalogEntry): ProviderAssetRef {
  return {
    symbol: entry.symbol,
    name: entry.name,
    assetType: entry.assetType,
    chain: entry.chain,
    contractAddress: entry.contractAddress,
  };
}

interface GeneratedQuote {
  price: number;
  priceChange1h: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  liquidity: number;
  tradeCount24h: number;
  uniqueParticipants24h: number;
}

function generate(entry: CatalogEntry, bucket: number): GeneratedQuote {
  const rand = seededRandom(hash(`${entry.symbol}:${bucket}`));

  const change24h = (rand() - 0.45) * entry.volatility * 220;
  const change1h = (rand() - 0.5) * entry.volatility * 70;
  const price = entry.basePrice * (1 + change24h / 100);

  const volumeFactor = 0.55 + rand() * 1.5;
  const volume24h = entry.baseVolume24h * volumeFactor;

  const liquidityFactor = 0.7 + rand() * 0.7;
  const liquidity = entry.baseLiquidity * liquidityFactor;

  // participant counts scale with notional but not linearly
  const tradeCount24h = Math.round((volume24h / entry.basePrice) * (0.0008 + rand() * 0.0012));
  const uniqueParticipants24h = Math.round(tradeCount24h * (0.12 + rand() * 0.22));

  return {
    price,
    priceChange1h: change1h,
    priceChange24h: change24h,
    volume24h,
    marketCap: entry.baseMarketCap * (1 + change24h / 100),
    liquidity,
    tradeCount24h,
    uniqueParticipants24h,
  };
}

/**
 * Real feeds drop fields. This reproduces that at a low, deterministic rate
 * so normalization's missing-data handling is genuinely exercised.
 */
function maybeDrop<T>(value: T, rand: () => number, rate = 0.04): T | undefined {
  return rand() < rate ? undefined : value;
}

export class MockMarketProvider implements MarketDataProvider {
  readonly name = PROVIDER_NAME;
  readonly isMock = true;
  readonly supports: readonly AssetType[] = ["stock", "crypto", "onchain"];

  async getAssets(): Promise<ProviderAssetRef[]> {
    return MOCK_CATALOG.map(toRef);
  }

  async getPrice(asset: ProviderAssetRef): Promise<ProviderPrice> {
    const entry = this.requireEntry(asset.symbol);
    const quote = generate(entry, driftBucket());
    return {
      symbol: entry.symbol,
      price: quote.price,
      priceChange1h: quote.priceChange1h,
      priceChange24h: quote.priceChange24h,
      timestamp: nowIso(),
    };
  }

  async getMarketSnapshot(asset: ProviderAssetRef): Promise<RawMarketSnapshot> {
    const entry = this.requireEntry(asset.symbol);
    const bucket = driftBucket();
    const quote = generate(entry, bucket);
    const rand = seededRandom(hash(`${entry.symbol}:shape:${bucket}`));

    return {
      symbol: entry.symbol,
      assetType: entry.assetType,
      name: entry.name,
      chain: entry.chain,
      contractAddress: entry.contractAddress,
      price: quote.price,
      priceChange1h: maybeDrop(quote.priceChange1h, rand),
      priceChange24h: quote.priceChange24h,
      // some feeds deliver notional as a string — normalization handles it
      volume24h: rand() < 0.3 ? quote.volume24h.toFixed(2) : quote.volume24h,
      marketCap: maybeDrop(quote.marketCap, rand),
      liquidity: maybeDrop(quote.liquidity, rand),
      tradeCount24h: quote.tradeCount24h,
      uniqueParticipants24h: maybeDrop(quote.uniqueParticipants24h, rand),
      // and some deliver epoch seconds rather than ISO
      timestamp: rand() < 0.5 ? Math.floor(Date.now() / 1000) : nowIso(),
      source: PROVIDER_NAME,
      isMock: true,
    };
  }

  async getMarketSnapshots(assets: ProviderAssetRef[]): Promise<RawMarketSnapshot[]> {
    return Promise.all(assets.map((asset) => this.getMarketSnapshot(asset)));
  }

  async getHistoricalData(
    asset: ProviderAssetRef,
    range: HistoricalRange,
  ): Promise<HistoricalPoint[]> {
    const entry = this.requireEntry(asset.symbol);
    const config: Record<HistoricalRange, { points: number; stepMs: number }> = {
      "1h": { points: 60, stepMs: 60_000 },
      "24h": { points: 96, stepMs: 900_000 },
      "7d": { points: 84, stepMs: 2 * 3_600_000 },
      "30d": { points: 90, stepMs: 8 * 3_600_000 },
      "1y": { points: 120, stepMs: 73 * 3_600_000 },
    };
    const { points, stepMs } = config[range];
    const rand = seededRandom(hash(`${entry.symbol}:history:${range}`));
    const end = Date.now();

    let value = entry.basePrice;
    const out: HistoricalPoint[] = [];
    for (let i = points - 1; i >= 0; i--) {
      value *= 1 + (rand() - 0.5) * entry.volatility * 0.6;
      out.push({
        timestamp: new Date(end - i * stepMs).toISOString(),
        price: Number(value.toFixed(6)),
        volume: Number((entry.baseVolume24h * (0.5 + rand())).toFixed(2)),
      });
    }
    return out;
  }

  async getVolume(asset: ProviderAssetRef): Promise<ProviderVolume> {
    const entry = this.requireEntry(asset.symbol);
    const quote = generate(entry, driftBucket());
    return {
      symbol: entry.symbol,
      volume24h: quote.volume24h,
      tradeCount24h: quote.tradeCount24h,
      timestamp: nowIso(),
    };
  }

  async getLiquidity(asset: ProviderAssetRef): Promise<ProviderLiquidity> {
    const entry = this.requireEntry(asset.symbol);
    const quote = generate(entry, driftBucket());
    return {
      symbol: entry.symbol,
      liquidity: quote.liquidity,
      timestamp: nowIso(),
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const startedAt = performance.now();
    const checkedAt: IsoTimestamp = nowIso();
    return {
      provider: PROVIDER_NAME,
      healthy: true,
      latencyMs: Number((performance.now() - startedAt).toFixed(3)),
      checkedAt,
      detail: "synthetic development provider — not market data",
    };
  }

  private requireEntry(symbol: string): CatalogEntry {
    const entry = findCatalogEntry(symbol);
    if (!entry) {
      throw new Error(`Unknown symbol '${symbol}' for the mock provider`);
    }
    return entry;
  }
}
