import { Hono } from 'hono';
import type { Env } from '../types';
import { getSession } from '../auth';
import { resolveCloudflareAccount } from '../cf-oauth';
import { fetchAccountUsage } from '../cloudflare-api';
import { getFreeTierLimits } from '../db/free-tier';
import { getMonthlyCosts } from '../db/snapshots';
import { toCsv } from '../reports';

const reports = new Hono<{ Bindings: Env }>();

reports.use(async (c, next) => {
  const session = await getSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  c.set('session' as never, session);
  await next();
});

const csvHeaders = (filename: string) => ({
  'Content-Type': 'text/csv; charset=utf-8',
  'Content-Disposition': `attachment; filename="${filename}"`,
});

// Monthly cost history for the active account (from stored snapshots).
reports.get('/cost-history.csv', async (c) => {
  const session = c.get('session' as never) as { userId: string };
  const account = await resolveCloudflareAccount(c.env, session.userId);
  if (!account) return c.json({ error: 'Cloudflare account not configured' }, 400);

  const months = await getMonthlyCosts(c.env.DB, account.accountId);
  const body = toCsv(
    ['month', 'estimated_cost_usd', 'forecast_usd'],
    months.map((m) => [m.month, m.cost.toFixed(2), m.forecast.toFixed(2)])
  );
  return c.body(body, 200, csvHeaders(`cost-history-${account.accountId}.csv`));
});

// Current free-tier / usage status for the active account.
reports.get('/usage.csv', async (c) => {
  const session = c.get('session' as never) as { userId: string };
  const account = await resolveCloudflareAccount(c.env, session.userId);
  if (!account) return c.json({ error: 'Cloudflare account not configured' }, 400);

  const limits = await getFreeTierLimits(c.env.DB);
  const usage = await fetchAccountUsage(account, limits, {});
  const body = toCsv(
    ['product', 'metric', 'used', 'limit', 'unit', 'percentage', 'estimated_cost_usd'],
    usage.freeTierStatus.map((s) => [
      s.product,
      s.metric,
      s.used,
      s.limit,
      s.unit,
      s.percentage.toFixed(1),
      (s.estimatedCost ?? 0).toFixed(2),
    ])
  );
  const month = new Date().toISOString().slice(0, 7);
  return c.body(body, 200, csvHeaders(`usage-${month}.csv`));
});

export default reports;
