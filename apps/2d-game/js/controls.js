// Touch controls + fullscreen button - a DOM overlay above the Phaser canvas.
//
// On touch devices this shows the standard mobile-game layout: a floating
// virtual joystick on the left half (appears wherever the thumb lands) and
// round action buttons bottom-right, plus a fullscreen toggle top-right.
// On desktop nothing renders - keyboard/mouse input is untouched.
//
// Usage (see scenes/game.js):
//   import { touch, initTouchControls } from '../controls.js';
//   initTouchControls({ buttons: [{ id: 'jump', label: 'Jump' }] });
//   // each frame:
//   //   touch.x / touch.y        -1..1 analog joystick (0 when idle)
//   //   touch.isDown('jump')     button currently held
//   //   touch.justPressed('jump') true once per press (edge-triggered)
//
// Options for initTouchControls:
//   buttons:    [{ id, label }]  action buttons, first = primary (bigger,
//               bottom-right corner). Default: [{ id: 'jump', label: 'Jump' }]
//   joystick:   true|false  disable for tap-only games (default true). The
//               joystick zone swallows touches on the lower-left half, so
//               turn it off if your game is "tap anywhere" instead.
//   fullscreen: true|false  show the fullscreen toggle (default true; it
//               auto-hides where the Fullscreen API is unavailable, e.g.
//               iPhone Safari - there, "Add to Home Screen" gives fullscreen).

const JOY_RADIUS = 48;     // px the thumb can travel from the base center
const JOY_DEADZONE = 0.15; // fraction of radius ignored before input registers

export const touch = {
  x: 0,
  y: 0,
  active: false,   // true while the joystick is being touched
  enabled: false,  // true once touch controls have been shown
  _down: {},
  _latch: {},
  /** Is a button currently held? */
  isDown(id) { return !!this._down[id]; },
  /** True once per press - reading it consumes the press. */
  justPressed(id) {
    if (this._latch[id]) { this._latch[id] = false; return true; }
    return false;
  },
};

/** True when the primary pointer is a finger (phones/tablets). */
export function isTouchDevice() {
  return window.matchMedia?.('(pointer: coarse)').matches
    || navigator.maxTouchPoints > 0;
}

export function initTouchControls(options = {}) {
  const opts = {
    buttons: [{ id: 'jump', label: 'Jump' }],
    joystick: true,
    fullscreen: true,
    ...options,
  };

  let mounted = false;
  const mount = () => {
    if (mounted) return;
    mounted = true;
    touch.enabled = true;
    buildOverlay(opts);
  };

  if (isTouchDevice()) {
    mount();
  } else {
    // Hybrid/touchscreen laptops: appear on the first real touch.
    window.addEventListener('touchstart', mount, { once: true, passive: true });
  }

  return touch;
}

function buildOverlay(opts) {
  const root = document.createElement('div');
  root.id = 'touch-controls';
  document.body.appendChild(root);

  if (opts.joystick) buildJoystick(root);
  buildButtons(root, opts.buttons);
  if (opts.fullscreen) buildFullscreenButton(root);
}

// --- Floating joystick (left half) ---
function buildJoystick(root) {
  const zone = document.createElement('div');
  zone.className = 'touch-joystick-zone';
  const base = document.createElement('div');
  base.className = 'touch-joystick-base';
  const thumb = document.createElement('div');
  thumb.className = 'touch-joystick-thumb';
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
    touch.active = true;
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
    // Deadzone, then rescale so the edge still reaches 1.0
    const norm = Math.min(dist / JOY_RADIUS, 1);
    const scaled = norm < JOY_DEADZONE ? 0 : (norm - JOY_DEADZONE) / (1 - JOY_DEADZONE);
    if (scaled === 0 || dist === 0) { touch.x = 0; touch.y = 0; return; }
    touch.x = (dx / dist) * scaled;
    touch.y = (dy / dist) * scaled;
  });

  const release = (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    base.classList.remove('active');
    touch.active = false;
    touch.x = 0;
    touch.y = 0;
  };
  zone.addEventListener('pointerup', release);
  zone.addEventListener('pointercancel', release);
}

// --- Action buttons (bottom-right) ---
function buildButtons(root, buttons) {
  if (!buttons?.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'touch-buttons';
  root.appendChild(wrap);

  buttons.forEach((btn, i) => {
    const el = document.createElement('button');
    el.className = 'touch-btn' + (i === 0 ? ' touch-btn-primary' : '');
    el.textContent = btn.label ?? btn.id;
    el.setAttribute('aria-label', btn.label ?? btn.id);
    wrap.appendChild(el);

    el.addEventListener('pointerdown', (e) => {
      // Capture keeps the drag alive if the finger slides off the element; synthetic
      // pointers (tests) have no capturable id, so tolerate failure.
      try { el.setPointerCapture(e.pointerId); } catch {}
      touch._down[btn.id] = true;
      touch._latch[btn.id] = true;
      e.preventDefault();
    });
    const up = () => { touch._down[btn.id] = false; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    // Belt & braces: never let a button act like a form submit / gain focus ring
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  });
}

// --- Fullscreen toggle (top-right) ---
function buildFullscreenButton(root) {
  const el = document.documentElement;
  // Unavailable (iPhone Safari) or already standalone (home-screen app): skip.
  if (!el.requestFullscreen || window.matchMedia?.('(display-mode: standalone)').matches) return;

  const btn = document.createElement('button');
  btn.className = 'touch-fullscreen-btn';
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
