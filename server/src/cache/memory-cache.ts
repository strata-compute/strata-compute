import type { Cache } from "./types.ts";

interface Entry {
  value: unknown;
  /** When the value stops being fresh and a refresh should be started. */
  freshUntil: number;
  /** When it stops being servable at all. */
  usableUntil: number;
}

/**
 * Single-process cache with stale-while-revalidate. Adequate for one instance.
 *
 * Plain read-through caching solved nothing here, and made the failure pattern
 * hard to read: the cache absorbed most requests, but the one that arrived
 * after expiry paid the full cost of the underlying read. On this database
 * that read measured almost thirteen seconds against a frontend that gives up
 * at eight, so roughly one page view per TTL window rendered as "unavailable"
 * while the rest were instant. That is exactly the flicker between live and
 * offline that this was reported as.
 *
 * The fix is to never make a request wait for a refresh. Once a value exists,
 * it is served immediately — fresh or stale — and a stale hit starts a refresh
 * in the background for whoever comes next. Only the very first caller for a
 * key, when nothing is cached at all, waits on the database.
 *
 * A stale value is still an honest one: every payload carries the timestamps
 * it was computed with, so a few seconds of age is visible in the response
 * rather than hidden by it.
 */
export class MemoryCache implements Cache {
  readonly driver = "memory";
  private readonly store = new Map<string, Entry>();
  /** Keys currently being refreshed, so a burst starts one read, not twenty. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  private readonly defaultTtlSeconds: number;

  /**
   * How far past freshness a value may still be served.
   *
   * Ten minutes. Long enough that a slow spell in the database is invisible to
   * anyone reading the site, short enough that genuinely dead data expires
   * instead of being served indefinitely.
   */
  private static readonly STALE_GRACE_SECONDS = 600;

  constructor(defaultTtlSeconds: number) {
    this.defaultTtlSeconds = defaultTtlSeconds;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    // `get` keeps its original contract: fresh values only.
    if (entry.freshUntil <= Date.now()) {
      if (entry.usableUntil <= Date.now()) this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    const now = Date.now();
    this.store.set(key, {
      value,
      freshUntil: now + ttl * 1000,
      usableUntil: now + (ttl + MemoryCache.STALE_GRACE_SECONDS) * 1000,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.inFlight.clear();
  }

  async wrap<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const entry = this.store.get(key);
    const now = Date.now();

    if (entry && entry.usableUntil > now) {
      // stale but servable: hand it over now, refresh behind the request
      if (entry.freshUntil <= now) this.refresh(key, ttlSeconds, factory);
      return entry.value as T;
    }

    // nothing usable — this caller has to wait, but only one of them does
    return this.refresh(key, ttlSeconds, factory);
  }

  /**
   * Starts a refresh, or joins the one already running.
   *
   * Without the in-flight map, a burst of requests arriving on a cold key
   * would each start their own read and multiply the load that made the
   * database slow in the first place.
   */
  private refresh<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const running = this.inFlight.get(key);
    if (running) return running as Promise<T>;

    const task = factory()
      .then(async (value) => {
        await this.set(key, value, ttlSeconds);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, task);
    // A background refresh must never take the process down: if it rejects,
    // the stale value simply stays until the next attempt.
    task.catch(() => undefined);
    return task;
  }
}
