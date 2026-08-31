-- Phase 7: reconcile the schema with the code that was written against it.
--
-- Migrations 003-005 were authored but never executed against a real
-- database until now. Running them exposed two mismatches that no amount of
-- type-checking could have caught, because both live in SQL strings.

/* ------------------------------------------------- 1. market_metrics --- */

-- `market_strength` was renamed to `relative_strength` in the Phase 5 engine,
-- and 004 added the new column — but left the old one NOT NULL. Every metrics
-- insert therefore failed on a column the code no longer knows about.
--
-- The column is kept rather than dropped: rows written before Phase 5 hold
-- real readings in it, and dropping it would destroy history to tidy a name.
ALTER TABLE market_metrics ALTER COLUMN market_strength DROP NOT NULL;

COMMENT ON COLUMN market_metrics.market_strength IS
  'Superseded by relative_strength in scoring v1. Retained for rows written before that change; no longer written to.';

/* ---------------------------------------------- 2. snapshot dedupe ----- */

-- `backfillObservations` needs to merge on (asset_id, timestamp) so a
-- provider backfill can be re-run without double-counting an observation in
-- every baseline computed from the series.
--
-- The index is PARTIAL, covering only backfilled rows. A full unique index
-- would forbid two live sources from independently observing the same asset
-- at the same instant, which is legitimate and does happen — the ingestion
-- layer already de-duplicates those by content fingerprint.
CREATE UNIQUE INDEX IF NOT EXISTS market_snapshots_backfill_unique_idx
  ON market_snapshots (asset_id, "timestamp")
  WHERE source = 'backfill';

/* ------------------------------------------------------- 3. indexes --- */

-- Query patterns that exist in the code but had no supporting index.
-- Rankings are read newest-first for one metric; events newest-first overall.
CREATE INDEX IF NOT EXISTS rankings_metric_time_idx
  ON rankings (metric, asset_type, "timestamp" DESC);

CREATE INDEX IF NOT EXISTS rankings_asset_time_idx
  ON rankings (asset_id, "timestamp" DESC);

CREATE INDEX IF NOT EXISTS strata_scores_asset_time_idx
  ON strata_scores (asset_id, "timestamp" DESC);

CREATE INDEX IF NOT EXISTS signals_asset_time_idx
  ON signals (asset_id, "timestamp" DESC);
