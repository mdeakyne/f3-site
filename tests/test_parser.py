"""Replay three months of real Slack backblasts through the importer.

Every case here comes from an actual message in #ao-beehive or #ao-ad-astra
between 2026-06-08 and 2026-09-18.
"""
import re

import pytest

from import_slack_backblast import (
    normalize_name,
    parse_date,
    parse_message,
    slugify,
)
from slack_import_runner import is_backblast

from conftest import BACKBLAST_RE

# ---------------------------------------------------------------------------
# Dates. Every spelling below appears verbatim in a real backblast's When: line.
# ---------------------------------------------------------------------------

REAL_DATE_SPELLINGS = [
    ("08/25/2026@ 05:30", "2026-08-25"),   # no space before @time
    ("07/21/2026 @ 05:30", "2026-07-21"),
    ("06/23/26 @ 0530", "2026-06-23"),
    ("08/26/26 0530", "2026-08-26"),       # 2-digit year, bare time
    ("6/30/26", "2026-06-30"),             # 1-digit month
    ("07/16/26", "2026-07-16"),
    ("09-01-26  0530", "2026-09-01"),      # dash-separated, double space
    ("09-07-26 0530", "2026-09-07"),
]


@pytest.mark.parametrize("raw,expected", REAL_DATE_SPELLINGS)
def test_real_date_spellings_parse(raw, expected):
    assert parse_date(raw) == expected


def test_ambiguous_dash_date_is_month_first():
    """09-01-26 is Sept 1 2026 (US month-first), not Jan 26 2009."""
    assert parse_date("09-01-26") == "2026-09-01"


# ---------------------------------------------------------------------------
# Detection: real backblasts in, preblasts and chatter out.
# ---------------------------------------------------------------------------

def test_detects_every_real_backblast(slack_backblasts):
    assert len(slack_backblasts) == 26, "fixture corpus changed"
    for m in slack_backblasts:
        assert is_backblast(m["text"]), m["text"][:60]


def test_rejects_preblasts_and_chatter(slack_corpus):
    """A preblast announces a workout; importing one would invent a backblast."""
    misfires = [
        m["text"][:70] for m in slack_corpus
        if not BACKBLAST_RE.search(m["text"]) and is_backblast(m["text"])
    ]
    assert not misfires, f"false positives: {misfires}"


@pytest.mark.parametrize("text", [
    "Sorry for the late backblast",              # real chatter, 2026-08-05
    "Need a backblast for this one.",            # real thread reply, 2026-07-01
    "Anyone got the Q tomorrow? ",
    "Preblast: football drills",
    "Pre-blast: 11s\nWhere: <#C05L33U97L4>\nWhen: 07/16/26 0530\nQ: @404",
    "Backblast: coming tonight",                 # placeholder, no Q/PAX
    "Sorry for the late backblast: my bad",      # colon mid-sentence
    "Reminder: post your backblast: it helps",
])
def test_rejects_near_miss_messages(text):
    assert not is_backblast(text)


# ---------------------------------------------------------------------------
# Names.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw", [
    "wreckit", "Wreckit", "wreck-it", "Wreck-It", "@ wreck it", ":wreck-it-ralph:",
])
def test_wreck_it_variants_collapse(raw):
    """Six spellings of one PAX appear across the window; all are one identity.

    PAX identity is the slug -- that is what groups the leaderboard and links
    the PAX pages -- so slug equality is the invariant, not display spelling.
    """
    assert slugify(normalize_name(raw)) == "wreck-it"


@pytest.mark.xfail(reason="display-name drift: content/pax/wreck-it.md says "
                          "'Wreck It' but recent backblasts say 'Wreck-It'. "
                          "Cosmetic only (same slug); needs a decision on which "
                          "spelling is canonical.", strict=True)
def test_display_name_matches_pax_profile():
    import os
    from conftest import REPO_ROOT
    profile = open(os.path.join(REPO_ROOT, "content", "pax", "wreck-it.md")).read()
    canonical = re.search(r"^f3_name:\s*(.+)$", profile, re.M).group(1).strip()
    assert normalize_name("wreckit") == canonical == "Wreck-It"


def test_trainwreck_is_a_different_pax():
    assert normalize_name("Trainwreck") != normalize_name("Wreckit")


def test_404_survives_slugify():
    assert slugify("404") == "404"


# ---------------------------------------------------------------------------
# Golden comparison against the curated repo files.
# ---------------------------------------------------------------------------

# Cases where Slack alone cannot produce the curated file. Each is a real
# judgment call a human made; the automation must surface them, not guess.
KNOWN_EXCEPTIONS = {
    "Classic Ladders": {
        "reason": "Slack says 08/26/26 but the workout was 08/27; corrected in PR #33",
        "field": "date",
    },
    "7 of :gem:": {
        "reason": "title emoji :gem: means 'Diamonds' -- needs a human to name it",
        "field": "title",
        "curated_file": "2026-08-13-7-of-diamonds.md",
    },
    "Wreckit's Centennial": {
        "reason": "Slack says 09-07-26, a Monday; beehive is Tuesday and the "
                  "preblast went up that Monday, so the workout was 09-08",
        "field": "date",
    },
    ": :wreck-it-ralph: Birthday Bash": {
        "reason": "title is an emoji standing in for a PAX name, and Slack says "
                  "09-09-2026, a Wednesday; ad-astra is Thursday, so 09-10",
        "field": ["title", "date"],
        "curated_file": "2026-09-10-wreckits-birthday-bash.md",
    },
}


