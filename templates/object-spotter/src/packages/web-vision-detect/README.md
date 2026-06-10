# @gipity/web-vision-detect

A **browser object-detection kit** for Gipity apps. Runs [YOLOX](https://github.com/Megvii-BaseDetection/YOLOX) (Apache-2.0) on [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) — WebGPU-accelerated where the browser has it, WASM (SIMD) fallback everywhere else — behind one camera + render-loop API. Detects the 80 COCO classes out of the box, or loads your own custom-trained model.

Runs **fully client-side**: no server, no upload, the camera stream never leaves the device.

**Web only.** Needs `getUserMedia`, WASM, and a canvas — so HTTPS or `localhost`.

This kit is the high-accuracy sibling of `web-vision-mediapipe` — use that one for gesture and pose; use this one when the detection itself is the product (counting, labeling, custom classes).

```
web-vision-detect/
  index.js        mountDetect() + low-level exports
  lib/            detector, decode, nms, camera, loop, draw, models, labels
  examples/       camera loop, still image, custom model
  tests/          Node-runnable (gipity sandbox run) - decode is golden-tested
                  against the official YOLOX reference output
```

## Quick start

One call wires the camera, the inference loop, and the canvas overlay:

```js
import { mountDetect } from '@gipity/web-vision-detect';

const vision = await mountDetect({
  video:  document.querySelector('video'),
  canvas: document.querySelector('canvas'),   // overlay, on top of the video
  model:  'nano',                             // 'nano' | 'tiny' | 's'
  onFps:  (fps) => { hud.textContent = `${fps} FPS`; },
  onResult: ({ detections }) => { /* app logic: labels, scores, boxes */ },
});

await vision.switchModel('s');     // trade frame rate for accuracy
const r = await vision.detect(img); // one-off detection on an <img>/canvas
vision.stop();                      // release camera + free model memory
```

Each detection is `{ label, classId, score, box: { x, y, width, height } }` in source-frame pixels.

## Models

`model` is a preset name or a custom spec. The presets are official YOLOX exports (Apache-2.0), hosted on the Gipity CDN, fetched on first use and then browser-cached:

| Preset | Download | Input | COCO mAP | Use when |
|--------|----------|-------|----------|----------|
| `nano` (default) | 3.7 MB | 416² | 25.8 | Instant start, phones, casual demos |
| `tiny` | 20 MB | 416² | 32.8 | Noticeably better accuracy, still fast |
| `s` | 36 MB | 640² | 40.5 | Accuracy is the point; fine on WebGPU |

All three detect the same 80 COCO classes (person, car, dog, cup, laptop, ...) — `COCO_LABELS` exports the full list.

## Custom models

Train anywhere (Roboflow, Ultralytics, YOLOX), export to ONNX, host the file on any CORS-enabled URL (your app's own files work), and pass a spec:

```js
model: {
  url: './models/my-detector.onnx',
  format: 'yolo',                    // 'yolox' | 'yolo' (Ultralytics v8/v11 export)
  inputSize: 640,                    // the imgsz you exported with
  labels: ['helmet', 'no-helmet'],   // your classes, in training order
}
```

- `format: 'yolox'` — official YOLOX `export_onnx.py` output (undecoded head `[1, N, 5+C]`).
- `format: 'yolo'` — Ultralytics `model.export(format='onnx')` output (`[1, 4+C, N]`).

**License note:** YOLOX and the bundled presets are Apache-2.0; ONNX Runtime is MIT — free for commercial use, no copyleft obligation on your app. Ultralytics YOLO models are **AGPL-3.0**: the kit supports loading them, but that license is between you and Ultralytics.

## API

**`mountDetect({ video, canvas, model?, backend?, scoreThreshold?, iouThreshold?, maxDetections?, camera?, mirror?, showScore?, onFps?, onResult? })`** → `{ switchModel, detect, pause, resume, setScoreThreshold, setCamera, flipCamera, hasMultipleCameras, currentModel, currentBackend, stop, video, canvas }`

The high-level path. `camera` is `{ facingMode, width, height }` — default facing is `'environment'` (rear), the natural choice for pointing at objects. `backend` is `'auto'` (WebGPU with WASM fallback), `'webgpu'`, or `'wasm'`.

**Low-level building blocks** — compose your own loop:

- `createDetector({ model?, backend?, scoreThreshold?, iouThreshold?, maxDetections? })` → `{ detect(source), setScoreThreshold, model, backend, labels, close() }`
- `startCamera(video, { facingMode?, width?, height? })` → `{ stream, stop() }`
- `createLoop({ video, detect, onFrame, onError? })` → `{ start, stop, fps }` — async-aware: never overlaps inferences, skips frames instead
- `createFps(window?)` → `{ tick, value, reset }`
- `drawDetections(ctx, result, { accent?, mirror?, showScore? })`, `fitCanvas(canvas, video)`, `clearCanvas(ctx)`
- Pure math (Node-testable): `makeGrids`, `decodeYolox`, `decodeYolo`, `letterboxParams`, `mapToSource`, `nms`
- Constants: `PRESETS`, `PRESET_NAMES`, `COCO_LABELS`, `ORT_VERSION`, `ORT_WASM_BASE`

See `examples/` — `detect-camera.js` (low-level loop), `detect-image.js` (still image + counts), `custom-model.js`.

## Notes

- The `<canvas>` must overlay the `<video>` at the same on-screen size; the kit sizes the canvas backing store to the camera frame. CSS `object-fit: cover` on *both* keeps them aligned.
- First use downloads the ONNX Runtime WASM/WebGPU binaries (~13–26 MB, shared across all models) plus the model, then the browser caches everything. Expect a pause on the very first frame.
- Frame rate depends heavily on the backend: WebGPU runs `nano` at camera speed on most laptops and recent phones; plain WASM is several× slower — if a device crawls, stay on `nano` or lower the camera resolution.
- Inference is async — use the kit's `createLoop`, which skips camera frames while one is in flight, rather than calling `detect` per rAF tick.

## Versioning

The `onnxruntime-web` JS import and its WASM binaries must agree on one version. To upgrade: bump `ORT_VERSION` in `lib/models.js` **and** the two `onnxruntime-web@...` URLs in `package.json`.

Default model files are pinned at `https://media.gipity.ai/models/yolox/0.1.1rc0/` (the upstream YOLOX release tag). New model versions go in a new directory; never overwrite a published one.
