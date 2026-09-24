/**
 * Pinned ONNX Runtime Web version + model catalog.
 *
 * One place to bump everything: the `onnxruntime-web` JS import (wired in the
 * app's import map by `gipity add`) and the WASM binary directory must agree
 * on ORT_VERSION - a mismatch fails to load. To upgrade, change ORT_VERSION
 * here AND the two `onnxruntime-web@...` URLs in package.json.
 *
 * Default models are YOLOX (Megvii, Apache-2.0), hosted on the Gipity CDN.
 * They are NOT bundled with the kit - fetched on first use, then
 * browser-cached. All three detect the same 80 COCO classes; they trade
 * accuracy for download size and frame rate.
 */

export const ORT_VERSION = '1.27.0';

/** Directory the ONNX Runtime WASM binaries are loaded from (ort.env.wasm.wasmPaths). */
export const ORT_WASM_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

const MODEL_HOST = 'https://media.gipity.ai/models/yolox/0.1.1rc0';

/**
 * Built-in model presets. Pass a preset name as `model`, or a spec object
 * `{ url, format, inputSize, labels }` for a custom model (e.g. one you
 * trained and exported yourself - see README "Custom models").
 *
 * mAP is COCO val accuracy - higher finds more objects, more reliably.
 */
export const PRESETS = {
  /** Fastest, smallest download (3.7 MB) - the default. mAP 25.8. */
  nano: { url: `${MODEL_HOST}/yolox_nano.onnx`, format: 'yolox', inputSize: 416 },
  /** Balanced (20 MB download). Noticeably better accuracy. mAP 32.8. */
  tiny: { url: `${MODEL_HOST}/yolox_tiny.onnx`, format: 'yolox', inputSize: 416 },
  /** Most accurate (36 MB download), lower frame rate. mAP 40.5. */
  s: { url: `${MODEL_HOST}/yolox_s.onnx`, format: 'yolox', inputSize: 640 },
};

/** Preset names, in fastest -> most-accurate order. */
export const PRESET_NAMES = Object.keys(PRESETS);

/**
 * Resolve `model` (preset name or spec object) to a full model spec.
 * @returns {{url:string, format:'yolox'|'yolo', inputSize:number, labels?:string[]}}
 */
export function resolveModel(model = 'nano') {
  if (typeof model === 'string') {
    const preset = PRESETS[model];
    if (!preset) {
      throw new Error(`Unknown model preset "${model}". Use one of: ${PRESET_NAMES.join(', ')} - or pass { url, format, inputSize }.`);
    }
    return { ...preset, name: model };
  }
  if (!model?.url) throw new Error('Custom model spec needs at least { url }.');
  return { format: 'yolox', inputSize: 416, name: 'custom', ...model };
}
