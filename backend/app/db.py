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
            # Migration 005: insert Philippines cable-specific CLS nodes
            _run_migration_005(cur)
            # Migration 006: split PH02 and PH06 via PCRS waypoint
            _run_migration_006(cur)
            # Migration 007: reconnect subsea segments to cable-specific PH CLS nodes
            _run_migration_007(cur)
            # Migration 008: insert Hong Kong nodes
            _run_migration_008(cur)
            # Migration 009: fix type='subsea' → type='wet' inserted by migration 007
            _run_migration_009(cur)
            # Migration 010: insert Hong Kong terrestrial segments and capacity
            _run_migration_010(cur)
            # Migration 011: remove old HK nodes/segments, fix TERRESTRIAL_HK02 collision
            _run_migration_011(cur)
            # Migration 012: add waypoints to HK and PH terrestrial segments
            _run_migration_012(cur)
            # Migration 013: insert Singapore PoPs and CLSs
            _run_migration_013(cur)
            # Migration 014: fix 013 data errors; remove old generic SG nodes + terrestrials
            _run_migration_014(cur)
            # Migration 015: reconnect EAC and C2C segments to correct SG nodes
            _run_migration_015(cur)
            # Migration 016: rename SCOL→SGCL; reconnect SMW4, INDIGO, AAG SG endpoints
            _run_migration_016(cur)
            # Migration 017: reconnect C2C-S6 SG endpoint
            _run_migration_017(cur)
            # Migration 018: reconnect AAE1+Apricot SG endpoints; add missing BBG-PEN-SIN segment
            _run_migration_018(cur)
            # Migration 019: reconnect BIFROST SG endpoint to TUAS
            _run_migration_019(cur)
            # Migration 020: reconnect ECHO SG endpoint to SGCN
            _run_migration_020(cur)
            # Migration 021: reconnect SJC2 SG endpoint to SGCH
            _run_migration_021(cur)
            # Migration 022: reconnect ADC and SMW3 SG endpoints to TUAS
            _run_migration_022(cur)
            # Migration 023: reconnect APG SG endpoint to SGCH
            _run_migration_023(cur)
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


_PH_CLS_NODES = [
    {"id": "PCGD", "name": "PI EAC Cavite", "lat": 14.3213596, "lng": 121.0612705,
     "type": "landing_station", "country": "PH", "owner": "Telstra",
     "description": "EAC Cable landing station, Cavite", "city": "Cavite",
     "verification_status": "under_verification"},
    {"id": "PNMA", "name": "PI C2C CLS Nasugbu", "lat": 14.0676335, "lng": 120.626889,
     "type": "landing_station", "country": "PH", "owner": "Telstra",
     "description": "C2C cable landing station, Nasugbu", "city": "Nasugbu",
     "verification_status": "draft"},
    {"id": "LAUS", "name": "La Union CLS", "lat": 16.615891, "lng": 120.320937,
     "type": "landing_station", "country": "PH", "owner": "Telstra",
     "description": "Cable landing station, La Union", "city": "San Fernando",
     "verification_status": "draft"},
    {"id": "PBAT", "name": "PLDT Batangas CLS", "lat": 14.0667, "lng": 120.6333,
     "type": "landing_station", "country": "PH", "owner": "PLDT",
     "description": "PLDT western cable landing station, Nasugbu, Batangas. Philippines landing for ADC.",
     "city": "Nasugbu", "verification_status": "draft"},
    {"id": "PBAU", "name": "PLDT Baler Aurora CLS", "lat": 15.764, "lng": 121.562,
     "type": "landing_station", "country": "PH", "owner": "PLDT",
     "description": "PLDT cable landing station, Baler, Aurora. Philippines north branch for Apricot.",
     "city": "Baler", "verification_status": "draft"},
    {"id": "PDIG", "name": "PLDT Digos CLS", "lat": 6.752, "lng": 125.357,
     "type": "landing_station", "country": "PH", "owner": "PLDT",
     "description": "PLDT cable landing station, Brgy. Aplaya, Digos City, Davao del Sur. Philippines south branch for Apricot.",
     "city": "Digos", "verification_status": "draft"},
    {"id": "PCVD", "name": "Converge Davao International CLS", "lat": 7.045, "lng": 125.532,
     "type": "landing_station", "country": "PH", "owner": "Converge ICT",
     "description": "Converge ICT Davao International CLS, Bago Aplaya, Davao City. Philippines landing for BiFrost.",
     "city": "Davao", "verification_status": "draft"},
    {"id": "PGDV", "name": "Globe Telecom Davao CLS", "lat": 7.090, "lng": 125.593,
     "type": "landing_station", "country": "PH", "owner": "Globe Telecom",
     "description": "Globe Telecom CLS, Brgy. Talomo, Davao City. Philippines landing for SEA-US.",
     "city": "Davao", "verification_status": "draft"},
]


def _run_migration_005(cur) -> None:
    """Insert Philippines CLS nodes (cable-specific) if absent."""
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO nodes (id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(n["id"], json.dumps(n)) for n in _PH_CLS_NODES],
    )


