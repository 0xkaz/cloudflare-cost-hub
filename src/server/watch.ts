// Account watch for the daily digest: Workers that keep failing, and the Workers / D1 databases / KV namespaces /
// Workers AI models / R2 buckets that use the most
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
export const FLOORS = {
  cpuSeconds: 300, requests: 50_000, rowsWritten: 100_000, rowsRead: 50_000_000,
  kvReads: 500_000, aiNeurons: 50_000, r2GB: 5,
} as const;
const TOP_N = 5;
// A stop: a D1 database written less than STOP_SHARE of what it was written on the same weekday a week earlier (when
// that was at least STOP_MIN_ROWS), or a Worker with no request at all after averaging STOP_MIN_REQUESTS a day. This
// catches a cron that stopped, or that catches its own errors and does nothing, without the cron-run dataset.
// Comparing with the same weekday keeps weekend and Sun-Thu calendars quiet. Only the first day is shown (a database
// that already qualified the day before is a stop already reported, or a new normal after an intended cut); a
// market holiday still shows once.
export const STOP_SHARE = 0.2;
export const STOP_MIN_ROWS = 5_000;
export const STOP_MIN_REQUESTS = 200;

export interface WorkerDay { script: string; date: string; requests: number; errors: number; cpuUs: number; statuses: Record<string, number> }
export interface D1Day { id: string; date: string; rowsWritten: number; rowsRead: number }

export interface CronRun { script: string; cron: string; status: string }
export interface FailingWorker { script: string; cron?: string; requests: number; errors: number; share: number; statuses: Record<string, number> }
export interface Stopped { name: string; kind: 'd1' | 'worker'; value: number; before: number }
export interface Consumer { name: string; value: number; prevAvg: number; spike: boolean }
export interface WatchReport {
  day: string;
  failing: FailingWorker[];
  stopped: Stopped[];          // D1 databases that stopped being written, Workers that stopped being called
  cronRuns: number;           // scheduled runs Cloudflare reported for the day (0: cron failures cannot be seen)
  workersCpu: Consumer[];     // CPU seconds
  workersRequests: Consumer[];
  d1Written: Consumer[];
  d1Read: Consumer[];
  kvReads: Consumer[];      // KV read operations per namespace
  aiNeurons: Consumer[];    // Workers AI neurons per model
  r2Storage: Consumer[];    // R2 stored GB per bucket (daily peak)
}

interface RawWorkerRow { sum: { requests?: number; errors?: number; cpuTimeUs?: number }; dimensions: { scriptName: string; date: string; status: string } }
interface RawD1Row { sum: { rowsWritten?: number; rowsRead?: number }; dimensions: { databaseId: string; date: string } }
interface RawExtra {
  k: Array<{ sum: { requests?: number }; dimensions: { namespaceId: string; date: string } }>;
  a: Array<{ sum: { totalNeurons?: number }; dimensions: { modelId: string; date: string } }>;
  r: Array<{ max: { payloadSize?: number }; dimensions: { bucketName: string; date: string } }>;
}

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

function shiftDay(day: string, days: number): string { return ymd(new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400_000)); }
const inPrevWeek = (date: string, day: string) => date < day && date >= shiftDay(day, -7);

// D1 databases written far less on `day` than on the same weekday a week before, and not already the day before.
export function stoppedDatabases(rows: D1Day[], day: string): Stopped[] {
  const written = new Map<string, number>();
  for (const r of rows) written.set(`${r.id}\u0000${r.date}`, (written.get(`${r.id}\u0000${r.date}`) ?? 0) + r.rowsWritten);
  const get = (id: string, d: string) => written.get(`${id}\u0000${d}`) ?? 0;
  const stopsOn = (id: string, d: string) => {
    const before = get(id, shiftDay(d, -7));
    return before >= STOP_MIN_ROWS && get(id, d) < STOP_SHARE * before;
  };
  return [...new Set(rows.map((r) => r.id))]
    .filter((id) => stopsOn(id, day) && !stopsOn(id, shiftDay(day, -1)))
    .map((name) => ({ name, kind: 'd1' as const, value: get(name, day), before: get(name, shiftDay(day, -7)) }))
    .sort((a, b) => b.before - a.before);
}

