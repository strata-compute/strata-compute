import type { AssetType } from "../types/domain.ts";

/**
 * STRATA SCORE — CALIBRATION CONFIGURATION
 *
 * What the score means, stated before any arithmetic:
 *
 *   RELATIVE COMPUTED MARKET STRENGTH — how strong an asset's current
 *   computed market profile is compared with its own comparison universe.
 *
 * It is not a probability, a forecast, an expected return, a recommendation,
 * or a sentiment reading. It describes measurements already taken.
 *
 * ---------------------------------------------------------------------------
 * WHY THE UNCALIBRATED SCORE FAILED
 *
 * Every component used fixed-threshold min/max scaling — `scaleTo100(x, lo,
 * hi)` with generous bands chosen by hand. Real markets rarely approach those
 * bands, so each component clustered near 50, and averaging seven
 * mid-clustered components pulled the composite tighter still. Measured over
 * 58 real assets the whole product occupied 35.8–64.9 of a 0–100 scale.
 *
 * The compression happened twice: once in each component, and again in the
 * mean. Fixing only the components would not have fixed the score.
 *
 * The calibration therefore changes both stages:
 *
 *   1. Components become PERCENTILE RANKS within their universe. A percentile
 *      is by construction spread across 0–100, is immune to a single outlier
 *      compressing everything else, and answers exactly the question the
 *      score claims to answer — where does this asset stand among its peers.
 *
 *   2. The composite is then re-expressed against the universe's own
 *      distribution, so a market where assets genuinely differ produces
 *      separated scores and a market where they genuinely do not produces
 *      clustered ones. The scale is anchored, not stretched.
 *
 * No step multiplies, offsets or clamps a score to make the range look
 * fuller. If the underlying assets are alike, the scores stay alike.
 */

/* ------------------------------------------------------------ versioning -- */

/**
 * The scoring method, versioned separately from the compute engine.
 *
 * `computationVersion` identifies the engine that produced the components;
 * `scoreVersion` identifies how those components were turned into a score.
 * They move independently, and a stored result keeps both — so a score
 * computed under the uncalibrated method is never silently reinterpreted as
 * though it had been calibrated.
 */
export const SCORE_VERSION = "strata-v1";

/** What produced every score written before this calibration existed. */
export const LEGACY_SCORE_VERSION = "strata-v0-uncalibrated";

/* ------------------------------------------------------------- universes -- */

export type ScoreUniverse = "stocks" | "crypto" | "onchain" | "all";

export interface UniverseConfig {
  readonly id: ScoreUniverse;
  readonly label: string;
  readonly assetTypes: AssetType[];
  /**
   * Members required before percentile ranks mean anything.
   *
   * A percentile over four assets can only take five values, so the number
   * would imply a precision the sample cannot support. Below this the asset
   * is scored against the combined universe instead, and says so.
   */
  readonly minimumMembers: number;
}

export const UNIVERSES: UniverseConfig[] = [
  { id: "stocks", label: "Tokenised equities", assetTypes: ["stock"], minimumMembers: 8 },
  { id: "crypto", label: "Crypto majors", assetTypes: ["crypto"], minimumMembers: 8 },
  { id: "onchain", label: "Onchain tokens", assetTypes: ["onchain"], minimumMembers: 8 },
  { id: "all", label: "All covered markets", assetTypes: ["stock", "crypto", "onchain"], minimumMembers: 2 },
];

export function universeFor(assetType: AssetType): ScoreUniverse {
  const match = UNIVERSES.find(
    (u) => u.id !== "all" && u.assetTypes.includes(assetType),
  );
  return match?.id ?? "all";
}

export function universeConfig(id: ScoreUniverse): UniverseConfig {
  const found = UNIVERSES.find((u) => u.id === id);
  if (!found) throw new Error(`Unknown universe: ${id}`);
  return found;
}

/* ------------------------------------------------------- normalisation --- */

/**
 * How each component's raw reading becomes a 0–100 value.
 *
 * `percentile` — rank within the universe. Used wherever the meaningful
 *   question is "compared with peers", which is every cross-sectional
 *   component. Robust to outliers by construction: one extreme asset takes
 *   the top rank and leaves the rest of the distribution untouched, where a
 *   min/max scale would have crushed everything else toward zero.
 *
 * `percentileInverted` — rank within the universe, then flipped, so a lower
 *   reading scores higher. Currently unused: every engine already emits its
 *   component in "higher is better" orientation, volatility included. Kept
 *   because a future component may not, and because the alternative is
 *   rediscovering the need for it.
 *
 * The engines still produce their own 0–100 readings; those remain useful as
 * absolute diagnostics and are what the interface shows as engine readings.
 * Calibration re-ranks them for the purpose of scoring.
 */
