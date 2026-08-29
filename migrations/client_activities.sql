-- Extend the follow-up log (site_activities) to cover clients as well as leads.
-- Run in the Supabase SQL Editor. Safe to re-run.

-- 1. A follow-up now hangs off EITHER a lead (site_id) or a client (client_id).
ALTER TABLE site_activities
  ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE site_activities ALTER COLUMN site_id DROP NOT NULL;

-- 2. Exactly one parent must be set — never both, never neither.
ALTER TABLE site_activities DROP CONSTRAINT IF EXISTS site_activities_one_parent;
ALTER TABLE site_activities
  ADD CONSTRAINT site_activities_one_parent
  CHECK ((site_id IS NOT NULL) <> (client_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_site_activities_client
  ON site_activities(client_id, created_at DESC);
