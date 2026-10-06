/**
 * @gipity/web-vision-detect
 *
 * A browser object-detection kit for Gipity apps. Runs YOLOX (Apache-2.0)
 * on ONNX Runtime Web - WebGPU-accelerated where the browser has it, WASM
 * fallback everywhere else - behind one camera + render-loop API. Detects
 * the 80 COCO classes out of the box, or load your own custom-trained
 * YOLOX / Ultralytics-YOLO ONNX export. Runs fully client-side: no server,
 * no upload, the camera stream never leaves the device.
 *
 * Web only (needs getUserMedia, WASM, canvas). Requires HTTPS or localhost.
 *
 * High-level - one call wires camera, inference loop, and overlay:
 *
 *   import { mountDetect } from '@gipity/web-vision-detect';
 *
 *   const vision = await mountDetect({
 *     video:  document.querySelector('video'),
 *     canvas: document.querySelector('canvas'),
 *     model:  'nano',                    // 'nano' | 'tiny' | 's' | {url, format, inputSize}
 *     onFps:  (fps) => hud.textContent = fps + ' FPS',
 *     onResult: ({ detections }) => { ... },   // app logic per frame
 *   });
 *   await vision.switchModel('s');       // trade frame rate for accuracy
 *   await vision.flipCamera();           // user <-> environment
 *   const r = await vision.detect(img);  // one-off: detect on an <img>/canvas
 *   vision.counts();                     // { person: 3, bus: 1 } in the newest frame
 *   vision.stop();
 *
 * The model starts downloading alongside the camera permission prompt - so
 * mount it on page load, not behind a click. Live state is published on <html>
 * as data-vision="loading|ready|error|stopped" (and window.__visionReady), and
 * the mounted instance on window.__vision.
 *
 * VERIFYING A DEPLOYED DETECTION APP (headless, no webcam in the room): a plain
 * page load has NO camera, so the app lands on data-vision="error" - that is
 * the app working, not a bug. Give the browser a camera that plays a photo you
 * chose, and read back what the model counted in it, in one command:
 *
 *   gipity page eval <url> --camera street.jpg --wait-for '[data-vision="ready"]' \
 *     --wait-timeout 25000 "window.__vision.counts()"    // -> { person: 3, bus: 1 }
 *
 * Use a real photograph of COCO-class objects. An empty {} means the model saw
 * nothing in that picture - try another photo, not a longer wait.
 *
 * Low-level - compose the pieces yourself: createDetector + startCamera +
 * createLoop + drawDetections. See examples/ for worked files.
 *
 * License note: YOLOX (Megvii) and ONNX Runtime are Apache-2.0/MIT - free
 * for commercial use, no copyleft obligation on your app. (The popular
 * Ultralytics YOLO models are AGPL-3.0 - if you load one as a custom model,
 * that license is between you and Ultralytics.)
 */

import { createDetector } from './lib/detector.js';
import { startCamera, canSwitchFacing } from './lib/camera.js';
import { createLoop } from './lib/loop.js';
import { fitCanvas, clearCanvas, drawDetections } from './lib/draw.js';
import { countLabels } from './lib/labels.js';

/**
 * Publish the vision lifecycle where anything can see it: a `data-vision`
 * attribute on <html> ('loading' | 'ready' | 'error' | 'stopped'), mirrored
 * onto `window.__visionReady`. 'ready' means the first inference frame has
 * been drawn - the app is genuinely live, not just mounted - so it is what a
 * headless check waits on. It only reaches 'ready' when the browser has a
 * camera: pass `--camera <image>` to any `gipity page` command, or the app
 * will correctly report 'error' instead.
 */
function setVisionState(state) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.vision = state;
  window.__visionReady = state === 'ready';
}
setVisionState('loading');

/**
 * Wire a camera, an inference loop, and a canvas overlay in one call.
 * @param {Object} config
 * @param {HTMLVideoElement}  config.video
 * @param {HTMLCanvasElement} config.canvas
 * @param {string|Object} [config.model]  Preset ('nano' default, 'tiny', 's')
 *                                        or a custom spec {url, format, inputSize, labels}.
 * @param {'auto'|'webgpu'|'wasm'} [config.backend]  Default 'auto'.
 * @param {number} [config.scoreThreshold]  Min confidence (default 0.5).
 * @param {number} [config.iouThreshold]    NMS overlap cutoff (default 0.45).
 * @param {number} [config.maxDetections]   Cap per frame (default 50).
 * @param {Object} [config.camera]       Passed to startCamera (facingMode, width, height).
 * @param {boolean} [config.mirror]      Flip detection geometry horizontally so
 *                                       it aligns with a CSS-mirrored video.
 *                                       Defaults to true when facingMode='user'.
 * @param {boolean} [config.showScore]   Draw confidence pct in captions (default true).
 * @param {Function} [config.onFps]      `(fps) => void` per completed inference.
 * @param {Function} [config.onResult]   `(result) => void` per frame, after drawing.
 *                                       result = { detections, inferMs, backend }.
 * @param {Function} [config.onReady]    `() => void` once, after the first frame is drawn.
 * @returns {Promise<{switchModel:Function, detect:Function, latest:Function,
 *   counts:Function, pause:Function,
 *   resume:Function, setScoreThreshold:Function,
 *   setCamera:Function, flipCamera:Function, hasMultipleCameras:Function,
 *   currentModel:Function, currentBackend:Function, currentFacingMode:Function,
 *   currentMirror:Function, stop:Function, video, canvas}>}
 */