_PH02_PH06_REPLACEMENTS = [
    {"id": "TERRESTRIAL_PH02a", "name": "Terrestrial EAC Cavite–Aguinaldo Cavite",       "system_id": "TERRESTRIAL", "start_node_id": "PCGD", "end_node_id": "PCRS", "type": "terrestrial", "length_km": 15, "reliability": 0.9999, "cost_weight": 1, "ownership": "owned", "latency": 0.07, "verification_status": "draft"},
    {"id": "TERRESTRIAL_PH02b", "name": "Terrestrial Aguinaldo Cavite–Robinsons Summit",  "system_id": "TERRESTRIAL", "start_node_id": "PCRS", "end_node_id": "PMRS", "type": "terrestrial", "length_km": 37, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "latency": 0.18, "verification_status": "draft"},
    {"id": "TERRESTRIAL_PH06a", "name": "Terrestrial C2C Nasugbu–Aguinaldo Cavite",      "system_id": "TERRESTRIAL", "start_node_id": "PNMA", "end_node_id": "PCRS", "type": "terrestrial", "length_km": 55, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "latency": 0.28, "verification_status": "draft"},
    {"id": "TERRESTRIAL_PH06b", "name": "Terrestrial Aguinaldo Cavite–Reliance Centre",  "system_id": "TERRESTRIAL", "start_node_id": "PCRS", "end_node_id": "PMPC", "type": "terrestrial", "length_km": 42, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "latency": 0.21, "verification_status": "draft"},
]

_PH02_PH06_CAPACITY = [
    {"segment_id": "TERRESTRIAL_PH02a", "total_capacity_t": 1.1, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_PH02b", "total_capacity_t": 0.8, "available_capacity_t": 0.3},
    {"segment_id": "TERRESTRIAL_PH06a", "total_capacity_t": 1.6, "available_capacity_t": 0.7},
    {"segment_id": "TERRESTRIAL_PH06b", "total_capacity_t": 1.1, "available_capacity_t": 0.6},
]


def _run_migration_006(cur) -> None:
    """Split TERRESTRIAL_PH02 and TERRESTRIAL_PH06 via PCRS waypoint."""
    for sid in ("TERRESTRIAL_PH02", "TERRESTRIAL_PH06"):
        cur.execute("DELETE FROM segments WHERE id = %s", (sid,))
        cur.execute("DELETE FROM capacity WHERE segment_id = %s", (sid,))
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO segments (id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(s["id"], json.dumps(s)) for s in _PH02_PH06_REPLACEMENTS],
    )
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO capacity (segment_id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(c["segment_id"], json.dumps(c)) for c in _PH02_PH06_CAPACITY],
    )


_SUBSEA_PH_REPLACEMENTS = [
    {"id": "ADC-HKG-BAT",      "name": "ADC Hong Kong–Batangas",          "system_id": "ADC",      "start_node_id": "HKG1",       "end_node_id": "PBAT", "type": "wet", "length_km": 1429, "latency": 7.14,  "reliability": 0.9999, "cost_weight": 1, "ownership": "consortium"},
    {"id": "ADC-BAT-SIN",      "name": "ADC Batangas–Singapore",          "system_id": "ADC",      "start_node_id": "PBAT",       "end_node_id": "SIN1", "type": "wet", "length_km": 2909, "latency": 14.54, "reliability": 0.9999, "cost_weight": 1, "ownership": "consortium"},
    {"id": "BIFROST-GUM-CVD",  "name": "BiFrost Guam–Davao (Converge)",  "system_id": "BIFROST",  "start_node_id": "GUM1",       "end_node_id": "PCVD", "type": "wet", "length_km": 2779, "latency": 13.89, "reliability": 0.9999, "cost_weight": 1, "ownership": "consortium"},
    {"id": "BIFROST-CVD-JAK",  "name": "BiFrost Davao–Jakarta",          "system_id": "BIFROST",  "start_node_id": "PCVD",       "end_node_id": "JAK1", "type": "wet", "length_km": 3179, "latency": 15.89, "reliability": 0.9999, "cost_weight": 1, "ownership": "consortium"},
    {"id": "SEAUS-GDV-GUM",    "name": "SEA-US Davao–Guam",              "system_id": "SEA-US",   "start_node_id": "PGDV",       "end_node_id": "GUM1", "type": "wet", "length_km": 2769, "latency": 13.85, "reliability": 0.9999, "cost_weight": 1, "ownership": "consortium"},
    {"id": "APRICOT-SIN-BU",   "name": "Apricot Singapore–BU",           "system_id": "APRICOT",  "start_node_id": "SIN1",       "end_node_id": "APRICOTBU1", "type": "wet", "length_km": 4079, "latency": 20.39, "reliability": 0.9999, "cost_weight": 1, "ownership": "consortium"},
    {"id": "APRICOT-BU-BAU",   "name": "Apricot BU–Baler Aurora",        "system_id": "APRICOT",  "start_node_id": "APRICOTBU1", "end_node_id": "PBAU", "type": "wet", "length_km": 929,  "latency": 4.64,  "reliability": 0.9999, "cost_weight": 1, "ownership": "consortium"},
    {"id": "APRICOT-BU-DGS",   "name": "Apricot BU–Digos",               "system_id": "APRICOT",  "start_node_id": "APRICOTBU1", "end_node_id": "PDIG", "type": "wet", "length_km": 1855, "latency": 9.28,  "reliability": 0.9999, "cost_weight": 1, "ownership": "consortium"},
]

_SUBSEA_PH_CAPACITY = [
    {"segment_id": "ADC-HKG-BAT",     "total_capacity_t": 1.5,  "available_capacity_t": 0.5},
    {"segment_id": "ADC-BAT-SIN",     "total_capacity_t": 1.5,  "available_capacity_t": 0.5},
    {"segment_id": "BIFROST-GUM-CVD", "total_capacity_t": 3.0,  "available_capacity_t": 1.0},
    {"segment_id": "BIFROST-CVD-JAK", "total_capacity_t": 3.0,  "available_capacity_t": 1.0},
    {"segment_id": "SEAUS-GDV-GUM",   "total_capacity_t": 1.5,  "available_capacity_t": 0.5},
    {"segment_id": "APRICOT-SIN-BU",  "total_capacity_t": 16.0, "available_capacity_t": 8.0},
    {"segment_id": "APRICOT-BU-BAU",  "total_capacity_t": 16.0, "available_capacity_t": 8.0},
    {"segment_id": "APRICOT-BU-DGS",  "total_capacity_t": 16.0, "available_capacity_t": 8.0},
]

