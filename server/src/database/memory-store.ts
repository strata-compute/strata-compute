import { randomUUID } from "node:crypto";
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
import type { Signal } from "../types/signals.ts";
import { nowIso } from "../utils/time.ts";
import type {
  AssetFilter,
  AssetUpsert,
  LatestMarketRow,
  SignalFilter,
  StrataStore,
  PersistedStats,
  CalibrationSnapshot,
  DetectionSeriesPoint,
  RankSeriesPoint,
} from "./store.ts";

/**
 * In-memory implementation of the persistence contract.
 *
 * Its purpose is availability, not durability: when DATABASE_URL is absent or
 * Postgres is unreachable, the service still ingests, computes and serves —
 * and says so, through `meta.source: "memory"` on every response and a
 * degraded `/api/health`. Bounded history keeps memory flat.
 */

// Deep enough to hold a provider backfill (a week of hourly points) alongside
// roughly a day of live polling, so the two cadences coexist rather than the
// faster one evicting the depth the slower one provided.
const HISTORY_LIMIT = 1200;

function push<T>(list: T[], item: T) {
  list.push(item);
  if (list.length > HISTORY_LIMIT) list.splice(0, list.length - HISTORY_LIMIT);
}

function matchesAsset(asset: Asset, filter?: AssetFilter): boolean {
  if (!filter) return true;
  if (filter.assetType && asset.assetType !== filter.assetType) return false;
  if (filter.status && asset.status !== filter.status) return false;
  if (filter.search) {
    const needle = filter.search.toLowerCase();
    if (
      !asset.symbol.toLowerCase().includes(needle) &&
      !asset.name.toLowerCase().includes(needle)
    ) {
      return false;
    }
  }
  return true;
}

export class MemoryStore implements StrataStore {
  readonly kind = "memory" as const;

  private readonly assets = new Map<string, Asset>();
  private readonly assetIdBySymbol = new Map<string, string>();
  private readonly prices = new Map<string, AssetPrice[]>();
  private readonly snapshots = new Map<string, NormalizedMarketData[]>();
  private readonly metrics = new Map<string, MarketMetrics[]>();
  private readonly scores = new Map<string, StrataScore[]>();
  private signals: Signal[] = [];
  private readonly rankSnapshots = new Map<string, Map<string, number>>();
  private readonly rankHistory = new Map<string, { timestamp: string; rank: number }[]>();
  private readonly rounds = new Map<string, ArenaRound>();
  private readonly entries = new Map<string, ArenaEntry[]>();
  private readonly arenaEvents = new Map<string, ArenaEvent[]>();
  private computeEvents: ComputeEvent[] = [];
  private calibrations: CalibrationSnapshot[] = [];
  private readonly intelligenceEvents = new Map<string, IntelligenceEvent>();
  private closedIntelligence: IntelligenceEvent[] = [];
  private readonly intelligence = new Map<string, AssetIntelligence[]>();
  /**
   * Backfilled history, kept deliberately apart from `snapshots`.
   *
   * Snapshots are live observations, and the newest one is what the whole
   * product reads as "the current price". A backfilled point can carry a
   * timestamp newer than the last poll — a provider's hourly series often
   * does — so merging the two into one list would let a historical record
   * with no 24h change and no source become the live quote. Keeping them
   * separate and joining only where history is wanted makes that impossible
   * rather than merely unlikely.
   */
  private readonly backfilled = new Map<string, Observation[]>();

  async isHealthy(): Promise<boolean> {
    return true;
  }

  private key(symbol: string, assetType: AssetType) {
    return `${assetType}:${symbol.toUpperCase()}`;
  }

