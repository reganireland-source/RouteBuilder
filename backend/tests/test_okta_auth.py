"""
Okta-specific settings loading (app/auth/okta.py's load_okta_settings()).

The actual JWT/JWKS verification logic (OktaVerifier, an alias of the
provider-agnostic OidcVerifier) is tested once, generically, in
test_oidc.py — that module has no notion of "Okta" at all, and duplicating
its coverage here per provider would only mean two places to update every
time a verification edge case is found. This file tests exactly the part
that IS Okta-specific: reading OKTA_* environment variables into an
OidcSettings shaped the way Okta needs (jwks_uri = issuer + "/v1/keys",
admin_claim_type = "groups").

Run with:  pytest backend/tests/test_okta_auth.py -v
"""
from app.auth.okta import load_okta_settings

ISSUER = "https://example.okta.com/oauth2/default"
CLIENT_ID = "0oaExampleClientId"
ADMIN_GROUP = "RouteBuilder-Admins"


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
    assert settings.admin_claim_type == "groups"
    assert settings.admin_claim_value == ""  # defaults to blank — fails closed, see oidc.py


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


def test_admin_group_env_var_becomes_the_admin_claim_value(monkeypatch):
    monkeypatch.setenv("OKTA_ISSUER", ISSUER)
    monkeypatch.setenv("OKTA_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("OKTA_ADMIN_GROUP", ADMIN_GROUP)
    assert load_okta_settings().admin_claim_value == ADMIN_GROUP
