"""Test 2D Auto Create proposals without downloading SAM 3 or requiring a GPU."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "integrations" / "hf-sam3-space"))
from auto_regions import build_label_map, probe_points


class AutoRegionTests(unittest.TestCase):
    def test_probe_grid_stays_inside_image(self):
        points = probe_points(320, 240)
        self.assertEqual(len(points), 30)
        self.assertTrue(all(0 <= x < 320 and 0 <= y < 240 for x, y in points))

    def test_detects_multiple_objects_and_preserves_background(self):
        w, h = 200, 160
        chair = np.zeros((h, w), np.float32)
        table = np.zeros_like(chair)
        chair[15:50, 20:55] = 1
        table[75:115, 95:135] = 1

        def predict(x, y):
            return np.stack([chair, table]), [0.94, 0.90]

        labels = build_label_map(w, h, predict, points=[(30, 30), (110, 90)])
        self.assertNotEqual(int(labels[30, 30]), int(labels[90, 110]))
        self.assertGreater(int(labels[30, 30]), 0)
        self.assertGreater(int(labels[90, 110]), 0)
        self.assertEqual(int(labels[0, 0]), 0)

    def test_repeated_clicks_deduplicate_same_object(self):
        w, h = 200, 160
        item = np.zeros((h, w), np.float32)
        item[15:75, 20:85] = 1
        labels = build_label_map(w, h, lambda x, y: (item, [0.95]), points=[(30, 30), (60, 60)])
        self.assertEqual(int(labels.max()), 1)

    def test_rejects_nearly_full_image(self):
        w, h = 200, 160
        full = np.ones((h, w), np.float32)
        with self.assertRaisesRegex(ValueError, "No distinct"):
            build_label_map(w, h, lambda x, y: (full, [0.98]), points=[(50, 50)])

    def test_smaller_object_overrides_large_surface(self):
        w, h = 200, 160
        wall = np.zeros((h, w), np.float32)
        wall[2:140, 2:180] = 1
        chair = np.zeros_like(wall)
        chair[20:55, 20:60] = 1

        def predict(x, y):
            if x < 20:
                return wall, [0.98]
            return chair, [0.95]

        labels = build_label_map(w, h, predict, points=[(10, 80), (35, 30)])
        self.assertGreater(int(labels[30, 35]), 0)
        self.assertNotEqual(int(labels[30, 35]), int(labels[100, 100]))


if __name__ == "__main__":
    unittest.main()
