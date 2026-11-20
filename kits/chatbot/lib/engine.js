/**
 * @gipity/chatbot: headless engine.
 *
 * createChatbot(config) returns the chat "brain": no DOM, no UI. The widget
 * uses it; apps that want their own UI use it directly:
 *
 *   const bot = createChatbot(config);
 *   bot.on('delta', (text) => append(text));
 *   bot.on('tool_start', ({ name }) => showStep(name));
 *   await bot.send('how many orders shipped last week?');
 *
 * One turn: the engine streams the model's answer from the app LLM service.
 * When the model asks for a tool, the engine runs it (an app function, called
 * as the signed-in visitor, or browser code), hands the result back and lets
 * the model continue, up to model.maxToolSteps rounds. The loop is the whole
 * "agent": the model, its context limits and the billing are the platform's.
 *
 * Network goes through the Gipity client SDK (window.Gipity), which every
 * deployed page loads: it finds this app's API, mints the app token and sends
 * the visitor's session, so a signed-in visitor's tool calls run as them.
 */

import { validateConfig, ChatbotConfigError, estimateTokens } from './config.js';
import { buildSystemPrompt } from './prompt.js';
import { localStore } from './stores.js';

export { ChatbotConfigError };

/** Most messages one request carries; older turns drop out of what the model sees. */
export const WINDOW_MAX_MESSAGES = 200;
/** Rough character budget for one request's messages (about 75k tokens). */
export const WINDOW_MAX_CHARS = 300_000;
/** An image counts this much against the budget (about 1,600 tokens). */
const IMAGE_CHARS = 6_400;
/** A tool result longer than this is cut, and the model is told it was. */
export const TOOL_RESULT_MAX_CHARS = 30_000;

/** Size of one message for the request budget. */
function messageChars(m) {
  let n = 0;
  if (typeof m.content === 'string') n += m.content.length;
  else if (Array.isArray(m.content)) {
    for (const b of m.content) n += b.type === 'text' ? b.text.length : IMAGE_CHARS;
  }
  if (m.tool_calls) n += JSON.stringify(m.tool_calls).length;
  return n;
}

/**
 * The slice of the conversation sent with one request: the newest messages
 * that fit WINDOW_MAX_MESSAGES and WINDOW_MAX_CHARS, starting at a user
 * message so a tool result is never separated from the call that asked for it.
 * The full conversation stays in history().
 */
export function requestWindow(messages) {
  let start = messages.length;
  let chars = 0;
  while (start > 0 && messages.length - start < WINDOW_MAX_MESSAGES) {
    const size = messageChars(messages[start - 1]);
    if (chars + size > WINDOW_MAX_CHARS && start < messages.length) break;
    chars += size;
    start--;
  }
  const window = messages.slice(start);
  while (window.length > 0 && window[0].role !== 'user') window.shift();
  return window;
}

/** What the LLM service accepts; display-only fields stay local. */
function toWire(m) {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
  if (m.role === 'assistant') {
    return { role: 'assistant', content: m.content || null, ...(m.tool_calls && { tool_calls: m.tool_calls }) };
  }
  return { role: m.role, content: m.content };
}

/**
 * Turn a failed service call into an error with a `visitorMessage` the widget
 * can show a real end user; the developer detail goes to the console.
 */
function serviceError(err) {
  const status = err?.status;
  const code = err?.code;
  const raw = err?.message || String(err);
  let message = `chatbot: the LLM call failed${status ? ` (${status})` : ''}: ${raw}`;
  let visitorMessage = 'Sorry, I had trouble answering just then. Please try again.';
  if (status === 401 && code === 'LOGIN_REQUIRED') {
    message = 'chatbot: the LLM service is in `user_pays` mode, so signed-out visitors must sign in. '
      + 'A public chatbot must be owner-paid: run `gipity deploy` (installing this kit declares '
      + '`llm: owner_pays` under the `services` phase in gipity.yaml), or sign the visitor in first.';
    visitorMessage = 'Please sign in to chat.';
  } else if (status === 402) {
    message = `chatbot: the app is out of credits (${raw}). Top up with \`gipity credits buy\`.`;
    visitorMessage = 'The assistant is unavailable right now. Please try again later.';
  } else if (status === 429) {
    visitorMessage = "You're sending messages quickly. Wait a minute and try again.";
  } else if (status === 400) {
    // A request the service refused (too long for the model, a model that can't
    // see images or call tools): the reason is ours and safe to show.
    visitorMessage = raw;
  }
  const out = new Error(message);
  out.visitorMessage = visitorMessage;
  out.status = status;
  out.code = code;
  return out;
}

