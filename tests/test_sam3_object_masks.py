import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'integrations' / 'hf-sam3-space'))
from object_masks import choose_object_mask

class ObjectMaskTests(unittest.TestCase):
    def test_semantic_and_spatial_evidence(self):
        masks = np.zeros((2, 1, 30, 40), dtype=np.float32)
        masks[0, 0, 5:20, 5:15] = 1
        masks[1, 0, 5:20, 25:35] = 1
        chosen = choose_object_mask(masks, np.array([.85, .95]), (2, 2, 18, 23))
        self.assertTrue(chosen[10, 10])
        self.assertFalse(chosen[10, 30])

    def test_ambiguity_and_whole_image_are_rejected(self):
        masks = np.zeros((2, 30, 40), dtype=np.float32)
        masks[0, 5:20, 5:15] = 1
        masks[1, 5:20, 25:35] = 1
        with self.assertRaises(ValueError):
            choose_object_mask(masks, [.9, .91], (0, 0, 40, 30))
        with self.assertRaises(ValueError):
            choose_object_mask(np.ones((1, 30, 40)), [.99], (0, 0, 40, 30))

if __name__ == '__main__':
    unittest.main()
