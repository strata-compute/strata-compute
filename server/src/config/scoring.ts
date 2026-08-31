import type { AssetType } from "../types/domain.ts";

/**
 * SCORING & DETECTION CONFIGURATION
 *
 * Every weight, threshold and window used by the computation layer lives
 * here. Nothing downstream hardcodes a number: engines read from this module,
 * so recalibrating the product is a change to one file rather than a search
 * across the codebase.
 *
 * The configuration is keyed by computation version. Historical results keep
 * the version they were computed under, so changing a weight cannot silently
 * rewrite the meaning of a score that was already published — a v2 is a new
 * entry here, not an edit to v1.
 */

/* ------------------------------------------------------------- weights --- */

/**
 * The seven components of a Strata Score.
 *
 * `volatility` is deliberately included as a *quality* term rather than a
 * performance one: a violent move is not the same as a strong one, and a
 * score that cannot tell them apart is a momentum chase with extra steps.
 */
export interface ScoreWeights {
  momentum: number;
  volume: number;
  activity: number;
  liquidity: number;
  relativeStrength: number;
  trend: number;
  volatility: number;
}

export type ScoreComponent = keyof ScoreWeights;

export const SCORE_COMPONENTS: ScoreComponent[] = [
  "momentum",
  "volume",
  "activity",
  "liquidity",
  "relativeStrength",
  "trend",
  "volatility",
];

export interface ScoringConfig {
  readonly version: string;
  readonly description: string;
  readonly weights: Readonly<ScoreWeights>;
  /**
   * Minimum share of total weight that must be backed by real inputs before a
   * score is published at all. Below this the asset reports
   * INSUFFICIENT_DATA rather than a number assembled from two components and
   * a lot of hope.
   */
  readonly minimumCoverage: number;
  /** Components that must be present regardless of coverage arithmetic. */
  readonly requiredComponents: ScoreComponent[];
}

export const SCORING_V1: ScoringConfig = {
  version: "v1",
  description:
    "Weighted composite of seven independently computed components. Weights are renormalised over whatever the data actually supports; absent components are excluded, never defaulted to a neutral value.",
  weights: {
    momentum: 0.24,
    volume: 0.18,
    trend: 0.16,
    relativeStrength: 0.14,
    liquidity: 0.12,
    activity: 0.1,
    volatility: 0.06,
  },
  // a score needs at least 55% of its weight backed by real inputs
  minimumCoverage: 0.55,
  // momentum is the spine of the score; without it there is nothing to say
  requiredComponents: ["momentum"],
};

const REGISTRY: Record<string, ScoringConfig> = {
  [SCORING_V1.version]: SCORING_V1,
};

/** The version new computations are written under. */
export const CURRENT_SCORING_VERSION = SCORING_V1.version;

export function scoringConfig(version: string = CURRENT_SCORING_VERSION): ScoringConfig {
  const config = REGISTRY[version];
  if (!config) throw new Error(`Unknown scoring version: ${version}`);
  return config;
}

export function listScoringVersions(): ScoringConfig[] {
  return Object.values(REGISTRY);
}

/* ---------------------------------------------------------- benchmarks --- */

/**
 * Relative strength is meaningless without a stated comparison group.
 *
 * Measuring an equity against Bitcoin would produce a number, and the number
 * would mean nothing. Each asset class is compared against the median move of
 * its own class, which is the only comparison the data actually supports:
 * every member is priced by the same kind of market on the same day.
 */
export interface BenchmarkGroup {
  readonly id: string;
  readonly label: string;
  readonly appliesTo: AssetType[];
  /**
   * How the benchmark return is derived from the group. "median" resists a
   * single outlier dragging the whole benchmark, which a mean does not.
   */
  readonly method: "median";
  /** Minimum members before the benchmark is considered meaningful. */
  readonly minimumMembers: number;
}

export const BENCHMARK_GROUPS: BenchmarkGroup[] = [
  {
    id: "equities",
    label: "Tokenised equities",
    appliesTo: ["stock"],
    method: "median",
    minimumMembers: 5,
  },
  {
    id: "crypto-majors",
    label: "Crypto majors",
    appliesTo: ["crypto"],
    method: "median",
    minimumMembers: 4,
  },
  {
    id: "onchain",
    label: "Onchain tokens",
    appliesTo: ["onchain"],
    method: "median",
    minimumMembers: 4,
  },
];

export function benchmarkFor(assetType: AssetType): BenchmarkGroup | null {
  return BENCHMARK_GROUPS.find((group) => group.appliesTo.includes(assetType)) ?? null;
}

/* ---------------------------------------------------------- thresholds --- */

/**
 * Volume regime bands, expressed as a multiple of the asset's own baseline
 * rather than an absolute notional — the only way one scale can describe a
 * mega-cap equity and a small onchain pool at once.
 */
