#!/usr/bin/env python3
"""
Daily Slack -> repo sync for new backblasts.

Runs the whole import unattended: fetch both AO channels, write first-draft
markdown for any backblast not already in content/backblasts/, recalculate FNG
counts, and regenerate content/data.json.

It deliberately stops short of publishing. Three parts of the import are human
judgment the parser cannot make -- canonical PAX naming, an emoji or nickname it
has never seen, and the rule that an FNG stays "FNG" until they earn an F3 name
-- so this writes a review report and expects a pull request to carry the
changes to main. Anything the script is unsure about is listed under REVIEW in
that report rather than silently accepted.

Exit codes:
  0  nothing new, or new drafts written successfully
  1  a hard failure (bad token, missing scope, Slack unreachable)

Usage:
  uv run scripts/daily_slack_sync.py [--lookback-days 21] [--dry-run]
"""
import argparse
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts"))

from fetch_slack_backblasts import fetch_channel, load_token  # noqa: E402
from import_slack_backblast import (  # noqa: E402
    CONTENT_DIR,
    make_slug,
    parse_message,
    slugify,
    write_backblast,
)
from slack_import_runner import is_backblast  # noqa: E402

CHANNELS = {"beehive": "C07A8STLZ5Z", "ad-astra": "C05L33U97L4"}
PAX_DIR = os.path.join(REPO_ROOT, "content", "pax")

# PAX who post but have no content/pax/*.md profile yet. Listing them here keeps
# the review report focused on genuinely new names.
KNOWN_OFF_ROSTER = {"brick", "gypsy", "honeystinger"}

EMOJI_RE = re.compile(r":[a-z0-9_+\-]{2,}:")
COT_RE = re.compile(r"^\s*\*{0,2}(cot|circle of trust)\b", re.I | re.M)


def roster_slugs() -> set[str]:
    return {f[:-3] for f in os.listdir(PAX_DIR) if f.endswith(".md")}


def existing_slugs() -> set[str]:
    return {f[:-3] for f in os.listdir(CONTENT_DIR) if f.endswith(".md")}


# How far a hand-corrected date may sit from the date Slack claims.
NEAR_DUPLICATE_DAYS = 3


def _title_part(slug: str) -> str:
    """'2026-08-27-classic-ladders' -> 'classic-ladders'."""
    return slug[11:] if len(slug) > 11 else slug


def find_near_duplicate(slug: str, have: set[str]) -> str | None:
    """Find an existing file that is the same workout under a different date.

    A Q sometimes types the wrong date in the backblast and it gets fixed by
    hand afterwards: the Classic Ladders backblast says 08/26/26 but the
    workout was 08/27, corrected in PR #33. Exact slug dedupe misses that, so
    the wrong-dated draft would be recreated on every run. Same title within a
    few days of the claimed date is the same workout.
    """
    title = _title_part(slug)
    if not title:
        return None
    try:
        want = datetime.strptime(slug[:10], "%Y-%m-%d")
    except ValueError:
        return None
    for other in have:
        if _title_part(other) != title or other == slug:
            continue
        try:
            got = datetime.strptime(other[:10], "%Y-%m-%d")
        except ValueError:
            continue
        if abs((got - want).days) <= NEAR_DUPLICATE_DAYS:
            return other
    return None


def review_notes(fields: dict, roster: set[str]) -> list[str]:
    """Advisory notes: the draft is usable, but say what was decided for it."""
    notes = []
    if fields.get("ao_conflict"):
        notes.append(
            f"AO mismatch: posted in #{fields['ao']} but the Where:/AO: line says "
            f"#{fields['ao_from_where']}. Used the channel; confirm which is right.")
    return notes


def blocking_notes(fields: dict, roster: set[str]) -> list[str]:
    """Reasons not to write a draft at all.

    Each of these would put something wrong on a public page -- a title only a
    human can finish, a name that may belong to an FNG who has not been given an
    F3 nickname yet, or a personal CoT share. Writing a file anyway invites it
    being merged unread, so the workout is reported instead and left for a
    person to add.
    """
    blocks = []
    if fields.get("title_had_emoji"):
        blocks.append(
            f"the title contained an emoji that was stripped, leaving "
            f"{fields['title']!r}. The emoji usually carries the meaning "
            f"(':gem:' -> 'Diamonds'), so the workout needs naming by hand.")
    for name in fields["pax"]:
        if EMOJI_RE.search(name):
            blocks.append(f"unresolved emoji as a PAX name: {name!r} -- add it to "
                          f"CANONICAL in scripts/import_slack_backblast.py")
        elif slugify(name) not in roster and slugify(name) not in KNOWN_OFF_ROSTER:
            blocks.append(f"PAX not on the roster: {name!r} -- a new PAX, a missing "
                          f"profile, or an FNG's real name (which must never be "
                          f"published; keep them as 'FNG' until they have an F3 name)")
    if COT_RE.search(fields["body"]):
        blocks.append("a CoT section survived into the body")
    if not fields["q"]:
        blocks.append("no Q parsed")
    if fields["total_pax"] < 2:
        blocks.append(f"only {fields['total_pax']} PAX parsed -- check the PAX line")
    return blocks


