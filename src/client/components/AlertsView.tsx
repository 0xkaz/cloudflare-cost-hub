import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';

interface AlertSettings {
  email: string;
  enabled: boolean;
  plan: 'free' | 'paid';
  paidUntil: string | null;
  requiresPayment: boolean;
  entitled: boolean;
}

export function AlertsView() {
  const [email, setEmail] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [plan, setPlan] = useState<AlertSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/alerts', { credentials: 'same-origin' })
      .then((res) => (res.ok ? (res.json() as Promise<AlertSettings>) : null))
      .then((d) => {
        if (!d) return;
        setEmail(d.email);
        setEnabled(d.enabled);
        setPlan(d);
      })
      .catch(() => undefined);
  }, []);

  const save = async (next?: { enabled?: boolean }) => {
    const nextEnabled = next?.enabled ?? enabled;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/settings/alerts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, enabled: nextEnabled }),
      });
      setMsg(res.ok ? 'Saved.' : 'Invalid email.');
    } catch {
      setMsg('Failed to save.');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 4000);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch('/api/dashboard/alert-test', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = (await res.json()) as { sent?: boolean; reason?: string };
      setTestMsg(res.ok && body.sent ? 'Test alert sent.' : `Not sent: ${body.reason || 'error'}`);
    } catch {
      setTestMsg('Failed to send alert.');
    } finally {
      setTesting(false);
      setTimeout(() => setTestMsg(null), 5000);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Email Alerts</h2>
        <p className="text-sm text-slate-400">
          A daily digest is emailed when any metric is billable, nears its free-tier limit, or your
          forecast crosses a budget.
        </p>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Mail className="h-5 w-5 text-indigo-400" />
          Daily digest
        </div>

        {plan?.requiresPayment && !plan.entitled && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Automated daily alerts are a paid feature (~$10–12/year). You can still send a test
            alert below; the scheduled digest resumes once your plan is active.
          </div>
        )}

        <label className="mb-2 flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              void save({ enabled: e.target.checked });
            }}
            className="h-4 w-4 rounded border-slate-600 bg-slate-950"
          />
          Send me the daily digest
        </label>

        <label className="mb-1 block text-sm font-medium text-slate-300">Recipient email</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com (comma-separate for multiple)"
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
          <button
            onClick={() => void save()}
            disabled={saving}
            className="btn-primary gap-2 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {msg && <span className="text-xs text-slate-400">{msg}</span>}

        <div className="mt-3">
          <button
            onClick={sendTest}
            disabled={testing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-60"
          >
            <Mail className="h-4 w-4" />
            {testing ? 'Sending…' : 'Send test alert'}
          </button>
          {testMsg && <span className="ml-3 text-sm text-slate-300">{testMsg}</span>}
        </div>
      </div>
    </div>
  );
}
