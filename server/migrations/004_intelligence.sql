-- Phase 5: the intelligence layer.
--
-- Scores become nullable and gain a status, because "this pass ran and the
-- data could not support a score" is a result worth keeping rather than a row
-- to omit. Omitting it would make a gap in coverage indistinguishable from a
-- gap in the pipeline.

ALTER TABLE strata_scores ALTER COLUMN score DROP NOT NULL;
ALTER TABLE strata_scores ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'OK';
ALTER TABLE strata_scores ADD COLUMN IF NOT EXISTS confidence NUMERIC(6,4) NOT NULL DEFAULT 0;

-- Component readings are nullable for the same reason: a null records that
-- the component could not be computed, which is not the same as a low value.
ALTER TABLE market_metrics ALTER COLUMN momentum DROP NOT NULL;
ALTER TABLE market_metrics ALTER COLUMN volume_strength DROP NOT NULL;
ALTER TABLE market_metrics ALTER COLUMN activity DROP NOT NULL;
ALTER TABLE market_metrics ALTER COLUMN liquidity_strength DROP NOT NULL;
ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS relative_strength NUMERIC(7,3);
ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS trend NUMERIC(7,3);
ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS volatility NUMERIC(7,3);

-- Signals expire: a volume spike is news for an hour, a trend reversal for a
-- day. Without this the feed accumulates stale observations that still look
-- current.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS signals_expires_at_idx ON signals (expires_at DESC);

-- The full per-pass intelligence record: score, reasoning and every engine
-- reading behind it, versioned so a v2 never overwrites the v1 it succeeded.
CREATE TABLE IF NOT EXISTS asset_intelligence (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  computation_version TEXT NOT NULL,
  status TEXT NOT NULL,
  score NUMERIC(6,2),
  confidence NUMERIC(6,4) NOT NULL,
  history_points INTEGER NOT NULL DEFAULT 0,
  age_seconds INTEGER,
  payload JSONB NOT NULL,
  sources TEXT[] NOT NULL DEFAULT '{}',
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS asset_intelligence_asset_time_idx
  ON asset_intelligence (asset_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS asset_intelligence_version_idx
  ON asset_intelligence (computation_version, timestamp DESC);
