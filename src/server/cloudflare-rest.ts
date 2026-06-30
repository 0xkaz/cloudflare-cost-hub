import type { CloudflareAccountInput } from './cloudflare-api';
import { fetchWithRetry } from './http';

const REST_BASE = 'https://api.cloudflare.com/client/v4';

interface ListResponse<T> {
  success: boolean;
  result?: T[];
}

async function listAll<T>(
  account: CloudflareAccountInput,
  path: string
): Promise<T[]> {
  const res = await fetchWithRetry(`${REST_BASE}/accounts/${account.accountId}/${path}?per_page=1000`, {
    headers: { Authorization: `Bearer ${account.apiToken}` },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as ListResponse<T>;
  return json.success && json.result ? json.result : [];
}

export interface AccountPlan {
  workersPaid: boolean;
  r2Paid: boolean;
  plans: string[]; // public names of active paid subscriptions
  // Whether the subscriptions endpoint was actually readable. OAuth tokens lack
  // a billing scope, so this is false for OAuth-connected accounts — letting the
  // UI distinguish "no paid plans" from "couldn't read your plan".
  accessible: boolean;
}

// Detect the account's active paid subscriptions so cost estimates and the UI
// can reflect the real plan instead of assuming one.
export async function getAccountPlan(account: CloudflareAccountInput): Promise<AccountPlan> {
  const res = await fetchWithRetry(`${REST_BASE}/accounts/${account.accountId}/subscriptions?per_page=1000`, {
    headers: { Authorization: `Bearer ${account.apiToken}` },
  });
  if (!res.ok) {
    // 401/403 means the token can't read billing; anything else is also a
    // non-answer. Report "not accessible" rather than a false "no paid plans".
    return { workersPaid: false, r2Paid: false, plans: [], accessible: false };
  }
  const json = (await res.json()) as {
    success: boolean;
    result?: Array<{ rate_plan?: { id?: string; public_name?: string } }>;
  };
  const subs = json.success && json.result ? json.result : [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const s of subs) {
    const id = s.rate_plan?.id;
    if (id) ids.add(id);
    const name = s.rate_plan?.public_name;
    if (name && id && id !== 'free') names.add(name);
  }
  return {
    workersPaid: ids.has('workers_paid'),
    r2Paid: ids.has('r2_paid'),
    plans: [...names],
    accessible: true,
  };
}

// Resolve instance ids to human-readable names for a given instance type.
// Returns an id -> name map; ids that can't be resolved are simply absent and
// the caller falls back to showing the raw id.
export async function resolveInstanceNames(
  account: CloudflareAccountInput,
  instanceLabel: string
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    if (instanceLabel === 'database') {
      const rows = await listAll<{ uuid?: string; id?: string; name: string }>(account, 'd1/database');
      for (const r of rows) {
        const id = r.uuid || r.id;
        if (id) map[id] = r.name;
      }
    } else if (instanceLabel === 'namespace') {
      const rows = await listAll<{ id: string; title: string }>(account, 'storage/kv/namespaces');
      for (const r of rows) map[r.id] = r.title;
    } else if (instanceLabel === 'queue') {
      const rows = await listAll<{ queue_id: string; queue_name: string }>(account, 'queues');
      for (const r of rows) map[r.queue_id] = r.queue_name;
    }
    // script / bucket / model / project ids are already human-readable.
  } catch {
    // Resolution is best-effort; fall back to raw ids.
  }
  return map;
}
