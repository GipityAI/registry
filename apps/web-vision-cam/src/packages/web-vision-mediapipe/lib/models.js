/**
 * Pinned MediaPipe version + model catalog.
 *
 * One place to bump everything: the esm.sh JS import (wired in the app's
 * import map by `gipity add`), the WASM runtime, and the WASM URL must all
 * agree on VERSION - a mismatch fails to load. To upgrade, change VERSION
 * here AND the two `@mediapipe/tasks-vision@...` URLs in package.json.
 *
 * Models are Google-hosted, Apache-2.0, and small enough to fetch on first
 * use (a few MB each, then browser-cached). They are NOT bundled with the
 * kit - swap any URL for your own hosted model of the same task type.
 */

export const MEDIAPIPE_VERSION = '0.10.35';

/** Directory the MediaPipe WASM runtime is loaded from (passed to FilesetResolver). */
export const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

const MODEL_HOST = 'https://storage.googleapis.com/mediapipe-models';

/** Default model per task. `efficientdet_lite0` is the fast/light detector;
 *  swap to `efficientdet_lite2` for more accuracy at a lower frame rate. */
export const MODELS = {
  gesture: `${MODEL_HOST}/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task`,
  detect: `${MODEL_HOST}/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`,
  pose: `${MODEL_HOST}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
};

/** The task kinds this kit supports. */
export const TASK_KINDS = ['gesture', 'detect', 'pose'];
