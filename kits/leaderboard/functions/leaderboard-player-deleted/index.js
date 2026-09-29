// Leaderboard kit - runs when a player erases their account. Declared with
// `hooks: [user_deleted]`, so the platform calls it with ctx.trigger set before
// it deletes the player; if this fails, the player is not deleted and the
// delete can be retried. auth: member, and it refuses any call the platform
// didn't trigger, so nobody can erase another player through it.
// To erase a player by hand, use leaderboard-admin { action: 'purge' }.
// Kit-owned (sealed).
import { purgePlayer } from '../_lib/leaderboard/purge.js';

export default async function leaderboardPlayerDeleted(ctx, { db }) {
  const trigger = ctx.trigger;
  if (!trigger || trigger.type !== 'user_deleted' || !trigger.userGuid) {
    return { error: "This runs when a player is deleted. To erase a player by hand, call leaderboard-admin with { action: 'purge', userGuid }." };
  }
  const purged = await purgePlayer(db, String(trigger.userGuid));
  return { purged: trigger.userGuid, ...purged };
}
