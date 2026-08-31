import { WINDOW_PREFERENCE } from "../config/intelligence.ts";
import { universeFor, type ScoreUniverse } from "../config/score-v1.ts";
import { getStore } from "../database/index.ts";
import type { AssetIntelligence, Asset } from "../types/domain.ts";
import type {
  DetectionResult,
  IntelligenceEvent,
  InsufficientHistory,
} from "../types/intelligence-events.ts";
import { describeError, logger } from "../utils/logger.ts";
import { ASSET_DETECTORS, isDetection, type DetectorInput } from "./detectors.ts";
import {
  breadthOf,
  detectRegimeShift,
  detectRotation,
  type MarketRegimeState,
  type UniverseSnapshot,
} from "./market-detectors.ts";
import { eventKey, reconcile } from "./engine.ts";
import { bestWindow, type TimedValue } from "./windows.ts";

/**
 * THE INTELLIGENCE PASS
 *
 * Runs after scoring, inside the existing pipeline cycle. It introduces no
 * scheduler of its own — the spec's rule, and the right one: a second timer
 * would let intelligence drift out of step with the scores it describes.
 *
 * The shape is:
 *
 *   read history → run detectors → reconcile against open events → persist
 *
 * Reconciliation is what makes the pass idempotent. Running it repeatedly
 * against unchanged inputs updates the same events rather than creating new
 * ones, and the database enforces that with a partial unique index so it
 * holds even if this code is wrong.
 */

/** Observations read per asset. Bounded: history is not loaded wholesale. */
const HISTORY_LIMIT = 240;

/**
 * How far back the pass reads.
 *
 * The widest comparison window is four hours, so six hours is enough to fill
 * it with room for gaps. Reading further would cost bandwidth on points no
 * detector can use.
 */
const HISTORY_MINUTES = 360;

/**
 * The ranking the rank detectors read.
 *
 * One ranking, named once: a rank event that silently compared positions in
 * the momentum table while calling itself a rank change would be unreadable.
 */
const RANK_METRIC = "score";
const RANK_UNIVERSE = "all" as const;

interface PassState {
  /** Consecutive passes each condition has been observed, by event key. */
  observations: Map<string, number>;
  /** Previous trend classification per asset. */
  trendState: Map<string, string>;
  /** Previous market regime, and how long the current one has held. */
  regime: MarketRegimeState | null;
  regimeHeldFor: number;
  /** Consecutive passes rotation has been observed. */
  rotationObservations: number;
}

let state: PassState = {
  observations: new Map(),
  trendState: new Map(),
  regime: null,
  regimeHeldFor: 0,
  rotationObservations: 0,
};

export interface IntelligencePassResult {
  detections: number;
  created: number;
  updated: number;
  resolved: number;
  expired: number;
  insufficient: number;
  openEvents: number;
  durationMs: number;
}

export interface IntelligencePassInput {
  records: AssetIntelligence[];
  assetsById: Map<string, Asset>;
  regime: MarketRegimeState | null;
  medianAbsMove: number | null;
  computationVersion: string;
}

/**
 * Turns stored points into the series a detector reads: oldest first, and
 * with unmeasurable points dropped rather than substituted.
 *
 * A null component is "could not be computed", so it is absent from the
 * series. Filling it with a zero or the previous value would invent history,
 * and every baseline downstream would inherit the invention.
 */
function seriesFrom<T>(
  points: T[],
  at: (point: T) => string,
  pick: (point: T) => number | null,
): TimedValue[] {
  const series: TimedValue[] = [];
  for (const point of points) {
    const value = pick(point);
    if (value === null) continue;
    series.push({ timestamp: at(point), value });
  }
  return series.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

/** Groups flat store rows by asset, preserving order. */
function groupByAsset<T extends { assetId: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.assetId);
    if (existing) existing.push(row);
    else grouped.set(row.assetId, [row]);
  }
  return grouped;
}

