/**
 * Example: bring your own custom-trained model.
 *
 * Train on Roboflow / Ultralytics / anywhere, export to ONNX, host the file
 * on any CORS-enabled URL (your app's own files/ works), and pass a model
 * spec instead of a preset name.
 *
 * Two formats are supported:
 * - format: 'yolox'  - official YOLOX exports (undecoded head, BGR 0-255)
 * - format: 'yolo'   - Ultralytics YOLOv8/v11 `model.export(format='onnx')`
 *                      (decoded head [1, 4+C, N], RGB 0-1)
 *
 * License note: YOLOX is Apache-2.0. Ultralytics models are AGPL-3.0 -
 * loading one here is your licensing call, not something the kit ships.
 */

import { mountDetect } from '@gipity/web-vision-detect';

export async function startCustomModelDemo(video, canvas) {
  return mountDetect({
    video,
    canvas,
    model: {
      url: './models/my-detector.onnx',   // your hosted export
      format: 'yolo',                     // 'yolox' | 'yolo'
      inputSize: 640,                     // the size you exported with
      labels: ['helmet', 'no-helmet'],    // your classes, in training order
    },
    scoreThreshold: 0.4,
  });
}
