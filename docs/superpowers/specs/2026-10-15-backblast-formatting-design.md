# Backblast Formatting Design

## Intent

Make every backblast workout easy to scan while preserving the existing top matter and the authors' wording. Workout sections should have visible hierarchy, exercises should render as real lists, and future Slack imports should arrive in the same clean format.

## Current State

- The archive contains 284 Markdown backblasts.
- The detail page wraps rendered Markdown in `prose` classes, but the project does not include Tailwind Typography, so the wrapper provides no list or heading styles.
- 266 posts already contain Markdown list markers, but only two use Markdown headings.
- Recent Slack posts sometimes use plain labels such as `Warm Up:` and Unicode bullets such as `•`; CommonMark renders a run of those lines as one paragraph.

## Goals

- Give the workout body branded, responsive styles for headings, paragraphs, lists, nested lists, quotes, and code blocks.
- Normalize recognized workout section labels into level-two Markdown headings.
- Normalize explicit Unicode bullet markers into Markdown bullets.
- Review posts without list semantics and manually mark up only clear exercise sequences.
- Use the same normalization for future Slack imports.
- Preserve YAML frontmatter, title copy, workout wording, attendance, and statistics.
- Make normalization idempotent and available in dry-run/check mode.

## Non-goals

- Rewriting workout prose, correcting spelling, or changing F3 terminology.
- Converting every short line into a bullet through aggressive heuristics.
- Redesigning the backblast top matter, archive cards, or other site pages.
- Introducing client-side JavaScript or a general-purpose typography dependency.

## Design

### Presentation

The backblast body gets a dedicated `backblast-content` class. Scoped CSS in `src/styles/global.css` styles semantic Markdown output while matching the existing F3 palette and fonts. Level-two headings use the heading font and red accent; lists regain visible markers and indentation; paragraphs and list items receive readable vertical rhythm. The styles remain responsive and do not affect other pages.

### Normalization

Create `scripts/format_backblast_markdown.py` with pure functions for body and complete-document normalization plus a CLI with `--check` and `--write` modes. It will:

- recognize major section labels at the start of a line, including spelling/case variants of Warm Up, The Thang, Mary, The Game, CoT/Circle of Trust, Announcements, and Prayer;
- retain descriptors in headings, such as `The Thang: Blackjack`;
- convert explicit Unicode bullets to `- `;
- add only the blank lines required for Markdown structure;
- leave fenced code, existing headings/lists, narrative paragraphs, and frontmatter unchanged;
- return the same output when run repeatedly.

The formatter will not guess that arbitrary short lines are exercises. After the automatic pass, posts with no semantic lists will be reviewed and clear exercise sequences will be marked up manually.

### Import path

`scripts/import_slack_backblast.py` calls `normalize_body()` before writing the Markdown body. That keeps new Slack posts consistent without duplicating formatting rules.

### Quality gates

Unit fixtures cover Unicode bullets, heading variants, inline heading descriptions, code fences, existing Markdown, narrative CoT content, frontmatter preservation, and idempotence. Repository checks confirm no recognized raw labels or Unicode bullets remain after migration. A production build and DOM checks cover representative recent, historical, nested-list, and code-block posts, followed by desktop and mobile visual review.

## Acceptance Criteria

- Warm Up, The Thang, Mary, Game, and CoT sections are visually distinct where present.
- Exercise lists display real markers and readable spacing.
- The October 15 post no longer renders as one paragraph.
- Existing structured posts retain nested lists and code blocks.
- No frontmatter or attendance fields change during formatting.
- New Slack imports receive normalized Markdown automatically.
- All tests and the production build pass.
