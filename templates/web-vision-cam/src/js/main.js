// App entry point.
//
// Wires the web-vision-mediapipe kit to a fullscreen camera view: the kit
// runs the inference loop and draws the overlay; this file owns the UI -
// the start gate, the FPS readout, the task switcher, and the camera-flip
// button.
//
// The kit lives at src/packages/web-vision-mediapipe/ and is resolved by the
// import map in index.html. To extend this app, read its README there.

import { config } from './config.js';
import { mountVision } from '@gipity/web-vision-mediapipe';

const stage = document.getElementById('stage');
const cam = document.getElementById('cam');
const overlay = document.getElementById('overlay');
const fpsEl = document.getElementById('fps');
const taskBar = document.getElementById('tasks');
const flipBtn = document.getElementById('flip-camera');
const startGate = document.getElementById('start');
const startBtn = document.getElementById('start-btn');
const errorGate = document.getElementById('error');
const errorMsg = document.getElementById('error-msg');

// The live vision session, set once the camera starts.
let vision = null;

/** Build the bottom task-switcher buttons from config.tasks. */
function buildTaskBar() {
  for (const task of config.tasks) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = task.label;
    btn.dataset.kind = task.kind;
    btn.addEventListener('click', () => selectTask(task.kind));
    taskBar.appendChild(btn);
  }
}

/** Mark one task button active. */
function highlightTask(kind) {
  for (const btn of taskBar.children) {
    btn.classList.toggle('active', btn.dataset.kind === kind);
  }
}

/** Switch the running model. Disables the bar so a fast double-tap can't
 *  start two model loads at once. */
async function selectTask(kind) {
  if (!vision || kind === vision.currentTask()) return;
  for (const btn of taskBar.children) btn.disabled = true;
  try {
    await vision.switchTask(kind);
    highlightTask(kind);
  } catch (err) {
    console.error('task switch failed:', err);
  } finally {
    for (const btn of taskBar.children) btn.disabled = false;
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

/** Start the camera and the vision loop. Triggered by the user gesture. */
async function start() {
  startBtn.disabled = true;
  startBtn.textContent = 'Starting...';
  try {
    vision = await mountVision({
      video: cam,
      canvas: overlay,
      kind: config.defaultTask,
      camera: { facingMode: config.facingMode },
      onFps: (fps) => { fpsEl.textContent = `${fps} FPS`; },
    });
    startGate.hidden = true;
    fpsEl.hidden = false;
    taskBar.hidden = false;
    highlightTask(config.defaultTask);
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
  // Front-facing camera reads naturally mirrored; updated again after start.
  stage.classList.toggle('mirror', config.facingMode === 'user');
  buildTaskBar();
  startBtn.addEventListener('click', start);
  flipBtn.addEventListener('click', flipCamera);
});
