-- Configurable free-tier limits per product/metric
CREATE TABLE IF NOT EXISTS free_tier_limits (
  product TEXT NOT NULL,
  metric TEXT NOT NULL,
  limit_value REAL NOT NULL,
  unit TEXT NOT NULL,
  effective_from TEXT NOT NULL DEFAULT '1970-01-01',
  PRIMARY KEY (product, metric, effective_from)
);

-- Seed default limits (Cloudflare free tier as of 2024)
INSERT OR IGNORE INTO free_tier_limits (product, metric, limit_value, unit, effective_from) VALUES
  ('Workers', 'requests', 100000, 'requests/day', '2024-01-01'),
  ('Workers (Monthly trend)', 'requests', 3000000, 'requests/month', '2024-01-01'),
  ('R2', 'class-a-operations', 1000000, 'operations/month', '2024-01-01'),
  ('R2', 'class-b-operations', 10000000, 'operations/month', '2024-01-01'),
  ('Pages', 'function-invocations', 100000, 'requests/day', '2024-01-01');
