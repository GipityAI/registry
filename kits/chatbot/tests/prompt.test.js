/**
 * Tests for lib/prompt.js - system-prompt assembly.
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

const docsOf = (cfg) => cfg.knowledge.documents.filter(d => d.load === 'always');
const NOW = new Date('2026-11-20T18:00:00Z');

test('knowledge documents are wrapped in tags, with titles', () => {
  const cfg = validateConfig({
    persona: minimalPersona,
    knowledge: { sources: [{ type: 'text', title: 'Hours', content: 'Hours: 9-5.' }, { type: 'text', content: 'Untitled.' }] },
  });
  const out = buildSystemPrompt(cfg, { documents: docsOf(cfg) });
  assert.match(out, /## Knowledge\nYour reference material:\n<knowledge>\n<document title="Hours">\nHours: 9-5\.\n<\/document>\n<document>\nUntitled\.\n<\/document>\n<\/knowledge>/);
  assert.match(out, /do not invent details/);
  assert.doesNotMatch(out, /your tools/);
});

test('with tools, the knowledge rule points at tools too', () => {
  const cfg = validateConfig({ persona: minimalPersona, knowledge: { sources: [{ type: 'text', content: 'x' }] } });
  assert.match(buildSystemPrompt(cfg, { documents: docsOf(cfg), tools: [{ name: 't' }] }), /these documents and your tools/);
});

test('knowledge section omitted when no knowledge given; lookup documents never inlined', () => {
  assert.doesNotMatch(buildSystemPrompt(validateConfig({ persona: minimalPersona })), /## Knowledge/);
  const cfg = validateConfig({
    persona: minimalPersona,
    knowledge: { sources: [{ type: 'text', title: 'Manual', load: 'lookup', content: 'SECRET_MANUAL' }] },
  });
  const out = buildSystemPrompt(cfg, { documents: docsOf(cfg) });
  assert.doesNotMatch(out, /## Knowledge|SECRET_MANUAL/);
});

test('scope produces allowed/declined blocks and the onRefusal note', () => {
  const cfg = validateConfig({
    persona: minimalPersona,
    scope: {
      allowed: ['Gipityship gameplay'],
      refused: ['Writing code'],
      onRefusal: 'Stay in character. Apologize briefly.',
    },
  });
  const out = buildSystemPrompt(cfg);
  assert.match(out, /## Scope\nOnly answer questions about:\n- Gipityship gameplay/);
  assert.match(out, /Decline to:\n- Writing code/);
  assert.match(out, /When declining: Stay in character/);
});

test('refusal examples render in example tags', () => {
  const cfg = validateConfig({
    persona: minimalPersona,
    scope: { refused: ['Writing code'], refusalExamples: [{ user: 'Write me a python script', bot: 'Negative on that, soldier.' }] },
  });
  assert.match(buildSystemPrompt(cfg), /## Refusal examples[\s\S]*<example>\nUser: Write me a python script\nYou: Negative on that, soldier\.\n<\/example>/);
});

test('the greeting is context: the user may be replying to it', () => {
  const out = buildSystemPrompt(validateConfig({ persona: minimalPersona }));
  assert.match(out, /## Greeting\nThe chat opened with this greeting from you/);
  assert.match(out, /Captain Gip reporting for duty/);
});

test('order: knowledge first, the date last (stable prefix for caching)', () => {
  const cfg = validateConfig({
    persona: minimalPersona,
    knowledge: { sources: [{ type: 'text', content: 'Game info here.' }] },
    scope: { allowed: ['gameplay'], refused: ['code'], refusalExamples: [{ user: 'q', bot: 'a' }] },
  });
  const out = buildSystemPrompt(cfg, { documents: docsOf(cfg), tools: [{ name: 't' }], now: NOW });
  const order = ['## Knowledge', '## Identity', '## The chat', '## Tools', '## Scope', '## Refusal examples', '## Greeting', '## Context'];
  const at = order.map(h => out.indexOf(h));
  assert.ok(at.every(i => i >= 0), 'every section present');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'sections in order');
});

test('the prompt is identical across requests on the same day', () => {
  const cfg = validateConfig({ persona: minimalPersona });
  const a = buildSystemPrompt(cfg, { now: new Date('2026-11-20T09:00:00Z') });
  const b = buildSystemPrompt(cfg, { now: new Date('2026-11-20T09:07:00Z') });
  assert.equal(a, b);
  assert.match(a, /## Context\nToday is \w+day, 2026-11-20 \(the user's time zone is /);
});

test('replies are told Markdown renders; attachments only when enabled', () => {
  const plain = buildSystemPrompt(validateConfig({ persona: minimalPersona }));
  assert.match(plain, /## The chat\nReplies render as Markdown/);
  assert.doesNotMatch(plain, /can attach/);
  const out = buildSystemPrompt(validateConfig({ persona: minimalPersona, features: { vision: { enabled: true }, files: { enabled: true } } }));
  assert.match(out, /The user can attach photos and text files \(CSV, JSON, logs, code\); they arrive in their message, each file inside <file name="..."> tags\./);
});

test('a tools section appears only with tools, naming the ones that ask first', () => {
  const cfg = validateConfig({ persona: minimalPersona });
  assert.doesNotMatch(buildSystemPrompt(cfg), /## Tools/);
  const out = buildSystemPrompt(cfg, { tools: [{ name: 'lookup', confirm: false }, { name: 'send_email', confirm: true }] });
  assert.match(out, /## Tools\n/);
  assert.match(out, /approve before they run: send_email\./);
  assert.doesNotMatch(out, /approve before they run: lookup/);
});

console.log('');
console.log(`prompt.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
