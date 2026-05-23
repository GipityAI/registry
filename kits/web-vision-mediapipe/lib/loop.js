/**
 * Detection loop + FPS meter.
 *
 * `createFps` is a pure rolling-average frame-rate counter (no DOM - it is
 * unit-tested in tests/loop.test.js). `createLoop` drives a requestAnimation-
 * Frame loop that runs inference once per *new* video frame and reports the
 * result plus the live FPS.
 */

/**
 * Rolling-average FPS counter over the last `window` frame intervals.
 * @param {number} [window] Samples to average (default 30).
 */
export function createFps(window = 30) {
  const intervals = [];
  let last = 0;

  return {
    /** Call once per rendered frame. */
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
 * Drive a per-frame detection loop.
 * @param {Object} config
 * @param {HTMLVideoElement} config.video
 * @param {Function} config.detect   `(video, timestampMs) => result`. Pass a
 *   stable closure (e.g. `(v, ts) => task.detect(v, ts)`) so the task can be
 *   swapped without rebuilding the loop.
 * @param {Function} config.onFrame  `(result, fps) => void` per new frame.
 * @returns {{start:Function, stop:Function, fps:Function}}
 */
export function createLoop({ video, detect, onFrame }) {
  const fps = createFps();
  let running = false;
  let rafId = 0;
  let lastFrameTime = -1;

  function tick() {
    if (!running) return;
    // The camera produces frames slower than rAF fires - only run inference
    // when the video has actually advanced, else MediaPipe sees a repeat
    // timestamp and the FPS reading is inflated.
    if (video.currentTime !== lastFrameTime && video.videoWidth > 0) {
      lastFrameTime = video.currentTime;
      const result = detect(video, performance.now());
      fps.tick();
      onFrame(result, fps.value());
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
