# Slack webhook setup

Both the **Join F3 Lawrence** contact form (`/api/contact`) and the **Q signup**
form (`/api/q-signup`) post into Slack via a single **incoming webhook**. Set it
up once; both Functions read the same `SLACK_WEBHOOK_URL` secret and post to
whatever channel the webhook is bound to.

> Target channel: **#admin**

## 1. Create the incoming webhook

1. Go to <https://api.slack.com/apps> → **Create New App** → **From scratch**.
   - Name it e.g. `F3 Lawrence Site`, pick the F3 Lawrence workspace.
2. In the app, open **Incoming Webhooks** → toggle **Activate Incoming Webhooks** on.
3. Click **Add New Webhook to Workspace**.
4. Choose the **#admin** channel → **Allow**.
5. Copy the generated **Webhook URL** (looks like
   `https://hooks.slack.com/services/T000/B000/XXXX`). Treat it like a password —
   anyone with it can post to the channel.

## 2. Store it as a Cloudflare secret (never commit it)

```sh
wrangler pages secret put SLACK_WEBHOOK_URL --project-name f3-site
# paste the webhook URL when prompted
```

This is encrypted at rest and injected into the Functions at runtime. It is
**not** in `wrangler.toml` (that file is committed and public).

## 3. Local development

For `npm run preview` (which runs the Functions locally), create a
`.dev.vars` file in the repo root — it's gitignored, keep it out of commits:

```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T000/B000/XXXX
TURNSTILE_SECRET=your-turnstile-secret
```

## 3b. Test the Slack wiring locally (without fighting Turnstile)

Turnstile is awkward to exercise on `localhost`. To test the form → Slack path
locally, skip Turnstile with a **local-only** flag — it lives only in your
gitignored `.dev.vars` and is never set in production, so verification stays
enforced on the live site.

`.dev.vars` (repo root):
```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/.../...   # your real webhook
TURNSTILE_DISABLED=true
```

Then:
```sh
npm run build
npm run preview            # wrangler pages dev — http://localhost:8788
```
Submit `/contact/` (and `/signup/`) → the message should land in #admin for
real. When done, delete the flag (or the whole `.dev.vars`).

> Want the Turnstile widget itself to render cleanly on localhost too? Add an
> `.env` with Cloudflare's always-pass **test site key**:
> `PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA` and rebuild. (Optional —
> the bypass above already lets the form submit regardless.)

## 4. Verify

Submit the form on `/contact/` (and `/signup/`) in preview or production. You
should see a message land in **#admin** within a second or two. If nothing
arrives, check the Function logs in the Cloudflare dashboard.

---

## Optional: @-mention the Q by name (Q signup)

An incoming webhook can only @-mention someone by their **Slack member ID**
(`<@U012ABC>`), not their display/F3 name. To tag the Q automatically you'd need
a small `f3_name → member_id` lookup:

1. Build the map once (e.g. a committed `functions/api/_slack-ids.json` like
   `{ "Big Toe": "U012ABC", "Waco": "U045XYZ" }`). Member IDs are visible in
   Slack under a member's profile → **Copy member ID**.
2. In `postToSlack` (in `q-signup.ts`), look up the F3 name and, if found,
   prepend `<@${id}> ` to the message text.

This is a deliberate, low-effort add-on — say the word and I'll wire it in.

## Note on the website Q calendar

The site is **static** (built from the Obsidian vault via `nob export-site`), so
a signup can't update the live calendar in real time. The current flow is:
form → D1 + Slack ping → you approve → `nob pull-signups` promotes it into the
vault → next build refreshes `/calendar/`. If you want approved slots to show on
the site without waiting for a rebuild, the calendar page could fetch claimed
slots from a small read-only `/api/calendar` endpoint (backed by D1) on load —
a clean follow-up, but more than the current "don't get fancy" scope.
