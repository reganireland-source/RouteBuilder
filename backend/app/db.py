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
            # Migration: backfill verification_status for existing rows
            cur.execute(
                "UPDATE nodes SET data = data || '{\"verification_status\": \"draft\"}'::jsonb "
                "WHERE data->>'verification_status' IS NULL"
            )
            cur.execute(
                "UPDATE segments SET data = data || '{\"verification_status\": \"draft\"}'::jsonb "
                "WHERE data->>'verification_status' IS NULL"
            )
            # Migration 002: rename terrestrial_pop → primary/secondary/extension_pop
            _run_migration_002(cur)
            # Migration 003: insert Philippines PoPs if absent
            _run_migration_003(cur)
            # Migration 004: replace old PH terrestrial segments with revised set
            _run_migration_004(cur)
        conn.commit()
        _seed_if_empty(conn)
    finally:
        conn.close()


_POP_TYPE_MAP = {
    'AKL2': 'primary_pop',   'AUH1': 'primary_pop',   'BLR1': 'secondary_pop',
    'BOM2': 'primary_pop',   'BRI2': 'primary_pop',   'CBR1': 'primary_pop',
    'CHI1': 'secondary_pop', 'DAL1': 'primary_pop',   'DAR2': 'primary_pop',
    'DEL1': 'extension_pop', 'DJI2': 'primary_pop',   'DXB2': 'primary_pop',
    'EQ-BQ1': 'secondary_pop', 'EQ-BS1': 'secondary_pop', 'EQ-CH1': 'secondary_pop',
    'EQ-CH2': 'secondary_pop', 'EQ-DA1': 'secondary_pop', 'EQ-DA2': 'extension_pop',
    'EQ-LA1': 'secondary_pop', 'EQ-LA2': 'secondary_pop', 'EQ-ME1': 'secondary_pop',
    'EQ-ME2': 'secondary_pop', 'EQ-MI1': 'secondary_pop', 'EQ-MI3': 'secondary_pop',
    'EQ-NG1': 'secondary_pop', 'EQ-NY1': 'extension_pop', 'EQ-NY5': 'secondary_pop',
    'EQ-NY9': 'extension_pop', 'EQ-OS1': 'extension_pop', 'EQ-OS2': 'secondary_pop',
    'EQ-PE1': 'secondary_pop', 'EQ-SE2': 'extension_pop', 'EQ-SE3': 'extension_pop',
    'EQ-SL1': 'extension_pop', 'EQ-SY1': 'secondary_pop', 'EQ-SY3': 'secondary_pop',
    'EQ-SY4': 'extension_pop', 'EQ-TY1': 'secondary_pop', 'EQ-TY2': 'secondary_pop',
    'EQ-TY3': 'extension_pop', 'FRA1': 'secondary_pop',
    'GUM2': 'primary_pop',   'HAW2': 'primary_pop',   'HKG2': 'primary_pop',
    'ICN2': 'primary_pop',   'JAK2': 'primary_pop',   'KHH1': 'extension_pop',
    'KUL2': 'primary_pop',   'LAX2': 'primary_pop',   'LON2': 'primary_pop',
    'MAA2': 'primary_pop',   'MAN1': 'primary_pop',   'MEL2': 'primary_pop',
    'MIA1': 'extension_pop', 'MNL2': 'primary_pop',   'MNL3': 'primary_pop',
    'NGO1': 'extension_pop', 'NYC1': 'primary_pop',   'OSA2': 'primary_pop',
    'PEN1': 'secondary_pop', 'PER2': 'primary_pop',   'PUS1': 'extension_pop',
    'SEA2': 'primary_pop',   'SHA1': 'secondary_pop', 'SIN2': 'primary_pop',
    'SUB1': 'primary_pop',   'SYD2': 'primary_pop',   'TPE2': 'primary_pop',
    'TYO2': 'primary_pop',   'WLG1': 'primary_pop',
}


def _run_migration_002(cur) -> None:
    """Rename terrestrial_pop rows to primary/secondary/extension_pop."""
    cur.execute("SELECT COUNT(*) AS n FROM nodes WHERE data->>'type' = 'terrestrial_pop'")
    if cur.fetchone()["n"] == 0:
        return
    for node_id, new_type in _POP_TYPE_MAP.items():
        cur.execute(
            "UPDATE nodes SET data = jsonb_set(data, '{type}', %s::jsonb) "
            "WHERE data->>'id' = %s AND data->>'type' = 'terrestrial_pop'",
            (f'"{new_type}"', node_id),
        )
    # Catch any remaining terrestrial_pop not in the map → secondary_pop
    cur.execute(
        "UPDATE nodes SET data = jsonb_set(data, '{type}', '\"secondary_pop\"'::jsonb) "
        "WHERE data->>'type' = 'terrestrial_pop'"
    )


