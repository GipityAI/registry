/**
 * Vision task factory.
 *
 * Wraps the three MediaPipe Tasks this kit ships - gesture recognition,
 * object detection, body pose - behind one shape: `createTask(kind)` returns
 * a task with a uniform `.detect(video, timestampMs)` call and `.close()`.
 *
 * MediaPipe's per-task classes each have their own video method name
 * (`recognizeForVideo` vs `detectForVideo`); this module hides that. The
 * value `.detect()` returns is the task's native MediaPipe result - the
 * draw helpers in draw.js consume those shapes directly.
 *
 * `detectImage(kind, source)` runs the same models on a still picture instead
 * of a camera - which is how you check a model headlessly, with no webcam in
 * the room. See its docstring.
 */

import {
  FilesetResolver,
  GestureRecognizer,
  ObjectDetector,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';
import { WASM_BASE, MODELS, TASK_KINDS } from './models.js';

// The WASM fileset is shared by every task - resolve it once, and start that
// download the moment this module is imported (i.e. at page load) rather than
// on the first detect. It is several MB and task-independent, so warming it
// here overlaps it with the rest of the page - and, in a camera app, with the
// permission prompt - instead of stalling the first frame.
let filesetPromise = null;
function loadFileset() {
  if (!filesetPromise) {
    filesetPromise = FilesetResolver.forVisionTasks(WASM_BASE).catch((err) => {
      filesetPromise = null; // a transient network failure shouldn't poison every later call
      throw err;
    });
  }
  return filesetPromise;
}

if (typeof window !== 'undefined') loadFileset().catch(() => { /* surfaced on first createTask */ });

// Per-kind: how to build the detector, and how to run it on a video frame
// (`run`) or on a still image (`runImage`). A detector is built for one
// runningMode and can only be called the matching way.
const TASKS = {
  gesture: {
    build: (fileset, opts, runningMode) => GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: opts.model || MODELS.gesture, delegate: opts.delegate || 'GPU' },
      runningMode,
      numHands: opts.numHands ?? 2,
    }),
    run: (detector, video, ts) => detector.recognizeForVideo(video, ts),
    runImage: (detector, image) => detector.recognize(image),
  },
  detect: {
    build: (fileset, opts, runningMode) => ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: opts.model || MODELS.detect, delegate: opts.delegate || 'GPU' },
      runningMode,
      scoreThreshold: opts.scoreThreshold ?? 0.5,
      maxResults: opts.maxResults ?? -1,
    }),
    run: (detector, video, ts) => detector.detectForVideo(video, ts),
    runImage: (detector, image) => detector.detect(image),
  },
  pose: {
    build: (fileset, opts, runningMode) => PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: opts.model || MODELS.pose, delegate: opts.delegate || 'GPU' },
      runningMode,
      numPoses: opts.numPoses ?? 1,
    }),
    run: (detector, video, ts) => detector.detectForVideo(video, ts),
    runImage: (detector, image) => detector.detect(image),
  },
};

// Detectors built ahead of time by prewarm(), keyed by kind + options. The
// first createTask() with a matching key takes ownership of the built detector
// (and therefore of close()ing it), so nothing is downloaded or built twice.
const warmed = new Map();
const warmKey = (kind, options) => `${kind}:${JSON.stringify(options)}`;

/**
 * Start downloading a task's model *now*, before you need it - e.g. on page
 * load, while the user is still deciding whether to grant the camera. The
 * later `createTask(kind, options)` with the same options resolves instantly.
 * Safe to call more than once; the work happens once.
 * @param {'gesture'|'detect'|'pose'} kind
 * @param {Object} [options]  Same options you will pass to createTask.
 * @returns {Promise<Object>} the built MediaPipe detector (usually ignored)
 */
export function prewarm(kind, options = {}) {
  const spec = TASKS[kind];
  if (!spec) {
    return Promise.reject(new Error(`Unknown vision task "${kind}". Use one of: ${TASK_KINDS.join(', ')}`));
  }
  const key = warmKey(kind, options);
  if (!warmed.has(key)) {
    warmed.set(key, loadFileset().then((fileset) => spec.build(fileset, options, 'VIDEO')).catch((err) => {
      warmed.delete(key); // let a retry rebuild rather than caching the failure
      throw err;
    }));
  }
  return warmed.get(key);
}

