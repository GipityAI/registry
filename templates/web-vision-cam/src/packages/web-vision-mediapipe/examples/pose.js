/**
 * Example: body pose, with live task switching.
 *
 * `mountVision` keeps one camera + loop running while you swap the model -
 * cheap enough to wire to a UI toggle. The pose model reports 33 body
 * landmarks (shoulders, elbows, hips, knees, ...) per detected person.
 */

import { mountVision } from '@gipity/web-vision-mediapipe';

export async function startPoseDemo(video, canvas, hud) {
  const vision = await mountVision({
    video,
    canvas,
    kind: 'pose',
    onFps: (fps) => { hud.textContent = `${fps} FPS - ${vision.currentTask()}`; },
  });

  // Swap models without restarting the camera:
  //   await vision.switchTask('gesture');
  //   await vision.switchTask('detect');
  return vision;
}
