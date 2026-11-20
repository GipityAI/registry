# @gipity/chatbot

An AI assistant for any Gipity app. Persona, scope guardrails, static knowledge, streaming Markdown replies, and **tools**: the model calls your app's own functions as the signed-in visitor, so it can look things up and take actions (with an Allow / Don't allow step for anything that writes). Saved conversations, photos and text files, voice in and out, image generation, a model picker, stop / regenerate / edit.

A corner bubble, an inline panel, a full-page chat with a conversation sidebar, or the headless engine under your own UI. No API keys and no agent server: the model, its limits and the billing are Gipity's; the tool loop is in this kit.

For a complete app built on it (sign-in, saved chats in your database, a read-only SQL analyst over a demo dataset), see the [`ai-chat`](../../apps/ai-chat/) app.

```
chatbot/
  index.js          mount() and everything below
  lib/
    config.js       validation (an unknown setting throws)
    engine.js       createChatbot(): the headless brain and the tool loop
    widget.js       <chatbot-widget>
    prompt.js       system-prompt assembly
    markdown.js     safe Markdown renderer
    stores.js       localStore(), functionStore()
    attachments.js  readAttachment(file)
    voice.js        startRecording(), speak()
  examples/
  tests/            node tests/<name>.test.js
```

## Use it

`gipity add chatbot` installs the kit, wires the import map, declares `llm: owner_pays` in `gipity.yaml` and scaffolds `src/js/chatbot.config.js`. Then:

```html
<chatbot-widget id="bot"></chatbot-widget>
<script type="module">
  import { mount } from '@gipity/chatbot';
  import config from './js/chatbot.config.js';
  const el = mount('#bot', config);   // el.bot is the engine
</script>
```

The kit talks to Gipity through the client SDK every deployed page loads (`window.Gipity`, v1.0.26 or later).

Your own UI instead:

```js
import { createChatbot } from '@gipity/chatbot';
const bot = createChatbot(config);
bot.on('delta', (text) => ui.append(text));
bot.on('tool_start', ({ name }) => ui.step(name));
bot.on('confirm', ({ name, args, approve, deny }) => ui.ask(name, args) ? approve() : deny());
await bot.send('How many orders shipped last week?');
```

## Config

```js
import { functionStore } from '@gipity/chatbot';

export default {
  persona: {
    name: 'Gip',                                    // required
    instructions: 'You help customers with orders.', // required
    tone: 'Warm, brief.',
    avatar: '/images/gip.png',
    greeting: 'Hi! Ask me about your orders.',       // Markdown, shown before the first message
    starters: ['Where is my order?', 'Return policy?'],
  },

  scope: {                                          // optional: keeps it on-topic
    allowed: ['Orders', 'Shipping', 'Returns'],
    refused: ['Writing code', 'Anything unrelated'],
    onRefusal: 'Apologize briefly and offer something you can help with.',
    refusalExamples: [{ user: 'Write me a poem', bot: "That's not my thing, but I can track an order!" }],
  },

  knowledge: {                                      // optional: static facts, 20k tokens
    maxTokens: 20000,
    sources: [
      { type: 'text', content: 'Returns are free within 30 days.' },
      { type: 'url', url: 'https://example.com/faq.txt' },
    ],
  },

  tools: [                                          // optional: see "Tools"
    { name: 'lookup_order', description: 'Find an order by number. Returns { status, total }.',
      function: 'order-status', parameters: { type: 'object', properties: { number: { type: 'string' } }, required: ['number'] } },
    { name: 'cancel_order', description: 'Cancel an unshipped order.', function: 'cancel-order', confirm: true,
      parameters: { type: 'object', properties: { number: { type: 'string' } }, required: ['number'] } },
    { name: 'cart_contents', description: "What is in the visitor's cart right now.", run: async () => cart.items() },
  ],

  features: {
    vision:   { enabled: false },                   // attach photos (needs a model that reads images)
    files:    { enabled: false, maxChars: 200000 }, // attach CSV, logs, JSON, code (over maxChars is refused)
    voice:    { enabled: false, voice: null, autoPlay: false }, // mic + read aloud
    imageGen: { enabled: false, quality: null },    // a generate_image tool
  },

  storage: {
    persist: 'none',                                // 'none' | 'local' | functionStore('chats') | your store
    autoTitle: true,                                // name new chats with a small model
    localKey: 'gipity-chatbot',                     // localStorage key for 'local'
  },

  model: {
    route: 'default',                               // the app's default model, a tier alias
                                                    // (small | fast | medium | large | thinking) or a model id
    temperature: 0.7,
    maxTokens: 2048,                                // per model call
    maxToolSteps: 8,                                // tool rounds per answer (1-25)
    choices: [],                                    // [{ route: 'fast', label: 'Fast' }, ...] shows a picker
  },

  ui: {
    placement: 'bottom-right',                      // bottom-right | bottom-left | inline | fullscreen
    theme: 'match-app',                             // match-app | light | dark | auto
    primaryColor: null,                             // override the page's --primary
    launcherIcon: null,                             // null = 💬; a URL renders an image
    sidebar: null,                                  // conversation list; default on for inline/fullscreen with storage
    showUsage: false,                               // show the credits each answer cost
    placeholder: 'Message…',
  },
};
```

