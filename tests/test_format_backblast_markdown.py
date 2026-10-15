import sys
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

        expected = """## Warm Up

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

        expected = """## Warm Up

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

    def test_promotes_the_mary_legacy_variant(self):
        self.assertEqual("## Mary\n", normalize_body("**The Mary:**\n"))

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

    def test_treats_text_before_an_embedded_bullet_as_the_first_list_item(self):
        source = "Down Unders, 4x8• Concentration Curls, 2x• 1:30 plank.\n"

        expected = "- Down Unders, 4x8\n- Concentration Curls, 2x\n- 1:30 plank.\n"

        self.assertEqual(normalize_body(source), expected)


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


if __name__ == "__main__":
    unittest.main()
