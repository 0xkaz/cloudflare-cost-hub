import type { Context } from 'hono';
import type { KVNamespace } from '@cloudflare/workers-types';
import type { Env } from './types';

// Bump to invalidate every cached entry after a response-shape change.
const CACHE_VERSION = 'v1';

interface CacheEntry {
  storedAt: number; // epoch ms when produced
  body: unknown;
}

// Build a namespaced cache key. Include the account id and any query that
// changes the result (e.g. the selected month) so entries never collide.
export function cacheKey(scope: string, accountId: string, ...parts: string[]): string {
  return [CACHE_VERSION, scope, accountId, ...parts].join(':');
}

// Invalidate an account's cached current-month responses (e.g. after a manual
// snapshot) so the next request recomputes. Historical-month keys are left to
// expire on their own. No-op without a CACHE namespace.
export async function bustAccountCache(env: Env, accountId: string): Promise<void> {
  const kv = env.CACHE;
  if (!kv) return;
  await Promise.all([
    kv.delete(cacheKey('dash', accountId, 'current')),
    kv.delete(cacheKey('services', accountId, 'current')),
    kv.delete(cacheKey('trend', accountId)),
  ]);
}

async function store(
  kv: KVNamespace,
  key: string,
  body: unknown,
  ttlSeconds: number
): Promise<void> {
  const entry: CacheEntry = { storedAt: Date.now(), body };
  // Keep stale entries available for a while past TTL so SWR can serve them;
  // KV then garbage-collects them at the hard expiry.
  await kv.put(key, JSON.stringify(entry), { expirationTtl: Math.max(ttlSeconds * 4, 120) });
}

// Compute a value through the KV cache with stale-while-revalidate:
// - fresh (age < ttl): return the cached value.
// - stale: return it immediately and refresh in the background (waitUntil).
// - miss: produce, store, return.
// Bypassed entirely when no CACHE namespace is bound, so the app works before
// the namespace is provisioned. `produce` errors propagate to the caller.
export async function cachedCompute<T>(
  env: Env,
  ctx: { waitUntil(p: Promise<unknown>): void },
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>
): Promise<T> {
  const kv = env.CACHE;
  if (!kv) return produce();

  const cached = (await kv.get(key, { type: 'json' })) as CacheEntry | null;
  if (cached) {
    const age = (Date.now() - cached.storedAt) / 1000;
    if (age >= ttlSeconds) {
      ctx.waitUntil(
        produce()
          .then((body) => store(kv, key, body, ttlSeconds))
          .catch(() => undefined) // keep serving the stale entry on refresh failure
      );
    }
    return cached.body as T;
  }

  const body = await produce();
  await store(kv, key, body, ttlSeconds);
  return body;
}

// Response-returning wrapper around cachedCompute for route handlers.
export async function cachedJson<T>(
  c: Context<{ Bindings: Env }>,
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>
): Promise<Response> {
  const body = await cachedCompute(c.env, c.executionCtx, key, ttlSeconds, produce);
  return c.json(body as object);
}
