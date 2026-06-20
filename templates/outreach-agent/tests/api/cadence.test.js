// Unit tests for the pure scheduling/sequence helpers. `test`/`assert` are globals.
import {
    CADENCE_DAYS, isValidCadence, intervalDays, nextContactDate, addDays,
    isSendableStatus, isDormantStatus, advanceStep, clampScore,
} from '../../functions/_lib/cadence.js';

test('isValidCadence accepts known cadences and rejects junk', () => {
    assert.equal(isValidCadence('every3'), true);
    assert.equal(isValidCadence('weekly'), true);
    assert.equal(isValidCadence('paused'), true);
    assert.equal(isValidCadence('hourly'), false);
    assert.equal(isValidCadence(''), false);
});

test('intervalDays: every3 is 3 days; unknown falls back to every3', () => {
    assert.equal(intervalDays('every3'), 3);
    assert.equal(intervalDays('monthly'), 30);
    assert.equal(intervalDays('nonsense'), 3);
    assert.equal(CADENCE_DAYS.paused, null);
});

test('nextContactDate advances by the cadence interval, null for paused', () => {
    const from = '2026-01-01T00:00:00.000Z';
    assert.equal(nextContactDate('every3', from), '2026-01-04T00:00:00.000Z');
    assert.equal(nextContactDate('weekly', from), '2026-01-08T00:00:00.000Z');
    assert.equal(nextContactDate('paused', from), null);
});

test('addDays adds whole days as ISO', () => {
    assert.equal(addDays('2026-01-01T00:00:00.000Z', 1), '2026-01-02T00:00:00.000Z');
    assert.equal(addDays('2026-01-01T00:00:00.000Z', 0), '2026-01-01T00:00:00.000Z');
});

test('sendable vs dormant statuses: a reply is NOT sendable', () => {
    assert.equal(isSendableStatus('new'), true);
    assert.equal(isSendableStatus('in_sequence'), true);
    assert.equal(isSendableStatus('replied'), false);   // replies pause the sequence
    assert.equal(isDormantStatus('replied'), false);    // replied is its own state
    assert.equal(isDormantStatus('done'), true);
    assert.equal(isDormantStatus('to_qualify'), true);
});

test('advanceStep walks the sequence then signals done', () => {
    assert.deepEqual(advanceStep(3, 0), { seq_step: 1, done: false });
    assert.deepEqual(advanceStep(3, 1), { seq_step: 2, done: false });
    assert.deepEqual(advanceStep(3, 2), { seq_step: 2, done: true });  // past the last touch
    assert.deepEqual(advanceStep(0, 0), { seq_step: 0, done: true });
});

test('clampScore clamps to 0-100 and rounds', () => {
    assert.equal(clampScore(150), 100);
    assert.equal(clampScore(-5), 0);
    assert.equal(clampScore(72.6), 73);
    assert.equal(clampScore('nope'), 0);
});
