import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  SESSION_SECRET: string;
  // Cloudflare Analytics API token + account for live cost/usage data.
  // When unset, the dashboard falls back to demo data.
  CF_ANALYTICS_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_ACCOUNT_NAME?: string;
  // Public base URL of this deployment, used for links in alert emails. Falls
  // back to the reference deployment's URL when unset.
  APP_URL?: string;
  // Email alerts via Resend. When RESEND_API_KEY is unset, alerts are disabled.
  RESEND_API_KEY?: string;
  ALERT_EMAIL_FROM?: string;
  ALERT_EMAIL_TO?: string;
  // Usage-threshold alerts: comma-separated % of the paid-plan monthly allowance
  // (default "20,40,50,70,80,90"). Checked by the hourly cron.
  ALERT_THRESHOLDS?: string;
  // Monetization flag. While unset/"false", every enabled user receives alerts
  // (no payment enforced yet). Set to "true" to gate automated alerts behind a
  // paid plan (user_alert_settings.plan / paid_until).
  ALERTS_REQUIRE_PAYMENT?: string;
  // Cloudflare OAuth (self-managed client) for per-user account connections.
  CF_OAUTH_CLIENT_ID?: string;
  CF_OAUTH_CLIENT_SECRET?: string;
  CF_OAUTH_REDIRECT_URI?: string;
  // Extra OAuth scopes appended to the built-in read scopes (space-separated).
  // e.g. "user-details.read" to enable the real verified email via /user.
  CF_OAUTH_EXTRA_SCOPES?: string;
  TOKEN_ENC_KEY?: string; // base64 32-byte AES-GCM key for encrypting stored tokens
  // Optional KV cache for computed dashboard/usage responses. When unbound, the
  // app recomputes on every request (see server/cache.ts).
  CACHE?: KVNamespace;
  __STATIC_CONTENT: KVNamespace;
}

export interface Session {
  userId: string;
  email: string;
}
