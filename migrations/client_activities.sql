-- Extend the follow-up log (activities) to cover clients as well as leads.
-- Run in the Supabase SQL Editor. Safe to re-run.

-- 1. A follow-up now hangs off EITHER a lead (lead_id) or a client (client_id).
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS client_id TEXT REFERENCES clients(id) ON DELETE CASCADE;

ALTER TABLE activities ALTER COLUMN lead_id DROP NOT NULL;

-- 2. Exactly one parent must be set — never both, never neither.
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_one_parent;
ALTER TABLE activities
  ADD CONSTRAINT activities_one_parent
  CHECK ((lead_id IS NOT NULL) <> (client_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_activities_client
  ON activities(client_id, created_at DESC);
