import {
  CURRENT_SCORING_VERSION,
  benchmarkFor,
  scoringConfig,
} from "../config/scoring.ts";
import type {
  Asset,
  AssetIntelligence,
  MarketMetrics,
  NormalizedMarketData,
  Observation,
  StrataScore,
} from "../types/domain.ts";
import type { EngineOutputs, StrataScoreResult } from "../types/intelligence.ts";
import { nowIso } from "../utils/time.ts";
import { buildFeatures } from "./features/index.ts";
import { medianOf } from "./features/series.ts";
import { runEngines } from "./engines/index.ts";
import {
  buildCalibrations,
  buildComposite,
  computeCalibratedScore,
  resolveUniverse,
  type CalibratedScore,
  type UniverseCalibration,
} from "./score/calibrate.ts";
import type { ScoreUniverse } from "../config/score-v1.ts";
import { mean as meanOf, stdDev } from "./features/series.ts";

/**
 * THE INTELLIGENCE PASS
 *
 * Assembles one complete computation for every asset in a pass:
 *
 *   observation + history + peers
 *     → features → engines → score → persisted record
 *
 * Two things are centralised here on purpose.
 *
 * The benchmark for each class is computed once per pass rather than once per
 * asset. Beyond the obvious cost saving, it guarantees every member of a
 * class is measured against exactly the same benchmark — if each asset
 * derived its own, an asset would be silently excluded from or included in
 * its own comparison group depending on iteration order, and relative
 * strength would stop being comparable across the very set it ranks.
 *
 * And the pass is deterministic. No clock is read inside a computation, no
 * value depends on the order assets happen to arrive in, and the same stored
 * inputs produce the same output on every run. That is what makes a score
 * reproducible from history rather than merely repeatable in the moment.
 */

export interface IntelligencePassInput {
  /** Current observation per asset, with the asset record it belongs to. */
  subjects: {
    asset: Asset;
    current: NormalizedMarketData;
    history: Observation[];
  }[];
  /** Previous pass state, for change reporting. */
  previous?: {
    momentum: Map<string, number>;
    score: Map<string, number>;
    trendSlope: Map<string, number>;
  };
  version?: string;
}

export interface IntelligencePassResult {
  /** Universe shapes measured this pass, for the calibration snapshot. */
  calibrations: Map<ScoreUniverse, UniverseCalibration>;
  records: AssetIntelligence[];
  metrics: MarketMetrics[];
  scores: StrataScore[];
  byAssetId: Map<string, AssetIntelligence>;
  bySymbol: Map<string, AssetIntelligence>;
  /** Assets that ran but could not be scored, with the reason. */
  insufficient: { symbol: string; reason: string }[];
  version: string;
}

/** Benchmark return for one class: the median 24h move of its members. */
function benchmarkReturns(
  subjects: IntelligencePassInput["subjects"],
): Map<string, number | null> {
  const byClass = new Map<string, number[]>();

  for (const subject of subjects) {
    const change = subject.current.priceChange24h;
    if (change === null) continue;
    const list = byClass.get(subject.asset.assetType) ?? [];
    list.push(change);
    byClass.set(subject.asset.assetType, list);
  }

  const out = new Map<string, number | null>();
  for (const [assetType, changes] of byClass) {
    const group = benchmarkFor(assetType as Asset["assetType"]);
    // a benchmark built from too few members describes the members, not a
    // market, so it is withheld rather than published as one
    if (!group || changes.length < group.minimumMembers) {
      out.set(assetType, null);
      continue;
    }
    out.set(assetType, medianOf(changes));
  }
  return out;
}

function ageSecondsOf(record: NormalizedMarketData, evaluatedAt: number): number | null {
  const stamp = record.sourceTimestamp ?? record.timestamp;
  if (!stamp) return null;
  const parsed = new Date(stamp).getTime();
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.round((evaluatedAt - parsed) / 1000));
}

function metricsFrom(assetId: string, engines: EngineOutputs, at: string): MarketMetrics {
  return {
    assetId,
    momentum: engines.momentum.score,
    volumeStrength: engines.volume.score,
    activity: engines.activity.score,
    liquidityStrength: engines.liquidity.score,
    relativeStrength: engines.relativeStrength.score,
    trend: engines.trend.score,
    volatility: engines.volatility.score,
    timestamp: at,
  };
}

function scoreFrom(
  assetId: string,
  result: CalibratedScore,
  sources: string[],
  at: string,
): StrataScore {
  return {
    assetId,
    score: result.score,
    status: result.status,
    confidence: result.confidence.value,
    version: result.version,
    // The scoring method travels with the row, separately from the engine
    // version. A score produced by the uncalibrated method must never read
    // back as though it had been calibrated.
    scoreVersion: result.scoreVersion,
    scoreUniverse: result.scoreUniverse,
    timestamp: at,
    sources,
  };
}

