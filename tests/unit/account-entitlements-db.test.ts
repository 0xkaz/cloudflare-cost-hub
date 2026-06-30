import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestD1, type TestD1 } from '../helpers/d1';
import {
  getAccountEntitlement,
  setAccountEntitlement,
} from '../../src/server/db/account-entitlements';
import { isEntitled } from '../../src/server/alerts';
import type { Env } from '../../src/server/types';

let t: TestD1;
beforeEach(() => {
  t = createTestD1();
});
afterEach(() => t.close());

describe('account_entitlements', () => {
  it('defaults to free when nothing is stored', async () => {
    expect(await getAccountEntitlement(t.db, 'acc-1')).toEqual({
      plan: 'free',
      paidUntil: null,
      purchasedByUserId: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
  });

  it('stores a paid plan and records the purchaser + stripe ids', async () => {
    await setAccountEntitlement(t.db, 'acc-1', {
      plan: 'paid',
      paidUntil: '2027-01-01T00:00:00Z',
      purchasedByUserId: 'user-a',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
    });
    expect(await getAccountEntitlement(t.db, 'acc-1')).toMatchObject({
      plan: 'paid',
      paidUntil: '2027-01-01T00:00:00Z',
      purchasedByUserId: 'user-a',
      stripeCustomerId: 'cus_1',
    });
  });

  it('preserves the purchaser/stripe ids when only the plan is updated on renewal', async () => {
    await setAccountEntitlement(t.db, 'acc-1', {
      plan: 'paid',
      paidUntil: '2027-01-01T00:00:00Z',
      purchasedByUserId: 'user-a',
      stripeCustomerId: 'cus_1',
    });
    // Renewal updates the date but doesn't re-send the purchaser id.
    await setAccountEntitlement(t.db, 'acc-1', { plan: 'paid', paidUntil: '2028-01-01T00:00:00Z' });
    expect(await getAccountEntitlement(t.db, 'acc-1')).toMatchObject({
      paidUntil: '2028-01-01T00:00:00Z',
      purchasedByUserId: 'user-a',
      stripeCustomerId: 'cus_1',
    });
  });

  it('a paid account entitles everyone watching it (when payment is enforced)', async () => {
    const env = { ALERTS_REQUIRE_PAYMENT: 'true' } as Env;
    await setAccountEntitlement(t.db, 'acc-1', { plan: 'paid', paidUntil: null });
    const ent = await getAccountEntitlement(t.db, 'acc-1');
    expect(isEntitled(env, ent)).toBe(true);
    // A different, unpaid account is not entitled.
    expect(isEntitled(env, await getAccountEntitlement(t.db, 'acc-2'))).toBe(false);
  });
});
