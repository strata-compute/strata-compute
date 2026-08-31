import type { Asset, AssetClass, ComputeStatus, ScoreBreakdown } from "@/lib/types";
import type { ApiAssetType, ApiMarket, ApiRankingEntry } from "./types";

/**
 * The seam between the API contract and the UI's own model.
 *
 * Components are written against `lib/types.ts` and know nothing about the
 * backend. When a view is switched to live data, it maps here — so a change
 * to the wire format touches this file and nothing else.
 *
 */

export function toAssetClass(type: ApiAssetType): AssetClass {
  return type;
}

/**
 * Rows joined from the asset record may have no class if the record itself is
 * incomplete. Null is passed through rather than defaulted to a class the
 * data does not support.
 */
export function toAssetClassOrNull(
  type: ApiAssetType | null | undefined,
): AssetClass | null {
  return type ?? null;
}

function statusFor(market: ApiMarket): Asset["status"] {
  if (market.metrics === null || market.score === null) return "computing";
  const change = market.priceChange24h ?? 0;
  if (Math.abs(change) >= 5) return "elevated";
  if (change <= -2.5) return "cooling";
  if ((market.volume24h ?? 0) < 1e8) return "stale";
  return "live";
}

/**
 * Component readings for a market row.
 *
 * Nulls are carried through rather than defaulted to zero. A component the
 * engine could not compute is not a component that scored nothing, and a bar
 * rendered at 0% would assert the second while the data says the first.
 */
function toBreakdown(market: ApiMarket): ScoreBreakdown {
  const m = market.metrics;
  return {
    momentum: m?.momentum ?? null,
    volume: m?.volumeStrength ?? null,
    activity: m?.activity ?? null,
    liquidity: m?.liquidityStrength ?? null,
    relativeStrength: m?.relativeStrength ?? null,
    trend: m?.trend ?? null,
    volatility: m?.volatility ?? null,
  };
}

/** Maps one API market row onto the `Asset` shape the components render. */
export function toUiAsset(market: ApiMarket): Asset {
  const price = market.price ?? 0;
  const change24h = market.priceChange24h ?? 0;
  const prior = change24h === -100 ? price : price / (1 + change24h / 100);

  return {
    id: market.asset.id,
    symbol: market.asset.symbol,
    name: market.asset.name,
    assetClass: toAssetClass(market.asset.assetType),
    logoUrl: market.asset.logoUrl ?? null,
    price,
    change24h,
    changeAbs24h: Number((price - prior).toFixed(price > 100 ? 2 : 4)),
    volume24h: market.volume24h ?? 0,
    marketCap: market.marketCap ?? 0,
    score: market.score,
    scoreStatus: market.scoreStatus,
    scoreConfidence: market.scoreConfidence,
    // the API does not yet expose a 24h score delta; Phase 3 adds it
    scoreDelta24h: 0,
    breakdown: toBreakdown(market),
    status: statusFor(market),
    momentum: market.metrics?.momentum ?? null,
    venue: market.asset.chain ?? (market.asset.assetType === "stock" ? "NASDAQ" : "Aggregate"),
    sector: market.asset.assetType,
    tags: [],
  };
}

export function toUiAssets(markets: ApiMarket[]): Asset[] {
  return markets.map(toUiAsset);
}

/** Ranking rows carry enough to render a table without a second request. */
export function rankingToRow(entry: ApiRankingEntry) {
  return {
    rank: entry.rank,
    symbol: entry.symbol,
    name: entry.name,
    assetClass: toAssetClass(entry.assetType),
    logoUrl: entry.logoUrl ?? null,
    score: entry.score,
    value: entry.value,
    change: entry.change,
  };
}

export interface UiComputeStatus {
  state: ComputeStatus | "computing";
  version: string;
  lastRun: string | null;
  assetsProcessed: number;
  usingMockData: boolean;
}
