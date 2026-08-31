import type { IsoTimestamp } from "../utils/time.ts";

/**
 * Operational metadata about computation passes.
 *
 * The scoring contract itself now lives in types/intelligence.ts; what
 * remains here is what the service reports about its own runs.
 */

export interface ComputeRunSummary {
  version: string;
  startedAt: IsoTimestamp;
  finishedAt: IsoTimestamp;
  processingTimeMs: number;
  assetsProcessed: number;
  eventsProcessed: number;
  failures: number;
}

export type ComputeStatusState = "idle" | "running" | "degraded" | "error";

export interface ComputeStatus {
  status: ComputeStatusState;
  computationVersion: string;
  lastRun: IsoTimestamp | null;
  lastRunDurationMs: number | null;
  assetsProcessed: number;
  eventsProcessed: number;
  failures: number;
  provider: string;
  usingMockData: boolean;
}
