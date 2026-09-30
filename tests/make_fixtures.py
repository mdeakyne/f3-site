#!/usr/bin/env python3
"""
Regenerate the sanitized Slack test fixtures in tests/fixtures/slack/.

This repo is PUBLIC, so raw Slack exports must never be committed. What is and
is not safe to commit follows from what the site already publishes:

  * A backblast's header and workout body are already published verbatim in
    content/backblasts/*.md, so they are kept as-is. Everything from the CoT
    (Circle of Trust) marker onward is replaced with a single synthetic
    `CoT: <redacted for fixture>` line -- no CoT text appears in any of the
    committed backblasts, and that synthetic marker is what exercises the
    CoT-stripping test. A PAX line that introduces an FNG by real name has
    that name dropped, leaving the bare `FNG` marker the site publishes: the
    site keeps an unnamed FNG as `FNG` until they are given an F3 name, so a
    name is only kept in a fixture if content/pax/ actually publishes it.
  * Preblasts are kept as header lines only (title / Where / When / Q -- all
    published data), with any trailing prose dropped. They matter to the tests
    as near-misses for backblast detection.
  * Every other message is casual channel chatter, which is never published and
    may name an FNG before they have an F3 nickname. It is replaced with a
    `<chatter>` placeholder. The one exception is chatter that mentions the word
    "backblast" (e.g. "Sorry for the late backblast"): those are genuine
    false-positive risks for the detector, so their first line is kept.

Usage (requires slack_token in .env):
  uv run tests/make_fixtures.py --oldest 2026-06-08
"""
import argparse
import json
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts"))
OUT_DIR = os.path.join(REPO_ROOT, "tests", "fixtures", "slack")

from fetch_slack_backblasts import load_token, slack_get, resolve_mentions, to_epoch  # noqa: E402
from daily_slack_sync import KNOWN_OFF_ROSTER, roster_slugs  # noqa: E402
from import_slack_backblast import normalize_name, slugify  # noqa: E402

CHANNELS = {"beehive": "C07A8STLZ5Z", "ad-astra": "C05L33U97L4"}

BACKBLAST_RE = re.compile(r"backblast\s*:", re.I)
COT_RE = re.compile(r"^\s*\*?\*?(cot|circle of trust)\b", re.I)
PREBLAST_RE = re.compile(r"pre-?blast\s*:", re.I)
HEADER_RE = re.compile(r"^\s*\*?\*?(pre-?blast|where|when|ao|q|pax|coupon|coffee|ruck)\b", re.I)
# PAX lines sometimes introduce an FNG by real name ("FNG (Geoff)"). The site
# never publishes that, so neither does a fixture in this public repo.
FNG_NAME_RE = re.compile(r"\b(FNGs?)\b\s*\([^)]*\)", re.I)
PAX_LINE_RE = re.compile(r"^(\s*\*{0,2}pax\*{0,2}\s*:?\s*)(.*)$", re.I)
# A Q marks a nameless FNG with a bare trailing "FNG" and no name at all. It
# rides on the end of the previous token ("@Waco FNG"), so it has to come off
# before that token can be recognized -- parse_pax_line drops it the same way.
FNG_TAIL_RE = re.compile(r"\s+FNGs?\s*$", re.I)

_roster: set[str] | None = None


def published_slugs() -> set[str]:
    """Every F3 name the site publishes, plus the known off-roster PAX.

    Cached: a fixture run redacts hundreds of PAX lines and the roster cannot
    change underneath it.
    """
    global _roster
    if _roster is None:
        _roster = roster_slugs() | KNOWN_OFF_ROSTER
    return _roster


def redact_pax_line(line: str, roster: set[str]) -> str:
    """Replace any PAX on the line the site does not publish with a bare `FNG`.

    A Q lists a nameless FNG by their real name ("@Josiah Wegener"), which is
    indistinguishable from a real PAX name without the roster. The roster is
    the same test scripts/daily_slack_sync.py uses to refuse an import, so a
    name survives into a public fixture only if the site already publishes it
    as an F3 name. Matching goes through normalize_name() so a PAX's Slack
    spellings ("@Wreckit", ":wreck-it-ralph:") all resolve to their one
    canonical slug instead of reading as strangers. Redacting a legitimate
    newcomer is the safe direction to fail: it costs a fixture some fidelity,
    the other way leaks a name.
    """
    m = PAX_LINE_RE.match(line)
    if not m:
        return line
    head, rest = m.group(1), m.group(2)
    out = []
    for i, seg in enumerate(rest.split("@")):
        if i == 0:  # text before the first @ is the "PAX:" header itself
            out.append(seg)
            continue
        name = seg.strip()
        comma = "," if name.endswith(",") else ""
        bare = FNG_TAIL_RE.sub("", name.rstrip(",").strip()).strip()
        if not bare or bare.lower() == "fng" or slugify(normalize_name(bare)) in roster:
            out.append(seg)
        else:
            out.append(f"FNG{comma}")
    return head + "@".join(out)


