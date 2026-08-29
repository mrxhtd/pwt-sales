CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  engineer_id TEXT NOT NULL REFERENCES engineers(id),
  type TEXT NOT NULL CHECK (type IN ('call', 'visit')),
  what_happened TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  next_action_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activities_site ON activities(lead_id, created_at DESC);
