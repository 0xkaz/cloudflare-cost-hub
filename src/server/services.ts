import type { Env } from './types';
import type {
  CostDriver,
  ServiceMetricSummary,
  ServiceSummary,
  ServicesAnalysis,
  Tier,
} from '../shared/types';
import type { FreeTierStatus } from '../shared/types';
import {
  fetchAccountUsage,
  fetchInstanceBreakdown,
  breakdownSupported,
  type CloudflareAccountInput,
} from './cloudflare-api';
import { getFreeTierLimits } from './db/free-tier';
import { getServiceTrends } from './db/snapshots';

// Up to this many metrics are broken down per request to bound API calls.
const MAX_DRIVER_METRICS = 6;
const TOP_DRIVERS = 15;

function tierOf(s: { estimatedCost?: number; percentage: number; paidIncluded?: number }): Tier {
  if ((s.estimatedCost ?? 0) > 0) return 'billable';
  if (s.percentage >= 100) return (s.paidIncluded !== undefined ? 'paid' : 'billable');
  return 'free';
}

const TIER_RANK: Record<Tier, number> = { free: 0, paid: 1, billable: 2 };

export async function getServicesAnalysis(
  env: Env,
  acct: CloudflareAccountInput,
  month?: string
): Promise<ServicesAnalysis> {
  const limits = await getFreeTierLimits(env.DB);
  const usage = await fetchAccountUsage(acct, limits, { month });
  const resolvedMonth = month ?? new Date().toISOString().slice(0, 7);

  // Group metrics by product into service summaries.
  const byProduct = new Map<string, ServiceMetricSummary[]>();
  for (const s of usage.freeTierStatus) {
    const summary: ServiceMetricSummary = {
      product: s.product,
      metric: s.metric,
      unit: s.unit,
      used: s.used,
      limit: s.limit,
      percentage: s.percentage,
      period: s.period,
      tier: tierOf(s),
      monthlyUsed: s.monthlyUsed,
      paidIncluded: s.paidIncluded,
      estimatedCost: s.estimatedCost,
    };
    if (!byProduct.has(s.product)) byProduct.set(s.product, []);
    byProduct.get(s.product)!.push(summary);
  }

  const services: ServiceSummary[] = [...byProduct.entries()]
    .map(([product, metrics]) => {
      const totalCost = metrics.reduce((sum, m) => sum + (m.estimatedCost ?? 0), 0);
      const tier = metrics.reduce<Tier>(
        (worst, m) => (TIER_RANK[m.tier] > TIER_RANK[worst] ? m.tier : worst),
        'free'
      );
      return { product, totalCost: Math.round(totalCost * 100) / 100, tier, metrics };
    })
    .sort((a, b) => b.totalCost - a.totalCost || TIER_RANK[b.tier] - TIER_RANK[a.tier]);

  // Choose the highest-utilisation metrics that support a per-instance breakdown,
  // then attribute usage/cost to each instance to find the top cost drivers.
  const candidates = usage.freeTierStatus
    .filter((s) => breakdownSupported(s.product, s.metric) && (s.monthlyUsed ?? 0) > 0)
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, MAX_DRIVER_METRICS);

  const driverGroups = await Promise.all(
    candidates.map((s) => attributeDrivers(acct, s, month))
  );
  const topDrivers = driverGroups
    .flat()
    .sort((a, b) => b.estimatedCost - a.estimatedCost || (b.paidShare ?? 0) - (a.paidShare ?? 0))
    .slice(0, TOP_DRIVERS);

  const trends = await getServiceTrends(env.DB, acct.accountId);

  return {
    month: resolvedMonth,
    accountName: usage.accountName,
    currentMonthCost: usage.currentMonthCost,
    forecastedCost: usage.forecastedCost,
    services,
    topDrivers,
    trends,
  };
}

async function attributeDrivers(
  acct: CloudflareAccountInput,
  status: FreeTierStatus,
  month?: string
): Promise<CostDriver[]> {
  try {
    const breakdown = await fetchInstanceBreakdown(
      acct,
      status.product,
      status.metric,
      status.unit,
      { month }
    );
    if (!breakdown || breakdown.instances.length === 0) return [];

    const metricCost = status.estimatedCost ?? 0;
    const total = breakdown.total;
    const paidIncluded = status.paidIncluded;

    return breakdown.instances.slice(0, 8).map((inst) => ({
      product: status.product,
      metric: status.metric,
      instanceLabel: breakdown.instanceLabel,
      id: inst.id,
      label: inst.label,
      value: inst.value,
      unit: status.unit,
      paidShare: paidIncluded && paidIncluded > 0 ? inst.value / paidIncluded : undefined,
      estimatedCost:
        total > 0 ? Math.round(((inst.value / total) * metricCost) * 100) / 100 : 0,
    }));
  } catch {
    return [];
  }
}
