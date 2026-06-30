-- Per-user Cloudflare OAuth connections. Access/refresh tokens are stored
-- AES-GCM encrypted (see crypto.ts). One row per app user.
CREATE TABLE IF NOT EXISTS cf_oauth_tokens (
  user_id TEXT PRIMARY KEY,
  account_id TEXT,
  account_name TEXT,
  access_token TEXT NOT NULL,   -- encrypted
  refresh_token TEXT,           -- encrypted
  expires_at INTEGER,           -- epoch seconds
  scope TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
