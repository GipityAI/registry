/**
 * 3D World - Mobile Controls Module
 * Touch input overlay: floating virtual joystick (left), action buttons
 * (bottom-right), camera-look drags on the canvas, and a fullscreen toggle.
 *
 * Standard mobile-game layout:
 *   - Left half: floating joystick - the pad appears wherever the thumb lands
 *   - Bottom-right: round action buttons (first button = primary, biggest)
 *   - Anywhere else on the canvas: drag to look/orbit the camera
 *   - Top-right: fullscreen toggle (hidden where unsupported, e.g. iPhone
 *     Safari - there "Add to Home Screen" runs the game fullscreen instead)
 *
 * Shows on touch-first devices (coarse pointer: phones/tablets) and appears
 * lazily on the first touch on hybrid touchscreen laptops. Renders nothing on
 * mouse-only desktops. Every touch is tracked by pointer id, so joystick +
 * button + camera drag all work simultaneously.
 *
 * Used by player.js; game code normally never calls this directly.
 *
 * Exports: initMobileControls, isTouchDevice
 */

const JOY_RADIUS = 48;     // px the thumb can travel from the base center
const JOY_DEADZONE = 0.15; // fraction of radius ignored before input registers

/** True when the primary pointer is a finger (phones/tablets). */
function isTouchDevice() {
  return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
    || navigator.maxTouchPoints > 0;
}

/**
 * Build the touch overlay and wire callbacks.
 *
 * @param {Object} options
 * @param {Element}  options.lookElement - element whose touch-drags drive onLook (the game canvas)
 * @param {Array}    options.buttons     - [{ id, label }] action buttons; first = primary
 * @param {boolean}  options.joystick    - show the movement joystick (default true)
 * @param {boolean}  options.fullscreen  - show the fullscreen toggle (default true)
 * @param {Function} options.onMove      - (x, y) joystick vector, each -1..1 (y+ = down/toward player)
 * @param {Function} options.onLook      - (dx, dy) camera drag deltas in px
 * @param {Function} options.onButton    - (id, down) button press/release
 * @returns {{ isTouch: boolean }} - isTouch is live: true once controls are shown
 */
function initMobileControls(options = {}) {
  const opts = {
    buttons: [{ id: 'jump', label: 'Jump' }],
    joystick: true,
    fullscreen: true,
    onMove: () => {},
    onLook: () => {},
    onButton: () => {},
    ...options,
  };

  const state = { isTouch: false };
  let mounted = false;

  const mount = () => {
    if (mounted) return;
    mounted = true;
    state.isTouch = true;
    buildOverlay(opts);
    if (opts.lookElement) wireLook(opts.lookElement, opts.onLook);
  };

  if (isTouchDevice()) {
    mount();
  } else {
    // Hybrid/touchscreen laptops: appear on the first real touch.
    window.addEventListener('touchstart', mount, { once: true, passive: true });
  }

  return state;
}

function buildOverlay(opts) {
  let root = document.getElementById('mobile-controls');
  if (!root) {
    root = document.createElement('div');
    root.id = 'mobile-controls';
    document.body.appendChild(root);
  }
  root.classList.remove('hidden');
  root.innerHTML = '';

  if (opts.joystick) buildJoystick(root, opts.onMove);
  buildButtons(root, opts.buttons, opts.onButton);
  if (opts.fullscreen) buildFullscreenButton(root);
}

