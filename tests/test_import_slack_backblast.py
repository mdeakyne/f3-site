import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from import_slack_backblast import normalize_name, parse_date, parse_message


class SlumpNormalizationTests(unittest.TestCase):
    def test_slack_display_name_maps_to_slump(self):
        message = """Backblast: Naming Day
When: 09/29/26 0530
Q: @Big Toe
PAX: @Big Toe @Josiah Wegener (Slump)
"""

        parsed = parse_message(message, ao_hint="beehive")

        self.assertEqual(parsed["pax"], ["Big Toe", "Slump"])
        self.assertEqual(parsed["total_pax"], 2)

    def test_previous_wrong_name_maps_to_slump(self):
        self.assertEqual(normalize_name("Sludge"), "Slump")

    def test_compact_van_gogh_display_name_maps_to_existing_pax(self):
        self.assertEqual(normalize_name("VanGogh"), "Van Gogh")


class SlackDateParsingTests(unittest.TestCase):
    def test_two_digit_year_with_hyphens(self):
        self.assertEqual(parse_date("10-08-26 0530"), "2026-10-08")

    def test_when_header_without_colon(self):
        message = """Backblast: Cindy 500
When 10/06/26 0530
Q: @Big Toe
PAX: @Big Toe @Slump
"""

        parsed = parse_message(message, ao_hint="beehive")

        self.assertEqual(parsed["date"], "2026-10-06")


if __name__ == "__main__":
    unittest.main()
