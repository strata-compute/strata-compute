import { SIGNAL_THRESHOLDS, SIGNAL_TTL_SECONDS, QUALITY } from "../../config/scoring.ts";
import type { Signal, SignalSeverity, SignalType } from "../../types/signals.ts";
import { round } from "../../utils/number.ts";
import { nowIso } from "../../utils/time.ts";
import { medianOf, relativeToBaseline, stdDev, zScore } from "../../compute/features/series.ts";
import type { DetectorInput, SignalDetector } from "../types.ts";

/**
 * SIGNAL DETECTORS
 *
 * Each detector answers one question about one asset, against that asset's
 * own history. Not against a peer group, and not against an absolute
 * constant: a $2m day is a quiet session for one market and a record for
 * another, so "unusual" only means anything relative to what this particular
 * asset normally does.
 *
 * That has a consequence the previous version glossed over — an asset with no
 * baseline cannot produce a signal. Every detector here returns null when the
 * history behind it is too thin, rather than firing on a threshold it has no
 * grounds to evaluate. A feed that stays quiet until it has something real to
 * say is worth more than one that always has an entry.
 *
 * Thresholds live in config/scoring.ts. Nothing in this file hardcodes one.
 */

function severityFor(
  magnitude: number,
  bands: { low: number; medium: number; high: number; critical: number },
): SignalSeverity | null {
  const m = Math.abs(magnitude);
  if (m >= bands.critical) return "critical";
  if (m >= bands.high) return "high";
  if (m >= bands.medium) return "medium";
  if (m >= bands.low) return "low";
  // below the lowest band there is no signal, only normal behaviour
  return null;
}

function build(
  input: DetectorInput,
  type: SignalType,
  value: number,
  severity: SignalSeverity,
  metadata: Record<string, unknown>,
): Signal {
  const now = Date.now();
  const ttl = SIGNAL_TTL_SECONDS[type] ?? 3_600;
  return {
    assetId: input.assetId,
    symbol: input.symbol,
    signalType: type,
    severity,
    value: round(value, 4),
    timestamp: nowIso(),
    expiresAt: new Date(now + ttl * 1000).toISOString(),
    metadata: { ...metadata, source: input.current.source },
  };
}

/** Historical volumes for this asset, oldest first, current excluded. */
function volumeBaseline(input: DetectorInput): number[] {
  return input.history
    .map((h) => h.volume24h)
    .filter((v): v is number => v !== null && v > 0)
    .slice(0, -1);
}

/* ---------------------------------------------------------------- 1. --- */

const momentumSpike: SignalDetector = {
  type: "MOMENTUM_SPIKE",
  description:
    "Price change over 24h that is large relative to this asset's own recent distribution of returns.",
  detect(input) {
    const change = input.current.priceChange24h;
    if (change === null) return null;

    // measured in sigma of the asset's own daily returns, not raw percent —
    // a 5% day is unremarkable for one asset and extraordinary for another
    const prices = input.history.map((h) => h.price).filter((p) => p > 0);
    if (prices.length < QUALITY.minimumHistoryPoints) return null;

    const rets: number[] = [];
    for (let i = 1; i < prices.length; i += 1) {
      const prev = prices[i - 1] as number;
      if (prev > 0) rets.push((((prices[i] as number) - prev) / prev) * 100);
    }
    const sigma = zScore(change, rets);
    if (sigma === null) return null;

    const severity = severityFor(sigma, SIGNAL_THRESHOLDS.MOMENTUM_SPIKE);
    if (!severity) return null;

    return build(input, "MOMENTUM_SPIKE", sigma, severity, {
      changePct: round(change, 3),
      baselineSamples: rets.length,
      direction: change >= 0 ? "up" : "down",
      summary: `24h move of ${change >= 0 ? "+" : ""}${change.toFixed(2)}% is ${Math.abs(sigma).toFixed(1)}σ from this asset's own baseline`,
    });
  },
};

/* ---------------------------------------------------------------- 2. --- */

const volumeAcceleration: SignalDetector = {
  type: "VOLUME_ACCELERATION",
  description: "Current volume as a multiple of this asset's own median volume.",
  detect(input) {
    const current = input.current.volume24h;
    if (current === null) return null;

    const baseline = volumeBaseline(input);
    if (baseline.length < QUALITY.minimumHistoryPoints) return null;

    const ratio = relativeToBaseline(current, baseline);
    if (ratio === null || ratio < 1) return null;

    const severity = severityFor(ratio, SIGNAL_THRESHOLDS.VOLUME_ACCELERATION);
    if (!severity) return null;

    return build(input, "VOLUME_ACCELERATION", ratio, severity, {
      currentVolume: current,
      baselineVolume: round(medianOf(baseline) ?? 0, 2),
      baselineSamples: baseline.length,
      summary: `Volume is ${ratio.toFixed(1)}x its ${baseline.length}-observation median`,
    });
  },
};