def _norm_title(t: str) -> str:
    t = re.sub(r":[a-z0-9_+\-]+:", "", t or "").lower()
    return re.sub(r"[^a-z0-9]+", "", t)


def _raw_title(msg) -> str:
    head = msg["text"].splitlines()[0].strip("* ")
    return re.sub(r"^backblast\s*:\s*", "", head, flags=re.I).strip()


def _match_curated(msg, curated):
    """Pair a Slack message with its curated file by title (dates can be wrong)."""
    raw = _raw_title(msg)
    pinned = KNOWN_EXCEPTIONS.get(raw, {}).get("curated_file")
    if pinned:
        return next((c for c in curated if c["filename"] == pinned), None)
    want = _norm_title(raw)
    for c in curated:
        if _norm_title(c["title"]) == want:
            return c
    return None


def test_every_slack_backblast_matches_a_curated_file(slack_backblasts, curated):
    unmatched = [m["text"].splitlines()[0] for m in slack_backblasts
                 if _match_curated(m, curated) is None]
    assert not unmatched, f"no curated file found for: {unmatched}"


def test_golden_fields(slack_backblasts, curated):
    """Parsed date / ao / q / pax must equal the curated file, exception cases aside."""
    failures = []
    for m in slack_backblasts:
        raw_title = _raw_title(m)
        exc = KNOWN_EXCEPTIONS.get(raw_title, {})
        c = _match_curated(m, curated)
        if c is None:
            continue
        try:
            got = parse_message(m["text"], ao_hint=m["channel_ao"])
        except ValueError as e:
            failures.append(f"{raw_title}: PARSE FAILED ({e})")
            continue
        excused = exc.get("field") or ()
        excused = [excused] if isinstance(excused, str) else excused
        for field in ("date", "ao", "q"):
            if field in excused:
                continue
            # Display spelling of a name is drifting (see the xfail on
            # test_display_name_matches_pax_profile); slug is the identity.
            same = (slugify(got[field] or "") == slugify(c[field] or "")
                    if field == "q" else got[field] == c[field])
            if not same:
                failures.append(
                    f"{raw_title}: {field} got {got[field]!r} want {c[field]!r}")
        got_pax = sorted(slugify(p) for p in got["pax"])
        want_pax = sorted(slugify(p) for p in c["pax"] if p != "FNG")
        if got_pax != want_pax:
            failures.append(f"{raw_title}: pax got {got_pax} want {want_pax}")
    assert not failures, "\n".join(failures)


def test_known_exceptions_are_still_real(slack_backblasts, curated):
    """Guard the exception list: if Slack starts agreeing, delete the entry."""
    stale = []
    for m in slack_backblasts:
        raw_title = _raw_title(m)
        exc = KNOWN_EXCEPTIONS.get(raw_title)
        if not exc:
            continue
        c = _match_curated(m, curated)
        try:
            got = parse_message(m["text"], ao_hint=m["channel_ao"])
        except ValueError:
            continue
        fields = exc["field"]
        fields = [fields] if isinstance(fields, str) else fields
        for field in fields:
            if field == "title":
                continue
            if got[field] == c[field]:
                stale.append(f"{raw_title}: {field} now agrees; drop the exception")
    assert not stale, "\n".join(stale)


def test_stale_where_line_loses_to_the_posting_channel(slack_backblasts):
    """2026-06-30 TABADA was posted in #ao-beehive but its Where: names ad-astra.

    The curated file says beehive, so the channel must win -- and the parser
    must flag the disagreement rather than swallow it.
    """
    tabada = next(m for m in slack_backblasts if "TABADA" in m["text"])
    got = parse_message(tabada["text"], ao_hint=tabada["channel_ao"])
    assert got["ao"] == "beehive"
    assert got["ao_from_where"] == "ad-astra"
    assert got["ao_conflict"] is True


def test_no_ao_conflict_when_where_line_agrees(slack_backblasts):
    conflicts = [_raw_title(m) for m in slack_backblasts
                 if "TABADA" not in m["text"]
                 and parse_message(m["text"], ao_hint=m["channel_ao"])["ao_conflict"]]
    assert not conflicts, f"unexpected AO conflicts: {conflicts}"


# ---------------------------------------------------------------------------
# Output hygiene -- what must never reach a public page.
# ---------------------------------------------------------------------------

COT_RE = re.compile(r"^\s*\*?\*?(cot|circle of trust)\b", re.I | re.M)


def test_cot_never_survives_parsing(slack_backblasts):
    """CoT is personal; none of the 273 curated files contain one."""
    leaked = []
    for m in slack_backblasts:
        if not COT_RE.search(m["text"]):
            continue
        try:
            got = parse_message(m["text"], ao_hint=m["channel_ao"])
        except ValueError:
            continue
        if COT_RE.search(got["body"]):
            leaked.append(m["text"].splitlines()[0])
    assert not leaked, f"CoT survived in: {leaked}"


