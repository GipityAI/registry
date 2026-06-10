/**
 * Canvas overlay rendering for detections.
 *
 * `drawDetections` draws onto a 2D context whose canvas is sized to the video
 * frame (call `fitCanvas` first) - boxes arrive in frame pixels from
 * `detector.detect()`.
 *
 * Mirroring: front-facing camera feeds read naturally when flipped left/right.
 * The video element handles its own CSS mirror; the canvas is *not* mirrored
 * in CSS - if it were, every caption would read backwards. Instead, pass
 * `mirror: true` and the boxes flip while text stays upright.
 */

const ACCENT = '#f26522'; // Gipity orange
const INK = '#ffffff';

/** Match the canvas backing store to the video's real frame size. */
export function fitCanvas(canvas, video) {
  const w = video.videoWidth ?? video.naturalWidth ?? video.width;
  const h = video.videoHeight ?? video.naturalHeight ?? video.height;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

/** Wipe the overlay. Call once per frame before drawing. */
export function clearCanvas(ctx) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

// Draw a filled caption chip with its top-left at (x, y), kept on-canvas.
function chip(ctx, text, x, y, accent) {
  ctx.font = '600 18px system-ui, sans-serif';
  const padX = 8;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 26;
  const top = Math.max(0, y);
  const left = Math.max(0, Math.min(ctx.canvas.width - w, x));
  ctx.fillStyle = accent;
  ctx.fillRect(left, top, w, h);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + padX, top + h / 2 + 1);
}

/**
 * Boxes + "<label> <pct>%" captions.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{detections:Array}|Array} result  A detect() result or its array.
 * @param {Object} [opts]
 * @param {string}  [opts.accent]     Box/chip color (default Gipity orange).
 * @param {boolean} [opts.mirror]     Flip geometry for a CSS-mirrored video.
 * @param {boolean} [opts.showScore]  Append the confidence pct (default true).
 */
export function drawDetections(ctx, result, { accent = ACCENT, mirror = false, showScore = true } = {}) {
  const detections = Array.isArray(result) ? result : result?.detections ?? [];
  const W = ctx.canvas.width;
  for (const det of detections) {
    const b = det.box;
    const x = mirror ? W - b.x - b.width : b.x;
    ctx.lineWidth = 3;
    ctx.strokeStyle = accent;
    ctx.strokeRect(x, b.y, b.width, b.height);
    const text = showScore ? `${det.label} ${Math.round(det.score * 100)}%` : det.label;
    chip(ctx, text, x, b.y - 26, accent);
  }
}
