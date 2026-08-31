import { getStore } from "../database/index.ts";
import { getCryptoProvider } from "../providers/registry.ts";
import type { Observation } from "../types/domain.ts";
import { describeError, logger } from "../utils/logger.ts";

/**
 * HISTORICAL BACKFILL
 *
 * Almost everything in the intelligence layer needs history: volatility,
 * trend, anomaly baselines, 7-day momentum, volume regimes. Accumulating that
 * by polling means the product says INSUFFICIENT_DATA for days before it can
 * say anything else, and a newly-covered asset restarts from nothing.
 *
 * The provider already holds the series. CoinGecko's market_chart endpoint
 * returns real hourly observations with volume, and pulling them is not
 * fabrication — it is the same provider, the same market, the same figures,
 * retrieved for a window we did not happen to be running through.
 *
 * Two constraints shape the implementation.
 *
 * It only covers assets whose provider actually publishes history. Equities
 * are quoted spot by Robinhood with no historical endpoint, and Alpha
 * Vantage's free tier allows 25 calls a day across the whole service — so
 * stocks accumulate depth by polling and correctly report thinner history
 * until they have it. Inventing a series for them would be the one thing
 * worse than waiting.
 *
 * And backfilled points are merged on timestamp, never appended blindly. A
 * duplicated observation would be counted twice in every baseline computed
 * from the series, quietly biasing every statistic that reads it.
 */

/** A week of hourly observations: enough for a 7-day window and a baseline. */
const BACKFILL_RANGE = "7d" as const;

export interface BackfillResult {
  ok: boolean;
  assetsConsidered: number;
  assetsBackfilled: number;
  pointsAdded: number;
  skipped: { symbol: string; reason: string }[];
  durationMs: number;
}

export async function backfillHistory(): Promise<BackfillResult> {
  const started = performance.now();
  const log = logger.child({ job: "backfill-history" });
  const provider = getCryptoProvider();
  const store = getStore();

  const finish = (result: Omit<BackfillResult, "durationMs">): BackfillResult => ({
    ...result,
    durationMs: Number((performance.now() - started).toFixed(2)),
  });

  if (!provider) {
    return finish({
      ok: false,
      assetsConsidered: 0,
      assetsBackfilled: 0,
      pointsAdded: 0,
      skipped: [{ symbol: "*", reason: "no historical provider configured" }],
    });
  }

  // only classes this provider actually prices
  const assets = [
    ...(await store.listAssets({ assetType: "crypto" })),
    ...(await store.listAssets({ assetType: "onchain" })),
  ];

  let assetsBackfilled = 0;
  let pointsAdded = 0;
  const skipped: { symbol: string; reason: string }[] = [];

  for (const asset of assets) {
    try {
      // an asset that already has depth does not need refetching every pass
      const existing = await store.getObservationHistory(asset.id, 400);
      if (existing.length >= 100) {
        skipped.push({ symbol: asset.symbol, reason: "already has sufficient depth" });
        continue;
      }

      const history = await provider.getCryptoHistory(asset.symbol, BACKFILL_RANGE);
      if (history.points.length === 0) {
        skipped.push({ symbol: asset.symbol, reason: "provider published no history" });
        continue;
      }

      const observations: Observation[] = history.points
        .filter((point) => point.close !== null && point.close > 0)
        .map((point) => ({
          timestamp: point.timestamp,
          price: point.close as number,
          volume24h: point.volume,
          // the historical endpoint carries neither book depth nor counts;
          // they stay null rather than being inferred from price and volume
          liquidity: null,
          tradeCount24h: null,
          uniqueParticipants24h: null,
        }));

      const added = await store.backfillObservations(asset.id, observations);
      if (added > 0) {
        assetsBackfilled += 1;
        pointsAdded += added;
      }
    } catch (error) {
      // one asset failing must not abandon the rest of the universe
      skipped.push({ symbol: asset.symbol, reason: "provider request failed" });
      log.warn("backfill failed for asset", {
        asset: asset.symbol,
        ...describeError(error),
      });
    }
  }

  const result = finish({
    ok: true,
    assetsConsidered: assets.length,
    assetsBackfilled,
    pointsAdded,
    skipped,
  });

  log.info("historical backfill complete", {
    considered: result.assetsConsidered,
    backfilled: result.assetsBackfilled,
    points: result.pointsAdded,
    skipped: result.skipped.length,
    durationMs: result.durationMs,
  });

  return result;
}
