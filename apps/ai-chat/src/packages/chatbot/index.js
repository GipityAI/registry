/**
 * @gipity/chatbot
 *
 * A chatbot for any Gipity app. Two ways to use it:
 *
 * 1) The widget: a corner bubble, an inline panel, or a full-page chat:
 *
 *      <chatbot-widget id="bot"></chatbot-widget>
 *      <script type="module">
 *        import { mount } from '@gipity/chatbot';
 *        import config from './js/chatbot.config.js';
 *        mount('#bot', config);
 *      </script>
 *
 * 2) The headless engine: bring your own UI (an in-game NPC box, a sidebar):
 *
 *      import { createChatbot } from '@gipity/chatbot';
 *      const bot = createChatbot(config);
 *      bot.on('delta', (t) => myUi.append(t));
 *      await bot.send('how do I fly?');
 *
 * Config: persona, scope guardrails, static knowledge (20k token budget),
 * tools (the app's own functions, called as the signed-in visitor), saved
 * conversations, photos and text files, voice, image generation and a model
 * picker. See README.md.
 */

import { createChatbot, ChatbotConfigError, requestWindow } from './lib/engine.js';
import { ChatbotWidget, registerWidget } from './lib/widget.js';
import { validateConfig, estimateTokens, DEFAULT_KNOWLEDGE_MAX_TOKENS } from './lib/config.js';
import { buildSystemPrompt } from './lib/prompt.js';
import { localStore, functionStore } from './lib/stores.js';
import { renderMarkdown } from './lib/markdown.js';
import { readAttachment, isSupportedFile } from './lib/attachments.js';
import { startRecording, speak, speakableText } from './lib/voice.js';

// Register the custom element as soon as the kit is imported. Idempotent.
registerWidget();

/**
 * Mount the widget onto a host element.
 *
 * @param {string|HTMLElement} target CSS selector or element. A <chatbot-widget>
 *   gets the config directly; anything else gets a new <chatbot-widget> inside it.
 * @param {object} config chatbot config (see README)
 * @returns {ChatbotWidget} the element; its `.bot` is the engine
 */
export function mount(target, config) {
  registerWidget();
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) throw new Error(`@gipity/chatbot: mount target not found (${target})`);
  let el = host;
  if (host.tagName?.toLowerCase() !== 'chatbot-widget') {
    el = document.createElement('chatbot-widget');
    host.appendChild(el);
  }
  el.setConfig(config);
  return el;
}

export {
  createChatbot,
  ChatbotWidget,
  ChatbotConfigError,
  validateConfig,
  estimateTokens,
  buildSystemPrompt,
  requestWindow,
  DEFAULT_KNOWLEDGE_MAX_TOKENS,
  localStore,
  functionStore,
  renderMarkdown,
  readAttachment,
  isSupportedFile,
  startRecording,
  speak,
  speakableText,
};

export default createChatbot;
