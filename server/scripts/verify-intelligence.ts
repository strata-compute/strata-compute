import { getPool, closePool } from "../src/database/pool.ts";

/**
 * A read-only audit of the intelligence table against its own invariants.
 *
 * The one that matters is uniqueness: at most one OPEN event per (asset,
 * type). A partial unique index enforces it, so a violation here would mean
 * the index is missing rather than that the code slipped — which is exactly
 * why the check reads the data rather than trusting the schema.
 */
async function main() {
  const pool = getPool();

  const { rows: counts } = await pool.query(
    `SELECT status, count(*)::int AS n FROM intelligence_events GROUP BY status ORDER BY n DESC`,
  );
  console.log("\nEVENTS BY STATUS");
  for (const row of counts) console.log(`  ${String(row.status).padEnd(10)} ${row.n}`);

  const { rows: dupes } = await pool.query(
    `SELECT asset_id, event_type, count(*)::int AS n
       FROM intelligence_events
      WHERE status IN ('detected','active')
      GROUP BY asset_id, event_type
     HAVING count(*) > 1`,
  );
  console.log("\nDUPLICATE OPEN EVENTS");
  console.log(dupes.length === 0 ? "  none" : `  ${dupes.length} VIOLATIONS`);
  for (const row of dupes) console.log(`  ${row.asset_id} ${row.event_type} ×${row.n}`);

  const { rows: repeat } = await pool.query(
    `SELECT a.symbol, e.event_type, e.observations, e.status,
            round(extract(epoch from (e.latest_at - e.detected_at)) / 60)::int AS held_minutes
       FROM intelligence_events e
       LEFT JOIN assets a ON a.id = e.asset_id
      WHERE e.observations > 1
      ORDER BY e.observations DESC LIMIT 10`,
  );
  console.log("\nCONDITIONS CARRIED ACROSS PASSES (one event, many observations)");
  if (repeat.length === 0) console.log("  none yet");
  for (const row of repeat) {
    console.log(
      `  ${String(row.symbol ?? "market").padEnd(8)} ${String(row.event_type).padEnd(24)} seen ${row.observations}× over ${row.held_minutes}m  [${row.status}]`,
    );
  }

  const { rows: types } = await pool.query(
    `SELECT event_type, count(*)::int AS n FROM intelligence_events GROUP BY event_type ORDER BY n DESC`,
  );
  console.log("\nBY TYPE");
  for (const row of types) console.log(`  ${String(row.event_type).padEnd(26)} ${row.n}`);

  const { rows: idx } = await pool.query(
    `SELECT indexname FROM pg_indexes
      WHERE tablename = 'intelligence_events' ORDER BY indexname`,
  );
  console.log("\nINDEXES");
  for (const row of idx) console.log(`  ${row.indexname}`);
  console.log("");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
