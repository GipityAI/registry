/**
 * Keeps MediaPipe's usage metrics on the device.
 *
 * Google's published @mediapipe/tasks-vision 1.x builds report performance
 * and usage metrics (task name, running mode, platform, latencies) to
 * odml.pa.googleapis.com every minute and when a task closes. Camera frames
 * are never sent, but this kit promises nothing leaves the device, and the
 * library has no option to turn the reporting off (the open-source build
 * swaps in a no-op logger; the npm build does not).
 *
 * So the kit answers those requests itself: any fetch to the metrics host
 * gets an empty 204 without touching the network. MediaPipe treats the
 * non-200 as a failed send and stops its reporting timer for that task.
 * Every other request passes through untouched.
 */

export const TELEMETRY_HOST = 'odml.pa.googleapis.com';

const GUARD = Symbol.for('gipity.web-vision-mediapipe.no-telemetry');

function requestHost(input) {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  try {
    return new URL(url, 'http://localhost').hostname;
  } catch {
    return '';
  }
}

/**
 * Wrap `target.fetch` so MediaPipe's metrics requests never leave the device.
 * Idempotent: a second call on the same target is a no-op.
 * @param {{fetch: Function}} [target=globalThis]
 */
export function blockMediaPipeTelemetry(target = globalThis) {
  const original = target.fetch;
  if (typeof original !== 'function' || original[GUARD]) return;
  const guarded = function fetch(input, init) {
    if (requestHost(input) === TELEMETRY_HOST) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return original.call(this, input, init);
  };
  guarded[GUARD] = true;
  target.fetch = guarded;
}
