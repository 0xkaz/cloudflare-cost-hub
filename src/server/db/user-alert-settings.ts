import type { D1Database } from '@cloudflare/workers-types';

export interface UserAlertSetting {
  userId: string;
  email: string | null; // recipient(s), comma-separated; null = use login email
  enabled: boolean;
  lastSentDate: string | null;
  plan: 'free' | 'paid';
  paidUntil: string | null;
}

function mapRow(r: Record<string, unknown>): UserAlertSetting {
  return {
    userId: String(r.user_id),
    email: r.email ? String(r.email) : null,
    enabled: Number(r.enabled) === 1,
    lastSentDate: r.last_sent_date ? String(r.last_sent_date) : null,
    plan: String(r.plan) === 'paid' ? 'paid' : 'free',
    paidUntil: r.paid_until ? String(r.paid_until) : null,
  };
}

export async function getUserAlertSetting(
  db: D1Database,
  userId: string
): Promise<UserAlertSetting | null> {
  const r = await db
    .prepare(
      `SELECT user_id, email, enabled, last_sent_date, plan, paid_until
       FROM user_alert_settings WHERE user_id = ?`
    )
    .bind(userId)
    .first();
  return r ? mapRow(r as Record<string, unknown>) : null;
}

// Upsert the user-editable fields (email + enabled). Billing fields (plan /
// paid_until) are managed separately by the payment webhook, so they are left
// untouched here and default to 'free' / null on first insert.
export async function upsertUserAlertSetting(
  db: D1Database,
  userId: string,
  fields: { email: string | null; enabled: boolean }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_alert_settings (user_id, email, enabled, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         email = excluded.email,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`
    )
    .bind(userId, fields.email, fields.enabled ? 1 : 0, new Date().toISOString())
    .run();
}

export async function listEnabledAlertSettings(db: D1Database): Promise<UserAlertSetting[]> {
  const { results } = await db
    .prepare(
      `SELECT user_id, email, enabled, last_sent_date, plan, paid_until
       FROM user_alert_settings WHERE enabled = 1`
    )
    .all();
  return (results || []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function setAlertLastSent(
  db: D1Database,
  userId: string,
  date: string
): Promise<void> {
  await db
    .prepare('UPDATE user_alert_settings SET last_sent_date = ? WHERE user_id = ?')
    .bind(date, userId)
    .run();
}
