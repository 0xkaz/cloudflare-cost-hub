import type { D1Database } from '@cloudflare/workers-types';

// Pre-multi-tenant rows were captured for a single (env-configured) account and
// migrated under this sentinel. adoptLegacySnapshots() reassigns them to the
// real account id on its first capture.
export const LEGACY_ACCOUNT_ID = '__legacy__';

export interface UsageSnapshot {
  accountId: string;
  date: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  cost: number;
  forecast: number;
  capturedAt: string;
  payload?: string;
}

export interface MonthlyCost {
  month: string;
  cost: number;
  forecast: number;
}

export async function upsertSnapshot(db: D1Database, s: UsageSnapshot): Promise<void> {
  await db
    .prepare(
      `INSERT INTO usage_snapshots (account_id, date, month, cost, forecast, captured_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, date) DO UPDATE SET
         month = excluded.month,
         cost = excluded.cost,
         forecast = excluded.forecast,
         captured_at = excluded.captured_at,
         payload = excluded.payload`
    )
    .bind(s.accountId, s.date, s.month, s.cost, s.forecast, s.capturedAt, s.payload ?? null)
    .run();
}

// Reassign any legacy (pre-multi-tenant) snapshots to their real account id.
// Idempotent and cheap: a no-op once the sentinel rows are gone.
export async function adoptLegacySnapshots(db: D1Database, accountId: string): Promise<void> {
  if (accountId === LEGACY_ACCOUNT_ID) return;
  await db
    .prepare(
      `UPDATE usage_snapshots SET account_id = ?
       WHERE account_id = ?
         AND date NOT IN (SELECT date FROM usage_snapshots WHERE account_id = ?)`
    )
    .bind(accountId, LEGACY_ACCOUNT_ID, accountId)
    .run();
  // Drop any leftovers that collided with already-captured real-account dates.
  await db
    .prepare('DELETE FROM usage_snapshots WHERE account_id = ?')
    .bind(LEGACY_ACCOUNT_ID)
    .run();
}

export async function hasSnapshotForMonth(
  db: D1Database,
  accountId: string,
  month: string
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM usage_snapshots WHERE account_id = ? AND month = ? LIMIT 1')
    .bind(accountId, month)
    .first();
  return Boolean(row);
}

interface SnapshotMetric {
  product: string;
  estimatedCost?: number;
}

// Per-product monthly cost derived from snapshot payloads (latest snapshot per
// month) for one account. Used for the per-service trend in the Services view.
export async function getServiceTrends(
  db: D1Database,
  accountId: string
): Promise<Array<{ product: string; points: Array<{ month: string; cost: number }> }>> {
  const { results } = await db
    .prepare(
      `SELECT s.month AS month, s.payload AS payload
       FROM usage_snapshots s
       WHERE s.account_id = ?1
         AND s.date = (SELECT MAX(date) FROM usage_snapshots WHERE account_id = ?1 AND month = s.month)
       ORDER BY s.month`
    )
    .bind(accountId)
    .all();

  const byProduct = new Map<string, Map<string, number>>();
  for (const row of results || []) {
    const month = String(row.month);
    let metrics: SnapshotMetric[] = [];
    try {
      metrics = JSON.parse(String(row.payload || '[]')) as SnapshotMetric[];
    } catch {
      metrics = [];
    }
    const perProduct = new Map<string, number>();
    for (const m of metrics) {
      perProduct.set(m.product, (perProduct.get(m.product) || 0) + (m.estimatedCost || 0));
    }
    for (const [product, cost] of perProduct) {
      if (!byProduct.has(product)) byProduct.set(product, new Map());
      byProduct.get(product)!.set(month, Math.round(cost * 100) / 100);
    }
  }

  return [...byProduct.entries()].map(([product, monthMap]) => ({
    product,
    points: [...monthMap.entries()].map(([month, cost]) => ({ month, cost })),
  }));
}

// Latest snapshot per month for one account — for a completed month this is the
// month's total.
export async function getMonthlyCosts(db: D1Database, accountId: string): Promise<MonthlyCost[]> {
  const { results } = await db
    .prepare(
      `SELECT s.month AS month, s.cost AS cost, s.forecast AS forecast
       FROM usage_snapshots s
       WHERE s.account_id = ?1
         AND s.date = (SELECT MAX(date) FROM usage_snapshots WHERE account_id = ?1 AND month = s.month)
       ORDER BY s.month`
    )
    .bind(accountId)
    .all();
  return (results || []).map((r) => ({
    month: String(r.month),
    cost: Number(r.cost),
    forecast: Number(r.forecast),
  }));
}