// Workers that served nothing on `day` after a busy previous week (`before` = its daily average).
export function silentWorkers(rows: WorkerDay[], day: string): Stopped[] {
  const cur = new Map<string, number>(), prev = new Map<string, number>();
  for (const r of rows) {
    const m = r.date === day ? cur : inPrevWeek(r.date, day) ? prev : null;
    if (m) m.set(r.script, (m.get(r.script) ?? 0) + r.requests);
  }
  const prevDays = new Set(rows.filter((r) => inPrevWeek(r.date, day)).map((r) => r.date)).size || 1;
  return [...prev.entries()]
    .map(([name, n]) => ({ name, kind: 'worker' as const, value: cur.get(name) ?? 0, before: n / prevDays }))
    .filter((x) => x.value === 0 && x.before >= STOP_MIN_REQUESTS && !x.name.startsWith('__'))
    .sort((a, b) => b.before - a.before);
}

// Top consumers of one metric on `day`, each with its previous-7-day daily average and a jump flag.
export function topConsumers(
  rows: Array<{ name: string; date: string; value: number }>, day: string, floor: number, n = TOP_N
): Consumer[] {
  const cur = new Map<string, number>(), prev = new Map<string, number>();
  for (const r of rows) {
    const m = r.date === day ? cur : inPrevWeek(r.date, day) ? prev : null;
    if (m) m.set(r.name, (m.get(r.name) ?? 0) + r.value);
  }
  const prevDays = new Set(rows.filter((r) => inPrevWeek(r.date, day)).map((r) => r.date)).size || 1;
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

// Past days on the Alerts page: Cloudflare keeps KV / Workers AI / R2 analytics for about 32 days and the report reads
// the 8 days before the day, so 21 days back keeps every section.
export const WATCH_MAX_DAYS_BACK = 21;

// The `now` that makes fetchWatchReport report `day` (YYYY-MM-DD), or null when `day` is not one of the last
// WATCH_MAX_DAYS_BACK + 1 complete UTC days. No `day`: the latest complete day.
export function watchNowFor(day: string | undefined, now = new Date()): Date | null {
  if (!day) return now;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return null;
  const latest = ymd(new Date(now.getTime() - 86400_000));
  if (day > latest || day < shiftDay(latest, -WATCH_MAX_DAYS_BACK)) return null;
  return new Date(`${shiftDay(day, 1)}T12:00:00Z`);
}

export async function fetchWatchReport(account: CloudflareAccountInput, now = new Date()): Promise<WatchReport> {
  const day = ymd(new Date(now.getTime() - 86400_000));
  const start = ymd(new Date(now.getTime() - 9 * 86400_000)); // day - 8: the stop check compares day - 1 with day - 8
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
  const extra = await fetchExtra(account, start, day).catch((err) => { console.error('Watch extra datasets failed:', err); return null; });
  const d1: D1Day[] = (acct.d ?? []).map((r) => ({
    id: names[r.dimensions.databaseId] ?? r.dimensions.databaseId, date: r.dimensions.date,
    rowsWritten: r.sum.rowsWritten ?? 0, rowsRead: r.sum.rowsRead ?? 0,
  }));
  return {
    day,
    failing: mergeFailing(
      failingCrons((acct.s ?? []).map((r) => ({ script: r.scriptName, cron: r.cron, status: r.status }))),
      failingWorkers(workers, day)),
    stopped: [...stoppedDatabases(d1, day), ...silentWorkers(workers, day)],
    cronRuns: (acct.s ?? []).length,
    workersCpu: topConsumers(workers.map((w) => ({ name: w.script, date: w.date, value: w.cpuUs / 1e6 })), day, FLOORS.cpuSeconds),
    workersRequests: topConsumers(workers.map((w) => ({ name: w.script, date: w.date, value: w.requests })), day, FLOORS.requests),
    d1Written: topConsumers(d1.map((x) => ({ name: x.id, date: x.date, value: x.rowsWritten })), day, FLOORS.rowsWritten),
    d1Read: topConsumers(d1.map((x) => ({ name: x.id, date: x.date, value: x.rowsRead })), day, FLOORS.rowsRead),
    kvReads: extra ? topConsumers(extra.kv, day, FLOORS.kvReads) : [],
    aiNeurons: extra ? topConsumers(extra.ai, day, FLOORS.aiNeurons) : [],
    r2Storage: extra ? topConsumers(extra.r2, day, FLOORS.r2GB) : [],
  };
}

// KV reads, Workers AI neurons and R2 storage, in a query of their own so a dataset the token cannot read never
// drops the Workers / D1 part of the report.
async function fetchExtra(account: CloudflareAccountInput, start: string, end: string) {
  const data = await gql<{ viewer: { accounts: RawExtra[] } }>(account, `
    query ($accountTag: String!, $start: Date!, $end: Date!) {
      viewer { accounts(filter: { accountTag: $accountTag }) {
        k: kvOperationsAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end, actionType: "read" }) {
          sum { requests } dimensions { namespaceId date }
        }
        a: aiInferenceAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
          sum { totalNeurons } dimensions { modelId date }
        }
        r: r2StorageAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
          max { payloadSize } dimensions { bucketName date }
        }
      } }
    }`, { accountTag: account.accountId, start, end });
  const acct = data.viewer.accounts[0] ?? { k: [], a: [], r: [] };
  const ns = await resolveInstanceNames(account, 'namespace');
  return {
    kv: (acct.k ?? []).map((r) => ({ name: ns[r.dimensions.namespaceId] ?? r.dimensions.namespaceId, date: r.dimensions.date, value: r.sum.requests ?? 0 })),
    ai: (acct.a ?? []).map((r) => ({ name: r.dimensions.modelId.replace(/^@cf\//, ''), date: r.dimensions.date, value: r.sum.totalNeurons ?? 0 })),
    r2: (acct.r ?? []).map((r) => ({ name: r.dimensions.bucketName, date: r.dimensions.date, value: (r.max.payloadSize ?? 0) / 1e9 })),
  };
}

// Cloudflare's workersInvocationsScheduled dataset has returned no rows for whole days (from 2026-10-20) while the
// crons kept running; say so instead of reporting "no failing cron schedules".
export const CRON_DATA_MISSING =
  'Cloudflare reported no cron runs for this day, so failing cron schedules cannot be detected (Workers are still checked by their overall error rate).';

export function hasWatchFindings(r: WatchReport | null): boolean {
  if (!r) return false;
  return r.failing.length > 0 || (r.stopped ?? []).length > 0 || [r.workersCpu, r.workersRequests, r.d1Written, r.d1Read, r.kvReads, r.aiNeurons, r.r2Storage]
    .some((l) => (l ?? []).some((c) => c.spike));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmt = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : n.toFixed(n < 10 ? 1 : 0));
const TD = 'padding:4px 8px;border-bottom:1px solid #1e293b;font-size:13px;';

function consumerTable(title: string, unit: string, list: Consumer[] | undefined): string {
  if (!list?.length) return '';
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
  const stopped = r.stopped?.length
    ? `<div style="margin:0 0 12px;padding:10px 14px;border-radius:8px;background:#f59e0b1a;border:1px solid #f59e0b40;">
        <div style="color:#fbbf24;font-weight:600;margin-bottom:4px;">Stopped on ${r.day}? (a job that stopped, or a market holiday)</div>
        ${r.stopped.map((x) => `<div style="font-size:13px;color:#e2e8f0;">${esc(x.name)} — ${x.kind === 'd1'
          ? `D1 rows written ${fmt(x.value)} (same weekday last week ${fmt(x.before)})`
          : `no requests (previous 7-day avg ${fmt(x.before)} a day)`}</div>`).join('')}
      </div>`
    : '';
  const noCron = r.cronRuns === 0
    ? `<p style="margin:0 0 12px;font-size:12px;color:#fbbf24;">${CRON_DATA_MISSING}</p>`
    : '';
  return `<h3 style="margin:24px 0 8px;font-size:15px;">Account watch (${r.day} UTC)</h3>
    ${failing}${stopped}${noCron}
    ${consumerTable('Workers by CPU', ' s', r.workersCpu)}
    ${consumerTable('Workers by requests', '', r.workersRequests)}
    ${consumerTable('D1 rows written', '', r.d1Written)}
    ${consumerTable('D1 rows read', '', r.d1Read)}
    ${consumerTable('KV reads', '', r.kvReads)}
    ${consumerTable('Workers AI neurons', '', r.aiNeurons)}
    ${consumerTable('R2 storage', ' GB', r.r2Storage)}
    <p style="margin:6px 0 0;font-size:12px;color:#64748b;">🔺 = ${SPIKE_FACTOR}x or more of the previous-week average.</p>`;
}
