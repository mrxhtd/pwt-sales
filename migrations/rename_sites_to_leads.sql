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
--   this commits, and stay broken until the new ones are deployed.
--
--   No backup exists (project is on the Free plan). That is acceptable here
--   because every statement below is METADATA-ONLY: RENAME rewrites a name in
--   the system catalog and DROP/CREATE POLICY touches no rows. Nothing is
--   copied, moved or deleted, and each statement has an exact inverse (see
--   ROLLBACK at the bottom).


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1 — DIAGNOSIS (already run; recorded here for the record)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Confirmed against production on 2026-08-29:
--
--   RLS enabled:  sites ✓  clients ✓  engineers ✓  site_activities ✓
--   anon grants:  identical on all three (full DELETE/INSERT/SELECT/UPDATE)
--
-- So neither RLS nor grants were the differentiator. The policies were:
--
--   sites            service_role_only   qual: auth.role() = 'service_role'
--   clients          service_role_only   qual: auth.role() = 'service_role'
--   engineers        service_role_only   qual: auth.role() = 'service_role'
--   site_activities  allow_all_...       qual: true          <-- WIDE OPEN
--
-- An anon-key probe confirmed site_activities is the ONLY exposed table;
-- sessions, client_products, notification_log, push_subscriptions and
-- login_attempts all deny correctly.
--
-- Root cause: site_activities was created after the hardening pass that moved
-- every other table to service_role_only, and kept the permissive policy from
-- migrate.sql. Fix is to match the others exactly (STEP 3).

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
-- Replace the wide-open policy with the same service_role_only policy every
-- other table already uses. RLS is already enabled (the ALTER below is a
-- harmless no-op kept as a guarantee); the grants already match the safe
-- tables, so nothing needs revoking.
--
-- The edge functions are unaffected: they connect with the service-role key,
-- which satisfies this policy.

ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_all_site_activities ON activities;
DROP POLICY IF EXISTS allow_all_activities      ON activities;

CREATE POLICY service_role_only ON activities
  FOR ALL
  USING      (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

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
--
-- Do NOT revert the STEP 3 policy change. It is independent of the rename and
-- closes a real hole; reverting it would reopen anonymous access.
--   NOTIFY pgrst, 'reload schema';
--
-- Then: git revert the commit, push, and
--   supabase functions deploy sites activities convert notify
