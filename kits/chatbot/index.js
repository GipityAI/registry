/**
 * @gipity/chatbot
 *
 * Drop-in chatbot for Gipity apps. Two ways to use:
 *
 * 1) Default widget — bubble in the corner of your page:
 *
 *      <chatbot-widget id="bot"></chatbot-widget>
 *      <script type="module">
 *        import { mount } from '@gipity/chatbot';
 *        mount('#bot', myChatbotConfig);
 *      </script>
 *
 * 2) Headless engine — bring your own UI (e.g. an in-game NPC dialogue box):
 *
 *      import { createChatbot } from '@gipity/chatbot';
 *      const bot = createChatbot(myChatbotConfig);
 *      bot.on('delta', (t) => myCustomUi.append(t));
 *      await bot.send('how do I fly?');
 *
 * Configure persona, scope guardrails, static knowledge (20k token budget),
 * features (voice/vision/imageGen — wired in later PRs), and a project-function
 * tool allowlist. See README.md for the full config shape and examples/ for
 * worked drop-ins.
 */

import { createChatbot, ChatbotConfigError } from './lib/engine.js';
import { ChatbotWidget, registerWidget } from './lib/widget.js';
import { validateConfig, estimateTokens, DEFAULT_KNOWLEDGE_MAX_TOKENS } from './lib/config.js';
import { buildSystemPrompt } from './lib/prompt.js';

// Register the custom element as soon as the kit is imported. Idempotent.
registerWidget();

/**
 * Mount the bubble widget onto a host element.
 *
 * @param {string|HTMLElement} target — CSS selector or element. If a <chatbot-widget>,
 *   the config is applied directly. Otherwise a new <chatbot-widget> is appended into it.
 * @param {object} config — chatbot config (see README).
 * @returns {ChatbotWidget}
 */
export function mount(target, config) {
  registerWidget();
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) throw new Error(`@gipity/chatbot: mount target not found (${target})`);

  let el;
  if (host.tagName?.toLowerCase() === 'chatbot-widget') {
    el = host;
  } else {
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
  DEFAULT_KNOWLEDGE_MAX_TOKENS,
};

export default createChatbot;
