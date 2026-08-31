import {
  DETECTORS,
  EVENT_CONFIDENCE,
  SIGNIFICANCE,
} from "../config/intelligence.ts";
import type { AssetType } from "../types/domain.ts";
import type {
  DetectionResult,
  EventDriver,
  EventSignificance,
  InsufficientHistory,
  IntelligenceEventType,
} from "../types/intelligence-events.ts";
import { clamp, round } from "../utils/number.ts";
import { persistenceOf } from "./significance.ts";
import {
  baselineRatio,
  bestWindow,
  robustDeviation,
  windowChange,
  type TimedValue,
  type WindowStats,
} from "./windows.ts";

/**
 * THE DETECTORS
 *
 * Each answers one question about one asset, against that asset's own recent
 * history. None of them looks at price directly: an asset can rise or fall on
 * nothing, and neither is intelligence. What they read is computed evidence —
 * the score, its components, rank, volume against baseline.
 *
 * Every detector is a pure function of the inputs it is handed. No clock, no
 * randomness, no database. That is what makes a detection reproducible from
 * the stored series that produced it, and what lets the tests drive them with
 * synthetic fixtures without any risk of those fixtures reaching production.
 */

export interface DetectorInput {
  assetId: string;
  symbol: string;
  assetType: AssetType;
  /** Score history, oldest first. */
  scoreSeries: TimedValue[];
  /** Component histories, oldest first. */
  momentumSeries: TimedValue[];
  trendSeries: TimedValue[];
  volumeSeries: TimedValue[];
  rankSeries: TimedValue[];
  /** Current component readings, for driver agreement. */
  components: Partial<Record<string, number>>;
  /** Confidence in the asset's underlying data, 0–1. */
  dataConfidence: number;
  /** Current trend classification, from the compute engine. */
  trendState: string | null;
  trendFitQuality: number | null;
  /** Previous pass's trend classification, when one was stored. */
  previousTrendState: string | null;
  /** Consecutive passes this condition has already been observed. */
  priorObservations: Record<string, number>;
  now: number;
}

export type DetectorOutcome = DetectionResult | InsufficientHistory;

export function isDetection(outcome: DetectorOutcome): outcome is DetectionResult {
  return !("reason" in outcome);
}

/* ------------------------------------------------------------ scaffolding -- */

/**
 * Assembles the four significance readings into one value.
 *
 * A product, not a mean: any single reading near zero must collapse the
 * result. A large move seen once on untrusted data is not significant, and a
 * mean would let its other three readings carry it.
 */
function significance(input: {
  magnitude: number;
  observations: number;
  deviation: number | null;
  dataConfidence: number;
}): EventSignificance {
  const magnitude = clamp(input.magnitude, 0, 1);
  const persistence = persistenceOf(input.observations);
  // With no dispersion to compare against, the move cannot be called unusual;
  // it is treated as ordinary rather than assumed extreme.
  const historicalDeviation =
    input.deviation === null
      ? 0.4
      : clamp(Math.abs(input.deviation) / SIGNIFICANCE.deviationSaturation, 0, 1);
  const dataConfidence = clamp(input.dataConfidence, 0, 1);

  return {
    magnitude: round(magnitude, 4),
    persistence: round(persistence, 4),
    historicalDeviation: round(historicalDeviation, 4),
    dataConfidence: round(dataConfidence, 4),
    value: round(magnitude * persistence * historicalDeviation * dataConfidence, 4),
  };
}

/**
 * How much the independent components agree, −1 to 1.
 *
 * Computed as the net directional consensus: all components moving the same
 * way gives 1, an even split gives 0, and unanimous disagreement with the
 * event's direction gives −1. Conflicting evidence is surfaced, never
 * smoothed into a confident-looking average.
 */
function driverAgreement(drivers: EventDriver[], expected: "up" | "down"): number {
  const directional = drivers.filter((d) => d.direction !== "flat");
  if (directional.length === 0) return 0;

  const agreeing = directional.filter((d) => d.direction === expected).length;
  return round((2 * agreeing) / directional.length - 1, 4);
}

/**
 * Confidence in the EVENT, distinct from confidence in the asset.
 *
 * Weighted toward driver agreement: an event supported by four components
 * moving together is more trustworthy than one resting on a single metric,
 * however well that metric is measured.
 */
