# PWT Sales

Single-tenant sales CRM built for **PWT International** (water-treatment chemicals, Egypt). Tracks leads, converts wins to long-term clients, manages a small team of field engineers, and generates a multi-page technical/economical proposal as a printable HTML document.

- **Production**: https://pwt-sales.vercel.app
- **Stack**: Vanilla JS (no framework) + Supabase Edge Functions (Deno/TS) + Postgres + Leaflet/OSM + Vercel hosting.
- **Auth**: Custom bcrypt + 256-bit session tokens (not Supabase Auth). Optional TOTP 2FA.
- **Notifications**: Web Push (VAPID) for new leads, conversions, and due-date reminders.
- **AI lead intake**: Gemini 2.5 Flash extracts structured site data from free text, photos of nameplates/business cards, or spoken Arabic/English.

---

## Repository layout

```
.
├── index.html                  # App shell (≈580 lines after JS/CSS extraction)
├── app.js                      # All client behaviour. Loaded with `defer`. Uses event delegation only — no inline handlers.
├── app.css                     # All styles. Theme variables in :root + [data-theme="light"].
├── sw.js                       # Service worker — push notifications + app-shell offline cache.
├── manifest.json               # PWA manifest.
├── vercel.json                 # Headers (CSP, HSTS preload, X-Frame-Options=DENY, etc.).
├── migrate.sql                 # Base schema. Run FIRST in a new Supabase project.
├── migrations/
│   ├── push_notifications.sql  # Push subscriptions + cron-based due-date notifier.
│   ├── engineer_location.sql   # last_lat/lng columns for the team map.
│   ├── audit_log.sql           # Forensic trail (HIGH-6).
│   ├── login_attempts.sql      # Persistent rate limit + register_login_attempt() RPC (HIGH-5).
│   ├── soft_delete.sql         # deleted_at columns + auto-purge cron (HIGH-7).
│   ├── totp.sql                # TOTP secret + recovery codes (HIGH-8).
│   ├── totp_pending.sql        # Staging column so /totp start can't disable enabled 2FA.
│   ├── quotes.sql              # Server-side offer numbering sequence (MED-15).
│   ├── geolocation_consent.sql # Per-engineer location opt-in (HIGH-10).
│   └── convert_rpc.sql         # Atomic convert_site_to_client() RPC (HIGH-12).
├── scripts/
│   └── create_admin.sql        # Bootstrap the first admin (you supply the bcrypt hash).
└── supabase/
    ├── config.toml             # Local-dev Supabase config. NOT prod config.
    └── functions/              # Edge functions (Deno).
        ├── _shared/            # cors, db, auth, audit, ratelimit, password, push
        ├── auth/               # POST login, GET session check, DELETE logout
        ├── sites/              # CRUD + soft delete + restore + pagination
        ├── clients/            # CRUD + soft delete + restore + pagination
        ├── products/           # CRUD + soft delete + restore
        ├── engineers/          # admin-only CRUD + email + TOTP status
        ├── convert/            # atomic lead→client conversion via RPC
        ├── extract/            # Gemini 2.5 Flash lead extraction
        ├── subscribe/          # Web push subscription store/remove
        ├── notify/             # Cron-fired due-date push notifier
        ├── location/           # Engineer location report + admin map fetch (consent-gated)
        ├── totp/               # 2FA enrollment / verify / recovery codes
        ├── audit/              # Admin-only audit log reader
        └── quotes/             # Atomic offer-number sequence + quote storage
```

---

## Environment variables

### Vercel (frontend hosting)

| Variable                  | Notes                                                        |
|---------------------------|--------------------------------------------------------------|
| (none required)           | The frontend hits the Supabase project directly.             |

`vercel.json` sets all security headers (CSP, HSTS preload, X-Frame-Options, Referrer-Policy, Permissions-Policy).

### Supabase (Edge Functions)

| Variable                       | Used by                  | Notes                                                          |
|--------------------------------|--------------------------|----------------------------------------------------------------|
| `SUPABASE_URL`                 | all functions            | Provided by Supabase by default.                               |
| `SUPABASE_SERVICE_ROLE_KEY`    | all functions            | Bypasses RLS. Must NEVER leak to client.                       |
| `GEMINI_API_KEY`               | `extract`                | Google AI Studio key for Gemini 2.5 Flash.                     |
| `VAPID_PUBLIC_KEY`             | `subscribe`, `notify`    | Web push.                                                      |
| `VAPID_PRIVATE_KEY`            | `notify`, `_shared/push` | Web push.                                                      |
| `CRON_SECRET`                  | `notify`                 | Used by the hourly pg_cron job that triggers due-date pushes.  |

