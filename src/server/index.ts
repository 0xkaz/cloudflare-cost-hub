import { Hono } from 'hono';
import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';
import type { Env } from './types';
import auth from './routes/auth';
import cfOauth from './routes/cf-oauth';
import dashboard from './routes/dashboard';
import settings from './routes/settings';
import budgetsRoute from './routes/budgets';
import reportsRoute from './routes/reports';
import { AlertDurableObject } from './durable-objects/alert';
import { accountFromEnv, captureRetainedMonths } from './snapshots';
import { accountInputForConnected, listConnectedAccounts } from './cf-oauth';
import { runDailyAlerts, runThresholdAlerts } from './alerts';

// The daily cron (snapshots + digest); any other cron only runs the hourly threshold check.
const DAILY_CRON = '0 1 * * *';

export { AlertDurableObject };

const app = new Hono<{ Bindings: Env }>();

app.route('/api/auth', auth);
app.route('/api/auth/cf', cfOauth);
app.route('/api/dashboard', dashboard);
app.route('/api/settings', settings);
app.route('/api/budgets', budgetsRoute);
app.route('/api/reports', reportsRoute);

app.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }));

// The React SPA is served by Workers Static Assets ([assets] in wrangler.toml): only /api/* and /health reach the
// Worker, every other path is a file of dist/client or, for client-side routes, its index.html.
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Capture a daily snapshot for every distinct connected Cloudflare account,
// plus the env-configured account as a fallback. Accounts are deduplicated so an
// account authorized by multiple users (or also set via env) is captured once.
async function snapshotAllAccounts(env: Env): Promise<void> {
  const seen = new Set<string>();
  const envAccount = accountFromEnv(env);
  if (envAccount) {
    seen.add(envAccount.accountId);
    await captureRetainedMonths(env, envAccount).catch((err) =>
      console.error(`Scheduled snapshot failed (env ${envAccount.accountId}):`, err)
    );
  }

  let connected: Awaited<ReturnType<typeof listConnectedAccounts>> = [];
  try {
    connected = await listConnectedAccounts(env);
  } catch (err) {
    console.error('Listing connected accounts failed:', err);
  }

  for (const acc of connected) {
    if (seen.has(acc.accountId)) continue;
    seen.add(acc.accountId);
    try {
      const input = await accountInputForConnected(env, acc);
      if (input) await captureRetainedMonths(env, input);
    } catch (err) {
      console.error(`Scheduled snapshot failed (${acc.accountId}):`, err);
    }
  }
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  // Daily (DAILY_CRON): snapshot cost history (survives Cloudflare's ~90 day
  // retention) and email a usage/cost digest. Every run (hourly cron too):
  // usage-threshold alerts against the paid-plan allowances.
  scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        if (event.cron === DAILY_CRON || !event.cron) {
          await snapshotAllAccounts(env);
          await runDailyAlerts(env).catch((err) => console.error('Scheduled alert failed:', err));
        }
        await runThresholdAlerts(env).catch((err) => console.error('Threshold alert failed:', err));
      })()
    );
  },
};
