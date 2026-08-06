/**
 * 3D World - UI Module
 * HUD elements, loading screen, and overlays.
 *
 * Exports: showLoading, hideLoading, updateLoadingProgress, setHud, showMessage,
 *          InfoPanel, createStatPanel, debug, setDebugInfo, updateDebugFps
 */

const loadingScreen = document.getElementById('loading-screen');
const loadingBar = document.getElementById('loading-bar');
const loadingStatus = document.getElementById('loading-status');
const hud = document.getElementById('hud');

// True when a key event belongs to a form field the user is typing in
// (high-score name entry, chat box). Hotkey handlers must ignore those keys.
function isTypingTarget(el) {
  return el instanceof Element && (el.closest('input, textarea, select') !== null || el.isContentEditable);
}

/** Update loading progress (0-1) and status text */
function updateLoadingProgress(progress, statusText) {
  if (loadingBar) loadingBar.style.width = `${Math.round(progress * 100)}%`;
  if (loadingStatus && statusText) loadingStatus.textContent = statusText;
}

/** Update loading screen title */
function setLoadingTitle(title) {
  const el = loadingScreen?.querySelector('.loading-title');
  if (el) el.textContent = title;
}

/** Hide loading screen with fade animation */
function hideLoading() {
  if (loadingScreen) {
    loadingScreen.classList.add('fade-out');
    setTimeout(() => { loadingScreen.style.display = 'none'; }, 500);
  }
  if (hud) hud.classList.remove('hidden');
}

/** Show loading screen */
function showLoading() {
  if (loadingScreen) {
    loadingScreen.classList.remove('fade-out');
    loadingScreen.style.display = 'flex';
  }
}

/**
 * Set HUD slot content.
 * slot: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
 * html: HTML string or element
 */
function setHud(slot, html) {
  const el = document.getElementById(`hud-${slot}`);
  if (!el) return;
  if (typeof html === 'string') {
    el.innerHTML = html;
  } else if (html instanceof HTMLElement) {
    el.innerHTML = '';
    el.appendChild(html);
  }
}

/** Clear a HUD slot */
function clearHud(slot) {
  const el = document.getElementById(`hud-${slot}`);
  if (el) el.innerHTML = '';
}

/** Show a centered message (auto-hide after duration ms, 0 = sticky) */
function showMessage(text, duration = 3000) {
  setHud('center', `<div class="hud-panel" style="font-size:20px;font-weight:700">${text}</div>`);
  if (duration > 0) {
    setTimeout(() => clearHud('center'), duration);
  }
}

/** Hide centered message */
function hideMessage() {
  clearHud('center');
}

// ---------------------------------------------------------------------------
// InfoPanel - Reusable UI component for displaying info in the 3D World style.
//
// Used internally by the debug panel and available to game code for stats,
// inventories, leaderboards, dialogs, etc.
//
// Usage:
//   const panel = new ui.InfoPanel({ title: 'Stats', position: 'top-right' });
//   panel.addRow('Health', '100', { color: '#0f0' });
//   panel.addRow('Score', '0');
//   panel.setRow('Health', '75', { color: '#ff0' });
//   panel.removeRow('Score');
//   panel.destroy();
// ---------------------------------------------------------------------------

let infoPanelCount = 0;

class InfoPanel {
  /**
   * @param {Object} options
   * @param {string} options.title       - Panel title (optional)
   * @param {string} options.position    - 'top-left'|'top-right'|'bottom-left'|'bottom-right' or 'custom'
   * @param {number} options.top         - Custom top px (when position='custom')
   * @param {number} options.left        - Custom left px
   * @param {number} options.right       - Custom right px
   * @param {number} options.bottom      - Custom bottom px
   * @param {number} options.width       - Fixed width px (optional, auto by default)
   * @param {boolean} options.visible    - Start visible (default: true)
   * @param {boolean} options.compact    - Smaller padding + font (default: false)
   * @param {string} options.toggleKey   - Keyboard code to toggle visibility (e.g. 'KeyI')
   */
  constructor(options = {}) {
    this._id = `gip3dw-panel-${++infoPanelCount}`;
    this._rows = new Map(); // key → { el, labelEl, valueEl }
    this._visible = options.visible !== false;

    // Create DOM element
    this._el = document.createElement('div');
    this._el.id = this._id;
    this._el.className = 'gip3dw-info-panel' + (options.compact ? ' gip3dw-panel-compact' : '');
    if (!this._visible) this._el.style.display = 'none';

    // Position
    const pos = options.position || 'top-left';
    if (pos === 'custom') {
      if (options.top !== undefined) this._el.style.top = options.top + 'px';
      if (options.bottom !== undefined) this._el.style.bottom = options.bottom + 'px';
      if (options.left !== undefined) this._el.style.left = options.left + 'px';
      if (options.right !== undefined) this._el.style.right = options.right + 'px';
    } else {
      const corners = {
        'top-left':     { top: '8px',  left: '8px' },
        'top-right':    { top: '8px',  right: '8px' },
        'bottom-left':  { bottom: '8px', left: '8px' },
        'bottom-right': { bottom: '8px', right: '8px' },
      };
      const c = corners[pos] || corners['top-left'];
      Object.assign(this._el.style, c);
    }

    if (options.width) this._el.style.width = options.width + 'px';

    // Title
    this._titleEl = null;
    if (options.title) {
      this._titleEl = document.createElement('div');
      this._titleEl.className = 'gip3dw-panel-title';
      this._titleEl.textContent = options.title;
      this._el.appendChild(this._titleEl);
    }

    // Rows container
    this._body = document.createElement('div');
    this._body.className = 'gip3dw-panel-body';
    this._el.appendChild(this._body);

    // Toggle key
    if (options.toggleKey) {
      this._toggleHandler = (e) => {
        if (isTypingTarget(e.target)) return;
        if (e.code === options.toggleKey) { this.toggle(); e.preventDefault(); }
      };
      window.addEventListener('keydown', this._toggleHandler);
    }

    document.body.appendChild(this._el);
  }

