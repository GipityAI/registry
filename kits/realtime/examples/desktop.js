/**
 * Example: multiplayer "cloud desktop" / collaborative OS.
 *
 * The mixed-authority shape: different channels, different substrates, one
 * room. Windows are shared entities; the terminal and notifications are
 * message streams; agent processes are server-authoritative entities;
 * cursors + active selection are presence.
 */

import { createRealtime } from '@gipity/realtime';
import { recordAdapter } from '@gipity/realtime/adapters/record-adapter.js';

let pointer = { x: 0, y: 0 };
let selectedWindow = null;
export function setPointer(x, y) { pointer = { x, y }; }
export function selectWindow(id) { selectedWindow = id; }

const deskPresenceAdapter = {
  presence: {
    newPeer: () => ({ x: 0, y: 0, selectedWindow: null }),
    encode: () => ({ ...pointer, selectedWindow }),
    apply: (peer, p) => { peer.x = p.x; peer.y = p.y; peer.selectedWindow = p.selectedWindow; },
  },
};

export async function startDesktop({ renderWindow, renderAgent, onTerminal, onNotify, renderCursors }) {
  const rt = createRealtime({ room: 'desktop-shared' });

  const windows = rt.channel('windows', { sync: 'entities', authority: 'shared', adapter: recordAdapter });
  const agents  = rt.channel('agents',  { sync: 'entities', authority: 'server', adapter: recordAdapter });
  const terminal = rt.channel('terminal', { sync: 'messages' });
  const notifications = rt.channel('notifications', { sync: 'messages' });
  const cursors = rt.channel('cursors', { sync: 'presence', adapter: deskPresenceAdapter });

  // window = { id, type:'window', x, y, w, h, app, owner }
  windows.onUpsert((id, w) => renderWindow(id, w));
  windows.onDelete((id) => renderWindow(id, null));
  agents.onUpsert((id, a) => renderAgent(id, a));
  terminal.on('out', (line) => onTerminal(line));
  notifications.on('notify', (n) => onNotify(n));
  cursors.onChange(() => renderCursors([...cursors.peers().values()]));

  await rt.connect();

  return {
    openWindow: (w) => windows.upsert(w.id, w),
    moveWindow: (w) => windows.upsert(w.id, w),
    closeWindow: (id) => windows.delete(id),
    runCommand: (cmd) => terminal.send('out', cmd),
    notify: (n) => notifications.send('notify', n),
    rt,
  };
}
