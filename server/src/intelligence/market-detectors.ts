import { DETECTORS, SIGNIFICANCE } from "../config/intelligence.ts";
import { universeFor, type ScoreUniverse } from "../config/score-v1.ts";
import type { AssetType } from "../types/domain.ts";
import type {
  DetectionResult,
  EventDriver,
  InsufficientHistory,
} from "../types/intelligence-events.ts";
import { medianOf } from "../compute/features/series.ts";
import { clamp, round } from "../utils/number.ts";
import { persistenceOf } from "./significance.ts";

/**
 * MARKET-LEVEL DETECTORS
 *
 * These describe the covered set rather than any single asset, and they carry
 * one extra obligation: a statement about "the market" is only as honest as
 * the market it actually measured. Strata covers a few dozen assets, so
 * every output here is explicitly a reading of the covered set, with its size
 * attached.
 *
 * Rotation in particular is easy to overclaim. A crypto universe strengthening
 * while equities weaken is a shift in *relative computed strength*. It is not
 * evidence that capital moved between them — Strata observes prices and
 * volumes, not flows, and no arrangement of those two can establish where
 * money went. The language and the context field both stay inside what the
 * data supports.
 */

export interface UniverseSnapshot {
  universe: ScoreUniverse;
  assetType: AssetType;
  /** Current scores of every scored member. */
  scores: number[];
  /** Score change per member over the comparison window. */
  changes: number[];
  size: number;
}

export interface BreadthCounts {
  advancing: number;
  declining: number;
  unchanged: number;
  total: number;
  /** advancing / (advancing + declining). Null when nothing moved. */
  ratio: number | null;
}

/** A move smaller than this is noise, not direction. */
const UNCHANGED_BAND = 0.5;

export function breadthOf(changes: number[]): BreadthCounts {
  let advancing = 0;
  let declining = 0;
  let unchanged = 0;

  for (const change of changes) {
    if (change > UNCHANGED_BAND) advancing += 1;
    else if (change < -UNCHANGED_BAND) declining += 1;
    else unchanged += 1;
  }

  const directional = advancing + declining;
  return {
    advancing,
    declining,
    unchanged,
    total: changes.length,
    ratio: directional === 0 ? null : round(advancing / directional, 4),
  };
}

/* ------------------------------------------------- cross-market rotation -- */

export interface RotationInput {
  universes: UniverseSnapshot[];
  /** Consecutive passes the same rotation has already been observed. */
  priorObservations: number;
  /** Mean data confidence across the covered set, 0–1. */
  dataConfidence: number;
  window: string;
}

/**
 * Relative strength rotating between universes.
 *
 * Requires three things simultaneously: a material spread between the
 * strongest and weakest universe's median change, breadth confirming that the
 * spread is not one asset dragging an average, and enough members in both
 * universes for their aggregates to mean anything.
 *
 * Reported as a rotation in relative strength. Never as capital flow.
 */