Only `persona.name` and `persona.instructions` are required. A setting the kit doesn't know throws `ChatbotConfigError`, so a typo never silently does nothing.

## Tools

A tool is something the model can ask to run in the middle of an answer. The kit runs it, hands the result back, and the model continues, up to `model.maxToolSteps` rounds.

- **`function: 'name'`** calls `functions/name.js` through `Gipity.fn`, as the signed-in visitor. The function's `auth`, table grants and limits apply, so the assistant can do exactly what that visitor could already do through your app. The tool arguments are the function body; the return value goes to the model. Return `{ error: '...' }` for an expected failure and the model reads it and recovers.
- **`run: async (args) => result`** runs browser code (the page, the cart, game state).
- **`description`** is how the model decides when to call the tool: say what it does and what it returns. **`parameters`** is a JSON Schema object.
- **`confirm: true`** asks the visitor first. The widget shows an Allow / Don't allow card; the headless engine emits `confirm` with `approve()` / `deny()` (with nothing listening, the answer is no). Use it for anything that writes, sends or spends.
- A tool that needs sign-in, called signed out, tells the model and the widget shows a Sign in button (`auth_required` event).
- Results over 30,000 characters are cut, and the model is told so it can ask for less.

Chat over your database: one `query_data` tool backed by a function that runs a single `SELECT` inside `db.tx` with `SET TRANSACTION READ ONLY`, granted only the tables it may read, and the schema written into `knowledge`. The `ai-chat` app's `functions/query-data.js` is the pattern.

## Saved conversations

`storage.persist` takes:

- `'local'`: this browser's localStorage. No backend.
- `functionStore('chats')`: one app function keeps them in your database, per signed-in user. It receives `{ action, ... }`:

  | action | body | returns |
  |---|---|---|
  | `list` | | `{ conversations: [{ id, title, updatedAt }] }`, newest first |
  | `load` | `id` | `{ conversation: { id, title, messages } }` or `{ conversation: null }` |
  | `create` | `title, messages` | `{ id }` |
  | `write` | `id, from, messages` | `{ ok: true }`: drop messages from position `from` on, then add these |
  | `rename` | `id, title` | `{ ok: true }` |
  | `remove` | `id` | `{ ok: true }` |

  Copy `functions/chats.js` and `migrations/001-chat.sql` from the `ai-chat` app.
- Any object with async `list`, `load`, `create`, `write`, `rename` and `remove` as above.

## Features and the services they use

Each feature calls a Gipity app service, so declare it in the `services` phase of `gipity.yaml` (`owner_pays` for a public bot):

| Feature | Service |
|---|---|
| chat (always) | `llm` |
| `voice` mic | `transcribe` |
| `voice` read aloud | `tts` |
| `imageGen` | `image` |

Photos are shrunk to 1280 px JPEG before sending. Text files go into the message inside `<file name="...">` tags; the visitor sees only what they typed plus a file chip.

## Engine API

`createChatbot(config)` returns:

| | |
|---|---|
| `send(text, { attachments })` | send a message (attachments from `readAttachment(file)`); resolves with the final reply |
| `stop()` | stop the reply in progress; what streamed is kept |
| `regenerate()` | drop the last reply and ask again |
| `editLast(text)` | replace the last message and ask again |
| `newChat()` / `reset()` | start an empty conversation |
| `open(id)`, `conversations()`, `rename(id, title)`, `remove(id)` | saved conversations |
| `current()` | `{ id, title }` of the open conversation |
| `setModel(route)`, `getModel()` | the model for the next message |
| `history()`, `isBusy()`, `config` | |

Events (`bot.on(name, fn)` returns an unsubscribe function): `start`, `delta`, `message`, `tool_start`, `tool_end`, `confirm`, `usage` (`{ credits, inputTokens, outputTokens }` per answer), `complete`, `error` (`err.visitorMessage` is safe to show a visitor; the full detail is in `err.message`), `auth_required`, `history`, `conversation`, `conversations`, `reset`, `knowledge_loaded`.

A failed send leaves no trace in the history and hands the text back as `err.unsentText`.

## Long conversations

Each request carries the newest messages that fit about 75,000 tokens (at most 200 messages), starting at a user message so a tool result never loses the call that asked for it. The whole conversation stays in `history()` and in storage.

## Theming

`theme: 'match-app'` uses the page's Gipity theme tokens (`--primary`, `--surface`, `--text-main`, `--border`...), so the widget follows the template's dark, light or blue theme. `light`, `dark` and `auto` pick a fixed palette. Style the shadow parts from your page: `chatbot-widget::part(panel)`, `::part(header)`, `::part(messages)`, `::part(sidebar)`, `::part(launcher)`.

## Tests

```bash
for t in tests/*.test.js; do node $t; done
```
