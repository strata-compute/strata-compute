-- Provenance: a stored score must name the providers that produced it, and a
-- stored snapshot must distinguish the provider's timestamp from ours.

ALTER TABLE strata_scores
  ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE market_snapshots
  ADD COLUMN IF NOT EXISTS retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS source_timestamp TEXT;

-- freshness queries read "newest observation per source"
CREATE INDEX IF NOT EXISTS market_snapshots_retrieved_idx
  ON market_snapshots (retrieved_at DESC);
