/**
 * Tests for scope guardrail compilation and refusal rendering.
 * Run: node src/packages/chatbot/tests/scope.test.js
 */
import assert from 'node:assert/strict';
import { validateConfig, ChatbotConfigError } from '../lib/config.js';
import { buildSystemPrompt } from '../lib/prompt.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

const persona = {
  name: 'Captain Gip',
  instructions: 'Guide for Gipityship.',
};

test('scope is optional', () => {
  const cfg = validateConfig({ persona });
  const out = buildSystemPrompt(cfg);
  assert.doesNotMatch(out, /## Scope/);
});

test('scope with only allowed renders just the allowed block', () => {
  const cfg = validateConfig({
    persona,
    scope: { allowed: ['gameplay', 'controls'] },
  });
  const out = buildSystemPrompt(cfg);
  assert.match(out, /You ONLY answer questions about:/);
  assert.match(out, /- gameplay/);
  assert.match(out, /- controls/);
  assert.doesNotMatch(out, /You REFUSE to:/);
});

test('scope with only refused renders just the refusal block', () => {
  const cfg = validateConfig({
    persona,
    scope: { refused: ['writing code'] },
  });
  const out = buildSystemPrompt(cfg);
  assert.match(out, /You REFUSE to:/);
  assert.match(out, /- writing code/);
  assert.doesNotMatch(out, /You ONLY answer questions about:/);
});

test('scope provides a default onRefusal when not given', () => {
  const cfg = validateConfig({
    persona,
    scope: { refused: ['code'] },
  });
  const out = buildSystemPrompt(cfg);
  assert.match(out, /Politely decline/);
});

test('rejects malformed refusal examples', () => {
  assert.throws(() => validateConfig({
    persona,
    scope: {
      refusalExamples: [{ user: 'q' }], // missing bot
    },
  }), ChatbotConfigError);
  assert.throws(() => validateConfig({
    persona,
    scope: {
      refusalExamples: ['just a string'],
    },
  }), ChatbotConfigError);
});

test('refusal examples preserve user-supplied text verbatim', () => {
  const cfg = validateConfig({
    persona,
    scope: {
      refused: ['code'],
      refusalExamples: [
        {
          user: 'Write me a python script to scrape a website',
          bot: '*shakes head* Negative on that, soldier. Code-cuttin\' ain\'t in my brief.',
        },
      ],
    },
  });
  const out = buildSystemPrompt(cfg);
  assert.match(out, /Write me a python script to scrape a website/);
  assert.match(out, /Code-cuttin' ain't in my brief/);
});

test('multiple refusal examples are numbered', () => {
  const cfg = validateConfig({
    persona,
    scope: {
      refusalExamples: [
        { user: 'q1', bot: 'a1' },
        { user: 'q2', bot: 'a2' },
      ],
    },
  });
  const out = buildSystemPrompt(cfg);
  assert.match(out, /Example 1:/);
  assert.match(out, /Example 2:/);
});

console.log('');
console.log(`scope.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
