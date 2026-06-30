-- Per-user, per-account monthly spend budget (USD). The dashboard/alerts compare
-- the month-end forecast against this limit to warn before an overage.
CREATE TABLE IF NOT EXISTS budgets (
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  monthly_limit REAL NOT NULL, -- USD
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, account_id)
);
