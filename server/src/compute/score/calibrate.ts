import {
  AGGREGATION,
  CONFIDENCE,
  COMPONENT_KEYS,
  bucketFor,
  componentConfig,
  SCORE_VERSION,
  universeConfig,
  universeFor,
  type ScoreComponentKey,
  type ScoreUniverse,
} from "../../config/score-v1.ts";
import type { AssetType } from "../../types/domain.ts";
import type {
  ConfidenceBand,
  EngineOutputs,
  ScoreConfidence,
  ScoreDriver,
  StrataScoreResult,
} from "../../types/intelligence.ts";
import { clamp, round } from "../../utils/number.ts";
import { nowIso } from "../../utils/time.ts";

/**
 * CALIBRATED SCORING
 *
 * Two stages, both relative, neither cosmetic.
 *
 * A component becomes its PERCENTILE RANK within the asset's universe. This
 * is what makes a 3% move in an equity comparable with a 3% move in a small
 * onchain token: neither number is used, only their standing among peers
 * measured the same way. It is also inherently robust — one asset with
 * absurd volume takes the top rank and leaves the rest of the distribution
 * exactly where it was, whereas the min/max scaling this replaces would have
 * crushed every other asset toward zero.
 *
 * The weighted composite is then expressed against the universe's own
 * dispersion. Averaging k roughly-uniform ranks shrinks spread by about √k,
 * so a composite of seven percentiles clusters near 50 no matter how
 * different the assets are. Re-expressing it in standard deviations restores
 * the separation that exists in the data — and only that. A universe whose
 * members genuinely resemble each other has a small sigma and keeps its
 * scores close together.
 *
 * Nothing here multiplies a score to fill the scale, and no asset is
 * special-cased. Every parameter lives in config/score-v1.ts.
 */

/* ------------------------------------------------------------ percentile -- */

/**
 * Rank of `value` within `population`, 0–100.
 *
 * Ties share the midpoint of the range they span, so equal readings always
 * receive equal ranks regardless of the order they arrived in — the
 * determinism the whole engine depends on.
 */
export function percentileRank(value: number, population: number[]): number | null {
  if (population.length < 2) return null;

  let below = 0;
  let equal = 0;
  for (const member of population) {
    if (member < value) below += 1;
    else if (member === value) equal += 1;
  }

  return round(((below + equal / 2) / population.length) * 100, 2);
}

/* ------------------------------------------------------------ calibration -- */

/** The measured shape of one universe, computed once per pass and reusable. */
export interface UniverseCalibration {
  universe: ScoreUniverse;
  sampleSize: number;
  /** Raw component readings across the universe, for percentile ranking. */
  populations: Partial<Record<ScoreComponentKey, number[]>>;
  /** Composite mean and dispersion, for the anchoring step. */
  compositeMean: number | null;
  compositeSigma: number | null;
}

export interface CalibrationInput {
  assetId: string;
  assetType: AssetType;
  engines: EngineOutputs;
}

function readComponent(
  engines: EngineOutputs,
  key: ScoreComponentKey,
): { value: number | null; reason: string | null } {
  const source = {
    momentum: engines.momentum,
    volume: engines.volume,
    activity: engines.activity,
    liquidity: engines.liquidity,
    relativeStrength: engines.relativeStrength,
    trend: engines.trend,
    volatility: engines.volatility,
  }[key];

  return { value: source.score, reason: source.unavailableReason };
}

/**
 * Builds the populations every percentile is taken against.
 *
 * A universe with too few members falls back to the combined set, because a
 * percentile over four assets can only take five values and would imply
 * precision the sample cannot support. The fallback is reported on the
 * result, never hidden.
 */
export function buildCalibrations(
  subjects: CalibrationInput[],
): Map<ScoreUniverse, UniverseCalibration> {
  const out = new Map<ScoreUniverse, UniverseCalibration>();

  const groups = new Map<ScoreUniverse, CalibrationInput[]>();
  for (const subject of subjects) {
    const id = universeFor(subject.assetType);
    groups.set(id, [...(groups.get(id) ?? []), subject]);
  }
  groups.set("all", subjects);

  for (const [id, members] of groups) {
    const populations: Partial<Record<ScoreComponentKey, number[]>> = {};
    for (const key of COMPONENT_KEYS) {
      const values = members
        .map((m) => readComponent(m.engines, key).value)
        .filter((v): v is number => v !== null);
      if (values.length >= 2) populations[key] = values;
    }

    out.set(id, {
      universe: id,
      sampleSize: members.length,
      populations,
      compositeMean: null,
      compositeSigma: null,
    });
  }

  return out;
}

