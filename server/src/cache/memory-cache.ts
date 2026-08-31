import type { Cache } from "./types.ts";

interface Entry {
  value: unknown;
  expiresAt: number;
}

/** Single-process cache with lazy expiry. Adequate for one instance. */
export class MemoryCache implements Cache {
  readonly driver = "memory";
  private readonly store = new Map<string, Entry>();

  private readonly defaultTtlSeconds: number;

  constructor(defaultTtlSeconds: number) {
    this.defaultTtlSeconds = defaultTtlSeconds;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    this.store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async wrap<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }
}
