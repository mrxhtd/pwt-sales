-- Per-engineer geolocation tracking consent.
-- Default: FALSE. Tracking does NOT start unless the engineer accepts.

ALTER TABLE engineers
  ADD COLUMN IF NOT EXISTS location_consent_given BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS location_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS location_consent_revoked_at TIMESTAMPTZ;

-- Audit changes to consent state.
CREATE TABLE IF NOT EXISTS location_consent_log (
  id BIGSERIAL PRIMARY KEY,
  engineer_id TEXT NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('granted', 'revoked')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_location_consent_log_engineer ON location_consent_log (engineer_id, recorded_at DESC);

ALTER TABLE location_consent_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_consent_log FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON location_consent_log FROM anon, authenticated;
