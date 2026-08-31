import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SCORING_V1, scoringConfig } from "../src/config/scoring.ts";
import { buildFeatures } from "../src/compute/features/index.ts";
import {
  acceleration,
  annualisedVolatility,
  linearRegression,
  medianOf,
  percentileOf,
  relativeToBaseline,
  returns,
  stdDev,
  stripOutliers,
  zScore,
} from "../src/compute/features/series.ts";
import {
  computeActivity,
  computeLiquidity,
  computeMomentum,
  computeRelativeStrength,
  computeTrend,
  computeVolatility,
  computeVolume,
  type EngineInput,
} from "../src/compute/engines/index.ts";
import { computeStrataScore } from "../src/compute/score/v1.ts";
import {
  computeBreadth,
  computeRegime,
  detectAnomalies,
} from "../src/intelligence/market.ts";
import { rankAssets } from "../src/rankings/service.ts";
import { DETECTORS } from "../src/signals/detectors/index.ts";
import { runDetectors } from "../src/signals/engine.ts";
import type { Asset, NormalizedMarketData, Observation } from "../src/types/domain.ts";
import type { EngineOutputs } from "../src/types/intelligence.ts";

/**
 * COMPUTATION ENGINE TESTS
 *
 * These assert two things the product depends on and cannot verify by
 * inspection: that the arithmetic is right, and that missing data never
 * becomes a number.
 *
 * The second is the one worth the effort. It is easy to write a scoring
 * engine that is correct when every input is present and quietly wrong when
 * they are not, and a market data pipeline is missing inputs constantly. So
 * most of what follows feeds the engines incomplete data and asserts they
 * decline to answer, rather than feeding them complete data and asserting
 * they answer well.
 */

/* ------------------------------------------------------------ helpers --- */

const HOUR = 3_600_000;
/** A fixed evaluation instant, so every fixture is deterministic. */
const NOW = Date.now();

function observations(
  prices: number[],
  options: { volumes?: number[]; spacingMs?: number; endAt?: number } = {},
): Observation[] {
  const spacing = options.spacingMs ?? HOUR;
  // windows in the feature engine are measured against the real clock, so
  // fixtures must sit in the recent past to land inside them
  const endAt = options.endAt ?? NOW;
  const start = endAt - (prices.length - 1) * spacing;
  return prices.map((price, i) => ({
    timestamp: new Date(start + i * spacing).toISOString(),
    price,
    volume24h: options.volumes ? (options.volumes[i] ?? null) : 1_000_000,
    liquidity: null,
    tradeCount24h: null,
    uniqueParticipants24h: null,
  }));
}

function snapshot(overrides: Partial<NormalizedMarketData> = {}): NormalizedMarketData {
  return {
    symbol: "TEST",
    assetType: "crypto",
    name: "Test Asset",
    chain: null,
    contractAddress: null,
    logoUrl: null,
    price: 100,
    priceChange1h: null,
    priceChange24h: null,
    volume24h: null,
    marketCap: null,
    liquidity: null,
    tradeCount24h: null,
    uniqueParticipants24h: null,
    timestamp: new Date(Date.UTC(2026, 0, 8)).toISOString(),
    retrievedAt: new Date(Date.UTC(2026, 0, 8)).toISOString(),
    sourceTimestamp: new Date(Date.UTC(2026, 0, 8)).toISOString(),
    source: "test",
    isMock: false,
    missingFields: [],
    ...overrides,
  };
}

function engineInput(overrides: Partial<EngineInput> = {}): EngineInput {
  const current = overrides.current ?? snapshot();
  const history = overrides.history ?? [];
  return {
    current,
    history,
    features:
      overrides.features ??
      buildFeatures({
        current,
        history,
        benchmarkChange24h: null,
        peerVolumes: [],
        peerChanges: [],
        now: NOW,
      }),
    peerVolumes: overrides.peerVolumes ?? [],
    peerChanges: overrides.peerChanges ?? [],
    peerActivity: overrides.peerActivity ?? [],
    previousMomentum: overrides.previousMomentum ?? null,
  };
}

