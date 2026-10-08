# Microsoft Entra ID SSO setup — IT handoff checklist

RouteBuilder supports three authentication models, switched by one
environment variable (`AUTH_MODE` on the backend, `VITE_AUTH_MODE` on the
frontend — they must be set to the **same** value):

- **`admin_key`** (default) — today's model. Anyone with the link can view
  the app; a shared admin passphrase gates writes (Network Editor, KML
  import, reference-data edits). Nothing changes if you never touch this doc.
- **`okta`** — Okta SSO (see `docs/okta-setup.md`), built first and left in
  place even for organisations using this doc instead — the two are
  independent, not sequential.
- **`entra`** — every visitor signs in with your organisation's own
  Microsoft Entra ID (Azure AD) account before seeing *anything*, including
  read-only browsing. Whether they can also make changes is decided by an
  Entra **App Role**, not by a shared secret anyone could leak or forget to
  rotate.

This document is everything **you** (IT / the Entra admin) need to do to
turn `entra` mode on. None of it requires anyone to hand you application
source code or explain OAuth — you're registering a standard Entra
single-page application the same way you would for any other internal tool,
then pasting a handful of values into two places.

**Nothing here is a secret.** The values you'll note down (tenant ID, client
ID, role name) are safe to see in a config file or a Slack message — a
public OIDC client (a browser-based single-page app using PKCE, which is
what this is) never holds a client secret at all. There is nothing to
generate, store, or rotate on the Entra side.

---

## What you're approving, in one paragraph

This adds standard OIDC (OpenID Connect) Authorization Code + PKCE sign-in —
the same mechanism Microsoft recommends for any browser-based app via its
own `@azure/msal-browser` SDK, no custom protocol, no non-standard token
handling. The backend independently verifies every request's Entra-issued
token against Microsoft's own published signing keys before honouring it
(see `backend/app/auth/entra.py` and `backend/app/auth/oidc.py` if your
security team wants to read the verification code itself — the actual
JWT/JWKS checking is shared with the Okta integration and is about 170
lines total, thoroughly commented, and covered by unit tests in
`backend/tests/test_oidc.py` and `backend/tests/test_entra_auth.py`).
Nothing about your existing Entra tenant, its other applications, or its
user directory is touched — you're adding one new app registration, the
same as onboarding any other internal tool.

---

## Step 1 — Register the application

