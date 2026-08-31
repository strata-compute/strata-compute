import type {
  ApiEventDriver,
  ApiIntelligenceEvent,
  ApiIntelligenceEventType,
  ApiIntelligenceSeverity,
} from "@/lib/api";

/**
 * Presentation metadata for intelligence events.
 *
 * UI copy only — no asset, no value, no timestamp. Every number a card shows
 * comes from the event the backend computed; this file supplies the nouns
 * around them.
 *
 * The labels describe what was measured, not what to do about it. "Strength
 * accelerating" is a statement about a computed score; "buy" would be a
 * recommendation, and nothing here is one.
 */

export type IntelligenceTone = "positive" | "negative" | "caution" | "info";

export const INTELLIGENCE_META: Record<
  ApiIntelligenceEventType,
  { label: string; tone: IntelligenceTone; glyph: string; blurb: string }
> = {
  STRENGTH_ACCELERATION: {
    label: "Strength accelerating",
    tone: "positive",
    glyph: "▲",
    blurb: "Composite score rising faster than this asset's own recent baseline.",
  },
  STRENGTH_DETERIORATION: {
    label: "Strength deteriorating",
    tone: "negative",
    glyph: "▼",
    blurb: "Composite score falling faster than this asset's own recent baseline.",
  },
  MOMENTUM_SHIFT: {
    label: "Momentum shift",
    tone: "info",
    glyph: "≈",
    blurb: "The momentum component moved away from where it has been sitting.",
  },
  TREND_SHIFT: {
    label: "Trend reclassified",
    tone: "info",
    glyph: "∿",
    blurb: "The fitted trend changed state, with enough fit quality to mean it.",
  },
  VOLUME_EXPANSION: {
    label: "Volume expansion",
    tone: "caution",
    glyph: "≡",
    blurb: "Participation well above the rolling median. Not a direction.",
  },
  VOLUME_CONTRACTION: {
    label: "Volume contraction",
    tone: "caution",
    glyph: "≣",
    blurb: "Participation well below the rolling median. Not a direction.",
  },
  RANK_ACCELERATION: {
    label: "Climbing the ranking",
    tone: "positive",
    glyph: "↑",
    blurb: "Gained positions against every other asset Strata scores.",
  },
  RANK_DETERIORATION: {
    label: "Falling in the ranking",
    tone: "negative",
    glyph: "↓",
    blurb: "Lost positions against every other asset Strata scores.",
  },
  ANOMALY: {
    label: "Anomaly",
    tone: "caution",
    glyph: "◆",
    blurb: "A metric sitting far outside its own historical distribution.",
  },
  REGIME_SHIFT: {
    label: "Regime shift",
    tone: "info",
    glyph: "◐",
    blurb: "The computed market state changed and held across several passes.",
  },
  CROSS_MARKET_ROTATION: {
    label: "Rotation",
    tone: "info",
    glyph: "⇄",
    blurb: "Relative computed strength moving between asset classes.",
  },
};

export const INTELLIGENCE_EVENT_TYPES = Object.keys(
  INTELLIGENCE_META,
) as ApiIntelligenceEventType[];

/** Severity is about the event, never about the asset being good or bad. */
export const SEVERITY_LABEL: Record<ApiIntelligenceSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const SEVERITY_ORDER: ApiIntelligenceSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
];

/**
 * How confident the engine is in the event, banded for reading.
 *
 * Deliberately coarse: rendering 0.6231 invites a precision the underlying
 * measurement does not have.
 */
export function confidenceBand(value: number): "High" | "Medium" | "Low" {
  if (value >= 0.8) return "High";
  if (value >= 0.55) return "Medium";
  return "Low";
}

/** How to read driver agreement, which can legitimately be negative. */
export function agreementLabel(value: number): string {
  if (value >= 0.6) return "components agree";
  if (value >= 0.2) return "mostly agree";
  if (value > -0.2) return "components split";
  return "components disagree";
}

/**
 * A driver rendered as the comparison that was actually made.
 *
 * Reads the measured numbers back rather than narrating them: "momentum 71.2
 * vs 58.4 baseline" is checkable, "momentum is surging" is not.
 */
export function driverSentence(driver: ApiEventDriver): string {
  const metric = driver.metric.replace(/_/g, " ");
  if (driver.observed === null || driver.baseline === null) {
    return `${metric} ${driver.evidence.replace(/_/g, " ")}`;
  }
  return `${metric} ${driver.observed.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })} vs ${driver.baseline.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })} baseline`;
}

/**
 * The event's headline figure in its own unit.
 *
 * Each event type measures a different quantity — score points, rank
 * positions, a volume multiple, a deviation in sigma — and printing them all
 * as a bare number would invite comparing quantities that are not comparable.
 */
export function magnitudeLabel(event: ApiIntelligenceEvent): string {
  const value = event.magnitude;
  const signed = (v: number, digits = 1) =>
    `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;

  switch (event.eventType) {
    case "STRENGTH_ACCELERATION":
    case "STRENGTH_DETERIORATION":
      return `${signed(value)} pts`;
    case "MOMENTUM_SHIFT":
      return `${signed(value)} vs baseline`;
    case "RANK_ACCELERATION":
    case "RANK_DETERIORATION":
      return `${Math.abs(value)} place${Math.abs(value) === 1 ? "" : "s"}`;
    case "VOLUME_EXPANSION":
    case "VOLUME_CONTRACTION":
      return `${value.toFixed(2)}× median`;
    case "ANOMALY":
      return `${Math.abs(value).toFixed(1)}σ from baseline`;
    case "TREND_SHIFT":
      return `${Math.abs(value)} step${Math.abs(value) === 1 ? "" : "s"}`;
    case "CROSS_MARKET_ROTATION":
      return `${value.toFixed(1)} pt spread`;
    case "REGIME_SHIFT":
      return `held ${value} pass${value === 1 ? "" : "es"}`;
    default:
      return signed(value);
  }
}

/** How long the condition has been running, from its own timestamps. */
export function heldForLabel(event: ApiIntelligenceEvent): string {
  const from = new Date(event.detectedAt).getTime();
  const to = new Date(event.resolvedAt ?? event.latestAt).getTime();
  const minutes = Math.max(0, Math.round((to - from) / 60_000));

  if (minutes < 1) return "just detected";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
