"""
Verifying the provider-agnostic OIDC bearer-token logic (app/auth/oidc.py)
that both app/auth/okta.py and app/auth/entra.py build on.

No live identity provider was available while building this — see
app/auth/oidc.py's own module docstring. So instead of pointing at a real
issuer, every test here signs its own RS256 tokens with a locally generated
RSA key pair — standing in for a provider's signing key — and feeds
OidcVerifier a stub in place of the PyJWKClient it would normally use to
fetch that key over the network. This exercises the EXACT same
verify()/is_admin() code path a real token would hit, for either provider
shape (a "groups" claim like Okta's, or a "roles" claim like Entra ID's App
Roles) since OidcVerifier itself has no notion of which provider it's
verifying for — see test_okta_auth.py / test_entra_auth.py for the
provider-specific settings-loading tests this one doesn't duplicate.

Run with:  pytest backend/tests/test_oidc.py -v
"""
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth.oidc import OidcAuthError, OidcSettings, OidcVerifier, auth_mode

ISSUER = "https://example-provider.test/issuer"
CLIENT_ID = "example-client-id"
ADMIN_VALUE = "RouteBuilder-Admins"


@pytest.fixture(scope="module")
def keypair():
    """One RSA key pair, generated once and reused across every test in this
    module — key generation is the slow part, and there is no reason to pay
    it per test."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


class _StubSigningKey:
    """Mimics the one attribute OidcVerifier.verify() actually reads off
    whatever PyJWKClient.get_signing_key_from_jwt() returns."""
    def __init__(self, key):
        self.key = key


class _StubJwkClient:
    """Stands in for PyJWKClient: hands back the TEST public key regardless
    of the token's own `kid`, so nothing here ever makes a network call."""
    def __init__(self, public_key):
        self._public_key = public_key

    def get_signing_key_from_jwt(self, token):  # noqa: ARG002 — matches PyJWKClient's signature
        return _StubSigningKey(self._public_key)


def make_token(private_key, *, issuer=ISSUER, audience=CLIENT_ID, claims=None, expired=False, missing_exp=False):
    now = int(time.time())
    payload = {
        "iss": issuer,
        "aud": audience,
        "sub": "example-user-id",
        "iat": now,
        "exp": now - 3600 if expired else now + 3600,
    }
    if missing_exp:
        del payload["exp"]
    if claims:
        payload.update(claims)
    return jwt.encode(payload, private_key, algorithm="RS256", headers={"kid": "test-key-1"})


def make_verifier(public_key, *, admin_claim_type="groups", admin_claim_value=ADMIN_VALUE):
    settings = OidcSettings(
        issuer=ISSUER, client_id=CLIENT_ID, audience=CLIENT_ID,
        jwks_uri=f"{ISSUER}/keys",
        admin_claim_type=admin_claim_type, admin_claim_value=admin_claim_value,
    )
    verifier = OidcVerifier.__new__(OidcVerifier)  # bypass __init__'s real PyJWKClient construction
    verifier._settings = settings
    verifier._jwk_client = _StubJwkClient(public_key)
    return verifier


# ── auth_mode() ────────────────────────────────────────────────────────────

def test_default_is_admin_key(monkeypatch):
    monkeypatch.delenv("AUTH_MODE", raising=False)
    assert auth_mode() == "admin_key"


def test_okta_selects_okta_mode(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "okta")
    assert auth_mode() == "okta"


def test_entra_selects_entra_mode(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "entra")
    assert auth_mode() == "entra"


def test_case_insensitive(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "ENTRA")
    assert auth_mode() == "entra"


def test_a_typo_falls_back_to_admin_key(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "azure")
    assert auth_mode() == "admin_key"


# ── OidcVerifier.verify() ────────────────────────────────────────────────────

def test_a_genuine_token_verifies_and_returns_its_claims(keypair):
    private_key, public_key = keypair
    verifier = make_verifier(public_key)
    token = make_token(private_key, claims={"groups": [ADMIN_VALUE]})
    claims = verifier.verify(token)
    assert claims["iss"] == ISSUER
    assert claims["aud"] == CLIENT_ID
    assert claims["groups"] == [ADMIN_VALUE]


