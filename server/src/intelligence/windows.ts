import {
  WINDOW_MINIMUM_OBSERVATIONS,
  WINDOW_MINIMUM_SPAN_RATIO,
  WINDOW_MINUTES,
  WINDOW_PREFERENCE,
} from "../config/intelligence.ts";
import type { IntelligenceWindow } from "../types/intelligence-events.ts";
import { medianOf } from "../compute/features/series.ts";

/**
 * HISTORICAL WINDOWS
 *
 * Every detector compares a current reading against the asset's own recent
 * history. This module owns what "recent" means, how much of it must exist
 * before a comparison is allowed, and which robust statistic describes it.
 *
 * The rule that matters: a window that cannot meet its minimum observation
 * count does not produce a weaker comparison — it produces none. Computing a
 * "4-hour baseline" from three points would be arithmetic dressed as
 * evidence, and every detector downstream would inherit that pretence.
 */

export interface TimedValue {
  timestamp: string;
  value: number;
}

export interface WindowStats {
  window: IntelligenceWindow;
  /** Observations inside the window. */
  n: number;
  /** Median — the baseline every detector compares against. */
  median: number;
  /**
   * Median absolute deviation, rescaled to be comparable with a standard
   * deviation. Robust: a single spike moves it barely at all, where a
   * standard deviation would absorb the spike and then fail to flag it.
   */
  mad: number;
  min: number;
  max: number;
  /** Oldest and newest value in the window, for change-over-window. */
  first: number;
  last: number;
  /** Actual span covered, in minutes. */
  spanMinutes: number;
}

export interface WindowFailure {
  window: IntelligenceWindow;
  reason: "insufficient_history";
  detail: string;
  required: number;
  available: number;
}

export type WindowResult =
  | { ok: true; stats: WindowStats }
  | { ok: false; failure: WindowFailure };

/** 1.4826 rescales MAD so it is comparable with a standard deviation. */
const MAD_SCALE = 1.4826;

export function windowStats(
  series: TimedValue[],
  window: IntelligenceWindow,
  now: number,
): WindowResult {
  const cutoff = now - WINDOW_MINUTES[window] * 60_000;
  const inWindow = series
    .filter((point) => {
      const t = new Date(point.timestamp).getTime();
      return Number.isFinite(t) && t >= cutoff && Number.isFinite(point.value);
    })
    .sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

  const required = WINDOW_MINIMUM_OBSERVATIONS[window];

  if (inWindow.length < required) {
    return {
      ok: false,
      failure: {
        window,
        reason: "insufficient_history",
        detail: `the ${window} window holds ${inWindow.length} observations; ${required} are required`,
        required,
        available: inWindow.length,
      },
    };
  }

  const oldestMs = new Date(inWindow[0]!.timestamp).getTime();
  const newestMs = new Date(inWindow.at(-1)!.timestamp).getTime();
  const spanMinutes = (newestMs - oldestMs) / 60_000;
  const requiredSpan = WINDOW_MINUTES[window] * WINDOW_MINIMUM_SPAN_RATIO;

  // Enough points, but not enough elapsed time. Dense recent history can
  // satisfy a wide window's count while covering a fraction of its period,
  // and a baseline named "4h" that only ever saw one hour is a mislabelled
  // claim rather than a weaker one.
  if (spanMinutes < requiredSpan) {
    return {
      ok: false,
      failure: {
        window,
        reason: "insufficient_history",
        detail: `the ${window} window spans ${Math.round(spanMinutes)} minutes; ${Math.round(requiredSpan)} are required`,
        required: Math.round(requiredSpan),
        available: Math.round(spanMinutes),
      },
    };
  }

  const values = inWindow.map((p) => p.value);
  const median = medianOf(values) as number;
  const deviations = values.map((v) => Math.abs(v - median));
  const mad = (medianOf(deviations) as number) * MAD_SCALE;

  return {
    ok: true,
    stats: {
      window,
      n: inWindow.length,
      median,
      mad,
      min: Math.min(...values),
      max: Math.max(...values),
      first: values[0] as number,
      last: values.at(-1) as number,
      spanMinutes: Math.round(spanMinutes),
    },
  };
}

/**
 * The widest window the data actually supports, tried longest first.
 *
 * A four-hour comparison is more meaningful than a fifteen-minute one, so it
 * is preferred wherever the history allows — but the fallback is explicit,
 * and when nothing works the failure names the widest window attempted.
 */
export function bestWindow(
  series: TimedValue[],
  now: number,
  preference: IntelligenceWindow[] = WINDOW_PREFERENCE,
): WindowResult {
  let lastFailure: WindowFailure | null = null;

  for (const window of preference) {
    const result = windowStats(series, window, now);
    if (result.ok) return result;
    lastFailure ??= result.failure;
  }

  return {
    ok: false,
    failure:
      lastFailure ?? {
        window: preference[0] ?? "1h",
        reason: "insufficient_history",
        detail: "no comparison window has enough observations",
        required: 0,
        available: series.length,
      },
  };
}

/**
 * Deviation of a value from a window's baseline, in MAD-scaled units.
 *
 * Null when the window has no dispersion to measure against — a series that
 * never varies makes every value infinitely unusual, which is not a finding
 * but a division by zero.
 */
export function robustDeviation(value: number, stats: WindowStats): number | null {
  if (stats.mad === 0) return null;
  return (value - stats.median) / stats.mad;
}

/**
 * Ratio of a value to a window's baseline.
 * Null when the baseline is non-positive and a ratio would be meaningless.
 */
export function baselineRatio(value: number, stats: WindowStats): number | null {
  if (stats.median <= 0) return null;
  return value / stats.median;
}

/** Change across the window, in the value's own units. */
export function windowChange(stats: WindowStats): number {
  return stats.last - stats.first;
}