function eventConfidence(input: {
  agreement: number;
  dataConfidence: number;
  observations: number;
  historyPoints: number;
}): number {
  const w = EVENT_CONFIDENCE.weights;
  // agreement is −1..1; map to 0..1 so disagreement genuinely costs
  const agreement = clamp((input.agreement + 1) / 2, 0, 1);
  const persistence = persistenceOf(input.observations);
  const depth = clamp(
    input.historyPoints / EVENT_CONFIDENCE.healthyObservations,
    0,
    1,
  );

  return round(
    clamp(
      agreement * w.driverAgreement +
        clamp(input.dataConfidence, 0, 1) * w.dataConfidence +
        persistence * w.persistence +
        depth * w.historyDepth,
      0,
      1,
    ),
    4,
  );
}

function insufficient(
  assetId: string,
  eventType: IntelligenceEventType,
  detail: string,
  required: number,
  available: number,
): InsufficientHistory {
  return {
    assetId,
    eventType,
    reason: "insufficient_history",
    detail,
    observationsRequired: required,
    observationsAvailable: available,
  };
}

/** A driver line built from a measured comparison. */
function driver(
  metric: string,
  observed: number | null,
  baseline: number | null,
  evidence: string,
): EventDriver {
  const magnitude =
    observed === null || baseline === null ? 0 : round(observed - baseline, 4);
  return {
    metric,
    direction: magnitude > 0.001 ? "up" : magnitude < -0.001 ? "down" : "flat",
    magnitude,
    evidence,
    observed: observed === null ? null : round(observed, 4),
    baseline: baseline === null ? null : round(baseline, 4),
  };
}

/** Component drivers, comparing each current reading with its own baseline. */
function componentDrivers(input: DetectorInput, stats: Record<string, WindowStats | null>) {
  const drivers: EventDriver[] = [];
  for (const [metric, series] of [
    ["momentum", input.momentumSeries],
    ["trend", input.trendSeries],
    ["volume", input.volumeSeries],
  ] as const) {
    const window = stats[metric];
    if (!window) continue;
    const current = series.at(-1)?.value ?? null;
    drivers.push(
      driver(
        metric,
        current,
        window.median,
        current !== null && current > window.median
          ? `above_${window.window}_baseline`
          : `below_${window.window}_baseline`,
      ),
    );
  }
  return drivers;
}

/* -------------------------------------------------- strength acceleration -- */

function strengthChange(
  input: DetectorInput,
  direction: "up" | "down",
): DetectorOutcome {
  const eventType: IntelligenceEventType =
    direction === "up" ? "STRENGTH_ACCELERATION" : "STRENGTH_DETERIORATION";
  const config =
    direction === "up"
      ? DETECTORS.STRENGTH_ACCELERATION
      : DETECTORS.STRENGTH_DETERIORATION;

  const window = bestWindow(input.scoreSeries, input.now);
  if (!window.ok) {
    return insufficient(
      input.assetId,
      eventType,
      window.failure.detail,
      window.failure.required,
      window.failure.available,
    );
  }

  const stats = window.stats;
  const change = windowChange(stats);
  const moved = direction === "up" ? change : -change;
  if (moved < config.minChange) {
    return insufficient(
      input.assetId,
      eventType,
      `score moved ${round(change, 2)} over ${stats.window}; ${config.minChange} required`,
      config.minChange,
      Math.abs(round(change, 2)),
    );
  }

  // is this move unusual for this asset, or ordinary noise?
  const deviation = robustDeviation(stats.last, stats);
  if (deviation !== null && Math.abs(deviation) < config.minSigma) {
    return insufficient(
      input.assetId,
      eventType,
      `move is ${round(Math.abs(deviation), 2)} sigma from this asset's own baseline; ${config.minSigma} required`,
      config.minSigma,
      round(Math.abs(deviation), 2),
    );
  }

  const componentWindows: Record<string, WindowStats | null> = {
    momentum: bestWindow(input.momentumSeries, input.now).ok
      ? (bestWindow(input.momentumSeries, input.now) as { stats: WindowStats }).stats
      : null,
    trend: bestWindow(input.trendSeries, input.now).ok
      ? (bestWindow(input.trendSeries, input.now) as { stats: WindowStats }).stats
      : null,
    volume: bestWindow(input.volumeSeries, input.now).ok
      ? (bestWindow(input.volumeSeries, input.now) as { stats: WindowStats }).stats
      : null,
  };

  const drivers = [
    driver("score", stats.last, stats.first, `${stats.window}_change`),
    ...componentDrivers(input, componentWindows),
  ];

  const observations = (input.priorObservations[eventType] ?? 0) + 1;
  const agreement = driverAgreement(drivers, direction);

  // magnitude normalised against the detector's own trigger, so a move twice
  // the threshold reads as twice as large rather than as an absolute figure
  const magnitude = clamp(moved / (config.minChange * 3), 0, 1);

  return {
    assetId: input.assetId,
    symbol: input.symbol,
    assetType: input.assetType,
    eventType,
    magnitude: round(change, 2),
    significance: significance({
      magnitude,
      observations,
      deviation,
      dataConfidence: input.dataConfidence,
    }),
    confidence: eventConfidence({
      agreement,
      dataConfidence: input.dataConfidence,
      observations,
      historyPoints: input.scoreSeries.length,
    }),
    driverAgreement: agreement,
    drivers,
    context: {
      window: stats.window,
      windowSpanMinutes: stats.spanMinutes,
      observationsInWindow: stats.n,
      scoreFrom: round(stats.first, 2),
      scoreTo: round(stats.last, 2),
      deviationSigma: deviation === null ? null : round(deviation, 2),
    },
    value: round(stats.last, 2),
  };
}

