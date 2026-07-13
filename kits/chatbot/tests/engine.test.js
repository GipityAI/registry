/**
 * Tests for lib/engine.js — the request the engine actually puts on the wire.
 * Run: node src/packages/chatbot/tests/engine.test.js
 */
import assert from 'node:assert/strict';
import { createChatbot } from '../lib/engine.js';

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

const persona = { name: 'Aria', instructions: 'You are Aria, a helpful assistant.' };

// The engine resolves the app GUID from the page; in node there is no document,
// so hand it the window global it looks at first.
globalThis.window = { __GIPITY_APP_GUID: 'p_test123' };

/**
 * Stub fetch for the two calls send() makes: /api/token, then /services/llm
 * (streamed as one SSE chunk). Returns the array of captured calls.
 */
function stubFetch() {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });

    if (String(url).endsWith('/api/token')) {
      return { ok: true, json: async () => ({ data: { token: 'tok_1' } }) };
    }

    const chunk = new TextEncoder().encode(
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
    );
    let sent = false;
    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: chunk };
          },
        }),
      },
    };
  };
  return calls;
}

const llmBody = calls => calls.find(c => c.url.includes('/services/llm')).body;

test('sends the configured model route to the LLM service', async () => {
  const calls = stubFetch();
  const bot = createChatbot({ persona, model: { route: 'medium' } });
  await bot.send('hello');
  assert.equal(llmBody(calls).model, 'medium');
});

test('passes a concrete model id through unchanged', async () => {
  const calls = stubFetch();
  const bot = createChatbot({ persona, model: { route: 'claude-sonnet-5' } });
  await bot.send('hello');
  assert.equal(llmBody(calls).model, 'claude-sonnet-5');
});

test("omits model for route 'default' — the service has no such alias", async () => {
  const calls = stubFetch();
  const bot = createChatbot({ persona }); // route defaults to 'default'
  await bot.send('hello');
  assert.equal('model' in llmBody(calls), false);
});

test('still sends temperature and max_tokens alongside the route', async () => {
  const calls = stubFetch();
  const bot = createChatbot({ persona, model: { route: 'small', temperature: 0.2, maxTokens: 256 } });
  await bot.send('hello');
  const body = llmBody(calls);
  assert.equal(body.model, 'small');
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 256);
});

for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.message); }
}

console.log('');
console.log(`engine.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
