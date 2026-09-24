/**
 * Example: enterprise chat — the simplest shape.
 *
 * Two channels, no entities, no 3D. Proves the kit carries zero
 * game/spatial assumptions: a `messages` channel for chat lines and a
 * `presence` channel for names + typing indicators.
 */

import { createRealtime } from '@gipity/realtime';

let myName = 'Anonymous';
let amTyping = false;
export function setName(n) { myName = n; }
export function setTyping(t) { amTyping = t; }

// Presence adapter: encode local identity; merge remote identities.
const chatPresenceAdapter = {
  presence: {
    newPeer: () => ({ name: '', typing: false }),
    encode: () => ({ name: myName, typing: amTyping }),
    apply: (peer, payload) => {
      peer.name = payload.name;
      peer.typing = !!payload.typing;
    },
  },
};

export async function startChat({ onMessage, onPresence }) {
  const rt = createRealtime({ room: 'support-channel' });

  const chat = rt.channel('chat', { sync: 'messages' });
  const who = rt.channel('who', { sync: 'presence', adapter: chatPresenceAdapter });

  chat.on('line', (m) => onMessage(m));               // { from, text }
  who.onChange(() => onPresence([...who.peers().values()]));
  who.onLeave(() => onPresence([...who.peers().values()]));

  await rt.connect();

  return {
    say: (text) => chat.send('line', { from: myName, text }),
    rt,
  };
}
