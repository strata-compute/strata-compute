import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DETECTORS, SIGNIFICANCE } from "../src/config/intelligence.ts";
import {
  detectAnomaly,
  detectMomentumShift,
  detectRankAcceleration,
  detectRankDeterioration,
  detectStrengthAcceleration,
  detectStrengthDeterioration,
  detectTrendShift,
  detectVolumeContraction,
  detectVolumeExpansion,
  isDetection,
  type DetectorInput,
} from "../src/intelligence/detectors.ts";
import {
  breadthOf,
  detectRegimeShift,
  detectRotation,
  type UniverseSnapshot,
} from "../src/intelligence/market-detectors.ts";
import { eventKey, priorityFor, reconcile, severityFor } from "../src/intelligence/engine.ts";
import { persistenceOf } from "../src/intelligence/significance.ts";
import { bestWindow, robustDeviation, windowStats } from "../src/intelligence/windows.ts";
import type { IntelligenceEvent } from "../src/types/intelligence-events.ts";

/**
 * INTELLIGENCE DETECTION TESTS
 *
 * Every fixture here is synthetic and exists only to drive an algorithm. None
 * of it can reach production: the detectors are pure functions over series
 * passed as arguments, so a test constructs its inputs directly and never
 * touches a store, a provider or a clock.
 *
 * The emphasis is on the two ways this layer fails badly. It can report
 * everything, which makes a feed worthless. Or it can repeat one condition
 * until a reader believes it happened many times. Much of what follows is
 * about the second: a condition that persists must produce one event that
 * evolves, never a stream of duplicates.
 */

const NOW = Date.UTC(2026, 0, 8, 12, 0, 0);
const MINUTE = 60_000;

/** A series ending `now`, one point every two minutes, oldest first. */
function series(values: number[], spacingMinutes = 2): { timestamp: string; value: number }[] {
  const start = NOW - (values.length - 1) * spacingMinutes * MINUTE;
  return values.map((value, i) => ({
    timestamp: new Date(start + i * spacingMinutes * MINUTE).toISOString(),
    value,
  }));
}

/**
 * A baseline with dispersion, generated deterministically.
 *
 * Real metrics vary; a perfectly flat fixture has a MAD of zero, which the
 * window layer correctly refuses to divide by. Testing against flat series
 * would therefore exercise only the degenerate path and never the robust
 * statistics the detectors actually rely on.
 */
function jitter(base: number, n: number, amplitude = 1): number[] {
  const pattern = [0, 0.6, -0.4, 1, -0.8, 0.2, -1, 0.4];
  return Array.from(
    { length: n },
    (_, i) => base + amplitude * pattern[i % pattern.length]!,
  );
}

function input(overrides: Partial<DetectorInput> = {}): DetectorInput {
  return {
    assetId: "asset-1",
    symbol: "TEST",
    assetType: "crypto",
    scoreSeries: series(jitter(50, 40)),
    momentumSeries: series(jitter(50, 40)),
    trendSeries: series(jitter(50, 40)),
    volumeSeries: series(jitter(50, 40)),
    rankSeries: series(Array(40).fill(10)),
    components: { momentum: 50, volume: 50, trend: 50 },
    dataConfidence: 0.8,
    trendState: "NEUTRAL",
    trendFitQuality: 0.8,
    previousTrendState: "NEUTRAL",
    priorObservations: {},
    now: NOW,
    ...overrides,
  };
}

/* -------------------------------------------------------------- windows -- */

