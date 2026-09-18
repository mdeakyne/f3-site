#!/usr/bin/env python3
"""
Parse a Slack backblast message and write a markdown file to content/backblasts/.
Usage: python3 import_slack_backblast.py <ao: ad-astra|beehive> < message.txt
"""
import re
import sys
import os
from datetime import datetime

CONTENT_DIR = os.path.join(os.path.dirname(__file__), '..', 'content', 'backblasts')

# Canonical name lookup: lowercase stripped key → canonical f3_name
CANONICAL = {
    # Wreck It variations
    'wreckit': 'Wreck It',
    'wreck-it': 'Wreck It',
    'wreck it': 'Wreck It',
    'icon': 'Wreck It',
    'wreck': 'Wreck It',
    # Carl Anderson / Medley
    'carl anderson': 'Medley',
    'carl': 'Medley',
    'medley': 'Medley',
    # Other known variations
    'dialup': 'Dial Up',
    'dial-up': 'Dial Up',
    'dial up': 'Dial Up',
    'farmersonly': 'Farmers Only',
    'farmers-only': 'Farmers Only',
    'farmers only': 'Farmers Only',
    'trainingwheels': 'Training Wheels',
    'training-wheels': 'Training Wheels',
    'bigtoe': 'Big Toe',
    'big-toe': 'Big Toe',
    'casio': 'Casio',
    # Wreck It is represented by the :wreck-it-ralph: emoji in Slack.
    # NOTE: "Trainwreck" is a DIFFERENT, separate PAX — do not collapse it here.
    'wreck-it-ralph': 'Wreck It',
}

# Slack channel ID → AO slug (Where: lines often use a bare <#CHANNELID> mention)
CHANNEL_TO_AO = {
    'c07a8stlz5z': 'beehive',
    'c05l33u97l4': 'ad-astra',
}

EMOJI_RE = re.compile(r':([a-z0-9_+\-]{2,}):', re.IGNORECASE)
# A PAX line annotates attendance in parentheses -- "@Dizzy (late)", "@Casio
# (FNG)", "FNG (real name)". None of it is part of the name, and dropping the
# last of those keeps an unnamed FNG's real name out of the repo.
ANNOTATION_RE = re.compile(r'\s*\([^)]*\)\s*$')


def normalize_name(raw: str) -> str:
    """Strip Slack link markup, leading @, annotations and emoji, then canonicalize."""
    # Strip Slack link: <@U12345|Name> or [@Name](url)
    raw = re.sub(r'<@[A-Z0-9]+\|([^>]+)>', r'\1', raw)
    raw = re.sub(r'\[@([^\]]+)\]\([^)]+\)', r'\1', raw)
    raw = re.sub(r'<@[A-Z0-9]+>', '', raw)
    # Strip leading @
    raw = raw.strip().lstrip('@').strip()
    raw = ANNOTATION_RE.sub('', raw).strip()
    if not raw:
        return ''
    # A PAX may be written as a Slack emoji, alone ("Q: :wreck-it-ralph:") or
    # decorating the name ("Q: Wreckit :wreck-it-ralph:"). Resolve the emoji
    # when it is all there is; otherwise it is decoration on a real name and
    # must not survive into the name itself.
    emoji = EMOJI_RE.findall(raw)
    stripped = EMOJI_RE.sub('', raw).strip(' :').strip()
    if not stripped:
        for name in emoji:
            if name.lower() in CANONICAL:
                return CANONICAL[name.lower()]
        return raw.strip()
    raw = stripped
    return CANONICAL.get(raw.lower().strip(), raw)

def slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"'", '', s)
    s = re.sub(r'[^a-z0-9]+', '-', s)
    return s.strip('-')

def parse_pax_line(line: str) -> list[str]:
    """Parse a PAX: line into a list of canonical names."""
    # Remove bold markers
    line = re.sub(r'\*\*', '', line)
    # Strip "PAX:" prefix
    line = re.sub(r'^PAX:\s*', '', line, flags=re.IGNORECASE)
    # The :wreck-it-ralph: emoji stands in for the PAX "Wreck It". Promote it to
    # its own @-delimited token so a space-separated "casio :wreck-it-ralph:"
    # doesn't get mashed into one name.
    line = re.sub(r':wreck-it-ralph:', ' @Wreck It ', line, flags=re.IGNORECASE)
    # Split on @ signs (most common Slack format: @Name1 @Name2 @Name3)
    # or commas
    names = []
    # Try @ split first
    if '@' in line:
        parts = re.split(r'[@,]+', line)
    else:
        parts = re.split(r',', line)
    for p in parts:
        p = p.strip()
        if not p:
            continue
        # Drop a trailing standalone "FNG" marker (an unnamed new guy noted after
        # the named PAX) and bare "FNG" tokens — FNG counts are derived from
        # first-appearance by update_fngs.py, not from this marker.
        p = re.sub(r'\s+FNG\s*$', '', p, flags=re.IGNORECASE).strip()
        if p.upper() == 'FNG' or not p:
            continue
        name = normalize_name(p)
        if name:
            names.append(name)
    return names

