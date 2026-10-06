import { describe, it, expect } from 'vitest';
import { DEFAULT_THRESHOLDS, levelFor, newCrossings, paidShare, parseThresholds } from '../../src/server/thresholds';
import { buildThresholdEmail } from '../../src/server/alerts';
import type { ServiceMetricSummary } from '../../src/shared/types';

const metric = (product: string, metric: string, monthlyUsed: number, paidIncluded?: number): ServiceMetricSummary => ({
  product, metric, unit: 'units', used: monthlyUsed, limit: 100, percentage: 0, period: 'month', tier: 'free', monthlyUsed, paidIncluded,
});

describe('parseThresholds', () => {
  it('defaults to 20,40,50,70,80,90', () => {
    expect(parseThresholds(undefined)).toEqual([20, 40, 50, 70, 80, 90]);
    expect(parseThresholds('')).toEqual(DEFAULT_THRESHOLDS);
  });
  it('parses, de-duplicates and sorts', () => {
    expect(parseThresholds('90, 50,50,10')).toEqual([10, 50, 90]);
  });
  it('falls back on garbage', () => {
    expect(parseThresholds('a,b,-3')).toEqual(DEFAULT_THRESHOLDS);
  });
});

describe('levelFor / paidShare', () => {
  it('returns the highest threshold reached', () => {
    expect(levelFor(19.9, DEFAULT_THRESHOLDS)).toBe(0);
    expect(levelFor(20, DEFAULT_THRESHOLDS)).toBe(20);
    expect(levelFor(55, DEFAULT_THRESHOLDS)).toBe(50);
    expect(levelFor(140, DEFAULT_THRESHOLDS)).toBe(90);
  });
  it('only evaluates metrics with a paid allowance', () => {
    expect(paidShare(metric('Workers', 'requests', 5_000_000, 10_000_000))).toBe(50);
    expect(paidShare(metric('Pages', 'builds', 3))).toBeNull();
    expect(paidShare(metric('X', 'y', 3, 0))).toBeNull();
  });
});

describe('newCrossings', () => {
  const metrics = [
    metric('Workers AI', 'neurons', 240_000, 300_000), // 80%
    metric('Workers', 'requests', 2_100_000, 10_000_000), // 21%
    metric('D1', 'rows read', 1, 25_000_000_000), // ~0%
    metric('Pages', 'builds', 400), // no paid allowance
  ];
  it('reports every metric above its first threshold on the first run', () => {
    const c = newCrossings(metrics, new Map(), DEFAULT_THRESHOLDS);
    expect(c.map((x) => [x.key, x.level])).toEqual([['Workers AI|neurons', 80], ['Workers|requests', 20]]);
  });
  it('does not repeat a level already notified, but reports a higher one', () => {
    const notified = new Map([['Workers AI|neurons', 70], ['Workers|requests', 20]]);
    const c = newCrossings(metrics, notified, DEFAULT_THRESHOLDS);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ key: 'Workers AI|neurons', level: 80, previous: 70 });
  });
  it('is quiet when nothing moved', () => {
    const notified = new Map([['Workers AI|neurons', 80], ['Workers|requests', 20]]);
    expect(newCrossings(metrics, notified, DEFAULT_THRESHOLDS)).toEqual([]);
  });
});

describe('buildThresholdEmail', () => {
  it('names the metric and level in the subject', () => {
    const [c] = newCrossings([metric('Workers AI', 'neurons', 150_000, 300_000)], new Map(), DEFAULT_THRESHOLDS);
    const { subject, html } = buildThresholdEmail('Acme', '2026-10', [c], 'https://example.com');
    expect(subject).toContain('Workers AI neurons reached 50%');
    expect(html).toContain('50.0%');
    expect(html).toContain('2026-10');
  });
});