export function detectRotation(
  input: RotationInput,
): DetectionResult | InsufficientHistory {
  const config = DETECTORS.CROSS_MARKET_ROTATION;

  const eligible = input.universes.filter(
    (u) => u.size >= config.minUniverseSize && u.changes.length > 0,
  );

  if (eligible.length < 2) {
    return {
      assetId: null,
      eventType: "CROSS_MARKET_ROTATION",
      reason: "insufficient_history",
      detail: `rotation needs two universes of at least ${config.minUniverseSize} scored assets; ${eligible.length} qualify`,
      observationsRequired: 2,
      observationsAvailable: eligible.length,
    };
  }

  const summarised = eligible
    .map((u) => ({
      universe: u.universe,
      median: medianOf(u.changes) ?? 0,
      breadth: breadthOf(u.changes),
      size: u.size,
    }))
    .sort((a, b) => b.median - a.median);

  const strongest = summarised[0]!;
  const weakest = summarised.at(-1)!;
  const spread = strongest.median - weakest.median;

  if (spread < config.minSpread) {
    return {
      assetId: null,
      eventType: "CROSS_MARKET_ROTATION",
      reason: "insufficient_history",
      detail: `universe spread is ${round(spread, 2)} points; ${config.minSpread} required`,
      observationsRequired: config.minSpread,
      observationsAvailable: round(spread, 2),
    };
  }

  // breadth has to confirm the spread: one asset moving a median is not a
  // rotation, it is an outlier
  const strongBreadth = strongest.breadth.ratio ?? 0;
  const weakBreadth = 1 - (weakest.breadth.ratio ?? 1);

  if (strongBreadth < config.minBreadth || weakBreadth < config.minBreadth) {
    return {
      assetId: null,
      eventType: "CROSS_MARKET_ROTATION",
      reason: "insufficient_history",
      detail: `breadth does not confirm the spread (${strongest.universe} ${round(strongBreadth * 100, 0)}% advancing, ${weakest.universe} ${round(weakBreadth * 100, 0)}% declining); ${round(config.minBreadth * 100, 0)}% required on both`,
      observationsRequired: config.minBreadth,
      observationsAvailable: round(Math.min(strongBreadth, weakBreadth), 2),
    };
  }

  const observations = input.priorObservations + 1;
  if (observations < config.minObservations) {
    return {
      assetId: null,
      eventType: "CROSS_MARKET_ROTATION",
      reason: "insufficient_history",
      detail: `rotation has held for ${observations} pass${observations === 1 ? "" : "es"}; ${config.minObservations} required before it is reported`,
      observationsRequired: config.minObservations,
      observationsAvailable: observations,
    };
  }

  const drivers: EventDriver[] = summarised.map((u) => ({
    metric: `${u.universe}_relative_strength`,
    direction: u.median > UNCHANGED_BAND ? "up" : u.median < -UNCHANGED_BAND ? "down" : "flat",
    magnitude: round(u.median, 2),
    evidence: `median_score_change_over_${input.window}`,
    observed: round(u.median, 2),
    baseline: 0,
  }));

  const magnitude = clamp(spread / (config.minSpread * 3), 0, 1);
  const persistence = persistenceOf(observations);
  const breadthStrength = clamp((strongBreadth + weakBreadth) / 2, 0, 1);

  return {
    assetId: null,
    symbol: null,
    assetType: null,
    eventType: "CROSS_MARKET_ROTATION",
    magnitude: round(spread, 2),
    significance: {
      magnitude: round(magnitude, 4),
      persistence: round(persistence, 4),
      historicalDeviation: round(breadthStrength, 4),
      dataConfidence: round(clamp(input.dataConfidence, 0, 1), 4),
      value: round(
        magnitude * persistence * breadthStrength * clamp(input.dataConfidence, 0, 1),
        4,
      ),
    },
    confidence: round(
      clamp(breadthStrength * 0.5 + clamp(input.dataConfidence, 0, 1) * 0.3 + persistence * 0.2, 0, 1),
      4,
    ),
    driverAgreement: round(breadthStrength * 2 - 1, 4),
    drivers,
    context: {
      // Named as relative strength, deliberately. Strata observes prices and
      // volumes; it cannot see where capital went, and does not claim to.
      interpretation: "relative strength rotation",
      strengthening: strongest.universe,
      weakening: weakest.universe,
      spread: round(spread, 2),
      breadth: {
        [strongest.universe]: `${strongest.breadth.advancing}/${strongest.breadth.total} advancing`,
        [weakest.universe]: `${weakest.breadth.declining}/${weakest.breadth.total} declining`,
      },
      universeSizes: Object.fromEntries(summarised.map((u) => [u.universe, u.size])),
      window: input.window,
      caveat: "measured across the assets Strata covers; not a claim about capital flow",
    },
    value: round(spread, 2),
  };
}

/* ----------------------------------------------------------- regime shift -- */

export type MarketRegimeState = "RISK_ON" | "RISK_OFF" | "NEUTRAL" | "HIGH_VOLATILITY";

