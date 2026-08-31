import { EARLY_MOVER, QUALITY, REGIME } from "../config/scoring.ts";
import type { AssetIntelligence, AssetType, NormalizedMarketData, Observation } from "../types/domain.ts";
import type {
  Anomaly,
  BreadthCounts,
  EarlyMover,
  MarketBreadth,
  MarketRegime,
} from "../types/intelligence.ts";
import { clamp, round, scaleTo100 } from "../utils/number.ts";
import { nowIso } from "../utils/time.ts";
import { medianOf, relativeToBaseline, zScore } from "../compute/features/series.ts";

/**
 * MARKET-LEVEL INTELLIGENCE
 *
 * Everything here describes the covered set as a whole rather than any single
 * asset: how many things are advancing, whether the market is expanding or
 * retreating, which assets are accelerating before they show up in the
 * rankings, and where behaviour has departed from its own history.
 *
 * The discipline is the same as everywhere else, with one addition specific
 * to aggregates: a statement about "the market" is only as honest as the
 * market it actually measured. Strata covers a few dozen assets, not the
 * whole of global markets, so every output here is explicitly a reading of
 * the covered set — and below `REGIME.minimumAssets` no regime is claimed at
 * all, because a handful of assets is a sample, not a market.
 */

/* ------------------------------------------------------------- breadth --- */

/** A move smaller than this is noise, not direction. */
const UNCHANGED_BAND_PCT = 0.1;

function countBreadth(changes: (number | null)[]): BreadthCounts {
  let advancing = 0;
  let declining = 0;
  let unchanged = 0;

  for (const change of changes) {
    if (change === null) continue;
    if (change > UNCHANGED_BAND_PCT) advancing += 1;
    else if (change < -UNCHANGED_BAND_PCT) declining += 1;
    else unchanged += 1;
  }

  const total = advancing + declining + unchanged;
  const directional = advancing + declining;

  return {
    advancing,
    declining,
    unchanged,
    total,
    // undefined when nothing moved either way, rather than an arbitrary 0.5
    advanceDeclineRatio: directional === 0 ? null : round(advancing / directional, 4),
  };
}

export function computeBreadth(
  records: { assetType: AssetType; priceChange24h: number | null }[],
): MarketBreadth {
  const classes: AssetType[] = ["stock", "crypto", "onchain"];

  const byClass = {} as Record<AssetType, BreadthCounts>;
  for (const assetType of classes) {
    byClass[assetType] = countBreadth(
      records.filter((r) => r.assetType === assetType).map((r) => r.priceChange24h),
    );
  }

  const moves = records
    .map((r) => r.priceChange24h)
    .filter((c): c is number => c !== null)
    .map((c) => Math.abs(c));

  return {
    overall: countBreadth(records.map((r) => r.priceChange24h)),
    byClass,
    medianAbsMovePct: moves.length === 0 ? null : round(medianOf(moves) ?? 0, 4),
    calculatedAt: nowIso(),
  };
}

/* -------------------------------------------------------------- regime --- */

/**
 * The regime of the covered set.
 *
 * Read from two measured aggregates — how broadly the market is advancing,
 * and how violently it is moving — and nothing else. There is no sentiment
 * input, no news feed and no forecast: the state describes what the stored
 * observations say right now.
 *
 * Volatility takes precedence over direction. A market where breadth is
 * positive but moves are extreme is not risk-on in any sense a participant
 * would recognise, and labelling it so would be the most misleading output
 * this function could produce.
 */
