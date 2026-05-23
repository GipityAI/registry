// Project configuration
export const config = {
  title: '{{TITLE}}',
  description: '',
  author: '',
  version: 1,
  preload: [],  // Asset names to preload: ['tree-oak', 'coin']
  // Features are opt-in. Toggle on/off or pass a config object per feature.
  // Multiplayer is built in via the feature plugin - flip to false for solo.
  features: {
    'multiplayer': { room: '{{ROOM_SLUG}}' },
  },
};
