/**
 * @gipity/web-vision-mediapipe
 *
 * A browser vision kit for Gipity apps. Wraps Google MediaPipe Tasks -
 * gesture recognition, body pose, object detection - behind one camera +
 * render-loop API. Runs fully client-side: no server, no upload, the camera
 * stream never leaves the device.
 *
 * Web only (needs getUserMedia, WASM, canvas). Requires HTTPS or localhost.
 *
 * High-level - one call wires camera, inference loop, and overlay:
 *
 *   import { mountVision } from '@gipity/web-vision-mediapipe';
 *
 *   const vision = await mountVision({
 *     video:  document.querySelector('video'),
 *     canvas: document.querySelector('canvas'),
 *     kind:   'gesture',
 *     onFps:  (fps) => hud.textContent = fps + ' FPS',
 *   });
 *   await vision.switchTask('pose');   // 'gesture' | 'detect' | 'pose'
 *   await vision.flipCamera();         // user <-> environment
 *   vision.stop();
 *
 * Low-level - compose the pieces yourself: createTask + startCamera +
 * createLoop + draw. See examples/ for one worked file per task.
 *
 * License note: MediaPipe (the library and the default models) is
 * Apache-2.0 - free for commercial use. The object detector is
 * EfficientDet-Lite; fast, but less accurate than a dedicated detector.
 */

import { createTask } from './lib/tasks.js';
import { startCamera, canSwitchFacing } from './lib/camera.js';
import { createLoop } from './lib/loop.js';
import { fitCanvas, clearCanvas, draw } from './lib/draw.js';
import { TASK_KINDS } from './lib/models.js';

/**
 * Wire a camera, an inference loop, and a canvas overlay in one call.
 * @param {Object} config
 * @param {HTMLVideoElement}  config.video
 * @param {HTMLCanvasElement} config.canvas
 * @param {'gesture'|'detect'|'pose'} [config.kind]  Initial task (default 'gesture').
 * @param {Object} [config.taskOptions]  Passed to createTask (model, delegate, ...).
 * @param {Object} [config.camera]       Passed to startCamera (facingMode, width, height).
 * @param {boolean} [config.mirror]      Flip detection geometry horizontally so
 *                                       it aligns with a CSS-mirrored video.
 *                                       Defaults to true when facingMode='user'.
 * @param {Function} [config.onFps]      `(fps) => void` each frame.
 * @param {Function} [config.onResult]   `(result, kind) => void` each frame, after drawing.
 * @returns {Promise<{switchTask:Function, flipCamera:Function, setCamera:Function, hasMultipleCameras:Function, currentTask:Function, currentFacingMode:Function, currentMirror:Function, stop:Function, video, canvas}>}
 */
export async function mountVision(config) {
  const {
    video,
    canvas,
    kind = 'gesture',
    taskOptions = {},
    camera: cameraOptions = {},
    mirror,
    onFps,
    onResult,
  } = config;
  if (!video || !canvas) throw new Error('mountVision needs both { video, canvas } elements.');

  const ctx = canvas.getContext('2d');
  let facingMode = cameraOptions.facingMode || 'user';
  let mirrored = mirror ?? (facingMode === 'user');
  let cam = await startCamera(video, { ...cameraOptions, facingMode });

  // `task` is swappable; the loop reads it through a stable closure.
  let task = await createTask(kind, taskOptions);

  const loop = createLoop({
    video,
    detect: (v, ts) => task.detect(v, ts),
    onFrame: (result, fps) => {
      fitCanvas(canvas, video);
      clearCanvas(ctx);
      draw(ctx, task.kind, result, { mirror: mirrored });
      onFps?.(fps);
      onResult?.(result, task.kind);
    },
  });
  loop.start();

  return {
    /** Swap the active task. Closes the old one to free GPU memory. */
    async switchTask(nextKind, nextOptions = {}) {
      if (!TASK_KINDS.includes(nextKind)) {
        throw new Error(`Unknown vision task "${nextKind}". Use one of: ${TASK_KINDS.join(', ')}`);
      }
      loop.stop();
      const next = await createTask(nextKind, nextOptions);
      task.close();
      task = next;
      clearCanvas(ctx);
      loop.start();
    },
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
    /** Name of the task currently running. */
    currentTask: () => task.kind,
    /** Current camera facing mode ('user' | 'environment'). */
    currentFacingMode: () => facingMode,
    /** Whether the overlay is currently mirroring geometry. */
    currentMirror: () => mirrored,
    /** Tear everything down: stop the loop, free the task, stop the camera. */
    stop() {
      loop.stop();
      task.close();
      cam.stop();
      clearCanvas(ctx);
    },
    video,
    canvas,
  };
}

// Low-level building blocks.
export { createTask } from './lib/tasks.js';
export { startCamera, canSwitchFacing } from './lib/camera.js';
export { createLoop, createFps } from './lib/loop.js';
export { fitCanvas, clearCanvas, draw, drawDetections, drawGestures, drawPose } from './lib/draw.js';
export { MODELS, MEDIAPIPE_VERSION, WASM_BASE, TASK_KINDS } from './lib/models.js';

export default mountVision;
