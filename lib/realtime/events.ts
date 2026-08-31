/**
 * THE REAL-TIME CONTRACT, CLIENT SIDE
 *
 * Mirrors the backend's event vocabulary. Kept as plain types rather than
 * re-exported from the API layer because that layer is `server-only`, and
 * these shapes are needed in the browser.
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
export type EventCategory = "market" | "signals" | "arena";
export type EventSeverity = "info" | "notable" | "important";

export interface StrataEvent {
  id: string;
  eventType: EventType;
  assetId: string | null;
  symbol: string | null;
  assetType: "stock" | "crypto" | "onchain" | null;
  logoUrl: string | null;
  previousValue: number | string | null;
  newValue: number | string | null;
  change: number | null;
  severity: EventSeverity;
  summary: string;
  metadata: Record<string, unknown>;
  computationVersion: string;
  timestamp: string;
}

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

/** Short label shown in the feed. */
export const EVENT_LABEL: Record<EventType, string> = {
  STRATA_SCORE_CHANGED: "Score",
  RANK_CHANGED: "Rank",
  SIGNAL_DETECTED: "Signal",
  SIGNAL_EXPIRED: "Signal ended",
  EARLY_MOVER_DETECTED: "Early mover",
  ANOMALY_DETECTED: "Anomaly",
  MARKET_REGIME_CHANGED: "Regime",
  PRICE_MOVEMENT: "Price",
  VOLUME_ACCELERATION: "Volume",
  ARENA_UPDATE: "Arena",
  ARENA_ELIMINATION: "Elimination",
  ARENA_WINNER: "Winner",
};

export function categoryOf(type: EventType): EventCategory {
  return CATEGORY_OF[type] ?? "market";
}

export type ConnectionState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "lost"
  | "idle";
