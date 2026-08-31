/**
 * Job contract. A job is a named, idempotent unit of work with its own
 * interval. The scheduler owns timing; jobs own nothing but their work.
 */
export interface Job {
  readonly name: string;
  readonly description: string;
  /** Interval in milliseconds; read from configuration, never hardcoded. */
  readonly intervalMs: number;
  /** Run once at startup, before the first interval elapses. */
  readonly runOnStart?: boolean;
  run(): Promise<void>;
}

export interface JobState {
  name: string;
  intervalMs: number;
  running: boolean;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  runCount: number;
  failureCount: number;
}