/** The universe an asset is actually scored in, after the size check. */
export function resolveUniverse(
  assetType: AssetType,
  calibrations: Map<ScoreUniverse, UniverseCalibration>,
): { universe: ScoreUniverse; fellBack: boolean } {
  const preferred = universeFor(assetType);
  const config = universeConfig(preferred);
  const calibration = calibrations.get(preferred);

  if (calibration && calibration.sampleSize >= config.minimumMembers) {
    return { universe: preferred, fellBack: false };
  }
  return { universe: "all", fellBack: true };
}

/* -------------------------------------------------------------- composite -- */

export interface CompositeResult {
  /** Weighted mean of normalised components, 0–100. Null when uncoverable. */
  composite: number | null;
  normalised: Partial<Record<ScoreComponentKey, number>>;
  missing: { component: ScoreComponentKey; reason: string }[];
  coverage: number;
  availableWeight: number;
}

/**
 * Normalises every available component and combines them.
 *
 * Absent components are excluded and the remaining weights renormalise over
 * what exists — never defaulted to a neutral value, which would make a
 * three-component score indistinguishable from a seven-component one.
 */
export function buildComposite(
  engines: EngineOutputs,
  calibration: UniverseCalibration,
): CompositeResult {
  const normalised: Partial<Record<ScoreComponentKey, number>> = {};
  const missing: { component: ScoreComponentKey; reason: string }[] = [];

  let weighted = 0;
  let availableWeight = 0;
  let totalWeight = 0;

  for (const key of COMPONENT_KEYS) {
    const config = componentConfig(key);
    totalWeight += config.weight;

    const { value, reason } = readComponent(engines, key);
    const population = calibration.populations[key];

    if (value === null) {
      missing.push({ component: key, reason: reason ?? "component was not computed" });
      continue;
    }
    if (!population || population.length < 2) {
      missing.push({
        component: key,
        reason: `fewer than two peers in ${calibration.universe} report this component`,
      });
      continue;
    }

    const rank = percentileRank(value, population);
    if (rank === null) {
      missing.push({ component: key, reason: "percentile could not be computed" });
      continue;
    }

    // volatility enters inverted: calmer ranks higher
    const score = config.method === "percentileInverted" ? round(100 - rank, 2) : rank;

    normalised[key] = score;
    weighted += score * config.weight;
    availableWeight += config.weight;
  }

  const coverage = totalWeight === 0 ? 0 : availableWeight / totalWeight;

  return {
    composite: availableWeight === 0 ? null : round(weighted / availableWeight, 4),
    normalised,
    missing,
    coverage: round(coverage, 4),
    availableWeight,
  };
}

/**
 * Anchors a composite against its universe.
 *
 * `50 + sigma × spread`. A universe with too little dispersion is left alone:
 * dividing by a near-zero sigma would turn measurement noise into large score
 * differences, which is precisely the failure this step exists to prevent.
 */
export function anchorComposite(
  composite: number,
  mean: number | null,
  sigma: number | null,
): { score: number; anchored: boolean } {
  if (mean === null || sigma === null || sigma < AGGREGATION.minimumSigma) {
    return { score: round(clamp(composite, 0, 100), 2), anchored: false };
  }

  const z = (composite - mean) / sigma;
  return {
    score: round(clamp(AGGREGATION.centre + z * AGGREGATION.spreadPerSigma, 0, 100), 2),
    anchored: true,
  };
}

/* ------------------------------------------------------------- confidence -- */

