"""Shared fixtures: the sanitized Slack corpus and the curated repo backblasts.

The curated markdown in content/backblasts/ is the source of truth for what a
correct import looks like -- these tests replay the last three months of real
Slack messages through the importer and compare against it.
"""
import json
import os
import re
import sys

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts"))

FIXTURE_DIR = os.path.join(REPO_ROOT, "tests", "fixtures", "slack")
BACKBLAST_DIR = os.path.join(REPO_ROOT, "content", "backblasts")

# The fixture window. Keep in sync with `uv run tests/make_fixtures.py --oldest`.
WINDOW_START = "2026-06-08"

BACKBLAST_RE = re.compile(r"backblast\s*:", re.I)


def _unquote(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        return v[1:-1]
    return v


def parse_frontmatter(path: str) -> dict:
    """Minimal YAML reader for the flat frontmatter these files use."""
    raw = open(path).read()
    if not raw.startswith("---"):
        raise ValueError(f"{path}: no frontmatter")
    fm, _, body = raw[3:].partition("\n---")
    out, key = {"body": body.strip()}, None
    for line in fm.splitlines():
        if not line.strip():
            continue
        if line.startswith("- ") and key:
            out.setdefault(key, []).append(_unquote(line[2:]))
            continue
        m = re.match(r"^([a-z_]+):\s*(.*)$", line)
        if not m:
            continue
        key, val = m.group(1), m.group(2)
        out[key] = _unquote(val) if val else []
    for n in ("total_pax", "fngs"):
        if isinstance(out.get(n), str):
            out[n] = int(out[n])
    return out


@pytest.fixture(scope="session")
def slack_corpus() -> list[dict]:
    """Every sanitized Slack message in the window, tagged with its channel AO."""
    msgs = []
    for ao in ("beehive", "ad-astra"):
        data = json.load(open(os.path.join(FIXTURE_DIR, f"{ao}.json")))
        for m in data["messages"]:
            msgs.append({**m, "channel_ao": ao})
    return msgs


@pytest.fixture(scope="session")
def slack_backblasts(slack_corpus) -> list[dict]:
    """Just the messages that really are backblasts (hand-verified: 22 of them)."""
    return [m for m in slack_corpus if BACKBLAST_RE.search(m["text"])]


@pytest.fixture(scope="session")
def curated() -> list[dict]:
    """Curated repo backblasts inside the fixture window, newest last."""
    out = []
    for fname in sorted(os.listdir(BACKBLAST_DIR)):
        if not fname.endswith(".md") or fname[:10] < WINDOW_START:
            continue
        fm = parse_frontmatter(os.path.join(BACKBLAST_DIR, fname))
        fm["filename"] = fname
        out.append(fm)
    return out
