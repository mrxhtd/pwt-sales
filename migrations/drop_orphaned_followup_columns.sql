-- Drops sites.last_followup_at and clients.last_followup_at.
--
-- Background: a "log visit" feature added these columns and shipped code that
-- stamped them. The code was later scrapped and is no longer present anywhere
-- in this repo (no reference in index.html, api/, or supabase/functions/), but
-- the columns were never removed from the live database.
--
-- ── RUN THIS FIRST ────────────────────────────────────────────────────────────
-- The columns may still hold values written while the feature was briefly live.
-- Check before dropping; if either count is non-zero, decide whether that data
-- is worth exporting first. DROP COLUMN is irreversible.
--
--   SELECT
--     (SELECT count(*) FROM sites   WHERE last_followup_at IS NOT NULL) AS sites_with_data,
--     (SELECT count(*) FROM clients WHERE last_followup_at IS NOT NULL) AS clients_with_data;
--
-- ── THEN THIS ────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_sites_last_followup;
DROP INDEX IF EXISTS idx_clients_last_followup;

ALTER TABLE sites   DROP COLUMN IF EXISTS last_followup_at;
ALTER TABLE clients DROP COLUMN IF EXISTS last_followup_at;