_PHILIPPINES_POPS = [
    {"id": "PCRS", "name": "Aguinaldo Highway Cavite", "lat": 14.29623, "lng": 120.9564,
     "type": "extension_pop", "country": "PH", "owner": "Telstra", "trading_name": None,
     "city": "Cavite", "street_address": None,
     "description": "Extension PoP on Aguinaldo Highway in Cavite, Philippines",
     "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "PCIN", "name": "Innove Data Centre Cebu", "lat": 10.3157, "lng": 123.8854,
     "type": "secondary_pop", "country": "PH", "owner": "Telstra", "trading_name": None,
     "city": "Cebu", "street_address": None,
     "description": "Secondary PoP co-located in Innove Data Centre, Cebu, Philippines",
     "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "PHPN", "name": "RCBC Tower 2 Makati", "lat": 14.56077, "lng": 121.0169,
     "type": "primary_pop", "country": "PH", "owner": "Telstra", "trading_name": None,
     "city": "Makati", "street_address": "RCBC Tower 2, Ayala Avenue, Makati",
     "description": "Primary PoP co-located in RCBC Tower 2, Makati, Metro Manila",
     "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "PMRS", "name": "Robinsons Summit", "lat": 14.55754, "lng": 121.0206,
     "type": "primary_pop", "country": "PH", "owner": "Telstra", "trading_name": None,
     "city": "Makati", "street_address": "Robinsons Summit Center, Ayala Avenue, Makati",
     "description": "Primary PoP co-located in Robinsons Summit Center, Makati, Metro Manila",
     "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "PMVR", "name": "EPLDT Vitro Data Centre Makati", "lat": 14.56453, "lng": 121.0219,
     "type": "secondary_pop", "country": "PH", "owner": "Telstra", "trading_name": None,
     "city": "Makati", "street_address": None,
     "description": "Secondary PoP co-located in EPLDT Vitro data centre, Makati",
     "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "PMPC", "name": "Reliance Centre Building Pasig", "lat": 14.57772, "lng": 121.0741,
     "type": "primary_pop", "country": "PH", "owner": "Telstra", "trading_name": None,
     "city": "Pasig", "street_address": "Reliance Centre, Pasig, Metro Manila",
     "description": "Primary PoP co-located in Reliance Centre, Pasig, Metro Manila",
     "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "PMPI", "name": "EPLDT Vitro Data Centre Pasig", "lat": 14.58457, "lng": 121.0708,
     "type": "extension_pop", "country": "PH", "owner": "Telstra", "trading_name": None,
     "city": "Pasig", "street_address": None,
     "description": "Extension PoP co-located in EPLDT Vitro data centre, Pasig, Metro Manila",
     "capabilities": None, "verification_status": "draft", "last_verified_date": None},
]


