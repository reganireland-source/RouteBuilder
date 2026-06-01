-- Migration 002: split terrestrial_pop into primary_pop / secondary_pop / extension_pop
--
-- Storage note: RouteBuilder uses JSONB. The type field lives inside data->>'type'.
--
-- Logic:
--   primary_pop   = node connected to exactly one landing_station via a single direct segment
--   secondary_pop = remainder (random 50/50 split with seed 42)
--   extension_pop = remainder (random 50/50 split with seed 42)
--
-- Run once against any database that still has terrestrial_pop rows.

UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'AKL2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'AUH1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'BLR1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'BOM2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'BRI2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'CBR1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'CHI1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'DAL1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'DAR2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"extension_pop"') WHERE data->>'id' = 'DEL1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'DJI2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'DXB2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-BQ1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-BS1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-CH1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-CH2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-DA1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"extension_pop"') WHERE data->>'id' = 'EQ-DA2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-LA1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-LA2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-ME1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-ME2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-MI1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-MI3';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-NG1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"extension_pop"') WHERE data->>'id' = 'EQ-NY1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-NY5';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"extension_pop"') WHERE data->>'id' = 'EQ-NY9';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"extension_pop"') WHERE data->>'id' = 'EQ-OS1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-OS2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-PE1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"extension_pop"') WHERE data->>'id' = 'EQ-SE2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"extension_pop"') WHERE data->>'id' = 'EQ-SE3';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"extension_pop"') WHERE data->>'id' = 'EQ-SL1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-SY1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-SY3';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"extension_pop"') WHERE data->>'id' = 'EQ-SY4';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-TY1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'EQ-TY2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"extension_pop"') WHERE data->>'id' = 'EQ-TY3';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'FRA1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'GUM2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'HAW2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'HKG2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'ICN2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'JAK2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"extension_pop"') WHERE data->>'id' = 'KHH1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'KUL2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'LAX2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'LON2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'MAA2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'MAN1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'MEL2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"extension_pop"') WHERE data->>'id' = 'MIA1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'MNL2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'MNL3';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"extension_pop"') WHERE data->>'id' = 'NGO1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'NYC1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'OSA2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'PEN1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'PER2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"extension_pop"') WHERE data->>'id' = 'PUS1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'SEA2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"secondary_pop"') WHERE data->>'id' = 'SHA1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'SIN2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'SUB1';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'SYD2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'TPE2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'TYO2';
UPDATE nodes SET data = jsonb_set(data, '{type}', '"primary_pop"')   WHERE data->>'id' = 'WLG1';
