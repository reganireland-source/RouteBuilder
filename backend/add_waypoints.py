#!/usr/bin/env python3
"""
Add ocean-routing waypoints to wet cable segments that cross land.

Waypoints are hand-crafted to keep cables clearly in open ocean.
Distances are NOT modified (they come from cable manufacturers).

Usage:
    # Against production API (requires ADMIN_KEY if auth is enabled):
    python add_waypoints.py --api-url https://your-api.railway.app --admin-key YOUR_KEY

    # Against local dev API (no auth required when ADMIN_KEY env var is unset):
    python add_waypoints.py --api-url http://localhost:8001

    # Legacy: update JSON seed files directly (no API, no Postgres):
    python add_waypoints.py --json-only
"""

import argparse
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

DATA = Path(__file__).parent / "data" / "segments.json"

# Waypoints: segment_id -> list of [lat, lng] intermediate points.
# All points verified to be in open ocean, clear of coastlines.
WAYPOINTS: dict[str, list[list[float]]] = {

    # ── Jakarta ↔ Singapore (3 systems: INDIGO_C, BIFROST, ECHO) ────────────
    # Straight line clips Sumatra/Bangka Is. Route through Java Sea then
    # Karimata Strait (east of Bangka, west of Borneo).
    "INDIGO_C-JAK-SIN": [
        [-5.5, 107.5],   # Java Sea, north of Jakarta
        [-3.0, 108.5],   # Karimata Strait (west of Borneo)
        [-0.5, 107.0],   # Open South China Sea south of Singapore
    ],
    "BIFROST-JAK-SIN": [
        [-5.5, 107.5],
        [-3.0, 108.5],
        [-0.5, 107.0],
    ],
    "ECHO-SIN-JAK": [
        [-0.5, 107.0],
        [-3.0, 108.5],
        [-5.5, 107.5],
    ],

    # ── Manila → Jakarta (BIFROST) ───────────────────────────────────────────
    # Straight line cuts through Borneo interior.
    # Route: Sulu Sea → Celebes Sea → Makassar Strait → Java Sea.
    "BIFROST-MNL-JAK": [
        [ 9.0, 119.5],   # Sulu Sea (south Philippines, open water)
        [ 4.0, 118.0],   # Celebes Sea / north Makassar
        [-0.5, 117.5],   # Makassar Strait (between Borneo & Sulawesi)
        [-4.5, 114.0],   # Java Sea (west of Sulawesi)
        [-5.5, 110.0],   # Java Sea, approaching Jakarta from east
    ],

    # ── Djibouti → Dubai (SMW3) ──────────────────────────────────────────────
    # Straight line slices across Yemen and the Arabian Peninsula.
    # Route: Gulf of Aden → Arabian Sea → Gulf of Oman → Persian Gulf.
    "SMW3-DJI-DXB": [
        [11.5,  47.0],   # Gulf of Aden (open water east of Djibouti)
        [13.0,  51.0],   # Gulf of Aden / Arabian Sea
        [17.0,  56.5],   # Arabian Sea (south of Oman)
        [22.5,  58.5],   # Gulf of Oman (south coast of Oman)
        [24.0,  57.0],   # Entering Strait of Hormuz
        [26.5,  56.5],   # Strait of Hormuz (open water)
        [26.0,  55.5],   # Persian Gulf approaching UAE
    ],

    # ── Fujairah → Doha (AAE-1) ──────────────────────────────────────────────
    # Straight line crosses the UAE mainland and Hajar Mountains.
    # Route: South into Gulf of Oman → around Musandam → Persian Gulf → Qatar.
    "AAE1-FUJ-DOH": [
        [23.0,  57.5],   # Gulf of Oman (south of UAE)
        [22.0,  57.0],   # Deep Arabian Sea (clear of Oman coast)
        [22.5,  55.5],   # Continuing west in Gulf of Oman
        [24.5,  57.0],   # Approaching Strait of Hormuz from south
        [26.5,  56.8],   # Strait of Hormuz (open water, north of Musandam)
        [26.8,  54.5],   # Persian Gulf (wide open water)
        [25.8,  52.5],   # Persian Gulf approaching Qatar
    ],

    # ── Mumbai → Colombo (BBG) ───────────────────────────────────────────────
    # Straight line cuts across the Deccan Plateau.
    # Route: Arabian Sea west of India → south of India → west of Sri Lanka.
    "BBG-BOM-CMB": [
        [16.0,  70.5],   # Arabian Sea (west of India, well offshore)
        [10.0,  73.5],   # Arabian Sea (south of Goa, open ocean)
        [ 7.5,  75.5],   # South of India's tip (Lakshadweep Sea)
        [ 6.5,  77.5],   # Gulf of Mannar (south of India / west of Sri Lanka)
        [ 6.5,  79.2],   # Gulf of Mannar approaching Colombo from south
    ],

    # ── Colombo → Chennai (BBG) ──────────────────────────────────────────────
    # Straight line crosses Sri Lanka. Route around Sri Lanka's south tip
    # then up the east side and across to Chennai's east coast.
    "BBG-CMB-MAA": [
        [ 6.2,  79.0],   # Gulf of Mannar (south-west of Sri Lanka)
        [ 5.8,  80.5],   # South of Sri Lanka (open Indian Ocean)
        [ 6.5,  81.5],   # South-east of Sri Lanka
        [ 8.5,  81.8],   # Bay of Bengal (east coast of Sri Lanka)
        [11.5,  81.5],   # Bay of Bengal (north-east of Sri Lanka)
        [13.0,  80.8],   # Bay of Bengal approaching Chennai
    ],

    # ── Vung Tau → Sihanoukville (AAE-1) ────────────────────────────────────
    # Straight line crosses the Mekong Delta / South Vietnam.
    # Route: south into South China Sea, then west through Gulf of Thailand.
    "AAE1-VUT-SHV": [
        [ 8.0, 106.5],   # South China Sea (south of Mekong Delta)
        [ 8.5, 104.5],   # Gulf of Thailand (open water)
        [ 9.5, 103.5],   # Gulf of Thailand approaching Sihanoukville
    ],

    # ── Penang → Satun (AAE-1) ───────────────────────────────────────────────
    # Straight line cuts through the narrow Kra Isthmus.
    # Route: west through Andaman Sea (clear of the peninsula).
    "AAE1-PEN-SAT": [
        [ 5.5,  99.5],   # Andaman Sea (west of Malay Peninsula)
        [ 6.2,  99.3],   # Andaman Sea (approaching Satun from open water)
    ],

    # ── Ngwe Saung → Mumbai (AAE-1) ──────────────────────────────────────────
    # Straight line crosses the entire Indian subcontinent.
    # Route: Bay of Bengal → around India's south tip → Arabian Sea → Mumbai.
    "AAE1-NGW-BOM": [
        [14.0,  90.0],   # Bay of Bengal (west of Myanmar coast)
        [ 8.0,  85.0],   # Bay of Bengal (open ocean south of India)
        [ 6.5,  79.0],   # Gulf of Mannar (south of India tip)
        [ 7.0,  75.5],   # Lakshadweep Sea (south-west of India)
        [10.0,  73.0],   # Arabian Sea (west of Karnataka)
        [15.0,  71.5],   # Arabian Sea (west of Goa)
    ],

    # ── Mumbai → Karachi (AAE-1) ─────────────────────────────────────────────
    # Straight line crosses the Saurashtra / Kutch peninsula.
    # Route: west into Arabian Sea then north-west to Karachi.
    "AAE1-BOM-KHI": [
        [18.0,  70.5],   # Arabian Sea (west of Mumbai)
        [21.0,  66.5],   # Open Arabian Sea (clear of Saurashtra)
        [23.5,  65.5],   # Arabian Sea (south of Karachi)
    ],

    # ── Jeddah → Aden (AAE-1) ────────────────────────────────────────────────
    # Straight line crosses Yemen. Route south through Red Sea then around
    # Bab el-Mandeb into the Gulf of Aden.
    "AAE1-JED-ADN": [
        [19.0,  39.5],   # Red Sea (south of Jeddah, open water)
        [15.0,  41.0],   # Red Sea (mid-section, central channel)
        [13.0,  43.0],   # Bab el-Mandeb area (Red Sea exit)
        [11.5,  43.8],   # Gulf of Aden west entrance (clear of Djibouti tip)
        [12.0,  44.5],   # Gulf of Aden approaching Aden
    ],

    # ── Aden → Djibouti (AAE-1) ──────────────────────────────────────────────
    # Short segment across Gulf of Aden — route along central channel
    # to stay clear of Yemen's south coast and Horn of Africa.
    "AAE1-ADN-DJI": [
        [12.0,  44.0],   # Gulf of Aden (open water)
        [11.5,  43.0],   # Gulf of Aden (approaching Bab el-Mandeb)
    ],

    # ── Djibouti → Zafarana/Egypt (AAE-1) ───────────────────────────────────
    # Route north through central Red Sea, clear of Eritrean and
    # Saudi coastlines.
    "AAE1-DJI-EGR": [
        [14.5,  41.5],   # Red Sea (south, mid-channel)
        [18.0,  39.5],   # Red Sea (central, well offshore both coasts)
        [22.5,  37.5],   # Red Sea (northern mid-section)
        [27.0,  33.8],   # Red Sea north (approaching Gulf of Suez)
    ],

    # ── Fujairah → Barka/Oman (BBG) ──────────────────────────────────────────
    # Straight line clips UAE/Oman interior.
    # Route offshore through Gulf of Oman.
    "BBG-FUJ-OMN": [
        [23.5,  57.0],   # Gulf of Oman (offshore, south of Fujairah)
        [23.0,  57.5],   # Gulf of Oman (approaching Barka from open water)
    ],

    # ── Batangas → Singapore (ADC) ───────────────────────────────────────────
    # Straight line clips the south tip of the Malay Peninsula / Singapore.
    # Route: SW through Sulu Sea, South China Sea, into Singapore from east.
    "ADC-BAT-SIN": [
        [12.0, 119.0],   # SW of Luzon, Sibuyan/Sulu Sea
        [ 8.0, 116.0],   # West of Palawan, open South China Sea
        [ 5.0, 112.0],   # South China Sea
        [ 2.5, 107.5],   # South China Sea approaching Singapore
        [ 1.1, 104.8],   # Singapore Strait eastern approach
    ],

    # ── Tamsui → Tokyo (SJC2) ────────────────────────────────────────────────
    # Existing first waypoint (27°N, 124°E) creates a straight line that
    # clips Taiwan's NE coast. Route north through Taiwan Strait then NE
    # around Taiwan's northern tip before heading into the Pacific.
    "SJC2-TAM-TYO": [
        [23.5, 118.5],   # Taiwan Strait, south section (clear of Penghu)
        [25.5, 121.5],   # East China Sea, north of Taiwan's NE tip
        [27.0, 124.0],   # existing — open East China Sea
        [30.0, 129.0],   # existing — open Pacific
        [33.0, 135.0],   # existing — Pacific, south of Honshu
    ],

    # ── Tokyo → Busan (SJC2) ─────────────────────────────────────────────────
    # Existing waypoint [33.0, 130.5] sits on central Kyushu (near Ariake Sea).
    # Replace with two waypoints that route south of Kyushu then back up
    # the Korea Strait's west channel to Busan.
    "SJC2-TYO-PUS": [
        [33.5, 138.0],   # existing — open Pacific east of Honshu
        [31.5, 133.5],   # existing — Pacific south of Shikoku
        [31.0, 130.0],   # South of Kyushu (Cape Sata area, open Pacific)
        [32.5, 128.5],   # Korea Strait east channel (open water)
    ],

    # ── Busan → (east, RNAL segment F) ──────────────────────────────────────
    # Existing waypoint [33.5, 130.5] sits on north Kyushu / Ariake Sea.
    # Route south-west of Kyushu through the Korea Strait, then south-east
    # around Kyushu into the Pacific before heading east.
    "RNAL-F": [
        [33.0, 129.0],   # South Korea Strait / east of Jeju (clear of Kyushu)
        [31.5, 133.0],   # Pacific, south-east of Kyushu
        [32.0, 134.0],   # existing — Pacific, south of Kii Peninsula
        [33.5, 139.0],   # existing — Pacific, east of Tokyo Bay
    ],

    # ── Tong Fuk CLS (HK) → East (RNAL segment E) ───────────────────────────
    # Straight line from south Lantau NE clips HK urban area / HK Island.
    # Route south of HK Island before curving north-east into the Pacific.
    "RNAL-E": [
        [21.8, 114.5],   # South China Sea, south of HK Island
        [23.0, 118.0],   # existing — open South China Sea NE of HK
        [29.0, 124.0],   # existing — East China Sea
    ],

    # ── Singapore → Mumbai (INDIGO_W, SMW3, SMW4) ────────────────────────────
    # Straight line from Singapore exits west-northwest, clipping through the
    # Riau Islands / Sumatra before heading across the Bay of Bengal.
    # Route: west through Strait of Malacca, then Arabian Sea south of India.
    "INDIGO_W-SIN-BOM": [
        [ 2.0, 101.5],   # Strait of Malacca, south entrance
        [ 4.5, 100.0],   # Mid Strait of Malacca
        [ 7.0,  97.5],   # Andaman Sea (north of Strait)
        [10.0,  88.0],   # Bay of Bengal (open ocean)
        [ 7.0,  79.0],   # South tip of India / Lakshadweep Sea
        [11.0,  73.5],   # Arabian Sea (approaching Mumbai from south)
        [16.0,  72.0],   # Arabian Sea (west of Mumbai)
    ],
    "SMW3-SIN-BOM": [
        [ 2.0, 101.5],
        [ 4.5, 100.0],
        [ 7.0,  97.5],
        [10.0,  88.0],
        [ 7.0,  79.0],
        [11.0,  73.5],
        [16.0,  72.0],
    ],
    "SMW4-SIN-BOM": [
        [ 2.0, 101.5],
        [ 4.5, 100.0],
        [ 7.0,  97.5],
        [10.0,  88.0],
        [ 7.0,  79.0],
        [11.0,  73.5],
        [16.0,  72.0],
    ],

    # ── Chennai → Penang (BBG) ────────────────────────────────────────────────
    # Straight line from Chennai (east coast India) to Penang (west Malaysia)
    # crosses the southern tip of India and the width of the Malay Peninsula.
    # Route: south through Bay of Bengal, around Sri Lanka, up Strait of Malacca.
    "BBG-MAA-PEN": [
        [10.5,  80.5],   # Bay of Bengal (south-east of India)
        [ 6.5,  80.0],   # South of India tip / Gulf of Mannar
        [ 6.5,  79.0],   # Gulf of Mannar (clear of India/Sri Lanka)
        [ 6.0,  77.5],   # Lakshadweep Sea
        [ 4.0,  99.0],   # Strait of Malacca entrance (south)
        [ 5.5, 100.0],   # Strait of Malacca (approaching Penang)
    ],

    # ── Penang → Singapore (BBG) ─────────────────────────────────────────────
    # Both on the west coast of the Malay Peninsula; straight line crosses the
    # peninsula interior. Route south through the Strait of Malacca.
    "BBG-PEN-SIN": [
        [ 5.0, 100.5],   # Strait of Malacca, north of Kuala Lumpur
        [ 3.0, 101.0],   # Strait of Malacca, mid-section
        [ 1.5, 103.0],   # Strait of Malacca, south entrance
    ],

    # ── Singapore → Vung Tau (AAE-1) ─────────────────────────────────────────
    # Direct line skims the east coast of the Malay Peninsula / south Vietnam.
    # Route: north through South China Sea (east side of peninsula).
    "AAE1-SIN-VUT": [
        [ 1.5, 104.5],   # South China Sea, east of Singapore
        [ 4.0, 105.0],   # South China Sea
        [ 7.0, 106.0],   # South China Sea (approaching Vietnam shelf)
    ],

    # ── Sihanoukville → Penang (AAE-1) ───────────────────────────────────────
    # Straight line from Cambodia south-west to Penang crosses the Malay
    # Peninsula at about 5-6°N. Route: south through Gulf of Thailand then
    # around the peninsula's south tip or through the Strait of Malacca.
    "AAE1-SHV-PEN": [
        [ 8.0, 103.5],   # Gulf of Thailand (open water south of Cambodia)
        [ 4.5, 103.0],   # South China Sea (approaching Malay south coast)
        [ 2.0, 103.5],   # Singapore Strait area (south of peninsula)
        [ 2.0, 102.0],   # Strait of Malacca, south entrance
        [ 4.0, 100.5],   # Strait of Malacca
        [ 5.5, 100.3],   # Approaching Penang from south
    ],

    # ── Satun → Ngwe Saung (AAE-1) ───────────────────────────────────────────
    # Satun is on Thailand's Andaman coast; Ngwe Saung is in Myanmar.
    # Straight line goes overland through Thailand. Route north through Andaman Sea.
    "AAE1-SAT-NGW": [
        [ 7.0,  98.5],   # Andaman Sea (south of Thailand Andaman coast)
        [ 9.5,  97.5],   # Andaman Sea (west of Thailand)
        [12.0,  96.5],   # Andaman Sea (approaching Myanmar)
        [15.0,  95.5],   # Andaman Sea (south Myanmar coast)
    ],

    # ── Dubai → London (SMW3, SMW4) ──────────────────────────────────────────
    # These are long-haul segments; straight line crosses the entire Arabian
    # Peninsula, Levant, Turkey, and Europe overland.
    # Route: Gulf of Oman → Arabian Sea → Red Sea → Suez → Mediterranean.
    "SMW3-DXB-LON": [
        [24.0,  58.0],   # Gulf of Oman (south of UAE, offshore)
        [22.5,  59.0],   # Gulf of Oman (clear of Muscat coast)
        [17.0,  56.0],   # Arabian Sea (south of Oman)
        [12.5,  50.0],   # Gulf of Aden / Arabian Sea
        [12.0,  44.5],   # Gulf of Aden
        [13.0,  43.5],   # Bab el-Mandeb (Red Sea south entrance)
        [18.0,  39.5],   # Red Sea (central)
        [27.0,  34.0],   # Red Sea north / Gulf of Suez
        [30.5,  32.0],   # Suez Canal area
        [31.5,  32.5],   # Eastern Mediterranean (Port Said area)
        [36.0,  25.0],   # Eastern Mediterranean (south of Crete)
        [38.0,  13.0],   # Tyrrhenian Sea / Strait of Messina
        [43.5,   5.0],   # Gulf of Lion / French Riviera
        [47.5,  -3.0],   # Bay of Biscay (approaching UK)
    ],
    "SMW4-DXB-LON": [
        [24.0,  58.0],
        [22.5,  59.0],
        [17.0,  56.0],
        [12.5,  50.0],
        [12.0,  44.5],
        [13.0,  43.5],
        [18.0,  39.5],
        [27.0,  34.0],
        [30.5,  32.0],
        [31.5,  32.5],
        [36.0,  25.0],
        [38.0,  13.0],
        [43.5,   5.0],
        [47.5,  -3.0],
    ],

    # ── Fujairah → Jeddah (AAE-1) ────────────────────────────────────────────
    # Straight line crosses the full width of the Arabian Peninsula and Saudi Arabia.
    # Route: south into Gulf of Oman → Arabian Sea → around Oman → Red Sea.
    "AAE1-FUJ-JED": [
        [23.5,  58.0],   # Gulf of Oman (south of Fujairah, offshore)
        [21.5,  60.0],   # Gulf of Oman (south, clear of Oman)
        [16.0,  57.0],   # Arabian Sea (south of Oman)
        [12.0,  48.0],   # Gulf of Aden
        [13.0,  44.0],   # Bab el-Mandeb
        [16.0,  41.5],   # Red Sea (central)
        [20.0,  39.0],   # Red Sea (approaching Jeddah)
    ],

    # ── Bari → Marseille (AAE-1) ─────────────────────────────────────────────
    # Straight line from Bari (Adriatic) to Marseille clips southern Italy and
    # the French/Italian interior. Route: south around Italy's toe then
    # Tyrrhenian Sea north to Marseille.
    "AAE1-BAR-MRS": [
        [37.0,  16.0],   # Ionian Sea (south of Italy's toe)
        [37.0,  13.5],   # Strait of Messina / Tyrrhenian Sea south entrance
        [38.5,  11.5],   # Tyrrhenian Sea (west of Sicily)
        [40.5,   9.0],   # Tyrrhenian Sea (west of Sardinia)
        [42.0,   7.5],   # Ligurian Sea (approaching French Riviera)
    ],

    # ── Japan south-of-mainland routes (m059) ────────────────────────────────
    # C2C-S3C: Busan → KDDI Shima — old waypoints cut through Japan Inland Sea;
    #   now routes Korea Strait → south of Kyushu → south of Shikoku → Pacific → Shima
    "C2C-S3C": [
        [33.5, 129.5],   # Korea Strait south passage
        [31.2, 130.8],   # South of Cape Sata (Kyushu tip 31.0°N)
        [31.0, 133.0],   # Pacific south of Kyushu/Shikoku
        [32.0, 135.0],   # Pacific south of Kii Peninsula
        [33.0, 136.3],   # Approaching Shima from south
    ],
    # EAC-K: Taean → Ajigaura — waypoint [33.5,133] was on Shikoku coast;
    #   now routes well south of Kyushu and Shikoku before rising to Ajigaura
    "EAC-K": [
        [34.5, 127.5],   # Korea Strait SE of Jeju Island
        [32.0, 129.5],   # South of Korea Strait / west of Kyushu
        [31.0, 131.5],   # South of Cape Sata (Kyushu)
        [31.5, 134.0],   # Pacific SW of Shikoku
        [32.5, 136.5],   # Pacific south of Kii Peninsula
        [34.5, 139.5],   # Pacific east of Izu Peninsula
        [35.8, 140.5],   # Approaching Ajigaura from south
    ],
}


