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
 *     // One event per deliberate gesture, already de-flickered:
 *     // 'Closed_Fist' | 'Open_Palm' | 'Victory' | 'Thumb_Up' | 'Thumb_Down'
 *     // | 'Pointing_Up' | 'ILoveYou'  (see GESTURES in lib/gestures.js)
 *     onGesture: (name) => playRound(name),
 *   });
 *   vision.gesture();                  // ...or ASK what the hand is holding,
 *                                      // for an app on its own clock (a
 *                                      // countdown, a round timer, a shutter)
 *   await vision.switchTask('pose');   // 'gesture' | 'detect' | 'pose'
 *   await vision.flipCamera();         // user <-> environment
 *   vision.stop();
 *
 * The WASM runtime starts downloading as soon as this module is imported, and
 * the model download overlaps the camera permission prompt - so mount it on
 * page load, not behind a click. Live state is published on <html> as
 * data-vision="loading|ready|error|stopped" (and window.__visionReady), and the
 * mounted instance on window.__vision.
 *
 * VERIFYING A DEPLOYED VISION APP (headless, no webcam in the room): a plain
 * page load has NO camera, so the app lands on data-vision="error" - that is
 * the app working, not a bug. Give the browser a camera to hand it a frame you
 * chose, and read back what the model made of it:
 *
 *   gipity page eval <url> --camera rock.png --wait-for '[data-vision="ready"]' \
 *     "window.__vision.gesture()"                      // -> 'Closed_Fist'
 *   gipity page screenshot <url> --camera rock.png     // see the round play out
 *
 * No frame to hand it? `gipity generate image "a closed fist, palm to camera"`.
 * To check a model against a picture with no camera at all (and no app wiring
 * in the way), `vision.detectFrom(url)` runs the same model on a still image.
 *
 * Low-level - compose the pieces yourself: createTask + startCamera +
 * createLoop + draw. See examples/ for one worked file per task.
 *
 * License note: MediaPipe (the library and the default models) is
 * Apache-2.0 - free for commercial use. The object detector is
 * EfficientDet-Lite; fast, but less accurate than a dedicated detector.
 */

import { createTask, detectImage } from './lib/tasks.js';
import { startCamera, canSwitchFacing } from './lib/camera.js';
import { createLoop } from './lib/loop.js';
import { fitCanvas, clearCanvas, draw } from './lib/draw.js';
import { TASK_KINDS } from './lib/models.js';
import { createGestureGate } from './lib/gestures.js';

