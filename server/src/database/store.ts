import type {
  Asset,
  AssetIntelligence,
  AssetPrice,
  AssetType,
  ComputeEvent,
  MarketMetrics,
  NormalizedMarketData,
  Observation,
  StrataScore,
} from "../types/domain.ts";
import type { RankingSnapshot } from "../types/rankings.ts";
import type {
  IntelligenceEvent,
  IntelligenceEventFilter,
} from "../types/intelligence-events.ts";
import type { Signal, SignalType } from "../types/signals.ts";
import type { ArenaEntry, ArenaEvent, ArenaRound } from "../types/arena.ts";

/**
 * Persistence contract.
 *
 * Services depend on this interface, never on `pg`. Two implementations
 * exist: PostgresStore is the real one; MemoryStore lets the service boot and
 * serve when no database is configured, which keeps local development and
 * health-degraded operation honest rather than crashing.
 */

export interface AssetUpsert {
  symbol: string;
  name: string;
  assetType: AssetType;
  chain: string | null;
  contractAddress: string | null;
  logoUrl: string | null;
}

export interface AssetFilter {
  assetType?: AssetType;
  status?: Asset["status"];
  search?: string;
  limit?: number;
  offset?: number;
}

export interface SignalFilter {
  assetId?: string;
  assetType?: AssetType;
  signalType?: SignalType;
  since?: string;
  limit?: number;
}

export interface PersistedStats {
  /** Most recent observation retrieval, from stored snapshots. */
  lastIngestionAt: string | null;
  /** Most recent computation pass, from stored scores. */
  lastComputationAt: string | null;
  assetsTracked: number;
  marketSnapshots: number;
  scoresComputed: number;
  signalsGenerated: number;
  computeEvents: number;
}

/** One point of an asset's rank history. */
export interface RankSeriesPoint {
  assetId: string;
  timestamp: string;
  rank: number;
}

/**
 * One point of the computed history a detector compares against.
 *
 * Every field is nullable because every one of them can legitimately fail to
 * compute for an asset. A null is "not measurable", never zero.
 */
export interface DetectionSeriesPoint {
  assetId: string;
  timestamp: string;
  score: number | null;
  momentum: number | null;
  trend: number | null;
  volume: number | null;
}

export interface IntelligenceCounts {
  open: number;
  resolved: number;
  total: number;
}

export interface CalibrationSnapshot {
  scoreVersion: string;
  universe: string;
  sampleSize: number;
  method: string;
  compositeMean: number | null;
  compositeSigma: number | null;
  anchored: boolean;
  distribution: Record<string, unknown>;
  createdAt: string;
}

export interface LatestMarketRow {
  asset: Asset;
  price: AssetPrice | null;
  metrics: MarketMetrics | null;
  score: StrataScore | null;
  snapshot: NormalizedMarketData | null;
}

export interface StrataStore {
  readonly kind: "postgres" | "memory";

  /** True when the backing store is reachable. */
  isHealthy(): Promise<boolean>;

  // ---- assets ----------------------------------------------------------
  upsertAssets(assets: AssetUpsert[]): Promise<Asset[]>;
  listAssets(filter?: AssetFilter): Promise<Asset[]>;
  getAssetById(id: string): Promise<Asset | null>;
  getAssetBySymbol(symbol: string, assetType?: AssetType): Promise<Asset | null>;
  countAssets(filter?: AssetFilter): Promise<number>;

  // ---- market data -----------------------------------------------------
  insertPrices(prices: AssetPrice[]): Promise<void>;
  insertSnapshots(
    rows: { assetId: string; data: NormalizedMarketData }[],
  ): Promise<void>;
  insertMetrics(metrics: MarketMetrics[]): Promise<void>;
  insertScores(scores: StrataScore[]): Promise<void>;

  /**
   * An asset's stored observations, oldest first.
   *
   * This is the series every historical computation reads: volatility, trend,
   * baselines, anomaly detection. Returning it from the store rather than
   * recomputing it per engine means one query per asset per pass, and one
   * definition of what "this asset's history" means.
   */
  getObservationHistory(assetId: string, limit: number): Promise<Observation[]>;

  /**
   * Writes observations that came from a provider's own historical endpoint
   * rather than from live polling. Used to give a newly-covered asset real
   * depth immediately instead of waiting days to accumulate it.
   *
   * Implementations must merge on timestamp: a backfill must never duplicate
   * a point the poller already stored, or every baseline built from the
   * series would be silently double-weighted.
   */
  backfillObservations(assetId: string, points: Observation[]): Promise<number>;

  // ---- intelligence ----------------------------------------------------
  insertIntelligence(records: AssetIntelligence[]): Promise<void>;
  getLatestIntelligence(assetId: string): Promise<AssetIntelligence | null>;
  listLatestIntelligence(filter?: AssetFilter): Promise<AssetIntelligence[]>;
  getIntelligenceHistory(assetId: string, limit: number): Promise<AssetIntelligence[]>;
  /**
   * The narrow numeric series the detectors read, for every asset at once.
   *
   * Deliberately not `getIntelligenceHistory` in a loop. That returns the full
   * per-pass record — score, every engine reading, reasoning, sources — and
   * detection needs four numbers per point. Fetching whole payloads for every
   * asset moved tens of megabytes across the wire each pass to compute
   * against a few thousand floats.
   */
  getDetectionSeries(
    sinceMinutes: number,
    perAssetLimit: number,
  ): Promise<DetectionSeriesPoint[]>;

