-- Free-tier limits for Workers AI (Neurons) and Queues (message operations).
INSERT OR IGNORE INTO free_tier_limits (product, metric, limit_value, unit, effective_from) VALUES
  ('Workers AI', 'neurons', 10000, 'neurons/day', '2025-01-01'),
  ('Queues', 'operations', 1000000, 'operations/month', '2025-01-01');