def parse_date(raw: str) -> str:
    """Parse various date formats into YYYY-MM-DD."""
    raw = raw.strip()
    # MM/DD/YYYY
    m = re.search(r'(\d{1,2})/(\d{1,2})/(\d{4})', raw)
    if m:
        return f"{m.group(3)}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"
    # YYYY-MM-DD
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})', raw)
    if m:
        return m.group(0)
    # MM/DD/YY (2-digit year, e.g. 6/16/26 -> 2026-06-16)
    m = re.search(r'(\d{1,2})/(\d{1,2})/(\d{2})(?!\d)', raw)
    if m:
        return f"20{m.group(3)}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"
    # MM-DD-YYYY (dash-separated, US month-first; e.g. 09-01-2026)
    m = re.search(r'(?<!\d)(\d{1,2})-(\d{1,2})-(\d{4})(?!\d)', raw)
    if m:
        return f"{m.group(3)}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"
    # MM-DD-YY (dash-separated, 2-digit year; e.g. 09-01-26 -> 2026-09-01).
    # Checked after YYYY-MM-DD above, so an ISO date is never misread here.
    m = re.search(r'(?<!\d)(\d{1,2})-(\d{1,2})-(\d{2})(?!\d)', raw)
    if m:
        return f"20{m.group(3)}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"
    # Month DD, YYYY
    m = re.search(r'([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})', raw)
    if m:
        try:
            dt = datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", '%B %d %Y')
            return dt.strftime('%Y-%m-%d')
        except ValueError:
            pass
    raise ValueError(f"Cannot parse date: {raw!r}")

def parse_ao(raw: str) -> str:
    """Map a Where: value to an AO slug, or '' if it can't be determined.

    Returning '' lets the caller fall back to the --ao hint instead of writing a
    raw channel mention (e.g. <#C05L33U97L4>) into the frontmatter.
    """
    raw = raw.lower()
    if 'beehive' in raw:
        return 'beehive'
    if 'ad-astra' in raw or 'ad_astra' in raw or 'adastra' in raw:
        return 'ad-astra'
    # Bare channel-ID mention: <#C05L33U97L4>
    for cid, slug in CHANNEL_TO_AO.items():
        if cid in raw:
            return slug
    return ''

# Title emoji that are pure decoration: dropping them leaves the title intact.
# Anything outside this set may be load-bearing (":gem:" means "Diamonds"), so
# the daily sync refuses to name the workout itself and asks for a human.
# Add to this set as new decorative emoji show up in titles.
DECORATIVE_EMOJI = {
    ':stopwatch:', ':timer_clock:', ':leg:', ':surfer:', ':ladder:', ':fire:',
    ':muscle:', ':man_in_lotus_position:', ':weight_lifter:', ':running:',
    ':snowflake:', ':sunny:', ':rain_cloud:', ':christmas_tree:', ':santa:',
    ':skull:', ':100:', ':star:', ':zap:', ':boom:', ':trophy:',
}


# Header fields at the top of a backblast. The colon is optional: several Qs
# post "Where <#C07A8STLZ5Z>" / "When 07/14/2026" / "Q @Dizzy" with no colon.
# A colon-less line is only treated as a header inside HEADER_WINDOW lines of
# the top, so body prose ("When you get tired, ...") is not mistaken for one.
_FIELD_RE = re.compile(
    r'^\*{0,2}(backblast|where|ao|when|q|pax)\*{0,2}\s*(:)?\s*(.*)$', re.IGNORECASE)
HEADER_WINDOW = 10

# The Circle of Trust is the personal share at the end of a workout. It is
# never published: none of the committed backblasts contain one.
_COT_RE = re.compile(r'^\s*\*{0,2}(cot|circle of trust)\b', re.IGNORECASE)


def strip_emphasis(s: str) -> str:
    """Drop wrapping Slack/markdown emphasis, e.g. *Backblast: Foo* -> Foo."""
    return s.strip().strip('*_').strip()


