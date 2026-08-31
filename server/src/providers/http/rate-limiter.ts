import { logger } from "../../utils/logger.ts";

/**
 * Per-provider request pacing.
 *
 * Two independent limits, because providers impose both kinds: a short-window
 * rate (CoinGecko, Robinhood, Blockscout) and a hard daily quota (Alpha
 * Vantage free tier is 25 requests a day). Exceeding either is not a retryable
 * error — it is a design failure — so the limiter blocks rather than firing
 * and hoping.
 */

export interface RateLimitOptions {
  provider: string;
  /** Sustained requests per second. */
  perSecond: number;
  /** Hard cap per rolling 24h, when the provider enforces one. */
  perDay?: number;
  /** Minimum spacing between calls; derived from perSecond when omitted. */
  minIntervalMs?: number;
}

export class RateLimitExceededError extends Error {
  readonly provider: string;
  readonly scope: "day";

  constructor(provider: string, message: string) {
    super(message);
    this.name = "RateLimitExceededError";
    this.provider = provider;
    this.scope = "day";
  }
}

export class RateLimiter {
  readonly provider: string;
  private readonly minIntervalMs: number;
  private readonly perDay: number | null;

  private queue: Promise<void> = Promise.resolve();
  private lastStartedAt = 0;
  private dayCount = 0;
  private dayResetAt = Date.now() + 86_400_000;

  constructor(options: RateLimitOptions) {
    this.provider = options.provider;
    this.minIntervalMs =
      options.minIntervalMs ?? Math.ceil(1000 / Math.max(options.perSecond, 0.01));
    this.perDay = options.perDay ?? null;
  }

  get remainingToday(): number | null {
    this.rollDay();
    return this.perDay === null ? null : Math.max(0, this.perDay - this.dayCount);
  }

  private rollDay() {
    if (Date.now() >= this.dayResetAt) {
      this.dayCount = 0;
      this.dayResetAt = Date.now() + 86_400_000;
    }
  }

  /**
   * Serialises callers through a promise chain so concurrent jobs cannot
   * collectively exceed the interval.
   */
  async acquire(): Promise<void> {
    const wait = this.queue.then(async () => {
      this.rollDay();

      if (this.perDay !== null && this.dayCount >= this.perDay) {
        throw new RateLimitExceededError(
          this.provider,
          `Daily quota of ${this.perDay} requests exhausted; resets at ${new Date(this.dayResetAt).toISOString()}`,
        );
      }

      const since = Date.now() - this.lastStartedAt;
      if (since < this.minIntervalMs) {
        await new Promise((resolve) => setTimeout(resolve, this.minIntervalMs - since));
      }

      this.lastStartedAt = Date.now();
      this.dayCount += 1;
    });

    // a rejected acquire must not poison the chain for the next caller
    this.queue = wait.then(
      () => undefined,
      () => undefined,
    );
    return wait;
  }

  /** Called when a provider reports a limit we did not predict. */
  penalise(reason: string) {
    logger.warn("provider reported a rate limit", { provider: this.provider, reason });
    this.lastStartedAt = Date.now() + this.minIntervalMs * 4;
  }

  snapshot() {
    this.rollDay();
    return {
      provider: this.provider,
      minIntervalMs: this.minIntervalMs,
      perDay: this.perDay,
      usedToday: this.perDay === null ? null : this.dayCount,
      remainingToday: this.remainingToday,
      resetsAt: this.perDay === null ? null : new Date(this.dayResetAt).toISOString(),
    };
  }
}
