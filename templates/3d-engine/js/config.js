// Project configuration
export const config = {
  title: '{{TITLE}}',
  description: '',
  author: '',
  version: 1,
  preload: [],  // Asset names to preload: ['tree-oak', 'coin']
  // Features are opt-in. Toggle on/off or pass a config object per feature.
  // Multiplayer is built in via the feature plugin - flip to false for solo.
  // That one edit is the whole solo strip-down: leave gipity.yaml alone (its
  // realtime phase just registers a room name - no server, no cost) and leave
  // packages/realtime/ in place.
  features: {
    'multiplayer': { room: '{{ROOM_SLUG}}' },
  },
};
