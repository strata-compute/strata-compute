import { syncRoundStandings } from "./arena/service.ts";
import { runIntelligencePass } from "./compute/intelligence.ts";
import { markRunning, recordFailure, recordRun } from "./compute/status.ts";
import { CURRENT_SCORING_VERSION } from "./config/scoring.ts";
import { AGGREGATION, SCORE_VERSION } from "./config/score-v1.ts";
import { getStore } from "./database/index.ts";
import { emit } from "./events/bus.ts";
import type { EventDraft } from "./events/types.ts";
import { markIngestion, runIngestion } from "./ingestion/service.ts";
import {
  computeRegime,
  detectAnomalies,
  detectEarlyMovers,
  type EarlyMoverInput,
} from "./intelligence/market.ts";
import { isMockMode } from "./providers/registry.ts";
import { runIntelligenceDetection } from "./intelligence/pass.ts";
import { rankAssets, toRankMap } from "./rankings/service.ts";
import type { RankableAsset } from "./rankings/service.ts";
import { runDetectors } from "./signals/engine.ts";
import type { DetectorInput } from "./signals/types.ts";
import type {
  Asset,
  ComputeEvent,
  NormalizedMarketData,
  Observation,
} from "./types/domain.ts";
import type {
  EarlyMover,
  MarketRegime,
  MarketRegimeState,
} from "./types/intelligence.ts";
import { describeError, logger } from "./utils/logger.ts";
import { nowIso } from "./utils/time.ts";

/**
 * Composition root for one intelligence pass:
 *
 *   [ingest] → history → features → engines → score
 *            → rank → signals → anomalies → early movers → regime → arena
 *
 * Everything downstream of ingestion reads what the store already holds, so a
 * single provider outage degrades coverage rather than stopping computation
 * for the domains that are healthy.
 *
 * The pass is also the only place that observes change over time. Engines and
 * scores are pure functions of one moment; "the score moved 8 points" is a
 * statement about two moments, and it is made here, from stored history,
 * rather than inferred anywhere else.
 */

/** How many observations each asset's engines may read. */
const HISTORY_WINDOW = 400;

interface PreviousPass {
  market: Map<string, NormalizedMarketData>;
  momentum: Map<string, number>;
  score: Map<string, number>;
  trendSlope: Map<string, number>;
  ranks: Map<string, number>;
  regime: MarketRegimeState | null;
  /** Early-mover stage per asset, for detecting NORMAL -> WATCH -> CONFIRMED. */
  earlyStage: Map<string, string>;
  /** Active signal ids, so expiry can be reported when they drop out. */
  activeSignals: Map<string, string>;
}

let previous: PreviousPass = {
  market: new Map(),
  momentum: new Map(),
  score: new Map(),
  trendSlope: new Map(),
  ranks: new Map(),
  regime: null,
  earlyStage: new Map(),
  activeSignals: new Map(),
};

/**
 * Whether `previous` has been reconstructed from stored state.
 *
 * `previous` is a cache of the last pass, used only to detect change. It is
 * legitimately in-memory — the underlying values all live in Postgres — but
 * an empty cache after a restart means the first pass has nothing to compare
 * against and emits no events at all, silently losing a cycle of change
 * detection. Hydrating it from the database on first run closes that gap.
 */
let hydrated = false;

/**
 * Rebuilds the comparison baseline from the last persisted computation.
 *
 * Read-only and best-effort: if it fails, the pass proceeds with an empty
 * baseline, which is the old behaviour and is safe — it under-reports change
 * rather than inventing it.
 */