export const detectStrengthAcceleration = (input: DetectorInput) =>
  strengthChange(input, "up");
export const detectStrengthDeterioration = (input: DetectorInput) =>
  strengthChange(input, "down");

/* ------------------------------------------------------------ momentum --- */

export function detectMomentumShift(input: DetectorInput): DetectorOutcome {
  const config = DETECTORS.MOMENTUM_SHIFT;
  const window = bestWindow(input.momentumSeries, input.now);
  if (!window.ok) {
    return insufficient(
      input.assetId,
      "MOMENTUM_SHIFT",
      window.failure.detail,
      window.failure.required,
      window.failure.available,
    );
  }

  const stats = window.stats;
  const current = stats.last;
  const change = current - stats.median;

  if (Math.abs(change) < config.minChange) {
    return insufficient(
      input.assetId,
      "MOMENTUM_SHIFT",
      `momentum moved ${round(change, 2)} against its ${stats.window} baseline; ${config.minChange} required`,
      config.minChange,
      Math.abs(round(change, 2)),
    );
  }

  const deviation = robustDeviation(current, stats);
  if (deviation !== null && Math.abs(deviation) < config.minSigma) {
    return insufficient(
      input.assetId,
      "MOMENTUM_SHIFT",
      `momentum is ${round(Math.abs(deviation), 2)} sigma from baseline; ${config.minSigma} required`,
      config.minSigma,
      round(Math.abs(deviation), 2),
    );
  }

  const direction = change > 0 ? "up" : "down";
  const drivers = [driver("momentum", current, stats.median, `${stats.window}_baseline`)];

  const scoreWindow = bestWindow(input.scoreSeries, input.now);
  if (scoreWindow.ok) {
    drivers.push(
      driver("score", scoreWindow.stats.last, scoreWindow.stats.first, `${scoreWindow.stats.window}_change`),
    );
  }

  const observations = (input.priorObservations.MOMENTUM_SHIFT ?? 0) + 1;
  const agreement = driverAgreement(drivers, direction);

  return {
    assetId: input.assetId,
    symbol: input.symbol,
    assetType: input.assetType,
    eventType: "MOMENTUM_SHIFT",
    magnitude: round(change, 2),
    significance: significance({
      magnitude: clamp(Math.abs(change) / (config.minChange * 3), 0, 1),
      observations,
      deviation,
      dataConfidence: input.dataConfidence,
    }),
    confidence: eventConfidence({
      agreement,
      dataConfidence: input.dataConfidence,
      observations,
      historyPoints: input.momentumSeries.length,
    }),
    driverAgreement: agreement,
    drivers,
    context: {
      classification: direction === "up" ? "ACCELERATING" : "DECELERATING",
      window: stats.window,
      baseline: round(stats.median, 2),
      observed: round(current, 2),
      deviationSigma: deviation === null ? null : round(deviation, 2),
    },
    value: round(current, 2),
  };
}

