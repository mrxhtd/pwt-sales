-- Bootstrap the first admin account.
-- Run this ONCE after migrate.sql when setting up a new project.
--
-- Replace <USERNAME>, <FULL_NAME>, and <BCRYPT_HASH> with real values.
-- Generate the bcrypt hash locally (NEVER paste a real password into git):
--
--   node -e "console.log(require('bcryptjs').hashSync(require('readline-sync').question('Password: ', {hideEchoBack: true}), 10))"
--
-- or:
--
--   pip install bcrypt && python3 -c "import bcrypt, getpass; print(bcrypt.hashpw(getpass.getpass().encode(), bcrypt.gensalt(10)).decode())"
--
-- Then paste ONLY the resulting hash here, run the file, and immediately delete the
-- hash from your local copy. NEVER commit a real hash to git.

INSERT INTO engineers (id, username, password, full_name, role, is_active)
VALUES (
  'eng_admin_' || substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 8),
  '<USERNAME>',                          -- e.g. 'nouh'
  '<BCRYPT_HASH>',                       -- e.g. '$2b$10$...'
  '<FULL_NAME>',                         -- e.g. 'Nouh Mosa'
  'admin',
  TRUE
);
