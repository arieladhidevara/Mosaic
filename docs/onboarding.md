# Public editor, invited Pro access and BYOK

The existing editor is public for manual work. The landing page offers Sign in
and Continue as guest. A guest can upload, mask, organize layers, transform,
save/open `.moz` files and export PNGs. Guest work creates no account records.
AI and `/admin` remain protected on the server. A sign-in dialog opens over the
editor without replacing the canvas. Cancelling returns to the same work.

An invited account gets the Pro preview UI. This label does not grant admin
permissions or change the invitation/membership checks. Supabase verifies email
and Google identities, and the server reads roles from `mosaic_members` only.
Google may create an Auth identity without an invitation, but that identity
cannot obtain a mozAI session, call AI, or read account/admin data.

## Enable Google sign-in for mozai.cc

The code supports Google PKCE sign-in. The Google provider must also be enabled
in Supabase; deploying this code does not create OAuth credentials. If disabled,
the UI gives an actionable message and email/guest editing remains available.

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/clients).
   Configure the consent screen and create an OAuth client of type **Web
   application**. Add `https://mozai.cc` as an authorized JavaScript origin.
2. Set its authorized redirect URI to the **Supabase callback**, not the editor:
   `https://aknbekjipxbgpjpmpvar.supabase.co/auth/v1/callback`.
