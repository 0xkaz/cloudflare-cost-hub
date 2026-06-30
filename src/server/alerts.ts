import type { Env } from './types';
import type { CloudflareAccountInput } from './cloudflare-api';
import type { CostDriver, ServiceMetricSummary, ServicesAnalysis, Tier } from '../shared/types';
import { getServicesAnalysis } from './services';
import { resolveCloudflareAccount } from './cf-oauth';
import { getSetting } from './db/app-settings';
import { findUserById } from './db/user';
import {
  listEnabledAlertSettings,
  setAlertLastSent,
  type UserAlertSetting,
} from './db/user-alert-settings';
import { getBudget } from './db/budgets';
import { getAccountEntitlement } from './db/account-entitlements';
import { evaluateBudget, type BudgetStatus } from './budgets';

export const ALERT_EMAIL_KEY = 'alert_email';

// Warn when a metric reaches this share of its free-tier allowance.
const WARN_THRESHOLD = 80;

// Billing entitlement for automated alerts, evaluated against the monitored
// Cloudflare account's plan (not the individual user) — teammates sharing an
// account share its paid status. Enforced only when env ALERTS_REQUIRE_PAYMENT=
// "true"; otherwise everyone is entitled, so a future operator could gate
// automated alerts behind a paid plan with a pure config flip. The reference
// deployment leaves it unset (all features free).
export function isEntitled(
  env: Env,
  entitlement: { plan: 'free' | 'paid'; paidUntil: string | null }
): boolean {
  if (env.ALERTS_REQUIRE_PAYMENT !== 'true') return true;
  if (entitlement.plan === 'paid') return true;
  if (entitlement.paidUntil && new Date(entitlement.paidUntil).getTime() > Date.now()) return true;
  return false;
}

const TIER_COLOR: Record<Tier, string> = {
  free: '#34d399',
  paid: '#fbbf24',
  billable: '#f87171',
};
const TIER_RANK: Record<Tier, number> = { free: 0, paid: 1, billable: 2 };

function parseRecipients(raw: string | null | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

// Env-fallback recipients (used only when no user has configured per-user
// alerts): the legacy global app setting, then the env default.
async function envRecipients(env: Env): Promise<string[]> {
  const configured = await getSetting(env.DB, ALERT_EMAIL_KEY);
  return parseRecipients(configured || env.ALERT_EMAIL_TO);
}

function allMetrics(analysis: ServicesAnalysis): ServiceMetricSummary[] {
  return analysis.services
    .flatMap((s) => s.metrics)
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.percentage - a.percentage);
}

function noteworthy(metrics: ServiceMetricSummary[]): ServiceMetricSummary[] {
  return metrics.filter((m) => (m.estimatedCost ?? 0) > 0 || m.percentage >= WARN_THRESHOLD);
}

function compact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const TD = 'padding:6px 10px;border-top:1px solid #1e293b;';
const TH = 'padding:6px 10px;color:#94a3b8;font-size:12px;text-align:left;';

