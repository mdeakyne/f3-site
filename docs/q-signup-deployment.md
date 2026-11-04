# Q signup deployment and operations

Pages serves the protected claim API and public availability; the scheduled
Worker sends pre-blasts. For claims made before the preceding day, Pages also
posts a short signup note to the AO channel immediately. Both must use D1 `f3-signups`, database ID
`b7ac38a1-b139-4f60-a9c8-3dbb99230b17`. New claims live only in `q_claims`.
The old `q_signups` table is an untouched archive, with no import or approval
step and no new `nob pull-signups` use.

## Prepare and verify locally

Use Node >=22.12 and `npm ci`. Run `npm run test:q` (includes an Astro build,
all Q checks, actual emitted bundle privacy, and isolated Wrangler local D1).
External Siteverify and Slack calls are faked by tests. Also run
`npm run test:contact`, `npm run test:backblasts`, and `npm run test:caffeine`.
Full regression uses `node --experimental-strip-types --test
--test-concurrency=1 tests/*.test.ts`; build-hook tests require sequential runs.
The integration fixture applies both migrations to temporary local D1,
preserves a seeded archive, races duplicate protected POSTs and Workers, and
checks public GET fields. No cloud binding or production send is used.

Manual local schema check, with a fresh temporary persistence directory:

```sh
npx wrangler d1 migrations apply f3-signups --local --persist-to /tmp/f3-q-check
```

Apply only additive migration `0002_q_claims.sql` to an existing production
installation after checking migration history and backing up the database:

```sh
npx wrangler d1 migrations list f3-signups --remote
npx wrangler d1 migrations apply f3-signups --remote
```

These remote commands are operator rollout steps, not automated tests. Confirm
`q_signups` row counts/content are unchanged and `q_claims` has its unique
`(ao_slug,event_date)` constraint. Do not replace or clear either table.

## Runtime configuration

Set these independently in the Pages project's production environment and the
scheduled Worker's environment; a Pages secret is not inherited by a Worker:

```sh
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name f3-site
# One server-only JSON object: {"beehive":"https://hooks.slack.com/...","ad-astra":"...","caffeine":"..."}
npx wrangler pages secret put Q_SLACK_WEBHOOKS_JSON --project-name f3-site
npx wrangler secret put Q_SLACK_WEBHOOKS_JSON --config workers/wrangler.toml
# Optional stable PAX slug → Slack member ID map, server-only on BOTH:
npx wrangler pages secret put Q_SLACK_MEMBERS_JSON --project-name f3-site
npx wrangler secret put Q_SLACK_MEMBERS_JSON --config workers/wrangler.toml
```

Only Pages needs `TURNSTILE_SECRET_KEY`. The contact form keeps its own
`#admin` webhook as `SLACK_WEBHOOK_URL`; Q publishing uses the per-channel
webhook map above and has no fallback to it. Never put webhook URLs or
member-map values in public assets, build environment serialization, or logs.
Local Pages `.dev.vars` and Worker `workers/.dev.vars` are separate; keep any
local credentials untracked and use network fakes for ordinary checks.
The argument after `secret put` is always the variable name shown above, never
the credential value. If a credential ever appears in a secret name, shell
history, logs, or other metadata, delete the malformed entry and rotate the
credential at its issuer; renaming or copying it does not undo disclosure.

The public Turnstile site key is compiled into the browser controller
`src/lib/q-form-controller.ts`, so changing it requires a rebuild/deploy.
It must match the widget behind the Pages `TURNSTILE_SECRET_KEY`; the current
contact and Q controllers use the same widget key and shared Pages secret.
Allow `f3lawrence.com`, disable pre-clearance, and render action `q_signup`.
The server requires that exact action and hostname. The contact form keeps
its own `join_f3` action. Localhost/127.0.0.1 use the official test site key;
preview hostnames do not satisfy the production hostname policy. Never
weaken hostname/action checks to make a preview pass.

Create one incoming webhook per AO channel in the F3 Lawrence Slack app, the
same mechanism as the contact form's webhook, and put each URL in
`Q_SLACK_WEBHOOKS_JSON` under its AO slug. A webhook posts only to the channel
selected when it was created, so the slug-to-URL mapping is the destination.
No bot scopes or channel membership are required. Confirm each webhook targets
its canonical channel:

| AO | Channel ID |
| --- | --- |
| Beehive | `C07A8STLZ5Z` |
| Ad Astra | `C05L33U97L4` |
| Caffeine | `C0CE7TKJ7HS` |

Optional member IDs are valid Slack member IDs keyed by stable PAX slug.
Unmapped/invalid entries become escaped plain names. User text cannot add
mentions; the system supplies the controlled webhook destination and mapped-Q
mentions.

