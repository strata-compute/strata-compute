import type { IsoTimestamp } from "../utils/time.ts";

/**
 * The internal domain model. Providers, the database and the API all map to
 * and from these shapes — nothing else is allowed to leak across layers.
 */

export const ASSET_TYPES = ["stock", "crypto", "onchain"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_STATUSES = ["active", "stale", "delisted"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export interface Asset {
  id: string;
  symbol: string;
  name: string;
  assetType: AssetType;
  /** Onchain assets only. */
  chain: string | null;
  contractAddress: string | null;
  /**
   * Provider-supplied logo. Never synthesised: when a provider publishes no
   * image this stays null and the UI falls back to a symbol mark that is
   * visibly not an official logo.
   */
  logoUrl: string | null;
  status: AssetStatus;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** A price observation for an asset at a point in time. */
export interface AssetPrice {
  assetId: string;
  price: number;
  priceChange1h: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
  marketCap: number | null;
  timestamp: IsoTimestamp;
}

/**
 * A raw, provider-shaped market snapshot. Deliberately loose: this is what
 * arrives before normalization, and every field may be missing or wrongly
 * typed. Nothing downstream of normalization sees this type.
 */
export interface RawMarketSnapshot {
  symbol: string;
  assetType: AssetType;
  name?: unknown;
  chain?: unknown;
  contractAddress?: unknown;
  logoUrl?: unknown;
  price?: unknown;
  priceChange1h?: unknown;
  priceChange24h?: unknown;
  volume24h?: unknown;
  marketCap?: unknown;
  liquidity?: unknown;
  tradeCount24h?: unknown;
  uniqueParticipants24h?: unknown;
  timestamp?: unknown;
  /** Provider identifier, for attribution and logging. */
  source: string;
  /** True when the data did not come from a real market. */
  isMock: boolean;
}

/**
 * The canonical post-normalization shape. This is the only input the
 * computation engine accepts.
 */
export interface NormalizedMarketData {
  symbol: string;
  assetType: AssetType;
  name: string;
  chain: string | null;
  contractAddress: string | null;
  logoUrl: string | null;
  price: number;
  priceChange1h: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
  marketCap: number | null;
  liquidity: number | null;
  tradeCount24h: number | null;
  uniqueParticipants24h: number | null;
  /**
   * The provider's own timestamp for the observation. May be older than
   * `retrievedAt` — that gap is what freshness is measured against.
   */
  timestamp: IsoTimestamp;
  /** When Strata fetched it. Always set, never from the provider. */
  retrievedAt: IsoTimestamp;
  /** The provider's raw timestamp string, preserved verbatim for audit. */
  sourceTimestamp: string | null;
  source: string;
  isMock: boolean;
  /** Fields that were absent or unusable in the provider payload. */
  missingFields: string[];
}

/**
 * One computation pass's component readings for an asset.
 *
 * Every field is nullable and every null is load-bearing: it records that the
 * component could not be computed from the data available, which is a
 * different statement from a component that computed to a low value. Nothing
 * downstream may substitute a number for a null here.
 */
export interface MarketMetrics {
  assetId: string;
  momentum: number | null;
  volumeStrength: number | null;
  activity: number | null;
  liquidityStrength: number | null;
  relativeStrength: number | null;
  trend: number | null;
  volatility: number | null;
  timestamp: IsoTimestamp;
}

export interface StrataScore {
  assetId: string;
  /**
   * Null when the pass ran but the data could not support a score. The row is
   * still written, because "we looked and could not compute" is a result
   * worth keeping in the history.
   */
  score: number | null;
  status: "OK" | "INSUFFICIENT_DATA";
  /** 0-1. Confidence in the inputs, never folded into the score itself. */
  confidence: number;
  /** The compute engine that produced the components. */
  version: string;
  /**
   * The method that turned those components into a score. Versioned apart
   * from the engine so a result computed under the uncalibrated method can
   * never be read back as though it had been calibrated.
   */
  scoreVersion: string;
  /** The comparison universe the score is relative to. */
  scoreUniverse: string;
  timestamp: IsoTimestamp;
  /** Providers whose data fed this computation. Never empty for a real score. */
  sources: string[];
}

export interface ComputeEvent {
  id?: string;
  assetId: string | null;
  eventType: string;
  inputData: unknown;
  outputData: unknown;
  computationVersion: string;
  createdAt: IsoTimestamp;
}

/**
 * The full intelligence record for one asset at one instant: the score with
 * its reasoning, and every engine reading behind it.
 *
 * Stored per pass rather than overwritten, so the product can answer "what
 * changed and why" from data rather than from inference. The computation
 * version travels with the row — a v2 result never silently replaces the v1
 * result it was computed alongside.
 */
export interface AssetIntelligence {
  assetId: string;
  symbol: string;
  assetType: AssetType;
  score: import("./intelligence.ts").StrataScoreResult;
  engines: import("./intelligence.ts").EngineOutputs;
  /** Observations that stood behind the historical components. */
  historyPoints: number;
  /** Age of the underlying market observation, in seconds. */
  ageSeconds: number | null;
  sources: string[];
  timestamp: IsoTimestamp;
}

/**
 * One stored point in an asset's history.
 *
 * Deliberately narrower than a full snapshot: these are the fields the
 * statistical engines actually consume, and a field a provider never supplied
 * stays null the whole way through rather than being filled in.
 */
export interface Observation {
  timestamp: IsoTimestamp;
  price: number;
  volume24h: number | null;
  liquidity: number | null;
  tradeCount24h: number | null;
  uniqueParticipants24h: number | null;
}
