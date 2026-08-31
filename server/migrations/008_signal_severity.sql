-- Phase 8: reconcile the signal severity constraint with the engine.
--
-- Migration 001 constrained severity to (info, low, medium, high). Phase 5
-- replaced that vocabulary with (low, medium, high, critical) — `info` was
-- dropped because a signal that is merely informational is not a signal, and
-- `critical` was added at the top.
--
-- The constraint was never updated, so every pass that detected a CRITICAL
-- signal failed on insert and took the entire pipeline pass with it: scores,
-- rankings, arena and events were all discarded because one row was too
-- severe for a check nobody had revisited. The failure was invisible except
-- as an occasional "pipeline pass failed" in the log.
ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_severity_check;

ALTER TABLE signals ADD CONSTRAINT signals_severity_check
  CHECK (severity = ANY (ARRAY['low', 'medium', 'high', 'critical']));

-- Any row written under the old vocabulary is mapped to the nearest current
-- level rather than deleted; it was a real detection.
UPDATE signals SET severity = 'low' WHERE severity = 'info';
