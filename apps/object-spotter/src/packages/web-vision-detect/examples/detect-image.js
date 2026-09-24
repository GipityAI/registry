/**
 * Example: one-off detection on a still image - no camera, no loop.
 *
 * Works on any drawable source: an <img>, a canvas, an ImageBitmap from a
 * file the user picked. Boxes come back in image pixel coordinates, so
 * drawing on a canvas sized to the image lines up 1:1.
 */

import { createDetector, drawDetections } from '@gipity/web-vision-detect';

/**
 * Detect objects in an <img> and draw boxes onto a canvas over it.
 * Returns the detections plus per-label counts (3 cups, 1 laptop, ...).
 */
export async function detectImage(img, canvas) {
  const detector = await createDetector({ model: 'tiny' });

  const result = await detector.detect(img);

  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  drawDetections(canvas.getContext('2d'), result);

  const counts = {};
  for (const det of result.detections) {
    counts[det.label] = (counts[det.label] || 0) + 1;
  }

  await detector.close();
  return { detections: result.detections, counts };
}

/** Turn a file-input File into an <img> ready for detectImage. */
export function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(img.src); resolve(img); };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
