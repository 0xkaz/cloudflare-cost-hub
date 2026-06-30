import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAccountPlan } from '../../src/server/cloudflare-rest';

const ACCOUNT = { accountId: 'acc', apiToken: 'tok', name: 'Test' };

describe('getAccountPlan', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('marks the plan not accessible when the token cannot read billing (403)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'Forbidden' } as Response);
    const plan = await getAccountPlan(ACCOUNT);
    expect(plan).toEqual({ workersPaid: false, r2Paid: false, plans: [], accessible: false });
  });

  it('detects paid subscriptions from rate plans', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        result: [
          { rate_plan: { id: 'workers_paid', public_name: 'Workers Paid' } },
          { rate_plan: { id: 'r2_paid', public_name: 'R2' } },
          { rate_plan: { id: 'free', public_name: 'Free' } },
        ],
      }),
    } as Response);

    const plan = await getAccountPlan(ACCOUNT);
    expect(plan.accessible).toBe(true);
    expect(plan.workersPaid).toBe(true);
    expect(plan.r2Paid).toBe(true);
    // 'free' is excluded from the named paid plans.
    expect(plan.plans).toEqual(['Workers Paid', 'R2']);
  });

  it('reports accessible with no paid plans on an empty subscription list', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, result: [] }),
    } as Response);

    const plan = await getAccountPlan(ACCOUNT);
    expect(plan).toEqual({ workersPaid: false, r2Paid: false, plans: [], accessible: true });
  });
});
