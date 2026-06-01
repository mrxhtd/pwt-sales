-- Admin seed template — DO NOT put a real password hash in this example file.
--
-- Usage:
--   1. Generate a bcrypt hash for a STRONG, freshly chosen password:
--          node scripts/hash-password.mjs
--   2. Copy this file to seed-admin.sql (already gitignored):
--          cp seed-admin.example.sql seed-admin.sql
--   3. Replace REPLACE_WITH_BCRYPT_HASH below with the hash from step 1.
--   4. Run seed-admin.sql in the Supabase SQL editor.
--   5. Delete seed-admin.sql afterwards — keep it out of git and off any host.
--
-- Never reuse the old "pwt123" password. That credential is permanently
-- compromised (its hash was published in git history). See SECURITY.md.

INSERT INTO engineers (id, username, password, full_name, role)
VALUES (
  'eng_admin_001',
  'CHANGE_ME_USERNAME',
  'REPLACE_WITH_BCRYPT_HASH',
  'CHANGE_ME_FULL_NAME',
  'admin'
)
ON CONFLICT (id) DO UPDATE
  SET password = EXCLUDED.password,
      username = EXCLUDED.username,
      full_name = EXCLUDED.full_name,
      role = 'admin';

-- Assign any unowned sites to the admin once seeded.
UPDATE sites SET engineer_id = 'eng_admin_001' WHERE engineer_id IS NULL;
