-- Documents columns that were added directly to the live database and were
-- never captured in a migration. They are read/written ONLY by the `location`
-- edge function (supabase/functions/location/index.ts), which itself existed
-- only in production until it was recovered into this repo.
--
-- These columns already exist in production; this file exists so the schema can
-- be rebuilt from scratch. Safe to re-run.

ALTER TABLE engineers ADD COLUMN IF NOT EXISTS last_lat          DOUBLE PRECISION;
ALTER TABLE engineers ADD COLUMN IF NOT EXISTS last_lng          DOUBLE PRECISION;
ALTER TABLE engineers ADD COLUMN IF NOT EXISTS last_location_at  TIMESTAMPTZ;

-- The admin map queries active engineers that have a fix.
CREATE INDEX IF NOT EXISTS idx_engineers_last_location
  ON engineers (last_location_at)
  WHERE last_lat IS NOT NULL;
