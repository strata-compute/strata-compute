import { QUALITY } from "../../config/scoring.ts";
import type { Feature, FeatureSet } from "../../types/intelligence.ts";
import { feature, unavailable } from "../../types/intelligence.ts";
import type { NormalizedMarketData, Observation } from "../../types/domain.ts";
import { round } from "../../utils/number.ts";
import {
  acceleration,
  annualisedVolatility,
  changePct,
  distinctRatio,
  isDegenerate,
  linearRegression,
  medianOf,
  relativeToBaseline,
  returns,
  sortByTime,
  stripOutliers,
} from "./series.ts";

/**
 * FEATURE ENGINEERING
 *
 * Turns a current observation plus whatever history exists into a set of
 * measured quantities in their natural units. It computes; it does not score.
 * Nothing here is squeezed into 0–100, because the raw figure is what has to
 * stay inspectable when someone asks where a score came from.
 *
 * The governing rule is stated once and applied everywhere: a feature whose
 * inputs do not exist is `null` with a written reason. Not zero, not a
 * neutral midpoint, not the last known value. A caller can always distinguish
 * "measured and it was nothing" from "could not measure".
 */

/**
 * One stored observation of an asset. Defined in the domain so the store can
 * serve it without depending on the compute layer.
 */
export type HistoricalObservation = Observation;

export interface FeatureInput {
  current: NormalizedMarketData;
  /** Any order; sorted internally. May be empty. */
  history: HistoricalObservation[];
  /** 24h price change of the asset's benchmark group, if one was resolvable. */
  benchmarkChange24h: number | null;
  /** 24h volumes across the asset's class, for cross-sectional strength. */
  peerVolumes: number[];
  /** 24h changes across the asset's class. */
  peerChanges: number[];
  /**
   * The instant this pass is evaluated against, in epoch milliseconds.
   *
   * Supplied rather than read from the clock so the function is a pure
   * function of its arguments. That is what makes a computation reproducible
   * from stored inputs — and it also guarantees every asset in a pass is
   * measured against the same moment, instead of each one against whenever
   * the loop happened to reach it.
   */
  now: number;
}

const HOURS_PER_YEAR = 8_760;

/** Median gap between observations, in hours. Null when history is too thin. */
function medianSpacingHours(sorted: { timestamp: string }[]): number | null {
  if (sorted.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const a = new Date(sorted[i - 1]!.timestamp).getTime();
    const b = new Date(sorted[i]!.timestamp).getTime();
    if (b > a) gaps.push((b - a) / 3_600_000);
  }
  const spacing = medianOf(gaps);
  return spacing !== null && spacing > 0 ? spacing : null;
}

/** Observations within the last `hours`, ascending. */
function window(
  sorted: HistoricalObservation[],
  hours: number,
  now: number,
): HistoricalObservation[] {
  const cutoff = now - hours * 3_600_000;
  return sorted.filter((point) => new Date(point.timestamp).getTime() >= cutoff);
}

/**
 * Change over a trailing window, measured from stored history.
 *
 * Distinct from the provider's own `priceChange24h`: this one is derived from
 * observations Strata holds and can show, which is what lets the interface
 * answer "compared to what?" with an actual series.
 */
function windowChange(
  sorted: HistoricalObservation[],
  hours: number,
  now: number,
  label: string,
): Feature {
  const points = window(sorted, hours, now);
  if (points.length < 2) {
    return unavailable(
      `needs two observations within ${label}; have ${points.length}`,
      points.length,
    );
  }

  // The window must actually be spanned. Two observations ten minutes apart
  // describe ten minutes, and reporting that as a 24h change would be a
  // fabrication dressed as a measurement — so the oldest point has to reach
  // back across most of the window before the figure is published at all.
  const oldest = new Date(points[0]!.timestamp).getTime();
  const newest = new Date(points.at(-1)!.timestamp).getTime();
  const spannedHours = (newest - oldest) / 3_600_000;
  if (spannedHours < hours * 0.7) {
    return unavailable(
      `history spans only ${spannedHours.toFixed(1)}h of the ${label} window`,
      points.length,
    );
  }

  const value = changePct(points[0]!.price, points.at(-1)!.price);
  if (value === null) {
    return unavailable(`non-positive base price in the ${label} window`, points.length);
  }
  return feature(round(value, 4), points.length);
}

/* ------------------------------------------------------------- builder --- */