/* --------------------------------------------------------------- trend --- */

/** Ordered so a shift can be described as strengthening or weakening. */
const TREND_ORDER: Record<string, number> = {
  STRONG_DOWNTREND: -2,
  DOWNTREND: -1,
  NEUTRAL: 0,
  UPTREND: 1,
  STRONG_UPTREND: 2,
};

export function detectTrendShift(input: DetectorInput): DetectorOutcome {
  const config = DETECTORS.TREND_SHIFT;

  if (!input.trendState || !input.previousTrendState) {
    return insufficient(
      input.assetId,
      "TREND_SHIFT",
      "a trend shift needs a classification from two consecutive passes",
      2,
      input.trendState ? 1 : 0,
    );
  }

  if (input.trendState === input.previousTrendState) {
    return insufficient(
      input.assetId,
      "TREND_SHIFT",
      `trend is unchanged at ${input.trendState}`,
      1,
      0,
    );
  }

  // a reclassification read off a poor fit is noise changing labels
  if ((input.trendFitQuality ?? 0) < config.minFitQuality) {
    return insufficient(
      input.assetId,
      "TREND_SHIFT",
      `trend fit quality ${round(input.trendFitQuality ?? 0, 2)} is below ${config.minFitQuality}`,
      config.minFitQuality,
      round(input.trendFitQuality ?? 0, 2),
    );
  }

  const from = TREND_ORDER[input.previousTrendState] ?? 0;
  const to = TREND_ORDER[input.trendState] ?? 0;
  const step = to - from;
  const direction = step > 0 ? "up" : "down";

  const drivers: EventDriver[] = [
    {
      metric: "trend",
      direction,
      magnitude: step,
      evidence: `${input.previousTrendState.toLowerCase()}_to_${input.trendState.toLowerCase()}`,
      observed: to,
      baseline: from,
    },
  ];

  const momentumWindow = bestWindow(input.momentumSeries, input.now);
  if (momentumWindow.ok) {
    drivers.push(
      driver(
        "momentum",
        momentumWindow.stats.last,
        momentumWindow.stats.median,
        `${momentumWindow.stats.window}_baseline`,
      ),
    );
  }

  const observations = (input.priorObservations.TREND_SHIFT ?? 0) + 1;
  const agreement = driverAgreement(drivers, direction);

  return {
    assetId: input.assetId,
    symbol: input.symbol,
    assetType: input.assetType,
    eventType: "TREND_SHIFT",
    magnitude: step,
    significance: significance({
      magnitude: clamp(Math.abs(step) / 2, 0, 1),
      observations,
      // the fit quality stands in for how firmly the classification is held
      deviation: (input.trendFitQuality ?? 0) * SIGNIFICANCE.deviationSaturation,
      dataConfidence: input.dataConfidence,
    }),
    confidence: eventConfidence({
      agreement,
      dataConfidence: input.dataConfidence,
      observations,
      historyPoints: input.trendSeries.length,
    }),
    driverAgreement: agreement,
    drivers,
    context: {
      from: input.previousTrendState,
      to: input.trendState,
      fitQuality: round(input.trendFitQuality ?? 0, 3),
      classification: step > 0 ? "STRENGTHENING" : "WEAKENING",
    },
    value: to,
  };
}

/* -------------------------------------------------------------- volume --- */

