/**
 * SERIES MATHEMATICS
 *
 * The statistical primitives every engine shares. They are deliberately dull:
 * pure functions over arrays of numbers, no domain knowledge, no I/O.
 *
 * Each one returns `null` rather than a fallback when the input cannot
 * support the calculation — a standard deviation of one observation is not
 * zero, it is undefined, and the difference matters when the result feeds a
 * score someone will act on.
 */

export interface TimePoint {
  timestamp: string;
  value: number;
}

/** Ascending by time. Callers may hand us either order. */
export function sortByTime(points: TimePoint[]): TimePoint[] {
  return [...points].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/**
 * Sample standard deviation (n-1). Requires at least two observations —
 * with one, dispersion is undefined rather than zero.
 */
export function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const avg = mean(values) as number;
  const variance =
    values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Simple returns between consecutive observations, as fractions. */
export function returns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i += 1) {
    const previous = prices[i - 1] as number;
    const current = prices[i] as number;
    if (previous > 0) out.push((current - previous) / previous);
  }
  return out;
}

/**
 * Percentage change between the first and last observation of a window.
 * Null when either endpoint is missing or the base is non-positive.
 */
export function changePct(first: number | undefined, last: number | undefined): number | null {
  if (first === undefined || last === undefined) return null;
  if (!(first > 0)) return null;
  return ((last - first) / first) * 100;
}

/**
 * Ordinary least squares slope and fit quality over evenly-weighted points.
 *
 * `x` is supplied in days so the slope is directly interpretable as
 * "percent per day" once the caller normalises by the mean level. R² is
 * returned alongside because a slope without a fit quality invites reading a
 * trend into noise.
 */
