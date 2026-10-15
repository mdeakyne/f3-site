# Backblast Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every backblast workout with clear section hierarchy and semantic exercise lists, and keep future Slack imports formatted the same way.

**Architecture:** Add a conservative Python Markdown normalizer shared by the migration CLI and Slack importer, migrate only unambiguous historical formatting, and add scoped CSS for the resulting semantic HTML. Avoid runtime JavaScript and broad content rewriting.

**Tech Stack:** Python 3 `unittest`, Astro 6 content collections, Markdown, Tailwind 4/CSS, Node 22.

**Spec:** `docs/superpowers/specs/2026-10-15-backblast-formatting-design.md`

## Global Constraints

- Preserve YAML frontmatter and all author wording byte-for-byte except Markdown structure characters and required blank lines.
- Never infer attendance or modify title, date, AO, Q, PAX, totals, FNGs, or vault paths.
- Do not auto-bullet arbitrary short narrative lines.
- Do not add client-side JavaScript or a typography dependency.
- Normalization must be idempotent.

## Review Focus

- A heading-like phrase inside prose must remain prose; Task 1 tests start-of-line and recognized-label boundaries.
- CoT participant notes must remain narrative paragraphs; Task 1 tests content after a CoT heading.
- Existing nested lists and fenced code must remain unchanged; Task 1 tests both.
- Frontmatter delimiters and values must remain byte-identical; Task 1 tests complete-document normalization.
- Posts containing both valid Markdown and Unicode bullets must normalize only the Unicode portion; Task 1 includes a mixed-format fixture.

---

### Task 1: Markdown Normalizer

**Files:**
- Create: `scripts/format_backblast_markdown.py`
- Create: `tests/test_format_backblast_markdown.py`

**Interfaces:**
- Produces: `normalize_body(body: str) -> str`, `normalize_document(document: str) -> str`, and CLI modes `--check PATH...` / `--write PATH...`.

- [ ] Write failing unit tests for section heading variants, descriptors, Unicode and mixed bullets, fenced code, nested lists, CoT narrative, frontmatter preservation, and idempotence.
- [ ] Run `python3 -m unittest tests.test_format_backblast_markdown -v` and confirm failures are caused by the missing normalizer.
- [ ] Implement the pure normalization functions and conservative CLI.
- [ ] Run the focused test module and confirm all cases pass.
- [ ] Commit the normalizer and tests.

### Task 2: Future Slack Imports

**Files:**
- Modify: `scripts/import_slack_backblast.py`
- Modify: `tests/test_import_slack_backblast.py`

**Interfaces:**
- Consumes: `normalize_body(body: str) -> str` from Task 1.
- Produces: imported backblast files whose bodies contain semantic headings and lists.

- [ ] Add a failing importer test using the October 15 Slack body and assert `## Warm Up`, `## The Thang`, `## CoT`, and Markdown bullets.
- [ ] Run the importer tests and confirm the new assertion fails against raw Slack formatting.
- [ ] Normalize `fields['body']` at the write boundary without changing parsed metadata.
- [ ] Run all Python tests and confirm they pass.
- [ ] Commit the importer integration.

### Task 3: Historical Content Migration

**Files:**
- Modify: `content/backblasts/*.md` only where formatting changes are required.

**Interfaces:**
- Consumes: formatter CLI from Task 1.
- Produces: normalized source Markdown with unchanged frontmatter and wording.

- [ ] Record frontmatter hashes and run the formatter in `--check` mode to inventory automatic changes.
- [ ] Run `--write` across the archive and confirm frontmatter hashes are unchanged.
- [ ] Review every post that still lacks semantic lists; manually add bullets only to clear exercise sequences.
- [ ] Run `--check` again and confirm no recognized raw headings or Unicode bullets remain.
- [ ] Run the formatter a second time and confirm `git diff` does not change, proving repository-level idempotence.
- [ ] Commit the content migration separately.

### Task 4: Backblast Typography

**Files:**
- Modify: `src/pages/backblasts/[slug].astro`
- Modify: `src/styles/global.css`
- Create: `tests/backblast-rendering.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: semantic HTML produced from normalized Markdown.
- Produces: a scoped `.backblast-content` presentation for headings, lists, paragraphs, quotes, and code.

- [ ] Add a failing rendering test that builds the site and asserts the October 15 page contains section headings and list elements while a complex post retains nested lists/code.
- [ ] Run `npm run test:backblasts` and confirm it fails before the wrapper/styles are implemented.
- [ ] Replace the inert `prose` classes with `backblast-content` and add scoped responsive CSS using existing design tokens.
- [ ] Run the rendering test and production build and confirm both pass.
- [ ] Commit the presentation changes.

### Task 5: Final Verification and Publication

**Files:**
- Modify only if verification reveals a defect.

**Interfaces:**
- Consumes: completed Tasks 1-4.
- Produces: reviewed branch and deployable pull request.

- [ ] Run `python3 -m unittest discover -s tests -p 'test_*.py'`.
- [ ] Run `npm run test:contact` and `npm run test:backblasts`.
- [ ] Run `npm run build` and `git diff --check`.
- [ ] Visually inspect representative recent, historical, nested-list, and code-block pages at desktop and mobile widths.
- [ ] Review the complete diff for copy/frontmatter changes, then push and open a pull request for user approval.
