/**
 * Example: a lobby — the directory pattern.
 *
 * One shared room whose `store` channel lists what is open. Each host
 * publishes an entry and heartbeats it; every client sees the live list and
 * sweeps entries that went quiet. This is the "browse games / rooms /
 * sessions" half of any lobby app — see connect-four.js for the matching
 * per-match rooms.
 */

import { createRealtime, createDirectory } from '@gipity/realtime';

export async function openLobby({ onList }) {
  const rt = createRealtime();
  const lobby = await rt.join('lobby');       // the shared directory room
  const dir = createDirectory(lobby);          // a heartbeat'd store channel

  // Re-render whenever the directory changes; sweep stale entries first.
  dir.onChange(() => { dir.sweep(); onList(dir.list()); });
  onList(dir.list());

  return {
    rt,
    lobby,
    /** Advertise something this peer is hosting (and start heart-beating it). */
    advertise(id, info) { dir.publish(id, info); },
    /** Patch this peer's advertised entry (e.g. status: 'open' -> 'playing'). */
    update(patch) { dir.update(patch); },
    /** Take this peer's entry down. */
    remove() { dir.unpublish(); },
  };
}
