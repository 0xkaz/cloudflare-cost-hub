import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithRetry, isRateLimit } from '../../src/server/http';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetchSequence(statuses: number[]) {
  let i = 0;
  const fn = vi.fn(async () => {
    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    return new Response(status === 200 ? 'ok' : 'err', { status });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('fetchWithRetry', () => {
  it('retries a 429 then succeeds, returning the final 200', async () => {
    const fn = stubFetchSequence([429, 200]);
    const res = await fetchWithRetry('https://x', undefined, { baseDelayMs: 0, maxDelayMs: 0 });
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after `attempts` and returns the last retryable response', async () => {
    const fn = stubFetchSequence([429, 429, 429, 429]);
    const res = await fetchWithRetry('https://x', undefined, { attempts: 3, baseDelayMs: 0, maxDelayMs: 0 });
    expect(res.status).toBe(429);
    expect(fn).toHaveBeenCalledTimes(3); // first try + 2 retries
  });

  it('does not retry a non-retryable status (e.g. 400)', async () => {
    const fn = stubFetchSequence([400, 200]);
    const res = await fetchWithRetry('https://x', undefined, { baseDelayMs: 0, maxDelayMs: 0 });
    expect(res.status).toBe(400);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries 5xx as transient', async () => {
    const fn = stubFetchSequence([503, 200]);
    const res = await fetchWithRetry('https://x', undefined, { baseDelayMs: 0, maxDelayMs: 0 });
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('isRateLimit', () => {
  it('detects HTTP 429 and Cloudflare code 10429 and textual rate limits', () => {
    expect(isRateLimit('Cloudflare API error: 429 {"code":10429}')).toBe(true);
    expect(isRateLimit('code 10429')).toBe(true);
    expect(isRateLimit('Rate limited. Please wait')).toBe(true);
    expect(isRateLimit('Cloudflare API error: 500 boom')).toBe(false);
  });
});
