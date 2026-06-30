-- Generic key/value app settings (e.g. the alert recipient email), editable
-- from the UI without a redeploy.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