/** An engine output set where nothing computed — the worst realistic case. */
function emptyEngines(): EngineOutputs {
  const none = (reason: string) => ({ score: null, unavailableReason: reason });
  return {
    momentum: { ...none("no data"), direction: null, change: null, timeframes: [] },
    volume: { ...none("no data"), regime: null, relativeVolume: null, acceleration: null },
    activity: { ...none("no data"), basis: null },
    liquidity: { ...none("no data"), state: null, changePct: null },
    volatility: {
      ...none("no data"),
      shortTermPct: null,
      mediumTermPct: null,
      expansion: null,
    },
    relativeStrength: {
      ...none("no data"),
      excessReturnPct: null,
      benchmarkId: null,
      benchmarkLabel: null,
    },
    trend: { ...none("no data"), state: null, slopePctPerDay: null, fitQuality: null },
  };
}

function withComponents(values: Partial<Record<string, number>>): EngineOutputs {
  const engines = emptyEngines();
  if (values.momentum !== undefined) {
    engines.momentum = {
      score: values.momentum,
      direction: "rising",
      change: null,
      timeframes: ["24h"],
      unavailableReason: null,
    };
  }
  if (values.volume !== undefined) {
    engines.volume = {
      score: values.volume,
      regime: "NORMAL",
      relativeVolume: 1,
      acceleration: null,
      unavailableReason: null,
    };
  }
  if (values.trend !== undefined) {
    engines.trend = {
      score: values.trend,
      state: "UPTREND",
      slopePctPerDay: 1,
      fitQuality: 0.8,
      unavailableReason: null,
    };
  }
  if (values.relativeStrength !== undefined) {
    engines.relativeStrength = {
      score: values.relativeStrength,
      excessReturnPct: 2,
      benchmarkId: "crypto-majors",
      benchmarkLabel: "Crypto majors",
      unavailableReason: null,
    };
  }
  if (values.liquidity !== undefined) {
    engines.liquidity = {
      score: values.liquidity,
      state: "stable",
      changePct: 0,
      unavailableReason: null,
    };
  }
  if (values.activity !== undefined) {
    engines.activity = {
      score: values.activity,
      basis: "onchain",
      unavailableReason: null,
    };
  }
  if (values.volatility !== undefined) {
    engines.volatility = {
      score: values.volatility,
      shortTermPct: 40,
      mediumTermPct: 40,
      expansion: 1,
      unavailableReason: null,
    };
  }
  return engines;
}

/* ------------------------------------------------------------- series --- */

describe("series mathematics", () => {
  it("refuses a standard deviation of one observation", () => {
    // dispersion of a single point is undefined, not zero
    assert.equal(stdDev([5]), null);
    assert.notEqual(stdDev([5, 7]), null);
  });

  it("computes returns between consecutive prices", () => {
    assert.deepEqual(returns([100, 110, 99]), [0.1, -0.1]);
  });

  it("fits a known slope exactly", () => {
    const fit = linearRegression([0, 1, 2, 3], [10, 12, 14, 16]);
    assert.ok(fit);
    assert.equal(Number(fit.slope.toFixed(6)), 2);
    assert.equal(Number(fit.r2.toFixed(6)), 1);
  });

  it("returns null rather than fitting a line to two points", () => {
    assert.equal(linearRegression([0, 1], [1, 2]), null);
  });

  it("places a value in a distribution", () => {
    assert.equal(percentileOf(5, [1, 2, 3, 4]), 100);
    assert.equal(percentileOf(0, [1, 2, 3, 4]), 0);
  });

  it("measures against a median baseline, not a mean", () => {
    // one prior spike must not raise the bar for the next
    const baseline = [10, 10, 10, 10, 1000];
    assert.equal(relativeToBaseline(20, baseline), 2);
  });

  it("declines a z-score when the baseline has no dispersion", () => {
    assert.equal(zScore(5, [3, 3, 3]), null);
  });

  it("annualises volatility on the stated cadence", () => {
    const daily = [0.01, -0.01, 0.02, -0.02];
    const annual = annualisedVolatility(daily, 365);
    assert.ok(annual !== null && annual > 0);
    // hourly sampling of the same dispersion annualises higher
    const hourly = annualisedVolatility(daily, 8_760) as number;
    assert.ok(hourly > (annual as number));
  });

  it("strips an implausible return without touching the rest", () => {
    const prices = [100, 101, 102, 103, 100_000, 104, 105, 106];
    const { cleaned, removed } = stripOutliers(prices, 3);
    assert.equal(removed, 1);
    assert.ok(!cleaned.includes(100_000));
  });

  it("detects a building move as positive acceleration", () => {
    const building = acceleration([100, 100.1, 100.2, 101, 102.5]);
    const fading = acceleration([100, 102.5, 103.5, 103.6, 103.7]);
    assert.ok(building !== null && fading !== null);
    assert.ok(building > 0);
    assert.ok(fading < 0);
  });

  it("is deterministic", () => {
    const prices = [10, 11, 12, 11, 13, 14, 13, 15];
    assert.equal(medianOf(prices), medianOf(prices));
    assert.deepEqual(linearRegression([0, 1, 2, 3], [1, 2, 3, 5]), linearRegression([0, 1, 2, 3], [1, 2, 3, 5]));
  });
});

