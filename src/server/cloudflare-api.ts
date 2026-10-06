import type { DailyValue, FreeTierStatus, UsageBreakdown, UsageMetric } from '../shared/types';
import type { FreeTierLimit } from './db/free-tier';
import { findLimit } from './db/free-tier';
import { resolveInstanceNames } from './cloudflare-rest';
import { fetchWithRetry } from './http';

const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

export interface CloudflareAccountInput {
  accountId: string;
  apiToken: string;
  name: string;
}

export interface UsageOptions {
  // Target month as 'YYYY-MM'. Defaults to the current month.
  month?: string;
}

export interface AccountUsage {
  accountId: string;
  accountName: string;
  currency: string;
  currentMonthCost: number;
  previousMonthCost: number;
  forecastedCost: number;
  dailyUsage: UsageMetric[];
  freeTierStatus: FreeTierStatus[];
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

// R2 operation classes. Class A = mutating/listing, Class B = reads. Delete and
// abort operations are free and intentionally omitted.
const R2_CLASS_A = new Set([
  'PutObject', 'CopyObject', 'PostObject', 'ListObjects', 'PutBucket', 'CreateBucket',
  'ListBuckets', 'ListMultipartUploads', 'CreateMultipartUpload', 'CompleteMultipartUpload',
  'UploadPart', 'UploadPartCopy', 'ListParts', 'PutBucketEncryption', 'PutBucketCors',
  'PutBucketLifecycleConfiguration',
]);
const R2_CLASS_B = new Set([
  'GetObject', 'HeadObject', 'HeadBucket', 'GetBucketEncryption', 'GetBucketCors',
  'GetBucketLifecycleConfiguration', 'UsageSummary',
]);

async function gql<T>(
  account: CloudflareAccountInput,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const res = await fetchWithRetry(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${account.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Cloudflare API error: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(`Cloudflare GraphQL error: ${json.errors[0].message}`);
  }
  if (!json.data) {
    throw new Error('Cloudflare API returned no data');
  }
  return json.data;
}

interface AccountsEnvelope<K extends string, Row> {
  viewer: { accounts: Array<Record<K, Row[]>> };
}

function datasetRows<K extends string, Row>(
  data: AccountsEnvelope<K, Row>,
  dataset: K
): Row[] {
  return data.viewer.accounts[0]?.[dataset] ?? [];
}

// Resolve a promise to a fallback rather than rejecting, so one unavailable
// product dataset never fails the whole dashboard.
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface MonthRange {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  isCurrent: boolean;
  todayStr: string;
}

function resolveMonthRange(month: string | undefined, now: Date): MonthRange {
  let year = now.getFullYear();
  let monthIndex = now.getMonth();
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    year = y;
    monthIndex = m - 1;
  }
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59));
  const isCurrent = year === now.getUTCFullYear() && monthIndex === now.getUTCMonth();
  const end = isCurrent ? now : lastDay;
  const prevStart = new Date(Date.UTC(year, monthIndex - 1, 1));
  const prevEnd = new Date(Date.UTC(year, monthIndex, 0, 23, 59, 59));
  return { start, end, prevStart, prevEnd, isCurrent, todayStr: ymd(now) };
}

// For daily-billed metrics: the current month shows today's usage, past months
// show the peak day (the most useful signal for "did we breach the daily cap").
function dailyValue(series: DailyValue[], range: MonthRange): number {
  if (series.length === 0) return 0;
  if (range.isCurrent) {
    return (
      series.find((s) => s.date === range.todayStr)?.value ??
      series[series.length - 1]?.value ??
      0
    );
  }
  return Math.max(...series.map((s) => s.value));
}

function sumValues(series: DailyValue[]): number {
  return series.reduce((s, d) => s + d.value, 0);
}

function sortByDate<T extends { date: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.date.localeCompare(b.date));
}

// --- Per-product fetchers ---------------------------------------------------

async function fetchWorkersDaily(
  account: CloudflareAccountInput,
  start: Date,
  end: Date
): Promise<DailyValue[]> {
  const query = `
    query ($accountTag: String!, $start: Time!, $end: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end }) {
            dimensions { date }
            sum { requests }
          }
        }
      }
    }
  `;
  const data = await gql<
    AccountsEnvelope<'workersInvocationsAdaptive', { dimensions: { date: string }; sum: { requests: number } }>
  >(account, query, { accountTag: account.accountId, start: start.toISOString(), end: end.toISOString() });
  return sortByDate(
    datasetRows(data, 'workersInvocationsAdaptive').map((r) => ({
      date: r.dimensions.date,
      value: Number(r.sum.requests) || 0,
    }))
  );
}

