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
   wrangler pages secret put TURNSTILE_SECRET --project-name f3-site
   ```
   Paste the Turnstile site key into `src/pages/signup/index.astro`
   (`data-sitekey`).
5. GitHub Actions secrets (repo → Settings → Secrets):
   - `CLOUDFLARE_API_TOKEN` — token scoped to Pages:Edit
   - `CLOUDFLARE_ACCOUNT_ID`
6. Custom domain: Pages → f3-site → Custom domains → add the domain.

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds and
deploys via `wrangler pages deploy`.

## Signup flow

1. Visitor posts the form → `/api/q-signup`
   (`functions/api/q-signup.ts`).
2. Function: Turnstile check → per-IP rate-limit (5/day) → insert into D1
   `q_signups` → MailChannels email to Matt.
3. Matt runs `nob pull-signups` weekly; approved rows are promoted into
   `07 - F3/Q Schedule/YYYY-MM.md` in the vault and marked `processed`.
