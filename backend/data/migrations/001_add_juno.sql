-- Migration 001: Add JUNO cable (Minamiboso, Shima → Grover Beach, direct transpacific)

INSERT INTO nodes (id, name, lat, lng, type, country) VALUES
  ('MNB', 'Minamiboso', 35.1562,  140.0346, 'landing_station', 'JP'),
  ('SHM', 'Shima',      34.3270,  136.8734, 'landing_station', 'JP'),
  ('GRB', 'Grover Beach', 35.1219, -120.6218, 'landing_station', 'US')
ON CONFLICT (id) DO NOTHING;

INSERT INTO cable_systems (id, name, description) VALUES
  ('JUNO', 'JUNO', 'Transpacific cable connecting Japan to California; owned by Seren Juno, supplied by NEC (RFS May 2025, 11,710 km)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO segments (id, name, system_id, start_node_id, end_node_id, type, length_km, reliability, cost_weight, ownership) VALUES
  ('JUNO-MNB-GRB', 'JUNO Minamiboso–Grover Beach', 'JUNO', 'MNB', 'GRB', 'wet', 11400, 0.9994, 34, 'consortium'),
  ('JUNO-SHM-GRB', 'JUNO Shima–Grover Beach',       'JUNO', 'SHM', 'GRB', 'wet', 11710, 0.9993, 35, 'consortium')
ON CONFLICT (id) DO NOTHING;