function volumeChange(input: DetectorInput, direction: "up" | "down"): DetectorOutcome {
  const eventType: IntelligenceEventType =
    direction === "up" ? "VOLUME_EXPANSION" : "VOLUME_CONTRACTION";

  const window = bestWindow(input.volumeSeries, input.now);
  if (!window.ok) {
    return insufficient(
      input.assetId,
      eventType,
      window.failure.detail,
      window.failure.required,
      window.failure.available,
    );
  }

  const stats = window.stats;
  const ratio = baselineRatio(stats.last, stats);
  if (ratio === null) {
    return insufficient(
      input.assetId,
      eventType,
      "the volume baseline is not usable for a ratio",
      1,
      0,
    );
  }

  const triggered =
    direction === "up"
      ? ratio >= DETECTORS.VOLUME_EXPANSION.minRatio
      : ratio <= DETECTORS.VOLUME_CONTRACTION.maxRatio;

  if (!triggered) {
    return insufficient(
      input.assetId,
      eventType,
      `volume is ${round(ratio, 2)}x its ${stats.window} median; threshold not met`,
      direction === "up" ? DETECTORS.VOLUME_EXPANSION.minRatio : DETECTORS.VOLUME_CONTRACTION.maxRatio,
      round(ratio, 2),
    );
  }

  const deviation = robustDeviation(stats.last, stats);
  const observations = (input.priorObservations[eventType] ?? 0) + 1;

  const drivers = [driver("volume", stats.last, stats.median, `${stats.window}_median`)];
  const agreement = driverAgreement(drivers, direction);

  return {
    assetId: input.assetId,
    symbol: input.symbol,
    assetType: input.assetType,
    eventType,
    magnitude: round(ratio, 3),
    significance: significance({
      magnitude:
        direction === "up"
          ? clamp((ratio - 1) / 3, 0, 1)
          : clamp(1 - ratio, 0, 1),
      observations,
      deviation,
      dataConfidence: input.dataConfidence,
    }),
    confidence: eventConfidence({
      agreement,
      dataConfidence: input.dataConfidence,
      observations,
      historyPoints: input.volumeSeries.length,
    }),
    driverAgreement: agreement,
    drivers,
    context: {
      // Stated without interpretation. Elevated volume accompanies both
      // strengthening and deterioration, and the detector does not claim
      // which this is.
      relativeVolume: round(ratio, 3),
      baseline: round(stats.median, 2),
      observed: round(stats.last, 2),
      window: stats.window,
      note: "volume describes participation, not direction",
    },
    value: round(stats.last, 2),
  };
}

export const detectVolumeExpansion = (input: DetectorInput) => volumeChange(input, "up");
export const detectVolumeContraction = (input: DetectorInput) =>
  volumeChange(input, "down");

/* ---------------------------------------------------------------- rank --- */

function rankChange(input: DetectorInput, direction: "up" | "down"): DetectorOutcome {
  const eventType: IntelligenceEventType =
    direction === "up" ? "RANK_ACCELERATION" : "RANK_DETERIORATION";
  const config =
    direction === "up" ? DETECTORS.RANK_ACCELERATION : DETECTORS.RANK_DETERIORATION;

  const window = bestWindow(input.rankSeries, input.now);
  if (!window.ok) {
    return insufficient(
      input.assetId,
      eventType,
      window.failure.detail,
      window.failure.required,
      window.failure.available,
    );
  }

  const stats = window.stats;
  // a lower rank number is a better position, so gains are a negative change
  const positions = stats.first - stats.last;
  const moved = direction === "up" ? positions : -positions;

  if (moved < config.minPositions) {
    return insufficient(
      input.assetId,
      eventType,
      `rank moved ${Math.abs(positions)} positions over ${stats.window}; ${config.minPositions} required`,
      config.minPositions,
      Math.abs(positions),
    );
  }

  const observations = (input.priorObservations[eventType] ?? 0) + 1;
  const drivers: EventDriver[] = [
    {
      metric: "rank",
      direction,
      magnitude: positions,
      evidence: `${stats.window}_rank_change`,
      observed: stats.last,
      baseline: stats.first,
    },
  ];

  const scoreWindow = bestWindow(input.scoreSeries, input.now);
  if (scoreWindow.ok) {
    drivers.push(
      driver("score", scoreWindow.stats.last, scoreWindow.stats.first, `${scoreWindow.stats.window}_change`),
    );
  }

  const agreement = driverAgreement(drivers, direction);

  return {
    assetId: input.assetId,
    symbol: input.symbol,
    assetType: input.assetType,
    eventType,
    magnitude: positions,
    significance: significance({
      magnitude: clamp(moved / (config.minPositions * 3), 0, 1),
      observations,
      deviation: robustDeviation(stats.last, stats),
      dataConfidence: input.dataConfidence,
    }),
    confidence: eventConfidence({
      agreement,
      dataConfidence: input.dataConfidence,
      observations,
      historyPoints: input.rankSeries.length,
    }),
    driverAgreement: agreement,
    drivers,
    context: {
      previousRank: Math.round(stats.first),
      currentRank: Math.round(stats.last),
      positions: Math.abs(positions),
      velocityPerHour:
        stats.spanMinutes > 0
          ? round((positions / stats.spanMinutes) * 60, 2)
          : null,
      window: stats.window,
    },
    value: Math.round(stats.last),
  };
}

