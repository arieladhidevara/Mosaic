# Phase 2: Vercel, Supabase, and local developer access

This uses the existing editor and BYOK API routes. `/admin` is part of the same
application and uses the same session. It is the Phase 2 foundation, not the full
Phase 3 analytics expansion.

## Connect the existing Vercel project

1. In the intended Supabase project, run
   [`supabase/migrations/202611070001_phase2.sql`](../supabase/migrations/202611070001_phase2.sql)
   in SQL Editor. The migration is repeatable. It creates only `mosaic_*` tables
   and functions. It does not replace Supabase Auth or edit existing editor files.
2. In Vercel **mosaic → Settings → Environment Variables**, add these server-only
   variables for **Production**:

   | Variable | Supabase value |
   | --- | --- |
   | `SUPABASE_URL` | Project URL |
   | `SUPABASE_PUBLISHABLE_KEY` | Publishable API key, or legacy anon key |
   | `SUPABASE_SECRET_KEY` | Server secret API key, or legacy service-role key |
   | `MOSAIC_APP_ORIGIN` | Exact HTTPS production origin, without a path |

   The aliases `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are supported.
   Do not use a `NEXT_PUBLIC_` prefix for server credentials. The application does
   not expose any Supabase credentials to the browser.
3. Configure **Preview** with a separate Supabase project where possible. Apply the
   same migration there. Its records use `environment: preview`; production uses
   `environment: production`. Omit `MOSAIC_APP_ORIGIN` for changing preview URLs,
   or set the exact origin of the preview being tested. Do not reuse production
   secrets for local development.
4. In Supabase Auth, enable email/password login and email confirmation. Set the
   Site URL to the production origin and allow only the intended confirmation
   redirect URLs. Configure SMTP as required for real invitation signups.
5. Create your first admin in **Supabase → Authentication → Users** and confirm
   their email. Then run this in that project's SQL Editor, replacing the email:

   ```sql
   select public.mosaic_bootstrap_admin('you@example.com', 'production');
   ```

   Use `'preview'` in the preview database. This function is callable only by the
   service role/operator and accepts only an already confirmed Auth user. Its
   privileges cannot be requested from the browser. Alternatively use
   `node scripts/bootstrap-admin.js EMAIL production` with server credentials
   supplied locally through an ignored `.env.local` file.
6. Redeploy the branch in Vercel after configuring variables and the database.
   Sign in, open `/admin`, and create invitation links for testers. Links use a
   URL fragment so their tokens are not included in server request URLs. Only the
   SHA-256 token hash is stored; the original link is shown once. Signup requires
   a valid unexpired invitation and confirmed email. Reopen the original invitation
   link after confirming the email to complete first login.

`MOSAIC_DEV_AUTH` must remain unset or false in Vercel. Even if set to true, the
server rejects the bypass on Preview and Production. Without Supabase setup,
authenticated operations fail closed rather than allowing anonymous or admin access.
The old `MOSAIC_ADMIN_USERNAME`, `MOSAIC_PASSWORD_HASH`, and `MOSAIC_SESSION_SECRET`
variables are not used by this Supabase implementation.

## Automatic local developer account

```powershell
npm run dev:local
```

Open `http://127.0.0.1:8000`. The editor opens automatically as
`dev@mosaic.local`, with admin access and stable ID
`00000000-0000-4000-8000-000000000001`. `/admin` works with the same identity.
No Supabase instance, Docker, production credentials, invitation, or login form
is needed for this local test mode. It seeds an isolated file store at
`.mosaic-dev/data.json` on first use. The directory is ignored by Git, Vercel,
and the local static server. Local activity never accesses a Supabase database.

The launcher explicitly sets `NODE_ENV=development` and `MOSAIC_DEV_AUTH=true`.
Alternatively put `MOSAIC_DEV_AUTH=true` in an ignored `.env.local` and run
`npm run dev`. The option is disabled by default. `npm start` never enables it.

Each request must satisfy all conditions on the server:

- The development environment and explicit flag are both set.
- No Vercel deployment indicator is present.
- Both the remote socket and local server interface are loopback addresses.
- The Host header names exactly localhost, 127.0.0.1, or ::1.
- No forwarding, proxy, or Vercel headers are present.

The local server refuses a non-loopback bind when auto-login is configured. No
dedicated development-login endpoint, client role override, or fake JWT exists.
Application login does **not** supply an OpenAI API key. The existing API button
still requests your own BYOK key, and every AI route independently validates it.

