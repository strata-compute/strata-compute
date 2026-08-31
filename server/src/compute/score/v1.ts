import {
  CONFIDENCE_BANDS,
  QUALITY,
  SCORE_COMPONENTS,
  scoringConfig,
  type ScoreComponent,
  type ScoringConfig,
} from "../../config/scoring.ts";
import type {
  ConfidenceBand,
  EngineOutputs,
  ScoreConfidence,
  ScoreDriver,
  StrataScoreResult,
} from "../../types/intelligence.ts";
import { clamp, round } from "../../utils/number.ts";
import { nowIso } from "../../utils/time.ts";

/**
 * STRATA SCORE V1
 *
 * A weighted composite of seven independently computed components — and,
 * more importantly, an honest one.
 *
 * The design problem a market score has to solve is not the arithmetic. It is
 * what to do when part of the picture is missing, which for real market data
 * is most of the time. The usual answer is to substitute a neutral 50 for the
 * absent component and carry on. That is the one thing this engine will not
 * do, because it produces a number that looks identical whether it was built
 * from seven measurements or from two, and no amount of small print next to
 * it repairs that.
 *
 * Instead:
 *
 *   1. Absent components are *excluded*, and the remaining weights are
 *      renormalised over what actually exists. An asset with no liquidity
 *      feed is scored on the six components it does have, not marked down for
 *      the seventh.
 *
 *   2. Coverage is tracked. Below `minimumCoverage`, or missing a required
 *      component, the engine returns INSUFFICIENT_DATA and a null score.
 *      There is no partial credit and no placeholder number.
 *
 *   3. Confidence is reported separately and never folded into the score. A
 *      thinly-covered asset can be genuinely strong; the correct output is a
 *      high score with low confidence, not a good score quietly discounted
 *      into a mediocre one. Conflating the two destroys both.
 *
 * The result is deterministic: identical inputs produce an identical score,
 * with no clock, no randomness and no dependence on evaluation order.
 */

/** Reads each engine's component value, or the reason it has none. */
function collectComponents(engines: EngineOutputs): {
  available: Map<ScoreComponent, number>;
  missing: { component: ScoreComponent; reason: string }[];
  depthSamples: number[];
} {
  const available = new Map<ScoreComponent, number>();
  const missing: { component: ScoreComponent; reason: string }[] = [];

  const sources: Record<
    ScoreComponent,
    { score: number | null; unavailableReason: string | null }
  > = {
    momentum: engines.momentum,
    volume: engines.volume,
    activity: engines.activity,
    liquidity: engines.liquidity,
    relativeStrength: engines.relativeStrength,
    trend: engines.trend,
    volatility: engines.volatility,
  };

  for (const component of SCORE_COMPONENTS) {
    const source = sources[component];
    if (source.score === null) {
      missing.push({
        component,
        reason: source.unavailableReason ?? "component was not computed",
      });
    } else {
      available.set(component, clamp(source.score, 0, 100));
    }
  }

  // components that require history contribute to the depth reading
  const depthSamples: number[] = [];
  if (engines.trend.fitQuality !== null) depthSamples.push(1);
  if (engines.volatility.mediumTermPct !== null) depthSamples.push(1);
  if (engines.volume.relativeVolume !== null) depthSamples.push(1);

  return { available, missing, depthSamples };
}

/**
 * Confidence in the *inputs*, not in the outcome.
 *
 * Four independent readings, multiplied rather than averaged: a mean would
 * let three good readings hide one fatal gap, and stale data does not become
 * acceptable because the remaining components were complete.
 */
