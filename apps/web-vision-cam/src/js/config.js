// App configuration - identity and camera/vision defaults.
// Import: import { config } from './config.js';

export const config = {
  title: '{{JS_TITLE}}',

  // Camera: 'user' (front-facing - mirrored, good for gesture/pose on a
  // laptop) or 'environment' (rear - good for pointing at objects).
  facingMode: 'user',

  // Task shown first. One of the keys in `tasks` below.
  defaultTask: 'gesture',

  // The task switcher - order and labels of the bottom buttons.
  // Each `kind` must be a task the kit supports: gesture | detect | pose.
  tasks: [
    { kind: 'gesture', label: 'Gesture' },
    { kind: 'detect', label: 'Objects' },
    { kind: 'pose', label: 'Pose' },
  ],
};
