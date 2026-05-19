---
description: Pull new backblasts from Slack, add missing ones to the repo, and recalculate stats
---

# F3 Backblast Update

You are importing new F3 backblasts from Slack and keeping the site data current. Work through these steps in order.

## Step 1 — Find the latest backblast in the repo

List `content/backblasts/` sorted by filename (which is date-prefixed). The last file tells you the cutoff date — you only need Slack posts **after** that date.

## Step 2 — Pull recent posts from Slack

Read both AO channels for backblasts posted after the cutoff:

- `#ao-beehive` (channel ID: `C07A8STLZ5Z`) — Tuesdays 5:30a
- `#ao-ad-astra` (channel ID: `C05L33U97L4`) — Thursdays 5:30a

For each channel, read the recent message history. Identify messages that are **backblasts** (not preblasts, not general chat). A backblast contains:
- A title line starting with "Backblast:"
- Where, When, Q, PAX fields
- Workout description
- COT (Circle of Trust) notes

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

(body of backblast from Slack, cleaned up — remove Slack user ID mentions like <@U123>, replace with display names)
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
python3 scripts/update_fngs.py
```

Review any mismatches it reports. The early 2023 founding backblasts (2023-08-10, 2023-08-17, 2023-08-31) have manually-set FNG counts that should NOT be overwritten — restore them to 7, 4, and 2 respectively if the script changes them.

## Step 6 — Regenerate the leaderboard

```bash
python3 scripts/regenerate_data.py
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
