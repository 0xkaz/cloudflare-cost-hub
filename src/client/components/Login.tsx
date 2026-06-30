import { Link } from 'react-router-dom';
import { Cloud, BarChart3, Layers, Bell, Wallet, TrendingUp, ShieldCheck, Github, Heart } from 'lucide-react';

// Open-source repo + donation link. Update if the repo/handle changes; set to ''
// to hide the corresponding link.
const GITHUB_URL = 'https://github.com/0xkaz/cloudflare-cost-hub';
const SUPPORT_URL = 'https://ko-fi.com/0xkaz';

const FEATURES = [
  { icon: BarChart3, title: 'Every service, one view', desc: 'Workers, D1, KV, R2, Pages, Durable Objects, Queues & Workers AI usage at a glance.' },
  { icon: Wallet, title: 'Free tier vs paid plan', desc: 'See what is within the free tier, within your paid allowance, or actually billable.' },
  { icon: Layers, title: 'Per-instance breakdown', desc: 'Find which database, bucket or namespace is driving a quota — ranked by cost.' },
  { icon: TrendingUp, title: 'Cost trends & forecast', desc: 'Daily snapshots keep history beyond Cloudflare’s 90-day window, with month-end forecasts.' },
  { icon: Bell, title: 'Email alerts', desc: 'A daily digest when something becomes billable or nears a free-tier limit.' },
  { icon: ShieldCheck, title: 'Read-only & secure', desc: 'Sign in with Cloudflare — read-only analytics access, tokens encrypted at rest.' },
];

function SignInButton({ size = 'lg' }: { size?: 'lg' | 'sm' }) {
  return (
    <a
      href="/api/auth/cf/login"
      className={`btn-primary gap-2 ${size === 'lg' ? 'px-6 py-3 text-base' : ''}`}
    >
      <svg className="h-5 w-5" viewBox="0 0 48 48" fill="currentColor" aria-hidden="true">
        <path d="M34 30c.4-1.3.3-2.6-.4-3.6-.6-1-1.7-1.6-2.9-1.7l-22-.3c-.2 0-.3-.1-.4-.2 0-.1-.1-.3 0-.4 0-.2.2-.4.5-.4l22.2-.3c2.6-.1 5.4-2.2 6.4-4.7l1.3-3.3c0-.1.1-.2 0-.3C37 6.8 31.4 2.5 24.8 2.5c-6.1 0-11.3 3.9-13.2 9.4-1.2-.9-2.8-1.4-4.5-1.2C4 11 1.7 13.3 1.4 16.2c-.1.7 0 1.4.2 2.1C2 18.2.9 19.8.9 21.6.9 24 2.9 26 5.3 26h27.6c.3 0 .6-.2.7-.5L34 30z" />
      </svg>
      Sign in with Cloudflare
    </a>
  );
}

export function Login() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-950 to-indigo-950/40 text-slate-100">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-semibold text-indigo-400">
            <Cloud className="h-6 w-6" />
            Cloudflare Cost Hub
          </div>
          <div className="flex items-center gap-4">
            {GITHUB_URL && (
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-100"
              >
                <Github className="h-4 w-4" />
                <span className="hidden sm:inline">GitHub</span>
              </a>
            )}
            <div className="hidden sm:block">
              <SignInButton size="sm" />
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-3xl pt-16 text-center sm:pt-24">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-xs text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Live usage & cost insight for your Cloudflare account
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Know exactly what your{' '}
            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              Cloudflare usage
            </span>{' '}
            costs
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-slate-400 sm:text-lg">
            Monitor free-tier limits, estimate paid-plan costs, spot the instances driving your bill,
            and get alerted before usage becomes billable — all in one dashboard.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <SignInButton />
            <span className="text-xs text-slate-500">
              Read-only access · tokens encrypted · revoke anytime in Cloudflare
            </span>
            <span className="text-xs text-slate-500">
              Free &amp; open source — self-host it yourself, or use this hosted instance.
            </span>
          </div>
        </section>

        <section className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 transition-colors hover:border-slate-700"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600/15 text-indigo-400">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold text-slate-100">{f.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">{f.desc}</p>
            </div>
          ))}
        </section>

        <footer className="mt-20 border-t border-slate-800 pt-6 text-center text-xs text-slate-600">
          <div className="mb-3 flex items-center justify-center gap-5">
            {GITHUB_URL && (
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-slate-400 hover:text-slate-100"
              >
                <Github className="h-4 w-4" />
                Open source on GitHub
              </a>
            )}
            {SUPPORT_URL && (
              <a
                href={SUPPORT_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-pink-300/80 hover:text-pink-300"
              >
                <Heart className="h-4 w-4" />
                Support on Ko-fi
              </a>
            )}
          </div>
          <div className="mb-2 flex items-center justify-center gap-4">
            <Link to="/privacy" className="text-slate-500 hover:text-slate-300">
              Privacy
            </Link>
            <Link to="/terms" className="text-slate-500 hover:text-slate-300">
              Terms
            </Link>
          </div>
          Cloudflare Cost Hub · MIT licensed · Not affiliated with Cloudflare, Inc.
        </footer>
      </div>
    </div>
  );
}
