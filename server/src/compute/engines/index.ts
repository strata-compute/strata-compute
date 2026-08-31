import {
  benchmarkFor,
  QUALITY,
  TREND_BANDS,
  VOLUME_REGIME,
} from "../../config/scoring.ts";
import type { AssetType, NormalizedMarketData } from "../../types/domain.ts";
import type {
  ActivityResult,
  EngineOutputs,
  FeatureSet,
  LiquidityResult,
  MomentumResult,
  RelativeStrengthResult,
  TrendResult,
  VolatilityResult,
  VolumeResult,
} from "../../types/intelligence.ts";
import { clamp, round, scaleTo100 } from "../../utils/number.ts";
import type { HistoricalObservation } from "../features/index.ts";
import { trendFit } from "../features/index.ts";
import { medianOf, percentileOf, relativeToBaseline, sortByTime } from "../features/series.ts";

/**
 * THE ENGINES
 *
 * Each engine takes measured features and produces one comparable 0–100
 * component plus the qualitative reading that belongs with it — a regime, a
 * direction, a state. They are pure functions: same features in, same
 * component out, no clock and no I/O.
 *
 * Two rules run through all of them.
 *
 * First, normalisation is cross-sectional wherever the raw unit is not
 * comparable. A $40m daily volume means something entirely different for a
 * tokenised equity than for a crypto major, so volume becomes a percentile
 * within its own class rather than a point on an absolute scale. That is what
 * lets one ranking hold three asset classes without quietly favouring the one
 * with the biggest numbers.
 *
 * Second, an engine that cannot compute returns `score: null` with a reason.
 * It never substitutes 50. A neutral default looks harmless and is not: it
 * drags every score toward the middle and makes a thinly-covered asset
 * indistinguishable from a genuinely average one.
 */

export interface EngineInput {
  current: NormalizedMarketData;
  features: FeatureSet;
  history: HistoricalObservation[];
  /** Class peers' 24h volumes, for cross-sectional placement. */
  peerVolumes: number[];
  /** Class peers' 24h changes. */
  peerChanges: number[];
  /** Class peers' trade counts. */
  peerActivity: number[];
  /** Previous momentum score for this asset, to report movement. */
  previousMomentum: number | null;
}

/* ------------------------------------------------------------ momentum --- */

export function computeMomentum(input: EngineInput): MomentumResult {
  const { priceChange1h, priceChange24h, priceChange7d } = input.features;

  const parts: { label: string; value: number; weight: number }[] = [];
  if (priceChange1h.value !== null) {
    parts.push({ label: "1h", value: priceChange1h.value, weight: 0.2 });
  }
  if (priceChange24h.value !== null) {
    parts.push({ label: "24h", value: priceChange24h.value, weight: 0.5 });
  }
  if (priceChange7d.value !== null) {
    parts.push({ label: "7d", value: priceChange7d.value, weight: 0.3 });
  }

  if (parts.length === 0) {
    return {
      score: null,
      direction: null,
      change: null,
      timeframes: [],
      unavailableReason:
        priceChange24h.unavailableReason ?? "no price change available over any timeframe",
    };
  }

  // Weights are renormalised over the timeframes that exist, so an asset with
  // only a 24h reading is scored on that reading rather than being penalised
  // for the absence of a 7d one.
  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const blended = parts.reduce((sum, p) => sum + p.value * p.weight, 0) / totalWeight;

  // ±12% spans the usable range: beyond that the difference between a large
  // move and a very large move stops carrying information for a composite.
  const score = round(scaleTo100(blended, -12, 12), 2);

  const direction =
    Math.abs(blended) < 0.15 ? "flat" : blended > 0 ? "rising" : "falling";

  return {
    score,
    direction,
    change:
      input.previousMomentum === null ? null : round(score - input.previousMomentum, 2),
    timeframes: parts.map((p) => p.label),
    unavailableReason: null,
  };
}

/* -------------------------------------------------------------- volume --- */

