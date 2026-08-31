import type { ScoreComponent } from "../config/scoring.ts";
import type { AssetType } from "./domain.ts";
import type { IsoTimestamp } from "../utils/time.ts";

/**
 * THE INTELLIGENCE CONTRACT
 *
 * One rule shapes every type in this file: a value that could not be computed
 * is `null`, and the reason is recorded next to it. There is no neutral
 * default, no zero standing in for "unknown", and no optional field that
 * quietly disappears.
 *
 * That is what makes the output auditable. A reader can always tell the
 * difference between "this asset scored 50" and "this asset could not be
 * scored", and so can the code downstream.
 */

/* -------------------------------------------------------------- features -- */

/**
 * A single engineered feature.
 *
 * The value carries its own provenance: which inputs produced it, how much
 * history stood behind it, and — when it could not be produced — why.
 */
export interface Feature {
  value: number | null;
  /** Present only when value is null. Human-readable, specific. */
  unavailableReason: string | null;
  /** Observations the feature was derived from. */
  sampleSize: number;
}

export function feature(value: number, sampleSize: number): Feature {
  return { value, unavailableReason: null, sampleSize };
}

export function unavailable(reason: string, sampleSize = 0): Feature {
  return { value: null, unavailableReason: reason, sampleSize };
}

/**
 * The full engineered feature set for one asset at one instant.
 *
 * These are raw measurements in their natural units — percent, ratio,
 * multiple — not 0–100 scores. Normalisation happens later, in the engines,
 * so the raw numbers stay inspectable.
 */
export interface FeatureSet {
  priceChange1h: Feature;
  priceChange24h: Feature;
  priceChange7d: Feature;
  /** Current 24h volume against the asset's own historical mean. */
  volumeChange: Feature;
  volumeStrength: Feature;
  momentum: Feature;
  /** Annualised standard deviation of returns, as a percentage. */
  volatility: Feature;
  liquidityStrength: Feature;
  activityStrength: Feature;
  relativeStrength: Feature;
  trendStrength: Feature;
  /** Second derivative of price: is the rate of change itself increasing? */
  acceleration: Feature;
}

export type FeatureName = keyof FeatureSet;

/* -------------------------------------------------------------- engines --- */

export type MomentumDirection = "rising" | "falling" | "flat";

export interface MomentumResult {
  /** 0–100, cross-class comparable. Null when no timeframe was available. */
  score: number | null;
  direction: MomentumDirection | null;
  /** Change in momentum score against the previous computation. */
  change: number | null;
  /** Timeframes that actually contributed. */
  timeframes: string[];
  unavailableReason: string | null;
}

export type VolumeRegime = "NORMAL" | "ELEVATED" | "HIGH" | "EXTREME";

export interface VolumeResult {
  score: number | null;
  regime: VolumeRegime | null;
  /** Current volume as a multiple of the asset's own baseline. */
  relativeVolume: number | null;
  acceleration: number | null;
  unavailableReason: string | null;
}

export interface ActivityResult {
  score: number | null;
  /** Which measurement stood in for activity, since it differs by class. */
  basis: "onchain" | "market" | null;
  unavailableReason: string | null;
}

export type LiquidityState = "expanding" | "stable" | "contracting";

export interface LiquidityResult {
  score: number | null;
  state: LiquidityState | null;
  changePct: number | null;
  unavailableReason: string | null;
}

export interface VolatilityResult {
  /** 0–100 where high means calm; feeds the score as a quality term. */
  score: number | null;
  shortTermPct: number | null;
  mediumTermPct: number | null;
  /** Short-term volatility over medium-term: >1 means expanding. */
  expansion: number | null;
  unavailableReason: string | null;
}

export interface RelativeStrengthResult {
  score: number | null;
  /** Asset return minus benchmark return, in percentage points. */
  excessReturnPct: number | null;
  benchmarkId: string | null;
  benchmarkLabel: string | null;
  unavailableReason: string | null;
}

export type TrendState =
  | "STRONG_UPTREND"
  | "UPTREND"
  | "NEUTRAL"
  | "DOWNTREND"
  | "STRONG_DOWNTREND";

export interface TrendResult {
  score: number | null;
  state: TrendState | null;
  /** Slope of the fitted line, in percent per day. */
  slopePctPerDay: number | null;
  /** R² of the fit: how much of the move the trend actually explains. */
  fitQuality: number | null;
  unavailableReason: string | null;
}

/** Everything the engines produced for one asset, before scoring. */
export interface EngineOutputs {
  momentum: MomentumResult;
  volume: VolumeResult;
  activity: ActivityResult;
  liquidity: LiquidityResult;
  volatility: VolatilityResult;
  relativeStrength: RelativeStrengthResult;
  trend: TrendResult;
}

