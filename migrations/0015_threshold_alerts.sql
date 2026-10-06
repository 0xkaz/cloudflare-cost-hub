-- Highest usage threshold (% of the paid-plan monthly allowance) already notified,
-- per alert scope (user:<id> or env), Cloudflare account, month and metric.
-- A new e-mail is sent only when a metric reaches a higher threshold.
CREATE TABLE IF NOT EXISTS threshold_alert_state (
  scope TEXT NOT NULL,
  account_id TEXT NOT NULL,
  period TEXT NOT NULL,        -- YYYY-MM
  metric_key TEXT NOT NULL,    -- "<product>|<metric>"
  level INTEGER NOT NULL,      -- highest threshold notified, e.g. 50
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, account_id, period, metric_key)
);
