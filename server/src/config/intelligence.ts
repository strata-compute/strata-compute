import type {
  IntelligenceEventType,
  IntelligenceWindow,
} from "../types/intelligence-events.ts";

/**
 * INTELLIGENCE CONFIGURATION
 *
 * Every window, threshold and weight the detection layer uses. Nothing in the
 * detectors hardcodes a number, and no threshold was chosen because it
 * produced a satisfying quantity of events.
 *
 * The thresholds are expressed in units that are already comparable across
 * assets — standard deviations of the asset's own history, multiples of its
 * own baseline, ranks within its own universe — precisely so that one
 * constant can apply to a mega-cap equity and a small onchain token without
 * favouring either.
 */

export const INTELLIGENCE_VERSION = "intel-v1";

/* --------------------------------------------------------------- windows -- */

/** Comparison windows, in minutes. */
export const WINDOW_MINUTES: Record<IntelligenceWindow, number> = {
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "24h": 1_440,
  "7d": 10_080,
};

/**
 * Observations a window must contain before it may be used.
 *
 * The pipeline stores roughly one observation every two minutes, so these are
 * deliberately below the theoretical count: a window is usable when it holds
 * enough points to compute a robust statistic, not when it is perfectly full.
 * A window that cannot meet its minimum reports `insufficient_history` rather
 * than being computed from whatever happens to be there.
 */
export const WINDOW_MINIMUM_OBSERVATIONS: Record<IntelligenceWindow, number> = {
  "15m": 5,
  "1h": 12,
  "4h": 30,
  "24h": 60,
  "7d": 200,
};

/**
 * The share of a window that observations must actually span.
 *
 * The observation minimum alone is not enough. Seventy-eight minutes of dense
 * history satisfies the 4h count, and a detector would then report a "4h
 * baseline" built entirely from the last hour — a window label attached to
 * data that never covered it. The span check is what makes the window name a
 * description rather than a claim.
 */
export const WINDOW_MINIMUM_SPAN_RATIO = 0.7;

/** The window a detector prefers, falling back down this list. */
export const WINDOW_PREFERENCE: IntelligenceWindow[] = ["4h", "1h", "15m"];

/* ---------------------------------------------------------- significance -- */

/**
 * Significance is the product of four independent readings, each 0–1:
 *
 *   magnitude × persistence × historicalDeviation × dataConfidence
 *
 * A product rather than a mean, deliberately. A mean lets three strong
 * readings carry one fatal weakness — a huge move, seen once, on data we do
 * not trust, would still score respectably. Multiplying means any single
 * reading near zero collapses the result, which is the correct behaviour:
 * intelligence requires all four to hold at once.
 */
export const SIGNIFICANCE = {
  /** Below this an event is not raised at all. */
  minimum: 0.18,

  /** Consecutive passes at which persistence saturates. */
  persistenceSaturation: 6,

  /**
   * Persistence credited to a single, unconfirmed observation.
   *
   * Without a floor the product form is self-defeating: a first sighting
   * would carry 1/6 of the persistence term, capping any new detection's
   * significance at 0.167 — below `minimum`. Nothing would ever be raised,
   * so nothing would ever accumulate observations, so nothing would ever be
   * raised. The engine would be permanently silent and merely look quiet.
   *
   * 0.5 says what is true of a first sighting: real, measured, and not yet
   * confirmed. A strong, well-supported condition can clear the bar on its
   * first pass; a marginal one has to hold for two or three before it does.
   */
  persistenceFloor: 0.5,

  /**
   * Deviation, in sigma of the metric's own history, at which the
   * `historicalDeviation` term saturates. Beyond three sigma the move is
   * already firmly unusual and further extremity adds no information.
   */
  deviationSaturation: 3,
} as const;

/* ------------------------------------------------------------- detectors -- */

/**
 * Per-detector thresholds.
 *
 * `minSigma` is how far the observation must sit from the asset's own
 * historical distribution before it counts. Expressed in sigma rather than
 * absolute units so a single constant is meaningful across every asset class.
 */