function metricsTable(metrics: ServiceMetricSummary[]): string {
  const rows = metrics
    .map(
      (m) => `<tr>
        <td style="${TD}">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${TIER_COLOR[m.tier]};margin-right:6px;"></span>
          ${m.product} · ${m.metric}
        </td>
        <td style="${TD}text-align:right;color:#cbd5e1;">${m.used.toLocaleString()} / ${m.limit.toLocaleString()} ${m.unit}</td>
        <td style="${TD}text-align:right;color:${TIER_COLOR[m.tier]};">${m.percentage.toFixed(0)}%${(m.estimatedCost ?? 0) > 0 ? ` · $${m.estimatedCost!.toFixed(2)}` : ''}</td>
      </tr>`
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead><tr><th style="${TH}">Metric</th><th style="${TH}text-align:right;">Usage</th><th style="${TH}text-align:right;">Status</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function driversTable(drivers: CostDriver[]): string {
  if (drivers.length === 0) return '';
  const rows = drivers
    .slice(0, 10)
    .map(
      (d) => `<tr>
        <td style="${TD}font-family:ui-monospace,monospace;font-size:12px;">${d.label.length > 34 ? `${d.label.slice(0, 34)}…` : d.label} <span style="color:#64748b;">${d.instanceLabel}</span></td>
        <td style="${TD}color:#94a3b8;font-size:12px;">${d.product} · ${d.metric}</td>
        <td style="${TD}text-align:right;color:#cbd5e1;">${compact(d.value)}</td>
        <td style="${TD}text-align:right;color:${d.estimatedCost > 0 ? '#f87171' : '#34d399'};">${d.paidShare !== undefined ? `${(d.paidShare * 100).toFixed(1)}%` : '—'}${d.estimatedCost > 0 ? ` · $${d.estimatedCost.toFixed(2)}` : ''}</td>
      </tr>`
    )
    .join('');
  return `<h3 style="margin:24px 0 8px;font-size:15px;">Top usage drivers</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr><th style="${TH}">Instance</th><th style="${TH}">Service</th><th style="${TH}text-align:right;">Usage</th><th style="${TH}text-align:right;">Paid share</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
}

function budgetBanner(budget: BudgetStatus | null): string {
  if (!budget) return '';
  const color = budget.exceeded ? '#f87171' : budget.nearing ? '#fbbf24' : '#34d399';
  const label = budget.exceeded
    ? 'Forecast is over budget'
    : budget.nearing
      ? 'Forecast is nearing budget'
      : 'Forecast is within budget';
  return `<div style="margin:0 0 16px;padding:10px 14px;border-radius:8px;background:${color}1a;border:1px solid ${color}40;">
    <span style="color:${color};font-weight:600;">${label}</span>
    <span style="color:#cbd5e1;"> — forecast $${budget.forecast.toFixed(2)} of $${budget.limit.toFixed(2)} budget (${budget.percentage}%)</span>
  </div>`;
}

function buildEmail(
  analysis: ServicesAnalysis,
  budget: BudgetStatus | null,
  appUrl: string
): { subject: string; html: string } {
  const metrics = allMetrics(analysis);
  const flagged = noteworthy(metrics);
  const billableCount = metrics.filter((m) => m.tier === 'billable').length;

  const subject = budget?.exceeded
    ? `🚨 Over budget: $${analysis.forecastedCost.toFixed(2)} forecast vs $${budget.limit.toFixed(2)}`
    : billableCount
      ? `⚠️ Cloudflare cost alert: $${analysis.currentMonthCost.toFixed(2)} this month`
      : `Cloudflare usage report — ${flagged.length} metric${flagged.length === 1 ? '' : 's'} to watch`;

  const html = `<div style="font-family:ui-sans-serif,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;border-radius:12px;max-width:680px;">
    <h2 style="margin:0 0 4px;">Cloudflare Cost Hub</h2>
    <p style="margin:0 0 16px;color:#94a3b8;font-size:14px;">${analysis.accountName} — daily usage report (${analysis.month})</p>
    ${budgetBanner(budget)}
    <div style="display:flex;gap:24px;margin-bottom:8px;">
      <div><div style="font-size:12px;color:#94a3b8;">Est. month cost</div><div style="font-size:22px;font-weight:700;">$${analysis.currentMonthCost.toFixed(2)}</div></div>
      <div><div style="font-size:12px;color:#94a3b8;">Forecast (month-end)</div><div style="font-size:22px;font-weight:700;color:#818cf8;">$${analysis.forecastedCost.toFixed(2)}</div></div>
    </div>
    <h3 style="margin:24px 0 8px;font-size:15px;">Usage status (all services)</h3>
    ${metricsTable(metrics)}
    ${driversTable(analysis.topDrivers)}
    <p style="margin:24px 0 0;font-size:12px;color:#64748b;">
      <a href="${appUrl}/" style="color:#818cf8;">Open dashboard</a> ·
      🔴 billable · 🟡 over free tier (within paid) · 🟢 within free tier
    </p>
  </div>`;

  return { subject, html };
}

async function sendEmail(
  env: Env,
  subject: string,
  html: string,
  to: string[]
): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.ALERT_EMAIL_FROM || 'Cloudflare Cost Hub <noreply@0xkaz.com>',
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    console.error('Resend send failed:', res.status, await res.text());
    return false;
  }
  return true;
}

async function getLastSentDate(env: Env): Promise<string | null> {
  try {
    const row = await env.DB.prepare(
      "SELECT last_sent_date FROM alert_state WHERE id = 'daily'"
    ).first();
    return row ? String(row.last_sent_date) : null;
  } catch {
    return null;
  }
}

async function setLastSentDate(env: Env, date: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO alert_state (id, last_sent_date) VALUES ('daily', ?)
     ON CONFLICT(id) DO UPDATE SET last_sent_date = excluded.last_sent_date`
  )
    .bind(date)
    .run();
}

export interface AlertResult {
  sent: boolean;
  reason?: string;
  count?: number;
}

// Build a usage/cost digest for one account and email it to `to`. Skips empty
// reports unless `force` is set (the manual test endpoint).
async function buildAndSend(
  env: Env,
  account: CloudflareAccountInput,
  to: string[],
  force: boolean,
  budgetLimit: number | null
): Promise<AlertResult> {
  const analysis = await getServicesAnalysis(env, account);
  const flagged = noteworthy(allMetrics(analysis));
  const budget = budgetLimit != null ? evaluateBudget(budgetLimit, analysis.forecastedCost) : null;
  // A budget overage is always worth sending, even with nothing else to report.
  if (!force && !budget?.exceeded && flagged.length === 0 && analysis.currentMonthCost === 0) {
    return { sent: false, reason: 'Nothing to report' };
  }
  const appUrl = (env.APP_URL || 'https://cloudflare-cost-hub.0xkaz.com').replace(/\/+$/, '');
  const { subject, html } = buildEmail(analysis, budget, appUrl);
  const ok = await sendEmail(env, subject, html, to);
  return { sent: ok, count: flagged.length };
}

// Resolve a user's recipients: their configured address(es), else their login
// email. Returns [] if neither is available.
async function recipientsForUser(env: Env, setting: UserAlertSetting): Promise<string[]> {
  const explicit = parseRecipients(setting.email);
  if (explicit.length > 0) return explicit;
  const user = await findUserById(env.DB, setting.userId);
  return user?.email ? [user.email] : [];
}

// Send a single user's daily digest for their connected account. Honors the
// per-user enable toggle, billing entitlement, and once-per-day idempotency.
export async function runDailyAlertForUser(
  env: Env,
  setting: UserAlertSetting,
  force = false
): Promise<AlertResult> {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'Alerts not configured' };
  if (!setting.enabled) return { sent: false, reason: 'Alerts disabled' };

  const today = new Date().toISOString().slice(0, 10);
  if (!force && setting.lastSentDate === today) {
    return { sent: false, reason: 'Already sent today' };
  }

  const account = await resolveCloudflareAccount(env, setting.userId);
  if (!account) return { sent: false, reason: 'No account connected' };

  // Entitlement is per Cloudflare account, so check it once the account is known.
  const entitlement = await getAccountEntitlement(env.DB, account.accountId);
  if (!isEntitled(env, entitlement)) return { sent: false, reason: 'Paid plan required' };

  const to = await recipientsForUser(env, setting);
  if (to.length === 0) return { sent: false, reason: 'No recipient' };

  const budget = await getBudget(env.DB, setting.userId, account.accountId);
  const result = await buildAndSend(env, account, to, force, budget?.monthlyLimit ?? null);
  if (result.sent) await setAlertLastSent(env.DB, setting.userId, today);
  return result;
}