/* ----------------------------------------------------------- features --- */

describe("feature engineering", () => {
  it("reports a reason instead of a value when history is absent", () => {
    const features = buildFeatures({
      current: snapshot(),
      history: [],
      benchmarkChange24h: null,
      peerVolumes: [],
      peerChanges: [],
      now: NOW,
    });

    assert.equal(features.priceChange7d.value, null);
    assert.ok(features.priceChange7d.unavailableReason);
    assert.equal(features.volatility.value, null);
    assert.equal(features.trendStrength.value, null);
  });

  it("refuses a windowed change that does not span its window", () => {
    // ten minutes of history cannot describe a 24-hour change
    const recent = observations([100, 101, 102], { spacingMs: 5 * 60_000 });
    const features = buildFeatures({
      current: snapshot(),
      history: recent,
      benchmarkChange24h: null,
      peerVolumes: [],
      peerChanges: [],
      now: NOW,
    });

    assert.equal(features.priceChange24h.value, null);
    assert.match(features.priceChange24h.unavailableReason ?? "", /spans only/);
  });

  it("prefers the provider's published change over a derived one", () => {
    const features = buildFeatures({
      current: snapshot({ priceChange24h: 4.2 }),
      history: observations([100, 101]),
      benchmarkChange24h: null,
      peerVolumes: [],
      peerChanges: [],
      now: NOW,
    });
    assert.equal(features.priceChange24h.value, 4.2);
  });

  it("computes relative strength only against a real benchmark", () => {
    const withBenchmark = buildFeatures({
      current: snapshot({ priceChange24h: 5 }),
      history: [],
      benchmarkChange24h: 2,
      peerVolumes: [],
      peerChanges: [1, 2, 3, 4],
      now: NOW,
    });
    assert.equal(withBenchmark.relativeStrength.value, 3);

    const without = buildFeatures({
      current: snapshot({ priceChange24h: 5 }),
      history: [],
      benchmarkChange24h: null,
      peerVolumes: [],
      peerChanges: [],
      now: NOW,
    });
    assert.equal(without.relativeStrength.value, null);
  });

  it("produces identical features for identical inputs", () => {
    const history = observations([100, 102, 101, 104, 106, 105, 108, 110, 112]);
    const build = () =>
      buildFeatures({
        current: snapshot({ priceChange24h: 2, volume24h: 5_000_000 }),
        history,
        benchmarkChange24h: 1,
        peerVolumes: [1e6, 2e6, 3e6],
        peerChanges: [1, 2, 3],
        now: NOW,
      });
    assert.deepEqual(build(), build());
  });
});

/* ------------------------------------------------------------ engines --- */