export type NormalisationMethod = "percentile" | "percentileInverted";

export interface ComponentConfig {
  readonly key: ScoreComponentKey;
  readonly label: string;
  readonly weight: number;
  readonly method: NormalisationMethod;
  /** Higher raw reading should not lower the score. False for volatility. */
  readonly monotonicIncreasing: boolean;
  readonly rationale: string;
}

export type ScoreComponentKey =
  | "momentum"
  | "volume"
  | "activity"
  | "liquidity"
  | "relativeStrength"
  | "trend"
  | "volatility";

/**
 * Weights.
 *
 * Chosen for what each component measures, not for the spread they produce.
 * Momentum and trend describe direction and are what the score is mostly
 * about; volume and activity describe whether the market is real; relative
 * strength places the asset against its class; liquidity and volatility are
 * quality terms that temper the rest.
 *
 * Volatility carries the smallest weight and is the one component whose RAW
 * measurement is treated non-monotonically: calmer scores higher, because a
 * violent move is not a strong one. The engine performs that inversion, so
 * normalisation here ranks its output directly.
 *
 * That posture has one failure mode worth naming: an asset whose price never
 * moves has zero volatility and would read as maximum calm. Degenerate series
 * are therefore rejected upstream, in feature engineering, rather than
 * patched around here.
 */
export const SCORE_COMPONENTS: ComponentConfig[] = [
  {
    key: "momentum",
    label: "Momentum",
    weight: 0.24,
    method: "percentile",
    monotonicIncreasing: true,
    rationale:
      "Directional strength across available timeframes. Percentile-ranked because a 3% move means something different in equities than in a small onchain token.",
  },
  {
    key: "trend",
    label: "Trend",
    weight: 0.18,
    method: "percentile",
    monotonicIncreasing: true,
    rationale:
      "Fitted slope weighted by fit quality. Ranked rather than scaled so a steep slope through noise cannot outrank a moderate slope through a clean series.",
  },
  {
    key: "volume",
    label: "Volume",
    weight: 0.16,
    method: "percentile",
    monotonicIncreasing: true,
    rationale:
      "Turnover against peers. Volume is heavy-tailed across orders of magnitude; a percentile is the only transform that survives that without a log-and-guess band.",
  },
  {
    key: "relativeStrength",
    label: "Relative strength",
    weight: 0.16,
    method: "percentile",
    monotonicIncreasing: true,
    rationale:
      "Excess return over the asset's own class benchmark. Already relative; ranking makes the degree of outperformance comparable too.",
  },
  {
    key: "activity",
    label: "Activity",
    weight: 0.12,
    method: "percentile",
    monotonicIncreasing: true,
    rationale:
      "Participation. Counts differ by orders of magnitude between chains and venues, so only rank is comparable.",
  },
  {
    key: "liquidity",
    label: "Liquidity",
    weight: 0.08,
    method: "percentile",
    monotonicIncreasing: true,
    rationale:
      "Depth against turnover. Weighted low because no configured provider publishes book depth for most covered assets, so it is absent far more often than present.",
  },
  {
    key: "volatility",
    label: "Volatility",
    weight: 0.06,
    // Plain percentile, NOT inverted.
    //
    // The inversion already happened upstream: the volatility engine reports
    // `100 - scaled(annualised volatility)`, so its output is oriented
    // "higher means calmer" like every other component. Inverting again here
    // would flip it back and score the calmest markets lowest — which is
    // exactly what the first version of this config did, until a monotonicity
    // test caught it.
    method: "percentile",
    // Describes the RAW annualised reading, which the score deliberately
    // treats as non-monotonic: more volatility is not more strength.
    monotonicIncreasing: false,
    rationale:
      "A quality term. The engine already reports it calm-high, so it is ranked directly; the non-monotonicity lives in the engine's inversion of raw annualised volatility, where a violent market scores low. Smallest weight, because volatility describes how an asset moves rather than how well.",
  },
];

export const COMPONENT_KEYS: ScoreComponentKey[] = SCORE_COMPONENTS.map((c) => c.key);

