-- Phase 8: calibrated scoring.

/* ------------------------------------------------------ score versioning */

-- The scoring METHOD is versioned separately from the compute engine. The
-- engine produces components; the method turns them into a score. They change
-- independently, and a stored result has to say which of each produced it —
-- otherwise a score computed before calibration reads back as though it had
-- been calibrated, which is the one thing versioning exists to prevent.
ALTER TABLE strata_scores ADD COLUMN IF NOT EXISTS score_version TEXT;
ALTER TABLE strata_scores ADD COLUMN IF NOT EXISTS score_universe TEXT;

-- Rows written before this migration were produced by the uncalibrated
-- method. Labelling them explicitly is what keeps history honest; leaving
-- them NULL would let them be mistaken for current results.
UPDATE strata_scores
   SET score_version = 'strata-v0-uncalibrated'
 WHERE score_version IS NULL;

ALTER TABLE strata_scores ALTER COLUMN score_version SET DEFAULT 'strata-v1';

CREATE INDEX IF NOT EXISTS strata_scores_version_idx
  ON strata_scores (score_version, "timestamp" DESC);

/* --------------------------------------------------- calibration record */

-- How a universe was calibrated at a point in time.
--
-- Percentile ranks and the anchoring step both depend on the population they
-- were computed against, so a score is only reproducible if the shape of that
-- population is kept alongside it. Without this table a past score could be
-- recomputed but never checked.
CREATE TABLE IF NOT EXISTS score_calibrations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  score_version TEXT NOT NULL,
  universe TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  method TEXT NOT NULL,
  -- composite dispersion used by the anchoring step
  composite_mean NUMERIC(8,4),
  composite_sigma NUMERIC(8,4),
  anchored BOOLEAN NOT NULL DEFAULT false,
  -- full distribution statistics, per universe and per component
  distribution JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS score_calibrations_lookup_idx
  ON score_calibrations (score_version, universe, created_at DESC);