_SUBSEA_PH_OLD_IDS = [
    "ADC-HKG-MNL", "ADC-MNL-SIN",
    "BIFROST-GUM-MNL", "BIFROST-MNL-JAK",
    "SEAUS-MNL-GUM",
    "APRICOT-SIN-MNL", "APRICOT-MNL-BU",
]


def _run_migration_007(cur) -> None:
    """Reconnect subsea segments from generic MNL1 to cable-specific PH CLS nodes."""
    for sid in _SUBSEA_PH_OLD_IDS:
        cur.execute("DELETE FROM segments WHERE id = %s", (sid,))
        cur.execute("DELETE FROM capacity WHERE segment_id = %s", (sid,))
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO segments (id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(s["id"], json.dumps(s)) for s in _SUBSEA_PH_REPLACEMENTS],
    )
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO capacity (segment_id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(c["segment_id"], json.dumps(c)) for c in _SUBSEA_PH_CAPACITY],
    )


_HK_NODES_OLD_IDS = [
    "HKEX","HKCHK","HKCS2","HKDWB","HKCS1","EQ-HK1","HKHMS","EQ-HK2",
    "HKDS1","HKCW","HKSTL","HKTCH","HKSLA","HKTFK",
]

_HK_NODES = [
    {"id": "HKEX", "name": "Hong Kong Exchange",             "lat": 22.2852388, "lng": 114.2732985, "type": "extension_pop",  "country": "HK", "owner": "Hong Kong Exchange",   "city": "Hong Kong", "description": "Hong Kong Exchange facility",                           "verification_status": "draft"},
    {"id": "HKCC", "name": "Chung Hom Kok Cable Station",    "lat": 22.213386,  "lng": 114.2050588, "type": "landing_station", "country": "HK", "owner": "Telstra International","city": "Hong Kong", "description": "Chung Hom Kok cable landing station, Hong Kong",      "verification_status": "draft"},
    {"id": "HKCK", "name": "HKCS2",                          "lat": 22.282628,  "lng": 114.27216,   "type": "secondary_pop",   "country": "HK", "owner": "Telstra International","city": "Hong Kong", "description": "HKCS2 secondary PoP, Hong Kong",                        "verification_status": "draft"},
    {"id": "HKDW", "name": "Deep Water Bay, SMW3",           "lat": 22.2481904, "lng": 114.185504,  "type": "landing_station", "country": "HK", "owner": "Telstra International","city": "Hong Kong", "description": "Deep Water Bay cable landing station, SMW3, Hong Kong", "verification_status": "draft"},
    {"id": "HKEA", "name": "HKCS1",                          "lat": 22.2833854, "lng": 114.2715172, "type": "extension_pop",   "country": "HK", "owner": "Telstra International","city": "Hong Kong", "description": "HKCS1 PoP, Hong Kong",                                  "verification_status": "draft"},
    {"id": "HKGG", "name": "Equinix HK1",                   "lat": 22.3655806, "lng": 114.1193201, "type": "extension_pop",   "country": "HK", "owner": "Equinix",              "city": "Hong Kong", "description": "Equinix HK1, Hong Kong",                                "verification_status": "draft"},
    {"id": "HKHH", "name": "Hermes House",                   "lat": 22.2959189, "lng": 114.1733822, "type": "extension_pop",   "country": "HK", "owner": "Telstra International","city": "Hong Kong", "description": "Hermes House, Hong Kong",                                "verification_status": "draft"},
    {"id": "HKKW", "name": "Equinix HK2",                   "lat": 22.3625,    "lng": 114.11908,   "type": "extension_pop",   "country": "HK", "owner": "Equinix",              "city": "Hong Kong", "description": "Equinix HK2, Hong Kong",                                "verification_status": "draft"},
    {"id": "HKMI", "name": "HKDS1",                          "lat": 22.2660935, "lng": 114.2465174, "type": "primary_pop",     "country": "HK", "owner": "Telstra International","city": "Hong Kong", "description": "HKDS1 primary PoP, Hong Kong",                          "verification_status": "draft"},
    {"id": "HKSF", "name": "Telstra Chai Wan",               "lat": 22.266444,  "lng": 114.2463868, "type": "extension_pop",   "country": "HK", "owner": "Telstra International","city": "Chai Wan",  "description": "Telstra Chai Wan facility, Hong Kong",                   "verification_status": "draft"},
    {"id": "HKST", "name": "Telstra Stanley Teleport",       "lat": 22.20954,   "lng": 114.21487,   "type": "extension_pop",   "country": "HK", "owner": "Telstra International","city": "Stanley",   "description": "Telstra Stanley Teleport, Hong Kong",                    "verification_status": "draft"},
    {"id": "HKTH", "name": "Telecome House",                 "lat": 22.279908,  "lng": 114.1711991, "type": "primary_pop",     "country": "HK", "owner": "Telstra International","city": "Hong Kong", "description": "Telecome House, Hong Kong",                              "verification_status": "draft"},
    {"id": "SLTU", "name": "South Lantau Cable Station",     "lat": 22.2251512, "lng": 113.9294369, "type": "landing_station", "country": "HK", "owner": "Telstra International","city": "Lantau",    "description": "South Lantau cable landing station, Hong Kong",          "verification_status": "draft"},
    {"id": "TGFK", "name": "Tong Fuk CLS",                  "lat": 22.2246493, "lng": 113.9281009, "type": "landing_station", "country": "HK", "owner": "Telstra International","city": "Lantau",    "description": "Tong Fuk cable landing station, Hong Kong",              "verification_status": "draft"},
]


