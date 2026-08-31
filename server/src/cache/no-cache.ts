import type { Cache } from "./types.ts";

/** Pass-through driver, so caching can be disabled without branching callers. */
export class NoCache implements Cache {
  readonly driver = "none";
  async get<T>(): Promise<T | null> {
    return null;
  }
  async set(): Promise<void> {}
  async delete(): Promise<void> {}
  async clear(): Promise<void> {}
  async wrap<T>(_key: string, _ttl: number, factory: () => Promise<T>): Promise<T> {
    return factory();
  }
}
