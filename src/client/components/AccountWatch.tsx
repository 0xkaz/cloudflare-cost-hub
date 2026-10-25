import { useEffect, useState } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';

// Same report as the "Account watch" section of the daily digest (GET /api/dashboard/watch): Workers / cron
// schedules failing yesterday (UTC) and the top Workers / D1 databases with jumps against the previous week.
interface FailingWorker { script: string; cron?: string; requests: number; errors: number; share: number; statuses: Record<string, number> }
interface Consumer { name: string; value: number; prevAvg: number; spike: boolean }
interface WatchReport {
  day: string; failing: FailingWorker[]; cronRuns?: number; workersCpu: Consumer[]; workersRequests: Consumer[]; d1Written: Consumer[]; d1Read: Consumer[];
  kvReads?: Consumer[]; aiNeurons?: Consumer[]; r2Storage?: Consumer[];
}

const fmt = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : n.toFixed(n < 10 ? 1 : 0);

function ConsumerTable({ title, unit, rows }: { title: string; unit: string; rows?: Consumer[] }) {
  if (!rows?.length) return null;
  return (
    <div>
      <div className="mb-1 text-sm font-medium text-slate-300">{title}</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500">
            <th className="py-1 text-left font-normal">name</th>
            <th className="py-1 text-right font-normal">yesterday</th>
            <th className="py-1 text-right font-normal">prev. 7-day avg</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.name} className="border-t border-slate-800">
              <td className="py-1 text-slate-200">{c.spike ? '🔺 ' : ''}{c.name}</td>
              <td className="py-1 text-right text-slate-200">{fmt(c.value)}{unit}</td>
              <td className="py-1 text-right text-slate-500">{fmt(c.prevAvg)}{unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AccountWatch() {
  const [report, setReport] = useState<WatchReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/dashboard/watch', { credentials: 'same-origin' })
      .then(async (res) => {
        const body = (await res.json()) as WatchReport & { error?: string; detail?: string };
        if (!res.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`);
        setReport(body);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="card">
      <div className="mb-1 flex items-center gap-2 text-lg font-semibold">
        <Activity className="h-5 w-5 text-indigo-400" />
        Account watch{report ? ` (${report.day} UTC)` : ''}
      </div>
      <p className="mb-3 text-xs text-slate-400">
        Also in the daily digest. 🔺 = 3x or more of the previous-week average.
      </p>
      {error && <div className="text-sm text-red-400">Could not load: {error}</div>}
      {!report && !error && <div className="text-sm text-slate-500">Loading…</div>}
      {report && (
        <div className="space-y-4">
          {report.failing.length > 0 ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-red-300">
                <AlertTriangle className="h-4 w-4" /> Failing on {report.day}
              </div>
              {report.failing.map((w) => (
                <div key={`${w.script}|${w.cron ?? ''}`} className="text-sm text-slate-200">
                  {w.script}{w.cron ? ` (cron ${w.cron})` : ''} — {w.errors} / {w.requests} {w.cron ? 'runs' : 'invocations'} failed ({Math.round(w.share * 100)}%)
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-emerald-400">No failing Workers{report.cronRuns === 0 ? '' : ' or cron schedules'}.</div>
          )}
          {report.cronRuns === 0 && (
            <div className="text-xs text-amber-400">
              Cloudflare reported no cron runs for this day, so failing cron schedules cannot be detected (Workers are still checked by their overall error rate).
            </div>
          )}
          <ConsumerTable title="Workers by CPU" unit=" s" rows={report.workersCpu} />
          <ConsumerTable title="Workers by requests" unit="" rows={report.workersRequests} />
          <ConsumerTable title="D1 rows written" unit="" rows={report.d1Written} />
          <ConsumerTable title="D1 rows read" unit="" rows={report.d1Read} />
          <ConsumerTable title="KV reads" unit="" rows={report.kvReads} />
          <ConsumerTable title="Workers AI neurons" unit="" rows={report.aiNeurons} />
          <ConsumerTable title="R2 storage" unit=" GB" rows={report.r2Storage} />
        </div>
      )}
    </div>
  );
}
