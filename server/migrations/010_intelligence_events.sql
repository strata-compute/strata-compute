-- Phase 9: the intelligence event store.
--
-- An intelligence event is a CONDITION THAT PERSISTS, not a moment that
-- passed. It is deliberately a different table from `signals`, which records
-- instantaneous threshold crossings that expire on a timer.

CREATE TABLE IF NOT EXISTS intelligence_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULL for market-wide events such as rotation or a regime shift.
  asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
  asset_type TEXT,

  event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = ANY (ARRAY['detected','active','resolved','expired'])),
  severity TEXT NOT NULL CHECK (severity = ANY (ARRAY['low','medium','high','critical'])),

  -- significance, kept decomposed so a reader can see WHICH part made the
  -- event significant rather than only that it was
  significance NUMERIC(6,4) NOT NULL,
  sig_magnitude NUMERIC(6,4) NOT NULL,
  sig_persistence NUMERIC(6,4) NOT NULL,
  sig_deviation NUMERIC(6,4) NOT NULL,
  sig_data_confidence NUMERIC(6,4) NOT NULL,

  confidence NUMERIC(6,4) NOT NULL,
  driver_agreement NUMERIC(6,4) NOT NULL,
  magnitude NUMERIC(14,4) NOT NULL,
  observations INTEGER NOT NULL DEFAULT 1,

  drivers JSONB NOT NULL DEFAULT '[]',
  context JSONB NOT NULL DEFAULT '{}',

  first_value NUMERIC(14,4),
  latest_value NUMERIC(14,4),
  priority NUMERIC(6,4) NOT NULL DEFAULT 0,

  detected_at TIMESTAMPTZ NOT NULL,
  latest_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,

  computation_version TEXT NOT NULL,
  score_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DEDUPLICATION, enforced by the schema rather than by code.
--
-- At most one OPEN event per (asset, type). A detector fires on every pass
-- while its condition holds; without this, fifteen passes of a strengthening
-- asset would become fifteen identical feed entries and a reader would infer
-- fifteen separate things had happened. The partial index makes that
-- impossible rather than merely unlikely, and lets resolved history
-- accumulate freely underneath.
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_events_open_asset_idx
  ON intelligence_events (asset_id, event_type)
  WHERE status IN ('detected', 'active') AND asset_id IS NOT NULL;

-- The same guarantee for market-wide events, which have no asset_id and so
-- are not covered by the index above.
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_events_open_market_idx
  ON intelligence_events (event_type)
  WHERE status IN ('detected', 'active') AND asset_id IS NULL;

-- Read patterns: the feed (newest first), one asset's history, and filtering
-- by type or severity. Nothing speculative.
CREATE INDEX IF NOT EXISTS intelligence_events_feed_idx
  ON intelligence_events (status, priority DESC, latest_at DESC);
CREATE INDEX IF NOT EXISTS intelligence_events_asset_idx
  ON intelligence_events (asset_id, latest_at DESC);
CREATE INDEX IF NOT EXISTS intelligence_events_type_idx
  ON intelligence_events (event_type, latest_at DESC);
CREATE INDEX IF NOT EXISTS intelligence_events_severity_idx
  ON intelligence_events (severity, latest_at DESC);
CREATE INDEX IF NOT EXISTS intelligence_events_detected_idx
  ON intelligence_events (detected_at DESC);
