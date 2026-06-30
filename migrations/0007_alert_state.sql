-- Tracks the last date a daily alert email was sent, so the scheduled handler
-- sends at most one digest per day even if it runs more than once.
CREATE TABLE IF NOT EXISTS alert_state (
  id TEXT PRIMARY KEY,
  last_sent_date TEXT
);