3. In [Supabase Authentication → Providers](https://supabase.com/dashboard/project/aknbekjipxbgpjpmpvar/auth/providers),
   enable Google and enter that client's ID and secret there. Never put the
   secret in frontend code, Git, a `NEXT_PUBLIC_` variable, or chat.
4. In **Authentication → URL Configuration**, set Site URL to `https://mozai.cc`.
   Allow `https://mozai.cc/auth-callback.html**` for the popup callback with its
   random state query, and `https://mozai.cc/?confirmed=1` for email confirmation.
   If you serve `www.mozai.cc` as well, add its corresponding exact paths/origin;
   alternatively redirect www to the canonical domain. For local real-login
   testing use `http://127.0.0.1:8000/auth-callback.html**` and
   `http://127.0.0.1:8000/?confirmed=1` in a development Supabase project.
   Restrict preview URLs to specific deployments rather than every Vercel site.
5. While the Google consent app is in Testing, add intended testers in Google's
   Audience settings. Publish the consent app when ready for wider use, following
   any Google requirements shown in that console.
6. Test with a real invitation. Choose Google using the invitation's email.
   Verify the existing editor reopens, Pro demo usage loads, and `/admin` stays
   denied for a regular user. No real provider credentials are used in automated
   tests; this operator check is necessary after provider setup.

The browser opens Google in a popup to preserve unsaved editor work. Allow that
popup when prompted. The server creates a 10-minute HttpOnly flow cookie with a
random verifier, state and pending invitation. Supabase receives only the S256
challenge. The same-origin callback exchanges the one-time code only when its
state and cookie match, verifies the resulting user and active membership, then
sets HttpOnly application cookies. No access/refresh tokens are sent to the
opener. The opener validates the message origin and window, then fetches the
verified session itself. Client-supplied IDs, role fields and redirects are ignored.

Provider references: [Google setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google),
[PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow), and
[redirect allow lists](https://supabase.com/docs/guides/auth/redirect-urls).

## Invitation and email flow

The administrator creates an invitation inside the existing `/admin` portal.
The invited visitor signs in or chooses Create account, sets email/password and
confirms their email. The pending invitation is kept in this browser tab's
session storage until sign-in completes, and removed after redemption. Returning
to the original tab or reopening the original invitation link works across
email confirmation. A confirmation link opened in another browser/device may
need the original invitation again. Tokens are removed from the visible URL.

Expired, revoked, exhausted or email-mismatched invitations never grant access.
The existing transactional invitation redemption and RLS migration are unchanged.
The new guest/onboarding code requires **no additional database migration**.

## Connecting OpenAI

After interactive sign-in, onboarding links directly to
[OpenAI API billing](https://platform.openai.com/settings/organization/billing/overview)
and [API keys](https://platform.openai.com/api-keys). Users can skip it to continue
manual editing. The server checks the supplied key against `GET /v1/models`
without generating an image. Restricted keys need permission to list models for
this check. Successful validation is not a claim about model access, quota or
remaining balance; image requests still handle provider errors normally.

The API-key form offers **Remember on this browser**. This writes only an
account-scoped AES-GCM ciphertext envelope and a nonextractable Web Crypto key to
IndexedDB on this origin. After account authentication, the matching credential
is restored automatically, including across a full reload. It is not stored on
the server or in localStorage/sessionStorage. This is local protection of stored
bytes, not a separate boundary from scripts running on the same origin.

Uncheck Remember for tab-only use. Remove key deletes the saved credential.
Sign-out/session expiry clears the active in-memory key; a remembered key is
available again only after authenticating its matching account. Keys rejected by
OpenAI with 401 are disconnected and forgotten, while quota/rate failures do not
discard a valid key. If browser persistence is unavailable, connection still works
for the current tab and the UI explains that remembering failed.

The key input is emptied after submission/closing. Keys pass through the server
to OpenAI over HTTPS in hosted environments, and are never saved in server
storage, analytics, logs, cookies or project files, or displayed to admins.
Do not claim the server never receives them: it must forward AI requests.

## Demo credits, not OpenAI billing

Each active invited user has a simulated allowance of **100 demo credits** per
environment, derived from their recorded successful image generations. Existing
successful history is included. These are not money, prepaid generation rights,
OpenAI tokens, or a prediction of the OpenAI bill.

| Generation quality | Demo credits on success |
| --- | ---: |
| Low | 1 |
| Medium | 2 |
| High | 3 |

Master is always High (3). Region Edit defaults to Medium (2), Harmonize to High
(3); their button labels follow project preferences. Regeneration also counts
when successful. Pending/failed rows do not count. Re-reading or refreshing usage
does not charge again. The server computes totals from authenticated user ID and
environment with exact database counts; clients cannot supply usage totals or
choose another account. The local developer store follows the same rules.

Demo remaining is clamped at zero, and **does not block real BYOK generation**.
No automatic refill, checkout, subscription or OpenAI billing permission is added.
The toolbar and balance dialog always say demo. Missing usage is shown as
unavailable, never a fabricated zero or fresh 100. If a provider result succeeds
but its metadata write fails, the paid image is retained and the UI reports that
demo usage may be incomplete. The next successful refresh uses recorded rows.
Classification and naming are auxiliary requests; their actual OpenAI charges
are separate from the demo image counter, as explained in the balance dialog.

There is no supported balance-reading endpoint established here for a normal
BYOK project key. OpenAI's documented organization costs endpoint is an Admin API,
and historical costs are not a remaining prepaid balance. mozAI does not ask for
an OpenAI Admin key or scrape undocumented billing endpoints. The real balance
opens in OpenAI's dashboard. See [OpenAI authentication/API surfaces](https://developers.openai.com/api/reference/overview)
and [organization costs](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs).

## Verification

`npm test` includes provider contracts, pixel geometry, invitation/RLS SQL,
production/local boundaries, anonymous API denial, Google PKCE state/cookie
binding, user verification and membership, provider-disabled recovery, BYOK
connection validation, and successful-only demo accounting. No real account or
paid API call is used.

For UI checks, run two isolated mock servers in separate terminals:

```powershell
$env:NODE_ENV='development'; $env:MOSAIC_DEV_AUTH='true'; $env:PORT='8020'
node --require ./tests/mock-openai.cjs local-server.js
```

```powershell
$env:NODE_ENV='development'; $env:MOSAIC_DEV_AUTH='false'; $env:PORT='8021'
node --require ./tests/mock-openai.cjs --require ./tests/mock-supabase.cjs local-server.js
```

Use an isolated Chrome profile with remote debugging on `127.0.0.1:9227`, never a
normal browser profile. `tests/browser-runner.py` requires Python `websockets` and
runs committed JS browser suites. Set `MOSAIC_BROWSER_URL` to the corresponding
local server; `MOSAIC_CLEAR_AUTH=1` clears cookies in that isolated browser.
`MOSAIC_WIDTH=390` checks mobile layout. Browser fixtures refuse nonlocal servers.

```powershell
$env:MOSAIC_BROWSER_URL='http://127.0.0.1:8021'; $env:MOSAIC_CLEAR_AUTH='1'
python tests/browser-runner.py guest-scenarios.js runGuestFlow
python tests/browser-runner.py guest-scenarios.js runLandingLayout
$env:MOSAIC_BROWSER_URL='http://127.0.0.1:8021/#invite=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
python tests/browser-runner.py guest-scenarios.js runInvitationFlow
```

The editor is static HTML/CSS/JS with Node API functions, so there is no bundling
build step. Serve and inspect actual pages as well as running JS syntax checks.
