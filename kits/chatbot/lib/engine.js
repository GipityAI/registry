/**
 * @gipity/chatbot — headless engine.
 *
 * createChatbot(config) returns the chat "brain" — no DOM, no UI. The widget
 * uses it internally; apps that want their own UI (e.g. an in-game NPC dialog
 * box) consume this directly:
 *
 *   const bot = createChatbot(config);
 *   bot.on('delta', (text) => append(text));
 *   bot.on('complete', () => stopThinking());
 *   await bot.send('how do I fly the ship?');
 *
 * Network: calls the platform API's /api/token then /services/llm (base
 * resolved from the deploy-stamped data-api-base tag below). Resolves
 * the app GUID from window.__GIPITY_APP_GUID or <meta name="gipity-app">,
 * matching the realtime kit's convention.
 */

import { validateConfig, ChatbotConfigError, estimateTokens } from './config.js';
import { buildSystemPrompt } from './prompt.js';

// The API base for THIS app's server, from the deploy-stamped SDK tag (data-api-base)
// — a page deployed by a local dev server must call that server, not prod, where the
// app doesn't exist. Falls back to prod for pages older than the stamp. Matches the
// realtime kit's resolution.
const API_BASE = (typeof document !== 'undefined'
  && document.querySelector('script[data-api-base]')?.getAttribute('data-api-base')?.replace(/\/+$/, ''))
  || 'https://a.gipity.ai';
const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 min; token is good for ~15

export { ChatbotConfigError };

/**
 * Turn an /services/llm failure into an error that says what to DO about it,
 * plus a `visitorMessage` the widget can show a real end-user (the developer
 * detail goes to the console, never into the chat bubble).
 *
 * The one failure worth naming: a signed-out visitor hitting an app whose llm
 * service is still in `user_pays` mode gets 401 LOGIN_REQUIRED. Installing this
 * kit declares `llm: owner_pays` in gipity.yaml, so this only happens when the
 * app was never redeployed after `gipity add chatbot`, or the mode was changed
 * back by hand.
 */
function buildServiceError(status, errText) {
  let message = `chatbot: LLM call failed (${status}): ${errText}`;
  let visitorMessage = 'Sorry, I had trouble answering just then. Please try again.';
  if (status === 401 && /LOGIN_REQUIRED/.test(errText)) {
    message = 'chatbot: the LLM service is in `user_pays` mode, so signed-out visitors are told to log in. '
      + 'A public chatbot must be owner-paid: run `gipity deploy dev` (installing this kit declares '
      + '`llm: owner_pays` under the `services` phase in gipity.yaml), or set that phase by hand if it was removed.';
  }
  const err = new Error(message);
  err.visitorMessage = visitorMessage;
  return err;
}

/**
 * Build a chatbot engine from a config object.
 *
 * Throws ChatbotConfigError synchronously if the config is invalid. URL-based
 * knowledge fetches happen lazily on first send() so a bad URL doesn't block
 * construction.
 *
 * @param {object} rawConfig
 * @returns {ChatbotEngine}
 */
export function createChatbot(rawConfig) {
  const config = validateConfig(rawConfig);

  const listeners = new Map(); // event -> Set<fn>
  const messages = [];          // { role, content } for /services/llm
  let fetchedKnowledge = '';
  let knowledgeReady = config.knowledge.fetchUrls.length === 0;
  let knowledgePromise = null;
  let token = null;
  let tokenFetchedAt = 0;
  let tokenPromise = null;

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

  function resolveAppGuid() {
    if (typeof window === 'undefined') return null;
    if (window.__GIPITY_APP_GUID) return window.__GIPITY_APP_GUID;
    const meta = typeof document !== 'undefined'
      ? document.querySelector('meta[name="gipity-app"]')
      : null;
    return meta?.content || null;
  }

  async function acquireToken() {
    const fresh = token && Date.now() - tokenFetchedAt < TOKEN_TTL_MS;
    if (fresh) return token;
    if (tokenPromise) return tokenPromise;
    const guid = resolveAppGuid();
    if (!guid) throw new Error('chatbot: no app GUID — set window.__GIPITY_APP_GUID or deploy via `gipity deploy`');
    tokenPromise = (async () => {
      const res = await fetch(`${API_BASE}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app: guid }),
      });
      if (!res.ok) throw new Error(`chatbot: token fetch failed (${res.status})`);
      const { data } = await res.json();
      token = data.token;
      tokenFetchedAt = Date.now();
      return token;
    })().finally(() => { tokenPromise = null; });
    return tokenPromise;
  }

  /**
   * Fetch the URL knowledge sources once. Result is concatenated and joined
   * into the system prompt at every send(). Failures here are fatal — we don't
   * silently skip a knowledge source the user told us about.
   */
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
      const inlineTokens = estimateTokens(config.knowledge.inlineText);
      const fetchedTokens = estimateTokens(combined);
      const total = inlineTokens + fetchedTokens;
      if (total > config.knowledge.maxTokens) {
        throw new ChatbotConfigError(
          `knowledge total is ${total} tokens (inline ${inlineTokens} + fetched ${fetchedTokens}), ` +
          `exceeds maxTokens=${config.knowledge.maxTokens}. Trim sources or raise budget.`,
        );
      }
      fetchedKnowledge = combined;
      knowledgeReady = true;
      emit('knowledge_loaded', { tokens: total });
    })().finally(() => { knowledgePromise = null; });
    return knowledgePromise;
  }

  async function send(userText) {
    if (typeof userText !== 'string' || !userText.trim()) {
      throw new Error('chatbot.send: userText must be a non-empty string');
    }

    await ensureKnowledge();

    const userMsg = { role: 'user', content: userText };
    messages.push(userMsg);
    emit('message', userMsg);

    const systemPrompt = buildSystemPrompt(config, fetchedKnowledge);
    const tk = await acquireToken();
    const guid = resolveAppGuid();

    const body = {
      messages,
      system_prompt: systemPrompt,
      stream: true,
      temperature: config.model.temperature,
      max_tokens: config.model.maxTokens,
    };

    // route 'default' means "whatever the project's default_model is". The LLM
    // service has no 'default' alias, so send no model field at all and let it
    // resolve; anything else (a tier alias like 'medium' or a concrete id) goes
    // through as-is.
    if (config.model.route !== 'default') {
      body.model = config.model.route;
    }

    let assistantText = '';
    emit('start');

    const res = await fetch(`${API_BASE}/api/${guid}/services/llm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Token': tk,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = buildServiceError(res.status, errText);
      emit('error', err);
      throw err;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6);
        if (raw === '[DONE]') break;
        let chunk;
        try { chunk = JSON.parse(raw); } catch { continue; }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          assistantText += delta;
          emit('delta', delta);
        }
        if (chunk.choices?.[0]?.finish_reason) {
          emit('usage', chunk.usage ?? null);
        }
      }
    }

    const assistantMsg = { role: 'assistant', content: assistantText };
    messages.push(assistantMsg);
    emit('message', assistantMsg);
    emit('complete', assistantMsg);

    return assistantMsg;
  }

  function reset() {
    messages.length = 0;
    emit('reset');
  }

  function history() {
    return messages.slice();
  }

  return {
    /** Send a user message. Streams deltas via the 'delta' event. */
    send,
    /** Clear conversation history. */
    reset,
    /** Snapshot of the message history (excluding the system prompt). */
    history,
    /** Subscribe to engine events: 'start' | 'delta' | 'usage' | 'message' | 'complete' | 'reset' | 'error' | 'knowledge_loaded'. */
    on,
    /** The validated, normalized config. UIs can read persona/ui from here. */
    config,
  };
}
