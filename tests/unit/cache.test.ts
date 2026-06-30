import { describe, it, expect, vi } from 'vitest';
import { cacheKey, cachedJson } from '../../src/server/cache';
import type { Env } from '../../src/server/types';
import type { Context } from 'hono';

// Minimal in-memory KV implementing the get(json)/put/delete used by the cache.
function fakeKV() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string, _opts?: unknown) => {
      const v = store.get(k);
      return v === undefined ? null : JSON.parse(v);
    },
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  };
}

// Minimal Hono context: c.env, c.json (returns a tagged object we can inspect),
// and c.executionCtx.waitUntil (awaited so background refresh settles in tests).
function fakeCtx(env: Partial<Env>) {
  const pending: Promise<unknown>[] = [];
  const c = {
    env,
    json: (body: unknown) => ({ __body: body }) as unknown as Response,
    executionCtx: { waitUntil: (p: Promise<unknown>) => pending.push(p) },
    settle: () => Promise.all(pending),
  };
  return c as unknown as Context<{ Bindings: Env }> & { settle: () => Promise<unknown> };
}

function bodyOf(res: Response): unknown {
  return (res as unknown as { __body: unknown }).__body;
}

describe('cachedJson', () => {
  it('bypasses caching (always produces) when no CACHE namespace is bound', async () => {
    const c = fakeCtx({});
    const produce = vi.fn().mockResolvedValue({ n: 1 });
    const res = await cachedJson(c, 'k', 60, produce);
    expect(bodyOf(res)).toEqual({ n: 1 });
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it('stores on miss and serves from cache on the next call (no re-produce)', async () => {
    const kv = fakeKV();
    const c = fakeCtx({ CACHE: kv as unknown as Env['CACHE'] });
    const produce = vi.fn().mockResolvedValue({ n: 1 });

    const first = await cachedJson(c, 'k', 60, produce);
    expect(bodyOf(first)).toEqual({ n: 1 });
    expect(produce).toHaveBeenCalledTimes(1);

    const second = await cachedJson(c, 'k', 60, produce);
    expect(bodyOf(second)).toEqual({ n: 1 });
    expect(produce).toHaveBeenCalledTimes(1); // served from cache, not re-produced
  });

  it('serves stale immediately and refreshes in the background past the TTL', async () => {
    const kv = fakeKV();
    const c = fakeCtx({ CACHE: kv as unknown as Env['CACHE'] });

    // Seed a stale entry (storedAt far in the past) for the key.
    const key = cacheKey('dash', 'acc-1', 'current');
    kv.store.set(key, JSON.stringify({ storedAt: 0, body: { v: 'old' } }));

    const produce = vi.fn().mockResolvedValue({ v: 'new' });
    const res = await cachedJson(c, key, 60, produce);

    expect(bodyOf(res)).toEqual({ v: 'old' }); // stale served immediately
    expect(produce).toHaveBeenCalledTimes(1); // refresh kicked off
    await c.settle();
    const stored = JSON.parse(kv.store.get(key)!) as { body: unknown };
    expect(stored.body).toEqual({ v: 'new' }); // background refresh updated the cache
  });
});