describe("historical windows", () => {
  it("refuses a window with too few observations", () => {
    const result = windowStats(series([1, 2, 3]), "4h", NOW);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.reason, "insufficient_history");
      assert.match(result.failure.detail, /observations/);
    }
  });

  it("refuses a window the data does not actually span", () => {
    // 40 dense points satisfy the 4h observation count while covering 78
    // minutes: enough numbers, nothing like four hours of history
    const result = windowStats(series(jitter(50, 40)), "4h", NOW);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.failure.detail, /spans/);
  });

  it("falls back to the widest window the data genuinely supports", () => {
    const result = bestWindow(series(jitter(50, 40)), NOW);
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.stats.window, "1h");
      assert.ok(result.stats.spanMinutes >= 42);
    }
  });

  it("uses a baseline that one spike cannot move", () => {
    const clean = windowStats(series(jitter(10, 30)), "1h", NOW);
    const spiked = windowStats(series([...jitter(10, 29), 10_000]), "1h", NOW);
    assert.ok(clean.ok && spiked.ok);
    if (clean.ok && spiked.ok) {
      assert.ok(
        Math.abs(clean.stats.median - spiked.stats.median) < 0.5,
        "a single spike shifted the median",
      );
      assert.ok(
        spiked.stats.mad < 5,
        "a single spike inflated the dispersion enough to hide itself",
      );
    }
  });

  it("declines a deviation when the window has no dispersion", () => {
    const result = windowStats(series(Array(30).fill(10)), "1h", NOW);
    assert.ok(result.ok);
    if (result.ok) assert.equal(robustDeviation(10, result.stats), null);
  });
});

/* -------------------------------------------------------- significance --- */

describe("significance", () => {
  /**
   * A configuration invariant, not a behaviour. Significance is a product, so
   * an unconfirmed first sighting must still be able to reach the raising
   * threshold — otherwise nothing is ever created, nothing ever accumulates
   * observations, and the engine goes permanently silent while looking merely
   * quiet.
   */
  it("lets a first, strong detection clear the raising threshold", () => {
    const bestFirstPass = 1 * persistenceOf(1) * 1 * 1;
    assert.ok(
      bestFirstPass > SIGNIFICANCE.minimum,
      `no first detection could ever be raised: ceiling ${bestFirstPass} <= floor ${SIGNIFICANCE.minimum}`,
    );
  });

  it("credits a held condition more than a new one", () => {
    assert.ok(persistenceOf(1) < persistenceOf(3));
    assert.ok(persistenceOf(3) < persistenceOf(6));
    assert.equal(persistenceOf(SIGNIFICANCE.persistenceSaturation), 1);
    assert.equal(persistenceOf(0), 0);
  });
});

/* ------------------------------------------------------------- strength -- */

describe("strength detection", () => {
  it("detects a sustained rise in computed strength", () => {
    const outcome = detectStrengthAcceleration(
      input({
        scoreSeries: series([...jitter(60, 25), 63, 66, 69, 72, 75]),
        momentumSeries: series([...jitter(50, 25), 58, 62, 66, 70, 74]),
      }),
    );

    assert.ok(isDetection(outcome), "a 15-point rise should be detected");
    if (isDetection(outcome)) {
      assert.equal(outcome.eventType, "STRENGTH_ACCELERATION");
      assert.equal(outcome.magnitude, 15);
      assert.ok(outcome.drivers.length > 1, "several components should back it");
      assert.equal(outcome.context.scoreTo, 75);
      assert.ok(outcome.significance.value > SIGNIFICANCE.minimum);
    }
  });

  it("detects deterioration symmetrically", () => {
    const outcome = detectStrengthDeterioration(
      input({ scoreSeries: series([...jitter(80, 25), 76, 72, 68, 64, 60]) }),
    );
    assert.ok(isDetection(outcome));
    if (isDetection(outcome)) {
      assert.equal(outcome.eventType, "STRENGTH_DETERIORATION");
      assert.equal(outcome.magnitude, -20);
    }
  });

  it("ignores a move too small to matter", () => {
    const outcome = detectStrengthAcceleration(
      input({ scoreSeries: series([...jitter(60, 28), 60.5, 61]) }),
    );
    assert.ok(!isDetection(outcome), "a one-point drift is not intelligence");
  });

  it("reports insufficient history rather than guessing", () => {
    const outcome = detectStrengthAcceleration(input({ scoreSeries: series([60, 70]) }));
    assert.ok(!isDetection(outcome));
    if (!isDetection(outcome)) {
      assert.equal(outcome.reason, "insufficient_history");
      assert.ok(outcome.observationsRequired > outcome.observationsAvailable);
    }
  });

  it("stays silent when nothing computed has moved", () => {
    const outcome = detectStrengthAcceleration(input());
    assert.ok(!isDetection(outcome));
  });
});