// Image-mode detectors, kept for the life of the page and shared by every
// detectImage() call: they are independent of the VIDEO-mode detector the
// camera loop owns, so checking a still picture never disturbs a running app.
const imageTasks = new Map();

/** Turn whatever the caller passed into something MediaPipe can read. A URL
 *  (or app-relative path) is fetched and decoded; an <img>/<canvas>/ImageBitmap
 *  is used as-is. */
async function toImageSource(source) {
  if (typeof source !== 'string') return source;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = source;
  try {
    await img.decode();
  } catch (err) {
    throw new Error(
      `Could not load the image "${source}" (${err?.message || err}). ` +
      'Pass a URL the page can fetch (same-origin, or CORS-enabled), or an <img>/<canvas>/ImageBitmap.',
    );
  }
  return img;
}

/**
 * Run a task on a STILL IMAGE instead of the camera - the same model, the same
 * result shape, no webcam required. Use it to check what the model actually
 * sees in a known frame, independently of whether the app's camera wiring is
 * right:
 *
 *   import { detectImage, gestureName } from '@gipity/web-vision-mediapipe';
 *   gestureName(await detectImage('gesture', '/fixtures/rock.png'));  // 'Closed_Fist'
 *
 * That works headlessly, so a deployed gesture app can be verified end to end
 * from the CLI - no camera, no clicking:
 *
 *   gipity page eval <url> "await window.__vision.detectFrom('/fixtures/rock.png')"
 *
 * @param {'gesture'|'detect'|'pose'} kind
 * @param {string|HTMLImageElement|HTMLCanvasElement|ImageBitmap} source  URL/path, or a decoded image.
 * @param {Object} [options]  Same options as createTask.
 * @returns {Promise<Object>} the task's native MediaPipe result.
 */
export async function detectImage(kind, source, options = {}) {
  const spec = TASKS[kind];
  if (!spec) {
    throw new Error(`Unknown vision task "${kind}". Use one of: ${TASK_KINDS.join(', ')}`);
  }
  const key = warmKey(kind, options);
  if (!imageTasks.has(key)) {
    imageTasks.set(key, loadFileset().then((fileset) => spec.build(fileset, options, 'IMAGE')).catch((err) => {
      imageTasks.delete(key);
      throw err;
    }));
  }
  const [detector, image] = await Promise.all([imageTasks.get(key), toImageSource(source)]);
  return spec.runImage(detector, image);
}

/**
 * Create a vision task.
 * @param {'gesture'|'detect'|'pose'} kind
 * @param {Object} [options]
 * @param {string}  [options.model]     Override the model URL.
 * @param {'GPU'|'CPU'} [options.delegate]  Inference delegate (default 'GPU').
 * @param {number} [options.numHands]   gesture only - max hands (default 2).
 * @param {number} [options.numPoses]   pose only - max bodies (default 1).
 * @param {number} [options.scoreThreshold] detect only - min score (default 0.5).
 * @param {number} [options.maxResults] detect only - cap detections (default unlimited).
 * @returns {Promise<{kind:string, detect:Function, raw:Object, close:Function}>}
 */
export async function createTask(kind, options = {}) {
  const spec = TASKS[kind];
  if (!spec) {
    throw new Error(`Unknown vision task "${kind}". Use one of: ${TASK_KINDS.join(', ')}`);
  }
  // Reuses a prewarm()ed detector if one is waiting; otherwise builds one now.
  const detector = await prewarm(kind, options);
  warmed.delete(warmKey(kind, options)); // this caller now owns it (and its close())

  return {
    kind,
    /**
     * Run inference on the current video frame.
     * `timestampMs` must strictly increase across calls - pass
     * `performance.now()` (the default) and never call twice for one frame.
     */
    detect(video, timestampMs) {
      return spec.run(detector, video, timestampMs ?? performance.now());
    },
    raw: detector,
    close() { detector.close(); },
  };
}
