import type pg from "pg";
import type {
  Asset,
  AssetIntelligence,
  Observation,
  AssetPrice,
  AssetType,
  ComputeEvent,
  MarketMetrics,
  NormalizedMarketData,
  StrataScore,
} from "../types/domain.ts";
import type { ArenaEntry, ArenaEvent, ArenaRound } from "../types/arena.ts";
import type { RankingSnapshot } from "../types/rankings.ts";
import type {
  IntelligenceEvent,
  IntelligenceEventFilter,
} from "../types/intelligence-events.ts";
import type { DetectionSeriesPoint, RankSeriesPoint } from "./store.ts";
import type { Signal, SignalSeverity, SignalType } from "../types/signals.ts";
import { toNumber } from "../utils/number.ts";
import type {
  AssetFilter,
  AssetUpsert,
  LatestMarketRow,
  SignalFilter,
  StrataStore,
  PersistedStats,
  CalibrationSnapshot,
} from "./store.ts";

/**
 * Postgres implementation, written as plain parameterised SQL.
 *
 * No ORM: the schema is small and explicit, the queries are the interesting
 * part, and hand-written SQL keeps the index strategy visible at the call
 * site. `numeric` columns come back as strings from pg, so every numeric read
 * goes through `num()`.
 */

/**
 * Numeric columns that are genuinely optional.
 *
 * `num` coerces a missing value to a number, which is right for columns the
 * schema guarantees. It is wrong for the component readings, where NULL is a
 * deliberate record that the component could not be computed — coercing it
 * would erase exactly the distinction the column exists to preserve.
 */
function nullableNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function num(value: unknown): number {
  return toNumber(value) ?? 0;
}