## Cutover and first scheduled run

1. Reconcile existing future Q commitments in AO Slack with the new calendar
   window. The system does not read Slack commitments or migrate the archive.
   The earliest previously committed claim wins; resolve disagreement with
   the Q/AO lead before opening signups. Prepare a reviewed operational import
   for each verified commitment with canonical AO/date,
   bounded required fields, and correct scheduled time. Use `posted` with a
   verified publication timestamp for pre-blasts already sent; use `scheduled`
   only if no pre-blast has been sent. Do not fabricate private IP data: use
   a documented import marker for `ip_hash`. Keep an audit record. Never
   blindly replay the archive or overwrite an active unique slot.
2. Apply the additive migration and configure both runtimes. Stage the
   matching Pages API/UI build and Worker from the same reviewed revision;
   execute the reviewed commitment import into `q_claims` after the migration
   and verify the imported rows before enabling publication or opening signups.
   Do not expose a signup form before its API/secrets are ready.
3. Deploy Pages and the companion Worker using the normal reviewed workflow.
   The workflow must run both `pages deploy ./dist` and
   `deploy --config workers/wrangler.toml` from the same revision.
   Verify both bind the same database and have observability/logs enabled.
4. Verify cron expression `0 15,16 * * *` is installed: both 15:00 and 16:00
   UTC run every day. The code gates to 10:00 America/Chicago, so the other
   UTC trigger is a no-op across daylight saving changes. Only tomorrow's
   scheduled/due rows are selected. Late claims publish synchronously without
   a separate signup note.
5. Confirm `/signup/`, `/calendar/`, `/q-checklist/`, and public
   `/api/q-signups` work. GET must be `no-store` and contain only AO slug/name,
   date/time, Q name, and title. A missing-token POST must return 400.
   For positive checks use local network fakes. Any real Slack test needs a
   deliberately identified test claim/channel message and explicit approval.
6. Confirm a claim made before the preceding day posts a short signup note
   (`Q signed up` and the scheduled preblast date) to the AO channel. Confirm a
   claim made on the preceding day posts no note and that the full preblast
   posts at 10:00 America/Chicago or immediately after that time. The note is
   best-effort: it never rolls back the claim and is not retried or recorded in
   `q_claims`.
7. Monitor the first legitimate 10:00 Chicago run using Worker logs and D1:

```sql
SELECT id,ao_slug,event_date,publish_status,scheduled_for,published_at,publish_error
FROM q_claims ORDER BY event_date,id;
```

Compare the expected legitimate pre-blast with its AO Slack channel manually.
Retain operational logs without adding private form text or credentials.

## Failed, stuck, or incorrect claims

Delivery is at-most-once: `scheduled → publishing → posted|failed`. There is
no retry/unlock job. A timeout may mean Slack accepted the message; a crash or
status-write failure may leave `publishing`. Inspect the claim's due time,
status and bounded error, Worker/Pages logs, the AO's webhook mapping, and the
AO Slack history. A `scheduled` row after its due date may indicate a missed
trigger or configuration failure; the Worker intentionally selects tomorrow
only, so do not expect catch-up publication on following days.

The early-claim signup note is separate from the preblast lifecycle. It is
best-effort, has no stored status, and is not retried; a missing note does not
mean the preblast will be missed. Day-before claims intentionally have no
signup note. Diagnose an expected-but-missing note from Pages logs and the AO
channel, then coordinate a manual note if needed.

For `failed` or stuck `publishing`, verify whether Slack already contains the
message before doing anything. If delivered, mark it `posted` with a verified
publication timestamp through a reviewed, id-scoped operational SQL change.
If not delivered, coordinate one manual pre-blast in the AO channel, then
record the outcome operationally. Never reset it to `scheduled`, rerun its
publisher as a recovery mechanism, or infer non-delivery from a timeout.

An incorrect AO/date/Q must be coordinated with the Q/AO lead. Preserve an
audit copy, inspect whether publication happened, and make only an id-scoped
correction after checking the destination slot is free. If publication has
started, stop the Worker during correction and arrange Slack corrections
manually. There is no public edit/cancel API; do not delete/recreate a claim
just to trigger another Slack send.

## Coupled rollback

Pause the Worker's cron first and take the signup UI out of service before
reverting a release. Revert the Pages UI/API and Worker together to a mutually
compatible revision, retaining the additive `q_claims` table and all states.
Do not restore the old approval/webhook form while claiming new slots are
live; it cannot honor these active claims. If rolling back before this
feature, keep signup closed and coordinate claims in Slack until a compatible
release is restored. Preserve the read-only archive, tokens, and audit data;
never run a destructive down migration or reset publication statuses.
Reconcile pending claims and missed runs manually before enabling crons and
reopening signup.
