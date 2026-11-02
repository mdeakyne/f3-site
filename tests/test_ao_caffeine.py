import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from import_slack_backblast import parse_ao
import regenerate_data


class AOCaffeineHistoryTests(unittest.TestCase):
    def test_parser_recognizes_caffeine_name_and_existing_slack_channel(self):
        self.assertEqual(parse_ao("#ao-caffeine"), "ao-caffeine")
        self.assertEqual(parse_ao("<#C0CE7TKJ7HS>"), "ao-caffeine")

    def test_generated_site_data_uses_the_ao_catalog(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "ao-caffeine.md").write_text(
                "---\nslug: ao-caffeine\nname: AO-Caffeine\n---\n"
            )
            original_aos_dir = getattr(regenerate_data, "AOS_DIR", None)
            regenerate_data.AOS_DIR = directory
            try:
                data = regenerate_data.build_data([], {})
            finally:
                if original_aos_dir is None:
                    del regenerate_data.AOS_DIR
                else:
                    regenerate_data.AOS_DIR = original_aos_dir

        self.assertEqual(data["counts"]["aos"], 1)
        self.assertEqual(
            data["aos"], [{"slug": "ao-caffeine", "name": "AO-Caffeine"}]
        )


if __name__ == "__main__":
    unittest.main()