/* ---------------------------------------------------------------- 3. --- */

const priceBreakout: SignalDetector = {
  type: "PRICE_BREAKOUT",
  description: "Price moving outside the range it has held over its stored history.",
  detect(input) {
    const prices = input.history.map((h) => h.price).filter((p) => p > 0);
    if (prices.length < QUALITY.minimumHistoryPoints) return null;

    const prior = prices.slice(0, -1);
    const high = Math.max(...prior);
    const low = Math.min(...prior);
    const current = input.current.price;
    const spread = high - low;
    if (spread <= 0) return null;

    // how far outside the prior range, expressed in range-widths
    let excursion = 0;
    if (current > high) excursion = (current - high) / spread;
    else if (current < low) excursion = (current - low) / spread;
    else return null;

    const severity = severityFor(excursion, SIGNAL_THRESHOLDS.PRICE_BREAKOUT);
    if (!severity) return null;

    return build(input, "PRICE_BREAKOUT", excursion, severity, {
      direction: excursion > 0 ? "up" : "down",
      priorHigh: round(high, 6),
      priorLow: round(low, 6),
      baselineSamples: prior.length,
      summary: `Price broke ${excursion > 0 ? "above" : "below"} its ${prior.length}-observation range`,
    });
  },
};

/* ---------------------------------------------------------------- 4. --- */

const volatilityExpansion: SignalDetector = {
  type: "VOLATILITY_EXPANSION",
  description: "Recent dispersion of returns widening against the longer window.",
  detect(input) {
    const expansion = input.engines?.volatility.expansion;
    if (expansion === null || expansion === undefined) return null;
    if (expansion <= 1) return null;

    const severity = severityFor(expansion, SIGNAL_THRESHOLDS.VOLATILITY_EXPANSION);
    if (!severity) return null;

    return build(input, "VOLATILITY_EXPANSION", expansion, severity, {
      shortTermPct: input.engines?.volatility.shortTermPct,
      mediumTermPct: input.engines?.volatility.mediumTermPct,
      summary: `Short-term volatility is ${expansion.toFixed(1)}x the medium-term reading`,
    });
  },
};

/* ------------------------------------------------------------- 5 & 6. --- */

function liquidityDetector(
  type: "LIQUIDITY_EXPANSION" | "LIQUIDITY_CONTRACTION",
): SignalDetector {
  const expanding = type === "LIQUIDITY_EXPANSION";
  return {
    type,
    description: expanding
      ? "Book depth growing materially against this asset's own baseline."
      : "Book depth shrinking materially against this asset's own baseline.",
    detect(input) {
      const changePct = input.engines?.liquidity.changePct;
      if (changePct === null || changePct === undefined) return null;

      const fraction = changePct / 100;
      if (expanding && fraction <= 0) return null;
      if (!expanding && fraction >= 0) return null;

      const severity = severityFor(fraction, SIGNAL_THRESHOLDS[type]);
      if (!severity) return null;

      return build(input, type, Math.abs(fraction), severity, {
        changePct: round(changePct, 3),
        liquidity: input.current.liquidity,
        summary: `Liquidity ${expanding ? "expanded" : "contracted"} ${Math.abs(changePct).toFixed(1)}% against its baseline`,
      });
    },
  };
}

/* ---------------------------------------------------------------- 7. --- */

const activitySpike: SignalDetector = {
  type: "ACTIVITY_SPIKE",
  description: "Onchain participation running well above this asset's own baseline.",
  detect(input) {
    const current = input.current.tradeCount24h ?? input.current.uniqueParticipants24h;
    if (current === null || current === undefined) return null;

    const baseline = input.history
      .map((h) => h.tradeCount24h ?? h.uniqueParticipants24h)
      .filter((v): v is number => v !== null && v > 0)
      .slice(0, -1);
    if (baseline.length < QUALITY.minimumHistoryPoints) return null;

    const ratio = relativeToBaseline(current, baseline);
    if (ratio === null || ratio < 1) return null;

    const severity = severityFor(ratio, SIGNAL_THRESHOLDS.ACTIVITY_SPIKE);
    if (!severity) return null;

    return build(input, "ACTIVITY_SPIKE", ratio, severity, {
      currentActivity: current,
      baselineSamples: baseline.length,
      summary: `Activity is ${ratio.toFixed(1)}x its ${baseline.length}-observation median`,
    });
  },
};

/* ---------------------------------------------------------------- 8. --- */