/* ---------------------------------------------------------------- score --- */

export type ComputationStatus = "OK" | "INSUFFICIENT_DATA";

export type ConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

/**
 * Why a score is what it is, in the words of the numbers themselves.
 *
 * Each driver names a component, states the measured value that produced it,
 * and reports the points it added to or removed from the composite. Nothing
 * here is written by a language model; every string is assembled from a
 * computed quantity.
 */
export interface ScoreDriver {
  component: ScoreComponent;
  direction: "positive" | "negative";
  /** Points this component contributed relative to a neutral 50. */
  contribution: number;
  /** The measured fact, e.g. "volume 2.8x its 7-day baseline". */
  detail: string;
}

export interface ScoreConfidence {
  /** 0–1 composite of the factors below. */
  value: number;
  band: ConfidenceBand;
  /** Share of scoring weight backed by real inputs. */
  completeness: number;
  /** 1 at the moment of observation, decaying with age. */
  freshness: number;
  /** How much history stood behind the historical components. */
  historicalDepth: number;
  /** Components that produced a value, out of the total possible. */
  componentsAvailable: number;
  componentsTotal: number;
}

export interface StrataScoreResult {
  status: ComputationStatus;
  /** Null whenever status is INSUFFICIENT_DATA. Never a placeholder number. */
  score: number | null;
  version: string;
  /** Per-component 0–100 values. A component absent from the map was not computed. */
  components: Partial<Record<ScoreComponent, number>>;
  /** Components that could not be computed, with the reason for each. */
  missing: { component: ScoreComponent; reason: string }[];
  confidence: ScoreConfidence;
  /** Ordered strongest-first. Empty only when nothing moved the score. */
  drivers: ScoreDriver[];
  /** Present when status is INSUFFICIENT_DATA. */
  insufficientReason: string | null;
  calculatedAt: IsoTimestamp;
}

/* -------------------------------------------------------- early movers --- */

export type EarlyMoverStage = "EARLY" | "WATCH" | "CONFIRMED";

export interface EarlyMover {
  assetId: string;
  symbol: string;
  assetType: AssetType;
  stage: EarlyMoverStage;
  /** 0–100 composite of the three accelerations. */
  score: number;
  volumeAcceleration: number | null;
  activityAcceleration: number | null;
  priceAcceleration: number | null;
  /** What has actually been observed, stated without forecast. */
  rationale: string[];
  detectedAt: IsoTimestamp;
}

/* ------------------------------------------------------------ anomalies -- */

export type AnomalyKind = "volume" | "activity" | "price" | "liquidity";

export interface Anomaly {
  assetId: string;
  symbol: string;
  kind: AnomalyKind;
  /** Deviation from the asset's own baseline, in multiples or sigma. */
  magnitude: number;
  baseline: number;
  observed: number;
  /** Observations the baseline was built from. */
  baselineSamples: number;
  detail: string;
  detectedAt: IsoTimestamp;
}

/* --------------------------------------------------------------- market -- */

export interface BreadthCounts {
  advancing: number;
  declining: number;
  unchanged: number;
  total: number;
  /** advancing / (advancing + declining). Null when nothing moved. */
  advanceDeclineRatio: number | null;
}

export interface MarketBreadth {
  overall: BreadthCounts;
  byClass: Record<AssetType, BreadthCounts>;
  /** Median absolute 24h move across the covered set, in percent. */
  medianAbsMovePct: number | null;
  calculatedAt: IsoTimestamp;
}

export type MarketRegimeState =
  | "RISK_ON"
  | "RISK_OFF"
  | "NEUTRAL"
  | "HIGH_VOLATILITY";

export interface MarketRegime {
  status: ComputationStatus;
  state: MarketRegimeState | null;
  confidence: number | null;
  /** Measured facts that produced the state. Never generated prose. */
  drivers: string[];
  breadth: MarketBreadth | null;
  insufficientReason: string | null;
  calculatedAt: IsoTimestamp;
}

/* --------------------------------------------------------------- events -- */

export type ComputeEventType =
  | "STRATA_SCORE_CHANGED"
  | "MOMENTUM_CHANGED"
  | "RANK_CHANGED"
  | "SIGNAL_DETECTED"
  | "ANOMALY_DETECTED"
  | "MARKET_REGIME_CHANGED";

export interface IntelligenceEvent {
  id?: string;
  assetId: string | null;
  symbol: string | null;
  eventType: ComputeEventType;
  previousValue: number | string | null;
  newValue: number | string | null;
  change: number | null;
  metadata: Record<string, unknown>;
  computationVersion: string;
  timestamp: IsoTimestamp;
}