export interface RegimeInput {
  current: MarketRegimeState | null;
  previous: MarketRegimeState | null;
  /** Consecutive passes the NEW state has held. */
  consecutivePasses: number;
  breadth: BreadthCounts;
  medianAbsMove: number | null;
  dataConfidence: number;
  coveredAssets: number;
}

/**
 * A persistent change in the computed market state.
 *
 * Persistence is the whole point. A regime that flips on one noisy pass is
 * not a regime, so the new state must hold for several consecutive passes
 * before the change is reported at all.
 */
export function detectRegimeShift(
  input: RegimeInput,
): DetectionResult | InsufficientHistory {
  const config = DETECTORS.REGIME_SHIFT;

  if (!input.current || !input.previous) {
    return {
      assetId: null,
      eventType: "REGIME_SHIFT",
      reason: "insufficient_history",
      detail: "a regime shift needs a computed state from two consecutive passes",
      observationsRequired: 2,
      observationsAvailable: input.current ? 1 : 0,
    };
  }

  if (input.current === input.previous) {
    return {
      assetId: null,
      eventType: "REGIME_SHIFT",
      reason: "insufficient_history",
      detail: `regime is unchanged at ${input.current}`,
      observationsRequired: 1,
      observationsAvailable: 0,
    };
  }

  if (input.consecutivePasses < config.minObservations) {
    return {
      assetId: null,
      eventType: "REGIME_SHIFT",
      reason: "insufficient_history",
      detail: `${input.current} has held for ${input.consecutivePasses} pass${input.consecutivePasses === 1 ? "" : "es"}; ${config.minObservations} required before a shift is claimed`,
      observationsRequired: config.minObservations,
      observationsAvailable: input.consecutivePasses,
    };
  }

  const drivers: EventDriver[] = [
    {
      metric: "market_regime",
      direction: input.current === "RISK_ON" ? "up" : input.current === "RISK_OFF" ? "down" : "flat",
      magnitude: 1,
      evidence: `${input.previous.toLowerCase()}_to_${input.current.toLowerCase()}`,
      observed: null,
      baseline: null,
    },
    {
      metric: "breadth",
      direction:
        (input.breadth.ratio ?? 0.5) > 0.5 ? "up" : (input.breadth.ratio ?? 0.5) < 0.5 ? "down" : "flat",
      magnitude: round((input.breadth.ratio ?? 0.5) * 100, 1),
      evidence: "advance_decline_ratio",
      observed: round((input.breadth.ratio ?? 0) * 100, 1),
      baseline: 50,
    },
  ];

  const persistence = persistenceOf(input.consecutivePasses);
  const decisiveness = clamp(Math.abs((input.breadth.ratio ?? 0.5) - 0.5) * 2, 0, 1);

  return {
    assetId: null,
    symbol: null,
    assetType: null,
    eventType: "REGIME_SHIFT",
    magnitude: input.consecutivePasses,
    significance: {
      magnitude: round(decisiveness, 4),
      persistence: round(persistence, 4),
      historicalDeviation: round(decisiveness, 4),
      dataConfidence: round(clamp(input.dataConfidence, 0, 1), 4),
      value: round(
        decisiveness * persistence * decisiveness * clamp(input.dataConfidence, 0, 1),
        4,
      ),
    },
    confidence: round(
      clamp(persistence * 0.4 + decisiveness * 0.35 + clamp(input.dataConfidence, 0, 1) * 0.25, 0, 1),
      4,
    ),
    driverAgreement: round(decisiveness, 4),
    drivers,
    context: {
      from: input.previous,
      to: input.current,
      heldForPasses: input.consecutivePasses,
      advancing: input.breadth.advancing,
      declining: input.breadth.declining,
      unchanged: input.breadth.unchanged,
      medianAbsMovePct: input.medianAbsMove === null ? null : round(input.medianAbsMove, 2),
      coveredAssets: input.coveredAssets,
      caveat: "describes the assets Strata covers, not global markets",
    },
    value: null,
  };
}

export function universeOf(assetType: AssetType): ScoreUniverse {
  return universeFor(assetType);
}
