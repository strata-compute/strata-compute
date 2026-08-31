import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type pg from "pg";
import { getPool } from "./pool.ts";
import { describeError, logger } from "../utils/logger.ts";

/**
 * Minimal forward-only migration runner: applies every .sql file in
 * `migrations/` once, in filename order, inside a transaction, and records it
 * in `schema_migrations`.
 */

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations", import.meta.url));

/**
 * Waits for the database to answer before doing anything.
 *
 * A managed pooler can refuse the first connection for a few seconds — a
 * previous instance still releasing its slots is enough. Without this the
 * migration step of a deploy fails on a timeout that would have cleared on
 * its own, which is the worst kind of failure: transient, alarming, and
 * indistinguishable at a glance from a real outage.
 *
 * Only the *connection* is retried. A migration that starts and fails is not
 * retried here — it runs in its own transaction, rolls back, and is left for
 * an operator to look at.
 */
async function waitForDatabase(pool: pg.Pool, attempts = 5): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      const delayMs = attempt * 1_000;
      logger.warn("database not ready — retrying", {
        attempt,
        of: attempts,
        delayMs,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function migrate(): Promise<{ applied: string[]; skipped: string[] }> {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set — nothing to migrate");
  }

  await waitForDatabase(pool);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const { rows } = await pool.query<{ name: string }>(`SELECT name FROM schema_migrations`);
  const done = new Set(rows.map((r) => r.name));

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (done.has(file)) {
      skipped.push(file);
      continue;
    }
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
      await client.query("COMMIT");
      applied.push(file);
      logger.info("migration applied", { migration: file });
    } catch (error) {
      await client.query("ROLLBACK");
      logger.error("migration failed", { migration: file, ...describeError(error) });
      throw error;
    } finally {
      client.release();
    }
  }

  return { applied, skipped };
}

// `npm run migrate`
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  migrate()
    .then((result) => {
      logger.info("migrations complete", {
        applied: result.applied.length,
        skipped: result.skipped.length,
      });
      process.exit(0);
    })
    .catch((error) => {
      logger.error("migration run failed", describeError(error));
      process.exit(1);
    });
}
