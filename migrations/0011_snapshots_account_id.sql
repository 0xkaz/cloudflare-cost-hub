-- Multi-tenant cost history: scope each snapshot to a Cloudflare account so
-- multiple connected accounts keep independent daily/monthly series. Previously
-- the table had a single global `date` primary key (single-account assumption).
--
-- SQLite cannot drop a PRIMARY KEY in place, so rebuild the table with a
-- composite (account_id, date) key. Legacy rows are adopted under the
-- '__legacy__' sentinel; the first scheduled capture for the env-configured
-- account remaps them to its real account id (see snapshots.ts adoptLegacy*).
CREATE TABLE IF NOT EXISTS usage_snapshots_new (
  account_id TEXT NOT NULL DEFAULT '__legacy__',
  date TEXT NOT NULL,         -- YYYY-MM-DD (UTC)
  month TEXT NOT NULL,        -- YYYY-MM
  cost REAL NOT NULL,         -- estimated month-to-date cost at capture time
  forecast REAL NOT NULL,     -- projected month-end cost
  captured_at TEXT NOT NULL,
  payload TEXT,               -- JSON snapshot of free-tier status (optional)
  PRIMARY KEY (account_id, date)
);

INSERT INTO usage_snapshots_new (account_id, date, month, cost, forecast, captured_at, payload)
  SELECT '__legacy__', date, month, cost, forecast, captured_at, payload
  FROM usage_snapshots;

DROP TABLE usage_snapshots;
ALTER TABLE usage_snapshots_new RENAME TO usage_snapshots;

CREATE INDEX IF NOT EXISTS idx_usage_snapshots_month ON usage_snapshots(month);
CREATE INDEX IF NOT EXISTS idx_usage_snapshots_acct_month ON usage_snapshots(account_id, month);