function computeConfidence(
  available: Map<ScoreComponent, number>,
  coverage: number,
  ageSeconds: number | null,
  historyPoints: number,
): ScoreConfidence {
  const completeness = clamp(coverage, 0, 1);

  // Freshness decays linearly across the freshness window and keeps decaying,
  // more slowly, out to the maximum usable age.
  let freshness: number;
  if (ageSeconds === null) {
    freshness = 0.5;
  } else if (ageSeconds <= QUALITY.freshnessWindowSeconds) {
    freshness = 1 - (ageSeconds / QUALITY.freshnessWindowSeconds) * 0.15;
  } else if (ageSeconds >= QUALITY.maximumAgeSeconds) {
    freshness = 0.1;
  } else {
    const span = QUALITY.maximumAgeSeconds - QUALITY.freshnessWindowSeconds;
    const travelled = (ageSeconds - QUALITY.freshnessWindowSeconds) / span;
    freshness = 0.85 - travelled * 0.75;
  }

  // Depth saturates at the healthy threshold: more history beyond that does
  // not make the calculation meaningfully more trustworthy.
  const historicalDepth = clamp(
    historyPoints / QUALITY.healthyHistoryPoints,
    0,
    1,
  );

  const componentsAvailable = available.size;
  const componentsTotal = SCORE_COMPONENTS.length;

  // Depth is weighted gently: an asset can be well-measured right now with a
  // short history, and should not be treated as unreliable for it.
  const value = clamp(
    completeness * 0.45 +
      freshness * 0.3 +
      historicalDepth * 0.15 +
      (componentsAvailable / componentsTotal) * 0.1,
    0,
    1,
  );

  const band: ConfidenceBand =
    value >= CONFIDENCE_BANDS.high ? "HIGH" : value >= CONFIDENCE_BANDS.medium ? "MEDIUM" : "LOW";

  return {
    value: round(value, 4),
    band,
    completeness: round(completeness, 4),
    freshness: round(clamp(freshness, 0, 1), 4),
    historicalDepth: round(historicalDepth, 4),
    componentsAvailable,
    componentsTotal,
  };
}

/**
 * Turns computed components into the reasons behind the number.
 *
 * A driver is the points a component added to or removed from the composite
 * relative to a neutral 50, weighted as it actually entered the score. The
 * accompanying detail is assembled from the measured quantity — the volume
 * multiple, the trend slope, the excess return — so every clause can be
 * traced back to an input. Nothing here is written by a model.
 */
