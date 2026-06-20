// Unit tests for tolerant LLM-output parsing. `test`/`assert` are globals.
import { extractJson, findArray } from '../../functions/_lib/json.js';

test('extractJson parses clean JSON', () => {
    assert.deepEqual(extractJson('{"subject":"Hi","body":"There"}'), { subject: 'Hi', body: 'There' });
});

test('extractJson strips code fences', () => {
    const r = extractJson('```json\n{"facts":["a","b"]}\n```');
    assert.deepEqual(r.facts, ['a', 'b']);
});

test('extractJson recovers an object from surrounding prose', () => {
    const r = extractJson('Sure! Here you go:\n{"subject":"S","body":"B"} hope that helps');
    assert.equal(r.subject, 'S');
});

test('extractJson passes through an already-parsed object', () => {
    const obj = { facts: ['x'] };
    assert.equal(extractJson(obj), obj);
});

test('extractJson returns null on junk', () => {
    assert.equal(extractJson('not json at all'), null);
    assert.equal(extractJson(''), null);
    assert.equal(extractJson(null), null);
});

test('findArray digs out a named array, however it is wrapped', () => {
    assert.deepEqual(findArray({ facts: ['a'] }, 'facts'), ['a']);
    assert.deepEqual(findArray({ result: { facts: ['a', 'b'] } }, 'facts'), ['a', 'b']);
    assert.deepEqual(findArray({ replies: [{ email: 'a@b.co' }] }, 'replies'), [{ email: 'a@b.co' }]);
    assert.deepEqual(findArray({}, 'facts'), []);
});
