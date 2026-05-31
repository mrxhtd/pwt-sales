-- Staging column for a new TOTP secret that hasn't been verified yet.
-- Without this, the /totp action=start handler had to overwrite totp_secret
-- and clear totp_enabled before the user proved they could read the new code,
-- which let anyone holding a session token silently disable 2FA on the account.
--
-- New flow:
--   start  -> writes only to totp_secret_pending; leaves totp_secret + totp_enabled alone.
--   enable -> verifies code against totp_secret_pending, then promotes it:
--             totp_secret = totp_secret_pending; totp_secret_pending = NULL;
--             totp_enabled = TRUE.
--   disable -> also clears totp_secret_pending for hygiene.

ALTER TABLE engineers
  ADD COLUMN IF NOT EXISTS totp_secret_pending TEXT;