async function fetchD1Daily(
  account: CloudflareAccountInput,
  start: Date,
  end: Date
): Promise<Array<{ date: string; rowsRead: number; rowsWritten: number }>> {
  const query = `
    query ($accountTag: String!, $start: Date!, $end: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
            dimensions { date }
            sum { rowsRead rowsWritten }
          }
        }
      }
    }
  `;
  const data = await gql<
    AccountsEnvelope<'d1AnalyticsAdaptiveGroups', { dimensions: { date: string }; sum: { rowsRead: number; rowsWritten: number } }>
  >(account, query, { accountTag: account.accountId, start: ymd(start), end: ymd(end) });
  return sortByDate(
    datasetRows(data, 'd1AnalyticsAdaptiveGroups').map((r) => ({
      date: r.dimensions.date,
      rowsRead: Number(r.sum.rowsRead) || 0,
      rowsWritten: Number(r.sum.rowsWritten) || 0,
    }))
  );
}

async function fetchKVDaily(
  account: CloudflareAccountInput,
  start: Date,
  end: Date
): Promise<Array<{ date: string; reads: number; writes: number }>> {
  const query = `
    query ($accountTag: String!, $start: Date!, $end: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          kvOperationsAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
            dimensions { date actionType }
            sum { requests }
          }
        }
      }
    }
  `;
  const data = await gql<
    AccountsEnvelope<'kvOperationsAdaptiveGroups', { dimensions: { date: string; actionType: string }; sum: { requests: number } }>
  >(account, query, { accountTag: account.accountId, start: ymd(start), end: ymd(end) });
  const byDate = new Map<string, { date: string; reads: number; writes: number }>();
  for (const r of datasetRows(data, 'kvOperationsAdaptiveGroups')) {
    const day = byDate.get(r.dimensions.date) ?? { date: r.dimensions.date, reads: 0, writes: 0 };
    const reqs = Number(r.sum.requests) || 0;
    // Cloudflare counts list/delete against the write quota.
    if (r.dimensions.actionType === 'read') day.reads += reqs;
    else day.writes += reqs;
    byDate.set(r.dimensions.date, day);
  }
  return sortByDate([...byDate.values()]);
}

async function fetchRequestsDaily(
  account: CloudflareAccountInput,
  start: Date,
  end: Date,
  dataset: 'pagesFunctionsInvocationsAdaptiveGroups' | 'durableObjectsInvocationsAdaptiveGroups'
): Promise<DailyValue[]> {
  const query = `
    query ($accountTag: String!, $start: Date!, $end: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          ${dataset}(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
            dimensions { date }
            sum { requests }
          }
        }
      }
    }
  `;
  const data = await gql<
    AccountsEnvelope<typeof dataset, { dimensions: { date: string }; sum: { requests: number } }>
  >(account, query, { accountTag: account.accountId, start: ymd(start), end: ymd(end) });
  return sortByDate(
    datasetRows(data, dataset).map((r) => ({
      date: r.dimensions.date,
      value: Number(r.sum.requests) || 0,
    }))
  );
}

// Workers AI usage is measured in Neurons (10,000/day on the free tier).
async function fetchAINeuronsDaily(
  account: CloudflareAccountInput,
  start: Date,
  end: Date
): Promise<DailyValue[]> {
  const query = `
    query ($accountTag: String!, $start: Date!, $end: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          aiInferenceAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
            dimensions { date }
            sum { totalNeurons }
          }
        }
      }
    }
  `;
  const data = await gql<
    AccountsEnvelope<'aiInferenceAdaptiveGroups', { dimensions: { date: string }; sum: { totalNeurons: number } }>
  >(account, query, { accountTag: account.accountId, start: ymd(start), end: ymd(end) });
  return sortByDate(
    datasetRows(data, 'aiInferenceAdaptiveGroups').map((r) => ({
      date: r.dimensions.date,
      value: Math.round(Number(r.sum.totalNeurons) || 0),
    }))
  );
}

