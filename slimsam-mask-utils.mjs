// SlimSAM-77 mask selection. Pure helpers shared between browser worker and Node tests.
// SAM-1 ONNX decoder returns three 256x256 logit masks and one IoU score per mask.
export const SAM_MASK_SIDE = 256;

export function contentDimensions(imageWidth, imageHeight, side = SAM_MASK_SIDE) {
  if (!(imageWidth > 0 && imageHeight > 0)) throw new Error('Invalid source dimensions');
  const scale = side / Math.max(imageWidth, imageHeight);
  return {
    width: Math.max(1, Math.min(side, Math.round(imageWidth * scale))),
    height: Math.max(1, Math.min(side, Math.round(imageHeight * scale))),
  };
}

// Select only the 4-connected object that contains the positive cursor point,
// rather than allowing stray islands or empty background to be selected.
// Reject nearly-full-image masks and tiny isolated noise.
export function selectSlimMask(logits, scores, imageWidth, imageHeight, imageX, imageY, side = SAM_MASK_SIDE) {
  if (!logits || !scores || !Number.isFinite(imageX) || !Number.isFinite(imageY) ||
      imageX < 0 || imageY < 0 || imageX >= imageWidth || imageY >= imageHeight) return null;
  const {width, height} = contentDimensions(imageWidth, imageHeight, side);
  const px = Math.min(width - 1, Math.floor(imageX * width / imageWidth));
  const py = Math.min(height - 1, Math.floor(imageY * height / imageHeight));
  const total = width * height, maskPixels = side * side;
  const candidates = Math.min(3, Math.floor(logits.length / maskPixels), scores.length);
  let best = null;
  for (let k = 0; k < candidates; k++) {
    const offset = k * maskPixels;
    if (!(logits[offset + py * side + px] > 0) || !Number.isFinite(Number(scores[k]))) continue;
    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);
    const seed = py * width + px;
    visited[seed] = 1; queue[0] = seed;
    let start = 0, end = 1;
    while (start < end) {
      const i = queue[start++];
      const x = i % width, y = (i - x) / width;
      const check = (nx, ny) => {
        const idx = ny * width + nx;
        if (visited[idx] || !(logits[offset + ny * side + nx] > 0)) return;
        visited[idx] = 1;
        queue[end++] = idx;
      };
      if (x > 0) check(x - 1, y);
      if (x + 1 < width) check(x + 1, y);
      if (y > 0) check(x, y - 1);
      if (y + 1 < height) check(x, y + 1);
    }
    const coverage = end / total;
    if (end < Math.max(8, Math.floor(total * 0.0003)) || coverage >= .90) continue;
    // Prefer high IoU confidence while slightly penalizing overly broad masks.
    const rank = Number(scores[k]) - coverage * 0.16;
    if (!best || rank > best.rank) best = {mask: visited, width, height, coverage, score: Number(scores[k]), rank};
  }
  if (!best) return null;
  delete best.rank;
  return best;
}
