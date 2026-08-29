-- Rename the data layer from "site" to "lead", and close the anon hole on the
-- activities table.
--
-- Background: the app began as "SiteTrack" and the `sites` table predates every
-- other table. The product was later reframed as a sales pipeline and the UI
-- renamed to "Leads", but the schema was never updated. This aligns them.
--
-- `site_activities` becomes `activities` rather than `lead_activities`, because
-- it stores follow-ups for BOTH leads and clients — a lead-specific name would
-- be just as wrong as the current one.
--
-- ⚠ THIS IS THE MAINTENANCE WINDOW. The deployed edge functions break the moment
--   this commits, and stay broken until the new ones are deployed. Have a backup
--   or PITR confirmed before running.


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1 — DIAGNOSE FIRST. Run these two SELECTs and read the output before
-- running anything below. Do NOT skip: the fix in step 3 depends on the answer.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Every table already carries an `allow_all` policy (migrate.sql:79-82, :112),
-- so simply enabling RLS does NOT close the hole on its own. `sites` is not even
-- in the ENABLE ROW LEVEL SECURITY list yet is still protected from the anon
-- key, which points at table GRANTS rather than policies.
--
-- Find what `sites`/`clients` have that `site_activities` lacks, then mirror it.
--
--   SELECT relname, relrowsecurity AS rls_enabled
--     FROM pg_class
--    WHERE relname IN ('sites','clients','engineers','site_activities')
--    ORDER BY relname;
--
--   SELECT table_name, grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
--     FROM information_schema.role_table_grants
--    WHERE grantee IN ('anon','authenticated')
--      AND table_name IN ('sites','clients','site_activities')
--    GROUP BY table_name, grantee
--    ORDER BY table_name, grantee;
--
-- Expected finding: `anon` holds privileges on site_activities that it does not
-- hold on sites/clients. If so, uncomment the REVOKE in step 3.


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2 — THE RENAME
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Foreign keys reference table OIDs, so clients.converted_from and the
-- activities -> leads link follow the rename automatically. Postgres also
-- rewrites the CHECK constraint expression when the column is renamed, so the
-- constraint only needs renaming, not recreating.

BEGIN;

ALTER TABLE sites            RENAME TO leads;
ALTER TABLE site_activities  RENAME TO activities;
ALTER TABLE activities       RENAME COLUMN site_id TO lead_id;
ALTER TABLE notification_log RENAME COLUMN site_id TO lead_id;

ALTER TABLE activities RENAME CONSTRAINT site_activities_one_parent TO activities_one_parent;

ALTER INDEX IF EXISTS idx_sites_engineer_id      RENAME TO idx_leads_engineer_id;
ALTER INDEX IF EXISTS idx_site_activities_site   RENAME TO idx_activities_lead;
ALTER INDEX IF EXISTS idx_site_activities_client RENAME TO idx_activities_client;
ALTER INDEX IF EXISTS idx_notif_log_site_sent    RENAME TO idx_notif_log_lead_sent;


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3 — CLOSE THE ANON HOLE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Verified before this change: the anon key could read customer follow-up notes
-- out of site_activities, and a write was rejected only by a NOT NULL column
-- rather than by any policy.

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

-- Uncomment if step 1 showed anon holding grants here that it lacks on sites:
-- REVOKE ALL ON activities FROM anon;

COMMIT;

-- Make PostgREST pick up the new names immediately.
NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 4 — CONFIRM
-- ═══════════════════════════════════════════════════════════════════════════
--
--   SELECT CASE WHEN lead_id IS NOT NULL THEN 'LEAD' ELSE 'CLIENT' END AS belongs_to,
--          count(*)
--     FROM activities GROUP BY 1;
--
-- Every row must have exactly one parent set. The activities_one_parent
-- constraint enforces this, so a violation here means something went wrong.


-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — safe until the old `sites` edge function is deleted
-- ═══════════════════════════════════════════════════════════════════════════
--
--   BEGIN;
--   ALTER TABLE leads      RENAME TO sites;
--   ALTER TABLE activities RENAME TO site_activities;
--   ALTER TABLE site_activities  RENAME COLUMN lead_id TO site_id;
--   ALTER TABLE notification_log RENAME COLUMN lead_id TO site_id;
--   ALTER TABLE site_activities RENAME CONSTRAINT activities_one_parent TO site_activities_one_parent;
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';
--
-- Then: git revert the commit, push, and
--   supabase functions deploy sites activities convert notify
