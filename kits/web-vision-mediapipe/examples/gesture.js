/**
 * Example: gesture recognition.
 *
 * `mountVision` wires the camera, the inference loop, and the canvas overlay.
 * The model recognises a fixed set of poses (Closed_Fist, Open_Palm, Victory,
 * Thumb_Up, Thumb_Down, Pointing_Up, ILoveYou - see GESTURES) and reports 21
 * hand landmarks per hand.
 *
 * There are two ways to act on a gesture, and picking the right one is most of
 * the work:
 *
 *   PUSH - `onGesture(name)` fires once, the moment a pose settles. Use it when
 *   the *hand* decides when something happens: a thumbs-up that likes a photo,
 *   an open palm that pauses a video.
 *
 *   PULL - `vision.gesture()` returns the pose the hand is holding right now.
 *   Use it when *your app* decides when something happens - anything on a clock,
 *   a countdown, a round, a shutter. `playRound` below is that shape.
 *
 * Reach for `onResult` only when you need the raw landmarks.
 */

import { mountVision } from '@gipity/web-vision-mediapipe';

const MOVES = { Closed_Fist: 'rock', Open_Palm: 'paper', Victory: 'scissors' };
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startGestureDemo(video, canvas, hud) {
  const vision = await mountVision({
    video,
    canvas,
    kind: 'gesture',
    onFps: (fps) => { hud.textContent = `${fps} FPS`; },
  });

  /**
   * One round of rock paper scissors: count the player in, then read whatever
   * their hand has settled on at "shoot".
   *
   * Sampling with `vision.gesture()` is what makes a *round* work. Stashing the
   * last `onGesture` event in a variable looks like the same thing and isn't -
   * that callback deliberately won't fire again while the hand is unchanged, so
   * a player throwing rock twice running would have their second round scored
   * off the first round's stale event.
   */
  async function playRound(say) {
    for (const n of ['3...', '2...', '1...', 'Shoot!']) {
      say(n);
      await sleep(700);
    }
    const thrown = MOVES[vision.gesture()];
    if (!thrown) return say("Couldn't see your hand - try again");

    const cpu = ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)];
    const outcome = thrown === cpu ? 'draw' : BEATS[thrown] === cpu ? 'you win' : 'you lose';
    say(`you: ${thrown} - computer: ${cpu} - ${outcome}`);
    return outcome;
  }

  return { vision, playRound }; // call vision.stop() to release the camera
}
