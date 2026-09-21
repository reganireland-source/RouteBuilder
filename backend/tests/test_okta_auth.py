"""
Verifying Okta-shaped bearer tokens without a real Okta tenant.

No live Okta org was available while building this (see app/auth/okta.py's
own module docstring on why that is by design, not an oversight). So instead
of pointing at a real issuer, every test here signs its own RS256 tokens with
a locally generated RSA key pair — standing in for Okta's signing key — and
feeds OktaVerifier a stub in place of the PyJWKClient it would normally use
to fetch that key from Okta over the network. This exercises the EXACT same
verify()/is_admin() code path a real token would hit; the one thing it
cannot prove is that a real Okta org's tokens are shaped the way these tests
assume (RS256, an `iss` matching the authorization server, a `groups` claim
once the claims-mapping step in docs/okta-setup.md is done) — that first
real login is IT's step to confirm, not something a unit test can stand in
for.

Run with:  pytest backend/tests/test_okta_auth.py -v
"""
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth.okta import OktaAuthError, OktaSettings, OktaVerifier, load_okta_settings

ISSUER = "https://example.okta.com/oauth2/default"
CLIENT_ID = "0oaExampleClientId"
ADMIN_GROUP = "RouteBuilder-Admins"


@pytest.fixture(scope="module")
def keypair():
    """One RSA key pair, generated once and reused across every test in this
    module — key generation is the slow part, and there is no reason to pay
    it per test."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


class _StubSigningKey:
    """Mimics the one attribute OktaVerifier.verify() actually reads off
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


def make_token(private_key, *, issuer=ISSUER, audience=CLIENT_ID, groups=None, expired=False, missing_exp=False):
    now = int(time.time())
    payload = {
        "iss": issuer,
        "aud": audience,
        "sub": "00uExampleUserId",
        "iat": now,
        "exp": now - 3600 if expired else now + 3600,
    }
    if missing_exp:
        del payload["exp"]
    if groups is not None:
        payload["groups"] = groups
    return jwt.encode(payload, private_key, algorithm="RS256", headers={"kid": "test-key-1"})


def make_verifier(public_key, *, admin_group=ADMIN_GROUP):
    settings = OktaSettings(issuer=ISSUER, client_id=CLIENT_ID, audience=CLIENT_ID, admin_group=admin_group)
    verifier = OktaVerifier.__new__(OktaVerifier)  # bypass __init__'s real PyJWKClient construction
    verifier._settings = settings
    verifier._jwk_client = _StubJwkClient(public_key)
    return verifier


# ── load_okta_settings() ──────────────────────────────────────────────────────

def test_both_required_vars_present_returns_settings(monkeypatch):
    monkeypatch.setenv("OKTA_ISSUER", ISSUER)
    monkeypatch.setenv("OKTA_CLIENT_ID", CLIENT_ID)
    monkeypatch.delenv("OKTA_AUDIENCE", raising=False)
    monkeypatch.delenv("OKTA_ADMIN_GROUP", raising=False)
    settings = load_okta_settings()
    assert settings is not None
    assert settings.issuer == ISSUER
    assert settings.client_id == CLIENT_ID
    assert settings.audience == CLIENT_ID  # defaults to client_id
    assert settings.admin_group == ""      # defaults to blank — fails closed, see is_admin()


def test_missing_issuer_returns_none(monkeypatch):
    monkeypatch.delenv("OKTA_ISSUER", raising=False)
    monkeypatch.setenv("OKTA_CLIENT_ID", CLIENT_ID)
    assert load_okta_settings() is None


def test_missing_client_id_returns_none(monkeypatch):
    monkeypatch.setenv("OKTA_ISSUER", ISSUER)
    monkeypatch.delenv("OKTA_CLIENT_ID", raising=False)
    assert load_okta_settings() is None


def test_a_trailing_slash_on_the_issuer_is_stripped(monkeypatch):
    monkeypatch.setenv("OKTA_ISSUER", ISSUER + "/")
    monkeypatch.setenv("OKTA_CLIENT_ID", CLIENT_ID)
    assert load_okta_settings().issuer == ISSUER