/* --------------------------------------------------- momentum and trend -- */

describe("momentum and trend", () => {
  it("classifies an accelerating momentum shift", () => {
    const outcome = detectMomentumShift(
      input({ momentumSeries: series([...jitter(40, 28), 62, 68]) }),
    );
    assert.ok(isDetection(outcome));
    if (isDetection(outcome)) assert.equal(outcome.context.classification, "ACCELERATING");
  });

  it("classifies a decelerating shift", () => {
    const outcome = detectMomentumShift(
      input({ momentumSeries: series([...jitter(70, 28), 48, 42]) }),
    );
    assert.ok(isDetection(outcome));
    if (isDetection(outcome)) assert.equal(outcome.context.classification, "DECELERATING");
  });

  it("ignores momentum drifting inside its own baseline", () => {
    assert.ok(!isDetection(detectMomentumShift(input())));
  });

  it("requires the trend classification to actually change", () => {
    const outcome = detectTrendShift(
      input({ trendState: "UPTREND", previousTrendState: "UPTREND" }),
    );
    assert.ok(!isDetection(outcome));
  });

  it("rejects a reclassification read off a poor fit", () => {
    const outcome = detectTrendShift(
      input({ trendState: "UPTREND", previousTrendState: "NEUTRAL", trendFitQuality: 0.05 }),
    );
    assert.ok(!isDetection(outcome), "noise changing labels is not a trend shift");
    if (!isDetection(outcome)) assert.match(outcome.detail, /fit quality/);
  });

  it("detects a well-fitted trend change", () => {
    const outcome = detectTrendShift(
      input({ trendState: "STRONG_UPTREND", previousTrendState: "NEUTRAL", trendFitQuality: 0.8 }),
    );
    assert.ok(isDetection(outcome));
    if (isDetection(outcome)) {
      assert.equal(outcome.context.classification, "STRENGTHENING");
      assert.equal(outcome.context.from, "NEUTRAL");
      assert.equal(outcome.context.to, "STRONG_UPTREND");
    }
  });

  it("needs two consecutive classifications before it can compare", () => {
    const outcome = detectTrendShift(input({ previousTrendState: null }));
    assert.ok(!isDetection(outcome));
    if (!isDetection(outcome)) assert.equal(outcome.reason, "insufficient_history");
  });
});

/* --------------------------------------------------------------- volume -- */

describe("volume detection", () => {
  it("detects expansion against the rolling median", () => {
    const outcome = detectVolumeExpansion(
      input({ volumeSeries: series([...jitter(20, 28), 60, 70]) }),
    );
    assert.ok(isDetection(outcome));
    if (isDetection(outcome)) {
      assert.ok((outcome.context.relativeVolume as number) >= DETECTORS.VOLUME_EXPANSION.minRatio);
    }
  });

  it("detects contraction", () => {
    const outcome = detectVolumeContraction(
      input({ volumeSeries: series([...jitter(60, 28), 20, 15]) }),
    );
    assert.ok(isDetection(outcome));
    if (isDetection(outcome)) {
      assert.ok((outcome.context.relativeVolume as number) <= DETECTORS.VOLUME_CONTRACTION.maxRatio);
    }
  });

  it("ignores volume sitting near its own baseline", () => {
    assert.ok(!isDetection(detectVolumeExpansion(input())));
    assert.ok(!isDetection(detectVolumeContraction(input())));
  });

  it("never states volume as a direction", () => {
    const outcome = detectVolumeExpansion(
      input({ volumeSeries: series([...jitter(20, 28), 60, 70]) }),
    );
    assert.ok(isDetection(outcome));
    if (isDetection(outcome)) {
      const text = JSON.stringify(outcome.context).toLowerCase();
      for (const word of ["bullish", "bearish", "buy", "sell", "rally"]) {
        assert.ok(!text.includes(word), `context implied direction with "${word}"`);
      }
      assert.match(String(outcome.context.note), /not direction/);
    }
  });
});

