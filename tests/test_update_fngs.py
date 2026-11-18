import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "update_fngs.py"


def load_updater():
    spec = importlib.util.spec_from_file_location("update_fngs", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FngOverrideTests(unittest.TestCase):
    def test_breakfast_pizza_downrange_q_remains_zero_after_date_correction(self):
        updater = load_updater()
        source = ROOT / "content" / "backblasts" / "2026-03-26-this-is-my-coupon.md"

        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / source.name
            copied.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
            updater.BACKBLASTS_DIR = directory

            updater.main()

            result = copied.read_text(encoding="utf-8")

        self.assertIn("fngs: 0", result)


if __name__ == "__main__":
    unittest.main()
