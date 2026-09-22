"""
auth/entra.py — Microsoft Entra ID (Azure AD)-specific settings for the
generic OIDC verifier.

WHY THIS EXISTS. See app/auth/okta.py's module docstring for the general
shape — this is the same idea, a second identity provider. Entra ID differs
from Okta in three concrete ways this module bridges:

  1. IDENTITY IS A TENANT, NOT AN ISSUER URL. Okta admins configure an
     "issuer" directly; Entra ID admins think in terms of a Directory
     (tenant) ID — a GUID copied straight off the Entra portal's Overview
     page. So this module takes ENTRA_TENANT_ID and derives the issuer/JWKS
     URLs from it, rather than asking for a full issuer URL the way Okta
     does — matching how Microsoft's own docs and admin console refer to it,
     which is what an org's IT will actually have in front of them.

  2. THE JWKS ENDPOINT ISN'T UNDER THE ISSUER PATH. Okta's is always
     `{issuer}/v1/keys`. Entra ID's lives at a sibling `/discovery/v2.0/keys`
     path, not nested under `/v2.0` the way the issuer is — hence oidc.py's
     OidcSettings.jwks_uri being a plain field rather than derived from
     `issuer` the way OktaSettings' equivalent property used to be.

  3. ADMIN ACCESS COMES FROM AN APP ROLE, NOT A GROUP. Entra ID CAN put
     group membership in a token (via `groupMembershipClaims` in the app
     manifest), but a user in 200+ groups then gets no real `groups` claim
     at all — just a `_claim_names`/`hasgroups` flag requiring a follow-up
     Microsoft Graph API call this backend does not make. App Roles avoid
     that entirely: your IT defines an "Admin" role in the app registration,
     assigns it to a group or specific users, and every token for that user
     carries a plain `roles: ["Admin"]` claim with no size limit and no
     follow-up call — Microsoft's own documented pattern for app-level RBAC,
     and the one docs/entra-setup.md walks IT through setting up.

SCAFFOLDING, NOT A FINISHED INTEGRATION. Built without access to a real
Entra tenant, for the same reason as the Okta module: client credentials for
an org's identity provider should never be pasted into a chat session. Every
function here is unit-tested against the same generic OIDC machinery
test_oidc.py already proves works for either claim shape (groups or roles);
tests/test_entra_auth.py tests only what's specific to this module — reading
ENTRA_* environment variables into the URLs above. The first real login
against a live Entra tenant is IT's step, following docs/entra-setup.md.
"""
from __future__ import annotations

import os
from typing import Optional

from .oidc import OidcSettings


def load_entra_settings() -> Optional[OidcSettings]:
    """
    Read ENTRA_TENANT_ID / ENTRA_CLIENT_ID / ENTRA_AUDIENCE / ENTRA_ADMIN_ROLE
    from the environment. Returns None if either of the two REQUIRED
    variables (ENTRA_TENANT_ID, ENTRA_CLIENT_ID) is blank — main.py treats
    that exactly like "AUTH_MODE=entra but Entra isn't configured yet" and
    fails closed, the same shape of fail-safe auth_guard already applies
    when ADMIN_KEY is unset or when AUTH_MODE=okta is set without Okta's own
    required variables.

    ENTRA_AUDIENCE defaults to ENTRA_CLIENT_ID when unset — the common case
    for a single-page app's own access token, where the app IS the audience.
    Set it explicitly only if you exposed a custom API scope with its own
    Application ID URI (e.g. "api://<client-id>" or a custom identifier).

    ENTRA_ADMIN_ROLE defaults to blank, meaning "nobody is granted admin" —
    see oidc.py's OidcVerifier.is_admin() on why a missing role name fails
    closed rather than defaulting to "everyone is admin". It should be the
    App Role's `value` (the short machine name you typed when defining the
    role in the app registration manifest — e.g. "Admin"), not its display
    name or id.

    issuer/jwks_uri are both derived from ENTRA_TENANT_ID, following the
    Microsoft identity platform v2.0 endpoint's fixed URL shapes — see this
    module's own docstring on why the JWKS path isn't nested under the
    issuer the way Okta's is.
    """
    tenant_id = os.getenv("ENTRA_TENANT_ID", "").strip()
    client_id = os.getenv("ENTRA_CLIENT_ID", "").strip()
    if not tenant_id or not client_id:
        return None
    audience = os.getenv("ENTRA_AUDIENCE", "").strip() or client_id
    admin_role = os.getenv("ENTRA_ADMIN_ROLE", "").strip()
    return OidcSettings(
        issuer=f"https://login.microsoftonline.com/{tenant_id}/v2.0",
        client_id=client_id,
        audience=audience,
        jwks_uri=f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys",
        admin_claim_type="roles",
        admin_claim_value=admin_role,
    )
