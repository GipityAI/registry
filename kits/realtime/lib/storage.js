/**
 * @gipity/realtime - Browser storage helpers. Every access is guarded: private
 * windows, disabled storage, and non-browser runtimes just get no persistence.
 */

function store(kind) {
  try {
    if (typeof window === 'undefined') return null;
    return window[kind] ?? null;
  } catch {
    return null;
  }
}

export function readStored(kind, key) {
  try { return store(kind)?.getItem(key) ?? null; } catch { return null; }
}

export function writeStored(kind, key, value) {
  try {
    const s = store(kind);
    if (!s) return;
    if (value == null) s.removeItem(key); else s.setItem(key, value);
  } catch { /* storage full or blocked */ }
}

/** A random id that stays the same for this browser (localStorage), so an app
 *  can recognize a returning player after a reload. Ephemeral when storage is
 *  unavailable. */
export function deviceClientId() {
  const key = 'gipity-rt:client-id';
  let id = readStored('localStorage', key);
  if (!id) {
    const bytes = new Uint8Array(12);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    id = 'c_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    writeStored('localStorage', key, id);
  }
  return id;
}
