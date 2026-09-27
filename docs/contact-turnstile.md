# Contact form Turnstile operations

Cloudflare Turnstile protects only the join form at `/contact/` and its
`/api/contact` endpoint. It does not gate public pages, search, or the Q signup
flow.

## Production configuration

- Cloudflare widget: `F3 Lawrence — Join form`
- Widget mode: Managed
- Allowed hostname: `f3lawrence.com`
- Pre-clearance: off
- Cloudflare Pages project: `f3-site`
- Pages secret name: `TURNSTILE_SECRET_KEY`
- Public site key location: `src/pages/contact/index.astro`
- Expected widget action: `join_f3`

The secret value belongs only in the Cloudflare Pages production secrets. Do
not put it in source, `wrangler.toml`, test fixtures, logs, or this document.
The older `f3-lawrence` widget is not used by this form.

Only localhost and `127.0.0.1` use Cloudflare's official always-pass test key.
Other hosts use the production site key. Because the production widget allows
only `f3lawrence.com`, preview and alternate Pages hostnames cannot mint an
accepted token; their public pages remain readable.

## Test and deploy

Run the focused checks and production build before publishing:

```sh
npm run test:contact
npm run build
```

The contact tests mock both Cloudflare Siteverify and Slack. They cover missing,
invalid, expired/replayed, wrong-host, and wrong-action tokens; service failures;
successful verification; double submission; retry behavior; and challenge
expiration/error handling.

Pushing the reviewed commit to `main` starts
`.github/workflows/deploy.yml`. GitHub Actions installs dependencies, builds the
site, and deploys `dist/` to the Cloudflare Pages project `f3-site` on the
`main` branch. Wait for that workflow to succeed for the exact pushed commit.

After deployment:

1. Open `https://f3lawrence.com/contact/` and confirm the widget loads.
2. POST a clearly synthetic request without `cf-turnstile-response` to
   `https://f3lawrence.com/api/contact` and confirm it returns HTTP 400.
3. Fetch representative public pages and confirm they return normal content
   without a Turnstile challenge.
4. Confirm a no-token request to the alternate Pages hostname is also rejected.

Do not submit a successful production test into Slack unless that message has
been explicitly authorized. The automated suite is the normal successful-path
check.

## Rotate the secret

1. In Cloudflare, open **Turnstile**, select `F3 Lawrence — Join form`, then use
   **Settings → Rotate Secret Key**.
2. Use the normal grace-period rotation so the previous and new secrets overlap
   while configuration is updated. Do not choose immediate invalidation unless
   an active compromise requires it.
3. Replace the `TURNSTILE_SECRET_KEY` production secret on the `f3-site` Pages
   project with the newly generated value.
4. Redeploy the current `main` commit so all production Functions receive the
   updated secret.
5. Re-run the post-deployment checks above during Cloudflare's two-hour overlap.
   Cloudflare does not allow another rotation during that grace period.

The public site key does not change during a secret-only rotation. If the whole
widget is replaced instead, update the public key in
`src/pages/contact/index.astro`, keep the action and hostname policy aligned,
set the new Pages secret before deploying the code, and repeat all checks.
