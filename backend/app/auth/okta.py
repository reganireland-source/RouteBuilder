"""
auth/okta.py — verify Okta-issued OIDC access tokens.

WHY THIS EXISTS. The app's only auth model today is a single shared secret
(ADMIN_KEY, see app/api/auth.py and main.py's admin_write_guard) — one
passphrase, gating writes only, with no concept of individual identity. An
organisation running Okta wants the opposite: every visitor signs in as
themselves, and what they can do is decided by which Okta group they belong
to, not by who else has been told a shared password. This module is the
verification half of that — given a bearer token a browser sends, decide
whether it is a genuine, current Okta access token and who it belongs to.
main.py's auth_guard middleware is the enforcement half: it decides WHEN to
call this and what to do with the answer.

SCAFFOLDING, NOT A FINISHED INTEGRATION. This was built without access to a
real Okta tenant (by design — an org's Okta client credentials should never
be pasted into a chat session). Every function here is unit-tested against a
self-signed RSA key pair standing in for Okta's own signing keys (see
tests/test_okta_auth.py), which exercises the exact same code path a real
token would hit, but the one thing that cannot be verified from here is "does
this actually work against a live Okta org" — that is the one step your IT
team has to do, following docs/okta-setup.md.

WHY OIDC ACCESS TOKENS, NOT ID TOKENS. Okta issues two JWTs on login: an ID
token (who you are, meant for the CLIENT to read) and an access token (meant
for an API to accept as proof of a valid session, which is exactly this
backend's job). The frontend sends the access token as `Authorization: Bearer
<token>` on every request; this module never sees the ID token at all.

WHY THE GROUPS CLAIM MUST BE ADDED IN OKTA, NOT ASSUMED. Okta does not
include group membership in an access token by default — an org has to add
a "groups" claim to its Authorization Server's token policy (documented in
docs/okta-setup.md, one of the handful of steps IT has to do by hand). If
that step is skipped, every decoded token simply has no `groups` claim, and
is_admin() below treats that exactly like "not in the admin group" — a
misconfiguration reads as "everyone is read-only", never as "everyone is
admin". This mirrors admin_write_guard's own existing rule that an absent or
misconfigured credential must fail CLOSED, not open.

WHY ONE VERIFIER INSTANCE PER PROCESS. PyJWKClient caches Okta's public
signing keys after the first fetch and re-fetches automatically when it sees
a `kid` (key id) it has not cached — the standard way a JWKS consumer rides
out a key rotation without a manual TTL or a restart. Constructing a fresh
PyJWKClient per request would throw that cache away every time, turning every
single request into a network round-trip to Okta. main.py builds exactly one
OktaVerifier at import time and reuses it for the life of the process.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import jwt
from jwt import PyJWKClient

def auth_mode() -> str:
    """
    "admin_key" (default, one shared secret, gates writes only) or "okta"
    (every request needs a valid Okta session; write methods additionally
    need the configured admin group). Lives here rather than in main.py so
    that app/api/auth.py's /config endpoint can read the same answer without
    importing from main.py, which would be circular (main.py imports THAT
    router). An organisation switches by setting AUTH_MODE on the backend
    AND VITE_AUTH_MODE on the frontend build to the same value; see
    docs/okta-setup.md.

    Anything other than exactly "okta" is treated as admin_key mode — a typo
    here (e.g. "Okta", "OKTA") must fall back to the existing, already-
    understood model rather than silently doing neither.
    """
    return "okta" if os.getenv("AUTH_MODE", "").strip().lower() == "okta" else "admin_key"


#: Okta access tokens are always RSA-signed (RS256) — there is no
#: configuration option on Okta's side that changes this, so unlike a
#: general-purpose JWT library this does not need to negotiate algorithms
#: with the token. Pinning it also closes off the classic JWT "alg
#: confusion" attack, where a token crafted with alg=none or alg=HS256
#: (using the PUBLIC key as an HMAC secret) tricks a permissive verifier
#: into accepting a forged token.
ALGORITHMS = ["RS256"]


class OktaAuthError(Exception):
    """A bearer token failed verification: missing, malformed, badly signed,
    wrong issuer/audience, or expired. Deliberately one exception type for
    all of these — see OktaVerifier.verify()'s docstring for why — which
    main.py turns into a 401 (you are not currently identified), never a 403
    (you are identified but not allowed; that distinction is is_admin()'s
    job, applied only after verify() has already succeeded)."""


@dataclass(frozen=True)
class OktaSettings:
    """Everything read from OKTA_* environment variables. Frozen/immutable —
    passed into OktaVerifier once at startup, never mutated."""
    issuer: str
    client_id: str
    audience: str
    admin_group: str

    @property
    def jwks_uri(self) -> str:
        """Okta's standard published-keys endpoint, always at this fixed
        path under the issuer for both an org authorization server
        (https://{yourOrg}.okta.com/oauth2/default) and a custom one."""
        return f"{self.issuer}/v1/keys"


def load_okta_settings() -> Optional[OktaSettings]:
    """
    Read OKTA_ISSUER / OKTA_CLIENT_ID / OKTA_AUDIENCE / OKTA_ADMIN_GROUP from
    the environment. Returns None if either of the two REQUIRED variables
    (OKTA_ISSUER, OKTA_CLIENT_ID) is blank — main.py treats that exactly like
    "AUTH_MODE=okta but Okta isn't configured yet" and fails closed (see its
    own boot-time log message), the same shape of fail-safe admin_write_guard
    already applies when ADMIN_KEY is unset.

    OKTA_AUDIENCE defaults to OKTA_CLIENT_ID when unset — the common case for
    a single-page app's own access token, where the app IS the audience. Set
    it explicitly only if your org's authorization server issues tokens with
    a distinct audience (e.g. a custom API identifier like "api://default").

    OKTA_ADMIN_GROUP defaults to blank, meaning "nobody is granted admin" —
    see this module's own docstring on why a missing group name fails closed
    rather than defaulting to "everyone is admin".
    """
    issuer = os.getenv("OKTA_ISSUER", "").strip().rstrip("/")
    client_id = os.getenv("OKTA_CLIENT_ID", "").strip()
    if not issuer or not client_id:
        return None
    audience = os.getenv("OKTA_AUDIENCE", "").strip() or client_id
    admin_group = os.getenv("OKTA_ADMIN_GROUP", "").strip()
    return OktaSettings(issuer=issuer, client_id=client_id, audience=audience, admin_group=admin_group)


class OktaVerifier:
    """Verifies bearer tokens against one Okta authorization server's
    published signing keys. See the module docstring for the caching
    rationale behind keeping one instance alive for the whole process."""

    def __init__(self, settings: OktaSettings):
        self._settings = settings
        self._jwk_client = PyJWKClient(settings.jwks_uri, cache_keys=True)

    def verify(self, token: str) -> dict:
        """
        Decode and fully verify one bearer token, returning its claims.

        Checks, in order: the signature (against Okta's own published key
        matching the token's `kid`), issuer, audience, and expiry — all four
        are REQUIRED to be present and correct; PyJWT rejects a token
        missing any of them via `options={"require": [...]}`. Any failure —
        of any of these, individually or however combined — raises
        OktaAuthError and nothing else, on purpose: a caller that branched on
        "well the signature was fine, only the audience was wrong" would be
        one step away from writing security logic around which failure mode
        is "less bad", which is exactly the kind of reasoning that goes wrong
        first. There is exactly one thing calling code should ever conclude
        from a caught OktaAuthError: this token does not currently prove
        anything, full stop.
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
            raise OktaAuthError(str(exc)) from exc
        return claims

    def is_admin(self, claims: dict) -> bool:
        """
        True when the token's `groups` claim contains the configured admin
        group. Fails closed in both directions that matter:

          - OKTA_ADMIN_GROUP unset (load_okta_settings() defaults it to "")
            → always False. An org that has not yet decided which Okta
            group means "admin" gets a read-only app for everyone, not an
            all-admin one.
          - The org's Authorization Server has no "groups" claim mapping
            configured (a real, easy-to-forget Okta admin-console step —
            see docs/okta-setup.md) → claims.get("groups") is simply absent,
            which reads as "member of no groups", not as an error to
            surface differently. A misconfigured claims mapping and a
            genuinely non-admin user are indistinguishable from here, and
            that is the correct call: both should be read-only.
        """
        if not self._settings.admin_group:
            return False
        groups = claims.get("groups") or []
        return self._settings.admin_group in groups
