-- Audit log for sensitive operations: login, role changes, deletes, conversions.
-- Edge functions append rows via SERVICE_ROLE; nobody else can read.

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id TEXT,                         -- engineer id (nullable for failed logins)
  actor_name TEXT,                       -- denormalized full name at time of action
  actor_ip TEXT,                         -- best-effort client IP
  action TEXT NOT NULL,                  -- e.g. 'login', 'login_failed', 'engineer_role_changed', 'site_deleted'
  entity_type TEXT,                      -- e.g. 'site', 'client', 'engineer'
  entity_id TEXT,
  before JSONB,
  after JSONB,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at ON audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor       ON audit_log (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity      ON audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action      ON audit_log (action, occurred_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON audit_log FROM anon, authenticated;
