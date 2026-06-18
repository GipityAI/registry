/**
 * Tests for lib/config.js.
 * Run: node src/packages/chatbot/tests/config.test.js
 */
import assert from 'node:assert/strict';
import {
  validateConfig,
  estimateTokens,
  ChatbotConfigError,
  DEFAULT_KNOWLEDGE_MAX_TOKENS,
} from '../lib/config.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

const minimalPersona = {
  name: 'Aria',
  instructions: 'You are Aria, a helpful assistant.',
};

test('rejects non-object config', () => {
  assert.throws(() => validateConfig(null), ChatbotConfigError);
  assert.throws(() => validateConfig('hi'), ChatbotConfigError);
  assert.throws(() => validateConfig([]), ChatbotConfigError);
});

test('requires persona.name and persona.instructions', () => {
  assert.throws(() => validateConfig({}), ChatbotConfigError);
  assert.throws(() => validateConfig({ persona: { name: 'x' } }), ChatbotConfigError);
  assert.throws(() => validateConfig({ persona: { instructions: 'x' } }), ChatbotConfigError);
});

test('accepts minimal valid config', () => {
  const out = validateConfig({ persona: minimalPersona });
  assert.equal(out.persona.name, 'Aria');
  assert.deepEqual(out.persona.starters, []);
  assert.equal(out.scope, null);
  assert.equal(out.knowledge.maxTokens, DEFAULT_KNOWLEDGE_MAX_TOKENS);
  assert.equal(out.knowledge.sources.length, 0);
  assert.equal(out.knowledge.inlineText, '');
  // Must always be an array — the engine derefs knowledge.fetchUrls.length at construction.
  assert.deepEqual(out.knowledge.fetchUrls, []);
  assert.equal(out.features.voice.enabled, false);
  assert.equal(out.ui.placement, 'bottom-right');
  assert.equal(out.storage.persistHistory, false);
});

test('fills knowledge.inlineText from text sources', () => {
  const out = validateConfig({
    persona: minimalPersona,
    knowledge: {
      sources: [
        { type: 'text', content: 'Hours: 9-5.' },
        { type: 'text', content: 'Returns: 30 days.' },
      ],
    },
  });
  assert.match(out.knowledge.inlineText, /Hours: 9-5/);
  assert.match(out.knowledge.inlineText, /Returns: 30 days/);
});

test('extracts knowledge.fetchUrls from url sources', () => {
  const out = validateConfig({
    persona: minimalPersona,
    knowledge: {
      sources: [{ type: 'url', url: 'https://example.com/docs' }],
    },
  });
  assert.deepEqual(out.knowledge.fetchUrls, ['https://example.com/docs']);
});

test('rejects unknown knowledge.type', () => {
  assert.throws(() => validateConfig({
    persona: minimalPersona,
    knowledge: { sources: [{ type: 'file', path: 'x.md' }] },
  }), ChatbotConfigError);
});

test('rejects non-http knowledge URL', () => {
  assert.throws(() => validateConfig({
    persona: minimalPersona,
    knowledge: { sources: [{ type: 'url', url: 'ftp://example.com' }] },
  }), ChatbotConfigError);
});

test('fails loudly when inline knowledge exceeds budget', () => {
  const huge = 'word '.repeat(2000); // ~10k chars => ~2.5k tokens
  assert.throws(() => validateConfig({
    persona: minimalPersona,
    knowledge: {
      maxTokens: 100,
      sources: [{ type: 'text', content: huge }],
    },
  }), (err) => err instanceof ChatbotConfigError && /exceeds maxTokens/.test(err.message));
});

test('estimateTokens approximates 4 chars per token', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('test'), 1);
  assert.equal(estimateTokens('a'.repeat(40)), 10);
});

test('rejects unknown feature key', () => {
  assert.throws(() => validateConfig({
    persona: minimalPersona,
    features: { telepathy: { enabled: true } },
  }), ChatbotConfigError);
});

test('validates tools allowlist shape', () => {
  const out = validateConfig({
    persona: minimalPersona,
    tools: [
      { name: 'lookup', function: 'do-lookup' },
      { name: 'auth-thing', function: 'authed-fn', auth: 'user-required' },
    ],
  });
  assert.equal(out.tools.length, 2);
  assert.equal(out.tools[0].auth, 'public');
  assert.equal(out.tools[1].auth, 'user-required');
});

test('rejects invalid tool auth', () => {
  assert.throws(() => validateConfig({
    persona: minimalPersona,
    tools: [{ name: 'x', function: 'y', auth: 'admin' }],
  }), ChatbotConfigError);
});

test('rejects invalid ui.placement and ui.theme', () => {
  assert.throws(() => validateConfig({
    persona: minimalPersona,
    ui: { placement: 'top-left' },
  }), ChatbotConfigError);
  assert.throws(() => validateConfig({
    persona: minimalPersona,
    ui: { theme: 'neon' },
  }), ChatbotConfigError);
});

console.log('');
console.log(`config.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