The VAPID public key is **also** hardcoded in `app.js` (`VAPID_PUBLIC_KEY` const) because the browser needs it at subscription time. If you rotate keys, update both.

---

## First-time setup

1. Create a new Supabase project. Note the project URL and the `service_role` key.
2. In the Supabase SQL editor, run each file in this order:
   ```
   migrate.sql
   migrations/push_notifications.sql
   migrations/engineer_location.sql
   migrations/audit_log.sql
   migrations/login_attempts.sql
   migrations/soft_delete.sql
   migrations/totp.sql
   migrations/totp_pending.sql
   migrations/quotes.sql
   migrations/geolocation_consent.sql
   migrations/convert_rpc.sql
   ```
3. Bootstrap an admin account:
   ```bash
   # generate a bcrypt hash locally — do NOT commit it
   node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" 'YourStrongPassword'
   ```
   Paste the hash into `scripts/create_admin.sql` and run it once.
4. Set the Edge Function env vars listed above in the Supabase dashboard.
5. Deploy each edge function:
   ```bash
   supabase functions deploy auth sites clients products engineers convert extract subscribe notify location totp audit quotes
   ```
6. Edit `supabase/functions/_shared/cors.ts` and `app.js` (`FUNCTIONS_BASE`) to point at your project URL.
7. Update the VAPID public key in `app.js` and re-deploy to Vercel.

---

## Security posture

### What's enforced
- **RLS deny-by-default** on every domain table. The anon and authenticated roles have `REVOKE ALL`. Edge functions go through `SERVICE_ROLE`, which bypasses RLS — that is the intended access path.
- **Server-generated IDs** on insert (sites, clients, products) — prevents IDOR.
- **Server-side ownership checks** on every update and delete; non-admins can only touch rows where `engineer_id = self`.
- **CSP without `unsafe-inline` for scripts**. Only a single tiny theme-bootstrap script is allowed via SHA-256 hash. The runtime uses an event delegation dispatcher (`data-act` / `data-input-act` / `data-change-act` / `data-submit-act`) instead of inline handlers.
- **SRI** on the Leaflet CDN bundles (sha384).
- **HSTS preload**, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(self), geolocation=(self)`.
- **Login rate limit** in Postgres (`register_login_attempt` RPC), survives across edge instances; default 7 attempts / 15 min then 15-min lockout. Timing-safe TOTP comparison.
- **Audit log** captures login (success/failure), logout, every create/update/delete on sites/clients/products, conversions, engineer role changes, TOTP changes, and consent grants/revocations.
- **Soft delete** on sites/clients/products with a 30-day auto-purge cron. UI shows an Undo toast.
- **Per-engineer geolocation consent**. Tracking is OFF until explicitly granted; the server refuses POSTs with `403 needsConsent` if consent isn't on record.
- **TOTP 2FA** for any engineer who opts in. RFC 6238, ±1 step, 10 sha-256-hashed recovery codes.
- **Atomic lead → client conversion** via `convert_site_to_client` RPC — no partial state on failure.

### What's NOT enforced (known limitations)
- Single-tenant. No `org_id`. Reselling as multi-tenant SaaS requires a schema migration.
- No password reset by email yet. Engineers have an `email` column; the flow is admin-driven.
- The VAPID public key is embedded in the client; rotating it requires a coordinated redeploy.
- CSP keeps `'unsafe-inline'` for **style-src** because the dynamic UI renders many
  `style="…"` attributes from template literals. Dropping it would require either rewriting
  every inline style as a class or maintaining a `'unsafe-hashes'` list for each unique
  style. The XSS risk from inline styles is much lower than from inline scripts (modern
  browsers no longer parse `javascript:` inside CSS), and the script side is fully locked
  down (hash-only). Reach the `'unsafe-inline'`-free state for styles as part of a later
  refactor when the inline-style usage is migrated to CSS classes.

---

## Local development

```bash
# Frontend only (no edge functions needed if you point at prod functions)
npx http-server . -p 8080

# Or run the local Supabase stack
supabase start
supabase functions serve
```

The frontend is a static SPA — no build step. Edit `index.html`, `app.js`, `app.css` and refresh.

---

## Testing

A Playwright smoke test lives in `tests/smoke.spec.ts`. It hits the production URL and asserts:
- the login page renders without console errors,
- bad credentials get a 401,
- the CSP header is present and contains `'self'` but not `'unsafe-inline'` for scripts.

```bash
npm install
npx playwright install --with-deps
npx playwright test
```

CI runs this on every push (see `.github/workflows/ci.yml`).

---

## Deployment

Pushed to `main` → automatically deployed to Vercel. Edge functions deploy separately via `supabase functions deploy`. There is no build step for the frontend.
