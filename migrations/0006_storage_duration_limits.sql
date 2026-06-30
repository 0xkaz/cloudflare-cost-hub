-- Free-tier limits for storage/duration metrics: D1 storage, KV storage,
-- and Durable Objects compute duration.
INSERT OR IGNORE INTO free_tier_limits (product, metric, limit_value, unit, effective_from) VALUES
  ('D1', 'storage', 5, 'GB', '2025-01-01'),
  ('KV', 'storage', 1, 'GB', '2025-01-01'),
  ('Durable Objects', 'duration', 400000, 'GB-s/month', '2025-01-01');
