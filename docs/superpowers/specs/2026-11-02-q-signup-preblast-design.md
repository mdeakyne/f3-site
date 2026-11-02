# Q Signup, Scheduled Pre-Blast, and Q Checklist Design

**Date:** 2026-11-02
**Status:** Draft for approval

## Intent

Replace the current approval-oriented Q signup with a self-service claim system. A PAX can claim an upcoming Lawrence AO, provide a complete pre-blast, see the claim reflected immediately on the website, and have the pre-blast posted automatically to the correct Slack channel at 4:00 PM America/Chicago on the preceding day.

The first release favors a simple, trustworthy workflow: Turnstile blocks automated abuse, the database prevents duplicate claims, and Slack remains the place where humans handle edits or cancellations.

## Goals

- Protect Q signup with the same Cloudflare Turnstile pattern already used successfully by the outreach form.
- Show only future Lawrence workout dates, beginning tomorrow and extending through the same calendar date two months ahead.
- Prevent two people from claiming the same AO and workout date, including simultaneous submissions.
- Offer a searchable Q selector containing anyone who attended or Q'd a Lawrence workout in the rolling three calendar months ending today.
- Retain an `Other / not listed` option with a required typed F3 name.
- Require a complete pre-blast: AO, workout date/time, Q, title, description, and Coupon Yes/No.
- Show upcoming claims immediately on the signup page with the AO, date/time, Q, and title.
- Remove claimed slots from the choices available to another submitter.
- Publish each pre-blast to the selected AO's Slack channel at 4:00 PM America/Chicago on the day before the workout.
- If a claim is created from 4:00 PM through 11:59 PM the day before the workout, publish it immediately.
- Include both `@channel` and a real Slack mention for the Q when a member-ID mapping exists; otherwise show the Q's name as plain text.
- Preserve Unicode emoji and Slack-style emoji codes in user-entered titles and descriptions.
- Make at most one automatic Slack posting attempt per claim so the system does not create duplicate pre-blasts.
- After a successful claim, show a prominent `Open your Q Checklist` button linking to a new local checklist page.
- Provide a concise, F3-aligned Q checklist that reflects F3 Lawrence's actual practices.

## Non-Goals for the First Release

- Approval before a claim becomes active.
- Verifying that the person submitting is the selected Q.
- Editing or cancelling a claim on the website.
- Updating a posted Slack message after submission.
- Automatically retrying a failed or ambiguous Slack delivery.
- Recording or using Slack message timestamps.
- Reading manually posted Slack pre-blasts back into the website calendar.
- Automatically adding an `Other / not listed` name to the regular PAX catalog.
- Coffee coordination.
- Saving or syncing an individual visitor's checklist completion state.

The deferred Slack-ingestion stretch goal is a separate Python process that watches AO channels, recognizes pre-blasts posted outside the website, and adds or updates the corresponding website claim without duplicating website-created claims.

## Current System

- The Astro site is statically generated and deployed through Cloudflare Pages.
- `POST /api/q-signup` currently applies a honeypot, a client-supplied timing check, and an IP-based D1 rate limit. It inserts a pending row and sends a notification to `#admin` through one incoming webhook.
- The outreach form already implements full client and server Cloudflare Turnstile verification.
- The signup and calendar pages derive future AO dates at build time and currently show every generated slot as open.
- D1 already stores the obsolete approval-oriented `q_signups` table, but its rows do not need to be preserved in the new workflow because current signups and pre-blasts are already represented in Slack.
- The repository already knows the Slack channel IDs for Beehive, Ad Astra, and Caffeine in its backblast importer.
- PAX history data includes each PAX's latest Lawrence post date, which is enough to enforce the rolling eligibility rule when kept current by the existing content sync.

## Decisions

### Date boundaries

All business dates and times use `America/Chicago`.

- The first claimable date is tomorrow. Today's workout is never claimable through the website.
- The last claimable date is the same calendar date two months from today, inclusive. When the destination month lacks that day, clamp to its final day.
- Only dates matching an AO's configured meeting weekday are valid.
- Q eligibility uses an inclusive cutoff of the same calendar date three months before today. For example, on November 2, a PAX whose latest Lawrence attendance or Q was August 2 remains eligible. Month subtraction clamps to the destination month's final day.
- A Q counts as having posted even if they are not repeated in the backblast PAX array.

Date calculations must not rely on the browser or server's host timezone. Shared helpers will explicitly derive the Chicago calendar date and will have daylight-saving and month-end tests.

### Required form fields

- AO
- Workout date (selected from valid dates for the AO)
- Workout time (read-only and populated from the AO catalog)
- Q
- Title
- Description (multiline)
- Coupon: Yes or No
- Turnstile token