// Queue message operations (1,000,000/month on the free tier). `count` is the
// number of operations.
async function fetchQueueOpsDaily(
  account: CloudflareAccountInput,
  start: Date,
  end: Date
): Promise<DailyValue[]> {
  const query = `
    query ($accountTag: String!, $start: Date!, $end: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          queueMessageOperationsAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
            dimensions { date }
            count
          }
        }
      }
    }
  `;
  const data = await gql<
    AccountsEnvelope<'queueMessageOperationsAdaptiveGroups', { dimensions: { date: string }; count: number }>
  >(account, query, { accountTag: account.accountId, start: ymd(start), end: ymd(end) });
  return sortByDate(
    datasetRows(data, 'queueMessageOperationsAdaptiveGroups').map((r) => ({
      date: r.dimensions.date,
      value: Number(r.count) || 0,
    }))
  );
}

async function fetchR2OperationsDaily(
  account: CloudflareAccountInput,
  start: Date,
  end: Date
): Promise<Array<{ date: string; classA: number; classB: number }>> {
  const query = `
    query ($accountTag: String!, $start: Date!, $end: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          r2OperationsAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
            dimensions { date actionType }
            sum { requests }
          }
        }
      }
    }
  `;
  const data = await gql<
    AccountsEnvelope<'r2OperationsAdaptiveGroups', { dimensions: { date: string; actionType: string }; sum: { requests: number } }>
  >(account, query, { accountTag: account.accountId, start: ymd(start), end: ymd(end) });
  const byDate = new Map<string, { date: string; classA: number; classB: number }>();
  for (const r of datasetRows(data, 'r2OperationsAdaptiveGroups')) {
    const day = byDate.get(r.dimensions.date) ?? { date: r.dimensions.date, classA: 0, classB: 0 };
    const reqs = Number(r.sum.requests) || 0;
    if (R2_CLASS_A.has(r.dimensions.actionType)) day.classA += reqs;
    else if (R2_CLASS_B.has(r.dimensions.actionType)) day.classB += reqs;
    byDate.set(r.dimensions.date, day);
  }
  return sortByDate([...byDate.values()]);
}

async function fetchR2StorageDaily(
  account: CloudflareAccountInput,
  start: Date,
  end: Date
): Promise<DailyValue[]> {
  return fetchStorageDailyGB(account, start, end, 'r2StorageAdaptiveGroups', 'payloadSize', 'bucketName');
}

// Generic daily storage fetcher: returns the stored bytes per day as GB, summed over
// instances (buckets, databases, namespaces). Grouping by date alone would return the
// peak of the largest single instance, not the account total that billing uses.
async function fetchStorageDailyGB(
  account: CloudflareAccountInput,
  start: Date,
  end: Date,
  dataset: 'r2StorageAdaptiveGroups' | 'd1StorageAdaptiveGroups' | 'kvStorageAdaptiveGroups',
  field: string,
  instanceDim: string
): Promise<DailyValue[]> {
  const query = `
    query ($accountTag: String!, $start: Date!, $end: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          ${dataset}(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
            dimensions { date ${instanceDim} }
            max { ${field} }
          }
        }
      }
    }
  `;
  const data = await gql<
    AccountsEnvelope<typeof dataset, { dimensions: { date: string }; max: Record<string, number> }>
  >(account, query, { accountTag: account.accountId, start: ymd(start), end: ymd(end) });
  return sumStorageByDate(datasetRows(data, dataset), field);
}

// Sum each instance's peak bytes per day and convert to GB.
export function sumStorageByDate(
  rows: Array<{ dimensions: { date: string }; max: Record<string, number> }>,
  field: string
): DailyValue[] {
  const byDate = new Map<string, number>();
  for (const r of rows) {
    byDate.set(r.dimensions.date, (byDate.get(r.dimensions.date) ?? 0) + (Number(r.max?.[field]) || 0));
  }
  return sortByDate(
    [...byDate].map(([date, bytes]) => ({ date, value: Math.round((bytes / 1_000_000_000) * 100) / 100 }))
  );
}

// Durable Objects compute duration (GB-seconds), summed per day.
async function fetchDODurationDaily(
  account: CloudflareAccountInput,
  start: Date,
  end: Date
): Promise<DailyValue[]> {
  const query = `
    query ($accountTag: String!, $start: Date!, $end: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          durableObjectsPeriodicGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
            dimensions { date }
            sum { duration }
          }
        }
      }
    }
  `;
  const data = await gql<
    AccountsEnvelope<'durableObjectsPeriodicGroups', { dimensions: { date: string }; sum: { duration: number } }>
  >(account, query, { accountTag: account.accountId, start: ymd(start), end: ymd(end) });
  return sortByDate(
    datasetRows(data, 'durableObjectsPeriodicGroups').map((r) => ({
      date: r.dimensions.date,
      value: Math.round(Number(r.sum.duration) || 0),
    }))
  );
}

