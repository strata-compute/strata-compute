import type { LatestMarketRow } from "../database/store.ts";
import type { Asset } from "../types/domain.ts";
import { assessFreshness, classForSource, type DataStatus } from "./freshness.ts";

/**
 * API representations. Kept separate from the domain model so internal
 * refactors do not become breaking API changes, and so `isMock` is carried
 * explicitly on anything a client could mistake for market data.
 */

export interface AssetDto {
  id: string;
  symbol: string;
  name: string;
  assetType: Asset["assetType"];
  chain: string | null;
  contractAddress: string | null;
  /** Provider-supplied logo, or null when none was published. */
  logoUrl: string | null;
  status: Asset["status"];
  createdAt: string;
  updatedAt: string;
}

export function toAssetDto(asset: Asset): AssetDto {
  return {
    id: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    assetType: asset.assetType,
    chain: asset.chain,
    contractAddress: asset.contractAddress,
    logoUrl: asset.logoUrl,
    status: asset.status,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

export interface MarketDto {
  asset: AssetDto;
  price: number | null;
  priceChange1h: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
  marketCap: number | null;
  liquidity: number | null;
  /**
   * Component readings, each nullable. A null here records that the component
   * could not be computed for this asset — never that it computed to zero.
   */
  metrics: {
    momentum: number | null;
    volumeStrength: number | null;
    activity: number | null;
    liquidityStrength: number | null;
    relativeStrength: number | null;
    trend: number | null;
    volatility: number | null;
  } | null;
  score: number | null;
  /** OK, or INSUFFICIENT_DATA when the inputs could not support a score. */
  scoreStatus: "OK" | "INSUFFICIENT_DATA" | null;
  /** Confidence in the inputs behind the score, 0-1. Never folded into it. */
  scoreConfidence: number | null;
  scoreVersion: string | null;
  /** Providers whose data produced the score. */
  scoreSources: string[];
  /** Provider that supplied the underlying observation. */
  source: string | null;
  isMock: boolean;
  updatedAt: string | null;
  /* --- provenance ------------------------------------------------------ */
  /** When Strata retrieved the observation. */
  retrievedAt: string | null;
  /** The provider's own timestamp, verbatim. */
  sourceTimestamp: string | null;
  /** Freshness of this row, measured against its data class. */
  status: DataStatus;
  ageSeconds: number | null;
}

export function toMarketDto(row: LatestMarketRow): MarketDto {
  // freshness is measured from when we retrieved the observation, against the
  // window its provider's data class actually allows
  const retrievedAt = row.snapshot?.retrievedAt ?? row.price?.timestamp ?? null;
  const freshness = assessFreshness(
    retrievedAt,
    classForSource(row.snapshot?.source),
    row.snapshot?.sourceTimestamp ?? null,
  );

  return {
    asset: toAssetDto(row.asset),
    price: row.price?.price ?? null,
    priceChange1h: row.price?.priceChange1h ?? null,
    priceChange24h: row.price?.priceChange24h ?? null,
    volume24h: row.price?.volume24h ?? null,
    marketCap: row.price?.marketCap ?? null,
    liquidity: row.snapshot?.liquidity ?? null,
    metrics: row.metrics
      ? {
          momentum: row.metrics.momentum,
          volumeStrength: row.metrics.volumeStrength,
          activity: row.metrics.activity,
          liquidityStrength: row.metrics.liquidityStrength,
          relativeStrength: row.metrics.relativeStrength,
          trend: row.metrics.trend,
          volatility: row.metrics.volatility,
        }
      : null,
    score: row.score?.score ?? null,
    scoreStatus: row.score?.status ?? null,
    scoreConfidence: row.score?.confidence ?? null,
    scoreVersion: row.score?.version ?? null,
    scoreSources: row.score?.sources ?? [],
    source: row.snapshot?.source ?? null,
    isMock: row.snapshot?.isMock ?? false,
    updatedAt: row.price?.timestamp ?? row.metrics?.timestamp ?? null,
    retrievedAt,
    sourceTimestamp: row.snapshot?.sourceTimestamp ?? null,
    status: freshness.status,
    ageSeconds: freshness.ageSeconds,
  };
}

/** Distinct providers behind a set of rows, for `meta.sources`. */
export function sourcesOf(rows: MarketDto[]): string[] {
  return [...new Set(rows.map((r) => r.source).filter((s): s is string => Boolean(s)))].sort();
}

/** True when any row in a payload came from a mock provider. */
export function anyMock(rows: { isMock: boolean }[]): boolean {
  return rows.some((row) => row.isMock);
}

/* ----------------------------------------------------- asset identity ---- */

/**
 * Rankings, signals and arena entries are produced by the compute layer,
 * which deals in scores and has no reason to carry presentation data. Rather
 * than widen those domain types, identity is attached here, at the
 * serialization boundary, keyed by the asset id they already carry.
 *
 * This is also what stops the interface from guessing. Before it existed, the
 * arena and signal views had a symbol and nothing else, so they filled in a
 * display name from the ticker and assumed every asset was crypto. Both are
 * now read from the asset record, and anything the record does not have
 * stays null.
 */

export interface AssetIdentityFields {
  name: string | null;
  assetType: Asset["assetType"] | null;
  logoUrl: string | null;
}

export function assetIndex(assets: Asset[]): Map<string, Asset> {
  return new Map(assets.map((asset) => [asset.id, asset]));
}

export function withAssetIdentity<T extends { assetId: string }>(
  rows: T[],
  index: Map<string, Asset>,
): (T & AssetIdentityFields)[] {
  return rows.map((row) => {
    const asset = index.get(row.assetId);
    return {
      ...row,
      name: asset?.name ?? null,
      assetType: asset?.assetType ?? null,
      logoUrl: asset?.logoUrl ?? null,
    };
  });
}