  /** The read model behind /api/markets and /api/rankings. */
  getLatestMarketRows(filter?: AssetFilter): Promise<LatestMarketRow[]>;
  getLatestMarketRow(assetId: string): Promise<LatestMarketRow | null>;
  getMetricsHistory(assetId: string, limit: number): Promise<MarketMetrics[]>;
  getScoreHistory(assetId: string, limit: number): Promise<StrataScore[]>;

  // ---- signals ---------------------------------------------------------
  insertSignals(signals: Signal[]): Promise<void>;
  listSignals(filter?: SignalFilter): Promise<Signal[]>;

  // ---- rankings --------------------------------------------------------
  saveRankingSnapshot(snapshot: RankingSnapshot): Promise<void>;
  getPreviousRanks(
    metric: string,
    assetType: AssetType | "all",
  ): Promise<Map<string, number>>;
  /**
   * One asset's rank over time, newest first.
   *
   * Rank movement is only intelligence when it is compared against how this
   * asset's rank normally behaves — a name that oscillates five places every
   * pass has not "accelerated" when it does so again. That needs the series,
   * not the previous value.
   */
  /**
   * Rank series for every asset in one ranking, newest first.
   *
   * The per-asset variant below is fine for a script; a detection pass over
   * dozens of assets would issue one round trip each, which is the difference
   * between a pass measured in seconds and one measured in minutes.
   */
  getRankSeries(
    metric: string,
    assetType: AssetType | "all",
    sinceMinutes: number,
  ): Promise<RankSeriesPoint[]>;
  getRankHistory(
    assetId: string,
    metric: string,
    assetType: AssetType | "all",
    limit: number,
  ): Promise<{ timestamp: string; rank: number }[]>;

  // ---- arena -----------------------------------------------------------
  createArenaRound(round: Omit<ArenaRound, "id" | "createdAt">): Promise<ArenaRound>;
  getArenaRound(roundNumber: number): Promise<ArenaRound | null>;
  getArenaRoundById(roundId: string): Promise<ArenaRound | null>;
  getCurrentArenaRound(): Promise<ArenaRound | null>;
  listArenaRounds(limit: number): Promise<ArenaRound[]>;
  upsertArenaEntries(entries: ArenaEntry[]): Promise<void>;
  listArenaEntries(roundId: string): Promise<ArenaEntry[]>;

  /**
   * Records a round's outcome. Settlement is permanent: a settled round is
   * never recomputed, because the whole point of an Arena history is that a
   * past result cannot change after the fact.
   */
  settleArenaRound(
    roundId: string,
    outcome: {
      settledAt: string;
      winnerAssetId: string | null;
      winnerSymbol: string | null;
      winnerScore: number | null;
      winnerHp: number | null;
    },
  ): Promise<ArenaRound | null>;

  insertArenaEvents(events: ArenaEvent[]): Promise<void>;
  listArenaEvents(roundId: string, limit: number): Promise<ArenaEvent[]>;

  // ---- compute events --------------------------------------------------
  /**
   * Operational counts, read from the database rather than from process
   * memory.
   *
   * The service previously tracked "last ingestion" in a module-level
   * variable, which meant it reset on every restart and — because it was only
   * written on the mock path — read as null in live mode forever. Anything an
   * operator uses to judge whether the pipeline is alive has to survive a
   * restart, or it is describing the process rather than the system.
   */
  getPersistedStats(): Promise<PersistedStats>;

  /**
   * Records how a universe was calibrated at a point in time.
   *
   * A percentile and an anchored composite are only meaningful relative to
   * the population they were computed against, so a stored score is
   * reproducible only if the shape of that population is kept beside it.
   * Without this, a past score could be recomputed but never checked.
   */
  insertCalibrations(snapshots: CalibrationSnapshot[]): Promise<void>;

  // ---- intelligence events ---------------------------------------------
  /**
   * Writes detections and lifecycle transitions in one call.
   *
   * Upsert semantics are load-bearing: at most one OPEN event may exist per
   * (asset, type), enforced by a partial unique index. A detector fires on
   * every pass while its condition holds, so without that the feed would fill
   * with identical entries and a reader would infer repeated occurrences of
   * something that happened once.
   */
  upsertIntelligenceEvents(events: IntelligenceEvent[]): Promise<void>;
  /** Applies RESOLVED / EXPIRED transitions to events already stored. */
  closeIntelligenceEvents(events: IntelligenceEvent[]): Promise<void>;
  listOpenIntelligenceEvents(): Promise<IntelligenceEvent[]>;
  listIntelligenceEvents(filter: IntelligenceEventFilter): Promise<IntelligenceEvent[]>;
  getIntelligenceEvent(id: string): Promise<IntelligenceEvent | null>;
  countIntelligenceEvents(): Promise<{ open: number; resolved: number; total: number }>;
  listCalibrations(limit: number): Promise<CalibrationSnapshot[]>;

  insertComputeEvents(events: ComputeEvent[]): Promise<void>;
  countComputeEventsSince(since: string): Promise<number>;
  listComputeEvents(limit: number, assetId?: string): Promise<ComputeEvent[]>;
}