async function hydratePreviousFromStore(): Promise<void> {
  if (hydrated) return;
  hydrated = true;

  try {
    const store = getStore();
    const records = await store.listLatestIntelligence({});
    if (records.length === 0) return;

    previous.score = new Map(
      records
        .filter((r) => r.score.score !== null)
        .map((r) => [r.assetId, r.score.score as number]),
    );
    previous.momentum = new Map(
      records
        .filter((r) => r.engines.momentum.score !== null)
        .map((r) => [r.assetId, r.engines.momentum.score as number]),
    );
    previous.trendSlope = new Map(
      records
        .filter((r) => r.engines.trend.slopePctPerDay !== null)
        .map((r) => [r.assetId, r.engines.trend.slopePctPerDay as number]),
    );
    previous.ranks = await store.getPreviousRanks("score", "all");

    logger.info("comparison baseline restored from the database", {
      job: "pipeline",
      scores: previous.score.size,
      ranks: previous.ranks.size,
    });
  } catch (error) {
    logger.warn("could not restore the comparison baseline; first pass will report no change", {
      job: "pipeline",
      ...describeError(error),
    });
  }
}

/** Latest market-level readings, served by the API between passes. */
let latestRegime: MarketRegime | null = null;
let latestEarlyMovers: EarlyMover[] = [];

export function getLatestRegime(): MarketRegime | null {
  return latestRegime;
}

export function getLatestEarlyMovers(): EarlyMover[] {
  return latestEarlyMovers;
}

export interface PipelineOptions {
  skipIngestion?: boolean;
}

export interface PipelineResult {
  ok: boolean;
  assetsProcessed: number;
  assetsScored: number;
  signalsEmitted: number;
  anomaliesDetected: number;
  earlyMovers: number;
  durationMs: number;
  provider: string;
  usingMockData: boolean;
}

interface Subject {
  asset: Asset;
  current: NormalizedMarketData;
  history: Observation[];
}

async function collectSubjects(): Promise<{
  subjects: Subject[];
  provider: string;
  usingMockData: boolean;
}> {
  const store = getStore();
  const rows = await store.getLatestMarketRows({ limit: 500 });
  const sources = new Set<string>();

  const subjects: Subject[] = [];
  for (const row of rows) {
    if (!row.snapshot) continue;
    sources.add(row.snapshot.source);
    subjects.push({
      asset: row.asset,
      current: row.snapshot,
      history: await store.getObservationHistory(row.asset.id, HISTORY_WINDOW),
    });
  }

  return {
    subjects,
    provider: [...sources].sort().join("+") || "none",
    usingMockData: subjects.some((s) => s.current.isMock),
  };
}

/**
 * Change events.
 *
 * A pass emits an event only when a value actually moved by more than a
 * threshold worth reporting. Emitting one per asset per pass would produce a
 * stream that is technically complete and practically unreadable, and would
 * bury the changes that matter under the ones that do not.
 */
function buildEvents(
  records: { assetId: string; symbol: string; score: number | null; momentum: number | null }[],
  ranks: Map<string, number>,
  version: string,
): ComputeEvent[] {
  const events: ComputeEvent[] = [];
  const at = nowIso();

  for (const record of records) {
    const priorScore = previous.score.get(record.assetId);
    if (record.score !== null && priorScore !== undefined) {
      const change = record.score - priorScore;
      if (Math.abs(change) >= 1) {
        events.push({
          assetId: record.assetId,
          eventType: "STRATA_SCORE_CHANGED",
          inputData: { symbol: record.symbol, previousValue: priorScore },
          outputData: { newValue: record.score, change: Number(change.toFixed(2)) },
          computationVersion: version,
          createdAt: at,
        });
      }
    }

    const priorMomentum = previous.momentum.get(record.assetId);
    if (record.momentum !== null && priorMomentum !== undefined) {
      const change = record.momentum - priorMomentum;
      if (Math.abs(change) >= 5) {
        events.push({
          assetId: record.assetId,
          eventType: "MOMENTUM_CHANGED",
          inputData: { symbol: record.symbol, previousValue: priorMomentum },
          outputData: { newValue: record.momentum, change: Number(change.toFixed(2)) },
          computationVersion: version,
          createdAt: at,
        });
      }
    }

    const priorRank = previous.ranks.get(record.assetId);
    const currentRank = ranks.get(record.assetId);
    if (priorRank !== undefined && currentRank !== undefined && priorRank !== currentRank) {
      const change = priorRank - currentRank;
      if (Math.abs(change) >= 3) {
        events.push({
          assetId: record.assetId,
          eventType: "RANK_CHANGED",
          inputData: { symbol: record.symbol, previousValue: priorRank },
          outputData: { newValue: currentRank, change },
          computationVersion: version,
          createdAt: at,
        });
      }
    }
  }

  return events;
}