/* ----------------------------------------------------------------- rank -- */

describe("rank detection", () => {
  it("detects positions gained", () => {
    const outcome = detectRankAcceleration(
      input({ rankSeries: series([...Array(28).fill(42), 30, 17]) }),
    );
    assert.ok(isDetection(outcome));
    if (isDetection(outcome)) {
      assert.equal(outcome.context.previousRank, 42);
      assert.equal(outcome.context.currentRank, 17);
      assert.ok((outcome.context.positions as number) >= DETECTORS.RANK_ACCELERATION.minPositions);
    }
  });

  it("detects positions lost", () => {
    const outcome = detectRankDeterioration(
      input({ rankSeries: series([...Array(28).fill(4), 11, 23]) }),
    );
    assert.ok(isDetection(outcome));
    if (isDetection(outcome)) assert.equal(outcome.eventType, "RANK_DETERIORATION");
  });

  it("ignores a one-position drift", () => {
    const outcome = detectRankAcceleration(
      input({ rankSeries: series([...Array(28).fill(10), 10, 9]) }),
    );
    assert.ok(!isDetection(outcome));
  });

  it("cannot rank an asset with no rank history", () => {
    const outcome = detectRankAcceleration(input({ rankSeries: [] }));
    assert.ok(!isDetection(outcome));
    if (!isDetection(outcome)) assert.equal(outcome.reason, "insufficient_history");
  });
});

/* -------------------------------------------------------------- anomaly -- */

describe("anomaly detection", () => {
  it("flags a value far outside its own baseline", () => {
    const outcome = detectAnomaly(input({ volumeSeries: series([...jitter(20, 29), 400]) }));
    assert.ok(isDetection(outcome));
    if (isDetection(outcome)) {
      assert.equal(outcome.context.method, "median_absolute_deviation");
      assert.equal(outcome.context.metric, "volume");
      assert.ok(Math.abs(outcome.magnitude) >= DETECTORS.ANOMALY.minDeviation);
    }
  });

  it("does not flag ordinary variation", () => {
    assert.ok(!isDetection(detectAnomaly(input())));
  });

  it("says nothing when no metric has a usable baseline", () => {
    const flat = series(Array(30).fill(20));
    const outcome = detectAnomaly(
      input({ volumeSeries: flat, momentumSeries: flat, scoreSeries: flat }),
    );
    assert.ok(!isDetection(outcome), "zero dispersion must not read as infinite deviation");
  });
});

/* -------------------------------------------------------------- breadth -- */

describe("breadth", () => {
  it("counts advancing, declining and unchanged", () => {
    const counts = breadthOf([3, 2, 1, -2, -3, 0.1]);
    assert.equal(counts.advancing, 3);
    assert.equal(counts.declining, 2);
    assert.equal(counts.unchanged, 1);
    assert.equal(counts.total, 6);
    assert.equal(counts.ratio, 0.6);
  });

  it("returns a null ratio when nothing moved", () => {
    assert.equal(breadthOf([0, 0, 0]).ratio, null);
  });
});

/* ------------------------------------------------------------- rotation -- */

