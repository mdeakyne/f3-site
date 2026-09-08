"""Whole-pipeline properties: determinism, FNG accounting, source coverage."""
import os
import re
import shutil
import subprocess
import sys

import pytest

from conftest import BACKBLAST_DIR, REPO_ROOT, WINDOW_START, parse_frontmatter

DATA_JSON = os.path.join(REPO_ROOT, "content", "data.json")


def _regen(env_extra: dict) -> str:
    """Run regenerate_data.py with data.json restored afterwards; return its bytes."""
    backup = DATA_JSON + ".testbak"
    shutil.copy2(DATA_JSON, backup)
    try:
        env = {**os.environ, **env_extra}
        subprocess.run([sys.executable, os.path.join(REPO_ROOT, "scripts",
                                                     "regenerate_data.py")],
                       check=True, capture_output=True, env=env, cwd=REPO_ROOT)
        return open(DATA_JSON).read()
    finally:
        shutil.move(backup, DATA_JSON)


def _strip_timestamp(s: str) -> str:
    return re.sub(r'"generated_at":\s*"[^"]*",?\n?', "", s)


def test_regenerate_is_deterministic():
    """A daily job must not produce a diff when nothing changed.

    regenerate_data.py iterates a set[str]; Python randomizes string hashing per
    process, so without an explicit sort the leaderboard order of PAX tied on
    posts/qs shuffles between runs and churns data.json every day.
    """
    runs = {_strip_timestamp(_regen({"PYTHONHASHSEED": str(seed)}))
            for seed in ("0", "1", "12345")}
    assert len(runs) == 1, "data.json content varies across PYTHONHASHSEED values"


def test_regenerate_is_idempotent_against_committed_data():
    """Regenerating from the committed backblasts reproduces committed data.json."""
    fresh = _strip_timestamp(_regen({"PYTHONHASHSEED": "0"}))
    committed = _strip_timestamp(open(DATA_JSON).read())
    assert fresh == committed, "committed data.json is stale vs content/backblasts/"


# ---------------------------------------------------------------------------
# FNG accounting.
# ---------------------------------------------------------------------------

def test_total_pax_accounts_for_unnamed_fngs(curated):
    """total_pax counts everyone who posted, named or not.

    The corpus uses two conventions for an unnamed FNG: some files list a
    literal 'FNG' in pax, others omit it and only bump total_pax. Both must
    satisfy total_pax == len(named pax) + (unlisted fngs).
    """
    bad = []
    for c in curated:
        named = [p for p in c["pax"] if p != "FNG"]
        listed_fng = len(c["pax"]) - len(named)
        implied = c["total_pax"] - len(named)
        if implied < 0 or (implied - listed_fng) < 0:
            bad.append(f"{c['filename']}: total_pax={c['total_pax']} "
                       f"named={len(named)} listed_fng={listed_fng}")
    assert not bad, "\n".join(bad)


def test_q_is_always_in_pax(curated):
    missing = [c["filename"] for c in curated
               if c["q"] and c["q"] not in c["pax"]]
    assert not missing, f"Q absent from pax list: {missing}"


def test_no_duplicate_pax_within_a_backblast(curated):
    dupes = []
    for c in curated:
        seen = [p for p in c["pax"]]
        if len(seen) != len(set(seen)):
            dupes.append(c["filename"])
    assert not dupes, f"duplicate PAX entries: {dupes}"


def test_filename_date_matches_frontmatter_date(curated):
    """PR #33 fixed a file whose name and date field disagreed."""
    bad = [c["filename"] for c in curated if not c["filename"].startswith(c["date"])]
    assert not bad, f"filename/date mismatch: {bad}"


def test_ao_is_a_known_value(curated):
    bad = [(c["filename"], c["ao"]) for c in curated
           if c["ao"] not in ("beehive", "ad-astra")]
    assert not bad, f"unknown ao: {bad}"


# ---------------------------------------------------------------------------
# Source coverage: which curated files Slack could never have produced.
# ---------------------------------------------------------------------------

# Verified by hand against channel history for 2026-06-08..2026-09-08.
NOT_IN_SLACK = {
    "2026-06-09-push-and-pull.md":
        "no message in either channel; came from the Obsidian vault",
    "2026-08-04-casios-contraptions.md":
        "posted as 3 screenshots + a bare exercise list, no 'Backblast:' header",
    "2026-08-06-big-ole-fart-sack.md":
        "only a preblast was ever posted; no backblast written",
}


def test_slack_only_covers_the_expected_share_of_the_corpus(curated, slack_backblasts):
    """Documents the automation's ceiling: ~88% of backblasts are Slack-derivable."""
    expected_gap = set(NOT_IN_SLACK)
    actual_gap = {c["filename"] for c in curated} - _slack_covered(curated, slack_backblasts)
    assert actual_gap == expected_gap, (
        f"coverage gap changed.\n  unexpected: {sorted(actual_gap - expected_gap)}\n"
        f"  now covered: {sorted(expected_gap - actual_gap)}")


def _slack_covered(curated, slack_backblasts):
    from test_parser import _match_curated
    covered = set()
    for m in slack_backblasts:
        c = _match_curated(m, curated)
        if c:
            covered.add(c["filename"])
    return covered


# ---------------------------------------------------------------------------
# The daily sync, replayed over the fixture window.
# ---------------------------------------------------------------------------

