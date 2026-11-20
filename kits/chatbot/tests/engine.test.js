/**
 * Tests for lib/engine.js: what goes on the wire, the tool loop, confirmation,
 * stop, failed turns, saved conversations and attachments. The client SDK
 * (window.Gipity) is a scripted stub; everything else is the real engine.
 * Run: node tests/engine.test.js
 */
import assert from 'node:assert/strict';
import { createChatbot, requestWindow, WINDOW_MAX_MESSAGES, TOOL_RESULT_MAX_CHARS } from '../lib/engine.js';

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

const persona = { name: 'Aria', instructions: 'You are Aria, a helpful assistant.' };

/** One streamed model answer: text, optional tool calls, then the final chunk. */
function answer({ text = '', calls = [], credits = 1 } = {}) {
  const chunks = [];
  if (text) chunks.push({ choices: [{ delta: { content: text }, finish_reason: null }] });
  calls.forEach((c, i) => chunks.push({ choices: [{ delta: { tool_calls: [{ index: i, id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } }] }, finish_reason: null }] }));
  chunks.push({ choices: [{ delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 }, credits_used: credits });
  return chunks;
}

/**
 * A stub SDK. `script` is a list of answers (or functions returning one, or
 * errors to throw) consumed one per model call. Records every request.
 */