  /** Set the panel title */
  setTitle(text) {
    if (!this._titleEl) {
      this._titleEl = document.createElement('div');
      this._titleEl.className = 'gip3dw-panel-title';
      this._el.insertBefore(this._titleEl, this._body);
    }
    this._titleEl.textContent = text;
  }

  /**
   * Add a labeled row to the panel.
   * @param {string} key      - Unique row key (used for updates)
   * @param {string} value    - Display value
   * @param {Object} options
   * @param {string} options.label - Label text (defaults to key)
   * @param {string} options.color - Value text color
   * @param {boolean} options.bold - Bold value
   */
  addRow(key, value = '', options = {}) {
    if (this._rows.has(key)) { this.setRow(key, value, options); return; }

    const row = document.createElement('div');
    row.className = 'gip3dw-panel-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'gip3dw-panel-label';
    labelEl.textContent = options.label || key;

    const valueEl = document.createElement('span');
    valueEl.className = 'gip3dw-panel-value';
    valueEl.textContent = value;
    if (options.color) valueEl.style.color = options.color;
    if (options.bold) valueEl.style.fontWeight = '700';

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    this._body.appendChild(row);

    this._rows.set(key, { el: row, labelEl, valueEl });
  }

  /** Update a row's value and optionally its color */
  setRow(key, value, options = {}) {
    const row = this._rows.get(key);
    if (!row) { this.addRow(key, value, options); return; }
    row.valueEl.textContent = value;
    if (options.color) row.valueEl.style.color = options.color;
    if (options.label) row.labelEl.textContent = options.label;
  }

  /** Remove a row */
  removeRow(key) {
    const row = this._rows.get(key);
    if (!row) return;
    row.el.remove();
    this._rows.delete(key);
  }

  /**
   * Set raw HTML content (replaces all rows).
   * Use for custom layouts, tables, or rich content.
   */
  setContent(html) {
    this._body.innerHTML = html;
    this._rows.clear();
  }

  /** Show the panel */
  show() { this._visible = true; this._el.style.display = ''; }

  /** Hide the panel */
  hide() { this._visible = false; this._el.style.display = 'none'; }

  /** Toggle visibility */
  toggle() { this._visible ? this.hide() : this.show(); }

  /** Check if visible */
  get visible() { return this._visible; }

  /** Get the underlying DOM element (for advanced customization) */
  get element() { return this._el; }

  /** Remove the panel from the DOM entirely */
  destroy() {
    if (this._toggleHandler) window.removeEventListener('keydown', this._toggleHandler);
    this._el.remove();
    this._rows.clear();
  }
}


// --- Legacy helpers (kept for backward compat) ---

/** Create a panel element with label + value (common HUD pattern) */
function createStatPanel(label, initialValue = '0') {
  const panel = document.createElement('div');
  panel.className = 'hud-panel';
  panel.innerHTML = `<div class="hud-label">${label}</div><div class="hud-value" id="stat-${label.toLowerCase().replace(/\s/g, '-')}">${initialValue}</div>`;
  return panel;
}

/** Update a stat value by label ID */
function updateStat(labelId, value) {
  const el = document.getElementById(`stat-${labelId}`);
  if (el) el.textContent = String(value);
}


// ---------------------------------------------------------------------------
// Debug Panel - built on InfoPanel
// Toggle with U or backtick (`). Defaults to OFF, persisted in localStorage.
// ---------------------------------------------------------------------------
let debugInfoPanel = null;
let debugLogPanel = null;
let debugVisible = false;
let debugLines = [];
const DEBUG_MAX_LINES = 50;
let frameCount = 0;
let fpsTime = 0;
let fps = 0;
let debugFwVersion = '?';
let debugAppVersion = '?';
let debugAppTitle = '';
let debugRendererInfo = null; // set by core.js each frame
let debugPartCount = 0;

