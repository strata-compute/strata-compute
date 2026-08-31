import { env } from "../config/env.ts";
import { logger } from "../utils/logger.ts";
import { MemoryStore } from "./memory-store.ts";
import { getPool } from "./pool.ts";
import { PostgresStore } from "./postgres-store.ts";
import type { StrataStore } from "./store.ts";

/**
 * STORE RESOLUTION
 *
 * Postgres is the source of truth. Memory is a development convenience that
 * must be requested by name and can never be reached by accident.
 *
 * The previous behaviour was to fall back to memory whenever Postgres was
 * unreachable. That is the failure mode this rewrite exists to remove: a
 * deployment would come up "healthy", serve requests, compute scores, open
 * Arena rounds — and persist none of it. Every restart silently discarded the
 * history that the scoring engine depends on, and nothing in the interface
 * said so.
 *
 * So the rule is now explicit. `DATA_STORE=postgres` (the default) requires a
 * working database and refuses to start without one. `DATA_STORE=memory` is
 * honoured only outside production, and announces itself.
 */

let store: StrataStore | null = null;

export class DatabaseUnavailableError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(
      `Strata requires PostgreSQL and could not reach it: ${reason}\n\n` +
        `  DATA_STORE is "postgres", so there is no fallback by design.\n` +
        `  Check DATABASE_URL, DATABASE_SSL and network reachability.\n` +
        `  For a database-free local run, set DATA_STORE=memory explicitly\n` +
        `  (refused when NODE_ENV=production).`,
    );
    this.name = "DatabaseUnavailableError";
    this.reason = reason;
  }
}

export async function initStore(): Promise<StrataStore> {
  if (store) return store;

  if (env.DATA_STORE === "memory") {
    if (env.NODE_ENV === "production") {
      throw new DatabaseUnavailableError(
        "DATA_STORE=memory is refused in production; nothing would be persisted",
      );
    }
    logger.warn(
      "DATA_STORE=memory — nothing is persisted and all state is lost on restart",
      { store: "memory" },
    );
    store = new MemoryStore();
    return store;
  }

  const pool = getPool();
  if (!pool) {
    throw new DatabaseUnavailableError("DATABASE_URL is not set");
  }

  const candidate = new PostgresStore(pool);
  if (!(await candidate.isHealthy())) {
    throw new DatabaseUnavailableError("the connection check failed");
  }

  store = candidate;
  logger.info("store initialised", { store: "postgres" });
  return store;
}

export function getStore(): StrataStore {
  if (!store) throw new Error("Store accessed before initStore()");
  return store;
}

/** Test seam. Never called by the service. */
export function __setStore(next: StrataStore | null): void {
  store = next;
}

export type { StrataStore } from "./store.ts";
