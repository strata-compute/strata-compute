import { env } from "../config/env.ts";
import { MemoryCache } from "./memory-cache.ts";
import { RedisCache } from "./redis-cache.ts";
import { NoCache } from "./no-cache.ts";
import type { Cache } from "./types.ts";

let instance: Cache | null = null;

export function getCache(): Cache {
  if (instance) return instance;
  if (env.CACHE_DRIVER !== "memory") {
    instance = new NoCache();
    return instance;
  }

  /**
   * Redis when it is configured, memory otherwise.
   *
   * Not a hard dependency: the Redis driver keeps a memory tier in front and
   * treats every remote failure as a miss, so a missing or broken Upstash
   * degrades to exactly the cache that shipped before it.
   */
  instance =
    env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
      ? new RedisCache(
          env.UPSTASH_REDIS_REST_URL,
          env.UPSTASH_REDIS_REST_TOKEN,
          env.CACHE_TTL_SECONDS,
        )
      : new MemoryCache(env.CACHE_TTL_SECONDS);
  return instance;
}

export type { Cache } from "./types.ts";
