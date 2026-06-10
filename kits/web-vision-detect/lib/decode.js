/**
 * Pure detection-output decoding - no DOM, no ONNX Runtime. Everything here
 * is plain math over Float32Arrays, so it is unit-tested in Node against a
 * golden fixture captured from the real model (tests/decode.test.js).
 *
 * Two output layouts are supported:
 *
 * - 'yolox' (the default presets): the official Megvii ONNX exports are
 *   *undecoded* - shape [1, N, 5+C], anchor-major, where xy are cell offsets
 *   and wh are log-scale, relative to a virtual anchor grid over strides
 *   8/16/32. `decodeYolox` applies the grid (built once by `makeGrids`).
 *
 * - 'yolo' (Ultralytics YOLOv8/v11 `model.export(format='onnx')`): shape
 *   [1, 4+C, N], channel-major, boxes already decoded to input pixels,
 *   no objectness column.
 *
 * Both decoders return candidates `{x1, y1, x2, y2, score, classId}` in
 * model-input pixel space; run them through `nms` (lib/nms.js), then
 * `mapToSource` to land in source-image pixels.
 */

/**
 * Build the YOLOX anchor grid for a square input.
 * Anchor order matches the model output: stride 8 block first, then 16,
 * then 32; row-major (y outer, x inner) within each block.
 * @returns {{gx:Float32Array, gy:Float32Array, stride:Float32Array, count:number}}
 */
export function makeGrids(inputSize, strides = [8, 16, 32]) {
  let count = 0;
  for (const s of strides) count += (inputSize / s) ** 2;
  const gx = new Float32Array(count);
  const gy = new Float32Array(count);
  const stride = new Float32Array(count);
  let i = 0;
  for (const s of strides) {
    const cells = inputSize / s;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++, i++) {
        gx[i] = x;
        gy[i] = y;
        stride[i] = s;
      }
    }
  }
  return { gx, gy, stride, count };
}

/**
 * Decode a raw YOLOX output tensor.
 * @param {Float32Array} output  Flat [N, 5+C] tensor data.
 * @param {{gx,gy,stride,count}} grids  From `makeGrids` (count must equal N).
 * @param {Object} opts
 * @param {number} opts.numClasses
 * @param {number} opts.scoreThreshold  Keep score = objectness * class >= this.
 * @returns {Array<{x1:number,y1:number,x2:number,y2:number,score:number,classId:number}>}
 */
export function decodeYolox(output, grids, { numClasses, scoreThreshold }) {
  const { gx, gy, stride, count } = grids;
  const cols = 5 + numClasses;
  if (output.length !== count * cols) {
    throw new Error(`YOLOX output size ${output.length} != anchors ${count} x ${cols} - wrong inputSize or class count for this model.`);
  }
  const candidates = [];
  for (let i = 0; i < count; i++) {
    const off = i * cols;
    const obj = output[off + 4];
    // score = obj * cls <= obj, so anchors below threshold on objectness
    // alone can never pass - skip before the 80-class argmax.
    if (obj < scoreThreshold) continue;
    let best = 0;
    let bestId = 0;
    for (let c = 0; c < numClasses; c++) {
      const v = output[off + 5 + c];
      if (v > best) { best = v; bestId = c; }
    }
    const score = obj * best;
    if (score < scoreThreshold) continue;
    const s = stride[i];
    const cx = (output[off] + gx[i]) * s;
    const cy = (output[off + 1] + gy[i]) * s;
    const w = Math.exp(output[off + 2]) * s;
    const h = Math.exp(output[off + 3]) * s;
    candidates.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score, classId: bestId });
  }
  return candidates;
}

/**
 * Decode an Ultralytics YOLO (v8/v11) output tensor.
 * @param {Float32Array} output  Flat [4+C, N] tensor data (channel-major).
 * @param {Object} opts
 * @param {number} opts.numAnchors   N (e.g. 8400 for 640x640).
 * @param {number} opts.numClasses   C.
 * @param {number} opts.scoreThreshold
 */
export function decodeYolo(output, { numAnchors, numClasses, scoreThreshold }) {
  if (output.length !== (4 + numClasses) * numAnchors) {
    throw new Error(`YOLO output size ${output.length} != ${4 + numClasses} x ${numAnchors}.`);
  }
  const candidates = [];
  for (let i = 0; i < numAnchors; i++) {
    let best = 0;
    let bestId = 0;
    for (let c = 0; c < numClasses; c++) {
      const v = output[(4 + c) * numAnchors + i];
      if (v > best) { best = v; bestId = c; }
    }
    if (best < scoreThreshold) continue;
    const cx = output[i];
    const cy = output[numAnchors + i];
    const w = output[2 * numAnchors + i];
    const h = output[3 * numAnchors + i];
    candidates.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score: best, classId: bestId });
  }
  return candidates;
}

/**
 * Letterbox geometry for fitting a source frame into a square model input
 * while preserving aspect ratio.
 * @param {boolean} center  YOLOX pads bottom-right (false); Ultralytics
 *                          centers the image (true).
 * @returns {{ratio:number, drawWidth:number, drawHeight:number, padX:number, padY:number}}
 */
export function letterboxParams(srcWidth, srcHeight, inputSize, center = false) {
  const ratio = Math.min(inputSize / srcWidth, inputSize / srcHeight);
  const drawWidth = Math.round(srcWidth * ratio);
  const drawHeight = Math.round(srcHeight * ratio);
  const padX = center ? Math.floor((inputSize - drawWidth) / 2) : 0;
  const padY = center ? Math.floor((inputSize - drawHeight) / 2) : 0;
  return { ratio, drawWidth, drawHeight, padX, padY };
}

/**
 * Map post-NMS boxes from model-input pixels back to source-image pixels,
 * clamped to the frame.
 * @returns {Array<{x:number,y:number,width:number,height:number,score:number,classId:number}>}
 */
export function mapToSource(dets, { ratio, padX, padY, srcWidth, srcHeight }) {
  return dets.map((d) => {
    const x1 = Math.min(Math.max((d.x1 - padX) / ratio, 0), srcWidth);
    const y1 = Math.min(Math.max((d.y1 - padY) / ratio, 0), srcHeight);
    const x2 = Math.min(Math.max((d.x2 - padX) / ratio, 0), srcWidth);
    const y2 = Math.min(Math.max((d.y2 - padY) / ratio, 0), srcHeight);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1, score: d.score, classId: d.classId };
  });
}
