// The conversation store behind the chat sidebar (functions/chats.js).

const msg = (role, content) => ({ role, content });

test('saves, lists, loads, appends and rewrites a conversation', async (ctx) => {
  const as = (body) => ctx.fn.callAs(ctx.users.alice, 'chats', body);

  const { id } = await as({ action: 'create', title: 'Sales question', messages: [msg('user', 'How were sales?'), msg('assistant', 'Up 12%.')] });
  assert.ok(id.startsWith('chat_'));

  await as({ action: 'write', id, from: 2, messages: [msg('user', 'And returns?'), msg('assistant', 'Down 3%.')] });
  let { conversation } = await as({ action: 'load', id });
  assert.deepEqual(conversation.messages.map(m => m.content), ['How were sales?', 'Up 12%.', 'And returns?', 'Down 3%.']);

  // A regenerate rewrites the tail.
  await as({ action: 'write', id, from: 3, messages: [msg('assistant', 'Returns fell 3% to 41 orders.')] });
  ({ conversation } = await as({ action: 'load', id }));
  assert.equal(conversation.messages.length, 4);
  assert.equal(conversation.messages[3].content, 'Returns fell 3% to 41 orders.');

  await as({ action: 'rename', id, title: 'Q3 sales' });
  const { conversations } = await as({ action: 'list' });
  assert.deepEqual(conversations.map(c => [c.id, c.title]), [[id, 'Q3 sales']]);
});

test('keeps rich messages (tool calls, image blocks) exactly', async (ctx) => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'What is this?' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }], attachments: [{ kind: 'image', name: 'a.jpg' }] },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'query_data', arguments: '{"sql":"SELECT 1"}' } }] },
    { role: 'tool', tool_call_id: 'call_1', name: 'query_data', content: '{"rows":[]}' },
  ];
  const { id } = await ctx.fn.callAs(ctx.users.alice, 'chats', { action: 'create', title: 't', messages });
  const { conversation } = await ctx.fn.callAs(ctx.users.alice, 'chats', { action: 'load', id });
  assert.deepEqual(conversation.messages, messages);
});

test("one user can't see, change or delete another user's conversations", async (ctx) => {
  const { id } = await ctx.fn.callAs(ctx.users.alice, 'chats', { action: 'create', title: 'private', messages: [msg('user', 'secret')] });
  const bob = (body) => ctx.fn.callAs(ctx.users.bob, 'chats', body);

  assert.deepEqual((await bob({ action: 'list' })).conversations, []);
  assert.equal((await bob({ action: 'load', id })).conversation, null);
  assert.equal((await bob({ action: 'write', id, from: 0, messages: [] })).error, 'Conversation not found.');
  assert.equal((await bob({ action: 'rename', id, title: 'mine now' })).error, 'Conversation not found.');
  await bob({ action: 'remove', id });

  const still = await ctx.fn.callAs(ctx.users.alice, 'chats', { action: 'load', id });
  assert.equal(still.conversation.title, 'private');
  assert.equal(still.conversation.messages.length, 1);
});

test('remove deletes the conversation and its messages', async (ctx) => {
  const as = (body) => ctx.fn.callAs(ctx.users.alice, 'chats', body);
  const { id } = await as({ action: 'create', title: 'gone soon', messages: [msg('user', 'x')] });
  await as({ action: 'remove', id });
  assert.equal((await as({ action: 'load', id })).conversation, null);
});

test('rejects bad input with a readable error', async (ctx) => {
  const as = (body) => ctx.fn.callAs(ctx.users.alice, 'chats', body);
  assert.match((await as({ action: 'create', title: 't', messages: 'nope' })).error, /array/);
  assert.match((await as({ action: 'explode' })).error, /action must be/);
  const { id } = await as({ action: 'create', title: 't', messages: [] });
  assert.match((await as({ action: 'write', id, from: -1, messages: [] })).error, /whole number/);
});

test('signed-out callers are refused', async (ctx) => {
  await assert.rejects(() => ctx.fn.call('chats', { action: 'list' }), /401/);
});