def test_an_expired_token_is_rejected(keypair):
    private_key, public_key = keypair
    verifier = make_verifier(public_key)
    token = make_token(private_key, expired=True)
    with pytest.raises(OidcAuthError):
        verifier.verify(token)


def test_wrong_issuer_is_rejected(keypair):
    private_key, public_key = keypair
    verifier = make_verifier(public_key)
    token = make_token(private_key, issuer="https://attacker.example.com/issuer")
    with pytest.raises(OidcAuthError):
        verifier.verify(token)


def test_wrong_audience_is_rejected(keypair):
    private_key, public_key = keypair
    verifier = make_verifier(public_key)
    token = make_token(private_key, audience="some-other-client-id")
    with pytest.raises(OidcAuthError):
        verifier.verify(token)


def test_a_token_missing_the_expiry_claim_is_rejected(keypair):
    private_key, public_key = keypair
    verifier = make_verifier(public_key)
    token = make_token(private_key, missing_exp=True)
    with pytest.raises(OidcAuthError):
        verifier.verify(token)


def test_a_token_signed_with_a_different_key_is_rejected(keypair):
    """The defining case: a forged/stolen-signing-key scenario. Sign with a
    SECOND, unrelated key pair, but verify against the first key pair's
    public key — the mismatch must be caught by signature verification."""
    _first_private, first_public = keypair
    other_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    verifier = make_verifier(first_public)
    token = make_token(other_private_key)
    with pytest.raises(OidcAuthError):
        verifier.verify(token)


def test_a_malformed_token_is_rejected_not_raised_as_something_else(keypair):
    _private_key, public_key = keypair
    verifier = make_verifier(public_key)
    with pytest.raises(OidcAuthError):
        verifier.verify("not-a-real-jwt-at-all")


# ── OidcVerifier.is_admin() — groups-claim shape (Okta's) ───────────────────

def test_membership_in_the_configured_admin_group_grants_admin(keypair):
    _private_key, public_key = keypair
    verifier = make_verifier(public_key, admin_claim_type="groups", admin_claim_value=ADMIN_VALUE)
    assert verifier.is_admin({"groups": [ADMIN_VALUE, "Everyone"]}) is True


def test_membership_in_other_groups_only_does_not_grant_admin(keypair):
    _private_key, public_key = keypair
    verifier = make_verifier(public_key, admin_claim_type="groups", admin_claim_value=ADMIN_VALUE)
    assert verifier.is_admin({"groups": ["Everyone", "Some-Other-Team"]}) is False


def test_a_token_with_no_groups_claim_at_all_does_not_grant_admin(keypair):
    """The claims-mapping-not-configured case (see module docstring) — must
    read as read-only, not crash and not silently grant admin."""
    _private_key, public_key = keypair
    verifier = make_verifier(public_key, admin_claim_type="groups", admin_claim_value=ADMIN_VALUE)
    assert verifier.is_admin({}) is False


# ── OidcVerifier.is_admin() — roles-claim shape (Entra ID's App Roles) ──────

def test_the_configured_admin_role_grants_admin(keypair):
    _private_key, public_key = keypair
    verifier = make_verifier(public_key, admin_claim_type="roles", admin_claim_value="Admin")
    assert verifier.is_admin({"roles": ["Admin", "Viewer"]}) is True


def test_other_roles_only_does_not_grant_admin(keypair):
    _private_key, public_key = keypair
    verifier = make_verifier(public_key, admin_claim_type="roles", admin_claim_value="Admin")
    assert verifier.is_admin({"roles": ["Viewer"]}) is False


def test_a_token_with_no_roles_claim_at_all_does_not_grant_admin(keypair):
    _private_key, public_key = keypair
    verifier = make_verifier(public_key, admin_claim_type="roles", admin_claim_value="Admin")
    assert verifier.is_admin({}) is False


# ── OidcVerifier.is_admin() — fails closed regardless of claim type ────────

def test_an_unconfigured_admin_value_fails_closed_for_everyone(keypair):
    """A blank admin_claim_value must not mean 'everyone is admin' — see
    oidc.py's own reasoning on failing closed."""
    _private_key, public_key = keypair
    verifier = make_verifier(public_key, admin_claim_type="groups", admin_claim_value="")
    assert verifier.is_admin({"groups": [ADMIN_VALUE]}) is False