// --- Aggregate monthly usage ------------------------------------------------

interface MonthlyUsage {
  workers: DailyValue[];
  d1: Array<{ date: string; rowsRead: number; rowsWritten: number }>;
  kv: Array<{ date: string; reads: number; writes: number }>;
  pages: DailyValue[];
  durableObjects: DailyValue[];
  ai: DailyValue[];
  queues: DailyValue[];
  r2ops: Array<{ date: string; classA: number; classB: number }>;
  r2storage: DailyValue[];
  d1storage: DailyValue[];
  kvstorage: DailyValue[];
  doDuration: DailyValue[];
}

const EMPTY_USAGE: MonthlyUsage = {
  workers: [], d1: [], kv: [], pages: [], durableObjects: [], ai: [], queues: [], r2ops: [],
  r2storage: [], d1storage: [], kvstorage: [], doDuration: [],
};

// Workers is fetched without safe() so auth/token errors surface; every other
// product degrades to empty data if unavailable for this account.
async function fetchMonthlyUsage(
  account: CloudflareAccountInput,
  start: Date,
  end: Date
): Promise<MonthlyUsage> {
  const [
    workers, d1, kv, pages, durableObjects, ai, queues, r2ops, r2storage,
    d1storage, kvstorage, doDuration,
  ] = await Promise.all([
    fetchWorkersDaily(account, start, end),
    safe(fetchD1Daily(account, start, end), []),
    safe(fetchKVDaily(account, start, end), []),
    safe(fetchRequestsDaily(account, start, end, 'pagesFunctionsInvocationsAdaptiveGroups'), []),
    safe(fetchRequestsDaily(account, start, end, 'durableObjectsInvocationsAdaptiveGroups'), []),
    safe(fetchAINeuronsDaily(account, start, end), []),
    safe(fetchQueueOpsDaily(account, start, end), []),
    safe(fetchR2OperationsDaily(account, start, end), []),
    safe(fetchR2StorageDaily(account, start, end), []),
    safe(fetchStorageDailyGB(account, start, end, 'd1StorageAdaptiveGroups', 'databaseSizeBytes', 'databaseId'), []),
    safe(fetchStorageDailyGB(account, start, end, 'kvStorageAdaptiveGroups', 'byteCount', 'namespaceId'), []),
    safe(fetchDODurationDaily(account, start, end), []),
  ]);
  return {
    workers, d1, kv, pages, durableObjects, ai, queues, r2ops, r2storage,
    d1storage, kvstorage, doDuration,
  };
}

// --- Cost estimate ----------------------------------------------------------

// Approximate Cloudflare Workers Paid pricing: the monthly allowance included
// in the paid plan and the unit price for usage beyond it. This is an ESTIMATE,
// not an invoice. Keyed by `${product}|${metric}`.
export interface PricePoint {
  monthlyUsed: (u: MonthlyUsage) => number;
  included: number; // monthly included allowance on the paid plan
  pricePerUnit: number; // USD per `unitSize` units over the allowance
  unitSize: number;
  unitLabel: string; // e.g. 'million requests'
}

