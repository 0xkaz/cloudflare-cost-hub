// The account watch of the daily digest, on the command line (JSON on stdout): failing Workers / crons, stopped D1
// databases and silent Workers, and the top Workers / D1 / KV / AI / R2 with jumps (the day vs the 7 days before).
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run watch:report [-- --day YYYY-MM-DD]
//   (Claude cloud sessions: NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt CLOUDFLARE_API_TOKEN=proxy-injected)
// --day reaches back WATCH_MAX_DAYS_BACK days, like the Alerts page. Read-only.
import { fetchWatchReport, watchNowFor, WATCH_MAX_DAYS_BACK } from '../src/server/watch';

const args = process.argv.slice(2);
const day = args.includes('--day') ? args[args.indexOf('--day') + 1] : undefined;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !apiToken) {
  console.error('set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  process.exit(2);
}
const now = watchNowFor(day);
if (!now) {
  console.error(`--day must be one of the last ${WATCH_MAX_DAYS_BACK + 1} complete UTC days (YYYY-MM-DD)`);
  process.exit(2);
}
const report = await fetchWatchReport({ accountId, apiToken, name: accountId }, now);
console.log(JSON.stringify(report, null, 1));
