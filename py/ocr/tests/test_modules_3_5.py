"""Test moduli 3-5. Esecuzione dalla cartella `py/`:  python -m unittest discover -s ocr/tests -t . -v

Non servono modelli .tflite: si testano le parti algoritmiche (post-processing DB,
decoding CTC, quantizzazione, Levenshtein, merge, parser).
"""
from __future__ import annotations

import unittest
from decimal import Decimal

import cv2
import numpy as np

from ocr.inference.ctc_decoder import build_classes, ctc_greedy_decode, softmax
from ocr.inference.db_postprocess import DBPostProcessor
from ocr.merging.line_merger import LineMerger, MergeStatus
from ocr.merging.text_similarity import levenshtein_distance, similarity
from ocr.parsing.receipt_parser import ReceiptParser


class LevenshteinTests(unittest.TestCase):
    def test_known_distances(self) -> None:
        self.assertEqual(levenshtein_distance("kitten", "sitting"), 3)
        self.assertEqual(levenshtein_distance("", "abc"), 3)
        self.assertEqual(levenshtein_distance("abc", "abc"), 0)

    def test_bounded_early_exit(self) -> None:
        self.assertEqual(levenshtein_distance("abcdefgh", "zzzzzzzz", max_distance=2), 3)
        self.assertEqual(levenshtein_distance("abcd", "abce", max_distance=2), 1)

    def test_similarity_threshold(self) -> None:
        self.assertGreaterEqual(similarity("latte intero", "latte intera", 0.8), 0.8)
        self.assertEqual(similarity("pane", "formaggio", 0.8), 0.0)


class CtcTests(unittest.TestCase):
    def test_collapse_repeats_and_blanks(self) -> None:
        classes = build_classes("helo", blank_first=True)  # 0=blank 1=h 2=e 3=l 4=o
        # sequenza argmax: - h h - e - l l - l o -   => "hello"
        seq = [0, 1, 1, 0, 2, 0, 3, 3, 0, 3, 4, 0]
        probs = np.full((len(seq), len(classes)), 0.01, np.float32)
        for t, k in enumerate(seq):
            probs[t, k] = 0.96
        rec = ctc_greedy_decode(probs, classes, blank_index=0)
        self.assertEqual(rec.text, "hello")
        self.assertAlmostEqual(rec.confidence, 0.96, places=3)

    def test_softmax_sums_to_one(self) -> None:
        p = softmax(np.array([[1000.0, 1001.0, 999.0]]), axis=1)  # stabile anche con valori grandi
        self.assertAlmostEqual(float(p.sum()), 1.0, places=5)


class DbPostProcessTests(unittest.TestCase):
    def test_rectangle_is_detected_and_scaled(self) -> None:
        prob = np.zeros((100, 200), np.float32)
        prob[40:60, 50:150] = 0.9  # un "kernel" di testo 100x20
        boxes = DBPostProcessor().boxes_from_probability(prob, orig_width=400, orig_height=200)
        self.assertEqual(len(boxes), 1)
        box = boxes[0]
        # scala x2 su entrambi gli assi, e unclip ha ingrandito il box
        self.assertLessEqual(box.x_min, 100)
        self.assertGreaterEqual(box.x_max, 298)
        self.assertGreater(box.height, 40)

    def test_low_score_is_discarded(self) -> None:
        prob = np.zeros((100, 200), np.float32)
        prob[40:60, 50:150] = 0.4  # sopra bin_threshold (0.3) ma sotto box_threshold (0.6)
        self.assertEqual(DBPostProcessor().boxes_from_probability(prob, 200, 100), [])


