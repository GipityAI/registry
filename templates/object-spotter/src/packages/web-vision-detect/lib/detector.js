/**
 * Detector factory - the ONNX Runtime Web side of the kit.
 *
 * `createDetector(options)` loads a model and returns an object with one
 * async `detect(source)` call that takes any drawable source (a <video>,
 * <img>, or canvas) and returns detections in *source* pixel coordinates.
 *
 * Inference runs on WebGPU when the browser has it, with an automatic
 * fallback to WASM (SIMD) - both fully client-side. The ONNX Runtime WASM
 * binaries and the model are fetched on first use, then browser-cached.
 *
 * Preprocessing happens on a scratch canvas: the frame is letterboxed into
 * the model's square input (aspect ratio preserved, gray padding), then read
 * back and laid out as the CHW float tensor the model family expects. The
 * per-family contract (channel order, normalization, padding, decoder) lives
 * in the FORMATS table in lib/decode.js - this file is format-agnostic.
 */

import * as ort from 'onnxruntime-web';
import { ORT_WASM_BASE, resolveModel } from './models.js';
import { COCO_LABELS } from './labels.js';
import { FORMATS, letterboxParams, mapToSource } from './decode.js';
import { nms } from './nms.js';

// Letterbox padding value - 114/255 gray, the constant both YOLO families
// train with.
const PAD_FILL = 'rgb(114, 114, 114)';

// Tell ONNX Runtime where its WASM/WebGPU binaries live. Module scope:
// assignment is idempotent and ort is already imported eagerly above.
ort.env.wasm.wasmPaths = ORT_WASM_BASE;

async function createSession(url, backend) {
  const tryOrder = backend === 'auto'
    ? (navigator.gpu ? ['webgpu', 'wasm'] : ['wasm'])
    : [backend];
  let lastErr;
  for (const ep of tryOrder) {
    try {
      const session = await ort.InferenceSession.create(url, { executionProviders: [ep] });
      return { session, backend: ep };
    } catch (err) {
      lastErr = err;
      console.warn(`web-vision-detect: ${ep} backend failed, ${ep === tryOrder.at(-1) ? 'giving up' : 'falling back'}.`, err);
    }
  }
  throw lastErr;
}

/**
 * Load a detection model.
 * @param {Object} [options]
 * @param {string|Object} [options.model]  Preset name ('nano' | 'tiny' | 's',
 *   default 'nano') or a custom spec `{ url, format: 'yolox'|'yolo',
 *   inputSize, labels }`. See README "Custom models".
 * @param {'auto'|'webgpu'|'wasm'} [options.backend]  Default 'auto'.
 * @param {number} [options.scoreThreshold]  Min confidence 0..1 (default 0.5).
 * @param {number} [options.iouThreshold]    NMS overlap cutoff (default 0.45).
 * @param {number} [options.maxDetections]   Cap per frame (default 50).
 * @returns {Promise<{detect:Function, setScoreThreshold:Function, model:Object,
 *   backend:string, labels:string[], close:Function}>}
 */
export async function createDetector(options = {}) {
  const spec = resolveModel(options.model);
  const labels = spec.labels || COCO_LABELS;
  let scoreThreshold = options.scoreThreshold ?? 0.5;
  const iouThreshold = options.iouThreshold ?? 0.45;
  const maxDetections = options.maxDetections ?? 50;

  const { session, backend } = await createSession(spec.url, options.backend ?? 'auto');
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];

  const size = spec.inputSize;
  const format = FORMATS[spec.format];
  if (!format) {
    throw new Error(`Unknown model format "${spec.format}". Use one of: ${Object.keys(FORMATS).join(', ')}`);
  }
  const formatState = format.makeState(size);
  // Hoisted per-pixel constants: RGBA offsets in channel order, and a
  // multiplier instead of a per-pixel divide.
  const [c0, c1, c2] = format.channelOrder === 'BGR' ? [2, 1, 0] : [0, 1, 2];
  const pixelScale = 1 / format.pixelScale;

  // Scratch canvas + tensor buffer, reused across frames.
  const scratch = document.createElement('canvas');
  scratch.width = size;
  scratch.height = size;
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  const tensorData = new Float32Array(3 * size * size);

  function preprocess(source, srcWidth, srcHeight) {
    const box = letterboxParams(srcWidth, srcHeight, size, format.centerPad);
    sctx.fillStyle = PAD_FILL;
    sctx.fillRect(0, 0, size, size);
    sctx.drawImage(source, box.padX, box.padY, box.drawWidth, box.drawHeight);
    const { data } = sctx.getImageData(0, 0, size, size);
    const plane = size * size;
    for (let i = 0; i < plane; i++) {
      const p = i * 4;
      tensorData[i] = data[p + c0] * pixelScale;
      tensorData[plane + i] = data[p + c1] * pixelScale;
      tensorData[2 * plane + i] = data[p + c2] * pixelScale;
    }
    return box;
  }

  // The scratch canvas and tensor buffer are shared state - serialize
  // detect() calls so an app's one-off image detection can't interleave with
  // the camera loop's in-flight frame.
  let queue = Promise.resolve();

  async function runDetect(source) {
    const srcWidth = source.videoWidth ?? source.naturalWidth ?? source.width;
    const srcHeight = source.videoHeight ?? source.naturalHeight ?? source.height;
    if (!srcWidth || !srcHeight) return { detections: [], inferMs: 0, backend };

    const box = preprocess(source, srcWidth, srcHeight);
    const t0 = performance.now();
    const input = new ort.Tensor('float32', tensorData, [1, 3, size, size]);
    const result = await session.run({ [inputName]: input });
    const inferMs = performance.now() - t0;

    const out = result[outputName];
    const candidates = format.decode(out.data, out.dims, formatState, scoreThreshold);
    const kept = nms(candidates, { iouThreshold, maxDetections });
    const mapped = mapToSource(kept, { ...box, srcWidth, srcHeight });

    return {
      detections: mapped.map((d) => ({
        label: labels[d.classId] ?? `class ${d.classId}`,
        classId: d.classId,
        score: d.score,
        box: { x: d.x, y: d.y, width: d.width, height: d.height },
      })),
      inferMs,
      backend,
    };
  }

  return {
    /**
     * Detect objects in a drawable source (<video>, <img>, <canvas>, ImageBitmap).
     * @returns {Promise<{detections:Array<{label:string, classId:number,
     *   score:number, box:{x,y,width,height}}>, inferMs:number, backend:string}>}
     *   Boxes are in source pixel coordinates.
     */
    detect(source) {
      const next = queue.then(() => runDetect(source));
      // Keep the chain alive after a rejection so one failure doesn't wedge
      // every later call; the caller still sees the original error via `next`.
      queue = next.catch(() => {});
      return next;
    },
    /** Adjust the confidence cutoff live (no model reload). */
    setScoreThreshold(value) { scoreThreshold = value; },
    /** The resolved model spec ({ name, url, format, inputSize }). */
    model: spec,
    /** Which execution provider actually loaded: 'webgpu' or 'wasm'. */
    backend,
    labels,
    /** Free the session (GPU/WASM memory). */
    async close() { await session.release(); },
  };
}
