/**
 * Greedy non-maximum suppression - pure math, unit-tested in Node
 * (tests/nms.test.js).
 *
 * Class-aware: boxes only suppress boxes of the *same* class, so an
 * overlapping dog and bicycle both survive. Candidates are
 * `{x1, y1, x2, y2, score, classId}` as produced by lib/decode.js.
 */

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  if (inter === 0) return 0;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter);
}

/**
 * @param {Array} candidates  Decoded boxes (any order).
 * @param {Object} [opts]
 * @param {number} [opts.iouThreshold]   Same-class overlap above this is suppressed (default 0.45).
 * @param {number} [opts.maxDetections]  Cap on survivors, highest score first (default 100).
 * @returns {Array} Surviving boxes, sorted by descending score.
 */
export function nms(candidates, { iouThreshold = 0.45, maxDetections = 100 } = {}) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const cand of sorted) {
    if (kept.length >= maxDetections) break;
    let suppressed = false;
    for (const k of kept) {
      if (k.classId === cand.classId && iou(k, cand) > iouThreshold) {
        suppressed = true;
        break;
      }
    }
    if (!suppressed) kept.push(cand);
  }
  return kept;
}
