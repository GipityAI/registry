/**
 * Example: one screen, phones as controllers (a couch / party game).
 *
 * A TV or laptop page runs the game and hosts the table; up to N phones scan a
 * QR code and send button presses. The screen is the single source of truth.
 *
 *   - The screen calls party.host(): it holds the room's HOST ROLE. It is
 *     not a player, but its page still takes one of the room's seats, so
 *     seats and max_clients are phones + 1. A reload of the screen page
 *     resumes the same table (same code, phones still seated) and takes the
 *     role back.
 *   - Phones join from the QR code's invite URL and sendToHost(): inputs go to
 *     the screen only, never to the other phones.
 *   - Every input arrives with a server-stamped senderId (trustworthy) and a
 *     sentAt in server-clock ms, so the screen can measure input age.
 *   - A phone that reloads is a new session; its clientId (stable per browser)
 *     lets the screen give it its old seat back. A phone whose page crashed
 *     resumes its held session instead, even at a full table.
 *
 * gipity.yaml, realtime phase: provision `lobby` and `match`, with the match
 * room sized for the screen plus the phones and the holds you want:
 *
 *   - name: match
 *     room_type: state
 *     max_clients: 9           # the screen + 8 phones
 *     seat_hold_seconds: 30    # a dropped phone keeps its seat
 *     host_hold_seconds: 60    # a dropped or reloading screen keeps the host role
 *
 * Measure it live: gipity realtime bench match --clients 8 --rate 20
 */

import { createRealtime, createParty } from '@gipity/realtime';

const PHONES = 8;

/** The screen: host the table, map phones to seats, apply inputs. */
export async function screen({ onShare, onSeats, onInput, onLatency }) {
  const rt = createRealtime();
  const party = createParty(rt, { seats: PHONES + 1 });
  const table = await party.host({ host: 'Screen' });
  onShare(table.inviteUrl, table.code);                 // render as a QR code + code

  const seats = new Map();      // clientId -> seat number
  const sessions = new Map();   // session id -> clientId
  function seatFor(sid) {
    const clientId = table.room.peerInfo(sid)?.clientId || sid;
    sessions.set(sid, clientId);
    if (!seats.has(clientId)) {
      const used = new Set(seats.values());
      for (let s = 0; s < PHONES; s++) if (!used.has(s)) { seats.set(clientId, s); break; }
    }
    return seats.get(clientId);
  }
  table.onPeerJoin((sid) => { seatFor(sid); onSeats(new Map(seats)); });
  table.onPeerLeave((sid) => {
    // Gone for good (clean leave, or the seat hold ran out). A reloading
    // phone comes back with the same clientId and gets its seat again.
    const clientId = sessions.get(sid);
    sessions.delete(sid);
    if (clientId && ![...sessions.values()].includes(clientId)) seats.delete(clientId);
    onSeats(new Map(seats));
  });

  const input = table.channel('input');
  const ages = [];
  input.on('press', (m) => {
    onInput(seatFor(m.senderId), m.key, m.down);
    if (typeof m.sentAt === 'number') {
      ages.push(table.room.serverNow() - m.sentAt);
      if (ages.length === 200) { onLatency(summarize(ages)); ages.length = 0; }
    }
  });

  return {
    table,
    /** Tell one phone something (e.g. "you were knocked out" -> vibrate). */
    tell(sid, type, data) { input.send(type, data, { to: sid }); },
  };
}

/** A phone: join from the QR code's URL and send presses to the screen. */
export async function phone({ onTell, onStatus }) {
  const rt = createRealtime();
  const party = createParty(rt, { seats: PHONES + 1 });
  let table;
  try {
    table = await party.joinFromUrl();
  } catch (err) {
    onStatus(err.code === 'full' ? 'This game is full.' : 'That game has ended.');
    return null;
  }
  if (!table) { onStatus('Scan the code on the screen to join.'); return null; }
  const input = table.channel('input');
  input.on('vibrate', (m) => onTell('vibrate', m));
  return {
    press(key) { input.sendToHost('press', { key, down: true }); },
    release(key) { input.sendToHost('press', { key, down: false }); },
    rtt: () => table.room.rtt(),
  };
}

function summarize(values) {
  const s = [...values].sort((a, b) => a - b);
  const at = (q) => Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]);
  return { p50: at(0.5), p95: at(0.95), max: s[s.length - 1] };
}