/**
 * Publish the vision lifecycle where anything can see it: a `data-vision`
 * attribute on <html> ('loading' | 'ready' | 'error' | 'stopped'), mirrored
 * onto `window.__visionReady`. 'ready' means the first inference frame has
 * been drawn - the app is genuinely live, not just mounted - so it is what a
 * headless check waits on. Note it only reaches 'ready' when the browser has a
 * camera: pass `--camera <image>` (or `--fake-media`) to any `gipity page`
 * command, or the app will correctly report 'error' instead.
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
 * @param {'gesture'|'detect'|'pose'} [config.kind]  Initial task (default 'gesture').
 * @param {Object} [config.taskOptions]  Passed to createTask (model, delegate, ...).
 * @param {Object} [config.camera]       Passed to startCamera (facingMode, width, height).
 * @param {boolean} [config.mirror]      Flip detection geometry horizontally so
 *                                       it aligns with a CSS-mirrored video.
 *                                       Defaults to true when facingMode='user'.
 * @param {Function} [config.onFps]      `(fps) => void` each frame.
 * @param {Function} [config.onResult]   `(result, kind) => void` each frame, after drawing.
 * @param {Function} [config.onReady]    `() => void` once, after the first frame is drawn.
 * @param {Function} [config.onGesture]  gesture task only - `(name) => void` once per
 *                                       deliberate gesture, e.g. 'Closed_Fist'. The
 *                                       raw per-frame label flickers; this fires only
 *                                       after the pose is held steady, and not again
 *                                       until the hand changes. See lib/gestures.js.
 * @param {Object} [config.gestureHold]  `{ holdMs = 500, minScore = 0.5, hand = 0 }`
 *                                       tuning for onGesture and gesture().
 * @returns {Promise<{switchTask:Function, flipCamera:Function, setCamera:Function, hasMultipleCameras:Function, currentTask:Function, gesture:Function, resetGesture:Function, currentFacingMode:Function, currentMirror:Function, stop:Function, video, canvas}>}
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
    onReady,
    onGesture,
    gestureHold = {},
  } = config;
  if (!video || !canvas) throw new Error('mountVision needs both { video, canvas } elements.');

  const ctx = canvas.getContext('2d');
  let facingMode = cameraOptions.facingMode || 'user';
  let mirrored = mirror ?? (facingMode === 'user');

  // Model download and camera permission run side by side: the multi-MB fetch
  // finishes while the user is still looking at the permission prompt, so the
  // first frame lands as soon as the stream does.
  const taskPromise = createTask(kind, taskOptions);
  let cam;
  try {
    cam = await startCamera(video, { ...cameraOptions, facingMode });
  } catch (err) {
    taskPromise.then((t) => t.close(), () => {}); // no camera: don't leak the detector
    setVisionState('error');
    throw err;
  }

  // `task` is swappable; the loop reads it through a stable closure. The
  // options it was built with travel with it, so detectFrom() runs the still
  // image through the same model the camera is running.
  let task;
  let taskOpts = taskOptions;
  try {
    task = await taskPromise;
  } catch (err) {
    cam.stop();
    setVisionState('error');
    throw err;
  }

  let firstFrame = true;
  const gate = createGestureGate(gestureHold);
  const loop = createLoop({
    video,
    detect: (v, ts) => task.detect(v, ts),
    onFrame: (result, fps) => {
      fitCanvas(canvas, video);
      clearCanvas(ctx);
      draw(ctx, task.kind, result, { mirror: mirrored });
      onFps?.(fps);
      onResult?.(result, task.kind);
      if (task.kind === 'gesture') {
        const thrown = gate.read(result);
        if (thrown) onGesture?.(thrown);
      }
      if (firstFrame) {
        firstFrame = false;
        setVisionState('ready');
        onReady?.();
      }
    },
  });
  loop.start();

  const vision = {
    /** Swap the active task. Closes the old one to free GPU memory. */
    async switchTask(nextKind, nextOptions = {}) {
      if (!TASK_KINDS.includes(nextKind)) {
        throw new Error(`Unknown vision task "${nextKind}". Use one of: ${TASK_KINDS.join(', ')}`);
      }
      loop.stop();
      const next = await createTask(nextKind, nextOptions);
      task.close();
      task = next;
      taskOpts = nextOptions;
      clearCanvas(ctx);
      gate?.reset();
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
      gate?.reset();
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
    /**
     * The gesture the hand is holding right now (steady for `gestureHold.holdMs`),
     * or null. Poll this when your app has its own clock - a "3, 2, 1, shoot!"
     * countdown samples it at shoot:
     *
     *   const thrown = vision.gesture();   // 'Closed_Fist' | 'Open_Palm' | ...
     *
     * Don't cache `onGesture` events for this instead: that callback won't
     * re-fire while the hand is unchanged, so a player throwing the same pose
     * two rounds running would score the second round off a stale event.
     */
    gesture: () => gate.stable(),
    /** Drop any in-progress gesture hold (e.g. when a new round starts). */
    resetGesture: () => gate.reset(),
    /**
     * Run the current task on a STILL IMAGE - a URL, an app-relative path, or a
     * decoded <img>/<canvas>/ImageBitmap - and return the model's native result.
     * The camera loop keeps running; this uses its own image-mode detector.
     *
     * This is how you answer "does the model even see a fist in this picture?"
     * without a camera, and without the app's wiring being right first:
     *
     *   const r = await vision.detectFrom('/fixtures/rock.png');
     *   gestureName(r);                  // 'Closed_Fist'
     */
    detectFrom: (source, options = {}) => detectImage(task.kind, source, { ...taskOpts, ...options }),
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
      setVisionState('stopped');
    },
    video,
    canvas,
  };

  // The handle a headless check reaches for: `gipity page eval <url> --camera
  // rock.png "window.__vision.gesture()"` verifies the deployed app without a
  // webcam, a click, or any app-specific test hook.
  if (typeof window !== 'undefined') window.__vision = vision;
  return vision;
}

// Low-level building blocks.
export { GESTURES, gestureName, createGestureGate } from './lib/gestures.js';
export { createTask, prewarm, detectImage } from './lib/tasks.js';
export { startCamera, canSwitchFacing } from './lib/camera.js';
export { createLoop, createFps } from './lib/loop.js';
export { fitCanvas, clearCanvas, draw, drawDetections, drawGestures, drawPose } from './lib/draw.js';
export { MODELS, MEDIAPIPE_VERSION, WASM_BASE, TASK_KINDS } from './lib/models.js';

export default mountVision;
