"""
auth/okta.py — Okta-specific settings for the generic OIDC verifier.

WHY THIS EXISTS. The app's only auth model before this was a single shared
secret (ADMIN_KEY, see app/api/auth.py and main.py's auth_guard) — one
passphrase, gating writes only, with no concept of individual identity. An
organisation running Okta wants the opposite: every visitor signs in as
themselves, and what they can do is decided by which Okta group they belong
to, not by who else has been told a shared password. This module supplies
the two things that are genuinely Okta-specific — where Okta's published
signing keys live, and that Okta expresses group membership via a "groups"
claim — and hands both to the provider-agnostic verifier in oidc.py, which
does the actual JWT/JWKS work (shared with app/auth/entra.py; see that
module's docstring for why it isn't duplicated here).

SCAFFOLDING, NOT A FINISHED INTEGRATION. This was built without access to a
real Okta tenant (by design — an org's Okta client credentials should never
be pasted into a chat session). Every function here is unit-tested against a
self-signed RSA key pair standing in for Okta's own signing keys (see
tests/test_okta_auth.py), which exercises the exact same code path a real
token would hit, but the one thing that cannot be verified from here is "does
this actually work against a live Okta org" — that is the one step your IT
team has to do, following docs/okta-setup.md.

WHY THE GROUPS CLAIM MUST BE ADDED IN OKTA, NOT ASSUMED. Okta does not
include group membership in an access token by default — an org has to add
a "groups" claim to its Authorization Server's token policy (documented in
docs/okta-setup.md, one of the handful of steps IT has to do by hand). See
oidc.py's OidcVerifier.is_admin() for how a missing claim fails closed.
"""
from __future__ import annotations

import os
from typing import Optional

from .oidc import OidcAuthError, OidcSettings, OidcVerifier, auth_mode

# Re-exported so existing callers (app/main.py, tests/test_okta_auth.py)
# keep working unchanged — this module used to define these itself.
OktaAuthError = OidcAuthError
OktaVerifier = OidcVerifier

__all__ = ["OktaAuthError", "OktaVerifier", "auth_mode", "load_okta_settings"]


def load_okta_settings() -> Optional[OidcSettings]:
    """
    Read OKTA_ISSUER / OKTA_CLIENT_ID / OKTA_AUDIENCE / OKTA_ADMIN_GROUP from
    the environment. Returns None if either of the two REQUIRED variables
    (OKTA_ISSUER, OKTA_CLIENT_ID) is blank — main.py treats that exactly like
    "AUTH_MODE=okta but Okta isn't configured yet" and fails closed (see its
    own boot-time log message), the same shape of fail-safe auth_guard
    already applies when ADMIN_KEY is unset.

    OKTA_AUDIENCE defaults to OKTA_CLIENT_ID when unset — the common case for
    a single-page app's own access token, where the app IS the audience. Set
    it explicitly only if your org's authorization server issues tokens with
    a distinct audience (e.g. a custom API identifier like "api://default").

    OKTA_ADMIN_GROUP defaults to blank, meaning "nobody is granted admin" —
    see oidc.py's OidcVerifier.is_admin() on why a missing group name fails
    closed rather than defaulting to "everyone is admin".

    jwks_uri is Okta's standard published-keys endpoint, always at this
    fixed path under the issuer for both an org authorization server
    (https://{yourOrg}.okta.com/oauth2/default) and a custom one.
    """
    issuer = os.getenv("OKTA_ISSUER", "").strip().rstrip("/")
    client_id = os.getenv("OKTA_CLIENT_ID", "").strip()
    if not issuer or not client_id:
        return None
    audience = os.getenv("OKTA_AUDIENCE", "").strip() or client_id
    admin_group = os.getenv("OKTA_ADMIN_GROUP", "").strip()
    return OidcSettings(
        issuer=issuer,
        client_id=client_id,
        audience=audience,
        jwks_uri=f"{issuer}/v1/keys",
        admin_claim_type="groups",
        admin_claim_value=admin_group,
    )