export function computeConfidence(input: {
  coverage: number;
  componentsAvailable: number;
  ageSeconds: number | null;
  historyPoints: number;
  universeSize: number;
  universeMinimum: number;
}): ScoreConfidence {
  const completeness = clamp(input.coverage, 0, 1);

  let freshness: number;
  if (input.ageSeconds === null) {
    freshness = 0.5;
  } else if (input.ageSeconds <= CONFIDENCE.freshnessWindowSeconds) {
    freshness = 1 - (input.ageSeconds / CONFIDENCE.freshnessWindowSeconds) * 0.15;
  } else if (input.ageSeconds >= CONFIDENCE.maximumAgeSeconds) {
    freshness = 0.1;
  } else {
    const span = CONFIDENCE.maximumAgeSeconds - CONFIDENCE.freshnessWindowSeconds;
    const travelled = (input.ageSeconds - CONFIDENCE.freshnessWindowSeconds) / span;
    freshness = 0.85 - travelled * 0.75;
  }

  const historicalDepth = clamp(
    input.historyPoints / CONFIDENCE.healthyHistoryPoints,
    0,
    1,
  );

  // A percentile is only as trustworthy as the population behind it. Ranking
  // against eight peers moves the percentile 12.5 points per position;
  // against forty it moves 2.5. Support is tied to that coarseness directly.
  const universeSupport = clamp(
    input.universeSize / CONFIDENCE.healthyUniverseSize,
    0,
    1,
  );

  // Quality of what WAS measured...
  const qw = CONFIDENCE.qualityWeights;
  const quality =
    freshness * qw.freshness +
    historicalDepth * qw.historicalDepth +
    universeSupport * qw.universeSupport;

  // ...bounded by how much of the model was measurable at all.
  const value = clamp(completeness * quality, 0, 1);

  const band: ConfidenceBand =
    value >= CONFIDENCE.bands.high
      ? "HIGH"
      : value >= CONFIDENCE.bands.medium
        ? "MEDIUM"
        : "LOW";

  return {
    value: round(value, 4),
    band,
    completeness: round(completeness, 4),
    freshness: round(clamp(freshness, 0, 1), 4),
    historicalDepth: round(historicalDepth, 4),
    componentsAvailable: input.componentsAvailable,
    componentsTotal: COMPONENT_KEYS.length,
  };
}

/* ---------------------------------------------------------------- drivers -- */

/**
 * Why the score is what it is.
 *
 * A driver reports the normalised standing, the points it contributed
 * relative to a neutral 50, and the measured fact behind it. Every clause is
 * assembled from a computed quantity; nothing is written by a model, and no
 * provider is named.
 */
