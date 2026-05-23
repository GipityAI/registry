/**
 * @gipity/realtime - No-op adapter (reference)
 *
 * Every capability section as a safe no-op. Useful for `messages`-only
 * channels, solo/offline mode, or as a base to spread your own overrides
 * onto. `normalizeAdapter()` applies these same defaults internally, so an
 * app only ever implements the methods it actually needs.
 */

import { NOOP_PRESENCE, NOOP_ENTITIES, NOOP_AUTHORITY } from '../lib/context.js';

export const noopAdapter = {
  presence: { ...NOOP_PRESENCE },
  entities: { ...NOOP_ENTITIES },
  authority: { ...NOOP_AUTHORITY },
};

export { NOOP_PRESENCE, NOOP_ENTITIES, NOOP_AUTHORITY };
