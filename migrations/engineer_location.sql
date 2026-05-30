-- Add location tracking columns to engineers table
ALTER TABLE engineers
  ADD COLUMN IF NOT EXISTS last_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_engineers_location ON engineers (last_location_at)
  WHERE last_lat IS NOT NULL;