def _run_migration_008(cur) -> None:
    """Remove previously inserted wrong-ID HK nodes and insert correct ones."""
    for nid in _HK_NODES_OLD_IDS:
        cur.execute("DELETE FROM nodes WHERE id = %s", (nid,))
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO nodes (id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(n["id"], json.dumps(n)) for n in _HK_NODES],
    )


def _run_migration_009(cur) -> None:
    """Fix segments inserted by migration 007 with type='subsea' → type='wet'."""
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{type}', '\"wet\"')"
        " WHERE data->>'type' = 'subsea'"
    )


_HK_TERRESTRIAL_SEGMENTS = [
    {"id": "TERRESTRIAL_HK19",  "name": "Terrestrial South Lantau CLS–Equinix HK1",           "system_id": "TERRESTRIAL", "start_node_id": "SLTU", "end_node_id": "HKGG", "type": "terrestrial", "length_km": 31, "latency": 0.16, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK09",  "name": "Terrestrial Equinix HK1–Equinix HK2",                "system_id": "TERRESTRIAL", "start_node_id": "HKGG", "end_node_id": "HKKW", "type": "terrestrial", "length_km":  1, "latency": 0.01, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK08",  "name": "Terrestrial Equinix HK2–Telecome House",              "system_id": "TERRESTRIAL", "start_node_id": "HKKW", "end_node_id": "HKTH", "type": "terrestrial", "length_km": 13, "latency": 0.07, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK16",  "name": "Terrestrial Telecome House–Tong Fuk CLS",             "system_id": "TERRESTRIAL", "start_node_id": "HKTH", "end_node_id": "TGFK", "type": "terrestrial", "length_km": 32, "latency": 0.16, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK26",  "name": "Terrestrial South Lantau CLS–Tong Fuk CLS",          "system_id": "TERRESTRIAL", "start_node_id": "SLTU", "end_node_id": "TGFK", "type": "terrestrial", "length_km":  1, "latency": 0.01, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK13",  "name": "Terrestrial Telecome House–Deep Water Bay",           "system_id": "TERRESTRIAL", "start_node_id": "HKTH", "end_node_id": "HKDW", "type": "terrestrial", "length_km":  5, "latency": 0.02, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK15",  "name": "Terrestrial Hermes House–Telstra Stanley Teleport",   "system_id": "TERRESTRIAL", "start_node_id": "HKHH", "end_node_id": "HKST", "type": "terrestrial", "length_km": 13, "latency": 0.07, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK14",  "name": "Terrestrial Deep Water Bay–Telstra Stanley Teleport", "system_id": "TERRESTRIAL", "start_node_id": "HKDW", "end_node_id": "HKST", "type": "terrestrial", "length_km":  7, "latency": 0.03, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK21",  "name": "Terrestrial Telecome House–Chung Hom Kok CLS",        "system_id": "TERRESTRIAL", "start_node_id": "HKTH", "end_node_id": "HKCC", "type": "terrestrial", "length_km": 10, "latency": 0.05, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK18",  "name": "Terrestrial Telecome House–HKDS1",                    "system_id": "TERRESTRIAL", "start_node_id": "HKTH", "end_node_id": "HKMI", "type": "terrestrial", "length_km": 10, "latency": 0.05, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK05",  "name": "Terrestrial Equinix HK1–HKCS2",                      "system_id": "TERRESTRIAL", "start_node_id": "HKGG", "end_node_id": "HKCK", "type": "terrestrial", "length_km": 23, "latency": 0.11, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK02",  "name": "Terrestrial HKCS2–HKDS1",                            "system_id": "TERRESTRIAL", "start_node_id": "HKCK", "end_node_id": "HKMI", "type": "terrestrial", "length_km":  4, "latency": 0.02, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK03",  "name": "Terrestrial HKDS1–Chung Hom Kok CLS",                "system_id": "TERRESTRIAL", "start_node_id": "HKMI", "end_node_id": "HKCC", "type": "terrestrial", "length_km":  9, "latency": 0.05, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK23",  "name": "Terrestrial HKCS2–Telstra Chai Wan",                 "system_id": "TERRESTRIAL", "start_node_id": "HKCK", "end_node_id": "HKSF", "type": "terrestrial", "length_km":  4, "latency": 0.02, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK24",  "name": "Terrestrial Telstra Chai Wan–Chung Hom Kok CLS",     "system_id": "TERRESTRIAL", "start_node_id": "HKSF", "end_node_id": "HKCC", "type": "terrestrial", "length_km":  9, "latency": 0.05, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK07",  "name": "Terrestrial Telstra Chai Wan–HKDS1",                 "system_id": "TERRESTRIAL", "start_node_id": "HKSF", "end_node_id": "HKMI", "type": "terrestrial", "length_km":  1, "latency": 0.01, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK11",  "name": "Terrestrial Telecome House–Hermes House",             "system_id": "TERRESTRIAL", "start_node_id": "HKTH", "end_node_id": "HKHH", "type": "terrestrial", "length_km":  2, "latency": 0.01, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK20",  "name": "Terrestrial South Lantau CLS–Chung Hom Kok CLS",     "system_id": "TERRESTRIAL", "start_node_id": "SLTU", "end_node_id": "HKCC", "type": "terrestrial", "length_km": 36, "latency": 0.18, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK12",  "name": "Terrestrial South Lantau CLS–Hermes House",          "system_id": "TERRESTRIAL", "start_node_id": "SLTU", "end_node_id": "HKHH", "type": "terrestrial", "length_km": 33, "latency": 0.16, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK06",  "name": "Terrestrial Equinix HK1–Chung Hom Kok CLS",          "system_id": "TERRESTRIAL", "start_node_id": "HKGG", "end_node_id": "HKCC", "type": "terrestrial", "length_km": 24, "latency": 0.12, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK04A", "name": "Terrestrial HKCS1–HKCS2 (diverse A)",                "system_id": "TERRESTRIAL", "start_node_id": "HKEA", "end_node_id": "HKCK", "type": "terrestrial", "length_km":  1, "latency": 0.01, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_HK04B", "name": "Terrestrial HKCS1–HKCS2 (diverse B)",                "system_id": "TERRESTRIAL", "start_node_id": "HKEA", "end_node_id": "HKCK", "type": "terrestrial", "length_km":  1, "latency": 0.01, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
]

_HK_TERRESTRIAL_CAPACITY = [
    {"segment_id": "TERRESTRIAL_HK19",  "total_capacity_t": 1.7, "available_capacity_t": 0.7},
    {"segment_id": "TERRESTRIAL_HK09",  "total_capacity_t": 0.9, "available_capacity_t": 0.6},
    {"segment_id": "TERRESTRIAL_HK08",  "total_capacity_t": 0.7, "available_capacity_t": 0.3},
    {"segment_id": "TERRESTRIAL_HK16",  "total_capacity_t": 1.3, "available_capacity_t": 0.7},
    {"segment_id": "TERRESTRIAL_HK26",  "total_capacity_t": 0.7, "available_capacity_t": 0.4},
    {"segment_id": "TERRESTRIAL_HK13",  "total_capacity_t": 1.3, "available_capacity_t": 0.8},
    {"segment_id": "TERRESTRIAL_HK15",  "total_capacity_t": 0.5, "available_capacity_t": 0.3},
    {"segment_id": "TERRESTRIAL_HK14",  "total_capacity_t": 0.8, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_HK21",  "total_capacity_t": 1.3, "available_capacity_t": 0.8},
    {"segment_id": "TERRESTRIAL_HK18",  "total_capacity_t": 0.8, "available_capacity_t": 0.3},
    {"segment_id": "TERRESTRIAL_HK05",  "total_capacity_t": 0.6, "available_capacity_t": 0.4},
    {"segment_id": "TERRESTRIAL_HK02",  "total_capacity_t": 1.3, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_HK03",  "total_capacity_t": 0.8, "available_capacity_t": 0.3},
    {"segment_id": "TERRESTRIAL_HK23",  "total_capacity_t": 0.8, "available_capacity_t": 0.4},
    {"segment_id": "TERRESTRIAL_HK24",  "total_capacity_t": 1.2, "available_capacity_t": 0.7},
    {"segment_id": "TERRESTRIAL_HK07",  "total_capacity_t": 0.6, "available_capacity_t": 0.4},
    {"segment_id": "TERRESTRIAL_HK11",  "total_capacity_t": 2.0, "available_capacity_t": 1.2},
    {"segment_id": "TERRESTRIAL_HK20",  "total_capacity_t": 1.6, "available_capacity_t": 1.0},
    {"segment_id": "TERRESTRIAL_HK12",  "total_capacity_t": 0.6, "available_capacity_t": 0.3},
    {"segment_id": "TERRESTRIAL_HK06",  "total_capacity_t": 0.6, "available_capacity_t": 0.4},
    {"segment_id": "TERRESTRIAL_HK04A", "total_capacity_t": 1.3, "available_capacity_t": 0.4},
    {"segment_id": "TERRESTRIAL_HK04B", "total_capacity_t": 1.2, "available_capacity_t": 0.7},
]


def _run_migration_010(cur) -> None:
    """Insert Hong Kong terrestrial segments and capacity."""
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO segments (id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(s["id"], json.dumps(s)) for s in _HK_TERRESTRIAL_SEGMENTS],
    )
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO capacity (segment_id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(c["segment_id"], json.dumps(c)) for c in _HK_TERRESTRIAL_CAPACITY],
    )


_HK_OLD_NODE_IDS = ["HKG1", "HKG2", "CHKK", "TKOH"]

_HK02_CORRECT = {"id": "TERRESTRIAL_HK02", "name": "Terrestrial HKCS2–HKDS1", "system_id": "TERRESTRIAL", "start_node_id": "HKCK", "end_node_id": "HKMI", "type": "terrestrial", "length_km": 4, "latency": 0.02, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"}
_HK02_CAPACITY = {"segment_id": "TERRESTRIAL_HK02", "total_capacity_t": 1.3, "available_capacity_t": 0.5}


def _run_migration_011(cur) -> None:
    """Remove old HK nodes (HKG1/HKG2/CHKK/TKOH) and stale segments; fix TERRESTRIAL_HK02 collision."""
    # Remove old HK nodes
    for nid in _HK_OLD_NODE_IDS:
        cur.execute("DELETE FROM nodes WHERE id = %s", (nid,))
    # Remove old terrestrial segments that referenced those nodes
    for sid in ("TERRESTRIAL_HK01", "TERRESTRIAL_HK02"):
        cur.execute("DELETE FROM capacity WHERE segment_id = %s", (sid,))
        cur.execute("DELETE FROM segments WHERE id = %s", (sid,))
    # Re-insert correct TERRESTRIAL_HK02 (was blocked by ON CONFLICT DO NOTHING in migration 010)
    cur.execute(
        "INSERT INTO segments (id, data) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        (_HK02_CORRECT["id"], json.dumps(_HK02_CORRECT)),
    )
    cur.execute(
        "INSERT INTO capacity (segment_id, data) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        (_HK02_CAPACITY["segment_id"], json.dumps(_HK02_CAPACITY)),
    )


# Waypoints for HK and PH terrestrial segments.
# Each value is a list of [lat, lng] intermediate points that guide the
# polyline along logical infrastructure corridors rather than straight lines.
_TERRESTRIAL_WAYPOINTS = {
    # ── Hong Kong ──────────────────────────────────────────────────────────
    # South Lantau → Tung Chung corridor → Tsing Yi → Kwai Chung
    "TERRESTRIAL_HK19":  [[22.289, 113.944], [22.358, 114.070]],
    # Equinix HK1/HK2 are co-located in Kwai Chung – tiny visual offset
    "TERRESTRIAL_HK09":  [[22.368, 114.115]],
    # Kwai Chung → Kowloon → Western Harbour Crossing → Sheung Wan
    "TERRESTRIAL_HK08":  [[22.330, 114.145], [22.298, 114.163]],
    # Sheung Wan → Kennedy Town → Tung Chung corridor → South Lantau
    "TERRESTRIAL_HK16":  [[22.283, 114.130], [22.289, 113.944]],
    # SLTU/TGFK co-located – tiny visual offset
    "TERRESTRIAL_HK26":  [[22.227, 113.929]],
    # Sheung Wan → Aberdeen Tunnel → Deep Water Bay
    "TERRESTRIAL_HK13":  [[22.263, 114.175]],
    # Sheung Wan → Aberdeen → south coast → Stanley
    "TERRESTRIAL_HK15":  [[22.263, 114.175], [22.233, 114.197]],
    # Deep Water Bay → south coast → Stanley
    "TERRESTRIAL_HK14":  [[22.232, 114.198]],
    # Sheung Wan → Aberdeen → Repulse Bay → Chung Hom Kok
    "TERRESTRIAL_HK21":  [[22.263, 114.177], [22.237, 114.195]],
    # Sheung Wan → north coast east → Chai Wan
    "TERRESTRIAL_HK18":  [[22.280, 114.210], [22.277, 114.238]],
    # Kwai Chung → Hung Hom → Eastern Harbour Crossing → Quarry Bay
    "TERRESTRIAL_HK05":  [[22.338, 114.183], [22.308, 114.232]],
    # Quarry Bay → Island Eastern Corridor → Chai Wan
    "TERRESTRIAL_HK02":  [[22.274, 114.261]],
    # Chai Wan → south coast → Chung Hom Kok
    "TERRESTRIAL_HK03":  [[22.245, 114.228], [22.219, 114.210]],
    # Quarry Bay → Chai Wan (offset from HK02)
    "TERRESTRIAL_HK23":  [[22.276, 114.263]],
    # Chai Wan → south coast → Chung Hom Kok (offset from HK03)
    "TERRESTRIAL_HK24":  [[22.247, 114.232], [22.218, 114.213]],
    # HKSF/HKMI co-located in Chai Wan – tiny visual offset
    "TERRESTRIAL_HK07":  [[22.268, 114.248]],
    # Telecome House → Hermes House (short, slight west bow)
    "TERRESTRIAL_HK11":  [[22.288, 114.172]],
    # South Lantau → south coast → Lamma passage → Aberdeen → Chung Hom Kok
    "TERRESTRIAL_HK20":  [[22.220, 113.970], [22.205, 114.075], [22.210, 114.155]],
    # South Lantau → Tung Chung → Tsing Yi → western approach to Sheung Wan
    "TERRESTRIAL_HK12":  [[22.289, 113.944], [22.358, 114.068], [22.305, 114.148]],
    # Kwai Chung → western harbor → Sheung Wan → Aberdeen → south coast → Chung Hom Kok
    "TERRESTRIAL_HK06":  [[22.318, 114.153], [22.285, 114.168], [22.255, 114.173], [22.227, 114.196]],
    # HKCS1/HKCS2 diverse pair – north bow / south bow to separate visually
    "TERRESTRIAL_HK04A": [[22.286, 114.272]],
    "TERRESTRIAL_HK04B": [[22.281, 114.272]],

    # ── Philippines ────────────────────────────────────────────────────────
    # EAC Cavite coast → north via coastal road → Makati
    "TERRESTRIAL_PH01":  [[14.420, 121.040], [14.510, 121.010]],
    # EAC Cavite coast → inland via Aguinaldo Hwy toward PCRS
    "TERRESTRIAL_PH02a": [[14.308, 121.005]],
    # PCRS → Aguinaldo Hwy north → Manila → Makati
    "TERRESTRIAL_PH02b": [[14.430, 120.970], [14.510, 121.000]],
    # EAC Cavite → SW via Trece Martires / Tagaytay corridor → Nasugbu
    "TERRESTRIAL_PH03":  [[14.220, 120.860], [14.110, 120.730]],
    # Makati → BGC / Guadalupe bridge → Pasig
    "TERRESTRIAL_PH05":  [[14.562, 121.045]],
    # PNMA → Tagaytay corridor → Aguinaldo Hwy → PCRS
    "TERRESTRIAL_PH06a": [[14.110, 120.730], [14.220, 120.870]],
    # PCRS → Aguinaldo Hwy north → Manila → Pasig (offset from PH02b)
    "TERRESTRIAL_PH06b": [[14.430, 120.975], [14.540, 121.020]],
    # PMRS/PHPN co-located in Makati – tiny visual offset
    "TERRESTRIAL_PH07":  [[14.560, 121.018]],
    # RCBC Makati → C5 / Ortigas → Pasig
    "TERRESTRIAL_PH08":  [[14.563, 121.042], [14.570, 121.060]],
    # PMRS/PMVR co-located in Makati – tiny visual offset
    "TERRESTRIAL_PH10":  [[14.561, 121.022]],
    # Nasugbu → Batangas interior → STAR Tollway → SLEX → Pasig
    # (deliberately east of PH06 to avoid overlap)
    "TERRESTRIAL_PH11":  [[14.050, 120.750], [13.980, 121.050], [14.220, 121.150], [14.480, 121.060]],
    # Pasig → north Manila → NLEX → Tarlac → Pangasinan → La Union
    "TERRESTRIAL_PH103": [[14.740, 121.050], [15.100, 120.720], [15.490, 120.600], [15.950, 120.380], [16.400, 120.310]],
}


def _run_migration_012(cur) -> None:
    """Add routing waypoints to HK and PH terrestrial segments."""
    for seg_id, waypoints in _TERRESTRIAL_WAYPOINTS.items():
        cur.execute(
            "UPDATE segments SET data = jsonb_set(data, '{waypoints}', %s::jsonb) WHERE id = %s",
            (json.dumps(waypoints), seg_id),
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


_SG_NODES = [
    {"id": "IST1", "name": "Equinix SG1, Singapore",          "lat": 1.295231, "lng": 103.7898, "type": "extension_pop",        "country": "SG", "owner": "Equinix",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "KTLS", "name": "SingTel Katong Exchange",          "lat": 1.302560, "lng": 103.8974, "type": "cable_landing_station", "country": "SG", "owner": "Singtel",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SGCH", "name": "Changi C2C CLS, Singapore",        "lat": 1.337551, "lng": 103.9585, "type": "cable_landing_station", "country": "SG", "owner": "Telstra",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "6NTP", "name": "Epsilon, Singapore",               "lat": 1.352115, "lng": 103.8607, "type": "extension_pop",        "country": "SG", "owner": "Epsilon",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SGOX", "name": "Singapore Stock Exchange",         "lat": 1.375236, "lng": 103.8748, "type": "extension_pop",        "country": "SG", "owner": "Singapore Stock Exchange", "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SGCL", "name": "Starhub Changi Cable Station",     "lat": 1.349119, "lng": 103.9714, "type": "cable_landing_station", "country": "SG", "owner": "StarHub",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SGCN", "name": "SGCS1, Singapore",                 "lat": 1.347041, "lng": 103.9707, "type": "extension_pop",        "country": "SG", "owner": "Telstra",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SGGS", "name": "SGDS1, Singapore",                 "lat": 1.338723, "lng": 103.8938, "type": "primary_pop",          "country": "SG", "owner": "Telstra",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SGNT", "name": "NTT Singapore PoP",                "lat": 1.376080, "lng": 103.8748, "type": "extension_pop",        "country": "SG", "owner": "NTT",                      "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SGPL", "name": "SGCS2, Singapore",                 "lat": 1.323929, "lng": 103.8917, "type": "primary_pop",          "country": "SG", "owner": "BDX",                      "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SSG2", "name": "Equinix SG2, Singapore",           "lat": 1.321822, "lng": 103.6953, "type": "extension_pop",        "country": "SG", "owner": "Equinix",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SSG3", "name": "Equinix SG3, Singapore",           "lat": 1.296184, "lng": 103.7909, "type": "extension_pop",        "country": "SG", "owner": "Equinix",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SSG5", "name": "Equinix SG5, Singapore",           "lat": 1.317280, "lng": 103.7021, "type": "extension_pop",        "country": "SG", "owner": "Equinix",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "TUAS", "name": "SMW3 (2) CLS, Singapore",          "lat": 1.321318, "lng": 103.6560, "type": "cable_landing_station", "country": "SG", "owner": "Singtel",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
]


def _run_migration_013(cur) -> None:
    """Insert 14 Singapore PoPs and CLSs."""
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO nodes (id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(n["id"], json.dumps(n)) for n in _SG_NODES],
    )


_SG_6NTP = {"id": "6NTP", "name": "Epsilon, Singapore", "lat": 1.352115, "lng": 103.8607, "type": "extension_pop", "country": "SG", "owner": "Epsilon", "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None}
_SG_SGNT = {"id": "SGNT", "name": "NTT Singapore PoP", "lat": 1.376080, "lng": 103.8748, "type": "extension_pop", "country": "SG", "owner": "NTT", "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None}

_SG_OLD_GENERIC_IDS = ["SIN1", "SIN2", "SIN3", "SIN4"]
_SG_OLD_TERRESTRIAL_IDS = ["TERRESTRIAL_SG01", "TERRESTRIAL_SG02", "TERRESTRIAL_SG03", "TERRESTRIAL_SG04", "TERRESTRIAL_SG05"]


def _run_migration_014(cur) -> None:
    """Fix migration-013 data errors; remove old generic SG nodes and their terrestrial segments."""
    # Fix GNTP → 6NTP (ID was wrong, image showed 6 not G)
    cur.execute("DELETE FROM nodes WHERE id = 'GNTP'")
    cur.execute(
        "INSERT INTO nodes (id, data) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        ("6NTP", json.dumps(_SG_6NTP)),
    )
    # Fix SGCN type: cable_landing_station → extension_pop
    cur.execute(
        "UPDATE nodes SET data = jsonb_set(data, '{type}', '\"extension_pop\"') WHERE id = 'SGCN'",
    )
    # Fix SDNT → SGNT with correct name
    cur.execute("DELETE FROM nodes WHERE id = 'SDNT'")
    cur.execute(
        "INSERT INTO nodes (id, data) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        ("SGNT", json.dumps(_SG_SGNT)),
    )
    # Remove old generic SG nodes
    for nid in _SG_OLD_GENERIC_IDS:
        cur.execute("DELETE FROM nodes WHERE id = %s", (nid,))
    # Remove old SG terrestrial segments (all reference deleted nodes)
    for sid in _SG_OLD_TERRESTRIAL_IDS:
        cur.execute("DELETE FROM capacity WHERE segment_id = %s", (sid,))
        cur.execute("DELETE FROM segments WHERE id = %s", (sid,))


def _run_migration_015(cur) -> None:
    """Reconnect EAC and C2C segments from removed SG nodes to correct new nodes."""
    # EAC-2A1: SIN3 (removed) → TKOH — fix SG end to SGCN
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{start_node_id}', '\"SGCN\"') WHERE id = 'EAC-2A1'",
    )
    # EAC-2B2: SIN3 (removed) → CPSA — fix SG end to SGCN
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{start_node_id}', '\"SGCN\"') WHERE id = 'EAC-2B2'",
    )
    # C2C-S7: CHKK (removed) → SIN4 (removed) — fix SG end to SGCH
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{end_node_id}', '\"SGCH\"') WHERE id = 'C2C-S7'",
    )


_SG_SGCL = {"id": "SGCL", "name": "Starhub Changi Cable Station", "lat": 1.349119, "lng": 103.9714, "type": "cable_landing_station", "country": "SG", "owner": "StarHub", "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None}


def _run_migration_016(cur) -> None:
    """Rename SCOL → SGCL; reconnect SMW4, INDIGO, and AAG SG endpoints."""
    # Rename SCOL → SGCL (photo misread; correct ID is SGCL)
    cur.execute("DELETE FROM nodes WHERE id = 'SCOL'")
    cur.execute(
        "INSERT INTO nodes (id, data) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        ("SGCL", json.dumps(_SG_SGCL)),
    )
    # SMW4-SIN-BOM: start SIN1 → TUAS
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{start_node_id}', '\"TUAS\"') WHERE id = 'SMW4-SIN-BOM'",
    )
    # INDIGO_C-JAK-SIN: end SIN1 → TUAS
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{end_node_id}', '\"TUAS\"') WHERE id = 'INDIGO_C-JAK-SIN'",
    )
    # INDIGO_W-SIN-BOM: start SIN1 → TUAS
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{start_node_id}', '\"TUAS\"') WHERE id = 'INDIGO_W-SIN-BOM'",
    )
    # INDIGO_W-PER-SIN: end SIN1 → TUAS
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{end_node_id}', '\"TUAS\"') WHERE id = 'INDIGO_W-PER-SIN'",
    )
    # AAG-SIN-HKG: start SIN1 → SGCL
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{start_node_id}', '\"SGCL\"') WHERE id = 'AAG-SIN-HKG'",
    )