export function runIntelligencePass(
  input: IntelligencePassInput,
): IntelligencePassResult {
  const version = input.version ?? CURRENT_SCORING_VERSION;
  const config = scoringConfig(version);
  const at = nowIso();
  // one instant for the whole pass: every asset is measured against the same
  // moment rather than against whenever the loop reached it
  const evaluatedAt = new Date(at).getTime();

  const benchmarks = benchmarkReturns(input.subjects);

  // Peer distributions are built once per class, from the whole pass, so
  // every cross-sectional reading is taken against the identical population.
  const peersByClass = new Map<
    string,
    { volumes: number[]; changes: number[]; activity: number[] }
  >();
  for (const subject of input.subjects) {
    const key = subject.asset.assetType;
    const bucket = peersByClass.get(key) ?? { volumes: [], changes: [], activity: [] };
    const { volume24h, priceChange24h, tradeCount24h, uniqueParticipants24h } =
      subject.current;
    if (volume24h !== null && volume24h > 0) bucket.volumes.push(volume24h);
    if (priceChange24h !== null) bucket.changes.push(priceChange24h);
    const activity = tradeCount24h ?? uniqueParticipants24h;
    if (activity !== null && activity > 0) bucket.activity.push(activity);
    peersByClass.set(key, bucket);
  }

  /**
   * Engines first, for every asset, before anything is scored.
   *
   * Scoring is now relative: a component becomes its percentile within the
   * universe, and the composite is expressed against that universe's
   * dispersion. Neither is knowable while walking the assets one at a time,
   * so the readings are gathered in full before any of them is ranked.
   *
   * The alternative — scoring each asset as it arrives — would make a score
   * depend on how many peers happened to be processed first, which is not a
   * property any comparable measure can have.
   */
  const enginesBySubject = new Map<string, EngineOutputs>();
  for (const subject of input.subjects) {
    const { asset, current, history } = subject;
    const peers = peersByClass.get(asset.assetType) ?? {
      volumes: [],
      changes: [],
      activity: [],
    };

    const features = buildFeatures({
      current,
      history,
      benchmarkChange24h: benchmarks.get(asset.assetType) ?? null,
      peerVolumes: peers.volumes,
      peerChanges: peers.changes,
      now: evaluatedAt,
    });

    enginesBySubject.set(
      asset.id,
      runEngines(
        {
          current,
          features,
          history,
          peerVolumes: peers.volumes,
          peerChanges: peers.changes,
          peerActivity: peers.activity,
          previousMomentum: input.previous?.momentum.get(asset.id) ?? null,
        },
        asset.assetType,
      ),
    );
  }

  const calibrations = buildCalibrations(
    input.subjects.map((subject) => ({
      assetId: subject.asset.id,
      assetType: subject.asset.assetType,
      engines: enginesBySubject.get(subject.asset.id) as EngineOutputs,
    })),
  );

  // measure each universe's composite dispersion, so the anchoring step has
  // something real to anchor against
  const compositesByUniverse = new Map<ScoreUniverse, number[]>();
  for (const subject of input.subjects) {
    const engines = enginesBySubject.get(subject.asset.id) as EngineOutputs;
    const { universe } = resolveUniverse(subject.asset.assetType, calibrations);
    const calibration = calibrations.get(universe);
    if (!calibration) continue;

    const built = buildComposite(engines, calibration);
    if (built.composite === null) continue;
    compositesByUniverse.set(universe, [
      ...(compositesByUniverse.get(universe) ?? []),
      built.composite,
    ]);
  }

  for (const [universe, composites] of compositesByUniverse) {
    const calibration = calibrations.get(universe);
    if (!calibration) continue;
    calibration.compositeMean = meanOf(composites);
    calibration.compositeSigma = stdDev(composites);
  }

  const records: AssetIntelligence[] = [];
  const metrics: MarketMetrics[] = [];
  const scores: StrataScore[] = [];
  const insufficient: { symbol: string; reason: string }[] = [];

  for (const subject of input.subjects) {
    const { asset, current, history } = subject;
    const engines = enginesBySubject.get(asset.id) as EngineOutputs;
    const ageSeconds = ageSecondsOf(current, evaluatedAt);

    const score = computeCalibratedScore({
      assetType: asset.assetType,
      engines,
      ageSeconds,
      historyPoints: history.length,
      calibrations,
    });

    if (score.status === "INSUFFICIENT_DATA") {
      insufficient.push({
        symbol: asset.symbol,
        reason: score.insufficientReason ?? "unspecified",
      });
    }

    const record: AssetIntelligence = {
      assetId: asset.id,
      symbol: asset.symbol,
      assetType: asset.assetType,
      score,
      engines,
      historyPoints: history.length,
      ageSeconds,
      sources: [current.source],
      timestamp: at,
    };

    records.push(record);
    metrics.push(metricsFrom(asset.id, engines, at));
    scores.push(scoreFrom(asset.id, score, [current.source], at));
  }

  return {
    calibrations,
    records,
    metrics,
    scores,
    byAssetId: new Map(records.map((r) => [r.assetId, r])),
    bySymbol: new Map(records.map((r) => [r.symbol, r])),
    insufficient,
    version,
  };
}