describe("cross-market rotation", () => {
  const universe = (id: "crypto" | "stocks", changes: number[]): UniverseSnapshot => ({
    universe: id,
    assetType: id === "crypto" ? "crypto" : "stock",
    scores: changes.map(() => 50),
    changes,
    size: changes.length,
  });

  const rotating = () => [
    universe("crypto", [8, 9, 7, 8, 9]),
    universe("stocks", [-5, -6, -4, -5, -6]),
  ];

  it("requires two universes large enough to aggregate", () => {
    const outcome = detectRotation({
      universes: [universe("crypto", [8, 9, 7])],
      priorObservations: 5,
      dataConfidence: 0.8,
      window: "4h",
    });
    assert.ok("reason" in outcome);
    if ("reason" in outcome) assert.match(outcome.detail, /scored assets/);
  });

  it("requires a material spread", () => {
    const outcome = detectRotation({
      universes: [
        universe("crypto", [1, 1, 1, 1, 1]),
        universe("stocks", [-1, -1, -1, -1, -1]),
      ],
      priorObservations: 5,
      dataConfidence: 0.8,
      window: "4h",
    });
    assert.ok("reason" in outcome);
    if ("reason" in outcome) assert.match(outcome.detail, /spread/);
  });

  it("requires breadth to confirm the spread", () => {
    // half the strong universe moving hard is not a rotation, it is a split
    const outcome = detectRotation({
      universes: [
        universe("crypto", [10, 10, 10, -1, -1, -1]),
        universe("stocks", [-6, -6, -6, -6, -6]),
      ],
      priorObservations: 5,
      dataConfidence: 0.8,
      window: "4h",
    });
    assert.ok("reason" in outcome, "an unconfirmed spread must not be reported");
    if ("reason" in outcome) assert.match(outcome.detail, /breadth/);
  });

  it("requires persistence before reporting", () => {
    const outcome = detectRotation({
      universes: rotating(),
      priorObservations: 0,
      dataConfidence: 0.8,
      window: "4h",
    });
    assert.ok("reason" in outcome);
    if ("reason" in outcome) assert.match(outcome.detail, /held for/);
  });

  it("reports a broad, persistent rotation", () => {
    const outcome = detectRotation({
      universes: rotating(),
      priorObservations: 4,
      dataConfidence: 0.8,
      window: "4h",
    });
    assert.ok(!("reason" in outcome));
    if (!("reason" in outcome)) {
      assert.equal(outcome.eventType, "CROSS_MARKET_ROTATION");
      assert.equal(outcome.assetId, null, "a market event belongs to no asset");
      assert.equal(outcome.context.strengthening, "crypto");
      assert.equal(outcome.context.weakening, "stocks");
    }
  });

  it("never claims capital moved", () => {
    const outcome = detectRotation({
      universes: rotating(),
      priorObservations: 4,
      dataConfidence: 0.8,
      window: "4h",
    });
    assert.ok(!("reason" in outcome));
    if (!("reason" in outcome)) {
      assert.equal(outcome.context.interpretation, "relative strength rotation");
      assert.match(String(outcome.context.caveat), /not a claim about capital flow/);
      const text = JSON.stringify(outcome.context).toLowerCase();
      for (const phrase of ["inflow", "outflow", "money", "capital moved"]) {
        assert.ok(!text.includes(phrase), `context implied capital movement: "${phrase}"`);
      }
    }
  });
});

/* --------------------------------------------------------- regime shift -- */

describe("regime shift", () => {
  const base = {
    breadth: breadthOf([3, 3, 3, -1, -1]),
    medianAbsMove: 2,
    dataConfidence: 0.8,
    coveredAssets: 20,
  };

  it("requires persistence before claiming a shift", () => {
    const outcome = detectRegimeShift({
      ...base,
      current: "RISK_ON",
      previous: "NEUTRAL",
      consecutivePasses: 1,
    });
    assert.ok("reason" in outcome, "one noisy pass must not flip the regime");
  });

  it("reports a shift that has held", () => {
    const outcome = detectRegimeShift({
      ...base,
      current: "RISK_ON",
      previous: "NEUTRAL",
      consecutivePasses: 6,
    });
    assert.ok(!("reason" in outcome));
    if (!("reason" in outcome)) {
      assert.equal(outcome.context.from, "NEUTRAL");
      assert.equal(outcome.context.to, "RISK_ON");
      assert.match(String(outcome.context.caveat), /assets Strata covers/);
    }
  });

  it("says nothing when the regime is unchanged", () => {
    const outcome = detectRegimeShift({
      ...base,
      current: "RISK_ON",
      previous: "RISK_ON",
      consecutivePasses: 10,
    });
    assert.ok("reason" in outcome);
  });

  it("needs two computed states before it can compare", () => {
    const outcome = detectRegimeShift({
      ...base,
      current: "RISK_ON",
      previous: null,
      consecutivePasses: 10,
    });
    assert.ok("reason" in outcome);
  });
});

/* ------------------------------------------------- lifecycle and dedupe -- */

