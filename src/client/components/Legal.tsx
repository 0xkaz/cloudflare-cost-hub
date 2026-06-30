import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Cloud } from 'lucide-react';

// Standalone, unauthenticated pages linked from the Cloudflare OAuth consent
// screen (policy_uri / tos_uri) so external users can read them before signing
// in. Intentionally simple and self-contained.
function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Link to="/" className="inline-flex items-center gap-2 text-lg font-semibold text-indigo-400">
          <Cloud className="h-6 w-6" />
          Cloudflare Cost Hub
        </Link>
        <h1 className="mt-8 text-3xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">Last updated: June 2026</p>
        <div className="legal mt-8 space-y-6 text-sm leading-relaxed text-slate-300">{children}</div>
        <footer className="mt-12 border-t border-slate-800 pt-6 text-xs text-slate-600">
          <Link to="/" className="text-slate-400 hover:text-slate-100">
            ← Back
          </Link>
          <span className="px-2">·</span>
          <Link to="/privacy" className="text-slate-400 hover:text-slate-100">
            Privacy
          </Link>
          <span className="px-2">·</span>
          <Link to="/terms" className="text-slate-400 hover:text-slate-100">
            Terms
          </Link>
        </footer>
      </div>
    </div>
  );
}

function H({ children }: { children: ReactNode }) {
  return <h2 className="text-lg font-semibold text-slate-100">{children}</h2>;
}

export function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Cloudflare Cost Hub (&ldquo;the app&rdquo;) is an open-source dashboard that helps you understand your
        Cloudflare usage and costs. This policy explains what data it accesses and how it is handled.
      </p>

      <div className="space-y-2">
        <H>What we access</H>
        <p>
          When you choose <em>Sign in with Cloudflare</em>, you authorize the app with <strong>read-only</strong>{' '}
          scopes. With that authorization the app reads your Cloudflare usage analytics and basic account metadata
          (account and resource names, and — if you grant it — your Cloudflare account email for display). The app{' '}
          <strong>never</strong> reads your website content or secrets, and never makes changes to your account.
        </p>
      </div>

      <div className="space-y-2">
        <H>How we use it</H>
        <p>
          Data is used solely to show your usage, free-tier status, estimated costs, trends and per-instance
          breakdowns, and to send the optional daily email digest you configure. We do not use it for advertising or
          profiling.
        </p>
      </div>

      <div className="space-y-2">
        <H>Storage</H>
        <p>
          Your Cloudflare OAuth tokens are <strong>encrypted at rest</strong> (AES-GCM). Daily usage snapshots are
          stored so cost history survives beyond Cloudflare&rsquo;s ~90-day analytics retention. Each user only ever
          sees the data for the Cloudflare account they connected.
        </p>
      </div>

      <div className="space-y-2">
        <H>Sharing</H>
        <p>
          We do not sell or share your data with third parties. Email alerts you enable are delivered through our
          email provider (Resend) only to the recipient address you configure.
        </p>
      </div>

      <div className="space-y-2">
        <H>Revoking access &amp; deletion</H>
        <p>
          You can disconnect at any time by signing out, and revoke the app entirely in Cloudflare under{' '}
          <em>My Profile → Access Management → Connected Applications</em>. To request deletion of stored snapshots,
          contact us (see below).
        </p>
      </div>

      <div className="space-y-2">
        <H>Self-hosting</H>
        <p>
          The app is open source. If you prefer full control, you can self-host it on your own Cloudflare account —
          see the project repository.
        </p>
      </div>

      <div className="space-y-2">
        <H>Contact</H>
        <p>
          Questions? Reach out via the project&rsquo;s GitHub repository or{' '}
          <a className="text-indigo-400 hover:text-indigo-300" href="https://ko-fi.com/0xkaz" target="_blank" rel="noreferrer">
            Ko-fi
          </a>
          .
        </p>
      </div>
    </LegalPage>
  );
}

export function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <p>By using Cloudflare Cost Hub (&ldquo;the app&rdquo;) you agree to these terms.</p>

      <div className="space-y-2">
        <H>Provided as-is</H>
        <p>
          The app is free and open source, licensed under the MIT License, and provided <strong>&ldquo;as is&rdquo;</strong>{' '}
          without warranty of any kind. The hosted instance is offered on a best-effort basis with no uptime
          guarantee and may change or be discontinued at any time.
        </p>
      </div>

      <div className="space-y-2">
        <H>Read-only access</H>
        <p>
          The app only reads analytics from the Cloudflare account you connect. You remain solely responsible for
          your Cloudflare account, its configuration, and its charges.
        </p>
      </div>

      <div className="space-y-2">
        <H>Cost estimates</H>
        <p>
          All cost figures are <strong>estimates</strong> based on published Cloudflare pricing and may differ from
          your actual invoice. They are not a billing source of truth — always verify against your Cloudflare bill.
        </p>
      </div>

      <div className="space-y-2">
        <H>Donations</H>
        <p>
          Optional contributions (e.g. via Ko-fi) are voluntary and non-refundable. They are donations to support
          the project and do not entitle you to support, features, or any guarantee of service.
        </p>
      </div>

      <div className="space-y-2">
        <H>Not affiliated with Cloudflare</H>
        <p>This project is independent and not affiliated with, endorsed by, or sponsored by Cloudflare, Inc.</p>
      </div>
    </LegalPage>
  );
}