export async function mountDetect(config) {
  const {
    video,
    canvas,
    model = 'nano',
    backend,
    scoreThreshold,
    iouThreshold,
    maxDetections,
    camera: cameraOptions = {},
    mirror,
    showScore = true,
    onFps,
    onResult,
    onReady,
  } = config;
  if (!video || !canvas) throw new Error('mountDetect needs both { video, canvas } elements.');

  // Live option state: setScoreThreshold/setCamera mutate these, so a later
  // switchModel/flipCamera rebuilds with the *current* settings rather than
  // the construction-time ones.
  const detectorOptions = { backend, scoreThreshold, iouThreshold, maxDetections };
  let camOpts = { facingMode: 'environment', ...cameraOptions };
  const ctx = canvas.getContext('2d');
  let mirrored = mirror ?? (camOpts.facingMode === 'user');

  // Model download and camera permission run side by side: the multi-MB fetch
  // finishes while the user is still looking at the permission prompt.
  const detectorPromise = createDetector({ ...detectorOptions, model });
  let cam;
  try {
    cam = await startCamera(video, camOpts);
  } catch (err) {
    detectorPromise.then((d) => d.close(), () => {}); // no camera: don't leak the model
    setVisionState('error');
    throw err;
  }

  // `detector` is swappable; the loop reads it through a stable closure.
  let detector;
  try {
    detector = await detectorPromise;
  } catch (err) {
    cam.stop();
    setVisionState('error');
    throw err;
  }

  let latest = null;   // the newest live frame's result
  const loop = createLoop({
    video,
    detect: (v) => detector.detect(v),
    onFrame: (result, fps) => {
      fitCanvas(canvas, video);
      clearCanvas(ctx);
      drawDetections(ctx, result, { mirror: mirrored, showScore });
      onFps?.(fps);
      onResult?.(result);
      const first = !latest;
      latest = result;
      if (first) {
        setVisionState('ready');
        onReady?.();
      }
    },
  });
  loop.start();

  const vision = {
    /** Swap the model. Closes the old one to free GPU/WASM memory. */
    async switchModel(nextModel, nextOptions = {}) {
      loop.stop();
      const next = await createDetector({ ...detectorOptions, ...nextOptions, model: nextModel });
      await detector.close();
      detector = next;
      clearCanvas(ctx);
      loop.start();
    },
    /** One-off detection on any drawable source (<img>, canvas, video). */
    detect: (source) => detector.detect(source),
    /** The newest live frame's result ({ detections, inferMs, backend }), or
     *  null before the first frame. */
    latest: () => latest,
    /** What the newest live frame holds, per label: { person: 3, bus: 1 }.
     *  {} when nothing is in view (or before the first frame). */
    counts: () => countLabels(latest?.detections ?? []),
    /** Pause the live loop (camera + model stay warm) - e.g. while showing
     *  a still-photo result. Resume with resume(). */
    pause() { loop.stop(); },
    resume() { loop.start(); },
    /** Adjust the confidence cutoff live (no model reload). */
    setScoreThreshold(v) {
      detectorOptions.scoreThreshold = v;
      detector.setScoreThreshold(v);
    },
    /**
     * Restart the camera with new constraints (e.g. a different facingMode).
     * Mirroring auto-tracks the front/rear convention unless an explicit
     * `mirror` is passed.
     * @returns {Promise<{facingMode:string, mirror:boolean}>}
     */
    async setCamera({ mirror: nextMirror, ...rest } = {}) {
      loop.stop();
      cam.stop();
      camOpts = { ...camOpts, ...rest };
      mirrored = nextMirror ?? (camOpts.facingMode === 'user');
      cam = await startCamera(video, camOpts);
      clearCanvas(ctx);
      loop.start();
      return { facingMode: camOpts.facingMode, mirror: mirrored };
    },
    /** Toggle front <-> rear camera. Resolves with the new state. */
    async flipCamera() {
      const next = camOpts.facingMode === 'user' ? 'environment' : 'user';
      return this.setCamera({ facingMode: next });
    },
    /** True iff flipping facing mode would land on a *different* physical
     *  camera. Returns false on desktops with one lens + virtual cams. */
    hasMultipleCameras: () => canSwitchFacing(cam.stream.getVideoTracks()[0]),
    /** The active model spec ({ name, url, format, inputSize }). */
    currentModel: () => detector.model,
    /** Which execution provider is running: 'webgpu' or 'wasm'. */
    currentBackend: () => detector.backend,
    /** Current camera facing mode ('user' | 'environment'). */
    currentFacingMode: () => camOpts.facingMode,
    /** Whether the overlay is currently mirroring geometry. */
    currentMirror: () => mirrored,
    /** Tear everything down: stop the loop, free the model, stop the camera. */
    stop() {
      loop.stop();
      detector.close();
      cam.stop();
      clearCanvas(ctx);
      setVisionState('stopped');
    },
    video,
    canvas,
  };

  // The handle a headless check reaches for: `gipity page eval <url> --camera
  // street.jpg "window.__vision.counts()"` verifies the deployed app without a
  // webcam, a click, or any app-specific test hook.
  if (typeof window !== 'undefined') window.__vision = vision;
  return vision;
}

// Low-level building blocks.
export { createDetector } from './lib/detector.js';
export { startCamera, canSwitchFacing } from './lib/camera.js';
export { createLoop, createFps } from './lib/loop.js';
export { fitCanvas, clearCanvas, drawDetections } from './lib/draw.js';
export { FORMATS, makeGrids, decodeYolox, decodeYolo, letterboxParams, mapToSource } from './lib/decode.js';
export { nms } from './lib/nms.js';
export { COCO_LABELS, countLabels } from './lib/labels.js';
export { PRESETS, PRESET_NAMES, resolveModel, ORT_VERSION, ORT_WASM_BASE } from './lib/models.js';

export default mountDetect;
