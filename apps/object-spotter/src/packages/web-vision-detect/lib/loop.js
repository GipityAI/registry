/**
 * Async detection loop + FPS meter.
 *
 * `createFps` is a pure rolling-average frame-rate counter (no DOM - it is
 * unit-tested in tests/loop.test.js). `createLoop` drives a requestAnimation-
 * Frame loop around an *async* detect call: ONNX Runtime inference returns a
 * promise, so the loop never starts a new inference while one is in flight -
 * camera frames that arrive mid-inference are simply skipped. FPS therefore
 * measures completed inferences, the number that matters.
 */

/**
 * Rolling-average FPS counter over the last `window` frame intervals.
 * @param {number} [window] Samples to average (default 30).
 */
export function createFps(window = 30) {
  const intervals = [];
  let last = 0;

  return {
    /** Call once per completed frame. */
    tick() {
      const now = performance.now();
      if (last) {
        intervals.push(now - last);
        if (intervals.length > window) intervals.shift();
      }
      last = now;
    },
    /** Current FPS, rounded. 0 until at least two ticks have landed. */
    value() {
      if (!intervals.length) return 0;
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      return avg > 0 ? Math.round(1000 / avg) : 0;
    },
    /** Forget all samples - call after a stall (e.g. tab was backgrounded). */
    reset() {
      intervals.length = 0;
      last = 0;
    },
  };
}

/**
 * Drive a per-frame async detection loop.
 * @param {Object} config
 * @param {HTMLVideoElement} config.video
 * @param {Function} config.detect   `async (video) => result`. Pass a stable
 *   closure (e.g. `(v) => detector.detect(v)`) so the detector can be swapped
 *   without rebuilding the loop.
 * @param {Function} config.onFrame  `(result, fps) => void` per completed inference.
 * @param {Function} [config.onError] Called if detect rejects; default logs
 *   and stops the loop (a broken model would otherwise error every frame).
 * @returns {{start:Function, stop:Function, fps:Function}}
 */
export function createLoop({ video, detect, onFrame, onError }) {
  const fps = createFps();
  let running = false;
  let busy = false;
  let rafId = 0;
  let lastFrameTime = -1;

  function tick() {
    if (!running) return;
    // Run inference only when the video has actually advanced and the
    // previous inference has finished - rAF fires faster than both.
    if (!busy && video.currentTime !== lastFrameTime && video.videoWidth > 0) {
      lastFrameTime = video.currentTime;
      busy = true;
      detect(video).then(
        (result) => {
          busy = false;
          if (!running) return;
          fps.tick();
          onFrame(result, fps.value());
        },
        (err) => {
          busy = false;
          if (onError) onError(err);
          else {
            console.error('web-vision-detect loop: detect failed, stopping.', err);
            running = false;
          }
        },
      );
    }
    rafId = requestAnimationFrame(tick);
  }

  return {
    start() {
      if (running) return;
      running = true;
      fps.reset();
      lastFrameTime = -1;
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
    fps: () => fps.value(),
  };
}