export function computeRegime(
  records: { assetType: AssetType; priceChange24h: number | null }[],
): MarketRegime {
  const breadth = computeBreadth(records);
  const at = nowIso();

  if (breadth.overall.total < REGIME.minimumAssets) {
    return {
      status: "INSUFFICIENT_DATA",
      state: null,
      confidence: null,
      drivers: [],
      breadth,
      insufficientReason: `a market regime needs ${REGIME.minimumAssets} scored assets; ${breadth.overall.total} are available`,
      calculatedAt: at,
    };
  }

  const ratio = breadth.overall.advanceDeclineRatio;
  const volatility = breadth.medianAbsMovePct;

  if (ratio === null) {
    return {
      status: "INSUFFICIENT_DATA",
      state: null,
      confidence: null,
      drivers: [],
      breadth,
      insufficientReason: "no asset moved beyond the unchanged band in this pass",
      calculatedAt: at,
    };
  }

  const drivers: string[] = [];
  let state: MarketRegime["state"];

  if (volatility !== null && volatility >= REGIME.highVolatilityPct) {
    state = "HIGH_VOLATILITY";
    drivers.push(
      `median absolute move of ${volatility.toFixed(2)}% across ${breadth.overall.total} assets`,
    );
  } else if (ratio >= REGIME.riskOnBreadth) {
    state = "RISK_ON";
    drivers.push(
      `${breadth.overall.advancing} of ${breadth.overall.advancing + breadth.overall.declining} moving assets advancing`,
    );
  } else if (ratio <= REGIME.riskOffBreadth) {
    state = "RISK_OFF";
    drivers.push(
      `${breadth.overall.declining} of ${breadth.overall.advancing + breadth.overall.declining} moving assets declining`,
    );
  } else {
    state = "NEUTRAL";
    drivers.push(
      `advance/decline split at ${(ratio * 100).toFixed(0)}/${(100 - ratio * 100).toFixed(0)}`,
    );
  }

  if (volatility !== null && state !== "HIGH_VOLATILITY") {
    drivers.push(`median absolute move ${volatility.toFixed(2)}%`);
  }

  // where the classes disagree, that disagreement is itself the finding
  const classNotes: string[] = [];
  for (const [assetType, counts] of Object.entries(breadth.byClass)) {
    if (counts.total < 3 || counts.advanceDeclineRatio === null) continue;
    classNotes.push(
      `${assetType} ${(counts.advanceDeclineRatio * 100).toFixed(0)}% advancing`,
    );
  }
  if (classNotes.length > 0) drivers.push(classNotes.join(", "));

  // Confidence in the reading scales with how much of the set was measurable
  // and how decisive the split is — a 51/49 market is genuinely ambiguous and
  // should not be reported as though it were not.
  const coverage = clamp(breadth.overall.total / Math.max(records.length, 1), 0, 1);
  const decisiveness = clamp(Math.abs(ratio - 0.5) * 2, 0, 1);

  return {
    status: "OK",
    state,
    confidence: round(clamp(coverage * 0.5 + decisiveness * 0.5, 0, 1), 4),
    drivers,
    breadth,
    insufficientReason: null,
    calculatedAt: at,
  };
}

/* -------------------------------------------------------- early movers --- */

export interface EarlyMoverInput {
  record: AssetIntelligence;
  current: NormalizedMarketData;
  history: Observation[];
}

/**
 * Assets where participation is building faster than price has reflected.
 *
 * The conjunction matters more than any single term. Price rising on nothing
 * is a move that already happened; volume rising on nothing is noise. What
 * this looks for is volume and activity accelerating while price has not yet
 * run — which is why an asset that has already moved more than
 * `alreadyMovedPct` is excluded no matter how strong its accelerations are.
 *
 * This is detection, not prediction. The stages describe how much
 * corroboration has accumulated, and nothing here claims what happens next.
 */