function numOrNull(value: unknown): number | null {
  return toNumber(value);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

interface AssetRow {
  id: string;
  symbol: string;
  name: string;
  asset_type: AssetType;
  chain: string | null;
  contract_address: string | null;
  logo_url: string | null;
  status: Asset["status"];
  created_at: Date;
  updated_at: Date;
}

interface ObservationRow {
  timestamp: Date;
  price: string;
  volume_24h: string | null;
  liquidity: string | null;
  trade_count_24h: string | null;
  unique_participants_24h: string | null;
}

interface IntelligenceRow {
  asset_id: string;
  computation_version: string;
  status: string;
  score: string | null;
  confidence: string;
  history_points: number;
  age_seconds: number | null;
  payload: unknown;
  sources: unknown;
  timestamp: Date;
}

interface ComputeEventRow {
  id: string;
  asset_id: string | null;
  event_type: string;
  input_data: unknown;
  output_data: unknown;
  computation_version: string;
  created_at: Date;
}

function mapAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    assetType: row.asset_type,
    chain: row.chain,
    contractAddress: row.contract_address,
    logoUrl: row.logo_url,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export class PostgresStore implements StrataStore {
  readonly kind = "postgres" as const;

  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  // ---- assets ------------------------------------------------------------

  async upsertAssets(input: AssetUpsert[]): Promise<Asset[]> {
    if (input.length === 0) return [];

    // one round trip: unnest the batch and let the unique index resolve conflicts
    const { rows } = await this.pool.query<AssetRow>(
      `INSERT INTO assets (symbol, name, asset_type, chain, contract_address, logo_url)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
       ON CONFLICT (symbol, asset_type) DO UPDATE
         SET name = EXCLUDED.name,
             chain = EXCLUDED.chain,
             contract_address = EXCLUDED.contract_address,
             -- keep the last known logo when this pass omitted one
             logo_url = COALESCE(EXCLUDED.logo_url, assets.logo_url),
             updated_at = now()
       RETURNING *`,
      [
        input.map((a) => a.symbol.toUpperCase()),
        input.map((a) => a.name),
        input.map((a) => a.assetType),
        input.map((a) => a.chain),
        input.map((a) => a.contractAddress),
        input.map((a) => a.logoUrl),
      ],
    );
    return rows.map(mapAsset);
  }

  private assetWhere(filter: AssetFilter | undefined, params: unknown[]): string {
    const clauses: string[] = [];
    if (filter?.assetType) {
      params.push(filter.assetType);
      clauses.push(`asset_type = $${params.length}`);
    }
    if (filter?.status) {
      params.push(filter.status);
      clauses.push(`status = $${params.length}`);
    }
    if (filter?.search) {
      params.push(`%${filter.search.toLowerCase()}%`);
      clauses.push(`(lower(symbol) LIKE $${params.length} OR lower(name) LIKE $${params.length})`);
    }
    return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  }

  async listAssets(filter?: AssetFilter): Promise<Asset[]> {
    const params: unknown[] = [];
    const where = this.assetWhere(filter, params);
    params.push(filter?.limit ?? 500);
    params.push(filter?.offset ?? 0);

    const { rows } = await this.pool.query<AssetRow>(
      `SELECT * FROM assets ${where}
       ORDER BY symbol ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows.map(mapAsset);
  }

  async countAssets(filter?: AssetFilter): Promise<number> {
    const params: unknown[] = [];
    const where = this.assetWhere(filter, params);
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM assets ${where}`,
      params,
    );
    return Number(rows[0]?.count ?? 0);
  }

  async getAssetById(id: string): Promise<Asset | null> {
    const { rows } = await this.pool.query<AssetRow>(`SELECT * FROM assets WHERE id = $1`, [id]);
    return rows[0] ? mapAsset(rows[0]) : null;
  }

  async getAssetBySymbol(symbol: string, assetType?: AssetType): Promise<Asset | null> {
    const { rows } = assetType
      ? await this.pool.query<AssetRow>(
          `SELECT * FROM assets WHERE symbol = $1 AND asset_type = $2`,
          [symbol.toUpperCase(), assetType],
        )
      : await this.pool.query<AssetRow>(
          `SELECT * FROM assets WHERE symbol = $1 ORDER BY created_at ASC LIMIT 1`,
          [symbol.toUpperCase()],
        );
    return rows[0] ? mapAsset(rows[0]) : null;
  }

  // ---- writes ------------------------------------------------------------

  async insertPrices(prices: AssetPrice[]): Promise<void> {
    if (prices.length === 0) return;
    await this.pool.query(
      `INSERT INTO asset_prices
         (asset_id, price, price_change_1h, price_change_24h, volume_24h, market_cap, timestamp)
       SELECT * FROM UNNEST(
         $1::uuid[], $2::numeric[], $3::numeric[], $4::numeric[],
         $5::numeric[], $6::numeric[], $7::timestamptz[])`,
      [
        prices.map((p) => p.assetId),
        prices.map((p) => p.price),
        prices.map((p) => p.priceChange1h),
        prices.map((p) => p.priceChange24h),
        prices.map((p) => p.volume24h),
        prices.map((p) => p.marketCap),
        prices.map((p) => p.timestamp),
      ],
    );
  }

  async insertSnapshots(rows: { assetId: string; data: NormalizedMarketData }[]): Promise<void> {
    if (rows.length === 0) return;
    await this.pool.query(
      `INSERT INTO market_snapshots
         (asset_id, source, is_mock, payload, timestamp, retrieved_at, source_timestamp)
       SELECT * FROM UNNEST(
         $1::uuid[], $2::text[], $3::boolean[], $4::jsonb[],
         $5::timestamptz[], $6::timestamptz[], $7::text[])`,
      [
        rows.map((r) => r.assetId),
        rows.map((r) => r.data.source),
        rows.map((r) => r.data.isMock),
        rows.map((r) => JSON.stringify(r.data)),
        rows.map((r) => r.data.timestamp),
        rows.map((r) => r.data.retrievedAt),
        rows.map((r) => r.data.sourceTimestamp),
      ],
    );
  }

  async insertMetrics(metrics: MarketMetrics[]): Promise<void> {
    if (metrics.length === 0) return;
    await this.pool.query(
      `INSERT INTO market_metrics
         (asset_id, momentum, volume_strength, activity, liquidity_strength,
          relative_strength, trend, volatility, timestamp)
       SELECT * FROM UNNEST(
         $1::uuid[], $2::numeric[], $3::numeric[], $4::numeric[],
         $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[], $9::timestamptz[])`,
      [
        metrics.map((m) => m.assetId),
        metrics.map((m) => m.momentum),
        metrics.map((m) => m.volumeStrength),
        metrics.map((m) => m.activity),
        metrics.map((m) => m.liquidityStrength),
        metrics.map((m) => m.relativeStrength),
        metrics.map((m) => m.trend),
        metrics.map((m) => m.volatility),
        metrics.map((m) => m.timestamp),
      ],
    );
  }

  async insertScores(scores: StrataScore[]): Promise<void> {
    if (scores.length === 0) return;
    await this.pool.query(
      `INSERT INTO strata_scores
         (asset_id, score, status, confidence, version, score_version,
          score_universe, sources, "timestamp")
       SELECT * FROM UNNEST(
         $1::uuid[], $2::numeric[], $3::text[], $4::numeric[],
         $5::text[], $6::text[], $7::text[], $8::jsonb[], $9::timestamptz[])`,
      [
        scores.map((s) => s.assetId),
        scores.map((s) => s.score),
        scores.map((s) => s.status),
        scores.map((s) => s.confidence),
        scores.map((s) => s.version),
        // the scoring method and the population it was relative to; without
        // both, a stored score cannot be interpreted later
        scores.map((s) => s.scoreVersion),
        scores.map((s) => s.scoreUniverse),
        scores.map((s) => JSON.stringify(s.sources ?? [])),
        scores.map((s) => s.timestamp),
      ],
    );
  }

  // ---- read model --------------------------------------------------------

  /**
   * The newest row per asset from each time-series table.
   *
   * These were DISTINCT ON, which is correct but leaves the planner free to
   * seq-scan and sort the whole table. Under load that is what it chose, and a
   * sort of rows this wide spilled to disk and held pool connections for tens
   * of seconds — which is what made the site flicker between live and
   * unavailable. A LATERAL lookup is one index seek per asset and cannot
   * degrade that way.
   */
  private latestRowsQuery(where: string): string {
    return `
      WITH scoped AS (
        SELECT * FROM assets ${where}
      ),
      latest_price AS (
        SELECT r.* FROM scoped s
        CROSS JOIN LATERAL (
          SELECT * FROM asset_prices
           WHERE asset_id = s.id
           ORDER BY timestamp DESC
           LIMIT 1
        ) r
      ),
      latest_metrics AS (
        SELECT r.* FROM scoped s
        CROSS JOIN LATERAL (
          SELECT * FROM market_metrics
           WHERE asset_id = s.id
           ORDER BY timestamp DESC
           LIMIT 1
        ) r
      ),
      latest_score AS (
        SELECT r.* FROM scoped s
        CROSS JOIN LATERAL (
          SELECT * FROM strata_scores
           WHERE asset_id = s.id
           ORDER BY timestamp DESC
           LIMIT 1
        ) r
      ),
      latest_snapshot AS (
        SELECT r.* FROM scoped s
        CROSS JOIN LATERAL (
          SELECT * FROM market_snapshots
           WHERE asset_id = s.id
           ORDER BY timestamp DESC
           LIMIT 1
        ) r
      )
      SELECT
        a.*,
        p.price, p.price_change_1h, p.price_change_24h, p.volume_24h,
        p.market_cap, p.timestamp AS price_timestamp,
        m.momentum, m.volume_strength, m.activity, m.liquidity_strength,
        m.relative_strength, m.trend, m.volatility, m.timestamp AS metrics_timestamp,
        s.score, s.status AS score_status, s.confidence AS score_confidence,
        s.version AS score_engine_version,
        s.score_version AS score_method_version,
        s.score_universe,
        s.timestamp AS score_timestamp,
        sn.payload AS snapshot_payload
      FROM scoped a
      LEFT JOIN latest_price p     ON p.asset_id = a.id
      LEFT JOIN latest_metrics m   ON m.asset_id = a.id
      LEFT JOIN latest_score s     ON s.asset_id = a.id
      LEFT JOIN latest_snapshot sn ON sn.asset_id = a.id
      ORDER BY a.symbol ASC`;
  }

  private mapLatestRow(row: Record<string, unknown>): LatestMarketRow {
    const asset = mapAsset(row as unknown as AssetRow);
    return {
      asset,
      price:
        row.price === null || row.price === undefined
          ? null
          : {
              assetId: asset.id,
              price: num(row.price),
              priceChange1h: numOrNull(row.price_change_1h),
              priceChange24h: numOrNull(row.price_change_24h),
              volume24h: numOrNull(row.volume_24h),
              marketCap: numOrNull(row.market_cap),
              timestamp: iso(row.price_timestamp),
            },
      metrics:
        row.momentum === null || row.momentum === undefined
          ? null
          : {
              assetId: asset.id,
              momentum: nullableNum(row.momentum),
              volumeStrength: nullableNum(row.volume_strength),
              activity: nullableNum(row.activity),
              liquidityStrength: nullableNum(row.liquidity_strength),
              relativeStrength: nullableNum(row.relative_strength),
              trend: nullableNum(row.trend),
              volatility: nullableNum(row.volatility),
              timestamp: iso(row.metrics_timestamp),
            },
      score:
        row.score === null || row.score === undefined
          ? null
          : {
              assetId: asset.id,
              score: nullableNum(row.score),
              status: (row.score_status as StrataScore["status"]) ?? "OK",
              confidence: nullableNum(row.score_confidence) ?? 0,
              version: String(row.score_engine_version),
              scoreVersion: String(row.score_method_version ?? "strata-v0-uncalibrated"),
              scoreUniverse: String(row.score_universe ?? "all"),
              timestamp: iso(row.score_timestamp),
              sources: Array.isArray(row.score_sources)
                ? (row.score_sources as string[])
                : row.snapshot_payload
                  ? [(row.snapshot_payload as { source?: string }).source ?? "unknown"]
                  : [],
            },
      snapshot: (row.snapshot_payload as NormalizedMarketData | null) ?? null,
    };
  }

  async getLatestMarketRows(filter?: AssetFilter): Promise<LatestMarketRow[]> {
    const params: unknown[] = [];
    const where = this.assetWhere(filter, params);
    const { rows } = await this.pool.query(this.latestRowsQuery(where), params);
    return rows.map((row) => this.mapLatestRow(row as Record<string, unknown>));
  }

  async getLatestMarketRow(assetId: string): Promise<LatestMarketRow | null> {
    const { rows } = await this.pool.query(this.latestRowsQuery("WHERE id = $1"), [assetId]);
    return rows[0] ? this.mapLatestRow(rows[0] as Record<string, unknown>) : null;
  }

  async getMetricsHistory(assetId: string, limit: number): Promise<MarketMetrics[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM market_metrics WHERE asset_id = $1 ORDER BY timestamp DESC LIMIT $2`,
      [assetId, limit],
    );
    return rows.map((row: Record<string, unknown>) => ({
      assetId,
      momentum: nullableNum(row.momentum),
      volumeStrength: nullableNum(row.volume_strength),
      activity: nullableNum(row.activity),
      liquidityStrength: nullableNum(row.liquidity_strength),
      relativeStrength: nullableNum(row.relative_strength),
      trend: nullableNum(row.trend),
      volatility: nullableNum(row.volatility),
      timestamp: iso(row.timestamp),
    }));
  }

  async getScoreHistory(assetId: string, limit: number): Promise<StrataScore[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM strata_scores WHERE asset_id = $1 ORDER BY timestamp DESC LIMIT $2`,
      [assetId, limit],
    );
    return rows.map((row: Record<string, unknown>) => ({
      assetId,
      score: nullableNum(row.score),
      status: (row.status as StrataScore["status"]) ?? "OK",
      confidence: nullableNum(row.confidence) ?? 0,
      version: String(row.version),
      scoreVersion: String(row.score_version ?? "strata-v0-uncalibrated"),
      scoreUniverse: String(row.score_universe ?? "all"),
      timestamp: iso(row.timestamp),
      sources: Array.isArray(row.sources) ? (row.sources as string[]) : [],
    }));
  }

  // ---- signals -----------------------------------------------------------

  async insertSignals(signals: Signal[]): Promise<void> {
    if (signals.length === 0) return;
    await this.pool.query(
      `INSERT INTO signals (asset_id, signal_type, severity, value, metadata, expires_at, timestamp)
       SELECT * FROM UNNEST(
         $1::uuid[], $2::text[], $3::text[], $4::numeric[], $5::jsonb[],
         $6::timestamptz[], $7::timestamptz[])`,
      [
        signals.map((s) => s.assetId),
        signals.map((s) => s.signalType),
        signals.map((s) => s.severity),
        signals.map((s) => s.value),
        signals.map((s) => JSON.stringify(s.metadata)),
        signals.map((s) => s.expiresAt),
        signals.map((s) => s.timestamp),
      ],
    );
  }

  async listSignals(filter?: SignalFilter): Promise<Signal[]> {
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (filter?.assetId) {
      params.push(filter.assetId);
      clauses.push(`s.asset_id = $${params.length}`);
    }
    if (filter?.signalType) {
      params.push(filter.signalType);
      clauses.push(`s.signal_type = $${params.length}`);
    }
    if (filter?.assetType) {
      params.push(filter.assetType);
      clauses.push(`a.asset_type = $${params.length}`);
    }
    if (filter?.since) {
      params.push(filter.since);
      clauses.push(`s.timestamp >= $${params.length}`);
    }
    params.push(filter?.limit ?? 100);

    const { rows } = await this.pool.query(
      `SELECT s.*, a.symbol
       FROM signals s
       JOIN assets a ON a.id = s.asset_id
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY s.timestamp DESC
       LIMIT $${params.length}`,
      params,
    );

    return rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      assetId: String(row.asset_id),
      symbol: String(row.symbol),
      signalType: row.signal_type as SignalType,
      expiresAt: row.expires_at ? iso(row.expires_at as Date) : iso(row.timestamp as Date),
      severity: row.severity as SignalSeverity,
      value: num(row.value),
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      timestamp: iso(row.timestamp),
    }));
  }

  // ---- rankings ----------------------------------------------------------

  async saveRankingSnapshot(snapshot: RankingSnapshot): Promise<void> {
    if (snapshot.entries.length === 0) return;
    await this.pool.query(
      `INSERT INTO rankings (metric, asset_type, asset_id, rank, value, score, timestamp)
       SELECT * FROM UNNEST(
         $1::text[], $2::text[], $3::uuid[], $4::int[], $5::numeric[], $6::numeric[], $7::timestamptz[])`,
      [
        snapshot.entries.map(() => snapshot.metric),
        snapshot.entries.map(() => snapshot.assetType),
        snapshot.entries.map((e) => e.assetId),
        snapshot.entries.map((e) => e.rank),
        snapshot.entries.map((e) => e.value),
        snapshot.entries.map((e) => e.score),
        snapshot.entries.map((e) => e.timestamp),
      ],
    );
  }

  async getPreviousRanks(
    metric: string,
    assetType: AssetType | "all",
  ): Promise<Map<string, number>> {
    const { rows } = await this.pool.query(
      `SELECT asset_id, rank FROM rankings
       WHERE metric = $1 AND asset_type = $2
         AND timestamp = (
           SELECT max(timestamp) FROM rankings WHERE metric = $1 AND asset_type = $2
         )`,
      [metric, assetType],
    );
    return new Map(
      rows.map((row: Record<string, unknown>) => [String(row.asset_id), Number(row.rank)]),
    );
  }

  // ---- arena -------------------------------------------------------------

  async getRankSeries(
    metric: string,
    assetType: AssetType | "all",
    sinceMinutes: number,
  ): Promise<RankSeriesPoint[]> {
    const { rows } = await this.pool.query<{
      asset_id: string;
      timestamp: Date;
      rank: number;
    }>(
      `SELECT asset_id, "timestamp", rank FROM rankings
         WHERE metric = $1 AND asset_type = $2
           AND "timestamp" >= now() - make_interval(mins => $3)
         ORDER BY "timestamp" DESC`,
      [metric, assetType, sinceMinutes],
    );
    return rows.map((row) => ({
      assetId: row.asset_id,
      timestamp: iso(row.timestamp),
      rank: Number(row.rank),
    }));
  }

  async getRankHistory(
    assetId: string,
    metric: string,
    assetType: AssetType | "all",
    limit: number,
  ): Promise<{ timestamp: string; rank: number }[]> {
    const { rows } = await this.pool.query<{ timestamp: Date; rank: number }>(
      `SELECT "timestamp", rank FROM rankings
         WHERE asset_id = $1 AND metric = $2 AND asset_type = $3
         ORDER BY "timestamp" DESC
         LIMIT $4`,
      [assetId, metric, assetType, limit],
    );
    return rows.map((row) => ({ timestamp: iso(row.timestamp), rank: Number(row.rank) }));
  }

  async createArenaRound(round: Omit<ArenaRound, "id" | "createdAt">): Promise<ArenaRound> {
    const { rows } = await this.pool.query(
      `INSERT INTO arena_rounds
         (season, round_number, status, starts_at, ends_at, arena_version)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (round_number) DO UPDATE SET status = EXCLUDED.status
       RETURNING *`,
      [
        round.season,
        round.roundNumber,
        round.status,
        round.startsAt,
        round.endsAt,
        round.arenaVersion,
      ],
    );
    return this.mapRound(rows[0] as Record<string, unknown>);
  }

  async settleArenaRound(
    roundId: string,
    outcome: {
      settledAt: string;
      winnerAssetId: string | null;
      winnerSymbol: string | null;
      winnerScore: number | null;
      winnerHp: number | null;
    },
  ): Promise<ArenaRound | null> {
    // Settlement is written once. The WHERE guard makes a second attempt a
    // no-op rather than a rewrite: a past result that can change is not a
    // history, and the Arena's credibility rests on it being permanent.
    const { rows } = await this.pool.query(
      `UPDATE arena_rounds
          SET status = 'settled',
              settled_at = $2,
              winner_asset_id = $3,
              winner_symbol = $4,
              winner_score = $5,
              winner_hp = $6
        WHERE id = $1 AND status <> 'settled'
        RETURNING *`,
      [
        roundId,
        outcome.settledAt,
        outcome.winnerAssetId,
        outcome.winnerSymbol,
        outcome.winnerScore,
        outcome.winnerHp,
      ],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? this.mapRound(row) : this.getArenaRoundById(roundId);
  }

  async getArenaRoundById(roundId: string): Promise<ArenaRound | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM arena_rounds WHERE id = $1`,
      [roundId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? this.mapRound(row) : null;
  }

  async insertArenaEvents(events: ArenaEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.pool.query(
      `INSERT INTO arena_events
         (round_id, asset_id, event_type, previous_value, new_value, change,
          summary, metadata, created_at)
       SELECT * FROM UNNEST(
         $1::uuid[], $2::uuid[], $3::text[], $4::numeric[], $5::numeric[],
         $6::numeric[], $7::text[], $8::jsonb[], $9::timestamptz[])`,
      [
        events.map((e) => e.roundId),
        events.map((e) => e.assetId),
        events.map((e) => e.eventType),
        events.map((e) => e.previousValue),
        events.map((e) => e.newValue),
        events.map((e) => e.change),
        events.map((e) => e.summary),
        events.map((e) => JSON.stringify(e.metadata)),
        events.map((e) => e.createdAt),
      ],
    );
  }

  async listArenaEvents(roundId: string, limit: number): Promise<ArenaEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT ev.*, a.symbol
         FROM arena_events ev
         LEFT JOIN assets a ON a.id = ev.asset_id
        WHERE ev.round_id = $1
        ORDER BY ev.created_at DESC
        LIMIT $2`,
      [roundId, limit],
    );
    return rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      roundId: String(row.round_id),
      assetId: row.asset_id === null ? null : String(row.asset_id),
      symbol: row.symbol === null || row.symbol === undefined ? null : String(row.symbol),
      eventType: row.event_type as ArenaEvent["eventType"],
      previousValue: nullableNum(row.previous_value),
      newValue: nullableNum(row.new_value),
      change: nullableNum(row.change),
      summary: String(row.summary),
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      createdAt: iso(row.created_at),
    }));
  }

  private mapRound(row: Record<string, unknown>): ArenaRound {
    return {
      id: String(row.id),
      season: Number(row.season ?? 1),
      roundNumber: Number(row.round_number),
      status: row.status as ArenaRound["status"],
      startsAt: iso(row.starts_at),
      endsAt: iso(row.ends_at),
      settledAt: row.settled_at ? iso(row.settled_at) : null,
      winnerAssetId: row.winner_asset_id === null || row.winner_asset_id === undefined
        ? null
        : String(row.winner_asset_id),
      winnerSymbol: row.winner_symbol === null || row.winner_symbol === undefined
        ? null
        : String(row.winner_symbol),
      winnerScore: nullableNum(row.winner_score),
      winnerHp: nullableNum(row.winner_hp),
      arenaVersion: String(row.arena_version ?? "arena-v1"),
      createdAt: iso(row.created_at),
    };
  }

  async getArenaRound(roundNumber: number): Promise<ArenaRound | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM arena_rounds WHERE round_number = $1`,
      [roundNumber],
    );
    return rows[0] ? this.mapRound(rows[0] as Record<string, unknown>) : null;
  }

  async getCurrentArenaRound(): Promise<ArenaRound | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM arena_rounds
       ORDER BY (status = 'active') DESC, round_number DESC
       LIMIT 1`,
    );
    return rows[0] ? this.mapRound(rows[0] as Record<string, unknown>) : null;
  }

  async listArenaRounds(limit: number): Promise<ArenaRound[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM arena_rounds ORDER BY round_number DESC LIMIT $1`,
      [limit],
    );
    return rows.map((row: Record<string, unknown>) => this.mapRound(row));
  }

  async upsertArenaEntries(entries: ArenaEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.pool.query(
      `INSERT INTO arena_entries
         (round_id, asset_id, starting_score, current_score, starting_hp,
          current_hp, power, rank, starting_rank, status, eliminated_at,
          joined_at, updated_at)
       SELECT * FROM UNNEST(
         $1::uuid[], $2::uuid[], $3::numeric[], $4::numeric[], $5::numeric[],
         $6::numeric[], $7::numeric[], $8::int[], $9::int[], $10::text[],
         $11::timestamptz[], $12::timestamptz[], $13::timestamptz[])
       ON CONFLICT (round_id, asset_id) DO UPDATE
         SET current_score = EXCLUDED.current_score,
             current_hp = EXCLUDED.current_hp,
             power = EXCLUDED.power,
             rank = EXCLUDED.rank,
             status = EXCLUDED.status,
             eliminated_at = COALESCE(arena_entries.eliminated_at, EXCLUDED.eliminated_at),
             updated_at = EXCLUDED.updated_at`,
      [
        entries.map((e) => e.roundId),
        entries.map((e) => e.assetId),
        entries.map((e) => e.startingScore),
        entries.map((e) => e.currentScore),
        entries.map((e) => e.startingHp),
        entries.map((e) => e.currentHp),
        entries.map((e) => e.power),
        entries.map((e) => e.rank),
        entries.map((e) => e.startingRank),
        entries.map((e) => e.status),
        entries.map((e) => e.eliminatedAt),
        entries.map((e) => e.joinedAt),
        entries.map((e) => e.updatedAt),
      ],
    );
  }

  async listArenaEntries(roundId: string): Promise<ArenaEntry[]> {
    const { rows } = await this.pool.query(
      `SELECT e.*, a.symbol
       FROM arena_entries e
       JOIN assets a ON a.id = e.asset_id
       WHERE e.round_id = $1
       ORDER BY e.rank ASC`,
      [roundId],
    );
    return rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      roundId: String(row.round_id),
      assetId: String(row.asset_id),
      symbol: String(row.symbol),
      startingScore: num(row.starting_score),
      currentScore: num(row.current_score),
      startingHp: num(row.starting_hp),
      currentHp: num(row.current_hp),
      power: nullableNum(row.power),
      rank: Number(row.rank),
      startingRank: Number(row.starting_rank ?? row.rank),
      status: row.status as ArenaEntry["status"],
      eliminatedAt: row.eliminated_at ? iso(row.eliminated_at) : null,
      joinedAt: iso(row.joined_at ?? row.updated_at),
      updatedAt: iso(row.updated_at),
    }));
  }

  // ---- compute events ----------------------------------------------------

  async getPersistedStats(): Promise<PersistedStats> {
    // One round trip. Six separate counts would be six trips to Tokyo, and
    // this is read by a health endpoint that should stay cheap.
    const { rows } = await this.pool.query<{
      last_ingestion: Date | null;
      last_computation: Date | null;
      assets: string;
      snapshots: string;
      scores: string;
      signals: string;
      events: string;
    }>(
      `SELECT
         (SELECT max(retrieved_at) FROM market_snapshots)            AS last_ingestion,
         (SELECT max("timestamp") FROM strata_scores)                AS last_computation,
         (SELECT count(*) FROM assets)                               AS assets,
         (SELECT count(*) FROM market_snapshots)                     AS snapshots,
         (SELECT count(*) FROM strata_scores)                        AS scores,
         (SELECT count(*) FROM signals)                              AS signals,
         (SELECT count(*) FROM compute_events)                       AS events`,
    );

    const row = rows[0];
    return {
      lastIngestionAt: row?.last_ingestion ? iso(row.last_ingestion) : null,
      lastComputationAt: row?.last_computation ? iso(row.last_computation) : null,
      assetsTracked: Number(row?.assets ?? 0),
      marketSnapshots: Number(row?.snapshots ?? 0),
      scoresComputed: Number(row?.scores ?? 0),
      signalsGenerated: Number(row?.signals ?? 0),
      computeEvents: Number(row?.events ?? 0),
    };
  }

  async insertCalibrations(snapshots: CalibrationSnapshot[]): Promise<void> {
    if (snapshots.length === 0) return;
    await this.pool.query(
      `INSERT INTO score_calibrations
         (score_version, universe, sample_size, method, composite_mean,
          composite_sigma, anchored, distribution, created_at)
       SELECT * FROM UNNEST(
         $1::text[], $2::text[], $3::int[], $4::text[], $5::numeric[],
         $6::numeric[], $7::boolean[], $8::jsonb[], $9::timestamptz[])`,
      [
        snapshots.map((s) => s.scoreVersion),
        snapshots.map((s) => s.universe),
        snapshots.map((s) => s.sampleSize),
        snapshots.map((s) => s.method),
        snapshots.map((s) => s.compositeMean),
        snapshots.map((s) => s.compositeSigma),
        snapshots.map((s) => s.anchored),
        snapshots.map((s) => JSON.stringify(s.distribution)),
        snapshots.map((s) => s.createdAt),
      ],
    );
  }

  async listCalibrations(limit: number): Promise<CalibrationSnapshot[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM score_calibrations ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((row: Record<string, unknown>) => ({
      scoreVersion: String(row.score_version),
      universe: String(row.universe),
      sampleSize: Number(row.sample_size),
      method: String(row.method),
      compositeMean: nullableNum(row.composite_mean),
      compositeSigma: nullableNum(row.composite_sigma),
      anchored: Boolean(row.anchored),
      distribution: (row.distribution ?? {}) as Record<string, unknown>,
      createdAt: iso(row.created_at),
    }));
  }

  /* ---- intelligence events --------------------------------------------- */

  async upsertIntelligenceEvents(events: IntelligenceEvent[]): Promise<void> {
    if (events.length === 0) return;

    // Two statements rather than one, because the conflict target differs:
    // asset events are unique on (asset_id, event_type) among open rows,
    // market-wide events have no asset_id and are unique on event_type alone.
    // A single ON CONFLICT cannot name both partial indexes.
    const assetEvents = events.filter((e) => e.assetId !== null);
    const marketEvents = events.filter((e) => e.assetId === null);

    const columns = `(asset_id, asset_type, event_type, status, severity,
       significance, sig_magnitude, sig_persistence, sig_deviation, sig_data_confidence,
       confidence, driver_agreement, magnitude, observations, drivers, context,
       first_value, latest_value, priority, detected_at, latest_at, expires_at,
       computation_version, score_version)`;

    const values = (list: IntelligenceEvent[]) => [
      list.map((e) => e.assetId),
      list.map((e) => e.assetType),
      list.map((e) => e.eventType),
      list.map((e) => e.status),
      list.map((e) => e.severity),
      list.map((e) => e.significance.value),
      list.map((e) => e.significance.magnitude),
      list.map((e) => e.significance.persistence),
      list.map((e) => e.significance.historicalDeviation),
      list.map((e) => e.significance.dataConfidence),
      list.map((e) => e.confidence),
      list.map((e) => e.driverAgreement),
      list.map((e) => e.magnitude),
      list.map((e) => e.observations),
      list.map((e) => JSON.stringify(e.drivers)),
      list.map((e) => JSON.stringify(e.context)),
      list.map((e) => e.firstValue),
      list.map((e) => e.latestValue),
      list.map((e) => e.priority),
      list.map((e) => e.detectedAt),
      list.map((e) => e.latestAt),
      list.map((e) => e.expiresAt),
      list.map((e) => e.computationVersion),
      list.map((e) => e.scoreVersion),
    ];

    // On conflict the event EVOLVES: detected_at is preserved so the feed can
    // say how long the condition has held, while everything measured is
    // replaced with the latest reading.
    const updateClause = `DO UPDATE SET
         status = EXCLUDED.status,
         severity = EXCLUDED.severity,
         significance = EXCLUDED.significance,
         sig_magnitude = EXCLUDED.sig_magnitude,
         sig_persistence = EXCLUDED.sig_persistence,
         sig_deviation = EXCLUDED.sig_deviation,
         sig_data_confidence = EXCLUDED.sig_data_confidence,
         confidence = EXCLUDED.confidence,
         driver_agreement = EXCLUDED.driver_agreement,
         magnitude = EXCLUDED.magnitude,
         observations = EXCLUDED.observations,
         drivers = EXCLUDED.drivers,
         context = EXCLUDED.context,
         latest_value = EXCLUDED.latest_value,
         priority = EXCLUDED.priority,
         latest_at = EXCLUDED.latest_at,
         expires_at = EXCLUDED.expires_at`;

    const unnest = `SELECT * FROM UNNEST(
         $1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[],
         $6::numeric[], $7::numeric[], $8::numeric[], $9::numeric[], $10::numeric[],
         $11::numeric[], $12::numeric[], $13::numeric[], $14::int[], $15::jsonb[], $16::jsonb[],
         $17::numeric[], $18::numeric[], $19::numeric[], $20::timestamptz[], $21::timestamptz[],
         $22::timestamptz[], $23::text[], $24::text[])`;

    if (assetEvents.length > 0) {
      await this.pool.query(
        `INSERT INTO intelligence_events ${columns} ${unnest}
         ON CONFLICT (asset_id, event_type)
           WHERE status IN ('detected','active') AND asset_id IS NOT NULL
         ${updateClause}`,
        values(assetEvents),
      );
    }

    if (marketEvents.length > 0) {
      await this.pool.query(
        `INSERT INTO intelligence_events ${columns} ${unnest}
         ON CONFLICT (event_type)
           WHERE status IN ('detected','active') AND asset_id IS NULL
         ${updateClause}`,
        values(marketEvents),
      );
    }
  }

  async closeIntelligenceEvents(events: IntelligenceEvent[]): Promise<void> {
    if (events.length === 0) return;

    // Closed by identity rather than by id, because the caller reconciles
    // against what it read at the start of the pass.
    await this.pool.query(
      `UPDATE intelligence_events e
          SET status = t.status,
              resolved_at = t.resolved_at,
              latest_at = t.latest_at
         FROM UNNEST($1::uuid[], $2::text[], $3::text[], $4::timestamptz[], $5::timestamptz[])
              AS t(asset_id, event_type, status, resolved_at, latest_at)
        WHERE e.event_type = t.event_type
          AND e.status IN ('detected','active')
          AND (e.asset_id = t.asset_id OR (e.asset_id IS NULL AND t.asset_id IS NULL))`,
      [
        events.map((e) => e.assetId),
        events.map((e) => e.eventType),
        events.map((e) => e.status),
        events.map((e) => e.resolvedAt),
        events.map((e) => e.latestAt),
      ],
    );
  }

  private mapIntelligenceEvent(row: Record<string, unknown>): IntelligenceEvent {
    return {
      id: String(row.id),
      assetId: row.asset_id === null || row.asset_id === undefined ? null : String(row.asset_id),
      symbol: row.symbol === null || row.symbol === undefined ? null : String(row.symbol),
      assetType: (row.asset_type ?? null) as IntelligenceEvent["assetType"],
      eventType: row.event_type as IntelligenceEvent["eventType"],
      status: row.status as IntelligenceEvent["status"],
      severity: row.severity as IntelligenceEvent["severity"],
      significance: {
        value: num(row.significance),
        magnitude: num(row.sig_magnitude),
        persistence: num(row.sig_persistence),
        historicalDeviation: num(row.sig_deviation),
        dataConfidence: num(row.sig_data_confidence),
      },
      confidence: num(row.confidence),
      driverAgreement: num(row.driver_agreement),
      magnitude: num(row.magnitude),
      observations: Number(row.observations),
      drivers: (row.drivers ?? []) as IntelligenceEvent["drivers"],
      context: (row.context ?? {}) as Record<string, unknown>,
      firstValue: nullableNum(row.first_value),
      latestValue: nullableNum(row.latest_value),
      priority: num(row.priority),
      detectedAt: iso(row.detected_at),
      latestAt: iso(row.latest_at),
      resolvedAt: row.resolved_at ? iso(row.resolved_at) : null,
      expiresAt: iso(row.expires_at),
      computationVersion: String(row.computation_version),
      scoreVersion: String(row.score_version),
    };
  }

  async listOpenIntelligenceEvents(): Promise<IntelligenceEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT e.*, a.symbol FROM intelligence_events e
         LEFT JOIN assets a ON a.id = e.asset_id
        WHERE e.status IN ('detected','active')
        ORDER BY e.priority DESC, e.latest_at DESC`,
    );
    return rows.map((row: Record<string, unknown>) => this.mapIntelligenceEvent(row));
  }

  async listIntelligenceEvents(
    filter: IntelligenceEventFilter,
  ): Promise<IntelligenceEvent[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter.types && filter.types.length > 0) {
      params.push(filter.types);
      clauses.push(`e.event_type = ANY($${params.length}::text[])`);
    }
    if (filter.assetId) {
      params.push(filter.assetId);
      clauses.push(`e.asset_id = $${params.length}`);
    }
    if (filter.assetType) {
      params.push(filter.assetType);
      clauses.push(`e.asset_type = $${params.length}`);
    }
    if (filter.severity) {
      params.push(filter.severity);
      clauses.push(`e.severity = $${params.length}`);
    }
    if (filter.status && filter.status.length > 0) {
      params.push(filter.status);
      clauses.push(`e.status = ANY($${params.length}::text[])`);
    }
    if (filter.since) {
      params.push(filter.since);
      clauses.push(`e.latest_at >= $${params.length}`);
    }

    params.push(filter.limit ?? 60);

    const { rows } = await this.pool.query(
      `SELECT e.*, a.symbol FROM intelligence_events e
         LEFT JOIN assets a ON a.id = e.asset_id
        ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
        ORDER BY e.priority DESC, e.latest_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return rows.map((row: Record<string, unknown>) => this.mapIntelligenceEvent(row));
  }

  async getIntelligenceEvent(id: string): Promise<IntelligenceEvent | null> {
    const { rows } = await this.pool.query(
      `SELECT e.*, a.symbol FROM intelligence_events e
         LEFT JOIN assets a ON a.id = e.asset_id
        WHERE e.id = $1`,
      [id],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? this.mapIntelligenceEvent(row) : null;
  }

  async countIntelligenceEvents(): Promise<{ open: number; resolved: number; total: number }> {
    const { rows } = await this.pool.query<{ open: string; resolved: string; total: string }>(
      `SELECT
         count(*) FILTER (WHERE status IN ('detected','active'))::text AS open,
         count(*) FILTER (WHERE status = 'resolved')::text AS resolved,
         count(*)::text AS total
       FROM intelligence_events`,
    );
    const row = rows[0];
    return {
      open: Number(row?.open ?? 0),
      resolved: Number(row?.resolved ?? 0),
      total: Number(row?.total ?? 0),
    };
  }

  async insertComputeEvents(events: ComputeEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.pool.query(
      `INSERT INTO compute_events
         (asset_id, event_type, input_data, output_data, computation_version, created_at)
       SELECT * FROM UNNEST(
         $1::uuid[], $2::text[], $3::jsonb[], $4::jsonb[], $5::text[], $6::timestamptz[])`,
      [
        events.map((e) => e.assetId),
        events.map((e) => e.eventType),
        events.map((e) => JSON.stringify(e.inputData ?? {})),
        events.map((e) => JSON.stringify(e.outputData ?? {})),
        events.map((e) => e.computationVersion),
        events.map((e) => e.createdAt),
      ],
    );
  }

  /* ---- history ---------------------------------------------------------- */

  async getObservationHistory(assetId: string, limit: number): Promise<Observation[]> {
    // The observation lives in `payload` as JSONB, not as individual columns.
    // Extracting server-side keeps the transfer to the five fields the
    // engines actually consume instead of shipping the whole document —
    // these rows are read for every asset on every pass.
    const { rows } = await this.pool.query<ObservationRow>(
      `SELECT
         "timestamp",
         (payload->>'price')::numeric                  AS price,
         (payload->>'volume24h')::numeric              AS volume_24h,
         (payload->>'liquidity')::numeric              AS liquidity,
         (payload->>'tradeCount24h')::numeric          AS trade_count_24h,
         (payload->>'uniqueParticipants24h')::numeric  AS unique_participants_24h
       FROM market_snapshots
       WHERE asset_id = $1
         AND payload->>'price' IS NOT NULL
       ORDER BY "timestamp" DESC
       LIMIT $2`,
      [assetId, limit],
    );

    return rows
      .map((row) => ({
        timestamp: iso(row.timestamp),
        price: Number(row.price),
        volume24h: row.volume_24h === null ? null : Number(row.volume_24h),
        liquidity: row.liquidity === null ? null : Number(row.liquidity),
        tradeCount24h: row.trade_count_24h === null ? null : Number(row.trade_count_24h),
        uniqueParticipants24h:
          row.unique_participants_24h === null ? null : Number(row.unique_participants_24h),
      }))
      .filter((point) => Number.isFinite(point.price) && point.price > 0)
      .reverse();
  }

  async backfillObservations(assetId: string, points: Observation[]): Promise<number> {
    if (points.length === 0) return 0;

    /**
     * Two guards, because they cover different races.
     *
     * `WHERE NOT EXISTS` skips any timestamp already covered by a live poll.
     * Backfilled and polled observations describe the same instant, and
     * storing both would count that instant twice in every baseline derived
     * from the series.
     *
     * `ON CONFLICT` then catches a concurrent backfill of the same asset,
     * which the NOT EXISTS check cannot see. It targets the partial unique
     * index over backfilled rows only — a full unique index would forbid two
     * live sources from legitimately observing the same asset at the same
     * moment.
     */
    const result = await this.pool.query(
      `INSERT INTO market_snapshots (asset_id, source, is_mock, payload, "timestamp", retrieved_at, source_timestamp)
       SELECT $1::uuid, 'backfill', false, p.payload, p.ts, p.ts, p.ts
         FROM UNNEST($2::jsonb[], $3::timestamptz[]) AS p(payload, ts)
        WHERE NOT EXISTS (
          SELECT 1 FROM market_snapshots existing
           WHERE existing.asset_id = $1::uuid
             AND existing."timestamp" = p.ts
        )
       ON CONFLICT (asset_id, "timestamp") WHERE source = 'backfill' DO NOTHING`,
      [
        assetId,
        points.map((point) =>
          JSON.stringify({
            price: point.price,
            volume24h: point.volume24h,
            liquidity: point.liquidity,
            tradeCount24h: point.tradeCount24h,
            uniqueParticipants24h: point.uniqueParticipants24h,
            source: "backfill",
            isMock: false,
            timestamp: point.timestamp,
          }),
        ),
        points.map((point) => point.timestamp),
      ],
    );
    return result.rowCount ?? 0;
  }

  /* ---- intelligence ----------------------------------------------------- */

  async insertIntelligence(records: AssetIntelligence[]): Promise<void> {
    if (records.length === 0) return;

    // `sources` is text[] here (it is jsonb on strata_scores — the two tables
    // genuinely differ). A multidimensional Postgres array must be
    // rectangular, so an array-of-arrays cannot be passed through UNNEST.
    // Sending jsonb and converting per row is what makes a ragged list work.
    await this.pool.query(
      `INSERT INTO asset_intelligence
         (asset_id, computation_version, status, score, confidence,
          history_points, age_seconds, payload, sources, "timestamp")
       SELECT
         t.asset_id, t.version, t.status, t.score, t.confidence,
         t.history_points, t.age_seconds, t.payload,
         ARRAY(SELECT jsonb_array_elements_text(t.sources)),
         t.ts
       FROM UNNEST(
         $1::uuid[], $2::text[], $3::text[], $4::numeric[], $5::numeric[],
         $6::int[], $7::int[], $8::jsonb[], $9::jsonb[], $10::timestamptz[]
       ) AS t(asset_id, version, status, score, confidence,
              history_points, age_seconds, payload, sources, ts)`,
      [
        records.map((r) => r.assetId),
        records.map((r) => r.score.version),
        records.map((r) => r.score.status),
        records.map((r) => r.score.score),
        records.map((r) => r.score.confidence.value),
        records.map((r) => r.historyPoints),
        records.map((r) => r.ageSeconds),
        records.map((r) => JSON.stringify({ score: r.score, engines: r.engines })),
        records.map((r) => JSON.stringify(r.sources)),
        records.map((r) => r.timestamp),
      ],
    );
  }

  private mapIntelligence(row: IntelligenceRow, asset: Asset): AssetIntelligence {
    const payload = row.payload as {
      score: AssetIntelligence["score"];
      engines: AssetIntelligence["engines"];
    };
    return {
      assetId: row.asset_id,
      symbol: asset.symbol,
      assetType: asset.assetType,
      score: payload.score,
      engines: payload.engines,
      historyPoints: row.history_points,
      ageSeconds: row.age_seconds,
      sources: (row.sources as string[]) ?? [],
      timestamp: iso(row.timestamp),
    };
  }

  async getLatestIntelligence(assetId: string): Promise<AssetIntelligence | null> {
    const asset = await this.getAssetById(assetId);
    if (!asset) return null;
    const { rows } = await this.pool.query<IntelligenceRow>(
      `SELECT * FROM asset_intelligence WHERE asset_id = $1 ORDER BY timestamp DESC LIMIT 1`,
      [assetId],
    );
    const row = rows[0];
    return row ? this.mapIntelligence(row, asset) : null;
  }

  async listLatestIntelligence(filter?: AssetFilter): Promise<AssetIntelligence[]> {
    const assets = await this.listAssets(filter);
    if (assets.length === 0) return [];
    const byId = new Map(assets.map((a) => [a.id, a]));

    // One row per asset, via a lateral lookup rather than DISTINCT ON.
    //
    // DISTINCT ON reads correctly but plans badly here: with = ANY over the
    // whole table the planner is free to seq-scan and sort, and these rows
    // carry a JSONB payload, so the sort spills to disk and the query ran for
    // fifty seconds holding a pool connection. LATERAL cannot make that
    // choice — it is one index lookup per asset, each returning a single row.
    const { rows } = await this.pool.query<IntelligenceRow>(
      `SELECT i.*
         FROM unnest($1::uuid[]) AS a(id)
         CROSS JOIN LATERAL (
           SELECT * FROM asset_intelligence
            WHERE asset_id = a.id
            ORDER BY timestamp DESC
            LIMIT 1
         ) i`,
      [assets.map((a) => a.id)],
    );

    const out: AssetIntelligence[] = [];
    for (const row of rows) {
      const asset = byId.get(row.asset_id);
      if (asset) out.push(this.mapIntelligence(row, asset));
    }
    return out;
  }

  /**
   * Every asset's detection series in a single statement.
   *
   * The engine readings are extracted from the JSONB payload server-side, so
   * what crosses the connection is six narrow columns rather than the whole
   * per-pass record. The window function caps points per asset, and the time
   * bound keeps the scan on the (asset_id, timestamp) index instead of the
   * whole table.
   */
  async getDetectionSeries(
    sinceMinutes: number,
    perAssetLimit: number,
  ): Promise<DetectionSeriesPoint[]> {
    const { rows } = await this.pool.query<{
      asset_id: string;
      timestamp: Date;
      score: string | null;
      momentum: string | null;
      trend: string | null;
      volume: string | null;
    }>(
      `SELECT asset_id, "timestamp", score, momentum, trend, volume
         FROM (
           SELECT asset_id,
                  "timestamp",
                  score,
                  (payload->'engines'->'momentum'->>'score')::numeric AS momentum,
                  (payload->'engines'->'trend'->>'score')::numeric     AS trend,
                  (payload->'engines'->'volume'->>'score')::numeric    AS volume,
                  row_number() OVER (
                    PARTITION BY asset_id ORDER BY "timestamp" DESC
                  ) AS rn
             FROM asset_intelligence
            WHERE "timestamp" >= now() - make_interval(mins => $1)
         ) ranked
        WHERE rn <= $2
        ORDER BY asset_id, "timestamp" DESC`,
      [sinceMinutes, perAssetLimit],
    );

    return rows.map((row) => ({
      assetId: row.asset_id,
      timestamp: iso(row.timestamp),
      score: nullableNum(row.score),
      momentum: nullableNum(row.momentum),
      trend: nullableNum(row.trend),
      volume: nullableNum(row.volume),
    }));
  }

  async getIntelligenceHistory(assetId: string, limit: number): Promise<AssetIntelligence[]> {
    const asset = await this.getAssetById(assetId);
    if (!asset) return [];
    const { rows } = await this.pool.query<IntelligenceRow>(
      `SELECT * FROM asset_intelligence
        WHERE asset_id = $1 ORDER BY timestamp DESC LIMIT $2`,
      [assetId, limit],
    );
    return rows.map((row) => this.mapIntelligence(row, asset));
  }

  async listComputeEvents(limit: number, assetId?: string): Promise<ComputeEvent[]> {
    const { rows } = await this.pool.query<ComputeEventRow>(
      assetId
        ? `SELECT * FROM compute_events WHERE asset_id = $2 ORDER BY created_at DESC LIMIT $1`
        : `SELECT * FROM compute_events ORDER BY created_at DESC LIMIT $1`,
      assetId ? [limit, assetId] : [limit],
    );
    return rows.map((row) => ({
      id: String(row.id),
      assetId: row.asset_id,
      eventType: row.event_type,
      inputData: row.input_data,
      outputData: row.output_data,
      computationVersion: row.computation_version,
      createdAt: iso(row.created_at),
    }));
  }

  async countComputeEventsSince(since: string): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM compute_events WHERE created_at >= $1`,
      [since],
    );
    return Number(rows[0]?.count ?? 0);
  }
}
