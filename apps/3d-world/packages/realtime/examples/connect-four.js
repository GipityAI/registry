/**
 * Example: a lobby game (Connect 4 shape).
 *
 * Proves the kit covers a lobby plus many short-lived match rooms — the shape
 * a turn-based or casual multiplayer game needs, and the one the Connect 4
 * reference app had to hand-roll before this kit supported it. The realtime
 * layer is the ~40 lines below; the game's rules and UI sit on top untouched.
 *
 *   - one shared 'lobby' room - a `store` channel lists open games
 *   - one ephemeral 'match' room per game - a `store` channel holds its state
 *   - turn-based, so last-write-wins is correct: no host election needed
 *   - the whole game state is one key, so each move is one network message
 *   - reconnection is automatic; `synced('reconnect')` re-binds the seat
 *
 * Room names 'lobby' and 'match' must be declared in gipity.yaml (the
 * `realtime` deploy phase); match *instances* are created freely at runtime.
 */

import { createRealtime, createDirectory } from '@gipity/realtime';

export async function connectFour({ onGames, onState, onSeat }) {
  const rt = createRealtime();

  // --- lobby: the live directory of open games ---
  const lobby = await rt.join('lobby');
  const dir = createDirectory(lobby);
  dir.onChange(() => { dir.sweep(); onGames(dir.list()); });
  onGames(dir.list());

  let match = null;   // current match room handle
  let game = null;    // its 'state' store channel

  function bindMatch(handle) {
    match = handle;
    game = match.channel('state', { sync: 'store' });
    game.onChange(() => onState(game.get('game')));
    // create -> seat 1; join -> claim a seat; reconnect -> re-bind the old seat.
    match.on('synced', ({ kind }) => onSeat(kind, match.getSessionId()));
  }

  return {
    rt,

    /** Host a new game: open a match room and advertise it in the lobby. */
    async host(name) {
      bindMatch(await rt.create('match'));
      dir.publish(name, { name, roomId: match.getRoomId(), status: 'open' });
      return game;
    },

    /** Join an advertised game by its room id. */
    async join(entry) {
      bindMatch(await rt.joinById(entry.roomId, 'match'));
      return game;
    },

    /** Write the whole game state - one key, so one move = one message. */
    setState(next) { game?.set('game', next); },

    /** Leave the current match. The lobby connection stays open. */
    leave() {
      if (match) { match.disconnect(); match = null; game = null; }
    },
  };
}
