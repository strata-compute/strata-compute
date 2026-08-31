-- Provider-supplied asset artwork.
--
-- Nullable by design: when no provider publishes an image for an asset the
-- column stays NULL and the interface renders a symbol mark that is visibly
-- not an official logo. Nothing ever writes a synthesised URL here.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS logo_url TEXT;
