-- Phase 6: real-time events and a permanent Arena history.

/* ------------------------------------------------------------- events -- */

-- compute_events is the durable record behind the activity feed. The indexes
-- match how it is actually read: newest-first overall, newest-first for one
-- asset, and newest-first for one event type.
ALTER TABLE compute_events ADD COLUMN IF NOT EXISTS previous_value JSONB;
ALTER TABLE compute_events ADD COLUMN IF NOT EXISTS new_value JSONB;
ALTER TABLE compute_events ADD COLUMN IF NOT EXISTS change NUMERIC(14,4);
ALTER TABLE compute_events ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS compute_events_created_idx
  ON compute_events (created_at DESC);
CREATE INDEX IF NOT EXISTS compute_events_type_created_idx
  ON compute_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS compute_events_asset_created_idx
  ON compute_events (asset_id, created_at DESC);

/* -------------------------------------------------------------- arena -- */

-- Rounds gain a season, a settlement record and a winner. Settlement is
-- written once and never rewritten: a history whose past results can change
-- is not a history.
ALTER TABLE arena_rounds ADD COLUMN IF NOT EXISTS season INTEGER NOT NULL DEFAULT 1;
ALTER TABLE arena_rounds ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
ALTER TABLE arena_rounds ADD COLUMN IF NOT EXISTS winner_asset_id UUID REFERENCES assets(id);
ALTER TABLE arena_rounds ADD COLUMN IF NOT EXISTS winner_symbol TEXT;
ALTER TABLE arena_rounds ADD COLUMN IF NOT EXISTS winner_score NUMERIC(6,2);
ALTER TABLE arena_rounds ADD COLUMN IF NOT EXISTS winner_hp NUMERIC(6,2);
ALTER TABLE arena_rounds ADD COLUMN IF NOT EXISTS arena_version TEXT NOT NULL DEFAULT 'arena-v1';

CREATE INDEX IF NOT EXISTS arena_rounds_season_idx
  ON arena_rounds (season DESC, round_number DESC);
CREATE INDEX IF NOT EXISTS arena_rounds_settled_idx
  ON arena_rounds (settled_at DESC) WHERE settled_at IS NOT NULL;

-- Entries keep both the starting and current values, so a round can show
-- progression rather than only a final state.
ALTER TABLE arena_entries RENAME COLUMN score TO current_score;
ALTER TABLE arena_entries RENAME COLUMN hp TO current_hp;
ALTER TABLE arena_entries ALTER COLUMN current_hp TYPE NUMERIC(6,2);
ALTER TABLE arena_entries ADD COLUMN IF NOT EXISTS starting_score NUMERIC(6,2);
ALTER TABLE arena_entries ADD COLUMN IF NOT EXISTS starting_hp NUMERIC(6,2);
ALTER TABLE arena_entries ADD COLUMN IF NOT EXISTS power NUMERIC(6,2);
ALTER TABLE arena_entries ADD COLUMN IF NOT EXISTS starting_rank INTEGER;
ALTER TABLE arena_entries ADD COLUMN IF NOT EXISTS eliminated_at TIMESTAMPTZ;
ALTER TABLE arena_entries ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ;

-- Backfill so existing rows satisfy the new shape rather than reading as
-- zeros, which would misstate every historical round.
UPDATE arena_entries
   SET starting_score = COALESCE(starting_score, current_score),
       starting_hp    = COALESCE(starting_hp, current_hp),
       starting_rank  = COALESCE(starting_rank, rank),
       joined_at      = COALESCE(joined_at, updated_at);

-- A permanent per-round event log. This is what /app/arena/history reads
-- back; it is never truncated with the live event buffer.
CREATE TABLE IF NOT EXISTS arena_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  round_id UUID NOT NULL REFERENCES arena_rounds(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  previous_value NUMERIC(12,4),
  new_value NUMERIC(12,4),
  change NUMERIC(12,4),
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS arena_events_round_idx
  ON arena_events (round_id, created_at DESC);
CREATE INDEX IF NOT EXISTS arena_events_type_idx
  ON arena_events (event_type, created_at DESC);
