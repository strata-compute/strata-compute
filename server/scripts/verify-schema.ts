import { getPool, closePool } from "../src/database/pool.ts";
import { ARENA_ENTRY_STATUSES, ARENA_ROUND_STATUSES } from "../src/types/arena.ts";
import { SIGNAL_SEVERITIES } from "../src/types/signals.ts";
import { ASSET_TYPES } from "../src/types/domain.ts";
import {
  INTELLIGENCE_EVENT_STATUSES,
  INTELLIGENCE_EVENT_TYPES,
  INTELLIGENCE_SEVERITIES,
} from "../src/types/intelligence-events.ts";

/**
 * SCHEMA DRIFT CHECK
 *
 * Compares the value sets TypeScript uses against the CHECK constraints the
 * database enforces.
 *
 * This exists because the same failure happened three times. A vocabulary
 * changed in the code — signal severity gained `critical`, arena status
 * gained `winner`, market metrics dropped a column — while the constraint
 * written in migration 001 stayed as it was. Nothing failed at compile time,
 * nothing failed in tests against the in-memory store, and nothing failed at
 * all until a real database was connected. Then it failed as a rejected
 * INSERT that took an entire pipeline pass down with it.
 *
 * A type checker cannot see inside a CHECK constraint, so this closes the
 * gap from the other side.
 */

interface Expectation {
  table: string;
  column: string;
  values: readonly string[];
}

const EXPECTATIONS: Expectation[] = [
  { table: "signals", column: "severity", values: SIGNAL_SEVERITIES },
  { table: "arena_entries", column: "status", values: ARENA_ENTRY_STATUSES },
  { table: "arena_rounds", column: "status", values: ARENA_ROUND_STATUSES },
  { table: "assets", column: "asset_type", values: ASSET_TYPES },
  {
    table: "intelligence_events",
    column: "status",
    values: INTELLIGENCE_EVENT_STATUSES,
  },
  {
    table: "intelligence_events",
    column: "severity",
    values: INTELLIGENCE_SEVERITIES,
  },
  {
    table: "intelligence_events",
    column: "event_type",
    values: INTELLIGENCE_EVENT_TYPES,
  },
];

async function main() {
  const pool = getPool();
  if (!pool) {
    console.error("DATABASE_URL is not set; nothing to verify.");
    process.exitCode = 2;
    return;
  }

  const { rows } = await pool.query<{ tbl: string; conname: string; def: string }>(
    `select conrelid::regclass::text tbl, conname, pg_get_constraintdef(oid) def
       from pg_constraint
      where contype = 'c' and connamespace = 'public'::regnamespace`,
  );

  let problems = 0;

  for (const expectation of EXPECTATIONS) {
    const constraint = rows.find(
      (r) => r.tbl === expectation.table && r.conname.includes(expectation.column),
    );

    if (!constraint) {
      console.log(
        `  ?  ${expectation.table}.${expectation.column}: no CHECK constraint found`,
      );
      continue;
    }

    // upper case as well as lower: intelligence event types are SHOUTED
    const allowed = [...constraint.def.matchAll(/'([A-Za-z_]+)'/g)].map(
      (m) => m[1] as string,
    );
    const missing = expectation.values.filter((v) => !allowed.includes(v));
    const extra = allowed.filter((v) => !expectation.values.includes(v as never));

    if (missing.length === 0 && extra.length === 0) {
      console.log(`  ok ${expectation.table}.${expectation.column}  (${allowed.length} values)`);
      continue;
    }

    problems += 1;
    console.log(`  !! ${expectation.table}.${expectation.column}`);
    if (missing.length > 0) {
      console.log(`       code allows, database rejects: ${missing.join(", ")}`);
    }
    if (extra.length > 0) {
      console.log(`       database allows, code no longer emits: ${extra.join(", ")}`);
    }
  }

  console.log("");
  if (problems > 0) {
    console.log(`${problems} constraint(s) have drifted from the code. A migration is needed.`);
    process.exitCode = 1;
  } else {
    console.log("Every checked constraint matches the code.");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
