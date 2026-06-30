import { describe, it, expect } from 'vitest';
import { detectSpikes } from '../../src/client/lib/anomaly';
import type { DailyValue } from '../../src/client/api';

function series(values: number[]): DailyValue[] {
  return values.map((value, i) => ({ date: `2026-06-${String(i + 1).padStart(2, '0')}`, value }));
}

describe('detectSpikes', () => {
  it('returns no spikes for fewer than 4 non-zero days', () => {
    expect(detectSpikes(series([10, 10, 10])).size).toBe(0);
  });

  it('flags a day that is far above the mean and a clear multiple of the median', () => {
    const spikes = detectSpikes(series([10, 12, 11, 10, 13, 200]));
    expect(spikes.has('2026-06-06')).toBe(true);
    expect(spikes.has('2026-06-01')).toBe(false);
  });

  it('flags nothing on a flat series', () => {
    expect(detectSpikes(series([100, 100, 100, 100, 100])).size).toBe(0);
  });

  it('ignores zero-value days when computing the baseline', () => {
    // Zeros are filtered out, leaving a stable baseline that 200 clearly spikes.
    const spikes = detectSpikes(series([0, 0, 10, 12, 11, 10, 13, 200]));
    expect(spikes.has('2026-06-08')).toBe(true); // the 200 day
    expect(spikes.has('2026-06-03')).toBe(false); // a baseline day
  });
});
