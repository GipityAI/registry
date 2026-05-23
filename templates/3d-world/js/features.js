/**
 * 3D World - Features Module
 * Opt-in gameplay features that games enable via config.features.
 *
 * Usage in config.js:
 *   features: { 'rocket-launcher': true }            // enable with defaults
 *   features: { 'rocket-launcher': { speed: 200 } }  // enable with overrides
 *   features: { 'multiplayer': true }                // basic multiplayer
 *   features: { 'multiplayer': false }               // solo mode (no network)
 *
 * Order: features in PRIORITY_FEATURES init first so transport-level
 * features (multiplayer) are ready before gameplay features that depend
 * on them (rocket-launcher's `network.channel` registrations).
 */

// Dynamic import map - feature modules only loaded when enabled
const featureLoaders = {
  'multiplayer': () => import('./features/multiplayer.js'),
  'rocket-launcher': () => import('./features/rocket-launcher.js'),
};

// Features that must init before others (e.g. transport before gameplay).
// Order within this list is honored.
const PRIORITY_FEATURES = ['multiplayer'];

const active = new Map(); // name → instance

/**
 * Initialize enabled features. Called during boot, after gameInit.
 * @param {Object} featureConfig - e.g. { 'rocket-launcher': true, 'multiplayer': true }
 * @param {Object} deps - template module references
 */
export async function initFeatures(featureConfig, deps) {
  if (!featureConfig) return;
  const entries = Object.entries(featureConfig);
  // Sort: priority features first, in PRIORITY_FEATURES order; then rest
  // in declaration order.
  const priority = PRIORITY_FEATURES
    .map(name => entries.find(([n]) => n === name))
    .filter(Boolean);
  const rest = entries.filter(([n]) => !PRIORITY_FEATURES.includes(n));
  const ordered = [...priority, ...rest];

  for (const [name, config] of ordered) {
    if (!config) continue; // false/null/undefined = disabled
    const loader = featureLoaders[name];
    if (!loader) {
      console.warn(`[Features] Unknown feature: "${name}". Available: ${Object.keys(featureLoaders).join(', ')}`);
      continue;
    }
    const mod = await loader();
    const settings = config === true ? {} : config;
    const instance = mod.create({ ...mod.DEFAULTS, ...settings }, deps);
    await instance.init();
    active.set(name, instance);
    console.log(`[Features] Enabled: ${name}`);
  }
}

/** Called every frame from the game loop. */
export function updateFeatures(dt) {
  for (const inst of active.values()) inst.update(dt);
}

/** Get a feature instance by name, or null if not enabled. */
export function get(name) { return active.get(name) || null; }

/** Check if a feature is enabled. */
export function isEnabled(name) { return active.has(name); }
