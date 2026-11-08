"""Automatic point-proposal segmentation for mozAI's Auto Create preview.

Run SAM 3's instance predictor on a sparse image grid using one shared image
embedding. Unlike SAM 3D reconstruction, this only returns 2D labels. It is a
best-effort proposal pass, not guaranteed exhaustive instance segmentation.
"""
import numpy as np

MAX_REGIONS = 28
MAX_FRACTION = 0.91
MIN_PIXELS = 100


def probe_points(width, height):
    """Staggered probes sample furniture and large architectural surfaces."""
    coords = []
    for row in range(5):
        for col in range(6):
            px = (col + (0.30 if row % 2 else 0.50)) / 6
            py = (row + 0.5) / 5
            coords.append((min(width - 1, int(px * width)),
                           min(height - 1, int(py * height))))
    return coords


def build_label_map(width, height, predict_at, points=None, max_regions=MAX_REGIONS):
    """Return a grayscale 0=background, 1..N=regions map.

    predict_at(x, y) is provided by the GPU wrapper and returns (masks,scores).
    Candidate selection and dedupe run on CPU/Numpy. Small instances overwrite
    broad surfaces so that a click chooses the visible foreground object.
    """
    if not (1 <= width <= 1024 and 1 <= height <= 1024):
        raise ValueError("Unsupported segmentation dimensions.")
    area_total = width * height
    regions = []
    coordinates = probe_points(width, height) if points is None else points
    for x, y in coordinates:
        if len(regions) >= max_regions:
            break
        if not (0 <= x < width and 0 <= y < height):
            continue
        # Avoid repeating a detected compact object at neighboring probes;
        # do not skip broad walls/floors, which can contain foreground items.
        if any(r["area"] < area_total * 0.14 and r["mask"][y, x]
               for r in regions):
            continue
        masks, scores = predict_at(x, y)
        masks = np.asarray(masks)
        scores = np.asarray(scores).reshape(-1)
        if masks.ndim == 2:
            masks = masks[None, ...]
        if masks.ndim != 3 or masks.shape[1:] != (height, width) or len(masks) != len(scores):
            continue
        proposals = []
        for raw, score in zip(masks, scores):
            conf = float(score)
            if not np.isfinite(conf):
                continue
            binary = np.asarray(raw) > 0.5
            if not binary[y, x]:
                continue
            area = int(np.count_nonzero(binary))
            fraction = area / area_total
            if area < MIN_PIXELS or fraction >= MAX_FRACTION:
                continue
            # Confidence matters, but do not let a whole room dominate chairs.
            proposals.append((conf - 0.20 * fraction, binary, area))
        if not proposals:
            continue
        proposals.sort(key=lambda item: item[0], reverse=True)
        _, mask, area = proposals[0]
        duplicated = False
        for old in regions:
            intersection = int(np.count_nonzero(mask & old["mask"]))
            iou = intersection / (area + old["area"] - intersection)
            ratio = min(area, old["area"]) / max(area, old["area"])
            if iou >= 0.76 or (ratio > 0.75 and intersection / min(area, old["area"]) >= 0.91):
                duplicated = True
                break
        if not duplicated:
            regions.append({"mask": mask, "area": area})
    if not regions:
        raise ValueError("No distinct objects found; use Color Wand or a manual selection.")
    # Paint larger surfaces first, and smaller objects on top to preserve clicks.
    region_labels = np.zeros((height, width), dtype=np.uint8)
    for idx, region in enumerate(sorted(regions, key=lambda r: -r["area"]), 1):
        region_labels[region["mask"]] = idx
    return region_labels
