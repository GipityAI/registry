// Project configuration
export const config = {
  title: '{{TITLE}}',
  description: '',
  author: '',
  version: 1,
  preload: [],  // Asset names to preload: ['tree-oak', 'coin']
  // Features are opt-in. Toggle on/off or pass a config object per feature.
  // For solo offline games, set 'multiplayer': false.
  features: {
    // Host-authoritative world sync: one client owns the block world and
    // every joiner is synced onto it, so all players share one scene. Set
    // sync.worldState false for games where each client owns its own scene.
    'multiplayer': { room: '{{ROOM_SLUG}}', sync: { worldState: true } },
    'rocket-launcher': true,
  },
};
