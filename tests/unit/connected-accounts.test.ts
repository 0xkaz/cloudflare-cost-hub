import { describe, it, expect } from 'vitest';
import { listConnectedAccounts } from '../../src/server/cf-oauth';
import type { Env } from '../../src/server/types';

// Minimal D1 stub: only the listAllCfTokens SELECT is exercised, so return a
// fixed result set regardless of the SQL/bindings.
function envWithTokenRows(rows: Array<Record<string, unknown>>): Env {
  const db = {
    prepare: () => ({
      bind: () => ({ all: async () => ({ results: rows }) }),
      all: async () => ({ results: rows }),
      first: async () => null,
      run: async () => ({}),
    }),
  };
  return { DB: db } as unknown as Env;
}

describe('listConnectedAccounts', () => {
  it('deduplicates an account authorized by multiple users, keeping the first user', async () => {
    const env = envWithTokenRows([
      {
        user_id: 'userA',
        account_id: 'acc-1',
        account_name: 'Alpha',
        access_token: 'x',
        refresh_token: null,
        expires_at: null,
        scope: null,
        accounts: JSON.stringify([
          { id: 'acc-1', name: 'Alpha' },
          { id: 'acc-2', name: 'Beta' },
        ]),
      },
      {
        user_id: 'userB',
        account_id: 'acc-1',
        account_name: 'Alpha',
        access_token: 'y',
        refresh_token: null,
        expires_at: null,
        scope: null,
        accounts: JSON.stringify([{ id: 'acc-1', name: 'Alpha' }]),
      },
    ]);

    const accounts = await listConnectedAccounts(env);

    expect(accounts).toHaveLength(2);
    const acc1 = accounts.find((a) => a.accountId === 'acc-1');
    expect(acc1?.userId).toBe('userA'); // first user who authorized it wins
    expect(accounts.map((a) => a.accountId).sort()).toEqual(['acc-1', 'acc-2']);
  });

  it('falls back to the active account when the accounts list is absent (legacy row)', async () => {
    const env = envWithTokenRows([
      {
        user_id: 'userC',
        account_id: 'acc-9',
        account_name: 'Legacy',
        access_token: 'z',
        refresh_token: null,
        expires_at: null,
        scope: null,
        accounts: null,
      },
    ]);

    const accounts = await listConnectedAccounts(env);

    expect(accounts).toEqual([{ accountId: 'acc-9', name: 'Legacy', userId: 'userC' }]);
  });
});
