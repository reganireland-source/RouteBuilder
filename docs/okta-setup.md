# Okta SSO setup — IT handoff checklist

RouteBuilder supports two authentication models, switched by one environment
variable (`AUTH_MODE` on the backend, `VITE_AUTH_MODE` on the frontend — they
must be set to the **same** value):

- **`admin_key`** (default) — today's model. Anyone with the link can view
  the app; a shared admin passphrase gates writes (Network Editor, KML
  import, reference-data edits). Nothing changes if you never touch this doc.
- **`okta`** — every visitor signs in with your organisation's own Okta
  account before seeing *anything*, including read-only browsing. Whether
  they can also make changes is decided by Okta group membership, not by a
  shared secret anyone could leak or forget to rotate.

This document is everything **you** (IT / the Okta admin) need to do to turn
`okta` mode on. None of it requires anyone to hand you application source
code or explain OAuth — you're configuring a standard Okta app the same way
you would for any other internal single-page application, then pasting six
values into two places.

**Nothing here is a secret.** The values you'll note down (issuer, client
ID, group name) are safe to see in a config file or a Slack message — a
public OIDC client (a browser-based single-page app using PKCE, which is
what this is) never holds a `client_secret` at all. There is no password to
generate, store, or rotate on the Okta side.

---

## What you're approving, in one paragraph

This adds standard OIDC (OpenID Connect) Authorization Code + PKCE sign-in —
the same mechanism Okta already recommends for any browser-based app, no
custom protocol, no non-standard token handling. The backend independently
verifies every request's Okta-issued token against Okta's own published
signing keys before honouring it (see `backend/app/auth/okta.py` if your
security team wants to read the verification code itself — it's about 150
lines, thoroughly commented, and covered by unit tests in
`backend/tests/test_okta_auth.py`). Nothing about your existing Okta tenant,
its other applications, or its user directory is touched — you're adding
one new application registration, the same as onboarding any other internal
tool.

---

## Step 1 — Create the Okta application

In the Okta admin console:

1. **Applications → Applications → Create App Integration**
2. Sign-in method: **OIDC – OpenID Connect**
3. Application type: **Single-Page Application** (this is what makes it a
   *public* client using PKCE — no client secret is ever generated or
   needed)
4. **App integration name**: `RouteBuilder` (or your own naming convention)
5. **Grant type**: leave the default (**Authorization Code**) checked;
   **Refresh Token** is optional — RouteBuilder doesn't require it, Okta's
   own silent-renewal handles session extension
