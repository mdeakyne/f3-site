#!/usr/bin/env python3
"""
Called from Claude Code with Slack MCP available.
Reads channel messages as JSON (provided via stdin or as argument),
identifies backblasts not yet in content/backblasts/, and imports them.

Expected input format: JSON list of Slack messages from slack_read_channel.
Each message is expected to have a 'text' field.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from import_slack_backblast import parse_message, write_backblast, make_slug

CONTENT_DIR = os.path.join(os.path.dirname(__file__), '..', 'content', 'backblasts')

EXISTING = {f[:-3] for f in os.listdir(CONTENT_DIR) if f.endswith('.md')}


def is_backblast(text: str) -> bool:
    return bool(re.search(r'backblast\s*:', text, re.IGNORECASE))


def already_imported(date_str: str, title: str) -> bool:
    slug = make_slug(date_str, title)
    return slug in EXISTING


def process_messages(messages: list[dict], ao_hint: str) -> int:
    imported = 0
    for msg in messages:
        text = msg.get('text', '')
        if not is_backblast(text):
            continue
        try:
            fields = parse_message(text, ao_hint=ao_hint)
        except ValueError as e:
            print(f"  PARSE ERROR: {e} — skipping", file=sys.stderr)
            continue

        if already_imported(fields['date'], fields['title']):
            print(f"  SKIP (exists): {fields['date']} {fields['title']}", file=sys.stderr)
            continue

        print(f"  IMPORT: {fields['date']} | {fields['ao']} | Q: {fields['q']} | {fields['total_pax']} PAX | {fields['title']}", file=sys.stderr)
        write_backblast(fields)
        imported += 1

    return imported


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--ao', required=True, help='ad-astra or beehive')
    args = parser.parse_args()

    data = json.load(sys.stdin)
    # data may be a list of messages or a dict with a messages key
    if isinstance(data, dict):
        messages = data.get('messages', data.get('results', [data]))
    else:
        messages = data

    count = process_messages(messages, ao_hint=args.ao)
    print(f"Imported {count} new backblast(s) for {args.ao}", file=sys.stderr)
