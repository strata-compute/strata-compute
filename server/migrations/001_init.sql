-- Strata Compute — initial schema
-- Timestamps are timestamptz throughout; the service works in UTC only.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------- assets --

CREATE TABLE IF NOT EXISTS assets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol           TEXT        NOT NULL,
  name             TEXT        NOT NULL,
  asset_type       TEXT        NOT NULL CHECK (asset_type IN ('stock', 'crypto', 'onchain')),
  chain            TEXT,
  contract_address TEXT,
  status           TEXT        NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'stale', 'delisted')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- one row per symbol per asset class: BTC the token and BTC the equity
-- wrapper are different assets
CREATE UNIQUE INDEX IF NOT EXISTS assets_symbol_type_key
  ON assets (symbol, asset_type);
CREATE INDEX IF NOT EXISTS assets_asset_type_status_idx
  ON assets (asset_type, status);
CREATE INDEX IF NOT EXISTS assets_contract_idx
  ON assets (chain, contract_address)
  WHERE contract_address IS NOT NULL;

-- ---------------------------------------------------------- asset_prices --

CREATE TABLE IF NOT EXISTS asset_prices (
  id                BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id          UUID        NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  price             NUMERIC(24, 8) NOT NULL,
  price_change_1h   NUMERIC(12, 4),
  price_change_24h  NUMERIC(12, 4),
  volume_24h        NUMERIC(28, 4),
  market_cap        NUMERIC(28, 4),
  timestamp         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- the hot query is "latest rows for this asset"
CREATE INDEX IF NOT EXISTS asset_prices_asset_time_idx
  ON asset_prices (asset_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS asset_prices_time_idx
  ON asset_prices (timestamp DESC);

-- ------------------------------------------------------ market_snapshots --
-- The normalized record exactly as it entered the pipeline, kept for replay
-- and for auditing what a score was computed from.

CREATE TABLE IF NOT EXISTS market_snapshots (
  id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id    UUID        NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  source      TEXT        NOT NULL,
  is_mock     BOOLEAN     NOT NULL DEFAULT false,
  payload     JSONB       NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_snapshots_asset_time_idx
  ON market_snapshots (asset_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS market_snapshots_source_idx
  ON market_snapshots (source, timestamp DESC);

-- --------------------------------------------------------- market_metrics --

CREATE TABLE IF NOT EXISTS market_metrics (
  id                  BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id            UUID        NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  momentum            NUMERIC(6, 2) NOT NULL,
  volume_strength     NUMERIC(6, 2) NOT NULL,
  activity            NUMERIC(6, 2) NOT NULL,
  liquidity_strength  NUMERIC(6, 2) NOT NULL,
  market_strength     NUMERIC(6, 2) NOT NULL,
  timestamp           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_metrics_asset_time_idx
  ON market_metrics (asset_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS market_metrics_time_idx
  ON market_metrics (timestamp DESC);

-- ---------------------------------------------------------- strata_scores --

CREATE TABLE IF NOT EXISTS strata_scores (
  id         BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id   UUID        NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  score      NUMERIC(6, 2) NOT NULL CHECK (score >= 0 AND score <= 100),
  version    TEXT        NOT NULL,
  timestamp  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strata_scores_asset_time_idx
  ON strata_scores (asset_id, timestamp DESC);
-- scores are always read per scoring version
CREATE INDEX IF NOT EXISTS strata_scores_version_time_idx
  ON strata_scores (version, timestamp DESC);

-- ---------------------------------------------------------------- signals --

CREATE TABLE IF NOT EXISTS signals (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id     UUID        NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  signal_type  TEXT        NOT NULL,
  severity     TEXT        NOT NULL DEFAULT 'info'
                 CHECK (severity IN ('info', 'low', 'medium', 'high')),
  value        NUMERIC(16, 4) NOT NULL,
  metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS signals_time_idx        ON signals (timestamp DESC);
CREATE INDEX IF NOT EXISTS signals_asset_time_idx  ON signals (asset_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS signals_type_time_idx   ON signals (signal_type, timestamp DESC);

-- --------------------------------------------------------------- rankings --
-- A persisted ranking snapshot, so rank movement survives a restart.

CREATE TABLE IF NOT EXISTS rankings (
  id          BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metric      TEXT        NOT NULL,
  asset_type  TEXT        NOT NULL DEFAULT 'all',
  asset_id    UUID        NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  rank        INTEGER     NOT NULL,
  value       NUMERIC(12, 4) NOT NULL,
  score       NUMERIC(6, 2)  NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rankings_lookup_idx
  ON rankings (metric, asset_type, timestamp DESC, rank);
CREATE INDEX IF NOT EXISTS rankings_asset_idx
  ON rankings (asset_id, timestamp DESC);

-- ----------------------------------------------------------- arena_rounds --

CREATE TABLE IF NOT EXISTS arena_rounds (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_number  INTEGER     NOT NULL UNIQUE,
  status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'active', 'settled')),
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS arena_rounds_status_idx ON arena_rounds (status, starts_at DESC);

-- ---------------------------------------------------------- arena_entries --

CREATE TABLE IF NOT EXISTS arena_entries (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id    UUID        NOT NULL REFERENCES arena_rounds (id) ON DELETE CASCADE,
  asset_id    UUID        NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  score       NUMERIC(6, 2) NOT NULL,
  rank        INTEGER     NOT NULL,
  hp          INTEGER     NOT NULL DEFAULT 100 CHECK (hp >= 0),
  status      TEXT        NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'at_risk', 'eliminated')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS arena_entries_round_asset_key
  ON arena_entries (round_id, asset_id);
CREATE INDEX IF NOT EXISTS arena_entries_round_rank_idx
  ON arena_entries (round_id, rank);

-- --------------------------------------------------------- compute_events --
-- Audit trail: what went in, what came out, under which scoring version.

CREATE TABLE IF NOT EXISTS compute_events (
  id                   BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asset_id             UUID        REFERENCES assets (id) ON DELETE SET NULL,
  event_type           TEXT        NOT NULL,
  input_data           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  output_data          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  computation_version  TEXT        NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS compute_events_created_idx
  ON compute_events (created_at DESC);
CREATE INDEX IF NOT EXISTS compute_events_asset_created_idx
  ON compute_events (asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS compute_events_type_created_idx
  ON compute_events (event_type, created_at DESC);
