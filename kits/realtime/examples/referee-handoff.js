/**
 * Example: a phone hosts and referees the match, and the role survives it.
 *
 * One page holds the table's host role and runs the referee (seat list,
 * timers, who beat whom). When that page goes away (a phone locks its screen,
 * takes a call, runs out of battery) the server hands the role to another
 * player's page, which rebuilds the referee from the last checkpoint. Every
 * player's own board keeps running on their own device the whole time.
 *
 *   - The host opts in with host({ handoff: true }) and checkpoints twice a
 *     second and on every important event (last write wins, <= 64 KB).
 *   - Players who can take over join with { canHost: true }.
 *   - onHostChange tells every page who hosts now; only the new host gets the
 *     checkpoint. isHost() is always current.
 *   - A page that wakes up after losing the role is a player: whatever it
 *     sent as the old host was dropped by the server ('undelivered',
 *     reason 'stale-host').
 *   - A new host asks everyone to resend their state ('resync'): the
 *     checkpoint can be a moment old, and a player whose last update landed
 *     between hosts would never send it again on its own.
 *   - table.leave() from the host hands the role on at once (reason 'left');
 *     a reload keeps the grace, and table.cancel() ends the table.
 *
 * gipity.yaml, realtime phase:
 *
 *   - name: match
 *     room_type: state
 *     max_clients: 8
 *     seat_hold_seconds: 30
 *     host_hold_seconds: 60     # nobody could take over: wait this long for the host
 *     host_grace_seconds: 5     # the host may be unreachable this long before the role moves
 */

import { createRealtime, createParty } from '@gipity/realtime';

/** A referee is plain state plus rules; it must be rebuildable from a snapshot. */
function createReferee(saved) {
  const state = saved ?? { seats: [], round: 1, scores: {} };
  return {
    state,
    snapshot: () => structuredClone(state),
    score(sid, points) { state.scores[sid] = (state.scores[sid] || 0) + points; },
    restate(sid, total) { state.scores[sid] = total; },
  };
}

export async function play({ name, hosting, onHost, onScores }) {
  const party = createParty(createRealtime(), { seats: 8 });
  const table = hosting
    ? await party.host({ host: name, handoff: true })
    : await party.joinFromUrl({ canHost: true });
  const events = table.channel('game');

  let referee = null;          // non-null while this page holds the role
  let checkpointTimer = null;
  let myTotal = 0;             // this player's own state, resent on 'resync'

  function publishScores() {
    events.send('scores', referee.state.scores);
    onScores(referee.state.scores);                 // a sender never hears its own broadcast
  }
  // Also runs for the first host (onHostChange replays the current host at
  // once), and for a host page that reloaded (it gets its own checkpoint back).
  function becomeReferee(checkpoint) {
    referee = createReferee(checkpoint?.data);
    checkpointTimer = setInterval(() => table.setCheckpoint(referee.snapshot()), 500);
    events.send('resync', {});                      // players resend what the checkpoint may miss
    publishScores();                                // everyone resyncs from the new referee
  }

  table.onHostChange(({ isMe, reason, checkpoint }) => {
    onHost({ isMe, reason });
    if (isMe && !checkpointTimer) becomeReferee(checkpoint);
    if (!isMe && checkpointTimer) { clearInterval(checkpointTimer); checkpointTimer = null; referee = null; }
  });

  // Players report to the referee, wherever it is now.
  events.on('points', (m) => {
    if (!table.isHost()) return;
    referee.score(m.senderId, m.points);
    table.setCheckpoint(referee.snapshot());        // an important event: checkpoint now
    publishScores();
  });
  events.on('state', (m) => {
    if (!table.isHost()) return;
    referee.restate(m.senderId, m.total);
    publishScores();
  });
  // Only the current host's messages carry its epoch; ignore anything else.
  events.on('resync', (m) => {
    if (m.hostEpoch === table.hostEpoch()) events.sendToHost('state', { total: myTotal });
  });
  events.on('scores', (m) => { if (m.hostEpoch === table.hostEpoch()) onScores(m); });

  return {
    table,
    addPoints(points) { myTotal += points; events.sendToHost('points', { points }); },
    /** Leaving on purpose: a host hands the role on at once (reason 'left'). */
    leave() { table.leave(); },
  };
}
