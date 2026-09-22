"""
auth/oidc.py — provider-agnostic OIDC bearer-token verification.

WHY THIS EXISTS. Okta and Microsoft Entra ID (and any other OIDC identity
provider) are verified the same way underneath: a JWT, RSA-signed, checkable
against the issuer's own published JWKS, with no provider-specific logic
beyond WHERE those keys live and WHICH claim in the token says "this person
is an admin". Everything else — signature check, issuer/audience/expiry
enforcement, algorithm pinning against alg-confusion attacks, the
JWKS-caching-per-process shape, failing closed when the admin claim is
unconfigured — is pure OIDC. This module carries that ONCE; app/auth/okta.py
and app/auth/entra.py each supply only what's genuinely provider-specific:
where the issuer/JWKS live, and whether "admin" comes from a `groups` claim
or a `roles` claim. (This module used to be Okta-specific, named after it;
adding Entra ID as a second provider was the point at which duplicating
~90% of it stopped making sense — see the git history on app/auth/okta.py
if you want the original, single-provider version.)

WHY OIDC ACCESS TOKENS, NOT ID TOKENS. An OIDC login issues two JWTs: an ID
token (who you are, meant for the CLIENT to read) and an access token (meant
for an API — this backend — to accept as proof of a valid session). The
frontend sends the access token as `Authorization: Bearer <token>` on every
request; this module never sees the ID token at all.

WHY THE ADMIN CLAIM MUST BE CONFIGURED ON THE PROVIDER, NOT ASSUMED. Neither
Okta nor Entra ID includes group/role membership in an access token by
default — an org has to explicitly add it (Okta: a "groups" claim on the
Authorization Server; Entra ID: an App Role, assigned to a group/user — see
docs/okta-setup.md / docs/entra-setup.md). If that step is skipped, every
decoded token simply has no matching claim, and is_admin() below treats that
exactly like "not an admin" — a misconfiguration reads as "everyone is
read-only", never as "everyone is admin". This mirrors admin_write_guard's
own existing rule that an absent or misconfigured credential must fail
CLOSED, not open.

WHY ONE VERIFIER INSTANCE PER PROCESS. PyJWKClient caches the provider's
public signing keys after the first fetch and re-fetches automatically when
it sees a `kid` (key id) it has not cached — the standard way a JWKS
consumer rides out a key rotation without a manual TTL or a restart.
Constructing a fresh PyJWKClient per request would throw that cache away
every time, turning every single request into a network round-trip to the
identity provider. main.py builds exactly one verifier per configured
provider at import time and reuses it for the life of the process.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

import jwt
from jwt import PyJWKClient

#: Both Okta and Entra ID access tokens are always RSA-signed (RS256) — there
#: is no configuration option on either provider's side that changes this,
#: so unlike a general-purpose JWT library this does not need to negotiate
#: algorithms with the token. Pinning it also closes off the classic JWT
#: "alg confusion" attack, where a token crafted with alg=none or alg=HS256
#: (using the PUBLIC key as an HMAC secret) tricks a permissive verifier
#: into accepting a forged token.
ALGORITHMS = ["RS256"]

#: Which claim in the token carries admin-eligible values: Okta's own
#: "groups" claim, or Entra ID's "roles" claim (App Roles — Microsoft's
#: documented RBAC pattern, and the one that avoids Entra's "group overage"
#: limitation, where a user in 200+ groups gets no real groups claim at all).
AdminClaimType = Literal["groups", "roles"]


def auth_mode() -> str:
    """
    "admin_key" (default, one shared secret, gates writes only), "okta", or
    "entra" (either SSO mode: every request needs a valid session; write
    methods additionally need the configured admin group/role). Lives here
    rather than in main.py so that app/api/auth.py's /config endpoint can
    read the same answer without importing from main.py, which would be
    circular (main.py imports THAT router). An organisation switches by
    setting AUTH_MODE on the backend AND VITE_AUTH_MODE on the frontend
    build to the same value; see docs/okta-setup.md / docs/entra-setup.md.

    Anything other than exactly "okta" or "entra" is treated as admin_key
    mode — a typo here (e.g. "Okta", "OKTA", "azure") must fall back to the
    existing, already-understood model rather than silently doing neither.
    """
    value = os.getenv("AUTH_MODE", "").strip().lower()
    return value if value in ("okta", "entra") else "admin_key"


class OidcAuthError(Exception):
    """A bearer token failed verification: missing, malformed, badly signed,
    wrong issuer/audience, or expired. Deliberately one exception type for
    all of these — see OidcVerifier.verify()'s docstring for why — which
    main.py turns into a 401 (you are not currently identified), never a 403
    (you are identified but not allowed; that distinction is is_admin()'s
    job, applied only after verify() has already succeeded)."""


@dataclass(frozen=True)
class OidcSettings:
    """Everything one OIDC verifier needs, already resolved to concrete
    URLs/values by the provider-specific loader (okta.py's
    load_okta_settings() / entra.py's load_entra_settings()) — this
    dataclass itself has no notion of which provider it came from.

    `jwks_uri` is a plain field, not derived here, because Okta and Entra ID
    compute it differently: Okta's is always `{issuer}/v1/keys`; Entra ID's
    is tenant-specific and lives under `/discovery/v2.0/keys`, not under the
    issuer path at all.
    """
    issuer: str
    client_id: str
    audience: str
    jwks_uri: str
    admin_claim_type: AdminClaimType
    admin_claim_value: str


class OidcVerifier:
    """Verifies bearer tokens against one identity provider's published
    signing keys. See the module docstring for the caching rationale behind
    keeping one instance alive for the whole process."""

    def __init__(self, settings: OidcSettings):
        self._settings = settings
        self._jwk_client = PyJWKClient(settings.jwks_uri, cache_keys=True)

    def verify(self, token: str) -> dict:
        """
        Decode and fully verify one bearer token, returning its claims.

        Checks, in order: the signature (against the provider's own
        published key matching the token's `kid`), issuer, audience, and
        expiry — all four are REQUIRED to be present and correct; PyJWT
        rejects a token missing any of them via `options={"require": [...]}`.
        Any failure — of any of these, individually or however combined —
        raises OidcAuthError and nothing else, on purpose: a caller that
        branched on "well the signature was fine, only the audience was
        wrong" would be one step away from writing security logic around
        which failure mode is "less bad", which is exactly the kind of
        reasoning that goes wrong first. There is exactly one thing calling
        code should ever conclude from a caught OidcAuthError: this token
        does not currently prove anything, full stop.
        """
        try:
            signing_key = self._jwk_client.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=ALGORITHMS,
                audience=self._settings.audience,
                issuer=self._settings.issuer,
                options={"require": ["exp", "iss", "aud"]},
            )
        except Exception as exc:
            raise OidcAuthError(str(exc)) from exc
        return claims

    def is_admin(self, claims: dict) -> bool:
        """
        True when the token's admin claim (groups for Okta, roles for
        Entra ID — see AdminClaimType) contains the configured admin
        value. Fails closed in both directions that matter:

          - The admin value is unset (both load_*_settings() functions
            default it to "") → always False. An org that has not yet
            decided which group/role means "admin" gets a read-only app
            for everyone, not an all-admin one.
          - The provider has no matching claim mapping configured (a real,
            easy-to-forget admin-console step on either provider — see
            docs/okta-setup.md / docs/entra-setup.md) → claims.get(...) is
            simply absent, which reads as "member of nothing", not as an
            error to surface differently. A misconfigured claims mapping
            and a genuinely non-admin user are indistinguishable from here,
            and that is the correct call: both should be read-only.
        """
        if not self._settings.admin_claim_value:
            return False
        values = claims.get(self._settings.admin_claim_type) or []
        return self._settings.admin_claim_value in values
