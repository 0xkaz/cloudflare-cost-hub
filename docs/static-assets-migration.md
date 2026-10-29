# Moving the SPA from Workers Sites to Workers Static Assets

This branch serves `dist/client` with Workers Static Assets instead of Workers Sites (KV + `@cloudflare/kv-asset-handler`).
Static files are then served without running the Worker and without KV reads; only `/api/*` and `/health` run the Worker
(`run_worker_first`), so the OAuth callback, a browser navigation, still reaches the API instead of `index.html`.

Checked locally with `wrangler dev`: pages and client-side routes return `index.html`, hashed `/assets/*` carry
`Cache-Control: public, max-age=31536000, immutable` (`public/_headers`), `/health` 200, `/api/auth/me` 401,
`/api/nope` 404 JSON, `/api/auth/cf/callback` 302.

## Why it is on a branch

The asset upload authenticates with a per-upload JWT. Claude's cloud environment routes `api.cloudflare.com` through a
proxy that replaces the Authorization header with the account token, so the upload fails there with 401. Once this is
deployed, every deploy that changes a client bundle has to be run from a machine with a direct Cloudflare login.

## Deploy (from your own machine)

1. `git checkout claude/static-assets-migration && npm ci`
2. In your local `wrangler.toml`, replace the `[site]` block with the `[assets]` block of `wrangler.example.toml`.
3. `npm run deploy`
4. Check `/`, `/alerts`, a file under `/assets/`, sign-in with Cloudflare, and the Alerts page.
5. Merge the branch into `master`.

Rollback: check out `master` before the merge, put the `[site]` block back, `npm run deploy`.

Afterwards the KV namespace `__cloudflare-cost-hub-workers_sites_assets` is no longer used and can be deleted.
