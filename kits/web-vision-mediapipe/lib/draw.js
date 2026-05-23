/**
 * Canvas overlay rendering for vision results.
 *
 * Every helper draws onto a 2D context whose canvas is sized to the video
 * frame (call `fitCanvas` first). Object-detection boxes arrive in frame
 * pixels; hand/pose landmarks arrive normalised 0..1 and are scaled by
 * MediaPipe's DrawingUtils to the canvas.
 *
 * Mirroring: front-facing camera feeds read naturally when flipped left/right
 * (so a user's right hand appears on the right of their screen). The video
 * element handles its own CSS mirror; the canvas is *not* mirrored in CSS -
 * if it were, every caption would read backwards. Instead, pass `mirror: true`
 * to the drawers below and they flip the geometry while leaving text upright.
 */

import { DrawingUtils, GestureRecognizer, PoseLandmarker } from '@mediapipe/tasks-vision';

const ACCENT = '#f26522'; // Gipity orange
const INK = '#ffffff';

/** Match the canvas backing store to the video's real frame size. */
export function fitCanvas(canvas, video) {
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}

/** Wipe the overlay. Call once per frame before drawing. */
export function clearCanvas(ctx) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

// Draw a filled caption chip with its top-left at (x, y).
function chip(ctx, text, x, y, accent) {
  ctx.font = '600 18px system-ui, sans-serif';
  const padX = 8;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 26;
  const top = Math.max(0, y);
  // Keep the chip on-canvas when its anchor sits near the right edge in
  // mirrored mode (the anchor is the box's left in original coords, which
  // becomes its right after flipping).
  const left = Math.max(0, Math.min(ctx.canvas.width - w, x));
  ctx.fillStyle = accent;
  ctx.fillRect(left, top, w, h);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + padX, top + h / 2 + 1);
}

// Mirror an array of normalised landmarks across the vertical axis.
function mirrorLandmarks(landmarks) {
  return landmarks.map((p) => ({ ...p, x: 1 - p.x }));
}

/** Object detection - boxes + "<label> <pct>%" captions. */
export function drawDetections(ctx, result, { accent = ACCENT, mirror = false } = {}) {
  const W = ctx.canvas.width;
  for (const det of result?.detections ?? []) {
    const b = det.boundingBox;
    const x = mirror ? W - b.originX - b.width : b.originX;
    const cat = det.categories?.[0];
    ctx.lineWidth = 3;
    ctx.strokeStyle = accent;
    ctx.strokeRect(x, b.originY, b.width, b.height);
    if (cat) {
      chip(ctx, `${cat.categoryName} ${Math.round(cat.score * 100)}%`, x, b.originY - 26, accent);
    }
  }
}

/** Gesture - hand skeleton + the top recognised gesture per hand. */
export function drawGestures(ctx, result, { accent = ACCENT, mirror = false } = {}) {
  const utils = new DrawingUtils(ctx);
  const hands = result?.landmarks ?? [];
  hands.forEach((landmarks, i) => {
    const pts = mirror ? mirrorLandmarks(landmarks) : landmarks;
    utils.drawConnectors(pts, GestureRecognizer.HAND_CONNECTIONS, { color: INK, lineWidth: 4 });
    utils.drawLandmarks(pts, { color: accent, lineWidth: 1, radius: 4 });
    const gesture = result.gestures?.[i]?.[0];
    if (gesture && gesture.categoryName && gesture.categoryName !== 'None') {
      const wrist = pts[0];
      const x = wrist.x * ctx.canvas.width;
      const y = wrist.y * ctx.canvas.height + 12;
      chip(ctx, `${gesture.categoryName} ${Math.round(gesture.score * 100)}%`, x, y, accent);
    }
  });
}

/** Body pose - skeleton + joints for every detected person. */
export function drawPose(ctx, result, { accent = ACCENT, mirror = false } = {}) {
  const utils = new DrawingUtils(ctx);
  for (const landmarks of result?.landmarks ?? []) {
    const pts = mirror ? mirrorLandmarks(landmarks) : landmarks;
    utils.drawConnectors(pts, PoseLandmarker.POSE_CONNECTIONS, { color: INK, lineWidth: 4 });
    utils.drawLandmarks(pts, { color: accent, lineWidth: 1, radius: 5 });
  }
}

const DRAWERS = { detect: drawDetections, gesture: drawGestures, pose: drawPose };

/** Dispatch to the right drawer for a task kind. */
export function draw(ctx, kind, result, options) {
  const drawer = DRAWERS[kind];
  if (!drawer) throw new Error(`No drawer for task kind "${kind}"`);
  drawer(ctx, result, options);
}
