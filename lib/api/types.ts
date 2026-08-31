/**
 * Wire types for the Strata Compute API.
 *
 * These mirror `server/src/api/dto.ts`. They are intentionally separate from
 * the UI's own types in `lib/types.ts`: the API is a contract that can evolve,
 * and the mapping between the two lives in one place (`adapters.ts`) rather
 * than being spread across components.
 */

export type ApiAssetType = "stock" | "crypto" | "onchain";
export type ApiAssetStatus = "active" | "stale" | "delisted";

export interface ApiMeta {
  requestId?: string;
  timestamp: string;
  /** Whether the payload was read from Postgres or the in-memory read model. */
  source?: "database" | "memory";
  /** True when any figure in the payload came from the mock provider. */
  mock?: boolean;
  count?: number;
  total?: number;
  [key: string]: unknown;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
  meta: ApiMeta;
}

export interface ApiAsset {
  id: string;
  symbol: string;
  name: string;
  assetType: ApiAssetType;
  chain: string | null;
  contractAddress: string | null;
  /** Provider-published artwork, or null when none exists. Never synthesised. */
  logoUrl: string | null;
  status: ApiAssetStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Component readings on a market row. Every one is nullable, and a null means
 * the component could not be computed for that asset — never that it computed
 * to zero.
 */
export interface ApiMarketMetrics {
  momentum: number | null;
  volumeStrength: number | null;
  activity: number | null;
  liquidityStrength: number | null;
  relativeStrength: number | null;
  trend: number | null;
  volatility: number | null;
}

export interface ApiMarket {
  asset: ApiAsset;
  price: number | null;
  priceChange1h: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
  marketCap: number | null;
  liquidity: number | null;
  metrics: ApiMarketMetrics | null;
  score: number | null;
  scoreStatus: ApiComputationStatus | null;
  scoreConfidence: number | null;
  scoreVersion: string | null;
  /** Providers whose data produced the score. Empty when unscored. */
  scoreSources: string[];
  source: string | null;
  isMock: boolean;
  updatedAt: string | null;
  /** When Strata retrieved the observation. */
  retrievedAt: string | null;
  /** The provider's own timestamp, verbatim. */
  sourceTimestamp: string | null;
  /** Freshness of this row as assessed by the backend. */
  status: "live" | "delayed" | "stale" | "unavailable" | "error";
  ageSeconds: number | null;
}

export interface ApiRankingEntry {
  rank: number;
  assetId: string;
  symbol: string;
  name: string;
  assetType: ApiAssetType;
  value: number;
  score: number;
  change: number | null;
  /** Confidence in the inputs behind this entry's score, 0-1. */
  confidence: number;
  logoUrl: string | null;
  timestamp: string;
}

export interface ApiRankingSnapshot {
  metric: "score" | "momentum" | "volume" | "activity";
  assetType: ApiAssetType | "all";
  entries: ApiRankingEntry[];
  timestamp: string;
}

export type ApiSignalType =
  | "MOMENTUM_SPIKE"
  | "VOLUME_ACCELERATION"
  | "UNUSUAL_ACTIVITY"
  | "LIQUIDITY_SHIFT"
  | "PRICE_BREAKOUT"
  | "RANK_CHANGE";

export interface ApiSignal {
  id?: string;
  assetId: string;
  symbol: string;
  signalType: ApiSignalType;
  severity: "info" | "low" | "medium" | "high";
  value: number;
  /** When this observation stops being current. */
  expiresAt: string;
  metadata: Record<string, unknown>;
  /** Identity resolved from the asset record at serialization time. */
  name: string | null;
  assetType: ApiAssetType | null;
  logoUrl: string | null;
  timestamp: string;
}

export interface ApiArenaRound {
  id: string;
  roundNumber: number;
  status: "pending" | "active" | "settled";
  startsAt: string;
  endsAt: string;
  createdAt: string;
}

/**
 * An Arena standing. Superseded by `ApiArenaEntryFull`, which the backend now
 * returns everywhere; this alias keeps existing call sites honest rather than
 * leaving a second, stale definition of the same row in the codebase.
 */
export type ApiArenaEntry = ApiArenaEntryFull;

export interface ApiArenaView {
  round: ApiArenaRound | null;
  entries: ApiArenaEntry[];
  history?: ApiArenaRound[];
}

export interface ApiComputeStatus {
  status: "idle" | "running" | "degraded" | "error";
  computationVersion: string;
  lastRun: string | null;
  processingTimeMs: number | null;
  assetsProcessed: number;
  eventsProcessed: number;
  eventsLast24h: number;
  failures: number;
  provider: string;
  usingMockData: boolean;
  weights: Record<string, number>;
}

export interface ApiHealth {
  status: "healthy" | "degraded" | "unhealthy";
  uptimeSeconds: number;
  version: string;
  environment: string;
  store: "postgres" | "memory";
  mode?: "live" | "mock";
  database: {
    status?: string;
    configured: boolean;
    connected: boolean;
    detail?: string;
  };
  /** Keyed by provider name, as returned by /api/health. */
  providers: Record<
    string,
    { status: "healthy" | "unhealthy"; detail?: string; latencyMs?: number | null }
  >;
  providerDetail?: { provider: string; healthy: boolean; detail?: string }[];
  failingProviders?: string[];
  jobs: { enabled: boolean; running: boolean };
  lastIngestionAt: string | null;
}

/* ==================================================================== */
/*  PHASE 5 — THE INTELLIGENCE CONTRACT                                 */
/*                                                                      */
/*  Every computed value here is nullable, and the null is meaningful:  */
/*  it records that the engine could not compute the value from the     */
/*  data available. The interface must render it as absent, never as    */
/*  zero and never as a neutral midpoint.                               */
/* ==================================================================== */

export type ApiComputationStatus = "OK" | "INSUFFICIENT_DATA";
export type ApiConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

export type ApiScoreComponent =
  | "momentum"
  | "volume"
  | "activity"
  | "liquidity"
  | "relativeStrength"
  | "trend"
  | "volatility";

export interface ApiScoreConfidence {
  value: number;
  band: ApiConfidenceBand;
  completeness: number;
  freshness: number;
  historicalDepth: number;
  componentsAvailable: number;
  componentsTotal: number;
}

export interface ApiScoreDriver {
  component: ApiScoreComponent;
  direction: "positive" | "negative";
  /** Points this component added to or removed from the composite. */
  contribution: number;
  /** The measured fact behind it. Assembled from computed values. */
  detail: string;
}

export interface ApiComputeScore {
  assetId: string;
  symbol: string;
  status: ApiComputationStatus;
  score: number | null;
  /** The compute engine that produced the components. */
  version: string;
  /** The method that turned those components into a score. */
  scoreVersion?: string;
  /** The comparison universe the score is relative to. */
  scoreUniverse?: string;
  universeLabel?: string;
  /** True when the asset's own class was too small and "all" was used. */
  universeFellBack?: boolean;
  /** Semantic band, e.g. "Strong". Never implies a forecast. */
  bucket?: string | null;
  /** The composite before anchoring, so the step stays inspectable. */
  composite?: number | null;
  anchored?: boolean;
  confidence: ApiScoreConfidence;
  components: Partial<Record<ApiScoreComponent, number>>;
  missing: { component: ApiScoreComponent; reason: string }[];
  insufficientReason: string | null;
  calculatedAt: string;
}

export interface ApiEngineOutputs {
  momentum: {
    score: number | null;
    direction: "rising" | "falling" | "flat" | null;
    change: number | null;
    timeframes: string[];
    unavailableReason: string | null;
  };
  volume: {
    score: number | null;
    regime: "NORMAL" | "ELEVATED" | "HIGH" | "EXTREME" | null;
    relativeVolume: number | null;
    acceleration: number | null;
    unavailableReason: string | null;
  };
  activity: {
    score: number | null;
    basis: "onchain" | "market" | null;
    unavailableReason: string | null;
  };
  liquidity: {
    score: number | null;
    state: "expanding" | "stable" | "contracting" | null;
    changePct: number | null;
    unavailableReason: string | null;
  };
  volatility: {
    score: number | null;
    shortTermPct: number | null;
    mediumTermPct: number | null;
    expansion: number | null;
    unavailableReason: string | null;
  };
  relativeStrength: {
    score: number | null;
    excessReturnPct: number | null;
    benchmarkId: string | null;
    benchmarkLabel: string | null;
    unavailableReason: string | null;
  };
  trend: {
    score: number | null;
    state:
      | "STRONG_UPTREND"
      | "UPTREND"
      | "NEUTRAL"
      | "DOWNTREND"
      | "STRONG_DOWNTREND"
      | null;
    slopePctPerDay: number | null;
    fitQuality: number | null;
    unavailableReason: string | null;
  };
}

export interface ApiComputeMetrics {
  assetId: string;
  symbol: string;
  engines: ApiEngineOutputs;
  historyPoints: number;
  ageSeconds: number | null;
  computationVersion: string;
}

export interface ApiComputeExplanation {
  assetId: string;
  symbol: string;
  status: ApiComputationStatus;
  score: number | null;
  confidence: ApiScoreConfidence;
  drivers: ApiScoreDriver[];
  missing: { component: ApiScoreComponent; reason: string }[];
  insufficientReason: string | null;
  observations: {
    type: string;
    severity: string;
    value: number;
    detail: string | null;
    detectedAt: string;
  }[];
  calculatedAt: string;
}

export interface ApiComputeHistory {
  assetId: string;
  symbol: string | null;
  points: {
    timestamp: string;
    score: number | null;
    status: ApiComputationStatus;
    confidence: number;
    momentum: number | null;
    version: string;
  }[];
  /** Change between the oldest and newest stored score. */
  change: number | null;
  spanSeconds: number;
}

export interface ApiBreadthCounts {
  advancing: number;
  declining: number;
  unchanged: number;
  total: number;
  advanceDeclineRatio: number | null;
}

export interface ApiMarketBreadth {
  overall: ApiBreadthCounts;
  byClass: Record<ApiAssetType, ApiBreadthCounts>;
  medianAbsMovePct: number | null;
  calculatedAt: string;
}

export interface ApiMarketRegime {
  state: "RISK_ON" | "RISK_OFF" | "NEUTRAL" | "HIGH_VOLATILITY";
  confidence: number | null;
  /** Measured facts behind the state. Never generated prose. */
  drivers: string[];
  breadth: ApiMarketBreadth | null;
  calculatedAt: string;
}

export interface ApiEarlyMover {
  assetId: string;
  symbol: string;
  assetType: ApiAssetType;
  stage: "EARLY" | "WATCH" | "CONFIRMED";
  score: number;
  volumeAcceleration: number | null;
  activityAcceleration: number | null;
  priceAcceleration: number | null;
  rationale: string[];
  detectedAt: string;
}

export interface ApiComputeEvent {
  id: string | null;
  assetId: string | null;
  symbol: string | null;
  eventType: string;
  previousValue: number | string | null;
  newValue: number | string | null;
  change: number | null;
  metadata: Record<string, unknown>;
  computationVersion: string;
  timestamp: string;
}

export interface ApiComputeVersionInfo {
  version: string;
  description: string;
  /** The published weights that produced scores under this version. */
  weights: Record<string, number>;
  minimumCoverage: number;
  requiredComponents: string[];
  isCurrent: boolean;
}

/* ==================================================================== */
/*  PHASE 6 — ARENA                                                     */
/* ==================================================================== */

export interface ApiArenaRoundFull {
  id: string;
  season: number;
  roundNumber: number;
  status: "pending" | "active" | "settled";
  startsAt: string;
  endsAt: string;
  settledAt: string | null;
  winnerAssetId: string | null;
  winnerSymbol: string | null;
  winnerScore: number | null;
  winnerHp: number | null;
  arenaVersion: string;
  createdAt: string;
}

export interface ApiArenaEntryFull {
  id?: string;
  roundId: string;
  assetId: string;
  symbol: string;
  startingScore: number;
  currentScore: number;
  startingHp: number;
  currentHp: number;
  /** 0–100 computed strength. Null when coverage was too thin to judge. */
  power: number | null;
  rank: number;
  startingRank: number;
  status: "active" | "at_risk" | "eliminated" | "winner";
  eliminatedAt: string | null;
  joinedAt: string;
  updatedAt: string;
  /** Joined at serialization time. */
  name: string | null;
  assetType: ApiAssetType | null;
  logoUrl: string | null;
}

export interface ApiArenaConfig {
  version: string;
  fieldSize: number;
  startingHp: number;
  maximumHp: number;
  atRiskHp: number;
  eliminationHp: number;
}

export interface ApiArenaCurrent {
  round: ApiArenaRoundFull;
  entries: ApiArenaEntryFull[];
  config: ApiArenaConfig;
}

export interface ApiArenaEvent {
  id?: string;
  roundId: string;
  assetId: string | null;
  symbol: string | null;
  eventType: string;
  previousValue: number | null;
  newValue: number | null;
  change: number | null;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/* ------------------------------------------------------- intelligence --- */

export const API_INTELLIGENCE_EVENT_TYPES = [
  "STRENGTH_ACCELERATION",
  "STRENGTH_DETERIORATION",
  "MOMENTUM_SHIFT",
  "TREND_SHIFT",
  "VOLUME_EXPANSION",
  "VOLUME_CONTRACTION",
  "RANK_ACCELERATION",
  "RANK_DETERIORATION",
  "ANOMALY",
  "REGIME_SHIFT",
  "CROSS_MARKET_ROTATION",
] as const;

export type ApiIntelligenceEventType = (typeof API_INTELLIGENCE_EVENT_TYPES)[number];
export type ApiIntelligenceStatus = "detected" | "active" | "resolved" | "expired";
export type ApiIntelligenceSeverity = "low" | "medium" | "high" | "critical";

/**
 * One measured piece of evidence behind an event. `observed` and `baseline`
 * are the actual numbers the detector compared, so the interface can state a
 * reason without composing one of its own.
 */
export interface ApiEventDriver {
  metric: string;
  direction: "up" | "down" | "flat";
  magnitude: number;
  evidence: string;
  observed: number | null;
  baseline: number | null;
}

/** Why the event was raised, kept decomposed rather than collapsed to one number. */
export interface ApiEventSignificance {
  magnitude: number;
  persistence: number;
  historicalDeviation: number;
  dataConfidence: number;
  value: number;
}

/**
 * A condition that persists, not a moment that passed.
 *
 * `detectedAt` is when it started and `latestAt` is the most recent pass that
 * still saw it, so an event describes a span. `observations` counts the
 * consecutive passes it has held — one event that has been seen fifteen times,
 * never fifteen events.
 */
export interface ApiIntelligenceEvent {
  id?: string;
  assetId: string | null;
  symbol: string | null;
  assetType: ApiAssetType | null;
  eventType: ApiIntelligenceEventType;
  status: ApiIntelligenceStatus;
  severity: ApiIntelligenceSeverity;
  significance: ApiEventSignificance;
  /** Confidence in the event itself, which is not the asset's score confidence. */
  confidence: number;
  /** −1 to 1. Below zero means the components disagree, and that is shown. */
  driverAgreement: number;
  magnitude: number;
  observations: number;
  drivers: ApiEventDriver[];
  context: Record<string, unknown>;
  firstValue: number | null;
  latestValue: number | null;
  priority: number;
  detectedAt: string;
  latestAt: string;
  resolvedAt: string | null;
  expiresAt: string;
  computationVersion: string;
  scoreVersion: string;
}

export interface ApiAssetIntelligence {
  symbol: string;
  active: ApiIntelligenceEvent[];
  recent: ApiIntelligenceEvent[];
}

export interface ApiMarketIntelligence {
  breadth: ApiMarketBreadth | null;
  regime: {
    state: string;
    confidence: number;
    drivers: string[];
    calculatedAt: string;
  } | null;
  strongestAccelerations: ApiIntelligenceEvent[];
  largestDeteriorations: ApiIntelligenceEvent[];
  volumeAnomalies: ApiIntelligenceEvent[];
  rankMovers: ApiIntelligenceEvent[];
  regimeShifts: ApiIntelligenceEvent[];
  rotation: ApiIntelligenceEvent[];
  openEventCount: number;
}
