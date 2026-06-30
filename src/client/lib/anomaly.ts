import type { DailyValue } from '../api';

// Flag spike days: values that are both well above the mean (> mean + 2σ) and a
// clear multiple of the typical day (> 2× median). Returns a set of dates.
export function detectSpikes(daily: DailyValue[]): Set<string> {
  const spikes = new Set<string>();
  const values = daily.map((d) => d.value).filter((v) => v > 0);
  if (values.length < 4) return spikes;

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = Math.max(mean + 2 * std, median * 2);

  for (const d of daily) {
    if (d.value > threshold && d.value > median * 2) spikes.add(d.date);
  }
  return spikes;
}
