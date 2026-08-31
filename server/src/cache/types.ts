/**
 * Cache abstraction. Only the interface is a commitment; the in-memory
 * driver is enough for a single instance, and a shared driver can be added
 * in Phase 3 without touching callers.
 */
export interface Cache {
  readonly driver: string;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  /** Read-through helper: the common case in the API layer. */
  wrap<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T>;
}
