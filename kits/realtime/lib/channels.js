/**
 * @gipity/realtime - Channel registry
 *
 * `rt.channel(name, { sync, authority, adapter })` is the primary API. One
 * Colyseus room backs everything; channels namespace by prefixing `name:`
 * onto every wire key / message type.
 *
 * sync modes: 'messages' (pub/sub) | 'presence' (ephemeral peer state) |
 * 'entities' (per-record CRUD) | 'store' (synchronous whole-object key-value).
 */

import { createPresenceChannel } from './presence.js';
import { createEntitiesChannel } from './entities.js';
import { createStoreChannel } from './store.js';
import { normalizeAdapter } from './context.js';

const RESERVED = new Set(['set_data', 'delete_data', 'set_player_data']);

export function createChannelRegistry({ transport, observability }) {
  const channels = new Map();

  function messagesChannel(name) {
    const prefix = `${name}:`;
    let sent = 0, received = 0;
    return {
      sync: 'messages', name,
      send(type, data = {}) { transport.send(prefix + type, data); sent++; },
      on(type, cb) {
        return transport.on(prefix + type, (d) => { received++; cb(d); });
      },
      metrics() { return { sent, received }; },
    };
  }

  function channel(name, opts = {}) {
    if (typeof name !== 'string' || !name || name.includes(':')) {
      throw new Error(`[realtime] invalid channel name: ${JSON.stringify(name)}`);
    }
    if (RESERVED.has(name)) throw new Error(`[realtime] reserved channel name: ${name}`);
    if (channels.has(name)) return channels.get(name);

    const sync = opts.sync || 'messages';
    const adapter = normalizeAdapter(opts.adapter);

    let ch;
    if (sync === 'messages') {
      ch = messagesChannel(name);
    } else if (sync === 'presence') {
      ch = createPresenceChannel({ name, transport, adapter, observability });
    } else if (sync === 'entities') {
      ch = createEntitiesChannel({
        name, authority: opts.authority || 'shared', transport, adapter, observability,
      });
    } else if (sync === 'store') {
      ch = createStoreChannel({
        name, transport, observability, authority: opts.authority || 'shared',
      });
    } else {
      throw new Error(`[realtime] unknown sync mode: ${sync}`);
    }

    channels.set(name, ch);
    observability.emit('channel-open', { name, sync });
    // A channel created after the room is already open still needs its
    // post-connect hook (host election, ready-replay).
    if (transport.isConnected()) ch._afterConnect?.();
    return ch;
  }

  function afterConnect() {
    for (const ch of channels.values()) ch._afterConnect?.();
  }

  return { channel, all: () => [...channels.values()], afterConnect };
}
