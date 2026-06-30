import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAccountUsage, fetchInstanceBreakdown } from '../../src/server/cloudflare-api';
import { DEFAULT_FREE_TIER_LIMITS } from '../../src/server/db/free-tier';

const ACCOUNT = { accountId: 'acc', apiToken: 'tok', name: 'Test' };

interface Row {
  dimensions: Record<string, string>;
  sum?: Record<string, number>;
  max?: Record<string, number>;
  count?: number;
}

// Route each GraphQL request to dataset-specific rows based on the dataset name
// present in the query string. Rows carry a superset of dimensions so the same
// fixtures work for both date-aggregation and per-instance aggregation.
function routeFetch(dataMap: Record<string, Row[]>) {
  return vi.fn(async (_url: string, init?: { body?: string }) => {
    const query: string = init?.body ? (JSON.parse(init.body).query as string) : '';
    const dataset = Object.keys(dataMap).find((ds) => query.includes(ds));
    const rows = dataset ? dataMap[dataset] : [];
    return {
      ok: true,
      json: async () => ({ data: { viewer: { accounts: [{ [dataset ?? 'x']: rows }] } } }),
    } as Response;
  });
}

describe('multi-product usage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('estimates cost across products from monthly totals', async () => {
    vi.mocked(fetch).mockImplementation(
      routeFetch({
        workersInvocationsAdaptive: [
          { dimensions: { date: '2026-06-10', scriptName: 'a' }, sum: { requests: 6_000_000 } },
          { dimensions: { date: '2026-06-11', scriptName: 'b' }, sum: { requests: 6_000_000 } },
        ],
        d1AnalyticsAdaptiveGroups: [
          { dimensions: { date: '2026-06-10', databaseId: 'db-a' }, sum: { rowsRead: 10_000_000_000, rowsWritten: 0 } },
          { dimensions: { date: '2026-06-11', databaseId: 'db-b' }, sum: { rowsRead: 20_000_000_000, rowsWritten: 0 } },
        ],
      }) as unknown as typeof fetch
    );

    const usage = await fetchAccountUsage(ACCOUNT, DEFAULT_FREE_TIER_LIMITS);

    // Workers: 12M used - 10M included = 2M over * $0.30/M = $0.60
    // D1 read: 30B used - 25B included = 5B over / 1M * $0.001 = $5.00
    expect(usage.currentMonthCost).toBeCloseTo(5.6, 2);

    const d1Read = usage.freeTierStatus.find(
      (s) => s.product === 'D1' && s.metric === 'rows read'
    );
    expect(d1Read?.monthlyUsed).toBe(30_000_000_000);
    expect(d1Read?.estimatedCost).toBeCloseTo(5.0, 2);
    expect(d1Read?.paidIncluded).toBe(25_000_000_000);
  });

  it('classifies R2 operations into Class A and Class B', async () => {
    vi.mocked(fetch).mockImplementation(
      routeFetch({
        workersInvocationsAdaptive: [],
        r2OperationsAdaptiveGroups: [
          { dimensions: { date: '2026-06-10', actionType: 'PutObject', bucketName: 'bk' }, sum: { requests: 100 } },
          { dimensions: { date: '2026-06-10', actionType: 'GetObject', bucketName: 'bk' }, sum: { requests: 900 } },
          { dimensions: { date: '2026-06-10', actionType: 'DeleteObject', bucketName: 'bk' }, sum: { requests: 50 } },
        ],
      }) as unknown as typeof fetch
    );

    const usage = await fetchAccountUsage(ACCOUNT, DEFAULT_FREE_TIER_LIMITS);
    const classA = usage.freeTierStatus.find((s) => s.metric === 'Class A operations');
    const classB = usage.freeTierStatus.find((s) => s.metric === 'Class B operations');

    expect(classA?.used).toBe(100); // PutObject only (DeleteObject is free)
    expect(classB?.used).toBe(900); // GetObject
  });

  it('aggregates a metric by instance, sorted descending', async () => {
    vi.mocked(fetch).mockImplementation(
      routeFetch({
        d1AnalyticsAdaptiveGroups: [
          { dimensions: { databaseId: 'db-a' }, sum: { rowsRead: 10_000_000_000 } },
          { dimensions: { databaseId: 'db-b' }, sum: { rowsRead: 20_000_000_000 } },
        ],
      }) as unknown as typeof fetch
    );

    const breakdown = await fetchInstanceBreakdown(ACCOUNT, 'D1', 'rows read', 'rows/day');

    expect(breakdown?.instanceLabel).toBe('database');
    expect(breakdown?.instances).toHaveLength(2);
    expect(breakdown?.instances[0]).toMatchObject({ id: 'db-b', value: 20_000_000_000 });
    expect(breakdown?.total).toBe(30_000_000_000);
  });

  it('returns null breakdown for an unsupported metric', async () => {
    const breakdown = await fetchInstanceBreakdown(ACCOUNT, 'Nope', 'whatever', 'x');
    expect(breakdown).toBeNull();
  });

  it('projects the current month forecast at or above month-to-date cost', async () => {
    vi.mocked(fetch).mockImplementation(
      routeFetch({
        workersInvocationsAdaptive: [
          { dimensions: { date: '2026-06-10', scriptName: 'a' }, sum: { requests: 30_000_000 } },
        ],
      }) as unknown as typeof fetch
    );
    const usage = await fetchAccountUsage(ACCOUNT, DEFAULT_FREE_TIER_LIMITS);
    // Forecast extrapolates the run-rate to month-end, so it is never below MTD.
    expect(usage.forecastedCost).toBeGreaterThanOrEqual(usage.currentMonthCost);
  });
});