export const PRICING: Record<string, PricePoint> = {
  'Workers|requests': { monthlyUsed: (u) => sumValues(u.workers), included: 10_000_000, pricePerUnit: 0.3, unitSize: 1_000_000, unitLabel: 'million requests' },
  'D1|rows read': { monthlyUsed: (u) => u.d1.reduce((s, d) => s + d.rowsRead, 0), included: 25_000_000_000, pricePerUnit: 0.001, unitSize: 1_000_000, unitLabel: 'million rows' },
  'D1|rows written': { monthlyUsed: (u) => u.d1.reduce((s, d) => s + d.rowsWritten, 0), included: 50_000_000, pricePerUnit: 1.0, unitSize: 1_000_000, unitLabel: 'million rows' },
  'KV|reads': { monthlyUsed: (u) => u.kv.reduce((s, d) => s + d.reads, 0), included: 10_000_000, pricePerUnit: 0.5, unitSize: 1_000_000, unitLabel: 'million reads' },
  'KV|writes': { monthlyUsed: (u) => u.kv.reduce((s, d) => s + d.writes, 0), included: 1_000_000, pricePerUnit: 5.0, unitSize: 1_000_000, unitLabel: 'million writes' },
  'R2|Class A operations': { monthlyUsed: (u) => u.r2ops.reduce((s, d) => s + d.classA, 0), included: 1_000_000, pricePerUnit: 4.5, unitSize: 1_000_000, unitLabel: 'million ops' },
  'R2|Class B operations': { monthlyUsed: (u) => u.r2ops.reduce((s, d) => s + d.classB, 0), included: 10_000_000, pricePerUnit: 0.36, unitSize: 1_000_000, unitLabel: 'million ops' },
  'R2|storage': { monthlyUsed: (u) => latestValue(u.r2storage), included: 10, pricePerUnit: 0.015, unitSize: 1, unitLabel: 'GB-month' },
  'D1|storage': { monthlyUsed: (u) => latestValue(u.d1storage), included: 5, pricePerUnit: 0.75, unitSize: 1, unitLabel: 'GB-month' },
  'KV|storage': { monthlyUsed: (u) => latestValue(u.kvstorage), included: 1, pricePerUnit: 0.5, unitSize: 1, unitLabel: 'GB-month' },
  'Durable Objects|requests': { monthlyUsed: (u) => sumValues(u.durableObjects), included: 1_000_000, pricePerUnit: 0.15, unitSize: 1_000_000, unitLabel: 'million requests' },
  'Durable Objects|duration': { monthlyUsed: (u) => sumValues(u.doDuration), included: 400_000, pricePerUnit: 12.5, unitSize: 1_000_000, unitLabel: 'million GB-s' },
  'Workers AI|neurons': { monthlyUsed: (u) => sumValues(u.ai), included: 300_000, pricePerUnit: 0.011, unitSize: 1_000, unitLabel: 'thousand neurons' },
  'Queues|operations': { monthlyUsed: (u) => sumValues(u.queues), included: 1_000_000, pricePerUnit: 0.4, unitSize: 1_000_000, unitLabel: 'million ops' },
};

function latestValue(series: DailyValue[]): number {
  return series.length ? series[series.length - 1].value : 0;
}

function metricCost(price: PricePoint, monthlyUsed: number): number {
  const over = Math.max(0, monthlyUsed - price.included);
  return (over / price.unitSize) * price.pricePerUnit;
}

function estimateCost(usage: MonthlyUsage): number {
  let cost = 0;
  for (const price of Object.values(PRICING)) {
    cost += metricCost(price, price.monthlyUsed(usage));
  }
  return Math.round(cost * 100) / 100;
}

// --- Free tier cards --------------------------------------------------------

function makeCard(
  limits: FreeTierLimit[],
  product: string,
  metric: string,
  used: number,
  daily: DailyValue[],
  period: 'day' | 'month',
  usage: MonthlyUsage
): FreeTierStatus | null {
  const limit = findLimit(limits, product, metric);
  if (!limit) return null;
  const percentage = limit.limit > 0 ? (used / limit.limit) * 100 : 0;

  // Attach the paid-plan comparison so the detail view can show free-tier vs
  // paid-plan side by side.
  const price = PRICING[`${product}|${metric}`];
  let paid: Pick<FreeTierStatus, 'paidIncluded' | 'paidPricePerUnit' | 'paidUnitSize' | 'paidUnitLabel' | 'monthlyUsed' | 'estimatedCost'> = {};
  if (price) {
    const monthlyUsed = price.monthlyUsed(usage);
    paid = {
      paidIncluded: price.included,
      paidPricePerUnit: price.pricePerUnit,
      paidUnitSize: price.unitSize,
      paidUnitLabel: price.unitLabel,
      monthlyUsed,
      estimatedCost: Math.round(metricCost(price, monthlyUsed) * 100) / 100,
    };
  }

  return {
    product,
    metric,
    limit: limit.limit,
    used,
    remaining: Math.max(0, limit.limit - used),
    percentage: Math.round(percentage * 10) / 10,
    unit: limit.unit,
    period,
    daily,
    ...paid,
  };
}