def parse_message(text: str, ao_hint: str | None = None) -> dict:
    """Parse a Slack backblast message into a dict of fields."""
    lines = text.splitlines()

    title = None
    date_str = None
    ao = ao_hint
    q_name = None
    pax = []
    body_lines = []
    in_body = False

    ao_from_where = None
    title_had_emoji = False

    for i, line in enumerate(lines):
        stripped = line.strip()

        # Everything from the CoT marker onward is dropped, not just the marker
        # line -- the share continues onto following lines.
        if _COT_RE.match(stripped):
            break

        m = _FIELD_RE.match(stripped)
        # A colon-less line only counts as a header near the top of the message.
        if m and (m.group(2) or i < HEADER_WINDOW):
            field = m.group(1).lower()
            value = strip_emphasis(re.sub(r'\*\*', '', m.group(3)))

            if field == 'backblast':
                # Drop Slack :emoji: codes (":stopwatch: 17% Rest" -> "17% Rest")
                raw_title = strip_emphasis(re.sub(r':[a-z0-9_+\-]+:', '', value))
                if raw_title:
                    title = raw_title
                    # An emoji can carry meaning the words do not: "7 of :gem:"
                    # is "7 of Diamonds". Decorative ones strip away cleanly
                    # (":stopwatch: 17% Rest" -> "17% Rest"), so only record
                    # emoji that are not known decoration.
                    title_had_emoji = bool(
                        set(re.findall(r':[a-z0-9_+\-]+:', value)) - DECORATIVE_EMOJI)
                continue

            if field == 'when':
                raw_date = re.sub(r'@.*$', '', value).strip()  # strip @5:30AM
                try:
                    date_str = parse_date(raw_date)
                except ValueError:
                    pass
                continue

            # "AO:" is an alias for "Where:" -- both name the workout location.
            if field in ('where', 'ao'):
                parsed_ao = parse_ao(value)
                if parsed_ao:
                    ao_from_where = parsed_ao
                continue

            if field == 'q':
                q_name = normalize_name(value)
                continue

            if field == 'pax':
                pax = parse_pax_line('PAX: ' + value)
                continue

        body_lines.append(line)

    # A Where:/AO: line is copy-pasted between AOs and is sometimes stale (the
    # 2026-06-30 TABADA backblast was posted in #ao-beehive but named the
    # ad-astra channel). Where the message was posted is the harder fact, so the
    # channel wins and the disagreement is reported for review.
    ao_conflict = bool(ao_hint and ao_from_where and ao_from_where != ao_hint)
    ao = ao_hint or ao_from_where or ao

    # Body: strip leading blank lines
    while body_lines and not body_lines[0].strip():
        body_lines.pop(0)

    if not title:
        # Try first non-empty body line
        for bl in body_lines:
            if bl.strip():
                title = bl.strip()[:80]
                break
        if not title:
            title = 'Untitled'

    if not date_str:
        raise ValueError("Could not parse date from message")

    # Ensure Q is in PAX list
    if q_name and q_name not in pax:
        pax.append(q_name)

    # Count FNGs
    fngs = sum(1 for p in pax if 'fng' in p.lower())

    return {
        'title': title,
        'date': date_str,
        'ao': ao or 'ad-astra',
        'q': q_name or '',
        'q_slug': slugify(q_name) if q_name else '',
        'pax': pax,
        'total_pax': len(pax),
        'fngs': fngs,
        'body': '\n'.join(body_lines),
        'ao_conflict': ao_conflict,
        'ao_from_where': ao_from_where,
        'title_had_emoji': title_had_emoji,
    }

def make_slug(date_str: str, title: str) -> str:
    return f"{date_str}-{slugify(title)}"

def yaml_str(s: str) -> str:
    """Quote a string for YAML if needed."""
    if not s:
        return "''"
    if any(c in s for c in ':#{}[]|>&*!,?-'):
        return f"'{s.replace(chr(39), chr(39)+chr(39))}'"
    if s.lstrip('-').replace('.', '', 1).isdigit():
        return f"'{s}'"
    return s

def write_backblast(fields: dict) -> str:
    slug = make_slug(fields['date'], fields['title'])
    out_path = os.path.join(CONTENT_DIR, f"{slug}.md")

    if os.path.exists(out_path):
        print(f"  SKIP (exists): {out_path}", file=sys.stderr)
        return out_path

    pax_yaml = '\n'.join(f"- {yaml_str(p)}" for p in fields['pax'])
    year = fields['date'][:4]
    vault_path = f"07 - F3/Backblasts/{year}/{slug}.md"

    fm = f"""---
slug: {yaml_str(slug)}
title: {yaml_str(fields['title'])}
date: '{fields['date']}'
ao: {fields['ao']}
q: {yaml_str(fields['q'])}
q_slug: {yaml_str(fields['q_slug'])}
pax:
{pax_yaml}
total_pax: {fields['total_pax']}
fngs: {fields['fngs']}
vault_path: {vault_path}
---"""

    body = fields['body'].strip()
    content = fm + ('\n\n' + body if body else '') + '\n'

    with open(out_path, 'w') as f:
        f.write(content)
    print(f"  WROTE: {out_path}", file=sys.stderr)
    return out_path

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--ao', help='AO hint: ad-astra or beehive')
    args = parser.parse_args()

    text = sys.stdin.read()
    fields = parse_message(text, ao_hint=args.ao)
    print(f"  Parsed: {fields['date']} | {fields['ao']} | Q: {fields['q']} | {fields['total_pax']} PAX", file=sys.stderr)
    write_backblast(fields)
