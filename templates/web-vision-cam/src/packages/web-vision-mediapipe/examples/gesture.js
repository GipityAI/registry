/**
 * Example: gesture recognition.
 *
 * The lowest-effort shape - `mountVision` wires the camera, the inference
 * loop, and the canvas overlay. The gesture model recognises a fixed set of
 * hand poses (Thumb_Up, Thumb_Down, Open_Palm, Closed_Fist, Victory,
 * Pointing_Up, ILoveYou) and reports 21 hand landmarks per hand.
 */

import { mountVision } from '@gipity/web-vision-mediapipe';

export async function startGestureDemo(video, canvas, hud) {
  const vision = await mountVision({
    video,
    canvas,
    kind: 'gesture',
    onFps: (fps) => { hud.textContent = `${fps} FPS`; },
    onResult: (result) => {
      // result.gestures[handIndex][0] -> { categoryName, score }
      const top = result.gestures?.[0]?.[0];
      if (top) console.log('gesture:', top.categoryName, top.score.toFixed(2));
    },
  });
  return vision; // call vision.stop() to release the camera
}
