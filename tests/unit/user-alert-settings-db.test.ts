import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestD1, type TestD1 } from '../helpers/d1';
import {
  upsertUserAlertSetting,
  getUserAlertSetting,
  listEnabledAlertSettings,
} from '../../src/server/db/user-alert-settings';

let t: TestD1;
beforeEach(() => {
  t = createTestD1();
});
afterEach(() => t.close());

describe('user_alert_settings', () => {
  it('round-trips recipient + enabled, defaulting to the free plan', async () => {
    await upsertUserAlertSetting(t.db, 'u1', { email: 'a@x.com', enabled: true });
    const s = await getUserAlertSetting(t.db, 'u1');
    expect(s).toMatchObject({ userId: 'u1', email: 'a@x.com', enabled: true, plan: 'free', paidUntil: null });
  });

  it('lists only enabled users', async () => {
    await upsertUserAlertSetting(t.db, 'u1', { email: 'a@x.com', enabled: true });
    await upsertUserAlertSetting(t.db, 'u2', { email: 'b@x.com', enabled: false });
    const enabled = await listEnabledAlertSettings(t.db);
    expect(enabled.map((s) => s.userId)).toEqual(['u1']);
  });
});
