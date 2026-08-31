-- Constrain the intelligence event vocabulary at the schema level.
--
-- Every other enumerated column in this database carries a CHECK, and the
-- three times one drifted from the TypeScript it mirrors, the failure landed
-- as a rejected INSERT that took a whole pipeline pass with it. The lesson was
-- not "avoid constraints" — an unconstrained event_type would let a typo
-- persist silently and read as a real finding forever. The lesson was to
-- verify the constraint against the code, which `npm run verify:schema` now
-- does for this column too.

ALTER TABLE intelligence_events
  DROP CONSTRAINT IF EXISTS intelligence_events_event_type_check;

ALTER TABLE intelligence_events
  ADD CONSTRAINT intelligence_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'STRENGTH_ACCELERATION',
    'STRENGTH_DETERIORATION',
    'MOMENTUM_SHIFT',
    'TREND_SHIFT',
    'VOLUME_EXPANSION',
    'VOLUME_CONTRACTION',
    'RANK_ACCELERATION',
    'RANK_DETERIORATION',
    'ANOMALY',
    'REGIME_SHIFT',
    'CROSS_MARKET_ROTATION'
  ]));
