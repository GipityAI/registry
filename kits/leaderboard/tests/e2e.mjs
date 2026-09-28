/**
 * Live end-to-end test of the leaderboard kit with real players, against a
 * deployed app. Nothing is mocked: real sign-in, real functions, real database.
 *
 *   APP_GUID=p_xxx node kits/leaderboard/tests/e2e.mjs
 *
 * The app needs: the kit installed and deployed, `gipity project auth app` (or
 * `both`), and these boards and season (see VERIFY.md for the migration):
 *   e2e:time     asc, 1000-600000, max_ghost_bytes 256
 *   e2e:points   desc, 0-1000000, max_ghost_bytes 256
 *   e2e:tie      desc, tiebreak_sort asc (most points, then fastest)
 *   e2e:daily    asc, periods {day, month} (no all-time board)
 *   e2e:season   desc, periods {all, season}, plus a season 'E2E Season' running now
 * Each run ranks in its own ruleset, so runs never see each other's entries.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const APP = process.env.APP_GUID;
const BASE = (process.env.GIPITY_API || 'https://a.gipity.ai').replace(/\/$/, '');
if (!APP) { console.error('Set APP_GUID'); process.exit(2); }
const RULESET = `e2e-${Date.now().toString(36)}`;

async function api(method, path, body, token) {
  const res = await fetch(`${BASE}/api/${APP}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json.data, error: json.error };
}
const fn = async (name, body, token) => {
  const r = await api('POST', `/fn/${name}`, body, token);
  if (r.status !== 200) throw new Error(`${name} -> ${r.status} ${JSON.stringify(r.error)}`);
  return r.data;
};

async function guest(name) {
  const r = await api('POST', '/auth/guest', { deviceSecret: randomBytes(24).toString('hex'), displayName: name });
  assert.equal(r.status, 200, JSON.stringify(r.error));
  return { name, token: r.data.token, guid: r.data.user.guid, ref: `guest:${r.data.user.providerUserId}`, id: r.data.user.providerUserId };
}

let failed = 0;
async function test(label, body) {
  try { await body(); console.log(`ok   ${label}`); } catch (err) { failed++; console.log(`FAIL ${label}\n     ${err.message}`); }
}

const players = await Promise.all(['Ada', 'Bo', 'Cy', 'Di', 'Ed'].map(guest));
const [ada, bo, cy, di, ed] = players;
const time = (p, score, extra = {}) => fn('leaderboard-submit', { board: 'e2e:time', ruleset: RULESET, score, ...extra }, p.token);
const top = (board, extra = {}) => fn('leaderboard-read', { action: 'top', board, ruleset: RULESET, ...extra });

await test('five real guest players signed in with distinct guids', async () => {
  assert.equal(new Set(players.map(p => p.guid)).size, 5);
});

await test('the player endpoint and the function runtime agree on who is calling', async () => {
  const me = await api('GET', '/auth/player', undefined, ada.token);
  assert.equal(me.data.guid, ada.guid);
  assert.equal(me.data.provider, 'guest');
});

await test('submissions rank ascending, ties share a rank, and ties keep submission order', async () => {
  await time(ada, 30000);
  await time(bo, 25000);
  await time(cy, 30000);
  await time(di, 40000, { ghost: Buffer.from('ghost-of-di').toString('base64') });
  const r = await top('e2e:time');
  assert.deepEqual(r.entries.map(e => [e.displayName, e.rank, e.score]), [['Bo', 1, 25000], ['Ada', 2, 30000], ['Cy', 2, 30000], ['Di', 4, 40000]]);
  assert.equal(r.total, 4);
});

await test('a slower run keeps the personal best; a faster one moves the player up', async () => {
  const slower = await time(ada, 35000);
  assert.deepEqual([slower.accepted, slower.improved.all, slower.personalBest, slower.rank], [true, false, 30000, 2]);
  const faster = await time(di, 20000);
  assert.deepEqual(faster.improved, { all: true, week: true });
  assert.equal(faster.rank, 1);
  assert.equal(faster.period, 'all');
});

await test('a new best without a ghost replaces a run that had one', async () => {
  const r = await top('e2e:time');
  const diEntry = r.entries.find(e => e.userGuid === di.guid);
  assert.equal(diEntry.hasGhost, false);
});

await test('ghost bytes round-trip', async () => {
  const g = Buffer.from([0, 1, 2, 250, 251, 252]).toString('base64');
  await time(ed, 45000, { ghost: g });
  const entry = (await top('e2e:time')).entries.find(e => e.userGuid === ed.guid);
  assert.equal(entry.hasGhost, true);
  const got = await fn('leaderboard-read', { action: 'ghost', entryId: entry.entryId });
  assert.equal(got.ghost, g);
});

await test('pagination and totals', async () => {
  const page = await top('e2e:time', { limit: 2, offset: 2 });
  assert.deepEqual(page.entries.map(e => e.displayName), ['Ada', 'Cy']);
  assert.equal(page.total, 5);
});

await test('around-me windows on the caller', async () => {
  const r = await fn('leaderboard-read', { action: 'around', board: 'e2e:time', ruleset: RULESET, radius: 1 }, cy.token);
  assert.equal(r.entry.userGuid, cy.guid);
  assert.deepEqual(r.entries.map(e => e.displayName), ['Ada', 'Cy', 'Ed']);
});

await test('me: rank for players with an entry, null for none', async () => {
  const r = await fn('leaderboard-read', { action: 'me', board: 'e2e:time', ruleset: RULESET }, bo.token);
  assert.equal(r.entry.rank, 2);
  const lonely = await guest('Zed');
  const none = await fn('leaderboard-read', { action: 'me', board: 'e2e:time', ruleset: RULESET }, lonely.token);
  assert.equal(none.entry, null);
});

await test('friends: platform ids match players, and the caller is included', async () => {
  const r = await fn('leaderboard-read', { action: 'friends', board: 'e2e:time', ruleset: RULESET, provider: 'guest', ids: [bo.id, ed.id, 'nobody'] }, ada.token);
  assert.deepEqual(r.entries.map(e => e.displayName), ['Bo', 'Ada', 'Ed']);
  assert.equal(r.entries[0].playerRef, bo.ref);
});

await test('weekly board mirrors this week\'s bests', async () => {
  const r = await top('e2e:time', { period: 'week' });
  assert.match(r.period, /^\d{4}-W\d{2}$/);
  assert.equal(r.entries[0].displayName, 'Di');
});

await test('descending boards rank highest first', async () => {
  const pts = (p, score) => fn('leaderboard-submit', { board: 'e2e:points', ruleset: RULESET, score }, p.token);
  await pts(ada, 100); await pts(bo, 900); await pts(cy, 500); await pts(ada, 50);
  const r = await top('e2e:points');
  assert.deepEqual(r.entries.map(e => [e.displayName, e.score]), [['Bo', 900], ['Cy', 500], ['Ada', 100]]);
});

await test('tiebreak: equal points rank by the second number, and a full tie shares a rank', async () => {
  const tie = (p, score, tiebreak) => fn('leaderboard-submit', { board: 'e2e:tie', ruleset: RULESET, score, tiebreak }, p.token);
  await tie(ada, 900, 60);
  await tie(bo, 900, 50);
  await tie(cy, 800, 10);
  const better = await tie(ada, 900, 55);
  assert.equal(better.improved.all, true);
  assert.equal(better.rank, 2);
  await tie(di, 900, 50);
  const r = await top('e2e:tie');
  assert.deepEqual(r.entries.map(e => [e.displayName, e.rank, e.score, e.tiebreak]),
    [['Bo', 1, 900, 50], ['Di', 1, 900, 50], ['Ada', 3, 900, 55], ['Cy', 4, 800, 10]]);
  const missing = await fn('leaderboard-submit', { board: 'e2e:tie', ruleset: RULESET, score: 1 }, ed.token);
  assert.match(missing.reason, /tiebreak must be an integer/);
});

await test('a daily + monthly board has no all-time ranking and defaults to today', async () => {
  const r = await fn('leaderboard-submit', { board: 'e2e:daily', ruleset: RULESET, score: 5000 }, ada.token);
  assert.deepEqual(Object.keys(r.improved), ['day', 'month']);
  assert.match(r.period, /^\d{4}-\d{2}-\d{2}$/);
  const today = await top('e2e:daily');
  assert.equal(today.period, r.period);
  assert.equal(today.entries[0].displayName, 'Ada');
  const month = await top('e2e:daily', { period: 'month' });
  assert.match(month.period, /^\d{4}-\d{2}$/);
  assert.equal(month.total, 1);
  const refused = await top('e2e:daily', { period: 'all' });
  assert.match(refused.error, /doesn't keep all rankings/);
});

await test('season boards rank within the running season', async () => {
  const seasons = await fn('leaderboard-read', { action: 'seasons' });
  assert.equal(seasons.current, 'E2E Season');
  const r = await fn('leaderboard-submit', { board: 'e2e:season', ruleset: RULESET, score: 77 }, bo.token);
  assert.deepEqual(r.improved, { all: true, season: true });
  const s = await top('e2e:season', { period: 'season' });
  assert.equal(s.period, 'season:E2E Season');
  assert.equal(s.entries[0].score, 77);
  const named = await top('e2e:season', { period: 'season:E2E Season' });
  assert.equal(named.total, 1);
});

await test('boards report their periods and tiebreak', async () => {
  const { boards } = await fn('leaderboard-read', { action: 'boards' });
  const byName = Object.fromEntries(boards.map(b => [b.board, b]));
  assert.deepEqual(byName['e2e:daily'].periods, ['day', 'month']);
  assert.equal(byName['e2e:tie'].tiebreak_sort, 'asc');
  assert.deepEqual(byName['e2e:time'].periods, ['all', 'week']);
});

await test('cheat checks reject and explain', async () => {
  const low = await time(ada, 10);
  assert.equal(low.accepted, false);
  assert.match(low.reason, /below this board's minimum/);
  const big = await time(ada, 30000, { ghost: randomBytes(300).toString('base64') });
  assert.match(big.reason, /allows 256/);
});

await test('anonymous callers can read but not submit', async () => {
  const r = await api('POST', '/fn/leaderboard-read', { action: 'top', board: 'e2e:time', ruleset: RULESET });
  assert.equal(r.status, 200);
  const s = await api('POST', '/fn/leaderboard-submit', { board: 'e2e:time', score: 30000 });
  assert.equal(s.status, 401);
});

await test('players cannot moderate', async () => {
  const r = await api('POST', '/fn/leaderboard-admin', { action: 'bans' }, ada.token);
  assert.equal(r.status, 403);
});

await test('a deleted player\'s token stops working', async () => {
  const gone = await guest('Temp');
  assert.equal((await api('DELETE', '/auth/player', undefined, gone.token)).status, 200);
  assert.equal((await api('GET', '/auth/player', undefined, gone.token)).status, 401);
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