// --- Floating joystick (lower-left zone) ---
function buildJoystick(root, onMove) {
  const zone = document.createElement('div');
  zone.className = 'joystick-zone';
  const base = document.createElement('div');
  base.className = 'joystick-base';
  const thumb = document.createElement('div');
  thumb.className = 'joystick-thumb';
  base.appendChild(thumb);
  zone.appendChild(base);
  root.appendChild(zone);

  let pointerId = null;
  let cx = 0, cy = 0; // base center

  const setThumb = (dx, dy) => {
    thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };

  zone.addEventListener('pointerdown', (e) => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    // Capture keeps the drag alive if the finger slides off the element; synthetic
    // pointers (tests) have no capturable id, so tolerate failure.
    try { zone.setPointerCapture(e.pointerId); } catch {}
    cx = e.clientX;
    cy = e.clientY;
    base.style.left = `${cx}px`;
    base.style.top = `${cy}px`;
    base.classList.add('active');
    setThumb(0, 0);
    e.preventDefault();
  });

  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > JOY_RADIUS) { dx *= JOY_RADIUS / dist; dy *= JOY_RADIUS / dist; }
    setThumb(dx, dy);
    // Deadzone, then rescale so the pad edge still reaches full speed.
    const norm = Math.min(dist / JOY_RADIUS, 1);
    const scaled = norm < JOY_DEADZONE ? 0 : (norm - JOY_DEADZONE) / (1 - JOY_DEADZONE);
    if (scaled === 0 || dist === 0) { onMove(0, 0); return; }
    onMove((dx / dist) * scaled, (dy / dist) * scaled);
  });

  const release = (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    base.classList.remove('active');
    onMove(0, 0);
  };
  zone.addEventListener('pointerup', release);
  zone.addEventListener('pointercancel', release);
}

// --- Action buttons (bottom-right) ---
function buildButtons(root, buttons, onButton) {
  if (!buttons || !buttons.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'mobile-buttons';
  root.appendChild(wrap);

  buttons.forEach((btn, i) => {
    const el = document.createElement('button');
    el.id = `btn-${btn.id}`;
    el.className = 'mobile-btn' + (i === 0 ? ' mobile-btn-primary' : '');
    el.textContent = btn.label || btn.id;
    el.setAttribute('aria-label', btn.label || btn.id);
    wrap.appendChild(el);

    el.addEventListener('pointerdown', (e) => {
      // Capture keeps the drag alive if the finger slides off the element; synthetic
      // pointers (tests) have no capturable id, so tolerate failure.
      try { el.setPointerCapture(e.pointerId); } catch {}
      onButton(btn.id, true);
      e.preventDefault();
    });
    const up = () => onButton(btn.id, false);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  });
}

// --- Camera look: touch-drag anywhere on the canvas not claimed by controls ---
function wireLook(el, onLook) {
  let pointerId = null;
  let lastX = 0, lastY = 0;

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || pointerId !== null) return;
    pointerId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    // Capture keeps the drag alive if the finger slides off the element; synthetic
    // pointers (tests) have no capturable id, so tolerate failure.
    try { el.setPointerCapture(e.pointerId); } catch {}
    // Suppress the synthesized mouse events a touch would otherwise fire
    // (they'd trigger the desktop click-to-action path).
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    onLook(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const release = (e) => {
    if (e.pointerId === pointerId) pointerId = null;
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
}

// --- Fullscreen toggle (top-right) ---
function buildFullscreenButton(root) {
  const el = document.documentElement;
  // Unavailable (iPhone Safari) or already standalone (home-screen app): skip.
  if (!el.requestFullscreen
    || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)) return;

  const btn = document.createElement('button');
  btn.className = 'fullscreen-btn';
  btn.setAttribute('aria-label', 'Toggle fullscreen');
  const draw = () => {
    btn.innerHTML = document.fullscreenElement
      ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 4v3a2 2 0 0 1-2 2H4M15 4v3a2 2 0 0 0 2 2h3M9 20v-3a2 2 0 0 0-2-2H4M15 20v-3a2 2 0 0 1 2-2h3"/></svg>'
      : '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V6a2 2 0 0 1 2-2h3M20 9V6a2 2 0 0 0-2-2h-3M4 15v3a2 2 0 0 0 2 2h3M20 15v3a2 2 0 0 1-2 2h-3"/></svg>';
  };
  draw();
  root.appendChild(btn);

  btn.addEventListener('pointerup', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
  });
  document.addEventListener('fullscreenchange', draw);
}

export { initMobileControls, isTouchDevice };