export function computeVolume(input: EngineInput): VolumeResult {
  const { volumeChange, volumeStrength } = input.features;
  const current = input.current.volume24h;

  if (current === null) {
    return {
      score: null,
      regime: null,
      relativeVolume: null,
      acceleration: null,
      unavailableReason: "no volume published for this asset",
    };
  }

  // Cross-sectional placement is the primary reading; the asset's own
  // baseline refines it when enough history exists to have one.
  const percentile =
    input.peerVolumes.length >= 2 ? percentileOf(current, input.peerVolumes) : null;

  const relative = volumeChange.value;

  let score: number | null;
  if (percentile !== null && relative !== null) {
    // 70/30: where it stands among peers, adjusted by whether it is busier
    // than its own normal
    const relativeScore = scaleTo100(Math.log10(clamp(relative, 0.1, 10)), -0.5, 0.7);
    score = round(percentile * 0.7 + relativeScore * 0.3, 2);
  } else if (percentile !== null) {
    score = round(percentile, 2);
  } else if (relative !== null) {
    score = round(scaleTo100(Math.log10(clamp(relative, 0.1, 10)), -0.5, 0.7), 2);
  } else {
    score = null;
  }

  if (score === null) {
    return {
      score: null,
      regime: null,
      relativeVolume: null,
      acceleration: null,
      unavailableReason:
        volumeStrength.unavailableReason ??
        volumeChange.unavailableReason ??
        "insufficient peer or historical volume to place this reading",
    };
  }

  // Regime describes the asset against its own baseline, which is the only
  // comparison that makes "elevated" mean anything. Without that baseline the
  // regime is null rather than guessed from the peer percentile.
  let regime: VolumeResult["regime"] = null;
  if (relative !== null) {
    if (relative >= VOLUME_REGIME.extreme) regime = "EXTREME";
    else if (relative >= VOLUME_REGIME.high) regime = "HIGH";
    else if (relative >= VOLUME_REGIME.elevated) regime = "ELEVATED";
    else regime = "NORMAL";
  }

  // acceleration of volume itself: recent half against earlier half
  const volumes = sortByTime(input.history.map((h) => ({ ...h, value: h.price })))
    .map((h) => (h as unknown as HistoricalObservation).volume24h)
    .filter((v): v is number => v !== null && v > 0);

  let volumeAcceleration: number | null = null;
  if (volumes.length >= QUALITY.minimumHistoryPoints) {
    const split = Math.floor(volumes.length / 2);
    const earlier = medianOf(volumes.slice(0, split));
    const recent = medianOf(volumes.slice(split));
    if (earlier !== null && recent !== null && earlier > 0) {
      volumeAcceleration = round((recent - earlier) / earlier, 4);
    }
  }

  return {
    score,
    regime,
    relativeVolume: relative === null ? null : round(relative, 3),
    acceleration: volumeAcceleration,
    unavailableReason: null,
  };
}

/* ------------------------------------------------------------ activity --- */

/**
 * Activity means different things in different markets, so the engine states
 * which measurement it used rather than pretending one number covers both.
 *
 * Onchain assets have transfer and participant counts. Tokenised equities do
 * not publish either, so market activity stands in — turnover against the
 * asset's own float-independent baseline. The two are never mixed inside one
 * distribution: each is normalised against peers measured the same way.
 */
export function computeActivity(input: EngineInput): ActivityResult {
  const { current } = input;
  const trades = current.tradeCount24h;
  const participants = current.uniqueParticipants24h;

  if (trades !== null || participants !== null) {
    const measure = trades ?? (participants as number);
    const distribution = input.peerActivity.filter((v) => v > 0);

    if (distribution.length < 2) {
      return {
        score: null,
        basis: "onchain",
        unavailableReason: `needs at least 2 peers with activity counts; have ${distribution.length}`,
      };
    }

    const percentile = percentileOf(measure, distribution);
    if (percentile === null) {
      return {
        score: null,
        basis: "onchain",
        unavailableReason: "activity distribution is not usable",
      };
    }

    // Breadth refines depth: many distinct participants behind the same
    // number of trades is a broader market than the reverse.
    let score = percentile;
    if (trades !== null && participants !== null && trades > 0) {
      const breadth = clamp(participants / trades, 0, 1);
      score = percentile * 0.75 + scaleTo100(breadth, 0.05, 0.45) * 0.25;
    }

    return { score: round(score, 2), basis: "onchain", unavailableReason: null };
  }

  // market-activity fallback: turnover relative to class peers
  if (current.volume24h !== null && current.marketCap !== null && current.marketCap > 0) {
    const turnover = current.volume24h / current.marketCap;
    return {
      score: round(scaleTo100(Math.log10(clamp(turnover, 1e-5, 1)), -4, -1), 2),
      basis: "market",
      unavailableReason: null,
    };
  }

  return {
    score: null,
    basis: null,
    unavailableReason:
      "no onchain counts published, and no volume/market-cap pair to derive market activity from",
  };
}

