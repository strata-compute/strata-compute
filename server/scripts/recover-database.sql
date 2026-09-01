-- ---------------------------------------------------------------------------
-- STRATA COMPUTE — DATABASE RECOVERY
--
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor), not from the
-- application. The editor connects through Supabase's own path; the shared
-- pooler the app uses is saturated and cannot complete this work.
--
-- Why this is needed: retention was declared in configuration but never
-- implemented, so the pipeline wrote roughly fifty-eight rows across seven
-- tables every sixty seconds and nothing removed them. Two days filled 465 MB
-- of a 500 MB database, and the provider began throttling the project. Every
-- API failure downstream was that.
--
-- This keeps the last 24 hours. The engine reads far less: the widest
-- detection window is four hours and score history renders about two.
--
-- Nothing here touches assets, arena rounds, arena entries or intelligence
-- events — the universe, the settled record, and open conditions all stay.
-- ---------------------------------------------------------------------------

-- STEP 1 — delete history older than 24 hours.
-- Run this block. If a statement times out, run the block again: each DELETE
-- is independent and simply resumes where it stopped.

DELETE FROM asset_prices        WHERE timestamp  < now() - interval '24 hours';
DELETE FROM market_metrics      WHERE timestamp  < now() - interval '24 hours';
DELETE FROM strata_scores       WHERE timestamp  < now() - interval '24 hours';
DELETE FROM rankings            WHERE timestamp  < now() - interval '24 hours';
DELETE FROM signals             WHERE timestamp  < now() - interval '24 hours';
DELETE FROM compute_events      WHERE created_at < now() - interval '24 hours';
DELETE FROM market_snapshots    WHERE timestamp  < now() - interval '24 hours';
DELETE FROM asset_intelligence  WHERE timestamp  < now() - interval '24 hours';

-- If any statement times out, this smaller form makes progress a slice at a
-- time. Re-run it until it reports 0 rows, then move on.
--
--   DELETE FROM asset_intelligence WHERE ctid IN (
--     SELECT ctid FROM asset_intelligence
--      WHERE timestamp < now() - interval '24 hours'
--      LIMIT 20000
--   );

-- ---------------------------------------------------------------------------
-- STEP 2 — return the space to disk.
--
-- DELETE only marks rows dead; the file does not shrink until the table is
-- rewritten. VACUUM FULL does that, and needs free space of its own — so the
-- tables go smallest first, each one releasing room for the next, with the
-- 196 MB table rewritten last when there is the most space to do it in.
--
-- Run these ONE AT A TIME. Each takes an exclusive lock on its table.
-- ---------------------------------------------------------------------------

VACUUM (FULL, ANALYZE) asset_prices;
VACUUM (FULL, ANALYZE) market_metrics;
VACUUM (FULL, ANALYZE) strata_scores;
VACUUM (FULL, ANALYZE) rankings;
VACUUM (FULL, ANALYZE) signals;
VACUUM (FULL, ANALYZE) compute_events;
VACUUM (FULL, ANALYZE) market_snapshots;
VACUUM (FULL, ANALYZE) asset_intelligence;

-- ---------------------------------------------------------------------------
-- STEP 3 — confirm.
-- ---------------------------------------------------------------------------

SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;

SELECT relname                                        AS table_name,
       n_live_tup                                     AS rows,
       pg_size_pretty(pg_total_relation_size(relid))  AS size
  FROM pg_stat_user_tables
 ORDER BY pg_total_relation_size(relid) DESC
 LIMIT 10;

-- Expect roughly 240 MB. Once it is under the limit the application recovers
-- on its own — no redeploy needed — and the retention job now shipped in the
-- backend keeps it there.
