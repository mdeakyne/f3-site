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
}

def normalize_name(raw: str) -> str:
    """Strip Slack link markup, leading @, then apply canonical lookup."""
    # Strip Slack link: <@U12345|Name> or [@Name](url)
    raw = re.sub(r'<@[A-Z0-9]+\|([^>]+)>', r'\1', raw)
    raw = re.sub(r'\[@([^\]]+)\]\([^)]+\)', r'\1', raw)
    raw = re.sub(r'<@[A-Z0-9]+>', '', raw)
    # Strip leading @
    raw = raw.strip().lstrip('@').strip()
    if not raw:
        return ''
    key = raw.lower().strip()
    return CANONICAL.get(key, raw)

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
    """Map Slack channel mention to AO slug."""
    raw = raw.lower()
    if 'beehive' in raw:
        return 'beehive'
    if 'ad-astra' in raw or 'ad_astra' in raw or 'adastra' in raw:
        return 'ad-astra'
    # fallback: strip # and leading ao-
    raw = re.sub(r'^#?ao[-_]?', '', raw).strip()
    return raw or 'ad-astra'

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

    for i, line in enumerate(lines):
        stripped = line.strip()
        clean = re.sub(r'\*\*', '', stripped).strip()

        # Title: Backblast: <title>
        if re.match(r'\*?\*?backblast\s*:', stripped, re.IGNORECASE):
            raw_title = re.sub(r'\*?\*?backblast\s*:\s*', '', stripped, flags=re.IGNORECASE)
            raw_title = re.sub(r'\*\*', '', raw_title).strip()
            if raw_title:
                title = raw_title

        # Date
        elif re.match(r'\*?\*?when\s*:', stripped, re.IGNORECASE):
            raw_date = re.sub(r'\*?\*?when\s*:\s*', '', stripped, flags=re.IGNORECASE)
            raw_date = re.sub(r'\*\*', '', raw_date).strip()
            raw_date = re.sub(r'@.*$', '', raw_date).strip()  # strip @5:30AM
            try:
                date_str = parse_date(raw_date)
            except ValueError:
                pass

        # AO / Where
        elif re.match(r'\*?\*?where\s*:', stripped, re.IGNORECASE):
            raw_ao = re.sub(r'\*?\*?where\s*:\s*', '', stripped, flags=re.IGNORECASE)
            raw_ao = re.sub(r'\*\*', '', raw_ao).strip()
            ao = parse_ao(raw_ao)

        # Q
        elif re.match(r'\*?\*?q\s*:', stripped, re.IGNORECASE):
            raw_q = re.sub(r'\*?\*?q\s*:\s*', '', stripped, flags=re.IGNORECASE)
            raw_q = re.sub(r'\*\*', '', raw_q).strip()
            q_name = normalize_name(raw_q)

        # PAX
        elif re.match(r'\*?\*?pax\s*:', stripped, re.IGNORECASE):
            pax = parse_pax_line(stripped)

        # Everything else is body
        else:
            body_lines.append(line)

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
