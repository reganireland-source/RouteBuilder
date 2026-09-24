"""
Entra ID-specific settings loading (app/auth/entra.py's load_entra_settings()).

The actual JWT/JWKS verification logic (OidcVerifier) is tested once,
generically, in test_oidc.py — including its "roles" claim shape, which is
exactly what Entra ID's App Roles produce. This file tests only what's
specific to this module: reading ENTRA_* environment variables into an
OidcSettings shaped the way Entra ID needs (issuer/jwks_uri derived from a
tenant id, admin_claim_type = "roles").

Run with:  pytest backend/tests/test_entra_auth.py -v
"""
from app.auth.entra import load_entra_settings

TENANT_ID = "11111111-2222-3333-4444-555555555555"
CLIENT_ID = "66666666-7777-8888-9999-000000000000"
ADMIN_ROLE = "Admin"


def test_both_required_vars_present_returns_settings(monkeypatch):
    monkeypatch.setenv("ENTRA_TENANT_ID", TENANT_ID)
    monkeypatch.setenv("ENTRA_CLIENT_ID", CLIENT_ID)
    monkeypatch.delenv("ENTRA_AUDIENCE", raising=False)
    monkeypatch.delenv("ENTRA_ADMIN_ROLE", raising=False)
    settings = load_entra_settings()
    assert settings is not None
    assert settings.issuer == f"https://login.microsoftonline.com/{TENANT_ID}/v2.0"
    assert settings.client_id == CLIENT_ID
    assert settings.audience == CLIENT_ID  # defaults to client_id
    assert settings.admin_claim_type == "roles"
    assert settings.admin_claim_value == ""  # defaults to blank — fails closed, see oidc.py


def test_missing_tenant_id_returns_none(monkeypatch):
    monkeypatch.delenv("ENTRA_TENANT_ID", raising=False)
    monkeypatch.setenv("ENTRA_CLIENT_ID", CLIENT_ID)
    assert load_entra_settings() is None


def test_missing_client_id_returns_none(monkeypatch):
    monkeypatch.setenv("ENTRA_TENANT_ID", TENANT_ID)
    monkeypatch.delenv("ENTRA_CLIENT_ID", raising=False)
    assert load_entra_settings() is None


def test_explicit_audience_overrides_the_client_id_default(monkeypatch):
    monkeypatch.setenv("ENTRA_TENANT_ID", TENANT_ID)
    monkeypatch.setenv("ENTRA_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("ENTRA_AUDIENCE", f"api://{CLIENT_ID}")
    assert load_entra_settings().audience == f"api://{CLIENT_ID}"


def test_jwks_uri_is_the_tenant_discovery_endpoint_not_nested_under_the_issuer(monkeypatch):
    """The one shape difference from Okta this module's docstring calls out:
    the JWKS path is a sibling of /v2.0, not nested under it."""
    monkeypatch.setenv("ENTRA_TENANT_ID", TENANT_ID)
    monkeypatch.setenv("ENTRA_CLIENT_ID", CLIENT_ID)
    settings = load_entra_settings()
    assert settings.jwks_uri == f"https://login.microsoftonline.com/{TENANT_ID}/discovery/v2.0/keys"
    assert not settings.jwks_uri.startswith(settings.issuer)


def test_admin_role_env_var_becomes_the_admin_claim_value(monkeypatch):
    monkeypatch.setenv("ENTRA_TENANT_ID", TENANT_ID)
    monkeypatch.setenv("ENTRA_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("ENTRA_ADMIN_ROLE", ADMIN_ROLE)
    assert load_entra_settings().admin_claim_value == ADMIN_ROLE