export const detectRankAcceleration = (input: DetectorInput) => rankChange(input, "up");
export const detectRankDeterioration = (input: DetectorInput) =>
  rankChange(input, "down");

/* ------------------------------------------------------------- anomaly --- */

/**
 * A metric behaving unusually against its own history.
 *
 * Uses MAD rather than a standard deviation, because the thing being detected
 * is exactly the kind of value that inflates a standard deviation enough to
 * hide itself. Each metric is judged on its own distribution; there is no
 * universal threshold applied across different quantities.
 */
export function detectAnomaly(input: DetectorInput): DetectorOutcome {
  const config = DETECTORS.ANOMALY;

  const candidates: { metric: string; series: TimedValue[] }[] = [
    { metric: "volume", series: input.volumeSeries },
    { metric: "momentum", series: input.momentumSeries },
    { metric: "score", series: input.scoreSeries },
  ];

  let worst: {
    metric: string;
    deviation: number;
    stats: WindowStats;
  } | null = null;

  for (const candidate of candidates) {
    const window = bestWindow(candidate.series, input.now);
    if (!window.ok) continue;
    const deviation = robustDeviation(window.stats.last, window.stats);
    if (deviation === null) continue;
    if (!worst || Math.abs(deviation) > Math.abs(worst.deviation)) {
      worst = { metric: candidate.metric, deviation, stats: window.stats };
    }
  }

  if (!worst) {
    return insufficient(
      input.assetId,
      "ANOMALY",
      "no metric has enough history to establish a baseline",
      config.minObservations,
      0,
    );
  }

  if (Math.abs(worst.deviation) < config.minDeviation) {
    return insufficient(
      input.assetId,
      "ANOMALY",
      `largest deviation is ${round(Math.abs(worst.deviation), 2)}; ${config.minDeviation} required`,
      config.minDeviation,
      round(Math.abs(worst.deviation), 2),
    );
  }

  const observations = (input.priorObservations.ANOMALY ?? 0) + 1;
  const direction = worst.deviation > 0 ? "up" : "down";
  const drivers: EventDriver[] = [
    {
      metric: worst.metric,
      direction,
      magnitude: round(worst.stats.last - worst.stats.median, 4),
      evidence: `${round(Math.abs(worst.deviation), 1)}_mad_from_${worst.stats.window}_median`,
      observed: round(worst.stats.last, 4),
      baseline: round(worst.stats.median, 4),
    },
  ];

  return {
    assetId: input.assetId,
    symbol: input.symbol,
    assetType: input.assetType,
    eventType: "ANOMALY",
    magnitude: round(worst.deviation, 3),
    significance: significance({
      magnitude: clamp(Math.abs(worst.deviation) / (config.minDeviation * 2), 0, 1),
      observations,
      deviation: worst.deviation,
      dataConfidence: input.dataConfidence,
    }),
    confidence: eventConfidence({
      agreement: 1,
      dataConfidence: input.dataConfidence,
      observations,
      historyPoints: worst.stats.n,
    }),
    driverAgreement: 1,
    drivers,
    context: {
      metric: worst.metric,
      observed: round(worst.stats.last, 4),
      baseline: round(worst.stats.median, 4),
      deviation: round(worst.deviation, 3),
      method: "median_absolute_deviation",
      window: worst.stats.window,
    },
    value: round(worst.stats.last, 4),
  };
}

export const ASSET_DETECTORS: ((input: DetectorInput) => DetectorOutcome)[] = [
  detectStrengthAcceleration,
  detectStrengthDeterioration,
  detectMomentumShift,
  detectTrendShift,
  detectVolumeExpansion,
  detectVolumeContraction,
  detectRankAcceleration,
  detectRankDeterioration,
  detectAnomaly,
];