function initDebugPanel() {
  // Restore state from localStorage
  try { debugVisible = localStorage.getItem('gip3dw_debug_panel') === '1'; } catch {}

  // Version/stats panel - top-left
  debugInfoPanel = new InfoPanel({
    position: 'top-left',
    compact: true,
    visible: debugVisible,
  });
  debugInfoPanel._el.id = 'gip3dw-debug-info';

  // Toggle with U or backtick
  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return;
    if (e.code === 'KeyU' || e.code === 'Backquote') {
      e.preventDefault();
      debugVisible = !debugVisible;
      debugInfoPanel._el.style.display = debugVisible ? '' : 'none';
      try { localStorage.setItem('gip3dw_debug_panel', debugVisible ? '1' : '0'); } catch {}
    }
  });

  // Intercept console.log/warn/error
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args) => { debugLog('log', args); origLog.apply(console, args); };
  console.warn = (...args) => { debugLog('warn', args); origWarn.apply(console, args); };
  console.error = (...args) => { debugLog('error', args); origError.apply(console, args); };

  renderDebugInfo();
}

/** Set version info for the debug panel (called by core.js during boot) */
function setDebugInfo({ fwVersion, appVersion, appTitle, partCount }) {
  if (fwVersion !== undefined) debugFwVersion = fwVersion;
  if (appVersion !== undefined) debugAppVersion = appVersion;
  if (appTitle !== undefined) debugAppTitle = appTitle;
  if (partCount !== undefined) debugPartCount = partCount;
  if (debugVisible) renderDebugInfo();
}

/** Update renderer/physics stats (called by core.js each frame, throttled to 4Hz) */
function setRendererInfo(info) {
  debugRendererInfo = info;
}

function renderDebugInfo() {
  if (!debugInfoPanel) return;
  const title = debugAppTitle || '3D World';
  debugInfoPanel.setTitle(`${title} v${debugAppVersion}`);
  debugInfoPanel.setRow('fw', `fw${debugFwVersion}`, { label: '3D World', color: '#888' });
  debugInfoPanel.setRow('fps', String(fps), {
    label: 'FPS',
    color: fps >= 50 ? '#0f0' : fps >= 30 ? '#ff0' : '#f44',
    bold: true,
  });
  if (debugPartCount > 0) {
    debugInfoPanel.setRow('parts', String(debugPartCount), { label: 'Parts', color: '#888' });
  }
  // Renderer stats (from Three.js renderer.info)
  if (debugRendererInfo) {
    const r = debugRendererInfo;
    debugInfoPanel.setRow('draws', String(r.drawCalls), { label: 'Draws', color: '#888' });
    const tris = r.triangles >= 1000 ? (r.triangles / 1000).toFixed(1) + 'k' : String(r.triangles);
    debugInfoPanel.setRow('tris', tris, { label: 'Tris', color: '#888' });
    debugInfoPanel.setRow('scene', String(r.sceneObjects), { label: 'Scene', color: '#888' });
    debugInfoPanel.setRow('bodies', String(r.bodies), { label: 'Bodies', color: '#888' });
    debugInfoPanel.setRow('awake', String(r.awake), { label: 'Awake', color: '#888' });
    debugInfoPanel.setRow('tex', String(r.textures), { label: 'Textures', color: '#555' });
    debugInfoPanel.setRow('geo', String(r.geometries), { label: 'Geos', color: '#555' });
  }
  debugInfoPanel.setRow('toggle', 'U / Y', { label: 'Toggle', color: '#555' });
}

function debugLog(level, args) {
  const colors = { log: '#0f0', warn: '#ff0', error: '#f44' };
  const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  debugLines.push({ level, text, color: colors[level] || '#0f0' });
  if (debugLines.length > DEBUG_MAX_LINES) debugLines.shift();
}

/** Log a message to the debug panel */
function debug(msg) {
  debugLog('log', [msg]);
}

/** Call each frame to track FPS */
function updateDebugFps(dt) {
  frameCount++;
  fpsTime += dt;
  if (fpsTime >= 1) {
    fps = frameCount;
    frameCount = 0;
    fpsTime -= 1;
    if (debugVisible) renderDebugInfo();
  }
}

// Init immediately
initDebugPanel();

export {
  updateLoadingProgress,
  setLoadingTitle,
  hideLoading,
  showLoading,
  setHud,
  clearHud,
  showMessage,
  hideMessage,
  InfoPanel,
  createStatPanel,
  updateStat,
  debug,
  updateDebugFps,
  setDebugInfo,
  setRendererInfo,
};
