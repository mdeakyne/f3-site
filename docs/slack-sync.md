# Daily Slack backblast sync

`.github/workflows/slack-sync.yml` runs `scripts/daily_slack_sync.py` once a day.
It reads both AO channels, writes first-draft markdown for any backblast that
isn't in `content/backblasts/` yet, recalculates FNG counts, regenerates
`content/data.json`, and opens (or updates) a pull request on the long-lived
`auto/backblast-sync` branch.

It never pushes to `main`. Three parts of the import are judgment the parser
can't make:

- **Canonical PAX naming** — one PAX appears as `wreckit`, `Wreck-It`,
  `@ wreck it` and `:wreck-it-ralph:` across a single quarter.
- **Unseen nicknames** — a new emoji or nickname has no mapping yet.
- **FNG privacy** — an FNG stays `FNG` on the site until they're given an F3
  name. A real name must never reach a page.

So the job's output is a PR labelled `needs-curation`, and anything it was
unsure about is listed in the PR body instead of being silently accepted.

## Running it by hand

```bash
uv run scripts/daily_slack_sync.py --dry-run          # report only
uv run scripts/daily_slack_sync.py                    # write drafts
uv run scripts/daily_slack_sync.py --lookback-days 60
```

Requires `slack_token` in `.env` (locally) or the `SLACK_TOKEN` repository
secret (in Actions). The Slack app needs `channels:history`, `channels:read`,
`groups:history`, `groups:read` and `users:read`, and `f3_lawrence_site` must be
in both channels.

## Tests

```bash
uv run --with pytest pytest tests/ -q
```

The suite replays three months of real backblasts (2026-06-08 to 2026-09-29,
29 of them) from sanitized fixtures and compares the parse against the curated
files in `content/backblasts/`, which are the source of truth. The key
regression guard is `test_replaying_the_window_imports_nothing_new`: running the
sync daily across that window must converge exactly on what's committed — no new
files, no duplicates.

Fixtures are regenerated with `uv run tests/make_fixtures.py`. **This repo is
public**, so that script sanitizes: CoT sections become a synthetic
`CoT: <redacted for fixture>` marker, preblasts keep only their header lines,
and other chatter becomes `<chatter>`. Workout bodies are kept verbatim because
they're already published on the site.

`FNG (Real Name)` is dropped, leaving the bare `FNG` marker the site publishes.

A Q can also name a nameless FNG with no `FNG` marker at all — a bare
`@Real Name` on the PAX line, which looks exactly like a real F3 name. The
sanitizer does not catch that; the 09-29 Blocking Fast and Slow fixture was
corrected by hand. See "Known limits" below before regenerating.

## Edge cases and how each is handled

