/**
 * Webcam helper - getUserMedia into a <video> element, ready to detect on.
 *
 * Resolves only once the video has real frame dimensions, so callers can
 * size a canvas from `video.videoWidth/Height` immediately afterwards.
 */

/**
 * Start the camera into `video`.
 * @param {HTMLVideoElement} video
 * @param {Object} [options]
 * @param {'user'|'environment'} [options.facingMode]  Front ('user') or rear camera.
 * @param {number} [options.width]   Ideal capture width (default 1280).
 * @param {number} [options.height]  Ideal capture height (default 720).
 * @returns {Promise<{stream:MediaStream, stop:Function}>}
 */
export async function startCamera(video, options = {}) {
  const { facingMode = 'user', width = 1280, height = 720 } = options;

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera not available - this browser has no getUserMedia (needs HTTPS or localhost).');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode, width: { ideal: width }, height: { ideal: height } },
    audio: false,
  });

  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;
  await video.play();

  // play() can resolve before the first frame has dimensions.
  if (video.readyState < 2 || !video.videoWidth) {
    await new Promise((resolve) => {
      video.addEventListener('loadeddata', resolve, { once: true });
    });
  }

  return {
    stream,
    stop() {
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
}

/**
 * True iff there's a *different* camera to switch to from the given active
 * track - i.e. flipping facingMode would actually produce a different
 * physical camera, not just toggle the mirror on the same lens. Call this
 * *after* `startCamera` so labels are populated.
 *
 * Two signals are checked, in order:
 * 1. The active track's `getCapabilities().facingMode` lists both modes.
 * 2. enumerateDevices() reports another videoinput whose label hints at the
 *    opposite facing direction.
 *
 * A bare videoinput count is not enough on desktop, where virtual cameras
 * (OBS, Teams, Snap) inflate the count without actually adding a rear lens.
 *
 * @param {MediaStreamTrack} track
 * @returns {Promise<boolean>}
 */
export async function canSwitchFacing(track) {
  if (!navigator.mediaDevices?.enumerateDevices) return false;

  const cap = track?.getCapabilities?.();
  if (Array.isArray(cap?.facingMode) && cap.facingMode.length >= 2) return true;

  let devices = [];
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch { return false; }
  const videoinputs = devices.filter((d) => d.kind === 'videoinput');
  if (videoinputs.length < 2) return false;

  const settings = track?.getSettings?.() || {};
  const currentFacing = cap?.facingMode?.[0] || settings.facingMode;
  const looksRear = (label) => /\b(back|rear|environment)\b/i.test(label);
  const looksFront = (label) => /\b(front|user|self|face)\b/i.test(label);
  if (currentFacing === 'user') return videoinputs.some((d) => looksRear(d.label));
  if (currentFacing === 'environment') return videoinputs.some((d) => looksFront(d.label));
  return false;
}
