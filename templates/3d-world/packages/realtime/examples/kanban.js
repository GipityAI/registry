/**
 * Example: realtime Kanban board.
 *
 * Cards are server-authoritative entities; presence shows who is viewing or
 * editing which card. Demonstrates the optimistic-update pattern: apply the
 * change locally at once, then let the data-map onUpsert reconcile.
 */

import { createRealtime } from '@gipity/realtime';
import { recordAdapter } from '@gipity/realtime/adapters/record-adapter.js';

let viewing = null;
let editing = false;
export function setViewing(cardId, isEditing = false) { viewing = cardId; editing = isEditing; }

const boardPresenceAdapter = {
  presence: {
    newPeer: () => ({ user: '', viewingTask: null, typing: false }),
    encode: () => ({ viewingTask: viewing, typing: editing }),
    apply: (peer, p) => { peer.viewingTask = p.viewingTask; peer.typing = !!p.typing; },
  },
};

export async function startKanban({ user, renderCard, renderPresence }) {
  const rt = createRealtime({ room: 'board-team-a' });

  const cards    = rt.channel('cards',    { sync: 'entities', authority: 'server', adapter: recordAdapter });
  const presence = rt.channel('presence', { sync: 'presence', adapter: boardPresenceAdapter });

  // card = { id, title, assignee, lane, priority }
  cards.onUpsert((id, c) => renderCard(id, c));
  cards.onDelete((id) => renderCard(id, null));
  presence.onChange(() => renderPresence([...presence.peers().entries()]));

  await rt.connect();

  return {
    moveCard: (card, lane) => {
      renderCard(card.id, { ...card, lane });          // optimistic
      cards.upsert(card.id, { ...card, lane });        // authoritative
    },
    saveCard: (card) => cards.upsert(card.id, card),
    deleteCard: (id) => cards.delete(id),
    rt,
  };
}
