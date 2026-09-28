/**
 * Unit tests for the leaderboard kit's pure rules (functions/_lib/leaderboard/core.js).
 * Run: node kits/leaderboard/tests/core.test.js
 *
 * The functions themselves are verified end-to-end against a deployed app's
 * real database; see VERIFY.md.
 */
import assert from 'node:assert/strict';
import { isoWeek, resolvePeriod, isBetter, orderSql, base64Bytes, clampInt, validateSubmission } from '../functions/_lib/leaderboard/core.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); } catch (err) { failed++; console.log(`FAIL ${name}\n     ${err.message}`); }
}

const board = (over = {}) => ({ sort: 'asc', min_score: 10000, max_score: 600000, splits: 3, rulesets: ['official-1'], max_ghost_bytes: 64, ...over });
const ok = (over = {}) => ({ score: 31250, ruleset: 'official-1', splits: [10400, 21010, 31250], ...over });
const rejects = (b, body, re) => assert.throws(() => validateSubmission(b, body), re);

test('isoWeek follows ISO-8601 year boundaries', () => {
  assert.equal(isoWeek(new Date('2026-09-28T12:00:00Z')), '2026-W40');
  assert.equal(isoWeek(new Date('2027-01-01T00:00:00Z')), '2026-W53'); // Friday belongs to the prior ISO year
  assert.equal(isoWeek(new Date('2024-12-30T00:00:00Z')), '2025-W01'); // Monday belongs to the next ISO year
});

test('resolvePeriod: all, week, explicit key; junk is refused', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  assert.equal(resolvePeriod(undefined, now), 'all');
  assert.equal(resolvePeriod('all', now), 'all');
  assert.equal(resolvePeriod('week', now), '2026-W40');
  assert.equal(resolvePeriod('2026-W01', now), '2026-W01');
  assert.throws(() => resolvePeriod("all'; DROP TABLE lb_entries;--", now), /Unknown period/);
});

test('isBetter and orderSql respect sort direction', () => {
  assert.equal(isBetter('asc', 100, 200), true);
  assert.equal(isBetter('asc', 200, 100), false);
  assert.equal(isBetter('desc', 200, 100), true);
  assert.equal(isBetter('asc', 100, 100), false); // a tie never replaces the earlier run
  assert.equal(orderSql('desc'), 'DESC');
  assert.equal(orderSql('asc'), 'ASC');
  assert.equal(orderSql('ASC; DROP'), 'ASC');
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

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