export async function fetchAccountUsage(
  account: CloudflareAccountInput,
  limits: FreeTierLimit[],
  opts: UsageOptions = {}
): Promise<AccountUsage> {
  const now = new Date();
  const range = resolveMonthRange(opts.month, now);

  const usage = await fetchMonthlyUsage(account, range.start, range.end);
  // Previous month is wrapped in safe(): it may be outside the retention window
  // (e.g. when viewing the oldest selectable month).
  const prevUsage = await safe(fetchMonthlyUsage(account, range.prevStart, range.prevEnd), EMPTY_USAGE);

  const dailyUsage: UsageMetric[] = usage.workers.map((d) => ({
    date: d.date,
    product: 'Workers',
    metric: 'requests',
    value: d.value,
    unit: 'requests',
  }));

  const d1Read = usage.d1.map((d) => ({ date: d.date, value: d.rowsRead }));
  const d1Write = usage.d1.map((d) => ({ date: d.date, value: d.rowsWritten }));
  const kvReads = usage.kv.map((d) => ({ date: d.date, value: d.reads }));
  const kvWrites = usage.kv.map((d) => ({ date: d.date, value: d.writes }));
  const r2ClassA = usage.r2ops.map((d) => ({ date: d.date, value: d.classA }));
  const r2ClassB = usage.r2ops.map((d) => ({ date: d.date, value: d.classB }));

  const freeTierStatus = [
    makeCard(limits, 'Workers', 'requests', dailyValue(usage.workers, range), usage.workers, 'day', usage),
    makeCard(limits, 'D1', 'rows read', dailyValue(d1Read, range), d1Read, 'day', usage),
    makeCard(limits, 'D1', 'rows written', dailyValue(d1Write, range), d1Write, 'day', usage),
    makeCard(limits, 'KV', 'reads', dailyValue(kvReads, range), kvReads, 'day', usage),
    makeCard(limits, 'KV', 'writes', dailyValue(kvWrites, range), kvWrites, 'day', usage),
    makeCard(limits, 'Pages', 'requests', dailyValue(usage.pages, range), usage.pages, 'day', usage),
    makeCard(limits, 'Durable Objects', 'requests', dailyValue(usage.durableObjects, range), usage.durableObjects, 'day', usage),
    makeCard(limits, 'Workers AI', 'neurons', dailyValue(usage.ai, range), usage.ai, 'day', usage),
    makeCard(limits, 'Queues', 'operations', sumValues(usage.queues), usage.queues, 'month', usage),
    makeCard(limits, 'R2', 'Class A operations', sumValues(r2ClassA), r2ClassA, 'month', usage),
    makeCard(limits, 'R2', 'Class B operations', sumValues(r2ClassB), r2ClassB, 'month', usage),
    makeCard(limits, 'R2', 'storage', latestValue(usage.r2storage), usage.r2storage, 'month', usage),
    makeCard(limits, 'D1', 'storage', latestValue(usage.d1storage), usage.d1storage, 'month', usage),
    makeCard(limits, 'KV', 'storage', latestValue(usage.kvstorage), usage.kvstorage, 'month', usage),
    makeCard(limits, 'Durable Objects', 'duration', sumValues(usage.doDuration), usage.doDuration, 'month', usage),
  ].filter((c): c is FreeTierStatus => c !== null);

  const currentMonthCost = estimateCost(usage);
  // Project the current month to month-end from the run-rate so far. Past months
  // are already complete, so their forecast equals the actual cost.
  let forecastedCost = currentMonthCost;
  if (range.isCurrent) {
    const daysElapsed = Math.max(1, now.getUTCDate());
    const totalDays = daysInMonth(range.start);
    forecastedCost = Math.round((currentMonthCost / daysElapsed) * totalDays * 100) / 100;
  }

  return {
    accountId: account.accountId,
    accountName: account.name,
    currency: 'USD',
    currentMonthCost,
    previousMonthCost: estimateCost(prevUsage),
    forecastedCost,
    dailyUsage,
    freeTierStatus,
  };
}

function daysInMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

// --- Per-instance breakdown -------------------------------------------------

interface BreakdownRow {
  dimensions: Record<string, string>;
  sum?: Record<string, number>;
  max?: Record<string, number>;
  count?: number;
}

