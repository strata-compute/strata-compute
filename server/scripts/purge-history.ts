import pg from "pg";
import { getPool, closePool } from "../src/database/pool.ts";

/**
 * PURGE HISTORY — one-off recovery, run by hand.
 *
 * Deletes history older than a cutoff and returns the space to disk.
 *
 * This exists because retention shipped disabled: the pipeline wrote roughly
 * fifty-eight rows across seven tables every sixty seconds and nothing ever
 * removed them, so two days of operation filled 465 MB of a 500 MB database
 * and the provider began throttling the project. Every symptom downstream —
 * auth timeouts, connection checkout failures, statement timeouts — was that.
 *
 * DELETE alone does not shrink a Postgres table; it only marks rows dead. The
 * space returns on VACUUM FULL, which rewrites the table and therefore needs
 * free space of its own. So the tables are vacuumed smallest first: each one
 * releases room for the next, and the largest is rewritten last, when there is
 * the most space to do it in.
 *
 * Usage:
 *   node scripts/purge-history.ts --hours=24          (dry run: counts only)
 *   node scripts/purge-history.ts --hours=24 --apply  (delete and vacuum)
 */

/** Table → the column that says when the row happened. */
const TABLES: { table: string; column: string }[] = [
  // ordered smallest to largest, which is also the safe vacuum order
  { table: "asset_prices", column: "timestamp" },
  { table: "market_metrics", column: "timestamp" },
  { table: "strata_scores", column: "timestamp" },
  { table: "rankings", column: "timestamp" },
  { table: "signals", column: "timestamp" },
  { table: "compute_events", column: "created_at" },
  { table: "market_snapshots", column: "timestamp" },
  { table: "asset_intelligence", column: "timestamp" },
];

/**
 * Rows removed per statement, overridable.
 *
 * Five thousand was too many once the instance was throttled: the statement
 * outlived its timeout and every retry re-did the same doomed work. Smaller
 * batches finish, and finishing is the only thing that makes progress here.
 */
const BATCH = Number(
  process.argv.find((a) => a.startsWith("--batch="))?.slice(8) ?? 500,
);

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

const HOURS = Number(arg("hours") ?? 24);
const APPLY = process.argv.includes("--apply");

/**
 * The connection is unreliable while the database is throttled, so every
 * statement is retried rather than assumed. Without this the purge fails
 * halfway and leaves the problem it was meant to fix.
 */
async function attempt<T>(
  label: string,
  run: (client: pg.PoolClient) => Promise<T>,
  tries = 8,
): Promise<T> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set");

  let lastError: unknown;
  for (let i = 1; i <= tries; i += 1) {
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const result = await run(client);
      client.release();
      return result;
    } catch (error) {
      lastError = error;
      if (client) client.release(true);
      if (i < tries) await new Promise((r) => setTimeout(r, 3_000 * i));
    }
  }
  throw new Error(
    `${label} failed after ${tries} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function main() {
  console.log(`\nPURGE HISTORY — keeping the last ${HOURS} hours`);
  console.log(APPLY ? "  MODE: apply\n" : "  MODE: dry run (nothing is deleted)\n");

  const before = await attempt("size check", async (c) => {
    const { rows } = await c.query<{ size: string }>(
      "select pg_size_pretty(pg_database_size(current_database())) size",
    );
    return rows[0]?.size ?? "?";
  });
  console.log(`  database before: ${before}\n`);

  let deletedTotal = 0;

  for (const { table, column } of TABLES) {
    if (!APPLY) {
      // A filtered count(*) over a hundred thousand rows is itself too much
      // for a throttled instance — it timed out where the deletes do not. So
      // the dry run asks whether anything qualifies, not how much.
      const sample = await attempt(`sample ${table}`, async (c) => {
        const { rowCount } = await c.query(
          `select 1 from ${table} where ${column} < now() - ($1 || ' hours')::interval limit 1`,
          [HOURS],
        );
        return rowCount ?? 0;
      });
      console.log(
        `  ${table.padEnd(22)} ${sample > 0 ? "has rows older than the cutoff" : "nothing older than the cutoff"}`,
      );
      continue;
    }

    // Delete until a batch comes back empty. No pre-count: the loop's own
    // result is the termination condition, and each statement is bounded.
    let removed = 0;
    for (;;) {
      const n = await attempt(`delete ${table}`, async (c) => {
        // ctid batching: no ordering, no index dependency, bounded work
        const { rowCount } = await c.query(
          `delete from ${table} where ctid in (
             select ctid from ${table}
              where ${column} < now() - ($1 || ' hours')::interval
              limit ${BATCH}
           )`,
          [HOURS],
        );
        return rowCount ?? 0;
      });
      if (n === 0) break;
      removed += n;
      process.stdout.write(`\r  ${table.padEnd(22)} deleted ${removed.toLocaleString()}`);
    }
    deletedTotal += removed;
    console.log(removed > 0 ? "" : `  ${table.padEnd(22)} nothing older than the cutoff`);
  }

  if (!APPLY) {
    console.log("\n  Dry run. Re-run with --apply to delete and reclaim.\n");
    return;
  }

  console.log(`\n  deleted ${deletedTotal.toLocaleString()} rows; reclaiming space\n`);

  for (const { table } of TABLES) {
    // VACUUM cannot run inside a transaction block, and needs its own time
    await attempt(`vacuum ${table}`, async (c) => {
      await c.query(`vacuum (full, analyze) ${table}`);
      return true;
    });
    const size = await attempt(`size ${table}`, async (c) => {
      const { rows } = await c.query<{ s: string }>(
        `select pg_size_pretty(pg_total_relation_size($1)) s`,
        [table],
      );
      return rows[0]?.s ?? "?";
    });
    console.log(`  vacuumed ${table.padEnd(22)} now ${size}`);
  }

  const after = await attempt("size check", async (c) => {
    const { rows } = await c.query<{ size: string }>(
      "select pg_size_pretty(pg_database_size(current_database())) size",
    );
    return rows[0]?.size ?? "?";
  });

  console.log(`\n  database before: ${before}`);
  console.log(`  database after:  ${after}\n`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