Title, description, and coupon choice are required. Field lengths will be bounded on both client and server. The server will ignore any client-supplied time and derive the canonical time from the AO catalog.

### Searchable Q selector

The page will render an accessible searchable combobox rather than a long plain select. Its regular choices are PAX whose `latest` Lawrence post/Q date is on or after the three-month cutoff. Filtering happens from data embedded in the page so the cutoff advances with the visitor's current Chicago date without requiring a site rebuild.

Selecting `Other / not listed` reveals a required free-text F3-name field. Regular choices submit the stable PAX slug and display name; the server validates regular choices against the same embedded/build-time catalog and cutoff. `Other` submits only the bounded typed name and does not create a PAX record.

### Claim visibility

A read-only public endpoint will return only upcoming active claims within the two-month window. Public claim data contains AO slug/name, date, canonical time, Q display name, and title. It does not expose IP hashes, Turnstile data, Slack IDs, descriptions, delivery errors, or internal database state.

The signup page will merge the AO schedule with this endpoint on load:

- Claimed rows show date/time, AO, Q, and title.
- Open rows provide the claim action.
- Past rows are omitted.
- A claimed AO/date is absent from form choices.

The existing Q calendar will consume the same public claim endpoint so it does not continue labeling claimed dates as open. If the endpoint is temporarily unavailable, the UI will say availability could not be confirmed and will not invite a potentially conflicting claim.

### Q Checklist page

Add `/q-checklist/` as a concise, mobile-friendly, day-of checklist. It complements rather than replaces the longer `/first-q/` teaching page. The successful signup state remains on the signup page and includes a prominent `Open your Q Checklist` button; it does not redirect automatically.

The page will use ordinary browser checkboxes without saving completion data. Refreshing or leaving the page may reset them. It will organize the lead into practical sections:

**Plan**

- Write the workout down and bring a weinke.
- Confirm the AO time, workout length, coupon needs, and weather-appropriate plan.
- Use the local exercise toolkit, past backblasts, and official F3 Codex for ideas and movement guidance.
- Plan enough material, plus a simple fallback or extra-credit option.

**Before the workout**

- Arrive about ten minutes early.
- Set out the shovel flag and coupons as needed.
- Greet the PAX and welcome any FNG.
- Review the five F3 workout principles and the F3 motto using the term `motto`, not `credo`.
- Start on time.

**Lead**

- Give the disclaimer: free, volunteer, peer-led; the Q is not a professional; each man is responsible for his safety and should modify as needed.
- Warm up before the main work.
- Lead the main workout (`The Thang`), participate in what is called, watch the six, offer modifications, and avoid unnecessary risk.
- Watch the clock and end the workout portion on time.

**Circle of Trust — F3 Lawrence order**

- Name-o-Rama.
- Announcements.
- The Q's closing thought.
- Ball of Man.
- Flag photo.

F3 Lawrence does **not** use Count-o-Rama, so it will not appear on the checklist. Existing `/first-q/` copy and the printable weinke will be corrected to remove Count-o-Rama/count-off guidance and to match this local COT order.

**After**

- Post the backblast in Slack.

The page will link to:

- the local exercise toolkit;
- local past backblasts;
- the longer local `Your First Q` guide;
- F3 Nation's Q101 guide at `https://f3nation.com/q101/`;
- the official F3 Codex at `https://codex.f3nation.com/`;
- the user-provided Twos checklist at `https://www.twosapp.com/65e7a60c32767582884610ca?s=6593fcf0d359942f76c005d4` as the starting reference, where helpful.

Content will be paraphrased and localized rather than copied wholesale. The official Q101 structure informs the five principles, disclaimer, warmup, main workout, safety/form, COT, and backblast guidance. F3 Codex is the preferred external exercise/terminology reference.

### Atomic duplicate prevention

D1 is the source of truth. A migration will create a fresh `q_claims` table with the complete pre-blast and publication fields and a unique constraint for one claim per `(ao_slug, event_date)`.

The POST endpoint will validate Turnstile, fields, AO, date window, weekday, Q eligibility/Other, and lengths before attempting the insert. The database uniqueness rule—not a prior read—is the final concurrency guard. A conflict returns a friendly “That workout was just claimed” response and refreshes availability.

The legacy `q_signups` table and its pending/processed approval lifecycle are retired. Existing legacy rows do not block dates, appear publicly, or trigger Slack. The table remains untouched initially as a recoverable archive, but no production code reads or writes it. Documentation and messages referring to `nob pull-signups` will be removed or marked obsolete.

### Turnstile and abuse controls

Reuse the outreach form's managed Turnstile integration with a distinct action such as `q_signup`. Server verification must require:

- a present, bounded token;
- Cloudflare Siteverify success;
- the exact `q_signup` action;
- an explicitly allowed production hostname;
- a bounded verification timeout.

The existing honeypot, minimum-fill-time check, and IP rate limit remain defense-in-depth controls. A direct POST without valid Turnstile verification never inserts a claim or calls Slack.

### Publication timing

Claims created before 4:00 PM Chicago time on the preceding day receive publication state `scheduled`.

Claims created from 4:00 PM through 11:59 PM on the preceding day are inserted first and then sent immediately. The claim remains locked even if Slack delivery fails.

A small companion Cloudflare Worker will use the same D1 database and run on both UTC hours that can correspond to 4:00 PM Chicago time. On each invocation it will first confirm that the Chicago local time is 4:00 PM; the other daylight-saving trigger becomes a no-op. It then selects scheduled claims for tomorrow.

Before sending, the publisher conditionally changes one row from `scheduled` to `publishing`. Only the invocation that successfully performs that state change may call Slack. A successful Slack response sets `posted`; a definite error or ambiguous network outcome sets `failed`. Neither state is retried automatically.

This provides at-most-once automatic delivery. It intentionally favors no duplicate Slack posts over guaranteed delivery after an ambiguous network failure.

### Slack delivery

The existing incoming webhook is fixed to `#admin` and cannot route dynamically. The publisher will use a Slack bot token stored as a Cloudflare secret and `chat.postMessage` with an explicit AO channel ID. The Slack app must have permission to post and must be present in each AO channel.

AO channel IDs belong in the canonical AO catalog, not in browser-submitted data. The server chooses the destination from the validated AO slug.

PAX-to-Slack-member-ID mappings are optional server-side configuration. A mapped Q is rendered as a controlled `<@MEMBER_ID>` mention. An unmapped regular PAX or `Other` Q is rendered as escaped plain text. The browser does not receive the full mapping.

The initial message format is:

```text
<!channel> *PRE-BLAST: {Title}*
*AO:* {AO name}
*When:* {weekday, date · canonical AO time}
*Q:* {Slack mention when mapped, otherwise F3 name}
*:coupon: Coupon:* {Yes|No}

{Description}
```

User-entered text is escaped so it cannot create its own Slack mentions or links. Unicode emoji and colon-style emoji codes remain intact. The controlled `<!channel>`, Q mention, formatting, and `:coupon:` code are added only by the server.

### Slack failure behavior

The website claim remains active and visible if publication fails. The database records only a bounded operational error and `failed` state. No automatic retry occurs. Cloudflare logs make the failure diagnosable; manual correction happens in Slack for the first release.

The immediate-signup response distinguishes “claimed and posted” from “claimed, but Slack delivery needs attention” without inviting the user to resubmit. Scheduled failures occur after the visitor has left and are operationally visible in Worker logs and D1.

## Shared Catalog and Source of Truth

The AO catalog must provide, for each AO:

- slug and display name;
- meeting weekday and canonical time;
- Slack channel ID.

The implementation will keep these values in one repository-owned source consumed by the Astro pages, Pages Functions, data generation, and scheduled Worker. Client-submitted AO names, weekdays, times, or channel IDs are never trusted.

The PAX catalog continues to come from generated Lawrence backblast history. The implementation will expose only the display data required for the combobox and keep optional Slack member IDs server-side.

## Data Model

The migration will create `q_claims` with fields equivalent to:

- `id` — primary key
- `event_date` — required ISO Chicago workout date
- `ao_slug` — required canonical AO slug
- `q_slug` — nullable stable PAX slug; null for `Other`
- `q_name` — required bounded display name
- `title` — required bounded text
- `description` — required bounded text
- `coupon` — required boolean/integer
- `publish_status` — `scheduled | publishing | posted | failed`
- `scheduled_for` — UTC instant corresponding to 4:00 PM Chicago on the preceding day
- `published_at` — nullable UTC timestamp
- `publish_error` — nullable bounded diagnostic
- `ip_hash` — required rate-limit hash
- `created_at` — required creation timestamp
- a unique constraint on `(ao_slug, event_date)`

No Slack message timestamp is required in this release.

## API Behavior

### `POST /api/q-signup`

1. Accept form data and silently drop the honeypot path.
2. Validate fields and Turnstile.
3. Derive the Chicago date, accepted window, AO weekday/time, and publication time server-side.
4. Validate the selected regular PAX or accept a bounded `Other` name.
5. Insert the claim atomically.
6. If it is after the 4:00 PM threshold on the preceding day, attempt the one allowed Slack publication synchronously.
7. Return structured JSON describing claim success, publication state, and a human-readable message.

The successful client state keeps the confirmation visible and presents the `Open your Q Checklist` link to `/q-checklist/`.

