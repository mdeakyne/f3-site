#!/usr/bin/env python3
"""Regenerate content/data.json from all backblast and PAX markdown files."""
import json
import os
import re
from datetime import datetime, timezone
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(__file__), '..')
BACKBLASTS_DIR = os.path.join(ROOT, 'content', 'backblasts')
PAX_DIR = os.path.join(ROOT, 'content', 'pax')
DATA_JSON = os.path.join(ROOT, 'content', 'data.json')

def parse_frontmatter(path: str) -> dict:
    with open(path) as f:
        text = f.read()
    m = re.match(r'^---\n(.*?)\n---', text, re.DOTALL)
    if not m:
        return {}
    fm_text = m.group(1)

    result = {}
    lines = fm_text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        # List item
        if line.startswith('- '):
            i += 1
            continue
        kv = re.match(r'^(\w+(?:_\w+)*):\s*(.*)', line)
        if not kv:
            i += 1
            continue
        key = kv.group(1)
        val = kv.group(2).strip()

        # Check if next lines are list items
        list_items = []
        j = i + 1
        while j < len(lines) and lines[j].startswith('- '):
            item = lines[j][2:].strip().strip("'")
            list_items.append(item)
            j += 1

        if list_items:
            result[key] = list_items
            i = j
            continue

        # Scalar
        if val.startswith("'") and val.endswith("'"):
            val = val[1:-1]
        elif val == 'null':
            val = None
        elif val.lstrip('-').isdigit():
            val = int(val)
        result[key] = val
        i += 1

    return result

def load_pax() -> dict[str, dict]:
    """Load PAX profiles keyed by slug."""
    pax = {}
    for fname in os.listdir(PAX_DIR):
        if not fname.endswith('.md'):
            continue
        fm = parse_frontmatter(os.path.join(PAX_DIR, fname))
        if 'slug' in fm:
            pax[fm['slug']] = fm
    return pax

def slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"'", '', s)
    s = re.sub(r'[^a-z0-9]+', '-', s)
    return s.strip('-')

def load_backblasts() -> list[dict]:
    bbs = []
    for fname in sorted(os.listdir(BACKBLASTS_DIR)):
        if not fname.endswith('.md'):
            continue
        fm = parse_frontmatter(os.path.join(BACKBLASTS_DIR, fname))
        if fm:
            bbs.append(fm)
    return bbs

def build_data(bbs: list[dict], pax_profiles: dict[str, dict]) -> dict:
    # Tally posts and Qs per person
    posts_by_slug: dict[str, int] = defaultdict(int)
    qs_by_slug: dict[str, int] = defaultdict(int)
    aos_by_slug: dict[str, set] = defaultdict(set)
    earliest_by_slug: dict[str, str] = {}
    latest_by_slug: dict[str, str] = {}
    name_by_slug: dict[str, str] = {}

    # Seed canonical names from PAX profiles
    for slug, p in pax_profiles.items():
        name_by_slug[slug] = p.get('f3_name', slug)

    for bb in bbs:
        date = bb.get('date', '')
        ao = bb.get('ao', '')
        pax_list = bb.get('pax', [])
        q_slug = bb.get('q_slug', '')
        q_name = bb.get('q', '')

        if not q_slug and q_name:
            q_slug = slugify(q_name)

        for name in pax_list:
            if not name:
                continue
            slug = slugify(name)
            name_by_slug[slug] = name
            posts_by_slug[slug] += 1
            if ao:
                aos_by_slug[slug].add(ao)
            if date:
                if slug not in earliest_by_slug or date < earliest_by_slug[slug]:
                    earliest_by_slug[slug] = date
                if slug not in latest_by_slug or date > latest_by_slug[slug]:
                    latest_by_slug[slug] = date

        if q_slug:
            qs_by_slug[q_slug] += 1

    # Build leaderboard rows
    leaderboard = []
    for slug, count in posts_by_slug.items():
        # Use canonical name from profile if available
        f3_name = name_by_slug.get(slug, slug)
        leaderboard.append({
            'slug': slug,
            'f3_name': f3_name,
            'posts': count,
            'qs': qs_by_slug.get(slug, 0),
            'aos': sorted(aos_by_slug.get(slug, set())),
            'earliest': earliest_by_slug.get(slug),
            'latest': latest_by_slug.get(slug),
        })
    leaderboard.sort(key=lambda r: (-r['posts'], -r['qs']))

    # Latest backblasts (most recent 10)
    latest_bbs = sorted(bbs, key=lambda b: b.get('date', ''), reverse=True)[:10]
    latest_backblasts = [
        {
            'slug': b.get('slug', ''),
            'title': b.get('title', ''),
            'date': b.get('date', ''),
            'ao': b.get('ao', ''),
            'q': b.get('q', ''),
            'total_pax': b.get('total_pax'),
            'fngs': b.get('fngs'),
        }
        for b in latest_bbs
    ]

    dates = [b['date'] for b in bbs if b.get('date')]
    since_year = min(d[:4] for d in dates) if dates else '2023'
    latest_post = max(dates) if dates else ''

    return {
        'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'counts': {
            'backblasts': len(bbs),
            'pax': len(pax_profiles),
            'aos': 2,
            'since_year': since_year,
            'latest_post': latest_post,
        },
        'aos': [
            {'slug': 'beehive', 'name': 'beehive'},
            {'slug': 'ad-astra', 'name': 'ad-astra'},
        ],
        'leaderboard': leaderboard,
        'latest_backblasts': latest_backblasts,
    }

if __name__ == '__main__':
    print("Loading backblasts...", flush=True)
    bbs = load_backblasts()
    print(f"  {len(bbs)} backblasts loaded")

    print("Loading PAX profiles...", flush=True)
    pax = load_pax()
    print(f"  {len(pax)} PAX profiles loaded")

    print("Building data.json...", flush=True)
    data = build_data(bbs, pax)

    with open(DATA_JSON, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')

    print(f"  Written: {DATA_JSON}")
    print(f"  Backblasts: {data['counts']['backblasts']}")
    print(f"  Latest post: {data['counts']['latest_post']}")
    print(f"  Leaderboard entries: {len(data['leaderboard'])}")