describe("event lifecycle", () => {
  const detection = (magnitude = 10, significance = 0.5) => ({
    assetId: "asset-1",
    symbol: "TEST",
    assetType: "crypto" as const,
    eventType: "STRENGTH_ACCELERATION" as const,
    magnitude,
    significance: {
      magnitude: 0.8,
      persistence: persistenceOf(1),
      historicalDeviation: 0.9,
      dataConfidence: 0.9,
      value: significance,
    },
    confidence: 0.8,
    driverAgreement: 0.9,
    drivers: [],
    context: {},
    value: 70,
  });

  const openMap = (events: IntelligenceEvent[]) =>
    new Map(events.map((e) => [eventKey(e.assetId, e.eventType), e]));

  it("creates one event on first detection", () => {
    const result = reconcile({
      detections: [detection()],
      open: new Map(),
      computationVersion: "v1",
    });
    assert.equal(result.created, 1);
    assert.equal(result.updated, 0);
    assert.equal(result.upserts[0]?.status, "detected");
    assert.equal(result.upserts[0]?.observations, 1);
  });

  /**
   * The acceptance criterion from the spec: ten computation passes over
   * unchanged inputs must leave one active event, not ten. Enforced twice —
   * here in reconciliation, and in the schema by a partial unique index over
   * (asset_id, event_type) restricted to open rows.
   */
  it("does NOT create duplicates when the condition persists", () => {
    let open = new Map<string, IntelligenceEvent>();
    let created = 0;

    for (let pass = 0; pass < 10; pass += 1) {
      const result = reconcile({
        detections: [detection()],
        open,
        computationVersion: "v1",
      });
      created += result.created;
      open = openMap(result.upserts);
    }

    assert.equal(created, 1, "ten identical passes must produce one event");
    assert.equal(open.size, 1);
    assert.equal([...open.values()][0]?.observations, 10);
    assert.equal([...open.values()][0]?.status, "active");
  });

  it("grows significance as a condition holds", () => {
    const first = reconcile({
      detections: [detection()],
      open: new Map(),
      computationVersion: "v1",
    });
    const second = reconcile({
      detections: [detection()],
      open: openMap(first.upserts),
      computationVersion: "v1",
    });

    assert.ok(
      second.upserts[0]!.significance.persistence >
        first.upserts[0]!.significance.persistence,
      "a condition seen twice should count for more than one seen once",
    );
  });

  it("preserves the original detection time as the event evolves", () => {
    const first = reconcile({
      detections: [detection()],
      open: new Map(),
      computationVersion: "v1",
      now: "2026-01-08T10:00:00.000Z",
    });

    const second = reconcile({
      detections: [detection(20)],
      open: openMap(first.upserts),
      computationVersion: "v1",
      now: "2026-01-08T10:30:00.000Z",
    });

    assert.equal(second.upserts[0]?.detectedAt, "2026-01-08T10:00:00.000Z");
    assert.equal(second.upserts[0]?.latestAt, "2026-01-08T10:30:00.000Z");
    assert.equal(second.upserts[0]?.magnitude, 20);
    assert.equal(second.upserts[0]?.firstValue, 70, "the first reading is kept");
  });

  it("resolves an event when the condition disappears", () => {
    const first = reconcile({
      detections: [detection()],
      open: new Map(),
      computationVersion: "v1",
      now: "2026-01-08T10:00:00.000Z",
    });

    const second = reconcile({
      detections: [],
      open: openMap(first.upserts),
      computationVersion: "v1",
      now: "2026-01-08T10:05:00.000Z",
    });

    assert.equal(second.resolved.length, 1);
    assert.equal(second.expired.length, 0);
    assert.equal(second.resolved[0]?.status, "resolved");
    assert.equal(second.resolved[0]?.resolvedAt, "2026-01-08T10:05:00.000Z");
  });

  it("expires rather than resolves an event that stopped being observed", () => {
    // a pipeline outage must never read as a market change
    const first = reconcile({
      detections: [detection()],
      open: new Map(),
      computationVersion: "v1",
      now: "2026-01-08T10:00:00.000Z",
    });

    const later = reconcile({
      detections: [],
      open: openMap(first.upserts),
      computationVersion: "v1",
      now: "2026-01-09T10:00:00.000Z",
    });

    assert.equal(later.expired.length, 1);
    assert.equal(later.resolved.length, 0);
    assert.equal(later.expired[0]?.status, "expired");
  });

  it("keeps different event types on one asset separate", () => {
    const momentum = { ...detection(), eventType: "MOMENTUM_SHIFT" as const };
    const result = reconcile({
      detections: [detection(), momentum],
      open: new Map(),
      computationVersion: "v1",
    });
    assert.equal(result.created, 2);
    assert.equal(new Set(result.upserts.map((e) => e.eventType)).size, 2);
  });

  it("drops detections below the significance floor", () => {
    const result = reconcile({
      detections: [detection(10, SIGNIFICANCE.minimum - 0.01)],
      open: new Map(),
      computationVersion: "v1",
    });
    assert.equal(result.created, 0);
    assert.equal(result.upserts.length, 0);
  });
});

