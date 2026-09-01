import { describeError, logger } from "../utils/logger.ts";
import { MemoryCache } from "./memory-cache.ts";
import type { Cache } from "./types.ts";

interface Envelope<T> {
  value: T;
  /** Epoch ms after which the value should be refreshed in the background. */
  freshUntil: number;
}

/**
 * Two-tier cache: process memory in front, Upstash Redis behind.
 *
 * The memory tier alone was enough to stop visitors waiting on a slow
 * database, but it dies with the process. Every deploy, every restart, every
 * platform event empties it — and the first visitor afterwards pays the full
 * cost of a cold read, which on this instance is around thirteen seconds and
 * renders as an unavailable page. During a launch window that is precisely the
 * moment it must not happen.
 *
 * Redis does not make the database faster. It makes a warm cache survive a
 * restart, which is a different problem and the one that was left.
 *
 * Reads check memory first, so a hit costs nothing over the wire. Only a miss
 * consults Redis, and only a miss in both reaches the database. Writes go to
 * both, with the Redis key given the full freshness-plus-grace lifetime so a
 * restarted process finds a value it can serve immediately while it refreshes.
 *
 * Every Redis call is allowed to fail. If Upstash is unreachable this degrades
 * to exactly the memory cache that came before it — a cache is an optimisation,
 * and an optimisation that can take the service down is a liability.
 */
export class RedisCache implements Cache {
  readonly driver = "redis";

  private readonly local: MemoryCache;
  private readonly url: string;
  private readonly token: string;
  private readonly graceSeconds: number;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  /** Logged once, not per request: a broken cache should not flood the log. */
  private warned = false;

  constructor(
    url: string,
    token: string,
    defaultTtlSeconds: number,
    graceSeconds = 21_600,
  ) {
    this.local = new MemoryCache(defaultTtlSeconds);
    this.url = url.replace(/\/+$/, "");
    this.token = token;
    this.graceSeconds = graceSeconds;
  }

  /** One Upstash REST command. Never throws; a failure is a cache miss. */
  private async command<T>(args: (string | number)[]): Promise<T | null> {
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(args.map(String)),
        signal: AbortSignal.timeout(2_500),
      });
      if (!response.ok) throw new Error(`upstash responded ${response.status}`);
      const body = (await response.json()) as { result?: unknown };
      return (body.result ?? null) as T | null;
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        logger.warn("redis cache unavailable, serving from memory only", describeError(error));
      }
      return null;
    }
  }

  private async readRemote<T>(key: string): Promise<Envelope<T> | null> {
    const raw = await this.command<string>(["GET", key]);
    if (typeof raw !== "string") return null;
    try {
      return JSON.parse(raw) as Envelope<T>;
    } catch {
      return null;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const local = await this.local.get<T>(key);
    if (local !== null) return local;

    const remote = await this.readRemote<T>(key);
    if (!remote || remote.freshUntil <= Date.now()) return null;

    // repopulate the local tier so the next hit costs nothing
    const remaining = Math.ceil((remote.freshUntil - Date.now()) / 1000);
    await this.local.set(key, remote.value, Math.max(1, remaining));
    return remote.value;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? 60;
    await this.local.set(key, value, ttl);
    const envelope: Envelope<T> = { value, freshUntil: Date.now() + ttl * 1000 };
    await this.command(["SET", key, JSON.stringify(envelope), "EX", ttl + this.graceSeconds]);
  }

  async delete(key: string): Promise<void> {
    await this.local.delete(key);
    await this.command(["DEL", key]);
  }

  async clear(): Promise<void> {
    // deliberately local only: FLUSHDB on a shared store is not this service's
    // decision to make, and nothing here needs it
    await this.local.clear();
  }

  async wrap<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    // 1. fresh in memory — the overwhelming majority of requests stop here
    const local = await this.local.get<T>(key);
    if (local !== null) return local;

    // 2. anything in Redis, fresh or stale, is served now and refreshed behind
    const remote = await this.readRemote<T>(key);
    if (remote) {
      const stale = remote.freshUntil <= Date.now();
      const remaining = stale ? ttlSeconds : Math.ceil((remote.freshUntil - Date.now()) / 1000);
      await this.local.set(key, remote.value, Math.max(1, remaining));
      if (stale) this.refresh(key, ttlSeconds, factory);
      return remote.value;
    }

    // 3. nothing anywhere — this caller waits, and only this one
    return this.refresh(key, ttlSeconds, factory);
  }

  /** Starts a refresh, or joins the one already running for this key. */
  private refresh<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const running = this.inFlight.get(key);
    if (running) return running as Promise<T>;

    const task = factory()
      .then(async (value) => {
        await this.set(key, value, ttlSeconds);
        return value;
      })
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, task);
    // a background refresh must never take the process down
    task.catch(() => undefined);
    return task;
  }
}
