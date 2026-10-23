import { describe, it, expect } from 'vitest';
import { failingWorkers, failingCrons, mergeFailing, topConsumers, hasWatchFindings, watchSection, FLOORS, type WorkerDay, type WatchReport } from '../../src/server/watch';
import type { ServicesAnalysis } from '../../src/shared/types';
import { buildEmail } from '../../src/server/alerts';

const day = '2026-10-19';

describe('failingWorkers', () => {
  it('flags a cron that throws on every run, not an occasional error', () => {
    const rows: WorkerDay[] = [
      { script: 'gcc-prop', date: day, requests: 24, errors: 24, cpuUs: 0, statuses: { scriptThrewException: 24 } },
      { script: 'busy', date: day, requests: 5000, errors: 12, cpuUs: 0, statuses: { success: 4988 } },
      { script: 'busy', date: day, requests: 12, errors: 12, cpuUs: 0, statuses: { internalError: 12 } },
      { script: 'flaky', date: day, requests: 4, errors: 4, cpuUs: 0, statuses: { internalError: 4 } },
      { script: 'gcc-prop', date: '2026-10-18', requests: 24, errors: 24, cpuUs: 0, statuses: { scriptThrewException: 24 } },
    ];
    const f = failingWorkers(rows, day);
    expect(f.map((w) => w.script)).toEqual(['gcc-prop']);
    expect(f[0]).toMatchObject({ requests: 24, errors: 24, share: 1, statuses: { scriptThrewException: 24 } });
  });
});

describe('failingCrons', () => {
  it('flags a schedule that fails most runs even when the Worker serves pages fine', () => {
    const runs = [
      ...Array.from({ length: 23 }, () => ({ script: 'gcc-prop', cron: '0 * * * *', status: 'scriptThrewException' })),
      ...Array.from({ length: 30 }, () => ({ script: 'site', cron: '*/5 7-9 * * MON-FRI', status: 'success' })),
      { script: 'site', cron: '*/5 7-9 * * MON-FRI', status: 'exceededResources' },
      { script: 'daily', cron: '0 1 * * *', status: 'scriptThrewException' },
    ];
    const f = failingCrons(runs);
    expect(f.map((w) => [w.script, w.cron, w.errors, w.requests])).toEqual([['gcc-prop', '0 * * * *', 23, 23]]);
    const web = [{ script: 'gcc-prop', requests: 180, errors: 23, share: 0.13, statuses: {} }, { script: 'other', requests: 10, errors: 10, share: 1, statuses: {} }];
    expect(mergeFailing(f, web).map((w) => w.script)).toEqual(['gcc-prop', 'other']);
  });
});

describe('topConsumers', () => {
  it('ranks by yesterday and marks jumps against the previous-week average', () => {
    const rows = [
      ...['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].flatMap((d) => [
        { name: 'steady', date: d, value: 200_000 }, { name: 'jumpy', date: d, value: 30_000 },
      ]),
      { name: 'steady', date: day, value: 210_000 },
      { name: 'jumpy', date: day, value: 150_000 },
      { name: 'new-small', date: day, value: 5_000 },
    ];
    const t = topConsumers(rows, day, FLOORS.rowsWritten);
    expect(t.map((c) => [c.name, c.spike])).toEqual([['steady', false], ['jumpy', true], ['new-small', false]]);
    expect(t[1].prevAvg).toBeCloseTo(30_000);
  });
});

describe('watch section in the digest', () => {
  const report: WatchReport = {
    day, failing: [{ script: 'gcc-prop', requests: 24, errors: 24, share: 1, statuses: { scriptThrewException: 24 } }],
    workersCpu: [], workersRequests: [], d1Written: [{ name: 'uae-prop-db', value: 300_000, prevAvg: 50_000, spike: true }], d1Read: [],
    kvReads: [], aiNeurons: [], r2Storage: [],
  };
  it('is a finding when a Worker fails or a jump appears', () => {
    expect(hasWatchFindings(null)).toBe(false);
    expect(hasWatchFindings(report)).toBe(true);
    expect(hasWatchFindings({ ...report, failing: [], d1Written: [] })).toBe(false);
    expect(hasWatchFindings({ ...report, failing: [], d1Written: [], aiNeurons: [{ name: 'meta/llama-4-scout', value: 787_000, prevAvg: 60_000, spike: true }] })).toBe(true);
    expect(watchSection({ ...report, r2Storage: [{ name: 'bit-japan-auction-docs', value: 7.2, prevAvg: 0, spike: true }] })).toContain('🔺 bit-japan-auction-docs');
  });
  it('renders the failing Worker and the jump, and prefixes the subject', () => {
    const html = watchSection(report);
    expect(html).toContain('gcc-prop — 24 / 24 invocations failed (100%)');
    expect(watchSection({ ...report, failing: [{ ...report.failing[0], cron: '0 * * * *' }] })).toContain('gcc-prop (cron 0 * * * *) — 24 / 24 runs failed');
    expect(html).toContain('🔺 uae-prop-db');
    const analysis = { accountName: 'A', month: '2026-10', currentMonthCost: 0, forecastedCost: 0, services: [], topDrivers: [] } as unknown as ServicesAnalysis;
    const { subject, html: mail } = buildEmail(analysis, null, 'https://x', report);
    expect(subject.startsWith('❌ 1 Worker failing · ')).toBe(true);
    expect(mail).toContain('Account watch (2026-10-19 UTC)');
  });
});
