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
            body = exc.read().decode("utf-8", "replace")[:200]
        except Exception:  # noqa: BLE001
            pass
        msg = f"HTTP {exc.code}" + (f": {body}" if body else "")
        raise SourceError(msg.replace(redact, "***") if redact else msg) from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise SourceError(f"Unreachable: {getattr(exc, 'reason', exc)}") from None
    except json.JSONDecodeError:
        raise SourceError("Provider returned non-JSON") from None


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
    #: id, label, env_key, coverage, pricing — shown in the source picker.
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
