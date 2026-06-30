import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestD1, type TestD1 } from '../helpers/d1';
import {
  upsertSnapshot,
  getMonthlyCosts,
  getServiceTrends,
  hasSnapshotForMonth,
  adoptLegacySnapshots,
  LEGACY_ACCOUNT_ID,
} from '../../src/server/db/snapshots';
import { getCostTrend } from '../../src/server/snapshots';
import type { Env } from '../../src/server/types';

let t: TestD1;
beforeEach(() => {
  t = createTestD1();
});
afterEach(() => t.close());

function payload(product: string, cost: number): string {
  return JSON.stringify([{ product, metric: 'requests', used: 1, percentage: 1, estimatedCost: cost }]);
}

describe('usage_snapshots account scoping', () => {
  it('keeps each account’s monthly costs separate', async () => {
    await upsertSnapshot(t.db, { accountId: 'acc-1', date: '2026-06-10', month: '2026-06', cost: 5, forecast: 9, capturedAt: 'x' });
    await upsertSnapshot(t.db, { accountId: 'acc-2', date: '2026-06-10', month: '2026-06', cost: 50, forecast: 90, capturedAt: 'x' });

    const a1 = await getMonthlyCosts(t.db, 'acc-1');
    const a2 = await getMonthlyCosts(t.db, 'acc-2');
    expect(a1).toEqual([{ month: '2026-06', cost: 5, forecast: 9 }]);
    expect(a2).toEqual([{ month: '2026-06', cost: 50, forecast: 90 }]);
  });

  it('uses the latest snapshot in a month as that month’s total', async () => {
    await upsertSnapshot(t.db, { accountId: 'acc-1', date: '2026-06-05', month: '2026-06', cost: 3, forecast: 8, capturedAt: 'x' });
    await upsertSnapshot(t.db, { accountId: 'acc-1', date: '2026-06-20', month: '2026-06', cost: 7, forecast: 7, capturedAt: 'x' });
    expect(await getMonthlyCosts(t.db, 'acc-1')).toEqual([{ month: '2026-06', cost: 7, forecast: 7 }]);
  });

  it('scopes hasSnapshotForMonth and service trends by account', async () => {
    await upsertSnapshot(t.db, { accountId: 'acc-1', date: '2026-06-10', month: '2026-06', cost: 5, forecast: 9, capturedAt: 'x', payload: payload('Workers', 5) });

    expect(await hasSnapshotForMonth(t.db, 'acc-1', '2026-06')).toBe(true);
    expect(await hasSnapshotForMonth(t.db, 'acc-2', '2026-06')).toBe(false);

    expect(await getServiceTrends(t.db, 'acc-1')).toEqual([
      { product: 'Workers', points: [{ month: '2026-06', cost: 5 }] },
    ]);
    expect(await getServiceTrends(t.db, 'acc-2')).toEqual([]);
  });
});

describe('adoptLegacySnapshots', () => {
  it('reassigns legacy rows to the real account and clears the sentinel', async () => {
    await upsertSnapshot(t.db, { accountId: LEGACY_ACCOUNT_ID, date: '2026-05-31', month: '2026-05', cost: 4, forecast: 4, capturedAt: 'x' });

    await adoptLegacySnapshots(t.db, 'acc-1');

    expect(await getMonthlyCosts(t.db, 'acc-1')).toEqual([{ month: '2026-05', cost: 4, forecast: 4 }]);
    expect(await getMonthlyCosts(t.db, LEGACY_ACCOUNT_ID)).toEqual([]);
  });

  it('does not overwrite an existing real-account row on a colliding date', async () => {
    await upsertSnapshot(t.db, { accountId: 'acc-1', date: '2026-06-10', month: '2026-06', cost: 7, forecast: 7, capturedAt: 'real' });
    await upsertSnapshot(t.db, { accountId: LEGACY_ACCOUNT_ID, date: '2026-06-10', month: '2026-06', cost: 99, forecast: 99, capturedAt: 'legacy' });

    await adoptLegacySnapshots(t.db, 'acc-1');

    // The real row survives; the colliding legacy row is dropped, not merged.
    expect(await getMonthlyCosts(t.db, 'acc-1')).toEqual([{ month: '2026-06', cost: 7, forecast: 7 }]);
    expect(await getMonthlyCosts(t.db, LEGACY_ACCOUNT_ID)).toEqual([]);
  });

  it('is a no-op for the sentinel account id', async () => {
    await upsertSnapshot(t.db, { accountId: LEGACY_ACCOUNT_ID, date: '2026-05-31', month: '2026-05', cost: 4, forecast: 4, capturedAt: 'x' });
    await adoptLegacySnapshots(t.db, LEGACY_ACCOUNT_ID);
    expect(await getMonthlyCosts(t.db, LEGACY_ACCOUNT_ID)).toEqual([{ month: '2026-05', cost: 4, forecast: 4 }]);
  });
});

describe('getCostTrend (read-only)', () => {
  const account = { accountId: 'acc-1', apiToken: 'tok', name: 'Test' };
  const monthKey = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

  it('builds the trend from stored snapshots without any live Cloudflare call', async () => {
    const env = { DB: t.db } as Env;
    const thisMonth = monthKey(new Date());
    await upsertSnapshot(t.db, {
      accountId: 'acc-1', date: `${thisMonth}-15`, month: thisMonth, cost: 12, forecast: 20, capturedAt: 'x',
    });

    const trend = await getCostTrend(env, account);
    const current = trend.find((p) => p.month === thisMonth);
    expect(current).toEqual({ month: thisMonth, cost: 12, forecast: 20 });
    // fetch is globally mocked in setup and must never be invoked on the read path.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns an all-null series when no account is connected', async () => {
    const env = { DB: t.db } as Env;
    const trend = await getCostTrend(env, null);
    expect(trend.length).toBeGreaterThan(0);
    expect(trend.every((p) => p.cost === null && p.forecast === null)).toBe(true);
  });
});
