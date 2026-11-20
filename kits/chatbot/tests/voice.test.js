/**
 * Tests for lib/voice.js speakableText: what read-aloud actually says.
 * Run: node tests/voice.test.js
 */
import assert from 'node:assert/strict';
import { speakableText, SPEAK_MAX_CHARS } from '../lib/voice.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

test('markup is dropped and link text kept', () => {
  assert.equal(speakableText('## Result\n- **Order** A-17 is [here](https://x.y).'), 'Result Order A-17 is here.');
});

test('code blocks are not read out', () => {
  assert.equal(speakableText('Run this:\n```\nrm -rf /\n```\nThen wait.'), 'Run this: (code omitted) Then wait.');
});

test('long replies are cut to the speech limit', () => {
  assert.equal(speakableText('word '.repeat(3000)).length, SPEAK_MAX_CHARS);
});

console.log('');
console.log(`voice.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
