import type { D1Database } from '@cloudflare/workers-types';

export interface CfTokenRow {
  userId: string;
  accountId: string | null;
  accountName: string | null;
  accessToken: string; // encrypted
  refreshToken: string | null; // encrypted
  expiresAt: number | null;
  scope: string | null;
  accounts: string | null; // JSON [{id,name}] of all authorized accounts
}

export async function upsertCfToken(db: D1Database, row: CfTokenRow): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO cf_oauth_tokens
         (user_id, account_id, account_name, access_token, refresh_token, expires_at, scope, accounts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         account_id = excluded.account_id,
         account_name = excluded.account_name,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         accounts = excluded.accounts,
         updated_at = excluded.updated_at`
    )
    .bind(
      row.userId,
      row.accountId,
      row.accountName,
      row.accessToken,
      row.refreshToken,
      row.expiresAt,
      row.scope,
      row.accounts,
      now,
      now
    )
    .run();
}

// Switch the active account without touching the stored tokens.
export async function setActiveAccount(
  db: D1Database,
  userId: string,
  accountId: string,
  accountName: string
): Promise<void> {
  await db
    .prepare(
      `UPDATE cf_oauth_tokens SET account_id = ?, account_name = ?, updated_at = ?
       WHERE user_id = ?`
    )
    .bind(accountId, accountName, new Date().toISOString(), userId)
    .run();
}

export async function getCfToken(db: D1Database, userId: string): Promise<CfTokenRow | null> {
  const r = await db
    .prepare(
      `SELECT user_id, account_id, account_name, access_token, refresh_token, expires_at, scope, accounts
       FROM cf_oauth_tokens WHERE user_id = ?`
    )
    .bind(userId)
    .first();
  if (!r) return null;
  return {
    userId: String(r.user_id),
    accountId: r.account_id ? String(r.account_id) : null,
    accountName: r.account_name ? String(r.account_name) : null,
    accessToken: String(r.access_token),
    refreshToken: r.refresh_token ? String(r.refresh_token) : null,
    expiresAt: r.expires_at ? Number(r.expires_at) : null,
    scope: r.scope ? String(r.scope) : null,
    accounts: r.accounts ? String(r.accounts) : null,
  };
}

export async function deleteCfToken(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM cf_oauth_tokens WHERE user_id = ?').bind(userId).run();
}

// Every connected user's token row — used by the scheduled handler to fan out
// snapshots/alerts over all accounts rather than a single env-configured one.
export async function listAllCfTokens(db: D1Database): Promise<CfTokenRow[]> {
  const { results } = await db
    .prepare(
      `SELECT user_id, account_id, account_name, access_token, refresh_token, expires_at, scope, accounts
       FROM cf_oauth_tokens`
    )
    .all();
  return (results || []).map((r) => ({
    userId: String(r.user_id),
    accountId: r.account_id ? String(r.account_id) : null,
    accountName: r.account_name ? String(r.account_name) : null,
    accessToken: String(r.access_token),
    refreshToken: r.refresh_token ? String(r.refresh_token) : null,
    expiresAt: r.expires_at ? Number(r.expires_at) : null,
    scope: r.scope ? String(r.scope) : null,
    accounts: r.accounts ? String(r.accounts) : null,
  }));
}
