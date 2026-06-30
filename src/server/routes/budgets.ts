import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { getSession } from '../auth';
import { resolveCloudflareAccount } from '../cf-oauth';
import { fetchAccountUsage } from '../cloudflare-api';
import { getFreeTierLimits } from '../db/free-tier';
import { getBudget, setBudget, deleteBudget } from '../db/budgets';
import { evaluateBudget } from '../budgets';
import { cacheKey, cachedCompute } from '../cache';

const budgets = new Hono<{ Bindings: Env }>();

budgets.use(async (c, next) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  c.set('session' as never, session);
  await next();
});

// Current budget for the active account plus this month's forecast and status.
budgets.get('/', async (c) => {
  const session = c.get('session' as never) as { userId: string };
  const account = await resolveCloudflareAccount(c.env, session.userId);
  if (!account) return c.json({ error: 'Cloudflare account not configured' }, 400);

  const budget = await getBudget(c.env.DB, session.userId, account.accountId);

  // Reuse a cached month forecast so this page is cheap to load.
  let forecast = 0;
  try {
    const usage = await cachedCompute(
      c.env,
      c.executionCtx,
      cacheKey('forecast', account.accountId, 'current'),
      300,
      async () => {
        const limits = await getFreeTierLimits(c.env.DB);
        const u = await fetchAccountUsage(account, limits, {});
        return { forecast: u.forecastedCost, currentMonthCost: u.currentMonthCost };
      }
    );
    forecast = usage.forecast;
  } catch {
    forecast = 0;
  }

  return c.json({
    accountId: account.accountId,
    accountName: account.name,
    monthlyLimit: budget?.monthlyLimit ?? null,
    forecast,
    status: budget ? evaluateBudget(budget.monthlyLimit, forecast) : null,
  });
});

budgets.post(
  '/',
  zValidator('json', z.object({ monthlyLimit: z.number().positive() })),
  async (c) => {
    const session = c.get('session' as never) as { userId: string };
    const account = await resolveCloudflareAccount(c.env, session.userId);
    if (!account) return c.json({ error: 'Cloudflare account not configured' }, 400);
    const { monthlyLimit } = c.req.valid('json');
    await setBudget(c.env.DB, session.userId, account.accountId, monthlyLimit);
    return c.json({ ok: true, monthlyLimit });
  }
);

budgets.delete('/', async (c) => {
  const session = c.get('session' as never) as { userId: string };
  const account = await resolveCloudflareAccount(c.env, session.userId);
  if (!account) return c.json({ error: 'Cloudflare account not configured' }, 400);
  await deleteBudget(c.env.DB, session.userId, account.accountId);
  return c.json({ ok: true });
});

export default budgets;
