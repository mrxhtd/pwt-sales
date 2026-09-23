-- Indexes for the admin Team charts. The stats function reads follow-ups by
-- date (the period filter and the 12-week window) and open leads by due date.
-- Safe to re-run.

CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities (created_at);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at);
CREATE INDEX IF NOT EXISTS idx_leads_due_date ON leads (due_date) WHERE due_date IS NOT NULL;