### `GET /api/q-signups`

Return sanitized upcoming active claims in the current two-month window. Apply cache headers appropriate for near-live availability; the client should bypass stale state after a conflict or successful claim.

### Scheduled publisher

Run at the two UTC hours covering 4:00 PM Central Standard and Daylight Time. Confirm Chicago local time before querying. Atomically reserve and publish tomorrow's scheduled claims.

## Approaches Considered

### 1. Cloudflare scheduled Worker plus D1 — selected

Keep D1 as the claim source of truth, Pages Functions as the public API, and add one small scheduled Worker for Slack publication. This matches the existing hosting, gives clean concurrency control, and handles delayed work without relying on a visitor or rebuild.

### 2. GitHub Actions scheduler

Use a scheduled GitHub workflow to query claims and call Slack. This would work, but scheduled Actions can be delayed and would spread runtime secrets and production responsibility across Cloudflare and GitHub.

### 3. One delayed Cloudflare Workflow per claim

Start a durable workflow for each signup and sleep until its publication time. This models the delay directly, but introduces a larger subsystem and more lifecycle management than this small site needs.

## Testing and Acceptance Criteria

Automated tests must cover:

- Turnstile missing, invalid, wrong action, wrong hostname, unavailable service, and valid success paths.
- Honeypot, too-fast submission, rate limit, length limits, and Slack-text escaping.
- Tomorrow-only lower bound, exact two-month upper bound, three-month PAX cutoff, month-end clamping, America/Chicago midnight, and both DST transitions.
- AO/date weekday mismatch and client attempts to spoof time or channel.
- Search filtering, keyboard interaction, `Other` behavior, and required fields.
- Successful signup rendering the `Open your Q Checklist` button without an automatic redirect.
- Q Checklist sections, working internal/external resource links, usable checkboxes, local `motto` terminology, and absence of Count-o-Rama/count-off instructions.
- Existing First Q copy and printable weinke matching the local COT sequence.
- Two concurrent claims for the same AO/date producing exactly one stored claim.
- Claimed dates disappearing and appearing with AO, date/time, Q, and title on signup and calendar pages.
- Scheduled publication at 4:00 PM Chicago, no-op UTC trigger, and immediate publication after 4:00 PM the day before.
- Controlled `@channel`, mapped-Q mention, unmapped-Q fallback, coupon emoji, and title/description emoji preservation.
- Repeated scheduled invocations and concurrent workers producing no duplicate Slack calls.
- Success, definite Slack failure, and ambiguous network failure state transitions with no automatic retry.
- Public API never returning private or operational fields.
- Production build and existing contact, backblast, and Caffeine tests remaining green.

Manual deployment checks must confirm:

- D1 migration applies without duplicate active slots.
- Turnstile secret and hostname/action configuration are correct.
- Slack bot token remains secret, has the minimum required scope, and can post in all three AO channels.
- Channel IDs map to Beehive, Ad Astra, and Caffeine correctly.
- Cron triggers are installed and Worker observability is available.
- A non-posting/local test can simulate scheduled times. A real production Slack test requires an intentionally identified test claim/channel message.

## Rollout

1. Create the new `q_claims` table. Leave obsolete `q_signups` rows untouched as an unreferenced archive.
2. Deploy the read API and updated claim endpoint with Turnstile.
3. Configure the Slack bot secret and AO channel access.
4. Deploy and test the scheduled Worker.
5. Publish the updated signup/calendar UI.
6. Publish the Q Checklist and aligned First Q corrections.
7. Monitor the first scheduled run and retain D1/Worker logs for failure diagnosis.

Because the initial release has no website cancellation, any erroneous active claim must be corrected operationally until the later edit/cancel process is designed.

## Calls Made by the Designer

- The two- and three-month windows use calendar-month subtraction/addition with end-of-month clamping rather than fixed day counts.
- The existing calendar page will use the same claim data as the signup page so it cannot falsely show claimed slots as open.
- User text cannot inject Slack mentions; only the system adds `@channel` and mapped-Q mentions.
- Slack failures are at-most-once and non-retrying, matching the explicit “no duplicates” priority.
- The coupon emoji is represented by the Slack code `:coupon:` unless the workspace uses a different custom code.
- Operational failure visibility starts with D1 state and Cloudflare logs; a dedicated admin dashboard or Slack-failure alert is deferred.
- The obsolete `q_signups` approval queue and `nob pull-signups` integration are replaced rather than migrated. New claims use only `q_claims` and are active immediately.
- The Q Checklist is intentionally non-persistent and opens from a success-screen button rather than an automatic redirect.
- F3 Lawrence terminology uses `motto`, and its local COT sequence omits Count-o-Rama.
