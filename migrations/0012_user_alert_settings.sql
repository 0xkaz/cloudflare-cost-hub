-- Per-user email alert preferences and billing entitlement. Replaces the single
-- global alert recipient (app_settings.alert_email) + global alert_state so each
-- signed-in user controls their own digest, scoped to their connected account.
--
-- `plan`/`paid_until` carry the monetization entitlement. They are enforced only
-- when env ALERTS_REQUIRE_PAYMENT="true"; until then every enabled user receives
-- alerts (see alerts.ts isEntitled). Pricing target: ~$10-12/year (see plan/).
CREATE TABLE IF NOT EXISTS user_alert_settings (
  user_id TEXT PRIMARY KEY,
  email TEXT,                         -- recipient(s), comma-separated; null = use login email
  enabled INTEGER NOT NULL DEFAULT 1, -- 0/1
  last_sent_date TEXT,                -- YYYY-MM-DD of the last sent digest (idempotency)
  plan TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'paid'
  paid_until TEXT,                    -- ISO timestamp; entitled while > now
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_alert_settings_enabled ON user_alert_settings(enabled);