interface BreakdownConfig {
  dataset: string;
  useTime?: boolean; // Workers uses a Time/datetime filter, others use Date.
  dims: string[]; // dimensions to request (instance field first, plus any needed for filtering)
  instanceField: string;
  instanceLabel: string; // human noun: database, bucket, namespace, script, model, queue
  selection: string; // GraphQL selection after dimensions
  value: (row: BreakdownRow) => number;
}

const BREAKDOWN: Record<string, BreakdownConfig> = {
  'Workers|requests': { dataset: 'workersInvocationsAdaptive', useTime: true, dims: ['scriptName'], instanceField: 'scriptName', instanceLabel: 'script', selection: 'sum { requests }', value: (r) => Number(r.sum?.requests) || 0 },
  'D1|rows read': { dataset: 'd1AnalyticsAdaptiveGroups', dims: ['databaseId'], instanceField: 'databaseId', instanceLabel: 'database', selection: 'sum { rowsRead }', value: (r) => Number(r.sum?.rowsRead) || 0 },
  'D1|rows written': { dataset: 'd1AnalyticsAdaptiveGroups', dims: ['databaseId'], instanceField: 'databaseId', instanceLabel: 'database', selection: 'sum { rowsWritten }', value: (r) => Number(r.sum?.rowsWritten) || 0 },
  'KV|reads': { dataset: 'kvOperationsAdaptiveGroups', dims: ['namespaceId', 'actionType'], instanceField: 'namespaceId', instanceLabel: 'namespace', selection: 'sum { requests }', value: (r) => (r.dimensions.actionType === 'read' ? Number(r.sum?.requests) || 0 : 0) },
  'KV|writes': { dataset: 'kvOperationsAdaptiveGroups', dims: ['namespaceId', 'actionType'], instanceField: 'namespaceId', instanceLabel: 'namespace', selection: 'sum { requests }', value: (r) => (r.dimensions.actionType !== 'read' ? Number(r.sum?.requests) || 0 : 0) },
  'Pages|requests': { dataset: 'pagesFunctionsInvocationsAdaptiveGroups', dims: ['scriptName'], instanceField: 'scriptName', instanceLabel: 'project', selection: 'sum { requests }', value: (r) => Number(r.sum?.requests) || 0 },
  'Durable Objects|requests': { dataset: 'durableObjectsInvocationsAdaptiveGroups', dims: ['scriptName'], instanceField: 'scriptName', instanceLabel: 'script', selection: 'sum { requests }', value: (r) => Number(r.sum?.requests) || 0 },
  'Workers AI|neurons': { dataset: 'aiInferenceAdaptiveGroups', dims: ['modelId'], instanceField: 'modelId', instanceLabel: 'model', selection: 'sum { totalNeurons }', value: (r) => Math.round(Number(r.sum?.totalNeurons) || 0) },
  'R2|Class A operations': { dataset: 'r2OperationsAdaptiveGroups', dims: ['bucketName', 'actionType'], instanceField: 'bucketName', instanceLabel: 'bucket', selection: 'sum { requests }', value: (r) => (R2_CLASS_A.has(r.dimensions.actionType) ? Number(r.sum?.requests) || 0 : 0) },
  'R2|Class B operations': { dataset: 'r2OperationsAdaptiveGroups', dims: ['bucketName', 'actionType'], instanceField: 'bucketName', instanceLabel: 'bucket', selection: 'sum { requests }', value: (r) => (R2_CLASS_B.has(r.dimensions.actionType) ? Number(r.sum?.requests) || 0 : 0) },
  'R2|storage': { dataset: 'r2StorageAdaptiveGroups', dims: ['bucketName'], instanceField: 'bucketName', instanceLabel: 'bucket', selection: 'max { payloadSize }', value: (r) => Math.round(((Number(r.max?.payloadSize) || 0) / 1_000_000_000) * 100) / 100 },
  'D1|storage': { dataset: 'd1StorageAdaptiveGroups', dims: ['databaseId'], instanceField: 'databaseId', instanceLabel: 'database', selection: 'max { databaseSizeBytes }', value: (r) => Math.round(((Number(r.max?.databaseSizeBytes) || 0) / 1_000_000_000) * 100) / 100 },
  'KV|storage': { dataset: 'kvStorageAdaptiveGroups', dims: ['namespaceId'], instanceField: 'namespaceId', instanceLabel: 'namespace', selection: 'max { byteCount }', value: (r) => Math.round(((Number(r.max?.byteCount) || 0) / 1_000_000_000) * 100) / 100 },
  'Durable Objects|duration': { dataset: 'durableObjectsPeriodicGroups', dims: ['scriptName'], instanceField: 'scriptName', instanceLabel: 'script', selection: 'sum { duration }', value: (r) => Math.round(Number(r.sum?.duration) || 0) },
  'Queues|operations': { dataset: 'queueMessageOperationsAdaptiveGroups', dims: ['queueId'], instanceField: 'queueId', instanceLabel: 'queue', selection: 'count', value: (r) => Number(r.count) || 0 },
};