def _run_migration_017(cur) -> None:
    """Reconnect C2C-S6 SG endpoint from removed SIN4 to SGCH."""
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{end_node_id}', '\"SGCH\"') WHERE id = 'C2C-S6'",
    )


_BBG_PEN_SIN = {"id": "BBG-PEN-SIN", "name": "BBG Penang–Singapore", "system_id": "BBG", "start_node_id": "PEN1", "end_node_id": "IST1", "type": "wet", "length_km": 747, "latency": 3.74, "reliability": 0.9994, "cost_weight": 1, "ownership": "consortium", "verification_status": "draft"}
_BBG_PEN_SIN_CAP = {"segment_id": "BBG-PEN-SIN", "total_capacity_t": 2.0, "available_capacity_t": 1.1}


def _run_migration_018(cur) -> None:
    """Reconnect AAE1+Apricot SG endpoints; add missing BBG Penang–Singapore segment."""
    # AAE1-SIN-VUT: start SIN1 → IST1
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{start_node_id}', '\"IST1\"') WHERE id = 'AAE1-SIN-VUT'",
    )
    # APRICOT-SIN-BU: start SIN1 → TUAS
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{start_node_id}', '\"TUAS\"') WHERE id = 'APRICOT-SIN-BU'",
    )
    # Add missing BBG Penang→Singapore segment (cable ends at PEN1 in existing data)
    cur.execute(
        "INSERT INTO segments (id, data) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        (_BBG_PEN_SIN["id"], json.dumps(_BBG_PEN_SIN)),
    )
    cur.execute(
        "INSERT INTO capacity (segment_id, data) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        (_BBG_PEN_SIN_CAP["segment_id"], json.dumps(_BBG_PEN_SIN_CAP)),
    )


