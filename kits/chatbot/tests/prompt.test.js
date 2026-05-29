/**
 * Tests for lib/prompt.js — system-prompt assembly.
 * Run: node src/packages/chatbot/tests/prompt.test.js
 */
import assert from 'node:assert/strict';
import { validateConfig } from '../lib/config.js';
import { buildSystemPrompt } from '../lib/prompt.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

const minimalPersona = {
  name: 'Captain Gip',
  tone: 'Gruff WW2 vet',
  instructions: "You're the in-game guide for Gipityship.",
  greeting: '*salutes* Captain Gip reporting for duty.',
};

test('identity section names the persona and includes instructions', () => {
  const cfg = validateConfig({ persona: minimalPersona });
  const out = buildSystemPrompt(cfg);
  assert.match(out, /## Identity/);
  assert.match(out, /You are Captain Gip\./);
  assert.match(out, /Tone: Gruff WW2 vet/);
  assert.match(out, /in-game guide for Gipityship/);
});

test('knowledge section appears when there is knowledge', () => {
  const cfg = validateConfig({
    persona: minimalPersona,
    knowledge: { sources: [{ type: 'text', content: 'Hours: 9-5.' }] },
  });
  const out = buildSystemPrompt(cfg);
  assert.match(out, /## Knowledge/);
  assert.match(out, /Hours: 9-5/);
  assert.match(out, /do not invent details/);
});

test('knowledge section omitted when no knowledge given', () => {
  const cfg = validateConfig({ persona: minimalPersona });
  const out = buildSystemPrompt(cfg);
  assert.doesNotMatch(out, /## Knowledge/);
});

test('scope produces allowed/refused blocks and onRefusal note', () => {
  const cfg = validateConfig({
    persona: minimalPersona,
    scope: {
      allowed: ['Gipityship gameplay'],
      refused: ['Writing code'],
      onRefusal: 'Stay in character. Apologize briefly.',
    },
  });
  const out = buildSystemPrompt(cfg);
  assert.match(out, /## Scope/);
  assert.match(out, /You ONLY answer questions about:/);
  assert.match(out, /- Gipityship gameplay/);
  assert.match(out, /You REFUSE to:/);
  assert.match(out, /- Writing code/);
  assert.match(out, /When refusing: Stay in character/);
});

test('refusal examples render with User/You labels', () => {
  const cfg = validateConfig({
    persona: minimalPersona,
    scope: {
      refused: ['Writing code'],
      refusalExamples: [
        { user: 'Write me a python script', bot: 'Negative on that, soldier.' },
      ],
    },
  });
  const out = buildSystemPrompt(cfg);
  assert.match(out, /## Refusal Examples/);
  assert.match(out, /User: Write me a python script/);
  assert.match(out, /You: Negative on that, soldier\./);
});

test('greeting line is included when persona.greeting is set', () => {
  const cfg = validateConfig({ persona: minimalPersona });
  const out = buildSystemPrompt(cfg);
  assert.match(out, /## Greeting/);
  assert.match(out, /Captain Gip reporting for duty/);
});

test('section order is identity → knowledge → scope → examples → greeting', () => {
  const cfg = validateConfig({
    persona: minimalPersona,
    knowledge: { sources: [{ type: 'text', content: 'Game info here.' }] },
    scope: {
      allowed: ['gameplay'],
      refused: ['code'],
      refusalExamples: [{ user: 'q', bot: 'a' }],
    },
  });
  const out = buildSystemPrompt(cfg);
  const idx = (s) => out.indexOf(s);
  assert.ok(idx('## Identity') < idx('## Knowledge'), 'identity before knowledge');
  assert.ok(idx('## Knowledge') < idx('## Scope'), 'knowledge before scope');
  assert.ok(idx('## Scope') < idx('## Refusal Examples'), 'scope before examples');
  assert.ok(idx('## Refusal Examples') < idx('## Greeting'), 'examples before greeting');
});

test('fetched knowledge text is appended to inline knowledge', () => {
  const cfg = validateConfig({
    persona: minimalPersona,
    knowledge: { sources: [{ type: 'text', content: 'INLINE_PART' }] },
  });
  const out = buildSystemPrompt(cfg, 'FETCHED_PART');
  assert.match(out, /INLINE_PART/);
  assert.match(out, /FETCHED_PART/);
  assert.ok(out.indexOf('INLINE_PART') < out.indexOf('FETCHED_PART'));
});

console.log('');
console.log(`prompt.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