export function buildDrivers(
  normalised: Partial<Record<ScoreComponentKey, number>>,
  availableWeight: number,
  engines: EngineOutputs,
  universeLabel: string,
): ScoreDriver[] {
  const detail: Partial<Record<ScoreComponentKey, string>> = {};

  const m = engines.momentum;
  if (m.score !== null) {
    detail.momentum = `${m.direction === "falling" ? "Negative" : m.direction === "flat" ? "Flat" : "Positive"} momentum across ${m.timeframes.join(", ")}`;
  }

  const t = engines.trend;
  if (t.score !== null && t.slopePctPerDay !== null) {
    detail.trend = `${(t.state ?? "NEUTRAL").replace(/_/g, " ").toLowerCase()} at ${t.slopePctPerDay >= 0 ? "+" : ""}${t.slopePctPerDay.toFixed(2)}%/day`;
  }

  const v = engines.volume;
  if (v.score !== null) {
    detail.volume =
      v.relativeVolume !== null
        ? `Turnover ${v.relativeVolume.toFixed(2)}x its own baseline`
        : `Turnover ranked against ${universeLabel.toLowerCase()}`;
  }

  const rs = engines.relativeStrength;
  if (rs.score !== null && rs.excessReturnPct !== null) {
    detail.relativeStrength = `${rs.excessReturnPct >= 0 ? "Outperforming" : "Underperforming"} ${rs.benchmarkLabel} by ${Math.abs(rs.excessReturnPct).toFixed(2)} points`;
  }

  const a = engines.activity;
  if (a.score !== null) {
    detail.activity =
      a.basis === "onchain"
        ? "Onchain participation ranked against peers"
        : "Market turnover measured against capitalisation";
  }

  const l = engines.liquidity;
  if (l.score !== null) {
    detail.liquidity =
      l.changePct !== null
        ? `Liquidity ${l.changePct >= 0 ? "expanded" : "contracted"} ${Math.abs(l.changePct).toFixed(1)}%`
        : "Book depth measured against turnover";
  }

  const vol = engines.volatility;
  if (vol.score !== null && vol.mediumTermPct !== null) {
    detail.volatility = `Volatility ${vol.mediumTermPct.toFixed(0)}% annualised`;
  }

  const drivers: ScoreDriver[] = [];
  for (const key of COMPONENT_KEYS) {
    const value = normalised[key];
    if (value === undefined) continue;

    const share = componentConfig(key).weight / availableWeight;
    const contribution = (value - 50) * share;
    if (Math.abs(contribution) < 0.05) continue;

    drivers.push({
      component: key,
      direction: contribution >= 0 ? "positive" : "negative",
      contribution: round(contribution, 2),
      detail: detail[key] ?? `${componentConfig(key).label} ranked ${value.toFixed(0)}`,
    });
  }

  return drivers.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

/* ------------------------------------------------------------------ score -- */

export interface CalibratedScoreInput {
  assetType: AssetType;
  engines: EngineOutputs;
  ageSeconds: number | null;
  historyPoints: number;
  calibrations: Map<ScoreUniverse, UniverseCalibration>;
}

export interface CalibratedScore extends StrataScoreResult {
  scoreVersion: string;
  scoreUniverse: ScoreUniverse;
  universeLabel: string;
  /** True when the asset's own class was too small and "all" was used. */
  universeFellBack: boolean;
  /** The composite before anchoring, retained so the step is inspectable. */
  composite: number | null;
  anchored: boolean;
  bucket: string | null;
}

export function computeCalibratedScore(input: CalibratedScoreInput): CalibratedScore {
  const { universe, fellBack } = resolveUniverse(input.assetType, input.calibrations);
  const calibration = input.calibrations.get(universe);
  const config = universeConfig(universe);
  const at = nowIso();

  const base = {
    version: "v1",
    scoreVersion: SCORE_VERSION,
    scoreUniverse: universe,
    universeLabel: config.label,
    universeFellBack: fellBack,
    calculatedAt: at,
  };

  if (!calibration) {
    return {
      ...base,
      status: "INSUFFICIENT_DATA",
      score: null,
      components: {},
      missing: [],
      confidence: computeConfidence({
        coverage: 0,
        componentsAvailable: 0,
        ageSeconds: input.ageSeconds,
        historyPoints: input.historyPoints,
        universeSize: 0,
        universeMinimum: config.minimumMembers,
      }),
      drivers: [],
      insufficientReason: "no comparison universe is available",
      composite: null,
      anchored: false,
      bucket: null,
    };
  }

  const built = buildComposite(input.engines, calibration);

  const confidence = computeConfidence({
    coverage: built.coverage,
    componentsAvailable: Object.keys(built.normalised).length,
    ageSeconds: input.ageSeconds,
    historyPoints: input.historyPoints,
    universeSize: calibration.sampleSize,
    universeMinimum: config.minimumMembers,
  });

  const components = { ...built.normalised };

  const missingRequired = AGGREGATION.requiredComponents.filter(
    (key) => built.normalised[key] === undefined,
  );

  if (missingRequired.length > 0) {
    return {
      ...base,
      status: "INSUFFICIENT_DATA",
      score: null,
      components,
      missing: built.missing,
      confidence,
      drivers: [],
      insufficientReason: `required component${missingRequired.length > 1 ? "s" : ""} unavailable: ${missingRequired.join(", ")}`,
      composite: built.composite,
      anchored: false,
      bucket: null,
    };
  }

  if (built.composite === null || built.coverage < AGGREGATION.minimumCoverage) {
    return {
      ...base,
      status: "INSUFFICIENT_DATA",
      score: null,
      components,
      missing: built.missing,
      confidence,
      drivers: [],
      insufficientReason: `only ${(built.coverage * 100).toFixed(0)}% of scoring weight is backed by real data; ${(AGGREGATION.minimumCoverage * 100).toFixed(0)}% is required`,
      composite: built.composite,
      anchored: false,
      bucket: null,
    };
  }

  const { score, anchored } = anchorComposite(
    built.composite,
    calibration.compositeMean,
    calibration.compositeSigma,
  );

  return {
    ...base,
    status: "OK",
    score,
    components,
    missing: built.missing,
    confidence,
    drivers: buildDrivers(
      built.normalised,
      built.availableWeight,
      input.engines,
      config.label,
    ),
    insufficientReason: null,
    composite: built.composite,
    anchored,
    bucket: bucketFor(score),
  };
}
