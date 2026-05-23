/**
 * Example: collaborative whiteboard (Figma-lite).
 *
 * Demonstrates shared-authority entity sync + live cursors. Shapes are plain
 * JSON records, so the shipped recordAdapter is reused verbatim - the app
 * writes no entity adapter at all. Any peer edits any shape; the State-room
 * data map persists them and syncs late joiners for free.
 */

import { createRealtime } from '@gipity/realtime';
import { recordAdapter } from '@gipity/realtime/adapters/record-adapter.js';

// Live-cursor presence adapter.
let cursor = { x: 0, y: 0 };
export function moveCursor(x, y) { cursor = { x, y }; }

const cursorAdapter = {
  presence: {
    newPeer: () => ({ x: 0, y: 0 }),
    encode: () => ({ ...cursor }),
    apply: (peer, p) => { peer.x = p.x; peer.y = p.y; },
  },
};

export async function startWhiteboard({ render, renderCursors }) {
  const rt = createRealtime({ room: 'board-1' });

  const shapes  = rt.channel('shapes',  { sync: 'entities', authority: 'shared', adapter: recordAdapter });
  const cursors = rt.channel('cursors', { sync: 'presence', adapter: cursorAdapter });

  shapes.onUpsert((id, shape) => render(id, shape));   // shape = {type:'shape',x,y,w,h,color,text}
  shapes.onDelete((id) => render(id, null));
  shapes.onReady(() => render(null, null));            // initial snapshot applied
  cursors.onChange(() => renderCursors([...cursors.peers().values()]));

  await rt.connect();

  return {
    addShape: (shape) => shapes.upsert(shape.id, shape),
    editShape: (shape) => shapes.upsert(shape.id, shape),  // last-write-wins
    removeShape: (id) => shapes.delete(id),
    rt,
  };
}