def sanitize(text: str) -> str:
    """Reduce one Slack message to what is safe to commit (see module docstring)."""
    text = text or ""
    text = FNG_NAME_RE.sub(r"\1", text)
    if BACKBLAST_RE.search(text):
        # Header + workout body are already public; truncate at the CoT.
        out = []
        roster = published_slugs()
        for line in text.splitlines():
            if COT_RE.match(line):
                out.append("CoT: <redacted for fixture>")
                break
            out.append(redact_pax_line(line, roster))
        return "\n".join(out)
    if PREBLAST_RE.search(text):
        # Header lines only -- drop any trailing prose.
        return "\n".join(l for l in text.splitlines() if HEADER_RE.match(l))
    if "backblast" in text.lower():
        # A detection near-miss; short and non-personal, keep the first line.
        return text.strip().splitlines()[0][:120]
    return "<chatter>"


def fetch(token: str, channel: str, oldest: float) -> list[dict]:
    msgs, cursor = [], None
    while True:
        params = {"channel": channel, "limit": 200, "oldest": f"{oldest:.6f}"}
        if cursor:
            params["cursor"] = cursor
        data = slack_get(token, "conversations.history", params)
        for m in data.get("messages", []):
            if m.get("subtype"):
                continue
            text = m.get("text", "") or ""
            if "<@" in text:
                text = resolve_mentions(token, text)
            msgs.append({
                "ts": m["ts"],
                "text": sanitize(text),
                "n_files": len(m.get("files") or []),
                "reply_count": m.get("reply_count", 0),
            })
        cursor = (data.get("response_metadata") or {}).get("next_cursor")
        if not (data.get("has_more") and cursor):
            break
    msgs.sort(key=lambda m: float(m["ts"]))
    return msgs


def merge(existing: list[dict], fetched: list[dict]) -> list[dict]:
    """Union of both sets of messages, keyed by ts, freshly-fetched text winning.

    The committed fixtures are an ARCHIVE, not a snapshot: the workspace is on a
    plan that serves only ~90 days of history, so a message older than that can
    never be fetched again. Overwriting the file with a fresh fetch silently
    drops the oldest weeks (and the tests that depend on them); merging keeps
    them. --replace exists for the rare case of re-sanitizing from scratch.
    """
    by_ts = {m["ts"]: m for m in existing}
    by_ts.update({m["ts"]: m for m in fetched})
    return sorted(by_ts.values(), key=lambda m: float(m["ts"]))


def load_existing(path: str) -> tuple[list[dict], str | None]:
    if not os.path.exists(path):
        return [], None
    with open(path) as f:
        data = json.load(f)
    return data.get("messages", []), data.get("oldest")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--oldest", default="2026-06-08", help="YYYY-MM-DD")
    ap.add_argument("--replace", action="store_true",
                    help="discard the committed messages instead of merging "
                         "(loses anything Slack no longer serves)")
    args = ap.parse_args()

    token = load_token()
    oldest = to_epoch(args.oldest)
    os.makedirs(OUT_DIR, exist_ok=True)
    for ao, cid in CHANNELS.items():
        path = os.path.join(OUT_DIR, f"{ao}.json")
        fetched = fetch(token, cid, oldest)
        if args.replace:
            msgs, kept, oldest_field = fetched, 0, args.oldest
        else:
            existing, prev_oldest = load_existing(path)
            msgs = merge(existing, fetched)
            kept = len(msgs) - len(fetched)
            # The window the fixture covers is the earlier of the two.
            oldest_field = min(filter(None, [prev_oldest, args.oldest]))
        with open(path, "w") as f:
            json.dump({"ao": ao, "channel": cid, "oldest": oldest_field,
                       "messages": msgs}, f, indent=2)
            f.write("\n")
        n_bb = sum(1 for m in msgs if BACKBLAST_RE.search(m["text"]))
        note = f", {kept} kept from the committed archive" if kept else ""
        print(f"{ao}: {len(msgs)} messages ({n_bb} backblasts{note}) -> {path}")