  async upsertAssets(input: AssetUpsert[]): Promise<Asset[]> {
    const out: Asset[] = [];
    for (const item of input) {
      const key = this.key(item.symbol, item.assetType);
      const existingId = this.assetIdBySymbol.get(key);
      const timestamp = nowIso();

      if (existingId) {
        const existing = this.assets.get(existingId) as Asset;
        const updated: Asset = {
          ...existing,
          name: item.name,
          chain: item.chain,
          contractAddress: item.contractAddress,
          // keep the last logo this provider published rather than blanking it
          // on a pass that happened to omit the field
          logoUrl: item.logoUrl ?? existing.logoUrl,
          updatedAt: timestamp,
        };
        this.assets.set(existingId, updated);
        out.push(updated);
        continue;
      }

      const asset: Asset = {
        id: randomUUID(),
        symbol: item.symbol.toUpperCase(),
        name: item.name,
        assetType: item.assetType,
        chain: item.chain,
        contractAddress: item.contractAddress,
        logoUrl: item.logoUrl,
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.assets.set(asset.id, asset);
      this.assetIdBySymbol.set(key, asset.id);
      out.push(asset);
    }
    return out;
  }

  async listAssets(filter?: AssetFilter): Promise<Asset[]> {
    const all = [...this.assets.values()]
      .filter((a) => matchesAsset(a, filter))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? all.length;
    return all.slice(offset, offset + limit);
  }

  async countAssets(filter?: AssetFilter): Promise<number> {
    return [...this.assets.values()].filter((a) => matchesAsset(a, filter)).length;
  }

  async getAssetById(id: string): Promise<Asset | null> {
    return this.assets.get(id) ?? null;
  }

  async getAssetBySymbol(symbol: string, assetType?: AssetType): Promise<Asset | null> {
    if (assetType) {
      const id = this.assetIdBySymbol.get(this.key(symbol, assetType));
      return id ? (this.assets.get(id) ?? null) : null;
    }
    const upper = symbol.toUpperCase();
    return [...this.assets.values()].find((a) => a.symbol === upper) ?? null;
  }

  async insertPrices(prices: AssetPrice[]): Promise<void> {
    for (const price of prices) {
      const list = this.prices.get(price.assetId) ?? [];
      push(list, price);
      this.prices.set(price.assetId, list);
    }
  }

  async insertSnapshots(rows: { assetId: string; data: NormalizedMarketData }[]): Promise<void> {
    for (const row of rows) {
      const list = this.snapshots.get(row.assetId) ?? [];
      push(list, row.data);
      this.snapshots.set(row.assetId, list);
    }
  }

  async insertMetrics(metrics: MarketMetrics[]): Promise<void> {
    for (const metric of metrics) {
      const list = this.metrics.get(metric.assetId) ?? [];
      push(list, metric);
      this.metrics.set(metric.assetId, list);
    }
  }

  async insertScores(scores: StrataScore[]): Promise<void> {
    for (const score of scores) {
      const list = this.scores.get(score.assetId) ?? [];
      push(list, score);
      this.scores.set(score.assetId, list);
    }
  }

  private last<T>(map: Map<string, T[]>, assetId: string): T | null {
    const list = map.get(assetId);
    return list && list.length > 0 ? (list[list.length - 1] as T) : null;
  }

  private buildRow(asset: Asset): LatestMarketRow {
    return {
      asset,
      price: this.last(this.prices, asset.id),
      metrics: this.last(this.metrics, asset.id),
      score: this.last(this.scores, asset.id),
      snapshot: this.last(this.snapshots, asset.id),
    };
  }

  async getLatestMarketRows(filter?: AssetFilter): Promise<LatestMarketRow[]> {
    const assets = await this.listAssets(filter);
    return assets.map((asset) => this.buildRow(asset));
  }

  async getLatestMarketRow(assetId: string): Promise<LatestMarketRow | null> {
    const asset = this.assets.get(assetId);
    return asset ? this.buildRow(asset) : null;
  }

  async getMetricsHistory(assetId: string, limit: number): Promise<MarketMetrics[]> {
    return (this.metrics.get(assetId) ?? []).slice(-limit).reverse();
  }

  async getScoreHistory(assetId: string, limit: number): Promise<StrataScore[]> {
    return (this.scores.get(assetId) ?? []).slice(-limit).reverse();
  }

  async insertSignals(signals: Signal[]): Promise<void> {
    this.signals = [...signals.map((s) => ({ ...s, id: s.id ?? randomUUID() })), ...this.signals]
      .slice(0, 500);
  }

  async listSignals(filter?: SignalFilter): Promise<Signal[]> {
    let out = this.signals;
    if (filter?.assetId) out = out.filter((s) => s.assetId === filter.assetId);
    if (filter?.signalType) out = out.filter((s) => s.signalType === filter.signalType);
    if (filter?.assetType) {
      out = out.filter((s) => this.assets.get(s.assetId)?.assetType === filter.assetType);
    }
    if (filter?.since) {
      const since = new Date(filter.since).getTime();
      out = out.filter((s) => new Date(s.timestamp).getTime() >= since);
    }
    return out.slice(0, filter?.limit ?? 100);
  }

  async saveRankingSnapshot(snapshot: RankingSnapshot): Promise<void> {
    this.rankSnapshots.set(
      `${snapshot.metric}:${snapshot.assetType}`,
      new Map(snapshot.entries.map((e) => [e.assetId, e.rank])),
    );

    // history as well as the latest position, so rank movement can be judged
    // against how this asset's rank usually behaves
    for (const entry of snapshot.entries) {
      const key = `${snapshot.metric}:${snapshot.assetType}:${entry.assetId}`;
      const existing = this.rankHistory.get(key) ?? [];
      this.rankHistory.set(
        key,
        [{ timestamp: snapshot.timestamp, rank: entry.rank }, ...existing].slice(0, 500),
      );
    }
  }

  async getRankHistory(
    assetId: string,
    metric: string,
    assetType: AssetType | "all",
    limit: number,
  ): Promise<{ timestamp: string; rank: number }[]> {
    return (this.rankHistory.get(`${metric}:${assetType}:${assetId}`) ?? []).slice(0, limit);
  }

  async getPreviousRanks(
    metric: string,
    assetType: AssetType | "all",
  ): Promise<Map<string, number>> {
    return this.rankSnapshots.get(`${metric}:${assetType}`) ?? new Map();
  }

  async createArenaRound(round: Omit<ArenaRound, "id" | "createdAt">): Promise<ArenaRound> {
    const created: ArenaRound = { ...round, id: randomUUID(), createdAt: nowIso() };
    this.rounds.set(created.id, created);
    return created;
  }

  async getArenaRound(roundNumber: number): Promise<ArenaRound | null> {
    return [...this.rounds.values()].find((r) => r.roundNumber === roundNumber) ?? null;
  }

  async getCurrentArenaRound(): Promise<ArenaRound | null> {
    const ordered = [...this.rounds.values()].sort((a, b) => b.roundNumber - a.roundNumber);
    return ordered.find((r) => r.status === "active") ?? ordered[0] ?? null;
  }

  async listArenaRounds(limit: number): Promise<ArenaRound[]> {
    return [...this.rounds.values()]
      .sort((a, b) => b.roundNumber - a.roundNumber)
      .slice(0, limit);
  }

  async upsertArenaEntries(entries: ArenaEntry[]): Promise<void> {
    for (const entry of entries) {
      const list = this.entries.get(entry.roundId) ?? [];
      const index = list.findIndex((e) => e.assetId === entry.assetId);
      const stored: ArenaEntry = { ...entry, id: entry.id ?? randomUUID() };
      if (index >= 0) list[index] = stored;
      else list.push(stored);
      this.entries.set(entry.roundId, list);
    }
  }

  async listArenaEntries(roundId: string): Promise<ArenaEntry[]> {
    return [...(this.entries.get(roundId) ?? [])].sort((a, b) => a.rank - b.rank);
  }

  /* ---- history ---------------------------------------------------------- */

  async getObservationHistory(assetId: string, limit: number): Promise<Observation[]> {
    // Live snapshots carry the full observation; backfilled points fill in the
    // window before polling began. Joined here and nowhere else, so the two
    // series can never be confused for one another outside this method.
    const live: Observation[] = (this.snapshots.get(assetId) ?? []).map((snapshot) => ({
      timestamp: snapshot.timestamp,
      price: snapshot.price,
      volume24h: snapshot.volume24h,
      liquidity: snapshot.liquidity,
      tradeCount24h: snapshot.tradeCount24h,
      uniqueParticipants24h: snapshot.uniqueParticipants24h,
    }));

    const fallback: Observation[] =
      live.length === 0
        ? (this.prices.get(assetId) ?? []).map((price) => ({
            timestamp: price.timestamp,
            price: price.price,
            volume24h: price.volume24h,
            liquidity: null,
            tradeCount24h: null,
            uniqueParticipants24h: null,
          }))
        : [];

    const liveSeries = live.length > 0 ? live : fallback;
    const seen = new Set(liveSeries.map((point) => point.timestamp));

    return [
      ...(this.backfilled.get(assetId) ?? []).filter((point) => !seen.has(point.timestamp)),
      ...liveSeries,
    ]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(-limit);
  }

  async backfillObservations(assetId: string, points: Observation[]): Promise<number> {
    const existingLive = new Set(
      (this.snapshots.get(assetId) ?? []).map((snapshot) => snapshot.timestamp),
    );
    const existingBackfill = this.backfilled.get(assetId) ?? [];
    const seen = new Set([
      ...existingLive,
      ...existingBackfill.map((point) => point.timestamp),
    ]);

    // Merge on timestamp against both series. A point already covered by a
    // live poll is dropped: duplicating an observation would double its
    // weight in every baseline computed from the series.
    const additions = points.filter((point) => !seen.has(point.timestamp));
    if (additions.length === 0) return 0;

    const merged = [...existingBackfill, ...additions].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    if (merged.length > HISTORY_LIMIT) merged.splice(0, merged.length - HISTORY_LIMIT);

    this.backfilled.set(assetId, merged);
    return additions.length;
  }

  /* ---- intelligence ----------------------------------------------------- */

  async insertIntelligence(records: AssetIntelligence[]): Promise<void> {
    for (const record of records) {
      const list = this.intelligence.get(record.assetId) ?? [];
      push(list, record);
      this.intelligence.set(record.assetId, list);
    }
  }

  async getLatestIntelligence(assetId: string): Promise<AssetIntelligence | null> {
    return this.last(this.intelligence, assetId);
  }

  async listLatestIntelligence(filter?: AssetFilter): Promise<AssetIntelligence[]> {
    const assets = await this.listAssets(filter);
    const out: AssetIntelligence[] = [];
    for (const asset of assets) {
      const latest = this.last(this.intelligence, asset.id);
      if (latest) out.push(latest);
    }
    return out;
  }

  async getDetectionSeries(
    sinceMinutes: number,
    perAssetLimit: number,
  ): Promise<DetectionSeriesPoint[]> {
    const cutoff = Date.now() - sinceMinutes * 60_000;
    const points: DetectionSeriesPoint[] = [];

    for (const [assetId, records] of this.intelligence) {
      const recent = records
        .filter((record) => new Date(record.timestamp).getTime() >= cutoff)
        .slice(-perAssetLimit);

      for (const record of recent) {
        points.push({
          assetId,
          timestamp: record.timestamp,
          score: record.score.score,
          momentum: record.engines.momentum.score,
          trend: record.engines.trend.score,
          volume: record.engines.volume.score,
        });
      }
    }
    return points;
  }

  async getRankSeries(
    metric: string,
    assetType: AssetType | "all",
    sinceMinutes: number,
  ): Promise<RankSeriesPoint[]> {
    const cutoff = Date.now() - sinceMinutes * 60_000;
    const prefix = `${metric}:${assetType}:`;
    const points: RankSeriesPoint[] = [];

    for (const [key, history] of this.rankHistory) {
      if (!key.startsWith(prefix)) continue;
      const assetId = key.slice(prefix.length);
      for (const point of history) {
        if (new Date(point.timestamp).getTime() < cutoff) continue;
        points.push({ assetId, timestamp: point.timestamp, rank: point.rank });
      }
    }
    return points;
  }

  async getIntelligenceHistory(assetId: string, limit: number): Promise<AssetIntelligence[]> {
    return (this.intelligence.get(assetId) ?? []).slice(-limit).reverse();
  }

  async getArenaRoundById(roundId: string): Promise<ArenaRound | null> {
    return this.rounds.get(roundId) ?? null;
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
    const round = this.rounds.get(roundId);
    if (!round) return null;
    const settled: ArenaRound = { ...round, status: "settled", ...outcome };
    this.rounds.set(roundId, settled);
    return settled;
  }

  async insertArenaEvents(events: ArenaEvent[]): Promise<void> {
    for (const event of events) {
      const list = this.arenaEvents.get(event.roundId) ?? [];
      list.push({ ...event, id: event.id ?? randomUUID() });
      // a round's own history is bounded, but generously: it is the record
      // the history view reads back
      if (list.length > 500) list.splice(0, list.length - 500);
      this.arenaEvents.set(event.roundId, list);
    }
  }

  async listArenaEvents(roundId: string, limit: number): Promise<ArenaEvent[]> {
    return [...(this.arenaEvents.get(roundId) ?? [])].reverse().slice(0, limit);
  }

  async getPersistedStats(): Promise<PersistedStats> {
    // Backfilled points are counted too. In Postgres they are ordinary rows
    // in market_snapshots with source='backfill', so a memory store that
    // omitted them would report a different number for the same data and
    // make the two implementations disagree about what is stored.
    const backfilled = [...this.backfilled.values()].flat();
    const snapshots = [...this.snapshots.values()].flat();
    const scores = [...this.scores.values()].flat();
    const latest = (values: string[]): string | null =>
      values.length === 0 ? null : values.sort().at(-1) ?? null;

    return {
      lastIngestionAt: latest([
        ...snapshots.map((s) => s.retrievedAt ?? s.timestamp),
        ...backfilled.map((s) => s.timestamp),
      ]),
      lastComputationAt: latest(scores.map((s) => s.timestamp)),
      assetsTracked: this.assets.size,
      marketSnapshots: snapshots.length + backfilled.length,
      scoresComputed: scores.length,
      signalsGenerated: this.signals.length,
      computeEvents: this.computeEvents.length,
    };
  }

  async insertCalibrations(snapshots: CalibrationSnapshot[]): Promise<void> {
    this.calibrations = [...snapshots, ...this.calibrations].slice(0, 200);
  }

  async listCalibrations(limit: number): Promise<CalibrationSnapshot[]> {
    return this.calibrations.slice(0, limit);
  }

  /* ---- intelligence events --------------------------------------------- */

  async upsertIntelligenceEvents(events: IntelligenceEvent[]): Promise<void> {
    for (const event of events) {
      const key = `${event.assetId ?? "market"}:${event.eventType}`;
      const existing = this.intelligenceEvents.get(key);

      // The same identity rule Postgres enforces with a partial unique index:
      // at most one OPEN event per (asset, type). Keeping the original
      // detection time is what lets the feed say how long a condition has held.
      this.intelligenceEvents.set(key, {
        ...event,
        id: existing?.id ?? randomUUID(),
        detectedAt: existing?.detectedAt ?? event.detectedAt,
        firstValue: existing?.firstValue ?? event.firstValue,
      });
    }
  }

  async closeIntelligenceEvents(events: IntelligenceEvent[]): Promise<void> {
    for (const event of events) {
      const key = `${event.assetId ?? "market"}:${event.eventType}`;
      const existing = this.intelligenceEvents.get(key);
      if (!existing) continue;
      this.intelligenceEvents.delete(key);
      this.closedIntelligence = [
        { ...existing, status: event.status, resolvedAt: event.resolvedAt, latestAt: event.latestAt },
        ...this.closedIntelligence,
      ].slice(0, 500);
    }
  }

  async listOpenIntelligenceEvents(): Promise<IntelligenceEvent[]> {
    return [...this.intelligenceEvents.values()].sort((a, b) => b.priority - a.priority);
  }

  async listIntelligenceEvents(
    filter: IntelligenceEventFilter,
  ): Promise<IntelligenceEvent[]> {
    const all = [...this.intelligenceEvents.values(), ...this.closedIntelligence];
    return all
      .filter((e) => {
        if (filter.types && filter.types.length > 0 && !filter.types.includes(e.eventType)) return false;
        if (filter.assetId && e.assetId !== filter.assetId) return false;
        if (filter.assetType && e.assetType !== filter.assetType) return false;
        if (filter.severity && e.severity !== filter.severity) return false;
        if (filter.status && filter.status.length > 0 && !filter.status.includes(e.status)) return false;
        if (filter.since && e.latestAt < filter.since) return false;
        return true;
      })
      .sort((a, b) => b.priority - a.priority || b.latestAt.localeCompare(a.latestAt))
      .slice(0, filter.limit ?? 60);
  }

  async getIntelligenceEvent(id: string): Promise<IntelligenceEvent | null> {
    return (
      [...this.intelligenceEvents.values(), ...this.closedIntelligence].find(
        (e) => e.id === id,
      ) ?? null
    );
  }

  async countIntelligenceEvents(): Promise<{ open: number; resolved: number; total: number }> {
    const open = this.intelligenceEvents.size;
    const resolved = this.closedIntelligence.filter((e) => e.status === "resolved").length;
    return { open, resolved, total: open + this.closedIntelligence.length };
  }

  async insertComputeEvents(events: ComputeEvent[]): Promise<void> {
    this.computeEvents = [...events, ...this.computeEvents].slice(0, 1000);
  }

  async listComputeEvents(limit: number, assetId?: string): Promise<ComputeEvent[]> {
    const filtered = assetId
      ? this.computeEvents.filter((e) => e.assetId === assetId)
      : this.computeEvents;
    return filtered.slice(0, limit);
  }

  async countComputeEventsSince(since: string): Promise<number> {
    const cutoff = new Date(since).getTime();
    return this.computeEvents.filter((e) => new Date(e.createdAt).getTime() >= cutoff).length;
  }
}
