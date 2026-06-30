-- Daily usage/cost snapshots so cost history survives beyond Cloudflare
-- Analytics' ~90 day retention window. One row per captured date; the latest
-- row in a month represents that month's running total.
CREATE TABLE IF NOT EXISTS usage_snapshots (
  date TEXT PRIMARY KEY,      -- YYYY-MM-DD (UTC)
  month TEXT NOT NULL,        -- YYYY-MM
  cost REAL NOT NULL,         -- estimated month-to-date cost at capture time
  forecast REAL NOT NULL,     -- projected month-end cost
  captured_at TEXT NOT NULL,
  payload TEXT                -- JSON snapshot of free-tier status (optional)
);

CREATE INDEX IF NOT EXISTS idx_usage_snapshots_month ON usage_snapshots(month);
