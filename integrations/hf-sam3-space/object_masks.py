"""Choose one semantic SAM candidate with spatial support; reject ambiguous targets."""
import numpy as np


def choose_object_mask(masks, scores, box):
    masks = np.asarray(masks)
    if masks.ndim == 4 and masks.shape[1] == 1:
        masks = masks[:, 0]
    scores = np.asarray(scores).reshape(-1)
    if masks.ndim != 3 or len(masks) != len(scores):
        raise ValueError("Invalid semantic mask candidates.")
    h, w = masks.shape[1:]
    x1, y1, x2, y2 = box
    roi = np.zeros((h, w), dtype=bool)
    roi[max(0, int(y1)):min(h, int(np.ceil(y2))), max(0, int(x1)):min(w, int(np.ceil(x2)))] = True
    ranked = []
    for mask, score in zip(masks, scores):
        mask = mask > 0.5
        area = int(mask.sum())
        intersection = int((mask & roi).sum())
        if not np.isfinite(score) or score < 0.65 or area < 16 or area > w*h*0.94:
            continue
        coverage = intersection / max(1, area)
        if coverage < 0.5 or intersection < min(area, int(roi.sum())) * 0.15:
            continue
        ranked.append((float(score) * coverage, mask))
    ranked.sort(key=lambda item: item[0], reverse=True)
    if not ranked:
        raise ValueError("No reliable object in this region.")
    if len(ranked) > 1 and ranked[0][0] - ranked[1][0] < 0.10:
        a, b = ranked[0][1], ranked[1][1]
        if (a & b).sum() / max(1, (a | b).sum()) < 0.65:
            raise ValueError("Ambiguous object target.")
    return ranked[0][1]