export const VOLUME_REGIME = {
  elevated: 1.5,
  high: 2.5,
  extreme: 4.0,
} as const;

/** Trend classification bands, in standard deviations of the trend slope. */
export const TREND_BANDS = {
  strongUp: 1.0,
  up: 0.3,
  down: -0.3,
  strongDown: -1.0,
} as const;

/**
 * Signal thresholds. Every detector reads its trigger from here so the feed
 * can be recalibrated without touching detector logic.
 *
 * `sigma` values are deviations from the asset's own historical baseline;
 * `ratio` values are multiples of it.
 */
export const SIGNAL_THRESHOLDS = {
  MOMENTUM_SPIKE: { low: 1.5, medium: 2.0, high: 3.0, critical: 4.0 },
  VOLUME_ACCELERATION: { low: 1.5, medium: 2.5, high: 4.0, critical: 6.0 },
  PRICE_BREAKOUT: { low: 1.0, medium: 1.5, high: 2.0, critical: 3.0 },
  VOLATILITY_EXPANSION: { low: 1.5, medium: 2.0, high: 3.0, critical: 4.0 },
  LIQUIDITY_EXPANSION: { low: 0.1, medium: 0.2, high: 0.35, critical: 0.5 },
  LIQUIDITY_CONTRACTION: { low: 0.1, medium: 0.2, high: 0.35, critical: 0.5 },
  ACTIVITY_SPIKE: { low: 1.5, medium: 2.5, high: 4.0, critical: 6.0 },
  RANK_CHANGE: { low: 3, medium: 6, high: 12, critical: 20 },
  TREND_REVERSAL: { low: 0.5, medium: 1.0, high: 1.5, critical: 2.0 },
  UNUSUAL_ACTIVITY: { low: 2.0, medium: 3.0, high: 4.0, critical: 6.0 },
} as const;

/** How long a detected signal stays relevant, by type, in seconds. */
export const SIGNAL_TTL_SECONDS: Record<string, number> = {
  MOMENTUM_SPIKE: 3_600,
  VOLUME_ACCELERATION: 7_200,
  PRICE_BREAKOUT: 7_200,
  VOLATILITY_EXPANSION: 10_800,
  LIQUIDITY_EXPANSION: 21_600,
  LIQUIDITY_CONTRACTION: 21_600,
  ACTIVITY_SPIKE: 7_200,
  RANK_CHANGE: 21_600,
  TREND_REVERSAL: 43_200,
  UNUSUAL_ACTIVITY: 10_800,
};

/* ------------------------------------------------------- early movers --- */

/**
 * Early movement is the conjunction of three accelerations, not any one of
 * them. A price that is already up without volume behind it is a move that
 * has happened; the point of this detector is the case where participation is
 * building faster than price has yet reflected.
 */
export const EARLY_MOVER = {
  /** Minimum acceleration (change in rate of change) to register at all. */
  minimumAcceleration: 0.15,
  /** Score above which a candidate is promoted from EARLY to WATCH. */
  watchThreshold: 55,
  /** Score above which the move is CONFIRMED by price follow-through. */
  confirmedThreshold: 72,
  /** Price move beyond which a candidate is no longer "early". */
  alreadyMovedPct: 12,
  weights: {
    volumeAcceleration: 0.4,
    activityAcceleration: 0.3,
    priceAcceleration: 0.3,
  },
} as const;

/* ------------------------------------------------------ market regime --- */

/**
 * Regime bands, read from aggregate breadth and volatility across the whole
 * covered set. These are cross-sectional facts about the market Strata can
 * see — not a forecast, and not a claim about markets it does not cover.
 */
export const REGIME = {
  /** Advance/decline ratio above which breadth is expansionary. */
  riskOnBreadth: 0.6,
  riskOffBreadth: 0.4,
  /** Median absolute 24h move above which the market is in a volatile state. */
  highVolatilityPct: 4.5,
  /** Minimum assets before a regime is claimed at all. */
  minimumAssets: 8,
} as const;

/* -------------------------------------------------------- data quality --- */

/**
 * Data-quality gates. Every computation is checked against these before its
 * result is published; failing one produces INSUFFICIENT_DATA rather than a
 * number carrying an invisible asterisk.
 */
export const QUALITY = {
  /** Observations required before a historical baseline means anything. */
  minimumHistoryPoints: 8,
  /** Observations for a well-supported baseline; below this depth is scaled. */
  healthyHistoryPoints: 48,
  /** Seconds after which an observation stops counting as fresh. */
  freshnessWindowSeconds: 900,
  /** Seconds after which an observation is too old to compute from at all. */
  maximumAgeSeconds: 86_400,
  /** Returns beyond this many sigma are treated as suspect, not as signal. */
  outlierSigma: 8,
} as const;

/** Confidence bands used for presentation. */
export const CONFIDENCE_BANDS = {
  high: 0.8,
  medium: 0.55,
} as const;
