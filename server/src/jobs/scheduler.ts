import { describeError, logger } from "../utils/logger.ts";
import { nowIso } from "../utils/time.ts";
import type { Job, JobState } from "./types.ts";

/**
 * Interval scheduler.
 *
 * Deliberately conservative: one run at a time per job (an overrun is skipped,
 * not queued), failures are recorded and never crash the process, and
 * everything stops cleanly on shutdown. Intervals come from configuration, so
 * nothing here polls aggressively by default.
 */

interface Entry {
  job: Job;
  timer: NodeJS.Timeout | null;
  state: JobState;
}

export class JobScheduler {
  private readonly entries = new Map<string, Entry>();
  private started = false;

  register(job: Job): void {
    if (this.entries.has(job.name)) {
      throw new Error(`Job '${job.name}' is already registered`);
    }
    this.entries.set(job.name, {
      job,
      timer: null,
      state: {
        name: job.name,
        intervalMs: job.intervalMs,
        running: false,
        lastRunAt: null,
        lastDurationMs: null,
        lastError: null,
        runCount: 0,
        failureCount: 0,
      },
    });
  }

  private async execute(entry: Entry): Promise<void> {
    if (entry.state.running) {
      logger.warn("job overrun — skipping this tick", { job: entry.job.name });
      return;
    }

    entry.state.running = true;
    const started = performance.now();

    try {
      await entry.job.run();
      entry.state.lastError = null;
    } catch (error) {
      entry.state.failureCount += 1;
      entry.state.lastError = error instanceof Error ? error.message : String(error);
      logger.error("job failed", { job: entry.job.name, ...describeError(error) });
    } finally {
      entry.state.running = false;
      entry.state.runCount += 1;
      entry.state.lastRunAt = nowIso();
      entry.state.lastDurationMs = Number((performance.now() - started).toFixed(2));
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    for (const entry of this.entries.values()) {
      if (entry.job.runOnStart) {
        await this.execute(entry);
      }
      entry.timer = setInterval(() => {
        void this.execute(entry);
      }, entry.job.intervalMs);
      // a scheduler tick must never hold the process open
      entry.timer.unref?.();

      logger.info("job scheduled", {
        job: entry.job.name,
        intervalMs: entry.job.intervalMs,
      });
    }
  }

  stop(): void {
    for (const entry of this.entries.values()) {
      if (entry.timer) clearInterval(entry.timer);
      entry.timer = null;
    }
    this.started = false;
  }

  /**
   * Waits for any job still running to finish.
   *
   * Called after `stop()`, so nothing new can start and this can only shrink.
   * Bounded: a job wedged on an unresponsive provider must not hold a
   * deployment open indefinitely, and abandoning it is safe — every write it
   * makes is inside a transaction that rolls back with the process.
   */
  async drain(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const running = () => [...this.entries.values()].filter((e) => e.state.running);

    while (running().length > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const stuck = running();
    if (stuck.length > 0) {
      logger.warn("jobs still running at shutdown — abandoning them", {
        jobs: stuck.map((e) => e.job.name).join(","),
      });
      return false;
    }
    return true;
  }

  /** Runs a job immediately, outside its schedule. */
  async runNow(name: string): Promise<JobState> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Unknown job '${name}'`);
    await this.execute(entry);
    return { ...entry.state };
  }

  getStates(): JobState[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.state }));
  }

  get isStarted(): boolean {
    return this.started;
  }
}

export const scheduler = new JobScheduler();
