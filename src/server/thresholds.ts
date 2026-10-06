import type { ServiceMetricSummary } from '../shared/types';

// Usage-threshold alerts: notify once each time a metric's month-to-date usage
// crosses another step of its paid-plan included allowance (e.g. 20%, 40%, ...).
// Pure helpers live here so they can be unit-tested; alerts.ts wires them to
// analytics, D1 state and email.

export const DEFAULT_THRESHOLDS = [20, 40, 50, 70, 80, 90];

// Parse "20,40,50" (env ALERT_THRESHOLDS). Invalid input falls back to the defaults.
export function parseThresholds(raw: string | undefined | null): number[] {
  if (!raw || !raw.trim()) return DEFAULT_THRESHOLDS;
  const values = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 1000);
  const unique = [...new Set(values)].sort((a, b) => a - b);
  return unique.length ? unique : DEFAULT_THRESHOLDS;
}

export const metricKey = (m: Pick<ServiceMetricSummary, 'product' | 'metric'>) => `${m.product}|${m.metric}`;

// Share (%) of the paid plan's monthly included allowance used so far this month.
// Metrics without a paid allowance are not evaluated.
export function paidShare(m: ServiceMetricSummary): number | null {
  if (!m.paidIncluded || m.paidIncluded <= 0 || m.monthlyUsed == null) return null;
  return (m.monthlyUsed / m.paidIncluded) * 100;
}

// Highest threshold reached by `share` (0 when below the first one).
export function levelFor(share: number, thresholds: number[]): number {
  let level = 0;
  for (const t of thresholds) if (share >= t) level = t;
  return level;
}

export interface ThresholdCrossing {
  key: string;
  metric: ServiceMetricSummary;
  share: number;
  level: number;
  previous: number;
}

// Metrics whose level rose above what was already notified this month.
export function newCrossings(
  metrics: ServiceMetricSummary[],
  notified: Map<string, number>,
  thresholds: number[]
): ThresholdCrossing[] {
  const out: ThresholdCrossing[] = [];
  for (const m of metrics) {
    const share = paidShare(m);
    if (share == null) continue;
    const level = levelFor(share, thresholds);
    const key = metricKey(m);
    const previous = notified.get(key) ?? 0;
    if (level > previous) out.push({ key, metric: m, share, level, previous });
  }
  return out.sort((a, b) => b.level - a.level || b.share - a.share);
}
