"""Click-aware SAM 3 mask selection without extra heavyweight dependencies.

SAM 3 returns multiple plausible masks for one positive point. The highest-IoU
candidate is not always the intended object (particularly for architecture
images with large connected floors/walls). Select a click-containing candidate,
penalize excessive coverage, and keep only its click-connected component.
"""
from collections import deque

import numpy as np


MAX_SELECTION_FRACTION = 0.90


def _seed_near_click(mask, x, y, radius=8):
    """Allow for a few pixels of boundary/resize error around the click."""
    h, w = mask.shape
    if mask[y, x]:
        return x, y
    left, right = max(0, x - radius), min(w, x + radius + 1)
    top, bottom = max(0, y - radius), min(h, y + radius + 1)
    ys, xs = np.nonzero(mask[top:bottom, left:right])
    if not len(xs):
        return None
    xs = xs + left
    ys = ys + top
    distance = (xs - x) ** 2 + (ys - y) ** 2
    idx = int(np.argmin(distance))
    if distance[idx] > radius * radius:
        return None
    return int(xs[idx]), int(ys[idx])


def _component_at(mask, seed):
    """Keep only the 8-connected foreground island containing the click."""
    h, w = mask.shape
    foreground = mask.astype(np.uint8, copy=False).tobytes()
    selected = bytearray(h * w)
    start = seed[1] * w + seed[0]
    if not foreground[start]:
        raise ValueError("Click is not in the selected object.")
    selected[start] = 1
    todo = deque([start])
    while todo:
        index = todo.popleft()
        y, x = divmod(index, w)
        neighbors = []
        if x > 0:
            neighbors.append(index - 1)
        if x + 1 < w:
            neighbors.append(index + 1)
        if y > 0:
            neighbors.append(index - w)
            if x > 0:
                neighbors.append(index - w - 1)
            if x + 1 < w:
                neighbors.append(index - w + 1)
        if y + 1 < h:
            neighbors.append(index + w)
            if x > 0:
                neighbors.append(index + w - 1)
            if x + 1 < w:
                neighbors.append(index + w + 1)
        for neighbor in neighbors:
            if foreground[neighbor] and not selected[neighbor]:
                selected[neighbor] = 1
                todo.append(neighbor)
    return np.frombuffer(selected, dtype=np.uint8).reshape(h, w).astype(bool)


def choose_clicked_mask(masks, scores, x, y):
    """Return a click-focused boolean mask or raise instead of selecting all.

    SAM 3's default predict_inst(return_logits=False) returns binary masks as
    float 0/1. Requiring > 0.5 also avoids marking tiny nonzero noise as selected.
    """
    masks = np.asarray(masks)
    if masks.ndim == 2:
        masks = masks[None, ...]
    scores = np.asarray(scores).reshape(-1)
    if masks.ndim != 3 or len(masks) != len(scores):
        raise ValueError("Unexpected SAM 3 mask candidates.")
    _, h, w = masks.shape
    x, y = int(x), int(y)
    if x < 0 or x >= w or y < 0 or y >= h:
        raise ValueError("Click outside mask.")
    candidates = []
    for raw, raw_score in zip(masks, scores):
        confidence = float(raw_score)
        if not np.isfinite(confidence):
            continue
        binary = np.asarray(raw) > 0.5
        coverage = float(np.count_nonzero(binary)) / (h * w)
        if not (0 < coverage < MAX_SELECTION_FRACTION):
            continue
        seed = _seed_near_click(binary, x, y)
        if seed is None:
            continue
        # A slightly smaller click-containing object is usually more useful
        # than the entire wall/room when their model confidence is comparable.
        rank = confidence - 0.18 * coverage
        candidates.append((rank, binary, seed))
    if not candidates:
        raise ValueError("SAM 3 could not isolate an object at this point.")
    candidates.sort(key=lambda item: item[0], reverse=True)
    for _, binary, seed in candidates:
        connected = _component_at(binary, seed)
        selected_count = int(np.count_nonzero(connected))
        if 3 <= selected_count < h * w * MAX_SELECTION_FRACTION:
            return connected
    raise ValueError("SAM 3 selection is too broad or too small.")
