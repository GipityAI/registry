/**
 * Unit tests for the leaderboard kit's pure rules (functions/_lib/leaderboard/core.js).
 * Run: node kits/leaderboard/tests/core.test.js
 *
 * The functions themselves are verified end-to-end against a deployed app's
 * real database; see VERIFY.md.
 */
import assert from 'node:assert/strict';
import { isoWeek, periodKey, periodKind, boardPeriods, submissionPeriods, resolvePeriod, isBetter, rankOrderSql, aheadSql, base64Bytes, clampInt, validateSubmission, parseVersion, compareVersions, checkGameVersion, SubmissionError } from '../functions/_lib/leaderboard/core.js';
import { purgePlayer } from '../functions/_lib/leaderboard/purge.js';

let failed = 0;
const pending = [];
function test(name, fn) {
  const done = (err) => { if (err) { failed++; console.log(`FAIL ${name}\n     ${err.message}`); } else console.log(`ok   ${name}`); };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(() => done(), done));
    else done();
  } catch (err) { done(err); }
}

const board = (over = {}) => ({ sort: 'asc', min_score: 10000, max_score: 600000, splits: 3, rulesets: ['official-1'], max_ghost_bytes: 64, ...over });
const ok = (over = {}) => ({ score: 31250, ruleset: 'official-1', splits: [10400, 21010, 31250], ...over });
const rejects = (b, body, re) => assert.throws(() => validateSubmission(b, body), re);

test('isoWeek follows ISO-8601 year boundaries', () => {
  assert.equal(isoWeek(new Date('2026-09-28T12:00:00Z')), '2026-W40');
  assert.equal(isoWeek(new Date('2027-01-01T00:00:00Z')), '2026-W53'); // Friday belongs to the prior ISO year
  assert.equal(isoWeek(new Date('2024-12-30T00:00:00Z')), '2025-W01'); // Monday belongs to the next ISO year
});

const NOW = new Date('2026-09-28T12:00:00Z');

test('periodKey for every kind', () => {
  assert.equal(periodKey('all', NOW), 'all');
  assert.equal(periodKey('day', NOW), '2026-09-28');
  assert.equal(periodKey('week', NOW), '2026-W40');
  assert.equal(periodKey('month', NOW), '2026-09');
  assert.equal(periodKey('season', NOW, 'Summer Cup'), 'season:Summer Cup');
  assert.equal(periodKey('season', NOW, null), null);
  assert.throws(() => periodKey('year', NOW), /Unknown period kind/);
});

test('periodKind recognizes stored keys', () => {
  assert.deepEqual(['all', '2026-09-28', '2026-W40', '2026-09', 'season:S1', 'nope'].map(periodKind),
    ['all', 'day', 'week', 'month', 'season', null]);
});

test('boards keep all + week by default, in a fixed order', () => {
  assert.deepEqual(boardPeriods({}), ['all', 'week']);
  assert.deepEqual(boardPeriods({ periods: ['season', 'day', 'all'] }), ['all', 'day', 'season']);
});

test('a submission counts toward every period the board keeps; no running season skips it', () => {
  const b = { periods: ['all', 'day', 'week', 'month', 'season'] };
  assert.deepEqual(submissionPeriods(b, NOW, 'S1').map(p => p.key), ['all', '2026-09-28', '2026-W40', '2026-09', 'season:S1']);
  assert.deepEqual(submissionPeriods(b, NOW, null).map(p => p.kind), ['all', 'day', 'week', 'month']);
});

