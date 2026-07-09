/**
 * Example: a 1v1 party game (invite a friend OR play anyone).
 *
 * The shape almost every casual multiplayer game wants, with zero hand-rolled
 * lobby plumbing - createParty() owns hosting, share codes, invite links, the
 * browse list, quick-match, and every failure path:
 *
 *   - "Play with a friend": host() -> share table.inviteUrl (or the 4-char
 *     code); the friend's page joins via joinFromUrl() on load.
 *   - "Browse games": onTables() renders the live list; join(entry) seats you.
 *   - "Play anyone": quickMatch() joins the oldest open table, else hosts.
 *   - Back button while waiting: table.cancel() - the listing disappears
 *     everywhere and nothing can later yank the host into the dead match.
 *   - Failed joins THROW a RealtimeJoinError: err.code is 'not-found' (bad or
 *     expired code), 'full' (seats taken), or 'gone' (host left) - show the
 *     message, never a spinner stuck on "Joining…".
 *
 * Room names 'lobby' and 'match' ship provisioned with the kit (they are in
 * its realtime deploy phase); a custom pair just needs matching gipity.yaml
 * entries and createParty(rt, { lobby, match }) options.
 */

import { createRealtime, createParty } from '@gipity/realtime';

export async function partyGame({ name, onTables, onState, onStart, onOpponentLeft, onStatus }) {
  const rt = createRealtime();
  const party = createParty(rt, { seats: 2 });

  let table = null;  // current table handle
  let game = null;   // its 'state' store channel

  function bindTable(t) {
    table = t;
    game = table.channel('state', { sync: 'store' });
    game.onChange(() => onState(game.get('game')));
    table.onPeerLeave(() => onOpponentLeft());   // fires only on PERMANENT loss
    onStart(table);                              // { isHost, code, inviteUrl, room }
  }

  // An invite link brings the guest straight to the table - run this on load.
  try {
    const joined = await party.joinFromUrl();
    if (joined) bindTable(joined);
  } catch (err) {
    onStatus(err.code === 'full' ? 'That game is already full.'
      : 'That invite has expired - ask for a new link.');
  }

  return {
    rt,
    party,

    /** Render the live browse list (entries have .code / .host / .status). */
    watchTables: () => party.onTables(onTables),

    /** Host: returns immediately; onStart fires again when the guest arrives. */
    async host() {
      const t = await party.host({ host: name });
      onStatus(`Waiting for an opponent… share ${t.inviteUrl || 'code ' + t.code}`);
      t.onFull(() => onStatus(''));
      bindTable(t);
      return t;
    },

    /** Join by typed code, by browse-list entry, or against anyone. */
    async joinByCode(code) { bindTable(await party.joinByCode(code)); },
    async join(entry) { bindTable(await party.join(entry)); },
    async quickMatch() {
      const t = await party.quickMatch({ host: name });
      onStatus(t.isHost ? `No open games - hosting. Share ${t.inviteUrl || t.code}` : '');
      bindTable(t);
    },

    /** One key = whole game state = one message per move (LWW is correct 1v1). */
    move(next) { game?.set('game', next); },

    /** Back out - pre-game this cancels the listing; mid-game it leaves. */
    leave() { table?.leave(); table = null; game = null; },
  };
}
