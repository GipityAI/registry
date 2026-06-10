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
 *   vision.stop();
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
 * @returns {Promise<{switchModel:Function, detect:Function, pause:Function,
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
  } = config;
  if (!video || !canvas) throw new Error('mountDetect needs both { video, canvas } elements.');

  const detectorOptions = { backend, scoreThreshold, iouThreshold, maxDetections };
  const ctx = canvas.getContext('2d');
  let facingMode = cameraOptions.facingMode || 'environment';
  let mirrored = mirror ?? (facingMode === 'user');
  let cam = await startCamera(video, { ...cameraOptions, facingMode });

  // `detector` is swappable; the loop reads it through a stable closure.
  let detector = await createDetector({ ...detectorOptions, model });

  const loop = createLoop({
    video,
    detect: (v) => detector.detect(v),
    onFrame: (result, fps) => {
      fitCanvas(canvas, video);
      clearCanvas(ctx);
      drawDetections(ctx, result, { mirror: mirrored, showScore });
      onFps?.(fps);
      onResult?.(result);
    },
  });
  loop.start();

  return {
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
    /** Pause the live loop (camera + model stay warm) - e.g. while showing
     *  a still-photo result. Resume with resume(). */
    pause() { loop.stop(); },
    resume() { loop.start(); },
    /** Adjust the confidence cutoff live (no model reload). */
    setScoreThreshold: (v) => detector.setScoreThreshold(v),
    /**
     * Restart the camera with new constraints (e.g. a different facingMode).
     * Mirroring auto-tracks the front/rear convention unless an explicit
     * `mirror` is passed.
     * @returns {Promise<{facingMode:string, mirror:boolean}>}
     */
    async setCamera({ facingMode: nextFacing, mirror: nextMirror, ...rest } = {}) {
      loop.stop();
      cam.stop();
      facingMode = nextFacing || facingMode;
      mirrored = nextMirror ?? (facingMode === 'user');
      cam = await startCamera(video, { ...cameraOptions, ...rest, facingMode });
      clearCanvas(ctx);
      loop.start();
      return { facingMode, mirror: mirrored };
    },
    /** Toggle front <-> rear camera. Resolves with the new state. */
    async flipCamera() {
      const next = facingMode === 'user' ? 'environment' : 'user';
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
    currentFacingMode: () => facingMode,
    /** Whether the overlay is currently mirroring geometry. */
    currentMirror: () => mirrored,
    /** Tear everything down: stop the loop, free the model, stop the camera. */
    stop() {
      loop.stop();
      detector.close();
      cam.stop();
      clearCanvas(ctx);
    },
    video,
    canvas,
  };
}

// Low-level building blocks.
export { createDetector } from './lib/detector.js';
export { startCamera, canSwitchFacing } from './lib/camera.js';
export { createLoop, createFps } from './lib/loop.js';
export { fitCanvas, clearCanvas, drawDetections } from './lib/draw.js';
export { makeGrids, decodeYolox, decodeYolo, letterboxParams, mapToSource } from './lib/decode.js';
export { nms } from './lib/nms.js';
export { COCO_LABELS } from './lib/labels.js';
export { PRESETS, PRESET_NAMES, resolveModel, ORT_VERSION, ORT_WASM_BASE } from './lib/models.js';

export default mountDetect;
