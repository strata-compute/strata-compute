import { env } from "../config/env.ts";
import { MemoryCache } from "./memory-cache.ts";
import { NoCache } from "./no-cache.ts";
import type { Cache } from "./types.ts";

let instance: Cache | null = null;

export function getCache(): Cache {
  if (instance) return instance;
  instance =
    env.CACHE_DRIVER === "memory" ? new MemoryCache(env.CACHE_TTL_SECONDS) : new NoCache();
  return instance;
}

export type { Cache } from "./types.ts";