function stubSdk(script, { fn, service } = {}) {
  const sdk = { requests: [], fnCalls: [], serviceCalls: [] };
  sdk.serviceStream = async function* (path, body, opts) {
    sdk.requests.push(JSON.parse(JSON.stringify(body)));
    let next = script.shift();
    if (typeof next === 'function') next = await next(opts);
    if (next instanceof Error) throw next;
    if (!next) throw new Error('stub: no scripted answer left');
    for (const chunk of next) {
      if (opts?.signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      yield chunk;
      await new Promise(r => setTimeout(r, 0));
    }
  };
  sdk.fn = async (name, args) => {
    sdk.fnCalls.push({ name, args });
    return fn ? fn(name, args) : { ok: true };
  };
  sdk.service = async (path, body) => {
    sdk.serviceCalls.push({ path, body });
    if (service) return service(path, body);
    throw new Error(`stub: unexpected service ${path}`);
  };
  return sdk;
}

function memoryStore() {
  const convs = new Map();
  const log = [];
  let n = 0;
  return {
    log,
    convs,
    async list() { return [...convs.values()].map(({ id, title }) => ({ id, title })); },
    async load(id) { const c = convs.get(id); return c ? JSON.parse(JSON.stringify(c)) : null; },
    async create({ title, messages }) { const id = `c${++n}`; convs.set(id, { id, title, messages: [...messages] }); log.push(['create', id, messages.length]); return { id }; },
    async write(id, from, messages) { const c = convs.get(id); c.messages.length = from; c.messages.push(...messages); log.push(['write', id, from, messages.length]); },
    async rename(id, title) { convs.get(id).title = title; log.push(['rename', id, title]); },
    async remove(id) { convs.delete(id); log.push(['remove', id]); },
  };
}

const orderTool = { name: 'lookup_order', description: 'Find an order by number', function: 'orders', parameters: { type: 'object', properties: { number: { type: 'string' } } } };

// --- What goes on the wire ---

test('sends the model route, temperature and max_tokens; omits model for "default"', async () => {
  const sdk = stubSdk([answer({ text: 'hi' }), answer({ text: 'hi' })]);
  await createChatbot({ persona, model: { route: 'medium', temperature: 0.2, maxTokens: 256 } }, { gipity: sdk }).send('hello');
  assert.equal(sdk.requests[0].model, 'medium');
  assert.equal(sdk.requests[0].temperature, 0.2);
  assert.equal(sdk.requests[0].max_tokens, 256);
  assert.equal(sdk.requests[0].stream, true);
  await createChatbot({ persona }, { gipity: sdk }).send('hello');
  assert.equal('model' in sdk.requests[1], false);
});

test('setModel switches the model for the next message', async () => {
  const sdk = stubSdk([answer({ text: 'a' }), answer({ text: 'b' })]);
  const bot = createChatbot({ persona, model: { route: 'fast' } }, { gipity: sdk });
  await bot.send('one');
  bot.setModel('large');
  await bot.send('two');
  assert.deepEqual(sdk.requests.map(r => r.model), ['fast', 'large']);
});

test('offers tools in the OpenAI shape and only when configured', async () => {
  const sdk = stubSdk([answer({ text: 'x' }), answer({ text: 'y' })]);
  await createChatbot({ persona, tools: [orderTool] }, { gipity: sdk }).send('hi');
  assert.deepEqual(sdk.requests[0].tools, [{ type: 'function', function: { name: 'lookup_order', description: 'Find an order by number', parameters: orderTool.parameters } }]);
  await createChatbot({ persona }, { gipity: sdk }).send('hi');
  assert.equal('tools' in sdk.requests[1], false);
});

// --- The tool loop ---

test('runs a tool the model asks for, as an app function, and lets the model finish', async () => {
  const sdk = stubSdk([
    answer({ text: 'Checking.', calls: [{ id: 'call_1', name: 'lookup_order', args: { number: 'A-17' } }], credits: 2 }),
    answer({ text: 'Order A-17 shipped.', credits: 3 }),
  ], { fn: () => ({ status: 'shipped' }) });
  const bot = createChatbot({ persona, tools: [orderTool] }, { gipity: sdk });
  const events = [];
  bot.on('tool_start', e => events.push(['start', e.name, e.args.number]));
  bot.on('tool_end', e => events.push(['end', e.name, e.result.status]));
  const usage = [];
  bot.on('usage', u => usage.push(u));

  const final = await bot.send('Where is order A-17?');

  assert.deepEqual(sdk.fnCalls, [{ name: 'orders', args: { number: 'A-17' } }]);
  assert.deepEqual(events, [['start', 'lookup_order', 'A-17'], ['end', 'lookup_order', 'shipped']]);
  assert.equal(final.content, 'Order A-17 shipped.');
  assert.deepEqual(usage, [{ credits: 5, inputTokens: 20, outputTokens: 10 }]);
  // The second request carries the call and its result.
  const wire = sdk.requests[1].messages;
  assert.deepEqual(wire.map(m => m.role), ['user', 'assistant', 'tool']);
  assert.equal(wire[1].tool_calls[0].function.name, 'lookup_order');
  assert.deepEqual(wire[2], { role: 'tool', tool_call_id: 'call_1', content: '{"status":"shipped"}' });
  assert.deepEqual(bot.history().map(m => m.role), ['user', 'assistant', 'tool', 'assistant']);
});

test('a failing tool reports its error to the model and the turn continues', async () => {
  const sdk = stubSdk([
    answer({ calls: [{ id: 'c1', name: 'lookup_order', args: { number: 'zz' } }] }),
    answer({ text: 'That order does not exist.' }),
  ], { fn: () => { throw Object.assign(new Error('no such order'), { status: 404 }); } });
  const final = await createChatbot({ persona, tools: [orderTool] }, { gipity: sdk }).send('find zz');
  assert.equal(final.content, 'That order does not exist.');
  assert.deepEqual(JSON.parse(sdk.requests[1].messages[2].content), { error: 'no such order' });
});

test('a tool that needs sign-in raises auth_required and tells the model', async () => {
  const sdk = stubSdk([
    answer({ calls: [{ id: 'c1', name: 'lookup_order', args: {} }] }),
    answer({ text: 'Please sign in.' }),
  ], { fn: () => { throw Object.assign(new Error('Login required'), { status: 401, code: 'LOGIN_REQUIRED' }); } });
  const bot = createChatbot({ persona, tools: [orderTool] }, { gipity: sdk });
  let asked = 0;
  bot.on('auth_required', () => asked++);
  await bot.send('my orders');
  assert.equal(asked, 1);
  assert.match(JSON.parse(sdk.requests[1].messages[2].content).error, /sign in/);
});

test('a browser tool (run) gets the parsed arguments', async () => {
  let got;
  const sdk = stubSdk([answer({ calls: [{ id: 'c1', name: 'title', args: { upper: true } }] }), answer({ text: 'done' })]);
  await createChatbot({ persona, tools: [{ name: 'title', description: 'Page title', run: async (a) => { got = a; return 'HOME'; } }] }, { gipity: sdk }).send('title?');
  assert.deepEqual(got, { upper: true });
  assert.equal(sdk.requests[1].messages[2].content, 'HOME');
});

test('an unknown tool name gets an error result, not a crash', async () => {
  const sdk = stubSdk([answer({ calls: [{ id: 'c1', name: 'nope', args: {} }] }), answer({ text: 'ok' })]);
  await createChatbot({ persona, tools: [orderTool] }, { gipity: sdk }).send('x');
  assert.match(sdk.requests[1].messages[2].content, /no tool named nope/);
});

test('a huge tool result is cut and the model is told', async () => {
  const sdk = stubSdk([answer({ calls: [{ id: 'c1', name: 'lookup_order', args: {} }] }), answer({ text: 'ok' })], { fn: () => 'x'.repeat(TOOL_RESULT_MAX_CHARS + 500) });
  await createChatbot({ persona, tools: [orderTool] }, { gipity: sdk }).send('x');
  const content = sdk.requests[1].messages[2].content;
  assert.ok(content.length < TOOL_RESULT_MAX_CHARS + 200);
  assert.match(content, /result cut at/);
});

test('stops after model.maxToolSteps rounds with a note', async () => {
  const loop = () => answer({ calls: [{ id: `c${Math.random()}`, name: 'lookup_order', args: {} }] });
  const sdk = stubSdk([loop(), loop(), loop()]);
  const final = await createChatbot({ persona, tools: [orderTool], model: { maxToolSteps: 2 } }, { gipity: sdk }).send('loop');
  assert.equal(sdk.requests.length, 2);
  assert.match(final.content, /stopped after 2 tool steps/);
});

// --- Confirmation ---

const sendTool = { name: 'send_email', description: 'Email someone', function: 'mailer', confirm: true };

test('a confirm tool waits for approval, then runs', async () => {
  const sdk = stubSdk([answer({ calls: [{ id: 'c1', name: 'send_email', args: { to: 'a@b.c' } }] }), answer({ text: 'Sent.' })]);
  const bot = createChatbot({ persona, tools: [sendTool] }, { gipity: sdk });
  bot.on('confirm', (req) => { assert.equal(req.args.to, 'a@b.c'); setTimeout(req.approve, 5); });
  await bot.send('email them');
  assert.equal(sdk.fnCalls.length, 1);
});

test('a denied confirm tool does not run and the model hears it was declined', async () => {
  const sdk = stubSdk([answer({ calls: [{ id: 'c1', name: 'send_email', args: {} }] }), answer({ text: 'OK, not sending.' })]);
  const bot = createChatbot({ persona, tools: [sendTool] }, { gipity: sdk });
  bot.on('confirm', (req) => req.deny());
  await bot.send('email them');
  assert.equal(sdk.fnCalls.length, 0);
  assert.match(sdk.requests[1].messages[2].content, /declined/);
});

test('with nothing listening for confirm, a confirm tool is declined', async () => {
  const sdk = stubSdk([answer({ calls: [{ id: 'c1', name: 'send_email', args: {} }] }), answer({ text: 'ok' })]);
  const warn = console.warn; console.warn = () => {};
  try { await createChatbot({ persona, tools: [sendTool] }, { gipity: sdk }).send('email'); } finally { console.warn = warn; }
  assert.equal(sdk.fnCalls.length, 0);
});

// --- Stop and failures ---

test('stop() keeps what streamed so far', async () => {
  const slow = [
    { choices: [{ delta: { content: 'Part one. ' }, finish_reason: null }] },
    { choices: [{ delta: { content: 'Part two.' }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ];
  const sdk = stubSdk([slow]);
  const bot = createChatbot({ persona }, { gipity: sdk });
  bot.on('delta', () => bot.stop());
  const final = await bot.send('go');
  assert.equal(final.content, 'Part one. ');
  assert.equal(final.stopped, true);
  assert.equal(bot.isBusy(), false);
});

test('a failed turn leaves no trace, hands the text back and explains itself', async () => {
  const sdk = stubSdk([Object.assign(new Error('Insufficient credits'), { status: 402 })]);
  const bot = createChatbot({ persona }, { gipity: sdk });
  let shown;
  bot.on('error', e => { shown = e; });
  await assert.rejects(bot.send('hello there'), (err) => err.unsentText === 'hello there');
  assert.equal(bot.history().length, 0);
  assert.match(shown.message, /out of credits/);
  assert.equal(shown.visitorMessage, 'The assistant is unavailable right now. Please try again later.');
});

test('an error in the middle of the stream fails the turn', async () => {
  const sdk = stubSdk([[{ choices: [{ delta: {}, finish_reason: 'error' }], error: 'Model overloaded' }]]);
  const bot = createChatbot({ persona }, { gipity: sdk });
  bot.on('error', () => {});
  await assert.rejects(bot.send('x'), /Model overloaded/);
});

test('a 400 from the service shows its reason to the visitor', async () => {
  const sdk = stubSdk([Object.assign(new Error('This request is about 250,000 tokens'), { status: 400 })]);
  const bot = createChatbot({ persona }, { gipity: sdk });
  let shown;
  bot.on('error', e => { shown = e; });
  await assert.rejects(bot.send('x'));
  assert.match(shown.visitorMessage, /250,000 tokens/);
});

test('a long conversation keeps working: each request stays inside the window', async () => {
  const script = Array.from({ length: 15 }, (_, i) => answer({ text: `answer ${i + 1}` }));
  const sdk = stubSdk(script);
  const bot = createChatbot({ persona }, { gipity: sdk });
  for (let i = 1; i <= 15; i++) await bot.send(`question ${i}`);
  for (const body of sdk.requests) {
    assert.ok(body.messages.length <= WINDOW_MAX_MESSAGES);
    assert.equal(body.messages[0].role, 'user');
  }
  assert.equal(sdk.requests[14].messages.at(-1).content, 'question 15');
  assert.equal(bot.history().length, 30);
});

// --- requestWindow ---

test('requestWindow keeps the newest messages inside the character budget and starts at a user turn', () => {
  const big = 'x'.repeat(100_000);
  const msgs = [
    { role: 'user', content: big }, { role: 'assistant', content: big },
    { role: 'user', content: big }, { role: 'assistant', content: null, tool_calls: [{ id: 't', type: 'function', function: { name: 'f', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 't', content: big }, { role: 'assistant', content: 'done' },
    { role: 'user', content: 'latest' },
  ];
  const w = requestWindow(msgs);
  assert.equal(w[0].role, 'user');
  assert.equal(w.at(-1).content, 'latest');
  // The tool result is never sent without the call that asked for it.
  const toolIdx = w.findIndex(m => m.role === 'tool');
  if (toolIdx >= 0) assert.ok(w[toolIdx - 1]?.tool_calls);
});

test('requestWindow always sends the newest message even if it alone is over budget', () => {
  const w = requestWindow([{ role: 'user', content: 'x'.repeat(400_000) }]);
  assert.equal(w.length, 1);
});

// --- Saved conversations ---

test('the first reply creates a conversation; later turns append; titles come from a small model', async () => {
  const store = memoryStore();
  const sdk = stubSdk([answer({ text: 'Paris.' }), answer({ text: 'About 2.1 million.' })], {
    service: (path, body) => {
      assert.equal(path, 'llm');
      assert.equal(body.model, 'small');
      return { choices: [{ message: { content: '"French capital facts"' } }] };
    },
  });
  const bot = createChatbot({ persona, storage: { persist: store } }, { gipity: sdk });
  await bot.send('Capital of France?');
  await new Promise(r => setTimeout(r, 5)); // auto-title runs in the background
  await bot.send('Population?');
  assert.deepEqual(store.log[0], ['create', 'c1', 2]);
  assert.deepEqual(store.log.find(l => l[0] === 'rename'), ['rename', 'c1', 'French capital facts']);
  assert.deepEqual(store.log.at(-1), ['write', 'c1', 2, 2]);
  assert.equal(store.convs.get('c1').messages.length, 4);
  assert.deepEqual(bot.current(), { id: 'c1', title: 'French capital facts' });
});

test('regenerate rewrites the tail of the saved conversation', async () => {
  const store = memoryStore();
  const sdk = stubSdk([answer({ text: 'first try' }), answer({ text: 'second try' })]);
  const bot = createChatbot({ persona, storage: { persist: store, autoTitle: false } }, { gipity: sdk });
  await bot.send('hi');
  await bot.regenerate();
  assert.deepEqual(store.log.at(-1), ['write', 'c1', 1, 1]);
  assert.deepEqual(store.convs.get('c1').messages.map(m => m.content), ['hi', 'second try']);
});

test('editLast replaces the last question and its answer', async () => {
  const store = memoryStore();
  const sdk = stubSdk([answer({ text: 'a1' }), answer({ text: 'a2' })]);
  const bot = createChatbot({ persona, storage: { persist: store, autoTitle: false } }, { gipity: sdk });
  await bot.send('typo');
  await bot.editLast('fixed');
  assert.deepEqual(bot.history().map(m => m.content), ['fixed', 'a2']);
  assert.deepEqual(store.convs.get('c1').messages.map(m => m.content), ['fixed', 'a2']);
});

test('open, newChat, rename and remove', async () => {
  const store = memoryStore();
  const sdk = stubSdk([answer({ text: 'one' }), answer({ text: 'two' })]);
  const bot = createChatbot({ persona, storage: { persist: store, autoTitle: false } }, { gipity: sdk });
  await bot.send('first chat');
  bot.newChat();
  assert.equal(bot.history().length, 0);
  await bot.send('second chat');
  assert.equal((await bot.conversations()).length, 2);
  await bot.open('c1');
  assert.equal(bot.history()[0].content, 'first chat');
  await bot.rename('c1', 'Renamed');
  assert.equal(bot.current().title, 'Renamed');
  await bot.remove('c1');
  assert.equal(bot.current().id, null);
  assert.equal((await bot.conversations()).length, 1);
});

test('conversation methods without storage fail loudly', async () => {
  const bot = createChatbot({ persona }, { gipity: stubSdk([]) });
  await assert.rejects(bot.conversations(), /storage.persist/);
});

// --- Attachments ---

test('text files go into the message; the visitor sees what they typed', async () => {
  const sdk = stubSdk([answer({ text: 'Two rows.' })]);
  const bot = createChatbot({ persona, features: { files: { enabled: true } } }, { gipity: sdk });
  await bot.send('summarize', { attachments: [{ kind: 'file', name: 'data.csv', text: 'a,b\n1,2' }] });
  assert.equal(sdk.requests[0].messages[0].content, 'summarize\n\n<file name="data.csv">\na,b\n1,2\n</file>');
  const user = bot.history()[0];
  assert.equal(user.display, 'summarize');
  assert.deepEqual(user.attachments, [{ kind: 'file', name: 'data.csv' }]);
});

test('photos go as image blocks and need features.vision', async () => {
  const img = { kind: 'image', name: 'p.jpg', dataUrl: 'data:image/jpeg;base64,AAAA' };
  const sdk = stubSdk([answer({ text: 'A cat.' })]);
  await assert.rejects(createChatbot({ persona }, { gipity: sdk }).send('what is this', { attachments: [img] }), /features.vision/);
  const bot = createChatbot({ persona, features: { vision: { enabled: true } } }, { gipity: sdk });
  await bot.send('what is this', { attachments: [img] });
  assert.deepEqual(sdk.requests[0].messages[0].content, [{ type: 'text', text: 'what is this' }, { type: 'image_url', image_url: { url: img.dataUrl } }]);
});

test('a text file over features.files.maxChars is refused, not cut', async () => {
  const bot = createChatbot({ persona, features: { files: { enabled: true, maxChars: 10 } } }, { gipity: stubSdk([]) });
  await assert.rejects(bot.send('x', { attachments: [{ kind: 'file', name: 'big.log', text: 'x'.repeat(11) }] }), /limit is 10/);
});

// --- Built-in image tool ---

test('imageGen adds a generate_image tool backed by the image service', async () => {
  const sdk = stubSdk([
    answer({ calls: [{ id: 'c1', name: 'generate_image', args: { prompt: 'a red fox' } }] }),
    answer({ text: '![fox](https://media.gipity.ai/fox.png)' }),
  ], { service: (path, body) => { assert.equal(path, 'image'); assert.equal(body.prompt, 'a red fox'); return { url: 'https://media.gipity.ai/fox.png' }; } });
  const bot = createChatbot({ persona, features: { imageGen: { enabled: true } } }, { gipity: sdk });
  await bot.send('draw a fox');
  assert.ok(sdk.requests[0].tools.some(t => t.function.name === 'generate_image'));
  assert.equal(sdk.requests[1].messages[2].content, '{"url":"https://media.gipity.ai/fox.png"}');
});

test('a clear error when the client SDK is missing', async () => {
  const bot = createChatbot({ persona });
  bot.on('error', () => {});
  await assert.rejects(bot.send('hi'), /client SDK/);
});

for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log('  ok   -', name); }
  catch (e) { failed++; console.error('  FAIL -', name, '\n        ', e.stack || e.message); }
}
console.log('');
console.log(`engine.test.js: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
