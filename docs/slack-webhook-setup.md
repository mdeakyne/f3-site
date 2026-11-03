# Contact form Slack webhook

Only the **Join F3 Lawrence** contact form (`/api/contact`) posts through this
incoming webhook to **#admin**. Q signup uses separate channel-specific
incoming webhooks for the three AO channels; follow
[Q signup deployment](q-signup-deployment.md) for its configuration.

1. In the F3 Lawrence Slack app, enable **Incoming Webhooks**, add a webhook
   to **#admin**, and retain its URL as a secret.
2. Set the Pages secret without committing its value:

```sh
npx wrangler pages secret put SLACK_WEBHOOK_URL --project-name f3-site
```

For local contact preview, put that variable in an ignored `.dev.vars` file.
The contact form also requires Turnstile; follow
[Contact Turnstile operations](contact-turnstile.md). Use the automated mocked
checks (`npm run test:contact`) for ordinary verification. A successful form
submission sends a real Slack message and needs an intentionally approved test.

The Q calendar reads live D1 claims from `/api/q-signups`. It no longer waits
for an admin approval, `nob pull-signups`, or a static rebuild. Optional Q
member mappings belong in server-only secrets on both runtimes, never in a
committed browser lookup.
