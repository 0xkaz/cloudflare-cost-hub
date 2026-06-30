-- Billing entitlement keyed by the monitored Cloudflare account rather than the
-- signed-in user. The product's value (and its shared cost history/budgets) is
-- tied to an account, and several teammates may connect the same account — so a
-- paid plan applies to everyone watching that account. The user who purchased it
-- is recorded for Stripe management. Supersedes user_alert_settings.plan /
-- paid_until (left in place but no longer read).
CREATE TABLE IF NOT EXISTS account_entitlements (
  account_id TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'free',      -- 'free' | 'paid'
  paid_until TEXT,                        -- ISO timestamp; entitled while > now
  purchased_by_user_id TEXT,              -- who manages/cancels the subscription
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  updated_at TEXT NOT NULL
);