export function componentConfig(key: ScoreComponentKey): ComponentConfig {
  const found = SCORE_COMPONENTS.find((c) => c.key === key);
  if (!found) throw new Error(`Unknown score component: ${key}`);
  return found;
}

/* -------------------------------------------------------- aggregation --- */

export const AGGREGATION = {
  /**
   * Minimum share of total weight that must be backed by real components.
   * Below this the asset reports INSUFFICIENT_DATA rather than a number
   * assembled from a fraction of the picture.
   */
  minimumCoverage: 0.45,

  /** Components without which a score is not published at all. */
  requiredComponents: ["momentum"] as ScoreComponentKey[],

  /**
   * How the composite is expressed against the universe distribution.
   *
   * The composite of percentile-ranked components is centred near 50 by
   * construction and has a standard deviation well under the full range —
   * averaging k roughly-uniform variables shrinks dispersion by about √k.
   * Re-expressing it in standard deviations restores separation *in
   * proportion to the separation that actually exists*, which is the whole
   * distinction between calibrating and stretching.
   *
   * `spreadPerSigma` sets the anchor: 50 is the universe average, and each
   * standard deviation of composite strength moves the score by this much. At
   * 16, one sigma reads 66 and two sigma reads 82 — leaving genuine headroom
   * above 90 for assets that are exceptional rather than merely top-ranked.
   */
  centre: 50,
  spreadPerSigma: 16,

  /**
   * Below this dispersion the universe is treated as undifferentiated and the
   * composite is published without re-expression. Dividing by a near-zero
   * standard deviation would turn measurement noise into large score
   * differences — the exact failure this calibration exists to avoid.
   */
  minimumSigma: 1.5,
} as const;

/* ------------------------------------------------------------ buckets --- */

export interface ScoreBucket {
  readonly min: number;
  readonly label: string;
}

/**
 * Semantic bands.
 *
 * Every label describes present measured standing. None implies a forecast:
 * "Strong" says the computed profile is strong now, not that the price will
 * rise.
 */
export const SCORE_BUCKETS: ScoreBucket[] = [
  { min: 90, label: "Exceptional" },
  { min: 80, label: "Strong" },
  { min: 70, label: "Positive" },
  { min: 60, label: "Above average" },
  { min: 40, label: "Neutral" },
  { min: 20, label: "Weak" },
  { min: 0, label: "Very weak" },
];

export function bucketFor(score: number): string {
  return SCORE_BUCKETS.find((b) => score >= b.min)?.label ?? "Neutral";
}

/* --------------------------------------------------------- confidence --- */

export const CONFIDENCE = {
  /** Observations for a well-supported historical component. */
  healthyHistoryPoints: 200,
  /** Seconds after which an observation stops counting as fresh. */
  freshnessWindowSeconds: 900,
  maximumAgeSeconds: 86_400,

  /**
   * Universe members for a fully-supported percentile.
   *
   * Granularity is 100/n points: a rank in a universe of 20 moves the
   * percentile by 5, which is fine, while a rank in a universe of 8 moves it
   * by 12.5, which is coarse enough to matter. Tying support directly to that
   * coarseness is more defensible than a multiple of the minimum.
   */
  healthyUniverseSize: 20,

  /**
   * Completeness BOUNDS confidence; it is not one addend among four.
   *
   * The additive version this replaces produced a single band for every
   * asset. Freshness and historical depth both saturate near 1.0 across the
   * covered set, so they contributed a constant 0.45 floor, and an asset
   * measured on 4 of 7 components landed at 0.851 against 0.860 for one
   * measured on 6 of 7 — a 28-point completeness gap compressed into 0.011 of
   * confidence. Every asset read HIGH, including those missing three
   * components.
   *
   * Multiplying fixes the semantics rather than the presentation: perfectly
   * fresh, deep data about 4 of 7 components still only tells you about 4 of
   * 7 components. No amount of quality in what was measured can speak for
   * what was not.
   */
  qualityWeights: {
    freshness: 0.45,
    historicalDepth: 0.3,
    universeSupport: 0.25,
  },

  /**
   * Bands, set against what the measure can now actually produce. HIGH
   * requires both a near-complete component set and a universe large enough
   * to rank within — reachable, but not by data that is missing three
   * components or ranking against eight peers.
   */
  bands: { high: 0.8, medium: 0.55 },
} as const;