from daily_slack_sync import (  # noqa: E402
    blocking_notes,
    find_near_duplicate,
    review_notes,
    roster_slugs,
)
from import_slack_backblast import make_slug, parse_message  # noqa: E402
from slack_import_runner import is_backblast  # noqa: E402


def test_near_duplicate_catches_a_hand_corrected_date():
    """Classic Ladders: Slack says 08-26, the repo has the corrected 08-27."""
    have = {"2026-08-27-classic-ladders"}
    assert find_near_duplicate("2026-08-26-classic-ladders", have) == \
        "2026-08-27-classic-ladders"


def test_near_duplicate_ignores_the_same_title_far_apart():
    """'11s' recurs legitimately; two months apart is a different workout."""
    assert find_near_duplicate("2026-07-16-11s", {"2026-05-16-11s"}) is None


def test_near_duplicate_ignores_different_titles():
    assert find_near_duplicate("2026-08-26-classic-ladders",
                               {"2026-08-27-swing-swing"}) is None


def test_replaying_the_window_imports_nothing_new(slack_backblasts):
    """The regression guard: running the sync daily over the last three months
    would have converged exactly on what is committed -- no new files, no
    duplicates. Any drift here means the automation and the curated corpus
    disagree about a workout that is already imported.
    """
    have = {f[:-3] for f in os.listdir(BACKBLAST_DIR) if f.endswith(".md")}
    would_write = []
    for m in slack_backblasts:
        assert is_backblast(m["text"])
        fields = parse_message(m["text"], ao_hint=m["channel_ao"])
        if blocking_notes(fields, roster_slugs()):
            continue
        slug = make_slug(fields["date"], fields["title"])
        if slug in have or find_near_duplicate(slug, have):
            continue
        would_write.append(slug)
    assert not would_write, (
        "sync would create files that duplicate curated content: " + str(would_write))


def test_emoji_title_blocks_the_import(slack_backblasts):
    """'7 of :gem:' is '7 of Diamonds'; stripping the emoji leaves '7 of'.

    That must block rather than write a 2026-08-13-7-of.md draft alongside the
    curated 2026-08-13-7-of-diamonds.md.
    """
    gem = next(m for m in slack_backblasts if ":gem:" in m["text"])
    fields = parse_message(gem["text"], ao_hint=gem["channel_ao"])
    assert fields["title"] == "7 of"
    assert any("title contained an emoji" in n
               for n in blocking_notes(fields, roster_slugs()))


def test_decorative_title_emoji_does_not_block(slack_backblasts):
    """':stopwatch: 17% Rest' strips to the title the curated file actually uses,
    so it should import without asking."""
    m = next(x for x in slack_backblasts if "17% Rest" in x["text"])
    fields = parse_message(m["text"], ao_hint=m["channel_ao"])
    assert fields["title"] == "17% Rest"
    assert blocking_notes(fields, roster_slugs()) == []


@pytest.mark.parametrize("title,blocks", [
    ("Backblast: :stopwatch: 20% Rest - Leg Day :leg:", False),
    ("Backblast: Waco Greatest Hits Mashup :surfer: :ladder: :timer_clock:", False),
    ("Backblast: :man_in_lotus_position: Bent out of Shape", False),
    ("Backblast: 7 of :gem:", True),
])
def test_title_emoji_blocking_matches_the_real_corpus(title, blocks):
    """All four emoji titles in the window, and whether each needs a human."""
    fields = parse_message(
        title + "\nWhere: #ao-beehive\nWhen: 09/08/26\nQ: @Waco\n"
        "PAX: @Waco @Dizzy\n\nThe Thang\n- Merkins", ao_hint="beehive")
    got = any("title contained an emoji" in n
              for n in blocking_notes(fields, roster_slugs()))
    assert got is blocks


def test_a_clean_backblast_is_neither_blocked_nor_flagged(slack_backblasts):
    """A well-formed backblast should import with no noise at all."""
    clean = next(m for m in slack_backblasts if "Swing Swing" in m["text"])
    fields = parse_message(clean["text"], ao_hint=clean["channel_ao"])
    assert blocking_notes(fields, roster_slugs()) == []
    assert review_notes(fields, roster_slugs()) == []


def test_an_unknown_pax_blocks_the_import():
    """An off-roster name may be an FNG's real name, which must never publish."""
    fields = parse_message(
        "Backblast: Test\nWhere: #ao-beehive\nWhen: 09/08/26\n"
        "Q: @Waco\nPAX: @Waco @Jonathan Smith\n\nThe Thang\n- Merkins",
        ao_hint="beehive")
    assert any("not on the roster" in n
               for n in blocking_notes(fields, roster_slugs()))


def test_a_bare_fng_marker_does_not_block():
    """'FNG' at the end of a PAX line is the normal way to note an unnamed new
    guy. It is dropped, and must not be mistaken for an off-roster name."""
    fields = parse_message(
        "Backblast: Test\nWhere: #ao-ad-astra\nWhen: 09/08/26\n"
        "Q: @Waco\nPAX: @Waco @Dizzy FNG\n\nThe Thang\n- Merkins",
        ao_hint="ad-astra")
    assert fields["pax"] == ["Waco", "Dizzy"]
    assert blocking_notes(fields, roster_slugs()) == []
