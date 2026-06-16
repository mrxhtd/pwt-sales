-- Migration: Multi-engineer accounts + clients feature
-- Run this in the Supabase SQL Editor

-- 1. Engineers table
CREATE TABLE IF NOT EXISTS engineers (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'engineer' CHECK (role IN ('admin','engineer')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engineers_username ON engineers (username);

-- 2. Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  engineer_id TEXT NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_engineer_id ON sessions (engineer_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

-- 3. Add engineer_id to sites (nullable first for migration)
ALTER TABLE sites ADD COLUMN IF NOT EXISTS engineer_id TEXT REFERENCES engineers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sites_engineer_id ON sites (engineer_id);

-- 4. Clients table
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
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_engineer_id ON clients (engineer_id);

-- 5. Client products table
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
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_products_client_id ON client_products (client_id);
CREATE INDEX IF NOT EXISTS idx_client_products_category ON client_products (category);
CREATE INDEX IF NOT EXISTS idx_client_products_next_maintenance ON client_products (next_maintenance_date);

-- 6. Enable RLS on new tables
ALTER TABLE engineers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_products ENABLE ROW LEVEL SECURITY;

-- Allow all access (API layer enforces permissions)
CREATE POLICY "allow_all_engineers" ON engineers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_sessions" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_clients" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_client_products" ON client_products FOR ALL USING (true) WITH CHECK (true);

-- 7. Create the initial admin account
--    Do NOT hardcode credentials in this file — it is committed to git and may be
--    served statically by the host. Seed the admin separately so the password hash
--    never lands in version control:
--      1. node scripts/hash-password.mjs        (generates a bcrypt hash locally)
--      2. copy seed-admin.example.sql -> seed-admin.sql  (seed-admin.sql is gitignored)
--      3. paste the generated hash into seed-admin.sql, then run it in the Supabase
--         SQL editor.
--    See SECURITY.md for full details and credential-rotation steps.

-- 8. Assign all existing sites to the seeded admin
--    Run this AFTER seeding the admin account (see seed-admin.example.sql).
-- UPDATE sites SET engineer_id = 'eng_admin_001' WHERE engineer_id IS NULL;

-- 9. Site activities table (follow-up log)
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

CREATE POLICY "allow_all_site_activities" ON site_activities FOR ALL USING (true) WITH CHECK (true);
