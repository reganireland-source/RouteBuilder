# ─────────────────────────────────────────────────────────────────────────────
# shiptracker/sources.py — polled (REST) AIS position providers.
#
# Each adapter answers one question: "latest position for these MMSIs". The
# hub (hub.py) decides when to ask and merges the answers with any other
# source. Adapters are deliberately small and synchronous (called in a worker
# thread): stdlib urllib, an explicit timeout, the scheme allowlist and
# User-Agent convention from hazards/sources.py, and a module-local
# SourceError whose message is safe to show a user (never contains the key).
#
# To add a provider: subclass PollAdapter, fill `meta`, implement
# `_fetch_one` (or override `fetch` for a batch endpoint), and register it in
# POLL_ADAPTERS. Its key comes from the env var named in meta["env_key"].
# ─────────────────────────────────────────────────────────────────────────────
import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

from ..models import TrackedShipLive

log = logging.getLogger("routebuilder.shiptracker")

_UA_CONTACT = os.getenv("OUTBOUND_UA_CONTACT", "").strip()
USER_AGENT = "RouteBuilder/1.0 (subsea network planning" + (f"; +{_UA_CONTACT}" if _UA_CONTACT else "") + ")"
_TIMEOUT = 15.0


class SourceError(Exception):
    """A provider call failed. The message is user-facing and key-free."""


def get_json(url: str, headers: Optional[dict] = None, redact: str = "") -> object:
    """GET `url` as JSON. Raises SourceError with the key redacted."""
    if urllib.parse.urlparse(url).scheme != "https":
        raise SourceError("Refusing non-HTTPS provider URL")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json", **(headers or {})})  # noqa: S310
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:  # noqa: S310 — https enforced above
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = _error_message(exc.read().decode("utf-8", "replace"))
        except Exception:  # noqa: BLE001
            pass
        msg = f"HTTP {exc.code}" + (f": {body}" if body else "")
        raise SourceError(msg.replace(redact, "***") if redact else msg) from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SourceError(f"Unreachable: {getattr(exc, 'reason', exc)}") from None
    except json.JSONDecodeError:
        raise SourceError("Provider returned non-JSON") from None


def _error_message(body: str) -> str:
    """The human-readable part of a provider's error body: a JSON
    "message" (top level or under "error"), else the raw text, trimmed."""
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return body.strip()[:200]
    if isinstance(data, dict):
        err = data.get("error")
        for candidate in (data.get("message"), err.get("message") if isinstance(err, dict) else err):
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()[:200]
    return body.strip()[:200]


