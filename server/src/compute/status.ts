import type {
  ComputeRunSummary,
  ComputeStatus,
  ComputeStatusState,
} from "../types/compute.ts";
import { CURRENT_SCORING_VERSION } from "./registry.ts";

/**
 * Tracks the outcome of the most recent computation pass. Deliberately
 * in-process: this is operational state about *this* instance, and it is what
 * `GET /api/compute/status` reports.
 */

interface StatusState {
  state: ComputeStatusState;
  lastRun: string | null;
  lastRunDurationMs: number | null;
  assetsProcessed: number;
  eventsProcessed: number;
  failures: number;
  provider: string;
  usingMockData: boolean;
}

const state: StatusState = {
  state: "idle",
  lastRun: null,
  lastRunDurationMs: null,
  assetsProcessed: 0,
  eventsProcessed: 0,
  failures: 0,
  provider: "unknown",
  usingMockData: false,
};

export function markRunning() {
  state.state = "running";
}

export function recordRun(summary: ComputeRunSummary, provider: string, isMock: boolean) {
  state.state = summary.failures > 0 ? "degraded" : "idle";
  state.lastRun = summary.finishedAt;
  state.lastRunDurationMs = summary.processingTimeMs;
  state.assetsProcessed = summary.assetsProcessed;
  state.eventsProcessed = summary.eventsProcessed;
  state.failures = summary.failures;
  state.provider = provider;
  state.usingMockData = isMock;
}

export function recordFailure(provider: string) {
  state.state = "error";
  state.provider = provider;
}

export function getComputeStatus(): ComputeStatus {
  return {
    status: state.state,
    computationVersion: CURRENT_SCORING_VERSION,
    lastRun: state.lastRun,
    lastRunDurationMs: state.lastRunDurationMs,
    assetsProcessed: state.assetsProcessed,
    eventsProcessed: state.eventsProcessed,
    failures: state.failures,
    provider: state.provider,
    usingMockData: state.usingMockData,
  };
}