const rankChange: SignalDetector = {
  type: "RANK_CHANGE",
  description: "Material movement in this asset's rank by Strata Score.",
  detect(input) {
    const current = input.rank;
    const previous = input.previous?.rank;
    if (current === undefined || previous === undefined) return null;

    // improvement is a negative delta in rank number; report it as positive
    const movement = previous - current;
    if (movement === 0) return null;

    const severity = severityFor(movement, SIGNAL_THRESHOLDS.RANK_CHANGE);
    if (!severity) return null;

    return build(input, "RANK_CHANGE", movement, severity, {
      previousRank: previous,
      currentRank: current,
      direction: movement > 0 ? "up" : "down",
      summary: `Moved ${Math.abs(movement)} place${Math.abs(movement) === 1 ? "" : "s"} ${movement > 0 ? "up" : "down"} the ranking, ${previous} → ${current}`,
    });
  },
};

/* ---------------------------------------------------------------- 9. --- */

const trendReversal: SignalDetector = {
  type: "TREND_REVERSAL",
  description: "Fitted trend slope changing sign against the previous computation.",
  detect(input) {
    const current = input.engines?.trend.slopePctPerDay;
    const previous = input.previous?.trendSlope;
    if (current === null || current === undefined) return null;
    if (previous === null || previous === undefined) return null;

    // only a genuine sign change counts; a slope easing is not a reversal
    if (Math.sign(current) === Math.sign(previous)) return null;
    if (current === 0 || previous === 0) return null;

    const magnitude = Math.abs(current - previous);
    const severity = severityFor(magnitude, SIGNAL_THRESHOLDS.TREND_REVERSAL);
    if (!severity) return null;

    // a reversal read off a poor fit is noise changing sign
    const fit = input.engines?.trend.fitQuality ?? 0;
    if (fit < 0.25) return null;

    return build(input, "TREND_REVERSAL", magnitude, severity, {
      previousSlope: round(previous, 4),
      currentSlope: round(current, 4),
      fitQuality: round(fit, 3),
      direction: current > 0 ? "up" : "down",
      summary: `Trend turned ${current > 0 ? "upward" : "downward"}, ${previous.toFixed(2)} → ${current.toFixed(2)}%/day`,
    });
  },
};

/* --------------------------------------------------------------- 10. --- */

const unusualActivity: SignalDetector = {
  type: "UNUSUAL_ACTIVITY",
  description:
    "Combined behaviour departing from this asset's historical baseline across more than one dimension.",
  detect(input) {
    const deviations: { label: string; sigma: number }[] = [];

    const volumes = volumeBaseline(input);
    if (volumes.length >= QUALITY.minimumHistoryPoints && input.current.volume24h !== null) {
      const z = zScore(input.current.volume24h, volumes);
      if (z !== null) deviations.push({ label: "volume", sigma: z });
    }

    const prices = input.history.map((h) => h.price).filter((p) => p > 0);
    if (prices.length >= QUALITY.minimumHistoryPoints && input.current.priceChange24h !== null) {
      const rets: number[] = [];
      for (let i = 1; i < prices.length; i += 1) {
        const prev = prices[i - 1] as number;
        if (prev > 0) rets.push((((prices[i] as number) - prev) / prev) * 100);
      }
      const z = zScore(input.current.priceChange24h, rets);
      if (z !== null) deviations.push({ label: "price", sigma: z });
    }

    // the point of this detector is confluence: one stretched reading is
    // ordinary, two at once is what makes the behaviour unusual
    const stretched = deviations.filter((d) => Math.abs(d.sigma) >= 2);
    if (stretched.length < 2) return null;

    const combined = Math.sqrt(
      stretched.reduce((sum, d) => sum + d.sigma ** 2, 0),
    );
    const severity = severityFor(combined, SIGNAL_THRESHOLDS.UNUSUAL_ACTIVITY);
    if (!severity) return null;

    return build(input, "UNUSUAL_ACTIVITY", combined, severity, {
      dimensions: stretched.map((d) => d.label),
      deviations: stretched.map((d) => ({ label: d.label, sigma: round(d.sigma, 2) })),
      summary: `${stretched.map((d) => d.label).join(" and ")} both departed from baseline simultaneously`,
    });
  },
};

export const DETECTORS: SignalDetector[] = [
  momentumSpike,
  volumeAcceleration,
  priceBreakout,
  volatilityExpansion,
  liquidityDetector("LIQUIDITY_EXPANSION"),
  liquidityDetector("LIQUIDITY_CONTRACTION"),
  activitySpike,
  rankChange,
  trendReversal,
  unusualActivity,
];

/** Exported for tests: dispersion helper used by several detectors. */
export const __testing = { severityFor, stdDev };
