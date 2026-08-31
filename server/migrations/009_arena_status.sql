-- Phase 8: reconcile the arena entry status constraint with the engine.
--
-- Phase 6 added `winner` to ArenaEntryStatus so a settled round could mark
-- the asset that won it. The CHECK constraint from migration 001 still
-- allowed only (active, at_risk, eliminated), so settlement failed on insert
-- and took the whole pipeline pass with it.
--
-- This is the third constraint to drift the same way — signal severity and
-- this one, plus the market_metrics NOT NULL in Phase 7. All three had the
-- same cause: the TypeScript vocabulary changed while the schema written in
-- migration 001 did not, and nothing failed until a real database was
-- connected. `npm run verify:schema` now checks for this class of drift.
ALTER TABLE arena_entries DROP CONSTRAINT IF EXISTS arena_entries_status_check;

ALTER TABLE arena_entries ADD CONSTRAINT arena_entries_status_check
  CHECK (status = ANY (ARRAY['active', 'at_risk', 'eliminated', 'winner']));
