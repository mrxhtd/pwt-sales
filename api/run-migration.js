import { getSession } from '../lib/auth.js';

export const config = { maxDuration: 30 };

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

export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session || session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Missing Supabase env vars' });
  }

  // Extract project ref from URL: https://{ref}.supabase.co
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');

  try {
    // Try Supabase Management API
    const mgmtRes = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: SQL }),
    });

    if (mgmtRes.ok) {
      return res.status(200).json({ ok: true, message: 'Migration applied successfully' });
    }

    const mgmtErr = await mgmtRes.text();
    return res.status(500).json({
      error: 'Auto-migration failed. Please run this SQL manually in Supabase SQL Editor.',
      sql: SQL.trim(),
      detail: mgmtErr,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Auto-migration failed. Please run this SQL manually in Supabase SQL Editor.',
      sql: SQL.trim(),
      detail: err.message,
    });
  }
}
