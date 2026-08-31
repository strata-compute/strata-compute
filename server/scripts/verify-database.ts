import { getPool, closePool } from "../src/database/pool.ts";

/**
 * A read-only inventory of the production database.
 *
 * Answers the deployment questions directly against the server rather than
 * against the migration files: which tables exist, whether every migration has
 * been recorded, whether the indexes and constraints the code depends on are
 * actually there, and whether real rows are present.
 *
 * Writes nothing.
 */
async function main() {
  const pool = getPool();
  if (!pool) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 2;
    return;
  }

  const { rows: version } = await pool.query<{ v: string }>("SELECT version() AS v");
  console.log("\nSERVER");
  console.log(`  ${version[0]?.v.split(",")[0]}`);

  const { rows: migrations } = await pool.query<{ name: string; applied_at: Date }>(
    "SELECT name, applied_at FROM schema_migrations ORDER BY name",
  );
  console.log(`\nMIGRATIONS APPLIED (${migrations.length})`);
  for (const m of migrations) {
    console.log(`  ${m.name.padEnd(36)} ${m.applied_at.toISOString().slice(0, 19)}`);
  }

  const { rows: tables } = await pool.query<{ table_name: string; n: string }>(
    `SELECT c.relname AS table_name, to_char(c.reltuples, 'FM999999999') AS n
       FROM pg_class c
       JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname`,
  );
  console.log(`\nTABLES (${tables.length})`);

  // exact counts for the tables the product actually reads
  const counted = [
    "assets",
    "market_snapshots",
    "asset_intelligence",
    "signals",
    "rankings",
    "arena_rounds",
    "arena_entries",
    "intelligence_events",
    "compute_events",
  ];
  for (const table of tables) {
    if (!counted.includes(table.table_name)) {
      console.log(`  ${table.table_name.padEnd(28)} -`);
      continue;
    }
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${table.table_name}`,
    );
    console.log(`  ${table.table_name.padEnd(28)} ${rows[0]?.n} rows`);
  }

  const { rows: indexes } = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM pg_indexes WHERE schemaname = 'public'",
  );
  const { rows: constraints } = await pool.query<{ contype: string; n: string }>(
    `SELECT contype, count(*)::text AS n
       FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
      GROUP BY contype ORDER BY contype`,
  );
  const label: Record<string, string> = {
    c: "check",
    f: "foreign key",
    p: "primary key",
    u: "unique",
  };

  console.log(`\nINDEXES  ${indexes[0]?.n}`);
  console.log("CONSTRAINTS");
  for (const c of constraints) {
    console.log(`  ${(label[c.contype] ?? c.contype).padEnd(14)} ${c.n}`);
  }

  // the deduplication guarantee is a schema property; confirm it is present
  const { rows: partial } = await pool.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
      WHERE tablename = 'intelligence_events' AND indexdef LIKE '%UNIQUE%'
      ORDER BY indexname`,
  );
  console.log("\nUNIQUENESS GUARANTEES ON intelligence_events");
  if (partial.length === 0) console.log("  NONE — deduplication is unenforced");
  for (const p of partial) console.log(`  ${p.indexname}`);

  console.log("");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
