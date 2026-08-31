import type { IsoTimestamp } from "../utils/time.ts";

/**
 * The signal vocabulary.
 *
 * A signal is an observation that something in an asset's own behaviour has
 * crossed a threshold relative to its history — never a recommendation, and
 * never a forecast. Every one carries the measured value that triggered it so
 * a reader can check the claim rather than take it.
 */

export const SIGNAL_TYPES = [
  "MOMENTUM_SPIKE",
  "VOLUME_ACCELERATION",
  "PRICE_BREAKOUT",
  "VOLATILITY_EXPANSION",
  "LIQUIDITY_EXPANSION",
  "LIQUIDITY_CONTRACTION",
  "ACTIVITY_SPIKE",
  "RANK_CHANGE",
  "TREND_REVERSAL",
  "UNUSUAL_ACTIVITY",
] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SIGNAL_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type SignalSeverity = (typeof SIGNAL_SEVERITIES)[number];

export interface Signal {
  id?: string;
  assetId: string;
  symbol: string;
  signalType: SignalType;
  severity: SignalSeverity;
  /** Magnitude of the crossing, in the detector's own stated unit. */
  value: number;
  /**
   * When the signal stops being relevant. A volume spike is news for an hour
   * or two; a trend reversal matters for longer. Expiry is per type so a
   * stale observation cannot sit in the feed looking current.
   */
  expiresAt: IsoTimestamp;
  metadata: Record<string, unknown>;
  timestamp: IsoTimestamp;
}
