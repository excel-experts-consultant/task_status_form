-- Three test sites so the app can be tried straight away. Delete or overwrite them
-- later by importing your real list on the admin Sites tab.
INSERT OR IGNORE INTO sites (name, code, region, diesel_cell) VALUES
  ('TEST Site A', 'TST01', 'Rajasthan', NULL),
  ('TEST Site B', 'TST02', 'Rajasthan', NULL),
  ('TEST Site C', 'TST03', 'Rajasthan', NULL);
