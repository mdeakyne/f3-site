# f3-site

Static site for **F3 Lawrence** — backblast archive, PAX leaderboard, Q
calendar, and Q signup form. Sibling repo to `Notion-Obsidian`, which owns
the content pipeline (Notion → Obsidian → SQLite → `content/`).

Stack: Astro 6 (static output) + Tailwind 4 + Cloudflare Pages + D1 + Pages
Functions. All on the Cloudflare free tier.

## Local dev

```sh
npm ci
npm run dev        # astro dev on :4321
npm run build      # → ./dist
npm run preview    # wrangler pages dev ./dist (runs the Function + D1 locally)
```

Content lives in `./content/` and is produced by `nob export-site` in the
Notion-Obsidian repo. Re-run it whenever the vault changes:

```sh
cd ../Notion-Obsidian
.venv/bin/python -m nob.cli export-site
```

## Initial Cloudflare setup (one time)

1. Install + login: `npm i -g wrangler && wrangler login`
2. Create the D1 database:
   ```sh
   wrangler d1 create f3-signups
   # paste the returned database_id into wrangler.toml
   wrangler d1 migrations apply f3-signups --remote
   ```
3. Create the Pages project in the Cloudflare dashboard (Pages → Create →
   name `f3-site`) and bind the D1 database to it: Pages → f3-site → Settings
   → Functions → D1 bindings → name `DB`, database `f3-signups`.
4. Set Turnstile secret:
   ```sh
   npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name f3-site
   ```
   The public site key is compiled into the contact and Q form controllers.
5. GitHub Actions secrets (repo → Settings → Secrets):
   - `CLOUDFLARE_API_TOKEN` — token scoped to Cloudflare Pages:Edit and
     Workers Scripts:Edit so one workflow can publish both runtimes
   - `CLOUDFLARE_ACCOUNT_ID`
6. Custom domain: Pages → f3-site → Custom domains → add the domain.

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds once and
deploys both Pages and the scheduled Q publisher from the same revision.

## Signup flow

The Turnstile-protected `/api/q-signup` endpoint atomically claims an AO/date
in D1 `q_claims`. Signup and calendar pages fetch current public claims from
`/api/q-signups`; no approval or rebuild is required. Pre-blasts post through
a Slack bot at 4 PM Chicago the preceding day, or immediately for late claims.
A separate scheduled Worker shares the Pages D1 database. The legacy
`q_signups` table remains an untouched archive; `nob pull-signups` is retired
for new claims.

See [Q signup deployment](docs/q-signup-deployment.md) for the coupled
Pages/Worker rollout, secrets, channel access, reconciliation, and recovery.