export function breakdownSupported(product: string, metric: string): boolean {
  return Boolean(BREAKDOWN[`${product}|${metric}`]);
}

// Aggregate usage of a single metric by the instance (database, bucket, …) that
// produced it, so the detail view can show which instance drives the quota.
export async function fetchInstanceBreakdown(
  account: CloudflareAccountInput,
  product: string,
  metric: string,
  unit: string,
  opts: UsageOptions = {}
): Promise<UsageBreakdown | null> {
  const cfg = BREAKDOWN[`${product}|${metric}`];
  if (!cfg) return null;

  const range = resolveMonthRange(opts.month, new Date());
  const scalar = cfg.useTime ? 'Time' : 'Date';
  const field = cfg.useTime ? 'datetime' : 'date';
  const startVal = cfg.useTime ? range.start.toISOString() : ymd(range.start);
  const endVal = cfg.useTime ? range.end.toISOString() : ymd(range.end);

  const query = `
    query ($accountTag: String!, $start: ${scalar}!, $end: ${scalar}!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          ${cfg.dataset}(limit: 10000, filter: { ${field}_geq: $start, ${field}_leq: $end }) {
            dimensions { ${cfg.dims.join(' ')} }
            ${cfg.selection}
          }
        }
      }
    }
  `;
  const data = await gql<AccountsEnvelope<string, BreakdownRow>>(account, query, {
    accountTag: account.accountId,
    start: startVal,
    end: endVal,
  });

  const byId = new Map<string, number>();
  for (const row of datasetRows<string, BreakdownRow>(data, cfg.dataset)) {
    const id = row.dimensions[cfg.instanceField] || 'unknown';
    byId.set(id, (byId.get(id) || 0) + cfg.value(row));
  }

  // Resolve opaque ids (databaseId, namespaceId, queueId) to human-readable names.
  const names = await resolveInstanceNames(account, cfg.instanceLabel);

  const instances = [...byId.entries()]
    .map(([id, value]) => ({ id, label: names[id] || id, value: Math.round(value * 100) / 100 }))
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value);

  return {
    product,
    metric,
    unit,
    total: Math.round(instances.reduce((s, i) => s + i.value, 0) * 100) / 100,
    instanceLabel: cfg.instanceLabel,
    instances,
  };
}

export function generateDemoUsage(limits: FreeTierLimit[]): AccountUsage {
  const dailyUsage: UsageMetric[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dailyUsage.push({
      date: d.toISOString().slice(0, 10),
      product: 'Workers',
      metric: 'requests',
      value: Math.floor(20000 + Math.random() * 60000),
      unit: 'requests',
    });
  }
  const todayRequests = dailyUsage[dailyUsage.length - 1]?.value || 0;
  const monthRequests = dailyUsage.reduce((s, m) => s + m.value, 0);

  const dailyLimit = findLimit(limits, 'Workers', 'requests') ?? {
    limit: 100_000,
    unit: 'requests/day',
  };

  return {
    accountId: 'demo-account',
    accountName: 'Demo Account',
    currency: 'USD',
    currentMonthCost: round(
      Math.max(0, ((monthRequests - 10_000_000) * 0.3) / 1_000_000)
    ),
    previousMonthCost: 1.23,
    forecastedCost: round(
      Math.max(0, ((monthRequests - 10_000_000) * 0.3) / 1_000_000) * 1.05
    ),
    dailyUsage,
    freeTierStatus: [
      {
        product: 'Workers',
        metric: 'requests',
        limit: dailyLimit.limit,
        used: todayRequests,
        remaining: Math.max(0, dailyLimit.limit - todayRequests),
        percentage: Math.round((todayRequests / dailyLimit.limit) * 1000) / 10,
        unit: dailyLimit.unit,
        period: 'day',
        daily: dailyUsage.map((m) => ({ date: m.date, value: m.value })),
      },
    ],
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
