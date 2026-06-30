-- Expanded free-tier limits covering all observed products (Workers, D1, KV,
-- Pages, Durable Objects, R2). effective_from is newer than the 0002 seed so
-- getFreeTierLimits() prefers these rows. Older 0002 rows are left in place but
-- are no longer referenced by the dashboard.
INSERT OR IGNORE INTO free_tier_limits (product, metric, limit_value, unit, effective_from) VALUES
  ('Workers', 'requests', 100000, 'requests/day', '2025-01-01'),
  ('D1', 'rows read', 5000000, 'rows/day', '2025-01-01'),
  ('D1', 'rows written', 100000, 'rows/day', '2025-01-01'),
  ('KV', 'reads', 100000, 'reads/day', '2025-01-01'),
  ('KV', 'writes', 1000, 'writes/day', '2025-01-01'),
  ('Pages', 'requests', 100000, 'requests/day', '2025-01-01'),
  ('Durable Objects', 'requests', 1000000, 'requests/day', '2025-01-01'),
  ('R2', 'Class A operations', 1000000, 'operations/month', '2025-01-01'),
  ('R2', 'Class B operations', 10000000, 'operations/month', '2025-01-01'),
  ('R2', 'storage', 10, 'GB', '2025-01-01');
