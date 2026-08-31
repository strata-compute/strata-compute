import type { NormalizedMarketData } from "../types/domain.ts";
import type { EngineOutputs } from "../types/intelligence.ts";
import type { Signal, SignalType } from "../types/signals.ts";
import type { HistoricalObservation } from "../compute/features/index.ts";

/**
 * A detector examines one asset against its own history and either emits a
 * signal or stays quiet. Detectors are pure and independent: adding one is
 * adding an entry to the list, and a detector that throws is isolated by the
 * engine rather than taking the pass down with it.
 */

export interface DetectorInput {
  assetId: string;
  symbol: string;
  current: NormalizedMarketData;
  /**
   * This asset's stored observations, oldest first. The baseline every
   * detector measures against — without it, most of them correctly decline
   * to fire at all.
   */
  history: HistoricalObservation[];
  /** Computed engine outputs for this pass, when scoring has run. */
  engines?: EngineOutputs;
  /** Same-class peers in this pass, for cross-sectional detectors. */
  classPeers: NormalizedMarketData[];
  /** State from the previous pass, when the service has seen one. */
  previous?: {
    market?: NormalizedMarketData;
    rank?: number;
    score?: number;
    momentum?: number;
    trendSlope?: number;
  };
  /** Current rank by Strata Score, when rankings have been computed. */
  rank?: number;
}

export interface SignalDetector {
  readonly type: SignalType;
  readonly description: string;
  detect(input: DetectorInput): Signal | null;
}
