import { getSupabase } from '../lib/db.js';

const SQL = `
CREATE TABLE IF NOT EXISTS site_activities (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  engineer_id TEXT NOT NULL REFERENCES engineers(id),
  type TEXT NOT NULL CHECK (type IN ('call', 'visit')),
  what_happened TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  next_action_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_activities_site ON site_activities(site_id, created_at DESC);
`;

const supabase = getSupabase();
const { error } = await supabase.rpc('exec_sql', { sql: SQL }).catch(() => ({ error: 'rpc not available' }));
if (error) {
  console.log('Could not run via RPC. Please run the following SQL manually in the Supabase SQL Editor:');
  console.log(SQL);
} else {
  console.log('Migration applied successfully.');
}
