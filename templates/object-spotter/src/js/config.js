// App configuration - identity and camera/detection defaults.
// Import: import { config } from './config.js';

export const config = {
  title: '{{JS_TITLE}}',

  // Camera: 'environment' (rear - good for pointing at objects) or
  // 'user' (front-facing - mirrored).
  facingMode: 'environment',

  // Model shown first. One of the keys in `models` below.
  defaultModel: 'nano',

  // The model switcher - order and labels of the bottom buttons.
  // Each `key` must be a preset the kit supports: nano | tiny | s.
  models: [
    { key: 'nano', label: 'Fast' },
    { key: 'tiny', label: 'Balanced' },
    { key: 's', label: 'Sharp' },
  ],

  // Minimum confidence (0..1) for a detection to count.
  scoreThreshold: 0.5,
};