class MergerTests(unittest.TestCase):
    RECEIPT = [
        "SUPERMERCATO ROSSI",
        "VIA ROMA 10",
        "LATTE INTERO 1L 1,29",
        "PANE CASARECCIO 2,10",
        "ACQUA NATURALE 1,5L 0,59",
        "PASTA PENNE 500G 1,15",
        "POMODORI PELATI 0,89",
        "OLIO EXTRA VERGINE 6,99",
        "TOTALE EURO 13,01",
    ]

    def test_scrolling_down_builds_full_receipt(self) -> None:
        m = LineMerger()
        acc = list(m.merge([], self.RECEIPT[0:4]).lines)
        acc = list(m.merge(acc, self.RECEIPT[2:7]).lines)
        result = m.merge(acc, self.RECEIPT[5:9])
        self.assertEqual(list(result.lines), self.RECEIPT)

    def test_same_view_is_unchanged(self) -> None:
        m = LineMerger()
        acc = self.RECEIPT[2:6]
        result = m.merge(acc, list(acc))
        self.assertEqual(result.status, MergeStatus.UNCHANGED)
        self.assertEqual(list(result.lines), acc)

    def test_ocr_noise_does_not_duplicate_lines(self) -> None:
        m = LineMerger()
        noisy = ["LATTE INTERO 1L 1,29", "PANE CASARECC1O 2,10", "ACQUA NATURALE 1,5L 0,59", "PASTA PENNE 500G 1,15"]
        result = m.merge(self.RECEIPT[2:6], noisy)
        self.assertEqual(result.status, MergeStatus.UNCHANGED)
        self.assertEqual(len(result.lines), 4)

    def test_scrolling_up_prepends(self) -> None:
        m = LineMerger()
        result = m.merge(self.RECEIPT[3:8], self.RECEIPT[0:5])
        self.assertEqual(list(result.lines), self.RECEIPT[0:8])

    def test_unrelated_frame_is_ignored(self) -> None:
        m = LineMerger()
        result = m.merge(self.RECEIPT[0:4], ["FARMACIA CENTRALE", "AUGURI DI BUON ANNO", "XYZ QWERTY 99"])
        self.assertEqual(result.status, MergeStatus.NO_OVERLAP)
        self.assertEqual(list(result.lines), self.RECEIPT[0:4])


class ParserTests(unittest.TestCase):
    def test_full_receipt(self) -> None:
        lines = [
            "SUPERMERCATO ROSSI SRL",
            "P.IVA 01234567890",
            "LATTE INTERO 1L 1,29 A",
            "PANE CASARECCIO 2,10",
            "ACQUA 1,5L 3 x 0,50 1,50",
            "SCONTO FIDELITY -0,30",
            "SUBTOTALE 4,59",
            "TOTALE IVA 0,41",
            "TOTALE EURO 4,59",
            "CONTANTE 5,00",
            "RESTO 0,41",
        ]
        r = ReceiptParser().parse(lines)
        self.assertEqual(r.total, Decimal("4.59"))
        names = [i.name for i in r.items]
        self.assertIn("LATTE INTERO 1L", names)
        self.assertIn("PANE CASARECCIO", names)
        water = next(i for i in r.items if i.name.startswith("ACQUA"))
        self.assertEqual((water.quantity, water.unit_price, water.price), (3, Decimal("0.50"), Decimal("1.50")))
        self.assertEqual(r.items_sum, Decimal("1.29") + Decimal("2.10") + Decimal("1.50") - Decimal("0.30"))
        self.assertTrue(r.is_consistent())
        self.assertFalse(any("CONTANTE" in n or "RESTO" in n or "IVA" in n for n in names))

    def test_ocr_digit_confusion_in_price(self) -> None:
        r = ReceiptParser().parse(["BISCOTTI FROLLINI 2,O9", "TOTALE l,50"])
        self.assertEqual(r.items[0].price, Decimal("2.09"))
        self.assertEqual(r.total, Decimal("1.50"))

    def test_dot_decimal_and_no_total(self) -> None:
        r = ReceiptParser().parse(["CAFFE MACINATO 3.49"])
        self.assertEqual(r.items[0].price, Decimal("3.49"))
        self.assertIsNone(r.total)
        self.assertFalse(r.is_consistent())


if __name__ == "__main__":
    unittest.main()