export async function runPipeline(options: PipelineOptions = {}): Promise<PipelineResult> {
  const started = performance.now();
  const log = logger.child({ job: "pipeline" });
  markRunning();

  const empty = (provider: string, usingMockData: boolean): PipelineResult => ({
    ok: true,
    assetsProcessed: 0,
    assetsScored: 0,
    signalsEmitted: 0,
    anomaliesDetected: 0,
    earlyMovers: 0,
    durationMs: Number((performance.now() - started).toFixed(2)),
    provider,
    usingMockData,
  });

  try {
    const store = getStore();

    if (!options.skipIngestion && isMockMode()) {
      await runIngestion();
      markIngestion();
    }

    await hydratePreviousFromStore();

    const collected = await collectSubjects();
    if (collected.subjects.length === 0) {
      log.info("pipeline pass skipped — no stored observations yet");
      return empty(collected.provider, collected.usingMockData);
    }

    // ---- compute ---------------------------------------------------------
    const pass = runIntelligencePass({
      subjects: collected.subjects,
      previous: {
        momentum: previous.momentum,
        score: previous.score,
        trendSlope: previous.trendSlope,
      },
      version: CURRENT_SCORING_VERSION,
    });

    await store.insertIntelligence(pass.records);

    // The calibration that produced this pass's scores is stored alongside
    // them. Percentiles and the anchoring step are both relative to a
    // population, so without its shape a past score can be recomputed but
    // never verified.
    await store.insertCalibrations(
      [...pass.calibrations.entries()]
        .filter(([, c]) => c.compositeMean !== null)
        .map(([universe, c]) => ({
          scoreVersion: SCORE_VERSION,
          universe,
          sampleSize: c.sampleSize,
          method: "percentile-rank components, sigma-anchored composite",
          compositeMean: c.compositeMean,
          compositeSigma: c.compositeSigma,
          anchored:
            c.compositeSigma !== null && c.compositeSigma >= AGGREGATION.minimumSigma,
          distribution: {
            components: Object.fromEntries(
              Object.entries(c.populations).map(([k, v]) => [k, (v ?? []).length]),
            ),
          },
          createdAt: nowIso(),
        })),
    );
    await store.insertMetrics(pass.metrics);
    await store.insertScores(pass.scores);

    // ---- rank ------------------------------------------------------------
    // Only scored assets are rankable. An asset that reported
    // INSUFFICIENT_DATA is absent from the ranking rather than placed last,
    // which would read as "ranked worst" instead of "not ranked".
    const rankable: RankableAsset[] = [];
    for (const subject of collected.subjects) {
      const record = pass.byAssetId.get(subject.asset.id);
      if (!record || record.score.status !== "OK" || record.score.score === null) continue;
      rankable.push({
        asset: subject.asset,
        intelligence: record,
      });
    }

    const storedRanks = await store.getPreviousRanks("score", "all");
    const ranking = rankAssets(rankable, {
      metric: "score",
      previousRanks: storedRanks.size > 0 ? storedRanks : previous.ranks,
    });
    await store.saveRankingSnapshot(ranking);
    const currentRanks = toRankMap(ranking);

    // ---- signals ---------------------------------------------------------
    const detectorInputs: DetectorInput[] = collected.subjects.map((subject) => {
      const record = pass.byAssetId.get(subject.asset.id);
      return {
        assetId: subject.asset.id,
        symbol: subject.asset.symbol,
        current: subject.current,
        history: subject.history,
        engines: record?.engines,
        classPeers: collected.subjects
          .filter((s) => s.asset.assetType === subject.asset.assetType)
          .map((s) => s.current),
        previous: {
          market: previous.market.get(subject.asset.symbol),
          rank: previous.ranks.get(subject.asset.id),
          score: previous.score.get(subject.asset.id),
          momentum: previous.momentum.get(subject.asset.id),
          trendSlope: previous.trendSlope.get(subject.asset.id),
        },
        rank: currentRanks.get(subject.asset.id),
      };
    });

    const signalRun = runDetectors(detectorInputs);
    await store.insertSignals(signalRun.signals);

    // ---- anomalies -------------------------------------------------------
    const anomalies = collected.subjects.flatMap((subject) =>
      detectAnomalies(
        subject.asset.id,
        subject.asset.symbol,
        subject.current,
        subject.history,
      ),
    );

    // ---- early movers ----------------------------------------------------
    const earlyMoverInputs: EarlyMoverInput[] = [];
    for (const subject of collected.subjects) {
      const record = pass.byAssetId.get(subject.asset.id);
      if (!record) continue;
      earlyMoverInputs.push({ record, current: subject.current, history: subject.history });
    }
    latestEarlyMovers = detectEarlyMovers(earlyMoverInputs);

    // ---- regime ----------------------------------------------------------
    const regime = computeRegime(
      collected.subjects.map((s) => ({
        assetType: s.asset.assetType,
        priceChange24h: s.current.priceChange24h,
      })),
    );
    latestRegime = regime;

    // ---- events ----------------------------------------------------------
    const events = buildEvents(
      pass.records.map((r) => ({
        assetId: r.assetId,
        symbol: r.symbol,
        score: r.score.score,
        momentum: r.engines.momentum.score,
      })),
      currentRanks,
      pass.version,
    );

    for (const anomaly of anomalies) {
      events.push({
        assetId: anomaly.assetId,
        eventType: "ANOMALY_DETECTED",
        inputData: { symbol: anomaly.symbol, kind: anomaly.kind, baseline: anomaly.baseline },
        outputData: { magnitude: anomaly.magnitude, detail: anomaly.detail },
        computationVersion: pass.version,
        createdAt: nowIso(),
      });
    }

    for (const signal of signalRun.signals) {
      events.push({
        assetId: signal.assetId,
        eventType: "SIGNAL_DETECTED",
        inputData: { symbol: signal.symbol, signalType: signal.signalType },
        outputData: { value: signal.value, severity: signal.severity },
        computationVersion: pass.version,
        createdAt: signal.timestamp,
      });
    }

    if (regime.state !== null && regime.state !== previous.regime) {
      events.push({
        assetId: null,
        eventType: "MARKET_REGIME_CHANGED",
        inputData: { previousValue: previous.regime },
        outputData: { newValue: regime.state, drivers: regime.drivers },
        computationVersion: pass.version,
        createdAt: nowIso(),
      });
    }

    await store.insertComputeEvents(events);

    /* ---- real-time delivery -------------------------------------------
     *
     * The same crossings that were just persisted are published to the bus.
     * Nothing here computes anything new: a stream that could invent an event
     * would be a stream that says the market moved when it did not.
     */
    const assetMeta = new Map(
      collected.subjects.map((subject) => [
        subject.asset.id,
        {
          symbol: subject.asset.symbol,
          assetType: subject.asset.assetType,
          logoUrl: subject.asset.logoUrl,
        },
      ]),
    );

    const drafts: EventDraft[] = [];

    for (const record of pass.records) {
      const meta = assetMeta.get(record.assetId);
      if (!meta) continue;

      const priorScore = previous.score.get(record.assetId);
      const score = record.score.score;
      if (score !== null && priorScore !== undefined) {
        const change = Number((score - priorScore).toFixed(2));
        if (Math.abs(change) >= 1) {
          drafts.push({
            eventType: "STRATA_SCORE_CHANGED",
            assetId: record.assetId,
            symbol: meta.symbol,
            assetType: meta.assetType,
            logoUrl: meta.logoUrl,
            previousValue: priorScore,
            newValue: score,
            change,
            severity: Math.abs(change) >= 4 ? "notable" : "info",
            summary: `${meta.symbol} Strata Score ${priorScore.toFixed(1)} \→ ${score.toFixed(1)}`,
            metadata: { confidence: record.score.confidence.value },
          });
        }
      }

      const priorRank = previous.ranks.get(record.assetId);
      const currentRank = currentRanks.get(record.assetId);
      if (priorRank !== undefined && currentRank !== undefined) {
        const movement = priorRank - currentRank;
        if (Math.abs(movement) >= 3) {
          drafts.push({
            eventType: "RANK_CHANGED",
            assetId: record.assetId,
            symbol: meta.symbol,
            assetType: meta.assetType,
            logoUrl: meta.logoUrl,
            previousValue: priorRank,
            newValue: currentRank,
            change: movement,
            severity: Math.abs(movement) >= 8 ? "notable" : "info",
            summary: `${meta.symbol} ${movement > 0 ? "gained" : "lost"} ${Math.abs(movement)} ranking position${Math.abs(movement) === 1 ? "" : "s"} to #${currentRank}`,
            metadata: { score: record.score.score },
          });
        }
      }
    }

    for (const signal of signalRun.signals) {
      const meta = assetMeta.get(signal.assetId);
      drafts.push({
        eventType:
          signal.signalType === "VOLUME_ACCELERATION"
            ? "VOLUME_ACCELERATION"
            : "SIGNAL_DETECTED",
        assetId: signal.assetId,
        symbol: signal.symbol,
        assetType: meta?.assetType ?? null,
        logoUrl: meta?.logoUrl ?? null,
        newValue: signal.value,
        severity: signal.severity === "critical" || signal.severity === "high"
          ? "important"
          : "notable",
        summary: String(
          signal.metadata?.summary ??
            `${signal.symbol} ${signal.signalType.replace(/_/g, " ").toLowerCase()}`,
        ),
        metadata: {
          signalType: signal.signalType,
          signalSeverity: signal.severity,
          expiresAt: signal.expiresAt,
        },
        timestamp: signal.timestamp,
      });
    }

    for (const anomaly of anomalies) {
      const meta = assetMeta.get(anomaly.assetId);
      drafts.push({
        eventType: "ANOMALY_DETECTED",
        assetId: anomaly.assetId,
        symbol: anomaly.symbol,
        assetType: meta?.assetType ?? null,
        logoUrl: meta?.logoUrl ?? null,
        previousValue: anomaly.baseline,
        newValue: anomaly.observed,
        change: anomaly.magnitude,
        severity: "important",
        summary: `${anomaly.symbol}: ${anomaly.detail}`,
        metadata: { kind: anomaly.kind, baselineSamples: anomaly.baselineSamples },
      });
    }

    // Early movers are reported on a *stage transition*, not on presence.
    // Re-announcing the same asset every pass would train a reader to ignore
    // the one signal in the product that is meant to be rare.
    const nextStages = new Map<string, string>();
    for (const mover of latestEarlyMovers) {
      nextStages.set(mover.assetId, mover.stage);
      const priorStage = previous.earlyStage.get(mover.assetId);
      if (priorStage === mover.stage) continue;

      const meta = assetMeta.get(mover.assetId);
      drafts.push({
        eventType: "EARLY_MOVER_DETECTED",
        assetId: mover.assetId,
        symbol: mover.symbol,
        assetType: mover.assetType,
        logoUrl: meta?.logoUrl ?? null,
        previousValue: priorStage ?? "NORMAL",
        newValue: mover.stage,
        change: mover.score,
        severity: mover.stage === "CONFIRMED" ? "important" : "notable",
        summary: `${mover.symbol} entered Early Movers at ${mover.stage}`,
        metadata: { rationale: mover.rationale, score: mover.score },
      });
    }

    if (regime.state !== null && regime.state !== previous.regime) {
      drafts.push({
        eventType: "MARKET_REGIME_CHANGED",
        previousValue: previous.regime,
        newValue: regime.state,
        severity: "important",
        summary: `Market regime ${previous.regime ? `${previous.regime} \→ ${regime.state}` : `set to ${regime.state}`}`,
        metadata: { drivers: regime.drivers, confidence: regime.confidence },
      });
    }

    for (const draft of drafts) emit(draft);

    // ---- intelligence ----------------------------------------------------
    //
    // Runs inside this cycle rather than on a scheduler of its own: a second
    // timer would let intelligence drift out of step with the scores it
    // describes. Reconciliation against open events makes the step
    // idempotent, so repeating a pass updates events rather than duplicating
    // them.
    let intelligence: Awaited<ReturnType<typeof runIntelligenceDetection>> | null = null;
    try {
      intelligence = await runIntelligenceDetection({
        records: pass.records,
        assetsById: new Map(collected.subjects.map((s) => [s.asset.id, s.asset])),
        regime: regime.state,
        medianAbsMove: regime.breadth?.medianAbsMovePct ?? null,
        computationVersion: pass.version,
      });
    } catch (error) {
      // detection failing must not cost the pass its scores, rankings or arena
      log.error("intelligence detection failed", describeError(error));
    }

    // ---- arena -----------------------------------------------------------
    const arena = await syncRoundStandings(rankable);
    if (arena.reason) {
      log.debug("arena did not advance this pass", { reason: arena.reason });
    }

    // ---- carry state forward ---------------------------------------------
    previous = {
      market: new Map(collected.subjects.map((s) => [s.asset.symbol, s.current])),
      momentum: new Map(
        pass.records
          .filter((r) => r.engines.momentum.score !== null)
          .map((r) => [r.assetId, r.engines.momentum.score as number]),
      ),
      score: new Map(
        pass.records
          .filter((r) => r.score.score !== null)
          .map((r) => [r.assetId, r.score.score as number]),
      ),
      trendSlope: new Map(
        pass.records
          .filter((r) => r.engines.trend.slopePctPerDay !== null)
          .map((r) => [r.assetId, r.engines.trend.slopePctPerDay as number]),
      ),
      ranks: currentRanks,
      regime: regime.state,
      earlyStage: nextStages,
      activeSignals: new Map(
        signalRun.signals.map((signal) => [
          `${signal.assetId}:${signal.signalType}`,
          signal.expiresAt,
        ]),
      ),
    };

    const durationMs = Number((performance.now() - started).toFixed(2));

    recordRun(
      {
        version: pass.version,
        startedAt: nowIso(),
        finishedAt: nowIso(),
        processingTimeMs: durationMs,
        assetsProcessed: pass.records.length,
        eventsProcessed: events.length,
        failures: signalRun.failures,
      },
      collected.provider,
      collected.usingMockData,
    );

    log.info("intelligence pass complete", {
      assets: pass.records.length,
      scored: rankable.length,
      insufficient: pass.insufficient.length,
      signals: signalRun.signals.length,
      anomalies: anomalies.length,
      earlyMovers: latestEarlyMovers.length,
      regime: regime.state,
      events: events.length,
      intelligence: intelligence
        ? `${intelligence.created}new/${intelligence.updated}upd/${intelligence.resolved}res/${intelligence.openEvents}open`
        : "failed",
      // reported separately from the pass total: detection reads history per
      // asset, and that cost has to stay visible rather than hide inside it
      intelligenceMs: intelligence?.durationMs ?? null,
      streamed: drafts.length,
      arenaEvents: arena.events.length,
      durationMs,
      computation: pass.version,
    });

    return {
      ok: true,
      assetsProcessed: pass.records.length,
      assetsScored: rankable.length,
      signalsEmitted: signalRun.signals.length,
      anomaliesDetected: anomalies.length,
      earlyMovers: latestEarlyMovers.length,
      durationMs,
      provider: collected.provider,
      usingMockData: collected.usingMockData,
    };
  } catch (error) {
    recordFailure("unknown");
    log.error("pipeline pass failed", describeError(error));
    return { ...empty("unknown", false), ok: false };
  }
}

export function getCurrentRanks(): Map<string, number> {
  return previous.ranks;
}
