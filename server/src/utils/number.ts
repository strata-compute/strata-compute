/**
 * Providers disagree about numbers: strings, nulls, NaN, thousands
 * separators. Everything numeric passes through here before it enters the
 * domain, so the compute engine only ever sees finite values or null.
 */

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[, ]/g, "").trim();
    if (cleaned === "") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Non-negative numeric fields: volume, market cap, liquidity. */
export function toPositiveNumber(value: unknown): number | null {
  const n = toNumber(value);
  return n !== null && n >= 0 ? n : null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Maps a value onto 0–100 given an expected range, saturating at both ends. */
export function scaleTo100(value: number, min: number, max: number): number {
  if (max === min) return 50;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

/** Logarithmic scaling for heavy-tailed quantities such as notional volume. */
export function logScaleTo100(value: number, min: number, max: number): number {
  const safe = Math.max(value, 1);
  return scaleTo100(
    Math.log10(safe),
    Math.log10(Math.max(min, 1)),
    Math.log10(Math.max(max, 10)),
  );
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}