test('resolvePeriod: kinds, explicit keys, defaults, and readable refusals', () => {
  const weekly = { periods: ['all', 'week'] };
  assert.equal(resolvePeriod(undefined, weekly, NOW), 'all');
  assert.equal(resolvePeriod('week', weekly, NOW), '2026-W40');
  assert.equal(resolvePeriod('2026-W01', weekly, NOW), '2026-W01');
  assert.throws(() => resolvePeriod('day', weekly, NOW), /doesn't keep day rankings. This board keeps: all, week/);
  assert.throws(() => resolvePeriod("all'; DROP TABLE lb_entries;--", weekly, NOW), /Unknown period/);
  const daily = { periods: ['day'] };
  assert.equal(resolvePeriod(undefined, daily, NOW), '2026-09-28');
  const seasonal = { periods: ['season'] };
  assert.equal(resolvePeriod('season', seasonal, NOW, 'S2'), 'season:S2');
  assert.equal(resolvePeriod('season:S1', seasonal, NOW, 'S2'), 'season:S1');
  assert.throws(() => resolvePeriod('season', seasonal, NOW, null), /No season is running/);
});

test('isBetter: score by the board sort, then the tiebreak, and a full tie never replaces', () => {
  const times = { sort: 'asc' };
  assert.equal(isBetter(times, { score: 100 }, { score: 200 }), true);
  assert.equal(isBetter(times, { score: 200 }, { score: 100 }), false);
  assert.equal(isBetter(times, { score: 100 }, { score: 100 }), false);
  const points = { sort: 'desc', tiebreak_sort: 'asc' };  // most points, then fastest
  assert.equal(isBetter(points, { score: 900, tiebreak: 90 }, { score: 800, tiebreak: 10 }), true);
  assert.equal(isBetter(points, { score: 900, tiebreak: 50 }, { score: 900, tiebreak: 60 }), true);
  assert.equal(isBetter(points, { score: 900, tiebreak: 60 }, { score: 900, tiebreak: 50 }), false);
  assert.equal(isBetter(points, { score: 900, tiebreak: 50 }, { score: 900, tiebreak: 50 }), false);
});

test('ranking SQL is whitelisted and includes the tiebreak only when the board has one', () => {
  assert.equal(rankOrderSql({ sort: 'asc' }), 'e.score ASC');
  assert.equal(rankOrderSql({ sort: 'desc', tiebreak_sort: 'asc' }), 'e.score DESC, e.tiebreak ASC NULLS LAST');
  assert.equal(rankOrderSql({ sort: 'x; DROP', tiebreak_sort: 'y' }), 'e.score ASC, e.tiebreak ASC NULLS LAST');
  assert.equal(aheadSql({ sort: 'asc' }), '(o.score < e.score)');
  assert.equal(aheadSql({ sort: 'desc', tiebreak_sort: 'asc' }), '(o.score > e.score OR (o.score = e.score AND o.tiebreak < e.tiebreak))');
});

test('base64Bytes measures decoded size and rejects non-base64', () => {
  assert.equal(base64Bytes('AAAA'), 3);
  assert.equal(base64Bytes('AAA='), 2);
  assert.equal(base64Bytes('AA=='), 1);
  assert.equal(base64Bytes('AAA'), null);
  assert.equal(base64Bytes('AA A'), null);
  assert.equal(base64Bytes(''), null);
});

test('clampInt bounds page sizes', () => {
  assert.equal(clampInt('500', 10, 1, 100), 100);
  assert.equal(clampInt('-4', 10, 1, 100), 1);
  assert.equal(clampInt('abc', 10, 1, 100), 10);
});

test('a plausible run passes and is normalized', () => {
  const r = validateSubmission(board(), ok({ gameVersion: 1.2, meta: { car: 'red' } }));
  assert.equal(r.score, 31250);
  assert.equal(r.gameVersion, '1.2');
  assert.deepEqual(r.meta, { car: 'red' });
  assert.equal(r.ghost, null);
});

test('score must be an integer inside the board bounds', () => {
  rejects(board(), ok({ score: 31250.5 }), /integer/);
  rejects(board(), ok({ score: '31250' + 'x' }), /integer/);
  rejects(board(), ok({ score: 9999, splits: [3000, 6000, 9999] }), /below this board's minimum/);
  rejects(board(), ok({ score: 600001, splits: [1, 2, 600001] }), /above this board's maximum/);
});

test('only official rulesets count; unrestricted boards take any', () => {
  rejects(board(), ok({ ruleset: 'grip-x2' }), /not an official ruleset/);
  rejects(board(), ok({ ruleset: undefined }), /not an official ruleset/);
  assert.equal(validateSubmission(board({ rulesets: null }), ok({ ruleset: 'anything' })).ruleset, 'anything');
});

test('splits must match the board, increase, and end at the score', () => {
  rejects(board(), ok({ splits: undefined }), /splits must be an array/);
  rejects(board(), ok({ splits: [10400, 31250] }), /expected 3 splits/);
  rejects(board(), ok({ splits: [10400, 10400, 31250] }), /must increase/);
  rejects(board(), ok({ splits: [21010, 10400, 31250] }), /must increase/);
  rejects(board(), ok({ splits: [10400, 21010, 31000] }), /last split must equal the score/);
  rejects(board(), ok({ splits: [-5, 21010, 31250] }), /positive/);
  assert.equal(validateSubmission(board({ splits: null }), ok({ splits: undefined })).splits, null);
});

test('tiebreak is required on tiebreak boards and refused elsewhere', () => {
  const tb = board({ tiebreak_sort: 'asc' });
  assert.equal(validateSubmission(tb, ok({ tiebreak: 42 })).tiebreak, 42);
  rejects(tb, ok(), /tiebreak must be an integer/);
  rejects(tb, ok({ tiebreak: 1.5 }), /tiebreak must be an integer/);
  rejects(board(), ok({ tiebreak: 42 }), /has no tiebreak/);
  assert.equal(validateSubmission(board(), ok()).tiebreak, null);
});

test('ghosts are size-capped base64', () => {
  const r = validateSubmission(board(), ok({ ghost: 'AAAA' }));
  assert.deepEqual(r.ghost, { data: 'AAAA', bytes: 3 });
  rejects(board(), ok({ ghost: 'A'.repeat(88) }), /allows 64/);
  rejects(board(), ok({ ghost: 'not base64!' }), /base64/);
});

test('meta must be a small object', () => {
  rejects(board(), ok({ meta: [1, 2] }), /meta must be an object/);
  rejects(board(), ok({ meta: { big: 'x'.repeat(3000) } }), /under 2000/);
});

test('parseVersion: major[.minor[.patch]][-pre][+build], missing parts are 0, garbage is null', () => {
  assert.deepEqual(parseVersion('1.4.2'), { parts: [1, 4, 2], pre: null });
  assert.deepEqual(parseVersion('v2'), { parts: [2, 0, 0], pre: null });
  assert.deepEqual(parseVersion('1.4'), { parts: [1, 4, 0], pre: null });
  assert.deepEqual(parseVersion(' 1.4.2-beta.3+build.77 '), { parts: [1, 4, 2], pre: 'beta.3' });
  assert.deepEqual(parseVersion(1.2), { parts: [1, 2, 0], pre: null });   // a number sent as JSON
  for (const bad of ['', 'latest', '1.x', '1..2', '1.2.3.4', '.1', '1.', '-1', 'v', '1.2.3-', "1'; DROP TABLE lb_entries;--", null, undefined, '9999999999']) {
    assert.equal(parseVersion(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('compareVersions is numeric, not lexical, and a prerelease precedes its release', () => {
  const cmp = (a, b) => Math.sign(compareVersions(parseVersion(a), parseVersion(b)));
  assert.equal(cmp('1.10.0', '1.9.0'), 1);          // lexical compare gets this wrong
  assert.equal(cmp('1.4', '1.4.0'), 0);
  assert.equal(cmp('v1.4.0', '1.4.0+build.9'), 0);  // build metadata is ignored
  assert.equal(cmp('2.0.0', '10.0.0'), -1);
  assert.equal(cmp('1.2.0-beta', '1.2.0'), -1);
  assert.equal(cmp('1.2.0-beta.2', '1.2.0-beta.10'), -1);
  assert.equal(cmp('1.2.0-alpha', '1.2.0-beta'), -1);
  assert.equal(cmp('1.2.0-1', '1.2.0-alpha'), -1);  // numeric identifiers sort first
  assert.equal(cmp('1.2.0-beta', '1.2.0-beta.1'), -1);
  assert.equal(cmp('1.1.9', '1.2.0-beta'), -1);
});

test('min_game_version refuses missing, garbage and older versions with a code the client can show', () => {
  const b = board({ min_game_version: '1.4.2' });
  const code = (body) => { try { validateSubmission(b, body); return 'accepted'; } catch (err) { return err.code ?? err.message; } };
  assert.equal(code(ok({ gameVersion: '1.4.2' })), 'accepted');
  assert.equal(code(ok({ gameVersion: '1.10' })), 'accepted');
  assert.equal(code(ok({ gameVersion: 'v2.0.0-rc.1' })), 'accepted');
  assert.equal(code(ok({ gameVersion: '1.4.1' })), 'GAME_VERSION_TOO_OLD');
  assert.equal(code(ok({ gameVersion: '1.4.2-beta' })), 'GAME_VERSION_TOO_OLD');
  assert.equal(code(ok({ gameVersion: '1.4' })), 'GAME_VERSION_TOO_OLD');
  assert.equal(code(ok()), 'GAME_VERSION_TOO_OLD');
  assert.equal(code(ok({ gameVersion: '  ' })), 'GAME_VERSION_TOO_OLD');
  assert.equal(code(ok({ gameVersion: 'latest' })), 'GAME_VERSION_INVALID');
  assert.throws(() => validateSubmission(b, ok({ gameVersion: '1.3.9' })), /update to 1\.4\.2 or newer/);
  assert.ok((() => { try { checkGameVersion(b, '0.9'); } catch (err) { return err instanceof SubmissionError; } })());
});

test('boards without min_game_version take any version or none; a bad minimum is an owner error', () => {
  assert.equal(validateSubmission(board(), ok()).gameVersion, null);
  assert.equal(validateSubmission(board(), ok({ gameVersion: 'nightly' })).gameVersion, 'nightly');
  assert.throws(() => validateSubmission(board({ min_game_version: 'one' }), ok({ gameVersion: '1.0' })), (err) => err.code === 'BOARD_MISCONFIGURED');
});

// A stand-in for the function runtime's db: records each statement so the test
// can check what purgePlayer deletes, scoped to one player. The SQL itself runs
// against a real database in tests/e2e.mjs.
function fakeDb(ghostRows) {
  const calls = [];
  const db = {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (sql.startsWith('SELECT DISTINCT ghost_id')) return { rows: ghostRows, rowCount: ghostRows.length };
      return { rows: [], rowCount: 2 };
    },
  };
  db.tx = async (fn) => { calls.push({ sql: 'BEGIN' }); const r = await fn(db); calls.push({ sql: 'COMMIT' }); return r; };
  return db;
}

test('purgePlayer deletes one player\'s entries, submissions and ban in a transaction, and prunes only their orphaned ghosts', async () => {
  const db = fakeDb([{ ghost_id: 'gho_a' }, { ghost_id: 'gho_b' }]);
  const r = await purgePlayer(db, 'u_victim');
  assert.deepEqual(r, { entries: 2, submissions: 2, bans: 2, ghosts: 2 });
  assert.equal(db.calls[0].sql, 'BEGIN');
  assert.equal(db.calls.at(-1).sql, 'COMMIT');
  const deletes = db.calls.filter(c => c.sql.startsWith('DELETE'));
  assert.deepEqual(deletes.slice(0, 3).map(c => [c.sql.split(' ')[2], c.params]), [
    ['lb_entries', ['u_victim']], ['lb_submissions', ['u_victim']], ['lb_bans', ['u_victim']],
  ]);
  assert.match(deletes[3].sql, /DELETE FROM lb_ghosts g WHERE g.id = ANY\(\$1\) AND NOT EXISTS/);
  assert.deepEqual(deletes[3].params, [['gho_a', 'gho_b']]);
});

test('purgePlayer with no ghosts skips the ghost prune', async () => {
  const db = fakeDb([]);
  const r = await purgePlayer(db, 'u_clean');
  assert.equal(r.ghosts, 0);
  assert.equal(db.calls.filter(c => c.sql.includes('lb_ghosts g')).length, 0);
});

await Promise.all(pending);
if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
