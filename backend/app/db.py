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
CREATE TABLE IF NOT EXISTS feature_requests   (id          TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS _migrations        (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS solution_notes (
    id          TEXT PRIMARY KEY,
    node_id     TEXT,
    segment_id  TEXT,
    category_id TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL DEFAULT '',
    text        TEXT NOT NULL DEFAULT '',
    severity    TEXT NOT NULL DEFAULT 'info',
    created_at  TEXT
);
CREATE TABLE IF NOT EXISTS note_categories (
    id          TEXT PRIMARY KEY,
    label       TEXT NOT NULL DEFAULT '',
    applies_to  TEXT NOT NULL DEFAULT 'node',
    order_num   INTEGER NOT NULL DEFAULT 0
);
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


def _once(cur, name: str, fn) -> None:
    """Run fn(cur) exactly once, tracked by name in _migrations table."""
    cur.execute("SELECT 1 FROM _migrations WHERE id = %s", (name,))
    if cur.fetchone() is None:
        fn(cur)
        cur.execute("INSERT INTO _migrations (id) VALUES (%s)", (name,))


def init_db() -> None:
    """Create tables (if missing) and seed from JSON files on first run."""
    if not DATABASE_URL:
        return
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(_CREATE_SQL)

            # Legacy migrations: if _migrations is empty but data already exists,
            # the DB was set up before tracking was added — mark all as done.
            cur.execute("SELECT COUNT(*) as n FROM _migrations")
            if cur.fetchone()["n"] == 0:
                cur.execute("SELECT COUNT(*) as n FROM nodes")
                if cur.fetchone()["n"] > 0:
                    for i in range(1, 57):
                        cur.execute(
                            "INSERT INTO _migrations (id) VALUES (%s) ON CONFLICT DO NOTHING",
                            (f"m{i:03d}",),
                        )

            # Idempotent backfills (WHERE clause makes these safe to re-run)
            cur.execute(
                "UPDATE nodes SET data = data || '{\"verification_status\": \"draft\"}'::jsonb "
                "WHERE data->>'verification_status' IS NULL"
            )
            cur.execute(
                "UPDATE segments SET data = data || '{\"verification_status\": \"draft\"}'::jsonb "
                "WHERE data->>'verification_status' IS NULL"
            )

            _once(cur, 'm002', _run_migration_002)   # rename terrestrial_pop → primary/secondary/extension_pop
            _once(cur, 'm003', _run_migration_003)   # insert Philippines PoPs
            _once(cur, 'm004', _run_migration_004)   # replace old PH terrestrial segments
            _once(cur, 'm005', _run_migration_005)   # insert Philippines cable-specific CLS nodes
            _once(cur, 'm006', _run_migration_006)   # split PH02 and PH06 via PCRS waypoint
            _once(cur, 'm007', _run_migration_007)   # reconnect subsea segments to PH CLS nodes
            _once(cur, 'm008', _run_migration_008)   # insert Hong Kong nodes
            _once(cur, 'm009', _run_migration_009)   # fix type='subsea' → type='wet'
            _once(cur, 'm010', _run_migration_010)   # insert HK terrestrial segments + capacity
            _once(cur, 'm011', _run_migration_011)   # remove old HK nodes/segs, fix HK02 collision
            _once(cur, 'm012', _run_migration_012)   # add waypoints to HK and PH terrestrials
            _once(cur, 'm013', _run_migration_013)   # insert Singapore PoPs and CLSs
            _once(cur, 'm014', _run_migration_014)   # fix 013 errors; remove old SG nodes
            _once(cur, 'm015', _run_migration_015)   # reconnect EAC and C2C to correct SG nodes
            _once(cur, 'm016', _run_migration_016)   # rename SCOL→SGCL; reconnect SMW4, INDIGO, AAG
            _once(cur, 'm017', _run_migration_017)   # reconnect C2C-S6 SG endpoint
            _once(cur, 'm018', _run_migration_018)   # reconnect AAE1+Apricot; add BBG-PEN-SIN
            _once(cur, 'm019', _run_migration_019)   # reconnect BIFROST SG endpoint to TUAS
            _once(cur, 'm020', _run_migration_020)   # reconnect ECHO SG endpoint to SGCN
            _once(cur, 'm021', _run_migration_021)   # reconnect SJC2 SG endpoint to SGCH
            _once(cur, 'm022', _run_migration_022)   # reconnect ADC and SMW3 to TUAS
            _once(cur, 'm023', _run_migration_023)   # reconnect APG SG endpoint to SGCH
            _once(cur, 'm024', _run_migration_024)   # reconnect AAG HK endpoint to SLTU
            _once(cur, 'm025', _run_migration_025)   # reconnect APG HK endpoint to HKCK
            _once(cur, 'm026', _run_migration_026)   # rename SGOX → SKGX
            _once(cur, 'm027', _run_migration_027)   # insert 21 SG terrestrial segments + capacity
            _once(cur, 'm028', _run_migration_028)   # fix type 'cable_landing_station' → 'landing_station'
            _once(cur, 'm029', _run_migration_029)   # update waypoints for SG terrestrials
            _once(cur, 'm030', _run_migration_030)   # add waypoints to APAC wet segments
            _once(cur, 'm031', _run_migration_031)   # populate city on branching-unit nodes
            _once(cur, 'm032', _run_migration_032)   # set on_net field by node type
            _once(cur, 'm033', _run_migration_033)   # insert Japan PoPs and CLSs
            _once(cur, 'm034', _run_migration_034)   # ensure off_net nodes have on_net = 'off_net'
            _once(cur, 'm035', _run_migration_035)   # remove old JP PoPs/CLSs, reroute subsea
            _once(cur, 'm036', _run_migration_036)   # insert JP terrestrial segments + fix MJLS coords
            _once(cur, 'm037', _run_migration_037)   # reroute C2C S4 and S3C to SMCC
            _once(cur, 'm038', _run_migration_038)   # reroute C2C-S5 to CHCC; UNITY/FASTER to CKKD
            _once(cur, 'm039', _run_migration_039)   # add waypoints to JP-touching subsea segments
            _once(cur, 'm040', _run_migration_040)   # add waypoints to JP terrestrial segments
            _once(cur, 'm041', _run_migration_041)   # populate missing latency on C2C and EAC
            _once(cur, 'm042', _run_migration_042)   # add RNAL cable system, nodes and segments
            _once(cur, 'm043', _run_migration_043)   # replace Korea nodes; re-wire C2C and EAC
            _once(cur, 'm044', _run_migration_044)   # add KSEQ node + KR terrestrial segments
            _once(cur, 'm045', _run_migration_045)   # land SJC2 Korea branch at PUCC
            _once(cur, 'm046', _run_migration_046)   # replace TW nodes with corrected CRM data
            _once(cur, 'm047', _run_migration_047)   # add TW terrestrial backhaul segments
            _once(cur, 'm048', _run_migration_048)   # rename KO01 typo to KR01
            _once(cur, 'm049', _run_migration_049)   # reconnect TW wet cables; retire C2C-S3A/3B
            _once(cur, 'm050', _run_migration_050)   # reconnect APG/SJC2/FASTER TW landings
            _once(cur, 'm051', _run_migration_051)   # remove all APCN2 references (EOL)
            _once(cur, 'm052', _run_migration_052)   # add waypoints to KR/TW backhauls
            _once(cur, 'm053', _run_migration_053)   # fix subsea waypoints (landmass crossings)
            _once(cur, 'm054', _run_migration_054)   # create solution_notes + note_categories
            _once(cur, 'm055', _run_migration_055)   # convert notes/categories to proper columns
            _once(cur, 'm056', _run_migration_056)   # upsert expanded default note categories
            _once(cur, 'm057', _run_migration_057)   # fix remaining subsea waypoints (ADC-BAT-SIN, SJC2, RNAL)
            _once(cur, 'm058', _run_migration_058)   # Malay Peninsula / Arabian / Mediterranean waypoints
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
    {"id": "KTLS", "name": "SingTel Katong Exchange",          "lat": 1.302560, "lng": 103.8974, "type": "landing_station", "country": "SG", "owner": "Singtel",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SGCH", "name": "Changi C2C CLS, Singapore",        "lat": 1.337551, "lng": 103.9585, "type": "landing_station", "country": "SG", "owner": "Telstra",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "6NTP", "name": "Epsilon, Singapore",               "lat": 1.352115, "lng": 103.8607, "type": "extension_pop",        "country": "SG", "owner": "Epsilon",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SKGX", "name": "Singapore Stock Exchange",         "lat": 1.375236, "lng": 103.8748, "type": "extension_pop",        "country": "SG", "owner": "Singapore Stock Exchange", "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SGCL", "name": "Starhub Changi Cable Station",     "lat": 1.349119, "lng": 103.9714, "type": "landing_station", "country": "SG", "owner": "StarHub",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SGCN", "name": "SGCS1, Singapore",                 "lat": 1.347041, "lng": 103.9707, "type": "extension_pop",        "country": "SG", "owner": "Telstra",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SGGS", "name": "SGDS1, Singapore",                 "lat": 1.338723, "lng": 103.8938, "type": "primary_pop",          "country": "SG", "owner": "Telstra",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SGNT", "name": "NTT Singapore PoP",                "lat": 1.376080, "lng": 103.8748, "type": "extension_pop",        "country": "SG", "owner": "NTT",                      "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SGPL", "name": "SGCS2, Singapore",                 "lat": 1.323929, "lng": 103.8917, "type": "primary_pop",          "country": "SG", "owner": "BDX",                      "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SSG2", "name": "Equinix SG2, Singapore",           "lat": 1.321822, "lng": 103.6953, "type": "extension_pop",        "country": "SG", "owner": "Equinix",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SSG3", "name": "Equinix SG3, Singapore",           "lat": 1.296184, "lng": 103.7909, "type": "extension_pop",        "country": "SG", "owner": "Equinix",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "SSG5", "name": "Equinix SG5, Singapore",           "lat": 1.317280, "lng": 103.7021, "type": "extension_pop",        "country": "SG", "owner": "Equinix",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
    {"id": "TUAS", "name": "SMW3 (2) CLS, Singapore",          "lat": 1.321318, "lng": 103.6560, "type": "landing_station", "country": "SG", "owner": "Singtel",                  "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None},
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


_SG_SGCL = {"id": "SGCL", "name": "Starhub Changi Cable Station", "lat": 1.349119, "lng": 103.9714, "type": "landing_station", "country": "SG", "owner": "StarHub", "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None}


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


def _run_migration_024(cur) -> None:
    """Reconnect AAG-SIN-HKG HK endpoint from HKG1 to SLTU."""
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{end_node_id}', '\"SLTU\"') WHERE id = 'AAG-SIN-HKG'",
    )


def _run_migration_025(cur) -> None:
    """Reconnect APG-SIN-HKG HK endpoint from HKG1 to HKCK."""
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{end_node_id}', '\"HKCK\"') WHERE id = 'APG-SIN-HKG'",
    )


_SG_SKGX = {"id": "SKGX", "name": "Singapore Stock Exchange", "lat": 1.375236, "lng": 103.8748, "type": "extension_pop", "country": "SG", "owner": "Singapore Stock Exchange", "trading_name": None, "city": "Singapore", "street_address": None, "description": None, "capabilities": None, "verification_status": "draft", "last_verified_date": None}


def _run_migration_026(cur) -> None:
    """Rename SGOX → SKGX (correct ID for Singapore Stock Exchange)."""
    cur.execute("DELETE FROM nodes WHERE id = 'SGOX'")
    cur.execute(
        "INSERT INTO nodes (id, data) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        ("SKGX", json.dumps(_SG_SKGX)),
    )


_SG_TERRESTRIAL_SEGMENTS = [
    {"id": "TERRESTRIAL_SG31", "name": "Terrestrial Tuas CLS–Equinix SG1",            "system_id": "TERRESTRIAL", "start_node_id": "TUAS", "end_node_id": "IST1", "type": "terrestrial", "length_km": 18.9, "latency": 0.095, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": [[1.310, 103.717]]},
    {"id": "TERRESTRIAL_SG28", "name": "Terrestrial Tuas CLS–SGDS1",                  "system_id": "TERRESTRIAL", "start_node_id": "TUAS", "end_node_id": "SGGS", "type": "terrestrial", "length_km": 33.1, "latency": 0.166, "reliability": 0.9997, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": [[1.310, 103.717], [1.342, 103.750]]},
    {"id": "TERRESTRIAL_SG25", "name": "Terrestrial Equinix SG1–Starhub Changi CLS",  "system_id": "TERRESTRIAL", "start_node_id": "IST1", "end_node_id": "SGCL", "type": "terrestrial", "length_km": 26.3, "latency": 0.132, "reliability": 0.9997, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": [[1.305, 103.848], [1.326, 103.937]]},
    {"id": "TERRESTRIAL_SG03", "name": "Terrestrial Equinix SG1–SGDS1",               "system_id": "TERRESTRIAL", "start_node_id": "IST1", "end_node_id": "SGGS", "type": "terrestrial", "length_km": 15.7, "latency": 0.079, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": [[1.305, 103.848]]},
    {"id": "TERRESTRIAL_SG39", "name": "Terrestrial Equinix SG1–SGCS1 (diverse A)",   "system_id": "TERRESTRIAL", "start_node_id": "IST1", "end_node_id": "SGCN", "type": "terrestrial", "length_km": 26.1, "latency": 0.131, "reliability": 0.9997, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": [[1.305, 103.848], [1.322, 103.937]]},
    {"id": "TERRESTRIAL_SG11", "name": "Terrestrial SGCS2–Equinix SG1",               "system_id": "TERRESTRIAL", "start_node_id": "SGPL", "end_node_id": "IST1", "type": "terrestrial", "length_km": 14.7, "latency": 0.073, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": None},
    {"id": "TERRESTRIAL_SG35", "name": "Terrestrial Equinix SG1–SingTel Katong",      "system_id": "TERRESTRIAL", "start_node_id": "IST1", "end_node_id": "KTLS", "type": "terrestrial", "length_km": 15.0, "latency": 0.075, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": [[1.305, 103.848]]},
    {"id": "TERRESTRIAL_SG04", "name": "Terrestrial Equinix SG1–SGCS1 (diverse B)",   "system_id": "TERRESTRIAL", "start_node_id": "IST1", "end_node_id": "SGCN", "type": "terrestrial", "length_km": 26.1, "latency": 0.131, "reliability": 0.9997, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": [[1.341, 103.848], [1.344, 103.940]]},
    {"id": "TERRESTRIAL_SG36", "name": "Terrestrial SingTel Katong–SGDS1",            "system_id": "TERRESTRIAL", "start_node_id": "KTLS", "end_node_id": "SGGS", "type": "terrestrial", "length_km":  5.1, "latency": 0.025, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": None},
    {"id": "TERRESTRIAL_SG10", "name": "Terrestrial SGCS2–SGDS1",                     "system_id": "TERRESTRIAL", "start_node_id": "SGPL", "end_node_id": "SGGS", "type": "terrestrial", "length_km":  2.1, "latency": 0.011, "reliability": 0.9999, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": None},
    {"id": "TERRESTRIAL_SG08", "name": "Terrestrial SGCS2–Changi C2C CLS",            "system_id": "TERRESTRIAL", "start_node_id": "SGPL", "end_node_id": "SGCH", "type": "terrestrial", "length_km":  9.5, "latency": 0.048, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": [[1.315, 103.930]]},
    {"id": "TERRESTRIAL_SG09", "name": "Terrestrial SGCS2–SGCS1",                     "system_id": "TERRESTRIAL", "start_node_id": "SGPL", "end_node_id": "SGCN", "type": "terrestrial", "length_km": 11.4, "latency": 0.057, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": [[1.315, 103.930]]},
    {"id": "TERRESTRIAL_SG41", "name": "Terrestrial Equinix SG5–SGDS1",               "system_id": "TERRESTRIAL", "start_node_id": "SSG5", "end_node_id": "SGGS", "type": "terrestrial", "length_km": 26.8, "latency": 0.134, "reliability": 0.9997, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": [[1.342, 103.750]]},
    {"id": "TERRESTRIAL_SG42", "name": "Terrestrial Equinix SG5–SGCS1",               "system_id": "TERRESTRIAL", "start_node_id": "SSG5", "end_node_id": "SGCN", "type": "terrestrial", "length_km": 37.6, "latency": 0.188, "reliability": 0.9997, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": [[1.342, 103.750], [1.344, 103.940]]},
    {"id": "TERRESTRIAL_SG40", "name": "Terrestrial SGX–SGCS1",                       "system_id": "TERRESTRIAL", "start_node_id": "SKGX", "end_node_id": "SGCN", "type": "terrestrial", "length_km": 13.9, "latency": 0.070, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": [[1.358, 103.935]]},
    {"id": "TERRESTRIAL_SG06", "name": "Terrestrial SGX–Changi C2C CLS",              "system_id": "TERRESTRIAL", "start_node_id": "SKGX", "end_node_id": "SGCH", "type": "terrestrial", "length_km": 12.8, "latency": 0.064, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": [[1.358, 103.935]]},
    {"id": "TERRESTRIAL_SG23", "name": "Terrestrial SGX–SGDS1",                       "system_id": "TERRESTRIAL", "start_node_id": "SKGX", "end_node_id": "SGGS", "type": "terrestrial", "length_km":  5.7, "latency": 0.029, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": None},
    {"id": "TERRESTRIAL_SG01", "name": "Terrestrial SGDS1–SGCS1 (diverse A)",         "system_id": "TERRESTRIAL", "start_node_id": "SGGS", "end_node_id": "SGCN", "type": "terrestrial", "length_km": 10.7, "latency": 0.053, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": [[1.354, 103.933]]},
    {"id": "TERRESTRIAL_SG02", "name": "Terrestrial SGDS1–SGCS1 (diverse B)",         "system_id": "TERRESTRIAL", "start_node_id": "SGGS", "end_node_id": "SGCN", "type": "terrestrial", "length_km": 10.7, "latency": 0.053, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": [[1.328, 103.937]]},
    {"id": "TERRESTRIAL_SG30", "name": "Terrestrial SGDS1–SGCS1 (diverse C)",         "system_id": "TERRESTRIAL", "start_node_id": "SGGS", "end_node_id": "SGCN", "type": "terrestrial", "length_km": 10.7, "latency": 0.053, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": [[1.342, 103.943]]},
    {"id": "TERRESTRIAL_SG22", "name": "Terrestrial SGCS1–Starhub Changi CLS",        "system_id": "TERRESTRIAL", "start_node_id": "SGCN", "end_node_id": "SGCL", "type": "terrestrial", "length_km":  0.3, "latency": 0.002, "reliability": 0.9999, "cost_weight": 1, "ownership": "owned", "verification_status": "draft", "waypoints": None},
]

_SG_TERRESTRIAL_CAPACITY = [
    {"segment_id": "TERRESTRIAL_SG31", "total_capacity_t": 1.3, "available_capacity_t": 0.7},
    {"segment_id": "TERRESTRIAL_SG28", "total_capacity_t": 1.5, "available_capacity_t": 0.8},
    {"segment_id": "TERRESTRIAL_SG25", "total_capacity_t": 1.3, "available_capacity_t": 0.7},
    {"segment_id": "TERRESTRIAL_SG03", "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_SG39", "total_capacity_t": 1.3, "available_capacity_t": 0.7},
    {"segment_id": "TERRESTRIAL_SG11", "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_SG35", "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_SG04", "total_capacity_t": 1.3, "available_capacity_t": 0.7},
    {"segment_id": "TERRESTRIAL_SG36", "total_capacity_t": 0.8, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_SG10", "total_capacity_t": 0.6, "available_capacity_t": 0.4},
    {"segment_id": "TERRESTRIAL_SG08", "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_SG09", "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_SG41", "total_capacity_t": 1.3, "available_capacity_t": 0.7},
    {"segment_id": "TERRESTRIAL_SG42", "total_capacity_t": 1.5, "available_capacity_t": 0.8},
    {"segment_id": "TERRESTRIAL_SG40", "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_SG06", "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_SG23", "total_capacity_t": 0.8, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_SG01", "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_SG02", "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_SG30", "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_SG22", "total_capacity_t": 0.6, "available_capacity_t": 0.4},
]


def _run_migration_027(cur) -> None:
    """Insert 21 Singapore terrestrial backhaul segments with waypoints and capacity."""
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO segments (id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(s["id"], json.dumps(s)) for s in _SG_TERRESTRIAL_SEGMENTS],
    )
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO capacity (segment_id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(c["segment_id"], json.dumps(c)) for c in _SG_TERRESTRIAL_CAPACITY],
    )


def _run_migration_028(cur) -> None:
    """Fix invalid node type 'cable_landing_station' → 'landing_station' in all rows."""
    cur.execute(
        "UPDATE nodes SET data = jsonb_set(data, '{type}', '\"landing_station\"') "
        "WHERE data->>'type' = 'cable_landing_station'"
    )


# Node coords for reference:
# TUAS (1.321, 103.656)  IST1 (1.295, 103.790)  SSG5 (1.317, 103.702)
# SGGS (1.339, 103.894)  SGPL (1.324, 103.892)  KTLS (1.303, 103.897)
# SGCN (1.347, 103.971)  SGCL (1.349, 103.971)  SGCH (1.338, 103.959)
# SKGX (1.375, 103.875)
_SG_WAYPOINTS: dict[str, list | None] = {
    # TUAS → IST1: SE then E
    "TERRESTRIAL_SG31": [[1.308, 103.700], [1.295, 103.756]],
    # TUAS → SGGS: E via SSG5 area then NE
    "TERRESTRIAL_SG28": [[1.310, 103.700], [1.338, 103.780], [1.338, 103.860]],
    # IST1 → SGCL: NE via central corridor
    "TERRESTRIAL_SG25": [[1.295, 103.848], [1.330, 103.930], [1.349, 103.955]],
    # IST1 → SGGS: E then N
    "TERRESTRIAL_SG03": [[1.295, 103.840], [1.330, 103.890]],
    # IST1 → SGCN diverse A: southern route via lower corridor
    "TERRESTRIAL_SG39": [[1.285, 103.845], [1.298, 103.935], [1.338, 103.968]],
    # SGPL → IST1: W then SW
    "TERRESTRIAL_SG11": [[1.320, 103.850], [1.295, 103.820]],
    # IST1 → KTLS: E along southern corridor
    "TERRESTRIAL_SG35": [[1.295, 103.840], [1.300, 103.875]],
    # IST1 → SGCN diverse B: northern route via upper corridor
    "TERRESTRIAL_SG04": [[1.330, 103.830], [1.350, 103.900], [1.350, 103.960]],
    # KTLS → SGGS: N along eastern cluster
    "TERRESTRIAL_SG36": [[1.318, 103.895]],
    # SGPL → SGGS: very short, direct N
    "TERRESTRIAL_SG10": [[1.331, 103.892]],
    # SGPL → SGCH: E then slight N
    "TERRESTRIAL_SG08": [[1.324, 103.920], [1.330, 103.950]],
    # SGPL → SGCN: NE via north side
    "TERRESTRIAL_SG09": [[1.335, 103.930], [1.347, 103.955]],
    # SSG5 → SGGS: E along central corridor
    "TERRESTRIAL_SG41": [[1.317, 103.760], [1.335, 103.850]],
    # SSG5 → SGCN: E via northern route
    "TERRESTRIAL_SG42": [[1.317, 103.760], [1.338, 103.870], [1.347, 103.950]],
    # SKGX → SGCN: SE via north side
    "TERRESTRIAL_SG40": [[1.370, 103.920], [1.355, 103.958]],
    # SKGX → SGCH: SE via slightly lower angle
    "TERRESTRIAL_SG06": [[1.360, 103.900], [1.345, 103.943]],
    # SKGX → SGGS: S then slight SE
    "TERRESTRIAL_SG23": [[1.360, 103.880]],
    # SGGS → SGCN diverse A: northern arc
    "TERRESTRIAL_SG01": [[1.356, 103.920], [1.356, 103.960]],
    # SGGS → SGCN diverse B: southern arc
    "TERRESTRIAL_SG02": [[1.325, 103.930], [1.335, 103.967]],
    # SGGS → SGCN diverse C: central direct
    "TERRESTRIAL_SG30": [[1.341, 103.932], [1.344, 103.962]],
    # SGCN → SGCL: very short adjacent stub
    "TERRESTRIAL_SG22": [[1.348, 103.971]],
}


def _run_migration_029(cur) -> None:
    """Update waypoints for all 21 SG terrestrial segments (guarantees correct data regardless of seed history)."""
    for seg_id, wps in _SG_WAYPOINTS.items():
        cur.execute(
            "UPDATE segments SET data = jsonb_set(data, '{waypoints}', %s::jsonb) WHERE id = %s",
            (json.dumps(wps), seg_id),
        )


# ── Migration 030 ─────────────────────────────────────────────────────────────
# Waypoints for APAC wet segments that would cross land on a straight line.
# Principle: cables exit perpendicular to the shore first, then curve to destination.
_APAC_WET_WAYPOINTS: dict[str, list] = {
    # EAC-K: Seosan (W Korea) → Hitachinaka (Japan)
    # Exits W into Yellow Sea, S around Korea, E through Korea Strait, NE to Japan
    "EAC-K": [
        [36.5, 125.5], [35.5, 125.0], [34.5, 126.0], [34.0, 128.5],
        [33.5, 131.5], [33.5, 134.5], [33.5, 137.5], [34.5, 139.5], [35.5, 140.0],
    ],
    # EAC-2B1: Taipei → Cavite (Philippines)
    # Exits W through Taiwan Strait, S along west of Luzon in South China Sea
    "EAC-2B1": [
        [24.8, 121.0], [23.0, 120.0], [21.0, 119.5], [19.0, 119.5],
        [17.0, 119.8], [15.5, 120.0], [14.5, 120.3], [14.4, 120.7],
    ],
    # SJC2-MNL-TPE: Manila → Taipei
    # Exits W from Manila Bay, N through South China Sea west of Luzon, through Taiwan Strait
    "SJC2-MNL-TPE": [
        [14.5, 120.3], [16.0, 119.8], [19.0, 119.5],
        [21.0, 120.0], [23.0, 120.5], [24.5, 121.0],
    ],
    # C2C-S5: Hitachinaka (Japan) → Nasugbu (Philippines)
    # Exits E into Pacific, arcs SE then SW around east Philippines to Nasugbu
    "C2C-S5": [
        [36.5, 142.0], [30.0, 143.0], [22.0, 140.0], [16.0, 134.0],
        [13.0, 128.0], [13.0, 124.0], [13.5, 122.0], [13.7, 121.0],
    ],
    # AAG-MNL-GUM: Manila → Guam
    # Exits S from Manila Bay through Verde Island Passage, E around Luzon to Philippine Sea
    "AAG-MNL-GUM": [
        [14.3, 121.0], [13.7, 121.2], [13.0, 122.5],
        [12.5, 125.0], [13.0, 132.0], [13.0, 141.0],
    ],
    # APRICOT-SIN-BU: Singapore → Philippine Sea BU
    # NE through South China Sea, west of Luzon, then curves E north of Luzon
    "APRICOT-SIN-BU": [
        [3.5, 104.5], [8.0, 110.5], [13.5, 116.5],
        [18.0, 119.5], [20.5, 121.5], [20.5, 124.5],
    ],
    # INDIGO_W-PER-SIN: Perth → Singapore
    # Exits W from Perth, NW through Indian Ocean, through Sunda Strait to Singapore
    "INDIGO_W-PER-SIN": [
        [-32.0, 112.0], [-20.0, 107.0], [-8.0, 103.0], [-5.5, 105.5], [1.0, 103.9],
    ],
    # INDIGO_C-PER-JAK: Perth → Jakarta
    # NW through Indian Ocean, arrives Jakarta via Sunda Strait from SW
    "INDIGO_C-PER-JAK": [
        [-32.0, 113.5], [-20.0, 110.0], [-10.0, 106.0], [-7.0, 105.8], [-6.0, 106.5],
    ],
    # TOPAZ-TYO-NGO: Tokyo → Nagoya
    # Exits SE from Tokyo Bay, around Izu Peninsula, W through Suruga Bay to Nagoya
    "TOPAZ-TYO-NGO": [
        [34.8, 139.8], [34.4, 138.8], [34.0, 137.5], [34.5, 136.8],
    ],
    # SJC2-TYO-ICN: Tokyo → Incheon (Korea)
    # Exits SE, S around Japan, W through Korea/Tsushima Strait to Incheon
    "SJC2-TYO-ICN": [
        [34.8, 139.8], [33.5, 136.5], [33.0, 131.5],
        [33.0, 129.5], [34.0, 128.5], [35.5, 127.5], [37.0, 127.0],
    ],
    # ADC-TYO-TPE: Tokyo → Taipei
    # Exits SE from Tokyo Bay, S through Ryukyu Islands chain to Taiwan
    "ADC-TYO-TPE": [
        [34.8, 139.8], [32.0, 135.0], [29.0, 130.0],
        [27.0, 126.5], [25.5, 123.0], [25.2, 122.0],
    ],
    # APG-TPE-TYO: Taipei → Tokyo
    # N through Ryukyu chain, arrives at Tokyo from SE
    "APG-TPE-TYO": [
        [25.2, 122.5], [27.0, 126.5], [29.0, 131.0],
        [32.0, 135.5], [34.8, 139.8],
    ],
    # SJC2-TPE-TYO: Taipei → Tokyo (same Ryukyu route)
    "SJC2-TPE-TYO": [
        [25.2, 122.5], [27.0, 126.5], [29.0, 131.0],
        [32.0, 135.5], [34.8, 139.8],
    ],
    # PPC1-SYD-GUM: Sydney → Guam
    # Exits E from Sydney, routes east of Papua New Guinea through Coral Sea
    "PPC1-SYD-GUM": [
        [-33.5, 154.0], [-20.0, 157.0], [-8.0, 154.0], [3.0, 150.0], [10.0, 147.0],
    ],
    # AJC-SYD-GUM: Sydney → Guam (same route)
    "AJC-SYD-GUM": [
        [-33.5, 154.0], [-20.0, 157.0], [-8.0, 154.0], [3.0, 150.0], [10.0, 147.0],
    ],
    # C2C-S6: Nasugbu (Philippines) → Singapore
    # Exits W into South China Sea, SW to Singapore
    "C2C-S6": [
        [13.8, 120.0], [11.0, 117.0], [7.0, 112.0], [3.5, 107.0], [1.5, 105.0],
    ],
    # EAC-2B2: Singapore → Cavite (Philippines)
    # Exits NE from Changi, through South China Sea to Cavite
    "EAC-2B2": [
        [3.0, 105.5], [8.0, 110.0], [12.0, 115.5], [14.0, 119.5], [14.3, 120.5],
    ],
    # BIFROST-GUM-CVD: Guam → Davao (Philippines)
    # Routes south of Philippines to avoid Mindanao east coast
    "BIFROST-GUM-CVD": [
        [12.0, 144.0], [9.0, 136.0], [7.5, 131.0], [7.0, 128.0], [7.0, 126.5], [7.0, 125.8],
    ],
    # BIFROST-CVD-JAK: Davao → Jakarta
    # Through Celebes Sea, Makassar Strait, Java Sea to Jakarta
    "BIFROST-CVD-JAK": [
        [6.5, 124.5], [3.5, 122.0], [0.0, 119.5],
        [-3.5, 116.5], [-6.0, 111.0], [-6.0, 108.5],
    ],
    # JGA-TYO-GUM: Tokyo → Guam
    # Exits SE from Tokyo Bay, S through Pacific
    "JGA-TYO-GUM": [
        [35.0, 140.0], [28.0, 143.0], [20.0, 144.0],
    ],
    # AJC-GUM-TYO: Guam → Tokyo
    # N through Pacific, arrives at Tokyo from SE
    "AJC-GUM-TYO": [
        [16.0, 145.0], [24.0, 143.0], [32.0, 141.5], [34.5, 140.5],
    ],
    # TABUA-SYD-BRI: Sydney → Brisbane
    # Exits E from Sydney, N along east coast to Brisbane
    "TABUA-SYD-BRI": [
        [-33.5, 153.0], [-28.0, 154.5],
    ],
}


def _run_migration_030(cur) -> None:
    """Add waypoints to APAC wet segments that cross land on a straight line."""
    for seg_id, wps in _APAC_WET_WAYPOINTS.items():
        cur.execute(
            "UPDATE segments SET data = jsonb_set(data, '{waypoints}', %s::jsonb) WHERE id = %s",
            (json.dumps(wps), seg_id),
        )


# ── Migration 031 ─────────────────────────────────────────────────────────────
# Populate the city field for branching-unit nodes that have no city set.
_BU_CITIES: dict[str, str] = {
    "APRICOTBU1": "Philippine Sea",
    "BUCT":       "Taiwan Strait",
    "BUEC":       "East China Sea",
    "BUEP":       "Pacific Ocean",
    "BUEY":       "Yellow Sea",
    "JGABU1":     "Coral Sea",
    "JUNO-BU1":   "Pacific Ocean",
    "JUPBU1":     "North Pacific Ocean",
    "SXNBU1":     "South Pacific Ocean",
}


def _run_migration_031(cur) -> None:
    """Set city field on branching-unit nodes that currently have none."""
    for node_id, city in _BU_CITIES.items():
        cur.execute(
            "UPDATE nodes SET data = jsonb_set(data, '{city}', %s::jsonb) WHERE id = %s",
            (json.dumps(city), node_id),
        )


# ── Migration 032 ─────────────────────────────────────────────────────────────
# Populate the on_net field for all existing nodes.
# Primary/secondary/extension PoPs are On-Net (your own infrastructure).
# Landing stations and branching units default to Off-Net.
def _run_migration_032(cur) -> None:
    """Set on_net field based on node type for all existing nodes."""
    cur.execute(
        """UPDATE nodes
           SET data = jsonb_set(data, '{on_net}', '"on_net"'::jsonb)
           WHERE data->>'type' IN ('primary_pop', 'secondary_pop', 'extension_pop')
             AND data->>'on_net' IS NULL"""
    )
    cur.execute(
        """UPDATE nodes
           SET data = jsonb_set(data, '{on_net}', '"off_net"'::jsonb)
           WHERE data->>'type' IN ('landing_station', 'branching_unit')
             AND data->>'on_net' IS NULL"""
    )


# ── Migration 033 ─────────────────────────────────────────────────────────────
# Japan PoPs and cable landing stations sourced from CRM export.
_JAPAN_NODES = [
    # Digital Realty data centres (Off-Net)
    {"id": "JHDA", "name": "Digital Realty HND10, Tokyo",    "lat": 35.68528, "lng": 139.5647, "type": "off_net", "country": "JP", "city": "Tokyo",       "owner": "Digital Realty",        "on_net": "off_net", "verification_status": "under_verification", "description": "Digital Realty HND10 Data Centre, Mitaka, Tokyo"},
    {"id": "JHDB", "name": "Digital Realty HND11, Tokyo",    "lat": 35.68528, "lng": 139.5647, "type": "off_net", "country": "JP", "city": "Tokyo",       "owner": "Digital Realty",        "on_net": "off_net", "verification_status": "under_verification", "description": "Digital Realty HND11 Data Centre, Mitaka, Tokyo"},
    {"id": "JKXA", "name": "Digital Realty KIX10, Osaka",    "lat": 34.86142, "lng": 135.5159, "type": "off_net", "country": "JP", "city": "Osaka",       "owner": "Digital Realty",        "on_net": "off_net", "verification_status": "under_verification", "description": "Digital Realty KIX10 Data Centre, Ibaraki-shi, Osaka"},
    {"id": "JKXB", "name": "Digital Realty KIX11, Osaka",    "lat": 34.86159, "lng": 135.5121, "type": "off_net", "country": "JP", "city": "Osaka",       "owner": "Digital Realty",        "on_net": "off_net", "verification_status": "under_verification", "description": "Digital Realty KIX11 Data Centre, Minoh, Osaka"},
    {"id": "JKXC", "name": "Digital Realty KIX12, Osaka",    "lat": 34.86235, "lng": 135.5137, "type": "off_net", "country": "JP", "city": "Osaka",       "owner": "Digital Realty",        "on_net": "off_net", "verification_status": "under_verification", "description": "Digital Realty KIX12 Data Centre, Minoh, Osaka"},
    {"id": "JKXD", "name": "Digital Realty KIX13, Osaka",    "lat": 34.86387, "lng": 135.5129, "type": "off_net", "country": "JP", "city": "Osaka",       "owner": "Digital Realty",        "on_net": "off_net", "verification_status": "under_verification", "description": "Digital Realty KIX13 Data Centre, Minoh, Osaka"},
    {"id": "JNTA", "name": "Digital Realty NRT10, Chiba",    "lat": 35.80987, "lng": 140.1216, "type": "off_net", "country": "JP", "city": "Chiba",       "owner": "Digital Realty",        "on_net": "off_net", "verification_status": "under_verification", "description": "Digital Realty NRT10 Data Centre, Inzai, Chiba"},
    # Equinix data centres – Off-Net
    {"id": "JOS2", "name": "Equinix OS2x, Osaka",            "lat": 34.86022, "lng": 135.5073, "type": "off_net", "country": "JP", "city": "Osaka",       "owner": "Equinix",               "on_net": "off_net", "verification_status": "under_verification", "description": "Equinix OS2x Data Centre, Minoo, Osaka"},
    {"id": "JOS3", "name": "Equinix OS3, Osaka",             "lat": 34.67576, "lng": 135.4956, "type": "off_net", "country": "JP", "city": "Osaka",       "owner": "Equinix",               "on_net": "off_net", "verification_status": "under_verification", "description": "Equinix OS3 Data Centre, OBP Building, Osaka"},
    {"id": "JTY1", "name": "Equinix TY1, Tokyo",             "lat": 35.57624, "lng": 139.7491, "type": "off_net", "country": "JP", "city": "Tokyo",       "owner": "Equinix",               "on_net": "off_net", "verification_status": "under_verification", "description": "Equinix TY1 Data Centre, Heiwajima, Ota-ku, Tokyo"},
    {"id": "JTYA", "name": "Equinix TY10, Tokyo",            "lat": 35.70863, "lng": 139.7443, "type": "off_net", "country": "JP", "city": "Tokyo",       "owner": "Equinix",               "on_net": "off_net", "verification_status": "under_verification", "description": "Equinix TY10 Data Centre, Suido, Bunkyo-ku, Tokyo"},
    {"id": "JTYB", "name": "Equinix TY11, Tokyo",            "lat": 35.63974, "lng": 139.7924, "type": "off_net", "country": "JP", "city": "Tokyo",       "owner": "Equinix",               "on_net": "off_net", "verification_status": "under_verification", "description": "Equinix TY11 Data Centre, Ariake, Koto-ku, Tokyo"},
    {"id": "JTYC", "name": "Equinix TY12, Tokyo",            "lat": 35.70863, "lng": 139.7443, "type": "off_net", "country": "JP", "city": "Tokyo",       "owner": "Equinix",               "on_net": "off_net", "verification_status": "under_verification", "description": "Equinix TY12 Data Centre, Izumino, Inzai, Chiba"},
    {"id": "EQ02", "name": "Equinix TY3 (EQ02), Tokyo",      "lat": 35.65663, "lng": 139.8075, "type": "off_net", "country": "JP", "city": "Tokyo",       "owner": "Equinix",               "on_net": "off_net", "verification_status": "under_verification", "description": "Equinix TY3 Data Centre, Edagawa, Koto-ku, Tokyo (cease sale)"},
    {"id": "JTY5", "name": "Equinix TY5, Tokyo",             "lat": 35.65562, "lng": 139.8042, "type": "off_net", "country": "JP", "city": "Tokyo",       "owner": "Equinix",               "on_net": "off_net", "verification_status": "under_verification", "description": "Equinix TY5 Data Centre, Edagawa, Koto-ku, Tokyo"},
    {"id": "JTY6", "name": "Equinix TY6, Tokyo",             "lat": 35.62303, "lng": 139.7481, "type": "off_net", "country": "JP", "city": "Tokyo",       "owner": "Equinix",               "on_net": "off_net", "verification_status": "under_verification", "description": "Equinix TY6 Data Centre, Higashi-Shinagawa, Tokyo"},
    {"id": "JTY7", "name": "Equinix TY7, Tokyo",             "lat": 35.65562, "lng": 139.8042, "type": "off_net", "country": "JP", "city": "Tokyo",       "owner": "Equinix",               "on_net": "off_net", "verification_status": "under_verification", "description": "Equinix TY7 Data Centre, Higashi-Shinagawa, Tokyo"},
    {"id": "JTY8", "name": "Equinix TY8, Tokyo",             "lat": 35.62207, "lng": 139.7478, "type": "off_net", "country": "JP", "city": "Tokyo",       "owner": "Equinix",               "on_net": "off_net", "verification_status": "under_verification", "description": "Equinix TY8 Data Centre, Higashi-Shinagawa, Tokyo"},
    {"id": "JTY9", "name": "Equinix TY9, Tokyo",             "lat": 35.70875, "lng": 139.7439, "type": "off_net", "country": "JP", "city": "Tokyo",       "owner": "Equinix",               "on_net": "off_net", "verification_status": "under_verification", "description": "Equinix TY9 Data Centre, Suido, Bunkyo City, Tokyo"},
    # Equinix / Telstra On-Net PoPs
    {"id": "JOS1", "name": "Equinix OS1, Osaka",             "lat": 34.67576, "lng": 135.4956, "type": "extension_pop", "country": "JP", "city": "Osaka", "owner": "Telstra International",  "on_net": "on_net",  "verification_status": "under_verification", "description": "Equinix OS1 – Telstra On-Net Extension PoP, Osaka"},
    {"id": "EQHS", "name": "Equinix TY2, Tokyo",             "lat": 35.62093, "lng": 139.7447, "type": "extension_pop", "country": "JP", "city": "Tokyo", "owner": "Telstra International",  "on_net": "on_net",  "verification_status": "under_verification", "description": "Equinix TY2 – Telstra On-Net Extension PoP, Higashi-Shinagawa, Tokyo"},
    {"id": "JTY3", "name": "Equinix TY3, Tokyo",             "lat": 35.65663, "lng": 139.8075, "type": "extension_pop", "country": "JP", "city": "Tokyo", "owner": "Telstra International",  "on_net": "on_net",  "verification_status": "under_verification", "description": "Equinix TY3 – Telstra On-Net PoP, Edagawa, Koto-ku, Tokyo"},
    {"id": "JTY4", "name": "Equinix TY4, Tokyo",             "lat": 35.68857, "lng": 139.7649, "type": "extension_pop", "country": "JP", "city": "Tokyo", "owner": "Telstra International",  "on_net": "on_net",  "verification_status": "under_verification", "description": "Equinix TY4 – Telstra On-Net Extension PoP, Otemachi Financial City, Tokyo"},
    # Telstra Primary PoPs
    {"id": "JOUA", "name": "Urban Ace Higashi-Tenma, Osaka", "lat": 34.69603, "lng": 135.5175, "type": "primary_pop",   "country": "JP", "city": "Osaka", "owner": "Telstra International",  "on_net": "on_net",  "verification_status": "under_verification", "description": "Telstra Primary PoP, Urban Ace Higashi-Tenma, Kita-ku, Osaka"},
    {"id": "JTHA", "name": "Comspace TKDS2, Tokyo",          "lat": 35.68312, "lng": 139.7745, "type": "primary_pop",   "country": "JP", "city": "Tokyo", "owner": "Telstra International",  "on_net": "on_net",  "verification_status": "under_verification", "description": "Telstra Primary PoP, Comspace Nihonbashi, Tokyo (TKDS2)"},
    {"id": "SIKO", "name": "Shin-Nikko Building, Tokyo",     "lat": 35.6621,  "lng": 139.7433, "type": "primary_pop",   "country": "JP", "city": "Tokyo", "owner": "Telstra International",  "on_net": "on_net",  "verification_status": "under_verification", "description": "Telstra Primary PoP, Shin-Nikko Building, Toranomon, Tokyo"},
    # Telstra Secondary PoPs
    {"id": "JTGD", "name": "TIS Gotenyama TKDS3, Tokyo",     "lat": 35.62546, "lng": 139.732,  "type": "secondary_pop", "country": "JP", "city": "Tokyo", "owner": "Telstra International",  "on_net": "on_net",  "verification_status": "under_verification", "description": "Telstra Secondary PoP, TIS Gotenyama, Kitashinagawa, Tokyo (TKDS3, cease sale)"},
    # Telstra Extension PoPs
    {"id": "NFP3", "name": "NF-Park, Tokyo",                 "lat": 35.60542, "lng": 139.7241, "type": "extension_pop", "country": "JP", "city": "Tokyo", "owner": "Telstra International",  "on_net": "on_net",  "verification_status": "under_verification", "description": "Telstra Extension PoP, NF-Park Building, Futabacho, Shinagawa-ku, Tokyo"},
    {"id": "NTOH", "name": "NTT-Data Otemachi, Tokyo",       "lat": 35.694,   "lng": 139.7536, "type": "extension_pop", "country": "JP", "city": "Tokyo", "owner": "Telstra International",  "on_net": "on_net",  "verification_status": "under_verification", "description": "Telstra Extension PoP, NTT-Data Otemachi Building, Chiyoda-ku, Tokyo"},
    {"id": "KDOH", "name": "KDDI Otemachi, Tokyo",           "lat": 35.68772, "lng": 139.7646, "type": "extension_pop", "country": "JP", "city": "Tokyo", "owner": "Telstra International",  "on_net": "on_net",  "verification_status": "under_verification", "description": "Telstra Extension PoP, KDDI Otemachi Building, Chiyoda-ku, Tokyo"},
    {"id": "JTAT", "name": "AT Tokyo Toyosu",                "lat": 35.6485,  "lng": 139.7925, "type": "extension_pop", "country": "JP", "city": "Tokyo", "owner": "Telstra International",  "on_net": "on_net",  "verification_status": "under_verification", "description": "Telstra Extension PoP, AT Tokyo Chuo Center, Toyosu, Koto-ku"},
    {"id": "JOSO", "name": "NTT Sonezaki DC, Osaka",         "lat": 34.70107, "lng": 135.5,    "type": "extension_pop", "country": "JP", "city": "Osaka", "owner": "Telstra International",  "on_net": "on_net",  "verification_status": "under_verification", "description": "Telstra Extension PoP, NTT Sonezaki Data Centre, Kita-ku, Osaka"},
    {"id": "NTDO", "name": "NTT-Data Dojima, Osaka",         "lat": 34.69667, "lng": 135.4981, "type": "extension_pop", "country": "JP", "city": "Osaka", "owner": "Telstra International",  "on_net": "on_net",  "verification_status": "under_verification", "description": "Telstra Extension PoP, NTT-Data Dojima Building, Kita-ku, Osaka"},
    {"id": "JTHF", "name": "Comspace TKDS1, Tokyo",          "lat": 35.68747, "lng": 139.7795, "type": "extension_pop", "country": "JP", "city": "Tokyo", "owner": "Telstra International",  "on_net": "on_net",  "verification_status": "under_verification", "description": "Telstra Data Centre, Comspace Nihonbashi, Chuo-ku, Tokyo (TKDS1, cease sale)"},
    {"id": "JTIS", "name": "TIS Building, Tokyo",            "lat": 35.66262, "lng": 139.8068, "type": "extension_pop", "country": "JP", "city": "Tokyo", "owner": "Telstra International",  "on_net": "on_net",  "verification_status": "under_verification", "description": "Telstra PoP, TIS Dai-san Center, Shiohama, Koto-ku, Tokyo"},
    {"id": "JTSN", "name": "Microsoft JTSN, Tokyo",          "lat": 35.6673,  "lng": 139.83,   "type": "extension_pop", "country": "JP", "city": "Tokyo", "owner": "Microsoft",              "on_net": "on_net",  "verification_status": "under_verification", "description": "Microsoft Customer PoP, Shinsuna, Koto-ku, Tokyo"},
    # Telstra On-Net cable landing stations
    {"id": "JWLS", "name": "Wada Cable Landing Station",     "lat": 35.0202,  "lng": 139.9812, "type": "landing_station", "country": "JP", "city": "Wada",        "owner": "Telstra International", "on_net": "on_net", "verification_status": "under_verification", "description": "Wada CLS, Minamiboso – RNAL cable"},
    {"id": "JAAJ", "name": "Ajigura Cable Landing Station",  "lat": 36.3822,  "lng": 140.6092, "type": "landing_station", "country": "JP", "city": "Hitachinaka", "owner": "Telstra International", "on_net": "on_net", "verification_status": "under_verification", "description": "Ajigura CLS, Hitachinaka, Ibaraki – EAC cable"},
    {"id": "CHCC", "name": "Chikura CLS (C2C)",              "lat": 34.97012, "lng": 139.9602, "type": "landing_station", "country": "JP", "city": "Chikura",     "owner": "Telstra International", "on_net": "on_net", "verification_status": "under_verification", "description": "Chikura Cable Landing Station (C2C cable), Minamiboso, Chiba"},
    {"id": "CKKD", "name": "Chikura CLS (EAC)",              "lat": 34.97012, "lng": 139.9602, "type": "landing_station", "country": "JP", "city": "Chikura",     "owner": "Telstra International", "on_net": "on_net", "verification_status": "under_verification", "description": "Chikura Cable Landing Station (EAC cable), Minamiboso, Chiba"},
    {"id": "EMIC", "name": "Emi Cable Landing Station",      "lat": 35.47497, "lng": 138.0948, "type": "landing_station", "country": "JP", "city": "Emi",         "owner": "Telstra International", "on_net": "on_net", "verification_status": "under_verification", "description": "Emi CLS, Kamogawa, Chiba – TGN cable"},
    {"id": "MJLS", "name": "Maruyama Cable Landing Station", "lat": 35.47497, "lng": 138.0948, "type": "landing_station", "country": "JP", "city": "Maruyama",    "owner": "Telstra International", "on_net": "on_net", "verification_status": "under_verification", "description": "Maruyama CLS, Shirako, Minamiboso – AJC cable"},
    {"id": "JSOM", "name": "Shima CLS (C2C, Arteria)",       "lat": 34.31397, "lng": 136.8689, "type": "landing_station", "country": "JP", "city": "Shima",       "owner": "Telstra International", "on_net": "on_net", "verification_status": "under_verification", "description": "Shima CLS (C2C cable), Ago-cho, Shima City"},
    {"id": "SMCC", "name": "KDDI Shima CLS (C2C)",           "lat": 34.32816, "lng": 136.8297, "type": "landing_station", "country": "JP", "city": "Shima",       "owner": "Telstra International", "on_net": "on_net", "verification_status": "under_verification", "description": "KDDI Shima CLS (C2C cable), Ago-cho, Shima City"},
    # Telstra On-Net repeater infrastructure
    {"id": "JKHF", "name": "Kamisu Repeater",                "lat": 35.90713, "lng": 140.6638, "type": "extension_pop", "country": "JP", "city": "Kamisu",      "owner": "Telstra International", "on_net": "on_net", "verification_status": "under_verification", "description": "Kamisu Repeater Station, Higashi-Fukashiba, Kamisu City"},
    {"id": "JAAS", "name": "Tokyo Repeater (Abiko)",         "lat": 35.8755,  "lng": 139.9976, "type": "extension_pop", "country": "JP", "city": "Abiko",       "owner": "Telstra International", "on_net": "on_net", "verification_status": "under_verification", "description": "Tokyo Repeater Station, Daida, Abiko City"},
    # Off-Net third-party infrastructure
    {"id": "KALS", "name": "Kitaibaraki CLS (NTT)",          "lat": 36.80191, "lng": 140.751,  "type": "off_net",       "country": "JP", "city": "Kitaibaraki", "owner": "NTT",                   "on_net": "off_net", "verification_status": "under_verification", "description": "NTT Kitaibaraki CLS (JUC)"},
    {"id": "KJLS", "name": "Kitaibaraki CLS (NTT-2)",        "lat": 36.80191, "lng": 140.751,  "type": "off_net",       "country": "JP", "city": "Kitaibaraki", "owner": "NTT",                   "on_net": "off_net", "verification_status": "under_verification", "description": "NTT Kitaibaraki CLS 2 (JUC)"},
    {"id": "SSNT", "name": "NTT Shima CLS",                  "lat": 34.32702, "lng": 136.8748, "type": "off_net",       "country": "JP", "city": "Shima",       "owner": "NTT",                   "on_net": "off_net", "verification_status": "under_verification", "description": "NTT Shima CLS, Anori Ago-cho"},
    {"id": "JOGD", "name": "TIS Osaka",                      "lat": 34.86225, "lng": 135.518,  "type": "off_net",       "country": "JP", "city": "Osaka",       "owner": "TIS",                   "on_net": "off_net", "verification_status": "under_verification", "description": "TIS Saitohamabuki Data Centre, Ibaraki-shi, Osaka"},
]


def _run_migration_033(cur) -> None:
    """Insert Japan PoP and cable landing station nodes (skips any that already exist)."""
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO nodes (id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(n["id"], json.dumps(n)) for n in _JAPAN_NODES],
    )


def _run_migration_034(cur) -> None:
    """Ensure any off_net type nodes (created before on_net was populated) have on_net set."""
    cur.execute(
        """UPDATE nodes
           SET data = jsonb_set(data, '{on_net}', '"off_net"'::jsonb)
           WHERE data->>'type' = 'off_net'
             AND data->>'on_net' IS NULL"""
    )


# ── Migration 035 ─────────────────────────────────────────────────────────────
# Remove old Japan PoPs and replaced CLSs; reroute subsea segments to the new
# CLS nodes added in migration 033; delete all Japan terrestrial backhaul.

_OLD_JP_POPS = [
    'NGO1', 'EQ-TY3', 'EQ-OS1', 'TYO2', 'OSA2',
    'EQ-TY1', 'EQ-TY2', 'EQ-OS2', 'EQ-NG1',
]

_JP_CLS_REPLACEMENTS = {
    'AJIG': 'JAAJ',
    'CHKR': 'CHCC',
    'SHMA': 'JSOM',
    'TYO1': 'MJLS',
}


def _run_migration_035(cur) -> None:
    """Remove old Japan PoPs/CLSs, reroute their subsea connections to the new
    CLS equivalents added in migration 033, and delete all JP terrestrial segments."""

    # 1. Reroute subsea segment endpoints from old CLSs to new replacements
    for old_id, new_id in _JP_CLS_REPLACEMENTS.items():
        cur.execute(
            "UPDATE segments SET data = jsonb_set(data, '{start_node_id}', %s::jsonb) "
            "WHERE data->>'start_node_id' = %s",
            (json.dumps(new_id), old_id),
        )
        cur.execute(
            "UPDATE segments SET data = jsonb_set(data, '{end_node_id}', %s::jsonb) "
            "WHERE data->>'end_node_id' = %s",
            (json.dumps(new_id), old_id),
        )

    # 2. Delete terrestrial segments where both endpoints are Japan nodes
    cur.execute("""
        DELETE FROM capacity
        WHERE segment_id IN (
            SELECT id FROM segments
            WHERE data->>'type' = 'terrestrial'
              AND data->>'start_node_id' IN (SELECT id FROM nodes WHERE data->>'country' = 'JP')
              AND data->>'end_node_id'   IN (SELECT id FROM nodes WHERE data->>'country' = 'JP')
        )
    """)
    cur.execute("""
        DELETE FROM segments
        WHERE data->>'type' = 'terrestrial'
          AND data->>'start_node_id' IN (SELECT id FROM nodes WHERE data->>'country' = 'JP')
          AND data->>'end_node_id'   IN (SELECT id FROM nodes WHERE data->>'country' = 'JP')
    """)

    # 3. Delete capacity + any remaining segments that still reference deleted PoP node IDs
    cur.execute(
        "DELETE FROM capacity WHERE segment_id IN ("
        "  SELECT id FROM segments WHERE"
        "  data->>'start_node_id' = ANY(%s) OR data->>'end_node_id' = ANY(%s)"
        ")",
        (_OLD_JP_POPS, _OLD_JP_POPS),
    )
    cur.execute(
        "DELETE FROM segments WHERE data->>'start_node_id' = ANY(%s) OR data->>'end_node_id' = ANY(%s)",
        (_OLD_JP_POPS, _OLD_JP_POPS),
    )

    # 4. Delete old nodes (replaced CLSs + old PoPs)
    nodes_to_delete = list(_JP_CLS_REPLACEMENTS.keys()) + _OLD_JP_POPS
    cur.execute("DELETE FROM nodes WHERE id = ANY(%s)", (nodes_to_delete,))


# ── Migration 036 ─────────────────────────────────────────────────────────────
# Japan terrestrial backhaul segments and MJLS coordinate correction.

_JP_TERRESTRIAL_SEGMENTS = [
    # ── Tokyo metro cross-connects and short hops ────────────────────────────
    {"id": "TERRESTRIAL_JP09",   "name": "Terrestrial Equinix TY2–Comspace TKDS2",          "system_id": "TERRESTRIAL", "start_node_id": "EQHS", "end_node_id": "JTHA", "type": "terrestrial", "length_km":  9,  "latency": 0.045, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP10",   "name": "Terrestrial Shin-Nikko–Equinix TY2",               "system_id": "TERRESTRIAL", "start_node_id": "SIKO", "end_node_id": "EQHS", "type": "terrestrial", "length_km":  6,  "latency": 0.03,  "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP12",   "name": "Terrestrial Equinix TY2–AT Tokyo Toyosu",          "system_id": "TERRESTRIAL", "start_node_id": "EQHS", "end_node_id": "JTAT", "type": "terrestrial", "length_km":  6,  "latency": 0.03,  "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP15",   "name": "Terrestrial Shin-Nikko–AT Tokyo Toyosu",           "system_id": "TERRESTRIAL", "start_node_id": "SIKO", "end_node_id": "JTAT", "type": "terrestrial", "length_km":  6,  "latency": 0.03,  "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP16",   "name": "Terrestrial KDDI Otemachi–Comspace TKDS2",         "system_id": "TERRESTRIAL", "start_node_id": "KDOH", "end_node_id": "JTHA", "type": "terrestrial", "length_km":  1,  "latency": 0.005, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP18",   "name": "Terrestrial Comspace TKDS2–AT Tokyo Toyosu",       "system_id": "TERRESTRIAL", "start_node_id": "JTHA", "end_node_id": "JTAT", "type": "terrestrial", "length_km":  5,  "latency": 0.025, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP27",   "name": "Terrestrial NF-Park–Equinix TY2",                  "system_id": "TERRESTRIAL", "start_node_id": "NFP3", "end_node_id": "EQHS", "type": "terrestrial", "length_km":  3,  "latency": 0.015, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP28",   "name": "Terrestrial NF-Park–Shin-Nikko Building",          "system_id": "TERRESTRIAL", "start_node_id": "NFP3", "end_node_id": "SIKO", "type": "terrestrial", "length_km":  8,  "latency": 0.04,  "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP30",   "name": "Terrestrial Shin-Nikko–KDDI Otemachi",             "system_id": "TERRESTRIAL", "start_node_id": "SIKO", "end_node_id": "KDOH", "type": "terrestrial", "length_km":  4,  "latency": 0.02,  "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP31",   "name": "Terrestrial Equinix TY4–Shin-Nikko Building",      "system_id": "TERRESTRIAL", "start_node_id": "JTY4", "end_node_id": "SIKO", "type": "terrestrial", "length_km":  4,  "latency": 0.02,  "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP31_IP","name": "Terrestrial KDDI Otemachi–NTT-Data Otemachi",      "system_id": "TERRESTRIAL", "start_node_id": "KDOH", "end_node_id": "NTOH", "type": "terrestrial", "length_km":  1,  "latency": 0.005, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP32",   "name": "Terrestrial Equinix TY4–Comspace TKDS2",           "system_id": "TERRESTRIAL", "start_node_id": "JTY4", "end_node_id": "JTHA", "type": "terrestrial", "length_km":  1,  "latency": 0.005, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP32_IP","name": "Terrestrial Comspace TKDS2–NTT-Data Otemachi",     "system_id": "TERRESTRIAL", "start_node_id": "JTHA", "end_node_id": "NTOH", "type": "terrestrial", "length_km":  3,  "latency": 0.015, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    # ── Tokyo → Ajigura (Hitachinaka) ───────────────────────────────────────
    {"id": "TERRESTRIAL_JP29",   "name": "Terrestrial Shin-Nikko–Ajigura CLS",               "system_id": "TERRESTRIAL", "start_node_id": "SIKO", "end_node_id": "JAAJ", "type": "terrestrial", "length_km": 128, "latency": 0.64,  "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP17a",  "name": "Terrestrial Ajigura CLS–Kamisu Repeater",          "system_id": "TERRESTRIAL", "start_node_id": "JAAJ", "end_node_id": "JKHF", "type": "terrestrial", "length_km": 61,  "latency": 0.305, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP17b",  "name": "Terrestrial Kamisu Repeater–Comspace TKDS2",       "system_id": "TERRESTRIAL", "start_node_id": "JKHF", "end_node_id": "JTHA", "type": "terrestrial", "length_km": 97,  "latency": 0.485, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    # ── Tokyo → Boso Peninsula CLSs ─────────────────────────────────────────
    {"id": "TERRESTRIAL_JP11",   "name": "Terrestrial Equinix TY2–Chikura CLS",              "system_id": "TERRESTRIAL", "start_node_id": "EQHS", "end_node_id": "CHCC", "type": "terrestrial", "length_km": 86,  "latency": 0.43,  "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP14",   "name": "Terrestrial AT Tokyo Toyosu–Wada CLS",             "system_id": "TERRESTRIAL", "start_node_id": "JTAT", "end_node_id": "JWLS", "type": "terrestrial", "length_km": 83,  "latency": 0.415, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    # ── Boso Peninsula CLS interconnects ────────────────────────────────────
    {"id": "TERRESTRIAL_JP22",   "name": "Terrestrial Chikura CLS (C2C)–Wada CLS",          "system_id": "TERRESTRIAL", "start_node_id": "CHCC", "end_node_id": "JWLS", "type": "terrestrial", "length_km":  7,  "latency": 0.035, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP23",   "name": "Terrestrial Chikura CLS (EAC)–Wada CLS",          "system_id": "TERRESTRIAL", "start_node_id": "CKKD", "end_node_id": "JWLS", "type": "terrestrial", "length_km":  7,  "latency": 0.035, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP24",   "name": "Terrestrial Maruyama CLS–Wada CLS",                "system_id": "TERRESTRIAL", "start_node_id": "MJLS", "end_node_id": "JWLS", "type": "terrestrial", "length_km": 10,  "latency": 0.05,  "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP25",   "name": "Terrestrial Chikura CLS (C2C)–Maruyama CLS",      "system_id": "TERRESTRIAL", "start_node_id": "CHCC", "end_node_id": "MJLS", "type": "terrestrial", "length_km":  3,  "latency": 0.015, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "XCONN_JP_CHCC_CKKD", "name": "Chikura CLS Cross-Connect (C2C–EAC)",             "system_id": "TERRESTRIAL", "start_node_id": "CHCC", "end_node_id": "CKKD", "type": "terrestrial", "length_km":  1,  "latency": 0.005, "reliability": 0.9999, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    # ── Subsea short-link (Unity cable, Chikura–Wada) ───────────────────────
    {"id": "UNITY-CHK-WAD",      "name": "Subsea Link Unity Chikura–Wada",                   "system_id": "UNITY",       "start_node_id": "CKKD", "end_node_id": "JWLS", "type": "wet",         "length_km":  7,  "latency": 0.035, "reliability": 0.9999, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    # ── Osaka metro ─────────────────────────────────────────────────────────
    {"id": "TERRESTRIAL_JP01",   "name": "Terrestrial Urban Ace–Equinix OS1",                "system_id": "TERRESTRIAL", "start_node_id": "JOUA", "end_node_id": "JOS1", "type": "terrestrial", "length_km":  4,  "latency": 0.02,  "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP04b",  "name": "Terrestrial NTT-Data Dojima–Urban Ace",            "system_id": "TERRESTRIAL", "start_node_id": "NTDO", "end_node_id": "JOUA", "type": "terrestrial", "length_km":  2,  "latency": 0.01,  "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP05",   "name": "Terrestrial NTT-Data Dojima–Equinix OS1",          "system_id": "TERRESTRIAL", "start_node_id": "NTDO", "end_node_id": "JOS1", "type": "terrestrial", "length_km":  3,  "latency": 0.015, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    # ── Osaka → Shima CLSs ──────────────────────────────────────────────────
    {"id": "TERRESTRIAL_JP02",   "name": "Terrestrial Equinix OS1–KDDI Shima CLS",           "system_id": "TERRESTRIAL", "start_node_id": "JOS1", "end_node_id": "SMCC", "type": "terrestrial", "length_km": 147, "latency": 0.735, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP03",   "name": "Terrestrial Urban Ace–Shima CLS (C2C)",            "system_id": "TERRESTRIAL", "start_node_id": "JOUA", "end_node_id": "JSOM", "type": "terrestrial", "length_km": 151, "latency": 0.755, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP06a",  "name": "Terrestrial Shima CLS–KDDI Shima (diverse A)",    "system_id": "TERRESTRIAL", "start_node_id": "JSOM", "end_node_id": "SMCC", "type": "terrestrial", "length_km":  5,  "latency": 0.025, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP06b",  "name": "Terrestrial Shima CLS–KDDI Shima (diverse B)",    "system_id": "TERRESTRIAL", "start_node_id": "JSOM", "end_node_id": "SMCC", "type": "terrestrial", "length_km":  5,  "latency": 0.025, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "TERRESTRIAL_JP06c",  "name": "Terrestrial Shima CLS–KDDI Shima (diverse C)",    "system_id": "TERRESTRIAL", "start_node_id": "JSOM", "end_node_id": "SMCC", "type": "terrestrial", "length_km":  5,  "latency": 0.025, "reliability": 0.9998, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
    {"id": "XCONN_JP_JSOM_SSNT", "name": "Shima CLS Cross-Connect (Arteria–NTT)",           "system_id": "TERRESTRIAL", "start_node_id": "JSOM", "end_node_id": "SSNT", "type": "terrestrial", "length_km":  2,  "latency": 0.01,  "reliability": 0.9999, "cost_weight": 1, "ownership": "owned", "verification_status": "draft"},
]

_JP_TERRESTRIAL_CAPACITY = [
    {"segment_id": "TERRESTRIAL_JP01",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP02",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP03",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP04b",  "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP05",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP06a",  "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP06b",  "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP06c",  "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP09",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP10",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP11",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP12",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP14",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP15",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP16",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP17a",  "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP17b",  "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP18",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP22",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP23",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP24",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP25",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP27",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP28",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP29",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP30",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP31",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP31_IP","total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP32",   "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "TERRESTRIAL_JP32_IP","total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "XCONN_JP_CHCC_CKKD","total_capacity_t": 2.0, "available_capacity_t": 1.0},
    {"segment_id": "UNITY-CHK-WAD",      "total_capacity_t": 1.0, "available_capacity_t": 0.5},
    {"segment_id": "XCONN_JP_JSOM_SSNT","total_capacity_t": 2.0, "available_capacity_t": 1.0},
]


def _run_migration_036(cur) -> None:
    """Insert Japan terrestrial backhaul segments and fix MJLS coordinates."""
    # Fix MJLS coordinates (was erroneously shared with EMIC; estimated Boso Peninsula location)
    cur.execute(
        "UPDATE nodes SET data = jsonb_set(jsonb_set(data, '{lat}', '34.945'::jsonb), '{lng}', '139.955'::jsonb) "
        "WHERE id = 'MJLS'"
    )
    # Insert segments
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO segments (id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(s["id"], json.dumps(s)) for s in _JP_TERRESTRIAL_SEGMENTS],
    )
    # Insert capacity
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO capacity (segment_id, data) VALUES %s ON CONFLICT DO NOTHING",
        [(c["segment_id"], json.dumps(c)) for c in _JP_TERRESTRIAL_CAPACITY],
    )


def _run_migration_037(cur) -> None:
    """Reroute C2C segments S4 and S3C to SMCC (KDDI Shima CLS)."""
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{end_node_id}', '\"SMCC\"'::jsonb) "
        "WHERE id = 'C2C-S4'"
    )
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{end_node_id}', '\"SMCC\"'::jsonb) "
        "WHERE id = 'C2C-S3C'"
    )


def _run_migration_038(cur) -> None:
    """Reroute subsea segments to correct Japan CLS endpoints: C2C-S5→CHCC, UNITY/FASTER→CKKD."""
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{start_node_id}', '\"CHCC\"'::jsonb) "
        "WHERE id = 'C2C-S5'"
    )
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{start_node_id}', '\"CKKD\"'::jsonb) "
        "WHERE id = 'UNITY-CHK-HAW'"
    )
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{end_node_id}', '\"CKKD\"'::jsonb) "
        "WHERE id = 'FASTER-BDN-CHK'"
    )


def _run_migration_039(cur) -> None:
    """Add waypoints to Japan-touching subsea segments for map readability."""
    _WP: list[tuple[str, str]] = [
        # US West Coast → Japan (North Pacific great-circle arcs, separated by latitude)
        ("TOPAZ-SEA-TYO",    "[[49,-145],[52,-168],[50,173],[44,157],[39,148]]"),
        ("PC1N-HPT-AJI",     "[[48,-142],[51,-165],[48,177],[43,160],[40,150]]"),
        ("FASTER-BDN-CHK",   "[[46,-147],[48,-170],[45,176],[40,158],[36,148]]"),
        ("FASTER-BDN-SHM",   "[[46,-148],[48,-171],[45,174],[40,156],[36,144]]"),
        ("PC1S-GRB-SHM",     "[[37,-140],[40,-155],[43,-172],[40,175],[37,158],[35,146]]"),
        ("JUNO-BU-GRB",      "[[37,155],[42,170],[45,-175],[43,-155],[39,-135]]"),
        ("JUPITER-SEA-BU",   "[[49,-145],[52,-168],[50,-180],[46,165]]"),
        # Guam ↔ Chikura/Maruyama (offset each direction)
        ("AJC-GUM-TYO",      "[[19,143],[26,141]]"),
        ("JGA-TYO-GUM",      "[[25,143],[18,145]]"),
        # Taiwan → Japan (three cables fanned through East China Sea)
        ("SJC2-TPE-TYO",     "[[27,124],[30,129],[33,135]]"),
        ("APG-TPE-TYO",      "[[28,126],[31,131],[33,137]]"),
        ("ADC-TYO-TPE",      "[[32,137],[29,133],[26,127]]"),
        # Philippine Sea → Japan
        ("APRICOT-BU-TYO",   "[[25,130],[30,136]]"),
        ("APRICOT-BU-OSA",   "[[25,128],[30,132]]"),
        ("PROA-OSA-TIN",     "[[30,138],[24,143],[19,145]]"),
        # Chikura east
        ("UNITY-CHK-HAW",    "[[37,150],[41,167],[38,180],[33,-170],[27,-162]]"),
        ("C2C-S5",           "[[30,135],[24,130],[19,126]]"),
        ("JUNO-MNB-BU",      "[[34.9,141.5]]"),
        ("JUNO-SHM-BU",      "[[34.0,139.0],[34.5,141.0]]"),
        # Sea of Japan / Korea → Japan
        ("EAC-K",            "[[36.8,130],[37,135],[37,139]]"),
        ("SJC2-TYO-ICN",     "[[36,136],[37,131]]"),
        ("C2C-S3C",          "[[34.8,131],[34.5,134],[34.3,136]]"),
        # Japan coast south
        ("EAC-A",            "[[29,129],[32,134]]"),
        ("EAC-L",            "[[35.8,140.0],[35.2,138.5],[34.7,137.5]]"),
        ("JUPITER-BU-TYO",   "[[35,150]]"),
    ]
    for seg_id, wp_json in _WP:
        cur.execute(
            "UPDATE segments "
            "SET data = jsonb_set(data, '{waypoints}', %s::jsonb) "
            "WHERE id = %s",
            (wp_json, seg_id),
        )


def _run_migration_040(cur) -> None:
    """Add waypoints to Japan terrestrial backhaul segments for map readability."""
    _WP: list[tuple[str, str]] = [
        # ── Tokyo inner cluster (short arcs to make each link identifiable) ──
        ("TERRESTRIAL_JP09",   "[[35.65,139.762]]"),          # EQHS→JTHA, bow east
        ("TERRESTRIAL_JP10",   "[[35.640,139.742]]"),         # SIKO→EQHS, bow west
        ("TERRESTRIAL_JP12",   "[[35.633,139.771]]"),         # EQHS→JTAT, bow south
        ("TERRESTRIAL_JP15",   "[[35.656,139.770]]"),         # SIKO→JTAT, bow north
        ("TERRESTRIAL_JP16",   "[[35.686,139.770]]"),         # KDOH→JTHA, short bow north
        ("TERRESTRIAL_JP18",   "[[35.664,139.784]]"),         # JTHA→JTAT, bow east
        ("TERRESTRIAL_JP27",   "[[35.613,139.732]]"),         # NFP3→EQHS, bow west
        ("TERRESTRIAL_JP28",   "[[35.632,139.730]]"),         # NFP3→SIKO, bow west
        ("TERRESTRIAL_JP30",   "[[35.675,139.756]]"),         # SIKO→KDOH, bow east
        ("TERRESTRIAL_JP31",   "[[35.675,139.752]]"),         # JTY4→SIKO, bow west
        ("TERRESTRIAL_JP31_IP","[[35.691,139.758]]"),         # KDOH→NTOH, bow north
        ("TERRESTRIAL_JP32",   "[[35.686,139.769]]"),         # JTY4→JTHA, short bow east
        ("TERRESTRIAL_JP32_IP","[[35.690,139.764]]"),         # JTHA→NTOH, bow east
        # ── Tokyo → Chikura / Boso Peninsula ──
        ("TERRESTRIAL_JP11",   "[[35.30,139.85]]"),           # EQHS→CHCC, Boso west coast
        ("TERRESTRIAL_JP14",   "[[35.28,139.92]]"),           # JTAT→JWLS, Boso east coast
        # ── Tokyo → Ibaraki / Ajigaura ──
        ("TERRESTRIAL_JP29",   "[[35.90,139.85],[36.10,140.10],[36.25,140.40]]"),  # SIKO→JAAJ
        # ── Ajigaura → Tokyo via coast ──
        ("TERRESTRIAL_JP17a",  "[[36.15,140.64]]"),           # JAAJ→JKHF, Ibaraki coast
        ("TERRESTRIAL_JP17b",  "[[35.79,140.30],[35.72,140.05]]"), # JKHF→JTHA, SW to Tokyo
        # ── Chikura cluster (MJLS/CHCC/CKKD/JWLS, offset each run) ──
        ("TERRESTRIAL_JP22",   "[[34.990,139.944]]"),         # CHCC→JWLS, bow west
        ("TERRESTRIAL_JP23",   "[[34.998,139.975]]"),         # CKKD→JWLS, bow east
        ("TERRESTRIAL_JP24",   "[[34.985,139.967]]"),         # MJLS→JWLS
        ("TERRESTRIAL_JP25",   "[[34.957,139.957]]"),         # CHCC→MJLS, tiny bow south
        # ── Osaka cluster (tiny arcs) ──
        ("TERRESTRIAL_JP01",   "[[34.685,135.507]]"),         # JOUA→JOS1, bow south
        ("TERRESTRIAL_JP04b",  "[[34.697,135.508]]"),         # NTDO→JOUA, bow east
        ("TERRESTRIAL_JP05",   "[[34.685,135.494]]"),         # NTDO→JOS1, bow west
        # ── Osaka → Shima (long runs along Kinki/Mie coast) ──
        ("TERRESTRIAL_JP02",   "[[34.45,135.9],[34.30,136.5]]"),  # JOS1→SMCC
        ("TERRESTRIAL_JP03",   "[[34.55,136.0],[34.40,136.5]]"),  # JOUA→JSOM (slightly north)
        # ── Shima cross-connects (fan three JSOM→SMCC runs) ──
        ("TERRESTRIAL_JP06a",  "[[34.33,136.855]]"),          # center
        ("TERRESTRIAL_JP06b",  "[[34.34,136.845]]"),          # bow north
        ("TERRESTRIAL_JP06c",  "[[34.30,136.845]]"),          # bow south
        # ── Very short cross-connects ──
        ("XCONN_JP_CHCC_CKKD", "[[34.975,139.965]]"),
        ("XCONN_JP_JSOM_SSNT", "[[34.320,136.873]]"),
    ]
    for seg_id, wp_json in _WP:
        cur.execute(
            "UPDATE segments "
            "SET data = jsonb_set(data, '{waypoints}', %s::jsonb) "
            "WHERE id = %s",
            (wp_json, seg_id),
        )


def _run_migration_041(cur) -> None:
    """Populate missing latency values for C2C and EAC wet segments (length_km / 200 ms)."""
    _LATENCY: list[tuple[str, float]] = [
        # C2C segments
        ("C2C-S1",   5.75),   # 1150 km
        ("C2C-S2A",  2.0),    # 400 km
        ("C2C-S2B",  2.3),    # 460 km
        ("C2C-S3A",  5.6),    # 1120 km
        ("C2C-S3B",  4.65),   # 930 km
        ("C2C-S3C",  4.35),   # 870 km
        ("C2C-S4",   1.75),   # 350 km
        ("C2C-S5",   16.5),   # 3300 km
        ("C2C-S6",   11.7),   # 2340 km
        ("C2C-S7",   13.0),   # 2600 km
        # EAC segments
        ("EAC-2A1",  13.0),   # 2600 km
        ("EAC-2B1",  3.65),   # 730 km
        ("EAC-2B2",  14.0),   # 2800 km
        ("EAC-A",    7.0),    # 1400 km
        ("EAC-B",    3.0),    # 600 km
        ("EAC-C",    7.25),   # 1450 km
        ("EAC-D",    1.9),    # 380 km
        ("EAC-E",    2.65),   # 530 km
        ("EAC-F1",   7.0),    # 1400 km
        ("EAC-F2",   2.3),    # 460 km
        ("EAC-K",    8.0),    # 1600 km
        ("EAC-L",    2.4),    # 480 km
        ("EAC-M",    1.85),   # 370 km
    ]
    for seg_id, latency in _LATENCY:
        cur.execute(
            "UPDATE segments "
            "SET data = jsonb_set(data, '{latency}', %s::jsonb) "
            "WHERE id = %s",
            (str(latency), seg_id),
        )


def _run_migration_042(cur) -> None:
    """Add RNAL cable system, two new landing nodes (KOLS, TUCN),
    four wet segments (E, F, DC, BA) and initial capacity entries."""

    # ── System ──────────────────────────────────────────────────────────────
    cur.execute(
        "INSERT INTO systems (id, data) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
        ("RNAL", json.dumps({"id": "RNAL", "name": "RNAL", "description": "Regional NEC Asia Link — ring topology connecting Hong Kong, Korea, Japan and Taiwan via two paths.", "margin": 7})),
    )

    # ── Nodes ────────────────────────────────────────────────────────────────
    _NODES = [
        {
            "id": "KOLS",
            "name": "Pusan Cable Landing Station",
            "lat": 35.2418,
            "lng": 129.2228,
            "type": "landing_station",
            "country": "KR",
            "city": "Busan",
            "owner": "Telstra International",
            "on_net": "on_net",
            "verification_status": "draft",
        },
        {
            "id": "TUCN",
            "name": "Toucheng Cable Landing Station",
            "lat": 24.8579,
            "lng": 121.8431,
            "type": "landing_station",
            "country": "TW",
            "city": "Toucheng",
            "owner": "Telstra International",
            "on_net": "on_net",
            "verification_status": "draft",
        },
    ]
    for node in _NODES:
        cur.execute(
            "INSERT INTO nodes (id, data) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
            (node["id"], json.dumps(node)),
        )

    # ── Segments ─────────────────────────────────────────────────────────────
    _SEGMENTS = [
        {
            "id": "RNAL-E",
            "name": "RNAL Segment E — Hong Kong to Pusan",
            "system_id": "RNAL",
            "start_node_id": "TGFK",
            "end_node_id": "KOLS",
            "type": "wet",
            "length_km": 2830,
            "latency": 14.15,
            "reliability": 0.9990,
            "cost_weight": 10,
            "ownership": "consortium",
        },
        {
            "id": "RNAL-F",
            "name": "RNAL Segment F — Pusan to Wada",
            "system_id": "RNAL",
            "start_node_id": "KOLS",
            "end_node_id": "JWLS",
            "type": "wet",
            "length_km": 2210,
            "latency": 11.05,
            "reliability": 0.9990,
            "cost_weight": 10,
            "ownership": "consortium",
        },
        {
            "id": "RNAL-DC",
            "name": "RNAL Segments D,C — Hong Kong to Toucheng",
            "system_id": "RNAL",
            "start_node_id": "TGFK",
            "end_node_id": "TUCN",
            "type": "wet",
            "length_km": 1984,
            "latency": 9.92,
            "reliability": 0.9990,
            "cost_weight": 10,
            "ownership": "consortium",
        },
        {
            "id": "RNAL-BA",
            "name": "RNAL Segments B,A — Toucheng to Wada",
            "system_id": "RNAL",
            "start_node_id": "TUCN",
            "end_node_id": "JWLS",
            "type": "wet",
            "length_km": 2741,
            "latency": 13.71,
            "reliability": 0.9990,
            "cost_weight": 10,
            "ownership": "consortium",
        },
    ]
    for seg in _SEGMENTS:
        cur.execute(
            "INSERT INTO segments (id, data) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
            (seg["id"], json.dumps(seg)),
        )

    # ── Capacity ─────────────────────────────────────────────────────────────
    for seg in _SEGMENTS:
        entry = {
            "segment_id": seg["id"],
            "total_capacity_t": 0.64,
            "available_capacity_t": 0.4,
        }
        cur.execute(
            "INSERT INTO capacity (segment_id, data) VALUES (%s, %s) ON CONFLICT (segment_id) DO NOTHING",
            (seg["id"], json.dumps(entry)),
        )


def _run_migration_043(cur) -> None:
    """Replace Korea nodes with corrected set from CRM data.

    Deletes legacy nodes (ICN1, ICN2, PUS1, SDRI, EQ-SL1, EQ-BS1) and their
    dependent terrestrial/Equinix segments, then:
      - Updates KOLS (corrected coords, name, type → extension_pop)
      - Inserts 8 new KR nodes: KRBX, PUCC, KSSD, DDGG, KSYD, KSSR, KBGG, KSGG
      - Re-wires C2C wet segments: PUS1 → PUCC
      - Re-wires EAC wet segments: SDRI → KSSR
    Terrestrial backhauls will be reconnected in a subsequent migration.
    """

    # ── Remove segments that reference deleted nodes ─────────────────────────
    _DEL_SEGS = [
        "TERRESTRIAL_KR01", "TERRESTRIAL_KR02", "TERRESTRIAL_KR03", "TERRESTRIAL_KR04",
        "EQ_KR_SL01", "EQ_KR_BS01",
        "SJC2-TYO-ICN",   # stranded — SJC2 Korea branch will be reconnected later
    ]
    for sid in _DEL_SEGS:
        cur.execute("DELETE FROM segments WHERE id = %s", (sid,))
        cur.execute("DELETE FROM capacity WHERE segment_id = %s", (sid,))

    # ── Delete legacy Korea nodes ─────────────────────────────────────────────
    for nid in ("ICN1", "ICN2", "PUS1", "SDRI", "EQ-SL1", "EQ-BS1"):
        cur.execute("DELETE FROM nodes WHERE id = %s", (nid,))

    # ── Update KOLS: corrected coordinates, name and type ────────────────────
    cur.execute(
        "UPDATE nodes SET data = data || %s::jsonb WHERE id = 'KOLS'",
        (json.dumps({
            "name": "Busan KT Songjeong",
            "lat":  35.1782,
            "lng":  129.1958,
            "type": "extension_pop",
            "city": "Busan",
        }),),
    )

    # ── Insert 8 new Korea nodes ──────────────────────────────────────────────
    _NEW_KR_NODES = [
        {
            "id": "KRBX", "name": "KRX Data Center Busan",
            "lat": 35.13825, "lng": 129.0641,
            "type": "extension_pop", "country": "KR", "city": "Busan",
            "owner": "Telstra International", "on_net": "on_net", "verification_status": "draft",
        },
        {
            "id": "PUCC", "name": "Busan C2C CLS",
            "lat": 35.17955, "lng": 129.0756,
            "type": "landing_station", "country": "KR", "city": "Busan",
            "owner": "Telstra International", "on_net": "on_net", "verification_status": "draft",
        },
        {
            "id": "KSSD", "name": "Seoul LGU+",
            "lat": 37.48329, "lng": 127.0221,
            "type": "primary_pop", "country": "KR", "city": "Seoul",
            "owner": "Telstra International", "on_net": "on_net", "verification_status": "draft",
        },
        {
            "id": "DDGG", "name": "Seoul Daelim Acrotel",
            "lat": 37.48814, "lng": 127.0512,
            "type": "extension_pop", "country": "KR", "city": "Seoul",
            "owner": "Telstra International", "on_net": "on_net", "verification_status": "draft",
        },
        {
            "id": "KSYD", "name": "Seoul Yeoksam",
            "lat": 37.50028, "lng": 127.034,
            "type": "primary_pop", "country": "KR", "city": "Seoul",
            "owner": "Telstra International", "on_net": "on_net", "verification_status": "draft",
        },
        {
            "id": "KSSR", "name": "Taean CLS",
            "lat": 36.83669, "lng": 126.2088,
            "type": "landing_station", "country": "KR", "city": "Taean",
            "owner": "Telstra International", "on_net": "on_net", "verification_status": "draft",
        },
        {
            "id": "KBGG", "name": "Bundang KINX",
            "lat": 37.41346, "lng": 127.1245,
            "type": "extension_pop", "country": "KR", "city": "Seoul",
            "owner": "KINX", "on_net": "on_net", "verification_status": "draft",
        },
        {
            "id": "KSGG", "name": "Seoul LG CNS",
            "lat": 37.4821, "lng": 126.8797,
            "type": "extension_pop", "country": "KR", "city": "Seoul",
            "owner": "KINX", "on_net": "on_net", "verification_status": "draft",
        },
    ]
    for node in _NEW_KR_NODES:
        cur.execute(
            "INSERT INTO nodes (id, data) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
            (node["id"], json.dumps(node)),
        )

    # ── Re-wire C2C wet segments: PUS1 → PUCC ────────────────────────────────
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{end_node_id}',   '\"PUCC\"') WHERE id = 'C2C-S3B'",
    )
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{start_node_id}', '\"PUCC\"') WHERE id = 'C2C-S3C'",
    )

    # ── Re-wire EAC wet segments: SDRI → KSSR ────────────────────────────────
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{end_node_id}',   '\"KSSR\"') WHERE id = 'EAC-F2'",
    )
    cur.execute(
        "UPDATE segments SET data = jsonb_set(data, '{start_node_id}', '\"KSSR\"') WHERE id = 'EAC-K'",
    )


def _run_migration_044(cur) -> None:
    """Add Equinix Seoul (KSEQ) node and all Korea terrestrial backhaul segments."""

    # ── New node: KSEQ ────────────────────────────────────────────────────────
    cur.execute(
        "INSERT INTO nodes (id, data) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
        ("KSEQ", json.dumps({
            "id": "KSEQ", "name": "Seoul Equinix DMC",
            "lat": 37.58268, "lng": 126.88698,
            "type": "extension_pop", "country": "KR", "city": "Seoul",
            "owner": "Equinix", "on_net": "on_net", "verification_status": "draft",
        })),
    )

    # ── Terrestrial backhaul segments ─────────────────────────────────────────
    _SEGS = [
        ("KR02",        "PUCC",  "KSYD", 411,  2.054, "Terrestrial Busan–Seoul (C2C CLS–Yeoksam)"),
        ("KR03",        "KSYD",  "KSSD",   5,  0.025, "Terrestrial Seoul Yeoksam–LGU+"),
        ("KR04",        "KOLS",  "KSSD", 419,  2.093, "Terrestrial Busan KT–Seoul LGU+"),
        ("KR05",        "KSSR",  "KSSD", 133,  0.663, "Terrestrial Taean–Seoul (Primary)"),
        ("KR06",        "KSSR",  "KSSD", 133,  0.663, "Terrestrial Taean–Seoul (Diverse)"),
        ("KR07",        "KSSD",  "KSGG",  17,  0.085, "Terrestrial Seoul LGU+–LG CNS"),
        ("KR08",        "KSGG",  "KSEQ",  14,  0.072, "Terrestrial Seoul LG CNS–Equinix DMC"),
        ("KR09",        "KSEQ",  "KSYD",  21,  0.104, "Terrestrial Seoul Equinix DMC–Yeoksam"),
        ("KR10",        "KSSD",  "KBGG",  16,  0.078, "Terrestrial Seoul LGU+–Bundang KINX"),
        ("KR11",        "KBGG",  "KSYD",  17,  0.085, "Terrestrial Bundang KINX–Seoul Yeoksam"),
        ("KO01",        "PUCC",  "KOLS",  14,  0.072, "Terrestrial Busan C2C CLS–KT Songjeong"),
        ("KR_IP_Lease", "KSSD",  "DDGG",   5,  0.025, "Terrestrial Seoul LGU+–Daelim (IP Lease)"),
    ]
    for seg_id, start, end, km, lat, name in _SEGS:
        cur.execute(
            "INSERT INTO segments (id, data) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
            (seg_id, json.dumps({
                "id": seg_id, "name": name,
                "system_id": "TERRESTRIAL",
                "start_node_id": start, "end_node_id": end,
                "type": "terrestrial",
                "length_km": km, "latency": lat,
                "reliability": 0.999, "cost_weight": 3, "ownership": "owned",
            })),
        )
        total = 3.0 if km > 100 else 2.0
        cur.execute(
            "INSERT INTO capacity (segment_id, data) VALUES (%s, %s) ON CONFLICT (segment_id) DO NOTHING",
            (seg_id, json.dumps({
                "segment_id": seg_id,
                "total_capacity_t": total,
                "available_capacity_t": round(total * 0.5, 1),
            })),
        )


def _run_migration_045(cur) -> None:
    """Land SJC2 Korea branch at PUCC (Busan C2C CLS), replacing the deleted SJC2-TYO-ICN."""
    cur.execute(
        "INSERT INTO segments (id, data) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
        ("SJC2-TYO-PUS", json.dumps({
            "id": "SJC2-TYO-PUS",
            "name": "SJC2 Miura–Busan",
            "system_id": "SJC2",
            "start_node_id": "MJLS",
            "end_node_id": "PUCC",
            "type": "wet",
            "length_km": 990,
            "latency": 4.95,
            "reliability": 0.9992,
            "cost_weight": 8,
            "ownership": "consortium",
        })),
    )
    cur.execute(
        "INSERT INTO capacity (segment_id, data) VALUES (%s, %s) ON CONFLICT (segment_id) DO NOTHING",
        ("SJC2-TYO-PUS", json.dumps({
            "segment_id": "SJC2-TYO-PUS",
            "total_capacity_t": 2.0,
            "available_capacity_t": 1.3,
        })),
    )


def _run_migration_046(cur) -> None:
    """Replace all Taiwan nodes with corrected CRM data.

    Deletes legacy TW nodes (TPE1, TPE2, KHH1, TAMS, FSHA) and all segments
    that reference them.  Updates TUCN with corrected coordinates and owner.
    Inserts 9 new TW nodes from CRM: FGCC, TKDC, TTHY, TTRG, TTEX, TPEA,
    TPEI, TTAK, TTTJ.  Wet cable segments are left stranded here; the user
    will reconnect backhauls and subsea cables separately.
    """

    # ── 1. Delete stranded segments and their capacity ─────────────────────
    stranded_segments = [
        # TW terrestrial backhauls
        "TERRESTRIAL_TW01", "TERRESTRIAL_TW02", "TERRESTRIAL_TW03",
        "TERRESTRIAL_TW04", "TERRESTRIAL_TW05",
        # APG
        "APG-HKG-TPE", "APG-TPE-TYO",
        # SJC2
        "SJC2-MNL-TPE", "SJC2-TPE-TYO",
        # ADC
        "ADC-TYO-TPE", "ADC-TPE-HKG",
        # EAC
        "EAC-2B1", "EAC-B", "EAC-E",
        # C2C
        "C2C-S2B",
        # FASTER
        "FASTER-BDN-TAM",
    ]
    for seg_id in stranded_segments:
        cur.execute("DELETE FROM capacity WHERE segment_id = %s", (seg_id,))
        cur.execute("DELETE FROM segments WHERE id = %s", (seg_id,))

    # ── 2. Delete legacy TW nodes ──────────────────────────────────────────
    for node_id in ("TPE1", "TPE2", "KHH1", "TAMS", "FSHA"):
        cur.execute("DELETE FROM nodes WHERE id = %s", (node_id,))

    # ── 3. Update TUCN with corrected CRM data ─────────────────────────────
    cur.execute(
        "UPDATE nodes SET data = data || %s::jsonb WHERE id = 'TUCN'",
        (json.dumps({
            "name": "Toucheng Cable Station",
            "lat": 24.94401,
            "lng": 121.867646,
            "city": "Toucheng",
            "owner": "Reach",
            "on_net": "on_net",
        }),),
    )

    # ── 4. Insert 9 new TW nodes ───────────────────────────────────────────
    new_tw_nodes = [
        {
            "id": "FGCC",
            "name": "Fangshan C2C CLS",
            "lat": 22.26064,
            "lng": 120.657378,
            "type": "landing_station",
            "country": "TW",
            "city": "Fangshan",
            "owner": "Telstra International",
            "trading_name": "Fangshan C2C CLS, Taiwan",
            "on_net": "on_net",
            "verification_status": "draft",
        },
        {
            "id": "TKDC",
            "name": "DCT Data Center Kaohsiung",
            "lat": 22.59708,
            "lng": 120.3147208,
            "type": "extension_pop",
            "country": "TW",
            "city": "Kaohsiung",
            "owner": "Dynamic Computing Technology",
            "trading_name": "DCT Data Center, Kaohsiung",
            "on_net": "on_net",
            "verification_status": "draft",
        },
        {
            "id": "TTHY",
            "name": "Taipei Offnet TTHY",
            "lat": 25.03683,
            "lng": 121.562683,
            "type": "extension_pop",
            "country": "TW",
            "city": "Taipei",
            "owner": "TBC",
            "trading_name": "Taipei Offnet TTHY",
            "on_net": "off_net",
            "verification_status": "draft",
        },
        {
            "id": "TTRG",
            "name": "Taipei Offnet TTRG",
            "lat": 25.07835,
            "lng": 121.569943,
            "type": "extension_pop",
            "country": "TW",
            "city": "Taipei",
            "owner": "TBC",
            "trading_name": "Taipei Offnet TTRG",
            "on_net": "on_net",
            "verification_status": "draft",
        },
        {
            "id": "TTEX",
            "name": "eASPNet Xizhi",
            "lat": 25.06147,
            "lng": 121.64864,
            "type": "extension_pop",
            "country": "TW",
            "city": "Taipei",
            "owner": "eASPNet",
            "trading_name": "eASPNet Xizhi, Taiwan",
            "on_net": "off_net",
            "verification_status": "draft",
        },
        {
            "id": "TPEA",
            "name": "Pali Cable Station",
            "lat": 25.03297,
            "lng": 121.565418,
            "type": "landing_station",
            "country": "TW",
            "city": "Taipei",
            "owner": "Telstra International",
            "trading_name": "Pali Cable Station, Taiwan",
            "on_net": "on_net",
            "verification_status": "draft",
        },
        {
            "id": "TPEI",
            "name": "TPDS1 eASPNet",
            "lat": 25.07351,
            "lng": 121.577712,
            "type": "primary_pop",
            "country": "TW",
            "city": "Taipei",
            "owner": "eASPNet",
            "trading_name": "TPDS1, Taiwan",
            "on_net": "on_net",
            "verification_status": "draft",
        },
        {
            "id": "TTAK",
            "name": "Fareastone Ankang",
            "lat": 25.06829,
            "lng": 121.6165147,
            "type": "primary_pop",
            "country": "TW",
            "city": "Taipei",
            "owner": "Telstra International",
            "trading_name": "TTAK",
            "on_net": "on_net",
            "verification_status": "draft",
        },
        {
            "id": "TTTJ",
            "name": "Tanshui CLS",
            "lat": 23.69781,
            "lng": 120.960515,
            "type": "landing_station",
            "country": "TW",
            "city": "Taipei",
            "owner": "Telstra International",
            "trading_name": "TANSHUI CLS (TTTJ)",
            "on_net": "on_net",
            "verification_status": "draft",
        },
    ]
    for node in new_tw_nodes:
        cur.execute(
            "INSERT INTO nodes (id, data) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
            (node["id"], json.dumps(node)),
        )


def _run_migration_047(cur) -> None:
    """Add Taiwan terrestrial backhaul segments between new CRM nodes."""

    segments = [
        ("TW01", "Backhaul Pali–TPDS1", "TPEA", "TPEI", 6, 0.03),
        ("TW02", "Backhaul Pali–TPDS1 (diverse)", "TPEA", "TPEI", 6, 0.03),
        ("TW03", "Backhaul Tanshui–Neihu TTRG", "TTTJ", "TTRG", 215, 1.075),
        ("TW04", "Backhaul TTRG–TPDS1", "TTRG", "TPEI", 1, 0.005),
        ("TW05", "Backhaul Tanshui–Pali", "TTTJ", "TPEA", 209, 1.045),
        ("TW07", "Backhaul TPDS1–Fareastone Ankang", "TPEI", "TTAK", 5, 0.025),
        ("TW08", "Backhaul Fareastone Ankang–Toucheng", "TTAK", "TUCN", 37, 0.185),
        ("TW09", "Backhaul TPDS1–Toucheng", "TPEI", "TUCN", 42, 0.210),
        ("TW10", "Backhaul TPDS1–Kaohsiung", "TPEI", "TKDC", 395, 1.975),
        ("TW11", "Backhaul Toucheng–Fangshan", "TUCN", "FGCC", 420, 2.100),
        ("TW12", "Backhaul Fangshan–Kaohsiung", "FGCC", "TKDC", 67, 0.335),
    ]

    for seg_id, name, start, end, km, latency in segments:
        cur.execute(
            "INSERT INTO segments (id, data) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
            (seg_id, json.dumps({
                "id": seg_id,
                "name": name,
                "system_id": "TERRESTRIAL",
                "start_node_id": start,
                "end_node_id": end,
                "type": "terrestrial",
                "length_km": km,
                "latency": latency,
                "reliability": 0.9995,
                "cost_weight": 1,
                "ownership": "owned",
            })),
        )
        cur.execute(
            "INSERT INTO capacity (segment_id, data) VALUES (%s, %s) ON CONFLICT (segment_id) DO NOTHING",
            (seg_id, json.dumps({
                "segment_id": seg_id,
                "total_capacity_t": 10.0,
                "available_capacity_t": 8.0,
            })),
        )


def _run_migration_048(cur) -> None:
    """Rename segment KO01 (typo) to KR01 (Busan C2C CLS–KT Songjeong backhaul)."""
    cur.execute(
        "INSERT INTO segments (id, data) SELECT 'KR01', data || '{\"id\":\"KR01\"}'::jsonb FROM segments WHERE id = 'KO01' ON CONFLICT (id) DO NOTHING"
    )
    cur.execute(
        "INSERT INTO capacity (segment_id, data) SELECT 'KR01', data || '{\"segment_id\":\"KR01\"}'::jsonb FROM capacity WHERE segment_id = 'KO01' ON CONFLICT (segment_id) DO NOTHING"
    )
    cur.execute("DELETE FROM capacity WHERE segment_id = 'KO01'")
    cur.execute("DELETE FROM segments WHERE id = 'KO01'")


def _run_migration_049(cur) -> None:
    """Reconnect Taiwan wet cable segments to new CRM nodes; retire C2C-S3A/S3B.

    - C2C-S3A (BUCT→NHUI) and C2C-S3B (NHUI→PUCC) are permanently retired
    - C2C-S2B reconnected: BUCT→FGCC (Fangshan C2C CLS, south Taiwan)
    - C2C-S2C created:     BUCT→TTTJ (Tanshui CLS, north Taiwan)
    - EAC-2B1 reconnected: TPEA→CPSA
    - EAC-B   reconnected: TPEA→BUEP
    - EAC-E   reconnected: TPEA→BUEC
    """

    # ── Retire C2C-S3A and C2C-S3B ────────────────────────────────────────
    for seg_id in ("C2C-S3A", "C2C-S3B"):
        cur.execute("DELETE FROM capacity WHERE segment_id = %s", (seg_id,))
        cur.execute("DELETE FROM segments WHERE id = %s", (seg_id,))

    # ── Reconnect / create wet segments ───────────────────────────────────
    wet_segments = [
        ("C2C-S2B", "C2C Segment S2B BU Taiwan–Fangshan", "C2C", "BUCT", "FGCC", 557, 2.785),
        ("C2C-S2C", "C2C Segment S2C BU Taiwan–Tanshui", "C2C", "BUCT", "TTTJ", 618, 3.09),
        ("EAC-2B1", "EAC 2B1 Pali–Capepisa", "EAC", "TPEA", "CPSA", 1547, 7.735),
        ("EAC-B",   "EAC Segment B Pali–BU Pacific", "EAC", "TPEA", "BUEP", 701, 3.505),
        ("EAC-E",   "EAC Segment E Pali–BU China Sea", "EAC", "TPEA", "BUEC", 651, 3.255),
    ]

    for seg_id, name, system_id, start, end, km, latency in wet_segments:
        cur.execute(
            "INSERT INTO segments (id, data) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
            (seg_id, json.dumps({
                "id": seg_id,
                "name": name,
                "system_id": system_id,
                "start_node_id": start,
                "end_node_id": end,
                "type": "wet",
                "length_km": km,
                "latency": latency,
                "reliability": 0.9994,
                "cost_weight": 5,
                "ownership": "consortium",
            })),
        )
        cur.execute(
            "INSERT INTO capacity (segment_id, data) VALUES (%s, %s) ON CONFLICT (segment_id) DO NOTHING",
            (seg_id, json.dumps({
                "segment_id": seg_id,
                "total_capacity_t": 2.0,
                "available_capacity_t": 1.3,
            })),
        )


def _run_migration_050(cur) -> None:
    """Reconnect APG, SJC2, and FASTER Taiwan landings to new CRM nodes.

    ADC has no Taiwan landing — those segments remain deleted.
    APG lands at TUCN (Toucheng).
    SJC2 and FASTER land at TTTJ (Tanshui).
    """

    wet_segments = [
        # APG
        ("APG-HKG-TUC", "APG Hong Kong–Toucheng", "APG", "HKGG", "TUCN", 1091, 5.455, None),
        ("APG-TUC-TYO", "APG Toucheng–Tokyo", "APG", "TUCN", "MJLS", 2681, 13.405,
         [[28, 126], [31, 131], [33, 137]]),
        # SJC2
        ("SJC2-MNL-TAM", "SJC2 Manila–Tanshui", "SJC2", "MNL1", "TTTJ", 1315, 6.575, None),
        ("SJC2-TAM-TYO", "SJC2 Tanshui–Tokyo", "SJC2", "TTTJ", "MJLS", 2885, 14.425,
         [[27, 124], [30, 129], [33, 135]]),
        # FASTER
        ("FASTER-BDN-TAM", "FASTER Bandon–Tanshui", "FASTER", "BDN1", "TTTJ", 13042, 65.21, None),
    ]

    for seg_id, name, system_id, start, end, km, latency, waypoints in wet_segments:
        data = {
            "id": seg_id,
            "name": name,
            "system_id": system_id,
            "start_node_id": start,
            "end_node_id": end,
            "type": "wet",
            "length_km": km,
            "latency": latency,
            "reliability": 0.9994,
            "cost_weight": 7,
            "ownership": "consortium",
        }
        if waypoints:
            data["waypoints"] = waypoints
        cur.execute(
            "INSERT INTO segments (id, data) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
            (seg_id, json.dumps(data)),
        )
        cur.execute(
            "INSERT INTO capacity (segment_id, data) VALUES (%s, %s) ON CONFLICT (segment_id) DO NOTHING",
            (seg_id, json.dumps({
                "segment_id": seg_id,
                "total_capacity_t": 2.0,
                "available_capacity_t": 1.3,
            })),
        )


def _run_migration_051(cur) -> None:
    """Remove all APCN2 references — cable is End of Life.

    APCN2 had no segments in the DB; only two JP node descriptions mentioned it.
    """
    for node_id in ("KALS", "KJLS"):
        cur.execute(
            "UPDATE nodes SET data = jsonb_set(data, '{description}', to_jsonb(replace(data->>'description', ', APCN2', ''))) WHERE id = %s",
            (node_id,),
        )


def _run_migration_052(cur) -> None:
    """Add waypoints to Korea and Taiwan terrestrial backhauls to reduce map overlaps.

    Korea:
      KR02/KR04 both run Busan→Seoul — routed on different corridors
        KR02 via Daegu+Daejeon (highway spine)
        KR04 via east coast then inland
      KR05/KR06 share KSSR→KSSD endpoints (diverse pair) — fanned apart
    Taiwan:
      TW01/TW02 share TPEA→TPEI (diverse pair) — fanned west/east
      TW03/TW05 both run TTTJ→north Taipei — east-coast vs central spine
      TW08/TW09 both terminate at TUCN — fanned slightly apart
      TW10 routed via west-coast spine (Taipei→Kaohsiung)
      TW11 routed via east-coast spine (Toucheng→Fangshan)
    """

    waypoints: dict[str, list[list[float]]] = {
        # ── Korea ─────────────────────────────────────────────────────────
        # KR02 PUCC→KSYD: Gyeongbu highway corridor via Daegu, Daejeon
        "KR02": [[35.87, 128.60], [36.35, 127.38]],
        # KR04 KOLS→KSSD: east-coast jog then central corridor
        "KR04": [[35.50, 129.30], [36.50, 128.00]],
        # KR05 KSSR→KSSD: south arc from west coast
        "KR05": [[37.00, 126.40]],
        # KR06 KSSR→KSSD diverse: north arc from west coast
        "KR06": [[37.30, 126.10]],
        # ── Taiwan ────────────────────────────────────────────────────────
        # TW01/TW02 TPEA→TPEI diverse: west vs east curve through Taipei
        "TW01": [[25.05, 121.54]],
        "TW02": [[25.05, 121.62]],
        # TW03 TTTJ→TTRG: east spine (Suao corridor)
        "TW03": [[24.50, 121.40]],
        # TW05 TTTJ→TPEA: central spine (Puli/Nantou corridor)
        "TW05": [[24.40, 121.00]],
        # TW08 TTAK→TUCN: slight north arc to Toucheng
        "TW08": [[25.10, 121.73]],
        # TW09 TPEI→TUCN: slight south arc to Toucheng
        "TW09": [[24.99, 121.73]],
        # TW10 TPEI→TKDC: west-coast spine (Taichung → Chiayi → Kaohsiung)
        "TW10": [[24.00, 120.70], [23.30, 120.40]],
        # TW11 TUCN→FGCC: east-coast spine (Hualien → Taitung → Pingtung)
        "TW11": [[24.00, 121.60], [23.00, 121.30]],
    }

    for seg_id, wps in waypoints.items():
        cur.execute(
            "UPDATE segments SET data = jsonb_set(data, '{waypoints}', %s::jsonb) WHERE id = %s",
            (json.dumps(wps), seg_id),
        )


def _run_migration_053(cur) -> None:
    """Fix subsea cable waypoints to route through open water.

    Issues fixed:
    - RNAL-DC / APG-HKG-TUC: straight line HKG→Toucheng crosses Taiwan island;
      rerouted south through Luzon Strait then east to approach TUCN from Pacific.
    - EAC-E: straight line TPEA→BUEC exits southwest through Taiwan landmass;
      exits north of Taiwan then swings west through Taiwan Strait.
    - EAC-2B1: TPEA→Capepisa goes through Luzon; rerouted east of Luzon via
      Philippine Sea.
    - SJC2-MNL-TAM: Manila→Tanshui goes north through Luzon island; rerouted
      east of Luzon.
    - RNAL-BA: TUCN→Wada straight line clips Ryukyu islands; routed east of
      Ryukyus through open Pacific.
    - SJC2-TYO-PUS: Miura→Busan straight line crosses central Japan (Honshu);
      routed south around Kyushu.
    - RNAL-F: Busan→Wada straight line crosses Honshu; routed south around
      Kyushu then northeast to Pacific coast.
    - RNAL-E: HKG→Busan straight line clips Fujian/Zhejiang coast; routed
      through open East China Sea.
    - EAC-K: existing waypoints cross Honshu at 37°N; rerouted south around
      Kyushu through open Pacific.
    - C2C-S5: existing waypoints cross Luzon on final approach to Nasugbu;
      extended route east then south of Philippines.
    - APRICOT-SIN-BU: straight line clips western Luzon; rerouted via South
      China Sea east of Palawan then Philippine Sea.
    - EAC-2B2: SIN→Capepisa clips Palawan; slight eastern nudge.
    - FASTER-BDN-TAM: no waypoints on trans-Pacific route; added consistent
      with FASTER-BDN-CHK routing.
    - EAC-F1: BUEC→BUEY straight line clips Fujian/Zhejiang coast; routed
      east through open ECS.
    """

    waypoints: dict[str, list[list[float]]] = {
        # ── Taiwan crossings ──────────────────────────────────────────────
        # HKG→Toucheng: south through Luzon Strait, east of Taiwan, approach from Pacific
        "RNAL-DC":     [[20.5, 117.0], [21.0, 122.5], [23.5, 123.0]],
        "APG-HKG-TUC": [[21.0, 117.0], [21.0, 122.0], [23.5, 123.0]],
        # TPEA→BUEC: exit north of Taiwan then west through Taiwan Strait
        "EAC-E":       [[25.5, 121.0], [25.0, 119.5], [23.0, 118.0]],
        # TUCN→Wada: east of Ryukyus through open Pacific
        "RNAL-BA":     [[27.0, 127.5], [31.0, 132.5], [34.0, 138.0]],

        # ── Luzon crossings ───────────────────────────────────────────────
        # TPEA→Capepisa: east of Taiwan, east of Luzon through Philippine Sea
        "EAC-2B1":      [[25.5, 122.5], [22.0, 124.0], [17.0, 123.0], [15.0, 122.0]],
        # Manila→Tanshui: east of Luzon, approach via Luzon Strait
        "SJC2-MNL-TAM": [[15.0, 123.0], [18.5, 123.0], [21.5, 122.5], [23.0, 121.5]],
        # Singapore→APRICOT BU: south/east of Philippines via Philippine Sea
        "APRICOT-SIN-BU": [[5.0, 110.0], [10.0, 115.0], [15.0, 125.0], [18.0, 126.0]],
        # SIN→Capepisa: slight eastern arc to clear Palawan
        "EAC-2B2":      [[8.0, 112.0], [13.0, 119.0]],
        # Japan→Nasugbu: extended south/east of Philippines, approach from west
        "C2C-S5":       [[28.0, 132.0], [20.0, 128.0], [15.0, 124.5], [12.0, 122.0], [11.0, 120.0]],

        # ── Japan/Honshu crossings ────────────────────────────────────────
        # Miura→Busan: south around Kyushu, Bungo Channel approach
        "SJC2-TYO-PUS": [[33.5, 138.0], [31.5, 133.5], [33.0, 130.5]],
        # Busan→Wada: south around Kyushu, northeast through Pacific
        "RNAL-F":       [[33.5, 130.5], [32.0, 134.0], [33.5, 139.0]],
        # HKG→Busan: east China Sea route clear of Fujian coast
        "RNAL-E":       [[23.0, 118.0], [29.0, 124.0]],
        # KSSR→JAAJ: south around Kyushu through Pacific, existing waypoints crossed Honshu
        "EAC-K":        [[35.5, 128.0], [33.5, 133.0], [33.0, 137.0], [35.0, 140.5]],

        # ── China coast clipping ──────────────────────────────────────────
        # BUEC→BUEY: routed east of Fujian/Zhejiang through open ECS
        "EAC-F1":       [[26.0, 120.0], [30.0, 122.5]],

        # ── Trans-Pacific ─────────────────────────────────────────────────
        # BDN1→Tanshui: north Pacific arc consistent with FASTER-BDN-CHK
        "FASTER-BDN-TAM": [[46.0, -145.0], [50.0, -175.0], [48.0, 170.0], [38.0, 145.0], [24.0, 122.0]],
    }

    for seg_id, wps in waypoints.items():
        cur.execute(
            "UPDATE segments SET data = jsonb_set(data, '{waypoints}', %s::jsonb) WHERE id = %s",
            (json.dumps(wps), seg_id),
        )


def _run_migration_058(cur) -> None:
    """Fix Malay Peninsula, Arabian Peninsula and Mediterranean land crossings.

    These waypoints cover cable systems (INDIGO_W, SMW3, SMW4, AAE1, BBG) that
    exist in some deployments but not in the default migrated database.  Each
    UPDATE is a no-op for segments that don't exist, so this migration is safe
    to run everywhere.

    Issues fixed:
    - SIN→Mumbai (INDIGO_W/SMW3/SMW4): direct line clips Riau Islands/Sumatra;
      routed south through Strait of Malacca, Bay of Bengal, around India's tip.
    - MAA→Penang (BBG): Chennai east coast → Penang west coast straight line
      crosses the southern Malay Peninsula; routed around Sri Lanka's south tip.
    - Penang→Singapore (BBG): both on west coast, straight line crosses peninsula;
      routed south through Strait of Malacca.
    - SIN→Vung Tau (AAE-1): slight eastern jog to stay in South China Sea.
    - SHV→Penang (AAE-1): Gulf of Thailand → south tip of peninsula → Strait.
    - SAT→Ngwe Saung (AAE-1): north through Andaman Sea.
    - DXB→London (SMW3/SMW4): full path through Gulf of Oman, Arabian Sea,
      Red Sea, Suez, Mediterranean to UK.
    - FUJ→Jeddah (AAE-1): south around Oman into Red Sea.
    - BAR→Marseille (AAE-1): south around Italy's toe, Tyrrhenian Sea.
    """
    waypoints: dict[str, list[list[float]]] = {
        # Singapore → Mumbai: Strait of Malacca → Bay of Bengal → Arabian Sea
        "INDIGO_W-SIN-BOM": [
            [ 2.0, 101.5], [ 4.5, 100.0], [ 7.0,  97.5],
            [10.0,  88.0], [ 7.0,  79.0], [11.0,  73.5], [16.0,  72.0],
        ],
        "SMW3-SIN-BOM": [
            [ 2.0, 101.5], [ 4.5, 100.0], [ 7.0,  97.5],
            [10.0,  88.0], [ 7.0,  79.0], [11.0,  73.5], [16.0,  72.0],
        ],
        "SMW4-SIN-BOM": [
            [ 2.0, 101.5], [ 4.5, 100.0], [ 7.0,  97.5],
            [10.0,  88.0], [ 7.0,  79.0], [11.0,  73.5], [16.0,  72.0],
        ],
        # Chennai → Penang: Bay of Bengal → south India tip → Strait of Malacca
        "BBG-MAA-PEN": [
            [10.5,  80.5], [ 6.5,  80.0], [ 6.5,  79.0],
            [ 6.0,  77.5], [ 4.0,  99.0], [ 5.5, 100.0],
        ],
        # Penang → Singapore: south through Strait of Malacca
        "BBG-PEN-SIN": [
            [ 5.0, 100.5], [ 3.0, 101.0], [ 1.5, 103.0],
        ],
        # Singapore → Vung Tau: east into South China Sea
        "AAE1-SIN-VUT": [
            [ 1.5, 104.5], [ 4.0, 105.0], [ 7.0, 106.0],
        ],
        # Sihanoukville → Penang: Gulf of Thailand → south tip → Strait
        "AAE1-SHV-PEN": [
            [ 8.0, 103.5], [ 4.5, 103.0], [ 2.0, 103.5],
            [ 2.0, 102.0], [ 4.0, 100.5], [ 5.5, 100.3],
        ],
        # Satun → Ngwe Saung: north through Andaman Sea
        "AAE1-SAT-NGW": [
            [ 7.0,  98.5], [ 9.5,  97.5], [12.0,  96.5], [15.0,  95.5],
        ],
        # Dubai → London: Gulf of Oman → Arabian Sea → Red Sea → Suez → Med
        "SMW3-DXB-LON": [
            [24.0,  58.0], [22.5,  59.0], [17.0,  56.0], [12.5,  50.0],
            [12.0,  44.5], [13.0,  43.5], [18.0,  39.5], [27.0,  34.0],
            [30.5,  32.0], [31.5,  32.5], [36.0,  25.0], [38.0,  13.0],
            [43.5,   5.0], [47.5,  -3.0],
        ],
        "SMW4-DXB-LON": [
            [24.0,  58.0], [22.5,  59.0], [17.0,  56.0], [12.5,  50.0],
            [12.0,  44.5], [13.0,  43.5], [18.0,  39.5], [27.0,  34.0],
            [30.5,  32.0], [31.5,  32.5], [36.0,  25.0], [38.0,  13.0],
            [43.5,   5.0], [47.5,  -3.0],
        ],
        # Fujairah → Jeddah: south around Oman into Gulf of Aden then Red Sea
        "AAE1-FUJ-JED": [
            [23.5,  58.0], [21.5,  60.0], [16.0,  57.0],
            [12.0,  48.0], [13.0,  44.0], [16.0,  41.5], [20.0,  39.0],
        ],
        # Bari → Marseille: south around Italy's toe, Tyrrhenian Sea
        "AAE1-BAR-MRS": [
            [37.0,  16.0], [37.0,  13.5], [38.5,  11.5],
            [40.5,   9.0], [42.0,   7.5],
        ],
    }

    for seg_id, wps in waypoints.items():
        cur.execute(
            "UPDATE segments SET data = jsonb_set(data, '{waypoints}', %s::jsonb) WHERE id = %s",
            (json.dumps(wps), seg_id),
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


_DEFAULT_NOTE_CATEGORIES: list[dict] = [
    # ── Node categories ─────────────────────────────────────────────────────────
    {"id": "node-site-access",         "label": "Site Access",                "applies_to": "node",    "order": 10},
    {"id": "node-access-requirements", "label": "Access Requirements",        "applies_to": "node",    "order": 15},
    {"id": "node-meet-me-room",        "label": "Meet Me Room",               "applies_to": "node",    "order": 20},
    {"id": "node-colocation",          "label": "Colocation Terms",           "applies_to": "node",    "order": 25},
    {"id": "node-equipment",           "label": "Equipment Notes",            "applies_to": "node",    "order": 30},
    {"id": "node-backhaul",            "label": "Backhaul Options",           "applies_to": "node",    "order": 35},
    {"id": "node-commercial",          "label": "Commercial Guidance",        "applies_to": "node",    "order": 40},
    {"id": "node-env-risk",            "label": "Environmental Risk",         "applies_to": "node",    "order": 45},
    {"id": "node-handoff",             "label": "Handoff Notes",              "applies_to": "node",    "order": 50},
    {"id": "node-landing-party",       "label": "Landing Party / CLS Op.",    "applies_to": "node",    "order": 55},
    {"id": "node-power-space",         "label": "Power / Space",              "applies_to": "node",    "order": 60},
    {"id": "node-competitive",         "label": "Competitor Presence",        "applies_to": "node",    "order": 65},
    {"id": "node-floor-rack",          "label": "Floor / Rack",               "applies_to": "node",    "order": 70},
    {"id": "node-legal",               "label": "Legal / Import Duties",      "applies_to": "node",    "order": 75},
    {"id": "node-other-operator",      "label": "Other Operator Notes",       "applies_to": "node",    "order": 80},
    {"id": "node-sla",                 "label": "SLA / Protection",           "applies_to": "node",    "order": 85},
    {"id": "node-customs",             "label": "Customs / Regulatory",       "applies_to": "node",    "order": 90},
    {"id": "node-security",            "label": "Security Requirements",      "applies_to": "node",    "order": 100},
    {"id": "node-monitoring",          "label": "Monitoring / Alarms",        "applies_to": "node",    "order": 105},
    {"id": "node-cross-connect",       "label": "Cross-Connect Info",         "applies_to": "node",    "order": 110},
    {"id": "node-fibre-mgmt",          "label": "Fibre Management",           "applies_to": "node",    "order": 120},
    {"id": "node-contacts",            "label": "Key Contacts",               "applies_to": "node",    "order": 130},
    {"id": "node-site-experts",        "label": "Site Experts",               "applies_to": "node",    "order": 133},
    {"id": "node-lead-time",           "label": "Lead Time / Ordering",       "applies_to": "node",    "order": 140},
    {"id": "node-lifespan",            "label": "Lifespan Notes",             "applies_to": "node",    "order": 145},
    {"id": "node-commissioning",       "label": "Commissioning Notes",        "applies_to": "node",    "order": 148},
    {"id": "node-cease-exit",          "label": "Cease / Exit Notes",         "applies_to": "node",    "order": 150},
    {"id": "node-other",               "label": "Other",                      "applies_to": "node",    "order": 999},
    # ── Segment categories ───────────────────────────────────────────────────────
    {"id": "seg-fibre-pair",           "label": "Fibre Pair Info",            "applies_to": "segment", "order": 10},
    {"id": "seg-system-age",           "label": "System Age / RFS",           "applies_to": "segment", "order": 15},
    {"id": "seg-landing",              "label": "Landing Information",        "applies_to": "segment", "order": 20},
    {"id": "seg-ownership",            "label": "Ownership / Consortium",     "applies_to": "segment", "order": 25},
    {"id": "seg-route-notes",          "label": "Route Notes",                "applies_to": "segment", "order": 30},
    {"id": "seg-commercial",           "label": "Commercial Terms",           "applies_to": "segment", "order": 35},
    {"id": "seg-capacity",             "label": "Capacity Notes",             "applies_to": "segment", "order": 40},
    {"id": "seg-restoration",          "label": "Restoration / Spares",       "applies_to": "segment", "order": 45},
    {"id": "seg-performance",          "label": "Performance Notes",          "applies_to": "segment", "order": 50},
    {"id": "seg-regulatory",           "label": "Regulatory / Licences",      "applies_to": "segment", "order": 55},
    {"id": "seg-fibre-operator",       "label": "Fibre Operator",             "applies_to": "segment", "order": 60},
    {"id": "seg-burial",               "label": "Burial / Route Protection",  "applies_to": "segment", "order": 65},
    {"id": "seg-maintenance",          "label": "Maintenance Windows",        "applies_to": "segment", "order": 70},
    {"id": "seg-significant-faults",   "label": "Significant Faults",         "applies_to": "segment", "order": 75},
    {"id": "seg-known-issues",         "label": "Known Issues",               "applies_to": "segment", "order": 80},
    {"id": "seg-system-design",        "label": "System Design",              "applies_to": "segment", "order": 85},
    {"id": "seg-sla",                  "label": "SLA / Protection",           "applies_to": "segment", "order": 90},
    {"id": "seg-diversity",            "label": "Diversity Notes",            "applies_to": "segment", "order": 100},
    {"id": "seg-latency",              "label": "Latency Variance",           "applies_to": "segment", "order": 110},
    {"id": "seg-iru-lease",            "label": "IRU / Lease Terms",          "applies_to": "segment", "order": 120},
    {"id": "seg-repair-history",       "label": "Repair History",             "applies_to": "segment", "order": 130},
    {"id": "seg-lifespan",             "label": "Lifespan Notes",             "applies_to": "segment", "order": 135},
    {"id": "seg-cease-exit",           "label": "Cease / Exit Notes",         "applies_to": "segment", "order": 140},
    {"id": "seg-handback",             "label": "Handback Conditions",        "applies_to": "segment", "order": 145},
    {"id": "seg-env-notes",            "label": "Environmental Notes",        "applies_to": "segment", "order": 150},
    {"id": "seg-billing",              "label": "Billing Notes",              "applies_to": "segment", "order": 155},
    {"id": "seg-other",                "label": "Other",                      "applies_to": "segment", "order": 999},
]


def _run_migration_054(cur) -> None:
    """Create solution_notes and note_categories tables; seed default categories."""
    # Tables already created by _CREATE_SQL — just seed defaults if empty
    # Check if table still uses JSONB schema (pre-055); skip if already migrated
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'note_categories' AND column_name = 'data'
    """)
    if not cur.fetchone():
        return  # Already on proper-column schema; skip legacy JSONB seed
    cur.execute("SELECT COUNT(*) AS n FROM note_categories")
    if cur.fetchone()["n"] == 0:
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO note_categories (id, data) VALUES %s ON CONFLICT DO NOTHING",
            [(cat["id"], json.dumps(cat)) for cat in _DEFAULT_NOTE_CATEGORIES],
        )


def _run_migration_055(cur) -> None:
    """Convert solution_notes and note_categories from JSONB to proper relational columns."""
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'note_categories' AND column_name = 'data'
    """)
    if not cur.fetchone():
        return  # Already migrated

    # Capture existing category data from JSONB before dropping
    cur.execute("SELECT data FROM note_categories")
    old_cats = [row["data"] for row in cur.fetchall()]

    # Capture existing solution notes from JSONB before dropping
    cur.execute("SELECT data FROM solution_notes")
    old_notes = [row["data"] for row in cur.fetchall()]

    # Drop and recreate with proper columns
    cur.execute("DROP TABLE solution_notes")
    cur.execute("DROP TABLE note_categories")
    cur.execute("""
        CREATE TABLE solution_notes (
            id          TEXT PRIMARY KEY,
            node_id     TEXT,
            segment_id  TEXT,
            category_id TEXT NOT NULL DEFAULT '',
            title       TEXT NOT NULL DEFAULT '',
            text        TEXT NOT NULL DEFAULT '',
            severity    TEXT NOT NULL DEFAULT 'info',
            created_at  TEXT
        )
    """)
    cur.execute("""
        CREATE TABLE note_categories (
            id          TEXT PRIMARY KEY,
            label       TEXT NOT NULL DEFAULT '',
            applies_to  TEXT NOT NULL DEFAULT 'node',
            order_num   INTEGER NOT NULL DEFAULT 0
        )
    """)

    # Re-insert preserved notes
    for note in old_notes:
        cur.execute(
            "INSERT INTO solution_notes (id, node_id, segment_id, category_id, title, text, severity, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (note.get("id",""), note.get("node_id"), note.get("segment_id"),
             note.get("category_id",""), note.get("title",""), note.get("text",""),
             note.get("severity","info"), note.get("created_at")),
        )

    # Seed categories: preserve any user-added ones, then add defaults
    existing_ids = {c.get("id") for c in old_cats}
    all_cats = {c["id"]: c for c in old_cats}
    for cat in _DEFAULT_NOTE_CATEGORIES:
        if cat["id"] not in existing_ids:
            all_cats[cat["id"]] = cat
    for cat in all_cats.values():
        cur.execute(
            "INSERT INTO note_categories (id, label, applies_to, order_num) VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            (cat["id"], cat.get("label",""), cat.get("applies_to","node"), cat.get("order", 0)),
        )


def _run_migration_056(cur) -> None:
    """Insert any missing default note categories (expanded set) into existing databases."""
    for cat in _DEFAULT_NOTE_CATEGORIES:
        cur.execute(
            "INSERT INTO note_categories (id, label, applies_to, order_num) VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            (cat["id"], cat.get("label", ""), cat.get("applies_to", "node"), cat.get("order", 0)),
        )


def _run_migration_057(cur) -> None:
    """Fix remaining subsea cable waypoints that still cross land after m053.

    - ADC-BAT-SIN: no waypoints; straight line from Batangas (Philippines) to
      Singapore clips the Malay Peninsula south tip.  Route via Sulu Sea,
      South China Sea, and the Singapore Strait eastern approach.
    - SJC2-TAM-TYO: existing first waypoint at [27,124] creates a segment from
      Tamsui that clips Taiwan's NE coast.  Added two lead-in waypoints through
      the Taiwan Strait before joining the existing arc.
    - SJC2-TYO-PUS: m053 waypoint [33.0, 130.5] sits on central Kyushu near
      Fukuoka/Ariake Sea.  Replaced with an open-ocean route south of Kyushu
      then up the Korea Strait.
    - RNAL-F: m053 waypoint [33.5, 130.5] also sits on Kyushu.  Replaced with
      a route via the Korea Strait / south of Jeju then northeast to Pacific.
    - RNAL-E: add a lead-in south of Hong Kong Island to avoid clipping the
      Fujian/Guangdong coast when the cable exits westward.
    """
    waypoints: dict[str, list[list[float]]] = {
        # Batangas → Singapore: Sulu Sea → South China Sea → Singapore Strait
        "ADC-BAT-SIN": [
            [12.0, 119.0],  # SW of Luzon, Sibuyan/Sulu Sea
            [ 8.0, 116.0],  # West of Palawan, open South China Sea
            [ 5.0, 112.0],  # South China Sea
            [ 2.5, 107.5],  # South China Sea approaching Singapore
            [ 1.1, 104.8],  # Singapore Strait eastern approach
        ],
        # Tamsui → Tokyo: Taiwan Strait lead-in before existing Pacific arc
        "SJC2-TAM-TYO": [
            [23.5, 118.5],  # Taiwan Strait, south section (clear of Penghu)
            [25.5, 121.5],  # East China Sea, north of Taiwan's NE tip
            [27.0, 124.0],  # open East China Sea (was existing first waypoint)
            [30.0, 129.0],  # open Pacific
            [33.0, 135.0],  # Pacific, south of Honshu
        ],
        # Miura (Tokyo) → Busan: south of Kyushu, open Korea Strait
        "SJC2-TYO-PUS": [
            [33.5, 138.0],  # open Pacific east of Honshu
            [31.5, 133.5],  # Pacific south of Shikoku
            [31.0, 130.0],  # south of Kyushu (Cape Sata area, open Pacific)
            [32.5, 128.5],  # Korea Strait east channel (open water)
        ],
        # Busan → Wada: Korea Strait / south of Jeju, northeast to Pacific
        "RNAL-F": [
            [33.0, 129.0],  # South Korea Strait / east of Jeju (clear of Kyushu)
            [31.5, 133.0],  # Pacific, south-east of Kyushu
            [32.0, 134.0],  # Pacific, south of Kii Peninsula
            [33.5, 139.0],  # Pacific, east of Tokyo Bay
        ],
        # Hong Kong → Busan: lead-in south of HK Island before East China Sea
        "RNAL-E": [
            [21.8, 114.5],  # South China Sea, south of HK Island
            [23.0, 118.0],  # open South China Sea NE of HK
            [29.0, 124.0],  # East China Sea
        ],
    }

    for seg_id, wps in waypoints.items():
        cur.execute(
            "UPDATE segments SET data = jsonb_set(data, '{waypoints}', %s::jsonb) WHERE id = %s",
            (json.dumps(wps), seg_id),
        )
