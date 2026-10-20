// Account watch for the daily digest: Workers that keep failing, and the Workers / D1 databases that use the most
// (with sudden jumps against their previous-week average). Yesterday (UTC) is compared with the 7 days before it.
import type { CloudflareAccountInput } from './cloudflare-api';
import { resolveInstanceNames } from './cloudflare-rest';
import { fetchWithRetry } from './http';

const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

// A Worker counts as failing when at least this many invocations errored and they were at least this share of all
// its invocations; a cron schedule when at least FAIL_MIN_CRON_RUNS of its runs failed and they were at least
// FAIL_MIN_SHARE of its runs (an hourly cron that throws every run, even on a Worker that also serves pages fine).
export const FAIL_MIN_ERRORS = 6;
export const FAIL_MIN_CRON_RUNS = 3;
export const FAIL_MIN_SHARE = 0.5;
// A day is a jump when it is SPIKE_FACTOR x the previous-week daily average and above the metric's floor.
export const SPIKE_FACTOR = 3;
export const FLOORS = { cpuSeconds: 300, requests: 50_000, rowsWritten: 100_000, rowsRead: 50_000_000 } as const;
const TOP_N = 5;

export interface WorkerDay { script: string; date: string; requests: number; errors: number; cpuUs: number; statuses: Record<string, number> }
export interface D1Day { id: string; date: string; rowsWritten: number; rowsRead: number }

export interface CronRun { script: string; cron: string; status: string }
export interface FailingWorker { script: string; cron?: string; requests: number; errors: number; share: number; statuses: Record<string, number> }
export interface Consumer { name: string; value: number; prevAvg: number; spike: boolean }
export interface WatchReport {
  day: string;
  failing: FailingWorker[];
  workersCpu: Consumer[];     // CPU seconds
  workersRequests: Consumer[];
  d1Written: Consumer[];
  d1Read: Consumer[];
}

interface RawWorkerRow { sum: { requests?: number; errors?: number; cpuTimeUs?: number }; dimensions: { scriptName: string; date: string; status: string } }
interface RawD1Row { sum: { rowsWritten?: number; rowsRead?: number }; dimensions: { databaseId: string; date: string } }

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }

export function failingWorkers(rows: WorkerDay[], day: string): FailingWorker[] {
  const by = new Map<string, FailingWorker>();
  for (const r of rows) {
    if (r.date !== day) continue;
    const w = by.get(r.script) ?? { script: r.script, requests: 0, errors: 0, share: 0, statuses: {} };
    w.requests += r.requests; w.errors += r.errors;
    for (const [s, n] of Object.entries(r.statuses)) if (s !== 'success') w.statuses[s] = (w.statuses[s] ?? 0) + n;
    by.set(r.script, w);
  }
  return [...by.values()]
    .map((w) => ({ ...w, share: w.requests ? w.errors / w.requests : 0 }))
    .filter((w) => w.errors >= FAIL_MIN_ERRORS && w.share >= FAIL_MIN_SHARE)
    .sort((a, b) => b.errors - a.errors);
}

// Cron schedules that failed on most of their runs (rows are one day's scheduled invocations).
export function failingCrons(runs: CronRun[]): FailingWorker[] {
  const by = new Map<string, FailingWorker>();
  for (const r of runs) {
    const k = `${r.script}\u0000${r.cron}`;
    const w = by.get(k) ?? { script: r.script, cron: r.cron, requests: 0, errors: 0, share: 0, statuses: {} };
    w.requests++;
    if (r.status !== 'success') { w.errors++; w.statuses[r.status] = (w.statuses[r.status] ?? 0) + 1; }
    by.set(k, w);
  }
  return [...by.values()]
    .map((w) => ({ ...w, share: w.errors / w.requests }))
    .filter((w) => w.errors >= FAIL_MIN_CRON_RUNS && w.share >= FAIL_MIN_SHARE)
    .sort((a, b) => b.errors - a.errors);
}

// Failing cron schedules first; a Worker already listed for a cron is not repeated for its overall error rate.
export function mergeFailing(crons: FailingWorker[], workers: FailingWorker[]): FailingWorker[] {
  const seen = new Set(crons.map((c) => c.script));
  return [...crons, ...workers.filter((w) => !seen.has(w.script))];
}

