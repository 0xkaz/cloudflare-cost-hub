import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { evaluateBudget } from '../../src/server/budgets';
import { createTestD1, type TestD1 } from '../helpers/d1';
import { getBudget, setBudget, deleteBudget } from '../../src/server/db/budgets';

describe('evaluateBudget', () => {
  it('reports within budget below 80%', () => {
    expect(evaluateBudget(100, 50)).toEqual({
      limit: 100,
      forecast: 50,
      percentage: 50,
      nearing: false,
      exceeded: false,
    });
  });

  it('flags nearing at >= 80% but not over', () => {
    const s = evaluateBudget(100, 85);
    expect(s.nearing).toBe(true);
    expect(s.exceeded).toBe(false);
    expect(s.percentage).toBe(85);
  });

  it('flags exceeded above the limit', () => {
    const s = evaluateBudget(100, 130);
    expect(s.exceeded).toBe(true);
    expect(s.nearing).toBe(true);
    expect(s.percentage).toBe(130);
  });

  it('handles a zero limit without dividing by zero', () => {
    const s = evaluateBudget(0, 10);
    expect(s.percentage).toBe(0);
    expect(s.exceeded).toBe(true); // any spend exceeds a zero budget
  });
});

describe('budgets DB', () => {
  let t: TestD1;
  beforeEach(() => {
    t = createTestD1();
  });
  afterEach(() => t.close());

  it('upserts and reads a per-account budget', async () => {
    expect(await getBudget(t.db, 'u1', 'acc-1')).toBeNull();
    await setBudget(t.db, 'u1', 'acc-1', 25);
    expect(await getBudget(t.db, 'u1', 'acc-1')).toEqual({ monthlyLimit: 25 });
    await setBudget(t.db, 'u1', 'acc-1', 40); // upsert
    expect(await getBudget(t.db, 'u1', 'acc-1')).toEqual({ monthlyLimit: 40 });
  });

  it('keeps budgets isolated per account and supports delete', async () => {
    await setBudget(t.db, 'u1', 'acc-1', 25);
    await setBudget(t.db, 'u1', 'acc-2', 99);
    expect(await getBudget(t.db, 'u1', 'acc-2')).toEqual({ monthlyLimit: 99 });

    await deleteBudget(t.db, 'u1', 'acc-1');
    expect(await getBudget(t.db, 'u1', 'acc-1')).toBeNull();
    expect(await getBudget(t.db, 'u1', 'acc-2')).toEqual({ monthlyLimit: 99 });
  });
});
