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
 */

import {
  FilesetResolver,
  GestureRecognizer,
  ObjectDetector,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';
import { WASM_BASE, MODELS, TASK_KINDS } from './models.js';

// The WASM fileset is shared by every task - resolve it once.
let filesetPromise = null;
function loadFileset() {
  if (!filesetPromise) filesetPromise = FilesetResolver.forVisionTasks(WASM_BASE);
  return filesetPromise;
}

// Per-kind: how to build the detector, and how to run it on a video frame.
const TASKS = {
  gesture: {
    build: (fileset, opts) => GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: opts.model || MODELS.gesture, delegate: opts.delegate || 'GPU' },
      runningMode: 'VIDEO',
      numHands: opts.numHands ?? 2,
    }),
    run: (detector, video, ts) => detector.recognizeForVideo(video, ts),
  },
  detect: {
    build: (fileset, opts) => ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: opts.model || MODELS.detect, delegate: opts.delegate || 'GPU' },
      runningMode: 'VIDEO',
      scoreThreshold: opts.scoreThreshold ?? 0.5,
      maxResults: opts.maxResults ?? -1,
    }),
    run: (detector, video, ts) => detector.detectForVideo(video, ts),
  },
  pose: {
    build: (fileset, opts) => PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: opts.model || MODELS.pose, delegate: opts.delegate || 'GPU' },
      runningMode: 'VIDEO',
      numPoses: opts.numPoses ?? 1,
    }),
    run: (detector, video, ts) => detector.detectForVideo(video, ts),
  },
};

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
  const fileset = await loadFileset();
  const detector = await spec.build(fileset, options);

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