// Top consumers of one metric on `day`, each with its previous-7-day daily average and a jump flag.
export function topConsumers(
  rows: Array<{ name: string; date: string; value: number }>, day: string, floor: number, n = TOP_N
): Consumer[] {
  const cur = new Map<string, number>(), prev = new Map<string, number>();
  for (const r of rows) {
    const m = r.date === day ? cur : r.date < day ? prev : null;
    if (m) m.set(r.name, (m.get(r.name) ?? 0) + r.value);
  }
  const prevDays = new Set(rows.filter((r) => r.date < day).map((r) => r.date)).size || 1;
  return [...cur.entries()]
    .map(([name, value]) => {
      const prevAvg = (prev.get(name) ?? 0) / prevDays;
      return { name, value, prevAvg, spike: value >= floor && value >= SPIKE_FACTOR * Math.max(prevAvg, 1) };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

async function gql<T>(account: CloudflareAccountInput, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetchWithRetry(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data as T;
}

export async function fetchWatchReport(account: CloudflareAccountInput, now = new Date()): Promise<WatchReport> {
  const day = ymd(new Date(now.getTime() - 86400_000));
  const start = ymd(new Date(now.getTime() - 8 * 86400_000));
  const data = await gql<{ viewer: { accounts: Array<{ w: RawWorkerRow[]; d: RawD1Row[]; s: Array<{ scriptName: string; cron: string; status: string }> }> } }>(account, `
    query ($accountTag: String!, $start: Date!, $end: Date!, $dayStart: Time!, $dayEnd: Time!) {
      viewer { accounts(filter: { accountTag: $accountTag }) {
        w: workersInvocationsAdaptive(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
          sum { requests errors cpuTimeUs } dimensions { scriptName date status }
        }
        d: d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
          sum { rowsWritten rowsRead } dimensions { databaseId date }
        }
        s: workersInvocationsScheduled(limit: 10000, filter: { datetime_geq: $dayStart, datetime_lt: $dayEnd }) {
          scriptName cron status
        }
      } }
    }`, { accountTag: account.accountId, start, end: day, dayStart: `${day}T00:00:00Z`, dayEnd: `${ymd(now)}T00:00:00Z` });
  const acct = data.viewer.accounts[0] ?? { w: [], d: [], s: [] };
  const workers: WorkerDay[] = (acct.w ?? []).map((r) => ({
    script: r.dimensions.scriptName, date: r.dimensions.date, requests: r.sum.requests ?? 0, errors: r.sum.errors ?? 0,
    cpuUs: r.sum.cpuTimeUs ?? 0, statuses: { [r.dimensions.status]: r.sum.requests ?? 0 },
  }));
  const names = await resolveInstanceNames(account, 'database');
  const d1: D1Day[] = (acct.d ?? []).map((r) => ({
    id: names[r.dimensions.databaseId] ?? r.dimensions.databaseId, date: r.dimensions.date,
    rowsWritten: r.sum.rowsWritten ?? 0, rowsRead: r.sum.rowsRead ?? 0,
  }));
  return {
    day,
    failing: mergeFailing(
      failingCrons((acct.s ?? []).map((r) => ({ script: r.scriptName, cron: r.cron, status: r.status }))),
      failingWorkers(workers, day)),
    workersCpu: topConsumers(workers.map((w) => ({ name: w.script, date: w.date, value: w.cpuUs / 1e6 })), day, FLOORS.cpuSeconds),
    workersRequests: topConsumers(workers.map((w) => ({ name: w.script, date: w.date, value: w.requests })), day, FLOORS.requests),
    d1Written: topConsumers(d1.map((x) => ({ name: x.id, date: x.date, value: x.rowsWritten })), day, FLOORS.rowsWritten),
    d1Read: topConsumers(d1.map((x) => ({ name: x.id, date: x.date, value: x.rowsRead })), day, FLOORS.rowsRead),
  };
}

export function hasWatchFindings(r: WatchReport | null): boolean {
  if (!r) return false;
  return r.failing.length > 0 || [r.workersCpu, r.workersRequests, r.d1Written, r.d1Read].some((l) => l.some((c) => c.spike));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmt = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : n.toFixed(n < 10 ? 1 : 0));
const TD = 'padding:4px 8px;border-bottom:1px solid #1e293b;font-size:13px;';

function consumerTable(title: string, unit: string, list: Consumer[]): string {
  if (!list.length) return '';
  const rows = list.map((c) => `<tr>
      <td style="${TD}">${c.spike ? '🔺 ' : ''}${esc(c.name)}</td>
      <td style="${TD}text-align:right;">${fmt(c.value)}${unit}</td>
      <td style="${TD}text-align:right;color:#94a3b8;">${fmt(c.prevAvg)}${unit}</td></tr>`).join('');
  return `<h4 style="margin:12px 0 4px;font-size:13px;color:#cbd5e1;">${title}</h4>
    <table style="border-collapse:collapse;width:100%;"><tr>
      <th style="${TD}text-align:left;color:#94a3b8;">name</th><th style="${TD}text-align:right;color:#94a3b8;">yesterday</th>
      <th style="${TD}text-align:right;color:#94a3b8;">prev. 7-day avg</th></tr>${rows}</table>`;
}

export function watchSection(r: WatchReport | null): string {
  if (!r) return '';
  const failing = r.failing.length
    ? `<div style="margin:0 0 12px;padding:10px 14px;border-radius:8px;background:#ef44441a;border:1px solid #ef444440;">
        <div style="color:#f87171;font-weight:600;margin-bottom:4px;">Workers failing on ${r.day}</div>
        ${r.failing.map((w) => `<div style="font-size:13px;color:#e2e8f0;">${esc(w.script)}${w.cron ? ` (cron ${esc(w.cron)})` : ''} — ${w.errors} / ${w.requests} ${w.cron ? 'runs' : 'invocations'} failed (${Math.round(w.share * 100)}%)${Object.keys(w.statuses).length ? ` · ${esc(Object.entries(w.statuses).map(([s, n]) => `${s} ${n}`).join(', '))}` : ''}</div>`).join('')}
      </div>`
    : '';
  return `<h3 style="margin:24px 0 8px;font-size:15px;">Account watch (${r.day} UTC)</h3>
    ${failing}
    ${consumerTable('Workers by CPU', ' s', r.workersCpu)}
    ${consumerTable('Workers by requests', '', r.workersRequests)}
    ${consumerTable('D1 rows written', '', r.d1Written)}
    ${consumerTable('D1 rows read', '', r.d1Read)}
    <p style="margin:6px 0 0;font-size:12px;color:#64748b;">🔺 = ${SPIKE_FACTOR}x or more of the previous-week average.</p>`;
}
