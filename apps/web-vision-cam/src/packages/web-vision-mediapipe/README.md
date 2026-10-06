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
| `gesture` | Gesture Recognizer     | 21 hand landmarks per hand + a recognised gesture (`Closed_Fist`, `Open_Palm`, `Victory`, `Thumb_Up`, `Thumb_Down`, `Pointing_Up`, `ILoveYou`; anything else is `None`) |
| `detect`  | EfficientDet-Lite      | Bounding boxes for the 80 COCO classes (person, cup, laptop, ...) |
| `pose`    | Pose Landmarker        | 33 body landmarks per person |

## Gestures

Don't read `result.gestures` yourself — the model re-classifies ~30×/second and a moving hand passes through several labels, so acting on the raw frame label fires on noise. The kit settles that for you, and hands it back two ways. Pick by **who decides when something happens**:

```js
const vision = await mountVision({
  video, canvas, kind: 'gesture',
  gestureHold: { holdMs: 600 },           // how long a pose must be steady (default 500)

  // PUSH - the HAND decides. Fires once per deliberate gesture, after the pose
  // has been held steady, and not again until the hand changes.
  onGesture: (name) => like(name),        // 'Closed_Fist' | 'Open_Palm' | 'Victory' | ...
});

// PULL - YOUR APP decides. What is the hand holding right now (null if it's
// empty, moving, or mid-change)? This is the one you want for anything on a
// clock: a round, a countdown, a shutter.
await countdown('3... 2... 1... shoot!');
const thrown = vision.gesture();
```

**A round-based game wants `gesture()`, not a cached `onGesture`.** Stashing the last pushed event in a variable looks equivalent and isn't — `onGesture` deliberately won't fire again while the hand is unchanged, so a player who throws rock two rounds running would have round two scored off round one's stale event.

`GESTURES` exports the label list. For rock paper scissors: rock = `Closed_Fist`, paper = `Open_Palm`, scissors = `Victory` — see `examples/gesture.js` for a full round. `vision.resetGesture()` drops an in-progress hold. If you need the raw stream anyway, `onResult(result, kind)` hands you the native MediaPipe result each frame, and `gestureName(result)` pulls the current label out of it.

Gesture is the kit's strongest task. Detection uses EfficientDet-Lite — fast, but lower accuracy than a dedicated detector; treat it as "good enough for a demo", not production-grade. When detection itself is the product (counting, labeling, custom classes), use the `@gipity/web-vision-detect` kit instead.

## API

**`mountVision({ video, canvas, kind?, taskOptions?, camera?, onFps?, onResult?, onReady?, onGesture?, gestureHold? })`** → `{ switchTask, currentTask, gesture, latest, resetGesture, flipCamera, stop, video, canvas }`

The high-level path. `camera` is `{ facingMode, width, height }`; `taskOptions` is forwarded to `createTask`.

**Startup and readiness.** Importing the kit starts the WASM download immediately, and `mountVision` downloads the model *while* the camera permission prompt is up — so call it on page load rather than behind a click. It publishes its state on `<html>` as `data-vision="loading|ready|error|stopped"` (mirrored on `window.__visionReady`), and the mounted instance on `window.__vision`. `ready` means the first inference frame has been drawn.

## Verifying it headlessly

A headless browser has no webcam, so a plain page load lands the app on `data-vision="error"`: that is the app behaving, not a bug. Hand the browser a picture as its camera, and read back what the model made of it:

```
gipity page eval <url> --camera palm.png --wait-for '[data-vision="ready"]' --wait-timeout 25000 \
  "(async()=>{ const v = window.__vision; const end = Date.now() + 3000; while (!v.gesture() && Date.now() < end) await new Promise(r => setTimeout(r, 100)); return { held: v.gesture(), hands: v.latest().gestures.length }; })()"
                                                 # -> {"held":"Open_Palm","hands":1}
gipity page screenshot <url> --camera palm.png   # see the app react to that frame
```

`gesture()` needs the pose held for 500ms, so it is still `null` on the first frame; the loop polls for it. `latest()` is the newest frame's raw result, which separates the two kinds of `null`: `hands: 0` means the model found no hand in the picture (the picture is at fault, not the app or the wait); `hands: 1` with `held: null` means a hand but no pose it knows.

`--camera <path>` plays a local image (or video) as the browser's webcam. `--fake-media` alone gives a camera but only a test pattern: enough to prove the app starts, never enough to prove it *sees*.

**The picture has to look like what a webcam sees.** The hand model looks for a hand on a person at webcam distance. A studio close-up of a hand filling the frame on a plain background reads as zero hands, silently, whether it is a real photo or a generated one. Use a person with their upper body in frame and one hand raised beside the shoulder, palm toward the camera. `gipity generate image` makes usable fixtures when asked for exactly that:

```
gipity generate image "candid smartphone photo of a person standing in a living room raising one open hand next to their shoulder, palm facing the camera, five fingers spread, upper body visible, natural daylight, realistic" -o tmp/palm.png
```

"making a peace sign, palm facing the camera" reads `Victory` and "giving a thumbs up" reads `Thumb_Up` the same way. `Closed_Fist` is the exception: generated fists usually come back as a hand with no gesture, so use a real photo for a fist.

To check a model against a picture with no camera and no app in the way, `vision.detectFrom(source)` (or the standalone `detectImage(kind, source)`) runs the same model on a still image — a URL, an app path, or an `<img>`/`<canvas>` — and returns the same result shape:

```js
gestureName(await vision.detectFrom('/fixtures/rock.png'));   // 'Closed_Fist'
```

**Low-level building blocks** — compose your own loop:

- `gestureName(result, { hand?, minScore? })` / `createGestureGate({ holdMs?, minScore?, hand? })` / `GESTURES`
- `createTask(kind, options?)` → `{ kind, detect(video, ts?), raw, close() }`
- `detectImage(kind, source, options?)` — run a task on a still image instead of a camera
- `prewarm(kind, options?)` — start a model's download early; the later `createTask` is instant
- `startCamera(video, { facingMode?, width?, height? })` → `{ stream, stop() }`
- `createLoop({ video, detect, onFrame })` → `{ start, stop, fps }`
- `createFps(window?)` → `{ tick, value, reset }`
- `draw(ctx, kind, result)` / `drawGestures` / `drawDetections` / `drawPose`
- `fitCanvas(canvas, video)`, `clearCanvas(ctx)`
- `MODELS`, `WASM_BASE`, `MEDIAPIPE_VERSION`, `TASK_KINDS`

See `examples/` — `gesture.js` (high-level), `detect.js` (low-level loop), `pose.js` (task switching).

## Notes

- The `<canvas>` must overlay the `<video>` at the same on-screen size; the kit sizes the canvas backing store to the camera frame.
- Each task's model (~3–8 MB) is fetched from Google's CDN on first use, then browser-cached. `prewarm(kind)` pulls that cost forward off the critical path. Swap any URL in `lib/models.js` for your own hosted model.
- `delegate: 'CPU'` in `taskOptions` forces CPU inference if a device's WebGL is flaky.
- **License:** MediaPipe and the default models are Apache-2.0 — free for commercial use, no copyleft obligation on your app.

## Versioning

The MediaPipe JS, WASM runtime, and WASM URL must all agree on one version. To upgrade: bump `MEDIAPIPE_VERSION` in `lib/models.js` **and** the two `@mediapipe/tasks-vision@...` URLs in `package.json`.