def run(script: str) -> None:
    subprocess.run([sys.executable, os.path.join(REPO_ROOT, "scripts", script)],
                   check=True, cwd=REPO_ROOT)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--lookback-days", type=int, default=21,
                    help="How far back to look. Backblasts routinely post 4-6 "
                         "days after the workout, so keep this generous; the "
                         "importer dedupes by slug, so over-fetching is free.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Report what would be imported without writing files.")
    ap.add_argument("--report", default=None,
                    help="Write the review report here as well as to stdout.")
    args = ap.parse_args()

    try:
        token = load_token()
    except SystemExit as e:
        print(f"FATAL: {e}", file=sys.stderr)
        return 1

    oldest = (datetime.now() - timedelta(days=args.lookback_days)).timestamp()
    roster, have = roster_slugs(), existing_slugs()
    written, skipped, failed = [], [], []
    notes_by_slug, date_notes, blocked = {}, [], {}

    for ao, channel in CHANNELS.items():
        msgs = fetch_channel(token, channel, oldest)
        print(f"{ao}: fetched {len(msgs)} message(s)", file=sys.stderr)
        for msg in msgs:
            text = msg.get("text", "")
            if not is_backblast(text):
                continue
            try:
                fields = parse_message(text, ao_hint=ao)
            except ValueError as e:
                head = text.splitlines()[0][:60] if text else "<empty>"
                failed.append(f"{head!r}: {e}")
                continue
            slug = make_slug(fields["date"], fields["title"])
            if slug in have:
                skipped.append(slug)
                continue
            near = find_near_duplicate(slug, have)
            if near:
                # Already imported under a corrected date -- do not duplicate it.
                skipped.append(slug)
                date_notes.append(
                    f"`{slug}.md` not imported: the repo already has "
                    f"`{near}.md`, the same workout under a different date. "
                    f"Slack says {slug[:10]}; the repo says {near[:10]}. "
                    f"If Slack is the correct one, fix it by hand.")
                continue
            blocks = blocking_notes(fields, roster)
            if blocks:
                blocked[slug] = blocks
                print(f"  BLOCKED: {slug}", file=sys.stderr)
                continue
            notes = review_notes(fields, roster)
            if notes:
                notes_by_slug[slug] = notes
            if args.dry_run:
                print(f"  WOULD IMPORT: {slug}", file=sys.stderr)
            else:
                write_backblast(fields)
            written.append(slug)

    if written and not args.dry_run:
        run("update_fngs.py")
        run("regenerate_data.py")

    # ---- report -----------------------------------------------------------
    lines = []
    if not written:
        lines.append("No new backblasts. "
                     f"({len(skipped)} already imported, {len(blocked)} blocked, "
                     f"{len(failed)} unparseable)")
    else:
        lines.append(f"Imported {len(written)} new backblast draft(s):")
        lines += [f"- `{s}.md`" for s in sorted(written)]
    if blocked:
        lines.append("")
        lines.append("## Not imported -- needs a person")
        for slug in sorted(blocked):
            lines.append(f"\n**{slug}**")
            lines += [f"- {n}" for n in blocked[slug]]
    if notes_by_slug:
        lines.append("")
        lines.append("## REVIEW before merging")
        for slug in sorted(notes_by_slug):
            lines.append(f"\n**{slug}**")
            lines += [f"- {n}" for n in notes_by_slug[slug]]
    if date_notes:
        lines.append("")
        lines.append("## Date disagreements (nothing imported for these)")
        lines += [f"- {n}" for n in date_notes]
    if failed:
        lines.append("")
        lines.append("## Looked like a backblast but would not parse")
        lines += [f"- {f}" for f in failed]
        lines.append("\nThese need a human: check the Where/When/Q/PAX lines.")
    report = "\n".join(lines) + "\n"

    print(report)
    if args.report:
        with open(args.report, "w") as f:
            f.write(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