def _run_migration_019(cur) -> None:
    """Reconnect BIFROST-JAK-SIN SG endpoint from SIN1 to TUAS."""
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{end_node_id}', '\"TUAS\"') WHERE id = 'BIFROST-JAK-SIN'",
    )


def _run_migration_020(cur) -> None:
    """Reconnect ECHO-SIN-JAK SG endpoint from SIN1 to SGCN."""
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{start_node_id}', '\"SGCN\"') WHERE id = 'ECHO-SIN-JAK'",
    )


def _run_migration_021(cur) -> None:
    """Reconnect SJC2-SIN-MNL SG endpoint from SIN1 to SGCH."""
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{start_node_id}', '\"SGCH\"') WHERE id = 'SJC2-SIN-MNL'",
    )


def _run_migration_022(cur) -> None:
    """Reconnect ADC and SMW3 SG endpoints from SIN1 to TUAS."""
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{end_node_id}', '\"TUAS\"') WHERE id = 'ADC-BAT-SIN'",
    )
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{start_node_id}', '\"TUAS\"') WHERE id = 'SMW3-SIN-BOM'",
    )


def _run_migration_023(cur) -> None:
    """Reconnect APG-SIN-HKG SG endpoint from SIN1 to SGCH."""
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{start_node_id}', '\"SGCH\"') WHERE id = 'APG-SIN-HKG'",
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
