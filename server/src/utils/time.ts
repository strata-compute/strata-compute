/** All timestamps inside the service are UTC ISO-8601 strings. */

export type IsoTimestamp = string;

export function nowIso(): IsoTimestamp {
  return new Date().toISOString();
}

/**
 * Accepts the shapes providers actually return — ISO strings, epoch seconds,
 * epoch milliseconds, Date — and yields one canonical representation.
 * Returns null rather than throwing, so normalization decides what to do.
 */
export function toIso(value: unknown): IsoTimestamp | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // sub-1e11 values are seconds, larger values are milliseconds
    const ms = value < 1e11 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

export function minutesBetween(a: IsoTimestamp, b: IsoTimestamp): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60_000;
}

export function isOlderThan(timestamp: IsoTimestamp, ms: number): boolean {
  return Date.now() - new Date(timestamp).getTime() > ms;
}
