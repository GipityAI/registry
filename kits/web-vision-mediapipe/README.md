# @gipity/web-vision-mediapipe

A **browser vision kit** for Gipity apps. Wraps Google [MediaPipe Tasks](https://ai.google.dev/edge/mediapipe) — gesture recognition, body pose, object detection — behind one camera + render-loop API.

Runs **fully client-side**: no server, no upload, the camera stream never leaves the device. Inference is WASM + WebGL-accelerated.

**Web only.** Needs `getUserMedia`, WASM, and a canvas — so HTTPS or `localhost`. For native iOS/Android, a separate kit would wrap the MediaPipe mobile SDKs.

```
web-vision-mediapipe/
  index.js        mountVision() + low-level exports
  lib/            tasks, camera, loop, draw, models
  examples/       one worked file per task
  tests/          Node-runnable (gipity sandbox run)
```

## Quick start

One call wires the camera, the inference loop, and the canvas overlay:

```js
import { mountVision } from '@gipity/web-vision-mediapipe';

const vision = await mountVision({
  video:  document.querySelector('video'),
  canvas: document.querySelector('canvas'),   // overlay, on top of the video
  kind:   'gesture',
  onFps:  (fps) => { hud.textContent = `${fps} FPS`; },
});

await vision.switchTask('pose');   // swap models, camera keeps running
vision.stop();                     // release camera + free GPU memory
```

## Tasks

`kind` is one of:

| `kind`    | Model                  | Result per frame |
|-----------|------------------------|------------------|
| `gesture` | Gesture Recognizer     | 21 hand landmarks per hand + a recognised gesture (Thumb_Up, Open_Palm, Victory, Closed_Fist, Pointing_Up, ILoveYou, Thumb_Down) |
| `detect`  | EfficientDet-Lite      | Bounding boxes for the 80 COCO classes (person, cup, laptop, ...) |
| `pose`    | Pose Landmarker        | 33 body landmarks per person |

Gesture is the kit's strongest task. Detection uses EfficientDet-Lite — fast, but lower accuracy than a dedicated detector; treat it as "good enough for a demo", not production-grade. When detection itself is the product (counting, labeling, custom classes), use the `@gipity/web-vision-detect` kit instead.

## API

**`mountVision({ video, canvas, kind?, taskOptions?, camera?, onFps?, onResult? })`** → `{ switchTask, currentTask, stop, video, canvas }`

The high-level path. `camera` is `{ facingMode, width, height }`; `taskOptions` is forwarded to `createTask`.

**Low-level building blocks** — compose your own loop:

- `createTask(kind, options?)` → `{ kind, detect(video, ts?), raw, close() }`
- `startCamera(video, { facingMode?, width?, height? })` → `{ stream, stop() }`
- `createLoop({ video, detect, onFrame })` → `{ start, stop, fps }`
- `createFps(window?)` → `{ tick, value, reset }`
- `draw(ctx, kind, result)` / `drawGestures` / `drawDetections` / `drawPose`
- `fitCanvas(canvas, video)`, `clearCanvas(ctx)`
- `MODELS`, `WASM_BASE`, `MEDIAPIPE_VERSION`, `TASK_KINDS`

See `examples/` — `gesture.js` (high-level), `detect.js` (low-level loop), `pose.js` (task switching).

## Notes

- The `<canvas>` must overlay the `<video>` at the same on-screen size; the kit sizes the canvas backing store to the camera frame.
- First use of a task downloads its model (~3–8 MB) from Google's CDN, then the browser caches it. Swap any URL in `lib/models.js` for your own hosted model.
- `delegate: 'CPU'` in `taskOptions` forces CPU inference if a device's WebGL is flaky.
- **License:** MediaPipe and the default models are Apache-2.0 — free for commercial use, no copyleft obligation on your app.

## Versioning

The MediaPipe JS, WASM runtime, and WASM URL must all agree on one version. To upgrade: bump `MEDIAPIPE_VERSION` in `lib/models.js` **and** the two `@mediapipe/tasks-vision@...` URLs in `package.json`.