describe("momentum engine", () => {
  it("renormalises over the timeframes that exist", () => {
    const only24h = computeMomentum(
      engineInput({ current: snapshot({ priceChange24h: 6 }) }),
    );
    assert.ok(only24h.score !== null);
    assert.deepEqual(only24h.timeframes, ["24h"]);
    // a single available timeframe is scored on its own merit, not diluted
    assert.ok(only24h.score > 50);
  });

  it("declines when no timeframe is available", () => {
    const result = computeMomentum(engineInput());
    assert.equal(result.score, null);
    assert.equal(result.direction, null);
    assert.ok(result.unavailableReason);
  });

  it("reports direction and change against the previous pass", () => {
    const result = computeMomentum(
      engineInput({
        current: snapshot({ priceChange24h: -4 }),
        previousMomentum: 60,
      }),
    );
    assert.equal(result.direction, "falling");
    assert.ok(result.change !== null && result.change < 0);
  });
});

describe("volume engine", () => {
  it("classifies a regime against the asset's own baseline", () => {
    const history = observations(Array(20).fill(100), {
      volumes: Array(20).fill(1_000_000),
    });
    const result = computeVolume(
      engineInput({
        current: snapshot({ volume24h: 3_000_000 }),
        history,
        peerVolumes: [1e6, 2e6, 3e6],
      }),
    );
    assert.equal(result.regime, "HIGH");
    assert.ok(result.relativeVolume !== null && result.relativeVolume >= 2.5);
  });

  it("withholds a regime when there is no baseline to judge against", () => {
    const result = computeVolume(
      engineInput({
        current: snapshot({ volume24h: 3_000_000 }),
        peerVolumes: [1e6, 2e6, 3e6],
      }),
    );
    assert.equal(result.regime, null);
    assert.ok(result.score !== null, "peer placement is still possible");
  });

  it("declines entirely when no volume was published", () => {
    const result = computeVolume(engineInput());
    assert.equal(result.score, null);
    assert.ok(result.unavailableReason);
  });
});

describe("volatility engine", () => {
  it("scores a calm series above a violent one", () => {
    const calm = computeVolatility(
      engineInput({ history: observations([100, 100.1, 100, 100.2, 100.1, 100.3, 100.2, 100.4, 100.3, 100.5]) }),
    );
    const violent = computeVolatility(
      engineInput({ history: observations([100, 130, 80, 140, 70, 150, 60, 160, 50, 170]) }),
    );
    assert.ok(calm.score !== null && violent.score !== null);
    assert.ok(calm.score > violent.score, "calmer markets score higher");
  });

  it("declines without enough observations", () => {
    const result = computeVolatility(engineInput({ history: observations([100, 101]) }));
    assert.equal(result.score, null);
  });
});