export const DETECTORS = {
  STRENGTH_ACCELERATION: {
    /** Score points gained over the window. */
    minChange: 4,
    minSigma: 1.2,
    /** Passes the condition must hold before an event is raised. */
    minObservations: 2,
  },
  STRENGTH_DETERIORATION: {
    minChange: 4,
    minSigma: 1.2,
    minObservations: 2,
  },
  MOMENTUM_SHIFT: {
    /** Momentum component points moved against its own baseline. */
    minChange: 12,
    minSigma: 1.5,
    minObservations: 2,
  },
  TREND_SHIFT: {
    /** Trend classification must actually change state. */
    minFitQuality: 0.25,
    minObservations: 2,
  },
  VOLUME_EXPANSION: {
    /** Multiple of the rolling median. */
    minRatio: 2.0,
    minObservations: 2,
  },
  VOLUME_CONTRACTION: {
    maxRatio: 0.5,
    minObservations: 2,
  },
  RANK_ACCELERATION: {
    /** Positions gained over the window. */
    minPositions: 5,
    minObservations: 2,
  },
  RANK_DETERIORATION: {
    minPositions: 5,
    minObservations: 2,
  },
  ANOMALY: {
    /**
     * Robust deviation, in MAD-scaled units. Higher than the other detectors
     * because an anomaly claims the behaviour is genuinely unusual rather
     * than merely directional.
     */
    minDeviation: 4,
    minObservations: 3,
  },
  REGIME_SHIFT: {
    /** A regime must hold this many passes before the change is claimed. */
    minObservations: 5,
  },
  CROSS_MARKET_ROTATION: {
    /** Percentage-point spread between universe median score changes. */
    minSpread: 6,
    /** Share of a universe that must move the same way. */
    minBreadth: 0.6,
    minObservations: 3,
    /** Members a universe needs before its aggregate means anything. */
    minUniverseSize: 5,
  },
} as const;

/* -------------------------------------------------------------- severity -- */

/**
 * Severity bands over significance.
 *
 * Deliberately not derived from the Strata Score: a weak asset deteriorating
 * sharply is a more severe event than a strong asset drifting, and tying
 * severity to score would invert that.
 */
export const SEVERITY_BANDS = {
  critical: 0.62,
  high: 0.45,
  medium: 0.3,
} as const;

/* ------------------------------------------------------------ confidence -- */

/**
 * Event confidence, which is not the asset's score confidence.
 *
 * An event is trustworthy when several independent components agree, the
 * history behind it is deep, and it has been seen more than once. An asset
 * can be very well measured and still produce a weak event, and a
 * thinly-measured asset can produce a clear one.
 */
export const EVENT_CONFIDENCE = {
  weights: {
    driverAgreement: 0.35,
    dataConfidence: 0.3,
    persistence: 0.2,
    historyDepth: 0.15,
  },
  /** Observations at which the depth term saturates. */
  healthyObservations: 120,
} as const;

/* ------------------------------------------------------------- lifecycle -- */

export const LIFECYCLE = {
  /**
   * Passes an event may go unobserved before it is expired.
   *
   * Distinct from resolution: a resolved event was measured to have ended, an
   * expired one simply stopped being re-detected. Conflating them would let a
   * pipeline outage look like a market change.
   */
  missedPassesBeforeExpiry: 3,

  /** Per-type lifetime, in seconds, after which an unrefreshed event expires. */
  ttlSeconds: {
    STRENGTH_ACCELERATION: 21_600,
    STRENGTH_DETERIORATION: 21_600,
    MOMENTUM_SHIFT: 10_800,
    TREND_SHIFT: 43_200,
    VOLUME_EXPANSION: 10_800,
    VOLUME_CONTRACTION: 10_800,
    RANK_ACCELERATION: 21_600,
    RANK_DETERIORATION: 21_600,
    ANOMALY: 10_800,
    REGIME_SHIFT: 86_400,
    CROSS_MARKET_ROTATION: 43_200,
  } as Record<IntelligenceEventType, number>,
} as const;

/* -------------------------------------------------------------- priority -- */

/**
 * Feed ordering. Significance says whether an event is worth raising;
 * priority says which of the raised events to read first. Kept separate from
 * the Strata Score, and from severity, so the feed can rank by "what should I
 * look at" without implying "what is strongest".
 */
export const PRIORITY = {
  weights: { significance: 0.5, confidence: 0.3, persistence: 0.2 },
} as const;