/* ----------------------------------------------------------- liquidity --- */

export function computeLiquidity(input: EngineInput): LiquidityResult {
  const current = input.current.liquidity;

  if (current === null) {
    return {
      score: null,
      state: null,
      changePct: null,
      unavailableReason: "no liquidity published for this asset",
    };
  }

  const history = input.history
    .map((h) => h.liquidity)
    .filter((v): v is number => v !== null && v > 0);

  // depth relative to the asset's own history, and to how much of that depth
  // actually turns over
  let changePct: number | null = null;
  let state: LiquidityResult["state"] = null;

  if (history.length >= QUALITY.minimumHistoryPoints) {
    const baseline = relativeToBaseline(current, history.slice(0, -1));
    if (baseline !== null) {
      changePct = round((baseline - 1) * 100, 3);
      state = changePct > 5 ? "expanding" : changePct < -5 ? "contracting" : "stable";
    }
  }

  // Turnover quality: a deep book that never trades is not liquid in any
  // sense a participant would recognise. Absolute depth in dollars is not
  // comparable across a tokenised equity and an onchain pool, so it is never
  // scored on its own — without turnover to measure it against, or a history
  // to measure it moving, there is nothing here worth publishing.
  let score: number | null = null;

  if (input.current.volume24h !== null && input.current.volume24h > 0) {
    const turnover = clamp(input.current.volume24h / current, 0, 3);
    score = scaleTo100(turnover, 0, 1.2);
    if (changePct !== null) {
      score = score * 0.75 + scaleTo100(changePct, -25, 25) * 0.25;
    }
  } else if (changePct !== null) {
    // no turnover, but the trajectory of the book is itself informative
    score = scaleTo100(changePct, -25, 25);
  }

  if (score === null) {
    return {
      score: null,
      state,
      changePct,
      unavailableReason:
        "liquidity is published but there is no turnover or history to place it against",
    };
  }

  return {
    score: round(clamp(score, 0, 100), 2),
    state,
    changePct,
    unavailableReason: null,
  };
}

/* ---------------------------------------------------------- volatility --- */

/**
 * Volatility enters the score as a quality term, not a performance one.
 *
 * A high reading is not automatically bad — it is how the asset moves — but a
 * composite that rewards violence rewards the wrong thing, so the component
 * is inverted: calmer markets score higher, and a score built on a violently
 * unstable price is marked down rather than celebrated.
 */
export function computeVolatility(input: EngineInput): VolatilityResult {
  const mediumTerm = input.features.volatility.value;

  if (mediumTerm === null) {
    return {
      score: null,
      shortTermPct: null,
      mediumTermPct: null,
      expansion: null,
      unavailableReason: input.features.volatility.unavailableReason,
    };
  }

  // short-term window: the most recent third of the series
  const sorted = sortByTime(input.history.map((h) => ({ ...h, value: h.price })));
  const prices = (sorted as unknown as HistoricalObservation[])
    .map((p) => p.price)
    .filter((p) => p > 0);
  const recentCount = Math.max(QUALITY.minimumHistoryPoints, Math.floor(prices.length / 3));
  const recent = prices.slice(-recentCount);

  let shortTerm: number | null = null;
  if (recent.length >= QUALITY.minimumHistoryPoints) {
    const rets: number[] = [];
    for (let i = 1; i < recent.length; i += 1) {
      const prev = recent[i - 1] as number;
      if (prev > 0) rets.push(((recent[i] as number) - prev) / prev);
    }
    if (rets.length >= 2) {
      const avg = rets.reduce((s, r) => s + r, 0) / rets.length;
      const variance = rets.reduce((s, r) => s + (r - avg) ** 2, 0) / (rets.length - 1);
      // same annualisation basis as the medium-term figure so the two compare
      shortTerm = round(Math.sqrt(variance) * Math.sqrt(8_760) * 100, 3);
    }
  }

  // 30% annualised is calm, 250% is violent — the band that spans equities
  // through small onchain tokens
  const score = round(100 - scaleTo100(Math.log10(clamp(mediumTerm, 5, 400)), 0.7, 2.6), 2);

  return {
    score: clamp(score, 0, 100),
    shortTermPct: shortTerm,
    mediumTermPct: round(mediumTerm, 3),
    expansion:
      shortTerm !== null && mediumTerm > 0 ? round(shortTerm / mediumTerm, 3) : null,
    unavailableReason: null,
  };
}