export function buildFeatures(input: FeatureInput): FeatureSet {
  const { current } = input;
  const sorted = sortByTime(
    input.history.map((h) => ({ ...h, value: h.price })),
  ) as unknown as HistoricalObservation[];

  const now = input.now;
  const prices = sorted.map((point) => point.price).filter((p) => p > 0);
  const { cleaned } = stripOutliers(prices, QUALITY.outlierSigma);
  const spacingHours = medianSpacingHours(sorted);

  /**
   * A price series that never moves supports no momentum, no trend and no
   * volatility. Establishing that once here keeps every dependent feature
   * from independently rediscovering it and reporting a flattering constant.
   *
   * The threshold is deliberately low: only 2% of observations need to differ
   * for the series to be usable. This rejects a stalled feed, not a quiet
   * market.
   */
  const degenerate = isDegenerate(cleaned);
  const variety = distinctRatio(cleaned);
  const tooCoarse = cleaned.length >= QUALITY.minimumHistoryPoints && variety < 0.02;
  const noMovement = degenerate || tooCoarse;
  const noMovementReason = degenerate
    ? `price has not changed across ${cleaned.length} stored observations`
    : `only ${(variety * 100).toFixed(1)}% of ${cleaned.length} observations differ; the series is too flat to measure`;

  /* ---- price changes ---- */

  // The provider's own 1h and 24h figures are used where it published them:
  // they are computed against the provider's full tick history, which is
  // deeper than anything Strata has accumulated. Stored history is the
  // fallback and the only source for 7d.
  // A provider's own published change is an observation and is always
  // honoured. A change DERIVED from our stored series is not, when that
  // series never moves: "0% over 24h" computed from a feed that has not
  // updated describes a stalled quote, not a flat market, and letting it
  // through is what put non-trading assets in the middle of the momentum
  // ranking instead of out of it.
  const priceChange1h =
    current.priceChange1h !== null
      ? feature(round(current.priceChange1h, 4), 1)
      : noMovement
        ? unavailable(noMovementReason, cleaned.length)
        : windowChange(sorted, 1, now, "1h");

  const priceChange24h =
    current.priceChange24h !== null
      ? feature(round(current.priceChange24h, 4), 1)
      : noMovement
        ? unavailable(noMovementReason, cleaned.length)
        : windowChange(sorted, 24, now, "24h");

  const priceChange7d = noMovement
    ? unavailable(noMovementReason, cleaned.length)
    : windowChange(sorted, 24 * 7, now, "7d");

  /* ---- volume ---- */

  const volumeHistory = sorted
    .map((point) => point.volume24h)
    .filter((v): v is number => v !== null && v > 0);

  let volumeChange: Feature;
  if (current.volume24h === null) {
    volumeChange = unavailable("no current volume published for this asset");
  } else if (volumeHistory.length < QUALITY.minimumHistoryPoints) {
    volumeChange = unavailable(
      `needs ${QUALITY.minimumHistoryPoints} volume observations for a baseline; have ${volumeHistory.length}`,
      volumeHistory.length,
    );
  } else {
    // exclude the current observation from its own baseline
    const baseline = volumeHistory.slice(0, -1);
    const ratio = relativeToBaseline(current.volume24h, baseline);
    volumeChange =
      ratio === null
        ? unavailable("volume baseline has no usable median", baseline.length)
        : feature(round(ratio, 4), baseline.length);
  }

  // cross-sectional: where this volume sits among peers priced the same way
  let volumeStrength: Feature;
  if (current.volume24h === null) {
    volumeStrength = unavailable("no current volume published for this asset");
  } else if (input.peerVolumes.length < 2) {
    volumeStrength = unavailable(
      `needs at least 2 peers with volume; have ${input.peerVolumes.length}`,
      input.peerVolumes.length,
    );
  } else {
    const peerMedian = medianOf(input.peerVolumes);
    volumeStrength =
      peerMedian === null || peerMedian <= 0
        ? unavailable("peer volume median is not usable", input.peerVolumes.length)
        : feature(round(current.volume24h / peerMedian, 4), input.peerVolumes.length);
  }

  /* ---- momentum (raw blend, scored later) ---- */

  const momentumParts: { value: number; weight: number }[] = [];
  if (priceChange1h.value !== null) momentumParts.push({ value: priceChange1h.value, weight: 0.2 });
  if (priceChange24h.value !== null) momentumParts.push({ value: priceChange24h.value, weight: 0.5 });
  if (priceChange7d.value !== null) momentumParts.push({ value: priceChange7d.value, weight: 0.3 });

  const momentum =
    momentumParts.length === 0
      ? unavailable("no price change available over any timeframe")
      : feature(
          round(
            momentumParts.reduce((sum, p) => sum + p.value * p.weight, 0) /
              momentumParts.reduce((sum, p) => sum + p.weight, 0),
            4,
          ),
          momentumParts.length,
        );

  /* ---- volatility ---- */

  let volatility: Feature;
  if (noMovement) {
    // zero dispersion is not calm; it is no observation
    volatility = unavailable(noMovementReason, cleaned.length);
  } else if (cleaned.length < QUALITY.minimumHistoryPoints) {
    volatility = unavailable(
      `needs ${QUALITY.minimumHistoryPoints} price observations; have ${cleaned.length}`,
      cleaned.length,
    );
  } else if (spacingHours === null) {
    volatility = unavailable("observation spacing could not be determined", cleaned.length);
  } else {
    const periodsPerYear = HOURS_PER_YEAR / spacingHours;
    const value = annualisedVolatility(returns(cleaned), periodsPerYear);
    volatility =
      value === null
        ? unavailable("returns have no measurable dispersion", cleaned.length)
        : feature(round(value, 3), cleaned.length);
  }

  /* ---- liquidity ---- */

  const liquidityStrength =
    current.liquidity === null
      ? unavailable("no liquidity published for this asset")
      : feature(round(current.liquidity, 2), 1);

  /* ---- activity ---- */

  let activityStrength: Feature;
  if (current.tradeCount24h !== null) {
    activityStrength = feature(round(current.tradeCount24h, 2), 1);
  } else if (current.uniqueParticipants24h !== null) {
    activityStrength = feature(round(current.uniqueParticipants24h, 2), 1);
  } else {
    activityStrength = unavailable("no trade count or participant count published");
  }

  /* ---- relative strength ---- */

  let relativeStrength: Feature;
  if (priceChange24h.value === null) {
    relativeStrength = unavailable("asset has no 24h change to compare");
  } else if (input.benchmarkChange24h === null) {
    relativeStrength = unavailable("no benchmark available for this asset class");
  } else {
    relativeStrength = feature(
      round(priceChange24h.value - input.benchmarkChange24h, 4),
      input.peerChanges.length,
    );
  }

  /* ---- trend ---- */

  let trendStrength: Feature;
  if (noMovement) {
    trendStrength = unavailable(noMovementReason, cleaned.length);
  } else if (cleaned.length < QUALITY.minimumHistoryPoints || spacingHours === null) {
    trendStrength = unavailable(
      `needs ${QUALITY.minimumHistoryPoints} observations to fit a trend; have ${cleaned.length}`,
      cleaned.length,
    );
  } else {
    // x in days, y as a percentage of the mean level, so the slope reads
    // directly as "percent per day" and is comparable across price scales
    const xs = cleaned.map((_, i) => (i * spacingHours) / 24);
    const level = medianOf(cleaned) as number;
    const ys = cleaned.map((p) => (p / level) * 100);
    const fit = linearRegression(xs, ys);
    trendStrength =
      fit === null
        ? unavailable("trend could not be fitted to the observations", cleaned.length)
        : feature(round(fit.slope, 4), cleaned.length);
  }

  /* ---- acceleration ---- */

  const accel = acceleration(cleaned);
  const accelerationFeature =
    accel === null
      ? unavailable(
          `needs 4 price observations to measure acceleration; have ${cleaned.length}`,
          cleaned.length,
        )
      : feature(round(accel, 4), cleaned.length);

  return {
    priceChange1h,
    priceChange24h,
    priceChange7d,
    volumeChange,
    volumeStrength,
    momentum,
    volatility,
    liquidityStrength,
    activityStrength,
    relativeStrength,
    trendStrength,
    acceleration: accelerationFeature,
  };
}

/** Fit quality of the trend, needed separately by the trend engine. */
export function trendFit(
  history: HistoricalObservation[],
): { slope: number; r2: number } | null {
  const sorted = sortByTime(
    history.map((h) => ({ ...h, value: h.price })),
  ) as unknown as HistoricalObservation[];
  const prices = sorted.map((p) => p.price).filter((p) => p > 0);
  const { cleaned } = stripOutliers(prices, QUALITY.outlierSigma);
  if (cleaned.length < QUALITY.minimumHistoryPoints) return null;
  // a flat series fits a slope of exactly zero, which is arithmetic rather
  // than a trend
  if (isDegenerate(cleaned) || distinctRatio(cleaned) < 0.02) return null;

  const spacing = medianSpacingHours(sorted);
  if (spacing === null) return null;

  const xs = cleaned.map((_, i) => (i * spacing) / 24);
  const level = medianOf(cleaned) as number;
  const ys = cleaned.map((p) => (p / level) * 100);
  const fit = linearRegression(xs, ys);
  return fit === null ? null : { slope: fit.slope, r2: fit.r2 };
}
