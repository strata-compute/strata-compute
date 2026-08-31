/**
 * STRATA COMPUTE — the shapes components render.
 *
 * Populated exclusively by `lib/data/*`, which reads the Strata API. There is
 * no fixture module behind these types: a value here came from a provider,
 * through normalization, or it is null.
 */

export type AssetClass = "stock" | "crypto" | "onchain";

export type ComputeStatus =
  | "live"
  | "computing"
  | "elevated"
  | "cooling"
  | "stale";

/**
 * The components that compose a Strata Score, each 0–100.
 *
 * Every one is nullable. A null records that the engine could not compute the
 * component from the data available — never that it computed to zero.
 */
export interface ScoreBreakdown {
  momentum: number | null;
  volume: number | null;
  activity: number | null;
  liquidity: number | null;
  relativeStrength: number | null;
  trend: number | null;
  volatility: number | null;
}

export interface ScoreFactorMeta {
  key: keyof ScoreBreakdown;
  label: string;
  weight: number;
  description: string;
}

export interface Asset {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  /**
   * Artwork published by the upstream that supplied this asset, or null.
   * Resolution lives in `lib/asset-logo.ts`; components never build one.
   */
  logoUrl: string | null;
  /** Quote currency price. */
  price: number;
  /** Percent change over 24h, e.g. -1.24 */
  change24h: number;
  /** Absolute change over 24h in quote currency. */
  changeAbs24h: number;
  /** Notional traded over 24h. */
  volume24h: number;
  marketCap: number;
  /** Composite Strata Score, 0–100. Null when it could not be computed. */
  score: number | null;
  /** OK, or INSUFFICIENT_DATA when the inputs could not support a score. */
  scoreStatus: "OK" | "INSUFFICIENT_DATA" | null;
  /** Confidence in the inputs, 0–1. Never folded into the score. */
  scoreConfidence: number | null;
  /** Score movement over 24h in points. */
  scoreDelta24h: number;
  breakdown: ScoreBreakdown;
  status: ComputeStatus;
  /** Normalised 0–100 momentum reading. Null when not computed. */
  momentum: number | null;
  venue: string;
  sector: string;
  tags: string[];
}

export type SignalKind =
  | "momentum-spike"
  | "volume-acceleration"
  | "unusual-activity"
  | "liquidity-drop"
  | "new-market";

export type SignalTone = "positive" | "caution" | "negative" | "info";

export interface Signal {
  id: string;
  symbol: string;
  name: string;
  /** Null when the joined asset record carries no classification. */
  assetClass: AssetClass | null;
  logoUrl: string | null;
  kind: SignalKind;
  /** Standard deviations from the rolling baseline. */
  magnitude: number;
  /** Minutes before the session anchor — keeps rendering deterministic. */
  minutesAgo: number;
  summary: string;
  detail: string;
  scoreImpact: number;
}

export type ArenaState = "advancing" | "holding" | "at-risk" | "eliminated";

export interface ArenaEntrant {
  symbol: string;
  name: string;
  /** Null when the joined asset record carries no classification. */
  assetClass: AssetClass | null;
  logoUrl: string | null;
  rank: number;
  previousRank: number;
  score: number;
  /** Points gained or lost this round. Null until round settlement exists. */
  roundDelta: number | null;
  /** Null when the backend has not computed or reported the figure. */
  momentum: number | null;
  volume24h: number | null;
  state: ArenaState;
  /** 0–100 share of the round's compute budget won. Null when not computed. */
  control: number | null;
}

export type ArenaEventKind = "overtake" | "gain" | "entry" | "elimination" | "streak";

export interface ArenaEvent {
  id: string;
  kind: ArenaEventKind;
  headline: string;
  detail: string;
  symbol: string;
  counterparty?: string;
  value?: number;
  secondsAgo: number;
}

export interface ArenaRound {
  index: number;
  label: string;
  /** Seconds left in the round at the session anchor. */
  secondsRemaining: number;
  durationSeconds: number;
  entrants: number;
  eliminated: number;
  computeEvents: number;
}

export interface MarketMetric {
  id: string;
  label: string;
  value: number;
  /** Formatting hint for the metric card. */
  format: "compact-usd" | "compact" | "integer" | "percent";
  delta: number;
  deltaLabel: string;
  series: number[];
  footnote: string;
}

export interface PipelineStage {
  id: string;
  label: string;
  kind: "source" | "process" | "output";
  /**
   * Optional because most stages have no measured figure to show. They were
   * previously filled with invented ones, which is worse than an empty slot:
   * a number on a diagram reads as a measurement.
   */
  throughput?: string;
  latency?: string;
  description: string;
  detail: string[];
}