def test_curated_corpus_has_no_cot(curated):
    assert not [c["filename"] for c in curated if COT_RE.search(c["body"])]


def test_no_unresolved_emoji_in_names(slack_backblasts):
    """An emoji nickname the CANONICAL map misses must not become a PAX name."""
    bad = []
    for m in slack_backblasts:
        try:
            got = parse_message(m["text"], ao_hint=m["channel_ao"])
        except ValueError:
            continue
        for name in got["pax"] + [got["q"]]:
            if re.search(r":[a-z0-9_+\-]{2,}:", name or ""):
                bad.append(f"{m['text'].splitlines()[0]}: {name!r}")
    assert not bad, "\n".join(bad)


def _roster_slugs() -> set[str]:
    import os
    from conftest import REPO_ROOT
    d = os.path.join(REPO_ROOT, "content", "pax")
    return {f[:-3] for f in os.listdir(d) if f.endswith(".md")}


def test_unnamed_fngs_never_become_a_name(slack_backblasts):
    """FNGs stay 'FNG' until they earn a nickname -- never a real name.

    Three backblasts in the window end their PAX line with a bare 'FNG' marker.
    That marker must be dropped, never emitted as a PAX called 'Fng' and never
    absorbed into the preceding name.
    """
    for m in slack_backblasts:
        if not re.search(r"\bFNG\b", m["text"]):
            continue
        got = parse_message(m["text"], ao_hint=m["channel_ao"])
        assert not any("fng" in p.lower() for p in got["pax"]), \
            f"{_raw_title(m)}: {got['pax']}"


# PAX who post but have no content/pax/*.md profile. content/pax/ is an
# incomplete roster (61 profiles vs 64 PAX on the leaderboard), so this is a
# pre-existing content gap, not a parsing failure. Brick is the only one inside
# the fixture window; gypsy and honeystinger are earlier.
KNOWN_OFF_ROSTER = {"brick"}


def test_off_roster_pax_are_exactly_the_known_gaps(slack_backblasts):
    """An off-roster name is a new PAX, a missing profile, or a leaked real name.

    All three need a human, so the sync script gates on this signal. The test
    pins the current set so a genuinely new name shows up as a failure.
    """
    roster = _roster_slugs()
    found = set()
    for m in slack_backblasts:
        got = parse_message(m["text"], ao_hint=m["channel_ao"])
        for name in got["pax"]:
            if slugify(name) not in roster:
                found.add(slugify(name))
    assert found == KNOWN_OFF_ROSTER, (
        f"off-roster PAX changed: new={sorted(found - KNOWN_OFF_ROSTER)} "
        f"resolved={sorted(KNOWN_OFF_ROSTER - found)}")


def test_emoji_nickname_resolves_on_a_q_line():
    """A Q written as a bare emoji must not become a literal ':emoji:' name.

    The 2026-09-07 preblast uses "Q: :wreck-it-ralph:"; the matching backblast
    will too.
    """
    assert slugify(normalize_name(":wreck-it-ralph:")) == "wreck-it"


def test_body_prose_starting_with_a_field_name_is_not_eaten(slack_backblasts):
    """Colon-less headers are only honoured near the top of the message.

    "Life is a Gamble" writes its headers without colons ("Q @Farmers Only")
    and later has a body line "Q deals , starts with dealing 2 cards...". The
    header window keeps the second one in the body.
    """
    m = next(x for x in slack_backblasts if "Life is a Gamble" in x["text"])
    got = parse_message(m["text"], ao_hint=m["channel_ao"])
    assert got["q"] == "Farmers Only"
    assert "Q deals" in got["body"]


def test_colonless_headers_parse(slack_backblasts):
    """Three backblasts in the window omit the colon on every header line."""
    for title in ("Just a grinder", "Life is a Gamble", "TABADA"):
        m = next(x for x in slack_backblasts if title in x["text"])
        got = parse_message(m["text"], ao_hint=m["channel_ao"])
        assert got["date"], title
        assert got["q"], title
        assert len(got["pax"]) >= 4, (title, got["pax"])


def test_ao_label_is_accepted_as_where(slack_backblasts):
    """The 2026-09-01 backblast uses '*AO:*' instead of 'Where:'."""
    m = next(x for x in slack_backblasts if "Feeling Low" in x["text"])
    got = parse_message(m["text"], ao_hint="beehive")
    assert got["ao"] == "beehive"
    assert got["ao_from_where"] == "beehive"
    assert got["ao_conflict"] is False


def test_wrapping_emphasis_is_stripped_from_the_title(slack_backblasts):
    """'*Backblast: Feeling Low, Feeling Negative*' must not keep the asterisk."""
    m = next(x for x in slack_backblasts if "Feeling Low" in x["text"])
    got = parse_message(m["text"], ao_hint="beehive")
    assert got["title"] == "Feeling Low, Feeling Negative"
