---
description: Pull new backblasts from Slack, add missing ones to the repo, and recalculate stats
---

# F3 Backblast Update

You are importing new F3 backblasts from Slack and keeping the site data current. Work through these steps in order.

## Step 1 — Find the latest backblast in the repo

List `content/backblasts/` sorted by filename (which is date-prefixed). The last file tells you the cutoff date — you only need Slack posts **after** that date.

## Step 2 — Pull recent posts from Slack

Pull both AO channels with the F3 Lawrence Slack token (the `slack_token` in
`.env`) — **not** the Slack MCP, which is connected to a different workspace.
The fetch script reads the token, calls the Slack Web API, resolves user
mentions to names, and emits JSON:

```bash
# Run via uv (the scripts require Python 3.10+; the .python-version pin handles this)
uv run scripts/fetch_slack_backblasts.py --channel C07A8STLZ5Z --oldest <cutoff> > /tmp/beehive.json   # #ao-beehive, Tuesdays 5:30a
uv run scripts/fetch_slack_backblasts.py --channel C05L33U97L4 --oldest <cutoff> > /tmp/ad-astra.json  # #ao-ad-astra, Thursdays 5:30a
```

Set `--oldest` to a few days before the cutoff date from Step 1 (a backblast is
sometimes posted a day or two after the workout); the importer dedupes by slug,
so over-fetching is harmless.

> Token prerequisites (one-time): the Slack app must have the
> `channels:history`, `channels:read`, `groups:history`, `groups:read`, and
> `users:read` scopes, and the bot (`f3_lawrence_site`) must be invited to both
> channels (`/invite @f3_lawrence_site`).

Each JSON message has a `text` field. Identify messages that are **backblasts**
(not preblasts, not general chat). A backblast contains:
- A title line starting with "Backblast:"
- Where, When, Q, PAX fields
- Workout description

The importer (`scripts/slack_import_runner.py --ao beehive|ad-astra`) can write
first-draft files automatically, but its output is a rough pass: **always review
and curate each file** per Steps 3–4 (PAX names, emoji like `:wreck-it-ralph:` →
Wreck-It, unnamed `FNG` markers, and stopping before the COT).

## Step 3 — Determine which backblasts are missing

Compare Slack backblast dates against what exists in `content/backblasts/`. A backblast is missing if there is no file with a matching date (YYYY-MM-DD prefix) and AO.

List the missing ones clearly before proceeding so the user can confirm.

## Step 4 — Create backblast files

For each missing backblast, create a file at `content/backblasts/YYYY-MM-DD-slugified-title.md` using this exact frontmatter format:

```
---
slug: YYYY-MM-DD-slugified-title
title: Title From Backblast
date: 'YYYY-MM-DD'
ao: beehive        # or: ad-astra
q: Q Name
q_slug: q-name
pax:
- Pax Name One
- Pax Name Two
- Q Name
total_pax: N
fngs: 0
vault_path: 07 - F3/Backblasts/YYYY/YYYY-MM-DD-slugified-title.md
---

(body of backblast from Slack, cleaned up — remove Slack user ID mentions like <@U123>, replace with display names; stop before any COT/Circle of Trust section and do not include it)
```

Rules:
- `ao` is `beehive` for #ao-beehive, `ad-astra` for #ao-ad-astra
- `q_slug` is the Q's name lowercased with spaces replaced by hyphens
- `total_pax` is the count of unique PAX including the Q
- `fngs` starts as 0 — it will be recalculated in Step 5
- PAX list should include the Q
- Slugify names: lowercase, apostrophes removed, non-alphanumeric runs become hyphens

## Step 5 — Recalculate FNG counts

Run the FNG update script:

```bash
uv run scripts/update_fngs.py
```

Review any mismatches it reports. The early 2023 founding backblasts (2023-08-10, 2023-08-17, 2023-08-31) have manually-set FNG counts that should NOT be overwritten — restore them to 7, 4, and 2 respectively if the script changes them.

## Step 6 — Regenerate the leaderboard

```bash
uv run scripts/regenerate_data.py
```

Confirm the output shows the expected backblast count and latest post date.

## Step 7 — Commit and push

Stage all changed files and commit with a descriptive message listing the backblasts added. Push to a new branch and open a PR to main.

```bash
git add content/backblasts/ content/data.json
git commit -m "Add [date(s)] backblast(s): [titles]"
git push origin HEAD
gh pr create --base main --title "..." --body "..."
```
