import type { AssetType } from "./domain.ts";
import type { IsoTimestamp } from "../utils/time.ts";

/**
 * THE INTELLIGENCE EVENT MODEL
 *
 * An intelligence event is a *condition that persists*, not a moment that
 * passed. That is the whole difference between this layer and the signal
 * detectors it sits beside.
 *
 * A signal fires when a threshold is crossed and expires on a timer: "volume
 * was 4x baseline at 10:03". An intelligence event says "this asset has been
 * strengthening since 10:03, it still is, and here is how far it has come".
 * The same underlying condition observed across fifteen computation passes
 * produces one event that evolves — never fifteen events that repeat.
 *
 * Everything here is derived from computed evidence. Price is context and
 * never a trigger on its own: an asset can rise on nothing and fall on
 * nothing, and neither is intelligence.
 */

export const INTELLIGENCE_EVENT_TYPES = [
  "STRENGTH_ACCELERATION",
  "STRENGTH_DETERIORATION",
  "MOMENTUM_SHIFT",
  "TREND_SHIFT",
  "VOLUME_EXPANSION",
  "VOLUME_CONTRACTION",
  "RANK_ACCELERATION",
  "RANK_DETERIORATION",
  "ANOMALY",
  "REGIME_SHIFT",
  "CROSS_MARKET_ROTATION",
] as const;

export type IntelligenceEventType = (typeof INTELLIGENCE_EVENT_TYPES)[number];

/**
 * Lifecycle.
 *
 * `detected` is the first pass that saw the condition; `active` is every pass
 * after that while it holds; `resolved` is the pass where it stopped holding;
 * `expired` is a condition that stopped being re-observed at all, which is
 * different from one that measurably ended.
 */
export const INTELLIGENCE_EVENT_STATUSES = [
  "detected",
  "active",
  "resolved",
  "expired",
] as const;

export type IntelligenceEventStatus = (typeof INTELLIGENCE_EVENT_STATUSES)[number];

export const INTELLIGENCE_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type IntelligenceSeverity = (typeof INTELLIGENCE_SEVERITIES)[number];

/** The comparison windows the detectors may use. */
export const INTELLIGENCE_WINDOWS = ["15m", "1h", "4h", "24h", "7d"] as const;
export type IntelligenceWindow = (typeof INTELLIGENCE_WINDOWS)[number];

/**
 * One piece of computed evidence behind an event.
 *
 * `evidence` names the comparison that was actually made, so the frontend can
 * render a sentence without inventing one and a reader can check the claim
 * against the same number the detector saw.
 */
export interface EventDriver {
  metric: string;
  direction: "up" | "down" | "flat";
  /** Change in the metric's own units. */
  magnitude: number;
  /** What the value was compared against, e.g. "above_1h_baseline". */
  evidence: string;
  /** The measured values, so nothing has to be taken on trust. */
  observed: number | null;
  baseline: number | null;
}

/**
 * Why an event is worth reporting, decomposed.
 *
 * Kept as separate readings rather than a single number so a reader can see
 * *which* part made something significant — a large but momentary move and a
 * small but persistent one are different findings, and collapsing them into
 * one score would hide that.
 */
export interface EventSignificance {
  /** 0–1. How far the change is, relative to what this metric usually does. */
  magnitude: number;
  /** 0–1. How many consecutive passes the condition has held. */
  persistence: number;
  /** 0–1. How unusual the move is against the asset's own history. */
  historicalDeviation: number;
  /** 0–1. Confidence in the inputs the detection rests on. */
  dataConfidence: number;
  /** The product of the four. */
  value: number;
}

export interface IntelligenceEvent {
  id?: string;
  /** Null for market-wide events such as rotation. */
  assetId: string | null;
  symbol: string | null;
  assetType: AssetType | null;
  eventType: IntelligenceEventType;
  status: IntelligenceEventStatus;
  severity: IntelligenceSeverity;

  /** 0–1 significance, and its decomposition. */
  significance: EventSignificance;
  /**
   * Confidence in the EVENT, not in the asset's score. An event supported by
   * four agreeing components is more trustworthy than one supported by a
   * single metric, regardless of how well-measured that asset is.
   */
  confidence: number;
  /**
   * −1 to 1. How much the independent components agree. Near zero means the
   * evidence conflicts, and that is surfaced rather than smoothed away.
   */
  driverAgreement: number;

  /** The headline change, in the event's own natural unit. */
  magnitude: number;
  /** Consecutive passes the condition has held. */
  observations: number;

  drivers: EventDriver[];
  /** Anything else measured that helps read the event. Never prose. */
  context: Record<string, unknown>;

  /** Value when the condition was first detected, and now. */
  firstValue: number | null;
  latestValue: number | null;

  /** Ordering key for the feed. Not the Strata Score. */
  priority: number;

  detectedAt: IsoTimestamp;
  latestAt: IsoTimestamp;
  resolvedAt: IsoTimestamp | null;
  expiresAt: IsoTimestamp;

  computationVersion: string;
  scoreVersion: string;
}

/** What a detector returns before the engine assigns lifecycle and identity. */
export interface DetectionResult {
  assetId: string | null;
  symbol: string | null;
  assetType: AssetType | null;
  eventType: IntelligenceEventType;
  magnitude: number;
  significance: EventSignificance;
  confidence: number;
  driverAgreement: number;
  drivers: EventDriver[];
  context: Record<string, unknown>;
  value: number | null;
}

/** Reported instead of a detection when the history cannot support one. */
export interface InsufficientHistory {
  assetId: string | null;
  eventType: IntelligenceEventType;
  reason: "insufficient_history";
  detail: string;
  observationsRequired: number;
  observationsAvailable: number;
}

export interface IntelligenceEventFilter {
  types?: IntelligenceEventType[];
  assetId?: string;
  assetType?: AssetType;
  severity?: IntelligenceSeverity;
  status?: IntelligenceEventStatus[];
  since?: IsoTimestamp;
  limit?: number;
}