def test_explicit_audience_overrides_the_client_id_default(monkeypatch):
    monkeypatch.setenv("OKTA_ISSUER", ISSUER)
    monkeypatch.setenv("OKTA_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("OKTA_AUDIENCE", "api://default")
    assert load_okta_settings().audience == "api://default"


def test_jwks_uri_is_the_issuer_plus_v1_keys(monkeypatch):
    monkeypatch.setenv("OKTA_ISSUER", ISSUER)
    monkeypatch.setenv("OKTA_CLIENT_ID", CLIENT_ID)
    assert load_okta_settings().jwks_uri == f"{ISSUER}/v1/keys"


# ── OktaVerifier.verify() ─────────────────────────────────────────────────────

def test_a_genuine_token_verifies_and_returns_its_claims(keypair):
    private_key, public_key = keypair
    verifier = make_verifier(public_key)
    token = make_token(private_key, groups=[ADMIN_GROUP])
    claims = verifier.verify(token)
    assert claims["iss"] == ISSUER
    assert claims["aud"] == CLIENT_ID
    assert claims["groups"] == [ADMIN_GROUP]


def test_an_expired_token_is_rejected(keypair):
    private_key, public_key = keypair
    verifier = make_verifier(public_key)
    token = make_token(private_key, expired=True)
    with pytest.raises(OktaAuthError):
        verifier.verify(token)


def test_wrong_issuer_is_rejected(keypair):
    private_key, public_key = keypair
    verifier = make_verifier(public_key)
    token = make_token(private_key, issuer="https://attacker.example.com/oauth2/default")
    with pytest.raises(OktaAuthError):
        verifier.verify(token)


def test_wrong_audience_is_rejected(keypair):
    private_key, public_key = keypair
    verifier = make_verifier(public_key)
    token = make_token(private_key, audience="some-other-client-id")
    with pytest.raises(OktaAuthError):
        verifier.verify(token)


def test_a_token_missing_the_expiry_claim_is_rejected(keypair):
    private_key, public_key = keypair
    verifier = make_verifier(public_key)
    token = make_token(private_key, missing_exp=True)
    with pytest.raises(OktaAuthError):
        verifier.verify(token)


def test_a_token_signed_with_a_different_key_is_rejected(keypair):
    """The defining case: a forged/stolen-signing-key scenario. Sign with a
    SECOND, unrelated key pair, but verify against the first key pair's
    public key — the mismatch must be caught by signature verification."""
    _first_private, first_public = keypair
    other_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    verifier = make_verifier(first_public)
    token = make_token(other_private_key)
    with pytest.raises(OktaAuthError):
        verifier.verify(token)


def test_a_malformed_token_is_rejected_not_raised_as_something_else(keypair):
    _private_key, public_key = keypair
    verifier = make_verifier(public_key)
    with pytest.raises(OktaAuthError):
        verifier.verify("not-a-real-jwt-at-all")


# ── OktaVerifier.is_admin() ───────────────────────────────────────────────────

def test_membership_in_the_configured_admin_group_grants_admin(keypair):
    _private_key, public_key = keypair
    verifier = make_verifier(public_key, admin_group=ADMIN_GROUP)
    assert verifier.is_admin({"groups": [ADMIN_GROUP, "Everyone"]}) is True


def test_membership_in_other_groups_only_does_not_grant_admin(keypair):
    _private_key, public_key = keypair
    verifier = make_verifier(public_key, admin_group=ADMIN_GROUP)
    assert verifier.is_admin({"groups": ["Everyone", "Some-Other-Team"]}) is False


def test_a_token_with_no_groups_claim_at_all_does_not_grant_admin(keypair):
    """The claims-mapping-not-configured-in-Okta case (see module docstring)
    — must read as read-only, not crash and not silently grant admin."""
    _private_key, public_key = keypair
    verifier = make_verifier(public_key, admin_group=ADMIN_GROUP)
    assert verifier.is_admin({}) is False


def test_an_unconfigured_admin_group_fails_closed_for_everyone(keypair):
    """OKTA_ADMIN_GROUP left blank must not mean 'everyone is admin' — see
    both this module's and okta.py's own reasoning on failing closed."""
    _private_key, public_key = keypair
    verifier = make_verifier(public_key, admin_group="")
    assert verifier.is_admin({"groups": [ADMIN_GROUP]}) is False
