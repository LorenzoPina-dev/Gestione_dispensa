from __future__ import annotations

import unittest

from ocr.merging.fuzzy_receipt import FuzzyReceiptAccumulator


class FuzzyReceiptTests(unittest.TestCase):
    def test_noisy_overlapping_frames_are_deduplicated(self) -> None:
        accumulator = FuzzyReceiptAccumulator()
        accumulator.update(["LATTE INTERO 1L 1,29", "PANE 2,10"], 1)
        accumulator.update(["LATTE INTER0 1L 1,29", "ACQUA 0,59"], 2)
        lines = accumulator.snapshot()
        self.assertEqual(len(lines), 3)
        self.assertEqual(sum("LATTE" in line for line in lines), 1)

    def test_isolated_frame_is_not_discarded(self) -> None:
        accumulator = FuzzyReceiptAccumulator()
        accumulator.update(["LATTE 1,29"], 1)
        accumulator.update(["TOTALE 1,29"], 2)
        self.assertEqual(accumulator.snapshot(), ["LATTE 1,29", "TOTALE 1,29"])


if __name__ == "__main__":
    unittest.main()
