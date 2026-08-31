import { nowIso, type IsoTimestamp } from "../utils/time.ts";

/**
 * Per-provider ingestion bookkeeping.
 *
 * This is what `/api/compute/status` reports: when each provider last synced
 * successfully, how much it produced, and what went wrong. Kept in-process
 * because it describes this instance's view of the world.
 */

export interface ProviderSyncState {
  provider: string;
  lastAttemptAt: IsoTimestamp | null;
  lastSuccessAt: IsoTimestamp | null;
  lastDurationMs: number | null;
  recordsFetched: number;
  recordsStored: number;
  recordsRejected: number;
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorAt: IsoTimestamp | null;
}

const states = new Map<string, ProviderSyncState>();

function ensure(provider: string): ProviderSyncState {
  const existing = states.get(provider);
  if (existing) return existing;
  const created: ProviderSyncState = {
    provider,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastDurationMs: null,
    recordsFetched: 0,
    recordsStored: 0,
    recordsRejected: 0,
    consecutiveFailures: 0,
    lastError: null,
    lastErrorAt: null,
  };
  states.set(provider, created);
  return created;
}

export function recordAttempt(provider: string) {
  ensure(provider).lastAttemptAt = nowIso();
}

export function recordSuccess(
  provider: string,
  result: { fetched: number; stored: number; rejected: number; durationMs: number },
) {
  const state = ensure(provider);
  state.lastSuccessAt = nowIso();
  state.lastDurationMs = result.durationMs;
  state.recordsFetched = result.fetched;
  state.recordsStored = result.stored;
  state.recordsRejected = result.rejected;
  state.consecutiveFailures = 0;
  state.lastError = null;
}

export function recordFailure(provider: string, error: unknown) {
  const state = ensure(provider);
  state.consecutiveFailures += 1;
  state.lastError = error instanceof Error ? error.message : String(error);
  state.lastErrorAt = nowIso();
}

export function getProviderStates(): ProviderSyncState[] {
  return [...states.values()];
}

export function getProviderState(provider: string): ProviderSyncState | null {
  return states.get(provider) ?? null;
}

/** Providers that have failed repeatedly, for the health summary. */
export function failingProviders(threshold = 3): string[] {
  return [...states.values()]
    .filter((s) => s.consecutiveFailures >= threshold)
    .map((s) => s.provider);
}

export function resetProviderStates() {
  states.clear();
}
