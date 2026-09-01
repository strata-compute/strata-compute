import { env } from "../config/env.ts";
import { getPool } from "./pool.ts";
import { describeError, logger } from "../utils/logger.ts";

/**
 * HISTORY RETENTION
 *
 * Removes stored history older than the configured window.
 *
 * This did not exist. `RETENTION_ENABLED` and the two day-count settings were
 * declared in the environment schema and read by nothing, so the pipeline
 * wrote roughly fifty-eight rows across seven tables every sixty seconds and
 * nothing ever removed them. Two days of operation filled 465 MB of a 500 MB
 * database, the provider began throttling the project, and every endpoint
 * started failing — connection checkouts, auth checks, statements. The outage
 * looked like a database problem and was a growth problem.
 *
 * What is kept regardless of window:
 *
 *   assets              the universe itself
 *   arena_rounds        settled rounds are the record of what happened
 *   arena_entries       standings belong to their round
 *   intelligence_events open conditions, and the closed ones a reader may
 *                       still be looking at
 *   schema_migrations   obviously
 *
 * What the engine actually reads decides the floor: the widest detection
 * window is four hours and score history renders about two. A one-day window
 * is therefore comfortably above everything, and is what a 500 MB database
 * can hold at this cadence.
 */

/** Table → the column that says when the row happened. */
const HISTORY: { table: string; column: string; kind: "market" | "event" }[] = [
  { table: "asset_prices", column: "timestamp", kind: "market" },
  { table: "market_metrics", column: "timestamp", kind: "market" },
  { table: "market_snapshots", column: "timestamp", kind: "market" },
  { table: "strata_scores", column: "timestamp", kind: "market" },
  { table: "asset_intelligence", column: "timestamp", kind: "market" },
  { table: "rankings", column: "timestamp", kind: "market" },
  { table: "signals", column: "timestamp", kind: "event" },
  { table: "compute_events", column: "created_at", kind: "event" },
];

/**
 * Rows removed per statement.
 *
 * Bounded on purpose. One unbounded DELETE over a hundred thousand rows takes
 * a lock and a transaction long enough to trip a statement timeout on a small
 * instance — which is the state this job exists to prevent, so it must not
 * cause it.
 */
const BATCH = 2_000;

/** Statements per table per run. Whatever is left waits for the next run. */
const MAX_BATCHES = 25;

export interface RetentionResult {
  enabled: boolean;
  removed: Record<string, number>;
  totalRemoved: number;
  durationMs: number;
}

export async function pruneHistory(): Promise<RetentionResult> {
  const started = performance.now();
  const removed: Record<string, number> = {};

  if (!env.RETENTION_ENABLED) {
    return { enabled: false, removed, totalRemoved: 0, durationMs: 0 };
  }

  const pool = getPool();
  if (!pool) {
    return { enabled: true, removed, totalRemoved: 0, durationMs: 0 };
  }

  const windowFor = (kind: "market" | "event") =>
    kind === "market"
      ? env.MARKET_HISTORY_RETENTION_DAYS
      : env.EVENT_RETENTION_DAYS;

  let totalRemoved = 0;

  for (const { table, column, kind } of HISTORY) {
    const days = windowFor(kind);
    // zero means keep everything for that class, which stays a valid choice
    if (days <= 0) continue;

    let tableRemoved = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      try {
        // ctid batching: no ordering, no index dependency, bounded work
        const { rowCount } = await pool.query(
          `DELETE FROM ${table} WHERE ctid IN (
             SELECT ctid FROM ${table}
              WHERE ${column} < now() - ($1 || ' days')::interval
              LIMIT ${BATCH}
           )`,
          [days],
        );
        if (!rowCount) break;
        tableRemoved += rowCount;
      } catch (error) {
        // One table failing must not stop the rest: the point of this job is
        // to reduce pressure, and refusing to prune anything because one
        // statement timed out would do the opposite.
        logger.warn("retention: table could not be pruned", {
          job: "retention",
          table,
          ...describeError(error),
        });
        break;
      }
    }

    if (tableRemoved > 0) {
      removed[table] = tableRemoved;
      totalRemoved += tableRemoved;
    }
  }

  const durationMs = Number((performance.now() - started).toFixed(2));

  if (totalRemoved > 0) {
    logger.info("retention pass complete", {
      job: "retention",
      removed: totalRemoved,
      tables: Object.keys(removed).length,
      marketDays: env.MARKET_HISTORY_RETENTION_DAYS,
      eventDays: env.EVENT_RETENTION_DAYS,
      durationMs,
    });
  }

  return { enabled: true, removed, totalRemoved, durationMs };
}
