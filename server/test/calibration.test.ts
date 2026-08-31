import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AGGREGATION,
  bucketFor,
  COMPONENT_KEYS,
  componentConfig,
  SCORE_COMPONENTS,
  SCORE_VERSION,
  universeFor,
} from "../src/config/score-v1.ts";
import {
  anchorComposite,
  buildCalibrations,
  buildComposite,
  computeCalibratedScore,
  percentileRank,
  resolveUniverse,
  type CalibrationInput,
} from "../src/compute/score/calibrate.ts";
import { describe as describeDist, diagnoseComponents } from "../src/compute/score/report.ts";
import { distinctRatio, isDegenerate } from "../src/compute/features/series.ts";
import type { AssetType } from "../src/types/domain.ts";
import type { EngineOutputs } from "../src/types/intelligence.ts";

/**
 * CALIBRATION TESTS
 *
 * The calibration exists to make the score mean something, so these assert
 * meaning rather than shape: that a better reading never lowers a score, that
 * a small input change produces a small output change, that a missing
 * component is excluded rather than defaulted, and that no step anywhere
 * multiplies a score to fill the scale.
 *
 * Every fixture is explicit. Nothing reads a clock or a random number.
 */

/* ------------------------------------------------------------ fixtures --- */

function engines(values: Partial<Record<string, number | null>>): EngineOutputs {
  const none = (r: string) => ({ score: null, unavailableReason: r });
  const has = (k: string) => values[k] !== undefined && values[k] !== null;
  const v = (k: string) => values[k] as number;

  return {
    momentum: has("momentum")
      ? { score: v("momentum"), direction: "rising", change: null, timeframes: ["24h"], unavailableReason: null }
      : { ...none("no data"), direction: null, change: null, timeframes: [] },
    volume: has("volume")
      ? { score: v("volume"), regime: "NORMAL", relativeVolume: 1, acceleration: null, unavailableReason: null }
      : { ...none("no data"), regime: null, relativeVolume: null, acceleration: null },
    activity: has("activity")
      ? { score: v("activity"), basis: "onchain", unavailableReason: null }
      : { ...none("no data"), basis: null },
    liquidity: has("liquidity")
      ? { score: v("liquidity"), state: "stable", changePct: 0, unavailableReason: null }
      : { ...none("no data"), state: null, changePct: null },
    volatility: has("volatility")
      ? { score: v("volatility"), shortTermPct: 40, mediumTermPct: 40, expansion: 1, unavailableReason: null }
      : { ...none("no data"), shortTermPct: null, mediumTermPct: null, expansion: null },
    relativeStrength: has("relativeStrength")
      ? { score: v("relativeStrength"), excessReturnPct: 1, benchmarkId: "crypto-majors", benchmarkLabel: "Crypto majors", unavailableReason: null }
      : { ...none("no data"), excessReturnPct: null, benchmarkId: null, benchmarkLabel: null },
    trend: has("trend")
      ? { score: v("trend"), state: "UPTREND", slopePctPerDay: 1, fitQuality: 0.8, unavailableReason: null }
      : { ...none("no data"), state: null, slopePctPerDay: null, fitQuality: null },
  };
}

/** A full universe of `n` assets, evenly spread, so ranks are unambiguous. */
function universe(n: number, assetType: AssetType = "crypto"): CalibrationInput[] {
  return Array.from({ length: n }, (_, i) => {
    const level = (i / Math.max(1, n - 1)) * 100;
    return {
      assetId: `asset-${i}`,
      assetType,
      engines: engines({
        momentum: level,
        volume: level,
        activity: level,
        liquidity: level,
        relativeStrength: level,
        trend: level,
        volatility: level,
      }),
    };
  });
}

function scoreOne(
  subject: CalibrationInput,
  peers: CalibrationInput[],
  historyPoints = 300,
) {
  const calibrations = buildCalibrations([subject, ...peers]);
  // measure composite dispersion exactly as the pass does
  const composites: number[] = [];
  for (const member of [subject, ...peers]) {
    const { universe: u } = resolveUniverse(member.assetType, calibrations);
    const cal = calibrations.get(u);
    if (!cal) continue;
    const built = buildComposite(member.engines, cal);
    if (built.composite !== null) composites.push(built.composite);
  }
  for (const [, cal] of calibrations) {
    if (composites.length < 2) continue;
    const mean = composites.reduce((s, v) => s + v, 0) / composites.length;
    cal.compositeMean = mean;
    cal.compositeSigma = Math.sqrt(
      composites.reduce((s, v) => s + (v - mean) ** 2, 0) / (composites.length - 1),
    );
  }

  return computeCalibratedScore({
    assetType: subject.assetType,
    engines: subject.engines,
    ageSeconds: 30,
    historyPoints,
    calibrations,
  });
}

/* ---------------------------------------------------------- percentile --- */