def num(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f


def valid_lat_lon(lat, lon) -> bool:
    lat, lon = num(lat), num(lon)
    return lat is not None and lon is not None and -90 <= lat <= 90 and -180 <= lon <= 180 and not (lat == 0 and lon == 0)


class PollAdapter:
    #: label, env_key, coverage, pricing — shown in the source picker.
    #: free: usable at no cost (within its allowance).
    #: free_calls_per_month: default monthly call budget (the free tier);
    #:   None = unlimited. Admins can change it in the Sources panel.
    #: min_spacing_s / max_burst: the free tier's rate limit, applied while
    #:   a budget is set.
    meta: dict = {}

    def api_key(self) -> str:
        return os.getenv(self.meta["env_key"], "").strip()

    def configured(self) -> bool:
        return bool(self.api_key())

    def fetch(self, mmsis: list[str]) -> dict[str, TrackedShipLive]:
        """Latest fix per MMSI; ships the provider has no position for are
        simply absent. Raises SourceError only if the provider itself failed."""
        out: dict[str, TrackedShipLive] = {}
        errors: list[str] = []
        for mmsi in mmsis:
            try:
                live = self._fetch_one(mmsi)
            except SourceError as exc:
                errors.append(str(exc))
                continue
            if live is not None:
                out[mmsi] = live
        if errors and not out and len(errors) == len(mmsis):
            raise SourceError(errors[0])
        return out

    def _fetch_one(self, mmsi: str) -> Optional[TrackedShipLive]:
        raise NotImplementedError


#: Registered polled providers, by id. Populated below.
POLL_ADAPTERS: dict[str, PollAdapter] = {}


def iso_utc(value) -> Optional[str]:
    """Normalise a provider timestamp (ISO string, "YYYY-MM-DD HH:MM:SS",
    or epoch seconds) to ISO 8601 UTC with a Z, or None if unparseable."""
    from datetime import UTC, datetime
    if value is None or value == "":
        return None
    try:
        if isinstance(value, (int, float)) or (isinstance(value, str) and value.isdigit()):
            dt = datetime.fromtimestamp(float(value), UTC)
        else:
            s = str(value).strip().replace(" UTC", "").replace("Z", "+00:00")
            if " " in s and "T" not in s:
                s = s.replace(" ", "T", 1)
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (ValueError, OverflowError, OSError):
        return None


def heading_or_none(v) -> Optional[int]:
    h = num(v)
    return int(h) if h is not None and 0 <= h < 360 else None   # 511 = "not available" in AIS


class VesselApiAdapter(PollAdapter):
    """VesselAPI — https://vesselapi.com/docs/vessels. One GET per ship,
    Bearer auth. Terrestrial by default; satellite fixes are an opt-in paid
    extra (VESSELAPI_USE_SATELLITE=true), charged per new satellite fix."""
    meta = {
        "label": "VesselAPI",
        "env_key": "VESSELAPI_API_KEY",
        "coverage": "Terrestrial AIS, plus optional pay-per-fix satellite for ships out of shore range",
        "pricing": "Free 150 calls/mo · from $14.99/mo",
        "free": True,
        "free_calls_per_month": 150,
    }
    BASE = "https://api.vesselapi.com/v1/vessel/{mmsi}/position"

    def _fetch_one(self, mmsi: str) -> Optional[TrackedShipLive]:
        params = {"filter.idType": "mmsi"}
        if os.getenv("VESSELAPI_USE_SATELLITE", "").strip().lower() == "true":
            params["filter.sat"] = "true"
        url = self.BASE.format(mmsi=urllib.parse.quote(mmsi)) + "?" + urllib.parse.urlencode(params)
        try:
            data = get_json(url, headers={"Authorization": f"Bearer {self.api_key()}"}, redact=self.api_key())
        except SourceError as exc:
            if str(exc).startswith("HTTP 404"):
                return None   # provider has no position for this ship
            raise
        p = (data or {}).get("vesselPosition") if isinstance(data, dict) else None
        if not p or not valid_lat_lon(p.get("latitude"), p.get("longitude")):
            return None
        return TrackedShipLive(
            lat=num(p["latitude"]), lon=num(p["longitude"]),
            sog=num(p.get("sog")), cog=num(p.get("cog")),
            true_heading=heading_or_none(p.get("heading")),
            nav_status=int(p["nav_status"]) if isinstance(p.get("nav_status"), (int, float)) else None,
            last_seen_utc=iso_utc(p.get("timestamp")),
        )


class MyShipTrackingAdapter(PollAdapter):
    """MyShipTracking — https://api.myshiptracking.com/docs. One GET per ship
    (simple response, 1 credit; not-found is free). Terrestrial AIS only and
    the simple response has no heading."""
    meta = {
        "label": "MyShipTracking",
        "env_key": "MYSHIPTRACKING_API_KEY",
        "coverage": "Terrestrial AIS only · no heading field",
        "pricing": "10-day free trial · from €90/mo",
        "free": False,
        "free_calls_per_month": None,
    }
    BASE = "https://api.myshiptracking.com/api/v2/vessel"

    def _fetch_one(self, mmsi: str) -> Optional[TrackedShipLive]:
        url = self.BASE + "?" + urllib.parse.urlencode({"mmsi": mmsi})
        try:
            data = get_json(url, headers={"Authorization": f"Bearer {self.api_key()}"}, redact=self.api_key())
        except SourceError as exc:
            if str(exc).startswith("HTTP 404"):
                return None
            raise
        if not isinstance(data, dict) or data.get("status") != "success":
            return None   # e.g. vessel not found (not charged)
        d = data.get("data") or {}
        if not valid_lat_lon(d.get("lat"), d.get("lng")):
            return None
        return TrackedShipLive(
            lat=num(d["lat"]), lon=num(d["lng"]),
            sog=num(d.get("speed")), cog=num(d.get("course")),
            true_heading=None,
            nav_status=int(d["nav_status"]) if isinstance(d.get("nav_status"), (int, float)) else None,
            last_seen_utc=iso_utc(d.get("received")),
        )


class MarinesiaAdapter(PollAdapter):
    """Marinesia — https://docs.marinesia.com. One GET per ship, key in the
    query string. The free plan allows 1 request per hour, so with a few
    ships each one is refreshed every few hours. Marinesia doesn't say where
    its AIS data comes from, so its coverage is unverified."""
    meta = {
        "label": "Marinesia",
        "env_key": "MARINESIA_API_KEY",
        "coverage": "Receiver network not published — coverage unverified",
        "pricing": "Free 1 call/hour · paid plans for more",
        "free": True,
        "free_calls_per_month": 700,   # 1/hour ≈ 720, kept under
        "min_spacing_s": 3600,
        "max_burst": 1,
    }
    BASE = "https://api.marinesia.com/api/v1/vessel/{mmsi}/location/latest"

    def _fetch_one(self, mmsi: str) -> Optional[TrackedShipLive]:
        url = self.BASE.format(mmsi=urllib.parse.quote(mmsi)) + "?" + urllib.parse.urlencode({"key": self.api_key()})
        try:
            data = get_json(url, redact=self.api_key())
        except SourceError as exc:
            if str(exc).startswith("HTTP 404"):
                return None
            raise
        if not isinstance(data, dict) or data.get("error") is True:
            return None
        d = data.get("data", data)   # documented fields, with or without a {"data": …} envelope
        if isinstance(d, list):
            d = d[0] if d else {}
        if not isinstance(d, dict) or not valid_lat_lon(d.get("lat"), d.get("lng")):
            return None
        return TrackedShipLive(
            lat=num(d["lat"]), lon=num(d["lng"]),
            sog=num(d.get("sog")), cog=num(d.get("cog")),
            true_heading=heading_or_none(d.get("hdt")),
            nav_status=int(d["status"]) if isinstance(d.get("status"), (int, float)) else None,
            last_seen_utc=iso_utc(d.get("ts")),
        )


POLL_ADAPTERS["marinesia"] = MarinesiaAdapter()
POLL_ADAPTERS["vesselapi"] = VesselApiAdapter()
POLL_ADAPTERS["myshiptracking"] = MyShipTrackingAdapter()