export function linearRegression(
  xs: number[],
  ys: number[],
): { slope: number; intercept: number; r2: number } | null {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;

  const meanX = mean(xs) as number;
  const meanY = mean(ys) as number;

  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (xs[i] as number) - meanX;
    sxy += dx * ((ys[i] as number) - meanY);
    sxx += dx * dx;
  }
  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i += 1) {
    const predicted = slope * (xs[i] as number) + intercept;
    const actual = ys[i] as number;
    ssRes += (actual - predicted) ** 2;
    ssTot += (actual - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { slope, intercept, r2 };
}

/**
 * Where a value sits within a distribution, 0–100.
 *
 * Used wherever a raw quantity has to become comparable across asset classes:
 * a percentile answers "how does this rank among its peers", which survives
 * the jump from a mega-cap equity to a small onchain pool. An absolute scale
 * does not.
 */
export function percentileOf(value: number, distribution: number[]): number | null {
  if (distribution.length < 2) return null;
  const below = distribution.filter((d) => d < value).length;
  const equal = distribution.filter((d) => d === value).length;
  return ((below + equal / 2) / distribution.length) * 100;
}

/**
 * Deviation from a baseline in standard deviations.
 * Null when the baseline is too thin or has no dispersion to measure against.
 */
export function zScore(value: number, baseline: number[]): number | null {
  if (baseline.length < 2) return null;
  const avg = mean(baseline) as number;
  const sd = stdDev(baseline);
  if (sd === null || sd === 0) return null;
  return (value - avg) / sd;
}

/**
 * Value as a multiple of the baseline's median.
 * The median rather than the mean, so one prior spike does not raise the bar
 * against which the next spike is judged.
 */
export function relativeToBaseline(value: number, baseline: number[]): number | null {
  if (baseline.length === 0) return null;
  const base = medianOf(baseline);
  if (base === null || base <= 0) return null;
  return value / base;
}

/**
 * Acceleration: whether the rate of change is itself increasing.
 *
 * Computed as the difference between the recent half's mean rate and the
 * earlier half's. Positive means the move is building, negative means it is
 * decaying — which is what separates an early move from a finished one.
 */
export function acceleration(series: number[]): number | null {
  if (series.length < 4) return null;
  const rates = returns(series);
  if (rates.length < 2) return null;

  const split = Math.floor(rates.length / 2);
  const earlier = mean(rates.slice(0, split));
  const recent = mean(rates.slice(split));
  if (earlier === null || recent === null) return null;

  return (recent - earlier) * 100;
}

/**
 * Annualised volatility from period returns.
 *
 * `periodsPerYear` converts the sampling cadence to an annual figure — hourly
 * observations are 8760 periods, daily are 365 — so short and medium windows
 * are quoted on the same axis and can be compared.
 */
export function annualisedVolatility(
  periodReturns: number[],
  periodsPerYear: number,
): number | null {
  const sd = stdDev(periodReturns);
  if (sd === null) return null;
  return sd * Math.sqrt(periodsPerYear) * 100;
}

/**
 * Drops observations whose return is absurd relative to the rest of the
 * series — a provider glitch, a decimal shift, a stale-then-corrected print.
 *
 * Removing them is not smoothing the data: an 800-sigma return is not a
 * market event, and leaving it in would corrupt every statistic downstream.
 * The count of what was removed is returned so callers can report it.
 */
/**
 * Whether a price series carries any information at all.
 *
 * A series in which every observation is identical is not a calm market; it
 * is an absent one. Robinhood's tokenised equities quote a mid derived from
 * bid and ask, and while the underlying venue is closed those two do not
 * move — 31 of 40 covered stocks held a single distinct price across 290
 * stored observations.
 *
 * Treating that as data produced the worst reading in the system: momentum
 * and trend computed to exactly zero and were reported as "neutral", while
 * volatility computed to zero and, on an inverted scale, scored 100 — the
 * best possible mark. An asset that had not traded outranked every asset
 * that had.
 *
 * So a degenerate series is rejected here rather than normalised downstream.
 * The components it would feed return null with a reason, and the asset is
 * scored on whatever else it genuinely has.
 */
export function isDegenerate(prices: number[]): boolean {
  if (prices.length < 2) return true;
  const first = prices[0] as number;
  return prices.every((price) => price === first);
}

/**
 * Distinct-value share of a series, 0–1.
 *
 * A series that is not perfectly flat can still be too coarse to fit a trend
 * or measure dispersion against — a price that takes two values across two
 * hundred observations describes a step, not a series.
 */
export function distinctRatio(values: number[]): number {
  if (values.length === 0) return 0;
  return new Set(values).size / values.length;
}

export function stripOutliers(
  prices: number[],
  sigma: number,
): { cleaned: number[]; removed: number } {
  if (prices.length < 4) return { cleaned: prices, removed: 0 };

  const rets = returns(prices);
  if (rets.length < 3) return { cleaned: prices, removed: 0 };

  // Median and MAD rather than mean and standard deviation.
  //
  // This matters more than it looks. A single 900-sigma print inflates the
  // standard deviation so much that it falls inside three of its own
  // deviations — the outlier masks itself, and the filter silently passes
  // exactly the value it exists to remove. The median absolute deviation is
  // unaffected by the extreme value, so the test still catches it.
  const centre = medianOf(rets) as number;
  const deviations = rets.map((r) => Math.abs(r - centre));
  const mad = medianOf(deviations) as number;

  // 1.4826 rescales MAD to be comparable with a standard deviation under a
  // normal distribution, so the caller's sigma threshold keeps its meaning.
  const scale = mad * 1.4826;
  if (scale === 0) return { cleaned: prices, removed: 0 };

  const cleaned: number[] = [prices[0] as number];
  let removed = 0;
  for (let i = 1; i < prices.length; i += 1) {
    const current = prices[i] as number;
    // Measured against the last *kept* price, not the raw previous one.
    //
    // A bad print corrupts two returns: the jump into it and the jump back
    // out. Comparing against the raw predecessor would discard the innocent
    // observation that follows a glitch as well as the glitch itself, which
    // quietly deletes real data. Chaining from the last good price means only
    // the bad print is dropped.
    const previous = cleaned[cleaned.length - 1] as number;
    const ret = previous > 0 ? (current - previous) / previous : 0;
    if (Math.abs(ret - centre) > sigma * scale) {
      removed += 1;
      continue;
    }
    cleaned.push(current);
  }
  return { cleaned, removed };
}