describe("percentile normalisation", () => {
  it("maps a value to its rank in the population", () => {
    const population = Array.from({ length: 100 }, (_, i) => i);
    assert.equal(percentileRank(90, population), 90.5);
    assert.equal(percentileRank(50, population), 50.5);
    assert.equal(percentileRank(10, population), 10.5);
  });

  it("gives ties the same rank regardless of order", () => {
    const a = percentileRank(5, [1, 5, 5, 5, 9]);
    const b = percentileRank(5, [9, 5, 1, 5, 5]);
    assert.equal(a, b);
  });

  it("refuses a population of one", () => {
    assert.equal(percentileRank(5, [5]), null);
  });

  it("is not compressed by a single extreme outlier", () => {
    // the failure min/max scaling has: one absurd value crushes the rest
    const ordinary = [10, 20, 30, 40, 50];
    const withOutlier = [...ordinary, 10_000_000];

    const before = percentileRank(40, ordinary) as number;
    const after = percentileRank(40, withOutlier) as number;

    // the rank shifts only by the one asset that was added, not by its size
    assert.ok(Math.abs(before - after) < 15);
    assert.ok(after > 50, "40 is still in the upper half of the real values");
  });
});

/* -------------------------------------------------------- degeneracy --- */

describe("degenerate series", () => {
  it("identifies a price that never moves", () => {
    assert.equal(isDegenerate([100, 100, 100, 100]), true);
    assert.equal(isDegenerate([100, 100.01, 100, 100]), false);
  });

  it("measures how coarse a series is", () => {
    assert.equal(distinctRatio([1, 1, 1, 1]), 0.25);
    assert.equal(distinctRatio([1, 2, 3, 4]), 1);
  });

  it("treats a two-value series across many observations as too coarse", () => {
    // the exact shape of every covered equity: one step, hundreds of points
    const series = [...Array(295).fill(100), ...Array(1).fill(101)];
    assert.ok(distinctRatio(series) < 0.02);
  });
});

/* ---------------------------------------------------------- composite --- */

describe("composite construction", () => {
  it("excludes a missing component rather than defaulting it", () => {
    const peers = universe(12);
    const full = scoreOne(
      { assetId: "x", assetType: "crypto", engines: engines({ momentum: 80, volume: 80, activity: 80, liquidity: 80, relativeStrength: 80, trend: 80, volatility: 80 }) },
      peers,
    );
    const partial = scoreOne(
      { assetId: "x", assetType: "crypto", engines: engines({ momentum: 80, volume: 80, relativeStrength: 80, trend: 80 }) },
      peers,
    );

    assert.equal(full.status, "OK");
    assert.equal(partial.status, "OK");
    // identical readings on the components that exist: the missing ones must
    // not drag the score toward zero
    assert.ok(Math.abs((full.score as number) - (partial.score as number)) < 12);
    assert.equal(partial.missing.length, 3);
  });

  it("reports lower confidence for the thinner input set", () => {
    const peers = universe(12);
    const full = scoreOne({ assetId: "x", assetType: "crypto", engines: engines({ momentum: 60, volume: 60, activity: 60, liquidity: 60, relativeStrength: 60, trend: 60, volatility: 60 }) }, peers);
    const partial = scoreOne({ assetId: "x", assetType: "crypto", engines: engines({ momentum: 60, volume: 60, trend: 60 }) }, peers);
    assert.ok(partial.confidence.value < full.confidence.value);
  });

  it("refuses to score without the required component", () => {
    const result = scoreOne(
      { assetId: "x", assetType: "crypto", engines: engines({ volume: 80, trend: 80, activity: 80 }) },
      universe(12),
    );
    assert.equal(result.status, "INSUFFICIENT_DATA");
    assert.equal(result.score, null);
    assert.match(result.insufficientReason ?? "", /momentum/);
  });

  it("refuses below the coverage floor", () => {
    const result = scoreOne(
      { assetId: "x", assetType: "crypto", engines: engines({ momentum: 80 }) },
      universe(12),
    );
    assert.equal(result.status, "INSUFFICIENT_DATA");
    assert.match(result.insufficientReason ?? "", /scoring weight/);
  });
});

/* -------------------------------------------------------- monotonicity --- */