/** Model-facing text for a tool result, cut to TOOL_RESULT_MAX_CHARS. */
function toolResultText(value) {
  let text;
  if (value === undefined || value === null) text = 'null';
  else if (typeof value === 'string') text = value;
  else {
    try { text = JSON.stringify(value); } catch { text = String(value); }
  }
  if (text.length > TOOL_RESULT_MAX_CHARS) {
    text = text.slice(0, TOOL_RESULT_MAX_CHARS)
      + `\n[result cut at ${TOOL_RESULT_MAX_CHARS} of ${text.length} characters: ask for less, e.g. a narrower query]`;
  }
  return text;
}

const FILE_TAG = (name, text) => `<file name="${String(name).replace(/"/g, "'")}">\n${text}\n</file>`;

/**
 * Build a chatbot engine from a config object. Throws ChatbotConfigError
 * synchronously if the config is invalid. URL knowledge is fetched on the
 * first send() so a bad URL doesn't block construction.
 *
 * @param {object} rawConfig
 * @param {object} [options]
 * @param {object} [options.gipity] the client SDK (defaults to window.Gipity; tests pass a stub)
 */
export function createChatbot(rawConfig, options = {}) {
  const config = validateConfig(rawConfig);

  const listeners = new Map(); // event -> Set<fn>
  let messages = [];
  let fetchedKnowledge = '';
  let knowledgeReady = config.knowledge.fetchUrls.length === 0;
  let knowledgePromise = null;
  let busy = false;
  let abort = null;
  let route = config.model.route;

  const p = config.storage.persist;
  const store = p === 'none' ? null : p === 'local' ? localStore(config.storage.localKey) : p;
  let conversationId = null;
  let conversationTitle = null;
  let savedCount = 0;

  // Tools the model may call: the configured ones plus built-ins from features.
  const tools = [...config.tools];
  if (config.features.imageGen.enabled) {
    tools.push({
      name: 'generate_image',
      description: 'Create an image from a text description. Returns { url }. Show it to the user with markdown: ![short description](url).',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What the image should show, in detail' },
          aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'] },
        },
        required: ['prompt'],
      },
      function: null,
      confirm: false,
      run: async ({ prompt, aspect_ratio }) => {
        const body = { prompt, ...(aspect_ratio && { aspect_ratio }), ...(config.features.imageGen.quality && { quality: config.features.imageGen.quality }) };
        const out = await sdk().service('image', body);
        return { url: out.url };
      },
    });
  }
  const toolsByName = new Map(tools.map(t => [t.name, t]));
  const wireTools = tools.length
    ? tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
    : undefined;

  /** Cut the conversation to n messages; the next save rewrites from there. */
  function truncate(n) {
    messages.length = n;
    savedCount = Math.min(savedCount, n);
  }

  function sdk() {
    const g = options.gipity ?? globalThis.Gipity;
    if (!g?.serviceStream) {
      throw new Error('chatbot: the Gipity client SDK (window.Gipity, v1.0.26+) is not on this page. Deployed Gipity pages load it automatically; elsewhere add <script src="https://media.gipity.ai/client/v1/gipity.js" data-app="<app guid>"></script>.');
    }
    return g;
  }

  function on(event, cb) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(cb);
    return () => listeners.get(event)?.delete(cb);
  }

  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      try { cb(payload); } catch (err) { console.error(`[chatbot] listener for ${event} threw:`, err); }
    }
  }

  /** Fetch URL knowledge once; failures are fatal (a missing source makes the bot guess). */
  async function ensureKnowledge() {
    if (knowledgeReady) return;
    if (knowledgePromise) return knowledgePromise;
    knowledgePromise = (async () => {
      const parts = [];
      for (const url of config.knowledge.fetchUrls) {
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) throw new Error(`chatbot: knowledge URL fetch failed for ${url} (${res.status})`);
        parts.push(await res.text());
      }
      const combined = parts.join('\n\n').trim();
      const total = estimateTokens(config.knowledge.inlineText) + estimateTokens(combined);
      if (total > config.knowledge.maxTokens) {
        throw new ChatbotConfigError(
          `knowledge total is ${total} tokens, exceeds maxTokens=${config.knowledge.maxTokens}. Trim sources or raise budget.`,
        );
      }
      fetchedKnowledge = combined;
      knowledgeReady = true;
      emit('knowledge_loaded', { tokens: total });
    })().finally(() => { knowledgePromise = null; });
    return knowledgePromise;
  }

  function requestBody() {
    const body = {
      messages: requestWindow(messages).map(toWire),
      system_prompt: buildSystemPrompt(config, fetchedKnowledge, { tools }),
      stream: true,
      temperature: config.model.temperature,
      max_tokens: config.model.maxTokens,
      ...(wireTools && { tools: wireTools }),
    };
    // 'default' means the app's default model: send no model field at all.
    if (route !== 'default') body.model = route;
    return body;
  }

  /** Stream one model call. Resolves { text, toolCalls, finish, credits, inputTokens, outputTokens }. */
  async function streamOnce(signal, partial) {
    const out = { text: '', toolCalls: [], finish: null, credits: 0, inputTokens: 0, outputTokens: 0 };
    for await (const chunk of sdk().serviceStream('llm', requestBody(), { signal })) {
      const choice = chunk.choices?.[0];
      if (chunk.error || choice?.finish_reason === 'error') {
        throw serviceError({ message: chunk.error || 'the model stopped with an error' });
      }
      const delta = choice?.delta?.content;
      if (delta) {
        out.text += delta;
        partial.text = out.text;
        emit('delta', delta);
      }
      for (const tc of choice?.delta?.tool_calls ?? []) {
        out.toolCalls.push({ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments || '{}' } });
      }
      if (choice?.finish_reason) {
        out.finish = choice.finish_reason;
        out.credits = chunk.credits_used ?? 0;
        out.inputTokens = chunk.usage?.prompt_tokens ?? 0;
        out.outputTokens = chunk.usage?.completion_tokens ?? 0;
      }
    }
    return out;
  }

  /** Ask the UI to approve a tool; with no UI listening, the answer is no. */
  function askConfirm(call, def, args) {
    if (!listeners.get('confirm')?.size) {
      console.warn(`[chatbot] tool ${def.name} needs confirmation but nothing listens for 'confirm'; declined.`);
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      let answered = false;
      const answer = (ok) => { if (!answered) { answered = true; resolve(ok); } };
      emit('confirm', { id: call.id, name: def.name, args, approve: () => answer(true), deny: () => answer(false) });
      abort?.signal.addEventListener('abort', () => answer(false), { once: true });
    });
  }

  async function runTool(call) {
    const name = call.function.name;
    const def = toolsByName.get(name);
    if (!def) return toolResultText({ error: `There is no tool named ${name}.` });
    let args;
    try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = null; }
    if (!args || typeof args !== 'object') return toolResultText({ error: 'The tool arguments were not valid JSON.' });

    if (def.confirm && !(await askConfirm(call, def, args))) {
      emit('tool_end', { id: call.id, name, args, declined: true });
      return toolResultText({ error: 'The user declined to run this. Ask what they want instead.' });
    }

    emit('tool_start', { id: call.id, name, args });
    try {
      const result = def.function ? await sdk().fn(def.function, args) : await def.run(args);
      emit('tool_end', { id: call.id, name, args, result });
      return toolResultText(result);
    } catch (err) {
      const signIn = err?.status === 401 || err?.code === 'LOGIN_REQUIRED' || err?.code === 'CONSENT_REQUIRED';
      if (signIn) emit('auth_required', { tool: name });
      const error = signIn ? 'The user must sign in before this tool can run. Ask them to sign in.' : (err?.message || String(err));
      emit('tool_end', { id: call.id, name, args, error });
      return toolResultText({ error });
    }
  }

  /** Run the model (and its tools) until it answers. History already ends with the user's message. */
  async function runTurn() {
    if (busy) throw new Error('chatbot: a reply is already in progress');
    busy = true;
    abort = new AbortController();
    const signal = abort.signal;
    const turnStart = messages.length;
    const totals = { credits: 0, inputTokens: 0, outputTokens: 0 };
    const partial = { text: '' };
    emit('start');
    try {
      await ensureKnowledge();
      for (let step = 1; ; step++) {
        partial.text = '';
        const r = await streamOnce(signal, partial);
        totals.credits += r.credits;
        totals.inputTokens += r.inputTokens;
        totals.outputTokens += r.outputTokens;
        const reply = { role: 'assistant', content: r.text || null, ts: Date.now() };
        if (r.toolCalls.length) reply.tool_calls = r.toolCalls;
        if (r.finish === 'length') reply.truncated = true;
        messages.push(reply);
        emit('message', reply);
        if (!r.toolCalls.length) break;

        for (const call of r.toolCalls) {
          const content = signal.aborted ? toolResultText({ error: 'Cancelled by the user.' }) : await runTool(call);
          const result = { role: 'tool', tool_call_id: call.id, name: call.function.name, content, ts: Date.now() };
          messages.push(result);
          emit('message', result);
        }
        if (signal.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
        if (step >= config.model.maxToolSteps) {
          const note = { role: 'assistant', content: `I stopped after ${step} tool steps without a final answer. Ask me to continue, or narrow the question.`, ts: Date.now() };
          messages.push(note);
          emit('message', note);
          break;
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError' || signal.aborted) {
        // Keep what streamed so far; drop a dangling tool call (its result never came).
        const last = messages[messages.length - 1];
        if (!(last && last.role === 'assistant' && !last.tool_calls && messages.length > turnStart)) {
          messages.push({ role: 'assistant', content: partial.text || '(stopped)', stopped: true, ts: Date.now() });
        }
      } else {
        // A failed turn leaves no half-finished steps behind.
        truncate(turnStart);
        busy = false;
        abort = null;
        const e = err?.visitorMessage ? err : serviceError(err);
        emit('error', e);
        throw e;
      }
    }
    busy = false;
    abort = null;
    const final = messages[messages.length - 1];
    final.usage = totals;
    emit('usage', totals);
    emit('complete', final);
    await persist();
    return final;
  }

  /**
   * Send a user message and run the reply.
   * @param {string} text
   * @param {{ attachments?: Array<{kind:'image', name, dataUrl} | {kind:'file', name, text}> }} [opts]
   *   attachments from readAttachment(file)
   */
  async function send(text, opts = {}) {
    const attachments = opts.attachments ?? [];
    if ((typeof text !== 'string' || !text.trim()) && attachments.length === 0) {
      throw new Error('chatbot.send: send some text or an attachment');
    }
    if (busy) throw new Error('chatbot: a reply is already in progress');
    const images = attachments.filter(a => a.kind === 'image');
    const files = attachments.filter(a => a.kind === 'file');
    if (images.length && !config.features.vision.enabled) throw new Error('chatbot: image attachments need features.vision.enabled');
    if (files.length && !config.features.files.enabled) throw new Error('chatbot: file attachments need features.files.enabled');
    for (const f of files) {
      if (f.text.length > config.features.files.maxChars) {
        throw new Error(`"${f.name}" is ${f.text.length.toLocaleString()} characters; the limit is ${config.features.files.maxChars.toLocaleString()}.`);
      }
    }

    // A message whose reply failed is replaced, not stacked.
    if (messages.length && messages[messages.length - 1].role === 'user') truncate(messages.length - 1);

    const typed = (text || '').trim();
    const fullText = [typed, ...files.map(f => FILE_TAG(f.name, f.text))].filter(Boolean).join('\n\n');
    const content = images.length
      ? [...(fullText ? [{ type: 'text', text: fullText }] : []), ...images.map(i => ({ type: 'image_url', image_url: { url: i.dataUrl } }))]
      : fullText;
    const userMsg = { role: 'user', content, ts: Date.now() };
    if (attachments.length) {
      userMsg.display = typed;
      userMsg.attachments = attachments.map(a => ({ kind: a.kind, name: a.name }));
    }
    messages.push(userMsg);
    emit('message', userMsg);
    try {
      return await runTurn();
    } catch (err) {
      // Hand the text back so the UI can restore it to the composer.
      if (messages[messages.length - 1] === userMsg) truncate(messages.length - 1);
      err.unsentText = typed;
      throw err;
    }
  }

  /** Drop the last reply and ask again. */
  async function regenerate() {
    if (busy) throw new Error('chatbot: a reply is already in progress');
    const lastUser = messages.map(m => m.role).lastIndexOf('user');
    if (lastUser < 0) throw new Error('chatbot: nothing to regenerate');
    truncate(lastUser + 1);
    emit('history');
    return runTurn();
  }

  /** Replace the last user message with new text and run the reply again. */
  async function editLast(text) {
    if (busy) throw new Error('chatbot: a reply is already in progress');
    const lastUser = messages.map(m => m.role).lastIndexOf('user');
    if (lastUser < 0) throw new Error('chatbot: no message to edit');
    const prev = messages[lastUser];
    truncate(lastUser);
    emit('history');
    // Images from the original message stay with the edited one.
    const imageBlocks = Array.isArray(prev.content) ? prev.content.filter(b => b.type === 'image_url') : [];
    const attachments = imageBlocks.map((b, i) => ({ kind: 'image', name: prev.attachments?.[i]?.name ?? 'image', dataUrl: b.image_url.url }));
    return send(text, { attachments });
  }

  /** Stop the reply in progress. What streamed so far is kept. */
  function stop() {
    abort?.abort();
  }

  // --- Saved conversations ---

  async function persist() {
    if (!store) return;
    try {
      if (!conversationId) {
        const firstUser = messages.find(m => m.role === 'user');
        const title = titleFrom(firstUser);
        const { id } = await store.create({ title, messages });
        conversationId = id;
        conversationTitle = title;
        savedCount = messages.length;
        emit('conversation', { id, title });
        emit('conversations');
        if (config.storage.autoTitle) autoTitle(id, firstUser);
        return;
      }
      const from = Math.min(savedCount, messages.length);
      await store.write(conversationId, from, messages.slice(from));
      savedCount = messages.length;
      emit('conversations');
    } catch (err) {
      const e = new Error(`chatbot: saving the conversation failed: ${err?.message || err}`);
      e.visitorMessage = 'This conversation could not be saved.';
      emit('error', e);
    }
  }

  function titleFrom(userMsg) {
    const text = (userMsg?.display ?? (typeof userMsg?.content === 'string' ? userMsg.content : userMsg?.content?.find?.(b => b.type === 'text')?.text) ?? '').trim();
    const line = text.split('\n')[0] || userMsg?.attachments?.[0]?.name || 'New chat';
    return line.length > 60 ? `${line.slice(0, 57)}...` : line;
  }

  /** Name the conversation with a small, cheap model call. Cosmetic: a failure keeps the first-line title. */
  async function autoTitle(id, firstUser) {
    try {
      const reply = messages.find(m => m.role === 'assistant' && m.content)?.content ?? '';
      const res = await sdk().service('llm', {
        model: 'small',
        max_tokens: 24,
        temperature: 0.2,
        system_prompt: 'Write a 2 to 6 word title for this conversation. Reply with the title only, no quotes or punctuation at the end.',
        prompt: `User: ${titleFrom(firstUser)}\n\nAssistant: ${String(reply).slice(0, 800)}`,
      });
      const title = String(res?.choices?.[0]?.message?.content ?? '').trim().replace(/^["']|["'.]$/g, '').slice(0, 80);
      if (!title) return;
      await store.rename(id, title);
      if (conversationId === id) {
        conversationTitle = title;
        emit('conversation', { id, title });
      }
      emit('conversations');
    } catch (err) {
      console.warn('[chatbot] auto-title failed; keeping the first-line title:', err?.message || err);
    }
  }

  function requireStore() {
    if (!store) throw new Error("chatbot: saved conversations need storage.persist ('local' or a store)");
    return store;
  }

  /** Saved conversations, newest first: [{ id, title, updatedAt }]. */
  async function conversations() {
    return requireStore().list();
  }

  async function open(id) {
    const conv = await requireStore().load(id);
    if (!conv) throw new Error(`chatbot: conversation ${id} not found`);
    stop();
    messages = conv.messages ?? [];
    conversationId = conv.id;
    conversationTitle = conv.title;
    savedCount = messages.length;
    emit('conversation', { id: conv.id, title: conv.title });
    emit('history');
  }

  function newChat() {
    stop();
    messages = [];
    conversationId = null;
    conversationTitle = null;
    savedCount = 0;
    emit('conversation', { id: null, title: null });
    emit('reset');
  }

  async function remove(id) {
    await requireStore().remove(id);
    if (id === conversationId) newChat();
    emit('conversations');
  }

  async function rename(id, title) {
    await requireStore().rename(id, title);
    if (id === conversationId) {
      conversationTitle = title;
      emit('conversation', { id, title });
    }
    emit('conversations');
  }

  return {
    /** Send a user message (and attachments); streams via 'delta', runs tools, resolves with the final reply. */
    send,
    /** Stop the reply in progress. */
    stop,
    /** Drop the last reply and ask again. */
    regenerate,
    /** Replace the last user message and ask again. */
    editLast,
    /** Start a new, empty conversation. */
    reset: newChat,
    newChat,
    /** Snapshot of the conversation (excluding the system prompt). */
    history: () => messages.slice(),
    /** True while a reply is streaming or a tool is running. */
    isBusy: () => busy,
    /** The model route in use; setModel switches it for later messages. */
    getModel: () => route,
    setModel: (r) => {
      if (typeof r !== 'string' || !r.trim()) throw new Error('chatbot.setModel: pass a model route');
      route = r;
    },
    /** Saved conversations (needs storage.persist). */
    conversations,
    open,
    remove,
    rename,
    /** The open conversation: { id, title } (id is null until the first reply is saved). */
    current: () => ({ id: conversationId, title: conversationTitle }),
    hasStore: () => !!store,
    /**
     * Events: start | delta | message | tool_start | tool_end | confirm | usage |
     * complete | error | reset | history | conversation | conversations |
     * auth_required | knowledge_loaded
     */
    on,
    /** The validated, normalized config. */
    config,
  };
}
