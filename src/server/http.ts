// Shared HTTP helper that retries transient Cloudflare API failures (429 rate
// limits and 5xx) with exponential backoff + jitter, honoring the Retry-After
// header when present. Cloudflare's GraphQL Analytics API rate-limits bursty
// dashboards, so a couple of short retries smooth over the occasional 429.

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export interface RetryOptions {
  attempts?: number; // total attempts, including the first
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts: RetryOptions = {}
): Promise<Response> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 400;
  const max = opts.maxDelayMs ?? 4000;

  let res = await fetch(input, init);
  for (let attempt = 1; attempt < attempts && RETRYABLE.has(res.status); attempt++) {
    // Prefer the server's Retry-After (seconds); otherwise exponential backoff
    // with jitter so parallel product fetches don't retry in lockstep.
    const retryAfter = Number(res.headers.get('retry-after'));
    const delay =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(base * 2 ** (attempt - 1), max) + Math.random() * base;
    // Release the unused body so the connection can be reused.
    await res.body?.cancel().catch(() => undefined);
    await sleep(delay);
    res = await fetch(input, init);
  }
  return res;
}

// True when an error message looks like a Cloudflare rate-limit (code 10429 or
// HTTP 429), so callers can surface a friendlier "try again shortly" response.
export function isRateLimit(message: string): boolean {
  return /\b429\b/.test(message) || /\b10429\b/.test(message) || /rate limit/i.test(message);
}