/* ------------------------------------------------ severity and priority -- */

describe("severity and priority", () => {
  it("derives severity from significance, not from the score", () => {
    assert.equal(severityFor(0.7), "critical");
    assert.equal(severityFor(0.5), "high");
    assert.equal(severityFor(0.35), "medium");
    assert.equal(severityFor(0.1), "low");
  });

  it("orders the feed by significance, confidence and persistence", () => {
    const strong = priorityFor({ significance: 0.8, confidence: 0.9, observations: 6 });
    const weak = priorityFor({ significance: 0.2, confidence: 0.3, observations: 1 });
    assert.ok(strong > weak);
    assert.ok(strong <= 1 && weak >= 0);
  });

  it("is deterministic", () => {
    const args = { significance: 0.55, confidence: 0.62, observations: 3 };
    assert.equal(priorityFor(args), priorityFor(args));
  });
});

/* ----------------------------------------------- false positive control -- */

describe("false positive control", () => {
  it("does not raise high severity from a single-metric spike on weak data", () => {
    const outcome = detectAnomaly(
      input({ volumeSeries: series([...jitter(20, 29), 400]), dataConfidence: 0.4 }),
    );
    assert.ok(isDetection(outcome));
    if (isDetection(outcome)) {
      const severity = severityFor(outcome.significance.value);
      assert.ok(
        severity === "low" || severity === "medium",
        `a first, single-metric spike on weak data reached ${severity}`,
      );
    }
  });

  it("keeps a first sighting at the unconfirmed persistence floor", () => {
    const outcome = detectStrengthAcceleration(
      input({ scoreSeries: series([...jitter(60, 25), 63, 66, 69, 72, 75]) }),
    );
    assert.ok(isDetection(outcome));
    if (isDetection(outcome)) {
      assert.equal(outcome.significance.persistence, SIGNIFICANCE.persistenceFloor);
    }
  });

  it("does not let a temporary reversal register as deterioration", () => {
    // score dips and recovers to where it began: no net change over the window
    const outcome = detectStrengthDeterioration(
      input({ scoreSeries: series([...jitter(60, 22), 55, 50, 47, 52, 57, 59, 60, 60]) }),
    );
    assert.ok(!isDetection(outcome));
  });

  it("surfaces conflicting evidence rather than hiding it", () => {
    const falling = series([...jitter(70, 25), 60, 55, 50, 45, 40]);
    const outcome = detectStrengthAcceleration(
      input({
        scoreSeries: series([...jitter(60, 25), 63, 66, 69, 72, 75]),
        momentumSeries: falling,
        trendSeries: falling,
        volumeSeries: falling,
      }),
    );

    assert.ok(isDetection(outcome));
    if (isDetection(outcome)) {
      assert.ok(
        outcome.driverAgreement < 0,
        "components moving against the event must produce negative agreement",
      );
      assert.ok(
        outcome.confidence < 0.7,
        "conflicting evidence must cost the event confidence",
      );
    }
  });
});
