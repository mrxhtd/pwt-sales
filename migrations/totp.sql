-- TOTP / 2FA for admins (optional for engineers).

ALTER TABLE engineers
  ADD COLUMN IF NOT EXISTS totp_secret TEXT,         -- base32 secret; NULL = 2FA disabled
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS totp_enrolled_at TIMESTAMPTZ;

-- Recovery codes — hashed, one-time use.
CREATE TABLE IF NOT EXISTS totp_recovery_codes (
  id BIGSERIAL PRIMARY KEY,
  engineer_id TEXT NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (engineer_id, code_hash)
);

CREATE INDEX IF NOT EXISTS idx_totp_recovery_engineer ON totp_recovery_codes (engineer_id);

ALTER TABLE totp_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE totp_recovery_codes FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON totp_recovery_codes FROM anon, authenticated;
