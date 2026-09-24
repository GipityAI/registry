/**
 * Example: object detection, composed from the low-level pieces.
 *
 * Use this shape when you want control over the loop - here, only running
 * the kit's own draw helper and reading detections out for app logic.
 * `efficientdet_lite0` detects the 80 COCO classes (person, cup, laptop...).
 */

import {
  createTask, startCamera, createLoop,
  fitCanvas, clearCanvas, drawDetections,
} from '@gipity/web-vision-mediapipe';

export async function startDetectDemo(video, canvas, hud) {
  const ctx = canvas.getContext('2d');
  const cam = await startCamera(video, { facingMode: 'environment' });
  const task = await createTask('detect', { scoreThreshold: 0.5 });

  const loop = createLoop({
    video,
    detect: (v, ts) => task.detect(v, ts),
    onFrame: (result, fps) => {
      fitCanvas(canvas, video);
      clearCanvas(ctx);
      drawDetections(ctx, result);
      hud.textContent = `${fps} FPS - ${result.detections?.length ?? 0} objects`;
    },
  });
  loop.start();

  return {
    stop() { loop.stop(); task.close(); cam.stop(); },
  };
}
