#!/usr/bin/env python3
"""Normalize legacy backblast bodies into conservative, semantic Markdown."""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Iterable


_FRONTMATTER_RE = re.compile(r"\A(---\r?\n.*?\r?\n---\r?\n)(.*)\Z", re.DOTALL)
_MARKDOWN_LIST_RE = re.compile(r"^\s*(?:[-+*]|\d+[.)])\s+")
_MARKDOWN_HEADING_RE = re.compile(r"^#{1,6}\s+")
_FENCE_RE = re.compile(r"^( {0,3})(`{3,}|~{3,})(.*)$")

_SECTION_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^(?:the\s+)?warm[\s-]*up\b(.*)$", re.IGNORECASE), "Warm Up"),
    (re.compile(r"^the\s+thang\b(.*)$", re.IGNORECASE), "The Thang"),
    (re.compile(r"^(?:the\s+)?mary\b(.*)$", re.IGNORECASE), "Mary"),
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
    if stripped.startswith("**") and stripped.endswith("**") and len(stripped) > 4:
        stripped = stripped[2:-2].strip()

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
        label = stripped[: match.start(1)].rstrip()
        return f"## {label}{suffix}"
    return None


def _unicode_bullet_positions(line: str) -> list[int]:
    positions: list[int] = []
    inline_delimiter = 0
    index = 0
    while index < len(line):
        if line[index] == "`":
            run_end = index
            while run_end < len(line) and line[run_end] == "`":
                run_end += 1
            run_length = run_end - index
            if inline_delimiter == 0:
                inline_delimiter = run_length
            elif run_length == inline_delimiter:
                inline_delimiter = 0
            index = run_end
            continue
        if (
            inline_delimiter == 0
            and line[index] in "•◦▪"
            and index + 1 < len(line)
            and line[index + 1].isspace()
        ):
            positions.append(index)
        index += 1
    return positions


def _expand_unicode_bullets(line: str) -> list[str]:
    positions = _unicode_bullet_positions(line)
    if not positions:
        return [line]
    indent = re.match(r"^\s*", line).group(0)
    first_content = len(indent)
    starts_with_unicode_bullet = positions[0] == first_content
    if not starts_with_unicode_bullet and not _MARKDOWN_LIST_RE.match(line):
        return [line]

    boundaries = positions + [len(line)]
    items: list[str] = []
    prefix = line[: positions[0]].strip()
    if prefix:
        prefix = re.sub(r"^(?:[-+*]|\d+[.)])\s+", "", prefix)
        if prefix:
            items.append(prefix)
    for start, end in zip(positions, boundaries[1:]):
        item = line[start + 1 : end].strip()
        if item:
            items.append(item)
    return [f"{indent}- {item}" for item in items] or [line]


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
    fence_char: str | None = None
    fence_length = 0

    for line in source_lines:
        fence_match = _FENCE_RE.match(line)
        if fence_char is not None:
            transformed.append((line, "fence"))
            if (
                fence_match
                and fence_match.group(2)[0] == fence_char
                and len(fence_match.group(2)) >= fence_length
                and not fence_match.group(3).strip()
            ):
                fence_char = None
                fence_length = 0
            continue
        if fence_match:
            transformed.append((line, "fence"))
            fence_char = fence_match.group(2)[0]
            fence_length = len(fence_match.group(2))
            continue
        if line.startswith(("    ", "\t")):
            transformed.append((line, "fence"))
            continue

        heading = _format_heading(line) if line == line.lstrip() else None
        if heading is not None:
            transformed.append((heading, "heading"))
            continue

        for expanded_line in _expand_unicode_bullets(line):
            transformed.append((expanded_line, _classify(expanded_line, False)))

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
        original = path.read_bytes().decode("utf-8")
        normalized = normalize_document(original)
        if normalized == original:
            continue
        changed.append(path)
        if args.write:
            path.write_bytes(normalized.encode("utf-8"))

    action = "Normalized" if args.write else "Needs normalization"
    for path in changed:
        print(f"{action}: {path}")
    return 1 if args.check and changed else 0


if __name__ == "__main__":
    raise SystemExit(main())
