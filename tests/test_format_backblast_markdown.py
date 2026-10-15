import sys
import subprocess
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from format_backblast_markdown import normalize_body, normalize_document


class BodyNormalizationTests(unittest.TestCase):
    def test_promotes_known_sections_and_unicode_bullets(self):
        source = """Warm Up:
• 15 Michael Phelps
• 15 Abe Vigodas
The Thang : Ladders + Incinerator = Fireman
• Curls
• Rows
CoT:
Big Toe: Body is nearly back to normal.
404: Mom has surgery Monday.
"""

        expected = """## Warm Up

- 15 Michael Phelps
- 15 Abe Vigodas

## The Thang: Ladders + Incinerator = Fireman

- Curls
- Rows

## CoT

Big Toe: Body is nearly back to normal.
404: Mom has surgery Monday.
"""

        self.assertEqual(normalize_body(source), expected)

    def test_recognizes_heading_variants_and_preserves_descriptors(self):
        source = """The warmup:
- SSH
The Thang — 15 / 10 / 5
- Merkins
Mary — 20 Reps Each
- Sit-Ups
The Game:
- Ultimate
Circle of Trust:
Prayers for the group.
"""

        expected = """## The warmup

- SSH

## The Thang — 15 / 10 / 5

- Merkins

## Mary — 20 Reps Each

- Sit-Ups

## The Game

- Ultimate

## Circle of Trust

Prayers for the group.
"""

        self.assertEqual(normalize_body(source), expected)

    def test_preserves_existing_nested_lists_and_fenced_code(self):
        source = """## The Thang: Musical Chairs

- The setup:
  - Six stations

```text
1 - - 2
|   |
4 - - 3
```
"""

        self.assertEqual(normalize_body(source), source)

    def test_normalizes_only_explicit_unicode_items_in_mixed_markdown(self):
        source = """Warmup:
- Existing item
• Imported item

This stays narrative.
"""

        expected = """## Warmup

- Existing item
- Imported item

This stays narrative.
"""

        self.assertEqual(normalize_body(source), expected)

    def test_does_not_promote_heading_words_inside_prose(self):
        source = """We skipped the warmup: rain was moving in.
The group discussed The Thang: and what made it difficult.
"""

        self.assertEqual(normalize_body(source), source)

    def test_is_idempotent(self):
        source = """Warm-Up (~5 minutes):
• SSH
• Arm Circles
"""

        once = normalize_body(source)

        self.assertEqual(normalize_body(once), once)

    def test_promotes_bold_legacy_section_labels(self):
        source = """**Warm Up:**

- SSH

**The Thang: Blackjack**

- Merkins
"""

        expected = """## Warm Up

- SSH

## The Thang: Blackjack

- Merkins
"""

        self.assertEqual(normalize_body(source), expected)

    def test_promotes_the_mary_legacy_variant_without_rewording_it(self):
        self.assertEqual("## The Mary\n", normalize_body("**The Mary:**\n"))

    def test_splits_multiple_unicode_bullets_collapsed_onto_one_line(self):
        source = """**Warm Up:**

• Welcome and Disclaimers• Stretch OYO• Motivators x3
"""

        expected = """## Warm Up

- Welcome and Disclaimers
- Stretch OYO
- Motivators x3
"""

        self.assertEqual(normalize_body(source), expected)

    def test_preserves_ambiguous_embedded_bullet_in_narrative_text(self):
        source = "Down Unders, 4x8• Concentration Curls, 2x• 1:30 plank.\n"

        self.assertEqual(normalize_body(source), source)

    def test_does_not_duplicate_an_existing_list_marker_when_splitting_bullets(self):
        source = "- Welcome and Disclaimers• Stretch OYO• Motivators x3\n"

        expected = "- Welcome and Disclaimers\n- Stretch OYO\n- Motivators x3\n"

        self.assertEqual(normalize_body(source), expected)

    def test_preserves_compact_nested_list_markers_idempotently(self):
        source = "- - - Merkins\n"

        self.assertEqual(normalize_body(source), source)
        self.assertEqual(normalize_body(normalize_body(source)), source)

    def test_preserves_tilde_and_long_backtick_fences(self):
        source = """~~~~text
Warm Up:
• SSH
```
~~~~

````text
The Thang:
```
• Merkins
````
"""

        self.assertEqual(normalize_body(source), source)

    def test_preserves_indented_code_and_labels_inside_list_items(self):
        source = """    Warm Up:
    • literal symbol
- The Thang:
  continuation text
"""

        self.assertEqual(normalize_body(source), source)

    def test_preserves_inline_code_containing_a_bullet_symbol(self):
        source = "Use `• ` as the separator.\n"

        self.assertEqual(normalize_body(source), source)

    def test_preserves_lazy_list_continuations(self):
        source = "- Partner carry\nContinue to the far curb and return.\n"

        self.assertEqual(normalize_body(source), source)


class DocumentNormalizationTests(unittest.TestCase):
    def test_preserves_frontmatter_byte_for_byte(self):
        source = """---
slug: test-post
title: 'A: Test'
pax:
- Big Toe
---

The Thang:
• Merkins
"""

        normalized = normalize_document(source)

        self.assertEqual(
            normalized.split("---", 2)[:2],
            source.split("---", 2)[:2],
        )
        self.assertTrue(normalized.endswith("## The Thang\n\n- Merkins\n"))

    def test_document_without_frontmatter_normalizes_as_body(self):
        self.assertEqual(
            normalize_document("Prayer:\nKeep the group safe.\n"),
            "## Prayer\n\nKeep the group safe.\n",
        )

    def test_cli_preserves_crlf_frontmatter_bytes(self):
        source = b"---\r\nslug: crlf-test\r\ntitle: CRLF Test\r\n---\r\nWarm Up:\r\n\xe2\x80\xa2 SSH\r\n"
        script = Path(__file__).resolve().parents[1] / "scripts" / "format_backblast_markdown.py"

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "post.md"
            path.write_bytes(source)
            subprocess.run(
                [sys.executable, str(script), "--write", str(path)],
                check=True,
                capture_output=True,
            )
            normalized = path.read_bytes()

        self.assertTrue(normalized.startswith(b"---\r\nslug: crlf-test\r\ntitle: CRLF Test\r\n---\r\n"))


if __name__ == "__main__":
    unittest.main()
