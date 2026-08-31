import type { IsoTimestamp } from "../utils/time.ts";

/**
 * Freshness policy.
 *
 * Every payload the API returns is labelled with how current it actually is.
 * Nothing is ever described as "live" because it happens to be the newest row
 * we hold — it is live only if it was retrieved inside the window its data
 * class allows.
 *
 *   live        within the expected refresh window
 *   delayed     older than expected but still usable, and said so
 *   stale       beyond the useful window; shown only when explicitly labelled
 *   unavailable no data at all
 *   error       the request itself failed
 */

export type DataStatus = "live" | "delayed" | "stale" | "unavailable" | "error";

export type DataClass = "market" | "onchain" | "stock" | "security" | "computed";

interface Thresholds {
  /** Seconds within which data is considered live. */
  live: number;
  /** Seconds within which data is considered delayed rather than stale. */
  delayed: number;
}

/**
 * Windows reflect what each source can actually deliver, not what we would
 * like. Alpha Vantage's free tier refreshes an individual symbol at most a
 * few times a day, so calling an hour-old equity quote "live" would be a lie
 * while calling a two-minute-old crypto quote delayed would be noise.
 */
const POLICY: Record<DataClass, Thresholds> = {
  market: { live: 300, delayed: 1_800 },
  onchain: { live: 600, delayed: 3_600 },
  stock: { live: 7_200, delayed: 86_400 },
  security: { live: 86_400, delayed: 604_800 },
  computed: { live: 300, delayed: 1_800 },
};

/** Which policy applies to data from a given provider. */
export function classForSource(source: string | null | undefined): DataClass {
  switch (source) {
    case "alpha_vantage":
      return "stock";
    case "alchemy":
    case "blockscout":
      return "onchain";
    case "goplus":
      return "security";
    case "coingecko":
    case "robinhood_stock_tokens":
      return "market";
    default:
      return "market";
  }
}

export interface FreshnessResult {
  status: DataStatus;
  /** Seconds since the data was retrieved. */
  ageSeconds: number | null;
  retrievedAt: IsoTimestamp | null;
  /** The provider's own timestamp, when it supplied one. */
  sourceTimestamp: string | null;
}

export function assessFreshness(
  retrievedAt: IsoTimestamp | null | undefined,
  dataClass: DataClass,
  sourceTimestamp: string | null = null,
): FreshnessResult {
  if (!retrievedAt) {
    return { status: "unavailable", ageSeconds: null, retrievedAt: null, sourceTimestamp };
  }

  const parsed = new Date(retrievedAt).getTime();
  if (!Number.isFinite(parsed)) {
    return { status: "unavailable", ageSeconds: null, retrievedAt: null, sourceTimestamp };
  }

  const ageSeconds = Math.max(0, Math.round((Date.now() - parsed) / 1000));
  const thresholds = POLICY[dataClass];

  const status: DataStatus =
    ageSeconds <= thresholds.live
      ? "live"
      : ageSeconds <= thresholds.delayed
        ? "delayed"
        : "stale";

  return { status, ageSeconds, retrievedAt, sourceTimestamp };
}

/**
 * Aggregate status for a collection. The worst individual status wins — a
 * list is only "live" if every row in it is.
 */
export function aggregateStatus(statuses: DataStatus[]): DataStatus {
  if (statuses.length === 0) return "unavailable";
  const order: DataStatus[] = ["error", "unavailable", "stale", "delayed", "live"];
  for (const candidate of order) {
    if (statuses.includes(candidate)) return candidate;
  }
  return "unavailable";
}

export function freshnessPolicy() {
  return POLICY;
}
