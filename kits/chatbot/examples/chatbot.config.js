/**
 * Your chatbot's config. `gipity add chatbot` scaffolds this file; edit it in place.
 *
 * Wire it up by pasting these two blocks into your page (index.html):
 *
 *   <chatbot-widget id="bot"></chatbot-widget>
 *
 *   <script type="module">
 *     import { mount } from '@gipity/chatbot';
 *     import config from './js/chatbot.config.js';
 *     mount('#bot', config);          // (selector-or-element, config) -> the widget element
 *   </script>
 *
 * That's the whole integration - no backend, no API keys. Then `gipity deploy dev`.
 * For a custom UI instead of the corner bubble, see `createChatbot()` in README.md.
 */
export default {
  persona: {
    // Required. The name shown in the panel header.
    name: 'Aria',
    // Required. Who the bot is and what it helps with.
    instructions: 'You are Aria, the friendly helper for our site. Answer visitor questions using the knowledge below.',
    tone: 'Friendly, warm, brief - like a helpful person behind the counter.',
    // Optional. Shown as the first message when the panel opens.
    greeting: 'Hi! Ask me anything about us.',
    // Optional. Tappable chips shown before the visitor's first message.
    starters: ['What are your hours?', 'What do you offer?'],
    // Optional. Image URL shown in the panel header.
    avatar: null,
  },

  // Optional but recommended: keeps the bot on-topic. Without `scope` it answers anything.
  scope: {
    allowed: ['Our hours', 'What we offer', 'How to get in touch'],
    refused: ['Writing code', 'Anything unrelated to us', 'Making up facts not in the knowledge below'],
    onRefusal: 'Stay friendly and in character. Apologize briefly, then suggest something you CAN help with.',
    // One worked example teaches the model to decline in character. This is the
    // part that makes guardrails actually hold - keep at least one.
    refusalExamples: [
      {
        user: 'Write me a python script to scrape a website',
        bot: "Sorry, that's not really my thing - I'm just here to help with our shop! Want to know our hours?",
      },
    ],
  },

  // Static facts the bot answers from. Inline text is the simplest source;
  // budget is 20k tokens total (~80k chars) and the kit throws if you exceed it.
  knowledge: {
    sources: [
      {
        type: 'text',
        content: `
Replace this with the real facts your visitors ask about - hours, menu or
product list, location, how to order, contact details, policies. Plain text is
fine; the bot quotes from it rather than inventing answers.
`.trim(),
      },
      // { type: 'url', url: 'https://example.com/menu' },  // fetched once at init
    ],
  },

  ui: {
    placement: 'bottom-right',   // bottom-right | bottom-left | inline | fullscreen
    theme: 'match-app',          // match-app reads --primary from your page's CSS
    primaryColor: null,          // set to override --primary just for the widget
    launcherIcon: null,          // null renders the 💬 emoji; a URL string renders <img>
  },

  model: {
    route: 'default',            // 'default' | tier alias (small|fast|medium|large|thinking) | model id
    temperature: 0.7,
    maxTokens: 1024,
  },
};

// Rendering note: assistant replies support **bold**, *italic*, `inline code`
// and ```fenced blocks```. Everything else (headings, links, list bullets) is
// HTML-escaped and shown literally - so don't ask the persona for markdown
// tables or links in `instructions`.