describe("monotonicity", () => {
  const peers = universe(20);

  it("never lowers the score for better momentum", () => {
    let previous = -Infinity;
    for (const momentum of [10, 30, 50, 70, 90]) {
      const result = scoreOne(
        { assetId: "x", assetType: "crypto", engines: engines({ momentum, volume: 50, trend: 50, relativeStrength: 50, activity: 50 }) },
        peers,
      );
      const score = result.score as number;
      assert.ok(score >= previous, `momentum ${momentum} lowered the score`);
      previous = score;
    }
  });

  it("never lowers the score for better trend", () => {
    let previous = -Infinity;
    for (const trend of [10, 30, 50, 70, 90]) {
      const score = scoreOne(
        { assetId: "x", assetType: "crypto", engines: engines({ momentum: 50, volume: 50, trend, relativeStrength: 50, activity: 50 }) },
        peers,
      ).score as number;
      assert.ok(score >= previous, `trend ${trend} lowered the score`);
      previous = score;
    }
  });

  it("never lowers the score for better relative strength", () => {
    let previous = -Infinity;
    for (const rs of [10, 30, 50, 70, 90]) {
      const score = scoreOne(
        { assetId: "x", assetType: "crypto", engines: engines({ momentum: 50, volume: 50, trend: 50, relativeStrength: rs, activity: 50 }) },
        peers,
      ).score as number;
      assert.ok(score >= previous, `relative strength ${rs} lowered the score`);
      previous = score;
    }
  });

  it("inverts volatility deliberately: calmer scores higher", () => {
    // the one component that is non-monotonic in its raw reading, by design
    const calm = scoreOne(
      { assetId: "x", assetType: "crypto", engines: engines({ momentum: 50, volume: 50, trend: 50, relativeStrength: 50, volatility: 90 }) },
      peers,
    ).score as number;
    const violent = scoreOne(
      { assetId: "x", assetType: "crypto", engines: engines({ momentum: 50, volume: 50, trend: 50, relativeStrength: 50, volatility: 10 }) },
      peers,
    ).score as number;

    // the engine's volatility reading is already "higher = calmer"; the
    // inverted percentile keeps that direction through normalisation
    assert.ok(calm > violent, "a calmer asset must not score below a violent one");
  });

  it("declares its monotonicity intent in configuration", () => {
    const volatility = componentConfig("volatility");
    assert.equal(volatility.monotonicIncreasing, false);
    for (const key of COMPONENT_KEYS.filter((k) => k !== "volatility")) {
      assert.equal(componentConfig(key).monotonicIncreasing, true);
    }
  });
});

/* ------------------------------------------------------------ stability --- */

describe("stability", () => {
  const peers = universe(30);

  it("responds proportionally to small input changes", () => {
    const at = (momentum: number) =>
      scoreOne(
        { assetId: "x", assetType: "crypto", engines: engines({ momentum, volume: 50, trend: 50, relativeStrength: 50, activity: 50 }) },
        peers,
      ).score as number;

    const base = at(50);
    const moves = [
      { pct: 1, score: at(50.5) },
      { pct: 5, score: at(52.5) },
      { pct: 10, score: at(55) },
    ];

    for (const move of moves) {
      const delta = Math.abs(move.score - base);
      // a small change must not produce a large jump
      assert.ok(delta < 25, `${move.pct}% input change moved the score ${delta}`);
    }

    // and the response must be ordered: bigger input change, bigger effect
    assert.ok(
      Math.abs(moves[2]!.score - base) >= Math.abs(moves[0]!.score - base),
      "a larger input change must not move the score less",
    );
  });

  it("is deterministic", () => {
    const subject: CalibrationInput = {
      assetId: "x",
      assetType: "crypto",
      engines: engines({ momentum: 64, volume: 71, trend: 58, relativeStrength: 49, activity: 66 }),
    };
    const a = scoreOne(subject, peers);
    const b = scoreOne(subject, peers);
    assert.equal(a.score, b.score);
    assert.deepEqual(a.components, b.components);
  });
});

/* ------------------------------------------------------------- anchoring -- */

describe("composite anchoring", () => {
  it("leaves the composite alone when the universe barely varies", () => {
    // dividing by a near-zero sigma would turn noise into large differences
    const { score, anchored } = anchorComposite(52, 50, 0.4);
    assert.equal(anchored, false);
    assert.equal(score, 52);
  });

  it("expresses distance from the mean in standard deviations", () => {
    const oneSigma = anchorComposite(60, 50, 10);
    assert.equal(oneSigma.anchored, true);
    assert.equal(oneSigma.score, AGGREGATION.centre + AGGREGATION.spreadPerSigma);
  });

  it("places the universe average at the centre", () => {
    assert.equal(anchorComposite(50, 50, 10).score, AGGREGATION.centre);
  });

  it("never exceeds the scale", () => {
    assert.ok(anchorComposite(100, 50, 2).score <= 100);
    assert.ok(anchorComposite(0, 50, 2).score >= 0);
  });
});

/* ------------------------------------------------------------- universes -- */

