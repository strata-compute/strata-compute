import type { IsoTimestamp } from "../utils/time.ts";

/**
 * THE EVENT VOCABULARY
 *
 * An event records that a computed value crossed a threshold worth telling
 * someone about. Three properties are load-bearing.
 *
 * Events originate in computation, never in the interface. Nothing a user
 * clicks produces one. That is what makes the stream a record of what the
 * market did rather than a record of what someone was looking at.
 *
 * Every event carries the values that produced it — previous, new, and the
 * change between them — so a reader can check the claim instead of taking it.
 * An event that says "score changed" without saying from what to what is a
 * notification, not evidence.
 *
 * And they are emitted only on a real crossing. A pass that recomputes the
 * same number emits nothing. The alternative — one event per asset per pass —
 * is a stream that is technically complete and practically unreadable, and it
 * buries the changes that matter under the ones that do not.
 */

export const EVENT_TYPES = [
  "STRATA_SCORE_CHANGED",
  "RANK_CHANGED",
  "SIGNAL_DETECTED",
  "SIGNAL_EXPIRED",
  "EARLY_MOVER_DETECTED",
  "ANOMALY_DETECTED",
  "MARKET_REGIME_CHANGED",
  "PRICE_MOVEMENT",
  "VOLUME_ACCELERATION",
  "ARENA_UPDATE",
  "ARENA_ELIMINATION",
  "ARENA_WINNER",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Coarse grouping used by the activity feed's filters. */
export const EVENT_CATEGORIES = ["market", "signals", "arena"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const CATEGORY_OF: Record<EventType, EventCategory> = {
  STRATA_SCORE_CHANGED: "market",
  RANK_CHANGED: "market",
  SIGNAL_DETECTED: "signals",
  SIGNAL_EXPIRED: "signals",
  EARLY_MOVER_DETECTED: "signals",
  ANOMALY_DETECTED: "signals",
  MARKET_REGIME_CHANGED: "market",
  PRICE_MOVEMENT: "market",
  VOLUME_ACCELERATION: "market",
  ARENA_UPDATE: "arena",
  ARENA_ELIMINATION: "arena",
  ARENA_WINNER: "arena",
};

/** Relative importance, used for notification filtering and ordering. */
export type EventSeverity = "info" | "notable" | "important";

export interface StrataEvent {
  id: string;
  eventType: EventType;
  /** Null for market-wide events such as a regime change. */
  assetId: string | null;
  symbol: string | null;
  assetType: "stock" | "crypto" | "onchain" | null;
  /** Provider-published artwork for the asset, or null. Never synthesised. */
  logoUrl: string | null;
  previousValue: number | string | null;
  newValue: number | string | null;
  change: number | null;
  severity: EventSeverity;
  /** A sentence assembled from the computed values, never generated prose. */
  summary: string;
  metadata: Record<string, unknown>;
  computationVersion: string;
  timestamp: IsoTimestamp;
}

/** What an emitter supplies; the bus fills in id, timestamp and category. */
export interface EventDraft {
  eventType: EventType;
  assetId?: string | null;
  symbol?: string | null;
  assetType?: StrataEvent["assetType"];
  logoUrl?: string | null;
  previousValue?: number | string | null;
  newValue?: number | string | null;
  change?: number | null;
  severity?: EventSeverity;
  summary: string;
  metadata?: Record<string, unknown>;
  computationVersion?: string;
  timestamp?: IsoTimestamp;
}

export interface EventFilter {
  types?: EventType[];
  category?: EventCategory;
  assetId?: string;
  assetType?: "stock" | "crypto" | "onchain";
  since?: IsoTimestamp;
  limit?: number;
}

export function categoryOf(type: EventType): EventCategory {
  return CATEGORY_OF[type];
}
