# Security

## Credentials are never committed

Do **not** put passwords, password hashes, API keys, or service-role tokens in
any tracked file. The admin account is seeded from a local, gitignored file
(`seed-admin.sql`) — see [`seed-admin.example.sql`](./seed-admin.example.sql)
and `scripts/hash-password.mjs`.

`.vercelignore` keeps `*.sql`, `migrations/`, `supabase/`, and `scripts/` out of
the public Vercel deploy so database artifacts can't be fetched over HTTP.

---

## Incident: hardcoded default admin password (`pwt123`)

The initial admin (`nouh` / `pwt123`) was seeded directly in `migrate.sql`,
including its bcrypt hash. Because `migrate.sql` was committed **and** served
statically from the repo root, the hash was retrievable both from git history
and over HTTP. bcrypt(`pwt123`) is in public crack dictionaries and falls in
seconds. **Treat that credential as fully compromised.**

The credential has been removed from the working tree. Two actions below cannot
be done from the repo and must be completed by a maintainer.

### 1. Rotate the live password (do this FIRST — highest priority)

Removing it from the repo does **not** change the database. Until you rotate,
anyone can log in as admin.

Preferred — via the running app (admin panel → engineers → set a new password),
which re-hashes through `bcrypt.hash(password, 10)`.

Or directly in the Supabase SQL editor:

```sh
# 1. Generate a hash for a STRONG, brand-new password (not pwt123):
printf '%s' 'your-strong-new-password' | node scripts/hash-password.mjs
```

```sql
-- 2. Apply it (Supabase SQL editor):
UPDATE engineers
SET password = '<hash-from-step-1>', updated_at = now()
WHERE username = 'nouh';

-- 3. Invalidate every existing session so old logins are forced out:
DELETE FROM sessions;
```

Also rotate anything that shared the password or sat next to it (e.g. the
Supabase service-role key if it was ever pasted alongside).

### 2. Scrub the hash from git history

The hash lives in commit `e72791f` (file `migrate.sql`). Rewriting history is
**destructive and force-pushes a shared branch** — coordinate with everyone who
has a clone, then run one of:

```sh
# git-filter-repo (recommended)
pip install git-filter-repo
git filter-repo --path migrate.sql --invert-paths   # drop the file from all history
# ...or replace just the secret string across all blobs:
printf '%s==>REDACTED\n' '$2b$10$pRJME2jNCnjHX0QiZq55MODSpxk2Rh.6zqxMGDOBt0Q7I6YfZJg7y' > /tmp/replace.txt
printf '%s==>REDACTED\n' 'pwt123' >> /tmp/replace.txt
git filter-repo --replace-text /tmp/replace.txt
```

```sh
# BFG alternative
echo 'pwt123' >> /tmp/secrets.txt
echo '$2b$10$pRJME2jNCnjHX0QiZq55MODSpxk2Rh.6zqxMGDOBt0Q7I6YfZJg7y' >> /tmp/secrets.txt
bfg --replace-text /tmp/secrets.txt
```

Then:

```sh
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push --force --all && git push --force --tags
```

After force-pushing, every collaborator must re-clone (or hard-reset) — old
clones still contain the secret. History scrubbing is **secondary** to step 1:
the value is public regardless, so rotation is what actually protects the
account.

### 3. Verify

```sh
git log -S 'pwt123' --all --oneline          # expect no results
git log -S 'pRJME2jNCnjHX0QiZq55MODSpxk2Rh' --all --oneline   # expect no results
curl -sS https://<your-deployment>/migrate.sql -o /dev/null -w '%{http_code}\n'  # expect 404
```