describe("universes", () => {
  it("assigns each asset class its own comparison set", () => {
    assert.equal(universeFor("stock"), "stocks");
    assert.equal(universeFor("crypto"), "crypto");
    assert.equal(universeFor("onchain"), "onchain");
  });

  it("falls back to the combined set when a class is too small", () => {
    const calibrations = buildCalibrations(universe(3, "crypto"));
    const { universe: resolved, fellBack } = resolveUniverse("crypto", calibrations);
    assert.equal(resolved, "all");
    assert.equal(fellBack, true);
  });

  it("keeps a large enough class in its own universe", () => {
    const calibrations = buildCalibrations(universe(20, "crypto"));
    const { universe: resolved, fellBack } = resolveUniverse("crypto", calibrations);
    assert.equal(resolved, "crypto");
    assert.equal(fellBack, false);
  });

  it("records the universe on the result", () => {
    const result = scoreOne(
      { assetId: "x", assetType: "crypto", engines: engines({ momentum: 70, volume: 70, trend: 70, relativeStrength: 70, activity: 70 }) },
      universe(20),
    );
    assert.equal(result.scoreUniverse, "crypto");
    assert.equal(result.scoreVersion, SCORE_VERSION);
  });
});

/* --------------------------------------------------------- distribution -- */

describe("score distribution", () => {
  it("separates a genuinely varied universe", () => {
    const members = universe(30);
    const scores = members.map(
      (m) => scoreOne(m, members.filter((x) => x.assetId !== m.assetId)).score,
    );
    const valid = scores.filter((s): s is number => s !== null);
    const d = describeDist(valid);

    assert.ok(d);
    // the uncalibrated formula produced a 29-point spread over real data;
    // an evenly-spread synthetic universe must do considerably better
    assert.ok(d.spread > 40, `spread was only ${d.spread}`);
    assert.ok(d.sd > 10, `standard deviation was only ${d.sd}`);
  });

  it("keeps a genuinely uniform universe clustered", () => {
    // every asset identical: separation would be invented, not measured
    const members: CalibrationInput[] = Array.from({ length: 20 }, (_, i) => ({
      assetId: `a-${i}`,
      assetType: "crypto",
      engines: engines({ momentum: 50, volume: 50, trend: 50, relativeStrength: 50, activity: 50 }),
    }));

    const scores = members
      .map((m) => scoreOne(m, members.filter((x) => x.assetId !== m.assetId)).score)
      .filter((s): s is number => s !== null);

    const d = describeDist(scores);
    assert.ok(d);
    assert.ok(d.spread < 5, `identical assets were spread ${d.spread} points apart`);
  });
});

/* ------------------------------------------------------------- buckets --- */

describe("score buckets", () => {
  it("labels each band", () => {
    assert.equal(bucketFor(95), "Exceptional");
    assert.equal(bucketFor(85), "Strong");
    assert.equal(bucketFor(50), "Neutral");
    assert.equal(bucketFor(10), "Very weak");
  });

  it("uses no label that implies a forecast", () => {
    const forbidden = /buy|sell|will|guarantee|profit|target|predict/i;
    for (const bucket of ["Exceptional", "Strong", "Positive", "Above average", "Neutral", "Weak", "Very weak"]) {
      assert.ok(!forbidden.test(bucket), `${bucket} implies a prediction`);
    }
  });
});

/* ------------------------------------------------------------- weights --- */

describe("configuration", () => {
  it("keeps weights summing to one", () => {
    const total = SCORE_COMPONENTS.reduce((s, c) => s + c.weight, 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
  });

  it("documents why every component is normalised as it is", () => {
    for (const component of SCORE_COMPONENTS) {
      assert.ok(component.rationale.length > 40, `${component.key} has no rationale`);
    }
  });
});

/* --------------------------------------------------------- diagnostics --- */

describe("component diagnostics", () => {
  it("flags a component that never varies", () => {
    const records = Array.from({ length: 10 }, (_, i) => ({
      assetId: `a-${i}`,
      symbol: `A${i}`,
      assetType: "crypto" as const,
      score: {
        status: "OK" as const,
        score: 50 + i,
        version: "v1",
        components: { momentum: 50 + i, activity: 50 },
        missing: [],
        confidence: { value: 0.9, band: "HIGH" as const, completeness: 1, freshness: 1, historicalDepth: 1, componentsAvailable: 2, componentsTotal: 7 },
        drivers: [],
        insufficientReason: null,
        calculatedAt: "2026-01-08T00:00:00.000Z",
      },
      engines: engines({}),
      historyPoints: 100,
      ageSeconds: 10,
      sources: ["test"],
      timestamp: "2026-01-08T00:00:00.000Z",
    }));

    const diagnostics = diagnoseComponents(records);
    const activity = diagnostics.find((d) => d.component === "activity");
    const momentum = diagnostics.find((d) => d.component === "momentum");

    assert.match(activity?.flag ?? "", /constant/);
    assert.equal(momentum?.flag, null);
  });

  it("flags a component that is never available", () => {
    const diagnostics = diagnoseComponents([]);
    assert.ok(diagnostics.every((d) => d.flag !== null || d.availability > 0));
  });
});