export function detectEarlyMovers(inputs: EarlyMoverInput[]): EarlyMover[] {
  const out: EarlyMover[] = [];

  for (const input of inputs) {
    const { record, current, history } = input;
    if (history.length < QUALITY.minimumHistoryPoints) continue;

    const volumeAcceleration = record.engines.volume.acceleration;
    const priceAcceleration = record.score.components.momentum !== undefined
      ? (record.engines.momentum.change ?? null)
      : null;

    // activity acceleration from the asset's own counts
    const activityHistory = history
      .map((h) => h.tradeCount24h ?? h.uniqueParticipants24h)
      .filter((v): v is number => v !== null && v > 0);
    const currentActivity = current.tradeCount24h ?? current.uniqueParticipants24h;

    let activityAcceleration: number | null = null;
    if (currentActivity !== null && activityHistory.length >= QUALITY.minimumHistoryPoints) {
      const ratio = relativeToBaseline(currentActivity, activityHistory.slice(0, -1));
      if (ratio !== null) activityAcceleration = round(ratio - 1, 4);
    }

    const terms: { value: number; weight: number }[] = [];
    if (volumeAcceleration !== null) {
      terms.push({ value: volumeAcceleration, weight: EARLY_MOVER.weights.volumeAcceleration });
    }
    if (activityAcceleration !== null) {
      terms.push({ value: activityAcceleration, weight: EARLY_MOVER.weights.activityAcceleration });
    }
    if (priceAcceleration !== null) {
      // momentum change is in score points; rescale to a comparable fraction
      terms.push({ value: priceAcceleration / 100, weight: EARLY_MOVER.weights.priceAcceleration });
    }

    // a single accelerating term is not an early move, it is one number
    if (terms.length < 2) continue;

    const totalWeight = terms.reduce((sum, t) => sum + t.weight, 0);
    const composite = terms.reduce((sum, t) => sum + t.value * t.weight, 0) / totalWeight;
    if (composite < EARLY_MOVER.minimumAcceleration) continue;

    const move = current.priceChange24h;
    if (move !== null && Math.abs(move) > EARLY_MOVER.alreadyMovedPct) continue;

    const score = round(clamp(scaleTo100(composite, 0, 1.5), 0, 100), 2);

    let stage: EarlyMover["stage"] = "EARLY";
    if (score >= EARLY_MOVER.confirmedThreshold && move !== null && move > 0) {
      stage = "CONFIRMED";
    } else if (score >= EARLY_MOVER.watchThreshold) {
      stage = "WATCH";
    }

    const rationale: string[] = [];
    if (volumeAcceleration !== null) {
      rationale.push(
        `Volume ${volumeAcceleration >= 0 ? "up" : "down"} ${Math.abs(volumeAcceleration * 100).toFixed(0)}% against its earlier window`,
      );
    }
    if (activityAcceleration !== null) {
      rationale.push(
        `Activity ${activityAcceleration >= 0 ? "up" : "down"} ${Math.abs(activityAcceleration * 100).toFixed(0)}% against baseline`,
      );
    }
    if (move !== null) {
      rationale.push(`Price has moved ${move >= 0 ? "+" : ""}${move.toFixed(2)}% over 24h`);
    }

    out.push({
      assetId: record.assetId,
      symbol: record.symbol,
      assetType: record.assetType,
      stage,
      score,
      volumeAcceleration,
      activityAcceleration,
      priceAcceleration,
      rationale,
      detectedAt: nowIso(),
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

/* ----------------------------------------------------------- anomalies --- */

/**
 * Behaviour that departs from an asset's own history.
 *
 * Every reading is against that asset's baseline, never a global constant,
 * and an asset without enough history produces no anomalies at all rather
 * than being judged against someone else's normal.
 */
export function detectAnomalies(
  assetId: string,
  symbol: string,
  current: NormalizedMarketData,
  history: Observation[],
): Anomaly[] {
  const out: Anomaly[] = [];
  const at = nowIso();

  if (history.length < QUALITY.minimumHistoryPoints) return out;

  const volumes = history
    .map((h) => h.volume24h)
    .filter((v): v is number => v !== null && v > 0)
    .slice(0, -1);

  if (current.volume24h !== null && volumes.length >= QUALITY.minimumHistoryPoints) {
    const ratio = relativeToBaseline(current.volume24h, volumes);
    if (ratio !== null && ratio >= 4) {
      out.push({
        assetId,
        symbol,
        kind: "volume",
        magnitude: round(ratio, 3),
        baseline: round(medianOf(volumes) ?? 0, 2),
        observed: round(current.volume24h, 2),
        baselineSamples: volumes.length,
        detail: `Volume is ${ratio.toFixed(1)}x its ${volumes.length}-observation median`,
        detectedAt: at,
      });
    }
  }

  const activityHistory = history
    .map((h) => h.tradeCount24h ?? h.uniqueParticipants24h)
    .filter((v): v is number => v !== null && v > 0)
    .slice(0, -1);
  const currentActivity = current.tradeCount24h ?? current.uniqueParticipants24h;

  if (currentActivity !== null && activityHistory.length >= QUALITY.minimumHistoryPoints) {
    const ratio = relativeToBaseline(currentActivity, activityHistory);
    if (ratio !== null && ratio >= 5) {
      out.push({
        assetId,
        symbol,
        kind: "activity",
        magnitude: round(ratio, 3),
        baseline: round(medianOf(activityHistory) ?? 0, 2),
        observed: round(currentActivity, 2),
        baselineSamples: activityHistory.length,
        detail: `Activity is ${ratio.toFixed(1)}x its ${activityHistory.length}-observation median`,
        detectedAt: at,
      });
    }
  }

  const prices = history.map((h) => h.price).filter((p) => p > 0);
  if (prices.length >= QUALITY.minimumHistoryPoints && current.priceChange24h !== null) {
    const rets: number[] = [];
    for (let i = 1; i < prices.length; i += 1) {
      const prev = prices[i - 1] as number;
      if (prev > 0) rets.push((((prices[i] as number) - prev) / prev) * 100);
    }
    const sigma = zScore(current.priceChange24h, rets);
    if (sigma !== null && Math.abs(sigma) >= 3) {
      out.push({
        assetId,
        symbol,
        kind: "price",
        magnitude: round(sigma, 3),
        baseline: round(medianOf(rets) ?? 0, 4),
        observed: round(current.priceChange24h, 4),
        baselineSamples: rets.length,
        detail: `24h move is ${Math.abs(sigma).toFixed(1)}σ outside this asset's normal range`,
        detectedAt: at,
      });
    }
  }

  const liquidityHistory = history
    .map((h) => h.liquidity)
    .filter((v): v is number => v !== null && v > 0)
    .slice(0, -1);

  if (current.liquidity !== null && liquidityHistory.length >= QUALITY.minimumHistoryPoints) {
    const ratio = relativeToBaseline(current.liquidity, liquidityHistory);
    if (ratio !== null && (ratio >= 1.5 || ratio <= 0.6)) {
      out.push({
        assetId,
        symbol,
        kind: "liquidity",
        magnitude: round(ratio, 3),
        baseline: round(medianOf(liquidityHistory) ?? 0, 2),
        observed: round(current.liquidity, 2),
        baselineSamples: liquidityHistory.length,
        detail: `Liquidity is ${ratio.toFixed(2)}x its baseline`,
        detectedAt: at,
      });
    }
  }

  return out;
}
