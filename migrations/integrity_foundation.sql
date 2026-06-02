-- P0 integrity foundation: soft deletes + audit log.
-- Idempotent — safe to re-run.

-- ─── 1. SOFT DELETE ───────────────────────────────────────────────
-- Replace hard DELETE with a deleted_at tombstone so records are recoverable
-- and history is preserved. Reads filter `deleted_at IS NULL`.
ALTER TABLE sites            ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE clients          ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE client_products  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial indexes matching the live (not-deleted) read pattern.
CREATE INDEX IF NOT EXISTS idx_sites_live
  ON sites (engineer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_clients_live
  ON clients (engineer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_client_products_live
  ON client_products (client_id) WHERE deleted_at IS NULL;

-- ─── 2. AUDIT LOG ─────────────────────────────────────────────────
-- Who changed what, when, and the before/after snapshot. Written by the API
-- layer (it knows the acting engineer; the DB connection does not, since it
-- uses the service-role key with no per-user JWT). This therefore captures all
-- mutations made THROUGH the app; out-of-band raw-SQL edits are not captured —
-- add a DB trigger later if that defense-in-depth is needed.
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  table_name  TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('insert','update','delete','restore')),
  actor_id    TEXT,
  actor_name  TEXT,
  before_data JSONB,
  after_data  JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (table_name, row_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_log (actor_id, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_audit_log" ON audit_log;
CREATE POLICY "allow_all_audit_log" ON audit_log FOR ALL USING (true) WITH CHECK (true);