## Test real signup/login locally

Copy `.env.example` to `.env.local`, fill in a **development** Supabase project's
server configuration, and apply the migration there. Bootstrap an admin with
`environment: development`. Then run:

```powershell
npm run dev:login
```

This overrides `MOSAIC_DEV_AUTH=false`, including if `.env.local` enabled it.
The public welcome page offers a guest editor. AI and admin operations require
Supabase login and invitation access. Supabase Auth handles
password hashing, confirmation, and authentication; Mosaic verifies every session
with `/auth/v1/user` and checks an active membership from its database. Session
tokens use HttpOnly, SameSite cookies and Secure `__Host-` cookies on Vercel.
The application refreshes sessions server-side. BYOK is active in JS memory, with optional account-scoped encrypted browser remembering; it is never stored on the server.

## Reset local test data

```powershell
npm run dev:reset
```

Or use **Admin → Reset local test data**. Only the local file store is reset and
the developer identity is seeded again. Production/Preview reset requests are
denied. The CLI refuses hosted/production execution. Saved `.moz` files and
images are not touched. Reload the editor after a reset to start a new tracked
project. This reset does not modify a development Supabase database used for
real-auth testing; reset that separate database explicitly with Supabase tooling.

## Tracking and data boundaries

- Stable server-side user identity and server-selected environment are attached
  to project metadata, activity events, and generation records. Client IDs or
  roles cannot grant access. Project ownership is checked before attribution.
- Events cover session start, Base/Master uploads, closed selections, project
  save/open, and **Save image** downloads. Event IDs deduplicate retries. Browser
  downloads are counted as initiated downloads, not proof that a file reached disk.
- Generations are recorded once on the server with operation, model, quality,
  geometry-reference setting, status, duration, and the provider's reported tokens.
  Missing token usage remains null. Unknown model pricing remains null rather
  than inventing costs. All spending refers to user-paid BYOK OpenAI usage.
- Analytics contains **no OpenAI keys, passwords, images, masks, or prompts**.
  Projects still save their editable content locally as `.moz`; database project
  records are metadata only. `.moz` saves a project identifier for consistent attribution; the server reuses it only after checking ownership and environment. Shared or reset projects receive a new metadata record. Existing `.mosaic` files still open.
- Admin queries are paginated and partitioned by environment. Tables have RLS
  enabled and no public/anon/authenticated grants. Privileged data operations use
  a server key only after verified application authentication and authorization.
- Invitation redemption is transactional, locks capacity, checks email and expiry,
  and never accepts a caller-supplied admin role.

## Verification

```powershell
npm ci
npm test
```

The suite checks loopback/production boundaries, proxy/header forgery, Supabase
session validation, admin permissions, BYOK preservation, telemetry redaction,
local reset isolation, and actual PostgreSQL migration/invitation/RLS behavior in
an in-memory PGlite test database. No live Supabase or OpenAI credentials are used.
The existing browser scenario suites should run against `dev:local`, with
`tests/mock-openai.cjs` preloaded when testing generated images without API charges.

Production smoke test after configuring Vercel: anonymous visitor sees the public
welcome page and can enter the manual editor as a guest; AI requests sign-in;
uninvited user cannot access AI/admin data; invited tester can edit/generate with
BYOK but cannot read `/api/admin`; admin can view real environment-specific records.

### Browser fixtures

`tests/account-scenarios.js` provides `runLocalAccountChecks()` for local auto-login
and `runRealLoginChecks('tester')` / `runRealLoginChecks('admin')` for the real-login
UI with a mocked Supabase transport. To run the latter fixture server:

```powershell
node --require ./tests/mock-supabase.cjs --require ./tests/mock-openai.cjs scripts/dev-server.js --real-login
```

The fixtures use test-only credentials, refuse hosted/production execution, and
never contact Supabase or OpenAI. Mock OpenAI browser tests store records under
`.mosaic-dev/browser-tests/` so they do not affect normal developer data.
Provider references: [Supabase server-side verification](https://supabase.com/docs/reference/javascript/auth-getuser)
and [RLS and server-only service roles](https://supabase.com/docs/guides/database/postgres/row-level-security).

For Google provider configuration, the public guest flow, BYOK onboarding and
demo-credit semantics, see [Onboarding and Pro preview](onboarding.md).