/* ---------------------------------------------------- relative strength --- */

export function computeRelativeStrength(
  input: EngineInput,
  assetType: AssetType,
): RelativeStrengthResult {
  const group = benchmarkFor(assetType);
  const excess = input.features.relativeStrength.value;

  if (group === null) {
    return {
      score: null,
      excessReturnPct: null,
      benchmarkId: null,
      benchmarkLabel: null,
      unavailableReason: `no benchmark group is configured for ${assetType} assets`,
    };
  }

  if (excess === null) {
    return {
      score: null,
      excessReturnPct: null,
      benchmarkId: group.id,
      benchmarkLabel: group.label,
      unavailableReason: input.features.relativeStrength.unavailableReason,
    };
  }

  if (input.peerChanges.length < group.minimumMembers) {
    return {
      score: null,
      excessReturnPct: round(excess, 4),
      benchmarkId: group.id,
      benchmarkLabel: group.label,
      unavailableReason: `${group.label} needs ${group.minimumMembers} members to form a benchmark; have ${input.peerChanges.length}`,
    };
  }

  // ±8 points of excess return spans the usable range for a daily comparison
  return {
    score: round(scaleTo100(excess, -8, 8), 2),
    excessReturnPct: round(excess, 4),
    benchmarkId: group.id,
    benchmarkLabel: group.label,
    unavailableReason: null,
  };
}

/* --------------------------------------------------------------- trend --- */

export function computeTrend(input: EngineInput): TrendResult {
  const fit = trendFit(input.history);

  if (fit === null) {
    return {
      score: null,
      state: null,
      slopePctPerDay: null,
      fitQuality: null,
      unavailableReason:
        input.features.trendStrength.unavailableReason ??
        "not enough observations to fit a trend",
    };
  }

  // The slope is judged against how well the line actually explains the
  // series. A steep slope through scattered points is noise wearing a trend's
  // clothes, so R² scales the reading down rather than being reported beside
  // it and ignored.
  const confidenceWeightedSlope = fit.slope * Math.sqrt(Math.max(fit.r2, 0));

  let state: TrendResult["state"];
  if (confidenceWeightedSlope >= TREND_BANDS.strongUp) state = "STRONG_UPTREND";
  else if (confidenceWeightedSlope >= TREND_BANDS.up) state = "UPTREND";
  else if (confidenceWeightedSlope <= TREND_BANDS.strongDown) state = "STRONG_DOWNTREND";
  else if (confidenceWeightedSlope <= TREND_BANDS.down) state = "DOWNTREND";
  else state = "NEUTRAL";

  return {
    score: round(scaleTo100(confidenceWeightedSlope, -2.5, 2.5), 2),
    state,
    slopePctPerDay: round(fit.slope, 4),
    fitQuality: round(clamp(fit.r2, 0, 1), 4),
    unavailableReason: null,
  };
}

/* ----------------------------------------------------------- aggregate --- */

export function runEngines(input: EngineInput, assetType: AssetType): EngineOutputs {
  return {
    momentum: computeMomentum(input),
    volume: computeVolume(input),
    activity: computeActivity(input),
    liquidity: computeLiquidity(input),
    volatility: computeVolatility(input),
    relativeStrength: computeRelativeStrength(input, assetType),
    trend: computeTrend(input),
  };
}
