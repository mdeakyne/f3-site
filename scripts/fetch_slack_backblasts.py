#!/usr/bin/env python3
"""
Fetch recent messages from an F3 Slack channel using the Slack Web API.

Uses the `slack_token` from the repo .env (the F3 Lawrence Slack app token,
NOT the Creative Planning MCP connection). Requires the token to have the
channels:history, channels:read, groups:history, groups:read, and users:read
scopes, and the bot (f3_lawrence_site) to be a member of the channel.

Outputs a JSON list of messages to stdout, each with a 'text' field, suitable
for piping into slack_import_runner.py. User mentions (<@U123>) are resolved to
@DisplayName so the importer can map them to canonical PAX names.

Usage:
  python3 fetch_slack_backblasts.py --channel C07A8STLZ5Z [--oldest 2026-05-19]
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime

SLACK_API = "https://slack.com/api"
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(REPO_ROOT, ".env")


def load_token() -> str:
    """Read slack_token from .env (simple KEY=VALUE parser)."""
    token = os.environ.get("slack_token")
    if token:
        return token.strip().strip("'\"")
    if not os.path.exists(ENV_PATH):
        sys.exit(f"No slack_token in environment and no .env at {ENV_PATH}")
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if line.startswith("slack_token="):
                return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit("slack_token not found in .env")


def slack_get(token: str, method: str, params: dict) -> dict:
    """Call a Slack Web API method with retry on rate limit."""
    url = f"{SLACK_API}/{method}?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                retry = int(e.headers.get("Retry-After", "2"))
                time.sleep(retry)
                continue
            raise
        if not data.get("ok"):
            if data.get("error") == "ratelimited":
                time.sleep(2)
                continue
            sys.exit(f"Slack API {method} failed: {data.get('error')} "
                     f"(needed={data.get('needed')})")
        return data
    sys.exit(f"Slack API {method} repeatedly rate limited")


_user_cache: dict[str, str] = {}


def resolve_user(token: str, user_id: str) -> str:
    if user_id in _user_cache:
        return _user_cache[user_id]
    data = slack_get(token, "users.info", {"user": user_id})
    prof = data.get("user", {}).get("profile", {})
    name = (prof.get("display_name") or prof.get("real_name")
            or data.get("user", {}).get("name") or user_id)
    _user_cache[user_id] = name
    return name


_MENTION_RE = __import__("re").compile(r"<@([A-Z0-9]+)(?:\|[^>]*)?>")


def resolve_mentions(token: str, text: str) -> str:
    def repl(m):
        return "@" + resolve_user(token, m.group(1))
    return _MENTION_RE.sub(repl, text)


def to_epoch(date_str: str) -> float:
    return datetime.strptime(date_str, "%Y-%m-%d").timestamp()


def fetch_channel(token: str, channel: str, oldest: float | None) -> list[dict]:
    messages = []
    cursor = None
    while True:
        params = {"channel": channel, "limit": 200}
        if oldest:
            params["oldest"] = f"{oldest:.6f}"
        if cursor:
            params["cursor"] = cursor
        data = slack_get(token, "conversations.history", params)
        for msg in data.get("messages", []):
            if msg.get("subtype"):  # skip joins, bot messages, etc.
                continue
            text = msg.get("text", "")
            if "<@" in text:
                text = resolve_mentions(token, text)
            messages.append({"text": text, "ts": msg.get("ts")})
        if data.get("has_more") and data.get("response_metadata", {}).get("next_cursor"):
            cursor = data["response_metadata"]["next_cursor"]
            continue
        break
    return messages


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--channel", required=True, help="Slack channel ID")
    parser.add_argument("--oldest", help="Only messages on/after this date (YYYY-MM-DD)")
    args = parser.parse_args()

    token = load_token()
    oldest = to_epoch(args.oldest) if args.oldest else None
    msgs = fetch_channel(token, args.channel, oldest)
    print(f"Fetched {len(msgs)} message(s) from {args.channel}", file=sys.stderr)
    json.dump(msgs, sys.stdout, indent=2)
