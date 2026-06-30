import { useEffect, useState } from 'react';
import { Wallet, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api, type BudgetView as BudgetData } from '../api';

function statusColor(b: BudgetData['status']): string {
  if (!b) return '#64748b';
  if (b.exceeded) return '#f87171';
  if (b.nearing) return '#fbbf24';
  return '#34d399';
}

export function BudgetView() {
  const [data, setData] = useState<BudgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .getBudget()
      .then((d) => {
        setData(d);
        setInput(d.monthlyLimit != null ? String(d.monthlyLimit) : '');
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const save = async () => {
    const limit = Number(input);
    if (!Number.isFinite(limit) || limit <= 0) {
      setMsg('Enter a positive amount.');
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await api.setBudget(limit);
      setMsg('Budget saved.');
      load();
    } catch {
      setMsg('Failed to save.');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await api.clearBudget();
      setInput('');
      load();
    } finally {
      setSaving(false);
    }
  };

  const status = data?.status ?? null;
  const pct = status ? Math.min(status.percentage, 100) : 0;
  const color = statusColor(status);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Budgets</h2>
        <p className="text-sm text-slate-400">
          Set a monthly spend budget for {data?.accountName || 'this account'}. The daily alert
          warns you when the month-end forecast nears or exceeds it.
        </p>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-slate-500">Loading…</div>
      ) : !data ? (
        <div className="card text-sm text-amber-400">
          Connect a Cloudflare account to set a budget.
        </div>
      ) : (
        <>
          <div className="card">
            <div className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <Wallet className="h-5 w-5 text-indigo-400" />
              Monthly budget
            </div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Limit (USD / month)</label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="text-slate-400">$</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="50"
                  className="w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-60">
                {saving ? 'Saving…' : 'Save budget'}
              </button>
              {data.monthlyLimit != null && (
                <button
                  onClick={clear}
                  disabled={saving}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
                >
                  Clear
                </button>
              )}
              {msg && <span className="text-xs text-slate-400">{msg}</span>}
            </div>
          </div>

          {status && (
            <div className="card">
              <div className="mb-2 flex items-center gap-2 text-lg font-semibold">
                {status.exceeded ? (
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                ) : (
                  <CheckCircle2 className="h-5 w-5" style={{ color }} />
                )}
                Forecast vs budget
              </div>
              <div className="mb-2 flex items-end justify-between text-sm">
                <span className="text-slate-400">
                  Month-end forecast: <span className="font-semibold text-slate-100">${status.forecast.toFixed(2)}</span>
                </span>
                <span className="text-slate-400">
                  Budget: <span className="font-semibold text-slate-100">${status.limit.toFixed(2)}</span>
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
              </div>
              <p className="mt-2 text-sm" style={{ color }}>
                {status.exceeded
                  ? `Over budget — forecast is ${status.percentage}% of the limit.`
                  : status.nearing
                    ? `Nearing budget — ${status.percentage}% of the limit.`
                    : `Within budget — ${status.percentage}% of the limit.`}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