describe("trend engine", () => {
  it("identifies a clean uptrend", () => {
    const rising = observations([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
    const result = computeTrend(engineInput({ history: rising }));
    assert.ok(result.state === "UPTREND" || result.state === "STRONG_UPTREND");
    assert.ok(result.slopePctPerDay !== null && result.slopePctPerDay > 0);
    assert.ok(result.fitQuality !== null && result.fitQuality > 0.9);
  });

  it("identifies a downtrend", () => {
    const falling = observations([109, 108, 107, 106, 105, 104, 103, 102, 101, 100]);
    const result = computeTrend(engineInput({ history: falling }));
    assert.ok(result.state === "DOWNTREND" || result.state === "STRONG_DOWNTREND");
  });

  it("stays neutral on noise with no direction", () => {
    const noise = observations([100, 101, 99, 102, 98, 101, 99, 100, 101, 99]);
    const result = computeTrend(engineInput({ history: noise }));
    // a poor fit must not be reported as a trend
    assert.equal(result.state, "NEUTRAL");
  });

  it("declines without enough observations", () => {
    assert.equal(computeTrend(engineInput({ history: observations([100, 101]) })).state, null);
  });
});

describe("relative strength engine", () => {
  it("requires a benchmark with enough members", () => {
    const thin = computeRelativeStrength(
      engineInput({
        current: snapshot({ priceChange24h: 5 }),
        peerChanges: [1, 2],
        features: buildFeatures({
          current: snapshot({ priceChange24h: 5 }),
          history: [],
          benchmarkChange24h: 2,
          peerVolumes: [],
          peerChanges: [1, 2],
          now: NOW,
        }),
      }),
      "crypto",
    );
    assert.equal(thin.score, null);
    assert.match(thin.unavailableReason ?? "", /members/);
  });

  it("scores outperformance above underperformance", () => {
    const make = (change: number) =>
      computeRelativeStrength(
        engineInput({
          current: snapshot({ priceChange24h: change }),
          peerChanges: [1, 1, 1, 1, 1],
          features: buildFeatures({
            current: snapshot({ priceChange24h: change }),
            history: [],
            benchmarkChange24h: 1,
            peerVolumes: [],
            peerChanges: [1, 1, 1, 1, 1],
            now: NOW,
          }),
        }),
        "crypto",
      );

    const strong = make(6);
    const weak = make(-4);
    assert.ok(strong.score !== null && weak.score !== null);
    assert.ok(strong.score > weak.score);
    assert.equal(strong.benchmarkId, "crypto-majors");
  });
});

describe("activity and liquidity engines", () => {
  it("states which basis stood in for activity", () => {
    const onchain = computeActivity(
      engineInput({
        current: snapshot({ tradeCount24h: 5_000 }),
        peerActivity: [1_000, 2_000, 3_000],
      }),
    );
    assert.equal(onchain.basis, "onchain");

    const market = computeActivity(
      engineInput({ current: snapshot({ volume24h: 1e6, marketCap: 1e8 }) }),
    );
    assert.equal(market.basis, "market");
  });

  it("never fabricates liquidity", () => {
    const result = computeLiquidity(engineInput());
    assert.equal(result.score, null);
    assert.equal(result.state, null);
    assert.match(result.unavailableReason ?? "", /no liquidity/);
  });
});

/* -------------------------------------------------------------- score --- */

describe("strata score v1", () => {
  it("refuses to score without the required component", () => {
    const result = computeStrataScore({
      engines: withComponents({ volume: 80, trend: 70, liquidity: 60, activity: 55 }),
      ageSeconds: 10,
      historyPoints: 100,
    });
    assert.equal(result.status, "INSUFFICIENT_DATA");
    assert.equal(result.score, null);
    assert.match(result.insufficientReason ?? "", /momentum/);
  });

  it("refuses to score below the coverage floor", () => {
    const result = computeStrataScore({
      engines: withComponents({ momentum: 90 }),
      ageSeconds: 10,
      historyPoints: 100,
    });
    assert.equal(result.status, "INSUFFICIENT_DATA");
    assert.equal(result.score, null);
    assert.match(result.insufficientReason ?? "", /scoring weight/);
  });

  it("never treats a missing component as zero", () => {
    // identical present components; one set is simply missing more of them
    const full = computeStrataScore({
      engines: withComponents({
        momentum: 80,
        volume: 80,
        trend: 80,
        relativeStrength: 80,
        liquidity: 80,
        activity: 80,
        volatility: 80,
      }),
      ageSeconds: 10,
      historyPoints: 100,
    });
    const partial = computeStrataScore({
      engines: withComponents({ momentum: 80, volume: 80, trend: 80, relativeStrength: 80 }),
      ageSeconds: 10,
      historyPoints: 100,
    });

    assert.equal(full.status, "OK");
    assert.equal(partial.status, "OK");
    // renormalisation means the partial score is not dragged toward zero
    assert.equal(full.score, 80);
    assert.equal(partial.score, 80);
  });

  it("reports lower confidence for the thinner input set", () => {
    const full = computeStrataScore({
      engines: withComponents({
        momentum: 80, volume: 80, trend: 80, relativeStrength: 80,
        liquidity: 80, activity: 80, volatility: 80,
      }),
      ageSeconds: 10,
      historyPoints: 100,
    });
    const partial = computeStrataScore({
      engines: withComponents({ momentum: 80, volume: 80, trend: 80, relativeStrength: 80 }),
      ageSeconds: 10,
      historyPoints: 100,
    });
    assert.ok(partial.confidence.value < full.confidence.value);
    assert.equal(full.confidence.componentsAvailable, 7);
    assert.equal(partial.confidence.componentsAvailable, 4);
  });

  it("separates a high score from low confidence", () => {
    const result = computeStrataScore({
      engines: withComponents({ momentum: 95, volume: 92, trend: 90, relativeStrength: 88 }),
      // stale observation, no history
      ageSeconds: 80_000,
      historyPoints: 2,
    });
    assert.equal(result.status, "OK");
    assert.ok((result.score as number) > 85, "the score stays high");
    assert.equal(result.confidence.band, "LOW", "confidence reports the weakness");
  });

  it("decays confidence with the age of the observation", () => {
    const engines = withComponents({
      momentum: 70, volume: 70, trend: 70, relativeStrength: 70, liquidity: 70,
    });
    const fresh = computeStrataScore({ engines, ageSeconds: 5, historyPoints: 100 });
    const stale = computeStrataScore({ engines, ageSeconds: 40_000, historyPoints: 100 });
    assert.ok(stale.confidence.freshness < fresh.confidence.freshness);
    assert.equal(fresh.score, stale.score, "age changes confidence, never the score");
  });

  it("explains the score from measured quantities", () => {
    const result = computeStrataScore({
      engines: withComponents({
        momentum: 90, volume: 85, trend: 80, relativeStrength: 30, liquidity: 60,
      }),
      ageSeconds: 10,
      historyPoints: 100,
    });

    assert.ok(result.drivers.length > 0);
    // ordered by absolute contribution, strongest first
    const magnitudes = result.drivers.map((d) => Math.abs(d.contribution));
    assert.deepEqual(magnitudes, [...magnitudes].sort((a, b) => b - a));
    // the weak component is reported as a negative driver
    assert.ok(result.drivers.some((d) => d.component === "relativeStrength" && d.direction === "negative"));
    // every driver carries a factual detail, not a generic phrase
    assert.ok(result.drivers.every((d) => d.detail.length > 0));
  });

  it("records why each missing component is missing", () => {
    const result = computeStrataScore({
      engines: withComponents({ momentum: 70, volume: 70, trend: 70, relativeStrength: 70 }),
      ageSeconds: 10,
      historyPoints: 100,
    });
    assert.equal(result.missing.length, 3);
    assert.ok(result.missing.every((m) => m.reason.length > 0));
  });

  it("is deterministic and version-stamped", () => {
    const engines = withComponents({
      momentum: 64, volume: 71, trend: 58, relativeStrength: 49, liquidity: 66,
    });
    const a = computeStrataScore({ engines, ageSeconds: 30, historyPoints: 50 });
    const b = computeStrataScore({ engines, ageSeconds: 30, historyPoints: 50 });
    assert.equal(a.score, b.score);
    assert.deepEqual(a.components, b.components);
    assert.equal(a.version, SCORING_V1.version);
  });

  it("honours a version's own weights", () => {
    const config = scoringConfig("v1");
    const total = Object.values(config.weights).reduce((s, w) => s + w, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, "weights sum to 1");
  });
});

/* ------------------------------------------------------------ signals --- */

describe("signal detection", () => {
  const asset = { assetId: "a1", symbol: "TEST" };

  it("stays silent when there is no baseline to judge against", () => {
    const result = runDetectors([
      {
        ...asset,
        current: snapshot({ priceChange24h: 40, volume24h: 9e9 }),
        history: [],
        classPeers: [],
      },
    ]);
    assert.equal(result.signals.length, 0, "no history means no signal");
  });

  it("fires a volume signal against a real baseline", () => {
    const history = observations(Array(20).fill(100), {
      volumes: Array(20).fill(1_000_000),
    });
    const result = runDetectors([
      {
        ...asset,
        current: snapshot({ volume24h: 5_000_000 }),
        history,
        classPeers: [],
      },
    ]);
    const signal = result.signals.find((s) => s.signalType === "VOLUME_ACCELERATION");
    assert.ok(signal, "a 5x volume day is a signal");
    assert.ok(["high", "critical"].includes(signal.severity));
    assert.ok(new Date(signal.expiresAt).getTime() > new Date(signal.timestamp).getTime());
  });

  it("scales severity with magnitude", () => {
    const history = observations(Array(20).fill(100), {
      volumes: Array(20).fill(1_000_000),
    });
    const fire = (volume: number) =>
      runDetectors([
        { ...asset, current: snapshot({ volume24h: volume }), history, classPeers: [] },
      ]).signals.find((s) => s.signalType === "VOLUME_ACCELERATION");

    assert.equal(fire(1_100_000), undefined, "an ordinary day is not a signal");
    assert.equal(fire(1_700_000)?.severity, "low");
    assert.equal(fire(7_000_000)?.severity, "critical");
  });

  it("reports a rank move with its direction", () => {
    const result = runDetectors([
      { ...asset, current: snapshot(), history: [], classPeers: [], rank: 4, previous: { rank: 20 } },
    ]);
    const signal = result.signals.find((s) => s.signalType === "RANK_CHANGE");
    assert.ok(signal);
    assert.equal(signal.metadata.direction, "up");
    assert.equal(signal.value, 16);
  });

  it("isolates a detector that throws", () => {
    const exploding = {
      type: "MOMENTUM_SPIKE" as const,
      description: "throws",
      detect() {
        throw new Error("boom");
      },
    };
    const result = runDetectors(
      [{ ...asset, current: snapshot(), history: [], classPeers: [] }],
      [exploding],
    );
    assert.equal(result.failures, 1);
    assert.equal(result.signals.length, 0);
  });

  it("registers every declared signal type exactly once", () => {
    const types = DETECTORS.map((d) => d.type);
    assert.equal(new Set(types).size, types.length);
    assert.equal(DETECTORS.length, 10);
  });
});

/* ---------------------------------------------------------- anomalies --- */

describe("anomaly detection", () => {
  it("flags nothing without enough history", () => {
    const anomalies = detectAnomalies("a1", "TEST", snapshot({ volume24h: 1e9 }), []);
    assert.equal(anomalies.length, 0);
  });

  it("flags volume far outside the asset's own baseline", () => {
    const history = observations(Array(20).fill(100), {
      volumes: Array(20).fill(1_000_000),
    });
    const anomalies = detectAnomalies("a1", "TEST", snapshot({ volume24h: 6_000_000 }), history);
    const volume = anomalies.find((a) => a.kind === "volume");
    assert.ok(volume);
    assert.ok(volume.magnitude >= 4);
    assert.equal(volume.baselineSamples, 19);
    assert.match(volume.detail, /median/);
  });

  it("does not flag ordinary behaviour", () => {
    const history = observations(Array(20).fill(100), {
      volumes: Array(20).fill(1_000_000),
    });
    const anomalies = detectAnomalies("a1", "TEST", snapshot({ volume24h: 1_200_000 }), history);
    assert.equal(anomalies.length, 0);
  });
});

/* ------------------------------------------------------------- market --- */

describe("market breadth", () => {
  it("counts advancing, declining and unchanged", () => {
    const breadth = computeBreadth([
      { assetType: "crypto", priceChange24h: 2 },
      { assetType: "crypto", priceChange24h: -3 },
      { assetType: "crypto", priceChange24h: 0.01 },
      { assetType: "stock", priceChange24h: 1 },
      { assetType: "stock", priceChange24h: null },
    ]);

    assert.equal(breadth.overall.advancing, 2);
    assert.equal(breadth.overall.declining, 1);
    assert.equal(breadth.overall.unchanged, 1);
    // the null is excluded entirely rather than counted as unchanged
    assert.equal(breadth.overall.total, 4);
    assert.equal(breadth.byClass.stock.total, 1);
  });

  it("returns a null ratio when nothing moved", () => {
    const breadth = computeBreadth([
      { assetType: "crypto", priceChange24h: 0 },
      { assetType: "crypto", priceChange24h: 0 },
    ]);
    assert.equal(breadth.overall.advanceDeclineRatio, null);
  });
});

describe("market regime", () => {
  const many = (change: number, count: number) =>
    Array.from({ length: count }, () => ({ assetType: "crypto" as const, priceChange24h: change }));

  it("refuses a regime from too few assets", () => {
    const regime = computeRegime(many(3, 4));
    assert.equal(regime.status, "INSUFFICIENT_DATA");
    assert.equal(regime.state, null);
    assert.match(regime.insufficientReason ?? "", /needs 8/);
  });

  it("reports risk-on when breadth is broadly positive", () => {
    const regime = computeRegime([...many(2, 9), ...many(-1, 1)]);
    assert.equal(regime.state, "RISK_ON");
    assert.ok(regime.drivers.length > 0);
  });

  it("reports risk-off when breadth is broadly negative", () => {
    const regime = computeRegime([...many(-2, 9), ...many(1, 1)]);
    assert.equal(regime.state, "RISK_OFF");
  });

  it("lets volatility override direction", () => {
    // broadly advancing, but violently — not risk-on in any useful sense
    const regime = computeRegime(many(9, 10));
    assert.equal(regime.state, "HIGH_VOLATILITY");
  });

  it("is less confident about an evenly split market", () => {
    const split = computeRegime([...many(1, 5), ...many(-1, 5)]);
    const decisive = computeRegime(many(1, 10));
    assert.ok((split.confidence as number) < (decisive.confidence as number));
  });
});

/* ------------------------------------------------------------ ranking --- */

describe("rankings", () => {
  const asset = (symbol: string): Asset => ({
    id: `id-${symbol}`,
    symbol,
    name: symbol,
    assetType: "crypto",
    chain: null,
    contractAddress: null,
    logoUrl: null,
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const rankable = (symbol: string, score: number, momentum: number | null) => ({
    asset: asset(symbol),
    intelligence: {
      assetId: `id-${symbol}`,
      symbol,
      assetType: "crypto" as const,
      score: {
        status: "OK" as const,
        score,
        version: "v1",
        components: {},
        missing: [],
        confidence: {
          value: 0.9, band: "HIGH" as const, completeness: 1, freshness: 1,
          historicalDepth: 1, componentsAvailable: 7, componentsTotal: 7,
        },
        drivers: [],
        insufficientReason: null,
        calculatedAt: "2026-01-08T00:00:00.000Z",
      },
      engines: {
        ...withComponents({}),
        momentum: {
          score: momentum, direction: null, change: null, timeframes: [],
          unavailableReason: momentum === null ? "no data" : null,
        },
      },
      historyPoints: 100,
      ageSeconds: 10,
      sources: ["test"],
      timestamp: "2026-01-08T00:00:00.000Z",
    },
  });

  it("orders by the requested metric", () => {
    const snapshot = rankAssets(
      [rankable("AAA", 50, 10), rankable("BBB", 90, 20), rankable("CCC", 70, 30)],
      { metric: "score" },
    );
    assert.deepEqual(snapshot.entries.map((e) => e.symbol), ["BBB", "CCC", "AAA"]);
  });

  it("excludes assets with no value for that metric", () => {
    const snapshot = rankAssets(
      [rankable("AAA", 50, null), rankable("BBB", 90, 20)],
      { metric: "momentum" },
    );
    assert.deepEqual(snapshot.entries.map((e) => e.symbol), ["BBB"]);
  });

  it("breaks ties deterministically", () => {
    const once = rankAssets([rankable("BBB", 70, 1), rankable("AAA", 70, 1)], {});
    const twice = rankAssets([rankable("AAA", 70, 1), rankable("BBB", 70, 1)], {});
    assert.deepEqual(
      once.entries.map((e) => e.symbol),
      twice.entries.map((e) => e.symbol),
    );
  });

  it("reports rank movement against the previous snapshot", () => {
    const snapshot = rankAssets([rankable("AAA", 90, 1), rankable("BBB", 50, 1)], {
      previousRanks: new Map([["id-AAA", 5]]),
    });
    assert.equal(snapshot.entries[0]?.change, 4);
    assert.equal(snapshot.entries[1]?.change, null);
  });
});
