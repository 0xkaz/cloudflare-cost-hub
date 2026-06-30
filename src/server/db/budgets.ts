import type { D1Database } from '@cloudflare/workers-types';

export interface Budget {
  monthlyLimit: number; // USD
}

export async function getBudget(
  db: D1Database,
  userId: string,
  accountId: string
): Promise<Budget | null> {
  const row = await db
    .prepare('SELECT monthly_limit FROM budgets WHERE user_id = ? AND account_id = ?')
    .bind(userId, accountId)
    .first();
  return row ? { monthlyLimit: Number(row.monthly_limit) } : null;
}

export async function setBudget(
  db: D1Database,
  userId: string,
  accountId: string,
  monthlyLimit: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO budgets (user_id, account_id, monthly_limit, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, account_id) DO UPDATE SET
         monthly_limit = excluded.monthly_limit,
         updated_at = excluded.updated_at`
    )
    .bind(userId, accountId, monthlyLimit, new Date().toISOString())
    .run();
}

export async function deleteBudget(
  db: D1Database,
  userId: string,
  accountId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM budgets WHERE user_id = ? AND account_id = ?')
    .bind(userId, accountId)
    .run();
}
