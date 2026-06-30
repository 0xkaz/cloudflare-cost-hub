import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchAccountUsage,
  generateDemoUsage,
} from '../../src/server/cloudflare-api';
import { DEFAULT_FREE_TIER_LIMITS } from '../../src/server/db/free-tier';

describe('cloudflare-api', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('generateDemoUsage returns valid demo data', () => {
    const data = generateDemoUsage(DEFAULT_FREE_TIER_LIMITS);
    expect(data.accountId).toBe('demo-account');
    expect(data.dailyUsage.length).toBe(30);
    expect(data.freeTierStatus.length).toBeGreaterThan(0);
    expect(data.currentMonthCost).toBeGreaterThanOrEqual(0);
  });

  it('fetchAccountUsage returns structured data from GraphQL response', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const makeResponse = (requests: number) =>
      ({
        ok: true,
        json: async () => ({
          data: {
            viewer: {
              accounts: [
                {
                  workersInvocationsAdaptive: [
                    {
                      dimensions: { date: today },
                      sum: { requests },
                    },
                  ],
                },
              ],
            },
          },
        }),
      }) as Response;

    // fetchAccountUsage queries the current and previous months separately.
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(50000))
      .mockResolvedValueOnce(makeResponse(40000));

    const result = await fetchAccountUsage(
      {
        accountId: 'acc-id',
        apiToken: 'token',
        name: 'Test Account',
      },
      DEFAULT_FREE_TIER_LIMITS
    );

    expect(result.accountId).toBe('acc-id');
    expect(result.accountName).toBe('Test Account');
    expect(result.currency).toBe('USD');
    expect(result.dailyUsage.length).toBeGreaterThan(0);
    expect(result.freeTierStatus.some((s) => s.product === 'Workers')).toBe(true);
  });

  it('fetchAccountUsage throws on API error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      text: async () => 'Unauthorized',
    } as Response);

    await expect(
      fetchAccountUsage(
        { accountId: 'acc-id', apiToken: 'bad', name: 'Test' },
        DEFAULT_FREE_TIER_LIMITS
      )
    ).rejects.toThrow('Cloudflare API error');
  });
});
