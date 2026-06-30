import { useEffect, useState } from 'react';
import { Key, Cloud, Camera, CheckCircle2 } from 'lucide-react';

interface ConfiguredAccount {
  name: string;
  accountId: string;
  tokenConfigured: boolean;
  plan?: { workersPaid: boolean; r2Paid: boolean; plans: string[]; accessible: boolean };
}

interface CfConnection {
  connected: boolean;
  accountId?: string;
  accountName?: string;
  oauthAvailable: boolean;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 py-2 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-200">{value}</span>
    </div>
  );
}

export function Settings() {
  const [account, setAccount] = useState<ConfiguredAccount | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);
  const [conn, setConn] = useState<CfConnection | null>(null);

  useEffect(() => {
    fetch('/api/settings/account', { credentials: 'same-origin' })
      .then((res) => (res.ok ? (res.json() as Promise<ConfiguredAccount>) : null))
      .then(setAccount)
      .catch(() => undefined);
    fetch('/api/auth/cf/status', { credentials: 'same-origin' })
      .then((res) => (res.ok ? (res.json() as Promise<CfConnection>) : null))
      .then(setConn)
      .catch(() => undefined);
  }, []);

  const captureSnapshot = async () => {
    setCapturing(true);
    setCaptureMsg(null);
    try {
      const res = await fetch('/api/dashboard/snapshot', {
        method: 'POST',
        credentials: 'same-origin',
      });
      setCaptureMsg(res.ok ? 'Cost history updated.' : 'Snapshot failed.');
    } catch {
      setCaptureMsg('Snapshot failed.');
    } finally {
      setCapturing(false);
      setTimeout(() => setCaptureMsg(null), 4000);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-sm text-slate-400">
          Account, plan, and data — configured on the server via Worker secrets.
        </p>
      </div>

      <div className="card">
        <div className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Cloud className="h-5 w-5 text-indigo-400" />
          Cloudflare Account
          {conn?.connected && (
            <span className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Connected via OAuth
            </span>
          )}
        </div>
        <Row label="Account name" value={account?.name || '—'} />
        <Row
          label="Account ID"
          value={<span className="font-mono text-xs">{account?.accountId || '—'}</span>}
        />
        <Row
          label="API token"
          value={
            account?.tokenConfigured ? (
              <span className="flex items-center gap-1 text-emerald-400">
                <Key className="h-3.5 w-3.5" /> Configured
              </span>
            ) : (
              <span className="text-amber-400">Not configured</span>
            )
          }
        />
      </div>

      {/* Only shown when subscriptions are actually readable. OAuth tokens lack a
          billing scope, so plan detection is impossible there — hide the card
          entirely rather than show a misleading "no paid plans". */}
      {account?.plan?.accessible && (
        <div className="card">
          <div className="mb-1 text-lg font-semibold">Detected Plan</div>
          <p className="mb-3 text-xs text-slate-500">
            Auto-detected from your Cloudflare subscriptions. Cost estimates use the included
            allowances of these plans.
          </p>
          {account.plan.plans.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {account.plan.plans.map((p) => (
                <span
                  key={p}
                  className="rounded-full bg-indigo-500/10 px-3 py-1 text-sm font-medium text-indigo-300"
                >
                  {p}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              No paid subscriptions detected — usage is bounded by free-tier hard limits.
            </p>
          )}
        </div>
      )}

      <div className="card">
        <div className="mb-1 text-lg font-semibold">Cost History</div>
        <p className="mb-3 text-xs text-slate-500">
          The <span className="text-slate-300">Monthly Cost Trend</span> chart is built from daily
          snapshots, which also preserve history beyond Cloudflare&apos;s ~90 day analytics window.
          Snapshots run automatically every day — use this to fill the chart immediately instead of
          waiting for the next daily run.
        </p>
        <button
          onClick={captureSnapshot}
          disabled={capturing}
          className="btn-primary gap-2 disabled:opacity-60"
        >
          <Camera className="h-4 w-4" />
          {capturing ? 'Backfilling…' : 'Backfill cost history now'}
        </button>
        {captureMsg && (
          <span className="ml-3 inline-flex items-center gap-1 text-sm text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            {captureMsg}
          </span>
        )}
      </div>
    </div>
  );
}
