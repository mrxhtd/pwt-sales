-- sites table — RECONSTRUCTED from application code (rowToSite + the insert/update
-- field lists in supabase/functions/sites/index.ts and the VALID_STATUSES enum).
--
-- ⚠️  The live `sites` table was created outside version control (it is only
--     ALTER-ed in migrate.sql). This file makes the schema reproducible for fresh
--     environments. Because it is CREATE TABLE IF NOT EXISTS, it is a NO-OP against
--     an existing production database. Verify it matches prod with `\d sites` and
--     reconcile any differences before relying on it.
--
--     `due_date` is modeled as TEXT to match the app writing `s.dueDate || ''`
--     (an empty string is not a valid DATE). Migrate it to DATE separately if desired.

CREATE TABLE IF NOT EXISTS sites (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  contact      TEXT DEFAULT '',
  phone        TEXT DEFAULT '',
  equipment    TEXT DEFAULT '',
  specs        TEXT DEFAULT '',
  location     TEXT DEFAULT '',
  status       TEXT NOT NULL DEFAULT '' CHECK (status IN (
                 '', 'Potential Prospect', 'Qualified Prospect', 'Interested Prospect',
                 'Hot Prospect', 'Hot Lead', 'Follow Up', 'Active', 'Pending',
                 'Closed Won', 'Lost')),
  next_action  TEXT DEFAULT '',
  due_date     TEXT DEFAULT '',
  notes        TEXT DEFAULT '',
  engineer_id  TEXT REFERENCES engineers(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sites_engineer_id ON sites (engineer_id);

-- RLS was previously NOT enabled on sites (it was missing from migrate.sql). Enable it
-- for consistency with the other tables. NOTE: like the rest of the schema this is an
-- allow-all policy; real authorization is enforced in the API layer (the request paths
-- connect with the service-role key, which bypasses RLS regardless).
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_sites" ON sites;
CREATE POLICY "allow_all_sites" ON sites FOR ALL USING (true) WITH CHECK (true);
