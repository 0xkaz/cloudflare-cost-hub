import type { D1Database } from '@cloudflare/workers-types';

export interface AccountEntitlement {
  plan: 'free' | 'paid';
  paidUntil: string | null;
  purchasedByUserId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

const FREE: AccountEntitlement = {
  plan: 'free',
  paidUntil: null,
  purchasedByUserId: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
};

// The entitlement for an account, defaulting to free when none is stored.
export async function getAccountEntitlement(
  db: D1Database,
  accountId: string
): Promise<AccountEntitlement> {
  const r = await db
    .prepare(
      `SELECT plan, paid_until, purchased_by_user_id, stripe_customer_id, stripe_subscription_id
       FROM account_entitlements WHERE account_id = ?`
    )
    .bind(accountId)
    .first();
  if (!r) return { ...FREE };
  return {
    plan: String(r.plan) === 'paid' ? 'paid' : 'free',
    paidUntil: r.paid_until ? String(r.paid_until) : null,
    purchasedByUserId: r.purchased_by_user_id ? String(r.purchased_by_user_id) : null,
    stripeCustomerId: r.stripe_customer_id ? String(r.stripe_customer_id) : null,
    stripeSubscriptionId: r.stripe_subscription_id ? String(r.stripe_subscription_id) : null,
  };
}

// Set an account's plan/entitlement. Reserved for a future paid tier (e.g. a
// billing webhook); the reference deployment does not gate any feature.
export async function setAccountEntitlement(
  db: D1Database,
  accountId: string,
  fields: {
    plan: 'free' | 'paid';
    paidUntil: string | null;
    purchasedByUserId?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO account_entitlements
         (account_id, plan, paid_until, purchased_by_user_id, stripe_customer_id, stripe_subscription_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         plan = excluded.plan,
         paid_until = excluded.paid_until,
         purchased_by_user_id = COALESCE(excluded.purchased_by_user_id, account_entitlements.purchased_by_user_id),
         stripe_customer_id = COALESCE(excluded.stripe_customer_id, account_entitlements.stripe_customer_id),
         stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, account_entitlements.stripe_subscription_id),
         updated_at = excluded.updated_at`
    )
    .bind(
      accountId,
      fields.plan,
      fields.paidUntil,
      fields.purchasedByUserId ?? null,
      fields.stripeCustomerId ?? null,
      fields.stripeSubscriptionId ?? null,
      new Date().toISOString()
    )
    .run();
}