| Case | Seen in | Handling |
|---|---|---|
| Backblast posts days late | routinely 4–6 days; "Christmas in July" (07-28) posted 08-02 | 21-day lookback, dedupe by slug |
| Dash-separated dates | `When: 09-01-26 0530` | `parse_date` handles `MM-DD-YY(YY)`, checked after ISO so `YYYY-MM-DD` still wins |
| Headers with no colon | `Where <#C…>`, `Q @Dizzy` | colon optional within the first 10 lines only, so body prose (`Q deals , starts with…`) is safe |
| `AO:` instead of `Where:` | 2026-09-01 | treated as an alias |
| Stale `Where:` line | 06-30 TABADA posted in #ao-beehive but names the ad-astra channel | the posting channel wins; disagreement reported as `ao_conflict` |
| Hand-corrected date | Classic Ladders: Slack says 08/26, workout was 08/27 (PR #33) | same title within ±3 days counts as already imported; reported, not duplicated |
| Meaningful title emoji | `7 of :gem:` = "7 of Diamonds" | blocks the import and asks; decorative emoji (`:stopwatch:`) strip silently via `DECORATIVE_EMOJI` |
| CoT in the message | 12 of 26 backblasts | body truncated at the CoT marker; no committed backblast contains one |
| Bare `FNG` marker | `PAX: @Waco @Dizzy FNG` | dropped from the PAX list; counts come from `update_fngs.py` |
| FNG named in parentheses | `PAX: @Toto @Waco FNG (real name)` on 09-17 | parenthetical dropped by `normalize_name`, so the real name of an unnamed FNG never reaches the repo or the fixtures |
| Emoji decorating a name | `Q: Wreckit :wreck-it-ralph:` on 09-10 | emoji stripped off the name; an emoji standing **alone** still resolves through `CANONICAL` |
| Attendance annotation | `@Dizzy (late)` on 09-10 | trailing parenthetical dropped, so it doesn't become a new PAX `dizzy-late` |
| Date that isn't an AO day | Centennial posted `09-07` (Mon), Birthday Bash `09-09` (Wed) | not auto-corrected: reported for a human, who files it on the real AO day (both in PR #35) |
| Off-roster PAX name | `Brick` has posts but no profile | blocks the import — it's a new PAX, a missing profile, or a leaked real name |
| FNG named in a PAX line | an FNG listed by real name on 09-29 | left as `FNG` in the backblast; a manual `update_fngs.py` override carries the count, since the slug heuristic can't see an unnamed arrival |
| FNG debut credited to a later name | `2026-09-17` was `FNG`, named Van Gogh on 09-22 | curated file credits the debut to him; `KNOWN_EXCEPTIONS` in `test_parser.py` records it, since Slack's bare `FNG` cannot express it |
| Chatter mentioning "backblast" | "Sorry for the late backblast" | detector needs a line-anchored title **and** a Q **and** a PAX line |
| `data.json` churn | set iteration + wall-clock timestamp | iteration sorted, leaderboard has a total order, `generated_at` derived from the newest backblast |

## Known limits

- **Not every backblast comes from Slack.** In the test window, three didn't:
  `2026-08-04` was posted as screenshots plus a bare exercise list with no
  `Backblast:` header, `2026-08-06` only ever got a preblast, and `2026-06-09`
  has no message in either channel (the `vault_path` frontmatter points at an
  Obsidian vault as a second source). 29 of the 32 curated files in the
  window (~90%) are Slack-derivable; the rest still need a person.
- **The test fixtures are an archive, not a snapshot.** The workspace serves
  only ~90 days of history, so `tests/make_fixtures.py` merges a fresh fetch
  into the committed messages instead of overwriting them. Running it with
  `--replace` discards every message Slack no longer returns, which silently
  deletes the oldest weeks of test coverage.
- **A nameless FNG in a fixture needs a human.** `make_fixtures.py` only
  redacts the `FNG (Real Name)` form. A bare real name on a PAX line is
  indistinguishable from an F3 name and passes straight through — which is how
  one reached the 09-29 fixture before it was corrected by hand. **Grep the
  regenerated fixtures for any PAX name absent from `content/pax/` before
  committing them.** A roster-driven redaction in `make_fixtures.py` would close
  this properly; it isn't written yet.
- **Thread replies aren't read.** `fetch_channel` reads top-level history only.
  No backblast in the window was posted as a reply, but photo links and
  follow-ups often are.
- **`content/pax/` is an incomplete roster** — 62 profiles against 65 PAX on the
  leaderboard (`brick`, `gypsy`, `honeystinger` have none), and the `post_count`
  fields in it are stale. `KNOWN_OFF_ROSTER` in the sync script lists the three
  so they don't block every run.
- **`regenerate_data.py` lets the last backblast processed win over the profile's
  name.** If the corpus ever disagrees on a display spelling, the leaderboard
  shows whichever file sorted last, not what `content/pax/` says. The two
  spellings of Wreck-It that used to circulate are now settled: `Wreck-It` is
  canonical in `CANONICAL`, in the profile, and in every backblast, and
  `test_display_name_matches_pax_profile` fails if they drift apart again.
