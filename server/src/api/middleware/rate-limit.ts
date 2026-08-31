import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env.ts";
import { AppError } from "../../utils/errors.ts";

/**
 * Rate limiting abstraction.
 *
 * The interface is the commitment; the fixed-window counter behind it is
 * per-process and adequate for a single instance. A shared implementation
 * (Redis, a gateway) replaces `MemoryRateLimiter` without touching callers.
 */

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimiter {
  readonly driver: string;
  check(key: string): RateLimitDecision;
}

export class MemoryRateLimiter implements RateLimiter {
  readonly driver = "memory";
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  private readonly windowMs: number;
  private readonly max: number;

  constructor(windowMs: number, max: number) {
    this.windowMs = windowMs;
    this.max = max;
  }

  check(key: string): RateLimitDecision {
    const now = Date.now();
    const entry = this.hits.get(key);

    if (!entry || entry.resetAt <= now) {
      const resetAt = now + this.windowMs;
      this.hits.set(key, { count: 1, resetAt });
      // opportunistic sweep keeps the map from growing without bound
      if (this.hits.size > 10_000) {
        for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
      }
      return { allowed: true, remaining: this.max - 1, resetAt };
    }

    entry.count += 1;
    return {
      allowed: entry.count <= this.max,
      remaining: Math.max(0, this.max - entry.count),
      resetAt: entry.resetAt,
    };
  }
}

const limiter: RateLimiter = new MemoryRateLimiter(
  env.RATE_LIMIT_WINDOW_MS,
  env.RATE_LIMIT_MAX,
);

/**
 * Probes are counted separately.
 *
 * They arrive from a platform on a fixed schedule and must never be refused:
 * a 429 on /health is indistinguishable from a dead instance, and the
 * platform's response to that is to remove a service that was working.
 */
const probeLimiter: RateLimiter = new MemoryRateLimiter(
  env.RATE_LIMIT_WINDOW_MS,
  env.RATE_LIMIT_PROBE_MAX,
);

const PROBE_PATHS = new Set(["/api/health", "/api/ready"]);

/**
 * Who a request is counted against.
 *
 * `X-Forwarded-For` is believed only when TRUST_PROXY says a proxy sets it.
 * Without that guard any caller could pick their own bucket by inventing a
 * header, which turns the limiter into decoration.
 */
function clientKey(req: Request): string {
  if (env.TRUST_PROXY) {
    const forwarded = req.header("x-forwarded-for");
    const first = forwarded?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip ?? "unknown";
}

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const probe = PROBE_PATHS.has(req.path);
  const active = probe ? probeLimiter : limiter;
  const max = probe ? env.RATE_LIMIT_PROBE_MAX : env.RATE_LIMIT_MAX;

  const decision = active.check(`${probe ? "probe:" : "api:"}${clientKey(req)}`);

  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(decision.resetAt / 1000)));

  if (!decision.allowed) {
    next(new AppError("RATE_LIMITED", "Too many requests"));
    return;
  }
  next();
}