6. **Sign-in redirect URIs** — add one per environment you run:
   - `https://<your-production-frontend-domain>/callback`
   - `https://<your-staging-frontend-domain>/callback` (if you have one)
   - `http://localhost:5173/callback` (only if someone will test this
     locally before it's deployed — safe to omit otherwise)
7. **Sign-out redirect URIs** — the same domains, without `/callback`:
   - `https://<your-production-frontend-domain>`
   - (repeat for staging / localhost as above)
8. **Assignments**: assign this app to the group(s) or people who should be
   able to reach RouteBuilder at all. Remember: in `okta` mode, an Okta
   assignment is what lets someone in the *building's front door* — a
   separate group (Step 3) decides who can *edit* once inside.
9. Save. On the app's **General** tab, note down the **Client ID** — you'll
   need it in Step 4.

## Step 2 — Find your issuer URI

Still in the admin console: **Security → API → Authorization Servers**.

- If your organisation already has a custom Authorization Server it uses
  for internal apps, use its **Issuer URI** (looks like
  `https://your-org.okta.com/oauth2/<serverId>`).
- Otherwise, the **default** org authorization server's issuer is
  `https://your-org.okta.com/oauth2/default` — fine for most single-app
  setups.

Note this URI down — it's `OKTA_ISSUER` in Step 4.

## Step 3 — Add the groups claim and create the admin group

RouteBuilder decides who can *edit* (as opposed to merely view) by checking
Okta group membership in the access token. Two things have to be true for
that to work, and both are easy to skip by accident:

1. **The Authorization Server must be told to include groups in the access
   token.** On the SAME Authorization Server from Step 2: **Claims → Add
   Claim**
   - Name: `groups`
   - Include in token type: **Access Token** — always
   - Value type: **Groups**
   - Filter: **Matches regex** → `.*` (include every group the user is a
     member of), or narrow it to just your RouteBuilder groups, e.g.
     `RouteBuilder-.*`, if you'd rather not expose unrelated group
     memberships in the token at all
   - Save

   **If you skip this step**, RouteBuilder doesn't error — it just treats
   *everyone* as read-only, forever, because it never sees any group
   membership. See Troubleshooting if that happens.

2. **Create (or pick) the Okta group for write access**, e.g.
   `RouteBuilder-Admins`. Add whoever should be able to edit the network
   (Network Editor, KML import, reference data) to it. Note the **exact
   group name** — it's `OKTA_ADMIN_GROUP` in Step 4, and it's an
   exact-string match, case-sensitive.

   **Leaving this unset is safe, not dangerous**: RouteBuilder fails
   *closed*, not open — an unset or misspelled admin group means nobody
   gets write access (the whole app is still viewable and read-only for
   everyone who can sign in), never the reverse.

## Step 4 — Set the environment variables

You now have four values: **Issuer**, **Client ID**, and the **admin group
name** (plus the mode switch itself). Set them in both places — they must
be consistent, or sign-in will succeed but the app and the server will
disagree about who the user is.

**Backend** (Railway, or wherever the API is hosted):

```
AUTH_MODE=okta
OKTA_ISSUER=https://your-org.okta.com/oauth2/default
OKTA_CLIENT_ID=<the Client ID from Step 1>
OKTA_ADMIN_GROUP=RouteBuilder-Admins
```

(`OKTA_AUDIENCE` can stay unset — it defaults to `OKTA_CLIENT_ID`, correct
for this setup. Only set it if your Authorization Server issues tokens with
a distinct custom audience.)

**Frontend** (Vercel, or wherever the static build is hosted):

```
VITE_AUTH_MODE=okta
VITE_OKTA_ISSUER=https://your-org.okta.com/oauth2/default
VITE_OKTA_CLIENT_ID=<the same Client ID from Step 1>
VITE_OKTA_ADMIN_GROUP=RouteBuilder-Admins
```

**Then redeploy both.** The frontend variables are baked into the JS bundle
at *build* time — setting them in Vercel without triggering a new build
does nothing; make sure the deploy actually rebuilds (a fresh push, or
Vercel's "Redeploy" with the build cache cleared).

## Step 5 — Test it

1. Open the frontend URL in a private/incognito window (so nothing from a
   previous admin-key session interferes).
2. You should be redirected straight to Okta's own hosted sign-in page —
   there's no "click here to sign in" screen in between, by design.
3. Sign in with an account that's assigned to the app (Step 1) and a member
   of the admin group (Step 3). You should land back in RouteBuilder,
   fully working, with the left sidebar's bottom bar reading **"Admin
   mode"** and showing your email.
4. Sign in with an account that's assigned but *not* in the admin group —
   the app should still load and be fully browsable, with the bottom bar
   reading **"Read-only"** and a note about asking to be added to the
   admin group. No Network Editor tab, no write buttons.
5. Sign out (the bottom bar's "Sign out" button) and confirm you land back
   at Okta's sign-in page on the next visit, not a cached session.

If step 2 doesn't happen — the app loads normally instead of redirecting —
`VITE_AUTH_MODE` almost certainly didn't make it into the build; re-check
Step 4's frontend redeploy.

## Rolling back

Nothing here is destructive or one-way. To go back to the shared-password
model at any point: set `AUTH_MODE` and `VITE_AUTH_MODE` back to
`admin_key` (or delete them entirely — that's the default), redeploy both,
done. No data, no user accounts, and nothing about your Okta org is
affected either way.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| App loads normally, no redirect to Okta | `VITE_AUTH_MODE` isn't set to `okta` in the **deployed build** — check Vercel's env vars for the right environment (Production vs Preview) and confirm the deploy actually rebuilt afterward. |
| Every API call fails with a 503 "Okta sign-in is not configured on the server" | `AUTH_MODE=okta` is set on the backend but `OKTA_ISSUER` or `OKTA_CLIENT_ID` is missing/blank there. |
| Browser redirects to Okta, but Okta shows its own error page (not RouteBuilder's) about a redirect URI | The exact URL RouteBuilder tried to redirect back to isn't in the app's **Sign-in redirect URIs** list (Step 1.6) — check for a trailing slash mismatch or the wrong domain/environment. |
| Sign-in succeeds, but the user lands on "Sign-in error" in RouteBuilder | Usually `OKTA_ISSUER` / `VITE_OKTA_ISSUER` mismatch, or `OKTA_CLIENT_ID` / `VITE_OKTA_CLIENT_ID` mismatch, between frontend and backend, or between what's configured and the app's actual values in Okta. |
| Everyone who signs in sees "Read-only", including people you added to the admin group | Almost always the groups claim (Step 3.1) wasn't added to the Authorization Server, or the filter regex doesn't match the group name. Confirm by checking the access token's contents (Okta's own [token preview tool](https://developer.okta.com/docs/guides/customize-tokens-returned-from-okta/main/#test-your-claim) in the Authorization Server's Claims tab) for a `groups` array containing the expected group name. |
| One person's admin access doesn't seem to update after being added to the group | Okta group membership is only re-read when their token is issued or silently renewed (typically within the hour) — ask them to sign out and back in for an immediate effect. |

---

## What this doesn't cover (yet)

This is deliberately scoped as groundwork, built and tested without access
to a live Okta tenant (client secrets and org-specific config should never
be pasted into a chat session that built this). It has NOT been validated
against a real Okta org end-to-end — Step 5 above is that first real test,
and it's on you to run it. Everything up to that point (JWT signature
verification, issuer/audience/expiry checks, the groups-claim admin check)
is unit-tested against a locally-generated key pair standing in for Okta's
own signing keys (`backend/tests/test_okta_auth.py`), which proves the
verification logic itself is correct — it can't prove your specific Okta
org is wired up correctly, which is exactly what Step 5 is for.

Not built (ask if you need one of these and it'll be scoped separately):
- SAML 2.0 (this is OIDC only)
- Automatic user *provisioning* into RouteBuilder (there's nothing to
  provision — okta mode has no user database of its own; every write is
  still attributed to "an authenticated admin," not to a specific stored
  user record)
- More than one admin *tier* (today it's binary: in `OKTA_ADMIN_GROUP` or
  not)
