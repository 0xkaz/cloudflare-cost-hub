import type { D1Database } from '@cloudflare/workers-types';

export interface FreeTierLimit {
  product: string;
  metric: string;
  limit: number;
  unit: string;
  effectiveFrom: string;
}

// Cloudflare free-tier limits. These are the in-code fallback; the live values
// come from the free_tier_limits table (see migration 0003), so they can be
// updated without a code deploy when Cloudflare changes its free tier.
export const DEFAULT_FREE_TIER_LIMITS: FreeTierLimit[] = [
  { product: 'Workers', metric: 'requests', limit: 100_000, unit: 'requests/day', effectiveFrom: '2025-01-01' },
  { product: 'D1', metric: 'rows read', limit: 5_000_000, unit: 'rows/day', effectiveFrom: '2025-01-01' },
  { product: 'D1', metric: 'rows written', limit: 100_000, unit: 'rows/day', effectiveFrom: '2025-01-01' },
  { product: 'KV', metric: 'reads', limit: 100_000, unit: 'reads/day', effectiveFrom: '2025-01-01' },
  { product: 'KV', metric: 'writes', limit: 1_000, unit: 'writes/day', effectiveFrom: '2025-01-01' },
  { product: 'Pages', metric: 'requests', limit: 100_000, unit: 'requests/day', effectiveFrom: '2025-01-01' },
  { product: 'Durable Objects', metric: 'requests', limit: 1_000_000, unit: 'requests/day', effectiveFrom: '2025-01-01' },
  { product: 'Durable Objects', metric: 'duration', limit: 400_000, unit: 'GB-s/month', effectiveFrom: '2025-01-01' },
  { product: 'D1', metric: 'storage', limit: 5, unit: 'GB', effectiveFrom: '2025-01-01' },
  { product: 'KV', metric: 'storage', limit: 1, unit: 'GB', effectiveFrom: '2025-01-01' },
  { product: 'Workers AI', metric: 'neurons', limit: 10_000, unit: 'neurons/day', effectiveFrom: '2025-01-01' },
  { product: 'Queues', metric: 'operations', limit: 1_000_000, unit: 'operations/month', effectiveFrom: '2025-01-01' },
  { product: 'R2', metric: 'Class A operations', limit: 1_000_000, unit: 'operations/month', effectiveFrom: '2025-01-01' },
  { product: 'R2', metric: 'Class B operations', limit: 10_000_000, unit: 'operations/month', effectiveFrom: '2025-01-01' },
  { product: 'R2', metric: 'storage', limit: 10, unit: 'GB', effectiveFrom: '2025-01-01' },
];

export async function getFreeTierLimits(db: D1Database): Promise<FreeTierLimit[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT product, metric, limit_value, unit, effective_from
         FROM free_tier_limits
         WHERE effective_from <= date('now')
         ORDER BY effective_from DESC`
      )
      .all();
    if (!results || results.length === 0) return DEFAULT_FREE_TIER_LIMITS;
    return results.map((row) => ({
      product: String(row.product),
      metric: String(row.metric),
      limit: Number(row.limit_value),
      unit: String(row.unit),
      effectiveFrom: String(row.effective_from),
    }));
  } catch {
    return DEFAULT_FREE_TIER_LIMITS;
  }
}

export function findLimit(
  limits: FreeTierLimit[],
  product: string,
  metric: string
): FreeTierLimit | undefined {
  return limits.find((l) => l.product === product && l.metric === metric);
}
