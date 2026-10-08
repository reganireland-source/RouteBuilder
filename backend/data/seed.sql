-- RouteBuilder seed data
-- Run against a Postgres database to initialise the schema and populate all reference data.

CREATE TABLE IF NOT EXISTS nodes (
  id          VARCHAR(10)  PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  type        VARCHAR(30)  NOT NULL,
  country     CHAR(2)      NOT NULL
);

CREATE TABLE IF NOT EXISTS cable_systems (
  id          VARCHAR(20)  PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS segments (
  id            VARCHAR(50)  PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  system_id     VARCHAR(20)  NOT NULL REFERENCES cable_systems(id),
  start_node_id VARCHAR(10)  NOT NULL REFERENCES nodes(id),
  end_node_id   VARCHAR(10)  NOT NULL REFERENCES nodes(id),
  type          VARCHAR(20)  NOT NULL,
  length_km     INTEGER      NOT NULL,
  reliability   DOUBLE PRECISION NOT NULL,
  cost_weight   INTEGER      NOT NULL,
  ownership     VARCHAR(20)  NOT NULL
);

-- node_id + the two system IDs form a unique constraint; both orderings are stored explicitly.
CREATE TABLE IF NOT EXISTS interconnect_rules (
  id          SERIAL       PRIMARY KEY,
  node_id     VARCHAR(10)  NOT NULL REFERENCES nodes(id),
  system_a_id VARCHAR(20)  NOT NULL REFERENCES cable_systems(id),
  system_b_id VARCHAR(20)  NOT NULL REFERENCES cable_systems(id)
);

-- ── Nodes ──────────────────────────────────────────────────────────────────

INSERT INTO nodes (id, name, lat, lng, type, country) VALUES
  ('PER', 'Perth',         -31.9505,  115.8605, 'landing_station', 'AU'),
  ('SYD', 'Sydney',        -33.8688,  151.2093, 'landing_station', 'AU'),
  ('MEL', 'Melbourne',     -37.8136,  144.9631, 'landing_station', 'AU'),
  ('BRI', 'Brisbane',      -27.4698,  153.0251, 'landing_station', 'AU'),
  ('DAR', 'Darwin',        -12.4634,  130.8456, 'landing_station', 'AU'),
  ('AKL', 'Auckland',      -36.8509,  174.7645, 'landing_station', 'NZ'),
  ('SIN', 'Singapore',       1.3521,  103.8198, 'landing_station', 'SG'),
  ('HKG', 'Hong Kong',      22.3193,  114.1694, 'landing_station', 'HK'),
  ('TYO', 'Tokyo',          35.6762,  139.6503, 'landing_station', 'JP'),
  ('OSA', 'Osaka',          34.6937,  135.5023, 'landing_station', 'JP'),
  ('MNB', 'Minamiboso',     35.1562,  140.0346, 'landing_station', 'JP'),
  ('SHM', 'Shima',          34.3270,  136.8734, 'landing_station', 'JP'),
  ('GUM', 'Guam',           13.4443,  144.7937, 'landing_station', 'GU'),
  ('HAW', 'Hawaii',         21.3069, -157.8583, 'landing_station', 'US'),
  ('LAX', 'Los Angeles',    34.0522, -118.2437, 'landing_station', 'US'),
  ('GRB', 'Grover Beach',   35.1219, -120.6218, 'landing_station', 'US'),
  ('SEA', 'Seattle',        47.6062, -122.3321, 'landing_station', 'US'),
  ('MNL', 'Manila',         14.5995,  120.9842, 'landing_station', 'PH'),
  ('TPE', 'Taipei',         25.0330,  121.5654, 'landing_station', 'TW'),
  ('ICN', 'Seoul',          37.5665,  126.9780, 'landing_station', 'KR'),
  ('BOM', 'Mumbai',         19.0760,   72.8777, 'landing_station', 'IN'),
  ('MAA', 'Chennai',        13.0827,   80.2707, 'landing_station', 'IN'),
  ('DJI', 'Djibouti',       11.8251,   42.5903, 'landing_station', 'DJ'),
  ('DXB', 'Dubai',          25.2048,   55.2708, 'landing_station', 'AE'),
  ('LON', 'London',         51.5074,   -0.1278, 'landing_station', 'GB'),
  ('FRA', 'Frankfurt',      50.1109,    8.6821, 'terrestrial_pop', 'DE'),
  ('JAK', 'Jakarta',        -6.2088,  106.8456, 'landing_station', 'ID'),
  ('KUL', 'Kuala Lumpur',    3.1390,  101.6869, 'landing_station', 'MY')
ON CONFLICT (id) DO NOTHING;

-- ── Cable systems ───────────────────────────────────────────────────────────

INSERT INTO cable_systems (id, name, description) VALUES
  ('SXCS',        'Southern Cross Cable System',                 'Transpacific cable connecting Australia and New Zealand to the United States via Hawaii'),
  ('AJC',         'Australia-Japan Cable',                       'Cable connecting Australia to Japan via Guam'),
  ('PPC1',        'PIPE Pacific Cable-1',                        'Cable connecting Australia to Guam and Hawaii'),
  ('TGA',         'Tasman Global Access',                        'Cable connecting Australia and New Zealand'),
  ('SMW3',        'SEA-ME-WE 3',                                 'Southeast Asia - Middle East - Western Europe 3, connecting Asia to Europe'),
  ('SMW4',        'SEA-ME-WE 4',                                 'Southeast Asia - Middle East - Western Europe 4, connecting Asia to Europe'),
  ('AAG',         'Asia America Gateway',                        'Cable connecting Southeast Asia to the United States via Guam and Hawaii'),
  ('INDIGO_C',    'Indigo Central',                              'Cable connecting Australia to Singapore via Indonesia'),
  ('INDIGO_W',    'Indigo West',                                 'Cable connecting Australia to India via Singapore'),
  ('APG',         'Asia Pacific Gateway',                        'Cable connecting Japan, Korea, Taiwan, Hong Kong, and Southeast Asia'),
  ('EAC',         'East Asia Crossing',                          'Cable connecting Japan, Korea, and Southeast Asia'),
  ('TERRESTRIAL', 'Terrestrial',                                 'Terrestrial fibre segments'),
  ('JUNO',        'JUNO',                                        'Transpacific cable connecting Japan to California via Hawaii; owned by Seren Juno, supplied by NEC (RFS May 2025, 11,710 km)')
ON CONFLICT (id) DO NOTHING;

-- ── Segments ────────────────────────────────────────────────────────────────

INSERT INTO segments (id, name, system_id, start_node_id, end_node_id, type, length_km, reliability, cost_weight, ownership) VALUES
  -- SXCS
  ('SXCS-SYD-AKL', 'SXCS Sydney–Auckland',          'SXCS', 'SYD', 'AKL', 'wet',         2150, 0.9995, 8,  'owned'),
  ('SXCS-AKL-HAW', 'SXCS Auckland–Hawaii',           'SXCS', 'AKL', 'HAW', 'wet',         7830, 0.9992, 22, 'owned'),
  ('SXCS-SYD-HAW', 'SXCS Sydney–Hawaii (direct)',    'SXCS', 'SYD', 'HAW', 'wet',         8900, 0.9990, 26, 'owned'),
  ('SXCS-HAW-LAX', 'SXCS Hawaii–Los Angeles',        'SXCS', 'HAW', 'LAX', 'wet',         4150, 0.9994, 12, 'owned'),
  -- TGA
  ('TGA-SYD-AKL',  'TGA Sydney–Auckland',            'TGA',  'SYD', 'AKL', 'wet',         2230, 0.9994, 9,  'owned'),
  -- AJC
  ('AJC-SYD-GUM',  'AJC Sydney–Guam',                'AJC',  'SYD', 'GUM', 'wet',         5200, 0.9993, 16, 'owned'),
  ('AJC-GUM-TYO',  'AJC Guam–Tokyo',                 'AJC',  'GUM', 'TYO', 'wet',         2700, 0.9995, 10, 'owned'),
  ('AJC-GUM-OSA',  'AJC Guam–Osaka',                 'AJC',  'GUM', 'OSA', 'wet',         2850, 0.9994, 11, 'owned'),
  -- PPC1
  ('PPC1-SYD-GUM', 'PPC-1 Sydney–Guam',              'PPC1', 'SYD', 'GUM', 'wet',         5350, 0.9991, 17, 'iru'),
  ('PPC1-GUM-HAW', 'PPC-1 Guam–Hawaii',              'PPC1', 'GUM', 'HAW', 'wet',         5500, 0.9990, 18, 'iru'),
  -- AAG
  ('AAG-SIN-HKG',  'AAG Singapore–Hong Kong',        'AAG',  'SIN', 'HKG', 'wet',         2600, 0.9993, 10, 'consortium'),
  ('AAG-HKG-MNL',  'AAG Hong Kong–Manila',           'AAG',  'HKG', 'MNL', 'wet',          900, 0.9995, 5,  'consortium'),
  ('AAG-MNL-GUM',  'AAG Manila–Guam',                'AAG',  'MNL', 'GUM', 'wet',         2600, 0.9992, 10, 'consortium'),
  ('AAG-GUM-HAW',  'AAG Guam–Hawaii',                'AAG',  'GUM', 'HAW', 'wet',         5500, 0.9990, 18, 'consortium'),
  ('AAG-HAW-LAX',  'AAG Hawaii–Los Angeles',         'AAG',  'HAW', 'LAX', 'wet',         4150, 0.9994, 12, 'consortium'),
  -- Indigo
  ('INDIGO_C-PER-JAK', 'Indigo Central Perth–Jakarta',     'INDIGO_C', 'PER', 'JAK', 'wet', 2900, 0.9994, 11, 'owned'),
  ('INDIGO_C-JAK-SIN', 'Indigo Central Jakarta–Singapore', 'INDIGO_C', 'JAK', 'SIN', 'wet', 1100, 0.9996, 5,  'owned'),
  ('INDIGO_W-SIN-BOM', 'Indigo West Singapore–Mumbai',     'INDIGO_W', 'SIN', 'BOM', 'wet', 4200, 0.9992, 15, 'owned'),
  ('INDIGO_W-PER-SIN', 'Indigo West Perth–Singapore',      'INDIGO_W', 'PER', 'SIN', 'wet', 3900, 0.9993, 14, 'owned'),
  -- SMW3
  ('SMW3-SIN-BOM', 'SMW3 Singapore–Mumbai',          'SMW3', 'SIN', 'BOM', 'wet',         4200, 0.9988, 16, 'consortium'),
  ('SMW3-BOM-DJI', 'SMW3 Mumbai–Djibouti',           'SMW3', 'BOM', 'DJI', 'wet',         3100, 0.9987, 13, 'consortium'),
  ('SMW3-DJI-DXB', 'SMW3 Djibouti–Dubai',            'SMW3', 'DJI', 'DXB', 'wet',         1700, 0.9989, 8,  'consortium'),
  ('SMW3-DXB-LON', 'SMW3 Dubai–London',              'SMW3', 'DXB', 'LON', 'wet',         6200, 0.9985, 22, 'consortium'),
  -- SMW4
  ('SMW4-SIN-BOM', 'SMW4 Singapore–Mumbai',          'SMW4', 'SIN', 'BOM', 'wet',         4100, 0.9991, 15, 'consortium'),
  ('SMW4-BOM-DXB', 'SMW4 Mumbai–Dubai',              'SMW4', 'BOM', 'DXB', 'wet',         1900, 0.9992, 9,  'consortium'),
  ('SMW4-DXB-LON', 'SMW4 Dubai–London',              'SMW4', 'DXB', 'LON', 'wet',         6100, 0.9988, 21, 'consortium'),
  -- APG
  ('APG-HKG-TPE',  'APG Hong Kong–Taipei',           'APG',  'HKG', 'TPE', 'wet',          750, 0.9994, 4,  'consortium'),
  ('APG-TPE-TYO',  'APG Taipei–Tokyo',               'APG',  'TPE', 'TYO', 'wet',         2200, 0.9993, 9,  'consortium'),
  ('APG-SIN-HKG',  'APG Singapore–Hong Kong',        'APG',  'SIN', 'HKG', 'wet',         2600, 0.9992, 11, 'consortium'),
  -- EAC
  ('EAC-TYO-ICN',  'EAC Tokyo–Seoul',                'EAC',  'TYO', 'ICN', 'wet',         1100, 0.9996, 5,  'consortium'),
  ('EAC-ICN-HKG',  'EAC Seoul–Hong Kong',            'EAC',  'ICN', 'HKG', 'wet',         2800, 0.9993, 11, 'consortium'),
  -- Terrestrial
  ('TERR-SYD-MEL', 'Terrestrial Sydney–Melbourne',   'TERRESTRIAL', 'SYD', 'MEL', 'terrestrial',  880, 0.9990, 3, 'owned'),
  ('TERR-SYD-BRI', 'Terrestrial Sydney–Brisbane',    'TERRESTRIAL', 'SYD', 'BRI', 'terrestrial',  920, 0.9991, 3, 'owned'),
  ('TERR-MEL-PER', 'Terrestrial Melbourne–Perth',    'TERRESTRIAL', 'MEL', 'PER', 'terrestrial', 3440, 0.9985, 8, 'owned'),
  ('TERR-LON-FRA', 'Terrestrial London–Frankfurt',   'TERRESTRIAL', 'LON', 'FRA', 'terrestrial',  760, 0.9993, 3, 'iru'),
  ('TERR-SIN-KUL', 'Terrestrial Singapore–Kuala Lumpur', 'TERRESTRIAL', 'SIN', 'KUL', 'terrestrial', 350, 0.9992, 2, 'iru'),
  -- JUNO (direct transpacific, no Hawaii waypoint)
  ('JUNO-MNB-GRB', 'JUNO Minamiboso–Grover Beach',   'JUNO', 'MNB', 'GRB', 'wet',        11400, 0.9994, 34, 'consortium'),
  ('JUNO-SHM-GRB', 'JUNO Shima–Grover Beach',        'JUNO', 'SHM', 'GRB', 'wet',        11710, 0.9993, 35, 'consortium')
ON CONFLICT (id) DO NOTHING;

-- ── Interconnect rules ──────────────────────────────────────────────────────

INSERT INTO interconnect_rules (node_id, system_a_id, system_b_id) VALUES
  ('GUM', 'PPC1', 'AAG'),
  ('GUM', 'AAG',  'PPC1'),
  ('SIN', 'SMW3', 'SMW4'),
  ('SIN', 'SMW4', 'SMW3'),
  ('BOM', 'SMW3', 'INDIGO_W'),
  ('BOM', 'INDIGO_W', 'SMW3'),
  ('HAW', 'PPC1', 'AAG'),
  ('HAW', 'AAG',  'PPC1');
