import { describe, it, expect } from 'vitest';
import { resolveCloudflareAccount } from '../../src/server/cf-oauth';
import type { Env } from '../../src/server/types';

// D1 stub whose token lookup (.bind().first()) always returns null, i.e. the
// user has no connected Cloudflare account.
function envNoToken(extra: Partial<Env> = {}): Env {
  const db = {
    prepare: () => ({
      bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }),
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({}),
    }),
  };
  return {
    DB: db,
    // Make oauthConfigured(env) true so we exercise the real per-user branch.
    CF_OAUTH_CLIENT_ID: 'client-id',
    TOKEN_ENC_KEY: 'enc-key',
    // An env-configured account that must NOT leak to signed-in users.
    CF_ANALYTICS_TOKEN: 'env-token',
    CF_ACCOUNT_ID: 'env-account',
    CF_ACCOUNT_NAME: 'Operator Account',
    ...extra,
  } as unknown as Env;
}

describe('resolveCloudflareAccount tenant isolation', () => {
  it('returns null for a signed-in user with no connected account (never the env account)', async () => {
    const account = await resolveCloudflareAccount(envNoToken(), 'some-user');
    expect(account).toBeNull(); // must NOT fall back to the operator's env account
  });

  it('uses the env-configured account only for the no-user (scheduled) path', async () => {
    const account = await resolveCloudflareAccount(envNoToken(), undefined);
    expect(account).toEqual({
      accountId: 'env-account',
      apiToken: 'env-token',
      name: 'Operator Account',
    });
  });
});
