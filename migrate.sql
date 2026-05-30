-- PWT Sales — base schema migration
-- Run this in the Supabase SQL Editor against a fresh project.
--
-- IMPORTANT: All RLS policies below DENY anon/auth access.
-- The Edge Functions use the SERVICE_ROLE key and bypass RLS — that is by design.
-- Do NOT add USING(true) policies; the edge functions are the only authorized API.
--
-- After running this file:
--   1. Run migrations/push_notifications.sql
--   2. Run migrations/engineer_location.sql
--   3. Run migrations/audit_log.sql
--   4. Run migrations/login_attempts.sql
--   5. Run migrations/soft_delete.sql
--   6. Run migrations/totp.sql
--   7. Run migrations/quotes.sql
--   8. Run migrations/geolocation_consent.sql
--   9. Bootstrap the first admin with scripts/create_admin.sql
--      (it prompts for a password; never commit a real bcrypt hash)

-- ─── 1. Engineers ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS engineers (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  role TEXT NOT NULL DEFAULT 'engineer' CHECK (role IN ('admin','engineer')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_engineers_username ON engineers (username);
CREATE INDEX IF NOT EXISTS idx_engineers_email ON engineers (lower(email)) WHERE email IS NOT NULL;

-- ─── 2. Sessions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  engineer_id TEXT NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_engineer_id ON sessions (engineer_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

-- ─── 3. Sites (leads) ───────────────────────────────────────
-- Sites table is assumed to pre-exist; add engineer_id + soft-delete + updated_at index.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS engineer_id TEXT REFERENCES engineers(id) ON DELETE SET NULL;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE sites ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_sites_engineer_id ON sites (engineer_id);
CREATE INDEX IF NOT EXISTS idx_sites_updated_at ON sites (updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sites_deleted_at ON sites (deleted_at) WHERE deleted_at IS NOT NULL;

-- ─── 4. Clients ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  engineer_id TEXT NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  contact TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  location TEXT DEFAULT '',
  equipment TEXT DEFAULT '',
  specs TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  converted_from TEXT REFERENCES sites(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clients_engineer_id ON clients (engineer_id);
CREATE INDEX IF NOT EXISTS idx_clients_updated_at ON clients (updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_clients_deleted_at ON clients (deleted_at) WHERE deleted_at IS NOT NULL;

-- ─── 5. Client products ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_products (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('boilers','cooling_towers','chillers','swimming_pools')),
  product_name TEXT NOT NULL DEFAULT '',
  model TEXT DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  install_date DATE,
  next_maintenance_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','running_out_of_stock')),
  notes TEXT DEFAULT '',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_products_client_id ON client_products (client_id);
CREATE INDEX IF NOT EXISTS idx_client_products_category ON client_products (category);
CREATE INDEX IF NOT EXISTS idx_client_products_next_maintenance ON client_products (next_maintenance_date);
CREATE INDEX IF NOT EXISTS idx_client_products_deleted_at ON client_products (deleted_at) WHERE deleted_at IS NOT NULL;

-- ─── 6. RLS — DENY-BY-DEFAULT ───────────────────────────────
-- Edge functions use SERVICE_ROLE which bypasses RLS.
-- Anyone hitting REST with anon/authenticated keys gets nothing.
ALTER TABLE engineers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites           ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients         ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_products ENABLE ROW LEVEL SECURITY;

ALTER TABLE engineers       FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions        FORCE ROW LEVEL SECURITY;
ALTER TABLE sites           FORCE ROW LEVEL SECURITY;
ALTER TABLE clients         FORCE ROW LEVEL SECURITY;
ALTER TABLE client_products FORCE ROW LEVEL SECURITY;

-- Drop any legacy permissive policies that may exist on the project.
DROP POLICY IF EXISTS "allow_all_engineers"       ON engineers;
DROP POLICY IF EXISTS "allow_all_sessions"        ON sessions;
DROP POLICY IF EXISTS "allow_all_clients"         ON clients;
DROP POLICY IF EXISTS "allow_all_client_products" ON client_products;
DROP POLICY IF EXISTS "allow_all_sites"           ON sites;

-- No policies are added intentionally. RLS without a policy = deny all.
-- Edge Functions bypass this via SERVICE_ROLE.

REVOKE ALL ON engineers       FROM anon, authenticated;
REVOKE ALL ON sessions        FROM anon, authenticated;
REVOKE ALL ON sites           FROM anon, authenticated;
REVOKE ALL ON clients         FROM anon, authenticated;
REVOKE ALL ON client_products FROM anon, authenticated;
