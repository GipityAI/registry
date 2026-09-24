/**
 * Example: live camera detection, composed from the low-level pieces.
 *
 * Use this shape when you want control over the loop - here, running the
 * kit's own draw helper and reading detections out for app logic. The
 * default 'nano' model detects the 80 COCO classes (person, cup, laptop...).
 */

import {
  createDetector, startCamera, createLoop,
  fitCanvas, clearCanvas, drawDetections,
} from '@gipity/web-vision-detect';

export async function startCameraDemo(video, canvas, hud) {
  const ctx = canvas.getContext('2d');
  const cam = await startCamera(video, { facingMode: 'environment' });
  const detector = await createDetector({ model: 'nano', scoreThreshold: 0.5 });

  const loop = createLoop({
    video,
    detect: (v) => detector.detect(v),
    onFrame: (result, fps) => {
      fitCanvas(canvas, video);
      clearCanvas(ctx);
      drawDetections(ctx, result);
      hud.textContent = `${fps} FPS (${result.backend}) - ${result.detections.length} objects`;
    },
  });
  loop.start();

  return {
    stop() { loop.stop(); detector.close(); cam.stop(); },
  };
}