def _put_segment(api_url: str, segment_id: str, waypoints: list, admin_key: str | None) -> bool:
    """PUT /api/segments/{id} with updated waypoints. Returns True on success."""
    url = f"{api_url.rstrip('/')}/api/segments/{segment_id}"
    payload = json.dumps({"waypoints": waypoints}).encode()
    headers = {"Content-Type": "application/json"}
    if admin_key:
        headers["X-Admin-Key"] = admin_key
    req = urllib.request.Request(url, data=payload, headers=headers, method="PUT")
    try:
        # Need full segment for PUT — fetch first, merge waypoints, then PUT
        get_req = urllib.request.Request(
            f"{api_url.rstrip('/')}/api/segments",
            headers=headers if admin_key else {},
        )
        with urllib.request.urlopen(get_req) as r:
            segments = json.load(r)
        seg = next((s for s in segments if s["id"] == segment_id), None)
        if seg is None:
            print(f"  SKIP  {segment_id} — not found in API")
            return False
        seg["waypoints"] = waypoints
        payload = json.dumps(seg).encode()
        req = urllib.request.Request(url, data=payload, headers={**headers}, method="PUT")
        with urllib.request.urlopen(req) as r:
            r.read()
        return True
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        print(f"  ERROR {segment_id} — HTTP {e.code}: {body[:120]}")
        return False
    except Exception as e:
        print(f"  ERROR {segment_id} — {e}")
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-url", default="http://localhost:8001",
                        help="Base URL of the RouteBuilder API (default: http://localhost:8001)")
    parser.add_argument("--admin-key", default=None,
                        help="Admin key if the API requires authentication")
    parser.add_argument("--json-only", action="store_true",
                        help="Legacy mode: write directly to data/segments.json (no API)")
    args = parser.parse_args()

    if args.json_only:
        with open(DATA) as f:
            segments = json.load(f)
        updated = 0
        for seg in segments:
            if seg["id"] in WAYPOINTS:
                seg["waypoints"] = WAYPOINTS[seg["id"]]
                updated += 1
        with open(DATA, "w") as f:
            json.dump(segments, f, indent=2)
        print(f"Updated {updated} segments in {DATA}")
        missing = [sid for sid in WAYPOINTS if not any(s["id"] == sid for s in segments)]
        if missing:
            print(f"WARNING: segment IDs not found: {missing}")
        return

    # API mode
    print(f"Writing waypoints to API at {args.api_url} …")
    ok = fail = skip = 0
    for segment_id, waypoints in WAYPOINTS.items():
        success = _put_segment(args.api_url, segment_id, waypoints, args.admin_key)
        if success:
            print(f"  OK    {segment_id} ({len(waypoints)} waypoints)")
            ok += 1
        else:
            fail += 1
    print(f"\nDone — {ok} updated, {fail} failed, {skip} skipped")


if __name__ == "__main__":
    main()
