// App entry point.
//
// Wires the web-vision-detect kit to a fullscreen camera view: the kit runs
// the inference loop and draws the boxes; this file owns the UI - the start
// gate, the FPS readout, live per-class counts, the model switcher, the
// camera-flip button, and a still-photo mode (pick an image, see it boxed
// and counted, jump back to live).
//
// The kit lives at src/packages/web-vision-detect/ and is resolved by the
// import map in index.html. To extend this app, read its README there.

import { config } from './config.js';
import { mountDetect, drawDetections } from '@gipity/web-vision-detect';

const stage = document.getElementById('stage');
const cam = document.getElementById('cam');
const overlay = document.getElementById('overlay');
const photo = document.getElementById('photo');
const fpsEl = document.getElementById('fps');
const countsEl = document.getElementById('counts');
const modelBar = document.getElementById('models');
const pickBtn = document.getElementById('pick-photo');
const photoInput = document.getElementById('photo-input');
const backBtn = document.getElementById('back-live');
const flipBtn = document.getElementById('flip-camera');
const startGate = document.getElementById('start');
const startBtn = document.getElementById('start-btn');
const errorGate = document.getElementById('error');
const errorMsg = document.getElementById('error-msg');

// The live vision session, set once the camera starts.
let vision = null;

// Last-rendered HUD strings - frames usually repeat them, so skip the DOM
// write (and its repaint) when nothing changed.
let lastCounts = '';
let lastFps = '';

/** "2 × person, 1 × cup" - aggregate one frame's detections per label. */
function renderCounts(detections) {
  const counts = {};
  for (const det of detections) counts[det.label] = (counts[det.label] || 0) + 1;
  const text = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${n} × ${label}`)
    .join('   ') || 'nothing spotted';
  if (text !== lastCounts) {
    lastCounts = text;
    countsEl.textContent = text;
  }
}

function renderFps(fps) {
  const text = `${fps} FPS · ${vision?.currentBackend() ?? ''}`;
  if (text !== lastFps) {
    lastFps = text;
    fpsEl.textContent = text;
  }
}

/** Build the bottom model-switcher buttons from config.models. */
function buildModelBar() {
  for (const model of config.models) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = model.label;
    btn.dataset.key = model.key;
    btn.addEventListener('click', () => selectModel(model.key));
    modelBar.appendChild(btn);
  }
}

/** Mark one model button active. */
function highlightModel(key) {
  for (const btn of modelBar.children) {
    btn.classList.toggle('active', btn.dataset.key === key);
  }
}

/** Switch the running model. Disables the bar so a fast double-tap can't
 *  start two model loads at once (downloads can take a while). */
async function selectModel(key) {
  if (!vision || key === vision.currentModel().name) return;
  for (const btn of modelBar.children) btn.disabled = true;
  try {
    await vision.switchModel(key);
    highlightModel(key);
  } catch (err) {
    console.error('model switch failed:', err);
  } finally {
    for (const btn of modelBar.children) btn.disabled = false;
  }
}

/** Sync the CSS mirror class to the kit's current state. */
function applyMirror() {
  stage.classList.toggle('mirror', vision ? vision.currentMirror() : config.facingMode === 'user');
}

/** Flip between front and rear cameras. Debounced via disabled state. */
async function flipCamera() {
  if (!vision) return;
  flipBtn.disabled = true;
  try {
    await vision.flipCamera();
    applyMirror();
  } catch (err) {
    console.error('camera flip failed:', err);
  } finally {
    flipBtn.disabled = false;
  }
}

/** Photo mode: pause live, detect the picked image, draw it boxed. */
async function detectPhoto(file) {
  if (!vision || !file) return;
  vision.pause();
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => { URL.revokeObjectURL(el.src); resolve(el); };
      el.onerror = reject;
      el.src = URL.createObjectURL(file);
    });
    const result = await vision.detect(img);

    photo.width = img.naturalWidth;
    photo.height = img.naturalHeight;
    const ctx = photo.getContext('2d');
    ctx.drawImage(img, 0, 0);
    drawDetections(ctx, result);

    photo.hidden = false;
    backBtn.hidden = false;
    fpsEl.hidden = true;
    modelBar.hidden = true;
    renderCounts(result.detections);
  } catch (err) {
    console.error('photo detection failed:', err);
    backToLive();
  }
}

/** Leave photo mode and resume the live loop. */
function backToLive() {
  photo.hidden = true;
  backBtn.hidden = true;
  fpsEl.hidden = false;
  modelBar.hidden = false;
  photoInput.value = '';
  vision?.resume();
}

/** Start the camera and the vision loop. Triggered by the user gesture. */
async function start() {
  startBtn.disabled = true;
  startBtn.textContent = 'Starting...';
  try {
    vision = await mountDetect({
      video: cam,
      canvas: overlay,
      model: config.defaultModel,
      scoreThreshold: config.scoreThreshold,
      camera: { facingMode: config.facingMode },
      onFps: renderFps,
      onResult: ({ detections }) => renderCounts(detections),
    });
    startGate.hidden = true;
    fpsEl.hidden = false;
    countsEl.hidden = false;
    modelBar.hidden = false;
    pickBtn.hidden = false;
    highlightModel(config.defaultModel);
    applyMirror();
    // Permission has been granted, so enumerateDevices now returns real
    // entries - decide whether to show the flip control.
    if (await vision.hasMultipleCameras()) flipBtn.hidden = false;
  } catch (err) {
    console.error('camera start failed:', err);
    errorMsg.textContent = err?.message || String(err);
    startGate.hidden = true;
    errorGate.hidden = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.title = config.title;
  applyMirror();
  buildModelBar();
  startBtn.addEventListener('click', start);
  flipBtn.addEventListener('click', flipCamera);
  pickBtn.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', () => detectPhoto(photoInput.files?.[0]));
  backBtn.addEventListener('click', backToLive);
});