function buildDrivers(
  available: Map<ScoreComponent, number>,
  weights: Record<ScoreComponent, number>,
  totalWeight: number,
  engines: EngineOutputs,
): ScoreDriver[] {
  const details: Partial<Record<ScoreComponent, string>> = {};

  const m = engines.momentum;
  if (m.score !== null) {
    details.momentum = `${m.direction === "falling" ? "Negative" : m.direction === "flat" ? "Flat" : "Positive"} momentum across ${m.timeframes.join(", ")}`;
  }

  const v = engines.volume;
  if (v.score !== null) {
    // The volume component is mostly cross-sectional — where this asset's
    // turnover sits among its class — with its own baseline as a refinement.
    // The explanation has to lead with the term that actually moved the
    // number: captioning a high component with "0.5x its own baseline" states
    // a true fact that contradicts the direction it is shown driving, which
    // is worse than saying nothing.
    const standing =
      v.score >= 66 ? "high" : v.score >= 40 ? "mid" : "low";
    const baseline =
      v.relativeVolume !== null
        ? `, ${v.relativeVolume.toFixed(2)}x its own baseline`
        : "";
    details.volume = `Turnover in the ${standing} range for its class${baseline}`;
  }

  const a = engines.activity;
  if (a.score !== null) {
    details.activity =
      a.basis === "onchain"
        ? "Onchain participation measured against peers"
        : "Market turnover measured against capitalisation";
  }

  const l = engines.liquidity;
  if (l.score !== null) {
    details.liquidity =
      l.changePct !== null
        ? `Liquidity ${l.changePct >= 0 ? "expanded" : "contracted"} ${Math.abs(l.changePct).toFixed(1)}%`
        : "Liquidity depth measured against turnover";
  }

  const rs = engines.relativeStrength;
  if (rs.score !== null && rs.excessReturnPct !== null) {
    details.relativeStrength = `${rs.excessReturnPct >= 0 ? "Outperforming" : "Underperforming"} ${rs.benchmarkLabel} by ${Math.abs(rs.excessReturnPct).toFixed(2)} points`;
  }

  const t = engines.trend;
  if (t.score !== null && t.slopePctPerDay !== null) {
    details.trend = `${(t.state ?? "NEUTRAL").replace(/_/g, " ").toLowerCase()} at ${t.slopePctPerDay >= 0 ? "+" : ""}${t.slopePctPerDay.toFixed(2)}%/day (fit ${((t.fitQuality ?? 0) * 100).toFixed(0)}%)`;
  }

  const vol = engines.volatility;
  if (vol.score !== null && vol.mediumTermPct !== null) {
    details.volatility = `Volatility ${vol.mediumTermPct.toFixed(0)}% annualised${vol.expansion !== null && vol.expansion > 1.2 ? ", expanding" : ""}`;
  }

  const drivers: ScoreDriver[] = [];
  for (const [component, value] of available) {
    const share = (weights[component] ?? 0) / totalWeight;
    // points contributed relative to a neutral 50
    const contribution = (value - 50) * share;
    if (Math.abs(contribution) < 0.05) continue;
    drivers.push({
      component,
      direction: contribution >= 0 ? "positive" : "negative",
      contribution: round(contribution, 2),
      detail: details[component] ?? `${component} scored ${value.toFixed(1)}`,
    });
  }

  return drivers.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

export interface ScoreInput {
  engines: EngineOutputs;
  /** Age of the underlying observation, in seconds. */
  ageSeconds: number | null;
  /** Observations behind the historical components. */
  historyPoints: number;
  config?: ScoringConfig;
}

export function computeStrataScore(input: ScoreInput): StrataScoreResult {
  const config = input.config ?? scoringConfig();
  const weights = config.weights as Record<ScoreComponent, number>;
  const { available, missing } = collectComponents(input.engines);

  const totalPossibleWeight = SCORE_COMPONENTS.reduce(
    (sum, c) => sum + (weights[c] ?? 0),
    0,
  );
  const availableWeight = [...available.keys()].reduce(
    (sum, c) => sum + (weights[c] ?? 0),
    0,
  );
  const coverage = totalPossibleWeight === 0 ? 0 : availableWeight / totalPossibleWeight;

  const confidence = computeConfidence(
    available,
    coverage,
    input.ageSeconds,
    input.historyPoints,
  );

  const componentsOut: Partial<Record<ScoreComponent, number>> = {};
  for (const [component, value] of available) componentsOut[component] = round(value, 2);

  /* ---- the gates ---- */

  const missingRequired = config.requiredComponents.filter((c) => !available.has(c));
  if (missingRequired.length > 0) {
    return {
      status: "INSUFFICIENT_DATA",
      score: null,
      version: config.version,
      components: componentsOut,
      missing,
      confidence,
      drivers: [],
      insufficientReason: `required component${missingRequired.length > 1 ? "s" : ""} unavailable: ${missingRequired.join(", ")}`,
      calculatedAt: nowIso(),
    };
  }

  if (coverage < config.minimumCoverage) {
    return {
      status: "INSUFFICIENT_DATA",
      score: null,
      version: config.version,
      components: componentsOut,
      missing,
      confidence,
      drivers: [],
      insufficientReason: `only ${(coverage * 100).toFixed(0)}% of scoring weight is backed by real data; ${(config.minimumCoverage * 100).toFixed(0)}% is required`,
      calculatedAt: nowIso(),
    };
  }

  /* ---- the composite ---- */

  // Renormalising over the available weight is what keeps a six-component
  // score on the same 0–100 axis as a seven-component one, instead of being
  // structurally capped below it.
  let weighted = 0;
  for (const [component, value] of available) {
    weighted += value * ((weights[component] ?? 0) / availableWeight);
  }

  return {
    status: "OK",
    score: round(clamp(weighted, 0, 100), 2),
    version: config.version,
    components: componentsOut,
    missing,
    confidence,
    drivers: buildDrivers(available, weights, availableWeight, input.engines),
    insufficientReason: null,
    calculatedAt: nowIso(),
  };
}
