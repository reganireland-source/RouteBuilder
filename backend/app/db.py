import json
import os
from pathlib import Path

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL")
DATA_DIR = Path(__file__).parent.parent / "data"

# Each entry: (table_name, json_filename, primary_key_field)
_TABLES = [
    ("nodes",    "nodes.json",    "id"),
    ("systems",  "systems.json",  "id"),
    ("segments", "segments.json", "id"),
    ("capacity", "capacity.json", "segment_id"),
    ("outages",  "outages.json",  "fault_id"),
    ("rules",    "rules.json",    "node_id"),
]

_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS nodes              (id          TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS systems            (id          TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS segments           (id          TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS capacity           (segment_id  TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS outages            (fault_id    TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS rules              (node_id     TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS config             (key         TEXT PRIMARY KEY, value JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS interfaces         (id          TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS projects           (id          TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS tech_service_types (id          TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS tech_bandwidths    (id          TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS tech_protections   (id          TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS tech_frame_sizes   (id          TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS tech_access_types  (id          TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS tech_arranged_by   (id          TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS tech_l1_settings   (id          TEXT PRIMARY KEY, data JSONB NOT NULL);
"""

_DEFAULT_INTERFACES = [
    {"id": "100GBASE-LR4-SMF-LC",   "name": "100GBase-LR4, SMF LC",            "description": "100G LAN, 1310nm, single-mode fibre, LC connector"},
    {"id": "100GBASE-ER4-SMF-LC",   "name": "100GBase-ER4, SMF LC",            "description": "100G LAN, 40km reach, single-mode fibre, LC connector"},
    {"id": "100GBASE-ZR-SMF-LC",    "name": "100GBase-ZR (DWDM), SMF LC",      "description": "Coherent 100G, ~80km DWDM, single-mode fibre, LC connector"},
    {"id": "10GBASE-LR-SMF-LC",     "name": "10GBase-LR, SMF LC",              "description": "10G LAN, 1310nm, single-mode fibre, LC connector"},
    {"id": "10GBASE-ZR-SMF-LC",     "name": "10GBase-ZR, SMF LC",              "description": "10G LAN, 80km reach, single-mode fibre, LC connector"},
    {"id": "10GBASE-ER-SMF-LC",     "name": "10GBase-ER, SMF LC",              "description": "10G LAN, 40km reach, single-mode fibre, LC connector"},
    {"id": "400GBASE-LR4-SMF-LC",   "name": "400GBase-LR4, SMF LC",            "description": "400G LAN, 10km reach, single-mode fibre, LC connector"},
    {"id": "400GBASE-DR4-SMF-MPO",  "name": "400GBase-DR4, SMF MPO",           "description": "400G LAN, 500m reach, single-mode fibre, MPO connector"},
    {"id": "400GBASE-ZR-SMF-LC",    "name": "400GBase-ZR (OpenZR+), SMF LC",   "description": "Coherent 400G DWDM, single-mode fibre, LC connector"},
    {"id": "OTU4-SMF-LC",           "name": "OTU4 (100G OTN), SMF LC",         "description": "OTN 100G wavelength, single-mode fibre, LC connector"},
    {"id": "OTU2-SMF-LC",           "name": "OTU2 (10G OTN), SMF LC",          "description": "OTN 10G wavelength, single-mode fibre, LC connector"},
    {"id": "STM64-SMF-LC",          "name": "STM-64 (10G SDH), SMF LC",        "description": "SDH 10G, single-mode fibre, LC connector"},
    {"id": "STM16-SMF-LC",          "name": "STM-16 (2.5G SDH), SMF LC",       "description": "SDH 2.5G, single-mode fibre, LC connector"},
    {"id": "GE-SMF-LC",             "name": "1GBase-LX, SMF LC",               "description": "1G LAN, 1310nm, single-mode fibre, LC connector"},
    {"id": "XENPAK-10G-ZR",         "name": "XENPAK 10G-ZR, SMF SC",           "description": "10G, 80km reach, single-mode fibre, SC connector"},
]

_DEFAULT_TECH_LOOKUPS: dict[str, list[dict]] = {
    "tech_service_types": [
        {"id": "ethernet-l2",      "label": "Ethernet (L2)",              "order": 10, "description": "Layer 2 Ethernet transport"},
        {"id": "ip-transit",       "label": "IP Transit (L3)",            "order": 20, "description": "Layer 3 IP transit / BGP peering"},
        {"id": "mpls-l3vpn",       "label": "MPLS L3VPN",                "order": 30, "description": "RFC 4364 MPLS Layer 3 VPN"},
        {"id": "mpls-l2vpn",       "label": "MPLS L2VPN / VPLS",         "order": 35, "description": "Layer 2 VPN over MPLS backbone"},
        {"id": "wdm-l1",           "label": "WDM / Wavelength (L1)",      "order": 40, "description": "Optical wavelength service, typically 100G or 400G"},
        {"id": "otn",              "label": "OTN / ODU",                  "order": 50, "description": "OTN mapped service (ODU0/1/2/3/4)"},
        {"id": "sdh-pdh",          "label": "SDH / PDH",                  "order": 60, "description": "Legacy TDM transport (STM-1/4/16/64)"},
        {"id": "dark-fibre",       "label": "Dark Fibre",                 "order": 70, "description": "Unlit fibre pair, customer operates optics"},
        {"id": "eline-evpl",       "label": "E-Line / EVPL",              "order": 80, "description": "MEF E-Line or EVPL Carrier Ethernet service"},
        {"id": "elan-evplan",      "label": "E-LAN / EVPLan",             "order": 85, "description": "MEF E-LAN multipoint Carrier Ethernet"},
        {"id": "internet-exchange","label": "Internet Exchange Port",      "order": 90, "description": "IXP port / peering LAN connection"},
    ],
    "tech_bandwidths": [
        {"id": "1m",    "label": "1 Mbps",    "order": 5},
        {"id": "10m",   "label": "10 Mbps",   "order": 10},
        {"id": "100m",  "label": "100 Mbps",  "order": 20},
        {"id": "1g",    "label": "1 Gbps",    "order": 30},
        {"id": "2-5g",  "label": "2.5 Gbps",  "order": 35},
        {"id": "10g",   "label": "10 Gbps",   "order": 40},
        {"id": "25g",   "label": "25 Gbps",   "order": 45},
        {"id": "40g",   "label": "40 Gbps",   "order": 47},
        {"id": "100g",  "label": "100 Gbps",  "order": 50},
        {"id": "200g",  "label": "200 Gbps",  "order": 55},
        {"id": "400g",  "label": "400 Gbps",  "order": 60},
        {"id": "1t",    "label": "1 Tbps",    "order": 70},
    ],
    "tech_protections": [
        {"id": "unprotected",      "label": "Unprotected",               "order": 10, "description": "Single path, no automatic protection switching"},
        {"id": "1plus1-aps",       "label": "1+1 APS",                   "order": 20, "description": "Dedicated protection, simultaneous TX on both paths"},
        {"id": "1colon1",          "label": "1:1",                       "order": 30, "description": "Dedicated protection, TX switches on failure"},
        {"id": "1colonn",          "label": "1:N",                       "order": 40, "description": "Shared protection, one protection for N working paths"},
        {"id": "shared-mesh",      "label": "Shared Mesh (SNCP)",        "order": 50, "description": "SDH/OTN sub-network connection protection"},
        {"id": "diverse-routing",  "label": "Diverse Routing (logical)", "order": 60, "description": "Geographically diverse routes, no APS — manual failover"},
        {"id": "reroute",          "label": "Reroute / GMPLS",           "order": 70, "description": "Control-plane driven restoration on failure"},
    ],
    "tech_frame_sizes": [
        {"id": "1518",  "label": "1518 B (standard Ethernet)", "order": 10},
        {"id": "1522",  "label": "1522 B (802.1Q tagged)",     "order": 20},
        {"id": "4096",  "label": "4096 B",                     "order": 30},
        {"id": "9000",  "label": "9000 B (jumbo)",             "order": 40},
        {"id": "9216",  "label": "9216 B (jumbo + tags)",      "order": 50},
        {"id": "9600",  "label": "9600 B (super-jumbo)",       "order": 60},
    ],
    "tech_access_types": [
        {"id": "x-connect",    "label": "X-Connect",                "order": 10, "description": "Cross-connect within the same facility"},
        {"id": "local-loop",   "label": "Local Loop",               "order": 20, "description": "Last-mile access circuit from customer site to PoP"},
        {"id": "direct",       "label": "Direct",                   "order": 30, "description": "Customer connects directly to the cable landing station"},
        {"id": "colo",         "label": "Co-location",              "order": 40, "description": "Customer equipment co-located in the carrier facility"},
        {"id": "mpls-tail",    "label": "MPLS Tail",                "order": 50, "description": "MPLS access circuit from customer CPE to PE"},
        {"id": "satellite",    "label": "Satellite Backhaul",       "order": 60, "description": "Satellite link used as access (backup or remote sites)"},
    ],
    "tech_arranged_by": [
        {"id": "customer",          "label": "Customer",           "order": 10},
        {"id": "service-provider",  "label": "Service Provider",   "order": 20},
        {"id": "carrier",           "label": "Carrier (3rd party)","order": 30},
        {"id": "joint",             "label": "Joint arrangement",  "order": 40},
    ],
    "tech_l1_settings": [
        {"id": "sd-fec",        "label": "SD-FEC (Soft-Decision FEC)",  "order": 10, "description": "Soft-decision forward error correction — higher coding gain, used on long-haul"},
        {"id": "hd-fec",        "label": "HD-FEC (Hard-Decision FEC)",  "order": 20, "description": "Hard-decision FEC — lower overhead, shorter reach systems"},
        {"id": "g709-fec",      "label": "G.709 OTN FEC",               "order": 30, "description": "Standard OTN FEC as per ITU-T G.709"},
        {"id": "ofec",          "label": "oFEC (OpenROADM FEC)",        "order": 40, "description": "Open ROADM soft-decision FEC profile"},
        {"id": "zr-plus",       "label": "OpenZR+ Mode",                "order": 50, "description": "OpenZR+ coherent pluggable profile (100G–400G)"},
        {"id": "dp-qpsk",       "label": "DP-QPSK Modulation",         "order": 60, "description": "Dual-polarisation QPSK — long haul, lower baud rate"},
        {"id": "dp-16qam",      "label": "DP-16QAM Modulation",        "order": 70, "description": "Dual-polarisation 16QAM — higher capacity, shorter reach"},
        {"id": "dp-8qam",       "label": "DP-8QAM Modulation",         "order": 75, "description": "Dual-polarisation 8QAM — balance of reach and capacity"},
        {"id": "raman-on",      "label": "Raman Amplification ON",     "order": 80, "description": "Distributed Raman amplification enabled on this span"},
        {"id": "edfa-only",     "label": "EDFA Only",                  "order": 90, "description": "Erbium-doped fibre amplifier, no Raman"},
        {"id": "osnr-optimised","label": "OSNR Optimised Mode",        "order": 100,"description": "Launch power tuned to maximise optical signal-to-noise ratio"},
        {"id": "dispersion-managed","label": "Dispersion Managed",     "order": 110,"description": "Chromatic dispersion compensation applied (DCM / DSP)"},
    ],
}


def get_conn() -> psycopg2.extensions.connection:
    return psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def init_db() -> None:
    """Create tables (if missing) and seed from JSON files on first run."""
    if not DATABASE_URL:
        return
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(_CREATE_SQL)
        conn.commit()
        _seed_if_empty(conn)
    finally:
        conn.close()


def _seed_if_empty(conn) -> None:
    """Populate each table from the committed JSON files if the table is empty."""
    with conn.cursor() as cur:
        for table, filename, pk in _TABLES:
            cur.execute(f"SELECT COUNT(*) AS n FROM {table}")
            if cur.fetchone()["n"] > 0:
                continue
            path = DATA_DIR / filename
            if not path.exists():
                continue
            items = json.loads(path.read_text())
            if items:
                psycopg2.extras.execute_values(
                    cur,
                    f"INSERT INTO {table} ({pk}, data) VALUES %s ON CONFLICT DO NOTHING",
                    [(item[pk], json.dumps(item)) for item in items],
                )

        # Config is a single dict stored under key "main"
        cur.execute("SELECT COUNT(*) AS n FROM config")
        if cur.fetchone()["n"] == 0:
            path = DATA_DIR / "config.json"
            cfg = json.loads(path.read_text()) if path.exists() else {"on_net_ownership": ["owned", "consortium", "iru"]}
            cur.execute(
                "INSERT INTO config (key, value) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                ("main", json.dumps(cfg)),
            )

        # Seed default interface types
        cur.execute("SELECT COUNT(*) AS n FROM interfaces")
        if cur.fetchone()["n"] == 0:
            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO interfaces (id, data) VALUES %s ON CONFLICT DO NOTHING",
                [(iface["id"], json.dumps(iface)) for iface in _DEFAULT_INTERFACES],
            )

        # Seed technical lookup tables
        for table, rows in _DEFAULT_TECH_LOOKUPS.items():
            cur.execute(f"SELECT COUNT(*) AS n FROM {table}")
            if cur.fetchone()["n"] == 0:
                psycopg2.extras.execute_values(
                    cur,
                    f"INSERT INTO {table} (id, data) VALUES %s ON CONFLICT DO NOTHING",
                    [(row["id"], json.dumps(row)) for row in rows],
                )

    conn.commit()