// Legacy single-tenant digest for the env-configured account. Used only as a
// fallback when no user has configured per-user alerts, so the original
// deployment keeps emailing before anyone self-serves.
async function runDailyAlertsEnvFallback(env: Env, force: boolean): Promise<AlertResult> {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) {
    return { sent: false, reason: 'No account configured' };
  }
  const today = new Date().toISOString().slice(0, 10);
  if (!force && (await getLastSentDate(env)) === today) {
    return { sent: false, reason: 'Already sent today' };
  }
  const acct = await resolveCloudflareAccount(env, undefined);
  if (!acct) return { sent: false, reason: 'No account configured' };
  const to = await envRecipients(env);
  if (to.length === 0) return { sent: false, reason: 'No recipient' };

  const result = await buildAndSend(env, acct, to, force, null);
  if (result.sent) await setLastSentDate(env, today);
  return result;
}

// Scheduled entry point: email every enabled (and entitled) user their digest.
// Falls back to the legacy env-account digest when no user has configured alerts.
export async function runDailyAlerts(env: Env, force = false): Promise<AlertResult> {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'Alerts not configured' };

  const settings = await listEnabledAlertSettings(env.DB);
  if (settings.length === 0) {
    return runDailyAlertsEnvFallback(env, force);
  }

  let sent = 0;
  for (const setting of settings) {
    try {
      const r = await runDailyAlertForUser(env, setting, force);
      if (r.sent) sent++;
    } catch (err) {
      console.error('User alert failed:', setting.userId, err);
    }
  }
  return { sent: sent > 0, count: sent };
}
