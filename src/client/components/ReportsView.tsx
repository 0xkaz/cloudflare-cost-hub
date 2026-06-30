import { FileText, Download } from 'lucide-react';

function ReportRow({
  title,
  description,
  href,
  filename,
}: {
  title: string;
  description: string;
  href: string;
  filename: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-800 py-4 last:border-0">
      <div>
        <div className="font-medium text-slate-100">{title}</div>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <a
        href={href}
        download={filename}
        className="btn-primary inline-flex shrink-0 items-center gap-2"
      >
        <Download className="h-4 w-4" />
        CSV
      </a>
    </div>
  );
}

export function ReportsView() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Reports</h2>
        <p className="text-sm text-slate-400">
          Export your usage and cost data as CSV for spreadsheets, finance, or archival.
        </p>
      </div>

      <div className="card">
        <div className="mb-2 flex items-center gap-2 text-lg font-semibold">
          <FileText className="h-5 w-5 text-indigo-400" />
          Exports
        </div>
        <ReportRow
          title="Monthly cost history"
          description="Estimated cost and forecast per month, from stored snapshots."
          href="/api/reports/cost-history.csv"
          filename="cost-history.csv"
        />
        <ReportRow
          title="Current usage status"
          description="Per-product usage vs free-tier limits and estimated cost, this month."
          href="/api/reports/usage.csv"
          filename="usage.csv"
        />
      </div>
    </div>
  );
}