_PH_TERRESTRIAL_SEGMENTS = [
    {"id": "TERRESTRIAL_PH01",  "name": "Terrestrial EAC Cavite–Robinsons Summit",       "system_id": "TERRESTRIAL", "start_node_id": "PCGD", "end_node_id": "PMRS", "type": "terrestrial", "length_km": 33,  "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "latency": 0.17, "verification_status": "draft"},
    {"id": "TERRESTRIAL_PH02",  "name": "Terrestrial EAC Cavite–Robinsons Summit (D)",    "system_id": "TERRESTRIAL", "start_node_id": "PCGD", "end_node_id": "PMRS", "type": "terrestrial", "length_km": 33,  "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "latency": 0.17, "verification_status": "draft"},
    {"id": "TERRESTRIAL_PH03",  "name": "Terrestrial EAC Cavite–C2C Nasugbu",             "system_id": "TERRESTRIAL", "start_node_id": "PCGD", "end_node_id": "PNMA", "type": "terrestrial", "length_km": 68,  "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "latency": 0.34, "verification_status": "draft"},
    {"id": "TERRESTRIAL_PH05",  "name": "Terrestrial Robinsons Summit–Reliance Centre",   "system_id": "TERRESTRIAL", "start_node_id": "PMRS", "end_node_id": "PMPC", "type": "terrestrial", "length_km": 8,   "reliability": 0.9999, "cost_weight": 1, "ownership": "owned", "latency": 0.04, "verification_status": "draft"},
    {"id": "TERRESTRIAL_PH06",  "name": "Terrestrial C2C Nasugbu–Reliance Centre",        "system_id": "TERRESTRIAL", "start_node_id": "PNMA", "end_node_id": "PMPC", "type": "terrestrial", "length_km": 93,  "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "latency": 0.47, "verification_status": "draft"},
    {"id": "TERRESTRIAL_PH07",  "name": "Terrestrial Robinsons Summit–RCBC Tower 2",      "system_id": "TERRESTRIAL", "start_node_id": "PMRS", "end_node_id": "PHPN", "type": "terrestrial", "length_km": 1,   "reliability": 0.9999, "cost_weight": 1, "ownership": "owned", "latency": 0.01, "verification_status": "draft"},
    {"id": "TERRESTRIAL_PH08",  "name": "Terrestrial RCBC Tower 2–Reliance Centre",       "system_id": "TERRESTRIAL", "start_node_id": "PHPN", "end_node_id": "PMPC", "type": "terrestrial", "length_km": 8,   "reliability": 0.9999, "cost_weight": 1, "ownership": "owned", "latency": 0.04, "verification_status": "draft"},
    {"id": "TERRESTRIAL_PH10",  "name": "Terrestrial Robinsons Summit–EPLDT Vitro Makati","system_id": "TERRESTRIAL", "start_node_id": "PMRS", "end_node_id": "PMVR", "type": "terrestrial", "length_km": 1,   "reliability": 0.9999, "cost_weight": 1, "ownership": "owned", "latency": 0.01, "verification_status": "draft"},
    {"id": "TERRESTRIAL_PH11",  "name": "Terrestrial C2C Nasugbu–Reliance Centre (D)",    "system_id": "TERRESTRIAL", "start_node_id": "PNMA", "end_node_id": "PMPC", "type": "terrestrial", "length_km": 93,  "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "latency": 0.47, "verification_status": "draft"},
    {"id": "TERRESTRIAL_PH103", "name": "Terrestrial Reliance Centre–La Union CLS",       "system_id": "TERRESTRIAL", "start_node_id": "PMPC", "end_node_id": "LAUS", "type": "terrestrial", "length_km": 301, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "latency": 1.50, "verification_status": "draft"},
]

_OLD_PH_SEGMENT_IDS = ["TERRESTRIAL_PH01", "TERRESTRIAL_PH02", "TERRESTRIAL_PH03",
                        "TERRESTRIAL_PH04", "TERRESTRIAL_PH05"]


_PH_TERRESTRIAL_CAPACITY = [
    {"segment_id": "TERRESTRIAL_PH01",  "total_capacity_t": 1.5, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_PH02",  "total_capacity_t": 0.9, "available_capacity_t": 0.4},
    {"segment_id": "TERRESTRIAL_PH03",  "total_capacity_t": 1.6, "available_capacity_t": 0.9},
    {"segment_id": "TERRESTRIAL_PH05",  "total_capacity_t": 1.8, "available_capacity_t": 0.7},
    {"segment_id": "TERRESTRIAL_PH06",  "total_capacity_t": 1.1, "available_capacity_t": 0.4},
    {"segment_id": "TERRESTRIAL_PH07",  "total_capacity_t": 0.8, "available_capacity_t": 0.4},
    {"segment_id": "TERRESTRIAL_PH08",  "total_capacity_t": 0.5, "available_capacity_t": 0.2},
    {"segment_id": "TERRESTRIAL_PH10",  "total_capacity_t": 1.5, "available_capacity_t": 0.8},
    {"segment_id": "TERRESTRIAL_PH11",  "total_capacity_t": 0.8, "available_capacity_t": 0.4},
    {"segment_id": "TERRESTRIAL_PH103", "total_capacity_t": 1.7, "available_capacity_t": 0.6},
]


def _run_migration_004(cur) -> None:
    """Replace old Philippines terrestrial segments with the revised set, add capacity."""
    for sid in _OLD_PH_SEGMENT_IDS:
        cur.execute("DELETE FROM segments WHERE id = %s", (sid,))
        cur.execute("DELETE FROM capacity WHERE segment_id = %s", (sid,))
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO segments (id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(s["id"], json.dumps(s)) for s in _PH_TERRESTRIAL_SEGMENTS],
    )
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO capacity (segment_id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(c["segment_id"], json.dumps(c)) for c in _PH_TERRESTRIAL_CAPACITY],
    )


def _run_migration_003(cur) -> None:
    """Upsert Philippines PoPs that may be missing from pre-existing databases."""
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO nodes (id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(node["id"], json.dumps(node)) for node in _PHILIPPINES_POPS],
    )


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