In the [Microsoft Entra admin center](https://entra.microsoft.com):

1. **Identity → Applications → App registrations → New registration**
2. **Name**: `RouteBuilder` (or your own naming convention)
3. **Supported account types**: **Accounts in this organizational directory
   only** (single tenant) — RouteBuilder is an internal tool; there's no
   reason to allow sign-in from other Microsoft tenants or personal
   Microsoft accounts
4. **Redirect URI**: set the platform dropdown to **Single-page application
   (SPA)** — this matters: it's what tells Entra to allow PKCE with no
   client secret and to return tokens the browser can read directly. Add
   one URI per environment you run:
   - `https://<your-production-frontend-domain>/callback`
   - `https://<your-staging-frontend-domain>/callback` (if you have one)
   - `http://localhost:5173/callback` (only if someone will test this
     locally before it's deployed — safe to omit otherwise)
5. **Register**. On the **Overview** page, note down the **Application
   (client) ID** and the **Directory (tenant) ID** — you'll need both in
   Step 5.

## Step 2 — Expose an API scope

RouteBuilder's frontend needs to request an access token *for RouteBuilder's
own backend* — Entra requires the app to expose at least one scope before
any client (including itself) can be granted one.

1. Still on this app registration: **Expose an API**
2. If no **Application ID URI** is set yet, click **Add** next to it and
   accept the default (`api://<client-id>`) — **Save**
3. **Add a scope**:
   - Scope name: `access_as_user`
   - Who can consent: **Admins and users**
   - Admin consent display name / description: anything descriptive, e.g.
     "Access RouteBuilder as the signed-in user"
   - State: **Enabled**
4. Back on **API permissions** (same app): **Add a permission → My APIs →
   RouteBuilder → Delegated permissions → `access_as_user`** — this grants
   the SPA client permission to request the scope it just exposed on
   itself, a normal (if slightly unusual-looking) pattern for a SPA that's
   also the API's own client.
5. If your tenant requires admin consent for delegated permissions, click
   **Grant admin consent for `<your org>`** — otherwise each user will see a
   one-time consent prompt on first sign-in instead, which is also fine.

   **If you skip this step entirely**, sign-in itself still works (the app
   redirects to Entra and back successfully), but every API call fails —
   MSAL has no scope to request a usable access token for. See
   Troubleshooting if that happens.

## Step 3 — Add the App Role and assign it

RouteBuilder decides who can *edit* (as opposed to merely view) by checking
for a specific App Role in the signed-in user's token — Microsoft's own
documented pattern for app-level RBAC, and the reason this build uses App
Roles rather than raw group membership (a user in 200+ Entra groups gets no
usable `groups` claim at all without an extra Microsoft Graph call this app
does not make; App Roles have no such limit).

1. Still on this app registration: **App roles → Create app role**
   - Display name: `Admin` (or your own naming convention)
   - Allowed member types: **Users/Groups**
   - Value: `Admin` — this exact string, case-sensitive, is what
     `ENTRA_ADMIN_ROLE` in Step 5 must match
   - Description: anything descriptive
   - **Apply**

   **Unlike Okta's groups claim, no separate "add this to the token" step is
   needed** — Entra ID includes assigned App Roles in the `roles` claim of
   both ID and access tokens automatically, for any app that defines them.

2. Assign whoever should be able to edit the network (Network Editor, KML
   import, reference data) to the role: **Identity → Applications →
   Enterprise applications → RouteBuilder → Users and groups → Add
   assignment** — pick the users or (if your Entra plan supports
   group-to-role assignment) a group, and select the `Admin` role you just
   created.

   **Leaving `ENTRA_ADMIN_ROLE` unset in Step 5 is safe, not dangerous**:
   RouteBuilder fails *closed*, not open — an unset or misspelled role name
   means nobody gets write access (the whole app is still viewable and
   read-only for everyone who can sign in), never the reverse.

## Step 4 — Note the tenant and client IDs

You should already have these from Step 1's **Overview** page:

- **Directory (tenant) ID** — a GUID, e.g. `11111111-2222-3333-4444-555555555555`
- **Application (client) ID** — a GUID, e.g. `66666666-7777-8888-9999-000000000000`

## Step 5 — Set the environment variables

**Backend** (Railway, or wherever the API is hosted):

```
AUTH_MODE=entra
ENTRA_TENANT_ID=<the Directory (tenant) ID from Step 4>
ENTRA_CLIENT_ID=<the Application (client) ID from Step 4>
ENTRA_ADMIN_ROLE=Admin
```

(`ENTRA_AUDIENCE` can stay unset — it defaults to `ENTRA_CLIENT_ID`, correct
for this setup. Only set it if you exposed the API under a different
Application ID URI than the default `api://<client-id>`.)

**Frontend** (Vercel, or wherever the static build is hosted):

```
VITE_AUTH_MODE=entra
VITE_ENTRA_TENANT_ID=<the same Directory (tenant) ID>
VITE_ENTRA_CLIENT_ID=<the same Application (client) ID>
VITE_ENTRA_ADMIN_ROLE=Admin
```

(`VITE_ENTRA_SCOPE` can stay unset too — it defaults to
`api://<client-id>/access_as_user`, matching Step 2 exactly as written
above. Only set it if you named the scope something other than
`access_as_user`.)

**Then redeploy both.** The frontend variables are baked into the JS bundle
at *build* time — setting them in Vercel without triggering a new build
does nothing; make sure the deploy actually rebuilds (a fresh push, or
Vercel's "Redeploy" with the build cache cleared).

## Step 6 — Test it

1. Open the frontend URL in a private/incognito window (so nothing from a
   previous admin-key session interferes).
2. You should be redirected straight to Entra ID's own hosted sign-in page —
   there's no "click here to sign in" screen in between, by design.
3. Sign in with an account assigned the `Admin` role (Step 3). You should
   land back in RouteBuilder, fully working, with the left sidebar's bottom
   bar reading **"Admin mode"** and showing your account.
4. Sign in with an account that can reach the app but was *not* assigned the
   role — the app should still load and be fully browsable, with the bottom
   bar reading **"Read-only"** and a note about asking to be added to the
   admin role. No Network Editor tab, no write buttons.
5. Sign out (the bottom bar's "Sign out" button) and confirm you land back
   at Entra's sign-in page on the next visit, not a cached session.

If step 2 doesn't happen — the app loads normally instead of redirecting —
`VITE_AUTH_MODE` almost certainly didn't make it into the build; re-check
Step 5's frontend redeploy.

## Rolling back

Nothing here is destructive or one-way. To go back to the shared-password
model at any point: set `AUTH_MODE` and `VITE_AUTH_MODE` back to
`admin_key` (or delete them entirely — that's the default), redeploy both,
done. No data, no user accounts, and nothing about your Entra tenant is
affected either way.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| App loads normally, no redirect to Entra | `VITE_AUTH_MODE` isn't set to `entra` in the **deployed build** — check Vercel's env vars for the right environment (Production vs Preview) and confirm the deploy actually rebuilt afterward. |
| Every API call fails with a 503 "Entra ID sign-in is not configured on the server" | `AUTH_MODE=entra` is set on the backend but `ENTRA_TENANT_ID` or `ENTRA_CLIENT_ID` is missing/blank there. |
| Browser redirects to Entra, but Entra shows its own error page (`AADSTS50011: redirect URI mismatch`) | The exact URL RouteBuilder tried to redirect back to isn't in the app registration's **Redirect URIs** list (Step 1.4) — check for a trailing slash mismatch, the wrong domain/environment, or that it's still under the **SPA** platform rather than accidentally added under "Web". |
| Sign-in succeeds, but every API call still fails / the app appears stuck signed in but read-only with no obvious reason | Step 2 (Expose an API + grant the SPA client its own delegated permission) was skipped or not consented — MSAL can't silently acquire an access token for a scope it was never granted. Check **API permissions** on the app registration for a granted (not just requested) `access_as_user` permission. |
| Sign-in succeeds, but the user lands on "Sign-in error" in RouteBuilder | Usually `ENTRA_TENANT_ID` / `VITE_ENTRA_TENANT_ID` mismatch, or `ENTRA_CLIENT_ID` / `VITE_ENTRA_CLIENT_ID` mismatch, between frontend and backend, or between what's configured and the app's actual values in Entra. |
| Everyone who signs in sees "Read-only", including people you assigned the Admin role | Confirm the assignment is on the **Enterprise application** (Users and groups), not merely on the App Registration — these are related but distinct objects in Entra, and only the Enterprise application's assignments take effect. Also confirm `ENTRA_ADMIN_ROLE` matches the role's **Value** field exactly (Step 3), not its display name. |
| One person's admin access doesn't seem to update after being assigned the role | Entra only re-issues the `roles` claim when a fresh token is acquired — ask them to sign out and back in for an immediate effect, since this build's background refresh (every 5 minutes) re-reads whatever MSAL's cache already has rather than forcing a fully interactive re-login. |

---

## What this doesn't cover (yet)

This is deliberately scoped as groundwork, built and tested without access
to a live Entra tenant (client credentials and org-specific config should
never be pasted into a chat session that built this). It has NOT been
validated against a real Entra tenant end-to-end — Step 6 above is that
first real test, and it's on you to run it. Everything up to that point
(JWT signature verification, issuer/audience/expiry checks, the App Role
admin check — all shared with the Okta integration's own verification code)
is unit-tested against a locally-generated key pair standing in for
Microsoft's own signing keys (`backend/tests/test_oidc.py`,
`backend/tests/test_entra_auth.py`), which proves the verification logic
itself is correct — it can't prove your specific Entra tenant is wired up
correctly, which is exactly what Step 6 is for. Separately, a live browser
redirect to `login.microsoftonline.com` was confirmed to fire correctly
during development (MSAL's `loginRedirect()` genuinely navigates there with
no client-side error) — the one thing that couldn't be tested from a
sandboxed environment is a real tenant answering on the other end.

Not built (ask if you need one of these and it'll be scoped separately):
- SAML 2.0 (this is OIDC only)
- Group-based admin gating (this build deliberately uses App Roles instead —
  see Step 3's own reasoning on Entra's group-overage limitation; ask if
  your org has a hard requirement for group membership specifically)
- Microsoft Graph API calls of any kind (e.g. resolving a user's full group
  list, profile photo, manager chain) — only what's already in the ID/access
  token is ever read
- Automatic user *provisioning* into RouteBuilder (there's nothing to
  provision — entra mode has no user database of its own; every write is
  still attributed to "an authenticated admin," not to a specific stored
  user record)
- More than one admin *tier* (today it's binary: holds `ENTRA_ADMIN_ROLE`
  or not)