export async function runIntelligenceDetection(
  input: IntelligencePassInput,
): Promise<IntelligencePassResult> {
  const started = performance.now();
  const store = getStore();
  const now = Date.now();

  const open = await store.listOpenIntelligenceEvents();
  const openByKey = new Map(open.map((e) => [eventKey(e.assetId, e.eventType), e]));

  // Two reads for the whole pass, not two per asset. Detection is a
  // read-heavy step over dozens of assets, and issuing a round trip each
  // turned a pass that computes in under a second into one that spent
  // minutes waiting on the network.
  const [seriesRows, rankRows] = await Promise.all([
    store.getDetectionSeries(HISTORY_MINUTES, HISTORY_LIMIT),
    store.getRankSeries(RANK_METRIC, RANK_UNIVERSE, HISTORY_MINUTES),
  ]);
  const seriesByAsset = groupByAsset(seriesRows);
  const ranksByAsset = groupByAsset(rankRows);

  const detections: DetectionResult[] = [];
  /**
   * Score change per asset over its own comparison window.
   *
   * Collected here, while each asset's history is already in hand, because
   * the market-level detectors need the same numbers. Reading the history a
   * second time per universe would multiply the pass's database work by the
   * number of universes for figures already computed.
   */
  const windowChangeByAsset = new Map<string, number>();
  const insufficient: InsufficientHistory[] = [];

  /* ---- per-asset detection ---------------------------------------------- */

  for (const record of input.records) {
    if (record.score.status !== "OK") continue;

    const history = seriesByAsset.get(record.assetId) ?? [];
    if (history.length === 0) continue;

    const asset = input.assetsById.get(record.assetId);
    if (!asset) continue;

    // Seeded from the open-event store rather than from process memory, so
    // an event's persistence survives a restart instead of resetting to one.
    const priorObservations: Record<string, number> = {};
    for (const [key, event] of openByKey) {
      if (!key.startsWith(`${record.assetId}:`)) continue;
      priorObservations[event.eventType] = event.observations;
    }

    const detectorInput: DetectorInput = {
      assetId: record.assetId,
      symbol: record.symbol,
      assetType: record.assetType,
      scoreSeries: seriesFrom(history, (r) => r.timestamp, (r) => r.score),
      momentumSeries: seriesFrom(history, (r) => r.timestamp, (r) => r.momentum),
      trendSeries: seriesFrom(history, (r) => r.timestamp, (r) => r.trend),
      volumeSeries: seriesFrom(history, (r) => r.timestamp, (r) => r.volume),
      rankSeries: [],
      components: record.score.components,
      dataConfidence: record.score.confidence.value,
      trendState: record.engines.trend.state,
      trendFitQuality: record.engines.trend.fitQuality,
      previousTrendState: state.trendState.get(record.assetId) ?? null,
      priorObservations,
      now,
    };

    // Rank history lives in the ranking snapshots rather than the
    // intelligence rows, so it is read separately and stitched onto the same
    // input. A single current rank would leave both rank detectors
    // permanently reporting insufficient history.
    detectorInput.rankSeries = seriesFrom(
      ranksByAsset.get(record.assetId) ?? [],
      (row) => row.timestamp,
      (row) => row.rank,
    );

    const scoreWindow = bestWindow(detectorInput.scoreSeries, now);
    if (scoreWindow.ok) {
      windowChangeByAsset.set(
        record.assetId,
        scoreWindow.stats.last - scoreWindow.stats.first,
      );
    }

    for (const detector of ASSET_DETECTORS) {
      try {
        const outcome = detector(detectorInput);
        if (isDetection(outcome)) detections.push(outcome);
        else insufficient.push(outcome);
      } catch (error) {
        // one faulty detector must not stop the pass
        logger.warn("intelligence detector failed", {
          asset: record.symbol,
          ...describeError(error),
        });
      }
    }

    if (record.engines.trend.state) {
      state.trendState.set(record.assetId, record.engines.trend.state);
    }
  }

  /* ---- market-level detection ------------------------------------------- */

  const universes = new Map<ScoreUniverse, UniverseSnapshot>();
  for (const record of input.records) {
    if (record.score.status !== "OK" || record.score.score === null) continue;
    const universe = universeFor(record.assetType);
    const existing = universes.get(universe) ?? {
      universe,
      assetType: record.assetType,
      scores: [],
      changes: [],
      size: 0,
    };
    existing.scores.push(record.score.score);
    existing.size += 1;
    universes.set(universe, existing);
  }

  // Per-universe score change, assembled from the per-asset figures already
  // measured above. An asset whose history could not support a window is
  // absent rather than counted as unchanged: "we could not tell" and "it did
  // not move" are different, and breadth is meaningless if they are conflated.
  for (const [universe, snapshot] of universes) {
    const changes: number[] = [];
    for (const record of input.records) {
      if (universeFor(record.assetType) !== universe) continue;
      const change = windowChangeByAsset.get(record.assetId);
      if (change === undefined) continue;
      changes.push(change);
    }
    snapshot.changes = changes;
  }

  const meanConfidence =
    input.records.length === 0
      ? 0
      : input.records.reduce((s, r) => s + r.score.confidence.value, 0) /
        input.records.length;

  const rotation = detectRotation({
    universes: [...universes.values()],
    priorObservations: state.rotationObservations,
    dataConfidence: meanConfidence,
    window: WINDOW_PREFERENCE[0] ?? "4h",
  });

  if ("reason" in rotation) {
    insufficient.push(rotation);
    state.rotationObservations = 0;
  } else {
    detections.push(rotation);
    state.rotationObservations += 1;
  }

  const allChanges = [...universes.values()].flatMap((u) => u.changes);
  const breadth = breadthOf(allChanges);

  // how long has the current regime held?
  if (input.regime !== null && input.regime === state.regime) {
    state.regimeHeldFor += 1;
  } else if (input.regime !== null) {
    state.regimeHeldFor = 1;
  }

  const regimeShift = detectRegimeShift({
    current: input.regime,
    previous: state.regime,
    consecutivePasses: state.regimeHeldFor,
    breadth,
    medianAbsMove: input.medianAbsMove,
    dataConfidence: meanConfidence,
    coveredAssets: input.records.length,
  });

  if ("reason" in regimeShift) insufficient.push(regimeShift);
  else detections.push(regimeShift);

  // only advance the remembered regime once the shift has been reported, so
  // the comparison survives until it is acted on
  if (input.regime !== null && state.regimeHeldFor >= 1 && !("reason" in regimeShift)) {
    state.regime = input.regime;
    state.regimeHeldFor = 1;
  } else if (state.regime === null) {
    state.regime = input.regime;
  }

  /* ---- reconcile and persist -------------------------------------------- */

  const result = reconcile({
    detections,
    open: openByKey,
    computationVersion: input.computationVersion,
  });

  await store.upsertIntelligenceEvents(result.upserts);
  await store.closeIntelligenceEvents([...result.resolved, ...result.expired]);

  const counts = await store.countIntelligenceEvents();

  return {
    detections: detections.length,
    created: result.created,
    updated: result.updated,
    resolved: result.resolved.length,
    expired: result.expired.length,
    insufficient: insufficient.length,
    openEvents: counts.open,
    durationMs: Number((performance.now() - started).toFixed(2)),
  };
}

/** Test seam. Never called by the service. */
export function __resetIntelligenceState(): void {
  state = {
    observations: new Map(),
    trendState: new Map(),
    regime: null,
    regimeHeldFor: 0,
    rotationObservations: 0,
  };
}

export type { IntelligenceEvent };
