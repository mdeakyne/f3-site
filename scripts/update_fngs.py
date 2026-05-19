#!/usr/bin/env python3
"""Calculate and write FNG counts to all backblast frontmatter."""
import os
import re
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(__file__), '..')
BACKBLASTS_DIR = os.path.join(ROOT, 'content', 'backblasts')


def slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"'", '', s)
    s = re.sub(r'[^a-z0-9]+', '-', s)
    return s.strip('-')


def parse_frontmatter(text: str) -> dict:
    m = re.match(r'^---\n(.*?)\n---', text, re.DOTALL)
    if not m:
        return {}
    fm_text = m.group(1)
    result = {}
    lines = fm_text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith('- '):
            i += 1
            continue
        kv = re.match(r'^(\w+(?:_\w+)*):\s*(.*)', line)
        if not kv:
            i += 1
            continue
        key = kv.group(1)
        val = kv.group(2).strip()
        list_items = []
        j = i + 1
        while j < len(lines) and lines[j].startswith('- '):
            item = lines[j][2:].strip()
            if len(item) >= 2 and item[0] == item[-1] and item[0] in ("'", '"'):
                item = item[1:-1]
            list_items.append(item)
            j += 1
        if list_items:
            result[key] = list_items
            i = j
            continue
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            val = val[1:-1]
        elif val == 'null':
            val = None
        elif val.lstrip('-').isdigit():
            val = int(val)
        result[key] = val
        i += 1
    return result


def pax_slugs(fm: dict) -> set[str]:
    slugs = set()
    for name in (fm.get('pax') or []):
        if name:
            slugs.add(slugify(name))
    q_slug = fm.get('q_slug') or (slugify(fm['q']) if fm.get('q') else None)
    if q_slug:
        slugs.add(q_slug)
    return slugs


def main():
    files = sorted(f for f in os.listdir(BACKBLASTS_DIR) if f.endswith('.md'))

    # Load all backblasts in chronological order (filename sort = date sort)
    backblasts = []
    for fname in files:
        path = os.path.join(BACKBLASTS_DIR, fname)
        with open(path) as f:
            text = f.read()
        fm = parse_frontmatter(text)
        if fm:
            backblasts.append((fname, path, text, fm))

    # Pass 1: determine first-seen date per slug across all backblasts.
    # When two workouts share the same date, process them in filename order
    # (alphabetical by AO) so FNG credit goes to the first file only.
    first_seen: dict[str, str] = {}
    for fname, path, text, fm in backblasts:
        date = fm.get('date', '')
        slugs = pax_slugs(fm)
        for slug in slugs:
            if slug not in first_seen:
                first_seen[slug] = date

    # Pass 2: for each backblast count how many slugs have first_seen == this date,
    # then rewrite the fngs line.
    changes = 0
    mismatches = []
    for fname, path, text, fm in backblasts:
        date = fm.get('date', '')
        slugs = pax_slugs(fm)
        calculated = sum(1 for s in slugs if first_seen.get(s) == date)

        current = fm.get('fngs')
        if current != calculated:
            if current not in (0, None) and current != calculated:
                mismatches.append((fname, current, calculated))
            # Rewrite fngs line in frontmatter
            new_text = re.sub(
                r'^fngs:.*$',
                f'fngs: {calculated}',
                text,
                count=1,
                flags=re.MULTILINE,
            )
            with open(path, 'w') as f:
                f.write(new_text)
            changes += 1

    print(f"Updated {changes} backblast files.")
    if mismatches:
        print("\nMismatches (manually-set vs calculated) — please review:")
        for fname, old, new in mismatches:
            print(f"  {fname}: was {old}, now {new}")
    else:
        print("No mismatches with previously non-zero FNG values.")


if __name__ == '__main__':
    main()
