#!/usr/bin/env python3
"""Normalize legacy backblast bodies into conservative, semantic Markdown."""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Iterable


_FRONTMATTER_RE = re.compile(r"\A(---\r?\n.*?\r?\n---\r?\n)(.*)\Z", re.DOTALL)
_UNICODE_BULLET_RE = re.compile(r"^(\s*)[•◦▪]\s*(.*)$")
_MARKDOWN_LIST_RE = re.compile(r"^\s*(?:[-+*]|\d+[.)])\s+")
_MARKDOWN_HEADING_RE = re.compile(r"^#{1,6}\s+")

_SECTION_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^(?:the\s+)?warm[\s-]*up\b(.*)$", re.IGNORECASE), "Warm Up"),
    (re.compile(r"^the\s+thang\b(.*)$", re.IGNORECASE), "The Thang"),
    (re.compile(r"^mary\b(.*)$", re.IGNORECASE), "Mary"),
    (re.compile(r"^(?:the\s+)?game\b(.*)$", re.IGNORECASE), "The Game"),
    (re.compile(r"^c\.?\s*o\.?\s*t\.?\b(.*)$", re.IGNORECASE), "CoT"),
    (re.compile(r"^circle\s+of\s+trust\b(.*)$", re.IGNORECASE), "Circle of Trust"),
    (re.compile(r"^announcements?\b(.*)$", re.IGNORECASE), "Announcements"),
    (re.compile(r"^prayers?\b(.*)$", re.IGNORECASE), "Prayer"),
)


def _format_heading(line: str) -> str | None:
    stripped = line.strip()
    if not stripped or _MARKDOWN_HEADING_RE.match(stripped):
        return None

    for pattern, canonical in _SECTION_PATTERNS:
        match = pattern.fullmatch(stripped)
        if not match:
            continue
        suffix = match.group(1)
        if suffix and not re.match(r"^\s*(?::|[-–—]|\()", suffix):
            return None
        suffix = suffix.strip().rstrip(":").rstrip()
        if suffix.startswith(":"):
            detail = suffix[1:].strip()
            suffix = f": {detail}" if detail else ""
        elif suffix.startswith(("-", "–", "—")):
            suffix = f" {suffix[0]} {suffix[1:].strip()}"
        elif suffix.startswith("("):
            suffix = f" {suffix}"
        return f"## {canonical}{suffix}"
    return None


def _classify(line: str, in_fence: bool) -> str:
    if in_fence:
        return "fence"
    if not line.strip():
        return "blank"
    if _MARKDOWN_HEADING_RE.match(line.strip()):
        return "heading"
    if _MARKDOWN_LIST_RE.match(line):
        return "list"
    return "text"


def normalize_body(body: str) -> str:
    """Normalize recognized headings and explicit bullets in a Markdown body."""
    had_trailing_newline = body.endswith("\n")
    source_lines = body.splitlines()
    transformed: list[tuple[str, str]] = []
    in_fence = False

    for line in source_lines:
        if line.lstrip().startswith("```"):
            transformed.append((line, "fence"))
            in_fence = not in_fence
            continue
        if in_fence:
            transformed.append((line, "fence"))
            continue

        heading = _format_heading(line)
        if heading is not None:
            transformed.append((heading, "heading"))
            continue

        bullet = _UNICODE_BULLET_RE.match(line)
        if bullet:
            line = f"{bullet.group(1)}- {bullet.group(2).rstrip()}"
        transformed.append((line, _classify(line, False)))

    output: list[str] = []
    for index, (line, kind) in enumerate(transformed):
        previous_kind = transformed[index - 1][1] if index else None
        next_kind = transformed[index + 1][1] if index + 1 < len(transformed) else None

        if kind == "heading":
            if output and output[-1] != "":
                output.append("")
            output.append(line)
            if next_kind not in (None, "blank"):
                output.append("")
            continue

        if kind == "list" and output and output[-1] != "" and previous_kind not in ("list", "heading"):
            output.append("")
        elif kind == "text" and output and output[-1] != "" and previous_kind == "list" and not line.startswith((" ", "\t")):
            output.append("")

        output.append(line)

    normalized = "\n".join(output)
    if had_trailing_newline:
        normalized += "\n"
    return normalized


def normalize_document(document: str) -> str:
    """Normalize a backblast while preserving its frontmatter exactly."""
    match = _FRONTMATTER_RE.match(document)
    if not match:
        return normalize_body(document)
    return match.group(1) + normalize_body(match.group(2))


def _markdown_files(paths: Iterable[str]) -> list[Path]:
    files: set[Path] = set()
    for raw_path in paths:
        path = Path(raw_path)
        if path.is_dir():
            files.update(path.rglob("*.md"))
        elif path.suffix == ".md":
            files.add(path)
    return sorted(files)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="Report files needing normalization")
    mode.add_argument("--write", action="store_true", help="Normalize files in place")
    parser.add_argument("paths", nargs="+", help="Markdown files or directories")
    args = parser.parse_args()

    changed: list[Path] = []
    for path in _markdown_files(args.paths):
        original = path.read_text(encoding="utf-8")
        normalized = normalize_document(original)
        if normalized == original:
            continue
        changed.append(path)
        if args.write:
            path.write_text(normalized, encoding="utf-8")

    action = "Normalized" if args.write else "Needs normalization"
    for path in changed:
        print(f"{action}: {path}")
    return 1 if args.check and changed else 0


if __name__ == "__main__":
    raise SystemExit(main())
