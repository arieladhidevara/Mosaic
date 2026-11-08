"""Regression tests for click-aware SAM 3 mask postprocessing.

Run: python -m unittest discover -s tests -p 'test_sam3_mask_utils.py'
Requires numpy; no GPU, checkpoint or Hugging Face token required.
"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "integrations" / "hf-sam3-space"))
from mask_utils import choose_clicked_mask


class TestSam3MaskSelection(unittest.TestCase):
    def test_prefers_clicked_object_over_full_canvas(self):
        full = np.ones((50, 50), dtype=np.float32)
        obj = np.zeros_like(full)
        obj[15:30, 15:30] = 1
        chosen = choose_clicked_mask(np.stack([full, obj]), [0.99, 0.85], 20, 20)
        self.assertEqual(int(chosen.sum()), 225)

    def test_disconnected_islands_removed(self):
        mask = np.zeros((60, 60), dtype=np.float32)
        mask[5:20, 5:20] = 1
        mask[40:55, 40:55] = 1
        chosen = choose_clicked_mask(mask, [0.95], 10, 10)
        self.assertEqual(int(chosen.sum()), 225)
        self.assertFalse(chosen[45, 45])

    def test_rejects_huge_mask_instead_of_select_all(self):
        all_pixels = np.ones((30, 30), dtype=np.float32)
        with self.assertRaises(ValueError):
            choose_clicked_mask(all_pixels, [0.99], 10, 10)

    def test_rejects_unrelated_object(self):
        mask = np.zeros((40, 40), dtype=np.float32)
        mask[0:8, 0:8] = 1
        with self.assertRaises(ValueError):
            choose_clicked_mask(mask, [0.95], 30, 30)

    def test_keeps_diagonal_pixels_connected(self):
        mask = np.zeros((30, 30), dtype=np.float32)
        for i in range(4, 19):
            mask[i, i] = 1
        chosen = choose_clicked_mask(mask, [0.90], 4, 4)
        self.assertEqual(int(chosen.sum()), 15)

    def test_prefers_compact_candidate_at_similar_confidence(self):
        large = np.zeros((40, 40), dtype=np.float32)
        large[2:34, 2:34] = 1
        chair = np.zeros_like(large)
        chair[10:20, 10:20] = 1
        chosen = choose_clicked_mask(np.stack([large, chair]), [0.95, 0.88], 15, 15)
        self.assertEqual(int(chosen.sum()), 100)

    def test_tolerates_point_near_mask_edge(self):
        mask = np.zeros((40, 40), dtype=np.float32)
        mask[10:20, 10:20] = 1
        chosen = choose_clicked_mask(mask, [0.9], 8, 15)
        self.assertTrue(chosen[10, 10])


if __name__ == "__main__":
    unittest.main()
